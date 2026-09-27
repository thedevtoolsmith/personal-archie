"""Regenerable pixel-art assets, derived locally from the supplied portrait."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/build_mascot.py"
SOURCE = ROOT / "artwork/mascot/profile.png"


class MascotArtTests(unittest.TestCase):
    def build(self, output):
        self.assertTrue(GENERATOR.exists(), "The portrait-to-pixel generator is not implemented")
        self.assertTrue(SOURCE.exists(), "Keep a local source portrait so the artwork can be regenerated")
        subprocess.run([sys.executable, str(GENERATOR), str(SOURCE), "--output", str(output)], check=True)

    def test_portrait_is_pixel_art_with_real_transparency(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.build(output)
            image = Image.open(output / "surya-directions.png").convert("RGBA").crop((96, 112, 192, 224))
            self.assertEqual(image.size, (96, 112))
            self.assertEqual(image.getchannel("A").getpixel((0, 0)), 0)
            self.assertEqual(image.getchannel("A").getpixel((48, 24)), 255, "The face must not be keyed out with the background")
            colors = image.getcolors(1000)
            assert colors is not None
            self.assertLessEqual(len(colors), 6, "Use a deliberate small pixel-art palette")
            self.assertEqual(image, image.resize((48, 56), Image.Resampling.NEAREST).resize((96, 112), Image.Resampling.NEAREST))

    def test_directions_are_nine_distinct_aligned_poses(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.build(output)
            path = output / "surya-directions.png"
            self.assertTrue(path.exists(), "Directional sprite sheet has not been built")
            sheet = Image.open(path).convert("RGBA")
            self.assertEqual(sheet.size, (288, 336))
            cells = [sheet.crop((x * 96, y * 112, (x + 1) * 96, (y + 1) * 112)) for y in range(3) for x in range(3)]
            self.assertEqual(len({cell.tobytes() for cell in cells}), 9)
            self.assertEqual(len({cell.crop((0, 100, 96, 112)).tobytes() for cell in cells}), 1, "The chin anchor must not jump between directions")

    def test_direction_tracking_changes_only_the_eyes(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.build(output)
            sheet = Image.open(output / 'surya-directions.png').convert('RGBA')
            frames = []
            for row in range(3):
                for column in range(3):
                    frame = sheet.crop((column * 96, row * 112, (column + 1) * 96, (row + 1) * 112))
                    # Erase the two lens interiors, then compare everything else.
                    frame.paste((0, 0, 0, 0), (26, 36, 38, 46))
                    frame.paste((0, 0, 0, 0), (56, 36, 68, 46))
                    frames.append(frame.tobytes())
            self.assertEqual(len(set(frames)), 1, 'The whole head, glasses and beard must stay still; only pupils track')

    def test_original_spectacle_frames_are_preserved_in_every_export(self):
        crop = Image.open(SOURCE).convert('RGB').crop((132, 40, 1100, 1298)).resize((40, 52), Image.Resampling.BOX)
        reference = Image.new('RGBA', (48, 56), (0, 0, 0, 0))
        for y in range(52):
            for x in range(40):
                pixel = crop.getpixel((x, y))
                assert isinstance(pixel, tuple)
                value = sum(pixel) / 3
                color = (35, 35, 51, 255) if value < 105 else (115, 115, 130, 255) if value < 200 else (245, 245, 245, 255)
                reference.putpixel((x + 4, y + 2), color)
        for point in ((4, 2), (43, 2), (4, 53), (43, 53)):
            ImageDraw.floodfill(reference, point, (0, 0, 0, 0))
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.build(output)
            frames = []
            for name in ("surya-directions.png", "surya-reactions.png"):
                sheet = Image.open(output / name).convert("RGBA")
                frames.extend(sheet.crop((x * 96, y * 112, (x + 1) * 96, (y + 1) * 112))
                              for y in range(3) for x in range(3))
            for index, frame in enumerate(frames):
                with self.subTest(frame=index):
                    native = frame.resize((48, 56), Image.Resampling.NEAREST)
                    for left in (10, 26):
                        for y in range(14, 27):
                            for x in range(left, left + 14):
                                if 18 <= y <= 22 and (13 <= x <= 18 or 28 <= x <= 33):
                                    continue  # Only these lens interiors may be repainted.
                                self.assertEqual(native.getpixel((x, y)), reference.getpixel((x, y)),
                                                 f'Original portrait-style frame changed at {(x, y)}')

    def test_reactions_are_nine_distinct_aligned_expressions(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.build(output)
            path = output / "surya-reactions.png"
            self.assertTrue(path.exists(), "Expression sprite sheet has not been built")
            sheet = Image.open(path).convert("RGBA")
            self.assertEqual(sheet.size, (288, 336))
            cells = [sheet.crop((x * 96, y * 112, (x + 1) * 96, (y + 1) * 112)) for y in range(3) for x in range(3)]
            self.assertEqual(len({cell.tobytes() for cell in cells}), 9)
            center = Image.open(output / "surya-directions.png").convert("RGBA").crop((96, 112, 192, 224))
            for cell in cells:
                self.assertEqual(cell.crop((0, 100, 96, 112)).tobytes(), center.crop((0, 100, 96, 112)).tobytes())
                self.assertEqual(cell.getchannel("A").getextrema(), (0, 255))
                self.assertEqual(cell, cell.resize((48, 56), Image.Resampling.NEAREST).resize((96, 112), Image.Resampling.NEAREST))

    def test_terminal_stamp_has_a_closed_mouth_and_aligned_animation(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            source = ROOT / "artwork/mascot/terminal-stamp-source.png"
            generator = ROOT / "scripts/build_terminal_stamp_mascot.py"
            subprocess.run([sys.executable, str(generator), str(source), "--output", str(output)], check=True)
            directions = Image.open(output / "surya-terminal-stamp-directions.png").convert("RGBA")
            portrait = directions.crop((96, 112, 192, 224))
            self.assertEqual(portrait.size, (96, 112))
            native = portrait.resize((48, 56), Image.Resampling.NEAREST)
            self.assertNotIn((245, 245, 245, 255), native.crop((18, 37, 32, 44)).getdata(),
                             "The closed mouth must not render as bright teeth at website size")
            blink = Image.open(output / "surya-terminal-stamp-blink.png").convert("RGBA")
            self.assertEqual(directions.size, (288, 336))
            self.assertEqual(blink.size, (96, 112))
            self.assertNotEqual(blink.crop((30, 38, 72, 50)).tobytes(), portrait.crop((30, 38, 72, 50)).tobytes())
            self.assertEqual(blink.crop((0, 60, 96, 112)).tobytes(), portrait.crop((0, 60, 96, 112)).tobytes())
            self.assertEqual(len({directions.crop((x * 96, y * 112, (x + 1) * 96, (y + 1) * 112)).tobytes()
                                  for y in range(3) for x in range(3)}), 9)


if __name__ == "__main__":
    unittest.main()
