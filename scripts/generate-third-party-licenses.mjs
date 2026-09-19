#!/usr/bin/env node
/**
 * Sammelt die Lizenztexte aller *ausgelieferten* npm- und Cargo-Abhängigkeiten
 * in eine einzige gebündelte Ressource.
 *
 * Warum: MIT, BSD und ISC verlangen, dass Lizenztext und Copyright-Hinweis das
 * Binary begleiten. Kiebitz bündelte bisher nur die Stockfish-Notices (die
 * bleiben separat, weil GPL-3.0 dort zusätzlich ein Quellcode-Angebot braucht).
 *
 *   node scripts/generate-third-party-licenses.mjs           # Datei schreiben
 *   node scripts/generate-third-party-licenses.mjs --check    # nur prüfen (CI)
 *
 * Bewusst ohne externe Tools (license-checker / cargo-about): alle Daten liegen
 * schon auf der Platte — in node_modules und im Cargo-Registry-Cache. Das hält
 * den Check in CI schnell und offline-fähig.
 *
 * Die Ausgabe enthält *kein* Datum, damit --check ein reiner Inhaltsvergleich
 * bleibt und nicht bei jedem Lauf anschlägt.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "resources", "licenses", "THIRD_PARTY_LICENSES.txt");
const CHECK = process.argv.includes("--check");

/**
 * Bei Oder-Verknüpfungen ("MIT OR Apache-2.0") wird eine Lizenz gewählt. Die
 * Reihenfolge bevorzugt die knappen, permissiven Texte — üblich und für den
 * Empfänger die geringste Auflage.
 */
const PREFERENCE = [
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Zlib",
  "Apache-2.0",
  "Unlicense",
  "MPL-2.0",
  "Unicode-3.0",
  "CC0-1.0",
  "OFL-1.1",
];

/**
 * Löst einen SPDX-Ausdruck in die Liste der Lizenzen auf, deren Text
 * mitgeliefert werden muss.
 *
 * AND ist kumulativ — "MIT AND ISC" verlangt *beide* Texte. OR ist eine Wahl,
 * dort entscheidet PREFERENCE. Eine WITH-Ausnahme wird auf ihre Grundlizenz
 * reduziert, deren Text den Ausnahmehinweis ohnehin enthält.
 */
function requiredLicenses(expr) {
  if (!expr) return [];
  return expr
    .replace(/[()]/g, " ")
    .split(/\s+AND\s+/i)
    .map((term) => {
      const options = term
        .split(/\s+OR\s+|\//i)
        .map((part) => part.trim().replace(/\s+WITH\s+.*$/i, "").trim())
        .filter(Boolean);
      if (!options.length) return null;
      for (const preferred of PREFERENCE) {
        if (options.some((option) => option.toLowerCase() === preferred.toLowerCase())) {
          return preferred;
        }
      }
      return options[0];
    })
    .filter(Boolean);
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-_.].*)?$/i;

/**
 * Lizenzdateien eines Paketverzeichnisses, die zur gewählten Lizenz passen.
 * Pakete mit Doppellizenz legen typischerweise LICENSE-MIT und LICENSE-APACHE
 * ab; dann darf nur der Text der gewählten Lizenz übernommen werden.
 */
function readLicenseText(dir, spdx) {
  if (!dir || !existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name.replace(/\.(txt|md)$/i, "")))
    .map((entry) => entry.name);
  if (!candidates.length) return null;

  const token = (spdx ?? "").split("-")[0].toLowerCase(); // MIT, Apache, ISC, BSD …
  const matching = candidates.filter((name) => name.toLowerCase().includes(token));
  const generic = candidates.filter((name) => !/[-_](mit|apache|zlib|isc|bsd)/i.test(name));
  const pick = matching[0] ?? generic[0] ?? candidates[0];

  try {
    const text = readFileSync(join(dir, pick), "utf8").replace(/\r\n/g, "\n").trim();
    return text.length > 40 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Trennt die Copyright-Zeilen vom Lizenzrumpf. Damit lässt sich der bei MIT/ISC
 * identische Rumpf einmal ausgeben und die Rechteinhaber je Paket auflisten,
 * statt denselben Text hundertfach zu wiederholen.
 */
function splitCopyright(text) {
  const lines = text.split("\n");
  const holders = [];
  const isCopyright = (line) => /^(copyright|\(c\)|©)/i.test(line);
  // Überschrift ("MIT License", "The ISC License (ISC)", Unterstreichungen) —
  // sie steht oft *vor* der Copyright-Zeile. Würde sie den Vorlauf beenden,
  // landete das Copyright im Rumpf und jedes Paket bekäme einen eigenen Block.
  const isHeading = (line) =>
    /^[=~-]{3,}$/.test(line) ||
    /^(the\s+)?(mit|isc|apache|bsd|zlib|zlib\/libpng|boost software|mozilla public)\b[^.]{0,40}licen[cs]e\b/i.test(
      line,
    ) ||
    /^licen[cs]e\b.{0,30}$/i.test(line);

  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || isHeading(line) || /^all rights reserved\.?$/i.test(line)) {
      index += 1;
      continue;
    }
    if (isCopyright(line)) {
      holders.push(line.replace(/[.,;]\s*$/, ""));
      index += 1;
      // Fortsetzungszeilen einer Copyright-Angabe (weitere Jahre/Inhaber)
      // gehören dazu, aber nicht der beginnende Lizenztext.
      while (index < lines.length && isCopyright(lines[index].trim())) {
        holders.push(lines[index].trim().replace(/[.,;]\s*$/, ""));
        index += 1;
      }
      continue;
    }
    break;
  }
  return { holders, body: lines.slice(index).join("\n").trim() };
}

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function personName(value) {
  if (!value) return null;
  if (typeof value === "string") return value.replace(/\s*<[^>]*>/g, "").trim() || null;
  if (typeof value === "object" && value.name) return String(value.name).trim();
  return null;
}

function repoUrl(pkg) {
  const repository = pkg.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  return (url ?? pkg.homepage ?? "")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .trim() || null;
}

// ── npm ─────────────────────────────────────────────────────────────────────

function collectNpm() {
  // Quelle ist das Lockfile, nicht `npm ls`: es benennt jedes Paket samt Pfad
  // und markiert die reinen Dev-Abhängigkeiten. Die werden nicht ausgeliefert
  // und lösen deshalb keine Weitergabepflicht aus. Ohne Subprozess bleibt der
  // Lauf schnell und offline — und Node 24 verbietet das Starten von npm.cmd
  // ohne Shell ohnehin.
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  if (!lock.packages) {
    throw new Error("package-lock.json ohne 'packages' — lockfileVersion 2 oder 3 erwartet.");
  }

  const entries = Object.entries(lock.packages)
    // "" ist Kiebitz selbst; `dev: true` heißt ausschließlich Dev-Baum.
    // `devOptional` bleibt drin: solche Pakete können im Release landen.
    .filter(([key, entry]) => key && !entry.dev && !entry.extraneous);

  const packages = [];
  for (const [key, locked] of entries) {
    const dir = join(ROOT, key);
    const manifest = join(dir, "package.json");
    // Nicht installiert (z. B. ein optionales Paket für eine andere Plattform):
    // trotzdem aufführen, damit die Ausgabe unabhängig davon bleibt, auf
    // welchem Betriebssystem sie erzeugt wurde. Der Lizenztext kommt dann aus
    // dem Pool derselben Lizenz statt aus der Paketdatei.
    let pkg = null;
    if (existsSync(manifest)) {
      try {
        pkg = JSON.parse(readFileSync(manifest, "utf8"));
      } catch {
        pkg = null;
      }
    }
    const declared =
      pkg?.license ??
      (Array.isArray(pkg?.licenses) ? pkg.licenses.map((l) => l.type ?? l).join(" OR ") : null) ??
      locked.license ??
      null;
    packages.push({
      ecosystem: "npm",
      name: pkg?.name ?? key.replace(/^(.*\/)?node_modules\//, ""),
      version: pkg?.version ?? locked.version ?? "?",
      declared,
      spdxList: requiredLicenses(declared),
      dir: pkg ? dir : null,
      author: personName(pkg?.author),
      repository: pkg ? repoUrl(pkg) : null,
    });
  }
  return packages;
}

// ── Cargo ───────────────────────────────────────────────────────────────────

function collectCargo() {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1"], {
    cwd: join(ROOT, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const meta = JSON.parse(raw);
  const rootNames = new Set(
    (meta.workspace_members ?? []).map((id) => {
      const pkg = meta.packages.find((candidate) => candidate.id === id);
      return pkg?.name;
    }),
  );

  const packages = [];
  for (const pkg of meta.packages) {
    if (rootNames.has(pkg.name)) continue;
    // cargo metadata listet plattformfremde und optionale Crates mit; die
    // Übererfassung ist gewollt — zu viel nennen ist unschädlich, zu wenig nicht.
    packages.push({
      ecosystem: "cargo",
      name: pkg.name,
      version: pkg.version,
      declared: pkg.license ?? null,
      spdxList: requiredLicenses(pkg.license),
      dir: pkg.manifest_path ? dirname(pkg.manifest_path) : null,
      author: (pkg.authors ?? []).map(personName).filter(Boolean)[0] ?? null,
      repository: pkg.repository ?? pkg.homepage ?? null,
      licenseFileHint: pkg.license_file ?? null,
    });
  }
  return packages;
}

// ── Portierter Quelltext ────────────────────────────────────────────────────

/**
 * Code, der nicht als Paket kommt, sondern übertragen im eigenen Quelltext
 * steht. Er trägt dieselbe Pflicht wie eine Abhängigkeit: Der Lizenztext muss
 * das Binary begleiten. Der Text liegt je Eintrag unter
 * `scripts/ported-licenses/<name>/LICENSE`.
 */
const PORTED = [
  {
    name: "cbh2pgn",
    version: "42b3592",
    declared: "MIT",
    author: "Dominik Klein",
    repository: "https://github.com/asdfjkl/cbh2pgn",
    // Übertragen nach src-tauri/src/cbh.rs: Zugtabellen und Entschleierung
    // des ChessBase-Formats.
  },
];

function collectPorted() {
  return PORTED.map((entry) => ({
    ecosystem: "ported",
    name: entry.name,
    version: entry.version,
    declared: entry.declared,
    spdxList: requiredLicenses(entry.declared),
    dir: join(ROOT, "scripts", "ported-licenses", entry.name),
    author: entry.author,
    repository: entry.repository,
  }));
}

// ── Zusammenbauen ───────────────────────────────────────────────────────────

function build() {
  const packages = [...collectNpm(), ...collectCargo(), ...collectPorted()].sort(
    (a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );

  // Ein Paket kann mehrere Lizenzen erfüllen müssen (AND); jede wird einzeln
  // aufgelöst, weil die Texte in getrennten Dateien liegen.
  const claims = [];
  for (const pkg of packages) {
    const required = pkg.spdxList.length ? pkg.spdxList : [null];
    for (const spdx of required) {
      const text = readLicenseText(pkg.dir, spdx);
      const split = text ? splitCopyright(text) : null;
      claims.push({
        pkg,
        spdx,
        holders: split?.holders ?? [],
        body: split ? split.body || text : null,
      });
    }
  }

  // Gruppierung: gleiche Lizenz + gleicher Rumpf → ein Textblock, viele Pakete.
  const groups = new Map();
  const groupKey = (spdx, body) => `${spdx ?? "custom"}::${hash(normalize(body))}`;
  const unresolved = [];
  for (const claim of claims) {
    if (!claim.body) {
      unresolved.push(claim);
      continue;
    }
    const key = groupKey(claim.spdx, claim.body);
    if (!groups.has(key)) {
      groups.set(key, { spdx: claim.spdx ?? claim.pkg.declared ?? "custom", body: claim.body, members: [] });
    }
    groups.get(key).members.push(claim);
  }

  // Für Pakete ohne eigene Lizenzdatei: den Rumpf derselben Lizenz aus einem
  // Paket übernehmen, das ihn mitliefert, und das eigene Copyright davorsetzen.
  const bodyBySpdx = new Map();
  for (const group of groups.values()) {
    if (!group.spdx) continue;
    const current = bodyBySpdx.get(group.spdx);
    if (!current || group.members.length > current.count) {
      bodyBySpdx.set(group.spdx, { body: group.body, count: group.members.length });
    }
  }
  const missing = [];
  for (const claim of unresolved) {
    const fallback = claim.spdx ? bodyBySpdx.get(claim.spdx) : null;
    const group = fallback ? groups.get(groupKey(claim.spdx, fallback.body)) : null;
    if (group) group.members.push(claim);
    else missing.push(claim);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.spdx.localeCompare(b.spdx) || b.members.length - a.members.length,
  );
  for (const group of ordered) {
    group.members.sort(
      (a, b) => a.pkg.ecosystem.localeCompare(b.pkg.ecosystem) || a.pkg.name.localeCompare(b.pkg.name),
    );
  }

  return { packages, groups: ordered, missing };
}

function render({ packages, groups, missing }) {
  const npm = packages.filter((pkg) => pkg.ecosystem === "npm");
  const cargo = packages.filter((pkg) => pkg.ecosystem === "cargo");
  const ported = packages.filter((pkg) => pkg.ecosystem === "ported");
  const lines = [];
  const rule = (char) => char.repeat(76);

  lines.push("Kiebitz — Third-party licenses");
  lines.push(rule("="));
  lines.push("");
  lines.push(
    [
      "Kiebitz builds on open-source libraries. This file reproduces the license",
      "of every library that ships inside a Kiebitz binary, together with its",
      "copyright notice, as those licenses require.",
      "",
      "Generated by scripts/generate-third-party-licenses.mjs — do not edit by",
      "hand. Run `npm run licenses` after changing dependencies.",
      "",
      "The bundled Stockfish engine is NOT listed here. It is licensed under",
      "GPL-3.0 and covered separately, including a written offer for its",
      "corresponding source, in the Stockfish NOTICE.txt and COPYING.txt files",
      "shipped alongside this one.",
      "",
      "Where a library offers a choice of licenses, one has been selected; the",
      "full set it was offered under is shown as \"offered\".",
    ].join("\n"),
  );
  lines.push("");
  lines.push(
    `Components: ${npm.length} npm packages, ${cargo.length} Rust crates, ${ported.length} ported source file(s).`,
  );
  lines.push("");
  lines.push("");

  lines.push(rule("="));
  lines.push("INDEX");
  lines.push(rule("="));
  for (const [label, list] of [
    ["npm packages", npm],
    ["Rust crates", cargo],
    ["Ported source code", ported],
  ]) {
    lines.push("");
    lines.push(`${label} (${list.length})`);
    lines.push(rule("-"));
    for (const pkg of list) {
      lines.push(`  ${pkg.name} ${pkg.version} — ${pkg.declared ?? "see below"}`);
    }
  }
  lines.push("");
  lines.push("");

  lines.push(rule("="));
  lines.push("LICENSE TEXTS");
  lines.push(rule("="));
  for (const group of groups) {
    lines.push("");
    lines.push(rule("-"));
    lines.push(group.spdx);
    lines.push(rule("-"));
    lines.push("");
    lines.push("Applies to:");
    for (const { pkg, holders } of group.members) {
      const suffix =
        pkg.declared && pkg.declared !== group.spdx ? `  [offered: ${pkg.declared}]` : "";
      lines.push(`  ${pkg.name} ${pkg.version} (${pkg.ecosystem})${suffix}`);
      const notices = holders.length ? holders : pkg.author ? [`Copyright (c) ${pkg.author}`] : [];
      for (const holder of notices) lines.push(`      ${holder}`);
      if (pkg.repository) lines.push(`      ${pkg.repository}`);
    }
    lines.push("");
    lines.push(group.body);
    lines.push("");
  }

  if (missing.length) {
    lines.push("");
    lines.push(rule("="));
    lines.push("COMPONENTS WITHOUT A RETRIEVABLE LICENSE TEXT");
    lines.push(rule("="));
    lines.push("");
    lines.push(
      [
        "No license text could be located for the following components. They are",
        "listed with the license they declare and where to obtain its text.",
      ].join("\n"),
    );
    lines.push("");
    for (const { pkg, spdx } of missing) {
      lines.push(
        `  ${pkg.name} ${pkg.version} (${pkg.ecosystem}) — ${spdx ?? pkg.declared ?? "license not declared"}`,
      );
      if (pkg.author) lines.push(`      Copyright (c) ${pkg.author}`);
      if (pkg.repository) lines.push(`      ${pkg.repository}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd()}\n`;
}

const result = build();
const rendered = render(result);

if (result.missing.length) {
  console.warn(
    `Warnung: für ${result.missing.length} Komponente(n) wurde kein Lizenztext gefunden ` +
      `(${result.missing.map((pkg) => pkg.name).join(", ")}). Sie sind am Ende der Datei ` +
      `mit Fundstelle aufgeführt.`,
  );
}

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
  if (current === rendered) {
    console.log(`OK — ${OUT.replace(ROOT, ".")} ist aktuell (${result.packages.length} Komponenten).`);
    process.exit(0);
  }
  console.error(
    current === null
      ? `FEHLT: ${OUT.replace(ROOT, ".")} existiert nicht. \`npm run licenses\` ausführen und einchecken.`
      : `VERALTET: ${OUT.replace(ROOT, ".")} passt nicht zu den aktuellen Abhängigkeiten. ` +
        `\`npm run licenses\` ausführen und das Ergebnis einchecken.`,
  );
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, rendered, "utf8");
console.log(
  `${OUT.replace(ROOT, ".")} geschrieben — ${result.packages.length} Komponenten, ` +
    `${result.groups.length} Lizenztexte, ${Math.round(rendered.length / 1024)} KB.`,
);
