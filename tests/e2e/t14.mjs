import { open, selectChar, ev, connectIfOffline } from './st.mjs';
import { wolfState, setCardState } from './fixtures.mjs';
const { browser, page, logs } = await open();
await setCardState(page, 'Seraphina', wolfState());
await page.reload(); await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0); await page.waitForTimeout(2500); await connectIfOffline(page);
await selectChar(page, 'Seraphina');
const answer = async (text) => { await page.waitForSelector('.popup-input', { timeout: 8000 }); await page.fill('.popup-input', text); await page.click('.popup-button-ok'); await page.waitForTimeout(900); };
const card = () => ev(page, () => { const c = SillyTavern.getContext(); return c.characters[c.characterId].data.extensions['st-description-swap-fields']; });
const persona = () => ev(page, async () => { const c = SillyTavern.getContext(); const { user_avatar } = await import('/scripts/personas.js'); return c.extensionSettings['st-description-swap-fields'].personaDynamicFields[user_avatar]; });
let ok = true; const check = (l, v) => { console.log(l.padEnd(40), v); if (!v) ok = false; };
const RUN = Date.now().toString(36);
for (const [scope, prefix, read] of [['character', 'dsf_', card], ['persona', 'dsf_persona_', persona]]) {
  const countBefore = (await read()).alterEgos.length;
  { const t = await read(); console.log('  before', t.alterEgos.map(e => e.name).join(','), 'active', t.alterEgos.find(e => e.id === t.activeAlterEgoId)?.name); }
  await ev(page, (id) => $(`#${id}`).trigger('click'), `${prefix}create_alter_ego`); await answer(`${scope}Ego${RUN}`);
  await page.waitForTimeout(600);
  let st = await read(); console.log(JSON.stringify(st.alterEgos.map(e => e.name)), st.activeAlterEgoId); check(`${scope}: created`, st.alterEgos.some(e => e.name === `${scope}Ego${RUN}`) && st.alterEgos.find(e => e.id === st.activeAlterEgoId)?.name === `${scope}Ego${RUN}`);
  await ev(page, (id) => $(`#${id}`).trigger('click'), `${prefix}rename_alter_ego`); await answer(`${scope}Renamed`);
  { const t = await read(); console.log('  after rename', t.alterEgos.map(e => e.name).join(','), 'active', t.alterEgos.find(e => e.id === t.activeAlterEgoId)?.name); }
  const cls = scope === 'persona' ? 'dsf-persona-alter-ego' : 'dsf-alter-ego';
  await ev(page, (cls) => $(`.${cls}-change-conditions`).first().val('zap now').trigger('input'), cls);
  await page.waitForTimeout(900);
  st = await read(); const ego = st.alterEgos.find(e => e.name === `${scope}Renamed`);
  check(`${scope}: renamed + swap triggers saved`, !!ego && ego.changeConditions === 'zap now');
  await ev(page, (id) => $(`#${id}`).val('base').trigger('change'), `${prefix}alter_ego_select`); await page.waitForTimeout(900);
  st = await read(); check(`${scope}: select base`, st.activeAlterEgoId === 'base');
  await ev(page, ({ id, egoId }) => $(`#${id}`).val(egoId).trigger('change'), { id: `${prefix}alter_ego_select`, egoId: ego.id }); await page.waitForTimeout(700);
  await ev(page, (id) => $(`#${id}`).trigger('click'), `${prefix}delete_alter_ego`); await page.waitForTimeout(1200);
  st = await read(); check(`${scope}: deleted, nothing left behind`, !st.alterEgos.some(e => e.name === `${scope}Renamed`) && st.alterEgos.length === countBefore);
}
console.log(logs.filter(l => /pageerror|\[error\]/i.test(l)).slice(0, 5).join('\n'));
await page.waitForTimeout(3000);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
