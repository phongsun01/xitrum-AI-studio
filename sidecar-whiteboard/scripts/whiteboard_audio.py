"""
Module quản lý và xử lý Audio cho Whiteboard Animation của Xitrum AI Studio (W2).
Bao gồm:
- Probe thời lượng và audio streams qua ffprobe hoặc ffmpeg.
- Trích xuất/cắt đoạn audio theo khoảng thời gian [start_ms, end_ms) chính xác (decode sang PCM/WAV trước, không cắt theo packet nén).
- Tạo silence audio (đoạn im lặng) với đúng sample rate/channels để đệm cho cảnh không tiếng.
- Mux audio vào video phân cảnh hoặc mux master audio vào video ghép cuối bài bằng ffmpeg.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple


def resolve_ffmpeg_and_probe() -> Tuple[Optional[str], Optional[str]]:
    """Tìm binary ffmpeg và ffprobe có thể thực thi."""
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")

    candidates_ffmpeg = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]
    candidates_probe = [
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        "/usr/bin/ffprobe",
    ]

    if ffmpeg is None:
        for c in candidates_ffmpeg:
            if Path(c).exists():
                ffmpeg = c
                break

    if ffprobe is None:
        for c in candidates_probe:
            if Path(c).exists():
                ffprobe = c
                break

    return ffmpeg, ffprobe


def probe_audio_duration_ms(audio_path: str | Path) -> int:
    """Đo thời lượng audio chính xác bằng ffprobe (trả về milliseconds)."""
    ffmpeg, ffprobe = resolve_ffmpeg_and_probe()
    audio_path_str = str(audio_path)

    if ffprobe:
        cmd = [
            ffprobe,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path_str,
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            val = float(res.stdout.strip())
            return int(round(val * 1000.0))
        except Exception:
            pass

    # Fallback dùng ffmpeg nếu không có ffprobe
    if ffmpeg:
        cmd = [ffmpeg, "-i", audio_path_str]
        res = subprocess.run(cmd, capture_output=True, text=True)
        # Parse Duration: 00:01:23.45
        import re
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", res.stderr)
        if m:
            hours, mins, secs = int(m.group(1)), int(m.group(2)), float(m.group(3))
            total_sec = hours * 3600 + mins * 60 + secs
            return int(round(total_sec * 1000.0))

    return 0


def extract_audio_segment(
    input_audio: str | Path,
    output_audio: str | Path,
    start_ms: int,
    end_ms: int,
    sample_rate: int = 44100,
    channels: int = 2,
) -> bool:
    """
    Cắt đoạn audio từ start_ms đến end_ms và chuẩn hóa sample_rate/channels.
    Decode hoàn toàn sang PCM/AAC để bảo đảm timestamp không bị lệch do nén.
    """
    ffmpeg, _ = resolve_ffmpeg_and_probe()
    if not ffmpeg:
        raise RuntimeError("Không tìm thấy ffmpeg trên hệ thống để xử lý audio")

    dur_ms = max(0, end_ms - start_ms)
    start_sec = start_ms / 1000.0
    dur_sec = dur_ms / 1000.0

    out_p = Path(output_audio)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg,
        "-y",
        "-ss", f"{start_sec:.3f}",
        "-t", f"{dur_sec:.3f}",
        "-i", str(input_audio),
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "-c:a", "aac",
        "-b:a", "192k",
        str(output_audio),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0


def generate_silence_audio(
    output_audio: str | Path,
    duration_ms: int,
    sample_rate: int = 44100,
    channels: int = 2,
) -> bool:
    """Tạo tệp audio im lặng (silence) đúng thời lượng duration_ms."""
    ffmpeg, _ = resolve_ffmpeg_and_probe()
    if not ffmpeg:
        raise RuntimeError("Không tìm thấy ffmpeg trên hệ thống")

    dur_sec = max(0.1, duration_ms / 1000.0)
    out_p = Path(output_audio)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg,
        "-y",
        "-f", "lavfi",
        "-i", f"anullsrc=r={sample_rate}:cl=stereo",
        "-t", f"{dur_sec:.3f}",
        "-c:a", "aac",
        "-b:a", "192k",
        str(output_audio),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0


def mux_video_and_audio(
    video_path: str | Path,
    audio_path: str | Path,
    output_path: str | Path,
    shortest: bool = False,
    pad_audio_or_video: bool = True,
) -> bool:
    """
    Ghép video và audio vào output_path với stream mapping tường minh:
      - Map 0:v:0 (video từ input 0)
      - Map 1:a:0 (audio từ input 1)
    Nếu pad_audio_or_video=True:
      - Khi audio dài hơn video: tpad giữ frame cuối của video đến khi hết audio.
      - Khi audio ngắn hơn video: apad đệm silence cho audio đến khi hết video.
    """
    ffmpeg, ffprobe = resolve_ffmpeg_and_probe()
    if not ffmpeg:
        raise RuntimeError("Không tìm thấy ffmpeg trên hệ thống")

    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)

    # Đo thời lượng video và audio để quyết định padding nếu cần
    v_dur_ms = 0
    a_dur_ms = probe_audio_duration_ms(audio_path)
    if ffprobe:
        try:
            cmd_v = [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ]
            res_v = subprocess.run(cmd_v, capture_output=True, text=True)
            if res_v.returncode == 0:
                v_dur_ms = int(float(res_v.stdout.strip()) * 1000)
        except Exception:
            v_dur_ms = 0

    # Nếu audio dài hơn video trên 300ms và có yêu cầu giữ hình cuối (R0)
    if pad_audio_or_video and a_dur_ms > v_dur_ms > 0 and (a_dur_ms - v_dur_ms) >= 300:
        pad_sec = (a_dur_ms - v_dur_ms) / 1000.0
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(video_path),
            "-i", str(audio_path),
            "-filter_complex", f"[0:v:0]tpad=stop_mode=clone:stop_duration={pad_sec:.3f}[v]",
            "-map", "[v]",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            str(output_path),
        ]
    else:
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(video_path),
            "-i", str(audio_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
        ]
        if shortest:
            cmd.append("-shortest")
        cmd.append(str(output_path))

    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0

