/*! @chenglou/pretext 0.0.9 — Copyright (c) 2026 Pretext contributors — MIT license: licenses/pretext-LICENSE.txt */
import {
    layoutNextRichInlineLineRange,
    materializeRichInlineLineRange,
    prepareRichInline,
} from '../vendor/pretext/rich-inline.js';

const FLOW_SELECTOR = '.content *';
const TEXT_DISPLAYS = new Set(['block', 'flow-root', 'list-item', 'table-caption']);
const EXCLUDED_TAGS = new Set(['BUTTON', 'DETAILS', 'PRE', 'SUMMARY', 'TABLE']);
const IGNORED_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE']);
const INLINE_TAGS = new Set([
    'A', 'ABBR', 'B', 'CITE', 'CODE', 'DEL', 'EM', 'I', 'KBD', 'MARK', 'Q',
    'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
]);
const EXCLUSION_X = 14;
const EXCLUSION_Y = 10;
const MIN_SLOT_WIDTH = 40;
const MAX_ROWS = 2000;

function px(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sameCursor(left, right) {
    return left.itemIndex === right.itemIndex
        && left.segmentIndex === right.segmentIndex
        && left.graphemeIndex === right.graphemeIndex;
}

function cloneCursor(cursor) {
    return {
        itemIndex: cursor.itemIndex,
        segmentIndex: cursor.segmentIndex,
        graphemeIndex: cursor.graphemeIndex,
    };
}

function isEligible(block) {
    if (!(block instanceof HTMLElement) || block.closest('[data-page-mascot]')) return false;
    if (EXCLUDED_TAGS.has(block.tagName) || block.isContentEditable || block.hidden) return false;
    if (!block.textContent.trim() || block.querySelector('br, img, svg, video, audio, canvas, iframe, input, button, select, textarea')) return false;
    const style = getComputedStyle(block);
    if (!TEXT_DISPLAYS.has(style.display) || style.visibility === 'hidden') return false;
    if (!['normal', 'nowrap'].includes(style.whiteSpace)) return false;
    if (!['left', 'start'].includes(style.textAlign)) return false;
    return Array.from(block.querySelectorAll('*')).every((element) => (
        INLINE_TAGS.has(element.tagName) || IGNORED_TAGS.has(element.tagName)
    ));
}

function inlineChrome(style) {
    return px(style.paddingLeft) + px(style.paddingRight)
        + px(style.borderLeftWidth) + px(style.borderRightWidth);
}

function generatedContent(style) {
    if (!style || style.content === 'none' || style.content === 'normal') return '';
    const strings = style.content.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g);
    if (!strings) return '';
    return strings.map((value) => {
        if (value.startsWith('"')) {
            try {
                return JSON.parse(value);
            } catch (_) {
                return value.slice(1, -1);
            }
        }
        return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    }).join('');
}

function generatedSource(element, block) {
    const style = getComputedStyle(element, '::before');
    const text = generatedContent(style);
    if (!text) return null;
    const ancestors = [];
    let ancestor = element === block ? null : element;
    while (ancestor && ancestor !== block) {
        ancestors.push(ancestor);
        ancestor = ancestor.parentElement;
    }
    return {
        source: {
            ancestors,
            generatedStyle: {
                color: style.color,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontStyle: style.fontStyle,
                fontWeight: style.fontWeight,
            },
        },
        item: {
            text,
            font: style.font || getComputedStyle(block).font,
            letterSpacing: style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing),
            break: 'never',
        },
    };
}

function collectSource(block) {
    const sources = [];
    const items = [];

    const generated = generatedSource(block, block);
    if (generated) {
        sources.push(generated.source);
        items.push(generated.item);
    }

    function addText(node) {
        if (!node.textContent) return;
        const parent = node.parentElement;
        if (!parent) return;
        const style = getComputedStyle(parent);
        const ancestors = [];
        let ancestor = parent;
        while (ancestor && ancestor !== block) {
            ancestors.push(ancestor);
            ancestor = ancestor.parentElement;
        }

        const closestDecorated = ancestors.find((element) => {
            const elementStyle = getComputedStyle(element);
            return inlineChrome(elementStyle) > 0;
        });
        const letterSpacing = style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing);
        sources.push({ ancestors });
        items.push({
            text: node.textContent,
            font: style.font,
            letterSpacing,
            break: 'normal',
            extraWidth: closestDecorated ? inlineChrome(getComputedStyle(closestDecorated)) : 0,
        });
    }

    function addAtomic(element) {
        const style = getComputedStyle(element);
        sources.push({ atomicElement: element });
        items.push({
            text: element.textContent,
            font: style.font,
            letterSpacing: style.letterSpacing === 'normal' ? 0 : px(style.letterSpacing),
            break: 'never',
            extraWidth: inlineChrome(style),
        });
    }

    function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            addText(node);
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (IGNORED_TAGS.has(node.tagName)) return;
        const before = generatedSource(node, block);
        if (before) {
            sources.push(before.source);
            items.push(before.item);
        }
        if (node.tagName === 'CODE') {
            addAtomic(node);
            return;
        }
        for (const child of node.childNodes) visit(child);
    }

    for (const child of block.childNodes) visit(child);

    if (!items.length) return null;
    return { sources, prepared: prepareRichInline(items) };
}

function cloneFragment(source, text) {
    let content;
    if (source.generatedStyle) {
        const generated = document.createElement('span');
        generated.className = 'mascot-flow-generated';
        Object.assign(generated.style, source.generatedStyle);
        generated.textContent = text;
        content = generated;
    } else if (source.atomicElement) {
        const clone = source.atomicElement.cloneNode(true);
        for (const element of [clone, ...clone.querySelectorAll('*')]) {
            element.removeAttribute('id');
            element.removeAttribute('tabindex');
        }
        return clone;
    } else {
        content = document.createTextNode(text);
    }
    for (const original of source.ancestors) {
        const clone = original.cloneNode(false);
        clone.classList.add('mascot-flow-cloned-ancestor');
        clone.removeAttribute('id');
        clone.removeAttribute('tabindex');
        clone.append(content);
        content = clone;
    }
    return content;
}

function restore(record) {
    if (!record.source) return;
    while (record.source.firstChild) record.block.insertBefore(record.source.firstChild, record.layer);
    record.layer.remove();
    record.block.classList.remove('mascot-flow-active');
    record.block.removeAttribute('data-mascot-flow');
    record.source = null;
    record.layer = null;
}

function mount(record) {
    const source = document.createDocumentFragment();
    while (record.block.firstChild) source.append(record.block.firstChild);

    const layer = document.createElement('span');
    layer.className = 'mascot-flow-layer';
    record.block.append(layer);
    record.block.classList.add('mascot-flow-active');
    record.block.setAttribute('data-mascot-flow', 'active');
    record.source = source;
    record.layer = layer;
}

function contentBox(block) {
    const rect = block.getBoundingClientRect();
    const style = getComputedStyle(block);
    const leftInset = px(style.borderLeftWidth) + px(style.paddingLeft);
    const rightInset = px(style.borderRightWidth) + px(style.paddingRight);
    const topInset = px(style.borderTopWidth) + px(style.paddingTop);
    const fontSize = px(style.fontSize) || 16;
    const lineHeight = style.lineHeight === 'normal' ? fontSize * 1.2 : px(style.lineHeight);
    return {
        left: rect.left + leftInset,
        right: rect.right - rightInset,
        top: rect.top + topInset,
        bottom: rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom),
        width: Math.max(1, rect.width - leftInset - rightInset),
        lineHeight: Math.max(1, lineHeight),
    };
}

function overlaps(left, right) {
    return left.left < right.right && left.right > right.left
        && left.top < right.bottom && left.bottom > right.top;
}

function slotsForRow(box, obstacle, rowTop, rowBottom) {
    if (rowBottom <= obstacle.top || rowTop >= obstacle.bottom) {
        return [{ x: 0, width: box.width }];
    }

    const slots = [];
    const leftWidth = Math.min(box.width, Math.max(0, obstacle.left - box.left));
    if (leftWidth >= MIN_SLOT_WIDTH) slots.push({ x: 0, width: leftWidth });
    const rightX = Math.min(box.width, Math.max(0, obstacle.right - box.left));
    const rightWidth = box.width - rightX;
    if (rightWidth >= MIN_SLOT_WIDTH) slots.push({ x: rightX, width: rightWidth });
    return slots;
}

function appendLine(record, materialized, slot, row, lineHeight) {
    const line = document.createElement('span');
    line.className = 'mascot-flow-line';
    line.style.left = `${slot.x}px`;
    line.style.top = `${row * lineHeight}px`;
    line.style.width = `${slot.width}px`;

    for (const fragment of materialized.fragments) {
        const wrapper = document.createElement('span');
        wrapper.className = 'mascot-flow-fragment';
        if (fragment.gapBefore) wrapper.append(document.createTextNode(' '));
        wrapper.append(cloneFragment(record.sources[fragment.itemIndex], fragment.text));
        line.append(wrapper);
    }
    record.layer.append(line);
    if (line.scrollWidth > slot.width + 1) {
        line.remove();
        return false;
    }
    return true;
}

function render(record, box, obstacle) {
    mount(record);
    // Flex items such as the header title and navigation derive their width
    // from their children. Preserve the measured width while those children
    // are temporarily replaced by absolutely positioned Pretext lines.
    record.layer.style.width = `${box.width}px`;
    let cursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
    let rows = 0;
    let complete = false;

    for (let row = 0; row < MAX_ROWS && !complete; row++) {
        const rowTop = box.top + row * box.lineHeight;
        const slots = slotsForRow(box, obstacle, rowTop, rowTop + box.lineHeight);
        rows = row + 1;
        for (const slot of slots) {
            const before = cloneCursor(cursor);
            const range = layoutNextRichInlineLineRange(record.prepared, slot.width, cursor);
            if (range === null) {
                complete = true;
                break;
            }
            const fits = appendLine(
                record,
                materializeRichInlineLineRange(record.prepared, range),
                slot,
                row,
                box.lineHeight,
            );
            if (!fits) {
                // A long unbreakable token may not fit beside the portrait. Wait
                // for a wider row; if the full block is still too narrow, retain
                // the browser's original wrapping instead of creating overflow.
                if (slot.width >= box.width - 1) {
                    restore(record);
                    return;
                }
                continue;
            }
            cursor = cloneCursor(range.end);
            if (sameCursor(before, cursor)) {
                complete = true;
                break;
            }
        }
    }

    record.layer.style.height = `${rows * box.lineHeight}px`;
}

export function createMascotTextFlow(root, obstacleElement) {
    const records = [];
    let frame;
    let stopped = false;

    function discover() {
        if (records.length) return;
        for (const block of document.querySelectorAll(FLOW_SELECTOR)) {
            if (!isEligible(block)) continue;
            const source = collectSource(block);
            if (source) records.push({ block, ...source, source: null, layer: null });
        }
    }

    function restoreAll() {
        for (const record of records) restore(record);
    }

    function layout() {
        frame = undefined;
        if (stopped) return;
        discover();
        restoreAll();
        if (getComputedStyle(root).visibility === 'hidden' || getComputedStyle(root).display === 'none') return;

        const rect = obstacleElement.getBoundingClientRect();
        const obstacle = {
            left: rect.left - EXCLUSION_X,
            right: rect.right + EXCLUSION_X,
            top: rect.top - EXCLUSION_Y,
            bottom: rect.bottom + EXCLUSION_Y,
        };

        for (const record of records) {
            const box = contentBox(record.block);
            if (overlaps(box, obstacle)) render(record, box, obstacle);
        }
    }

    function schedule() {
        if (!stopped && frame === undefined) frame = requestAnimationFrame(layout);
    }

    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    document.fonts?.ready.then(schedule);
    schedule();

    return {
        schedule,
        destroy() {
            stopped = true;
            if (frame !== undefined) cancelAnimationFrame(frame);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('scroll', schedule);
            restoreAll();
        },
    };
}
