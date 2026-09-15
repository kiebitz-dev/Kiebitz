import { Chessboard } from "react-chessboard";
import type { ChessboardOptions, PieceRenderObject } from "react-chessboard";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { lastMoveStyles, moveTargetStyles, selectionStyles } from "../lib/boardMoves";
import { PIECE_VIEWBOX } from "../lib/pieces/glyphs";
import { PIECE_GLYPH } from "./pieceGlyphs";
import { usePieceGlyphs } from "../lib/pieces/usePieceSet";
import { soundsForTransition } from "../lib/boardSound";
import { playBoardSound } from "../lib/sound";

/**
 * Feldfarben kommen aus dem Thema (src/themes.css) · react-chessboard setzt
 * sie als CSS-Eigenschaft, deshalb trägt eine Variable hier genauso wie ein
 * Farbwert, und der Themenwechsel braucht kein Neurendern des Bretts.
 */
const boardTheme = {
  darkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
  lightSquareStyle: { backgroundColor: "var(--color-board-light)" },
  boardStyle: {
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--color-line)",
  },
} satisfies ChessboardOptions;

/** Nebenvariante · dasselbe Brett, entsättigt. */
const mutedBoardTheme = {
  darkSquareStyle: { backgroundColor: "var(--color-board-dark-muted)" },
  lightSquareStyle: { backgroundColor: "var(--color-board-light-muted)" },
} satisfies ChessboardOptions;

/**
 * Die Figuren eines gewählten Sets für `react-chessboard`.
 *
 * Der klassische Satz bekommt bewusst *nichts*: Dann zeichnet das Brett seine
 * eigenen Figuren, so wie bisher — ein Umweg über eigene Komponenten wäre für
 * dieselben Zeichnungen nur ein Risiko. Erst ein gewähltes Set legt eine
 * eigene Zeichnung über jedes Feld.
 *
 * Der Schlüssel ist die Tabelle selbst und nicht die Kennung des Sets: Die
 * Zeichnungen kommen nachgeladen (`lib/pieces/glyphs.ts`), und bis dahin
 * liefert dieselbe Kennung noch den klassischen Satz. Über die Tabelle gebaut,
 * merkt das Brett den Wechsel von allein.
 */
const customPieceCache = new WeakMap<Record<string, string>, PieceRenderObject>();

function customPiecesFor(glyphs: Record<string, string>): PieceRenderObject | undefined {
  // Der klassische Satz · auch das, was ein noch nicht geladenes Set liefert.
  if (glyphs === PIECE_GLYPH) return undefined;
  const cached = customPieceCache.get(glyphs);
  if (cached) return cached;
  const pieces: PieceRenderObject = {};
  for (const [code, glyph] of Object.entries(glyphs)) {
    // Die Größe bestimmt das Feld, nicht die Zeichnung · so hält es das Brett
    // auch mit seinen eigenen Figuren.
    pieces[code] = (props) => (
      <svg
        viewBox={PIECE_VIEWBOX}
        width="100%"
        height="100%"
        style={props?.svgStyle}
        // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
        dangerouslySetInnerHTML={{ __html: glyph }}
      />
    );
  }
  customPieceCache.set(glyphs, pieces);
  return pieces;
}

const EMPTY_ARROWS: [string, string, string?][] = [];
const EMPTY_BADGES: BoardBadge[] = [];
const EMPTY_STYLES: Record<string, CSSProperties> = {};

/**
 * Durchmesser der Marker in Prozent der Brettkante · als Zahl und nicht als
 * Klasse, weil `badgePosition` mit ihr rechnet: Ein Marker am Brettrand rückt
 * um seinen halben Durchmesser herein.
 */
const BADGE_SIZE = 6.5;
/** Der Marker des Partieendes ist etwas größer · er ist die Aussage. */
const END_MARK_SIZE = 7.5;

type BoardArrow = [string, string, string?];
type BoardBadge = { square: string; label: ReactNode; color: string; title?: string };

/**
 * Fertig aufbereitetes Partieende · das Brett übersetzt nichts und entscheidet
 * nichts. Woher Grund und Ausgang kommen, steht in `lib/boardEnd.ts`; wie sie
 * in dieser Ansicht heißen, in `useBoardEndView`.
 */
export type BoardEndView = {
  /** Feld des betroffenen Königs; ohne Feld bleibt nur der Streifen. */
  square: string | null;
  /** Kurzzeichen auf dem Königsfeld ("#", "½", ein Icon). */
  mark: ReactNode;
  /** Farbe von Marker und Ring. */
  color: string;
  /**
   * Übersetzter Satz für den Streifen ("Schwarz gewinnt durch Matt"). Leer
   * heißt: nur der Marker · so bleibt im Puzzle-Trainer das Mattzeichen auf
   * dem König, ohne dass eine gelöste Aufgabe als gewonnene Partie auftritt.
   */
  label: string;
  /** Beschriftung der Schließen-Schaltfläche. */
  dismissLabel: string;
};

/**
 * Derselbe Stellungswechsel klingt einmal, auch wenn zwei Bretter ihn zeigen.
 *
 * Sieben Seiten stellen neben ihrem Brett ein zweites auf: das Fokus-Brett
 * (`components/FocusBoard.tsx`) legt sich über die Seite, das Brett darunter
 * bleibt aber im Baum stehen — es soll ja da sein, wenn der Fokus wieder
 * zugeht. Beide bekommen dieselbe Stellung, beide sehen denselben Wechsel,
 * und beide spielten bis 1.4 ihren Klang: Wer im Fokus zog, hörte jeden Zug
 * doppelt.
 *
 * Gemerkt wird deshalb der Wechsel selbst und nicht das Brett. Zwei Bretter
 * desselben Baums bekommen ihre neue Stellung in derselben Übergabe, ihre
 * Effekte laufen also im selben Anlauf; das kurze Fenster reicht dafür
 * bequem und ist zugleich zu kurz, um einen wirklich zweimal gespielten
 * Wechsel zu verschlucken — dafür müsste jemand in einer Fünftelsekunde
 * vor und wieder zurück blättern.
 */
const KLANGFENSTER_MS = 200;
let letzterKlang: { wechsel: string; zeit: number } | null = null;

function schonGeklungen(vorher: string, nachher: string): boolean {
  const wechsel = `${vorher}→${nachher}`;
  const jetzt = Date.now();
  if (letzterKlang && letzterKlang.wechsel === wechsel && jetzt - letzterKlang.zeit < KLANGFENSTER_MS) {
    return true;
  }
  letzterKlang = { wechsel, zeit: jetzt };
  return false;
}

type BoardProps = {
  fen: string;
  /** Maximale Brettbreite in px; der Container kann sie unterschreiten. */
  width: number;
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
  squareStyles?: Record<string, CSSProperties>;
  /**
   * Der Zug, der zur gezeigten Stellung führte · seine beiden Felder werden
   * hell hinterlegt. Die Seiten reichen ihn herein, statt ihn aus dem
   * Stellungswechsel zu erraten: Wer zurückblättert, will den Zug markiert
   * sehen, der zu dieser Stellung führte, und nicht den, der von ihr wegführt.
   */
  lastMove?: { from: string; to: string } | null;
  orientation?: "white" | "black";
  boardId: string;
  shake?: boolean;
  /** Engine-/Partiezug-Pfeile im Format [von, nach, Farbe]. */
  arrows?: BoardArrow[];
  /** Kleine Zugqualitaets-Marker auf der oberen rechten Feldecke. */
  badges?: BoardBadge[];
  /** Varianten werden durch entsaettigte Felder vom Partieverlauf abgesetzt. */
  muted?: boolean;
  /** Gemeinsamer WebView-Drag fuer Maus, Stift und Touch statt react-dnd. */
  mouseDrag?: boolean;
  /** Reine Vorschaubretter bleiben stumm, auch wenn Ton aktiviert ist. */
  silent?: boolean;
  /** Partieende; null solange gespielt wird oder das Brett zurückblättert. */
  end?: BoardEndView | null;
};

function isAndroidWebView(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function requestUiFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelUiFrame(frame: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

function sameStyleRecord(
  left: Record<string, CSSProperties>,
  right: Record<string, CSSProperties>
): boolean {
  if (left === right) return true;
  const leftSquares = Object.keys(left);
  const rightSquares = Object.keys(right);
  if (leftSquares.length !== rightSquares.length) return false;
  for (const square of leftSquares) {
    const leftStyle = left[square] as Record<string, unknown> | undefined;
    const rightStyle = right[square] as Record<string, unknown> | undefined;
    if (!leftStyle || !rightStyle) return false;
    const leftKeys = Object.keys(leftStyle);
    const rightKeys = Object.keys(rightStyle);
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key) => leftStyle[key] !== rightStyle[key])) return false;
  }
  return true;
}

type BoardSurfaceProps = {
  boardId: string;
  fen: string;
  draggable: boolean;
  mouseDrag: boolean;
  orientation: "white" | "black";
  dragSource: string | null;
  squareStyles: Record<string, CSSProperties>;
  lastMove: { from: string; to: string } | null;
  muted: boolean;
  pieceGlyphs: Record<string, string>;
  android: boolean;
  hasDropHandler: boolean;
  hasSquareClickHandler: boolean;
  onPieceDrop: (from: string, to: string) => boolean;
  onSquareClick: (square: string) => void;
  onPieceDragBegin: (source: string) => void;
  onPieceDragEnd: () => void;
};

/**
 * `react-chessboard` places almost all state in one context. Any parent render
 * would therefore reconcile all 64 squares, even when only an engine label or
 * clock changed. This small memo boundary keeps that expensive tree completely
 * untouched until a visual board input actually changes.
 */
const BoardSurface = memo(
  function BoardSurface({
    boardId,
    fen,
    draggable,
    mouseDrag,
    orientation,
    dragSource,
    squareStyles,
    lastMove,
    muted,
    pieceGlyphs,
    android,
    hasDropHandler,
    hasSquareClickHandler,
    onPieceDrop,
    onSquareClick,
    onPieceDragBegin,
    onPieceDragEnd,
  }: BoardSurfaceProps) {
    // Der letzte Zug liegt zuunterst: Auswahl, Zugpunkte und alles, was eine
    // Seite selbst markiert, sollen ihn überschreiben können.
    const combinedStyles = useMemo(
      () => ({
        ...lastMoveStyles(lastMove),
        ...selectionStyles(fen, dragSource),
        ...squareStyles,
      }),
      [fen, dragSource, lastMove, squareStyles]
    );

    // Seit Version 5 nimmt das Brett alles in einem Objekt entgegen. Es hängt
    // an denselben Werten wie die Memo-Grenze darunter · ein neues Objekt je
    // Elternrender würde sie sonst wirkungslos machen.
    const options = useMemo<ChessboardOptions>(
      () => ({
        id: boardId,
        position: fen,
        boardOrientation: orientation,
        allowDragging: draggable && !mouseDrag,
        onPieceDrop: !mouseDrag && hasDropHandler
          ? ({ sourceSquare, targetSquare }) =>
              targetSquare != null && onPieceDrop(sourceSquare, targetSquare)
          : undefined,
        onPieceDrag: draggable && !mouseDrag
          ? ({ square }) => {
              if (square) onPieceDragBegin(square);
            }
          : undefined,
        // Version 5 meldet das Ende eines Zuges nicht mehr eigens · abgebrochen
        // wird gemeldet, und ein gelungener Zug ist am Stellungswechsel zu
        // erkennen, der die Auswahl ohnehin aufhebt (siehe Effekt auf `fen`).
        onPieceDragCancel: draggable && !mouseDrag ? onPieceDragEnd : undefined,
        onSquareClick: hasSquareClickHandler
          ? ({ square }) => onSquareClick(square)
          : undefined,
        squareStyles: combinedStyles,
        // Pfeile zeichnet Kiebitz selbst (siehe BoardArrows); das eingebaute
        // Zeichnen per rechter Maustaste wäre eine zweite, andere Bedienung
        // für dieselbe Sache.
        allowDrawingArrows: false,
        // The shared pointer path reports a move as an external position
        // change. react-chessboard would otherwise lock that board for the
        // animation duration after every user move.
        showAnimations: !(mouseDrag || android),
        animationDurationInMs: mouseDrag || android ? 0 : 150,
        pieces: customPiecesFor(pieceGlyphs),
        ...boardTheme,
        ...(muted ? mutedBoardTheme : {}),
      }),
      [
        boardId,
        fen,
        orientation,
        draggable,
        mouseDrag,
        hasDropHandler,
        hasSquareClickHandler,
        onPieceDrop,
        onPieceDragBegin,
        onPieceDragEnd,
        onSquareClick,
        combinedStyles,
        android,
        pieceGlyphs,
        muted,
      ]
    );

    return <Chessboard options={options} />;
  },
  (previous, next) =>
    previous.boardId === next.boardId
    && previous.fen === next.fen
    && previous.draggable === next.draggable
    && previous.mouseDrag === next.mouseDrag
    && previous.orientation === next.orientation
    && previous.dragSource === next.dragSource
    && previous.lastMove?.from === next.lastMove?.from
    && previous.lastMove?.to === next.lastMove?.to
    && previous.muted === next.muted
    && previous.pieceGlyphs === next.pieceGlyphs
    && previous.android === next.android
    && previous.hasDropHandler === next.hasDropHandler
    && previous.hasSquareClickHandler === next.hasSquareClickHandler
    && sameStyleRecord(previous.squareStyles, next.squareStyles)
);

function squareCenter(square: string, orientation: "white" | "black") {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = orientation === "white" ? file : 7 - file;
  const y = orientation === "white" ? 7 - rank : rank;
  return { x: (x + 0.5) * 12.5, y: (y + 0.5) * 12.5 };
}

/**
 * Eigene Markierungen · Pfeil (`from` ≠ `to`) oder Kreis (`from` = `to`).
 *
 * Gezeichnet wird mit der rechten Maustaste, wie es Lichess vormacht: ziehen
 * ergibt einen Pfeil, ein Klick auf ein Feld einen Kreis. Umschalt, Alt und
 * beide zusammen wechseln die Farbe; ein Linksklick wischt alles wieder weg.
 */
type BoardShape = { from: string; to: string; color: string };

/** Die vier Farben von Lichess · grün, rot, blau, gelb. */
const SHAPE_COLORS = {
  plain: "rgb(21,128,61)",
  shift: "rgb(190,48,48)",
  alt: "rgb(38,98,180)",
  both: "rgb(203,142,20)",
} as const;

function shapeColor(event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): string {
  const alt = event.altKey || event.ctrlKey;
  if (event.shiftKey && alt) return SHAPE_COLORS.both;
  if (event.shiftKey) return SHAPE_COLORS.shift;
  if (alt) return SHAPE_COLORS.alt;
  return SHAPE_COLORS.plain;
}

/**
 * Feld unter einem Zeigerpunkt · aus der Brettkante gerechnet und nicht über
 * `elementFromPoint` gesucht. Beim Ziehen liegt unter dem Zeiger auch mal eine
 * Figur oder ein Overlay; die Kante des Bretts liegt immer richtig.
 */
function squareAtPoint(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  orientation: "white" | "black"
): string | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const column = Math.floor(((x - rect.left) / rect.width) * 8);
  const row = Math.floor(((y - rect.top) / rect.height) * 8);
  if (column < 0 || column > 7 || row < 0 || row > 7) return null;
  const file = orientation === "white" ? column : 7 - column;
  const rank = orientation === "white" ? 8 - row : row + 1;
  return `${String.fromCharCode(97 + file)}${rank}`;
}

/** Dieselbe Markierung noch einmal gezogen löscht sie · so wie bei Lichess. */
function toggleShape(shapes: BoardShape[], shape: BoardShape): BoardShape[] {
  const index = shapes.findIndex((s) => s.from === shape.from && s.to === shape.to);
  if (index < 0) return [...shapes, shape];
  // Dasselbe Feldpaar in einer anderen Farbe färbt um, statt zu löschen.
  if (shapes[index].color !== shape.color) {
    const next = shapes.slice();
    next[index] = shape;
    return next;
  }
  return shapes.filter((_, i) => i !== index);
}

function sameShapes(left: BoardShape[], right: BoardShape[]): boolean {
  return left === right || (
    left.length === right.length
    && left.every((shape, index) =>
      shape.from === right[index]?.from
      && shape.to === right[index]?.to
      && shape.color === right[index]?.color
    )
  );
}

/** Die Kreise der eigenen Markierungen · eine eigene Ebene über den Pfeilen. */
const BoardCircles = memo(function BoardCircles({
    shapes,
    orientation,
  }: {
    shapes: BoardShape[];
    orientation: "white" | "black";
  }) {
  const drawable = shapes.flatMap((shape, index) => {
    if (shape.from !== shape.to) return [];
    const center = squareCenter(shape.from, orientation);
    if (!center) return [];
    return [{ center, color: shape.color, index, square: shape.from }];
  });
  if (drawable.length === 0) return null;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-testid="board-circles"
      viewBox="0 0 100 100"
    >
      {drawable.map((circle) => (
        <circle
          key={circle.index}
          cx={circle.center.x}
          cy={circle.center.y}
          data-circle-square={circle.square}
          fill="none"
          opacity="0.75"
          r={6.25 - 0.75}
          stroke={circle.color}
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}, (previous, next) =>
  previous.orientation === next.orientation && sameShapes(previous.shapes, next.shapes)
);

function sameArrows(left: BoardArrow[], right: BoardArrow[]): boolean {
  return left === right || (
    left.length === right.length
    && left.every((arrow, index) =>
      arrow[0] === right[index]?.[0]
      && arrow[1] === right[index]?.[1]
      && arrow[2] === right[index]?.[2]
    )
  );
}

/**
 * Maße des Pfeils · in Brettvierteln gerechnet (ein Feld ist 12,5 breit).
 *
 * Die Spitze war früher ein SVG-`marker`. Ein Marker ohne `viewBox` schneidet
 * alles ab, was über sein Fenster hinausragt, und die Spitze lag genau auf der
 * Kante: Sie kam stumpf heraus, die beiden hinteren Ecken abgeschnitten. Hier
 * ist der Pfeil deshalb zwei ganz gewöhnliche Formen — Schaft und Spitze — in
 * einer Gruppe. Die Deckkraft sitzt an der Gruppe, damit an der Überlappung
 * keine Naht entsteht.
 */
const ARROW_SHAFT = 2.3;
const ARROW_HEAD_LENGTH = 4.4;
const ARROW_HEAD_HALF = 3.1;

/** Engine arrows live outside react-chessboard so a changing PV repaints one
 * SVG line instead of invalidating the board context and all 64 squares. */
const BoardArrows = memo(function BoardArrows({
    arrows,
    orientation,
  }: {
    arrows: BoardArrow[];
    orientation: "white" | "black";
  }) {
  if (arrows.length === 0) return null;
  const drawable = arrows.flatMap(([fromSquare, toSquare, color], index) => {
    const from = squareCenter(fromSquare, orientation);
    const to = squareCenter(toSquare, orientation);
    if (!from || !to || fromSquare === toSquare) return [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return [];
    const sharedTarget = arrows.some(
      ([otherFrom, otherTo], otherIndex) =>
        otherIndex !== index && otherFrom !== fromSquare && otherTo === toSquare
    );
    // Wie weit vor der Feldmitte die Spitze stehen bleibt · zwei Pfeile auf
    // dasselbe Feld bleiben weiter davor, damit sie sich nicht überlagern.
    const reducer = sharedTarget ? 4.5 : 1.5;
    const ux = dx / length;
    const uy = dy / length;
    const tip = { x: to.x - ux * reducer, y: to.y - uy * reducer };
    const shaftLength = Math.max(0, length - reducer);
    // Ein Pfeil über ein einziges Feld ist immer noch länger als seine
    // Spitze · die Klammer ist für die Randfälle, nicht für den Normalfall.
    const headLength = Math.min(ARROW_HEAD_LENGTH, shaftLength * 0.75);
    const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
    // Senkrecht zur Pfeilrichtung · daran hängen die Ecken der Spitze.
    const px = -uy;
    const py = ux;
    const point = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
    return [{
      color: color ?? "rgb(255,170,0)",
      from,
      index,
      to: base,
      head: [
        point(tip.x, tip.y),
        point(base.x + px * ARROW_HEAD_HALF, base.y + py * ARROW_HEAD_HALF),
        point(base.x - px * ARROW_HEAD_HALF, base.y - py * ARROW_HEAD_HALF),
      ].join(" "),
    }];
  });
  if (drawable.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-testid="board-arrows"
      viewBox="0 0 100 100"
    >
      {drawable.map((arrow) => (
        <g key={arrow.index} data-arrow-index={arrow.index} opacity="0.65">
          <line
            stroke={arrow.color}
            strokeLinecap="round"
            strokeWidth={ARROW_SHAFT}
            x1={arrow.from.x}
            x2={arrow.to.x}
            y1={arrow.from.y}
            y2={arrow.to.y}
          />
          <polygon fill={arrow.color} points={arrow.head} />
        </g>
      ))}
    </svg>
  );
}, (previous, next) =>
  previous.orientation === next.orientation && sameArrows(previous.arrows, next.arrows)
);

/**
 * Schachbrett mit responsiver Breite: `width` ist die Maximalbreite; auf
 * schmalen Screens (Mobile) schrumpft das Brett auf die Containerbreite.
 */
export default function Board({
  fen,
  width,
  draggable = false,
  onPieceDrop,
  onSquareClick,
  squareStyles,
  lastMove = null,
  orientation = "white",
  boardId,
  shake = false,
  arrows = EMPTY_ARROWS,
  badges = EMPTY_BADGES,
  muted = false,
  mouseDrag = false,
  silent = false,
  end = null,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pieceGlyphs = usePieceGlyphs();
  const [w, setW] = useState(width);
  const [dragSource, setDragSource] = useState<string | null>(null);
  /** Eigene Markierungen der laufenden Stellung · siehe `BoardShape`. */
  const [shapes, setShapes] = useState<BoardShape[]>([]);
  /** Die Markierung, die gerade gezogen wird · sie hängt noch am Zeiger. */
  const [pendingShape, setPendingShape] = useState<BoardShape | null>(null);
  const dropRef = useRef(onPieceDrop);
  const squareClickRef = useRef(onSquareClick);
  const draggableRef = useRef(draggable);
  const fenRef = useRef(fen);
  const suppressClickUntilRef = useRef(0);
  const cancelPointerDragRef = useRef<(() => void) | null>(null);

  dropRef.current = onPieceDrop;
  squareClickRef.current = onSquareClick;
  draggableRef.current = draggable;
  fenRef.current = fen;

  /**
   * Die Breite wird *vor* dem ersten Bild gemessen.
   *
   * `width` ist nur die Obergrenze (`BOARD_MAX`, 880 px) · wie breit das Brett
   * wirklich wird, sagt der Container. Als nachlaufender Effekt gemessen, malte
   * der Browser vorher genau ein Bild mit der Obergrenze: In einer Handyspalte
   * von 380 px erschien für einen Frame ein 880 px breites Brett und schrumpfte
   * dann. Sichtbar war das überall dort, wo ein Brett neu ins Bild kommt · beim
   * Wechsel in den Varianten-Baukasten des Repertoires und beim Zurückgehen
   * genauso wie beim Öffnen des Fokus. `useLayoutEffect` misst noch vor dem
   * Zeichnen, damit das erste Bild schon das richtige ist.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame: number | null = null;
    const measure = () => {
      const avail = el.clientWidth;
      setW(avail > 0 ? Math.min(width, avail) : width);
    };
    const update = () => {
      if (frame != null) return;
      frame = requestUiFrame(() => {
        frame = null;
        measure();
      });
    };
    measure();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      if (frame != null) cancelUiFrame(frame);
      ro.disconnect();
    };
  }, [width]);

  // Stable proxies let BoardSurface skip parent-only renders without ever
  // retaining stale page callbacks.
  const handlePieceDrop = useCallback(
    (from: string, to: string) => dropRef.current?.(from, to) ?? false,
    []
  );
  const handleSquareClick = useCallback(
    (square: string) => squareClickRef.current?.(square),
    []
  );
  const handlePieceDragBegin = useCallback((source: string) => {
    startTransition(() => setDragSource(source));
  }, []);
  const handlePieceDragEnd = useCallback(() => {
    startTransition(() => setDragSource(null));
  }, []);

  // A new position always ends the old drag, including moves completed by an
  // automated opponent response.
  useEffect(() => {
    cancelPointerDragRef.current?.();
    setDragSource(null);
  }, [fen]);

  /**
   * Eigene Markierungen · Ziehen ergibt einen Pfeil, ein Punkt einen Kreis.
   *
   * Mit der Maus geht das über die rechte Taste, wie es Lichess vormacht.
   * Auf dem Handy gibt es keine rechte Taste, und jede Geste mit einem Finger
   * ist schon vergeben: Ziehen bewegt eine Figur, Tippen wählt sie aus. Dort
   * zeichnet deshalb der *zweite* Finger — einer liegt auf dem Brett, der
   * andere zieht. So kollidiert das Zeichnen mit nichts, was das Brett sonst
   * schon kann.
   *
   * Das eingebaute Zeichnen von `react-chessboard` ist abgeschaltet (siehe
   * `allowDrawingArrows`): Es kennt die Kreise nicht, hat keine Geste fürs
   * Handy und malte seine Pfeile in eine zweite Ebene neben die der Engine.
   * Hier entsteht beides an derselben Stelle wie die Engine-Pfeile und geht
   * mit derselben Stellung wieder weg.
   *
   * Das Feld wird aus der Brettkante gerechnet und nicht aus dem Element unter
   * dem Zeiger gelesen · über einer Figur, einem Marker oder dem Streifen des
   * Partieendes gäbe es sonst kein Feld.
   */
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let drawing: { square: string; color: string; pointerId: number } | null = null;
    /**
     * Ein Tippen mit einem Finger wischt die Markierungen weg — aber erst beim
     * Loslassen. Sofort gelöscht wie beim Mausklick, hätte der Finger, der zum
     * Zeichnen aufs Brett kommt, jedes Mal zuerst alles Bisherige mitgenommen.
     */
    let clearOnLift = false;

    const squareAtEvent = (event: PointerEvent) =>
      squareAtPoint(
        event.clientX,
        event.clientY,
        surface.getBoundingClientRect(),
        orientation
      );

    const beginShape = (event: PointerEvent) => {
      const square = squareAtEvent(event);
      if (!square) return;
      event.preventDefault();
      const color = shapeColor(event);
      drawing = { square, color, pointerId: event.pointerId };
      setPendingShape({ from: square, to: square, color });
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        // `isPrimary` sagt, der wievielte Finger das ist: Der erste einer
        // Geste ist primär, jeder weitere daneben nicht. Das ersetzt eine
        // eigene Liste der liegenden Finger — die hielt nur, solange auch
        // jedes Loslassen hier ankam, und der Figurenzug unten hält sein
        // `pointerup` bewusst auf (siehe `stopPropagation` im Zieh-Effekt).
        // Ein einziger gezogener Zug ließ so einen Finger für immer liegen,
        // und danach war jeder weitere Zug für das Brett schon der zweite
        // Finger: Statt der Figur bewegte sich ein Pfeil.
        if (!event.isPrimary) {
          if (drawing) return;
          // Der erste Finger hat womöglich schon eine Figur angehoben · die
          // Geste ist jetzt eine andere.
          clearOnLift = false;
          cancelPointerDragRef.current?.();
          // Das Loslassen schickt in der WebView noch einen Klick hinterher;
          // der darf keine Figur auswählen.
          suppressClickUntilRef.current = Date.now() + 800;
          beginShape(event);
          return;
        }
        clearOnLift = true;
        return;
      }
      // Ein Linksklick wischt die Markierungen weg · wie bei Lichess, und ohne
      // dem Zug oder der Feldauswahl darunter in die Quere zu kommen.
      if (event.button === 0) {
        setShapes((current) => (current.length === 0 ? current : []));
        setPendingShape(null);
        return;
      }
      if (event.button !== 2) return;
      beginShape(event);
    };

    const onMove = (event: PointerEvent) => {
      if (!drawing || event.pointerId !== drawing.pointerId) return;
      // Der Anfang wird festgehalten, bevor React die Funktion unten aufruft:
      // `drawing` ist dann längst leer, wenn der Zeiger inzwischen los ist.
      const { square: from, color } = drawing;
      const square = squareAtEvent(event) ?? from;
      setPendingShape((current) =>
        current && current.from === from && current.to === square
          ? current
          : { from, to: square, color }
      );
    };

    /**
     * Zwei Finger auf dem Brett sind sonst eine Wischgeste · die Seite würde
     * unter dem gezogenen Pfeil wegscrollen und die Geste abbrechen.
     */
    const onTouchMove = (event: TouchEvent) => {
      if (drawing) event.preventDefault();
    };

    const finishTouch = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary || !clearOnLift) return;
      clearOnLift = false;
      setShapes((current) => (current.length === 0 ? current : []));
    };

    const onUp = (event: PointerEvent) => {
      if (drawing && event.pointerId === drawing.pointerId) {
        const shape = {
          from: drawing.square,
          to: squareAtEvent(event) ?? drawing.square,
          color: drawing.color,
        };
        drawing = null;
        setPendingShape(null);
        setShapes((current) => toggleShape(current, shape));
      }
      finishTouch(event);
    };

    const onCancel = (event: PointerEvent) => {
      if (drawing && event.pointerId === drawing.pointerId) {
        drawing = null;
        setPendingShape(null);
      }
      finishTouch(event);
    };

    // Das Kontextmenü würde den gezogenen Pfeil mit sich reißen.
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    // In der Griffphase, weil der Figurenzug seine eigenen Zeigerereignisse
    // anhält, sobald er läuft · aufgeräumt werden muss hier trotzdem.
    surface.addEventListener("pointerdown", onDown);
    surface.addEventListener("contextmenu", onContextMenu);
    surface.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    return () => {
      surface.removeEventListener("pointerdown", onDown);
      surface.removeEventListener("contextmenu", onContextMenu);
      surface.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
  }, [orientation]);

  // Eine neue Stellung ist eine neue Frage · die Markierungen der alten gehen.
  useEffect(() => {
    setShapes((current) => (current.length === 0 ? current : []));
    setPendingShape(null);
  }, [fen]);

  /**
   * Engine-Pfeile zuunterst, eigene darüber: Wer selbst etwas einzeichnet,
   * meint es und soll es auch sehen.
   */
  const shownShapes = useMemo(
    () => (pendingShape ? [...shapes, pendingShape] : shapes),
    [shapes, pendingShape]
  );
  const shownArrows = useMemo(() => {
    const own = shownShapes
      .filter((shape) => shape.from !== shape.to)
      .map((shape): BoardArrow => [shape.from, shape.to, shape.color]);
    return own.length === 0 ? arrows : [...arrows, ...own];
  }, [arrows, shownShapes]);

  /**
   * Zug- und Schlagklänge hängen an der Stellung, nicht am Eingabeweg: so
   * klingen der eigene Zug, die Engine-Antwort, der Setup-Zug einer Aufgabe
   * und das Blättern in der Zugliste gleichermaßen · und jedes Brett der App
   * bekommt den Ton, ohne ihn selbst anzumelden.
   *
   * Geklungen wird je Stellungswechsel und nicht je Brett · siehe
   * `schonGeklungen` oben.
   */
  const soundFenRef = useRef(fen);
  useEffect(() => {
    const previous = soundFenRef.current;
    soundFenRef.current = fen;
    if (silent) return;
    if (schonGeklungen(previous, fen)) return;
    soundsForTransition(previous, fen).forEach((kind) => playBoardSound(kind));
  }, [fen, silent]);

  /**
   * Windows WebView2 and Android WebView do not consistently deliver the
   * HTML5/react-dnd event sequence.  The affected boards therefore use one
   * small Pointer Events implementation for mouse, pen and touch alike.
   *
   * We keep the drag preview outside React so showing the legal targets cannot
   * rebuild the drag source while the pointer is already moving.
   */
  useEffect(() => {
    if (!mouseDrag) return;
    const board = ref.current;
    if (!board) return;

    type DragSession = {
      pointerId: number;
      source: string;
      piece: HTMLElement;
      ghost: HTMLElement | null;
      started: boolean;
      startX: number;
      startY: number;
      offsetX: number;
      offsetY: number;
      width: number;
      height: number;
    };

    let session: DragSession | null = null;
    let previewFrame: number | null = null;
    let previewX = 0;
    let previewY = 0;

    const removePreview = () => {
      if (previewFrame != null) {
        cancelUiFrame(previewFrame);
        previewFrame = null;
      }
      if (!session) return;
      session.piece.style.visibility = "";
      session.ghost?.remove();
      session = null;
      startTransition(() => setDragSource(null));
    };
    cancelPointerDragRef.current = removePreview;

    type DragEvent = PointerEvent | MouseEvent;
    const eventId = (event: DragEvent) => ("pointerId" in event ? event.pointerId : -1);

    const paintPreview = () => {
      previewFrame = null;
      if (!session?.ghost) return;
      session.ghost.style.transform = `translate3d(${previewX}px, ${previewY}px, 0)`;
    };

    const movePreview = (event: DragEvent, immediate = false) => {
      if (!session?.ghost) return;
      previewX = event.clientX - session.offsetX;
      previewY = event.clientY - session.offsetY;
      if (immediate) {
        if (previewFrame != null) cancelUiFrame(previewFrame);
        paintPreview();
      } else if (previewFrame == null) {
        // Pointer events can arrive much faster than the display refresh. One
        // transform write per frame keeps input dispatch practically free.
        previewFrame = requestUiFrame(paintPreview);
      }
    };

    const beginPreview = (event: DragEvent) => {
      if (!session || session.started) return;
      session.started = true;
      // Falls die WebView beim ersten Pixel bereits eine Koordinate markiert
      // hat, wird diese Auswahl beim tatsächlichen Drag sofort entfernt.
      window.getSelection()?.removeAllRanges();

      const ghost = session.piece.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${session.width}px`,
        height: `${session.height}px`,
        margin: "0",
        opacity: "0.94",
        pointerEvents: "none",
        transition: "none",
        willChange: "transform",
        zIndex: "2147483000",
        cursor: "grabbing",
      });
      document.body.appendChild(ghost);
      session.ghost = ghost;
      session.piece.style.visibility = "hidden";
      startTransition(() => setDragSource(session?.source ?? null));
      movePreview(event, true);
    };

    const onDragDown = (event: DragEvent) => {
      if (
        session
        || !draggableRef.current
        || !dropRef.current
        || event.button !== 0
        || ("isPrimary" in event && event.isPrimary === false)
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const piece = target?.closest<HTMLElement>("[data-piece]");
      const square = piece?.closest<HTMLElement>("[data-square]");
      const source = square?.dataset.square;
      if (!piece || !source || !board.contains(piece)) return;
      if (Object.keys(moveTargetStyles(fenRef.current, source)).length === 0) return;

      const rect = piece.getBoundingClientRect();
      session = {
        pointerId: eventId(event),
        source,
        piece,
        ghost: null,
        started: false,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
    };

    const onDragMove = (event: DragEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      if (
        !session.started
        && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4
      ) {
        return;
      }
      beginPreview(event);
      event.preventDefault();
      event.stopPropagation();
      movePreview(event);
    };

    const onDragUp = (event: DragEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      if (!session.started) {
        session = null;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const source = session.source;
      const targetSquare = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-square]");
      // Several pages can temporarily contain a preview board next to the
      // active one. A drag belongs exclusively to the board it started on.
      const target = targetSquare && board.contains(targetSquare)
        ? targetSquare.dataset.square
        : undefined;

      // Android kann den zum Pointer-Up gehörenden Kompatibilitäts-Klick erst
      // deutlich später senden. Er darf den eben ausgeführten Zug nicht noch
      // einmal als Click-&-Move-Eingabe behandeln.
      const delayedCompatibilityClick =
        isAndroidWebView() || ("pointerType" in event && event.pointerType === "touch");
      suppressClickUntilRef.current = Date.now() + (delayedCompatibilityClick ? 600 : 50);
      removePreview();
      if (target) dropRef.current?.(source, target);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      removePreview();
    };

    board.addEventListener("pointerdown", onDragDown, true);
    board.addEventListener("mousedown", onDragDown, true);
    window.addEventListener("pointermove", onDragMove, { capture: true, passive: false });
    window.addEventListener("mousemove", onDragMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onDragUp, { capture: true, passive: false });
    window.addEventListener("mouseup", onDragUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      if (cancelPointerDragRef.current === removePreview) {
        cancelPointerDragRef.current = null;
      }
      removePreview();
      board.removeEventListener("pointerdown", onDragDown, true);
      board.removeEventListener("mousedown", onDragDown, true);
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("mousemove", onDragMove, true);
      window.removeEventListener("pointerup", onDragUp, true);
      window.removeEventListener("mouseup", onDragUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [mouseDrag]);

  /**
   * Der Marker sitzt wie bei chess.com mittig auf der oberen rechten Ecke des
   * Zielfelds und ueberlappt das Nachbarfeld nur minimal.
   *
   * An den Rändern des Bretts rückt er so weit herein, dass er ganz auf dem
   * Brett bleibt (`size` ist sein Durchmesser in Prozent der Brettkante). Auf
   * dem Handy reicht das Brett bis an die Bildschirmkante: Ein Marker auf der
   * h-Linie stand dort zur Hälfte neben dem Brett, und weil der Inhaltsbereich
   * seine Breite mitrechnet, bekam die ganze Seite dadurch eine waagerechte
   * Bildlaufleiste · in der Analyse wie im Fokus. Hereingerückt bleibt der
   * Marker vollständig sichtbar, und das Brett schließt weiter bündig mit
   * der Kante ab.
   */
  const badgePosition = (square: string, size: number) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    const half = size / 2;
    const inside = (percent: number) => Math.min(Math.max(percent, half), 100 - half);
    return {
      left: `${inside((x + 1) * 12.5)}%`,
      top: `${inside(y * 12.5)}%`,
      transform: "translate(-50%, -50%)",
    };
  };

  /** Obere linke Ecke eines Feldes in Prozent · Bezugspunkt für den Ring. */
  const squareBox = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    return { left: `${x * 12.5}%`, top: `${y * 12.5}%` };
  };

  // Der Streifen ist eine Aussage, keine Sperre: er verschwindet auf Klick und
  // kommt bei jedem neuen Partieende zurück.
  const [endDismissed, setEndDismissed] = useState(false);
  const endKey = end ? `${end.label}|${end.square ?? ""}` : "";
  const lastEndKeyRef = useRef(endKey);
  if (lastEndKeyRef.current !== endKey) {
    lastEndKeyRef.current = endKey;
    if (endDismissed) setEndDismissed(false);
  }
  const endSquare = end?.square && /^[a-h][1-8]$/.test(end.square) ? end.square : null;

  return (
    <div
      ref={ref}
      className={`kiebitz-board ${shake ? "animate-shake " : ""}${draggable && mouseDrag ? "board-pointer-drag" : ""}`}
      style={{ width: "100%", maxWidth: width }}
      onClickCapture={(event) => {
        if (Date.now() > suppressClickUntilRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickUntilRef.current = 0;
      }}
      onDragStartCapture={(event) => event.preventDefault()}
    >
      <div ref={surfaceRef} className="relative" style={{ width: w, height: w }}>
        <BoardSurface
          android={isAndroidWebView()}
          boardId={boardId}
          dragSource={dragSource}
          draggable={draggable}
          fen={fen}
          hasDropHandler={onPieceDrop != null}
          hasSquareClickHandler={onSquareClick != null}
          mouseDrag={mouseDrag}
          muted={muted}
          onPieceDragBegin={handlePieceDragBegin}
          onPieceDragEnd={handlePieceDragEnd}
          onPieceDrop={handlePieceDrop}
          onSquareClick={handleSquareClick}
          orientation={orientation}
          pieceGlyphs={pieceGlyphs}
          lastMove={lastMove}
          squareStyles={squareStyles ?? EMPTY_STYLES}
        />
        <BoardArrows arrows={shownArrows} orientation={orientation} />
        <BoardCircles shapes={shownShapes} orientation={orientation} />
        {badges.map((badge, index) => (
          <span
            key={`${badge.square}-${index}`}
            title={badge.title}
            className="pointer-events-none absolute z-20 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-white/85 text-[clamp(7px,1.05vw,11px)] font-extrabold leading-none text-white shadow-md"
            style={{
              ...badgePosition(badge.square, BADGE_SIZE),
              height: `${BADGE_SIZE}%`,
              width: `${BADGE_SIZE}%`,
              background: badge.color,
            }}
          >
            {badge.label}
          </span>
        ))}
        {end && (
          <div data-testid="board-end" aria-live="polite">
            {endSquare && (
              <>
                <span
                  aria-hidden="true"
                  key={`flash-${endKey}`}
                  className="board-end-flash pointer-events-none absolute z-20 h-[12.5%] w-[12.5%] rounded-full"
                  style={{
                    left: squareBox(endSquare).left,
                    top: squareBox(endSquare).top,
                    boxShadow: `inset 0 0 0 max(2px, 0.5vw) ${end.color}`,
                  }}
                />
                {/* Der Marker sitzt auf der oberen rechten Feldecke · dieselbe
                    Stelle wie die Zugqualitaets-Marker. Mittig auf dem Feld
                    verdeckte er die Figur, um die es gerade geht. */}
                <span
                  key={`mark-${endKey}`}
                  data-testid="board-end-mark"
                  className="board-end-mark pointer-events-none absolute z-30 flex min-h-4 min-w-4 items-center justify-center rounded-full border border-white/90 text-[clamp(8px,1.2vw,13px)] font-extrabold leading-none text-white shadow-lg"
                  style={{
                    ...badgePosition(endSquare, END_MARK_SIZE),
                    height: `${END_MARK_SIZE}%`,
                    width: `${END_MARK_SIZE}%`,
                    background: end.color,
                  }}
                >
                  {end.mark}
                </span>
              </>
            )}
            {end.label !== "" && !endDismissed && (
              <div className="absolute inset-x-0 bottom-[7%] z-30 flex justify-center px-3">
                <button
                  type="button"
                  key={`strip-${endKey}`}
                  onClick={() => setEndDismissed(true)}
                  title={end.dismissLabel}
                  aria-label={`${end.label} · ${end.dismissLabel}`}
                  className="board-end-strip max-w-full truncate rounded-lg border border-line2 bg-overlay px-3.5 py-1.5 text-[clamp(11px,1.25vw,13.5px)] font-semibold text-ink shadow-xl backdrop-blur-[2px] transition-colors hover:bg-bg"
                >
                  {end.label}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
