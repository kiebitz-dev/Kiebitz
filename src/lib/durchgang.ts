import type { MoveJudgment, ViewMove } from "./urteil";

/**
 * Der Durchgang durch eine Partie · welche Stellen er anhält.
 *
 * Eine analysierte Partie hat sechzig Urteile, und fünfundfünfzig davon sind
 * „bester Zug" oder „gut". Wer sie der Reihe nach durchblättert, findet die
 * fünf, auf die es ankommt, irgendwann auch — nur macht das niemand zweimal.
 * Der Durchgang nimmt diese fünf vorweg und führt in einer einzigen Taste
 * hindurch.
 *
 * Gerechnet wird nichts Neues: Die Urteile stehen in `lib/urteil.ts`, der
 * Preis eines Zuges steht als `verlust` daneben, und die Erklärung zu jedem
 * Halt gibt es längst (`lib/erklaerung.ts`). Hier wird nur ausgewählt und
 * sortiert.
 */

/** Wofür ein Halt steht · er entscheidet über Reihenfolge und Überschrift. */
export type MomentArt = "glanz" | "wende" | "patzer" | "verpasst" | "fehler";

export interface Moment {
  /** Halbzug, auf den der Durchgang springt · 1-basiert wie `ply`. */
  ply: number;
  art: MomentArt;
  judgment: MoveJudgment;
}

/** So viele Halte hat ein Durchgang höchstens. */
export const MOMENTE_MAX = 6;

/**
 * Die Arten in der Reihenfolge, in der sie einen Platz bekommen.
 *
 * Jede darf zuerst einen Halt stellen, bevor eine zweite Stelle derselben Art
 * drankommt. Ein Durchgang über sechs Ungenauigkeiten wäre eine Liste, kein
 * Durchgang; die Abwechslung ist der Punkt.
 *
 * Der grobe Fehler steht vorn, weil er die Partie entschieden hat. Danach das,
 * was gelungen ist — ein Durchgang, der nur Fehler zeigt, wird nicht zweimal
 * geöffnet.
 */
const REIHENFOLGE: MomentArt[] = ["patzer", "glanz", "wende", "verpasst", "fehler"];

function artFuer(judgment: MoveJudgment | undefined): MomentArt | null {
  switch (judgment) {
    case "blunder":
      return "patzer";
    case "brilliant":
      return "glanz";
    case "great":
      return "wende";
    case "miss":
      return "verpasst";
    case "mistake":
      return "fehler";
    default:
      return null;
  }
}

/**
 * Die Momente einer Partie · höchstens `MOMENTE_MAX`, nach Halbzug geordnet.
 *
 * `meineFarbe` grenzt den Durchgang auf die eigenen Züge ein. Ohne eigene
 * Seite — freies Brett, Schaufensterpartie — zählen alle: Dort gibt es keinen
 * Gegner, dessen Fehler einen nichts angingen.
 *
 * Ausgewählt wird in zwei Durchgängen. Erst bekommt jede Art einen Platz, in
 * der Reihenfolge oben und innerhalb einer Art die teuerste Stelle zuerst;
 * dann wird mit den übrigen aufgefüllt, wieder nach Preis. Am Ende steht alles
 * in der Reihenfolge der Partie, denn durchgegangen wird sie vorwärts.
 */
export function momente(
  moves: readonly ViewMove[],
  meineFarbe: "white" | "black" | null,
  max: number = MOMENTE_MAX
): Moment[] {
  const kandidaten: (Moment & { verlust: number })[] = [];
  moves.forEach((move, index) => {
    const ply = index + 1;
    if (meineFarbe && (ply % 2 === 1) !== (meineFarbe === "white")) return;
    const art = artFuer(move.judgment);
    if (!art || !move.judgment) return;
    kandidaten.push({ ply, art, judgment: move.judgment, verlust: move.verlust ?? 0 });
  });

  const gewaehlt: (Moment & { verlust: number })[] = [];
  const nimm = (m: (typeof kandidaten)[number]) => {
    if (gewaehlt.length < max && !gewaehlt.includes(m)) gewaehlt.push(m);
  };

  // Der erste grobe Fehler ist der erste und nicht der teuerste: Er ist die
  // Stelle, an der die Partie gekippt ist, und alles danach ist ihre Folge.
  const erstePatzer = kandidaten.find((m) => m.art === "patzer");
  if (erstePatzer) nimm(erstePatzer);

  for (const art of REIHENFOLGE) {
    const beste = kandidaten
      .filter((m) => m.art === art && !gewaehlt.includes(m))
      .sort((a, b) => b.verlust - a.verlust)[0];
    if (beste) nimm(beste);
  }

  // Auffüllen · was übrig ist, nach Gewicht. Ein Glanzzug hat keinen Verlust
  // und stünde damit ganz hinten, deshalb zählt er hier wie eine Wende.
  const gewicht = (m: (typeof kandidaten)[number]) =>
    m.art === "glanz" || m.art === "wende" ? 1 : m.verlust;
  for (const m of [...kandidaten].sort((a, b) => gewicht(b) - gewicht(a))) nimm(m);

  return gewaehlt
    .sort((a, b) => a.ply - b.ply)
    .map(({ ply, art, judgment }) => ({ ply, art, judgment }));
}
