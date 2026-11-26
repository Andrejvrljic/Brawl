import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/app.js';

// TEST_URL=https://… prüft einen laufenden Server (z. B. Cloudflare), sonst startet ein lokaler Testserver.
// Testkonten beginnen mit „kktest“ und werden nach dem Live-Test wieder gelöscht.
let app, base, wsBase;
before(async () => {
  if (process.env.TEST_URL) base = process.env.TEST_URL.replace(/\/$/, '');
  else {
    process.env.ADMIN_NAMES = 'Dinnerboneagg';
    process.env.ADMIN_CODE = 'TestCode123';
    app = await startServer({ port: 0, dbPath: ':memory:', quiet: true });
    base = `http://127.0.0.1:${app.port}`;
  }
  wsBase = base.replace(/^http/, 'ws');
});
const sockets = [];
after(async () => {
  for (const ws of sockets) { try { ws.terminate(); } catch { /* egal */ } }
  if (app) await app.close();
});

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
  sockets.push(ws);
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
  assert.match(await res.text(), /Brawl Engine/);
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

// Nur lokal: der echte Admin-Code ist geheim
test('Admin: nur mit Admin-Konto und Code; geben, sperren, Nachricht an alle', { skip: !!process.env.TEST_URL }, async () => {
  const adm = await api('POST', '/api/signup', { login: 'Dinnerboneagg', password: 'geheim123' });
  assert.equal(adm.status, 200);
  assert.equal(adm.data.account.admin, true);
  const P = await signup();
  const a = await socket(), p = await socket();
  a.send({ t: 'auth', token: adm.data.token });
  p.send({ t: 'auth', token: P.token });
  await a.wait((m) => m.t === 'friends');
  await p.wait((m) => m.t === 'friends');
  let req = 0;
  const admin = async (sock, m) => { const id = ++req; sock.send({ t: 'admin', req: id, ...m }); return sock.wait((x) => x.t === 'adminRes' && x.req === id); };

  assert.match((await admin(p, { code: 'TestCode123', action: 'check' })).error, /Kein Admin/);
  assert.match((await admin(a, { code: 'falsch', action: 'check' })).error, /Falscher/);
  const chk = await admin(a, { code: 'TestCode123', action: 'check' });
  assert.ok(chk.stats.accounts >= 2);

  const give = await admin(a, { code: 'TestCode123', action: 'give', login: P.login, coins: 500, gems: 30, boxes: 2 });
  assert.equal(give.player.coins, 550);
  await p.wait((m) => m.t === 'profileUpdate');
  const un = await admin(a, { code: 'TestCode123', action: 'unlockAll', login: P.login });
  assert.equal(un.player.unlocked.length, 8);
  const tr = await admin(a, { code: 'TestCode123', action: 'trophies', login: P.login, brawler: 'pfeil', value: 120 });
  assert.equal(tr.player.trophies.pfeil, 120);

  await admin(a, { code: 'TestCode123', action: 'announce', text: 'Hallo zusammen!' });
  assert.equal((await p.wait((m) => m.t === 'announce')).text, 'Hallo zusammen!');

  assert.match((await admin(a, { code: 'TestCode123', action: 'ban', login: 'Dinnerboneagg', on: true })).error, /Admins/);
  await admin(a, { code: 'TestCode123', action: 'ban', login: P.login, on: true });
  await p.wait((m) => m.t === 'kicked');
  assert.equal((await api('POST', '/api/login', { login: P.login, password: 'geheim123' })).status, 403);
  assert.equal((await api('GET', '/api/me', null, P.token)).status, 401);
  await admin(a, { code: 'TestCode123', action: 'ban', login: P.login, on: false });
  assert.equal((await api('POST', '/api/login', { login: P.login, password: 'geheim123' })).status, 200);
  a.close(); p.close();
});

test('Admin+: Übersicht, Suche, Event, Wartung, Nachricht des Tages, Geschenk an alle, Kräfte im Match, Protokoll', { skip: !!process.env.TEST_URL }, async () => {
  const adm = await api('POST', '/api/login', { login: 'Dinnerboneagg', password: 'geheim123' });
  assert.equal(adm.status, 200);
  const P = await signup();
  const a = await socket(), p = await socket();
  a.send({ t: 'auth', token: adm.data.token }); p.send({ t: 'auth', token: P.token });
  await a.wait((m) => m.t === 'friends'); await p.wait((m) => m.t === 'friends');
  let req = 100;
  const admin = async (m) => { const id = ++req; a.send({ t: 'admin', req: id, code: 'TestCode123', ...m }); return a.wait((x) => x.t === 'adminRes' && x.req === id); };

  const ov = await admin({ action: 'overview' });
  assert.ok(ov.online.some((o) => o.login === P.login));
  const se = await admin({ action: 'search', q: P.login.slice(0, 8) });
  assert.ok(se.list.some((x) => x.login === P.login));

  for (const [m, check] of [
    [{ action: 'rename', name: 'Neu' }, (r) => r.player.name === 'Neu'],
    [{ action: 'level', brawler: 'funke', value: 5 }, (r) => r.player.levels.funke === 5],
    [{ action: 'skinsAll' }, (r) => r.player.skins.funke.length === 3],
  ]) assert.ok(check(await admin({ ...m, login: P.login })), JSON.stringify(m));

  // Event: doppelte Belohnungen
  await admin({ action: 'event', minutes: 30 });
  const me = await api('GET', '/api/me', null, P.token);
  assert.equal(me.data.news.event.boost, 2);
  const result = { mode: 'teamko', winner: 0, mvp: 0, players: [{ id: 1, team: 0, brawler: 'funke', kills: 0, rank: 1 }] };
  const off = await api('POST', '/api/action', { type: 'offline', result, you: 1 }, P.token);
  assert.equal(off.data.result.troph, 16, 'doppelte Trophäen');
  await admin({ action: 'event', minutes: 0 });

  // Nachricht des Tages
  await admin({ action: 'motd', text: 'Willkommen!' });
  assert.equal((await api('GET', '/api/news')).data.motd, 'Willkommen!');

  // Wartung: normale Spieler kommen nicht in Räume
  await admin({ action: 'maintenance', on: true, text: 'Kurze Pause' });
  const gp = await socket();
  gp.send({ t: 'join', create: true, token: P.token });
  assert.match((await gp.wait((m) => m.t === 'error')).msg, /Kurze Pause/);
  await admin({ action: 'maintenance', on: false });

  // Geschenk an alle
  const before = (await api('GET', '/api/me', null, P.token)).data.profile.gems;
  await admin({ action: 'giveAll', gems: 7 });
  assert.equal((await api('GET', '/api/me', null, P.token)).data.profile.gems, before + 7);

  // Kräfte im Match
  const ga = await socket();
  ga.send({ t: 'join', mode: 'teamko', create: true, token: adm.data.token });
  await ga.wait((m) => m.t === 'lobby');
  ga.send({ t: 'startnow' });
  await ga.wait((m) => m.t === 'start');
  assert.ok((await admin({ action: 'match', power: 'god' })).powers.god);
  assert.ok((await admin({ action: 'match', power: 'speed' })).powers.speed);
  await new Promise((r) => setTimeout(r, 3200)); // Countdown
  assert.match((await admin({ action: 'match', power: 'nuke' })).ok, /Gegner besiegt/);
  await admin({ action: 'match', power: 'win' });
  const end = await ga.wait((m) => m.t === 'end');
  assert.ok(end.reward && end.reward.outcome === 'win');

  // Passwort zurücksetzen, Konto löschen, Protokoll
  await admin({ action: 'password', login: P.login, password: 'neuesPW1' });
  assert.equal((await api('POST', '/api/login', { login: P.login, password: 'neuesPW1' })).status, 200);
  assert.ok((await admin({ action: 'delete', login: P.login })).deleted);
  assert.equal((await api('POST', '/api/login', { login: P.login, password: 'neuesPW1' })).status, 401);
  const lg = await admin({ action: 'log' });
  assert.ok(lg.log.length >= 8);
});
