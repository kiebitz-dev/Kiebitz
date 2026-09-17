/**
 * Die Idee einer Eröffnung nachschlagen.
 *
 * Der Text steht in `data/openingTheory.ts`; dieses Modul beantwortet nur,
 * *welcher* davon zu einem Eröffnungsnamen gehört. Fehlt einer, kommt `null`
 * zurück, und die Seite zeigt nichts — ein leerer Abschnitt wäre schlechter
 * als keiner.
 *
 * Getrennt von `lib/motivtheorie.ts`, obwohl beide dasselbe tun: Zusammen
 * wiegen die beiden Kataloge rund 190 KB Fließtext, und eine Seite soll nur
 * den laden, den sie zeigt. Die Puzzle-Seite braucht keine Eröffnungen, die
 * Insights brauchen keine Motive.
 */
import { OPENING_THEORY } from "../data/openingTheory";
import { lokal } from "./localText";
import type { Locale } from "./i18n";

/**
 * Wörter, hinter denen ein Eröffnungsname aufhört, Familie zu sein.
 *
 * Dieselbe Liste wie `FAMILY_STOPWORDS` in
 * `src-tauri/src/insights/repertoire_and_formats.rs`. Die Insights gruppieren
 * dort nach Familie, und der Text hier muss zu derselben Familie gehören, die
 * in der Tabelle daneben steht · weicht eine der beiden Regeln ab, erklärt die
 * Seite eine andere Eröffnung als die, die sie auswertet. Der Test in
 * `theorie.test.ts` hält die Fälle fest, an denen das auffiele.
 */
const FAMILIEN_SCHLUSS = new Set([
  "defense",
  "defence",
  "opening",
  "game",
  "gambit",
  "system",
  "attack",
  "countergambit",
  "counter-gambit",
]);

/** Familienname einer Eröffnung · leer, wenn der Name nichts hergibt. */
export function eroeffnungsfamilie(name: string): string {
  const kopf = name.split(/[:,]/)[0]?.trim() ?? "";
  if (!kopf) return "";
  const woerter = kopf.split(/\s+/);
  for (const [index, wort] of woerter.entries()) {
    const schlicht = [...wort]
      .filter((zeichen) => /[\p{L}\p{N}]/u.test(zeichen) || zeichen === "-")
      .join("")
      .toLowerCase();
    if (FAMILIEN_SCHLUSS.has(schlicht)) return woerter.slice(0, index + 1).join(" ");
  }
  // Kein Schlüsselwort („Ruy Lopez", „Réti") · dann ist der Kopf die Familie,
  // aber nicht mehr als vier Wörter.
  return woerter.slice(0, 4).join(" ");
}

export interface Theorie {
  /** Wovon der Text handelt · der Familienname oder der Motivschlüssel. */
  schluessel: string;
  text: string;
}

/**
 * Die Idee hinter einer Eröffnung, gesucht über ihre Familie.
 *
 * Chess.com schreibt „Sicilian Defense Bowdler Attack" ohne Doppelpunkt,
 * Lichess „Sicilian Defense: Bowdler Attack" · der Schnitt hinter „Defense"
 * trifft beide, und genau deshalb geht die Suche über die Familie und nicht
 * über den vollen Namen.
 */
export function eroeffnungsTheorie(name: string | null | undefined, locale: Locale): Theorie | null {
  if (!name) return null;
  const familie = eroeffnungsfamilie(name);
  const eintrag = OPENING_THEORY[familie];
  return eintrag ? { schluessel: familie, text: lokal(eintrag, locale) } : null;
}


/**
 * Die Ideen der gespielten Familien · eine je Familie, in der gegebenen Folge.
 *
 * Die Insights führen eine Familie je Farbe („Sicilian Defense" als Weiß und
 * als Schwarz), die Idee aber ist dieselbe · sie steht deshalb einmal da.
 * Familien ohne Text fallen weg, und mehr als `hoechstens` werden es nicht:
 * Die Liste soll die eigenen Eröffnungen erklären, nicht den Katalog.
 */
export function familienTheorie(
  namen: readonly string[],
  locale: Locale,
  hoechstens = 8
): Theorie[] {
  const gesehen = new Set<string>();
  const liste: Theorie[] = [];
  for (const name of namen) {
    const theorie = eroeffnungsTheorie(name, locale);
    if (!theorie || gesehen.has(theorie.schluessel)) continue;
    gesehen.add(theorie.schluessel);
    liste.push(theorie);
    if (liste.length >= hoechstens) break;
  }
  return liste;
}
