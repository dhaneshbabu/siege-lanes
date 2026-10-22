# Powder Keg on the TV

An Android TV app for Powder Keg. The courtyard is on the TV and each player uses their phone
as a controller: a stick and a Keg button. Phones join by scanning the QR code in the lobby.
They don't install anything; the phone page comes from the TV itself. Up to 4 phones can join,
and bots take any empty seats. With no phones, the TV remote plays a practice match.

The rules, bots, drawing and sounds are the web game's own (`../arena/src`), bundled into the
TV page.

## How it fits together

- **The app** (`android/`) is one full-screen WebView. It has a small web server
  (NanoHTTPD 2.3.1, on the first free port from 8080 to 8090) that serves the TV page and the
  phone page from the app's assets. It also relays messages over WebSockets:
  - phone → TV: `<id>\n<json>`
  - TV → phones: `<id|*>\n<json>`
- **The TV page** (`web/tv.html`, `web/src/tv/main.js`) runs the whole match.
  - Messages from phones:
    - `hello` (name, Keg count)
    - `set` (name, ready, side)
    - `in` (stick, second stick, Keg press count)
    - `again`
  - Messages to phones:
    - `state` (screen, your knight, match result)
    - `hud` (4 times a second)
    - `buzz` (vibrate)
- **The phone page** (`web/index.html`, `web/src/phone/main.js`) sends each change at once and
  repeats its state every 250 ms, so a lost message never leaves a knight running. A phone
  that goes quiet for 1.5 seconds mid-round gets a stand-in bot until it's back.
- **The remote:**
  - In the lobby and menus: D-pad and OK.
  - In any match: Back pauses. In a phone match, OK pauses too.
  - In practice (no phones): the D-pad runs and OK drops a keg.
  - On the results screen: Back returns to the lobby.
  - In the lobby: Back leaves the app.

### Speed on a TV

The TV's graphics chip is slow at drawing curves, outlines and gradients, but quick at copying
pictures. So on the TV, the renderer (`ArenaRenderer` with a `SpriteKit`) draws each of these
once into a small picture and stamps it from then on:

- knight poses (9 steps of a stride × 4 directions × each colour)
- kegs
- blast shapes
- power-ups
- labels
- the light from the wall torches

Other ways it saves work:

- All crates and stones are a single picture, redrawn only around a tile that changes. The
  front of the next row is stamped again over whatever stands behind it.
- Scorch marks are burned into the floor picture.
- Pictures are drawn ahead of time while the lobby waits.

The phone and computer game draws everything directly, as before.

**Graphics: Auto** renders the courtyard between 540p and 1080p. Each second it checks the
frame rate: it drops a step below 52 fps and goes back up after 3 seconds at full speed.

Measured on a OnePlus 43Y1S Pro, with 4 knights:

| Version | Frame rate | Resolution |
|---|---|---|
| Before these changes | 17–29 fps | 540p |
| Now | 60 fps | 1080p, with brief dips that Auto rides out |

The **Frame rate counter** (in the lobby settings) shows:

- fps
- the slowest frame
- the render resolution
- milliseconds spent on the game logic and on drawing

## Building

You need Node 18+, JDK 17+, Gradle 8.x and the Android SDK (platform 35, build tools 35).
AGP 8.9.1, minSdk 24.

```sh
npm install
npm run dev      # dist/ plus a test server: open http://localhost:8080/tv.html, phones at your IP
npm run apk      # bundles the pages into the app, signs it: android/app/build/outputs/apk/release/
```

- **Signing:** `android/keystore/powderkeg.jks` (password and alias `powderkeg`). It isn't in
  git, so keep it with the source zip. Updates must be signed with the same key, or Android
  makes you uninstall first.
- **Version:** set `versionCode` and `versionName` in `android/app/build.gradle`.
- **Art:**
  - `tools/make-art.mjs` draws the Leanback banner (`tools/banner.js`).
  - The launcher icons are resized from `../arena/icons/icon-512.png`.

## Installing and testing on the TV

Turn on Developer options and network debugging (ADB) on the TV. Then, from a computer on the
same Wi-Fi with Python and `pip install adb-shell websockets`:

```sh
export TV_IP=192.168.1.7
python3 tools/tvtest.py install powder-keg-0.2.1.apk   # the TV asks to allow the computer the first time
python3 tools/tvtest.py launch
python3 tools/tvtest.py key 23                         # OK (4 Back, 19–22 the D-pad)
python3 tools/tvtest.py phones 4 40                    # four fake phones join, ready up and play
python3 tools/tvtest.py shot tv.png                    # screenshot
python3 tools/tvtest.py fps                            # the frame-rate counter, from the TV's log
```

The APK goes over in base64 chunks with an md5 check, because a plain `adb push` times out on
this TV.

### Trying changes without reinstalling

The app serves files from its own storage folder on the TV
(`/sdcard/Android/data/app.powderkeg/files/web/`) ahead of the built-in ones:

```sh
npm run build && python3 tools/tvtest.py push dist/tv.js && python3 tools/tvtest.py restart
python3 tools/tvtest.py clear                          # back to the installed version
```

A `debug.json` in that folder switches parts of the drawing off, to find what costs the most.
`perf` pushes one, restarts, plays with fake phones and prints the log.

```sh
python3 tools/tvtest.py perf '{"render":{"prof":true}}' 45 4
```

| Key | What it does |
|---|---|
| `render.prof` | Drawing time by section, every 5 s |
| `render.noBg`, `noTiles`, `noKegs`, `noKnights`, `noFlames`, `noParts`, `noLights` | Skip that part of the drawing |
| `noKit` | Draw everything directly, as on a phone |
| `noBitmaps` | Keep the pictures as canvases instead of ImageBitmaps |
| `noScene` | No picture in the lobby |
| `hideDom` | Hide the player cards and side panels |
| `quality` | `auto`, `low`, `medium` or `high` |
