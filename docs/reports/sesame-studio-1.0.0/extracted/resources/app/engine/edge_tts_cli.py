import sys, json, asyncio
import edge_tts

async def main(cfg):
    c = edge_tts.Communicate(cfg["text"], cfg["voice"], rate=cfg.get("rate", "+0%"))
    await c.save(cfg["out"])

cfg = json.load(open(sys.argv[1], encoding="utf-8-sig"))
asyncio.run(main(cfg))
