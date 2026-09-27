#!/usr/bin/env python3
"""Build the optional terminal-stamp mascot atlases from the generated source."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


SIZE = (48, 56)
INK = (35, 35, 51, 255)
SHADE = (115, 115, 130, 255)
PAPER = (245, 245, 245, 255)
CLEAR = (0, 0, 0, 0)
LENSES = ((16, 19, 23, 24), (29, 19, 36, 24))


def portrait(source):
    original = Image.open(source).convert("RGBA")
    alpha_box = original.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError("terminal-stamp source must have a transparent exterior")
    cropped = original.crop(alpha_box)
    cropped.thumbnail((44, 52), Image.Resampling.BOX)
    small = Image.new("RGBA", SIZE, CLEAR)
    offset = ((SIZE[0] - cropped.width) // 2, (SIZE[1] - cropped.height) // 2)
    small.alpha_composite(cropped, offset)

    # Collapse generation-time antialiasing into the blog's three-color stamp.
    for y in range(SIZE[1]):
        for x in range(SIZE[0]):
            red, green, blue, alpha = small.getpixel((x, y))
            if alpha < 96:
                color = CLEAR
            else:
                lightness = (red + green + blue) / 3
                color = INK if lightness < 85 else SHADE if lightness < 205 else PAPER
            small.putpixel((x, y), color)
    # The source has a light patch around the closed mouth. At 96px that patch
    # reads like teeth, so reduce it to a single closed lip mark in the beard.
    draw = ImageDraw.Draw(small)
    draw.rectangle((18, 37, 31, 43), fill=INK)
    draw.line((21, 38, 28, 38), fill=SHADE)
    return small


def eyes(image, dx=0, dy=0):
    draw = ImageDraw.Draw(image)
    for left, top, right, bottom in LENSES:
        draw.rectangle((left, top, right, bottom), fill=PAPER)
        x = (left + right) // 2 - 1 + dx
        y = (top + bottom) // 2 - 1 + dy
        draw.rectangle((x, y, x + 2, y + 2), fill=INK)
        draw.point((x + 1, y), fill=PAPER)
    return image


def direction(base, dx, dy):
    return eyes(base.copy(), dx, dy)


def blink(base):
    image = eyes(base.copy())
    draw = ImageDraw.Draw(image)
    for left, top, right, bottom in LENSES:
        draw.rectangle((left, top, right, bottom), fill=PAPER)
        draw.line(((left, top + 2), (left + 2, top + 3), (right - 2, top + 3), (right, top + 2)), fill=INK)
    return image


def save_sheet(cells, path):
    sheet = Image.new("RGBA", (144, 168), CLEAR)
    for index, image in enumerate(cells):
        sheet.paste(image, ((index % 3) * 48, (index // 3) * 56))
    sheet.resize((288, 336), Image.Resampling.NEAREST).save(path, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "static/mascots")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    base = portrait(args.source)
    stem = "surya-terminal-stamp"
    directions = [direction(base, dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    save_sheet(directions, args.output / f"{stem}-directions.png")
    blink(base).resize((96, 112), Image.Resampling.NEAREST).save(args.output / f"{stem}-blink.png", optimize=True)
    print(f"Built terminal-stamp directions and blink in {args.output}")


if __name__ == "__main__":
    main()
