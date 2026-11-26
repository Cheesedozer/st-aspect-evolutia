// Aspect: Evolutia — proposals.js
// ============================================================================
// Model-assisted field update proposals (optional, off unless used)
// ============================================================================
// A model reads the recent chat and proposes updates to Dynamic Fields (new
// facts, changed relationships, injuries, outfit...). Safeguards against
// drift / flanderization:
// - Nothing is applied silently: proposals are shown as diffs, all unticked.
// - Every proposal must quote the messages it is based on; quotes are checked
//   against the chat and unverifiable proposals are dropped.
// - Core fields (default: Background, Personality) are never sent as editable.
// - Approved changes apply to the current chat only (chat_metadata), with
//   version history and Revert. "Make permanent" copies them to the card.
// The model is called through a chosen Connection Profile (without switching
// the active connection), or generateRaw on the current connection, which does
// not run generate interceptors.
// ============================================================================

import { MODULE_NAME, TARGET_SCOPE } from './constants.js';
import { escapeAttribute, escapeTextarea, notify } from './utils.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getContext,
    getExtensionSettingsRoot,
    getNativeCharacterName,
    getNativePersonaName,
    getSaveSettingsDebounced,
} from './context.js';
import {
    getChatMetadataRoot,
    getCharacterRuntimeKey,
    getLiveChat,
    getPersonaRuntimeKey,
    getRuntimeBucket,
    invalidateRuntimeCache,
    isChatOpenForRuntime,
} from './chat-runtime.js';
import { readCardState, readPersonaCardState, readState, readPersonaState } from './persistence.js';
import { getChatMessageText, isUserChatMessage } from './trigger-sources.js';
import { updateStateForTargetScope } from './ui-events.js';
import { renderPanel, renderPersonaPanel } from './ui-render.js';

const PROPOSAL_DEFAULTS = Object.freeze({
    profileId: '',
    messageCount: 20,
    maxTokens: 800,
});
const HISTORY_LIMIT = 20;
const MESSAGE_CHAR_LIMIT = 1500;
const CORE_FIELD_NAME_PATTERN = /^(background|personality|core|identity|backstory)$/i;

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export function getProposalSettings() {
    const root = getExtensionSettingsRoot({ create: true }) ?? {};
    root.proposals = { ...PROPOSAL_DEFAULTS, ...(root.proposals || {}) };
    return root.proposals;
}

export function saveProposalSettings(patch) {
    Object.assign(getProposalSettings(), patch);
    getSaveSettingsDebounced()?.();
}

export function getProposalProfiles() {
    const service = getContext()?.ConnectionManagerRequestService;

    try {
        return typeof service?.getSupportedProfiles === 'function' ? service.getSupportedProfiles() : [];
    } catch {
        return [];
    }
}

// -----------------------------------------------------------------------------
// Core fields
// -----------------------------------------------------------------------------

export function isCoreField(field) {
    if (typeof field?.core === 'boolean') {
        return field.core;
    }

    return CORE_FIELD_NAME_PATTERN.test(String(field?.name || '').trim());
}

// -----------------------------------------------------------------------------
// Per-chat content overrides (the "updated in this chat" layer)
// -----------------------------------------------------------------------------

function getContentBucket(scope, key, { create = false } = {}) {
    const root = getChatMetadataRoot({ create });

    if (!root || !key) {
        return null;
    }

    if (!root.content) {
        if (!create) {
            return null;
        }

        root.content = {};
    }

    const bucketName = getRuntimeBucket(scope);

    if (!root.content[bucketName]) {
        if (!create) {
            return null;
        }

        root.content[bucketName] = {};
    }

    if (!root.content[bucketName][key]) {
        if (!create) {
            return null;
        }

        root.content[bucketName][key] = {};
    }

    return root.content[bucketName][key];
}

export function getChatContentOverride(scope, key, fieldId) {
    const entry = getContentBucket(scope, key)?.[fieldId];
    return entry && typeof entry.content === 'string' ? entry : null;
}

// Returns the field list with this chat's approved updates applied.
export function applyChatContentOverrides(scope, key, fields) {
    const bucket = getContentBucket(scope, key);

    if (!bucket) {
        return fields;
    }

    return fields.map((field) => {
        const entry = bucket[field.id];
        return entry && typeof entry.content === 'string' ? { ...field, content: entry.content } : field;
    });
}

// Saved right away (not debounced): these are explicit user decisions and
// must not be lost if SillyTavern saves or reloads the chat meanwhile.
function saveChatMetadata() {
    invalidateRuntimeCache();
    const ctx = getContext();
    Promise.resolve(typeof ctx?.saveMetadata === 'function' ? ctx.saveMetadata() : ctx?.saveMetadataDebounced?.())
        .catch((error) => console.warn(`[${MODULE_NAME}] Could not save chat metadata:`, error));
}

function setChatContentOverride(scope, key, fieldId, { before, after, reason, sources }) {
    const bucket = getContentBucket(scope, key, { create: true });

    if (!bucket) {
        return false;
    }

    const entry = bucket[fieldId] ?? { history: [] };
    entry.history = [...(entry.history || []), { date: new Date().toISOString(), before, after, reason, sources }].slice(-HISTORY_LIMIT);
    entry.content = after;
    bucket[fieldId] = entry;
    saveChatMetadata();
    return true;
}

export function revertChatContentOverride(scope, key, fieldId, cardContent) {
    const bucket = getContentBucket(scope, key);
    const entry = bucket?.[fieldId];

    if (!entry) {
        return;
    }

    const last = entry.history?.pop();
    const previous = last ? last.before : cardContent;

    if (!entry.history?.length || previous === cardContent) {
        delete bucket[fieldId];
    } else {
        entry.content = previous;
    }

    saveChatMetadata();
}

export function clearChatContentOverride(scope, key, fieldId) {
    const bucket = getContentBucket(scope, key);

    if (bucket?.[fieldId]) {
        delete bucket[fieldId];
        saveChatMetadata();
    }
}

// -----------------------------------------------------------------------------
// UI helpers (used by ui-render / ui-events)
// -----------------------------------------------------------------------------

export function getRuntimeKeyForScope(scope) {
    return scope === TARGET_SCOPE.PERSONA ? getPersonaRuntimeKey(getActivePersonaId()) : getCharacterRuntimeKey(getActiveCharacterId());
}

export function renderChatContentOverrideHtml(field, targetScope) {
    if (!isChatOpenForRuntime()) {
        return '';
    }

    const entry = getChatContentOverride(targetScope, getRuntimeKeyForScope(targetScope), field.id);

    if (!entry) {
        return '';
    }

    const last = entry.history?.at(-1);
    const detail = last?.reason ? ` — ${escapeTextarea(last.reason)}` : '';

    return `
        <div class="dsf-chat-override" data-field-id="${escapeAttribute(field.id)}">
            <details>
                <summary>This chat uses an updated version${detail}</summary>
                <div class="dsf-chat-override-text">${escapeTextarea(entry.content)}</div>
            </details>
            <div class="dsf-chat-override-actions">
                <button type="button" class="menu_button dsf-chat-override-revert" title="Undo the last approved update for this chat.">Revert</button>
                <button type="button" class="menu_button dsf-chat-override-promote" title="Copy this chat's version into the card, so every chat uses it.">Make permanent</button>
            </div>
        </div>
    `;
}

export function handleChatOverrideAction(targetScope, fieldId, action) {
    const key = getRuntimeKeyForScope(targetScope);
    const state = targetScope === TARGET_SCOPE.PERSONA ? readPersonaState() : readState();
    const field = state.fields.find((entry) => entry.id === fieldId);
    const entry = getChatContentOverride(targetScope, key, fieldId);

    if (!field || !entry) {
        return;
    }

    if (action === 'revert') {
        revertChatContentOverride(targetScope, key, fieldId, field.content);
        notify('info', `Reverted the last update to "${field.name}" for this chat.`);
    }

    if (action === 'promote') {
        const content = entry.content;
        updateStateForTargetScope(targetScope, (next) => {
            const target = next.fields.find((candidate) => candidate.id === fieldId);

            if (target) {
                target.content = content;
            }
        }, { rerender: false });
        clearChatContentOverride(targetScope, key, fieldId);
        notify('success', `"${field.name}" updated on the ${targetScope === TARGET_SCOPE.PERSONA ? 'persona' : 'character card'}.`);
    }

    if (targetScope === TARGET_SCOPE.PERSONA) {
        renderPersonaPanel();
    } else {
        renderPanel();
    }
}

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

function getRecentMessagesForProposals(count) {
    const chat = getLiveChat();
    const start = Math.max(0, chat.length - count);
    const lines = [];

    for (let index = start; index < chat.length; index += 1) {
        const message = chat[index];

        if (!message || (message.is_system && message.extra?.type !== 'narrator')) {
            continue;
        }

        const text = getChatMessageText(message).slice(0, MESSAGE_CHAR_LIMIT);

        if (text) {
            lines.push({ index, name: String(message.name || (message.is_user ? 'User' : 'Character')), isUser: isUserChatMessage(message), text });
        }
    }

    return lines;
}

function buildProposalPrompt({ entityName, coreFields, editableFields, messages }) {
    const system = [
        `You maintain a roleplay character sheet for ${entityName}. You get the current sheet and the latest chat messages, each numbered.`,
        `Propose updates only where the chat establishes something new or changed about ${entityName}: facts learned, relationships, injuries, outfit, location, possessions, current goals.`,
        'Rules:',
        '- Only update fields listed under EDITABLE FIELDS, referring to them by id.',
        '- Keep everything that is still true; add or change only what the messages establish. Keep the field\'s style and roughly its length unless something must be removed.',
        '- Do not add or emphasize personality traits, mannerisms or catchphrases. Do not restate what the field already says.',
        '- Every change must cite the message number(s) and a short quote copied exactly from that message.',
        '- If nothing changed, return an empty list.',
        'Reply with JSON only, no other text:',
        '{"proposals":[{"fieldId":"...","newContent":"...","reason":"one short sentence","evidence":[{"message":12,"quote":"exact words"}]}]}',
    ].join('\n');

    const core = coreFields.length
        ? coreFields.map((field) => `[${field.name}]\n${field.content.trim() || '(empty)'}`).join('\n\n')
        : '(none)';
    const editable = editableFields.map((field) => `[id: ${field.id}] ${field.name}\n${field.content.trim() || '(empty)'}`).join('\n\n');
    const chat = messages.map((message) => `#${message.index} ${message.name}${message.isUser ? ' (user)' : ''}: ${message.text}`).join('\n');

    const user = [
        `SHEET FOR: ${entityName}`,
        '',
        'READ-ONLY CORE FIELDS (context only, never edit):',
        core,
        '',
        'EDITABLE FIELDS:',
        editable,
        '',
        'CHAT (oldest first):',
        chat,
    ].join('\n');

    return { system, user };
}

async function requestProposalText({ system, user }, settings) {
    const ctx = getContext();
    const service = ctx?.ConnectionManagerRequestService;
    const maxTokens = Number(settings.maxTokens) || PROPOSAL_DEFAULTS.maxTokens;

    if (settings.profileId && typeof service?.sendRequest === 'function') {
        const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        const prompt = typeof service.constructPrompt === 'function' ? service.constructPrompt(messages, settings.profileId) : messages;
        const result = await service.sendRequest(settings.profileId, prompt, maxTokens, { stream: false, extractData: true, includePreset: true, includeInstruct: true });
        return typeof result === 'string' ? result : String(result?.content ?? result?.text ?? '');
    }

    if (typeof ctx?.generateRaw !== 'function') {
        throw new Error('No way to call the model: generateRaw is unavailable.');
    }

    return String(await ctx.generateRaw({ systemPrompt: system, prompt: user, responseLength: maxTokens }) ?? '');
}

// -----------------------------------------------------------------------------
// Parsing and verification
// -----------------------------------------------------------------------------

function parseProposalJson(text) {
    const raw = String(text || '');
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start < 0 || end <= start) {
        return null;
    }

    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}

function normalizeForQuote(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[“”«»"]/g, '"')
        .replace(/[‘’`]/g, '\'')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Keeps only proposals that target an editable field, change it, and cite
// quotes that really appear in the cited messages.
export function verifyProposals(parsed, { editableFields, chat }) {
    const accepted = [];
    const rejected = [];
    const fieldsById = new Map(editableFields.map((field) => [field.id, field]));
    const list = Array.isArray(parsed?.proposals) ? parsed.proposals : [];

    for (const proposal of list) {
        const field = fieldsById.get(String(proposal?.fieldId || ''));
        const newContent = String(proposal?.newContent ?? '').trim();

        if (!field) {
            rejected.push({ proposal, why: 'unknown or protected field' });
            continue;
        }

        if (!newContent || newContent === field.content.trim()) {
            rejected.push({ proposal, why: 'no change' });
            continue;
        }

        const evidence = (Array.isArray(proposal.evidence) ? proposal.evidence : [])
            .map((item) => ({ message: Number(item?.message), quote: String(item?.quote || '').trim() }))
            .filter((item) => Number.isInteger(item.message) && item.quote.length >= 3)
            .filter((item) => normalizeForQuote(getChatMessageText(chat[item.message])).includes(normalizeForQuote(item.quote)));

        if (!evidence.length) {
            rejected.push({ proposal, why: 'no verifiable quote from the chat' });
            continue;
        }

        const onlyModelEvidence = evidence.every((item) => !isUserChatMessage(chat[item.message]));
        const before = field.content.trim();
        const largeChange = newContent.length > before.length * 1.6 + 200;

        accepted.push({
            id: `${field.id}:${accepted.length}`,
            field,
            before,
            after: newContent,
            reason: String(proposal.reason || '').trim().slice(0, 300),
            evidence,
            onlyModelEvidence,
            largeChange,
        });
    }

    return { accepted, rejected };
}

// -----------------------------------------------------------------------------
// Diff view
// -----------------------------------------------------------------------------

function diffWordsHtml(before, after) {
    const a = before.split(/(\s+)/);
    const b = after.split(/(\s+)/);

    if (a.length * b.length > 400000) {
        return `<del>${escapeTextarea(before)}</del><br><ins>${escapeTextarea(after)}</ins>`;
    }

    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));

    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const out = [];
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            out.push(escapeTextarea(a[i]));
            i += 1;
            j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            out.push(`<del>${escapeTextarea(a[i])}</del>`);
            i += 1;
        } else {
            out.push(`<ins>${escapeTextarea(b[j])}</ins>`);
            j += 1;
        }
    }

    while (i < a.length) {
        out.push(`<del>${escapeTextarea(a[i])}</del>`);
        i += 1;
    }

    while (j < b.length) {
        out.push(`<ins>${escapeTextarea(b[j])}</ins>`);
        j += 1;
    }

    return out.join('');
}

function renderProposalsHtml(entityName, accepted, rejected) {
    const items = accepted.map((proposal) => `
        <div class="dsf-proposal">
            <label class="checkbox_label dsf-proposal-title">
                <input type="checkbox" class="dsf-proposal-check" data-proposal-id="${escapeAttribute(proposal.id)}">
                <b>${escapeTextarea(proposal.field.name || 'Unnamed field')}</b>
                ${proposal.reason ? `<span> — ${escapeTextarea(proposal.reason)}</span>` : ''}
            </label>
            ${proposal.onlyModelEvidence ? '<div class="dsf-proposal-warning">Based only on the model\'s own replies. Check that this really happened.</div>' : ''}
            ${proposal.largeChange ? '<div class="dsf-proposal-warning">Large change: the field grows a lot.</div>' : ''}
            <div class="dsf-proposal-diff">${diffWordsHtml(proposal.before, proposal.after)}</div>
            <div class="dsf-proposal-evidence">${proposal.evidence.map((item) => `<div>#${item.message}: “${escapeTextarea(item.quote)}”</div>`).join('')}</div>
        </div>
    `).join('');

    const dropped = rejected.length
        ? `<div class="dsf-proposal-dropped">${rejected.length} proposal(s) were dropped (protected field, no change, or quotes that are not in the chat).</div>`
        : '';

    return `
        <div class="dsf-proposals">
            <h3>Proposed updates for ${escapeTextarea(entityName)}</h3>
            <p>Nothing is applied unless you tick it. Approved updates apply to <b>this chat only</b>; you can revert them or make them permanent from each field.</p>
            ${items || '<p>No updates proposed.</p>'}
            ${dropped}
        </div>
    `;
}

// -----------------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------------

let proposalRunning = false;

export async function runFieldUpdateProposals(targetScope = TARGET_SCOPE.CHARACTER) {
    const isPersona = targetScope === TARGET_SCOPE.PERSONA;
    const entityId = isPersona ? getActivePersonaId() : getActiveCharacterId();

    if (proposalRunning) {
        notify('info', 'Proposals are already being prepared.');
        return;
    }

    if (entityId === undefined || entityId === null || entityId === '' || !isChatOpenForRuntime()) {
        notify('warning', isPersona ? 'Select a persona and open a chat first.' : 'Open a chat with a single character first (in groups, open that character\'s card).');
        return;
    }

    const cardState = isPersona ? readPersonaCardState(entityId) : readCardState(entityId);

    if (!cardState.swapEnabled) {
        notify('warning', 'Turn on Dynamic Fields first.');
        return;
    }

    const view = isPersona ? readPersonaState(entityId) : readState(entityId);
    const key = isPersona ? getPersonaRuntimeKey(entityId) : getCharacterRuntimeKey(entityId);
    const fields = applyChatContentOverrides(targetScope, key, view.fields);
    const coreFields = fields.filter(isCoreField);
    const editableFields = fields.filter((field) => !isCoreField(field));
    const settings = getProposalSettings();
    const messages = getRecentMessagesForProposals(Math.max(2, Number(settings.messageCount) || PROPOSAL_DEFAULTS.messageCount));
    const alterEgoName = String(view.alterEgos.find((alterEgo) => alterEgo.id === view.activeAlterEgoId)?.name || '').trim();
    const entityName = alterEgoName || (isPersona ? getNativePersonaName(entityId) : getNativeCharacterName(entityId));

    if (!editableFields.length) {
        notify('info', 'All fields are marked Core, so there is nothing to propose. Untick "Core" on fields that may change.');
        return;
    }

    if (!messages.length) {
        notify('info', 'The chat has no messages to read yet.');
        return;
    }

    proposalRunning = true;
    notify('info', 'Reading the chat and preparing proposals…');

    try {
        const text = await requestProposalText(buildProposalPrompt({ entityName, coreFields, editableFields, messages }), settings);
        const parsed = parseProposalJson(text);

        if (!parsed) {
            notify('warning', 'The model did not return usable JSON. Try again, or choose a stronger model in the extension settings.');
            console.warn(`[${MODULE_NAME}] Unusable proposal reply:`, text);
            return;
        }

        const { accepted, rejected } = verifyProposals(parsed, { editableFields, chat: getLiveChat() });

        if (!accepted.length) {
            notify('info', rejected.length ? `No usable proposals (${rejected.length} dropped: protected field, no change, or unverifiable quotes).` : 'No updates proposed.');
            return;
        }

        const selected = await showProposalsPopup(entityName, accepted, rejected);
        let applied = 0;

        for (const proposal of accepted) {
            if (!selected.has(proposal.id)) {
                continue;
            }

            if (setChatContentOverride(targetScope, key, proposal.field.id, {
                before: proposal.before,
                after: proposal.after,
                reason: proposal.reason,
                sources: proposal.evidence.map((item) => item.message),
            })) {
                applied += 1;
            }
        }

        if (applied) {
            notify('success', `Applied ${applied} update(s) to this chat.`);
        }

        if (isPersona) {
            renderPersonaPanel();
        } else {
            renderPanel();
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Field update proposals failed:`, error);
        notify('error', `Could not get proposals: ${error?.message ?? error}`);
    } finally {
        proposalRunning = false;
    }
}

async function showProposalsPopup(entityName, accepted, rejected) {
    const ctx = getContext();
    const selected = new Set();
    const html = renderProposalsHtml(entityName, accepted, rejected);

    $(document)
        .off(`change.${MODULE_NAME}-proposals`, '.dsf-proposal-check')
        .on(`change.${MODULE_NAME}-proposals`, '.dsf-proposal-check', function onProposalToggled() {
            const id = String($(this).attr('data-proposal-id'));

            if (this.checked) {
                selected.add(id);
            } else {
                selected.delete(id);
            }
        });

    try {
        if (typeof ctx?.callGenericPopup === 'function' && ctx?.POPUP_TYPE) {
            const result = await ctx.callGenericPopup(html, ctx.POPUP_TYPE.CONFIRM, '', { okButton: 'Apply selected', cancelButton: 'Discard', wide: true, large: true, allowVerticalScrolling: true });
            return result === (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1) || result === true ? selected : new Set();
        }

        return window.confirm('Apply all proposed updates to this chat?') ? new Set(accepted.map((proposal) => proposal.id)) : new Set();
    } finally {
        $(document).off(`change.${MODULE_NAME}-proposals`, '.dsf-proposal-check');
    }
}

// -----------------------------------------------------------------------------
// Slash command
// -----------------------------------------------------------------------------

export function registerProposalSlashCommand() {
    const ctx = getContext();

    if (registerProposalSlashCommand.done || typeof ctx?.SlashCommandParser?.addCommandObject !== 'function' || typeof ctx?.SlashCommand?.fromProps !== 'function') {
        return;
    }

    registerProposalSlashCommand.done = true;
    ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
        name: 'evolutia-propose',
        callback: async (_args, value) => {
            await runFieldUpdateProposals(String(value || '').trim().toLowerCase() === 'persona' ? TARGET_SCOPE.PERSONA : TARGET_SCOPE.CHARACTER);
            return '';
        },
        helpString: 'Aspect: Evolutia — ask the model to propose updates to the current character\'s Dynamic Fields from recent chat (shown for approval, nothing is applied automatically). Use "/evolutia-propose persona" for the persona.',
    }));
}
