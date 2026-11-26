// Aspect: Evolutia — chat-runtime.js (split from the former single index.js).
import {
    ALTER_EGO_BASE_ID,
    ALTER_EGO_EXTRA_KEY,
    MODULE_NAME,
    TARGET_SCOPE,
} from './constants.js';
import {
    getContext,
    getNativeCharacterAvatarKey,
    normalizePersonaId,
} from './context.js';
import {
    getActiveAlterEgoFields,
} from './model.js';
import {
    clone,
    hasOwn,
} from './utils.js';

// ============================================================================
// Section 6A. Chat Runtime State
// ============================================================================
// Purpose:
// - Keep story state (which fields are on, which alter ego is active, whether a
//   Trigger Action already happened) with the chat instead of the card.
// - Each generated reply carries a snapshot of the state it was written with,
//   stored in message.extra (SillyTavern keeps extra per swipe). The state
//   for the next generation is derived from the newest snapshot before it, so
//   swipes, deletions, edits and branches follow the chat history.
// - Manual edits made while a chat is open (Inject checkbox, alter ego select)
//   are recorded in chat_metadata and apply until a newer snapshot exists.
// - The card keeps only definitions and defaults for chats without snapshots.
// ============================================================================

export const CARD_SCHEMA_VERSION = 2;
export const RUNTIME_EXTRA_KEY = 'runtime';
export const RUNTIME_METADATA_KEY = 'aspectEvolutia';
export const EVOLUTIA_EXTENSION_PROMPT_PREFIX = 'aspectEvolutia';
export const legacyBackupsDone = new Set();
export const runtimeNowCache = new Map();

export function getCharacterRuntimeKey(characterId) {
    const avatar = getNativeCharacterAvatarKey(characterId);

    if (avatar && avatar !== 'none') {
        return avatar;
    }

    return characterId === undefined || characterId === null || characterId === '' ? '' : `chid:${characterId}`;
}

export function getPersonaRuntimeKey(personaId) {
    return normalizePersonaId(personaId) || '';
}

export function getRuntimeBucket(scope) {
    return scope === TARGET_SCOPE.PERSONA ? 'personas' : 'characters';
}

export function getMessageRuntimeRecord(message) {
    const record = message?.extra?.[ALTER_EGO_EXTRA_KEY]?.[RUNTIME_EXTRA_KEY];
    return record && typeof record === 'object' ? record : null;
}

export function findRuntimeSnapshot(scope, key, chat, endExclusive = undefined) {
    if (!key || !Array.isArray(chat)) {
        return null;
    }

    const bucket = getRuntimeBucket(scope);
    const end = Math.min(endExclusive ?? chat.length, chat.length);

    for (let index = end - 1; index >= 0; index -= 1) {
        const snapshot = getMessageRuntimeRecord(chat[index])?.[bucket]?.[key];

        if (snapshot && typeof snapshot === 'object') {
            return { index, snapshot };
        }
    }

    return null;
}

export function getLiveChat() {
    const chat = getContext()?.chat;
    return Array.isArray(chat) ? chat : [];
}

export function getChatMetadataRoot({ create = false } = {}) {
    const metadata = getContext()?.chatMetadata;

    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    if (!metadata[RUNTIME_METADATA_KEY] || typeof metadata[RUNTIME_METADATA_KEY] !== 'object') {
        if (!create) {
            return null;
        }

        metadata[RUNTIME_METADATA_KEY] = {};
    }

    return metadata[RUNTIME_METADATA_KEY];
}

export function getChatRuntimeOverride(scope, key) {
    const override = getChatMetadataRoot()?.overrides?.[getRuntimeBucket(scope)]?.[key];
    return override && typeof override === 'object' ? override : null;
}

export function isChatOpenForRuntime() {
    const ctx = getContext();
    return Boolean(ctx?.chatMetadata && Array.isArray(ctx?.chat) && (ctx.chatId || ctx.getCurrentChatId?.()));
}

export function setChatRuntimeOverride(scope, key, change) {
    if (!key || !change || !isChatOpenForRuntime()) {
        return;
    }

    const root = getChatMetadataRoot({ create: true });

    if (!root) {
        return;
    }

    root.overrides ??= {};
    const bucket = (root.overrides[getRuntimeBucket(scope)] ??= {});
    const chatLength = getLiveChat().length;
    const existing = bucket[key];
    const latest = findRuntimeSnapshot(scope, key, getLiveChat());
    // An override older than the newest snapshot was already folded into it.
    const stale = !existing || (latest && latest.index >= Number(existing.at ?? 0));
    const next = stale ? { fields: {} } : existing;

    next.at = chatLength;

    if (change.alterEgoId) {
        next.alterEgoId = change.alterEgoId;
    }

    if (change.fields && typeof change.fields === 'object') {
        next.fields = { ...(next.fields || {}), ...change.fields };
    }

    bucket[key] = next;
    invalidateRuntimeCache();
    const ctx = getContext();
    Promise.resolve(typeof ctx?.saveMetadata === 'function' ? ctx.saveMetadata() : ctx?.saveMetadataDebounced?.())
        .catch((error) => console.warn(`[${MODULE_NAME}] Could not save chat metadata:`, error));
}

// Builds the runtime state for one character/persona from (newest first):
// a manual chat override newer than the latest snapshot, the latest snapshot
// before `endExclusive`, then the card defaults.
export function resolveRuntime(scope, key, cardState, { chat = getLiveChat(), endExclusive = undefined, includeOverride = true } = {}) {
    const found = findRuntimeSnapshot(scope, key, chat, endExclusive);
    const override = includeOverride ? getChatRuntimeOverride(scope, key) : null;
    const overrideApplies = Boolean(override) && (!found || found.index < Number(override.at ?? 0));
    const alterEgoIds = new Set((cardState.alterEgos || []).map((alterEgo) => alterEgo.id));

    let alterEgoId = alterEgoIds.has(cardState.activeAlterEgoId) ? cardState.activeAlterEgoId : (cardState.alterEgos?.[0]?.id ?? ALTER_EGO_BASE_ID);
    let alterEgoSource = 'default';

    let alterEgoReason = '';

    if (found && alterEgoIds.has(found.snapshot.alterEgoId)) {
        alterEgoId = found.snapshot.alterEgoId;
        alterEgoSource = 'chat';
        alterEgoReason = String(found.snapshot.alterEgoReason || '');
    }

    if (overrideApplies && alterEgoIds.has(override.alterEgoId)) {
        alterEgoId = override.alterEgoId;
        alterEgoSource = 'manual';
        alterEgoReason = 'Set by hand in this chat';
    }

    const fields = {};

    for (const alterEgo of cardState.alterEgos || []) {
        for (const field of alterEgo.fields || []) {
            const saved = found?.snapshot?.fields?.[field.id];
            const manual = overrideApplies ? override.fields?.[field.id] : undefined;
            let enabled = field.enabled !== false;
            let source = 'default';

            if (saved && typeof saved.enabled === 'boolean') {
                enabled = saved.enabled;
                source = 'chat';
            }

            if (typeof manual === 'boolean') {
                enabled = manual;
                source = 'manual';
            }

            fields[field.id] = {
                enabled,
                actionKey: String(saved?.actionKey || ''),
                stickyRemaining: Number(saved?.stickyRemaining) || 0,
                reason: source === 'manual' ? 'Set by hand in this chat' : String(saved?.reason || ''),
                reasonMessage: source === 'chat' && Number.isInteger(saved?.reasonMessage) ? saved.reasonMessage : null,
                source,
            };
        }
    }

    return {
        alterEgoId,
        alterEgoSource,
        alterEgoReason,
        fields,
        baseIndex: found ? found.index : -1,
    };
}

export function serializeRuntime(runtime) {
    const fields = {};

    for (const [fieldId, value] of Object.entries(runtime?.fields || {})) {
        fields[fieldId] = {
            enabled: Boolean(value.enabled),
            ...(value.actionKey ? { actionKey: value.actionKey } : {}),
            ...(Number(value.stickyRemaining) > 0 ? { stickyRemaining: Number(value.stickyRemaining) } : {}),
            ...(value.reason && value.source !== 'manual' ? { reason: value.reason } : {}),
            ...(value.source === 'manual' ? { reason: 'Set by hand in this chat' } : {}),
            ...(Number.isInteger(value.reasonMessage) ? { reasonMessage: value.reasonMessage } : {}),
        };
    }

    return {
        v: 1,
        alterEgoId: runtime?.alterEgoId,
        ...(runtime?.alterEgoReason ? { alterEgoReason: runtime.alterEgoReason } : {}),
        fields,
    };
}

export function invalidateRuntimeCache() {
    runtimeNowCache.clear();
}

export function getCurrentRuntime(scope, key, cardState) {
    if (!key) {
        return resolveRuntime(scope, key, cardState, { chat: [], includeOverride: false });
    }

    const chat = getLiveChat();
    const cacheKey = `${scope}:${key}:${chat.length}:${chat.at(-1)?.swipe_id ?? ''}:${JSON.stringify(cardState.alterEgos?.map((alterEgo) => [alterEgo.id, alterEgo.fields?.map((field) => [field.id, field.enabled])]))}:${cardState.activeAlterEgoId}`;

    if (runtimeNowCache.has(cacheKey)) {
        return clone(runtimeNowCache.get(cacheKey));
    }

    const runtime = resolveRuntime(scope, key, cardState, { chat });
    runtimeNowCache.set(cacheKey, runtime);
    return clone(runtime);
}

export function getRuntimeKeyForScope(scope, entityId) {
    return scope === TARGET_SCOPE.PERSONA ? getPersonaRuntimeKey(entityId) : getCharacterRuntimeKey(entityId);
}

// Card state -> chat-aware view. The __view marker lets toCardState() undo the
// runtime values when the view is saved back to the card.
export function buildViewState(scope, entityId, cardState) {
    const view = cardState;
    const runtime = getCurrentRuntime(scope, getRuntimeKeyForScope(scope, entityId), cardState);
    const cardEnabled = {};
    const effective = {};

    for (const alterEgo of view.alterEgos || []) {
        for (const field of alterEgo.fields || []) {
            cardEnabled[field.id] = field.enabled !== false;
            effective[field.id] = runtime.fields[field.id]?.enabled ?? cardEnabled[field.id];
            field.enabled = effective[field.id];
        }
    }

    view.__view = {
        defaultAlterEgoId: cardState.activeAlterEgoId,
        viewAlterEgoId: runtime.alterEgoId,
        cardEnabled,
        effective,
        runtime,
    };

    view.activeAlterEgoId = runtime.alterEgoId;
    view.fields = getActiveAlterEgoFields(view);
    return view;
}

export function toCardState(state) {
    if (!state || typeof state !== 'object' || !state.__view) {
        return state;
    }

    const card = clone(state);
    const view = card.__view;
    delete card.__view;

    const viewAlterEgo = (card.alterEgos || []).find((alterEgo) => alterEgo.id === card.activeAlterEgoId);

    if (viewAlterEgo && Array.isArray(card.fields)) {
        viewAlterEgo.fields = card.fields;
    }

    for (const alterEgo of card.alterEgos || []) {
        for (const field of alterEgo.fields || []) {
            if (!hasOwn(view.effective, field.id)) {
                continue;
            }

            // Unchanged since the view was built: restore the card default.
            // Changed by the user: the new value becomes the card default too.
            if (field.enabled === view.effective[field.id]) {
                field.enabled = view.cardEnabled[field.id];
            }
        }
    }

    const alterEgoIds = new Set((card.alterEgos || []).map((alterEgo) => alterEgo.id));
    const switchedByUser = card.activeAlterEgoId !== view.viewAlterEgoId;

    if (!switchedByUser && alterEgoIds.has(view.defaultAlterEgoId)) {
        card.activeAlterEgoId = view.defaultAlterEgoId;
    }

    card.fields = getActiveAlterEgoFields(card);
    return card;
}

export function detectManualRuntimeChange(before, after) {
    if (!before?.__view || !after) {
        return null;
    }

    const change = { fields: {} };
    let changed = false;

    if (after.activeAlterEgoId && after.activeAlterEgoId !== before.activeAlterEgoId) {
        change.alterEgoId = after.activeAlterEgoId;
        changed = true;
    }

    const beforeFields = new Map((before.fields || []).map((field) => [field.id, field]));

    for (const field of after.fields || []) {
        const previous = beforeFields.get(field.id);

        if (previous && (previous.enabled !== false) !== (field.enabled !== false)) {
            change.fields[field.id] = field.enabled !== false;
            changed = true;
        }
    }

    return changed ? change : null;
}

export function stampRuntimeOnMessage(messageIndex, { characterKey, characterRuntime, personaKey, personaRuntime } = {}) {
    const chat = getLiveChat();
    const message = chat[Number(messageIndex)];

    if (!message) {
        return false;
    }

    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }

    const extensionExtra = (message.extra[ALTER_EGO_EXTRA_KEY] ??= {});
    const record = (extensionExtra[RUNTIME_EXTRA_KEY] ??= {});

    if (characterKey && characterRuntime) {
        (record.characters ??= {})[characterKey] = characterRuntime;
    }

    if (personaKey && personaRuntime) {
        (record.personas ??= {})[personaKey] = personaRuntime;
    }

    const swipeInfo = message.swipe_info?.[message.swipe_id];

    if (swipeInfo && typeof swipeInfo === 'object') {
        swipeInfo.extra = clone(message.extra);
    }

    invalidateRuntimeCache();
    return true;
}

// One-time copy of pre-v2 data to the user's Files folder before the first
// write in the new format. The original data is never modified in place.
export async function backupLegacyStateIfNeeded(label, rawState) {
    if (!rawState || typeof rawState !== 'object' || Number(rawState.schemaVersion) >= CARD_SCHEMA_VERSION) {
        return;
    }

    const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);

    if (legacyBackupsDone.has(safeLabel)) {
        return;
    }

    legacyBackupsDone.add(safeLabel);

    try {
        const json = JSON.stringify({ type: 'aspect_evolutia_legacy_backup', createdAt: new Date().toISOString(), label, data: rawState }, null, 2);
        const data = btoa(unescape(encodeURIComponent(json)));
        const ctx = getContext();
        const headers = typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: `aspect-evolutia-backup-${safeLabel}-v1.json`, data }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Could not back up legacy data for ${label}:`, error);
    }
}
