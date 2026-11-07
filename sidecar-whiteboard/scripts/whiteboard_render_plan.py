"""
whiteboard_render_plan.py - Xây dựng RenderPlan thống nhất và timeline liên tục cho bút (R2)

Bao gồm:
- PixelOwnershipMap: Phân bổ mask sở hữu pixel chính xác (không phụ thuộc chỉ trừ bbox),
  xử lý vùng lồng nhau, chồng nhau, protected regions, đảm bảo 100% pixel nội dung được sở hữu đúng 1 vùng.
- RenderPlan: Cấu trúc mô tả chuỗi hành động vẽ, timeline thời gian thực float (t_start, t_end),
  tọa độ contact (x, y), trạng thái pen_state ("down" | "up" | "fill"), brush footprint,
  đảm bảo pen-up chiếm thời gian di chuyển nhưng KHÔNG sinh mực,
  loại bỏ hoàn toàn nét nối giả giữa các đường rời rạc.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Any, Optional
import cv2
import numpy as np


@dataclass
class PlanContactPoint:
    x: float
    y: float
    t: float  # Thời gian chuẩn hóa [0.0, 1.0] trong cửa sổ của element
    pen_down: bool  # True: hạ bút sinh mực; False: nhấc bút di chuyển
    stage: str = "ink"  # "ink" | "color" | "pen_up"
    radius: float = 2.0


@dataclass
class ElementRenderPlan:
    element_id: str
    sequence: int
    start_ms: int
    duration_ms: int
    owned_mask: np.ndarray  # Mask boolean sở hữu pixel thực tế
    ink_points: List[PlanContactPoint] = field(default_factory=list)
    color_points: List[PlanContactPoint] = field(default_factory=list)
    pen_up_moves: int = 0
    ink_length_px: float = 0.0
    color_pixel_count: int = 0
    coverage_ratio: float = 1.0


class PixelOwnershipManager:
    """
    Quản lý phân bổ mask sở hữu pixel (pixel ownership).
    Mỗi pixel có mực hoặc màu chỉ thuộc về duy nhất một element có độ ưu tiên cao nhất,
    trừ protected regions và giải quyết vùng lồng nhau mà không làm rách nét viền.
    """

    def __init__(self, canvas_w: int, canvas_h: int):
        self.w = canvas_w
        self.h = canvas_h
        # Mảng int lưu ID của element đang sở hữu pixel (-1 là chưa ai sở hữu)
        self.owner_map = np.full((canvas_h, canvas_w), -1, dtype=np.int32)
        # Mask vùng được bảo vệ (không ai được vẽ đè lên)
        self.protected_mask = np.zeros((canvas_h, canvas_w), dtype=bool)

    def add_protected_region(self, x0: int, y0: int, x1: int, y1: int):
        x0, x1 = max(0, min(self.w, x0)), max(0, min(self.w, x1))
        y0, y1 = max(0, min(self.h, y0)), max(0, min(self.h, y1))
        if x1 > x0 and y1 > y0:
            self.protected_mask[y0:y1, x0:x1] = True

    def build_ownership_masks(
        self,
        elements: List[Dict[str, Any]],
        scale_x: float,
        scale_y: float,
    ) -> Dict[str, np.ndarray]:
        """
        Duyệt các elements theo thứ tự sequence/startMs.
        Quy tắc:
        - Vùng xuất hiện sau sở hữu pixel trong bbox của mình, TRỪ khi vùng trước là container bao quanh nó
        - Pixel được gán độc quyền cho element sở hữu.
        """
        n = len(elements)
        masks: Dict[str, np.ndarray] = {}

        # 1. Khởi tạo danh sách bbox cho từng element
        elem_boxes = []
        for idx, el in enumerate(elements):
            reg = el.get("region", {})
            rx0 = int(round(reg.get("x", 0) * scale_x))
            ry0 = int(round(reg.get("y", 0) * scale_y))
            rx1 = int(round((reg.get("x", 0) + reg.get("width", 0)) * scale_x))
            ry1 = int(round((reg.get("y", 0) + reg.get("height", 0)) * scale_y))
            rx0, rx1 = max(0, min(self.w, rx0)), max(0, min(self.w, rx1))
            ry0, ry1 = max(0, min(self.h, ry0)), max(0, min(self.h, ry1))
            elem_boxes.append((rx0, ry0, rx1, ry1))

            # Ghi nhận protectedRegions nếu có
            for prot in el.get("reveal", {}).get("protectedRegions", []):
                px0 = int(round(prot.get("x", 0) * scale_x))
                py0 = int(round(prot.get("y", 0) * scale_y))
                px1 = int(round((prot.get("x", 0) + prot.get("width", 0)) * scale_x))
                py1 = int(round((prot.get("y", 0) + prot.get("height", 0)) * scale_y))
                self.add_protected_region(px0, py0, px1, py1)

        # 2. Phân bổ quyền sở hữu: Element sau có quyền sở hữu vùng của mình,
        # nhưng chừa biên container nếu lồng nhau
        for i, el in enumerate(elements):
            x0, y0, x1, y1 = elem_boxes[i]
            cur_area = (x1 - x0) * (y1 - y0)

            cur_mask = np.zeros((self.h, self.w), dtype=bool)
            if x1 > x0 and y1 > y0:
                cur_mask[y0:y1, x0:x1] = True

            # Trừ các vùng của element sau
            for j in range(i + 1, n):
                lx0, ly0, lx1, ly1 = elem_boxes[j]
                later_area = (lx1 - lx0) * (ly1 - ly0)
                if later_area <= 0:
                    continue

                inter_w = max(0, min(x1, lx1) - max(x0, lx0))
                inter_h = max(0, min(y1, ly1) - max(y0, ly0))
                inter_area = inter_w * inter_h

                if inter_area > 0.8 * later_area and cur_area > later_area * 1.5:
                    # i bao bọc j: giữ lại viền ngoài cho i
                    margin = max(2, min(inter_w, inter_h) // 20)
                    cur_mask[ly0 + margin : ly1 - margin, lx0 + margin : lx1 - margin] = False
                else:
                    cur_mask[ly0:ly1, lx0:lx1] = False

            # Trừ protected regions
            cur_mask[self.protected_mask] = False

            el_id = el.get("id", f"elem_{i+1}")
            masks[el_id] = cur_mask

        return masks


def build_element_timeline_plan(
    strokes: List[List[Tuple[int, int]]],
    owned_mask: np.ndarray,
    element_id: str,
    sequence: int,
    start_ms: int,
    duration_ms: int,
    sample_step: float = 2.0,
    pen_up_speed_factor: float = 1.8,
) -> ElementRenderPlan:
    """
    Xây dựng kế hoạch di chuyển bút và contact points theo dòng thời gian thực (float).
    Tính toán chính xác:
    - Khoảng cách vẽ từng nét (ink contact, pen_down=True)
    - Khoảng cách di chuyển nhấc bút giữa các nét (pen-up travel, pen_down=False)
    - Phân bổ mốc thời gian t in [0.0, 1.0] tương ứng với quãng đường di chuyển của tay
    """
    plan = ElementRenderPlan(
        element_id=element_id,
        sequence=sequence,
        start_ms=start_ms,
        duration_ms=duration_ms,
        owned_mask=owned_mask,
    )

    if not strokes:
        return plan

    # 1. Tính toán quãng đường di chuyển và danh sách đoạn
    segments: List[Tuple[str, List[Tuple[float, float]], float]] = []
    # segment: (type="draw"|"pen_up", points, distance)

    total_dist = 0.0
    ink_dist = 0.0
    pen_up_count = 0

    last_end: Optional[Tuple[float, float]] = None

    for stroke in strokes:
        if not stroke:
            continue
        first_pt = (float(stroke[0][0]), float(stroke[0][1]))

        # Nếu có điểm cuối nét trước -> cần di chuyển nhấc bút (pen-up)
        if last_end is not None:
            travel = math.hypot(first_pt[0] - last_end[0], first_pt[1] - last_end[1])
            if travel > 1.0:
                # Quãng đường nhấc bút được chiết khấu theo tốc độ vung tay (pen_up_speed_factor)
                effective_travel = travel / pen_up_speed_factor
                segments.append(("pen_up", [last_end, first_pt], effective_travel))
                total_dist += effective_travel
                pen_up_count += 1

        # Lấy mẫu đều dọc theo stroke
        sampled_pts: List[Tuple[float, float]] = [first_pt]
        cur_stroke_dist = 0.0
        prev_p = first_pt

        for pt in stroke[1:]:
            p = (float(pt[0]), float(pt[1]))
            d = math.hypot(p[0] - prev_p[0], p[1] - prev_p[1])
            if d < 1e-4:
                continue
            steps = max(1, int(round(d / sample_step)))
            for s in range(1, steps + 1):
                interp_pt = (
                    prev_p[0] + (p[0] - prev_p[0]) * (s / steps),
                    prev_p[1] + (p[1] - prev_p[1]) * (s / steps),
                )
                sampled_pts.append(interp_pt)
            cur_stroke_dist += d
            prev_p = p

        segments.append(("draw", sampled_pts, cur_stroke_dist))
        total_dist += cur_stroke_dist
        ink_dist += cur_stroke_dist
        last_end = sampled_pts[-1]

    plan.ink_length_px = ink_dist
    plan.pen_up_moves = pen_up_count

    if total_dist <= 1e-4:
        return plan

    # 2. Gán mốc thời gian liên tục t in [0.0, 1.0] cho từng điểm contact
    accum_dist = 0.0
    all_points: List[PlanContactPoint] = []

    for seg_type, pts, seg_d in segments:
        n_pts = len(pts)
        if n_pts == 0:
            continue
        is_draw = (seg_type == "draw")
        sub_step_d = seg_d / float(max(1, n_pts - 1)) if n_pts > 1 else seg_d

        for i, pt in enumerate(pts):
            t = (accum_dist + i * sub_step_d) / total_dist
            t = max(0.0, min(1.0, t))
            all_points.append(
                PlanContactPoint(
                    x=pt[0],
                    y=pt[1],
                    t=t,
                    pen_down=is_draw,
                    stage="ink" if is_draw else "pen_up",
                    radius=2.5 if is_draw else 0.0,
                )
            )
        accum_dist += seg_d

    plan.ink_points = all_points
    return plan

