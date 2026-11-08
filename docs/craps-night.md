# Living Room: craps night

The Home Assistant helper `input_boolean.living_room_craps_night` appears as
**craps night** in the Living Room dashboard. Its controller runs on the TV's
Linux machine as the desktop user.

On checks GitHub for the configured app ref, builds only a new revision, starts
the local server with `--kiosk`, opens a dedicated fullscreen Chrome/Chromium
window, then raises and focuses it. The TV settings button is hidden; phones
retain their admin controls. The browser uses one persistent profile, preserving
graphics calibration and preferences between nights.

Off closes only the controller's browser and server process groups, then raises
and focuses the existing Jellyfin viewer. Jellyfin's service stays running.
An interrupted start can be cancelled by switching Off. If updating/building
fails, the previous complete local release remains available. Two complete
release directories are retained; a failed build never replaces the current one.

## Installed Linux contract

- TV session: `collin`, display `:0`, `/etc/jmp-xauth`, 3840 × 2160.
- User service: `crapstv-night.service`; user lingering is enabled.
- Configuration: `~/.config/crapstv-night/config.json`.
- Launcher/data: `~/.local/share/crapstv-night/`.
- Persistent browser profile: `~/.local/share/crapstv-night/data/browser-profile`.
- Local state: `~/.local/share/crapstv-night/data/status.json`.
- Logs: `journalctl --user -u crapstv-night.service`.
- Default app ref is `main`; a review deployment can explicitly use
  `codex/craps-tv-bots-and-kiosk` until its kiosk support merges.
- HA credentials remain in the existing bridge configuration/token files and
  are never sent to the game or copied into its public repository.

The controller subscribes to HA's websocket and reconciles the helper on boot
and reconnect. It opens no extra listening API. It uses `windowraise` and
`windowfocus`, because the TV's minimal Xorg desktop has no window-manager
activation support.

## Install or maintain

Run `scripts/linux/install-craps-night.sh [github-ref]` as the TV user with
Node22/npm, Python `websockets`, `git`, `xdotool`, and a sandbox-capable
Chrome/Chromium already installed. Explicit runtime paths can be provided through
`CRAPSTV_NODE`, `CRAPSTV_NPM`, and `CRAPSTV_BROWSER`. Existing configuration is
retained on repeated installation. The optional `install-runtime.py` downloads
official Node22 (verifying its published SHA256) and Chrome-for-Testing for Linux
x86_64; Ubuntu's user-namespace policy may require its packaged Chrome instead.

The source flag also works independently:

```sh
npm start -- --kiosk
# or
CRAPSTV_KIOSK=1 npm start
```

The TV URL `?kiosk=1` enables the same presentation mode. This is a display
option, not an access-control boundary; the existing room/admin rules remain in
force. Server boot reports its mode in `/api/config`.

Launcher checks: `python3 scripts/linux/test_craps_night.py` verifies owned
process cleanup, cancellable start, unchanged-release build reuse, update-failure
fallback, and Jellyfin focus without stopping its service.

Runtime sources: [Node22 releases](https://nodejs.org/dist/latest-v22.x/) and
[Google Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing).
