# Offline thumbnail fonts

These unmodified TrueType fonts are bundled with the frontend, including their
full Vietnamese glyph sets. They are loaded from the local app origin using the
FontFace API. No Google Fonts CSS, CDN requests, or system font installation is
required at runtime.

| File | Family | Weight | Default pen |
| --- | --- | --- | --- |
| charm.ttf | Charm | 700 | Calligraphy, crystal |
| mali.ttf | Mali | 600 | Bamboo |
| bitter.ttf | Bitter | 700 (variable source) | Quill, vintage |
| grenzegotisch.ttf | Grenze Gotisch | 700 (variable source) | Wand |
| chakrapetch.ttf | Chakra Petch | 700 | Technical, cyberpunk |
| bevietnampro.ttf | Be Vietnam Pro | 700 | Marker, digital; watermark |

Each family is licensed under SIL Open Font License 1.1; original license and
copyright notices are preserved in `licenses/`. Exact source URLs and the pinned
Google Fonts repository revision are recorded in `sources.json`.

Validation:

- `python3 -m unittest discover -s sidecar-whiteboard/tests -p test_thumbnail_fonts.py -v`
- With Vite running: `node tests/thumbnail-fonts.mjs` (set `CHROME_PATH` if needed).

The first check inspects the actual TTF Unicode glyph maps for every Vietnamese
vowel/tone combination and Đ/đ. The browser check blocks external requests and
verifies local font loading, all pen presets, decomposed Vietnamese input,
manual overrides, saved thumbnail metadata and stale-cover warnings.
