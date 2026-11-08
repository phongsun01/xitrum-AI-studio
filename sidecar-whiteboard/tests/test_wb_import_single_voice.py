"""Schema 2 is one scene per cue, independently of the character library."""
import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'sidecar-whiteboard/scripts'))
import wb_import
spec = importlib.util.spec_from_file_location('single_voice_tts', ROOT / 'sidecar-tts/tts_runner.py')
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)


class SingleVoiceImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.srt = Path(self.tmp.name) / 'story.srt'
        self.texts = ['Một buổi sáng.\nĐổng Trác ngồi uống trà.', 'Ông hỏi: Trà đã nguội chưa?', 'Mọi người bật cười.']
        self.srt.write_text('\n\n'.join(f'{i}\n00:00:0{i-1},000 --> 00:00:0{i},000\n{text}' for i, text in enumerate(self.texts, 1))+'\n')
        self.meta = {'schema_version': 2, 'title': 'Truyện một giọng',
                     'srt_sha256': hashlib.sha256(self.srt.read_bytes()).hexdigest(),
                     'options': {'speech': 'single'}, 'characters': [{'name': 'Đổng Trác'}],
                     'scenes': [{'index': i, 'start_ms': (i-1)*1000, 'end_ms': i*1000, 'text': text}
                                for i, text in enumerate(self.texts, 1)]}
        self.json_path = self.srt.with_suffix('.wb.json')

    def inspect(self):
        self.json_path.write_text(json.dumps(self.meta, ensure_ascii=False))
        return wb_import.inspect_wb_bundle(str(self.srt))

    def test_three_scenes_without_multi_speaker_fields(self):
        result = self.inspect()
        self.assertTrue(result['valid'], result['errors'])
        self.assertEqual(result['schemaVersion'], 2)
        self.assertEqual(result['speechMode'], 'single')
        self.assertEqual(result['speakers'], [])
        self.assertEqual([len(s['cues']) for s in result['scenes']], [1, 1, 1])
        self.assertEqual([s['cues'][0]['spokenText'] for s in result['scenes']], self.texts)
        self.assertTrue(all(s['cues'][0]['speakerId'] is None for s in result['scenes']))
        # No conversion or writes to the user's SRT/JSON.
        self.assertEqual(json.loads(self.json_path.read_text()), self.meta)

    def test_legacy_schema2_missing_speech_option_is_single(self):
        del self.meta['options']
        self.assertTrue(self.inspect()['valid'])

    def test_mismatch_and_structure_errors_remain_distinct(self):
        original = copy.deepcopy(self.meta)
        for name, mutate, code in [
            ('hash', lambda m:m.update(srt_sha256='wrong'), 'WB_SRT_HASH_MISMATCH'),
            ('text', lambda m:m['scenes'][0].update(text='Sai lời'), 'WB_CUE_MISMATCH'),
            ('time', lambda m:m['scenes'][0].update(end_ms=999), 'WB_CUE_MISMATCH'),
            ('count', lambda m:m['scenes'].pop(), 'WB_CUE_COUNT_MISMATCH'),
            ('type', lambda m:m.update(scenes=None), 'WB_INVALID_METADATA'),
            ('schema', lambda m:m.update(schema_version=77), 'WB_SCHEMA_MISMATCH'),
        ]:
            with self.subTest(name=name):
                self.meta = copy.deepcopy(original)
                mutate(self.meta)
                result = self.inspect()
                self.assertFalse(result['valid'])
                self.assertEqual(result['scenes'], [])
                self.assertTrue(any(e.startswith(code+':') for e in result['errors']), result['errors'])

    def test_single_voice_auto_tts_keeps_three_scenes(self):
        result = self.inspect()
        calls = []
        fake = types.SimpleNamespace(sample_rate=1000, _preset_voices={'Thái Sơn': None}, _default_voice='Thái Sơn')
        fake.infer = lambda text, voice:(calls.append((text, voice)) or np.ones(100, np.float32))
        cues = [s['cues'][0] for s in result['scenes']]
        with patch.object(tts, 'get_tts', return_value=fake), patch.dict(sys.modules, {'soundfile': types.SimpleNamespace(write=lambda *a:None)}):
            output = tts.generate_srt_tts_aligned(str(self.srt), 'Thái Sơn', str(self.srt.with_suffix('.wav')),
                                                 [[1,1],[2,2],[3,3]], {'mode':'single','defaultVoiceId':'Thái Sơn','speakers':[]}, cues)
            fixed_duration = tts.generate_srt_tts(str(self.srt), 'Thái Sơn', str(self.srt.with_suffix('.fixed.wav')),
                                                  {'mode':'single','defaultVoiceId':'Thái Sơn','speakers':[]}, cues)
        self.assertGreater(fixed_duration, 0)
        self.assertEqual([v for _,v in calls], ['Thái Sơn']*6)
        self.assertEqual([t for t,_ in calls], self.texts*2)
        self.assertEqual(len(output['scenes']), 3)
        self.assertEqual([c['id'] for c in output['cues']], ['cue-1','cue-2','cue-3'])

    def test_dong_trac_user_bundle_if_present(self):
        folder = ROOT / 'wb-projects/04. Dong Trac uong tra'
        source = folder / 'dong-trac-lo-chuyen-uong-tra.srt'
        if not source.exists():
            self.skipTest('Local user bundle is not part of the test fixtures')
        paths = [source, source.with_suffix('.wb.json')]
        before = [p.read_bytes() for p in paths]
        result = wb_import.inspect_wb_bundle(str(source))
        self.assertTrue(result['valid'], result['errors'])
        self.assertEqual((result['speechMode'],result['scenesCount'],result['cuesCount'],result['durationMs']), ('single',3,3,94000))
        self.assertEqual([p.read_bytes() for p in paths], before)


if __name__ == '__main__':
    unittest.main()
