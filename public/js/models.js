// 3D-Figuren der Brawler – aus einfachen Formen gebaut (eigene Designs)
import * as THREE from 'three';
import { BRAWLERS } from '../shared/brawlers.js';

const geo = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  lowSphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 18),
  cone: new THREE.ConeGeometry(1, 1, 16),
  capsule: new THREE.CapsuleGeometry(1, 1, 6, 16),
  torus: new THREE.TorusGeometry(1, 0.18, 10, 28),
  octa: new THREE.OctahedronGeometry(1, 0),
};
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts }));
  return matCache.get(key);
}
function mesh(g, m, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(geo[g], m);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}
const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };

// Erzeugt eine Figur. Vorne = +Z.
export function buildBrawler(key, skin = 0) {
  const def = BRAWLERS[key] || BRAWLERS.funke;
  const [main, accent, skinTone] = def.colors[skin] || def.colors[0];
  const root = new THREE.Group();
  const body = new THREE.Group(); // wird beim Laufen gewippt
  root.add(body);
  const mMain = mat(main), mAcc = mat(accent), mSkin = mat(skinTone);
  const white = mat('#ffffff'), black = mat('#151515');

  let scale = 1, headY = 1.05, headR = 0.27;
  const parts = { body, handR: null, handL: null, feet: [] };

  // Füße
  for (const s of [-1, 1]) {
    const f = at(mesh('box', black, 0.16, 0.1, 0.24), s * 0.13, 0.05, 0.02);
    body.add(f); parts.feet.push(f);
  }
  const torso = at(mesh('capsule', mMain, 0.26, 0.22, 0.26), 0, 0.5, 0);
  body.add(torso);
  const head = at(mesh('sphere', mSkin, headR), 0, headY, 0);
  body.add(head);
  const addEyes = (y, z, spread = 0.1, size = 0.065) => {
    for (const s of [-1, 1]) {
      body.add(at(mesh('sphere', white, size), s * spread, y, z));
      body.add(at(mesh('sphere', black, size * 0.55), s * spread, y, z + size * 0.6));
    }
  };
  const hand = (side, m = mSkin) => {
    const h = at(mesh('sphere', m, 0.09), side * 0.3, 0.5, 0.12);
    body.add(h);
    return h;
  };

  switch (key) {
    case 'funke': {
      addEyes(headY + 0.02, headR * 0.85);
      // Kappe mit Schirm
      body.add(at(mesh('sphere', mAcc, headR * 1.04, headR * 0.6, headR * 1.04), 0, headY + 0.1, 0));
      body.add(at(mesh('box', mAcc, 0.36, 0.04, 0.22), 0, headY + 0.1, 0.25));
      // Rucksack-Akku
      body.add(at(mesh('box', mAcc, 0.3, 0.32, 0.14), 0, 0.58, -0.25));
      body.add(at(mesh('sphere', mat('#7df9ff', { emissive: '#00bcd4', emissiveIntensity: 1.2 }), 0.06), 0, 0.72, -0.33));
      parts.handR = hand(1); parts.handL = hand(-1);
      const gun = new THREE.Group();
      gun.add(at(mesh('box', mAcc, 0.12, 0.14, 0.42), 0, 0, 0.12));
      gun.add(at(mesh('cyl', mat('#7df9ff', { emissive: '#00bcd4', emissiveIntensity: 0.9 }), 0.07, 0.08, 0.07), 0, 0, 0.36));
      gun.children[1].rotation.x = Math.PI / 2;
      at(gun, 0.3, 0.52, 0.2);
      body.add(gun);
      break;
    }
    case 'brocken': {
      scale = 1.25;
      torso.scale.set(0.36, 0.24, 0.32);
      head.scale.setScalar(0.24); head.position.y = headY - 0.05;
      addEyes(headY - 0.04, 0.21, 0.09, 0.055);
      // Augenbraue / Stirnband
      body.add(at(mesh('box', mAcc, 0.42, 0.07, 0.42), 0, headY + 0.07, 0));
      // Schulterplatten
      for (const s of [-1, 1]) body.add(at(mesh('sphere', mAcc, 0.17, 0.12, 0.17), s * 0.36, 0.78, 0));
      // Riesige Fäuste
      parts.handR = at(mesh('sphere', mSkin, 0.2), 0.48, 0.48, 0.16); body.add(parts.handR);
      parts.handL = at(mesh('sphere', mSkin, 0.2), -0.48, 0.48, 0.16); body.add(parts.handL);
      for (const h of [parts.handR, parts.handL]) h.add(at(mesh('box', mAcc, 1.05, 0.35, 0.6), 0, 0.25, 0.2));
      break;
    }
    case 'pfeil': {
      addEyes(headY, headR * 0.86, 0.09, 0.055);
      // Kapuze
      body.add(at(mesh('cone', mMain, 0.3, 0.5, 0.3), 0, headY + 0.28, -0.04));
      body.add(at(mesh('sphere', mMain, 0.3, 0.26, 0.3), 0, headY + 0.04, -0.05));
      head.position.z = 0.04;
      // Köcher
      const q = at(mesh('cyl', mAcc, 0.09, 0.42, 0.09), 0.08, 0.68, -0.24); q.rotation.z = 0.35; body.add(q);
      for (let i = 0; i < 3; i++) body.add(at(mesh('box', mat('#ffeb3b'), 0.02, 0.18, 0.02), 0.02 + i * 0.05, 0.95, -0.24));
      parts.handR = hand(1); parts.handL = hand(-1);
      // Bogen
      const bow = at(mesh('torus', mat('#6d4c41'), 0.32, 0.32, 0.5), -0.33, 0.6, 0.18);
      bow.geometry = new THREE.TorusGeometry(1, 0.06, 6, 20, Math.PI);
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      body.add(bow);
      break;
    }
    case 'bummi': {
      torso.scale.set(0.32, 0.18, 0.32); torso.position.y = 0.45;
      head.scale.setScalar(0.25); head.position.y = 0.95;
      addEyes(0.97, 0.22, 0.09);
      // Helm mit Lampe
      body.add(at(mesh('sphere', mAcc, 0.27, 0.17, 0.27), 0, 1.06, 0));
      body.add(at(mesh('cyl', mat('#fff59d', { emissive: '#ffeb3b', emissiveIntensity: 1 }), 0.06, 0.05, 0.06), 0, 1.12, 0.24));
      body.children[body.children.length - 1].rotation.x = Math.PI / 2;
      // Gürtel mit Bomben
      body.add(at(mesh('torus', mAcc, 0.31, 0.31, 0.5), 0, 0.42, 0));
      body.children[body.children.length - 1].rotation.x = Math.PI / 2;
      parts.handR = hand(1); parts.handL = hand(-1);
      const bomb = at(mesh('sphere', black, 0.14), 0.34, 0.58, 0.18);
      bomb.add(at(mesh('cyl', mat('#ff9800', { emissive: '#ff5722', emissiveIntensity: 1.5 }), 0.15, 0.6, 0.15), 0, 1.1, 0));
      body.add(bomb);
      break;
    }
    case 'frost': {
      addEyes(headY, headR * 0.86);
      // Eiskristalle als Haare
      const ice = mat('#e1f5fe', { emissive: '#4fc3f7', emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 });
      for (let i = 0; i < 5; i++) {
        const c = mesh('octa', ice, 0.07, 0.2, 0.07);
        const a = -0.9 + i * 0.45;
        at(c, Math.sin(a) * 0.18, headY + 0.25, Math.cos(a) * 0.05 - 0.05);
        c.rotation.z = -a * 0.6;
        body.add(c);
      }
      // Umhang
      const cape = at(mesh('cone', mAcc, 0.33, 0.6, 0.33), 0, 0.5, -0.06);
      body.add(cape);
      parts.handR = hand(1); parts.handL = hand(-1);
      // Eisstab
      const staff = at(mesh('cyl', mAcc, 0.03, 0.9, 0.03), 0.32, 0.6, 0.15);
      staff.add(at(mesh('octa', ice, 4, 0.22, 4), 0, 0.6, 0));
      body.add(staff);
      break;
    }
    case 'wirbel': {
      addEyes(headY, headR * 0.86);
      // Stachelfrisur
      for (let i = 0; i < 6; i++) {
        const c = mesh('cone', mAcc, 0.07, 0.3, 0.07);
        const a = (i / 6) * Math.PI * 2;
        at(c, Math.cos(a) * 0.13, headY + 0.25, Math.sin(a) * 0.13 - 0.03);
        c.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        body.add(c);
      }
      // Schal
      body.add(at(mesh('torus', mAcc, 0.22, 0.22, 0.5), 0, 0.8, 0));
      body.children[body.children.length - 1].rotation.x = Math.PI / 2;
      parts.handR = hand(1); parts.handL = hand(-1);
      body.add(at(buildBoomerang(mAcc), 0.36, 0.55, 0.15));
      break;
    }
    case 'glut': {
      addEyes(headY - 0.02, headR * 0.86);
      // Schutzbrille
      body.add(at(mesh('box', black, 0.4, 0.07, 0.1), 0, headY + 0.07, 0.2));
      // Flammenhaare
      const fl = mat('#ffab00', { emissive: '#ff6d00', emissiveIntensity: 1.4 });
      for (let i = 0; i < 3; i++) body.add(at(mesh('cone', fl, 0.1 - i * 0.015, 0.34 - i * 0.05, 0.1), (i - 1) * 0.1, headY + 0.32 - Math.abs(i - 1) * 0.06, -0.02));
      // Tank auf dem Rücken
      for (const s of [-1, 1]) body.add(at(mesh('capsule', mAcc, 0.09, 0.22, 0.09), s * 0.1, 0.6, -0.27));
      parts.handR = hand(1); parts.handL = hand(-1);
      const nozzle = at(mesh('cyl', mat('#455a64', { metalness: 0.6, roughness: 0.3 }), 0.07, 0.45, 0.07), 0.3, 0.52, 0.28);
      nozzle.rotation.x = Math.PI / 2;
      body.add(nozzle);
      break;
    }
    case 'heila': {
      addEyes(headY, headR * 0.86);
      // Heiligenschein
      const halo = at(mesh('torus', mat('#fff59d', { emissive: '#ffee58', emissiveIntensity: 1.3 }), 0.2, 0.2, 0.4), 0, headY + 0.38, 0);
      halo.rotation.x = Math.PI / 2; body.add(halo); parts.halo = halo;
      // Haare
      body.add(at(mesh('sphere', mAcc, 0.29, 0.22, 0.3), 0, headY + 0.08, -0.04));
      // Kleid
      body.add(at(mesh('cone', mMain, 0.34, 0.55, 0.34), 0, 0.36, 0));
      parts.handR = hand(1); parts.handL = hand(-1);
      const staff = at(mesh('cyl', mat('#d7ccc8'), 0.03, 0.95, 0.03), 0.32, 0.62, 0.12);
      staff.add(at(mesh('sphere', mat('#b9f6ca', { emissive: '#00e676', emissiveIntensity: 1.3 }), 3.5, 0.13, 3.5), 0, 0.58, 0));
      body.add(staff);
      break;
    }
  }
  root.scale.setScalar(scale * 0.95);
  root.userData.parts = parts;
  return root;
}

export function buildBoomerang(m) {
  const g = new THREE.Group();
  const a = mesh('box', m, 0.36, 0.05, 0.1); a.position.x = 0.12; a.rotation.y = 0.5;
  const b = mesh('box', m, 0.36, 0.05, 0.1); b.position.x = -0.12; b.rotation.y = -0.5;
  g.add(a, b);
  return g;
}

export { geo, mat, mesh };
