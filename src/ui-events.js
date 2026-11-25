// Aspect: Evolutia — ui-events.js (split from the former single index.js).
import { getAlterEgoScope } from './alter-ego-scope.js';
import { normalizeCount } from './model.js';
import {
    ALTER_EGO_AVATAR_MODE,
    ALTER_EGO_BASE_ID,
    DEFAULT_TRIGGER_SOURCES,
    EXPORT_TARGET,
    FIELD_DRAG_AUTOSCROLL_MARGIN,
    FIELD_DRAG_AUTOSCROLL_MAX_SPEED,
    FIELD_EDIT_INPUT_UPDATE_OPTIONS,
    IMPORT_SOURCE,
    KEYWORD_MATCHING,
    KEYWORD_MODE,
    MODULE_NAME,
    TARGET_SCOPE,
    UI,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getContext,
    normalizeLocalImagePath,
    probeImageReference,
    readImageFileAsDataUrl,
    uploadDataUrlAsUserFile,
} from './context.js';
import {
    exportDynamicFieldsToClipboardJson,
    exportDynamicFieldsToFileJson,
    exportPersonaDynamicFieldsToClipboardJson,
    exportPersonaDynamicFieldsToFileJson,
    handleCharacterCardImportFileSelected,
    handleDynamicFieldsImportFileSelected,
    handlePersonaDynamicFieldsImportFileSelected,
    importDynamicFieldsFromCharacterCardFile,
    importDynamicFieldsFromClipboardJson,
    importDynamicFieldsFromFileJson,
    importDynamicFieldsFromNativeFields,
    importPersonaDynamicFieldsFromClipboardJson,
    importPersonaDynamicFieldsFromFileJson,
    importPersonaDynamicFieldsFromPersonaDescription,
} from './import-export.js';
import {
    findField,
    getActiveAlterEgo,
    getActiveAlterEgoFields,
    normalizeAlterEgoAvatarMode,
    normalizeCharacterField,
    normalizeKeywordMatching,
    normalizeKeywordMode,
    normalizePersonaField,
    normalizeTriggerSources,
} from './model.js';
import {
    readPersonaState,
    readState,
    updatePersonaState,
    updateState,
} from './persistence.js';
import {
    applyPersonaUiVisibility,
    applyUiVisibility,
} from './ui-render.js';
import {
    escapeTextarea,
    makeId,
    notify,
    syncPositionInputWidth,
} from './utils.js';

// Module state (written only by this module).
export let fieldPointerDrag = null;
export let fieldDragAutoScrollFrame = null;


// ============================================================================
// Section 15. User Interface Events
// ============================================================================
// Purpose:
// - Own DOM event binding for Character Dynamic Fields controls.
// - Own DOM event binding for Persona Dynamic Fields controls.
// ============================================================================

// -----------------------------------------------------------------------------
// User Interface Events - Target Scope Helpers
// -----------------------------------------------------------------------------

export function getFieldTargetScope($field) {
    const rawScope = String(
        $field?.attr('data-target-scope') ||
        $field?.closest('[data-target-scope]').attr('data-target-scope') ||
        '',
    );

    return rawScope === TARGET_SCOPE.PERSONA
        ? TARGET_SCOPE.PERSONA
        : TARGET_SCOPE.CHARACTER;
}

export function getPanelSelectorForTargetScope(targetScope) {
    return targetScope === TARGET_SCOPE.PERSONA
        ? `#${UI.PERSONA_PANEL_ID}`
        : `#${UI.PANEL_ID}`;
}

export function normalizeFieldForTargetScope(field, targetScope) {
    return targetScope === TARGET_SCOPE.PERSONA
        ? normalizePersonaField(field)
        : normalizeCharacterField(field);
}

export function updateStateForTargetScope(targetScope, mutator, options = {}) {
    if (targetScope === TARGET_SCOPE.PERSONA) {
        updatePersonaState(mutator, options);
        return;
    }

    updateState(mutator, options);
}

export function createBlankFieldForTargetScope(targetScope) {
    return normalizeFieldForTargetScope({
        name: '',
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
    }, targetScope);
}

export function getCurrentPanelFieldOrder(targetScope) {
    return $(`${getPanelSelectorForTargetScope(targetScope)} .dsf-field`)
        .map(function mapFieldId() {
            return String($(this).attr('data-field-id') || $(this).data('field-id') || '');
        })
        .get()
        .filter(Boolean);
}

// -----------------------------------------------------------------------------
// User Interface Events - Character Top Bar Controls
// -----------------------------------------------------------------------------

export function deleteAllDynamicFieldsForCurrentCharacter() {
    const characterId = getActiveCharacterId();

    if (characterId === undefined) {
        notify('warning', 'Select a character before deleting Character Dynamic Fields.');
        return;
    }

    const state = readState(characterId);

    if (!state.fields.length) {
        notify('info', 'There are no Character Dynamic Fields to delete.');
        applyUiVisibility();
        return;
    }

    const confirmed = window.confirm(
        'Delete all Character Dynamic Fields for this character?\n\n' +
        'This only affects Aspect: Evolutia Character Dynamic Fields. Native SillyTavern fields are not changed.',
    );

    if (!confirmed) {
        return;
    }

    updateState((nextState) => {
        nextState.fields = [];
    }, { rerender: true });

    notify('success', 'Deleted all Character Dynamic Fields for this character.');
}


export async function getAlterEgoNameFromUser(title, defaultValue = '') {
    const ctx = getContext();

    if (typeof ctx?.callGenericPopup === 'function' && ctx?.POPUP_TYPE) {
        const result = await ctx.callGenericPopup(`<h3>${escapeTextarea(title)}</h3>`, ctx.POPUP_TYPE.INPUT, defaultValue);
        return String(result || '').trim();
    }

    return String(window.prompt(title, defaultValue) || '').trim();
}

export function bindAlterEgoHandlers(targetScope = TARGET_SCOPE.CHARACTER) {
    const scope = getAlterEgoScope(targetScope);

    $(document)
        .off(`change.${MODULE_NAME}`, `#${scope.id('SELECT_ID')}`)
        .on(`change.${MODULE_NAME}`, `#${scope.id('SELECT_ID')}`, function onAlterEgoSelected() {
            const requestedId = String(this.value || '').trim();

            scope.update((state) => {
                if (!state.alterEgos.some((alterEgo) => alterEgo.id === requestedId)) {
                    return;
                }

                state.activeAlterEgoId = requestedId;
                state.fields = getActiveAlterEgoFields(state);
            }, { rerender: true, syncPromptManager: true, applyIdentity: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('CREATE_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('CREATE_ID')}`, async function onCreateAlterEgoClicked() {
            const name = await getAlterEgoNameFromUser(`Create ${scope.label}`, 'New Alter Ego');

            if (!name) {
                return;
            }

            scope.update((state) => {
                const next = scope.createBlank(state.alterEgos, { name });
                state.alterEgos.push(next);
                state.activeAlterEgoId = next.id;
                state.fields = next.fields;
            }, { rerender: true, syncPromptManager: true, applyIdentity: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('DUPLICATE_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('DUPLICATE_ID')}`, async function onDuplicateAlterEgoClicked() {
            const current = getActiveAlterEgo(scope.read());
            const name = await getAlterEgoNameFromUser(`Duplicate ${scope.label}`, `${current?.name || 'Alter Ego'} Copy`);

            if (!name) {
                return;
            }

            scope.update((state) => {
                const next = scope.createBlank(state.alterEgos, {
                    name,
                    fromAlterEgo: getActiveAlterEgo(state),
                });

                state.alterEgos.push(next);
                state.activeAlterEgoId = next.id;
                state.fields = next.fields;
            }, { rerender: true, syncPromptManager: true, applyIdentity: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('RENAME_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('RENAME_ID')}`, async function onRenameAlterEgoClicked() {
            const current = getActiveAlterEgo(scope.read());

            if (!current) {
                return;
            }

            const name = await getAlterEgoNameFromUser(`Rename ${scope.label}`, current.name);

            if (!name) {
                return;
            }

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);
                if (alterEgo) alterEgo.name = name;
            }, { rerender: true, syncPromptManager: true, applyIdentity: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('DELETE_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('DELETE_ID')}`, function onDeleteAlterEgoClicked() {
            const current = getActiveAlterEgo(scope.read());

            if (!current || current.id === ALTER_EGO_BASE_ID) {
                notify('warning', `The base ${scope.lowerLabel} cannot be deleted.`);
                return;
            }

            const confirmed = window.confirm(`Delete ${scope.lowerLabel} "${current.name}"?\n\nThis removes only this ${scope.lowerLabel}'s Dynamic Fields. It does not delete ${scope.ownerNoun}.`);

            if (!confirmed) {
                return;
            }

            scope.update((state) => {
                scope.deleteById(state, current.id);
            }, { rerender: true, syncPromptManager: true, applyIdentity: true });
        });

    $(document)
        .off(`input.${MODULE_NAME}`, `.${scope.cls}-change-conditions`)
        .on(`input.${MODULE_NAME}`, `.${scope.cls}-change-conditions`, function onAlterEgoChangeConditionsChanged() {
            const value = String(this.value || '');

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (alterEgo) {
                    alterEgo.changeConditions = value;
                }
            }, {
                rerender: false,
                applyIdentity: false,
                deferTokenEstimate: true,
                deferSettingsActionState: true,
            });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `.${scope.cls}-change-keyword-mode`)
        .on(`change.${MODULE_NAME}`, `.${scope.cls}-change-keyword-mode`, function onAlterEgoKeywordModeChanged() {
            const mode = normalizeKeywordMode(this.value);

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (alterEgo) {
                    alterEgo.changeKeywordMode = mode;
                }
            }, {
                rerender: false,
                applyIdentity: false,
            });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `.${scope.cls}-trigger-source`)
        .on(`change.${MODULE_NAME}`, `.${scope.cls}-trigger-source`, function onAlterEgoTriggerSourcesChanged() {
            const selectedSources = $(this)
                .closest(`.${scope.cls}-triggered-by-menu`)
                .find(`.${scope.cls}-trigger-source:checked`)
                .map((_, checkbox) => checkbox.value)
                .get();

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (alterEgo) {
                    alterEgo.triggerSources = normalizeTriggerSources(selectedSources);
                }
            }, {
                rerender: false,
                applyIdentity: false,
            });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `#${scope.id('AVATAR_MODE_ID')}`)
        .on(`change.${MODULE_NAME}`, `#${scope.id('AVATAR_MODE_ID')}`, function onAlterEgoAvatarModeChanged() {
            const mode = normalizeAlterEgoAvatarMode(this.value);

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);
                if (alterEgo) alterEgo.avatarMode = mode;
            }, { rerender: true, applyIdentity: true });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `#${scope.id('AVATAR_KEY_ID')}`)
        .on(`change.${MODULE_NAME}`, `#${scope.id('AVATAR_KEY_ID')}`, function onAlterEgoAvatarKeyChanged() {
            const avatarKey = String(this.value || '').trim();

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (!alterEgo) {
                    return;
                }

                alterEgo.avatarMode = ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY;
                alterEgo.avatarKey = avatarKey;
            }, { rerender: true, applyIdentity: true });
        });

    $(document)
        .off(`input.${MODULE_NAME}`, `#${scope.id('AVATAR_URL_ID')}`)
        .on(`input.${MODULE_NAME}`, `#${scope.id('AVATAR_URL_ID')}`, function onAlterEgoAvatarUrlChanged() {
            const value = String(this.value || '').trim();

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (!alterEgo) {
                    return;
                }

                if (alterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.DATA_URL) {
                    alterEgo.avatarDataUrl = value;
                } else {
                    alterEgo.avatarUrl = value;
                }
            }, {
                rerender: false,
                applyIdentity: false,
                deferTokenEstimate: true,
                deferSettingsActionState: true,
            });

            scope.scheduleVisualRefresh();
        });


    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('IMAGE_FILE_BUTTON_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('IMAGE_FILE_BUTTON_ID')}`, function onAlterEgoImageFileButtonClicked(event) {
            event.preventDefault();
            $(`#${scope.id('IMAGE_FILE_INPUT_ID')}`).trigger('click');
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `#${scope.id('IMAGE_FILE_INPUT_ID')}`)
        .on(`change.${MODULE_NAME}`, `#${scope.id('IMAGE_FILE_INPUT_ID')}`, async function onAlterEgoImageFileChanged() {
            const file = this.files?.[0];

            if (!file) {
                return;
            }

            try {
                const dataUrl = await readImageFileAsDataUrl(file);
                const filePath = await uploadDataUrlAsUserFile(dataUrl);

                scope.update((state) => {
                    const alterEgo = getActiveAlterEgo(state);

                    if (!alterEgo) {
                        return;
                    }

                    alterEgo.avatarMode = ALTER_EGO_AVATAR_MODE.IMAGE_FILE;
                    // Stored as a file in the user's Files folder; only the path goes on the card.
                    alterEgo.avatarFilePath = filePath;
                    alterEgo.avatarDataUrl = filePath ? '' : dataUrl;
                    alterEgo.avatarFileName = file.name || 'local image';
                }, { rerender: true, applyIdentity: true });
            } catch (error) {
                console.error(`[${MODULE_NAME}] Failed to load ${scope.label} image file:`, error);
                notify('error', `Failed to load image file: ${error?.message ?? error}`);
            } finally {
                this.value = '';
            }
        });

    $(document)
        .off(`input.${MODULE_NAME}`, `#${scope.id('LOCAL_FILE_PATH_ID')}`)
        .on(`input.${MODULE_NAME}`, `#${scope.id('LOCAL_FILE_PATH_ID')}`, function onAlterEgoLocalFilePathChanged() {
            const value = normalizeLocalImagePath(this.value);

            scope.update((state) => {
                const alterEgo = getActiveAlterEgo(state);

                if (!alterEgo) {
                    return;
                }

                alterEgo.avatarMode = ALTER_EGO_AVATAR_MODE.LOCAL_FILE;
                alterEgo.avatarLocalPath = value;
            }, {
                rerender: false,
                applyIdentity: false,
                deferTokenEstimate: true,
                deferSettingsActionState: true,
            });

            scope.scheduleVisualRefresh();
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${scope.id('LOCAL_FILE_VERIFY_ID')}`)
        .on(`click.${MODULE_NAME}`, `#${scope.id('LOCAL_FILE_VERIFY_ID')}`, async function onAlterEgoLocalFileVerifyClicked(event) {
            event.preventDefault();
            const value = normalizeLocalImagePath($(`#${scope.id('LOCAL_FILE_PATH_ID')}`).val());

            try {
                await probeImageReference(value);
                notify('success', 'Local image reference loaded successfully.');
            } catch (error) {
                notify('warning', error?.message ?? String(error));
            }
        });
}

export function bindUiHandlers() {
    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.SWAP_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.SWAP_ID}`, function onSwapChanged() {
            updateState((state) => {
                state.swapEnabled = Boolean(this.checked);
            }, { rerender: false, syncPromptManager: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.DELETE_ALL_TOP_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.DELETE_ALL_TOP_ID}`, deleteAllDynamicFieldsForCurrentCharacter);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.ADD_TOP_ID}, #${UI.ADD_BOTTOM_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.ADD_TOP_ID}, #${UI.ADD_BOTTOM_ID}`, function onAddField() {
            updateState((state) => {
                state.fields.push(createBlankFieldForTargetScope(TARGET_SCOPE.CHARACTER));
            }, { rerender: true });
        });

    bindAlterEgoHandlers();
    bindFieldEditHandlers();
    bindFieldActionHandlers();
    bindFieldReorderHandlers();
    bindImportExportHandlers();
}


// -----------------------------------------------------------------------------
// User Interface Events - Persona Top Bar Controls
// -----------------------------------------------------------------------------

export function deleteAllDynamicFieldsForCurrentPersona() {
    const personaId = getActivePersonaId();

    if (!personaId) {
        notify('warning', 'Select a persona before deleting Persona Dynamic Fields.');
        return;
    }

    const state = readPersonaState(personaId);

    if (!state.fields.length) {
        notify('info', 'There are no Persona Dynamic Fields to delete.');
        applyPersonaUiVisibility();
        return;
    }

    const confirmed = window.confirm(
        'Delete all Persona Dynamic Fields for this persona?\n\n' +
        'This only affects Aspect: Evolutia Persona Dynamic Fields. Native SillyTavern Persona Description is not changed.',
    );

    if (!confirmed) {
        return;
    }

    updatePersonaState((nextState) => {
        nextState.fields = [];
    }, { rerender: true });

    notify('success', 'Deleted all Persona Dynamic Fields for this persona.');
}

export function bindPersonaAlterEgoHandlers() {
    bindAlterEgoHandlers(TARGET_SCOPE.PERSONA);
}

export function bindPersonaUiHandlers() {
    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.PERSONA_SWAP_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.PERSONA_SWAP_ID}`, function onPersonaSwapChanged() {
            updatePersonaState((state) => {
                state.swapEnabled = Boolean(this.checked);
            }, { rerender: false, syncPromptManager: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.PERSONA_DELETE_ALL_TOP_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.PERSONA_DELETE_ALL_TOP_ID}`, deleteAllDynamicFieldsForCurrentPersona);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.PERSONA_ADD_TOP_ID}, #${UI.PERSONA_ADD_BOTTOM_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.PERSONA_ADD_TOP_ID}, #${UI.PERSONA_ADD_BOTTOM_ID}`, function onPersonaAddField() {
            updatePersonaState((state) => {
                state.fields.push(createBlankFieldForTargetScope(TARGET_SCOPE.PERSONA));
            }, { rerender: true });
        });

    bindPersonaAlterEgoHandlers();
    bindFieldEditHandlers();
    bindFieldActionHandlers();
    bindFieldReorderHandlers();
    bindImportExportHandlers();
}

// -----------------------------------------------------------------------------
// User Interface Events - Field Editing
// -----------------------------------------------------------------------------

export function bindFieldEditHandlers() {
    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-field-enabled')
        .on(`change.${MODULE_NAME}`, '.dsf-field-enabled', function onFieldEnabledChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);

                if (!field) {
                    return;
                }

                field.enabled = Boolean(this.checked);
            }, { rerender: false });
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-field-name')
        .on(`input.${MODULE_NAME}`, '.dsf-field-name', function onFieldNameChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.name = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-activating-triggers')
        .on(`input.${MODULE_NAME}`, '.dsf-activating-triggers', function onActivatingTriggersChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.activatingTriggers = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-enabling-triggers')
        .on(`input.${MODULE_NAME}`, '.dsf-enabling-triggers', function onEnablingTriggersChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.enablingTriggers = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-disabling-triggers')
        .on(`input.${MODULE_NAME}`, '.dsf-disabling-triggers', function onDisablingTriggersChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.disablingTriggers = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-scan-depth, .dsf-sticky-turns')
        .on(`change.${MODULE_NAME}`, '.dsf-scan-depth, .dsf-sticky-turns', function onFieldCountSettingChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);
            const isDepth = $(this).hasClass('dsf-scan-depth');
            const value = isDepth ? normalizeCount(this.value, 1, 1, 20) : normalizeCount(this.value, 0, 0, 50);
            this.value = String(value);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);

                if (field) {
                    field[isDepth ? 'scanDepth' : 'stickyTurns'] = value;
                }
            }, { rerender: false });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-keyword-matching')
        .on(`change.${MODULE_NAME}`, '.dsf-keyword-matching', function onKeywordMatchingChanged() {
            const matching = normalizeKeywordMatching(this.value);
            const target = String($(this).attr('data-dsf-matching-target') || 'field');
            const targetScope = getFieldTargetScope($(this));

            if (target === 'alter-ego') {
                updateStateForTargetScope(targetScope, (state) => {
                    const alterEgo = getActiveAlterEgo(state);
                    if (alterEgo) alterEgo.keywordMatching = matching;
                }, { rerender: false });
                return;
            }

            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.keywordMatching = matching;
            }, { rerender: false });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-activating-keyword-mode')
        .on(`change.${MODULE_NAME}`, '.dsf-activating-keyword-mode', function onActivatingKeywordModeChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.activatingKeywordMode = normalizeKeywordMode(this.value);
            }, { rerender: false });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-enabling-keyword-mode')
        .on(`change.${MODULE_NAME}`, '.dsf-enabling-keyword-mode', function onEnablingKeywordModeChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.enablingKeywordMode = normalizeKeywordMode(this.value);
            }, { rerender: false });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-disabling-keyword-mode')
        .on(`change.${MODULE_NAME}`, '.dsf-disabling-keyword-mode', function onDisablingKeywordModeChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.disablingKeywordMode = normalizeKeywordMode(this.value);
            }, { rerender: false });
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-trigger-source')
        .on(`change.${MODULE_NAME}`, '.dsf-trigger-source', function onTriggerSourceChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);
            const selectedSources = $field
                .find('.dsf-trigger-source:checked')
                .map(function mapSource() {
                    return this.value;
                })
                .get();

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.triggerSources = normalizeTriggerSources(selectedSources);
            }, { rerender: false });
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-trigger-action-instruction')
        .on(`input.${MODULE_NAME}`, '.dsf-trigger-action-instruction', function onTriggerActionInstructionChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            if (targetScope === TARGET_SCOPE.PERSONA) {
                return;
            }

            updateState((state) => {
                const field = findField(state, fieldId);
                if (field) field.triggerActionInstruction = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });

    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-content')
        .on(`input.${MODULE_NAME}`, '.dsf-content', function onContentChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const field = findField(state, fieldId);
                if (field) field.content = this.value;
            }, FIELD_EDIT_INPUT_UPDATE_OPTIONS);
        });
}

// -----------------------------------------------------------------------------
// User Interface Events - Field Actions
// -----------------------------------------------------------------------------

export function bindFieldActionHandlers() {
    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-delete-field')
        .on(`click.${MODULE_NAME}`, '.dsf-delete-field', function onDeleteField() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                state.fields = state.fields.filter((field) => String(field.id) !== fieldId);
            }, { rerender: true });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-duplicate-field')
        .on(`click.${MODULE_NAME}`, '.dsf-duplicate-field', function onDuplicateField() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            updateStateForTargetScope(targetScope, (state) => {
                const index = state.fields.findIndex((field) => String(field.id) === fieldId);
                if (index === -1) return;

                const copy = normalizeFieldForTargetScope({
                    ...state.fields[index],
                    id: makeId(),
                    name: `${state.fields[index].name || 'Field'} Copy`,
                }, targetScope);

                state.fields.splice(index + 1, 0, copy);
            }, { rerender: true });
        });
}

// -----------------------------------------------------------------------------
// User Interface Events - Field Reordering
// -----------------------------------------------------------------------------

export function moveFieldToOrder(state, fieldId, requestedOrder) {
    const currentIndex = state.fields.findIndex((field) => String(field.id) === String(fieldId));

    if (currentIndex === -1) {
        return;
    }

    const boundedOrder = Math.max(1, Math.min(Number(requestedOrder) || 1, state.fields.length));
    const [field] = state.fields.splice(currentIndex, 1);

    state.fields.splice(boundedOrder - 1, 0, field);
}

export function commitDomFieldOrder(targetScope = TARGET_SCOPE.CHARACTER) {
    const orderedIds = getCurrentPanelFieldOrder(targetScope);

    if (!orderedIds.length) {
        return;
    }

    updateStateForTargetScope(targetScope, (state) => {
        const fieldsById = new Map(state.fields.map((field) => [String(field.id), field]));
        const orderedFields = orderedIds
            .map((fieldId) => fieldsById.get(String(fieldId)))
            .filter(Boolean);

        if (orderedFields.length === state.fields.length) {
            state.fields = orderedFields;
        }
    }, { rerender: true });
}

export function getFieldDragScrollParent(element) {
    let parent = element?.parentElement;

    while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = getComputedStyle(parent);
        const overflowY = `${style.overflowY} ${style.overflow}`;

        if (/(auto|scroll)/i.test(overflowY) && parent.scrollHeight > parent.clientHeight) {
            return parent;
        }

        parent = parent.parentElement;
    }

    return document.scrollingElement || document.documentElement;
}

export function getFieldDragScrollBounds(scrollElement) {
    if (
        scrollElement === document.scrollingElement ||
        scrollElement === document.documentElement ||
        scrollElement === document.body
    ) {
        return {
            top: 0,
            bottom: window.innerHeight,
        };
    }

    const rect = scrollElement.getBoundingClientRect();

    return {
        top: rect.top,
        bottom: rect.bottom,
    };
}

export function getFieldDragAutoScrollAmount(scrollElement, clientY) {
    const bounds = getFieldDragScrollBounds(scrollElement);
    const topDistance = clientY - bounds.top;
    const bottomDistance = bounds.bottom - clientY;

    if (topDistance >= 0 && topDistance < FIELD_DRAG_AUTOSCROLL_MARGIN) {
        const strength = 1 - (topDistance / FIELD_DRAG_AUTOSCROLL_MARGIN);
        return -Math.ceil(strength * FIELD_DRAG_AUTOSCROLL_MAX_SPEED);
    }

    if (bottomDistance >= 0 && bottomDistance < FIELD_DRAG_AUTOSCROLL_MARGIN) {
        const strength = 1 - (bottomDistance / FIELD_DRAG_AUTOSCROLL_MARGIN);
        return Math.ceil(strength * FIELD_DRAG_AUTOSCROLL_MAX_SPEED);
    }

    return 0;
}

export function scrollFieldDragContainer(scrollElement, amount) {
    if (!amount) {
        return;
    }

    if (
        scrollElement === document.scrollingElement ||
        scrollElement === document.documentElement ||
        scrollElement === document.body
    ) {
        window.scrollBy(0, amount);
        return;
    }

    scrollElement.scrollTop += amount;
}

export function moveDraggedFieldAtPoint(clientX, clientY) {
    if (!fieldPointerDrag?.fieldElement) {
        return;
    }

    const elementAtPoint = document.elementFromPoint(clientX, clientY);
    const targetField = elementAtPoint?.closest?.('.dsf-field');

    if (!targetField || targetField === fieldPointerDrag.fieldElement) {
        return;
    }

    const targetScope = String(targetField.getAttribute('data-target-scope') || TARGET_SCOPE.CHARACTER);

    if (targetScope !== fieldPointerDrag.targetScope) {
        return;
    }

    const rect = targetField.getBoundingClientRect();
    const placeAfter = clientY > rect.top + rect.height / 2;

    if (placeAfter) {
        targetField.after(fieldPointerDrag.fieldElement);
    } else {
        targetField.before(fieldPointerDrag.fieldElement);
    }
}

export function startFieldDragAutoScroll() {
    if (fieldDragAutoScrollFrame) {
        return;
    }

    const tick = () => {
        if (!fieldPointerDrag) {
            fieldDragAutoScrollFrame = null;
            return;
        }

        const amount = getFieldDragAutoScrollAmount(
            fieldPointerDrag.scrollElement,
            fieldPointerDrag.lastClientY,
        );

        if (amount) {
            scrollFieldDragContainer(fieldPointerDrag.scrollElement, amount);
            moveDraggedFieldAtPoint(fieldPointerDrag.lastClientX, fieldPointerDrag.lastClientY);
        }

        fieldDragAutoScrollFrame = requestAnimationFrame(tick);
    };

    fieldDragAutoScrollFrame = requestAnimationFrame(tick);
}

export function stopFieldDragAutoScroll() {
    if (fieldDragAutoScrollFrame) {
        cancelAnimationFrame(fieldDragAutoScrollFrame);
        fieldDragAutoScrollFrame = null;
    }
}

export function bindFieldReorderHandlers() {
    $(document)
        .off(`input.${MODULE_NAME}`, '.dsf-field-order')
        .on(`input.${MODULE_NAME}`, '.dsf-field-order', function onPositionInputChanged() {
            this.value = String(this.value || '').replace(/[^\d]/g, '');
            syncPositionInputWidth(this);
        });

    $(document)
        .off(`change.${MODULE_NAME}`, '.dsf-field-order')
        .on(`change.${MODULE_NAME}`, '.dsf-field-order', function onOrderChanged() {
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);
            const cleanedValue = String(this.value || '').replace(/[^\d]/g, '');
            const requestedOrder = Number(cleanedValue || 1);

            this.value = String(requestedOrder);
            syncPositionInputWidth(this);

            updateStateForTargetScope(targetScope, (state) => {
                moveFieldToOrder(state, fieldId, requestedOrder);
            }, { rerender: true });
        });

    $(document)
        .off(`pointerdown.${MODULE_NAME}`, '.dsf-drag-handle')
        .on(`pointerdown.${MODULE_NAME}`, '.dsf-drag-handle', function onPointerDown(event) {
            const originalEvent = event.originalEvent;
            const $field = $(this).closest('.dsf-field');
            const fieldId = String($field.attr('data-field-id') || $field.data('field-id') || '');
            const targetScope = getFieldTargetScope($field);

            if (!fieldId || !originalEvent) {
                return;
            }

            event.preventDefault();

            fieldPointerDrag = {
                fieldId,
                targetScope,
                pointerId: originalEvent.pointerId,
                fieldElement: $field[0],
                scrollElement: getFieldDragScrollParent($field[0]),
                lastClientX: originalEvent.clientX,
                lastClientY: originalEvent.clientY,
            };

            $field.addClass('dsf-dragging');

            try {
                this.setPointerCapture?.(originalEvent.pointerId);
            } catch {
                // Some mobile browsers do not allow capture from delegated handlers.
            }

            startFieldDragAutoScroll();
        });

    $(document)
        .off(`pointermove.${MODULE_NAME}`)
        .on(`pointermove.${MODULE_NAME}`, function onPointerMove(event) {
            if (!fieldPointerDrag) {
                return;
            }

            const originalEvent = event.originalEvent;

            if (!originalEvent || originalEvent.pointerId !== fieldPointerDrag.pointerId) {
                return;
            }

            event.preventDefault();

            fieldPointerDrag.lastClientX = originalEvent.clientX;
            fieldPointerDrag.lastClientY = originalEvent.clientY;

            moveDraggedFieldAtPoint(originalEvent.clientX, originalEvent.clientY);
            startFieldDragAutoScroll();
        });

    $(document)
        .off(`pointerup.${MODULE_NAME} pointercancel.${MODULE_NAME}`)
        .on(`pointerup.${MODULE_NAME} pointercancel.${MODULE_NAME}`, function onPointerUp(event) {
            if (!fieldPointerDrag) {
                return;
            }

            const originalEvent = event.originalEvent;

            if (originalEvent && originalEvent.pointerId !== fieldPointerDrag.pointerId) {
                return;
            }

            const targetScope = fieldPointerDrag.targetScope;

            $('.dsf-field').removeClass('dsf-dragging');
            stopFieldDragAutoScroll();
            fieldPointerDrag = null;
            commitDomFieldOrder(targetScope);
        });
}

// -----------------------------------------------------------------------------
// User Interface Events - Import / Export and Field Menus
// -----------------------------------------------------------------------------

export function closeFieldMenus() {
    $('.dsf-keyword-triggers-menu, .dsf-trigger-actions-menu, .dsf-triggered-by-menu')
        .removeClass('dsf-menu-open')
        .css({
            '--dsf-menu-left': '',
            '--dsf-menu-top': '',
        });
}

export function closeImportExportMenus() {
    $(`#${UI.IMPORT_MENU_ID}, #${UI.EXPORT_MENU_ID}, #${UI.PERSONA_IMPORT_MENU_ID}, #${UI.PERSONA_EXPORT_MENU_ID}`)
        .removeClass('dsf-menu-open');

    closeFieldMenus();
}

export function toggleMenu(menuId) {
    const $menu = $(`#${menuId}`);
    const wasOpen = $menu.hasClass('dsf-menu-open');

    closeImportExportMenus();

    if (!wasOpen) {
        $menu.addClass('dsf-menu-open');
    }
}

export function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function positionFloatingFieldMenuInViewport($menu, button) {
    const menuElement = $menu?.[0];

    if (!menuElement || !button) {
        return;
    }

    const margin = 8;
    const buttonRect = button.getBoundingClientRect();

    $menu.css({
        '--dsf-menu-left': `${margin}px`,
        '--dsf-menu-top': `${margin}px`,
    });

    requestAnimationFrame(() => {
        if (!$menu.hasClass('dsf-menu-open')) {
            return;
        }

        const menuWidth = Math.min(
            menuElement.offsetWidth || 210,
            window.innerWidth - (margin * 2),
        );
        const menuHeight = Math.min(
            menuElement.offsetHeight || 0,
            window.innerHeight - (margin * 2),
        );

        const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - menuHeight - margin);

        const left = clampNumber(buttonRect.left, margin, maxLeft);
        let top = buttonRect.bottom + 4;

        if (top > maxTop && buttonRect.top - menuHeight - 4 >= margin) {
            top = buttonRect.top - menuHeight - 4;
        }

        top = clampNumber(top, margin, maxTop);

        $menu.css({
            '--dsf-menu-left': `${left}px`,
            '--dsf-menu-top': `${top}px`,
        });
    });
}

export function toggleSiblingFieldMenu(button, menuSelector) {
    const $menu = $(button).siblings(menuSelector);
    const wasOpen = $menu.hasClass('dsf-menu-open');

    closeImportExportMenus();

    if (!wasOpen) {
        $menu.addClass('dsf-menu-open');
        positionFloatingFieldMenuInViewport($menu, button);
    }
}

export function getDynamicFieldsOpenMenuSelector() {
    return [
        `#${UI.IMPORT_MENU_ID}.dsf-menu-open`,
        `#${UI.EXPORT_MENU_ID}.dsf-menu-open`,
        `#${UI.PERSONA_IMPORT_MENU_ID}.dsf-menu-open`,
        `#${UI.PERSONA_EXPORT_MENU_ID}.dsf-menu-open`,
        '.dsf-keyword-triggers-menu.dsf-menu-open',
        '.dsf-trigger-actions-menu.dsf-menu-open',
        '.dsf-triggered-by-menu.dsf-menu-open',
    ].join(', ');
}

export function isDynamicFieldsMenuTarget(target) {
    if (!(target instanceof Element)) {
        return false;
    }

    return Boolean(
        target.closest([
            '.dsf-menu-wrap',
            '.dsf-menu',
            '.dsf-keyword-triggers-wrap',
            '.dsf-trigger-actions-wrap',
            '.dsf-triggered-by-wrap',
            '.dsf-keyword-triggers-menu',
            '.dsf-trigger-actions-menu',
            '.dsf-triggered-by-menu',
            '.dsf-keyword-triggers-button',
            '.dsf-trigger-actions-button',
            '.dsf-triggered-by-button',
            '.dsf-menu-close',
            '.dsf-menu-close-row',
            '.dsf-menu-open',
        ].join(', ')),
    );
}

export function shouldCloseDynamicFieldsMenusFromEvent(event) {
    const openMenus = Array.from(document.querySelectorAll(getDynamicFieldsOpenMenuSelector()));

    if (!openMenus.length) {
        return false;
    }

    const target = event?.target instanceof Element ? event.target : null;

    if (!target) {
        return false;
    }

    const path = typeof event.composedPath === 'function'
        ? event.composedPath()
        : [];

    const touchedMenuSurface = path.some((node) => {
        if (!(node instanceof Element)) {
            return false;
        }

        return isDynamicFieldsMenuTarget(node);
    });

    if (touchedMenuSurface || isDynamicFieldsMenuTarget(target)) {
        return false;
    }

    return true;
}

export function stopMenuEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

export function bindImportExportHandlers() {
    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-keyword-triggers-button')
        .on(`click.${MODULE_NAME}`, '.dsf-keyword-triggers-button', function onKeywordTriggersClicked(event) {
            stopMenuEvent(event);
            toggleSiblingFieldMenu(this, '.dsf-keyword-triggers-menu');
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-trigger-actions-button')
        .on(`click.${MODULE_NAME}`, '.dsf-trigger-actions-button', function onTriggerActionsClicked(event) {
            stopMenuEvent(event);
            toggleSiblingFieldMenu(this, '.dsf-trigger-actions-menu');
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-triggered-by-button')
        .on(`click.${MODULE_NAME}`, '.dsf-triggered-by-button', function onTriggerSourcesClicked(event) {
            stopMenuEvent(event);
            toggleSiblingFieldMenu(this, '.dsf-triggered-by-menu');
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-keyword-triggers-menu, .dsf-trigger-actions-menu, .dsf-triggered-by-menu')
        .on(`click.${MODULE_NAME}`, '.dsf-keyword-triggers-menu, .dsf-trigger-actions-menu, .dsf-triggered-by-menu', function onFieldMenuClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-menu-close')
        .on(`click.${MODULE_NAME}`, '.dsf-menu-close', function onMenuCloseClicked(event) {
            stopMenuEvent(event);
            $(this).closest('.dsf-menu, .dsf-keyword-triggers-menu, .dsf-trigger-actions-menu, .dsf-triggered-by-menu')
                .removeClass('dsf-menu-open')
                .css({
                    '--dsf-menu-left': '',
                    '--dsf-menu-top': '',
                });
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.IMPORT_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.IMPORT_ID}`, function onImportClicked(event) {
            stopMenuEvent(event);
            toggleMenu(UI.IMPORT_MENU_ID);
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.EXPORT_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.EXPORT_ID}`, function onExportClicked(event) {
            stopMenuEvent(event);
            toggleMenu(UI.EXPORT_MENU_ID);
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.PERSONA_IMPORT_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.PERSONA_IMPORT_ID}`, function onPersonaImportClicked(event) {
            stopMenuEvent(event);
            toggleMenu(UI.PERSONA_IMPORT_MENU_ID);
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.PERSONA_EXPORT_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.PERSONA_EXPORT_ID}`, function onPersonaExportClicked(event) {
            stopMenuEvent(event);
            toggleMenu(UI.PERSONA_EXPORT_MENU_ID);
        });

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.IMPORT_MENU_ID}, #${UI.EXPORT_MENU_ID}, #${UI.PERSONA_IMPORT_MENU_ID}, #${UI.PERSONA_EXPORT_MENU_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.IMPORT_MENU_ID}, #${UI.EXPORT_MENU_ID}, #${UI.PERSONA_IMPORT_MENU_ID}, #${UI.PERSONA_EXPORT_MENU_ID}`, function onMenuClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '[data-dsf-import]')
        .on(`click.${MODULE_NAME}`, '[data-dsf-import]', function onImportActionClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();

            const action = String($(this).data('dsf-import') || '');
            closeImportExportMenus();

            if (action === IMPORT_SOURCE.CHARACTER_CARD) {
                importDynamicFieldsFromCharacterCardFile();
            } else if (action === IMPORT_SOURCE.NATIVE_FIELDS) {
                importDynamicFieldsFromNativeFields();
            } else if (action === IMPORT_SOURCE.FILE_JSON) {
                importDynamicFieldsFromFileJson();
            } else if (action === IMPORT_SOURCE.CLIPBOARD_JSON) {
                importDynamicFieldsFromClipboardJson();
            }
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '[data-dsf-export]')
        .on(`click.${MODULE_NAME}`, '[data-dsf-export]', function onExportActionClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();

            const action = String($(this).data('dsf-export') || '');
            closeImportExportMenus();

            if (action === EXPORT_TARGET.FILE_JSON) {
                exportDynamicFieldsToFileJson();
            } else if (action === EXPORT_TARGET.CLIPBOARD_JSON) {
                exportDynamicFieldsToClipboardJson();
            }
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '[data-dsf-persona-import]')
        .on(`click.${MODULE_NAME}`, '[data-dsf-persona-import]', function onPersonaImportActionClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();

            const action = String($(this).data('dsf-persona-import') || '');
            closeImportExportMenus();

            if (action === IMPORT_SOURCE.PERSONA_DESCRIPTION) {
                importPersonaDynamicFieldsFromPersonaDescription();
            } else if (action === IMPORT_SOURCE.FILE_JSON) {
                importPersonaDynamicFieldsFromFileJson();
            } else if (action === IMPORT_SOURCE.CLIPBOARD_JSON) {
                importPersonaDynamicFieldsFromClipboardJson();
            }
        });

    $(document)
        .off(`click.${MODULE_NAME}`, '[data-dsf-persona-export]')
        .on(`click.${MODULE_NAME}`, '[data-dsf-persona-export]', function onPersonaExportActionClicked(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();

            const action = String($(this).data('dsf-persona-export') || '');
            closeImportExportMenus();

            if (action === EXPORT_TARGET.FILE_JSON) {
                exportPersonaDynamicFieldsToFileJson();
            } else if (action === EXPORT_TARGET.CLIPBOARD_JSON) {
                exportPersonaDynamicFieldsToClipboardJson();
            }
        });

    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.CHARACTER_CARD_IMPORT_FILE_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.CHARACTER_CARD_IMPORT_FILE_ID}`, handleCharacterCardImportFileSelected);

    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.DYNAMIC_FIELDS_IMPORT_FILE_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.DYNAMIC_FIELDS_IMPORT_FILE_ID}`, handleDynamicFieldsImportFileSelected);

    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID}`, handlePersonaDynamicFieldsImportFileSelected);

    $(document)
        .off(`pointerdown.${MODULE_NAME}.menus click.${MODULE_NAME}.menus`)
        .on(`pointerdown.${MODULE_NAME}.menus click.${MODULE_NAME}.menus`, function onDocumentPressedForMenus(event) {
            if (!shouldCloseDynamicFieldsMenusFromEvent(event)) {
                return;
            }

            closeImportExportMenus();
        });

    $(window)
        .off(`resize.${MODULE_NAME}.menus scroll.${MODULE_NAME}.menus`);
}
