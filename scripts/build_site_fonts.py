"""Build the small, self-hosted fonts used by the site.

Run after changing a social icon in the host site's config. Requires fonttools[woff].
The original font files stay in artwork/fonts for reversible rebuilds.
"""

from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artwork" / "fonts"
SITE_CONFIG = ROOT.parents[1] / "config.yml"
DEFAULT_ICONS = {
    "at", "butterfly", "envelope", "eyeglasses", "github-logo",
    "linkedin-logo", "rss-simple", "sunglasses", "twitter-logo",
}


def build_icons():
    source_css = (SOURCE / "Phosphor-Bold.css").read_text()
    names = set(DEFAULT_ICONS)
    if SITE_CONFIG.exists():
        config = SITE_CONFIG.read_text()
        names.update(re.findall(r'^\s+icon:\s+["\']?([\w-]+)', config, re.M))
    mappings = dict(re.findall(
        r"\.ph-bold\.ph-([\w-]+):before\s*\{\s*content:\s*\"\\([0-9a-f]+)\";",
        source_css,
    ))
    missing = names - mappings.keys()
    if missing:
        raise ValueError(f"Unknown Phosphor icons: {', '.join(sorted(missing))}")

    options = subset.Options()
    options.flavor = "woff2"
    options.recalc_timestamp = False
    font = TTFont(SOURCE / "Phosphor-Bold.woff2", recalcTimestamp=False)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=[int(mappings[name], 16) for name in names])
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(ROOT / "static/icons/Phosphor-Bold.woff2")

    rules = [
        '@font-face { font-family: "Phosphor-Bold"; '
        'src: url("../icons/Phosphor-Bold.woff2") format("woff2"); '
        'font-weight: normal; font-style: normal; font-display: block; }',
        '.ph-bold { font-family: "Phosphor-Bold" !important; speak: never; '
        'font-style: normal; font-weight: normal; font-variant: normal; '
        'font-size: 17px; -webkit-font-smoothing: antialiased; }',
    ]
    rules.extend(
        f'.ph-bold.ph-{name}:before {{ content: "\\{mappings[name]}"; }}'
        for name in sorted(names)
    )
    (ROOT / "assets/css/icons.css").write_text("\n".join(rules) + "\n")


def build_monocraft():
    font = TTFont(SOURCE / "Monocraft.ttf", recalcTimestamp=False)
    font.flavor = "woff2"
    font.save(ROOT / "static/fonts/Monocraft.woff2")


if __name__ == "__main__":
    build_icons()
    build_monocraft()
