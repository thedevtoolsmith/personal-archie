"""Real-browser checks. Requires Hugo, Pillow-independent Playwright + Chromium.

Builds an isolated copy and serves it on a loopback-only ephemeral port. No test
content or messages are added to the user's website. Screenshots are kept in
MASCOT_QA_OUTPUT (default /tmp/mascot-browser-review).
"""
from functools import partial
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT.parents[1]
SHOTS = Path(os.environ.get("MASCOT_QA_OUTPUT", "/tmp/mascot-browser-review"))
MESSAGE = 'A little note from this page’s front matter. <b>Plain text, not HTML.</b>'
FLOW_TEXT = ('Pretext keeps this paragraph readable while the mascot moves through it. '
             'The words should occupy the open space on both sides, and this example '
             'contains a working link plus enough copy to cover several lines. ') * 3


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


class MascotBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="mascot-browser-")
        root = Path(cls.temp.name)
        source = root / "site"
        shutil.copytree(SITE, source, ignore=shutil.ignore_patterns(".git", ".entire", ".codex", "public", "resources", ".hugo_build.lock"))
        config_path = source / "config.yml"
        config = config_path.read_text(encoding="utf8")
        config = config.replace("  mascotStyle: original", "  mascotStyle: terminal-stamp")
        config_path.write_text(config, encoding="utf8")
        for name, text in (("speak", MESSAGE), ("blank", "  \n\t"), ("long", "Long message. " * 60)):
            (source / "content" / f"mascot-qa-{name}.md").write_text(
                f'---\ntitle: Mascot preview\nmascot_message: {json.dumps(text)}\n---\nThis page exists only in the temporary browser-test build.\n', encoding="utf8")
        (source / "content" / "mascot-qa-flow.md").write_text(
            '---\ntitle: Mascot flow preview\nmascot_message: "Drag me"\n---\n'
            + FLOW_TEXT.replace('working link', '[working link](https://example.test/flow-link)', 1)
            + '\n', encoding='utf8')
        cls.output = root / "public"
        subprocess.run(["hugo", "--source", str(source), "--destination", str(cls.output), "--baseURL", "http://localhost/"], check=True, capture_output=True)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(cls.output)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        SHOTS.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        # Block existing analytics, never send test page views to the live site.
        self.context.route("**/cloud.umami.is/**", lambda route: route.abort())
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "Browser JavaScript exceptions")

    def visit(self, path="/"):
        self.page.goto(self.url + path)
        expect(self.page.locator("[data-mascot-button]")).to_be_enabled()
        self.page.evaluate("document.fonts.ready")

    def test_mascot_toggles_bubble_without_any_click_reaction(self):
        for path in ('/', '/mascot-qa-speak/'):
            self.visit(path)
            button = self.page.locator('[data-mascot-button]')
            bubble = self.page.locator('[data-mascot-bubble]')
            sprite = self.page.locator('[data-mascot-sprite]')
            self.assertEqual(self.page.locator('[data-mascot-dismiss]').count(), 0)
            expect(button).to_have_attribute('aria-expanded', 'true')
            expect(button).to_have_attribute('aria-controls', 'mascot-bubble')
            for activation in ('click', 'Enter', ' ', 'click'):
                visible = bubble.is_visible()
                if activation == 'click':
                    button.click()
                else:
                    button.press(activation)
                expect(bubble).to_be_hidden() if visible else expect(bubble).to_be_visible()
                expect(button).to_have_attribute('aria-expanded', str(not visible).lower())
                expect(sprite).to_have_attribute('data-sheet', 'directions')
                self.assertEqual(sprite.evaluate('el => getComputedStyle(el).animationName'), 'none')
            self.page.wait_for_timeout(130)
            expect(sprite).to_have_attribute('data-sheet', 'directions')
            self.assertFalse(self.page.locator('html').evaluate("el => el.classList.contains('text-asteroids-active')"))

    def test_invitation_replaces_launcher_and_starts_real_asteroids(self):
        self.visit()
        self.assertEqual(self.page.locator('[data-mascot-play]').count(), 1, 'Missing messages offer the game')
        play = self.page.locator('[data-mascot-play]')
        expect(play.locator('[data-mascot-full-text]')).to_have_text('wanna see something cool?')
        expect(play).to_have_accessible_name('Play Asteroids with the visible text on this page')
        expect(play).to_be_enabled()
        self.assertEqual(self.page.locator('.text-asteroids-launcher').count(), 0)
        play.click()
        self.page.wait_for_function("document.documentElement.classList.contains('text-asteroids-active')")
        canvas = self.page.locator('.text-asteroids-canvas')
        self.assertGreater(int(canvas.get_attribute('data-remaining')), 0, 'The real game captured page glyphs')
        expect(self.page.locator('[data-page-mascot]')).to_be_hidden()
        self.page.screenshot(path=str(SHOTS / 'asteroids-from-mascot.png'))
        self.page.locator('.text-asteroids-exit').click()
        expect(play).to_be_visible()
        expect(play).to_be_focused()
        play.press('Enter')
        self.page.wait_for_function("document.documentElement.classList.contains('text-asteroids-active')")
        self.page.keyboard.press('Escape')
        expect(self.page.locator('.text-asteroids-game')).to_be_hidden()
        expect(play).to_be_focused()
        self.assertFalse(self.page.locator('.content').evaluate('el => el.inert'))

    def test_bubble_uses_supplied_monocraft_font_without_changing_article_font(self):
        for path, text_selector in (('/', '[data-mascot-play]'), ('/mascot-qa-speak/', '[data-mascot-message]')):
            self.visit(path)
            family = self.page.locator(text_selector).evaluate('el => getComputedStyle(el).fontFamily')
            self.assertIn('monocraft', family.lower())
            self.assertTrue(self.page.evaluate("Array.from(document.fonts).some(font => font.family.toLowerCase() === 'monocraft' && font.status === 'loaded')"), 'The actual local font must load, not just a fallback')
            self.assertNotIn('Monocraft', self.page.locator('main').first.evaluate('el => getComputedStyle(el).fontFamily'))
            resources = self.page.evaluate("performance.getEntriesByType('resource').map(entry => entry.name)")
            self.assertTrue(any(url.endswith('/fonts/Monocraft.woff2') and url.startswith(self.url) for url in resources))

    def test_game_assets_load_only_when_started(self):
        self.visit()
        resources = self.page.evaluate("performance.getEntriesByType('resource').map(entry => entry.name)")
        self.assertFalse(any('/js/asteroids.min.' in url or '/css/asteroids.min.' in url for url in resources))
        self.page.locator('[data-mascot-play]').click()
        self.page.wait_for_function("document.documentElement.classList.contains('text-asteroids-active')")
        resources = self.page.evaluate("performance.getEntriesByType('resource').map(entry => entry.name)")
        self.assertTrue(any('/js/asteroids.min.' in url for url in resources))
        self.assertTrue(any('/css/asteroids.min.' in url for url in resources))

    def test_game_shortcut_loads_assets_on_first_use(self):
        self.visit()
        self.page.keyboard.press('Alt+Shift+A')
        self.page.wait_for_function("document.documentElement.classList.contains('text-asteroids-active')")
        self.assertGreater(int(self.page.locator('.text-asteroids-canvas').get_attribute('data-remaining')), 0)

    def test_successful_game_launches_track_umami_once_each(self):
        self.page.add_init_script("window.trackedEvents = []; window.umami = { track: name => trackedEvents.push(name) };")
        self.visit()
        self.page.locator('[data-mascot-play]').click()
        self.page.wait_for_function("trackedEvents.length === 1")
        self.assertEqual(self.page.evaluate('trackedEvents'), ['asteroids-start'])
        self.page.locator('.text-asteroids-exit').click()
        self.page.keyboard.press('Alt+Shift+A')
        self.page.wait_for_function("trackedEvents.length === 2")
        self.assertEqual(self.page.evaluate('trackedEvents'), ['asteroids-start', 'asteroids-start'])

    def test_site_icons_and_theme_switch_remain_accessible(self):
        self.visit()
        self.assertEqual(self.page.locator('html').get_attribute('lang'), 'en')
        toggle = self.page.locator('#dark-mode-toggle')
        expect(toggle).to_have_accessible_name('Switch to dark mode')
        icon = self.page.locator('.soc .ph-rss-simple')
        self.assertNotEqual(icon.evaluate("el => getComputedStyle(el, '::before').content"), 'none')
        self.assertTrue(self.page.evaluate("Array.from(document.fonts).some(font => font.family.toLowerCase() === 'phosphor-bold' && font.status === 'loaded')"))
        toggle.click()
        expect(toggle).to_have_accessible_name('Switch to light mode')
        self.assertEqual(self.page.locator('.pagination > li').count(), 2)

    def test_front_matter_message_disables_game_including_shortcut(self):
        self.visit('/mascot-qa-speak/')
        self.assertEqual(self.page.locator('[data-mascot-play], .text-asteroids-launcher, .text-asteroids-game').count(), 0)
        self.page.locator('[data-mascot-message]').click()
        self.page.locator('[data-mascot-button]').click()
        self.page.keyboard.press('Alt+Shift+A')
        self.page.wait_for_timeout(200)
        self.assertFalse(self.page.evaluate("document.documentElement.classList.contains('text-asteroids-active')"))
        self.assertEqual(self.page.locator('.text-asteroids-game').count(), 0)

    def test_bubble_has_pixel_rounded_frame_and_speech_tail(self):
        self.visit('/mascot-qa-speak/')
        bubble = self.page.locator('[data-mascot-bubble]')
        frame = bubble.evaluate('el => getComputedStyle(el).borderImageSource')
        self.assertIn('mascot-bubble-frame.svg', frame)
        self.assertEqual(bubble.evaluate('el => getComputedStyle(el).borderRadius'), '0px', 'Rounding is drawn as pixel steps, not a smooth CSS curve')
        self.assertEqual(bubble.evaluate('el => getComputedStyle(el).color'), 'rgb(35, 35, 51)')
        tail = bubble.evaluate("el => ({image: getComputedStyle(el, '::after').backgroundImage, bottom: getComputedStyle(el, '::after').bottom})")
        self.assertIn('mascot-bubble-tail.svg', tail['image'])
        self.assertLess(float(tail['bottom'].removesuffix('px')), 0, 'Speech tail extends downward toward the portrait')

    def test_pixel_accent_matches_site_link_underlines_in_both_themes(self):
        self.visit()
        bubble = self.page.locator('[data-mascot-bubble]')
        play = self.page.locator('[data-mascot-play]')
        colors = []
        for dark in (False, True):
            if dark:
                self.page.locator('#dark-mode-toggle').click()
                self.page.wait_for_function("getComputedStyle(document.body).backgroundColor === 'rgb(40, 42, 54)'")
            accent = self.page.locator('header .main a').evaluate('el => getComputedStyle(el).borderBottomColor')
            colors.append(accent)
            self.assertIn(accent, bubble.evaluate('el => getComputedStyle(el).filter'))
            play.hover()
            self.assertEqual(play.evaluate('el => getComputedStyle(el).textDecorationColor'), accent)
            self.assertEqual(play.evaluate('el => getComputedStyle(el).textDecorationThickness'), '3px')
            self.page.screenshot(path=str(SHOTS / ('accent-dark.png' if dark else 'accent-light.png')))
        self.assertNotEqual(colors[0], colors[1], 'The bubble follows the theme switch, not a hardcoded accent')

    def test_pixel_treatment_covers_edges_and_bubble_surface(self):
        self.visit()
        frame = self.page.locator('[data-mascot-bubble]')
        self.assertEqual(frame.evaluate('el => getComputedStyle(el).borderImageRepeat'), 'stretch', 'Keep the ink outline continuous rather than checker-like')
        self.assertIn('4px 4px 0px', frame.evaluate('el => getComputedStyle(el).filter'), 'Pixel shadow is offset by a whole block with no blur')

        body = self.page.locator('[data-mascot-bubble-body]')
        self.assertIn('mascot-bubble-paper.svg', body.evaluate('el => getComputedStyle(el).backgroundImage'))
        self.assertEqual(body.evaluate('el => getComputedStyle(el).backgroundSize'), '8px 8px')

    def test_escape_dismisses_focused_invitation_without_starting_game(self):
        self.visit()
        self.page.locator('[data-mascot-play]').focus()
        self.page.keyboard.press('Escape')
        expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()
        expect(self.page.locator('[data-mascot-button]')).to_be_focused()
        expect(self.page.locator('.text-asteroids-game')).to_be_hidden()

    def test_long_bubble_can_be_hidden_and_reopened_from_portrait(self):
        for width in (320, 390, 1280):
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.visit('/mascot-qa-long/')
            button = self.page.locator('[data-mascot-button]')
            before = button.bounding_box()
            button.click()
            expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()
            self.assertEqual(button.bounding_box(), before, 'Portrait must not jump when toggled')
            button.click()
            expect(self.page.locator('[data-mascot-bubble]')).to_be_visible()

    def test_mascot_is_fixed_bottom_left_outside_the_header(self):
        self.visit('/mascot-qa-speak/')
        mascot = self.page.locator('[data-page-mascot]')
        self.assertEqual(mascot.evaluate('el => getComputedStyle(el).position'), 'fixed')
        self.assertFalse(mascot.evaluate('el => !!el.closest("header")'))
        portrait = self.page.locator('[data-mascot-button]')
        before = portrait.bounding_box()
        self.assertLessEqual(before['x'], 32)
        self.assertLessEqual(900 - before['y'] - before['height'], 32)
        self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        self.assertEqual(portrait.bounding_box(), before, 'Portrait stays anchored while the box grows')

    def test_dragging_reflows_rich_paragraph_text_around_the_portrait(self):
        self.visit('/mascot-qa-flow/')
        button = self.page.locator('[data-mascot-button]')
        paragraph = self.page.locator('main .body p').first
        button.click()  # Keep the transient speech bubble out of the visual assertion.
        expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()
        original = paragraph.inner_text()
        target = paragraph.bounding_box()
        portrait = button.bounding_box()
        destination_x = target['x'] + target['width'] / 2
        destination_y = target['y'] + min(55, target['height'] / 2)

        self.page.mouse.move(portrait['x'] + portrait['width'] / 2, portrait['y'] + portrait['height'] / 2)
        self.page.mouse.down()
        self.page.mouse.move(destination_x, destination_y, steps=8)
        self.page.mouse.up()

        expect(self.page.locator('[data-page-mascot]')).to_have_attribute('data-mascot-positioned', 'true')
        expect(paragraph).to_have_attribute('data-mascot-flow', 'active')
        moved = button.bounding_box()
        lines = paragraph.locator('.mascot-flow-line')
        self.assertGreater(lines.count(), 3)
        band_lines = []
        for index in range(lines.count()):
            box = lines.nth(index).bounding_box()
            if box['y'] < moved['y'] + moved['height'] and box['y'] + box['height'] > moved['y']:
                band_lines.append(box)
                self.assertTrue(
                    box['x'] + box['width'] <= moved['x'] - 10
                    or box['x'] >= moved['x'] + moved['width'] + 10,
                    'A projected line must stay outside the mascot exclusion area',
                )
        self.assertTrue(any(box['x'] < moved['x'] for box in band_lines), 'Text uses the left slot')
        self.assertTrue(any(box['x'] > moved['x'] for box in band_lines), 'Text uses the right slot')
        self.assertEqual(' '.join(paragraph.inner_text().split()), ' '.join(original.split()))
        expect(paragraph.locator('a[href="https://example.test/flow-link"]')).to_be_visible()
        self.page.screenshot(path=str(SHOTS / 'dragged-text-flow.png'))

        button.focus()
        before_key = button.bounding_box()
        button.press('ArrowRight')
        self.assertAlmostEqual(button.bounding_box()['x'], before_key['x'] + 12, delta=1)

        # A drag ends without toggling the bubble; a later click still toggles it normally.
        expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()
        button.click()
        expect(self.page.locator('[data-mascot-bubble]')).to_be_visible()

    def test_dragging_reflows_headings_and_list_items_on_about_page(self):
        def drag_to(element):
            button = self.page.locator('[data-mascot-button]')
            portrait = button.bounding_box()
            target = element.bounding_box()
            self.page.mouse.move(portrait['x'] + portrait['width'] / 2, portrait['y'] + portrait['height'] / 2)
            self.page.mouse.down()
            self.page.mouse.move(target['x'] + target['width'] / 2, target['y'] + min(24, target['height'] / 2), steps=8)
            self.page.mouse.up()
            expect(element).to_have_attribute('data-mascot-flow', 'active')
            expect(element.locator('.mascot-flow-generated')).to_be_visible()

        self.visit('/about/')
        self.page.locator('[data-mascot-button]').click()
        heading = self.page.locator('main .body h2').first
        drag_to(heading)
        self.assertTrue(heading.locator('.mascot-flow-generated').inner_text().startswith('##'))

        self.visit('/about/')
        self.page.locator('[data-mascot-button]').click()
        item = self.page.locator('main .body li').first
        drag_to(item)
        expect(item.locator('a[href="https://dataintensive.net/"]').first).to_be_visible()
        self.assertEqual(item.locator('.mascot-flow-generated').inner_text().strip(), '*')
        self.page.screenshot(path=str(SHOTS / 'about-list-flow.png'))

    def test_dragging_reflows_blog_title_header_and_footer(self):
        def open_and_drag(selector, scroll=False):
            self.visit('/blog/')
            button = self.page.locator('[data-mascot-button]')
            button.click()
            target = self.page.locator(selector).first
            if scroll:
                target.scroll_into_view_if_needed()
            portrait = button.bounding_box()
            box = target.bounding_box()
            self.page.mouse.move(portrait['x'] + portrait['width'] / 2, portrait['y'] + portrait['height'] / 2)
            self.page.mouse.down()
            self.page.mouse.move(box['x'] + box['width'] / 2, box['y'] + min(20, box['height'] / 2), steps=8)
            self.page.mouse.up()
            expect(target).to_have_attribute('data-mascot-flow', 'active')
            return target

        title = open_and_drag('h1.page-title')
        self.assertTrue(title.locator('.mascot-flow-generated').inner_text().startswith('#'))

        site_title = open_and_drag('.content > header .main')
        expect(site_title.locator('a[href="/"]').first).to_be_visible()

        navigation = open_and_drag('.content > header nav')
        expect(navigation.locator('a[href="/about"]').first).to_be_visible()

        footer = open_and_drag('.content > footer .footer-links', scroll=True)
        self.assertGreater(footer.locator('a').count(), 0)
        expect(footer.locator('a').first).to_be_visible()

    def test_desktop_invitation_and_all_gaze_directions(self):
        self.visit()
        expect(self.page.locator("[data-mascot-full-text]")).to_have_text("wanna see something cool?")
        button = self.page.locator("[data-mascot-button]")
        sprite = self.page.locator("[data-mascot-sprite]")
        box = button.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        directions = ["up-left", "up", "up-right", "left", "center", "right", "down-left", "down", "down-right"]
        for name, (dy, dx) in zip(directions, ((y, x) for y in (-1, 0, 1) for x in (-1, 0, 1))):
            self.page.mouse.move(cx + dx * 55, cy + dy * 55)
            expect(sprite).to_have_attribute("data-frame", name)
        self.page.mouse.move(cx, cy)
        self.page.screenshot(path=str(SHOTS / "desktop-home.png"))

    def test_dark_mode_keeps_a_crisp_portrait_outline(self):
        self.visit()
        self.page.locator("#dark-mode-toggle").click()
        self.page.wait_for_function("getComputedStyle(document.body).backgroundColor === 'rgb(40, 42, 54)'")
        outline = self.page.locator("[data-mascot-sprite]").evaluate("el => getComputedStyle(el).filter")
        self.assertIn("drop-shadow", outline, "The dark beard needs a crisp outline against Archie's dark background")
        self.assertIn("rgb(221, 221, 221)", outline, "Outline follows the active heading color")

    def test_idle_blink_image_is_preloaded(self):
        self.visit()
        requested = self.page.evaluate("performance.getEntriesByType('resource').map(entry => entry.name)")
        self.assertTrue(any(url.endswith('/mascots/surya-terminal-stamp-blink.png') for url in requested))

    def test_rapid_clicks_only_toggle_the_bubble(self):
        self.visit()
        button = self.page.locator("[data-mascot-button]")
        sprite = self.page.locator("[data-mascot-sprite]")
        for _ in range(3):
            button.click()
        expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()
        expect(sprite).to_have_attribute("data-sheet", "directions")
        expect(sprite).to_have_attribute("data-frame", "center")
        self.assertEqual(self.page.locator("[data-mascot-message]").count(), 0)

    def test_message_text_theme_and_dismissal(self):
        self.visit("/mascot-qa-speak/")
        expect(self.page.locator("[data-mascot-full-text]")).to_have_text(MESSAGE)
        self.assertEqual(self.page.locator("[data-mascot-message] b").count(), 0)
        self.page.screenshot(path=str(SHOTS / "desktop-message-light.png"))
        bubble = self.page.locator("[data-mascot-bubble]")
        light = bubble.evaluate("el => getComputedStyle(el).borderImageSource")
        self.page.locator("#dark-mode-toggle").click()
        # The existing theme enables a previously disabled stylesheet; wait for
        # that sheet to load instead of sampling styles in the click's task.
        self.page.wait_for_function("getComputedStyle(document.body).backgroundColor === 'rgb(40, 42, 54)'", timeout=3000)
        dark = bubble.evaluate("el => getComputedStyle(el).borderImageSource")
        self.assertEqual(light, dark, 'The bubble retains the portrait palette in both site themes')
        self.assertEqual(bubble.evaluate('el => getComputedStyle(el).color'), 'rgb(35, 35, 51)')
        self.page.screenshot(path=str(SHOTS / "desktop-message-dark.png"))
        self.page.locator("[data-mascot-button]").focus()
        self.page.keyboard.press("Escape")
        expect(bubble).to_be_hidden()
        self.page.locator("[data-mascot-button]").press("Enter")
        expect(bubble).to_be_visible()
        self.visit("/mascot-qa-blank/")
        expect(self.page.locator("[data-mascot-full-text]")).to_have_text("wanna see something cool?")

    def test_mobile_layout_and_toggle_target(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.visit("/mascot-qa-speak/")
        self.page.screenshot(path=str(SHOTS / "mobile-message.png"))
        for width in (320, 390, 600, 768):
            self.page.set_viewport_size({"width": width, "height": 844})
            self.page.wait_for_function("document.documentElement.scrollWidth <= innerWidth")
            self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Horizontal overflow at {width}px")
            bubble = self.page.locator("[data-mascot-bubble]").bounding_box()
            header = self.page.locator("[data-page-mascot]").bounding_box()
            self.assertLessEqual(bubble["y"] + bubble["height"], header["y"] + header["height"] + 1)
        target = self.page.locator("[data-mascot-button]").bounding_box()
        self.assertGreaterEqual(target["width"], 44, "Toggle must be a usable touch target")
        self.assertGreaterEqual(target["height"], 44, "Toggle must be a usable touch target")

    def test_reduced_motion_and_touch(self):
        self.visit()
        self.page.emulate_media(reduced_motion="reduce")
        self.page.mouse.move(1000, 700)
        expect(self.page.locator("[data-mascot-sprite]")).to_have_attribute("data-frame", "center")
        self.page.locator("[data-mascot-button]").click()
        self.assertEqual(self.page.locator("[data-mascot-sprite]").evaluate("el => getComputedStyle(el).animationName"), "none")
        touch = self.browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="block")
        touch.route("**/cloud.umami.is/**", lambda route: route.abort())
        try:
            page = touch.new_page()
            page.on('pageerror', lambda error: self.errors.append(str(error)))
            page.goto(self.url)
            page.dispatch_event("body", "pointermove", {"pointerType": "touch", "clientX": 380, "clientY": 700})
            expect(page.locator("[data-mascot-sprite]")).to_have_attribute("data-frame", "center")
            page.locator("[data-mascot-button]").tap()
            expect(page.locator("[data-mascot-bubble]")).to_be_hidden()
            expect(page.locator("[data-mascot-sprite]")).to_have_attribute("data-frame", "center")
            page.locator("[data-mascot-button]").tap()
            expect(page.locator("[data-mascot-bubble]")).to_be_visible()
            page.screenshot(path=str(SHOTS / 'mobile-invitation.png'))
            page.locator('[data-mascot-play]').tap()
            page.wait_for_function("document.documentElement.classList.contains('text-asteroids-active')")
            self.assertGreater(int(page.locator('.text-asteroids-canvas').get_attribute('data-remaining')), 0)
            page.locator('.text-asteroids-exit').tap()
            expect(page.locator('[data-mascot-play]')).to_be_visible()
            expect(page.locator('.text-asteroids-game')).to_be_hidden()
        finally:
            touch.close()

    def freeze_clock(self):
        instant = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.page.clock.install(time=instant)
        self.page.clock.pause_at(instant)

    def test_box_grows_while_typing_then_starts_five_second_hold(self):
        self.freeze_clock()
        self.visit('/mascot-qa-speak/')
        bubble = self.page.locator('[data-mascot-bubble]')
        typed = self.page.locator('[data-mascot-typed-text]')
        full = self.page.locator('[data-mascot-full-text]')
        before = bubble.bounding_box()
        self.assertGreaterEqual(before['width'], 96, 'Initial frame must still contain its speech tail')
        expect(bubble).to_have_attribute('data-typing', 'true')
        expect(full).to_have_text(MESSAGE)
        expect(typed).to_have_attribute('aria-hidden', 'true')
        self.assertEqual(full.evaluate('el => getComputedStyle(el).opacity'), '0')
        self.page.clock.run_for(350)
        partial = typed.text_content()
        self.assertTrue(partial and MESSAGE.startswith(partial) and partial != MESSAGE)
        growing = bubble.bounding_box()
        self.assertGreater(growing['width'], before['width'], 'Box expands with the visible text, not the full source')
        self.page.screenshot(path=str(SHOTS / 'message-typing.png'))
        for _ in range(len(MESSAGE) + 1):
            if bubble.get_attribute('data-typing') != 'true':
                break
            self.page.clock.run_for(35)
        expect(typed).to_have_text(MESSAGE)
        expect(bubble).to_have_attribute('data-typing', 'false')
        complete = bubble.bounding_box()
        self.assertGreater(complete['height'], growing['height'])
        self.assertLessEqual(complete['width'], 352)
        self.assertLessEqual(complete['height'], 315)
        self.page.clock.run_for(4900)
        expect(bubble).to_be_visible()
        self.page.clock.run_for(101)
        expect(bubble).to_be_hidden()
        expect(self.page.locator('[data-mascot-button]')).to_have_attribute('aria-expanded', 'false')
        self.page.locator('[data-mascot-button]').dispatch_event('click')
        expect(bubble).to_be_visible()
        expect(bubble).to_have_attribute('data-typing', 'true')
        self.assertNotEqual(typed.text_content(), MESSAGE)

    def test_reduced_motion_shows_full_message_without_blinking(self):
        self.freeze_clock()
        self.page.emulate_media(reduced_motion='reduce')
        self.visit()
        full = self.page.locator('[data-mascot-full-text]')
        expect(full).to_have_text('wanna see something cool?')
        self.assertEqual(full.evaluate('el => getComputedStyle(el).opacity'), '1')
        expect(self.page.locator('[data-mascot-typed-text]')).to_be_hidden()
        self.page.clock.run_for(4900)
        expect(self.page.locator('[data-mascot-bubble]')).to_be_visible()
        expect(self.page.locator('[data-mascot-sprite]')).to_have_attribute('data-sheet', 'directions')
        self.page.clock.run_for(101)
        expect(self.page.locator('[data-mascot-bubble]')).to_be_hidden()

    def test_idle_blink_uses_closed_eyes_then_restores_gaze(self):
        self.freeze_clock()
        self.page.add_init_script('Math.random = () => 0;')
        self.visit()
        sprite = self.page.locator('[data-mascot-sprite]')
        self.page.dispatch_event('body', 'pointermove', {'pointerType': 'mouse', 'clientX': 800, 'clientY': 60})
        gaze = sprite.get_attribute('data-frame')
        self.page.clock.run_for(3999)
        expect(sprite).to_have_attribute('data-sheet', 'directions')
        self.page.clock.run_for(1)
        expect(sprite).to_have_attribute('data-frame', 'blink')
        self.assertIn('surya-terminal-stamp-blink.png', sprite.evaluate('el => getComputedStyle(el).backgroundImage'))
        self.assertEqual(sprite.evaluate('el => getComputedStyle(el).backgroundSize'), '100% 100%')
        self.page.screenshot(path=str(SHOTS / 'idle-blink.png'))
        self.page.clock.run_for(120)
        expect(sprite).to_have_attribute('data-frame', gaze)
        expect(sprite).to_have_attribute('data-sheet', 'directions')

    def test_no_javascript_and_long_text(self):
        self.freeze_clock()
        context = self.browser.new_context(java_script_enabled=False, viewport={"width": 390, "height": 844})
        try:
            page = context.new_page()
            page.goto(self.url + "/mascot-qa-speak/")
            expect(page.locator("[data-mascot-button]")).to_be_disabled()
            expect(page.locator("[data-mascot-message]")).to_have_text(MESSAGE)
            expect(page.locator("[data-mascot-dismiss]")).to_be_hidden()
            page.goto(self.url)
            expect(page.locator('[data-mascot-play]')).to_have_text('wanna see something cool?')
            expect(page.locator('[data-mascot-play]')).to_be_disabled()
            self.assertEqual(page.locator('.text-asteroids-game').count(), 0)
        finally:
            context.close()
        self.page.set_viewport_size({"width": 320, "height": 844})
        self.visit("/mascot-qa-long/")
        self.page.clock.run_for(20000)
        expect(self.page.locator('[data-mascot-bubble]')).to_have_attribute('data-typing', 'true')
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        bubble = self.page.locator("[data-mascot-bubble]").bounding_box()
        self.assertLessEqual(bubble['height'], 300, 'Long messages stay bounded and scroll internally')
        self.assertTrue(self.page.locator('[data-mascot-bubble-body]').evaluate('el => el.scrollHeight > el.clientHeight'))


if __name__ == "__main__":
    unittest.main(verbosity=2)
