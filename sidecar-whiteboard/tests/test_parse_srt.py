"""Kiểm thử group_scenes: các cảnh phải lát kín timeline và tôn trọng [min, max] khi có thể."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from parse_srt import group_scenes, parse_srt  # noqa: E402


def cue(i, s, e):
    return {"index": i, "startMs": int(s * 1000), "endMs": int(e * 1000),
            "durMs": int((e - s) * 1000), "text": f"c{i}"}


def group(cues):
    return group_scenes(cues, 30, 25, 35)


class GroupScenesTest(unittest.TestCase):
    def assertTiles(self, scenes, cues):
        self.assertEqual(scenes[0]["timelineStartMs"], 0)
        self.assertEqual(scenes[-1]["timelineEndMs"], cues[-1]["endMs"])
        for a, b in zip(scenes, scenes[1:]):
            self.assertEqual(a["timelineEndMs"], b["timelineStartMs"])
        self.assertEqual(sum(s["sceneDurationMs"] for s in scenes), cues[-1]["endMs"])
        # mọi câu phụ đề thuộc đúng một cảnh, theo thứ tự
        covered = [i for s in scenes for i in range(s["cueRange"][0], s["cueRange"][1] + 1)]
        self.assertEqual(covered, [c["index"] for c in cues])

    def test_empty(self):
        self.assertEqual(group([]), [])

    def test_short_srt_single_scene_flagged_below_min(self):
        cues = [cue(1, 0, 5)]
        s = group(cues)
        self.assertEqual(len(s), 1)
        self.assertTrue(s[0]["belowMin"])
        self.assertTiles(s, cues)

    def test_single_long_cue_cannot_split(self):
        cues = [cue(1, 0, 60)]
        s = group(cues)
        self.assertEqual(len(s), 1)
        self.assertTrue(s[0]["aboveMax"])

    def test_gap_between_scenes_belongs_to_previous_scene(self):
        cues = [cue(1, 0, 30), cue(2, 33, 63)]
        s = group(cues)
        self.assertEqual([(x["timelineStartMs"], x["timelineEndMs"]) for x in s], [(0, 33000), (33000, 63000)])
        self.assertTiles(s, cues)

    def test_leading_silence_is_included(self):
        cues = [cue(1, 4, 34), cue(2, 34, 64)]
        s = group(cues)
        self.assertEqual(s[0]["timelineStartMs"], 0)
        self.assertEqual(s[0]["startMs"], 4000)  # startMs vẫn là mốc câu phụ đề đầu
        self.assertTiles(s, cues)

    def test_regular_srt_stays_in_range(self):
        cues = [cue(i + 1, i * 5, i * 5 + 5) for i in range(36)]  # 180 s
        s = group(cues)
        self.assertTiles(s, cues)
        for x in s:
            self.assertFalse(x["belowMin"] or x["aboveMax"], x)
        self.assertEqual(len(s), 6)

    def test_no_tiny_trailing_scene_when_avoidable(self):
        cues = [cue(i + 1, i * 5, i * 5 + 5) for i in range(14)]  # 70 s: [35][35] chứ không [30][30][10]
        s = group(cues)
        self.assertEqual([x["sceneDurationMs"] for x in s], [35000, 35000])

    def test_dp_prefers_fewer_violations_over_greedy(self):
        cues = [cue(1, 0, 20), cue(2, 20, 40), cue(3, 40, 70)]
        s = group(cues)
        self.assertTiles(s, cues)
        self.assertEqual(len(s), 2)

    def test_parse_srt_roundtrip(self):
        raw = "1\n00:00:00,000 --> 00:00:02,500\nXin chào\n\n2\n00:00:03,000 --> 00:00:05,000\nThế giới\n"
        cues = parse_srt(raw)
        self.assertEqual([c["text"] for c in cues], ["Xin chào", "Thế giới"])
        self.assertTiles(group(cues), cues)

    def test_parse_srt_speaker_prefix(self):
        raw = (
            "1\n00:00:00,000 --> 00:00:02,500\n[Thầy giáo]: Chào các em hôm nay ta học bài mới.\n\n"
            "2\n00:00:03,000 --> 00:00:05,000\n[Học sinh]:   Thưa thầy vâng ạ!  \n\n"
            "3\n00:00:05,500 --> 00:00:07,000\nCả lớp im lặng lắng nghe.\n"
        )
        cues = parse_srt(raw)
        self.assertEqual(len(cues), 3)
        self.assertEqual(cues[0]["speakerName"], "Thầy giáo")
        self.assertEqual(cues[0]["spokenText"], "Chào các em hôm nay ta học bài mới.")
        self.assertEqual(cues[0]["text"], "Chào các em hôm nay ta học bài mới.")
        self.assertEqual(cues[0]["sourceText"], "[Thầy giáo]: Chào các em hôm nay ta học bài mới.")

        self.assertEqual(cues[1]["speakerName"], "Học sinh")
        self.assertEqual(cues[1]["spokenText"], "Thưa thầy vâng ạ!")

        self.assertIsNone(cues[2]["speakerName"])
        self.assertEqual(cues[2]["spokenText"], "Cả lớp im lặng lắng nghe.")
        self.assertEqual(cues[2]["text"], "Cả lớp im lặng lắng nghe.")


if __name__ == "__main__":
    unittest.main()
