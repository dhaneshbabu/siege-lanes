# Siege Lanes

A tower-defence game for phones where players fight each other. Each player defends their own
road; sending enemies down an opponent's road costs gold now and raises your income for the
rest of the match. Last castle standing wins.

It runs entirely as static files, so GitHub Pages hosts it:
**https://dhaneshbabu.github.io/siege-lanes/**

## Status

- **Stage 1 (now): practice against a bot.** Easy, Normal or Hard; Short (4–6 min) or
  Standard (6–9 min) matches.
- Stage 2: 1v1 between phones (WebRTC via PeerJS, same Wi-Fi or across networks).
- Stage 3: 2v2 with four phones.
- Stage 4: balance and polish.

## More games in this repo

- **Castle Conquest** ([`/conquest/`](https://dhaneshbabu.github.io/siege-lanes/conquest/)):
  real-time strategy. Holdings train soldiers; drag from yours to send them, take villages,
  towns and castles. 1 v 1, 2 v 2, or 3–4 player free-for-all against bots. Matches last
  4 minutes; if time runs out, the most land wins. `node conquest/tools/balance.mjs` runs
  bot-vs-bot matches.
- **Powder Keg** ([`/arena/`](https://dhaneshbabu.github.io/siege-lanes/arena/)): a
  Bomberman-style courtyard brawl. Drop powder kegs, break crates for power-ups (extra keg,
  bigger blast, boots) and be the last knight standing. Stone closes in from the edges after
  about a minute. 1 v 1, 2 v 2, or 3–4 player free-for-all against bots, first to 2 or 3 round
  wins. On-screen stick and keg button, or arrow keys/WASD and Space.
  `node arena/tools/balance.mjs` runs bot-vs-bot rounds.

The phone-to-phone connection test lives at [`/nettest/`](https://dhaneshbabu.github.io/siege-lanes/nettest/).

## Rules in brief

- 9×12 lane with a fixed winding road. Enemies leak through the castle gate and cost lives
  (Ogres 2, Siege Giants 5). Everyone starts with 20 lives.
- Towers go on 24 stone plots beside the road (`PLOTS` in `src/config.js`).
- Towers: Archer (fast, weak against armour), Cannon (splash), Frost Mage (slows),
  Ballista (long range, targets the toughest enemy, ignores armour). Each has 3 levels with
  their own look: wooden post, stone tower, keep. Selling within 4 seconds of building
  refunds everything.
- Turn the phone sideways to see both lanes side by side (stats on the left, send buttons on
  the right). Upright shows your lane bigger; the strip under the HUD then shows the
  opponent's road as a line with your units on it, and tapping it shows their whole lane.
  Rotating switches layouts mid-match.
- Sends: Goblins, Scouts, Shieldbearers, Ogre (unlocks later), Siege Giant (unlocks late).
- Background waves hit every player at the same moment and toughen over time. Sudden death
  doubles the cost of leaks and speeds up the toughening.
- A wave arrives every 12 seconds in both lengths. Short runs the growth clock faster
  (wave toughness, income, unlocks, sudden death), so it ends sooner with the same balance.
- Bot difficulty: Easy earns 15% less gold and plays sloppier; Hard earns 15% more and plays
  sharper and more aggressively.

## Code

No build step: plain ES modules.

| File | What it does |
| --- | --- |
| `src/config.js` | All rules and balance numbers |
| `src/geom.js` | Road geometry, buildable cells, road coverage |
| `src/sim.js` | One lane's fixed-tick simulation (20 Hz), DOM-free |
| `src/match.js` | Match clock, waves, sends between players, elimination |
| `src/bot.js` | Practice opponent; uses the same actions as a player |
| `src/render.js` | Canvas drawing of the lane |
| `src/audio.js` | Synthesised sound effects |
| `src/main.js` | Menus, HUD, input, game loop |
| `nettest/` | Connection test page |
| `vendor/` | Pinned PeerJS and QR code libraries |

### Local development

```sh
python3 -m http.server 8080      # then open http://localhost:8080/
node tools/balance.mjs 20         # headless bot-vs-bot matches for tuning
```

The balance script prints win counts, match lengths, income and lives at sudden death for
each pairing, in both match lengths.
