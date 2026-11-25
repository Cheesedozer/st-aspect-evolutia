// Aspect: Evolutia — import-export.js (split from the former single index.js).
import {
    DEFAULT_TRIGGER_SOURCES,
    KEYWORD_MATCHING,
    KEYWORD_MODE,
    MODULE_NAME,
    NATIVE_IMPORT_HEADINGS,
    PERSONA_STATE_SETTINGS_KEY,
    TARGET_SCOPE,
    UI,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getCharacter,
    getCharacterName,
    getNativeDescriptionForCharacter,
    getNativePersonaDescriptionForPersona,
    getNativePersonalityForCharacter,
    getPersonaName,
} from './context.js';
import {
    exportAlterEgoForJson,
    exportCharacterFieldForJson,
    exportPersonaFieldForJson,
    importAlterEgoFromJson,
    importCharacterFieldFromJson,
    importPersonaFieldFromJson,
    normalizeCharacterField,
    normalizePersonaField,
    prepareImportedCharacterFields,
    prepareImportedPersonaFields,
} from './model.js';
import {
    readPersonaState,
    readState,
    updatePersonaState,
    updateState,
} from './persistence.js';
import {
    copyTextToClipboard,
    downloadJsonFile,
    normalizeHeadingKey,
    notify,
    readTextFromClipboard,
    sanitizeFilename,
    titleCase,
} from './utils.js';

// ============================================================================
// Section 12. Import / Export
// ============================================================================
// Purpose:
// - Own Import and Export menu actions for Character Dynamic Fields.
// - Own Import and Export menu actions for Persona Dynamic Fields.
// ============================================================================

// -----------------------------------------------------------------------------
// Import / Export - Dynamic Field Payload Handling
// -----------------------------------------------------------------------------

export function buildDynamicFieldsExportPayload(characterId = getActiveCharacterId()) {
    const state = readState(characterId);

    return {
        type: 'aspect_evolutia_character_dynamic_fields',
        version: 2,
        // 'fields' = the alter ego open in the editor (read by older versions).
        fields: state.fields.map(exportCharacterFieldForJson),
        activeAlterEgoId: state.activeAlterEgoId,
        alterEgos: state.alterEgos.map((alterEgo, index) => exportAlterEgoForJson(alterEgo, index, { targetScope: TARGET_SCOPE.CHARACTER })),
    };
}

export function buildPersonaDynamicFieldsExportPayload(personaId = getActivePersonaId()) {
    const state = readPersonaState(personaId);

    return {
        type: 'aspect_evolutia_persona_dynamic_fields',
        version: 2,
        // 'fields' = the alter ego open in the editor (read by older versions).
        fields: state.fields.map(exportPersonaFieldForJson),
        activeAlterEgoId: state.activeAlterEgoId,
        alterEgos: state.alterEgos.map((alterEgo, index) => exportAlterEgoForJson(alterEgo, index, { targetScope: TARGET_SCOPE.PERSONA })),
    };
}

export function getFieldArrayFromPayloadSource(source) {
    if (Array.isArray(source)) {
        return source;
    }

    if (!source || typeof source !== 'object') {
        return [];
    }

    if (Array.isArray(source.fields)) {
        return source.fields;
    }

    const directExtensionState =
        source?.data?.extensions?.[MODULE_NAME] ??
        source?.extensions?.[MODULE_NAME] ??
        source?.character?.data?.extensions?.[MODULE_NAME];

    if (Array.isArray(directExtensionState?.fields)) {
        return directExtensionState.fields;
    }

    const personaExtensionStates =
        source?.[MODULE_NAME]?.[PERSONA_STATE_SETTINGS_KEY] ??
        source?.settings?.[MODULE_NAME]?.[PERSONA_STATE_SETTINGS_KEY] ??
        source?.power_user?.[MODULE_NAME]?.[PERSONA_STATE_SETTINGS_KEY];

    if (personaExtensionStates && typeof personaExtensionStates === 'object') {
        const allPersonaFields = Object.values(personaExtensionStates)
            .flatMap((state) => Array.isArray(state?.fields) ? state.fields : []);

        if (allPersonaFields.length) {
            return allPersonaFields;
        }
    }

    return [];
}

export function getAlterEgosFromDynamicFieldsPayload(payload) {
    const source = parseDynamicFieldsPayload(payload);

    if (!Array.isArray(source?.alterEgos)) {
        return [];
    }

    return source.alterEgos.filter((alterEgo) => alterEgo && alterEgo.id !== source.activeAlterEgoId);
}

export function parseDynamicFieldsPayload(payload) {
    return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

export function getFieldsFromDynamicFieldsPayload(payload) {
    const source = parseDynamicFieldsPayload(payload);
    const fields = getFieldArrayFromPayloadSource(source);

    return fields.map(importCharacterFieldFromJson);
}

export function getPersonaFieldsFromDynamicFieldsPayload(payload) {
    const source = parseDynamicFieldsPayload(payload);
    const fields = getFieldArrayFromPayloadSource(source);

    return fields.map(importPersonaFieldFromJson);
}

export function filterImportableCharacterFields(fields) {
    return Array.isArray(fields)
        ? fields.map(normalizeCharacterField).filter((field) => field.content.trim() || field.name.trim())
        : [];
}

export function filterImportablePersonaFields(fields) {
    return Array.isArray(fields)
        ? fields.map(normalizePersonaField).filter((field) => field.content.trim() || field.name.trim())
        : [];
}

export function appendImportedFieldsToActiveCharacter(fields, successMessage, alterEgos = []) {
    const characterId = getActiveCharacterId();

    if (characterId === undefined) {
        notify('warning', 'Select a character before importing Character Dynamic Fields.');
        return;
    }

    const normalizedFields = filterImportableCharacterFields(fields);

    if (!normalizedFields.length && !alterEgos.length) {
        notify('warning', 'No Character Dynamic Fields were found to import.');
        return;
    }

    updateState((state) => {
        const importedFields = prepareImportedCharacterFields(normalizedFields, state.fields);
        state.fields.push(...importedFields);

        for (const alterEgo of alterEgos) {
            state.alterEgos.push(importAlterEgoFromJson(alterEgo, state.alterEgos, { targetScope: TARGET_SCOPE.CHARACTER }));
        }
    }, { rerender: true });

    const alterEgoNote = alterEgos.length ? ` and ${alterEgos.length} alter ego(s)` : '';
    notify('success', `${successMessage || `Imported ${normalizedFields.length} Character Dynamic Field(s).`}${alterEgoNote}`);
}

export function appendImportedFieldsToActivePersona(fields, successMessage, alterEgos = []) {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before importing Persona Dynamic Fields.');
        return;
    }

    const normalizedFields = filterImportablePersonaFields(fields);

    if (!normalizedFields.length && !alterEgos.length) {
        notify('warning', 'No Persona Dynamic Fields were found to import.');
        return;
    }

    updatePersonaState((state) => {
        const importedFields = prepareImportedPersonaFields(normalizedFields, state.fields);
        state.fields.push(...importedFields);

        for (const alterEgo of alterEgos) {
            state.alterEgos.push(importAlterEgoFromJson(alterEgo, state.alterEgos, { targetScope: TARGET_SCOPE.PERSONA }));
        }
    }, { rerender: true });

    const alterEgoNote = alterEgos.length ? ` and ${alterEgos.length} alter ego(s)` : '';
    notify('success', `${successMessage || `Imported ${normalizedFields.length} Persona Dynamic Field(s).`}${alterEgoNote}`);
}

// -----------------------------------------------------------------------------
// Import / Export - Native Character Description / Personality Import
// -----------------------------------------------------------------------------

export function isLikelyNativeImportHeadingName(candidate, isStrongSyntax = false) {
    const text = String(candidate || '').trim();

    if (!text || text.length > 60) {
        return false;
    }

    if (/[.!?]$/.test(text)) {
        return false;
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9\s/&'’()_-]*$/.test(text)) {
        return false;
    }

    const key = normalizeHeadingKey(text);

    if (NATIVE_IMPORT_HEADINGS.has(key)) {
        return true;
    }

    const wordCount = key.split(/\s+/).filter(Boolean).length;

    return isStrongSyntax && wordCount >= 1 && wordCount <= 5;
}

export function parseNativeHeadingLine(line) {
    const text = String(line || '').trim();

    if (!text) {
        return null;
    }

    let match = text.match(/^#{1,6}\s+(.+?)\s*$/);

    if (match && isLikelyNativeImportHeadingName(match[1], true)) {
        return titleCase(match[1]);
    }

    match = text.match(/^\[\s*([^\[\]]{1,60})\s*\]$/);

    if (match && isLikelyNativeImportHeadingName(match[1], true)) {
        return titleCase(match[1]);
    }

    match = text.match(/^<\s*([^<>]{1,60})\s*>$/);

    if (match && isLikelyNativeImportHeadingName(match[1], true)) {
        return titleCase(match[1]);
    }

    match = text.match(/^([A-Za-z0-9][A-Za-z0-9\s/&'’()_-]{0,59})\s*(?::|-|—)\s*$/);

    if (match && isLikelyNativeImportHeadingName(match[1], false)) {
        return titleCase(match[1]);
    }

    return null;
}

export function parseHeaderedNativeSections(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let currentSection = null;

    for (const line of lines) {
        const heading = parseNativeHeadingLine(line);

        if (heading) {
            if (currentSection) {
                const content = currentSection.contentLines.join('\n').trim();

                if (content) {
                    sections.push({
                        name: currentSection.name,
                        content,
                    });
                }
            }

            currentSection = {
                name: heading,
                contentLines: [],
            };

            continue;
        }

        if (currentSection) {
            currentSection.contentLines.push(line);
        }
    }

    if (currentSection) {
        const content = currentSection.contentLines.join('\n').trim();

        if (content) {
            sections.push({
                name: currentSection.name,
                content,
            });
        }
    }

    return sections;
}

export function createFieldFromNativeImport(name, content) {
    return normalizeCharacterField({
        name,
        activatingTriggers: '',
        enablingTriggers: '',
        disablingTriggers: '',
        triggerSources: [...DEFAULT_TRIGGER_SOURCES],
        activatingKeywordMode: KEYWORD_MODE.ALL,
        enablingKeywordMode: KEYWORD_MODE.ALL,
        disablingKeywordMode: KEYWORD_MODE.ALL,
        keywordMatching: KEYWORD_MATCHING.WORDS,
        triggerActionInstruction: '',
        content,
        enabled: true,
    });
}

export function createPersonaFieldFromNativeImport(name, content) {
    return normalizePersonaField({
        name,
        activatingTriggers: '',
        enablingTriggers: '',
        disablingTriggers: '',
        triggerSources: [...DEFAULT_TRIGGER_SOURCES],
        activatingKeywordMode: KEYWORD_MODE.ALL,
        enablingKeywordMode: KEYWORD_MODE.ALL,
        disablingKeywordMode: KEYWORD_MODE.ALL,
        keywordMatching: KEYWORD_MATCHING.WORDS,
        triggerActionInstruction: '',
        content,
        enabled: true,
    });
}

export function buildNativeFieldImportsFromCharacter(character) {
    const description = getNativeDescriptionForCharacter(character);
    const personality = getNativePersonalityForCharacter(character);
    const importedFields = [];

    if (description) {
        const descriptionSections = parseHeaderedNativeSections(description);
        const shouldSkipDescriptionPersonality = Boolean(personality.trim());

        if (descriptionSections.length) {
            for (const section of descriptionSections) {
                if (shouldSkipDescriptionPersonality && normalizeHeadingKey(section.name) === 'personality') {
                    continue;
                }

                importedFields.push(createFieldFromNativeImport(section.name, section.content));
            }
        } else {
            importedFields.push(createFieldFromNativeImport('Background', description));
        }
    }

    if (personality) {
        importedFields.push(createFieldFromNativeImport('Personality', personality));
    }

    return importedFields;
}

export function buildPersonaDescriptionImports(personaId = getActivePersonaId()) {
    const description = getNativePersonaDescriptionForPersona(personaId);
    const importedFields = [];

    if (!description) {
        return importedFields;
    }

    const descriptionSections = parseHeaderedNativeSections(description);

    if (descriptionSections.length) {
        for (const section of descriptionSections) {
            importedFields.push(createPersonaFieldFromNativeImport(section.name, section.content));
        }
    } else {
        importedFields.push(createPersonaFieldFromNativeImport('Background', description));
    }

    return importedFields;
}

// -----------------------------------------------------------------------------
// Import / Export - Character Import Actions
// -----------------------------------------------------------------------------

export function importDynamicFieldsFromCharacterCardFile() {
    $(`#${UI.CHARACTER_CARD_IMPORT_FILE_ID}`).val('').trigger('click');
}

export function importDynamicFieldsFromFileJson() {
    $(`#${UI.DYNAMIC_FIELDS_IMPORT_FILE_ID}`).val('').trigger('click');
}

export async function handleCharacterCardImportFileSelected(event) {
    const file = event.target.files?.[0];

    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const fields = getFieldsFromDynamicFieldsPayload(payload);

        appendImportedFieldsToActiveCharacter(fields, `Imported ${fields.length} Character Dynamic Field(s) from character description.`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to import character description Dynamic Fields:`, error);
        notify('error', 'Failed to import Character Dynamic Fields from character description JSON.');
    } finally {
        $(`#${UI.CHARACTER_CARD_IMPORT_FILE_ID}`).val('');
    }
}

export async function handleDynamicFieldsImportFileSelected(event) {
    const file = event.target.files?.[0];

    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const fields = getFieldsFromDynamicFieldsPayload(payload);

        appendImportedFieldsToActiveCharacter(fields, `Imported ${fields.length} Character Dynamic Field(s) from JSON file.`, getAlterEgosFromDynamicFieldsPayload(payload));
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to import Character Dynamic Fields JSON file:`, error);
        notify('error', 'Failed to import Character Dynamic Fields from JSON file.');
    } finally {
        $(`#${UI.DYNAMIC_FIELDS_IMPORT_FILE_ID}`).val('');
    }
}

export function importDynamicFieldsFromNativeFields() {
    const characterId = getActiveCharacterId();
    const character = getCharacter(characterId);

    if (!character) {
        notify('warning', 'Select a character before importing native fields.');
        return;
    }

    const importedFields = buildNativeFieldImportsFromCharacter(character);

    appendImportedFieldsToActiveCharacter(
        importedFields,
        `Imported ${importedFields.length} Character Dynamic Field(s) from native fields.`,
    );
}

export async function importDynamicFieldsFromClipboardJson() {
    try {
        const text = await readTextFromClipboard();
        const fields = getFieldsFromDynamicFieldsPayload(text);

        appendImportedFieldsToActiveCharacter(fields, `Imported ${fields.length} Character Dynamic Field(s) from clipboard JSON.`, getAlterEgosFromDynamicFieldsPayload(text));
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to import clipboard Character Dynamic Fields:`, error);
        notify('error', 'Failed to import Character Dynamic Fields from clipboard JSON.');
    }
}

// -----------------------------------------------------------------------------
// Import / Export - Persona Import Actions
// -----------------------------------------------------------------------------

export function importPersonaDynamicFieldsFromFileJson() {
    $(`#${UI.PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID}`).val('').trigger('click');
}

export function importPersonaDynamicFieldsFromPersonaDescription() {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before importing Persona Description.');
        return;
    }

    const importedFields = buildPersonaDescriptionImports(personaId);

    appendImportedFieldsToActivePersona(
        importedFields,
        `Imported ${importedFields.length} Persona Dynamic Field(s) from Persona Description.`,
    );
}

export async function handlePersonaDynamicFieldsImportFileSelected(event) {
    const file = event.target.files?.[0];

    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const fields = getPersonaFieldsFromDynamicFieldsPayload(payload);

        appendImportedFieldsToActivePersona(fields, `Imported ${fields.length} Persona Dynamic Field(s) from JSON file.`, getAlterEgosFromDynamicFieldsPayload(payload));
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to import Persona Dynamic Fields JSON file:`, error);
        notify('error', 'Failed to import Persona Dynamic Fields from JSON file.');
    } finally {
        $(`#${UI.PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID}`).val('');
    }
}

export async function importPersonaDynamicFieldsFromClipboardJson() {
    try {
        const text = await readTextFromClipboard();
        const fields = getPersonaFieldsFromDynamicFieldsPayload(text);

        appendImportedFieldsToActivePersona(fields, `Imported ${fields.length} Persona Dynamic Field(s) from clipboard JSON.`, getAlterEgosFromDynamicFieldsPayload(text));
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to import clipboard Persona Dynamic Fields:`, error);
        notify('error', 'Failed to import Persona Dynamic Fields from clipboard JSON.');
    }
}

// -----------------------------------------------------------------------------
// Import / Export - Character Export Actions
// -----------------------------------------------------------------------------

export function exportDynamicFieldsToFileJson() {
    const characterId = getActiveCharacterId();

    if (characterId === undefined) {
        notify('warning', 'Select a character before exporting Character Dynamic Fields.');
        return;
    }

    const characterName = getCharacterName(characterId);
    const payload = buildDynamicFieldsExportPayload(characterId);

    downloadJsonFile(`${sanitizeFilename(characterName)}_aspect_evolutia_character_dynamic_fields.json`, payload);
    notify('success', 'Exported Character Dynamic Fields JSON file.');
}

export async function exportDynamicFieldsToClipboardJson() {
    const characterId = getActiveCharacterId();

    if (characterId === undefined) {
        notify('warning', 'Select a character before copying Character Dynamic Fields.');
        return;
    }

    try {
        const payload = buildDynamicFieldsExportPayload(characterId);
        await copyTextToClipboard(JSON.stringify(payload, null, 2));
        notify('success', 'Copied Character Dynamic Fields JSON to clipboard.');
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to copy Character Dynamic Fields JSON:`, error);
        notify('error', 'Failed to copy Character Dynamic Fields JSON to clipboard.');
    }
}

// -----------------------------------------------------------------------------
// Import / Export - Persona Export Actions
// -----------------------------------------------------------------------------

export function exportPersonaDynamicFieldsToFileJson() {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before exporting Persona Dynamic Fields.');
        return;
    }

    const personaName = getPersonaName(personaId);
    const payload = buildPersonaDynamicFieldsExportPayload(personaId);

    downloadJsonFile(`${sanitizeFilename(personaName)}_aspect_evolutia_persona_dynamic_fields.json`, payload);
    notify('success', 'Exported Persona Dynamic Fields JSON file.');
}

export async function exportPersonaDynamicFieldsToClipboardJson() {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before copying Persona Dynamic Fields.');
        return;
    }

    try {
        const payload = buildPersonaDynamicFieldsExportPayload(personaId);
        await copyTextToClipboard(JSON.stringify(payload, null, 2));
        notify('success', 'Copied Persona Dynamic Fields JSON to clipboard.');
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to copy Persona Dynamic Fields JSON:`, error);
        notify('error', 'Failed to copy Persona Dynamic Fields JSON to clipboard.');
    }
}
