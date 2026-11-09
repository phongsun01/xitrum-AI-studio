"""Chèn thumbnail phải chạy được khi chỉ có ffmpeg (bản đóng gói theo app không kèm ffprobe)."""
import base64
import io
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import media_utils  # noqa: E402
import whiteboard_audio  # noqa: E402
import whiteboard_thumbnail as wt  # noqa: E402

FF = media_utils.find_ffmpeg()


@unittest.skipUnless(FF, "cần ffmpeg")
class ThumbnailWithoutFfprobe(unittest.TestCase):
    def test_prepend_without_ffprobe(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            scene = td / "s.mp4"
            subprocess.run([FF, "-y", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x180:r=30:d=1",
                            "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:v", "libx264",
                            "-pix_fmt", "yuv420p", "-c:a", "aac", str(scene)], check=True)
            png = io.BytesIO()
            Image.new("RGB", (1280, 720), (240, 0, 0)).save(png, format="PNG")
            cover = base64.b64encode(png.getvalue()).decode()
            out = td / "o.mp4"
            with patch.object(wt, "resolve_ffmpeg_and_probe", return_value=(FF, None)):
                wt.prepend_thumbnail(str(scene), cover, str(out))
            info = media_utils.probe_media(out)
            self.assertEqual(info["video"]["frames"], 90)  # 60 khung bìa (2 s) + 30 khung cảnh
            self.assertIsNotNone(info["audio"])
            import av
            import numpy as np
            with av.open(str(out)) as container:
                frames = list(container.decode(video=0))
            self.assertEqual(len(frames), 90)
            red = frames[0].to_ndarray(format="rgb24").mean(axis=(0,1))
            blue = frames[60].to_ndarray(format="rgb24").mean(axis=(0,1))
            self.assertGreater(red[0], 200)
            self.assertGreater(blue[2], 200)
            # Cover must delay speech by exactly two seconds, not only retain an audio stream.
            with av.open(str(out)) as container:
                samples = np.concatenate([frame.to_ndarray().reshape(-1) for frame in container.decode(audio=0)])
            rate = info["audio"]["rate"]
            self.assertLess(float(np.abs(samples[:int(rate*1.8)]).max()), 0.01)
            self.assertGreater(float(np.abs(samples[int(rate*2.1):int(rate*2.8)]).max()), 0.02)


if __name__ == "__main__":
    unittest.main()
