#!/usr/bin/env bash
# Installs the AE Motion MCP panel (macOS) and builds the MCP server.
#   1. npm install && npm run build   (dist/ and panel/host/host.jsx)
#   2. copy panel/ into the CEP extensions folder, plus install.json (repo path, PATH) for the panel's Update button
#   3. allow unsigned CEP panels (PlayerDebugMode)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname)" != "Darwin" ]; then echo "On Windows run scripts/install.ps1"; exit 1; fi

# Build first: panel/host/host.jsx is generated from host/.
(cd "$HERE" && npm install && npm run build)

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.aemotion.mcp"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$HERE/panel/." "$DEST/"
# For the panel's Update button: where the repo is, and a PATH that finds git, node and npm (After Effects is
# started from the Dock with a minimal PATH, so it would not find Homebrew or nvm installs).
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], path: process.env.PATH }))' "$DEST/install.json" "$HERE"

# Allow unsigned CEP panels
for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

cat <<EOF

Done. Panel installed to:
  $DEST

1. In After Effects: After Effects > Settings > Scripting & Expressions > enable
   "Allow Scripts to Write Files and Access Network".
2. Restart After Effects, then open Window > Extensions > AE Motion MCP and keep it open (dock it).
3. Register the server:
   claude mcp add ae-motion -- node "$HERE/dist/index.js"
EOF
