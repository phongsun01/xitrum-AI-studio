"""Bộ đọc và xác thực (parser & validator) bộ kịch bản Whiteboard schema 2/3 (.wb.json & .srt).

Đáp ứng yêu cầu mốc I2 & I3 trong kế hoạch Character Bible:
- Schema 2 một giọng và schema 3 nhiều giọng được kiểm tra theo định dạng riêng
- Xác thực SHA-256 của tệp SRT thực tế khớp srt_sha256 (WB_SRT_HASH_MISMATCH)
- Đối chiếu số lượng & mốc thời gian cues giữa .wb.json và .srt (WB_CUE_COUNT_MISMATCH)
- Kiểm tra toàn vẹn speaker_id với speech.speakers (WB_SPEAKER_NOT_FOUND)
- Kiểm tra tính nhất quán scenes và cue_ids (WB_SCENE_CUE_INVALID)
- Ánh xạ sang danh sách WhiteboardSceneItem và WhiteboardSpeaker hoàn chỉnh
"""

from __future__ import annotations

import hashlib
import json
import re
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
MAX_BUNDLE_FILE_BYTES = 16 * 1024 * 1024
MAX_CUES = 10000


def name_key(value):
    return unicodedata.normalize("NFC", " ".join(value.split())).casefold()


def failure(message):
    return dict(valid=False, schemaVersion=0, srtSha256Matches=False, scenesCount=0,
                cuesCount=0, speakersCount=0, durationMs=0, speechMode="single",
                speakers=[], scenes=[], warnings=[], errors=[message])


def compute_file_sha256(path: str | Path) -> str:
    """Tính SHA-256 của tệp theo raw bytes."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def find_wb_json_for_srt(srt_path: str | Path) -> Optional[Path]:
    """Tìm tệp .wb.json tương ứng nằm cạnh tệp SRT."""
    srt = Path(srt_path)
    candidate1 = srt.with_suffix(".wb.json")
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
        if srt_p.stat().st_size > MAX_BUNDLE_FILE_BYTES:
            return failure("WB_FILE_TOO_LARGE: SRT vượt 16 MB")
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
        if json_p.stat().st_size > MAX_BUNDLE_FILE_BYTES:
            return failure("WB_FILE_TOO_LARGE: Metadata vượt 16 MB")
        meta_raw_bytes = json_p.read_bytes()
        meta: Dict[str, Any] = json.loads(meta_raw_bytes.decode("utf-8-sig"))
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

    if not isinstance(meta, dict):
        return failure("WB_INVALID_METADATA: Metadata phải là object")
    schema_version = meta.get("schema_version")
    if type(schema_version) is not int or schema_version not in (2, 3):
        return failure(f"WB_SCHEMA_MISMATCH: Chưa hỗ trợ schema_version={schema_version!r}; hỗ trợ 2 (một giọng) và 3 (nhiều giọng)")
    single_mode = schema_version == 2
    if single_mode:
        # Normalize only in memory. Original bytes still determine the bundle fingerprint.
        legacy_scenes = meta.get("scenes")
        options = meta.get("options", {})
        if (not isinstance(legacy_scenes, list) or any(not isinstance(sc, dict) for sc in legacy_scenes)
                or not isinstance(options, dict)):
            return failure("WB_INVALID_METADATA: Schema 2 cần danh sách scenes và options là object")
        if options.get("speech", "single") != "single":
            return failure("WB_SPEECH_MODE_INVALID: Schema 2 chỉ hỗ trợ một giọng; nhiều giọng dùng schema 3")
        cues, scenes = [], []
        for i, sc in enumerate(legacy_scenes, 1):
            cid = f"cue-{i}"
            clean = sc.get("text").strip() if isinstance(sc.get("text"), str) else None
            cues.append(dict(id=cid, index=sc.get("index"), scene_index=i,
                             start_ms=sc.get("start_ms"), end_ms=sc.get("end_ms"),
                             text=sc.get("text"), spoken_text=clean, speaker_id=None))
            scenes.append(dict(sc, cue_ids=[cid], text=clean))
        meta = dict(meta, cues=cues, scenes=scenes, speech={"mode": "single", "speakers": []})
    declared_hash = meta.get("srt_sha256")
    sha256_matches = isinstance(declared_hash, str) and declared_hash.lower() == actual_sha256
    if not sha256_matches:
        errors.append("WB_SRT_HASH_MISMATCH: SHA-256 của SRT không khớp metadata")

    wb_cues, wb_scenes = meta.get("cues"), meta.get("scenes")
    speech = meta.get("speech")
    if (not isinstance(wb_cues, list) or not isinstance(wb_scenes, list)
            or not isinstance(speech, dict) or not isinstance(speech.get("speakers"), list)
            or any(not isinstance(x, dict) for x in wb_cues + wb_scenes + speech["speakers"])):
        result = failure("WB_INVALID_METADATA: cues/scenes/speech.speakers sai kiểu dữ liệu")
        result["errors"] = errors + result["errors"]
        return result
    if not 0 < len(wb_cues) <= MAX_CUES:
        return failure("WB_CUE_COUNT_INVALID: Cần từ 1 đến 10000 cue")
    if speech.get("mode") != ("single" if single_mode else "characters"):
        errors.append("WB_SPEECH_MODE_INVALID: Chế độ đọc không khớp schema")
    if not wb_scenes:
        errors.append("WB_NO_SCENES: Không có phân cảnh")

    # Validate raw blocks too: parse_srt deliberately tolerates/skips malformed input.
    source = srt_text.replace("\r\n", "\n").replace("\r", "\n").strip()
    blocks = re.split(r"\n\s*\n", source) if source else []
    parsed = parse_srt(srt_text)
    timestamp = r"\d{2,}:[0-5]\d:[0-5]\d[,\.]\d{3}"
    raw_texts = []
    for i, block in enumerate(blocks, 1):
        lines = block.splitlines()
        if (len(lines) < 3 or lines[0].strip() != str(i)
                or not re.fullmatch(timestamp + r"\s+-->\s+" + timestamp, lines[1].strip())):
            errors.append(f"WB_SRT_INVALID: Cấu trúc/thời gian cue #{i} sai")
        raw_texts.append("\n".join(lines[2:]))
    if len(parsed) != len(wb_cues) or len(blocks) != len(wb_cues):
        errors.append("WB_CUE_COUNT_MISMATCH: Số cue SRT và JSON khác nhau")

    wb_speakers = speech["speakers"]
    speaker_map, app_speakers, speaker_names = {}, [], set()
    for sp in wb_speakers:
        sid, name = sp.get("id"), sp.get("name")
        if not isinstance(sid, str) or not sid.strip() or sid in speaker_map:
            errors.append("WB_SPEAKER_INVALID: ID người nói thiếu/trùng")
            continue
        if not isinstance(name, str) or not name.strip() or name_key(name) in speaker_names:
            errors.append("WB_SPEAKER_INVALID: Tên người nói thiếu/trùng")
            continue
        speaker_names.add(name_key(name))
        speaker_map[sid] = sp
        raw_voice = sp.get("voice_id")
        if raw_voice is None or raw_voice == "":
            voice_id = ""  # UI adapter assigns the user's default, not the first character's voice.
            warnings.append(f"Nhân vật '{name}' chưa chọn giọng; sẽ dùng giọng mặc định của dự án.")
        elif not isinstance(raw_voice, str):
            errors.append(f"WB_VOICE_INVALID: voice_id của '{name}' phải là string hoặc null")
            continue
        else:
            voice_id = unicodedata.normalize("NFC", raw_voice.strip())
            if voice_id not in VALID_VIENEU_VOICES:
                # Preserve an explicit unknown ID so strict TTS rejects it until corrected in UI.
                warnings.append(f"Giọng '{voice_id}' của '{name}' không thuộc VieNeu presets; hãy chọn lại trước khi tạo TTS.")
        app_speakers.append(dict(id=sid, name=name, voiceId=voice_id))

    cue_by_id, ordered_ids = {}, []
    previous_end = 0
    for i, cue in enumerate(wb_cues, 1):
        cid, sid = cue.get("id"), cue.get("speaker_id")
        if not isinstance(cid, str) or not cid.strip() or cid in cue_by_id:
            errors.append(f"WB_CUE_INVALID: ID cue #{i} thiếu/trùng")
            continue
        ordered_ids.append(cid)
        cue_by_id[cid] = cue
        if sid is not None and (not isinstance(sid, str) or sid not in speaker_map):
            errors.append(f"WB_SPEAKER_NOT_FOUND: Người nói của cue '{cid}' không tồn tại")
        if i <= len(parsed) and i <= len(raw_texts):
            raw = parsed[i - 1]
            if (type(cue.get("index")) is not int or cue["index"] != i
                    or type(cue.get("start_ms")) is not int or cue["start_ms"] != raw["startMs"]
                    or type(cue.get("end_ms")) is not int or cue["end_ms"] != raw["endMs"]
                    or cue.get("text") != raw_texts[i - 1]):
                errors.append(f"WB_CUE_MISMATCH: Cue '{cid}' khác nội dung/thời gian SRT")
            body = raw_texts[i - 1]
            prefix = re.match(r"^\s*\[([^\]\n]+)\]\s*:\s*(.*)$", body, re.DOTALL)
            spoken = prefix.group(2).strip() if prefix and not single_mode else body.strip()
            if (not spoken.strip() or cue.get("spoken_text") != spoken
                    or not single_mode and re.search(r"\[[^\]]*\]\s*:", spoken)):
                errors.append(f"WB_SPOKEN_TEXT_INVALID: Lời sạch cue '{cid}' không hợp lệ")
            label = None if single_mode else raw["speakerName"]
            if (label is None and sid is not None or label is not None and
                    (not isinstance(sid, str) or sid not in speaker_map or name_key(label) != name_key(speaker_map[sid]["name"]))):
                errors.append(f"WB_SPEAKER_MISMATCH: Nhãn cue '{cid}' khác người nói")
            if raw["startMs"] != previous_end or raw["endMs"] <= raw["startMs"]:
                errors.append(f"WB_TIMELINE_INVALID: Cue '{cid}' phải liên tục từ 0 và có thời lượng dương")
            previous_end = raw["endMs"]

    referenced, cursor = set(), 0
    for i, scene in enumerate(wb_scenes, 1):
        refs = scene.get("cue_ids")
        if not isinstance(refs, list) or not refs or any(not isinstance(cid, str) for cid in refs):
            errors.append(f"WB_SCENE_EMPTY: cue_ids cảnh #{i} thiếu/sai")
            continue
        if refs != ordered_ids[cursor:cursor + len(refs)]:
            errors.append(f"WB_SCENE_CUE_ORDER: Cue cảnh #{i} bị thiếu/đảo/trùng")
        cursor += len(refs)
        for cid in refs:
            if cid not in cue_by_id:
                errors.append(f"WB_SCENE_CUE_INVALID: Cue '{cid}' không tồn tại")
            elif cid in referenced:
                errors.append(f"WB_SCENE_CUE_DUPLICATED: Cue '{cid}' lặp")
            referenced.add(cid)
        if all(cid in cue_by_id for cid in refs):
            group = [cue_by_id[cid] for cid in refs]
            if (type(scene.get("index")) is not int or scene["index"] != i
                    or any(type(c.get("scene_index")) is not int or c["scene_index"] != i for c in group)
                    or type(scene.get("start_ms")) is not int or scene["start_ms"] != group[0].get("start_ms")
                    or type(scene.get("end_ms")) is not int or scene["end_ms"] != group[-1].get("end_ms")
                    or scene.get("text") != "\n".join(str(c.get("spoken_text", "")) for c in group)):
                errors.append(f"WB_SCENE_MISMATCH: Cửa sổ/lời/ID cảnh #{i} không khớp cue")
    if set(cue_by_id) - referenced:
        errors.append("WB_SCENE_CUE_MISSING: Có cue chưa thuộc cảnh nào")

    app_scenes = []
    if not errors:
        for i, sc in enumerate(wb_scenes, 1):
            sc_cues = []
            for cid in sc["cue_ids"]:
                c = cue_by_id[cid]
                sid = c.get("speaker_id")
                sc_cues.append(dict(id=cid, index=c["index"], startMs=c["start_ms"], endMs=c["end_ms"],
                                    durMs=c["end_ms"]-c["start_ms"], text=c["spoken_text"], sourceText=c["text"],
                                    spokenText=c["spoken_text"], speakerId=sid,
                                    speakerName=speaker_map[sid]["name"] if sid is not None else None))
            duration = sc["end_ms"] - sc["start_ms"]
            app_scenes.append(dict(id=f"scene-{i:02d}", order=i, revision=1, imagePath="", annotationPath="",
                                   timelineStartMs=sc["start_ms"], timelineEndMs=sc["end_ms"], durationMs=duration,
                                   sceneDurationMs=duration, belowMin=False, aboveMax=False,
                                   cueRange=[sc_cues[0]["index"], sc_cues[-1]["index"]], text=sc["text"],
                                   storyBasis=sc.get("moment") or sc.get("setting") or sc["text"],
                                   cues=sc_cues, status="idle", subjectFirst=True, colorFill="brush", inkPath="grid"))
    return dict(valid=not errors, schemaVersion=schema_version if type(schema_version) is int else 0,
                srtSha256Matches=sha256_matches, title=meta.get("title") if isinstance(meta.get("title"), str) else "",
                scenesCount=len(wb_scenes), cuesCount=len(wb_cues), speakersCount=len(wb_speakers),
                durationMs=previous_end, speechMode="single" if single_mode else "characters", speakers=app_speakers,
                scenes=app_scenes, warnings=warnings, errors=errors,
                wbJsonPath=str(json_p.resolve()),
                bundleFingerprint=hashlib.sha256(srt_raw_bytes + b"\0" + meta_raw_bytes).hexdigest())
