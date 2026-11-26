// Aspect: Evolutia — SillyTavern imports (paths are relative to src/).

// ============================================================================
// Section 1. Imports
// ============================================================================
// Owns all external dependencies used by this extension file.
// ============================================================================

import {
    saveSettingsDebounced as importedSaveSettingsDebounced,
    setCharacterName as importedSetCharacterName,
} from '../../../../../script.js';
import { getContext as importedGetContext } from '../../../../extensions.js';
import { promptManager } from '../../../../openai.js';
import { MacrosParser } from '../../../../macros.js';
import { user_avatar } from '../../../../personas.js';
import { persona_description_positions, power_user } from '../../../../power-user.js';


export {
    importedSaveSettingsDebounced,
    importedSetCharacterName,
    importedGetContext,
    promptManager,
    MacrosParser,
    user_avatar,
    persona_description_positions,
    power_user,
};
