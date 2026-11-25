// Aspect: Evolutia — prompt-assembly.js (split from the former single index.js).
import {
    getCharacterRuntimeKey,
    getLiveChat,
    getPersonaRuntimeKey,
    resolveRuntime,
    serializeRuntime,
} from './chat-runtime.js';
import {
    KEYWORD_MATCHING,
    KEYWORD_MODE,
    MODULE_NAME,
    TARGET_SCOPE,
    preparedPromptCache,
} from './constants.js';
import {
    findCharacterIdForMemberReference,
    getCacheKey,
    getCharacter,
    getCharacterName,
    getContext,
    getCurrentGroup,
    getMacroCharacterId,
    getMacroPersonaId,
    getNativeCharacterName,
    getNativeDescriptionForCharacter,
    getNativePersonaDescriptionForPersona,
    getNativePersonaName,
    getPersonaCacheKey,
    getPersonaName,
    normalizePersonaId,
} from './context.js';
import {
    activeGenerationContext,
    finalizeActiveGenerationOnce,
} from './generation.js';
import {
    normalizeAlterEgo,
    normalizeCharacterField,
    normalizeCharacterState,
    normalizeField,
    normalizePersonaAlterEgo,
    normalizePersonaField,
    normalizePersonaState,
} from './model.js';
import {
    readCardState,
    readPersonaCardState,
    readPersonaState,
    readState,
} from './persistence.js';
import {
    buildScanText,
} from './trigger-sources.js';

// ============================================================================
// Section 8. Dynamic Field Matching and Prompt Assembly
// ============================================================================
// Purpose:
// - Own keyword matching, trigger-action handling, prepared prompt text, and macro reads.
// ============================================================================

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Trigger Matching
// -----------------------------------------------------------------------------

export const REGEX_KEYWORD_PATTERN = /^\/(.+)\/([a-z]*)$/s;
export const keywordRegexCache = new Map();

// Splits on newlines, then on commas/semicolons, except lines that are a
// /regex/ (those may contain commas).
export function splitKeywords(rawKeywords) {
    return String(rawKeywords || '')
        .split(/\r?\n/g)
        .flatMap((line) => {
            const trimmed = line.trim();
            return REGEX_KEYWORD_PATTERN.test(trimmed) ? [trimmed] : trimmed.split(/[,;]/g);
        })
        .map((keyword) => keyword.trim())
        .filter(Boolean);
}

export function getKeywordRegex(keyword, matching) {
    const cacheKey = `${matching}\u0000${keyword}`;

    if (keywordRegexCache.has(cacheKey)) {
        return keywordRegexCache.get(cacheKey);
    }

    let regex = null;
    const regexMatch = keyword.match(REGEX_KEYWORD_PATTERN);

    try {
        if (regexMatch) {
            regex = new RegExp(regexMatch[1], regexMatch[2].replace(/[gy]/g, ''));
        } else if (matching === KEYWORD_MATCHING.WORDS) {
            const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u');
        }
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Invalid keyword regex ${keyword}:`, error);
        regex = /$^/;
    }

    keywordRegexCache.set(cacheKey, regex);
    return regex;
}

export function keywordMatches(keyword, scanText, matching = KEYWORD_MATCHING.SUBSTRING) {
    const text = String(scanText || '');
    const isRegex = REGEX_KEYWORD_PATTERN.test(keyword);
    const regex = getKeywordRegex(keyword, matching);

    if (isRegex) {
        return regex.test(text);
    }

    const lowered = text.toLowerCase();

    if (regex) {
        return regex.test(lowered);
    }

    return lowered.includes(keyword.toLowerCase());
}

export function triggerListMatches(rawTriggers, scanText, keywordMode = KEYWORD_MODE.ALL, matching = KEYWORD_MATCHING.SUBSTRING) {
    const triggers = splitKeywords(rawTriggers);

    if (!triggers.length) {
        return false;
    }

    if (keywordMode === KEYWORD_MODE.ALL) {
        return triggers.every((trigger) => keywordMatches(trigger, scanText, matching));
    }

    return triggers.some((trigger) => keywordMatches(trigger, scanText, matching));
}

// Returns the keyword(s) that matched, or '' when the list did not match.
export function findMatchingTrigger(rawTriggers, scanText, keywordMode = KEYWORD_MODE.ALL, matching = KEYWORD_MATCHING.SUBSTRING) {
    const triggers = splitKeywords(rawTriggers);

    if (!triggers.length || !triggerListMatches(rawTriggers, scanText, keywordMode, matching)) {
        return '';
    }

    if (keywordMode === KEYWORD_MODE.ALL) {
        return triggers.join(', ');
    }

    return triggers.find((trigger) => keywordMatches(trigger, scanText, matching)) || triggers[0];
}

export function alterEgoSwapTriggersMatch(alterEgo, chatOverride = undefined) {
    const normalized = normalizeAlterEgo(alterEgo);

    if (!splitKeywords(normalized.changeConditions).length) {
        return false;
    }

    const scanText = buildScanText(normalized.triggerSources, chatOverride);

    return triggerListMatches(
        normalized.changeConditions,
        scanText,
        normalized.changeKeywordMode,
        normalized.keywordMatching,
    );
}

export function findTriggeredAlterEgo(state, chatOverride = undefined) {
    const normalized = normalizeCharacterState(state);

    return normalized.alterEgos.find((alterEgo) => alterEgoSwapTriggersMatch(alterEgo, chatOverride)) ?? null;
}

export function personaAlterEgoSwapTriggersMatch(alterEgo, chatOverride = undefined) {
    const normalized = normalizePersonaAlterEgo(alterEgo);

    if (!splitKeywords(normalized.changeConditions).length) {
        return false;
    }

    const scanText = buildScanText(normalized.triggerSources, chatOverride);

    return triggerListMatches(
        normalized.changeConditions,
        scanText,
        normalized.changeKeywordMode,
        normalized.keywordMatching,
    );
}

export function findTriggeredPersonaAlterEgo(state, chatOverride = undefined) {
    const normalized = normalizePersonaState(state);

    return normalized.alterEgos.find((alterEgo) => personaAlterEgoSwapTriggersMatch(alterEgo, chatOverride)) ?? null;
}

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Prepared Prompt Cache
// -----------------------------------------------------------------------------

export function getPreparedPromptCacheKey(targetScope = TARGET_SCOPE.CHARACTER, entityId = undefined) {
    const scope = targetScope === TARGET_SCOPE.PERSONA ? TARGET_SCOPE.PERSONA : TARGET_SCOPE.CHARACTER;

    if (scope === TARGET_SCOPE.PERSONA) {
        return `${scope}:${getPersonaCacheKey(entityId)}`;
    }

    return `${scope}:${getCacheKey(entityId)}`;
}

export function setPreparedPromptForTarget(targetScope, entityId, generationId, prompt) {
    preparedPromptCache.set(getPreparedPromptCacheKey(targetScope, entityId), {
        targetScope,
        entityId,
        generationId,
        prompt: String(prompt || ''),
    });
}

export function getPreparedPromptForTarget(targetScope, entityId) {
    const prepared = preparedPromptCache.get(getPreparedPromptCacheKey(targetScope, entityId));
    return String(prepared?.prompt || '');
}

export function clearPreparedPromptForTarget(targetScope, entityId) {
    preparedPromptCache.delete(getPreparedPromptCacheKey(targetScope, entityId));
}

export function setPreparedPrompt(characterId, generationId, prompt) {
    setPreparedPromptForTarget(TARGET_SCOPE.CHARACTER, characterId, generationId, prompt);
}

export function getPreparedPrompt(characterId = getMacroCharacterId()) {
    return getPreparedPromptForTarget(TARGET_SCOPE.CHARACTER, characterId);
}

export function clearPreparedPrompt(characterId = getMacroCharacterId()) {
    clearPreparedPromptForTarget(TARGET_SCOPE.CHARACTER, characterId);
}

export function setPreparedPersonaPrompt(personaId, generationId, prompt) {
    setPreparedPromptForTarget(TARGET_SCOPE.PERSONA, personaId, generationId, prompt);
}

export function getPreparedPersonaPrompt(personaId = getMacroPersonaId()) {
    return getPreparedPromptForTarget(TARGET_SCOPE.PERSONA, personaId);
}

export function clearPreparedPersonaPrompt(personaId = getMacroPersonaId()) {
    clearPreparedPromptForTarget(TARGET_SCOPE.PERSONA, personaId);
}

export function clearAllPreparedPrompts() {
    preparedPromptCache.clear();
}

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Field Evaluation
// -----------------------------------------------------------------------------

// Identifies one trigger occurrence (the scanned text that fired), so a Trigger
// Action is performed once per occurrence and not again on the next reply.
export function getTriggerOccurrenceKey(scanText) {
    let hash = 5381;
    const text = String(scanText || '');

    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }

    return `${text.length}:${(hash >>> 0).toString(36)}`;
}

// Decides which entries to inject for one generation and updates `runtime`
// (the chat state) in place. `runtime.fields[id]` = { enabled, actionKey, reason }.
//
// Rules:
// - Disabling Trigger matched: Inject off.
// - Enabling Trigger matched while off: Inject on. With a Trigger Action, this
//   reply gets the action; Content follows from the next reply on.
// - Activating Triggers (if any) gate Content to turns where they match. With a
//   Trigger Action, the action is performed once per trigger occurrence.
export function buildFieldPromptEntriesForGeneration(fields, runtime, {
    targetScope = TARGET_SCOPE.CHARACTER,
    chat,
    includeTriggerActions = true,
    messageIndex = null,
} = {}) {
    const entries = [];
    const actions = [];
    let changed = false;
    const isPersona = targetScope === TARGET_SCOPE.PERSONA;
    const normalizeForTarget = isPersona ? normalizePersonaField : normalizeCharacterField;

    runtime.fields ??= {};

    for (const field of fields || []) {
        const normalized = normalizeForTarget(field);
        const scanText = buildScanText(normalized.triggerSources, chat, normalized.scanDepth);
        const content = normalized.content.trim();
        const configuredTriggerAction = isPersona ? '' : normalized.triggerActionInstruction.trim();
        const triggerActionInstruction = includeTriggerActions ? configuredTriggerAction : '';
        // Read-only runs (quiet / impersonate) must not show content whose Trigger
        // Action has not happened yet in the story.
        const actionSuppressed = Boolean(configuredTriggerAction) && !includeTriggerActions;
        const state = (runtime.fields[normalized.id] ??= { enabled: normalized.enabled, actionKey: '', reason: '', source: 'default' });
        const setState = (updates) => {
            Object.assign(state, updates, { source: 'chat', reasonMessage: messageIndex });
            changed = true;
        };

        const disablingMatch = findMatchingTrigger(normalized.disablingTriggers, scanText, normalized.disablingKeywordMode, normalized.keywordMatching);

        if (disablingMatch) {
            if (state.enabled || state.actionKey) {
                setState({ enabled: false, actionKey: '', reason: `Disabled by "${disablingMatch}"` });
            }

            continue;
        }

        const enablingMatch = !state.enabled
            ? findMatchingTrigger(normalized.enablingTriggers, scanText, normalized.enablingKeywordMode, normalized.keywordMatching)
            : '';
        const activatingMatch = findMatchingTrigger(normalized.activatingTriggers, scanText, normalized.activatingKeywordMode, normalized.keywordMatching);
        const hasActivatingTriggers = splitKeywords(normalized.activatingTriggers).length > 0;
        // "Stay active for N replies": after an Activating match, Content keeps
        // injecting for N more replies even if the keyword is not repeated.
        const stickyRemaining = Number(state.stickyRemaining) || 0;
        const stickyActive = hasActivatingTriggers && !activatingMatch && stickyRemaining > 0;
        const activationSatisfied = !hasActivatingTriggers || Boolean(activatingMatch) || stickyActive;

        if (activatingMatch && normalized.stickyTurns > 0 && stickyRemaining !== normalized.stickyTurns) {
            state.stickyRemaining = normalized.stickyTurns;
            changed = true;
        } else if (stickyActive && state.enabled) {
            state.stickyRemaining = stickyRemaining - 1;
            changed = true;
        }
        const occurrenceKey = getTriggerOccurrenceKey(scanText);

        if (enablingMatch) {
            if (actionSuppressed) {
                continue;
            }

            setState({ enabled: true, actionKey: '', reason: `Enabled by "${enablingMatch}"` });

            if (triggerActionInstruction) {
                actions.push(triggerActionInstruction);
                state.actionKey = occurrenceKey;
                continue;
            }

            if (content && activationSatisfied) {
                entries.push(formatFieldForPrompt(normalized));
            }

            continue;
        }

        if (!state.enabled) {
            continue;
        }

        if (configuredTriggerAction && activatingMatch && state.actionKey !== occurrenceKey) {
            if (actionSuppressed) {
                continue;
            }

            actions.push(triggerActionInstruction);
            setState({ actionKey: occurrenceKey, reason: `Trigger Action by "${activatingMatch}"` });
            continue;
        }

        if (content && activationSatisfied) {
            entries.push(formatFieldForPrompt(normalized));
        }
    }

    return {
        entries,
        actions,
        changed,
    };
}

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Prompt Formatting
// -----------------------------------------------------------------------------

export function formatFieldForPrompt(field) {
    const normalized = normalizeField(field);
    const name = normalized.name.trim() || 'Unnamed Dynamic Field';
    const content = normalized.content.trim();

    return [
        `[DEFINITION: ${name}]`,
        content,
        `[END DEFINITION: ${name}]`,
    ].join('\n');
}

// Trigger Actions are injected as a short system note right before the reply
// (depth 0), not inside the description at the top of the prompt, where models
// tend to ignore instructions. {{char}} / {{user}} are filled in here.
export const TRIGGER_ACTION_PROMPT_KEY = 'aspectEvolutiaTriggerActions';

export function fillNameMacros(text, characterName) {
    return String(text || '')
        .replace(/\{\{char\}\}/gi, characterName)
        .replace(/\{\{user\}\}/gi, String(getContext()?.name1 || 'the user'));
}

export function formatTriggerActionsForPrompt(actions, characterName) {
    if (!actions?.length) {
        return '';
    }

    const lines = actions.map((action) => `- ${fillNameMacros(action, characterName).trim()}`);

    return [
        `[Story event for ${characterName} in the next reply:`,
        ...lines,
        `Write this happening now, as ${characterName}'s own action, before continuing the scene.]`,
    ].join('\n');
}

export function setTriggerActionPrompt(text) {
    const ctx = getContext();

    if (typeof ctx?.setExtensionPrompt !== 'function') {
        return;
    }

    // position 1 = IN_CHAT, depth 0 = after the last message, role 0 = system
    ctx.setExtensionPrompt(TRIGGER_ACTION_PROMPT_KEY, String(text || ''), 1, 0, false, 0);
}

export function wrapDynamicFieldsPrompt(characterId, fieldText, nameOverride = '') {
    const characterName = nameOverride || getCharacterName(characterId);

    return [
        `[CHARACTER DEFINITIONS]`,
        `These definitions apply only to ${characterName}.`,
        '',
        fieldText,
        '',
        `[END CHARACTER DEFINITIONS]`,
    ].join('\n');
}

export function wrapPersonaDynamicFieldsPrompt(personaId, fieldText, nameOverride = '') {
    const personaName = nameOverride || getPersonaName(personaId);

    return [
        `[USER PERSONA DEFINITIONS]`,
        `These definitions apply only to ${personaName}.`,
        '',
        fieldText,
        '',
        `[END USER PERSONA DEFINITIONS]`,
    ].join('\n');
}

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Character Prompt Preparation
// -----------------------------------------------------------------------------

// Computes what one generation should inject for a character, starting from the
// chat state before `endExclusive` (the message being written or swiped).
// Returns { prompt, runtime } — `runtime` is the state to stamp on the reply.
export function computeCharacterGeneration(characterId, chat, { includeTriggerActions = true, endExclusive = undefined } = {}) {
    const cardState = readCardState(characterId);

    if (!cardState.swapEnabled) {
        return { prompt: '', runtime: null, alterEgo: null };
    }

    const key = getCharacterRuntimeKey(characterId);
    const runtime = resolveRuntime(TARGET_SCOPE.CHARACTER, key, cardState, { endExclusive });
    const triggered = findTriggeredAlterEgo(cardState, chat);

    if (triggered && triggered.id !== runtime.alterEgoId) {
        runtime.alterEgoId = triggered.id;
        runtime.alterEgoReason = `Swapped by "${splitKeywords(triggered.changeConditions).join(', ')}"`;
    }

    const alterEgo = cardState.alterEgos.find((entry) => entry.id === runtime.alterEgoId) ?? cardState.alterEgos[0];
    const { entries, actions } = buildFieldPromptEntriesForGeneration(alterEgo?.fields || [], runtime, {
        targetScope: TARGET_SCOPE.CHARACTER,
        chat,
        includeTriggerActions,
        messageIndex: endExclusive ?? getLiveChat().length,
    });

    const name = String(alterEgo?.name || '').trim() || getNativeCharacterName(characterId);
    const prompt = entries.length ? wrapDynamicFieldsPrompt(characterId, entries.join('\n\n'), name) : '';

    return { prompt, actionPrompt: formatTriggerActionsForPrompt(actions, name), runtime: serializeRuntime(runtime), alterEgo };
}

export function prepareReplacementPromptForGeneration(characterId, generationId, chat, options = {}) {
    return computeCharacterGeneration(characterId, chat, options).prompt;
}

// Group chats in "Join character cards" mode: SillyTavern's native marker
// would contain every member's description. Mirror that, using each member's
// Dynamic Fields (or native description) and the group's join prefix/suffix.
export function getJoinModeGroup() {
    const group = getCurrentGroup();
    const mode = Number(group?.generation_mode ?? 0);
    return group && mode > 0 && Array.isArray(group.members) && group.members.length ? group : null;
}

export function applyGroupJoinTemplate(template, characterName) {
    const ctx = getContext();
    return String(template || '')
        .replace(/<FIELDNAME>/gi, 'Description')
        .replace(/\{\{char\}\}/gi, characterName)
        .replace(/\{\{user\}\}/gi, String(ctx?.name1 || ''));
}

export function getMemberDescriptionForJoin(characterId, generatingCharacterId) {
    const character = getCharacter(characterId);
    const cardState = readCardState(characterId);

    if (!cardState.swapEnabled) {
        return getNativeDescriptionForCharacter(character);
    }

    if (String(characterId) === String(generatingCharacterId)) {
        return getPreparedPrompt(characterId);
    }

    const context = activeGenerationContext;
    return computeCharacterGeneration(characterId, context?.scanChat ?? getLiveChat(), {
        includeTriggerActions: false,
        endExclusive: context?.targetIndex,
    }).prompt;
}

export function buildGroupJoinedDescription(group, generatingCharacterId) {
    const disabled = Array.isArray(group.disabled_members) ? group.disabled_members : [];
    const includeDisabled = Number(group.generation_mode) === 2;
    const values = [];

    for (const member of group.members) {
        const characterId = findCharacterIdForMemberReference(member);

        if (characterId === undefined) {
            continue;
        }

        if (disabled.includes(member) && String(characterId) !== String(generatingCharacterId) && !includeDisabled) {
            continue;
        }

        const value = String(getMemberDescriptionForJoin(characterId, generatingCharacterId) || '').trim();

        if (!value) {
            continue;
        }

        const name = getNativeCharacterName(characterId);
        values.push(`${applyGroupJoinTemplate(group.generation_mode_join_prefix, name)}${value}${applyGroupJoinTemplate(group.generation_mode_join_suffix, name)}`);
    }

    return values.join('\n');
}

export function buildAspectEvolutiaCharacterMacroValue() {
    finalizeActiveGenerationOnce();
    const characterId = getMacroCharacterId();
    const joinGroup = getJoinModeGroup();

    if (joinGroup) {
        return buildGroupJoinedDescription(joinGroup, characterId);
    }

    const character = getCharacter(characterId);

    if (!character) {
        return '';
    }

    const state = readState(characterId);

    if (!state.swapEnabled) {
        return getNativeDescriptionForCharacter(character);
    }

    return getPreparedPrompt(characterId);
}

// -----------------------------------------------------------------------------
// Dynamic Field Matching and Prompt Assembly - Persona Prompt Preparation
// -----------------------------------------------------------------------------

export function computePersonaGeneration(personaId, chat, { endExclusive = undefined } = {}) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return { prompt: '', runtime: null, alterEgo: null };
    }

    const cardState = readPersonaCardState(normalizedPersonaId);

    if (!cardState.swapEnabled) {
        return { prompt: '', runtime: null, alterEgo: null };
    }

    const key = getPersonaRuntimeKey(normalizedPersonaId);
    const runtime = resolveRuntime(TARGET_SCOPE.PERSONA, key, cardState, { endExclusive });
    const triggered = findTriggeredPersonaAlterEgo(cardState, chat);

    if (triggered && triggered.id !== runtime.alterEgoId) {
        runtime.alterEgoId = triggered.id;
        runtime.alterEgoReason = `Swapped by "${splitKeywords(triggered.changeConditions).join(', ')}"`;
    }

    const alterEgo = cardState.alterEgos.find((entry) => entry.id === runtime.alterEgoId) ?? cardState.alterEgos[0];
    const { entries } = buildFieldPromptEntriesForGeneration(alterEgo?.fields || [], runtime, {
        targetScope: TARGET_SCOPE.PERSONA,
        chat,
        includeTriggerActions: false,
        messageIndex: endExclusive ?? getLiveChat().length,
    });

    const name = String(alterEgo?.name || '').trim() || getNativePersonaName(normalizedPersonaId);
    const prompt = entries.length ? wrapPersonaDynamicFieldsPrompt(normalizedPersonaId, entries.join('\n\n'), name) : '';

    return { prompt, runtime: serializeRuntime(runtime), alterEgo };
}

export function preparePersonaReplacementPromptForGeneration(personaId, generationId, chat, options = {}) {
    return computePersonaGeneration(personaId, chat, options).prompt;
}

export function buildAspectEvolutiaPersonaMacroValue() {
    finalizeActiveGenerationOnce();
    const personaId = getMacroPersonaId();

    if (!personaId) {
        return '';
    }

    const state = readPersonaState(personaId);

    if (!state.swapEnabled) {
        return getNativePersonaDescriptionForPersona(personaId);
    }

    return getPreparedPersonaPrompt(personaId);
}
