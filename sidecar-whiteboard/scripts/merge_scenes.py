#!/usr/bin/env python3
"""
多幕合并：把各场景的白板动画 MP4 按顺序硬切拼接成一条完整视频。

优先用系统 ffmpeg 无损拼接（-c copy，不重编码）；各片尺寸/编码不一致或无
ffmpeg 时，回退到 PyAV 逐帧重编码并缩放补边到第一段尺寸。单片仍保留。

用法：
  <ENV_PY> merge_scenes.py --inputs a.mp4 b.mp4 c.mp4 --output final.mp4
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_utils import find_ffmpeg  # noqa: E402


def _escape_concat_path(path: Path) -> str:
    """Escape đường dẫn tệp an toàn cho cú pháp ffmpeg concat demuxer."""
    p_str = path.resolve().as_posix()
    # Trong file concat ffmpeg, dấu ' cần được escape thành '\''
    return p_str.replace("'", "'\\''")


_SR = 48000
_BYTES_PER_SAMPLE = 4  # s16le stereo


def _probe_clips(inputs: list[Path]) -> list[dict]:
    """Đọc thông số từng clip bằng PyAV (không cần ffprobe: bản ffmpeg đóng gói theo app không kèm ffprobe)."""
    from media_utils import probe_media
    clips = []
    for path in inputs:
        try:
            info = probe_media(path)
        except Exception as exc:
            raise ValueError(f"Không probe được video: {path} ({exc})") from exc
        v = info["video"]
        if not v:
            raise ValueError(f"Tệp không có video: {path}")
        if v["fps"] <= 0:
            raise ValueError(f"FPS video không hợp lệ: {path}")
        # Độ dài hình thật = số khung / fps (duration của container có thể bị audio kéo dài hơn).
        dur = v["frames"] / v["fps"] if v["frames"] and v["fps"] else info["duration_s"]
        clips.append({"path": path, "video": v, "audio": info["audio"], "duration": float(dur),
                      "signature": (v["codec"], v["width"], v["height"], round(v["fps"], 3), v["pix_fmt"])})
    return clips


def _concat_video_only(clips: list[dict], output: Path, ffmpeg: str, transitions: dict | None = None) -> None:
    """Ghép phần hình (bỏ audio). Clip tương thích → -c copy; khác nhau → chuẩn hóa kích thước/fps và mã hóa lại.

    transitions: {chỉ số clip: (số khung thay ở cuối clip, đường dẫn mp4 khung chuyển cảnh)}. Có chuyển cảnh thì
    luôn đi đường mã hóa lại; tổng số khung hình giữ nguyên vì chỉ thay khung chứ không chồng lấp."""
    transitions = transitions or {}
    inputs = [c["path"] for c in clips]
    if not transitions and all(c["signature"] == clips[0]["signature"] for c in clips):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
            for c in clips:
                f.write(f"file '{_escape_concat_path(c['path'])}'\n")
                # Concat mặc định dùng duration container, có thể dài hơn hình vì audio.
                f.write(f"duration {c['duration']:.9f}\n")
            list_path = Path(f.name)
        try:
            res = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                                  "-i", str(list_path), "-an", "-c:v", "copy", str(output)],
                                 capture_output=True, text=True)
        finally:
            list_path.unlink(missing_ok=True)
        if res.returncode == 0:
            return
        print(f"  [warn] ffmpeg -c copy thất bại, thử mã hóa lại: {res.stderr.strip()[:200]}")
    v0 = clips[0]["video"]
    width, height = v0["width"] + v0["width"] % 2, v0["height"] + v0["height"] % 2
    fps = f"{v0['fps']:.6f}"
    # Mỗi cảnh sau đổi FPS phải chiếm số frame nguyên. Audio dùng chính thời lượng
    # này, thay vì thời lượng trước đổi FPS, để các điểm cắt không trôi dần.
    frame_counts = [max(1, int(c["duration"] * float(fps) + 0.5)) for c in clips]
    cmd = [ffmpeg, "-y", "-v", "error"]
    for path in inputs:
        cmd += ["-i", str(path)]
    trans_input: dict[int, int] = {}
    for i in sorted(transitions):
        trans_input[i] = len(inputs) + len(trans_input)
        cmd += ["-i", str(transitions[i][1])]
    filters = []
    labels = []
    for i in range(len(clips)):
        keep = frame_counts[i] - (transitions[i][0] if i in transitions else 0)
        filters.append(f"[{i}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                       f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS,fps={fps},"
                       f"tpad=stop_mode=clone:stop_duration={1 / float(fps):.9f},"
                       f"trim=end_frame={keep},setpts=PTS-STARTPTS[v{i}]")
        labels.append(f"[v{i}]")
        if i in transitions:
            n_frames = transitions[i][0]
            filters.append(f"[{trans_input[i]}:v:0]setsar=1,setpts=PTS-STARTPTS,fps={fps},"
                           f"trim=end_frame={n_frames},setpts=PTS-STARTPTS[t{i}]")
            labels.append(f"[t{i}]")
    filters.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0[v]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]", "-an",
            "-c:v", "libx264", "-crf", "18" if transitions else "20", "-pix_fmt", "yuv420p", str(output)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError(f"Chuẩn hóa/ghép video thất bại: {res.stderr[-2000:]}")
    for c, frames in zip(clips, frame_counts):
        c["duration"] = frames / float(fps)


def _build_pcm_track(clips: list[dict], raw_path: Path, ffmpeg: str, tmp_dir: Path) -> None:
    """
    Dựng một track PCM s16le 48 kHz stereo liền mạch: mỗi clip được cắt/đệm im lặng đúng bằng độ dài HÌNH của nó.
    Ghép AAC bằng -c copy làm cộng dồn phần đệm đầu/cuối của từng clip (≈50 ms/cảnh) nên tiếng trôi lệch dần
    so với hình; ghép ở dạng PCM rồi mã hóa AAC đúng một lần thì không có sai số cộng dồn.
    """
    total_samples = 0
    elapsed = 0.0
    with open(raw_path, "wb") as out:
        for i, c in enumerate(clips):
            elapsed += c["duration"]
            # Mục tiêu tích lũy (không làm tròn từng clip) để sai số không cộng dồn.
            want = int(round(elapsed * _SR)) - total_samples
            written = 0
            if c["audio"]:
                part = tmp_dir / f"a{i}.raw"
                res = subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(c["path"]), "-vn", "-map", "0:a:0",
                                      "-af", f"aresample={_SR}", "-ac", "2", "-f", "s16le", str(part)],
                                     capture_output=True, text=True)
                if res.returncode:
                    raise RuntimeError(f"Giải mã audio thất bại ({c['path']}): {res.stderr[-1000:]}")
                need = want * _BYTES_PER_SAMPLE
                with open(part, "rb") as src:
                    while written < need:
                        chunk = src.read(min(1 << 20, need - written))
                        if not chunk:
                            break
                        out.write(chunk)
                        written += len(chunk)
                part.unlink(missing_ok=True)
            pad = want * _BYTES_PER_SAMPLE - written
            while pad > 0:
                n = min(pad, 1 << 20)
                out.write(b"\x00" * n)
                pad -= n
            total_samples += want


def _write_transition_clip(frames: list, fps: float, dest: Path, ffmpeg: str) -> None:
    """Mã hóa các khung (BGR) thành mp4 chất lượng cao để đưa vào bước ghép."""
    h, w = frames[0].shape[:2]
    cmd = [ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
           "-r", f"{fps:.6f}", "-i", "-", "-an", "-c:v", "libx264", "-crf", "12", "-preset", "veryfast",
           "-pix_fmt", "yuv420p", str(dest)]
    res = subprocess.run(cmd, input=b"".join(f.tobytes() for f in frames), capture_output=True)
    if res.returncode:
        raise RuntimeError(f"Dựng đoạn lật trang thất bại: {res.stderr.decode(errors='replace')[-500:]}")


def _plan_page_turns(clips: list[dict], page_turn_ms: int, ffmpeg: str, tmp: Path) -> dict:
    """Dựng đoạn lật trang (phải → trái) cho từng ranh giới cảnh nếu đoạn cuối cảnh trước đủ tĩnh."""
    import page_turn
    transitions: dict = {}
    for i in range(len(clips) - 1):
        a, b = clips[i], clips[i + 1]
        fps = a["video"]["fps"]
        if a["video"]["width"] % 2 or a["video"]["height"] % 2:
            continue
        want = int(round(page_turn_ms / 1000.0 * fps))
        if want < page_turn.MIN_FRAMES:
            continue
        tail, _, _ = page_turn.read_tail_and_first(str(a["path"]), want)
        _, first_b, _ = page_turn.read_tail_and_first(str(b["path"]), 1)
        if not tail or first_b is None:
            continue
        n = page_turn.plan_static_tail(tail, want)
        if n < page_turn.MIN_FRAMES:
            print(f"  [info] Bỏ lật trang sau cảnh {i + 1}: đoạn giữ hình cuối cảnh quá ngắn ({n} khung).")
            continue
        frames = page_turn.build_transition_frames(tail, first_b, n)
        dest = tmp / f"turn{i}.mp4"
        _write_transition_clip(frames, fps, dest, ffmpeg)
        transitions[i] = (n, dest)
    return transitions


def _ffmpeg_concat_copy(inputs: list[Path], output: Path, page_turn_ms: int = 0) -> bool:
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        return False
    clips = _probe_clips(inputs)
    has_audio = any(c["audio"] for c in clips)
    with tempfile.TemporaryDirectory(prefix="wb_merge_") as td:
        tmp = Path(td)
        transitions = _plan_page_turns(clips, page_turn_ms, ffmpeg, tmp) if page_turn_ms > 0 and len(clips) > 1 else {}
        if not has_audio:
            _concat_video_only(clips, output, ffmpeg, transitions)
            print(f"  Ghép video xong: {output}")
            return True
        video_only = tmp / "video.mp4"
        _concat_video_only(clips, video_only, ffmpeg, transitions)
        raw = tmp / "audio.raw"
        _build_pcm_track(clips, raw, ffmpeg, tmp)
        res = subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(video_only),
                              "-f", "s16le", "-ar", str(_SR), "-ac", "2", "-i", str(raw),
                              "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                              "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output)],
                             capture_output=True, text=True)
        if res.returncode:
            raise RuntimeError(f"Mux audio/video thất bại: {res.stderr[-1000:]}")
    print(f"  Ghép video + audio khớp thời lượng xong: {output}")
    return True


def _pyav_concat(inputs: list[Path], output: Path) -> bool:
    """
    Dự phòng ghép qua PyAV.
    LƯU Ý R0: Nếu bất kỳ file input nào có chứa stream audio, _pyav_concat từ chối
    và trả về False để buộc xử lý an toàn, tránh làm mất audio của các phân cảnh.
    """
    try:
        import av
    except ImportError:
        return False

    # Kiểm tra xem các clip đầu vào có audio không
    for p in inputs:
        cont = av.open(str(p))
        has_audio = len(cont.streams.audio) > 0
        cont.close()
        if has_audio:
            print(f"[warn] PyAV fallback thuần video sẽ làm mất audio của {p}; chuyển tiếp để trả lỗi an toàn.", file=sys.stderr)
            return False

    first = av.open(str(inputs[0]))
    vs = first.streams.video[0]
    w, h = vs.codec_context.width, vs.codec_context.height
    rate = vs.average_rate
    first.close()

    out = av.open(str(output), mode="w")
    ostream = out.add_stream("h264", rate=rate)
    ostream.width, ostream.height = w, h
    ostream.pix_fmt = "yuv420p"
    ostream.options = {"crf": "24", "preset": "medium"}
    for p in inputs:
        cont = av.open(str(p))
        for frame in cont.decode(video=0):
            if frame.width != w or frame.height != h:
                frame = frame.reformat(width=w, height=h)
            for pkt in ostream.encode(frame):
                out.mux(pkt)
        cont.close()
    for pkt in ostream.encode(None):
        out.mux(pkt)
    out.close()
    print(f"  Ghép bằng PyAV xong: {output}")
    return True


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Ghép các cảnh hoạt hình bảng trắng MP4 theo thứ tự")
    p.add_argument("--inputs", nargs="+", required=True, help="Danh sách MP4 theo thứ tự phát")
    p.add_argument("--output", required=True, help="Đường dẫn tệp ghép đầu ra")
    p.add_argument("--page-turn-ms", type=int, default=0,
                   help="Thời lượng lật trang (phải→trái) giữa các cảnh, ms; 0 = tắt. Không đổi tổng thời lượng.")
    args = p.parse_args(argv)
    if args.page_turn_ms < 0 or args.page_turn_ms > 3000:
        print("[err] --page-turn-ms phải trong khoảng 0–3000", file=sys.stderr)
        return 1

    inputs = [Path(x) for x in args.inputs]
    missing = [str(x) for x in inputs if not x.exists()]
    if missing:
        print(f"[err] Thiếu tệp đầu vào: {', '.join(missing)}", file=sys.stderr)
        return 1
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if _ffmpeg_concat_copy(inputs, output, args.page_turn_ms) or _pyav_concat(inputs, output):
        print(f"OUTPUT={output.resolve()}")
        return 0
    print("[err] Ghép thất bại: hệ thống không có ffmpeg và PyAV không dùng được", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
