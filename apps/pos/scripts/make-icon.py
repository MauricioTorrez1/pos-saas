"""Draws the register icon (run: python scripts/make-icon.py resources): a crossed hammer and wrench on an orange tile, with a gold coin for the till."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
OUT = Path(sys.argv[1])
WHITE = (255, 255, 255, 255)
SHADOW = (120, 30, 0, 90)


def tile() -> Image.Image:
    gradient = Image.new('RGBA', (SIZE, SIZE))
    top, bottom = (255, 140, 26), (226, 59, 14)
    pixels = gradient.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2 * (SIZE - 1))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
    mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((24, 24, SIZE - 24, SIZE - 24), radius=220, fill=255)
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    base.paste(gradient, mask=mask)
    return base


def hammer(color) -> Image.Image:
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx = SIZE // 2
    draw.rounded_rectangle((cx - 42, 300, cx + 42, 860), radius=36, fill=color)  # handle
    draw.rounded_rectangle((cx - 230, 170, cx + 150, 330), radius=34, fill=color)  # head
    draw.polygon([(cx + 140, 190), (cx + 250, 215), (cx + 250, 250), (cx + 140, 300)], fill=color)  # claw
    return layer


def wrench(color) -> Image.Image:
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx = SIZE // 2
    draw.rounded_rectangle((cx - 40, 300, cx + 40, 860), radius=36, fill=color)  # handle
    draw.ellipse((cx - 150, 120, cx + 150, 420), fill=color)  # head
    draw.rectangle((cx - 55, 100, cx + 55, 260), fill=(0, 0, 0, 0))  # open jaw
    draw.ellipse((cx - 70, 820, cx + 70, 960), fill=color)  # ring end
    draw.ellipse((cx - 30, 860, cx + 30, 920), fill=(0, 0, 0, 0))
    return layer


def tools(color) -> Image.Image:
    combined = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    combined.alpha_composite(wrench(color).rotate(-45, resample=Image.BICUBIC, center=(SIZE / 2, SIZE / 2)))
    combined.alpha_composite(hammer(color).rotate(45, resample=Image.BICUBIC, center=(SIZE / 2, SIZE / 2)))
    return combined.resize((int(SIZE * 0.86), int(SIZE * 0.86)), Image.LANCZOS)


def coin() -> Image.Image:
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = (650, 650, 960, 960)
    draw.ellipse(box, fill=(255, 255, 255, 255))
    draw.ellipse((670, 670, 940, 940), fill=(255, 196, 0, 255))
    try:
        font = ImageFont.truetype('arialbd.ttf', 230)
    except OSError:
        font = ImageFont.load_default()
    draw.text((805, 805), '$', font=font, fill=(150, 70, 0, 255), anchor='mm')
    return layer


def main() -> None:
    icon = tile()
    offset = (int(SIZE * 0.08), int(SIZE * 0.04))
    icon.alpha_composite(tools(SHADOW), (offset[0] + 14, offset[1] + 18))
    icon.alpha_composite(tools(WHITE), offset)
    icon.alpha_composite(coin())
    OUT.mkdir(parents=True, exist_ok=True)
    icon.resize((512, 512), Image.LANCZOS).save(OUT / 'icon.png')
    icon.save(OUT / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == '__main__':
    main()
