# Register StarlitVPN native host (no Python).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Split-Path -Parent $Root
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "Need .NET Framework 4 (csc.exe)" }

$outDir = Join-Path $Repo "extension\native"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$HostExe = Join-Path $outDir "host.exe"
& $csc /nologo /optimize /target:winexe /out:$HostExe /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll (Join-Path $Root "host.cs")
if ($LASTEXITCODE -ne 0) { throw "Failed to compile host.exe" }

& $HostExe --register
if ($LASTEXITCODE -ne 0) { throw "host.exe --register failed" }

Write-Host ""
Write-Host "Native host registered."
Write-Host "Chrome: chrome://extensions -> Load unpacked -> folder extension"
Write-Host "Firefox: about:debugging -> Load Temporary Add-on -> extension/manifest.json"
