"""
Kiểm thử xuất dự án nhiều cảnh bằng render thật + ffmpeg/PyAV thật (không mock):
- audio toàn bài được cắt đúng theo từng cảnh (mỗi đoạn một tần số riêng, đo bằng FFT)
- audio riêng, cảnh im lặng, xuất một cảnh giữa bài, audio dài hơn timeline
- kích thước ảnh khác nhau được chuẩn hóa, cache được dùng lại, lỗi dữ liệu chỉ rõ cảnh
"""

import json
import math
import shutil
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

try:
    import av
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

FPS = 10
TONES = [440.0, 880.0, 1320.0]
DURS = [1500, 2000, 1000]  # ms


def _tone_wav(path: Path, segments, rate=22050):
    """segments: [(freq|None, seconds)] → wav mono 16-bit."""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        for freq, sec in segments:
            n = int(rate * sec)
            if freq is None:
                w.writeframes(b"\x00\x00" * n)
            else:
                w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / rate)))
                                       for i in range(n)))


def _line_art(path: Path, w, h):
    img = np.full((h, w, 3), (215, 235, 245), np.uint8)
    cv2.circle(img, (w // 4, h // 2), h // 5, (60, 60, 60), 3)
    cv2.rectangle(img, (w // 2, h // 4), (w // 2 + w // 5, h * 3 // 4), (60, 60, 60), 3)
    cv2.imwrite(str(path), img)


def _annotation(path: Path, w, h, duration_ms):
    half = duration_ms // 2
    els = []
    for i, (x0, x1) in enumerate([(0, w // 2), (w // 2, w)]):
        els.append({"id": f"e{i + 1}", "label": f"Vùng {i + 1}", "sequence": i + 1, "type": "object",
                    "region": {"x": x0, "y": 0, "width": x1 - x0, "height": h},
                    "reveal": {"direction": "left_to_right", "startMs": i * half + 50,
                               "durationMs": half - 150, "maskPaddingPx": 8, "protectedRegions": []},
                    "handPath": {"start": [x0, h // 2], "end": [x1, h // 2], "easing": "easeInOut"}})
    path.write_text(json.dumps({"sceneId": "x", "canvas": {"width": w, "height": h},
                                "sceneDurationMs": duration_ms, "elements": els}), encoding="utf-8")


def _decode_mono(path: Path):
    out = []
    with av.open(str(path)) as c:
        rs = av.AudioResampler(format="flt", layout="mono", rate=48000)
        for fr in c.decode(audio=0):
            for r in rs.resample(fr):
                out.append(r.to_ndarray().reshape(-1))
        for r in rs.resample(None):
            out.append(r.to_ndarray().reshape(-1))
    return np.concatenate(out)


def _dominant(sig, rate=48000):
    if len(sig) < 256:
        return None
    spec = np.abs(np.fft.rfft(sig * np.hanning(len(sig))))
    return float(np.argmax(spec) * rate / len(sig))


def _rms(sig):
    return float(np.sqrt(np.mean(sig ** 2)))


@unittest.skipIf(cv2 is None or shutil.which("ffmpeg") is None, "cần opencv, PyAV, numpy và ffmpeg")
class ProjectExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import project_export as pe
        cls.pe = pe
        cls.tmp = Path(tempfile.mkdtemp(prefix="wb_proj_"))
        sizes = [(320, 180), (400, 300), (320, 180)]  # cảnh 2 khác kích thước → phải chuẩn hóa
        cls.scenes = []
        t = 0
        for i, ((w, h), d) in enumerate(zip(sizes, DURS), start=1):
            img, ann = cls.tmp / f"s{i}.png", cls.tmp / f"s{i}.annotation.json"
            _line_art(img, w, h)
            _annotation(ann, w, h, d)
            cls.scenes.append({"id": f"s{i}", "imagePath": str(img), "annotationPath": str(ann),
                               "durationMs": d, "timelineStartMs": t})
            t += d
        cls.master = cls.tmp / "master.wav"
        _tone_wav(cls.master, [(TONES[0], 1.5), (TONES[1], 2.0), (TONES[2], 1.0)])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def project(self, **over):
        p = {"schemaVersion": 1, "id": "p", "name": "demo", "fps": FPS, "paperColor": "#F5EBD7",
             "masterAudio": {"path": str(self.master)},
             "scenes": [dict(s) for s in self.scenes]}
        p.update(over)
        return p

    def window(self, sig, start_ms, dur_ms):
        a, b = int(48000 * (start_ms + dur_ms * 0.2) / 1000), int(48000 * (start_ms + dur_ms * 0.8) / 1000)
        return sig[a:b]

    # ── xuất đầy đủ với audio toàn bài ──
    def test_01_full_export_master_audio_matches_each_scene(self):
        out = self.tmp / "full.mp4"
        prog = []
        m = self.pe.export_project(self.project(), str(out), progress=lambda p, s: prog.append(p))
        info = self.pe.mu.probe_media(out)
        self.assertEqual(info["video"]["frames"], 75)
        self.assertIsNotNone(info["audio"])
        self.assertAlmostEqual(info["duration_s"], 7.5, delta=0.1)
        self.assertEqual(len({(s["id"]) for s in m["scenes"]}), 3)
        self.assertEqual(prog, sorted(prog))
        self.assertEqual(prog[-1], 100.0)
        # tần số trội của từng cảnh khớp đoạn audio toàn bài tương ứng
        sig = _decode_mono(out)
        start = 0
        for tone, d in zip(TONES, DURS):
            f = _dominant(self.window(sig, start, d))
            self.assertAlmostEqual(f, tone, delta=40, msg=f"cảnh tại {start}ms: {f}Hz ≠ {tone}Hz")
            start += d
        # cả ba cảnh cùng kích thước dù ảnh cảnh 2 khác tỉ lệ
        self.assertEqual(len({(s["width"], s["height"]) for s in
                              [self.pe.mu.probe_media(Path(x["video"]))["video"] for x in m["scenes"]]}), 2)
        self.assertEqual((info["video"]["width"], info["video"]["height"]), (m["size"]["width"], m["size"]["height"]))
        self.assertTrue((self.tmp / "full.mp4.manifest.json").exists())
        self.assertFalse(list(self.tmp.glob(".wb-work-*")), "thư mục tạm phải được dọn")
        self.assertFalse((self.tmp / "full.partial.mp4").exists())

    def test_02_cache_is_reused(self):
        out = self.tmp / "cache.mp4"
        self.pe.export_project(self.project(), str(out))
        m2 = self.pe.export_project(self.project(), str(out))
        self.assertTrue(all(s["cached"] for s in m2["scenes"]), m2["scenes"])
        # đổi thời lượng một cảnh chỉ vô hiệu cache cảnh đó
        p = self.project()
        p["scenes"][2]["durationMs"] = 1200
        m3 = self.pe.export_project(p, str(out))
        self.assertEqual([s["cached"] for s in m3["scenes"]], [True, True, False])

    # ── audio riêng, im lặng ──
    def test_03_per_scene_file_none_and_master(self):
        own = self.tmp / "own.wav"
        _tone_wav(own, [(660.0, 3.0)])
        p = self.project()
        p["scenes"][0]["audio"] = {"mode": "file", "path": str(own)}
        p["scenes"][1]["audio"] = {"mode": "none"}
        out = self.tmp / "mix.mp4"
        self.pe.export_project(p, str(out))
        sig = _decode_mono(out)
        self.assertAlmostEqual(_dominant(self.window(sig, 0, 1500)), 660.0, delta=40)
        self.assertLess(_rms(self.window(sig, 1500, 2000)), 0.01, "cảnh 'none' phải im lặng")
        self.assertAlmostEqual(_dominant(self.window(sig, 3500, 1000)), 1320.0, delta=40)

    def test_04_no_audio_project_has_no_audio_stream(self):
        p = self.project()
        del p["masterAudio"]
        out = self.tmp / "silent.mp4"
        self.pe.export_project(p, str(out))
        info = self.pe.mu.probe_media(out)
        self.assertIsNone(info["audio"])
        self.assertEqual(info["video"]["frames"], 75)

    # ── xuất một cảnh giữa bài ──
    def test_05_export_single_middle_scene(self):
        out = self.tmp / "middle.mp4"
        self.pe.export_project(self.project(), str(out), scene_ids=["s2"])
        info = self.pe.mu.probe_media(out)
        self.assertEqual(info["video"]["frames"], 50)
        self.assertAlmostEqual(_dominant(self.window(_decode_mono(out), 0, 2000)), 880.0, delta=40)

    # ── audio dài hơn timeline ──
    def test_06_longer_master_extends_last_scene(self):
        long_master = self.tmp / "long.wav"
        _tone_wav(long_master, [(440.0, 1.5), (880.0, 2.0), (1320.0, 3.0)])  # 6.5s > 4.5s
        out = self.tmp / "long.mp4"
        m = self.pe.export_project(self.project(masterAudio={"path": str(long_master)}), str(out))
        info = self.pe.mu.probe_media(out)
        self.assertEqual(info["video"]["frames"], 95)
        self.assertAlmostEqual(info["duration_s"], 9.5, delta=0.1)
        self.assertEqual(m["scenes"][2]["durationMs"], 3000)
        self.assertTrue(any("kéo dài" in w for w in m["warnings"]))
        sig = _decode_mono(out)
        self.assertAlmostEqual(_dominant(self.window(sig, 4500, 2000)), 1320.0, delta=40, msg="phần lời cuối không được cắt")

    # ── lỗi dữ liệu ──
    def test_07_annotation_beyond_duration_is_reported_for_scene(self):
        p = self.project()
        p["scenes"][1]["durationMs"] = 800  # annotation cảnh 2 cần ~2000ms
        with self.assertRaises(ValueError) as cm:
            self.pe.export_project(p, str(self.tmp / "bad.mp4"))
        self.assertIn("s2", str(cm.exception))
        self.assertIn("vượt thời lượng", str(cm.exception))

    def test_08_validate_reports_missing_files_per_scene(self):
        p = self.project()
        p["scenes"][0]["imagePath"] = str(self.tmp / "khong-co.png")
        p["scenes"][2]["annotationPath"] = ""
        p["scenes"][1]["audio"] = {"mode": "file", "path": "/khong/co.wav"}
        v = self.pe.validate_project(p)
        got = {(e["sceneId"], e["field"]) for e in v["errors"]}
        self.assertEqual(got, {("s1", "imagePath"), ("s3", "annotationPath"), ("s2", "audio")})

    def test_09_validate_rejects_bad_scalars(self):
        v = self.pe.validate_project(self.project(fps=0, paperColor="xanh"))
        fields = {e["field"] for e in v["errors"]}
        self.assertTrue({"fps", "paperColor"} <= fields)
        v = self.pe.validate_project(self.project(scenes=[]))
        self.assertTrue(v["errors"])

    def test_11_stale_temp_files_from_cancelled_export_are_cleaned(self):
        out = self.tmp / "clean" / "o.mp4"
        (out.parent / ".whiteboard-cache").mkdir(parents=True)
        stale_dir = out.parent / ".wb-work-dangdo"
        stale_dir.mkdir()
        (stale_dir / "x.wav").write_bytes(b"x")
        stale_part = out.parent / ".whiteboard-cache" / "s9-abc.part.mp4"
        stale_part.write_bytes(b"x")
        self.pe.export_project(self.project(), str(out), scene_ids=["s1"])
        self.assertFalse(stale_dir.exists())
        self.assertFalse(stale_part.exists())

    def test_10_disabled_scene_is_skipped(self):
        p = self.project()
        p["scenes"][1]["enabled"] = False
        out = self.tmp / "skip.mp4"
        self.pe.export_project(p, str(out))
        self.assertEqual(self.pe.mu.probe_media(out)["video"]["frames"], 55)


if __name__ == "__main__":
    unittest.main()
