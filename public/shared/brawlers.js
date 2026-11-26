// Brawler-Definitionen. Jeder Brawler hat einen eigenen Angriff und eine eigene Super.
// aim: 'line' | 'cone' | 'lob' | 'self' | 'circle' – bestimmt die Zielanzeige.

export const MAX_LEVEL = 7;
export const levelMult = (lvl) => 1 + 0.08 * (Math.max(1, Math.min(MAX_LEVEL, lvl | 0)) - 1);

const A = (ax, ay) => Math.atan2(ay, ax);

export const BRAWLERS = {
  funke: {
    key: 'funke', name: 'Funke', role: 'Allrounder', unlock: 0,
    desc: 'Feuert einen Schwarm aus 4 Energiekugeln. Super: Turbo-Sprint – rast nach vorne, ist dabei unverwundbar und rammt Gegner weg.',
    attackName: 'Kugelschwarm', superName: 'Turbo-Sprint',
    hp: 3400, speed: 3.5, reload: 1.3, ammo: 3, range: 7, projSpeed: 15, superPerHit: 0.065,
    aim: 'cone', aimWidth: 0.22, superAim: 'line', superRange: 5.5,
    colors: [['#ff8a2a', '#2b2d42', '#ffd6a5'], ['#ffd23f', '#8a5a00', '#fff1c1'], ['#3a3d5c', '#ff2e63', '#c9c9ff']],
    attack(g, p, a) {
      const base = A(a.ax, a.ay);
      for (let i = 0; i < 4; i++) {
        const off = -0.2 + (0.4 * i) / 3;
        g.bullet(p, base + off, { k: 'pellet', speed: 15, range: 7, dmg: 360, rad: 0.15 });
      }
    },
    super(g, p, a) { g.dash(p, A(a.ax, a.ay), 5.5, 0.35, 950); },
  },
  brocken: {
    key: 'brocken', name: 'Brocken', role: 'Panzer', unlock: 0,
    desc: 'Haut mit riesigen Fäusten alles im Halbkreis vor sich um. Super: Erdbeben-Sprung – springt über Wände, zertrümmert Kisten und schleudert Gegner weg.',
    attackName: 'Doppelfaust', superName: 'Erdbeben-Sprung',
    hp: 6000, speed: 3.3, reload: 1.0, ammo: 3, range: 2.4, projSpeed: 99, superPerHit: 0.25,
    aim: 'cone', aimWidth: 0.9, superAim: 'circle', superRange: 7, superRadius: 2.4,
    colors: [['#8d6e63', '#3e2723', '#d7ccc8'], ['#607d8b', '#ffca28', '#cfd8dc'], ['#4a148c', '#00e5ff', '#e1bee7']],
    attack(g, p, a) { g.cone(p, A(a.ax, a.ay), 0.9, 2.4, { dmg: 1150, k: 'punch', knock: 0.6 }); },
    super(g, p, a) { g.leap(p, a, 7, { dmg: 1600, r: 2.4, destroy: 1.6, knock: 2.2 }); },
  },
  pfeil: {
    key: 'pfeil', name: 'Pfeil', role: 'Scharfschütze', unlock: 30,
    desc: 'Schießt einen schnellen Pfeil über riesige Distanz. Super: Pfeilhagel – 5 Pfeile, die durch alle Gegner fliegen.',
    attackName: 'Präzisionspfeil', superName: 'Pfeilhagel',
    hp: 2500, speed: 3.2, reload: 1.9, ammo: 3, range: 11, projSpeed: 22, superPerHit: 0.34,
    aim: 'line', aimWidth: 0.18, superAim: 'cone', superRange: 12, superWidth: 0.3,
    colors: [['#4caf50', '#1b5e20', '#f1e0c5'], ['#ffffff', '#1565c0', '#ffe0b2'], ['#212121', '#76ff03', '#bdbdbd']],
    attack(g, p, a) { g.bullet(p, A(a.ax, a.ay), { k: 'arrow', speed: 22, range: 11, dmg: 1350, rad: 0.18 }); },
    super(g, p, a) {
      const base = A(a.ax, a.ay);
      for (let i = 0; i < 5; i++) g.bullet(p, base - 0.3 + 0.15 * i, { k: 'arrow', speed: 22, range: 12, dmg: 1100, rad: 0.2, pierce: true, sup: true });
    },
  },
  bummi: {
    key: 'bummi', name: 'Bummi', role: 'Werfer', unlock: 60,
    desc: 'Wirft Bomben im Bogen über Wände hinweg. Super: Mega-Bombe – riesige Explosion, die sogar Kisten sprengt.',
    attackName: 'Bogenbombe', superName: 'Mega-Bombe',
    hp: 2700, speed: 3.1, reload: 1.7, ammo: 3, range: 8, projSpeed: 9, superPerHit: 0.25,
    aim: 'lob', aimRadius: 1.5, superAim: 'lob', superRange: 8, superRadius: 2.8,
    colors: [['#fdd835', '#d84315', '#fff59d'], ['#00bfa5', '#004d40', '#b2dfdb'], ['#e91e63', '#311b92', '#f8bbd0']],
    attack(g, p, a) { g.lob(p, a, { k: 'bomb', range: 8, dur: 0.75, aoe: 1.5, dmg: 1050 }); },
    super(g, p, a) { g.lob(p, a, { k: 'megabomb', range: 8, dur: 1.0, aoe: 2.8, dmg: 2200, destroy: 2.2, sup: true }); },
  },
  frost: {
    key: 'frost', name: 'Frost', role: 'Kontrolle', unlock: 100,
    desc: 'Eissplitter durchbohren Gegner und verlangsamen sie. Super: Eissturm – friert alle Gegner in der Nähe ein.',
    attackName: 'Eissplitter', superName: 'Eissturm',
    hp: 3000, speed: 3.3, reload: 1.4, ammo: 3, range: 9, projSpeed: 17, superPerHit: 0.3,
    aim: 'line', aimWidth: 0.25, superAim: 'self', superRange: 0, superRadius: 4,
    colors: [['#81d4fa', '#01579b', '#e1f5fe'], ['#b39ddb', '#4527a0', '#ede7f6'], ['#eceff1', '#00acc1', '#ffffff']],
    attack(g, p, a) { g.bullet(p, A(a.ax, a.ay), { k: 'ice', speed: 17, range: 9, dmg: 950, rad: 0.22, pierce: true, slow: { f: 0.55, dur: 1.6 } }); },
    super(g, p) { g.aoe(p, p.x, p.y, 4, { dmg: 1300 * p.mult, stun: 1.4, k: 'frost', sup: true }); },
  },
  wirbel: {
    key: 'wirbel', name: 'Wirbel', role: 'Kämpfer', unlock: 150,
    desc: 'Wirft einen Bumerang, der auf dem Rückweg erneut trifft. Super: Klingenwirbel – 8 Bumerangs in alle Richtungen.',
    attackName: 'Bumerang', superName: 'Klingenwirbel',
    hp: 3400, speed: 3.5, reload: 1.5, ammo: 3, range: 7, projSpeed: 13, superPerHit: 0.2,
    aim: 'line', aimWidth: 0.35, superAim: 'self', superRange: 0, superRadius: 6,
    colors: [['#ab47bc', '#4a148c', '#f3e5f5'], ['#ff7043', '#263238', '#ffccbc'], ['#26c6da', '#ffeb3b', '#e0f7fa']],
    attack(g, p, a) { g.bullet(p, A(a.ax, a.ay), { k: 'boom', speed: 13, range: 7, dmg: 780, rad: 0.32, pierce: true, returns: true }); },
    super(g, p, a) {
      const base = A(a.ax, a.ay);
      for (let i = 0; i < 8; i++) g.bullet(p, base + (i * Math.PI) / 4, { k: 'boom', speed: 13, range: 6, dmg: 750, rad: 0.32, pierce: true, returns: true, sup: true });
    },
  },
  glut: {
    key: 'glut', name: 'Glut', role: 'Nahkämpfer', unlock: 220,
    desc: 'Flammenwerfer auf kurze Distanz, setzt Gegner in Brand. Super: Feuerwand – eine brennende Linie, die den Weg versperrt.',
    attackName: 'Flammenstoß', superName: 'Feuerwand',
    hp: 4300, speed: 3.4, reload: 0.85, ammo: 3, range: 4, projSpeed: 10, superPerHit: 0.035,
    aim: 'cone', aimWidth: 0.32, superAim: 'line', superRange: 7.5,
    colors: [['#e53935', '#3e2723', '#ffcdd2'], ['#212121', '#ff6f00', '#ffe0b2'], ['#1e88e5', '#00e676', '#bbdefb']],
    attack(g, p, a) {
      const base = A(a.ax, a.ay);
      for (let i = 0; i < 5; i++) g.bullet(p, base - 0.3 + 0.15 * i, { k: 'flame', speed: 10, range: 4, dmg: 200, rad: 0.3, pierce: true, burn: { dps: 250, dur: 2 } });
    },
    super(g, p, a) {
      const ang = A(a.ax, a.ay);
      for (let i = 0; i < 6; i++) {
        const d = 1.3 + i * 1.15;
        g.zone(p, p.x + Math.cos(ang) * d, p.y + Math.sin(ang) * d, 0.95, { k: 'fire', dur: 4, dps: 900, burn: { dps: 250, dur: 2 } });
      }
    },
  },
  heila: {
    key: 'heila', name: 'Heila', role: 'Heilerin', unlock: 300,
    desc: 'Wirft Lichtkugeln: Gegner nehmen Schaden, Verbündete werden geheilt. Super: Lebensquelle – ein heilender Kreis für das ganze Team.',
    attackName: 'Lichtkugel', superName: 'Lebensquelle',
    hp: 3000, speed: 3.3, reload: 1.5, ammo: 3, range: 8, projSpeed: 11, superPerHit: 0.25,
    aim: 'lob', aimRadius: 1.7, superAim: 'lob', superRange: 8, superRadius: 2.6,
    colors: [['#f8f8ff', '#ec407a', '#fff3e0'], ['#a5d6a7', '#2e7d32', '#f1f8e9'], ['#ffd54f', '#6d4c41', '#fff8e1']],
    attack(g, p, a) { g.lob(p, a, { k: 'heal', range: 8, dur: 0.6, aoe: 1.7, dmg: 800, heal: 1000 }); },
    super(g, p, a) {
      const d = Math.min(8, a.dist ?? 8);
      g.zone(p, p.x + a.ax * d, p.y + a.ay * d, 2.6, { k: 'spring', dur: 5, dps: 450, hps: 900 });
    },
  },
};

export const BRAWLER_ORDER = ['funke', 'brocken', 'pfeil', 'bummi', 'frost', 'wirbel', 'glut', 'heila'];
export const SKIN_NAMES = ['Standard', 'Gold', 'Schatten'];
export const SKIN_COST = [0, 40, 60]; // Juwelen
