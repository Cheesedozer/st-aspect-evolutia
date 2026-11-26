# Aspect: Evolutia — Phase 1 Review

Reviewed: `index.js` at commit `7d7970b` (v1.3.1, 11,093 lines).
Checked against fresh clones (in `/home/user/ref`, outside this repo):

| Host | Version / commit |
|---|---|
| SillyTavern `release` | 1.19.1, `82b64a4` (2026‑11‑19) |
| SillyTavern `staging` | 1.19.1, `c96a1d0` (2026‑11‑22) |
| SillyBunny `main` | 1.8.4, `bb32c79` (2026‑11‑26) |

Line numbers below are `index.js` unless another file is named. "ST" = SillyTavern, "SB" = SillyBunny, "CC" = Chat Completion, "TC" = Text Completion, "PM" = Prompt Manager.

Everything in this report comes from reading code. I did not run SillyTavern or SillyBunny in Phase 1. Anything that would need a running app to prove is labeled **Suspected**.

---

## 0. The 5 things that matter most (plain language)

1. **The extension's memory of the story is stored in the wrong place.** Things like which fields are switched on, which alter ego is active, and whether a transformation has happened are saved on the *character card*, not with the *chat*. So swiping, deleting a message, going back to a branch, or opening a different chat with the same character does not undo them. If your werewolf transformed in Chat A, they are still a werewolf when you start Chat B. This is the root cause of most of the swipe and branch problems you asked about (E‑01).
2. **Trigger Actions misfire on swipes, stops, and background generations.** If you swipe the reply where the transformation was supposed to happen, the new reply acts as if the transformation already happened and skips it. If you press Stop, the extension still counts the transformation as done. Other extensions that quietly ask the model something in the background (summaries, image prompts, impersonate, SillyBunny agents in some modes) can "use up" the transformation instruction before your real reply (E‑02, E‑03).
3. **Two of the five trigger sources don't do what their labels say.** "World Info / Lorebooks" never sees anything; it looks for data SillyTavern doesn't provide. "Quiet Prompts" actually reads Author's Note, summaries and other extensions' injections. "System Prompts" reads your preset's fixed text, which never changes between turns (E‑04).
4. **It only works for Chat Completion users, and only with presets that use the standard description slot.** On Text Completion the Dynamic Fields never reach the model, because the story string still uses the normal description. On Chat Completion presets that write `{{description}}` inside their own prompt blocks, which many popular presets do, the model gets *both* the old description and the new fields. Group chats have their own version of this (E‑05, E‑06, E‑07).
5. **The basic idea is sound and worth keeping. Fix how runtime state is stored before adding features.** Splitting a description into switchable sections is a good tool. But it fixes only part of flanderization, because the bigger cause is the chat history itself. A model‑assisted "update my fields" feature is worth building, but only as an opt‑in, review‑before‑apply tool, and only after state is stored per chat (§3).

---

## Step 0 — How the current design works (please correct me)

**Where data lives**
- **Character data** is stored on the character card at `character.data.extensions["st-description-swap-fields"]`, written with ST's `writeExtensionField` (2475‑2493). It holds `swapEnabled`, `activeAlterEgoId`, and `alterEgos[]`. Each alter ego has its own name and avatar settings, its swap keywords, and its own `fields[]`. A top‑level `fields[]` mirrors the active alter ego's fields for backward compatibility (1992‑2025).
- **Persona data** is stored in global settings (`settings.json`) at `power_user["st-description-swap-fields"].personaDynamicFields[<persona avatar file>]` (1350‑1397, saved at 2589‑2636).
- **Each field** has a name, content, an *Inject* switch (`enabled`), three keyword lists (Activating / Enabling / Disabling), each with an ANY/ALL mode, a list of trigger sources, and, for characters only, a Trigger Action plus three runtime values (`triggerActionPhase`, `triggerActionGenerationId`, `triggerActionEnabledByGeneration`) (1565‑1588).
- A read cache keyed by character list index (2450‑2473) sits in front of a 400 ms debounced save (2495‑2502).

**From chat message to prompt**
1. When the extension loads or the chat changes, it adds two PM entries to the current CC preset: "Char Description (Evolutia)" with content `{{aspectEvolutiaCharDescription}}`, and "Persona Description (Evolutia)" with content `{{aspectEvolutiaPersonaDescription}}`. If the *currently open* character has Dynamic Fields on, it switches the native `charDescription` entry off and its own entry on, and saves the preset (3999‑4047, 4064‑4123).
2. You send a message. ST calls the extension's **generate interceptor** (`manifest.json` → `aspectEvolutiaGenerateInterceptor`, 10577‑10632) with the chat as it will be sent to the model.
3. The interceptor starts a "generation lifecycle" with a serial number (10422‑10453). For the character, then the persona, it:
   - checks every alter ego's swap keywords. The first match becomes active and is saved (3083‑3101).
   - for each field of the active alter ego, builds the "scan text" from that field's trigger sources (3017‑3026), lowercases it, and runs the rules in `buildFieldPromptEntriesForGeneration` (3307‑3494):
     - **Disabling** keyword matched → turn Inject **off** (saved) and skip the field.
     - **Enabling** keyword matched while Inject is off → turn Inject **on** (saved). If a Trigger Action exists, inject the action instead of the content.
     - **Activating** keywords: if a field has any, its content is injected only when they match this turn. If it has none, the content is injected every turn while Inject is on. If a Trigger Action exists and an Activating keyword matches, the action is injected instead.
   - wraps the chosen entries (3496‑3545) and caches the text as the "prepared prompt".
4. While ST builds the CC prompt, the macro in the PM entry returns that cached text (3600‑3617). If Dynamic Fields is off for that character, it returns the native description.
5. **Trigger Action phases:** `idle` → (action injected this generation) `action_injected` → on `GENERATION_ENDED` → `content_ready` → next generation injects the content once and returns to `idle`. If `GENERATION_STOPPED` arrives instead, the code is *meant* to roll back (10497‑10553).
6. **Alter egos:** switching (by hand, or by keyword in step 3) changes `activeAlterEgoId`. That changes which `fields[]` are used. It also calls ST's `setCharacterName()`, so `{{char}}` becomes the alter ego's name (4261‑4275). New messages are stamped with the alter ego's name and avatar (`message.name`, `message.force_avatar`, `message.extra.aspectEvolutia`) (4343‑4390, 4588‑4643).

---

## Step 1 — Findings

Severity: **High** = wrong prompt content or lost or corrupted data in normal use. **Medium** = wrong in a common but specific setup. **Low** = edge case or maintenance.

### E‑01 · Story state is saved on the card, so it ignores chats, swipes, branches and deletions
**Plain language:** The extension remembers "the coat came off", "she's now a werewolf", and "transformation done" *per character*, not per conversation. Undoing the message that caused the change doesn't undo the change. Starting a different chat with the same character carries the change over. Exporting the card also exports these settings.

**Evidence:**
- `buildFieldPromptEntriesForGeneration` flips `field.enabled` and the trigger‑action phase (3333‑3343, 3375‑3394, 3466‑3474).
- `prepareReplacementPromptForGeneration` writes the result to the card through `scheduleSave` → `writeExtensionField` (3567‑3568, 2475‑2493).
- The alter ego swap is saved the same way (3557‑3559).
- No handler is registered for `MESSAGE_DELETED`, `MESSAGE_EDITED` or `MESSAGE_SWIPED` (event list at 10867‑11005).
- `CHAT_CHANGED` only clears caches (10811‑10828).

**Scenario:**
1. Field "Coat" has Disabling trigger `takes off her coat`. In Chat A you write "she takes off her coat", and Inject turns off.
2. You decide you didn't want that, so you delete or edit the message and regenerate. The coat stays off.
3. You open Chat B, an unrelated story with the same character. The coat is off there too.

The same happens with alter egos: a keyword‑triggered "Werewolf" form stays active in every chat until something switches it back.

**Severity:** High · **Confirmed**

**Fix:** Keep the *definitions* (field text, keywords) on the card. Move the *runtime state* (Inject overrides, trigger‑action phase, active alter ego) to the chat:
- per message: a snapshot in `message.extra.aspectEvolutia.state`, stored on the swipe;
- plus a fallback in `chat_metadata`.

At generation time, rebuild the state from the newest message that has a snapshot. Swipes, deletes and branches then become correct automatically, because the history is the source of truth. This is the same pattern SillyBunny's trackers use: state lives in message/swipe extras (SB `in-chat-agents/agent-runner.js:1093‑1129`).

Migration: today's card values become the starting state for chats that don't have one yet. The card format keeps loading.

**Effort:** L · **Risk:** Medium. It touches the core loop, and needs careful migration and a backup of the existing card data.

### E‑02 · Trigger Actions are skipped on swipes and counted as done when you press Stop
**Plain language:**
- **Swipes:** the transformation is supposed to happen in the reply. If you swipe that reply, the new version is told "you are already a werewolf" instead of "transform now". Keep swiping and it alternates between the two.
- **Stop:** pressing Stop is supposed to cancel the transformation, but the cancel code never runs.

**Evidence:**
- **Swipe:** after the action's generation ends, the phase becomes `content_ready` (10529‑10535). The swipe's generation hits `isContentReadyForThisGeneration` (3285‑3292, 3442‑3453), which injects *content* and resets to `idle`. On the next swipe, the Activating keyword is still in the last user message, so the action fires again (3466‑3474).
- **Stop:** ST's `stopGeneration()` calls `hideStopButton()`, which emits `GENERATION_ENDED` *before* `GENERATION_STOPPED` (ST `public/script.js:3536‑3541, 5634‑5645`). Evolutia's `GENERATION_ENDED` handler promotes the action to `content_ready` and clears the lifecycle (10555‑10571). The later `GENERATION_STOPPED` handler then finds no lifecycle, so the `cancel` branch (10523‑10528) is dead in practice.

**Scenario:**
1. User: "the full moon rises". The field "Werewolf" has a Trigger Action ("transforms into a werewolf") and content ("currently in werewolf form").
2. The reply comes back. You don't like it and swipe.
3. Swipe 2 is written as an already‑transformed werewolf, so the transformation scene is skipped.
4. Swipe 3 transforms again.

Pressing Stop halfway through the first reply also leaves the next reply in "already transformed" mode.

**Severity:** High · **Confirmed**

**Fix:**
- With E‑01's per‑message state, a swipe naturally re‑reads the state from *before* the message being swiped. The phase for swipe N is "the action is pending", not "content is ready".
- Separately, decide finalize vs. cancel from the message itself (did a new assistant message land?) instead of from event order.

**Effort:** M (on top of E‑01) · **Risk:** Medium

### E‑03 · Background ("quiet") generations and Impersonate consume the trigger state
**Plain language:** Other features often ask the model something behind the scenes: Summarize, image prompt generation, expression classification, the Impersonate button, and SillyBunny agents when no connection profile is set. Each of these runs Evolutia's step as if it were a real reply. That can inject "You must ensure the following actions occur: …" into a summary request, and mark the transformation done before your character ever replies.

**Evidence:**
- ST calls interceptors as `(chat, contextSize, abort, type)` (ST `extensions.js:2027‑2052`).
- Evolutia ignores the `type` string. `getInterceptorOptionsFromArgs` keeps only objects (10380‑10384), and the interceptor always mutates with `mutate: true` (10600‑10630).
- `generateQuietPrompt` runs `Generate('quiet')` (ST `script.js:~3111`), which runs interceptors (ST `script.js:4592`) and emits `GENERATION_ENDED` when it unblocks (ST `script.js:5719‑5726`).
- In SB, the agent fallback path `generateQuietPrompt` (SB `agent-runner.js:3264`) does the same for non‑nested runs. SB's profile path and `generateRaw` path do not.

**Scenario:** Summarize is set to run after every reply. You trigger the transformation, and the reply includes it, so far so good. Summarize's quiet run then gets the *content* entry and resets the field to `idle`. That part is benign. The harmful order is a quiet run that happens *before* the reply, for example an Impersonate click or a pre‑generation agent. It receives the action instruction, consumes it, and the actual character reply never transforms.

**Severity:** High (for users with those features) · **Confirmed**

**Fix:**
- Read `type` (the 4th interceptor argument).
- For `quiet`, either inject the current state without changing it (`mutate: false`), or skip Trigger Actions entirely.
- For `impersonate`, never inject character Trigger Actions.

**Effort:** S · **Risk:** Low

### E‑04 · Three trigger sources read the wrong thing or nothing
**Plain language:**
- "World Info / Lorebooks" never matches anything.
- "Quiet Prompts" really means "whatever other extensions inject": Author's Note, summaries, vector memories, SillyBunny agent output, and so on.
- "System Prompts" reads your preset's fixed instructions, which are identical every turn, so a keyword there is either always on or never on.

**Evidence:**
- **World Info:** `getWorldInfoLorebookText` (2963‑2991) reads `ctx.worldInfo`, `ctx.activatedWorldInfo`, `ctx.lorebooks` and similar. None of these exist on `getContext()` in ST release or staging (`st-context.js`). SB only adds `worldInfoSettings` (settings, not entries). On top of that, ST runs interceptors *before* the World Info scan (ST `script.js:4592` vs `4663`), so activated entries aren't known yet when Evolutia evaluates.
- **Quiet Prompts:** `getQuietPromptText` (2919‑2934) reads `ctx.extensionPrompts`, which is ST's `extension_prompts` map (`st-context.js:177`). The other names it reads (`quietPrompts`, `promptBias` and so on) don't exist.
- **System Prompts:** `getSystemPromptText` (2936‑2961) concatenates the static content of every enabled system‑role PM prompt. The system *chat* messages it also tries to read are filtered out of the interceptor's chat by ST (`coreChat = chat.filter(x => !x.is_system …)`, ST `script.js:4523`).

**Scenario:**
- You set a field to turn on when the lorebook entry "Silver Mines" activates. It never turns on.
- You set "Quiet Prompts" expecting it to react to the quiet prompt of a /gen command. Instead it reacts to your Author's Note text every turn.

**Severity:** Medium · **Confirmed**

**Fix:**
- **World Info:** listen to `WORLD_INFO_ACTIVATED` (exists on all three hosts) and keep the activated entries' content and keys. Evaluate WI‑sourced fields when the macro is read: the macro is resolved during CC prompt assembly, which happens after the WI scan.
- **Quiet Prompts:** rename the source to "Extension Injections". If real quiet prompts are wanted, read the `quiet_prompt` from `GENERATION_AFTER_COMMANDS`, which carries it (ST `script.js:4348`).
- **System Prompts:** drop it, or redefine it as "system messages in chat", read from the live chat rather than the interceptor's chat.

**Effort:** M · **Risk:** Low

### E‑05 · Text Completion users get nothing
**Plain language:** If you use a Text Completion API (KoboldCpp, llama.cpp, text‑generation‑webui and similar), turning on Dynamic Fields hides the description box and shows the fields, but the model keeps receiving the old description.

**Evidence:**
- All injection goes through PM entries and macros (3999‑4123). PM is a Chat Completion feature, and its entries are ignored on TC.
- The TC story string uses `{{description}}` and `{{persona}}`.
- There is no reference to `main_api`, the story string, or instruct mode anywhere in `index.js` (grep).
- The persona check even accepts `'story_string'` as valid (1290‑1299) without handling it.

**Scenario:**
1. A TC user imports their description into fields and edits them.
2. The model still sees the original description, unchanged, and the user never finds out.
3. If they emptied the native description, the model sees no description at all.

**Severity:** High for TC users · **Confirmed**

**Fix (choose in Decisions):**
- **(a)** Detect TC. Show a banner. Offer a one‑click "use Evolutia in story string" that swaps `{{description}}` → `{{aspectEvolutiaCharDescription}}` and `{{persona}}` → `{{aspectEvolutiaPersonaDescription}}` in the active story‑string template, saves a copy of the original first, and can undo it. The macros already fall back to the native text when Dynamic Fields is off, so the swap is safe for every character.
- **(b)** Document it as CC‑only.

**Effort:** M · **Risk:** Low‑Medium. It edits the user's context template; mitigated by the backup and undo.

### E‑06 · Group chats: injection depends on whichever solo chat you opened last, and "join" mode loses other members
**Plain language:** The switch that decides "use Evolutia's description instead of the normal one" is flipped for the character you have *open*. In a group, nobody counts as open, so the switch stays wherever your last one‑on‑one chat left it. Separately, groups set to "join character cards" lose every other member's description.

**Evidence:**
- `syncPromptManagerWithActiveState` returns early when `ctx.characterId` is undefined (4049‑4062). That is always the case in a group outside generation (ST `group-chats.js:984, 1080`).
- The PM order is per preset, and global by default, so the toggles are shared across all characters.
- In "join" modes ST fills the `charDescription` marker with all members' descriptions joined (ST `group-chats.js:477‑560`, used at `script.js:3412`). Evolutia's entry returns only the current speaker's text (3600‑3617).

**Scenario:**
1. You chat one‑on‑one with Bob (no Evolutia). Native description is on, Evolutia's entry is off.
2. You open a group with Alice (who uses Evolutia) and Bob. Alice's Dynamic Fields are never injected; she gets her native description.
3. The reverse happens too: after a solo chat with Alice, a group in "join" mode sends only the current speaker's fields and none of the others' descriptions.

**Severity:** Medium · **Confirmed**

**Fix:** Stop toggling per character.
- Enable the Evolutia entry and disable the native marker **once per preset**. The macro already returns the native description for characters without Dynamic Fields (3613‑3615), so this is safe.
- For groups in join mode, make the macro build the joined text: each member's fields or native description, with ST's join prefix and suffix.

This also stops the extension from rewriting your preset file on every chat switch (4040, 4116).

**Effort:** M · **Risk:** Low‑Medium

### E‑07 · Presets that use `{{description}}` / `{{persona}}` in their own blocks get both the old description and the new fields
**Plain language:** Many popular presets don't use the built‑in "Char Description" slot. They write `{{description}}` inside their own formatted block, for example inside `<character>` tags. Evolutia only turns off the built‑in slot, so the model ends up reading both versions.

**Evidence:** Sync disables only the entry whose identifier is `charDescription` or `personaDescription` (4022‑4036, 4102‑4114). Nothing inspects or overrides prompt content that uses `{{description}}` or `{{persona}}`.

**Scenario:** You use a preset whose "Character" custom prompt contains `{{description}}`, with the native marker already off. When you enable Dynamic Fields, the model gets the static description *and* the dynamic fields. That works against the whole point of the extension, and roughly doubles the description's token cost.

**Severity:** Medium · Code path **Confirmed**. How common this is depends on the preset: **Suspected**.

**Fix:** When syncing, scan enabled PM prompts for `{{description}}` / `{{persona}}`. Warn, and offer to replace them with the Evolutia macros, with a backup.

**Effort:** S‑M · **Risk:** Low

### E‑08 · Uploaded alter‑ego images get copied into every chat message
**Plain language:** If you give an alter ego an uploaded or embedded image, that whole image is copied twice into every message the alter ego sends. Chat files can grow to hundreds of megabytes and become slow to load and save.

**Evidence:**
- Uploads are stored as base64 data URLs with no size limit (1079‑1099, used at 9096, 9454).
- `resolveAlterEgoAvatarUrl` returns that data URL (4219‑4229).
- `stampMessageWithActiveAlterEgoIdentity` writes it to `message.force_avatar` and again to `message.extra.aspectEvolutia.alterEgo.avatarUrl` (4365, 4376‑4384). The persona version does the same (4604, 4629‑4637).
- The whole state, images included, is also re‑sent to the server on every 400 ms debounced save while you type in a field (2495‑2502).

**Scenario:** A 400 KB uploaded image and 300 replies give about 240 MB of chat JSONL. Every save then re‑uploads the entire chat.

**Severity:** Medium · **Confirmed**

**Fix:**
- Upload images once to the user's files: ST's `/api/files/upload`, or the character's sprite/gallery folder.
- Store only the path. Stamp messages with the path, or just the alter ego ID.
- Migration: on load, move existing data URLs to files and rewrite references. Keep the originals in a backup.

**Effort:** M · **Risk:** Medium (touches existing chats; needs a backup)

### E‑09 · Keywords match inside other words
**Plain language:**
- `cat` matches "category", "educated" and "scattered".
- `arm` matches "harm", "warm" and "alarm".
- `moon` matches "honeymoon".
- Negations still match: "she does **not** take off her coat" fires "take off her coat".

**Evidence:** `scanText.includes(trigger)` on lowercased text (3045‑3059).

**Scenario:** A field "Injured Arm" with Enabling trigger `arm` switches on when someone says "it's warm today".

**Severity:** Medium · **Confirmed**

**Fix:**
- Make whole‑word matching the default (`\b` with Unicode‑aware boundaries).
- Allow `/regex/` entries, like ST World Info.
- Existing cards get a per‑field "legacy substring" flag set by migration, so behaviour doesn't change silently. Or apply the new default only to new fields; see Decisions.

**Effort:** S · **Risk:** Low

### E‑10 · One save timer is shared by all characters, so saving B can cancel A's save
**Plain language:** Saves wait 400 ms so they don't hammer the server. There is only one waiting slot for all characters. If two characters change within 400 ms, only the second one is saved to disk. The first one's change looks fine until you reload.

**Evidence:** `scheduleSave` does `clearTimeout(saveTimer)` regardless of `characterId` (2495‑2502). Personas have the same problem (2638‑2651).

**Scenario:** In a group chat, Alice's reply ends and her trigger action is promoted to `content_ready`, which schedules a save. ST immediately starts Bob's turn, and Bob's interceptor changes one of Bob's fields, which schedules another save. Alice's save is cancelled. After a reload, Alice's field is back in its old phase.

**Severity:** Low (the stale phase is partly recovered at 3428‑3439) · **Confirmed**

**Fix:** One timer per character or persona key (a `Map`), plus flush pending saves on `beforeunload` and on chat change.

**Effort:** S · **Risk:** Low

### E‑11 · Generation numbers restart on reload but are saved on the card
**Plain language:** The extension tells generations apart by a counter that restarts at 1 whenever the page reloads. That counter is saved with the field. After a reload, a new generation can get the same number as an old saved one, and a field can be skipped for one turn.

**Evidence:** `generationSerial` starts at 0 (323). `triggerActionGenerationId` is persisted (1584). `isContentLockedUntilNextGeneration` compares IDs for equality (3294‑3301).

**Scenario:**
1. A field is saved as `content_ready` with generation 3.
2. You reload, send messages, and the 3rd generation of the new session gets ID 3.
3. The content is treated as "locked until next generation" and is not injected that turn.

**Severity:** Low · **Confirmed**

**Fix:** Use a random ID per generation (e.g. `crypto.randomUUID()`). E‑01 removes the need entirely.

**Effort:** S · **Risk:** Low

### E‑12 · Trigger Action prompt wording and placement are weak (prompt text)
**Plain language:** The transformation instruction is placed inside the character description, usually near the very top of the prompt, thousands of words before the latest message. It is also written as "I transform…". Models often ignore an instruction buried that far up, and "I" can be read as the user or the narrator rather than the character.

**Evidence:** `formatTriggerActionForPrompt` (3508‑3517) emits `[TRIGGER ACTION] / You must ensure the following actions occur: / <text> / [END TRIGGER ACTION]` inside the `[CHARACTER DEFINITIONS] These definitions apply only to X.` wrapper (3519‑3530). That wrapper goes wherever the description sits in PM. The README example uses first person ("I transform into a werewolf").

**Scenario:** On a 12k‑token chat with a typical preset, the character description is near the top. The model writes a normal reply with no transformation, and the extension still marks the action done (E‑02).

**Severity:** Medium (it's the whole point of the feature) · Wording problem **Confirmed**. Whether a given model ignores it: **Suspected**.

**Fix:**
- Inject actions as a short system note **near the end of the chat**, at depth 0‑1, using ST's `setExtensionPrompt` (`IN_CHAT` position). Keep only state content in the description.
- Template: `[Event for {{char}} in this reply: {{char}} transforms into a werewolf. Show it happening.]`, which is third person, says when, and is short.
- Let users write `{{char}}` in actions, and update the README example.

**Effort:** S‑M · **Risk:** Low

**Token cost** (field labels, measured by hand on the format):
- Wrapper: about 18 tokens.
- Each field: about 10‑14 tokens of labels (`[DEFINITION: X]` … `[END DEFINITION: X]`).
- Each Trigger Action: about 20 tokens.
- Six fields: about 100 tokens of overhead. That is small compared with a 1‑2k description. Dropping the `[END …]` lines would halve it, which is cosmetic.
- The `[TAG]`/`[END TAG]` format reads fine to current models. It does not clash with XML‑style presets, but it will appear *inside* them (e.g. inside `<character>`). That's acceptable.

### E‑13 · Dead code
**Plain language:** About 25 functions and constants are never used. Most are harmless. Three things matter:
- the "restore suppressed description" safety code runs constantly but has nothing to restore;
- the Stop/cancel branch can't fire (E‑02);
- alter‑ego export/import was written but never wired up, so **alter egos can't be exported to JSON**. Export only saves the *active* alter ego's fields.

**Evidence:**
- **Never used (count = definition only):** `deletePersonaExtensionStateRecord`, `exportAlterEgoForJson`, `importAlterEgoFromJson`, `clearRuntimeCachesForCharacterAndPersona`, `markContentReadyForNextGeneration`, `buildReplacementPrompt`, `buildAspectEvolutiaMacroValue`, `buildPersonaReplacementPrompt`, `getPromptByName`, `getPromptIdentifier`, `ensureAspectPromptExists`, `ensureAspectPromptOrderEntry`, `refreshExistingAssistantMessagesForActiveAlterEgo`, `filterImportableFields`, `getFieldStateOptionsForTargetScope`, `isAnyDynamicFieldsMenuOpen`, constants `ASPECT_PROMPT_*` / `ASPECT_MACRO_*` (54‑57), and `UI.SETTINGS_REMOVE_*` / `UI.SETTINGS_RESET_EXTENSION_ID` aliases (256‑259).
- **Restore code:** `descriptionBackups` (346) is never written to, so `restoreSuppressedDescriptions()` (4156‑4189, called from 6 places) is a no‑op.
- **Not used by ST:** `export function activate()` (11089). The manifest has no `hooks.activate`, and `boot()` already runs at module load (11093).
- **Export:** `buildDynamicFieldsExportPayload` (4946‑4954).

**Scenario (export):** You build a Base and a Werewolf form, click Export → File, and get only the fields of whichever form is active.

**Severity:** Low · **Confirmed**

**Fix:** Delete the dead code. Wire the alter‑ego export/import, which already exists, into the Export/Import menus.

**Effort:** S · **Risk:** Low

### E‑14 · Persona data lives in `power_user` and is never cleaned up
**Plain language:** Persona fields are stored inside SillyTavern's core settings object rather than the area reserved for extensions. Deleting a persona leaves its fields behind.

**Evidence:**
- Storage path: 1350‑1374.
- The `PERSONA_DELETED` handler only clears an avatar cache (10917‑10921).
- `deletePersonaExtensionStateRecord` is unused (1399‑1410).

**Scenario:** You make and delete many personas. `settings.json` keeps growing, including any embedded images (E‑08).

**Severity:** Low · **Confirmed**

**Fix:** Move to `extension_settings["aspect-evolutia"].personas`, migrating from the old path and keeping the old copy for one version. Delete the record on `PERSONA_DELETED`.

**Effort:** S · **Risk:** Low

### Observations (no failure scenario I can prove, or design notes)
- **Stale lifecycle preferred over the active character.** `resolveInterceptorCharacterId` uses `currentGenerationCharacterId` before the active character (10461‑10475). I couldn't find an ST path that leaves the lifecycle stale between group members, because each member's `Generate` emits `GENERATION_ENDED`. It is still a trap; prefer `this_chid` during the interceptor.
- **Two page‑wide `MutationObserver`s** run on every DOM change, including every streamed token (10740‑10764, 11033‑11055). Each callback is cheap (a few ID lookups and one jQuery selector chain). Probably fine; worth throttling.
- **Hidden token counters.** "Hide token counters" matches any element whose id or class contains "token" in the editor (6208‑6266), which includes ST's whole‑card count `#result_info`.
- **Many guessed selectors.** About 15 fallback selectors don't exist on any host (e.g. `#persona_container`, `#persona_list`, `#CharID` as a container, `#user_name`, `#avatar_preview`). Harmless, but noisy.
- **"Last Assistant Message" in groups** means the last message from *any* member (2903‑2905). Probably fine, but surprising.
- **Default keyword mode is ALL for fields and ANY for alter egos** (1434‑1436 vs 1645). Users who type `wolf, moon` likely expect "either".
- **Alter‑ego swap picks the first ego whose keywords match** (3077‑3081). If "human" and "werewolf" both appear ("the werewolf turns back into a human"), list order decides.

### Step 1c · Structure: split `index.js`?
Sizes by section:
- UI rendering 2,632 lines, which includes about 970 lines of CSS inside a JS string (6401‑7372);
- UI events 1,629;
- state model 1,026;
- context access 901;
- import/export 566.

Character and persona code is duplicated almost line for line:
- `normalizeAlterEgo` / `normalizePersonaAlterEgo`, `createBlank*AlterEgo`, `normalizeState` / `normalizePersonaState`;
- `bindAlterEgoHandlers` / `bindPersonaAlterEgoHandlers` (about 290 lines each);
- `renderAlterEgoControlsHtml` / `renderPersonaAlterEgoControlsHtml` (about 180 lines each);
- the six remove/reset functions (5545‑5817);
- import/export pairs and token estimates.

That is roughly 2,000 duplicated lines. A small "scope adapter" (`{ read, save, nameOf, avatarOf, supportsTriggerActions }`) would let one copy serve both. A start exists at 8752‑8810.

**The upstream trade‑off.** This repo is a fork of `Vectricity/st-aspect-evolutia`. Any split or dedupe means every future upstream change to `index.js` has to be ported by hand. Recommendation:
- **If you plan to keep pulling from upstream:** keep the single file. Make only targeted fixes. Do two zero‑risk extractions:
  1. CSS → `style.css` via the manifest's `"css"` key (no build step, supported by ST and SB);
  2. delete dead code.
- **If this fork is going its own way:** split into ES modules (no bundler needed; ST loads `index.js` as a module and relative imports work) along the existing section boundaries: `state/`, `triggers/`, `prompt/`, `alter-ego/`, `ui/`. Do the character/persona dedupe *during* the E‑01 rewrite, since that touches the same code anyway.

---

## Step 2 — Is the approach sound?

### 2.1 Keyword matching — **Tune**
- **Steelman:** It's predictable, instant, costs nothing, needs no model, and users understand it. Lowercasing and comma lists keep it simple.
- **Realistic failures:** words inside other words (E‑09); negation ("doesn't take off her coat"); synonyms and paraphrases ("she shrugs off the jacket" ≠ "takes off her coat"); the model's own prose re‑triggering things; ALL‑mode surprises.
- **Alternatives:**
  - *Whole‑word plus optional regex* (ST World Info semantics): clearly better at almost no cost.
  - *Model‑classified triggers*, e.g. asking a small model "did the coat come off?": catches paraphrase. But it costs one extra request per turn (latency and money), and it's non‑deterministic. Worth it only as an opt‑in per field. Not as the default.
- **Verdict:** Tune. Make whole words the default, add `/regex/`, and show "matched on: …" in the UI for debugging.

### 2.2 Trigger sources and how much chat they scan — **Tune**
- **Steelman:** Looking only at the latest message makes triggers responsive and stops old mentions from lingering.
- **What it actually does:** Activating triggers look at **only the single latest** user or assistant message (2879‑2905). Something mentioned three messages ago does **not** count. Enabling and Disabling triggers *latch* (they stay set), so they persist anyway. As noted in E‑04, the World Info, Quiet and System sources don't work as labelled.
- **Failures:** Swipes re‑evaluate the same user message, which is fine. Continue re‑evaluates too. A topic raised by the user, answered by the character, and then followed by an unrelated user line drops the field even though the scene is still about it. "Last Assistant Message" feeds the model's own words back as triggers, which creates a reinforcement loop (see 2.5).
- **Alternative:** ST World Info already has `scanDepth` (scan the last N messages), whole‑word matching, `sticky` (stay on for N turns), `cooldown` and `delay`. Copying those four ideas per field is clearly better and cheap.
  - Moving fields *into* World Info outright would reuse ST's engine. But fields would lose their per‑card grouping, ordering and alter‑ego sets, and the setup burden for users goes up. Not recommended.
- **Verdict:** Tune. Add per‑field "scan last N messages" (default 1, so behaviour doesn't change) and "stay active for N turns". Fix or rename the broken sources.

### 2.3 Activating / Enabling / Disabling model and state persistence — **Keep the model, Replace the persistence**
- **Steelman:** It separates "relevant right now" (Activating) from "currently true" (Enabling/Disabling latch). That's the right distinction for outfits, injuries and forms. Trigger Actions add a narrative beat before a state change, which is a nice idea.
- **Failures:** Everything in E‑01, E‑02, E‑03 and E‑11. Also: three trigger types plus an action plus phases is a lot to learn, and the UI doesn't show *why* a field is on or off right now.
- **Alternative:** Same model, but state is derived from chat history (E‑01). On top of that:
  - a small "state" indicator per field (on/off, because of which keyword, in which message);
  - a manual "set state for this chat" toggle that is separate from the card's default.

  The cost is one more data location (the chat), and per‑message storage of a few bytes per field.
- **Verdict:** Keep the three‑trigger model. Replace where state lives.

### 2.4 Injection through Prompt Manager entries and macros — **Tune**
- **Steelman:** Users control placement by dragging the entry. The native description stays untouched and recoverable. The macro falls back to the native text automatically. It doesn't fight other extensions for injection depth.
- **Failures:** Text Completion (E‑05), presets that use `{{description}}` (E‑07), groups (E‑06), rewriting the preset file on every chat switch, and Trigger Actions being stuck in a far‑away slot (E‑12).
- **Alternatives:**
  - (a) Keep PM for CC, plus a story‑string macro swap for TC. Recommended; moderate effort.
  - (b) Temporarily swap `character.description` in memory during generation. That covers TC, CC, presets and every other consumer in one go. The extension appears to have done this before (the leftover `descriptionBackups`). But it's riskier: ST might save the card mid‑generation and persist the swap.
  - (c) `setExtensionPrompt` only: loses user placement.

  (a) is clearly the best balance.
- **Verdict:** Tune. Use (a), plus "enable once per preset" (E‑06), plus moving Trigger Actions to depth (E‑12).

### 2.5 Does it actually reduce flanderization? — **Partly. Be honest about the limits.**
- **What it fixes:** A static description repeats every trait every turn at equal weight. Splitting into fields and injecting situational ones *only when relevant* (Activating triggers) removes constant pressure from traits that don't matter in the current scene. Enabling/Disabling lets state change (outfit, injuries, form), so the model isn't told stale facts. That's real.
- **What it doesn't fix:** In long chats, the dominant driver of flanderization is the **chat history**. The model copies the tone, catchphrases and tics of its own last 20‑50 replies far more strongly than it follows a description at the top of the prompt. Evolutia doesn't touch history.
- **Where it can make things worse:**
  - Fields that are always on (no Activating triggers) behave exactly like a static description with extra labels.
  - "Last Assistant Message" as a trigger source creates a loop. The model mentions a trait, the trait's field activates, the field reminds the model of the trait, and the model mentions it again. That is flanderization by design.
- **Complements:** summarizing or hiding old messages; sampler settings such as DRY and repetition penalty; and keeping the description in step with the story, which is what §3 proposes.
- **Verdict:** Keep. It's a useful lever on one of the two causes. Recommend warning in the README/UI against "Last Assistant Message" on trait fields.

---

## Step 3 — Missing capability: model‑assisted field updates

**Is it true that content only changes by hand?** Yes, confirmed. The only code that writes `field.content` is the editor textarea handler (9706) and import. Automatic logic changes only the Inject switch, trigger phases and the active alter ego.

### How to call the model without switching the user's connection
- ST (release, staging) and SB all provide `ConnectionManagerRequestService.sendRequest(profileId, prompt, maxTokens, {stream, signal, extractData, includePreset, includeInstruct}, overridePayload)`. It's exported on `getContext()` (ST `st-context.js:319`; class at `extensions/shared.js:396‑…`; SB `shared.js:525`).
  - It sends a one‑off request through a saved **connection profile** without changing the active connection.
  - It supports both CC and TC profiles.
  - It throws if the Connection Manager extension is disabled.
  - `getSupportedProfiles()` and `handleDropdown()` give a ready‑made profile picker.
- **Fallback when no profile is chosen:** `getContext().generateRaw({ prompt, systemPrompt, responseLength, jsonSchema })` on the active connection.
  - It does **not** run generate interceptors or emit `GENERATION_ENDED` (ST `script.js:4027‑4160`), so it won't disturb Evolutia's own state.
  - Do **not** use `generateQuietPrompt`. It runs the full generation pipeline, including all interceptors (see E‑03).
- `jsonSchema` support differs by backend. Ask for JSON in the prompt and parse defensively; use the schema where available.

### SillyBunny's in‑chat agents
- **What exists:** SB runs agents in `pre`, `post` or `both` phases. They are hooked on `GENERATION_AFTER_COMMANDS`, `CHAT_COMPLETION_PROMPT_READY`, `MESSAGE_RECEIVED`, and SB‑only `MAIN_GENERATION_OUTPUT_READY` (SB `agent-runner.js:3739‑5425`). There are tracker templates for status/injuries, relationships, scene, items, NPC profiles, plus memory‑compression companions.
  - Tracker state lives in the reply text and `message.extra` per swipe, with a copy in `chat_metadata.agent_<var>`.
  - **No agent edits character or persona cards or descriptions.** So SB covers "track changing facts as side notes" but not "update the character's definition".
- **Hooking in:** there's no formal plug‑in API. The only global is `globalThis.SillyBunnyAgents.getEnabledAgents` (SB `in-chat-agents/index.js:1381`). Results can be observed via the `in_chat_agent_companion_results_updated` event and `message.extra.inChatAgentCompanionResults`. Registering an agent requires importing SB's internal `agent-store.js`, which is fragile.
- **Recommendation:**
  - On SB, *read* existing tracker output when it exists (feature‑detect `globalThis.SillyBunnyAgents`, then look for `chat_metadata.agent_*`, or the `[STATUS|…]` blocks in recent messages). Offer it as an extra evidence source for proposals.
  - Don't register Evolutia as an SB agent.
  - On plain ST, run standalone. The core pipeline is identical on both hosts.

### Timing and cost
| Option | Cost per run | Pros | Cons |
|---|---|---|---|
| Manual button "Propose updates from recent chat" | 1 request; about 2‑6k input tokens (fields plus last N messages) and about 300‑800 output | Zero surprise, zero background cost, easiest to trust | User has to remember |
| End of scene (user marks it, or a `/evolutia-review` slash command) | same | Natural review point; better evidence | Needs a scene concept |
| Every N messages (e.g. N=10, input = only the new messages) | about 1 request per N turns, about 10‑20% extra token spend at N=10 | Hands‑off | Proposals pile up; drift risk grows; latency or contention if it runs on the main connection |

**Recommendation:** ship the manual button plus a slash command first. Add "every N messages → queue proposals, never apply" later, only with a separate profile set.

### Designing against drift (the flanderization risk)
The danger is real. A model summarizing its own roleplay will over‑weight whatever it has been repeating. Rules:
1. **Never apply silently.** Every proposal is a diff (old → new) per field. Approve, edit or reject each hunk. The default action is *nothing*.
2. **Evidence required.** Each proposed change must quote the message number(s) and an excerpt. The extension checks the quote actually exists in those messages and drops proposals with unverifiable citations.
3. **Protected "core" fields.** Fields marked Core (default: Background, Personality) can't be targeted by proposals at all, or only with an extra confirmation. Proposals go to *state* fields: Injuries, Outfit, Relationships, Known Facts.
4. **Additive and specific.** The prompt asks only for *new facts or changed state* ("left arm bandaged after the fight in #142"). It forbids adjectives about personality and forbids restating existing content. Reject proposals that grow a field by more than X%.
5. **Source only from user messages plus chosen evidence**, optionally SB trackers. Using assistant messages as the only evidence for personality changes is not allowed.
6. **Version history and undo.** Each applied change stores `{before, after, sourceMessages, date}` per field (last 20), with a one‑click revert.
7. **Per‑chat by default.** Updates apply to the chat's state layer from E‑01. "Promote to card" is a separate, deliberate action.

### Scope: inside Evolutia or a companion extension?
**Inside Evolutia, as an optional module** that is off by default and lives in its own file if you split. It needs intimate access to the field model, protected flags, per‑chat state and the UI. A separate extension would have to reach into Evolutia's storage format, and the two would drift.

**Is it a good idea?** Yes, *after* E‑01. Without per‑chat state, auto‑updates would rewrite the card globally from one chat's events. That would be the bad version, and I'd advise against building it on the current storage.

---

## Step 4 — Compatibility

Legend: **OK** works as used · **Fragile** works today but deprecated, guessed or brittle · **Broken** doesn't do what the code expects.

### Imports
| Dependency | Lines | ST release | ST staging | SillyBunny |
|---|---|---|---|---|
| `script.js` → `saveSettingsDebounced` | 13‑16 | OK | OK | OK |
| `script.js` → `setCharacterName` | 13‑16 | OK | OK | OK (also called by SB group wrapper; Evolutia re‑applies) |
| `extensions.js` → `getContext` | 17 | OK | OK | OK |
| `openai.js` → `promptManager` (live binding) | 18 | OK | OK | OK |
| `macros.js` → `MacrosParser.registerMacro` | 19, 3701‑3734 | **Fragile** (deprecated; logs a warning; bridged to the new engine) | **Fragile** | **Fragile** |
| `personas.js` → `user_avatar` | 20 | OK | OK | OK |
| `power-user.js` → `power_user`, `persona_description_positions` | 21 | OK | OK | OK |
| Direct internal imports in general (path `../../../../script.js` assumes `third-party/<name>/`) | — | Fragile | Fragile | Fragile |

### `getContext()` members
| Member | ST rel | ST stg | SB |
|---|---|---|---|
| `chat`, `characters`, `characterId`, `groupId`, `groups`, `name1`, `eventSource`, `eventTypes`, `writeExtensionField`, `saveChat`, `getThumbnailUrl`, `getTokenCountAsync`, `callGenericPopup`, `POPUP_TYPE`, `saveSettingsDebounced` | OK | OK | OK |
| `extensionPrompts` (used as "Quiet Prompts") | Broken semantics (E‑04) | same | same |
| `worldInfo`, `world_info`, `activatedWorldInfo`, `lorebooks`, `wiEntries`, … (14 names) | **Broken** (none exist) | **Broken** | **Broken** (SB has `worldInfoSettings`, not entries) |
| `quietPrompts`, `promptBias`, `user_avatar`, `personaId`, `activePersonaId`, `selected_group`, `power_user`, `powerUser` | don't exist; harmless fallbacks | same | `userAvatar` exists in SB |

### Prompt Manager
| Hook | ST rel | ST stg | SB |
|---|---|---|---|
| `promptManager.serviceSettings`, `.activeCharacter`, `.configuration.promptOrder.strategy/dummyId`, `getPromptOrderForCharacter`, `getPromptById`, `addPrompt`, `saveServiceSettings`, `render` | OK | OK | OK (SB PM is heavily extended but keeps these) |
| Native identifiers `charDescription`, `personaDescription` | OK | OK | OK |
| `getPromptCollection()` (only in dead `getPromptByName`) | n/a | n/a | n/a |
| PM on Text Completion | **Broken for TC** (E‑05) | same | same |

### Events (all exist on all three hosts)
`APP_INITIALIZED`, `APP_READY`, `CHAT_CHANGED`, `CHARACTER_EDITED`, `CHARACTER_PAGE_LOADED`, `CHARACTER_DELETED/DUPLICATED/RENAMED`, `PERSONA_CHANGED/CREATED/UPDATED/RENAMED/DELETED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `USER_MESSAGE_RENDERED`, `CHARACTER_MESSAGE_RENDERED`, `GENERATE_AFTER_DATA`, `GENERATE_AFTER_COMBINE_PROMPTS`, `GENERATION_ENDED`, `GENERATION_STOPPED`, `OAI_PRESET_CHANGED_AFTER`, `PRESET_CHANGED`, `SETTINGS_UPDATED`, `WORLDINFO_UPDATED`, `WORLDINFO_SETTINGS_UPDATED`: **OK** on all.
- `GENERATION_ENDED` / `GENERATION_STOPPED` *ordering* is relied on: **Broken** assumption on all hosts (E‑02).
- SB: nested "auxiliary" quiet runs call interceptors but don't emit `GENERATION_ENDED` (SB `script.js:7970, 9191‑9196`). Evolutia reuses the outer lifecycle there, which is OK by accident.

### Interceptor contract
| | ST rel | ST stg | SB |
|---|---|---|---|
| `globalThis[manifest.generate_interceptor](chat, contextSize, abort, type)` | OK (but `type` ignored → E‑03) | OK | OK (same call at SB `script.js:7970`) |

### DOM selectors that matter
| Selector | Used for | ST rel | ST stg | SB |
|---|---|---|---|---|
| `#description_textarea` | mount character UI | OK | OK | OK (gained class `text_pole`) |
| `#rm_ch_create_block`, `#avatar_load_preview` | editor root / avatar preview | OK | OK | OK |
| `#character_popup` | editor root fallback | OK | OK | OK |
| `#CharID<n>` + `.ch_name`, `img` | character list alter‑ego visuals | OK | OK | OK |
| `#persona_description` | mount persona UI | OK | OK | **Fragile**: now inside SB's tabbed persona editor (`#persona_editor_panel_prompt` in `#persona_workspace_panel_edit`). Hiding the "native region" walks up the DOM looking for blocks (7604‑7840) and may hide or misplace things in the new layout (**Suspected**). SB also adds *persona appendices*, so the "effective" persona text can differ from the textarea; Evolutia ignores them. |
| `#persona_description_position` | position check | OK | OK | OK |
| `#persona_description_token_count` | hide counter | OK | OK | OK |
| `#user_avatar_block .avatar-container.selected[data-avatar-id]` | persona ID fallback | OK | OK | OK (moved into browse tab) |
| `#your_name` | persona name fallback | OK | OK | OK |
| `#result_info` | hide token counter | OK | OK | OK |
| `#extensions_settings2` | settings drawer | OK | OK | OK |
| `#chat .mes[mesid] .ch_name .name_text`, `.avatar img` | message re‑stamping | OK | OK | OK |
| `#typing_indicator` | third‑party Typing Indicator ext. | feature‑detected; OK | OK | OK |
| `#persona_container`, `#persona_list`, `#persona_management`, `#persona_settings`, `#persona_panel`, `#user_name`, `#user_avatar`, `#avatar_preview`, `#character_edit_dialogue`, `#persona_description_textarea/_holder/_container/_block` | guessed fallbacks | absent (harmless) | absent | absent |
| `window.confirm` / `window.prompt` | confirmations | OK | OK | OK (but inconsistent with ST popups) |

---

## Decisions for you

Recommended order follows your rule: bugs → compatibility → refactor → features.

1. **E‑01: Move runtime state to the chat** (per message/swipe, with card values as defaults; migrate and back up). *Recommend: approve.* It's the foundation for 2, 3, 11 and the Step 3 feature.
2. **E‑02: Fix swipe and Stop handling of Trigger Actions** (built on #1). *Recommend: approve.*
3. **E‑03: Respect generation type** (quiet = read‑only, impersonate = no actions). *Recommend: approve.* Small and independent; can go first.
4. **E‑04: Fix trigger sources** (real World Info via `WORLD_INFO_ACTIVATED`; rename "Quiet Prompts" → "Extension Injections"; drop or redefine "System Prompts"). *Recommend: approve.* Question for you: drop "System Prompts", or keep it as "system messages in chat"? I'd keep it, redefined.
5. **E‑09: Whole‑word keyword matching plus `/regex/`.** *Recommend: approve, with existing fields migrated to a "legacy substring" flag* so current cards behave the same until you flip them. Alternative: switch everyone to whole‑word.
6. **E‑10, E‑11, E‑14: small persistence fixes** (per‑key save timers and flush on unload; random generation IDs; persona storage moved to `extension_settings` with migration and cleanup on delete). *Recommend: approve.*
7. **E‑08: Move uploaded alter‑ego images out of messages and cards into files** (migration plus backup). *Recommend: approve.*
8. **E‑06: Enable the Evolutia PM entry once per preset instead of toggling per character; group "join" support.** *Recommend: approve.*
9. **E‑07: Detect `{{description}}`/`{{persona}}` in preset prompts; warn and offer to replace (with backup).** *Recommend: approve.*
10. **E‑05: Text Completion support via a story‑string macro swap (with backup and undo).** *Recommend: approve (option a).* Alternative: document as CC‑only.
11. **MacrosParser → new `macros.register` API with fallback** (feature‑detected). *Recommend: approve.*
12. **E‑12: Inject Trigger Actions near the end of the chat (depth 0‑1) with new third‑person wording; allow `{{char}}`; update README.** *Recommend: approve.* Behaviour change: existing actions move position.
13. **E‑13: Remove dead code; wire alter‑ego export/import.** *Recommend: approve.*
14. **Structure.** Do you plan to keep merging from `Vectricity/st-aspect-evolutia`?
    - If **yes**: only extract CSS to `style.css` and leave the single file. *Recommend this unless you say otherwise.*
    - If **no**: split into ES modules and dedupe character/persona code during #1.
15. **Step 2 tunes:** per‑field "scan last N messages" and "stay active N turns" (defaults keep today's behaviour), plus a "why is this field on?" indicator. *Recommend: approve.*
16. **Step 3: model‑assisted proposals**, starting with a manual button and slash command, a connection‑profile picker with `generateRaw` fallback, diffs with message citations, protected Core fields, version history and undo, and read‑only use of SB trackers when present. *Recommend: approve as the last item, after #1.* Auto "every N messages" stays out of scope for now.
17. **README warning against "Last Assistant Message" on personality fields** (the feedback loop). *Recommend: approve.*
18. **Testing:** in Phase 2 I'll run SillyBunny (and ST staging if feasible) in the sandbox with a scripted browser to verify E‑01/E‑02/E‑03 fixes and the SB persona panel (the Suspected part of the SB `#persona_description` row). *Recommend: approve.*
