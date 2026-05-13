#!/usr/bin/env bash
set -euo pipefail

VSIX="/tmp/modelica-wrapper.vsix"
SENTINEL="/tmp/.modelica-installed"

if [ -f "$SENTINEL" ]; then
  exit 0
fi

if [ ! -f "$VSIX" ]; then
  echo "VSIX not found at $VSIX — postcreate.sh may have failed; check its log above." >&2
  exit 0
fi

if ! command -v code >/dev/null 2>&1; then
  echo "code CLI not on PATH — cannot auto-install VSIX." >&2
  echo "Install manually from a terminal: code --install-extension $VSIX" >&2
  exit 0
fi

code --install-extension "$VSIX" --force
touch "$SENTINEL"

cat <<'EOF'

============================================================
 Modelica extension installed into this Codespace.
 If VSCode does not prompt you to reload, run:
   Command Palette → "Developer: Reload Window"
 After reload, the Modelica activity bar icon will appear.
============================================================
EOF
