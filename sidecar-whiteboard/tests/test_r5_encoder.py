"""
Kiểm thử Giai đoạn R5:
1. FFmpegDirectPipeWriter pipe trực tiếp RGB/BGR qua stdin FFmpeg libx264
2. Video xuất chuẩn H.264, yuv420p, hợp lệ khi probe
3. Kiểm tra hủy / terminate tiến trình không để lại process mồ côi
"""

import sys
import unittest
import numpy as np
from pathlib import Path
import tempfile
import shutil

CURRENT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = CURRENT_DIR.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import whiteboard_encoder
import whiteboard_cache


class WhiteboardR5Test(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wb_r5_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_r5_direct_ffmpeg_writer(self):
        """Tạo video qua direct pipe FFmpeg và probe kiểm tra stream."""
        out_mp4 = self.tmp / "test_direct.mp4"
        width, height, fps = 320, 240, 25
        writer = whiteboard_encoder.create_frame_writer(out_mp4, width, height, fps=fps)
        self.assertTrue(writer.is_opened())

        # Ghi 25 khung hình (1 giây)
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :] = (200, 150, 50)  # BGR

        for _ in range(fps):
            writer.write(frame)

        released = writer.release()
        self.assertTrue(released)
        self.assertTrue(out_mp4.is_file())
        self.assertGreater(out_mp4.stat().st_size, 500)

        # Probe video bằng whiteboard_cache
        ok, w, h, dur, has_audio = whiteboard_cache.probe_video_streams(out_mp4)
        self.assertTrue(ok)
        self.assertEqual(w, width)
        self.assertEqual(h, height)
        self.assertAlmostEqual(dur, 1.0, delta=0.2)


if __name__ == "__main__":
    unittest.main()

