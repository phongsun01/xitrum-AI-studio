"""Audio-measured windows, retained scene mapping, and bounded reveal regressions."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'sidecar-whiteboard'),str(ROOT/'sidecar-whiteboard/scripts')]
import whiteboard_runner as runner
import whiteboard_schema as schema

spec=importlib.util.spec_from_file_location('audio_driven_tts',ROOT/'sidecar-tts/tts_runner.py')
tts=importlib.util.module_from_spec(spec);spec.loader.exec_module(tts)

class AudioTimingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.dir=Path(self.tmp.name)
        self.srt=self.dir/'input.srt'
        self.source='\n\n'.join(f'{i}\n00:00:{(i-1)*10:02d},000 --> 00:00:{i*10:02d},000\nCâu số {i}.' for i in range(1,5))+'\n'
        self.srt.write_text(self.source)

    def generate(self, lengths, ranges=None):
        fake=types.SimpleNamespace(sample_rate=1000,_preset_voices={'voice':None},_default_voice='voice')
        fake.infer=lambda *a,**k: np.ones(next(lengths),np.float32)*0.2
        self.write=unittest.mock.Mock()
        with patch.object(tts,'get_tts',return_value=fake),patch.dict(sys.modules,{'soundfile':types.SimpleNamespace(write=self.write)}):
            return tts.generate_srt_tts_aligned(str(self.srt),'voice',str(self.dir/'output.wav'),ranges)

    def test_shorter_speech_compacts_without_changing_four_scenes(self):
        result=self.generate(iter([2200,2600,1800,1500]))
        self.assertEqual(len(result['scenes']),4)
        self.assertEqual([s['sceneDurationMs'] for s in result['scenes']],[3200,3600,2800,2500])
        self.assertEqual(result['duration_sec'],12.1)
        self.assertEqual(self.srt.read_text(),self.source)
        parsed=runner.handle_parse_srt({'srt_path':result['aligned_srt_path'],'exact_cues':True})
        self.assertEqual([c['text'] for c in parsed['cues']],[f'Câu số {i}.' for i in range(1,5)])
        self.assertEqual(parsed['scenes'][-1]['timelineEndMs'],12100)
        waveform=self.write.call_args.args[1]
        self.assertEqual(len(waveform),12100)
        self.assertTrue(np.all(waveform[2200:3200]==0))
        self.assertTrue(np.allclose(waveform[3200:5800],0.2))

    def test_longer_speech_expands_window_instead_of_clipping(self):
        result=self.generate(iter([15000]*4))
        self.assertEqual(result['duration_sec'],64)
        self.assertEqual(result['cues'][0]['speechEndMs'],15000)
        self.assertEqual(len(self.write.call_args.args[1]),64000)

    def test_grouped_cues_preserve_scene_boundaries_and_only_short_internal_pause(self):
        result=self.generate(iter([1000]*4),[[1,2],[3,4]])
        self.assertEqual([s['cueRange'] for s in result['scenes']],[[1,2],[3,4]])
        self.assertEqual([s['sceneDurationMs'] for s in result['scenes']],[3150,3150])
        self.assertEqual(result['scenes'][1]['speechEndMs'],2150)
        self.assertEqual(result['duration_sec'],6.3)

    def test_invalid_groups_fail_before_model_or_files(self):
        for ranges in ([[2,4]],[[1,2],[2,4]],[[1,3]],[[1,5]]):
            with patch.object(tts,'get_tts') as model:
                with self.assertRaisesRegex(ValueError,'SRT_SCENE_RANGES'):
                    tts.generate_srt_tts_aligned(str(self.srt),'voice',str(self.dir/'x.wav'),ranges)
                model.assert_not_called()

    def test_rejects_invalid_audio(self):
        with self.assertRaisesRegex(ValueError,'TTS_INVALID_AUDIO'):
            self.generate(iter([0]))

    def test_measured_reveal_finishes_half_second_before_voice(self):
        spans=runner._plan_timing(1,[[dict(startMs=0,endMs=23000,speechEndMs=22000)]],23000)
        self.assertEqual(spans,[(0,21500)])

    def test_weighted_fallback_and_short_scenes_stay_inside_window(self):
        spans=runner._plan_timing(2,[],10000,[1,3])
        self.assertGreater(spans[1][1],spans[0][1])
        self.assertLessEqual(max(s+d for s,d in spans),8500)
        for duration in [1,10,100,500]:
            for start,dur in runner._plan_timing(4,[],duration):
                self.assertGreater(dur,0);self.assertGreaterEqual(start,0)
                self.assertLessEqual(start+dur,duration)

    def test_mode_roundtrip_and_validation(self):
        for mode in ['draw','instant','fade']:
            ann={'sceneDurationMs':1000,'canvas':{'width':100,'height':100},'elements':[
                {'region':{'x':0,'y':0,'width':100,'height':100},'reveal':{'mode':mode,'startMs':0,'durationMs':500}}]}
            clean,_=schema.adapt_and_validate_annotation(ann)
            self.assertEqual(clean['elements'][0]['reveal']['mode'],mode)
        with self.assertRaises(schema.ValidationError):
            schema.validate_reveal({'mode':'unknown','startMs':0,'durationMs':100},1000)

    def test_instant_and_fade_render_exact_frame_budget_and_complete_pixels(self):
        import render_stream_whiteboard as render
        import stream_render as sr
        import whiteboard_encoder
        class Writer:
            def __init__(self): self.frames=[]
            def is_opened(self): return True
            def write(self,f): self.frames.append(f.copy())
            def release(self): pass
            def close(self): pass
        for mode in ['instant','fade']:
            image=np.full((40,80,3),255,np.uint8);image[10:30,20:60]=[0,0,200]
            ann={'canvas':{'width':80,'height':40},'elements':[{'id':'e','sequence':1,'region':{'x':0,'y':0,'width':80,'height':40},
                 'reveal':{'mode':mode,'startMs':0,'durationMs':500}}]}
            cfg=sr.Config(cap_long_edge=80,grid_edge=10,canvas_hex='#FFFFFF',fps=10)
            renderer=render.RegionStreamRenderer(image,ann,cfg,None,True)
            writer=Writer()
            with patch.object(whiteboard_encoder,'create_frame_writer',return_value=writer):
                renderer.render_to(self.dir/'out.mp4',1000)
            self.assertEqual(len(writer.frames),10)
            self.assertTrue(np.allclose(writer.frames[-1][10:30,20:60],image[10:30,20:60],atol=1))

if __name__=='__main__': unittest.main()
