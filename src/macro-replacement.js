// Aspect: Evolutia — macro-replacement.js (split from the former single index.js).
import {
    CHARACTER_ASPECT_MACRO_TEXT,
    CHARACTER_ASPECT_PROMPT_ID,
    PERSONA_ASPECT_MACRO_TEXT,
    PERSONA_ASPECT_PROMPT_ID,
    UI,
} from './constants.js';
import {
    getActivePersonaId,
    getContext,
    getExtensionSettingsRoot,
    getPowerUserSettings,
    getSaveSettingsDebounced,
} from './context.js';
import {
    readPersonaCardState,
} from './persistence.js';
import {
    getCurrentChatUsesCharacterDynamicFields,
    getPromptManagerInstance,
    getPromptOrder,
    saveAndRenderPromptManager,
} from './prompt-manager.js';
import {
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    escapeTextarea,
    notify,
} from './utils.js';

// ============================================================================
// Section 9A. Description Macro Replacement
// ============================================================================
// Purpose:
// - Presets and story strings that write {{description}} / {{persona}} inside
//   their own blocks would send the native description next to the Dynamic
//   Fields. Offer (once per preset/template) to replace them with the Evolutia
//   macros, which return the native text for anyone without Dynamic Fields.
// - Originals are kept in extension settings and can be restored from the
//   extension drawer ("Undo Macro Replacements").
// ============================================================================

export const DESCRIPTION_MACRO_SWAPS = Object.freeze([
    [/\{\{description\}\}/gi, CHARACTER_ASPECT_MACRO_TEXT],
    [/\{\{persona\}\}/gi, PERSONA_ASPECT_MACRO_TEXT],
]);
export const macroSwapAskedThisSession = new Set();

export function hasDescriptionMacros(text) {
    return DESCRIPTION_MACRO_SWAPS.some(([pattern]) => new RegExp(pattern.source, 'i').test(String(text || '')));
}

export function replaceDescriptionMacros(text) {
    return DESCRIPTION_MACRO_SWAPS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), String(text || ''));
}

export function getMacroSwapSettings() {
    const root = getExtensionSettingsRoot({ create: true });

    if (!root) {
        return { backups: [], declined: {} };
    }

    root.macroSwaps ??= {};
    root.macroSwaps.backups ??= [];
    root.macroSwaps.declined ??= {};
    return root.macroSwaps;
}

export async function confirmWithUser(html) {
    const ctx = getContext();

    if (typeof ctx?.callGenericPopup === 'function' && ctx?.POPUP_TYPE) {
        const result = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.CONFIRM, '', { okButton: 'Replace', cancelButton: 'Not now' });
        return result === (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1) || result === true;
    }

    return window.confirm($('<div>').html(html).text());
}

export function getCurrentChatCompletionPresetName() {
    return String(getContext()?.chatCompletionSettings?.preset_settings_openai || 'Current preset');
}

export async function offerDescriptionMacroSwap({ kind, target, items, describe, apply }) {
    const declineKey = `${kind}:${target}`;
    const settings = getMacroSwapSettings();

    if (!items.length || settings.declined[declineKey] || macroSwapAskedThisSession.has(declineKey)) {
        return false;
    }

    macroSwapAskedThisSession.add(declineKey);

    const confirmed = await confirmWithUser(describe);

    if (!confirmed) {
        settings.declined[declineKey] = new Date().toISOString();
        getSaveSettingsDebounced()?.();
        return false;
    }

    for (const item of items) {
        const original = item.get();
        const replaced = replaceDescriptionMacros(original);
        settings.backups.push({ kind, target, identifier: item.identifier, name: item.name, original, replaced, date: new Date().toISOString() });
        item.set(replaced);
    }

    await apply();
    getSaveSettingsDebounced()?.();
    updateSettingsActionState();
    notify('success', 'Replaced {{description}} / {{persona}} with the Evolutia macros. Undo from Extensions → Aspect: Evolutia.');
    return true;
}

export async function warnAboutPresetDescriptionMacros(manager) {
    const order = getPromptOrder(manager);
    const ownIds = new Set([CHARACTER_ASPECT_PROMPT_ID, PERSONA_ASPECT_PROMPT_ID]);
    const prompts = order
        .filter((entry) => entry?.enabled !== false && !ownIds.has(entry?.identifier))
        .map((entry) => manager.getPromptById?.(entry.identifier))
        .filter((prompt) => prompt && !prompt.marker && hasDescriptionMacros(prompt.content));

    if (!prompts.length) {
        return;
    }

    const preset = getCurrentChatCompletionPresetName();
    const names = prompts.map((prompt) => `<li>${escapeTextarea(prompt.name || prompt.identifier)}</li>`).join('');

    await offerDescriptionMacroSwap({
        kind: 'preset',
        target: preset,
        items: prompts.map((prompt) => ({
            identifier: prompt.identifier,
            name: prompt.name || prompt.identifier,
            get: () => String(prompt.content || ''),
            set: (value) => { prompt.content = value; },
        })),
        describe: `<h3>Aspect: Evolutia</h3>
            <p>Your Chat Completion preset <b>${escapeTextarea(preset)}</b> writes <code>{{description}}</code> or <code>{{persona}}</code> inside these prompts:</p>
            <ul>${names}</ul>
            <p>With Dynamic Fields on, the model would get both the old description and the fields. Replace them with the Evolutia macros? Characters and personas without Dynamic Fields still get their normal description.</p>
            <p>The original text is saved; you can undo this in Extensions → Aspect: Evolutia.</p>`,
        apply: () => saveAndRenderPromptManager(manager),
    });
}

export function restoreDescriptionMacroSwaps() {
    const settings = getMacroSwapSettings();
    const manager = getPromptManagerInstance();
    const remaining = [];
    let restored = 0;

    for (const backup of settings.backups) {
        let done = false;

        if (backup.kind === 'preset' && manager && backup.target === getCurrentChatCompletionPresetName()) {
            const prompt = manager.getPromptById?.(backup.identifier);

            if (prompt && String(prompt.content || '') === backup.replaced) {
                prompt.content = backup.original;
                done = true;
            }
        }

        if (backup.kind === 'story') {
            done = restoreStoryStringBackup(backup);
        }

        if (done) {
            restored += 1;
            // The user undid it on purpose: don't offer it again for this target.
            settings.declined[`${backup.kind}:${backup.target}`] = 'restored';
        } else {
            remaining.push(backup);
        }
    }

    settings.backups = remaining;

    if (restored && manager) {
        saveAndRenderPromptManager(manager);
    }

    getSaveSettingsDebounced()?.();
    updateSettingsActionState();

    if (remaining.length) {
        notify('info', `Restored ${restored} prompt(s). ${remaining.length} backup(s) belong to another preset/template or were edited since; switch to it and try again.`);
    } else {
        notify('success', restored ? `Restored ${restored} original prompt(s).` : 'Nothing to restore.');
    }
}

// -----------------------------------------------------------------------------
// Text Completion: story string
// -----------------------------------------------------------------------------
// Prompt Manager entries only exist for Chat Completion. On Text Completion the
// story string decides what is sent, so {{description}} / {{persona}} there
// must become the Evolutia macros for Dynamic Fields to reach the model.

export function isTextCompletionActive() {
    const api = String(getContext()?.mainApi || '');
    return Boolean(api) && api !== 'openai';
}

export function getStoryStringContext() {
    const powerUser = getPowerUserSettings();
    return powerUser?.context && typeof powerUser.context === 'object' ? powerUser.context : null;
}

export function setStoryString(value) {
    const context = getStoryStringContext();
    const $textarea = $('#context_story_string');

    if ($textarea.length) {
        $textarea.val(value).trigger('input');
    }

    if (context) {
        context.story_string = value;
    }

    getSaveSettingsDebounced()?.();
}

export function currentChatUsesAnyDynamicFields() {
    const personaId = getActivePersonaId();
    return getCurrentChatUsesCharacterDynamicFields() || Boolean(personaId && readPersonaCardState(personaId).swapEnabled);
}

export function storyStringNeedsEvolutiaMacros() {
    const context = getStoryStringContext();
    return isTextCompletionActive() && currentChatUsesAnyDynamicFields() && hasDescriptionMacros(context?.story_string);
}

export function updateTextCompletionNote() {
    const $note = $(`#${UI.SETTINGS_TEXT_COMPLETION_NOTE_ID}`);

    if (!$note.length) {
        return;
    }

    if (!storyStringNeedsEvolutiaMacros()) {
        $note.hide().empty();
        return;
    }

    $note.show().html(`
        <div>Text Completion: your story string uses <code>{{description}}</code> / <code>{{persona}}</code>, so Dynamic Fields are not sent to the model.</div>
        <button type="button" class="menu_button dsf-use-story-string-macros">Use Evolutia in Story String</button>
    `);
}

export async function checkStoryStringForTextCompletion({ force = false } = {}) {
    updateTextCompletionNote();

    if (!storyStringNeedsEvolutiaMacros()) {
        return;
    }

    const context = getStoryStringContext();
    const template = String(context?.preset || 'Current template');

    if (force) {
        const settings = getMacroSwapSettings();
        delete settings.declined[`story:${template}`];
        macroSwapAskedThisSession.delete(`story:${template}`);
    }

    await offerDescriptionMacroSwap({
        kind: 'story',
        target: template,
        items: [{
            identifier: 'story_string',
            name: 'Story String',
            get: () => String(getStoryStringContext()?.story_string || ''),
            set: setStoryString,
        }],
        describe: `<h3>Aspect: Evolutia</h3>
            <p>You are using a Text Completion API. Your story string (context template <b>${escapeTextarea(template)}</b>) uses <code>{{description}}</code> / <code>{{persona}}</code>, so Dynamic Fields never reach the model.</p>
            <p>Replace them with the Evolutia macros? Characters and personas without Dynamic Fields still get their normal description.</p>
            <p>The original story string is saved; you can undo this in Extensions → Aspect: Evolutia. Switching to another context template uses that template's own story string.</p>`,
        apply: async () => {},
    });

    updateTextCompletionNote();
}

export function restoreStoryStringBackup(backup) {
    const context = getStoryStringContext();

    if (!context || String(context.preset || 'Current template') !== backup.target || String(context.story_string || '') !== backup.replaced) {
        return false;
    }

    setStoryString(backup.original);
    return true;
}
