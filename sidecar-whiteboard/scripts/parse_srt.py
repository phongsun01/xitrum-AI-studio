#!/usr/bin/env python3
"""
SRT 解析 + 分镜建议

把 .srt 字幕解析成结构化字幕条，并按「每幕 25-35 秒口播」的建议把字幕
分组成场景，给出每个场景的起止时间、总时长（→ sceneDurationMs）和文本。

用途：作为 srt-whiteboard-animation 工作流第 1 步的输入依据——
读出叙事事件、规划配图策略、并为每张图片的标注确定 sceneDurationMs。

用法：
  python parse_srt.py <字幕.srt> [--target-sec 30] [--min-sec 25] [--max-sec 35]

输出：JSON（stdout），字段：
  cues    每条字幕: {index, startMs, endMs, durMs, text}
  scenes  建议场景: {sceneIndex, startMs, endMs, sceneDurationMs, cueRange, text}
标准 stderr 打印人类可读摘要，便于直接阅读。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_TIME = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})")


def _to_ms(h: str, m: str, s: str, ms: str) -> int:
    return ((int(h) * 60 + int(m)) * 60 + int(s)) * 1000 + int(ms.ljust(3, "0"))


def parse_srt(text: str) -> list[dict]:
    """把 SRT 文本解析成字幕条列表。容忍多余空行、BOM、逗号/点毫秒分隔。"""
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[dict] = []
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip() != ""]
        if not lines:
            continue
        # 找到含时间轴的行
        time_line_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if time_line_idx is None:
            continue
        times = _TIME.findall(lines[time_line_idx])
        if len(times) < 2:
            continue
        start = _to_ms(*times[0])
        end = _to_ms(*times[1])
        body = " ".join(lines[time_line_idx + 1:]).strip()
        cues.append({
            "index": len(cues) + 1,
            "startMs": start,
            "endMs": end,
            "durMs": max(0, end - start),
            "text": body,
        })
    return cues


def group_scenes(cues: list[dict], target_sec: float, min_sec: float, max_sec: float) -> list[dict]:
    """
    Chia các câu phụ đề liên tiếp thành các cảnh (scenes) theo thời lượng mục tiêu (target_sec).
    Quy tắc chuẩn:
    - Nếu cảnh kế tiếp có khoảng trống thời gian với cảnh trước (silence gap),
      startMs của cảnh sau được tính bao gồm cả silence để khớp hoàn toàn với tổng timeline SRT.
    - Cảnh đạt ngưỡng target_ms (và tối thiểu min_ms) sẽ ngắt cảnh.
    - Nếu thêm cue tiếp theo làm vượt max_ms thì ngắt cảnh ngay lập tức.
    """
    if not cues:
        return []

    scenes: list[dict] = []
    bucket: list[dict] = []
    target_ms, min_ms, max_ms = target_sec * 1000, min_sec * 1000, max_sec * 1000

    last_scene_end = 0

    def flush() -> None:
        nonlocal last_scene_end
        if not bucket:
            return
        # Bắt đầu cảnh từ mốc kết thúc của cảnh trước đó (nếu có gap) hoặc từ đầu cue đầu tiên
        # để đảm bảo timeline tổng của các cảnh liên tục và khớp với audio/SRT gốc.
        start = bucket[0]["startMs"] if not scenes else last_scene_end
        end = bucket[-1]["endMs"]
        duration = max(0, end - start)
        scenes.append({
            "sceneIndex": len(scenes) + 1,
            "startMs": start,
            "endMs": end,
            "sceneDurationMs": duration,
            "cueRange": [bucket[0]["index"], bucket[-1]["index"]],
            "text": " ".join(c["text"] for c in bucket).strip(),
        })
        last_scene_end = end
        bucket.clear()

    for cue in cues:
        # Nếu cộng dồn cue này sẽ vượt max_ms thì chốt cảnh hiện tại trước
        if bucket:
            current_start = bucket[0]["startMs"] if not scenes else last_scene_end
            span_with = cue["endMs"] - current_start
            if span_with > max_ms and (cue["startMs"] - current_start) >= min_ms:
                flush()

        bucket.append(cue)
        current_start = bucket[0]["startMs"] if not scenes else last_scene_end
        span = bucket[-1]["endMs"] - current_start
        # Đạt ngưỡng mục tiêu và không ngắn hơn min_ms thì ngắt cảnh
        if span >= target_ms and span >= min_ms:
            flush()

    flush()
    return scenes


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Phân tích SRT + đề xuất chia cảnh")
    p.add_argument("srt", help="Đường dẫn tệp phụ đề (.srt)")
    p.add_argument("--target-sec", type=float, default=30.0, help="Số giây đọc mục tiêu mỗi cảnh (mặc định 30)")
    p.add_argument("--min-sec", type=float, default=25.0, help="Số giây tối thiểu mỗi cảnh (mặc định 25)")
    p.add_argument("--max-sec", type=float, default=35.0, help="Số giây tối đa mỗi cảnh (mặc định 35)")
    args = p.parse_args(argv)

    try:
        raw = Path(args.srt).read_text(encoding="utf-8-sig")
    except OSError as e:
        print(f"[err] Không đọc được phụ đề: {e}", file=sys.stderr)
        return 1

    cues = parse_srt(raw)
    if not cues:
        print("[err] Không phân tích được dòng phụ đề nào, hãy kiểm tra định dạng SRT", file=sys.stderr)
        return 1
    scenes = group_scenes(cues, args.target_sec, args.min_sec, args.max_sec)

    total_ms = cues[-1]["endMs"] - cues[0]["startMs"]
    print(f"Số dòng phụ đề: {len(cues)}  Tổng thời lượng: {total_ms/1000:.1f}s  Số cảnh đề xuất: {len(scenes)}", file=sys.stderr)
    for s in scenes:
        print(f"  Cảnh {s['sceneIndex']:>2}  {s['startMs']/1000:6.1f}-{s['endMs']/1000:6.1f}s "
              f"({s['sceneDurationMs']/1000:4.1f}s, phụ đề {s['cueRange'][0]}-{s['cueRange'][1]}): "
              f"{s['text'][:40]}", file=sys.stderr)

    json.dump({"cues": cues, "scenes": scenes}, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
