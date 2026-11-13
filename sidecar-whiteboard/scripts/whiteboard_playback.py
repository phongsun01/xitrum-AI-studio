"""Independent drawing/speech windows and per-scene playback preparation."""
from pathlib import Path
import copy
import json
import math

def scene_duration_ms(requested, drawing, speech=0, hold=2000):
    values = [requested, drawing, speech, hold]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0 for v in values):
        raise ValueError('Thời lượng vẽ/lời/giữ hình phải là số không âm.')
    return max(1, math.ceil(max(requested, max(drawing, speech) + hold)))

def drawing_end_ms(annotation):
    return max((e['reveal']['startMs'] + e['reveal']['durationMs'] for e in annotation.get('elements', [])), default=0)

def prepare_playback(project, output_path):
    import media_utils as mu
    import whiteboard_audio as audio
    result = copy.deepcopy(project)
    folder = Path(output_path).resolve().parent / '.whiteboard-playback'
    # Unique workspace so failed/cancelled/new exports cannot reuse another run's audio.
    import uuid
    folder = folder / uuid.uuid4().hex
    folder.mkdir(parents=True)
    master = project.get('masterAudioPath')
    fps = project.get('fps', 30)
    cursor, captions = 0, []
    for index, sc in enumerate(result['scenes']):
        source_start = sc.get('audioStartMs', sc['timelineStartMs'])
        old_start = sc['timelineStartMs']
        ann = json.loads(Path(sc['annotationPath']).read_text())
        silent_final = index == len(result['scenes']) - 1 and not sc.get('cues')
        hold = sc.get('holdDurationMs', 2000) if silent_final else 0
        path = sc.get('audioPath') or (master if sc.get('cues') else None)
        is_master = bool(path and not sc.get('audioPath'))
        speech = 0
        if path:
            measured = audio.validate_audio_file(path)
            speech = sc['durationMs'] if is_master else measured
        duration = scene_duration_ms(sc['durationMs'], drawing_end_ms(ann), 0, hold) if silent_final else sc['durationMs']
        duration = math.ceil(duration * fps / 1000) * 1000 / fps
        duration = math.ceil(duration)
        if path:
            wav = folder / (str(len(captions)) + '-' + uuid.uuid4().hex + '.wav')
            start = source_start / 1000 if is_master else 0
            end = start + speech / 1000
            mu.run_ffmpeg(['-i', str(path), '-af', f'atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,apad=whole_dur={duration/1000:.6f}', '-t', f'{duration/1000:.6f}', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(wav)], 'căn audio cảnh và giữ hình')
            sc['audioPath'] = str(wav)
        else:
            sc.pop('audioPath', None)
        for cue in sc.get('cues', []):
            begin = max(0, cue['startMs'] - old_start)
            end = min(cue.get('speechEndMs', cue['endMs']) - old_start, speech if path else cue['endMs'] - old_start)
            if end > begin:
                captions.append((cursor + begin, cursor + end, cue.get('spokenText') or cue.get('text', '')))
        # Renderer already receives the fully resolved scene duration; don't add hold twice.
        if silent_final:
            ann['sceneDurationMs'] = duration
        ann['silentFinal'] = silent_final
        ann['holdDurationMs'] = 0
        prepared_ann = folder / (uuid.uuid4().hex + '.json')
        prepared_ann.write_text(json.dumps(ann, ensure_ascii=False))
        sc['annotationPath'] = str(prepared_ann)
        sc['durationMs'] = duration
        sc['timelineStartMs'], sc['timelineEndMs'] = cursor, cursor + duration
        cursor += duration
    result.pop('masterAudioPath', None)
    def stamp(ms):
        ms = round(ms); s, ms = divmod(ms, 1000); h, s = divmod(s, 3600); m, s = divmod(s, 60)
        return f'{h:02}:{m:02}:{s:02},{ms:03}'
    srt = folder / 'playback.srt'
    srt.write_text('\n\n'.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{text}' for i, (a,b,text) in enumerate(captions,1)) + '\n')
    return {'project': result, 'subtitle_path': str(srt), 'duration_ms': cursor}
