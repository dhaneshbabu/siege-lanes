# Siege Lanes

A tower-defence game where players on their own phones send enemies at each other.
Phones talk directly over Wi-Fi (WebRTC via PeerJS), so the game is just static files on GitHub Pages.

## Status

The game isn't built yet. Right now the repo holds a **connection test** that checks whether
phones on your Wi-Fi can link up directly:

- https://dhaneshbabu.github.io/siege-lanes/nettest/ (the site root redirects here for now)

### Running the test

1. Open the link on phone A and tap **Host a test**. It shows a 4-letter code and a QR code.
2. On phone B, scan the QR code (or open the link and type the code).
3. Work down the checklist on both phones: ring the bell on each, then lock one phone for about 10 seconds.
4. Tap **Copy results** on each phone to copy a text report of what happened.

## How it connects

- The PeerJS public server (`0.peerjs.com`) only introduces the phones to each other.
  After that, game traffic goes straight between phones on the Wi-Fi.
- Ids on that server are namespaced with `siegelanes-t1-` plus the game code.
- If a direct path fails, PeerJS falls back to its public TURN relay; the test reports this as "Relayed".

## Local development

```sh
# static files
python3 -m http.server 8080
# a local PeerServer (instead of 0.peerjs.com), bound to IPv4
npx peer --port 9000
```

Then open `http://localhost:8080/nettest/?server=localhost:9000&insecure=1` in two browser profiles.

## Layout

- `nettest/index.html` – the connection test (single file: markup, styles, script)
- `vendor/` – pinned third-party scripts (PeerJS 1.5.5, QR Code Generator 1.4.4), licenses in `vendor/LICENSES.md`
- `index.html` – redirects to the test until the game exists
