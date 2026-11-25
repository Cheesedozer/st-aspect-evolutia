// ============================================================================
// ============================================================================
// SillyTavern Extension - Aspect: Evolutia                  created by Genisai
// ============================================================================
// ============================================================================
//
// Entry point. The extension code lives in src/; see src/*.js.
import {
    observeDom,
    registerEvents,
} from './src/events.js';
import {
    registerAspectMacro,
    syncPromptManagerWithActiveState,
} from './src/prompt-manager.js';
import {
    loadManifestMetadata,
    mountExtensionSettings,
    updateSettingsActionState,
} from './src/settings-drawer.js';
import {
    mountUi,
} from './src/ui-render.js';

// Module state (written only by this module).
let booted = false;


// ============================================================================
// Section 19. Extension Activation
// ============================================================================
// Purpose:
// - Own one-time startup for Aspect: Evolutia.
// ============================================================================

// -----------------------------------------------------------------------------
// Extension Activation - Boot
// -----------------------------------------------------------------------------

function boot() {
    if (booted) {
        return;
    }

    booted = true;

    registerAspectMacro();
    loadManifestMetadata();
    registerEvents();
    observeDom();

    jQuery(() => {
        mountExtensionSettings();
        mountUi();
        updateSettingsActionState();
        syncPromptManagerWithActiveState();
    });
}

// -----------------------------------------------------------------------------
// Extension Activation - SillyTavern Entry Point
// -----------------------------------------------------------------------------

boot();
