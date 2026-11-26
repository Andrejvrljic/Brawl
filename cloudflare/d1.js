// Datenbank auf Cloudflare D1 – gleiche Methoden wie server/db.js (SQLite unter Node), nur asynchron.
import { freshProfile, normalize, totalTrophies } from '../public/shared/progress.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE COLLATE NOCASE, pass TEXT, name TEXT NOT NULL,
    profile TEXT NOT NULL, trophies INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL,
    last_offline INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created INTEGER NOT NULL, last_used INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, mode TEXT NOT NULL, brawler TEXT NOT NULL,
    outcome TEXT NOT NULL, trophies INTEGER NOT NULL, kills INTEGER NOT NULL, online INTEGER NOT NULL, played INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS friends (
    a INTEGER NOT NULL, b INTEGER NOT NULL, requester INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b))`,
  'CREATE INDEX IF NOT EXISTS idx_friends_b ON friends(b)',
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS bans (account_id INTEGER PRIMARY KEY, created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_accounts_trophies ON accounts(trophies DESC)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_matches_account ON matches(account_id, played DESC)',
];

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function pbkdf2(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
async function hashPassword(pw) { const salt = randomHex(16); return `pbkdf2$${salt}$${await pbkdf2(pw, salt)}`; }
async function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !salt || !hash) return false;
  const test = await pbkdf2(pw, salt);
  let diff = test.length ^ hash.length;
  for (let i = 0; i < Math.min(test.length, hash.length); i++) diff |= test.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

function checkLogin(login, password) {
  if (typeof login !== 'string' || !/^[A-Za-z0-9_äöüÄÖÜß.-]{3,20}$/.test(login)) return 'Benutzername: 3–20 Zeichen (Buchstaben, Zahlen, _ . -).';
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return 'Passwort: mindestens 6 Zeichen.';
  return null;
}

let schemaReady = null;

export class D1Store {
  constructor(d1) { this.d1 = d1; }

  async ready() {
    if (!schemaReady) schemaReady = this.d1.batch(SCHEMA.map((s) => this.d1.prepare(s))).catch((e) => { schemaReady = null; throw e; });
    await schemaReady;
  }
  async q(sql, ...args) { await this.ready(); return this.d1.prepare(sql).bind(...args); }

  async createGuest(importProfile) {
    const p = importProfile ? normalize(importProfile) : freshProfile();
    const now = Date.now();
    const r = await (await this.q('INSERT INTO accounts (name, profile, trophies, created, updated) VALUES (?, ?, ?, ?, ?)', p.name, JSON.stringify(p), totalTrophies(p), now, now)).run();
    const id = r.meta.last_row_id;
    return { id, token: await this.newSession(id) };
  }

  async newSession(id) {
    const token = randomHex(24), now = Date.now();
    await (await this.q('INSERT INTO sessions (token_hash, account_id, created, last_used) VALUES (?, ?, ?, ?)', await sha(token), id, now, now)).run();
    return token;
  }

  async byToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const h = await sha(token);
    const s = await (await this.q('SELECT account_id FROM sessions WHERE token_hash = ?', h)).first();
    if (!s) return null;
    if (await this.isBanned(s.account_id)) return null;
    await (await this.q('UPDATE sessions SET last_used = ? WHERE token_hash = ?', Date.now(), h)).run();
    return this.account(s.account_id);
  }

  // ---------- Admin ----------
  async byLogin(login) {
    const row = typeof login === 'string' ? await (await this.q('SELECT id, created FROM accounts WHERE login = ?', login.trim())).first() : null;
    if (!row) return null;
    return { ...(await this.account(row.id)), created: row.created, banned: await this.isBanned(row.id) };
  }
  async getSetting(key) { const r = await (await this.q('SELECT value FROM settings WHERE key = ?', key)).first(); return r ? r.value : null; }
  async setSetting(key, value) {
    if (value === null) await (await this.q('DELETE FROM settings WHERE key = ?', key)).run();
    else await (await this.q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value))).run();
  }
  async logAdmin(admin, action, detail) {
    await (await this.q('INSERT INTO admin_log (admin, action, detail, at) VALUES (?, ?, ?, ?)', String(admin), String(action), String(detail).slice(0, 300), Date.now())).run();
  }
  async adminLog(n = 40) { return (await (await this.q('SELECT admin, action, detail, at FROM admin_log ORDER BY id DESC LIMIT ?', n)).all()).results; }
  async searchAccounts(q, n = 12) {
    return (await (await this.q("SELECT login, name, trophies FROM accounts WHERE login IS NOT NULL AND (login LIKE ? OR name LIKE ?) ORDER BY trophies DESC LIMIT ?", q + '%', '%' + q + '%', n)).all()).results;
  }
  async allAccountIds() { return (await (await this.q('SELECT id FROM accounts WHERE login IS NOT NULL')).all()).results.map((r) => r.id); }
  async setPassword(id, password) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 100) return { error: 'Passwort: mindestens 6 Zeichen.' };
    await (await this.q('UPDATE accounts SET pass = ?, updated = ? WHERE id = ?', await hashPassword(password), Date.now(), id)).run();
    await (await this.q('DELETE FROM sessions WHERE account_id = ?', id)).run();
    return { ok: true };
  }
  async deleteAccount(id) {
    await this.ready();
    await this.d1.batch([
      this.d1.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id),
      this.d1.prepare('DELETE FROM matches WHERE account_id = ?').bind(id),
      this.d1.prepare('DELETE FROM bans WHERE account_id = ?').bind(id),
      this.d1.prepare('DELETE FROM friends WHERE a = ? OR b = ?').bind(id, id),
      this.d1.prepare('DELETE FROM accounts WHERE id = ?').bind(id),
    ]);
  }
  async isBanned(id) { return !!(await (await this.q('SELECT 1 AS b FROM bans WHERE account_id = ?', id)).first()); }
  async setBan(id, on) {
    if (on) await (await this.q('INSERT OR IGNORE INTO bans (account_id, created) VALUES (?, ?)', id, Date.now())).run();
    else await (await this.q('DELETE FROM bans WHERE account_id = ?', id)).run();
  }

  async account(id) {
    const row = await (await this.q('SELECT * FROM accounts WHERE id = ?', id)).first();
    if (!row) return null;
    return { id: row.id, login: row.login, registered: !!row.login, profile: normalize(JSON.parse(row.profile)), lastOffline: row.last_offline };
  }

  async save(acc) {
    const p = acc.profile;
    await (await this.q('UPDATE accounts SET name = ?, profile = ?, trophies = ?, updated = ? WHERE id = ?', p.name, JSON.stringify(p), totalTrophies(p), Date.now(), acc.id)).run();
  }

  async logout(token) { if (typeof token === 'string' && token) await (await this.q('DELETE FROM sessions WHERE token_hash = ?', await sha(token))).run(); }

  async createAccount(login, password) {
    const err = checkLogin(login, password);
    if (err) return { error: err };
    if (await (await this.q('SELECT id FROM accounts WHERE login = ?', login)).first()) return { error: 'Dieser Benutzername ist schon vergeben.' };
    const p = freshProfile();
    p.name = login.slice(0, 14);
    const now = Date.now();
    const r = await (await this.q('INSERT INTO accounts (login, pass, name, profile, trophies, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?)',
      login, await hashPassword(password), p.name, JSON.stringify(p), now, now)).run();
    const id = r.meta.last_row_id;
    return { id, token: await this.newSession(id) };
  }

  // ---------- Freunde ----------
  async friends(id) {
    const { results } = await (await this.q(`SELECT f.requester, f.status, acc.id, acc.name, acc.login, acc.trophies FROM friends f
      JOIN accounts acc ON acc.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
      WHERE f.a = ? OR f.b = ? ORDER BY acc.name COLLATE NOCASE`, id, id, id)).all();
    return results.map((r) => ({
      id: r.id, name: r.name, login: r.login, trophies: r.trophies,
      status: r.status === 'accepted' ? 'friend' : (r.requester === id ? 'outgoing' : 'incoming'),
    }));
  }
  async pair(x, y) { const [a, b] = x < y ? [x, y] : [y, x]; return { a, b, f: await (await this.q('SELECT * FROM friends WHERE a = ? AND b = ?', a, b)).first() }; }
  async areFriends(x, y) { const { f } = await this.pair(x, y); return !!f && f.status === 'accepted'; }
  async friendRequest(id, login) {
    const other = typeof login === 'string' ? await (await this.q('SELECT id FROM accounts WHERE login = ?', login.trim())).first() : null;
    if (!other) return { error: 'Diesen Benutzernamen gibt es nicht.' };
    if (other.id === id) return { error: 'Du kannst dich nicht selbst hinzufügen.' };
    const { a, b, f } = await this.pair(id, other.id);
    if (f && f.status === 'accepted') return { error: 'Ihr seid schon Freunde.' };
    if (f && f.requester === id) return { error: 'Anfrage wurde schon gesendet.' };
    if (f) { await (await this.q("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", a, b)).run(); return { ok: true, other: other.id, accepted: true }; }
    const n = (await (await this.q('SELECT COUNT(*) AS n FROM friends WHERE a = ? OR b = ?', id, id)).first()).n;
    if (n >= 100) return { error: 'Maximal 100 Freunde.' };
    await (await this.q('INSERT INTO friends (a, b, requester, status, created) VALUES (?, ?, ?, ?, ?)', a, b, id, 'pending', Date.now())).run();
    return { ok: true, other: other.id };
  }
  async friendRespond(id, otherId, accept) {
    const { a, b, f } = await this.pair(id, otherId);
    if (!f || f.status !== 'pending' || f.requester === id) return { error: 'Keine offene Anfrage.' };
    if (accept) await (await this.q("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?", a, b)).run();
    else await (await this.q('DELETE FROM friends WHERE a = ? AND b = ?', a, b)).run();
    return { ok: true };
  }
  async friendRemove(id, otherId) {
    const { a, b } = await this.pair(id, otherId);
    await (await this.q('DELETE FROM friends WHERE a = ? AND b = ?', a, b)).run();
    return { ok: true };
  }

  async register(acc, login, password) {
    const err = checkLogin(login, password);
    if (err) return { error: err };
    if (acc.registered) return { error: 'Dieses Konto ist schon gesichert.' };
    if (await (await this.q('SELECT id FROM accounts WHERE login = ?', login)).first()) return { error: 'Dieser Benutzername ist schon vergeben.' };
    await (await this.q('UPDATE accounts SET login = ?, pass = ?, updated = ? WHERE id = ?', login, await hashPassword(password), Date.now(), acc.id)).run();
    return { ok: true };
  }

  async login(login, password) {
    if (typeof login !== 'string' || typeof password !== 'string') return null;
    const row = await (await this.q('SELECT id, pass FROM accounts WHERE login = ?', login.trim())).first();
    if (!row || !(await verifyPassword(password, row.pass))) return null;
    if (await this.isBanned(row.id)) return { banned: true };
    return { id: row.id, token: await this.newSession(row.id) };
  }

  async setOffline(acc, t) { await (await this.q('UPDATE accounts SET last_offline = ? WHERE id = ?', t, acc.id)).run(); acc.lastOffline = t; }

  async recordMatch(acc, mode, brawler, reward, kills, online) {
    await (await this.q('INSERT INTO matches (account_id, mode, brawler, outcome, trophies, kills, online, played) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      acc.id, mode, brawler, reward.outcome, reward.troph, kills | 0, online ? 1 : 0, Date.now())).run();
  }

  async history(acc, n = 10) {
    return (await (await this.q('SELECT mode, brawler, outcome, trophies, kills, online, played FROM matches WHERE account_id = ? ORDER BY played DESC LIMIT ?', acc.id, n)).all()).results;
  }

  async leaderboard(n = 50) {
    const { results } = await (await this.q('SELECT id, name, trophies, login IS NOT NULL AS registered FROM accounts WHERE trophies > 0 AND login IS NOT NULL ORDER BY trophies DESC, updated ASC LIMIT ?', n)).all();
    return results.map((r) => ({ id: r.id, name: r.name, trophies: r.trophies, registered: !!r.registered }));
  }

  async rankOf(trophies) { return (await (await this.q('SELECT COUNT(*) + 1 AS r FROM accounts WHERE trophies > ?', trophies)).first()).r; }
  async accountCount() { return (await (await this.q('SELECT COUNT(*) AS n FROM accounts')).first()).n; }
}
