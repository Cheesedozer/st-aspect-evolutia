// Aspect: Evolutia — alter-ego-identity.js (split from the former single index.js).
import {
    getPersonaRuntimeKey,
    stampRuntimeOnMessage,
} from './chat-runtime.js';
import {
    ALTER_EGO_AVATAR_MODE,
    ALTER_EGO_BASE_ID,
    ALTER_EGO_EXTRA_KEY,
    ALTER_EGO_MESSAGE_KEY,
    ALTER_EGO_VISUAL_REFRESH_DEBOUNCE_MS,
    MODULE_NAME,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaAlterEgoIdentity,
    getActivePersonaId,
    getCharacterAvatarThumbnailUrl,
    getContext,
    getMacroCharacterId,
    getMessageSafeAvatarUrl,
    getNativeCharacterAvatarKey,
    getNativeCharacterName,
    getNativePersonaAvatarKey,
    getNativePersonaName,
    getPersonaAvatarThumbnailUrl,
    normalizePersonaId,
    shouldApplyPersonaAlterEgoIdentity,
    toServedFileUrl,
} from './context.js';
import {
    getActiveAlterEgoForCharacter,
    normalizeAlterEgo,
} from './model.js';
import {
    readPersonaCardState,
    readState,
} from './persistence.js';
import {
    computePersonaGeneration,
} from './prompt-assembly.js';
import {
    updateSettingsActionState,
} from './settings-drawer.js';
import {
    importedSetCharacterName,
} from './st-imports.js';
import {
    updatePersonaTokenEstimate,
} from './token-estimate.js';
import {
    isUserChatMessage,
} from './trigger-sources.js';
import {
    getCharacterEditorRoot,
    renderPersonaPanel,
} from './ui-render.js';
import {
    normalizeHeadingKey,
} from './utils.js';

// Module state (written only by this module).
export let alterEgoIdentitySaveTimer = null;
export let alterEgoVisualIdentityRefreshTimer = null;
export let personaAlterEgoVisualIdentityRefreshTimer = null;


// ============================================================================
// Section 10A. Character Alter Ego Runtime Identity
// ============================================================================
// Purpose:
// - Apply Alter Ego name/avatar as runtime display identity.
// - Preserve canonical character card name/avatar fields.
// - Preserve systems that use character.avatar as a stable key, including
//   group membership, chat save/load, tags, and Aspect: Vocalia.
// - Persist generated-message identity through SillyTavern's existing
//   message.force_avatar display model.
// ============================================================================

export function shouldApplyAlterEgoIdentity(characterId = getActiveCharacterId()) {
    const state = readState(characterId);
    return Boolean(state.swapEnabled && state.activeAlterEgoId);
}

export function resolveAlterEgoAvatarUrl(alterEgo, characterId = getMacroCharacterId(), { bustCache = false } = {}) {
    const normalized = normalizeAlterEgo(alterEgo, {
        fallbackName: getNativeCharacterName(characterId),
        fallbackAvatarKey: getNativeCharacterAvatarKey(characterId),
    });

    switch (normalized.avatarMode) {
        case ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY:
            return getCharacterAvatarThumbnailUrl(normalized.avatarKey, { bustCache });

        case ALTER_EGO_AVATAR_MODE.IMAGE_FILE:
            return toServedFileUrl(normalized.avatarFilePath) || normalized.avatarDataUrl || getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.LOCAL_FILE:
            return normalized.avatarLocalPath || getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.URL:
            return normalized.avatarUrl || getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.DATA_URL:
            return normalized.avatarDataUrl || getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.INHERIT:
        default:
            return getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId), { bustCache });
    }
}

export function getActiveAlterEgoIdentity(characterId = getMacroCharacterId()) {
    const alterEgo = getActiveAlterEgoForCharacter(characterId);

    if (!alterEgo || !shouldApplyAlterEgoIdentity(characterId)) {
        return {
            alterEgoId: ALTER_EGO_BASE_ID,
            name: getNativeCharacterName(characterId),
            avatarUrl: getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId)),
            avatarKey: getNativeCharacterAvatarKey(characterId),
            avatarMode: ALTER_EGO_AVATAR_MODE.INHERIT,
            isAlterEgo: false,
        };
    }

    return {
        alterEgoId: alterEgo.id,
        name: String(alterEgo.name || getNativeCharacterName(characterId)).trim() || getNativeCharacterName(characterId),
        avatarUrl: resolveAlterEgoAvatarUrl(alterEgo, characterId),
        avatarKey: String(alterEgo.avatarKey || '').trim(),
        avatarMode: alterEgo.avatarMode,
        isAlterEgo: alterEgo.id !== ALTER_EGO_BASE_ID,
    };
}

export function applyActiveAlterEgoNameToSillyTavern(characterId = getActiveCharacterId()) {
    if (characterId === undefined || characterId === null || characterId === '') {
        return;
    }

    const identity = getActiveAlterEgoIdentity(characterId);

    if (typeof importedSetCharacterName === 'function') {
        importedSetCharacterName(identity.name);
    } else if (typeof getContext()?.setCharacterName === 'function') {
        getContext().setCharacterName(identity.name);
    }

    refreshTypingIndicatorAlterEgoName(identity);
}

export function isTypingIndicatorExtensionPresent() {
    return Boolean(
        document.getElementById('typing_indicator') ||
        document.getElementById('typingIndicatorEnabled') ||
        document.getElementById('typingIndicatorShowIfStreaming') ||
        document.getElementById('typing_indicator_container')
    );
}

export function refreshTypingIndicatorAlterEgoName(identity = getActiveAlterEgoIdentity()) {
    if (!identity?.name || !isTypingIndicatorExtensionPresent()) {
        return;
    }

    const indicator = document.getElementById('typing_indicator');

    if (!indicator) {
        return;
    }

    const nextText = `${identity.name} is typing...`;
    const childNodes = Array.from(indicator.childNodes);
    const textNode = childNodes.find((node) =>
        node.nodeType === Node.TEXT_NODE &&
        String(node.textContent || '').includes('is typing')
    );

    if (textNode) {
        textNode.textContent = nextText;
        return;
    }

    const fallbackText = document.createTextNode(nextText);
    const dotsNode = indicator.querySelector('.svg_dots');

    if (dotsNode?.nextSibling) {
        indicator.insertBefore(fallbackText, dotsNode.nextSibling);
    } else {
        indicator.appendChild(fallbackText);
    }
}

export function getChatElement() {
    return $('#chat');
}

export function getMessageElementById(messageId) {
    return getChatElement().find(`.mes[mesid="${Number(messageId)}"]`);
}

export function isAssistantMessageForCharacter(message, characterId = getActiveCharacterId()) {
    if (!message || message.is_user || message.is_system) {
        return false;
    }

    if (characterId === undefined || characterId === null || characterId === '') {
        return false;
    }

    const nativeName = normalizeHeadingKey(getNativeCharacterName(characterId));
    const effectiveName = normalizeHeadingKey(getActiveAlterEgoIdentity(characterId).name);
    const messageName = normalizeHeadingKey(message.name);

    return Boolean(messageName && (messageName === nativeName || messageName === effectiveName));
}

export function stampMessageWithActiveAlterEgoIdentity(messageId, message = getContext()?.chat?.[Number(messageId)], characterId = getActiveCharacterId()) {
    if (
        characterId === undefined ||
        characterId === null ||
        characterId === '' ||
        !message ||
        message.is_user ||
        message.is_system ||
        !shouldApplyAlterEgoIdentity(characterId)
    ) {
        return false;
    }

    let identity = getActiveAlterEgoIdentity(characterId);

    if (!identity.name && !identity.avatarUrl) {
        return false;
    }

    message.name = identity.name || message.name;

    const safeAvatarUrl = getMessageSafeAvatarUrl(identity.avatarUrl, (fileUrl) => {
        message.force_avatar = fileUrl;

        if (message.extra?.[ALTER_EGO_EXTRA_KEY]?.[ALTER_EGO_MESSAGE_KEY]) {
            message.extra[ALTER_EGO_EXTRA_KEY][ALTER_EGO_MESSAGE_KEY].avatarUrl = fileUrl;
        }

        syncMessageElementIdentity(messageId, { ...identity, avatarUrl: fileUrl });
        scheduleAlterEgoChatIdentitySave();
    });

    identity = { ...identity, avatarUrl: safeAvatarUrl };

    if (identity.avatarUrl) {
        message.force_avatar = identity.avatarUrl;
    }

    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }

    if (!message.extra[ALTER_EGO_EXTRA_KEY] || typeof message.extra[ALTER_EGO_EXTRA_KEY] !== 'object') {
        message.extra[ALTER_EGO_EXTRA_KEY] = {};
    }

    message.extra[ALTER_EGO_EXTRA_KEY][ALTER_EGO_MESSAGE_KEY] = {
        id: identity.alterEgoId,
        name: identity.name,
        avatarMode: identity.avatarMode,
        avatarKey: identity.avatarKey,
        avatarUrl: identity.avatarUrl,
        baseCharacterName: getNativeCharacterName(characterId),
        baseCharacterAvatar: getNativeCharacterAvatarKey(characterId),
    };

    syncMessageElementIdentity(messageId, identity);
    scheduleAlterEgoChatIdentitySave();

    return true;
}

export function syncMessageElementIdentity(messageId, identity) {
    const $message = getMessageElementById(messageId);

    if (!$message.length) {
        return;
    }

    if (identity.name) {
        $message.attr('ch_name', identity.name);
        $message.find('.ch_name .name_text').text(identity.name);
    }

    if (identity.avatarUrl) {
        $message.attr('force_avatar', 'true');
        const $image = $message.find('.avatar img');

        if ($image.length) {
            $image.attr('src', identity.avatarUrl);
        }
    }
}

export function scheduleAlterEgoChatIdentitySave() {
    clearTimeout(alterEgoIdentitySaveTimer);

    alterEgoIdentitySaveTimer = setTimeout(async () => {
        try {
            const ctx = getContext();

            if (typeof ctx?.saveChat === 'function') {
                await ctx.saveChat();
            }
        } catch (error) {
            console.warn(`[${MODULE_NAME}] Failed to save Alter Ego message identity:`, error);
        }
    }, 500);
}

export function refreshActiveAlterEgoVisualIdentity(characterId = getActiveCharacterId()) {
    if (characterId === undefined || characterId === null || characterId === '') {
        return;
    }

    const identity = getActiveAlterEgoIdentity(characterId);
    const nativeAvatarUrl = getCharacterAvatarThumbnailUrl(getNativeCharacterAvatarKey(characterId));

    refreshCharacterListAlterEgoVisual(characterId, identity, nativeAvatarUrl);
    refreshCharacterEditorAlterEgoVisual(identity);
}

export function scheduleActiveAlterEgoVisualIdentityRefresh(characterId = getActiveCharacterId()) {
    clearTimeout(alterEgoVisualIdentityRefreshTimer);
    alterEgoVisualIdentityRefreshTimer = setTimeout(() => {
        alterEgoVisualIdentityRefreshTimer = null;
        refreshActiveAlterEgoVisualIdentity(characterId);
    }, ALTER_EGO_VISUAL_REFRESH_DEBOUNCE_MS);
}

export function refreshCharacterListAlterEgoVisual(characterId, identity, nativeAvatarUrl = '') {
    const $block = $(`#CharID${characterId}`);

    if (!$block.length) {
        return;
    }

    if (identity.name) {
        $block.find('.ch_name').text(identity.name).attr('title', `[Alter Ego] ${identity.name}`);
        $block.find('img').attr('alt', identity.name);
    }

    if (identity.avatarUrl) {
        $block.find('img').attr('src', identity.avatarUrl);
    } else if (nativeAvatarUrl) {
        $block.find('img').attr('src', nativeAvatarUrl);
    }

    $block
        .attr('data-dsf-alter-ego-id', identity.alterEgoId)
        .toggleClass('dsf-alter-ego-active', identity.isAlterEgo);
}

export function refreshCharacterEditorAlterEgoVisual(identity) {
    const $root = getCharacterEditorRoot();

    if (!$root.length) {
        return;
    }

    const selectors = [
        '#avatar_load_preview',
        '#avatar_preview',
        '#character_popup img.avatar',
        '#character_popup .avatar img',
        '#rm_ch_create_block .avatar img',
        '#character_edit_dialogue .avatar img',
    ];

    const $images = $root.find(selectors.join(','));

    if (identity.avatarUrl) {
        $images.each(function updateAlterEgoPreview() {
            const $image = $(this);

            if (!$image.attr('data-dsf-native-src')) {
                $image.attr('data-dsf-native-src', $image.attr('src') || '');
            }

            $image.attr('src', identity.avatarUrl);
            $image.attr('data-dsf-alter-ego-id', identity.alterEgoId);
        });
    } else {
        $images.each(function restoreAlterEgoPreview() {
            const $image = $(this);
            const nativeSrc = $image.attr('data-dsf-native-src');

            if (nativeSrc !== undefined) {
                $image.attr('src', nativeSrc);
                $image.removeAttr('data-dsf-native-src');
                $image.removeAttr('data-dsf-alter-ego-id');
            }
        });
    }
}

export function refreshActivePersonaAlterEgoVisualIdentity(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return;
    }

    const identity = getActivePersonaAlterEgoIdentity(normalizedPersonaId);
    const nativeAvatarUrl = getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId));
    refreshPersonaListAlterEgoVisual(normalizedPersonaId, identity, nativeAvatarUrl);
}

export function scheduleActivePersonaAlterEgoVisualIdentityRefresh(personaId = getActivePersonaId()) {
    clearTimeout(personaAlterEgoVisualIdentityRefreshTimer);
    personaAlterEgoVisualIdentityRefreshTimer = setTimeout(() => {
        personaAlterEgoVisualIdentityRefreshTimer = null;
        refreshActivePersonaAlterEgoVisualIdentity(personaId);
    }, ALTER_EGO_VISUAL_REFRESH_DEBOUNCE_MS);
}

export function refreshPersonaListAlterEgoVisual(personaId, identity, nativeAvatarUrl = '') {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return;
    }

    const $blocks = $('#user_avatar_block .avatar-container, #user_avatar_block [data-avatar-id]')
        .filter(function matchPersonaAlterEgoBlock() {
            return String($(this).attr('data-avatar-id') || '').trim() === normalizedPersonaId;
        });

    if (!$blocks.length) {
        return;
    }

    $blocks.each(function updatePersonaAlterEgoBlock() {
        const $block = $(this);

        if (identity.name) {
            $block.find('.ch_name').text(identity.name).attr('title', `[Alter Ego] ${identity.name}`);
            $block.find('img').attr('alt', identity.name);
        }

        if (identity.avatarUrl) {
            $block.find('img').attr('src', identity.avatarUrl);
        } else if (nativeAvatarUrl) {
            $block.find('img').attr('src', nativeAvatarUrl);
        }

        $block
            .attr('data-dsf-persona-alter-ego-id', identity.alterEgoId)
            .toggleClass('dsf-alter-ego-active', identity.isAlterEgo);
    });
}

export function isUserMessage(message) {
    return isUserChatMessage(message);
}

export function stampMessageWithActivePersonaAlterEgoIdentity(messageId, message = getContext()?.chat?.[Number(messageId)], personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId || !message || !isUserChatMessage(message) || !shouldApplyPersonaAlterEgoIdentity(normalizedPersonaId)) {
        return false;
    }

    let identity = getActivePersonaAlterEgoIdentity(normalizedPersonaId);

    if (!identity.name && !identity.avatarUrl) {
        return false;
    }

    identity = {
        ...identity,
        avatarUrl: getMessageSafeAvatarUrl(identity.avatarUrl, (fileUrl) => {
            message.force_avatar = fileUrl;

            if (message.extra?.[ALTER_EGO_EXTRA_KEY]?.personaAlterEgo) {
                message.extra[ALTER_EGO_EXTRA_KEY].personaAlterEgo.avatarUrl = fileUrl;
            }

            syncMessageElementIdentity(messageId, { ...identity, avatarUrl: fileUrl });
            scheduleAlterEgoChatIdentitySave();
        }),
    };

    message.name = identity.name || message.name;

    if (identity.avatarUrl) {
        message.force_avatar = identity.avatarUrl;
    }

    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }

    if (!message.extra[ALTER_EGO_EXTRA_KEY] || typeof message.extra[ALTER_EGO_EXTRA_KEY] !== 'object') {
        message.extra[ALTER_EGO_EXTRA_KEY] = {};
    }

    const previousStamp = message.extra[ALTER_EGO_EXTRA_KEY].personaAlterEgo;
    const alreadyStamped = (
        previousStamp?.id === identity.alterEgoId &&
        previousStamp?.avatarUrl === identity.avatarUrl &&
        previousStamp?.name === identity.name &&
        message.name === identity.name &&
        (!identity.avatarUrl || message.force_avatar === identity.avatarUrl)
    );

    if (alreadyStamped) {
        syncMessageElementIdentity(messageId, identity);
        return false;
    }

    message.extra[ALTER_EGO_EXTRA_KEY].personaAlterEgo = {
        id: identity.alterEgoId,
        name: identity.name,
        avatarMode: identity.avatarMode,
        avatarKey: identity.avatarKey,
        avatarUrl: identity.avatarUrl,
        basePersonaName: getNativePersonaName(normalizedPersonaId),
        basePersonaAvatar: getNativePersonaAvatarKey(normalizedPersonaId),
    };

    syncMessageElementIdentity(messageId, identity);
    scheduleAlterEgoChatIdentitySave();

    return true;
}

export function getChatOverrideForUserMessage(messageId, message) {
    const ctx = getContext();
    const liveChat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const chatOverride = liveChat.slice();
    const index = Number(messageId);

    if (Number.isInteger(index) && index >= 0) {
        chatOverride[index] = message;
        return chatOverride;
    }

    if (message && !chatOverride.includes(message)) {
        chatOverride.push(message);
    }

    return chatOverride;
}

// When the user sends a message, evaluate persona alter-ego swaps and Persona
// field triggers against it, and stamp the resulting state on that message.
export function applyPersonaAlterEgoSwapForUserMessage(messageId, message = getContext()?.chat?.[Number(messageId)]) {
    if (!isUserChatMessage(message)) {
        return false;
    }

    const personaId = getActivePersonaId();

    if (!personaId || !readPersonaCardState(personaId).swapEnabled) {
        return false;
    }

    const index = Number(messageId);
    const chatOverride = getChatOverrideForUserMessage(messageId, message).slice(0, Number.isInteger(index) ? index + 1 : undefined);
    const result = computePersonaGeneration(personaId, chatOverride, { endExclusive: Number.isInteger(index) ? index : undefined });

    if (!result.runtime || !Number.isInteger(index)) {
        return false;
    }

    stampRuntimeOnMessage(index, { personaKey: getPersonaRuntimeKey(personaId), personaRuntime: result.runtime });
    refreshActivePersonaAlterEgoVisualIdentity(personaId);
    setTimeout(() => {
        renderPersonaPanel();
        updatePersonaTokenEstimate();
        updateSettingsActionState();
    }, 0);

    return true;
}
