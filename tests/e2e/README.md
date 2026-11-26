# Browser tests (optional)

These scripts drive a real SillyTavern or SillyBunny in a headless browser
(Playwright) against a fake OpenAI-compatible server that records every
prompt. They are not needed to use the extension.

**Run them only against a throwaway SillyTavern/SillyBunny install**: they
overwrite the Evolutia data of the bundled "Seraphina" card, create chats,
a test World Info book, a group, and change settings.

## Setup

1. Install SillyTavern or SillyBunny and put this extension in
   `public/scripts/extensions/third-party/st-aspect-evolutia`.
2. Start the fake model server: `node fake-llm.mjs` (port 5001).
3. In the app, connect Chat Completion → Custom (OpenAI-compatible) to
   `http://127.0.0.1:5001/v1`, model `echo`, streaming off; for the Text
   Completion test also set Text Completion → Generic to the same URL.
4. Make Playwright importable from this folder (for example
   `npm i playwright` here, or a symlink to a global install).

Tested on SillyBunny 1.8.4 and SillyTavern staging 1.19.1. On plain
SillyTavern the helper presses Connect when the API is offline; t08 and t13
need a second character besides Seraphina.

## Run

```bash
ST_URL=http://127.0.0.1:8000/ ST_FILES_DIR=/path/to/data/default-user/user/files ./run-all.sh
```

Each test prints `ALL PASS` or `SOME FAILED`; `t03` and `t12` print
diagnostics instead. What they cover:

| Test | Covers |
|---|---|
| t-baseline, t01, t02 | Per-chat state: swipes, Continue, Stop, deleted messages, other chats, manual toggles, legacy data + backup |
| t01p | Persona fields and alter egos per chat; persona storage migration |
| t03 | Quiet (background) generations are read-only |
| t04 | Trigger sources: World Info, Extension Injections, narrator messages |
| t05 | Whole-word / legacy / regex keyword matching |
| t07 | Alter ego images moved out of cards and chat messages |
| t08 | Group chats: Prompt Manager entries, swap and join modes |
| t09 | Replacing `{{description}}` in presets, and Undo |
| t10 | Text Completion story string, and Undo |
| t11 | Legacy and new macro engine |
| t12 | Trigger Action placement (depth 0) and wording |
| t13 | Export / import with alter egos |
| t14 | Alter ego create / rename / select / delete (character and persona) |
| t15 | Scan depth, "stay active", "In this chat" status |
| t16, t16b | Field update proposals, quote checks, Revert / Make permanent, Connection Profile |
