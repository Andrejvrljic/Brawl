// Steuerung: Tastatur + Maus (PC) und zwei virtuelle Joysticks (Handy/Tablet)
export class Input {
  constructor(root) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.handlers = {};
    this.enabled = false;
    // Joystick-Zustände (Bildschirmkoordinaten, y nach unten)
    this.move = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.aimStick = { id: null, ox: 0, oy: 0, x: 0, y: 0, kind: null };
    this.root = root;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'e' || k === 'q') { e.preventDefault(); if (!e.repeat) this.emit('super', { mouse: true }); }
      if (k === 'escape') this.emit('menu');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    root.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touchMode) return;
      if (e.button === 0) { this.mouseHeld = true; this.emit('attack', { mouse: true }); }
      if (e.button === 2) this.emit('super', { mouse: true });
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseHeld = false; });
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch
    this.ui = {
      moveBase: document.getElementById('stickMove'),
      moveKnob: document.querySelector('#stickMove .knob'),
      atk: document.getElementById('btnAtk'),
      sup: document.getElementById('btnSup'),
    };
    root.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    root.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    root.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    root.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, data) { if (this.handlers[name]) this.handlers[name](data); }

  hitButton(el, t) {
    if (!el || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.hypot(t.clientX - cx, t.clientY - cy) < r.width * 0.75;
  }

  onTouchStart(e) {
    if (!this.enabled) return;
    this.touchMode = true;
    document.body.classList.add('touch');
    for (const t of e.changedTouches) {
      if (this.aimStick.id === null && (this.hitButton(this.ui.sup, t) || this.hitButton(this.ui.atk, t))) {
        const kind = this.hitButton(this.ui.sup, t) ? 'super' : 'attack';
        const el = kind === 'super' ? this.ui.sup : this.ui.atk;
        const r = el.getBoundingClientRect();
        Object.assign(this.aimStick, { id: t.identifier, ox: r.left + r.width / 2, oy: r.top + r.height / 2, x: 0, y: 0, kind, t0: performance.now() });
        el.classList.add('active');
      } else if (this.move.id === null && t.clientX < window.innerWidth * 0.5) {
        Object.assign(this.move, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        const b = this.ui.moveBase;
        b.style.left = t.clientX + 'px'; b.style.top = t.clientY + 'px';
        b.classList.add('active');
      }
    }
    e.preventDefault();
  }

  onTouchMove(e) {
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.move.id) {
        let dx = t.clientX - this.move.ox, dy = t.clientY - this.move.oy;
        const R = 55, l = Math.hypot(dx, dy);
        if (l > R) {
          // Joystick folgt dem Finger
          this.move.ox += (dx / l) * (l - R); this.move.oy += (dy / l) * (l - R);
          dx = (dx / l) * R; dy = (dy / l) * R;
          this.ui.moveBase.style.left = this.move.ox + 'px'; this.ui.moveBase.style.top = this.move.oy + 'px';
        }
        this.move.x = dx / R; this.move.y = dy / R;
        this.ui.moveKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (t.identifier === this.aimStick.id) {
        let dx = t.clientX - this.aimStick.ox, dy = t.clientY - this.aimStick.oy;
        const R = 70, l = Math.hypot(dx, dy);
        if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
        this.aimStick.x = dx / R; this.aimStick.y = dy / R;
        const el = this.aimStick.kind === 'super' ? this.ui.sup : this.ui.atk;
        el.querySelector('.knob').style.transform = `translate(${dx * 0.6}px, ${dy * 0.6}px)`;
      }
    }
    e.preventDefault();
  }

  onTouchEnd(e) {
    if (!this.enabled && this.move.id === null && this.aimStick.id === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.move.id) {
        this.move.id = null; this.move.x = this.move.y = 0;
        this.ui.moveKnob.style.transform = '';
        this.ui.moveBase.classList.remove('active');
      } else if (t.identifier === this.aimStick.id) {
        const s = this.aimStick;
        const mag = Math.hypot(s.x, s.y);
        if (this.enabled) this.emit(s.kind, mag > 0.25 ? { stick: true, sx: s.x, sy: s.y, mag } : { auto: true });
        const el = s.kind === 'super' ? this.ui.sup : this.ui.atk;
        el.classList.remove('active');
        el.querySelector('.knob').style.transform = '';
        s.id = null; s.x = s.y = 0; s.kind = null;
      }
    }
    if (this.enabled) e.preventDefault();
  }

  // Bewegung in Bildschirmrichtung (x rechts, y unten)
  moveVector() {
    let x = 0, y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.move.id !== null) { x = this.move.x; y = this.move.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (l < 0.15) { x = 0; y = 0; }
    return { x, y };
  }

  // Aktuelles Zielen per Joystick (für die Zielanzeige)
  aiming() {
    const s = this.aimStick;
    if (s.id === null) return null;
    const mag = Math.hypot(s.x, s.y);
    if (mag < 0.25) return { kind: s.kind, auto: true };
    return { kind: s.kind, sx: s.x, sy: s.y, mag };
  }

  reset() {
    this.keys.clear();
    this.move.id = null; this.move.x = this.move.y = 0;
    this.aimStick.id = null;
    this.mouseHeld = false;
  }
}
