# Personal Archie

My [Archie](https://github.com/athul/archie) theme fork for the personal blog.
This repository owns the theme's layouts, styles, scripts, icons, mascot artwork,
generated assets, and tests. Site content and configuration live
in the host Hugo repository.

The theme defaults to a toggleable light/dark mode, the bundled favicon, and
the terminal-stamp mascot. A host site can still override those defaults through
its `params` if needed.

## Corner mascot and Asteroids

The custom Archie theme includes a fixed bottom-left portrait companion, with
safe-area spacing and a smaller mobile portrait. Its toggleable bubble sits
above it, with solid stepped pixel edging and a
subtle pixel-paper surface; long messages scroll inside a bounded bubble. The normal header,
site title, navigation, RSS link and theme toggle remain intact.
No React, npm dependencies or client framework are required.

The active portrait is the terminal stamp by default. To restore the previous
portrait, set `params.mascotStyle: original` in the host site's config. Both
sprite sets remain in `static/mascots/`; the setting selects the portrait and
its matching blink animation across every page. The terminal stamp has only a
blink image; its unused expressions are not shipped.

### Per-page messages (Asteroids invitation by default)

Without a message, the bubble says **wanna see something cool?**. Clicking that
invitation starts the existing text Asteroids game. There is no separate
Asteroids button. Clicking the portrait itself only hides or shows the bubble.

To replace the invitation and disable the game on a page, add a **top-level
string** to that page's front matter. This is an example, not a published message:

```yaml
---
title: My page
mascot_message: "A short note specifically for this page."
---
```

Only `mascot_message` is supported, not `mascot.message`. Leading and trailing
whitespace is trimmed. Missing, blank, whitespace-only or non-string values
use the Asteroids invitation. A nonempty message is escaped plain text, not HTML
or Markdown, and appears on page entry, including without JavaScript. These
message pages have no game launcher or game keyboard listeners, even after
the message is dismissed. JavaScript types the existing message one grapheme
at a time (35 ms each); it never generates new speech. The box starts small and
grows with the visible text, capped at the responsive width and height limits.
The completed message stays for **5 seconds** by default, then the bubble hides.
Set `params.mascotMessageDurationSeconds` in the host site's config to change
that time (for example, `mascotMessageDurationSeconds: 8`). The value is a
positive number of seconds; missing or invalid values fall back to 5 seconds.
The countdown starts only after the last character. Reopening retypes the
message and starts a fresh countdown after completion.

With JavaScript, clicking the portrait toggles either bubble. There is no ×
button and no click reaction. Escape hides the bubble **only while a mascot control has focus**;
navigation/article focus is unaffected. Focus returns to the portrait if its
bubble's focused control is hidden. `aria-expanded` reports the toggle state.
Back/forward-cache restoration preserves visibility; a fresh page load shows
the bubble again.

On invitation pages, Enter/Space with the invitation focused, or Alt+Shift+A,
also starts the game. The mascot
is hidden and excluded from the game's text capture during play. Exit/Escape
restores the page and launcher focus. Message pages cannot launch via the shortcut.

### Interaction and accessibility

- A fine, hover-capable pointer selects eight pupil directions plus a center
  dead zone. The head, glasses and beard stay stationary; only the eyes track.
  Touch never tracks, including on hybrid devices.
- Click, tap, Enter or Space toggles the bubble with the native portrait button.
  There are no blink, expression, dizzy or squash reactions on activation.
- Dragging the portrait with a mouse, pen or touch pointer moves it anywhere
  inside the viewport. A six-pixel threshold separates a drag from the existing
  click/tap action. Focused users can move it in 12-pixel steps with the arrow
  keys, or 32-pixel steps with Shift+Arrow.
- When the portrait overlaps eligible headings, paragraphs, list items,
  descriptions, metadata, definition terms or figure captions, Pretext lays the
  text out into the open line slots on either side. Links and ordinary inline
  styling remain HTML. Blocks containing embedded media, controls, hard breaks
  or unsupported nested content stay in the browser's normal layout.
- Idle eyes blink briefly at irregular 4–9 second intervals, then return to
  their previous gaze. Pointer activity and clicks reset the idle interval.
- Leaving the viewport or blurring the window centers the eyes.
- `prefers-reduced-motion: reduce` disables gaze and blinking and shows the
  complete message immediately, followed by the configured reading time.
- A complete accessible text source remains available while a separate
  `aria-hidden` visual copy types; screen readers do not announce every letter.
- Timers pause while the page is hidden or the game is active. `pagehide` clears
  pending work and detaches listeners; persisted `pageshow` restores interaction
  without duplicates or reopening a hidden bubble.
- Without JavaScript the portrait stays visible but its button is disabled;
  the bubble remains readable and its game button stays disabled.

### Implementation and sprite contract

Theme files live in this repository:

- `layouts/partials/head.html`: restored body header followed by the mascot partial.
- `layouts/partials/header.html`: fingerprinted CSS and bundled JavaScript module.
- `layouts/partials/mascot.html`: portrait plus custom text or the game invitation.
- `assets/css/mascot.css`: scoped layout, pixel speech bubble, local Monocraft face.
- `static/images/mascot-bubble-{frame,tail,paper}.svg`: stepped frame, tail and pixel texture.
- `static/fonts/Monocraft.woff2`: self-hosted Monocraft, used only inside the bubble.
- `static/fonts/Monocraft-LICENSE.txt`: upstream SIL Open Font License and attribution.
- `assets/js/mascot.js`: event-driven interaction and lifecycle cleanup.
- `assets/js/mascot-flow.js`: Pretext-backed text-block discovery, measurement and line placement.
- `assets/vendor/pretext/`: vendored Pretext 0.0.9 runtime and MIT license.
- `static/licenses/pretext-LICENSE.txt`: published copy of Pretext's MIT license.
- `static/licenses/Phosphor-LICENSE.txt`: upstream MIT license for the icon subset.
- `assets/js/asteroids-loader.js`: loads the game code and stylesheet when the invitation or keyboard shortcut is used.
- `assets/js/asteroids.js`: existing game, initialized only with the invitation.

The CSS and JavaScript in the shared layout are minified by Hugo. The Phosphor
icon CSS and font contain only the icons configured for this site. Original
font sources are in `artwork/fonts/`. After changing a social icon in the host
site's config, rebuild the subset with:

```sh
.venv-mascot/bin/python -m pip install -r scripts/requirements-site-fonts.txt
.venv-mascot/bin/python scripts/build_site_fonts.py
```

The generated CSS and JavaScript filenames contain content hashes. For a
Cloudflare Pages deployment, `static/_headers` gives those assets a
long browser cache lifetime; HTML and unversioned images/fonts retain their
normal caching behavior.

There are no site-level layout overrides or customCSS configuration for this
feature. Because discovery runs against the shared `.content` shell, headings,
navigation, article text and footer links on current and future Hugo pages inherit
text wrapping without front-matter configuration. The
original server-rendered markup remains the no-JavaScript fallback. Sprite URLs
use Hugo `relURL`, including deployments under a subpath.
The static images belong to the theme:

| File under `static/mascots/` | Row-major frame order |
| --- | --- |
| `surya-terminal-stamp-directions.png` (active) | up-left, up, up-right, left, center, right, down-left, down, down-right |
| `surya-terminal-stamp-blink.png` (active) | one closed-eye frame |
| `surya-directions.png` (original) | up-left, up, up-right, left, center, right, down-left, down, down-right |
| `surya-reactions.png` (original) | blink, heart, sparkle, surprised, wink, bashful, sleepy, dizzy, delighted |

Each atlas is **288 × 336**, a 3 × 3 grid of **96 × 112** cells—not square
frames. The terminal blink image is one **96 × 112** frame. CSS uses
`image-rendering: pixelated`.
The button renders at 96 × 112 on desktop and 72 × 84 at widths up to 600 px.
The bubble uses self-hosted **Monocraft at 16px**, with the portrait's dark ink
(`#232333`) and light paper (`#f5f5f5`) in both site themes. A nine-slice SVG
border preserves pixel-stepped rounded corners at different text widths, with
a separate stepped speech tail pointing toward the portrait. Long messages
scroll inside `[data-mascot-bubble-body]`, leaving the frame and tail intact.
The article/header fonts are unchanged. The original Monocraft TTF and full
Phosphor font stay in `artwork/fonts/` as rebuild sources, with the Monocraft
SIL Open Font License published alongside the smaller WOFF2 font.
See [artwork/mascot/README.md](artwork/mascot/README.md) for portrait provenance
and sprite-generation instructions.

### Development checks

From the repository root, with Hugo and Node.js installed:

```sh
node --test tests/mascot*.test.mjs
hugo --source ../.. --destination /tmp/personal-blog-mascot-build
```

The Node suite has no package dependencies. It runs the shipped script with
small DOM/event/clock adapters and builds real Hugo sites in temporary
directories for nonempty, missing, whitespace, wrong-type, escaped and subpath
fixtures. Fixtures are never added to `website/content/`. CSS contract tests
complement browser checks; they do not claim to test browser layout or native
keyboard event synthesis.

For real-browser QA (optional authoring dependencies, not shipped to visitors):

```sh
python3 -m venv .venv-mascot
.venv-mascot/bin/python -m pip install -r tests/requirements-browser.txt
.venv-mascot/bin/python -m playwright install chromium
.venv-mascot/bin/python tests/test_mascot_browser.py
```

The build and browser suites expect this theme to be checked out under the host
site's `themes/archie/` directory. The browser suite uses an isolated Hugo copy,
loopback-only server and temporary
front-matter fixtures. It blocks the site's analytics and service worker during
tests. Screenshots are saved in `/tmp/mascot-browser-review/` (override with
`MASCOT_QA_OUTPUT`). It checks desktop/mobile layout, light/dark mode, no-JS,
reduced motion, native Enter/Space and touch, escaping, message-gated gameplay,
invitation launch/exit and focus restoration, bubble toggling, pointer dragging,
Pretext flow on both sides of the portrait, preserved links, long text, all gaze
directions, idle-blink preloading, real local Monocraft loading, pixel frame
and speech tail. Fake-clock browser checks verify typing, bounded box growth,
post-typing hide timing, idle blink and reduced-motion behavior. Subpath tests
verify the font, frame, tail and license ship.
The dark stylesheet
loads when first enabled, so tests wait for computed colors before sampling.

For manual QA, inspect `[data-page-mascot]`, `[data-mascot-button]`,
`[data-mascot-sprite]`, `[data-mascot-play]`, and `[data-mascot-message]`. The sprite exposes
`data-sheet` and `data-frame` while enhanced. A theme-colored, unblurred pixel
outline keeps the beard visible in dark mode; the portrait toggle exceeds a 44 × 44 px touch target.

All theme work, including tests and generated artwork, is committed in this
repository. A host site that uses Archie as a Git submodule updates its
submodule pointer separately.
