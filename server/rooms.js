// Spielräume, Matchmaking, Spielschleife – und Freunde (Online-Status, Anfragen, Einladungen).
// Läuft unter Node (ws) und in einem Cloudflare Durable Object – Verbindungen brauchen nur send(text).
import { Game, MODES } from '../public/shared/game.js';
import { applyMatch } from '../public/shared/progress.js';
import { publicProfile, limited } from './api.js';
import { isAdminName, adminEnabled, checkCode, summary, applyAdminEdit } from './admin.js';

const TICK = 1 / 30;
const QUEUE_WAIT = 12; // Sekunden bis Bots auffüllen

export class Arena {
  constructor(db) {
    this.db = db;
    this.rooms = new Map();
    this.online = new Map(); // Konto-ID -> Set von Menü-Verbindungen (für Freunde)
    this.conns = new Set();  // alle Verbindungen (für Admin-Nachrichten)
    this.adminFails = new Map();
    this.seq = 1;
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000);
  }

  // Neue Verbindung: sendFn(text) schickt eine Nachricht an den Client
  connect(sendFn) {
    const c = { sendFn, room: null, pid: 0, accId: null, info: null, presence: false, chain: Promise.resolve() };
    this.conns.add(c);
    this.send(c, { t: 'hello' });
    return c;
  }

  send(c, msg) { try { c.sendFn(JSON.stringify(msg)); } catch { /* Verbindung zu */ } }
  sendTo(accId, msg) { for (const c of this.online.get(accId) || []) this.send(c, msg); }

  // Nachrichten pro Client nacheinander abarbeiten (Datenbank-Zugriffe sind asynchron)
  message(c, raw) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    c.chain = c.chain.then(() => this.handle(c, m)).catch((e) => console.error('Nachricht', e));
  }

  close(c) {
    c.closed = true;
    this.conns.delete(c);
    c.chain = c.chain.then(async () => {
      if (c.room) c.room.remove(c);
      if (c.presence && c.accId) {
        const set = this.online.get(c.accId);
        if (set) { set.delete(c); if (!set.size) { this.online.delete(c.accId); await this.notifyFriends(c.accId); } }
      }
    }).catch(() => {});
  }

  status(accId) {
    for (const r of this.rooms.values()) for (const c of r.clients) if (c.accId === accId) return r.state === 'lobby' ? 'lobby' : 'ingame';
    return this.online.has(accId) ? 'online' : 'offline';
  }

  async friendList(accId) {
    const list = await this.db.friends(accId);
    for (const f of list) f.online = f.status === 'friend' ? this.status(f.id) : 'offline';
    return list;
  }
  async pushFriends(accId) { if (this.online.has(accId)) this.sendTo(accId, { t: 'friends', list: await this.friendList(accId) }); }
  async notifyFriends(accId) {
    for (const f of await this.db.friends(accId)) if (f.status === 'friend') await this.pushFriends(f.id);
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
      // ----- Anmeldung der Menü-Verbindung (Freunde, Einladungen) -----
      case 'auth': {
        const acc = await this.db.byToken(m.token);
        if (!acc || !acc.registered || c.closed) { this.send(c, { t: 'authfail' }); return; }
        c.accId = acc.id; c.name = acc.profile.name; c.login = acc.login; c.presence = true;
        const first = !this.online.has(acc.id);
        if (first) this.online.set(acc.id, new Set());
        this.online.get(acc.id).add(c);
        this.send(c, { t: 'friends', list: await this.friendList(acc.id) });
        if (first) await this.notifyFriends(acc.id);
        break;
      }
      case 'friends': if (c.presence) this.send(c, { t: 'friends', list: await this.friendList(c.accId) }); break;
      case 'friendAdd': {
        if (!c.presence) return;
        if (limited('friend:' + c.accId, 30, 10 * 60000)) { this.send(c, { t: 'friendMsg', error: 'Zu viele Anfragen – kurz warten.' }); return; }
        const res = await this.db.friendRequest(c.accId, String(m.login || ''));
        if (res.error) { this.send(c, { t: 'friendMsg', error: res.error }); return; }
        this.send(c, { t: 'friendMsg', ok: res.accepted ? 'Ihr seid jetzt Freunde!' : 'Anfrage gesendet!' });
        await this.pushFriends(c.accId);
        await this.pushFriends(res.other);
        if (!res.accepted) this.sendTo(res.other, { t: 'friendRequest', from: { id: c.accId, name: c.name } });
        break;
      }
      case 'friendAnswer': {
        if (!c.presence) return;
        const res = await this.db.friendRespond(c.accId, m.id | 0, !!m.accept);
        if (res.error) { this.send(c, { t: 'friendMsg', error: res.error }); return; }
        await this.pushFriends(c.accId);
        await this.pushFriends(m.id | 0);
        break;
      }
      case 'friendRemove': {
        if (!c.presence) return;
        await this.db.friendRemove(c.accId, m.id | 0);
        await this.pushFriends(c.accId);
        await this.pushFriends(m.id | 0);
        break;
      }
      case 'invite': {
        if (!c.presence) return;
        const to = m.to | 0;
        const room = [...this.rooms.values()].find((x) => x.code === String(m.code || '').toUpperCase() && x.state === 'lobby');
        if (!room) { this.send(c, { t: 'friendMsg', error: 'Der Raum existiert nicht mehr.' }); return; }
        if (!(await this.db.areFriends(c.accId, to))) { this.send(c, { t: 'friendMsg', error: 'Ihr seid keine Freunde.' }); return; }
        if (!this.online.has(to)) { this.send(c, { t: 'friendMsg', error: 'Dein Freund ist gerade nicht online.' }); return; }
        if (limited('invite:' + c.accId, 40, 10 * 60000)) return;
        this.sendTo(to, { t: 'invited', from: { id: c.accId, name: c.name }, code: room.code, mode: room.mode });
        this.send(c, { t: 'friendMsg', ok: 'Einladung gesendet!' });
        break;
      }

      // ----- Admin -----
      case 'admin': {
        const res = await this.admin(c, m);
        this.send(c, { t: 'adminRes', req: m.req, ...res });
        break;
      }

      // ----- Spielen -----
      case 'join': {
        if (r) r.remove(c);
        const acc = m.token ? await this.db.byToken(m.token) : null;
        if (c.closed) return;
        if (!acc || !acc.registered) { this.send(c, { t: 'error', msg: 'Bitte melde dich an, um online zu spielen.' }); return; }
        const p = acc.profile, k = p.selected;
        c.accId = acc.id;
        c.info = { name: p.name, brawler: k, level: p.levels[k], skin: p.skinSel[k] || 0 };
        const mode = MODES[m.mode] ? m.mode : 'teamko';
        let room;
        if (m.create) room = new Room(this, mode, this.makeCode());
        else if (m.code) {
          room = [...this.rooms.values()].find((x) => x.code === String(m.code).toUpperCase() && x.state === 'lobby');
          if (!room) { this.send(c, { t: 'error', msg: 'Raum nicht gefunden oder Spiel läuft schon.' }); return; }
          if (room.full) { this.send(c, { t: 'error', msg: 'Der Raum ist voll.' }); return; }
        } else room = [...this.rooms.values()].find((x) => !x.code && x.mode === mode && x.state === 'lobby' && !x.full) || new Room(this, mode);
        room.add(c);
        break;
      }
      case 'teams': if (r && r.code && r.state === 'lobby') { r.together = !!m.together; r.broadcastLobby(); } break;
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

  async admin(c, m) {
    if (!c.presence || !isAdminName(c.login)) return { error: 'Kein Admin-Konto.' };
    if (!adminEnabled()) return { error: 'Auf dem Server ist noch kein Admin-Code eingerichtet.' };
    const f = this.adminFails.get(c.accId) || { n: 0, t: 0 };
    if (f.n >= 5 && Date.now() - f.t < 10 * 60000) return { error: 'Zu viele falsche Versuche – warte 10 Minuten.' };
    if (!checkCode(m.code)) { this.adminFails.set(c.accId, { n: f.n + 1, t: Date.now() }); return { error: 'Falscher Admin-Code.', badCode: true }; }
    this.adminFails.delete(c.accId);
    const db = this.db;
    switch (m.action) {
      case 'check': {
        let playing = 0;
        for (const r of this.rooms.values()) if (r.state === 'play') playing += r.clients.size;
        return { ok: true, stats: { accounts: await db.accountCount(), online: this.online.size, rooms: this.rooms.size, playing } };
      }
      case 'announce': {
        const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 200);
        if (!text) return { error: 'Nachricht ist leer.' };
        for (const x of this.conns) this.send(x, { t: 'announce', text, from: c.name });
        return { ok: 'Nachricht an alle gesendet.' };
      }
    }
    const acc = await db.byLogin(String(m.login || ''));
    if (!acc) return { error: 'Spieler nicht gefunden.' };
    if (m.action === 'find') return { ok: true, player: summary(acc) };
    if (m.action === 'ban') {
      if (isAdminName(acc.login)) return { error: 'Admins kann man nicht sperren.' };
      await db.setBan(acc.id, !!m.on);
      acc.banned = !!m.on;
      if (m.on) {
        // sofort rauswerfen
        for (const x of [...this.conns]) if (x.accId === acc.id) { this.send(x, { t: 'kicked', msg: 'Dein Konto wurde gesperrt.' }); if (x.room) x.room.remove(x); }
      }
      return { ok: m.on ? 'Spieler gesperrt.' : 'Sperre aufgehoben.', player: summary(acc) };
    }
    const err = applyAdminEdit(acc.profile, m);
    if (err) return { error: err };
    await db.save(acc);
    this.sendTo(acc.id, { t: 'profileUpdate' });
    return { ok: 'Gespeichert.', player: summary(acc) };
  }

  lobbyTick() {
    const now = Date.now();
    for (const r of this.rooms.values()) {
      if (r.state !== 'lobby') continue;
      if (r.startAt && now >= r.startAt) r.start(); else r.broadcastLobby();
      if (r.code && now - r.created > 30 * 60 * 1000) r.close();
    }
  }

  stats() { return { rooms: this.rooms.size, online: this.online.size }; }

  shutdown() {
    clearInterval(this.lobbyTimer);
    for (const r of this.rooms.values()) r.close();
  }
}

class Room {
  constructor(arena, mode, code = null) {
    this.arena = arena;
    this.id = arena.seq++; this.mode = mode; this.code = code;
    this.together = !!code; // private Räume: Freunde im selben Team
    this.clients = new Set(); this.state = 'lobby'; this.created = Date.now();
    this.startAt = code ? null : Date.now() + QUEUE_WAIT * 1000;
    this.game = null; this.loop = null; this.tick = 0; this.pending = [];
    arena.rooms.set(this.id, this);
  }
  get full() { return this.clients.size >= MODES[this.mode].size; }
  send(c, msg) { this.arena.send(c, msg); }

  add(c) {
    this.clients.add(c); c.room = this;
    if (this.full) this.start(); else this.broadcastLobby();
    this.arena.notifyFriends(c.accId).catch(() => {});
  }

  remove(c) {
    this.clients.delete(c); c.room = null;
    if (this.state === 'play' && this.game && c.pid) this.game.removePlayer(c.pid);
    if (this.clients.size === 0) this.close(); else if (this.state === 'lobby') this.broadcastLobby();
    if (c.accId) this.arena.notifyFriends(c.accId).catch(() => {});
  }

  broadcastLobby() {
    const msg = {
      t: 'lobby', mode: this.mode, code: this.code, max: MODES[this.mode].size, together: this.together,
      players: [...this.clients].map((c) => ({ name: c.info.name, brawler: c.info.brawler })),
      startsIn: this.startAt ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : null,
    };
    for (const c of this.clients) this.send(c, msg);
  }

  teamFor(i) {
    if (this.mode === 'ffa') return i;
    if (this.together) return i < 3 ? 0 : 1; // erst ein Team mit Freunden füllen
    return i % 2;
  }

  start() {
    if (this.state !== 'lobby') return;
    this.state = 'play';
    const g = new Game(this.mode);
    this.game = g;
    let i = 0, lvlSum = 0;
    for (const c of this.clients) {
      const p = g.addPlayer({ name: c.info.name, brawler: c.info.brawler, level: c.info.level, skin: c.info.skin, team: this.teamFor(i) });
      c.pid = p.id; lvlSum += p.level; i++;
    }
    g.fillBots(lvlSum / Math.max(1, this.clients.size));
    const roster = g.roster();
    for (const c of this.clients) this.send(c, { t: 'start', mode: this.mode, you: c.pid, roster, destroyed: g.destroyed });
    this.loop = setInterval(() => this.update(), TICK * 1000);
    for (const c of this.clients) if (c.accId) this.arena.notifyFriends(c.accId).catch(() => {});
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
    setTimeout(() => {
      const ids = [...this.clients].map((c) => c.accId).filter(Boolean);
      for (const c of [...this.clients]) { this.clients.delete(c); c.room = null; }
      this.close();
      for (const id of ids) this.arena.notifyFriends(id).catch(() => {});
    }, 1500);
  }

  close() { if (this.loop) clearInterval(this.loop); this.loop = null; this.arena.rooms.delete(this.id); }
}
