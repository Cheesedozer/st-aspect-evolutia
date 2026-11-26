import { open, selectChar, send, clearRequests, lastPrompt, ev, setReply, requests, idle, connectIfOffline } from './st.mjs';
import { setCardState, newChat, field } from './fixtures.mjs';
const { browser, page, logs } = await open();
const fields = [
  field({ id: 'bg', name: 'Background', content: 'Guardian of the glade.' }),
  field({ id: 'inj', name: 'Injuries', content: 'None.' }),
  field({ id: 'out', name: 'Outfit', content: 'A green dress.' }),
];
await setCardState(page, 'Seraphina', { swapEnabled: true, activeAlterEgoId: 'base', alterEgos: [{ id: 'base', name: 'Seraphina', fields }], fields });
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500); await connectIfOffline(page);
await selectChar(page, 'Seraphina'); await newChat(page);
await send(page, 'I bandage your left arm after the fight.');
const userIndex = await ev(page, () => SillyTavern.getContext().chat.findLastIndex(m => m.is_user));
setReply(JSON.stringify({ proposals: [
  { fieldId: 'inj', newContent: 'Left arm bandaged after the fight.', reason: 'User bandaged her arm.', evidence: [{ message: userIndex, quote: 'bandage your left arm' }] },
  { fieldId: 'out', newContent: 'Plate armor.', reason: 'Changed clothes.', evidence: [{ message: userIndex, quote: 'she changes into armor' }] },
  { fieldId: 'bg', newContent: 'A warrior.', reason: 'x', evidence: [{ message: userIndex, quote: 'after the fight' }] },
] }));
clearRequests();
await ev(page, () => { void SillyTavern.getContext().executeSlashCommandsWithOptions('/evolutia-propose'); });
const popup = await page.waitForSelector('.dsf-proposals', { timeout: 15000 }).catch(() => null);
const popupText = popup ? (await popup.textContent()).replace(/\s+/g, ' ') : '';
console.log('popup:', popupText.slice(0, 260));
const req = requests().at(-1); const reqText = JSON.stringify(req?.body ?? {});
console.log('proposal request: has sheet', reqText.includes('SHEET FOR'), 'core sent as editable', reqText.includes('[id: bg]'), 'interceptor ran', reqText.includes('[CHARACTER DEFINITIONS]'));
let ok = !!popup && popupText.includes('Injuries') && !popupText.includes('Plate armor') && popupText.includes('2 proposal(s) were dropped') && !reqText.includes('[id: bg]') && !reqText.includes('[CHARACTER DEFINITIONS]');
await page.check('.dsf-proposal-check'); await page.click('.popup-button-ok'); await page.waitForTimeout(1200);
setReply(null);
clearRequests(); await send(page, 'How is it?');
let p = lastPrompt(); console.log('chat uses update', p.includes('Left arm bandaged'), 'old gone', !p.includes('None.'));
ok &&= p.includes('Left arm bandaged') && !p.includes('None.');
const card = () => ev(page, () => { const c = SillyTavern.getContext(); return c.characters[c.characterId].data.extensions['st-description-swap-fields'].fields.find(f => f.id === 'inj').content; });
console.log('card unchanged', await card()); ok &&= (await card()) === 'None.';
const notice = await ev(page, () => $('.dsf-field[data-field-id="inj"] .dsf-chat-override summary').text().trim()); console.log('notice:', notice); ok &&= notice.startsWith('This chat uses an updated version');
console.log('before revert md', JSON.stringify(await ev(page, () => SillyTavern.getContext().chatMetadata.aspectEvolutia?.content)));
await ev(page, () => $('.dsf-field[data-field-id="inj"] .dsf-chat-override-revert').trigger('click')); await page.waitForTimeout(800);
console.log('after revert md', JSON.stringify(await ev(page, () => SillyTavern.getContext().chatMetadata.aspectEvolutia?.content)), 'count', await ev(page, () => $('.dsf-field[data-field-id="inj"] .dsf-chat-override-revert').length));
clearRequests(); await send(page, 'And now?'); p = lastPrompt(); console.log('after revert uses card', p.includes('None.') && !p.includes('Left arm bandaged')); ok &&= p.includes('None.') && !p.includes('Left arm bandaged');
// apply again then make permanent
setReply(JSON.stringify({ proposals: [{ fieldId: 'inj', newContent: 'Left arm bandaged after the fight.', reason: 'r', evidence: [{ message: userIndex, quote: 'bandage your left arm' }] }] }));
await ev(page, () => { void SillyTavern.getContext().executeSlashCommandsWithOptions('/evolutia-propose'); });
await page.waitForSelector('.dsf-proposal-check', { timeout: 15000 }); await page.check('.dsf-proposal-check'); await page.click('.popup-button-ok'); await page.waitForTimeout(1200); setReply(null);
await ev(page, () => $('.dsf-field[data-field-id="inj"] .dsf-chat-override-promote').trigger('click')); await page.waitForTimeout(1500);
console.log('card after make permanent:', await card()); ok &&= (await card()) === 'Left arm bandaged after the fight.';
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0, 5).join('\n'));
await page.waitForTimeout(1500);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
