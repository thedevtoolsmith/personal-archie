# Surya's pixel mascot

These sprites are a **local pixel-art adaptation of `profile.png`**, not an AI-generated substitute portrait. The supplied drawing's bald silhouette, beard, nose, mouth, and original portrait-style spectacles are retained. The glasses are not redrawn into new geometric frames or mirrored; only their lens interiors are repainted for gaze and reactions. The source portrait is not modified.

Directional tracking moves **only the pupils inside the lenses**. The whole head, frames, nose, mouth, and beard stay pixel-identical across all nine directions; there is no partial-head warp. Reactions repaint eyes and selected expression details on the same fixed head. This is 2D sprite animation, not a 3D model.

The source portrait is deliberately outside `static/`: Hugo publishes only the finished sprites, not the full-resolution source.

## Rebuild

From the repository root, using Python 3.9 or newer:

```sh
python3 -m venv .venv-mascot
.venv-mascot/bin/python -m pip install -r scripts/requirements-mascot.txt
.venv-mascot/bin/python scripts/build_mascot.py artwork/mascot/profile.png
.venv-mascot/bin/python -m unittest discover -s tests -p test_mascot_art.py -v
```

Python and Pillow are authoring tools only; the website does not use either at runtime. Generating these sprites requires no API key, and displaying the exported PNGs requires no React or animation library.

The crop, frame, and eye coordinates in `scripts/build_mascot.py` are deliberately calibrated to this supplied illustration. Lens interiors occupy native x=13–18 and x=28–33, y=18–22. Pupils move one native pixel in each direction without crossing the original frames. Regression tests mask only these interiors to verify eye-only tracking, and compare frame pixels with the original downsampled illustration across both atlases. To replace the portrait with a different composition, recalibrate those landmarks rather than simply swapping the source file.

## Asset contract

- Native drawing grid: **48 × 56**; exported at an exact 2× nearest-neighbor scale.
- Frame: **96 × 112** (not square).
- Atlas: **288 × 336**, three columns and three rows.
- `surya-directions.png`: up-left, up, up-right / left, center, right / down-left, down, down-right.
- `surya-reactions.png`: blink, heart, sparkle / surprised, wink, bashful / sleepy, dizzy, delighted.
- The center-facing portrait is the middle frame of the directions atlas.
- Transparent exterior, opaque face; no false checkerboard or white background rectangle.

The small neutral palette is taken from Archie (`#232333`, `#f5f5f5`, muted gray), with restrained rose and gold reaction pixels. The pixel-rounded speech bubble uses the same ink/paper colors and the supplied Monocraft font in both light and dark mode. The sprite outline follows the site theme so the beard stays visible.

## Terminal stamp variant

`terminal-stamp-source.png` is an AI-generated style edit of the local portrait.
It keeps the bald head, beard, nose and asymmetric spectacles, using a sparse
terminal-print palette. The visible smile was revised to a closed mouth with no
teeth. The source stays outside Hugo's published static directory.

To rebuild its sprite sheets:

```sh
.venv-mascot/bin/python scripts/build_terminal_stamp_mascot.py artwork/mascot/terminal-stamp-source.png
```

This exports `surya-terminal-stamp-directions.png` and
`surya-terminal-stamp-blink.png` to `static/mascots/`. The build reduces the source to a 48 × 56 grid,
removes the bright mouth patch at that size, and keeps the head still while
only pupils move or blink. The original `surya-*.png` files and their build
script remain separate. The theme defaults to `terminal-stamp`; set the host
site's `params.mascotStyle` to `original` to switch back.

The source was produced with the built-in image generation tool. The final
edit prompt was: “Remove all visible teeth and replace the open toothy smile
with a subtle closed-mouth expression drawn as a short, calm pixel line.
Change only the mouth. Keep the same identity, bald head, face geometry, nose,
beard, asymmetric rectangular-and-round glasses, eyes, pose, pixel grid,
palette, hard edges, and transparent background.”
