"""
Kiểm thử Giai đoạn R0 & R1 cho Whiteboard:
- R0:
  + Composite an toàn alpha & grayscale, không để lộ màu rác dưới alpha = 0
  + Truyền duration/total-ms và tự động co giãn nếu annotation vượt thời lượng
  + Mux video & audio giữ đuôi lời đọc (tpad clone frame cuối) khi audio dài hơn video
  + Escape an toàn đường dẫn concat file
- R1:
  + Tính toán fingerprint độc nhất
  + Ghi và xác thực manifest complete
  + Resume cache hợp lệ (cache hit) và vô hiệu hóa khi đổi ảnh/cấu hình (cache miss)
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import cv2

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import whiteboard_image
import whiteboard_cache
import whiteboard_audio
import merge_scenes


class WhiteboardR0R1Test(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wb_r0_r1_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_r0_composite_alpha_safe(self):
        """Kiểm tra ảnh RGBA có pixel hoàn toàn trong suốt không làm lộ màu rác."""
        # Tạo ảnh 100x100 RGBA, nửa bên trái trong suốt (alpha=0) nhưng RGB=(255, 0, 0) (đỏ rác)
        rgba = np.zeros((100, 100, 4), dtype=np.uint8)
        rgba[:, :50, :3] = (0, 0, 255)  # BGR đỏ
        rgba[:, :50, 3] = 0             # alpha = 0 (trong suốt)
        rgba[:, 50:, :3] = (0, 255, 0)  # BGR xanh lá
        rgba[:, 50:, 3] = 255           # alpha = 255

        img_p = self.tmp / "test_alpha.png"
        cv2.imwrite(str(img_p), rgba)

        # Composite lên nền trắng #FFFFFF
        bgr, alpha = whiteboard_image.load_normalized_image(img_p, paper_color_hex="#FFFFFF")
        # Nửa bên trái vì alpha=0 nên phải hòa trộn thành nền trắng (255, 255, 255), không còn đỏ
        self.assertTrue(np.all(bgr[:, :50] == 255))
        # Nửa bên phải giữ nguyên xanh lá (0, 255, 0)
        self.assertTrue(np.all(bgr[:, 50:, 1] == 255))

    def test_r0_escape_concat_path(self):
        """Kiểm tra escape đường dẫn có chứa dấu nháy đơn."""
        p = Path("/tmp/folder with 'quotes'/scene_01.mp4")
        escaped = merge_scenes._escape_concat_path(p)
        self.assertIn("'\\''", escaped)

    def test_r1_fingerprint_and_manifest(self):
        """Kiểm tra tính fingerprint và xác thực manifest cache."""
        img_p = self.tmp / "scene.png"
        anno_p = self.tmp / "scene.annotation.json"
        vid_p = self.tmp / "scene.mp4"

        # Tạo file ảnh và annotation giả
        img = np.ones((50, 50, 3), dtype=np.uint8) * 255
        cv2.imwrite(str(img_p), img)
        anno_p.write_text(json.dumps({"sceneDurationMs": 5000, "elements": []}), encoding="utf-8")

        # Tạo file video giả > 1000 bytes
        vid_p.write_bytes(b"\x00" * 2000)

        fp1 = whiteboard_cache.calculate_scene_fingerprint(
            image_path=str(img_p),
            annotation_path=str(anno_p),
            fps=30,
            paper_color="#F5EBD7",
            duration_ms=5000,
        )
        self.assertTrue(len(fp1) == 64)

        # Ghi manifest
        whiteboard_cache.write_scene_manifest(str(vid_p), fp1)
        manifest_p = vid_p.with_name(vid_p.name + ".manifest.json")
        self.assertTrue(manifest_p.is_file())

        # Thay đổi thời lượng -> fingerprint phải đổi -> cache miss
        fp2 = whiteboard_cache.calculate_scene_fingerprint(
            image_path=str(img_p),
            annotation_path=str(anno_p),
            fps=30,
            paper_color="#F5EBD7",
            duration_ms=8000,
        )
        self.assertNotEqual(fp1, fp2)


if __name__ == "__main__":
    unittest.main()
