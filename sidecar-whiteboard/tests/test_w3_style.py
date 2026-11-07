#!/usr/bin/env python3
"""
Kiểm thử tự động cho Giai đoạn W3:
1. Nhận diện ảnh line_art_mono, filled_mono, colored
2. Phân bổ ngân sách thời gian nét vẽ và tô màu (inkPath, colorFill, inkWeight, colorWeight)
3. Hỗ trợ colorFill="none" để dồn 100% budget cho nét vẽ
"""

import os
import sys
import unittest
import numpy as np
import cv2
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import whiteboard_analyzer


class TestW3StyleAnalysis(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = CURRENT_DIR / "tmp_w3"
        self.tmp_dir.mkdir(parents=True, exist_ok=True)

    def test_line_art_mono_classification(self):
        """Ảnh chỉ có nét vẽ đơn sắc (đen trên nền trắng)."""
        img = np.ones((400, 400, 3), dtype=np.uint8) * 255
        cv2.line(img, (20, 20), (380, 380), (10, 10, 10), 2)
        cv2.circle(img, (200, 200), 80, (15, 15, 15), 2)
        p = self.tmp_dir / "line_art.png"
        cv2.imwrite(str(p), img)

        res = whiteboard_analyzer.analyze_image_style(str(p))
        self.assertEqual(res["imageType"], "line_art_mono")
        self.assertFalse(res["hasColor"])
        self.assertEqual(res["recommended"]["colorFill"], "none")
        self.assertEqual(res["recommended"]["inkWeight"], 1.0)
        self.assertEqual(res["recommended"]["colorWeight"], 0.0)

    def test_filled_mono_classification(self):
        """Ảnh đơn sắc nhưng có mảng đen lớn."""
        img = np.ones((400, 400, 3), dtype=np.uint8) * 255
        cv2.rectangle(img, (100, 100), (300, 300), (10, 10, 10), -1)
        p = self.tmp_dir / "filled_mono.png"
        cv2.imwrite(str(p), img)

        res = whiteboard_analyzer.analyze_image_style(str(p))
        self.assertEqual(res["imageType"], "filled_mono")
        self.assertFalse(res["hasColor"])
        self.assertEqual(res["recommended"]["colorFill"], "brush")

    def test_colored_image_classification(self):
        """Ảnh có màu sắc rõ rệt."""
        img = np.ones((400, 400, 3), dtype=np.uint8) * 255
        # Mảng màu đỏ và xanh
        cv2.circle(img, (150, 150), 60, (0, 0, 220), -1)
        cv2.rectangle(img, (220, 220), (350, 350), (220, 50, 20), -1)
        p = self.tmp_dir / "colored.png"
        cv2.imwrite(str(p), img)

        res = whiteboard_analyzer.analyze_image_style(str(p))
        self.assertEqual(res["imageType"], "colored")
        self.assertTrue(res["hasColor"])
        self.assertEqual(res["recommended"]["colorFill"], "contour-wipe")

    def test_user_override_style(self):
        """Người dùng ghi đè tùy chọn style."""
        img = np.ones((400, 400, 3), dtype=np.uint8) * 255
        cv2.line(img, (20, 20), (380, 380), (10, 10, 10), 2)
        p = self.tmp_dir / "override_test.png"
        cv2.imwrite(str(p), img)

        resolved = whiteboard_analyzer.resolve_scene_style(
            str(p),
            user_override={"colorFill": "none", "inkPath": "grid"}
        )["resolved"]

        self.assertEqual(resolved["colorFill"], "none")
        self.assertEqual(resolved["inkPath"], "grid")
        self.assertEqual(resolved["inkWeight"], 1.0)
        self.assertEqual(resolved["colorWeight"], 0.0)


if __name__ == "__main__":
    unittest.main()

