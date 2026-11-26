// Arena-Karte: Raster aus Kacheln. Eine Kachel = 1 Welteinheit.
// '.' Boden, '#' Kiste/Wand (blockiert Bewegung + Schüsse, zerstörbar),
// 'B' Busch (versteckt), 'W' Wasser (blockiert Bewegung, nicht Schüsse),
// 'S' Startpunkt (obere Hälfte = Team 1, gespiegelte Hälfte = Team 0)

const TOP = [
  'BBB.....#.......#....BB',
  'BB......#.S.S.S.#.....B',
  'B.......###...###.....B',
  '.......................',
  '..##.......BBB......##.',
  '..##.......BBB......##.',
  '......#..........#.....',
  'BBB...#...WWW....#..BBB',
  'BBB.......WWW.......BBB',
  '....###.........###....',
  '.......................',
  '..BB.....#####.....BB..',
  '..BB...............BB..',
  '#....BB.........BB....#',
  '#....BB...#.#...BB....#',
  '.......................',
];
const MID = 'BB....###.....###....BB';

export function buildMapRows() {
  const rows = [...TOP, MID];
  for (let i = TOP.length - 1; i >= 0; i--) rows.push(TOP[i].split('').reverse().join(''));
  return rows;
}

export class GameMap {
  constructor() {
    const rows = buildMapRows();
    this.h = rows.length;
    this.w = rows[0].length;
    this.grid = [];
    this.spawns = [[], []];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let c = rows[y][x] || '.';
        if (c === 'S') {
          this.spawns[y < this.h / 2 ? 1 : 0].push({ x: x + 0.5, y: y + 0.5 });
          c = '.';
        }
        this.grid.push(c);
      }
    }
    // Spawnpunkte so sortieren, dass der mittlere zuerst kommt
    for (const s of this.spawns) s.sort((a, b) => Math.abs(a.x - this.w / 2) - Math.abs(b.x - this.w / 2));
    const ffa = [[3, 3], [19, 3], [11, 10], [3, 29], [19, 29], [11, 22]];
    this.ffaSpawns = ffa.map(([x, y]) => this.findFree(x + 0.5, y + 0.5));
    this.center = { x: this.w / 2, y: this.h / 2 };
  }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  get(tx, ty) { return this.inside(tx, ty) ? this.grid[ty * this.w + tx] : '#'; }
  set(tx, ty, c) { if (this.inside(tx, ty)) this.grid[ty * this.w + tx] = c; }
  blocksMove(tx, ty) { const c = this.get(tx, ty); return c === '#' || c === 'W'; }
  blocksShot(tx, ty) { return this.get(tx, ty) === '#'; }
  isBushAt(x, y) { return this.get(Math.floor(x), Math.floor(y)) === 'B'; }

  // Kreis aus festen Kacheln herausschieben
  resolve(e, r) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r);
      const y0 = Math.floor(e.y - r), y1 = Math.floor(e.y + r);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!this.blocksMove(tx, ty)) continue;
          const cx = Math.max(tx, Math.min(e.x, tx + 1));
          const cy = Math.max(ty, Math.min(e.y, ty + 1));
          let dx = e.x - cx, dy = e.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            e.x += (dx / d) * (r - d);
            e.y += (dy / d) * (r - d);
          } else {
            // Mittelpunkt in der Kachel: zur nächsten Kante schieben
            const l = e.x - tx, rr = tx + 1 - e.x, t = e.y - ty, b = ty + 1 - e.y;
            const m = Math.min(l, rr, t, b);
            if (m === l) e.x = tx - r; else if (m === rr) e.x = tx + 1 + r;
            else if (m === t) e.y = ty - r; else e.y = ty + 1 + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  moveCircle(e, dx, dy, r) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
    for (let i = 0; i < steps; i++) {
      e.x += dx / steps;
      e.y += dy / steps;
      this.resolve(e, r);
    }
  }

  lineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 0.25);
    for (let i = 1; i < n; i++) {
      const x = x1 + (dx * i) / n, y = y1 + (dy * i) / n;
      if (this.blocksShot(Math.floor(x), Math.floor(y))) return false;
    }
    return true;
  }

  findFree(x, y) {
    let tx = Math.floor(x), ty = Math.floor(y);
    if (!this.blocksMove(tx, ty)) return { x, y };
    for (let rad = 1; rad < 10; rad++) {
      let best = null, bd = 1e9;
      for (let yy = ty - rad; yy <= ty + rad; yy++) {
        for (let xx = tx - rad; xx <= tx + rad; xx++) {
          if (!this.inside(xx, yy) || this.blocksMove(xx, yy)) continue;
          const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
          if (d < bd) { bd = d; best = { x: xx + 0.5, y: yy + 0.5 }; }
        }
      }
      if (best) return best;
    }
    return { x: this.w / 2, y: this.h / 2 };
  }

  // Breitensuche von einem Ziel aus -> Distanzfeld für Bot-Navigation
  distField(gx, gy) {
    const W = this.w, H = this.h;
    const dist = new Int16Array(W * H).fill(-1);
    const tx = Math.max(0, Math.min(W - 1, Math.floor(gx)));
    const ty = Math.max(0, Math.min(H - 1, Math.floor(gy)));
    const q = new Int16Array(W * H * 2);
    let qh = 0, qt = 0;
    dist[ty * W + tx] = 0;
    q[qt++] = tx; q[qt++] = ty;
    while (qh < qt) {
      const x = q[qh++], y = q[qh++];
      const d = dist[y * W + x];
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!this.inside(nx, ny) || this.blocksMove(nx, ny)) continue;
        const i = ny * W + nx;
        if (dist[i] !== -1) continue;
        dist[i] = d + 1;
        q[qt++] = nx; q[qt++] = ny;
      }
    }
    return dist;
  }

  // Nächste Richtung entlang des Distanzfelds
  stepDir(field, x, y) {
    const W = this.w;
    const tx = Math.floor(x), ty = Math.floor(y);
    const here = this.inside(tx, ty) ? field[ty * W + tx] : -1;
    let best = null, bd = here < 0 ? 1e9 : here;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (!this.inside(nx, ny)) continue;
        const v = field[ny * W + nx];
        if (v < 0) continue;
        if (dx && dy && (this.blocksMove(tx + dx, ty) || this.blocksMove(tx, ty + dy))) continue;
        const score = v + (dx && dy ? 0.4 : 0);
        if (score < bd) { bd = score; best = { x: nx + 0.5, y: ny + 0.5 }; }
      }
    }
    if (!best) return null;
    const ddx = best.x - x, ddy = best.y - y;
    const l = Math.hypot(ddx, ddy) || 1;
    return { x: ddx / l, y: ddy / l };
  }
}
