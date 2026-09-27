import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = new URL('../assets/js/mascot.js', import.meta.url);

// Small DOM/event/clock adapters run the actual shipped, dependency-free script.
// Browser geometry, native keyboard semantics and rendering are checked separately.
class Target {
  listeners = new Map();
  attributes = new Map();
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, values = {}) {
    const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    return event;
  }
}

function setup({ fine = true, reduced = false, message = false, text, random = [0], segmenter = true, hidden = false, focused = true, game = false, duration } = {}) {
  let now = 0;
  let timerID = 0;
  const timers = new Map();
  const observers = new Set();
  const classes = new Set(game ? ['text-asteroids-active'] : []);
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) {
      assert.equal(target, document.documentElement);
      assert.equal(options.attributes, true);
      assert.deepEqual(Array.from(options.attributeFilter), ['class']);
      observers.add(this);
    }
    disconnect() { observers.delete(this); }
  }
  const button = Object.assign(new Target(), {
    disabled: true,
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 96, height: 112 }),
  });
  const sprite = { dataset: {}, style: {} };
  button.setAttribute('aria-controls', 'mascot-bubble');
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-label', 'Toggle mascot message');
  const full = { textContent: text ?? (message ? 'A complete <safe> message.' : 'wanna see something cool?'), style: {} };
  const typed = { textContent: '', hidden: true };
  const bubble = { id: 'mascot-bubble', hidden: false, dataset: {} };
  const bubbleChild = new Target();
  const root = Object.assign(new Target(), {
    dataset: duration === undefined ? {} : { mascotMessageDurationSeconds: String(duration) },
    contains: (element) => [button, bubble, bubbleChild].includes(element),
  });
  root.querySelector = (selector) => ({
    '[data-mascot-button]': button,
    '[data-mascot-sprite]': sprite,
    '[data-mascot-bubble]': bubble,
    '[data-mascot-full-text]': full,
    '[data-mascot-typed-text]': typed,
  })[selector] || null;
  const document = Object.assign(new Target(), {
    querySelectorAll: () => [root],
    activeElement: null,
    hidden,
    hasFocus: () => focused,
    documentElement: { classList: { contains: (name) => classes.has(name) } },
  });
  button.focus = () => { document.activeElement = button; };
  const media = {
    '(hover: hover) and (pointer: fine)': Object.assign(new Target(), { matches: fine }),
    '(prefers-reduced-motion: reduce)': Object.assign(new Target(), { matches: reduced }),
  };
  const window = Object.assign(new Target(), { innerWidth: 1280, innerHeight: 900, matchMedia: (query) => {
    assert.ok(media[query], `unexpected media query ${query}`);
    return media[query];
  } });
  const context = vm.createContext({
    document, window, MutationObserver, performance: { now: () => now },
    createMascotTextFlow: () => ({ schedule() {}, destroy() {} }),
    Math: Object.assign(Object.create(Math), { random: () => random.length > 1 ? random.shift() : random[0] }),
    Intl: segmenter ? Intl : {},
    setTimeout: (callback, delay) => { timers.set(++timerID, { callback, at: now + delay }); return timerID; },
    clearTimeout: (id) => timers.delete(id),
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      const [id, timer] = entry;
      now = timer.at;
      timers.delete(id);
      timer.callback();
    }
    now = end;
  }
  assert.ok(existsSync(script), 'the progressive enhancement script exists');
  const source = readFileSync(script, 'utf8').replace("import { createMascotTextFlow } from './mascot-flow.js';\n\n", '');
  vm.runInContext(source, context);
  function pause(reason, value) {
    if (reason === 'visibility') {
      document.hidden = value;
      document.emit('visibilitychange');
    } else if (reason === 'window') {
      focused = !value;
      window.emit(value ? 'blur' : 'focus');
    } else {
      if (value) classes.add('text-asteroids-active');
      else classes.delete('text-asteroids-active');
      for (const observer of [...observers]) observer.callback([{ attributeName: 'class' }]);
    }
  }
  return { button, sprite, root, bubble, full, typed, bubbleChild, document, window, media, timers, observers, advance, pause };
}

test('bfcache preserves bubble visibility and aria state with exactly one interaction listener', () => {
  const page = setup({ message: true });
  page.window.emit('pageshow', { persisted: false });
  assert.equal(page.button.listeners.get('click').size, 1, 'initial pageshow does not initialize twice');
  for (let visit = 0; visit < 3; visit++) {
    page.button.emit('click');
    const hidden = page.bubble.hidden;
    page.window.emit('pagehide', { persisted: true });
    assert.equal(page.bubble.hidden, hidden);
    assert.equal(page.button.getAttribute('aria-expanded'), String(!hidden));
    page.window.emit('pageshow', { persisted: true });
    page.window.emit('pageshow', { persisted: true });
    assert.equal(page.button.disabled, false);
    assert.equal(page.bubble.hidden, hidden);
    assert.equal(page.button.getAttribute('aria-expanded'), String(!hidden));
    assert.equal(page.sprite.dataset.frame, 'center');
    assert.equal(page.button.listeners.get('click').size, 1);
    assert.equal(page.document.listeners.get('pointermove').size, 1);
    assert.equal(page.root.listeners.get('keydown').size, 1);
    assert.equal(page.document.listeners.get('visibilitychange').size, 1);
    assert.equal(page.window.listeners.get('focus').size, 1);
    assert.equal(page.window.listeners.get('blur').size, 1);
    assert.equal(page.observers.size, 1);
    assert.equal(page.timers.size, hidden ? 1 : 2, 'restoring does not duplicate timers');
  }
});

test('pagehide detaches interaction listeners without changing bubble state', () => {
  for (const hidden of [false, true]) {
    const page = setup({ message: true });
    if (hidden) page.button.emit('click');
    page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
    page.window.emit('pagehide', { persisted: true });
    assert.equal(page.timers.size, 0);
    assert.equal(page.sprite.dataset.frame, 'center');
    assert.equal(page.button.disabled, true);
    assert.equal(page.bubble.hidden, hidden);
    assert.equal(page.button.getAttribute('aria-expanded'), String(!hidden));
    assert.equal(page.observers.size, 0);
    assert.equal(page.window.listeners.get('focus').size, 0);
    assert.equal(page.window.listeners.get('blur').size, 0);
    for (const target of [page.document, page.root, page.button, ...Object.values(page.media)]) {
      for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
    }
    page.button.emit('click');
    page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
    page.advance(5000);
    assert.equal(page.bubble.hidden, hidden, 'detached clicks cannot toggle the bubble');
    assert.equal(page.sprite.dataset.frame, 'center');
    assert.equal(page.timers.size, 0);
  }
});

test('Escape hides the bubble only with mascot focus and returns focus to the toggle', () => {
  const page = setup({ message: true });
  assert.equal(page.bubble.hidden, false, 'speech bubble opens immediately');
  page.document.activeElement = {};
  assert.equal(page.root.emit('keydown', { key: 'Escape' }).defaultPrevented, undefined);
  assert.equal(page.bubble.hidden, false, 'navigation focus does not count as mascot focus');
  page.document.activeElement = page.button;
  page.root.emit('keydown', { key: 'Enter' });
  assert.equal(page.bubble.hidden, false);
  assert.equal(page.root.emit('keydown', { key: 'Escape' }).defaultPrevented, true);
  assert.equal(page.bubble.hidden, true);
  assert.equal(page.button.getAttribute('aria-expanded'), 'false');
  assert.equal(page.document.activeElement, page.button, 'never steal focus');
  page.button.emit('click');
  assert.equal(page.bubble.hidden, false, 'activation reopens speech after Escape');
  assert.equal(page.button.getAttribute('aria-expanded'), 'true');
  assert.equal(page.full.textContent, 'A complete <safe> message.');
  page.document.activeElement = page.bubbleChild;
  page.root.emit('keydown', { key: 'Escape' });
  assert.equal(page.bubble.hidden, true);
  assert.equal(page.document.activeElement, page.button, 'focus does not remain in the hidden bubble');
});

test('tracking is limited to fine pointers without reduced motion, including preference changes', () => {
  for (const options of [{ fine: false }, { reduced: true }, { fine: true, reduced: false }]) {
    const page = setup(options);
    const move = (pointerType = 'mouse') => page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType });
    move('touch');
    assert.equal(page.sprite.dataset.frame, 'center', 'touch never tracks on hybrid devices');
    move();
    assert.equal(page.sprite.dataset.frame, options.fine === false || options.reduced ? 'center' : 'right');
    const reduced = page.media['(prefers-reduced-motion: reduce)'];
    reduced.matches = true;
    reduced.emit('change');
    assert.equal(page.sprite.dataset.frame, 'center');
    move();
    assert.equal(page.sprite.dataset.frame, 'center');
    page.button.emit('click');
    page.advance(120);
    assert.equal(page.sprite.dataset.frame, 'center', 'activation does not animate');
    assert.equal(page.bubble.hidden, true, 'toggle remains available with reduced motion');
    assert.equal(page.timers.size, 0);
    reduced.matches = false;
    reduced.emit('change');
    const fine = page.media['(hover: hover) and (pointer: fine)'];
    fine.matches = true;
    fine.emit('change');
    move();
    assert.equal(page.sprite.dataset.frame, 'right');
    fine.matches = false;
    fine.emit('change');
    assert.equal(page.sprite.dataset.frame, 'center');
  }
});

test('bubble toggling does not interrupt gaze and pointer leave or blur resets it', () => {
  const page = setup();
  page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
  page.button.emit('click');
  assert.equal(page.sprite.dataset.frame, 'right');
  assert.equal(page.bubble.hidden, true);
  page.document.emit('pointerleave');
  assert.equal(page.sprite.dataset.frame, 'center');
  assert.ok(page.timers.size <= 1, 'only the idle blink remains after closing');
  page.advance(2000);
  assert.equal(page.sprite.dataset.frame, 'center');
  page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
  assert.equal(page.sprite.dataset.frame, 'right');
  page.window.emit('blur');
  assert.equal(page.sprite.dataset.frame, 'center');
});

test('cursor selects each row-major direction and the center dead zone', () => {
  const page = setup();
  const directions = ['up-left', 'up', 'up-right', 'left', 'center', 'right', 'down-left', 'down', 'down-right'];
  directions.forEach((frame, index) => {
    const x = (index % 3 - 1) * 100;
    const y = (Math.floor(index / 3) - 1) * 100;
    page.document.emit('pointermove', { clientX: 148 + x, clientY: 156 + y, pointerType: 'mouse' });
    assert.equal(page.sprite.dataset.frame, frame);
    assert.equal(page.sprite.style.backgroundPosition, `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`);
  });
  page.document.emit('pointermove', { clientX: 155, clientY: 159, pointerType: 'mouse' });
  assert.equal(page.sprite.dataset.frame, 'center', 'small cursor movements stay neutral');
  assert.ok(page.timers.size <= 2, 'tracking never accumulates timers');
});

test('mouse and native keyboard clicks toggle fallback or custom speech without click reactions', () => {
  for (const message of [false, true]) {
    const page = setup({ message });
    const text = page.full.textContent;
    assert.equal(page.button.disabled, false);
    assert.equal(page.button.getAttribute('aria-expanded'), 'true');
    assert.ok(page.timers.size <= 2, 'bounded animation timers');
    for (const [index, detail] of [1, 0, 1, 1, 0, 1].entries()) {
      page.button.emit('click', { detail }); // Native Enter/Space dispatches click too.
      const hidden = index % 2 === 0;
      assert.equal(page.bubble.hidden, hidden);
      assert.equal(page.button.getAttribute('aria-expanded'), String(!hidden));
      assert.equal(page.button.getAttribute('aria-label'), 'Drag mascot or toggle its message');
      assert.equal(page.sprite.dataset.frame, 'center');
      assert.equal(page.root.dataset.reacting, undefined);
      assert.ok(page.timers.size <= 2, 'clicks do not accumulate timers');
      page.advance(index < 3 ? 80 : 2000);
      assert.equal(page.bubble.hidden, hidden, 'short waits never hide speech prematurely');
      assert.equal(page.full.textContent, text);
    }
  }
});

test('initially inactive pages defer animation and reading time until they become available', () => {
  for (const [reason, options] of [['visibility', { hidden: true }], ['window', { focused: false }], ['game', { game: true }]]) {
    for (const reduced of [false, true]) {
      const page = setup({ ...options, reduced, text: 'Hi' });
      assert.equal(page.timers.size, 0);
      page.advance(60000);
      assert.equal(page.typed.textContent, '');
      assert.equal(page.bubble.hidden, false);
      page.pause(reason, false);
      page.advance(reduced ? 0 : 70);
      assert.equal(page.bubble.dataset.typing, 'false');
      page.advance(4999);
      assert.equal(page.bubble.hidden, false);
      page.advance(1);
      assert.equal(page.bubble.hidden, true);
    }
  }
});

test('overlapping pause reasons cancel active blinks and resume only when all reasons clear', () => {
  const page = setup({ text: 'Hi' });
  page.advance(4000);
  assert.equal(page.sprite.dataset.frame, 'blink');
  page.pause('game', true);
  assert.equal(page.sprite.dataset.sheet, 'directions');
  page.pause('visibility', true);
  page.advance(60000);
  page.pause('game', false);
  assert.equal(page.timers.size, 0);
  page.advance(60000);
  page.pause('visibility', false);
  page.advance(1069);
  assert.equal(page.bubble.hidden, false);
  page.advance(1);
  assert.equal(page.bubble.hidden, true);
  page.advance(2929);
  assert.equal(page.sprite.dataset.sheet, 'directions');
  page.advance(1);
  assert.equal(page.sprite.dataset.frame, 'blink', 'resume starts a fresh idle delay');
});

test('unrelated document class mutations do not restart the hold or idle delay', () => {
  const page = setup({ text: 'Hi' });
  page.advance(3999);
  page.pause('game', false); // Observer notification, but game state is unchanged.
  page.advance(1);
  assert.equal(page.sprite.dataset.frame, 'blink');
  page.advance(1069);
  assert.equal(page.bubble.hidden, false);
  page.advance(1);
  assert.equal(page.bubble.hidden, true);
});

test('reduced motion suppresses idle blinks and cancels an active blink on preference change', () => {
  for (const reduced of [true, false]) {
    const page = setup({ reduced });
    if (!reduced) {
      page.advance(4000);
      assert.equal(page.sprite.dataset.frame, 'blink');
      const preference = page.media['(prefers-reduced-motion: reduce)'];
      preference.matches = true;
      preference.emit('change');
    }
    page.advance(60000);
    assert.equal(page.sprite.dataset.sheet, 'directions');
    assert.equal(page.sprite.dataset.frame, 'center');
    assert.equal(page.timers.size, 0);
    const preference = page.media['(prefers-reduced-motion: reduce)'];
    preference.matches = false;
    preference.emit('change');
    page.advance(4000);
    assert.equal(page.sprite.dataset.frame, 'blink');
  }
});

test('pagehide tears down typing, hold, blink and paused work without revival', () => {
  for (const phase of ['typing', 'hold', 'blink', 'paused']) {
    const page = setup({ text: 'Hello' });
    if (phase === 'hold') page.advance(175);
    if (phase === 'blink') page.advance(4000);
    if (phase === 'paused') page.pause('game', true);
    const text = page.typed.textContent;
    page.window.emit('pagehide', { persisted: true });
    assert.equal(page.observers.size, 0);
    assert.equal(page.timers.size, 0);
    page.pause('game', false);
    page.pause('window', false);
    page.pause('visibility', false);
    page.advance(60000);
    assert.equal(page.typed.textContent, text);
    assert.equal(page.bubble.hidden, false);
    assert.equal(page.timers.size, 0);
    assert.equal(page.sprite.dataset.frame, 'center');
    page.window.emit('pageshow', { persisted: true });
    assert.equal(page.typed.textContent, '', 'visible bfcache speech retypes with a fresh reading window');
    page.advance(175 + 4999);
    assert.equal(page.bubble.hidden, false);
    page.advance(1);
    assert.equal(page.bubble.hidden, true);
  }
});

test('rapid pointer activity never creates more than one text and one blink timer', () => {
  const page = setup();
  for (let count = 0; count < 1000; count++) {
    page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
    assert.equal(page.timers.size, 2);
  }
  page.window.emit('pagehide');
  assert.equal(page.timers.size, 0);
});

test('pointer activity and toggle clicks postpone idle blinking without click expressions', () => {
  for (const activity of ['pointermove', 'pointerdown', 'click']) {
    const page = setup();
    page.advance(3999);
    if (activity === 'click') page.button.emit('click');
    else page.document.emit(activity, { clientX: 500, clientY: 156, pointerType: 'mouse' });
    const gaze = page.sprite.dataset.frame;
    page.advance(3999);
    assert.equal(page.sprite.dataset.sheet, 'directions', `${activity} restarts the idle delay`);
    assert.equal(page.sprite.dataset.frame, gaze);
    page.advance(1);
    assert.equal(page.sprite.dataset.frame, 'blink');
    page.button.emit('click');
    assert.equal(page.sprite.dataset.sheet, 'directions', 'click cancels an active blink, never replaces it with another reaction');
    assert.equal(page.sprite.dataset.frame, gaze);
    page.advance(120);
    assert.equal(page.sprite.dataset.frame, gaze);
  }
});

test('visibility, game and inactive-window pauses preserve typing and the remaining reading time', () => {
  for (const reason of ['visibility', 'game', 'window']) {
    const page = setup({ text: 'Hello' });
    page.advance(50);
    assert.equal(page.typed.textContent, 'H');
    page.pause(reason, true);
    assert.equal(page.timers.size, 0, `${reason} suspends all animation timers`);
    page.advance(60000);
    assert.equal(page.typed.textContent, 'H');
    assert.equal(page.bubble.hidden, false);
    assert.equal(page.sprite.dataset.sheet, 'directions');
    page.pause(reason, false);
    page.advance(19);
    assert.equal(page.typed.textContent, 'H');
    page.advance(1);
    assert.equal(page.typed.textContent, 'He');
    page.advance(105 + 4000);
    assert.equal(page.bubble.dataset.typing, 'false');
    page.pause(reason, true);
    page.advance(60000);
    assert.equal(page.bubble.hidden, false, 'unseen time never consumes the reading hold');
    page.pause(reason, false);
    page.advance(999);
    assert.equal(page.bubble.hidden, false);
    page.advance(1);
    assert.equal(page.bubble.hidden, true);
  }
});

test('idle blinks use irregular 4–9s delays and restore the last gaze after 120ms', () => {
  const page = setup({ random: [0, 0, 0.8, 0.2] });
  page.document.emit('pointermove', { clientX: 500, clientY: 156, pointerType: 'mouse' });
  page.advance(3999);
  assert.equal(page.sprite.dataset.frame, 'right');
  page.advance(1);
  assert.equal(page.sprite.dataset.sheet, 'reactions');
  assert.equal(page.sprite.dataset.frame, 'blink');
  assert.equal(page.sprite.style.backgroundPosition, '0% 0%');
  page.advance(119);
  assert.equal(page.sprite.dataset.frame, 'blink');
  page.advance(1);
  assert.equal(page.sprite.dataset.sheet, 'directions');
  assert.equal(page.sprite.dataset.frame, 'right');
  assert.equal(page.sprite.style.backgroundPosition, '100% 50%');
  page.advance(7999);
  assert.equal(page.sprite.dataset.frame, 'right');
  page.advance(1);
  assert.equal(page.sprite.dataset.frame, 'blink');
  page.advance(120);
  page.advance(4999);
  assert.equal(page.sprite.dataset.frame, 'right');
  page.advance(1);
  assert.equal(page.sprite.dataset.frame, 'blink');
  assert.ok(page.timers.size <= 2);
});

test('reopening retypes from scratch and cancels every stale typing and hold timer', () => {
  const page = setup({ text: 'Hello' });
  page.advance(35);
  page.button.emit('click');
  page.advance(10000);
  assert.equal(page.typed.textContent, 'H', 'closing cancels incomplete typing');
  page.button.emit('click');
  assert.equal(page.typed.textContent, '');
  page.advance(175 + 4000);
  page.button.emit('click');
  page.button.emit('click');
  assert.equal(page.typed.textContent, '');
  page.advance(1000);
  assert.equal(page.bubble.hidden, false, 'the previous hold deadline cannot hide reopened text');
  page.advance(4174);
  assert.equal(page.bubble.hidden, false);
  page.advance(1);
  assert.equal(page.bubble.hidden, true);
});

test('switching motion preference after typing preserves the existing hold deadline', () => {
  const page = setup({ text: 'Hi' });
  page.advance(70 + 2000);
  const preference = page.media['(prefers-reduced-motion: reduce)'];
  preference.matches = true;
  preference.emit('change');
  assert.equal(page.full.style.opacity, '');
  assert.equal(page.typed.hidden, true);
  page.advance(2999);
  assert.equal(page.bubble.hidden, false);
  page.advance(1);
  assert.equal(page.bubble.hidden, true, 'motion changes do not extend completed speech beyond its hold');
});

test('reduced motion exposes full text immediately including mid-typing preference changes', () => {
  for (const reduced of [true, false]) {
    const page = setup({ text: 'Hello', reduced });
    if (!reduced) {
      page.advance(35);
      const preference = page.media['(prefers-reduced-motion: reduce)'];
      preference.matches = true;
      preference.emit('change');
    }
    assert.equal(page.full.style.opacity, '');
    assert.equal(page.full.textContent, 'Hello');
    assert.equal(page.typed.hidden, true);
    assert.equal(page.bubble.dataset.typing, 'false');
    page.advance(4999);
    assert.equal(page.bubble.hidden, false);
    page.advance(1);
    assert.equal(page.bubble.hidden, true);
    assert.equal(page.timers.size, 0);
  }
});

test('auto-hide waits 5000ms after the final grapheme and safely returns invitation focus', () => {
  for (const focused of [true, false]) {
    const page = setup({ text: 'a'.repeat(500) });
    const outside = {};
    page.document.activeElement = focused ? page.bubbleChild : outside;
    page.advance(15000);
    assert.equal(page.bubble.hidden, false, 'long speech cannot hide while still typing');
    assert.equal(page.bubble.dataset.typing, 'true');
    page.advance(2500);
    assert.equal(page.bubble.dataset.typing, 'false');
    page.advance(4999);
    assert.equal(page.bubble.hidden, false);
    page.advance(1);
    assert.equal(page.bubble.hidden, true);
    assert.equal(page.button.getAttribute('aria-expanded'), 'false');
    assert.equal(page.document.activeElement, focused ? page.button : outside);
  }
});

test('empty text is already complete and receives the same 5000ms reading hold', () => {
  const page = setup({ text: '' });
  assert.equal(page.bubble.dataset.typing, 'false');
  assert.equal(page.typed.textContent, '');
  page.advance(4999);
  assert.equal(page.bubble.hidden, false);
  page.advance(1);
  assert.equal(page.bubble.hidden, true);
});

test('configured seconds control the reading hold after typing and with reduced motion', () => {
  for (const reduced of [false, true]) {
    for (const [duration, hold] of [[2, 2000], [0, 5000], ['invalid', 5000]]) {
      const page = setup({ text: 'Hi', duration, reduced });
      page.advance((reduced ? 0 : 70) + hold - 1);
      assert.equal(page.bubble.hidden, false);
      page.advance(1);
      assert.equal(page.bubble.hidden, true);
    }
  }
});

test('typewriter uses Unicode graphemes with a code-point fallback', () => {
  for (const segmenter of [true, false]) {
    const parts = segmenter ? ['👩🏽‍💻', 'e\u0301', '🇮🇳'] : ['😀', 'é', '!'];
    const page = setup({ text: parts.join(''), segmenter });
    parts.forEach((_, index) => {
      page.advance(35);
      assert.equal(page.typed.textContent, parts.slice(0, index + 1).join(''));
      assert.equal(page.bubble.dataset.typing, String(index < parts.length - 1));
    });
    assert.equal(page.full.textContent, parts.join(''));
  }
});

test('typewriter reveals text at 35ms intervals without mutating accessible full text', () => {
  const page = setup({ text: 'Hi!' });
  assert.equal(page.full.textContent, 'Hi!');
  assert.equal(page.full.style.opacity, '0');
  assert.equal(page.typed.hidden, false);
  assert.equal(page.typed.textContent, '');
  assert.equal(page.bubble.dataset.typing, 'true');
  page.advance(34);
  assert.equal(page.typed.textContent, '');
  page.advance(1);
  assert.equal(page.typed.textContent, 'H');
  page.advance(35);
  assert.equal(page.typed.textContent, 'Hi');
  page.advance(35);
  assert.equal(page.typed.textContent, 'Hi!');
  assert.equal(page.bubble.dataset.typing, 'false');
  assert.equal(page.full.textContent, 'Hi!');
});
