package com.jtmedia.crapstv;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.net.*;

public class MainActivity extends Activity {
  private WebView web;
  private boolean pendingHotspot;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private String wanted = "/android-host";
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    LinearLayout bar = new LinearLayout(this);
    button(bar, "Host", () -> navigate("/android-host"));
    button(bar, "Settings", this::settings);
    button(bar, "Table", () -> navigate("/"));
    layout.addView(bar);
    Button offline = new Button(this);
    offline.setText("Host on my own Wi-Fi");
    offline.setOnClickListener(v -> chooseHotspot());
    layout.addView(offline);
    web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
        boolean full = url.startsWith("http://127.0.0.1:3000/android-qr");
        bar.setVisibility(full ? View.GONE : View.VISIBLE);
        offline.setVisibility(full ? View.GONE : View.VISIBLE);
        if (full)
          getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        else
          getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      }
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        return !("http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost())
            && u.getPort() == 3000);
      }
    });
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    startForegroundService(new Intent(this, HostService.class));
    pendingHotspot = state != null && state.getBoolean("pendingHotspot", false);
    waitForHost(0);
  }
  private void button(LinearLayout bar, String text, Runnable action) {
    Button b = new Button(this);
    b.setText(text);
    b.setOnClickListener(v -> action.run());
    bar.addView(b, new LinearLayout.LayoutParams(0, -2, 1));
  }
  private void waitForHost(int attempt) {
    new Thread(() -> {
      boolean ready = false;
      try {
        HttpURLConnection c =
            (HttpURLConnection) new URL("http://127.0.0.1:3000/api/config").openConnection();
        c.setConnectTimeout(700);
        c.setReadTimeout(700);
        ready = c.getResponseCode() == 200;
        c.disconnect();
      } catch (Exception ignored) {
      }
      final boolean ok = ready;
      handler.post(() -> {
        if (isFinishing())
          return;
        if (ok)
          navigate(wanted);
        else if (attempt < 180)
          handler.postDelayed(() -> waitForHost(attempt + 1), 1000);
        else
          new AlertDialog.Builder(this)
              .setMessage("Host did not start. Stop the session and reopen the app. You can also "
                          + "inspect Android logs for crapstv.")
              .setPositiveButton("OK", null)
              .show();
      });
    }).start();
  }
  private void navigate(String path) {
    wanted = path;
    web.loadUrl("http://127.0.0.1:3000" + path);
  }
  private void chooseHotspot() {
    String permission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.NEARBY_WIFI_DEVICES
                                                    : Manifest.permission.ACCESS_FINE_LOCATION;
    if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
      pendingHotspot = false;
      startForegroundService(new Intent(this, HostService.class).setAction("HOTSPOT"));
      navigate("/android-host");
      return;
    }
    pendingHotspot = true;
    requestPermissions(new String[] {permission}, 41);
  }
  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request != 41)
      return;
    if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && pendingHotspot) {
      chooseHotspot();
      return;
    }
    pendingHotspot = false;
    new AlertDialog.Builder(this)
        .setTitle("Wi-Fi permission needed")
        .setMessage(
            "Android requires this permission to create your local network. Choose Retry, or "
            + "enable it in App Settings. On Android 8–12, Location services must also be on.")
        .setPositiveButton("Retry", (d, w) -> chooseHotspot())
        .setNeutralButton("App Settings",
            (d, w)
                -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName()))))
        .setNegativeButton("Cancel", null)
        .show();
  }
  private void settings() {
    new AlertDialog.Builder(this)
        .setTitle("Host Settings")
        .setItems(new String[] {"Network Setup / Wi-Fi QR", "Host on my own Wi-Fi",
                      "Android hotspot settings", "Choose host IP address", "Stop session"},
            (d, which) -> {
              if (which == 0)
                navigate("/android-network");
              if (which == 1)
                chooseHotspot();
              if (which == 2) {
                try {
                  startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                } catch (Exception e) {
                  startActivity(new Intent(Settings.ACTION_SETTINGS));
                }
              }
              if (which == 3) {
                EditText ip = new EditText(this);
                ip.setSingleLine();
                ip.setHint("IPv4 address, or blank for automatic");
                ip.setText(getSharedPreferences("host", 0).getString("ip", ""));
                new AlertDialog.Builder(this)
                    .setTitle("Host address (advanced)")
                    .setView(ip)
                    .setMessage("Use the hotspot host IPv4 address shown by Android. Leave blank "
                                + "to detect automatically.")
                    .setPositiveButton("Save",
                        (a, b) -> {
                          String value = ip.getText().toString().trim();
                          if (!value.isEmpty() && !validIPv4(value)) {
                            Toast.makeText(this, "Enter a valid IPv4 address", Toast.LENGTH_LONG)
                                .show();
                            return;
                          }
                          getSharedPreferences("host", 0).edit().putString("ip", value).apply();
                          navigate("/android-host");
                        })
                    .setNegativeButton("Cancel", null)
                    .show();
              }
              if (which == 4)
                new AlertDialog.Builder(this)
                    .setMessage("Stop hosting? All guests will disconnect and this room will end.")
                    .setPositiveButton("Stop",
                        (a, b)
                            -> startService(new Intent(this, HostService.class).setAction("STOP")))
                    .setNegativeButton("Cancel", null)
                    .show();
            })
        .show();
  }
  private boolean validIPv4(String ip) {
    String[] parts = ip.split("\\.", -1);
    if (parts.length != 4)
      return false;
    try {
      for (String p : parts)
        if (!p.matches("\\d{1,3}") || Integer.parseInt(p) > 255)
          return false;
      return true;
    } catch (Exception e) {
      return false;
    }
  }
  @Override
  public void onBackPressed() {
    if (web.canGoBack())
      web.goBack();
    else
      super.onBackPressed();
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
