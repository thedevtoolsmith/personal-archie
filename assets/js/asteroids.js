(() => {
    "use strict";

    const SOURCE_SELECTOR = ".content";
    const UI_ATTRIBUTE = "data-text-asteroids-ui";
    const LOCKED_CLASS = "text-asteroids-locked";
    const ACTIVE_CLASS = "text-asteroids-active";
    const SHORTCUT_CODE = "KeyA";
    const GRID_SIZE = 64;
    const MAX_FRAME_SECONDS = 1 / 30;
    const BULLET_SPEED = 720;
    const BULLET_LIFETIME = 1.25;
    const FIRE_INTERVAL = 0.12;
    const MAX_BULLETS = 72;
    const COMPLETION_DELAY = 320;
    const GLYPH_MIN_SPEED = 42;
    const GLYPH_MAX_SPEED = 88;
    const GLYPH_MAX_SPIN = 0.9;
    const SHIP_COLLISION_RADIUS = 8;
    const SHIP_SPAWN_GRACE = 1100;
    const SHIP_POINTER_RESPONSE = 38;
    const SHIP_ANGLE_RESPONSE = 18;
    const SHIP_KEYBOARD_SPEED = 480;
    const POWER_UP_DROP_CHANCE = 0.04;
    const POWER_UP_LIFETIME = 8;
    const POWER_UP_RADIUS = 13;
    const POWER_UP_MIN_SPEED = 28;
    const POWER_UP_MAX_SPEED = 46;
    const POWER_UP_MAGNET_RADIUS = 60;
    const POWER_UP_MAGNET_RESPONSE = 8;
    const POWER_UP_PITY_KILLS = 20;
    const SPREAD_ANGLE = 0.18;
    const PIERCING_HITS = 5;
    const SLOW_TIME_FACTOR = 0.5;
    const BOMB_RADIUS = 145;
    const FONT_WAIT_LIMIT = 1500;
    const HELP_LIFETIME = 5200;
    const RESULT_STATES = new Set(["completed", "game-over"]);
    const POWER_UP_DEFINITIONS = Object.freeze({
        shield: Object.freeze({ type: "shield", symbol: "○", label: "Shield", weight: 30 }),
        spread: Object.freeze({ type: "spread", symbol: "⋘", label: "Spread shot", weight: 24, duration: 6000 }),
        piercing: Object.freeze({ type: "piercing", symbol: "→", label: "Piercing shot", weight: 24, duration: 5000 }),
        slow: Object.freeze({ type: "slow", symbol: "◷", label: "Slow time", weight: 17, duration: 4000 }),
        bomb: Object.freeze({ type: "bomb", symbol: "⌫", label: "Backspace bomb", weight: 5 }),
    });
    const POWER_UP_CHOICES = Object.freeze(Object.values(POWER_UP_DEFINITIONS));
    const POWER_UP_TOTAL_WEIGHT = POWER_UP_CHOICES.reduce(
        (total, definition) => total + definition.weight,
        0,
    );
    const SKIPPED_ANCESTORS = [
        "script",
        "style",
        "noscript",
        "template",
        "textarea",
        "select",
        "option",
        "svg",
        "canvas",
        `[${UI_ATTRIBUTE}]`,
    ].join(",");
    const CLIPPING_VALUES = new Set(["auto", "clip", "hidden", "scroll"]);
    const CANVAS_FONT_STRETCHES = [
        [50, "ultra-condensed"],
        [62.5, "extra-condensed"],
        [75, "condensed"],
        [87.5, "semi-condensed"],
        [100, "normal"],
        [112.5, "semi-expanded"],
        [125, "expanded"],
        [150, "extra-expanded"],
        [200, "ultra-expanded"],
    ];
    const CANVAS_FONT_STRETCH_VALUES = new Set(
        CANVAS_FONT_STRETCHES.map(([, keyword]) => keyword),
    );

    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
    const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
    const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const easedAngle = (current, target, amount) => {
        const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
        return current + difference * amount;
    };
    const normalizeCanvasFontStretch = (value) => {
        if (CANVAS_FONT_STRETCH_VALUES.has(value)) {
            return value;
        }

        if (typeof value !== "string" || !value.endsWith("%")) {
            return "normal";
        }

        const percentage = Number.parseFloat(value);

        if (!Number.isFinite(percentage)) {
            return "normal";
        }

        return CANVAS_FONT_STRETCHES.reduce((closest, candidate) => (
            Math.abs(candidate[0] - percentage) < Math.abs(closest[0] - percentage)
                ? candidate
                : closest
        ))[1];
    };
    const choosePowerUp = () => {
        let roll = Math.random() * POWER_UP_TOTAL_WEIGHT;

        for (const definition of POWER_UP_CHOICES) {
            roll -= definition.weight;

            if (roll < 0) {
                return definition;
            }
        }

        return POWER_UP_CHOICES[POWER_UP_CHOICES.length - 1];
    };

    const isEditableTarget = (target) => {
        if (!(target instanceof Element)) {
            return false;
        }

        return Boolean(
            target.closest(
                "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
            ),
        );
    };

    const isWhitespace = (text) => !text || !text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, "");

    const isTransparentColor = (color) => {
        if (!color || color === "transparent") {
            return true;
        }

        const rgbaMatch = color.match(/^rgba?\((.+)\)$/i);

        if (!rgbaMatch) {
            return false;
        }

        const slashParts = rgbaMatch[1].split("/");

        if (slashParts.length === 2) {
            return Number.parseFloat(slashParts[1]) === 0;
        }

        const commaParts = rgbaMatch[1].split(",");
        return commaParts.length === 4 && Number.parseFloat(commaParts[3]) === 0;
    };

    const intersection = (first, second) => {
        const left = Math.max(first.left, second.left);
        const top = Math.max(first.top, second.top);
        const right = Math.min(first.right, second.right);
        const bottom = Math.min(first.bottom, second.bottom);

        if (right - left <= 0.5 || bottom - top <= 0.5) {
            return null;
        }

        return { left, top, right, bottom };
    };

    const pointIsUnoccluded = (element, x, y) => {
        const topElement = document.elementFromPoint(x, y);

        if (!topElement) {
            return false;
        }

        return (
            topElement === element ||
            element.contains(topElement) ||
            topElement.contains(element)
        );
    };

    const formatDuration = (milliseconds) => {
        const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const parts = [];

        if (minutes > 0) {
            parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
        }

        if (seconds > 0 || minutes === 0) {
            parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
        }

        return parts.join(" and ");
    };

    const segmentText = (text, segmenter) => (
        Array.from(segmenter.segment(text), ({ segment, index }) => ({ segment, index }))
    );

    const segmentHitsCircle = (x1, y1, x2, y2, circleX, circleY, radius) => {
        const segmentX = x2 - x1;
        const segmentY = y2 - y1;
        const lengthSquared = segmentX * segmentX + segmentY * segmentY;
        let amount = 0;

        if (lengthSquared > 0) {
            amount = clamp(
                ((circleX - x1) * segmentX + (circleY - y1) * segmentY) / lengthSquared,
                0,
                1,
            );
        }

        const closestX = x1 + segmentX * amount;
        const closestY = y1 + segmentY * amount;
        const distanceX = circleX - closestX;
        const distanceY = circleY - closestY;

        return distanceX * distanceX + distanceY * distanceY <= radius * radius;
    };

    class TextAsteroids {
        constructor(source) {
            this.source = source;
            this.state = "idle";
            this.session = 0;
            this.animationFrame = 0;
            this.helpTimer = 0;
            this.dialogTimer = 0;
            this.glyphs = [];
            this.initialGlyphs = [];
            this.bullets = [];
            this.particles = [];
            this.impactRings = [];
            this.powerUps = [];
            this.activeWeapon = null;
            this.slowUntil = 0;
            this.shieldCharges = 0;
            this.killsSincePowerUp = 0;
            this.grid = new Map();
            this.collisionToken = 0;
            this.remaining = 0;
            this.pixelRatio = 1;
            this.viewportWidth = window.innerWidth;
            this.viewportHeight = window.innerHeight;
            this.initialViewport = null;
            this.lastFrameTime = 0;
            this.startedAt = 0;
            this.pausedAt = 0;
            this.pausedDuration = 0;
            this.finishedDuration = 0;
            this.completionStartedAt = 0;
            this.lastShotAt = -Infinity;
            this.pointerFiring = false;
            this.keyboardFiring = false;
            this.activePointerId = null;
            this.movementKeys = new Set();
            this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            this.coarsePointer = window.matchMedia("(pointer: coarse)").matches;
            this.ship = {
                x: window.innerWidth / 2,
                y: window.innerHeight * 0.78,
                previousX: window.innerWidth / 2,
                previousY: window.innerHeight * 0.78,
                targetX: window.innerWidth / 2,
                targetY: window.innerHeight * 0.78,
                angle: -Math.PI / 2,
                targetAngle: -Math.PI / 2,
            };
            this.lastPointer = {
                x: window.innerWidth / 2,
                y: window.innerHeight * 0.78,
                seen: false,
                pointerType: "",
            };
            this.previousFocus = null;
            this.sourceState = null;
            this.scrollPosition = { x: 0, y: 0 };
            this.previousScrollbarVariable = "";
            this.viewportLocked = false;
            this.tearingDown = false;
            this.accentColor = "#ff0000";
            this.foregroundColor = "#232333";
            this.panelColor = "rgba(245, 245, 245, 0.94)";

            this.createInterface();

            if (!this.context) {
                return;
            }

            this.bindEvents();
        }

        createInterface() {
            this.launcher = document.createElement("button");
            this.launcher.type = "button";
            this.launcher.className = "text-asteroids-launcher";
            this.launcher.setAttribute(UI_ATTRIBUTE, "");
            this.launcher.setAttribute("aria-label", "Play Asteroids with the visible text on this page");
            this.launcher.setAttribute("aria-keyshortcuts", "Alt+Shift+A");
            this.launcher.title = "Play text Asteroids (Alt+Shift+A)";

            const launcherShip = document.createElement("span");
            launcherShip.className = "text-asteroids-launcher__ship";
            launcherShip.setAttribute("aria-hidden", "true");
            launcherShip.textContent = "▲";

            const launcherLabel = document.createElement("span");
            launcherLabel.className = "text-asteroids-launcher__label";
            launcherLabel.textContent = "Asteroids";

            this.launcher.append(launcherShip, launcherLabel);

            this.stage = document.createElement("div");
            this.stage.className = "text-asteroids-game";
            this.stage.setAttribute(UI_ATTRIBUTE, "");
            this.stage.setAttribute("role", "region");
            this.stage.setAttribute("aria-label", "Text Asteroids game");
            this.stage.setAttribute("aria-hidden", "true");
            this.stage.tabIndex = -1;
            this.stage.hidden = true;

            this.canvas = document.createElement("canvas");
            this.canvas.className = "text-asteroids-canvas";
            this.canvas.setAttribute(UI_ATTRIBUTE, "");
            this.canvas.setAttribute("aria-hidden", "true");

            this.exitButton = document.createElement("button");
            this.exitButton.type = "button";
            this.exitButton.className = "text-asteroids-exit";
            this.exitButton.setAttribute(UI_ATTRIBUTE, "");
            this.exitButton.setAttribute("aria-label", "Exit Text Asteroids");
            this.exitButton.append(document.createTextNode("Exit "));
            const escapeHint = document.createElement("kbd");
            escapeHint.textContent = "Esc";
            this.exitButton.append(escapeHint);

            this.help = document.createElement("p");
            this.help.className = "text-asteroids-help";
            this.help.setAttribute(UI_ATTRIBUTE, "");
            this.updateHelpText();

            this.stage.append(this.canvas, this.exitButton, this.help);
            this.context = this.canvas.getContext("2d", { alpha: true });

            if (!this.context) {
                return;
            }

            this.status = document.createElement("div");
            this.status.className = "text-asteroids-status";
            this.status.setAttribute(UI_ATTRIBUTE, "");
            this.status.setAttribute("role", "status");
            this.status.setAttribute("aria-live", "polite");
            this.status.setAttribute("aria-atomic", "true");

            this.dialog = document.createElement("dialog");
            this.dialog.className = "text-asteroids-dialog";
            this.dialog.setAttribute(UI_ATTRIBUTE, "");
            this.dialog.setAttribute("aria-labelledby", "text-asteroids-dialog-title");
            this.dialog.setAttribute("aria-describedby", "text-asteroids-dialog-message");

            this.dialogTitle = document.createElement("h2");
            this.dialogTitle.id = "text-asteroids-dialog-title";
            this.dialogTitle.textContent = "Mission complete";

            this.dialogMessage = document.createElement("p");
            this.dialogMessage.id = "text-asteroids-dialog-message";

            this.dialogActions = document.createElement("div");
            this.dialogActions.className = "text-asteroids-dialog__actions";

            this.restartButton = document.createElement("button");
            this.restartButton.type = "button";
            this.restartButton.className = "text-asteroids-dialog__button";
            this.restartButton.textContent = "Try again";
            this.restartButton.hidden = true;

            this.dialogButton = document.createElement("button");
            this.dialogButton.type = "button";
            this.dialogButton.className = "text-asteroids-dialog__button text-asteroids-dialog__button--secondary";
            this.dialogButton.textContent = "Return to the blog";

            this.dialogActions.append(this.restartButton, this.dialogButton);
            this.dialog.append(this.dialogTitle, this.dialogMessage, this.dialogActions);
            document.body.append(this.launcher, this.stage, this.status, this.dialog);
        }

        bindEvents() {
            this.launcher.addEventListener("pointerdown", (event) => {
                this.rememberPointer(event);
                event.stopPropagation();
            });
            this.launcher.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.start();
            });

            this.exitButton.addEventListener("pointerdown", (event) => event.stopPropagation());
            this.exitButton.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.stop("Game exited.");
            });

            this.restartButton.addEventListener("pointerdown", (event) => this.rememberPointer(event));
            this.restartButton.addEventListener("click", () => this.restartRound());
            this.dialogButton.addEventListener("click", () => this.closeCompletionDialog());
            this.dialog.addEventListener("cancel", (event) => {
                event.preventDefault();
                this.closeCompletionDialog();
            });
            this.dialog.addEventListener("close", () => {
                if (RESULT_STATES.has(this.state)) {
                    this.teardown({ restoreFocus: true });
                }
            });

            this.stage.addEventListener("pointermove", (event) => this.handlePointerMove(event));
            this.stage.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
            this.stage.addEventListener("pointerup", (event) => this.handlePointerUp(event));
            this.stage.addEventListener("pointercancel", (event) => this.handlePointerUp(event));
            this.stage.addEventListener("contextmenu", (event) => event.preventDefault());

            document.addEventListener("keydown", (event) => this.handleKeyDown(event));
            document.addEventListener("keyup", (event) => this.handleKeyUp(event));
            document.addEventListener("pointermove", (event) => this.rememberPointer(event), {
                capture: true,
                passive: true,
            });
            document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
            window.addEventListener("blur", () => this.clearActiveControls());
            window.addEventListener("resize", () => this.handleResize());
            window.addEventListener("pagehide", () => this.teardown({ restoreFocus: false }));
        }

        announce(message) {
            this.status.textContent = "";
            window.setTimeout(() => {
                this.status.textContent = message;
            }, 0);
        }

        updateHelpText(pointerType = this.lastPointer.pointerType) {
            const touchInput = pointerType === "touch" || (!pointerType && this.coarsePointer);
            this.help.textContent = touchInput
                ? "Drag to steer · Hold to fire · Collect glowing symbols"
                : "Move the pointer or use arrow keys to dodge · Click, hold, or press Space to fire · Collect glowing symbols";
        }

        showHelp() {
            this.help.classList.remove("is-dismissed");
            window.clearTimeout(this.helpTimer);
            this.helpTimer = window.setTimeout(() => {
                this.help.classList.add("is-dismissed");
            }, HELP_LIFETIME);
        }

        async start() {
            if (this.state !== "idle") {
                return;
            }

            const session = ++this.session;
            this.state = "starting";
            this.previousFocus = document.activeElement;
            this.launcher.disabled = true;
            this.launcher.setAttribute("aria-busy", "true");
            this.announce("Preparing Text Asteroids.");

            try {
                if (document.fonts?.ready) {
                    await Promise.race([document.fonts.ready, wait(FONT_WAIT_LIMIT)]);
                }

                if (session !== this.session || this.state !== "starting") {
                    return;
                }

                this.lockViewport();
                await nextFrame();

                if (session !== this.session || this.state !== "starting") {
                    return;
                }

                const glyphs = this.captureVisibleGlyphs();

                if (glyphs.length === 0) {
                    this.teardown({ restoreFocus: true });
                    this.announce("There is no visible text to turn into asteroids.");
                    return;
                }

                this.begin(glyphs);
            } catch (error) {
                console.error("Text Asteroids could not start:", error);
                this.teardown({ restoreFocus: true });
                this.announce("Text Asteroids could not start on this page.");
            }
        }

        lockViewport() {
            this.scrollPosition = { x: window.scrollX, y: window.scrollY };
            this.previousScrollbarVariable = document.body.style.getPropertyValue(
                "--text-asteroids-scrollbar-width",
            );
            const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
            document.body.style.setProperty("--text-asteroids-scrollbar-width", `${scrollbarWidth}px`);
            document.documentElement.classList.add(LOCKED_CLASS);
            this.viewportLocked = true;
        }

        captureVisibleGlyphs() {
            const viewport = {
                left: 0,
                top: 0,
                right: window.innerWidth,
                bottom: window.innerHeight,
            };
            const styleCache = new WeakMap();
            const opacityCache = new WeakMap();
            const clipCache = new WeakMap();
            const segmenter = new Intl.Segmenter(document.documentElement.lang || undefined, {
                granularity: "grapheme",
            });
            const walker = document.createTreeWalker(
                this.source,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: (node) => {
                        if (isWhitespace(node.nodeValue)) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        const parent = node.parentElement;

                        if (!parent || parent.closest(SKIPPED_ANCESTORS)) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        return NodeFilter.FILTER_ACCEPT;
                    },
                },
            );
            const nodes = [];

            while (walker.nextNode()) {
                nodes.push(walker.currentNode);
            }

            const range = document.createRange();
            const captured = [];

            for (const node of nodes) {
                const parent = node.parentElement;
                const style = this.getStyleRecord(parent, styleCache, opacityCache);

                if (!style.visible) {
                    continue;
                }

                const clipBounds = this.getClipBounds(parent, viewport, clipCache);

                if (!clipBounds) {
                    continue;
                }

                range.selectNodeContents(node);
                let nodeIntersectsViewport = false;

                for (const rect of range.getClientRects()) {
                    if (intersection(rect, clipBounds)) {
                        nodeIntersectsViewport = true;
                        break;
                    }
                }

                if (!nodeIntersectsViewport) {
                    continue;
                }

                for (const { segment, index } of segmentText(node.nodeValue, segmenter)) {
                    if (isWhitespace(segment)) {
                        continue;
                    }

                    try {
                        range.setStart(node, index);
                        range.setEnd(node, index + segment.length);
                    } catch (_error) {
                        continue;
                    }

                    let chosenRect = null;

                    for (const rect of range.getClientRects()) {
                        if (rect.width <= 0.25 || rect.height <= 0.25) {
                            continue;
                        }

                        const visibleRect = intersection(rect, clipBounds);

                        if (!visibleRect) {
                            continue;
                        }

                        const centerX = (visibleRect.left + visibleRect.right) / 2;
                        const centerY = (visibleRect.top + visibleRect.bottom) / 2;

                        if (!pointIsUnoccluded(parent, centerX, centerY)) {
                            continue;
                        }

                        chosenRect = rect;
                        break;
                    }

                    if (!chosenRect) {
                        continue;
                    }

                    const width = Math.max(1, chosenRect.width);
                    const height = Math.max(1, chosenRect.height);
                    const radius = clamp(Math.hypot(width, height) * 0.42, 6, 24);
                    const direction = randomBetween(0, Math.PI * 2);
                    const speed = this.reducedMotion
                        ? 0
                        : randomBetween(GLYPH_MIN_SPEED, GLYPH_MAX_SPEED);

                    captured.push({
                        text: segment,
                        x: chosenRect.left + chosenRect.width / 2,
                        y: chosenRect.top + chosenRect.height / 2,
                        previousX: chosenRect.left + chosenRect.width / 2,
                        previousY: chosenRect.top + chosenRect.height / 2,
                        width,
                        height,
                        radius,
                        angle: 0,
                        velocityX: Math.cos(direction) * speed,
                        velocityY: Math.sin(direction) * speed,
                        spin: this.reducedMotion ? 0 : randomBetween(-GLYPH_MAX_SPIN, GLYPH_MAX_SPIN),
                        color: style.color,
                        opacity: style.opacity,
                        font: style.font,
                        fontKerning: style.fontKerning,
                        fontStretch: style.fontStretch,
                        fontVariantCaps: style.fontVariantCaps,
                        letterSpacing: style.letterSpacing,
                        direction: style.direction,
                        baselineOffset: 0,
                        alive: true,
                        collisionToken: 0,
                    });
                }
            }

            range.detach?.();
            return captured;
        }

        getStyleRecord(element, styleCache, opacityCache) {
            const existing = styleCache.get(element);

            if (existing) {
                return existing;
            }

            const computed = window.getComputedStyle(element);
            const opacity = this.getEffectiveOpacity(element, opacityCache);
            const fillColor = computed.webkitTextFillColor;
            const color = fillColor && !isTransparentColor(fillColor) ? fillColor : computed.color;
            const visible = (
                computed.display !== "none" &&
                computed.visibility === "visible" &&
                computed.contentVisibility !== "hidden" &&
                opacity > 0.01 &&
                !isTransparentColor(color)
            );
            const record = {
                visible,
                opacity,
                color,
                font: computed.font || `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`,
                fontKerning: computed.fontKerning,
                fontStretch: normalizeCanvasFontStretch(computed.fontStretch),
                fontVariantCaps: computed.fontVariantCaps,
                letterSpacing: computed.letterSpacing,
                direction: computed.direction,
            };
            styleCache.set(element, record);
            return record;
        }

        getEffectiveOpacity(element, opacityCache) {
            if (!element || !this.source.contains(element)) {
                return 1;
            }

            const existing = opacityCache.get(element);

            if (existing !== undefined) {
                return existing;
            }

            const ownOpacity = Number.parseFloat(window.getComputedStyle(element).opacity);
            const parentOpacity = element === this.source
                ? 1
                : this.getEffectiveOpacity(element.parentElement, opacityCache);
            const opacity = (Number.isFinite(ownOpacity) ? ownOpacity : 1) * parentOpacity;
            opacityCache.set(element, opacity);
            return opacity;
        }

        getClipBounds(element, viewport, clipCache) {
            const existing = clipCache.get(element);

            if (existing !== undefined) {
                return existing;
            }

            let bounds = { ...viewport };
            let current = element;

            while (current && current instanceof HTMLElement) {
                const computed = window.getComputedStyle(current);
                const clipsX = CLIPPING_VALUES.has(computed.overflowX);
                const clipsY = CLIPPING_VALUES.has(computed.overflowY);

                if (clipsX || clipsY) {
                    const rect = current.getBoundingClientRect();
                    const clippingRect = {
                        left: clipsX ? rect.left : bounds.left,
                        top: clipsY ? rect.top : bounds.top,
                        right: clipsX ? rect.right : bounds.right,
                        bottom: clipsY ? rect.bottom : bounds.bottom,
                    };
                    bounds = intersection(bounds, clippingRect);

                    if (!bounds) {
                        break;
                    }
                }

                if (current === this.source) {
                    break;
                }

                current = current.parentElement;
            }

            clipCache.set(element, bounds);
            return bounds;
        }

        begin(glyphs) {
            this.glyphs = glyphs;
            this.initialGlyphs = [];
            this.bullets = [];
            this.particles = [];
            this.impactRings = [];
            this.powerUps = [];
            this.activeWeapon = null;
            this.slowUntil = 0;
            this.shieldCharges = 0;
            this.killsSincePowerUp = 0;
            this.remaining = glyphs.length;
            this.pointerFiring = false;
            this.keyboardFiring = false;
            this.activePointerId = null;
            this.movementKeys.clear();
            this.finishedDuration = 0;
            this.pausedAt = 0;
            this.pausedDuration = 0;
            this.lastShotAt = -Infinity;
            this.viewportWidth = window.innerWidth;
            this.viewportHeight = window.innerHeight;
            this.initialViewport = {
                width: this.viewportWidth,
                height: this.viewportHeight,
                pixelRatio: window.devicePixelRatio || 1,
            };
            this.ship.x = this.lastPointer.seen
                ? clamp(this.lastPointer.x, 10, this.viewportWidth - 10)
                : this.viewportWidth / 2;
            this.ship.y = this.lastPointer.seen
                ? clamp(this.lastPointer.y, 10, this.viewportHeight - 10)
                : this.viewportHeight * 0.78;
            this.ship.previousX = this.ship.x;
            this.ship.previousY = this.ship.y;
            this.ship.targetX = this.ship.x;
            this.ship.targetY = this.ship.y;
            this.ship.angle = -Math.PI / 2;
            this.ship.targetAngle = -Math.PI / 2;

            const bodyStyle = window.getComputedStyle(document.body);
            this.accentColor = bodyStyle.getPropertyValue("--toc-accent").trim()
                || bodyStyle.getPropertyValue("--maincolor").trim()
                || "#ff0000";
            this.foregroundColor = bodyStyle.color || "#232333";
            this.panelColor = bodyStyle.getPropertyValue("--outline-panel-bg").trim()
                || "rgba(245, 245, 245, 0.94)";

            this.resizeCanvas();
            this.prepareGlyphMetrics();
            this.initialGlyphs = this.cloneGlyphs(this.glyphs);
            this.hideSource();
            this.canvas.dataset.remaining = String(this.remaining);
            this.stage.hidden = false;
            this.stage.setAttribute("aria-hidden", "false");
            this.stage.inert = false;
            this.updateHelpText();
            this.launcher.disabled = false;
            this.launcher.removeAttribute("aria-busy");
            this.state = "running";
            this.startedAt = performance.now();
            this.lastFrameTime = this.startedAt;
            this.stage.focus({ preventScroll: true });
            this.announce("Text Asteroids started. Destroy every visible character, avoid collisions, and collect glowing power-ups.");
            this.showHelp();

            this.animationFrame = window.requestAnimationFrame((time) => this.frame(time));
        }

        cloneGlyphs(glyphs) {
            return glyphs.map((glyph) => ({
                ...glyph,
                previousX: glyph.x,
                previousY: glyph.y,
                alive: true,
                collisionToken: 0,
            }));
        }

        prepareGlyphMetrics() {
            const metricsCache = new Map();

            for (const glyph of this.glyphs) {
                const key = [
                    glyph.font,
                    glyph.fontKerning,
                    glyph.fontStretch,
                    glyph.fontVariantCaps,
                    glyph.letterSpacing,
                    glyph.text,
                ].join("\u0000");
                let baselineOffset = metricsCache.get(key);

                if (baselineOffset === undefined) {
                    this.applyTextStyle(glyph);
                    const metrics = this.context.measureText(glyph.text);
                    const ascent = metrics.fontBoundingBoxAscent
                        || metrics.actualBoundingBoxAscent
                        || glyph.height * 0.78;
                    const descent = metrics.fontBoundingBoxDescent
                        || metrics.actualBoundingBoxDescent
                        || glyph.height * 0.22;
                    baselineOffset = (ascent - descent) / 2;
                    metricsCache.set(key, baselineOffset);
                }

                glyph.baselineOffset = baselineOffset;
            }
        }

        hideSource() {
            this.sourceState = {
                hadInert: this.source.hasAttribute("inert"),
                ariaHidden: this.source.getAttribute("aria-hidden"),
            };
            this.source.inert = true;
            this.source.setAttribute("aria-hidden", "true");
            document.documentElement.classList.add(ACTIVE_CLASS);
        }

        resizeCanvas() {
            this.viewportWidth = window.innerWidth;
            this.viewportHeight = window.innerHeight;
            this.pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
            this.canvas.width = Math.round(this.viewportWidth * this.pixelRatio);
            this.canvas.height = Math.round(this.viewportHeight * this.pixelRatio);
            this.canvas.style.width = `${this.viewportWidth}px`;
            this.canvas.style.height = `${this.viewportHeight}px`;
        }

        applyTextStyle(glyph) {
            const context = this.context;
            context.font = glyph.font;

            if ("fontKerning" in context && glyph.fontKerning) {
                context.fontKerning = glyph.fontKerning;
            }

            if ("fontStretch" in context && glyph.fontStretch) {
                context.fontStretch = glyph.fontStretch;
            }

            if ("fontVariantCaps" in context && glyph.fontVariantCaps) {
                context.fontVariantCaps = glyph.fontVariantCaps;
            }

            if ("letterSpacing" in context && glyph.letterSpacing) {
                context.letterSpacing = glyph.letterSpacing;
            }

            context.direction = glyph.direction === "rtl" ? "rtl" : "ltr";
        }

        handlePointerMove(event) {
            if (this.state !== "running") {
                return;
            }

            if (event.target instanceof Element && event.target.closest("button, dialog")) {
                return;
            }

            this.movementKeys.clear();
            const nextX = clamp(event.clientX, 10, this.viewportWidth - 10);
            const nextY = clamp(event.clientY, 10, this.viewportHeight - 10);
            const deltaX = nextX - this.ship.targetX;
            const deltaY = nextY - this.ship.targetY;

            if (Math.hypot(deltaX, deltaY) > 1.5) {
                this.ship.targetAngle = Math.atan2(deltaY, deltaX);
            }

            this.ship.targetX = nextX;
            this.ship.targetY = nextY;
        }

        rememberPointer(event) {
            if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
                return;
            }

            const previousPointerType = this.lastPointer.pointerType;
            this.lastPointer.x = event.clientX;
            this.lastPointer.y = event.clientY;
            this.lastPointer.seen = true;

            if (event.pointerType) {
                this.lastPointer.pointerType = event.pointerType;
            }

            if (this.lastPointer.pointerType !== previousPointerType) {
                this.updateHelpText();

                if (this.state === "running") {
                    this.showHelp();
                }
            }
        }

        handlePointerDown(event) {
            if (this.state !== "running") {
                return;
            }

            if (event.target instanceof Element && event.target.closest("button, dialog")) {
                return;
            }

            event.preventDefault();
            this.rememberPointer(event);
            this.handlePointerMove(event);
            this.pointerFiring = true;
            this.activePointerId = event.pointerId;

            try {
                this.stage.setPointerCapture(event.pointerId);
            } catch (_error) {
                // Pointer capture is an enhancement; firing still works without it.
            }

            this.fire(performance.now());
        }

        handlePointerUp(event) {
            if (this.activePointerId !== event.pointerId) {
                return;
            }

            this.pointerFiring = false;
            this.activePointerId = null;

            try {
                this.stage.releasePointerCapture(event.pointerId);
            } catch (_error) {
                // The pointer may already have been released by the browser.
            }
        }

        handleKeyDown(event) {
            if (
                RESULT_STATES.has(this.state) &&
                this.dialogIsOpen() &&
                this.dialog.classList.contains("is-fallback") &&
                event.key === "Tab"
            ) {
                event.preventDefault();
                const buttons = [this.restartButton, this.dialogButton].filter((button) => !button.hidden);
                const currentIndex = buttons.indexOf(document.activeElement);
                const direction = event.shiftKey ? -1 : 1;
                const nextIndex = currentIndex === -1
                    ? 0
                    : (currentIndex + direction + buttons.length) % buttons.length;
                buttons[nextIndex].focus({ preventScroll: true });
                return;
            }

            const shortcutPressed = (
                event.code === SHORTCUT_CODE &&
                event.altKey &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey
            );

            if (shortcutPressed && !event.repeat && !event.isComposing && !isEditableTarget(event.target)) {
                event.preventDefault();
                this.start();
                return;
            }

            if (event.key === "Escape") {
                if (this.dialogIsOpen()) {
                    event.preventDefault();
                    this.closeCompletionDialog();
                    return;
                }

                if (this.state !== "idle") {
                    event.preventDefault();
                    this.stop("Game exited.");
                }
                return;
            }

            if (this.state !== "running" || isEditableTarget(event.target)) {
                return;
            }

            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();

                if (this.movementKeys.size === 0) {
                    this.ship.targetX = this.ship.x;
                    this.ship.targetY = this.ship.y;
                }

                this.movementKeys.add(event.key);
                return;
            }

            if (
                (event.code === "Space" || event.key === " ") &&
                !(event.target instanceof Element && event.target.closest("button"))
            ) {
                event.preventDefault();
                this.keyboardFiring = true;

                if (!event.repeat) {
                    this.fire(performance.now());
                }
            }
        }

        handleKeyUp(event) {
            this.movementKeys.delete(event.key);

            if (event.code === "Space" || event.key === " ") {
                this.keyboardFiring = false;
            }
        }

        handleVisibilityChange() {
            if (!["running", "finishing"].includes(this.state)) {
                return;
            }

            if (document.hidden && !this.pausedAt) {
                this.pausedAt = performance.now();
                this.clearActiveControls();
                window.cancelAnimationFrame(this.animationFrame);
                this.animationFrame = 0;
                return;
            }

            if (!document.hidden && this.pausedAt) {
                const now = performance.now();
                const pauseLength = now - this.pausedAt;
                this.pausedDuration += pauseLength;

                if (this.state === "finishing") {
                    this.completionStartedAt += pauseLength;
                }

                this.pausedAt = 0;
                this.lastFrameTime = now;
                this.animationFrame = window.requestAnimationFrame((time) => this.frame(time));
            }
        }

        clearActiveControls() {
            this.pointerFiring = false;
            this.keyboardFiring = false;
            this.movementKeys.clear();
            this.ship.targetX = this.ship.x;
            this.ship.targetY = this.ship.y;

            if (this.activePointerId !== null) {
                try {
                    this.stage.releasePointerCapture(this.activePointerId);
                } catch (_error) {
                    // The pointer may already have been released.
                }
            }

            this.activePointerId = null;
        }

        handleResize() {
            if (!["running", "finishing"].includes(this.state) || !this.initialViewport) {
                return;
            }

            const widthChanged = Math.abs(window.innerWidth - this.initialViewport.width) > 2;
            const pixelRatioChanged = (
                Math.abs((window.devicePixelRatio || 1) - this.initialViewport.pixelRatio) > 0.01
            );

            if (widthChanged || pixelRatioChanged) {
                this.stop("The game ended because the viewport changed.");
                return;
            }

            if (Math.abs(window.innerHeight - this.initialViewport.height) > 2) {
                this.initialViewport.height = window.innerHeight;
                this.resizeCanvas();
                this.ship.y = clamp(this.ship.y, 10, this.viewportHeight - 10);
                this.ship.previousY = clamp(this.ship.previousY, 10, this.viewportHeight - 10);
                this.ship.targetY = clamp(this.ship.targetY, 10, this.viewportHeight - 10);

                for (const glyph of this.glyphs) {
                    const verticalSpan = this.viewportHeight + glyph.radius * 2;

                    if (glyph.y < -glyph.radius) {
                        glyph.y += verticalSpan;
                    } else if (glyph.y > this.viewportHeight + glyph.radius) {
                        glyph.y -= verticalSpan;
                    }
                }

                for (const powerUp of this.powerUps) {
                    const verticalSpan = this.viewportHeight + powerUp.radius * 2;

                    if (powerUp.y < -powerUp.radius) {
                        powerUp.y += verticalSpan;
                    } else if (powerUp.y > this.viewportHeight + powerUp.radius) {
                        powerUp.y -= verticalSpan;
                    }
                }
            }
        }

        updateKeyboardShip(deltaSeconds) {
            let horizontal = 0;
            let vertical = 0;

            if (this.movementKeys.has("ArrowLeft")) horizontal -= 1;
            if (this.movementKeys.has("ArrowRight")) horizontal += 1;
            if (this.movementKeys.has("ArrowUp")) vertical -= 1;
            if (this.movementKeys.has("ArrowDown")) vertical += 1;

            if (horizontal === 0 && vertical === 0) {
                return;
            }

            const length = Math.hypot(horizontal, vertical);
            const directionX = horizontal / length;
            const directionY = vertical / length;
            this.ship.targetAngle = Math.atan2(directionY, directionX);
            this.ship.targetX = clamp(
                this.ship.targetX + directionX * SHIP_KEYBOARD_SPEED * deltaSeconds,
                10,
                this.viewportWidth - 10,
            );
            this.ship.targetY = clamp(
                this.ship.targetY + directionY * SHIP_KEYBOARD_SPEED * deltaSeconds,
                10,
                this.viewportHeight - 10,
            );
        }

        updateShipMotion(deltaSeconds) {
            this.ship.previousX = this.ship.x;
            this.ship.previousY = this.ship.y;

            const positionAmount = 1 - Math.exp(-SHIP_POINTER_RESPONSE * deltaSeconds);
            const angleAmount = 1 - Math.exp(-SHIP_ANGLE_RESPONSE * deltaSeconds);
            this.ship.x += (this.ship.targetX - this.ship.x) * positionAmount;
            this.ship.y += (this.ship.targetY - this.ship.y) * positionAmount;
            this.ship.angle = easedAngle(this.ship.angle, this.ship.targetAngle, angleAmount);

            if (Math.abs(this.ship.targetX - this.ship.x) < 0.05) {
                this.ship.x = this.ship.targetX;
            }

            if (Math.abs(this.ship.targetY - this.ship.y) < 0.05) {
                this.ship.y = this.ship.targetY;
            }
        }

        fire(time) {
            if (this.state !== "running" || this.bullets.length >= MAX_BULLETS) {
                return;
            }

            if (time - this.lastShotAt < FIRE_INTERVAL * 1000) {
                return;
            }

            this.updateActiveEffects(this.elapsedTime(time));
            const weaponType = this.activeWeapon?.type || null;
            const offsets = weaponType === "spread"
                ? [-SPREAD_ANGLE, 0, SPREAD_ANGLE]
                : [0];

            for (const offset of offsets) {
                if (this.bullets.length >= MAX_BULLETS) {
                    break;
                }

                const angle = this.ship.angle + offset;
                const directionX = Math.cos(angle);
                const directionY = Math.sin(angle);
                const startX = this.ship.x + directionX * 13;
                const startY = this.ship.y + directionY * 13;

                this.bullets.push({
                    x: startX,
                    y: startY,
                    previousX: startX,
                    previousY: startY,
                    velocityX: directionX * BULLET_SPEED,
                    velocityY: directionY * BULLET_SPEED,
                    life: BULLET_LIFETIME,
                    hitsRemaining: weaponType === "piercing" ? PIERCING_HITS : 1,
                    piercing: weaponType === "piercing",
                    dead: false,
                });
            }

            this.lastShotAt = time;
        }

        updateActiveEffects(activeElapsed) {
            if (this.activeWeapon && activeElapsed >= this.activeWeapon.until) {
                this.activeWeapon = null;
            }

            if (this.slowUntil && activeElapsed >= this.slowUntil) {
                this.slowUntil = 0;
            }
        }

        frame(time) {
            if (!["running", "finishing"].includes(this.state) || document.hidden) {
                return;
            }

            try {
                const elapsedSeconds = Math.max(0, (time - this.lastFrameTime) / 1000);
                this.lastFrameTime = time;
                const simulationDeltaSeconds = Math.min(MAX_FRAME_SECONDS, elapsedSeconds);
                this.updateImpactFeedback(elapsedSeconds);

                if (simulationDeltaSeconds > 0) {
                    this.update(simulationDeltaSeconds, time);
                }

                this.render();

                if (this.state === "game-over") {
                    return;
                }

                if (this.state === "finishing" && time - this.completionStartedAt >= COMPLETION_DELAY) {
                    this.showCompletion();
                    return;
                }

                this.animationFrame = window.requestAnimationFrame((nextTime) => this.frame(nextTime));
            } catch (error) {
                console.error("Text Asteroids stopped unexpectedly:", error);
                this.teardown({ restoreFocus: true });
                this.announce("Text Asteroids stopped unexpectedly.");
            }
        }

        updateImpactFeedback(deltaSeconds) {
            for (const ring of this.impactRings) {
                ring.life -= deltaSeconds;
            }

            this.impactRings = this.impactRings.filter((ring) => ring.life > 0);
        }

        triggerImpactFeedback(x, y, kind = "hit") {
            const profiles = {
                hit: { startRadius: 4, endRadius: 24, duration: 0.2 },
                shield: { startRadius: 16, endRadius: 42, duration: 0.3 },
                bomb: { startRadius: 18, endRadius: BOMB_RADIUS, duration: 0.38 },
                crash: { startRadius: 12, endRadius: 34, duration: 0.24 },
            };
            const profile = profiles[kind] || profiles.hit;
            const duration = this.reducedMotion ? 0.13 : profile.duration;

            this.impactRings.push({
                x,
                y,
                life: duration,
                maximumLife: duration,
                startRadius: profile.startRadius,
                endRadius: this.reducedMotion ? profile.startRadius : profile.endRadius,
                lineWidth: kind === "shield" || kind === "bomb" ? 3 : 2,
                color: this.accentColor,
            });
        }

        update(deltaSeconds, time) {
            const activeElapsed = this.elapsedTime(time);
            this.updateActiveEffects(activeElapsed);
            const worldDeltaSeconds = this.slowUntil > activeElapsed
                ? deltaSeconds * SLOW_TIME_FACTOR
                : deltaSeconds;

            if (this.state === "running") {
                this.updateKeyboardShip(deltaSeconds);
                this.updateShipMotion(deltaSeconds);
            }

            if (this.state === "running" && (this.pointerFiring || this.keyboardFiring)) {
                this.fire(time);
            }

            for (const glyph of this.glyphs) {
                if (!glyph.alive) {
                    continue;
                }

                glyph.previousX = glyph.x;
                glyph.previousY = glyph.y;
                let wrapped = false;
                glyph.x += glyph.velocityX * worldDeltaSeconds;
                glyph.y += glyph.velocityY * worldDeltaSeconds;
                glyph.angle += glyph.spin * worldDeltaSeconds;

                if (glyph.x < -glyph.radius) {
                    glyph.x += this.viewportWidth + glyph.radius * 2;
                    wrapped = true;
                } else if (glyph.x > this.viewportWidth + glyph.radius) {
                    glyph.x -= this.viewportWidth + glyph.radius * 2;
                    wrapped = true;
                }

                if (glyph.y < -glyph.radius) {
                    glyph.y += this.viewportHeight + glyph.radius * 2;
                    wrapped = true;
                } else if (glyph.y > this.viewportHeight + glyph.radius) {
                    glyph.y -= this.viewportHeight + glyph.radius * 2;
                    wrapped = true;
                }

                if (wrapped) {
                    glyph.previousX = glyph.x;
                    glyph.previousY = glyph.y;
                }
            }

            this.buildCollisionGrid();

            for (const bullet of this.bullets) {
                if (bullet.dead) {
                    continue;
                }

                bullet.previousX = bullet.x;
                bullet.previousY = bullet.y;
                bullet.x += bullet.velocityX * deltaSeconds;
                bullet.y += bullet.velocityY * deltaSeconds;
                bullet.life -= deltaSeconds;

                if (
                    bullet.life <= 0 ||
                    bullet.x < -10 ||
                    bullet.x > this.viewportWidth + 10 ||
                    bullet.y < -10 ||
                    bullet.y > this.viewportHeight + 10
                ) {
                    bullet.dead = true;
                    continue;
                }

                this.checkBulletCollision(bullet, time);
            }

            this.bullets = this.bullets.filter((bullet) => !bullet.dead);
            this.updatePowerUps(deltaSeconds, worldDeltaSeconds, time);

            if (this.checkShipCollision(time)) {
                return;
            }

            for (const particle of this.particles) {
                particle.x += particle.velocityX * deltaSeconds;
                particle.y += particle.velocityY * deltaSeconds;
                particle.velocityX *= Math.pow(0.08, deltaSeconds);
                particle.velocityY *= Math.pow(0.08, deltaSeconds);
                particle.life -= deltaSeconds;
            }

            this.particles = this.particles.filter((particle) => particle.life > 0);
        }

        updatePowerUps(deltaSeconds, worldDeltaSeconds, time) {
            for (const powerUp of this.powerUps) {
                if (powerUp.collected) {
                    continue;
                }

                powerUp.previousX = powerUp.x;
                powerUp.previousY = powerUp.y;
                powerUp.life -= deltaSeconds;
                const magnetX = this.ship.x - powerUp.x;
                const magnetY = this.ship.y - powerUp.y;
                const magnetDistance = Math.hypot(magnetX, magnetY);

                if (magnetDistance > 0 && magnetDistance < POWER_UP_MAGNET_RADIUS) {
                    const proximity = 1 - magnetDistance / POWER_UP_MAGNET_RADIUS;
                    const attraction = (1 - Math.exp(-POWER_UP_MAGNET_RESPONSE * deltaSeconds))
                        * proximity;
                    powerUp.x += magnetX * attraction;
                    powerUp.y += magnetY * attraction;
                }

                let wrapped = false;
                powerUp.x += powerUp.velocityX * worldDeltaSeconds;
                powerUp.y += powerUp.velocityY * worldDeltaSeconds;
                powerUp.angle += powerUp.spin * worldDeltaSeconds;

                if (powerUp.x < -powerUp.radius) {
                    powerUp.x += this.viewportWidth + powerUp.radius * 2;
                    wrapped = true;
                } else if (powerUp.x > this.viewportWidth + powerUp.radius) {
                    powerUp.x -= this.viewportWidth + powerUp.radius * 2;
                    wrapped = true;
                }

                if (powerUp.y < -powerUp.radius) {
                    powerUp.y += this.viewportHeight + powerUp.radius * 2;
                    wrapped = true;
                } else if (powerUp.y > this.viewportHeight + powerUp.radius) {
                    powerUp.y -= this.viewportHeight + powerUp.radius * 2;
                    wrapped = true;
                }

                if (wrapped) {
                    powerUp.previousX = powerUp.x;
                    powerUp.previousY = powerUp.y;
                }

                if (
                    this.state === "running" &&
                    powerUp.life > 0 &&
                    segmentHitsCircle(
                        this.ship.previousX - powerUp.previousX,
                        this.ship.previousY - powerUp.previousY,
                        this.ship.x - powerUp.x,
                        this.ship.y - powerUp.y,
                        0,
                        0,
                        powerUp.radius + SHIP_COLLISION_RADIUS,
                    )
                ) {
                    powerUp.collected = true;
                    this.activatePowerUp(powerUp, time);
                }
            }

            this.powerUps = this.powerUps.filter((powerUp) => (
                !powerUp.collected && powerUp.life > 0
            ));
        }

        maybeDropPowerUp(glyph) {
            if (
                this.state !== "running" ||
                this.remaining <= 0 ||
                this.powerUps.some((powerUp) => !powerUp.collected && powerUp.life > 0)
            ) {
                return false;
            }

            this.killsSincePowerUp += 1;
            const guaranteedDrop = this.killsSincePowerUp >= POWER_UP_PITY_KILLS;

            if (!guaranteedDrop && Math.random() >= POWER_UP_DROP_CHANCE) {
                return false;
            }

            const definition = choosePowerUp();
            const direction = randomBetween(0, Math.PI * 2);
            const speed = this.reducedMotion
                ? 0
                : randomBetween(POWER_UP_MIN_SPEED, POWER_UP_MAX_SPEED);

            this.powerUps.push({
                type: definition.type,
                symbol: definition.symbol,
                label: definition.label,
                x: glyph.x,
                y: glyph.y,
                previousX: glyph.x,
                previousY: glyph.y,
                velocityX: Math.cos(direction) * speed,
                velocityY: Math.sin(direction) * speed,
                angle: 0,
                spin: this.reducedMotion ? 0 : randomBetween(-0.7, 0.7),
                radius: POWER_UP_RADIUS,
                life: POWER_UP_LIFETIME,
                collected: false,
            });
            this.killsSincePowerUp = 0;
            this.announce(`${definition.label} power-up appeared.`);
            return true;
        }

        activatePowerUp(powerUp, time) {
            const definition = POWER_UP_DEFINITIONS[powerUp.type];

            if (!definition) {
                return;
            }

            const activeElapsed = this.elapsedTime(time);
            let announcement = `${definition.label} collected.`;

            if (powerUp.type === "shield") {
                this.shieldCharges = 1;
                announcement = "Shield collected. The next letter collision will be absorbed.";
            } else if (powerUp.type === "spread" || powerUp.type === "piercing") {
                this.activeWeapon = {
                    type: powerUp.type,
                    until: activeElapsed + definition.duration,
                    duration: definition.duration,
                };
                announcement = `${definition.label} active for ${definition.duration / 1000} seconds.`;
            } else if (powerUp.type === "slow") {
                this.slowUntil = activeElapsed + definition.duration;
                announcement = `Slow time active for ${definition.duration / 1000} seconds.`;
            } else if (powerUp.type === "bomb") {
                const destroyed = this.activateBackspaceBomb(powerUp.x, powerUp.y, time);
                announcement = destroyed === 1
                    ? "Backspace bomb erased 1 nearby letter."
                    : `Backspace bomb erased ${destroyed} nearby letters.`;
            }

            this.spawnPowerUpParticles(powerUp.x, powerUp.y);
            this.announce(announcement);
        }

        activateBackspaceBomb(x, y, time) {
            let destroyed = 0;

            for (const glyph of this.glyphs) {
                if (!glyph.alive || this.state !== "running") {
                    continue;
                }

                if (Math.hypot(glyph.x - x, glyph.y - y) > BOMB_RADIUS + glyph.radius) {
                    continue;
                }

                if (this.destroyGlyph(glyph, time, { allowPowerUp: false })) {
                    destroyed += 1;
                }
            }

            if (destroyed > 0) {
                this.triggerImpactFeedback(x, y, "bomb");
            }

            return destroyed;
        }

        spawnPowerUpParticles(x, y) {
            if (this.reducedMotion) {
                return;
            }

            for (let index = 0; index < 10; index += 1) {
                const direction = randomBetween(0, Math.PI * 2);
                const speed = randomBetween(45, 130);
                this.particles.push({
                    x,
                    y,
                    velocityX: Math.cos(direction) * speed,
                    velocityY: Math.sin(direction) * speed,
                    life: randomBetween(0.28, 0.6),
                    maximumLife: 0.6,
                    color: this.accentColor,
                });
            }
        }

        spawnShieldBreakParticles(x, y) {
            if (this.reducedMotion) {
                return;
            }

            for (let index = 0; index < 18; index += 1) {
                const direction = randomBetween(0, Math.PI * 2);
                const speed = randomBetween(70, 190);
                this.particles.push({
                    x,
                    y,
                    velocityX: Math.cos(direction) * speed,
                    velocityY: Math.sin(direction) * speed,
                    life: randomBetween(0.32, 0.72),
                    maximumLife: 0.72,
                    color: this.accentColor,
                });
            }
        }

        buildCollisionGrid() {
            this.grid.clear();

            for (const glyph of this.glyphs) {
                if (!glyph.alive) {
                    continue;
                }

                const minimumColumn = Math.floor(
                    (Math.min(glyph.previousX, glyph.x) - glyph.radius) / GRID_SIZE,
                );
                const maximumColumn = Math.floor(
                    (Math.max(glyph.previousX, glyph.x) + glyph.radius) / GRID_SIZE,
                );
                const minimumRow = Math.floor(
                    (Math.min(glyph.previousY, glyph.y) - glyph.radius) / GRID_SIZE,
                );
                const maximumRow = Math.floor(
                    (Math.max(glyph.previousY, glyph.y) + glyph.radius) / GRID_SIZE,
                );

                for (let column = minimumColumn; column <= maximumColumn; column += 1) {
                    for (let row = minimumRow; row <= maximumRow; row += 1) {
                        const key = `${column}:${row}`;
                        const bucket = this.grid.get(key);

                        if (bucket) {
                            bucket.push(glyph);
                        } else {
                            this.grid.set(key, [glyph]);
                        }
                    }
                }
            }
        }

        destroyGlyph(glyph, time, { allowPowerUp = true } = {}) {
            if (!glyph.alive) {
                return false;
            }

            glyph.alive = false;
            this.remaining -= 1;
            this.canvas.dataset.remaining = String(this.remaining);
            this.spawnParticles(glyph);

            if (allowPowerUp && this.remaining > 0) {
                this.maybeDropPowerUp(glyph);
            }

            if (this.remaining === 0) {
                this.finishedDuration = this.elapsedTime(time);
                this.completionStartedAt = time;
                this.clearActiveControls();
                this.state = "finishing";
            }

            return true;
        }

        checkShipCollision(time) {
            if (this.state !== "running" || this.elapsedTime(time) < SHIP_SPAWN_GRACE) {
                return false;
            }

            const minimumColumn = Math.floor(
                (Math.min(this.ship.previousX, this.ship.x) - SHIP_COLLISION_RADIUS) / GRID_SIZE,
            );
            const maximumColumn = Math.floor(
                (Math.max(this.ship.previousX, this.ship.x) + SHIP_COLLISION_RADIUS) / GRID_SIZE,
            );
            const minimumRow = Math.floor(
                (Math.min(this.ship.previousY, this.ship.y) - SHIP_COLLISION_RADIUS) / GRID_SIZE,
            );
            const maximumRow = Math.floor(
                (Math.max(this.ship.previousY, this.ship.y) + SHIP_COLLISION_RADIUS) / GRID_SIZE,
            );
            const token = ++this.collisionToken;

            for (let column = minimumColumn; column <= maximumColumn; column += 1) {
                for (let row = minimumRow; row <= maximumRow; row += 1) {
                    const bucket = this.grid.get(`${column}:${row}`);

                    if (!bucket) {
                        continue;
                    }

                    for (const glyph of bucket) {
                        if (!glyph.alive || glyph.collisionToken === token) {
                            continue;
                        }

                        glyph.collisionToken = token;

                        if (
                            !segmentHitsCircle(
                                this.ship.previousX - glyph.previousX,
                                this.ship.previousY - glyph.previousY,
                                this.ship.x - glyph.x,
                                this.ship.y - glyph.y,
                                0,
                                0,
                                glyph.radius + SHIP_COLLISION_RADIUS,
                            )
                        ) {
                            continue;
                        }

                        if (this.shieldCharges > 0) {
                            this.shieldCharges -= 1;
                            this.triggerImpactFeedback(this.ship.x, this.ship.y, "shield");
                            this.destroyGlyph(glyph, time, { allowPowerUp: false });
                            this.spawnShieldBreakParticles(this.ship.x, this.ship.y);
                            this.announce("Shield absorbed a letter collision.");
                            return false;
                        }

                        this.triggerImpactFeedback(this.ship.x, this.ship.y, "crash");
                        this.showGameOver(time);
                        return true;
                    }
                }
            }

            return false;
        }

        checkBulletCollision(bullet, time) {
            const minimumColumn = Math.floor(Math.min(bullet.previousX, bullet.x) / GRID_SIZE);
            const maximumColumn = Math.floor(Math.max(bullet.previousX, bullet.x) / GRID_SIZE);
            const minimumRow = Math.floor(Math.min(bullet.previousY, bullet.y) / GRID_SIZE);
            const maximumRow = Math.floor(Math.max(bullet.previousY, bullet.y) / GRID_SIZE);
            const token = ++this.collisionToken;

            for (let column = minimumColumn; column <= maximumColumn; column += 1) {
                for (let row = minimumRow; row <= maximumRow; row += 1) {
                    const bucket = this.grid.get(`${column}:${row}`);

                    if (!bucket) {
                        continue;
                    }

                    for (const glyph of bucket) {
                        if (!glyph.alive || glyph.collisionToken === token) {
                            continue;
                        }

                        glyph.collisionToken = token;

                        if (
                            !segmentHitsCircle(
                                bullet.previousX - glyph.previousX,
                                bullet.previousY - glyph.previousY,
                                bullet.x - glyph.x,
                                bullet.y - glyph.y,
                                0,
                                0,
                                glyph.radius,
                            )
                        ) {
                            continue;
                        }

                        this.triggerImpactFeedback(glyph.x, glyph.y, "hit");
                        bullet.hitsRemaining = (bullet.hitsRemaining ?? 1) - 1;
                        bullet.dead = bullet.hitsRemaining <= 0;
                        this.destroyGlyph(glyph, time);

                        if (bullet.dead || this.state !== "running") {
                            return;
                        }
                    }
                }
            }
        }

        spawnParticles(glyph) {
            if (this.reducedMotion) {
                return;
            }

            const count = 5;

            for (let index = 0; index < count; index += 1) {
                const direction = randomBetween(0, Math.PI * 2);
                const speed = randomBetween(28, 95);
                this.particles.push({
                    x: glyph.x,
                    y: glyph.y,
                    velocityX: Math.cos(direction) * speed,
                    velocityY: Math.sin(direction) * speed,
                    life: randomBetween(0.22, 0.48),
                    maximumLife: 0.48,
                    color: glyph.color,
                });
            }
        }

        render() {
            const context = this.context;
            const ratio = this.pixelRatio;
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            context.textAlign = "center";
            context.textBaseline = "alphabetic";

            for (const glyph of this.glyphs) {
                if (!glyph.alive) {
                    continue;
                }

                const cosine = Math.cos(glyph.angle);
                const sine = Math.sin(glyph.angle);
                context.setTransform(
                    ratio * cosine,
                    ratio * sine,
                    ratio * -sine,
                    ratio * cosine,
                    ratio * glyph.x,
                    ratio * glyph.y,
                );
                this.applyTextStyle(glyph);
                context.fillStyle = glyph.color;
                context.globalAlpha = glyph.opacity;
                context.fillText(glyph.text, 0, glyph.baselineOffset);
            }

            context.setTransform(
                ratio,
                0,
                0,
                ratio,
                0,
                0,
            );
            context.globalAlpha = 1;
            this.drawImpactRings(context);
            this.drawPowerUps(context);

            for (const bullet of this.bullets) {
                context.beginPath();
                context.fillStyle = this.accentColor;

                if (bullet.piercing) {
                    context.moveTo(bullet.previousX, bullet.previousY);
                    context.lineTo(bullet.x, bullet.y);
                    context.lineWidth = 2.4;
                    context.strokeStyle = this.accentColor;
                    context.stroke();
                } else {
                    context.arc(bullet.x, bullet.y, 2.2, 0, Math.PI * 2);
                    context.fill();
                }
            }

            for (const particle of this.particles) {
                context.globalAlpha = clamp(particle.life / particle.maximumLife, 0, 1);
                context.fillStyle = particle.color;
                context.fillRect(particle.x - 1.5, particle.y - 1.5, 3, 3);
            }

            context.globalAlpha = 1;
            this.drawShip(context);
        }

        drawImpactRings(context) {
            for (const ring of this.impactRings) {
                const progress = 1 - clamp(ring.life / ring.maximumLife, 0, 1);
                const radius = ring.startRadius + (ring.endRadius - ring.startRadius) * progress;
                context.globalAlpha = (1 - progress) * 0.9;
                context.strokeStyle = ring.color;
                context.lineWidth = ring.lineWidth;
                context.beginPath();
                context.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
                context.stroke();
            }

            context.globalAlpha = 1;
        }

        drawPowerUps(context) {
            for (const powerUp of this.powerUps) {
                const pulse = this.reducedMotion
                    ? 0
                    : Math.sin(this.lastFrameTime / 130 + powerUp.x * 0.02) * 1.5;
                const expiryOpacity = clamp(powerUp.life, 0.25, 1);

                context.save();
                context.translate(powerUp.x, powerUp.y);
                context.rotate(powerUp.angle);
                context.globalAlpha = expiryOpacity;
                context.shadowColor = this.accentColor;
                context.shadowBlur = this.reducedMotion ? 0 : 9;
                context.fillStyle = this.panelColor;
                context.strokeStyle = this.accentColor;
                context.lineWidth = 1.8;
                context.beginPath();
                context.arc(0, 0, powerUp.radius + pulse, 0, Math.PI * 2);
                context.fill();
                context.stroke();
                context.shadowBlur = 0;
                context.fillStyle = this.accentColor;
                context.font = "700 16px system-ui, sans-serif";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(powerUp.symbol, 0, 0.5);
                context.restore();
            }
        }

        drawShip(context) {
            context.save();
            context.translate(this.ship.x, this.ship.y);

            if (this.state === "running") {
                const graceProgress = clamp(
                    this.elapsedTime(this.lastFrameTime) / SHIP_SPAWN_GRACE,
                    0,
                    1,
                );

                if (graceProgress < 1) {
                    context.globalAlpha = this.reducedMotion
                        ? 0.5
                        : 0.32 + Math.sin(graceProgress * Math.PI * 4) * 0.12;
                    context.lineWidth = 1.5;
                    context.strokeStyle = this.accentColor;
                    context.beginPath();
                    context.arc(0, 0, 18 - graceProgress * 3, 0, Math.PI * 2);
                    context.stroke();
                    context.globalAlpha = 1;
                }
            }

            if (this.shieldCharges > 0) {
                context.globalAlpha = 0.78;
                context.lineWidth = 2;
                context.strokeStyle = this.accentColor;
                context.beginPath();
                context.arc(0, 0, 20, 0, Math.PI * 2);
                context.stroke();
                context.globalAlpha = 1;
            }

            const activeElapsed = this.elapsedTime(this.lastFrameTime);
            const activeBadges = [];

            if (this.activeWeapon && this.activeWeapon.until > activeElapsed) {
                activeBadges.push(POWER_UP_DEFINITIONS[this.activeWeapon.type].symbol);
            }

            if (this.slowUntil > activeElapsed) {
                activeBadges.push(POWER_UP_DEFINITIONS.slow.symbol);
            }

            activeBadges.forEach((symbol, index) => {
                const offsetX = (index - (activeBadges.length - 1) / 2) * 20;
                context.fillStyle = this.panelColor;
                context.strokeStyle = this.accentColor;
                context.lineWidth = 1.4;
                context.beginPath();
                context.arc(offsetX, -24, 8, 0, Math.PI * 2);
                context.fill();
                context.stroke();
                context.fillStyle = this.accentColor;
                context.font = "700 11px system-ui, sans-serif";
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(symbol, offsetX, -23.5);
            });

            context.rotate(this.ship.angle);
            context.lineJoin = "round";
            context.lineWidth = 2.2;
            context.strokeStyle = this.accentColor;
            context.fillStyle = this.foregroundColor;
            context.beginPath();
            context.moveTo(13, 0);
            context.lineTo(-9, 8);
            context.lineTo(-5, 0);
            context.lineTo(-9, -8);
            context.closePath();
            context.fill();
            context.stroke();
            context.restore();
        }

        elapsedTime(now = performance.now()) {
            const activePause = this.pausedAt ? now - this.pausedAt : 0;
            return Math.max(0, now - this.startedAt - this.pausedDuration - activePause);
        }

        restartRound() {
            if (this.state !== "game-over" || this.initialGlyphs.length === 0) {
                return;
            }

            this.state = "restarting";
            window.cancelAnimationFrame(this.animationFrame);
            window.clearTimeout(this.helpTimer);
            this.animationFrame = 0;
            this.helpTimer = 0;
            this.dismissDialogForRestart();

            this.glyphs = this.cloneGlyphs(this.initialGlyphs);
            this.bullets = [];
            this.particles = [];
            this.impactRings = [];
            this.powerUps = [];
            this.activeWeapon = null;
            this.slowUntil = 0;
            this.shieldCharges = 0;
            this.killsSincePowerUp = 0;
            this.collisionToken = 0;
            this.remaining = this.glyphs.length;
            this.pointerFiring = false;
            this.keyboardFiring = false;
            this.activePointerId = null;
            this.movementKeys.clear();
            this.finishedDuration = 0;
            this.pausedAt = 0;
            this.pausedDuration = 0;
            this.lastShotAt = -Infinity;

            this.ship.x = this.lastPointer.seen
                ? clamp(this.lastPointer.x, 10, this.viewportWidth - 10)
                : this.viewportWidth / 2;
            this.ship.y = this.lastPointer.seen
                ? clamp(this.lastPointer.y, 10, this.viewportHeight - 10)
                : this.viewportHeight * 0.78;
            this.ship.previousX = this.ship.x;
            this.ship.previousY = this.ship.y;
            this.ship.targetX = this.ship.x;
            this.ship.targetY = this.ship.y;
            this.ship.angle = -Math.PI / 2;
            this.ship.targetAngle = -Math.PI / 2;

            this.canvas.dataset.remaining = String(this.remaining);
            this.stage.inert = false;
            this.restartButton.hidden = true;
            this.state = "running";
            this.startedAt = performance.now();
            this.lastFrameTime = this.startedAt;
            this.updateHelpText();
            this.showHelp();
            this.stage.focus({ preventScroll: true });
            this.announce("Text Asteroids restarted.");
            this.animationFrame = window.requestAnimationFrame((time) => this.frame(time));
        }

        dismissDialogForRestart() {
            if (!this.dialogIsOpen()) {
                return;
            }

            if (!this.dialog.classList.contains("is-fallback") && typeof this.dialog.close === "function") {
                this.dialog.close();
                return;
            }

            this.dialog.removeAttribute("open");
            this.dialog.classList.remove("is-fallback");
            this.dialog.removeAttribute("role");
            this.dialog.removeAttribute("aria-modal");
        }

        showGameOver(time) {
            if (this.state !== "running") {
                return;
            }

            this.finishedDuration = this.elapsedTime(time);
            this.state = "game-over";
            this.animationFrame = 0;
            this.clearActiveControls();
            this.stage.inert = true;
            this.dialogTitle.textContent = "Game over";
            this.dialogMessage.textContent = `A letter hit your ship after ${formatDuration(this.finishedDuration)}.`;
            this.restartButton.hidden = false;

            this.openCompletionDialog();

            this.restartButton.focus({ preventScroll: true });
            this.announce(this.dialogMessage.textContent);
        }

        showCompletion() {
            if (this.state !== "finishing") {
                return;
            }

            this.state = "completed";
            this.animationFrame = 0;
            this.stage.inert = true;
            this.dialogTitle.textContent = "Mission complete";
            this.dialogMessage.textContent = `Congratulations, you have successfully wasted ${formatDuration(this.finishedDuration)}.`;
            this.restartButton.hidden = true;

            this.openCompletionDialog();

            this.dialogButton.focus({ preventScroll: true });
            this.announce(this.dialogMessage.textContent);
        }

        dialogIsOpen() {
            return this.dialog.open || this.dialog.hasAttribute("open");
        }

        openCompletionDialog() {
            if (typeof this.dialog.showModal === "function") {
                this.dialog.showModal();
                return;
            }

            this.dialog.classList.add("is-fallback");
            this.dialog.setAttribute("role", "dialog");
            this.dialog.setAttribute("aria-modal", "true");
            this.dialog.setAttribute("open", "");
        }

        closeCompletionDialog() {
            if (!this.dialogIsOpen()) {
                return;
            }

            if (!this.dialog.classList.contains("is-fallback") && typeof this.dialog.close === "function") {
                this.dialog.close();
                return;
            }

            this.dialog.removeAttribute("open");
            this.dialog.classList.remove("is-fallback");
            this.dialog.removeAttribute("role");
            this.dialog.removeAttribute("aria-modal");

            if (RESULT_STATES.has(this.state)) {
                this.teardown({ restoreFocus: true });
            }
        }

        stop(message) {
            if (this.state === "idle") {
                return;
            }

            if (this.dialogIsOpen()) {
                this.closeCompletionDialog();
                return;
            }

            this.teardown({ restoreFocus: true });

            if (message) {
                this.announce(message);
            }
        }

        teardown({ restoreFocus } = { restoreFocus: true }) {
            if (this.tearingDown) {
                return;
            }

            if (this.state === "idle" && !this.viewportLocked) {
                return;
            }

            this.tearingDown = true;
            ++this.session;
            window.cancelAnimationFrame(this.animationFrame);
            window.clearTimeout(this.helpTimer);
            window.clearTimeout(this.dialogTimer);
            this.animationFrame = 0;
            this.helpTimer = 0;
            this.dialogTimer = 0;

            const wasViewportLocked = this.viewportLocked;
            this.state = "tearing-down";

            if (this.dialogIsOpen()) {
                if (!this.dialog.classList.contains("is-fallback") && typeof this.dialog.close === "function") {
                    this.dialog.close();
                } else {
                    this.dialog.removeAttribute("open");
                    this.dialog.classList.remove("is-fallback");
                    this.dialog.removeAttribute("role");
                    this.dialog.removeAttribute("aria-modal");
                }
            }

            if (this.activePointerId !== null) {
                try {
                    this.stage.releasePointerCapture(this.activePointerId);
                } catch (_error) {
                    // The pointer may already have been released.
                }
            }

            document.documentElement.classList.remove(ACTIVE_CLASS);

            if (this.viewportLocked) {
                document.documentElement.classList.remove(LOCKED_CLASS);

                if (this.previousScrollbarVariable) {
                    document.body.style.setProperty(
                        "--text-asteroids-scrollbar-width",
                        this.previousScrollbarVariable,
                    );
                } else {
                    document.body.style.removeProperty("--text-asteroids-scrollbar-width");
                }
            }

            if (this.sourceState) {
                if (!this.sourceState.hadInert) {
                    this.source.removeAttribute("inert");
                }

                if (this.sourceState.ariaHidden === null) {
                    this.source.removeAttribute("aria-hidden");
                } else {
                    this.source.setAttribute("aria-hidden", this.sourceState.ariaHidden);
                }
            }

            this.stage.inert = false;
            this.stage.hidden = true;
            this.stage.setAttribute("aria-hidden", "true");
            this.launcher.disabled = false;
            this.launcher.removeAttribute("aria-busy");
            this.help.classList.remove("is-dismissed");
            this.context.setTransform(1, 0, 0, 1, 0, 0);
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            delete this.canvas.dataset.remaining;
            this.glyphs = [];
            this.initialGlyphs = [];
            this.bullets = [];
            this.particles = [];
            this.impactRings = [];
            this.powerUps = [];
            this.activeWeapon = null;
            this.slowUntil = 0;
            this.shieldCharges = 0;
            this.killsSincePowerUp = 0;
            this.grid.clear();
            this.remaining = 0;
            this.pointerFiring = false;
            this.keyboardFiring = false;
            this.activePointerId = null;
            this.movementKeys.clear();
            this.initialViewport = null;
            this.sourceState = null;
            this.viewportLocked = false;
            this.restartButton.hidden = true;
            this.state = "idle";

            if (wasViewportLocked) {
                window.scrollTo(this.scrollPosition.x, this.scrollPosition.y);
            }

            if (restoreFocus) {
                const focusTarget = this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected
                    ? this.previousFocus
                    : this.launcher;
                focusTarget.focus({ preventScroll: true });
            }

            this.previousFocus = null;
            this.previousScrollbarVariable = "";
            this.tearingDown = false;
        }
    }

    const initialize = () => {
        const source = document.querySelector(SOURCE_SELECTOR);

        if (
            !source ||
            !document.body ||
            !HTMLCanvasElement.prototype.getContext ||
            typeof Intl === "undefined" ||
            typeof Intl.Segmenter !== "function"
        ) {
            return;
        }

        new TextAsteroids(source);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
