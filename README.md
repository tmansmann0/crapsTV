# crapsTV ✦

**Your TV is the table. Your phone holds the chips.**

A personal, open-source living-room casino for 1–12 players. Built with React, Three.js, an original Blender table and dice, and a shared authoritative craps engine. Play with pretend chips on macOS, Windows, and Linux.

[**Play online**](https://tmansmann0.github.io/crapsTV/) · [Rules and architecture](docs/game-and-network.md) · [Asset provenance](docs/visual-assets.md)

![The crapsTV living-room casino](docs/screenshots/table.png)

## Start a local game

Install [Node.js 22 or later](https://nodejs.org/), then:

```sh
git clone https://github.com/tmansmann0/crapsTV.git
cd crapsTV
npm ci
npm run build
npm start
```

Open `http://localhost:3000` on the TV computer. The terminal also prints a **LAN address**, such as `http://192.168.1.50:3000`. Open that address on the TV to show a scannable QR code; phones must be on the same Wi-Fi. Guest Wi-Fi or client isolation may prevent phones reaching the computer. Allow Node through the OS firewall if asked.

These commands are the same in macOS/Linux terminals, Windows PowerShell, and Windows Terminal. No Blender, Python, model downloads, account, or cloud service is needed at runtime. Fonts, models, artwork, and audio are bundled. After installation, local sessions work offline.

`npm run dev` runs the same local server with Vite hot reload. Set the optional `PORT` environment variable to change the default port. The server listens on all interfaces so phones can connect.

## Play online with GitHub Pages

1. Open the [online game](https://tmansmann0.github.io/crapsTV/) on your TV/laptop and choose **Host an online table**.
2. Keep that tab open. Friends scan its QR or open the site, enter their name and six-character room code, and join.
3. The **first player to join** becomes the game admin. The TV itself is a spectator until someone selects **Join here**.

GitHub Pages serves the static app. PeerJS’s free public signaling service introduces the browsers; game messages then travel over WebRTC. The host browser owns the session. **Some corporate networks, symmetric NATs, or restrictive firewalls require a TURN relay; this free build does not bundle a paid relay.** If a connection cannot be made, use local play or another network. Closing/reloading the hosting tab ends the online room; it is not a persistent game server. Phone reloads can rejoin the same seat while the host remains open.

## House rules, your way

- **Classic craps or crapless craps.** Rules lock at the start; teach mode can change during play.
- **Starting stack and table minimum.** The first player chooses both.
- **Pass / don’t pass, come / don’t come, 5× true odds, place bets, field, hardways, big 6/8, and one-roll propositions.** Crapless adds 2, 3, 11, 12 as points and places, with no don’t side.
- **Teach mode** adds win probabilities, profit payouts, and house edges beside every offered wager. The table guide is always available, including current odds bets.
- **Real betting windows.** The shooter or admin rolls; betting locks while the dice animate. Random results come from the authority’s cryptographic random generator.
- **Re-up without losing your story.** With no open bets and total chips below the minimum, refill to the starting stack. Added chips count as new buy-in, never as winnings.
- **Cash out or close the table.** Unresolved wagers are returned. Each player gets a personal recap, net-result chart, biggest win, comeback count, and downloadable **1080×1440 PNG** or editable SVG.
- **Bundled announcer.** Tap the speaker on the TV to enable the original male Kokoro voice pack. It announces rolls, points, seven-outs, join/leave, re-ups, and other major events. Browsers require that user gesture before sound.

Place/hardway bets and come odds are **off on come-out**; traveled come bets themselves still work. Field 2 pays double and 12 triple. Proper denominations keep payouts exact. Full decisions and probabilities are documented in [game-and-network.md](docs/game-and-network.md).

## Build, test, and review

```sh
npm test                # deterministic rules and authority tests
npm run build           # portable static bundle in dist/
npx playwright install chromium
npm run test:e2e        # starts an isolated local server; TV + two phones
npm run test:online     # optional live PeerJS test against the published site
npm run format          # format source, tests, and workflows
```

CI tests and builds on Ubuntu, Windows, and macOS. The browser test covers first-player admin, a second phone, bets, rolling, a phone reload, ending the session, and a downloaded PNG. Dice/payout tests exercise both modes and wagering edge cases. Visual snapshots are saved locally to ignored `artifacts/`.

Publishing uses `.github/workflows/pages.yml`. From GitHub Actions, run **Publish crapsTV** and select the source branch; `main` also publishes after merge. Pages must be set to **GitHub Actions**. A PR can be reviewed without merging; publishing a chosen branch does not merge it.

## Inside the project

| Path | What lives here |
| --- | --- |
| `src/game.js` | Deterministic rules, cents-based ledger, probabilities, recaps |
| `src/hub.js` | Shared room authority, private reconnect tokens, action validation |
| `server/index.js` | Local HTTP/WebSocket host with same-origin check and heartbeat |
| `src/transport.js` | Local sockets or online PeerJS room transport |
| `src/Table3D.jsx` | Blender models, equirectangular artwork, real HDR lighting, dice animation |
| `public/assets/` | Original generated branding, vector boards, GLBs, HDR and previews |
| `assets/source/` | Editable Blender sources |
| `public/audio/` | 51 MP3 announcements with manifests, hashes, and license notice |
| `scripts/` | Optional reproducible board/model/audio generation |

No money changes hands. This is a casual game for friends; a human hosting a peer room controls that room’s authority. Sessions live in memory; save recap cards before stopping the local server or closing an online host. This version does not provide accounts, a lobby directory, public matchmaking, cloud saves, tournaments, hop bets, fire bets, buy/lay commission bets, or real-money gambling.

## Art and voice

The table/dice were built and exported with Blender; the boards are original editable SVGs. The image-generated casino panorama is **LDR**; the separate procedural RGBE lighting file contains genuine HDR radiance. They are not interchangeable. [Model details](docs/models.md) · [Image prompts and provenance](docs/visual-assets.md).

The male voice is **Kokoro `am_michael`**. NeuTTS-2E was investigated but required gated model access, so it is not used. All 51 playable clips are bundled; see [audio.md](docs/audio.md) for the pinned model, license, and regeneration instructions.

MIT licensed original code and assets; included third-party dependencies and font/model notices retain their respective licenses. This is an independent project, unaffiliated with Jackbox or Spotify.
