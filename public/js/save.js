// Fortschritt & Belohnungen (gespeichert im Browser)
import { BRAWLERS, BRAWLER_ORDER, MAX_LEVEL, SKIN_COST } from '../shared/brawlers.js';

const KEY = 'kistenkrawall_save_v1';

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

function fresh() {
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

export const save = (() => {
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { s = null; }
  const base = fresh();
  if (!s || typeof s !== 'object') return base;
  for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
  for (const k of BRAWLER_ORDER) {
    if (!s.levels[k]) s.levels[k] = 1;
    if (s.trophies[k] === undefined) s.trophies[k] = 0;
    if (!s.skins[k]) s.skins[k] = [0];
    if (s.skinSel[k] === undefined) s.skinSel[k] = 0;
  }
  if (!s.unlocked.includes(s.selected)) s.selected = s.unlocked[0];
  return s;
})();

export function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* privater Modus */ } }
export const totalTrophies = () => BRAWLER_ORDER.reduce((a, k) => a + (save.trophies[k] || 0), 0);
export const isUnlocked = (k) => save.unlocked.includes(k);

export function upgrade(k) {
  const lvl = save.levels[k];
  if (lvl >= MAX_LEVEL) return false;
  const cost = UPGRADE_COST[lvl];
  if (save.coins < cost) return false;
  save.coins -= cost; save.levels[k] = lvl + 1; persist();
  return true;
}

export function buySkin(k, i) {
  if (save.skins[k].includes(i)) { save.skinSel[k] = i; persist(); return true; }
  if (save.gems < SKIN_COST[i]) return false;
  save.gems -= SKIN_COST[i]; save.skins[k].push(i); save.skinSel[k] = i; persist();
  return true;
}

export function claimRoad(i) {
  const r = ROAD[i];
  if (!r || save.claimed.includes(i) || totalTrophies() < r.at) return null;
  save.claimed.push(i);
  if (r.type === 'coins') save.coins += r.n;
  if (r.type === 'gems') save.gems += r.n;
  if (r.type === 'box') save.boxes += r.n;
  if (r.type === 'brawler' && !save.unlocked.includes(r.key)) save.unlocked.push(r.key);
  persist();
  return r;
}

// Kiste öffnen: zufällige Belohnungen
export function openBox() {
  if (save.boxes <= 0) return null;
  save.boxes--;
  const items = [];
  const coins = 30 + Math.floor(Math.random() * 70);
  save.coins += coins; items.push({ type: 'coins', n: coins });
  if (Math.random() < 0.45) { const g = 4 + Math.floor(Math.random() * 12); save.gems += g; items.push({ type: 'gems', n: g }); }
  const locked = BRAWLER_ORDER.filter((k) => !save.unlocked.includes(k));
  if (locked.length && Math.random() < 0.12) {
    const k = locked[Math.floor(Math.random() * locked.length)];
    save.unlocked.push(k); items.push({ type: 'brawler', key: k });
  } else if (Math.random() < 0.35) {
    const c = 40 + Math.floor(Math.random() * 60); save.coins += c; items.push({ type: 'coins', n: c, bonus: true });
  }
  persist();
  return items;
}

// Belohnung nach einem Match berechnen und gutschreiben
export function applyMatch(result, youId) {
  const me = result.players.find((p) => p.id === youId);
  if (!me) return null;
  const k = me.brawler;
  let outcome, troph, coins, meter;
  if (result.mode === 'ffa') {
    const tbl = [10, 6, 3, 0, -2, -4];
    troph = tbl[me.rank - 1] ?? -4;
    outcome = me.rank === 1 ? 'win' : me.rank <= 3 ? 'draw' : 'loss';
    coins = [30, 22, 16, 12, 10, 8][me.rank - 1] ?? 8;
    meter = [40, 30, 22, 16, 12, 10][me.rank - 1] ?? 10;
  } else if (result.winner === -1) { outcome = 'draw'; troph = 2; coins = 15; meter = 22; }
  else if (result.winner === me.team) { outcome = 'win'; troph = 8; coins = 25; meter = 35; }
  else { outcome = 'loss'; troph = -4; coins = 10; meter = 15; }
  const mvp = result.mvp === youId;
  if (mvp) { coins += 10; troph += 1; }
  coins += me.kills * 3;
  const before = save.trophies[k];
  save.trophies[k] = Math.max(0, before + troph);
  const realTroph = save.trophies[k] - before;
  save.coins += coins;
  save.boxMeter += meter;
  let newBoxes = 0;
  while (save.boxMeter >= 100) { save.boxMeter -= 100; save.boxes++; newBoxes++; }
  save.stats.games++;
  if (outcome === 'win') save.stats.wins++;
  save.stats.kos += me.kills;
  persist();
  return { outcome, troph: realTroph, coins, meter, newBoxes, mvp, me };
}

export function roadAvailable() {
  const t = totalTrophies();
  return ROAD.filter((r, i) => t >= r.at && !save.claimed.includes(i)).length;
}

export { BRAWLERS };
