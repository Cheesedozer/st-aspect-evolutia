// Aspect: Evolutia — settings-drawer.js (split from the former single index.js).
import { getProposalProfiles, getProposalSettings, saveProposalSettings } from './proposals.js';
import { normalizeCount } from './model.js';
import {
    applyActiveAlterEgoNameToSillyTavern,
    refreshActiveAlterEgoVisualIdentity,
} from './alter-ego-identity.js';
import {
    DEFAULT_MANIFEST_META,
    FIELD_EDIT_SETTINGS_ACTION_DEBOUNCE_MS,
    MODULE_NAME,
    UI,
    personaStateCache,
    stateCache,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getAllCharacterIds,
    getAllPersonaIds,
    getCurrentCharactersButtonLabel,
    getCurrentChatCharacterIds,
    getCurrentPersonaButtonLabel,
    getCurrentPersonaIds,
    getExtensionSettingsRoot,
    isCurrentGroupChatOpen,
} from './context.js';
import {
    checkStoryStringForTextCompletion,
    restoreDescriptionMacroSwaps,
    updateTextCompletionNote,
} from './macro-replacement.js';
import {
    areCharactersOutOfBox,
    areFieldsRemovedForCharacters,
    areFieldsRemovedForPersonas,
    arePersonasOutOfBox,
    createEmptyFieldsState,
    createEmptyPersonaFieldsState,
    createOutOfBoxPersonaState,
    createOutOfBoxState,
} from './model.js';
import {
    cachePersonaState,
    cacheState,
    savePersonaStateNow,
    saveStateNow,
} from './persistence.js';
import {
    syncPromptManagerForPersonaState,
    syncPromptManagerForState,
} from './prompt-manager.js';
import {
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
    escapeAttribute,
    escapeTextarea,
    getAuthorName,
    notify,
} from './utils.js';

// Module state (written only by this module).
export let settingsActionStateTimer = null;
export let manifestMeta = { ...DEFAULT_MANIFEST_META };


// ============================================================================
// Section 13. Extensions Drawer Settings
// ============================================================================
// Purpose:
// - Own the Aspect: Evolutia settings drawer in SillyTavern's Extensions tab.
// ============================================================================

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Manifest Metadata
// -----------------------------------------------------------------------------

export async function loadManifestMetadata() {
    try {
        const manifestUrl = new URL('../manifest.json', import.meta.url);
        const response = await fetch(manifestUrl);

        if (!response.ok) {
            throw new Error(`Manifest request failed: ${response.status}`);
        }

        const manifest = await response.json();
        const version = String(manifest.version || DEFAULT_MANIFEST_META.version).trim();
        const author = getAuthorName(manifest.author).trim() || DEFAULT_MANIFEST_META.author;

        manifestMeta = {
            version,
            author,
        };

        renderSettingsFooter();
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Failed to load manifest metadata:`, error);

        manifestMeta = {
            ...DEFAULT_MANIFEST_META,
        };

        renderSettingsFooter();
    }
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Character Actions
// -----------------------------------------------------------------------------

export async function removeAllFieldsForAllCharacters() {
    const characterIds = getAllCharacterIds();

    if (!characterIds.length) {
        notify('warning', 'No characters were found in Character Management.');
        updateSettingsActionState();
        return;
    }

    if (areFieldsRemovedForCharacters(characterIds)) {
        notify('info', 'All Character Dynamic Fields are already removed from every character.');
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        'Remove all Character Dynamic Fields from all characters in Character Management?\n\n' +
        'This keeps each character’s Character Dynamic Fields toggle as it is, but removes every Character Dynamic Field from every character.',
    );

    if (!confirmed) {
        return;
    }

    for (const characterId of characterIds) {
        const nextState = createEmptyFieldsState(characterId);

        cacheState(characterId, nextState);
        await saveStateNow(characterId, nextState);
    }

    stateCache.clear();

    renderPanel();
    applyUiVisibility();
    updateTokenEstimate();
    updateSettingsActionState();

    notify('success', `Removed all Character Dynamic Fields from ${characterIds.length} character(s).`);
}

export async function removeAllFieldsForCurrentChatCharacters() {
    const characterIds = getCurrentChatCharacterIds();
    const isGroup = isCurrentGroupChatOpen();

    if (!characterIds.length) {
        notify('warning', 'Open a character or group chat before removing current Character Dynamic Fields.');
        updateSettingsActionState();
        return;
    }

    if (areFieldsRemovedForCharacters(characterIds)) {
        notify(
            'info',
            isGroup
                ? 'All Character Dynamic Fields are already removed from the current characters.'
                : 'All Character Dynamic Fields are already removed from the current character.',
        );
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        isGroup
            ? 'Remove all Character Dynamic Fields from every character in the currently open group chat?\n\nThis keeps each character’s Character Dynamic Fields toggle as they are.'
            : 'Remove all Character Dynamic Fields from the character in the currently open chat?\n\nThis keeps the character’s Character Dynamic Fields toggle as it is.',
    );

    if (!confirmed) {
        return;
    }

    for (const characterId of characterIds) {
        const nextState = createEmptyFieldsState(characterId);

        cacheState(characterId, nextState);
        await saveStateNow(characterId, nextState);
    }

    stateCache.clear();

    renderPanel();
    applyUiVisibility();
    updateTokenEstimate();
    updateSettingsActionState();

    notify(
        'success',
        isGroup
            ? `Removed all Character Dynamic Fields from ${characterIds.length} current character(s).`
            : 'Removed all Character Dynamic Fields from the current character.',
    );
}

export async function resetAllCharactersToOutOfBox() {
    const characterIds = getAllCharacterIds();

    if (!characterIds.length) {
        notify('warning', 'No characters were found in Character Management.');
        updateSettingsActionState();
        return;
    }

    if (areCharactersOutOfBox(characterIds)) {
        notify('info', 'Aspect: Evolutia is already reset for every character.');
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        'Reset Aspect: Evolutia extension state for all characters in Character Management?\n\n' +
        'This will turn Character Dynamic Fields off, reset Alter Egos to each character’s base identity, and restore the default Background, Personality, and Appearance fields for every character.',
    );

    if (!confirmed) {
        return;
    }

    for (const characterId of characterIds) {
        const outOfBoxState = createOutOfBoxState(characterId);

        cacheState(characterId, outOfBoxState);
        await saveStateNow(characterId, outOfBoxState);
    }

    stateCache.clear();

    await syncPromptManagerForState(createOutOfBoxState(getActiveCharacterId()), { restoreNative: true });

    renderPanel();
    applyUiVisibility();
    applyActiveAlterEgoNameToSillyTavern();
    refreshActiveAlterEgoVisualIdentity();
    updateTokenEstimate();
    updateSettingsActionState();

    notify('success', `Reset Aspect: Evolutia extension state for ${characterIds.length} character(s).`);
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Persona Actions
// -----------------------------------------------------------------------------

export async function removeAllFieldsForAllPersonas() {
    const personaIds = getAllPersonaIds();

    if (!personaIds.length) {
        notify('warning', 'No personas were found in Persona Management.');
        updateSettingsActionState();
        return;
    }

    if (areFieldsRemovedForPersonas(personaIds)) {
        notify('info', 'All Persona Dynamic Fields are already removed from every persona.');
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        'Remove all Persona Dynamic Fields from all personas?\n\n' +
        'This keeps each persona’s Persona Dynamic Fields toggle as it is, but removes every Persona Dynamic Field from every persona.',
    );

    if (!confirmed) {
        return;
    }

    for (const personaId of personaIds) {
        const nextState = createEmptyPersonaFieldsState(personaId);

        cachePersonaState(personaId, nextState);
        await savePersonaStateNow(personaId, nextState);
    }

    personaStateCache.clear();

    renderPersonaPanel();
    applyPersonaUiVisibility();
    updatePersonaTokenEstimate();
    updateSettingsActionState();

    notify('success', `Removed all Persona Dynamic Fields from ${personaIds.length} persona(s).`);
}

export async function removeAllFieldsForCurrentPersona() {
    const personaIds = getCurrentPersonaIds();

    if (!personaIds.length) {
        notify('warning', 'Select a persona before removing current Persona Dynamic Fields.');
        updateSettingsActionState();
        return;
    }

    if (areFieldsRemovedForPersonas(personaIds)) {
        notify('info', 'All Persona Dynamic Fields are already removed from the current persona.');
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        'Remove all Persona Dynamic Fields from the current persona?\n\n' +
        'This keeps the current persona’s Persona Dynamic Fields toggle as it is.',
    );

    if (!confirmed) {
        return;
    }

    for (const personaId of personaIds) {
        const nextState = createEmptyPersonaFieldsState(personaId);

        cachePersonaState(personaId, nextState);
        await savePersonaStateNow(personaId, nextState);
    }

    personaStateCache.clear();

    renderPersonaPanel();
    applyPersonaUiVisibility();
    updatePersonaTokenEstimate();
    updateSettingsActionState();

    notify('success', 'Removed all Persona Dynamic Fields from the current persona.');
}

export async function resetAllPersonasToOutOfBox() {
    const personaIds = getAllPersonaIds();

    if (!personaIds.length) {
        notify('warning', 'No personas were found in Persona Management.');
        updateSettingsActionState();
        return;
    }

    if (arePersonasOutOfBox(personaIds)) {
        notify('info', 'Aspect: Evolutia is already reset for every persona.');
        updateSettingsActionState();
        return;
    }

    const confirmed = window.confirm(
        'Reset Aspect: Evolutia extension state for all personas?\n\n' +
        'This will turn Persona Dynamic Fields off, reset Alter Egos to each persona’s base identity, and restore the default Background, Personality, and Appearance fields for every persona.',
    );

    if (!confirmed) {
        return;
    }

    for (const personaId of personaIds) {
        const outOfBoxState = createOutOfBoxPersonaState(personaId);

        cachePersonaState(personaId, outOfBoxState);
        await savePersonaStateNow(personaId, outOfBoxState);
    }

    personaStateCache.clear();

    await syncPromptManagerForPersonaState(createOutOfBoxPersonaState(getActivePersonaId()), { restoreNative: true });

    renderPersonaPanel();
    applyPersonaUiVisibility();
    updatePersonaTokenEstimate();
    updateSettingsActionState();

    notify('success', `Reset Aspect: Evolutia extension state for ${personaIds.length} persona(s).`);
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Rendering Helpers
// -----------------------------------------------------------------------------

export function renderSettingsFooter() {
    const $version = $(`#${UI.SETTINGS_VERSION_ID}`);
    const $author = $(`#${UI.SETTINGS_AUTHOR_ID}`);

    if ($version.length) {
        $version.text(`Version ${manifestMeta.version}`);
    }

    if ($author.length) {
        $author.text(manifestMeta.author);
    }
}

export function setSettingsButtonState(buttonId, { text, disabled, title }) {
    const $button = $(`#${buttonId}`);

    if (!$button.length) {
        return;
    }

    if (text !== undefined) {
        $button.text(text);
    }

    $button
        .prop('disabled', Boolean(disabled))
        .toggleClass('disabled', Boolean(disabled))
        .attr('title', title || '');
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Action State
// -----------------------------------------------------------------------------

export function updateCharacterSettingsActionState() {
    const allCharacterIds = getAllCharacterIds();
    const currentCharacterIds = getCurrentChatCharacterIds();

    const allFieldsRemoved = areFieldsRemovedForCharacters(allCharacterIds);
    const currentFieldsRemoved = areFieldsRemovedForCharacters(currentCharacterIds);
    const allOutOfBox = areCharactersOutOfBox(allCharacterIds);

    const noAllCharacters = allCharacterIds.length === 0;
    const noCurrentCharacters = currentCharacterIds.length === 0;
    const isGroup = isCurrentGroupChatOpen();

    setSettingsButtonState(UI.SETTINGS_CHARACTER_REMOVE_FIELDS_ID, {
        disabled: noAllCharacters || allFieldsRemoved,
        title: noAllCharacters
            ? 'No characters were found in Character Management.'
            : allFieldsRemoved
                ? 'All Character Dynamic Fields are already removed from every character in Character Management.'
                : 'Remove all Character Dynamic Fields from every character in Character Management. This keeps each character’s Character Dynamic Fields toggle as it is.',
    });

    setSettingsButtonState(UI.SETTINGS_CHARACTER_REMOVE_CURRENT_FIELDS_ID, {
        text: getCurrentCharactersButtonLabel(),
        disabled: noCurrentCharacters || currentFieldsRemoved,
        title: noCurrentCharacters
            ? 'Open a character or group chat to use this option.'
            : currentFieldsRemoved
                ? (
                    isGroup
                        ? 'All Character Dynamic Fields are already removed from the current characters.'
                        : 'All Character Dynamic Fields are already removed from the current character.'
                )
                : (
                    isGroup
                        ? 'Remove all Character Dynamic Fields from every character in the currently open group chat. This keeps each character’s Character Dynamic Fields toggle as they are.'
                        : 'Remove all Character Dynamic Fields from the character in the currently open chat. This keeps the character’s Character Dynamic Fields toggle as it is.'
                ),
    });

    setSettingsButtonState(UI.SETTINGS_CHARACTER_RESET_EXTENSION_ID, {
        text: 'Reset Extension (Characters)',
        disabled: noAllCharacters || allOutOfBox,
        title: noAllCharacters
            ? 'No characters were found in Character Management.'
            : allOutOfBox
                ? 'Aspect: Evolutia is already reset for every character in Character Management.'
                : 'Reset Aspect: Evolutia extension state for every character in Character Management. Character Dynamic Fields will be turned off, Alter Egos will reset to each character’s base identity, and the default Background, Personality, and Appearance fields will be restored.',
    });
}

export function updatePersonaSettingsActionState() {
    const allPersonaIds = getAllPersonaIds();
    const currentPersonaIds = getCurrentPersonaIds();

    const allFieldsRemoved = areFieldsRemovedForPersonas(allPersonaIds);
    const currentFieldsRemoved = areFieldsRemovedForPersonas(currentPersonaIds);
    const allOutOfBox = arePersonasOutOfBox(allPersonaIds);

    const noAllPersonas = allPersonaIds.length === 0;
    const noCurrentPersona = currentPersonaIds.length === 0;

    setSettingsButtonState(UI.SETTINGS_PERSONA_REMOVE_FIELDS_ID, {
        disabled: noAllPersonas || allFieldsRemoved,
        title: noAllPersonas
            ? 'No personas were found in Persona Management.'
            : allFieldsRemoved
                ? 'All Persona Dynamic Fields are already removed from every persona.'
                : 'Remove all Persona Dynamic Fields from every persona. This keeps each persona’s Persona Dynamic Fields toggle as it is.',
    });

    setSettingsButtonState(UI.SETTINGS_PERSONA_REMOVE_CURRENT_FIELDS_ID, {
        text: getCurrentPersonaButtonLabel(),
        disabled: noCurrentPersona || currentFieldsRemoved,
        title: noCurrentPersona
            ? 'Select a persona to use this option.'
            : currentFieldsRemoved
                ? 'All Persona Dynamic Fields are already removed from the current persona.'
                : 'Remove all Persona Dynamic Fields from the current persona. This keeps the current persona’s Persona Dynamic Fields toggle as it is.',
    });

    setSettingsButtonState(UI.SETTINGS_PERSONA_RESET_EXTENSION_ID, {
        text: 'Reset Extension (Personas)',
        disabled: noAllPersonas || allOutOfBox,
        title: noAllPersonas
            ? 'No personas were found in Persona Management.'
            : allOutOfBox
                ? 'Aspect: Evolutia is already reset for every persona.'
                : 'Reset Aspect: Evolutia extension state for every persona. Persona Dynamic Fields will be turned off, Alter Egos will reset to each persona’s base identity, and the default Background, Personality, and Appearance fields will be restored.',
    });
}


export function scheduleSettingsActionStateUpdate() {
    clearTimeout(settingsActionStateTimer);

    settingsActionStateTimer = setTimeout(() => {
        settingsActionStateTimer = null;
        updateSettingsActionState();
    }, FIELD_EDIT_SETTINGS_ACTION_DEBOUNCE_MS);
}

export function updateMacroSwapActionState() {
    const backups = getExtensionSettingsRoot()?.macroSwaps?.backups ?? [];
    setSettingsButtonState(UI.SETTINGS_RESTORE_MACROS_ID, {
        text: backups.length ? `Undo Macro Replacements (${backups.length})` : 'Undo Macro Replacements',
        disabled: !backups.length,
        title: backups.length
            ? backups.map((backup) => `${backup.kind === 'story' ? 'Story string' : 'Preset'} "${backup.target}": ${backup.name}`).join('\n')
            : 'Nothing to undo.',
    });
}

export function updateSettingsActionState() {
    updateMacroSwapActionState();
    updateTextCompletionNote();
    updateCharacterSettingsActionState();
    updatePersonaSettingsActionState();
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Mount
// -----------------------------------------------------------------------------

export function mountExtensionSettings() {
    const $target = $('#extensions_settings2');

    if (!$target.length) {
        setTimeout(mountExtensionSettings, 250);
        return;
    }

    if ($(`#${UI.SETTINGS_ID}`).length) {
        renderSettingsFooter();
        updateSettingsActionState();
        return;
    }

    const $settings = $(`
        <div id="${UI.SETTINGS_ID}" class="aspect-evolutia-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Aspect: Evolutia</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>

                <div class="inline-drawer-content">
					<div class="dsf-settings-box">
						<div class="dsf-settings-tagline">The Aspect of Evolution</div>

						<div
							id="${UI.SETTINGS_CHARACTER_BOX_ID}"
                            class="dsf-settings-scope-box dsf-settings-character-box"
                        >
                            <div class="dsf-settings-scope-title"><span class="dsf-header-label">Character Dynamic Fields</span></div>
                            <div class="dsf-settings-actions">
                                <button
                                    id="${UI.SETTINGS_CHARACTER_REMOVE_FIELDS_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Remove all Character Dynamic Fields from every character in Character Management. This keeps each character's Character Dynamic Fields toggle as it is."
                                >
                                    Remove All Fields for All Characters
                                </button>

                                <button
                                    id="${UI.SETTINGS_CHARACTER_REMOVE_CURRENT_FIELDS_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Open a character or group chat to use this option."
                                    disabled
                                >
                                    Remove All Fields for Current Character
                                </button>

                                <button
                                    id="${UI.SETTINGS_CHARACTER_RESET_EXTENSION_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Reset Aspect: Evolutia extension state for every character in Character Management. Character Dynamic Fields will be turned off, Alter Egos will reset to each character’s base identity, and the default Background, Personality, and Appearance fields will be restored."
                                >
                                    Reset Extension (Characters)
                                </button>
                            </div>
                        </div>

                        <div
                            id="${UI.SETTINGS_PERSONA_BOX_ID}"
                            class="dsf-settings-scope-box dsf-settings-persona-box"
                        >
                            <div class="dsf-settings-scope-title"><span class="dsf-header-label">Persona Dynamic Fields</span></div>
                            <div class="dsf-settings-actions">
                                <button
                                    id="${UI.SETTINGS_PERSONA_REMOVE_FIELDS_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Remove all Persona Dynamic Fields from every persona. This keeps each persona's Persona Dynamic Fields toggle as it is."
                                >
                                    Remove All Fields for All Personas
                                </button>

                                <button
                                    id="${UI.SETTINGS_PERSONA_REMOVE_CURRENT_FIELDS_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Select a persona to use this option."
                                    disabled
                                >
                                    Remove All Fields for Current Persona
                                </button>

                                <button
                                    id="${UI.SETTINGS_PERSONA_RESET_EXTENSION_ID}"
                                    type="button"
                                    class="menu_button danger_button"
                                    title="Reset Aspect: Evolutia extension state for every persona. Persona Dynamic Fields will be turned off, and the default Background, Personality, and Appearance fields will be restored."
                                >
                                    Reset Extension (Personas)
                                </button>
                            </div>
                        </div>

                        <div class="dsf-settings-scope-box dsf-settings-prompt-box">
                            <div class="dsf-settings-scope-title"><span class="dsf-header-label">Prompt Setup</span></div>
                            <div id="${UI.SETTINGS_TEXT_COMPLETION_NOTE_ID}" class="dsf-settings-note" style="display: none;"></div>
                            <div class="dsf-settings-actions">
                                <button
                                    id="${UI.SETTINGS_RESTORE_MACROS_ID}"
                                    type="button"
                                    class="menu_button"
                                    title="Put back the original {{description}} / {{persona}} text in presets and story strings that Aspect: Evolutia changed."
                                    disabled
                                >
                                    Undo Macro Replacements
                                </button>
                            </div>
                        </div>

                        <div class="dsf-settings-scope-box dsf-settings-proposals-box">
                            <div class="dsf-settings-scope-title"><span class="dsf-header-label">Field Update Proposals</span></div>
                            <div class="dsf-settings-note">The "Propose Updates" button in the field editor (or <code>/evolutia-propose</code>) asks a model to suggest field updates from the recent chat. You approve each one; approved updates apply to that chat only.</div>
                            <label class="dsf-settings-row" title="Which saved Connection Profile to use for proposals. Your active connection is not changed. 'Current connection' uses whatever is connected now.">
                                <span>Connection</span>
                                <select id="${UI.SETTINGS_PROPOSAL_PROFILE_ID}" class="text_pole"></select>
                            </label>
                            <label class="dsf-settings-row" title="How many recent chat messages the model reads.">
                                <span>Messages to read</span>
                                <input id="${UI.SETTINGS_PROPOSAL_MESSAGES_ID}" class="text_pole" type="number" min="2" max="200" step="1">
                            </label>
                            <label class="dsf-settings-row" title="Maximum length of the model's answer, in tokens.">
                                <span>Max reply tokens</span>
                                <input id="${UI.SETTINGS_PROPOSAL_TOKENS_ID}" class="text_pole" type="number" min="100" max="8000" step="50">
                            </label>
                        </div>

                        <div class="dsf-settings-footer">
                            <span id="${UI.SETTINGS_VERSION_ID}">Version ${escapeTextarea(manifestMeta.version)}</span>
                            <span id="${UI.SETTINGS_AUTHOR_ID}">${escapeTextarea(manifestMeta.author)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);

    $target.append($settings);

    renderProposalSettings();
    bindExtensionSettingsEvents();
    renderSettingsFooter();
    updateSettingsActionState();
}

// -----------------------------------------------------------------------------
// Extensions Drawer Settings - Events
// -----------------------------------------------------------------------------

export function renderProposalSettings() {
    const settings = getProposalSettings();
    const profiles = getProposalProfiles();
    const options = [`<option value="">Current connection</option>`]
        .concat(profiles.map((profile) => `<option value="${escapeAttribute(profile.id)}" ${profile.id === settings.profileId ? 'selected' : ''}>${escapeTextarea(profile.name || profile.id)}</option>`));

    if (settings.profileId && !profiles.some((profile) => profile.id === settings.profileId)) {
        options.push(`<option value="${escapeAttribute(settings.profileId)}" selected>(missing profile)</option>`);
    }

    $(`#${UI.SETTINGS_PROPOSAL_PROFILE_ID}`).html(options.join(''));
    $(`#${UI.SETTINGS_PROPOSAL_MESSAGES_ID}`).val(settings.messageCount);
    $(`#${UI.SETTINGS_PROPOSAL_TOKENS_ID}`).val(settings.maxTokens);
}

export function bindExtensionSettingsEvents() {
    $(document)
        .off(`change.${MODULE_NAME}`, `#${UI.SETTINGS_PROPOSAL_PROFILE_ID}, #${UI.SETTINGS_PROPOSAL_MESSAGES_ID}, #${UI.SETTINGS_PROPOSAL_TOKENS_ID}`)
        .on(`change.${MODULE_NAME}`, `#${UI.SETTINGS_PROPOSAL_PROFILE_ID}, #${UI.SETTINGS_PROPOSAL_MESSAGES_ID}, #${UI.SETTINGS_PROPOSAL_TOKENS_ID}`, () => {
            saveProposalSettings({
                profileId: String($(`#${UI.SETTINGS_PROPOSAL_PROFILE_ID}`).val() || ''),
                messageCount: normalizeCount($(`#${UI.SETTINGS_PROPOSAL_MESSAGES_ID}`).val(), 20, 2, 200),
                maxTokens: normalizeCount($(`#${UI.SETTINGS_PROPOSAL_TOKENS_ID}`).val(), 800, 100, 8000),
            });
            renderProposalSettings();
        });

    $(document)
        .off(`focus.${MODULE_NAME}`, `#${UI.SETTINGS_PROPOSAL_PROFILE_ID}`)
        .on(`focus.${MODULE_NAME}`, `#${UI.SETTINGS_PROPOSAL_PROFILE_ID}`, renderProposalSettings);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_RESTORE_MACROS_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_RESTORE_MACROS_ID}`, restoreDescriptionMacroSwaps);

    $(document)
        .off(`click.${MODULE_NAME}`, '.dsf-use-story-string-macros')
        .on(`click.${MODULE_NAME}`, '.dsf-use-story-string-macros', () => checkStoryStringForTextCompletion({ force: true }));

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_REMOVE_FIELDS_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_REMOVE_FIELDS_ID}`, removeAllFieldsForAllCharacters);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_REMOVE_CURRENT_FIELDS_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_REMOVE_CURRENT_FIELDS_ID}`, removeAllFieldsForCurrentChatCharacters);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_RESET_EXTENSION_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_CHARACTER_RESET_EXTENSION_ID}`, resetAllCharactersToOutOfBox);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_REMOVE_FIELDS_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_REMOVE_FIELDS_ID}`, removeAllFieldsForAllPersonas);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_REMOVE_CURRENT_FIELDS_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_REMOVE_CURRENT_FIELDS_ID}`, removeAllFieldsForCurrentPersona);

    $(document)
        .off(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_RESET_EXTENSION_ID}`)
        .on(`click.${MODULE_NAME}`, `#${UI.SETTINGS_PERSONA_RESET_EXTENSION_ID}`, resetAllPersonasToOutOfBox);
}
