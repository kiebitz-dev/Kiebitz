<#
.SYNOPSIS
  Validiert, versioniert, baut das Play-AAB, committet und veröffentlicht einen Kiebitz-Release.

.EXAMPLE
  .\scripts\release.ps1 -Version X.Y.Z
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$versionFilesChanged = $false
$releaseCommitCreated = $false

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Fehlgeschlagen: $Command $($Arguments -join ' ')"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\Assert-ReadableTree.ps1")
Push-Location $repoRoot
try {
  # Vor allem anderen · siehe scripts/lib/Assert-ReadableTree.ps1. Ohne
  # laufenden Nextcloud-Client scheitert der Release sonst erst nach
  # Build und Tests, mitten im Stockfish-Build.
  Assert-ReadableTree -Root $repoRoot -Paths @("src", "scripts", "config", "src-tauri", "artifacts")

  if ((git branch --show-current).Trim() -ne "main") {
    throw "Releases dürfen nur vom main-Branch gestartet werden."
  }
  if (git status --porcelain) {
    throw "Der Working Tree muss vor einem Release sauber sein."
  }
  & git ls-remote --exit-code --tags origin "refs/tags/v$Version" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Der Tag v$Version existiert bereits auf origin."
  }

  $tauriConfig = Join-Path $repoRoot "src-tauri\tauri.conf.json"
  $currentVersion = (Get-Content -Raw $tauriConfig | ConvertFrom-Json).version
  if ([Version]$Version -le [Version]$currentVersion) {
    throw "Die neue Version ($Version) muss höher als $currentVersion sein."
  }

  Write-Host "Validiere Release v$Version …" -ForegroundColor Cyan
  Invoke-Checked npm @("run", "build")
  Invoke-Checked npm @("run", "test:run")
  Invoke-Checked cargo @("test", "--manifest-path", "src-tauri/Cargo.toml")

  # Ab hier werden Versionsdateien verändert. Schlägt Build oder Prüfung fehl,
  # stellt der catch-Block den zuvor garantierten sauberen Zustand wieder her.
  $versionFilesChanged = $true

  # npm hält package.json und package-lock.json konsistent, ohne selbst zu taggen.
  Invoke-Checked npm @("version", $Version, "--no-git-tag-version", "--ignore-scripts")

  $json = Get-Content -Raw $tauriConfig
  # ${1}/${2} halten die Regex-Gruppen von einer direkt folgenden, mit einer
  # Ziffer beginnenden Versionsnummer getrennt (sonst wird z. B. $1 + 0.5.0
  # von .NET als die nicht vorhandene Gruppe $10 interpretiert).
  $replacement = '${1}' + $Version + '${2}'
  $updated = $json -replace '("version"\s*:\s*")[^"]+("\s*,?)', $replacement
  if ($updated -eq $json) {
    throw "Die Version in src-tauri/tauri.conf.json konnte nicht aktualisiert werden."
  }
  try {
    $updatedConfig = $updated | ConvertFrom-Json
  }
  catch {
    throw "Die aktualisierte Tauri-Konfiguration ist kein gültiges JSON: $($_.Exception.Message)"
  }
  if ($updatedConfig.version -ne $Version) {
    throw "Die Tauri-Version wurde nicht korrekt auf $Version aktualisiert."
  }
  [System.IO.File]::WriteAllText(
    $tauriConfig,
    $updated,
    (New-Object System.Text.UTF8Encoding($false))
  )

  # Erst nach der Versionsaktualisierung bauen, damit Manifest und Dateiname des
  # Play-Bundles die neue Release-Version tragen. Der Release wird erst
  # committet/getaggt/gepusht, wenn Build und AAB-Prüfung erfolgreich waren.
  Write-Host "Baue und prüfe Play-AAB für v$Version …" -ForegroundColor Cyan
  $playAabScript = Join-Path $PSScriptRoot "build-play-aab.ps1"
  $playAabDirectory = Join-Path $repoRoot "artifacts"
  & $playAabScript -OutputDirectory $playAabDirectory

  $playAab = Join-Path $playAabDirectory "Kiebitz_${Version}_play_arm64.aab"
  if (-not (Test-Path -LiteralPath $playAab -PathType Leaf)) {
    throw "Das erwartete Play-AAB wurde nicht erstellt: $playAab"
  }

  Invoke-Checked git @("add", "package.json", "package-lock.json", "src-tauri/tauri.conf.json")
  Invoke-Checked git @("commit", "-m", "Release v$Version")
  $releaseCommitCreated = $true
  Invoke-Checked git @("tag", "-a", "v$Version", "-m", "Kiebitz v$Version")
  # Branch und Tag kommen gemeinsam auf GitHub oder gar nicht.
  Invoke-Checked git @("push", "--atomic", "origin", "main", "v$Version")

  Write-Host "Release v$Version gestartet: https://github.com/kiebitz-dev/Kiebitz/actions" -ForegroundColor Green
  Write-Host "Play-AAB für die Google Play Console: $playAab" -ForegroundColor Green
}
catch {
  $releaseError = $_
  if ($versionFilesChanged -and -not $releaseCommitCreated) {
    Write-Warning "Release fehlgeschlagen; Versionsdateien werden auf HEAD zurückgesetzt."
    & git restore --source=HEAD -- package.json package-lock.json src-tauri/tauri.conf.json
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Automatischer Rollback fehlgeschlagen. Bitte die drei Versionsdateien prüfen."
    }
  }
  throw $releaseError
}
finally {
  Pop-Location
}
