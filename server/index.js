// Startpunkt: node server/index.js   (Port per PORT, Datenbankdatei per DB_PATH)
import os from 'node:os';
import { startServer } from './app.js';

const port = Number(process.env.PORT) || 3000;
const opts = { port };
if (process.env.DB_PATH) opts.dbPath = process.env.DB_PATH;

const app = await startServer(opts);
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log(`\n  Brawl Engine läuft!`);
console.log(`  Lokal:     http://localhost:${app.port}`);
for (const ip of ips) console.log(`  Im WLAN:   http://${ip}:${app.port}`);
console.log('');

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
