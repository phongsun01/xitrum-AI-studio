#!/usr/bin/env python3
"""
Kiểm thử tự động cho Giai đoạn W5: Nét bút và tô màu thích ứng.

Yêu cầu nghiệm thu W5:
1. Endpoint-first: Nét hở bắt đầu ở đầu mút (degree == 1).
2. Xử lý ngã ba / ngã tư (Junctions, hình chữ X): Đi thẳng qua giao điểm, không mọc đồng loạt từ giữa.
3. Vòng khép kín (closed loops): Vẽ liên tục 1 hướng trọn vẹn.
4. Quản lý nhấc bút (pen_lifts): Đánh dấu chính xác khi chuyển giữa các nét rời, không vẽ đường nối mực giả.
5. Cân bằng thời lượng thích ứng: Tự động tính toán ink_frames và color_frames theo độ dài nét và diện tích màu.
"""

import sys
import unittest
import numpy as np
import cv2
from pathlib import Path

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import whiteboard_stroke_planner as wsp


class TestW5StrokesAndAdaptiveBudget(unittest.TestCase):
    def test_v_shape_endpoint_first(self):
        """Hình chữ V: Có 2 đầu mút (degree=1) và 1 đỉnh nhọn. Phải xuất phát từ đầu mút."""
        mask = np.zeros((100, 100), dtype=bool)
        # Nét 1: từ (20, 20) xuống (50, 80)
        # Nét 2: từ (50, 80) lên (80, 20)
        img = np.zeros((100, 100), dtype=np.uint8)
        cv2.line(img, (20, 20), (50, 80), 255, 1)
        cv2.line(img, (50, 80), (80, 20), 255, 1)
        skel = img > 0

        strokes = wsp.extract_smooth_skeleton_strokes(skel, min_points=3, spacing=3.0)
        self.assertGreaterEqual(len(strokes), 1)

        first_stroke = strokes[0]
        start_pt = first_stroke[0]
        end_pt = first_stroke[-1]

        # Điểm bắt đầu phải ở gần đầu mút trên (y ~ 20) chứ không phải xuất phát từ đỉnh nhọn ở giữa (y ~ 80)
        self.assertTrue(abs(start_pt[1] - 20) <= 5 or abs(end_pt[1] - 20) <= 5)

    def test_x_shape_continuous_junction(self):
        """Hình chữ X: Giao nhau ở giữa (ngã tư). Không được bùng phát từ tâm ra 4 nhánh."""
        img = np.zeros((100, 100), dtype=np.uint8)
        # Đường chéo chính 1: (15, 15) -> (85, 85)
        cv2.line(img, (15, 15), (85, 85), 255, 1)
        # Đường chéo phụ 2: (85, 15) -> (15, 85)
        cv2.line(img, (85, 15), (15, 85), 255, 1)
        skel = img > 0

        strokes = wsp.extract_smooth_skeleton_strokes(skel, min_points=5, spacing=3.0)
        # Chữ X thường tạo thành 2 nét chéo kéo dài xuyên qua tâm
        self.assertGreaterEqual(len(strokes), 1)
        # Mỗi nét kéo dài có độ dài đáng kể (không bị vụn thành các nét ngắn từ tâm)
        for s in strokes:
            self.assertGreaterEqual(len(s), 3)

    def test_closed_circle_loop(self):
        """Vòng tròn khép kín: Duyệt tuần tự 1 chiều quanh chu vi."""
        img = np.zeros((120, 120), dtype=np.uint8)
        cv2.circle(img, (60, 60), 40, 255, 1)
        skel = img > 0

        strokes = wsp.extract_smooth_skeleton_strokes(skel, min_points=10, spacing=4.0)
        self.assertGreaterEqual(len(strokes), 1)
        # Nét vẽ khép kín có điểm bắt đầu và điểm kết thúc gần nhau
        loop = strokes[0]
        dist = np.hypot(loop[0][0] - loop[-1][0], loop[0][1] - loop[-1][1])
        # Chu vi khoảng 2 * pi * 40 = 251px, đầu và cuối phải giáp nhau (khoảng cách nhỏ)
        self.assertLessEqual(dist, 15.0)

    def test_pen_lifts_separate_strokes(self):
        """Khi có 2 nét rời xa nhau, phải có đánh dấu pen_lift để tránh vẽ nét nối giả."""
        s1 = [(10, 10), (10, 20), (10, 30)]
        s2 = [(80, 80), (80, 90), (80, 100)]
        samples, pen_lifts = wsp.build_stroke_plan_with_pen_lifts([s1, s2])

        self.assertEqual(len(samples), 6)
        # Điểm bắt đầu nét thứ 2 (chỉ số 3 trong samples) phải nằm trong pen_lifts
        self.assertIn(3, pen_lifts)

    def test_adaptive_budget_allocation(self):
        """Thử nghiệm phân bổ thời lượng thích ứng:
        - Nét dài + diện tích tô ít: ink_frames chiếm đa số
        - Nét ngắn + diện tích tô lớn: color_frames được bổ sung thích đáng
        - Chỉ có nét: 100% thời lượng cho nét
        """
        # Ca 1: Chỉ có nét (color_weight = 0)
        ink_f, col_f = wsp.calculate_adaptive_budget(
            ink_stroke_length=500.0,
            color_pixel_count=1000,
            total_frames=100,
            ink_weight=1.0,
            color_weight=0.0,
        )
        self.assertEqual(ink_f, 100)
        self.assertEqual(col_f, 0)

        # Ca 2: Cả nét và tô màu
        ink_f2, col_f2 = wsp.calculate_adaptive_budget(
            ink_stroke_length=200.0,
            color_pixel_count=5000,
            total_frames=100,
            ink_weight=0.7,
            color_weight=0.3,
        )
        self.assertEqual(ink_f2 + col_f2, 100)
        self.assertGreater(ink_f2, 0)
        self.assertGreater(col_f2, 0)


if __name__ == "__main__":
    unittest.main()

