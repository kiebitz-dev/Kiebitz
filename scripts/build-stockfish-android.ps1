[CmdletBinding()]
param(
    [string]$AndroidSdk,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pins = Get-Content -LiteralPath (Join-Path $repoRoot "config\toolchain-pins.json") -Raw |
    ConvertFrom-Json
$stockfishPins = $pins.stockfish
$androidPins = $pins.android
$commit = $stockfishPins.commit
$commitShort = $commit.Substring(0, 8)
$gitDate = $stockfishPins.gitDate

if (-not $AndroidSdk) {
    $AndroidSdk = $env:ANDROID_HOME
}
if (-not $AndroidSdk -or -not (Test-Path -LiteralPath $AndroidSdk)) {
    throw "ANDROID_HOME is missing; pass -AndroidSdk."
}

$ndkRoot = Join-Path $AndroidSdk "ndk\$($androidPins.ndk)"
$toolchain = Join-Path $ndkRoot "toolchains\llvm\prebuilt\windows-x86_64\bin"
$compiler = Join-Path $toolchain "aarch64-linux-android$($androidPins.nativeApi)-clang++.cmd"
$strip = Join-Path $toolchain "llvm-strip.exe"
$readelf = Join-Path $toolchain "llvm-readelf.exe"
foreach ($tool in @($compiler, $strip, $readelf)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Required NDK tool is missing: $tool"
    }
}

$sourceRoot = Join-Path $repoRoot "artifacts\stockfish-$($stockfishPins.version)-source"
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot ".git"))) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourceRoot) -Force | Out-Null
    & git clone --filter=blob:none --no-checkout `
        $stockfishPins.repository $sourceRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Cloning the Stockfish source failed."
    }
}

& git -C $sourceRoot fetch --depth 1 origin $commit
if ($LASTEXITCODE -ne 0) {
    throw "Fetching the pinned Stockfish commit failed."
}
& git -C $sourceRoot checkout --detach $commit
if ($LASTEXITCODE -ne 0) {
    throw "Checking out the pinned Stockfish commit failed."
}
$actualCommit = (& git -C $sourceRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $commit) {
    throw "Unexpected Stockfish commit: $actualCommit"
}

$sourceDirectory = Join-Path $sourceRoot "src"
$networks = $stockfishPins.networks
foreach ($network in $networks) {
    $networkPath = Join-Path $sourceDirectory $network.File
    if (-not (Test-Path -LiteralPath $networkPath)) {
        $networkUrl = "https://tests.stockfishchess.org/api/nn/$($network.File)"
        Write-Host "Downloading $($network.File) ..."
        Invoke-WebRequest -UseBasicParsing -Uri $networkUrl -OutFile $networkPath
    }
    $networkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $networkPath).Hash
    if ($networkHash -ne $network.Sha256) {
        throw "NNUE checksum mismatch for $($network.File)."
    }
}

# Dieselbe Liste, die `src/Makefile` als SRCS führt. Sie steht hier von Hand,
# weil dieser Build ohne make auskommt · nach einem Versionswechsel gehört sie
# gegen den Makefile des gepinnten Commits geprüft.
$sourceFiles = @(
    "attacks.cpp",
    "benchmark.cpp",
    "bitboard.cpp",
    "evaluate.cpp",
    "main.cpp",
    "misc.cpp",
    "movegen.cpp",
    "movepick.cpp",
    "position.cpp",
    "search.cpp",
    "thread.cpp",
    "timeman.cpp",
    "tt.cpp",
    "uci.cpp",
    "ucioption.cpp",
    "tune.cpp",
    "syzygy/tbprobe.cpp",
    "nnue/nnue_accumulator.cpp",
    "nnue/nnue_misc.cpp",
    "nnue/network.cpp",
    "nnue/features/half_ka_v2_hm.cpp",
    "nnue/features/full_threats.cpp",
    "nnue/features/pp_3wide.cpp",
    "engine.cpp",
    "score.cpp",
    "memory.cpp"
)
$binary = Join-Path $sourceDirectory "stockfish-android-armv8-16kb"
$compilerArguments = @(
    "-Wall",
    "-Wcast-qual",
    "-fno-exceptions",
    "-std=c++17",
    "-stdlib=libc++",
    "-DUSE_PTHREADS",
    "-DNDEBUG",
    "-O3",
    "-funroll-loops",
    "-DIS_64BIT",
    "-DUSE_POPCNT",
    "-DUSE_NEON=8",
    "-DGIT_SHA=$commitShort",
    "-DGIT_DATE=$gitDate",
    "-DARCH=armv8",
    "-flto=full",
    "-fPIE",
    "-static-libstdc++",
    "-pie",
    "-Wl,-z,max-page-size=$($androidPins.pageSize)",
    "-o",
    $binary
) + $sourceFiles

Push-Location $sourceDirectory
try {
    Write-Host "Building Stockfish $($stockfishPins.version) for Android arm64 with $($androidPins.pageSize / 1024) KB alignment ..."
    & $compiler @compilerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "The Stockfish compiler exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

& $strip $binary
if ($LASTEXITCODE -ne 0) {
    throw "Stripping the Stockfish binary failed."
}
$loadHeaders = & $readelf -lW $binary | Where-Object { $_ -match "^\s*LOAD\s" }
foreach ($header in $loadHeaders) {
    $alignmentText = ($header.Trim() -split "\s+")[-1]
    $alignment = [Convert]::ToInt64($alignmentText.Replace("0x", ""), 16)
    if ($alignment -lt $androidPins.pageSize) {
        throw "Stockfish LOAD alignment is only $alignmentText."
    }
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $repoRoot `
        "src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libstockfish.so"
}
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
Copy-Item -LiteralPath $binary -Destination $OutputPath -Force

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash
Write-Host "Stockfish ready: $OutputPath"
Write-Host "SHA-256: $hash"
