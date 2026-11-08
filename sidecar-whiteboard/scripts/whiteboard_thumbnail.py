"""Prepend the reviewed PNG for exactly two seconds, shifting all scene audio together."""
from __future__ import annotations

import base64
from fractions import Fraction
import json
from pathlib import Path
import subprocess
import tempfile

from whiteboard_audio import resolve_ffmpeg_and_probe

COVER_DURATION_MS = 2000


def prepend_thumbnail(video_path: str, encoded_png: str, output_path: str):
    ffmpeg, ffprobe = resolve_ffmpeg_and_probe()
    if not ffmpeg or not ffprobe:
        raise RuntimeError("Cần FFmpeg và ffprobe để chèn thumbnail")
    if len(encoded_png) > 24 * 1024 * 1024:
        raise ValueError("Thumbnail quá lớn")
    png = base64.b64decode(encoded_png, validate=True)
    from PIL import Image
    import io
    with Image.open(io.BytesIO(png)) as image:
        if image.format != "PNG" or image.size not in ((1280, 720), (720, 1280)):
            raise ValueError("Thumbnail phải là PNG 1280×720 (16:9) hoặc 720×1280 (9:16)")
        image.verify()
    probe = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", video_path],
                           capture_output=True, text=True, check=True)
    info = json.loads(probe.stdout)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    fps = Fraction(video["r_frame_rate"])
    cover_frames = fps * 2
    if fps <= 0 or cover_frames.denominator != 1:
        raise ValueError("FPS phải biểu diễn chính xác đoạn bìa 2 giây")
    width, height = int(video["width"]), int(video["height"])
    # Whiteboard output is CFR. Normalize timebases for frame-exact concat.
    filters = [
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,"
        f"trim=end_frame={int(cover_frames)},settb=AVTB,setpts=PTS-STARTPTS[cover]",
        f"[1:v]fps={fps},setsar=1,settb=AVTB,setpts=PTS-STARTPTS[body]",
        "[cover][body]concat=n=2:v=1:a=0[v]",
    ]
    if audio:
        duration = float(video.get("duration") or info["format"]["duration"]) + 2
        filters.append(f"[1:a]adelay={COVER_DURATION_MS}:all=1,apad,atrim=duration={duration:.9f}[a]")
    with tempfile.TemporaryDirectory(prefix="wb-cover-", dir=str(Path(output_path).resolve().parent)) as tmp:
        cover = Path(tmp) / "cover.png"
        cover.write_bytes(png)
        cmd = [ffmpeg, "-y", "-v", "error", "-loop", "1", "-framerate", str(fps), "-i", str(cover),
               "-i", video_path, "-filter_complex", ";".join(filters), "-map", "[v]",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(fps), "-crf", "20"]
        if audio:
            cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
        cmd += ["-movflags", "+faststart", output_path]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode:
            Path(output_path).unlink(missing_ok=True)
            raise RuntimeError(f"Chèn thumbnail thất bại: {result.stderr[-2000:]}")
