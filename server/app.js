// Brawl Engine – Node-Server (lokal / Codespaces / Docker): Spiel ausliefern, API, WebSocket-Räume
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Database } from './db.js';
import { handleApi } from './api.js';
import { Arena } from './rooms.js';
import { configureAdmin } from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export function startServer({ port = 3000, dbPath = path.join(__dirname, '..', 'data', 'kistenkrawall.db'), quiet = false } = {}) {
  configureAdmin({ names: process.env.ADMIN_NAMES || 'Dinnerboneagg', code: process.env.ADMIN_CODE || '' });
  const db = new Database(dbPath);
  const arena = new Arena(db);

  const server = http.createServer(async (req, res) => {
    let url = (req.url || '/').split('?')[0];
    try { url = decodeURIComponent(url); } catch { res.writeHead(400); res.end(); return; }
    if (url.startsWith('/api/')) {
      try {
        let body = {};
        if (req.method === 'POST') {
          try { body = JSON.parse((await readBody(req, 64 * 1024)) || '{}'); } catch { body = null; }
        }
        const r = body === null
          ? { status: 400, data: { error: 'Ungültige Anfrage.' } }
          : await handleApi(db, { method: req.method, path: url, body, token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), ip: req.socket.remoteAddress || '?', stats: arena.stats() });
        res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(r.data));
      } catch (e) {
        console.error(e);
        if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Serverfehler"}'); }
      }
      return;
    }
    if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
    if (url === '/') url = '/index.html';
    const file = path.normalize(path.join(PUBLIC, url));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server, maxPayload: 4096 });
  wss.on('connection', (ws) => {
    const c = arena.connect((text) => { if (ws.readyState === 1) ws.send(text); });
    ws.on('message', (raw) => arena.message(c, String(raw)));
    ws.on('close', () => arena.close(c));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (!quiet) console.log(`Datenbank: ${dbPath}`);
      resolve({
        server, db, port: server.address().port,
        close: () => new Promise((ok) => {
          arena.shutdown();
          for (const c of wss.clients) c.terminate();
          wss.close(); server.close(() => { db.close(); ok(); });
        }),
      });
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (d) => { size += d.length; if (size > limit) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
