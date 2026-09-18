/**
 * Das Partie-Rating · „du hast gespielt wie 1650".
 *
 * Die Zahl ist eine Leistungszahl für eine einzelne Partie, und zwar in der
 * Form, die im Schach dafür üblich ist: Gegner-Elo plus höchstens 400 für
 * einen Sieg, minus höchstens 400 für eine Niederlage. Der Unterschied liegt
 * darin, *was* die 400 bestimmt. Nicht das Ergebnis — das kann an einer Zeit-
 * überschreitung oder einem Einsteller im 60. Zug hängen —, sondern das
 * Ergebnis, das die Qualität beider Seiten *erwarten lässt*.
 *
 * Herleitung (Stand 18.09.2026, 1344 analysierte eigene Partien mit beiden
 * Genauigkeiten und Gegner-Elo):
 *
 * 1. Die Genauigkeit allein sagt über die Spielstärke fast nichts. Über alle
 *    2688 Spielerseiten dieser Partien hängt die Elo nur schwach an der
 *    Genauigkeit (r = 0,15; 2,7 Elo je Prozentpunkt, Streuung ±236). Eine
 *    Zahl der Form „86 % entsprechen 1650" wäre Rauschen, und deshalb gibt es
 *    sie hier nicht.
 *
 * 2. Der *Abstand* der beiden Genauigkeiten sagt das Ergebnis dagegen sehr gut
 *    voraus. Angepasst wurde P(Punkt) = 1 / (1 + e^(−b·Δ)), Δ = eigene minus
 *    gegnerische Genauigkeit, symmetrisch (jede Partie zählt aus beiden
 *    Sichten, damit bei Δ = 0 genau ein halber Punkt herauskommt). Ergebnis:
 *    b = 0,3185. Die Vorhersage trifft die tatsächliche Punktausbeute in
 *    jedem Band von Δ auf wenige Prozentpunkte (Δ 5…10: 0,90 erwartet,
 *    0,90 erzielt; Δ −5…−2: 0,23 erwartet, 0,18 erzielt).
 *
 * 3. Aus einer erwarteten Punktzahl p wird über die Elo-Formel ein
 *    Rating-Unterschied: 400 · log10(p / (1 − p)). Mit dem logistischen
 *    Ansatz aus (2) ist das linear in Δ, 400 / ln 10 · b = 55,3 Elo je
 *    Prozentpunkt Vorsprung.
 *
 * 4. Gekappt wird bei ±400, wie bei der Leistungszahl einer Einzelpartie. Die
 *    Kappe greift ab gut sieben Punkten Abstand; knapp die Hälfte der Partien
 *    (616 von 1344) liegt dort.
 *
 * Gerundet wird auf zehn · eine Einerstelle täte so, als wüsste die Rechnung
 * das Rating einer einzelnen Partie auf den Punkt genau.
 *
 * Was die Zahl nicht ist: eine Schätzung der eigenen Wertungszahl. Wer gegen
 * einen 1400er zwei Prozentpunkte genauer spielt, hat in *dieser* Partie wie
 * ein 1510er gespielt — mehr sagt sie nicht, und genau so steht sie in der
 * Übersicht, mit Gegner und Abstand daneben.
 */

/** Elo je Prozentpunkt Genauigkeitsvorsprung · siehe Herleitung oben. */
export const ELO_JE_PUNKT = 55.3;

/** Die übliche Kappe der Leistungszahl einer Einzelpartie. */
export const KAPPE = 400;

/**
 * Das Partie-Rating · `null`, wo eine der drei Zahlen fehlt.
 *
 * Ohne Gegner-Elo gibt es keinen Anker, ohne beide Genauigkeiten keinen
 * Abstand. Dann steht in der Übersicht nichts statt einer geratenen Zahl.
 */
export function partieRating(
  gegnerElo: number | null | undefined,
  meineGenauigkeit: number | null | undefined,
  gegnerGenauigkeit: number | null | undefined
): number | null {
  if (!gegnerElo || gegnerElo <= 0) return null;
  if (meineGenauigkeit == null || gegnerGenauigkeit == null) return null;
  const abstand = meineGenauigkeit - gegnerGenauigkeit;
  const aufschlag = Math.max(-KAPPE, Math.min(KAPPE, ELO_JE_PUNKT * abstand));
  return Math.round((gegnerElo + aufschlag) / 10) * 10;
}
