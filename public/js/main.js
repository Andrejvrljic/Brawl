// Kistenkrawall – Hauptprogramm: Menüs, Belohnungen, Spielschleife
import * as THREE from 'three';
import { Renderer, escapeHtml } from './render.js';
import { buildBrawler } from './models.js';
import { Input } from './input.js';
import { LocalSession, NetSession, serverUrl } from './session.js';
import { sfx, setSound, unlockAudio } from './audio.js';
import { BRAWLERS, BRAWLER_ORDER, MAX_LEVEL, SKIN_NAMES, SKIN_COST, levelMult } from '../shared/brawlers.js';
import { MODES } from '../shared/game.js';
import { save, account, initSave, act, reportMatch, signup, login, logout, leaderboard, token, isLoggedIn, totalTrophies, isUnlocked, ROAD, roadAvailable, UPGRADE_COST } from './save.js';
import { Friends } from './friends.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new Renderer(canvas, $('overlay'));
const input = new Input(document.body);

const state = { screen: 'home', mode: 'teamko', online: !!serverUrl(), session: null, lastView: null, selDetail: save.selected };

// ---------- Porträts der Brawler (einmal gerendert) ----------
const portraits = {};
function makePortraits() {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#554466', 2.2));
  const d = new THREE.DirectionalLight('#ffffff', 2.4); d.position.set(2, 4, 5); scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  for (const k of BRAWLER_ORDER) {
    for (let s = 0; s < 3; s++) {
      const m = buildBrawler(k, s);
      m.rotation.y = 0.45;
      scene.add(m);
      const big = k === 'brocken';
      cam.position.set(0, big ? 1.2 : 1.05, big ? 3.6 : 3.1);
      cam.lookAt(0, big ? 0.85 : 0.72, 0);
      r.render(scene, cam);
      portraits[k + s] = c.toDataURL();
      scene.remove(m);
    }
  }
  r.dispose();
  r.forceContextLoss?.();
}
makePortraits();
const portrait = (k, s = save.skinSel[k] || 0) => portraits[k + s];

// ---------- Allgemeines UI ----------
function show(id) {
  for (const s of ['auth', 'home', 'brawlers', 'road', 'boxes', 'ranking', 'friends', 'lobby', 'results']) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', id !== 'game');
  state.screen = id;
  if (id === 'home') refreshHome();
  if (id === 'brawlers') renderBrawlers();
  if (id === 'road') renderRoad();
  if (id === 'boxes') renderBoxes();
  if (id === 'ranking') renderRanking();
  if (id === 'friends') { renderFriends(); friends.send({ t: 'friends' }); }
  if (['auth', 'home', 'brawlers', 'road', 'boxes', 'ranking', 'friends'].includes(id) && renderer.mode !== 'menu') renderer.showMenu(save.selected, save.skinSel[save.selected]);
}

let toastT = 0;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.innerHTML = msg;
  t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

document.addEventListener('click', (e) => {
  unlockAudio();
  const go = e.target.closest('[data-go]');
  if (go) { sfx('click'); show(go.dataset.go); }
});

function refreshHome() {
  const k = save.selected, def = BRAWLERS[k];
  $('playerName').textContent = save.name;
  $('accIco').textContent = isLoggedIn() ? '👤' : '💾';
  $('badgeFriends').textContent = friends.badge || '';
  $('resTroph').textContent = totalTrophies();
  $('resCoins').textContent = save.coins;
  $('resGems').textContent = save.gems;
  $('selName').textContent = def.name;
  $('selMeta').textContent = `${def.role} · Stufe ${save.levels[k]} · 🏆 ${save.trophies[k]}`;
  $('modeName').textContent = MODES[state.mode].name;
  $('boxMeterFill').style.width = save.boxMeter + '%';
  $('badgeRoad').textContent = roadAvailable() || '';
  $('badgeBox').textContent = save.boxes || '';
  $('btnSound').textContent = save.sound ? '🔊' : '🔇';
  $('netOnline').classList.toggle('on', state.online);
  $('netOffline').classList.toggle('on', !state.online);
  $('btnCreate').disabled = $('btnJoin').disabled = !state.online;
  $('onlineInfo').textContent = state.online ? (serverUrl() ? 'Online-Match · freie Plätze werden mit Bots gefüllt' : '') : 'Offline-Training gegen Bots';
  if (renderer.menuKey !== k + save.skinSel[k]) renderer.showMenu(k, save.skinSel[k]);
}

$('btnSound').onclick = async () => { await act({ type: 'sound', on: !save.sound }); setSound(save.sound); refreshHome(); };
$('btnName').onclick = () => accountModal();

// ---------- Konto (Datenbank) ----------
function accountModal(msg = '') {
  const on = isLoggedIn();
  const status = on
    ? `Angemeldet als <b>${escapeHtml(account.login)}</b> – dein Fortschritt ist in der Datenbank gesichert. Platz <b>${account.rank}</b> in der Rangliste.`
    : '💾 Kein Server verbunden – du spielst offline gegen Bots, der Fortschritt bleibt nur in diesem Browser.';
  modal(`<h2>Konto</h2>
    <p class="hint" style="text-align:left;max-width:none">${status}</p>
    <label class="flabel">Name im Spiel</label>
    <div class="row"><input id="nameIn" maxlength="14" value="${escapeHtml(save.name)}"><button class="btn" id="nameOk" style="flex:0 0 auto;margin-bottom:12px">Speichern</button></div>
    ${on ? '<div class="row"><button class="btn gold" id="logoutOk">Abmelden</button></div>' : ''}
    <div class="formmsg" id="accMsg">${msg}</div>`);
  const setMsg = (m) => { $('accMsg').textContent = m; };
  $('nameOk').onclick = async () => {
    const r = await act({ type: 'rename', name: $('nameIn').value });
    if (!r || r.error) setMsg(r?.error || 'Ungültiger Name.'); else { setMsg('Name gespeichert ✔'); refreshHome(); }
  };
  if ($('logoutOk')) $('logoutOk').onclick = async () => {
    await logout();
    friends.stop();
    closeModal();
    showAuth('auth');
    toast('Abgemeldet.');
  };
}

// ---------- Anmelden / Konto erstellen ----------
let authMode = 'signup';
function setAuthMode(m) {
  authMode = m;
  $('tabSignup').classList.toggle('on', m === 'signup');
  $('tabLogin').classList.toggle('on', m === 'login');
  $('authPass2Wrap').style.display = m === 'signup' ? '' : 'none';
  $('authPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('authOk').textContent = m === 'signup' ? "LOS GEHT'S" : 'ANMELDEN';
  $('authMsg').textContent = '';
}
$('tabSignup').onclick = () => setAuthMode('signup');
$('tabLogin').onclick = () => setAuthMode('login');

function showAuth(st) {
  const offline = st === 'offline';
  $('authForm').style.display = offline ? 'none' : '';
  document.querySelector('.authtabs').style.display = offline ? 'none' : '';
  $('authOffline').style.display = offline ? '' : 'none';
  $('authHint').textContent = offline
    ? 'Der Spielserver ist gerade nicht erreichbar. Konten, Freunde und Online-Spiele gehen nur mit Server – offline kannst du gegen Bots üben.'
    : 'Dein Benutzername ist gleichzeitig dein Name im Spiel. Freunde finden dich damit.';
  if (!offline && account.mode === 'server' && !account.registered && token()) {
    $('authHint').textContent = 'Du hast schon gespielt – erstelle jetzt dein Konto, dein Fortschritt bleibt erhalten.';
  }
  setAuthMode(authMode);
  show('auth');
}

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const user = $('authUser').value.trim(), pass = $('authPass').value;
  const msg = (t) => { $('authMsg').textContent = t; };
  if (user.length < 3) return msg('Benutzername: mindestens 3 Zeichen.');
  if (pass.length < 6) return msg('Passwort: mindestens 6 Zeichen.');
  if (authMode === 'signup' && pass !== $('authPass2').value) return msg('Die Passwörter stimmen nicht überein.');
  $('authOk').disabled = true;
  msg(authMode === 'signup' ? 'Erstelle Konto…' : 'Melde an…');
  const err = authMode === 'signup' ? await signup(user, pass) : await login(user, pass);
  $('authOk').disabled = false;
  if (err) return msg(err);
  $('authPass').value = $('authPass2').value = '';
  sfx('reward');
  enterGame();
  toast(authMode === 'signup' ? `Willkommen, <b>${escapeHtml(save.name)}</b>! Füge unter 👥 Freunde hinzu.` : `Willkommen zurück, <b>${escapeHtml(save.name)}</b>!`, 3500);
});
$('authOffline').onclick = () => { state.online = false; enterGame(); };

// Nach dem Anmelden: Menü und Freunde-Verbindung starten
function enterGame() {
  state.online = isLoggedIn();
  setSound(save.sound);
  if (isLoggedIn()) friends.start(token());
  show('home');
}

// ---------- Freunde ----------
const friends = new Friends({
  onChange: () => {
    $('badgeFriends').textContent = friends.badge || '';
    if (state.screen === 'friends') renderFriends();
  },
  onMsg: (m) => {
    const el = $('friendMsg');
    if (el) { el.textContent = m.error || m.ok || ''; el.style.color = m.error ? '#ff8a8e' : ''; }
    if (state.screen !== 'friends' && (m.error || m.ok)) toast(escapeHtml(m.error || m.ok));
  },
  onRequest: (from) => { sfx('reward'); if (state.screen !== 'game') toast(`👥 <b>${escapeHtml(from.name)}</b> möchte dein Freund sein!`, 3500); },
  onInvite: (inv) => {
    sfx('reward');
    if (state.screen === 'game' || state.screen === 'lobby') { toast(`⚔️ <b>${escapeHtml(inv.from.name)}</b> lädt dich ein – nach dem Match unter 👥 Freunde beitreten.`, 4000); return; }
    modal(`<h2>⚔️ Einladung</h2>
      <p class="hint" style="max-width:none"><b>${escapeHtml(inv.from.name)}</b> lädt dich zu <b>${MODES[inv.mode]?.name || 'einem Match'}</b> ein.</p>
      <div class="row"><button class="btn grey" id="invNo">Später</button><button class="btn gold" id="invYes">Beitreten</button></div>`);
    $('invNo').onclick = closeModal;
    $('invYes').onclick = () => { closeModal(); joinInvite(inv); };
  },
});

function joinInvite(inv) {
  friends.dropInvite(inv.code);
  if (!isLoggedIn()) return;
  state.mode = inv.mode;
  startOnline({ code: inv.code });
}

const STATUS_TXT = { online: 'online', lobby: 'in der Lobby', ingame: 'spielt gerade', offline: 'offline' };
function renderFriends() {
  const el = $('friendLists');
  if (!isLoggedIn()) { el.innerHTML = '<p class="hint">Freunde gibt es nur mit Konto und Server.</p>'; return; }
  const row = (f, buttons, sub = '') => `<div class="frow"><span class="dot ${f.online || ''}"></span><div class="fname">${escapeHtml(f.name)}<small>${sub}</small></div>${buttons}</div>`;
  let html = '';
  const inv = friends.openInvites;
  if (inv.length) {
    html += `<div class="fsec"><h3>⚔️ Einladungen</h3>${inv.map((i) => `<div class="frow invite"><div class="fname">${escapeHtml(i.from.name)}<small>${MODES[i.mode]?.name || ''} · Raum ${i.code}</small></div><button class="btn gold" data-join="${i.code}">Beitreten</button></div>`).join('')}</div>`;
  }
  const inc = friends.incoming;
  if (inc.length) {
    html += `<div class="fsec"><h3>Freundschaftsanfragen</h3>${inc.map((f) => row(f, `<button class="btn" data-accept="${f.id}">Annehmen</button><button class="btn grey" data-decline="${f.id}">✕</button>`, '@' + escapeHtml(f.login) + ' · 🏆 ' + f.trophies)).join('')}</div>`;
  }
  const fr = [...friends.friends].sort((a, b) => (a.online === 'offline') - (b.online === 'offline'));
  html += `<div class="fsec"><h3>Deine Freunde (${fr.length})</h3>${fr.length ? fr.map((f) => row(f,
    `${f.online === 'online' ? `<button class="btn gold" data-invite="${f.id}">Einladen</button>` : ''}<button class="btn grey" data-remove="${f.id}" title="Entfernen">✕</button>`,
    `${STATUS_TXT[f.online] || 'offline'} · 🏆 ${f.trophies}`)).join('') : '<p class="hint">Noch keine Freunde. Gib oben den Benutzernamen deines Freundes ein!</p>'}</div>`;
  const out = friends.outgoing;
  if (out.length) html += `<div class="fsec"><h3>Gesendete Anfragen</h3>${out.map((f) => row(f, `<button class="btn grey" data-remove="${f.id}">Zurückziehen</button>`, 'wartet auf Antwort')).join('')}</div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-accept]').forEach((b) => b.onclick = () => { friends.answer(+b.dataset.accept, true); sfx('reward'); });
  el.querySelectorAll('[data-decline]').forEach((b) => b.onclick = () => friends.answer(+b.dataset.decline, false));
  el.querySelectorAll('[data-remove]').forEach((b) => b.onclick = () => {
    const f = friends.list.find((x) => x.id === +b.dataset.remove);
    modal(`<h2>${f && f.status === 'friend' ? 'Freund entfernen?' : 'Anfrage zurückziehen?'}</h2><p class="hint" style="max-width:none">${escapeHtml(f ? f.name : '')}</p><div class="row"><button class="btn grey" id="rmNo">Abbrechen</button><button class="btn gold" id="rmYes">Ja</button></div>`);
    $('rmNo').onclick = closeModal;
    $('rmYes').onclick = () => { closeModal(); friends.remove(+b.dataset.remove); };
  });
  el.querySelectorAll('[data-invite]').forEach((b) => b.onclick = () => inviteFriend(+b.dataset.invite));
  el.querySelectorAll('[data-join]').forEach((b) => b.onclick = () => { const i = inv.find((x) => x.code === b.dataset.join); if (i) joinInvite(i); });
}

$('addFriendForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('addFriendIn').value.trim();
  if (v.length < 3) { $('friendMsg').textContent = 'Gib den Benutzernamen deines Freundes ein.'; return; }
  if (!friends.add(v)) { $('friendMsg').textContent = 'Keine Verbindung zum Server – kurz warten.'; return; }
  $('addFriendIn').value = '';
});

// Freund einladen: eigenen privaten Raum öffnen (falls nötig) und Einladung schicken
function inviteFriend(id) {
  if (state.lobbyCode && state.screen === 'lobby') {
    friends.invite(id, state.lobbyCode);
    return;
  }
  state.pendingInvite = id;
  startOnline({ create: true });
}

// ---------- Rangliste ----------
async function renderRanking() {
  const el = $('rankList');
  if (account.mode !== 'server') { el.innerHTML = '<p class="hint">Die Rangliste braucht den Server mit Datenbank.</p>'; return; }
  el.innerHTML = '<p class="hint">Lade…</p>';
  try {
    const top = await leaderboard();
    if (!top.length) { el.innerHTML = '<p class="hint">Noch niemand in der Rangliste – spiel ein Match!</p>'; return; }
    el.innerHTML = `<table class="restable"><tr><th>#</th><th>Spieler</th><th>🏆</th></tr>${top.map((p, i) =>
      `<tr class="${p.name === save.name && p.trophies === totalTrophies() ? 'me' : ''}"><td>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td>${escapeHtml(p.name)}</td><td>${p.trophies}</td></tr>`).join('')}</table>`;
  } catch { el.innerHTML = '<p class="hint">Rangliste konnte nicht geladen werden.</p>'; }
}
$('netOnline').onclick = () => {
  if (!serverUrl() || account.mode !== 'server') { toast('Der Spielserver ist nicht erreichbar – hier kannst du gegen Bots spielen.', 4000); return; }
  if (needAccount()) return;
  state.online = true; refreshHome();
};
$('netOffline').onclick = () => { state.online = false; refreshHome(); };

function modal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

$('btnMode').onclick = () => {
  modal('<h2>Spielmodus wählen</h2>' + Object.values(MODES).map((m) => `<button class="modeopt ${m.key === state.mode ? 'sel' : ''}" data-mode="${m.key}"><b>${m.name}</b><span>${m.desc}</span></button>`).join(''));
  $('modalBox').querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { state.mode = b.dataset.mode; sfx('click'); closeModal(); refreshHome(); });
};

// ---------- Brawler-Bildschirm ----------
function renderBrawlers() {
  const grid = $('brawlerGrid');
  const tt = totalTrophies();
  grid.innerHTML = BRAWLER_ORDER.map((k) => {
    const d = BRAWLERS[k], un = isUnlocked(k);
    return `<div class="card ${un ? '' : 'locked'} ${state.selDetail === k ? 'sel' : ''}" data-k="${k}">
      <img src="${portrait(k)}" alt="">
      ${un ? '' : `<div class="lock"><b>🔒</b>${d.unlock} 🏆</div>`}
      <div class="cname">${d.name}</div>
      <div class="cmeta">${un ? `Stufe ${save.levels[k]} · 🏆 ${save.trophies[k]}` : (tt >= d.unlock ? 'Auf der Straße abholen!' : d.role)}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach((c) => c.onclick = () => { state.selDetail = c.dataset.k; sfx('click'); renderBrawlers(); });
  renderDetail();
}

function renderDetail() {
  const k = state.selDetail, d = BRAWLERS[k], un = isUnlocked(k);
  const lvl = save.levels[k], m = levelMult(lvl);
  const el = $('brawlerDetail');
  const cost = UPGRADE_COST[lvl];
  const nextM = levelMult(lvl + 1);
  el.innerHTML = `
    <h3>${d.name}</h3><div class="role">${d.role} · Stufe ${lvl}/${MAX_LEVEL}</div>
    <p>${d.desc}</p>
    <div class="stats">
      <div class="stat">Lebenspunkte<b>${Math.round(d.hp * m)}${lvl < MAX_LEVEL ? ` <small style="color:#46e05a">→ ${Math.round(d.hp * nextM)}</small>` : ''}</b></div>
      <div class="stat">Reichweite<b>${d.range} Felder</b></div>
      <div class="stat">Tempo<b>${d.speed >= 3.5 ? 'Schnell' : d.speed >= 3.3 ? 'Normal' : 'Langsam'}</b></div>
      <div class="stat">Nachladen<b>${d.reload}s</b></div>
    </div>
    <div class="ability">✊ <b>${d.attackName}</b></div>
    <div class="ability super">★ <b>${d.superName}</b></div>
    <div class="skins">${[0, 1, 2].map((s) => {
      const own = save.skins[k].includes(s);
      return `<div class="skin ${save.skinSel[k] === s ? 'sel' : ''}" data-s="${s}"><img src="${portrait(k, s)}" alt="">${SKIN_NAMES[s]}<br>${own ? (save.skinSel[k] === s ? '✔' : 'Wählen') : `◆ ${SKIN_COST[s]}`}</div>`;
    }).join('')}</div>
    <div class="btnrow">
      ${un ? `<button class="btn gold" id="btnSelect" ${save.selected === k ? 'disabled' : ''}>${save.selected === k ? 'Ausgewählt' : 'Auswählen'}</button>
      <button class="btn" id="btnUpgrade" ${lvl >= MAX_LEVEL || save.coins < cost ? 'disabled' : ''}>${lvl >= MAX_LEVEL ? 'Max. Stufe' : `Aufwerten ● ${cost}`}</button>`
        : `<button class="btn" disabled>🔒 Freischalten bei ${d.unlock} 🏆</button>`}
    </div>`;
  if (un) {
    $('btnSelect').onclick = async () => { await act({ type: 'select', key: k }); sfx('click'); renderBrawlers(); renderer.showMenu(k, save.skinSel[k]); };
    $('btnUpgrade').onclick = async () => {
      const r = await act({ type: 'upgrade', key: k });
      if (r && !r.error) { sfx('reward'); toast(`${d.name} ist jetzt Stufe ${save.levels[k]}!`); } else toast(r?.error || 'Nicht genug Münzen.');
      renderBrawlers();
    };
  }
  el.querySelectorAll('.skin').forEach((s) => s.onclick = async () => {
    const i = +s.dataset.s;
    if (!un) { toast('Schalte den Brawler zuerst frei.'); return; }
    const owned = save.skins[k].includes(i);
    if (!owned && save.gems < SKIN_COST[i]) { toast(`Du brauchst ◆ ${SKIN_COST[i]} Juwelen.`); return; }
    const r = await act({ type: 'skin', key: k, skin: i });
    if (r && !r.error) { sfx(owned ? 'click' : 'reward'); if (!owned) toast(`Skin „${SKIN_NAMES[i]}“ gekauft!`); renderBrawlers(); if (save.selected === k) renderer.showMenu(k, i); }
  });
}

// ---------- Trophäenstraße ----------
function rewardHtml(r) {
  if (r.type === 'coins') return { icon: '<span style="color:#ffd23f">●</span>', label: `${r.n} Münzen` };
  if (r.type === 'gems') return { icon: '<span style="color:#4dd0e1">◆</span>', label: `${r.n} Juwelen` };
  if (r.type === 'box') return { icon: '🎁', label: r.n > 1 ? `${r.n} Kisten` : 'Kiste' };
  if (r.type === 'brawler') return { icon: `<img src="${portrait(r.key, 0)}" alt="">`, label: `Brawler: ${BRAWLERS[r.key].name}` };
  return { icon: '?', label: '' };
}

function renderRoad() {
  const t = totalTrophies();
  $('roadTroph').textContent = t;
  const list = $('roadList');
  let prev = 0;
  list.innerHTML = ROAD.map((r, i) => {
    const done = save.claimed.includes(i), ready = !done && t >= r.at;
    const { icon, label } = rewardHtml(r);
    const prog = Math.max(0, Math.min(1, (t - prev) / (r.at - prev)));
    prev = r.at;
    return `<div class="roaditem ${done ? 'done' : ready ? 'ready' : t < r.at ? 'locked' : ''}">
      <div class="at">🏆 ${r.at}</div><div class="rw">${icon}</div><div class="lbl">${label}</div>
      ${ready ? `<button class="btn gold" data-claim="${i}">Abholen</button>` : done ? '<div class="lbl">✔ Abgeholt</div>' : `<div class="roadprog"><i style="width:${prog * 100}%"></i></div>`}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-claim]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const res = await act({ type: 'claim', index: +b.dataset.claim });
    const r = res && !res.error ? res.reward : null;
    if (!r) renderRoad();
    if (r) {
      sfx('reward');
      const { label } = rewardHtml(r);
      toast(r.type === 'brawler' ? `🎉 Neuer Brawler: <b>${BRAWLERS[r.key].name}</b>!` : `Erhalten: ${label}`);
      renderRoad();
    }
  });
  const first = list.querySelector('.ready') || list.querySelector('.locked');
  if (first) list.scrollLeft = Math.max(0, first.offsetLeft - 40);
}

// ---------- Kisten ----------
function renderBoxes() {
  $('boxCount').textContent = save.boxes;
  $('btnOpenBox').disabled = save.boxes <= 0;
  $('bigBox').className = 'bigbox';
  $('boxLoot').innerHTML = '';
}
$('btnOpenBox').onclick = () => {
  if (save.boxes <= 0) return;
  const box = $('bigBox');
  $('btnOpenBox').disabled = true;
  $('boxLoot').innerHTML = '';
  box.className = 'bigbox shake';
  sfx('tick');
  const pending = act({ type: 'box' });
  setTimeout(async () => {
    const res = await pending;
    if (!res || res.error) { toast(res?.error || 'Kiste konnte nicht geöffnet werden.'); renderBoxes(); return; }
    const items = res.items;
    box.className = 'bigbox open';
    sfx('reward');
    $('boxLoot').innerHTML = items.map((it, i) => {
      const st = `style="animation-delay:${i * 0.18}s"`;
      if (it.type === 'coins') return `<div class="loot" ${st}><span class="li" style="color:#ffd23f">●</span>${it.n}</div>`;
      if (it.type === 'gems') return `<div class="loot" ${st}><span class="li" style="color:#4dd0e1">◆</span>${it.n}</div>`;
      return `<div class="loot" ${st}><img src="${portrait(it.key, 0)}" alt="">Neu: ${BRAWLERS[it.key].name}!</div>`;
    }).join('');
    $('boxCount').textContent = save.boxes;
    setTimeout(() => { $('btnOpenBox').disabled = save.boxes <= 0; }, 600);
  }, 900);
};

// ---------- Spielstart ----------
function playerInfo() {
  const k = save.selected;
  return { name: save.name, brawler: k, level: save.levels[k], skin: save.skinSel[k] || 0, mode: state.mode, token: token() };
}

$('btnPlay').onclick = () => { unlockAudio(); sfx('click'); state.online ? startOnline({}) : startOffline(); };
function needAccount() { if (isLoggedIn()) return false; toast('Für Online-Spiele brauchst du ein Konto.'); showAuth(account.mode === 'server' ? 'auth' : 'offline'); return true; }
$('btnCreate').onclick = () => { sfx('click'); if (!needAccount()) startOnline({ create: true }); };
$('btnJoin').onclick = () => {
  modal(`<h2>Raum-Code eingeben</h2><input id="codeIn" maxlength="4" placeholder="ABCD" style="text-transform:uppercase"><div class="row"><button class="btn" id="codeOk">Beitreten</button></div>`);
  const i = $('codeIn'); i.focus();
  const ok = () => { const v = i.value.trim().toUpperCase(); if (v.length === 4) { closeModal(); startOnline({ code: v }); } };
  $('codeOk').onclick = ok;
  i.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
};

function startOffline() {
  const s = new LocalSession(playerInfo());
  s.start({ onStart: () => beginGame(s), onEnd: (r, you) => endGame(r, you, { online: false }) });
}

function startOnline(extra) {
  if (needAccount()) return;
  state.lobbyCode = null;
  $('lobbyExtra').style.display = 'none';
  const s = new NetSession({ ...playerInfo(), ...extra });
  state.session = s;
  $('lobbyTitle').textContent = extra.create ? 'Privater Raum' : extra.code ? 'Raum ' + extra.code : 'Suche Mitspieler…';
  $('lobbyCode').textContent = '';
  $('lobbyPlayers').innerHTML = '';
  $('lobbyTimer').textContent = 'Verbinde…';
  show('lobby');
  s.connect({
    onLobby: (m) => {
      if (m.code) {
        $('lobbyTitle').textContent = 'Privater Raum – lade Freunde ein oder schick den Code:';
        $('lobbyCode').textContent = m.code;
        $('lobbyExtra').style.display = '';
        state.lobbyTogether = m.together;
        $('btnTeams').textContent = m.mode === 'ffa' ? '⚔️ Jeder gegen Jeden' : (m.together ? '🤝 Zusammen im Team' : '⚔️ Gegeneinander');
        $('btnTeams').disabled = m.mode === 'ffa';
        if (!state.lobbyCode) {
          state.lobbyCode = m.code;
          if (state.pendingInvite) { friends.invite(state.pendingInvite, m.code); state.pendingInvite = null; }
        }
      }
      const slots = [];
      for (let i = 0; i < m.max; i++) {
        const p = m.players[i];
        slots.push(p ? `<div>${escapeHtml(p.name)} <small>(${BRAWLERS[p.brawler]?.name || '?'})</small></div>` : '<div class="empty">Bot</div>');
      }
      $('lobbyPlayers').innerHTML = slots.join('');
      $('lobbyTimer').textContent = `${MODES[m.mode].name} · ${m.players.length}/${m.max} Spieler` + (m.startsIn !== null ? ` · Start in ${m.startsIn}s` : ' · Warte auf Start');
    },
    onStart: () => beginGame(s),
    onEnd: (r, you, msg) => endGame(r, you, { online: true, server: msg }),
    onError: (msg) => {
      if (state.session !== s) return;
      state.session = null;
      if (state.screen === 'game') { renderer.endGame(); input.enabled = false; }
      toast(msg, 3500);
      show('home');
    },
  });
}
$('btnStartNow').onclick = () => { if (state.session && state.session.startNow) state.session.startNow(); };
$('btnTeams').onclick = () => { if (state.session && state.session.send) state.session.send({ t: 'teams', together: !state.lobbyTogether }); };
$('btnInvite').onclick = () => {
  const on = friends.friends.filter((f) => f.online === 'online');
  modal(`<h2>👥 Freunde einladen</h2>${on.length
    ? on.map((f) => `<div class="frow"><span class="dot online"></span><div class="fname">${escapeHtml(f.name)}<small>🏆 ${f.trophies}</small></div><button class="btn gold" data-inv="${f.id}">Einladen</button></div>`).join('')
    : '<p class="hint" style="max-width:none">Gerade ist keiner deiner Freunde online. Schick ihnen den Raum-Code!</p>'}
    <div class="row" style="margin-top:10px"><button class="btn grey" id="invClose">Fertig</button></div>`);
  $('invClose').onclick = closeModal;
  $('modalBox').querySelectorAll('[data-inv]').forEach((b) => b.onclick = () => { friends.invite(+b.dataset.inv, state.lobbyCode); b.disabled = true; b.textContent = 'Eingeladen ✔'; });
};
$('btnLeaveLobby').onclick = () => { if (state.session) state.session.leave(); state.session = null; state.lobbyCode = null; show('home'); };

function beginGame(s) {
  state.session = s;
  state.killfeed = [];
  state.lastCd = null;
  renderer.startGame(s.map, s.roster, s.you, s.mode);
  input.reset();
  input.enabled = true;
  if (input.touchMode) document.body.classList.add('touch');
  $('helpText').style.display = input.touchMode ? 'none' : 'block';
  $('killfeed').innerHTML = '';
  show('game');
}

$('btnLeave').onclick = () => {
  modal(`<h2>Match verlassen?</h2><p class="hint" style="margin:0 auto 12px">Du bekommst keine Belohnung für dieses Match.</p><div class="row"><button class="btn" id="lvNo">Weiterspielen</button><button class="btn gold" id="lvYes">Verlassen</button></div>`);
  $('lvNo').onclick = closeModal;
  $('lvYes').onclick = () => { closeModal(); quitGame(); };
};
input.on('menu', () => { if (state.screen === 'game') $('btnLeave').click(); });

function quitGame() {
  const s = state.session;
  state.session = null;
  if (s) s.leave();
  input.enabled = false;
  renderer.endGame();
  renderer.showMenu(save.selected, save.skinSel[save.selected]);
  show('home');
}

async function endGame(result, you, how) {
  if (!state.session) return;
  state.session = null;
  input.enabled = false;
  const rw = (await reportMatch(result, you, how)) || { outcome: null, troph: 0, coins: 0, meter: 0, newBoxes: 0, mvp: false, none: true };
  if (!rw.outcome) {
    const me = result.players.find((p) => p.id === you);
    rw.outcome = result.mode === 'ffa' ? (me.rank === 1 ? 'win' : me.rank <= 3 ? 'draw' : 'loss') : result.winner === -1 ? 'draw' : result.winner === me.team ? 'win' : 'loss';
  }
  renderer.endGame();
  renderer.showMenu(save.selected, save.skinSel[save.selected]);
  const title = $('resTitle');
  const youP = result.players.find((p) => p.id === you);
  if (result.mode === 'ffa') {
    title.textContent = youP.rank === 1 ? 'SIEG!' : `PLATZ ${youP.rank}`;
  } else title.textContent = rw.outcome === 'win' ? 'SIEG!' : rw.outcome === 'draw' ? 'UNENTSCHIEDEN' : 'NIEDERLAGE';
  title.className = rw.outcome === 'win' ? 'win' : rw.outcome === 'loss' ? 'loss' : '';
  sfx(rw.outcome === 'loss' ? 'lose' : 'win');
  $('resSub').textContent = MODES[result.mode].name + (result.mode !== 'ffa' ? ` · ${result.score[youP.team]} : ${result.score[1 - youP.team]}` : '') + (rw.mvp ? ' · ⭐ Du bist MVP!' : '');
  $('resRewards').innerHTML = rw.none ? '<div><small>Keine Belohnung für dieses Match</small></div>' : `
    <div>🏆 ${rw.troph >= 0 ? '+' : ''}${rw.troph}<small>Trophäen</small></div>
    <div><span style="color:#ffd23f">●</span> +${rw.coins}<small>Münzen</small></div>
    <div>🎁 +${rw.meter}%<small>Kisten-Fortschritt</small></div>
    ${rw.newBoxes ? `<div style="animation-delay:.3s">🎁 +${rw.newBoxes}<small>Neue Kiste!</small></div>` : ''}`;
  const rows = [...result.players].sort((a, b) => result.mode === 'ffa' ? a.rank - b.rank : (a.team - b.team) || (b.kills - a.kills));
  const myTeam = youP.team;
  $('resTable').innerHTML = `<tr><th>Spieler</th><th>Brawler</th><th>K.O.s</th><th>Tode</th><th>Schaden</th></tr>` + rows.map((p) => {
    const cls = p.id === you ? 'me' : result.mode === 'ffa' ? '' : (p.team === myTeam ? 't0' : 't1');
    return `<tr class="${cls}"><td>${result.mode === 'ffa' ? p.rank + '. ' : ''}${escapeHtml(p.name)}${p.id === result.mvp ? ' ⭐' : ''}</td><td>${BRAWLERS[p.brawler].name}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.dmg}</td></tr>`;
  }).join('');
  show('results');
  const nr = roadAvailable();
  if (nr) setTimeout(() => toast(`🏆 ${nr} Belohnung(en) auf der Trophäenstraße bereit!`), 900);
}
$('btnContinue').onclick = () => { sfx('click'); show('home'); };

// ---------- Steuerung im Spiel ----------
function myState() {
  const v = state.lastView;
  if (!v) return null;
  return v.players.find((p) => p.id === state.session?.you) || null;
}
const flip = () => renderer.flip;
const toWorld = (x, y) => (flip() ? { x: -x, y: -y } : { x, y });

function nearestEnemy(me, range) {
  const v = state.lastView;
  let best = null, bd = range + 0.5;
  for (const p of v.players) {
    if (!p.al || p.id === me.id) continue;
    const r = renderer.roster.get(p.id);
    if (!r || (renderer.gameMode !== 'ffa' && r.team === renderer.myTeam)) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Zielrichtung bestimmen
function aimFor(kind, data) {
  const me = myState();
  if (!me || !me.al) return null;
  const def = BRAWLERS[renderer.roster.get(me.id).brawler];
  const isSup = kind === 'super';
  const range = isSup ? (def.superRange || def.range) : def.range;
  if (data && data.stick) {
    const w = toWorld(data.sx, data.sy);
    const l = Math.hypot(w.x, w.y) || 1;
    return { ax: w.x / l, ay: w.y / l, dist: data.mag * range, me, def, range };
  }
  if (data && data.auto) {
    const t = nearestEnemy(me, isSup && def.superAim === 'self' ? 6 : range);
    if (t) { const dx = t.x - me.x, dy = t.y - me.y, l = Math.hypot(dx, dy) || 1; return { ax: dx / l, ay: dy / l, dist: l, me, def, range }; }
    return { ax: Math.cos(me.f), ay: Math.sin(me.f), dist: range, me, def, range };
  }
  // Maus
  const g = renderer.screenToGround(input.mouse.x, input.mouse.y);
  if (!g) return null;
  const dx = g.x - me.x, dy = g.y - me.y, l = Math.hypot(dx, dy) || 1;
  return { ax: dx / l, ay: dy / l, dist: l, me, def, range };
}

function doAction(kind, data) {
  const s = state.session;
  if (!s || state.screen !== 'game') return;
  const a = aimFor(kind, data);
  if (!a) return;
  if (kind === 'super' && !((a.me.sc ?? 0) >= 1)) return;
  if (kind === 'attack' && (a.me.am ?? 0) < 1) return;
  s.act(kind === 'super' ? 'sup' : 'atk', a.ax, a.ay, a.dist);
}
input.on('attack', (d) => doAction('attack', d));
input.on('super', (d) => doAction('super', d));

function aimIndicator(me) {
  const def = BRAWLERS[renderer.roster.get(me.id).brawler];
  let kind = null, a = null;
  const st = input.aiming();
  if (st) { kind = st.kind; a = aimFor(kind, st.auto ? null : st); if (st.auto) return null; }
  else if (!input.touchMode && input.mouse.inside) { kind = input.keys.has('shift') && (me.sc ?? 0) >= 1 ? 'super' : 'attack'; a = aimFor(kind, null); }
  if (!a) return null;
  const sup = kind === 'super';
  const type = sup ? def.superAim : def.aim;
  return {
    x: me.x, y: me.y, ax: a.ax, ay: a.ay, dist: a.dist, type, sup,
    range: sup ? (def.superRange || def.superRadius || def.range) : def.range,
    width: sup ? (def.superWidth || 0.25) : (def.aimWidth || 0.2),
    radius: sup ? (def.superRadius || 1.5) : (def.aimRadius || 1.2),
  };
}

// ---------- HUD ----------
const HUD = { lastScore: '', };
function updateHud(v) {
  const me = myState();
  const mode = renderer.gameMode;
  const mm = Math.floor(v.tl / 60), ss = String(v.tl % 60).padStart(2, '0');
  let html;
  const my = renderer.myTeam;
  if (mode === 'teamko') {
    html = `<div class="sc blue">${v.sc[my]}</div><div><div class="time">${mm}:${ss}</div><div class="goal">Ziel: ${MODES.teamko.goal}</div></div><div class="sc red">${v.sc[1 - my]}</div>`;
  } else if (mode === 'zone') {
    const g = MODES.zone.goal;
    html = `<div><div class="zonebar"><i style="width:${(v.sc[my] / g) * 100}%;background:var(--blue)"></i></div><div class="goal">${v.sc[my]}/${g}</div></div><div class="time">${mm}:${ss}</div><div><div class="zonebar"><i style="width:${(v.sc[1 - my] / g) * 100}%;background:var(--red);margin-left:auto"></i></div><div class="goal">${v.sc[1 - my]}/${g}</div></div>`;
  } else {
    const best = Math.max(...v.sc);
    html = `<div class="sc blue">${v.sc[my]}</div><div><div class="time">${mm}:${ss}</div><div class="goal">Ziel: ${MODES.ffa.goal} K.O.s</div></div><div class="sc red" title="Bester Gegner">${Math.max(...v.sc.filter((_, i) => i !== my))}</div>`;
    void best;
  }
  if (html !== HUD.lastScore) { $('scoreboard').innerHTML = html; HUD.lastScore = html; }
  // Countdown
  const cdEl = $('countdown');
  if (v.ph === 'countdown') {
    if (state.lastCd !== v.cd) { cdEl.textContent = v.cd; cdEl.className = 'countdown'; sfx('tick'); state.lastCd = v.cd; }
  } else if (state.lastCd !== 'go') {
    state.lastCd = 'go'; cdEl.textContent = 'LOS!'; cdEl.className = 'countdown go';
    setTimeout(() => { if (state.lastCd === 'go') cdEl.textContent = ''; }, 900);
  }
  if (me) {
    $('respawn').classList.toggle('hidden', !!me.al);
    if (!me.al) $('respawnT').textContent = Math.ceil(me.rs || 0);
    const sc = me.sc ?? 0;
    $('superFill').style.width = sc * 100 + '%';
    $('superBar').classList.toggle('ready', sc >= 1);
    $('supProg').style.strokeDashoffset = String(276.5 * (1 - sc));
    $('btnSup').classList.toggle('ready', sc >= 1);
  }
}

function addKill(ev) {
  const R = renderer.roster;
  const k = R.get(ev.k), v = R.get(ev.v);
  if (!v) return;
  const cls = (p) => !p ? '' : p.id === state.session.you ? 'm' : (renderer.gameMode !== 'ffa' && p.team === renderer.myTeam ? 'a' : 'e');
  const el = document.createElement('div');
  el.innerHTML = k && k !== v ? `<span class="${cls(k)}">${escapeHtml(k.name)}</span> 💥 <span class="${cls(v)}">${escapeHtml(v.name)}</span>` : `💀 <span class="${cls(v)}">${escapeHtml(v.name)}</span>`;
  const feed = $('killfeed');
  feed.prepend(el);
  while (feed.children.length > 4) feed.lastChild.remove();
  setTimeout(() => el.remove(), 5000);
}

function handleSounds(ev) {
  const you = state.session.you;
  for (const e of ev) {
    if (e.e === 'atk') { if (e.id === you || Math.random() < 0.5) sfx('atk', e.k); }
    else if (e.e === 'sup') sfx('sup');
    else if (e.e === 'hit') { if (e.id === you) sfx('hurt'); else if (e.s === you) sfx('hit'); }
    else if (e.e === 'boom' && (e.k === 'bomb' || e.k === 'megabomb' || e.k === 'quake')) sfx('boom');
    else if (e.e === 'heal' && e.id === you) sfx('heal');
    else if (e.e === 'ko') { addKill(e); if (e.k === you) sfx('ko'); }
    else if (e.e === 'go') sfx('go');
  }
}

// ---------- Hauptschleife ----------
let last = performance.now();
let autoFireT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const s = state.session;
  if (s && state.screen === 'game') {
    const mv = input.moveVector();
    const w = toWorld(mv.x, mv.y);
    s.move(w.x, w.y);
    // Dauerfeuer bei gedrückter Maustaste
    if (input.mouseHeld && !input.touchMode) { autoFireT -= dt; if (autoFireT <= 0) { autoFireT = 0.32; doAction('attack', null); } }
    else autoFireT = 0;
    const v = s.update(dt);
    if (v) {
      state.lastView = v;
      handleSounds(v.ev);
      const me = myState();
      renderer.setAim(me && me.al && v.ph === 'play' ? aimIndicator(me) : null);
      renderer.update({ players: v.players, proj: v.proj, zones: v.zones, events: v.ev, zo: v.zo }, dt);
      updateHud(v);
    }
  } else {
    renderer.update(null, dt);
  }
}

// Start: angemeldet? -> Menü, sonst Konto erstellen / anmelden
requestAnimationFrame(frame);
const startState = await initSave();
if (startState === 'ok') enterGame();
else showAuth(startState);
