#!/usr/bin/env python3
"""
Kiểm thử tự động cho Giai đoạn W4:
1. Tách vùng nét mực kết hợp phân loại thành phần (container, illustration, text)
2. Kiểm tra thứ tự vẽ tự nhiên (component_ordering):
   - Hình khung container vẽ trước
   - Hình vẽ illustration vẽ tiếp theo
   - Nhãn chữ text vẽ cuối theo thứ tự đọc
3. Không làm đứt nét viền ngoài của container khi trừ mặt nạ _allowed_mask
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

import whiteboard_segmenter
import render_stream_whiteboard as rsw


class TestW4SegmentationAndOrdering(unittest.TestCase):
    def test_container_and_inner_content_ordering(self):
        """Khung hình chữ nhật bao quanh một hình tròn nhỏ bên trong."""
        img = np.ones((500, 500, 3), dtype=np.uint8) * 255
        # 1. Khung chữ nhật bao ngoài (Container)
        cv2.rectangle(img, (50, 50), (450, 450), (10, 10, 10), 3)
        # 2. Hình tròn nhỏ bên trong (Inner Figure)
        cv2.circle(img, (250, 250), 40, (15, 15, 15), -1)

        regions = whiteboard_segmenter.segment_and_order_regions(img, max_regions=5)
        self.assertGreaterEqual(len(regions), 1)

        # Nếu tách thành 2 vùng, vùng khung container phải được vẽ đầu tiên
        if len(regions) >= 2:
            self.assertEqual(regions[0]["role"], "container")

    def test_text_and_vietnamese_accents_clustering(self):
        """Dấu tiếng Việt (dấu mũ, chấm) không bị tách thành các vùng riêng lẻ kỳ dị."""
        img = np.ones((400, 600, 3), dtype=np.uint8) * 255
        # Giả lập chữ có dấu cách nhau 1 khoảng ngắn theo chiều dọc
        # Chữ cái
        cv2.rectangle(img, (100, 150), (140, 200), (10, 10, 10), -1)
        # Dấu mũ phía trên
        cv2.line(img, (100, 130), (120, 115), (10, 10, 10), 3)
        cv2.line(img, (120, 115), (140, 130), (10, 10, 10), 3)

        regions = whiteboard_segmenter.segment_and_order_regions(img, max_regions=5)
        # Phải được gom vào làm 1 vùng duy nhất
        self.assertEqual(len(regions), 1)
        box = regions[0]["box"]
        # Hộp bao phải chứa cả dấu mũ y=115 và thân chữ y=200
        self.assertLessEqual(box[1], 120)
        self.assertGreaterEqual(box[3], 195)

    def test_allowed_mask_preserves_container_boundary(self):
        """Mặt nạ allowed_mask của container không bị trừ rỗng ruột mất nét bao ngoài."""
        renderer = rsw.RegionStreamRenderer.__new__(rsw.RegionStreamRenderer)
        renderer.out_w = 500
        renderer.out_h = 500
        renderer.sx = 1.0
        renderer.sy = 1.0

        container_el = {
            "region": {"x": 50, "y": 50, "width": 400, "height": 400},
            "reveal": {"protectedRegions": []}
        }
        child_el = {
            "region": {"x": 150, "y": 150, "width": 100, "height": 100},
            "reveal": {"protectedRegions": []}
        }

        # Gọi _allowed_mask cho container khi có child_el phía sau
        mask = renderer._allowed_mask(container_el, [child_el])

        # Biên ngoài container (ví dụ tại x=55, y=55) PHẢI còn True (được vẽ)
        self.assertTrue(mask[55, 55])
        # Viền ngoài của container ngay trên đỉnh child (x=200, y=55) cũng PHẢI còn True
        self.assertTrue(mask[55, 200])


if __name__ == "__main__":
    unittest.main()
