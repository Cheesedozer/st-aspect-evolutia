import { open, selectChar, send, clearRequests, lastPrompt, ev } from './st.mjs';
import { setCardState, newChat, field } from './fixtures.mjs';
const { browser, page, logs } = await open();
const fields = [
  field({ id: 'base', name: 'Base', content: 'BASE_FIELD' }),
  field({ id: 'wi', name: 'Mines', activatingTriggers: 'silver mines', triggerSources: ['world_info_lorebooks'], content: 'WI_FIELD' }),
  field({ id: 'an', name: 'Note', activatingTriggers: 'noteword', triggerSources: ['quiet_prompts'], content: 'EXT_FIELD' }),
  field({ id: 'sys', name: 'Narr', activatingTriggers: 'thunder', triggerSources: ['system_prompts'], content: 'SYS_FIELD' }),
];
await setCardState(page, 'Seraphina', { swapEnabled: true, activeAlterEgoId: 'base', alterEgos: [{ id: 'base', name: 'Seraphina', fields }], fields });
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500);
await selectChar(page, 'Seraphina'); await newChat(page);
await ev(page, async () => { const c = SillyTavern.getContext(); try { await c.createNewWorldInfo('EvoTest', { interactive: false }); } catch (e) {}
  await c.executeSlashCommandsWithOptions('/createentry file=EvoTest key=mines The Silver Mines are old.'); await c.executeSlashCommandsWithOptions('/world silent=true EvoTest'); });
const K = ['BASE_FIELD','WI_FIELD','EXT_FIELD','SYS_FIELD'];
let ok = true; const t = async (msg, want) => { await send(page, msg); const r = K.filter(k => lastPrompt().includes(k)).join(','); console.log(msg.padEnd(26), r); if (r !== want) { ok = false; console.log('  FAIL want', want); } };
clearRequests();
await t('Hello.', 'BASE_FIELD');
await t('We go to the mines.', 'BASE_FIELD,WI_FIELD');
await ev(page, async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/note NOTEWORD here'); });
await t('Again.', 'BASE_FIELD,EXT_FIELD');
await ev(page, async () => { const c = SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/note '); await c.executeSlashCommandsWithOptions('/sys Thunder rolls.'); });
await t('Listen.', 'BASE_FIELD,EXT_FIELD,SYS_FIELD');
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0,5).join('\n'));
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
