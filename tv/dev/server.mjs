// Development server with the same protocol as the Android app's built-in server.
// Run:  node dev/server.mjs   then open http://localhost:8080/tv.html on the computer
// and http://<computer-ip>:8080/ on phones.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const root = path.resolve(process.argv[2] || 'dist');
const port = +(process.env.PORT || 8080);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };

function lanIp() {
  if (process.env.JOIN_IP) return process.env.JOIN_IP;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(a.address)) return a.address;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    const ip = lanIp();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ url: ip ? `http://${ip}:${port}/` : null }));
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/tv' ? '/tv.html' : url.pathname;
  const file = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// Relay: one host (the TV page), many players (phones).
// player -> host : "<id>\n<json>"     host -> player(s): "<id|*>\n<json>"
const wss = new WebSocketServer({ noServer: true });
let host = null;
const players = new Map();
const ID = /^[A-Za-z0-9_-]{1,32}$/;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const role = url.searchParams.get('role'), id = url.searchParams.get('id') || '';
  if (url.pathname !== '/ws' || !(role === 'host' || (role === 'player' && ID.test(id)))) { socket.destroy(); return; }
  if (role === 'player' && !players.has(id) && players.size >= 8) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => (role === 'host' ? onHost(ws) : onPlayer(ws, id)));
});

function onHost(ws) {
  if (host) host.close();
  host = ws;
  for (const id of players.keys()) ws.send(`${id}\n{"t":"open"}`);
  for (const p of players.values()) p.send('{"t":"hostback"}');
  ws.on('message', (data) => {
    const s = String(data);
    if (s === 'ping') return;
    const nl = s.indexOf('\n');
    if (nl < 0) return;
    const to = s.slice(0, nl), payload = s.slice(nl + 1);
    if (to === '*') for (const p of players.values()) p.send(payload);
    else players.get(to)?.send(payload);
  });
  ws.on('close', () => {
    if (host !== ws) return;
    host = null;
    for (const p of players.values()) p.send('{"t":"hostgone"}');
  });
}

function onPlayer(ws, id) {
  const old = players.get(id);
  players.set(id, ws);
  if (old) old.close();
  host?.send(`${id}\n{"t":"open"}`);
  ws.on('message', (data) => {
    const s = String(data);
    if (s === 'ping' || s.length > 2000) return;
    host?.send(`${id}\n${s}`);
  });
  ws.on('close', () => {
    if (players.get(id) !== ws) return;
    players.delete(id);
    host?.send(`${id}\n{"t":"close"}`);
  });
}

server.listen(port, () => {
  const ip = lanIp();
  console.log(`Powder Keg dev server on http://localhost:${port}/tv.html`);
  if (ip) console.log(`Phones: http://${ip}:${port}/`);
});
