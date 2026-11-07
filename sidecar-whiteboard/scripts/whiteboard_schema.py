"""
Module chuẩn hóa và kiểm thực schema dữ liệu Whiteboard cho Xitrum AI Studio (W0).
Bao gồm:
- Định nghĩa schema dữ liệu chuẩn cho Canvas, Region, Reveal, Element, Annotation.
- Kiểm tra tính hợp lệ: tọa độ hữu hạn, kích thước dương, nằm trong canvas,
  thời gian tuần tự (startMs, durationMs, không overlap cho mô hình 1 đầu bút).
- Adapter tương thích ngược: đọc annotation cũ (thiếu schemaVersion, field legacy)
  và chuyển đổi sang định dạng chuẩn v1 kèm danh sách cảnh báo (warnings).
"""

from __future__ import annotations
import math
from typing import Any, Dict, List, Optional, Tuple


CURRENT_SCHEMA_VERSION = 1


class ValidationError(ValueError):
    """Lỗi dữ liệu cấu trúc Whiteboard không hợp lệ."""
    pass


def validate_canvas(canvas: Any) -> Dict[str, int]:
    if not isinstance(canvas, dict):
        raise ValidationError("canvas phải là một dictionary/object")
    w = canvas.get("width")
    h = canvas.get("height")
    if not isinstance(w, (int, float)) or not isinstance(h, (int, float)):
        raise ValidationError("canvas.width và canvas.height phải là số")
    if math.isnan(w) or math.isinf(w) or math.isnan(h) or math.isinf(h):
        raise ValidationError("canvas.width và canvas.height phải là số hữu hạn")
    if w <= 0 or h <= 0:
        raise ValidationError("canvas.width và canvas.height phải lớn hơn 0")
    return {"width": int(round(w)), "height": int(round(h))}


def validate_region(region: Any, canvas_w: int, canvas_h: int, element_id: str = "") -> Dict[str, int]:
    prefix = f"Element '{element_id}': " if element_id else ""
    if not isinstance(region, dict):
        raise ValidationError(f"{prefix}region phải là một object")
    for field in ("x", "y", "width", "height"):
        val = region.get(field)
        if not isinstance(val, (int, float)):
            raise ValidationError(f"{prefix}region.{field} phải là số")
        if math.isnan(val) or math.isinf(val):
            raise ValidationError(f"{prefix}region.{field} phải hữu hạn")

    x, y = int(round(region["x"])), int(round(region["y"]))
    w, h = int(round(region["width"])), int(round(region["height"]))

    if w <= 0 or h <= 0:
        raise ValidationError(f"{prefix}region width ({w}) và height ({h}) phải > 0")

    # Kiểm tra nằm trong phạm vi canvas
    if x < 0 or y < 0 or (x + w) > canvas_w or (y + h) > canvas_h:
        raise ValidationError(
            f"{prefix}region [{x}, {y}, {w}, {h}] vượt ngoài canvas [{canvas_w}x{canvas_h}]"
        )

    return {"x": x, "y": y, "width": w, "height": h}


def validate_reveal(
    reveal: Any,
    scene_duration_ms: int,
    element_id: str = "",
    canvas_w: int = 1920,
    canvas_h: int = 1080
) -> Tuple[Dict[str, Any], List[str]]:
    prefix = f"Element '{element_id}': " if element_id else ""
    warnings: List[str] = []

    if not isinstance(reveal, dict):
        raise ValidationError(f"{prefix}reveal phải là một object")

    start_ms = reveal.get("startMs")
    dur_ms = reveal.get("durationMs")

    if not isinstance(start_ms, (int, float)) or not isinstance(dur_ms, (int, float)):
        raise ValidationError(f"{prefix}reveal.startMs và reveal.durationMs phải là số")
    if math.isnan(start_ms) or math.isinf(start_ms) or math.isnan(dur_ms) or math.isinf(dur_ms):
        raise ValidationError(f"{prefix}startMs và durationMs phải là số hữu hạn")

    start_ms = int(round(start_ms))
    dur_ms = int(round(dur_ms))

    if start_ms < 0:
        raise ValidationError(f"{prefix}startMs không được âm ({start_ms})")
    if dur_ms <= 0:
        raise ValidationError(f"{prefix}durationMs phải > 0 ({dur_ms})")

    end_ms = start_ms + dur_ms
    if end_ms > scene_duration_ms:
        raise ValidationError(
            f"{prefix}cửa sổ vẽ [{start_ms}ms..{end_ms}ms] vượt quá sceneDurationMs ({scene_duration_ms}ms)"
        )

    # Validate protected regions nếu có
    protected_regions: List[Dict[str, int]] = []
    raw_protected = reveal.get("protectedRegions", [])
    if isinstance(raw_protected, list):
        for idx, p in enumerate(raw_protected):
            if isinstance(p, dict):
                try:
                    pr = validate_region(p, canvas_w, canvas_h, f"{element_id}.protected[{idx}]")
                    protected_regions.append(pr)
                except ValidationError as e:
                    warnings.append(str(e))

    direction = str(reveal.get("direction", "left_to_right"))
    if direction not in ("left_to_right", "top_to_bottom", "right_to_left", "bottom_to_top"):
        warnings.append(f"{prefix}direction '{direction}' chưa hỗ trợ đầy đủ, dùng mặc định")

    clean_reveal = {
        "startMs": start_ms,
        "durationMs": dur_ms,
        "direction": direction,
        "maskPaddingPx": int(reveal.get("maskPaddingPx", 16)),
        "protectedRegions": protected_regions,
    }
    return clean_reveal, warnings


def adapt_and_validate_annotation(raw: Any) -> Tuple[Dict[str, Any], List[str]]:
    """
    Adapter chuẩn hóa và kiểm tra annotation cũ hoặc mới.
    Trả về: (annotation_chuẩn_v1, danh_sách_cảnh_báo)
    Bắn ValidationError nếu dữ liệu không hợp lệ không thể cứu chữa.
    """
    if not isinstance(raw, dict):
        raise ValidationError("Annotation phải là một JSON object")

    warnings: List[str] = []
    schema_version = raw.get("schemaVersion", 0)
    if schema_version < 1:
        warnings.append(f"Annotation không có schemaVersion (coi là phiên bản legacy 0). Đã tự động nâng lên v{CURRENT_SCHEMA_VERSION}.")

    scene_id = str(raw.get("sceneId") or "scene-01")
    story_basis = str(raw.get("storyBasis", ""))
    
    # sceneDurationMs
    raw_duration = raw.get("sceneDurationMs")
    if raw_duration is None:
        raw_duration = 10000
        warnings.append("Thiếu sceneDurationMs, mặc định là 10000ms.")
    if not isinstance(raw_duration, (int, float)) or raw_duration <= 0 or math.isnan(raw_duration) or math.isinf(raw_duration):
        raise ValidationError("sceneDurationMs phải là số dương hợp lệ")
    scene_duration_ms = int(round(raw_duration))

    # Canvas
    canvas = validate_canvas(raw.get("canvas", {"width": 1920, "height": 1080}))
    cw, ch = canvas["width"], canvas["height"]

    # Elements
    raw_elements = raw.get("elements")
    if not isinstance(raw_elements, list):
        raise ValidationError("elements phải là một danh sách")

    clean_elements: List[Dict[str, Any]] = []
    prev_end_ms = 0

    for idx, raw_elem in enumerate(raw_elements):
        if not isinstance(raw_elem, dict):
            raise ValidationError(f"Phần tử thứ {idx} không phải là object")

        elem_id = str(raw_elem.get("id") or f"elem_{idx + 1}")
        label = str(raw_elem.get("label") or f"Vùng {idx + 1}")
        sequence = int(raw_elem.get("sequence", idx + 1))
        elem_type = str(raw_elem.get("type", "object"))
        subtitle = str(raw_elem.get("subtitle", ""))
        narrative_role = str(raw_elem.get("narrativeRole", ""))

        region = validate_region(raw_elem.get("region"), cw, ch, elem_id)
        reveal, reveal_warnings = validate_reveal(
            raw_elem.get("reveal"),
            scene_duration_ms,
            elem_id,
            cw,
            ch
        )
        warnings.extend(reveal_warnings)

        # Kiểm tra thứ tự tuần tự của 1 đầu bút (MVP)
        # Không được để overlap mà không báo trước
        if reveal["startMs"] < prev_end_ms:
            overlap_ms = prev_end_ms - reveal["startMs"]
            warnings.append(
                f"Element '{elem_id}' có startMs ({reveal['startMs']}ms) bị overlap với vùng trước kết thúc tại {prev_end_ms}ms ({overlap_ms}ms overlap)."
            )

        prev_end_ms = max(prev_end_ms, reveal["startMs"] + reveal["durationMs"])

        clean_elem: Dict[str, Any] = {
            "id": elem_id,
            "label": label,
            "sequence": sequence,
            "type": elem_type,
            "subtitle": subtitle,
            "narrativeRole": narrative_role,
            "region": region,
            "reveal": reveal,
        }

        # HandPath: giữ lại metadata nếu có, trả warning nếu renderer chưa hỗ trợ custom hand path
        if "handPath" in raw_elem and isinstance(raw_elem["handPath"], dict):
            clean_elem["handPath"] = raw_elem["handPath"]
            # Lưu ý W0: hiện renderer chỉ stream theo nét vẽ/bắt đầu từ đầu nét, handPath custom chỉ là gợi ý
            warnings.append(f"Element '{elem_id}': handPath tùy biến được lưu giữ trong metadata nhưng renderer stream hiện ưu tiên bám theo tọa độ nét vẽ.")

        clean_elements.append(clean_elem)

    # Đảm bảo sắp xếp theo thứ tự startMs
    clean_elements.sort(key=lambda e: (e["reveal"]["startMs"], e["sequence"]))

    normalized = {
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "sceneId": scene_id,
        "canvas": canvas,
        "storyBasis": story_basis,
        "sceneDurationMs": scene_duration_ms,
        "elements": clean_elements,
    }

    return normalized, warnings

