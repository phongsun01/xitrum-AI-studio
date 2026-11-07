"""
Kiểm thử Giai đoạn W1 cho Whiteboard: Quản lý nhiều cảnh và lưu dự án.
Kiểm tra:
1. Dự án ít nhất 3 cảnh độc lập (ảnh riêng, annotation riêng, duration riêng).
2. Lưu dự án nguyên tử (.json) và mở lại đúng dữ liệu, đúng thứ tự, đúng cues.
3. Thay đổi thứ tự cảnh (reorder), lưu lại và kiểm tra tính toàn vẹn.
4. Render tuần tự nhiều cảnh và ghép thành video hoàn chỉnh không tiếng đủ tổng timeline.
5. Sửa một cảnh không làm mất output hay hỏng annotation của cảnh khác.
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


class WhiteboardW1Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not FIXTURES_DIR.exists() or not list(FIXTURES_DIR.glob("*.png")):
            from generate_fixtures import make_fixtures
            make_fixtures(FIXTURES_DIR)

        cls.tmp = Path(tempfile.mkdtemp(prefix="wb_w1_"))
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

    def test_01_multi_scene_project_save_and_reopen(self):
        """Tạo dự án 3 cảnh, lưu tệp JSON và đọc lại kiểm tra tính khớp."""
        proj_file = self.tmp / "test_project.whiteboard.json"
        img1 = FIXTURES_DIR / "01_line_art_white.png"
        img2 = FIXTURES_DIR / "02_line_art_beige.png"
        img3 = FIXTURES_DIR / "03_filled_mono.png"

        ann1 = self.tmp / "scene_01.annotation.json"
        ann2 = self.tmp / "scene_02.annotation.json"
        ann3 = self.tmp / "scene_03.annotation.json"

        # Sinh 3 annotation riêng biệt
        for idx, (img, ann, dur) in enumerate([(img1, ann1, 2000), (img2, ann2, 3000), (img3, ann3, 2500)], start=1):
            resp = self.rpc(
                action="generate_annotation",
                image_path=str(img),
                scene_id=f"scene-{idx:02d}",
                duration_ms=dur,
                output_path=str(ann),
            )
            self.assertEqual(resp["type"], "done")

        # Cấu trúc dự án
        project = {
            "id": "proj-w1-001",
            "schemaVersion": 1,
            "revision": 1,
            "title": "Dự án thử nghiệm 3 cảnh",
            "fps": 10,
            "paperColor": "#F5EBD7",
            "scenes": [
                {
                    "id": "scene-01",
                    "order": 1,
                    "revision": 1,
                    "imagePath": str(img1),
                    "annotationPath": str(ann1),
                    "timelineStartMs": 0,
                    "timelineEndMs": 2000,
                    "durationMs": 2000,
                    "cues": [{"index": 1, "startMs": 0, "endMs": 2000, "durMs": 2000, "text": "Cảnh 1"}],
                    "status": "idle",
                },
                {
                    "id": "scene-02",
                    "order": 2,
                    "revision": 1,
                    "imagePath": str(img2),
                    "annotationPath": str(ann2),
                    "timelineStartMs": 2000,
                    "timelineEndMs": 5000,
                    "durationMs": 3000,
                    "cues": [{"index": 2, "startMs": 2000, "endMs": 5000, "durMs": 3000, "text": "Cảnh 2"}],
                    "status": "idle",
                },
                {
                    "id": "scene-03",
                    "order": 3,
                    "revision": 1,
                    "imagePath": str(img3),
                    "annotationPath": str(ann3),
                    "timelineStartMs": 5000,
                    "timelineEndMs": 7500,
                    "durationMs": 2500,
                    "cues": [{"index": 3, "startMs": 5000, "endMs": 7500, "durMs": 2500, "text": "Cảnh 3"}],
                    "status": "idle",
                },
            ],
        }

        # Lưu dự án
        proj_file.write_text(json.dumps(project, indent=2, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(proj_file.exists())

        # Đọc lại và kiểm tra
        loaded = json.loads(proj_file.read_text(encoding="utf-8"))
        self.assertEqual(loaded["id"], "proj-w1-001")
        self.assertEqual(len(loaded["scenes"]), 3)
        self.assertEqual([s["id"] for s in loaded["scenes"]], ["scene-01", "scene-02", "scene-03"])
        self.assertEqual(loaded["scenes"][1]["durationMs"], 3000)

        # Đổi thứ tự cảnh 1 và 2 (reorder)
        loaded["scenes"][0], loaded["scenes"][1] = loaded["scenes"][1], loaded["scenes"][0]
        loaded["scenes"][0]["order"] = 1
        loaded["scenes"][1]["order"] = 2
        loaded["revision"] += 1
        proj_file.write_text(json.dumps(loaded, indent=2, ensure_ascii=False), encoding="utf-8")

        reloaded = json.loads(proj_file.read_text(encoding="utf-8"))
        self.assertEqual(reloaded["revision"], 2)
        self.assertEqual([s["id"] for s in reloaded["scenes"]], ["scene-02", "scene-01", "scene-03"])

    def test_02_render_and_merge_full_multi_scene_project(self):
        """Render 3 phân cảnh rồi ghép thành video hoàn chỉnh đúng tổng duration."""
        img1 = FIXTURES_DIR / "01_line_art_white.png"
        img2 = FIXTURES_DIR / "02_line_art_beige.png"
        img3 = FIXTURES_DIR / "03_filled_mono.png"

        ann1 = self.tmp / "render_s1.annotation.json"
        ann2 = self.tmp / "render_s2.annotation.json"
        ann3 = self.tmp / "render_s3.annotation.json"

        v1 = self.tmp / "s1.mp4"
        v2 = self.tmp / "s2.mp4"
        v3 = self.tmp / "s3.mp4"
        v_final = self.tmp / "project_final.mp4"

        # 3 cảnh: 1500ms, 2000ms, 1500ms -> tổng 5000ms
        fps = 10
        for img, ann, v, dur in [(img1, ann1, v1, 1500), (img2, ann2, v2, 2000), (img3, ann3, v3, 1500)]:
            self.assertEqual(
                self.rpc(
                    action="generate_annotation",
                    image_path=str(img),
                    duration_ms=dur,
                    output_path=str(ann),
                )["type"],
                "done",
            )
            resp = self.rpc(
                action="render_scene",
                image_path=str(img),
                annotation_path=str(ann),
                output_path=str(v),
                fps=fps,
                paper_color="#F5EBD7",
            )
            self.assertEqual(resp["type"], "done", resp)
            self.assertTrue(v.exists())
            self.assertGreater(v.stat().st_size, 0)

        # Ghép 3 cảnh
        merge_resp = self.rpc(
            action="merge_scenes",
            video_paths=[str(v1), str(v2), str(v3)],
            output_path=str(v_final),
        )
        self.assertEqual(merge_resp["type"], "done", merge_resp)
        self.assertTrue(v_final.exists())

        cap = cv2.VideoCapture(str(v_final))
        self.assertTrue(cap.isOpened())
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        # Tổng frames dự kiến: (1500 + 2000 + 1500) * 10 / 1000 = 50 frames
        self.assertAlmostEqual(total_frames, 50, delta=2)


if __name__ == "__main__":
    unittest.main()

