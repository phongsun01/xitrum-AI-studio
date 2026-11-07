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


def send_json(data):
    out = _PROTO if _PROTO is not None else sys.stdout
    out.write(json.dumps(data, ensure_ascii=False) + "\n")
    out.flush()


# ──────────────────────────────────────────────────────────────
# parse_srt
# ──────────────────────────────────────────────────────────────
def handle_parse_srt(req):
    import parse_srt
    srt_path = req.get("srt_path")
    target_sec = float(req.get("target_sec", 30.0))
    min_sec = float(req.get("min_sec", 25.0))
    max_sec = float(req.get("max_sec", 35.0))

    if not srt_path or not os.path.exists(srt_path):
        raise ValueError(f"Tệp SRT không tồn tại: {srt_path}")

    raw = Path(srt_path).read_text(encoding="utf-8-sig")
    cues = parse_srt.parse_srt(raw)
    if not cues:
        raise ValueError("Không tìm thấy dòng phụ đề nào trong tệp SRT.")

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


def _plan_timing(k, cue_chunks, duration_ms):
    """
    Trả về [(startMs, durationMs)] cho k phần tử, vẽ lần lượt (stream chỉ có một đầu bút).
    Dùng mốc thời gian của phụ đề khi hợp lệ và nằm trong thời lượng cảnh; nếu không thì chia đều.
    """
    if cue_chunks and all(_has_timing(c) for chunk in cue_chunks for c in chunk):
        base = cue_chunks[0][0]["startMs"]
        spans = [(int(ch[0]["startMs"] - base), int(ch[-1]["endMs"] - base)) for ch in cue_chunks]
        in_order = all(spans[i][1] <= spans[i + 1][0] + 1 for i in range(k - 1))
        if in_order and all(e > s for s, e in spans) and spans[-1][1] <= duration_ms:
            return [(s, max(e - s - 100, 600)) for s, e in spans]

    lead, tail = 200, 500
    step = max(duration_ms - lead - tail, 1000) / k
    return [(int(lead + i * step), max(int(step * 0.9), 500)) for i in range(k)]


def _build_elements(boxes, width, height, cue_chunks, duration_ms):
    k = len(boxes)
    timing = _plan_timing(k, cue_chunks, duration_ms)
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

    boxes = _merge_overlapping(_detect_ink_boxes(img))
    limit = min(len(cues), MAX_AUTO_REGIONS) if cues else MAX_AUTO_REGIONS
    while len(boxes) > max(limit, 1):
        boxes = _merge_overlapping(_merge_closest(boxes))

    if boxes:
        pad = max(6, int(round(0.012 * max(width, height))))
        boxes = [[max(0, b[0] - pad), max(0, b[1] - pad),
                  min(width, b[2] + pad), min(height, b[3] + pad)] for b in boxes]
        boxes = _reading_order(boxes, height)
    else:
        # Ảnh trống hoặc không tách được nét mực: dùng một vùng toàn khung.
        boxes = [[0, 0, width, height]]

    cue_chunks = _chunk(cues, len(boxes)) if cues else []
    annotation = {
        "sceneId": scene_id,
        "canvas": {"width": width, "height": height},
        "storyBasis": story_basis,
        "sceneDurationMs": duration_ms,
        "elements": _build_elements(boxes, width, height, cue_chunks, duration_ms),
    }

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


def handle_render_scene(req):
    import render_stream_whiteboard

    image_path = req.get("image_path")
    annotation_path = req.get("annotation_path")
    output_path = req.get("output_path")
    fps = int(req.get("fps", 30))
    paper_color = _normalize_paper_color(req.get("paper_color"))
    hand_path = req.get("hand_path")

    if not 1 <= fps <= 120:
        raise ValueError(f"FPS không hợp lệ: {fps} (cần từ 1 đến 120)")

    if not hand_path:
        default_hand = CURRENT_DIR / "assets" / "drawing-hand.png"
        if default_hand.exists():
            hand_path = str(default_hand)

    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Không tìm thấy ảnh gốc: {image_path}")
    if not annotation_path or not os.path.exists(annotation_path):
        raise ValueError(f"Không tìm thấy tệp annotation: {annotation_path}")
    if not output_path:
        raise ValueError("Chưa chỉ định output_path cho video render.")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Khớp với CLI của render_stream_whiteboard.py: image annotation output [hand] [tuỳ chọn].
    # Tham số vị trí "hand" phải đứng ngay sau output, trước các tuỳ chọn --xxx.
    cmd_args = [image_path, annotation_path, output_path]
    if hand_path and os.path.exists(hand_path):
        cmd_args.append(hand_path)
    cmd_args += ["--fps", str(fps), "--paper-color", paper_color]

    ret_code = render_stream_whiteboard.main(cmd_args)
    if ret_code != 0:
        raise RuntimeError(f"Render bảng trắng thất bại, exit code: {ret_code}")

    return {
        "output_path": output_path,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0
    }


def handle_merge_scenes(req):
    import merge_scenes
    video_paths = req.get("video_paths", [])
    output_path = req.get("output_path")

    if not video_paths or len(video_paths) == 0:
        raise ValueError("Danh sách video phân cảnh rỗng.")
    if not output_path:
        raise ValueError("Chưa chỉ định output_path cho video ghép.")
    missing = [p for p in video_paths if not os.path.exists(p)]
    if missing:
        raise ValueError(f"Thiếu video phân cảnh: {', '.join(missing)}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Khớp với CLI của merge_scenes.py: --inputs ... --output ...
    cmd_args = ["--inputs", *video_paths, "--output", output_path]
    ret_code = merge_scenes.main(cmd_args)
    if ret_code != 0:
        raise RuntimeError(f"Ghép các phân cảnh thất bại, exit code: {ret_code}")

    return {
        "output_path": output_path,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0
    }


HANDLERS = {
    "parse_srt": handle_parse_srt,
    "generate_annotation": handle_generate_annotation,
    "render_scene": handle_render_scene,
    "merge_scenes": handle_merge_scenes,
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
