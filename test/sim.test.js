import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, MODES } from '../public/shared/game.js';
import { buildMapRows } from '../public/shared/map.js';
import { BRAWLERS, BRAWLER_ORDER } from '../public/shared/brawlers.js';

test('Karte ist rechteckig und punktsymmetrisch', () => {
  const rows = buildMapRows();
  assert.equal(rows.length, 33);
  for (const r of rows) assert.equal(r.length, 23);
  for (let y = 0; y < rows.length; y++) assert.equal(rows[y], rows[rows.length - 1 - y].split('').reverse().join(''));
});

for (const mode of Object.keys(MODES)) {
  test(`Bot-Match im Modus ${mode} endet mit gültigem Ergebnis`, () => {
    const g = new Game(mode);
    g.fillBots(2);
    let steps = 0;
    while (!g.over && steps < 30 * 200) { g.step(1 / 30); g.drainEvents(); steps++; }
    assert.ok(g.over, 'Match ist zu Ende');
    assert.equal(g.result.players.length, 6);
    assert.ok(g.result.winner >= -1 && g.result.winner < MODES[mode].teams);
    for (const p of g.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
}

test('Jeder Brawler kann angreifen und seine Super einsetzen', () => {
  for (const k of BRAWLER_ORDER) {
    const g = new Game('teamko');
    const a = g.addPlayer({ name: 'A', brawler: k, team: 0 });
    const b = g.addPlayer({ name: 'B', brawler: 'brocken', team: 1 });
    b.x = a.x; b.y = a.y - 2;
    g.time = 5; g.phase = 'play';
    g.queueAction(a.id, 'atk', 0, -1, 2);
    for (let i = 0; i < 40; i++) g.step(1 / 30);
    a.superCharge = 1;
    g.queueAction(a.id, 'sup', 0, -1, 2);
    g.step(1 / 30);
    assert.equal(a.superCharge, 0, `${BRAWLERS[k].name}: Super wurde ausgelöst`);
  }
});
