import sys
import os
import json

os.environ["PYTHONUTF8"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

from vieneu import Vieneu

VOICE_MAP = {
    "quỳnh anh": "Quỳnh Anh",
    "mỹ duyên": "Mỹ Duyên",
    "kim thanh": "Kim Thanh",
    "ngọc linh": "Ngọc Linh",
    "thục đoan": "Thục Đoan",
    "ngọc huyền": "Ngọc Huyền",
    "trúc ly": "Trúc Ly",
    "mai anh": "Mai Anh",
    "thùy dung": "Thùy Dung",
    "ngọc trân": "Ngọc Trân",
    "đoan trang": "Đoan Trang",
    "hương": "Quỳnh Anh",
    "hoài mỹ": "Quỳnh Anh",
    "vi-vn-hoaimyneural": "Quỳnh Anh",
    "thiện minh": "Thiện Minh",
    "đức trí": "Đức Trí",
    "thái sơn": "Thái Sơn",
    "thanh bình": "Thanh Bình",
    "bình": "Thanh Bình",
    "hải đăng": "Hải Đăng",
    "thiền tâm đức": "Thiền Tâm Đức",
    "minh đức": "Minh Đức",
    "nam minh": "Thiện Minh",
    "vi-vn-namminhneural": "Thiện Minh",
}

def resolve_voice(v: str) -> str:
    if not v:
        return "Quỳnh Anh"
    raw = v.strip()
    low = raw.lower()
    if low in VOICE_MAP:
        return VOICE_MAP[low]
    for k, val in VOICE_MAP.items():
        if k in low:
            return val
    return raw

def main():
    if len(sys.argv) < 2:
        print("Usage: vieneu_tts_cli.py <json_payload_or_file>", file=sys.stderr)
        sys.exit(1)

    arg = sys.argv[1]
    if os.path.isfile(arg):
        with open(arg, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.loads(arg)

    tts = Vieneu()
    items = data.get("items")
    if items:
        for item in items:
            text = item.get("text", "").strip()
            out_path = item.get("outPath", "")
            voice = resolve_voice(item.get("voice", "Quỳnh Anh"))
            if text and out_path:
                audio = tts.infer(text=text, voice=voice)
                tts.save(audio, out_path)
    else:
        text = data.get("text", "").strip()
        out_path = data.get("outPath", "")
        voice = resolve_voice(data.get("voice", "Quỳnh Anh"))
        if text and out_path:
            audio = tts.infer(text=text, voice=voice)
            tts.save(audio, out_path)

    tts.close()
    print("OK")

if __name__ == "__main__":
    main()
