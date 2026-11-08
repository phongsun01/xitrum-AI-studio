"""Tiện ích media dùng chung: tìm ffmpeg, đọc thông số tệp, chạy ffmpeg có kiểm lỗi."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


_UNIX_CANDIDATES = ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")


def find_ffmpeg() -> str | None:
    """
    Thứ tự: biến môi trường XITRUM_FFMPEG (app Tauri truyền đường dẫn ffmpeg đã đóng gói) →
    ffmpeg trong PATH → vị trí cài đặt phổ biến. Trả None nếu không có.
    """
    env = os.environ.get("XITRUM_FFMPEG")
    if env and Path(env).is_file():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    # App GUI (macOS/Linux) thường không có PATH đầy đủ → thử các vị trí cài đặt phổ biến.
    for d in _UNIX_CANDIDATES:
        c = Path(d) / "ffmpeg"
        if c.is_file():
            return str(c)
    return None


def find_ffprobe() -> str | None:
    """ffprobe cạnh ffmpeg đã chọn → PATH → vị trí phổ biến. Bản ffmpeg đóng gói theo app không kèm ffprobe,
    nên mọi nơi dùng ffprobe phải có đường lui (PyAV: probe_media)."""
    ff = find_ffmpeg()
    if ff:
        sib = Path(ff).with_name("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
        if sib.is_file():
            return str(sib)
    fp = shutil.which("ffprobe")
    if fp:
        return fp
    for d in _UNIX_CANDIDATES:
        c = Path(d) / "ffprobe"
        if c.is_file():
            return str(c)
    return None


def require_ffmpeg() -> str:
    ff = find_ffmpeg()
    if ff is None:
        raise RuntimeError(
            "Không tìm thấy ffmpeg (cần cho ghép cảnh và audio). "
            "Cài ffmpeg hoặc đặt biến môi trường XITRUM_FFMPEG."
        )
    return ff


def _no_window_kwargs() -> dict:
    if sys.platform == "win32":
        return {"creationflags": 0x08000000}  # CREATE_NO_WINDOW
    return {}


def run_ffmpeg(args: list[str], what: str) -> None:
    """Chạy ffmpeg; lỗi thì ném RuntimeError kèm đoạn cuối stderr."""
    cmd = [require_ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-nostdin", *args]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                         **_no_window_kwargs())
    if res.returncode != 0:
        tail = (res.stderr or "").strip().splitlines()[-6:]
        raise RuntimeError(f"ffmpeg lỗi khi {what} (mã {res.returncode}): " + " | ".join(tail))


def probe_media(path) -> dict:
    """
    Đọc thông số bằng PyAV (đã có trong venv; không cần ffprobe):
    {duration_s, video: {width,height,fps,frames,codec,pix_fmt} | None, audio: {rate,channels,codec} | None}
    """
    import av

    with av.open(str(path)) as c:
        info = {"duration_s": float(c.duration) / 1_000_000 if c.duration else 0.0, "video": None, "audio": None}
        if c.streams.video:
            v = c.streams.video[0]
            cc = v.codec_context
            fps = float(v.average_rate) if v.average_rate else 0.0
            frames = v.frames
            if not frames and fps and c.duration:
                frames = round(info["duration_s"] * fps)
            info["video"] = {"width": cc.width, "height": cc.height, "fps": fps, "frames": int(frames or 0),
                             "codec": cc.name, "pix_fmt": cc.pix_fmt}
        if c.streams.audio:
            a = c.streams.audio[0]
            info["audio"] = {"rate": a.codec_context.rate, "channels": a.codec_context.channels,
                             "codec": a.codec_context.name}
            if not info["duration_s"] and a.duration and a.time_base:
                info["duration_s"] = float(a.duration * a.time_base)
        return info
