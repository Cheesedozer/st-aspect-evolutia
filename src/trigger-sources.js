// Aspect: Evolutia — trigger-sources.js (split from the former single index.js).
import {
    EVOLUTIA_EXTENSION_PROMPT_PREFIX,
} from './chat-runtime.js';
import {
    DEFAULT_TRIGGER_SOURCES,
    TRIGGER_SOURCE,
} from './constants.js';
import {
    getCharacterName,
    getContext,
} from './context.js';
import {
    normalizeTriggerSources,
} from './model.js';

// ============================================================================
// Section 7. Current Input Tracking
// ============================================================================
// Purpose:
// - Own trigger source text collection for Dynamic Field trigger matching.
// ============================================================================

// -----------------------------------------------------------------------------
// Trigger Source Text Collection - Generic Text Extraction
// -----------------------------------------------------------------------------

export function getChatMessageText(message) {
    if (!message || typeof message !== 'object') {
        return '';
    }

    const candidates = [
        message.mes,
        message.message,
        message.content,
        message.text,
        message.msg,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }

    return '';
}

export function stringifyTriggerSourceValue(value, seen = new WeakSet()) {
    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value
            .map((entry) => stringifyTriggerSourceValue(entry, seen))
            .filter(Boolean)
            .join('\n');
    }

    if (typeof value === 'object') {
        if (seen.has(value)) {
            return '';
        }

        seen.add(value);

        const preferredText = [
            value.content,
            value.text,
            value.message,
            value.mes,
            value.prompt,
            value.value,
            value.entries,
            value.entry,
        ]
            .map((entry) => stringifyTriggerSourceValue(entry, seen))
            .filter(Boolean)
            .join('\n');

        if (preferredText) {
            return preferredText;
        }

        return Object.values(value)
            .map((entry) => stringifyTriggerSourceValue(entry, seen))
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

// -----------------------------------------------------------------------------
// Trigger Source Text Collection - Chat Message Classification
// -----------------------------------------------------------------------------

export function isUserChatMessage(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }

    if (message.is_system || message.system || message.is_narrator) {
        return false;
    }

    if (message.is_user === true) {
        return true;
    }

    if (String(message.role || '').toLowerCase() === 'user') {
        return true;
    }

    const ctx = getContext();
    const userName = String(ctx?.name1 || '').trim();

    if (userName && String(message.name || '').trim() === userName) {
        return true;
    }

    return false;
}

export function isAssistantChatMessage(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }

    if (message.is_system || message.system || message.is_narrator) {
        return false;
    }

    if (message.is_user === true) {
        return false;
    }

    if (String(message.role || '').toLowerCase() === 'assistant') {
        return true;
    }

    const characterName = getCharacterName();

    if (characterName && String(message.name || '').trim() === characterName) {
        return true;
    }

    return false;
}

// -----------------------------------------------------------------------------
// Trigger Source Text Collection - Chat Source Readers
// -----------------------------------------------------------------------------

export function getChatSource(chatOverride) {
    if (Array.isArray(chatOverride)) {
        return chatOverride;
    }

    const ctx = getContext();
    return Array.isArray(ctx?.chat) ? ctx.chat : [];
}

export function getLatestMatchingChatMessageText(predicate, chatOverride) {
    const chat = getChatSource(chatOverride);

    for (let index = chat.length - 1; index >= 0; index -= 1) {
        const message = chat[index];

        if (!predicate(message)) {
            continue;
        }

        const text = getChatMessageText(message);

        if (text) {
            return text;
        }
    }

    return '';
}

export function getLastUserMessageText(chatOverride) {
    return getLatestMatchingChatMessageText(isUserChatMessage, chatOverride);
}

export function getLastAssistantMessageText(chatOverride) {
    return getLatestMatchingChatMessageText(isAssistantChatMessage, chatOverride);
}

// -----------------------------------------------------------------------------
// Trigger Source Text Collection - Prompt and World Info Source Readers
// -----------------------------------------------------------------------------

// "Extension Injections": text other extensions inject via setExtensionPrompt
// (Author's Note, Summarize, Vector memories, SillyBunny agents, ...).
// Stored id: quiet_prompts (kept for compatibility).
export function getQuietPromptText() {
    const prompts = getContext()?.extensionPrompts;

    if (!prompts || typeof prompts !== 'object') {
        return '';
    }

    return Object.entries(prompts)
        .filter(([key]) => !String(key).startsWith(EVOLUTIA_EXTENSION_PROMPT_PREFIX))
        .map(([, prompt]) => (typeof prompt?.value === 'string' ? prompt.value : ''))
        .filter((value) => value.trim())
        .join('\n');
}

export function isNarratorChatMessage(message) {
    return Boolean(message && typeof message === 'object' && !message.is_user && message.extra?.type === 'narrator');
}

// "Last Narrator Message (/sys)": the newest narrator message in the chat.
// Stored id: system_prompts (kept for compatibility).
export function getSystemPromptText(chatOverride) {
    return getLatestMatchingChatMessageText(isNarratorChatMessage, chatOverride);
}

// Activated World Info entries of the current generation, captured from
// WORLD_INFO_ACTIVATED (title, keys and content of each entry).
export let activatedWorldInfoText = '';

export function setActivatedWorldInfoEntries(entries) {
    activatedWorldInfoText = (Array.isArray(entries) ? entries : [])
        .map((entry) => [
            entry?.comment,
            Array.isArray(entry?.key) ? entry.key.join(', ') : '',
            Array.isArray(entry?.keysecondary) ? entry.keysecondary.join(', ') : '',
            entry?.content,
        ].filter((value) => typeof value === 'string' && value.trim()).join('\n'))
        .filter(Boolean)
        .join('\n\n');
}

export function getWorldInfoLorebookText() {
    return activatedWorldInfoText;
}

// -----------------------------------------------------------------------------
// Trigger Source Text Collection - Source Dispatcher
// -----------------------------------------------------------------------------

export function getTriggerSourceText(source, chatOverride) {
    if (source === TRIGGER_SOURCE.QUIET_PROMPTS) {
        return getQuietPromptText();
    }

    if (source === TRIGGER_SOURCE.SYSTEM_PROMPTS) {
        return getSystemPromptText(chatOverride);
    }

    if (source === TRIGGER_SOURCE.LAST_ASSISTANT_MESSAGE) {
        return getLastAssistantMessageText(chatOverride);
    }

    if (source === TRIGGER_SOURCE.LAST_USER_MESSAGE) {
        return getLastUserMessageText(chatOverride);
    }

    if (source === TRIGGER_SOURCE.WORLD_INFO_LOREBOOKS) {
        return getWorldInfoLorebookText();
    }

    return '';
}

export function buildScanText(triggerSources = DEFAULT_TRIGGER_SOURCES, chatOverride = undefined) {
    const sources = normalizeTriggerSources(triggerSources);

    // Original case is kept so /regex/ keywords can match case-sensitively;
    // plain keywords are compared case-insensitively in keywordMatches().
    return sources
        .map((source) => getTriggerSourceText(source, chatOverride))
        .filter(Boolean)
        .join('\n');
}
