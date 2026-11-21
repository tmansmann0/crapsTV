# CrapsTV for Android (offline host preview)

Run the table on an Android phone or tablet. Players join in their phone browsers
using the same Wi-Fi or hotspot. The APK bundles the game, audio, and room server.
No account or internet connection is needed on the host or the guest devices.

## Start a table

Open **CrapsTV Offline** to see the full-screen table. Open the gear for
**Pair players** and **Wi-Fi & hosting**. Closing either panel returns to the
same table.

- **Shared Wi-Fi** — Connect all devices to the same network. Open
  **Settings → Pair players** and have players scan the game QR. The manual link
  section also gives you a TV display address for another screen.
- **No shared Wi-Fi** — The app opens network setup. Choose **Create offline Wi-Fi**. Android
  13 and newer use the **Nearby devices** permission. Android 8–12 use precise
  Location permission and require Location to be on. Scan the Wi-Fi QR from the
  guest phones first, then tap **Show game QR**. If a guest phone says the network
  has no internet, choose **Stay connected**.
- **Android hotspot** — If the device cannot create offline Wi-Fi, choose **Use
  Android hotspot** under **Other ways to connect**. Turn it on, have guests
  join it, then return for the game QR. An ordinary hotspot can share mobile data
  if it’s enabled.

Players enter names and the first player opens the table. Use **Settings →
Wi-Fi & hosting → Stop hosting** when finished. Wi-Fi credentials are served only to the host’s pairing
screen over the device’s loopback connection.

If a guest cannot load the link, check that both devices are on the same network.
Some guest networks isolate devices. Try the host’s offline Wi-Fi or a different
shared network. **Settings → Wi-Fi & hosting → Host address** can override the detected
IPv4 address when Android exposes more than one interface. Leave it blank to
detect automatically.

## Build an APK

The [Android workflow](../.github/workflows/android.yml) publishes an installable
debug APK as a GitHub Actions artifact. A debug APK signed by another build
machine may require removing a previous debug installation first.

For a local build, use Node 22+, JDK 17 or 21, and the official SDK with
`platforms;android-35`, `build-tools;35.0.0`, and `ndk;27.2.12479018`. Set
`ANDROID_HOME` to the SDK directory. Run from the repository root on Linux or macOS:

```sh
npm ci
npm run build
node android/prepare.mjs
node --test android/host.test.mjs
./android/gradlew -p android :app:assembleDebug
```

The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.
Use `:app:assembleRelease` for the unsigned release APK. Sign it with your own
keystore and verify it with `apksigner verify --verbose`. Keep signing keys out of
Git.

The preparation script verifies the checksum of the pinned Node.js Mobile
18.20.4 distribution, builds the JNI adapter, and packages the game assets and
dependency notices. To test the server and pairing in Chromium without the SDK:

```sh
npm run build
node android/prepare.mjs --server-only
node --test android/host.test.mjs
npx playwright install chromium
node android/browser-check.mjs
```

## Device support and lifecycle

- Minimum Android 8 (API 26). Build ABIs are arm64-v8a, armeabi-v7a, and x86_64.
  The guest browser and the host’s WebView need to support the current web game.
- The packaged upstream Node runtime uses 4 KiB ELF alignment. A native build
  for 16 KiB-page devices needs a rebuilt runtime. Compatibility mode on some
  devices can differ.
- The foreground service keeps the table and offline Wi-Fi running while the
  activity is in the background. Stopping the service, force-stopping the app,
  rebooting, or Android reclaiming the process ends the in-memory room.
- Scan the two QR codes in order when using offline Wi-Fi. Android’s public
  local-only hotspot API supplies the Wi-Fi network. It does not provide a
  supported way for this app to advertise a captive portal to guests.
- The APK can be installed and exercised on an emulator. Wi-Fi radio behavior,
  phone-camera Wi-Fi QR recognition and hotspot reachability remain
  physical-device checks.

[Android’s local-only hotspot guide](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot)
· [Android 16 KiB compatibility](https://developer.android.com/guide/practices/page-sizes)
· [Node.js Mobile runtime](https://github.com/nodejs-mobile/nodejs-mobile/releases/tag/v18.20.4)
