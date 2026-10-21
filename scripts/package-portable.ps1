# Builds Tomo-portable-x64.zip from a finished `npm run tauri build`.
# The zip holds tomo.exe plus an empty "tomo.portable" marker file. When that file sits next to the
# exe, Tomo keeps ALL of its data in a "data" folder beside it (see src-tauri/src/paths.rs).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'src-tauri\target\release\tomo.exe'
if (-not (Test-Path $exe)) { throw "tomo.exe not found. Run 'npm run tauri build' first." }

$stage = Join-Path $root 'dist-portable\Tomo'
Remove-Item -Recurse -Force (Split-Path $stage) -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item $exe (Join-Path $stage 'Tomo.exe')
New-Item -ItemType File -Force (Join-Path $stage 'tomo.portable') | Out-Null
Copy-Item (Join-Path $root 'LICENSE') $stage -ErrorAction SilentlyContinue
Copy-Item (Join-Path $root 'THIRD_PARTY_LICENSES.md') $stage -ErrorAction SilentlyContinue
@"
Tomo (portable)

Run Tomo.exe. Everything Tomo stores (chats, settings, voices, the WebView2 profile) is kept in the
"data" folder next to Tomo.exe, so you can move or delete this whole folder freely.

Requirements: Windows 10 (1803+) or 11 with the Microsoft Edge WebView2 Runtime
(already included in Windows 11 and up-to-date Windows 10).

Delete the file "tomo.portable" to make Tomo store data in your user profile instead.
"@ | Set-Content (Join-Path $stage 'README.txt') -Encoding UTF8

$zip = Join-Path $root 'dist-portable\Tomo-portable-x64.zip'
Compress-Archive -Path $stage -DestinationPath $zip -Force
Write-Host "Created $zip"
