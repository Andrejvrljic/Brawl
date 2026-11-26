# 🥊 Brawl Engine

Ein 3D-Arena-Brawler aus der Vogelperspektive – mit Online-Multiplayer, 8 Brawlern mit eigenen Angriffen und Belohnungen zum Freischalten. Läuft im Browser auf PC, Handy und Tablet.

## Online spielen (Cloudflare, wie ECLIPSE)

**https://brawl-engine.dinnerboneagg.workers.dev** – Multiplayer, Konten, Freunde, Datenbank und Rangliste, dauerhaft online.

- **Konto nötig:** Beim ersten Öffnen erstellt man ein Konto (Benutzername + Passwort) oder meldet sich an.
- **Freunde:** 👥 Freunde → Benutzernamen eingeben → Anfrage. Angenommene Freunde sieht man mit Online-Status
  (online / in der Lobby / spielt gerade) und kann sie mit **Einladen** direkt in einen privaten Raum holen.
  Im privaten Raum spielen Freunde standardmäßig **im selben Team** (umschaltbar auf „Gegeneinander“).
- **Admin:** Das Konto **Dinnerboneagg** (`ADMIN_NAMES` in `wrangler.toml`) sieht im Menü 🛡️ Admin. Nach Eingabe des
  Admin-Codes: Statistik, Nachricht an alle, Spieler suchen, Münzen/Juwelen/Kisten/Trophäen geben, alle Brawler freischalten,
  Max-Stufe, Spieler sperren (sofortiger Rauswurf) und entsperren. Der Code steht **nicht** im Code, sondern im
  Repository-Secret `ADMIN_CODE` und wird beim Veröffentlichen als Cloudflare-Secret gesetzt. Lokal: `ADMIN_CODE=… npm start`.

Wird bei jedem Push auf `main` von GitHub Actions (`.github/workflows/cloudflare.yml`) veröffentlicht:
Worker (Spielseite + API), Durable Object (Multiplayer-Server für alle Räume) und D1-Datenbank (`kistenkrawall-db`).
Einmalig nötig: Repository-Secret `CLOUDFLARE_API_TOKEN` (derselbe Token wie bei ECLIPSE, Rechte *Workers Scripts: Edit* und *D1: Edit*).
Nach jedem Deploy prüft ein Live-Test Konten, Datenbank und einen Multiplayer-Raum gegen den echten Server.

## Spielen ohne Installation

- **Gegen Bots (fester Link):** https://andrejvrljic.github.io/Brawl/ – läuft über GitHub Pages, ohne Multiplayer und Datenbank.
- **Mit Freunden online (GitHub Codespaces):** [![In Codespaces öffnen](https://github.com/codespaces/badge.svg)](https://codespaces.new/Andrejvrljic/Brawl?quickstart=1)
  Der Server mit Datenbank startet automatisch. Im Reiter **Ports** den Link bei „Brawl Engine“ (Port 3000) kopieren und an Freunde schicken. Steht dort „Private“: Rechtsklick bzw. lange tippen → *Port Visibility* → *Public*. Der Codespace schläft nach ca. 30 Minuten ohne Benutzung ein; zum Weiterspielen unter github.com/codespaces wieder starten – die Datenbank bleibt erhalten.

## Starten auf dem eigenen Rechner

```bash
npm install
npm start        # Node.js 22.13 oder neuer
```

Dann im Browser **http://localhost:3000** öffnen.
Freunde im selben WLAN öffnen die Adresse, die der Server unter „Im WLAN“ anzeigt (z. B. `http://192.168.0.23:3000`) – auch auf dem iPhone.

## Spielen

| | PC | Handy/Tablet |
|---|---|---|
| Laufen | WASD / Pfeiltasten | linker Joystick |
| Angriff | Linksklick (halten = Dauerfeuer) | roter Knopf: ziehen = zielen, tippen = automatisch zielen |
| Super | Rechtsklick / Leertaste (Shift = Super zielen) | ★-Knopf |

**Modi:** Team-K.O. (3 gegen 3, 10 K.O.s) · Zonenkontrolle (Zone 45 s halten) · Jeder gegen Jeden (7 K.O.s)
**Online:** „Spielen“ sucht ein Match, „Raum erstellen“ gibt dir einen 4-stelligen Code für Freunde. Freie Plätze werden mit Bots gefüllt. „Gegen Bots“ funktioniert auch ohne Server.

Büsche verstecken dich, Kisten blocken Schüsse (manche Supers sprengen sie), Wasser blockiert nur das Laufen. Außerhalb des Kampfes regenerierst du dich.

## Brawler

| Brawler | Rolle | Angriff | Super | Freischalten |
|---|---|---|---|---|
| Funke | Allrounder | 4 Energiekugeln im Fächer | Turbo-Sprint (unverwundbar, rammt) | Start |
| Brocken | Panzer | Doppelfaust im Halbkreis | Erdbeben-Sprung über Wände | Start |
| Pfeil | Scharfschütze | Pfeil mit großer Reichweite | Pfeilhagel (5 durchbohrende Pfeile) | 30 🏆 |
| Bummi | Werfer | Bombe im Bogen über Wände | Mega-Bombe, sprengt Kisten | 60 🏆 |
| Frost | Kontrolle | Eissplitter, verlangsamt | Eissturm, friert ein | 100 🏆 |
| Wirbel | Kämpfer | Bumerang (trifft zweimal) | 8 Bumerangs rundum | 150 🏆 |
| Glut | Nahkämpfer | Flammenstoß, setzt in Brand | Feuerwand | 220 🏆 |
| Heila | Heilerin | Lichtkugel: Schaden + Heilung | Lebensquelle (Heilkreis) | 300 🏆 |

## Belohnungen

- **Trophäen** pro Brawler (Sieg +8, Niederlage −4, MVP +1) → **Trophäenstraße** mit Münzen, Juwelen, Kisten und neuen Brawlern
- **Münzen** → Brawler aufwerten (Stufe 1–7, je +8 % Leben und Schaden)
- **Juwelen** → Skins (Gold, Schatten)
- **Kisten** aus der Straße und dem Kisten-Fortschritt (füllt sich mit jedem Spiel), manchmal mit neuem Brawler

## Datenbank & Konten

Der Server speichert alles in einer **SQLite-Datenbank** (`data/kistenkrawall.db`, in Node eingebaut – kein Extra-Programm nötig):

- **Konten:** Beim ersten Start bekommt jedes Gerät automatisch ein Gastkonto. Über 👤 → *Konto sichern* (Benutzername + Passwort) kannst du dich auf anderen Geräten anmelden und weiterspielen.
- **Fortschritt:** Trophäen, Münzen, Juwelen, Stufen, Skins, Kisten und Trophäenstraße liegen in der Datenbank. Der Server prüft jede Aktion (z. B. ob genug Münzen da sind).
- **Online-Matches:** Der Server rechnet die Belohnung selbst aus und nimmt Brawler und Stufe aus der Datenbank – Schummeln im Browser bringt nichts.
- **Rangliste:** 📊 im Hauptmenü zeigt die Top 50 nach Trophäen.
- **Match-Verlauf** pro Konto.

Ein alter Spielstand aus dem Browser wird beim ersten Verbinden übernommen. Ohne Server (z. B. als reine Webseite) speichert das Spiel weiterhin im Browser.
Passwörter werden mit scrypt gehasht, Anmelde-Schlüssel nur als Hash gespeichert. Die Datei per `DB_PATH=/pfad/zur.db npm start` verlegen.

## GitHub Actions

- **Tests** (`.github/workflows/ci.yml`): Bei jedem Push werden Spiellogik, Belohnungen, Datenbank, API und Server getestet (`npm test`).
- **Docker-Image** (`.github/workflows/docker.yml`): Bei Push auf `main` wird ein fertiges Image mit Spiel + Server + Datenbank gebaut und unter `ghcr.io/<besitzer>/<repo>:latest` abgelegt.

GitHub Actions kann den Server nicht dauerhaft laufen lassen (Jobs enden nach dem Durchlauf). Zum Hosten das Image auf einem Server/VPS starten – die Datenbank liegt dabei in einem Volume und übersteht Updates:

```bash
docker run -d --name kistenkrawall -p 3000:3000 -v kistenkrawall-daten:/app/data ghcr.io/<besitzer>/<repo>:latest
```

## Technik

- `public/shared/` – Spielsimulation (Karte, Brawler, Spiellogik, Bot-KI), läuft auf dem Server **und** offline im Browser
- `public/shared/progress.js` – Belohnungsregeln (gleich auf Server und Client)
- `server/app.js` – Node-Server: liefert das Spiel aus, REST-API, WebSocket-Räume, Matchmaking, 30 Ticks/s
- `server/db.js` – SQLite-Datenbank (Konten, Sitzungen, Fortschritt, Matches, Rangliste)
- `test/` – automatische Tests
- `public/js/` – three.js-Darstellung, Steuerung, Menüs, Belohnungen, Client-Vorhersage + Interpolation
