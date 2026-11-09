#!/usr/bin/env bash
set -euo pipefail

# Run as the Linux TV user, not root. The HA token stays in its existing file.
task_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
task_install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/crapstv-night"
task_config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/crapstv-night"
task_ref="${1:-main}"
task_node="${CRAPSTV_NODE:-$(command -v node || true)}"
task_npm="${CRAPSTV_NPM:-$(command -v npm || true)}"
task_browser="${CRAPSTV_BROWSER:-$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"

if [[ -z "$task_node" || -z "$task_npm" || -z "$task_browser" ]]; then
  echo "Set CRAPSTV_NODE, CRAPSTV_NPM and CRAPSTV_BROWSER to Node22/npm and a sandbox-capable Chrome/Chromium installation." >&2
  exit 1
fi
python3 -c 'import websockets' || { echo "The HA launcher requires Python websockets." >&2; exit 1; }
"$task_node" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo "Node22 or later is required." >&2; exit 1; }
mkdir -p "$task_install_dir" "$task_config_dir" "$HOME/.config/systemd/user"
install -m 755 "$task_script_dir/craps_night.py" "$task_install_dir/craps_night.py"
install -m 644 "$task_script_dir/crapstv-night.service" "$HOME/.config/systemd/user/crapstv-night.service"

python3 - "$task_config_dir/config.json" "$task_install_dir/data" "$task_node" "$task_npm" "$task_browser" "$task_ref" <<'PY'
import json,sys
from pathlib import Path
path=Path(sys.argv[1])
if path.exists():
    print("Existing launcher configuration retained: "+str(path))
else:
    path.write_text(json.dumps({"data_dir":sys.argv[2],"node":sys.argv[3],"npm":sys.argv[4],"browser":sys.argv[5],
        "ref":sys.argv[6],"repository":"https://github.com/tmansmann0/crapsTV.git","port":3000,"hostname":"crapstv-tv",
        "entity":"input_boolean.living_room_craps_night","ha_config":"/var/lib/hyperion-room-bridge/config.json",
        "display":":0","xauthority":"/etc/jmp-xauth","runtime_dir":"/run/user/1000"},indent=2)+"\n")
    path.chmod(0o600)
PY
systemctl --user daemon-reload
systemctl --user enable --now crapstv-night.service
echo "craps night bridge started. Keep input_boolean.living_room_craps_night Off until installation checks are complete."
