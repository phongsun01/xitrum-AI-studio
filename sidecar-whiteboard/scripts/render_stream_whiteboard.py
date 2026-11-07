#!/usr/bin/env python3
"""
SRT 白板动画 - 整合渲染器（mask 编排 + stream 画法）

把一张线稿图 + 同名 annotation.json 渲染成白板手绘动画：
  - 编排沿用 whiteboard-mask-animation：按 sequence/startMs 顺序逐区域揭示，
    每个区域的可作画范围 = 矩形 region 扣除「后续区域 + protectedRegions」，
    未开始的区域因掩码限制不会提前露线（mask 的核心不变量）。
  - 画法换成 whiteboard-stream-animation：每个区域在自己的允许掩码内，
    沿骨架/网格笔迹连续落墨（起笔 ink → 添彩 color），笔尖跟随真实笔迹，
    所有区域共享同一张持久画布，已画完的区域保留在画布上。

与 mask 的矩形擦除揭示不同：这里是「笔尖沿线滑行、边走边落墨」的连贯笔迹。
输出末行打印 OUTPUT=<路径>，便于上层捕获。

用法：
  <ENV_PY> render_stream_whiteboard.py <图片> <标注json> <输出mp4> [手部素材png]
  可选参数见 --help（--ink-path / --color-fill / --pause / --total-ms 等）。
  --total-ms 缺省时用标注里的 sceneDurationMs。
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

# 复用 stream 渲染器的全部构件（同目录）
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))
import stream_render as sr  # noqa: E402
import whiteboard_stroke_planner as wsp  # noqa: E402

DEFAULT_HAND = _SCRIPT_DIR.parent / "assets" / "drawing-hand.png"

# Hàm tuỳ chọn callback(done_frames, total_frames) do whiteboard_runner gán để báo tiến độ;
# chạy từ dòng lệnh thì để None và không có gì thay đổi.
PROGRESS_CALLBACK = None


class _CountingWriter:
    """Bọc writer: đếm khung hình đã ghi và gọi PROGRESS_CALLBACK."""

    def __init__(self, writer, total_frames: int):
        self._w = writer
        self._total = max(1, int(total_frames))
        self._done = 0

    def is_opened(self):
        if hasattr(self._w, "is_opened"):
            return self._w.is_opened()
        return self._w.isOpened()

    def isOpened(self):
        return self.is_opened()

    def write(self, frame):
        self._w.write(frame)
        self._done += 1
        cb = PROGRESS_CALLBACK
        if cb is not None:
            cb(min(self._done, self._total), self._total)

    def release(self):
        return self._w.release()


# ──────────────────────────────────────────────────────────────
# 区域几何：把标注画布坐标缩放到输出尺寸
# ──────────────────────────────────────────────────────────────
def _scaled_rect(region: dict, sx: float, sy: float, out_w: int, out_h: int) -> tuple[int, int, int, int]:
    x0 = int(round(region["x"] * sx))
    y0 = int(round(region["y"] * sy))
    x1 = int(round((region["x"] + region["width"]) * sx))
    y1 = int(round((region["y"] + region["height"]) * sy))
    x0 = max(0, min(out_w, x0))
    x1 = max(0, min(out_w, x1))
    y0 = max(0, min(out_h, y0))
    y1 = max(0, min(out_h, y1))
    return x0, y0, x1, y1


def _frame_progress_indices(n_steps: int, target_frames: int) -> list[int]:
    """把 n_steps 个笔尖位置均匀映射到 target_frames 帧。"""
    if n_steps == 0 or target_frames <= 0:
        return []
    if target_frames == 1:
        return [n_steps - 1]
    return [round(f * (n_steps - 1) / (target_frames - 1)) for f in range(target_frames)]


def _planning_view(array: np.ndarray, direction: str):
    """Plan in the requested reading direction, then map contacts back to source XY."""
    h, w = array.shape[:2]
    if direction == "right_to_left":
        return array[:, ::-1], lambda x, y: (w - 1 - x, y)
    if direction == "top_to_bottom":
        return array.swapaxes(0, 1), lambda x, y: (y, x)
    if direction == "bottom_to_top":
        return array.swapaxes(0, 1)[:, ::-1], lambda x, y: (y, h - 1 - x)
    return array, lambda x, y: (x, y)


# ──────────────────────────────────────────────────────────────
# 每区域的 stream 笔迹渲染，写入共享持久画布
# ──────────────────────────────────────────────────────────────
class RegionStreamRenderer:
    """持有整段渲染的共享状态；逐区域把 stream 笔迹画进同一张画布。"""

    def __init__(self, image_bgr: np.ndarray, annotation: dict, cfg: sr.Config,
                 hand_png: Path | None, bare_tip: bool) -> None:
        self.cfg = cfg
        self.ann = annotation
        self.canvas_bgr = sr._hex_to_bgr(cfg.canvas_hex)

        # 输出尺寸：长边限到 cap，对齐到 grid_edge 的偶数倍（编码要求偶数）
        h0, w0 = image_bgr.shape[:2]
        scale = cfg.cap_long_edge / max(h0, w0)
        align = cfg.grid_edge if cfg.grid_edge % 2 == 0 else cfg.grid_edge * 2
        w = max(align, (int(round(w0 * scale)) // align) * align)
        h = max(align, (int(round(h0 * scale)) // align) * align)
        self.out_w, self.out_h = w, h

        # 标注画布坐标 → 输出坐标的缩放比
        cw = annotation["canvas"]["width"]
        ch = annotation["canvas"]["height"]
        self.sx = self.out_w / cw
        self.sy = self.out_h / ch

        self.color_img = cv2.resize(image_bgr, (self.out_w, self.out_h), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(self.color_img, cv2.COLOR_BGR2GRAY)
        self.thresh_map = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 15, 10
        )
        self.grid_blocks = sr._to_grid_blocks(self.thresh_map, cfg.grid_edge)
        self.active_all = sr._active_mask(self.thresh_map, cfg.grid_edge, cfg.ink_threshold)
        self.ink_pixels = self.thresh_map < cfg.ink_threshold
        self.ink_paint = np.repeat(self.thresh_map[:, :, None], 3, axis=2).astype(np.float32)

        # 背景染成画布底色，让上色阶段背景与起笔一致（不碰墨迹）
        if cfg.match_bg:
            self._match_original_background()

        # 共享持久画布
        self.drawn = np.empty((self.out_h, self.out_w, 3), dtype=np.float32)
        self.drawn[...] = self.canvas_bgr.astype(np.float32)

        # 笔尖覆盖 / Hand Rig (R4)
        self.tip = None
        self.hand_rig = None
        if not bare_tip and hand_png and hand_png.exists():
            import whiteboard_hand
            self.hand_rig = whiteboard_hand.HandRig.from_image(
                hand_png,
                target_height=cfg.target_hand_height,
                anchor_x=cfg.tip_anchor_x,
                anchor_y=cfg.tip_anchor_y,
            )

        if not bare_tip and self.hand_rig is None:
            hand_data = sr._load_hand(hand_png, cfg.target_hand_height) if hand_png else None
            ax, ay = cfg.tip_anchor_x, cfg.tip_anchor_y
            if hand_data is None:
                hand_data = sr._procedural_tip(cfg.target_hand_height)
                ax, ay = 0.5, 0.70
            self.tip = sr.TipOverlay(hand_data[0], hand_data[1], tip_anchor_x=ax, tip_anchor_y=ay)

    # 采样原图四角，把接近背景色的像素替换为画布底色
    def _match_original_background(self) -> None:
        img = self.color_img
        h, w = img.shape[:2]
        margin = max(3, min(h, w) // 50)
        samples = [img[:margin, :margin], img[:margin, -margin:],
                   img[-margin:, :margin], img[-margin:, -margin:]]
        bg = np.median(np.concatenate([s.reshape(-1, 3) for s in samples]), axis=0)
        diff = np.abs(img.astype(np.int16) - bg.astype(np.int16)).sum(axis=2)
        img[diff < self.cfg.match_bg_threshold] = self.canvas_bgr

    def _cell_center(self, cell: tuple[int, int]) -> tuple[int, int]:
        r, c = cell
        e = self.cfg.grid_edge
        return (c * e + e // 2, r * e + e // 2)

    def _snapshot_with_tip(self, px: int, py: int, pen_down: bool = True, dx: float = 0.0, dy: float = 0.0) -> np.ndarray:
        snap = self.drawn.astype(np.uint8)
        if self.hand_rig is not None:
            self.hand_rig.stamp(snap, px, py, pen_down=pen_down, dx=dx, dy=dy)
        elif self.tip is not None:
            self.tip.stamp(snap, px, py)
        return snap

    # ── Đơn vùng cho phép: Bbox vùng hiện tại, loại trừ các vùng sau (trừ khi là quan hệ container) ──
    def _allowed_mask(self, element: dict, later_elements: list[dict]) -> np.ndarray:
        mask = np.zeros((self.out_h, self.out_w), dtype=bool)
        x0, y0, x1, y1 = _scaled_rect(element["region"], self.sx, self.sy, self.out_w, self.out_h)
        mask[y0:y1, x0:x1] = True
        for later in later_elements:
            lx0, ly0, lx1, ly1 = _scaled_rect(later["region"], self.sx, self.sy, self.out_w, self.out_h)
            mask[ly0:ly1, lx0:lx1] = False

        for prot in element.get("reveal", {}).get("protectedRegions", []):
            px0, py0, px1, py1 = _scaled_rect(prot, self.sx, self.sy, self.out_w, self.out_h)
            mask[py0:py1, px0:px1] = False
        return mask

    # ── 区域内笔迹路径 ──
    def _region_grid_path(self, allowed: np.ndarray) -> list[tuple[int, int]]:
        """网格模式：把区域内含墨的格聚类并串成连续格路径。"""
        allowed_u8 = allowed.astype(np.uint8)
        allowed_cell = sr._to_grid_blocks(allowed_u8, self.cfg.grid_edge).any(axis=(2, 3))
        active = self.active_all & allowed_cell
        if not active.any():
            return []
        view, source_xy = _planning_view(active, getattr(self, "reveal_direction", "left_to_right"))
        streams = sr.cluster_ink_streams(np.ascontiguousarray(view))
        return [(source_xy(c, r)[1], source_xy(c, r)[0])
                for r, c in sr.flatten_streams(streams)]

    def _region_skeleton_strokes(self, allowed: np.ndarray) -> list[list[tuple[int, int]]]:
        """Cải tiến W5: Trích xuất nét vẽ khung xương tự nhiên (endpoint-first, ngã ba đi thẳng, vòng kín)."""
        cfg = self.cfg
        region_ink = self.ink_pixels & allowed
        if not region_ink.any():
            return []
        view, source_xy = _planning_view(region_ink, getattr(self, "reveal_direction", "left_to_right"))
        skel = sr._zhang_suen_skeleton(np.ascontiguousarray(view), max_iterations=160)
        strokes = wsp.extract_smooth_skeleton_strokes(
            skel,
            min_points=cfg.skeleton_min_points,
            spacing=cfg.skeleton_resample_spacing,
        )
        return [[source_xy(x, y) for x, y in stroke] for stroke in strokes]

    # ── 落墨（限制在 allowed 内）──
    def _reveal_ink_segment(self, a: tuple[int, int], b: tuple[int, int], allowed: np.ndarray) -> None:
        seg = np.zeros((self.out_h, self.out_w), dtype=np.uint8)
        thick = max(1, self.cfg.ink_reveal_radius * 2 + 1)
        cv2.line(seg, a, b, 255, thickness=thick, lineType=cv2.LINE_AA)
        revealed = (seg > 0) & self.ink_pixels & allowed
        self.drawn[revealed] = self.ink_paint[revealed]

    def _ink_stamp_cell(self, cell: tuple[int, int], allowed: np.ndarray) -> None:
        r, c = cell
        e = self.cfg.grid_edge
        block = self.grid_blocks[r, c]
        allow_block = allowed[r * e:r * e + e, c * e:c * e + e]
        ink_region = (block < self.cfg.ink_threshold) & allow_block
        paint = np.repeat(block[:, :, None], 3, axis=2)
        target = self.drawn[r * e:r * e + e, c * e:c * e + e]
        target[ink_region] = paint[ink_region]

    def _color_stamp(self, px: int, py: int, disk: np.ndarray, allowed: np.ndarray) -> None:
        radius = self.cfg.brush_radius
        h, w = self.out_h, self.out_w
        y0, y1 = max(0, py - radius), min(h, py + radius + 1)
        x0, x1 = max(0, px - radius), min(w, px + radius + 1)
        if y1 <= y0 or x1 <= x0:
            return
        by0, by1 = y0 - (py - radius), disk.shape[0] - ((py + radius + 1) - y1)
        bx0, bx1 = x0 - (px - radius), disk.shape[1] - ((px + radius + 1) - x1)
        m = disk[by0:by1, bx0:bx1] * allowed[y0:y1, x0:x1]
        inv = 1.0 - m
        target = self.drawn[y0:y1, x0:x1]
        source = self.color_img[y0:y1, x0:x1].astype(np.float32)
        for ch in range(3):
            target[:, :, ch] = target[:, :, ch] * inv + source[:, :, ch] * m

    # ── 起笔段（骨架模式）：沿笔迹逐段揭原图墨迹，无块填充 ──
    def _lay_ink(self, writer, frames: int, samples: list[tuple[int, int]],
                 pen_lifts: set[int], allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = _frame_progress_indices(n, frames)
        last: int | None = None
        for si in idx_for_frame:
            dx, dy = 0.0, 0.0
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed)
                dx = float(samples[si][0] - samples[last][0])
                dy = float(samples[si][1] - samples[last][1])
            sx, sy = samples[si]
            is_lift = si in pen_lifts
            writer.write(self._snapshot_with_tip(sx, sy, pen_down=not is_lift, dx=dx, dy=dy))
            last = si

    def _lay_contact_plan(self, writer, frames: int, plan, allowed: np.ndarray) -> None:
        """Reveal and hand position consume the same timed draw/travel segments."""
        points = plan.ink_points
        if not points:
            for _ in range(frames):
                writer.write(self.drawn.astype(np.uint8))
            return
        cursor = 0
        previous = None
        last_hand = (points[0].x, points[0].y)
        for frame in range(frames):
            now = frame / float(max(1, frames - 1)) if frames > 1 else 1.0
            while cursor < len(points) and points[cursor].t <= now:
                point = points[cursor]
                b = (round(point.x), round(point.y))
                if point.pen_down:
                    a = (round(previous.x), round(previous.y)) if previous is not None and previous.pen_down else b
                    self._reveal_ink_segment(a, b, allowed)
                previous = point
                cursor += 1
            left = points[max(0, cursor - 1)]
            right = points[min(cursor, len(points) - 1)]
            fraction = (now - left.t) / (right.t - left.t) if right.t > left.t else 0.0
            fraction = max(0.0, min(1.0, fraction))
            x = left.x + (right.x - left.x) * fraction
            y = left.y + (right.y - left.y) * fraction
            down = left.pen_down and right.pen_down
            if down and fraction > 0:
                self._reveal_ink_segment((round(left.x), round(left.y)), (round(x), round(y)), allowed)
            writer.write(self._snapshot_with_tip(round(x), round(y), pen_down=down,
                                                 dx=x-last_hand[0], dy=y-last_hand[1]))
            last_hand = (x, y)

    # ── 添彩段：brush 或 contour-wipe，限制在 allowed 内 ──
    def _wash_brush(self, writer, frames: int, centers: list[tuple[int, int]], allowed: np.ndarray, point_masks=None) -> None:
        if frames <= 0:
            return
        n = len(centers)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        disk = sr._feathered_disk(self.cfg.brush_radius)
        if point_masks is not None:
            disk = (disk > 0).astype(np.float32)
        idx_for_frame = _frame_progress_indices(n, frames)
        last: int | None = None
        for ci in idx_for_frame:
            # A one-frame color budget maps directly to the last contact. Consume
            # all preceding contacts too, while retaining each cluster's mask.
            for k in range(0 if last is None else last + 1, ci + 1):
                self._color_stamp(*centers[k], disk, point_masks[k] if point_masks is not None else allowed)
            cx, cy = centers[ci]
            writer.write(self._snapshot_with_tip(cx, cy))
            last = ci

    def _wash_palette_brush(self, writer, frames: int, allowed: np.ndarray, subject_first: bool = False) -> None:
        """Tô màu theo từng nhóm màu Lab (R3: palette-brush) bám ranh giới mực (hỗ trợ subject-first R4b)."""
        if frames <= 0:
            return
        import whiteboard_palette
        clusters = whiteboard_palette.segment_color_palette_lab(
            self.color_img,
            allowed_mask=allowed,
            ink_mask=self.ink_pixels,
            max_colors=6,
            subject_first=subject_first,
        )
        if not clusters:
            self._wash_contour(writer, frames, allowed)
            return

        # Restore original edge colors in a separate masked brush pass too;
        # skeleton ink is monochrome and is not necessarily the source RGB.
        ink_mask = allowed & self.ink_pixels
        if ink_mask.any():
            clusters.insert(0, whiteboard_palette.ColorCluster(-1, np.zeros(3), np.zeros(3),
                                                               int(ink_mask.sum()), ink_mask))
        total_pts: list[tuple[int, int]] = []
        point_masks = []
        for cluster in clusters:
            view, source_xy = _planning_view(cluster.mask, getattr(self, "reveal_direction", "left_to_right"))
            pts = whiteboard_palette.build_palette_brush_path(
                view,
                brush_radius=self.cfg.brush_radius,
                sample_step=6,
            )
            pts = [source_xy(x, y) for x, y in pts]
            total_pts.extend(pts)
            point_masks.extend([allowed & cluster.mask] * len(pts))

        if not total_pts:
            self._wash_contour(writer, frames, allowed)
            return

        self._wash_brush(writer, frames, total_pts, allowed, point_masks=point_masks)

    def _wash_contour(self, writer, frames: int, allowed: np.ndarray) -> None:
        if frames <= 0:
            return
        cfg = self.cfg
        direction = getattr(self, "reveal_direction", "left_to_right")
        # The wipe algorithm advances along Y; planning advances along X.
        allowed_view, source_xy = _planning_view(allowed, direction)
        allowed_view = allowed_view.swapaxes(0, 1)
        color_view = _planning_view(self.color_img, direction)[0].swapaxes(0, 1)
        drawn_view = _planning_view(self.drawn, direction)[0].swapaxes(0, 1)
        ink_view = _planning_view(self.ink_pixels, direction)[0].swapaxes(0, 1)
        ys_all, xs_all = np.where(allowed_view)
        if ys_all.size == 0:
            return
        top, bottom = int(ys_all.min()), int(ys_all.max())
        left, right = int(xs_all.min()), int(xs_all.max())
        region_h = bottom - top + 1
        region_w = right - left + 1

        # 区域内的阻力场（墨线膨胀 + 模糊 + 逐行向下衰减）
        ink_u8 = ((ink_view & allowed_view)[top:bottom + 1, left:right + 1].astype(np.uint8)) * 255
        spread = int(np.clip(min(region_w, region_h) // 32, 3, 17))
        if spread % 2 == 0:
            spread = max(3, spread - 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (spread, spread))
        dilated = cv2.dilate(ink_u8, kernel, iterations=1)
        blur_r = max(1, int(round(min(region_w, region_h) / 220.0)))
        if blur_r % 2 == 0:
            blur_r += 1
        resistance = cv2.GaussianBlur(dilated, (blur_r, blur_r), 0).astype(np.float32)
        peak = float(resistance.max())
        resistance = resistance / peak if peak > 1e-6 else np.zeros_like(resistance)
        decay = cfg.wipe_decay
        for row in range(1, region_h):
            resistance[row] = np.maximum(resistance[row], resistance[row - 1] * decay)

        wave = sr._build_wipe_wave(region_w)
        delay_px = int(np.clip(region_h * cfg.wipe_delay_ratio, 12, 52))
        ys = np.arange(region_h, dtype=np.float32)[:, None]
        sweep = region_h + 2 * delay_px
        blocks = max(1, cfg.wipe_blocks)

        allowed_crop = allowed_view[top:bottom + 1, left:right + 1]
        color_crop = color_view[top:bottom + 1, left:right + 1].astype(np.float32)
        drawn_crop = drawn_view[top:bottom + 1, left:right + 1]

        for fi in range(frames):
            progress = 1.0 if frames == 1 else fi / (frames - 1)
            lead = sr._ease_in_out_sine(progress) * sweep - delay_px
            threshold = lead + wave[None, :] - resistance * delay_px
            reveal = (ys <= threshold) & allowed_crop
            drawn_crop[reveal] = color_crop[reveal]

            lane = sr._ease_in_out_sine((fi / blocks * 2.0) % 1.0)
            forward = (int(fi // blocks) % 2 == 0)
            cx = int(lane * region_w) if forward else int((1.0 - lane) * region_w)
            cx = max(0, min(region_w - 1, cx))
            col = np.where(reveal[:, cx])[0]
            cy = int(col[-1]) if col.size > 0 else 0
            px, py = source_xy(top + cy, left + cx)
            writer.write(self._snapshot_with_tip(px, py))

        # 收尾：确保区域内允许像素全部揭示
        drawn_crop[allowed_crop] = color_crop[allowed_crop]

    # ── 网格路径的采样计划（插值 + 抬笔 + 块填充索引）──
    def _grid_plan(self, path: list[tuple[int, int]]):
        samples: list[tuple[int, int]] = []
        pen_lifts: set[int] = set()
        sample_cell: list[int] = []
        for idx, cell in enumerate(path):
            cx, cy = self._cell_center(cell)
            if idx == 0:
                samples.append((cx, cy))
                sample_cell.append(idx)
                continue
            prev_cell = path[idx - 1]
            prev = self._cell_center(prev_cell)
            if math.hypot(cell[0] - prev_cell[0], cell[1] - prev_cell[1]) > math.sqrt(2):
                pen_lifts.add(len(samples))
                samples.append((cx, cy))
                sample_cell.append(idx)
                continue
            steps = max(1, int(math.hypot(cx - prev[0], cy - prev[1]) / self.cfg.sample_step))
            for s in range(1, steps + 1):
                samples.append((int(prev[0] + (cx - prev[0]) * s / steps),
                                int(prev[1] + (cy - prev[1]) * s / steps)))
                sample_cell.append(idx)
        return samples, pen_lifts, sample_cell

    # ── 主渲染 ──
    def render_to(self, final_video_path: Path, total_ms: int) -> Path:
        cfg = self.cfg
        elements = sorted(self.ann["elements"], key=lambda e: e["reveal"]["startMs"])

        import whiteboard_render_plan
        ownership_mgr = whiteboard_render_plan.PixelOwnershipManager(self.out_w, self.out_h)
        owned_masks = ownership_mgr.build_ownership_masks(elements, self.sx, self.sy)

        import whiteboard_encoder
        raw_writer = whiteboard_encoder.create_frame_writer(
            final_video_path,
            self.out_w,
            self.out_h,
            fps=cfg.fps,
        )
        if not raw_writer.is_opened():
            raise RuntimeError("Không mở được bộ ghi video trực tiếp")

        # Khung hình dự tính: round(total_ms * cfg.fps / 1000)
        target_total_frames = max(1, int(round(total_ms * cfg.fps / 1000.0)))
        writer = _CountingWriter(raw_writer, target_total_frames)

        weight_sum = cfg.ink_weight + cfg.color_weight
        written_frames = 0

        def write_frame(frame: np.ndarray) -> None:
            nonlocal written_frames
            if written_frames < target_total_frames:
                writer.write(frame)
                written_frames += 1

        def fill_static_frames(target_frames: int) -> None:
            needed = target_frames - written_frames
            if needed <= 0:
                return
            snap = self.drawn.astype(np.uint8)
            for _ in range(needed):
                write_frame(snap)

        try:
            for idx, element in enumerate(elements):
                reveal = element["reveal"]
                self.reveal_direction = reveal.get("direction", "left_to_right")
                start_ms = reveal["startMs"]
                dur_ms = reveal["durationMs"]

                # 1. Giữ khoảng lặng đầu / giữa các vùng (không vẽ nét trước startMs)
                target_start_frame = min(target_total_frames, int(round(start_ms * cfg.fps / 1000.0)))
                fill_static_frames(target_start_frame)

                el_id = element.get("id", f"elem_{idx+1}")
                allowed = owned_masks.get(el_id, self._allowed_mask(element, elements[idx + 1:]))
                target_end_frame = min(target_total_frames, int(round((start_ms + dur_ms) * cfg.fps / 1000.0)))
                region_total_frames = max(1, target_end_frame - target_start_frame)

                # Cải tiến W5: Trích xuất strokes nét vẽ trước để tính độ dài thực tế
                strokes = None
                samples: list[tuple[int, int]] = []
                pen_lifts: set[int] = set()
                centers: list[tuple[int, int]] = []
                path = None
                sample_cell = []

                if cfg.ink_path_mode == "skeleton":
                    strokes = self._region_skeleton_strokes(allowed)
                    if strokes:
                        samples, pen_lifts = wsp.build_stroke_plan_with_pen_lifts(strokes)
                        centers = samples
                    else:
                        path = self._region_grid_path(allowed)
                        samples, pen_lifts, _ = self._grid_plan(path) if path else ([], set(), [])
                        centers = [self._cell_center(c) for c in path]
                else:
                    path = self._region_grid_path(allowed)
                    if path:
                        samples, pen_lifts, sample_cell = self._grid_plan(path)
                        centers = [self._cell_center(c) for c in path]

                # Tính độ dài nét vẽ thực và diện tích màu cần tô
                ink_len = float(len(samples))
                color_pixels = int(np.count_nonzero(allowed & ~self.ink_pixels))

                # Phân bổ khung hình thích ứng (W5)
                ink_frames, color_frames = wsp.calculate_adaptive_budget(
                    ink_stroke_length=ink_len,
                    color_pixel_count=color_pixels,
                    total_frames=region_total_frames,
                    ink_weight=cfg.ink_weight,
                    color_weight=cfg.color_weight,
                )

                class _FrameWriterWrapper:
                    def __init__(self, write_fn):
                        self._fn = write_fn
                    def write(self, f):
                        self._fn(f)

                f_writer = _FrameWriterWrapper(write_frame)

                if cfg.ink_path_mode == "skeleton":
                    contact_plan = whiteboard_render_plan.build_element_timeline_plan(
                        strokes or [], allowed, el_id, idx + 1, start_ms, dur_ms)
                    if contact_plan.ink_points:
                        self._lay_contact_plan(f_writer, ink_frames, contact_plan, allowed)
                    else:
                        self._lay_ink(f_writer, ink_frames, samples, pen_lifts, allowed)
                else:
                    if path:
                        # 块填充：随笔尖推进逐格铺满（保证文字/大块实心）
                        self._lay_ink_grid(f_writer, ink_frames, samples, pen_lifts, sample_cell, path, allowed)
                    else:
                        self._lay_ink(f_writer, ink_frames, [], set(), allowed)

                if color_frames > 0:
                    if cfg.color_fill == "contour-wipe":
                        self._wash_contour(f_writer, color_frames, allowed)
                    elif cfg.color_fill == "palette-brush":
                        self._wash_palette_brush(f_writer, color_frames, allowed, subject_first=getattr(cfg, "subject_first", False))
                    else:
                        self._wash_brush(f_writer, color_frames, centers, allowed)

            # Lấp đầy các khung hình còn lại cho đến đúng target_total_frames
            # Không tự ý đè self.drawn[...] = self.color_img để che pixel chưa vẽ.
            fill_static_frames(target_total_frames)
        except BaseException:
            raw_writer.terminate()
            raise
        else:
            writer.release()
        return final_video_path

    # 网格起笔专用：带块填充，笔尖与揭墨同步
    def _lay_ink_grid(self, writer, frames: int, samples, pen_lifts, sample_cell, path, allowed) -> None:
        if frames <= 0:
            return
        n = len(samples)
        if n == 0:
            for _ in range(frames):
                writer.write(self._snapshot_with_tip(self.out_w // 2, self.out_h // 2))
            return
        idx_for_frame = _frame_progress_indices(n, frames)
        cells_done = 0
        last: int | None = None
        for si in idx_for_frame:
            if last is None:
                self._reveal_ink_segment(samples[si], samples[si], allowed)
            else:
                for k in range(last + 1, si + 1):
                    if k in pen_lifts:
                        continue
                    self._reveal_ink_segment(samples[k - 1], samples[k], allowed)
            target_cell = sample_cell[si]
            while cells_done <= target_cell and cells_done < len(path):
                self._ink_stamp_cell(path[cells_done], allowed)
                cells_done += 1
            sx, sy = samples[si]
            writer.write(self._snapshot_with_tip(sx, sy))
            last = si
        while cells_done < len(path):
            self._ink_stamp_cell(path[cells_done], allowed)
            cells_done += 1


def _paper_color(value: str) -> str:
    """Kiểm tra màu #RRGGBB (có hoặc không có dấu #) và chuẩn hóa về dạng '#RRGGBB'."""
    v = value.strip()
    if len(v) == 6:
        v = "#" + v
    if len(v) != 7 or v[0] != "#" or any(c not in "0123456789abcdefABCDEF" for c in v[1:]):
        raise argparse.ArgumentTypeError(f"màu không hợp lệ: {value!r} (cần dạng #RRGGBB)")
    return v.upper()


def _parse_args(argv=None):
    p = argparse.ArgumentParser(description="Bộ render tích hợp hoạt hình bảng trắng SRT (dàn dựng bằng mặt nạ + vẽ kiểu stream)")
    p.add_argument("image", help="Đường dẫn ảnh line art")
    p.add_argument("annotation", help="Đường dẫn annotation.json cùng tên")
    p.add_argument("output", help="Đường dẫn MP4 đầu ra")
    p.add_argument("hand", nargs="?", default=str(DEFAULT_HAND), help="PNG bàn tay (mặc định có sẵn)")
    p.add_argument("--total-ms", type=int, default=None, help="Tổng thời lượng; nếu bỏ trống dùng sceneDurationMs trong annotation")
    p.add_argument("--bare-tip", action="store_true", help="Không chồng đầu bút/bàn tay")
    p.add_argument("--ink-path", default="grid", choices=["grid", "skeleton"],
                   help="Đường đi nét bút: grid lưới (mặc định); skeleton bám khung xương")
    p.add_argument("--color-fill", default="contour-wipe", choices=["contour-wipe", "brush", "palette-brush", "none"],
                   help="Tô màu: contour-wipe quét theo viền; brush quét cọ; palette-brush tô theo nhóm màu Lab; none bỏ qua tô màu")
    p.add_argument("--ink-weight", type=float, default=None, help="Trọng số phân bổ thời gian vẽ nét")
    p.add_argument("--color-weight", type=float, default=None, help="Trọng số phân bổ thời gian tô màu")
    p.add_argument("--pause", default="heavy", choices=["heavy", "auto", "light", "off"],
                   help="Nhịp dừng ở đoạn khởi bút (dự phòng, ảnh hưởng yếu khi vẽ theo từng vùng)")
    p.add_argument("--fps", type=int, default=None)
    p.add_argument("--paper-color", type=_paper_color, default=None,
                   help="Màu nền giấy dạng #RRGGBB (mặc định #F6F1E3)")
    p.add_argument("--grid-edge", type=int, default=None)
    p.add_argument("--brush-radius", type=int, default=None)
    p.add_argument("--cap-long-edge", type=int, default=None,
                   help="Giới hạn pixel cạnh dài của đầu ra (xem trước có thể giảm để chạy nhanh, mặc định 1080)")
    p.add_argument("--subject-first", action="store_true",
                   help="Ưu tiên tô chi tiết chủ thể trước nền khi tô màu (R4b)")
    return p.parse_args(argv)


def _build_cfg(args) -> sr.Config:
    kw: dict = {}
    if args.fps is not None:
        kw["fps"] = args.fps
    if args.paper_color is not None:
        kw["canvas_hex"] = args.paper_color
    if args.grid_edge is not None:
        kw["grid_edge"] = args.grid_edge
    if args.brush_radius is not None:
        kw["brush_radius"] = args.brush_radius
    if args.cap_long_edge is not None:
        kw["cap_long_edge"] = args.cap_long_edge
    if args.ink_weight is not None:
        kw["ink_weight"] = args.ink_weight
    if args.color_weight is not None:
        kw["color_weight"] = args.color_weight
    if args.color_fill == "none":
        kw["color_weight"] = 0.0
        kw["ink_weight"] = 1.0
    kw["ink_path_mode"] = args.ink_path
    kw["color_fill"] = args.color_fill
    kw["pause_mode"] = args.pause
    kw["subject_first"] = bool(getattr(args, "subject_first", False))
    return sr.Config(**kw)


def main(argv=None) -> int:
    args = _parse_args(argv)
    cfg = _build_cfg(args)

    print("=" * 56)
    print("Bộ render tích hợp hoạt hình bảng trắng SRT (mặt nạ + stream)")
    print("=" * 56)

    import whiteboard_image
    try:
        image_bgr, _ = whiteboard_image.load_normalized_image(
            args.image,
            paper_color_hex=cfg.canvas_hex,
            min_dimension=16
        )
    except Exception as e:
        print(f"[err] Lỗi đọc hoặc chuẩn hóa ảnh ({args.image}): {e}")
        return 1
    try:
        raw_annotation = json.loads(Path(args.annotation).read_text(encoding="utf-8"))
        import whiteboard_schema
        annotation, schema_warnings = whiteboard_schema.adapt_and_validate_annotation(raw_annotation)
        for w in schema_warnings:
            print(f"[warn] {w}")
    except Exception as e:
        print(f"[err] Không đọc hoặc kiểm thực được annotation: {e}")
        return 1

    total_ms = args.total_ms if args.total_ms is not None else annotation.get("sceneDurationMs")
    if not total_ms:
        last = max(e["reveal"]["startMs"] + e["reveal"]["durationMs"] for e in annotation["elements"]) if annotation.get("elements") else 10000
        total_ms = last + 1000

    # Kiểm tra xem các vùng reveal trong annotation có vượt quá total_ms không
    elements = annotation.get("elements", [])
    if elements:
        max_elem_end = max(e["reveal"]["startMs"] + e["reveal"]["durationMs"] for e in elements)
        if max_elem_end > total_ms:
            # Tỷ lệ co giãn thời lượng để vừa khớp cửa sổ vẽ
            scale_ratio = total_ms / float(max_elem_end)
            print(f"[warn] Cửa sổ annotation ({max_elem_end}ms) vượt thời lượng cảnh ({total_ms}ms). Tự động co giãn theo tỷ lệ {scale_ratio:.3f}")
            for e in elements:
                e["reveal"]["startMs"] = int(round(e["reveal"]["startMs"] * scale_ratio))
                e["reveal"]["durationMs"] = max(100, int(round(e["reveal"]["durationMs"] * scale_ratio)))

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    hand_png = Path(args.hand) if args.hand else None
    renderer = RegionStreamRenderer(image_bgr, annotation, cfg, hand_png, args.bare_tip)
    print(f"  Đầu vào: {args.image}")
    print(f"  Kích thước đầu ra: {renderer.out_w}x{renderer.out_h}, tốc độ khung hình: {cfg.fps}")
    print(f"  Số vùng: {len(annotation['elements'])}, tổng thời lượng: {total_ms}ms, "
          f"nét bút: {cfg.ink_path_mode}, tô màu: {cfg.color_fill}")

    # R5: Pipe trực tiếp sang FFmpeg H.264 (hoặc OpenCV fallback an toàn), không lưu mp4v trung gian
    final = renderer.render_to(out_path, total_ms)

    size_mb = final.stat().st_size / (1024 * 1024) if final.exists() else 0.0
    print(f"\nVideo cuối: {final}  ({size_mb:.2f} MB)")
    print("=" * 56)
    print(f"OUTPUT={final}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
