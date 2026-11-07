"""Integration checks for cover boundaries and audio synchronization in project export."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
import whiteboard_runner as runner
from whiteboard_audio import resolve_ffmpeg_and_probe
from whiteboard_thumbnail import prepend_thumbnail

FFMPEG, FFPROBE = resolve_ffmpeg_and_probe()


@unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg/ffprobe required")
class ThumbnailExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        png = io.BytesIO()
        Image.new("RGB", (1280, 720), (240, 0, 0)).save(png, format="PNG")
        self.cover = base64.b64encode(png.getvalue()).decode()

    def run_ffmpeg(self, *args):
        return subprocess.run([FFMPEG, "-y", "-v", "error", *map(str, args)], capture_output=True, check=True).stdout

    def make_scene(self, fps, audio):
        scene = self.root / "scene.mp4"
        args = ["-f", "lavfi", "-i", f"color=blue:s=320x180:r={fps}:d=1"]
        if audio:
            args += ["-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "aac"]
        self.run_ffmpeg(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", scene)
        return scene

    def assert_boundary(self, output, fps):
        info = json.loads(subprocess.check_output([FFPROBE, "-v", "error", "-show_streams", "-of", "json", str(output)]))
        video = next(s for s in info["streams"] if s["codec_type"] == "video")
        self.assertEqual(int(video["nb_frames"]), fps * 3)
        self.assertAlmostEqual(float(video["duration"]), 3, places=3)
        frames = self.run_ffmpeg("-i", output, "-vf", f"select='eq(n,{2*fps-1})+eq(n,{2*fps})'",
                                 "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-")
        frames = np.frombuffer(frames, dtype=np.uint8).reshape(2, 180, 320, 3)
        self.assertGreater(frames[0, :, :, 0].mean(), 200)  # final cover frame
        self.assertGreater(frames[1, :, :, 2].mean(), 200)  # first content frame
        return info

    def assert_delayed_audio(self, output):
        pcm = self.run_ffmpeg("-i", output, "-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "-")
        samples = np.frombuffer(pcm, dtype=np.float32)
        self.assertLess(np.abs(samples[:int(1.98 * 48000)]).max(), 0.002)
        self.assertGreater(np.abs(samples[int(2.1 * 48000):int(2.8 * 48000)]).mean(), 0.03)

    def test_silent_project_has_exact_two_second_cover_at_24fps(self):
        output = self.root / "output.mp4"
        prepend_thumbnail(str(self.make_scene(24, False)), self.cover, str(output))
        info = self.assert_boundary(output, 24)
        self.assertFalse(any(s["codec_type"] == "audio" for s in info["streams"]))

    def test_scene_audio_is_shifted_and_resume_does_not_duplicate_cover(self):
        scene = self.make_scene(30, True)
        output = self.root / "output.mp4"
        request = {"video_paths": [str(scene)], "output_path": str(output), "thumbnail_png": self.cover}
        runner.handle_merge_scenes(request)
        runner.handle_merge_scenes(request)  # Reused scene, fresh final assembly.
        self.assert_boundary(output, 30)
        self.assert_delayed_audio(output)
        self.assertFalse(list(self.root.glob("wb-*")))

    def test_master_audio_starts_after_cover(self):
        scene = self.make_scene(30, False)
        master = self.root / "master.wav"
        self.run_ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", master)
        output = self.root / "output.mp4"
        runner.handle_merge_scenes({"video_paths": [str(scene)], "output_path": str(output),
                                    "master_audio_path": str(master), "thumbnail_png": self.cover})
        self.assert_boundary(output, 30)
        self.assert_delayed_audio(output)

    def test_corrupt_cover_fails_without_output(self):
        output = self.root / "output.mp4"
        with self.assertRaises(Exception):
            prepend_thumbnail(str(self.make_scene(30, False)), "not a PNG", str(output))
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
