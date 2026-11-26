import { open, selectChar, send, clearRequests, lastPrompt, ev } from './st.mjs';
import { setCardState, newChat, field } from './fixtures.mjs';
const { browser, page, logs } = await open();
const fields = [
  field({ id: 'deep', name: 'Dragon', activatingTriggers: 'dragon', keywordMatching: 'words', scanDepth: 3, content: 'DEPTH_FIELD' }),
  field({ id: 'sticky', name: 'Storm', activatingTriggers: 'storm', keywordMatching: 'words', stickyTurns: 2, content: 'STICKY_FIELD' }),
  field({ id: 'wolf', name: 'Wolf', enabled: false, enablingTriggers: 'full moon', keywordMatching: 'words', content: 'WOLF_FORM' }),
];
await setCardState(page, 'Seraphina', { swapEnabled: true, activeAlterEgoId: 'base', alterEgos: [{ id: 'base', name: 'Seraphina', fields }, { id: 'w', name: 'Wolfling', changeConditions: 'howl', keywordMatching: 'words', fields: [field({ id: 'x', content: 'X' })] }], fields });
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500);
await selectChar(page, 'Seraphina'); await newChat(page); clearRequests();
const K = ['DEPTH_FIELD', 'STICKY_FIELD', 'WOLF_FORM'];
let ok = true; const t = async (msg, want) => { await send(page, msg); const r = K.filter(k => lastPrompt().includes(k)).join(','); console.log(msg.padEnd(22), r || '(none)'); if (r !== want) { ok = false; console.log('  FAIL want', want); } };
await t('A dragon appears.', 'DEPTH_FIELD');
await t('Hello.', 'DEPTH_FIELD');
await t('Okay.', 'DEPTH_FIELD');
await t('Later.', '');
await t('A storm rolls in.', 'STICKY_FIELD');
await t('One.', 'STICKY_FIELD');
await t('Two.', 'STICKY_FIELD');
await t('Three.', '');
await t('The full moon rises.', 'WOLF_FORM');
await page.waitForTimeout(800);
const status = await ev(page, () => $('.dsf-field[data-field-id="wolf"] .dsf-field-status').text().replace(/\s+/g, ' ').trim());
console.log('wolf status:', status); ok &&= /On — Enabled by "full moon" \(message #\d+\)/.test(status);
await t('We howl.', '');
await page.waitForTimeout(800);
const egoStatus = await ev(page, () => $('#dsf_alter_ego_row .dsf-field-status').text().replace(/\s+/g, ' ').trim());
console.log('ego status:', egoStatus); ok &&= /Wolfling — Swapped by "howl"/.test(egoStatus);
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0, 5).join('\n'));
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
