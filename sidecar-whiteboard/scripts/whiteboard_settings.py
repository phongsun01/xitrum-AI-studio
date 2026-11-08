"""Cài đặt render cảnh dùng chung cho runner (render_scene) và project_export (dự án V1),
để hai đường render cho cùng một hình ảnh với cùng một cấu hình."""
from __future__ import annotations

import os
import re
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"


def normalize_paper_color(value):
    v = (value or "#F5EBD7").strip()
    if re.fullmatch(r"[0-9A-Fa-f]{6}", v):
        v = "#" + v
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", v):
        raise ValueError(f"Màu nền giấy không hợp lệ: {value!r} (cần dạng #RRGGBB)")
    return v.upper()


def resolve_render_settings(req):
    image_path = req.get("image_path")
    fps = int(req.get("fps", 30))
    paper_color = normalize_paper_color(req.get("paper_color"))
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
        default_hand = ASSETS_DIR / "drawing-hand.png"
        if default_hand.exists():
            hand_path = str(default_hand)
    elif hand_path == "brush" or hand_path == "calligraphy" or hand_path == "calligraphy-brush":
        brush_hand = ASSETS_DIR / "calligraphy-brush.png"
        if brush_hand.exists():
            hand_path = str(brush_hand)
    elif not os.path.isabs(hand_path):
        candidate = ASSETS_DIR / hand_path
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
