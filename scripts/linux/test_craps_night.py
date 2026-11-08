#!/usr/bin/env python3
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import io
from craps_night import Night


class NightTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.night = Night({"data_dir": self.temporary.name, "node": "/runtime/bin/node", "npm": "/runtime/bin/npm", "browser": "/runtime/chrome"})

    async def test_stops_only_the_owned_process_group(self):
        command = [sys.executable, "-c", "import time;time.sleep(60)"]
        owned = await asyncio.create_subprocess_exec(*command, start_new_session=True)
        other = await asyncio.create_subprocess_exec(*command, start_new_session=True)
        try:
            await self.night.stop(owned)
            self.assertIsNotNone(owned.returncode)
            self.assertIsNone(other.returncode)
        finally:
            await self.night.stop(other)

    async def test_off_preserves_the_viewer_and_focuses_it_without_window_manager_activation(self):
        calls = []
        async def windows(pattern):
            calls.append(("search", pattern))
            return ["4194317"]
        async def xdo(*args, **kwargs):
            calls.append(args)
        self.night.windows, self.night.xdo = windows, xdo
        await self.night.off()
        self.assertIn(("windowraise", "4194317"), calls)
        self.assertIn(("windowfocus", "--sync", "4194317"), calls)
        self.assertNotIn("windowactivate", str(calls))
        self.assertNotIn("systemctl", str(calls))
        self.assertEqual(json.loads((self.night.root / "status.json").read_text())["state"], "off")

    async def test_turning_off_cancels_an_unfinished_start(self):
        starting, stopped = asyncio.Event(), asyncio.Event()
        async def start():
            starting.set()
            await asyncio.sleep(60)
        async def off():
            stopped.set()
        self.night.start, self.night.off = start, off
        await self.night.set_on(True)
        await starting.wait()
        await self.night.set_on(False)
        await self.night.task
        self.assertTrue(stopped.is_set())
        self.assertFalse(self.night.desired)

    async def test_reuses_a_complete_build_but_checks_github_on_every_new_start(self):
        revision = "a" * 40
        calls = []
        async def run(*args, cwd=None, **kwargs):
            args = list(map(str, args)); calls.append(args)
            if args[:3] == ["git", "init", "--bare"]:
                Path(args[-1]).mkdir()
            if "get-url" in args:
                return "https://github.com/tmansmann0/crapsTV.git"
            if "rev-parse" in args:
                return revision
            if "worktree" in args and "add" in args:
                Path(args[-2]).mkdir()
            if args[:3] == ["/runtime/bin/npm", "run", "build"]:
                (cwd / "dist").mkdir(); (cwd / "dist/index.html").write_text("app")
            return ""
        self.night.run = run
        first = await self.night.release()
        second = await self.night.release()
        self.assertEqual(first, second)
        self.assertEqual(sum("fetch" in command for command in calls), 2)
        self.assertEqual(sum("ci" in command for command in calls), 1)
        self.assertEqual(self.night.current.resolve(), first)
        async def fail(*args, **kwargs):
            if "get-url" in args:
                return "https://github.com/tmansmann0/crapsTV.git"
            raise RuntimeError("offline")
        self.night.run = fail
        with self.assertLogs(level="ERROR"):
            self.assertEqual(await self.night.release(), first)

    async def test_invalid_refs_never_become_git_options(self):
        self.night.config["ref"] = "--upload-pack=unwanted"
        with self.assertRaises(ValueError):
            await self.night.release()

    async def test_review_tracking_promotes_to_main_after_merge_and_survives_deleted_branch(self):
        self.night.config.update({"preview_pr": 2, "ref": "codex/review", "stable_ref": "main"})
        with patch("urllib.request.urlopen", return_value=io.BytesIO(b'{"merged_at":null}')):
            self.assertEqual(await self.night.update_ref(), "refs/pull/2/head")
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            with self.assertLogs(level="WARNING"):
                self.assertEqual(await self.night.update_ref(), "refs/pull/2/head")
        with patch("urllib.request.urlopen", return_value=io.BytesIO(b'{"merged_at":"2026-11-08T18:00:00Z"}')):
            self.assertEqual(await self.night.update_ref(), "main")
        with patch("urllib.request.urlopen", side_effect=AssertionError("Merged reviews do not need querying")):
            self.assertEqual(await self.night.update_ref(), "main")


if __name__ == "__main__":
    unittest.main()
