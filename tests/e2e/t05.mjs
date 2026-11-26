import { open, selectChar, send, clearRequests, lastPrompt, ev } from './st.mjs';
import { setCardState, newChat, field } from './fixtures.mjs';
const { browser, page, logs } = await open();
const fields = [
  field({ id: 'legacy', name: 'L', activatingTriggers: 'arm', content: 'LEGACY_ARM' }),           // no keywordMatching -> legacy substring
  field({ id: 'words', name: 'W', activatingTriggers: 'arm', keywordMatching: 'words', content: 'WORDS_ARM' }),
  field({ id: 'rx', name: 'R', activatingTriggers: '/\\bblood(y|ied)?\\b/i', keywordMatching: 'words', content: 'REGEX_BLOOD' }),
  field({ id: 'multi', name: 'M', activatingTriggers: 'full moon', keywordMatching: 'words', content: 'MULTI_WORD' }),
];
await setCardState(page, 'Seraphina', { swapEnabled: true, activeAlterEgoId: 'base', alterEgos: [{ id: 'base', name: 'Seraphina', fields }], fields });
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500);
await selectChar(page, 'Seraphina'); await newChat(page);
const K = ['LEGACY_ARM','WORDS_ARM','REGEX_BLOOD','MULTI_WORD'];
let ok = true; const t = async (msg, want) => { await send(page, msg); const r = K.filter(k => lastPrompt().includes(k)).join(','); console.log(msg.padEnd(36), r || '(none)'); if (r !== want) { ok = false; console.log('  FAIL want', want); } };
clearRequests();
await t("It's warm today.", 'LEGACY_ARM');
await t('She hurt her arm.', 'LEGACY_ARM,WORDS_ARM');
await t('Her Bloodied hands. Full  Moon.', 'REGEX_BLOOD,MULTI_WORD');
await t('Bloodstone and honeymoon.', '(none)'.replace('(none)',''));
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
