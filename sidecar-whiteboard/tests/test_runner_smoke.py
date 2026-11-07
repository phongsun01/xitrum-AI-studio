"""
Smoke test cho whiteboard_runner.py, chạy runner như một tiến trình thật qua JSON-RPC (stdin/stdout).

Chạy:  python -m unittest discover -s sidecar-whiteboard/tests -v
Cần: opencv-python, numpy (xem requirements.txt) và ffmpeg trong PATH để kiểm tra ghép cảnh.

Các lỗi mà bộ test này chặn hồi quy:
- runner gọi sai CLI của render_stream_whiteboard.py / merge_scenes.py (SystemExit làm chết runner)
- print() của script render lọt vào stdout làm hỏng giao thức (mỗi dòng stdout phải là JSON)
- annotation tự sinh không được lưu, hoặc cho mọi phần tử cùng một vùng toàn khung (mask rỗng)
- màu nền giấy không được truyền vào bộ render
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None

RUNNER = Path(__file__).resolve().parents[1] / "whiteboard_runner.py"


def _make_line_art(path: Path):
    """Ảnh 480x270 nền be với ba hình tách biệt nhau: tròn, chữ nhật, đường chéo + tròn nhỏ."""
    img = np.full((270, 480, 3), (215, 235, 245), np.uint8)
    dark = (60, 60, 60)
    cv2.circle(img, (80, 135), 52, dark, 3)
    cv2.rectangle(img, (190, 70), (280, 200), dark, 3)
    cv2.line(img, (350, 80), (440, 160), dark, 3)
    cv2.circle(img, (395, 220), 22, (40, 40, 200), 3)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    path.write_bytes(buf.tobytes())


@unittest.skipIf(cv2 is None, "cần opencv-python và numpy")
class RunnerSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="wb_smoke_"))
        cls.stderr_path = cls.tmp / "runner.stderr.txt"
        cls.stderr_file = open(cls.stderr_path, "wb")
        cls.proc = subprocess.Popen(
            [sys.executable, str(RUNNER)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=cls.stderr_file,
            text=True, encoding="utf-8", bufsize=1,
        )
        ready = cls._read_json(cls)
        assert ready["type"] == "ready", ready
        cls.image = cls.tmp / "line.png"
        _make_line_art(cls.image)

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
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            self.fail(f"stdout chứa dòng không phải JSON (hỏng giao thức): {line!r}")

    def rpc(self, **req):
        self.proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        return self._read_json()

    def test_01_ping(self):
        self.assertEqual(self.rpc(action="ping", task_id="p")["type"], "pong")

    def test_02_generate_annotation_saves_distinct_regions(self):
        out = self.tmp / "scene.annotation.json"
        cues = [{"text": "một", "startMs": 1000, "endMs": 3000},
                {"text": "hai", "startMs": 3200, "endMs": 5000},
                {"text": "ba", "startMs": 5200, "endMs": 7000}]
        resp = self.rpc(action="generate_annotation", task_id="g", image_path=str(self.image),
                        duration_ms=6500, cues=cues, output_path=str(out))
        self.assertEqual(resp["type"], "done", resp)
        self.assertEqual(resp["data"]["savedTo"], str(out))
        ann = json.loads(out.read_text(encoding="utf-8"))
        els = ann["elements"]
        self.assertEqual(len(els), 3)
        self.assertEqual([e["sequence"] for e in els], [1, 2, 3])
        regions = {tuple(e["region"].values()) for e in els}
        self.assertEqual(len(regions), 3, "các vùng phải khác nhau")
        for e in els:
            r = e["region"]
            self.assertLess(r["width"] * r["height"], 0.8 * 480 * 270, "vùng không được là toàn khung")
        starts = [e["reveal"]["startMs"] for e in els]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual([e["subtitle"] for e in els], ["một", "hai", "ba"])

    def test_03_generate_annotation_refuses_silent_overwrite(self):
        out = self.tmp / "keep.annotation.json"
        out.write_text('{"mine": true}', encoding="utf-8")
        resp = self.rpc(action="generate_annotation", image_path=str(self.image), output_path=str(out))
        self.assertEqual(resp["type"], "error")
        self.assertIn("ANNOTATION_EXISTS", resp["message"])
        self.assertEqual(out.read_text(encoding="utf-8"), '{"mine": true}')
        resp = self.rpc(action="generate_annotation", image_path=str(self.image),
                        output_path=str(out), overwrite=True)
        self.assertEqual(resp["type"], "done", resp)

    def test_04_render_then_merge(self):
        ann = self.tmp / "r.annotation.json"
        cues = [{"text": "a"}, {"text": "b"}, {"text": "c"}]
        self.assertEqual(self.rpc(action="generate_annotation", image_path=str(self.image), duration_ms=4000,
                                  cues=cues, output_path=str(ann))["type"], "done")
        video = self.tmp / "scene.mp4"
        resp = self.rpc(action="render_scene", task_id="r", image_path=str(self.image),
                        annotation_path=str(ann), output_path=str(video), fps=8, paper_color="#FFF2CC")
        self.assertEqual(resp["type"], "done", resp)
        self.assertGreater(video.stat().st_size, 0)

        # Màu giấy phải được truyền tới bộ render: khung đầu là giấy trắng #FFF2CC (BGR 204,242,255).
        cap = cv2.VideoCapture(str(video))
        ok, frame = cap.read()
        cap.release()
        self.assertTrue(ok)
        corner = frame[5, 5].astype(int)
        self.assertLess(int(np.abs(corner - np.array([204, 242, 255])).max()), 16, f"màu giấy sai: {corner}")

        # Tiến độ in ra của bộ render phải đi vào stderr, không phải stdout (đã được kiểm ở _read_json).
        self.assertGreater(self.stderr_path.stat().st_size, 0)

        if shutil.which("ffmpeg"):
            merged = self.tmp / "merged.mp4"
            copy2 = self.tmp / "scene2.mp4"
            shutil.copy(video, copy2)
            resp = self.rpc(action="merge_scenes", task_id="m", video_paths=[str(video), str(copy2)],
                            output_path=str(merged))
            self.assertEqual(resp["type"], "done", resp)
            self.assertGreater(merged.stat().st_size, 0)

    def test_05_bad_requests_do_not_kill_runner(self):
        resp = self.rpc(action="render_scene", image_path=str(self.image), annotation_path="/khong/co.json",
                        output_path=str(self.tmp / "x.mp4"))
        self.assertEqual(resp["type"], "error")
        resp = self.rpc(action="render_scene", image_path=str(self.image), annotation_path=str(self.image),
                        output_path=str(self.tmp / "x.mp4"), paper_color="khong-phai-mau")
        self.assertEqual(resp["type"], "error")
        resp = self.rpc(action="merge_scenes", video_paths=["/khong/co.mp4"], output_path=str(self.tmp / "m.mp4"))
        self.assertEqual(resp["type"], "error")
        self.assertEqual(self.rpc(action="ping")["type"], "pong", "runner phải còn sống sau các lỗi")


if __name__ == "__main__":
    unittest.main()
