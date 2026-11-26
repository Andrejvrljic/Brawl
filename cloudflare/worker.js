// Kistenkrawall auf Cloudflare: Worker liefert das Spiel aus und beantwortet die API (D1-Datenbank),
// ein Durable Object betreibt alle Spielräume in Echtzeit über WebSocket – wie bei ECLIPSE.
import { handleApi } from '../server/api.js';
import { Arena } from '../server/rooms.js';
import { D1Store } from './d1.js';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export class ArenaDO {
  constructor(state, env) {
    this.arena = new Arena(new D1Store(env.DB));
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Nur WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = this.arena.connect((text) => server.send(text));
    server.addEventListener('message', (e) => this.arena.message(c, typeof e.data === 'string' ? e.data : ''));
    server.addEventListener('close', () => this.arena.close(c));
    server.addEventListener('error', () => this.arena.close(c));
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Echtzeit-Verbindungen gehen an den gemeinsamen Spielraum
    if (request.headers.get('Upgrade') === 'websocket') {
      return env.ARENA.get(env.ARENA.idFromName('arena')).fetch(request);
    }
    if (url.pathname === '/health') return new Response('ok');
    if (url.pathname.startsWith('/api/')) {
      try {
        let body = {};
        if (request.method === 'POST') {
          const text = await request.text();
          if (text.length > 64 * 1024) return json(413, { error: 'Zu groß.' });
          try { body = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
        }
        const r = await handleApi(new D1Store(env.DB), {
          method: request.method, path: url.pathname, body,
          token: (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
          ip: request.headers.get('cf-connecting-ip') || '?',
        });
        return json(r.status, r.data);
      } catch (e) {
        console.error(e);
        return json(500, { error: 'Serverfehler' });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
