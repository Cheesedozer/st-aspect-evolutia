// Aspect: Evolutia — token-estimate.js (split from the former single index.js).
import {
    FIELD_EDIT_TOKEN_ESTIMATE_DEBOUNCE_MS,
    MODULE_NAME,
    UI,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getContext,
    normalizePersonaId,
} from './context.js';
import {
    currentGenerationId,
    generationSerial,
} from './generation.js';
import {
    readPersonaState,
    readState,
} from './persistence.js';
import {
    preparePersonaReplacementPromptForGeneration,
    prepareReplacementPromptForGeneration,
} from './prompt-assembly.js';

// Module state (written only by this module).
export let tokenEstimateTimer = null;
export let personaTokenEstimateTimer = null;
export let tokenUpdateSerial = 0;
export let personaTokenUpdateSerial = 0;


// ============================================================================
// Section 11. Dynamic Token Estimate
// ============================================================================
// Purpose:
// - Own the local Dynamic Fields token badges shown when Dynamic Fields are active.
// ============================================================================

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Shared Preview Helpers
// -----------------------------------------------------------------------------

export function getPreviewGenerationId() {
    return currentGenerationId || generationSerial + 1;
}

export function getCurrentChatForTokenPreview() {
    const ctx = getContext();
    return Array.isArray(ctx?.chat) ? ctx.chat : [];
}

export async function getTokenCountForPrompt(prompt) {
    const ctx = getContext();

    if (!prompt) {
        return 0;
    }

    if (typeof ctx?.getTokenCountAsync !== 'function') {
        return null;
    }

    return ctx.getTokenCountAsync(prompt, 0);
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Character Preview Prompt
// -----------------------------------------------------------------------------

export function buildDynamicTokenPreviewPrompt(characterId = getActiveCharacterId()) {
    if (characterId === undefined || characterId === null || characterId === '') {
        return '';
    }

    const state = readState(characterId);

    if (!state.swapEnabled) {
        return '';
    }

    return prepareReplacementPromptForGeneration(
        characterId,
        getPreviewGenerationId(),
        getCurrentChatForTokenPreview(),
        {
            mutate: false,
        },
    );
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Persona Preview Prompt
// -----------------------------------------------------------------------------

export function buildPersonaDynamicTokenPreviewPrompt(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return '';
    }

    const state = readPersonaState(normalizedPersonaId);

    if (!state.swapEnabled) {
        return '';
    }

    return preparePersonaReplacementPromptForGeneration(
        normalizedPersonaId,
        getPreviewGenerationId(),
        getCurrentChatForTokenPreview(),
        {
            mutate: false,
        },
    );
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Character Calculation
// -----------------------------------------------------------------------------

export async function getDynamicTokenCount(characterId = getActiveCharacterId()) {
    const prompt = buildDynamicTokenPreviewPrompt(characterId);
    return getTokenCountForPrompt(prompt);
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Persona Calculation
// -----------------------------------------------------------------------------

export async function getPersonaDynamicTokenCount(personaId = getActivePersonaId()) {
    const prompt = buildPersonaDynamicTokenPreviewPrompt(personaId);
    return getTokenCountForPrompt(prompt);
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Character Rendering
// -----------------------------------------------------------------------------


export function scheduleTokenEstimateUpdate() {
    clearTimeout(tokenEstimateTimer);

    tokenUpdateSerial += 1;

    tokenEstimateTimer = setTimeout(() => {
        tokenEstimateTimer = null;
        updateTokenEstimate();
    }, FIELD_EDIT_TOKEN_ESTIMATE_DEBOUNCE_MS);
}

export function schedulePersonaTokenEstimateUpdate() {
    clearTimeout(personaTokenEstimateTimer);

    personaTokenUpdateSerial += 1;

    personaTokenEstimateTimer = setTimeout(() => {
        personaTokenEstimateTimer = null;
        updatePersonaTokenEstimate();
    }, FIELD_EDIT_TOKEN_ESTIMATE_DEBOUNCE_MS);
}

export async function updateTokenEstimate() {
    const characterId = getActiveCharacterId();
    const $token = $(`#${UI.TOKEN_ID}`);

    if (!$token.length) {
        return;
    }

    if (characterId === undefined || characterId === null || characterId === '') {
        $token.text('');
        return;
    }

    const state = readState(characterId);

    if (!state.swapEnabled) {
        $token.text('');
        return;
    }

    const serial = ++tokenUpdateSerial;
    $token.text('Tokens: …');

    try {
        const count = await getDynamicTokenCount(characterId);

        if (serial !== tokenUpdateSerial) {
            return;
        }

        if (count === null) {
            $token.text('Tokens: unavailable');
            return;
        }

        $token.text(`Tokens: ${count}`);
    } catch (error) {
        if (serial !== tokenUpdateSerial) {
            return;
        }

        console.warn(`[${MODULE_NAME}] Failed to estimate Character Dynamic Fields tokens:`, error);
        $token.text('Tokens: unavailable');
    }
}

// -----------------------------------------------------------------------------
// Dynamic Token Estimate - Persona Rendering
// -----------------------------------------------------------------------------

export async function updatePersonaTokenEstimate() {
    const personaId = getActivePersonaId();
    const $token = $(`#${UI.PERSONA_TOKEN_ID}`);

    if (!$token.length) {
        return;
    }

    if (!personaId) {
        $token.text('');
        return;
    }

    const state = readPersonaState(personaId);

    if (!state.swapEnabled) {
        $token.text('');
        return;
    }

    const serial = ++personaTokenUpdateSerial;
    $token.text('Tokens: …');

    try {
        const count = await getPersonaDynamicTokenCount(personaId);

        if (serial !== personaTokenUpdateSerial) {
            return;
        }

        if (count === null) {
            $token.text('Tokens: unavailable');
            return;
        }

        $token.text(`Tokens: ${count}`);
    } catch (error) {
        if (serial !== personaTokenUpdateSerial) {
            return;
        }

        console.warn(`[${MODULE_NAME}] Failed to estimate Persona Dynamic Fields tokens:`, error);
        $token.text('Tokens: unavailable');
    }
}
