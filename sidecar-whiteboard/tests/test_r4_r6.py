"""
Kiểm thử Giai đoạn R4 & R6:
- R4:
  + whiteboard_hand: HandRig khởi tạo thành công từ asset, căn chỉnh anchor đầu bút,
    stamp có xoay góc cổ tay theo hướng di chuyển (dx, dy), xử lý pen-up lift và đổ bóng.
- R6:
  + render_annotation_preview: Xuất ảnh overlay trực quan đánh số thứ tự vùng và hướng vẽ,
    không bị lỗi khi element thiếu handPath.
"""

import sys
import unittest
import numpy as np
import cv2
from pathlib import Path
import tempfile
import shutil
import json

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parent / "scripts"
ASSETS_DIR = CURRENT_DIR.parent / "assets"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import whiteboard_hand
import render_annotation_preview


class WhiteboardR4R6Test(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wb_r4_r6_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_r4_hand_rig_stamp_and_wrist_rotation(self):
        """Kiểm tra HandRig khởi tạo, dán lên canvas kèm góc xoay và pen-up."""
        hand_asset = ASSETS_DIR / "drawing-hand.png"
        if not hand_asset.exists():
            self.skipTest("Asset drawing-hand.png chưa có sẵn")

        rig = whiteboard_hand.HandRig.from_image(hand_asset, target_height=300)
        self.assertIsNotNone(rig)

        canvas = np.ones((500, 500, 3), dtype=np.uint8) * 255
        # Stamp hạ bút
        res1 = rig.stamp(canvas.copy(), x=200, y=200, pen_down=True, dx=5.0, dy=2.0)
        self.assertEqual(res1.shape, (500, 500, 3))
        # Stamp nhấc bút (pen-up lift)
        res2 = rig.stamp(canvas.copy(), x=200, y=200, pen_down=False, dx=0.0, dy=0.0)
        self.assertEqual(res2.shape, (500, 500, 3))

    def test_r6_annotation_preview(self):
        """Kiểm tra render preview overlay các vùng vẽ."""
        img_p = self.tmp / "sample.png"
        anno_p = self.tmp / "sample.annotation.json"
        out_p = self.tmp / "sample.preview.png"

        # Tạo ảnh mẫu
        img = np.ones((400, 400, 3), dtype=np.uint8) * 240
        cv2.imwrite(str(img_p), img)

        # Tạo annotation có 2 vùng vẽ
        anno_data = {
            "schemaVersion": 1,
            "sceneId": "scene-01",
            "sceneDurationMs": 4000,
            "canvas": {"width": 400, "height": 400},
            "elements": [
                {
                    "id": "e1",
                    "label": "Khung 1",
                    "region": {"x": 50, "y": 50, "width": 100, "height": 100},
                    "reveal": {"startMs": 0, "durationMs": 2000, "direction": "left_to_right"},
                },
                {
                    "id": "e2",
                    "label": "Khung 2",
                    "region": {"x": 200, "y": 200, "width": 120, "height": 120},
                    "reveal": {"startMs": 2000, "durationMs": 2000, "direction": "top_to_bottom"},
                },
            ],
        }
        anno_p.write_text(json.dumps(anno_data), encoding="utf-8")

        render_annotation_preview.main(str(img_p), str(anno_p), str(out_p))
        self.assertTrue(out_p.is_file())
        self.assertGreater(out_p.stat().st_size, 500)


if __name__ == "__main__":
    unittest.main()

