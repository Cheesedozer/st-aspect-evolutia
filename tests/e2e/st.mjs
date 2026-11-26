import { chromium } from 'playwright';
import fs from 'node:fs';
export const H = new URL('.', import.meta.url).pathname;
export const URL_ = process.env.ST_URL || 'http://127.0.0.1:8000/';
export async function open() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/aspect|evolutia|st-description|error/i.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(URL_);
  await page.waitForFunction(() => window.SillyTavern?.getContext?.()?.characters?.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await connectIfOffline(page);
  return { browser, page, logs };
}
export const ev = (page, fn, arg) => page.evaluate(fn, arg);
export async function selectChar(page, name) {
  await ev(page, async (name) => { const c = SillyTavern.getContext(); const id = c.characters.findIndex(x => x.name === name); await c.selectCharacterById(id); }, name);
  await page.waitForTimeout(1500);
}
export async function idle(page) {
  await page.waitForFunction(() => !document.body.dataset.generating, null, { timeout: 30000 });
  await page.waitForTimeout(800);
}
export async function send(page, text) {
  await page.fill('#send_textarea', text);
  await page.click('#send_but');
  await page.waitForTimeout(300);
  await idle(page);
}
export async function swipe(page) {
  await ev(page, () => SillyTavern.getContext().swipe.right());
  await page.waitForTimeout(300); await idle(page);
}
export function clearRequests() { try { fs.unlinkSync(H + 'requests.jsonl'); } catch {} }
export function requests() { try { return fs.readFileSync(H + 'requests.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
export function lastPrompt() { const r = requests().at(-1); if (!r) return ''; return r.body.messages ? r.body.messages.map(m => `<${m.role}> ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n') : r.body.prompt; }
export function setReply(t) { if (t == null) { try { fs.unlinkSync(H + 'reply.txt'); } catch {} } else fs.writeFileSync(H + 'reply.txt', t); }

// SillyTavern (unlike SillyBunny) does not auto-connect: press Connect for the
// active API when it is offline, so the Send button becomes available.
export async function connectIfOffline(page) {
  const status = await page.evaluate(() => SillyTavern.getContext().onlineStatus);
  if (status && status !== 'no_connection') return;
  await page.evaluate(() => { const api = SillyTavern.getContext().mainApi; $(api === 'openai' ? '#api_button_openai' : `#api_button_${api}`).trigger('click'); });
  await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}
