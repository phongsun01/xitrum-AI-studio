"""Kiểm thử liên thông toàn trình (Roundtrip & Auto-timing test) cho WB Schema 3.

Kiểm tra:
1. Đọc và xác thực kịch bản WB Schema 3 (.wb.json & .srt)
2. Ánh xạ kịch bản sang cấu trúc scene / cue / speaker
3. Căn thời gian đa giọng đọc (Multi-speaker TTS timing simulation)
4. Tái nhập từ tệp .aligned.srt xuất ra, bảo toàn vai nhân vật và mốc thời gian
"""

import json
import math
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

# Thêm scripts của sidecar-whiteboard và sidecar-tts vào path
SIDE_WB_DIR = Path(__file__).parent.parent
SIDE_TTS_DIR = SIDE_WB_DIR.parent / "sidecar-tts"
sys.path.insert(0, str(SIDE_WB_DIR / "scripts"))
sys.path.insert(0, str(SIDE_TTS_DIR))

# Mock module soundfile nếu môi trường test chưa cài đặt
if "soundfile" not in sys.modules:
    try:
        import soundfile
    except ImportError:
        mock_sf = types.ModuleType("soundfile")
        def _mock_write(file, data, samplerate):
            import wave
            with wave.open(str(file), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(samplerate)
                import numpy as np
                pcm16 = (np.clip(data, -1.0, 1.0) * 32767).astype("int16")
                wf.writeframes(pcm16.tobytes())
        mock_sf.write = _mock_write
        sys.modules["soundfile"] = mock_sf

import wb_import  # noqa: E402
from parse_srt import parse_srt  # noqa: E402

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "wb_import"


class MockTtsEngine:
    """Mock engine giả lập VieNeu TTS với các preset voices chuẩn."""

    def __init__(self):
        self.sample_rate = 24000
        self._default_voice = "Thùy Dung"
        self._preset_voices = {
            "Thùy Dung", "Thái Sơn", "Thục Đoan", "Minh Triết", "Mỹ Duyên",
            "Đức Trí", "Kim Thanh", "Adam", "Hải Đăng", "Trúc Ly",
            "Thiện Minh", "Mai Anh", "Ngọc Huyền", "Minh Đức", "Phạm Tuyên",
            "Xuân Vĩnh", "Thanh Bình", "Ngọc Linh", "Đoan Trang", "Quỳnh Anh",
            "Quốc Tuấn", "Thiền Tâm Đức", "Adam bựa", "Quang Sơn", "Ngọc Trân",
        }
        self.called_voices = []

    def infer(self, text, voice=None):
        import numpy as np
        self.called_voices.append(voice)
        # Sinh 0.5s âm thanh mẫu cho mỗi từ để giả lập độ dài âm thanh
        words = max(1, len(text.split()))
        duration_sec = 0.3 + words * 0.25
        samples_count = int(duration_sec * self.sample_rate)
        return np.ones(samples_count, dtype=np.float32) * 0.1


class TestWbImportRoundtrip(unittest.TestCase):
    def setUp(self):
        self.mock_tts = MockTtsEngine()

    def test_multi_scene_import_and_tts_alignment_roundtrip(self):
        srt_path = FIXTURES_DIR / "multi_scene_twelve_cues.srt"
        wb_json_path = FIXTURES_DIR / "multi_scene_twelve_cues.wb.json"

        # 1. Inspect bộ WB
        inspect_res = wb_import.inspect_wb_bundle(str(srt_path), str(wb_json_path))
        self.assertTrue(inspect_res["valid"], f"Inspect errors: {inspect_res['errors']}")
        self.assertEqual(inspect_res["scenesCount"], 4)
        self.assertEqual(inspect_res["cuesCount"], 12)
        self.assertEqual(inspect_res["speakersCount"], 3)
        self.assertEqual(inspect_res["speechMode"], "characters")

        initial_scenes = inspect_res["scenes"]
        self.assertEqual(len(initial_scenes), 4)

        # Kiểm tra phân cảnh ban đầu: mỗi scene có đúng 3 cues
        for idx, sc in enumerate(initial_scenes, 1):
            self.assertEqual(sc["order"], idx)
            self.assertEqual(len(sc["cues"]), 3)
            expected_cues = list(range((idx - 1) * 3 + 1, idx * 3 + 1))
            actual_cues = [c["index"] for c in sc["cues"]]
            self.assertEqual(actual_cues, expected_cues)

        # 2. Giả lập quá trình chạy TTS căn thời gian (simulate generate_srt_tts_aligned)
        import tts_runner

        # Patch get_tts trong tts_runner để dùng MockTtsEngine
        original_get_tts = tts_runner.get_tts
        tts_runner.get_tts = lambda: self.mock_tts

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                out_audio = Path(tmpdir) / "master_audio.wav"
                scene_cue_ranges = [sc["cueRange"] for sc in initial_scenes]
                self.assertEqual(scene_cue_ranges, [[1, 3], [4, 6], [7, 9], [10, 12]])

                all_cues_payload = []
                for sc in initial_scenes:
                    all_cues_payload.extend(sc["cues"])

                speech_config = {
                    "mode": "characters",
                    "defaultVoiceId": "Thùy Dung",
                    "speakers": inspect_res["speakers"],
                }

                tts_res = tts_runner.generate_srt_tts_aligned(
                    srt_path=str(srt_path),
                    voice_id="Thùy Dung",
                    output_path=str(out_audio),
                    scene_cue_ranges=scene_cue_ranges,
                    speech_config=speech_config,
                    custom_cues=all_cues_payload,
                )

                # 3. Kiểm tra kết quả căn thời gian
                self.assertTrue(os.path.exists(out_audio))
                aligned_srt_path = tts_res["aligned_srt_path"]
                self.assertTrue(os.path.exists(aligned_srt_path))

                aligned_scenes = tts_res["scenes"]
                aligned_cues = tts_res["cues"]

                # Số lượng cảnh không bị phân rã (vẫn đúng 4 cảnh)
                self.assertEqual(len(aligned_scenes), 4)
                self.assertEqual(len(aligned_cues), 12)

                # Kiểm tra từng cảnh sau khi căn timing
                cursor_ms = 0
                for i, asc in enumerate(aligned_scenes):
                    self.assertEqual(asc["sceneIndex"], i + 1)
                    self.assertEqual(asc["cueRange"], scene_cue_ranges[i])
                    self.assertEqual(asc["timelineStartMs"], cursor_ms)
                    self.assertGreater(asc["sceneDurationMs"], 0)
                    self.assertEqual(asc["timelineEndMs"], cursor_ms + asc["sceneDurationMs"])
                    self.assertGreater(asc["speechEndMs"], 0)
                    self.assertLessEqual(asc["speechEndMs"], asc["sceneDurationMs"])
                    cursor_ms = asc["timelineEndMs"]

                # 4. Kiểm tra phân vai và giọng đọc thực tế
                # Danh sách voice đã gọi phải chứa các giọng của nhân vật:
                # Thầy giáo: Hải Đăng, An: Thái Sơn, Mai: Trúc Ly, Người dẫn chuyện: Thùy Dung
                called_set = set(self.mock_tts.called_voices)
                self.assertIn("Thái Sơn", called_set)
                self.assertIn("Trúc Ly", called_set)
                self.assertIn("Hải Đăng", called_set)
                self.assertIn("Thùy Dung", called_set)

                # 5. Kiểm tra tệp .aligned.srt vừa xuất
                aligned_srt_content = Path(aligned_srt_path).read_text(encoding="utf-8")
                # Các câu có nhân vật phải mang nhãn [Tên]:
                self.assertIn("[Thầy giáo]:", aligned_srt_content)
                self.assertIn("[An]:", aligned_srt_content)
                self.assertIn("[Mai]:", aligned_srt_content)
                # Câu người dẫn chuyện (cue 1, 7, 12) không có nhãn
                self.assertIn("Mặt trời vừa lên, lớp học đã rộn rã tiếng cười.", aligned_srt_content)
                self.assertNotIn("[None]:", aligned_srt_content)

                # 6. Tái nhập từ tệp .aligned.srt xuất ra
                reparsed_cues = parse_srt(aligned_srt_content)
                self.assertEqual(len(reparsed_cues), 12)
                self.assertIsNone(reparsed_cues[0]["speakerName"])
                self.assertEqual(reparsed_cues[1]["speakerName"], "Thầy giáo")
                self.assertEqual(reparsed_cues[2]["speakerName"], "An")
                self.assertEqual(reparsed_cues[4]["speakerName"], "Mai")

                # 7. Ánh xạ timing vào scenes (mô phỏng applyAlignedTiming)
                next_scenes = []
                for idx, orig_sc in enumerate(initial_scenes):
                    timing = aligned_scenes[idx]
                    sc_cues = [c for c in aligned_cues if timing["cueRange"][0] <= c["index"] <= timing["cueRange"][1]]
                    next_scenes.append({
                        **orig_sc,
                        "timelineStartMs": timing["timelineStartMs"],
                        "timelineEndMs": timing["timelineEndMs"],
                        "durationMs": timing["sceneDurationMs"],
                        "speechEndMs": timing["speechEndMs"],
                        "cues": sc_cues,
                    })

                self.assertEqual(len(next_scenes), 4)
                self.assertEqual(len(next_scenes[0]["cues"]), 3)
                self.assertEqual(len(next_scenes[1]["cues"]), 3)
                self.assertEqual(len(next_scenes[2]["cues"]), 3)
                self.assertEqual(len(next_scenes[3]["cues"]), 3)

        finally:
            tts_runner.get_tts = original_get_tts

    def test_single_scene_three_cues_timing_roundtrip(self):
        srt_path = FIXTURES_DIR / "single_scene_three_cues.srt"
        wb_json_path = FIXTURES_DIR / "single_scene_three_cues.wb.json"

        inspect_res = wb_import.inspect_wb_bundle(str(srt_path), str(wb_json_path))
        self.assertTrue(inspect_res["valid"])
        self.assertEqual(inspect_res["scenesCount"], 1)
        self.assertEqual(inspect_res["cuesCount"], 3)

        initial_scenes = inspect_res["scenes"]
        self.assertEqual(len(initial_scenes), 1)
        self.assertEqual(len(initial_scenes[0]["cues"]), 3)

        import tts_runner
        original_get_tts = tts_runner.get_tts
        tts_runner.get_tts = lambda: self.mock_tts

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                out_audio = Path(tmpdir) / "out.wav"
                scene_cue_ranges = [initial_scenes[0]["cueRange"]]
                self.assertEqual(scene_cue_ranges, [[1, 3]])

                speech_config = {
                    "mode": "characters",
                    "defaultVoiceId": "Thùy Dung",
                    "speakers": inspect_res["speakers"],
                }

                tts_res = tts_runner.generate_srt_tts_aligned(
                    srt_path=str(srt_path),
                    voice_id="Thùy Dung",
                    output_path=str(out_audio),
                    scene_cue_ranges=scene_cue_ranges,
                    speech_config=speech_config,
                    custom_cues=initial_scenes[0]["cues"],
                )

                self.assertEqual(len(tts_res["scenes"]), 1)
                self.assertEqual(len(tts_res["cues"]), 3)
                self.assertEqual(tts_res["scenes"][0]["cueRange"], [1, 3])

                # Kiểm tra nhân vật của 3 cues
                cues = tts_res["cues"]
                self.assertIsNone(cues[0]["speakerName"])
                self.assertEqual(cues[1]["speakerName"], "Thầy giáo")
                self.assertEqual(cues[2]["speakerName"], "Học sinh")
        finally:
            tts_runner.get_tts = original_get_tts


if __name__ == "__main__":
    unittest.main()
