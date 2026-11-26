import { open, selectChar, send, clearRequests, lastPrompt, ev, connectIfOffline } from './st.mjs';
import { wolfState, setCardState, newChat } from './fixtures.mjs';
let ok = true;
for (const engine of [false, true]) {
  const { browser, page, logs } = await open();
  await ev(page, async (engine) => { const c = SillyTavern.getContext(); c.powerUserSettings.experimental_macro_engine = engine; c.saveSettingsDebounced(); await new Promise(r => setTimeout(r, 2000)); }, engine);
  await setCardState(page, 'Seraphina', wolfState());
  await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500); await connectIfOffline(page);
  logs.length = 0;
  await selectChar(page, 'Seraphina'); await newChat(page); clearRequests();
  await send(page, 'Hello.');
  const p = lastPrompt(); const dep = logs.filter(l => /DEPRECATED/.test(l)).length;
  console.log(`experimental engine=${engine}: fields`, p.includes('BODY_CONTENT'), 'raw macro leaked', p.includes('{{aspectEvolutia'), 'deprecation warnings', dep);
  ok &&= p.includes('BODY_CONTENT') && !p.includes('{{aspectEvolutia') && (engine ? dep === 0 : true);
  if (engine) await ev(page, async () => { const c = SillyTavern.getContext(); c.powerUserSettings.experimental_macro_engine = false; c.saveSettingsDebounced(); await new Promise(r => setTimeout(r, 2000)); });
  await browser.close();
}
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
