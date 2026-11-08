#!/usr/bin/env python3
"""Install official, user-owned Node 22 and Chrome-for-Testing on Linux x86_64."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import tarfile
import urllib.request
import zipfile


def get(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()


def main(prefix):
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise SystemExit("This optional TV runtime installer supports Linux x86_64 only.")
    prefix = Path(prefix).expanduser().resolve()
    prefix.mkdir(parents=True, exist_ok=True)
    versions = json.loads(get("https://nodejs.org/dist/index.json"))
    node = next(item["version"] for item in versions if item["version"].startswith("v22.") and item.get("lts"))
    archive = f"node-{node}-linux-x64.tar.xz"
    base = f"https://nodejs.org/dist/{node}/"
    data = get(base + archive)
    checksums = get(base + "SHASUMS256.txt").decode().splitlines()
    digest = next(row.split()[0] for row in checksums if row.split()[-1] == archive)
    if hashlib.sha256(data).hexdigest() != digest:
        raise SystemExit("Node archive checksum mismatch")
    target = prefix / archive
    target.write_bytes(data)
    with tarfile.open(target) as tar:
        tar.extractall(prefix, filter="data")
    target.unlink()
    link = prefix / "node22"
    link.unlink(missing_ok=True)
    link.symlink_to(prefix / f"node-{node}-linux-x64")
    chrome = json.loads(get("https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"))["channels"]["Stable"]
    download = next(item["url"] for item in chrome["downloads"]["chrome"] if item["platform"] == "linux64")
    target = prefix / "chrome.zip"
    target.write_bytes(get(download))
    directory = prefix / f"chrome-{chrome['version']}"
    directory.mkdir(exist_ok=True)
    with zipfile.ZipFile(target) as package:
        for item in package.infolist():
            destination = directory / item.filename
            if not destination.resolve().is_relative_to(directory):
                raise SystemExit("Unsafe browser archive path")
        package.extractall(directory)
        for item in package.infolist():
            mode = (item.external_attr >> 16) & 0o777
            if mode:
                os.chmod(directory / item.filename, mode)
    target.unlink()
    link = prefix / "chrome"
    link.unlink(missing_ok=True)
    link.symlink_to(directory / "chrome-linux64")
    manifest = {"node": node, "chrome": chrome["version"], "node_sha256": digest,
                "node_source": base + archive, "chrome_source": download}
    (prefix / "runtime.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", default="~/.local/opt/crapstv-runtime")
    main(parser.parse_args().prefix)
