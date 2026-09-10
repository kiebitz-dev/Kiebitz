import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadToolchainPins, pinEnvironment, repoRoot } from "./lib/toolchain-pins.mjs";

const pins = loadToolchainPins();
const values = pinEnvironment(pins);
const consumers = [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "scripts/build-stockfish-android.ps1",
  "scripts/build-play-aab.ps1",
  "src-tauri/gen/android/app/build.gradle.kts",
  "src-tauri/src/lib.rs",
];
const contents = new Map(
  consumers.map((file) => [file, readFileSync(join(repoRoot, file), "utf8")]),
);

const forbiddenPins = [
  pins.stockfish.commit,
  pins.stockfish.windowsArchive.sha256,
  values.STOCKFISH_WINDOWS_URL,
  pins.android.ndk,
];
for (const [file, content] of contents) {
  for (const pin of forbiddenPins) {
    if (content.includes(pin)) {
      throw new Error(`${file} duplicates central toolchain pin: ${pin}`);
    }
  }
}

const requireText = (file, text) => {
  if (!contents.get(file).includes(text)) {
    throw new Error(`${file} does not consume the central pins via: ${text}`);
  }
};

requireText(".github/workflows/ci.yml", "scripts/export-toolchain-pins.mjs --github-env");
requireText(".github/workflows/release.yml", "scripts/export-toolchain-pins.mjs --github-env");
const releaseExports = contents
  .get(".github/workflows/release.yml")
  .match(/scripts\/export-toolchain-pins\.mjs --github-env/g)?.length ?? 0;
if (releaseExports !== 3) {
  throw new Error(`release.yml must load pins in all three consumer jobs (found ${releaseExports})`);
}
requireText("scripts/build-stockfish-android.ps1", "config\\toolchain-pins.json");
requireText("scripts/build-play-aab.ps1", "config\\toolchain-pins.json");
requireText("src-tauri/gen/android/app/build.gradle.kts", "config/toolchain-pins.json");
requireText("src-tauri/src/lib.rs", "KIEBITZ_STOCKFISH_VERSION");

// The dashboard tile names the bundled engine in every language, and that line
// is the one place where the version is spelled out for users instead of being
// substituted. It went stale across two Stockfish releases before this check
// existed, so it is verified here rather than remembered.
const dictionaries = join(repoRoot, "src", "lib", "locales");
const expected = `Stockfish ${pins.stockfish.version} \u00b7 `;
for (const locale of ["de", "en", "es", "fr", "hi", "ar", "zh"]) {
  const file = join(dictionaries, `${locale}.ts`);
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((text) => text.includes('"dash.stockfishNative"'));
  if (!line) throw new Error(`${locale}.ts is missing dash.stockfishNative`);
  if (!line.includes(expected)) {
    throw new Error(
      `src/lib/locales/${locale}.ts names a different Stockfish version than the pins (expected "${expected.trim()}"): ${line.trim()}`,
    );
  }
}

console.log(
  "CI, release, local builds, Gradle, Rust and the dictionaries consume the central toolchain pins.",
);
