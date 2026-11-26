// Admins: Namen (öffentlich, z. B. in wrangler.toml) + Admin-Code (geheim: Cloudflare-Secret / Umgebungsvariable ADMIN_CODE).
// Ein Admin muss mit einem Admin-Konto angemeldet sein UND den Admin-Code eingeben.
import { BRAWLER_ORDER, BRAWLERS, MAX_LEVEL } from '../public/shared/brawlers.js';

const cfg = { names: ['dinnerboneagg'], code: '' };

export function configureAdmin({ names, code } = {}) {
  if (names) cfg.names = String(names).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  cfg.code = code ? String(code) : '';
}

export const isAdminName = (login) => !!login && cfg.names.includes(String(login).toLowerCase());
export const adminEnabled = () => !!cfg.code;

// Vergleich ohne Zeit-Unterschiede
export function checkCode(code) {
  if (!cfg.code || typeof code !== 'string') return false;
  const a = cfg.code, b = code;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  return diff === 0;
}

const clampInt = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };

export function summary(acc) {
  const p = acc.profile;
  return {
    id: acc.id, login: acc.login, name: p.name, banned: !!acc.banned, admin: isAdminName(acc.login),
    coins: p.coins, gems: p.gems, boxes: p.boxes, trophies: p.trophies, levels: p.levels,
    unlocked: p.unlocked, games: p.stats.games, wins: p.stats.wins, created: acc.created || null,
  };
}

// Änderungen am Profil eines Spielers. Gibt eine Fehlermeldung oder null zurück.
export function applyAdminEdit(p, m) {
  switch (m.action) {
    case 'give':
      p.coins = Math.max(0, p.coins + clampInt(m.coins, -1e6, 1e6));
      p.gems = Math.max(0, p.gems + clampInt(m.gems, -1e5, 1e5));
      p.boxes = Math.max(0, Math.min(1000, p.boxes + clampInt(m.boxes, -1000, 1000)));
      return null;
    case 'trophies':
      if (!BRAWLERS[m.brawler]) return 'Unbekannter Brawler.';
      p.trophies[m.brawler] = clampInt(m.value, 0, 100000);
      return null;
    case 'unlockAll':
      p.unlocked = [...BRAWLER_ORDER];
      return null;
    case 'maxAll':
      for (const k of BRAWLER_ORDER) p.levels[k] = MAX_LEVEL;
      return null;
    default:
      return 'Unbekannte Aktion.';
  }
}
