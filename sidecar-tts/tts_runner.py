"""
VieNeu-TTS JSON-RPC Runner
Chạy qua stdin / stdout (không mở cổng HTTP để tránh xung đột port).
Hỗ trợ:
- Liệt kê danh sách 25 giọng dựng sẵn (Bắc / Trung / Nam)
- Tạo giọng đọc từ text và lưu ra file .wav bằng engine ONNX v3 Turbo
- Tạo file Master Audio đồng bộ từ file SRT (tự ghép các đoạn thoại theo timestamp)
- Đo thời lượng duration_sec thật của file audio
"""

import sys
import json
import os
import wave
import numpy as np
from pathlib import Path

# Danh sách 25 giọng dựng sẵn của VieNeu-TTS v3 Turbo
DEFAULT_VOICES = [
    {"id": "Thùy Dung", "name": "Thùy Dung (Nữ · Miền Nam · Tin tức / Dẫn chuyện)", "gender": "female", "region": "south"},
    {"id": "Thái Sơn", "name": "Thái Sơn (Nam · Miền Nam · Kể chuyện / Truyền cảm)", "gender": "male", "region": "south"},
    {"id": "Thục Đoan", "name": "Thục Đoan (Nữ · Miền Nam · Kể chuyện nhẹ nhàng)", "gender": "female", "region": "south"},
    {"id": "Minh Triết", "name": "Minh Triết (Nam · Miền Nam · Tin tức / Đĩnh đạc)", "gender": "male", "region": "south"},
    {"id": "Mỹ Duyên", "name": "Mỹ Duyên (Nữ · Miền Nam · Đọc truyện cảm xúc)", "gender": "female", "region": "south"},
    {"id": "Đức Trí", "name": "Đức Trí (Nam · Miền Nam · Đọc truyện / Trầm ấm)", "gender": "male", "region": "south"},
    {"id": "Kim Thanh", "name": "Kim Thanh (Nữ · Miền Nam · Đọc truyện sâu lắng)", "gender": "female", "region": "south"},
    {"id": "Adam", "name": "Adam (Nam · Miền Nam · Tự nhiên)", "gender": "male", "region": "south"},

    {"id": "Hải Đăng", "name": "Hải Đăng (Nam · Miền Bắc · Tự nhiên / Mặc định)", "gender": "male", "region": "north"},
    {"id": "Trúc Ly", "name": "Trúc Ly (Nữ · Miền Bắc · Ngọt ngào)", "gender": "female", "region": "north"},
    {"id": "Thiện Minh", "name": "Thiện Minh (Nam · Miền Bắc · Kể chuyện)", "gender": "male", "region": "north"},
    {"id": "Mai Anh", "name": "Mai Anh (Nữ · Miền Bắc · Tin tức / Chuyên nghiệp)", "gender": "female", "region": "north"},
    {"id": "Ngọc Huyền", "name": "Ngọc Huyền (Nữ · Miền Bắc · Tự nhiên)", "gender": "female", "region": "north"},
    {"id": "Minh Đức", "name": "Minh Đức (Nam · Miền Bắc · Tin tức)", "gender": "male", "region": "north"},
    {"id": "Phạm Tuyên", "name": "Phạm Tuyên (Nam · Miền Bắc · Tự nhiên)", "gender": "male", "region": "north"},
    {"id": "Xuân Vĩnh", "name": "Xuân Vĩnh (Nam · Miền Bắc · Tự nhiên)", "gender": "male", "region": "north"},
    {"id": "Thanh Bình", "name": "Thanh Bình (Nam · Miền Bắc · Kể chuyện)", "gender": "male", "region": "north"},
    {"id": "Ngọc Linh", "name": "Ngọc Linh (Nữ · Miền Bắc · Kể chuyện)", "gender": "female", "region": "north"},
    {"id": "Đoan Trang", "name": "Đoan Trang (Nữ · Miền Bắc · Dịu dàng)", "gender": "female", "region": "north"},
    {"id": "Quỳnh Anh", "name": "Quỳnh Anh (Nữ · Miền Bắc · Đọc truyện)", "gender": "female", "region": "north"},
    {"id": "Quốc Tuấn", "name": "Quốc Tuấn (Nam · Miền Bắc · Tự nhiên)", "gender": "male", "region": "north"},
    {"id": "Thiền Tâm Đức", "name": "Thiền Tâm Đức (Nam · Miền Bắc · Đọc kinh / Kể chuyện)", "gender": "male", "region": "north"},
    {"id": "Adam bựa", "name": "Adam bựa (Nam · Miền Bắc · Hài hước)", "gender": "male", "region": "north"},

    {"id": "Quang Sơn", "name": "Quang Sơn (Nam · Miền Trung · Tự nhiên / Truyền cảm)", "gender": "male", "region": "central"},
    {"id": "Ngọc Trân", "name": "Ngọc Trân (Nữ · Miền Trung · Dịu dàng)", "gender": "female", "region": "central"},
]

_TTS_INSTANCE = None

def get_tts():
    global _TTS_INSTANCE
    if _TTS_INSTANCE is not None:
        return _TTS_INSTANCE

    try:
        from vieneu.v3turbo import V3TurboVieNeuTTS
        from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
        from vieneu.base import BaseVieneuTTS
    except ImportError as e:
        raise RuntimeError(f"Chưa cài vieneu: {e}")

    local_dir = Path.home() / ".cache" / "vieneu_local_model"
    codec_dir = Path.home() / ".cache" / "vieneu_local_codec"

    tts = V3TurboVieNeuTTS.__new__(V3TurboVieNeuTTS)
    tts.babble_retries = 2
    tts.max_batch_size = 32
    tts.backend = "onnx"
    tts._stream_sched = None
    tts._batch_engine = None
    tts.default_style = None
    tts._voice_aliases = {}

    BaseVieneuTTS.__init__(tts)
    tts.sample_rate = 48000  # CỰC KỲ QUAN TRỌNG: Gán 48000 SAU BaseVieneuTTS.__init__ (vì Base mặc định đặt 24000)
    tts._load_v3_voices()

    # Sử dụng model local đã cache chuẩn
    onnx_update_dir = local_dir / "onnx_update"
    if not onnx_update_dir.exists() or not codec_dir.exists():
        # Fallback tự động tải snapshot
        import huggingface_hub
        local_dir.mkdir(parents=True, exist_ok=True)
        huggingface_hub.snapshot_download("pnnbao-ump/VieNeu-TTS-v3-Turbo", local_dir=str(local_dir))
        codec_dir.mkdir(parents=True, exist_ok=True)
        huggingface_hub.snapshot_download("OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX", local_dir=str(codec_dir))

    tts.engine = OnnxV3LiteEngine(
        onnx_dir=str(onnx_update_dir),
        codec_dir=str(codec_dir),
        threads=4
    )

    _TTS_INSTANCE = tts
    return _TTS_INSTANCE


def send_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_wav_duration(file_path):
    try:
        with wave.open(str(file_path), 'r') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return round(frames / float(rate), 2)
    except Exception:
        return 4.0


def generate_tts(text, voice_id, output_path, speed=1.0):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tts = get_tts()
    import soundfile as sf

    # Chọn voice phù hợp
    target_voice = voice_id
    if target_voice not in tts._preset_voices:
        # Thử tìm theo tên tương đương hoặc dùng mặc định
        matched = next((k for k in tts._preset_voices if k.lower() in target_voice.lower() or target_voice.lower() in k.lower()), tts._default_voice)
        target_voice = matched

    audio = tts.infer(text, voice=target_voice)
    sf.write(output_path, audio, tts.sample_rate)
    return get_wav_duration(output_path)


def generate_srt_tts(srt_path, voice_id, output_path):
    """
    Đọc file SRT, phân tích timestamp từng câu.
    Sinh audio từng câu bằng VieNeu và đặt chính xác vào timeline để tạo Master Audio.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    tts = get_tts()
    import soundfile as sf
    import re

    # Phân tích SRT đơn giản
    content = Path(srt_path).read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    _TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")

    cues = []
    for b in blocks:
        lines = [ln.strip() for ln in b.split("\n") if ln.strip()]
        time_line = next((ln for ln in lines if "-->" in ln), None)
        if not time_line:
            continue
        m = _TIME.findall(time_line)
        if len(m) < 2:
            continue
        start_ms = ((int(m[0][0])*60 + int(m[0][1]))*60 + int(m[0][2]))*1000 + int(m[0][3].ljust(3, "0"))
        end_ms = ((int(m[1][0])*60 + int(m[1][1]))*60 + int(m[1][2]))*1000 + int(m[1][3].ljust(3, "0"))
        t_idx = lines.index(time_line)
        text = " ".join(lines[t_idx+1:])
        if text:
            cues.append({"start_ms": start_ms, "end_ms": end_ms, "text": text})

    if not cues:
        raise ValueError("File SRT không có câu phụ đề hợp lệ")

    target_voice = voice_id
    if target_voice not in tts._preset_voices:
        matched = next((k for k in tts._preset_voices if k.lower() in target_voice.lower() or target_voice.lower() in k.lower()), tts._default_voice)
        target_voice = matched

    sr = tts.sample_rate
    total_duration_ms = cues[-1]["end_ms"] + 1000 # Buffer thêm 1s
    total_samples = int(total_duration_ms * sr / 1000)
    master_audio = np.zeros(total_samples, dtype=np.float32)

    for cue_index, cue in enumerate(cues):
        cue_text = cue["text"]
        start_sample = int(cue["start_ms"] * sr / 1000)
        cue_wav = tts.infer(cue_text, voice=target_voice)
        wav_len = len(cue_wav)
        available = int((cue["end_ms"] - cue["start_ms"]) * sr / 1000)
        if available <= 0 or wav_len > available:
            raise ValueError(
                f"SRT_CUE_OVERFLOW: Câu bắt đầu tại {cue['start_ms']}ms cần "
                f"{wav_len * 1000 / sr:.0f}ms nhưng chỉ có "
                f"{cue['end_ms'] - cue['start_ms']}ms. "
                "Hãy tăng thời lượng hoặc rút ngắn câu trong SRT rồi tạo lại giọng đọc."
            )
        if cue_index > 0 and cue["start_ms"] < cues[cue_index - 1]["end_ms"]:
            raise ValueError("SRT_CUE_OVERLAP: Các câu phụ đề không được chồng thời gian khi tạo lời đọc.")
        if start_sample + wav_len > len(master_audio):
            # Mở rộng buffer nếu audio nói dài hơn
            padding = np.zeros((start_sample + wav_len) - len(master_audio), dtype=np.float32)
            master_audio = np.concatenate([master_audio, padding])
        master_audio[start_sample:start_sample + wav_len] = cue_wav

    # Chuẩn hóa âm lượng tránh vỡ tiếng (clipping)
    max_val = np.max(np.abs(master_audio))
    if max_val > 1.0:
        master_audio = master_audio / max_val * 0.98

    sf.write(output_path, master_audio, sr)
    duration_sec = len(master_audio) / float(sr)
    return round(duration_sec, 2)


def generate_srt_tts_aligned(srt_path, voice_id, output_path, scene_cue_ranges=None):
    """Synthesize first, then compact scene windows without stretching the voice.

    Source SRT is never overwritten. Group ranges preserve the editor's scene/image mapping.
    """
    import re
    import math
    raw = Path(srt_path).read_text(encoding="utf-8-sig")
    cues = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        lines = block.splitlines()
        ti = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if ti is None:
            continue
        text = " ".join(line.strip() for line in lines[ti + 1:]).strip()
        if not text:
            raise ValueError("SRT_EMPTY_CUE: Mục SRT không có lời đọc")
        # Validate even though the source times are not reused in compact mode.
        matches = re.findall(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})", lines[ti])
        if len(matches) != 2:
            raise ValueError("SRT_INVALID_TIME: Mốc thời gian không hợp lệ")
        def millis(t):
            h, m, s, ms = t
            return ((int(h)*60+int(m))*60+int(s))*1000+int(ms.ljust(3, "0"))
        if millis(matches[1]) <= millis(matches[0]):
            raise ValueError("SRT_INVALID_TIME: Thời gian kết thúc phải sau bắt đầu")
        cues.append(text)
    if not cues:
        raise ValueError("File SRT không có câu phụ đề hợp lệ")
    ranges = scene_cue_ranges or [[i, i] for i in range(1, len(cues)+1)]
    cursor = 1
    for pair in ranges:
        if (len(pair) != 2 or any(type(x) is not int for x in pair)
                or pair[0] != cursor or pair[1] < pair[0] or pair[1] > len(cues)):
            raise ValueError("SRT_SCENE_RANGES: Các cảnh phải phủ đủ cue theo thứ tự, không trùng")
        cursor = pair[1]+1
    if cursor != len(cues)+1:
        raise ValueError("SRT_SCENE_RANGES: Thiếu cue trong phân cảnh")

    tts = get_tts()
    target = voice_id
    if target not in tts._preset_voices:
        target = next((k for k in tts._preset_voices if k.lower() in target.lower() or target.lower() in k.lower()), tts._default_voice)
    sr = tts.sample_rate
    chunks, aligned, scenes = [], [], []
    samples = 0
    for scene_index, (first, last) in enumerate(ranges, 1):
        scene_start = round(samples*1000/sr)
        for i in range(first, last+1):
            wav = np.asarray(tts.infer(cues[i-1], voice=target), dtype=np.float32).reshape(-1)
            if not len(wav) or not np.isfinite(wav).all():
                raise ValueError("TTS_INVALID_AUDIO: Audio rỗng hoặc không hữu hạn")
            start = round(samples*1000/sr)
            chunks.append(wav); samples += len(wav)
            speech_end = math.ceil(samples*1000/sr)
            pause_ms = 1000 if i == last else 150
            silence = np.zeros(math.ceil(pause_ms*sr/1000), dtype=np.float32)
            chunks.append(silence); samples += len(silence)
            end = round(samples*1000/sr)
            aligned.append(dict(index=i, startMs=start, endMs=end, durMs=end-start,
                                speechEndMs=speech_end, text=cues[i-1]))
        scenes.append(dict(sceneIndex=scene_index, timelineStartMs=scene_start,
                           timelineEndMs=end, sceneDurationMs=end-scene_start,
                           speechEndMs=speech_end-scene_start, cueRange=[first,last]))
    audio = np.concatenate(chunks)
    peak = float(np.max(np.abs(audio)))
    if peak > 1:
        audio *= 0.98/peak
    def stamp(ms):
        h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms,1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    target_path = Path(output_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    aligned_path = target_path.with_suffix('.aligned.srt')
    if aligned_path.resolve() == Path(srt_path).resolve():
        raise ValueError("SRT_OUTPUT_CONFLICT: Không ghi đè SRT nguồn")
    srt = "\n\n".join(f"{c['index']}\n{stamp(c['startMs'])} --> {stamp(c['endMs'])}\n{c['text']}" for c in aligned)+"\n"
    import soundfile as sf
    sf.write(str(target_path), audio, sr)
    temp = aligned_path.with_suffix('.srt.tmp')
    temp.write_text(srt, encoding='utf-8'); os.replace(temp, aligned_path)
    return dict(duration_sec=round(samples/sr, 3), aligned_srt_path=str(aligned_path), cues=aligned, scenes=scenes)


def main():
    send_json({"type": "ready", "message": "VieNeu-TTS Runner Ready (stdin/stdout JSON-RPC)"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            action = req.get("action")

            if action == "list_voices":
                send_json({"type": "voices", "voices": DEFAULT_VOICES})

            elif action == "generate":
                task_id = req.get("task_id", "")
                text = req.get("text", "")
                voice_id = req.get("voice_id", "Thùy Dung")
                output_path = req.get("output_path", "")
                speed = float(req.get("speed", 1.0))

                if not text or not output_path:
                    send_json({"type": "error", "task_id": task_id, "message": "Thiếu text hoặc output_path"})
                    continue

                duration = generate_tts(text, voice_id, output_path, speed)
                send_json({
                    "type": "done",
                    "task_id": task_id,
                    "output_path": output_path,
                    "duration_sec": duration,
                    "voice_id": voice_id
                })

            elif action == "generate_srt_tts":
                task_id = req.get("task_id", "")
                srt_path = req.get("srt_path", "")
                voice_id = req.get("voice_id", "Thùy Dung")
                output_path = req.get("output_path", "")

                if not srt_path or not output_path:
                    send_json({"type": "error", "task_id": task_id, "message": "Thiếu srt_path hoặc output_path"})
                    continue

                result = (generate_srt_tts_aligned(srt_path, voice_id, output_path, req.get("scene_cue_ranges"))
                          if req.get("auto_timing", False) else
                          {"duration_sec": generate_srt_tts(srt_path, voice_id, output_path)})
                send_json({
                    "type": "done",
                    "task_id": task_id,
                    "output_path": output_path,
                    **result,
                    "voice_id": voice_id
                })

            elif action == "exit":
                break

            else:
                send_json({"type": "error", "message": f"Action không xác định: {action}"})

        except Exception as e:
            send_json({"type": "error", "message": str(e)})

if __name__ == "__main__":
    main()
