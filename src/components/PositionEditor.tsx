/**
 * Stellung aufbauen oder als FEN einlesen.
 *
 * Der häufigste Weg einer Stellung in ein Schachprogramm führt nicht über eine
 * Partie, sondern über ein Buch, eine Zeitschrift oder den Vereinsabend: Man
 * hat ein Diagramm vor sich und will wissen, was die Engine dazu sagt. Dafür
 * gibt es zwei Eingänge, die beide dasselbe Ergebnis haben: Figuren aufs Brett
 * setzen oder eine FEN einfügen. Das Textfeld folgt dem Brett und umgekehrt,
 * sodass man mit dem einen anfangen und mit dem anderen nachbessern kann.
 *
 * Geprüft wird laufend und nicht erst beim Übernehmen · wer „Analysieren"
 * drückt, soll keine Fehlermeldung bekommen, sondern vorher sehen, dass der
 * schwarze König fehlt. Rochaderechte bietet der Editor nur an, wo König und
 * Turm auch stehen; in Chess960 auf jeder Seite des Königs (siehe
 * lib/chess960.ts).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Eraser,
  FlipVertical2,
  Hand,
  LayoutGrid,
  Microscope,
  RotateCcw,
  Shuffle,
  Swords,
  Trash2,
  X,
} from "lucide-react";
import Board from "./Board";
import { Button } from "./ui";
import { useBackDismiss } from "../lib/backDismiss";
import { useI18n, type Key } from "../lib/i18n";
import { PIECE_VIEWBOX } from "../lib/pieces/glyphs";
import { usePieceGlyphs } from "../lib/pieces/usePieceSet";
import {
  formatCastling,
  needsChess960,
  parseCastling,
  randomChess960,
  validatePosition,
  type CastlingRights,
} from "../lib/chess960";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const EMPTY_FEN = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
const FILES = "abcdefgh";

type Grid = (string | null)[][];
/** Werkzeug der Palette: eine Figur (FEN-Zeichen), der Radierer oder die Hand. */
type Tool = string | "erase" | "move";

interface EditorState {
  grid: Grid;
  turn: "w" | "b";
  /** Gewünschte Rochaderechte · angeboten nur, wo sie möglich sind. */
  castle: { K: boolean; Q: boolean; k: boolean; q: boolean };
  ep: string;
  half: number;
  full: number;
  chess960: boolean;
}

/** Reihe 0 ist die erste Reihe · wie in lib/chess960.ts. */
function gridOf(placement: string): Grid {
  const rows = placement.split("/");
  const grid: Grid = [];
  for (let rank = 0; rank < 8; rank++) {
    const row: (string | null)[] = [];
    for (const ch of rows[7 - rank] ?? "") {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
      else row.push(ch);
    }
    while (row.length < 8) row.push(null);
    grid.push(row.slice(0, 8));
  }
  return grid;
}

function placementOf(grid: Grid): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = grid[rank][file];
      if (piece == null) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += piece;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/");
}

/** Liest eine FEN in den Editor · null, wenn schon die Belegung nicht passt. */
export function parseEditorFen(text: string): EditorState | null {
  const parts = text.trim().split(/\s+/);
  const placement = parts[0] ?? "";
  if (!/^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+$/.test(placement)) return null;
  const grid = gridOf(placement);
  if (grid.some((row) => row.length !== 8)) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  const castling = parts[2] ?? "-";
  const rights = parseCastling(castling, placement);
  const fen = [placement, turn, castling, parts[3] ?? "-", parts[4] ?? "0", parts[5] ?? "1"].join(" ");
  return {
    grid,
    turn,
    castle: { K: rights.w.k != null, Q: rights.w.q != null, k: rights.b.k != null, q: rights.b.q != null },
    ep: /^[a-h][36]$/.test(parts[3] ?? "") ? parts[3] : "-",
    half: Math.max(0, Number(parts[4]) || 0),
    full: Math.max(1, Number(parts[5]) || 1),
    chess960: needsChess960(fen),
  };
}

/**
 * Welche Rochaden die Belegung überhaupt zulässt · der König auf der
 * Grundreihe und ein Turm auf der jeweiligen Seite. Im Standardschach
 * genauer: König auf e, Turm auf a oder h.
 */
function possibleRights(grid: Grid, chess960: boolean): CastlingRights {
  const rights: CastlingRights = { w: { k: null, q: null }, b: { k: null, q: null } };
  for (const color of ["w", "b"] as const) {
    const rank = color === "w" ? 0 : 7;
    const king = grid[rank].indexOf(color === "w" ? "K" : "k");
    if (king < 0) continue;
    const rook = color === "w" ? "R" : "r";
    if (!chess960) {
      if (king !== 4) continue;
      if (grid[rank][7] === rook) rights[color].k = 7;
      if (grid[rank][0] === rook) rights[color].q = 0;
      continue;
    }
    for (let f = 7; f > king; f--) if (grid[rank][f] === rook) { rights[color].k = f; break; }
    for (let f = 0; f < king; f++) if (grid[rank][f] === rook) { rights[color].q = f; break; }
  }
  return rights;
}

function fenOf(state: EditorState): string {
  const placement = placementOf(state.grid);
  const possible = possibleRights(state.grid, state.chess960);
  const wanted: CastlingRights = {
    w: { k: state.castle.K ? possible.w.k : null, q: state.castle.Q ? possible.w.q : null },
    b: { k: state.castle.k ? possible.b.k : null, q: state.castle.q ? possible.b.q : null },
  };
  const castling = formatCastling(wanted, placement, state.chess960);
  return [placement, state.turn, castling, state.ep, String(state.half), String(state.full)].join(" ");
}

const ERROR_KEY: Record<string, Key> = {
  kings: "pe.errKings",
  check: "pe.errCheck",
};

/** Übersetzt, was an einer Stellung nicht stimmt. */
function errorKey(code: string): Key {
  if (ERROR_KEY[code]) return ERROR_KEY[code];
  if (/pawn/i.test(code)) return "pe.errPawns";
  if (/king/i.test(code)) return "pe.errKings";
  return "pe.errInvalid";
}

const PALETTE = ["K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];

export interface PositionEditorResult {
  fen: string;
  chess960: boolean;
}

export default function PositionEditor({
  initialFen = START_FEN,
  onClose,
  onAnalyze,
  onPlay,
}: {
  initialFen?: string;
  onClose: () => void;
  /** Stellung ans freie Brett der Analyse · ohne Angabe fehlt der Knopf. */
  onAnalyze?: (result: PositionEditorResult) => void;
  /** Aus der Stellung gegen die Engine spielen. */
  onPlay?: (result: PositionEditorResult) => void;
}) {
  const { t } = useI18n();
  const glyphs = usePieceGlyphs();
  const [state, setState] = useState<EditorState>(
    () => parseEditorFen(initialFen) ?? parseEditorFen(START_FEN)!
  );
  const [tool, setTool] = useState<Tool>("move");
  const [flipped, setFlipped] = useState(false);
  const fen = useMemo(() => fenOf(state), [state]);
  const [fenText, setFenText] = useState(fen);
  const [fenError, setFenError] = useState(false);
  const typing = useRef(false);
  useBackDismiss(onClose);

  // Das Textfeld folgt dem Brett · außer während man darin tippt, sonst
  // spränge der Cursor bei jeder Taste ans Ende.
  useEffect(() => {
    if (!typing.current) {
      setFenText(fen);
      setFenError(false);
    }
  }, [fen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const problem = useMemo(() => validatePosition(fen), [fen]);
  const possible = useMemo(() => possibleRights(state.grid, state.chess960), [state.grid, state.chess960]);

  const update = (patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) =>
    setState((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch), ep: "-" }));

  const setSquare = (square: string, piece: string | null) =>
    update((current) => {
      const grid = current.grid.map((row) => [...row]);
      grid[Number(square[1]) - 1][FILES.indexOf(square[0])] = piece;
      return { grid };
    });

  const onSquareClick = (square: string) => {
    if (tool === "move") return;
    const current = state.grid[Number(square[1]) - 1][FILES.indexOf(square[0])];
    if (tool === "erase") setSquare(square, null);
    // Dieselbe Figur noch einmal auf dasselbe Feld nimmt sie wieder weg · so
    // braucht das schnelle Aufbauen kein Umschalten auf den Radierer.
    else setSquare(square, current === tool ? null : tool);
  };

  const onPieceDrop = (from: string, to: string) => {
    if (from === to) return false;
    update((current) => {
      const grid = current.grid.map((row) => [...row]);
      const piece = grid[Number(from[1]) - 1][FILES.indexOf(from[0])];
      grid[Number(from[1]) - 1][FILES.indexOf(from[0])] = null;
      grid[Number(to[1]) - 1][FILES.indexOf(to[0])] = piece;
      return { grid };
    });
    return true;
  };

  const loadFen = (text: string) => {
    const parsed = parseEditorFen(text);
    if (!parsed) {
      setFenError(true);
      return;
    }
    setFenError(false);
    setState(parsed);
  };

  const reset = (next: string, chess960 = false) => {
    const parsed = parseEditorFen(next)!;
    setState({ ...parsed, chess960: chess960 || parsed.chess960 });
  };

  const result = (): PositionEditorResult => ({ fen, chess960: state.chess960 && needsChess960(fen) });

  const castleBox = (key: "K" | "Q" | "k" | "q", label: string) => {
    const color = key === key.toUpperCase() ? "w" : "b";
    const side = key.toLowerCase() as "k" | "q";
    const available = possible[color][side] != null;
    return (
      <label
        className={`flex items-center gap-2 text-[12.5px] ${available ? "cursor-pointer text-ink2" : "text-ink3 opacity-60"}`}
      >
        <input
          type="checkbox"
          disabled={!available}
          checked={available && state.castle[key]}
          onChange={(event) => update((current) => ({ castle: { ...current.castle, [key]: event.target.checked } }))}
          className="size-4 accent-[var(--color-accent)]"
        />
        {label}
      </label>
    );
  };

  const paletteButton = (code: string) => {
    const glyphKey = `${code === code.toUpperCase() ? "w" : "b"}${code.toUpperCase()}`;
    const active = tool === code;
    return (
      <button
        key={code}
        type="button"
        onClick={() => setTool(active ? "move" : code)}
        aria-pressed={active}
        aria-label={t("pe.place", { piece: t(PIECE_NAME[code.toLowerCase()]) })}
        title={t("pe.place", { piece: t(PIECE_NAME[code.toLowerCase()]) })}
        className={`flex aspect-square min-h-10 items-center justify-center rounded-lg border transition-colors ${
          active ? "border-accent bg-accent-soft" : "border-line bg-panel2 hover:bg-panel3"
        }`}
      >
        <svg
          viewBox={PIECE_VIEWBOX}
          className="h-[78%] w-[78%]"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: glyphs[glyphKey] ?? "" }}
        />
      </button>
    );
  };

  const toolButton = (value: Tool, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setTool(value)}
      aria-pressed={tool === value}
      title={label}
      aria-label={label}
      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors ${
        tool === value ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel2 text-ink2 hover:bg-panel3"
      }`}
    >
      {icon}
    </button>
  );

  const dialog = (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="position-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[94vh] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <LayoutGrid size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="position-editor-title" className="text-[16px] font-semibold">
              {t("pe.title")}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink3">{t("pe.lead")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid gap-5 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <div className="min-w-0">
              <Board
                boardId="position-editor"
                fen={fen}
                width={420}
                orientation={flipped ? "black" : "white"}
                draggable
                mouseDrag
                silent
                onPieceDrop={onPieceDrop}
                onSquareClick={onSquareClick}
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">
                {tool === "move" ? t("pe.hintMove") : tool === "erase" ? t("pe.hintErase") : t("pe.hintPlace")}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
                  {t("pe.pieces")}
                </div>
                <div className="grid grid-cols-6 gap-1.5">{PALETTE.map(paletteButton)}</div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {toolButton("move", <><Hand size={15} /> {t("pe.toolMove")}</>, t("pe.toolMove"))}
                  {toolButton("erase", <><Eraser size={15} /> {t("pe.toolErase")}</>, t("pe.toolErase"))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
                  {t("pe.toMove")}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["w", "b"] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => update({ turn: color })}
                      aria-pressed={state.turn === color}
                      className={`min-h-10 rounded-lg border px-3 text-[12.5px] transition-colors ${
                        state.turn === color
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line bg-panel2 text-ink2 hover:bg-panel3"
                      }`}
                    >
                      {t(color === "w" ? "common.white" : "common.black")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
                  {t("pe.castling")}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {castleBox("K", `${t("common.white")} O-O`)}
                  {castleBox("Q", `${t("common.white")} O-O-O`)}
                  {castleBox("k", `${t("common.black")} O-O`)}
                  {castleBox("q", `${t("common.black")} O-O-O`)}
                </div>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink2">
                  <input
                    type="checkbox"
                    checked={state.chess960}
                    onChange={(event) => update({ chess960: event.target.checked })}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {t("pe.chess960")}
                </label>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Button compact onClick={() => reset(START_FEN)} label={t("pe.start")} title={t("pe.start")}>
                  <RotateCcw size={14} /> {t("pe.start")}
                </Button>
                <Button
                  compact
                  onClick={() => reset(randomChess960().fen, true)}
                  label={t("pe.random960")}
                  title={t("pe.random960")}
                >
                  <Shuffle size={14} /> {t("pe.random960")}
                </Button>
                <Button compact onClick={() => reset(EMPTY_FEN)} label={t("pe.clear")} title={t("pe.clear")}>
                  <Trash2 size={14} /> {t("pe.clear")}
                </Button>
                <Button compact onClick={() => setFlipped((v) => !v)} label={t("an.flip")} title={t("an.flip")}>
                  <FlipVertical2 size={14} /> {t("an.flip")}
                </Button>
              </div>

              <div>
                <label
                  htmlFor="position-editor-fen"
                  className="mb-1.5 block text-[11.5px] font-medium uppercase tracking-wide text-ink3"
                >
                  FEN
                </label>
                <textarea
                  id="position-editor-fen"
                  value={fenText}
                  rows={2}
                  spellCheck={false}
                  onFocus={() => (typing.current = true)}
                  onBlur={() => {
                    typing.current = false;
                    loadFen(fenText);
                  }}
                  onChange={(event) => {
                    setFenText(event.target.value);
                    // Eine vollständige FEN übernimmt das Brett sofort · so
                    // wirkt Einfügen, ohne dass man erst hinausklicken muss.
                    const parsed = parseEditorFen(event.target.value);
                    if (parsed) {
                      setFenError(false);
                      setState(parsed);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      loadFen(fenText);
                    }
                  }}
                  className={`w-full resize-none rounded-lg border bg-panel2 px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors ${
                    fenError ? "border-loss" : "border-line focus:border-line2"
                  }`}
                />
                {fenError && <p className="mt-1 text-[12px] text-loss">{t("pe.fenUnreadable")}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
          <p
            role="status"
            className={`min-w-0 flex-1 text-[12.5px] ${problem ? "text-loss" : "text-ink3"}`}
          >
            {problem ? t(errorKey(problem)) : t(state.turn === "w" ? "sh.whiteToMove" : "sh.blackToMove")}
          </p>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          {onPlay && (
            <Button disabled={problem != null} onClick={() => onPlay(result())}>
              <Swords size={14} /> {t("pe.play")}
            </Button>
          )}
          {onAnalyze && (
            <Button primary disabled={problem != null} onClick={() => onAnalyze(result())}>
              <Microscope size={14} /> {t("pe.analyze")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

const PIECE_NAME: Record<string, Key> = {
  k: "pe.king",
  q: "pe.queen",
  r: "pe.rook",
  b: "pe.bishop",
  n: "pe.knight",
  p: "pe.pawn",
};

