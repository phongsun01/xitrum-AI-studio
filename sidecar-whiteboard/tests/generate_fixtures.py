#!/usr/bin/env python3
"""
Bộ sinh fixture hình ảnh và annotation chuẩn cho Whiteboard test suite (W0).
Bao gồm:
1. line_art_white: Nét đen trên nền trắng
2. line_art_beige: Nét đen trên nền be (#F5EBD7)
3. filled_mono: Mảng đen đặc hình học
4. colored_art: Hình vẽ có màu (nét đen + mảng màu)
5. vietnamese_text: Chữ tiếng Việt có dấu
6. intersecting_shapes: Sơ đồ giao điểm chữ X, V và hình lồng nhau
7. transparent_alpha: PNG có kênh alpha
8. blank_canvas: Ảnh trắng tinh hoàn toàn
"""

import sys
from pathlib import Path
import cv2
import numpy as np

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def make_fixtures(target_dir: Path = FIXTURE_DIR):
    target_dir.mkdir(parents=True, exist_ok=True)
    w, h = 640, 360

    # 1. line_art_white: Nét đen trên nền trắng
    img_white = np.full((h, w, 3), 255, dtype=np.uint8)
    cv2.circle(img_white, (160, 180), 80, (20, 20, 20), 4)
    cv2.rectangle(img_white, (320, 100), (520, 260), (20, 20, 20), 4)
    cv2.imwrite(str(target_dir / "01_line_art_white.png"), img_white)

    # 2. line_art_beige: Nét đen trên nền be #F5EBD7 (BGR: 215, 235, 245)
    img_beige = np.full((h, w, 3), (215, 235, 245), dtype=np.uint8)
    cv2.circle(img_beige, (200, 180), 70, (30, 30, 30), 4)
    cv2.line(img_beige, (350, 100), (550, 250), (30, 30, 30), 5)
    cv2.imwrite(str(target_dir / "02_line_art_beige.png"), img_beige)

    # 3. filled_mono: Mảng đen đặc
    img_filled = np.full((h, w, 3), 255, dtype=np.uint8)
    cv2.rectangle(img_filled, (100, 80), (260, 280), (10, 10, 10), -1)
    cv2.circle(img_filled, (450, 180), 75, (10, 10, 10), -1)
    cv2.imwrite(str(target_dir / "03_filled_mono.png"), img_filled)

    # 4. colored_art: Ảnh màu (nét đen + mảng màu vàng, xanh dương, đỏ)
    img_color = np.full((h, w, 3), 255, dtype=np.uint8)
    cv2.rectangle(img_color, (80, 80), (240, 240), (0, 200, 255), -1)  # vàng cam
    cv2.rectangle(img_color, (80, 80), (240, 240), (20, 20, 20), 4)
    cv2.circle(img_color, (420, 180), 80, (220, 80, 50), -1)  # xanh dương
    cv2.circle(img_color, (420, 180), 80, (20, 20, 20), 4)
    cv2.imwrite(str(target_dir / "04_colored_art.png"), img_color)

    # 5. vietnamese_text: Chữ tiếng Việt "Xitrum AI Studio - Bảng Trắng"
    from PIL import Image, ImageDraw, ImageFont
    pil_img = Image.new("RGB", (w, h), (255, 255, 255))
    draw = ImageDraw.Draw(pil_img)
    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    font = None
    for fc in font_candidates:
        if Path(fc).exists():
            try:
                font = ImageFont.truetype(fc, 32)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()
    draw.text((60, 120), "Xitrum AI Studio", fill=(20, 20, 20), font=font)
    draw.text((60, 180), "Hoạt hình bảng trắng nét vẽ tiếng Việt", fill=(20, 20, 20), font=font)
    pil_img.save(target_dir / "05_vietnamese_text.png")

    # 6. intersecting_shapes: Sơ đồ giao điểm chữ X, V và vòng lồng nhau
    img_intersect = np.full((h, w, 3), 255, dtype=np.uint8)
    # Chữ X
    cv2.line(img_intersect, (80, 80), (220, 280), (20, 20, 20), 5)
    cv2.line(img_intersect, (220, 80), (80, 280), (20, 20, 20), 5)
    # Vòng tròn lồng nhau (nested circle)
    cv2.circle(img_intersect, (440, 180), 90, (20, 20, 20), 4)
    cv2.circle(img_intersect, (440, 180), 45, (20, 20, 20), 4)
    cv2.imwrite(str(target_dir / "06_intersecting_shapes.png"), img_intersect)

    # 7. transparent_alpha: PNG RGBA có vùng trong suốt
    img_rgba = np.zeros((h, w, 4), dtype=np.uint8)
    # Nền trong suốt hoàn toàn, vẽ hình nét đặc có alpha = 255
    cv2.circle(img_rgba, (320, 180), 100, (40, 40, 220, 255), 6)
    cv2.rectangle(img_rgba, (200, 100), (440, 260), (30, 30, 30, 255), 4)
    cv2.imwrite(str(target_dir / "07_transparent_alpha.png"), img_rgba)

    # 8. blank_canvas: Ảnh trắng hoàn toàn
    img_blank = np.full((h, w, 3), 255, dtype=np.uint8)
    cv2.imwrite(str(target_dir / "08_blank_canvas.png"), img_blank)

    print(f"Đã tạo 8 fixture thành công tại: {target_dir}")


if __name__ == "__main__":
    make_fixtures()

