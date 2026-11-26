// Aspect: Evolutia — model.js (split from the former single index.js).
import {
    CARD_SCHEMA_VERSION,
} from './chat-runtime.js';
import {
    ALTER_EGO_AVATAR_MODE,
    ALTER_EGO_BASE_ID,
    ALTER_EGO_DEFAULT_NAME,
    ALTER_EGO_SWAP_MODE,
    DEFAULT_STATE,
    DEFAULT_TRIGGER_SOURCES,
    KEYWORD_MATCHING,
    KEYWORD_MODE,
    LEGACY_TRIGGER_SOURCE_ALIASES,
    TARGET_SCOPE,
    TRIGGER_SOURCE,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getNativeCharacterAvatarKey,
    getNativeCharacterName,
    getNativePersonaAvatarKey,
    getNativePersonaName,
    normalizeLocalImagePath,
    normalizePersonaId,
} from './context.js';
import {
    readPersonaState,
    readState,
} from './persistence.js';
import {
    splitKeywords,
} from './prompt-assembly.js';
import {
    clone,
    hasOwn,
    joinLinesFromJson,
    makeId,
    splitLinesForJson,
} from './utils.js';

// Section 5. Field, Alter Ego, and State Model
// ============================================================================
// Purpose:
// - Own normalization of saved extension data into predictable runtime objects.
// - Keep legacy flat state.fields compatibility.
// - Introduce first-class Character Alter Egos as named field containers.
// - Never mutate SillyTavern's canonical character avatar/name as alter-ego data.
// ============================================================================

// -----------------------------------------------------------------------------
// Field, Alter Ego, and State Model - Field Normalization
// -----------------------------------------------------------------------------

export function createDefaultFields() {
    return [
        normalizeField({
            name: 'Background',
            activatingTriggers: '',
            enablingTriggers: '',
            disablingTriggers: '',
            triggerSources: [...DEFAULT_TRIGGER_SOURCES],
            activatingKeywordMode: KEYWORD_MODE.ALL,
            enablingKeywordMode: KEYWORD_MODE.ALL,
            disablingKeywordMode: KEYWORD_MODE.ALL,
            keywordMatching: KEYWORD_MATCHING.WORDS,
            triggerActionInstruction: '',
            content: '',
            enabled: true,
        }),
        normalizeField({
            name: 'Personality',
            activatingTriggers: '',
            enablingTriggers: '',
            disablingTriggers: '',
            triggerSources: [...DEFAULT_TRIGGER_SOURCES],
            activatingKeywordMode: KEYWORD_MODE.ALL,
            enablingKeywordMode: KEYWORD_MODE.ALL,
            disablingKeywordMode: KEYWORD_MODE.ALL,
            keywordMatching: KEYWORD_MATCHING.WORDS,
            triggerActionInstruction: '',
            content: '',
            enabled: true,
        }),
        normalizeField({
            name: 'Appearance',
            activatingTriggers: '',
            enablingTriggers: '',
            disablingTriggers: '',
            triggerSources: [...DEFAULT_TRIGGER_SOURCES],
            activatingKeywordMode: KEYWORD_MODE.ALL,
            enablingKeywordMode: KEYWORD_MODE.ALL,
            disablingKeywordMode: KEYWORD_MODE.ALL,
            keywordMatching: KEYWORD_MATCHING.WORDS,
            triggerActionInstruction: '',
            content: '',
            enabled: true,
        }),
    ];
}

export function createOutOfBoxState(characterId = getActiveCharacterId()) {
    const fields = createDefaultFields();

    return normalizeState({
        swapEnabled: false,
        initializedDefaults: true,
        activeAlterEgoId: ALTER_EGO_BASE_ID,
        alterEgos: [createBaseAlterEgo({ characterId, fields })],
        fields,
    }, { characterId });
}

export function createOutOfBoxPersonaState(personaId = getActivePersonaId()) {
    const fields = createDefaultFields().map(normalizePersonaField);

    return normalizePersonaState({
        swapEnabled: false,
        initializedDefaults: true,
        activeAlterEgoId: ALTER_EGO_BASE_ID,
        alterEgos: [createBasePersonaAlterEgo({ personaId, fields })],
        fields,
    }, { personaId });
}

export function createEmptyFieldsState(characterId = getActiveCharacterId()) {
    const state = readState(characterId);

    state.initializedDefaults = true;
    setActiveAlterEgoFields(state, []);

    return normalizeState(state, { characterId });
}

export function createEmptyPersonaFieldsState(personaId = getActivePersonaId()) {
    const state = readPersonaState(personaId);

    state.initializedDefaults = true;
    setActivePersonaAlterEgoFields(state, []);

    return normalizePersonaState(state, { personaId });
}

// Integer setting clamped to [min, max]; `fallback` when missing or invalid.
export function normalizeCount(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export function normalizeKeywordMatching(rawMatching) {
    return rawMatching === KEYWORD_MATCHING.WORDS ? KEYWORD_MATCHING.WORDS : KEYWORD_MATCHING.SUBSTRING;
}

export function normalizeKeywordMode(rawMode) {
    return rawMode === KEYWORD_MODE.ANY ? KEYWORD_MODE.ANY : KEYWORD_MODE.ALL;
}

export function normalizeTriggerSources(rawSources) {
    const validSources = new Set(Object.values(TRIGGER_SOURCE));
    const sourceArray = Array.isArray(rawSources)
        ? rawSources
        : typeof rawSources === 'string'
            ? rawSources.split(/[,;]/g)
            : [];

    const normalized = sourceArray
        .map((source) => {
            const value = String(source ?? '').trim();
            return LEGACY_TRIGGER_SOURCE_ALIASES[value] || value;
        })
        .filter((source) => validSources.has(source));

    if (!normalized.length) {
        return [...DEFAULT_TRIGGER_SOURCES];
    }

    return [...new Set(normalized)];
}

export function shouldIncludeTriggerActions(options = {}) {
    if (options.includeTriggerActions !== undefined) {
        return Boolean(options.includeTriggerActions);
    }

    return options.targetScope !== TARGET_SCOPE.PERSONA;
}

export function normalizeField(field = {}, options = {}) {
    const activatingTriggers = field.activatingTriggers ?? field.keywords ?? '';
    const legacyKeywordMode = field.keywordMode;
    const includeTriggerActions = shouldIncludeTriggerActions(options);

    return {
        id: typeof field.id === 'string' && field.id.trim() ? field.id : makeId(),
        enabled: field.enabled !== false,
        name: String(field.name ?? ''),
        activatingTriggers: String(activatingTriggers ?? ''),
        enablingTriggers: String(field.enablingTriggers ?? ''),
        disablingTriggers: String(field.disablingTriggers ?? ''),
        triggerSources: normalizeTriggerSources(field.triggerSources),
        activatingKeywordMode: normalizeKeywordMode(field.activatingKeywordMode ?? legacyKeywordMode),
        enablingKeywordMode: normalizeKeywordMode(field.enablingKeywordMode ?? legacyKeywordMode),
        disablingKeywordMode: normalizeKeywordMode(field.disablingKeywordMode ?? legacyKeywordMode),
        keywordMatching: normalizeKeywordMatching(field.keywordMatching),
        scanDepth: normalizeCount(field.scanDepth, 1, 1, 20),
        stickyTurns: normalizeCount(field.stickyTurns, 0, 0, 50),
        // Core fields are never offered to model-assisted proposals. Unset =
        // decided by name (Background, Personality...), see isCoreField().
        ...(typeof field.core === 'boolean' ? { core: field.core } : {}),
        triggerActionInstruction: includeTriggerActions ? String(field.triggerActionInstruction ?? '') : '',
        content: String(field.content ?? ''),
    };
}

export function normalizeCharacterField(field = {}) {
    return normalizeField(field, {
        targetScope: TARGET_SCOPE.CHARACTER,
        includeTriggerActions: true,
    });
}

export function normalizePersonaField(field = {}) {
    return normalizeField(field, {
        targetScope: TARGET_SCOPE.PERSONA,
        includeTriggerActions: false,
    });
}

// -----------------------------------------------------------------------------
// Field, Alter Ego, and State Model - Alter Ego Normalization
// -----------------------------------------------------------------------------

export function normalizeAlterEgoAvatarMode(rawMode) {
    const mode = String(rawMode ?? '').trim();

    if (mode === 'character_avatar_key') {
        return ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY;
    }

    if (Object.values(ALTER_EGO_AVATAR_MODE).includes(mode)) {
        return mode;
    }

    return ALTER_EGO_AVATAR_MODE.INHERIT;
}

export function normalizeAlterEgoSwapMode(rawMode) {
    const mode = String(rawMode ?? '').trim();

    if (Object.values(ALTER_EGO_SWAP_MODE).includes(mode)) {
        return mode;
    }

    return ALTER_EGO_SWAP_MODE.MANUAL;
}

// Character and persona alter egos share one implementation; `targetScope`
// selects the field normalizer and the native name/avatar lookups.
function getAlterEgoModelScope(targetScope) {
    if (targetScope === TARGET_SCOPE.PERSONA) {
        return {
            normalizeField: normalizePersonaField,
            createDefaultFields: () => createDefaultFields().map(normalizePersonaField),
            nativeName: (entityId) => getNativePersonaName(normalizePersonaId(entityId)),
            nativeAvatarKey: (entityId) => getNativePersonaAvatarKey(normalizePersonaId(entityId)),
            activeEntityId: () => getActivePersonaId(),
        };
    }

    return {
        normalizeField: normalizeCharacterField,
        createDefaultFields: () => createDefaultFields(),
        nativeName: (entityId) => getNativeCharacterName(entityId),
        nativeAvatarKey: (entityId) => getNativeCharacterAvatarKey(entityId),
        activeEntityId: () => getActiveCharacterId(),
    };
}

export function normalizeAlterEgoForScope(targetScope, alterEgo = {}, { fallbackName = ALTER_EGO_DEFAULT_NAME, fallbackAvatarKey = '' } = {}) {
    const model = getAlterEgoModelScope(targetScope);
    const rawId = String(alterEgo.id ?? '').trim();
    const id = rawId || makeId();
    const name = String(alterEgo.name ?? alterEgo.displayName ?? fallbackName ?? ALTER_EGO_DEFAULT_NAME).trim() || ALTER_EGO_DEFAULT_NAME;
    const avatarMode = normalizeAlterEgoAvatarMode(alterEgo.avatarMode);
    const avatarKey = String(alterEgo.avatarKey ?? alterEgo.avatar ?? '').trim();
    const avatarUrl = String(alterEgo.avatarUrl ?? alterEgo.imageUrl ?? '').trim();
    const avatarDataUrl = String(alterEgo.avatarDataUrl ?? alterEgo.dataUrl ?? '').trim();
    const avatarFilePath = String(alterEgo.avatarFilePath ?? '').trim();
    const avatarFileName = String(alterEgo.avatarFileName ?? alterEgo.imageFileName ?? alterEgo.fileName ?? '').trim();
    const avatarLocalPath = normalizeLocalImagePath(alterEgo.avatarLocalPath ?? alterEgo.localFilePath ?? alterEgo.localPath ?? '');
    const fields = Array.isArray(alterEgo.fields)
        ? alterEgo.fields.map(model.normalizeField)
        : model.createDefaultFields();

    return {
        id,
        name,
        avatarMode,
        avatarKey: avatarMode === ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY ? avatarKey || fallbackAvatarKey : avatarKey,
        avatarUrl,
        avatarDataUrl,
        avatarFilePath,
        avatarFileName,
        avatarLocalPath,
        swapMode: normalizeAlterEgoSwapMode(alterEgo.swapMode),
        changeConditions: String(alterEgo.changeConditions ?? '').trim(),
        changeKeywordMode: normalizeKeywordMode(alterEgo.changeKeywordMode ?? alterEgo.keywordMode ?? KEYWORD_MODE.ANY),
        keywordMatching: normalizeKeywordMatching(alterEgo.keywordMatching),
        triggerSources: normalizeTriggerSources(alterEgo.triggerSources ?? alterEgo.changeTriggerSources),
        fields,
    };
}

export function createBaseAlterEgoForScope(targetScope, { entityId = undefined, fields = undefined } = {}) {
    const model = getAlterEgoModelScope(targetScope);
    const id = entityId ?? model.activeEntityId();

    return normalizeAlterEgoForScope(targetScope, {
        id: ALTER_EGO_BASE_ID,
        name: model.nativeName(id) || ALTER_EGO_DEFAULT_NAME,
        avatarMode: ALTER_EGO_AVATAR_MODE.INHERIT,
        avatarKey: '',
        avatarUrl: '',
        avatarDataUrl: '',
        avatarFileName: '',
        avatarLocalPath: '',
        swapMode: ALTER_EGO_SWAP_MODE.MANUAL,
        changeConditions: '',
        changeKeywordMode: KEYWORD_MODE.ANY,
        keywordMatching: KEYWORD_MATCHING.WORDS,
        triggerSources: [...DEFAULT_TRIGGER_SOURCES],
        fields: fields ?? model.createDefaultFields(),
    }, { fallbackName: model.nativeName(id), fallbackAvatarKey: model.nativeAvatarKey(id) });
}

export function createBlankAlterEgoForScope(targetScope, existingAlterEgos = [], { entityId = undefined, name = '', fromAlterEgo = null } = {}) {
    const model = getAlterEgoModelScope(targetScope);
    const id = entityId ?? model.activeEntityId();
    const baseName = String(name || 'New Alter Ego').trim() || 'New Alter Ego';
    const existingNames = new Set(existingAlterEgos.map((alterEgo) => String(alterEgo.name || '').trim().toLowerCase()));
    let uniqueName = baseName;
    let counter = 2;

    while (existingNames.has(uniqueName.toLowerCase())) {
        uniqueName = `${baseName} ${counter}`;
        counter += 1;
    }

    const fallback = { fallbackName: model.nativeName(id), fallbackAvatarKey: model.nativeAvatarKey(id) };
    const source = fromAlterEgo ? normalizeAlterEgoForScope(targetScope, fromAlterEgo, fallback) : null;

    return normalizeAlterEgoForScope(targetScope, {
        id: makeId(),
        name: uniqueName,
        avatarMode: source?.avatarMode ?? ALTER_EGO_AVATAR_MODE.INHERIT,
        avatarKey: source?.avatarKey ?? '',
        avatarUrl: source?.avatarUrl ?? '',
        avatarDataUrl: source?.avatarDataUrl ?? '',
        avatarFilePath: source?.avatarFilePath ?? '',
        avatarFileName: source?.avatarFileName ?? '',
        avatarLocalPath: source?.avatarLocalPath ?? '',
        swapMode: source?.swapMode ?? ALTER_EGO_SWAP_MODE.MANUAL,
        changeConditions: source?.changeConditions ?? '',
        changeKeywordMode: source?.changeKeywordMode ?? KEYWORD_MODE.ANY,
        keywordMatching: source?.keywordMatching ?? KEYWORD_MATCHING.WORDS,
        triggerSources: source?.triggerSources ?? [...DEFAULT_TRIGGER_SOURCES],
        fields: source
            ? source.fields.map((field) => model.normalizeField({ ...field, id: makeId() }))
            : model.createDefaultFields(),
    }, fallback);
}

export function normalizeAlterEgosForScope(targetScope, rawAlterEgos, { entityId = undefined, legacyFields = null } = {}) {
    const model = getAlterEgoModelScope(targetScope);
    const id = entityId ?? model.activeEntityId();
    const fallback = { fallbackName: model.nativeName(id), fallbackAvatarKey: model.nativeAvatarKey(id) };
    const sourceAlterEgos = Array.isArray(rawAlterEgos) ? rawAlterEgos : [];
    let alterEgos = sourceAlterEgos.map((alterEgo) => normalizeAlterEgoForScope(targetScope, alterEgo, fallback));

    if (!alterEgos.some((alterEgo) => alterEgo.id === ALTER_EGO_BASE_ID)) {
        alterEgos.unshift(createBaseAlterEgoForScope(targetScope, {
            entityId: id,
            fields: Array.isArray(legacyFields) ? legacyFields.map(model.normalizeField) : model.createDefaultFields(),
        }));
    }

    const seenIds = new Set();
    alterEgos = alterEgos.map((alterEgo) => {
        if (!seenIds.has(alterEgo.id)) {
            seenIds.add(alterEgo.id);
            return alterEgo;
        }

        const next = { ...alterEgo, id: makeId() };
        seenIds.add(next.id);
        return next;
    });

    return alterEgos;
}

export function setActiveAlterEgoFieldsForScope(targetScope, state, fields) {
    const model = getAlterEgoModelScope(targetScope);
    const normalizedFields = Array.isArray(fields) ? fields.map(model.normalizeField) : [];
    const activeId = String(state.activeAlterEgoId || ALTER_EGO_BASE_ID);
    const index = Array.isArray(state.alterEgos)
        ? state.alterEgos.findIndex((alterEgo) => alterEgo.id === activeId)
        : -1;

    if (index >= 0) {
        state.alterEgos[index].fields = normalizedFields;
    }

    state.fields = normalizedFields;
}

export function deleteAlterEgoByIdForScope(targetScope, state, alterEgoId) {
    const targetId = String(alterEgoId || '').trim();

    if (!targetId || targetId === ALTER_EGO_BASE_ID) {
        return;
    }

    state.alterEgos = state.alterEgos.filter((alterEgo) => alterEgo.id !== targetId);

    if (!state.alterEgos.length) {
        state.alterEgos.push(createBaseAlterEgoForScope(targetScope));
    }

    if (state.activeAlterEgoId === targetId) {
        state.activeAlterEgoId = state.alterEgos[0]?.id ?? ALTER_EGO_BASE_ID;
    }

    state.fields = getActiveAlterEgoFields(state);
}

export function createBaseAlterEgo({ characterId = getActiveCharacterId(), fields = undefined } = {}) {
    return createBaseAlterEgoForScope(TARGET_SCOPE.CHARACTER, { entityId: characterId, fields });
}


export function normalizeAlterEgo(alterEgo = {}, options = {}) {
    return normalizeAlterEgoForScope(TARGET_SCOPE.CHARACTER, alterEgo, options);
}

export function normalizeAlterEgos(rawAlterEgos, { characterId = getActiveCharacterId(), legacyFields = null } = {}) {
    return normalizeAlterEgosForScope(TARGET_SCOPE.CHARACTER, rawAlterEgos, { entityId: characterId, legacyFields });
}

export function getActiveAlterEgo(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }

    const alterEgos = Array.isArray(state.alterEgos) ? state.alterEgos : [];
    return alterEgos.find((alterEgo) => alterEgo.id === state.activeAlterEgoId) ?? alterEgos[0] ?? null;
}

export function getActiveAlterEgoForCharacter(characterId = getActiveCharacterId()) {
    if (characterId === undefined || characterId === null || characterId === '') {
        return null;
    }

    return getActiveAlterEgo(readState(characterId));
}

export function createBasePersonaAlterEgo({ personaId = getActivePersonaId(), fields = undefined } = {}) {
    return createBaseAlterEgoForScope(TARGET_SCOPE.PERSONA, { entityId: personaId, fields });
}


export function normalizePersonaAlterEgo(alterEgo = {}, options = {}) {
    return normalizeAlterEgoForScope(TARGET_SCOPE.PERSONA, alterEgo, options);
}

export function normalizePersonaAlterEgos(rawAlterEgos, { personaId = getActivePersonaId(), legacyFields = null } = {}) {
    return normalizeAlterEgosForScope(TARGET_SCOPE.PERSONA, rawAlterEgos, { entityId: personaId, legacyFields });
}

export function getActiveAlterEgoForPersona(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return null;
    }

    return getActiveAlterEgo(readPersonaState(normalizedPersonaId));
}

export function getActivePersonaAlterEgoFields(state) {
    return getActiveAlterEgoFields(state);
}

export function setActivePersonaAlterEgoFields(state, fields) {
    setActiveAlterEgoFieldsForScope(TARGET_SCOPE.PERSONA, state, fields);
}


export function getActiveAlterEgoFields(state) {
    const activeAlterEgo = getActiveAlterEgo(state);
    return Array.isArray(activeAlterEgo?.fields) ? activeAlterEgo.fields : [];
}

export function setActiveAlterEgoFields(state, fields) {
    setActiveAlterEgoFieldsForScope(TARGET_SCOPE.CHARACTER, state, fields);
}


export function getUniqueAlterEgoName(existingAlterEgos, requestedName) {
    const baseName = String(requestedName || 'Imported Alter Ego').trim() || 'Imported Alter Ego';
    const existingNames = new Set(existingAlterEgos.map((alterEgo) => String(alterEgo.name || '').trim().toLowerCase()));

    if (!existingNames.has(baseName.toLowerCase())) {
        return baseName;
    }

    let counter = 2;

    while (existingNames.has(`${baseName} ${counter}`.toLowerCase())) {
        counter += 1;
    }

    return `${baseName} ${counter}`;
}

// -----------------------------------------------------------------------------
// Field, Alter Ego, and State Model - State Normalization
// -----------------------------------------------------------------------------

export function normalizeState(rawState = {}, options = {}) {
    const source = rawState && typeof rawState === 'object' ? rawState : {};
    const includeTriggerActions = shouldIncludeTriggerActions(options);
    const characterId = options.characterId ?? getActiveCharacterId();
    const hasSavedFields = Array.isArray(source.fields);
    const legacyFields = hasSavedFields
        ? source.fields.map((field) => normalizeField(field, { ...options, includeTriggerActions }))
        : createDefaultFields().map((field) => normalizeField(field, { ...options, includeTriggerActions }));

    const alterEgos = normalizeAlterEgos(source.alterEgos, { characterId, legacyFields });
    const requestedActiveAlterEgoId = String(source.activeAlterEgoId || '').trim();
    const activeAlterEgoId = alterEgos.some((alterEgo) => alterEgo.id === requestedActiveAlterEgoId)
        ? requestedActiveAlterEgoId
        : alterEgos[0]?.id ?? ALTER_EGO_BASE_ID;

    const normalizedState = {
        ...clone(DEFAULT_STATE),
        schemaVersion: CARD_SCHEMA_VERSION,
        swapEnabled: Boolean(source.swapEnabled),
        initializedDefaults: true,
        activeAlterEgoId,
        alterEgos,
        fields: [],
    };

    // Backward-compatible mutator bridge: if old/current UI code mutates
    // state.fields, treat those fields as the active alter ego's field set.
    if (Array.isArray(source.fields)) {
        setActiveAlterEgoFields(normalizedState, source.fields.map((field) => normalizeField(field, { ...options, includeTriggerActions })));
    } else {
        normalizedState.fields = getActiveAlterEgoFields(normalizedState);
    }

    return normalizedState;
}

export function normalizeCharacterState(rawState = {}, options = {}) {
    return normalizeState(rawState, {
        targetScope: TARGET_SCOPE.CHARACTER,
        includeTriggerActions: true,
        characterId: options.characterId ?? getActiveCharacterId(),
    });
}

export function normalizePersonaState(rawState = {}, options = {}) {
    const source = rawState && typeof rawState === 'object' ? rawState : {};
    const personaId = options.personaId ?? getActivePersonaId();
    const hasSavedFields = Array.isArray(source.fields);
    const initializedDefaults = Boolean(source.initializedDefaults);

    let legacyFields = hasSavedFields
        ? source.fields.map(normalizePersonaField)
        : createDefaultFields().map(normalizePersonaField);

    if (!initializedDefaults && legacyFields.length === 0) {
        legacyFields = createDefaultFields().map(normalizePersonaField);
    }

    const alterEgos = normalizePersonaAlterEgos(source.alterEgos, { personaId, legacyFields });
    const requestedActiveAlterEgoId = String(source.activeAlterEgoId || '').trim();
    const activeAlterEgoId = alterEgos.some((alterEgo) => alterEgo.id === requestedActiveAlterEgoId)
        ? requestedActiveAlterEgoId
        : alterEgos[0]?.id ?? ALTER_EGO_BASE_ID;

    const normalizedState = {
        schemaVersion: CARD_SCHEMA_VERSION,
        swapEnabled: Boolean(source.swapEnabled),
        initializedDefaults: true,
        activeAlterEgoId,
        alterEgos,
        fields: [],
    };

    if (Array.isArray(source.fields)) {
        setActivePersonaAlterEgoFields(normalizedState, source.fields.map(normalizePersonaField));
    } else {
        normalizedState.fields = getActivePersonaAlterEgoFields(normalizedState);
    }

    return normalizedState;
}

export function findField(state, fieldId) {
    return state.fields.find((field) => field.id === fieldId);
}

export function getUniqueFieldName(existingFields, requestedName) {
    const baseName = String(requestedName || 'Imported Field').trim() || 'Imported Field';
    const existingNames = new Set(existingFields.map((field) => String(field.name || '').trim().toLowerCase()));

    if (!existingNames.has(baseName.toLowerCase())) {
        return baseName;
    }

    let counter = 2;

    while (existingNames.has(`${baseName} ${counter}`.toLowerCase())) {
        counter += 1;
    }

    return `${baseName} ${counter}`;
}

export function prepareImportedFields(fields, existingFields = [], options = {}) {
    const result = [];
    const nameContext = [...existingFields];
    const includeTriggerActions = shouldIncludeTriggerActions(options);

    for (const rawField of fields) {
        const normalized = normalizeField({
            ...rawField,
            id: makeId(),
            enabled: rawField?.enabled !== false,
            keywordMode: normalizeKeywordMode(rawField?.keywordMode),
        }, {
            ...options,
            includeTriggerActions,
        });

        normalized.name = getUniqueFieldName(nameContext, normalized.name);
        nameContext.push(normalized);
        result.push(normalized);
    }

    return result;
}

export function prepareImportedPersonaFields(fields, existingFields = []) {
    return prepareImportedFields(fields, existingFields, {
        targetScope: TARGET_SCOPE.PERSONA,
        includeTriggerActions: false,
    });
}

export function prepareImportedCharacterFields(fields, existingFields = []) {
    return prepareImportedFields(fields, existingFields, {
        targetScope: TARGET_SCOPE.CHARACTER,
        includeTriggerActions: true,
    });
}

// -----------------------------------------------------------------------------
// Field, Alter Ego, and State Model - Clean Import / Export Conversion
// -----------------------------------------------------------------------------

export function exportFieldForJson(field, index = 0, options = {}) {
    const includeTriggerActions = shouldIncludeTriggerActions(options);
    const normalized = normalizeField(field, {
        ...options,
        includeTriggerActions,
    });

    const payload = {
        order: index + 1,
        name: normalized.name,
        inject: normalized.enabled,
        triggerSources: normalized.triggerSources,
        activatingKeywordMode: normalized.activatingKeywordMode,
        enablingKeywordMode: normalized.enablingKeywordMode,
        disablingKeywordMode: normalized.disablingKeywordMode,
        keywordMatching: normalized.keywordMatching,
        scanDepth: normalized.scanDepth,
        stickyTurns: normalized.stickyTurns,
        ...(typeof normalized.core === 'boolean' ? { core: normalized.core } : {}),
        activatingTriggers: splitKeywords(normalized.activatingTriggers),
        enablingTriggers: splitKeywords(normalized.enablingTriggers),
        disablingTriggers: splitKeywords(normalized.disablingTriggers),
        content: splitLinesForJson(normalized.content),
    };

    if (includeTriggerActions) {
        payload.triggerActionInstruction = splitLinesForJson(normalized.triggerActionInstruction);
    }

    return payload;
}

export function exportCharacterFieldForJson(field, index = 0) {
    return exportFieldForJson(field, index, {
        targetScope: TARGET_SCOPE.CHARACTER,
        includeTriggerActions: true,
    });
}

export function exportPersonaFieldForJson(field, index = 0) {
    return exportFieldForJson(field, index, {
        targetScope: TARGET_SCOPE.PERSONA,
        includeTriggerActions: false,
    });
}

export function importFieldFromJson(field = {}, options = {}) {
    const includeTriggerActions = shouldIncludeTriggerActions(options);
    const enabled = hasOwn(field, 'inject')
        ? Boolean(field.inject)
        : field.enabled !== false;

    const activatingTriggers = field.activatingTriggers ?? field.keywords ?? '';

    return normalizeField({
        id: makeId(),
        enabled,
        name: String(field.name ?? ''),
        activatingTriggers: Array.isArray(activatingTriggers)
            ? activatingTriggers.map((keyword) => String(keyword ?? '')).join('\n')
            : String(activatingTriggers ?? ''),
        enablingTriggers: Array.isArray(field.enablingTriggers)
            ? field.enablingTriggers.map((keyword) => String(keyword ?? '')).join('\n')
            : String(field.enablingTriggers ?? ''),
        disablingTriggers: Array.isArray(field.disablingTriggers)
            ? field.disablingTriggers.map((keyword) => String(keyword ?? '')).join('\n')
            : String(field.disablingTriggers ?? ''),
        triggerSources: normalizeTriggerSources(field.triggerSources),
        activatingKeywordMode: normalizeKeywordMode(field.activatingKeywordMode ?? field.keywordMode),
        enablingKeywordMode: normalizeKeywordMode(field.enablingKeywordMode ?? field.keywordMode),
        disablingKeywordMode: normalizeKeywordMode(field.disablingKeywordMode ?? field.keywordMode),
        keywordMatching: field.keywordMatching,
        scanDepth: field.scanDepth,
        stickyTurns: field.stickyTurns,
        core: field.core,
        triggerActionInstruction: includeTriggerActions ? joinLinesFromJson(field.triggerActionInstruction) : '',
        content: joinLinesFromJson(field.content),
    }, {
        ...options,
        includeTriggerActions,
    });
}

export function importCharacterFieldFromJson(field = {}) {
    return importFieldFromJson(field, {
        targetScope: TARGET_SCOPE.CHARACTER,
        includeTriggerActions: true,
    });
}

export function importPersonaFieldFromJson(field = {}) {
    return importFieldFromJson(field, {
        targetScope: TARGET_SCOPE.PERSONA,
        includeTriggerActions: false,
    });
}

export function exportAlterEgoForJson(alterEgo, index = 0, { targetScope = TARGET_SCOPE.CHARACTER } = {}) {
    const isPersona = targetScope === TARGET_SCOPE.PERSONA;
    const normalized = isPersona ? normalizePersonaAlterEgo(alterEgo) : normalizeAlterEgo(alterEgo);

    return {
        order: index + 1,
        id: normalized.id,
        name: normalized.name,
        avatarMode: normalized.avatarMode,
        avatarKey: normalized.avatarKey,
        avatarUrl: normalized.avatarUrl,
        avatarDataUrl: normalized.avatarDataUrl,
        avatarFilePath: normalized.avatarFilePath,
        avatarFileName: normalized.avatarFileName,
        avatarLocalPath: normalized.avatarLocalPath,
        swapMode: normalized.swapMode,
        changeConditions: splitKeywords(normalized.changeConditions),
        changeKeywordMode: normalized.changeKeywordMode,
        keywordMatching: normalized.keywordMatching,
        triggerSources: normalized.triggerSources,
        fields: normalized.fields.map(isPersona ? exportPersonaFieldForJson : exportCharacterFieldForJson),
    };
}

export function importAlterEgoFromJson(alterEgo = {}, existingAlterEgos = [], { targetScope = TARGET_SCOPE.CHARACTER } = {}) {
    const isPersona = targetScope === TARGET_SCOPE.PERSONA;
    const importedFields = Array.isArray(alterEgo.fields)
        ? alterEgo.fields.map(isPersona ? importPersonaFieldFromJson : importCharacterFieldFromJson)
        : [];
    const normalize = isPersona ? normalizePersonaAlterEgo : normalizeAlterEgo;

    return normalize({
        id: makeId(),
        name: getUniqueAlterEgoName(existingAlterEgos, alterEgo.name),
        avatarMode: alterEgo.avatarMode,
        avatarKey: alterEgo.avatarKey,
        avatarUrl: alterEgo.avatarUrl,
        avatarDataUrl: alterEgo.avatarDataUrl,
        avatarFilePath: alterEgo.avatarFilePath,
        avatarFileName: alterEgo.avatarFileName,
        avatarLocalPath: alterEgo.avatarLocalPath,
        swapMode: alterEgo.swapMode,
        changeKeywordMode: alterEgo.changeKeywordMode ?? alterEgo.keywordMode,
        keywordMatching: alterEgo.keywordMatching,
        triggerSources: alterEgo.triggerSources ?? alterEgo.changeTriggerSources,
        changeConditions: Array.isArray(alterEgo.changeConditions)
            ? alterEgo.changeConditions.map((keyword) => String(keyword ?? '')).join('\n')
            : String(alterEgo.changeConditions ?? ''),
        fields: importedFields,
    });
}

// -----------------------------------------------------------------------------
// Field, Alter Ego, and State Model - State Status Checks
// -----------------------------------------------------------------------------

export function areFieldsRemovedForCharacter(characterId) {
    const state = readState(characterId);
    return state.fields.length === 0;
}

export function areFieldsRemovedForCharacters(characterIds) {
    return characterIds.length > 0 && characterIds.every((characterId) => areFieldsRemovedForCharacter(characterId));
}

export function areFieldsRemovedForPersona(personaId) {
    const state = readPersonaState(personaId);
    return state.fields.length === 0;
}

export function areFieldsRemovedForPersonas(personaIds) {
    return personaIds.length > 0 && personaIds.every((personaId) => areFieldsRemovedForPersona(personaId));
}

export function getComparableField(field, options = {}) {
    const includeTriggerActions = shouldIncludeTriggerActions(options);
    const normalized = normalizeField(field, {
        ...options,
        includeTriggerActions,
    });

    const comparable = {
        enabled: normalized.enabled,
        name: normalized.name,
        activatingTriggers: normalized.activatingTriggers,
        enablingTriggers: normalized.enablingTriggers,
        disablingTriggers: normalized.disablingTriggers,
        triggerSources: normalized.triggerSources,
        activatingKeywordMode: normalized.activatingKeywordMode,
        enablingKeywordMode: normalized.enablingKeywordMode,
        disablingKeywordMode: normalized.disablingKeywordMode,
        content: normalized.content,
    };

    if (includeTriggerActions) {
        comparable.triggerActionInstruction = normalized.triggerActionInstruction;
    }

    return comparable;
}

export function areFieldsOutOfBox(fields, options = {}) {
    const includeTriggerActions = shouldIncludeTriggerActions(options);
    const normalizedFields = Array.isArray(fields)
        ? fields.map((field) => normalizeField(field, { ...options, includeTriggerActions }))
        : [];

    const defaultFields = createDefaultFields()
        .map((field) => normalizeField(field, { ...options, includeTriggerActions }));

    if (normalizedFields.length !== defaultFields.length) {
        return false;
    }

    return normalizedFields.every((field, index) => {
        const actual = getComparableField(field, { ...options, includeTriggerActions });
        const expected = getComparableField(defaultFields[index], { ...options, includeTriggerActions });

        return JSON.stringify(actual) === JSON.stringify(expected);
    });
}

export function areAlterEgosOutOfBox(alterEgos, options = {}) {
    const normalized = normalizeAlterEgos(alterEgos);

    if (normalized.length !== 1) {
        return false;
    }

    const base = normalized[0];

    return (
        base.id === ALTER_EGO_BASE_ID &&
        base.avatarMode === ALTER_EGO_AVATAR_MODE.INHERIT &&
        base.avatarKey === '' &&
        base.avatarUrl === '' &&
        base.avatarDataUrl === '' &&
        base.avatarFileName === '' &&
        base.avatarLocalPath === '' &&
        base.swapMode === ALTER_EGO_SWAP_MODE.MANUAL &&
        base.changeConditions === '' &&
        base.changeKeywordMode === KEYWORD_MODE.ANY &&
        JSON.stringify(base.triggerSources) === JSON.stringify(DEFAULT_TRIGGER_SOURCES) &&
        areFieldsOutOfBox(base.fields, options)
    );
}

export function isStateOutOfBox(state) {
    const normalized = normalizeCharacterState(state);

    return (
        normalized.swapEnabled === false &&
        normalized.activeAlterEgoId === ALTER_EGO_BASE_ID &&
        areAlterEgosOutOfBox(normalized.alterEgos, {
            targetScope: TARGET_SCOPE.CHARACTER,
            includeTriggerActions: true,
        })
    );
}

export function arePersonaAlterEgosOutOfBox(alterEgos, options = {}) {
    const normalized = normalizePersonaAlterEgos(alterEgos);

    if (normalized.length !== 1) {
        return false;
    }

    const base = normalized[0];

    return (
        base.id === ALTER_EGO_BASE_ID &&
        base.avatarMode === ALTER_EGO_AVATAR_MODE.INHERIT &&
        base.avatarKey === '' &&
        base.avatarUrl === '' &&
        base.avatarDataUrl === '' &&
        base.avatarFileName === '' &&
        base.avatarLocalPath === '' &&
        base.swapMode === ALTER_EGO_SWAP_MODE.MANUAL &&
        base.changeConditions === '' &&
        areFieldsOutOfBox(base.fields, options)
    );
}

export function isPersonaStateOutOfBox(state) {
    const normalized = normalizePersonaState(state);

    return (
        normalized.swapEnabled === false &&
        normalized.activeAlterEgoId === ALTER_EGO_BASE_ID &&
        arePersonaAlterEgosOutOfBox(normalized.alterEgos, {
            targetScope: TARGET_SCOPE.PERSONA,
            includeTriggerActions: false,
        })
    );
}

export function isCharacterOutOfBox(characterId) {
    return isStateOutOfBox(readState(characterId));
}

export function areCharactersOutOfBox(characterIds) {
    return characterIds.length > 0 && characterIds.every((characterId) => isCharacterOutOfBox(characterId));
}

export function isPersonaOutOfBox(personaId) {
    return isPersonaStateOutOfBox(readPersonaState(personaId));
}

export function arePersonasOutOfBox(personaIds) {
    return personaIds.length > 0 && personaIds.every((personaId) => isPersonaOutOfBox(personaId));
}
