/**
 * Welcher Klang zu einem Stellungswechsel gehört.
 *
 * Die Bretter melden keine Züge, sondern nur eine neue FEN · das gilt für den
 * eigenen Zug genauso wie für die Antwort der Engine, den Setup-Zug einer
 * Puzzle-Aufgabe oder das Blättern in der Zugliste. Deshalb wird der Klang aus
 * dem Unterschied zweier Stellungen abgeleitet: ein einzelner Zug verändert
 * höchstens vier Felder (Rochade), und mehr als eine Figur kann er nicht vom
 * Brett nehmen. Alles darüber ist ein Stellungswechsel · neue Aufgabe, anderes
 * Brett, Reset · und bleibt stumm.
 */
import { Chess } from "chess.js";
import type { BoardSoundKind } from "./sound";

/** FEN-Stellungsteil als 64 Felder, a8 zuerst; null bei ungültiger Eingabe. */
export function fenSquares(fen: string): string[] | null {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return null;
  const rows = placement.split("/");
  if (rows.length !== 8) return null;
  const squares: string[] = [];
  for (const row of rows) {
    let filled = 0;
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        const empty = Number(char);
        for (let i = 0; i < empty; i++) squares.push("");
        filled += empty;
      } else if (/[pnbrqkPNBRQK]/.test(char)) {
        squares.push(char);
        filled += 1;
      } else {
        return null;
      }
    }
    if (filled !== 8) return null;
  }
  return squares;
}

function sideToMove(fen: string): "w" | "b" | null {
  const field = fen.trim().split(/\s+/)[1];
  return field === "w" || field === "b" ? field : null;
}

/** Halbzugindex der Stellung; damit klingt Rückwärtsblättern nicht nach Schach. */
function plyIndex(fen: string): number | null {
  const fields = fen.trim().split(/\s+/);
  const side = fields[1];
  const fullmove = Number(fields[5]);
  if ((side !== "w" && side !== "b") || !Number.isInteger(fullmove) || fullmove < 1) {
    return null;
  }
  return (fullmove - 1) * 2 + (side === "b" ? 1 : 0);
}

function checkSound(fen: string): BoardSoundKind | null {
  try {
    const position = new Chess(fen);
    if (position.isCheckmate()) return "checkmate";
    if (position.isCheck()) return "check";
  } catch {
    /* Die strukturelle FEN-Prüfung unten entscheidet über ungültige Eingaben. */
  }
  return null;
}

/**
 * Klang für den Übergang von `previous` nach `next`.
 * Schach und Matt haben beim Vorwärtsspielen Vorrang vor dem Zugtyp. Beim
 * Rückwärtsblättern bleibt dagegen der physische Zug-, Schlag- oder
 * Rochadeklang erhalten, statt den Zustand erneut anzukündigen.
 * Leeres Ergebnis heißt: kein einzelner Zug, also kein Ton.
 */
export function soundsForTransition(previous: string, next: string): BoardSoundKind[] {
  if (!previous || !next || previous === next) return [];
  const before = fenSquares(previous);
  const after = fenSquares(next);
  if (!before || !after) return [];

  const changed: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (before[i] !== after[i]) changed.push(i);
  }
  // Ein Zug bewegt eine Figur (2 Felder), schlägt en passant (3) oder
  // rochiert (4). Mehr Änderungen sind ein Stellungswechsel.
  if (changed.length === 0 || changed.length > 4) return [];

  const pieces = (squares: string[]) => squares.filter(Boolean).length;
  const removed = pieces(before) - pieces(after);
  if (Math.abs(removed) > 1) return [];

  // Ein echter Zug wechselt die Seite am Zug. Ohne dieses Feld (reine
  // Stellungsangabe) wird nicht geprüft.
  const from = sideToMove(previous);
  const to = sideToMove(next);
  if (from && to && from === to) return [];

  const previousPly = plyIndex(previous);
  const nextPly = plyIndex(next);
  if (previousPly !== null && nextPly !== null && nextPly > previousPly) {
    const check = checkSound(next);
    if (check) return [check];
  }

  if (Math.abs(removed) === 1) return ["capture"];
  if (changed.length === 4) return ["castle"];
  return ["move"];
}

/**
 * Die Klänge zu einem Halt im Durchgang durch die Partie.
 *
 * Der Brettklang selbst kommt weiterhin aus `soundsForTransition` — das Brett
 * meldet ja eine neue Stellung wie bei jedem Blättern. Darüber liegt das
 * Umblättern des Durchgangs, und ein Zug mit „!!“ oder „!“ bekommt dazu den
 * steigenden Glanz. Ohne diesen Unterschied klänge die eigene Glanzstelle
 * wie der eigene Patzer.
 */
export function soundsForMoment(judgment: string): BoardSoundKind[] {
  return judgment === "brilliant" || judgment === "great" ? ["moment", "glanz"] : ["moment"];
}
