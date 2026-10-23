# Installs the AE Motion MCP panel (Windows) and builds the MCP server.
#   1. npm install; npm run build   (dist\ and panel\host\host.jsx)
#   2. copy panel\ into the CEP extensions folder, plus install.json (repo path, PATH) for the panel's Update button
#   3. allow unsigned CEP panels (PlayerDebugMode)
#   4. register the server with Claude Desktop and Claude Code (scripts\register.ts; AE_MCP_REGISTER=0 skips it)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.aemotion.mcp"

# Node 22.18+ runs the TypeScript build scripts directly (type stripping)
$nodeVersion = if (Get-Command node -ErrorAction SilentlyContinue) { (node --version) } else { "none" }
if ($nodeVersion -notmatch '^v(\d+)\.(\d+)' -or [int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 18)) {
  throw "Node.js 22.18 or later is needed (found: $nodeVersion). Install it from https://nodejs.org, then run this again."
}

# Build first: panel\host\host.jsx is generated from host\.
Push-Location $here
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
  Pop-Location
}

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $here "panel\*") $dest
# For the panel's Update button: where the repo is, and a PATH that finds git, node and npm.
@{ repo = $here; path = $env:PATH } | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 (Join-Path $dest "install.json")

# Allow unsigned CEP panels
foreach ($v in 9, 10, 11, 12) {
  reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f | Out-Null
}

Write-Host ""
node (Join-Path $here "scripts\register.ts")

Write-Host @"

Done. Panel installed to:
  $dest

1. In After Effects: Edit > Preferences > Scripting & Expressions > enable
   "Allow Scripts to Write Files and Access Network".
2. Restart After Effects, then open Window > Extensions > AE Motion MCP and keep it open (dock it).
3. Other MCP clients: run node "$here\dist\index.js" as a stdio server.
"@
