"""Append a three-second studio end card without shifting body audio."""
from fractions import Fraction
from pathlib import Path
import json
import subprocess

from whiteboard_audio import resolve_ffmpeg_and_probe
from whiteboard_thumbnail import _probe_with_pyav

ENDING_SECONDS = 3
DEFAULT_PORTRAIT_ENDING = Path(__file__).resolve().parent.parent / "assets" / "xitrum-ending-9x16.png"
DEFAULT_ENDING = Path(__file__).resolve().parent.parent / "assets" / "xitrum-ending.png"


def append_ending(video_path, output_path, image_path=None):
    if image_path and not Path(image_path).is_file():
        raise ValueError(f"Không tìm thấy ảnh cuối video: {image_path}")
    ffmpeg, ffprobe = resolve_ffmpeg_and_probe()
    if not ffmpeg:
        raise RuntimeError("Cần FFmpeg để chèn ảnh cuối video")
    if ffprobe:
        probe = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video_path)], capture_output=True, text=True, check=True)
        info = json.loads(probe.stdout)
    else:
        info = _probe_with_pyav(video_path)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = any(s["codec_type"] == "audio" for s in info["streams"])
    fps = Fraction(video["r_frame_rate"])
    if fps <= 0:
        raise ValueError("FPS không hợp lệ")
    width, height = int(video["width"]), int(video["height"])
    card = Path(image_path) if image_path else (DEFAULT_PORTRAIT_ENDING if height > width else DEFAULT_ENDING)
    if not card.is_file():
        raise ValueError(f"Không tìm thấy ảnh cuối video: {card}")
    from PIL import Image
    with Image.open(card) as image:
        image.verify()
    duration = float(video.get("duration") or info["format"]["duration"])
    filters = [
        f"[0:v]fps={fps},setsar=1,settb=AVTB,setpts=PTS-STARTPTS[body]",
        f"[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=0x0c182b,setsar=1,trim=end_frame={round(fps * ENDING_SECONDS)},settb=AVTB,setpts=PTS-STARTPTS[ending]",
        "[body][ending]concat=n=2:v=1:a=0[v]",
    ]
    if audio:
        # Trim/pad body first, then pad silence for the end card.
        filters.append(f"[0:a]asetpts=PTS-STARTPTS,apad,atrim=duration={duration:.9f},apad,atrim=duration={duration + ENDING_SECONDS:.9f}[a]")
    cmd = [ffmpeg, "-y", "-v", "error", "-i", str(video_path), "-loop", "1", "-framerate", str(fps), "-i", str(card),
           "-filter_complex", ";".join(filters), "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(fps), "-crf", "20"]
    if audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-movflags", "+faststart", str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode:
        Path(output_path).unlink(missing_ok=True)
        raise RuntimeError(f"Chèn ảnh cuối thất bại: {result.stderr[-2000:]}")
