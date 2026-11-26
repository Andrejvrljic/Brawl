import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/app.js';

// TEST_URL=https://… prüft einen laufenden Server (z. B. Cloudflare), sonst startet ein lokaler Testserver.
// Testkonten beginnen mit „kktest“ und werden nach dem Live-Test wieder gelöscht.
let app, base, wsBase;
before(async () => {
  if (process.env.TEST_URL) base = process.env.TEST_URL.replace(/\/$/, '');
  else { app = await startServer({ port: 0, dbPath: ':memory:', quiet: true }); base = `http://127.0.0.1:${app.port}`; }
  wsBase = base.replace(/^http/, 'ws');
});
after(async () => { if (app) await app.close(); });

const rnd = () => Math.random().toString(36).slice(2, 9);
const newLogin = () => 'kktest' + rnd();

async function api(method, url, body, token) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
async function signup() {
  const login = newLogin();
  const r = await api('POST', '/api/signup', { login, password: 'geheim123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { login, token: r.data.token, data: r.data };
}

// Kleine WebSocket-Hilfe: wartet auf bestimmte Nachrichten
async function socket() {
  const ws = new WebSocket(wsBase);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    msgs.push(m);
    for (const w of [...waiters]) if (w.fn(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); }
  });
  await new Promise((ok, fail) => { ws.on('open', ok); ws.on('error', fail); });
  return {
    ws, msgs,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (fn, ms = 5000) => new Promise((ok, fail) => {
      const hit = msgs.find(fn);
      if (hit) { msgs.splice(msgs.indexOf(hit), 1); return ok(hit); }
      const w = { fn, ok: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); ok(m); } };
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); fail(new Error('Zeitüberschreitung')); }, ms);
      waiters.push(w);
    }),
    close: () => ws.close(),
  };
}

test('Spiel wird ausgeliefert', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Kistenkrawall/);
});

test('Ohne Konto kein Spiel: keine Gastkonten, keine Aktionen, kein Online-Raum', async () => {
  assert.equal((await api('POST', '/api/guest', {})).status, 410);
  assert.equal((await api('POST', '/api/action', { type: 'upgrade', key: 'funke' })).status, 401);
  const s = await socket();
  s.send({ t: 'join', mode: 'teamko', create: true });
  const e = await s.wait((m) => m.t === 'error');
  assert.match(e.msg, /melde dich an/);
  s.close();
});

test('Konto erstellen, Aktion, auf anderem Gerät anmelden', async () => {
  const { login, token, data } = await signup();
  assert.equal(data.account.registered, true);
  assert.equal(data.profile.name, login.slice(0, 14));

  const up = await api('POST', '/api/action', { type: 'upgrade', key: 'funke' }, token);
  assert.equal(up.status, 200);
  assert.equal(up.data.profile.levels.funke, 2);
  assert.equal((await api('POST', '/api/action', { type: 'upgrade', key: 'heila' }, token)).status, 400);

  assert.equal((await api('POST', '/api/signup', { login, password: 'anderes1' })).status, 400, 'Name doppelt');
  assert.equal((await api('POST', '/api/signup', { login: 'ab', password: 'geheim123' })).status, 400, 'Name zu kurz');
  assert.equal((await api('POST', '/api/signup', { login: newLogin(), password: '123' })).status, 400, 'Passwort zu kurz');

  assert.equal((await api('POST', '/api/login', { login, password: 'falsch!!' })).status, 401);
  const li = await api('POST', '/api/login', { login: login.toUpperCase(), password: 'geheim123' });
  assert.equal(li.status, 200);
  assert.notEqual(li.data.token, token);
  assert.equal(li.data.profile.levels.funke, 2, 'gleicher Fortschritt auf dem zweiten Gerät');
});

test('Bot-Match-Ergebnis wird gutgeschrieben und gedrosselt', async () => {
  const { token } = await signup();
  const result = { mode: 'teamko', winner: 0, mvp: 0, score: [10, 3], players: [{ id: 1, team: 0, brawler: 'funke', kills: 4, deaths: 1, rank: 1 }] };
  const r1 = await api('POST', '/api/action', { type: 'offline', result, you: 1 }, token);
  assert.equal(r1.status, 200);
  assert.equal(r1.data.profile.trophies.funke, 8);
  assert.equal((await api('POST', '/api/action', { type: 'offline', result, you: 1 }, token)).status, 429);
  const me = await api('GET', '/api/me', null, token);
  assert.equal(me.data.history.length, 1);
});

test('Freunde: Anfrage, Annehmen, Online-Status, Einladung, gemeinsamer Raum im selben Team', async () => {
  const A = await signup(), B = await signup();
  const a = await socket(), b = await socket();
  a.send({ t: 'auth', token: A.token });
  b.send({ t: 'auth', token: B.token });
  await a.wait((m) => m.t === 'friends');
  await b.wait((m) => m.t === 'friends');

  // A schickt B eine Anfrage
  a.send({ t: 'friendAdd', login: 'gibtsnicht' + rnd() });
  assert.ok((await a.wait((m) => m.t === 'friendMsg')).error);
  a.send({ t: 'friendAdd', login: B.login });
  assert.ok((await a.wait((m) => m.t === 'friendMsg')).ok);
  const req = await b.wait((m) => m.t === 'friendRequest');
  assert.equal(req.from.name, A.login.slice(0, 14));
  const inc = await b.wait((m) => m.t === 'friends' && m.list.some((f) => f.status === 'incoming'));
  const aId = inc.list[0].id;

  // B nimmt an -> beide sehen sich als Freunde und online
  b.send({ t: 'friendAnswer', id: aId, accept: true });
  const la = await a.wait((m) => m.t === 'friends' && m.list.some((f) => f.status === 'friend'));
  assert.equal(la.list[0].online, 'online');
  const bId = la.list[0].id;

  // A erstellt einen privaten Raum und lädt B ein
  const ga = await socket();
  ga.send({ t: 'join', mode: 'teamko', create: true, token: A.token });
  const lobby = await ga.wait((m) => m.t === 'lobby' && m.code);
  assert.equal(lobby.together, true);
  a.send({ t: 'invite', to: bId, code: lobby.code });
  const inv = await b.wait((m) => m.t === 'invited');
  assert.equal(inv.code, lobby.code);

  // B tritt bei, A startet -> beide im selben Team
  const gb = await socket();
  gb.send({ t: 'join', code: inv.code, token: B.token });
  await ga.wait((m) => m.t === 'lobby' && m.players.length === 2);
  ga.send({ t: 'startnow' });
  const sa = await ga.wait((m) => m.t === 'start');
  const sb = await gb.wait((m) => m.t === 'start');
  const teamOf = (s) => s.roster.find((p) => p.id === s.you).team;
  assert.equal(teamOf(sa), teamOf(sb), 'Freunde spielen zusammen');
  assert.equal(sa.roster.length, 6);
  const meA = sa.roster.find((p) => p.id === sa.you);
  assert.equal(meA.brawler, 'funke', 'Brawler kommt aus der Datenbank');

  // Freund entfernen
  b.send({ t: 'friendRemove', id: aId });
  await a.wait((m) => m.t === 'friends' && m.list.length === 0);
  for (const s of [a, b, ga, gb]) s.close();
});
