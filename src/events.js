// Aspect: Evolutia — events.js (split from the former single index.js).
import {
    applyActiveAlterEgoNameToSillyTavern,
    applyPersonaAlterEgoSwapForUserMessage,
    isAssistantMessageForCharacter,
    isUserMessage,
    refreshActiveAlterEgoVisualIdentity,
    refreshActivePersonaAlterEgoVisualIdentity,
    stampMessageWithActiveAlterEgoIdentity,
    stampMessageWithActivePersonaAlterEgoIdentity,
} from './alter-ego-identity.js';
import {
    invalidateRuntimeCache,
} from './chat-runtime.js';
import {
    UI,
    stateCache,
} from './constants.js';
import {
    deletePersonaExtensionStateRecord,
    getContext,
    getSaveSettingsDebounced,
    invalidateSelectableAvatarCharactersCache,
    invalidateSelectablePersonaAvatarsCache,
    migrateImageDataForCurrentChat,
    normalizePersonaId,
} from './context.js';
import {
    clearGenerationLifecycle,
    clearPendingRuntimeStamp,
    onGenerationFinished,
    onGenerationStopped,
    onWorldInfoActivated,
    refreshCharacterRuntimeUi,
    stampPendingRuntimeOnMessage,
} from './generation.js';
import {
    clearAllStateCaches,
    clearPersonaStateCache,
    flushPendingSaves,
} from './persistence.js';
import {
    clearAllPreparedPrompts,
} from './prompt-assembly.js';
import {
    ensureLegacyMacrosIfNeeded,
    syncPromptManagerWithActivePersonaState,
    syncPromptManagerWithActiveState,
    syncPromptManagerWithActiveStates,
} from './prompt-manager.js';
import {
    mountExtensionSettings,
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    updatePersonaTokenEstimate,
    updateTokenEstimate,
} from './token-estimate.js';
import {
    closeImportExportMenus,
} from './ui-events.js';
import {
    applyPersonaUiVisibility,
    getPersonaDescriptionTextarea,
    mountPersonaUi,
    mountUi,
    renderPersonaPanel,
} from './ui-render.js';

// Module state (written only by this module).
export let mountTimer = null;
export let personaMountTimer = null;


// ============================================================================
// Section 17. SillyTavern Event Wiring
// ============================================================================
// Purpose:
// - Own subscriptions to SillyTavern app, character, persona, chat, prompt,
//   settings, and generation events.
// ============================================================================

// -----------------------------------------------------------------------------
// SillyTavern Event Wiring - Dynamic Fields Menu State
// -----------------------------------------------------------------------------

export function closeDynamicFieldsMenusForHardRefresh() {
    if (typeof closeImportExportMenus === 'function') {
        closeImportExportMenus();
        return;
    }

    $('.dsf-menu-open').removeClass('dsf-menu-open');
}

// -----------------------------------------------------------------------------
// SillyTavern Event Wiring - Persona Mount Safety
// -----------------------------------------------------------------------------

export function isPersonaUiMounted() {
    return Boolean(
        document.getElementById(UI.PERSONA_BAR_ID) &&
        document.getElementById(UI.PERSONA_PANEL_ID),
    );
}

export function canMountPersonaUi() {
    return Boolean(getPersonaDescriptionTextarea().length);
}

export function mountPersonaUiIfMissing() {
    if (!canMountPersonaUi()) {
        return;
    }

    if (isPersonaUiMounted()) {
        applyPersonaUiVisibility();
        refreshActivePersonaAlterEgoVisualIdentity();
        updatePersonaTokenEstimate();
        updateSettingsActionState();
        return;
    }

    mountPersonaUi();
}

export function schedulePersonaMountIfMissing() {
    clearTimeout(personaMountTimer);

    personaMountTimer = setTimeout(() => {
        mountPersonaUiIfMissing();
    }, 150);
}

export function scheduleAllMountsIfMissing() {
    if (typeof scheduleMount === 'function') {
        scheduleMount();
    } else {
        setTimeout(mountUi, 150);
    }

    schedulePersonaMountIfMissing();
}

export function ensurePersonaDomObserver() {
    if (ensurePersonaDomObserver.observer || !document.body) {
        return;
    }

    const observer = new MutationObserver(() => {
        // Only mount after SillyTavern has actually created/replaced the Persona
        // description area and our Persona UI is missing. Never remount simply
        // because Persona Management mutated unrelated DOM.
        if (canMountPersonaUi() && !isPersonaUiMounted()) {
            schedulePersonaMountIfMissing();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    ensurePersonaDomObserver.observer = observer;
}

// -----------------------------------------------------------------------------
// SillyTavern Event Wiring - Shared Refresh Helpers
// -----------------------------------------------------------------------------

export function refreshCharacterUiAfterStateChange() {
    closeDynamicFieldsMenusForHardRefresh();

    invalidateSelectableAvatarCharactersCache();
    stateCache.clear();
    clearAllPreparedPrompts();
    clearGenerationLifecycle();
    applyActiveAlterEgoNameToSillyTavern();
    refreshActiveAlterEgoVisualIdentity();

    if (typeof scheduleMount === 'function') {
        scheduleMount();
    } else {
        setTimeout(mountUi, 150);
    }

    updateSettingsActionState();
    syncPromptManagerWithActiveState();
}

export function refreshPersonaUiAfterPersonaChanged() {
    invalidateSelectablePersonaAvatarsCache();

    // Persona changes are a real identity/context switch. Closing menus here is
    // correct because the open field editor may now belong to a different persona.
    closeDynamicFieldsMenusForHardRefresh();

    clearPersonaStateCache();
    clearAllPreparedPrompts();
    clearGenerationLifecycle();

    if (isPersonaUiMounted()) {
        renderPersonaPanel();
        applyPersonaUiVisibility();
        refreshActivePersonaAlterEgoVisualIdentity();
        updatePersonaTokenEstimate();
    } else {
        schedulePersonaMountIfMissing();
    }

    updateSettingsActionState();
    syncPromptManagerWithActivePersonaState();
}

export function refreshAllUiAfterStateChange() {
    closeDynamicFieldsMenusForHardRefresh();

    invalidateSelectableAvatarCharactersCache();
    invalidateSelectablePersonaAvatarsCache();
    clearAllStateCaches();
    clearAllPreparedPrompts();
    clearGenerationLifecycle();
    applyActiveAlterEgoNameToSillyTavern();
    refreshActiveAlterEgoVisualIdentity();
    refreshActivePersonaAlterEgoVisualIdentity();

    scheduleAllMountsIfMissing();

    updateSettingsActionState();
    syncPromptManagerWithActiveStates();
}

export function refreshTokenEstimatesAfterContextChange() {
    updateTokenEstimate();
    updatePersonaTokenEstimate();
}

export function refreshAfterGenericSettingsUpdate() {
    ensureLegacyMacrosIfNeeded();
    // SETTINGS_UPDATED also fires after our own debounced saves and Prompt Manager
    // syncs. Do not mount or render panels here; doing so destroys open popout DOM.
    updateSettingsActionState();
    refreshTokenEstimatesAfterContextChange();

    if (!isPersonaUiMounted()) {
        schedulePersonaMountIfMissing();
    } else {
        applyPersonaUiVisibility();
    }
}

export function runAfterSettingsSettle(callback, delay = 100) {
    setTimeout(callback, delay);
}

export function registerEventHandler(eventSource, eventTypes, eventName, handler) {
    const eventType = eventTypes?.[eventName];

    if (!eventType || typeof eventSource?.on !== 'function') {
        return false;
    }

    eventSource.on(eventType, handler);
    return true;
}

// -----------------------------------------------------------------------------
// SillyTavern Event Wiring - Registration
// -----------------------------------------------------------------------------

export function registerEvents() {
    if (registerEvents.registered) {
        return;
    }

    const ctx = getContext();
    const eventSource = ctx?.eventSource;
    const eventTypes = ctx?.eventTypes ?? ctx?.event_types;

    if (!eventSource || !eventTypes) {
        setTimeout(registerEvents, 250);
        return;
    }

    registerEvents.registered = true;
    ensurePersonaDomObserver();

    const onAppReady = () => {
        ensureLegacyMacrosIfNeeded();
        mountExtensionSettings();
        mountUi();
        mountPersonaUiIfMissing();
        updateSettingsActionState();
        syncPromptManagerWithActiveStates();
        applyActiveAlterEgoNameToSillyTavern();
        refreshActiveAlterEgoVisualIdentity();
        refreshActivePersonaAlterEgoVisualIdentity();
    };

    registerEventHandler(eventSource, eventTypes, 'APP_INITIALIZED', () => {
        ensureLegacyMacrosIfNeeded();
        mountExtensionSettings();
        mountUi();
        mountPersonaUiIfMissing();
        updateSettingsActionState();
    });

    registerEventHandler(eventSource, eventTypes, 'APP_READY', onAppReady);

    window.addEventListener('beforeunload', flushPendingSaves);

    registerEventHandler(eventSource, eventTypes, 'CHAT_CHANGED', () => {
        setTimeout(migrateImageDataForCurrentChat, 500);
        flushPendingSaves();
        clearPendingRuntimeStamp();
        invalidateRuntimeCache();
        refreshAllUiAfterStateChange();
    });

    registerEventHandler(eventSource, eventTypes, 'CHARACTER_EDITED', () => {
        refreshCharacterUiAfterStateChange();
    });

    registerEventHandler(eventSource, eventTypes, 'CHARACTER_PAGE_LOADED', () => {
        refreshCharacterUiAfterStateChange();
    });

    ['CHARACTER_DELETED', 'CHARACTER_DUPLICATED', 'CHARACTER_RENAMED'].forEach((eventName) => {
        registerEventHandler(eventSource, eventTypes, eventName, () => {
            invalidateSelectableAvatarCharactersCache();
        });
    });

    registerEventHandler(eventSource, eventTypes, 'PERSONA_CHANGED', () => {
        refreshPersonaUiAfterPersonaChanged();
    });

    ['PERSONA_CREATED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'PERSONA_DELETED'].forEach((eventName) => {
        registerEventHandler(eventSource, eventTypes, eventName, () => {
            invalidateSelectablePersonaAvatarsCache();
        });
    });

    registerEventHandler(eventSource, eventTypes, 'PERSONA_DELETED', (payload) => {
        const personaId = normalizePersonaId(payload?.avatarId ?? payload);

        if (personaId && deletePersonaExtensionStateRecord(personaId)) {
            clearPersonaStateCache(personaId);
            getSaveSettingsDebounced()?.();
        }
    });

    registerEventHandler(eventSource, eventTypes, 'MESSAGE_SENT', (messageId) => {
        const ctx = getContext();
        const resolvedMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : ((ctx?.chat?.length ?? 1) - 1);
        const message = ctx?.chat?.[resolvedMessageId];

        if (isUserMessage(message)) {
            applyPersonaAlterEgoSwapForUserMessage(resolvedMessageId, message);
            stampMessageWithActivePersonaAlterEgoIdentity(resolvedMessageId, message);
        }

        runAfterSettingsSettle(refreshTokenEstimatesAfterContextChange, 50);
    });

    registerEventHandler(eventSource, eventTypes, 'MESSAGE_RECEIVED', (messageId) => {
        const ctx = getContext();
        const resolvedMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : ((ctx?.chat?.length ?? 1) - 1);
        const message = ctx?.chat?.[resolvedMessageId];

        stampPendingRuntimeOnMessage(resolvedMessageId);

        if (isAssistantMessageForCharacter(message)) {
            stampMessageWithActiveAlterEgoIdentity(resolvedMessageId, message);
        }

        runAfterSettingsSettle(refreshTokenEstimatesAfterContextChange, 50);
    });

    ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED'].forEach((eventName) => {
        registerEventHandler(eventSource, eventTypes, eventName, () => {
            invalidateRuntimeCache();
            runAfterSettingsSettle(refreshCharacterRuntimeUi, 50);
        });
    });

    registerEventHandler(eventSource, eventTypes, 'USER_MESSAGE_RENDERED', (messageId) => {
        const ctx = getContext();
        const resolvedMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : ((ctx?.chat?.length ?? 1) - 1);
        const message = ctx?.chat?.[resolvedMessageId];

        if (isUserMessage(message)) {
            applyPersonaAlterEgoSwapForUserMessage(resolvedMessageId, message);
            stampMessageWithActivePersonaAlterEgoIdentity(resolvedMessageId, message);
        }

        runAfterSettingsSettle(refreshTokenEstimatesAfterContextChange, 50);
    });

    registerEventHandler(eventSource, eventTypes, 'CHARACTER_MESSAGE_RENDERED', (messageId) => {
        const ctx = getContext();
        const resolvedMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : ((ctx?.chat?.length ?? 1) - 1);
        const message = ctx?.chat?.[resolvedMessageId];

        if (isAssistantMessageForCharacter(message)) {
            stampMessageWithActiveAlterEgoIdentity(resolvedMessageId, message);
        }
    });


    registerEventHandler(eventSource, eventTypes, 'WORLD_INFO_ACTIVATED', onWorldInfoActivated);
    registerEventHandler(eventSource, eventTypes, 'GENERATION_ENDED', onGenerationFinished);
    registerEventHandler(eventSource, eventTypes, 'GENERATION_STOPPED', onGenerationStopped);

    registerEventHandler(eventSource, eventTypes, 'MAIN_API_CHANGED', () => {
        runAfterSettingsSettle(() => {
            syncPromptManagerWithActiveStates();
        });
    });

    registerEventHandler(eventSource, eventTypes, 'OAI_PRESET_CHANGED_AFTER', () => {
        runAfterSettingsSettle(() => {
            updateSettingsActionState();
            syncPromptManagerWithActiveStates();
        });
    });

    registerEventHandler(eventSource, eventTypes, 'PRESET_CHANGED', () => {
        runAfterSettingsSettle(() => {
            updateSettingsActionState();
            syncPromptManagerWithActiveStates();
        });
    });

    registerEventHandler(eventSource, eventTypes, 'SETTINGS_UPDATED', () => {
        runAfterSettingsSettle(refreshAfterGenericSettingsUpdate, 100);
    });

    registerEventHandler(eventSource, eventTypes, 'WORLDINFO_UPDATED', () => {
        runAfterSettingsSettle(refreshTokenEstimatesAfterContextChange, 50);
    });

    registerEventHandler(eventSource, eventTypes, 'WORLDINFO_SETTINGS_UPDATED', () => {
        runAfterSettingsSettle(refreshTokenEstimatesAfterContextChange, 50);
    });
}


// ============================================================================
// Section 18. DOM Mount Observer
// ============================================================================
// Purpose:
// - Own remounting the UI when SillyTavern replaces character editor DOM.
// ============================================================================

// -----------------------------------------------------------------------------
// DOM Mount Observer - Scheduled Mount
// -----------------------------------------------------------------------------

export function scheduleMount() {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(mountUi, 150);
}

// -----------------------------------------------------------------------------
// DOM Mount Observer - Mutation Watch
// -----------------------------------------------------------------------------

export function observeDom() {
    if (!document.body) {
        return;
    }

    const observer = new MutationObserver(() => {
        if (!document.getElementById(UI.BAR_ID) || !document.getElementById(UI.PANEL_ID)) {
            scheduleMount();
        }

        if (!document.getElementById(UI.SETTINGS_ID)) {
            mountExtensionSettings();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}
