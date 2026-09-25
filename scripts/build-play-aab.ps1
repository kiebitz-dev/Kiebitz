[CmdletBinding()]
param(
    [string]$Keystore,
    [string]$Alias = "kiebitz",
    [string]$OutputDirectory = "artifacts",
    [Security.SecureString]$KeystorePassword,
    [switch]$SkipVerification
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pins = Get-Content -LiteralPath (Join-Path $repoRoot "config\toolchain-pins.json") -Raw |
    ConvertFrom-Json
$androidPins = $pins.android

# Stockfish-Quellen, jniLibs und Ausgabe liegen im Nextcloud-Ordner · siehe
# scripts/lib/Assert-ReadableTree.ps1.
. (Join-Path $PSScriptRoot "lib\Assert-ReadableTree.ps1")
Assert-ReadableTree -Root $repoRoot -Paths @("src-tauri\gen\android", "artifacts")

function Find-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_HOME) {
        $candidates += $env:ANDROID_HOME
    }
    $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    $claudePackages = Join-Path $env:LOCALAPPDATA "Packages\Claude_*"
    $candidates += Get-ChildItem -Path $claudePackages -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "LocalCache\Local\Android\Sdk" }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (
            (Test-Path -LiteralPath (Join-Path $candidate "platforms\android-$($androidPins.compileSdk)")) -and
            (Test-Path -LiteralPath (Join-Path $candidate "ndk\$($androidPins.ndk)"))
        ) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Kein vollständiges Android SDK mit API $($androidPins.compileSdk) und NDK $($androidPins.ndk) gefunden."
}

function Find-JdkHome {
    if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
        return (Resolve-Path -LiteralPath $env:JAVA_HOME).Path
    }
    $java = Get-Command java.exe -ErrorAction Stop
    return (Split-Path -Parent (Split-Path -Parent $java.Source))
}

if (-not $Keystore) {
    $preferred = Join-Path $repoRoot "..\Kiebitz_signing_keys\kiebitz-release.jks"
    $fallback = Join-Path $repoRoot "kiebitz-release.jks"
    if (Test-Path -LiteralPath $preferred) {
        $Keystore = $preferred
    } elseif (Test-Path -LiteralPath $fallback) {
        $Keystore = $fallback
    } else {
        throw "kiebitz-release.jks wurde weder im Signing-Backup noch im Projekt gefunden."
    }
}

$keystorePath = (Resolve-Path -LiteralPath $Keystore).Path
$androidSdk = Find-AndroidSdk
$jdkHome = Find-JdkHome
$ndkHome = Join-Path $androidSdk "ndk\$($androidPins.ndk)"
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$keytool = Join-Path $jdkHome "bin\keytool.exe"
$androidProject = Join-Path $repoRoot "src-tauri\gen\android"
$gradlew = Join-Path $androidProject "gradlew.bat"

& (Join-Path $PSScriptRoot "build-stockfish-android.ps1") -AndroidSdk $androidSdk
if ($LASTEXITCODE -ne 0) {
    throw "Der 16-KB-Stockfish-Build ist mit Exitcode $LASTEXITCODE fehlgeschlagen."
}

$secret = if ($KeystorePassword) {
    $KeystorePassword
} else {
    Read-Host "Passwort für kiebitz-release.jks" -AsSecureString
}
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$password = $null

$oldEnvironment = @{
    JAVA_HOME = $env:JAVA_HOME
    ANDROID_HOME = $env:ANDROID_HOME
    NDK_HOME = $env:NDK_HOME
    ANDROID_KEYSTORE_PATH = $env:ANDROID_KEYSTORE_PATH
    ANDROID_KEYSTORE_PASSWORD = $env:ANDROID_KEYSTORE_PASSWORD
    ANDROID_KEY_ALIAS = $env:ANDROID_KEY_ALIAS
    ANDROID_KEY_PASSWORD = $env:ANDROID_KEY_PASSWORD
}

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
    if ([string]::IsNullOrEmpty($password)) {
        throw "Das Keystore-Passwort darf nicht leer sein."
    }

    # Vor dem langen Rust-/Android-Build wirklich auf den privaten Schluessel
    # zugreifen. So fallen ein falsches Passwort, ein falscher Alias oder die
    # falsche Keystore-Datei sofort auf, statt am Ende ein unsigniertes AAB zu
    # hinterlassen. -certreq prueft Store- und Key-Passwort in einem Schritt.
    & $keytool -certreq `
        -alias $Alias `
        -keystore $keystorePath `
        -storepass $password `
        -keypass $password *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Keystore-Pruefung fehlgeschlagen: Passwort, Alias '$Alias' oder Keystore-Datei stimmen nicht."
    }

    $env:JAVA_HOME = $jdkHome
    $env:ANDROID_HOME = $androidSdk
    $env:NDK_HOME = $ndkHome
    $env:ANDROID_KEYSTORE_PATH = $keystorePath
    $env:ANDROID_KEYSTORE_PASSWORD = $password
    $env:ANDROID_KEY_ALIAS = $Alias
    $env:ANDROID_KEY_PASSWORD = $password

    # Ein bereits laufender Gradle-Daemon kann noch mit der Umgebung eines
    # vorherigen (unsignierten) Builds konfiguriert sein. Frisch starten und
    # vorab bestaetigen, dass das Release-Variant den echten Keystore nutzt.
    & $gradlew --stop *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Der vorhandene Gradle-Daemon konnte nicht beendet werden."
    }
    Push-Location $androidProject
    try {
        $signingReportOutput = & $gradlew :app:signingReport --console=plain 2>&1
        $signingReportExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    $signingReport = $signingReportOutput -join [Environment]::NewLine
    $expectedStore = [regex]::Escape($keystorePath)
    if (
        $signingReportExitCode -ne 0 -or
        $signingReport -notmatch "(?s)Variant:\s+universalRelease.*?Config:\s+release.*?Store:\s+$expectedStore"
    ) {
        throw "Gradle hat fuer universalRelease nicht den erwarteten Release-Keystore konfiguriert.`n$signingReport"
    }

    Push-Location $repoRoot
    try {
        & $npx tauri android build `
            --aab `
            --target aarch64 `
            --features play-store `
            --config "src-tauri\tauri.play.conf.json" `
            --ci
        if ($LASTEXITCODE -ne 0) {
            throw "Der Play-AAB-Build ist mit Exitcode $LASTEXITCODE fehlgeschlagen."
        }

        $aab = Get-ChildItem -LiteralPath "src-tauri\gen\android\app\build\outputs" `
            -Recurse -File -Filter "*.aab" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if (-not $aab) {
            throw "Der Build war erfolgreich, aber es wurde kein AAB gefunden."
        }

        $version = (Get-Content -LiteralPath "src-tauri\tauri.conf.json" -Raw |
            ConvertFrom-Json).version
        $destinationDirectory = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
            $OutputDirectory
        } else {
            Join-Path $repoRoot $OutputDirectory
        }
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        $destination = Join-Path $destinationDirectory "Kiebitz_${version}_play_arm64.aab"
        Copy-Item -LiteralPath $aab.FullName -Destination $destination -Force

        if (-not $SkipVerification) {
            & (Join-Path $PSScriptRoot "verify-play-aab.ps1") `
                -AabPath $destination `
                -AndroidSdk $androidSdk `
                -JdkHome $jdkHome `
                -ExpectedVersion $version
            if ($LASTEXITCODE -ne 0) {
                throw "Die AAB-Prüfung ist mit Exitcode $LASTEXITCODE fehlgeschlagen."
            }
        }

        Write-Host "Play-AAB erstellt: $destination"
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $oldEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], "Process")
    }
    $password = $null
    if ($secretPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
    }
}
