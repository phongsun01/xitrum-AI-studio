"""
whiteboard_palette.py - Tô màu theo nhóm màu Lab và ranh giới nét vẽ (R3)

Bao gồm:
- Phân cụm màu trong không gian CIELAB (DeltaE perceptual distance), bảo toàn độ chuyển màu (shading).
- Tách các vùng liên thông (connected components) được ngăn cách bởi ranh giới mực đen (ink borders).
- Lập kế hoạch tô từng nhóm màu (palette-brush):
    + Hoàn thành một nhóm màu trong vùng rồi mới đổi sang nhóm màu kế tiếp (giảm thiểu thay cọ).
    + Quỹ đạo cọ quét tự nhiên theo đường zic-zac hoặc xoắn ốc bên trong ranh giới mực.
    + Không tô xuyên qua nét mực hoặc sang vùng khác.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple, Dict, Any, Optional
import cv2
import numpy as np


@dataclass
class ColorCluster:
    cluster_id: int
    mean_lab: np.ndarray
    mean_bgr: np.ndarray
    pixel_count: int
    mask: np.ndarray  # Boolean mask các pixel thuộc cluster này


def segment_color_palette_lab(
    bgr_img: np.ndarray,
    allowed_mask: np.ndarray,
    ink_mask: np.ndarray,
    max_colors: int = 8,
    delta_e_threshold: float = 14.0,
) -> List[ColorCluster]:
    """
    Phân tích và gom cụm màu sắc trong không gian Lab cho các pixel được phép tô:
    Pixel cần tô = allowed_mask & (~ink_mask)
    """
    h, w = bgr_img.shape[:2]
    paint_mask = allowed_mask & (~ink_mask)
    if not np.any(paint_mask):
        return []

    # Chuyển ảnh sang không gian màu CIELAB để tính khoảng cách thị giác (Perceptual DeltaE)
    lab_img = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2LAB)
    target_pixels_lab = lab_img[paint_mask].astype(np.float32)
    target_pixels_bgr = bgr_img[paint_mask]

    n_pixels = len(target_pixels_lab)
    if n_pixels < 10:
        return []

    # Dùng K-Means đơn giản để gom nhóm tối đa max_colors
    k = min(max_colors, max(1, n_pixels // 200))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 15, 0.5)
    flags = cv2.KMEANS_PP_CENTERS

    try:
        compactness, labels, centers = cv2.kmeans(
            target_pixels_lab, k, None, criteria, 3, flags
        )
    except Exception:
        # Nếu k-means thất bại thì coi như 1 cluster
        labels = np.zeros((n_pixels, 1), dtype=np.int32)
        centers = [np.mean(target_pixels_lab, axis=0)]
        k = 1

    labels = labels.flatten()
    clusters: List[ColorCluster] = []

    # Tạo map mask cho từng cluster
    label_map = np.full((h, w), -1, dtype=np.int16)
    label_map[paint_mask] = labels

    for c_id in range(k):
        c_mask = (label_map == c_id)
        count = int(np.count_nonzero(c_mask))
        if count < 5:
            continue

        mean_lab = centers[c_id]
        mean_bgr = np.mean(bgr_img[c_mask], axis=0)

        clusters.append(
            ColorCluster(
                cluster_id=c_id,
                mean_lab=mean_lab,
                mean_bgr=mean_bgr,
                pixel_count=count,
                mask=c_mask,
            )
        )

    # Sắp xếp các cụm màu: cụm diện tích lớn hơn hoặc màu tối/nền trước, chi tiết sau
    clusters.sort(key=lambda c: -c.pixel_count)
    return clusters


def build_palette_brush_path(
    cluster_mask: np.ndarray,
    brush_radius: int = 15,
    sample_step: int = 6,
) -> List[Tuple[int, int]]:
    """
    Sinh đường di chuyển đầu cọ tô kín cụm màu (quét zic-zac có bước nhảy).
    Bảo đảm đầu cọ chỉ quét trong phạm vi cluster_mask.
    """
    ys, xs = np.nonzero(cluster_mask)
    if len(ys) == 0:
        return []

    y_min, y_max = int(np.min(ys)), int(np.max(ys))
    path: List[Tuple[int, int]] = []

    # Quét từng hàng theo bước step = brush_radius * 0.8
    step_y = max(3, int(brush_radius * 0.9))
    forward = True

    for y in range(y_min, y_max + 1, step_y):
        row_xs = xs[ys == y]
        if len(row_xs) == 0:
            # Tìm trong lân cận +/- step_y // 2
            near = (ys >= y - step_y // 2) & (ys <= y + step_y // 2)
            row_xs = xs[near]
            if len(row_xs) == 0:
                continue

        x_start, x_end = int(np.min(row_xs)), int(np.max(row_xs))
        if x_end < x_start:
            continue

        step_x = max(2, sample_step)
        if forward:
            pts = [(x, y) for x in range(x_start, x_end + 1, step_x) if cluster_mask[y, x]]
        else:
            pts = [(x, y) for x in range(x_end, x_start - 1, -step_x) if cluster_mask[y, x]]

        if pts:
            path.extend(pts)
            forward = not forward

    return path
