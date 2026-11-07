"""
whiteboard_cache.py - Quản lý Manifest, Fingerprint và Cache an toàn cho Whiteboard (R1)

Bao gồm:
- calculate_scene_fingerprint: Tính mã băm SHA-256 thống nhất từ:
    + Nội dung ảnh (byte hash)
    + Nội dung annotation.json (hoặc canonical elements json)
    + Cấu hình render: fps, paper_color, hand_path, duration_ms, ink_path, color_fill, ink_weight, color_weight
    + Audio hash nếu có
- verify_output_manifest: Kiểm tra file video tồn tại, manifest complete, fingerprint khớp và probe stream hợp lệ.
- write_scene_manifest: Ghi file .manifest.json nguyên tử sau khi render hoàn tất.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

CURRENT_CACHE_VERSION = 2


def hash_file(file_path: str | Path) -> str:
    """Tính SHA-256 của file."""
    p = Path(file_path)
    if not p.is_file():
        return ""
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def calculate_scene_fingerprint(
    image_path: str,
    annotation_path: str,
    fps: int,
    paper_color: str,
    hand_path: Optional[str] = None,
    audio_path: Optional[str] = None,
    duration_ms: Optional[int] = None,
    ink_path: Optional[str] = None,
    color_fill: Optional[str] = None,
    ink_weight: Optional[float] = None,
    color_weight: Optional[float] = None,
    subject_first: bool = False,
    engine_version: str = "review-fixes-v2",
) -> str:
    """
    Tạo fingerprint độc nhất cho một cảnh vẽ.
    Bất kỳ thay đổi nào của ảnh, annotation, thời lượng, style hoặc audio đều tạo fingerprint mới.
    """
    image_h = hash_file(image_path)
    anno_h = hash_file(annotation_path)
    audio_h = hash_file(audio_path) if audio_path else ""
    hand_h = hash_file(hand_path) if hand_path else ""

    payload = {
        "engineVersion": engine_version,
        "subjectFirst": subject_first,
        "imageHash": image_h,
        "annotationHash": anno_h,
        "audioHash": audio_h,
        "handHash": hand_h,
        "fps": fps,
        "paperColor": paper_color.upper() if paper_color else "",
        "durationMs": duration_ms,
        "inkPath": ink_path or "",
        "colorFill": color_fill or "",
        "inkWeight": ink_weight,
        "colorWeight": color_weight,
    }
    encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def probe_video_streams(video_path: str | Path) -> Tuple[bool, int, int, float, bool]:
    """
    Probe video bằng ffprobe:
    Trả về: (ok, width, height, duration_sec, has_audio)
    """
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        for c in ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"]:
            if Path(c).exists():
                ffprobe = c
                break

    if not ffprobe or not Path(video_path).is_file():
        # Fallback PyAV nếu không có ffprobe
        try:
            import av
            cont = av.open(str(video_path))
            has_v = len(cont.streams.video) > 0
            has_a = len(cont.streams.audio) > 0
            if not has_v:
                cont.close()
                return False, 0, 0, 0.0, False
            v = cont.streams.video[0]
            w, h = v.width, v.height
            dur = float(cont.duration) / 1000000.0 if cont.duration else 0.0
            cont.close()
            return True, w, h, dur, has_a
        except Exception:
            return False, 0, 0, 0.0, False

    try:
        cmd = [
            ffprobe,
            "-v", "error",
            "-show_entries", "stream=codec_type,width,height:format=duration",
            "-of", "json",
            str(video_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            return False, 0, 0, 0.0, False
        data = json.loads(res.stdout)
        streams = data.get("streams", [])
        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        if not video_stream:
            return False, 0, 0, 0.0, False
        w = int(video_stream.get("width", 0))
        h = int(video_stream.get("height", 0))
        dur_str = data.get("format", {}).get("duration", "0")
        dur = float(dur_str)
        return True, w, h, dur, has_audio
    except Exception:
        return False, 0, 0, 0.0, False


def verify_scene_cache(video_path: str, expected_fingerprint: str) -> bool:
    """
    Kiểm tra xem file video có hợp lệ để tái dùng (Resume cache) không:
    1. File video tồn tại và dung lượng > 1000 bytes.
    2. File .manifest.json cùng tên tồn tại.
    3. Manifest có trạng thái 'complete' và fingerprint khớp chính xác.
    4. Video probe được stream hợp lệ.
    """
    vp = Path(video_path)
    if not vp.is_file() or vp.stat().st_size < 1000:
        return False

    manifest_path = vp.with_name(vp.name + ".manifest.json")
    if not manifest_path.is_file():
        return False

    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        if data.get("status") != "complete":
            return False
        if data.get("fingerprint") != expected_fingerprint:
            return False
    except Exception:
        return False

    if data.get("outputHash") != hash_file(vp):
        return False

    ok, w, h, dur, _ = probe_video_streams(vp)
    if not ok or w <= 0 or h <= 0 or dur <= 0:
        return False

    return True


def write_scene_manifest(video_path: str, fingerprint: str, extra: Optional[Dict[str, Any]] = None):
    """Ghi manifest nguyên tử sau khi render thành công."""
    vp = Path(video_path)
    manifest_path = vp.with_name(vp.name + ".manifest.json")
    tmp_path = vp.with_name(vp.name + ".manifest.json.tmp")

    payload: Dict[str, Any] = {
        "status": "complete",
        "fingerprint": fingerprint,
        "videoPath": str(vp),
        "fileSize": vp.stat().st_size if vp.exists() else 0,
        "outputHash": hash_file(vp),
        "manifestVersion": CURRENT_CACHE_VERSION,
    }
    if extra:
        payload.update(extra)

    tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp_path.replace(manifest_path)

