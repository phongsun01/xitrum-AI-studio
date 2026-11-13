import json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import whiteboard_playback as playback
class FinalSilentTests(unittest.TestCase):
 def test_only_final_silent_scene_expands(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);ann=root/'a.json';ann.write_text(json.dumps({'elements':[{'reveal':{'startMs':0,'durationMs':8000}}]}))
   project={'fps':30,'scenes':[{'id':str(i),'annotationPath':str(ann),'durationMs':3000,'timelineStartMs':i*3000,'cues':[] if i==2 else [{'startMs':i*3000,'endMs':i*3000+1000,'text':'hello'}]} for i in range(3)]}
   before=json.dumps(project)
   result=playback.prepare_playback(project,root/'out.mp4')
   self.assertEqual([s['durationMs'] for s in result['project']['scenes']],[3000,3000,10000])
   self.assertEqual(result['duration_ms'],16000)
   self.assertEqual(json.dumps(project),before)
   self.assertEqual(Path(result['subtitle_path']).read_text().count('hello'),2)
 def test_spoken_final_scene_keeps_existing_duration(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);ann=root/'a.json';ann.write_text(json.dumps({'elements':[{'reveal':{'startMs':0,'durationMs':8000}}]}))
   project={'fps':30,'scenes':[{'id':'a','annotationPath':str(ann),'durationMs':3000,'timelineStartMs':0,'cues':[{'startMs':0,'endMs':1000,'text':'hello'}]}]}
   result=playback.prepare_playback(project,root/'out.mp4')
   self.assertEqual(result['project']['scenes'][0]['durationMs'],3000)
if __name__=='__main__':unittest.main()
