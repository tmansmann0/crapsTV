# Android offline host (preview)

This Android-specific layer is stacked on `codex/shooter-turn-enforcement` (PR #4,
`4fae95c4727728f04bac00945cff1ad661098c22`), which already contains PR #3.
It embeds the existing RoomHub, Express and WebSocket authority, production game
assets, and Node.js Mobile 18.20.4. The normal Node 22 desktop server, online
transport and guest browser application are unchanged. No accounts or internet
are needed during local play. Chips are fictional.

## Pairing

1. Install the signed preview APK on the Android host. Open **crapsTV Offline**.
2. Tap **Host on my own Wi-Fi**. Grant Android's Nearby Wi-Fi permission
   (Android 13+) or Location permission (Android 8–12). On Android 8–12,
   Android also requires Location services enabled. A grant continues the
   chosen action automatically. Nothing creates a hotspot merely because
   internet is absent; the control remains available with cellular data on.
3. Open **Settings → Network Setup / Wi-Fi QR**. Guests scan that Wi-Fi QR, or
   join the displayed network/password manually. Accept **stay connected** if
   their phone warns that the network has no internet.
4. Return to **Host**. Guests scan the single, generously sized **game QR**.
   Tap it for a full-screen version; Android Back returns. Guests use their
   normal browsers, enter names, and the first player opens the table.
5. **Table** shows the TV-style view on the host. The native Host and Settings
   controls remain accessible. The hosting notification keeps the foreground
   service visible; **Settings → Stop session** or the notification's Stop
   action disconnects everyone and ends the in-memory room.

If Android rejects local-only Wi-Fi, use **Settings → Android hotspot settings**
to enable an ordinary phone hotspot, then return. Connect guest phones to that
network first and use the game QR. Some manufacturers isolate hotspot clients;
the guests must be able to reach the host. If automatic address selection fails,
**Settings → Choose host IP address** accepts the IPv4 address shown by Android.
No fixed hotspot IP is assumed. Avoid VPNs and confirm the displayed IP belongs
to the hotspot, rather than cellular service. Ordinary hotspots may share mobile
data; turn mobile data off if you want to ensure no internet is supplied.

## Build

Use Node 22+, JDK 17 or 21, Gradle 8.13 (wrapper included), and the official
Android SDK with `platforms;android-35`, `build-tools;35.0.0`, and
`ndk;27.2.12479018`. Set `ANDROID_HOME` to the SDK directory. On Linux/macOS:

```sh
npm ci
npm test
npm run build
node android/prepare.mjs
node --test android/host.test.mjs
cd android
./gradlew :app:assembleRelease
```

The preparation script downloads the pinned Node.js Mobile release, validates
its SHA-256, compiles a small JNI adapter with the official NDK, bundles the
server for Node 18, and packages local assets and exact source revision metadata.
The result is unsigned: `app/build/outputs/apk/release/app-release-unsigned.apk`.
Use Android `zipalign`, a private local keystore, and `apksigner sign`, then
`apksigner verify --verbose --print-certs`. Do not commit a keystore, password,
APK, native library, or downloaded SDK/runtime. Node's distribution license is
included; the preparation script adds dependency notices to the payload.

For browser smoke tests, start the prepared `android/host.cjs` with a root that
contains `dist`, `host.html`, and a local `network.json`, then run
`node android/browser-check.mjs`. `CHROME_PATH` can select installed Chromium.
The included smoke fixture expects SSID `TEST-OFFLINE`, port 3000, and a fresh room.
The transport test launches its own isolated room and can also run under the
upstream Node 18.20.4 Linux runtime to check embedded-runtime compatibility.

## Device and lifecycle limits

- Minimum Android 8 (API 26). Native ABIs: arm64-v8a, armeabi-v7a, x86_64.
  These are build targets, not a device-compatibility certification.
- Node.js Mobile's available prebuilt runtime is older than the desktop engine.
  Its libnode has 4 KiB ELF alignment. **16 KiB-page devices are not supported
  by this preview** unless the OS offers a working compatibility mode; do not
  assume it. A future supported release needs a current, rebuilt mobile runtime.
- An up-to-date Android System WebView/browser is needed for the modern game.
  The APK cannot update a stale WebView while offline.
- The foreground connected-device service owns the hotspot reservation, server,
  Wi-Fi and partial wake locks. Activity rotation/navigation does not own them.
  Stop releases them and terminates the process because Node Mobile cannot be
  restarted in the same process. Android/OEM process termination, reboot, or
  force-stop ends the room; there is no automatic restart or persisted session.
- Local-only hotspot creation, hardware/OEM behavior, iPhone/Android Wi-Fi QR
  recognition, background survival and genuinely disconnected multi-device
  play require tests on the actual host and guest devices. Browser tests on one
  workstation do not establish these behaviors.
- No captive portal is provided. The public local-only hotspot API supplies
  an OS-managed network but no supported custom DHCP/DNS captive-portal
  advertisement. An HTTP server alone cannot reliably trigger Android/iPhone
  captive assistants. The Wi-Fi QR followed by the game QR is the supported flow.
  No traffic interception, privileged networking, or OS network modification is used.

Official references: [Android local-only hotspot](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot),
[connected-device foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device),
[Node.js Mobile Android embedding](https://nodejs-mobile.github.io/docs/guide/guide-android/getting-started/),
[Node.js Mobile runtime release](https://github.com/nodejs-mobile/nodejs-mobile/releases/tag/v18.20.4).
