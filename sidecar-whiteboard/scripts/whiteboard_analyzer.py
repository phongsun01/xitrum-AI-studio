#!/usr/bin/env python3
"""
whiteboard_analyzer.py - Nhận diện phân loại ảnh & chọn phong cách vẽ tự động (W3)

Phân loại ảnh thành các nhóm chuẩn:
  - line_art_mono: Ảnh nét vẽ đơn sắc (trắng đen/line art), không có mảng tô màu
  - filled_mono: Ảnh nét vẽ có mảng đen/xám tô đậm
  - colored: Ảnh có màu sắc (tranh màu 2D, minh họa màu)
  - blank: Ảnh rỗng/nền trắng không có nội dung
  - uncertain: Chưa xác định rõ, đề xuất người dùng chọn

Tự động gán phong cách:
  - line_art_mono: ink_path='skeleton' (hoặc 'grid'), color_fill='none', ink_weight=1.0, color_weight=0.0
  - filled_mono:   ink_path='grid', color_fill='brush', ink_weight=0.6, color_weight=0.4
  - colored:       ink_path='grid', color_fill='contour-wipe', ink_weight=0.4, color_weight=0.6
"""

from __future__ import annotations
import os
import cv2
import numpy as np
from pathlib import Path
from typing import Dict, Any, Tuple

import whiteboard_image


def analyze_image_style(image_path: str, canvas_hex: str = "#F5EBD7") -> Dict[str, Any]:
    """
    Phân tích đặc tính hình ảnh và gợi ý style vẽ/tô tối ưu.
    Sử dụng whiteboard_image để xử lý kênh alpha và nền an toàn.
    """
    bgr, alpha = whiteboard_image.load_normalized_image(image_path, paper_color_hex=canvas_hex, min_dimension=16)

    h, w = bgr.shape[:2]
    total_pixels = h * w

    # Chuyển đổi sang các không gian màu
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]  # Độ bão hòa màu (Saturation)

    # 1. Phát hiện màu nền (Background Estimation)
    # Lấy mẫu 4 góc và viền biên để ước lượng màu giấy nền
    c1 = bgr[:20, :20, :3].reshape(-1, 3)
    c2 = bgr[:20, -20:, :3].reshape(-1, 3)
    c3 = bgr[-20:, :20, :3].reshape(-1, 3)
    c4 = bgr[-20:, -20:, :3].reshape(-1, 3)
    corners = np.concatenate([c1, c2, c3, c4], axis=0)
    bg_median = np.median(corners, axis=0)
    bg_dist = np.linalg.norm(bgr[:, :, :3].astype(np.float32) - bg_median, axis=2)

    # Pixel được coi là mực/nội dung nếu khác xa màu nền và không quá sáng
    is_content = (bg_dist > 25.0) & (gray < 235)
    content_count = np.sum(is_content)
    content_ratio = content_count / float(total_pixels)

    if content_ratio < 0.005:
        # Ảnh gần như trống
        return {
            "imageType": "blank",
            "confidence": 0.95,
            "hasColor": False,
            "contentRatio": round(content_ratio, 4),
            "recommended": {
                "inkPath": "grid",
                "colorFill": "none",
                "inkWeight": 1.0,
                "colorWeight": 0.0,
            }
        }

    # 2. Đo mức độ có màu sắc (Colored vs Monochrome)
    # Các pixel có độ bão hòa Saturation > 35 và là content
    colored_pixels = np.sum(is_content & (sat > 35))
    colored_ratio_in_content = colored_pixels / float(max(1, content_count))

    has_color = colored_ratio_in_content > 0.08  # Hơn 8% pixel nội dung có màu rõ rệt

    # 3. Phân biệt nét mảnh (Line Art) vs mảng tô đậm (Filled Block)
    # Dùng hình thái học Morphology: erode để xem bao nhiêu pixel còn lại sau khi bào mòn nét 3x3
    kernel = np.ones((3, 3), np.uint8)
    content_mask_u8 = (is_content.astype(np.uint8)) * 255
    eroded = cv2.erode(content_mask_u8, kernel, iterations=2)
    thick_content_count = np.count_nonzero(eroded)
    thick_ratio = thick_content_count / float(max(1, content_count))

    # Đưa ra phân loại
    if has_color:
        image_type = "colored"
        confidence = min(0.99, 0.6 + colored_ratio_in_content)
        ink_path = "grid"
        color_fill = "contour-wipe"
        ink_weight = 0.4
        color_weight = 0.6
    else:
        if thick_ratio > 0.35:
            image_type = "filled_mono"
            confidence = min(0.95, 0.6 + thick_ratio * 0.4)
            ink_path = "grid"
            color_fill = "brush"
            ink_weight = 0.6
            color_weight = 0.4
        else:
            image_type = "line_art_mono"
            confidence = min(0.98, 0.7 + (1.0 - thick_ratio) * 0.3)
            ink_path = "skeleton"
            color_fill = "none"
            ink_weight = 1.0
            color_weight = 0.0

    return {
        "imageType": image_type,
        "confidence": float(round(confidence, 2)),
        "hasColor": bool(has_color),
        "coloredRatio": float(round(colored_ratio_in_content, 3)),
        "thickRatio": float(round(thick_ratio, 3)),
        "contentRatio": float(round(content_ratio, 3)),
        "recommended": {
            "inkPath": ink_path,
            "colorFill": color_fill,
            "inkWeight": float(ink_weight),
            "colorWeight": float(color_weight),
        }
    }


def resolve_scene_style(
    image_path: str,
    user_override: Dict[str, Any] | None = None,
    seed: int | None = None,
) -> Dict[str, Any]:
    """
    Quyết định style thực tế cho cảnh, ưu tiên user_override nếu có,
    hoặc dùng kết quả phân tích tự động.
    """
    analysis = analyze_image_style(image_path)
    rec = analysis["recommended"]

    resolved_type = (user_override or {}).get("imageType") or analysis["imageType"]
    resolved_ink = (user_override or {}).get("inkPath") or rec["inkPath"]
    resolved_fill = (user_override or {}).get("colorFill") or rec["colorFill"]
    resolved_ink_w = (user_override or {}).get("inkWeight")
    if resolved_ink_w is None:
        resolved_ink_w = rec["inkWeight"]
    resolved_color_w = (user_override or {}).get("colorWeight")
    if resolved_color_w is None:
        resolved_color_w = rec["colorWeight"]

    # Nếu người dùng chọn fill=none thì khóa color_weight = 0
    if resolved_fill == "none":
        resolved_color_w = 0.0
        resolved_ink_w = 1.0

    return {
        "analysis": analysis,
        "resolved": {
            "imageType": resolved_type,
            "inkPath": resolved_ink,
            "colorFill": resolved_fill,
            "inkWeight": float(resolved_ink_w),
            "colorWeight": float(resolved_color_w),
        }
    }
