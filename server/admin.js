// Admins: Namen (öffentlich, z. B. in wrangler.toml) + Admin-Code (geheim: Cloudflare-Secret / Umgebungsvariable ADMIN_CODE).
// Ein Admin muss mit einem Admin-Konto angemeldet sein UND den Admin-Code eingeben.
import { BRAWLER_ORDER, BRAWLERS, MAX_LEVEL } from '../public/shared/brawlers.js';
import { freshProfile } from '../public/shared/progress.js';

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
    unlocked: p.unlocked, skins: p.skins, games: p.stats.games, wins: p.stats.wins, kos: p.stats.kos, created: acc.created || null,
  };
}

// ---------- Server-Einstellungen (Event, Wartung, Nachricht des Tages) ----------
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

export async function serverInfo(db) {
  const now = Date.now();
  const ev = parse(await db.getSetting('event'));
  const mt = parse(await db.getSetting('maintenance'));
  const motd = await db.getSetting('motd');
  return {
    motd: motd || '',
    event: ev && ev.until > now ? { kind: ev.kind, until: ev.until, boost: 2 } : null,
    maintenance: mt && mt.on ? { text: mt.text || 'Wartungsarbeiten – gleich geht es weiter!' } : null,
  };
}
export async function eventBoost(db) { const i = await serverInfo(db); return i.event ? i.event.boost : 1; }

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
    case 'level':
      if (!BRAWLERS[m.brawler]) return 'Unbekannter Brawler.';
      p.levels[m.brawler] = clampInt(m.value, 1, MAX_LEVEL) || 1;
      return null;
    case 'skinsAll':
      for (const k of BRAWLER_ORDER) p.skins[k] = [0, 1, 2];
      return null;
    case 'rename': {
      const v = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 14);
      if (!v) return 'Name ist leer.';
      p.name = v;
      return null;
    }
    case 'resetProgress': {
      const f = freshProfile();
      f.name = p.name;
      for (const k of Object.keys(p)) delete p[k];
      Object.assign(p, f);
      return null;
    }
    default:
      return 'Unbekannte Aktion.';
  }
}
