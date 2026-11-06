"""
Whiteboard Runner JSON-RPC cho Xitrum AI Studio
Chạy qua stdin / stdout (không mở HTTP port, tương tự sidecar-tts).

Hỗ trợ các action:
- ping: Kiểm tra sidecar sống
- parse_srt: Phân tích phụ đề SRT và gợi ý phân cảnh
- generate_annotation_template: Sinh khung annotation.json mẫu từ kích thước ảnh
- render_scene: Render hoạt hình bảng trắng vẽ tay từ ảnh line-art + annotation
- merge_scenes: Nối các video phân cảnh thành video MP4 hoàn chỉnh
"""

import sys
import os
import json
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


def send_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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


def handle_generate_annotation(req):
    from PIL import Image
    image_path = req.get("image_path")
    scene_id = req.get("scene_id", "scene-01")
    story_basis = req.get("story_basis", "")
    duration_ms = int(req.get("duration_ms", 10000))
    cues = req.get("cues", [])

    if not image_path or not os.path.exists(image_path):
        raise ValueError(f"Ảnh không tồn tại: {image_path}")

    with Image.open(image_path) as im:
        width, height = im.size

    # Nếu có danh sách cues, tự động chia đều các phần tử
    elements = []
    if cues and len(cues) > 0:
        step_ms = duration_ms // len(cues)
        for idx, cue in enumerate(cues):
            start_ms = idx * step_ms
            dur_ms = max(step_ms - 200, 1000)
            elements.append({
                "id": f"elem_{idx+1}",
                "label": f"Phần {idx+1}",
                "sequence": idx + 1,
                "narrativeRole": f"Phân cảnh minh họa {idx+1}",
                "subtitle": cue.get("text", "") if isinstance(cue, dict) else str(cue),
                "type": "character" if idx % 2 == 0 else "action",
                "region": {
                    "x": 40,
                    "y": 40,
                    "width": max(width - 80, 100),
                    "height": max(height - 80, 100),
                },
                "reveal": {
                    "direction": "left_to_right",
                    "startMs": start_ms,
                    "durationMs": dur_ms,
                    "maskPaddingPx": 16,
                    "protectedRegions": []
                },
                "handPath": {
                    "start": [50, 50],
                    "end": [width - 50, height - 50],
                    "easing": "easeInOut"
                }
            })
    else:
        # 1 element mặc định toàn khung hình
        elements.append({
            "id": "elem_full",
            "label": "Toàn cảnh minh họa",
            "sequence": 1,
            "narrativeRole": "Minh họa trọng tâm",
            "subtitle": story_basis,
            "type": "structure",
            "region": {
                "x": 20,
                "y": 20,
                "width": max(width - 40, 100),
                "height": max(height - 40, 100),
            },
            "reveal": {
                "direction": "top_to_bottom",
                "startMs": 200,
                "durationMs": max(duration_ms - 600, 2000),
                "maskPaddingPx": 16,
                "protectedRegions": []
            },
            "handPath": {
                "start": [width // 2, 50],
                "end": [width // 2, height - 50],
                "easing": "easeInOut"
            }
        })

    annotation = {
        "sceneId": scene_id,
        "canvas": {"width": width, "height": height},
        "storyBasis": story_basis,
        "sceneDurationMs": duration_ms,
        "elements": elements
    }
    return annotation


def handle_render_scene(req):
    import render_stream_whiteboard

    image_path = req.get("image_path")
    annotation_path = req.get("annotation_path")
    output_path = req.get("output_path")
    fps = int(req.get("fps", 30))
    paper_color = req.get("paper_color", "#F5EBD7")
    hand_path = req.get("hand_path")

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

    # Gọi hàm render của render_stream_whiteboard
    # parse arguments giả lập cho main_render
    cmd_args = [
        image_path,
        "--annotation", annotation_path,
        "-o", output_path,
        "--fps", str(fps),
        "--paper-color", paper_color,
    ]
    if hand_path and os.path.exists(hand_path):
        cmd_args.extend(["--hand-image", hand_path])

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

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    cmd_args = ["-o", output_path] + video_paths
    ret_code = merge_scenes.main(cmd_args)
    if ret_code != 0:
        raise RuntimeError(f"Ghép các phân cảnh thất bại, exit code: {ret_code}")

    return {
        "output_path": output_path,
        "file_size": os.path.getsize(output_path) if os.path.exists(output_path) else 0
    }


def main():
    send_json({"type": "ready", "message": "Whiteboard-Animation Runner Ready (stdin/stdout JSON-RPC)"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            action = req.get("action")
            task_id = req.get("task_id", "")

            if action == "ping":
                send_json({"type": "pong", "task_id": task_id, "status": "ok"})

            elif action == "parse_srt":
                result = handle_parse_srt(req)
                send_json({"type": "done", "task_id": task_id, "action": action, "data": result})

            elif action == "generate_annotation":
                result = handle_generate_annotation(req)
                send_json({"type": "done", "task_id": task_id, "action": action, "data": result})

            elif action == "render_scene":
                result = handle_render_scene(req)
                send_json({"type": "done", "task_id": task_id, "action": action, "data": result})

            elif action == "merge_scenes":
                result = handle_merge_scenes(req)
                send_json({"type": "done", "task_id": task_id, "action": action, "data": result})

            elif action == "exit":
                break

            else:
                send_json({"type": "error", "task_id": task_id, "message": f"Action không hợp lệ: {action}"})

        except Exception as e:
            tb = traceback.format_exc()
            send_json({
                "type": "error",
                "task_id": req.get("task_id", "") if 'req' in locals() and isinstance(req, dict) else "",
                "message": str(e),
                "traceback": tb
            })


if __name__ == "__main__":
    main()

