package com.jtmedia.crapstv;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.net.*;

public class MainActivity extends Activity {
  private static final String HOST = "http://127.0.0.1:3000";
  private WebView web;
  private TextView loading;
  private Button retry;
  private boolean hostReady;
  private boolean pendingHotspot;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private String wanted = "/android-host";
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    wanted = state == null ? "/android-host" : state.getString("view", "/android-host");
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackgroundColor(0xff0b1d17);
    layout.setOnApplyWindowInsetsListener((view, insets) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets safe = insets.getInsets(
            WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
      } else {
        view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
      }
      return insets;
    });
    LinearLayout bar = new LinearLayout(this);
    bar.setBackgroundColor(0xff142b21);
    button(bar, "Pair", () -> navigate("/android-host"));
    button(bar, "Table", () -> navigate("/"));
    button(bar, "Settings", this::settings);
    layout.addView(bar);
    loading = new TextView(this);
    loading.setTextSize(18);
    loading.setGravity(Gravity.CENTER);
    loading.setText("Starting the local table…");
    layout.addView(loading, new LinearLayout.LayoutParams(-1, 0, 1));
    retry = new Button(this);
    retry.setText("Check again");
    retry.setVisibility(View.GONE);
    retry.setOnClickListener(v -> {
      retry.setVisibility(View.GONE);
      loading.setText("Checking the local table…");
      waitForHost(0);
    });
    layout.addView(retry);
    web = new WebView(this);
    web.setVisibility(View.GONE);
    web.setBackgroundColor(0xff0b1d17);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
        if (url.startsWith(HOST + "/")) wanted = url.substring(HOST.length());
        boolean full = url.startsWith(HOST + "/android-qr");
        bar.setVisibility(full ? View.GONE : View.VISIBLE);
        if (full)
          getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        else
          getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
      }
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String current = view.getUrl();
        if (request.isForMainFrame() && "crapstv".equals(u.getScheme())
            && "host".equals(u.getHost()) && current != null
            && (current.startsWith(HOST + "/android-network")
                || current.startsWith(HOST + "/android-host"))) {
          switch (u.getPath() == null ? "" : u.getPath()) {
            case "/offline":
              chooseHotspot();
              break;
            case "/wifi":
              openNetworkSettings(false);
              break;
            case "/hotspot":
              openNetworkSettings(true);
              break;
          }
          return true;
        }
        return !("http".equals(u.getScheme()) && "127.0.0.1".equals(u.getHost())
            && u.getPort() == 3000);
      }
    });
    layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
    layout.requestApplyInsets();
    startForegroundService(new Intent(this, HostService.class));
    pendingHotspot = state != null && state.getBoolean("pendingHotspot", false);
    waitForHost(0);
  }
  private void button(LinearLayout bar, String text, Runnable action) {
    Button b = new Button(this);
    b.setText(text);
    b.setAllCaps(false);
    b.setOnClickListener(v -> action.run());
    bar.addView(b, new LinearLayout.LayoutParams(0, -2, 1));
  }
  private void waitForHost(int attempt) {
    new Thread(() -> {
      boolean ready = false;
      try {
        HttpURLConnection c =
            (HttpURLConnection) new URL(HOST + "/api/config").openConnection();
        c.setConnectTimeout(700);
        c.setReadTimeout(700);
        ready = c.getResponseCode() == 200;
        c.disconnect();
      } catch (Exception ignored) {
      }
      final boolean ok = ready;
      handler.post(() -> {
        if (isFinishing() || isDestroyed())
          return;
        if (ok) {
          hostReady = true;
          loading.setVisibility(View.GONE);
          retry.setVisibility(View.GONE);
          web.setVisibility(View.VISIBLE);
          navigate(wanted);
        } else if (attempt < 60)
          handler.postDelayed(() -> waitForHost(attempt + 1), 1000);
        else {
          loading.setText("The local table hasn’t started. Check again, or use Settings to stop and reopen.");
          retry.setVisibility(View.VISIBLE);
        }
      });
    }).start();
  }
  private void navigate(String path) {
    wanted = path;
    if (hostReady) web.loadUrl(HOST + path);
  }
  private void openNetworkSettings(boolean hotspot) {
    startForegroundService(new Intent(this, HostService.class)
        .setAction(hotspot ? "USE_SYSTEM_HOTSPOT" : "USE_LAN"));
    navigate("/android-network");
    try {
      startActivity(new Intent(hotspot ? "android.settings.TETHER_SETTINGS" : Settings.ACTION_WIFI_SETTINGS));
    } catch (ActivityNotFoundException e) {
      startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
    }
  }
  private boolean locationEnabled() {
    if (Build.VERSION.SDK_INT >= 28) return getSystemService(LocationManager.class).isLocationEnabled();
    return Settings.Secure.getInt(getContentResolver(), Settings.Secure.LOCATION_MODE, 0) != 0;
  }
  private void chooseHotspot() {
    String permission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.NEARBY_WIFI_DEVICES
                                                    : Manifest.permission.ACCESS_FINE_LOCATION;
    if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
      pendingHotspot = false;
      if (Build.VERSION.SDK_INT <= 32 && !locationEnabled()) {
        new AlertDialog.Builder(this)
            .setTitle("Turn on Location")
            .setMessage("This Android version requires Location to create offline Wi-Fi. Turn it on, then tap Create offline Wi-Fi again.")
            .setPositiveButton("Open settings", (d, w) ->
                startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)))
            .setNegativeButton("Use another network", null)
            .show();
        return;
      }
      startForegroundService(new Intent(this, HostService.class).setAction("HOTSPOT"));
      navigate("/android-network");
      return;
    }
    pendingHotspot = true;
    requestPermissions(Build.VERSION.SDK_INT >= 33 ? new String[] {permission}
        : new String[] {Manifest.permission.ACCESS_COARSE_LOCATION, permission}, 41);
  }
  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request != 41)
      return;
    String permission = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.NEARBY_WIFI_DEVICES
                                                    : Manifest.permission.ACCESS_FINE_LOCATION;
    if (pendingHotspot && checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
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
        .setItems(new String[] {"Wi-Fi setup", "Choose host IP address", "Stop session"},
            (d, which) -> {
              if (which == 0)
                navigate("/android-network");
              if (which == 1) {
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
              if (which == 2)
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
    state.putString("view", wanted);
    super.onSaveInstanceState(state);
  }
  @Override
  public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    web.destroy();
    super.onDestroy();
  }
}
