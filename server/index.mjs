import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { connectUpstream } from './upstream.mjs';
import { languages } from './protocol.mjs';
const port = Number(process.env.PORT || 5173), host = process.env.HOST || '127.0.0.1';
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.APP_PASSWORD) throw new Error('非 loopback 服務必須設定 APP_PASSWORD');
const dev = process.argv.includes('--dev');
const vite = dev ? await (await import('vite')).createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' }) : undefined;
const tickets = new Map(); let active = 0;
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const authorized = req => {
  if (!process.env.APP_PASSWORD) return true;
  const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${process.env.APP_PASSWORD}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin 不符' });
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Host 不符，請設定 APP_ORIGIN' });
      const kind = url.pathname.match(/^\/api\/session\/(openai|gemini)$/)?.[1];
      if (req.method !== 'POST' || !kind) return json(res, 404, { error: '找不到端點' });
      if (!authorized(req)) return json(res, 401, { error: '請輸入伺服器密碼' });
      if (!process.env[kind === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY']) return json(res, 503, { error: `${kind} 尚未設定伺服器 API Key；可先使用 Mock。` });
      for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key);
      if (tickets.size >= 30 || active >= 4) return json(res, 429, { error: 'Session 數量已達上限' });
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) return json(res, 413, { error: '請求過大' }); }
      let config; try { config = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON 無效' }); }
      if (!languages[config.foreignLanguage]) return json(res, 400, { error: '不支援的語言' });
      const ticket = randomBytes(32).toString('hex'); tickets.set(ticket, { kind, language: config.foreignLanguage, expires: Date.now() + 30000 });
      return json(res, 200, { ticket, expiresIn: 30, transport: 'server-websocket-proxy' });
    }
    if (vite) return vite.middlewares(req, res);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const root = resolve('dist'); const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) { res.writeHead(403); return res.end(); }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-cache'); res.end(await readFile(path));
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 600000 });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/live' || req.headers.origin !== origin || req.headers.host !== new URL(origin).host || active >= 4) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', client => {
  active++; let upstream, pending = [], bytes = 0, busy = false;
  const emit = value => { if (value.type === 'result') busy = false; if (client.readyState === 1) client.send(JSON.stringify(value)); };
  const fail = message => { emit({ type: 'error', message }); client.close(1011); };
  const authTimer = setTimeout(() => client.close(1008), 5000);
  const lifetime = setTimeout(() => fail('Session 已達 10 分鐘，請重新連線'), 600000);
  client.on('message', (raw, binary) => {
    try {
      if (binary) {
        if (!upstream || busy) throw new Error('不接受音訊');
        bytes += raw.length; if (bytes > 500000 || raw.length % 2) throw new Error('音訊超出限制');
        pending.push(raw); return;
      }
      const m = JSON.parse(raw.toString());
      if (!upstream) {
        const session = m.type === 'auth' && tickets.get(m.ticket);
        if (!session || session.expires < Date.now()) throw new Error('Session ticket 無效或過期');
        tickets.delete(m.ticket); clearTimeout(authTimer);
        upstream = connectUpstream(session.kind, session.language, emit, fail);
      } else if (m.type === 'commit' && !busy && bytes >= 4800) {
        busy = true; upstream.submit(Buffer.concat(pending)); pending = []; bytes = 0;
      } else throw new Error('無效的音訊操作');
    } catch (e) { fail(e.message || '請求失敗'); }
  });
  client.on('error', () => client.close());
  client.on('close', () => { active--; clearTimeout(authTimer); clearTimeout(lifetime); upstream?.close(); pending = []; });
});
server.listen(port, host, () => console.log(`Interpreter: ${origin} (${dev ? 'development' : 'production'})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const client of wss.clients) client.close(); server.close(); void vite?.close(); });
