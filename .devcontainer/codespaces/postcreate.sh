#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/modelica-wrapper

echo "==> [1/3] Installing workspace dependencies (pnpm)"
pnpm install --frozen-lockfile

echo "==> [2/3] Building extension bundle"
pnpm --filter modelica-wrapper build

echo "==> [3/3] Packaging VSIX"
cd packages/extension
npx -y @vscode/vsce@latest package \
  --no-dependencies \
  --skip-license \
  --allow-missing-repository \
  --out /tmp/modelica-wrapper.vsix

echo
echo "VSIX ready: /tmp/modelica-wrapper.vsix"
echo "It will be installed into VSCode by postattach.sh on the next attach."
