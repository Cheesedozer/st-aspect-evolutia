import { open, selectChar, send, ev, connectIfOffline } from './st.mjs';
import { setCardState, newChat, field, KEY } from './fixtures.mjs';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const { browser, page, logs } = await open();
const fields = [field({ id: 'b', name: 'B', content: 'X' })];
await setCardState(page, 'Seraphina', { swapEnabled: true, activeAlterEgoId: 'img', alterEgos: [{ id: 'base', name: 'Seraphina', fields }, { id: 'img', name: 'Pictured', avatarMode: 'image_file', avatarDataUrl: PNG, fields }], fields });
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500); await connectIfOffline(page);
await selectChar(page, 'Seraphina'); await newChat(page);
// simulate a legacy message carrying the data URL
await send(page, 'Hello.');
await ev(page, async (PNG) => { const c = SillyTavern.getContext(); const m = c.chat.at(-1); m.force_avatar = PNG; m.extra.aspectEvolutia = { ...(m.extra.aspectEvolutia||{}), alterEgo: { id: 'img', avatarUrl: PNG } }; await c.saveChat(); }, PNG);
// reopen chat to trigger migrations
await ev(page, async () => { const c = SillyTavern.getContext(); const id = c.getCurrentChatId(); await c.openCharacterChat(id); });
await page.waitForTimeout(4000);
await send(page, 'Again.');
await page.waitForTimeout(1500);
const r = await ev(page, (KEY) => { const c = SillyTavern.getContext(); const card = c.characters[c.characterId].data.extensions[KEY];
  const json = JSON.stringify(c.chat); return { cardEgo: { path: card.alterEgos.find(e=>e.id==='img').avatarFilePath, hasData: !!card.alterEgos.find(e=>e.id==='img').avatarDataUrl }, chatHasData: json.includes('data:image'), avatars: c.chat.filter(m=>!m.is_user).map(m => m.force_avatar) }; }, KEY);
console.log(JSON.stringify(r, null, 1));
const ok = r.cardEgo.path && !r.cardEgo.hasData && !r.chatHasData && r.avatars.slice(1).every(a => a && a.startsWith('/user/files/'));
const resp = await page.request.get('http://127.0.0.1:8000' + r.avatars.at(-1)); console.log('served', resp.status());
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0,5).join('\n'));
console.log(ok && resp.status() === 200 ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
