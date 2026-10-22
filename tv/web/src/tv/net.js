// Host side of the relay. The server forwards "<playerId>\n<json>" from phones,
// and we send "<playerId|*>\n<json>" back.
export function connectHost({ onMessage, onStatus }) {
  let ws = null, retry = 0, pingTimer = null;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?role=host`);
    ws.onopen = () => {
      retry = 0;
      onStatus(true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 3000);
    };
    ws.onmessage = (ev) => {
      const s = String(ev.data);
      const nl = s.indexOf('\n');
      if (nl < 0) return;
      const from = s.slice(0, nl);
      let msg;
      try { msg = JSON.parse(s.slice(nl + 1)); } catch { return; }
      if (msg && typeof msg.t === 'string') onMessage(from, msg);
    };
    ws.onclose = () => {
      onStatus(false);
      clearInterval(pingTimer);
      setTimeout(open, Math.min(4000, 300 * 2 ** retry++));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  };
  open();
  return {
    send(to, msg) { if (ws && ws.readyState === 1) ws.send(`${to}\n${JSON.stringify(msg)}`); },
  };
}
