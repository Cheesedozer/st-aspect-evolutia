import { open, selectChar, send, idle, clearRequests, lastPrompt, ev, setReply, H, connectIfOffline } from './st.mjs';
import { wolfState, setCardState, newChat } from './fixtures.mjs';
import fs from 'node:fs';
const { browser, page, logs } = await open();
await setCardState(page, 'Seraphina', wolfState());
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500); await connectIfOffline(page);
await selectChar(page, 'Seraphina');
const K = ['BODY_CONTENT','TRANSFORM_NOW','WOLF_FORM'];
let ok = true; const chk = (l, want) => { const p = lastPrompt(); const r = K.filter(k => p.includes(k)).join(','); console.log(l.padEnd(30), r); if (r !== want) { ok = false; console.log('  FAIL want', want); } };
for (const streaming of [false, true]) {
  await ev(page, (st) => { const c = SillyTavern.getContext(); c.chatCompletionSettings.stream_openai = st; }, streaming);
  await newChat(page); clearRequests();
  console.log('--- streaming', streaming);
  // Continue keeps the same instructions as the original reply
  await send(page, 'The full moon rises.'); chk('full moon', 'BODY_CONTENT,TRANSFORM_NOW');
  await ev(page, async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/continue'); }); await page.waitForTimeout(500); await idle(page);
  chk('continue', 'BODY_CONTENT,TRANSFORM_NOW');
  // Stop: action not performed -> next reply still gets the action
  await ev(page, async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/del 2'); }); await page.waitForTimeout(800);
  setReply('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen');
  fs.writeFileSync(H + 'delay.txt', streaming ? '0' : '3000');
  await page.fill('#send_textarea', 'The full moon rises.'); await page.click('#send_but');
  await page.waitForTimeout(1500);
  await ev(page, () => SillyTavern.getContext().stopGeneration()); await idle(page);
  fs.writeFileSync(H + 'delay.txt', '0'); setReply(null);
  const last = await ev(page, () => { const c = SillyTavern.getContext().chat.at(-1); return { user: c.is_user, mes: c.mes.slice(0, 40), stamped: !!c.extra?.aspectEvolutia?.runtime }; });
  console.log('after stop last message', JSON.stringify(last));
  await ev(page, async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/trigger'); }); await page.waitForTimeout(500); await idle(page);
  chk(streaming ? 'after stop (partial kept)' : 'after stop', 'BODY_CONTENT,TRANSFORM_NOW');
}
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0,5).join('\n'));
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
