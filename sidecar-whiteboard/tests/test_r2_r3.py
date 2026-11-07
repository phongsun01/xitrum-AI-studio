"""
Kiểm thử Giai đoạn R2 & R3 cho Whiteboard:
- R2:
  + PixelOwnershipManager: Phân bổ mask sở hữu pixel, xử lý container lồng nhau và protected regions
  + RenderPlan & Contact Points: Timeline float liên tục [0.0, 1.0], pen-up moves được đánh dấu rõ và không sinh mực
- R3:
  + whiteboard_palette: Phân cụm màu trong CIELAB (DeltaE)
  + palette-brush: Tạo quỹ đạo quét cọ zic-zac bên trong ranh giới nét vẽ
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

import whiteboard_render_plan as wrp
import whiteboard_palette as wpal


class WhiteboardR2R3Test(unittest.TestCase):
    def test_r2_pixel_ownership_nested_container(self):
        """Kiểm tra vùng container bao quanh vùng con: không bị đục thủng mất viền ngoài."""
        mgr = wrp.PixelOwnershipManager(canvas_w=500, canvas_h=500)
        elements = [
            {
                "id": "container",
                "sequence": 1,
                "region": {"x": 50, "y": 50, "width": 400, "height": 400},
                "reveal": {"startMs": 0, "durationMs": 3000},
            },
            {
                "id": "child",
                "sequence": 2,
                "region": {"x": 150, "y": 150, "width": 100, "height": 100},
                "reveal": {"startMs": 3000, "durationMs": 2000},
            },
        ]
        masks = mgr.build_ownership_masks(elements, scale_x=1.0, scale_y=1.0)
        c_mask = masks["container"]

        # Viền ngoài của container (ví dụ tại x=60, y=60) phải thuộc về container
        self.assertTrue(c_mask[60, 60])
        # Phần ruột của child (x=200, y=200) bị trừ khỏi container
        self.assertFalse(c_mask[200, 200])

    def test_r2_timeline_pen_up_no_ink(self):
        """Kiểm tra các điểm pen-up có cờ pen_down=False và không sinh mực."""
        # 2 nét vẽ rời nhau
        stroke1 = [(10, 10), (20, 10), (30, 10)]
        stroke2 = [(80, 80), (90, 80), (100, 80)]
        strokes = [stroke1, stroke2]

        owned_mask = np.ones((200, 200), dtype=bool)
        plan = wrp.build_element_timeline_plan(
            strokes=strokes,
            owned_mask=owned_mask,
            element_id="elem_1",
            sequence=1,
            start_ms=0,
            duration_ms=4000,
        )

        self.assertEqual(plan.pen_up_moves, 1)
        self.assertGreater(len(plan.ink_points), 0)

        # Có ít nhất một điểm pen-up
        pen_up_pts = [p for p in plan.ink_points if not p.pen_down]
        self.assertGreater(len(pen_up_pts), 0)
        # Các mốc thời gian t phải tăng dần liên tục trong [0.0, 1.0]
        ts = [p.t for p in plan.ink_points]
        self.assertEqual(ts[0], 0.0)
        self.assertAlmostEqual(ts[-1], 1.0, places=2)
        for i in range(1, len(ts)):
            self.assertGreaterEqual(ts[i], ts[i - 1])

    def test_r3_lab_color_clustering_and_palette_brush(self):
        """Kiểm tra phân cụm màu Lab và tạo đường vẽ palette brush."""
        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        # Tạo 1 mảng màu đỏ và 1 mảng màu xanh dương
        cv2.rectangle(img, (20, 20), (80, 80), (0, 0, 220), -1)      # Đỏ
        cv2.rectangle(img, (120, 120), (180, 180), (220, 0, 0), -1)  # Xanh dương

        allowed = np.ones((200, 200), dtype=bool)
        ink_mask = np.zeros((200, 200), dtype=bool)

        clusters = wpal.segment_color_palette_lab(
            img, allowed_mask=allowed, ink_mask=ink_mask, max_colors=4
        )
        self.assertGreaterEqual(len(clusters), 2)

        # Sinh đường cọ cho cluster đầu tiên
        path = wpal.build_palette_brush_path(clusters[0].mask, brush_radius=15, sample_step=5)
        self.assertGreater(len(path), 0)
        # Tất cả các điểm trong path phải nằm trong mask của cluster đó
        for x, y in path:
            self.assertTrue(clusters[0].mask[y, x])


if __name__ == "__main__":
    unittest.main()

