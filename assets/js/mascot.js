import { createMascotTextFlow } from './mascot-flow.js';

(() => {
    'use strict';

    function init(root) {
        const button = root.querySelector('[data-mascot-button]');
        const sprite = root.querySelector('[data-mascot-sprite]');
        const bubble = root.querySelector('[data-mascot-bubble]');
        const full = root.querySelector('[data-mascot-full-text]');
        const typed = root.querySelector('[data-mascot-typed-text]');
        const textFlow = createMascotTextFlow(root, button);
        const configuredDuration = Number(root.dataset.mascotMessageDurationSeconds);
        const readingTime = Number.isFinite(configuredDuration) && configuredDuration > 0
            ? configuredDuration * 1000 : 5000;
        let textTimer;
        let textTask;
        let textRemaining = 0;
        let textDeadline = 0;
        let stopped = false;
        let windowActive = document.hasFocus();
        let paused = !available();
        let dragState = null;
        let dragFrame;
        let pendingPosition;
        let suppressClick = false;

        function available() {
            return !stopped && windowActive && !document.hidden
                && !document.documentElement.classList.contains('text-asteroids-active');
        }

        // One timer serves both typing and the hold; paused time never counts.
        function resumeText() {
            if (!available() || !textTask || textTimer !== undefined) return;
            textDeadline = performance.now() + textRemaining;
            textTimer = setTimeout(() => {
                textTimer = undefined;
                if (!available()) return;
                const task = textTask;
                textTask = null;
                task();
            }, textRemaining);
        }

        function scheduleText(task, delay) {
            clearTimeout(textTimer);
            textTimer = undefined;
            textTask = task;
            textRemaining = delay;
            resumeText();
        }

        function pauseText() {
            if (textTimer !== undefined) textRemaining = Math.max(0, textDeadline - performance.now());
            clearTimeout(textTimer);
            textTimer = undefined;
        }

        function stopText() {
            pauseText();
            textTask = null;
            if (bubble) bubble.dataset.typing = 'false';
        }

        function startText() {
            stopText();
            if (!full || !typed) return;
            if (reducedMotion.matches) {
                full.style.opacity = '';
                typed.hidden = true;
                scheduleText(() => setBubbleVisible(false), readingTime);
                return;
            }
            const characters = typeof Intl.Segmenter === 'function'
                ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(full.textContent), (part) => part.segment)
                : Array.from(full.textContent);
            let index = 0;
            full.style.opacity = '0';
            typed.hidden = false;
            typed.textContent = '';
            bubble.dataset.typing = String(characters.length > 0);
            function typeNext() {
                typed.textContent += characters[index++];
                bubble.dataset.typing = String(index < characters.length);
                if (index < characters.length) scheduleText(typeNext, 35);
                else scheduleText(() => setBubbleVisible(false), readingTime);
            }
            if (characters.length) scheduleText(typeNext, 35);
            else scheduleText(() => setBubbleVisible(false), readingTime);
        }

        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let blinkTimer;
        let gaze = 4;

        function cancelBlink() {
            clearTimeout(blinkTimer);
            render('directions', directions[gaze], gaze);
        }

        function restartIdle() {
            cancelBlink();
            if (!available() || reducedMotion.matches) return;
            blinkTimer = setTimeout(() => {
                if (!available() || reducedMotion.matches) return;
                render('reactions', 'blink', 0);
                blinkTimer = setTimeout(restartIdle, 120);
            }, 4000 + Math.random() * 5000);
        }

        function render(sheet, frame, index) {
            sprite.dataset.sheet = sheet;
            sprite.dataset.frame = frame;
            sprite.style.backgroundPosition = `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`;
        }

        function center() {
            gaze = 4;
            render('directions', 'center', 4);
        }

        function setBubbleVisible(visible) {
            if (!bubble) return;
            bubble.hidden = !visible;
            button.setAttribute('aria-expanded', String(visible));
            if (visible) startText();
            else stopText();
            if (!visible && document.activeElement !== button && root.contains(document.activeElement)) {
                button.focus({ preventScroll: true });
            }
        }

        function toggleMessage(event) {
            if (suppressClick) {
                suppressClick = false;
                event?.preventDefault();
                return;
            }
            restartIdle();
            if (bubble) setBubbleVisible(bubble.hidden);
        }

        function place(left, top) {
            const rect = button.getBoundingClientRect();
            const safeLeft = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - rect.width - 8));
            const safeTop = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - rect.height - 8));
            const onLeft = safeLeft + rect.width / 2 < window.innerWidth / 2;
            root.dataset.mascotSide = onLeft ? 'left' : 'right';
            root.dataset.mascotVertical = safeTop + rect.height / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
            root.dataset.mascotPositioned = 'true';
            root.style.bottom = 'auto';
            root.style.top = `${safeTop}px`;
            if (onLeft) {
                root.style.left = `${safeLeft}px`;
                root.style.right = 'auto';
            } else {
                root.style.left = 'auto';
                root.style.right = `${window.innerWidth - safeLeft - rect.width}px`;
            }
            textFlow.schedule();
        }

        function flushPosition() {
            dragFrame = undefined;
            if (!pendingPosition) return;
            place(pendingPosition.left, pendingPosition.top);
            pendingPosition = undefined;
        }

        function queuePosition(left, top) {
            pendingPosition = { left, top };
            if (dragFrame === undefined) dragFrame = requestAnimationFrame(flushPosition);
        }

        function dragStart(event) {
            if ((event.button !== undefined && event.button !== 0) || event.isPrimary === false) return;
            const rect = button.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                left: rect.left,
                top: rect.top,
                moved: false,
            };
            button.setPointerCapture?.(event.pointerId);
            restartIdle();
        }

        function dragMove(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            const dx = event.clientX - dragState.startX;
            const dy = event.clientY - dragState.startY;
            if (!dragState.moved && Math.hypot(dx, dy) < 6) return;
            dragState.moved = true;
            root.dataset.dragging = 'true';
            event.preventDefault();
            queuePosition(dragState.left + dx, dragState.top + dy);
        }

        function finishDrag(event, cancelled = false) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            const moved = dragState.moved;
            if (moved && !cancelled) {
                flushPosition();
                suppressClick = true;
            }
            button.releasePointerCapture?.(event.pointerId);
            delete root.dataset.dragging;
            dragState = null;
            center();
            restartIdle();
        }

        function dragEnd(event) {
            finishDrag(event);
        }

        function dragCancel(event) {
            finishDrag(event, true);
        }

        function keyboardMove(event) {
            const moves = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
            };
            const direction = moves[event.key];
            if (!direction) return;
            event.preventDefault();
            const distance = event.shiftKey ? 32 : 12;
            const rect = button.getBoundingClientRect();
            place(rect.left + direction[0] * distance, rect.top + direction[1] * distance);
        }

        function viewportChanged() {
            if (root.dataset.mascotPositioned !== 'true') return;
            const rect = button.getBoundingClientRect();
            place(rect.left, rect.top);
        }

        const directions = ['up-left', 'up', 'up-right', 'left', 'center', 'right', 'down-left', 'down', 'down-right'];
        const octants = [5, 8, 7, 6, 3, 0, 1, 2];

        function track(event) {
            restartIdle();
            if (dragState?.moved || !available() || !finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
            const rect = button.getBoundingClientRect();
            const x = event.clientX - (rect.left + rect.width / 2);
            const y = event.clientY - (rect.top + rect.height / 2);
            const octant = (Math.round(Math.atan2(y, x) / (Math.PI / 4)) + 8) % 8;
            const index = Math.hypot(x, y) < 28 ? 4 : octants[octant];
            gaze = index;
            render('directions', directions[index], index);
        }

        function reset() {
            center();
            restartIdle();
        }

        function motionChanged() {
            reset();
            if (!reducedMotion.matches || !full || !typed) return;
            full.style.opacity = '';
            typed.hidden = true;
            if (bubble && !bubble.hidden && bubble.dataset.typing === 'true') startText();
        }

        function syncAvailability() {
            textFlow.schedule();
            const nextPaused = !available();
            if (paused === nextPaused) return;
            paused = nextPaused;
            if (paused) {
                pauseText();
                cancelBlink();
            } else {
                resumeText();
                restartIdle();
            }
        }

        function blur() {
            windowActive = false;
            center();
            syncAvailability();
        }

        function focus() {
            windowActive = true;
            syncAvailability();
        }

        function escapeMessage(event) {
            if (event.key === 'Escape' && !bubble.hidden && root.contains(document.activeElement)) {
                event.preventDefault();
                setBubbleVisible(false);
            }
        }

        if (bubble) {
            setBubbleVisible(!bubble.hidden);
            root.addEventListener('keydown', escapeMessage);
        }

        reset();
        const gameObserver = new MutationObserver(syncAvailability);
        gameObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('pointermove', track, { passive: true });
        document.addEventListener('pointerdown', restartIdle, { passive: true });
        document.addEventListener('pointerleave', reset);
        document.addEventListener('visibilitychange', syncAvailability);
        window.addEventListener('blur', blur);
        window.addEventListener('focus', focus);
        finePointer.addEventListener('change', reset);
        reducedMotion.addEventListener('change', motionChanged);
        button.addEventListener('click', toggleMessage);
        button.addEventListener('pointerdown', dragStart);
        button.addEventListener('pointermove', dragMove);
        button.addEventListener('pointerup', dragEnd);
        button.addEventListener('pointercancel', dragCancel);
        button.addEventListener('keydown', keyboardMove);
        window.addEventListener('resize', viewportChanged, { passive: true });
        button.setAttribute('aria-label', 'Drag mascot or toggle its message');
        button.setAttribute('aria-description', 'Drag with a pointer, or use the arrow keys to move the mascot.');
        button.disabled = false;

        return () => {
            stopped = true;
            stopText();
            center();
            cancelBlink();
            textFlow.destroy();
            if (dragFrame !== undefined) cancelAnimationFrame(dragFrame);
            gameObserver.disconnect();
            button.disabled = true;
            button.setAttribute('aria-label', 'Toggle mascot message');
            button.removeAttribute('aria-description');
            button.removeEventListener('click', toggleMessage);
            button.removeEventListener('pointerdown', dragStart);
            button.removeEventListener('pointermove', dragMove);
            button.removeEventListener('pointerup', dragEnd);
            button.removeEventListener('pointercancel', dragCancel);
            button.removeEventListener('keydown', keyboardMove);
            document.removeEventListener('pointermove', track);
            document.removeEventListener('pointerdown', restartIdle);
            document.removeEventListener('pointerleave', reset);
            document.removeEventListener('visibilitychange', syncAvailability);
            window.removeEventListener('blur', blur);
            window.removeEventListener('focus', focus);
            window.removeEventListener('resize', viewportChanged);
            finePointer.removeEventListener('change', reset);
            reducedMotion.removeEventListener('change', motionChanged);
            if (bubble) {
                root.removeEventListener('keydown', escapeMessage);
            }
        };
    }

    let cleanups = [];

    function stop() {
        cleanups.forEach((cleanup) => cleanup());
        cleanups = [];
    }

    function start() {
        stop();
        cleanups = Array.from(document.querySelectorAll('[data-page-mascot]'), init);
    }

    start();
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) start();
    });
})();
