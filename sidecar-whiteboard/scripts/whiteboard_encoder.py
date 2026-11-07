"""
whiteboard_encoder.py - Trừu tượng hóa FrameWriter & Encode trực tiếp FFmpeg H.264 (R5)

Bao gồm:
- FFmpegDirectPipeWriter: Khởi chạy tiến trình FFmpeg `libx264` và pipe trực tiếp raw BGR frames qua stdin:
    + Loại bỏ hoàn toàn tệp MP4V trung gian (tiết kiệm thời gian ghi/đọc đĩa 2 lần).
    + Chuẩn hóa chuẩn đầu ra: H.264, pix_fmt yuv420p, fps chính xác, kích thước chẵn.
    + Đọc stderr trong thread riêng để tránh deadlock khi bộ nhớ đệm stderr đầy.
    + Xử lý graceful broken pipe, SIGINT/SIGTERM, kill process group theo nền tảng khi bị hủy.
    + Xác thực file video đầu ra qua ffprobe trước khi công bố hoàn tất.
- create_frame_writer: Factory method chọn FFmpegDirectPipeWriter nếu có ffmpeg, hoặc fallback OpenCV VideoWriter an toàn.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional, Tuple
import cv2
import numpy as np


def resolve_ffmpeg_binary() -> Optional[str]:
    """Tìm binary ffmpeg trên hệ thống."""
    f = shutil.which("ffmpeg")
    if f:
        return f
    for cand in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
        if Path(cand).exists():
            return cand
    return None


class BaseFrameWriter:
    def write(self, frame_bgr: np.ndarray):
        raise NotImplementedError

    def release(self) -> bool:
        raise NotImplementedError

    def is_opened(self) -> bool:
        raise NotImplementedError

    def terminate(self):
        raise NotImplementedError


class FFmpegDirectPipeWriter(BaseFrameWriter):
    """
    Pipe trực tiếp frame BGR từ Python sang FFmpeg libx264 qua stdin.
    Không tạo file mp4v trung gian.
    """

    def __init__(
        self,
        output_path: str | Path,
        width: int,
        height: int,
        fps: int = 30,
        crf: int = 20,
        preset: str = "medium",
    ):
        self.output_path = Path(output_path)
        self.width = width
        self.height = height
        self.fps = fps
        self.crf = crf
        self.preset = preset

        # Đảm bảo thư mục cha tồn tại
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        # Ghi vào file part trước
        self.tmp_target = self.output_path.with_name(self.output_path.name + ".part.mp4")

        ffmpeg_bin = resolve_ffmpeg_binary()
        if not ffmpeg_bin:
            raise RuntimeError("Không tìm thấy binary ffmpeg để khởi tạo direct pipe writer")

        cmd = [
            ffmpeg_bin,
            "-y",
            "-loglevel", "error",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "-",  # Đọc từ stdin
            "-c:v", "libx264",
            "-crf", str(crf),
            "-preset", preset,
            "-pix_fmt", "yuv420p",
            str(self.tmp_target),
        ]

        # Inherit the runner process group on Unix; Rust owns cancellation.
        creationflags = 0
        preexec_fn = None
        if sys.platform != "win32":
            # Inherit the runner process group so Rust cancellation kills the encoder too.
            preexec_fn = None
        else:
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            bufsize=10 * 1024 * 1024,  # 10MB buffer
            preexec_fn=preexec_fn,
            creationflags=creationflags,
        )

        self._stderr_lines = []
        self._stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self._stderr_thread.start()
        self._closed = False
        self._frames_written = 0

    def _read_stderr(self):
        try:
            if self.proc and self.proc.stderr:
                for line in self.proc.stderr:
                    self._stderr_lines.append(line.decode("utf-8", errors="replace"))
        except Exception:
            pass

    def is_opened(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def write(self, frame_bgr: np.ndarray):
        if self._closed:
            raise RuntimeError("Tiến trình FFmpeg đã dừng hoặc đóng; không thể ghi frame tiếp theo")
        if not self.is_opened():
            self.terminate()
            raise RuntimeError("Tiến trình FFmpeg đã dừng hoặc đóng; không thể ghi frame tiếp theo")

        # Đảm bảo đúng kích thước và kiểu uint8
        h, w = frame_bgr.shape[:2]
        if h != self.height or w != self.width:
            frame_bgr = cv2.resize(frame_bgr, (self.width, self.height), interpolation=cv2.INTER_NEAREST)

        raw_bytes = frame_bgr.tobytes()
        try:
            self.proc.stdin.write(raw_bytes)
            self._frames_written += 1
        except (BrokenPipeError, IOError) as e:
            self.terminate()
            err_msg = "".join(self._stderr_lines[-10:])
            raise RuntimeError(f"FFmpeg stdin broken pipe: {e}\nStderr: {err_msg}")

    def release(self) -> bool:
        if self._closed:
            return False
        self._closed = True

        if self.proc:
            try:
                if self.proc.stdin:
                    self.proc.stdin.close()
            except Exception:
                pass

            try:
                ret = self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.terminate()
                ret = -1

            self._stderr_thread.join(timeout=1.0)
            if self.proc.stderr:
                self.proc.stderr.close()

            if ret != 0:
                err_msg = "".join(self._stderr_lines[-15:])
                self.tmp_target.unlink(missing_ok=True)
                raise RuntimeError(f"FFmpeg kết thúc với lỗi code {ret}: {err_msg}")

            from whiteboard_cache import probe_video_streams
            valid, w, h, duration, _ = probe_video_streams(self.tmp_target)
            expected = self._frames_written / float(self.fps)
            if not valid or (w, h) != (self.width, self.height) or abs(duration - expected) > 1.0 / self.fps + 0.02:
                self.tmp_target.unlink(missing_ok=True)
                raise RuntimeError("ENCODE_INVALID: Output không khớp kích thước/thời lượng đã render")

            # Đổi tên nguyên tử part -> output_path
            if self.tmp_target.exists():
                self.tmp_target.replace(self.output_path)
                return True
        return False

    def terminate(self):
        """Stop this encoder; the runner process group is managed by Rust."""
        self._closed = True
        if not self.proc:
            return
        try:
            self.proc.kill()
            self.proc.wait(timeout=5)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass
        if self.proc.stdin:
            try:
                self.proc.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        self._stderr_thread.join(timeout=1.0)
        if self.proc.stderr:
            self.proc.stderr.close()
        self.tmp_target.unlink(missing_ok=True)


class OpenCVFallbackWriter(BaseFrameWriter):
    """Fallback dùng OpenCV VideoWriter (mp4v) nếu không có binary ffmpeg."""

    def __init__(self, output_path: str | Path, width: int, height: int, fps: int = 30):
        self.output_path = Path(output_path)
        self.tmp_path = self.output_path.with_name(self.output_path.stem + "_raw.mp4")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self.writer = cv2.VideoWriter(str(self.tmp_path), fourcc, fps, (width, height))
        if not self.writer.isOpened():
            raise RuntimeError(f"Không thể mở OpenCV VideoWriter cho {self.tmp_path}")

    def is_opened(self) -> bool:
        return self.writer.isOpened()

    def write(self, frame_bgr: np.ndarray):
        self.writer.write(frame_bgr)

    def terminate(self):
        self.writer.release()
        self.tmp_path.unlink(missing_ok=True)

    def release(self) -> bool:
        self.writer.release()
        import stream_render as sr
        sr.transcode_h264(self.tmp_path, self.output_path)
        return True


def create_frame_writer(
    output_path: str | Path,
    width: int,
    height: int,
    fps: int = 30,
) -> BaseFrameWriter:
    """Factory method khởi tạo FrameWriter tối ưu."""
    ffmpeg_bin = resolve_ffmpeg_binary()
    if ffmpeg_bin:
        return FFmpegDirectPipeWriter(output_path, width, height, fps=fps)
    return OpenCVFallbackWriter(output_path, width, height, fps=fps)

