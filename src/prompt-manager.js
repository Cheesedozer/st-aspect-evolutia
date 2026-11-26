// Aspect: Evolutia — prompt-manager.js (split from the former single index.js).
import {
    CHARACTER_ASPECT_MACRO_NAME,
    CHARACTER_ASPECT_MACRO_TEXT,
    CHARACTER_ASPECT_PROMPT_ID,
    CHARACTER_ASPECT_PROMPT_NAME,
    MODULE_NAME,
    NATIVE_DESCRIPTION_PROMPT_ID,
    NATIVE_PERSONA_PROMPT_ID,
    PERSONA_ASPECT_MACRO_NAME,
    PERSONA_ASPECT_MACRO_TEXT,
    PERSONA_ASPECT_PROMPT_ID,
    PERSONA_ASPECT_PROMPT_NAME,
} from './constants.js';
import {
    getActivePersonaId,
    getContext,
    getCurrentChatCharacterIds,
    getPowerUserSettings,
    isPersonaDescriptionInPromptManagerPosition,
} from './context.js';
import {
    checkStoryStringForTextCompletion,
    warnAboutPresetDescriptionMacros,
} from './macro-replacement.js';
import {
    readCardState,
    readPersonaState,
} from './persistence.js';
import {
    buildAspectEvolutiaCharacterMacroValue,
    buildAspectEvolutiaPersonaMacroValue,
} from './prompt-assembly.js';
import {
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    MacrosParser,
    promptManager,
} from './st-imports.js';
import {
    notify,
} from './utils.js';

// ============================================================================
// Section 9. Prompt Manager Integration
// ============================================================================
// Purpose:
// - Own the custom Prompt Manager prompts and macros used as Description replacements.
// ============================================================================

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Macro Registration
// -----------------------------------------------------------------------------

// SillyTavern has two macro engines. The new one (getContext().macros) is
// used when "experimental macro engine" is on; the legacy one still needs the
// deprecated MacrosParser, so that registration is done only while the legacy
// engine is active (it logs a deprecation warning by design).
export const legacyRegisteredMacros = new Set();
export const registeredMacroHandlers = new Map();

export function isLegacyMacroEngineActive() {
    return !getPowerUserSettings()?.experimental_macro_engine;
}

export function registerMacroInLegacyEngine(name, handler, description) {
    if (legacyRegisteredMacros.has(name)) {
        return;
    }

    try {
        MacrosParser.registerMacro(name, handler, description);
        legacyRegisteredMacros.add(name);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to register legacy macro "${name}":`, error);
    }
}

export function safelyRegisterMacro(name, handler, description) {
    registeredMacroHandlers.set(name, { handler, description });
    const modern = getContext()?.macros;
    let registeredModern = false;

    if (typeof modern?.register === 'function') {
        try {
            registeredModern = Boolean(modern.register(name, {
                category: modern.category?.CHARACTER ?? 'character',
                description,
                handler: () => String(handler() ?? ''),
            }));
        } catch (error) {
            console.warn(`[${MODULE_NAME}] New macro engine registration failed for "${name}":`, error);
        }
    }

    // Settings are not loaded yet at boot; the legacy registration for users of
    // the legacy engine happens in ensureLegacyMacrosIfNeeded() on APP_READY.
    if (!registeredModern) {
        registerMacroInLegacyEngine(name, handler, description);
    }
}

// If the user switches back to the legacy engine later, register there too.
export function ensureLegacyMacrosIfNeeded() {
    if (!isLegacyMacroEngineActive()) {
        return;
    }

    for (const [name, { handler, description }] of registeredMacroHandlers) {
        registerMacroInLegacyEngine(name, handler, description);
    }
}

export function registerAspectMacro() {
    safelyRegisterMacro(
        CHARACTER_ASPECT_MACRO_NAME,
        () => buildAspectEvolutiaCharacterMacroValue(),
        'Aspect: Evolutia effective Character Description. Returns Character Dynamic Fields when enabled, otherwise the native Character Description.',
    );

    safelyRegisterMacro(
        PERSONA_ASPECT_MACRO_NAME,
        () => buildAspectEvolutiaPersonaMacroValue(),
        'Aspect: Evolutia effective Persona Description. Returns Persona Dynamic Fields when enabled, otherwise the native Persona Description.',
    );

    // Compatibility alias for earlier builds that used {{aspectEvolutiaDescription}}.
    // New Prompt Manager entries use {{aspectEvolutiaCharDescription}}.
    safelyRegisterMacro(
        'aspectEvolutiaDescription',
        () => buildAspectEvolutiaCharacterMacroValue(),
        'Legacy Aspect: Evolutia Character Description macro. Prefer {{aspectEvolutiaCharDescription}}.',
    );
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Prompt Manager Access
// -----------------------------------------------------------------------------

export function getPromptManagerInstance() {
    if (!promptManager || !promptManager.serviceSettings) {
        return null;
    }

    return promptManager;
}

export function getPromptManagerTargetCharacter(manager = getPromptManagerInstance()) {
    if (!manager) {
        return null;
    }

    if (manager.activeCharacter) {
        return manager.activeCharacter;
    }

    if (manager.configuration?.promptOrder?.strategy === 'global') {
        return { id: manager.configuration.promptOrder.dummyId };
    }

    return null;
}

export function getPromptOrder(manager = getPromptManagerInstance()) {
    const targetCharacter = getPromptManagerTargetCharacter(manager);

    if (!manager || !targetCharacter || typeof manager.getPromptOrderForCharacter !== 'function') {
        return [];
    }

    return manager.getPromptOrderForCharacter(targetCharacter);
}

export function getPromptOrderEntryById(order, identifier) {
    return order.find((entry) => entry?.identifier === identifier) ?? null;
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Prompt Creation
// -----------------------------------------------------------------------------

export function getAspectPromptData({ name, macroText }) {
    return {
        name,
        role: 'system',
        content: macroText,
        system_prompt: false,
        marker: false,
        extension: true,
        injection_position: 0,
        injection_depth: 4,
        forbid_overrides: false,
    };
}

export function ensurePromptExists(manager, promptId, promptData) {
    const existingPrompt = manager.getPromptById?.(promptId);

    if (existingPrompt) {
        Object.assign(existingPrompt, promptData);
        return existingPrompt;
    }

    manager.addPrompt(promptData, promptId);
    return manager.getPromptById?.(promptId);
}

export function ensureCharacterAspectPromptExists(manager) {
    return ensurePromptExists(
        manager,
        CHARACTER_ASPECT_PROMPT_ID,
        getAspectPromptData({
            name: CHARACTER_ASPECT_PROMPT_NAME,
            macroText: CHARACTER_ASPECT_MACRO_TEXT,
        }),
    );
}

export function ensurePersonaAspectPromptExists(manager) {
    return ensurePromptExists(
        manager,
        PERSONA_ASPECT_PROMPT_ID,
        getAspectPromptData({
            name: PERSONA_ASPECT_PROMPT_NAME,
            macroText: PERSONA_ASPECT_MACRO_TEXT,
        }),
    );
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Prompt Ordering
// -----------------------------------------------------------------------------

export function ensurePromptOrderEntryNearNative(manager, {
    aspectPromptId,
    nativePromptId,
    fallbackPromptId,
    insertAfterFallback = false,
} = {}) {
    const order = getPromptOrder(manager);

    if (!order.length || !aspectPromptId) {
        return null;
    }

    const existingAspectIndex = order.findIndex((entry) => entry?.identifier === aspectPromptId);

    if (existingAspectIndex >= 0) {
        return order[existingAspectIndex];
    }

    const nativeIndex = nativePromptId
        ? order.findIndex((entry) => entry?.identifier === nativePromptId)
        : -1;

    const fallbackIndex = fallbackPromptId
        ? order.findIndex((entry) => entry?.identifier === fallbackPromptId)
        : -1;

    let insertIndex = 0;

    if (nativeIndex >= 0) {
        insertIndex = nativeIndex;
    } else if (fallbackIndex >= 0) {
        insertIndex = fallbackIndex + (insertAfterFallback ? 1 : 0);
    }

    const aspectEntry = {
        identifier: aspectPromptId,
        enabled: false,
    };

    order.splice(insertIndex, 0, aspectEntry);
    return aspectEntry;
}

export function ensureCharacterAspectPromptOrderEntry(manager) {
    return ensurePromptOrderEntryNearNative(manager, {
        aspectPromptId: CHARACTER_ASPECT_PROMPT_ID,
        nativePromptId: NATIVE_DESCRIPTION_PROMPT_ID,
        fallbackPromptId: 'personaDescription',
        insertAfterFallback: true,
    });
}

export function ensurePersonaAspectPromptOrderEntry(manager) {
    return ensurePromptOrderEntryNearNative(manager, {
        aspectPromptId: PERSONA_ASPECT_PROMPT_ID,
        nativePromptId: NATIVE_PERSONA_PROMPT_ID,
        fallbackPromptId: NATIVE_DESCRIPTION_PROMPT_ID,
        insertAfterFallback: false,
    });
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Legacy Prompt Cleanup
// -----------------------------------------------------------------------------

export function disableLegacyAspectPromptIfPresent(manager) {
    const order = getPromptOrder(manager);

    if (!order.length) {
        return;
    }

    const legacyPromptIds = new Set([
        'aspectEvolutiaDescription',
    ]);

    for (const entry of order) {
        const identifier = String(entry?.identifier || '');

        if (legacyPromptIds.has(identifier)) {
            entry.enabled = false;
            continue;
        }

        const prompt = manager.getPromptById?.(identifier);

        if (
            String(prompt?.name || '') === 'Aspect: Evolutia Description' ||
            String(prompt?.content || '').trim() === '{{aspectEvolutiaDescription}}'
        ) {
            entry.enabled = false;
        }
    }
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Prompt Manager Save / Render
// -----------------------------------------------------------------------------

export async function saveAndRenderPromptManager(manager) {
    if (typeof manager.saveServiceSettings === 'function') {
        await manager.saveServiceSettings();
    }

    if (typeof manager.render === 'function') {
        manager.render(false);
    }
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Character Prompt Toggling
// -----------------------------------------------------------------------------

// The Evolutia entry returns the native description for every character that
// does not use Dynamic Fields, so it is switched on (and the native marker off)
// once per preset, as soon as any character in the chat uses Dynamic Fields.
// It is not switched back per character: that made group chats depend on the
// last solo chat. `restoreNative` (used by the Reset actions) undoes it.
export async function syncPromptManagerForState(state, { restoreNative = false } = {}) {
    if (!restoreNative && !state?.swapEnabled) {
        return;
    }

    await setPromptManagerEntries({
        aspectPromptId: CHARACTER_ASPECT_PROMPT_ID,
        nativePromptId: NATIVE_DESCRIPTION_PROMPT_ID,
        ensurePrompt: ensureCharacterAspectPromptExists,
        ensureOrderEntry: ensureCharacterAspectPromptOrderEntry,
        useEvolutia: !restoreNative,
        label: 'Char Description (Evolutia)',
    });

    if (!restoreNative) {
        await checkStoryStringForTextCompletion();
    }
}

export async function setPromptManagerEntries({ aspectPromptId, nativePromptId, ensurePrompt, ensureOrderEntry, useEvolutia, label }) {
    const manager = getPromptManagerInstance();

    if (!manager) {
        return;
    }

    try {
        ensurePrompt(manager);

        const order = getPromptOrder(manager);

        if (!order.length) {
            return;
        }

        const aspectEntry = ensureOrderEntry(manager);
        const nativeEntry = getPromptOrderEntryById(order, nativePromptId);

        if (!aspectEntry) {
            notify('warning', `Could not create ${label} Prompt Manager entry.`);
            return;
        }

        const before = JSON.stringify([aspectEntry.enabled, nativeEntry?.enabled]);
        aspectEntry.enabled = useEvolutia;

        if (nativeEntry) {
            nativeEntry.enabled = !useEvolutia;
        }

        disableLegacyAspectPromptIfPresent(manager);

        if (before !== JSON.stringify([aspectEntry.enabled, nativeEntry?.enabled])) {
            await saveAndRenderPromptManager(manager);
        }

        updateSettingsActionState();

        if (useEvolutia) {
            warnAboutPresetDescriptionMacros(manager);
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to synchronize ${label} Prompt Manager entry:`, error);
        notify('error', `Failed to synchronize ${label} with Prompt Manager.`);
    }
}

export function getCurrentChatUsesCharacterDynamicFields() {
    return getCurrentChatCharacterIds().some((characterId) => readCardState(characterId).swapEnabled);
}

export async function syncPromptManagerWithActiveState() {
    if (getCurrentChatUsesCharacterDynamicFields()) {
        await syncPromptManagerForState({ swapEnabled: true });
    }
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Persona Prompt Toggling
// -----------------------------------------------------------------------------

export async function syncPromptManagerForPersonaState(state, { restoreNative = false } = {}) {
    const personaId = getActivePersonaId();

    if (!restoreNative && !state?.swapEnabled) {
        return;
    }

    if (!restoreNative && personaId && !isPersonaDescriptionInPromptManagerPosition(personaId)) {
        notify(
            'warning',
            'Persona Dynamic Fields currently support only the Persona Description Prompt Manager / story-string position. Switch the Persona Description position to Prompt Manager for injection.',
        );
    }

    await setPromptManagerEntries({
        aspectPromptId: PERSONA_ASPECT_PROMPT_ID,
        nativePromptId: NATIVE_PERSONA_PROMPT_ID,
        ensurePrompt: ensurePersonaAspectPromptExists,
        ensureOrderEntry: ensurePersonaAspectPromptOrderEntry,
        useEvolutia: !restoreNative,
        label: 'Persona Description (Evolutia)',
    });
}

export async function syncPromptManagerWithActivePersonaState() {
    const personaId = getActivePersonaId();

    if (!personaId) {
        return;
    }

    const state = readPersonaState(personaId);
    await syncPromptManagerForPersonaState(state);
}

// -----------------------------------------------------------------------------
// Prompt Manager Integration - Combined Sync Helpers
// -----------------------------------------------------------------------------

export async function syncPromptManagerWithActiveStates() {
    await syncPromptManagerWithActiveState();
    await syncPromptManagerWithActivePersonaState();
    await checkStoryStringForTextCompletion();
}
