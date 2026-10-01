import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = resolve(repo, '../..');

// All fixtures and generated output stay outside the published content tree.
function build(fixtures = {}, baseURL = 'https://example.test/', mascotStyle, durationSeconds) {
  const temp = mkdtempSync(join(tmpdir(), 'hugo-mascot-test-'));
  try {
    const source = join(temp, 'site');
    cpSync(siteRoot, source, {
      recursive: true,
      filter: (path) => !['public', 'resources', '.git', '.hugo_build.lock'].includes(path.split('/').at(-1)),
    });
    const configPath = join(source, 'config.yml');
    let config = readFileSync(configPath, 'utf8');
    const selectedStyle = mascotStyle ?? 'terminal-stamp';
    if (/^  mascotStyle: /m.test(config)) {
      config = config.replace(/^  mascotStyle: .*$/m, `  mascotStyle: ${selectedStyle}`);
    } else {
      config = config.replace('\nparams:\n', `\nparams:\n  mascotStyle: ${selectedStyle}\n`);
    }
    if (durationSeconds !== undefined) {
      assert.match(config, /^  mascotMessageDurationSeconds: 5$/m);
      config = config.replace(/^  mascotMessageDurationSeconds: 5$/m,
        durationSeconds === null ? '' : `  mascotMessageDurationSeconds: ${durationSeconds}`);
    }
    writeFileSync(configPath, config);
    for (const [name, frontMatter] of Object.entries(fixtures)) {
      writeFileSync(join(source, 'content', `${name}.md`), `---\ntitle: Fixture\n${frontMatter}\n---\nFixture body.\n`);
    }
    const destination = join(temp, 'public');
    execFileSync('hugo', ['--source', source, '--destination', destination, '--baseURL', baseURL], { encoding: 'utf8', stdio: 'pipe' });
    return {
      html: (name = '') => readFileSync(join(destination, name, 'index.html'), 'utf8'),
      asset: (url, encoding = 'utf8') => readFileSync(join(destination, url.replace(new URL(baseURL).pathname, '')), encoding),
      cleanup: () => rmSync(temp, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

test('message duration comes from site config and falls back to five seconds', () => {
  for (const [configValue, expected] of [[undefined, '5'], [2, '2'], [null, '5']]) {
    const site = build({}, 'https://example.test/', undefined, configValue);
    try {
      assert.match(site.html(), new RegExp(`data-mascot-message-duration-seconds="${expected}"`));
    } finally {
      site.cleanup();
    }
  }
});

test('mascot preloads its single blink image without click animation or an X', () => {
  const site = build();
  try {
    const css = site.asset(site.html().match(/href="([^\"]*\/css\/mascot\.min\.[a-f0-9]+\.css)"/)[1]);
    assert.doesNotMatch(css, /mascot-squash|data-reacting|surya-reactions/);
    assert.doesNotMatch(css, /infinite/);
    assert.match(site.html(), /rel="preload" as="image" href="[^"]*surya-terminal-stamp-blink\.png"/);
    assert.doesNotMatch(site.html(), /surya-terminal-stamp-reactions\.png/);
    assert.doesNotMatch(site.html(), /data-mascot-dismiss/);
  } finally {
    site.cleanup();
  }
});

test('mobile portrait keeps the non-square sprite aspect ratio in the corner', () => {
  const site = build();
  try {
    const css = site.asset(site.html().match(/href="([^\"]*\/css\/mascot\.min\.[a-f0-9]+\.css)"/)[1]);
    assert.match(css, /@media\s*\(max-width:\s*600px\)/);
    assert.match(css, /bottom:\s*calc/);
    assert.match(css, /left:\s*calc/);
    assert.match(css, /width:72px;height:84px/);
    assert.match(css, /var\(--toc-accent\)/);
    assert.match(css, /var\(--headingcolor\)/);
    assert.match(css, /mascot-bubble-frame\.svg/);
    assert.match(css, /position:\s*fixed/);
  } finally {
    site.cleanup();
  }
});

test('mascot assets ship in the custom theme without site-level overrides', () => {
  assert.equal(existsSync(join(siteRoot, 'layouts/partials/head.html')), false);
  assert.ok(existsSync(join(repo, 'layouts/partials/mascot.html')));
  assert.ok(existsSync(join(repo, 'assets/css/mascot.css')));
  assert.ok(existsSync(join(repo, 'assets/js/mascot.js')));
  assert.ok(existsSync(join(repo, 'assets/js/mascot-flow.js')));
  assert.ok(existsSync(join(repo, 'assets/vendor/pretext/LICENSE')));
  assert.ok(existsSync(join(repo, 'static/mascots/surya-terminal-stamp-directions.png')));
  assert.ok(existsSync(join(repo, 'static/mascots/surya-terminal-stamp-blink.png')));
  assert.equal(existsSync(join(repo, 'static/mascots/surya-terminal-stamp-reactions.png')), false);
  assert.equal(existsSync(join(siteRoot, 'static/mascots')), false);
  assert.equal(existsSync(join(siteRoot, 'static/favicon.png')), false);
  const config = readFileSync(join(siteRoot, 'config.yml'), 'utf8');
  assert.match(config, /^  mascotStyle: (?:terminal-stamp|original)$/m);
  assert.doesNotMatch(config, /customCSS:|^  (?:mode|favicon|useCDN):/m);
});

test('subpath builds include fingerprinted script and correctly prefixed sprite URLs', () => {
  const site = build({}, 'https://example.test/not-root/');
  try {
    const html = site.html();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<ul class="pagination">\s*<li class="page-item page-prev">/);
    assert.match(html, /id="dark-mode-toggle"[^>]*aria-label="Switch to dark mode"/);
    assert.match(html, /data-asteroids-script="\/not-root\/js\/asteroids\.min\.[a-f0-9]+\.js"/);
    assert.doesNotMatch(html, /<script defer src="\/not-root\/js\/asteroids\.min\./);
    const script = html.match(/<script type="module" defer src="(\/not-root\/js\/mascot\.[a-f0-9]+\.js)"><\/script>/);
    assert.ok(script, 'mascot module is bundled, fingerprinted, deferred and base-path aware');
    const bundled = site.asset(script[1]);
    assert.match(bundled, /data-mascot-button/);
    assert.match(bundled, /Drag mascot or toggle its message/);
    assert.match(bundled, /pretext-LICENSE\.txt/);
    assert.doesNotMatch(bundled, /from ['"]\.\.\/vendor\/pretext/);
    assert.match(site.asset('/not-root/licenses/pretext-LICENSE.txt'), /Copyright \(c\) 2026 Pretext contributors/);
    assert.match(html, /\/not-root\/mascots\/surya-terminal-stamp-directions\.png/);
    assert.deepEqual([...site.asset('/not-root/mascots/surya-terminal-stamp-directions.png', null).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'the prefixed sprite URL resolves to a PNG');
    const cssURL = html.match(/href="([^\"]*\/css\/mascot\.min\.[a-f0-9]+\.css)"/)[1];
    const css = site.asset(cssURL);
    assert.match(css, /font-family:monocraft/);
    const fontURL = new URL(css.match(/src:url\(([^)]+)\)/)[1], `https://example.test${cssURL}`).pathname;
    assert.match(fontURL, /^\/not-root\/fonts\/Monocraft\.woff2$/);
    assert.deepEqual(site.asset(fontURL, null), readFileSync(join(repo, 'static/fonts/Monocraft.woff2')));
    assert.match(site.asset('/not-root/fonts/Monocraft-LICENSE.txt'), /SIL OPEN FONT LICENSE/);
    for (const name of ['frame', 'tail', 'paper']) {
      assert.match(css, new RegExp(`\\.\\./images/mascot-bubble-${name}\\.svg`));
      assert.match(site.asset(`/not-root/images/mascot-bubble-${name}.svg`), /shape-rendering="crispEdges"/);
    }
    assert.doesNotMatch(html, /ZgotmplZ/);
    assert.equal((html.match(/src="[^"]*\/mascot\.[a-f0-9]+\.js"/g) || []).length, 1);
  } finally {
    site.cleanup();
  }
});

test('trimmed top-level strings render escaped messages and other values retain the fallback bubble', () => {
  const site = build({
    'mascot-message': 'mascot_message: \'  Hello <img src=x onerror=alert(1)> & "friends"!  \'',
    'mascot-empty': 'mascot_message: ""',
    'mascot-whitespace': 'mascot_message: " \\t\\n "',
    'mascot-missing': '',
    'mascot-number': 'mascot_message: 42',
    'mascot-list': 'mascot_message: [hello]',
    'mascot-nested': 'mascot:\n  message: Not the supported field',
  });
  try {
    const html = site.html('mascot-message');
    assert.match(html, /data-mascot-full-text>Hello &lt;img src=x onerror=alert\(1\)&gt; &amp; &#34;friends&#34;!<\/span>/);
    assert.doesNotMatch(html, /<img src=x|data-mascot-play/);
    assertBubbleToggle(html);
    for (const name of ['empty', 'whitespace', 'missing', 'number', 'list', 'nested']) {
      const fallback = site.html(`mascot-${name}`);
      assertBubbleToggle(fallback);
      assert.doesNotMatch(fallback, /data-mascot-message(?:\s|=|>)/);
      assert.match(fallback, /data-mascot-play[^>]*disabled[^>]*>/);
      assert.match(fallback, /data-mascot-full-text>wanna see something cool\? click here :-}<\/span>/);
    }
    assert.match(site.asset(html.match(/href="([^\"]*\/css\/mascot\.min\.[a-f0-9]+\.css)"/)[1]), /\.page-mascot \.mascot-bubble/);
  } finally {
    site.cleanup();
  }
});

function assertBubbleToggle(html) {
  const button = html.match(/<button\b[^>]*data-mascot-button[^>]*>/)?.[0];
  assert.ok(button, 'native mascot toggle is rendered');
  assert.match(button, /\bdisabled\b/);
  assert.match(button, /aria-label="Toggle mascot message"/);
  assert.match(button, /aria-expanded="true"/);
  assert.match(button, /aria-controls="mascot-bubble"/);
  const bubble = html.match(/<[^>]+\bdata-mascot-bubble[^>]*>/)?.[0];
  assert.ok(bubble, 'a bubble always renders');
  assert.match(bubble, /\bid="mascot-bubble"/);
  assert.doesNotMatch(bubble, /\bhidden\b/, 'speech remains visible without JavaScript');
  assert.equal((html.match(/\bid="mascot-bubble"/g) || []).length, 1);
  assert.doesNotMatch(html, /data-mascot-dismiss|Dismiss mascot message/, 'the X close control is removed');
  assert.match(html, /data-mascot-typed-text[^>]*aria-hidden="true"[^>]*hidden/, 'Animation copy is hidden from assistive technology and without JS');
}

test('corner mascot offers the game without changing the restored header navigation', () => {
  const site = build();
  try {
    const html = site.html();
    assert.match(html, /<header>/);
    assert.match(html, /<div class="page-mascot" data-page-mascot/);
    assert.match(html, /<button[^>]*data-mascot-button[^>]*disabled/);
    assertBubbleToggle(html);
    assert.match(html, /data-mascot-sprite[^>]*aria-hidden="true"/);
    assert.doesNotMatch(html, /data-mascot-message(?:\s|=|>)/);
    assert.match(html, /Surya Kanagasabapathi<\/a>/);
    for (const name of ['about', 'blog', 'projects', 'notes', 'tags']) {
      assert.match(html, new RegExp(`href="/${name}">/${name}</a>`));
    }
    assert.match(html, /title="RSS Feed"/);
    assert.match(html, /id="dark-mode-toggle" onclick="toggleTheme\(\); return false;"/);
    assert.match(html, /src="\/js\/themetoggle\.min\.[a-f0-9]+\.js"/);
    const css = html.match(/href="([^\"]*\/css\/mascot\.min\.[a-f0-9]+\.css)"/);
    assert.ok(css, 'theme includes fingerprinted mascot stylesheet');
    const styles = site.asset(css[1]);
    assert.match(styles, /background-size:\s*300% 300%/);
    assert.match(styles, /image-rendering:\s*pixelated/);
    assert.match(styles, /width:\s*96px/);
    assert.match(styles, /height:\s*112px/);
    assert.match(styles, /position:\s*fixed/);
    assert.match(html, /mascots\/surya-terminal-stamp-directions\.png/);
    assert.equal(existsSync(join(siteRoot, 'layouts/partials/header.html')), false, 'do not fork the full theme document head');
  } finally {
    site.cleanup();
  }
});

test('mascot style setting restores the original sprite and preload', () => {
  const site = build({}, 'https://example.test/', 'original');
  try {
    const html = site.html();
    assert.match(html, /mascots\/surya-directions\.png/);
    assert.match(html, /mascots\/surya-reactions\.png/);
    assert.match(html, /rel="preload" as="image" href="[^"]*surya-reactions\.png"/);
    assert.doesNotMatch(html, /surya-terminal-stamp-directions\.png/);
  } finally {
    site.cleanup();
  }
});
