import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../public/shared/progress.js';

test('normalize repariert kaputte oder manipulierte Spielstände', () => {
  const p = P.normalize({ coins: -5, gems: 'x', unlocked: ['heila', 'gibtsnicht'], levels: { funke: 99 }, selected: 'gibtsnicht', skins: { funke: [0, 7] } });
  assert.equal(p.coins, 0);
  assert.equal(p.levels.funke, 7);
  assert.deepEqual(p.unlocked.sort(), ['brocken', 'funke', 'heila']);
  assert.ok(p.unlocked.includes(p.selected));
  assert.deepEqual(p.skins.funke, [0, 2]);
});

test('Aufwerten kostet Münzen und geht nur bei freigeschalteten Brawlern', () => {
  const p = P.freshProfile();
  assert.equal(P.upgrade(p, 'pfeil'), null);
  assert.deepEqual(P.upgrade(p, 'funke'), { level: 2 });
  assert.equal(p.coins, 10);
  assert.equal(P.upgrade(p, 'funke'), null);
});

test('Sieg gibt Trophäen, Münzen und Kisten-Fortschritt', () => {
  const p = P.freshProfile();
  const result = { mode: 'teamko', winner: 0, mvp: 1, players: [{ id: 1, team: 0, brawler: 'funke', kills: 3, rank: 1 }] };
  const r = P.applyMatch(p, result, 1);
  assert.equal(r.outcome, 'win');
  assert.equal(p.trophies.funke, 9);
  assert.equal(p.coins, 50 + 25 + 10 + 9);
  assert.equal(p.boxMeter, 35);
});

test('Trophäenstraße schaltet Brawler frei, aber nur einmal', () => {
  const p = P.freshProfile();
  p.trophies.funke = 30;
  const i = P.ROAD.findIndex((r) => r.type === 'brawler' && r.key === 'pfeil');
  assert.ok(P.claimRoad(p, i));
  assert.ok(p.unlocked.includes('pfeil'));
  assert.equal(P.claimRoad(p, i), null);
});

test('Kiste öffnen gibt Münzen', () => {
  const p = P.freshProfile();
  const before = p.coins;
  const r = P.openBox(p);
  assert.ok(r.items.length >= 1);
  assert.ok(p.coins > before);
  assert.equal(p.boxes, 0);
  assert.equal(P.openBox(p), null);
});
