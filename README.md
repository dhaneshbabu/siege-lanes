# Siege Lanes

A tower-defence game for phones where players fight each other. Each player defends their own
road; sending enemies down an opponent's road costs gold now and raises your income for the
rest of the match. Last castle standing wins.

It runs entirely as static files, so GitHub Pages hosts it:
**https://dhaneshbabu.github.io/siege-lanes/**

## Status

- **Stage 1 (now): practice against a bot.** Easy, Normal or Hard; Short (about 7 min) or
  Standard (about 12 min) matches.
- Stage 2: 1v1 between phones (WebRTC via PeerJS, same Wi-Fi or across networks).
- Stage 3: 2v2 with four phones.
- Stage 4: balance and polish.

The phone-to-phone connection test lives at [`/nettest/`](https://dhaneshbabu.github.io/siege-lanes/nettest/).

## Rules in brief

- 9×12 lane with a fixed winding road. Enemies leak through the castle gate and cost lives
  (Ogres 2, Siege Giants 5). Everyone starts with 20 lives.
- Towers: Archer (fast, weak against armour), Cannon (splash), Frost Mage (slows),
  Ballista (long range, targets the toughest enemy, ignores armour). Each has 3 levels.
  Selling within 4 seconds of building refunds everything.
- Sends: Goblins, Scouts, Shieldbearers, Ogre (unlocks later), Siege Giant (unlocks late).
- Background waves hit every player at the same moment and toughen over time. Sudden death
  doubles the cost of leaks and speeds up the toughening.
- Short matches run the battle clock 1.5× faster (waves, income, unlocks, sudden death);
  combat itself runs at the same speed.

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
