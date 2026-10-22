package app.powderkeg;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoWSD;

/**
 * The game's local server, running inside the TV app.
 * Serves the TV page and the phone controller page, and relays WebSocket messages:
 * phone -> TV page as "<playerId>\n<json>", TV page -> phone(s) as "<playerId|*>\n<json>".
 * Plain Java (no Android imports) so it can also be run and tested on a desktop JVM.
 */
public class RelayServer extends NanoWSD {

    public interface Assets {
        InputStream open(String path) throws IOException;
    }

    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,32}");
    private static final int MAX_PLAYERS = 8;

    private final Assets assets;
    private final int port;
    private final Map<String, byte[]> cache = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Conn> players = new ConcurrentHashMap<>();
    private volatile Conn host;

    public RelayServer(int port, Assets assets) {
        super(port);
        this.port = port;
        this.assets = assets;
    }

    public int getPortNumber() {
        return port;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String upgrade = session.getHeaders().get("upgrade");
        if (upgrade != null && upgrade.equalsIgnoreCase("websocket")) {
            String role = param(session, "role");
            String id = param(session, "id");
            boolean ok = "/ws".equals(session.getUri())
                    && ("host".equals(role) || ("player".equals(role) && id != null && ID.matcher(id).matches()));
            if (ok && "player".equals(role) && !players.containsKey(id) && players.size() >= MAX_PLAYERS) ok = false;
            if (!ok) return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "Forbidden");
        }
        return super.serve(session);
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        String role = param(handshake, "role");
        return new Conn(handshake, "host".equals(role), param(handshake, "id"));
    }

    @Override
    protected Response serveHttp(IHTTPSession session) {
        String uri = session.getUri();
        if ("/api/info".equals(uri)) {
            String ip = lanAddress();
            String json = ip == null ? "{\"url\":null}" : "{\"url\":\"http://" + ip + ":" + port + "/\"}";
            Response r = newFixedLengthResponse(Response.Status.OK, "application/json", json);
            r.addHeader("Cache-Control", "no-store");
            return r;
        }
        String path = "/".equals(uri) ? "index.html" : "/tv".equals(uri) ? "tv.html" : uri.substring(1);
        if (path.isEmpty() || path.contains("..") || path.startsWith("/") || path.contains("\\")) return notFound();
        byte[] data = cache.get(path);
        if (data == null) {
            try (InputStream in = assets.open(path)) {
                data = readAll(in);
                cache.put(path, data);
            } catch (IOException e) {
                return notFound();
            }
        }
        Response r = newFixedLengthResponse(Response.Status.OK, mime(path), new ByteArrayInputStream(data), data.length);
        r.addHeader("Cache-Control", "no-cache");
        return r;
    }

    private Response notFound() {
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
    }

    // ---- relay ----

    private void onHostOpen(Conn c) {
        Conn old = host;
        host = c;
        if (old != null && old != c) old.closeQuietly();
        for (String id : players.keySet()) c.sendText(id + "\n{\"t\":\"open\"}");
        for (Conn p : players.values()) p.sendText("{\"t\":\"hostback\"}");
    }

    private void onPlayerOpen(Conn c) {
        Conn old = players.put(c.id, c);
        if (old != null && old != c) old.closeQuietly();
        Conn h = host;
        if (h != null) h.sendText(c.id + "\n{\"t\":\"open\"}");
    }

    private void onClosed(Conn c) {
        if (c.isHost) {
            if (host == c) {
                host = null;
                for (Conn p : players.values()) p.sendText("{\"t\":\"hostgone\"}");
            }
        } else if (c.id != null && players.remove(c.id, c)) {
            Conn h = host;
            if (h != null) h.sendText(c.id + "\n{\"t\":\"close\"}");
        }
    }

    private void onText(Conn c, String s) {
        if ("ping".equals(s)) return;
        if (c.isHost) {
            int nl = s.indexOf('\n');
            if (nl < 0) return;
            String to = s.substring(0, nl);
            String payload = s.substring(nl + 1);
            if ("*".equals(to)) {
                for (Conn p : players.values()) p.sendText(payload);
            } else {
                Conn p = players.get(to);
                if (p != null) p.sendText(payload);
            }
        } else {
            if (s.length() > 2000) return;
            Conn h = host;
            if (h != null) h.sendText(c.id + "\n" + s);
        }
    }

    private class Conn extends WebSocket {
        final boolean isHost;
        final String id;

        Conn(IHTTPSession handshake, boolean isHost, String id) {
            super(handshake);
            this.isHost = isHost;
            this.id = id;
        }

        @Override
        protected void onOpen() {
            if (isHost) onHostOpen(this); else onPlayerOpen(this);
        }

        @Override
        protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            onClosed(this);
        }

        @Override
        protected void onMessage(WebSocketFrame message) {
            String text = message.getTextPayload();
            if (text != null) onText(this, text);
        }

        @Override
        protected void onPong(WebSocketFrame pong) {
        }

        @Override
        protected void onException(IOException exception) {
            onClosed(this);
        }

        void sendText(String s) {
            synchronized (this) {
                try {
                    if (isOpen()) send(s);
                } catch (IOException ignored) {
                    // The connection is going away; its close handler cleans up.
                }
            }
        }

        void closeQuietly() {
            try {
                close(WebSocketFrame.CloseCode.GoingAway, "replaced", false);
            } catch (IOException ignored) {
                // Already closed.
            }
        }
    }

    // ---- helpers ----

    private static String param(IHTTPSession s, String key) {
        Map<String, List<String>> q = s.getParameters();
        List<String> v = q.get(key);
        return v == null || v.isEmpty() ? null : v.get(0);
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    /** The TV's address on the home network, preferring Ethernet, then Wi-Fi. */
    public static String lanAddress() {
        String override = System.getProperty("powderkeg.joinIp");
        if (override != null && !override.isEmpty()) return override;
        String best = null;
        int bestRank = Integer.MAX_VALUE;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                String name = ni.getName().toLowerCase(Locale.ROOT);
                int rank = name.startsWith("eth") ? 0 : name.startsWith("wlan") ? 1 : 2;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress() && rank < bestRank) {
                        best = a.getHostAddress();
                        bestRank = rank;
                    }
                }
            }
        } catch (Exception ignored) {
            // No network interfaces available.
        }
        return best;
    }
}
