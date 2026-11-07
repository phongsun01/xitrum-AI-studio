from pathlib import Path
import sys,json,types,importlib.util
import cv2,numpy as np
from PIL import Image,ImageDraw
from unittest.mock import patch
sys.path.insert(0,str(Path('sidecar-whiteboard/scripts').resolve()))
import render_stream_whiteboard as r,stream_render as sr,whiteboard_palette as pal
out=Path('/tmp/xitrum-whiteboard-review');results=json.loads((out/'results.json').read_text())
# Test actual TTS assembly with deterministic 3-second infer fixtures, no speech model.
spec=importlib.util.spec_from_file_location('tts_review','sidecar-tts/tts_runner.py');tts=importlib.util.module_from_spec(spec);spec.loader.exec_module(tts)
captured={}
fake=types.SimpleNamespace(sample_rate=1000,_preset_voices={'test':None},_default_voice='test',infer=lambda *a,**k:np.ones(3000,np.float32)*0.2)
srt=out/'overlap.srt';srt.write_text('1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond\n')
with patch.object(tts,'get_tts',return_value=fake),patch.dict(sys.modules,{'soundfile':types.SimpleNamespace(write=lambda p,a,s:captured.update(wave=a.copy()))}):
    tts.generate_srt_tts(str(srt),'test',str(out/'overlap.wav'))
wave=captured['wave']
results['tts_assembly_fixture']={'infer_seconds':3,'cue_interval_seconds':2,'single_voice_level':float(wave[1000]),'overlap_level':float(wave[2500]),'overlap_seconds':1}
# Test palette renderer with fixed ordered adjacent clusters, isolate brush-mask behavior.
img=np.full((100,180,3),255,np.uint8);img[20:70,20:40]=(0,0,220);img[20:70,45:85]=(220,0,0)
ann={'canvas':{'width':180,'height':100},'elements':[]}
cfg=sr.Config(cap_long_edge=180,grid_edge=10,brush_radius=40,canvas_hex='#FFFFFF')
renderer=r.RegionStreamRenderer(img,ann,cfg,None,True)
a=np.zeros((100,180),bool);a[20:70,20:40]=1
b=np.zeros_like(a);b[20:70,45:85]=1
clusters=[pal.ColorCluster(0,np.zeros(3),np.array([0,0,220]),int(a.sum()),a),pal.ColorCluster(1,np.zeros(3),np.array([220,0,0]),int(b.sum()),b)]
frames=[]
with patch.object(pal,'segment_color_palette_lab',return_value=clusters):
    renderer._wash_palette_brush(types.SimpleNamespace(write=lambda f:frames.append(f.copy())),30,np.ones_like(a))
first=frames[0];early_blue=b & (np.max(abs(first.astype(float)-255),axis=2)>20)
results['palette_cross_cluster_fixture']={'next_cluster_pixels_revealed_in_first_frame':int(early_blue.sum())}
cv2.imwrite(str(out/'palette-cross-cluster-first.png'),first)
# Contact sheet: real render at same moments in 3 modes; pure frame extraction.
cell_w,cell_h=320,205
sheet=Image.new('RGB',(cell_w*4,cell_h*3),'white');draw=ImageDraw.Draw(sheet)
for row,mode in enumerate(['contour-wipe','brush','palette-brush']):
    cap=cv2.VideoCapture(str(out/f'{mode}.mp4'))
    for col,t in enumerate([4,12,24,29.875]):
        cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,frame=cap.read()
        if ok:
            im=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));im.thumbnail((320,180));sheet.paste(im,(col*cell_w,row*cell_h+24))
        draw.text((col*cell_w+5,row*cell_h+5),f'{mode}: {t:g}s',fill='black')
    cap.release()
sheet.save(out/'contact-sheet.jpg')
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
