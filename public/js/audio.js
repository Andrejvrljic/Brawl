// Kleine Soundeffekte per WebAudio (keine Dateien nötig)
let ctx = null;
let enabled = true;
export function setSound(on) { enabled = on; }
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function unlockAudio() { ac(); }

function tone(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  const c = ac(); if (!c || !enabled) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol = 0.1, freq = 1200) {
  const c = ac(); if (!c || !enabled) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination);
  s.start();
}

const SHOT = {
  funke: () => tone(880, 0.08, 'square', 0.04, 0.5),
  brocken: () => noise(0.12, 0.15, 500),
  pfeil: () => tone(1400, 0.1, 'triangle', 0.06, 0.4),
  bummi: () => tone(300, 0.15, 'sine', 0.08, 1.8),
  frost: () => tone(1800, 0.12, 'sine', 0.05, 0.7),
  wirbel: () => tone(600, 0.15, 'sawtooth', 0.03, 1.5),
  glut: () => noise(0.18, 0.08, 2500),
  heila: () => tone(660, 0.18, 'sine', 0.06, 1.5),
};

export function sfx(name, k) {
  if (!enabled) return;
  switch (name) {
    case 'atk': (SHOT[k] || SHOT.funke)(); break;
    case 'sup': tone(400, 0.35, 'sawtooth', 0.06, 3); break;
    case 'hit': tone(220, 0.06, 'square', 0.03, 0.6); break;
    case 'hurt': tone(140, 0.12, 'square', 0.06, 0.5); break;
    case 'boom': noise(0.4, 0.2, 700); break;
    case 'ko': tone(500, 0.3, 'triangle', 0.08, 0.3); break;
    case 'heal': tone(900, 0.12, 'sine', 0.03, 1.3); break;
    case 'go': tone(523, 0.12, 'square', 0.06); setTimeout(() => tone(784, 0.25, 'square', 0.06), 120); break;
    case 'tick': tone(660, 0.06, 'square', 0.04); break;
    case 'click': tone(1000, 0.04, 'triangle', 0.05); break;
    case 'reward': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.06), i * 90)); break;
    case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'square', 0.05), i * 120)); break;
    case 'lose': [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.06), i * 160)); break;
  }
}
