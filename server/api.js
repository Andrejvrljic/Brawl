// REST-API für Konten, Fortschritt und Rangliste.
// Läuft gleich unter Node (SQLite) und Cloudflare (D1): alle Datenbank-Aufrufe werden mit await benutzt.
import { MODES } from '../public/shared/game.js';
import { runAction, applyMatch, totalTrophies } from '../public/shared/progress.js';
import { isAdminName, serverInfo, eventBoost } from './admin.js';

const OFFLINE_MIN_GAP = 25 * 1000; // Mindestabstand zwischen gemeldeten Bot-Matches
const hits = new Map();

export function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > windowMs) { h.n = 0; h.t = now; }
  h.n++; hits.set(key, h);
  if (hits.size > 5000) hits.clear();
  return h.n > max;
}

export async function publicProfile(db, acc) {
  return {
    profile: acc.profile,
    account: { registered: acc.registered, login: acc.login, admin: isAdminName(acc.login), rank: await db.rankOf(totalTrophies(acc.profile)) },
    news: await serverInfo(db),
  };
}

// Gibt { status, data } zurück
export async function handleApi(db, { method, path, body = {}, token = '', ip = '?', stats = {} }) {
  const out = (status, data) => ({ status, data });
  if (limited('api:' + ip, 300, 60000)) return out(429, { error: 'Zu viele Anfragen – kurz warten.' });
  const auth = () => db.byToken(token);

  switch (`${method} ${path}`) {
    case 'GET /api/health': return out(200, { ok: true, accounts: await db.accountCount(), ...stats });
    case 'GET /api/leaderboard': return out(200, { top: await db.leaderboard(50) });
    case 'GET /api/news': return out(200, await serverInfo(db));
    case 'POST /api/guest': return out(410, { error: 'Zum Spielen brauchst du ein Konto.' });
    case 'POST /api/signup': {
      if (limited('signup:' + ip, 20, 10 * 60000)) return out(429, { error: 'Zu viele neue Konten – später nochmal.' });
      const r = await db.createAccount(String(body.login || '').trim(), body.password);
      if (r.error) return out(400, { error: r.error });
      return out(200, { token: r.token, ...(await publicProfile(db, await db.account(r.id))) });
    }
    case 'POST /api/login': {
      if (limited('login:' + ip, 10, 5 * 60000)) return out(429, { error: 'Zu viele Versuche – in ein paar Minuten nochmal.' });
      const r = await db.login(body.login, body.password);
      if (!r) return out(401, { error: 'Benutzername oder Passwort falsch.' });
      if (r.banned) return out(403, { error: 'Dieses Konto ist gesperrt.' });
      return out(200, { token: r.token, ...(await publicProfile(db, await db.account(r.id))) });
    }
    case 'GET /api/me': {
      const acc = await auth();
      if (!acc) return out(401, { error: 'Nicht angemeldet.' });
      return out(200, { ...(await publicProfile(db, acc)), history: await db.history(acc, 10) });
    }
    case 'POST /api/register': {
      const acc = await auth();
      if (!acc) return out(401, { error: 'Nicht angemeldet.' });
      const r = await db.register(acc, String(body.login || '').trim(), body.password);
      if (r.error) return out(400, { error: r.error });
      return out(200, await publicProfile(db, await db.account(acc.id)));
    }
    case 'POST /api/logout': await db.logout(token); return out(200, { ok: true });
    case 'POST /api/action': {
      const acc = await auth();
      if (!acc) return out(401, { error: 'Nicht angemeldet.' });
      if (!acc.registered) return out(403, { error: 'Bitte erstelle zuerst ein Konto.' });
      let result;
      if (body.type === 'offline') {
        const now = Date.now();
        if (now - acc.lastOffline < OFFLINE_MIN_GAP) return out(429, { error: 'Match zu kurz für eine Belohnung.' });
        const r = body.result, me = r?.players?.find((x) => x.id === body.you);
        if (!me || !MODES[r.mode] || !acc.profile.unlocked.includes(me.brawler)) return out(400, { error: 'Ungültiges Ergebnis.' });
        result = applyMatch(acc.profile, r, body.you, await eventBoost(db));
        if (!result) return out(400, { error: 'Ungültiges Ergebnis.' });
        await db.setOffline(acc, now);
        await db.recordMatch(acc, r.mode, me.brawler, result, me.kills, false);
      } else {
        result = runAction(acc.profile, body);
        if (!result) return out(400, { error: 'Aktion nicht möglich.' });
      }
      await db.save(acc);
      return out(200, { result, ...(await publicProfile(db, acc)) });
    }
  }
  return out(404, { error: 'Unbekannt.' });
}
