"""
whiteboard_image.py - Xử lý ảnh chuẩn hóa và an toàn cho Whiteboard Animation (R0)

Bao gồm:
- _imread_safe: Đọc ảnh an toàn, hỗ trợ đường dẫn Unicode / khoảng trắng / không phải ASCII.
- composite_on_background: Chuẩn hóa kênh alpha, grayscale và composite lên màu nền giấy đồng nhất giữa analyzer và renderer.
- validate_and_load_image: Kiểm tra ảnh hợp lệ, kích thước tối thiểu, tránh phân loại sai khi màu ẩn dưới alpha = 0.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Tuple, Optional
import cv2
import numpy as np


def parse_hex_color(color_hex: str) -> Tuple[int, int, int]:
    """Chuyển chuỗi #RRGGBB hoặc RRGGBB thành BGR (chuẩn OpenCV)."""
    s = color_hex.strip().lstrip("#")
    if len(s) != 6:
        s = "F5EBD7"  # Mặc định nền giấy
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    return (b, g, r)


def imread_safe(path: str | Path, flags: int = cv2.IMREAD_UNCHANGED) -> Optional[np.ndarray]:
    """
    Đọc ảnh an toàn qua np.fromfile và cv2.imdecode.
    Hỗ trợ ký tự Unicode/tiếng Việt/khoảng trắng trên cả Windows, macOS và Linux.
    """
    p = Path(path)
    if not p.is_file():
        return None
    try:
        raw = np.fromfile(str(p), dtype=np.uint8)
        if raw.size == 0:
            return None
        return cv2.imdecode(raw, flags)
    except Exception:
        return None


def composite_on_background(
    img: np.ndarray,
    paper_color_hex: str = "#F5EBD7",
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """
    Chuẩn hóa ảnh thành định dạng 3 kênh BGR trên nền giấy chỉ định.
    Nếu ảnh gốc có alpha (RGBA hoặc 4 kênh):
      - Pixel có alpha = 0 được hòa trộn hoàn toàn vào màu nền (không để lộ màu RGB rác dưới alpha).
      - Trả về (bgr_composited, alpha_channel).
    Nếu ảnh grayscale (2D hoặc 1 kênh):
      - Chuyển thành BGR (3 kênh).
    """
    if img is None:
        raise ValueError("Ảnh rỗng (None)")

    paper_bgr = parse_hex_color(paper_color_hex)

    # 1. Grayscale
    if img.ndim == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return bgr, None

    # 2. Ảnh 3 kênh BGR
    if img.ndim == 3 and img.shape[2] == 3:
        return img, None

    # 3. Ảnh có kênh alpha (BGRA/RGBA)
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3]
        bgr_raw = img[:, :, :3]

        h, w = img.shape[:2]
        bg = np.zeros((h, w, 3), dtype=np.uint8)
        bg[:, :] = paper_bgr

        alpha_f = (alpha[:, :, None] / 255.0).astype(np.float32)
        composited = (
            bgr_raw.astype(np.float32) * alpha_f + bg.astype(np.float32) * (1.0 - alpha_f)
        ).astype(np.uint8)

        return composited, alpha

    raise ValueError(f"Định dạng ảnh không hỗ trợ: shape={getattr(img, 'shape', None)}")


def load_normalized_image(
    image_path: str | Path,
    paper_color_hex: str = "#F5EBD7",
    min_dimension: int = 16,
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """
    Đọc và chuẩn hóa ảnh từ đường dẫn.
    Bắn ValueError nếu ảnh không tồn tại, rỗng, hỏng hoặc kích thước quá nhỏ (< min_dimension).
    """
    p = Path(image_path)
    if not p.is_file():
        raise FileNotFoundError(f"Không tìm thấy file ảnh: {image_path}")

    raw = imread_safe(p, cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise ValueError(f"Không thể đọc hoặc giải mã file ảnh: {image_path}")

    h, w = raw.shape[:2]
    if h < min_dimension or w < min_dimension:
        raise ValueError(
            f"Kích thước ảnh quá nhỏ ({w}x{h}); tối thiểu cần {min_dimension}x{min_dimension}"
        )

    return composite_on_background(raw, paper_color_hex)
