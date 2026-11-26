// Aspect: Evolutia — utils.js (split from the former single index.js).
import {
    MODULE_NAME,
} from './constants.js';

// ============================================================================
// Section 3. Shared Utilities
// ============================================================================
// Purpose:
// - Own generic helpers used across components.
// ============================================================================

// -----------------------------------------------------------------------------
// Shared Utilities - General Helpers
// -----------------------------------------------------------------------------

export function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(Object(obj), key);
}

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function makeId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function notify(type, message) {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](message);
        return;
    }

    const method = type === 'error' ? 'error' : 'log';
    console[method](`[${MODULE_NAME}] ${message}`);
}

export function getAuthorName(author) {
    if (typeof author === 'string') {
        return author;
    }

    if (Array.isArray(author)) {
        return author
            .map((entry) => getAuthorName(entry))
            .filter(Boolean)
            .join(', ');
    }

    if (author && typeof author === 'object') {
        return String(author.name || author.author || author.display_name || '').trim();
    }

    return '';
}

export function sanitizeFilename(value) {
    return String(value || 'character')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120) || 'character';
}

export function titleCase(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeHeadingKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function splitLinesForJson(value) {
    const text = String(value ?? '');

    if (!text) {
        return [];
    }

    return text.replace(/\r\n/g, '\n').split('\n');
}

export function joinLinesFromJson(value) {
    if (Array.isArray(value)) {
        return value.map((line) => String(line ?? '')).join('\n');
    }

    return String(value ?? '');
}

export function getPositionInputWidth(value) {
    const text = String(value ?? '').trim();
    const characterCount = Math.max(1, text.length || 1);

    return `${Math.max(2, Math.ceil(characterCount * 1.5))}ch`;
}

export function syncPositionInputWidth(input) {
    if (!input) {
        return;
    }

    input.style.width = getPositionInputWidth(input.value);
}

// -----------------------------------------------------------------------------
// Shared Utilities - HTML Escaping
// -----------------------------------------------------------------------------

export function escapeAttribute(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function escapeTextarea(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

// -----------------------------------------------------------------------------
// Shared Utilities - File and Clipboard Helpers
// -----------------------------------------------------------------------------

export function downloadJsonFile(filename, payload) {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text) {
    if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard write is unavailable.');
    }

    await navigator.clipboard.writeText(text);
}

export async function readTextFromClipboard() {
    if (!navigator.clipboard?.readText) {
        throw new Error('Clipboard read is unavailable.');
    }

    return navigator.clipboard.readText();
}
