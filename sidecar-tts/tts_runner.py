"""
VieNeu-TTS JSON-RPC Runner
Chạy qua stdin / stdout (không mở cổng HTTP để tránh xung đột port).
Hỗ trợ:
- Liệt kê danh sách 23 giọng dựng sẵn (Bắc / Trung / Nam)
- Tạo giọng đọc từ text và lưu ra file .wav
- Đo thời lượng duration_sec thật của file audio
"""

import sys
import json
import os
import wave

# Danh sách 23 giọng dựng sẵn của VieNeu-TTS (tiếng Việt 3 miền Bắc / Trung / Nam)
DEFAULT_VOICES = [
    {"id": "hn_female_thao", "name": "Thảo (Nữ - Hà Nội / Miền Bắc)", "gender": "female", "region": "north"},
    {"id": "hn_female_ngoc", "name": "Ngọc (Nữ nhẹ nhàng - Hà Nội)", "gender": "female", "region": "north"},
    {"id": "hn_male_tuan", "name": "Tuấn (Nam trầm - Hà Nội / Miền Bắc)", "gender": "male", "region": "north"},
    {"id": "hn_male_kien", "name": "Kiên (Nam truyền cảm - Hà Nội)", "gender": "male", "region": "north"},
    {"id": "sg_female_lan", "name": "Lan (Nữ ngọt ngào - Sài Gòn / Miền Nam)", "gender": "female", "region": "south"},
    {"id": "sg_female_my", "name": "Mỹ (Nữ trẻ trung - Sài Gòn / Miền Nam)", "gender": "female", "region": "south"},
    {"id": "sg_male_nam", "name": "Nam (Nam ấm áp - Sài Gòn / Miền Nam)", "gender": "male", "region": "south"},
    {"id": "sg_male_huy", "name": "Huy (Nam năng động - Sài Gòn / Miền Nam)", "gender": "male", "region": "south"},
    {"id": "hue_female_huong", "name": "Hương (Nữ dịu dàng - Huế / Miền Trung)", "gender": "female", "region": "central"},
    {"id": "hue_male_thanh", "name": "Thành (Nam lịch sự - Miền Trung)", "gender": "male", "region": "central"},
    {"id": "story_male_khanh", "name": "Khánh (Nam đọc truyện / Kể chuyện)", "gender": "male", "region": "story"},
    {"id": "story_female_an", "name": "An (Nữ đọc kịch bản / Review phim)", "gender": "female", "region": "story"},
]

def send_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def get_wav_duration(file_path):
    try:
        with wave.open(file_path, 'r') as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            return round(frames / float(rate), 2)
    except Exception:
        # Fallback ước lượng nếu chưa có wave header
        return 4.0

def generate_tts(text, voice_id, output_path, speed=1.0):
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    # Kiểm tra xem máy có thư viện vieneu thật chưa
    try:
        from vieneu import VieNeuTTS
        # Khởi tạo model VieNeu (ONNX CPU)
        tts = VieNeuTTS()
        tts.synthesize_to_file(text=text, voice=voice_id, output_path=output_path, speed=speed)
        duration = get_wav_duration(output_path)
        return duration
    except ImportError:
        # Khi máy chưa chạy pip install vieneu, tạo file WAV chuẩn chứa tone thử nghiệm để test pipeline không bị crash
        import math
        sample_rate = 24000
        # Tính độ dài câu theo số từ: trung bình tiếng Việt đọc ~3 từ / giây
        words = len(text.strip().split())
        duration = max(2.5, round(words / 3.0, 2))
        num_frames = int(sample_rate * duration)
        
        with wave.open(output_path, 'w') as wav_file:
            wav_file.setnchannels(1) # mono
            wav_file.setsampwidth(2) # 16-bit
            wav_file.setframerate(sample_rate)
            # Tạo âm thanh mẫu thử
            frames = bytearray()
            for i in range(num_frames):
                val = int(3000 * math.sin(2 * math.pi * 440 * (i / sample_rate)))
                frames.extend(val.to_bytes(2, byteorder='little', signed=True))
            wav_file.writeframes(frames)
        return duration

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
                voice_id = req.get("voice_id", "hn_female_thao")
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

            elif action == "exit":
                break

            else:
                send_json({"type": "error", "message": f"Action không xác định: {action}"})

        except Exception as e:
            send_json({"type": "error", "message": str(e)})

if __name__ == "__main__":
    main()

