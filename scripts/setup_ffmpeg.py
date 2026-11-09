#!/usr/bin/env python3
"""Install a local FFmpeg with libass as the Tauri sidecar.

Usage: python3 scripts/setup_ffmpeg.py /path/to/ffmpeg
The binary must target the current machine and include its required libraries.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ffmpeg", type=Path)
    args = parser.parse_args()
    source = args.ffmpeg.expanduser().resolve(strict=True)
    host = subprocess.check_output(["rustc", "-vV"], text=True)
    triple = next(line.removeprefix("host: ") for line in host.splitlines() if line.startswith("host: "))
    suffix = ".exe" if "windows" in triple else ""
    target = Path(__file__).resolve().parents[1] / "src-tauri" / "binaries" / f"ffmpeg-{triple}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    # Validate the copied binary at its actual location before replacing the sidecar.
    fd, temporary = tempfile.mkstemp(prefix="ffmpeg-check-", suffix=suffix, dir=target.parent)
    os.close(fd)
    try:
        shutil.copy2(source, temporary)
        os.chmod(temporary, 0o755)
        result = subprocess.run([temporary, "-hide_banner", "-filters"], capture_output=True, text=True, check=True)
        filters = {parts[1] for line in result.stdout.splitlines() if len(parts := line.split()) >= 2}
        missing = {"subtitles", "ass"} - filters
        if missing:
            raise SystemExit(f"FFmpeg thiếu libass: {', '.join(sorted(missing))}. Sidecar cũ được giữ nguyên.")
        os.replace(temporary, target)
        print(f"Đã cài FFmpeg có subtitles/ass: {target}")
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    main()
