/**
 * Die Theorie zu einem Taktikmotiv nachschlagen.
 *
 * Der Text steht in `data/puzzleTheory.ts`. Warum dieses Modul nicht mit den
 * Eröffnungen zusammenliegt, steht in `lib/eroeffnungstheorie.ts`.
 */
import { THEME_THEORY } from "../data/puzzleTheory";
import { lokal } from "./localText";
import type { Locale } from "./i18n";
import type { Theorie } from "./eroeffnungstheorie";

/**
 * Die Theorie zum Motiv einer Aufgabe.
 *
 * Eine Aufgabe trägt mehrere Schlüssel, und nicht jeder ist ein Motiv
 * („middlegame", „short", „crushing"). Genommen wird der erste, zu dem es einen
 * Text gibt — Lichess führt das tragende Motiv vorn, die Einordnungen danach.
 */
export function motivTheorie(themes: readonly string[], locale: Locale): Theorie | null {
  for (const theme of themes) {
    const eintrag = THEME_THEORY[theme];
    if (eintrag) return { schluessel: theme, text: lokal(eintrag, locale) };
  }
  return null;
}
