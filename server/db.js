// Datenbank (SQLite, in Node eingebaut): Konten, Sitzungen, Spielfortschritt, Rangliste
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { freshProfile, normalize, totalTrophies } from '../public/shared/progress.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Database {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        login        TEXT UNIQUE COLLATE NOCASE,
        pass         TEXT,
        name         TEXT NOT NULL,
        profile      TEXT NOT NULL,
        trophies     INTEGER NOT NULL DEFAULT 0,
        created      INTEGER NOT NULL,
        updated      INTEGER NOT NULL,
        last_offline INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created    INTEGER NOT NULL,
        last_used  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        mode       TEXT NOT NULL,
        brawler    TEXT NOT NULL,
        outcome    TEXT NOT NULL,
        trophies   INTEGER NOT NULL,
        kills      INTEGER NOT NULL,
        online     INTEGER NOT NULL,
        played     INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS friends (
        a         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        b         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        requester INTEGER NOT NULL,
        status    TEXT NOT NULL,
        created   INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_b ON friends(b);
      CREATE INDEX IF NOT EXISTS idx_accounts_trophies ON accounts(trophies DESC);
      CREATE INDEX IF NOT EXISTS idx_matches_account ON matches(account_id, played DESC);
    `);
    const q = (sql) => this.db.prepare(sql);
    this.q = {
      insertAcc: q('INSERT INTO accounts (name, profile, trophies, created, updated) VALUES (?, ?, ?, ?, ?)'),
      getAcc: q('SELECT * FROM accounts WHERE id = ?'),
      getByLogin: q('SELECT * FROM accounts WHERE login = ?'),
      saveAcc: q('UPDATE accounts SET name = ?, profile = ?, trophies = ?, updated = ? WHERE id = ?'),
      setLogin: q('UPDATE accounts SET login = ?, pass = ?, updated = ? WHERE id = ?'),
      setOffline: q('UPDATE accounts SET last_offline = ? WHERE id = ?'),
      insertSess: q('INSERT INTO sessions (token_hash, account_id, created, last_used) VALUES (?, ?, ?, ?)'),
      getSess: q('SELECT account_id FROM sessions WHERE token_hash = ?'),
      touchSess: q('UPDATE sessions SET last_used = ? WHERE token_hash = ?'),
      delSess: q('DELETE FROM sessions WHERE token_hash = ?'),
      top: q('SELECT id, name, trophies, login IS NOT NULL AS registered FROM accounts WHERE trophies > 0 AND login IS NOT NULL ORDER BY trophies DESC, updated ASC LIMIT ?'),
      insertReg: q('INSERT INTO accounts (login, pass, name, profile, trophies, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?)'),
      friendGet: q('SELECT * FROM friends WHERE a = ? AND b = ?'),
      friendIns: q('INSERT INTO friends (a, b, requester, status, created) VALUES (?, ?, ?, ?, ?)'),
      friendAcc: q("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?"),
      friendDel: q('DELETE FROM friends WHERE a = ? AND b = ?'),
      friendCount: q('SELECT COUNT(*) AS n FROM friends WHERE a = ? OR b = ?'),
      friendList: q(`SELECT f.requester, f.status, acc.id, acc.name, acc.login, acc.trophies FROM friends f
        JOIN accounts acc ON acc.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
        WHERE f.a = ? OR f.b = ? ORDER BY acc.name COLLATE NOCASE`),
      rank: q('SELECT COUNT(*) + 1 AS r FROM accounts WHERE trophies > ?'),
      insertMatch: q('INSERT INTO matches (account_id, mode, brawler, outcome, trophies, kills, online, played) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      history: q('SELECT mode, brawler, outcome, trophies, kills, online, played FROM matches WHERE account_id = ? ORDER BY played DESC LIMIT ?'),
      count: q('SELECT COUNT(*) AS n FROM accounts'),
    };
  }

  // ---------- Konten ----------
  createGuest(importProfile) {
    const p = importProfile ? normalize(importProfile) : freshProfile();
    const now = Date.now();
    const r = this.q.insertAcc.run(p.name, JSON.stringify(p), totalTrophies(p), now, now);
    const id = Number(r.lastInsertRowid);
    return { id, token: this.newSession(id) };
  }

  newSession(id) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    this.q.insertSess.run(sha(token), id, now, now);
    return token;
  }

  byToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const h = sha(token);
    const s = this.q.getSess.get(h);
    if (!s) return null;
    this.q.touchSess.run(Date.now(), h);
    return this.account(s.account_id);
  }

  account(id) {
    const row = this.q.getAcc.get(id);
    if (!row) return null;
    return { id: row.id, login: row.login, registered: !!row.login, profile: normalize(JSON.parse(row.profile)), lastOffline: row.last_offline };
  }

  save(acc) {
    const p = acc.profile;
    this.q.saveAcc.run(p.name, JSON.stringify(p), totalTrophies(p), Date.now(), acc.id);
  }

  logout(token) { if (typeof token === 'string') this.q.delSess.run(sha(token)); }

  // Neues Konto direkt mit Benutzername + Passwort
  createAccount(login, password) {
    const err = checkLogin(login, password);
    if (err) return { error: err };
    if (this.q.getByLogin.get(login)) return { error: 'Dieser Benutzername ist schon vergeben.' };
    const p = freshProfile();
    p.name = login.slice(0, 14);
    const now = Date.now();
    const r = this.q.insertReg.run(login, hashPassword(password), p.name, JSON.stringify(p), now, now);
    const id = Number(r.lastInsertRowid);
    return { id, token: this.newSession(id) };
  }

  // ---------- Freunde ----------
  friends(id) {
    return this.q.friendList.all(id, id, id).map((r) => ({
      id: r.id, name: r.name, login: r.login, trophies: r.trophies,
      status: r.status === 'accepted' ? 'friend' : (r.requester === id ? 'outgoing' : 'incoming'),
    }));
  }
  areFriends(x, y) { const [a, b] = x < y ? [x, y] : [y, x]; const f = this.q.friendGet.get(a, b); return !!f && f.status === 'accepted'; }
  friendRequest(id, login) {
    const other = typeof login === 'string' ? this.q.getByLogin.get(login.trim()) : null;
    if (!other) return { error: 'Diesen Benutzernamen gibt es nicht.' };
    if (other.id === id) return { error: 'Du kannst dich nicht selbst hinzufügen.' };
    const [a, b] = id < other.id ? [id, other.id] : [other.id, id];
    const f = this.q.friendGet.get(a, b);
    if (f && f.status === 'accepted') return { error: 'Ihr seid schon Freunde.' };
    if (f && f.requester === id) return { error: 'Anfrage wurde schon gesendet.' };
    if (f) { this.q.friendAcc.run(a, b); return { ok: true, other: other.id, accepted: true }; } // Gegenanfrage = annehmen
    if (this.q.friendCount.get(id, id).n >= 100) return { error: 'Maximal 100 Freunde.' };
    this.q.friendIns.run(a, b, id, 'pending', Date.now());
    return { ok: true, other: other.id };
  }
  friendRespond(id, otherId, accept) {
    const [a, b] = id < otherId ? [id, otherId] : [otherId, id];
    const f = this.q.friendGet.get(a, b);
    if (!f || f.status !== 'pending' || f.requester === id) return { error: 'Keine offene Anfrage.' };
    if (accept) this.q.friendAcc.run(a, b); else this.q.friendDel.run(a, b);
    return { ok: true };
  }
  friendRemove(id, otherId) {
    const [a, b] = id < otherId ? [id, otherId] : [otherId, id];
    this.q.friendDel.run(a, b);
    return { ok: true };
  }

  // Gastkonto mit Login + Passwort sichern (alte Gastkonten)
  register(acc, login, password) {
    const err = checkLogin(login, password);
    if (err) return { error: err };
    if (acc.registered) return { error: 'Dieses Konto ist schon gesichert.' };
    if (this.q.getByLogin.get(login)) return { error: 'Dieser Benutzername ist schon vergeben.' };
    this.q.setLogin.run(login, hashPassword(password), Date.now(), acc.id);
    return { ok: true };
  }

  login(login, password) {
    if (typeof login !== 'string' || typeof password !== 'string') return null;
    const row = this.q.getByLogin.get(login.trim());
    if (!row || !verifyPassword(password, row.pass)) return null;
    return { id: row.id, token: this.newSession(row.id) };
  }

  setOffline(acc, t) { this.q.setOffline.run(t, acc.id); acc.lastOffline = t; }

  // ---------- Spiele & Rangliste ----------
  recordMatch(acc, mode, brawler, reward, kills, online) {
    this.q.insertMatch.run(acc.id, mode, brawler, reward.outcome, reward.troph, kills | 0, online ? 1 : 0, Date.now());
  }
  history(acc, n = 10) { return this.q.history.all(acc.id, n); }
  leaderboard(n = 50) { return this.q.top.all(n).map((r) => ({ id: r.id, name: r.name, trophies: r.trophies, registered: !!r.registered })); }
  rankOf(trophies) { return this.q.rank.get(trophies).r; }
  accountCount() { return this.q.count.get().n; }
  close() { this.db.close(); }
}

function checkLogin(login, password) {
  if (typeof login !== 'string' || !/^[A-Za-z0-9_äöüÄÖÜß.-]{3,20}$/.test(login)) return 'Benutzername: 3–20 Zeichen (Buchstaben, Zahlen, _ . -).';
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) return 'Passwort: mindestens 6 Zeichen.';
  return null;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}

function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
