package com.jtmedia.crapstv;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

public class MainActivity extends Activity {
  private static final String HOST = "http://127.0.0.1:3000";
  private static final int WIFI_PERMISSION = 41;
  private static final String STARTUP = """
      <!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>CrapsTV</title><style>
      body{margin:0;background:#091a13;color:#f6ebd1;font:17px system-ui;
           display:grid;place-items:center;min-height:100vh;text-align:center}
      h1{font-size:32px;margin:0 0 8px;color:#eacc8d}
      p{margin:0 0 18px;color:#c7d4cb}
      a{display:inline-block;padding:12px 19px;border-radius:10px;color:#182920;background:#eacc8d;
        text-decoration:none;font-weight:650}
      a[hidden]{display:none}
      </style><main><h1>CrapsTV</h1><p id="status">Opening the table…</p>
      <a href="crapstv://host/retry" id="retry" hidden>Try again</a></main></html>
      """;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private WebView web;
  private boolean pendingHotspot;
  private boolean ready;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    pendingHotspot = state != null && state.getBoolean("pendingHotspot");
    web = new WebView(this);
    web.setBackgroundColor(0xff091a13);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri destination = request.getUrl();
        String current = view.getUrl();
        if (request.isForMainFrame() && "crapstv".equals(destination.getScheme())
            && "host".equals(destination.getHost()) && current != null
            && current.startsWith(HOST + "/")) {
          String action = destination.getPath();
          if (action != null) handleAction(action, destination);
          return true;
        }
        return !("http".equals(destination.getScheme())
            && "127.0.0.1".equals(destination.getHost()) && destination.getPort() == 3000);
      }
    });
    setContentView(web);
    web.loadDataWithBaseURL(HOST + "/startup", STARTUP, "text/html", "UTF-8", null);
    startForegroundService(new Intent(this, HostService.class));
    waitForHost(0);
  }

  private void fullScreen() {
    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
      WindowInsetsController bars = getWindow().getInsetsController();
      if (bars != null) {
        bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsets.Type.systemBars());
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);
    }
  }

  @Override
  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (focused) fullScreen();
  }

  private void waitForHost(int attempts) {
    new Thread(() -> {
      boolean reachable = false;
      try {
        HttpURLConnection connection = (HttpURLConnection) new URL(HOST + "/api/config").openConnection();
        connection.setConnectTimeout(700);
        connection.setReadTimeout(700);
        try {
          reachable = connection.getResponseCode() == 200;
        } finally {
          connection.disconnect();
        }
      } catch (Exception ignored) {
        // The bundled server is still coming up.
      }
      final boolean connected = reachable;
      handler.post(() -> {
        if (isFinishing() || isDestroyed() || ready) return;
        if (connected) {
          ready = true;
          web.loadUrl(HOST + "/");
        } else if (attempts < 60) {
          handler.postDelayed(() -> waitForHost(attempts + 1), 1000);
        } else {
          web.evaluateJavascript(
              "document.getElementById('status').textContent='The local table hasn’t started.';"
              + "document.getElementById('retry').hidden=false;", null);
        }
      });
    }, "crapstv-check").start();
  }

  private void handleAction(String action, Uri destination) {
    if ("/retry".equals(action) && !ready) {
      web.evaluateJavascript("document.getElementById('retry').hidden=true;", null);
      waitForHost(0);
      return;
    }
    if (!ready) return;
    switch (action) {
      case "/offline":
        chooseHotspot();
        break;
      case "/wifi":
        service("USE_LAN");
        openSettings(new Intent(Settings.ACTION_WIFI_SETTINGS));
        break;
      case "/hotspot":
        service("USE_SYSTEM_HOTSPOT");
        openSettings(new Intent("android.settings.TETHER_SETTINGS"));
        break;
      case "/location":
        openSettings(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        break;
      case "/app-settings":
        openSettings(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getPackageName())));
        break;
      case "/address":
        String ip = destination.getQueryParameter("ip");
        if (ip != null && (ip.isEmpty() || validIPv4(ip)))
          getSharedPreferences("host", 0).edit().putString("ip", ip).apply();
        break;
      case "/stop":
        service("STOP");
        break;
    }
  }

  private void service(String action) {
    startForegroundService(new Intent(this, HostService.class).setAction(action));
  }

  private void openSettings(Intent intent) {
    try {
      startActivity(intent);
    } catch (ActivityNotFoundException ignored) {
      startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
    }
  }

  private String hotspotPermission() {
    return Build.VERSION.SDK_INT >= 33
        ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
  }

  private boolean locationEnabled() {
    if (Build.VERSION.SDK_INT >= 28)
      return getSystemService(LocationManager.class).isLocationEnabled();
    return Settings.Secure.getInt(getContentResolver(), Settings.Secure.LOCATION_MODE, 0) != 0;
  }

  private void help(String reason) {
    web.evaluateJavascript("window.dispatchEvent(new CustomEvent('crapstv:network-help',"
        + "{detail:" + JSONObject.quote(reason) + "}))", null);
  }

  private void chooseHotspot() {
    String permission = hotspotPermission();
    if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
      pendingHotspot = true;
      requestPermissions(Build.VERSION.SDK_INT >= 33 ? new String[] {permission}
          : new String[] {Manifest.permission.ACCESS_COARSE_LOCATION, permission}, WIFI_PERMISSION);
      return;
    }
    pendingHotspot = false;
    if (Build.VERSION.SDK_INT <= 32 && !locationEnabled()) {
      help("location");
      return;
    }
    service("HOTSPOT");
  }

  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request != WIFI_PERMISSION || !pendingHotspot) return;
    pendingHotspot = false;
    if (checkSelfPermission(hotspotPermission()) == PackageManager.PERMISSION_GRANTED)
      chooseHotspot();
    else
      help("permission");
  }

  private boolean validIPv4(String ip) {
    String[] parts = ip.split("\\.", -1);
    if (parts.length != 4) return false;
    for (String part : parts)
      if (!part.matches("\\d{1,3}") || Integer.parseInt(part) > 255) return false;
    return true;
  }

  @Override
  public void onBackPressed() {
    web.evaluateJavascript("window.dispatchEvent(new Event('crapstv:back',{cancelable:true}))",
        (unhandled) -> {
          if (!"false".equals(unhandled)) super.onBackPressed();
        });
  }

  @Override
  public void onSaveInstanceState(Bundle state) {
    state.putBoolean("pendingHotspot", pendingHotspot);
    super.onSaveInstanceState(state);
  }

  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    web.destroy();
    super.onDestroy();
  }
}
