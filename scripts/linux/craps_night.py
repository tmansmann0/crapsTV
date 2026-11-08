#!/usr/bin/env python3
"""Home Assistant's craps-night toggle owns only its game/browser processes."""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import re
import signal
import subprocess
import urllib.request
from urllib.parse import urlparse


class Night:
    def __init__(self, config: dict):
        self.config = config
        self.root = Path(config["data_dir"]).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.mirror = self.root / "source.git"
        self.releases = self.root / "releases"
        self.releases.mkdir(exist_ok=True)
        self.current = self.root / "current"
        self.app = self.browser = None
        self.task = None
        self.desired = False
        self.lock = asyncio.Lock()
        self.entity = config.get("entity", "input_boolean.living_room_craps_night")
        self.env = {**os.environ, "DISPLAY": config.get("display", ":0"),
                    "XAUTHORITY": config.get("xauthority", "/etc/jmp-xauth"),
                    "XDG_RUNTIME_DIR": config.get("runtime_dir", "/run/user/1000")}
        self.env["PATH"] = str(Path(config["node"]).parent) + os.pathsep + self.env.get("PATH", "")
        self.status("off")

    def status(self, state: str, **extra):
        record = {"state": state, "entity": self.entity, **extra}
        temporary = self.root / "status.tmp"
        temporary.write_text(json.dumps(record, indent=2) + "\n")
        temporary.replace(self.root / "status.json")
        logging.info("craps night: %s", state)

    async def run(self, *args, cwd=None, capture=False, timeout=300):
        process = await asyncio.create_subprocess_exec(
            *map(str, args), cwd=cwd, env=self.env, start_new_session=True,
            stdout=asyncio.subprocess.PIPE if capture else None,
            stderr=asyncio.subprocess.PIPE if capture else None)
        try:
            out, err = await asyncio.wait_for(process.communicate(), timeout)
        except BaseException:
            await self.stop(process)
            raise
        if process.returncode:
            detail = (err or b"").decode(errors="replace").strip()[-500:]
            raise RuntimeError(f"{Path(str(args[0])).name} failed ({process.returncode}): {detail}")
        return (out or b"").decode().strip()

    @staticmethod
    async def stop(process):
        if process is None or process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), 5)
        except asyncio.TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()

    async def release(self):
        ref = await self.update_ref()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}", ref) or ".." in ref:
            raise ValueError("Invalid update ref")
        repository = self.config.get("repository", "https://github.com/tmansmann0/crapsTV.git")
        self.status("checking", ref=ref)
        try:
            if not self.mirror.exists():
                await self.run("git", "init", "--bare", self.mirror)
                await self.run("git", "--git-dir", self.mirror, "remote", "add", "origin", repository)
            remote = await self.run("git", "--git-dir", self.mirror, "remote", "get-url", "origin", capture=True)
            if remote != repository:
                raise RuntimeError("Dedicated update repository does not match configuration")
            await self.run("git", "--git-dir", self.mirror, "fetch", "--depth=1", "origin", ref, timeout=90)
            revision = await self.run("git", "--git-dir", self.mirror, "rev-parse", "FETCH_HEAD", capture=True)
            if not re.fullmatch(r"[a-f0-9]{40}", revision):
                raise RuntimeError("Invalid Git revision")
            release = self.releases / revision
            marker = release / ".crapstv-built"
            if not marker.exists():
                self.status("building", revision=revision, ref=ref)
                if release.exists():
                    await self.run("git", "--git-dir", self.mirror, "worktree", "remove", "--force", release)
                await self.run("git", "--git-dir", self.mirror, "worktree", "add", "--detach", release, revision)
                await self.run(self.config["npm"], "ci", "--no-audit", "--no-fund", cwd=release, timeout=300)
                await self.run(self.config["npm"], "run", "build", cwd=release, timeout=300)
                if not (release / "dist/index.html").is_file():
                    raise RuntimeError("Build produced no app")
                marker.write_text(revision + "\n")
            link = self.root / "current.new"
            link.unlink(missing_ok=True)
            link.symlink_to(release)
            link.replace(self.current)
            # Keep one prior complete release for offline/build-failure fallback.
            older = sorted((p for p in self.releases.iterdir() if (p / ".crapstv-built").is_file() and p != release),
                           key=lambda p: p.stat().st_mtime, reverse=True)
            for stale in older[1:]:
                await self.run("git", "--git-dir", self.mirror, "worktree", "remove", "--force", stale)
            return release
        except Exception:
            if (self.current / "dist/index.html").is_file():
                logging.exception("Update failed; using the last complete local release")
                return self.current.resolve()
            raise

    async def update_ref(self):
        """Track an explicit review, then promote to main even after branch deletion."""
        ref = self.config.get("ref", "main")
        review = self.config.get("preview_pr")
        if review is None:
            return ref
        if not isinstance(review, int) or isinstance(review, bool) or review < 1:
            raise ValueError("Invalid preview pull request")
        cache_path = self.root / "update-track.json"
        try:
            cached = json.loads(cache_path.read_text())
        except (OSError, ValueError):
            cached = {}
        if cached.get("merged"):
            return self.config.get("stable_ref", "main")
        repository = self.config.get("repository", "https://github.com/tmansmann0/crapsTV.git")
        parsed = urlparse(repository)
        slug = parsed.path.removesuffix(".git").strip("/")
        if parsed.hostname != "github.com" or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", slug):
            raise ValueError("Preview tracking requires a public GitHub repository")
        def read_review():
            request = urllib.request.Request(f"https://api.github.com/repos/{slug}/pulls/{review}",
                headers={"Accept": "application/vnd.github+json", "User-Agent": "crapsTV-night"})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        try:
            result = await asyncio.to_thread(read_review)
            merged = bool(result.get("merged_at"))
            ref = self.config.get("stable_ref", "main") if merged else f"refs/pull/{review}/head"
            cache_path.write_text(json.dumps({"ref": ref, "merged": merged}) + "\n")
            return ref
        except Exception:
            logging.warning("Could not check review status; using cached update track")
            return cached.get("ref", ref)

    async def xdo(self, *args, capture=False):
        return await self.run("xdotool", *args, capture=capture, timeout=4)

    async def windows(self, pattern):
        try:
            return (await self.xdo("search", "--onlyvisible", "--class", pattern, capture=True)).split()
        except RuntimeError:
            return []

    async def focus(self, window):
        # This TV's bare Xorg desktop has no _NET_ACTIVE_WINDOW implementation.
        await self.xdo("windowmap", window)
        await self.xdo("windowraise", window)
        await self.xdo("windowfocus", "--sync", window)

    async def restore_viewer(self):
        windows = await self.windows("jellyfin")
        if windows:
            try:
                await self.focus(windows[-1])
            except Exception:
                logging.warning("Jellyfin window could not be focused", exc_info=True)
        else:
            logging.warning("Jellyfin viewer window is not available")

    async def health(self, url):
        for _ in range(150):
            if self.app.returncode is not None:
                raise RuntimeError("The game server exited before it was ready")
            try:
                def read():
                    with urllib.request.urlopen(url + "api/config", timeout=2) as response:
                        return json.load(response)
                config = await asyncio.to_thread(read)
                if not config.get("kiosk"):
                    raise RuntimeError("This release does not support the TV kiosk flag yet")
                return config
            except RuntimeError:
                raise
            except Exception:
                await asyncio.sleep(0.2)
        raise RuntimeError("The game server did not become ready")

    async def start(self):
        if self.app and self.app.returncode is None and self.browser and self.browser.returncode is None:
            windows = await self.windows("crapstv-night")
            if windows:
                await self.focus(windows[-1])
            return
        await self.stop(self.browser)
        await self.stop(self.app)
        release = await self.release()
        port = int(self.config.get("port", 3000))
        url = f"http://127.0.0.1:{port}/"
        app_env = {**self.env, "PORT": str(port), "CRAPSTV_KIOSK": "1",
                   "CRAPSTV_HOSTNAME": self.config.get("hostname", "crapstv-tv")}
        self.status("starting", revision=release.name)
        self.app = await asyncio.create_subprocess_exec(
            self.config["node"], "server/index.js", "--kiosk", cwd=release,
            env=app_env, start_new_session=True)
        config = await self.health(url)
        # Stop playback without terminating the existing viewer/service.
        viewer = await self.windows("jellyfin")
        if viewer:
            try:
                await self.xdo("key", "--window", viewer[-1], "--clearmodifiers", "x")
            except RuntimeError:
                logging.warning("Could not stop existing Jellyfin playback")
        profile = self.root / "browser-profile"
        args = [self.config["browser"], f"--user-data-dir={profile}", "--class=crapstv-night",
                "--kiosk", "--no-first-run", "--no-default-browser-check",
                "--disable-session-crashed-bubble", "--autoplay-policy=no-user-gesture-required",
                f"--app={url}?kiosk=1"]
        if self.config.get("debug_port"):
            args += [f"--remote-debugging-port={int(self.config['debug_port'])}", "--remote-debugging-address=127.0.0.1"]
        args += self.config.get("browser_args", [])
        self.browser = await asyncio.create_subprocess_exec(*args, env=self.env, start_new_session=True)
        for _ in range(100):
            if self.browser.returncode is not None:
                raise RuntimeError("Fullscreen browser exited before its window appeared")
            windows = await self.windows("crapstv-night")
            if windows:
                await self.xdo("windowmove", windows[-1], "0", "0")
                await self.xdo("windowsize", windows[-1], "100%", "100%")
                await self.focus(windows[-1])
                self.status("on", revision=release.name, url=config.get("localOrigin", url),
                            room=config.get("code"), browser_pid=self.browser.pid)
                return
            await asyncio.sleep(0.2)
        raise RuntimeError("Fullscreen browser window did not appear")

    async def off(self):
        await self.stop(self.browser)
        await self.stop(self.app)
        self.browser = self.app = None
        await self.restore_viewer()
        self.status("off")

    async def transition(self, desired):
        async with self.lock:
            try:
                if desired:
                    await self.start()
                else:
                    await self.off()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logging.exception("craps night transition failed")
                await self.off()
                self.status("error", error=str(error))
                await self.ha_service("input_boolean", "turn_off", {"entity_id": self.entity})

    async def set_on(self, desired):
        if desired == self.desired and self.task and not self.task.done():
            return
        if desired == self.desired and self.task and self.task.done() and self.app and self.app.returncode is None:
            return
        self.desired = desired
        if self.task and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        self.task = asyncio.create_task(self.transition(desired))

    def credentials(self):
        settings = json.loads(Path(self.config.get("ha_config", "/var/lib/hyperion-room-bridge/config.json")).read_text())["home_assistant"]
        return settings["base_url"].rstrip("/"), Path(settings["token_file"]).read_text().strip()

    async def ha_service(self, domain, service, data):
        def call():
            base, token = self.credentials()
            request = urllib.request.Request(base + f"/api/services/{domain}/{service}",
                data=json.dumps(data).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=8) as response:
                response.read()
        try:
            await asyncio.to_thread(call)
        except Exception:
            logging.exception("Could not report launcher failure to Home Assistant")

    async def watch(self):
        import websockets
        while True:
            try:
                base, token = self.credentials()
                endpoint = base.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/api/websocket"
                async with websockets.connect(endpoint, ping_interval=20, ping_timeout=20) as socket:
                    await socket.recv()
                    await socket.send(json.dumps({"type": "auth", "access_token": token}))
                    if json.loads(await socket.recv()).get("type") != "auth_ok":
                        raise RuntimeError("Home Assistant rejected authentication")
                    await socket.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
                    await socket.send(json.dumps({"id": 2, "type": "get_states"}))
                    logging.info("Connected to Home Assistant craps-night helper")
                    async for raw in socket:
                        message = json.loads(raw)
                        if message.get("id") == 2 and message.get("success"):
                            entity = next((state for state in message["result"] if state["entity_id"] == self.entity), None)
                            if not entity:
                                logging.warning("Craps-night helper has not been created yet")
                            else:
                                await self.set_on(entity["state"] == "on")
                        event = message.get("event", {}).get("data", {})
                        if event.get("entity_id") == self.entity and (event.get("new_state") or {}).get("state") in {"on", "off"}:
                            await self.set_on(event["new_state"]["state"] == "on")
            except asyncio.CancelledError:
                raise
            except Exception:
                logging.exception("Home Assistant connection interrupted; retrying")
                await asyncio.sleep(5)

    async def monitor(self):
        while True:
            await asyncio.sleep(3)
            if self.desired and self.task and self.task.done() and (
                self.app is None or self.app.returncode is not None or
                self.browser is None or self.browser.returncode is not None
            ):
                logging.error("An owned game/browser process exited")
                await self.set_on(False)
                await self.ha_service("input_boolean", "turn_off", {"entity_id": self.entity})

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        await self.off()


async def main(config_path):
    night = Night(json.loads(Path(config_path).expanduser().read_text()))
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    watcher = asyncio.create_task(night.watch())
    monitor = asyncio.create_task(night.monitor())
    try:
        await stop.wait()
    finally:
        watcher.cancel()
        monitor.cancel()
        await asyncio.gather(watcher, monitor, return_exceptions=True)
        await night.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    options = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(main(options.config))
