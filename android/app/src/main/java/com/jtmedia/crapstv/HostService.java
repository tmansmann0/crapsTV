package com.jtmedia.crapstv;

import android.app.*;
import android.content.*;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.*;
import android.os.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;
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
  private boolean started, requesting, systemHotspot;
  private Set<String> beforeHotspot = Collections.emptySet();
  private String mode = "lan", ssid = "", password = "", message = "";
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
          report("The host stopped. End the session and reopen CrapsTV to restart.");
          android.util.Log.i("crapstv", "Host exited with code " + result);
        } catch (Exception e) {
          report("The local table could not start. End the session and reopen CrapsTV.");
          android.util.Log.e("crapstv", "Could not start the local table", e);
        }
      }, "crapstv-node").start();
    }
    if (intent != null) {
      String action = intent.getAction();
      if ("HOTSPOT".equals(action)) startHotspot();
      if ("USE_SYSTEM_HOTSPOT".equals(action)) {
        systemHotspot = true;
        beforeHotspot = new HashSet<>(interfaceAddresses().keySet());
        getSharedPreferences("host", 0).edit().remove("ip").apply();
        message = "Turn on your Android hotspot, then connect guests to it.";
        writeStatus();
      }
      if ("USE_LAN".equals(action)) {
        systemHotspot = false;
        getSharedPreferences("host", 0).edit().remove("ip").apply();
        message = "";
        writeStatus();
      }
    }
    return START_NOT_STICKY;
  }
  private void report(String status) {
    handler.post(() -> {
      message = status;
      writeStatus();
    });
  }
  private void extract() throws Exception {
    root.mkdirs();
    File marker = new File(root, ".payload-version");
    String version = Long.toString(
        getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime);
    if (marker.isFile() && new File(root, "host.cjs").isFile() &&
        new File(root, "dist/index.html").isFile() &&
        version.equals(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8)))
      return;
    Files.deleteIfExists(marker.toPath());
    // Replacing an APK can remove assets as well as add them.
    Path oldAssets = new File(root, "dist").toPath();
    if (Files.isDirectory(oldAssets)) {
      List<Path> obsolete = new ArrayList<>();
      try (Stream<Path> entries = Files.walk(oldAssets)) {
        entries.sorted(Comparator.reverseOrder()).forEach(obsolete::add);
      }
      for (Path entry : obsolete) Files.delete(entry);
    }
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
    Files.write(marker.toPath(), version.getBytes(StandardCharsets.UTF_8));
  }
  private void startHotspot() {
    if (hotspot != null || requesting)
      return;
    systemHotspot = false;
    beforeHotspot = new HashSet<>(interfaceAddresses().keySet());
    getSharedPreferences("host", 0).edit().remove("ip").apply();
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
              switch (reason) {
                case ERROR_INCOMPATIBLE_MODE:
                  message = "Android is already using Wi-Fi for tethering. Use that hotspot, or turn it off and retry.";
                  break;
                case ERROR_TETHERING_DISALLOWED:
                  message = "This device doesn’t allow offline Wi-Fi. Use an existing shared network.";
                  break;
                case ERROR_NO_CHANNEL:
                  message = "Android couldn’t find a Wi-Fi channel. Try again or use an existing network.";
                  break;
                default:
                  message = "Android couldn’t create offline Wi-Fi. Try again or use your phone’s hotspot.";
              }
              writeStatus();
            }
          }, handler);
    } catch (Exception e) {
      requesting = false;
      message = "Android couldn’t create offline Wi-Fi. Check Wi-Fi permissions or use an existing network.";
      android.util.Log.w("crapstv", "Offline Wi-Fi request failed", e);
      writeStatus();
    }
  }
  private static boolean lanAddress(InetAddress address) {
    return address instanceof Inet4Address && !address.isLoopbackAddress()
        && !address.isLinkLocalAddress() && !address.isAnyLocalAddress();
  }
  private static boolean accessPoint(String name) {
    return name.startsWith("ap") || name.startsWith("softap") || name.startsWith("swlan");
  }
  private Map<String, String> interfaceAddresses() {
    Map<String, String> addresses = new TreeMap<>();
    try {
      for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!ni.isUp() || ni.isLoopback())
          continue;
        String name = ni.getName();
        if (!(accessPoint(name) || name.startsWith("wlan")
                || name.startsWith("wifi") || name.startsWith("eth")))
          continue;
        for (InetAddress a : Collections.list(ni.getInetAddresses()))
          if (lanAddress(a)) addresses.put(a.getHostAddress(), name);
      }
    } catch (SocketException e) {
      android.util.Log.w("crapstv", "Could not read Wi-Fi addresses", e);
    }
    return addresses;
  }
  private Set<String> connectedLanAddresses() {
    Set<String> addresses = new LinkedHashSet<>();
    ConnectivityManager manager = getSystemService(ConnectivityManager.class);
    Network active = manager.getActiveNetwork();
    List<Network> networks = new ArrayList<>();
    if (active != null) networks.add(active);
    networks.addAll(Arrays.asList(manager.getAllNetworks()));
    for (Network network : networks) {
      NetworkCapabilities caps = manager.getNetworkCapabilities(network);
      if (caps == null || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
          || !(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)))
        continue;
      LinkProperties links = manager.getLinkProperties(network);
      if (links != null) links.getLinkAddresses().forEach(link -> {
        InetAddress address = link.getAddress();
        if (lanAddress(address)) addresses.add(address.getHostAddress());
      });
    }
    return addresses;
  }
  private String preferredAddress(Map<String, String> interfaces, Set<String> lan) {
    if (requesting) return "";
    if (hotspot != null || systemHotspot) {
      for (Map.Entry<String, String> entry : interfaces.entrySet())
        if (accessPoint(entry.getValue()) && !lan.contains(entry.getKey()))
          return entry.getKey();
      for (String ip : interfaces.keySet())
        if (!beforeHotspot.contains(ip) && !lan.contains(ip)) return ip;
      return "";
    }
    if (!lan.isEmpty()) return lan.iterator().next();
    for (Map.Entry<String, String> entry : interfaces.entrySet())
      if (accessPoint(entry.getValue())) return entry.getKey();
    return interfaces.keySet().stream().findFirst().orElse("");
  }
  private synchronized void writeStatus() {
    try {
      Map<String, String> interfaces = interfaceAddresses();
      Set<String> lan = connectedLanAddresses();
      Set<String> addresses = new LinkedHashSet<>(lan);
      addresses.addAll(interfaces.keySet());
      String preferred = preferredAddress(interfaces, lan);
      String override = getSharedPreferences("host", 0).getString("ip", "");
      if (!requesting && addresses.contains(override))
        preferred = override;
      JSONObject s = new JSONObject();
      s.put("mode", requesting ? "starting" : systemHotspot ? "system-hotspot" : mode);
      s.put("ssid", ssid);
      s.put("password", password);
      s.put("ip", preferred);
      s.put("addresses", new JSONArray(addresses));
      s.put("override", addresses.contains(override) ? override : "");
      s.put("message", systemHotspot && !preferred.isEmpty() ?
            "Guests join your Android hotspot, then scan the game QR." : message);
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
