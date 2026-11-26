// Aspect: Evolutia — alter-ego-scope.js
// Everything that differs between the character and the persona alter ego UI:
// element ids, CSS class prefix, wording, and which state functions to call.
// The alter ego panel (ui-render.js) and its handlers (ui-events.js) are
// written once against this object.
import { TARGET_SCOPE, UI } from './constants.js';
import { getActivePersonaAlterEgoIdentity, getActivePersonaId } from './context.js';
import {
    createBlankAlterEgoForScope,
    createBaseAlterEgoForScope,
    deleteAlterEgoByIdForScope,
    normalizeCharacterState,
    normalizePersonaState,
} from './model.js';
import { readState, readPersonaState, updateState, updatePersonaState } from './persistence.js';
import {
    getActiveAlterEgoIdentity,
    scheduleActiveAlterEgoVisualIdentityRefresh,
    scheduleActivePersonaAlterEgoVisualIdentityRefresh,
} from './alter-ego-identity.js';
import {
    renderAlterEgoAvatarKeyOptions,
    renderAlterEgoAvatarModeOptions,
    renderPersonaAlterEgoAvatarKeyOptions,
    renderPersonaAlterEgoAvatarModeOptions,
} from './ui-render.js';

export function getAlterEgoScope(targetScope) {
    const persona = targetScope === TARGET_SCOPE.PERSONA;

    return {
        targetScope: persona ? TARGET_SCOPE.PERSONA : TARGET_SCOPE.CHARACTER,
        persona,
        id: (suffix) => UI[`${persona ? 'PERSONA_' : ''}ALTER_EGO_${suffix}`],
        cls: persona ? 'dsf-persona-alter-ego' : 'dsf-alter-ego',
        label: persona ? 'Persona Alter Ego' : 'Alter Ego',
        lowerLabel: persona ? 'persona alter ego' : 'alter ego',
        ownerNoun: persona ? 'the SillyTavern persona' : 'the character card',
        imageNoun: persona ? 'Persona' : 'Character',
        read: (...args) => (persona ? readPersonaState(...args) : readState(...args)),
        update: (mutator, options) => (persona ? updatePersonaState(mutator, options) : updateState(mutator, options)),
        normalizeState: (state) => (persona ? normalizePersonaState(state, { personaId: getActivePersonaId() }) : normalizeCharacterState(state)),
        createBase: () => createBaseAlterEgoForScope(targetScope),
        createBlank: (existing, options) => createBlankAlterEgoForScope(targetScope, existing, options),
        deleteById: (state, alterEgoId) => deleteAlterEgoByIdForScope(targetScope, state, alterEgoId),
        getIdentity: () => (persona ? getActivePersonaAlterEgoIdentity(getActivePersonaId()) : getActiveAlterEgoIdentity()),
        scheduleVisualRefresh: () => (persona ? scheduleActivePersonaAlterEgoVisualIdentityRefresh() : scheduleActiveAlterEgoVisualIdentityRefresh()),
        renderAvatarKeyOptions: (value) => (persona ? renderPersonaAlterEgoAvatarKeyOptions(value) : renderAlterEgoAvatarKeyOptions(value)),
        renderAvatarModeOptions: (value) => (persona ? renderPersonaAlterEgoAvatarModeOptions(value) : renderAlterEgoAvatarModeOptions(value)),
    };
}
