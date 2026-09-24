/**
 * Gegen die Engine spielen.
 *
 * Nach einer Fehleranalyse ist „ab hier weiterspielen" die naheliegendste
 * Erwartung, und jede freie GUI kann es. Die Engine lief in Kiebitz längst ·
 * es fehlte die Partie drumherum: Farbe, Stärke, Ausgangsstellung, Zugrücknahme,
 * Aufgeben und der Weg zurück in die Analyse.
 *
 * Drei Ausgangsstellungen: die Grundstellung, eine Chess960-Aufstellung und
 * jede Stellung, die von außen hereinkommt (Analyse, Stellungseditor). Die
 * Regeln laufen über `VariantChess` (lib/chess960.ts), damit Chess960 und
 * Standardschach denselben Weg nehmen.
 *
 * Die Engine sucht im Backend (src-tauri/src/play.rs) · in der Web-Vorschau
 * gibt es keins, dort antwortet ein Zufallszug, und die Seite sagt das.
 */
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import {
  ChevronLeft,
  Dices,
  Flag,
  FlipVertical2,
  LayoutGrid,
  Loader2,
  Microscope,
  Play as PlayIcon,
  RotateCcw,
  Save,
  Swords,
  Undo2,
} from "lucide-react";
import Board from "../components/Board";
import { useBoardEndView } from "../components/BoardEndView";
import { Button, Card, Chip } from "../components/ui";
import { useMobileShell } from "../components/MobileShell";
import FocusBoard, { FocusButton } from "../components/FocusBoard";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { BOARD_MAX } from "../lib/boardLayout";
import { lastMoveStyles, selectedStyle } from "../lib/boardMoves";
import type { BoardEnd, Termination } from "../lib/boardEnd";
import { VariantChess, randomChess960, type VariantMove } from "../lib/chess960";
import { blunderChance, loadSetup, playMove, PLAY_LEVELS, saveSetup, type PlaySetup } from "../lib/play";
import { upsertGames, type GameRecord } from "../lib/db";
import { useDiagramMode } from "../lib/diagramMode";
import { useTrainingSession } from "../lib/session";
import { LeereSeite } from "../components/blatt/LeereSeite";

const PositionEditor = lazy(() => import("../components/PositionEditor"));
const PlayBlatt = lazy(() => import("./blatt/PlayBlatt"));

export const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Eine Partie, die in die Analyse wandert · Ausgangsstellung plus Züge. */
export interface PlayLine {
  fen: string;
  sans: string[];
  chess960: boolean;
}

type Status = "setup" | "playing" | "thinking" | "over";

interface Outcome {
  /** Aus Sicht von Weiß. */
  result: "1-0" | "0-1" | "1/2-1/2";
  reason: Termination;
  winner: "white" | "black" | null;
}

const DOT = "var(--color-mark)";
const quiet: CSSProperties = { background: `radial-gradient(circle, ${DOT} 20%, transparent 21%)` };
const capture: CSSProperties = { background: `radial-gradient(circle, transparent 56%, ${DOT} 58%)` };

/** Stufe des Reglers als Wort · volle Kraft hat keine Zahl. */
export function levelLabel(elo: number, t: (key: Key, vars?: Record<string, string | number>) => string): string {
  return elo === 0 ? t("play.full") : t("play.elo", { n: elo });
}

/** Die Stellung am Ende · nur, was die Regeln sagen; Aufgeben kennt nur die Seite. */
function outcomeOf(game: VariantChess): Outcome | null {
  const mover = game.turn() === "w" ? "black" : "white";
  if (game.isCheckmate()) return { result: mover === "white" ? "1-0" : "0-1", reason: "mate", winner: mover };
  const draw = (reason: Termination): Outcome => ({ result: "1/2-1/2", reason, winner: null });
  if (game.isStalemate()) return draw("stalemate");
  if (game.isInsufficientMaterial()) return draw("insufficient");
  if (game.isThreefoldRepetition()) return draw("repetition");
  if (game.isFiftyMoves()) return draw("fifty");
  return null;
}

function kingSquare(game: VariantChess, color: "w" | "b"): string | null {
  for (const row of game.board()) {
    for (const cell of row) if (cell && cell.type === "k" && cell.color === color) return cell.square;
  }
  return null;
}

/** Ein Zug für die Web-Vorschau · Schlagen und Schach bevorzugt, sonst Zufall. */
function previewMove(game: VariantChess): VariantMove | null {
  const moves = game.moves();
  if (moves.length === 0) return null;
  const sharp = moves.filter((m) => m.captured || m.san.includes("+"));
  const pool = sharp.length > 0 && Math.random() < 0.7 ? sharp : moves;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function Play({
  initial = null,
  openAnalysis,
  onBack,
}: {
  /** Stellung, aus der gespielt werden soll · aus Analyse oder Editor. */
  initial?: { fen: string; chess960: boolean } | null;
  openAnalysis: (line: PlayLine) => void;
  /**
   * Zurück in die Analyse · die Seite ist eine Ebene von ihr, kein eigener
   * Reiter. Mobil trägt die App-Bar den Pfeil, auf dem Desktop steht der Weg
   * über dem Titel.
   */
  onBack?: () => void;
}) {
  const { t, locale } = useI18n();
  const backend = useBackendInfo();
  const desktop = backend.mode === "desktop";
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  // Eine Partie gegen die Engine ist Spielpraxis · sie zählt wie die Analyse
  // als Zeit am Brett.
  useTrainingSession("analysis", desktop);

  const [setup, setSetupState] = useState<PlaySetup>(loadSetup);
  const setSetup = (patch: Partial<PlaySetup>) =>
    setSetupState((current) => {
      const next = { ...current, ...patch };
      saveSetup(next);
      return next;
    });

  const gameRef = useRef(new VariantChess(STANDARD_FEN));
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [status, setStatus] = useState<Status>("setup");
  const [human, setHuman] = useState<"w" | "b">("w");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [shake, setShake] = useState(false);
  /** Bezeichnung der Ausgangsstellung · Grundstellung, „Chess960 Nr. 412", eigene. */
  const [startLabel, setStartLabel] = useState<string>("");
  // Eine Engine-Antwort, die nach einem Neustart oder einer Rücknahme
  // ankommt, darf das Brett nicht mehr anfassen.
  const runRef = useRef(0);
  const setupRef = useRef(setup);
  setupRef.current = setup;

  const game = gameRef.current;
  const fen = game.fen();
  const history = game.history();
  const lastMove = history[history.length - 1] ?? null;

  const finish = (result: Outcome) => {
    setOutcome(result);
    setStatus("over");
  };

  const engineTurn = () => {
    const run = runRef.current;
    const current = gameRef.current;
    setStatus("thinking");
    const apply = (uci: string | null) => {
      if (run !== runRef.current) return;
      const move = uci ? current.move(uci) : previewMove(current);
      if (!uci && move) current.play(move);
      if (!move) {
        setError(t("play.engineFailed"));
        setStatus("playing");
        return;
      }
      redraw();
      const end = outcomeOf(current);
      if (end) finish(end);
      else setStatus("playing");
    };
    // In der Web-Vorschau immer, unter 1320 ab und zu: ein beliebiger Zug
    // statt des Engine-Zuges (siehe `blunderChance`).
    if (!desktop || Math.random() < blunderChance(setupRef.current.elo)) {
      window.setTimeout(() => apply(null), 450);
      return;
    }
    playMove({
      startFen: current.initialFen(),
      moves: current.history().map((m) => m.uci),
      chess960: current.chess960,
      elo: setupRef.current.elo,
      movetimeMs: setupRef.current.movetimeMs,
    })
      .then((reply) => apply(reply.bestmove))
      .catch((reason) => {
        if (run !== runRef.current) return;
        setError(String(reason));
        setStatus("playing");
      });
  };

  const start = (startFen: string, chess960: boolean, label: string, color?: "w" | "b") => {
    runRef.current += 1;
    const next = new VariantChess(startFen, { chess960 });
    gameRef.current = next;
    const own: "w" | "b" =
      color ?? (setup.color === "random" ? (Math.random() < 0.5 ? "w" : "b") : setup.color === "black" ? "b" : "w");
    setHuman(own);
    setFlipped(false);
    setOutcome(null);
    setSelected(null);
    setError(null);
    setSaved(false);
    setStartLabel(label);
    redraw();
    const end = outcomeOf(next);
    if (end) {
      finish(end);
      return;
    }
    setStatus("playing");
    if (next.turn() !== own) window.setTimeout(engineTurn, 350);
  };

  const startNew = () => {
    if (setup.start === "chess960") {
      const { id, fen: startFen } = randomChess960();
      start(startFen, true, t("play.start960", { n: id }));
    } else {
      start(STANDARD_FEN, false, t("pe.start"));
    }
  };

  // Aus Analyse oder Editor: sofort los, mit der Seite am Zug.
  useEffect(() => {
    if (!initial) return;
    const side = initial.fen.split(" ")[1] === "b" ? "b" : "w";
    start(initial.fen, initial.chess960, t("play.startCustom"), side);
    // Nur beim Hereinkommen · spätere Renders ändern `initial` nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const tryMove = (from: string, to: string): boolean => {
    if (status !== "playing" || game.turn() !== human) return false;
    const move = game.move({ from, to, promotion: "q" });
    if (!move) return false;
    setSelected(null);
    setError(null);
    redraw();
    const end = outcomeOf(game);
    if (end) finish(end);
    else engineTurn();
    return true;
  };

  const onSquareClick = (square: string) => {
    if (status !== "playing" || game.turn() !== human) return;
    const piece = game.get(square as never);
    if (selected && selected !== square) {
      if (tryMove(selected, square)) return;
      if (piece && piece.color === human) setSelected(square);
      else {
        setShake(true);
        window.setTimeout(() => setShake(false), 600);
        setSelected(null);
      }
      return;
    }
    if (piece && piece.color === human) setSelected(selected === square ? null : square);
  };

  /** Den eigenen letzten Zug zurücknehmen · samt der Antwort, falls es eine gab. */
  const takeBack = () => {
    if (history.length === 0) return;
    runRef.current += 1;
    game.undo();
    if (game.turn() !== human && game.history().length > 0) game.undo();
    setOutcome(null);
    setSelected(null);
    setError(null);
    setSaved(false);
    redraw();
    setStatus("playing");
    // Stand am Anfang die Engine am Zug, muss sie wieder ziehen.
    if (game.turn() !== human) engineTurn();
  };

  const resign = () => {
    runRef.current += 1;
    const winner = human === "w" ? "black" : "white";
    finish({ result: winner === "white" ? "1-0" : "0-1", reason: "resign", winner });
  };

  const line = (): PlayLine => ({
    fen: game.initialFen(),
    sans: history.map((m) => m.san),
    chess960: game.chess960,
  });

  /**
   * Die Partie in die eigene Datenbank · nur aus der Grundstellung. Eine Partie
   * aus einer eigenen Stellung hätte in der Partienliste keinen Anfang: Dort
   * beginnt jede Zugfolge in der Grundstellung.
   */
  const canSave = desktop && status === "over" && !game.chess960 && game.initialFen() === STANDARD_FEN;
  const save = async () => {
    if (!canSave || !outcome) return;
    const now = new Date();
    const color = human === "w" ? "white" : "black";
    const result =
      outcome.winner == null ? "draw" : outcome.winner === color ? "win" : "loss";
    const record: GameRecord = {
      id: null,
      source: "manual",
      source_id: `play-${now.getTime()}`,
      url: "",
      played_at: now.toISOString().slice(0, 10),
      played_ts: Math.floor(now.getTime() / 1000),
      time_class: "classical",
      color,
      opponent: `Stockfish (${levelLabel(setup.elo, t)})`,
      opp_elo: setup.elo,
      my_elo: 0,
      result,
      termination: outcome.reason,
      opening: "",
      eco: "",
      moves_count: Math.ceil(history.length / 2),
      accuracy: null,
      moves: history.map((m) => m.san).join(" "),
      note: "",
      analyzed: false,
    };
    try {
      await upsertGames([record]);
      setSaved(true);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = { ...lastMoveStyles(lastMove) };
    if (selected) {
      styles[selected] = selectedStyle;
      for (const move of game.moves({ square: selected as never })) {
        styles[move.to] = move.captured ? capture : quiet;
        if (move.rookFrom) styles[move.rookFrom] = quiet;
      }
    }
    return styles;
    // `fen` steht für den Stand von `game` · das Objekt selbst bleibt gleich.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, selected, lastMove]);

  const boardEndState: BoardEnd | null = outcome
    ? {
        reason: outcome.reason,
        winner: outcome.winner,
        square:
          outcome.reason === "mate" || outcome.reason === "stalemate" || outcome.reason === "resign"
            ? kingSquare(game, outcome.reason === "resign" ? human : game.turn())
            : null,
      }
    : null;
  const boardEnd = useBoardEndView(boardEndState);

  const orientation: "white" | "black" = (human === "w") !== flipped ? "white" : "black";
  const engineName = desktop ? `Stockfish · ${levelLabel(setup.elo, t)}` : t("play.previewEngine");

  const statusText =
    status === "setup"
      ? t("play.ready")
      : status === "thinking"
        ? t("eg.thinking")
        : status === "over"
          ? t(outcome?.winner == null ? "play.draw" : outcome.winner === (human === "w" ? "white" : "black") ? "play.won" : "play.lost")
          : game.turn() === human
            ? t("eg.yourTurn")
            : t("eg.thinking");

  const board = (boardId: string) => (
    <div className="board-bleed">
      <Board
        boardId={boardId}
        fen={fen}
        width={BOARD_MAX}
        lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
        draggable={status === "playing" && game.turn() === human}
        onPieceDrop={tryMove}
        onSquareClick={onSquareClick}
        squareStyles={squareStyles}
        orientation={orientation}
        shake={shake}
        end={boardEnd}
        mouseDrag
      />
    </div>
  );

  const notation = (
    <ol className="flex flex-wrap gap-x-2 gap-y-1 text-[13px] leading-6">
      {history.length === 0 && <li className="text-ink3">{t("play.noMoves")}</li>}
      {history.map((move, index) => {
        const ply = index + (game.initialFen().split(" ")[1] === "b" ? 1 : 0);
        const moveNo = Number(game.initialFen().split(" ")[5] ?? "1") + Math.floor(ply / 2);
        const white = ply % 2 === 0;
        return (
          <li key={index} className={index === history.length - 1 ? "font-semibold text-ink" : "text-ink2"}>
            {(white || index === 0) && (
              <span className="me-1 text-ink3">{white ? `${moveNo}.` : `${moveNo}…`}</span>
            )}
            {move.san}
          </li>
        );
      })}
    </ol>
  );

  const controls = (inFocus: boolean) => (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "setup" ? (
        <Button primary onClick={startNew}>
          <PlayIcon size={15} /> {t("play.startGame")}
        </Button>
      ) : (
        <>
          <Button onClick={takeBack} disabled={history.length === 0 || status === "thinking"}>
            <Undo2 size={14} /> {t("play.takeBack")}
          </Button>
          {status !== "over" && (
            <Button onClick={resign}>
              <Flag size={14} /> {t("play.resign")}
            </Button>
          )}
          <Button onClick={() => setFlipped((v) => !v)} title={t("an.flip")} label={t("an.flip")} compact>
            <FlipVertical2 size={15} />
          </Button>
          {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
          <Button onClick={() => openAnalysis(line())} disabled={history.length === 0}>
            <Microscope size={14} /> {t("play.toAnalysis")}
          </Button>
          {canSave && (
            <Button onClick={save} disabled={saved}>
              <Save size={14} /> {saved ? t("play.saved") : t("play.save")}
            </Button>
          )}
        </>
      )}
    </div>
  );

  const levelIndex = Math.max(0, PLAY_LEVELS.indexOf(setup.elo));

  const setupForm = (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">{t("play.color")}</div>
        <div className="flex flex-wrap gap-1.5">
          {(["white", "black", "random"] as const).map((value) => (
            <Chip key={value} active={setup.color === value} onClick={() => setSetup({ color: value })}>
              {value === "random" ? t("play.colorRandom") : t(value === "white" ? "common.white" : "common.black")}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-[11.5px] font-medium uppercase tracking-wide text-ink3">
          <span>{t("play.strength")}</span>
          <span className="normal-case tracking-normal text-ink">{levelLabel(setup.elo, t)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={PLAY_LEVELS.length - 1}
          step={1}
          value={levelIndex}
          onChange={(event) => setSetup({ elo: PLAY_LEVELS[Number(event.target.value)] })}
          aria-label={t("play.strength")}
          className="w-full accent-[var(--color-accent)]"
        />
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">{t("play.strengthNote")}</p>
      </div>
      <div>
        <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">{t("play.thinkTime")}</div>
        <div className="flex flex-wrap gap-1.5">
          {[300, 800, 2000, 5000].map((ms) => (
            <Chip key={ms} active={setup.movetimeMs === ms} onClick={() => setSetup({ movetimeMs: ms })}>
              {t("play.seconds", { n: (ms / 1000).toLocaleString(locale) })}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">{t("play.startPosition")}</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={setup.start === "standard"} onClick={() => setSetup({ start: "standard" })}>
            {t("pe.start")}
          </Chip>
          <Chip active={setup.start === "chess960"} onClick={() => setSetup({ start: "chess960" })}>
            <Dices size={13} className="me-1 inline" /> Chess960
          </Chip>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button primary onClick={startNew}>
          {status === "setup" ? <PlayIcon size={15} /> : <RotateCcw size={15} />}
          {status === "setup" ? t("play.startGame") : t("play.newGame")}
        </Button>
        <Button onClick={() => setEditing(true)}>
          <LayoutGrid size={14} /> {t("play.fromPosition")}
        </Button>
      </div>
      {!desktop && <p className="text-[12px] leading-relaxed text-ink3">{t("play.webNote")}</p>}
    </div>
  );

  const playerRow = (color: "w" | "b", name: string) => (
    <div className="flex min-h-7 items-center gap-2 text-[13px]">
      <span
        aria-hidden
        className="inline-block h-3 w-3 flex-none rounded-full border border-line2"
        style={{ background: color === "w" ? "#f4f1ea" : "#1f1f1f" }}
      />
      <span className="truncate font-medium">{name}</span>
      {color === game.turn() && status !== "over" && status !== "setup" && (
        <span className="ms-auto text-[11.5px] text-ink3">{status === "thinking" ? t("eg.thinking") : t("play.toMove")}</span>
      )}
    </div>
  );
  const topColor: "w" | "b" = orientation === "white" ? "b" : "w";
  const nameOf = (color: "w" | "b") => (color === human ? t("play.you") : engineName);

  const editor = editing && (
    <Suspense fallback={null}>
      <PositionEditor
        initialFen={fen}
        onClose={() => setEditing(false)}
        onPlay={({ fen: next, chess960 }) => {
          setEditing(false);
          start(next, chess960, t("play.startCustom"), next.split(" ")[1] === "b" ? "b" : "w");
        }}
      />
    </Suspense>
  );

  if (diagramMode) {
    return (
      <Suspense fallback={<LeereSeite />}>
        <PlayBlatt
          mobile={mobile}
          felder={[
            { label: t("blatt.opponent"), wert: engineName, gross: true },
            { label: t("blatt.youPlay"), wert: t(human === "w" ? "common.white" : "common.black") },
            { label: t("play.startPosition"), wert: startLabel || t("pe.start") },
            { label: t("play.thinkTime"), wert: t("play.seconds", { n: (setup.movetimeMs / 1000).toLocaleString(locale) }) },
          ]}
          ergebnis={outcome ? outcome.result.replace("1/2-1/2", "½ : ½").replace("-", " : ") : "–"}
          oben={{ name: nameOf(topColor), farbe: topColor === "w" ? "white" : "black" }}
          unten={{ name: nameOf(topColor === "w" ? "b" : "w"), farbe: topColor === "w" ? "black" : "white" }}
          stand={statusText}
          brett={board("play")}
          zuege={history.map((m) => m.san)}
          ersterHalbzugSchwarz={game.initialFen().split(" ")[1] === "b"}
          ersteZugnummer={Number(game.initialFen().split(" ")[5] ?? "1")}
          schalter={
            status === "setup"
              ? [{ label: t("play.startGame"), betont: true, onClick: startNew }]
              : [
                  { label: t("play.takeBack"), onClick: history.length > 0 && status !== "thinking" ? takeBack : undefined },
                  ...(status !== "over" ? [{ label: t("play.resign"), onClick: resign }] : []),
                  { label: t("play.toAnalysis"), onClick: history.length > 0 ? () => openAnalysis(line()) : undefined },
                  ...(canSave ? [{ label: saved ? t("play.saved") : t("play.save"), onClick: saved ? undefined : save }] : []),
                  { label: t("play.newGame"), betont: true, onClick: startNew },
                ]
          }
          einstellungen={setupForm}
          fokus={{
            offen: focused,
            onSchliessen: () => setFocused(false),
            titel: t("play.title"),
            untertitel: startLabel,
            brett: board("play-focus"),
          }}
          fehler={error}
          onZurueck={onBack}
        />
        {editor}
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        {onBack && !mobile && (
          <button
            type="button"
            onClick={onBack}
            className="mb-1 flex items-center gap-1 text-[12.5px] text-ink3 transition-colors hover:text-ink"
          >
            <ChevronLeft size={14} className="rtl:rotate-180" /> {t("nav.analysis")}
          </button>
        )}
        <h1 className="page-title flex items-center gap-2 text-[21px] font-semibold tracking-tight">
          <Swords size={20} className="text-accent" /> {t("play.title")}
        </h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("play.subtitle")}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
        <div className="max-w-[var(--board-edge)]">
          <div className="mb-2">{playerRow(topColor, nameOf(topColor))}</div>
          {board("play")}
          <div className="mt-2">{playerRow(topColor === "w" ? "b" : "w", nameOf(topColor === "w" ? "b" : "w"))}</div>
          <div
            data-testid="play-status"
            className={`mt-2 flex items-center gap-2 text-[13px] ${status === "over" ? "font-medium text-accent" : "text-ink3"}`}
          >
            {status === "thinking" && <Loader2 size={14} className="animate-spin" />}
            {statusText}
            {outcome && <span className="text-ink3">· {t(`end.reason.${outcome.reason}` as Key)}</span>}
          </div>
          {controls(false)}
          {error && (
            <div className="mt-2 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">{error}</div>
          )}
          <FocusBoard
            open={focused}
            onClose={() => setFocused(false)}
            title={t("play.title")}
            subtitle={startLabel}
            above={playerRow(topColor, nameOf(topColor))}
            below={controls(true)}
          >
            {board("play-focus")}
          </FocusBoard>
        </div>

        <div className="flex max-w-[460px] flex-col gap-4">
          {status !== "setup" && (
            <Card title={startLabel || t("play.game")}>
              {notation}
            </Card>
          )}
          <Card title={status === "setup" ? t("play.newGameTitle") : t("play.nextGame")}>{setupForm}</Card>
        </div>
      </div>
      {editor}
    </div>
  );
}

