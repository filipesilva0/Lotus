# Builds Lotus-windows-x64.msix, the Microsoft Store package, from a finished `npm run tauri build`.
#
# Tauri can't make an MSIX itself, so this uses Microsoft's free winapp tool (pinned below). The
# package is left unsigned on purpose: the Microsoft Store signs it when it is submitted. It is for
# uploading in Partner Center, not for installing by double-click.
#
# Inside the package: Lotus.exe, lotusd.exe (the background core), the logos, and an empty
# "lotus.store" marker that tells Lotus the Store keeps it up to date (src-tauri/src/paths.rs).
#
#   ./scripts/package-msix.ps1 -Version 0.19.0     # Store versions have four numbers: 0.19.0.0
param([string]$Version = '0.0.0')
$ErrorActionPreference = 'Stop'
$Winapp = '@microsoft/winappcli@0.8.0'

$root = Split-Path -Parent $PSScriptRoot
$exe  = Join-Path $root 'src-tauri\target\release\lotus.exe'
if (-not (Test-Path $exe)) { throw "lotus.exe not found. Run 'npm run tauri build' first." }
$core = Join-Path $root 'src-tauri\target\release\lotusd.exe'
if (-not (Test-Path $core)) { $core = Join-Path $root 'src-tauri\binaries\lotusd-x86_64-pc-windows-msvc.exe' }
if (-not (Test-Path $core)) { throw "lotusd.exe not found (looked next to lotus.exe and in src-tauri\binaries)." }

# 0.19.0 -> 0.19.0.0 (a "-beta" style suffix is dropped; the Store wants the last number to be 0).
if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw "'$Version' is not a version like 1.2.3" }
$parts = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
if (($parts | Measure-Object -Sum).Sum -eq 0) { $parts = @(0, 0, 1) }   # test builds
$msixVersion = "$($parts -join '.').0"

$out   = Join-Path $root 'dist-msix'
$stage = Join-Path $out 'package'
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item $exe  (Join-Path $stage 'Lotus.exe')
Copy-Item $core (Join-Path $stage 'lotusd.exe')
New-Item -ItemType File -Force (Join-Path $stage 'lotus.store') | Out-Null
Copy-Item (Join-Path $root 'src-tauri\msix\Assets') (Join-Path $stage 'Assets') -Recurse
Copy-Item (Join-Path $root 'LICENSE') $stage -ErrorAction SilentlyContinue
Copy-Item (Join-Path $root 'THIRD_PARTY_LICENSES.md') $stage -ErrorAction SilentlyContinue

# The manifest with this release's version.
[xml]$manifest = Get-Content (Join-Path $root 'src-tauri\msix\Package.appxmanifest') -Raw
$manifest.Package.Identity.Version = $msixVersion
$manifest.Save((Join-Path $stage 'Package.appxmanifest'))
$publisher = $manifest.Package.Identity.Publisher
Write-Host "Identity: $($manifest.Package.Identity.Name) / $publisher / $msixVersion"
if ($publisher -like '*PLACEHOLDER*') {
  Write-Host "::warning title=Store identity not set::src-tauri/msix/Package.appxmanifest still has placeholder identity values. The package builds, but Partner Center will refuse it until the values from the app's Product identity page are filled in."
}

$msix = Join-Path $out 'Lotus-windows-x64.msix'
& npx --yes $Winapp pack $stage --output $msix --executable Lotus.exe --no-sign
if ($LASTEXITCODE -ne 0) { throw "winapp pack failed (exit $LASTEXITCODE)" }
if (-not (Test-Path $msix)) { throw "winapp pack finished but $msix is missing" }

# An MSIX is a zip: make sure everything Lotus needs is inside.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($msix)
$names = $zip.Entries | ForEach-Object { $_.FullName }
$zip.Dispose()
foreach ($need in 'Lotus.exe', 'lotusd.exe', 'lotus.store', 'AppxManifest.xml', 'Assets/StoreLogo.png') {
  if ($names -notcontains $need) { throw "The MSIX is missing $need. It holds: $($names -join ', ')" }
}
Write-Host "Created $msix ($([math]::Round((Get-Item $msix).Length / 1MB, 1)) MB, version $msixVersion)"
