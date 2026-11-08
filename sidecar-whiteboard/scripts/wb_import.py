"""Bộ đọc và xác thực (parser & validator) bộ kịch bản Whiteboard Schema 3 (.wb.json & .srt).

Đáp ứng yêu cầu mốc I2 & I3 trong kế hoạch Character Bible:
- Xác thực schema_version == 3 (WB_SCHEMA_MISMATCH)
- Xác thực SHA-256 của tệp SRT thực tế khớp srt_sha256 (WB_SRT_HASH_MISMATCH)
- Đối chiếu số lượng & mốc thời gian cues giữa .wb.json và .srt (WB_CUE_COUNT_MISMATCH)
- Kiểm tra toàn vẹn speaker_id với speech.speakers (WB_SPEAKER_NOT_FOUND)
- Kiểm tra tính nhất quán scenes và cue_ids (WB_SCENE_CUE_INVALID)
- Ánh xạ sang danh sách WhiteboardSceneItem và WhiteboardSpeaker hoàn chỉnh
"""

from __future__ import annotations

import hashlib
import json
import os
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from parse_srt import parse_srt
except ImportError:
    from scripts.parse_srt import parse_srt

# 25 giọng dựng sẵn của VieNeu-TTS v3 Turbo
VALID_VIENEU_VOICES = {
    "Thùy Dung", "Thái Sơn", "Thục Đoan", "Minh Triết", "Mỹ Duyên",
    "Đức Trí", "Kim Thanh", "Adam", "Hải Đăng", "Trúc Ly",
    "Thiện Minh", "Mai Anh", "Ngọc Huyền", "Minh Đức", "Phạm Tuyên",
    "Xuân Vĩnh", "Thanh Bình", "Ngọc Linh", "Đoan Trang", "Quỳnh Anh",
    "Quốc Tuấn", "Thiền Tâm Đức", "Adam bựa", "Quang Sơn", "Ngọc Trân",
}
DEFAULT_FALLBACK_VOICE = "Thùy Dung"


def compute_file_sha256(path: str | Path) -> str:
    """Tính SHA-256 của tệp theo raw bytes."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def find_wb_json_for_srt(srt_path: str | Path) -> Optional[Path]:
    """Tìm tệp .wb.json tương ứng nằm cạnh tệp SRT."""
    srt = Path(srt_path)
    base = srt.with_suffix("")
    candidate1 = base.with_suffix(".wb.json")
    if candidate1.exists():
        return candidate1
    # Thử dạng <name>.srt.wb.json
    candidate2 = srt.with_name(srt.name + ".wb.json")
    if candidate2.exists():
        return candidate2
    return None


def inspect_wb_bundle(srt_path: str, wb_json_path: Optional[str] = None) -> Dict[str, Any]:
    """Đọc, xác thực và ánh xạ bộ SRT + .wb.json.

    Trả về dict chuẩn tương thích WhiteboardWbInspectResult.
    """
    warnings: List[str] = []
    errors: List[str] = []
    srt_p = Path(srt_path)
    if not srt_p.exists():
        return {
            "valid": False,
            "schemaVersion": 0,
            "srtSha256Matches": False,
            "scenesCount": 0,
            "cuesCount": 0,
            "speakersCount": 0,
            "durationMs": 0,
            "speechMode": "single",
            "speakers": [],
            "scenes": [],
            "errors": [f"WB_SRT_NOT_FOUND: Tệp SRT không tồn tại: {srt_path}"],
        }

    # Tìm tệp .wb.json nếu chưa chỉ định rõ
    if wb_json_path:
        json_p = Path(wb_json_path)
    else:
        found = find_wb_json_for_srt(srt_p)
        if not found:
            return {
                "valid": False,
                "schemaVersion": 0,
                "srtSha256Matches": False,
                "scenesCount": 0,
                "cuesCount": 0,
                "speakersCount": 0,
                "durationMs": 0,
                "speechMode": "single",
                "speakers": [],
                "scenes": [],
                "errors": [f"WB_JSON_NOT_FOUND: Không tìm thấy tệp .wb.json đi kèm cạnh {srt_p.name}"],
            }
        json_p = found

    if not json_p.exists():
        return {
            "valid": False,
            "schemaVersion": 0,
            "srtSha256Matches": False,
            "scenesCount": 0,
            "cuesCount": 0,
            "speakersCount": 0,
            "durationMs": 0,
            "speechMode": "single",
            "speakers": [],
            "scenes": [],
            "errors": [f"WB_JSON_NOT_FOUND: Tệp kịch bản WB không tồn tại: {json_p}"],
        }

    # Đọc tệp SRT và tính mã băm SHA-256
    try:
        srt_raw_bytes = srt_p.read_bytes()
        actual_sha256 = hashlib.sha256(srt_raw_bytes).hexdigest()
        srt_text = srt_raw_bytes.decode("utf-8-sig")
    except Exception as e:
        return {
            "valid": False,
            "schemaVersion": 0,
            "srtSha256Matches": False,
            "scenesCount": 0,
            "cuesCount": 0,
            "speakersCount": 0,
            "durationMs": 0,
            "speechMode": "single",
            "speakers": [],
            "scenes": [],
            "errors": [f"WB_SRT_READ_ERROR: Không thể đọc tệp SRT: {e}"],
        }

    # Đọc tệp .wb.json
    try:
        meta: Dict[str, Any] = json.loads(json_p.read_text(encoding="utf-8"))
    except Exception as e:
        return {
            "valid": False,
            "schemaVersion": 0,
            "srtSha256Matches": False,
            "scenesCount": 0,
            "cuesCount": 0,
            "speakersCount": 0,
            "durationMs": 0,
            "speechMode": "single",
            "speakers": [],
            "scenes": [],
            "errors": [f"WB_INVALID_JSON: Tệp kịch bản .wb.json không hợp lệ cú pháp JSON: {e}"],
        }

    schema_version = meta.get("schema_version")
    if schema_version != 3:
        errors.append(f"WB_SCHEMA_MISMATCH: Kịch bản WB phải có schema_version là 3 (hiện tại: {schema_version})")

    declared_sha256 = meta.get("srt_sha256", "").strip().lower()
    sha256_matches = (declared_sha256 == actual_sha256)
    if not sha256_matches:
        errors.append(
            f"WB_SRT_HASH_MISMATCH: Mã băm SHA-256 của tệp SRT không khớp với kịch bản .wb.json "
            f"(kỳ vọng {declared_sha256}, thực tế {actual_sha256})"
        )

    # Phân tích SRT thực tế
    parsed_srt_cues = parse_srt(srt_text)
    wb_cues = meta.get("cues", [])
    if len(parsed_srt_cues) != len(wb_cues):
        errors.append(
            f"WB_CUE_COUNT_MISMATCH: Số lượng câu thoại trong .wb.json ({len(wb_cues)}) "
            f"không khớp với tệp SRT ({len(parsed_srt_cues)})"
        )

    # Kiểm tra speakers
    speech_section = meta.get("speech", {})
    speech_mode = speech_section.get("mode", "single")
    wb_speakers = speech_section.get("speakers", [])
    speaker_map = {sp["id"]: sp for sp in wb_speakers}

    # Kiểm tra cues và speaker_id
    cue_by_id: Dict[str, Dict[str, Any]] = {}
    for cue in wb_cues:
        cid = cue.get("id")
        if not cid:
            errors.append(f"WB_CUE_INVALID: Có câu thoại thiếu thuộc tính 'id' (index: {cue.get('index')})")
            continue
        cue_by_id[cid] = cue

        sp_id = cue.get("speaker_id")
        if sp_id is not None and sp_id not in speaker_map:
            errors.append(
                f"WB_SPEAKER_NOT_FOUND: Mã nhân vật '{sp_id}' trong câu thoại '{cid}' "
                f"không tồn tại trong danh sách speech.speakers"
            )

    # Kiểm tra scenes và cue_ids
    wb_scenes = meta.get("scenes", [])
    if not wb_scenes:
        errors.append("WB_NO_SCENES: Kịch bản .wb.json không chứa phân cảnh (scenes) nào")

    referenced_cue_ids: set[str] = set()
    for sc in wb_scenes:
        sc_idx = sc.get("index")
        cue_ids = sc.get("cue_ids", [])
        if not cue_ids:
            errors.append(f"WB_SCENE_EMPTY: Phân cảnh #{sc_idx} không chứa câu thoại (cue_ids rỗng)")
            continue
        for cid in cue_ids:
            if cid not in cue_by_id:
                errors.append(f"WB_SCENE_CUE_INVALID: Phân cảnh #{sc_idx} trỏ đến câu thoại không tồn tại: '{cid}'")
            elif cid in referenced_cue_ids:
                errors.append(f"WB_SCENE_CUE_DUPLICATED: Câu thoại '{cid}' bị xuất hiện trùng lặp ở nhiều phân cảnh")
            else:
                referenced_cue_ids.add(cid)

    # Kiểm tra câu thoại bị bỏ sót
    all_cue_ids = set(cue_by_id.keys())
    missing_cues = all_cue_ids - referenced_cue_ids
    if missing_cues:
        errors.append(f"WB_SCENE_CUE_MISSING: Có {len(missing_cues)} câu thoại chưa được gán vào phân cảnh nào: {sorted(list(missing_cues))}")

    # Chuyển đổi danh sách speaker sang chuẩn WhiteboardSpeaker
    normalized_presets = {unicodedata.normalize("NFC", v).lower(): v for v in VALID_VIENEU_VOICES}
    app_speakers = []
    for sp in wb_speakers:
        raw_voice = sp.get("voice_id", "").strip()
        norm_voice = unicodedata.normalize("NFC", raw_voice).lower()
        if norm_voice in normalized_presets:
            voice_id = normalized_presets[norm_voice]
        else:
            voice_id = DEFAULT_FALLBACK_VOICE
            warnings.append(
                f"Giọng '{raw_voice}' của nhân vật '{sp.get('name', sp['id'])}' không thuộc VieNeu presets. "
                f"Tự động chuyển sang giọng mặc định '{DEFAULT_FALLBACK_VOICE}'."
            )

        app_speakers.append({
            "id": sp["id"],
            "name": sp.get("name", sp["id"]),
            "voiceId": voice_id,
            "sourceCharacterId": sp.get("id"),
        })

    # Ánh xạ scenes sang WhiteboardSceneItem nếu hợp lệ
    app_scenes = []
    total_duration_ms = 0
    if not errors:
        for idx, sc in enumerate(wb_scenes):
            sc_cues = []
            for cid in sc.get("cue_ids", []):
                wb_c = cue_by_id[cid]
                sp_id = wb_c.get("speaker_id")
                sp_name = speaker_map[sp_id]["name"] if sp_id and sp_id in speaker_map else None
                sc_cues.append({
                    "id": wb_c["id"],
                    "index": wb_c["index"],
                    "startMs": wb_c["start_ms"],
                    "endMs": wb_c["end_ms"],
                    "durMs": max(0, wb_c["end_ms"] - wb_c["start_ms"]),
                    "text": wb_c["text"],
                    "sourceText": wb_c["text"],
                    "spokenText": wb_c.get("spoken_text", wb_c["text"]),
                    "speakerName": sp_name,
                    "speakerId": sp_id,
                })

            cue_indices = [c["index"] for c in sc_cues]
            min_cue = min(cue_indices) if cue_indices else sc.get("index", idx + 1)
            max_cue = max(cue_indices) if cue_indices else sc.get("index", idx + 1)
            sc_dur = max(1000, sc["end_ms"] - sc["start_ms"])
            total_duration_ms = max(total_duration_ms, sc["end_ms"])
            story_basis = sc.get("moment") or sc.get("setting") or sc.get("text", "")

            sc_num = int(sc.get('index', idx + 1))
            app_scenes.append({
                "id": f"scene-{sc_num:02d}",
                "order": idx + 1,
                "revision": 1,
                "imagePath": "",
                "annotationPath": "",
                "timelineStartMs": sc["start_ms"],
                "timelineEndMs": sc["end_ms"],
                "durationMs": sc_dur,
                "sceneDurationMs": sc_dur,
                "belowMin": False,
                "aboveMax": False,
                "cueRange": [min_cue, max_cue],
                "text": sc["text"],
                "storyBasis": story_basis,
                "cues": sc_cues,
                "status": "idle",
                "subjectFirst": True,
                "colorFill": "brush",
                "inkPath": "grid",
                "enabled": True,
            })

    if total_duration_ms == 0 and meta.get("timing"):
        total_duration_ms = meta["timing"].get("duration_ms", 0)

    # Chế độ speech: nếu speech_mode là "characters" nhưng không có speaker nào -> chuyển về "single"
    final_speech_mode = "characters" if (speech_mode == "characters" and len(app_speakers) > 0) else "single"

    return {
        "valid": len(errors) == 0,
        "schemaVersion": schema_version or 0,
        "srtSha256Matches": sha256_matches,
        "title": meta.get("title", ""),
        "scenesCount": len(wb_scenes),
        "cuesCount": len(wb_cues),
        "speakersCount": len(wb_speakers),
        "durationMs": total_duration_ms,
        "speechMode": final_speech_mode,
        "speakers": app_speakers,
        "scenes": app_scenes,
        "warnings": warnings,
        "errors": errors,
    }

