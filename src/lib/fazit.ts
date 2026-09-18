import type { Locale, TFunc } from "./i18n";
import { fazitBausteine, fazitSatz } from "./erklaerung";

/*
 * Eigene Datei, weil nur die Übersicht der Analyse den Kernsatz braucht:
 * `erklaerung.ts` liegt mit dem Fazit auf dem Dashboard im Startbündel, und
 * dorthin gehört diese Auswahl nicht.
 */

/**
 * Welcher Satz des Fazits allein stehen darf · der aussagekräftigste zuerst.
 *
 * Die Übersicht vor der Partie hat Platz für einen Satz, und der erste des
 * Fazits (die Note) wiederholt nur die Genauigkeit, die daneben schon als
 * Zahl steht. Vorn steht deshalb, was keine Zahl daneben sagen kann: dass
 * Ergebnis und Spiel nicht zusammenpassen, wo es gekippt ist, was sich
 * wiederholt hat. Die Note bleibt der Rückfall — sie gibt es immer.
 */
const FAZIT_VORRANG = [
  "verdict.result.",
  "verdict.turningPoint",
  "verdict.recurring",
  "verdict.phase.",
  "verdict.versus.",
  "verdict.errors.",
  "verdict.grade.",
];

/** Der eine Satz des Fazits für die Übersicht · `null` ohne Fazit. */
export function fazitKernsatz(
  verdict: string | undefined,
  options: { t: TFunc; locale: Locale }
): string | null {
  const bausteine = fazitBausteine(verdict);
  for (const praefix of FAZIT_VORRANG) {
    const treffer = bausteine.find((entry) => entry.key.startsWith(praefix));
    if (treffer) return fazitSatz(treffer, options);
  }
  return null;
}

