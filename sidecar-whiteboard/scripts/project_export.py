"""
Xuất dự án whiteboard nhiều cảnh: kiểm tra dữ liệu → render từng cảnh (có cache) → chuẩn hóa →
nối video → dựng audio theo cảnh → mux → kiểm tra → thay file đầu ra.

Định dạng dự án (schemaVersion 1), trường tối thiểu:
{
  "schemaVersion": 1, "id": "...", "name": "...",
  "fps": 30, "paperColor": "#F5EBD7", "hand": null,
  "outputSize": {"width": 1920, "height": 1080},            # tùy chọn; mặc định theo cảnh đầu
  "masterAudio": {"path": "loi-doc.wav"},                     # tùy chọn
  "scenes": [{
      "id": "scene-01", "imagePath": "...", "annotationPath": "...",
      "durationMs": 30000, "timelineStartMs": 0,              # timelineStartMs: vị trí trong audio toàn bài
      "audio": {"mode": "auto" | "none" | "file" | "master", "path": "..."},   # mặc định auto
      "enabled": true
  }]
}
Thứ tự mảng `scenes` là thứ tự phát. Audio toàn bài (master) được cắt theo [timelineStartMs,
timelineStartMs + thời lượng thực của cảnh).

Độ chính xác thời gian: video mỗi cảnh có đúng round(durationMs × fps / 1000) khung hình; audio mỗi cảnh
được dựng (giải mã PCM, cắt/đệm chính xác) đúng bằng thời lượng thực của video cảnh đó, nối PCM rồi mã hóa
AAC một lần, nên lệch A/V không tích lũy qua các cảnh.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import media_utils as mu  # noqa: E402

SCHEMA_VERSION = 1
# Tăng khi thuật toán render đổi hình ảnh đầu ra, để vô hiệu cache cũ.
ENGINE_VERSION = "wb-render-1+p3"
AUDIO_RATE = 48000
DEFAULT_HAND = Path(__file__).resolve().parent.parent / "assets" / "drawing-hand.png"


# ─────────────────────────── tiện ích ───────────────────────────
def frames_for(duration_ms, fps) -> int:
    return max(1, int(round(float(duration_ms) * float(fps) / 1000.0)))


def _sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe(name: str) -> str:
    return re.sub(r"[^\w.\-]", "_", str(name)) or "scene"


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _norm_color(v) -> str:
    v = (v or "#F5EBD7").strip()
    if re.fullmatch(r"[0-9A-Fa-f]{6}", v):
        v = "#" + v
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", v):
        raise ValueError(f"Màu nền giấy không hợp lệ: {v!r} (cần dạng #RRGGBB)")
    return v.upper()


# ─────────────────────────── kiểm tra annotation ───────────────────────────
def validate_annotation(ann, duration_ms):
    """Trả (errors, warnings) dạng danh sách chuỗi cho một annotation và thời lượng cảnh."""
    errors, warnings = [], []
    if not isinstance(ann, dict) or not isinstance(ann.get("elements"), list) or not ann["elements"]:
        return ["Annotation không có elements."], warnings
    canvas = ann.get("canvas")
    cw = ch = None
    if canvas is not None:
        cw, ch = (canvas or {}).get("width"), (canvas or {}).get("height")
        if not (_finite(cw) and _finite(ch) and cw > 0 and ch > 0):
            errors.append("canvas phải có width/height là số dương.")
            cw = ch = None
    windows = []
    for i, el in enumerate(ann["elements"], start=1):
        name = el.get("label") or el.get("id") or f"vùng {i}"
        reg, rev = el.get("region") or {}, el.get("reveal") or {}
        if not all(_finite(reg.get(k)) for k in ("x", "y", "width", "height")) or reg.get("width", 0) <= 0 or reg.get("height", 0) <= 0:
            errors.append(f"Vùng '{name}': region không hợp lệ (cần x, y, width>0, height>0).")
        elif cw and (reg["x"] < 0 or reg["y"] < 0 or reg["x"] + reg["width"] > cw + 1 or reg["y"] + reg["height"] > ch + 1):
            warnings.append(f"Vùng '{name}' nằm ngoài canvas {int(cw)}x{int(ch)}.")
        s, d = rev.get("startMs"), rev.get("durationMs")
        if not (_finite(s) and _finite(d)) or s < 0 or d <= 0:
            errors.append(f"Vùng '{name}': reveal.startMs phải ≥ 0 và durationMs > 0.")
            continue
        if s + d > duration_ms:
            errors.append(
                f"Vùng '{name}' kết thúc ở {int(s + d)}ms, vượt thời lượng cảnh {int(duration_ms)}ms; "
                f"tăng thời lượng cảnh lên ít nhất {int(s + d)}ms hoặc rút ngắn thời gian vẽ.")
        windows.append((s, s + d, name))
    windows.sort()
    for a, b in zip(windows, windows[1:]):
        if b[0] < a[1] - 1:
            warnings.append(f"Vùng '{a[2]}' và '{b[2]}' chồng thời gian; bút chỉ có một đầu nên có thể vẽ lẫn.")
    return errors, warnings


# ─────────────────────────── giải quyết dự án ───────────────────────────
def _scene_audio(project, scene):
    """Trả (mode, path|None) đã giải quyết: none | file | master."""
    a = scene.get("audio")
    mode = (a or {}).get("mode", "auto") if isinstance(a, dict) else "auto"
    master = ((project.get("masterAudio") or {}).get("path")) or None
    if mode == "auto":
        return ("master", master) if master else ("none", None)
    if mode == "master":
        return "master", master
    if mode == "file":
        return "file", (a or {}).get("path")
    return "none", None


def resolve_scenes(project, scene_ids=None):
    """Danh sách cảnh sẽ xuất theo thứ tự phát, kèm timelineStartMs đã điền."""
    out, cursor = [], 0
    for idx, sc in enumerate(project.get("scenes") or [], start=1):
        dur = sc.get("durationMs")
        start = sc.get("timelineStartMs")
        if not _finite(start):
            start = cursor
        if _finite(dur):
            cursor = start + dur
        if sc.get("enabled", True) is False:
            continue
        if scene_ids is not None and sc.get("id") not in scene_ids:
            continue
        out.append({"index": idx, "scene": sc, "id": sc.get("id") or f"scene-{idx:02d}",
                    "durationMs": dur, "timelineStartMs": start})
    return out


def validate_project(project, scene_ids=None):
    """
    Kiểm tra toàn bộ trước khi render. Trả {"errors": [...], "warnings": [...]} với mỗi mục
    {"sceneId", "field", "message"} (sceneId=None nếu lỗi cấp dự án).
    """
    errors, warnings = [], []

    def err(sid, field, msg):
        errors.append({"sceneId": sid, "field": field, "message": msg})

    def warn(sid, field, msg):
        warnings.append({"sceneId": sid, "field": field, "message": msg})

    if not isinstance(project, dict):
        return {"errors": [{"sceneId": None, "field": "project", "message": "Dự án không hợp lệ."}], "warnings": []}
    if project.get("schemaVersion", SCHEMA_VERSION) != SCHEMA_VERSION:
        err(None, "schemaVersion", f"schemaVersion {project.get('schemaVersion')} chưa được hỗ trợ (cần {SCHEMA_VERSION}).")
    fps = project.get("fps", 30)
    if not (_finite(fps) and 1 <= fps <= 120):
        err(None, "fps", f"FPS không hợp lệ: {fps} (cần từ 1 đến 120).")
        fps = 30
    try:
        _norm_color(project.get("paperColor"))
    except ValueError as e:
        err(None, "paperColor", str(e))
    master = (project.get("masterAudio") or {}).get("path")
    if master and not os.path.isfile(master):
        err(None, "masterAudio", f"Không tìm thấy audio toàn bài: {master}")
    hand = project.get("hand")
    if hand and hand not in _HAND_PRESETS and not os.path.isfile(hand) \
            and not (Path(__file__).resolve().parent.parent / "assets" / hand).is_file():
        err(None, "hand", f"Không tìm thấy ảnh bàn tay: {hand}")

    scenes = resolve_scenes(project, scene_ids)
    if not scenes:
        err(None, "scenes", "Không có cảnh nào để xuất (kiểm tra danh sách cảnh/cảnh được chọn).")
    seen = set()
    for r in scenes:
        sc, sid = r["scene"], r["id"]
        if sid in seen:
            err(sid, "id", f"Trùng ID cảnh: {sid}")
        seen.add(sid)
        dur = r["durationMs"]
        if not (_finite(dur) and dur > 0):
            err(sid, "durationMs", "Thời lượng cảnh phải là số dương (ms).")
            dur = None
        img, ann_path = sc.get("imagePath"), sc.get("annotationPath")
        if not img or not os.path.isfile(img):
            err(sid, "imagePath", f"Cảnh {sid}: chưa chọn ảnh hoặc không tìm thấy: {img or '(trống)'}")
        if not ann_path or not os.path.isfile(ann_path):
            err(sid, "annotationPath", f"Cảnh {sid}: chưa có annotation hoặc không tìm thấy: {ann_path or '(trống)'}")
        elif dur:
            try:
                ann = json.loads(Path(ann_path).read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                err(sid, "annotationPath", f"Cảnh {sid}: không đọc được annotation: {e}")
            else:
                e_list, w_list = validate_annotation(ann, dur)
                for m in e_list:
                    err(sid, "annotation", f"Cảnh {sid}: {m}")
                for m in w_list:
                    warn(sid, "annotation", f"Cảnh {sid}: {m}")
        mode, apath = _scene_audio(project, sc)
        if mode == "master" and not master:
            err(sid, "audio", f"Cảnh {sid}: chọn audio toàn bài nhưng dự án chưa có audio toàn bài.")
        if mode == "file" and (not apath or not os.path.isfile(apath)):
            err(sid, "audio", f"Cảnh {sid}: không tìm thấy audio riêng: {apath or '(trống)'}")
    return {"errors": errors, "warnings": warnings}


# ─────────────────────────── render từng cảnh ───────────────────────────
_HAND_PRESETS = ("pen", "default", "brush", "calligraphy", "calligraphy-brush")


def _scene_settings(project, r) -> dict:
    """Cùng bộ cài đặt như lệnh render_scene (tự phân tích kiểu vẽ ảnh, tay vẽ, subject-first...);
    cảnh có thể ghi đè bằng inkPath/colorFill/inkWeight/colorWeight/subjectFirst."""
    import whiteboard_settings
    sc = r["scene"]
    return whiteboard_settings.resolve_render_settings({
        "image_path": sc["imagePath"], "fps": int(project.get("fps", 30)),
        "paper_color": project.get("paperColor"), "hand_path": project.get("hand"),
        "ink_path": sc.get("inkPath"), "color_fill": sc.get("colorFill"),
        "ink_weight": sc.get("inkWeight"), "color_weight": sc.get("colorWeight"),
        "subject_first": sc.get("subjectFirst", project.get("subjectFirst", False)),
    })


def _scene_cache_key(project, r) -> str:
    sc = r["scene"]
    s = _scene_settings(project, r)
    hand = s["hand_path"] or str(DEFAULT_HAND)
    parts = [ENGINE_VERSION, _sha256(sc["imagePath"]), _sha256(sc["annotationPath"]),
             _sha256(hand) if os.path.isfile(hand) else "nohand",
             str(s["fps"]), s["paper_color"], str(int(r["durationMs"])),
             s["ink_path"], s["color_fill"], str(s["ink_weight"]), str(s["color_weight"]), str(s["subject_first"])]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def _render_scene(project, r, dest: Path, on_frames):
    """Render vào dest (ghi tạm rồi đổi tên); on_frames(done,total) báo số khung hình."""
    import render_stream_whiteboard as rsw

    sc = r["scene"]
    tmp = dest.with_name(dest.stem + ".part.mp4")
    args = [sc["imagePath"], sc["annotationPath"], str(tmp)]
    s = _scene_settings(project, r)
    if s["hand_path"] and os.path.isfile(s["hand_path"]):
        args.append(s["hand_path"])
    args += ["--fps", str(s["fps"]), "--paper-color", s["paper_color"],
             "--total-ms", str(int(r["durationMs"])),
             "--ink-path", str(s["ink_path"]), "--color-fill", str(s["color_fill"]),
             "--ink-weight", str(s["ink_weight"]), "--color-weight", str(s["color_weight"])]
    if s["subject_first"]:
        args.append("--subject-first")
    rsw.PROGRESS_CALLBACK = on_frames
    try:
        code = rsw.main(args)
    finally:
        rsw.PROGRESS_CALLBACK = None
    if code != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Render cảnh {r['id']} thất bại (mã {code}).")
    os.replace(tmp, dest)


# ─────────────────────────── xuất dự án ───────────────────────────
def export_project(project, output_path, scene_ids=None, progress=None, keep_work=False) -> dict:
    """
    Xuất dự án ra output_path (MP4). `progress(percent, message)` tùy chọn.
    Trả manifest (cũng được ghi cạnh output: <output>.manifest.json).
    """
    def report(pct, msg):
        if progress:
            progress(max(0.0, min(100.0, pct)), msg)

    report(0, "Kiểm tra dự án")
    v = validate_project(project, scene_ids)
    if v["errors"]:
        shown = "; ".join(e["message"] for e in v["errors"][:5])
        more = f" (+{len(v['errors']) - 5} lỗi khác)" if len(v["errors"]) > 5 else ""
        raise ValueError("Dự án chưa hợp lệ: " + shown + more)
    warnings = [w["message"] for w in v["warnings"]]

    fps = int(project.get("fps", 30))
    scenes = resolve_scenes(project, scene_ids)
    output = Path(output_path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    cache_dir = output.parent / ".whiteboard-cache"
    cache_dir.mkdir(exist_ok=True)

    # Audio toàn bài dài hơn timeline → kéo cảnh cuối (không cắt lời).
    master = (project.get("masterAudio") or {}).get("path")
    if master and scene_ids is None:
        master_dur = mu.probe_media(master)["duration_s"]
        master_scenes = [r for r in scenes if _scene_audio(project, r["scene"])[0] == "master"]
        if master_scenes:
            last = max(master_scenes, key=lambda r: r["timelineStartMs"] + r["durationMs"])
            end_ms = last["timelineStartMs"] + last["durationMs"]
            if master_dur * 1000 > end_ms + 1000.0 / fps:
                extra = int(round(master_dur * 1000 - end_ms))
                last["durationMs"] += extra
                warnings.append(f"Audio toàn bài dài hơn timeline {extra}ms: đã kéo dài {last['id']} để giữ hết lời.")
            elif master_dur * 1000 < end_ms - 1000.0 / fps:
                warnings.append(
                    f"Audio toàn bài ngắn hơn timeline {int(end_ms - master_dur * 1000)}ms: phần cuối sẽ im lặng.")

    # Dọn rác của lần xuất trước bị hủy/dừng đột ngột (tiến trình bị kill nên `finally` không chạy).
    # Runner chỉ xử lý một yêu cầu một lúc nên không có lần xuất nào khác đang dùng chúng.
    for stale in output.parent.glob(".wb-work-*"):
        shutil.rmtree(stale, ignore_errors=True)
    for stale in cache_dir.glob("*.part.mp4"):
        stale.unlink(missing_ok=True)
    work = Path(tempfile.mkdtemp(prefix=".wb-work-", dir=output.parent))
    try:
        # 1) render từng cảnh (cache)
        total_frames = sum(frames_for(r["durationMs"], fps) for r in scenes)
        done_frames = 0
        scene_videos, scene_info = [], []
        for n, r in enumerate(scenes, start=1):
            frames = frames_for(r["durationMs"], fps)
            key = _scene_cache_key(project, r)
            cached = cache_dir / f"{_safe(r['id'])}-{key}.mp4"
            hit = False
            if cached.exists():
                try:
                    hit = abs(mu.probe_media(cached)["video"]["frames"] - frames) <= 1
                except Exception:
                    hit = False
            base_pct = 2 + 80.0 * done_frames / total_frames
            if hit:
                report(base_pct, f"Cảnh {n}/{len(scenes)} ({r['id']}): dùng lại bản đã render")
            else:
                def on_frames(done, total, _n=n, _r=r, _base=done_frames, _f=frames):
                    report(2 + 80.0 * (_base + _f * done / max(1, total)) / total_frames,
                           f"Cảnh {_n}/{len(scenes)} ({_r['id']}): khung {done}/{total}")
                _render_scene(project, r, cached, on_frames)
                info = mu.probe_media(cached)
                if abs(info["video"]["frames"] - frames) > 1:
                    raise RuntimeError(
                        f"Cảnh {r['id']}: video có {info['video']['frames']} khung, mong đợi {frames} "
                        f"({r['durationMs']}ms @ {fps}fps).")
            info = mu.probe_media(cached)
            done_frames += frames
            scene_videos.append(cached)
            scene_info.append({"id": r["id"], "durationMs": int(r["durationMs"]), "frames": info["video"]["frames"],
                               "cached": hit, "video": str(cached)})

        # 2) chuẩn hóa kích thước/fps/codec rồi nối
        report(83, "Chuẩn hóa và nối video")
        probes = [mu.probe_media(p)["video"] for p in scene_videos]
        size = project.get("outputSize") or {}
        tw = int(size.get("width") or probes[0]["width"]) // 2 * 2
        th = int(size.get("height") or probes[0]["height"]) // 2 * 2
        paper = _norm_color(project.get("paperColor")).lstrip("#")
        norm = []
        for i, (p, vi) in enumerate(zip(scene_videos, probes)):
            same = (vi["width"] == tw and vi["height"] == th and abs(vi["fps"] - fps) < 0.01
                    and vi["codec"] == "h264" and vi["pix_fmt"] == "yuv420p")
            if same:
                norm.append(p)
                continue
            dst = work / f"norm-{i:03d}.mp4"
            mu.run_ffmpeg(["-i", str(p), "-vf",
                           f"scale={tw}:{th}:force_original_aspect_ratio=decrease,"
                           f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=0x{paper},fps={fps},format=yuv420p",
                           "-c:v", "libx264", "-crf", "20", "-an", str(dst)], f"chuẩn hóa cảnh {scenes[i]['id']}")
            norm.append(dst)

        expected_frames = sum(frames_for(r["durationMs"], fps) for r in scenes)
        concat_video = work / "video.mp4"
        if len(norm) == 1:
            shutil.copyfile(norm[0], concat_video)
        else:
            lst = work / "video.txt"
            lst.write_text("".join("file '" + str(p.resolve()).replace("\\", "/").replace("'", "'\\''") + "'\n"
                                   for p in norm), encoding="utf-8")
            mu.run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(concat_video)], "nối video")

        # 3) audio theo cảnh → một luồng AAC
        modes = [_scene_audio(project, r["scene"]) for r in scenes]
        has_audio = any(m != "none" for m, _ in modes)
        partial = output.with_name(output.stem + ".partial" + (output.suffix or ".mp4"))
        if has_audio:
            report(88, "Dựng audio theo cảnh")
            wavs = []
            for i, (r, (mode, apath)) in enumerate(zip(scenes, modes)):
                d = scene_info[i]["frames"] / fps  # đúng bằng thời lượng thực của video cảnh
                wav = work / f"a-{i:03d}.wav"
                tail = ["-t", f"{d:.6f}", "-c:a", "pcm_s16le", "-ar", str(AUDIO_RATE), "-ac", "2", str(wav)]
                if mode == "none":
                    mu.run_ffmpeg(["-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=stereo", *tail], f"tạo im lặng cho {r['id']}")
                else:
                    s = r["timelineStartMs"] / 1000.0 if mode == "master" else 0.0
                    af = (f"aresample={AUDIO_RATE},aformat=sample_fmts=s16:channel_layouts=stereo,"
                          f"atrim=start={s:.6f}:end={s + d:.6f},asetpts=PTS-STARTPTS,apad=whole_dur={d:.6f}")
                    mu.run_ffmpeg(["-i", str(apath), "-af", af, *tail], f"dựng audio cho {r['id']}")
                wavs.append(wav)
            alst = work / "audio.txt"
            alst.write_text("".join("file '" + str(w.resolve()).replace("\\", "/").replace("'", "'\\''") + "'\n"
                                    for w in wavs), encoding="utf-8")
            all_wav = work / "audio.wav"
            mu.run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(alst), "-c", "copy", str(all_wav)], "nối audio")
            report(94, "Mux video + audio")
            mu.run_ffmpeg(["-i", str(concat_video), "-i", str(all_wav), "-map", "0:v:0", "-map", "1:a:0",
                           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
                           "-t", f"{expected_frames / fps:.6f}", str(partial)], "mux audio")
        else:
            shutil.copyfile(concat_video, partial)

        # 4) kiểm tra trước khi thay file chính
        report(97, "Kiểm tra đầu ra")
        final = mu.probe_media(partial)
        problems = []
        if not final["video"]:
            problems.append("thiếu luồng video")
        elif abs(final["video"]["frames"] - expected_frames) > 1:
            problems.append(f"số khung {final['video']['frames']} ≠ {expected_frames}")
        if has_audio:
            if not final["audio"]:
                problems.append("mất luồng audio")
            elif abs(final["duration_s"] - expected_frames / fps) > 0.15:
                problems.append(f"độ dài {final['duration_s']:.3f}s lệch {expected_frames / fps:.3f}s")
        if problems:
            partial.unlink(missing_ok=True)
            raise RuntimeError("Video xuất ra không đạt kiểm tra: " + "; ".join(problems))
        from whiteboard_ending import append_ending, ENDING_SECONDS
        ending_output = work / "with-ending.mp4"
        append_ending(str(partial), str(ending_output), project.get("endingImagePath"))
        os.replace(ending_output, partial)
        expected_frames += round(fps * ENDING_SECONDS)
        os.replace(partial, output)

        manifest = {
            "schemaVersion": SCHEMA_VERSION, "engineVersion": ENGINE_VERSION,
            "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "projectId": project.get("id"), "projectName": project.get("name"),
            "output": str(output), "fps": fps, "size": {"width": tw, "height": th},
            "totalFrames": expected_frames, "totalDurationMs": int(round(expected_frames * 1000 / fps)),
            "hasAudio": has_audio, "scenes": scene_info, "warnings": warnings,
            "ffmpeg": mu.find_ffmpeg(),
        }
        mpath = output.with_name(output.name + ".manifest.json")
        tmpm = mpath.with_name(mpath.name + ".tmp")
        tmpm.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmpm, mpath)
        report(100, "Hoàn tất")
        return manifest
    finally:
        if not keep_work:
            shutil.rmtree(work, ignore_errors=True)
