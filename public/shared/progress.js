// Fortschritt & Belohnungen – gemeinsame Regeln für Server (Datenbank) und Browser (Offline)
import { BRAWLERS, BRAWLER_ORDER, MAX_LEVEL, SKIN_COST } from './brawlers.js';

export const UPGRADE_COST = [0, 40, 80, 140, 220, 320, 450]; // Münzen für Stufe L -> L+1

// Trophäenstraße: Belohnungen ab bestimmter Gesamt-Trophäenzahl
export const ROAD = [
  { at: 10, type: 'coins', n: 100 },
  { at: 20, type: 'box', n: 1 },
  { at: 30, type: 'brawler', key: 'pfeil' },
  { at: 45, type: 'gems', n: 20 },
  { at: 60, type: 'brawler', key: 'bummi' },
  { at: 80, type: 'box', n: 2 },
  { at: 100, type: 'brawler', key: 'frost' },
  { at: 125, type: 'coins', n: 200 },
  { at: 150, type: 'brawler', key: 'wirbel' },
  { at: 185, type: 'gems', n: 40 },
  { at: 220, type: 'brawler', key: 'glut' },
  { at: 260, type: 'box', n: 3 },
  { at: 300, type: 'brawler', key: 'heila' },
  { at: 350, type: 'coins', n: 400 },
  { at: 420, type: 'gems', n: 80 },
  { at: 500, type: 'box', n: 5 },
];

const int = (v, lo, hi, d = lo) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function freshProfile() {
  const levels = {}, trophies = {}, skins = {}, skinSel = {};
  for (const k of BRAWLER_ORDER) { levels[k] = 1; trophies[k] = 0; skins[k] = [0]; skinSel[k] = 0; }
  return {
    name: 'Spieler' + Math.floor(100 + Math.random() * 900),
    coins: 50, gems: 10, boxes: 1, boxMeter: 0,
    unlocked: ['funke', 'brocken'], selected: 'funke',
    levels, trophies, skins, skinSel, claimed: [],
    stats: { games: 0, wins: 0, kos: 0 }, sound: true,
  };
}

// Bereinigt ein (evtl. altes oder manipuliertes) Profil auf gültige Werte
export function normalize(s) {
  const b = freshProfile();
  if (!s || typeof s !== 'object') return b;
  const p = {
    name: String(s.name || b.name).replace(/[<>]/g, '').trim().slice(0, 14) || b.name,
    coins: int(s.coins, 0, 1e7, b.coins), gems: int(s.gems, 0, 1e6, b.gems),
    boxes: int(s.boxes, 0, 1000, b.boxes), boxMeter: int(s.boxMeter, 0, 99, 0),
    unlocked: [], selected: 'funke', levels: {}, trophies: {}, skins: {}, skinSel: {},
    claimed: [], stats: { games: 0, wins: 0, kos: 0 }, sound: s.sound !== false,
  };
  for (const k of BRAWLER_ORDER) {
    p.levels[k] = int(s.levels?.[k], 1, MAX_LEVEL, 1);
    p.trophies[k] = int(s.trophies?.[k], 0, 1e5, 0);
    const sk = Array.isArray(s.skins?.[k]) ? s.skins[k].map((x) => int(x, 0, 2, 0)) : [];
    p.skins[k] = [...new Set([0, ...sk])].sort();
    const sel = int(s.skinSel?.[k], 0, 2, 0);
    p.skinSel[k] = p.skins[k].includes(sel) ? sel : 0;
  }
  const un = Array.isArray(s.unlocked) ? s.unlocked.filter((k) => BRAWLERS[k]) : [];
  p.unlocked = [...new Set(['funke', 'brocken', ...un])];
  p.selected = p.unlocked.includes(s.selected) ? s.selected : p.unlocked[0];
  p.claimed = Array.isArray(s.claimed) ? [...new Set(s.claimed.map((i) => int(i, 0, ROAD.length - 1, 0)))] : [];
  if (s.stats) for (const k of ['games', 'wins', 'kos']) p.stats[k] = int(s.stats[k], 0, 1e7, 0);
  return p;
}

export const totalTrophies = (p) => BRAWLER_ORDER.reduce((a, k) => a + (p.trophies[k] || 0), 0);
export const roadAvailable = (p) => { const t = totalTrophies(p); return ROAD.filter((r, i) => t >= r.at && !p.claimed.includes(i)).length; };

// ---------- Aktionen (geben null zurück, wenn nicht erlaubt) ----------
export function upgrade(p, k) {
  if (!p.unlocked.includes(k)) return null;
  const lvl = p.levels[k];
  if (lvl >= MAX_LEVEL || p.coins < UPGRADE_COST[lvl]) return null;
  p.coins -= UPGRADE_COST[lvl]; p.levels[k] = lvl + 1;
  return { level: p.levels[k] };
}

export function buySkin(p, k, i) {
  if (!p.unlocked.includes(k) || ![0, 1, 2].includes(i)) return null;
  if (p.skins[k].includes(i)) { p.skinSel[k] = i; return { bought: false }; }
  if (p.gems < SKIN_COST[i]) return null;
  p.gems -= SKIN_COST[i]; p.skins[k].push(i); p.skinSel[k] = i;
  return { bought: true };
}

export function selectBrawler(p, k) {
  if (!p.unlocked.includes(k)) return null;
  p.selected = k;
  return {};
}

export function rename(p, name) {
  const v = String(name || '').replace(/[<>]/g, '').trim().slice(0, 14);
  if (!v) return null;
  p.name = v;
  return {};
}

export function claimRoad(p, i) {
  const r = ROAD[i];
  if (!r || p.claimed.includes(i) || totalTrophies(p) < r.at) return null;
  p.claimed.push(i);
  if (r.type === 'coins') p.coins += r.n;
  if (r.type === 'gems') p.gems += r.n;
  if (r.type === 'box') p.boxes += r.n;
  if (r.type === 'brawler' && !p.unlocked.includes(r.key)) p.unlocked.push(r.key);
  return { reward: r };
}

export function openBox(p, rnd = Math.random) {
  if (p.boxes <= 0) return null;
  p.boxes--;
  const items = [];
  const coins = 30 + Math.floor(rnd() * 70);
  p.coins += coins; items.push({ type: 'coins', n: coins });
  if (rnd() < 0.45) { const g = 4 + Math.floor(rnd() * 12); p.gems += g; items.push({ type: 'gems', n: g }); }
  const locked = BRAWLER_ORDER.filter((k) => !p.unlocked.includes(k));
  if (locked.length && rnd() < 0.12) {
    const k = locked[Math.floor(rnd() * locked.length)];
    p.unlocked.push(k); items.push({ type: 'brawler', key: k });
  } else if (rnd() < 0.35) {
    const c = 40 + Math.floor(rnd() * 60); p.coins += c; items.push({ type: 'coins', n: c, bonus: true });
  }
  return { items };
}

// Belohnung nach einem Match
export function applyMatch(p, result, youId, boost = 1) {
  const me = result?.players?.find((x) => x.id === youId);
  if (!me || !BRAWLERS[me.brawler]) return null;
  const k = me.brawler;
  let outcome, troph, coins, meter;
  if (result.mode === 'ffa') {
    const r = int(me.rank, 1, 6, 6);
    troph = [10, 6, 3, 0, -2, -4][r - 1];
    outcome = r === 1 ? 'win' : r <= 3 ? 'draw' : 'loss';
    coins = [30, 22, 16, 12, 10, 8][r - 1];
    meter = [40, 30, 22, 16, 12, 10][r - 1];
  } else if (result.winner === -1) { outcome = 'draw'; troph = 2; coins = 15; meter = 22; }
  else if (result.winner === me.team) { outcome = 'win'; troph = 8; coins = 25; meter = 35; }
  else { outcome = 'loss'; troph = -4; coins = 10; meter = 15; }
  const mvp = result.mvp === youId;
  if (mvp) { coins += 10; troph += 1; }
  // Event „Doppelte Belohnungen“
  if (boost > 1) { coins *= boost; meter *= boost; if (troph > 0) troph *= boost; }
  const kills = int(me.kills, 0, 30, 0);
  coins += kills * 3;
  const before = p.trophies[k] || 0;
  p.trophies[k] = Math.max(0, before + troph);
  const realTroph = p.trophies[k] - before;
  p.coins += coins;
  p.boxMeter += meter;
  let newBoxes = 0;
  while (p.boxMeter >= 100) { p.boxMeter -= 100; p.boxes++; newBoxes++; }
  p.stats.games++;
  if (outcome === 'win') p.stats.wins++;
  p.stats.kos += kills;
  return { outcome, troph: realTroph, coins, meter, newBoxes, mvp, boost };
}

// Ausführen einer Aktion per Name (vom Server und vom Offline-Client benutzt)
export function runAction(p, a) {
  switch (a?.type) {
    case 'upgrade': return upgrade(p, a.key);
    case 'skin': return buySkin(p, a.key, a.skin | 0);
    case 'select': return selectBrawler(p, a.key);
    case 'rename': return rename(p, a.name);
    case 'sound': p.sound = !!a.on; return {};
    case 'claim': return claimRoad(p, a.index | 0);
    case 'box': return openBox(p);
    default: return null;
  }
}
