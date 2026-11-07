"""Exercise direction controls, failed publication and real encoder cancellation."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

import cv2
import numpy as np

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import merge_scenes
import render_stream_whiteboard as render
import stream_render as sr
import whiteboard_audio
import whiteboard_encoder as encoder


class ReviewFollowup(unittest.TestCase):
    def renderer(self):
        cfg = sr.Config(cap_long_edge=160, grid_edge=10, brush_radius=8,
                        canvas_hex="#FFFFFF", match_bg=False)
        image = np.full((100, 160, 3), (30, 110, 200), np.uint8)
        ann = {"canvas": {"width": 160, "height": 100}, "elements": []}
        return render.RegionStreamRenderer(image, ann, cfg, None, True)

    def test_direction_changes_grid_and_skeleton_contacts(self):
        r = self.renderer()
        r.active_all[:] = True
        allowed = np.ones((r.out_h, r.out_w), bool)
        first = {}
        for direction in ("left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"):
            r.reveal_direction = direction
            path = r._region_grid_path(allowed)
            first[direction] = path[0]
            self.assertEqual(len(set(path)), r.active_all.size)
        self.assertEqual(first["right_to_left"][1], r.active_all.shape[1]-1-first["left_to_right"][1])
        self.assertEqual(first["bottom_to_top"][0], r.active_all.shape[0]-1-first["top_to_bottom"][0])

        r.ink_pixels[:] = False
        r.ink_pixels[50, 20:140] = True
        r.reveal_direction = "left_to_right"
        left = r._region_skeleton_strokes(allowed)[0]
        r.reveal_direction = "right_to_left"
        right = r._region_skeleton_strokes(allowed)[0]
        self.assertLess(left[0][0], left[-1][0])
        self.assertGreater(right[0][0], right[-1][0])

    def test_wipe_directions_reveal_correct_side_and_finish_source(self):
        for direction, axis, reverse in (("left_to_right", 1, False), ("right_to_left", 1, True),
                                          ("top_to_bottom", 0, False), ("bottom_to_top", 0, True)):
            with self.subTest(direction=direction):
                r = self.renderer()
                r.reveal_direction = direction
                r.ink_pixels[:] = False
                allowed = np.zeros((r.out_h, r.out_w), bool)
                allowed[10:90, 20:140] = True
                frames = []
                r._wash_contour(types.SimpleNamespace(write=lambda f: frames.append(f.copy())), 11, allowed)
                revealed = np.any(frames[4] != 255, axis=2)
                coordinates = np.where(revealed)[axis]
                self.assertGreater(len(coordinates), 0)
                center = (r.out_h if axis == 0 else r.out_w) / 2
                self.assertGreater(coordinates.mean(), center) if reverse else self.assertLess(coordinates.mean(), center)
                np.testing.assert_array_equal(r.drawn[allowed], r.color_img[allowed])
                self.assertTrue(np.all(r.drawn[~allowed] == 255))

    def test_palette_direction_keeps_source_coverage(self):
        for direction in ("left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"):
            with self.subTest(direction=direction):
                r = self.renderer()
                r.reveal_direction = direction
                r.ink_pixels[:] = False
                r._wash_palette_brush(types.SimpleNamespace(write=lambda f: None), 50,
                                      np.ones((r.out_h, r.out_w), bool))
                np.testing.assert_array_equal(r.drawn, r.color_img)

    def test_one_frame_palette_budget_consumes_all_clusters(self):
        r = self.renderer()
        r.color_img[:, :80] = (0, 0, 220)
        r.color_img[:, 80:] = (220, 0, 0)
        r.ink_pixels[:] = False
        frames = []
        r._wash_palette_brush(types.SimpleNamespace(write=lambda f: frames.append(f)), 1,
                              np.ones((r.out_h, r.out_w), bool))
        self.assertEqual(len(frames), 1)
        np.testing.assert_array_equal(frames[0], r.color_img)

    def test_missing_probe_fails_safely_before_concat(self):
        with patch.object(whiteboard_audio, "resolve_ffmpeg_and_probe", return_value=("ffmpeg", None)):
            with self.assertRaisesRegex(RuntimeError, "FFPROBE_REQUIRED"):
                merge_scenes._normalize_concat_if_needed([], Path("unused.mp4"), "ffmpeg")

    def test_render_error_keeps_previous_output_and_stops_encoder(self):
        if not encoder.resolve_ffmpeg_binary():
            self.skipTest("FFmpeg required")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "scene.mp4"
            output.write_bytes(b"previous-good-output")
            r = self.renderer()
            r.ann["elements"] = [{"id": "a", "region": {"x": 0, "y": 0, "width": 160, "height": 100},
                                 "reveal": {"startMs": 0, "durationMs": 1000}}]
            writer = encoder.FFmpegDirectPipeWriter(output, r.out_w, r.out_h, fps=r.cfg.fps)
            with patch.object(encoder, "create_frame_writer", return_value=writer), \
                 patch.object(r, "_region_grid_path", side_effect=ValueError("bad plan")):
                with self.assertRaisesRegex(ValueError, "bad plan"):
                    r.render_to(output, 1000)
            self.assertEqual(output.read_bytes(), b"previous-good-output")
            self.assertIsNotNone(writer.proc.poll())
            self.assertFalse(writer.tmp_target.exists())

    @unittest.skipIf(os.name == "nt", "Unix process-group cancellation")
    def test_cancel_group_stops_real_ffmpeg_child(self):
        if not encoder.resolve_ffmpeg_binary():
            self.skipTest("FFmpeg required")
        with tempfile.TemporaryDirectory() as tmp:
            code = ("import sys,os,json,time;sys.path.insert(0,sys.argv[1]);"
                    "from whiteboard_encoder import FFmpegDirectPipeWriter;"
                    "w=FFmpegDirectPipeWriter(sys.argv[2],160,100,10);"
                    "print(json.dumps({'pid':w.proc.pid,'pgid':os.getpgid(w.proc.pid)}),flush=True);"
                    "time.sleep(30)")
            proc = subprocess.Popen([sys.executable, "-c", code, str(SCRIPTS), str(Path(tmp)/"cancel.mp4")],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                    start_new_session=True)
            child = None
            try:
                info = json.loads(proc.stdout.readline())
                child = info["pid"]
                self.assertEqual(info["pgid"], proc.pid)
                # Same negative-PID kill used by the Rust supervisor.
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
                deadline = time.monotonic() + 5
                while True:
                    status = subprocess.run(["ps", "-o", "stat=", "-p", str(child)], capture_output=True, text=True).stdout.strip()
                    if not status or status.startswith("Z"):
                        break
                    if time.monotonic() >= deadline:
                        self.fail(f"FFmpeg survived cancellation: {status}")
                    time.sleep(.05)
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
                if child:
                    try:
                        os.kill(child, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                proc.stdout.close()
                proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
