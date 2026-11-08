"""P3: ghép nhiều cảnh có audio không được trôi lệch so với hình; không cần ffprobe."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import av
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import merge_scenes  # noqa: E402
import media_utils  # noqa: E402

FF = media_utils.find_ffmpeg()


def make_clip(path, seconds, freq=None, fps=10, color="white", audio_seconds=None):
    cmd = [FF, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s=64x48:r={fps}:d={seconds}"]
    if freq:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100:duration={audio_seconds or seconds}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if freq:
        cmd += ["-c:a", "aac"]
    subprocess.run(cmd + [str(path)], check=True)


@unittest.skipUnless(FF, "cần ffmpeg")
class MergeAudioSync(unittest.TestCase):
    def test_audio_matches_video_and_no_ffprobe_needed(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            clips = []
            for i, (sec, f) in enumerate([(1.5, 440), (2.0, 880), (1.0, 1320)]):
                p = td / f"c{i}.mp4"
                make_clip(p, sec, f)
                clips.append(p)
            out = td / "out.mp4"
            old_path = os.environ.get("PATH", "")
            old_ff = os.environ.get("XITRUM_FFMPEG")
            # Bản ffmpeg đóng gói không có ffprobe: chỉ để ffmpeg trong một thư mục riêng, không đặt ffprobe vào PATH.
            iso = td / "bin"
            iso.mkdir()
            shutil.copy(FF, iso / "ffmpeg")
            os.environ["XITRUM_FFMPEG"] = str(iso / "ffmpeg")
            os.environ["PATH"] = str(iso)
            try:
                # Chặn cả resolver để ffprobe cài ở vị trí mặc định không che lỗi.
                with patch.object(media_utils, "find_ffprobe", side_effect=AssertionError("ffprobe must not be used")):
                    self.assertEqual(merge_scenes.main(["--inputs", *map(str, clips), "--output", str(out)]), 0)
            finally:
                os.environ["PATH"] = old_path
                if old_ff is None:
                    os.environ.pop("XITRUM_FFMPEG", None)
                else:
                    os.environ["XITRUM_FFMPEG"] = old_ff
            info = media_utils.probe_media(out)
            self.assertEqual(info["video"]["frames"], 45)
            self.assertIsNotNone(info["audio"])
            import av
            n = 0
            with av.open(str(out)) as c:
                rate = c.streams.audio[0].rate
                for fr in c.decode(audio=0):
                    n += fr.samples
            self.assertAlmostEqual(n / rate, 4.5, delta=0.05)

    def test_mixed_with_and_without_audio(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            a, b = td / "a.mp4", td / "b.mp4"
            make_clip(a, 1.0, 440)
            make_clip(b, 1.0, None)
            out = td / "o.mp4"
            self.assertEqual(merge_scenes.main(["--inputs", str(a), str(b), "--output", str(out)]), 0)
            info = media_utils.probe_media(out)
            self.assertEqual(info["video"]["frames"], 20)
            self.assertIsNotNone(info["audio"])

    def test_video_only(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            a, b = td / "a.mp4", td / "b.mp4"
            make_clip(a, 1.0)
            make_clip(b, 1.0)
            out = td / "o.mp4"
            self.assertEqual(merge_scenes.main(["--inputs", str(a), str(b), "--output", str(out)]), 0)
            info = media_utils.probe_media(out)
            self.assertEqual(info["video"]["frames"], 20)
            self.assertIsNone(info["audio"])

    def test_copy_uses_video_duration_when_audio_is_longer(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            clips = [td / f"c{i}.mp4" for i in range(6)]
            for p in clips:
                make_clip(p, 0.3, 440, audio_seconds=0.47)
            out = td / "out.mp4"
            self.assertTrue(merge_scenes._ffmpeg_concat_copy(clips, out))
            with av.open(str(out)) as container:
                times = [float(f.time) for f in container.decode(video=0)]
            np.testing.assert_allclose(times, np.arange(18) / 10, atol=0.001)
            self.assertAlmostEqual(media_utils.probe_media(out)["duration_s"], 1.8, delta=0.05)

    def test_tone_changes_follow_visual_cuts_with_mixed_fps(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            clips = []
            for i in range(12):
                p = td / f"c{i}.mp4"
                make_clip(p, 0.4 if i == 0 else 0.35, 440 if i % 2 == 0 else 880,
                          fps=10 if i == 0 else 20, color="white" if i % 2 == 0 else "black")
                clips.append(p)
            out = td / "out.mp4"
            self.assertTrue(merge_scenes._ffmpeg_concat_copy(clips, out))
            with av.open(str(out)) as container:
                frames = [(float(f.time), f.to_ndarray(format="gray").mean() > 128)
                          for f in container.decode(video=0)]
            with av.open(str(out)) as container:
                rate = container.streams.audio[0].rate
                audio = np.concatenate([f.to_ndarray().mean(axis=0) for f in container.decode(audio=0)])
            cuts = [(t, white) for i, (t, white) in enumerate(frames)
                    if i == 0 or white != frames[i - 1][1]]
            self.assertEqual(len(cuts), len(clips))
            for t, white in cuts:
                samples = audio[int((t + 0.05) * rate):int((t + 0.15) * rate)]
                spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
                frequency = np.argmax(spectrum) * rate / len(samples)
                self.assertAlmostEqual(frequency, 440 if white else 880, delta=20,
                                       msg=f"audio lệch hình tại {t:.3f}s")


if __name__ == "__main__":
    unittest.main()
