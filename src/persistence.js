// Aspect: Evolutia — persistence.js (split from the former single index.js).
import {
    applyActiveAlterEgoNameToSillyTavern,
    refreshActiveAlterEgoVisualIdentity,
    refreshActivePersonaAlterEgoVisualIdentity,
} from './alter-ego-identity.js';
import {
    backupLegacyStateIfNeeded,
    buildViewState,
    detectManualRuntimeChange,
    getCharacterRuntimeKey,
    getPersonaRuntimeKey,
    setChatRuntimeOverride,
    toCardState,
} from './chat-runtime.js';
import {
    MODULE_NAME,
    TARGET_SCOPE,
    personaStateCache,
    stateCache,
} from './constants.js';
import {
    findCharacterIdForMemberReference,
    getActiveCharacterId,
    getActivePersonaId,
    getCacheKey,
    getCharacter,
    getContext,
    getNativeCharacterAvatarKey,
    getPersonaCacheKey,
    getPersonaExtensionStateRecord,
    getSaveSettingsDebounced,
    normalizePersonaId,
    setPersonaExtensionStateRecord,
} from './context.js';
import {
    normalizeCharacterState,
    normalizePersonaState,
} from './model.js';
import {
    syncPromptManagerForPersonaState,
    syncPromptManagerForState,
} from './prompt-manager.js';
import {
    scheduleSettingsActionStateUpdate,
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    schedulePersonaTokenEstimateUpdate,
    scheduleTokenEstimateUpdate,
    updatePersonaTokenEstimate,
    updateTokenEstimate,
} from './token-estimate.js';
import {
    applyPersonaUiVisibility,
    applyUiVisibility,
    renderPanel,
    renderPersonaPanel,
} from './ui-render.js';
import {
    clone,
    notify,
} from './utils.js';

// ============================================================================
// Section 6. Character and Persona Extension Persistence
// ============================================================================
// Purpose:
// - Own reading, caching, and saving per-character Aspect: Evolutia data.
// - Own reading, caching, and saving per-persona Aspect: Evolutia data.
// ============================================================================

// -----------------------------------------------------------------------------
// Character Extension Persistence - Read and Cache
// -----------------------------------------------------------------------------

export function readCardState(characterId = getActiveCharacterId()) {
    const key = getCacheKey(characterId);

    if (stateCache.has(key)) {
        return clone(stateCache.get(key));
    }

    const character = getCharacter(characterId);
    const rawState = character?.data?.extensions?.[MODULE_NAME];
    const state = normalizeCharacterState(rawState, { characterId });

    stateCache.set(key, state);
    return clone(state);
}

// Returns the character state as seen from the currently open chat: the alter
// ego and Inject values reflect this chat's runtime state (see Section 6A),
// while everything else is the card definition. Pass the result back through
// updateState / scheduleSave / cacheState, which convert it to card form.
export function readState(characterId = getActiveCharacterId()) {
    return buildViewState(TARGET_SCOPE.CHARACTER, characterId, readCardState(characterId));
}

export function cacheState(characterId, state) {
    const normalized = normalizeCharacterState(toCardState(state), { characterId });
    stateCache.set(getCacheKey(characterId), normalized);
    return clone(normalized);
}

// -----------------------------------------------------------------------------
// Character Extension Persistence - Save
// -----------------------------------------------------------------------------

export async function saveStateNow(characterId, state) {
    const ctx = getContext();

    if (characterId === undefined || characterId === null || characterId === '') {
        return;
    }

    if (typeof ctx?.writeExtensionField !== 'function') {
        notify('error', 'writeExtensionField is unavailable in this SillyTavern build.');
        return;
    }

    try {
        const rawBefore = getCharacter(characterId)?.data?.extensions?.[MODULE_NAME];
        await backupLegacyStateIfNeeded(`character-${getNativeCharacterAvatarKey(characterId) || characterId}`, rawBefore);
        await ctx.writeExtensionField(characterId, MODULE_NAME, normalizeCharacterState(toCardState(state), { characterId }));
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to save character extension data:`, error);
        notify('error', 'Failed to save Aspect: Evolutia character fields.');
    }
}

// Debounced saves, one timer per character/persona so a save for one entity
// never cancels another's. flushPendingSaves() writes everything immediately.
export const pendingSaves = new Map();

export function schedulePendingSave(key, run, delay = 400) {
    const existing = pendingSaves.get(key);

    if (existing) {
        clearTimeout(existing.timer);
    }

    const entry = {
        run,
        timer: setTimeout(() => {
            pendingSaves.delete(key);
            run();
        }, delay),
    };

    pendingSaves.set(key, entry);
}

export function flushPendingSaves() {
    const entries = [...pendingSaves.values()];
    pendingSaves.clear();

    for (const entry of entries) {
        clearTimeout(entry.timer);
        entry.run();
    }
}

export function scheduleSave(characterId, state) {
    const normalized = cacheState(characterId, state);
    // Key by avatar file, not list index: indexes shift when characters are added.
    const avatarKey = getNativeCharacterAvatarKey(characterId);

    schedulePendingSave(`character:${avatarKey || characterId}`, () => {
        const currentId = avatarKey ? findCharacterIdForMemberReference(avatarKey) ?? characterId : characterId;
        saveStateNow(currentId, normalized);
    });
}

export function updateState(mutator, {
    rerender = false,
    syncPromptManager = false,
    applyIdentity = true,
    deferTokenEstimate = false,
    deferSettingsActionState = false,
} = {}) {
    const characterId = getActiveCharacterId();

    if (characterId === undefined) {
        notify('warning', 'Select a character before editing Character Dynamic Fields.');
        return;
    }

    const state = readState(characterId);
    const before = clone(state);
    mutator(state);

    const manualRuntimeChange = detectManualRuntimeChange(before, state);
    const normalized = normalizeCharacterState(toCardState(state), { characterId });
    scheduleSave(characterId, normalized);

    if (manualRuntimeChange) {
        setChatRuntimeOverride(TARGET_SCOPE.CHARACTER, getCharacterRuntimeKey(characterId), manualRuntimeChange);
    }

    if (applyIdentity) {
        applyActiveAlterEgoNameToSillyTavern(characterId);
        refreshActiveAlterEgoVisualIdentity(characterId);
    }

    if (rerender) {
        renderPanel();
    } else {
        applyUiVisibility();
    }

    if (syncPromptManager) {
        syncPromptManagerForState(normalized);
    }

    if (deferTokenEstimate) {
        scheduleTokenEstimateUpdate();
    } else {
        updateTokenEstimate();
    }

    if (deferSettingsActionState) {
        scheduleSettingsActionStateUpdate();
    } else {
        updateSettingsActionState();
    }
}

// -----------------------------------------------------------------------------
// Persona Extension Persistence - Read and Cache
// -----------------------------------------------------------------------------

export function readPersonaCardState(personaId = getActivePersonaId()) {
    const key = getPersonaCacheKey(personaId);

    if (personaStateCache.has(key)) {
        return clone(personaStateCache.get(key));
    }

    const rawState = getPersonaExtensionStateRecord(personaId);
    const state = normalizePersonaState(rawState, { personaId });

    personaStateCache.set(key, state);
    return clone(state);
}

export function readPersonaState(personaId = getActivePersonaId()) {
    return buildViewState(TARGET_SCOPE.PERSONA, personaId, readPersonaCardState(personaId));
}

export function cachePersonaState(personaId, state) {
    const normalized = normalizePersonaState(toCardState(state), { personaId });
    personaStateCache.set(getPersonaCacheKey(personaId), normalized);
    return clone(normalized);
}

export function clearPersonaStateCache(personaId = undefined) {
    if (personaId === undefined || personaId === null || personaId === '') {
        personaStateCache.clear();
        return;
    }

    personaStateCache.delete(getPersonaCacheKey(personaId));
}

// -----------------------------------------------------------------------------
// Persona Extension Persistence - Save
// -----------------------------------------------------------------------------

export async function savePersonaStateNow(personaId, state) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return;
    }

    await backupLegacyStateIfNeeded(`persona-${normalizedPersonaId}`, getPersonaExtensionStateRecord(normalizedPersonaId));
    const normalizedState = normalizePersonaState(toCardState(state), { personaId: normalizedPersonaId });
    const savedToSettings = setPersonaExtensionStateRecord(normalizedPersonaId, normalizedState);

    if (!savedToSettings) {
        notify('error', 'Persona settings are unavailable in this SillyTavern build.');
        return;
    }

    cachePersonaState(normalizedPersonaId, normalizedState);

    try {
        const saveSettingsDebounced = getSaveSettingsDebounced();

        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
            return;
        }

        const ctx = getContext();

        if (typeof ctx?.saveSettings === 'function') {
            await ctx.saveSettings();
            return;
        }

        if (typeof globalThis.saveSettings === 'function') {
            await globalThis.saveSettings();
            return;
        }

        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
            return;
        }

        console.warn(`[${MODULE_NAME}] Persona Dynamic Fields were cached, but no settings save hook was found.`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to save persona extension data:`, error);
        notify('error', 'Failed to save Aspect: Evolutia persona fields.');
    }
}

export function schedulePersonaSave(personaId, state) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return;
    }

    const normalized = cachePersonaState(normalizedPersonaId, state);

    schedulePendingSave(`persona:${normalizedPersonaId}`, () => {
        savePersonaStateNow(normalizedPersonaId, normalized);
    });
}

export function updatePersonaState(mutator, {
    rerender = false,
    syncPromptManager = false,
    applyIdentity = true,
    deferTokenEstimate = false,
    deferSettingsActionState = false,
} = {}) {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before editing Persona Dynamic Fields.');
        return;
    }

    const state = readPersonaState(personaId);
    const before = clone(state);
    mutator(state);

    const manualRuntimeChange = detectManualRuntimeChange(before, state);
    const normalized = normalizePersonaState(toCardState(state), { personaId });
    schedulePersonaSave(personaId, normalized);

    if (manualRuntimeChange) {
        setChatRuntimeOverride(TARGET_SCOPE.PERSONA, getPersonaRuntimeKey(personaId), manualRuntimeChange);
    }

    if (applyIdentity) {
        refreshActivePersonaAlterEgoVisualIdentity(personaId);
    }

    if (rerender) {
        renderPersonaPanel();
    } else {
        applyPersonaUiVisibility();
    }

    if (syncPromptManager) {
        syncPromptManagerForPersonaState(normalized);
    }

    if (deferTokenEstimate) {
        schedulePersonaTokenEstimateUpdate();
    } else {
        updatePersonaTokenEstimate();
    }

    if (deferSettingsActionState) {
        scheduleSettingsActionStateUpdate();
    } else {
        updateSettingsActionState();
    }
}

// -----------------------------------------------------------------------------
// Character and Persona Extension Persistence - Bulk Cache Utilities
// -----------------------------------------------------------------------------

export function clearAllStateCaches() {
    stateCache.clear();
    personaStateCache.clear();
}
