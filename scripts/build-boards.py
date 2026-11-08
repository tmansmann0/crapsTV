#!/usr/bin/env python3
"""Author the original Claude/Codex vector board family and portable textures.

Node, Playwright Chromium and Poppler's pdftocairo are the authoring tools.
Editable text masters and outlined production SVGs are both retained. No font
binaries are copied. PNG rerasterization has no Mac-font dependency.
"""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
subprocess.run(["node", "scripts/build-board-vectors.mjs", *sys.argv[1:]], cwd=ROOT, check=True)
