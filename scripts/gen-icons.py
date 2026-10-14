"""Gera os ícones do app a partir do emblema Vórtice (src/components/RoseEmblem.tsx).
Uso: python scripts/gen-icons.py  (precisa de playwright: pip install playwright && playwright install chromium)"""
import os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "src", "components", "RoseEmblem.tsx"), encoding="utf-8").read()
PETAL, VEIN = (re.search(rf"const {n} = '([^']+)'", src).group(1) for n in ("PETAL", "VEIN"))
ROT, THORN = [0, 72, 144, 216, 288], [63.5, 135.5, 207.5, 279.5, 351.5]


def emblem(detail=True, mono=False):
    """SVG 620x620 do emblema. mono = silhueta branca (badge de notificação do Android)."""
    t = lambda a: f'transform="translate(310 310) rotate({a})"'
    fill = "#fff"
    petals = "".join(f'<path d="{PETAL}" {t(a)} fill="{fill}"/>' for a in ROT)
    if detail and not mono:
        petals += "".join(f'<path d="{PETAL}" {t(a)} fill="url(#sh)"/>' for a in ROT)
        petals += "".join(f'<path d="{VEIN}" {t(a)} fill="none" stroke="#d62f45" stroke-width="3.6" stroke-linecap="round" opacity=".55"/>' for a in ROT)
    thorns = "".join(f'<polygon points="0,-300 -15,-256 15,-256" {t(a)} fill="{fill if mono else "url(#cr)"}"/>' for a in THORN)
    eye = '<circle cx="310" cy="310" r="26" fill="#fff"/>' + ('' if mono else '<circle cx="310" cy="310" r="11" fill="#1b1b20"/>')
    defs = ('<defs><linearGradient id="cr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ec5468"/><stop offset=".7" stop-color="#d62f45"/><stop offset="1" stop-color="#b8233a"/></linearGradient>'
            '<radialGradient id="sh" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#d62f45" stop-opacity="0"/><stop offset="1" stop-color="#b8233a" stop-opacity=".18"/></radialGradient></defs>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 620">{defs}{petals}{thorns}{eye}</svg>'


def tile(size, scale, bg=True):
    """Ícone quadrado: fundo grafite com brilho carmim e o emblema ocupando `scale` do lado."""
    glow = "radial-gradient(circle at 50% 50%, rgba(214,47,69,.38), rgba(214,47,69,.08) 45%, transparent 70%), #1b1b20" if bg else "transparent"
    e = size * scale
    return (f'<html><body style="margin:0;width:{size}px;height:{size}px;background:{glow};display:grid;place-items:center">'
            f'<div style="width:{e}px;height:{e}px">{emblem(detail=size >= 128, mono=not bg)}</div></body></html>')


PUB = os.path.join(ROOT, "public")
open(os.path.join(PUB, "favicon.svg"), "w", encoding="utf-8").write(emblem(detail=False))
OUT = [  # arquivo, tamanho, fração do emblema, com fundo
    ("icon-512.png", 512, 0.82, True),
    ("icon-192.png", 192, 0.82, True),
    ("icon.png", 256, 0.82, True),
    ("apple-touch-icon.png", 180, 0.74, True),  # o iOS arredonda os cantos: um pouco mais de respiro
    ("icon-maskable-512.png", 512, 0.6, True),  # zona segura do Android = círculo de 80%
    ("badge-96.png", 96, 0.92, False),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, scale, bg in OUT:
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(tile(size, scale, bg))
        pg.screenshot(path=os.path.join(PUB, name), omit_background=not bg)
        pg.close()
        print("ok", name)
    b.close()
