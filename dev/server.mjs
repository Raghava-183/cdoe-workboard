/*
  Local preview: `npm install` then `npm run dev`, open http://localhost:3000
  Uses a local database folder (.localdb) instead of Neon, and reads LOGIN_ID /
  LOGIN_PASSWORD from a .env.local file (copy .env.example to .env.local first).
*/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('user:password@host')) {
  delete process.env.DATABASE_URL;
  process.env.LOCAL_DB ||= path.join(root, '.localdb');
}

const routes = {
  '/api/read': (await import('../api/read.js')).default,
  '/api/save': (await import('../api/save.js')).default
};
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const fn = routes[url.pathname];
  if (fn) {
    req.query = Object.fromEntries(url.searchParams);
    res.status = c => { res.statusCode = c; return res; };
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    try { await fn(req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    return;
  }
  const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; res.end(); return; }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(process.env.PORT || 3000, () =>
  console.log('CDOE Workboard running at http://localhost:' + (process.env.PORT || 3000)));
