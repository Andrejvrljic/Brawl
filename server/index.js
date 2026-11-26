// Kistenkrawall – Multiplayer-Server
// Liefert den Client aus (public/) und betreibt die Spielräume über WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, MODES } from '../public/shared/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const TICK = 1 / 30;
const QUEUE_WAIT = 12; // Sekunden bis Bots auffüllen
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

// ---------- Statische Dateien ----------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- Räume ----------
const rooms = new Map();
let roomSeq = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while ([...rooms.values()].some((r) => r.code === c));
  return c;
}

class Room {
  constructor(mode, code = null) {
    this.id = roomSeq++;
    this.mode = mode;
    this.code = code;
    this.clients = new Set();
    this.state = 'lobby';
    this.created = Date.now();
    this.startAt = code ? null : Date.now() + QUEUE_WAIT * 1000;
    this.game = null;
    this.loop = null;
    this.tick = 0;
    rooms.set(this.id, this);
  }
  get full() { return this.clients.size >= MODES[this.mode].size; }

  add(c) {
    this.clients.add(c);
    c.room = this;
    if (this.full) this.start();
    else this.broadcastLobby();
  }

  remove(c) {
    this.clients.delete(c);
    c.room = null;
    if (this.state === 'play' && this.game && c.pid) this.game.removePlayer(c.pid);
    if (this.clients.size === 0) this.close();
    else if (this.state === 'lobby') this.broadcastLobby();
  }

  broadcastLobby() {
    const msg = {
      t: 'lobby', mode: this.mode, code: this.code, max: MODES[this.mode].size,
      players: [...this.clients].map((c) => ({ name: c.info.name, brawler: c.info.brawler })),
      startsIn: this.startAt ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : null,
    };
    for (const c of this.clients) send(c, msg);
  }

  start() {
    if (this.state !== 'lobby') return;
    this.state = 'play';
    const g = new Game(this.mode);
    this.game = g;
    let i = 0, lvlSum = 0;
    for (const c of this.clients) {
      const team = this.mode === 'ffa' ? i : i % 2;
      const p = g.addPlayer({ name: c.info.name, brawler: c.info.brawler, level: c.info.level, skin: c.info.skin, team });
      c.pid = p.id; lvlSum += p.level; i++;
    }
    g.fillBots(lvlSum / Math.max(1, this.clients.size));
    const roster = g.roster();
    for (const c of this.clients) send(c, { t: 'start', mode: this.mode, you: c.pid, roster, destroyed: g.destroyed });
    this.loop = setInterval(() => this.update(), TICK * 1000);
  }

  update() {
    const g = this.game;
    g.step(TICK);
    this.tick++;
    const events = g.drainEvents();
    this.pending = (this.pending || []).concat(events);
    if (this.tick % 2 === 0 || g.over) {
      const ev = this.pending; this.pending = [];
      for (const c of this.clients) {
        const s = g.snapshotFor(c.pid);
        s.ev = ev;
        send(c, { t: 's', s });
      }
    }
    if (g.over) {
      clearInterval(this.loop); this.loop = null;
      this.state = 'end';
      for (const c of this.clients) send(c, { t: 'end', result: g.result, you: c.pid });
      setTimeout(() => {
        for (const c of [...this.clients]) { this.clients.delete(c); c.room = null; }
        this.close();
      }, 1500);
    }
  }

  close() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    rooms.delete(this.id);
  }
}

// Lobby-Countdown überwachen
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.state !== 'lobby') continue;
    if (r.startAt && now >= r.startAt) r.start();
    else r.broadcastLobby();
    if (r.code && now - r.created > 30 * 60 * 1000) r.close();
  }
}, 1000);

function send(c, msg) {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
}

function cleanInfo(m) {
  return {
    name: String(m.name || 'Spieler').replace(/[<>]/g, '').trim().slice(0, 14) || 'Spieler',
    brawler: String(m.brawler || 'funke'),
    level: Math.max(1, Math.min(7, m.level | 0)),
    skin: Math.max(0, Math.min(2, m.skin | 0)),
  };
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const c = { ws, room: null, pid: 0, info: cleanInfo({}) };
  send(c, { t: 'hello', online: wss.clients.size });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const r = c.room;
    switch (m.t) {
      case 'join': {
        if (r) r.remove(c);
        c.info = cleanInfo(m);
        const mode = MODES[m.mode] ? m.mode : 'teamko';
        let room;
        if (m.create) room = new Room(mode, makeCode());
        else if (m.code) {
          room = [...rooms.values()].find((x) => x.code === String(m.code).toUpperCase() && x.state === 'lobby');
          if (!room) { send(c, { t: 'error', msg: 'Raum nicht gefunden oder Spiel läuft schon.' }); return; }
        } else {
          room = [...rooms.values()].find((x) => !x.code && x.mode === mode && x.state === 'lobby' && !x.full) || new Room(mode);
        }
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
      case 'act':
        if (r && r.game && c.pid) r.game.queueAction(c.pid, m.k === 'sup' ? 'sup' : 'atk', +m.ax, +m.ay, +m.d, +m.x, +m.y);
        break;
      case 'ping': send(c, { t: 'pong', id: m.id }); break;
    }
  });
  ws.on('close', () => { if (c.room) c.room.remove(c); });
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  Kistenkrawall läuft!`);
  console.log(`  Lokal:     http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Im WLAN:   http://${ip}:${PORT}`);
  console.log('');
});
