import sys,json,time,os
from pathlib import Path
import cv2,numpy as np
sys.path[:0]=[str(Path('sidecar-whiteboard').resolve()),str(Path('sidecar-whiteboard/scripts').resolve())]
import whiteboard_runner as wr, render_stream_whiteboard as r, stream_render as sr
import whiteboard_image as wi,whiteboard_render_plan as wp,whiteboard_palette as pal,whiteboard_cache as cache
from unittest.mock import patch
out=Path('/tmp/xitrum-whiteboard-review'); results={}
base=Path('input_images/ket-nghia-vuon-dao')
import parse_srt
cues=parse_srt.parse_srt((base/'ket-nghia-vuon-dao.srt').read_text())
files=[base/'Gemini_Generated_Image_rabbu8rabbu8rabb.png',base/'Gemini_Generated_Image_rabbu8rabbu8rabb-2.png',base/'Gemini_Generated_Image_rabbu8rabbu8rabb-3.png']
anns=[]
for i,p in enumerate(files):
    cs=[dict(c,startMs=c['startMs']-i*30000,endMs=c['endMs']-i*30000) for c in cues[i*6:(i+1)*6]]
    ann=wr.handle_generate_annotation(dict(image_path=str(p),scene_id=f'scene-{i+1}',duration_ms=30000,cues=cs))
    anns.append(ann)
    (out/f'scene-{i+1}.json').write_text(json.dumps(ann,ensure_ascii=False,indent=2))
results['real_image_regions']=[len(a['elements']) for a in anns]
for mode in ['contour-wipe','brush','palette-brush']:
    img,_=wi.load_normalized_image(files[0],paper_color_hex='#F5EBD7',min_dimension=16)
    cfg=sr.Config(fps=8,cap_long_edge=640,canvas_hex='#F5EBD7',ink_path_mode='skeleton',color_fill=mode)
    renderer=r.RegionStreamRenderer(img,anns[0],cfg,None,True)
    t=time.monotonic();renderer.render_to(out/f'{mode}.mp4',30000)
    bg=np.array(sr._hex_to_bgr(cfg.canvas_hex)); src=renderer.color_img.astype(float); final=renderer.drawn.astype(float)
    content=np.max(abs(src-bg),axis=2)>35
    wrong=(np.max(abs(src-final),axis=2)>35)&content
    results[mode]={'render_seconds':round(time.monotonic()-t,3),'content_pixels':int(content.sum()),'incorrect_final_pixels':int(wrong.sum()),'incorrect_percent':round(100*wrong.sum()/max(1,content.sum()),3)}
    cv2.imwrite(str(out/f'{mode}-final.png'),final.astype('uint8'))
    if mode=='palette-brush':
        cv2.imwrite(str(out/'expected.png'),renderer.color_img)
# Nested ownership exclusivity
els=[dict(id='outer',region=dict(x=0,y=0,width=100,height=100)),dict(id='inner',region=dict(x=20,y=20,width=60,height=60))]
m=wp.PixelOwnershipManager(100,100).build_ownership_masks(els,1,1)
results['ownership_overlap_pixels']=int((m['outer']&m['inner']).sum())
# Execute missing-audio merge through real runner on a fresh review video
missing=out/'does-not-exist.wav'
res=wr.handle_merge_scenes(dict(video_paths=[str(out/'contour-wipe.mp4')],output_path=str(out/'missing-audio-result.mp4'),master_audio_path=str(missing)))
results['missing_master_audio']={'returned_success':True,'output':res}
# Real render through runner; mimic project's part -> final rename
small=np.full((96,160,3),255,np.uint8);cv2.circle(small,(80,48),25,(0,0,0),2);cv2.imwrite(str(out/'small.png'),small)
ann=wr.handle_generate_annotation(dict(image_path=str(out/'small.png'),duration_ms=2000,output_path=str(out/'small.json'),overwrite=True))
req=dict(image_path=str(out/'small.png'),annotation_path=str(out/'small.json'),output_path=str(out/'scene.mp4.part.mp4'),duration_ms=2000,fps=4,paper_color='#FFFFFF',ink_path='grid',color_fill='none',ink_weight=1,color_weight=0,audio_path=str(missing))
wr.handle_render_scene(req)
results['missing_scene_audio_returned_success']=True
fp_req=wr.handle_get_fingerprint(req)['fingerprint']
fp_written=json.loads(Path(req['output_path']+'.manifest.json').read_text())['fingerprint']
os.rename(req['output_path'],out/'scene.mp4')
results['cache_after_project_rename']={'manifest_at_part_exists':Path(req['output_path']+'.manifest.json').exists(),'manifest_at_final_exists':(out/'scene.mp4.manifest.json').exists(),'request_fingerprint_matches_render':fp_req==fp_written,'verify_cache':cache.verify_scene_cache(str(out/'scene.mp4'),fp_req)}
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
