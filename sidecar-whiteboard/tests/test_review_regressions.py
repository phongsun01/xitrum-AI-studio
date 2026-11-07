"""Regression cases found in the 0.7.4 review, including real RPC/encode paths."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'sidecar-whiteboard'), str(ROOT / 'sidecar-whiteboard/scripts')]
import whiteboard_runner as runner
import whiteboard_audio as audio
import whiteboard_cache as cache
import whiteboard_render_plan as plan
import whiteboard_palette as palette
import render_stream_whiteboard as render
import stream_render as sr


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def test_tts_rejects_overflow_instead_of_mixing(self):
        spec = importlib.util.spec_from_file_location('review_tts', ROOT / 'sidecar-tts/tts_runner.py')
        tts = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tts)
        p = self.dir / 'voice.srt'
        p.write_text('1\n00:00:00,000 --> 00:00:02,000\nOne\n\n2\n00:00:02,000 --> 00:00:04,000\nTwo\n')
        fake = types.SimpleNamespace(sample_rate=1000, _preset_voices={'test': None},
                                     infer=lambda *a, **k: np.ones(3000, np.float32), _default_voice='test')
        write = unittest.mock.Mock()
        with patch.object(tts, 'get_tts', return_value=fake), patch.dict(sys.modules, {'soundfile': types.SimpleNamespace(write=write)}):
            with self.assertRaisesRegex(ValueError, 'SRT_CUE_OVERFLOW'):
                tts.generate_srt_tts(str(p), 'test', str(self.dir / 'voice.wav'))
            write.assert_not_called()
            fake.infer = lambda *a, **k: np.ones(1000, np.float32) * 0.2
            tts.generate_srt_tts(str(p), 'test', str(self.dir / 'voice.wav'))
            waveform = write.call_args[0][1]
            self.assertTrue(np.all(waveform[1000:2000] == 0))
            self.assertAlmostEqual(float(waveform[2500]), 0.2)

    def test_missing_audio_rejected_before_render_or_merge(self):
        missing = str(self.dir / 'missing.wav')
        with patch.object(render, 'main') as main:
            with self.assertRaisesRegex(ValueError, 'AUDIO_MISSING'):
                runner.handle_render_scene(dict(audio_path=missing))
            main.assert_not_called()
        with self.assertRaisesRegex(ValueError, 'AUDIO_MISSING'):
            runner.handle_merge_scenes(dict(master_audio_path=missing))

    def test_non_audio_file_rejected(self):
        p = self.dir / 'invalid.wav'; p.write_text('not an audio file')
        with self.assertRaisesRegex(ValueError, 'AUDIO_INVALID'):
            audio.validate_audio_file(p)

    def test_nested_ownership_is_exclusive(self):
        elements = [dict(id='outer', region=dict(x=0,y=0,width=100,height=100)),
                    dict(id='inner', region=dict(x=20,y=20,width=60,height=60))]
        manager = plan.PixelOwnershipManager(100, 100)
        masks = manager.build_ownership_masks(elements, 1, 1)
        self.assertEqual(int((masks['outer'] & masks['inner']).sum()), 0)
        self.assertTrue(masks['outer'][0, 0])
        self.assertTrue(masks['inner'][20:80, 20:80].all())
        self.assertTrue((manager.owner_map >= 0).all())

    def test_palette_brush_does_not_reveal_next_cluster(self):
        img = np.full((100,180,3),255,np.uint8)
        img[20:70,20:40] = (0,0,220); img[20:70,45:85] = (220,0,0)
        cfg = sr.Config(cap_long_edge=180, grid_edge=10, brush_radius=40, canvas_hex='#FFFFFF')
        renderer = render.RegionStreamRenderer(img, {'canvas': {'width':180,'height':100}, 'elements':[]}, cfg, None, True)
        renderer.ink_pixels[:] = False
        a = np.zeros((100,180),bool); a[20:70,20:40] = True
        b = np.zeros_like(a); b[20:70,45:85] = True
        clusters = [palette.ColorCluster(0,np.zeros(3),np.zeros(3),int(a.sum()),a),
                    palette.ColorCluster(1,np.zeros(3),np.zeros(3),int(b.sum()),b)]
        frames = []
        with patch.object(palette, 'segment_color_palette_lab', return_value=clusters):
            renderer._wash_palette_brush(types.SimpleNamespace(write=lambda f: frames.append(f.copy())), 30, np.ones_like(a))
        self.assertTrue(np.all(frames[0][b] == 255), 'second cluster appeared before its turn')
        self.assertTrue(np.any(frames[-1][b] < 255))

    def test_palette_finishes_thin_tails_and_source_edges(self):
        img = np.full((100,180,3),255,np.uint8)
        cv2.rectangle(img,(12,12),(70,65),(10,100,220),-1)
        cv2.line(img,(70,40),(158,87),(50,180,20),2)
        img[93,170] = (210,40,50)
        cfg=sr.Config(cap_long_edge=180,grid_edge=10,brush_radius=8,canvas_hex='#FFFFFF')
        renderer=render.RegionStreamRenderer(img,{'canvas':{'width':180,'height':100},'elements':[]},cfg,None,True)
        renderer._wash_palette_brush(types.SimpleNamespace(write=lambda f:None),100,np.ones((100,180),bool))
        self.assertLessEqual(float(np.max(abs(renderer.drawn-renderer.color_img.astype(float)))),1)

    def test_resolved_fingerprint_and_published_manifest(self):
        image = self.dir / 'image.png'
        img = np.full((96,160,3),255,np.uint8); cv2.circle(img,(80,48),25,(0,0,0),2)
        cv2.imwrite(str(image),img)
        ann = self.dir / 'annotation.json'
        runner.handle_generate_annotation(dict(image_path=str(image),duration_ms=2000,output_path=str(ann)))
        part = self.dir / 'scene.part.mp4'
        request = dict(image_path=str(image),annotation_path=str(ann),output_path=str(part),
                       fps=4,paper_color='#FFFFFF',hand_path='drawing-hand.png',duration_ms=2000,
                       ink_path='grid',color_fill='none')
        expected = runner.handle_get_fingerprint(request)['fingerprint']
        runner.handle_render_scene(request)
        manifest = json.loads(Path(str(part)+'.manifest.json').read_text())
        self.assertEqual(manifest['fingerprint'], expected)
        final = self.dir / 'scene.mp4'
        part.rename(final)
        Path(str(part)+'.manifest.json').rename(str(final)+'.manifest.json')
        self.assertTrue(cache.verify_scene_cache(str(final),expected))
        # Changing bytes without replacing metadata invalidates cache.
        with final.open('ab') as f: f.write(b'changed')
        self.assertFalse(cache.verify_scene_cache(str(final),expected))

    def test_mux_short_audio_pads_stream(self):
        ffmpeg, probe = audio.resolve_ffmpeg_and_probe()
        if not ffmpeg or not probe: self.skipTest('ffmpeg/ffprobe required')
        video = self.dir/'video.mp4'; sound=self.dir/'audio.wav'; output=self.dir/'out.mp4'
        subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','color=c=white:s=160x100:r=10:d=2','-c:v','libx264',str(video)],check=True)
        subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','sine=duration=0.5',str(sound)],check=True)
        self.assertTrue(audio.mux_video_and_audio(video,sound,output))
        result=subprocess.run([probe,'-v','error','-show_entries','stream=codec_type,duration','-of','json',str(output)],capture_output=True,text=True,check=True)
        durations={s['codec_type']:float(s['duration']) for s in json.loads(result.stdout)['streams']}
        self.assertAlmostEqual(durations['video'],2,delta=.1)
        self.assertAlmostEqual(durations['audio'],2,delta=.1)

    def test_contact_renderer_spends_time_lifting_without_ink(self):
        cfg = sr.Config(cap_long_edge=100, grid_edge=10, canvas_hex='#FFFFFF')
        renderer = render.RegionStreamRenderer(np.full((100,100,3),255,np.uint8),
            {'canvas': {'width':100,'height':100}, 'elements':[]},cfg,None,True)
        renderer.ink_pixels[:] = True
        renderer.ink_paint[:] = 0
        allowed = np.ones((100,100),bool)
        contact = plan.build_element_timeline_plan([[(10,10),(20,10)],[(80,80),(90,80)]], allowed,'e',1,0,3000)
        positions = []
        original = renderer._snapshot_with_tip
        def snapshot(x,y,**kwargs):
            positions.append((x,y,kwargs.get('pen_down',True)))
            return original(x,y,**kwargs)
        with patch.object(renderer,'_snapshot_with_tip',side_effect=snapshot):
            renderer._lay_contact_plan(types.SimpleNamespace(write=lambda f:None),60,contact,allowed)
        self.assertTrue(any(not p[2] for p in positions))
        self.assertTrue(np.all(renderer.drawn[50,50] == 255))
        self.assertTrue(np.all(renderer.drawn[10,15] == 0))
        self.assertTrue(np.all(renderer.drawn[80,85] == 0))
        self.assertLess(max(abs(a[0]-b[0]) for a,b in zip(positions,positions[1:])),20)

    def test_merge_normalizes_mixed_sizes_rates_and_missing_audio(self):
        import merge_scenes
        ffmpeg, probe = audio.resolve_ffmpeg_and_probe()
        if not ffmpeg or not probe: self.skipTest('ffmpeg/ffprobe required')
        first=self.dir/'first.mp4'; second=self.dir/'second.mp4'; final=self.dir/'merged.mp4'
        subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','color=c=red:s=160x100:r=10:d=1',
                        '-c:v','libx264',str(first)],check=True)
        subprocess.run([ffmpeg,'-v','error','-y','-f','lavfi','-i','color=c=blue:s=200x120:r=15:d=1',
                        '-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac',str(second)],check=True)
        self.assertEqual(merge_scenes.main(['--inputs',str(first),str(second),'--output',str(final)]),0)
        result=subprocess.run([probe,'-v','error','-show_streams','-of','json',str(final)],capture_output=True,text=True,check=True)
        streams=json.loads(result.stdout)['streams']
        video=next(s for s in streams if s['codec_type']=='video')
        self.assertEqual((video['width'],video['height']),(160,100))
        self.assertEqual(video['r_frame_rate'],'10/1')
        sound=next(s for s in streams if s['codec_type']=='audio')
        self.assertAlmostEqual(float(sound['duration']),2,delta=.1)
        decoded=subprocess.run([ffmpeg,'-v','error','-i',str(final),'-map','0:a:0','-f','f32le','-ac','1','-ar','8000','-'],capture_output=True,check=True)
        samples=np.frombuffer(decoded.stdout,dtype=np.float32)
        self.assertLess(float(np.sqrt(np.mean(samples[800:6400]**2))),0.001)
        self.assertGreater(float(np.sqrt(np.mean(samples[10000:14000]**2))),0.01)


if __name__ == '__main__': unittest.main()
