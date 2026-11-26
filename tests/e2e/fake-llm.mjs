// Fake OpenAI-compatible server. Logs every request body to requests.jsonl and
// answers with the text in reply.txt (or a default), so tests can inspect prompts.
import http from 'node:http';
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const log = dir + 'requests.jsonl';
let n = 0;
function reply() { try { return fs.readFileSync(dir + 'reply.txt', 'utf8'); } catch { return `Reply number ${n}.`; } }
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    const json = body ? JSON.parse(body) : {};
    if (req.url.endsWith('/models')) { res.setHeader('content-type','application/json'); return res.end(JSON.stringify({ object:'list', data:[{id:'echo',object:'model'}] })); }
    n++;
    fs.appendFileSync(log, JSON.stringify({ url: req.url, body: json }) + '\n');
    const delay = Number(fs.existsSync(dir+'delay.txt') ? fs.readFileSync(dir+'delay.txt','utf8') : 0);
    if (delay) await new Promise(r => setTimeout(r, delay));
    const text = reply();
    if (json.stream && req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const words = text.split(' ');
      for (const w of words) {
        if (res.destroyed) return;
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: w + ' ' } }] }) + '\n\n');
        await new Promise(r => setTimeout(r, 150));
      }
      res.write('data: [DONE]\n\n'); return res.end();
    }
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('chat/completions')) {
      return res.end(JSON.stringify({ id:'x', object:'chat.completion', model:'echo', choices:[{index:0, message:{role:'assistant', content:text}, finish_reason:'stop'}] }));
    }
    res.end(JSON.stringify({ id:'x', object:'text_completion', model:'echo', choices:[{index:0, text, finish_reason:'stop'}], results:[{text}] }));
  });
}).listen(5001, '127.0.0.1', () => console.log('fake llm on 5001'));
