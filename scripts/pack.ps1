# Сборка клиентского пакета: одна папка, которую загружают в браузер
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Dist = Join-Path $Root "dist"
$Ext = Join-Path $Root "extension"
$Packaging = Join-Path $Root "packaging"
$HostCs = Join-Path $Root "native-host\host.cs"
$HostExe = Join-Path $Ext "native\host.exe"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Ext "native") | Out-Null

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found. Need .NET Framework 4." }
$compiled = Join-Path $Dist "host.exe"
& $csc /nologo /optimize /target:winexe /out:$compiled /r:System.Web.Extensions.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll $HostCs
if ($LASTEXITCODE -ne 0) { throw "host.exe compile failed" }

$kitZip = Join-Path $Dist "StarlitVPN.zip"
Remove-Item $kitZip -ErrorAction SilentlyContinue

$stage = Join-Path $Dist "StarlitVPN"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item -Recurse -Force (Join-Path $Ext "*") $stage
New-Item -ItemType Directory -Force -Path (Join-Path $stage "native") | Out-Null
Copy-Item -Force $compiled (Join-Path $stage "native\host.exe")
try { Copy-Item -Force $compiled $HostExe } catch { Write-Warning "Could not refresh extension/native/host.exe (file in use)" }
Remove-Item (Join-Path $stage "manifest.firefox.json") -ErrorAction SilentlyContinue
Remove-Item (Join-Path $stage "icons\brand-src.jpg") -ErrorAction SilentlyContinue

$utf8bom = New-Object System.Text.UTF8Encoding $true
$instr = [System.IO.File]::ReadAllText((Join-Path $Packaging "INSTALL.txt"))
[System.IO.File]::WriteAllText((Join-Path $stage "INSTALL.txt"), $instr, $utf8bom)
Copy-Item (Join-Path $Root "LICENSE") $stage

Compress-Archive -Path $stage -DestinationPath $kitZip -Force
Remove-Item $stage -Recurse -Force
Remove-Item $compiled -ErrorAction SilentlyContinue

$ver = "1.0.2"
try {
  $man = Get-Content (Join-Path $Ext "manifest.json") -Raw | ConvertFrom-Json
  $ver = $man.version
} catch { }
@"
{
  "version": "$ver",
  "zip": "https://github.com/RasmusVraa/StarlitVPN/releases/latest/download/StarlitVPN.zip"
}
"@ | Set-Content -Path (Join-Path $Dist "latest.json") -Encoding UTF8
Write-Host "Wrote $kitZip"
Write-Host "Release asset next to zip: $(Join-Path $Dist 'latest.json')"
