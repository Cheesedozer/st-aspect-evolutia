import { ev } from './st.mjs';
export const KEY = 'st-description-swap-fields';
export function field(o) { return { name: 'F', content: '', enabled: true, activatingTriggers: '', enablingTriggers: '', disablingTriggers: '', triggerSources: ['last_user_message'], activatingKeywordMode: 'any', enablingKeywordMode: 'any', disablingKeywordMode: 'any', triggerActionInstruction: '', ...o }; }
export function wolfState() {
  const fields = [
    field({ id: 'body', name: 'Body', content: 'BODY_CONTENT' }),
    field({ id: 'wolf', name: 'Wolf', enabled: false, enablingTriggers: 'full moon', disablingTriggers: 'sunrise', triggerActionInstruction: 'TRANSFORM_NOW', content: 'WOLF_FORM' }),
  ];
  return { swapEnabled: true, activeAlterEgoId: 'base', alterEgos: [{ id: 'base', name: 'Seraphina', fields }], fields };
}
export async function setCardState(page, name, state) {
  await ev(page, async ({ name, state, KEY }) => {
    const c = SillyTavern.getContext(); const id = c.characters.findIndex(x => x.name === name);
    await c.writeExtensionField(id, KEY, state);
  }, { name, state, KEY });
}
export async function newChat(page) {
  await ev(page, async () => { const c = SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/newchat'); });
  await page.waitForTimeout(2000);
}
