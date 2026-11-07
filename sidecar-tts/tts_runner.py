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

    for cue in cues:
        cue_text = cue["text"]
        start_sample = int(cue["start_ms"] * sr / 1000)
        cue_wav = tts.infer(cue_text, voice=target_voice)
        wav_len = len(cue_wav)
        if start_sample + wav_len > len(master_audio):
            # Mở rộng buffer nếu audio nói dài hơn
            padding = np.zeros((start_sample + wav_len) - len(master_audio), dtype=np.float32)
            master_audio = np.concatenate([master_audio, padding])
        master_audio[start_sample:start_sample + wav_len] += cue_wav

    # Chuẩn hóa âm lượng tránh vỡ tiếng (clipping)
    max_val = np.max(np.abs(master_audio))
    if max_val > 1.0:
        master_audio = master_audio / max_val * 0.98

    sf.write(output_path, master_audio, sr)
    duration_sec = len(master_audio) / float(sr)
    return round(duration_sec, 2)


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

                duration = generate_srt_tts(srt_path, voice_id, output_path)
                send_json({
                    "type": "done",
                    "task_id": task_id,
                    "output_path": output_path,
                    "duration_sec": duration,
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
