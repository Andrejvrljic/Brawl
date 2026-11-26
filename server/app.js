// Kistenkrawall – Server: Spiel ausliefern, REST-API mit Datenbank, WebSocket-Räume
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, MODES } from '../public/shared/game.js';
import { BRAWLERS } from '../public/shared/brawlers.js';
import { runAction, applyMatch, totalTrophies } from '../public/shared/progress.js';
import { Database } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const TICK = 1 / 30;
const QUEUE_WAIT = 12;
const OFFLINE_MIN_GAP = 25 * 1000; // Mindestabstand zwischen gemeldeten Bot-Matches
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export function startServer({ port = 3000, dbPath = path.join(__dirname, '..', 'data', 'kistenkrawall.db'), quiet = false } = {}) {
  const db = new Database(dbPath);
  const rooms = new Map();
  let roomSeq = 1;

  // ---------- einfache Begrenzung gegen Spam ----------
  const hits = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const h = hits.get(key) || { n: 0, t: now };
    if (now - h.t > windowMs) { h.n = 0; h.t = now; }
    h.n++; hits.set(key, h);
    if (hits.size > 5000) hits.clear();
    return h.n > max;
  }

  // ---------- REST-API ----------
  const publicProfile = (acc) => ({ profile: acc.profile, account: { registered: acc.registered, login: acc.login, rank: db.rankOf(totalTrophies(acc.profile)) } });

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress || '?';
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (limited('api:' + ip, 300, 60000)) return send(429, { error: 'Zu viele Anfragen – kurz warten.' });
    let body = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readBody(req, 64 * 1024) || '{}'); } catch { return send(400, { error: 'Ungültige Anfrage.' }); }
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const auth = () => db.byToken(token);

    switch (`${req.method} ${url}`) {
      case 'GET /api/health': return send(200, { ok: true, accounts: db.accountCount, rooms: rooms.size });
      case 'GET /api/leaderboard': return send(200, { top: db.leaderboard(50) });
      case 'POST /api/guest': {
        if (limited('guest:' + ip, 20, 10 * 60000)) return send(429, { error: 'Zu viele neue Konten – später nochmal.' });
        const { id, token: t } = db.createGuest(body.import);
        return send(200, { token: t, ...publicProfile(db.account(id)) });
      }
      case 'POST /api/login': {
        if (limited('login:' + ip, 10, 5 * 60000)) return send(429, { error: 'Zu viele Versuche – in ein paar Minuten nochmal.' });
        const r = db.login(body.login, body.password);
        if (!r) return send(401, { error: 'Benutzername oder Passwort falsch.' });
        return send(200, { token: r.token, ...publicProfile(db.account(r.id)) });
      }
      case 'GET /api/me': {
        const acc = auth();
        if (!acc) return send(401, { error: 'Nicht angemeldet.' });
        return send(200, { ...publicProfile(acc), history: db.history(acc, 10) });
      }
      case 'POST /api/register': {
        const acc = auth();
        if (!acc) return send(401, { error: 'Nicht angemeldet.' });
        const r = db.register(acc, String(body.login || '').trim(), body.password);
        if (r.error) return send(400, { error: r.error });
        return send(200, publicProfile(db.account(acc.id)));
      }
      case 'POST /api/logout': db.logout(token); return send(200, { ok: true });
      case 'POST /api/action': {
        const acc = auth();
        if (!acc) return send(401, { error: 'Nicht angemeldet.' });
        let result;
        if (body.type === 'offline') {
          // Ergebnis eines Bot-Matches im Browser
          const now = Date.now();
          if (now - acc.lastOffline < OFFLINE_MIN_GAP) return send(429, { error: 'Match zu kurz für eine Belohnung.' });
          const r = body.result, me = r?.players?.find((x) => x.id === body.you);
          if (!me || !MODES[r.mode] || !acc.profile.unlocked.includes(me.brawler)) return send(400, { error: 'Ungültiges Ergebnis.' });
          result = applyMatch(acc.profile, r, body.you);
          if (!result) return send(400, { error: 'Ungültiges Ergebnis.' });
          db.setOffline(acc, now);
          db.recordMatch(acc, r.mode, me.brawler, result, me.kills, false);
        } else {
          result = runAction(acc.profile, body);
          if (!result) return send(400, { error: 'Aktion nicht möglich.' });
        }
        db.save(acc);
        return send(200, { result, ...publicProfile(acc) });
      }
    }
    return send(404, { error: 'Unbekannt.' });
  }

  // ---------- HTTP ----------
  const server = http.createServer((req, res) => {
    let url = (req.url || '/').split('?')[0];
    try { url = decodeURIComponent(url); } catch { res.writeHead(400); res.end(); return; }
    if (url.startsWith('/api/')) {
      api(req, res, url).catch((e) => { console.error(e); if (!res.headersSent) { res.writeHead(500); res.end('{"error":"Serverfehler"}'); } });
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

  // ---------- Räume ----------
  function makeCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c;
    do { c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while ([...rooms.values()].some((r) => r.code === c));
    return c;
  }

  class Room {
    constructor(mode, code = null) {
      this.id = roomSeq++; this.mode = mode; this.code = code;
      this.clients = new Set(); this.state = 'lobby'; this.created = Date.now();
      this.startAt = code ? null : Date.now() + QUEUE_WAIT * 1000;
      this.game = null; this.loop = null; this.tick = 0; this.pending = [];
      rooms.set(this.id, this);
    }
    get full() { return this.clients.size >= MODES[this.mode].size; }
    add(c) { this.clients.add(c); c.room = this; if (this.full) this.start(); else this.broadcastLobby(); }
    remove(c) {
      this.clients.delete(c); c.room = null;
      if (this.state === 'play' && this.game && c.pid) this.game.removePlayer(c.pid);
      if (this.clients.size === 0) this.close(); else if (this.state === 'lobby') this.broadcastLobby();
    }
    broadcastLobby() {
      const msg = {
        t: 'lobby', mode: this.mode, code: this.code, max: MODES[this.mode].size,
        players: [...this.clients].map((c) => ({ name: c.info.name, brawler: c.info.brawler })),
        startsIn: this.startAt ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : null,
      };
      for (const c of this.clients) sendWs(c, msg);
    }
    start() {
      if (this.state !== 'lobby') return;
      this.state = 'play';
      const g = new Game(this.mode);
      this.game = g;
      let i = 0, lvlSum = 0;
      for (const c of this.clients) {
        const p = g.addPlayer({ name: c.info.name, brawler: c.info.brawler, level: c.info.level, skin: c.info.skin, team: this.mode === 'ffa' ? i : i % 2 });
        c.pid = p.id; lvlSum += p.level; i++;
      }
      g.fillBots(lvlSum / Math.max(1, this.clients.size));
      const roster = g.roster();
      for (const c of this.clients) sendWs(c, { t: 'start', mode: this.mode, you: c.pid, roster, destroyed: g.destroyed });
      this.loop = setInterval(() => this.update(), TICK * 1000);
    }
    update() {
      const g = this.game;
      g.step(TICK);
      this.tick++;
      this.pending.push(...g.drainEvents());
      if (this.tick % 2 === 0 || g.over) {
        const ev = this.pending; this.pending = [];
        for (const c of this.clients) { const s = g.snapshotFor(c.pid); s.ev = ev; sendWs(c, { t: 's', s }); }
      }
      if (g.over) {
        clearInterval(this.loop); this.loop = null; this.state = 'end';
        for (const c of this.clients) {
          const msg = { t: 'end', result: g.result, you: c.pid };
          // Belohnung direkt in der Datenbank gutschreiben
          const acc = c.accId ? db.account(c.accId) : null;
          if (acc) {
            const reward = applyMatch(acc.profile, g.result, c.pid);
            if (reward) {
              const me = g.result.players.find((p) => p.id === c.pid);
              db.save(acc);
              db.recordMatch(acc, this.mode, me.brawler, reward, me.kills, true);
              Object.assign(msg, { reward, ...publicProfile(acc) });
            }
          }
          sendWs(c, msg);
        }
        setTimeout(() => { for (const c of [...this.clients]) { this.clients.delete(c); c.room = null; } this.close(); }, 1500);
      }
    }
    close() { if (this.loop) clearInterval(this.loop); this.loop = null; rooms.delete(this.id); }
  }

  const lobbyTimer = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) {
      if (r.state !== 'lobby') continue;
      if (r.startAt && now >= r.startAt) r.start(); else r.broadcastLobby();
      if (r.code && now - r.created > 30 * 60 * 1000) r.close();
    }
  }, 1000);

  function sendWs(c, msg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }

  // Spielerdaten: mit Konto aus der Datenbank (nicht fälschbar), sonst aus der Anfrage
  function playerInfo(m) {
    const acc = db.byToken(m.token);
    if (acc) {
      const p = acc.profile, k = p.selected;
      return { accId: acc.id, info: { name: p.name, brawler: k, level: p.levels[k], skin: p.skinSel[k] || 0 } };
    }
    return {
      accId: null,
      info: {
        name: String(m.name || 'Spieler').replace(/[<>]/g, '').trim().slice(0, 14) || 'Spieler',
        brawler: BRAWLERS[m.brawler] ? m.brawler : 'funke', level: 1, skin: 0,
      },
    };
  }

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server, maxPayload: 4096 });
  wss.on('connection', (ws) => {
    const c = { ws, room: null, pid: 0, accId: null, info: null };
    sendWs(c, { t: 'hello', online: wss.clients.size });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      const r = c.room;
      switch (m.t) {
        case 'join': {
          if (r) r.remove(c);
          Object.assign(c, playerInfo(m));
          const mode = MODES[m.mode] ? m.mode : 'teamko';
          let room;
          if (m.create) room = new Room(mode, makeCode());
          else if (m.code) {
            room = [...rooms.values()].find((x) => x.code === String(m.code).toUpperCase() && x.state === 'lobby');
            if (!room) { sendWs(c, { t: 'error', msg: 'Raum nicht gefunden oder Spiel läuft schon.' }); return; }
          } else room = [...rooms.values()].find((x) => !x.code && x.mode === mode && x.state === 'lobby' && !x.full) || new Room(mode);
          room.add(c);
          break;
        }
        case 'startnow': if (r && r.state === 'lobby') r.start(); break;
        case 'leave': if (r) r.remove(c); break;
        case 'in':
          if (r && r.game && c.pid) {
            r.game.setInput(c.pid, +m.mx || 0, +m.my || 0);
            if (Number.isFinite(m.x)) r.game.setClientPos(c.pid, +m.x, +m.y);
          }
          break;
        case 'act': if (r && r.game && c.pid) r.game.queueAction(c.pid, m.k === 'sup' ? 'sup' : 'atk', +m.ax, +m.ay, +m.d, +m.x, +m.y); break;
        case 'ping': sendWs(c, { t: 'pong', id: m.id }); break;
      }
    });
    ws.on('close', () => { if (c.room) c.room.remove(c); });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      if (!quiet) console.log(`Datenbank: ${dbPath}`);
      resolve({
        server, db, port: addr.port,
        close: () => new Promise((ok) => {
          clearInterval(lobbyTimer);
          for (const r of rooms.values()) r.close();
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
