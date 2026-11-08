"""Malformed and default WB bundles must not silently alter dialogue."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import wb_import

FIXTURE = Path(__file__).parent / "fixtures/wb_import/single_scene_three_cues.srt"


class ImportRegressions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.srt = Path(self.tmp.name) / "story.v2.srt"
        self.srt.write_bytes(FIXTURE.read_bytes())
        self.meta_path = self.srt.with_suffix(".wb.json")
        self.meta = json.loads(FIXTURE.with_suffix(".wb.json").read_text())

    def inspect(self):
        self.meta_path.write_text(json.dumps(self.meta, ensure_ascii=False))
        return wb_import.inspect_wb_bundle(str(self.srt), str(self.meta_path))

    def test_null_voice_is_unassigned_not_an_exception(self):
        self.meta["speech"]["speakers"][0]["voice_id"] = None
        result = self.inspect()
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["speakers"][0]["voiceId"], "")
        self.assertTrue(result["warnings"])

    def test_multidot_discovery_keeps_entire_stem(self):
        self.inspect()
        self.assertEqual(wb_import.find_wb_json_for_srt(self.srt), self.meta_path)
        self.assertTrue(wb_import.inspect_wb_bundle(str(self.srt))["valid"])

    def test_metadata_cannot_change_srt_or_group_order(self):
        original = copy.deepcopy(self.meta)
        mutations = {
            "speech": lambda m: m["cues"][0].update(spoken_text="Thay lời"),
            "text": lambda m: m["cues"][0].update(text="Thay lời"),
            "time": lambda m: m["cues"][0].update(start_ms=999999),
            "narrator": lambda m: m["cues"][1].update(speaker_id=None),
            "order": lambda m: m["scenes"][0]["cue_ids"].reverse(),
            "scene_time": lambda m: m["scenes"][0].update(end_ms=100),
            "scene_index": lambda m: m["scenes"][0].update(index=2),
            "cue_scene": lambda m: m["cues"][0].update(scene_index=9),
            "duplicate_speaker": lambda m: m["speech"]["speakers"].append(copy.deepcopy(m["speech"]["speakers"][0])),
            "duplicate_cue": lambda m: m["cues"][1].update(id="cue-1"),
            "missing_cue": lambda m: m["scenes"][0]["cue_ids"].pop(),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                self.meta = copy.deepcopy(original)
                mutate(self.meta)
                result = self.inspect()
                self.assertFalse(result["valid"])
                self.assertEqual(result["scenes"], [])

    def test_fingerprint_changes_for_metadata_only_edits(self):
        before = self.inspect()
        self.meta["title"] = "Tiêu đề mới"
        after = self.inspect()
        self.assertTrue(after["valid"], after["errors"])
        self.assertNotEqual(before["bundleFingerprint"], after["bundleFingerprint"])
        self.assertEqual(before["wbJsonPath"], str(self.meta_path.resolve()))

    def test_null_voice_through_real_runner(self):
        self.meta["speech"]["speakers"][0]["voice_id"] = None
        self.inspect()
        request = {"action": "inspect_wb_import", "task_id": "null-voice", "srt_path": str(self.srt)}
        runner = Path(__file__).resolve().parents[1] / "whiteboard_runner.py"
        result = subprocess.run([sys.executable, str(runner)],
                                input=json.dumps(request) + '\n{"action":"exit"}\n',
                                capture_output=True, text=True, timeout=15, check=True)
        response = [json.loads(line) for line in result.stdout.splitlines()][-1]
        self.assertEqual(response["type"], "done", response)
        self.assertTrue(response["data"]["valid"])
        self.assertEqual(response["data"]["scenesCount"], 1)
        self.assertEqual(response["data"]["cuesCount"], 3)

    def test_wrong_types_report_errors(self):
        original = copy.deepcopy(self.meta)
        for value in [[], None, dict(original, speech=None), dict(original, cues=[None]),
                      dict(original, srt_sha256=123), dict(original, scenes=[{"cue_ids": [None]}])]:
            with self.subTest(value=value):
                self.meta = value
                result = self.inspect()
                self.assertFalse(result["valid"])

    def test_multiline_turn_keeps_clean_text(self):
        self.srt.write_text(self.srt.read_text().replace("[Thầy giáo]: Chào các em.", "[Thầy giáo]: Chào các em.\nHôm nay học bài mới."))
        self.meta["srt_sha256"] = wb_import.compute_file_sha256(self.srt)
        self.meta["cues"][1]["text"] = "[Thầy giáo]: Chào các em.\nHôm nay học bài mới."
        self.meta["cues"][1]["spoken_text"] = "Chào các em.\nHôm nay học bài mới."
        self.meta["scenes"][0]["text"] = "\n".join(c["spoken_text"] for c in self.meta["cues"])
        result = self.inspect()
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["scenes"][0]["cues"][1]["text"], self.meta["cues"][1]["spoken_text"])

    def test_short_scene_duration_is_not_extended(self):
        self.srt.write_text("1\n00:00:00,000 --> 00:00:00,400\nXin chào.\n")
        self.meta["srt_sha256"] = wb_import.compute_file_sha256(self.srt)
        self.meta["speech"]["speakers"] = []
        self.meta["cues"] = [{"id": "c", "index": 1, "scene_index": 1, "start_ms": 0,
                              "end_ms": 400, "text": "Xin chào.", "spoken_text": "Xin chào.", "speaker_id": None}]
        self.meta["scenes"] = [{"index": 1, "start_ms": 0, "end_ms": 400, "cue_ids": ["c"], "text": "Xin chào."}]
        self.meta["timing"]["duration_ms"] = 400
        result = self.inspect()
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["scenes"][0]["durationMs"], 400)


if __name__ == "__main__":
    unittest.main()
