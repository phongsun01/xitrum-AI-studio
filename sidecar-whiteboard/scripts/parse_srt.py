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
    Chia các câu phụ đề liên tiếp thành cảnh bằng quy hoạch động.

    Mục tiêu (theo thứ tự ưu tiên): (1) tổng độ vi phạm khoảng [min, max] nhỏ nhất,
    (2) tổng độ lệch so với target nhỏ nhất. Cảnh nào vẫn ngoài [min, max] được gắn cờ
    `belowMin` / `aboveMax` (ví dụ một câu dài hơn max không thể tách).

    Các cảnh lát kín toàn bộ timeline: cảnh đầu bắt đầu từ 0 (gồm cả đoạn lặng đầu file), khoảng
    lặng giữa hai cảnh thuộc cảnh đứng trước, cảnh cuối kết thúc ở cuối câu phụ đề cuối.
    Vì vậy tổng `sceneDurationMs` của các cảnh đúng bằng độ dài timeline và khớp với âm thanh.

    Mỗi cảnh có: startMs/endMs (theo câu phụ đề đầu/cuối), timelineStartMs/timelineEndMs
    (ranh giới thật trên timeline), sceneDurationMs (= timeline dài bao nhiêu), cueRange, text.
    """
    if not cues:
        return []

    n = len(cues)
    target_ms, min_ms, max_ms = target_sec * 1000, min_sec * 1000, max_sec * 1000

    def t_start(a: int) -> int:
        return 0 if a == 0 else cues[a]["startMs"]

    def t_end(b: int) -> int:
        return cues[b]["endMs"] if b == n - 1 else cues[b + 1]["startMs"]

    def cost(dur: int) -> tuple[int, int]:
        viol = max(0, min_ms - dur) + max(0, dur - max_ms)
        return (int(viol), int(abs(dur - target_ms)))

    INF = (float("inf"), float("inf"))
    # best[i] = chi phí tối ưu để chia các câu 0..i-1; prev[i] = điểm cắt trước đó
    best: list[tuple] = [INF] * (n + 1)
    prev = [0] * (n + 1)
    best[0] = (0, 0)
    for a in range(n):
        if best[a] == INF:
            continue
        for b in range(a, n):
            dur = t_end(b) - t_start(a)
            c = cost(dur)
            cand = (best[a][0] + c[0], best[a][1] + c[1])
            if cand < best[b + 1]:
                best[b + 1] = cand
                prev[b + 1] = a
            if dur > max_ms:
                break  # kéo dài thêm chỉ vi phạm nhiều hơn

    bounds: list[tuple[int, int]] = []
    i = n
    while i > 0:
        a = prev[i]
        bounds.append((a, i - 1))
        i = a
    bounds.reverse()

    scenes: list[dict] = []
    for a, b in bounds:
        bucket = cues[a:b + 1]
        ts, te = t_start(a), t_end(b)
        dur = max(0, te - ts)
        scenes.append({
            "sceneIndex": len(scenes) + 1,
            "startMs": bucket[0]["startMs"],
            "endMs": bucket[-1]["endMs"],
            "timelineStartMs": ts,
            "timelineEndMs": te,
            "sceneDurationMs": dur,
            "belowMin": dur < min_ms,
            "aboveMax": dur > max_ms,
            "cueRange": [bucket[0]["index"], bucket[-1]["index"]],
            "text": " ".join(c["text"] for c in bucket).strip(),
        })
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

    total_ms = cues[-1]["endMs"]
    print(f"Số dòng phụ đề: {len(cues)}  Tổng thời lượng: {total_ms/1000:.1f}s  Số cảnh đề xuất: {len(scenes)}", file=sys.stderr)
    for s in scenes:
        flag = " [ngắn hơn min]" if s["belowMin"] else (" [dài hơn max]" if s["aboveMax"] else "")
        print(f"  Cảnh {s['sceneIndex']:>2}  {s['timelineStartMs']/1000:6.1f}-{s['timelineEndMs']/1000:6.1f}s "
              f"({s['sceneDurationMs']/1000:4.1f}s, phụ đề {s['cueRange'][0]}-{s['cueRange'][1]}){flag}: "
              f"{s['text'][:40]}", file=sys.stderr)

    json.dump({"cues": cues, "scenes": scenes}, sys.stdout, ensure_ascii=False, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
