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
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def _escape_concat_path(path: Path) -> str:
    """Escape đường dẫn tệp an toàn cho cú pháp ffmpeg concat demuxer."""
    p_str = path.resolve().as_posix()
    # Trong file concat ffmpeg, dấu ' cần được escape thành '\''
    return p_str.replace("'", "'\\''")


def _normalize_concat_if_needed(inputs: list[Path], output: Path, ffmpeg: str):
    """Return None for compatible clips, otherwise normalize all streams explicitly."""
    import whiteboard_audio
    _, ffprobe = whiteboard_audio.resolve_ffmpeg_and_probe()
    if not ffprobe:
        raise RuntimeError("FFPROBE_REQUIRED: Cần ffprobe để kiểm tra streams trước khi ghép, tránh mất audio")
    clips = []
    for path in inputs:
        result = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format",
                                 "-of", "json", str(path)], capture_output=True, text=True)
        if result.returncode:
            raise ValueError(f"Không probe được video: {path}")
        data = json.loads(result.stdout)
        video = next((v for v in data["streams"] if v["codec_type"] == "video"), None)
        audio = next((v for v in data["streams"] if v["codec_type"] == "audio"), None)
        if not video:
            raise ValueError(f"Tệp không có video: {path}")
        duration = float(video.get("duration", data["format"]["duration"]))
        signature = (video.get("codec_name"), video["width"], video["height"],
                     video.get("r_frame_rate"), video.get("pix_fmt"),
                     tuple(audio.get(k) for k in ("codec_name", "sample_rate", "channel_layout")) if audio else None)
        clips.append((video, audio, duration, signature))
    if all(c[3] == clips[0][3] and (not c[1] or abs(float(c[1].get("duration", c[2])) - c[2]) < 0.02) for c in clips):
        return None
    width, height = clips[0][0]["width"], clips[0][0]["height"]
    width, height = width + width % 2, height + height % 2
    fps = clips[0][0].get("r_frame_rate", "30/1")
    has_audio = any(c[1] for c in clips)
    cmd = [ffmpeg, "-y", "-v", "error"]
    for path in inputs:
        cmd += ["-i", str(path)]
    filters, pads = [], []
    for i, (_, audio, duration, _) in enumerate(clips):
        filters.append(f"[{i}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                       f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},"
                       f"setpts=PTS-STARTPTS[v{i}]")
        pads.append(f"[v{i}]")
        if has_audio:
            source = f"[{i}:a:0]" if audio else "anullsrc=r=48000:cl=stereo,"
            filters.append(source + f"aformat=sample_rates=48000:channel_layouts=stereo,apad,"
                           f"atrim=duration={duration:.9f},asetpts=PTS-STARTPTS[a{i}]")
            pads.append(f"[a{i}]")
    filters.append("".join(pads) + f"concat=n={len(clips)}:v=1:a={int(has_audio)}[v]" + ("[a]" if has_audio else ""))
    cmd += ["-filter_complex", ";".join(filters), "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if has_audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    cmd.append(str(output))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Chuẩn hóa/ghép video thất bại: {result.stderr[-2000:]}")
    return True


def _ffmpeg_concat_copy(inputs: list[Path], output: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        for candidate in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
            if Path(candidate).exists():
                ffmpeg = candidate
                break
    if ffmpeg is None:
        return False
    normalized = _normalize_concat_if_needed(inputs, output, ffmpeg)
    if normalized is not None:
        return normalized
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        for p in inputs:
            f.write(f"file '{_escape_concat_path(p)}'\n")
        list_path = Path(f.name)
    try:
        res = subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(list_path), "-c", "copy", str(output)],
            capture_output=True, text=True,
        )
        if res.returncode == 0:
            print(f"  Ghép bằng ffmpeg không mất dữ liệu xong: {output}")
            return True
        print(f"  [warn] ffmpeg -c copy thất bại, thử mã hóa lại: {res.stderr.strip()[:200]}")
        res = subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
             "-i", str(list_path), "-c:v", "libx264", "-crf", "20",
             "-c:a", "aac", "-b:a", "192k",
             "-pix_fmt", "yuv420p", "-vf", "scale='trunc(iw/2)*2':'trunc(ih/2)*2'", str(output)],
            capture_output=True, text=True,
        )
        if res.returncode == 0:
            print(f"  Ghép bằng ffmpeg có mã hóa lại xong: {output}")
            return True
        print(f"  [warn] ffmpeg mã hóa lại cũng thất bại: {res.stderr.strip()[:200]}")
        return False
    finally:
        list_path.unlink(missing_ok=True)


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
    args = p.parse_args(argv)

    inputs = [Path(x) for x in args.inputs]
    missing = [str(x) for x in inputs if not x.exists()]
    if missing:
        print(f"[err] Thiếu tệp đầu vào: {', '.join(missing)}", file=sys.stderr)
        return 1
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if _ffmpeg_concat_copy(inputs, output) or _pyav_concat(inputs, output):
        print(f"OUTPUT={output.resolve()}")
        return 0
    print("[err] Ghép thất bại: hệ thống không có ffmpeg và PyAV không dùng được", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
