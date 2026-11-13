"""Verify end-card boundaries, silence, custom images, and old project defaults."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'scripts')]
from whiteboard_ending import append_ending, DEFAULT_ENDING, DEFAULT_PORTRAIT_ENDING
from whiteboard_audio import resolve_ffmpeg_and_probe
FFMPEG, FFPROBE = resolve_ffmpeg_and_probe()

@unittest.skipUnless(FFMPEG and FFPROBE, 'FFmpeg required')
class EndingTests(unittest.TestCase):
    def run_ffmpeg(self, *args):
        return subprocess.run([FFMPEG, '-y', '-v', 'error', *map(str, args)], capture_output=True, check=True).stdout

    def test_default_and_custom_cards_preserve_body_and_silence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            card = root / 'custom.jpg'
            Image.new('RGB', (180, 320), (0, 240, 0)).save(card)
            for fps, audio, size, custom in [(24, False, '320x180', None), (30, True, '180x320', None), (30, True, '180x320', str(card))]:
                with self.subTest(fps=fps, audio=audio):
                    scene, out = root/'scene.mp4', root/'out.mp4'
                    args = ['-f', 'lavfi', '-i', f'color=blue:s={size}:r={fps}:d=1']
                    if audio:
                        args += ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac']
                    self.run_ffmpeg(*args, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', scene)
                    append_ending(str(scene), str(out), custom)
                    info=json.loads(subprocess.check_output([FFPROBE, '-v','error','-show_streams','-of','json',str(out)]))
                    video=next(s for s in info['streams'] if s['codec_type']=='video')
                    self.assertEqual(int(video['nb_frames']), fps*4)
                    self.assertAlmostEqual(float(video['duration']),4, places=3)
                    w,h=map(int,size.split('x'))
                    pixels=self.run_ffmpeg('-i', out, '-vf', f"select='eq(n,{fps-1})+eq(n,{fps})+eq(n,{fps*4-1})'", '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
                    frames=np.frombuffer(pixels,dtype=np.uint8).reshape(3,h,w,3)
                    self.assertGreater(frames[0,:,:,2].mean(),200)
                    self.assertLess(np.abs(frames[1].astype(float)-frames[2]).mean(),2)
                    if custom:
                        self.assertGreater(frames[2,:,:,1].mean(),200)
                    if not custom:
                        asset = DEFAULT_PORTRAIT_ENDING if h > w else DEFAULT_ENDING
                        with Image.open(asset) as original:
                            self.assertEqual(original.size, (1080, 1920) if h > w else (1920, 1080))
                            expected = np.asarray(original.convert('RGB').resize((w, h)), dtype=float)
                        self.assertLess(np.abs(frames[2].astype(float) - expected).mean(), 6)
                    if audio:
                        pcm=np.frombuffer(self.run_ffmpeg('-i',out,'-vn','-f','f32le','-ac','1','-ar','48000','-'),dtype=np.float32)
                        self.assertGreater(np.abs(pcm[4800:38400]).mean(),0.03)
                        self.assertLess(np.abs(pcm[57600:]).max(),0.002)
                    else:
                        self.assertFalse(any(s['codec_type']=='audio' for s in info['streams']))

    def test_missing_custom_image_reports_error(self):
        with self.assertRaisesRegex(ValueError, 'ảnh cuối'):
            append_ending('unused.mp4','unused-out.mp4','/missing/ending.png')
        self.assertTrue(DEFAULT_ENDING.is_file())

    def test_short_silent_final_illustration_survives_master_audio_then_outro(self):
        from whiteboard_audio import mux_video_and_audio
        from whiteboard_runner import _plan_timing
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            visual, audio, body, out = (root / n for n in ('visual.mp4', 'voice.wav', 'body.mp4', 'out.mp4'))
            card = root / 'outro.png'
            Image.new('RGB', (320, 180), (0, 240, 0)).save(card)
            # The final picture is only 500ms and has no associated speech.
            self.run_ffmpeg('-f','lavfi','-i','color=blue:s=320x180:r=30:d=1',
                            '-f','lavfi','-i','color=red:s=320x180:r=30:d=0.5',
                            '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]',
                            '-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',visual)
            self.run_ffmpeg('-f','lavfi','-i','sine=frequency=880:duration=1',audio)
            self.assertTrue(mux_video_and_audio(str(visual),str(audio),str(body)))
            append_ending(str(body),str(out),str(card))
            info=json.loads(subprocess.check_output([FFPROBE,'-v','error','-show_streams','-of','json',str(out)]))
            video=next(s for s in info['streams'] if s['codec_type']=='video')
            self.assertEqual(int(video['nb_frames']),135)
            pixels=self.run_ffmpeg('-i',out,'-vf',"select='eq(n,30)+eq(n,44)+eq(n,45)'",
                                   '-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-')
            frames=np.frombuffer(pixels,dtype=np.uint8).reshape(3,180,320,3)
            self.assertGreater(frames[0,:,:,0].mean(),200)
            self.assertGreater(frames[1,:,:,0].mean(),200)
            self.assertGreater(frames[2,:,:,1].mean(),200)
            pcm=np.frombuffer(self.run_ffmpeg('-i',out,'-vn','-f','f32le','-ac','1','-ar','48000','-'),dtype=np.float32)
            self.assertLess(np.abs(pcm[int(1.2*48000):]).max(),0.002)
            schedule=_plan_timing(2, [], 500)
            self.assertTrue(all(d > 0 and s+d <= 500 for s,d in schedule))

    def test_short_final_cue_keeps_exact_timeline_without_one_second_minimum(self):
        from whiteboard_runner import handle_parse_srt
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'short.srt'
            path.write_text('1\n00:00:00,000 --> 00:00:01,000\nDẫn chuyện\n\n2\n00:00:01,000 --> 00:00:01,500\nCâu chốt\n', encoding='utf-8')
            parsed = handle_parse_srt({'srt_path': str(path), 'exact_cues': True})
            self.assertEqual([s['sceneDurationMs'] for s in parsed['scenes']], [1000, 500])
            self.assertEqual(sum(s['sceneDurationMs'] for s in parsed['scenes']), 1500)

if __name__=='__main__': unittest.main()
