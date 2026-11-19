package com.jtmedia.crapstv;

import android.app.*;
import android.content.*;
import android.net.wifi.*;
import android.os.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import org.json.*;

public class HostService extends Service {
  static {
    System.loadLibrary("node");
    System.loadLibrary("crapstv-host");
  }
  private static native int startNode(String script, String root);
  private WifiManager.LocalOnlyHotspotReservation hotspot;
  private WifiManager.WifiLock wifiLock;
  private PowerManager.WakeLock wakeLock;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private File root;
  private boolean started, requesting;
  private String mode = "lan", ssid = "", password = "", message = "Local host is starting.";
  private final Runnable refresh = new Runnable() {
    public void run() {
      writeStatus();
      handler.postDelayed(this, 2000);
    }
  };
  @Override
  public void onCreate() {
    super.onCreate();
    root = new File(getFilesDir(), "session-v1");
    NotificationManager nm = getSystemService(NotificationManager.class);
    nm.createNotificationChannel(new NotificationChannel(
        "hosting", "Local game hosting", NotificationManager.IMPORTANCE_LOW));
    PendingIntent open = PendingIntent.getActivity(
        this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    PendingIntent stop = PendingIntent.getService(this, 1,
        new Intent(this, HostService.class).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE);
    Notification n =
        new Notification.Builder(this, "hosting")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentTitle("crapsTV local host")
            .setContentText("Keep this host running for guests. Stop ends the room.")
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Stop session", stop).build())
            .build();
    startForeground(1, n);
    wakeLock = getSystemService(PowerManager.class)
                   .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "crapstv:host");
    wakeLock.acquire();
    wifiLock = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE))
                   .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "crapstv:host");
    wifiLock.acquire();
    handler.post(refresh);
  }
  @Override
  public int onStartCommand(Intent intent, int flags, int id) {
    if (intent != null && "STOP".equals(intent.getAction())) {
      endSession();
      return START_NOT_STICKY;
    }
    if (!started) {
      started = true;
      new Thread(() -> {
        try {
          extract();
          writeStatus();
          int result =
              startNode(new File(root, "host.cjs").getAbsolutePath(), root.getAbsolutePath());
          message = "Host exited (" + result + "). Stop and reopen to restart.";
          writeStatus();
        } catch (Exception e) {
          message = "Host could not start: " + e.getMessage();
          writeStatus();
        }
      }, "crapstv-node").start();
    }
    if (intent != null && "HOTSPOT".equals(intent.getAction()))
      startHotspot();
    return START_NOT_STICKY;
  }
  private void extract() throws IOException {
    root.mkdirs();
    // Installed app updates replace the payload; room and credentials are never shipped in it.
    try (ZipInputStream zip = new ZipInputStream(getAssets().open("payload.zip"))) {
      ZipEntry entry;
      byte[] buffer = new byte[65536];
      while ((entry = zip.getNextEntry()) != null) {
        File dest = new File(root, entry.getName());
        if (!dest.getCanonicalPath().startsWith(root.getCanonicalPath() + File.separator))
          throw new IOException("Invalid asset path");
        if (entry.isDirectory()) {
          dest.mkdirs();
          continue;
        }
        dest.getParentFile().mkdirs();
        try (OutputStream out = new FileOutputStream(dest)) {
          int count;
          while ((count = zip.read(buffer)) > 0) out.write(buffer, 0, count);
        }
      }
    }
  }
  private void startHotspot() {
    if (hotspot != null || requesting)
      return;
    requesting = true;
    message = "Starting offline Wi-Fi…";
    writeStatus();
    try {
      ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE))
          .startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
            @Override
            public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation) {
              requesting = false;
              hotspot = reservation;
              mode = "local-only";
              if (Build.VERSION.SDK_INT >= 30) {
                SoftApConfiguration c = reservation.getSoftApConfiguration();
                ssid = c.getSsid();
                password = c.getPassphrase();
              } else {
                WifiConfiguration c = reservation.getWifiConfiguration();
                ssid = c.SSID;
                password = c.preSharedKey;
              }
              message =
                  "Offline Wi-Fi active. Guests join this network first, then scan the game QR.";
              writeStatus();
            }
            @Override
            public void onStopped() {
              requesting = false;
              hotspot = null;
              mode = "lan";
              ssid = "";
              password = "";
              message = "Offline Wi-Fi stopped. Start it again, or use an ordinary hotspot.";
              writeStatus();
            }
            @Override
            public void onFailed(int reason) {
              requesting = false;
              message = "Android could not start offline Wi-Fi (code " + reason
                  + "). Try again, or enable an ordinary phone hotspot in Settings.";
              writeStatus();
            }
          }, handler);
    } catch (Exception e) {
      requesting = false;
      message = "Offline Wi-Fi unavailable: " + e.getMessage()
          + ". Check permissions and Location on Android 8–12, or use an ordinary hotspot.";
      writeStatus();
    }
  }
  private synchronized void writeStatus() {
    try {
      List<String> addresses = new ArrayList<>();
      String preferred = "";
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback())
          continue;
        for (InetAddress a : Collections.list(ni.getInetAddresses()))
          if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
            String ip = a.getHostAddress();
            addresses.add(ip);
            String name = ni.getName();
            if (name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("ap")
                || name.startsWith("swlan"))
              preferred = ip;
          }
      }
      String override = getSharedPreferences("host", 0).getString("ip", "");
      if (!override.isEmpty())
        preferred = override;
      JSONObject s = new JSONObject();
      s.put("mode", mode);
      s.put("ssid", ssid);
      s.put("password", password);
      s.put("ip", preferred);
      s.put("addresses", new JSONArray(addresses));
      s.put("message", message);
      root.mkdirs();
      File temp = new File(root, "network.json.tmp");
      try (FileWriter writer = new FileWriter(temp)) {
        writer.write(s.toString());
      }
      Files.move(temp.toPath(), new File(root, "network.json").toPath(),
          StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } catch (Exception e) {
      android.util.Log.w("crapstv", "Network address unavailable", e);
    }
  }
  private void endSession() {
    cleanup();
    stopForeground(STOP_FOREGROUND_REMOVE);
    stopSelf();
    android.os.Process.killProcess(android.os.Process.myPid());
  }
  private void cleanup() {
    handler.removeCallbacksAndMessages(null);
    if (hotspot != null) {
      hotspot.close();
      hotspot = null;
    }
    if (wifiLock != null && wifiLock.isHeld())
      wifiLock.release();
    if (wakeLock != null && wakeLock.isHeld())
      wakeLock.release();
    if (root != null)
      new File(root, "network.json").delete();
  }
  @Override
  public void onDestroy() {
    cleanup();
    super.onDestroy();
    android.os.Process.killProcess(android.os.Process.myPid());
  }
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
