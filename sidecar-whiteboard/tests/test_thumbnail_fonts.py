"""Verify bundled font cmaps cover every Vietnamese vowel/tone, without network or extra packages."""
import json
from pathlib import Path
import struct
import unicodedata
import unittest

FONTS = Path(__file__).resolve().parents[2] / "public" / "fonts" / "thumbnail"


def unicode_glyphs(data):
    def u16(offset):
        return struct.unpack_from(">H", data, offset)[0]
    def u32(offset):
        return struct.unpack_from(">I", data, offset)[0]
    cmap = next(u32(12 + i * 16 + 8) for i in range(u16(4)) if data[12 + i * 16:16 + i * 16] == b"cmap")
    supported = set()
    for i in range(u16(cmap + 2)):
        record = cmap + 4 + i * 8
        platform, encoding = u16(record), u16(record + 2)
        if platform != 0 and (platform != 3 or encoding not in (1, 10)):
            continue
        table = cmap + u32(record + 4)
        fmt = u16(table)
        if fmt == 12:
            for j in range(u32(table + 12)):
                start, end, glyph = struct.unpack_from(">III", data, table + 16 + j * 12)
                supported.update(cp for cp in range(start, end + 1) if glyph + cp - start)
        elif fmt == 4:
            segments = u16(table + 6) // 2
            for j in range(segments):
                end = u16(table + 14 + j * 2)
                start = u16(table + 16 + segments * 2 + j * 2)
                delta = u16(table + 16 + segments * 4 + j * 2)
                range_pos = table + 16 + segments * 6 + j * 2
                distance = u16(range_pos)
                for cp in range(start, end + 1):
                    glyph = u16(range_pos + distance + (cp - start) * 2) if distance else cp
                    if glyph and (glyph + delta) % 65536:
                        supported.add(cp)
    return supported


class ThumbnailFontsTest(unittest.TestCase):
    def test_all_fonts_cover_full_vietnamese_alphabet(self):
        text = "ĐđABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz –—"
        for vowel in "aăâeêioôơuưyAĂÂEÊIOÔƠUƯY":
            for tone in ("", "\u0300", "\u0301", "\u0309", "\u0303", "\u0323"):
                text += unicodedata.normalize("NFC", vowel + tone)
        # Input can be decomposed, too; the renderer normalizes to NFC before drawing.
        required = set(map(ord, text))
        manifest = json.loads((FONTS / "sources.json").read_text())
        self.assertEqual(len(manifest["fonts"]), 6)
        for font in manifest["fonts"]:
            with self.subTest(font=font["id"]):
                supported = unicode_glyphs((FONTS / font["file"]).read_bytes())
                missing = required - supported
                self.assertFalse(missing, "Missing glyphs: " + " ".join(f"U+{cp:04X}" for cp in sorted(missing)))
                self.assertIn("SIL OPEN FONT LICENSE", (FONTS / "licenses" / (font["id"] + ".txt")).read_text())


if __name__ == "__main__":
    unittest.main()
