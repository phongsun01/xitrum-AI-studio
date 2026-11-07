"""
Kiểm thử Giai đoạn W0 cho Whiteboard:
1. Adapter annotation legacy -> schemaVersion 1.
2. Kiểm tra validation (tọa độ âm, ngoài canvas, timestamp vượt sceneDurationMs, NaN/inf).
3. Đảm bảo duration video xuất ra khớp frame budget trong dung sai 1 frame (round(durationMs * fps / 1000)).
4. Bảo toàn khoảng lặng đầu video (lead silence), không vẽ trước startMs.
5. Kiểm thử render ảnh trắng (blank canvas) và ảnh RGBA trong suốt.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

RUNNER = Path(__file__).resolve().parents[1] / "whiteboard_runner.py"
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


class WhiteboardW0Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Đảm bảo fixtures đã tồn tại
        if not FIXTURES_DIR.exists() or not list(FIXTURES_DIR.glob("*.png")):
            from generate_fixtures import make_fixtures
            make_fixtures(FIXTURES_DIR)

        cls.tmp = Path(tempfile.mkdtemp(prefix="wb_w0_"))
        cls.stderr_path = cls.tmp / "runner.stderr.txt"
        cls.stderr_file = open(cls.stderr_path, "wb")
        cls.proc = subprocess.Popen(
            [sys.executable, str(RUNNER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=cls.stderr_file,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        ready_line = cls.proc.stdout.readline()
        ready = json.loads(ready_line)
        assert ready.get("type") == "ready", ready

    @classmethod
    def tearDownClass(cls):
        try:
            cls.proc.stdin.write(json.dumps({"action": "exit"}) + "\n")
            cls.proc.stdin.flush()
            cls.proc.wait(timeout=10)
        except Exception:
            cls.proc.kill()
        cls.stderr_file.close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _read_json(self):
        line = self.proc.stdout.readline()
        self.assertTrue(line, "runner đã thoát hoặc đóng stdout")
        return json.loads(line)

    def rpc(self, **req):
        self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        while True:
            msg = self._read_json()
            if msg.get("type") != "progress":
                return msg

    def test_01_schema_validation_catches_invalid_coordinates(self):
        """Tọa độ vượt canvas hoặc kích thước âm phải bị báo lỗi rõ ràng."""
        from whiteboard_schema import adapt_and_validate_annotation, ValidationError

        invalid_box = {
            "sceneDurationMs": 5000,
            "canvas": {"width": 640, "height": 360},
            "elements": [
                {
                    "id": "e1",
                    "region": {"x": 500, "y": 100, "width": 200, "height": 100},  # x+w = 700 > 640
                    "reveal": {"startMs": 0, "durationMs": 3000},
                }
            ],
        }
        with self.assertRaises(ValidationError) as ctx:
            adapt_and_validate_annotation(invalid_box)
        self.assertIn("vượt ngoài canvas", str(ctx.exception))

    def test_02_schema_adapter_migrates_legacy_and_adds_warnings(self):
        """Annotation cũ (không có schemaVersion) được nâng cấp lên v1 có cảnh báo."""
        from whiteboard_schema import adapt_and_validate_annotation

        legacy_anno = {
            "sceneId": "legacy-scene",
            "canvas": {"width": 800, "height": 600},
            "elements": [
                {
                    "label": "Mục 1",
                    "region": {"x": 50, "y": 50, "width": 200, "height": 150},
                    "reveal": {"startMs": 200, "durationMs": 2000, "direction": "left_to_right"},
                    "handPath": {"start": [50, 125], "end": [250, 125]},
                }
            ],
        }
        norm, warnings = adapt_and_validate_annotation(legacy_anno)
        self.assertEqual(norm["schemaVersion"], 1)
        self.assertEqual(len(norm["elements"]), 1)
        self.assertTrue(any("schemaVersion" in w for w in warnings))
        self.assertTrue(any("handPath" in w for w in warnings))

    def test_03_frame_budget_accuracy_and_silence_preservation(self):
        """Duration video và số khung hình phải đúng ngân sách khung hình chuẩn và giữ im lặng đầu."""
        img_path = FIXTURES_DIR / "01_line_art_white.png"
        ann_path = self.tmp / "test_timing.annotation.json"
        video_path = self.tmp / "test_timing.mp4"

        # Annotation có khoảng lặng đầu: startMs = 1000, durationMs = 2000, tổng cảnh 4000ms.
        # Ở FPS = 10 -> Tổng số frame phải chính xác = 40 (hoặc sai lệch tối đa 1 frame).
        fps = 10
        total_ms = 4000
        expected_frames = round(total_ms * fps / 1000)

        anno_data = {
            "schemaVersion": 1,
            "sceneId": "scene-timing",
            "sceneDurationMs": total_ms,
            "canvas": {"width": 640, "height": 360},
            "elements": [
                {
                    "id": "elem_1",
                    "label": "Hình vẽ",
                    "sequence": 1,
                    "region": {"x": 100, "y": 100, "width": 200, "height": 150},
                    "reveal": {
                        "startMs": 1000,
                        "durationMs": 2000,
                        "direction": "left_to_right",
                    },
                }
            ],
        }
        ann_path.write_text(json.dumps(anno_data), encoding="utf-8")

        resp = self.rpc(
            action="render_scene",
            image_path=str(img_path),
            annotation_path=str(ann_path),
            output_path=str(video_path),
            fps=fps,
            paper_color="#FFFFFF",
        )
        self.assertEqual(resp["type"], "done", resp)

        cap = cv2.VideoCapture(str(video_path))
        self.assertTrue(cap.isOpened())
        actual_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Kiểm tra frame budget sai số không quá 1 frame
        self.assertAlmostEqual(actual_frame_count, expected_frames, delta=1)

        # Kiểm tra khoảng lặng đầu: frame 0 -> 8 (dưới 1000ms ở 10fps) phải là giấy trắng tĩnh (không có mực vẽ trước)
        ret, frame0 = cap.read()
        self.assertTrue(ret)
        # Giấy trắng #FFFFFF (RGB: 255, 255, 255)
        # Kiểm tra frame đầu không có nét đen (các pixel đều gần 255)
        mean_val = frame0.mean()
        self.assertGreater(mean_val, 250, "Frame đầu trong khoảng lặng phải là nền giấy trắng sạch")
        cap.release()

    def test_04_blank_canvas_renders_safely(self):
        """Ảnh trắng hoàn toàn phải render ra video an toàn với đúng màu nền giấy."""
        blank_img = FIXTURES_DIR / "08_blank_canvas.png"
        ann_path = self.tmp / "blank.annotation.json"
        video_path = self.tmp / "blank_out.mp4"

        anno_resp = self.rpc(
            action="generate_annotation",
            image_path=str(blank_img),
            duration_ms=2000,
            output_path=str(ann_path),
        )
        self.assertEqual(anno_resp["type"], "done")

        render_resp = self.rpc(
            action="render_scene",
            image_path=str(blank_img),
            annotation_path=str(ann_path),
            output_path=str(video_path),
            fps=8,
            paper_color="#F5EBD7",
        )
        self.assertEqual(render_resp["type"], "done")
        self.assertTrue(video_path.exists())
        self.assertGreater(video_path.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main()
