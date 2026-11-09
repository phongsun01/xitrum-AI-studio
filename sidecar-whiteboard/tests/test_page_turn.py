"""P5: lật trang phải→trái giữa các cảnh, giữ nguyên số khung hình và audio."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import media_utils  # noqa: E402
import merge_scenes  # noqa: E402
import page_turn  # noqa: E402

FF = media_utils.find_ffmpeg()


def frames(path):
    import cv2
    cap = cv2.VideoCapture(str(path))
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        out.append(f)
    return out


class PageTurnFrames(unittest.TestCase):
    def setUp(self):
        self.a = np.full((90, 160, 3), (30, 30, 220), np.uint8)
        self.b = np.full((90, 160, 3), (230, 230, 230), np.uint8)

    def test_endpoints(self):
        np.testing.assert_array_equal(page_turn.page_turn_frame(self.a, self.b, 0.0), self.a)
        np.testing.assert_array_equal(page_turn.page_turn_frame(self.a, self.b, 1.0), self.b)

    def test_edge_moves_right_to_left(self):
        def edge(p):
            f = page_turn.page_turn_frame(self.a, self.b, p)
            reddish = (f[45, :, 2].astype(int) - f[45, :, 0].astype(int)) > 80
            return int(np.nonzero(reddish)[0].max()) if reddish.any() else -1
        xs = [edge(p) for p in (0.2, 0.4, 0.6, 0.8)]
        self.assertTrue(all(x1 > x2 for x1, x2 in zip(xs, xs[1:])), xs)

    def test_static_tail_detection(self):
        still = [self.a.copy() for _ in range(10)]
        self.assertEqual(page_turn.plan_static_tail(still, 8), 8)
        moving = [np.full_like(self.a, i * 20) for i in range(10)]
        self.assertEqual(page_turn.plan_static_tail(moving, 8), 0)


@unittest.skipUnless(FF, "cần ffmpeg")
class MergeWithPageTurn(unittest.TestCase):
    def clip(self, path, src, seconds, freq):
        subprocess.run([FF, "-y", "-v", "error", "-f", "lavfi", "-i", f"{src}:s=160x90:r=30:d={seconds}" if "=" in src else f"{src}=s=160x90:r=30:d={seconds}",
                        "-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100:duration={seconds}",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)], check=True)

    def test_frame_count_audio_and_changed_frames(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            a, b, c = td / "a.mp4", td / "b.mp4", td / "c.mp4"
            self.clip(a, "color=c=red", 2, 440)
            self.clip(b, "color=c=blue", 2, 880)
            self.clip(c, "color=c=green", 1, 1320)
            plain, turned = td / "p.mp4", td / "t.mp4"
            self.assertEqual(merge_scenes.main(["--inputs", str(a), str(b), str(c), "--output", str(plain)]), 0)
            self.assertEqual(merge_scenes.main(["--inputs", str(a), str(b), str(c), "--output", str(turned),
                                                "--page-turn-ms", "600"]), 0)
            fp, ft = frames(plain), frames(turned)
            self.assertEqual(len(fp), 150)
            self.assertEqual(len(ft), 150)
            changed = [i for i, (x, y) in enumerate(zip(fp, ft)) if np.abs(x.astype(int) - y.astype(int)).mean() > 3]
            # 600 ms @30fps = 18 khung cuối cảnh 1 (42–59) và cảnh 2 (102–119); phần còn lại không đổi.
            self.assertEqual(changed, list(range(42, 60)) + list(range(102, 120)))
            pi, ti = media_utils.probe_media(plain), media_utils.probe_media(turned)
            self.assertAlmostEqual(pi["duration_s"], ti["duration_s"], delta=0.05)
            import av
            n = 0
            with av.open(str(turned)) as ct:
                rate = ct.streams.audio[0].rate
                for fr in ct.decode(audio=0):
                    n += fr.samples
            self.assertAlmostEqual(n / rate, 5.0, delta=0.05)

    def test_moving_tail_is_skipped(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            a, b = td / "a.mp4", td / "b.mp4"
            self.clip(a, "testsrc2", 2, 440)
            self.clip(b, "color=c=blue", 1, 880)
            plain, turned = td / "p.mp4", td / "t.mp4"
            merge_scenes.main(["--inputs", str(a), str(b), "--output", str(plain)])
            merge_scenes.main(["--inputs", str(a), str(b), "--output", str(turned), "--page-turn-ms", "600"])
            fp, ft = frames(plain), frames(turned)
            self.assertEqual(len(fp), len(ft))
            self.assertLess(max(np.abs(x.astype(int) - y.astype(int)).mean() for x, y in zip(fp, ft)), 3)

    def test_invalid_value_rejected(self):
        self.assertEqual(merge_scenes.main(["--inputs", "x.mp4", "--output", "y.mp4", "--page-turn-ms", "99999"]), 1)


if __name__ == "__main__":
    unittest.main()
