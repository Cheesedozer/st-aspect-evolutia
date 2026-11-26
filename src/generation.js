// Aspect: Evolutia — generation.js (split from the former single index.js).
import {
    applyActiveAlterEgoNameToSillyTavern,
    refreshActiveAlterEgoVisualIdentity,
    refreshActivePersonaAlterEgoVisualIdentity,
} from './alter-ego-identity.js';
import {
    getCharacterRuntimeKey,
    getLiveChat,
    getPersonaRuntimeKey,
    invalidateRuntimeCache,
    stampRuntimeOnMessage,
} from './chat-runtime.js';
import {
    ASPECT_INTERCEPTOR_NAME,
    UI,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getGenerationCharacterId,
    getGenerationPersonaId,
    getNativeCharacterName,
    isPersonaDescriptionInPromptManagerPosition,
    normalizeCharacterId,
    normalizePersonaId,
} from './context.js';
import {
    isPersonaUiMounted,
} from './events.js';
import {
    readCardState,
    readPersonaCardState,
    readPersonaState,
    readState,
} from './persistence.js';
import {
    clearAllPreparedPrompts,
    clearPreparedPersonaPrompt,
    clearPreparedPrompt,
    computeCharacterGeneration,
    computePersonaGeneration,
    setPreparedPersonaPrompt,
    setPreparedPrompt,
    setTriggerActionPrompt,
} from './prompt-assembly.js';
import {
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    importedSetCharacterName,
} from './st-imports.js';
import {
    setActivatedWorldInfoEntries,
} from './trigger-sources.js';
import {
    renderPanel,
    renderPersonaPanel,
} from './ui-render.js';

// Module state (written only by this module).
export let currentGenerationCharacterId = undefined;
export let currentGenerationPersonaId = undefined;
export let currentGenerationId = 0;
export let generationSerial = 0;


// ============================================================================
// Section 16. Generation Flow
// ============================================================================
// Purpose:
// - Own Prompt Interceptor preparation and generation completion cleanup.
// ============================================================================

// -----------------------------------------------------------------------------
// Generation Flow - Interceptor Argument Helpers
// -----------------------------------------------------------------------------

export function getInterceptorOptionsFromArgs(args = []) {
    const objects = args.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));

    return Object.assign({}, ...objects);
}

export function getInterceptorChatFromArgs(args = []) {
    const firstArray = args.find((entry) => Array.isArray(entry));

    if (Array.isArray(firstArray)) {
        return firstArray;
    }

    const options = getInterceptorOptionsFromArgs(args);
    const optionChat = options.chat ?? options.messages ?? options.promptMessages;

    return Array.isArray(optionChat) ? optionChat : [];
}

// -----------------------------------------------------------------------------
// Generation Flow - Lifecycle Helpers
// -----------------------------------------------------------------------------

export function generationEntityIdsMatch(characterId, personaId) {
    const normalizedCharacterId = characterId === undefined || characterId === null || characterId === ''
        ? undefined
        : normalizeCharacterId(characterId);
    const normalizedPersonaId = normalizePersonaId(personaId);

    const currentCharacterMatches = (
        currentGenerationCharacterId === normalizedCharacterId ||
        String(currentGenerationCharacterId ?? '') === String(normalizedCharacterId ?? '')
    );

    const currentPersonaMatches = (
        currentGenerationPersonaId === normalizedPersonaId ||
        String(currentGenerationPersonaId ?? '') === String(normalizedPersonaId ?? '')
    );

    return currentCharacterMatches && currentPersonaMatches;
}

export function beginGenerationLifecycle(characterId, personaId = getActivePersonaId()) {
    const normalizedCharacterId = characterId === undefined || characterId === null || characterId === ''
        ? undefined
        : normalizeCharacterId(characterId);
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (normalizedCharacterId !== undefined) {
        applyActiveAlterEgoNameToSillyTavern(normalizedCharacterId);
    }

    // SillyTavern may build/prepare prompt data more than once during one logical
    // generation. Reusing the active lifecycle prevents Character Trigger Action
    // state from being treated as "earlier generation" during repeated prompt builds.
    if (
        currentGenerationId &&
        generationEntityIdsMatch(normalizedCharacterId, normalizedPersonaId)
    ) {
        clearPreparedPrompt(normalizedCharacterId);
        clearPreparedPersonaPrompt(normalizedPersonaId);
        return currentGenerationId;
    }

    generationSerial += 1;
    currentGenerationId = generationSerial;
    currentGenerationCharacterId = normalizedCharacterId;
    currentGenerationPersonaId = normalizedPersonaId;

    clearPreparedPrompt(normalizedCharacterId);
    clearPreparedPersonaPrompt(normalizedPersonaId);

    return currentGenerationId;
}

export function clearGenerationLifecycle() {
    currentGenerationCharacterId = undefined;
    currentGenerationPersonaId = undefined;
    currentGenerationId = 0;
}

export function resolveInterceptorCharacterId(options = {}) {
    if (options && Object.keys(options).length) {
        const generationCharacterId = getGenerationCharacterId(options);

        if (generationCharacterId !== undefined && generationCharacterId !== null && generationCharacterId !== '') {
            return generationCharacterId;
        }
    }

    if (currentGenerationCharacterId !== undefined && currentGenerationCharacterId !== null && currentGenerationCharacterId !== '') {
        return currentGenerationCharacterId;
    }

    return getActiveCharacterId();
}

export function resolveInterceptorPersonaId(options = {}) {
    if (options && Object.keys(options).length) {
        const generationPersonaId = getGenerationPersonaId(options);

        if (generationPersonaId !== undefined && generationPersonaId !== null && generationPersonaId !== '') {
            return generationPersonaId;
        }
    }

    if (currentGenerationPersonaId !== undefined && currentGenerationPersonaId !== null && currentGenerationPersonaId !== '') {
        return currentGenerationPersonaId;
    }

    return getActivePersonaId();
}

// -----------------------------------------------------------------------------
// Generation Flow - Completion Cleanup
// -----------------------------------------------------------------------------

// State computed by the interceptor, waiting to be stamped on the reply.
export let pendingRuntimeStamp = null;

export function clearPendingRuntimeStamp() {
    pendingRuntimeStamp = null;
}

export function finishGenerationLifecycle() {
    activeGenerationContext = null;
    setTriggerActionPrompt('');
    const characterId = currentGenerationCharacterId;
    const personaId = currentGenerationPersonaId;

    if (characterId !== undefined && characterId !== null && characterId !== '') {
        clearPreparedPrompt(characterId);
    }

    if (personaId !== undefined && personaId !== null && personaId !== '') {
        clearPreparedPersonaPrompt(personaId);
    }

    clearGenerationLifecycle();
}

// -----------------------------------------------------------------------------
// Generation Flow - Prompt Interceptor
// -----------------------------------------------------------------------------

// SillyTavern calls interceptors as (chat, contextSize, abort, type).
// Background ('quiet') runs and Impersonate must never advance Evolutia state:
// they are not the character's reply. They also never receive Trigger Actions.
export function getInterceptorGenerationType(args = []) {
    const type = args.find((entry) => typeof entry === 'string');
    return type ? String(type).trim().toLowerCase() : 'normal';
}

export function isReadOnlyGenerationType(type) {
    return type === 'quiet' || type === 'impersonate';
}

// Index of the chat message this generation writes. Swipe and Continue rewrite
// the last message, so the state before it is the starting point.
export function getGenerationTargetIndex(type) {
    const chat = getLiveChat();
    return type === 'swipe' || type === 'continue' ? Math.max(0, chat.length - 1) : chat.length;
}

export async function aspectEvolutiaGenerateInterceptor(...args) {
    const chat = getInterceptorChatFromArgs(args);
    const options = getInterceptorOptionsFromArgs(args);
    const generationType = getInterceptorGenerationType(args);
    const readOnly = isReadOnlyGenerationType(generationType);
    const includeTriggerActions = !readOnly;
    const targetIndex = getGenerationTargetIndex(generationType);
    const scanChat = Array.isArray(chat) ? chat : [];

    const characterId = resolveInterceptorCharacterId(options);
    const personaId = resolveInterceptorPersonaId(options);

    if (!readOnly) {
        pendingRuntimeStamp = null;
    }

    // Never leave a previous reply's action note in place.
    setTriggerActionPrompt('');

    if (
        (characterId === undefined || characterId === null || characterId === '') &&
        !personaId
    ) {
        clearAllPreparedPrompts();
        clearGenerationLifecycle();
        return;
    }

    const generationId = beginGenerationLifecycle(characterId, personaId);
    const context = { characterId, personaId, generationId, scanChat, includeTriggerActions, readOnly, targetIndex, generationType };

    // A read-only run nested inside a real reply (SillyBunny auxiliary runs)
    // must not replace the reply's context or its World Info text.
    if (readOnly && activeGenerationContext && !activeGenerationContext.readOnly) {
        computeActiveGeneration(context);
        return;
    }

    setActivatedWorldInfoEntries([]);
    activeGenerationContext = context;
    computeActiveGeneration();
}

globalThis[ASPECT_INTERCEPTOR_NAME] = aspectEvolutiaGenerateInterceptor;

// Inputs of the generation in progress, kept so it can be re-evaluated once
// World Info has activated (SillyTavern scans World Info after interceptors,
// but before the Evolutia macros are read).
export let activeGenerationContext = null;

export function computeActiveGeneration(context = activeGenerationContext) {

    if (!context) {
        return;
    }

    const { characterId, personaId, generationId, scanChat, includeTriggerActions, readOnly, targetIndex, generationType } = context;
    const stamp = { targetIndex, type: generationType };

    if (characterId !== undefined && characterId !== null && characterId !== '') {
        const result = computeCharacterGeneration(characterId, scanChat, {
            includeTriggerActions,
            endExclusive: targetIndex,
        });

        if (!readOnly) {
            setTriggerActionPrompt(result.actionPrompt);
        }

        if (result.runtime) {
            setPreparedPrompt(characterId, generationId, result.prompt);
            stamp.characterKey = getCharacterRuntimeKey(characterId);
            stamp.characterRuntime = result.runtime;
            applyCharacterNameForGeneration(characterId, result.alterEgo);
        } else {
            clearPreparedPrompt(characterId);
        }
    }

    if (personaId) {
        const personaCard = readPersonaCardState(personaId);

        if (personaCard.swapEnabled && isPersonaDescriptionInPromptManagerPosition(personaId)) {
            const result = computePersonaGeneration(personaId, scanChat, { endExclusive: targetIndex });
            setPreparedPersonaPrompt(personaId, generationId, result.prompt);
            stamp.personaKey = getPersonaRuntimeKey(personaId);
            stamp.personaRuntime = result.runtime;
        } else {
            clearPreparedPersonaPrompt(personaId);
        }
    }

    if (!readOnly && (stamp.characterRuntime || stamp.personaRuntime)) {
        pendingRuntimeStamp = stamp;
    }
}

export function onWorldInfoActivated(entries) {
    setActivatedWorldInfoEntries(entries);
}

// Called from the macros: the first read in a generation re-evaluates with the
// sources that only exist by then (activated World Info, Author's Note and
// other injections set after interceptors ran).
export function finalizeActiveGenerationOnce() {
    const context = activeGenerationContext;

    if (!context || context.finalized) {
        return;
    }

    context.finalized = true;
    computeActiveGeneration(context);
}

export function applyCharacterNameForGeneration(characterId, alterEgo) {
    const cardState = readCardState(characterId);

    if (!cardState.swapEnabled || !alterEgo) {
        return;
    }

    const name = String(alterEgo.name || '').trim() || getNativeCharacterName(characterId);

    if (typeof importedSetCharacterName === 'function') {
        importedSetCharacterName(name);
    }
}

// Called when a reply lands (MESSAGE_RECEIVED). Stamps the state the reply was
// written with onto that message (and its current swipe).
export function stampPendingRuntimeOnMessage(messageId) {
    const stamp = pendingRuntimeStamp;
    const index = Number(messageId);
    const message = getLiveChat()[index];

    if (!stamp || !message || message.is_user || index !== stamp.targetIndex) {
        return false;
    }

    pendingRuntimeStamp = null;
    stampRuntimeOnMessage(index, stamp);
    return true;
}

// -----------------------------------------------------------------------------
// Generation Flow - Completion
// -----------------------------------------------------------------------------

export function onGenerationFinished() {
    finishGenerationLifecycle();
    setTimeout(() => {
        refreshCharacterRuntimeUi();
    }, 0);
}

// Stop cancels: the state computed for the interrupted reply is discarded, so
// a Trigger Action that was cut off is performed again by the next reply.
// This no longer depends on the order of GENERATION_ENDED / GENERATION_STOPPED
// (SillyTavern emits ENDED first when Stop is clicked).
export function onGenerationStopped() {
    pendingRuntimeStamp = null;
    finishGenerationLifecycle();
}

export let lastRuntimeUiSignature = '';

export function getRuntimeUiSignature() {
    const parts = [];
    const characterId = getActiveCharacterId();
    const personaId = getActivePersonaId();

    if (characterId !== undefined) {
        const runtime = readState(characterId).__view?.runtime;
        parts.push(JSON.stringify([runtime?.alterEgoId, runtime?.fields]));
    }

    if (personaId) {
        const runtime = readPersonaState(personaId).__view?.runtime;
        parts.push(JSON.stringify([runtime?.alterEgoId, runtime?.fields]));
    }

    return `${characterId}|${personaId}|${parts.join('|')}`;
}

// Re-renders only when the chat state shown in the editor changed, so open
// field menus are not closed by every generation.
export function refreshCharacterRuntimeUi() {
    invalidateRuntimeCache();
    applyActiveAlterEgoNameToSillyTavern();
    refreshActiveAlterEgoVisualIdentity();
    refreshActivePersonaAlterEgoVisualIdentity();

    const signature = getRuntimeUiSignature();

    if (signature === lastRuntimeUiSignature) {
        return;
    }

    lastRuntimeUiSignature = signature;

    if ($(`#${UI.PANEL_ID}`).length) {
        renderPanel();
    }

    if (isPersonaUiMounted()) {
        renderPersonaPanel();
    }

    updateSettingsActionState();
}
