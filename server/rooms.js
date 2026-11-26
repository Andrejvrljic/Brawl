// Spielräume, Matchmaking und Spielschleife.
// Läuft unter Node (ws) und in einem Cloudflare Durable Object – Verbindungen brauchen nur send(text).
import { Game, MODES } from '../public/shared/game.js';
import { BRAWLERS } from '../public/shared/brawlers.js';
import { applyMatch } from '../public/shared/progress.js';
import { publicProfile } from './api.js';

const TICK = 1 / 30;
const QUEUE_WAIT = 12; // Sekunden bis Bots auffüllen

export class Arena {
  constructor(db) {
    this.db = db;
    this.rooms = new Map();
    this.seq = 1;
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000);
  }

  // Neue Verbindung: sendFn(text) schickt eine Nachricht an den Client
  connect(sendFn) {
    const c = { sendFn, room: null, pid: 0, accId: null, info: null, chain: Promise.resolve() };
    this.send(c, { t: 'hello' });
    return c;
  }

  send(c, msg) { try { c.sendFn(JSON.stringify(msg)); } catch { /* Verbindung zu */ } }

  // Nachrichten pro Client nacheinander abarbeiten (join wartet auf die Datenbank)
  message(c, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    c.chain = c.chain.then(() => this.handle(c, m)).catch((e) => console.error('Nachricht', e));
  }

  close(c) { c.closed = true; c.chain = c.chain.then(() => { if (c.room) c.room.remove(c); }); }

  async playerInfo(m) {
    const acc = m.token ? await this.db.byToken(m.token) : null;
    if (acc) {
      const p = acc.profile, k = p.selected;
      return { accId: acc.id, info: { name: p.name, brawler: k, level: p.levels[k], skin: p.skinSel[k] || 0 } };
    }
    return {
      accId: null,
      info: { name: String(m.name || 'Spieler').replace(/[<>]/g, '').trim().slice(0, 14) || 'Spieler', brawler: BRAWLERS[m.brawler] ? m.brawler : 'funke', level: 1, skin: 0 },
    };
  }

  makeCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c;
    do { c = Array.from({ length: 4 }, () => A[(Math.random() * A.length) | 0]).join(''); } while ([...this.rooms.values()].some((r) => r.code === c));
    return c;
  }

  async handle(c, m) {
    const r = c.room;
    switch (m.t) {
      case 'join': {
        if (r) r.remove(c);
        Object.assign(c, await this.playerInfo(m));
        if (c.closed) return;
        const mode = MODES[m.mode] ? m.mode : 'teamko';
        let room;
        if (m.create) room = new Room(this, mode, this.makeCode());
        else if (m.code) {
          room = [...this.rooms.values()].find((x) => x.code === String(m.code).toUpperCase() && x.state === 'lobby');
          if (!room) { this.send(c, { t: 'error', msg: 'Raum nicht gefunden oder Spiel läuft schon.' }); return; }
        } else room = [...this.rooms.values()].find((x) => !x.code && x.mode === mode && x.state === 'lobby' && !x.full) || new Room(this, mode);
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
      case 'ping': this.send(c, { t: 'pong', id: m.id }); break;
    }
  }

  lobbyTick() {
    const now = Date.now();
    for (const r of this.rooms.values()) {
      if (r.state !== 'lobby') continue;
      if (r.startAt && now >= r.startAt) r.start(); else r.broadcastLobby();
      if (r.code && now - r.created > 30 * 60 * 1000) r.close();
    }
  }

  stats() { return { rooms: this.rooms.size }; }

  shutdown() {
    clearInterval(this.lobbyTimer);
    for (const r of this.rooms.values()) r.close();
  }
}

class Room {
  constructor(arena, mode, code = null) {
    this.arena = arena;
    this.id = arena.seq++; this.mode = mode; this.code = code;
    this.clients = new Set(); this.state = 'lobby'; this.created = Date.now();
    this.startAt = code ? null : Date.now() + QUEUE_WAIT * 1000;
    this.game = null; this.loop = null; this.tick = 0; this.pending = [];
    arena.rooms.set(this.id, this);
  }
  get full() { return this.clients.size >= MODES[this.mode].size; }
  send(c, msg) { this.arena.send(c, msg); }

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
    for (const c of this.clients) this.send(c, msg);
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
    for (const c of this.clients) this.send(c, { t: 'start', mode: this.mode, you: c.pid, roster, destroyed: g.destroyed });
    this.loop = setInterval(() => this.update(), TICK * 1000);
  }

  update() {
    const g = this.game;
    g.step(TICK);
    this.tick++;
    this.pending.push(...g.drainEvents());
    if (this.tick % 2 === 0 || g.over) {
      const ev = this.pending; this.pending = [];
      for (const c of this.clients) { const s = g.snapshotFor(c.pid); s.ev = ev; this.send(c, { t: 's', s }); }
    }
    if (g.over) {
      clearInterval(this.loop); this.loop = null; this.state = 'end';
      this.finish().catch((e) => console.error('Belohnung', e));
    }
  }

  // Belohnung direkt in der Datenbank gutschreiben, dann Ergebnis senden
  async finish() {
    const g = this.game, db = this.arena.db;
    for (const c of [...this.clients]) {
      const msg = { t: 'end', result: g.result, you: c.pid };
      try {
        const acc = c.accId ? await db.account(c.accId) : null;
        if (acc) {
          const reward = applyMatch(acc.profile, g.result, c.pid);
          if (reward) {
            const me = g.result.players.find((p) => p.id === c.pid);
            await db.save(acc);
            await db.recordMatch(acc, this.mode, me.brawler, reward, me.kills, true);
            Object.assign(msg, { reward, ...(await publicProfile(db, acc)) });
          }
        }
      } catch (e) { console.error('Datenbank', e); }
      this.send(c, msg);
    }
    setTimeout(() => { for (const c of [...this.clients]) { this.clients.delete(c); c.room = null; } this.close(); }, 1500);
  }

  close() { if (this.loop) clearInterval(this.loop); this.loop = null; this.arena.rooms.delete(this.id); }
}
