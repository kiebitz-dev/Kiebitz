import { evalNum, type ViewMove } from "./urteil";
import { istBemaengelt } from "./erklaerung";

/**
 * „Nochmal" · den eigenen Fehler an Ort und Stelle noch einmal spielen.
 *
 * Aus einem Fehler wird eine Aufgabe, und zwar dort, wo man ihn gerade
 * ansieht — nicht erst morgen im Aufgabentrainer. Die Stellung vor dem Zug
 * steht ohnehin schon auf dem Brett; es fehlte nur die Antwort auf die Frage,
 * was man stattdessen hätte spielen sollen.
 *
 * Gerechnet wird hier nichts über das Brett: Was ein Versuch taugt, steht
 * entweder in der gespeicherten Analyse (der beste Zug) oder kommt von der
 * laufenden Engine, die neben dem Brett ohnehin läuft. Diese Datei setzt nur
 * die Regeln, nach denen aus zwei Bewertungen eine Rückmeldung wird.
 */

/** Was von einem Versuch zu halten ist. */
export type Rueckmeldung =
  /** Genau der Zug, den die Analyse empfohlen hat. */
  | { art: "gefunden"; kosten: 0 }
  /** Ein anderer Zug, der die Stellung genauso hält. */
  | { art: "gleichwertig"; kosten: number }
  /** Besser als der Zug der Partie, aber immer noch zu teuer. */
  | { art: "teurer"; kosten: number }
  /** Kein Urteil möglich · ohne Engine gibt es zu fremden Zügen keine Zahl. */
  | { art: "offen" };

/**
 * Bis zu welchem Verlust ein anderer Zug noch als gleichwertig gilt ·
 * Zentibauern.
 *
 * Eine Stellung hat selten genau einen guten Zug. Wer die Idee trifft und den
 * Weg dahin anders geht, hat die Aufgabe gelöst; auf dem Kürzel der Analyse zu
 * bestehen hieße, die eigene Notation zu prüfen und nicht das Schach.
 */
export const GLEICHWERTIG_CP = 30;

/** Stimmt der gespielte Zug mit der Empfehlung überein? */
export function istBesterZug(gespielt: string, beste: string | undefined): boolean {
  if (!beste || !gespielt) return false;
  return beste.slice(0, gespielt.length) === gespielt;
}

/**
 * Das Urteil über einen Versuch.
 *
 * `basis` ist die Bewertung der Stellung *vor* dem Zug, `nachher` die nach
 * ihm — beide aus Weiß-Sicht und beide, wenn möglich, von derselben Engine:
 * Der Vergleich zweier Suchen unterschiedlicher Tiefe ist keine Auskunft über
 * den Zug, sondern über die Tiefe. Fehlt eine der beiden, bleibt es bei
 * „offen"; eine erfundene Zahl wäre schlimmer als keine.
 */
export function beurteileVersuch(opts: {
  gespielt: string;
  beste: string | undefined;
  basis: number | null;
  nachher: number | null;
  weiss: boolean;
}): Rueckmeldung {
  if (istBesterZug(opts.gespielt, opts.beste)) return { art: "gefunden", kosten: 0 };
  if (opts.basis == null || opts.nachher == null) return { art: "offen" };
  const vorzeichen = opts.weiss ? 1 : -1;
  const kosten = Math.max(0, (opts.basis - opts.nachher) * vorzeichen);
  return kosten <= GLEICHWERTIG_CP
    ? { art: "gleichwertig", kosten }
    : { art: "teurer", kosten };
}

/** Gilt der Versuch als gelöst? */
export function geloest(urteil: Rueckmeldung | null): boolean {
  return urteil?.art === "gefunden" || urteil?.art === "gleichwertig";
}

/**
 * Lässt sich dieser Halbzug wiederholen?
 *
 * Nur eigene Züge, nur bemängelte, und nur solche, zu denen eine Empfehlung
 * gespeichert ist: Ohne sie gäbe es nichts, wogegen ein Versuch geprüft werden
 * könnte.
 */
export function nochmalMoeglich(
  move: ViewMove | undefined,
  ply: number,
  meineFarbe: "white" | "black" | null
): boolean {
  if (!move?.bestUci) return false;
  if (!istBemaengelt(move.judgment)) return false;
  if (meineFarbe && (ply % 2 === 1) !== (meineFarbe === "white")) return false;
  return true;
}

/**
 * Die Kennung der Aufgabe zu einem Halbzug · `own:<Partie>:<Halbzug>`.
 *
 * Genau so legt `replace_own_game_puzzles` in src-tauri/src/puzzles.rs die
 * Aufgaben aus eigenen Partien an. Wer den Zug hier findet, hat dieselbe
 * Aufgabe gelöst — sie danach im Trainer noch einmal vorgelegt zu bekommen,
 * wäre dieselbe Arbeit zweimal.
 *
 * Nicht jeder Fehler hat eine Aufgabe: Die Auswahl fasst Wiederholungen
 * derselben Idee zusammen und deckelt die Zahl je Partie. Darum ist die
 * Kennung nur ein Angebot — findet sich dazu keine Aufgabe, meldet das Backend
 * das, und es bleibt beim Versuch auf dem Brett.
 */
export function aufgabenKennung(gameId: number, ply: number): string {
  return `own:${gameId}:${ply}`;
}

/** Bewertung aus der laufenden Engine als eine Zahl aus Weiß-Sicht. */
export function engineZahl(live: { cp: number | null; mate: number | null } | null): number | null {
  if (!live) return null;
  if (live.cp == null && live.mate == null) return null;
  return evalNum(live.cp, live.mate);
}
