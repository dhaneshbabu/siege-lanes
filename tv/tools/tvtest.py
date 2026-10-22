"""Drive Powder Keg on the TV over ADB and the game's own phone protocol (for testing).

Usage (from a machine on the same network, with adb-shell and websockets installed):
  python3 tvtest.py install powder-keg-0.2.1.apk
  python3 tvtest.py launch
  python3 tvtest.py key 23             # OK / DPAD_CENTER (4 = Back, 19-22 = D-pad)
  python3 tvtest.py shot out.png
  python3 tvtest.py phones 2 40        # two fake phones join, ready up and play for 40 s
  python3 tvtest.py fps                # the frame rate counter's text, read from the TV's log
  python3 tvtest.py push dist/tv.js    # development: try a new page file without reinstalling
  python3 tvtest.py clear              # remove pushed files (back to the installed version)
  python3 tvtest.py restart            # restart the app
  python3 tvtest.py perf '{"render":{"prof":true}}' 45 4
      # performance check: push that debug.json (or 'none' to remove it), restart, play for 45 s
      # with 4 fake phones and print the frame-rate log (prof: drawing time by section)
"""
import asyncio, base64, hashlib, json, os, random, re, sys, time

TV = os.environ.get('TV_IP', '192.168.1.7')
PKG = 'app.powderkeg'
KEY = os.environ.get('ADB_KEY', os.path.expanduser('~/adbkey'))


def adb():
    from adb_shell.adb_device import AdbDeviceTcp
    from adb_shell.auth.keygen import keygen
    from adb_shell.auth.sign_pythonrsa import PythonRSASigner
    if not os.path.exists(KEY):
        keygen(KEY)
    signer = PythonRSASigner(open(KEY + '.pub').read(), open(KEY).read())
    d = AdbDeviceTcp(TV, 5555, default_transport_timeout_s=30.)
    d.connect(rsa_keys=[signer], auth_timeout_s=120)
    return d


def install(path):
    # The usual file push times out on this TV, so send the APK through the shell in base64 chunks.
    data = open(path, 'rb').read()
    b64 = base64.b64encode(data).decode()
    d = adb()
    d.shell('rm -f /data/local/tmp/pk.b64 /data/local/tmp/pk.apk', timeout_s=30)
    for i in range(0, len(b64), 32000):
        d.shell("echo -n '%s' >> /data/local/tmp/pk.b64" % b64[i:i + 32000], timeout_s=60)
    remote = d.shell('base64 -d /data/local/tmp/pk.b64 > /data/local/tmp/pk.apk && md5sum /data/local/tmp/pk.apk', timeout_s=60).split()[0]
    if remote != hashlib.md5(data).hexdigest():
        sys.exit('checksum mismatch, not installing')
    print(d.shell('pm install -r /data/local/tmp/pk.apk', timeout_s=120).strip())
    d.shell('rm -f /data/local/tmp/pk.b64 /data/local/tmp/pk.apk', timeout_s=30)
    print(d.shell("dumpsys package %s | grep -m1 versionName" % PKG, timeout_s=30).strip())


DEV = '/sdcard/Android/data/%s/files/web' % PKG


def push(local, name=None):
    """Development: put a page file in the app's own storage, where it replaces the built-in one."""
    name = name or os.path.basename(local)
    data = open(local, 'rb').read()
    b64 = base64.b64encode(data).decode()
    d = adb()
    dest = '%s/%s' % (DEV, name)
    d.shell('mkdir -p %s && rm -f %s.b64' % (os.path.dirname(dest), dest), timeout_s=30)
    for i in range(0, len(b64), 32000):
        d.shell("echo -n '%s' >> %s.b64" % (b64[i:i + 32000], dest), timeout_s=60)
    remote = d.shell('base64 -d %s.b64 > %s && rm -f %s.b64 && md5sum %s' % (dest, dest, dest, dest), timeout_s=60).split()[0]
    print(name, 'ok' if remote == hashlib.md5(data).hexdigest() else 'CHECKSUM MISMATCH')


def clear():
    """Remove pushed development files: the app goes back to its built-in page."""
    print(adb().shell('rm -rf %s; ls %s 2>&1' % (DEV, DEV), timeout_s=30).strip())


def restart():
    d = adb()
    d.shell('am force-stop %s' % PKG, timeout_s=30)
    print(d.shell('am start -n %s/.MainActivity' % PKG, timeout_s=30).strip())


def shot(out):
    d = adb()
    d.shell('screencap -p /data/local/tmp/s.png', timeout_s=60)
    txt = d.shell('base64 -w 0 /data/local/tmp/s.png', timeout_s=90)
    d.shell('rm -f /data/local/tmp/s.png', timeout_s=30)
    open(out, 'wb').write(base64.b64decode(re.sub(r'[^A-Za-z0-9+/=]', '', txt)))
    print('saved', out)


async def phone(name, seconds, log, start_delay=0.0):
    """A fake phone: joins, taps ready, then runs about and drops kegs now and then."""
    import websockets
    await asyncio.sleep(start_delay)
    pid = 'test' + re.sub(r'\W', '', name)
    kegs = 0
    async with websockets.connect(f'ws://{TV}:8080/ws?role=player&id={pid}') as ws:
        await ws.send(json.dumps({'t': 'hello', 'name': name, 'k': kegs}))
        await asyncio.sleep(0.5)
        await ws.send(json.dumps({'t': 'set', 'ready': True}))
        t0 = time.time()
        phase = None
        d = 0
        change = 0
        while time.time() - t0 < seconds:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.1))
                if msg.get('t') == 'state' and msg.get('phase') != phase:
                    phase = msg.get('phase')
                    log.append(f'{time.time() - t0:5.1f}s {name}: {phase} {msg.get("msg", "")}')
                    if phase == 'results':
                        await ws.send(json.dumps({'t': 'again'}))
            except asyncio.TimeoutError:
                pass
            if time.time() > change:
                change = time.time() + random.uniform(0.3, 1.0)
                d = random.choice([0, 1, 2, 3, 4, 1, 2, 3, 4])
                if random.random() < 0.25:
                    kegs += 1
            await ws.send(json.dumps({'t': 'in', 'd': d, 'a': 0, 'k': kegs}))
        await ws.send(json.dumps({'t': 'in', 'd': 0, 'a': 0, 'k': kegs}))


async def phones(n, seconds):
    log = []
    names = ['Test A', 'Test B', 'Test C', 'Test D'][:n]
    await asyncio.gather(*(phone(nm, seconds, log, i * 0.3) for i, nm in enumerate(names)))
    print('\n'.join(log))


def perf(cfg, seconds, n):
    d = adb()
    if cfg == 'none':
        d.shell('rm -f %s/debug.json' % DEV, timeout_s=30)
    else:
        json.loads(cfg)  # check it parses
        open('debug.json', 'w').write(cfg)
        push('debug.json')
    d.shell('logcat -c', timeout_s=30)
    d.shell('am force-stop %s' % PKG, timeout_s=30)
    d.shell('am start -n %s/.MainActivity' % PKG, timeout_s=30)
    time.sleep(5)
    asyncio.run(phones(n, seconds))
    out = d.shell("logcat -d -s PowderKeg:D | grep -E 'pk-(fps|prof|debug|prewarm)'", timeout_s=30)
    print('\n'.join(re.sub(r'^.*?(pk-)', r'\1', l).split(' (http')[0] for l in out.strip().splitlines()))


def fps():
    # The TV page logs its frame rate counter to the console (see MainActivity), so read logcat.
    d = adb()
    out = d.shell("logcat -d -s PowderKeg:D | grep pk-fps | tail -6", timeout_s=30)
    print(out.strip())


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'install': install(sys.argv[2])
    elif cmd == 'launch': print(adb().shell('am start -n %s/.MainActivity' % PKG, timeout_s=30).strip())
    elif cmd == 'stop': print(adb().shell('am force-stop %s' % PKG, timeout_s=30).strip())
    elif cmd == 'key':
        d = adb()
        for k in sys.argv[2:]:
            d.shell('input keyevent ' + k, timeout_s=30)
            time.sleep(0.6)
    elif cmd == 'shot': shot(sys.argv[2])
    elif cmd == 'phones': asyncio.run(phones(int(sys.argv[2]), float(sys.argv[3])))
    elif cmd == 'fps': fps()
    elif cmd == 'push':
        for f in sys.argv[2:]: push(f)
    elif cmd == 'clear': clear()
    elif cmd == 'restart': restart()
    elif cmd == 'perf': perf(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 30, int(sys.argv[4]) if len(sys.argv) > 4 else 2)
    elif cmd == 'shell': print(adb().shell(' '.join(sys.argv[2:]), timeout_s=60))
