#!/usr/bin/env python3
"""Convert the original illustration to aligned pixel sprites. No network or AI API.

Requires Pillow. Source stays outside Hugo's static directory and is never served.
Pixels are drawn at 48x56 and doubled without smoothing for crisp 96x112 cells.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = (48, 56)
INK = (35, 35, 51, 255)
SHADE = (115, 115, 130, 255)
PAPER = (245, 245, 245, 255)
CLEAR = (0, 0, 0, 0)


def portrait(source):
    # Crop the supplied head, not a generic substitute drawing. Pixel averages
    # retain the original bald silhouette, nose, mouth and beard texture.
    original = Image.open(source).convert("RGB")
    crop = original.crop((132, 40, 1100, 1298)).resize((40, 52), Image.Resampling.BOX)
    small = Image.new("RGBA", SIZE, CLEAR)
    for y in range(crop.height):
        for x in range(crop.width):
            pixel = crop.getpixel((x, y))
            assert isinstance(pixel, tuple)
            value = sum(pixel) / 3
            color = INK if value < 105 else SHADE if value < 200 else PAPER
            small.putpixel((x + 4, y + 2), color)
    # Flood only the paper touching the perimeter; white inside the face remains.
    for point in ((4, 2), (43, 2), (4, 53), (43, 53)):
        ImageDraw.floodfill(small, point, CLEAR)
    # Retain the original illustration's spectacle frames without redrawing them.
    return small


def eyes(image, dx=0, dy=0):
    """Repaint only the lens interiors; never move or overwrite the frames."""
    draw = ImageDraw.Draw(image)
    for left in (13, 28):
        draw.rectangle((left, 18, left + 5, 22), fill=PAPER)
        x, y = left + 2 + dx, 19 + dy
        draw.rectangle((x, y, x + 2, y + 2), fill=INK)
        draw.point((x + 1, y), fill=PAPER)
    return image


def direction(base, dx, dy):
    # Keep the complete head and beard stationary; only the pupils follow gaze.
    return eyes(base.copy(), dx, dy)


def expression(base, name):
    image = eyes(base.copy())
    draw = ImageDraw.Draw(image)
    rose = (205, 80, 110, 255)
    gold = (189, 128, 34, 255)

    def symbol(x, y, rows, color=INK):
        for sy, row in enumerate(rows):
            for sx, value in enumerate(row):
                if value == "#":
                    draw.point((x + sx, y + sy), fill=color)

    def clear_eye(left):
        draw.rectangle((left, 18, left + 5, 22), fill=PAPER)

    for left in (13, 28):
        clear_eye(left)
        if name == "blink" or (name == "wink" and left == 28):
            draw.line(((left, 20), (left + 1, 21), (left + 4, 21), (left + 5, 20)), fill=INK)
        elif name == "heart":
            symbol(left + 1, 18, ("##.##", "#####", "#####", ".###.", "..#.."), rose)
        elif name == "sparkle":
            symbol(left + 1, 18, ("..#..", ".###.", "#####", ".###.", "..#.."), gold)
        elif name == "dizzy":
            symbol(left + 1, 18, ("#####", "....#", "###.#", "#...#", "#####"))
        elif name == "delighted":
            draw.line(((left, 21), (left + 2, 19), (left + 3, 19), (left + 5, 21)), fill=INK)
        elif name == "sleepy":
            draw.line((left + 1, 21, left + 4, 21), fill=INK)
        else:
            y = 20 if name == "bashful" else 18 if name == "surprised" else 19
            draw.rectangle((left + 2, y, left + 4, 22), fill=INK)
            draw.point((left + 3, y), fill=PAPER)
    if name in ("bashful", "heart", "delighted"):
        for x in (11, 33):
            draw.rectangle((x, 27, x + 2, 28), fill=rose)
    if name == "surprised":
        draw.ellipse((21, 35, 29, 42), fill=PAPER)
        draw.ellipse((23, 36, 27, 40), fill=INK)
    elif name == "delighted":
        draw.rectangle((19, 36, 30, 41), fill=INK)
        draw.line(((20, 37), (22, 40), (27, 40), (29, 37)), fill=PAPER)
        draw.line((21, 37, 28, 37), fill=PAPER)
    if name == "sleepy":
        symbol(36, 3, ("#####", "...#.", "..#..", ".#...", "#####"), SHADE)
    elif name in ("sparkle", "dizzy"):
        for x, y in ((5, 7), (40, 5)):
            symbol(x, y, ("..#..", "..#..", "#####", "..#..", "..#.."), gold)
    elif name == "heart":
        symbol(38, 5, ("##.##", "#####", ".###.", "..#.."), rose)
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
    cells = [direction(base, dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    save_sheet(cells, args.output / "surya-directions.png")
    names = ("blink", "heart", "sparkle", "surprised", "wink", "bashful", "sleepy", "dizzy", "delighted")
    save_sheet([expression(base, name) for name in names], args.output / "surya-reactions.png")
    print(f"Built pixel portrait, nine directions and nine reactions in {args.output}")


if __name__ == "__main__":
    main()
