# 🥊 Kistenkrawall

Ein 3D-Arena-Brawler aus der Vogelperspektive – mit Online-Multiplayer, 8 Brawlern mit eigenen Angriffen und Belohnungen zum Freischalten. Läuft im Browser auf PC, Handy und Tablet.

## Starten

```bash
npm install
npm start
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

Der Fortschritt wird im Browser gespeichert.

## Technik

- `public/shared/` – Spielsimulation (Karte, Brawler, Spiellogik, Bot-KI), läuft auf dem Server **und** offline im Browser
- `server/index.js` – Node-Server: liefert das Spiel aus, WebSocket-Räume, Matchmaking, 30 Ticks/s
- `public/js/` – three.js-Darstellung, Steuerung, Menüs, Belohnungen, Client-Vorhersage + Interpolation
