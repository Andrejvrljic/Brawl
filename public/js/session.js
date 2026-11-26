// Spielsitzungen: Offline (Simulation im Browser) und Online (WebSocket-Server)
import { Game, PR } from '../shared/game.js';
import { GameMap } from '../shared/map.js';
import { BRAWLERS } from '../shared/brawlers.js';

const STEP = 1 / 60;

// ---------- Offline gegen Bots ----------
export class LocalSession {
  constructor({ mode, name, brawler, level, skin }) {
    this.game = new Game(mode);
    const me = this.game.addPlayer({ name, brawler, level, skin, team: 0 });
    this.you = me.id;
    this.game.fillBots(level);
    this.mode = mode;
    this.map = this.game.map;
    this.roster = this.game.roster();
    this.acc = 0;
    this.result = null;
  }
  start(handlers) { this.h = handlers; this.h.onStart(this); }
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    const events = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.game.step(STEP);
      events.push(...this.game.drainEvents());
    }
    const s = this.game.snapshotFor(this.you);
    s.ev = events;
    if (this.game.over && !this.result) {
      this.result = this.game.result;
      setTimeout(() => this.h.onEnd(this.result, this.you), 1200);
    }
    return s;
  }
  move(mx, my) { this.game.setInput(this.you, mx, my); }
  act(kind, ax, ay, dist) { this.game.queueAction(this.you, kind, ax, ay, dist); }
  leave() { }
  get me() { return this.game.byId.get(this.you); }
}

// ---------- Online ----------
export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.replace(/^http/, 'ws');
  if (location.protocol === 'file:') return null;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}

export class NetSession {
  constructor(info) {
    this.info = info;
    this.snaps = [];
    this.pendingEv = [];
    this.result = null;
    this.pred = null;
    this.lastWarp = -1;
    this.sendT = 0;
    this.offset = null;
  }

  connect(handlers) {
    this.h = handlers;
    const url = serverUrl();
    if (!url) { handlers.onError('Kein Server erreichbar – starte den Server mit „npm start“.'); return; }
    let ws;
    try { ws = new WebSocket(url); } catch { handlers.onError('Verbindung fehlgeschlagen.'); return; }
    this.ws = ws;
    const timer = setTimeout(() => { if (ws.readyState !== 1) { ws.close(); handlers.onError('Server antwortet nicht.'); } }, 6000);
    ws.onopen = () => {
      clearTimeout(timer);
      this.send({ t: 'join', ...this.info });
    };
    ws.onerror = () => { clearTimeout(timer); };
    ws.onclose = () => { clearTimeout(timer); if (!this.closed && !this.result) handlers.onError('Verbindung zum Server verloren.'); };
    ws.onmessage = (msg) => {
      let m; try { m = JSON.parse(msg.data); } catch { return; }
      this.onMsg(m);
    };
  }

  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  onMsg(m) {
    switch (m.t) {
      case 'lobby': this.h.onLobby(m); break;
      case 'error': this.h.onError(m.msg); this.leave(); break;
      case 'start': {
        this.you = m.you;
        this.mode = m.mode;
        this.roster = m.roster;
        this.map = new GameMap();
        for (const [x, y] of m.destroyed || []) this.map.set(x, y, '.');
        const me = m.roster.find((p) => p.id === m.you);
        this.def = BRAWLERS[me.brawler];
        this.h.onStart(this);
        break;
      }
      case 's': {
        const s = m.s;
        const now = performance.now() / 1000;
        if (this.offset === null) this.offset = s.t - now;
        else this.offset += (s.t - now - this.offset) * 0.05;
        this.snaps.push(s);
        if (this.snaps.length > 30) this.snaps.shift();
        for (const e of s.ev) {
          if (e.e === 'tiles') for (const [x, y] of e.list) this.map.set(x, y, '.');
          this.pendingEv.push(e);
        }
        break;
      }
      case 'end':
        this.result = m.result;
        setTimeout(() => { this.closed = true; this.ws.close(); this.h.onEnd(m.result, m.you, m); }, 1000);
        break;
    }
  }

  startNow() { this.send({ t: 'startnow' }); }

  // Interpolierter Zustand für die Anzeige
  update(dt) {
    if (!this.snaps.length) return null;
    const latest = this.snaps[this.snaps.length - 1];
    const now = performance.now() / 1000;
    const rt = now + this.offset - 0.1;
    let a = this.snaps[0], b = latest;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].t <= rt) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
    const amap = new Map(a.players.map((p) => [p.id, p]));
    const players = b.players.map((pb) => {
      const pa = amap.get(pb.id);
      if (!pa || pa.w !== pb.w || !pa.al) return { ...pb };
      return { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z + (pb.z - pa.z) * k, f: lerpAng(pa.f, pb.f, k) };
    });
    const aproj = new Map(a.proj.map((p) => [p.id, p]));
    const proj = b.proj.map((pb) => {
      const pa = aproj.get(pb.id);
      if (!pa) return pb;
      return { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z !== undefined ? pa.z + (pb.z - pa.z) * k : undefined };
    });

    // Eigene Figur: Vorhersage
    const meS = latest.players.find((p) => p.id === this.you);
    const mi = players.findIndex((p) => p.id === this.you);
    if (meS && mi >= 0) {
      const forced = (meS.st & 32) || (meS.st & 2) || !meS.al || latest.ph !== 'play';
      if (!this.pred || meS.w !== this.lastWarp || forced) {
        this.pred = forced ? { x: players[mi].x, y: players[mi].y } : { x: meS.x, y: meS.y };
        if (!forced) this.lastWarp = meS.w;
        if (forced) this.lastWarp = -1;
      } else {
        const sp = this.def.speed * (meS.st & 1 ? 0.55 : 1);
        if (this.mx || this.my) this.map.moveCircle(this.pred, this.mx * sp * dt, this.my * sp * dt, PR);
        // sanft zum Server ziehen, falls weit weg
        const ex = meS.x - this.pred.x, ey = meS.y - this.pred.y;
        if (Math.hypot(ex, ey) > 1.6) { this.pred.x += ex * 0.1; this.pred.y += ey * 0.1; }
      }
      const me = { ...players[mi], x: this.pred.x, y: this.pred.y, am: meS.am, sc: meS.sc, hp: meS.hp, st: meS.st };
      if (!forced && (this.mx || this.my) && now - (this.lastAtk || 0) > 0.45) me.f = Math.atan2(this.my, this.mx);
      players[mi] = me;
    }
    this.sendT += dt;
    if (this.sendT >= 1 / 30) {
      this.sendT = 0;
      const o = { t: 'in', mx: r3(this.mx || 0), my: r3(this.my || 0) };
      if (this.pred && this.lastWarp !== -1) { o.x = r3(this.pred.x); o.y = r3(this.pred.y); }
      this.send(o);
    }
    const ev = this.pendingEv; this.pendingEv = [];
    return { ...latest, players, proj, ev };
  }

  move(mx, my) { this.mx = mx; this.my = my; }
  act(kind, ax, ay, dist) {
    this.lastAtk = performance.now() / 1000;
    const o = { t: 'act', k: kind, ax: r3(ax), ay: r3(ay), d: r3(dist || 0) };
    if (this.pred) { o.x = r3(this.pred.x); o.y = r3(this.pred.y); }
    this.send(o);
  }
  leave() { this.closed = true; this.send({ t: 'leave' }); if (this.ws) this.ws.close(); }
}

const r3 = (v) => Math.round(v * 1000) / 1000;
function lerpAng(a, b, k) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * k; }
