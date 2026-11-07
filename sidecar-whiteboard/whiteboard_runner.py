"""
Whiteboard Runner JSON-RPC cho Xitrum AI Studio
Chạy qua stdin / stdout (không mở HTTP port, tương tự sidecar-tts).

Hỗ trợ các action:
- ping: Kiểm tra sidecar sống
- parse_srt: Phân tích phụ đề SRT và gợi ý phân cảnh
- generate_annotation: Tách vùng từ ảnh line-art và sinh annotation.json (có thể ghi ra tệp)
- render_scene: Render hoạt hình bảng trắng vẽ tay từ ảnh line-art + annotation
- merge_scenes: Nối các video phân cảnh thành video MP4 hoàn chỉnh

Giao thức: mỗi yêu cầu là một dòng JSON trên stdin, mỗi phản hồi là đúng một dòng JSON trên
kênh giao thức. Kênh này là bản sao của stdout gốc (xem _isolate_protocol_channel); mọi thứ
khác ghi ra stdout (print, thư viện, tiến trình con như ffmpeg) bị chuyển sang stderr để không
làm hỏng giao thức.
"""

import sys
import os
import json
import math
import re
import traceback
from pathlib import Path

# Cố gắng đảm bảo UTF-8 cho stdout/stdin trên Windows
if sys.platform == "win32":
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Thêm đường dẫn scripts vào sys.path để import
CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Kênh giao thức JSON-RPC; None nghĩa là chưa cô lập (khi import làm thư viện/kiểm thử).
_PROTO = None

# Số vùng tối đa khi tự tách vùng mà không có phụ đề để giới hạn.
MAX_AUTO_REGIONS = 12


def _isolate_protocol_channel():
    """
    Giữ fd 1 gốc làm kênh JSON-RPC riêng rồi trỏ fd 1 sang stderr.
    Nhờ đó print() của các script render, cảnh báo của thư viện và đầu ra của tiến trình con
    (ffmpeg...) đều đi vào stderr, còn stdout gốc chỉ chứa các dòng JSON của giao thức.
    """
    global _PROTO
    try:
        sys.stdout.flush()
    except Exception:
        pass
    proto_fd = os.dup(1)
    os.dup2(2, 1)
    _PROTO = os.fdopen(proto_fd, "w", encoding="utf-8", newline="\n", buffering=1)
    sys.stdout = sys.stderr


def send_progress(task_id, percent, message=""):
    """Gửi sự kiện tiến độ (không phải phản hồi cuối): Rust chuyển tiếp lên giao diện."""
    send_json({"type": "progress", "task_id": task_id,
               "percent": max(0.0, min(100.0, float(percent))), "message": message})


def send_json(data):
    out = _PROTO if _PROTO is not None else sys.stdout
    out.write(json.dumps(data, ensure_ascii=False) + "\n")
    out.flush()


# ──────────────────────────────────────────────────────────────
# analyze_image_style (W3)
# ──────────────────────────────────────────────────────────────
def handle_analyze_image_style(req):
    import whiteboard_analyzer
    image_path = req.get("image_path")
    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Không tìm thấy ảnh: {image_path}")
    return whiteboard_analyzer.analyze_image_style(image_path)


# ──────────────────────────────────────────────────────────────
# parse_srt
# ──────────────────────────────────────────────────────────────
def handle_parse_srt(req):
    import parse_srt
    srt_path = req.get("srt_path")
    exact_cues = bool(req.get("exact_cues", False))
    target_sec = float(req.get("target_sec", 30.0))
    min_sec = float(req.get("min_sec", 25.0))
    max_sec = float(req.get("max_sec", 35.0))

    if not srt_path or not os.path.exists(srt_path):
        raise ValueError(f"Tệp SRT không tồn tại: {srt_path}")

    raw = Path(srt_path).read_text(encoding="utf-8-sig")
    cues = parse_srt.parse_srt(raw)
    if not cues:
        raise ValueError("Không tìm thấy dòng phụ đề nào trong tệp SRT.")

    if exact_cues:
        scenes = []
        n = len(cues)
        for idx, cue in enumerate(cues):
            start_ms = 0 if idx == 0 else cue["startMs"]
            end_ms = cue["endMs"] if idx == n - 1 else cues[idx + 1]["startMs"]
            scenes.append({
                "sceneIndex": idx + 1,
                "startMs": cue["startMs"],
                "endMs": cue["endMs"],
                "timelineStartMs": start_ms,
                "timelineEndMs": end_ms,
                "sceneDurationMs": max(1000, end_ms - start_ms),
                "belowMin": False,
                "aboveMax": False,
                "cueRange": [cue["index"], cue["index"]],
                "text": cue["text"]
            })
    else:
        scenes = parse_srt.group_scenes(cues, target_sec, min_sec, max_sec)

    return {"cues": cues, "scenes": scenes}


# ──────────────────────────────────────────────────────────────
# generate_annotation: tách vùng thật từ ảnh line-art
# ──────────────────────────────────────────────────────────────
def _box_area(b):
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _box_inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0


def _box_union(a, b):
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def _box_gap(a, b):
    dx = max(0, a[0] - b[2], b[0] - a[2])
    dy = max(0, a[1] - b[3], b[1] - a[3])
    return math.hypot(dx, dy)


def _merge_overlapping(boxes, ratio=0.25):
    """
    Gộp các hộp chồng nhau đáng kể (phần giao >= ratio diện tích hộp nhỏ hơn). Bộ render trừ vùng
    của các phần tử SAU khỏi vùng của phần tử TRƯỚC, nên một hộp nằm trọn trong hộp khác sẽ bị
    mask rỗng; gộp trước để điều đó không xảy ra.
    """
    boxes = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                small = min(_box_area(boxes[i]), _box_area(boxes[j]))
                if small > 0 and _box_inter(boxes[i], boxes[j]) / small >= ratio:
                    boxes[i] = _box_union(boxes[i], boxes[j])
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    return boxes


def _merge_closest(boxes):
    """Gộp cặp hộp gần nhau nhất (khoảng cách giữa hai hộp, hòa thì xét khoảng cách tâm)."""
    best = None
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            a, b = boxes[i], boxes[j]
            center = math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2)
            key = (_box_gap(a, b), center)
            if best is None or key < best[0]:
                best = (key, i, j)
    _, i, j = best
    out = [b for k, b in enumerate(boxes) if k not in (i, j)]
    out.append(_box_union(boxes[i], boxes[j]))
    return out


def _detect_ink_boxes(img_bgr):
    """
    Tìm các cụm nét mực riêng biệt: lấy màu nền từ bốn góc, đánh dấu pixel khác nền, giãn nở để
    nối các nét gần nhau, rồi lấy hộp bao của từng thành phần liên thông.
    """
    import cv2
    import numpy as np

    h, w = img_bgr.shape[:2]
    p = max(4, min(h, w) // 50)
    corners = np.concatenate([
        img_bgr[:p, :p].reshape(-1, 3),
        img_bgr[:p, w - p:].reshape(-1, 3),
        img_bgr[h - p:, :p].reshape(-1, 3),
        img_bgr[h - p:, w - p:].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0).astype(np.int16)
    diff = np.abs(img_bgr.astype(np.int16) - bg).sum(axis=2)
    ink = (diff > 48).astype(np.uint8)

    k = max(3, int(round(max(h, w) * 0.03)))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    blobs = cv2.dilate(ink, kernel)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(blobs, connectivity=8)
    ink_count = np.bincount(labels[ink > 0], minlength=n)
    min_ink = max(20, int(0.0005 * h * w))
    boxes = []
    for i in range(1, n):
        if ink_count[i] < min_ink:
            continue
        x, y, bw, bh = (int(stats[i, c]) for c in range(4))
        boxes.append([x, y, x + bw, y + bh])
    return boxes


def _reading_order(boxes, height):
    """Sắp theo thứ tự đọc: gom thành hàng theo tâm dọc, trong hàng đi từ trái sang phải."""
    tol = 0.2 * height
    rows = []
    for b in sorted(boxes, key=lambda b: (b[1] + b[3]) / 2):
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - rows[-1]["cy"]) <= tol:
            row = rows[-1]
            row["items"].append(b)
            row["cy"] = sum((x[1] + x[3]) / 2 for x in row["items"]) / len(row["items"])
        else:
            rows.append({"cy": cy, "items": [b]})
    ordered = []
    for row in rows:
        ordered.extend(sorted(row["items"], key=lambda b: b[0]))
    return ordered


def _chunk(seq, k):
    """Chia seq thành k đoạn liên tiếp, kích thước chênh nhau tối đa 1 (yêu cầu k <= len(seq))."""
    base, extra = divmod(len(seq), k)
    out, i = [], 0
    for j in range(k):
        size = base + (1 if j < extra else 0)
        out.append(seq[i:i + size])
        i += size
    return out


def _has_timing(c):
    return (isinstance(c, dict)
            and isinstance(c.get("startMs"), (int, float))
            and isinstance(c.get("endMs"), (int, float)))


def _plan_timing(k, cue_chunks, duration_ms, weights=None):
    """Finish drawing before speech ends; fall back to a weighted scene budget.

    A short scene must never be extended merely to satisfy a minimum stroke time.
    Weights approximate complexity by region size, not equal time per rectangle.
    """
    if k <= 0:
        return []
    duration_ms = max(1, int(duration_ms))
    timed = bool(cue_chunks) and all(chunk and all(_has_timing(c) for c in chunk) for chunk in cue_chunks)
    if timed:
        first = cue_chunks[0][0]["startMs"]
        last = max(c["endMs"] for chunk in cue_chunks for c in chunk)
        base = 0 if first >= 0 and last <= duration_ms else first
        spans = [(int(ch[0]["startMs"]-base),
                  int((ch[-1].get("speechEndMs") if ch[-1].get("speechEndMs") is not None else ch[-1]["endMs"]-1000)-base)) for ch in cue_chunks]
        if (len(spans) == k and all(0 <= start < end <= duration_ms for start,end in spans)
                and all(spans[i][1] <= spans[i+1][0] for i in range(k-1))):
            return [(start, max(1, end-start-min(500, max(0, (end-start)//4)))) for start,end in spans]
    lead = min(100, duration_ms//10)
    # No measured speech: reserve one second reaction + half second ahead of speech end.
    end = max(lead+1, duration_ms-min(1500, duration_ms//4))
    usable = end-lead
    ws = weights if weights and len(weights) == k else [1]*k
    ws = [max(0.001, float(w)) for w in ws]
    total = sum(ws)
    starts, cumulative = [], 0.0
    for w in ws:
        start = lead+int(usable*cumulative/total)
        cumulative += w
        stop = min(duration_ms, lead+int(usable*cumulative/total))
        starts.append((min(start,duration_ms-1), max(1,stop-start)))
    return starts


def _build_elements(boxes, width, height, cue_chunks, duration_ms):
    k = len(boxes)
    timing = _plan_timing(k, cue_chunks, duration_ms,
                          [math.sqrt(max(1, (x1-x0)*(y1-y0))) for x0,y0,x1,y1 in boxes])
    elements = []
    for i, box in enumerate(boxes):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        wide = w >= h
        start_ms, dur_ms = timing[i]
        subtitle = " ".join(str(c.get("text", "")) if isinstance(c, dict) else str(c)
                            for c in (cue_chunks[i] if cue_chunks else [])).strip()
        elements.append({
            "id": f"elem_{i + 1}",
            "label": f"Vùng {i + 1}",
            "sequence": i + 1,
            "narrativeRole": "Vùng tự động theo thứ tự đọc; hãy chỉnh lại theo cốt truyện",
            "subtitle": subtitle,
            "type": "object",
            "region": {"x": x0, "y": y0, "width": w, "height": h},
            "reveal": {
                "direction": "left_to_right" if wide else "top_to_bottom",
                "startMs": start_ms,
                "durationMs": dur_ms,
                "maskPaddingPx": 16,
                "protectedRegions": [],
            },
            "handPath": {
                "start": [x0, y0 + h // 2] if wide else [x0 + w // 2, y0],
                "end": [x1, y0 + h // 2] if wide else [x0 + w // 2, y1],
                "easing": "easeInOut",
            },
        })
    return elements


def handle_generate_annotation(req):
    import stream_render as sr

    image_path = req.get("image_path")
    scene_id = req.get("scene_id") or "scene-01"
    story_basis = req.get("story_basis", "")
    duration_ms = int(req.get("duration_ms", 10000))
    raw_cues = req.get("cues") or []
    output_path = req.get("output_path")
    overwrite = bool(req.get("overwrite", False))

    if output_path and os.path.exists(output_path) and not overwrite:
        # Không ghi đè âm thầm annotation người dùng có thể đã chỉnh tay.
        raise ValueError(f"ANNOTATION_EXISTS: {output_path}")
    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Ảnh không tồn tại: {image_path}")

    img = sr._imread_any(image_path)
    if img is None:
        raise ValueError(f"Không đọc được ảnh: {image_path}")
    height, width = img.shape[:2]

    cues = [c if isinstance(c, dict) else {"text": str(c)} for c in raw_cues]

    # W4: Tách vùng thông minh (Component Ordering & Smart Segmentation)
    import whiteboard_segmenter
    limit = min(len(cues), MAX_AUTO_REGIONS) if cues else MAX_AUTO_REGIONS
    segmented = whiteboard_segmenter.segment_and_order_regions(img, max_regions=limit, cues_count=len(cues))
    boxes = [s["box"] for s in segmented]

    cue_chunks = _chunk(cues, len(boxes)) if cues else []
    import whiteboard_schema
    raw_annotation = {
        "schemaVersion": whiteboard_schema.CURRENT_SCHEMA_VERSION,
        "sceneId": scene_id,
        "canvas": {"width": width, "height": height},
        "storyBasis": story_basis,
        "sceneDurationMs": duration_ms,
        "elements": _build_elements(boxes, width, height, cue_chunks, duration_ms),
    }
    annotation, _ = whiteboard_schema.adapt_and_validate_annotation(raw_annotation)

    result = dict(annotation)
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        tmp_path = output_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(annotation, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, output_path)
        result["savedTo"] = output_path
    return result


# ──────────────────────────────────────────────────────────────
# render_scene / merge_scenes
# ──────────────────────────────────────────────────────────────
def _normalize_paper_color(value):
    v = (value or "#F5EBD7").strip()
    if re.fullmatch(r"[0-9A-Fa-f]{6}", v):
        v = "#" + v
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", v):
        raise ValueError(f"Màu nền giấy không hợp lệ: {value!r} (cần dạng #RRGGBB)")
    return v.upper()


def resolve_render_settings(req):
    image_path = req.get("image_path")
    fps = int(req.get("fps", 30))
    paper_color = _normalize_paper_color(req.get("paper_color"))
    hand_path = req.get("hand_path")
    ink_path = req.get("ink_path")
    color_fill = req.get("color_fill")
    ink_weight = req.get("ink_weight")
    color_weight = req.get("color_weight")
    # W3: Nếu chưa chỉ định rõ ink_path hoặc color_fill, tự động phân tích ảnh
    if not ink_path or not color_fill:
        try:
            import whiteboard_analyzer
            style_info = whiteboard_analyzer.resolve_scene_style(
                image_path,
                user_override={"inkPath": ink_path, "colorFill": color_fill, "inkWeight": ink_weight, "colorWeight": color_weight}
            )["resolved"]
            ink_path = style_info["inkPath"]
            color_fill = style_info["colorFill"]
            ink_weight = style_info["inkWeight"]
            color_weight = style_info["colorWeight"]
        except Exception:
            pass

    if not 1 <= fps <= 120:
        raise ValueError(f"FPS không hợp lệ: {fps} (cần từ 1 đến 120)")

    if not hand_path or hand_path == "pen" or hand_path == "default":
        default_hand = CURRENT_DIR / "assets" / "drawing-hand.png"
        if default_hand.exists():
            hand_path = str(default_hand)
    elif hand_path == "brush" or hand_path == "calligraphy" or hand_path == "calligraphy-brush":
        brush_hand = CURRENT_DIR / "assets" / "calligraphy-brush.png"
        if brush_hand.exists():
            hand_path = str(brush_hand)
    elif not os.path.isabs(hand_path):
        candidate = CURRENT_DIR / "assets" / hand_path
        if candidate.exists():
            hand_path = str(candidate)

    ink_path = ink_path or "grid"
    color_fill = color_fill or "contour-wipe"
    ink_weight = float(ink_weight if ink_weight is not None else 2)
    color_weight = float(color_weight if color_weight is not None else 1)
    if color_fill == "none":
        ink_weight, color_weight = 1.0, 0.0
    return dict(image_path=image_path, annotation_path=req.get("annotation_path"),
                fps=fps, paper_color=paper_color, hand_path=hand_path,
                subject_first=bool(req.get("subject_first", False)),
                audio_path=req.get("audio_path"), duration_ms=req.get("duration_ms"),
                ink_path=ink_path, color_fill=color_fill,
                ink_weight=ink_weight, color_weight=color_weight)


def handle_render_scene(req):
    import render_stream_whiteboard
    import whiteboard_audio

    image_path = req.get("image_path")
    annotation_path = req.get("annotation_path")
    output_path = req.get("output_path")
    fps = int(req.get("fps", 30))
    paper_color = _normalize_paper_color(req.get("paper_color"))
    hand_path = req.get("hand_path")
    audio_path = req.get("audio_path")  # Tuỳ chọn: audio riêng cho cảnh này
    ink_path = req.get("ink_path")
    color_fill = req.get("color_fill")
    ink_weight = req.get("ink_weight")
    color_weight = req.get("color_weight")

    effective = resolve_render_settings(req)
    hand_path = effective["hand_path"]
    ink_path, color_fill = effective["ink_path"], effective["color_fill"]
    ink_weight, color_weight = effective["ink_weight"], effective["color_weight"]
    if audio_path:
        whiteboard_audio.validate_audio_file(audio_path)

    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Không tìm thấy ảnh gốc: {image_path}")
    if not annotation_path or not os.path.exists(annotation_path):
        raise ValueError(f"Không tìm thấy tệp annotation: {annotation_path}")
    if not output_path:
        raise ValueError("Chưa chỉ định output_path cho video render.")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Nếu có audio_path, render video vào file tạm video-only trước rồi mux audio
    actual_render_out = output_path
    temp_video_only = None
    if audio_path and os.path.exists(audio_path):
        temp_video_only = output_path + ".v_only.mp4"
        actual_render_out = temp_video_only

    cmd_args = [image_path, annotation_path, actual_render_out]
    if hand_path and os.path.exists(hand_path):
        cmd_args.append(hand_path)
    cmd_args += ["--fps", str(fps), "--paper-color", paper_color]
    if effective["subject_first"]:
        cmd_args.append("--subject-first")
    duration_ms = req.get("duration_ms")
    if duration_ms is not None and int(duration_ms) > 0:
        cmd_args += ["--total-ms", str(int(duration_ms))]
    if ink_path:
        cmd_args += ["--ink-path", str(ink_path)]
    if color_fill:
        cmd_args += ["--color-fill", str(color_fill)]
    if ink_weight is not None:
        cmd_args += ["--ink-weight", str(ink_weight)]
    if color_weight is not None:
        cmd_args += ["--color-weight", str(color_weight)]

    task_id = req.get("task_id", "")
    last = [-1.0, 0.0]  # phần trăm, thời điểm gửi gần nhất

    def on_progress(done, total):
        import time
        pct = 100.0 * done / total if total else 0.0
        now = time.monotonic()
        # Giới hạn tần suất: tối đa ~5 sự kiện/giây và chỉ khi phần trăm đổi đáng kể
        if pct - last[0] >= 0.5 and now - last[1] >= 0.2 or done >= total:
            last[0], last[1] = pct, now
            send_progress(task_id, pct * 0.95, f"Đang vẽ khung hình {done}/{total}")

    send_progress(task_id, 0, "Bắt đầu render")
    render_stream_whiteboard.PROGRESS_CALLBACK = on_progress
    try:
        ret_code = render_stream_whiteboard.main(cmd_args)
    finally:
        render_stream_whiteboard.PROGRESS_CALLBACK = None
    if ret_code != 0:
        raise RuntimeError(f"Render bảng trắng thất bại, exit code: {ret_code}")

    # Nếu có audio, mux vào video đầu ra chính
    if temp_video_only and os.path.exists(temp_video_only):
        send_progress(task_id, 98, "Đang gắn âm thanh phân cảnh")
        ok = whiteboard_audio.mux_video_and_audio(temp_video_only, audio_path, output_path)
        try:
            os.remove(temp_video_only)
        except Exception:
            pass
        if not ok:
            raise RuntimeError(f"Gắn âm thanh thất bại cho {output_path}")

    # Ghi manifest cache sau khi hoàn tất thành công (R1)
    try:
        import whiteboard_cache
        fp = whiteboard_cache.calculate_scene_fingerprint(**effective)
        whiteboard_cache.write_scene_manifest(output_path, fp, extra={"taskId": task_id})
    except Exception as e:
        print(f"[warn] Lỗi ghi manifest cache cho {output_path}: {e}", file=sys.stderr)

    send_progress(task_id, 100, "Hoàn tất")

    return {
        "output_path": output_path,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0
    }


def handle_merge_scenes(req):
    import merge_scenes
    import whiteboard_audio
    video_paths = req.get("video_paths", [])
    output_path = req.get("output_path")
    master_audio_path = req.get("master_audio_path")  # Tuỳ chọn: master audio cho cả bài

    if master_audio_path:
        whiteboard_audio.validate_audio_file(master_audio_path)

    if not video_paths or len(video_paths) == 0:
        raise ValueError("Danh sách video phân cảnh rỗng.")
    if not output_path:
        raise ValueError("Chưa chỉ định output_path cho video ghép.")
    missing = [p for p in video_paths if not os.path.exists(p)]
    if missing:
        raise ValueError(f"Thiếu video phân cảnh: {', '.join(missing)}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    import tempfile
    cover_png = req.get("thumbnail_png")
    # Mux master before prepending the cover so BOTH master and per-scene audio shift 2s.
    with tempfile.TemporaryDirectory(prefix="wb-merge-", dir=os.path.dirname(os.path.abspath(output_path))) as tmp:
        concat_out = os.path.join(tmp, "concat.mp4")
        cmd_args = ["--inputs", *video_paths, "--output", concat_out]
        ret_code = merge_scenes.main(cmd_args)
        if ret_code != 0:
            raise RuntimeError(f"Ghép các phân cảnh thất bại, exit code: {ret_code}")
        body_out = concat_out
        if master_audio_path:
            body_out = os.path.join(tmp, "body.mp4")
            if not whiteboard_audio.mux_video_and_audio(concat_out, master_audio_path, body_out):
                raise RuntimeError(f"Gắn master audio thất bại: {output_path}")
        if cover_png:
            from whiteboard_thumbnail import prepend_thumbnail
            send_progress(req.get("task_id", ""), 97, "Đang chèn thumbnail 2 giây đầu...")
            prepend_thumbnail(body_out, cover_png, output_path)
        else:
            os.replace(body_out, output_path)

    return {
        "output_path": output_path,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0
    }


# ──────────────────────────────────────────────────────────────
# check_env: chỉ dùng thư viện chuẩn để vẫn chạy được khi thiếu phụ thuộc
# ──────────────────────────────────────────────────────────────
ENV_DEPS = {"cv2": "opencv-python", "numpy": "numpy", "av": "av", "PIL": "Pillow"}


def handle_check_env(req):
    import importlib.util
    import shutil
    missing = [pip for mod, pip in ENV_DEPS.items() if importlib.util.find_spec(mod) is None]
    return {
        "ok": not missing,
        "python": sys.executable,
        "pythonVersion": sys.version.split()[0],
        "missing": missing,
        "ffmpeg": shutil.which("ffmpeg"),
    }


def handle_verify_cache(req):
    import whiteboard_cache
    video_path = req.get("video_path")
    expected_fingerprint = req.get("expected_fingerprint")
    if not video_path or not expected_fingerprint:
        return {"valid": False}
    valid = whiteboard_cache.verify_scene_cache(video_path, expected_fingerprint)
    return {"valid": valid}


def handle_get_fingerprint(req):
    import whiteboard_cache
    fp = whiteboard_cache.calculate_scene_fingerprint(**resolve_render_settings(req))
    return {"fingerprint": fp}


def handle_render_preview(req):
    import render_annotation_preview
    image_path = req.get("image_path")
    annotation_path = req.get("annotation_path")
    output_path = req.get("output_path")
    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Không tìm thấy ảnh gốc: {image_path}")
    if not annotation_path or not os.path.exists(annotation_path):
        raise ValueError(f"Không tìm thấy annotation: {annotation_path}")
    if not output_path:
        raise ValueError("Chưa chỉ định output_path cho preview")
    render_annotation_preview.main(image_path, annotation_path, output_path)
    return {"preview_path": output_path, "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0}


HANDLERS = {
    "check_env": handle_check_env,
    "analyze_image_style": handle_analyze_image_style,
    "parse_srt": handle_parse_srt,
    "generate_annotation": handle_generate_annotation,
    "render_scene": handle_render_scene,
    "merge_scenes": handle_merge_scenes,
    "verify_cache": handle_verify_cache,
    "get_fingerprint": handle_get_fingerprint,
    "render_preview": handle_render_preview,
}


def main():
    _isolate_protocol_channel()
    send_json({"type": "ready", "message": "Whiteboard-Animation Runner Ready (stdin/stdout JSON-RPC)"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            action = req.get("action")
            task_id = req.get("task_id", "")

            if action == "ping":
                send_json({"type": "pong", "task_id": task_id, "status": "ok"})
            elif action in HANDLERS:
                result = HANDLERS[action](req)
                send_json({"type": "done", "task_id": task_id, "action": action, "data": result})
            elif action == "exit":
                break
            else:
                send_json({"type": "error", "task_id": task_id, "message": f"Action không hợp lệ: {action}"})

        # SystemExit (ví dụ argparse báo sai tham số) không phải Exception: nếu không bắt, cả
        # runner chết mà phía Rust không nhận được thông báo lỗi nào.
        except (Exception, SystemExit) as e:
            if isinstance(e, SystemExit):
                message = f"Script con thoát với mã {e.code} (thường do tham số dòng lệnh không hợp lệ)"
            else:
                message = str(e)
            send_json({
                "type": "error",
                "task_id": req.get("task_id", "") if isinstance(req, dict) else "",
                "message": message,
                "traceback": traceback.format_exc(),
            })


if __name__ == "__main__":
    main()
