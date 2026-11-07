#!/usr/bin/env python3
"""
whiteboard_segmenter.py - Tách vùng và sắp xếp thứ tự vẽ thông minh (W4)

Cải tiến tách vùng:
1. Phân biệt thành phần: Chữ viết (text/labels), hình bao (outer containers), hình vẽ chi tiết (inner details)
2. Sắp xếp thứ tự vẽ tự nhiên (component_ordering):
   - Hình khung/bao ngoài vẽ trước nội dung bên trong
   - Hình vẽ minh họa trước các nhãn chữ chú thích
   - Chữ viết theo dòng từ trên xuống dưới, trái sang phải
   - Giữ lại các dấu chấm, dấu câu tiếng Việt không bị tách rời hay bỏ sót
3. Tránh trừ đè mất nét: Mỗi pixel mực có chủ sở hữu rõ ràng
"""

from __future__ import annotations
import math
import cv2
import numpy as np
from typing import List, Dict, Any, Tuple


def _box_area(b: List[int]) -> int:
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _box_intersection(a: List[int], b: List[int]) -> int:
    iw = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    ih = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return iw * ih


def _is_contained(inner: List[int], outer: List[int], threshold: float = 0.85) -> bool:
    """Kiểm tra xem inner có nằm trọn bên trong outer hay không."""
    inter = _box_intersection(inner, outer)
    area_inner = _box_area(inner)
    if area_inner == 0:
        return False
    return (inter / float(area_inner)) >= threshold


def segment_and_order_regions(
    img_bgr: np.ndarray,
    max_regions: int = 12,
    cues_count: int = 0
) -> List[Dict[str, Any]]:
    """
    Tách các vùng mực thông minh kèm phân loại (container, detail, text).
    Trả về danh sách các vùng đã sắp xếp thứ tự vẽ tối ưu.
    """
    h, w = img_bgr.shape[:2]
    total_area = h * w

    # 1. Phát hiện nền & trích xuất nét mực chính xác
    p = max(4, min(h, w) // 50)
    corners = np.concatenate([
        img_bgr[:p, :p, :3].reshape(-1, 3),
        img_bgr[:p, -p:, :3].reshape(-1, 3),
        img_bgr[-p:, :p, :3].reshape(-1, 3),
        img_bgr[-p:, -p:, :3].reshape(-1, 3),
    ])
    bg = np.median(corners, axis=0).astype(np.int16)
    diff = np.abs(img_bgr[:, :, :3].astype(np.int16) - bg).sum(axis=2)
    ink_mask = (diff > 45).astype(np.uint8)

    # 2. Dùng phép nối hình thái học để gộp chữ có dấu tiếng Việt & nét đứt
    # Kích thước kernel dọc đủ để gộp dấu mũ, dấu sắc, hỏi, ngã, nặng cách chữ 5-15px
    k_w = max(5, int(round(w * 0.02)))
    k_h = max(11, int(round(h * 0.05)))
    if k_w % 2 == 0: k_w += 1
    if k_h % 2 == 0: k_h += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k_w, k_h))
    blobs = cv2.dilate(ink_mask, kernel)

    n, labels, stats, centroids = cv2.connectedComponentsWithStats(blobs, connectivity=8)
    min_ink = max(15, int(0.0003 * total_area))

    raw_regions: List[Dict[str, Any]] = []
    for i in range(1, n):
        x, y, bw, bh, area = (int(stats[i, c]) for c in range(5))
        region_ink = np.sum(ink_mask[y:y+bh, x:x+bw] > 0)
        if region_ink < min_ink:
            continue

        aspect_ratio = bw / float(max(1, bh))
        fill_ratio = region_ink / float(max(1, bw * bh))
        is_text_like = (aspect_ratio > 1.8 and bh < h * 0.15) or (bh < h * 0.08 and aspect_ratio > 0.8)

        raw_regions.append({
            "box": [x, y, x + bw, y + bh],
            "area": bw * bh,
            "ink_count": int(region_ink),
            "is_text": bool(is_text_like),
            "centroid": (float(centroids[i][0]), float(centroids[i][1])),
        })

    if not raw_regions:
        return [{
            "box": [0, 0, w, h],
            "role": "main",
            "is_text": False,
        }]

    # 3. Phân biệt hình bao (container) vs nội dung con (contained child)
    for r in raw_regions:
        r["is_container"] = False
        r["parent_idx"] = None

    for i, r_outer in enumerate(raw_regions):
        for j, r_inner in enumerate(raw_regions):
            if i != j and r_outer["area"] > r_inner["area"] * 1.8:
                if _is_contained(r_inner["box"], r_outer["box"]):
                    r_outer["is_container"] = True
                    r_inner["parent_idx"] = i

    # 4. Gộp các vùng quá nhỏ nếu vượt quá max_regions
    target_k = max(1, min(cues_count, max_regions) if cues_count > 0 else max_regions)

    def merge_two_regions(r1, r2):
        b1, b2 = r1["box"], r2["box"]
        nb = [min(b1[0], b2[0]), min(b1[1], b2[1]), max(b1[2], b2[2]), max(b1[3], b2[3])]
        return {
            "box": nb,
            "area": _box_area(nb),
            "ink_count": r1["ink_count"] + r2["ink_count"],
            "is_text": r1["is_text"] and r2["is_text"],
            "is_container": r1["is_container"] or r2["is_container"],
            "centroid": ((r1["centroid"][0] + r2["centroid"][0]) / 2, (r1["centroid"][1] + r2["centroid"][1]) / 2),
            "parent_idx": None,
        }

    while len(raw_regions) > target_k:
        # Tìm cặp gần nhau nhất không phá vỡ quan hệ container
        best_pair = None
        best_dist = float("inf")
        for i in range(len(raw_regions)):
            for j in range(i + 1, len(raw_regions)):
                a, b = raw_regions[i], raw_regions[j]
                # Ưu tiên gộp hai vùng cùng là text hoặc hai vùng nhỏ
                c_dist = math.hypot(a["centroid"][0] - b["centroid"][0], a["centroid"][1] - b["centroid"][1])
                score = c_dist
                if a["is_text"] != b["is_text"]:
                    score *= 1.8  # phạt gộp hình vẽ với chữ
                if a["is_container"] or b["is_container"]:
                    score *= 2.5  # không tùy tiện gộp khung bao ngoài
                if score < best_dist:
                    best_dist = score
                    best_pair = (i, j)

        if not best_pair:
            break
        i, j = best_pair
        merged = merge_two_regions(raw_regions[i], raw_regions[j])
        raw_regions = [r for idx, r in enumerate(raw_regions) if idx not in (i, j)]
        raw_regions.append(merged)

    # 5. Component Ordering (Thứ tự vẽ tự nhiên và thẩm mỹ):
    # Quy tắc:
    #   (1) Khung bao ngoài (Container) vẽ đầu tiên
    #   (2) Hình vẽ chính vẽ trước
    #   (3) Nhãn chữ / chú thích vẽ sau theo thứ tự đọc (từ trên xuống, từ trái sang phải)
    containers = [r for r in raw_regions if r.get("is_container")]
    figures = [r for r in raw_regions if not r.get("is_container") and not r.get("is_text")]
    texts = [r for r in raw_regions if not r.get("is_container") and r.get("is_text")]

    # Sắp xếp figures từ diện tích lớn đến nhỏ hoặc từ trái qua phải
    figures.sort(key=lambda r: (r["centroid"][1] // (h * 0.25), r["centroid"][0]))

    # Sắp xếp texts theo hàng đọc (reading order)
    def reading_sort_key(r):
        row = int(r["centroid"][1] / (h * 0.12))  # gom theo dải chiều cao dòng
        return (row, r["centroid"][0])

    texts.sort(key=reading_sort_key)

    ordered = containers + figures + texts

    # Thêm padding nhẹ và gán vai trò
    final_regions = []
    pad = max(6, int(round(0.012 * max(w, h))))
    for r in ordered:
        bx = r["box"]
        padded_box = [
            max(0, bx[0] - pad),
            max(0, bx[1] - pad),
            min(w, bx[2] + pad),
            min(h, bx[3] + pad),
        ]
        role = "container" if r.get("is_container") else ("text" if r.get("is_text") else "illustration")
        final_regions.append({
            "box": padded_box,
            "role": role,
            "is_text": r.get("is_text", False),
            "ink_count": r.get("ink_count", 0),
        })

    return final_regions
