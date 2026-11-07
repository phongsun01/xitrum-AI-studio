#!/usr/bin/env python3
"""
Bộ lập kế hoạch nét vẽ và phân bổ thời lượng thích ứng cho Whiteboard (Giai đoạn W5).

Các nguyên tắc:
1. Endpoint-first: Nét hở phải bắt đầu từ đầu mút tự nhiên (degree = 1).
2. Đường liên tiếp qua giao điểm (junctions): Chọn hướng đi thẳng nhất (tối thiểu góc lệch),
   không rẽ nhánh phân mảnh làm nét "mọc đồng loạt từ giữa".
3. Vòng kín (closed loops): Bắt đầu từ điểm cực trị (top-left) và đi một chiều khép kín.
4. Nhấc bút (Pen Up / Pen Down): Khi chuyển giữa các stroke rời, đánh dấu pen_lift.
   Tuyệt đối không vẽ đường nối mực giả giữa hai nét rời nhau.
5. Cân bằng thời lượng thích ứng: Phân bổ số khung hình theo tỷ lệ tổng độ dài thực của nét
   thay vì chia đều mù quáng.
"""
from __future__ import annotations

import math
from typing import Sequence
import numpy as np
import cv2

_SKEL_NEIGHBORS_8 = [
    (-1, -1), (0, -1), (1, -1),
    (-1, 0),           (1, 0),
    (-1, 1),  (0, 1),  (1, 1),
]


def _skel_neighbors(skel: np.ndarray, point: tuple[int, int]) -> list[tuple[int, int]]:
    """Trả về các điểm lân cận 8 hướng hợp lệ của một pixel khung xương."""
    x, y = point
    h, w = skel.shape
    result: list[tuple[int, int]] = []
    for dx, dy in _SKEL_NEIGHBORS_8:
        nx, ny = x + dx, y + dy
        if not (0 <= nx < w and 0 <= ny < h and skel[ny, nx]):
            continue
        # Tránh tạo tam giác thừa tại góc vuông (nếu đã có cầu nối trực giao)
        if dx != 0 and dy != 0 and (skel[y, nx] or skel[ny, x]):
            continue
        result.append((nx, ny))
    return result


def _edge_key(a: tuple[int, int], b: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    """Chuẩn hóa cạnh vô hướng giữa 2 điểm (A, B) = (B, A)."""
    return (a, b) if a <= b else (b, a)


def _choose_straightest_next(
    prev: tuple[int, int],
    cur: tuple[int, int],
    candidates: list[tuple[int, int]],
    visited_edges: set,
) -> tuple[int, int] | None:
    """
    Tại điểm giao (degree >= 3) hoặc ngã ba:
    Lựa chọn nhánh đi thẳng nhất (tích vô hướng / cosin giữa vector tới và vector đi lớn nhất).
    Giúp duy trì nét vẽ tự nhiên như tay người kéo thẳng qua ngã tư (ví dụ nét gạch chéo của chữ X).
    """
    fresh = [p for p in candidates if _edge_key(cur, p) not in visited_edges and p != prev]
    if not fresh:
        return None
    if len(fresh) == 1:
        return fresh[0]

    vx, vy = cur[0] - prev[0], cur[1] - prev[1]
    vlen = math.hypot(vx, vy)
    if vlen < 1e-6:
        return fresh[0]

    best_cand = None
    best_score = -2.0  # cos range [-1, 1]

    for p in fresh:
        dx, dy = p[0] - cur[0], p[1] - cur[1]
        dlen = math.hypot(dx, dy)
        if dlen < 1e-6:
            continue
        cos_sim = (vx * dx + vy * dy) / (vlen * dlen)
        if cos_sim > best_score:
            best_score = cos_sim
            best_cand = p

    return best_cand or fresh[0]


def extract_smooth_skeleton_strokes(
    skel: np.ndarray,
    min_points: int = 3,
    spacing: float = 2.5,
) -> list[list[tuple[int, int]]]:
    """
    Thuật toán W5: Trích xuất các nét vẽ tự nhiên từ ảnh nhị phân khung xương (1px skeleton).
    - Ưu tiên bắt đầu từ Endpoint (degree = 1).
    - Đi qua giao điểm theo hướng thẳng nhất.
    - Vòng kín: Bắt đầu từ điểm góc trên-trái và duyệt trọn vẹn 1 vòng.
    - Sắp xếp thứ tự stroke hợp lý và trả về danh sách các nét.
    """
    ys, xs = np.nonzero(skel)
    points = [(int(x), int(y)) for x, y in zip(xs, ys)]
    if not points:
        return []

    # Tính bậc (degree) của từng điểm trên đồ thị pixel
    point_set = set(points)
    neighbors_map: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for p in points:
        neighbors_map[p] = _skel_neighbors(skel, p)

    degrees = {p: len(neighbors_map[p]) for p in points}

    # Phân loại điểm xuất phát:
    # 1. Các đầu mút tự nhiên (Endpoints: degree == 1)
    endpoints = [p for p in points if degrees[p] == 1]
    # Sắp xếp endpoints từ trên xuống dưới, trái qua phải
    endpoints.sort(key=lambda p: (p[1] // 16, p[0]))

    # 2. Các điểm ngã ba / ngã tư (Junctions: degree > 2)
    junctions = [p for p in points if degrees[p] > 2]
    junctions.sort(key=lambda p: (p[1] // 16, p[0]))

    # 3. Các điểm còn lại (vòng kín không có endpoint/junction)
    all_points = sorted(points, key=lambda p: (p[1] // 16, p[0]))

    starts = endpoints + junctions + all_points
    visited_edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    raw_strokes: list[list[tuple[int, int]]] = []

    for start in starts:
        # Tìm các cạnh chưa thăm xuất phát từ điểm này
        fresh_nbs = [nb for nb in neighbors_map[start] if _edge_key(start, nb) not in visited_edges]
        for nb in fresh_nbs:
            edge = _edge_key(start, nb)
            if edge in visited_edges:
                continue

            path = [start]
            visited_edges.add(edge)
            prev = start
            cur = nb

            while True:
                path.append(cur)
                # Tìm bước tiếp theo
                next_pt = _choose_straightest_next(
                    prev, cur, neighbors_map[cur], visited_edges
                )
                if next_pt is None:
                    break
                visited_edges.add(_edge_key(cur, next_pt))
                prev, cur = cur, next_pt
                # Nếu đã quay về start (vòng kín khép lại)
                if cur == start:
                    path.append(cur)
                    break

            if len(path) >= min_points:
                raw_strokes.append(path)

    if not raw_strokes:
        return []

    # Hậu xử lý từng stroke: Resample đều + Chaikin làm mịn + Sắp xếp nét
    processed_strokes: list[list[tuple[int, int]]] = []
    for stroke in raw_strokes:
        pts = [(float(x), float(y)) for x, y in stroke]
        if len(pts) < 2:
            continue
        # Tính độ dài nét
        length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        if length < 2.0:
            continue

        # Resample spacing
        resampled = _resample_points(pts, spacing)
        # Chaikin smooth
        smoothed = _chaikin_smooth(resampled, iterations=1)
        resampled_again = _resample_points(smoothed, spacing)
        processed_strokes.append([(int(round(x)), int(round(y))) for x, y in resampled_again])

    # Sắp xếp các strokes theo chuỗi hợp lý (hạn chế nhảy bút quá xa)
    ordered = order_strokes_natural_flow(processed_strokes)
    return ordered


def _resample_points(points: list[tuple[float, float]], spacing: float) -> list[tuple[float, float]]:
    """Lấy mẫu đều dọc theo nét vẽ."""
    if len(points) < 2:
        return list(points)
    cum = [0.0]
    for a, b in zip(points, points[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = cum[-1]
    if total < spacing:
        return [points[0], points[-1]]

    n = max(2, int(round(total / spacing)))
    res: list[tuple[float, float]] = []
    for i in range(n + 1):
        target = total * i / n
        lo, hi = 0, len(cum) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        if lo == 0:
            res.append(points[0])
            continue
        seg_start = cum[lo - 1]
        seg_len = cum[lo] - seg_start
        t = (target - seg_start) / seg_len if seg_len > 0 else 0.0
        ax, ay = points[lo - 1]
        bx, by = points[lo]
        res.append((ax + (bx - ax) * t, ay + (by - ay) * t))
    return res


def _chaikin_smooth(points: list[tuple[float, float]], iterations: int = 1) -> list[tuple[float, float]]:
    """Làm mịn Chaikin giữ nguyên đầu và cuối nét."""
    pts = list(points)
    for _ in range(iterations):
        if len(pts) < 3:
            break
        smoothed = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            smoothed.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            smoothed.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        smoothed.append(pts[-1])
        pts = smoothed
    return pts


def order_strokes_natural_flow(
    strokes: list[list[tuple[int, int]]],
) -> list[list[tuple[int, int]]]:
    """
    Sắp xếp thứ tự các nét rời và định hướng nét (đảo chiều nếu cần):
    - Bắt đầu từ nét trên cùng bên trái.
    - Các nét tiếp theo chọn nét có đầu gần với đuôi của nét hiện tại nhất.
    - Nếu đuôi của nét ứng viên gần hơn đầu của nó, đảo chiều nét ứng viên để nối tiếp mượt mà.
    """
    if not strokes:
        return []

    remaining = [list(s) for s in strokes if len(s) >= 2]
    if not remaining:
        return strokes

    # Chọn stroke đầu tiên: ở trên cùng và bên trái
    remaining.sort(key=lambda s: (min(p[1] for p in s) // 20, min(p[0] for p in s)))
    ordered: list[list[tuple[int, int]]] = [remaining.pop(0)]

    while remaining:
        last_pt = ordered[-1][-1]
        best_idx = 0
        best_dist = float("inf")
        should_reverse = False

        for i, cand in enumerate(remaining):
            d_head = math.hypot(cand[0][0] - last_pt[0], cand[0][1] - last_pt[1])
            d_tail = math.hypot(cand[-1][0] - last_pt[0], cand[-1][1] - last_pt[1])
            if d_head < best_dist:
                best_dist = d_head
                best_idx = i
                should_reverse = False
            if d_tail < best_dist:
                best_dist = d_tail
                best_idx = i
                should_reverse = True

        chosen = remaining.pop(best_idx)
        if should_reverse:
            chosen.reverse()
        ordered.append(chosen)

    return ordered


def build_stroke_plan_with_pen_lifts(
    strokes: list[list[tuple[int, int]]],
) -> tuple[list[tuple[int, int]], set[int]]:
    """
    Tạo stroke plan chung cho reveal và sprite:
    - samples: Danh sách tất cả các điểm tọa độ (x, y) liên tiếp.
    - pen_lifts: Tập hợp chỉ số index mà tại đó người vẽ NHẤC BÚT (chuyển sang nét rời mới).
      Tại index k thuộc pen_lifts:
        + Bút di chuyển từ samples[k-1] đến samples[k] trong trạng thái PEN UP (không vẽ mực).
        + Không được nối đoạn thẳng giữa samples[k-1] và samples[k].
    """
    samples: list[tuple[int, int]] = []
    pen_lifts: set[int] = set()

    for idx, stroke in enumerate(strokes):
        if not stroke:
            continue
        if idx > 0 and len(samples) > 0:
            pen_lifts.add(len(samples))
        samples.extend(stroke)

    return samples, pen_lifts


def calculate_adaptive_budget(
    ink_stroke_length: float,
    color_pixel_count: int,
    total_frames: int,
    ink_weight: float = 1.0,
    color_weight: float = 0.0,
) -> tuple[int, int]:
    """
    Cân bằng thời lượng thích ứng:
    - Nếu không có nét vẽ hoặc không có màu: Phân bổ 100% cho phần còn lại.
    - Nếu cả hai đều có: Cân bằng thời lượng theo tỷ lệ khối lượng công việc thực tế kết hợp trọng số.
    """
    if total_frames <= 0:
        return 0, 0
    if ink_weight <= 0:
        return 0, total_frames
    if color_weight <= 0 or color_pixel_count == 0:
        return total_frames, 0

    # Ước lượng độ phức tạp
    # Nét vẽ tính theo pixel chiều dài; Tô màu tính theo diện tích pixel tương đương
    effective_ink = max(1.0, ink_stroke_length * ink_weight)
    effective_color = max(1.0, math.sqrt(color_pixel_count) * color_weight * 1.5)

    ratio = effective_ink / (effective_ink + effective_color)
    ink_frames = int(round(total_frames * ratio))
    ink_frames = max(1, min(total_frames - 1, ink_frames))
    color_frames = total_frames - ink_frames
    return ink_frames, color_frames

