"""Gera os ícones do app a partir da rosa do Rose (TWIRL em src/components/RoseEmblem.tsx, variação 4D-2).
Uso: python scripts/gen-icons.py  (precisa de playwright: pip install playwright && playwright install chromium)
Desenho: "flower-twirl" do Game Icons (Lorc, CC BY 3.0, game-icons.net)."""
import os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TWIRL = re.search(r"export const TWIRL = '([^']+)'", open(os.path.join(ROOT, "src", "components", "RoseEmblem.tsx"), encoding="utf-8").read()).group(1)
GRAD = '<linearGradient id="cr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a8a"/><stop offset=".55" stop-color="#d62f45"/><stop offset="1" stop-color="#8f1a2c"/></linearGradient>'


def rose(mono=False):
    """SVG 512x512 da rosa. mono = silhueta branca (badge de notificação do Android)."""
    if mono:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="{TWIRL}" fill="#fff"/></svg>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>{GRAD}</defs>'
            f'<path d="{TWIRL}" fill="#6e0f1f" transform="translate(-14 8)"/>'
            f'<path d="{TWIRL}" fill="#c3c6d0" opacity=".6" transform="translate(14 -8)"/>'
            f'<path d="{TWIRL}" fill="url(#cr)"/></svg>')


def tile(size, scale, bg=True):
    """Ícone quadrado: fundo grafite com brilho carmim e a rosa ocupando `scale` do lado."""
    glow = "radial-gradient(circle at 50% 50%, rgba(214,47,69,.45), rgba(214,47,69,.08) 55%, transparent 75%), #1b1b20" if bg else "transparent"
    e = size * scale
    return (f'<html><body style="margin:0;width:{size}px;height:{size}px;background:{glow};display:grid;place-items:center">'
            f'<div style="width:{e}px;height:{e}px">{rose(mono=not bg)}</div></body></html>')


PUB = os.path.join(ROOT, "public")
open(os.path.join(PUB, "favicon.svg"), "w", encoding="utf-8").write(rose())
OUT = [  # arquivo, tamanho, fração da rosa, com fundo
    ("icon-512.png", 512, 0.74, True),
    ("icon-192.png", 192, 0.74, True),
    ("icon.png", 256, 0.74, True),
    ("apple-touch-icon.png", 180, 0.68, True),  # o iOS arredonda os cantos: um pouco mais de respiro
    ("icon-maskable-512.png", 512, 0.56, True),  # zona segura do Android = círculo de 80%
    ("badge-96.png", 96, 0.9, False),
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
