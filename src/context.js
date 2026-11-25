// Aspect: Evolutia — context.js (split from the former single index.js).
import {
    shouldApplyAlterEgoIdentity,
} from './alter-ego-identity.js';
import {
    getLiveChat,
} from './chat-runtime.js';
import {
    ALTER_EGO_AVATAR_MODE,
    ALTER_EGO_BASE_ID,
    ALTER_EGO_EXTRA_KEY,
    ALTER_EGO_MESSAGE_KEY,
    MODULE_NAME,
    PERSONA_STATE_SETTINGS_KEY,
    PERSONA_STATE_UNKNOWN_KEY,
    TARGET_SCOPE,
    selectableAvatarCharactersCache,
    selectablePersonaAvatarsCache,
} from './constants.js';
import {
    currentGenerationCharacterId,
    currentGenerationPersonaId,
} from './generation.js';
import {
    getActiveAlterEgoForCharacter,
    getActiveAlterEgoForPersona,
    normalizePersonaAlterEgo,
} from './model.js';
import {
    readCardState,
    readPersonaCardState,
    readPersonaState,
    schedulePersonaSave,
    scheduleSave,
} from './persistence.js';
import {
    getTriggerOccurrenceKey,
} from './prompt-assembly.js';
import {
    importedGetContext,
    importedSaveSettingsDebounced,
    persona_description_positions,
    power_user,
    user_avatar,
} from './st-imports.js';
import {
    clone,
    hasOwn,
    notify,
} from './utils.js';

// ============================================================================
// Section 4. SillyTavern Context, Character, and Persona Access
// ============================================================================
// Purpose:
// - Own safe access to SillyTavern context, active character IDs, active persona IDs,
//   character records, persona records, and native Description text.
// ============================================================================

// -----------------------------------------------------------------------------
// SillyTavern Context, Character, and Persona Access - Context Resolution
// -----------------------------------------------------------------------------

export function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? importedGetContext();
}

export function getPowerUserSettings() {
    return power_user ?? getContext()?.power_user ?? getContext()?.powerUser ?? globalThis.power_user ?? null;
}

export function getSaveSettingsDebounced() {
    return (
        importedSaveSettingsDebounced ??
        getContext()?.saveSettingsDebounced ??
        globalThis.saveSettingsDebounced ??
        null
    );
}

// -----------------------------------------------------------------------------
// SillyTavern Context, Character, and Persona Access - Character Resolution
// -----------------------------------------------------------------------------

export function getActiveCharacterId() {
    const ctx = getContext();
    const id = ctx?.characterId;

    if (id === undefined || id === null || id === '') {
        return undefined;
    }

    return id;
}

export function normalizeCharacterId(characterId) {
    const text = String(characterId);

    if (/^\d+$/.test(text)) {
        return Number(text);
    }

    return characterId;
}

export function getGenerationCharacterId(options = {}) {
    const forced = options?.force_chid ?? options?.chid ?? options?.characterId;

    if (forced !== undefined && forced !== null && forced !== '') {
        return normalizeCharacterId(forced);
    }

    return getActiveCharacterId();
}

export function getMacroCharacterId() {
    if (currentGenerationCharacterId !== undefined && currentGenerationCharacterId !== null && currentGenerationCharacterId !== '') {
        return currentGenerationCharacterId;
    }

    return getActiveCharacterId();
}

export function getCharacter(characterId = getActiveCharacterId()) {
    const ctx = getContext();

    if (characterId === undefined || characterId === null || characterId === '') {
        return null;
    }

    return ctx?.characters?.[characterId] ?? null;
}

export function getNativeCharacterName(characterId = getMacroCharacterId()) {
    const character = getCharacter(characterId);
    return String(character?.name ?? character?.data?.name ?? 'this character').trim() || 'this character';
}

export function getCharacterName(characterId = getMacroCharacterId()) {
    const alterEgo = getActiveAlterEgoForCharacter(characterId);

    if (alterEgo && shouldApplyAlterEgoIdentity(characterId)) {
        const alterEgoName = String(alterEgo.name || '').trim();

        if (alterEgoName) {
            return alterEgoName;
        }
    }

    return getNativeCharacterName(characterId);
}

export function getNativeCharacterAvatarKey(characterId = getMacroCharacterId()) {
    const character = getCharacter(characterId);
    return String(character?.avatar ?? character?.data?.avatar ?? '').trim();
}

export function getCharacterAvatarThumbnailUrl(avatarKey, { bustCache = false } = {}) {
    const key = String(avatarKey || '').trim();

    if (!key || key === 'none') {
        return '';
    }

    const ctx = getContext();

    if (typeof ctx?.getThumbnailUrl === 'function') {
        return ctx.getThumbnailUrl('avatar', key, bustCache);
    }

    return `/thumbnail?type=avatar&file=${encodeURIComponent(key)}${bustCache ? `&t=${Date.now()}` : ''}`;
}

export function getSelectableAvatarCharacters() {
    const ctx = getContext();
    const characters = Array.isArray(ctx?.characters) ? ctx.characters : Object.values(ctx?.characters || {});
    const signature = characters
        .map((character) => `${String(character?.avatar ?? '').trim()}\u001f${String(character?.name ?? character?.data?.name ?? '').trim()}`)
        .join('\u001e');

    if (selectableAvatarCharactersCache.signature === signature) {
        return selectableAvatarCharactersCache.entries;
    }

    selectableAvatarCharactersCache.signature = signature;
    selectableAvatarCharactersCache.entries = characters
        .map((character, index) => ({
            index,
            name: String(character?.name ?? character?.data?.name ?? '').trim(),
            avatar: String(character?.avatar ?? '').trim(),
        }))
        .filter((entry) => entry.avatar && entry.avatar !== 'none')
        .sort((a, b) => a.name.localeCompare(b.name));

    return selectableAvatarCharactersCache.entries;
}

export function invalidateSelectableAvatarCharactersCache() {
    selectableAvatarCharactersCache.signature = '';
    selectableAvatarCharactersCache.entries = [];
}

export function getCacheKey(characterId = getActiveCharacterId()) {
    return characterId === undefined || characterId === null ? '__none__' : String(characterId);
}

export function getNativeDescriptionForCharacter(character) {
    return String(character?.description ?? character?.data?.description ?? '').trim();
}

export function getNativePersonalityForCharacter(character) {
    return String(character?.personality ?? character?.data?.personality ?? '').trim();
}

// -----------------------------------------------------------------------------
// SillyTavern Context, Character, and Persona Access - Character Collections
// -----------------------------------------------------------------------------

export function getAllCharacterIds() {
    const ctx = getContext();
    const characters = ctx?.characters;

    if (!characters || typeof characters !== 'object') {
        return [];
    }

    return Object.entries(characters)
        .filter(([, character]) => Boolean(character))
        .map(([rawCharacterId]) => normalizeCharacterId(rawCharacterId));
}

export function getCurrentGroupId() {
    const ctx = getContext();
    const groupId = ctx?.groupId ?? ctx?.selected_group ?? ctx?.selectedGroup;

    if (groupId === undefined || groupId === null || groupId === '') {
        return undefined;
    }

    return groupId;
}

export function isCurrentGroupChatOpen() {
    return getCurrentGroupId() !== undefined;
}

export function getCurrentGroup() {
    const ctx = getContext();
    const groupId = getCurrentGroupId();

    if (groupId === undefined) {
        return null;
    }

    const groups = Array.isArray(ctx?.groups)
        ? ctx.groups
        : Object.values(ctx?.groups || {});

    return groups.find((group) => {
        const possibleIds = [
            group?.id,
            group?._id,
            group?.groupId,
            group?.group_id,
            group?.name,
        ].map((value) => String(value ?? ''));

        return possibleIds.includes(String(groupId));
    }) ?? null;
}

export function getGroupMemberReferences(group) {
    if (!group || typeof group !== 'object') {
        return [];
    }

    if (Array.isArray(group.members)) {
        return group.members;
    }

    if (Array.isArray(group.characters)) {
        return group.characters;
    }

    if (Array.isArray(group.charIds)) {
        return group.charIds;
    }

    if (Array.isArray(group.characterIds)) {
        return group.characterIds;
    }

    return [];
}

export function findCharacterIdForMemberReference(memberReference) {
    const ctx = getContext();
    const characters = ctx?.characters;

    if (!characters || typeof characters !== 'object') {
        return undefined;
    }

    if (memberReference === undefined || memberReference === null || memberReference === '') {
        return undefined;
    }

    if (typeof memberReference === 'number' && characters[memberReference]) {
        return memberReference;
    }

    if (typeof memberReference === 'string' && /^\d+$/.test(memberReference) && characters[Number(memberReference)]) {
        return Number(memberReference);
    }

    if (typeof memberReference === 'object') {
        const nestedCandidates = [
            memberReference.id,
            memberReference._id,
            memberReference.characterId,
            memberReference.chid,
            memberReference.index,
            memberReference.avatar,
            memberReference.name,
            memberReference.filename,
            memberReference.file_name,
            memberReference.item?.id,
            memberReference.item?.avatar,
            memberReference.item?.name,
        ];

        for (const candidate of nestedCandidates) {
            const characterId = findCharacterIdForMemberReference(candidate);

            if (characterId !== undefined) {
                return characterId;
            }
        }

        return undefined;
    }

    const target = String(memberReference).trim().toLowerCase();

    if (!target) {
        return undefined;
    }

    for (const [rawCharacterId, character] of Object.entries(characters)) {
        if (!character) {
            continue;
        }

        const possibleValues = [
            character.avatar,
            character.name,
            character.filename,
            character.file_name,
            character.data?.name,
            character.data?.avatar,
            character.data?.filename,
            character.data?.extensions?.filename,
        ]
            .map((value) => String(value ?? '').trim().toLowerCase())
            .filter(Boolean);

        if (possibleValues.includes(target)) {
            return normalizeCharacterId(rawCharacterId);
        }
    }

    return undefined;
}

export function getCurrentChatCharacterIds() {
    const ctx = getContext();

    if (isCurrentGroupChatOpen()) {
        const group = getCurrentGroup();
        const memberReferences = getGroupMemberReferences(group);

        return [
            ...new Set(
                memberReferences
                    .map((memberReference) => findCharacterIdForMemberReference(memberReference))
                    .filter((characterId) => characterId !== undefined),
            ),
        ];
    }

    const characterId = ctx?.characterId;

    if (characterId === undefined || characterId === null || characterId === '') {
        return [];
    }

    return [normalizeCharacterId(characterId)];
}

export function getCurrentCharactersButtonLabel() {
    return isCurrentGroupChatOpen()
        ? 'Remove All Fields for Current Characters'
        : 'Remove All Fields for Current Character';
}

// -----------------------------------------------------------------------------
// SillyTavern Context, Character, and Persona Access - Persona Resolution
// -----------------------------------------------------------------------------

export function normalizePersonaId(personaId) {
    if (personaId === undefined || personaId === null || personaId === '') {
        return undefined;
    }

    if (typeof personaId === 'object') {
        const nestedCandidates = [
            personaId.avatarId,
            personaId.avatar_id,
            personaId.user_avatar,
            personaId.userAvatar,
            personaId.id,
        ];

        for (const candidate of nestedCandidates) {
            const normalized = normalizePersonaId(candidate);

            if (normalized) {
                return normalized;
            }
        }

        return undefined;
    }

    const text = String(personaId).trim();
    return text || undefined;
}

export function getPersonaIdFromDom() {
    const candidates = [
        $('#user_avatar_block .avatar-container.selected').attr('data-avatar-id'),
        $('#user_avatar_block .avatar-container.selected').data('avatar-id'),
        $('#user_avatar_block .avatar-container.selected .avatar').attr('data-avatar-id'),
        $('#user_avatar_block .avatar-container.selected .avatar').data('avatar-id'),

        $('#user_avatar_block .avatar.default_persona').attr('data-avatar-id'),
        $('#user_avatar_block .avatar.default_persona').data('avatar-id'),

        $('#persona_container .avatar-container.selected').attr('data-avatar-id'),
        $('#persona_container .avatar-container.selected').data('avatar-id'),
        $('#persona_container .avatar-container.selected .avatar').attr('data-avatar-id'),
        $('#persona_container .avatar-container.selected .avatar').data('avatar-id'),

        $('#persona_list .avatar-container.selected').attr('data-avatar-id'),
        $('#persona_list .avatar-container.selected').data('avatar-id'),
        $('#persona_list .avatar-container.selected .avatar').attr('data-avatar-id'),
        $('#persona_list .avatar-container.selected .avatar').data('avatar-id'),

        $('.persona_selected').attr('data-avatar-id'),
        $('.persona_selected').data('avatar-id'),
        $('.persona_selected .avatar').attr('data-avatar-id'),
        $('.persona_selected .avatar').data('avatar-id'),

        // Legacy/defensive fallback only.
        $('#user_avatar_block .avatar').attr('imgfile'),
        $('#user_avatar_block img').attr('imgfile'),
        $('#user_avatar').attr('imgfile'),
    ];

    for (const candidate of candidates) {
        const normalized = normalizePersonaId(candidate);

        if (normalized) {
            return normalized;
        }
    }

    return undefined;
}

export function getActivePersonaId() {
    const candidates = [
        user_avatar,
        getContext()?.user_avatar,
        getContext()?.userAvatar,
        getContext()?.personaId,
        getContext()?.activePersonaId,
        getContext()?.active_persona_id,
        getPersonaIdFromDom(),
    ];

    for (const candidate of candidates) {
        const normalized = normalizePersonaId(candidate);

        if (normalized) {
            return normalized;
        }
    }

    return undefined;
}

export function getGenerationPersonaId(options = {}) {
    const forced = (
        options?.force_persona_id ??
        options?.forcePersonaId ??
        options?.personaId ??
        options?.user_avatar ??
        options?.userAvatar
    );

    if (forced !== undefined && forced !== null && forced !== '') {
        return normalizePersonaId(forced);
    }

    return getActivePersonaId();
}

export function getMacroPersonaId() {
    if (currentGenerationPersonaId !== undefined && currentGenerationPersonaId !== null && currentGenerationPersonaId !== '') {
        return currentGenerationPersonaId;
    }

    return getActivePersonaId();
}

export function getPersonaCacheKey(personaId = getActivePersonaId()) {
    const normalized = normalizePersonaId(personaId);
    return normalized || PERSONA_STATE_UNKNOWN_KEY;
}

export function getNativePersonaName(personaId = getMacroPersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const powerUser = getPowerUserSettings();
    const ctx = getContext();

    const candidates = [
        normalizedPersonaId ? powerUser?.personas?.[normalizedPersonaId] : '',
        ctx?.name1,
        globalThis.name1,
        $('#your_name').text(),
        $('#your_name').val(),
        $('#user_name').val(),
    ];

    for (const candidate of candidates) {
        const text = String(candidate ?? '').trim();

        if (text) {
            return text;
        }
    }

    return 'the user persona';
}

export function getPersonaName(personaId = getMacroPersonaId()) {
    const alterEgo = getActiveAlterEgoForPersona(personaId);

    if (alterEgo && shouldApplyPersonaAlterEgoIdentity(personaId)) {
        const alterEgoName = String(alterEgo.name || '').trim();

        if (alterEgoName) {
            return alterEgoName;
        }
    }

    return getNativePersonaName(personaId);
}

export function getNativePersonaAvatarKey(personaId = getMacroPersonaId()) {
    return normalizePersonaId(personaId) || String(user_avatar || '').trim();
}

export function getPersonaAvatarThumbnailUrl(avatarKey, { bustCache = false } = {}) {
    const key = String(avatarKey || '').trim();

    if (!key || key === 'none') {
        return '';
    }

    const ctx = getContext();

    if (typeof ctx?.getThumbnailUrl === 'function') {
        return ctx.getThumbnailUrl('persona', key, bustCache);
    }

    return `/thumbnail?type=persona&file=${encodeURIComponent(key)}${bustCache ? `&t=${Date.now()}` : ''}`;
}

export function getSelectablePersonaAvatars() {
    const powerUser = getPowerUserSettings();
    const personaMap = powerUser?.personas && typeof powerUser.personas === 'object' ? powerUser.personas : {};
    const signature = Object.keys(personaMap)
        .sort()
        .map((avatar) => `${String(avatar || '').trim()}\u001f${String(personaMap[avatar] || '').trim()}`)
        .join('\u001e');

    if (selectablePersonaAvatarsCache.signature === signature) {
        return selectablePersonaAvatarsCache.entries;
    }

    selectablePersonaAvatarsCache.signature = signature;
    selectablePersonaAvatarsCache.entries = Object.keys(personaMap)
        .map((avatar) => ({
            avatar: String(avatar || '').trim(),
            name: String(personaMap[avatar] || avatar || '').trim(),
        }))
        .filter((entry) => entry.avatar && entry.avatar !== 'none')
        .sort((a, b) => a.name.localeCompare(b.name));

    return selectablePersonaAvatarsCache.entries;
}

export function invalidateSelectablePersonaAvatarsCache() {
    selectablePersonaAvatarsCache.signature = '';
    selectablePersonaAvatarsCache.entries = [];
}

export function readImageFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!(file instanceof File)) {
            reject(new Error('No image file selected.'));
            return;
        }

        const fileType = String(file.type || '').toLowerCase();

        if (fileType && !fileType.startsWith('image/')) {
            reject(new Error('Select an image file.'));
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}


// -----------------------------------------------------------------------------
// Alter Ego images as user files
// -----------------------------------------------------------------------------
// Images are stored once in the user's Files folder (data/<user>/user/files)
// and referenced by path. Chat messages never carry image data.

export const dataUrlFileCache = new Map();

export function toServedFileUrl(filePath) {
    const path = String(filePath || '').trim();

    if (!path) {
        return '';
    }

    return path.startsWith('/') || /^[a-z]+:/i.test(path) ? path : `/${path}`;
}

export function isDataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

export async function hashText(text) {
    try {
        const bytes = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
        return getTriggerOccurrenceKey(text).replace(/[^a-z0-9]/gi, '');
    }
}

// Uploads a data: URL to the user's Files folder (deduplicated by content hash)
// and returns its path, or '' when the upload is not possible.
export function uploadDataUrlAsUserFile(dataUrl) {
    if (!isDataUrl(dataUrl)) {
        return Promise.resolve('');
    }

    if (dataUrlFileCache.has(dataUrl)) {
        return dataUrlFileCache.get(dataUrl);
    }

    const promise = (async () => {
        const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);

        if (!match) {
            return '';
        }

        const extension = ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' })[match[1].toLowerCase()] || match[1].split('/')[1].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
        const name = `aspect-evolutia-image-${await hashText(dataUrl)}.${extension}`;
        const ctx = getContext();
        const headers = typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, data: match[2] }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return String(result?.path || '');
    })().catch((error) => {
        console.warn(`[${MODULE_NAME}] Could not store image as a file:`, error);
        dataUrlFileCache.delete(dataUrl);
        return '';
    });

    dataUrlFileCache.set(dataUrl, promise);
    return promise;
}

// Returns a URL safe to store in a chat message. Data URLs are replaced by the
// stored file (uploaded on first use); `onReady` is called if that happens later.
export function getMessageSafeAvatarUrl(avatarUrl, onReady) {
    if (!isDataUrl(avatarUrl)) {
        return avatarUrl;
    }

    uploadDataUrlAsUserFile(avatarUrl).then((path) => {
        if (path) {
            onReady?.(toServedFileUrl(path));
        }
    });

    return '';
}

// One-time migration of chat messages stamped by earlier versions with image
// data in force_avatar / extra.aspectEvolutia. SillyTavern's automatic chat
// backups keep the previous file.
export async function migrateChatImageData() {
    const chat = getLiveChat();
    let changed = false;

    for (const message of chat) {
        const extra = message?.extra?.[ALTER_EGO_EXTRA_KEY];
        const stamps = [extra?.[ALTER_EGO_MESSAGE_KEY], extra?.personaAlterEgo].filter(Boolean);
        const targets = [message?.force_avatar, ...stamps.map((stamp) => stamp.avatarUrl)].filter(isDataUrl);

        if (!targets.length) {
            continue;
        }

        for (const dataUrl of new Set(targets)) {
            const path = toServedFileUrl(await uploadDataUrlAsUserFile(dataUrl));

            if (!path) {
                continue;
            }

            if (message.force_avatar === dataUrl) {
                message.force_avatar = path;
            }

            for (const stamp of stamps) {
                if (stamp.avatarUrl === dataUrl) {
                    stamp.avatarUrl = path;
                }
            }

            for (const swipeInfo of message.swipe_info || []) {
                const swipeExtra = swipeInfo?.extra?.[ALTER_EGO_EXTRA_KEY];

                for (const stamp of [swipeExtra?.[ALTER_EGO_MESSAGE_KEY], swipeExtra?.personaAlterEgo].filter(Boolean)) {
                    if (stamp.avatarUrl === dataUrl) {
                        stamp.avatarUrl = path;
                    }
                }
            }

            changed = true;
        }
    }

    if (changed) {
        await getContext()?.saveChat?.();
        notify('info', 'Aspect: Evolutia moved alter ego images out of this chat file.');
    }
}

// One-time migration of uploaded alter ego images (IMAGE_FILE mode) stored as
// data URLs on the card or persona. 'Embedded Image Data' stays embedded.
export async function migrateAlterEgoImageData(scope, entityId) {
    const cardState = scope === TARGET_SCOPE.PERSONA ? readPersonaCardState(entityId) : readCardState(entityId);
    const pending = (cardState.alterEgos || []).filter((alterEgo) => alterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.IMAGE_FILE && isDataUrl(alterEgo.avatarDataUrl) && !alterEgo.avatarFilePath);

    if (!pending.length) {
        return;
    }

    const paths = new Map();

    for (const alterEgo of pending) {
        paths.set(alterEgo.id, await uploadDataUrlAsUserFile(alterEgo.avatarDataUrl));
    }

    const apply = (state) => {
        for (const alterEgo of state.alterEgos || []) {
            const path = paths.get(alterEgo.id);

            if (path && alterEgo.avatarDataUrl) {
                alterEgo.avatarFilePath = path;
                alterEgo.avatarDataUrl = '';
            }
        }
    };

    if (scope === TARGET_SCOPE.PERSONA) {
        const state = readPersonaCardState(entityId);
        apply(state);
        schedulePersonaSave(entityId, state);
    } else {
        const state = readCardState(entityId);
        apply(state);
        scheduleSave(entityId, state);
    }
}

export async function migrateImageDataForCurrentChat() {
    try {
        const characterId = getActiveCharacterId();
        const personaId = getActivePersonaId();

        if (characterId !== undefined) {
            await migrateAlterEgoImageData(TARGET_SCOPE.CHARACTER, characterId);
        }

        if (personaId) {
            await migrateAlterEgoImageData(TARGET_SCOPE.PERSONA, personaId);
        }

        await migrateChatImageData();
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Image migration skipped:`, error);
    }
}

export function normalizeLocalImagePath(path) {
    return String(path ?? '').trim();
}

export function probeImageReference(path) {
    const normalizedPath = normalizeLocalImagePath(path);

    return new Promise((resolve, reject) => {
        if (!normalizedPath) {
            reject(new Error('Enter a local file path first.'));
            return;
        }

        const image = new Image();
        const timeout = setTimeout(() => {
            image.onload = null;
            image.onerror = null;
            reject(new Error('Image verification timed out.'));
        }, 5000);

        image.onload = () => {
            clearTimeout(timeout);
            resolve(true);
        };

        image.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Could not load image from that path. Use a SillyTavern-served path such as files/example.png, assets/character/example.png, or another reachable relative path.'));
        };

        const separator = normalizedPath.includes('?') ? '&' : '?';
        image.src = `${normalizedPath}${separator}dsf_probe=${Date.now()}`;
    });
}

export function shouldApplyPersonaAlterEgoIdentity(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);

    if (!normalizedPersonaId) {
        return false;
    }

    const state = readPersonaState(normalizedPersonaId);
    return Boolean(state.swapEnabled && state.activeAlterEgoId);
}

export function resolvePersonaAlterEgoAvatarUrl(alterEgo, personaId = getMacroPersonaId(), { bustCache = false } = {}) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const normalized = normalizePersonaAlterEgo(alterEgo, {
        fallbackName: getNativePersonaName(normalizedPersonaId),
        fallbackAvatarKey: getNativePersonaAvatarKey(normalizedPersonaId),
    });

    switch (normalized.avatarMode) {
        case ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY:
            return getPersonaAvatarThumbnailUrl(normalized.avatarKey, { bustCache });

        case ALTER_EGO_AVATAR_MODE.IMAGE_FILE:
            return toServedFileUrl(normalized.avatarFilePath) || normalized.avatarDataUrl || getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.LOCAL_FILE:
            return normalized.avatarLocalPath || getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.URL:
            return normalized.avatarUrl || getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.DATA_URL:
            return normalized.avatarDataUrl || getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId), { bustCache });

        case ALTER_EGO_AVATAR_MODE.INHERIT:
        default:
            return getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId), { bustCache });
    }
}

export function getActivePersonaAlterEgoIdentity(personaId = getMacroPersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const alterEgo = getActiveAlterEgoForPersona(normalizedPersonaId);

    if (!alterEgo || !shouldApplyPersonaAlterEgoIdentity(normalizedPersonaId)) {
        return {
            alterEgoId: ALTER_EGO_BASE_ID,
            name: getNativePersonaName(normalizedPersonaId),
            avatarUrl: getPersonaAvatarThumbnailUrl(getNativePersonaAvatarKey(normalizedPersonaId)),
            avatarKey: getNativePersonaAvatarKey(normalizedPersonaId),
            avatarMode: ALTER_EGO_AVATAR_MODE.INHERIT,
            isAlterEgo: false,
        };
    }

    return {
        alterEgoId: alterEgo.id,
        name: String(alterEgo.name || getNativePersonaName(normalizedPersonaId)).trim() || getNativePersonaName(normalizedPersonaId),
        avatarUrl: resolvePersonaAlterEgoAvatarUrl(alterEgo, normalizedPersonaId),
        avatarKey: String(alterEgo.avatarKey || '').trim(),
        avatarMode: alterEgo.avatarMode,
        isAlterEgo: alterEgo.id !== ALTER_EGO_BASE_ID,
    };
}

export function getPersonaDescriptionObject(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const powerUser = getPowerUserSettings();

    if (!normalizedPersonaId || !powerUser || typeof powerUser !== 'object') {
        return null;
    }

    const existing = powerUser.persona_descriptions?.[normalizedPersonaId];

    if (existing && typeof existing === 'object') {
        return existing;
    }

    if (typeof existing === 'string') {
        return {
            description: existing,
            position: persona_description_positions.IN_PROMPT,
        };
    }

    return null;
}

export function getActivePersonaDescriptionObject() {
    const personaId = getActivePersonaId();
    const descriptionObject = getPersonaDescriptionObject(personaId);

    if (descriptionObject) {
        return descriptionObject;
    }

    const powerUser = getPowerUserSettings();

    if (!powerUser || typeof powerUser !== 'object') {
        return null;
    }

    return {
        description: powerUser.persona_description ?? '',
        position: powerUser.persona_description_position ?? persona_description_positions.IN_PROMPT,
        depth: powerUser.persona_description_depth,
        role: powerUser.persona_description_role,
        lorebook: powerUser.persona_description_lorebook,
    };
}

export function getNativePersonaDescriptionForPersona(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const activePersonaId = normalizePersonaId(getActivePersonaId());

    const descriptionObject = normalizedPersonaId === activePersonaId
        ? getActivePersonaDescriptionObject()
        : getPersonaDescriptionObject(normalizedPersonaId);

    return String(descriptionObject?.description ?? '').trim();
}

export function getPersonaDescriptionPosition(personaId = getActivePersonaId()) {
    const normalizedPersonaId = normalizePersonaId(personaId);
    const activePersonaId = normalizePersonaId(getActivePersonaId());

    const descriptionObject = normalizedPersonaId === activePersonaId
        ? getActivePersonaDescriptionObject()
        : getPersonaDescriptionObject(normalizedPersonaId);

    const rawPosition = descriptionObject?.position;

    if (rawPosition === undefined || rawPosition === null || rawPosition === '') {
        return persona_description_positions.IN_PROMPT;
    }

    const numeric = Number(rawPosition);

    if (Number.isFinite(numeric)) {
        return numeric;
    }

    return String(rawPosition).trim();
}

export function isPersonaDescriptionInPromptManagerPosition(personaId = getActivePersonaId()) {
    const position = getPersonaDescriptionPosition(personaId);

    if (position === persona_description_positions.IN_PROMPT) {
        return true;
    }

    const text = String(position).trim().toLowerCase();

    return [
        String(persona_description_positions.IN_PROMPT),
        'in_prompt',
        'prompt',
        'prompt_manager',
        'story_string',
        'in story string',
        'in story string / prompt manager',
    ].includes(text);
}

export function getAllPersonaIds() {
    const powerUser = getPowerUserSettings();

    if (!powerUser || typeof powerUser !== 'object') {
        const activePersonaId = getActivePersonaId();
        return activePersonaId ? [activePersonaId] : [];
    }

    const ids = new Set();

    for (const key of Object.keys(powerUser.personas || {})) {
        const normalized = normalizePersonaId(key);

        if (normalized) {
            ids.add(normalized);
        }
    }

    for (const key of Object.keys(powerUser.persona_descriptions || {})) {
        const normalized = normalizePersonaId(key);

        if (normalized) {
            ids.add(normalized);
        }
    }

    const activePersonaId = getActivePersonaId();

    if (activePersonaId) {
        ids.add(activePersonaId);
    }

    return [...ids];
}

export function getCurrentPersonaIds() {
    const personaId = getActivePersonaId();
    return personaId ? [personaId] : [];
}

export function getCurrentPersonaButtonLabel() {
    return 'Remove All Fields for Current Persona';
}

// -----------------------------------------------------------------------------
// SillyTavern Context, Character, and Persona Access - Persona Extension Storage
// -----------------------------------------------------------------------------

// Persona Dynamic Fields live in extension_settings[MODULE_NAME].personaDynamicFields.
// Versions up to 1.3.1 stored them in power_user[MODULE_NAME]; that copy is
// migrated once and left in place (marked migrated) as a backup.
export function getExtensionSettingsRoot({ create = false } = {}) {
    const extensionSettings = getContext()?.extensionSettings;

    if (!extensionSettings || typeof extensionSettings !== 'object') {
        return null;
    }

    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        if (!create) {
            return null;
        }

        extensionSettings[MODULE_NAME] = {};
    }

    return extensionSettings[MODULE_NAME];
}

export function migrateLegacyPersonaStorage() {
    const powerUser = getPowerUserSettings();
    const legacyRoot = powerUser?.[MODULE_NAME];
    const legacyRecords = legacyRoot?.[PERSONA_STATE_SETTINGS_KEY];

    if (!legacyRecords || typeof legacyRecords !== 'object' || legacyRoot.migratedToExtensionSettings) {
        return false;
    }

    const root = getExtensionSettingsRoot({ create: true });

    if (!root) {
        return false;
    }

    root[PERSONA_STATE_SETTINGS_KEY] ??= {};

    for (const [personaId, record] of Object.entries(legacyRecords)) {
        if (!hasOwn(root[PERSONA_STATE_SETTINGS_KEY], personaId)) {
            root[PERSONA_STATE_SETTINGS_KEY][personaId] = clone(record);
        }
    }

    legacyRoot.migratedToExtensionSettings = new Date().toISOString();
    getSaveSettingsDebounced()?.();
    return true;
}

export function getPersonaExtensionRoot({ create = false } = {}) {
    migrateLegacyPersonaStorage();
    const root = getExtensionSettingsRoot({ create });

    if (!root) {
        return null;
    }

    if (!root[PERSONA_STATE_SETTINGS_KEY] || typeof root[PERSONA_STATE_SETTINGS_KEY] !== 'object') {
        if (!create) {
            return null;
        }

        root[PERSONA_STATE_SETTINGS_KEY] = {};
    }

    return root[PERSONA_STATE_SETTINGS_KEY];
}

export function getPersonaExtensionStateRecord(personaId = getActivePersonaId()) {
    const key = getPersonaCacheKey(personaId);
    const root = getPersonaExtensionRoot();

    if (!root || typeof root !== 'object') {
        return undefined;
    }

    return root[key];
}

export function setPersonaExtensionStateRecord(personaId, state) {
    const key = getPersonaCacheKey(personaId);
    const root = getPersonaExtensionRoot({ create: true });

    if (!root || typeof root !== 'object') {
        return false;
    }

    root[key] = state;
    return true;
}

export function deletePersonaExtensionStateRecord(personaId) {
    const key = getPersonaCacheKey(personaId);
    const root = getPersonaExtensionRoot();

    if (!root || typeof root !== 'object') {
        return false;
    }

    delete root[key];
    return true;
}

// ============================================================================
