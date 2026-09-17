/**
 * Ein Text in allen Oberflächensprachen · für Inhalte, nicht für Oberfläche.
 *
 * Die Wörterbücher unter `lib/locales` tragen, was die App *sagt*: Knöpfe,
 * Überschriften, Meldungen. Was sie *lehrt* — der Hinweis zu einem
 * Endspiel-Drill, die Theorie hinter einem Motiv, die Idee einer Eröffnung —
 * gehört zur Sache und wird mit ihr gepflegt. `src/data/endgames.ts` macht das
 * seit jeher so; dieses Modul ist nur der Typ dazu, damit die beiden neuen
 * Kataloge ihn nicht je eigen erfinden.
 *
 * Englisch ist Pflicht und zugleich die Rückfallebene: Fehlt eine Sprache,
 * steht dort der englische Satz und nicht eine Lücke. Das ist dieselbe Regel
 * wie bei den Motivnamen in `lib/locales/themes.ts`.
 */
import type { Locale } from "./i18n";

export type LokalText = { en: string } & Partial<Record<Locale, string>>;

export function lokal(text: LokalText, locale: Locale): string {
  return text[locale] ?? text.en;
}
