"""P3: dự án V1 dùng cùng cài đặt render như render_scene và cache key phản ánh kiểu vẽ."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import cv2  # noqa: E402
import numpy as np  # noqa: E402
import project_export as pe  # noqa: E402
import whiteboard_settings as ws  # noqa: E402


class SettingsParity(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        d = Path(self.td.name)
        self.img = d / "a.png"
        cv2.imwrite(str(self.img), np.full((40, 60, 3), 255, np.uint8))
        self.ann = d / "a.json"
        self.ann.write_text("{}")

    def tearDown(self):
        self.td.cleanup()

    def r(self, **extra):
        return {"scene": {"imagePath": str(self.img), "annotationPath": str(self.ann), **extra}, "durationMs": 2000}

    def test_scene_settings_match_runner(self):
        proj = {"fps": 24, "paperColor": "ffffff", "hand": "brush"}
        s = pe._scene_settings(proj, self.r(colorFill="none", subjectFirst=True))
        direct = ws.resolve_render_settings({"image_path": str(self.img), "fps": 24, "paper_color": "ffffff",
                                             "hand_path": "brush", "color_fill": "none", "subject_first": True})
        self.assertEqual(s, direct)
        self.assertEqual(s["paper_color"], "#FFFFFF")
        self.assertTrue(s["hand_path"].endswith("calligraphy-brush.png"))

    def test_cache_key_changes_with_style(self):
        proj = {"fps": 30}
        a = pe._scene_cache_key(proj, self.r(colorFill="none"))
        b = pe._scene_cache_key(proj, self.r(colorFill="contour-wipe"))
        c = pe._scene_cache_key(proj, self.r(colorFill="none", subjectFirst=True))
        self.assertEqual(len({a, b, c}), 3)


if __name__ == "__main__":
    unittest.main()
