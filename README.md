# Aspect: Evolutia

<img src="https://github.com/Vectricity/st-aspect-destinia/raw/assets/assets/thumbnail_evolutia.png" alt="Thumbnail of Evolutia" width="400">

Aspect: Evolutia is a SillyTavern extension for swapping a Character’s / Persona’s static Description field on-demand with organized, trigger-aware Dynamic Fields. Even swap between alter egos, like a superhero or werewolf.

It is designed for Characters / Personas to evolve across arcs, stages, revelations, timelines, outfits, states, roles, or roleplay conditions. Instead of stuffing every version of a Character / Persona into the Description and asking the model to ignore irrelevant information, Aspect: Evolutia lets you split defining information into separate fields and inject only the fields that matter.

The goal is to make Characters / Personas cleaner, more stage-aware, and easier to maintain without permanently overwriting or deleting the original SillyTavern Description.

Works with SillyTavern (release and staging, 1.19+) and SillyBunny, with both Chat Completion and Text Completion APIs.

## What It Does

- Adds Alter Egos for Characters / Personas.
- Adds a Dynamic Fields mode to the Character editor and Persona editor.
- Hides the native Description field while Dynamic Fields mode is active (the native Description is kept, never deleted).
- Creates default fields for new setups: Background, Personality, Appearance.
- Lets fields be manually enabled, disabled, duplicated, deleted, and reordered.
- Supports trigger-aware injection through Activating, Enabling and Disabling Triggers.
- Keeps story state **per chat**: swipes, deleted messages, branches and other chats each have their own state.
- Supports optional Trigger Actions for Character Dynamic Fields.
- Optional: asks a model to **propose field updates** from the recent chat, which you approve one by one.
- Imports Character Dynamic Fields from the Character Description, SillyTavern Fields, File (JSON) or Clipboard (JSON); Persona Dynamic Fields from the Persona Description, File (JSON) or Clipboard (JSON).
- Exports Dynamic Fields **and alter egos** to File (JSON) or Clipboard (JSON).
- Shows a Dynamic Fields token estimate while Dynamic Fields mode is active.
- Includes extension drawer controls for cleanup, reset, prompt setup and proposals.

## Story State Lives With the Chat

Your field definitions (names, content, keywords) and defaults live on the character card / persona. What *happens in a story* lives with the chat:

- which fields are currently on or off (changed by Enabling / Disabling Triggers),
- which alter ego the chat is in,
- whether a Trigger Action has already happened.

Every reply remembers the state it was written with. So:

- **Swiping** a reply starts from the state before that reply. A transformation that should happen in the reply happens again on every swipe.
- **Deleting or editing** messages rolls the state back to what the remaining messages say.
- **Branches** and **other chats** with the same character don't inherit each other's state. A new chat starts from the card's defaults.
- **Stop** cancels: if you stop a reply, its Trigger Action is performed by the next reply instead.

Each field shows its state in the current chat, for example `In this chat: On — Enabled by "full moon" (message #18)`. The alter ego panel shows which alter ego the chat is in and what switched to it.

Changing the **Inject** checkbox or the **Current Ego** select while a chat is open applies to that chat right away and also becomes the default for new chats.

## Alter Egos

Swap between different versions of Characters / Personas, all through the same character card or persona, manually or via keyword triggers. Each alter ego has its own dynamic fields, so your Characters / Personas can be who they are meant to be in whatever form they take.

- The active alter ego is per chat (see above). `{{char}}` and the reply's name/avatar use the alter ego.
- Uploaded alter ego images are stored once in your SillyTavern Files folder; only the path is kept on the card and in chat messages. ("Embedded Image Data" stays embedded in the card so the card remains portable.)
- Export and import include all alter egos.

## Dynamic Fields

Each Dynamic Field can define separate Character / Persona information, for example: Background, Personality, Appearance, Current Outfit, Injuries, Relationships, Knowledge, Inventory, Current Location, Emotional State, Disguise.

Fields can be manually reordered, which also controls injection order.

## Keyword Triggers

Keyword Triggers decide when a field becomes eligible for injection or when its Inject state changes.

- **Activating Triggers**: the field's Content is injected only on turns where they match.
- **Enabling Triggers**: turn Inject on (stays on until something turns it off).
- **Disabling Triggers**: turn Inject off.

Separate keywords by comma, semicolon or newline. Each list can require **Any** or **All** of its keywords.

### How keywords match

- **Whole words** (default for new fields and alter egos): `arm` matches "her arm" but not "warm" or "alarm". Extra spaces inside multi-word keywords don't matter.
- **Anywhere (legacy)**: the behaviour before version 2.0; matches inside other words. Fields and alter egos created with older versions keep this setting until you change it ("Keywords match" in the Keyword Triggers menu).
- **Regular expressions**: put `/pattern/flags` on its own line, for example `/\bblood(y|ied)?\b/i`.

### Scan depth and staying active

In each field's Keyword Triggers menu:

- **Scan last N messages** (default 1): how many recent user / assistant / narrator messages the chat-based Trigger Sources look at. With 3, something mentioned two messages ago still counts.
- **Stay active for N more replies** (default 0): after an Activating Trigger matches, keep injecting the field's Content for N more replies even if the keyword isn't repeated.

## Trigger Sources

Trigger Sources decide where a field looks for keyword matches:

- **Last User Message**: your latest message(s).
- **Last Assistant Message**: the model's latest reply (see the warning below).
- **Last Narrator Message (/sys)**: the latest narrator message. (Called "System Prompts" in older versions.)
- **Extension Injections**: text injected by other extensions, such as Author's Note, Summarize, Vector memories, SillyBunny agents. (Called "Quiet Prompts" in older versions.)
- **World Info / Lorebooks**: the World Info entries activated for this reply (their title, keys and content).

### Avoid feedback loops with "Last Assistant Message"

"Last Assistant Message" scans the model's own reply. Don't use it on personality or trait fields: when the model mentions a trait, the field switches on and reminds the model of that trait, the model mentions it again, and the loop repeats. That is exactly the flanderization this extension is meant to prevent. It is fine for things the model narrates and that should change state, like an outfit coming off or an injury.

## Trigger Actions

Trigger Actions are optional instructions for a Character Dynamic Field. When the field is switched on by an Enabling Trigger (or its Activating Trigger fires), the reply first gets the action; the field's Content follows from the next reply on.

The action is sent as a short note right before the reply:

```text
[Story event for Seraphina in the next reply:
- Seraphina transforms into a werewolf.
Write this happening now, as Seraphina's own action, before continuing the scene.]
```

Write actions in the third person and use `{{char}}` / `{{user}}` for names:

```text
{{char}} transforms into a werewolf.
```

Example Content that becomes active after the action:

```text
{{char}} is currently in werewolf form.
```

Background generations (Summarize, image prompts, other extensions) and Impersonate never receive Trigger Actions and never change the story state.

Persona Dynamic Fields do not use Trigger Actions; they describe the user Persona, and the model should not act on the user's behalf.

## Model-Assisted Field Updates (optional)

Fields only change when you change them, unless you ask for proposals:

1. Click **Propose Updates** below the fields (or type `/evolutia-propose`, or `/evolutia-propose persona`).
2. A model reads the recent chat and proposes updates to fields (facts learned, relationships, injuries, outfit...).
3. You see each proposal as a diff, with the message numbers and exact quotes it is based on. **Nothing is ticked.** Tick the ones you want and click **Apply selected**.

Safeguards:

- Proposals whose quotes cannot be found in the chat are dropped. Proposals based only on the model's own replies, or that grow a field a lot, are flagged.
- **Core** fields (checkbox on each field; by default fields named Background or Personality) are never edited, only shown to the model as context.
- Approved updates apply to **this chat only**. The field shows "This chat uses an updated version" with **Revert** (undo the last update) and **Make permanent** (copy it to the card).

Settings (Extensions → Aspect: Evolutia → Field Update Proposals):

- **Connection**: a saved Connection Profile to use for proposals; your active connection is not switched. "Current connection" uses whatever is connected.
- **Messages to read** (default 20) and **Max reply tokens** (default 800).

Each proposal run is one extra request to the model.

## Prompt Setup

### Chat Completion (Prompt Manager)

Aspect: Evolutia adds two Prompt Manager entries, **Char Description (Evolutia)** and **Persona Description (Evolutia)**. When a chat uses Dynamic Fields, they are switched on and the native Char / Persona Description entries are switched off, once per preset. Characters and personas without Dynamic Fields still get their normal description through these entries, so this is safe for every chat, including group chats.

In group chats set to **Join character cards**, every member's description is included (Dynamic Fields or native), using the group's join prefix and suffix.

If your preset writes `{{description}}` or `{{persona}}` inside its own prompts, Evolutia offers once to replace them with `{{aspectEvolutiaCharDescription}}` / `{{aspectEvolutiaPersonaDescription}}`. Otherwise the model would get both the old description and the fields.

### Text Completion (story string)

The Prompt Manager does not exist for Text Completion. When you use Dynamic Fields with a Text Completion API, Evolutia offers once to replace `{{description}}` / `{{persona}}` in your story string with the Evolutia macros. If you decline, the extension drawer shows a reminder with a **Use Evolutia in Story String** button.

### Undo and uninstalling

- **Undo Macro Replacements** (Extensions → Aspect: Evolutia → Prompt Setup) restores the original preset prompts / story string.
- **Reset Extension (Characters / Personas)** restores the native Prompt Manager entries.

Do both before uninstalling, so your presets use the native descriptions again.

## Upgrading From 1.3.x

Existing characters and personas load as before. On the first save in the new format:

- The previous data of each character / persona is backed up once to your Files folder (`data/<user>/user/files/aspect-evolutia-backup-*.json`).
- Story state that 1.3.x stored on the card (Inject changes from triggers, active alter ego, Trigger Action progress) becomes the starting point for chats that don't have their own state yet.
- Persona Dynamic Fields move from the core settings to the extension settings; the old copy is kept.
- Uploaded alter ego images, and images that older versions copied into chat messages, are moved to files when a chat is opened. SillyTavern's chat backups keep the previous chat file.
- Existing fields keep "Anywhere (legacy)" keyword matching.

## For Developers

- `index.js` is the entry point; the code is in `src/` as native ES modules (no build step), and styles are in `style.css`.
- `tests/e2e/` contains optional browser tests (Playwright) that run against a local SillyTavern or SillyBunny with a fake model server. They are not needed to use the extension.

Please consider tipping a job well done.

<a href="https://ko-fi.com/genisai">
  <img src="https://github.com/Vectricity/st-aspect-destinia/raw/assets/assets/ko-fi_thumbnail_genisai.png" alt="Support Genisai on Ko-fi" width="400">
</a>
