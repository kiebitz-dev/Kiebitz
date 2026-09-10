/**
 * Enforces budgets for the assets required before Kiebitz can render.
 * Besides the shell, the default dashboard route is budgeted: it is lazy in
 * the manifest but required for the first useful screen. Optional pages and
 * locales stay outside that startup budget; every JS chunk is still capped.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = join(process.cwd(), "dist");
const assets = join(dist, "assets");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error("Vite manifest contains no entry module");
const dashboard = Object.entries(manifest).find(([key]) =>
  key.replaceAll("\\", "/").endsWith("src/pages/Dashboard.tsx")
)?.[1];
if (!dashboard) throw new Error("Vite manifest contains no Dashboard module");

const limits = {
  // Fest im Startbündel liegt genau ein Wörterbuch: Englisch (siehe
  // lib/locales/registry.ts). Alle sechs anderen — Deutsch eingeschlossen —
  // kommen als eigener Chunk nach. Jede neue Zeile Oberflächentext wächst
  // damit hier nur noch einfach mit statt doppelt.
  //
  // Die Grenzen darunter sind der gemessene Stand plus etwas Luft. Sie sind
  // deutlich enger als vor dem Umstieg auf React 19 und Vite 8, obwohl React
  // selbst rund 40 KiB gewachsen ist: Recharts (rund 330 KiB) hängt seit dem
  // nachgeladenen Ratingverlauf nicht mehr an der Startseite, Erinnerungen und
  // Widget-Momentaufnahmen ebenso wenig, und das deutsche Wörterbuch
  // (rund 106 KiB) trägt nur noch, wer auf Deutsch liest.
  //
  // Entscheidend für die Ladezeit ist `initialGzip`; Fließtext komprimiert gut.
  initialJs: 400 * 1024,
  initialGzip: 132 * 1024,
  // Die beiden Grenzen der Startroute standen zuletzt so dicht am Gemessenen,
  // dass sie nichts mehr prüften, sondern nur noch abwarteten: 445,4 von 450
  // KiB und 149,2 von 150 KiB gzip. Über fünf Veröffentlichungen hinweg wuchs
  // die Route um 0,1 bis 0,2 KiB gzip je Commit — die Grenze wäre also nicht
  // an einem Fehler gerissen, sondern an der nächsten Handvoll Zeilen, und
  // eine Grenze, die das tut, sagt nichts über den Aufwand aus.
  //
  // Jetzt: gemessene 447,2 KiB und 149,9 KiB gzip, dazu je rund zwei Prozent
  // Luft. Dasselbe Verhältnis tragen die vier Grenzen darüber und darunter
  // auch — zwei Prozent sind eng genug, dass ein versehentlich mitgezogenes
  // Paket auffällt, und weit genug, dass ein Absatz Text es nicht tut.
  startupRouteJs: 456 * 1024,
  startupRouteGzip: 153 * 1024,
  singleJs: 450 * 1024,
  // Sieben Farbwelten kosten rund 6 KiB CSS (src/themes.css) · das ist der
  // Preis dafür, dass der Themenwechsel ein Attributwechsel bleibt und kein
  // Nachladen. Der Diagramm-Modus kostet rund 5 KiB obendrauf: den Buchsatz
  // aus src/components/blatt/blatt.css und die Hilfsklassen seiner neun
  // Seitenfassungen. Beides steht im einen Stylesheet, weil Tailwind alles
  // zusammenzieht · geladen wird davon nichts nach.
  //
  // 78 KiB ließen nach den Blätterleisten von Games und GamesBlatt genau
  // 1 Byte Luft und rissen mit dem Blatt der Analyse: Dessen dreispaltiger
  // Satz kostet 11 Regeln (796 Byte), eine alte fällt weg, netto 599 Byte.
  // Allein 448 Byte davon sind die drei `grid-cols-[…]` mit ausgeschriebenen
  // Spaltenmaßen · ein solcher Wert steht zweimal in der Datei, einmal
  // maskiert im Selektor und einmal in der Regel.
  //
  // 80 KiB ließen danach 205 Byte Luft, und die reichten für die nächste
  // Kleinigkeit nicht: `color-scheme` in jeder der acht Farbwelten (die
  // Klapplisten, Rollbalken und Kalender, die kein Stylesheet erreicht),
  // die Fläche der Auswahleinträge im Diagramm-Modus und die Rubrik
  // „Anmerkungen" in den Einstellungen. Gemessen sind es damit 79,8 KiB.
  css: 82 * 1024,
  // Inter deckt die Oberfläche ab (latin + latin-ext, rund 133 KiB).
  //
  // Dazu kommen rund 181 KiB Source Serif 4 für den Diagramm-Modus: aufrecht
  // und kursiv, je latin und latin-ext. Die Kursive ist keine Zugabe —
  // Eröffnungsnamen und Bildunterschriften stehen kursiv, und eine schräg
  // gestellte Aufrechte ist im Buchsatz das Erste, was auffällt; latin-ext
  // trägt die Namen, die die Partien mitbringen.
  //
  // Die Dateien liegen im Paket, aber sie laden nur, wenn der Modus an ist:
  // Die @font-face-Regeln stehen zwar im Stylesheet, ein Browser holt eine
  // Schriftdatei aber erst, wenn ein Zeichen in ihr gesetzt werden soll — und
  // `.buch` gibt es nur im Blatt. Wer den Modus nicht benutzt, lädt keine
  // Serife.
  fonts: 320 * 1024,
};

function collectDependencies(item, files) {
  if (!item || files.has(item.file)) return;
  files.add(item.file);
  for (const imported of item.imports ?? []) collectDependencies(manifest[imported], files);
}
const initialFiles = new Set();
collectDependencies(entry, initialFiles);
const startupRouteFiles = new Set(initialFiles);
collectDependencies(dashboard, startupRouteFiles);

const bytes = (file) => statSync(join(dist, file)).size;
const gzipBytes = (file) => gzipSync(readFileSync(join(dist, file))).length;
const initialJs = [...initialFiles].filter((file) => file.endsWith(".js"));
const initialSize = initialJs.reduce((sum, file) => sum + bytes(file), 0);
const initialGzip = initialJs.reduce((sum, file) => sum + gzipBytes(file), 0);
const startupRouteJs = [...startupRouteFiles].filter((file) => file.endsWith(".js"));
const startupRouteSize = startupRouteJs.reduce((sum, file) => sum + bytes(file), 0);
const startupRouteGzip = startupRouteJs.reduce((sum, file) => sum + gzipBytes(file), 0);
const jsFiles = readdirSync(assets).filter((file) => file.endsWith(".js"));
const cssFiles = readdirSync(assets).filter((file) => file.endsWith(".css"));
const fontFiles = readdirSync(assets).filter((file) => file.endsWith(".woff2"));
const fontSize = fontFiles.reduce((sum, file) => sum + bytes(`assets/${file}`), 0);
const largestJs = jsFiles
  .map((file) => ({ file, size: bytes(`assets/${file}`) }))
  .sort((a, b) => b.size - a.size)[0];
const largestCss = cssFiles
  .map((file) => ({ file, size: bytes(`assets/${file}`) }))
  .sort((a, b) => b.size - a.size)[0];

const kb = (value) => `${(value / 1024).toFixed(1)} KiB`;
const failures = [];
if (initialSize > limits.initialJs) failures.push(`initial JS ${kb(initialSize)} > ${kb(limits.initialJs)}`);
if (initialGzip > limits.initialGzip) failures.push(`initial gzip ${kb(initialGzip)} > ${kb(limits.initialGzip)}`);
if (startupRouteSize > limits.startupRouteJs) failures.push(`startup route JS ${kb(startupRouteSize)} > ${kb(limits.startupRouteJs)}`);
if (startupRouteGzip > limits.startupRouteGzip) failures.push(`startup route gzip ${kb(startupRouteGzip)} > ${kb(limits.startupRouteGzip)}`);
if (largestJs?.size > limits.singleJs) failures.push(`${largestJs.file} ${kb(largestJs.size)} > ${kb(limits.singleJs)}`);
if (largestCss?.size > limits.css) failures.push(`${largestCss.file} ${kb(largestCss.size)} > ${kb(limits.css)}`);
if (fontSize > limits.fonts) failures.push(`fonts ${kb(fontSize)} > ${kb(limits.fonts)}`);

console.log(`Initial JS: ${kb(initialSize)} raw / ${kb(initialGzip)} gzip across ${initialJs.length} chunks`);
console.log(`Startup route JS: ${kb(startupRouteSize)} raw / ${kb(startupRouteGzip)} gzip across ${startupRouteJs.length} chunks`);
console.log(`Largest JS chunk: ${largestJs.file} (${kb(largestJs.size)})`);
console.log(`CSS: ${largestCss.file} (${kb(largestCss.size)})`);
console.log(`Fonts: ${kb(fontSize)} across ${fontFiles.length} files`);
if (failures.length) {
  console.error(`Bundle budget exceeded:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Bundle budget is within limits.");
