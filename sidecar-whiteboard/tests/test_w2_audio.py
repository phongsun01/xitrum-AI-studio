"""
Kiểm thử Giai đoạn W2 cho Whiteboard: Audio xuyên suốt và kết nối TTS.
Kiểm tra:
1. Probe audio duration và stream thông qua ffprobe/ffmpeg.
2. Trích xuất đoạn audio [start_ms, end_ms) chính xác, chuẩn hóa PCM/AAC.
3. Tạo silence audio (đoạn im lặng) với đúng sample rate/channels.
4. Render 1 phân cảnh kèm audio riêng (A/V sync).
5. Ghép nhiều phân cảnh kèm Master Audio toàn bài và kiểm tra đầu ra video có stream tiếng AAC đầy đủ.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import cv2

RUNNER = Path(__file__).resolve().parents[1] / "whiteboard_runner.py"
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

import whiteboard_audio


class WhiteboardW2AudioTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not FIXTURES_DIR.exists() or not list(FIXTURES_DIR.glob("*.png")):
            from generate_fixtures import make_fixtures
            make_fixtures(FIXTURES_DIR)

        cls.tmp = Path(tempfile.mkdtemp(prefix="wb_w2_"))
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

        # Tạo một audio giả lập 4 giây tần số 440Hz (beep) để test audio probe & mux
        cls.test_audio_wav = cls.tmp / "test_beep.wav"
        ffmpeg, _ = whiteboard_audio.resolve_ffmpeg_and_probe()
        assert ffmpeg is not None, "Cần ffmpeg để chạy test audio"
        subprocess.run(
            [
                ffmpeg, "-y",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                "-ar", "44100", "-ac", "2",
                str(cls.test_audio_wav),
            ],
            capture_output=True,
            check=True,
        )

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

    def test_01_probe_and_extract_audio_segment(self):
        """Đo duration và trích xuất đoạn audio 1.5s chính xác."""
        dur_ms = whiteboard_audio.probe_audio_duration_ms(self.test_audio_wav)
        self.assertAlmostEqual(dur_ms, 4000, delta=100)

        seg_out = self.tmp / "seg_1500.aac"
        ok = whiteboard_audio.extract_audio_segment(self.test_audio_wav, seg_out, 1000, 2500)
        self.assertTrue(ok)
        self.assertTrue(seg_out.exists())

        seg_dur = whiteboard_audio.probe_audio_duration_ms(seg_out)
        self.assertAlmostEqual(seg_dur, 1500, delta=150)

    def test_02_generate_silence_audio(self):
        """Tạo đoạn silence audio chuẩn hóa."""
        silence_out = self.tmp / "silence_2000.aac"
        ok = whiteboard_audio.generate_silence_audio(silence_out, 2000)
        self.assertTrue(ok)
        self.assertTrue(silence_out.exists())
        silence_dur = whiteboard_audio.probe_audio_duration_ms(silence_out)
        self.assertAlmostEqual(silence_dur, 2000, delta=150)

    def test_03_render_scene_with_audio(self):
        """Render 1 phân cảnh kèm file âm thanh và kiểm tra video đầu ra có stream audio."""
        img = FIXTURES_DIR / "01_line_art_white.png"
        ann = self.tmp / "s_audio.annotation.json"
        video_out = self.tmp / "s_audio.mp4"

        self.assertEqual(
            self.rpc(
                action="generate_annotation",
                image_path=str(img),
                duration_ms=2000,
                output_path=str(ann),
            )["type"],
            "done",
        )

        resp = self.rpc(
            action="render_scene",
            image_path=str(img),
            annotation_path=str(ann),
            output_path=str(video_out),
            fps=10,
            audio_path=str(self.test_audio_wav),
        )
        self.assertEqual(resp["type"], "done", resp)
        self.assertTrue(video_out.exists())

        # Kiểm tra video có chứa stream audio bằng ffprobe
        ffmpeg, ffprobe = whiteboard_audio.resolve_ffmpeg_and_probe()
        probe_bin = ffprobe or ffmpeg
        res = subprocess.run(
            [probe_bin, "-i", str(video_out)],
            capture_output=True,
            text=True,
        )
        output_info = res.stdout + res.stderr
        self.assertIn("Audio: aac", output_info, "Video đầu ra phải có stream audio AAC")

    def test_04_merge_scenes_with_master_audio(self):
        """Ghép nhiều cảnh với master audio toàn bài."""
        img1 = FIXTURES_DIR / "01_line_art_white.png"
        img2 = FIXTURES_DIR / "02_line_art_beige.png"

        ann1 = self.tmp / "m1.annotation.json"
        ann2 = self.tmp / "m2.annotation.json"
        v1 = self.tmp / "m1.mp4"
        v2 = self.tmp / "m2.mp4"
        final_video = self.tmp / "master_final.mp4"

        for img, ann, v in [(img1, ann1, v1), (img2, ann2, v2)]:
            self.rpc(action="generate_annotation", image_path=str(img), duration_ms=2000, output_path=str(ann))
            self.rpc(action="render_scene", image_path=str(img), annotation_path=str(ann), output_path=str(v), fps=10)

        merge_resp = self.rpc(
            action="merge_scenes",
            video_paths=[str(v1), str(v2)],
            output_path=str(final_video),
            master_audio_path=str(self.test_audio_wav),
        )
        self.assertEqual(merge_resp["type"], "done", merge_resp)
        self.assertTrue(final_video.exists())

        ffmpeg, ffprobe = whiteboard_audio.resolve_ffmpeg_and_probe()
        probe_bin = ffprobe or ffmpeg
        res = subprocess.run([probe_bin, "-i", str(final_video)], capture_output=True, text=True)
        self.assertIn("Audio: aac", res.stdout + res.stderr, "Video cuối phải có master audio AAC")


if __name__ == "__main__":
    unittest.main()

