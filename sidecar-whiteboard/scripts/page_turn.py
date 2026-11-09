"""Hiệu ứng lật trang (phải → trái) giữa hai cảnh, dựng bằng OpenCV, giữ nguyên tổng số khung hình.

Ý tưởng: cảnh whiteboard kết thúc bằng một đoạn khung tĩnh (giữ hình) và cảnh kế tiếp bắt đầu bằng giấy trắng.
Ta thay N khung CUỐI của cảnh trước (khi chúng tĩnh) bằng N khung lật trang để lộ khung ĐẦU của cảnh sau.
Vì chỉ thay khung chứ không chồng lấp, thời lượng video và audio/timeline không đổi.
"""
from __future__ import annotations

from collections import deque

import cv2
import numpy as np

MIN_FRAMES = 6            # đoạn tĩnh ngắn hơn thế thì bỏ qua lật trang
STATIC_TOLERANCE = 0.5    # sai khác trung bình (0–255) coi là "khung tĩnh"


def _ease(p: float) -> float:
    return p * p * (3.0 - 2.0 * p)


def page_turn_frame(a: np.ndarray, b: np.ndarray, p: float) -> np.ndarray:
    """Khung lật trang tại tiến độ p∈[0,1]: p=0 → a, p=1 → b. Trang a lật quanh gáy bên trái, mép tự do chạy phải → trái."""
    if p <= 0.0:
        return a.copy()
    if p >= 1.0:
        return b.copy()
    h, w = a.shape[:2]
    e = _ease(p)
    x_edge = w * (1.0 - e)
    if x_edge < 1.0:
        return b.copy()
    lift = h * 0.07 * np.sin(np.pi * p)  # mép tự do nâng lên gần người xem → cao hơn một chút
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[0, 0], [x_edge, -lift], [x_edge, h + lift], [0, h]])
    mat = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(a, mat, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), mat, (w, h), flags=cv2.INTER_LINEAR)
    m = (mask.astype(np.float32) / 255.0)[..., None]

    xs = np.arange(w, dtype=np.float32)[None, :, None]
    amp = float(np.sin(np.pi * p))
    # Bóng trên trang đang lật: tối dần về phía mép tự do.
    u = np.clip(xs / max(x_edge, 1.0), 0.0, 1.0)
    page_shade = 1.0 - 0.38 * amp * (u ** 2)
    # Bóng đổ lên trang bên dưới, ngay sát mép, tắt dần theo khoảng cách.
    d = np.clip(xs - x_edge, 0.0, None)
    under_shade = 1.0 - 0.30 * amp * np.exp(-d / (0.07 * w))
    under_shade = np.where(xs >= x_edge, under_shade, 1.0)

    under = b.astype(np.float32) * under_shade
    over = warped.astype(np.float32) * page_shade
    out = over * m + under * (1.0 - m)
    return np.clip(out, 0, 255).astype(np.uint8)


def plan_static_tail(frames_tail: list[np.ndarray], want: int) -> int:
    """Số khung cuối (≤ want) thật sự tĩnh (giống khung cuối cùng). 0 nếu không đủ MIN_FRAMES."""
    if not frames_tail:
        return 0
    last = frames_tail[-1].astype(np.float32)
    n = 0
    for f in reversed(frames_tail[-want:]):
        if float(np.mean(np.abs(f.astype(np.float32) - last))) > STATIC_TOLERANCE:
            break
        n += 1
    return n if n >= MIN_FRAMES else 0


def read_tail_and_first(path: str, want: int) -> tuple[list[np.ndarray], np.ndarray | None, int]:
    """Đọc (want khung cuối, khung đầu, tổng số khung) của một clip bằng OpenCV, giữ bộ nhớ O(want)."""
    cap = cv2.VideoCapture(str(path))
    tail: deque = deque(maxlen=max(1, want))
    first = None
    total = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if first is None:
                first = frame.copy()
            tail.append(frame)
            total += 1
    finally:
        cap.release()
    return list(tail), first, total


def build_transition_frames(tail: list[np.ndarray], first_b: np.ndarray, n: int) -> list[np.ndarray]:
    """n khung lật trang từ khung cuối của A (tail[-1]) sang khung đầu của B; khung cuối cùng đúng bằng B."""
    a = tail[-1]
    b = first_b
    if b.shape[:2] != a.shape[:2]:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    return [page_turn_frame(a, b, k / n) for k in range(1, n + 1)]
