# Installs the AE Motion MCP panel (Windows) and builds the MCP server.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.aemotion.mcp"

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $here "panel\*") $dest

# Allow unsigned CEP panels
foreach ($v in 9, 10, 11, 12) {
  reg add "HKCU\Software\Adobe\CSXS.$v" /v PlayerDebugMode /t REG_SZ /d 1 /f | Out-Null
}

Push-Location $here
npm install
npm run build
Pop-Location

Write-Host @"

Done.
1. In After Effects: Edit > Preferences > Scripting & Expressions > enable
   "Allow Scripts to Write Files and Access Network".
2. Restart After Effects, then open Window > Extensions > AE Motion MCP and keep it open (dock it).
3. Register the server:
   claude mcp add ae-motion -- node "$here\dist\index.js"
"@
