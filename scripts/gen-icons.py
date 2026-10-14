"""Gera os ícones do app: foto da rosa (icon-source.png) para o app; rosa vetorial (TWIRL em RoseEmblem.tsx) para favicon e badge.
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
# ícones do app = foto da rosa na lapela (icon-source.png, 1254x1254), recortada em volta da flor
from PIL import Image
SRC = Image.open(os.path.join(ROOT, "icon-source.png")).convert("RGB")
CROP = (238, 135, 1138, 1035)      # rosa ocupa ~75% do quadro
CROP_MASK = (188, 85, 1188, 1085)  # Android corta num círculo de 80%: mais respiro
for name, size, box in [("icon-512.png", 512, CROP), ("icon-192.png", 192, CROP), ("icon.png", 256, CROP),
                        ("apple-touch-icon.png", 180, CROP), ("icon-maskable-512.png", 512, CROP_MASK)]:
    SRC.crop(box).resize((size, size), Image.LANCZOS).save(os.path.join(PUB, name), optimize=True)
    print("ok", name)

# aba do navegador (favicon.svg, acima) e notificação ficam no desenho vetorial: a foto vira borrão em 16 px
OUT = [("badge-96.png", 96, 0.9, False)]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, scale, bg in OUT:
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(tile(size, scale, bg))
        pg.screenshot(path=os.path.join(PUB, name), omit_background=not bg)
        pg.close()
        print("ok", name)
    b.close()
