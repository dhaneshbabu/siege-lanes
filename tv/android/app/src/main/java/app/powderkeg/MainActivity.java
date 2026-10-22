package app.powderkeg;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;

/** Full-screen WebView showing the TV page, served by the built-in game server. */
public class MainActivity extends Activity {
    private static final String TAG = "PowderKeg";
    private RelayServer server;
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        server = startServer();

        web = new WebView(this);
        web.setBackgroundColor(0xFF151A22);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        setContentView(web);

        if (server != null) {
            web.loadUrl("http://127.0.0.1:" + server.getPortNumber() + "/tv.html");
        } else {
            web.loadData("<body style='background:#151a22;color:#ece2cc;font:28px sans-serif;padding:60px'>"
                    + "Powder Keg couldn't start its game server (ports 8080 to 8090 are busy). Restart the TV and try again.</body>",
                    "text/html", "utf-8");
        }
        web.requestFocus();
    }

    private RelayServer startServer() {
        // Development: files pushed to the app's own storage (Android/data/app.powderkeg/files/web/)
        // replace the built-in ones, so a new build of the page can be tried without reinstalling.
        File ext = getExternalFilesDir(null);
        RelayServer.Assets assets = path -> {
            if (ext != null) {
                File f = new File(ext, "web/" + path);
                if (f.isFile()) return new FileInputStream(f);
            }
            return getAssets().open("web/" + path);
        };
        for (int port = 8080; port <= 8090; port++) {
            RelayServer s = new RelayServer(port, assets);
            try {
                // 15 s read timeout: phones ping every 3 s, so dead connections get dropped.
                s.start(15000, false);
                Log.i(TAG, "Game server on port " + port);
                return s;
            } catch (IOException e) {
                Log.w(TAG, "Port " + port + " unavailable", e);
            }
        }
        return null;
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK && web != null) {
            // Let the game decide: Back pauses a match or leaves the results; in the lobby it exits.
            if (event.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("(window.tvBack && window.tvBack()) ? '1' : '0'", value -> {
                    if (!"\"1\"".equals(value)) finish();
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        super.onDestroy();
    }
}
