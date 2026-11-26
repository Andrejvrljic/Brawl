import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startServer } from '../server/app.js';

let app, base;
before(async () => { app = await startServer({ port: 0, dbPath: ':memory:', quiet: true }); base = `http://127.0.0.1:${app.port}`; });
after(async () => { await app.close(); });

async function api(method, url, body, token) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

test('Spiel wird ausgeliefert', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Kistenkrawall/);
});

test('Konto: Gast anlegen, Aktion, sichern, auf anderem Gerät anmelden', async () => {
  const g = await api('POST', '/api/guest', {});
  assert.equal(g.status, 200);
  const t1 = g.data.token;
  assert.equal(g.data.account.registered, false);

  const up = await api('POST', '/api/action', { type: 'upgrade', key: 'funke' }, t1);
  assert.equal(up.status, 200);
  assert.equal(up.data.profile.levels.funke, 2);

  const bad = await api('POST', '/api/action', { type: 'upgrade', key: 'heila' }, t1);
  assert.equal(bad.status, 400);

  assert.equal((await api('POST', '/api/action', { type: 'upgrade', key: 'funke' })).status, 401);

  const reg = await api('POST', '/api/register', { login: 'testheld', password: 'geheim123' }, t1);
  assert.equal(reg.status, 200);
  assert.equal(reg.data.account.registered, true);

  assert.equal((await api('POST', '/api/login', { login: 'testheld', password: 'falsch!!' })).status, 401);
  const li = await api('POST', '/api/login', { login: 'TESTHELD', password: 'geheim123' });
  assert.equal(li.status, 200);
  assert.notEqual(li.data.token, t1);
  assert.equal(li.data.profile.levels.funke, 2, 'gleicher Fortschritt auf dem zweiten Gerät');

  const dup = await api('POST', '/api/guest', {});
  assert.equal((await api('POST', '/api/register', { login: 'testheld', password: 'geheim123' }, dup.data.token)).status, 400);
});

test('Bot-Match-Ergebnis wird gutgeschrieben und gedrosselt', async () => {
  const { data } = await api('POST', '/api/guest', {});
  const result = { mode: 'teamko', winner: 0, mvp: 0, score: [10, 3], players: [{ id: 1, team: 0, brawler: 'funke', kills: 4, deaths: 1, rank: 1 }] };
  const r1 = await api('POST', '/api/action', { type: 'offline', result, you: 1 }, data.token);
  assert.equal(r1.status, 200);
  assert.equal(r1.data.profile.trophies.funke, 8);
  const r2 = await api('POST', '/api/action', { type: 'offline', result, you: 1 }, data.token);
  assert.equal(r2.status, 429);
  const lb = await api('GET', '/api/leaderboard');
  assert.ok(lb.data.top.some((p) => p.trophies === 8));
  const me = await api('GET', '/api/me', null, data.token);
  assert.equal(me.data.history.length, 1);
});

test('Online-Raum: Server nutzt den Brawler aus der Datenbank', async () => {
  const { data } = await api('POST', '/api/guest', {});
  await api('POST', '/api/action', { type: 'select', key: 'brocken' }, data.token);
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}`);
  const msgs = [];
  await new Promise((ok) => ws.on('open', ok));
  ws.on('message', (m) => msgs.push(JSON.parse(m)));
  // Client behauptet einen gesperrten Brawler auf Stufe 7 – der Server ignoriert das
  ws.send(JSON.stringify({ t: 'join', mode: 'teamko', create: true, token: data.token, brawler: 'heila', level: 7 }));
  await new Promise((ok) => setTimeout(ok, 300));
  ws.send(JSON.stringify({ t: 'startnow' }));
  await new Promise((ok) => setTimeout(ok, 400));
  const start = msgs.find((m) => m.t === 'start');
  assert.ok(start, 'Match gestartet');
  const me = start.roster.find((p) => p.id === start.you);
  assert.equal(me.brawler, 'brocken');
  assert.equal(me.level, 1);
  assert.equal(start.roster.length, 6);
  assert.ok(msgs.some((m) => m.t === 's'), 'Snapshots kommen an');
  ws.close();
});
