// Gemeinsame Spielsimulation – läuft auf dem Server (Online) und im Browser (Offline-Training).
import { GameMap } from './map.js';
import { BRAWLERS, BRAWLER_ORDER, levelMult } from './brawlers.js';

export const MODES = {
  teamko: { key: 'teamko', name: 'Team-K.O.', desc: '3 gegen 3 – das erste Team mit 10 K.O.s gewinnt.', teams: 2, size: 6, goal: 10, time: 150 },
  zone: { key: 'zone', name: 'Zonenkontrolle', desc: '3 gegen 3 – haltet die Zone in der Mitte 45 Sekunden lang.', teams: 2, size: 6, goal: 45, time: 150 },
  ffa: { key: 'ffa', name: 'Jeder gegen Jeden', desc: '6 Brawler, keine Freunde – wer zuerst 7 K.O.s holt, gewinnt.', teams: 6, size: 6, goal: 7, time: 150 },
};

export const PR = 0.42; // Spielerradius
export const COUNTDOWN = 3;
const RESPAWN = 3;
const BOT_NAMES = ['Kralle', 'Zappo', 'Mimi', 'Toni', 'Rolfi', 'Knolle', 'Pixel', 'Bärbel', 'Schnitzel', 'Lumpi', 'Gizmo', 'Fritzi', 'Krümel', 'Wumme', 'Socke', 'Brezel'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  constructor(mode = 'teamko') {
    this.mode = MODES[mode] ? mode : 'teamko';
    this.cfg = MODES[this.mode];
    this.map = new GameMap();
    this.time = 0;
    this.players = [];
    this.byId = new Map();
    this.proj = [];
    this.zones = [];
    this.events = [];
    this.nid = 1;
    this.score = new Array(this.cfg.teams).fill(0);
    this.phase = 'countdown';
    this.over = false;
    this.result = null;
    this.destroyed = [];
    this.zoneCtl = { x: this.map.center.x, y: this.map.center.y, r: 2.6, owner: -1 };
    this.teamCount = new Array(this.cfg.teams).fill(0);
    this.fieldCache = new Map();
  }

  get timeLeft() { return Math.max(0, this.cfg.time - Math.max(0, this.time - COUNTDOWN)); }

  // ---------- Spieler ----------
  addPlayer({ id, name, brawler, level = 1, skin = 0, team, bot = false }) {
    if (!BRAWLERS[brawler]) brawler = 'funke';
    const def = BRAWLERS[brawler];
    if (team === undefined) team = this.autoTeam();
    const mult = levelMult(level);
    const p = {
      id: id ?? this.nid++, name: String(name || 'Spieler').slice(0, 14), team, bot, brawler, def,
      skin: clamp(skin | 0, 0, 2), level: clamp(level | 0, 1, 7), mult,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, hp: 0, maxHp: Math.round(def.hp * mult), alive: true,
      ammo: def.ammo, superCharge: 0, facing: team === 1 ? Math.PI / 2 : -Math.PI / 2,
      mx: 0, my: 0, cpos: null, kills: 0, deaths: 0, dmgDealt: 0, healed: 0,
      lastCombat: -99, lastAtk: -99, slowUntil: 0, slowF: 1, stunUntil: 0,
      burnUntil: 0, burnDps: 0, burnSrc: null, burnNext: 0, revealUntil: 0, invulnUntil: 0,
      dash: null, leap: null, knock: null, warp: 0, respawnAt: 0, actions: [], spawnIdx: this.teamCount[team]++,
      ai: bot ? { t: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, stuckT: 0, unstickT: 0, ux: 0, uy: 0, lx: 0, ly: 0, react: 0.25 + Math.random() * 0.3, nextShot: 0, target: null } : null,
    };
    this.players.push(p);
    this.byId.set(p.id, p);
    this.spawn(p, true);
    return p;
  }

  autoTeam() {
    if (this.mode === 'ffa') return this.players.length % 6;
    const a = this.players.filter((p) => p.team === 0).length;
    const b = this.players.filter((p) => p.team === 1).length;
    return a <= b ? 0 : 1;
  }

  fillBots(avgLevel = 1) {
    const used = new Set(this.players.map((p) => p.name));
    while (this.players.length < this.cfg.size) {
      let name;
      do { name = BOT_NAMES[(Math.random() * BOT_NAMES.length) | 0]; } while (used.has(name) && used.size < BOT_NAMES.length);
      used.add(name);
      const brawler = BRAWLER_ORDER[(Math.random() * BRAWLER_ORDER.length) | 0];
      const level = clamp(Math.round(avgLevel + (Math.random() * 2 - 1)), 1, 7);
      this.addPlayer({ name, brawler, level, skin: Math.random() < 0.25 ? 1 + ((Math.random() * 2) | 0) : 0, bot: true });
    }
  }

  removePlayer(id) {
    const p = this.byId.get(id);
    if (p) { p.bot = true; p.cpos = null; p.ai = { t: 0, strafe: 1, strafeT: 0, stuckT: 0, unstickT: 0, ux: 0, uy: 0, lx: p.x, ly: p.y, react: 0.35, nextShot: 0, target: null }; p.name += ' (Bot)'; }
  }

  spawn(p, first = false) {
    let pos;
    if (this.mode === 'ffa') {
      const list = this.map.ffaSpawns;
      if (first) pos = list[p.team % list.length];
      else {
        let best = list[0], bd = -1;
        for (const s of list) {
          let md = 1e9;
          for (const q of this.players) if (q !== p && q.alive) md = Math.min(md, Math.hypot(q.x - s.x, q.y - s.y));
          if (md > bd) { bd = md; best = s; }
        }
        pos = best;
      }
    } else {
      const list = this.map.spawns[p.team];
      pos = list[p.spawnIdx % list.length];
    }
    p.x = pos.x; p.y = pos.y; p.z = 0;
    p.hp = p.maxHp; p.alive = true; p.ammo = p.def.ammo;
    p.dash = p.leap = p.knock = null; p.cpos = null;
    p.slowUntil = p.stunUntil = p.burnUntil = 0;
    p.invulnUntil = this.time + (first ? 0 : 2);
    p.facing = this.mode === 'ffa' ? Math.atan2(this.map.center.y - p.y, this.map.center.x - p.x) : (p.team === 1 ? Math.PI / 2 : -Math.PI / 2);
    p.warp++;
  }

  setInput(id, mx, my) {
    const p = this.byId.get(id);
    if (!p || p.bot) return;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    p.mx = Number.isFinite(mx) ? mx : 0;
    p.my = Number.isFinite(my) ? my : 0;
  }

  // Online: der Client meldet seine vorhergesagte Position
  setClientPos(id, x, y) {
    const p = this.byId.get(id);
    if (!p || p.bot || !Number.isFinite(x) || !Number.isFinite(y)) return;
    p.cpos = { x, y };
  }

  queueAction(id, kind, ax, ay, dist, px, py) {
    const p = this.byId.get(id);
    if (!p) return;
    const l = Math.hypot(ax, ay);
    if (!(l > 1e-6)) return;
    p.actions.push({ kind, ax: ax / l, ay: ay / l, dist: Number.isFinite(dist) ? Math.max(0, dist) : undefined, px, py });
  }

  // ---------- Hauptschleife ----------
  step(dt) {
    if (this.over) return;
    this.time += dt;
    if (this.phase === 'countdown' && this.time >= COUNTDOWN) { this.phase = 'play'; this.events.push({ e: 'go' }); }
    for (const p of this.players) this.updatePlayer(p, dt);
    this.updateProj(dt);
    this.updateZones(dt);
    if (this.phase === 'play') { this.updateMode(dt); this.checkEnd(); }
  }

  isStunned(p) { return p.stunUntil > this.time; }

  updatePlayer(p, dt) {
    const t = this.time;
    if (!p.alive) {
      if (t >= p.respawnAt && !this.over) { this.spawn(p); this.events.push({ e: 'spawn', id: p.id }); }
      return;
    }
    const ox = p.x, oy = p.y;
    // Brennen
    if (p.burnUntil > t && t >= p.burnNext) {
      p.burnNext = t + 0.5;
      this.damage(this.byId.get(p.burnSrc) || null, p, p.burnDps * 0.5, { dot: true, sup: true });
      if (!p.alive) return;
    }
    // Regeneration außerhalb des Kampfes
    if (t - p.lastCombat > 3 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.13 * dt);
    if (p.ammo < p.def.ammo) p.ammo = Math.min(p.def.ammo, p.ammo + dt / p.def.reload);

    if (p.bot && this.phase === 'play') this.think(p, dt);

    const speed = p.def.speed * (p.slowUntil > t ? p.slowF : 1);
    if (p.leap) {
      const L = p.leap;
      const k = Math.min(1, (t - L.t0) / L.dur);
      p.x = L.sx + (L.tx - L.sx) * k;
      p.y = L.sy + (L.ty - L.sy) * k;
      p.z = Math.sin(k * Math.PI) * 2.6;
      if (k >= 1) {
        p.z = 0; p.leap = null;
        const f = this.map.findFree(p.x, p.y); p.x = f.x; p.y = f.y;
        this.map.resolve(p, PR);
        this.aoe(p, p.x, p.y, L.o.r, { dmg: L.o.dmg, knock: L.o.knock, destroy: L.o.destroy, k: 'quake', sup: true });
        p.warp++;
      }
    } else if (p.dash) {
      const D = p.dash;
      this.map.moveCircle(p, D.vx * dt, D.vy * dt, PR);
      for (const q of this.players) {
        if (!q.alive || q.team === p.team || D.hits.has(q.id)) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) < PR * 2.2) {
          D.hits.add(q.id);
          const l = Math.hypot(D.vx, D.vy) || 1;
          this.damage(p, q, D.dmg, { sup: true, knock: { x: D.vx / l, y: D.vy / l, d: 1.8 } });
        }
      }
      if (t >= D.until) { p.dash = null; p.warp++; }
    } else if (p.knock) {
      const K = p.knock;
      const k = Math.min(1, dt / K.dur);
      this.map.moveCircle(p, K.x * K.d * k, K.y * K.d * k, PR);
      K.d -= K.d * k; K.dur -= dt;
      if (K.dur <= 0) { p.knock = null; p.warp++; }
    } else if (this.isStunned(p) || this.phase !== 'play') {
      p.cpos = null;
    } else if (p.cpos) {
      const dx = p.cpos.x - p.x, dy = p.cpos.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 2.5) { p.warp++; p.cpos = null; }
      else if (d > 1e-4) {
        const s = Math.min(d, speed * dt * 1.6 + 0.01);
        this.map.moveCircle(p, (dx / d) * s, (dy / d) * s, PR);
      }
    } else if (p.mx || p.my) {
      this.map.moveCircle(p, p.mx * speed * dt, p.my * speed * dt, PR);
    }
    p.vx = (p.x - ox) / dt; p.vy = (p.y - oy) / dt;
    if ((Math.abs(p.vx) > 0.3 || Math.abs(p.vy) > 0.3) && t - p.lastAtk > 0.45 && !p.dash) p.facing = Math.atan2(p.vy, p.vx);

    if (p.actions.length) {
      const acts = p.actions; p.actions = [];
      if (this.phase === 'play') {
        for (const a of acts) {
          // leichte Positionskorrektur, damit Schüsse dort starten, wo der Spieler sie sieht
          if (Number.isFinite(a.px) && !p.leap && !p.dash && !p.knock && Math.hypot(a.px - p.x, a.py - p.y) < 1.2) {
            p.x = a.px; p.y = a.py; this.map.resolve(p, PR);
          }
          if (a.kind === 'sup') this.trySuper(p, a); else this.tryAttack(p, a);
        }
      }
    }
  }

  canAct(p) { return p.alive && !this.isStunned(p) && !p.leap && !p.dash && this.phase === 'play' && !this.over; }

  tryAttack(p, a) {
    if (!this.canAct(p) || p.ammo < 1 || this.time - p.lastAtk < 0.28) return false;
    p.ammo -= 1; p.lastAtk = this.time; p.facing = Math.atan2(a.ay, a.ax);
    p.revealUntil = this.time + 1.2; p.invulnUntil = Math.min(p.invulnUntil, this.time);
    p.def.attack(this, p, a);
    this.events.push({ e: 'atk', id: p.id, k: p.brawler, x: r2(p.x), y: r2(p.y), f: r2(p.facing) });
    return true;
  }

  trySuper(p, a) {
    if (!this.canAct(p) || p.superCharge < 1) return false;
    p.superCharge = 0; p.lastAtk = this.time; p.facing = Math.atan2(a.ay, a.ax);
    p.revealUntil = this.time + 1.5; p.invulnUntil = Math.min(p.invulnUntil, this.time);
    p.def.super(this, p, a);
    this.events.push({ e: 'sup', id: p.id, k: p.brawler, x: r2(p.x), y: r2(p.y) });
    return true;
  }

  // ---------- Angriffs-Bausteine ----------
  bullet(p, ang, o) {
    const c = Math.cos(ang), s = Math.sin(ang);
    this.proj.push({
      id: this.nid++, type: 'bullet', k: o.k, owner: p.id, team: p.team,
      x: p.x + c * 0.35, y: p.y + s * 0.35, vx: c * o.speed, vy: s * o.speed, speed: o.speed,
      range: o.range, trav: 0, dmg: o.dmg * p.mult, rad: o.rad || 0.15, pierce: !!o.pierce, hits: new Set(),
      slow: o.slow, burn: o.burn ? { dps: o.burn.dps * p.mult, dur: o.burn.dur } : null, returns: !!o.returns, phase: 0, sup: !!o.sup, ang,
    });
  }

  lob(p, a, o) {
    const d = clamp(a.dist ?? o.range, 0.5, o.range);
    let tx = p.x + a.ax * d, ty = p.y + a.ay * d;
    tx = clamp(tx, 0.2, this.map.w - 0.2); ty = clamp(ty, 0.2, this.map.h - 0.2);
    this.proj.push({
      id: this.nid++, type: 'lob', k: o.k, owner: p.id, team: p.team, sx: p.x, sy: p.y, tx, ty, x: p.x, y: p.y, z: 0.6,
      t: 0, dur: o.dur, aoe: o.aoe, dmg: o.dmg * p.mult, heal: o.heal ? o.heal * p.mult : 0, destroy: o.destroy || 0, sup: !!o.sup,
    });
  }

  cone(p, ang, half, range, o) {
    for (const q of this.players) {
      if (!q.alive || q.team === p.team) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range + PR) continue;
      let da = Math.atan2(dy, dx) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > half && d > PR * 1.5) continue;
      if (!this.map.lineOfSight(p.x, p.y, q.x, q.y)) continue;
      this.damage(p, q, o.dmg * p.mult, { knock: o.knock ? { x: dx / (d || 1), y: dy / (d || 1), d: o.knock } : null });
    }
    this.events.push({ e: 'cone', id: p.id, x: r2(p.x), y: r2(p.y), a: r2(ang), w: half, r: range, k: o.k });
  }

  aoe(src, x, y, r, o) {
    for (const q of this.players) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d > r + PR * 0.6) continue;
      if (q.team === src.team) {
        if (o.heal && q !== src) this.healP(src, q, o.heal);
        continue;
      }
      this.damage(src, q, o.dmg, {
        sup: o.sup, stun: o.stun, slow: o.slow,
        knock: o.knock ? { x: (q.x - x) / (d || 1), y: (q.y - y) / (d || 1), d: o.knock } : null,
      });
    }
    if (o.destroy) this.destroyWalls(x, y, o.destroy);
    this.events.push({ e: 'boom', x: r2(x), y: r2(y), r, k: o.k || 'boom' });
  }

  zone(p, x, y, r, o) {
    x = clamp(x, 0.3, this.map.w - 0.3); y = clamp(y, 0.3, this.map.h - 0.3);
    this.zones.push({ id: this.nid++, k: o.k, owner: p.id, team: p.team, x, y, r, until: this.time + o.dur, dps: (o.dps || 0) * p.mult, hps: (o.hps || 0) * p.mult, burn: o.burn ? { dps: o.burn.dps * p.mult, dur: o.burn.dur } : null, acc: 0 });
  }

  dash(p, ang, dist, dur, dmg) {
    const sp = dist / dur;
    p.dash = { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, until: this.time + dur, hits: new Set(), dmg: dmg * p.mult };
    p.invulnUntil = this.time + dur + 0.1;
    p.cpos = null; p.warp++;
  }

  leap(p, a, range, o) {
    const d = clamp(a.dist ?? range, 1, range);
    const tx = clamp(p.x + a.ax * d, 0.5, this.map.w - 0.5), ty = clamp(p.y + a.ay * d, 0.5, this.map.h - 0.5);
    p.leap = { sx: p.x, sy: p.y, tx, ty, t0: this.time, dur: 0.65, o: { ...o, dmg: o.dmg * p.mult } };
    p.cpos = null; p.warp++;
  }

  destroyWalls(x, y, r) {
    const list = [];
    for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (!this.map.inside(tx, ty)) continue;
        const c = this.map.get(tx, ty);
        if (c !== '#' && c !== 'B') continue;
        if (Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > r + 0.35) continue;
        this.map.set(tx, ty, '.');
        list.push([tx, ty, c]);
        this.destroyed.push([tx, ty]);
      }
    }
    if (list.length) { this.events.push({ e: 'tiles', list }); this.fieldCache.clear(); }
  }

  // ---------- Schaden / Heilung ----------
  damage(src, t, amt, o = {}) {
    if (!t.alive || this.over) return 0;
    if (t.invulnUntil > this.time) return 0;
    amt = Math.max(1, Math.round(amt));
    t.hp -= amt;
    t.lastCombat = this.time;
    t.revealUntil = Math.max(t.revealUntil, this.time + 0.8);
    if (src) {
      src.lastCombat = this.time;
      src.dmgDealt += amt;
      if (!o.sup && !o.dot) src.superCharge = Math.min(1, src.superCharge + src.def.superPerHit);
    }
    this.events.push({ e: 'hit', id: t.id, s: src ? src.id : 0, a: amt, x: r2(t.x), y: r2(t.y) });
    if (o.slow) { t.slowUntil = this.time + o.slow.dur; t.slowF = o.slow.f; }
    if (o.burn) { if (t.burnUntil <= this.time) t.burnNext = this.time + 0.5; t.burnUntil = this.time + o.burn.dur; t.burnDps = o.burn.dps; t.burnSrc = src ? src.id : null; }
    if (o.stun) { t.stunUntil = this.time + o.stun; t.cpos = null; t.warp++; }
    if (o.knock && !t.leap) { t.knock = { x: o.knock.x, y: o.knock.y, d: o.knock.d, dur: 0.25 }; t.dash = null; t.cpos = null; t.warp++; }
    if (t.hp <= 0) this.ko(t, src);
    return amt;
  }

  healP(src, t, amt) {
    if (!t.alive || t.hp >= t.maxHp) return;
    const real = Math.min(t.maxHp - t.hp, Math.round(amt));
    t.hp += real;
    src.healed += real;
    src.superCharge = Math.min(1, src.superCharge + src.def.superPerHit * 0.6);
    this.events.push({ e: 'heal', id: t.id, a: real, x: r2(t.x), y: r2(t.y) });
  }

  ko(t, src) {
    t.alive = false; t.hp = 0; t.deaths++;
    t.respawnAt = this.time + RESPAWN;
    t.dash = t.leap = t.knock = null; t.burnUntil = 0; t.z = 0;
    if (src && src !== t) {
      src.kills++;
      if (this.mode !== 'zone') this.score[src.team]++;
    }
    this.events.push({ e: 'ko', k: src ? src.id : 0, v: t.id, x: r2(t.x), y: r2(t.y) });
  }

  // ---------- Projektile ----------
  updateProj(dt) {
    const keep = [];
    for (const b of this.proj) {
      if (b.type === 'lob') {
        b.t += dt / b.dur;
        const k = Math.min(1, b.t);
        b.x = b.sx + (b.tx - b.sx) * k; b.y = b.sy + (b.ty - b.sy) * k;
        b.z = 0.6 + Math.sin(k * Math.PI) * (2.2 + Math.hypot(b.tx - b.sx, b.ty - b.sy) * 0.15) - 0.6 * k;
        if (b.t >= 1) {
          const src = this.byId.get(b.owner);
          if (src) this.aoe(src, b.tx, b.ty, b.aoe, { dmg: b.dmg, heal: b.heal, destroy: b.destroy, k: b.k, sup: b.sup });
          continue;
        }
        keep.push(b);
        continue;
      }
      if (this.stepBullet(b, dt)) keep.push(b);
    }
    this.proj = keep;
  }

  stepBullet(b, dt) {
    const owner = this.byId.get(b.owner);
    if (b.phase === 1) {
      if (!owner || !owner.alive) return false;
      const dx = owner.x - b.x, dy = owner.y - b.y, d = Math.hypot(dx, dy);
      if (d < 0.5 || b.trav > b.range * 3.5) return false;
      b.vx = (dx / d) * b.speed; b.vy = (dy / d) * b.speed;
    }
    const dist = b.speed * dt;
    const n = Math.max(1, Math.ceil(dist / 0.2));
    for (let i = 0; i < n; i++) {
      b.x += (b.vx * dt) / n; b.y += (b.vy * dt) / n; b.trav += dist / n;
      if (b.phase === 0 && this.map.blocksShot(Math.floor(b.x), Math.floor(b.y))) {
        if (b.returns) { b.phase = 1; b.hits.clear(); }
        else { this.events.push({ e: 'pop', x: r2(b.x), y: r2(b.y), k: b.k }); return false; }
      }
      for (const q of this.players) {
        if (!q.alive || q.team === b.team || b.hits.has(q.id) || q.z > 1) continue;
        if (Math.hypot(q.x - b.x, q.y - b.y) < b.rad + PR) {
          b.hits.add(q.id);
          this.damage(owner, q, b.dmg, { sup: b.sup, slow: b.slow, burn: b.burn });
          if (!b.pierce) { this.events.push({ e: 'pop', x: r2(b.x), y: r2(b.y), k: b.k }); return false; }
        }
      }
      if (b.phase === 0 && b.trav >= b.range) {
        if (b.returns) { b.phase = 1; b.hits.clear(); }
        else return false;
      }
    }
    return true;
  }

  updateZones(dt) {
    const keep = [];
    for (const z of this.zones) {
      if (this.time >= z.until) continue;
      z.acc += dt;
      const src = this.byId.get(z.owner);
      while (z.acc >= 0.25) {
        z.acc -= 0.25;
        if (!src) break;
        for (const q of this.players) {
          if (!q.alive || Math.hypot(q.x - z.x, q.y - z.y) > z.r + PR * 0.5) continue;
          if (q.team === src.team) { if (z.hps) this.healP(src, q, z.hps * 0.25); }
          else if (z.dps) this.damage(src, q, z.dps * 0.25, { sup: true, burn: z.burn });
        }
      }
      keep.push(z);
    }
    this.zones = keep;
  }

  // ---------- Modus / Sieg ----------
  updateMode(dt) {
    if (this.mode !== 'zone') return;
    const Z = this.zoneCtl;
    const inside = new Set();
    for (const p of this.players) if (p.alive && Math.hypot(p.x - Z.x, p.y - Z.y) < Z.r) inside.add(p.team);
    if (inside.size === 1) {
      const t = [...inside][0];
      Z.owner = t;
      this.score[t] += dt;
    } else Z.owner = inside.size > 1 ? -2 : -1;
  }

  checkEnd() {
    let winner = null;
    for (let t = 0; t < this.score.length; t++) if (this.score[t] >= this.cfg.goal) winner = t;
    if (winner === null && this.timeLeft <= 0) {
      const max = Math.max(...this.score);
      const tops = this.score.map((s, i) => [s, i]).filter(([s]) => s === max);
      winner = tops.length === 1 ? tops[0][1] : -1;
    }
    if (winner !== null) this.finish(winner);
  }

  finish(winner) {
    this.over = true;
    const ranked = [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.dmgDealt - a.dmgDealt);
    const players = this.players.map((p) => ({
      id: p.id, name: p.name, team: p.team, brawler: p.brawler, kills: p.kills, deaths: p.deaths,
      dmg: p.dmgDealt, healed: Math.round(p.healed), bot: p.bot, rank: ranked.indexOf(p) + 1,
    }));
    let mvp = ranked[0];
    if (winner >= 0 && this.mode !== 'ffa') mvp = ranked.find((p) => p.team === winner) || mvp;
    this.result = { winner, mode: this.mode, score: this.score.map((s) => Math.floor(s)), players, mvp: mvp ? mvp.id : 0 };
    this.events.push({ e: 'end' });
  }

  // ---------- Sichtbarkeit ----------
  visibleTo(team, q) {
    if (q.team === team) return true;
    if (!this.map.isBushAt(q.x, q.y) || q.revealUntil > this.time || q.leap) return true;
    for (const p of this.players) if (p.team === team && p.alive && Math.hypot(p.x - q.x, p.y - q.y) < 2.3) return true;
    return false;
  }

  roster() {
    return this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, brawler: p.brawler, skin: p.skin, level: p.level, bot: p.bot, maxHp: p.maxHp }));
  }

  snapshotFor(viewerId) {
    const v = this.byId.get(viewerId);
    const team = v ? v.team : -99;
    const t = this.time;
    const players = [];
    for (const p of this.players) {
      if (p.alive && !this.visibleTo(team, p)) continue;
      let st = 0;
      if (p.slowUntil > t) st |= 1;
      if (p.stunUntil > t) st |= 2;
      if (p.burnUntil > t) st |= 4;
      if (p.alive && this.map.isBushAt(p.x, p.y)) st |= 8;
      if (p.invulnUntil > t) st |= 16;
      if (p.leap || p.dash || p.knock) st |= 32;
      if (p.superCharge >= 1) st |= 64;
      const o = { id: p.id, x: r2(p.x), y: r2(p.y), z: r2(p.z), f: r2(p.facing), hp: Math.round(p.hp), mhp: p.maxHp, al: p.alive ? 1 : 0, st, w: p.warp, kl: p.kills };
      if (p.team === team) { o.am = r2(p.ammo); o.sc = r2(p.superCharge); }
      if (!p.alive) o.rs = r2(Math.max(0, p.respawnAt - t));
      players.push(o);
    }
    const proj = this.proj.map((b) => b.type === 'lob'
      ? { id: b.id, k: b.k, x: r2(b.x), y: r2(b.y), z: r2(b.z), tx: r2(b.tx), ty: r2(b.ty), r: b.aoe, tm: b.team }
      : { id: b.id, k: b.k, x: r2(b.x), y: r2(b.y), a: r2(Math.atan2(b.vy, b.vx)), tm: b.team });
    const zones = this.zones.map((z) => ({ id: z.id, k: z.k, x: r2(z.x), y: r2(z.y), r: z.r, tm: z.team, l: r2(z.until - t) }));
    return {
      t: r2(t), ph: this.phase, tl: Math.ceil(this.timeLeft), cd: Math.max(0, Math.ceil(COUNTDOWN - t)),
      sc: this.score.map((s) => Math.floor(s)), zo: this.mode === 'zone' ? this.zoneCtl.owner : undefined,
      players, proj, zones,
    };
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- Bot-KI ----------
  fieldTo(x, y) {
    const key = Math.floor(x) + ',' + Math.floor(y);
    let f = this.fieldCache.get(key);
    if (!f) {
      if (this.fieldCache.size > 200) this.fieldCache.clear();
      f = this.map.distField(x, y);
      this.fieldCache.set(key, f);
    }
    return f;
  }

  think(p, dt) {
    const ai = p.ai, def = p.def, t = this.time;
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = 0.2;
      // Ziel wählen
      let best = null, bd = 1e9;
      for (const q of this.players) {
        if (!q.alive || q.team === p.team || !this.visibleTo(p.team, q)) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y) - (q.hp / q.maxHp) * 1.5;
        if (d < bd) { bd = d; best = q; }
      }
      ai.target = best;
      // Heilerin: verletzte Verbündete bevorzugen
      ai.ally = null;
      if (p.brawler === 'heila') {
        for (const q of this.players) {
          if (q === p || !q.alive || q.team !== p.team || q.hp / q.maxHp > 0.65) continue;
          if (Math.hypot(q.x - p.x, q.y - p.y) < def.range) { ai.ally = q; break; }
        }
      }
      // Hängen-Erkennung
      const moved = Math.hypot(p.x - ai.lx, p.y - ai.ly);
      ai.lx = p.x; ai.ly = p.y;
      if (moved < 0.05 && (p.mx || p.my)) ai.stuckT += 0.2; else ai.stuckT = 0;
      if (ai.stuckT > 0.8) { ai.stuckT = 0; ai.unstickT = 0.6; const a = Math.random() * Math.PI * 2; ai.ux = Math.cos(a); ai.uy = Math.sin(a); }
    }

    const q = ai.target;
    const lob = def.aim === 'lob';
    let gx, gy, wantDir = null;
    const lowHp = p.hp / p.maxHp < 0.3;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafeT = 0.8 + Math.random() * 1.4; ai.strafe = -ai.strafe; }

    if (q) {
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
      const los = this.map.lineOfSight(p.x, p.y, q.x, q.y);
      const pref = def.range * (def.range < 3 ? 0.4 : 0.7);
      if (lowHp && p.brawler !== 'brocken') {
        const sp = this.mode === 'ffa' ? this.map.ffaSpawns[p.team % 6] : this.map.spawns[p.team][0];
        gx = sp.x; gy = sp.y;
      } else if (!los && !lob) { gx = q.x; gy = q.y; }
      else if (d > pref * 1.15) { gx = q.x; gy = q.y; }
      else {
        const nx = dx / d, ny = dy / d;
        let mx = -ny * ai.strafe, my = nx * ai.strafe;
        if (d < pref * 0.6 && def.range > 3) { mx -= nx; my -= ny; }
        wantDir = { x: mx, y: my };
      }
      // Schießen
      const tgt = ai.ally || q;
      const td = Math.hypot(tgt.x - p.x, tgt.y - p.y);
      if (t >= ai.nextShot && p.ammo >= 1 && td <= def.range + 0.3 && (lob || los || tgt === ai.ally)) {
        const lead = lob ? 0.6 : td / (def.projSpeed || 15);
        const err = (Math.random() - 0.5) * 0.7;
        const ax = tgt.x + tgt.vx * lead + err - p.x, ay = tgt.y + tgt.vy * lead - err - p.y;
        this.queueAction(p.id, 'atk', ax, ay, Math.hypot(ax, ay));
        ai.nextShot = t + ai.react + (p.ammo < 2 ? 0.6 : 0.15) + Math.random() * 0.3;
      }
      // Super
      if (p.superCharge >= 1) {
        const sr = def.superAim === 'self' ? (def.superRadius || 4) * 0.8 : (def.superRange || def.range);
        let use = d <= sr && (los || lob || def.superAim === 'circle');
        if (p.brawler === 'heila') use = (ai.ally || p.hp / p.maxHp < 0.6) && d < 9;
        if (use) {
          const tg = p.brawler === 'heila' ? (ai.ally || p) : q;
          let ax = tg.x - p.x, ay = tg.y - p.y;
          if (!ax && !ay) ax = 0.01;
          this.queueAction(p.id, 'sup', ax, ay, Math.hypot(ax, ay));
        }
      }
    } else {
      // Kein Ziel: Richtung Ziel des Modus bewegen
      if (this.mode === 'zone') { gx = this.zoneCtl.x + Math.sin(t * 0.5 + p.id) * 1.2; gy = this.zoneCtl.y; }
      else {
        let nb = null, nd = 1e9;
        for (const e of this.players) {
          if (!e.alive || e.team === p.team) continue;
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; nb = e; }
        }
        if (nb) { gx = nb.x * 0.7 + this.map.center.x * 0.3; gy = nb.y * 0.7 + this.map.center.y * 0.3; }
        else { gx = this.map.center.x; gy = this.map.center.y; }
      }
    }
    if (this.mode === 'zone' && q && !lowHp && Math.hypot(this.zoneCtl.x - p.x, this.zoneCtl.y - p.y) > 5 && Math.hypot(q.x - p.x, q.y - p.y) > def.range) {
      gx = this.zoneCtl.x; gy = this.zoneCtl.y; wantDir = null;
    }

    let mx = 0, my = 0;
    if (ai.unstickT > 0) { ai.unstickT -= dt; mx = ai.ux; my = ai.uy; }
    else if (wantDir) { mx = wantDir.x; my = wantDir.y; }
    else if (gx !== undefined) {
      if (Math.hypot(gx - p.x, gy - p.y) > 0.6) {
        const dir = this.map.stepDir(this.fieldTo(gx, gy), p.x, p.y);
        if (dir) { mx = dir.x; my = dir.y; }
        else { mx = gx - p.x; my = gy - p.y; }
      }
    }
    const l = Math.hypot(mx, my);
    p.mx = l > 0 ? mx / l : 0; p.my = l > 0 ? my / l : 0;
  }
}
