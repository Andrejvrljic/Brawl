// 3D-Darstellung mit three.js: Arena aus der Vogelperspektive, Figuren, Effekte
import * as THREE from 'three';
import { buildBrawler, buildBoomerang, geo, mat } from './models.js';
import { BRAWLERS } from '../shared/brawlers.js';

const COL = { self: '#46e05a', ally: '#3d9bff', enemy: '#ff4147', gold: '#ffd23f' };
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Renderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.clock = 0;
    this.buildMenuScene();
    this.mode = 'menu';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  addLights(scene, shadowSize = 20, center = new THREE.Vector3()) {
    scene.add(new THREE.HemisphereLight('#dff3ff', '#5b4a3a', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
    sun.position.set(center.x - 8, 22, center.z + 12);
    sun.target.position.copy(center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -shadowSize; c.right = shadowSize; c.top = shadowSize; c.bottom = -shadowSize; c.near = 1; c.far = 70;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    return sun;
  }

  // ---------------- Menü ----------------
  buildMenuScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color('#2a1b5e');
    s.fog = new THREE.Fog('#2a1b5e', 8, 22);
    this.addLights(s, 6);
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.35, 40), mat('#ffb703'));
    podium.position.y = -0.18; podium.receiveShadow = true; podium.castShadow = true;
    s.add(podium);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.05, 8, 60), mat('#fff', { emissive: '#ffd23f', emissiveIntensity: 1 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; s.add(ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 40), mat('#3b2a7a'));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.35; floor.receiveShadow = true;
    s.add(floor);
    // schwebende Kisten als Deko
    this.menuDeco = [];
    for (let i = 0; i < 14; i++) {
      const b = new THREE.Mesh(geo.box, mat(['#ff6b6b', '#4ecdc4', '#ffe66d', '#a06cd5'][i % 4]));
      const a = (i / 14) * Math.PI * 2;
      b.position.set(Math.cos(a) * (5 + (i % 3)), 1 + (i % 4) * 0.8, Math.sin(a) * (5 + (i % 3)) - 3);
      b.scale.setScalar(0.3 + (i % 3) * 0.15);
      b.userData.spin = 0.3 + Math.random();
      s.add(b); this.menuDeco.push(b);
    }
    this.menuScene = s;
    this.menuModel = null;
  }

  showMenu(key, skin) {
    this.mode = 'menu';
    if (this.menuModel) this.menuScene.remove(this.menuModel);
    this.menuModel = buildBrawler(key, skin);
    this.menuModel.scale.multiplyScalar(1.6);
    this.menuScene.add(this.menuModel);
    this.menuKey = key + skin;
  }

  // ---------------- Arena ----------------
  startGame(map, roster, youId, mode) {
    this.mode = 'game';
    this.map = map;
    this.youId = youId;
    this.gameMode = mode;
    const me = roster.find((p) => p.id === youId);
    this.myTeam = me ? me.team : 0;
    this.flip = mode !== 'ffa' && this.myTeam === 1;
    this.roster = new Map(roster.map((p) => [p.id, p]));
    const s = new THREE.Scene();
    s.background = new THREE.Color('#79c7e3');
    s.fog = new THREE.Fog('#79c7e3', 26, 48);
    const W = map.w, H = map.h;
    this.addLights(s, Math.max(W, H) * 0.62, new THREE.Vector3(W / 2, 0, H / 2));

    // Außenbereich
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), mat('#4f9d4f'));
    outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.12, H / 2); outer.receiveShadow = true;
    s.add(outer);

    // Bodenkacheln
    const floorG = new THREE.BoxGeometry(1, 0.2, 1);
    const floor = new THREE.InstancedMesh(floorG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), W * H);
    const cA = new THREE.Color('#e9c88f'), cB = new THREE.Color('#dfb978'), cC = new THREE.Color('#d9b06a');
    let i = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      tmpM.makeTranslation(x + 0.5, -0.1, y + 0.5);
      floor.setMatrixAt(i, tmpM);
      floor.setColorAt(i, (x + y) % 2 ? cA : ((x * 7 + y * 3) % 5 === 0 ? cC : cB));
      i++;
    }
    floor.receiveShadow = true;
    s.add(floor);

    // Zählen
    const walls = [], bushes = [], water = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = map.get(x, y);
      if (c === '#') walls.push([x, y]); else if (c === 'B') bushes.push([x, y]); else if (c === 'W') water.push([x, y]);
    }
    // Kisten
    this.wallIdx = new Map();
    const crate = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 1, 0.96), new THREE.MeshStandardMaterial({ roughness: 0.75 }), walls.length);
    const lid = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.06, 0.8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), walls.length);
    const band = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), new THREE.MeshStandardMaterial({ color: '#5d4037', roughness: 0.6 }), walls.length);
    walls.forEach(([x, y], j) => {
      const h = 0.95 + ((x * 13 + y * 7) % 3) * 0.06;
      tmpM.compose(tmpV.set(x + 0.5, h / 2, y + 0.5), tmpQ.identity(), tmpS.set(1, h, 1)); crate.setMatrixAt(j, tmpM);
      tmpM.makeTranslation(x + 0.5, h + 0.03, y + 0.5); lid.setMatrixAt(j, tmpM);
      tmpM.makeTranslation(x + 0.5, h * 0.55, y + 0.5); band.setMatrixAt(j, tmpM);
      const v = ((x * 31 + y * 17) % 7) / 7;
      crate.setColorAt(j, new THREE.Color().setHSL(0.06 + v * 0.02, 0.62, 0.3 + v * 0.06));
      lid.setColorAt(j, new THREE.Color().setHSL(0.07, 0.55, 0.42 + v * 0.05));
      this.wallIdx.set(x + ',' + y, j);
    });
    for (const m of [crate, lid, band]) { m.castShadow = true; m.receiveShadow = true; s.add(m); }
    this.wallMeshes = [crate, lid, band];

    // Büsche
    this.bushIdx = new Map();
    const per = 3;
    this.bushMat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, transparent: true, opacity: 1 });
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), this.bushMat, bushes.length * per);
    bushes.forEach(([x, y], j) => {
      const ids = [];
      for (let k = 0; k < per; k++) {
        const n = j * per + k;
        const rnd = Math.sin((x * 12.9898 + y * 78.233 + k * 3.1) * 43758.5453) * 0.5 + 0.5;
        const ox = (k - 1) * 0.28 + (rnd - 0.5) * 0.2, oz = ((k % 2) - 0.5) * 0.35;
        const sc = 0.75 + rnd * 0.35;
        tmpQ.setFromAxisAngle(UP, rnd * 6);
        tmpM.compose(tmpV.set(x + 0.5 + ox, 0.38 * sc, y + 0.5 + oz), tmpQ, tmpS.set(sc, sc * 0.95, sc));
        bush.setMatrixAt(n, tmpM);
        bush.setColorAt(n, new THREE.Color().setHSL(0.3 + rnd * 0.06, 0.6, 0.32 + rnd * 0.1));
        ids.push(n);
      }
      this.bushIdx.set(x + ',' + y, ids);
    });
    bush.castShadow = true; bush.receiveShadow = true;
    s.add(bush);
    this.bushMesh = bush;

    // Wasser
    if (water.length) {
      this.waterMat = new THREE.MeshStandardMaterial({ color: '#2f9fe0', roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, emissive: '#0b4f8a', emissiveIntensity: 0.3 });
      const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), this.waterMat, water.length);
      water.forEach(([x, y], j) => { tmpM.makeTranslation(x + 0.5, -0.06, y + 0.5); wm.setMatrixAt(j, tmpM); });
      s.add(wm);
    }

    // Randzaun
    const fence = [];
    for (let x = -1; x <= W; x++) { fence.push([x, -1]); fence.push([x, H]); }
    for (let y = 0; y < H; y++) { fence.push([-1, y]); fence.push([W, y]); }
    const fm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.3, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), fence.length);
    fence.forEach(([x, y], j) => {
      tmpM.makeTranslation(x + 0.5, 0.55, y + 0.5); fm.setMatrixAt(j, tmpM);
      fm.setColorAt(j, new THREE.Color().setHSL(0.6, 0.08, 0.45 + ((x + y) % 2) * 0.06));
    });
    fm.castShadow = true; fm.receiveShadow = true;
    s.add(fm);

    // Zone (Zonenkontrolle)
    this.zoneRing = null;
    if (mode === 'zone') {
      const zg = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2.6, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02;
      const rim = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.6, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03;
      zg.add(disc, rim);
      zg.position.set(map.center.x, 0, map.center.y);
      s.add(zg);
      this.zoneRing = { g: zg, disc, rim };
    }

    // Zielanzeige
    this.aim = this.buildAim();
    s.add(this.aim.group);

    this.scene = s;
    this.ents = new Map();
    this.projs = new Map();
    this.zones = new Map();
    this.fx = [];
    this.overlay.innerHTML = '';
    this.camPos = null;
    this.shake = 0;
  }

  applyTiles(list) {
    for (const [x, y] of list) {
      const key = x + ',' + y;
      const wi = this.wallIdx?.get(key);
      if (wi !== undefined) {
        tmpM.makeScale(0, 0, 0);
        for (const m of this.wallMeshes) { m.setMatrixAt(wi, tmpM); m.instanceMatrix.needsUpdate = true; }
        this.wallIdx.delete(key);
        this.debris(x + 0.5, y + 0.5, '#a0522d', 7);
      }
      const bi = this.bushIdx?.get(key);
      if (bi) {
        tmpM.makeScale(0, 0, 0);
        for (const n of bi) this.bushMesh.setMatrixAt(n, tmpM);
        this.bushMesh.instanceMatrix.needsUpdate = true;
        this.bushIdx.delete(key);
        this.debris(x + 0.5, y + 0.5, '#3f8f3f', 5);
      }
    }
  }

  // ---------------- Zielanzeige ----------------
  buildAim() {
    const group = new THREE.Group();
    const m = () => new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m());
    line.geometry.translate(0, 0.5, 0); line.rotation.x = -Math.PI / 2;
    const lineHolder = new THREE.Group(); lineHolder.add(line);
    const cone = new THREE.Mesh(new THREE.CircleGeometry(1, 32, 0, 1), m());
    const coneHolder = new THREE.Group(); coneHolder.add(cone); cone.rotation.x = -Math.PI / 2;
    const circle = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), m());
    circle.rotation.x = -Math.PI / 2;
    const circleFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), m());
    circleFill.material.opacity = 0.15; circleFill.rotation.x = -Math.PI / 2;
    const range = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), m());
    range.material.opacity = 0.2; range.rotation.x = -Math.PI / 2;
    for (const o of [lineHolder, coneHolder, circle, circleFill, range]) { o.position.y = 0.04; o.visible = false; group.add(o); }
    return { group, line, lineHolder, cone, coneHolder, circle, circleFill, range };
  }

  setAim(info) {
    const A = this.aim;
    for (const o of [A.lineHolder, A.coneHolder, A.circle, A.circleFill, A.range]) o.visible = false;
    if (!info) return;
    const { x, y, ax, ay, dist, type, range, width, radius, sup } = info;
    const color = sup ? COL.gold : '#ffffff';
    for (const o of [A.line, A.cone, A.circle, A.circleFill, A.range]) o.material.color.set(color);
    const ang = Math.atan2(ay, ax);
    const rotY = Math.atan2(ax, ay);
    if (type === 'line') {
      A.lineHolder.visible = true;
      A.lineHolder.position.set(x, 0.04, y);
      A.lineHolder.rotation.y = rotY;
      A.line.scale.set(Math.max(0.3, width * 2.2), range, 1);
      A.line.rotation.set(-Math.PI / 2, 0, Math.PI);
    } else if (type === 'cone') {
      A.coneHolder.visible = true;
      A.coneHolder.position.set(x, 0.04, y);
      A.cone.geometry.dispose();
      A.cone.geometry = new THREE.CircleGeometry(range, 24, -width, width * 2);
      A.coneHolder.rotation.y = 0;
      A.cone.rotation.set(-Math.PI / 2, 0, -ang);
    } else if (type === 'lob' || type === 'circle') {
      const d = Math.min(range, dist ?? range);
      A.circle.visible = A.circleFill.visible = A.range.visible = true;
      A.circle.position.set(x + ax * d, 0.05, y + ay * d);
      A.circleFill.position.copy(A.circle.position);
      A.circle.scale.setScalar(radius); A.circleFill.scale.setScalar(radius);
      A.range.position.set(x, 0.04, y); A.range.scale.setScalar(range);
    } else if (type === 'self') {
      A.circle.visible = A.circleFill.visible = true;
      A.circle.position.set(x, 0.05, y); A.circleFill.position.set(x, 0.05, y);
      A.circle.scale.setScalar(radius); A.circleFill.scale.setScalar(radius);
    }
  }

  // ---------------- Entitäten ----------------
  relation(id) {
    if (id === this.youId) return 'self';
    const r = this.roster.get(id);
    return r && r.team === this.myTeam ? 'ally' : 'enemy';
  }

  ensureEnt(p) {
    let e = this.ents.get(p.id);
    if (e) return e;
    const info = this.roster.get(p.id);
    const root = new THREE.Group();
    const model = buildBrawler(info.brawler, info.skin);
    root.add(model);
    const rel = this.relation(p.id);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), new THREE.MeshBasicMaterial({ color: COL[rel], transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    root.add(ring);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), new THREE.MeshBasicMaterial({ color: COL.gold, transparent: true, opacity: 0, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.035;
    root.add(glow);
    const ice = new THREE.Mesh(geo.box, new THREE.MeshStandardMaterial({ color: '#b3e5fc', transparent: true, opacity: 0.55, roughness: 0.1 }));
    ice.scale.set(0.9, 1.4, 0.9); ice.position.y = 0.7; ice.visible = false;
    root.add(ice);
    const fire = new THREE.Mesh(geo.cone, new THREE.MeshBasicMaterial({ color: '#ff8f00', transparent: true, opacity: 0.8 }));
    fire.scale.set(0.18, 0.4, 0.18); fire.position.set(0.15, 1.45, 0); fire.visible = false;
    root.add(fire);
    this.scene.add(root);

    const label = document.createElement('div');
    label.className = 'plabel ' + rel;
    label.innerHTML = `<div class="pname">${escapeHtml(info.name)}</div><div class="hpbar"><div class="hpfill"></div><span class="hptext"></span></div>${rel === 'self' ? '<div class="ammo"><i></i><i></i><i></i></div>' : ''}`;
    this.overlay.appendChild(label);
    const mats = [];
    model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
    e = { root, model, ring, glow, ice, fire, label, mats, hpFill: label.querySelector('.hpfill'), hpText: label.querySelector('.hptext'), ammo: label.querySelectorAll('.ammo i'), phase: 0, flash: 0, info, rel, x: p.x, y: p.y, recoil: 0, transparent: false };
    this.ents.set(p.id, e);
    return e;
  }

  // ---------------- Pro Frame ----------------
  update(view, dt) {
    this.clock += dt;
    if (this.mode === 'menu') {
      if (this.menuModel) {
        this.menuModel.rotation.y += dt * 0.6;
        const parts = this.menuModel.userData.parts;
        parts.body.position.y = Math.abs(Math.sin(this.clock * 2)) * 0.04;
        animateRig(parts, 0, false, this.clock, dt, 0);
      }
      for (const d of this.menuDeco) { d.rotation.x += dt * d.userData.spin; d.rotation.y += dt * d.userData.spin * 0.7; }
      this.camera.position.set(0, 1.8, 4.4);
      this.camera.lookAt(0, 1.0, 0);
      this.camera.fov = 45; this.camera.updateProjectionMatrix();
      this.gl.render(this.menuScene, this.camera);
      return;
    }
    if (!this.scene) return;
    const seen = new Set();
    let me = null;
    for (const p of view.players) {
      seen.add(p.id);
      const e = this.ensureEnt(p);
      this.updateEnt(e, p, dt);
      if (p.id === this.youId) me = { p, e };
    }
    for (const [id, e] of this.ents) {
      if (!seen.has(id)) { e.root.visible = false; e.label.style.display = 'none'; }
    }
    // Busch durchsichtig, wenn ich drin bin
    const inBush = me && (me.p.st & 8);
    this.bushMat.opacity += ((inBush ? 0.5 : 1) - this.bushMat.opacity) * Math.min(1, dt * 8);
    if (this.waterMat) this.waterMat.emissiveIntensity = 0.3 + Math.sin(this.clock * 2) * 0.1;

    this.updateProjs(view.proj, dt);
    this.updateZonesFx(view.zones);
    if (this.zoneRing && view.zo !== undefined) {
      const o = view.zo;
      const c = o === -1 ? '#ffffff' : o === -2 ? '#ffd23f' : (o === this.myTeam ? COL.ally : COL.enemy);
      this.zoneRing.rim.material.color.set(c);
      this.zoneRing.disc.material.color.set(c);
      this.zoneRing.disc.material.opacity = 0.16 + Math.sin(this.clock * 3) * 0.05;
    }
    for (const ev of view.events) this.onEvent(ev);
    this.updateFx(dt);

    // Kamera
    const target = me ? { x: me.e.x, y: me.e.y } : (this.camPos ? this.camPos : { x: this.map.w / 2, y: this.map.h / 2 });
    if (!this.camPos) this.camPos = { x: target.x, y: target.y };
    const k = Math.min(1, dt * 7);
    this.camPos.x += (target.x - this.camPos.x) * k;
    this.camPos.y += (target.y - this.camPos.y) * k;
    const aspect = this.w / this.h;
    const zoom = aspect < 1 ? 1 + (1 - aspect) * 0.9 : 1;
    const H = 15.5 * zoom, D = 8.6 * zoom;
    const sgn = this.flip ? -1 : 1;
    // Kamera so begrenzen, dass möglichst wenig leere Fläche zu sehen ist
    const halfW = H * Math.tan((45 * Math.PI) / 360) * aspect;
    const xlo = halfW - 1, xhi = this.map.w - halfW + 1;
    const cx = xlo >= xhi ? this.map.w / 2 : Math.max(xlo, Math.min(xhi, this.camPos.x));
    const zlo = this.flip ? 5.5 * zoom : 4.5 * zoom, zhi = this.map.h - (this.flip ? 4.5 : 5.5) * zoom;
    const cz = Math.max(zlo, Math.min(zhi, this.camPos.y));
    let sx = 0, sz = 0;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); sx = (Math.random() - 0.5) * this.shake; sz = (Math.random() - 0.5) * this.shake; }
    this.camera.position.set(cx + sx, H, cz + D * sgn + sz);
    this.camera.lookAt(cx + sx, 0, cz + sgn * 0.6 + sz);
    this.camera.fov = 45; this.camera.updateProjectionMatrix();
    this.gl.render(this.scene, this.camera);
    this.updateLabels();
  }

  updateEnt(e, p, dt) {
    const alive = !!p.al;
    e.root.visible = alive;
    e.label.style.display = alive ? '' : 'none';
    if (!alive) return;
    const dx = p.x - e.x, dy = p.y - e.y;
    const moving = Math.hypot(dx, dy) / Math.max(dt, 1e-3) > 0.5;
    e.x = p.x; e.y = p.y;
    e.root.position.set(p.x, p.z || 0, p.y);
    // Drehung weich angleichen
    const want = Math.atan2(Math.cos(p.f), Math.sin(p.f));
    let cur = e.model.rotation.y;
    let diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    e.model.rotation.y = cur + diff * Math.min(1, dt * 16);
    const parts = e.model.userData.parts;
    const walking = moving && !(p.st & 2);
    if (walking) e.phase += dt * 12;
    e.recoil = Math.max(0, e.recoil - dt * 6);
    animateRig(parts, e.phase, walking, this.clock + e.info.id, dt, e.recoil);
    // Status
    e.ice.visible = !!(p.st & 2);
    e.fire.visible = !!(p.st & 4);
    if (e.fire.visible) { e.fire.scale.y = 0.35 + Math.random() * 0.15; e.fire.material.opacity = 0.6 + Math.random() * 0.3; }
    const superReady = e.rel === 'self' && (p.st & 64);
    e.glow.material.opacity = superReady ? 0.5 + Math.sin(this.clock * 6) * 0.3 : 0;
    e.ring.material.color.set(p.st & 1 ? '#4fc3f7' : COL[e.rel]);
    // Treffer-Blitz, Unverwundbarkeit, Busch
    e.flash = Math.max(0, e.flash - dt * 5);
    const inv = p.st & 16;
    const hidden = p.st & 8;
    const op = hidden ? 0.55 : (inv ? (Math.sin(this.clock * 25) > 0 ? 0.45 : 1) : 1);
    const wantT = op < 1;
    for (const m of e.mats) {
      if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
      m.opacity = op;
      if (!m.emissive) continue; // Umriss-Material
      if (!m.userData.baseE) m.userData.baseE = { c: m.emissive.clone(), i: m.emissiveIntensity };
      if (e.flash > 0) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = e.flash * 0.9; }
      else { m.emissive.copy(m.userData.baseE.c); m.emissiveIntensity = m.userData.baseE.i; }
    }
    // HP-Leiste
    const ratio = Math.max(0, p.hp / p.mhp);
    e.hpFill.style.width = (ratio * 100).toFixed(1) + '%';
    e.hpText.textContent = Math.max(0, Math.ceil(p.hp));
    if (e.ammo.length && p.am !== undefined) {
      e.ammo.forEach((el, i) => { const v = Math.max(0, Math.min(1, p.am - i)); el.style.setProperty('--v', v); el.classList.toggle('full', v >= 1); });
    }
  }

  updateLabels() {
    for (const e of this.ents.values()) {
      if (!e.root.visible) continue;
      tmpV.set(e.x, (e.root.position.y || 0) + 1.75 * (e.info.brawler === 'brocken' ? 1.1 : 1), e.y).project(this.camera);
      const sx = (tmpV.x * 0.5 + 0.5) * this.w, sy = (-tmpV.y * 0.5 + 0.5) * this.h;
      e.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const f of this.fx) {
      if (!f.el) continue;
      tmpV.set(f.x, f.z + f.t * 1.4, f.y).project(this.camera);
      const sx = (tmpV.x * 0.5 + 0.5) * this.w, sy = (-tmpV.y * 0.5 + 0.5) * this.h;
      f.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(1.25 - f.t * 0.5).toFixed(2)})`;
      f.el.style.opacity = String(1 - Math.max(0, (f.t - f.dur * 0.6) / (f.dur * 0.4)));
    }
  }

  // ---------------- Projektile ----------------
  makeProj(b) {
    const g = new THREE.Group();
    const own = b.tm === this.myTeam;
    const glow = (c, e, s) => { const m = new THREE.Mesh(geo.lowSphere, mat(c, { emissive: e, emissiveIntensity: 1.6 })); m.scale.setScalar(s); return m; };
    switch (b.k) {
      case 'pellet': g.add(glow('#b2ffff', '#00e5ff', 0.13)); break;
      case 'arrow': {
        const shaft = new THREE.Mesh(geo.box, mat('#8d6e63')); shaft.scale.set(0.05, 0.05, 0.7);
        const tip = new THREE.Mesh(geo.cone, mat('#fff59d', { emissive: '#ffeb3b', emissiveIntensity: 1.2 })); tip.scale.set(0.08, 0.2, 0.08); tip.rotation.x = Math.PI / 2; tip.position.z = 0.4;
        g.add(shaft, tip); break;
      }
      case 'ice': { const m = new THREE.Mesh(geo.octa, mat('#e1f5fe', { emissive: '#29b6f6', emissiveIntensity: 1.3 })); m.scale.set(0.14, 0.14, 0.4); g.add(m); break; }
      case 'boom': { const m = buildBoomerang(mat('#e040fb', { emissive: '#aa00ff', emissiveIntensity: 0.8 })); m.scale.setScalar(1.6); g.add(m); g.userData.spin = true; break; }
      case 'flame': {
        const m = new THREE.Mesh(geo.lowSphere, new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#ffab00' : '#ff5722', transparent: true, opacity: 0.85 }));
        m.scale.setScalar(0.22); g.add(m); g.userData.grow = true; break;
      }
      case 'bomb': case 'megabomb': {
        const big = b.k === 'megabomb';
        const m = new THREE.Mesh(geo.sphere, mat('#222')); m.scale.setScalar(big ? 0.34 : 0.18); m.castShadow = true;
        const f = glow('#ffcc80', '#ff6d00', big ? 0.1 : 0.06); f.position.y = big ? 0.36 : 0.2;
        g.add(m, f); g.userData.spinX = true; break;
      }
      case 'heal': { g.add(glow('#ccff90', '#00e676', 0.2)); break; }
      default: g.add(glow('#fff', '#fff', 0.12));
    }
    if (b.tx !== undefined) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(b.r * 0.9, b.r, 40), new THREE.MeshBasicMaterial({ color: b.k === 'heal' ? '#69f0ae' : (own ? '#ffffff' : COL.enemy), transparent: true, opacity: 0.6, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(b.tx, 0.05, b.ty);
      this.scene.add(ring);
      g.userData.ring = ring;
    }
    this.scene.add(g);
    return g;
  }

  updateProjs(list, dt) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let g = this.projs.get(b.id);
      if (!g) { g = this.makeProj(b); this.projs.set(b.id, g); }
      g.position.set(b.x, b.z !== undefined ? b.z : 0.6, b.y);
      if (b.a !== undefined) g.rotation.y = Math.atan2(Math.cos(b.a), Math.sin(b.a));
      if (g.userData.spin) g.children[0].rotation.y += dt * 20;
      if (g.userData.spinX) g.rotation.x += dt * 6;
      if (g.userData.grow) { const c = g.children[0]; c.scale.multiplyScalar(1 + dt * 2.2); c.material.opacity = Math.max(0.2, c.material.opacity - dt * 1.2); }
      if (g.userData.ring) g.userData.ring.material.opacity = 0.45 + Math.sin(this.clock * 12) * 0.2;
    }
    for (const [id, g] of this.projs) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      if (g.userData.ring) this.scene.remove(g.userData.ring);
      this.projs.delete(id);
    }
  }

  updateZonesFx(list) {
    const seen = new Set();
    for (const z of list) {
      seen.add(z.id);
      let o = this.zones.get(z.id);
      if (!o) {
        const fire = z.k === 'fire';
        const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 32), new THREE.MeshBasicMaterial({ color: fire ? '#ff6d00' : '#69f0ae', transparent: true, opacity: 0.5, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(z.x, 0.04, z.y);
        const g = new THREE.Group(); g.add(disc);
        const parts = [];
        for (let i = 0; i < (fire ? 4 : 6); i++) {
          const p = new THREE.Mesh(fire ? geo.cone : geo.lowSphere, new THREE.MeshBasicMaterial({ color: fire ? (i % 2 ? '#ffab00' : '#ff3d00') : '#b9f6ca', transparent: true, opacity: 0.85 }));
          p.userData.o = Math.random() * 6; p.userData.a = Math.random() * 6; p.userData.d = Math.random() * z.r * 0.8;
          g.add(p); parts.push(p);
        }
        this.scene.add(g);
        o = { g, disc, parts, z, fire };
        this.zones.set(z.id, o);
      }
      const T = this.clock;
      o.disc.material.opacity = 0.35 + Math.sin(T * 8 + z.id) * 0.1;
      for (const p of o.parts) {
        const u = p.userData;
        if (o.fire) {
          p.position.set(z.x + Math.cos(u.a) * u.d, 0.25, z.y + Math.sin(u.a) * u.d);
          const s = 0.2 + Math.abs(Math.sin(T * 9 + u.o)) * 0.25;
          p.scale.set(s * 0.8, s * 2, s * 0.8);
        } else {
          const k = ((T * 0.6 + u.o) % 1);
          p.position.set(z.x + Math.cos(u.a + T) * u.d, k * 1.8, z.y + Math.sin(u.a + T) * u.d);
          p.scale.setScalar(0.08 * (1 - k) + 0.02);
        }
      }
    }
    for (const [id, o] of this.zones) if (!seen.has(id)) { this.scene.remove(o.g); this.zones.delete(id); }
  }

  // ---------------- Effekte ----------------
  onEvent(ev) {
    switch (ev.e) {
      case 'hit': {
        const e = this.ents.get(ev.id);
        if (e) e.flash = 1;
        const rel = this.relation(ev.id);
        this.number(ev.x, ev.y, ev.a, rel === 'self' ? 'dmg-self' : 'dmg');
        if (ev.id === this.youId) this.shake = Math.min(0.5, this.shake + 0.15);
        break;
      }
      case 'heal': this.number(ev.x, ev.y, '+' + ev.a, 'heal'); break;
      case 'boom': this.blast(ev.x, ev.y, ev.r, ev.k); break;
      case 'cone': this.coneFx(ev); { const e = this.ents.get(ev.id); if (e) e.recoil = 1; } break;
      case 'atk': { const e = this.ents.get(ev.id); if (e) e.recoil = 1; break; }
      case 'pop': this.spark(ev.x, ev.y, ev.k); break;
      case 'ko': this.poof(ev.x, ev.y); break;
      case 'sup': this.blast(ev.x, ev.y, 1.2, 'super'); break;
      case 'tiles': this.applyTiles(ev.list); this.shake = 0.4; break;
    }
  }

  addFx(f) { this.fx.push(Object.assign({ t: 0, x: 0, y: 0, z: 0 }, f)); }

  number(x, y, val, cls) {
    const el = document.createElement('div');
    el.className = 'dnum ' + cls;
    el.textContent = val;
    this.overlay.appendChild(el);
    this.addFx({ el, x: x + (Math.random() - 0.5) * 0.4, y, z: 1.6, dur: 0.9 });
  }

  blast(x, y, r, k) {
    const colors = { bomb: '#ff9100', megabomb: '#ff3d00', heal: '#69f0ae', quake: '#bcaaa4', frost: '#80d8ff', super: '#ffd23f', boom: '#ffab40' };
    const c = colors[k] || '#ffab40';
    const sph = new THREE.Mesh(geo.lowSphere, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, depthWrite: false }));
    sph.position.set(x, 0.1, y);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.06, y);
    this.scene.add(sph, ring);
    const dur = k === 'super' ? 0.45 : 0.5;
    this.addFx({ dur, objs: [sph, ring], up: (t) => {
      const q = t / dur;
      sph.scale.set(r * q, r * q * (k === 'frost' || k === 'heal' ? 0.25 : 0.6), r * q);
      sph.material.opacity = 0.6 * (1 - q);
      ring.scale.setScalar(r * (0.3 + q * 0.75));
      ring.material.opacity = 0.9 * (1 - q);
    } });
    if (k === 'bomb' || k === 'megabomb' || k === 'quake') { this.debris(x, y, k === 'quake' ? '#8d6e63' : '#424242', k === 'megabomb' ? 10 : 5); this.shake = Math.min(0.7, this.shake + (k === 'megabomb' ? 0.5 : 0.2)); }
  }

  coneFx(ev) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(ev.r, 20, -ev.w, ev.w * 2), new THREE.MeshBasicMaterial({ color: '#fff3e0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    g.rotation.set(-Math.PI / 2, 0, -ev.a);
    g.position.set(ev.x, 0.1, ev.y);
    this.scene.add(g);
    this.addFx({ dur: 0.22, objs: [g], up: (t) => { g.material.opacity = 0.55 * (1 - t / 0.22); g.scale.setScalar(0.6 + t * 2); } });
  }

  spark(x, y, k) {
    const c = { pellet: '#00e5ff', arrow: '#ffeb3b', ice: '#80d8ff', flame: '#ff9100', boom: '#e040fb' }[k] || '#fff';
    const m = new THREE.Mesh(geo.lowSphere, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
    m.position.set(x, 0.6, y);
    this.scene.add(m);
    this.addFx({ dur: 0.18, objs: [m], up: (t) => { m.scale.setScalar(0.1 + t * 2); m.material.opacity = 0.9 * (1 - t / 0.18); } });
  }

  poof(x, y) {
    const objs = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(geo.lowSphere, new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffffff' : '#cfd8dc', transparent: true, opacity: 0.9 }));
      m.position.set(x, 0.6, y);
      const a = (i / 10) * Math.PI * 2;
      m.userData.v = new THREE.Vector3(Math.cos(a) * 2, 1.5 + Math.random(), Math.sin(a) * 2);
      this.scene.add(m); objs.push(m);
    }
    this.addFx({ dur: 0.7, objs, up: (t, dt) => {
      for (const m of objs) { m.position.addScaledVector(m.userData.v, dt); m.userData.v.multiplyScalar(0.92); m.scale.setScalar(0.25 * (1 - t / 0.7) + 0.05); m.material.opacity = 0.9 * (1 - t / 0.7); }
    } });
  }

  debris(x, y, color, n) {
    const objs = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo.box, mat(color));
      m.scale.setScalar(0.12 + Math.random() * 0.15);
      m.position.set(x + (Math.random() - 0.5) * 0.6, 0.5, y + (Math.random() - 0.5) * 0.6);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5);
      m.castShadow = true;
      this.scene.add(m); objs.push(m);
    }
    this.addFx({ dur: 1.0, objs, up: (t, dt) => {
      for (const m of objs) {
        m.userData.v.y -= 14 * dt;
        m.position.addScaledVector(m.userData.v, dt);
        if (m.position.y < 0.05) { m.position.y = 0.05; m.userData.v.set(0, 0, 0); }
        m.rotation.x += dt * 6; m.rotation.z += dt * 4;
        if (t > 0.7) m.scale.multiplyScalar(0.85);
      }
    } });
  }

  updateFx(dt) {
    const keep = [];
    for (const f of this.fx) {
      f.t += dt;
      if (f.up) f.up(f.t, dt);
      if (f.t >= f.dur) {
        if (f.objs) for (const o of f.objs) this.scene.remove(o);
        if (f.el) f.el.remove();
        continue;
      }
      keep.push(f);
    }
    this.fx = keep;
  }

  // Bildschirm -> Boden (für Mauszielen)
  screenToGround(sx, sy) {
    const ndc = new THREE.Vector3((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    if (Math.abs(dir.y) < 1e-4) return null;
    const t = -this.camera.position.y / dir.y;
    return { x: this.camera.position.x + dir.x * t, y: this.camera.position.z + dir.z * t };
  }

  endGame() {
    this.scene = null;
    this.overlay.innerHTML = '';
    this.ents = new Map();
  }
}

// Lauf-, Atem- und Rückstoß-Animation der Figuren
function animateRig(parts, phase, walking, clock, dt, recoil) {
  const k = Math.min(1, dt * 14);
  const sw = Math.sin(phase);
  const body = parts.body;
  if (walking) {
    body.position.y = Math.abs(Math.cos(phase)) * 0.06;
    body.rotation.x += (0.12 - body.rotation.x) * k;
  } else {
    body.position.y += (0 - body.position.y) * k;
    body.rotation.x += (0 - body.rotation.x) * k;
    if (parts.torso) parts.torso.scale.y = parts.s.torsoH * (1 + Math.sin(clock * 3) * 0.04);
  }
  if (parts.legs) parts.legs.forEach((l, i) => { const t = walking ? (i ? -sw : sw) * 0.75 : 0; l.rotation.x += (t - l.rotation.x) * k; });
  if (parts.arms) parts.arms.forEach((a, i) => {
    const base = a.userData.base || 0;
    let t = base;
    if (a.userData.swing) t = walking ? (i ? sw : -sw) * 0.65 : Math.sin(clock * 2 + i) * 0.05;
    else if (walking) t = base + sw * 0.08;
    if (a === parts.armR) t -= recoil * 0.45;
    a.rotation.x += (t - a.rotation.x) * Math.min(1, dt * 20);
  });
  body.position.z = -recoil * 0.08;
  if (parts.anim) for (const f of parts.anim) f(clock, dt, walking);
}

export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export { COL };
