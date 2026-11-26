// Aspect: Evolutia — constants.js (split from the former single index.js).

// ============================================================================
// Section 2. Module Constants and State
// ============================================================================
// Purpose:
// - Own stable identifiers, default settings, UI element IDs, and runtime state.
// ============================================================================

export const MODULE_NAME = 'st-description-swap-fields';

export const TARGET_SCOPE = Object.freeze({
    CHARACTER: 'character',
    PERSONA: 'persona',
});

export const CHARACTER_ASPECT_PROMPT_ID = 'aspectEvolutiaCharDescription';
export const CHARACTER_ASPECT_PROMPT_NAME = 'Char Description (Evolutia)';
export const CHARACTER_ASPECT_MACRO_NAME = 'aspectEvolutiaCharDescription';
export const CHARACTER_ASPECT_MACRO_TEXT = `{{${CHARACTER_ASPECT_MACRO_NAME}}}`;

export const PERSONA_ASPECT_PROMPT_ID = 'aspectEvolutiaPersonaDescription';
export const PERSONA_ASPECT_PROMPT_NAME = 'Persona Description (Evolutia)';
export const PERSONA_ASPECT_MACRO_NAME = 'aspectEvolutiaPersonaDescription';
export const PERSONA_ASPECT_MACRO_TEXT = `{{${PERSONA_ASPECT_MACRO_NAME}}}`;

export const ASPECT_INTERCEPTOR_NAME = 'aspectEvolutiaGenerateInterceptor';

export const NATIVE_DESCRIPTION_PROMPT_ID = 'charDescription';
export const NATIVE_PERSONA_PROMPT_ID = 'personaDescription';

export const KEYWORD_MODE = Object.freeze({
    ANY: 'any',
    ALL: 'all',
});

// How a keyword is found in the scanned text. Fields/alter egos saved before
// this setting existed keep the old 'substring' behaviour; new ones use
// whole words. A keyword written as /pattern/flags on its own line is a regex.
export const KEYWORD_MATCHING = Object.freeze({
    WORDS: 'words',
    SUBSTRING: 'substring',
});

export const TRIGGER_SOURCE = Object.freeze({
    QUIET_PROMPTS: 'quiet_prompts',
    SYSTEM_PROMPTS: 'system_prompts',
    LAST_ASSISTANT_MESSAGE: 'last_assistant_message',
    LAST_USER_MESSAGE: 'last_user_message',
    WORLD_INFO_LOREBOOKS: 'world_info_lorebooks',
});

export const LEGACY_TRIGGER_SOURCE_ALIASES = Object.freeze({
    assistant_messages: TRIGGER_SOURCE.LAST_ASSISTANT_MESSAGE,
    world_info: TRIGGER_SOURCE.WORLD_INFO_LOREBOOKS,
    lorebooks: TRIGGER_SOURCE.WORLD_INFO_LOREBOOKS,
});

export const TRIGGER_SOURCE_LABELS = Object.freeze({
    // Stored ids are kept for compatibility; the labels describe what is read.
    [TRIGGER_SOURCE.QUIET_PROMPTS]: 'Extension Injections',
    [TRIGGER_SOURCE.SYSTEM_PROMPTS]: 'Last Narrator Message (/sys)',
    [TRIGGER_SOURCE.LAST_ASSISTANT_MESSAGE]: 'Last Assistant Message',
    [TRIGGER_SOURCE.LAST_USER_MESSAGE]: 'Last User Message',
    [TRIGGER_SOURCE.WORLD_INFO_LOREBOOKS]: 'World Info / Lorebooks',
});

export const ALTER_EGO_BASE_ID = 'base';
export const ALTER_EGO_EXTRA_KEY = 'aspectEvolutia';
export const ALTER_EGO_MESSAGE_KEY = 'alterEgo';

export const ALTER_EGO_AVATAR_MODE = Object.freeze({
    INHERIT: 'inherit',
    SAME_AVATAR_DIRECTORY: 'same_avatar_directory',
    IMAGE_FILE: 'image_file',
    LOCAL_FILE: 'local_file',
    URL: 'url',
    DATA_URL: 'data_url',
});

export const ALTER_EGO_AVATAR_MODE_LABELS = Object.freeze({
    [ALTER_EGO_AVATAR_MODE.INHERIT]: 'This Character Image',
    [ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY]: 'Other Character Image',
    [ALTER_EGO_AVATAR_MODE.IMAGE_FILE]: 'Upload File',
    [ALTER_EGO_AVATAR_MODE.LOCAL_FILE]: 'Local File',
    [ALTER_EGO_AVATAR_MODE.URL]: 'Image URL',
    [ALTER_EGO_AVATAR_MODE.DATA_URL]: 'Embedded Image Data',
});

export const PERSONA_ALTER_EGO_AVATAR_MODE_LABELS = Object.freeze({
    [ALTER_EGO_AVATAR_MODE.INHERIT]: 'This Persona Image',
    [ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY]: 'Other Persona Image',
    [ALTER_EGO_AVATAR_MODE.IMAGE_FILE]: 'Upload File',
    [ALTER_EGO_AVATAR_MODE.LOCAL_FILE]: 'Local File',
    [ALTER_EGO_AVATAR_MODE.URL]: 'Image URL',
    [ALTER_EGO_AVATAR_MODE.DATA_URL]: 'Embedded Image Data',
});

export const ALTER_EGO_SWAP_MODE = Object.freeze({
    MANUAL: 'manual',
    TRIGGERED: 'triggered',
});

export const ALTER_EGO_DEFAULT_NAME = 'Base';

export const DEFAULT_TRIGGER_SOURCES = Object.freeze([
    TRIGGER_SOURCE.LAST_USER_MESSAGE,
]);

export const IMPORT_SOURCE = Object.freeze({
    CHARACTER_CARD: 'character_card',
    NATIVE_FIELDS: 'native_fields',
    PERSONA_DESCRIPTION: 'persona_description',
    FILE_JSON: 'file_json',
    CLIPBOARD_JSON: 'clipboard_json',
});

export const EXPORT_TARGET = Object.freeze({
    FILE_JSON: 'file_json',
    CLIPBOARD_JSON: 'clipboard_json',
});

export const NATIVE_IMPORT_HEADINGS = new Set([
    'appearance',
    'backstory',
    'background',
    'personality',
    'scenario',
    'relationships',
    'relationship',
    'knowledge',
    'abilities',
    'ability',
    'powers',
    'power',
    'combat style',
    'inventory',
    'stats',
    'attributes',
    'rules',
    'behavior',
    'behaviour',
]);

export const PERSONA_STATE_SETTINGS_KEY = 'personaDynamicFields';
export const PERSONA_STATE_UNKNOWN_KEY = '__unknown_persona__';

export const UI = Object.freeze({
    STYLE_ID: 'dsf_style',

    // Character editor UI
    BAR_ID: 'dsf_swap_bar',
    PANEL_ID: 'dsf_panel',
    BOTTOM_ACTIONS_ID: 'dsf_bottom_actions',
    TOKEN_ROW_ID: 'dsf_token_row',
    SWAP_ID: 'dsf_swap_enabled',
    DELETE_ALL_TOP_ID: 'dsf_delete_all_fields_top',
    ADD_TOP_ID: 'dsf_add_field_top',
    ADD_BOTTOM_ID: 'dsf_add_field_bottom',
    IMPORT_ID: 'dsf_import',
    IMPORT_MENU_ID: 'dsf_import_menu',
    EXPORT_ID: 'dsf_export',
    EXPORT_MENU_ID: 'dsf_export_menu',
    CHARACTER_CARD_IMPORT_FILE_ID: 'dsf_character_card_import_file',
    DYNAMIC_FIELDS_IMPORT_FILE_ID: 'dsf_dynamic_fields_import_file',
    TOKEN_ID: 'dsf_token_estimate',

    ALTER_EGO_ROW_ID: 'dsf_alter_ego_row',
    ALTER_EGO_SELECT_ID: 'dsf_alter_ego_select',
    ALTER_EGO_CREATE_ID: 'dsf_create_alter_ego',
    ALTER_EGO_DUPLICATE_ID: 'dsf_duplicate_alter_ego',
    ALTER_EGO_RENAME_ID: 'dsf_rename_alter_ego',
    ALTER_EGO_DELETE_ID: 'dsf_delete_alter_ego',
    ALTER_EGO_KEYWORD_TRIGGERS_BUTTON_ID: 'dsf_alter_ego_keyword_triggers_button',
    ALTER_EGO_TRIGGER_SOURCES_BUTTON_ID: 'dsf_alter_ego_trigger_sources_button',
    ALTER_EGO_AVATAR_MODE_ID: 'dsf_alter_ego_avatar_mode',
    ALTER_EGO_AVATAR_KEY_ID: 'dsf_alter_ego_avatar_key',
    ALTER_EGO_AVATAR_URL_ID: 'dsf_alter_ego_avatar_url',
    ALTER_EGO_IMAGE_FILE_INPUT_ID: 'dsf_alter_ego_image_file_input',
    ALTER_EGO_IMAGE_FILE_BUTTON_ID: 'dsf_alter_ego_image_file_button',
    ALTER_EGO_LOCAL_FILE_PATH_ID: 'dsf_alter_ego_local_file_path',
    ALTER_EGO_LOCAL_FILE_VERIFY_ID: 'dsf_alter_ego_local_file_verify',
    ALTER_EGO_AVATAR_PREVIEW_ID: 'dsf_alter_ego_avatar_preview',

    // Persona management UI
    PERSONA_BAR_ID: 'dsf_persona_swap_bar',
    PERSONA_PANEL_ID: 'dsf_persona_panel',
    PERSONA_BOTTOM_ACTIONS_ID: 'dsf_persona_bottom_actions',
    PERSONA_TOKEN_ROW_ID: 'dsf_persona_token_row',
    PERSONA_SWAP_ID: 'dsf_persona_swap_enabled',
    PERSONA_DELETE_ALL_TOP_ID: 'dsf_persona_delete_all_fields_top',
    PERSONA_ADD_TOP_ID: 'dsf_persona_add_field_top',
    PERSONA_ADD_BOTTOM_ID: 'dsf_persona_add_field_bottom',
    PERSONA_IMPORT_ID: 'dsf_persona_import',
    PERSONA_IMPORT_MENU_ID: 'dsf_persona_import_menu',
    PERSONA_EXPORT_ID: 'dsf_persona_export',
    PERSONA_EXPORT_MENU_ID: 'dsf_persona_export_menu',
    PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID: 'dsf_persona_dynamic_fields_import_file',
    PERSONA_TOKEN_ID: 'dsf_persona_token_estimate',

    PERSONA_ALTER_EGO_ROW_ID: 'dsf_persona_alter_ego_row',
    PERSONA_ALTER_EGO_SELECT_ID: 'dsf_persona_alter_ego_select',
    PERSONA_ALTER_EGO_CREATE_ID: 'dsf_persona_create_alter_ego',
    PERSONA_ALTER_EGO_DUPLICATE_ID: 'dsf_persona_duplicate_alter_ego',
    PERSONA_ALTER_EGO_RENAME_ID: 'dsf_persona_rename_alter_ego',
    PERSONA_ALTER_EGO_DELETE_ID: 'dsf_persona_delete_alter_ego',
    PERSONA_ALTER_EGO_KEYWORD_TRIGGERS_BUTTON_ID: 'dsf_persona_alter_ego_keyword_triggers_button',
    PERSONA_ALTER_EGO_TRIGGER_SOURCES_BUTTON_ID: 'dsf_persona_alter_ego_trigger_sources_button',
    PERSONA_ALTER_EGO_AVATAR_MODE_ID: 'dsf_persona_alter_ego_avatar_mode',
    PERSONA_ALTER_EGO_AVATAR_KEY_ID: 'dsf_persona_alter_ego_avatar_key',
    PERSONA_ALTER_EGO_AVATAR_URL_ID: 'dsf_persona_alter_ego_avatar_url',
    PERSONA_ALTER_EGO_IMAGE_FILE_INPUT_ID: 'dsf_persona_alter_ego_image_file_input',
    PERSONA_ALTER_EGO_IMAGE_FILE_BUTTON_ID: 'dsf_persona_alter_ego_image_file_button',
    PERSONA_ALTER_EGO_LOCAL_FILE_PATH_ID: 'dsf_persona_alter_ego_local_file_path',
    PERSONA_ALTER_EGO_LOCAL_FILE_VERIFY_ID: 'dsf_persona_alter_ego_local_file_verify',
    PERSONA_ALTER_EGO_AVATAR_PREVIEW_ID: 'dsf_persona_alter_ego_avatar_preview',

    // Extension drawer UI
    SETTINGS_ID: 'dsf_extension_settings',
    SETTINGS_VERSION_ID: 'dsf_settings_version',
    SETTINGS_AUTHOR_ID: 'dsf_settings_author',

    SETTINGS_CHARACTER_BOX_ID: 'dsf_settings_character_box',
    SETTINGS_CHARACTER_REMOVE_FIELDS_ID: 'dsf_character_remove_all_fields',
    SETTINGS_CHARACTER_REMOVE_CURRENT_FIELDS_ID: 'dsf_character_remove_current_fields',
    SETTINGS_CHARACTER_RESET_EXTENSION_ID: 'dsf_character_reset_extension',

    SETTINGS_PERSONA_BOX_ID: 'dsf_settings_persona_box',
    SETTINGS_PERSONA_REMOVE_FIELDS_ID: 'dsf_persona_remove_all_fields',
    SETTINGS_PERSONA_REMOVE_CURRENT_FIELDS_ID: 'dsf_persona_remove_current_fields',
    SETTINGS_PERSONA_RESET_EXTENSION_ID: 'dsf_persona_reset_extension',

    SETTINGS_RESTORE_MACROS_ID: 'dsf_restore_description_macros',
    SETTINGS_PROPOSAL_PROFILE_ID: 'dsf_proposal_profile',
    SETTINGS_PROPOSAL_MESSAGES_ID: 'dsf_proposal_messages',
    SETTINGS_PROPOSAL_TOKENS_ID: 'dsf_proposal_tokens',
    SETTINGS_TEXT_COMPLETION_NOTE_ID: 'dsf_text_completion_note',
});

export const DEFAULT_STATE = Object.freeze({
    swapEnabled: false,
    initializedDefaults: false,
    fields: [],
    activeAlterEgoId: ALTER_EGO_BASE_ID,
    alterEgos: [],
});

export const DEFAULT_MANIFEST_META = Object.freeze({
    version: '0.0.0',
    author: 'Genisai',
});

export const STANDARD_TOKEN_COUNTER_SELECTORS = [
    '#result_info',
    '#result_info_total',
    '#result_info_permanent',
    '#character_tokens',
    '#character_token_counter',
    '#char_token_counter',
    '.result_info',
    '.tokenCounterDisplay',
    '.character_tokens',
    '.character-token-counter',
    '.char-token-counter',
    '.tokens_total',
    '.tokens_permanent',
    '[data-token-counter]',
    '[data-testid="character-token-counter"]',
];

export const PERSONA_TOKEN_COUNTER_SELECTORS = [
    '#persona_description_tokens',
    '#persona_description_token_counter',
    '#persona_token_counter',
    '#persona_tokens',
    '.persona_description_tokens',
    '.persona-description-tokens',
    '.persona_token_counter',
    '.persona-token-counter',
    '.persona_tokens',
    '.persona-tokens',
    '[data-persona-token-counter]',
    '[data-testid="persona-description-token-counter"]',
];


export const FIELD_DRAG_AUTOSCROLL_MARGIN = 80;
export const FIELD_DRAG_AUTOSCROLL_MAX_SPEED = 22;
export const FIELD_EDIT_TOKEN_ESTIMATE_DEBOUNCE_MS = 800;
export const FIELD_EDIT_SETTINGS_ACTION_DEBOUNCE_MS = 800;
export const ALTER_EGO_VISUAL_REFRESH_DEBOUNCE_MS = 200;

export const FIELD_EDIT_INPUT_UPDATE_OPTIONS = Object.freeze({
    rerender: false,
    deferTokenEstimate: true,
    deferSettingsActionState: true,
});

export const stateCache = new Map();
export const personaStateCache = new Map();
export const selectableAvatarCharactersCache = { signature: '', entries: [] };
export const selectablePersonaAvatarsCache = { signature: '', entries: [] };
export const preparedPromptCache = new Map();
