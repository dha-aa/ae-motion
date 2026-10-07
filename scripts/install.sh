#!/usr/bin/env bash
# Installs the AE Motion MCP panel (macOS) and builds the MCP server.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(uname)" != "Darwin" ]; then echo "On Windows run scripts/install.ps1"; exit 1; fi

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.aemotion.mcp"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$HERE/panel/." "$DEST/"

# Allow unsigned CEP panels
for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

(cd "$HERE" && npm install && npm run build)

cat <<EOF

Done.
1. In After Effects: Edit/After Effects > Settings > Scripting & Expressions > enable
   "Allow Scripts to Write Files and Access Network".
2. Restart After Effects, then open Window > Extensions > AE Motion MCP and keep it open (dock it).
3. Register the server:
   claude mcp add ae-motion -- node "$HERE/dist/index.js"
EOF
