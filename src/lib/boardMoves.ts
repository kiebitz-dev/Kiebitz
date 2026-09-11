/**
 * Zughilfen fürs Brett: Zielfelder eines gewählten Steins als Punkte bzw.
 * Ringe (Schlagzug), im Kiebitz-Grün. Die Markierung läuft über
 * `customSquareStyles` von react-chessboard · kein zusätzliches DOM.
 */
import { Chess } from "chess.js";
import { useEffect, useState, type CSSProperties } from "react";

/** Farbe der Markierungen · kommt aus dem Thema, siehe src/themes.css. */
const DOT = "var(--color-mark)";

/** Ruhiger Zug: kleiner Punkt in der Feldmitte. */
const quietStyle: CSSProperties = {
  background: `radial-gradient(circle, ${DOT} 20%, transparent 21%)`,
};

/** Schlagzug: Ring am Feldrand, damit die Figur sichtbar bleibt. */
const captureStyle: CSSProperties = {
  background: `radial-gradient(circle, transparent 56%, ${DOT} 58%)`,
};

/** Hervorhebung des gewählten Feldes. */
export const selectedStyle: CSSProperties = { background: "var(--color-mark)" };

/**
 * Der zuletzt gespielte Zug · beide Felder liegen in einem hellen Grün.
 *
 * Dieselbe Markierung wie auf der Landeseite eines geteilten Links: Wer eine
 * Stellung aufschlägt, sieht sofort, woher sie kommt, ohne die Zugliste lesen
 * zu müssen. Blasser als die Auswahl, denn sie ist Auskunft und nicht Angebot.
 */
export const lastMoveStyle: CSSProperties = { background: "var(--color-mark-soft)" };

/** Beide Felder eines Zuges · leeres Objekt ohne Zug. */
export function lastMoveStyles(
  move: { from: string; to: string } | null | undefined
): Record<string, CSSProperties> {
  if (!move) return {};
  return { [move.from]: lastMoveStyle, [move.to]: lastMoveStyle };
}

/** Ein legales Zielfeld · ob dort etwas steht, entscheidet über die Marke. */
export interface MoveTarget {
  to: string;
  capture: boolean;
}

/**
 * Alle legalen Zielfelder von `from`. Leere Liste, wenn dort kein eigener
 * Stein steht oder die Stellung ungültig ist.
 *
 * Die Felder selbst und nicht ihre Stile: Das Brett malt Punkte und Ringe,
 * das gedruckte Diagramm malt sie anders (siehe components/blatt/Diagramm),
 * und beide sollen dieselben Felder markieren.
 */
export function moveTargets(fen: string, from: string | null): MoveTarget[] {
  if (!from) return [];
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: from as never, verbose: true }) as {
      to: string;
      captured?: string;
    }[];
    return moves.map((move) => ({ to: move.to, capture: move.captured != null }));
  } catch {
    return [];
  }
}

/**
 * Stile für alle legalen Zielfelder von `from`. Leeres Objekt, wenn dort kein
 * eigener Stein steht oder die Stellung ungültig ist.
 */
export function moveTargetStyles(fen: string, from: string | null): Record<string, CSSProperties> {
  const styles: Record<string, CSSProperties> = {};
  for (const target of moveTargets(fen, from)) {
    styles[target.to] = target.capture ? captureStyle : quietStyle;
  }
  return styles;
}

/** Gewähltes Feld plus seine Zielfelder · der übliche Aufruf in den Seiten. */
export function selectionStyles(
  fen: string,
  selected: string | null
): Record<string, CSSProperties> {
  if (!selected) return {};
  return { [selected]: selectedStyle, ...moveTargetStyles(fen, selected) };
}

/**
 * Zug per Klick: erst eigene Figur wählen, dann Zielfeld. Liefert außerdem die
 * Feldstile mit Auswahl und Zugpunkten. `play` meldet, ob der Zug zulässig war.
 */
export function useBoardSelection(
  fen: string,
  play: (from: string, to: string) => boolean,
  enabled = true
) {
  const [selected, setSelected] = useState<string | null>(null);

  // Neue Stellung (Zug, nächste Aufgabe) hebt die Auswahl auf.
  useEffect(() => setSelected(null), [fen]);

  const onSquareClick = (square: string) => {
    if (!enabled) return;
    let piece: { color: string } | undefined;
    let turn = "w";
    try {
      const chess = new Chess(fen);
      piece = chess.get(square as never);
      turn = chess.turn();
    } catch {
      return;
    }
    if (selected && selected !== square) {
      const moved = play(selected, square);
      // Fehlklick auf eine andere eigene Figur wählt diese aus.
      setSelected(moved || !piece || piece.color !== turn ? null : square);
    } else if (piece && piece.color === turn) {
      setSelected(selected === square ? null : square);
    }
  };

  return {
    selected,
    clearSelection: () => setSelected(null),
    onSquareClick,
    squareStyles: enabled ? selectionStyles(fen, selected) : {},
  };
}
