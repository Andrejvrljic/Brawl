// 3D-Figuren der Brawler im Comic-Stil: Toon-Shading, schwarze Umrisse, Arme und Beine zum Animieren.
// Alles eigene Designs aus einfachen Formen.
import * as THREE from 'three';
import { BRAWLERS } from '../shared/brawlers.js';

const geo = {
  sphere: new THREE.SphereGeometry(1, 24, 16),
  lowSphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  cone: new THREE.ConeGeometry(1, 1, 20),
  capsule: new THREE.CapsuleGeometry(1, 1, 8, 16),
  torus: new THREE.TorusGeometry(1, 0.18, 12, 32),
  octa: new THREE.OctahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 0),
};

// 3-stufiger Farbverlauf für den Comic-Look
const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

const matCache = new Map();
function mat(color, opts = {}) {
  const { roughness, metalness, ...rest } = opts; // Toon-Material kennt diese nicht
  const key = color + JSON.stringify(rest);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap, ...rest }));
  return matCache.get(key);
}
const glowMat = (color, emissive, k = 1.4) => mat(color, { emissive, emissiveIntensity: k });

const OUTLINE = new THREE.MeshBasicMaterial({ color: '#1b1030', side: THREE.BackSide });

function mesh(g, m, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(geo[g] || g, m);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}
// Umriss: leicht vergrößerte Rückseite in Dunkel
function line(m, k = 0.08) {
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.scale.setScalar(1 + k);
  o.userData.outline = true;
  m.add(o);
  return m;
}
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const grp = (x = 0, y = 0, z = 0) => at(new THREE.Group(), x, y, z);

// ---------- Gemeinsamer Körper ----------
function rig(c, opt = {}) {
  const s = { torsoW: 0.27, torsoH: 0.2, torsoD: 0.24, headR: 0.31, headY: 1.02, armR: 0.068, handR: 0.095, shoulderX: 0.29, legX: 0.115, ...opt };
  const root = new THREE.Group();
  const body = grp();
  root.add(body);
  const parts = { body, legs: [], arms: [], anim: [], s };

  // Beine mit Schuhen
  for (const side of [-1, 1]) {
    const leg = grp(side * s.legX, 0.36, 0);
    leg.add(line(at(mesh('capsule', c.pants, 0.085, 0.13, 0.085), 0, -0.13, 0), 0.12));
    const shoe = line(at(mesh('sphere', c.shoe, 0.11, 0.075, 0.15), 0, -0.3, 0.035), 0.1);
    leg.add(shoe);
    body.add(leg);
    parts.legs.push(leg);
  }
  // Rumpf + Gürtel
  const torso = line(at(mesh('capsule', c.main, s.torsoW, s.torsoH, s.torsoD), 0, 0.58, 0), 0.06);
  body.add(torso);
  parts.torso = torso;
  body.add(at(mesh('cyl', c.belt, s.torsoW * 1.03, 0.07, s.torsoD * 1.03), 0, 0.42, 0));

  // Arme (Drehpunkt an der Schulter, Hand am Ende)
  for (const side of [-1, 1]) {
    const arm = grp(side * s.shoulderX, 0.74, 0);
    arm.add(line(at(mesh('capsule', c.sleeve || c.main, s.armR, 0.12, s.armR), 0, -0.1, 0), 0.12));
    const hand = line(at(mesh('sphere', c.glove || c.skin, s.handR), 0, -0.27, 0), 0.1);
    arm.add(hand);
    arm.rotation.z = side * 0.12;
    arm.userData.base = 0;
    arm.userData.swing = true;
    arm.userData.hand = hand;
    body.add(arm);
    parts.arms.push(arm);
  }
  parts.armL = parts.arms[0];
  parts.armR = parts.arms[1];

  // Kopf mit Gesicht
  const head = grp(0, s.headY, 0);
  const skull = line(mesh('sphere', c.skin, s.headR, s.headR * 0.95, s.headR * 0.95), 0.05);
  head.add(skull);
  body.add(head);
  parts.head = head;
  parts.skull = skull;
  return { root, body, parts, s, head };
}

// Gesicht: Augen mit Glanzpunkt, Augenbrauen, Mund
function face(head, R, o = {}) {
  const { y = 0.02, spread = 0.12, eyeW = 0.075, eyeH = 0.1, brow = 0.25, browY = 0.13, mouth = 'smile', iris = '#1d1b2e', cheeks = null, browColor = '#2a1a12' } = o;
  const zOn = (x, yy) => Math.sqrt(Math.max(0.01, R * R - x * x - yy * yy));
  const white = mat('#ffffff'), dark = mat(iris), shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const side of [-1, 1]) {
    const x = side * spread, z = zOn(x, y) * 0.97;
    const eye = at(mesh('sphere', white, eyeW, eyeH, 0.045), x, y, z);
    eye.castShadow = false;
    head.add(eye);
    head.add(at(mesh('sphere', dark, eyeW * 0.58, eyeH * 0.62, 0.03), x, y - 0.008, z + 0.03));
    const hl = at(new THREE.Mesh(geo.lowSphere, shine), x + eyeW * 0.25, y + eyeH * 0.3, z + 0.05);
    hl.scale.setScalar(0.018);
    head.add(hl);
    if (brow !== null) {
      const b = at(mesh('box', mat(browColor), 0.11, 0.028, 0.03), x, y + browY, zOn(x, y + browY) * 0.98);
      b.rotation.z = -side * brow;
      head.add(b);
    }
    if (cheeks) {
      const ch = at(mesh('sphere', mat(cheeks), 0.05, 0.03, 0.02), side * (spread + 0.05), y - 0.09, zOn(side * (spread + 0.05), y - 0.09) * 0.96);
      ch.castShadow = false;
      head.add(ch);
    }
  }
  const my = y - 0.13;
  if (mouth === 'smile' || mouth === 'grin') {
    const g = new THREE.TorusGeometry(mouth === 'grin' ? 0.06 : 0.045, 0.014, 6, 12, Math.PI);
    const m = at(new THREE.Mesh(g, mat('#3a1520')), 0, my + 0.03, zOn(0, my) * 0.99);
    m.rotation.z = Math.PI;
    head.add(m);
  } else if (mouth === 'flat') {
    head.add(at(mesh('box', mat('#3a1520'), 0.08, 0.018, 0.02), 0, my, zOn(0, my) * 0.99));
  } else if (mouth === 'open') {
    head.add(at(mesh('sphere', mat('#3a1520'), 0.04, 0.03, 0.02), 0, my, zOn(0, my) * 0.98));
  }
}

// Arm hält etwas seitlich (z. B. einen Stab)
function holdArm(arm) { arm.rotation.x = -0.35; arm.userData.base = -0.35; arm.userData.swing = false; }

// Waffen-Arm nach vorne halten
function aimArm(arm, angle = -1.35) { arm.rotation.x = angle; arm.userData.base = angle; arm.userData.swing = false; arm.rotation.z *= 0.3; }

export function buildBoomerang(m) {
  const g = new THREE.Group();
  const a = mesh('box', m, 0.36, 0.05, 0.1); a.position.x = 0.12; a.rotation.y = 0.5;
  const b = mesh('box', m, 0.36, 0.05, 0.1); b.position.x = -0.12; b.rotation.y = -0.5;
  g.add(line(a, 0.15), line(b, 0.15));
  return g;
}

// ---------- Die Brawler ----------
export function buildBrawler(key, skin = 0) {
  const def = BRAWLERS[key] || BRAWLERS.funke;
  const [main, accent, skinTone] = def.colors[skin] || def.colors[0];
  const C = {
    main: mat(main), accent: mat(accent), skin: mat(skinTone),
    pants: mat(new THREE.Color(accent).lerp(new THREE.Color('#222233'), 0.45).getStyle()),
    shoe: mat('#2b2b38'), belt: mat('#3a2a22'),
    dark: mat('#1e1e28'), white: mat('#ffffff'), metal: mat('#9aa4b5'),
  };
  let build;
  switch (key) {
    case 'brocken': build = brocken; break;
    case 'pfeil': build = pfeil; break;
    case 'bummi': build = bummi; break;
    case 'frost': build = frost; break;
    case 'wirbel': build = wirbel; break;
    case 'glut': build = glut; break;
    case 'heila': build = heila; break;
    default: build = funke;
  }
  const { root, parts, scale } = build(C, { main, accent, skinTone });
  root.scale.setScalar((scale || 1) * 0.92);
  root.userData.parts = parts;
  return root;
}

function funke(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.accent });
  face(head, s.headR, { brow: 0.3, mouth: 'grin' });
  // Kappe mit Schirm und Brille
  head.add(line(at(mesh('sphere', C.accent, s.headR * 1.04, s.headR * 0.62, s.headR * 1.04), 0, 0.1, -0.01), 0.05));
  head.add(line(at(mesh('box', C.accent, 0.34, 0.035, 0.2), 0, 0.12, 0.27), 0.12));
  const gog = grp(0, 0.2, 0.2);
  for (const side of [-1, 1]) gog.add(line(at(mesh('cyl', glowMat('#b2ffff', '#00bcd4', 0.9), 0.055, 0.04, 0.055), side * 0.07, 0, 0), 0.2));
  gog.children.forEach((g) => { g.rotation.x = Math.PI / 2 - 0.4; });
  head.add(gog);
  // Haarsträhnen
  for (let i = 0; i < 3; i++) { const h = line(at(mesh('cone', mat('#3b2416'), 0.05, 0.14, 0.05), -0.2 + i * 0.05, -0.02, 0.16), 0.15); h.rotation.set(0.4, 0, 0.9 + i * 0.2); head.add(h); }
  // Rucksack-Akku
  body.add(line(at(mesh('box', C.accent, 0.3, 0.32, 0.14), 0, 0.6, -0.25), 0.06));
  const cell = at(mesh('cyl', glowMat('#7df9ff', '#00e5ff', 1.6), 0.05, 0.22, 0.05), 0, 0.62, -0.33);
  body.add(cell);
  parts.anim.push((t) => { cell.material.emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.5; });
  // Blaster
  aimArm(parts.armR);
  const gun = grp(0, -0.32, 0);
  gun.add(line(at(mesh('box', C.accent, 0.13, 0.36, 0.15), 0, -0.08, 0), 0.08));
  gun.add(line(at(mesh('cyl', glowMat('#b2ffff', '#00bcd4', 1.2), 0.065, 0.1, 0.065), 0, -0.3, 0), 0.12));
  gun.add(at(mesh('box', C.dark, 0.05, 0.12, 0.1), 0, 0.02, -0.08));
  parts.armR.add(gun);
  return { root, parts };
}

function brocken(C) {
  const { root, body, parts, head, s } = rig(C, { torsoW: 0.38, torsoH: 0.22, torsoD: 0.32, headR: 0.25, headY: 1.06, armR: 0.1, handR: 0.11, shoulderX: 0.44, legX: 0.15, sleeve: C.skin });
  face(head, s.headR, { brow: 0.45, browY: 0.1, spread: 0.095, eyeW: 0.06, eyeH: 0.07, mouth: 'flat' });
  // Kinn und Stirnband
  head.add(line(at(mesh('box', C.skin, 0.32, 0.12, 0.2), 0, -0.15, 0.08), 0.08));
  const band = line(at(mesh('cyl', C.accent, s.headR * 1.02, 0.07, s.headR * 1.02), 0, 0.1, 0), 0.08);
  head.add(band);
  for (const side of [-1, 1]) { const t = line(at(mesh('box', C.accent, 0.05, 0.18, 0.03), side * 0.05, 0.05, -0.26), 0.15); t.rotation.z = side * 0.3; head.add(t); }
  // Schulterplatten mit Nieten
  for (const side of [-1, 1]) {
    const sp = line(at(mesh('sphere', C.accent, 0.2, 0.13, 0.19), side * 0.4, 0.8, 0), 0.06);
    body.add(sp);
    body.add(at(mesh('sphere', C.metal, 0.03), side * 0.47, 0.9, 0.08));
  }
  // Riesige Fäuste (Handschuhe)
  for (const arm of parts.arms) {
    const h = arm.userData.hand;
    h.scale.setScalar(0.2);
    h.material = C.accent;
    h.position.y = -0.33;
    const knuckles = at(mesh('box', C.metal, 1.05, 0.35, 0.5), 0, 0.15, 0.55);
    h.add(knuckles);
  }
  // Muskel-Brust
  body.add(at(mesh('sphere', C.main, 0.3, 0.16, 0.12), 0, 0.66, 0.2));
  return { root, parts, scale: 1.2 };
}

function pfeil(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.main });
  face(head, s.headR, { brow: 0.15, browY: 0.12, mouth: null, iris: '#1b5e20' });
  // Halstuch als Maske
  head.add(line(at(mesh('sphere', C.accent, s.headR * 0.92, s.headR * 0.45, s.headR * 0.85), 0, -0.13, 0.05), 0.05));
  // Kapuze mit Spitze
  const hood = line(at(mesh('sphere', C.main, s.headR * 1.12, s.headR * 1.05, s.headR * 1.1), 0, 0.04, -0.06), 0.04);
  head.add(hood);
  const tip = line(at(mesh('cone', C.main, 0.12, 0.32, 0.12), 0, 0.28, -0.22), 0.08);
  tip.rotation.x = -0.9;
  head.add(tip);
  head.children[0].scale.z *= 1.02; // Gesicht vor die Kapuze
  // Umhang
  const cape = line(at(mesh('cone', C.main, 0.34, 0.66, 0.2), 0, 0.5, -0.17), 0.05);
  body.add(cape);
  parts.anim.push((t, dt, mv) => { cape.rotation.x = 0.15 + (mv ? 0.25 : 0.05) + Math.sin(t * (mv ? 10 : 2)) * 0.05; });
  // Köcher mit Pfeilen
  const q = line(at(mesh('cyl', mat('#6d4c41'), 0.08, 0.4, 0.08), 0.12, 0.68, -0.26), 0.1);
  q.rotation.z = -0.4;
  body.add(q);
  for (let i = 0; i < 3; i++) body.add(at(mesh('cone', mat('#ffeb3b'), 0.03, 0.08, 0.03), 0.17 + i * 0.035, 0.94 - i * 0.02, -0.26));
  // Bogen in der linken Hand, vorgestreckt
  aimArm(parts.armL, -1.05);
  parts.armL.rotation.z = -0.35;
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 8, 24, Math.PI * 1.1), mat('#c8a165'));
  bow.castShadow = true;
  line(bow, 0.25);
  at(bow, 0, -0.3, 0.02);
  bow.scale.setScalar(0.85);
  bow.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.2);
  parts.armL.add(bow);
  const string = at(mesh('cyl', mat('#f5f5f5'), 0.006, 0.6, 0.006), 0, -0.3, -0.1);
  string.rotation.x = Math.PI / 2;
  parts.armL.add(string);
  aimArm(parts.armR, -1.0);
  return { root, parts };
}

function bummi(C) {
  const { root, body, parts, head, s } = rig(C, { torsoW: 0.33, torsoH: 0.1, torsoD: 0.31, headR: 0.29, headY: 0.98, legX: 0.13, sleeve: C.main });
  face(head, s.headR, { brow: -0.1, mouth: 'grin', cheeks: '#ff8a80' });
  // Grubenhelm mit Lampe
  head.add(line(at(mesh('sphere', C.accent, s.headR * 1.06, s.headR * 0.6, s.headR * 1.06), 0, 0.1, 0), 0.05));
  head.add(line(at(mesh('cyl', C.accent, s.headR * 1.15, 0.03, s.headR * 1.15), 0, 0.08, 0), 0.1));
  const lamp = at(mesh('cyl', glowMat('#fffde7', '#ffeb3b', 2), 0.06, 0.05, 0.06), 0, 0.23, 0.23);
  lamp.rotation.x = Math.PI / 2 - 0.5;
  head.add(line(lamp, 0.15));
  // Patronengurt mit Mini-Bomben
  const sash = at(mesh('box', mat('#5d4037'), 0.08, 0.6, 0.36), 0, 0.6, 0);
  sash.rotation.z = 0.7;
  body.add(sash);
  for (let i = 0; i < 3; i++) body.add(line(at(mesh('sphere', C.dark, 0.05), -0.14 + i * 0.13, 0.48 + i * 0.12, 0.3), 0.15));
  // Bombe hochgehalten
  parts.armR.rotation.x = -2.4; parts.armR.userData.base = -2.4; parts.armR.userData.swing = false;
  const bomb = line(at(mesh('sphere', C.dark, 0.15), 0, -0.38, 0), 0.08);
  const fuse = at(mesh('cyl', mat('#8d6e63'), 0.015, 0.1, 0.015), 0, -0.55, 0);
  const spark = at(mesh('sphere', glowMat('#ffe082', '#ff6d00', 2.5), 0.04), 0, -0.61, 0);
  parts.armR.add(bomb, fuse, spark);
  parts.anim.push((t) => { const k = 0.8 + Math.random() * 0.6; spark.scale.setScalar(0.04 * k); });
  return { root, parts };
}

function frost(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.accent });
  face(head, s.headR, { brow: -0.05, mouth: 'flat', iris: '#0d47a1', eyeH: 0.085 });
  // Eiskrone
  const ice = glowMat('#e1f5fe', '#4fc3f7', 0.5);
  for (let i = 0; i < 5; i++) {
    const a = -0.8 + i * 0.4;
    const c = line(at(mesh('octa', ice, 0.06, 0.16 + (i === 2 ? 0.06 : 0), 0.06), Math.sin(a) * 0.2, 0.3 - Math.abs(a) * 0.08, Math.cos(a) * 0.05 - 0.02), 0.12);
    c.rotation.z = -a * 0.5;
    head.add(c);
  }
  // Haare
  head.add(line(at(mesh('sphere', mat('#e3f2fd'), s.headR * 1.02, s.headR * 0.8, s.headR * 1.0), 0, 0.08, -0.05), 0.04));
  // Langer Mantel
  body.add(line(at(mesh('cone', C.accent, 0.36, 0.62, 0.32), 0, 0.42, -0.02), 0.05));
  body.add(at(mesh('box', C.white, 0.06, 0.4, 0.02), 0, 0.55, 0.25));
  // Eisstab (senkrecht neben der Hand) mit schwebendem Kristall
  holdArm(parts.armR);
  const staffG = grp(0.34, 0, 0.12);
  staffG.add(line(at(mesh('cyl', mat('#b0bec5'), 0.028, 1.15, 0.028), 0, 0.55, 0), 0.3));
  staffG.add(line(at(mesh('cyl', mat('#78909c'), 0.06, 0.05, 0.06), 0, 1.12, 0), 0.15));
  const crystal = line(at(mesh('octa', glowMat('#e1f5fe', '#29b6f6', 1.4), 0.12, 0.2, 0.12), 0, 1.33, 0), 0.1);
  staffG.add(crystal);
  body.add(staffG);
  parts.anim.push((t) => { crystal.rotation.y = t * 2; crystal.position.y = 1.33 + Math.sin(t * 3) * 0.04; });
  return { root, parts };
}

function wirbel(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.main });
  face(head, s.headR, { brow: 0.35, mouth: 'smile' });
  // Stachelfrisur
  const hair = mat(new THREE.Color(C.accent.color).offsetHSL(0, 0, 0.1).getStyle());
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 1.6 - Math.PI * 0.8;
    const c = line(at(mesh('cone', hair, 0.08, 0.3, 0.08), Math.sin(a) * 0.16, 0.24, Math.cos(a) * 0.12 - 0.06), 0.12);
    c.rotation.set(-Math.cos(a) * 0.7 - 0.3, 0, -Math.sin(a) * 0.8);
    head.add(c);
  }
  head.add(line(at(mesh('sphere', hair, s.headR * 1.0, s.headR * 0.55, s.headR * 1.0), 0, 0.14, -0.03), 0.04));
  // Langer Schal, der im Wind weht
  body.add(line(at(mesh('torus', C.accent, 0.2, 0.2, 0.35), 0, 0.8, 0), 0.08));
  body.children[body.children.length - 1].rotation.x = Math.PI / 2;
  const tail = grp(0.08, 0.8, -0.18);
  const seg = line(at(mesh('box', C.accent, 0.12, 0.04, 0.4), 0, 0, -0.2), 0.1);
  tail.add(seg);
  body.add(tail);
  parts.anim.push((t, dt, mv) => { tail.rotation.x = (mv ? -0.5 : 0.6) + Math.sin(t * (mv ? 14 : 3)) * 0.15; tail.rotation.y = Math.sin(t * 2) * 0.2; });
  // Bumerang
  aimArm(parts.armR, -1.1);
  const b = buildBoomerang(mat('#e040fb'));
  b.scale.setScalar(1.1);
  at(b, 0, -0.32, 0.05);
  b.rotation.x = Math.PI / 2;
  parts.armR.add(b);
  return { root, parts };
}

function glut(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.main, glove: mat('#3e2723') });
  face(head, s.headR, { brow: 0.4, mouth: 'grin', iris: '#bf360c' });
  // Schweißerbrille auf der Stirn
  head.add(line(at(mesh('cyl', C.dark, s.headR * 1.01, 0.05, s.headR * 1.01), 0, 0.19, 0), 0.06));
  for (const side of [-1, 1]) {
    const g = line(at(mesh('cyl', glowMat('#ffcc80', '#ff6d00', 0.6), 0.05, 0.04, 0.05), side * 0.085, 0.2, 0.24), 0.15);
    g.rotation.x = Math.PI / 2 - 0.3;
    head.add(g);
  }
  // Flammenhaare (flackern)
  const flames = [];
  for (let i = 0; i < 5; i++) {
    const f = at(mesh('cone', glowMat(i % 2 ? '#ffd54f' : '#ff9100', i % 2 ? '#ffab00' : '#ff3d00', 1.6), 0.09, 0.32, 0.09), (i - 2) * 0.08, 0.32 - Math.abs(i - 2) * 0.05, -0.05);
    f.rotation.z = -(i - 2) * 0.25;
    f.castShadow = false;
    head.add(f);
    flames.push(f);
  }
  parts.anim.push((t) => flames.forEach((f, i) => { f.scale.y = 0.32 * (0.8 + Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.45); }));
  // Tanks auf dem Rücken
  for (const side of [-1, 1]) body.add(line(at(mesh('capsule', C.accent, 0.09, 0.24, 0.09), side * 0.1, 0.62, -0.27), 0.08));
  body.add(at(mesh('torus', C.metal, 0.07, 0.07, 0.1), 0, 0.75, -0.3));
  // Flammenwerfer mit Zündflamme
  aimArm(parts.armR);
  const noz = grp(0, -0.32, 0);
  noz.add(line(at(mesh('cyl', C.metal, 0.06, 0.38, 0.06), 0, -0.1, 0), 0.1));
  noz.add(line(at(mesh('cyl', C.dark, 0.085, 0.08, 0.085), 0, -0.3, 0), 0.1));
  const pilot = at(mesh('sphere', glowMat('#ffe082', '#ff6d00', 2.5), 0.04), 0, -0.37, 0);
  pilot.castShadow = false;
  noz.add(pilot);
  parts.anim.push(() => { pilot.scale.setScalar(0.035 + Math.random() * 0.02); });
  parts.armR.add(noz);
  return { root, parts };
}

function heila(C) {
  const { root, body, parts, head, s } = rig(C, { sleeve: C.main, torsoW: 0.24 });
  face(head, s.headR, { brow: -0.12, mouth: 'smile', cheeks: '#f48fb1', eyeH: 0.11 });
  // Haare mit Zöpfen
  head.add(line(at(mesh('sphere', C.accent, s.headR * 1.04, s.headR * 0.78, s.headR * 1.02), 0, 0.08, -0.04), 0.04));
  for (const side of [-1, 1]) {
    head.add(line(at(mesh('sphere', C.accent, 0.1, 0.17, 0.1), side * 0.3, -0.06, -0.05), 0.08));
    head.add(at(mesh('sphere', mat('#ffffff'), 0.04), side * 0.29, 0.08, -0.05));
  }
  // Heiligenschein (dreht sich)
  const halo = at(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 32), glowMat('#fff59d', '#ffee58', 1.6)), 0, 0.42, -0.02);
  halo.rotation.x = Math.PI / 2;
  head.add(halo);
  parts.halo = halo;
  parts.anim.push((t) => { halo.rotation.z = t * 1.5; halo.position.y = 0.42 + Math.sin(t * 2.5) * 0.02; });
  // Kleid
  body.add(line(at(mesh('cone', C.main, 0.36, 0.5, 0.36), 0, 0.36, 0), 0.05));
  body.add(at(mesh('torus', C.accent, 0.3, 0.3, 0.2), 0, 0.14, 0));
  body.children[body.children.length - 1].rotation.x = Math.PI / 2;
  // Kleine Flügel
  const wings = [];
  for (const side of [-1, 1]) {
    const w = line(at(mesh('sphere', mat('#ffffff'), 0.06, 0.2, 0.14), side * 0.16, 0.7, -0.26), 0.08);
    w.rotation.set(0.3, side * 0.6, side * 0.5);
    body.add(w);
    wings.push(w);
  }
  parts.anim.push((t) => wings.forEach((w, i) => { w.rotation.y = (i ? 1 : -1) * (0.6 + Math.sin(t * 6) * 0.25); }));
  // Stab (senkrecht) mit leuchtender Kugel
  holdArm(parts.armR);
  const staffG = grp(0.34, 0, 0.12);
  staffG.add(line(at(mesh('cyl', mat('#efebe9'), 0.026, 1.1, 0.026), 0, 0.55, 0), 0.3));
  const leaf = line(at(mesh('torus', mat('#ffd54f'), 0.1, 0.1, 0.25), 0, 1.15, 0), 0.1);
  staffG.add(leaf);
  const orb = at(mesh('sphere', glowMat('#b9f6ca', '#00e676', 1.8), 0.09), 0, 1.15, 0);
  staffG.add(line(orb, 0.1));
  body.add(staffG);
  parts.anim.push((t) => { orb.material.emissiveIntensity = 1.4 + Math.sin(t * 4) * 0.5; });
  return { root, parts };
}

export { geo, mat, mesh };
