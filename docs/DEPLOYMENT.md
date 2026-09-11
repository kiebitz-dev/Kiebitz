# Kiebitz — Deployment

How to build, package, and distribute Kiebitz. The app is a Tauri 2 project: a
Rust core plus a Vite/React frontend. The **desktop** build is the primary
product and CI builds it for **Windows, macOS and Linux**, each with
auto-update. An **Android** build exists too — a signed, sideloaded
APK that CI attaches to each release, plus a separate Google Play AAB flavor;
see *Android build* below. There is no iOS build; the reason is under *Code
signing & notarization → iOS*.

- Product name: `Kiebitz`
- Bundle identifier: `de.torim.kiebitz`
- Current version: see `src-tauri/tauri.conf.json` → `version`
- Stockfish and Android toolchain pins: `config/toolchain-pins.json`. Run
  `npm run pins:sync` after changing it; CI verifies its consumers with
  `npm run pins:check`.
- Website: <https://kiebitz.dev/> — a **separate** repository,
  [`kiebitz-dev/kiebitz-site`](https://github.com/kiebitz-dev/kiebitz-site), served by
  GitHub Pages from `main`/root. It hosts the privacy policy that Google Play
  requires, so that URL has to stay reachable and stable. Referenced from
  `README.md`, `package.json` → `homepage`, `Cargo.toml` → `homepage`, and from
  Settings → About Kiebitz in the app.

## Prerequisites

Same toolchain as development:

- **Node.js** 20+ (developed on 24) and npm.
- **Rust** stable (developed on 1.97), MSVC toolchain on Windows.
- **C++ build tools** for the target OS:
  - Windows: Visual Studio Build Tools with the "Desktop development with C++"
    workload (MSVC + Windows SDK).
  - macOS: Xcode Command Line Tools.
  - Linux: `webkit2gtk`, `libgtk`, `librsvg`, `patchelf`, and build essentials
    (see the Tauri prerequisites for your distro).

Install project dependencies once:

```sh
npm install
```

### One-time setup for the Android build

Only needed if you build the Android APK. On this machine it is already
installed (2026-07-17); these are the steps to reproduce it elsewhere. No
Android Studio required — the command-line tools are enough.

1. **JDK 17** (Temurin). Portable zip is fine; set `JAVA_HOME` to it. On this
   machine: `C:\Users\tomma\AppData\Local\Java\jdk-17.0.19+10`.
2. **Android SDK** via the command-line tools. Unzip Google's
   `commandlinetools` into `<sdk>\cmdline-tools\latest\`, set `ANDROID_HOME`
   to `<sdk>` (here: `C:\Users\tomma\AppData\Local\Android\Sdk`), then:

   ```sh
   eval "$(node scripts/export-toolchain-pins.mjs)"
   sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-$ANDROID_COMPILE_SDK" "build-tools;$ANDROID_BUILD_TOOLS" "ndk;$ANDROID_NDK_VERSION"
   ```

   Set `NDK_HOME` to `<sdk>\ndk\$ANDROID_NDK_VERSION` using the exported pin.
3. **Rust Android targets**:

   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

4. **Windows only — enable Developer Mode** (Settings → System → For
   developers). The Tarui CLI symlinks the built `libapp_lib.so` into the
   Gradle project, which needs the symlink privilege.

`JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` are persisted as user environment
variables, but tools that keep a long-lived shell don't always inherit them —
export all three inline in the same command when invoking `tauri android` (see
*Android build*).

## Local build & run

```sh
npm run tauri dev     # dev build, hot-reloaded frontend + Rust
npm run tauri build   # optimized production build + installers
```

`tauri build` runs `npm run build` (type-check + Vite production bundle) first,
then compiles the Rust binary in release mode and packages it.

## Build output

`npm run tauri build` writes to `src-tauri/target/release/bundle/`:

- **Windows**: `msi/Kiebitz_<version>_x64_en-US.msi` and
  `nsis/Kiebitz_<version>_x64-setup.exe`.
- **macOS**: `dmg/Kiebitz_<version>_<arch>.dmg` and a `.app` bundle.
- **Linux**: `deb/`, `rpm/`, and `appimage/` artifacts.

The raw executable is at `src-tauri/target/release/kiebitz(.exe)`.

`bundle.targets` is currently `"all"`; set it to a specific list (e.g. `["nsis"]`)
in `tauri.conf.json` to build only what you ship.

## Bundling the Stockfish engine (required for a real release)

The platform-specific engine binary is deliberately gitignored. The Tauri
resource configuration already bundles it, so a local production build must
stage the matching binary under `src-tauri/binaries/` first; if the configured
resource is absent, the build fails instead of silently shipping without live
analysis. Release CI downloads or compiles the centrally pinned Stockfish build
and verifies its checksum before invoking Tauri.

The backend (`src-tauri/src/lib.rs` → `resolve_engine`) looks for the engine in
this order:

1. the `KIEBITZ_ENGINE` environment variable (an explicit path),
2. `<manifest>/binaries/stockfish[.exe]` (development),
3. `<resource_dir>/binaries/stockfish[.exe]` (installed app).

`bundle.resources` in the base and platform-specific Tauri configurations copies
the staged file to the installed resource directory, where `resolve_engine`
expects it.

Notes:

- **Cross-platform**: the filename differs per OS, so the resource list does
  too. Tauri merges a platform config over the base one automatically, and each
  of `tauri.macos.conf.json`, `tauri.linux.conf.json` and
  `tauri.android.conf.json` replaces `bundle.resources` with its own list —
  `binaries/stockfish` without the `.exe` on macOS and Linux, and no engine
  resource at all on Android (there Stockfish ships as
  `jniLibs/<abi>/libstockfish.so`, the only place Android permits execution
  from). The base `tauri.conf.json` stays the Windows case.
  The bundler copies resources with their permission bits, so the executable
  flag survives into the `.app`, the AppImage and the `.deb`/`.rpm`.
- **Licensing**: Stockfish is **GPL-3.0** and Kiebitz distributes its unmodified
  official binary as a separate UCI process. `resources/stockfish/NOTICE.txt`
  is generated from the central pins and records the Stockfish version, exact
  source commit, official binary URLs and their
  SHA-256 hashes, plus a **written offer for the corresponding source** (GPL-3.0
  §6); `COPYING.txt` contains the complete GPL-3.0. Both files are bundled on
  desktop and Android and are also referenced by `THIRD_PARTY_NOTICES.md`. CI
  verifies the pinned Stockfish source, binaries and NNUE networks, and a
  separate `stockfish-source` job attaches the engine's source archive to every
  release (see below). Stockfish upgrades change the pins once and then run
  `npm run pins:sync`; workflows and local scripts read those pins directly.

## Kiebitz Plus on Android

Google requires its own payment flow for digital content bought inside the app,
so on Android Kiebitz Plus is sold through **Google Play Billing**. Wherever
Play answers, the Stripe checkout disappears from the interface entirely —
offering both side by side is the classic reason a review is rejected. Stripe
stays the route on desktop and on the website.

The pieces:

```text
src-tauri/gen/android/.../BillingPlugin.kt   purchase, restore, acknowledge
src-tauri/src/billing.rs                     Tauri bridge; a no-op off Android
src/lib/plus/billing.ts                      the JS side and the product id
src/lib/plus/store.ts                         purchaseWithGooglePlay, restoreGooglePlayPurchases
```

The order inside `purchaseWithGooglePlay` is the security of the whole flow:
buy, let the API verify the token against Google, and only then acknowledge to
Google. Acknowledging first would give away the one refund Google performs by
itself — an unacknowledged purchase is refunded after three days, which is
exactly what should happen if the purchase could not be linked to an account.
A pending payment is therefore linked but deliberately not acknowledged.

The client never decides what Plus means. It hands over a token; the entitlement
comes back signed from the API.

`PLUS_PRODUCT_ID` in `src/lib/plus/billing.ts` must match the subscription's
product id in the Play Console. The price lives in Play and nowhere in the code.
Whether a trial is offered is Google's decision, which is why the Android button
never promises one — the Play sheet states the actual offer.

Restoring is the way back after a device change, a reinstall, or a purchase that
never got linked: Google still knows the purchase and the tokens are sent for
verification again. A foreign or expired token in the same Play account is
stepped over rather than aborting the run.

## Android build (APK)

The Android app reuses the same Rust core and React frontend. A tagged release
now builds and attaches a signed APK automatically (see *Releasing a new
version*); the steps here are for **local** builds and to explain the moving
parts. The app is **sideloaded** and cannot install silently (the Tauri updater
plugin is desktop-only). Settings → Updates nevertheless checks the shared
GitHub release feed: when a newer version exists, Kiebitz opens the matching
signed APK in the system browser. Open the downloaded APK and confirm Android's
install prompt; the existing app data is preserved.

> **Two version fields.** `versionName` is the human-readable string (e.g.
> `0.4.0`, shown in-app) and comes straight from `tauri.conf.json`. `versionCode`
> is a separate integer Android uses to compare "newer/older" for installs; it is
> **never shown** and must be an integer, so it cannot literally be `0.4.0`. Tauri
> derives it from the version (`0.4.0` → `4000`, `0.4.1` → `4001`, monotonic),
> which is why installs over an older APK work. Nothing to set by hand.

Build a debug APK (arm64), exporting the toolchain paths inline:

```sh
eval "$(node scripts/export-toolchain-pins.mjs)"
JAVA_HOME=".../jdk-17.0.19+10" \
ANDROID_HOME=".../Android/Sdk" \
NDK_HOME=".../Android/Sdk/ndk/$ANDROID_NDK_VERSION" \
npx tauri android build --debug --apk --target aarch64
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
(~130 MB debug; a release build strips the Rust lib and is much smaller).

Install on a device (USB debugging on): `adb install -r <apk>`. A newer APK
with the **same signature** installs over the old one and keeps the on-device
database; `-r` is the reinstall flag. Or copy the APK to the phone (e.g. via a
synced folder) and tap it, allowing "install from unknown sources".

Android-specific pieces (already wired in `src-tauri/gen/android`, which is
committed; build outputs and the engine `.so` stay gitignored):

- **Engine**: Stockfish ships per ABI as
  `app/src/main/jniLibs/<abi>/libstockfish.so` (arm64 today). CI stages it
  automatically by compiling the centrally pinned Stockfish commit with the
  pinned NDK and ELF alignment. For a **local** build,
  `scripts/build-stockfish-android.ps1` performs the identical source build and
  verifies the NNUE checksums. `resolve_engine`
  (`src-tauri/src/lib.rs`) finds it in the app's `nativeLibraryDir` via
  `/proc/self/maps`.
- **Native lib packaging**: `useLegacyPackaging = true` in
  `app/build.gradle.kts` sets `extractNativeLibs`, so the engine `.so` is
  unpacked as a real, executable file — required to launch it as a UCI child
  process (and it shrinks the APK).
- **Config**: `src-tauri/tauri.android.conf.json` drops the desktop
  `stockfish.exe` resource and the updater artifacts from the mobile bundle.
  `src-tauri/tauri.play.conf.json` additionally removes the external updater
  endpoint from the Google Play flavor.

CI now builds a **signed** arm64 release APK on every tagged release and attaches
it to the GitHub release (see *Releasing a new version* → *One-time setup* for the
keystore secrets). The release script builds and verifies the signed Google Play
AAB locally as part of the release. To build only the AAB, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-play-aab.ps1
```

The script securely prompts for the existing release-keystore password, builds
Stockfish with 16-KB alignment, enables the Rust `play-store` feature, merges
`tauri.play.conf.json`, signs the AAB, and verifies package
`de.torim.kiebitz`, target API 36, permissions, updater removal, signature and
every native ELF file. Output:
`artifacts/Kiebitz_<version>_play_arm64.aab`.

The Play flavor deliberately has no external APK update path and no exact-alarm
permission. Updates are handled by Google Play; reminders use inexact scheduling.
The published Android artifacts currently target arm64 only. Adding further
ABIs requires matching Rust and Stockfish builds plus a multi-ABI packaging and
verification pass.

### Play Console: the two edge-to-edge advisories

The Play Console shows two recommended actions for Kiebitz. Both were checked
against the build; neither is a defect in this app, and the second one cannot
be resolved at all. Keep this section so the next look at that page is short.

**"Edge-to-edge may not display for all users."** Already handled.
`MainActivity.onCreate` calls `enableEdgeToEdge()` before `super`, the WebView
carries `viewport-fit=cover` (`index.html`), and the surfaces that meet a
system bar pad themselves from `env(safe-area-inset-*)`: the app bar and the
bottom navigation top and bottom, the navigation rail and the content column
left and right (`src/index.css`, `src/App.tsx`,
`src/components/MobileShell.tsx`). `SystemBarsPlugin` only decides whether the
bar *symbols* are drawn dark or light, following the chosen theme rather than
the device's night mode.

**"Your app uses deprecated APIs or parameters for edge-to-edge."** Not our
code, and not fixable from here. The advisory lists five call sites in the
obfuscated release build — `d.o.b`, `d.p.b`, `d.r.b`, `d.t.b` and `a2.b.u`.
Resolved through the R8 mapping file
(`src-tauri/gen/android/app/build/outputs/mapping/universalRelease/mapping.txt`)
they are:

| Site   | Class                                        |
| ------ | -------------------------------------------- |
| `d.o`  | `androidx.activity.EdgeToEdgeApi23`           |
| `d.p`  | `androidx.activity.EdgeToEdgeApi26`           |
| `d.r`  | `androidx.activity.EdgeToEdgeApi29`           |
| `d.t`  | `androidx.activity.EdgeToEdgeApi35`           |
| `a2.b` | an R8 API-model outline for `WindowManager.LayoutParams` |

That is `androidx.activity`'s own backward-compatibility code — the very
`enableEdgeToEdge()` the first advisory recommends. It sets
`statusBarColor` / `navigationBarColor` and the short-edges cutout mode on the
API levels where those still do something (Kiebitz's `minSdk` is 24), and skips
them on Android 15 and later. Play's scan is static: it sees the bytecode in the
bundle and cannot tell that the branch never runs on the versions where it is
deprecated. Removing it would mean dropping `androidx.activity` or raising
`minSdk` to 35 — both far worse than an advisory. Recheck after an
`androidx.activity` update; nothing else to do.

To redo this analysis after a release, resolve the reported names in the
mapping file of the build that was uploaded:

```sh
grep -E "^.* -> d\.(o|p|r|t):$" src-tauri/gen/android/app/build/outputs/mapping/universalRelease/mapping.txt
```

## Third-party license notices

MIT, BSD and ISC require their license text and copyright notice to accompany
the distributed binary — having them in the repository is not enough. The full
texts of every shipped npm package and Rust crate are therefore generated into
one resource and bundled on both platforms:

```sh
npm run licenses         # regenerate after any dependency change
npm run licenses:check   # verify it matches the dependency set (runs in CI)
```

Output: `src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt` (~410 KB, ~650
components). It is **committed**, so every build has it without extra tooling,
and the `licenses` job in `ci.yml` fails if it drifts from the dependency set.

The generator takes the npm production tree from `package-lock.json` (`dev: true`
entries are skipped — they are not distributed) and the Rust graph from `cargo
metadata`, then reads each component's own license file, falling back to the text
of another component under the same license plus that component's own copyright
line. It deliberately uses no external tooling: everything it needs is already in
`node_modules` and the Cargo registry cache, so the CI check needs no build.

In the app the texts are reachable under **Settings → About Kiebitz → Licenses &
notices** (`src-tauri/src/legal.rs`, `src/lib/legal.ts`); the same place also
shows the Stockfish notice and the GPL-3.0 text. When adding a document there,
add it to `DOCS` in `legal.rs` **and** to `bundle.resources` in both
`tauri.conf.json` and `tauri.android.conf.json` — a Rust test fails if a declared
document is missing from the repository, but nothing catches a missing bundle
entry except an installed build.

> **Keep the link graph copyleft-free.** Everything linked into Kiebitz is
> permissively licensed; a GPL/LGPL crate would override the terms in `LICENSE`.
> The generated file surfaces each component's license, so check it after adding
> a dependency — that is how the `shakmaty` conflict was found.

## Icons

App icons for **all** targets — desktop (`.ico`/`.icns`/`.png`), iOS, and the
Android launcher (`gen/android/.../res/mipmap-*`) — are generated from a single
source and committed. To regenerate after changing the artwork:

```sh
npx tauri icon src-tauri/icons/source-icon.png
```

This is Android-aware when `gen/android` exists and writes the launcher icons
there too. Two things must be re-applied after regenerating, because `tauri icon`
overwrites them:

- **Adaptive background** — `tauri icon` sets it to white; for Kiebitz it must be
  the dark green `#103528` in
  `gen/android/app/src/main/res/values/ic_launcher_background.xml` (otherwise
  square-mask launchers show white corners).
- **Adaptive foreground scale** — `tauri icon` bleeds the whole source to the
  foreground edge, which square-mask launchers zoom in so the bird looks far too
  large. The committed `ic_launcher_foreground.png` (all densities, in both
  `icons/android/` and `gen/android/.../mipmap-*`) are instead the source tile
  scaled to ~88 % of the 108 dp canvas on a transparent background, so the bird
  keeps its desktop proportion inside the adaptive safe zone. Regenerate with a
  short script rather than by hand — for each density canvas `N` (mdpi 108 →
  xxxhdpi 432), paste `source-icon.png` resized to `round(N*0.88)` centred on a
  transparent `N×N` image.

## Code signing & notarization

Two different signatures are easy to confuse:

- The **updater signature** (`TAURI_SIGNING_PRIVATE_KEY`) proves an update comes
  from this project. It is set up and covers all three desktop platforms — see
  *Auto-update* below.
- The **OS code signature** proves the installer to the operating system. It is
  **not** set up on any platform, so every download triggers a warning.

State per platform, and what it would take:

- **Windows**: SmartScreen shows "unknown publisher". A code-signing
  certificate (OV, from ~150 €/year; EV clears the reputation hurdle
  immediately) configured via `bundle.windows.certificateThumbprint` or signed
  in CI would remove it. It would also settle the Defender problem below.
- **macOS**: the release builds are **unsigned and not notarized**, so Gatekeeper
  refuses a double-click. Users open the app once via right-click → *Open*, or
  clear the quarantine flag:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Kiebitz.app
  ```

  Removing that step needs an Apple Developer Program membership (99 $/year).
  With it, add `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` as
  repository secrets and pass them into the `tauri-action` step of the `desktop`
  job — tauri-action signs and notarizes on its own once they are present, and
  no other change is needed.
- **Linux**: no signing mechanism to speak of; AppImage, `.deb` and `.rpm` are
  distributed as they are.

For private/personal use you can skip signing and dismiss the warnings.

### Windows Defender: `Behavior:Win32/Persistence.A!ml`

On 29.08.2026 Defender quarantined `%LOCALAPPDATA%\Kiebitz\kiebitz.exe`, the
Start-menu/taskbar/desktop shortcuts and the scheduled task
`Kiebitz Trainings-Erinnerung` on the developer machine. Nothing was infected —
this is a behavioural (`!ml`) verdict, not a signature match, and it fires on a
*combination* rather than on any one thing:

1. the binary is **unsigned** and has **no SmartScreen reputation** (few
   downloads, new hash on every release), and
2. it lives in `%LOCALAPPDATA%` rather than `Program Files` (Tauri's NSIS
   default is a per-user install), and
3. it used to spawn, hidden (`CREATE_NO_WINDOW`) and on **every single start**,
   `reg.exe` twice → `schtasks.exe /Delete` → `schtasks.exe /Create` →
   `powershell.exe`, ending in an autostart entry that points back at itself.

Point 3 is the textbook shape of a dropper installing persistence, and it is
the only part that is ours to fix. `reminder.rs` no longer does any of it:

- the AppUserModelID goes in through the registry API (`windows-registry`),
  not through two hidden `reg.exe` children;
- the scheduled task is registered from a task XML in a single
  `schtasks /Create /XML /F` — no separate `/Delete`, and **no PowerShell**;
  the battery/wake settings that PowerShell used to patch in afterwards are in
  the XML;
- `reminder-schedule.json` next to the settings records what was applied, so an
  unchanged installation touches the Task Scheduler at most **once a week**
  (`SCHEDULE_RECHECK_SECS`) instead of five times per launch. The weekly
  re-check is what brings the task back if a scanner removed it.

That leaves an ordinary app registering one daily task. What it cannot fix is
points 1 and 2 — the real remedies, in order of effect:

1. **Sign the binaries** (see above). An EV certificate also clears
   SmartScreen immediately.
2. **Report the false positive** to Microsoft at
   <https://www.microsoft.com/en-us/wdsi/filesubmission> (category *Software
   developer*, "Incorrectly detected as malware"). Turnaround is usually a day
   or two and the verdict propagates to all users, so do this for any release
   that gets flagged. Restore the file locally first (Windows Security →
   *Protection history* → *Allow on device*) so you can submit it.
3. Optionally set `bundle.windows.nsis.installMode` to `both` so users can
   install into `Program Files`; that path carries far more trust than
   `%LOCALAPPDATA%`. It costs an elevation prompt during install.

If it happens again, check *Protection history* for **which** process tree was
flagged before assuming it is this one — it names the exact child process.

### iOS

There is no iOS build and none is planned. Kiebitz runs Stockfish as a **child
process** over UCI (`engine.rs`), which iOS forbids outright — an iOS port would
have to link the engine in-process behind an FFI layer and reimplement the whole
engine plumbing alongside the existing one. It also requires an Apple Developer
Program membership. `ROADMAP.md` records the same conclusion.

## User data location

The SQLite database (`kiebitz.db`) is created in the OS app-data directory on
first launch, **separate from the installed program** so updates never touch it:

- Windows: `%APPDATA%\de.torim.kiebitz\kiebitz.db`
- macOS: `~/Library/Application Support/de.torim.kiebitz/kiebitz.db`
- Linux: `~/.local/share/de.torim.kiebitz/kiebitz.db`

Settings can move the active database to another location, select an existing
database, and create or restore backups. The paths above therefore describe the
default location; **Settings → Database** shows the active path. Backing up the
app means backing up that active SQLite file or using the built-in backup.

## Releasing a new version (the comfortable way)

A GitHub Actions workflow (`.github/workflows/release.yml`) does the whole
release for you. The checked-in PowerShell command **is the only command you
need to run locally**: it verifies the working tree and version, runs the test
suite, updates all version files, commits, creates an annotated tag, and pushes
`main` plus the tag. Pushing the tag starts the CI workflow.

> **Scope:** pushing a tag builds four platforms and attaches everything to the
> same GitHub release:
>
> | Platform | Artifacts | Auto-update |
> | --- | --- | --- |
> | Windows x64 | `.exe` (NSIS), `.msi` | yes |
> | macOS arm64 | `.dmg`, `.app.tar.gz` | yes |
> | Linux x64 | `.AppImage`, `.deb`, `.rpm` | AppImage only |
> | Android arm64 | `Kiebitz_<version>_arm64.apk` | no (sideload) |
>
> Where auto-update says no, the reason differs. On Linux the Tauri updater
> supports only the AppImage; `.deb` and `.rpm` belong to the package manager,
> which for a manually installed file means updating by hand. Android is for
> manual/sideload install, and a newer APK installs over the old one (keeping the
> on-device DB) only because CI signs every build with the **same** keystore. The
> Android job runs only once the keystore secret is set (see *One-time setup*);
> until then it is skipped and the desktop release is unaffected.
>
> macOS builds are **unsigned and not notarized** — see *Code signing &
> notarization* for what users have to do on first start, and for the secrets
> that would remove that step. macOS is Apple Silicon only; Intel Macs would
> need a second matrix entry on an Intel runner with `ARCH=x86-64-avx2` for
> Stockfish, or a universal binary built from both slices via `lipo`.

### One-time setup

**Desktop updater key.** Add the updater's **private signing key** as a
repository secret named `TAURI_SIGNING_PRIVATE_KEY` (the workflow reads it; the
key has no password, so no second secret is needed). From the repo root, with
the GitHub CLI:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/kiebitz.key"
# Windows path: C:\Users\tomma\.tauri\kiebitz.key
```

Or paste the file's contents under **GitHub → Settings → Secrets and variables
→ Actions → New repository secret**. That's it for the desktop app — endpoint,
public key, and workflow are already committed.

**Android signing keystore.** This is a **separate** credential from the updater
key above: the updater key (minisign) only verifies desktop *update manifests*;
Android needs a Java **keystore** for `apksigner` to sign the APK itself — the
two are different formats and cannot be substituted for each other. Because this
repo is **public**, the keystore must live in **secrets**, never committed.

Create the keystore once with `keytool` — **back it up**, losing it means new
APKs can no longer install over old ones without uninstalling. `keytool` ships
inside any JDK; it is only needed for this one step (CI brings its own JDK for
the actual build). If you don't have a JDK on the machine, install one first.

**macOS / Linux** (keytool on `PATH`):

```sh
keytool -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Kiebitz, O=Torim, C=DE"
# choose a store password when prompted; press Enter at the key password to reuse it
```

**Windows (PowerShell).** There is no standalone `keytool` — install a JDK, then
call `keytool` by its full path (a fresh shell is not even required this way):

```powershell
winget install EclipseAdoptium.Temurin.17.JDK
# resolves keytool.exe regardless of the exact patch version installed:
$kt = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\keytool.exe" | Select-Object -First 1).FullName
& $kt -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kiebitz, O=Torim, C=DE"
# choose a store password; press Enter at the key password to reuse it
```

> Don't rely on `$env:JAVA_HOME` for this — a stale or unset value gives a
> confusing "not recognized as ... program" error even though the path looks
> right. The `Get-ChildItem` resolver above sidesteps it.

> **PKCS12 keystores (keytool's default since JDK 9) use one password** — the
> store and key password must be **identical**. If `ANDROID_KEY_PASSWORD` differs
> from `ANDROID_KEYSTORE_PASSWORD`, the signing step fails with `Get Key failed:
> Given final block not properly padded`. Set both secrets to the same value. The
> most robust way (no mismatch, no echo) is to capture the password once and feed
> everything from it — see the atomic PowerShell block below.

<details>
<summary>Atomic, mismatch-proof setup (PowerShell) — recommended</summary>

Creates the keystore and sets all four secrets from a single password entered
once (never echoed, never on the command line as a literal):

```powershell
$sec = Read-Host "Keystore password" -AsSecureString
$PW  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

Remove-Item .\kiebitz-release.jks -ErrorAction SilentlyContinue
$kt = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\keytool.exe" | Select-Object -First 1).FullName
& $kt -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kiebitz, O=Torim, C=DE" -storepass $PW -keypass $PW

[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\kiebitz-release.jks))) | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEY_ALIAS -b kiebitz
$PW | gh secret set ANDROID_KEYSTORE_PASSWORD
$PW | gh secret set ANDROID_KEY_PASSWORD
```

</details>

Then set four repository secrets. The keystore is binary, so base64-encode it
(`gh` reads the encoded value from the pipe; CI decodes it with `base64 -d`):

```sh
# macOS / Linux
base64 -w0 kiebitz-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
```

```powershell
# Windows (PowerShell) — produces single-line base64, compatible with base64 -d
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\kiebitz-release.jks))) | gh secret set ANDROID_KEYSTORE_BASE64
```

The remaining three are plain strings — `gh` prompts for each value:

```sh
gh secret set ANDROID_KEYSTORE_PASSWORD   # the store password from above
gh secret set ANDROID_KEY_ALIAS           # kiebitz
gh secret set ANDROID_KEY_PASSWORD        # the key password (= store password if you pressed Enter)
```

Once `ANDROID_KEYSTORE_BASE64` exists, the next tagged release also builds and
attaches the APK. Keep the `.jks` file (and its passwords) somewhere safe and
out of the repo.

### Every release — one command

From a clean, current `main` branch run (use the desired, strictly higher
semantic version):

```powershell
.\scripts\release.ps1 -Version X.Y.Z
```

The command runs the frontend build, frontend tests, and Rust tests first. Only
after all checks pass does it update `package.json`, `package-lock.json`, and
`src-tauri/tauri.conf.json`, prompt for the Android release-keystore password,
build and verify `artifacts/Kiebitz_<version>_play_arm64.aab`, create the release
commit and annotated tag, then push both `main` and that tag. A failed Play build
therefore stops the release before commit, tag, or push. The command deliberately
refuses a dirty working tree, a version that is not higher than the current one,
or an existing remote tag.

Then watch **GitHub → Actions**. The release starts with a private draft; the
desktop and Android builds run in parallel and upload their artifacts to it. The
final `publish` job makes the draft public only when both jobs completed
successfully. A failed build therefore leaves a private draft with its logs and
any completed artifacts for diagnosis, rather than publishing a partial release.

> **Tip:** after fixing a failed build, delete the remote and local tag and the
> failed draft release, then run the command again with the same version. If the
> release is already public, use a new, higher version instead.

> **Emergency rollback:** if a published desktop build is broken, mark its
> GitHub release as a pre-release (`gh release edit vX.Y.Z --prerelease`). The
> stable `/releases/latest/` updater feed then falls back to the previous release.
> An Android release can be halted or withdrawn separately in Google Play Console.

### What the workflow handles for you

- **Engine**: on Windows it fetches the pinned official Stockfish archive
  (hash-checked) into `src-tauri/binaries/stockfish.exe`; on macOS and
  Linux it compiles the pinned Stockfish commit itself into
  `src-tauri/binaries/stockfish` (`ARCH=apple-silicon` / `x86-64-avx2`), the
  same way the Android job already does. Either way the binary is gitignored and
  never lives in the repo, and `bundle.resources` ships it inside the installer.
  Since Stockfish 19 the Windows archive is the *universal* one: it detects the
  CPU's features at startup and picks the matching code path, so there is no
  longer an AVX2 floor to work around there. macOS and Linux still build for one
  target — change the `ARCH` value in the workflow for older CPUs.
- **Signing**: passes `TAURI_SIGNING_PRIVATE_KEY`, so `.sig` files and
  `latest.json` are produced and uploaded automatically. This is the *updater*
  signature, not an OS code signature — see *Code signing & notarization*.
- **Release orchestration**: `prepare-release` creates (or reuses) a private
  draft and writes the release notes. `desktop`, `android` and
  `stockfish-source` all depend only on that small setup job, so they run in
  parallel. The three legs inside the desktop matrix run in parallel as well.
  `updater-manifest` waits for all desktop legs and creates their shared
  `latest.json` once; `publish` publishes the draft only after that and the
  Android/source jobs have succeeded.
- **GPL source (`stockfish-source` job)**: fetches the pinned Stockfish commit
  with `git` — which validates the tree against the commit hash intrinsically,
  unlike a SHA-256 over GitHub's generated archives, which are not byte-stable —
  and uploads `git archive`'s tarball as
  generated `stockfish-<version>-source-<short-commit>.tar.gz` (~250 KB). The filename carries the
  **commit**, not the Kiebitz version, so the `/releases/latest/download/` URL
  quoted in `NOTICE.txt` stays valid across releases. Because `publish` needs
  this job, no public release can ever ship the engine binary without its source.
- **Android**: a second job (`android`, on `ubuntu-latest`) sets up the JDK, the
  centrally pinned Android SDK/NDK and the `aarch64-linux-android` Rust target,
  compiles the pinned Stockfish commit into `jniLibs/arm64-v8a/` with the pinned
  ELF alignment and verified NNUE networks,
  restores the keystore from the secrets, builds a signed release APK
  (`tauri android build --apk --target aarch64`), and uploads
  `Kiebitz_<version>_arm64.apk` to the draft release. Without the keystore
  secret the job skips cleanly, leaving the desktop release green.
- **Linux runner pin**: `ubuntu-22.04`, not `ubuntu-latest`. An AppImage binds
  the glibc of the machine that built it, so building on the oldest supported
  runner keeps the result usable on older distributions.

### The AppImage on a black screen

```text
Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
```

Reported from CachyOS, and not a Kiebitz bug: WebKitGTK's DMA-BUF renderer
needs the host's EGL stack and the GTK/WebKit libraries carried inside the
AppImage to agree. A newer Mesa, the proprietary NVIDIA driver or a Wayland
session without a matching render node breaks that, WebKit fails to get an EGL
display and kills its web process — the window opens, stays black, and only
the window menu still answers.

`calm_webkit()` in `src-tauri/src/lib.rs` therefore sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup on Linux, before the first
window exists, unless the environment already says otherwise. The webview then
draws over the older, portable path — invisible on a page made of chessboards
and diagrams.

Two things left for a user who still sees a black window:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./Kiebitz_*.AppImage
```

and, on a hybrid-graphics machine, running it on the integrated GPU
(`__GLX_VENDOR_LIBRARY_NAME=mesa`). Where neither helps, the `.deb`/`.rpm`
builds use the system's own WebKitGTK and sidestep the mismatch entirely.

## Auto-update

The updater plugin (`tauri-plugin-updater`) is wired up for desktop. Behavior in
the app:

- **On startup** (if enabled in Settings → Updates, default on): a background
  task checks the endpoint, downloads and installs a newer version, and restarts
  the app. A toast announces the download/restart; failures (offline, no release
  yet) are only logged.
- **Manually**: Settings → Updates has a "check now" button and an explicit
  "download & restart" action, independent of the toggle.
- **Android sideload flavor**: the same button reads the version from
  `latest.json` and opens the matching signed arm64 APK from the GitHub release.
  Android requires the user to confirm the sideloaded update.
- **Google Play flavor**: contains neither that endpoint nor an external APK
  installer. The Settings page points users to Google Play, which owns updates.

The pieces that make it work:

- **Endpoint**: `https://github.com/kiebitz-dev/Kiebitz/releases/latest/download/latest.json`
  (`tauri.conf.json` → `plugins.updater.endpoints`). Each release must attach a
  `latest.json` manifest plus the updater artifacts.
- **Signing key pair**: updates are signed (independent of OS code signing).
  - Private key: `C:\Users\tomma\.tauri\kiebitz.key` (no password, **not** in the
    repo — losing it means users must reinstall manually, so back it up).
  - Public key: embedded in `tauri.conf.json` → `plugins.updater.pubkey`.
- **Build**: `bundle.createUpdaterArtifacts: true` makes `tauri build` produce
  `.sig` files next to the installers. Signing requires the env var
  `TAURI_SIGNING_PRIVATE_KEY_PATH` (or `TAURI_SIGNING_PRIVATE_KEY` with the key
  contents — use that one as a CI secret):

  ```sh
  TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kiebitz.key npm run tauri build
  ```

- **Manifest**: the release workflow (see *Releasing a new version*) generates
  and uploads `latest.json` for you — this is the normal path. The updater only
  offers versions greater than the installed one, so publishing a release is all
  it takes to roll everyone forward. One `latest.json` serves every platform;
  after all three parallel desktop builds, `updater-manifest` writes their keys
  (`windows-x86_64`, `darwin-aarch64`, `linux-x86_64`) in one step.
- **Linux caveat**: the updater installs AppImage updates only. A `.deb` or
  `.rpm` install finds no matching entry and reports that it is up to date;
  those users update by downloading the next release. Nothing breaks, but say so
  on the download page rather than letting people wait for an update that never
  comes.

  <details>
  <summary>Manual manifest (fallback, only if you build without CI)</summary>

  ```json
  {
    "version": "0.2.0",
    "notes": "What changed",
    "pub_date": "2026-07-16T12:00:00Z",
    "platforms": {
      "windows-x86_64": {
        "signature": "<contents of the .sig file>",
        "url": "https://github.com/kiebitz-dev/Kiebitz/releases/download/v0.2.0/Kiebitz_0.2.0_x64-setup.exe"
      }
    }
  }
  ```

  Attach it (plus installer and `.sig`) to the GitHub release yourself.
  </details>

## Release checklist

The automated flow (see *Releasing a new version*) is the short version of this:

1. On a clean `main`, run `.\scripts\release.ps1 -Version X.Y.Z`.
2. Wait for the GitHub Actions run to finish, including the final `publish` job.
   The three desktop legs run at the same time when GitHub-hosted runners are
   available; the final manifest job starts after all three have finished.
3. Smoke-test: install the new release (or let an existing copy auto-update),
   import games, run a live analysis, confirm the database is untouched in the
   app-data directory.
4. Check `latest.json` on the published release: it must list all three desktop
   platforms (`windows-x86_64`, `darwin-aarch64`, `linux-x86_64`). A missing key
   means that platform silently stops receiving updates.

Doing it by hand instead (no CI): build with
`TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kiebitz.key npm run tauri build`, sign /
notarize if distributing publicly, then create the tag and attach the installer,
`.sig`, and `latest.json` to the release yourself.
