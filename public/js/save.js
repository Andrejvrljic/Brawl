// Spielstand: mit Server in der Datenbank, ohne Server (z. B. GitHub Pages) im Browser
import * as P from '../shared/progress.js';
import { BRAWLERS } from '../shared/brawlers.js';

const LOCAL_KEY = 'kistenkrawall_save_v1';
const TOKEN_KEY = 'kistenkrawall_token';

export const save = P.freshProfile();
export const account = { mode: 'local', registered: false, login: null, rank: null };
export const { ROAD, UPGRADE_COST } = P;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

function setProfile(p) {
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, P.normalize(p));
}
function persistLocal() { if (account.mode === 'local') ls.set(LOCAL_KEY, JSON.stringify(save)); }

function apiBase() {
  if (location.protocol === 'file:') return null;
  const q = new URLSearchParams(location.search).get('server');
  return q ? q.replace(/^ws/, 'http').replace(/\/$/, '') : '';
}

async function call(method, url, body) {
  const base = apiBase();
  if (base === null) throw new Error('kein Server');
  const headers = { 'Content-Type': 'application/json' };
  const token = ls.get(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('kein Server');
    const data = await res.json();
    if (!res.ok) { const e = new Error(data.error || 'Fehler'); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(to); }
}

function applyServer(data) {
  if (data.token) ls.set(TOKEN_KEY, data.token);
  if (data.profile) setProfile(data.profile);
  if (data.account) Object.assign(account, data.account, { mode: 'server' });
}

// Beim Start: Konto laden oder Gastkonto anlegen (alter Browser-Spielstand wird übernommen)
export async function initSave() {
  let local = null;
  try { local = JSON.parse(ls.get(LOCAL_KEY)); } catch { local = null; }
  try {
    if (ls.get(TOKEN_KEY)) {
      try { applyServer(await call('GET', '/api/me')); return; } catch (e) { if (e.status !== 401) throw e; ls.del(TOKEN_KEY); }
    }
    applyServer(await call('POST', '/api/guest', { import: local && local.stats ? local : null }));
  } catch {
    account.mode = 'local';
    setProfile(local);
  }
}

// Aktion ausführen (Server prüft und speichert in der Datenbank)
export async function act(a) {
  if (account.mode === 'server') {
    try {
      const d = await call('POST', '/api/action', a);
      applyServer(d);
      return d.result;
    } catch (e) { return { error: e.message }; }
  }
  const r = P.runAction(save, a);
  persistLocal();
  return r;
}

// Belohnung für ein Match
export async function reportMatch(result, you, { online, server } = {}) {
  if (server && server.reward) { applyServer(server); return server.reward; }
  if (account.mode === 'server') {
    if (online) return null; // Online ohne Belohnung (z. B. Verbindung abgebrochen)
    const r = await act({ type: 'offline', result, you });
    return r && !r.error ? r : null;
  }
  const r = P.applyMatch(save, result, you);
  persistLocal();
  return r;
}

export async function register(login, password) {
  try { applyServer(await call('POST', '/api/register', { login, password })); return null; } catch (e) { return e.message; }
}
export async function login(loginName, password) {
  try { applyServer(await call('POST', '/api/login', { login: loginName, password })); return null; } catch (e) { return e.message; }
}
export async function logout() {
  try { await call('POST', '/api/logout'); } catch { /* egal */ }
  ls.del(TOKEN_KEY);
  ls.del(LOCAL_KEY);
  Object.assign(account, { registered: false, login: null, rank: null });
  await initSave();
}
export async function leaderboard() { return (await call('GET', '/api/leaderboard')).top; }
export const token = () => (account.mode === 'server' ? ls.get(TOKEN_KEY) : null);

export const totalTrophies = () => P.totalTrophies(save);
export const roadAvailable = () => P.roadAvailable(save);
export const isUnlocked = (k) => save.unlocked.includes(k);
export { BRAWLERS };
