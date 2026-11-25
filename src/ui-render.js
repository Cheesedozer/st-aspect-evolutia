// Aspect: Evolutia — ui-render.js (split from the former single index.js).
import { getAlterEgoScope } from './alter-ego-scope.js';
import { isChatOpenForRuntime } from './chat-runtime.js';
import { splitKeywords } from './prompt-assembly.js';
import {
    ALTER_EGO_AVATAR_MODE,
    ALTER_EGO_AVATAR_MODE_LABELS,
    ALTER_EGO_BASE_ID,
    ALTER_EGO_DEFAULT_NAME,
    EXPORT_TARGET,
    IMPORT_SOURCE,
    KEYWORD_MATCHING,
    KEYWORD_MODE,
    PERSONA_ALTER_EGO_AVATAR_MODE_LABELS,
    PERSONA_TOKEN_COUNTER_SELECTORS,
    STANDARD_TOKEN_COUNTER_SELECTORS,
    TARGET_SCOPE,
    TRIGGER_SOURCE,
    TRIGGER_SOURCE_LABELS,
    UI,
} from './constants.js';
import {
    getActiveCharacterId,
    getActivePersonaId,
    getSelectableAvatarCharacters,
    getSelectablePersonaAvatars,
    toServedFileUrl,
} from './context.js';
import {
    createOutOfBoxPersonaState,
    getActiveAlterEgo,
    normalizeCharacterField,
    normalizeKeywordMatching,
    normalizePersonaField,
    normalizeTriggerSources,
} from './model.js';
import {
    readPersonaState,
    readState,
} from './persistence.js';
import {
    updatePersonaTokenEstimate,
    updateTokenEstimate,
} from './token-estimate.js';
import {
    bindPersonaUiHandlers,
    bindUiHandlers,
} from './ui-events.js';
import {
    escapeAttribute,
    escapeTextarea,
    getPositionInputWidth,
} from './utils.js';

// ============================================================================
// Section 14. User Interface Rendering
// ============================================================================
// Purpose:
// - Own CSS, DOM mounting, field-list rendering, and visibility rules.
// - Character UI mounts near the Character Description field.
// - Persona UI mounts immediately before SillyTavern's native Persona
//   Description + Position block, which places it beneath Current Persona's
//   More... row and above the native Persona Description controls.
// - Character Dynamic Fields include Trigger Actions.
// - Persona Dynamic Fields intentionally omit Trigger Actions.
// - Event handlers may call this after state changes.
// ============================================================================

// -----------------------------------------------------------------------------
// User Interface Rendering - Character Description Textarea Lookup
// -----------------------------------------------------------------------------

export function getDescriptionTextarea() {
    return $('#description_textarea, textarea[name="description"], textarea[data-name="description"]').first();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Description Textarea Lookup
// -----------------------------------------------------------------------------

export function getPersonaDescriptionTextarea() {
    const directSelectors = [
        '#persona_description',
        '#persona_description_textarea',
        'textarea[name="persona_description"]',
        'textarea[name="personaDescription"]',
        'textarea[data-name="persona_description"]',
        'textarea[data-name="personaDescription"]',
        'textarea[data-testid="persona-description"]',
    ];

    for (const selector of directSelectors) {
        const $match = $(selector).filter('textarea').first();

        if ($match.length) {
            return $match;
        }
    }

    const containerSelectors = [
        '#persona_description_block',
        '#persona_description_container',
        '#persona_description_holder',
        '.persona_description',
        '.persona-description',
        '[data-testid="persona-description-container"]',
    ];

    for (const selector of containerSelectors) {
        const $textarea = $(selector).find('textarea').first();

        if ($textarea.length) {
            return $textarea;
        }
    }

    const $root = getPersonaEditorRootFromDocument();

    if ($root.length) {
        const $textarea = $root
            .find('textarea')
            .filter(function findPersonaDescriptionTextareaByContext() {
                const id = String(this.id || '').toLowerCase();
                const name = String(this.getAttribute('name') || '').toLowerCase();
                const dataName = String(this.getAttribute('data-name') || '').toLowerCase();
                const ariaLabel = String(this.getAttribute('aria-label') || '').toLowerCase();
                const placeholder = String(this.getAttribute('placeholder') || '').toLowerCase();
                const joined = `${id} ${name} ${dataName} ${ariaLabel} ${placeholder}`;

                return joined.includes('persona') && joined.includes('description');
            })
            .first();

        if ($textarea.length) {
            return $textarea;
        }
    }

    return $();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Character Editor Root and Token Counter Lookup
// -----------------------------------------------------------------------------

export function getCharacterEditorRoot() {
    const $description = getDescriptionTextarea();
    const $root = $description
        .closest('#character_popup, #rm_ch_create_block, #character_edit_dialogue, .character_popup, .character_editor')
        .first();

    return $root.length ? $root : $description.parent();
}

export function getStandardCharacterTokenCounters() {
    const $root = getCharacterEditorRoot();

    if (!$root.length) {
        return $();
    }

    const $selectorMatches = $root
        .find(STANDARD_TOKEN_COUNTER_SELECTORS.join(','))
        .not(`#${UI.BAR_ID}`)
        .not(`#${UI.BAR_ID} *`)
        .not(`#${UI.PERSONA_BAR_ID}`)
        .not(`#${UI.PERSONA_BAR_ID} *`);

    const $textMatches = $root
        .find('div, span, small, label')
        .filter(function filterTokenCounterText() {
            if ($(this).closest(`#${UI.BAR_ID}, #${UI.PERSONA_BAR_ID}`).length) {
                return false;
            }

            const id = String(this.id || '').toLowerCase();
            const className = typeof this.className === 'string'
                ? this.className
                : String(this.className?.baseVal || '');
            const idClass = `${id} ${className}`.toLowerCase();
            const text = String($(this).text() || '').trim();

            return idClass.includes('token') && /token|permanent/i.test(text);
        });

    return $selectorMatches.add($textMatches);
}

export function setStandardTokenCounterHidden(hidden) {
    getStandardCharacterTokenCounters().each(function toggleStandardTokenCounter() {
        const $element = $(this);

        if (hidden) {
            if (!$element.attr('data-dsf-original-display')) {
                $element.attr('data-dsf-original-display', $element.css('display') || '');
            }

            $element.css('display', 'none');
            return;
        }

        const originalDisplay = $element.attr('data-dsf-original-display');

        if (originalDisplay !== undefined) {
            $element.css('display', originalDisplay === 'none' ? '' : originalDisplay);
            $element.removeAttr('data-dsf-original-display');
        }
    });
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Editor Root and Token Counter Lookup
// -----------------------------------------------------------------------------

export function getPersonaEditorRootFromDocument() {
    const rootSelectors = [
        '#persona-management-button .drawer-content',
        '#persona_management',
        '#persona-management',
        '#persona_settings',
        '#persona-settings',
        '#persona_panel',
        '#persona-panel',
        '#persona_container',
        '#persona-container',
        '#user_avatar_block',
        '#user-settings-block',
        '.persona_management',
        '.persona-management',
        '.persona_settings',
        '.persona-settings',
        '.persona_editor',
        '.persona-editor',
    ];

    for (const selector of rootSelectors) {
        const $root = $(selector).first();

        if ($root.length) {
            return $root;
        }
    }

    return $();
}

export function getPersonaEditorRoot() {
    const $description = getPersonaDescriptionTextarea();
    const $root = $description
        .closest(
            [
                '#persona-management-button .drawer-content',
                '#persona_management',
                '#persona-management',
                '#persona_settings',
                '#persona-settings',
                '#persona_panel',
                '#persona-panel',
                '#persona_container',
                '#persona-container',
                '#user_avatar_block',
                '#user-settings-block',
                '.persona_management',
                '.persona-management',
                '.persona_settings',
                '.persona-settings',
                '.persona_editor',
                '.persona-editor',
                '.inline-drawer-content',
            ].join(', '),
        )
        .first();

    if ($root.length) {
        return $root;
    }

    const $documentRoot = getPersonaEditorRootFromDocument();

    return $documentRoot.length ? $documentRoot : $description.parent();
}

export function getPersonaDescriptionTokenCounters() {
    const $root = getPersonaEditorRoot();

    if (!$root.length) {
        return $();
    }

    const $selectorMatches = $root
        .find(PERSONA_TOKEN_COUNTER_SELECTORS.join(','))
        .add('#persona_description_token_count')
        .not(`#${UI.PERSONA_BAR_ID}`)
        .not(`#${UI.PERSONA_BAR_ID} *`)
        .not(`#${UI.BAR_ID}`)
        .not(`#${UI.BAR_ID} *`);

    const $textMatches = $root
        .find('div, span, small, label')
        .filter(function filterPersonaTokenCounterText() {
            if ($(this).closest(`#${UI.PERSONA_BAR_ID}, #${UI.BAR_ID}`).length) {
                return false;
            }

            const id = String(this.id || '').toLowerCase();
            const className = typeof this.className === 'string'
                ? this.className
                : String(this.className?.baseVal || '');
            const idClass = `${id} ${className}`.toLowerCase();
            const text = String($(this).text() || '').trim().toLowerCase();

            return (
                idClass.includes('persona') &&
                idClass.includes('token') &&
                /token/.test(text)
            );
        });

    return $selectorMatches.add($textMatches);
}

export function setPersonaTokenCounterHidden(hidden) {
    getPersonaDescriptionTokenCounters().each(function togglePersonaTokenCounter() {
        const $element = $(this);

        if (hidden) {
            if (!$element.attr('data-dsf-persona-token-original-display')) {
                $element.attr('data-dsf-persona-token-original-display', $element.css('display') || '');
            }

            $element.css('display', 'none');
            return;
        }

        const originalDisplay = $element.attr('data-dsf-persona-token-original-display');

        if (originalDisplay !== undefined) {
            $element.css('display', originalDisplay === 'none' ? '' : originalDisplay);
            $element.removeAttr('data-dsf-persona-token-original-display');
        }
    });
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Styles
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// User Interface Rendering - Character Mount Helpers
// -----------------------------------------------------------------------------

export function getDescriptionInsertTarget($description) {
    const descriptionElement = $description?.[0];

    if (!descriptionElement) {
        return $description;
    }

    const $root = getCharacterEditorRoot();
    const id = String($description.attr('id') || '');
    let $label = $();

    if ($root.length && id) {
        $label = $root
            .find('label')
            .filter(function findLabelForDescriptionTextarea() {
                return String(this.getAttribute('for') || '') === id;
            })
            .first();
    }

    if (!$label.length && $root.length) {
        $label = $root
            .find('label, div, span, strong')
            .filter(function findDescriptionLabelByText() {
                return String($(this).text() || '').trim() === 'Description';
            })
            .filter(function excludeAspectEvolutiaUi() {
                return !$(this).closest(`#${UI.BAR_ID}, #${UI.PERSONA_BAR_ID}`).length;
            })
            .first();
    }

    const labelElement = $label[0];

    if (labelElement) {
        let node = descriptionElement.parentElement;

        while (node && node !== document.body && node !== document.documentElement) {
            const $node = $(node);

            if (node.contains(descriptionElement) && node.contains(labelElement)) {
                if (
                    !$node.is('#character_popup, #rm_ch_create_block, #character_edit_dialogue, .character_popup, .character_editor, .inline-drawer-content')
                ) {
                    return $node;
                }
            }

            if ($root.length && node === $root[0]) {
                break;
            }

            node = node.parentElement;
        }
    }

    const $fieldBlock = $description
        .closest('.range-block, .form-group, .marginBot5, .wide100p')
        .first();

    return $fieldBlock.length ? $fieldBlock : $description;
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Mount Helpers
// -----------------------------------------------------------------------------

export function normalizePersonaUiText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/[:：]+$/g, '')
        .trim()
        .toLowerCase();
}

export function getOwnText(element) {
    return normalizePersonaUiText(
        Array.from(element?.childNodes || [])
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || '')
            .join(' '),
    );
}

export function isAspectEvolutiaUiElement(element) {
    return Boolean($(element).closest(`#${UI.PERSONA_BAR_ID}, #${UI.BAR_ID}, #${UI.PERSONA_ALTER_EGO_ROW_ID}, #${UI.ALTER_EGO_ROW_ID}`).length);
}

export function isHighLevelPersonaRoot($element) {
    return $element.is(
        [
            '#persona-management-button .drawer-content',
            '#persona_management',
            '#persona-management',
            '#persona_settings',
            '#persona-settings',
            '#persona_panel',
            '#persona-panel',
            '#persona_container',
            '#persona-container',
            '#user_avatar_block',
            '#user-settings-block',
            '.persona_management',
            '.persona-management',
            '.persona_settings',
            '.persona-settings',
            '.persona_editor',
            '.persona-editor',
            '.inline-drawer-content',
        ].join(', '),
    );
}

export function compareElementOrder(first, second) {
    if (!first || !second || first === second) {
        return 0;
    }

    const position = first.compareDocumentPosition(second);

    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
    }

    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
    }

    return 0;
}

export function isElementBefore(first, second) {
    return compareElementOrder(first, second) < 0;
}

export function isElementAfter(first, second) {
    return compareElementOrder(first, second) > 0;
}

export function isRenderablePersonaUiElement() {
    if (this.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }

    if (isAspectEvolutiaUiElement(this)) {
        return false;
    }

    const tagName = String(this.tagName || '').toLowerCase();

    return !['script', 'style', 'template'].includes(tagName);
}

export function getPersonaDescriptionLabel($description = getPersonaDescriptionTextarea()) {
    const descriptionElement = $description?.[0];

    if (!descriptionElement) {
        return $();
    }

    const $root = getPersonaEditorRoot();
    const id = String($description.attr('id') || '');

    if ($root.length && id) {
        const $forLabel = $root
            .find(`label[for="${CSS.escape(id)}"]`)
            .filter(function filterExactLabel() {
                return !isAspectEvolutiaUiElement(this);
            })
            .first();

        if ($forLabel.length) {
            return $forLabel;
        }
    }

    return $root
        .find('h1, h2, h3, h4, h5, h6, label, div, span, strong')
        .filter(function findPersonaDescriptionTextLabel() {
            if (isAspectEvolutiaUiElement(this)) {
                return false;
            }

            if (!isElementBefore(this, descriptionElement)) {
                return false;
            }

            if ($(this).find('textarea, select, button, input, .menu_button').length) {
                return false;
            }

            const ownText = getOwnText(this);
            const allText = normalizePersonaUiText($(this).text());

            return ownText === 'persona description' || allText === 'persona description';
        })
        .last();
}

export function getPersonaConnectionsBoundary() {
    const $description = getPersonaDescriptionTextarea();
    const descriptionElement = $description[0];
    const $root = getPersonaEditorRoot();

    if (!$root.length || !descriptionElement) {
        return $();
    }

    return $root
        .find('h1, h2, h3, h4, h5, h6, label, div, span, strong')
        .filter(function findConnectionsBoundary() {
            if (isAspectEvolutiaUiElement(this)) {
                return false;
            }

            if (!isElementAfter(this, descriptionElement)) {
                return false;
            }

            if ($(this).find('textarea, select, button, input, .menu_button').length) {
                return false;
            }

            const ownText = getOwnText(this);
            const allText = normalizePersonaUiText($(this).text());

            return ownText === 'connections' || allText === 'connections';
        })
        .first();
}

export function getSmallestSharedPersonaNativeBlock($description = getPersonaDescriptionTextarea()) {
    const descriptionElement = $description[0];
    const positionElement = document.getElementById('persona_description_position');
    const depthElement = document.getElementById('persona_depth_position_settings');
    const tokenElement = document.getElementById('persona_description_token_count');

    if (!descriptionElement) {
        return $();
    }

    const $root = getPersonaEditorRoot();
    const rootElement = $root[0] || document.body;
    const elementsToContain = [descriptionElement, positionElement, depthElement, tokenElement].filter(Boolean);

    let node = descriptionElement.parentElement;

    while (node && node !== rootElement && node !== document.body && node !== document.documentElement) {
        const $node = $(node);

        if (isHighLevelPersonaRoot($node)) {
            break;
        }

        const containsAll = elementsToContain.every((element) => node.contains(element));

        if (containsAll) {
            const text = normalizePersonaUiText($node.text());

            if (
                !text.includes('connections') &&
                !text.includes('global settings') &&
                !text.includes('global persona settings') &&
                !$node.find('#user_avatar_block, .avatar-container').length
            ) {
                return $node;
            }
        }

        node = node.parentElement;
    }

    return $();
}

export function getPersonaNativeSatelliteControls() {
    const $description = getPersonaDescriptionTextarea();
    const descriptionElement = $description[0];
    const $root = getPersonaEditorRoot();

    if (!$root.length || !descriptionElement) {
        return $();
    }

    const descriptionIds = [
        'persona_description',
        'persona_description_textarea',
    ];

    const $expandButtons = $root
        .find(
            [
                '.editor_maximize',
                '.right_menu_button',
                '[title="Expand the editor"]',
                '[data-i18n*="Expand the editor"]',
                '[data-for="persona_description"]',
                '[data-for="persona_description_textarea"]',
            ].join(', '),
        )
        .filter(function filterPersonaDescriptionExpandButton() {
            if (isAspectEvolutiaUiElement(this)) {
                return false;
            }

            const dataFor = String(this.getAttribute('data-for') || '').trim();
            const title = String(this.getAttribute('title') || '').trim().toLowerCase();
            const i18n = String(this.getAttribute('data-i18n') || '').trim().toLowerCase();
            const className = typeof this.className === 'string'
                ? this.className
                : String(this.className?.baseVal || '');

            const pointsAtPersonaDescription = descriptionIds.includes(dataFor);
            const looksLikeExpandButton = (
                className.includes('editor_maximize') ||
                title === 'expand the editor' ||
                i18n.includes('expand the editor')
            );

            return pointsAtPersonaDescription && looksLikeExpandButton;
        });

    const $position = $('#persona_description_position');
    const positionElement = $position[0];

    const $positionForLabels = $('label[for="persona_description_position"]');

    const $positionTextLabels = $root
		.find('h1, h2, h3, h4, h5, h6, label, div, span, strong, [data-i18n="Position"]')
		.filter(function filterPersonaPositionLabel() {
			if (isAspectEvolutiaUiElement(this)) {
				return false;
			}

			if (!positionElement) {
				return false;
			}

			if (!isElementBefore(this, positionElement)) {
				return false;
			}

			if ($(this).find('textarea, select, button, input, .menu_button').length) {
				return false;
			}

			const ownText = getOwnText(this);
			const fullText = normalizePersonaUiText($(this).text());
			const i18n = normalizePersonaUiText(this.getAttribute('data-i18n'));

			return ownText === 'position' || fullText === 'position' || i18n === 'position';
		})
		.last();

    return $expandButtons
        .add($positionForLabels)
        .add($positionTextLabels);
}

export function getPersonaNativeRegionTargets() {
    const $description = getPersonaDescriptionTextarea();

    if (!$description.length) {
        return $();
    }

    const $sharedBlock = getSmallestSharedPersonaNativeBlock($description);

    if ($sharedBlock.length) {
		return $sharedBlock.add(getPersonaNativeSatelliteControls());
	}

    const $label = getPersonaDescriptionLabel($description);
    const $position = $('#persona_description_position');
    const $positionLabel = $('label[for="persona_description_position"]');
    const $depthSettings = $('#persona_depth_position_settings');
    const $tokenCounter = $('#persona_description_token_count').closest('.extension_token_counter, .tokenCounterDisplay, div').first();

    let $fallback = $label
        .add($description)
        .add($tokenCounter)
        .add($positionLabel)
        .add($position)
        .add($depthSettings);

    const $connectionsBoundary = getPersonaConnectionsBoundary();

    if ($connectionsBoundary.length) {
        const boundaryElement = $connectionsBoundary[0];

        $fallback = $fallback.filter(function keepBeforeConnections() {
            return this === boundaryElement || isElementBefore(this, boundaryElement);
        });
    }

    return $fallback
    .add(getPersonaNativeSatelliteControls())
    .filter(isRenderablePersonaUiElement);
}

export function getPersonaDynamicFieldsInsertTarget() {
    const $nativeTargets = getPersonaNativeRegionTargets();

    if ($nativeTargets.length) {
        return $nativeTargets.first();
    }

    const $description = getPersonaDescriptionTextarea();

    if ($description.length) {
        const $label = getPersonaDescriptionLabel($description);

        if ($label.length) {
            return $label;
        }

        return $description;
    }

    return $();
}

export function restorePersonaNativeRegionVisibility() {
    $('[data-dsf-persona-native-region="true"]').each(function restorePersonaRegionElement() {
        const $element = $(this);
        const originalDisplay = $element.attr('data-dsf-persona-original-display');

        if (originalDisplay !== undefined) {
            $element.css('display', originalDisplay || '');
        } else {
            $element.css('display', '');
        }

        $element
            .removeAttr('data-dsf-persona-native-region')
            .removeAttr('data-dsf-persona-original-display');
    });
}

export function setPersonaNativeRegionHidden(hidden) {
    restorePersonaNativeRegionVisibility();

    if (!hidden) {
        return;
    }

    const $region = getPersonaNativeRegionTargets();

    $region.each(function hidePersonaRegionElement() {
        if (isAspectEvolutiaUiElement(this)) {
            return;
        }

        const $element = $(this);

        if (!$element.attr('data-dsf-persona-original-display')) {
            $element.attr('data-dsf-persona-original-display', $element.css('display') || '');
        }

        $element
            .attr('data-dsf-persona-native-region', 'true')
            .css('display', 'none');
    });
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Character Mount
// -----------------------------------------------------------------------------

export function mountUi() {
    const $description = getDescriptionTextarea();

    if (!$description.length) {
        return;
    }


    if (!$(`#${UI.BAR_ID}`).length) {
        const $bar = $(`
            <div id="${UI.BAR_ID}" data-target-scope="${TARGET_SCOPE.CHARACTER}">
                <div class="dsf-top-controls">
                    <div class="dsf-left-controls">
                        <label class="checkbox_label dsf-dynamic-toggle-label" title="When enabled, Character Description is hidden in the editor, native charDescription is disabled in Prompt Manager, and Char Description (Evolutia) is enabled.">
                            <input id="${UI.SWAP_ID}" type="checkbox" />
                            <span>Dynamic Fields</span>
                        </label>
                    </div>

                    <div class="dsf-top-action-row">
                        <button
                            id="${UI.DELETE_ALL_TOP_ID}"
                            type="button"
                            class="menu_button danger_button"
                            title="Delete all Character Dynamic Fields for this character."
                        >
                            Delete All
                        </button>

                        <button id="${UI.ADD_TOP_ID}" type="button" class="menu_button">Add Field</button>
                    </div>
                </div>

                <div id="${UI.PANEL_ID}" data-target-scope="${TARGET_SCOPE.CHARACTER}"></div>

                <div id="${UI.BOTTOM_ACTIONS_ID}">
                    <div class="dsf-menu-wrap">
                        <button id="${UI.IMPORT_ID}" type="button" class="menu_button" title="Import Character Dynamic Fields.">Import</button>
                        <div id="${UI.IMPORT_MENU_ID}" class="dsf-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            <button type="button" class="menu_button" data-dsf-import="${IMPORT_SOURCE.CHARACTER_CARD}">Character Description</button>
                            <button type="button" class="menu_button" data-dsf-import="${IMPORT_SOURCE.NATIVE_FIELDS}">SillyTavern Fields</button>
                            <button type="button" class="menu_button" data-dsf-import="${IMPORT_SOURCE.FILE_JSON}">File (JSON)</button>
                            <button type="button" class="menu_button" data-dsf-import="${IMPORT_SOURCE.CLIPBOARD_JSON}">Clipboard (JSON)</button>
                        </div>
                    </div>

                    <div class="dsf-menu-wrap">
                        <button id="${UI.EXPORT_ID}" type="button" class="menu_button" title="Export Character Dynamic Fields.">Export</button>
                        <div id="${UI.EXPORT_MENU_ID}" class="dsf-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            <button type="button" class="menu_button" data-dsf-export="${EXPORT_TARGET.FILE_JSON}">File (JSON)</button>
                            <button type="button" class="menu_button" data-dsf-export="${EXPORT_TARGET.CLIPBOARD_JSON}">Clipboard (JSON)</button>
                        </div>
                    </div>

                    <button id="${UI.ADD_BOTTOM_ID}" type="button" class="menu_button">Add Field</button>
                    <input id="${UI.CHARACTER_CARD_IMPORT_FILE_ID}" type="file" accept=".json,application/json" hidden>
                    <input id="${UI.DYNAMIC_FIELDS_IMPORT_FILE_ID}" type="file" accept=".json,application/json" hidden>
                </div>

                <div id="${UI.TOKEN_ROW_ID}">
                    <span id="${UI.TOKEN_ID}" aria-live="polite"></span>
                </div>
            </div>
        `);

        getDescriptionInsertTarget($description).before($bar);
    }

    const $currentBar = $(`#${UI.BAR_ID}`);
    let $alterEgoContainer = $(`#${UI.ALTER_EGO_ROW_ID}`);

    if (!$alterEgoContainer.length) {
        $alterEgoContainer = $(`<div id="${UI.ALTER_EGO_ROW_ID}" class="dsf-alter-ego-row" data-target-scope="${TARGET_SCOPE.CHARACTER}"></div>`);
    }

    if ($currentBar.length) {
        $currentBar.before($alterEgoContainer.detach());
    }

    bindUiHandlers();
    renderPanel();
    applyUiVisibility();
    updateTokenEstimate();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Mount
// -----------------------------------------------------------------------------

export function mountPersonaUi() {
    const $description = getPersonaDescriptionTextarea();

    if (!$description.length) {
        return;
    }


    const $insertTarget = getPersonaDynamicFieldsInsertTarget();
    const $existingBar = $(`#${UI.PERSONA_BAR_ID}`);

    if ($existingBar.length) {
        if ($insertTarget.length && $existingBar.next()[0] !== $insertTarget[0]) {
            restorePersonaNativeRegionVisibility();
            $insertTarget.before($existingBar);
        }
    } else {
        const $bar = $(`
            <div id="${UI.PERSONA_BAR_ID}" data-target-scope="${TARGET_SCOPE.PERSONA}">
                <div class="dsf-top-controls">
                    <div class="dsf-left-controls">
                        <label class="checkbox_label dsf-dynamic-toggle-label" title="When enabled, Persona Description and Position are hidden in Persona Management, native personaDescription is disabled in Prompt Manager, and Persona Description (Evolutia) is enabled. Persona Dynamic Fields support Prompt Manager / story-string injection only.">
                            <input id="${UI.PERSONA_SWAP_ID}" type="checkbox" />
                            <span>Dynamic Fields</span>
                        </label>
                    </div>

                    <div class="dsf-top-action-row">
                        <button
                            id="${UI.PERSONA_DELETE_ALL_TOP_ID}"
                            type="button"
                            class="menu_button danger_button"
                            title="Delete all Persona Dynamic Fields for this persona."
                        >
                            Delete All
                        </button>

                        <button id="${UI.PERSONA_ADD_TOP_ID}" type="button" class="menu_button">Add Field</button>
                    </div>
                </div>

                <div id="${UI.PERSONA_PANEL_ID}" data-target-scope="${TARGET_SCOPE.PERSONA}"></div>

                <div id="${UI.PERSONA_BOTTOM_ACTIONS_ID}">
                    <div class="dsf-menu-wrap">
                        <button id="${UI.PERSONA_IMPORT_ID}" type="button" class="menu_button" title="Import Persona Dynamic Fields.">Import</button>
                        <div id="${UI.PERSONA_IMPORT_MENU_ID}" class="dsf-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            <button type="button" class="menu_button" data-dsf-persona-import="${IMPORT_SOURCE.PERSONA_DESCRIPTION}">Persona Description</button>
                            <button type="button" class="menu_button" data-dsf-persona-import="${IMPORT_SOURCE.FILE_JSON}">File (JSON)</button>
                            <button type="button" class="menu_button" data-dsf-persona-import="${IMPORT_SOURCE.CLIPBOARD_JSON}">Clipboard (JSON)</button>
                        </div>
                    </div>

                    <div class="dsf-menu-wrap">
                        <button id="${UI.PERSONA_EXPORT_ID}" type="button" class="menu_button" title="Export Persona Dynamic Fields.">Export</button>
                        <div id="${UI.PERSONA_EXPORT_MENU_ID}" class="dsf-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            <button type="button" class="menu_button" data-dsf-persona-export="${EXPORT_TARGET.FILE_JSON}">File (JSON)</button>
                            <button type="button" class="menu_button" data-dsf-persona-export="${EXPORT_TARGET.CLIPBOARD_JSON}">Clipboard (JSON)</button>
                        </div>
                    </div>

                    <button id="${UI.PERSONA_ADD_BOTTOM_ID}" type="button" class="menu_button">Add Field</button>
                    <input id="${UI.PERSONA_DYNAMIC_FIELDS_IMPORT_FILE_ID}" type="file" accept=".json,application/json" hidden>
                </div>

                <div id="${UI.PERSONA_TOKEN_ROW_ID}">
                    <span id="${UI.PERSONA_TOKEN_ID}" aria-live="polite"></span>
                </div>
            </div>
        `);

        if ($insertTarget.length) {
            $insertTarget.before($bar);
        } else {
            $description.before($bar);
        }
    }

    const $currentPersonaBar = $(`#${UI.PERSONA_BAR_ID}`);
    let $personaAlterEgoContainer = $(`#${UI.PERSONA_ALTER_EGO_ROW_ID}`);

    if (!$personaAlterEgoContainer.length) {
        $personaAlterEgoContainer = $(`<div id="${UI.PERSONA_ALTER_EGO_ROW_ID}" class="dsf-alter-ego-row" data-target-scope="${TARGET_SCOPE.PERSONA}"></div>`);
    }

    if ($currentPersonaBar.length) {
        $currentPersonaBar.before($personaAlterEgoContainer.detach());
    }

    if (typeof bindPersonaUiHandlers === 'function') {
        bindPersonaUiHandlers();
    }

    renderPersonaPanel();
    applyPersonaUiVisibility();
    updatePersonaTokenEstimate();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Character Visibility
// -----------------------------------------------------------------------------

export function applyUiVisibility() {
    const characterId = getActiveCharacterId();
    const state = readState(characterId);
    const $description = getDescriptionTextarea();
    const $panel = $(`#${UI.PANEL_ID}`);
    const hasFields = state.fields.length > 0;

    $(`#${UI.SWAP_ID}`).prop('checked', state.swapEnabled);

    $(`#${UI.DELETE_ALL_TOP_ID}`)
        .toggle(state.swapEnabled)
        .prop('disabled', !hasFields)
        .toggleClass('disabled', !hasFields)
        .attr(
            'title',
            hasFields
                ? 'Delete all Character Dynamic Fields for this character.'
                : 'There are no Character Dynamic Fields to delete.',
        );

    $(`#${UI.ADD_TOP_ID}`).toggle(state.swapEnabled);
    $(`#${UI.BAR_ID} .dsf-top-action-row`).css('display', state.swapEnabled ? 'flex' : 'none');
    $(`#${UI.BOTTOM_ACTIONS_ID}`).css('display', state.swapEnabled ? 'flex' : 'none');
    $(`#${UI.ADD_BOTTOM_ID}`).toggle(state.swapEnabled);
    $(`#${UI.TOKEN_ROW_ID}`).css('display', state.swapEnabled ? 'flex' : 'none');

    if ($description.length) {
        getDescriptionInsertTarget($description).toggle(!state.swapEnabled);
    }

    $panel.toggle(state.swapEnabled);
    setStandardTokenCounterHidden(state.swapEnabled);
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Visibility
// -----------------------------------------------------------------------------

export function applyPersonaUiVisibility() {
    const personaId = getActivePersonaId();
    const state = personaId ? readPersonaState(personaId) : createOutOfBoxPersonaState();
    const $panel = $(`#${UI.PERSONA_PANEL_ID}`);
    const hasFields = state.fields.length > 0;

    $(`#${UI.PERSONA_SWAP_ID}`).prop('checked', state.swapEnabled);

    $(`#${UI.PERSONA_DELETE_ALL_TOP_ID}`)
        .toggle(state.swapEnabled)
        .prop('disabled', !hasFields)
        .toggleClass('disabled', !hasFields)
        .attr(
            'title',
            hasFields
                ? 'Delete all Persona Dynamic Fields for this persona.'
                : 'There are no Persona Dynamic Fields to delete.',
        );

    $(`#${UI.PERSONA_ADD_TOP_ID}`).toggle(state.swapEnabled);
    $(`#${UI.PERSONA_BAR_ID} .dsf-top-action-row`).css('display', state.swapEnabled ? 'flex' : 'none');
    $(`#${UI.PERSONA_BOTTOM_ACTIONS_ID}`).css('display', state.swapEnabled ? 'flex' : 'none');
    $(`#${UI.PERSONA_ADD_BOTTOM_ID}`).toggle(state.swapEnabled);
    $(`#${UI.PERSONA_TOKEN_ROW_ID}`).css('display', state.swapEnabled ? 'flex' : 'none');

    setPersonaNativeRegionHidden(state.swapEnabled);

    $(`#${UI.PERSONA_ALTER_EGO_ROW_ID}`).toggle(Boolean(personaId));
    $panel.toggle(state.swapEnabled);
    setPersonaTokenCounterHidden(state.swapEnabled);
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Character Field List
// -----------------------------------------------------------------------------


export function renderAlterEgoAvatarModeOptions(selectedMode) {
    return Object.values(ALTER_EGO_AVATAR_MODE)
        .map((mode) => `
            <option value="${escapeAttribute(mode)}" ${selectedMode === mode ? 'selected' : ''}>
                ${escapeTextarea(ALTER_EGO_AVATAR_MODE_LABELS[mode] || mode)}
            </option>
        `)
        .join('');
}

export function renderAlterEgoAvatarKeyOptions(selectedAvatarKey) {
    const avatars = getSelectableAvatarCharacters();

    return [
        '<option value="">Select another character image…</option>',
        ...avatars.map((entry) => `
            <option value="${escapeAttribute(entry.avatar)}" ${entry.avatar === selectedAvatarKey ? 'selected' : ''}>
                ${escapeTextarea(entry.name || entry.avatar)} — ${escapeTextarea(entry.avatar)}
            </option>
        `),
    ].join('');
}

export function renderPersonaAlterEgoAvatarModeOptions(selectedMode) {
    return Object.values(ALTER_EGO_AVATAR_MODE)
        .map((mode) => `
            <option value="${escapeAttribute(mode)}" ${selectedMode === mode ? 'selected' : ''}>
                ${escapeTextarea(PERSONA_ALTER_EGO_AVATAR_MODE_LABELS[mode] || mode)}
            </option>
        `)
        .join('');
}

export function renderPersonaAlterEgoAvatarKeyOptions(selectedAvatarKey) {
    const avatars = getSelectablePersonaAvatars();

    return [
        '<option value="">Select another persona image…</option>',
        ...avatars.map((entry) => `
            <option value="${escapeAttribute(entry.avatar)}" ${entry.avatar === selectedAvatarKey ? 'selected' : ''}>
                ${escapeTextarea(entry.name || entry.avatar)} — ${escapeTextarea(entry.avatar)}
            </option>
        `),
    ].join('');
}

export function renderAlterEgoControlsHtml(state, targetScope = TARGET_SCOPE.CHARACTER) {
    const scope = getAlterEgoScope(targetScope);
    const viewRuntime = state?.swapEnabled && isChatOpenForRuntime() ? state.__view?.runtime : null;
    const normalized = scope.normalizeState(state);
    const activeAlterEgo = getActiveAlterEgo(normalized) || scope.createBase();
    const identity = scope.getIdentity();
    const avatarUrlValue = (
        activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.DATA_URL ||
        activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.IMAGE_FILE
    )
        ? (activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.IMAGE_FILE && activeAlterEgo.avatarFilePath ? toServedFileUrl(activeAlterEgo.avatarFilePath) : activeAlterEgo.avatarDataUrl)
        : activeAlterEgo.avatarUrl;
    const alterEgoTriggerSources = normalizeTriggerSources(activeAlterEgo.triggerSources);
    const alterEgoTriggerSourceOptionsHtml = Object.values(TRIGGER_SOURCE)
        .map((source) => `
            <label class="checkbox_label dsf-trigger-source-option">
                <input
                    class="${scope.cls}-trigger-source"
                    type="checkbox"
                    value="${escapeAttribute(source)}"
                    ${alterEgoTriggerSources.includes(source) ? 'checked' : ''}
                >
                <span>${escapeTextarea(TRIGGER_SOURCE_LABELS[source])}</span>
            </label>
        `)
        .join('');

    const alterEgoOptions = normalized.alterEgos
        .map((alterEgo) => `
            <option value="${escapeAttribute(alterEgo.id)}" ${alterEgo.id === normalized.activeAlterEgoId ? 'selected' : ''}>
                ${escapeTextarea(alterEgo.name || ALTER_EGO_DEFAULT_NAME)}
            </option>
        `)
        .join('');

    const imageSourceSpecificControl = (() => {
        if (activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.SAME_AVATAR_DIRECTORY) {
            return `
                <label class="dsf-alter-ego-control dsf-alter-ego-avatar-key-wrap">
                    <span class="dsf-label">Other ${scope.imageNoun} Image</span>
                    <select id="${scope.id('AVATAR_KEY_ID')}" class="text_pole">
                        ${scope.renderAvatarKeyOptions(activeAlterEgo.avatarKey)}
                    </select>
                </label>
            `;
        }

        if (activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.IMAGE_FILE) {
            return `
                <label class="dsf-alter-ego-control dsf-alter-ego-avatar-file-wrap">
                    <span class="dsf-label">Upload File</span>
                    <div class="dsf-image-file-row">
                        <button id="${scope.id('IMAGE_FILE_BUTTON_ID')}" type="button" class="menu_button">Upload File</button>
                        <span class="dsf-image-file-name">${escapeTextarea(activeAlterEgo.avatarFileName || 'No upload file selected')}</span>
                    </div>
                    <input
                        id="${scope.id('IMAGE_FILE_INPUT_ID')}"
                        class="dsf-image-file-input"
                        type="file"
                        accept="image/*"
                    >
                </label>
            `;
        }

        if (activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.LOCAL_FILE) {
            return `
                <label class="dsf-alter-ego-control dsf-alter-ego-avatar-local-file-wrap">
                    <span class="dsf-label">Local File</span>
                    <div class="dsf-image-file-row">
                        <input
                            id="${scope.id('LOCAL_FILE_PATH_ID')}"
                            class="text_pole"
                            type="text"
                            value="${escapeAttribute(activeAlterEgo.avatarLocalPath || '')}"
                            placeholder="files/example.png or assets/character/example.png"
                        >
                        <button id="${scope.id('LOCAL_FILE_VERIFY_ID')}" type="button" class="menu_button">Verify</button>
                    </div>
                    <small class="dsf-muted-help">Use a user-data relative path starting with <code>files/</code> or <code>assets/</code>. Example: <code>files/example.png</code> or <code>assets/character/example.png</code>.</small>
                </label>
            `;
        }

        if (
            activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.URL ||
            activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.DATA_URL
        ) {
            return `
                <label class="dsf-alter-ego-control dsf-alter-ego-avatar-url-wrap">
                    <span class="dsf-label">${activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.DATA_URL ? 'Embedded Image Data' : 'Image URL'}</span>
                    <input
                        id="${scope.id('AVATAR_URL_ID')}"
                        class="text_pole"
                        type="text"
                        value="${escapeAttribute(avatarUrlValue)}"
                        placeholder="${activeAlterEgo.avatarMode === ALTER_EGO_AVATAR_MODE.DATA_URL ? 'data:image/png;base64,...' : 'https://...'}"
                    >
                </label>
            `;
        }

        return '';
    })();

    return `
        <div class="dsf-alter-ego-header"><span class="dsf-header-label">Alter Ego</span></div>

        <div class="dsf-alter-ego-body">
            <div class="dsf-alter-ego-preview">
                <img
                    id="${scope.id('AVATAR_PREVIEW_ID')}"
                    src="${escapeAttribute(identity.avatarUrl || '')}"
                    alt="${escapeAttribute(activeAlterEgo.name || scope.label)}"
                >
            </div>

            <div class="dsf-alter-ego-control-stack">
                <div class="dsf-alter-ego-current-group">
                    <label class="dsf-alter-ego-control dsf-alter-ego-current-wrap">
                        <span class="dsf-label">Current Ego</span>
                        <select id="${scope.id('SELECT_ID')}" class="text_pole">
                            ${alterEgoOptions}
                        </select>
                    </label>
                    ${viewRuntime && viewRuntime.alterEgoSource !== 'default' ? `<div class="dsf-field-status" title="The alter ego this chat is currently in, and what switched to it.">In this chat: <b>${escapeTextarea(activeAlterEgo.name)}</b>${viewRuntime.alterEgoReason ? ` — ${escapeTextarea(viewRuntime.alterEgoReason)}` : ''}</div>` : ''}

                    <div class="dsf-alter-ego-actions">
                        <button id="${scope.id('CREATE_ID')}" type="button" class="menu_button">Create</button>
                        <button id="${scope.id('DUPLICATE_ID')}" type="button" class="menu_button">Duplicate</button>
                        <button id="${scope.id('RENAME_ID')}" type="button" class="menu_button">Rename</button>
                        <button
                            id="${scope.id('DELETE_ID')}"
                            type="button"
                            class="menu_button danger_button"
                            ${activeAlterEgo.id === ALTER_EGO_BASE_ID ? 'disabled' : ''}
                            title="${activeAlterEgo.id === ALTER_EGO_BASE_ID ? `The base ${scope.lowerLabel} cannot be deleted.` : `Delete this ${scope.lowerLabel}.`}"
                        >Delete</button>
                    </div>

                    <div class="dsf-alter-ego-trigger-buttons">
                        <div class="dsf-keyword-triggers-wrap ${scope.cls}-keyword-triggers-wrap">
                            <button id="${scope.id('KEYWORD_TRIGGERS_BUTTON_ID')}" type="button" class="menu_button dsf-keyword-triggers-button">Keyword Triggers</button>
                            <div class="dsf-keyword-triggers-menu ${scope.cls}-keyword-triggers-menu">
                                <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                                <div class="dsf-keyword-trigger-group">
                                    <div class="dsf-label">Swap Triggers (Separate by comma, semicolon, or newline).</div>
                                    <textarea class="text_pole ${scope.cls}-change-conditions dsf-trigger-textarea" placeholder="Example: I put on my supersuit, I take off my supersuit">${escapeTextarea(activeAlterEgo.changeConditions)}</textarea>
                                    <div class="dsf-trigger-mode-row">${renderKeywordMatchingSelectHtml(activeAlterEgo.keywordMatching, 'alter-ego', scope.targetScope)}</div>
                                    <div class="dsf-trigger-mode-row">
                                        <label class="dsf-keyword-mode-wrap" title="Any means at least one ${scope.lowerLabel} trigger must match. All means every ${scope.lowerLabel} trigger must match.">
                                            <span>Match</span>
                                            <select class="text_pole ${scope.cls}-change-keyword-mode">
                                                <option value="${KEYWORD_MODE.ANY}" ${activeAlterEgo.changeKeywordMode === KEYWORD_MODE.ANY ? 'selected' : ''}>Any</option>
                                                <option value="${KEYWORD_MODE.ALL}" ${activeAlterEgo.changeKeywordMode === KEYWORD_MODE.ALL ? 'selected' : ''}>All</option>
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="dsf-triggered-by-wrap ${scope.cls}-triggered-by-wrap">
                            <button id="${scope.id('TRIGGER_SOURCES_BUTTON_ID')}" type="button" class="menu_button dsf-triggered-by-button">Trigger Sources</button>
                            <div class="dsf-triggered-by-menu ${scope.cls}-triggered-by-menu">
                                <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                                ${alterEgoTriggerSourceOptionsHtml}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="dsf-alter-ego-image-group">
                    <label class="dsf-alter-ego-control dsf-alter-ego-avatar-mode-wrap">
                        <span class="dsf-label">Image Source</span>
                        <select id="${scope.id('AVATAR_MODE_ID')}" class="text_pole">
                            ${scope.renderAvatarModeOptions(activeAlterEgo.avatarMode)}
                        </select>
                    </label>

                    ${imageSourceSpecificControl}
                </div>
            </div>
        </div>
    `;
}

export function renderPersonaAlterEgoControlsHtml(state) {
    return renderAlterEgoControlsHtml(state, TARGET_SCOPE.PERSONA);
}

export function renderPanel() {
    const characterId = getActiveCharacterId();
    const state = readState(characterId);
    const $panel = $(`#${UI.PANEL_ID}`);

    if (!$panel.length) {
        return;
    }

    const fieldsHtml = state.fields.length
        ? state.fields.map((field, index) => renderFieldHtml(field, index, {
            targetScope: TARGET_SCOPE.CHARACTER,
            runtime: state.swapEnabled ? state.__view?.runtime?.fields?.[field.id] : null,
        })).join('')
        : '<div class="dsf-empty">No Character Dynamic Fields yet.</div>';

    const $alterEgoContainer = $(`#${UI.ALTER_EGO_ROW_ID}`);

    if ($alterEgoContainer.length) {
        $alterEgoContainer.html(renderAlterEgoControlsHtml(state));
    }

    $panel.html(`
        <div class="dsf-fields" data-target-scope="${TARGET_SCOPE.CHARACTER}">
            ${fieldsHtml}
        </div>
    `);

    applyUiVisibility();
    updateTokenEstimate();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Persona Field List
// -----------------------------------------------------------------------------

export function renderPersonaPanel() {
    const personaId = getActivePersonaId();
    const state = personaId ? readPersonaState(personaId) : createOutOfBoxPersonaState(personaId);
    const $panel = $(`#${UI.PERSONA_PANEL_ID}`);
    const $alterEgoContainer = $(`#${UI.PERSONA_ALTER_EGO_ROW_ID}`);

    if ($alterEgoContainer.length) {
        $alterEgoContainer.html(renderPersonaAlterEgoControlsHtml(state));
    }

    if (!$panel.length) {
        return;
    }

    const fieldsHtml = state.fields.length
        ? state.fields.map((field, index) => renderFieldHtml(field, index, {
            targetScope: TARGET_SCOPE.PERSONA,
            runtime: state.swapEnabled ? state.__view?.runtime?.fields?.[field.id] : null,
        })).join('')
        : '<div class="dsf-empty">No Persona Dynamic Fields yet.</div>';

    $panel.html(`
        <div class="dsf-fields" data-target-scope="${TARGET_SCOPE.PERSONA}">
            ${fieldsHtml}
        </div>
    `);

    applyPersonaUiVisibility();
    updatePersonaTokenEstimate();
}

// -----------------------------------------------------------------------------
// User Interface Rendering - Field HTML
// -----------------------------------------------------------------------------

export function renderKeywordMatchingSelectHtml(matching, target, targetScope = TARGET_SCOPE.CHARACTER) {
    const value = normalizeKeywordMatching(matching);

    return `
        <label class="dsf-keyword-mode-wrap dsf-keyword-matching-wrap" title="Whole words: 'arm' does not match 'warm'. Anywhere: the old behaviour, matches inside other words. A keyword written as /pattern/flags on its own line is a regular expression.">
            <span>Keywords match</span>
            <select class="text_pole dsf-keyword-matching" data-dsf-matching-target="${escapeAttribute(target)}" data-target-scope="${escapeAttribute(targetScope)}">
                <option value="${KEYWORD_MATCHING.WORDS}" ${value === KEYWORD_MATCHING.WORDS ? 'selected' : ''}>Whole words</option>
                <option value="${KEYWORD_MATCHING.SUBSTRING}" ${value === KEYWORD_MATCHING.SUBSTRING ? 'selected' : ''}>Anywhere (legacy)</option>
            </select>
        </label>
    `;
}

// "In this chat: On/Off — why" line shown under each field's Inject checkbox.
export function renderFieldRuntimeStatusHtml(normalized, runtimeField) {
    if (!runtimeField || !isChatOpenForRuntime()) {
        return '';
    }

    const on = runtimeField.enabled !== false;
    let why = runtimeField.reason || (runtimeField.source === 'default' ? 'from the Inject setting' : '');

    if (why && Number.isInteger(runtimeField.reasonMessage)) {
        why += ` (message #${runtimeField.reasonMessage})`;
    }

    let gate = '';

    if (on && splitKeywords(normalized.activatingTriggers).length) {
        const remaining = Number(runtimeField.stickyRemaining) || 0;
        gate = remaining > 0
            ? ` · still active for ${remaining} more ${remaining === 1 ? 'reply' : 'replies'}`
            : ' · injects only when its Activating Triggers match';
    }

    return `
        <div class="dsf-field-status ${on ? 'dsf-field-status-on' : 'dsf-field-status-off'}" title="Whether this field is on in the current chat, and what last changed it. Swipes, deleted messages and other chats each have their own state.">
            In this chat: <b>${on ? 'On' : 'Off'}</b>${why ? ` — ${escapeTextarea(why)}` : ''}${escapeTextarea(gate)}
        </div>
    `;
}

export function renderFieldHtml(field, index = 0, { targetScope = TARGET_SCOPE.CHARACTER, runtime = null } = {}) {
    const isPersona = targetScope === TARGET_SCOPE.PERSONA;
    const normalized = isPersona ? normalizePersonaField(field) : normalizeCharacterField(field);
    const triggerSources = normalizeTriggerSources(normalized.triggerSources);

    const triggerSourceOptionsHtml = Object.values(TRIGGER_SOURCE)
        .map((source) => `
            <label class="checkbox_label dsf-trigger-source-option">
                <input
                    class="dsf-trigger-source"
                    type="checkbox"
                    value="${escapeAttribute(source)}"
                    ${triggerSources.includes(source) ? 'checked' : ''}
                >
                <span>${escapeTextarea(TRIGGER_SOURCE_LABELS[source])}</span>
            </label>
        `)
        .join('');

    const triggerActionsHtml = isPersona
        ? ''
        : `
            <div class="dsf-trigger-control-row">
                <div class="dsf-trigger-actions-wrap">
                    <button type="button" class="menu_button dsf-trigger-actions-button">Trigger Actions</button>
                    <div class="dsf-trigger-actions-menu">
                        <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                        <div class="dsf-label">Actions</div>
                        <textarea class="text_pole dsf-trigger-action-instruction" placeholder="Example: I transform into a werewolf.">${escapeTextarea(normalized.triggerActionInstruction)}</textarea>
                    </div>
                </div>
            </div>
        `;

    return `
        <div
            class="dsf-field"
            data-field-id="${escapeAttribute(normalized.id)}"
            data-target-scope="${escapeAttribute(targetScope)}"
        >
            <div class="dsf-field-top-row">
                <div class="dsf-field-order-wrap">
                    <button type="button" class="menu_button dsf-drag-handle" title="Hold and drag to reorder">↕</button>
                    <label class="dsf-position-control">
                        <input
                            class="text_pole dsf-field-order"
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            value="${index + 1}"
                            style="width: ${getPositionInputWidth(index + 1)};"
                        >
                        <span>Position</span>
                    </label>
                </div>
            </div>

            <div class="dsf-label">Field Name</div>
            <input class="text_pole dsf-field-name" type="text" placeholder="Example: Background" value="${escapeAttribute(normalized.name)}">

            <div class="dsf-label">Content (Leave empty to prevent injection).</div>
            <textarea class="text_pole dsf-content" placeholder="">${escapeTextarea(normalized.content)}</textarea>

            <div class="dsf-trigger-menu-stack">
                <div class="dsf-trigger-control-row">
                    <div class="dsf-keyword-triggers-wrap">
                        <button type="button" class="menu_button dsf-keyword-triggers-button">Keyword Triggers</button>
                        <div class="dsf-keyword-triggers-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            <div class="dsf-trigger-mode-row">${renderKeywordMatchingSelectHtml(normalized.keywordMatching, 'field', targetScope)}</div>
                            <div class="dsf-trigger-mode-row dsf-scan-row">
                                <label class="dsf-keyword-mode-wrap" title="How many recent messages the chat-based Trigger Sources (last user / assistant / narrator message) look at. 1 = only the latest one.">
                                    <span>Scan last</span>
                                    <input class="text_pole dsf-scan-depth" type="number" min="1" max="20" step="1" value="${normalized.scanDepth}">
                                    <span>messages</span>
                                </label>
                                <label class="dsf-keyword-mode-wrap" title="After an Activating Trigger matches, keep injecting this field's Content for this many more replies, even if the keyword is not repeated. 0 = only while it matches.">
                                    <span>Stay active for</span>
                                    <input class="text_pole dsf-sticky-turns" type="number" min="0" max="50" step="1" value="${normalized.stickyTurns}">
                                    <span>more replies</span>
                                </label>
                            </div>
                            <div class="dsf-keyword-trigger-group">
                                <div class="dsf-label">Activating Triggers (Separate by comma, semicolon, or newline).</div>
                                <textarea class="text_pole dsf-activating-triggers dsf-trigger-textarea" placeholder="Example: Intro, Pre-Reveal, EVOLUTION_STAGE: Pre-War Arc">${escapeTextarea(normalized.activatingTriggers)}</textarea>
                                <div class="dsf-trigger-mode-row">
                                    <label class="dsf-keyword-mode-wrap" title="Any means at least one activating trigger must match. All means every activating trigger must match.">
                                        <span>Match</span>
                                        <select class="text_pole dsf-activating-keyword-mode">
                                            <option value="${KEYWORD_MODE.ANY}" ${normalized.activatingKeywordMode === KEYWORD_MODE.ANY ? 'selected' : ''}>Any</option>
                                            <option value="${KEYWORD_MODE.ALL}" ${normalized.activatingKeywordMode === KEYWORD_MODE.ALL ? 'selected' : ''}>All</option>
                                        </select>
                                    </label>
                                </div>
                            </div>

                            <div class="dsf-keyword-trigger-group">
                                <div class="dsf-label">Enabling Triggers (Separate by comma, semicolon, or newline).</div>
                                <textarea class="text_pole dsf-enabling-triggers dsf-trigger-textarea" placeholder="Example: werewolf transformation">${escapeTextarea(normalized.enablingTriggers)}</textarea>
                                <div class="dsf-trigger-mode-row">
                                    <label class="dsf-keyword-mode-wrap" title="Any means at least one enabling trigger must match. All means every enabling trigger must match.">
                                        <span>Match</span>
                                        <select class="text_pole dsf-enabling-keyword-mode">
                                            <option value="${KEYWORD_MODE.ANY}" ${normalized.enablingKeywordMode === KEYWORD_MODE.ANY ? 'selected' : ''}>Any</option>
                                            <option value="${KEYWORD_MODE.ALL}" ${normalized.enablingKeywordMode === KEYWORD_MODE.ALL ? 'selected' : ''}>All</option>
                                        </select>
                                    </label>
                                </div>
                            </div>

                            <div class="dsf-keyword-trigger-group">
                                <div class="dsf-label">Disabling Triggers (Separate by comma, semicolon, or newline).</div>
                                <textarea class="text_pole dsf-disabling-triggers dsf-trigger-textarea" placeholder="Example: human transformation">${escapeTextarea(normalized.disablingTriggers)}</textarea>
                                <div class="dsf-trigger-mode-row">
                                    <label class="dsf-keyword-mode-wrap" title="Any means at least one disabling trigger must match. All means every disabling trigger must match.">
                                        <span>Match</span>
                                        <select class="text_pole dsf-disabling-keyword-mode">
                                            <option value="${KEYWORD_MODE.ANY}" ${normalized.disablingKeywordMode === KEYWORD_MODE.ANY ? 'selected' : ''}>Any</option>
                                            <option value="${KEYWORD_MODE.ALL}" ${normalized.disablingKeywordMode === KEYWORD_MODE.ALL ? 'selected' : ''}>All</option>
                                        </select>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                ${triggerActionsHtml}

                <div class="dsf-trigger-control-row">
                    <div class="dsf-triggered-by-wrap">
                        <button type="button" class="menu_button dsf-triggered-by-button">Trigger Sources</button>
                        <div class="dsf-triggered-by-menu">
                            <div class="dsf-menu-close-row"><button type="button" class="menu_button dsf-menu-close" title="Close">×</button></div>
                            ${triggerSourceOptionsHtml}
                        </div>
                    </div>
                </div>
            </div>

            <div class="dsf-bottom-row">
                <div class="dsf-inject-row">
                    <label class="checkbox_label" title="When enabled, this field can be injected if its content and trigger conditions allow it.">
                        <input class="dsf-field-enabled" type="checkbox" ${normalized.enabled ? 'checked' : ''}>
                        <span>Inject</span>
                    </label>
                    ${renderFieldRuntimeStatusHtml(normalized, runtime)}
                </div>

                <div class="dsf-field-actions">
                    <button type="button" class="menu_button dsf-duplicate-field">Duplicate</button>
                    <button type="button" class="menu_button danger_button dsf-delete-field">Delete</button>
                </div>
            </div>
        </div>
    `;
}
