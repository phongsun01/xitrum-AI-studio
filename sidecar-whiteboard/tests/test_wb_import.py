"""Unit tests for wb_import validator & parser (Schema 3)."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

# Thêm scripts vào path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
import wb_import  # noqa: E402

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "wb_import"


class TestWbImport(unittest.TestCase):
    def test_single_scene_fixture_valid(self):
        srt_path = FIXTURES_DIR / "single_scene_three_cues.srt"
        res = wb_import.inspect_wb_bundle(str(srt_path))
        self.assertTrue(res["valid"], f"Errors: {res['errors']}")
        self.assertEqual(res["schemaVersion"], 3)
        self.assertTrue(res["srtSha256Matches"])
        self.assertEqual(res["scenesCount"], 1)
        self.assertEqual(res["cuesCount"], 3)
        self.assertEqual(res["speakersCount"], 2)
        self.assertEqual(len(res["scenes"]), 1)
        self.assertEqual(len(res["scenes"][0]["cues"]), 3)

        # Check speaker mapping
        cues = res["scenes"][0]["cues"]
        self.assertIsNone(cues[0]["speakerId"])
        self.assertEqual(cues[1]["speakerId"], "teacher")
        self.assertEqual(cues[1]["speakerName"], "Thầy giáo")
        self.assertEqual(cues[2]["speakerId"], "student")
        self.assertEqual(cues[2]["speakerName"], "Học sinh")

    def test_multi_scene_fixture_valid(self):
        srt_path = FIXTURES_DIR / "multi_scene_twelve_cues.srt"
        res = wb_import.inspect_wb_bundle(str(srt_path))
        self.assertTrue(res["valid"], f"Errors: {res['errors']}")
        self.assertEqual(res["schemaVersion"], 3)
        self.assertTrue(res["srtSha256Matches"])
        self.assertEqual(res["scenesCount"], 4)
        self.assertEqual(res["cuesCount"], 12)
        self.assertEqual(res["speakersCount"], 3)
        self.assertEqual(len(res["scenes"]), 4)

        # Check scene 2 has 3 cues and correct range
        sc2 = res["scenes"][1]
        self.assertEqual(len(sc2["cues"]), 3)
        self.assertEqual(sc2["cueRange"], [4, 6])

    def test_schema_mismatch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            srt_p = Path(tmpdir) / "test.srt"
            srt_p.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
            digest = wb_import.compute_file_sha256(srt_p)

            meta = {
                "schema_version": 99,
                "srt_sha256": digest,
                "cues": [{"id": "c1", "index": 1, "start_ms": 0, "end_ms": 1000, "text": "Hello"}],
                "scenes": [{"index": 1, "start_ms": 0, "end_ms": 1000, "cue_ids": ["c1"], "text": "Hello"}],
            }
            json_p = Path(tmpdir) / "test.wb.json"
            json_p.write_text(json.dumps(meta), encoding="utf-8")

            res = wb_import.inspect_wb_bundle(str(srt_p), str(json_p))
            self.assertFalse(res["valid"])
            self.assertTrue(any("WB_SCHEMA_MISMATCH" in e for e in res["errors"]))

    def test_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            srt_p = Path(tmpdir) / "test.srt"
            srt_p.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")

            meta = {
                "schema_version": 3,
                "srt_sha256": "wrong_hash_1234567890abcdef",
                "cues": [{"id": "c1", "index": 1, "start_ms": 0, "end_ms": 1000, "text": "Hello"}],
                "scenes": [{"index": 1, "start_ms": 0, "end_ms": 1000, "cue_ids": ["c1"], "text": "Hello"}],
            }
            json_p = Path(tmpdir) / "test.wb.json"
            json_p.write_text(json.dumps(meta), encoding="utf-8")

            res = wb_import.inspect_wb_bundle(str(srt_p), str(json_p))
            self.assertFalse(res["valid"])
            self.assertFalse(res["srtSha256Matches"])
            self.assertTrue(any("WB_SRT_HASH_MISMATCH" in e for e in res["errors"]))

    def test_speaker_not_found(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            srt_p = Path(tmpdir) / "test.srt"
            srt_p.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
            digest = wb_import.compute_file_sha256(srt_p)

            meta = {
                "schema_version": 3,
                "srt_sha256": digest,
                "speech": {"mode": "characters", "speakers": [{"id": "sp1", "name": "A", "voice_id": "V"}]},
                "cues": [{"id": "c1", "index": 1, "start_ms": 0, "end_ms": 1000, "text": "Hello", "speaker_id": "sp_unknown"}],
                "scenes": [{"index": 1, "start_ms": 0, "end_ms": 1000, "cue_ids": ["c1"], "text": "Hello"}],
            }
            json_p = Path(tmpdir) / "test.wb.json"
            json_p.write_text(json.dumps(meta), encoding="utf-8")

            res = wb_import.inspect_wb_bundle(str(srt_p), str(json_p))
            self.assertFalse(res["valid"])
            self.assertTrue(any("WB_SPEAKER_NOT_FOUND" in e for e in res["errors"]))

    def test_scene_cue_invalid_or_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            srt_p = Path(tmpdir) / "test.srt"
            srt_p.write_text(
                "1\n00:00:00,000 --> 00:00:01,000\nC1\n\n2\n00:00:01,000 --> 00:00:02,000\nC2\n",
                encoding="utf-8",
            )
            digest = wb_import.compute_file_sha256(srt_p)

            # Scene 1 trỏ đến c1 và c_missing, bỏ sót c2
            meta = {
                "schema_version": 3,
                "srt_sha256": digest,
                "speech": {"mode": "characters", "speakers": []},
                "cues": [
                    {"id": "c1", "index": 1, "start_ms": 0, "end_ms": 1000, "text": "C1"},
                    {"id": "c2", "index": 2, "start_ms": 1000, "end_ms": 2000, "text": "C2"},
                ],
                "scenes": [
                    {"index": 1, "start_ms": 0, "end_ms": 1000, "cue_ids": ["c1", "c_missing"], "text": "C1"}
                ],
            }
            json_p = Path(tmpdir) / "test.wb.json"
            json_p.write_text(json.dumps(meta), encoding="utf-8")

            res = wb_import.inspect_wb_bundle(str(srt_p), str(json_p))
            self.assertFalse(res["valid"])
            self.assertTrue(any("WB_SCENE_CUE_INVALID" in e for e in res["errors"]))
            self.assertTrue(any("WB_SCENE_CUE_MISSING" in e for e in res["errors"]))

    def test_unknown_voice_is_preserved_until_user_corrects_it(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            srt = Path(tmpdir) / "story.srt"
            srt.write_bytes((FIXTURES_DIR / "single_scene_three_cues.srt").read_bytes())
            meta = json.loads((FIXTURES_DIR / "single_scene_three_cues.wb.json").read_text())
            meta["speech"]["speakers"][0]["voice_id"] = "Giọng Không Có Thật"
            target = srt.with_suffix(".wb.json")
            target.write_text(json.dumps(meta))
            result = wb_import.inspect_wb_bundle(str(srt))
            self.assertTrue(result["valid"], result["errors"])
            self.assertEqual(result["speakers"][0]["voiceId"], "Giọng Không Có Thật")
            self.assertTrue(any("chọn lại" in w for w in result["warnings"]))


if __name__ == "__main__":
    unittest.main()

