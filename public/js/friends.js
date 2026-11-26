// Freunde: dauerhafte Verbindung im Menü für Freundesliste, Online-Status, Anfragen und Einladungen
import { serverUrl } from './session.js';

export class Friends {
  constructor(handlers) {
    this.h = handlers;
    this.list = [];
    this.invites = []; // offene Einladungen { from, code, mode, at }
    this.ws = null;
    this.stopped = true;
    this.retry = 1000;
    this.req = 0;
    this.pending = new Map();
  }

  // Admin-Anfrage mit Antwort
  request(m) {
    return new Promise((resolve) => {
      const id = ++this.req;
      if (!this.send({ ...m, t: 'admin', req: id })) { resolve({ error: 'Keine Verbindung zum Server – kurz warten.' }); return; }
      const t = setTimeout(() => { this.pending.delete(id); resolve({ error: 'Server antwortet nicht.' }); }, 8000);
      this.pending.set(id, (r) => { clearTimeout(t); resolve(r); });
    });
  }

  start(token) {
    this.stop();
    this.token = token;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryT);
    if (this.ws) { try { this.ws.close(); } catch { /* egal */ } }
    this.ws = null;
    this.list = []; this.invites = [];
  }

  connect() {
    const url = serverUrl();
    if (!url || this.stopped) return;
    let ws;
    try { ws = new WebSocket(url); } catch { this.later(); return; }
    this.ws = ws;
    ws.onopen = () => { this.retry = 1000; this.send({ t: 'auth', token: this.token }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.later(); } };
  }

  later() {
    if (this.stopped) return;
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(15000, this.retry * 2);
  }

  send(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }

  onMsg(m) {
    switch (m.t) {
      case 'friends': this.list = m.list; this.h.onChange(); break;
      case 'friendMsg': this.h.onMsg(m); break;
      case 'friendRequest': this.h.onRequest(m.from); break;
      case 'invited':
        this.invites = this.invites.filter((i) => i.from.id !== m.from.id);
        this.invites.unshift({ ...m, at: Date.now() });
        this.h.onInvite(m); this.h.onChange();
        break;
      case 'authfail': this.stop(); break;
      case 'adminRes': { const f = this.pending.get(m.req); if (f) { this.pending.delete(m.req); f(m); } break; }
      case 'announce': this.h.onAnnounce(m); break;
      case 'profileUpdate': this.h.onProfileUpdate(); break;
      case 'kicked': this.h.onKicked(m); break;
      case 'kickedSoft': this.h.onKickedSoft(m); break;
      case 'news': this.h.onNews(m.news); break;
    }
  }

  get friends() { return this.list.filter((f) => f.status === 'friend'); }
  get incoming() { return this.list.filter((f) => f.status === 'incoming'); }
  get outgoing() { return this.list.filter((f) => f.status === 'outgoing'); }
  get openInvites() { const now = Date.now(); return this.invites.filter((i) => now - i.at < 5 * 60 * 1000); }
  get badge() { return this.incoming.length + this.openInvites.length; }

  add(login) { return this.send({ t: 'friendAdd', login }); }
  answer(id, accept) { this.send({ t: 'friendAnswer', id, accept }); }
  remove(id) { this.send({ t: 'friendRemove', id }); }
  invite(id, code) { return this.send({ t: 'invite', to: id, code }); }
  dropInvite(code) { this.invites = this.invites.filter((i) => i.code !== code); this.h.onChange(); }
}
