#!/usr/bin/env bash
# The sandbox has lost the Godot binary at least once mid-run. Restore it
# rather than reporting a broken toolchain.
set -euo pipefail
V=4.4.1-stable
command -v godot >/dev/null 2>&1 && exit 0
cd /tmp
curl -sSL -o godot.zip \
  "https://github.com/godotengine/godot/releases/download/${V}/Godot_v${V}_linux.x86_64.zip"
unzip -oq godot.zip
mv "Godot_v${V}_linux.x86_64" /usr/local/bin/godot
chmod +x /usr/local/bin/godot
rm -f godot.zip
godot --version
