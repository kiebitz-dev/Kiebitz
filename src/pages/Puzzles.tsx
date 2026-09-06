import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Chess } from "chess.js";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flame,
  Lightbulb,
  Share2,
  SkipForward,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { puzzles as demoPuzzles, puzzleStats as demoStats } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import {
  nextPuzzle,
  puzzleHistory,
  puzzleStats,
  recordAttempt,
  themeLabel,
  type AttemptRow,
  type PuzzleOut,
  type PuzzleStats,
} from "../lib/puzzles";
import { getSettings } from "../lib/settings";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
import { onDataChange } from "../lib/changes";
import { useTrainingSession } from "../lib/session";
import Board from "../components/Board";
import ShareDialog, { type ShareSubject } from "../components/ShareDialog";
import { useBoardEndView } from "../components/BoardEndView";
import { endForPosition } from "../lib/boardEnd";
import { BOARD_MAX } from "../lib/boardLayout";
import { moveTargetStyles } from "../lib/boardMoves";
import { moveBetween } from "../lib/position";
import { Button, Card, Chip, Spark } from "../components/ui";
import FocusBoard, { FocusButton } from "../components/FocusBoard";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import { dateLocale, deInt } from "../lib/format";
import { useDiagramMode } from "../lib/diagramMode";
import { useMobileShell } from "../components/MobileShell";

/** Der Tagesbogen kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const PuzzlesBlatt = lazy(() => import("./blatt/PuzzlesBlatt"));
import { isStoreCapture } from "../lib/storeCapture";
import { DailyGoal, ImportView, PuzzleLoading } from "./puzzles/PuzzleSetup";

export interface PuzzleEntry {
  initialTheme?: string;
  /** Schwierigkeitsband aus dem Trainingsplan; 0 = keine Vorgabe. */
  initialMinRating?: number;
  initialMaxRating?: number;
}

export default function Puzzles({
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry) {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return <PuzzleLoading />;
  return backend.mode === "desktop" ? (
    <LivePuzzles
      initialTheme={initialTheme}
      initialMinRating={initialMinRating}
      initialMaxRating={initialMaxRating}
    />
  ) : (
    <DemoPuzzles />
  );
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

const FILTER_THEMES = ["mateIn1", "mateIn2", "fork", "pin", "skewer", "backRankMate", "discoveredAttack", "endgame"];

function LivePuzzles({
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry) {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  // Das Tagesziel steht in den Einstellungen, nicht in den Puzzle-Statistiken ·
  // dasselbe Ziel, das Dashboard und Lernplan anzeigen.
  const [goal, setGoal] = useState(0);
  const [hideTheme, setHideTheme] = useState(false);
  // "Trotzdem weiter": nur für diese Sitzung, damit eigene Aufgaben auch ohne
  // Lichess-Dump erreichbar bleiben.
  const [skipImport, setSkipImport] = useState(false);
  const reloadRef = useRef<Promise<PuzzleStats | undefined> | null>(null);
  const reloadStats = useCallback(() => {
    if (reloadRef.current) return reloadRef.current;
    const request = puzzleStats()
      .then((next) => {
        setStats(next);
        return next;
      })
      .catch(() => undefined)
      .finally(() => {
        if (reloadRef.current === request) reloadRef.current = null;
      });
    reloadRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    reloadStats();
    getSettings()
      .then((s) => {
        setGoal(s.puzzle_goal);
        setHideTheme(s.puzzle_hide_theme);
      })
      .catch(() => {});
    return onDataChange(reloadStats, ["puzzles", "database"]);
  }, [reloadStats]);

  if (!stats) return <PuzzleLoading />;
  // Die Einrichtung hängt am Lichess-Dump, nicht am Gesamtbestand: Aufgaben aus
  // eigenen Partien entstehen nebenbei bei der Analyse und dürfen den nie
  // erfolgten Import nicht als erledigt erscheinen lassen.
  if (stats.lichess_total === 0 && !skipImport)
    return (
      <ImportView
        stats={stats}
        onImported={reloadStats}
        onSkip={stats.own_total > 0 ? () => setSkipImport(true) : undefined}
      />
    );
  return (
    <TrainerView
      stats={stats}
      goal={goal}
      hideTheme={hideTheme}
      reloadStats={reloadStats}
      initialTheme={initialTheme}
      initialMinRating={initialMinRating}
      initialMaxRating={initialMaxRating}
    />
  );
}

/**
 * Tagesfortschritt als Chip in der Kopfzeile: Versuche gegen das Tagesziel · so
 * wie im Dashboard und im Lernplan · dazu die Zahl der heute gelösten Aufgaben,
 * weil das die Zahl ist, die den Trainingstag beschreibt.
 */
// ── Trainer ──────────────────────────────────────────────────────────────────

type Status = "loading" | "playing" | "solved" | "empty";

function TrainerView({
  stats,
  goal,
  hideTheme,
  reloadStats,
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry & {
  stats: PuzzleStats;
  /** Tagesziel aus den Einstellungen; 0 = noch nicht geladen. */
  goal: number;
  /** Motiv der laufenden Aufgabe verdecken · verrät sonst das Ziel. */
  hideTheme: boolean;
  reloadStats: () => Promise<PuzzleStats | undefined>;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  // Die hier verbrachte Zeit ist das Taktikbudget · gemessen, nicht aus der
  // Zahl der Versuche hochgerechnet.
  useTrainingSession("tactics");
  const [puzzle, setPuzzle] = useState<PuzzleOut | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  /** Tatsächlich gezeigte Stellungen, inklusive Puzzle-Ausgangsstellung. */
  const [positionHistory, setPositionHistory] = useState<string[]>([]);
  const [viewPly, setViewPly] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [shake, setShake] = useState(false);
  const [showHint, setShowHint] = useState(false);
  /** Verdecktes Motiv für genau diese Aufgabe aufgedeckt. */
  const [themeRevealed, setThemeRevealed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);
  // Vorbelegt aus dem Trainingsplan ("schwächstes Motiv, Band 1420–1580").
  const [theme, setTheme] = useState<string>(initialTheme);
  const [source, setSource] = useState<"all" | "lichess" | "own">("all");
  // Aufgaben aus den eigenen Fehlern gehören zu Kiebitz Plus.
  const ownPuzzleGate = usePlusGate("personal_puzzles");
  // Ein aus dem Plan mitgebrachtes Band bleibt aktiv, bis der Nutzer es
  // aufhebt · sonst wäre die Dosis nach der ersten Aufgabe wieder vergessen.
  const [band, setBand] = useState<{ min: number; max: number } | null>(
    initialMinRating > 0 && initialMaxRating > initialMinRating
      ? { min: initialMinRating, max: initialMaxRating }
      : null
  );

  const chessRef = useRef(new Chess());
  const idxRef = useRef(0);
  const failedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<string[]>([]);
  const viewPlyRef = useRef(0);

  const goToPly = (ply: number) => {
    const last = Math.max(0, historyRef.current.length - 1);
    const next = Math.max(0, Math.min(last, ply));
    viewPlyRef.current = next;
    setViewPly(next);
    setSelected(null);
  };

  const appendPosition = (nextFen: string) => {
    const current = historyRef.current;
    const previousLivePly = Math.max(0, current.length - 1);
    const next = [...current, nextFen];
    historyRef.current = next;
    setPositionHistory(next);
    // Wer gerade die Live-Stellung sieht, folgt dem Zug. Beim Blättern in der
    // Vergangenheit bleibt das Brett dagegen bewusst an derselben Stelle.
    if (viewPlyRef.current === previousLivePly) goToPly(next.length - 1);
  };

  const playUci = (uci: string) => {
    chessRef.current.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    appendPosition(chessRef.current.fen());
  };

  const load = (
    t: string = theme,
    s: "all" | "lichess" | "own" = source,
    b: { min: number; max: number } | null = band
  ) => {
    setStatus("loading");
    setWrong(false);
    setShowHint(false);
    setThemeRevealed(false);
    setSelected(null);
    setRatingDelta(null);
    historyRef.current = [];
    setPositionHistory([]);
    goToPly(0);
    failedRef.current = false;
    nextPuzzle({
      theme: t || undefined,
      source: s === "all" ? undefined : s,
      minRating: b?.min,
      maxRating: b?.max,
    })
      .then((p) => {
        if (!p) {
          setStatus("empty");
          return;
        }
        setPuzzle(p);
        chessRef.current = new Chess(p.fen);
        historyRef.current = [p.fen];
        setPositionHistory([p.fen]);
        goToPly(0);
        idxRef.current = 0;
        if (p.setup_plies === 0) {
          setStatus("playing");
        } else {
          // Lichess-Aufgaben spielen zunächst den gegnerischen Setup-Zug.
          timerRef.current = setTimeout(() => {
            playUci(p.moves[0]);
            idxRef.current = 1;
            setStatus("playing");
          }, 550);
        }
      })
      .catch(() => setStatus("empty"));
  };

  useEffect(() => {
    load();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const orientation: "white" | "black" = useMemo(() => {
    if (!puzzle) return "white";
    const initialWhite = puzzle.fen.split(" ")[1] === "w";
    const solverWhite = puzzle.setup_plies % 2 === 0 ? initialWhite : !initialWhite;
    return solverWhite ? "white" : "black";
  }, [puzzle]);

  const lastPly = Math.max(0, positionHistory.length - 1);
  const fen = positionHistory[viewPly] ?? puzzle?.fen ?? "";
  const atLive = viewPly === lastPly;
  // Der Trainer führt Stellungen und keine Zugliste · der markierte Zug ist
  // der Unterschied zur vorigen Stellung. Das gilt auch beim Zurückblättern:
  // dort steht der Zug, der zur gezeigten Stellung führte.
  const lastMove = useMemo(
    () => (viewPly > 0 ? moveBetween(positionHistory[viewPly - 1], fen) : null),
    [positionHistory, viewPly, fen]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPly(viewPlyRef.current - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToPly(viewPlyRef.current + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastPly]);

  const finish = (solvedFirstTry: boolean) => {
    if (!puzzle) return;
    recordAttempt(puzzle.id, solvedFirstTry)
      .then((r) => {
        setRatingDelta(r.delta);
        void reloadStats().then((nextStats) => {
          if (solvedFirstTry && nextStats) {
            void maybeRequestPlayReview(backend.info, {
              kind: "puzzle-solved",
              totalSolved: nextStats.solved,
            });
          }
        });
      })
      .catch(() => {});
  };

  const tryMove = (from: string, to: string): boolean => {
    if (!puzzle || status !== "playing" || !atLive) return false;
    const chess = chessRef.current;
    let move;
    try {
      move = chess.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    const uci = move.from + move.to + (move.promotion ?? "");
    const expected = puzzle.moves[idxRef.current];
    // Lichess-Regel: jeder Zug, der sofort mattsetzt, zählt ebenfalls.
    const ok = uci === expected || chess.isCheckmate();
    if (!ok) {
      chess.undo();
      setWrong(true);
      setShake(true);
      setTimeout(() => setShake(false), 600);
      if (!failedRef.current) {
        failedRef.current = true;
        finish(false);
      }
      return false;
    }
    appendPosition(chess.fen());
    setWrong(false);
    idxRef.current += 1;
    if (idxRef.current >= puzzle.moves.length || chess.isCheckmate()) {
      setStatus("solved");
      if (!failedRef.current) finish(true);
      return true;
    }
    // Gegner antwortet automatisch.
    timerRef.current = setTimeout(() => {
      playUci(puzzle.moves[idxRef.current]);
      idxRef.current += 1;
    }, 350);
    return true;
  };

  const onSquareClick = (square: string) => {
    if (status !== "playing" || !atLive) return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      setSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  const revealSolution = () => {
    if (!puzzle) return;
    const step = () => {
      if (idxRef.current >= puzzle.moves.length) {
        setStatus("solved");
        return;
      }
      playUci(puzzle.moves[idxRef.current]);
      idxRef.current += 1;
      timerRef.current = setTimeout(step, 450);
    };
    step();
  };

  const hintSquare = puzzle && status === "playing" && atLive ? puzzle.moves[idxRef.current]?.slice(0, 2) : null;
  const squareStyles: Record<string, React.CSSProperties> = {
    ...(status === "playing" && atLive ? moveTargetStyles(fen, selected) : {}),
  };
  if (selected) squareStyles[selected] = { boxShadow: "inset 0 0 0 3px var(--color-accent)" };
  if (showHint && hintSquare) squareStyles[hintSquare] = { boxShadow: "inset 0 0 0 3px var(--color-gold)" };

  // Endet die Kombination mit Matt, bekommt der König sein Zeichen. Mehr
  // nicht: eine gelöste Aufgabe ist keine gewonnene Partie, ein
  // Ergebnisstreifen wäre hier eine falsche Behauptung.
  const matedEnd = useMemo(() => {
    if (!atLive) return null;
    const end = endForPosition(fen);
    return end?.reason === "mate" ? end : null;
  }, [fen, atLive]);
  const matedView = useBoardEndView(matedEnd);
  // Leerer Streifentext · siehe `BoardEndView.label`.
  const boardEnd = useMemo(
    () => (matedView ? { ...matedView, label: "" } : null),
    [matedView]
  );

  const mainTheme = puzzle?.themes.find(
    (value) => !["ownGame", "oneMove", "opening", "middlegame", "blunder", "mistake"].includes(value)
  ) ?? "";
  // Verdeckt bleibt das Motiv nur, solange die Aufgabe offen ist · nach der
  // Lösung ist es Auswertung, kein Spoiler mehr.
  const themeHidden = hideTheme && !themeRevealed && status !== "solved";

  /**
   * Die Aufgabe, wie sie beim Empfänger ankommt.
   *
   * Geteilt wird immer die Ausgangsstellung der Aufgabe, nicht das, was gerade
   * auf dem Brett steht: Wer nach drei Zügen teilt, will die Aufgabe
   * weitergeben und nicht seinen Zwischenstand.
   *
   * Der Setup-Zug von Lichess ist dabei der letzte Zug, nicht Teil der Lösung ·
   * genau die Trennung, die `setup_plies` beschreibt.
   */
  const openShare = () => {
    if (!puzzle) return;
    const start = positionHistory[puzzle.setup_plies] ?? puzzle.fen;
    const uci = (move: string) => ({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      promo: (move[4] as "q" | "r" | "b" | "n" | undefined) || undefined,
    });
    setSharing({
      kind: "puzzle",
      fen: start,
      orientation,
      lastMove: puzzle.setup_plies > 0 ? uci(puzzle.moves[0]) : null,
      line: puzzle.moves.slice(puzzle.setup_plies).map(uci),
      rating: puzzle.rating,
      theme: mainTheme || undefined,
    });
  };
  const history = stats.history.length >= 2 ? stats.history : [stats.personal_rating, stats.personal_rating];
  const themeStats = stats.themes
    .filter((t) => !["short", "long", "veryLong", "oneMove", "advantage", "crushing", "equality", "mate", "middlegame", "opening", "ownGame", "blunder", "mistake"].includes(t.theme))
    .slice(0, 5);

  /**
   * Aufgabe, Brett und Bedienung als benannte Bausteine · die Seite und das
   * Fokus-Brett zeigen dieselben, nur in unterschiedlicher Umgebung. Das Brett
   * bekommt je eine eigene Kennung, weil react-chessboard seine Instanzen
   * daran unterscheidet. `inFocus` sagt jedem Baustein, in welcher der beiden
   * er gerade steht · im Fokus ist die Breite knapp und die Höhe kostbar.
   *
   * Diese Zeile: Motiv links, Zugrecht rechts · und auf einem schmalen Telefon
   * bleibt sie eine Zeile.
   *
   * Alles hier ist entweder unverkürzbar (Symbol, „Weiß am Zug", die Marke der
   * eigenen Partie) oder darf abschneiden (der Motivname). Vorher durfte jedes
   * Stück umbrechen, und auf 260 px standen drei Fetzen untereinander · die
   * Zeile war dreimal so hoch, und im Fokus fehlte genau diese Höhe dem Brett.
   *
   * Im Fokus steht das Rating in der Kopfzeile über dem Brett; hier fällt es
   * deshalb weg, statt zweimal dazustehen und den Platz zu nehmen, den der
   * Motivname braucht.
   */
  const puzzleHead = (inFocus: boolean) => (
    // `min-h`: Das verdeckte Motiv ist ein Knopf mit Rand und Innenabstand, das
    // aufgedeckte ein Wort · der Knopf ist knapp vier Pixel höher. Aufgedeckt
    // wird beim Lösen, und im Fokus rechnet das Brett mit der Höhe dieser
    // Zeile: Ohne die Untergrenze wuchs es im selben Augenblick um diese vier
    // Pixel, in dem die Aufgabe gelöst ist. Der Wert ist die Höhe des Knopfes,
    // also die größere der beiden.
    <div
      className={`flex min-h-[24px] items-center justify-between gap-2 ${inFocus ? "" : "mb-3"}`}
    >
      <div className="flex min-w-0 items-center gap-2 text-[13.5px]">
        <Target size={15} className="shrink-0 text-accent" />
        {puzzle?.source !== "own" && mainTheme && themeHidden ? (
          <button
            type="button"
            onClick={() => setThemeRevealed(true)}
            title={t("pz.themeRevealHint")}
            className="shrink-0 rounded-md border border-dashed border-line2 px-2 py-0.5 text-[12px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
          >
            {t("pz.themeHidden")}
          </button>
        ) : (
          <span className="truncate font-medium">
            {puzzle?.source === "own" ? t("pz.missedMove") : mainTheme ? themeLabel(mainTheme, locale) : "…"}
          </span>
        )}
        {puzzle && !inFocus && <span className="shrink-0 text-ink3">· Rating {puzzle.rating}</span>}
        {puzzle?.source === "own" && (
          <span className="shrink-0 rounded-md border border-accent-dim bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
            {t("pz.fromOwnGame")}
          </span>
        )}
      </div>
      <span className="shrink-0 whitespace-nowrap text-[12.5px] text-ink3">
        {status === "loading"
          ? t("pz.loading")
          : orientation === "white"
            ? t("pz.whiteToMove")
            : t("pz.blackToMove")}
      </span>
    </div>
  );

  const puzzleBoard = (boardId: string) => (
    <div className="board-bleed">
      <Board
        boardId={boardId}
        fen={fen || "8/8/8/8/8/8/8/8 w - - 0 1"}
        width={BOARD_MAX}
        lastMove={lastMove}
        draggable={status === "playing" && atLive}
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

  /**
   * Im Fokus fehlt der Griff zum Fokus · dort ist man schon.
   *
   * Die Tastenreihe ist ein eigenes Element und bleibt in sich *eine* Reihe.
   * Umbrechen darf nur die Zeile darüber: Passt die Reihe neben der
   * Beschriftung nicht mehr, rückt sie als Ganzes darunter · so wie auf dem
   * Telefon. Vorher brach sie zusätzlich in sich selbst um, und der letzte
   * Knopf stand allein in einer dritten Zeile unter den anderen fünf.
   *
   * Damit das aufgeht, ist die Reihe schmal gehalten: knapper Abstand, ein
   * Zähler mit nur so viel Reserve, dass die Ziffern nicht wackeln, und kein
   * Sondermaß mehr vor dem Teilen-Knopf. Unter 360 px rücken die Knöpfe
   * zusätzlich enger zusammen und geben Innenabstand her · sonst stünde die
   * Reihe auf einem schmalen Telefon (oder bei großer Anzeigegröße, die
   * dasselbe bewirkt) wieder über dem Rahmen.
   */
  const puzzleHistory = (inFocus: boolean) => (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line bg-panel px-3 py-2 ${
        inFocus ? "" : "mt-3"
      }`}
    >
      <span className="min-w-0 truncate text-[12.5px] text-ink2">{t("pz.positionHistory")}</span>
      <div className="ms-auto flex min-w-0 grow flex-nowrap items-center justify-end gap-1 max-[359px]:gap-0.5 max-[359px]:[&>button]:px-1.5">
        <Button onClick={() => goToPly(0)} title={t("pz.firstPosition")} compact>
          <ChevronFirst size={14} />
        </Button>
        <Button onClick={() => goToPly(viewPly - 1)} title={t("pz.previousPosition")} compact>
          <ChevronLeft size={14} />
        </Button>
        <span className="min-w-[42px] shrink-0 text-center text-[11.5px] tabular-nums text-ink3">
          {viewPly} / {lastPly}
        </span>
        <Button onClick={() => goToPly(viewPly + 1)} title={t("pz.nextPosition")} compact>
          <ChevronRight size={14} />
        </Button>
        <Button onClick={() => goToPly(lastPly)} title={t("pz.currentPosition")} compact>
          <ChevronLast size={14} />
        </Button>
        <Button onClick={openShare} title={t("sh.title")} disabled={!puzzle} compact>
          <Share2 size={14} />
        </Button>
        {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
      </div>
    </div>
  );

  /**
   * Welcher der drei Zustände der Zeile unter dem Brett gerade gilt.
   * Alle drei stehen im DOM (siehe `actionRow`); dieser hier ist sichtbar.
   */
  const actionState = status === "solved" ? "solved" : wrong ? "wrong" : "open";

  /**
   * Die Grundform aller drei Zustände: eine Meldung und die Knöpfe dazu.
   *
   * Nebeneinander, solange die Meldung dabei mindestens 10 rem behält · sonst
   * rücken die Knöpfe unter sie. Die Grenze ist der Punkt, weil ein
   * Flex-Umbruch an der gedachten Breite entschieden wird und nicht am
   * Ergebnis: Ohne sie schrumpfte die Meldung, statt umzubrechen, und im
   * Puzzle-Fokus stand „Leider falsch (Rating -15) · versuch es noch einmal."
   * auf einem 360 px breiten Telefon als siebenzeilige Säule neben zwei
   * Knöpfen. Zwei Zeilen über der ganzen Breite sind nicht nur lesbarer,
   * sondern auch halb so hoch · und die Höhe ist im Fokus das Brett.
   *
   * `ms-auto` stellt die Knöpfe an die rechte Kante · auf der gemeinsamen
   * Zeile ohnehin, in der eigenen Zeile ebenso. `max-w-full` hält sie im
   * Rahmen, falls selbst dort zwei nebeneinander nicht mehr passen.
   */
  const actionShell = (message: ReactNode, buttons: ReactNode) => (
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 grow basis-40">{message}</div>
      <div className="ms-auto flex max-w-full shrink-0 flex-wrap justify-end gap-2">{buttons}</div>
    </div>
  );

  /**
   * Ein Zustand der Zeile · sichtbar oder als Platzhalter.
   *
   * Die drei liegen übereinander im selben Rasterfeld, und nur einer ist zu
   * sehen. Der Grund ist die Höhe: Die Zeile muss in jedem Zustand gleich hoch
   * sein, sonst wandert das Brett darüber. Gemessen im Browser war sie es
   * nicht — 52 px im Spiel, 57,5 px nach einer richtigen und 59,5 px nach
   * einer falschen Lösung; auf einem 360 px breiten Schirm 62,5 px, weil der
   * Text dort neben den Knöpfen umbricht.
   *
   * Ein `min-h` fängt das nicht auf, denn die Höhe hängt nicht nur am Zustand,
   * sondern auch an der Breite und an der Sprache. Eine feste Höhe würde den
   * umgebrochenen Text abschneiden. Übereinandergelegt ergibt sich die Höhe
   * von selbst: Das Rasterfeld ist so hoch wie sein höchster Inhalt, und der
   * ändert sich beim Wechsel des Zustands nicht mehr.
   *
   * `invisible` ist `visibility: hidden` · der Platz bleibt stehen, und die
   * Knöpfe der verdeckten Zustände sind weder anklickbar noch vorlesbar.
   */
  const actionRow = (key: typeof actionState | "reserve", content: ReactNode) => (
    <div
      key={key}
      data-action-row={key}
      data-active={key === actionState ? "" : undefined}
      className={`col-start-1 row-start-1 w-full ${key === actionState ? "" : "invisible"}`}
    >
      {content}
    </div>
  );

  /**
   * Die Meldung nach einem Fehlversuch · `delta` ist der Rating-Zusatz.
   *
   * Sie steht zweimal im Raster: einmal mit dem, was gerade gilt, und einmal
   * unsichtbar mit einem Platzhalter-Zusatz. Der Grund ist die Reihenfolge, in
   * der die beiden Dinge eintreffen: „Leider falsch" erscheint sofort, die
   * Wertung erst, wenn der Versuch gespeichert ist. Auf einem schmalen Schirm
   * brach der Satz durch die paar Zeichen mehr in eine zweite Zeile um, die
   * Zeile wuchs · und das Brett darüber sprang genau dann nach oben, wenn man
   * gerade auf die Meldung schaut. Reserviert steht die Höhe von Anfang an.
   */
  const wrongRow = (delta: string) => (
    <div className="rounded-lg border border-loss-dim bg-loss-soft px-3.5 py-2.5">
      {actionShell(
        <span className="text-[13.5px] text-loss">{t("pz.wrong", { d: delta })}</span>,
        <>
          <Button onClick={() => setShowHint(true)}>
            <Lightbulb size={15} /> {t("pz.hint")}
          </Button>
          <Button onClick={revealSolution}>
            <Eye size={15} /> {t("pz.solution")}
          </Button>
        </>
      )}
    </div>
  );

  /**
   * Die Zeile unter dem Brett · Meldung, Knöpfe und der Tipp darunter.
   *
   * Im Fokus steht der Tipp von Anfang an im Raum: Er ist dort nicht ein
   * Kasten, der auftaucht, sondern ein Stück reservierte Höhe, das erst leer
   * ist und sich später füllt. Der Grund ist das Brett. Seine Größe rechnet
   * der Fokus aus dem Platz, den die Reihen darunter übrig lassen (siehe
   * `useChrome` in components/FocusBoard.tsx) · erschien der Tipp erst beim
   * Antippen, wurde das Brett in genau dem Augenblick neu skaliert, in dem man
   * auf die Aufgabe schaut. Reserviert steht die Höhe schon beim Aufschlagen,
   * und das Brett bleibt für die ganze Aufgabe, wie es ist.
   *
   * Auf der gewöhnlichen Seite bleibt es beim Auftauchen: Dort darf gescrollt
   * werden, das Brett hängt nicht an der Zeile, und ein dauerhaft leerer
   * Kasten unter dem Brett wäre nur ein Loch.
   */
  const puzzleActions = (inFocus: boolean) => (
    <>
      {/* Ein Rasterfeld statt einer Reihe · siehe `actionRow`. Die Meldung
          unter dem Brett war das Letzte, was das Fokus-Brett noch springen
          ließ: Der Vorlauf, der es mittig stellt, ist durch den Platz
          begrenzt, der unter dem Brett wirklich bleibt (siehe `useChrome` in
          components/FocusBoard.tsx). Wuchs die Zeile, schrumpfte der Vorlauf. */}
      <div className="mt-3 grid min-h-[52px] items-center">
        {actionRow(
          "solved",
          <div className="rounded-lg border border-accent-dim bg-accent-soft px-3.5 py-2.5">
            {actionShell(
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                <CheckCircle2 size={17} className="shrink-0" />
                <span className="min-w-0">
                  {failedRef.current ? t("pz.solvedWithHelp") : t("pz.correct")}
                  {ratingDelta != null &&
                    t("pz.ratingDelta", { d: `${ratingDelta >= 0 ? "+" : ""}${ratingDelta}` })}
                </span>
              </div>,
              <Button primary onClick={() => load()}>
                <SkipForward size={15} /> {t("common.next")}
              </Button>
            )}
          </div>
        )}
        {actionRow("wrong", wrongRow(ratingDelta != null ? ` (Rating ${ratingDelta})` : ""))}
        {/* Nur als Platzhalter · nie sichtbar, hält aber die Höhe der
            Meldung mit Wertung frei (siehe `wrongRow`). */}
        {actionRow("reserve", wrongRow(" (Rating -00)"))}
        {actionRow(
          "open",
          actionShell(
            <span className="text-[13px] text-ink3">
              {status === "loading"
                ? t("pz.loadingNext")
                : status === "empty"
                  ? t("pz.noneFound")
                  : t("pz.findBest")}
            </span>,
            status === "playing" && (
              <Button onClick={() => setShowHint(true)}>
                <Lightbulb size={15} /> {t("pz.hint")}
              </Button>
            )
          )
        )}
      </div>
      {(inFocus || (showHint && status === "playing")) && (
        <div
          // Im Fokus steht der Kasten immer da und ist nur unsichtbar, solange
          // niemand den Tipp geholt hat · `visibility: hidden` hält den Platz
          // und nimmt den Text zugleich aus dem Vorlesen heraus.
          aria-hidden={showHint && status === "playing" ? undefined : true}
          className={`rounded-lg border border-line bg-panel px-4 py-2.5 text-[12.5px] text-ink2 ${
            showHint && status === "playing" ? "" : "invisible"
          }`}
        >
          {t("pz.hintText", {
            theme: mainTheme ? t("pz.hintTheme", { m: themeLabel(mainTheme, locale) }) : "",
          })}
        </div>
      )}
    </>
  );

  if (diagramMode) {
    return (
      <Suspense fallback={<LeereSeite />}>
        <PuzzlesBlatt
          mobile={mobile}
          kopfRechts={t("pz.subtitle", {
            n: deInt(stats.db_total),
            o: deInt(stats.own_total),
            m: deInt(stats.solved),
          })}
          felder={[
            {
              label: t("eg.task"),
              wert: (
                <>
                  {t("blatt.entryNo", { n: deInt(stats.today_attempts + 1) })}
                  <span className="text-ink3"> / {deInt(goal)}</span>
                </>
              ),
              gross: true,
            },
            {
              label: t("blatt.motif"),
              // Verdeckt heißt im Formularsatz: ein geschwärztes Feld, nicht
              // ein Wort. Antippen deckt es auf, wie heute.
              wert:
                puzzle?.source !== "own" && mainTheme && themeHidden ? (
                  <button
                    type="button"
                    onClick={() => setThemeRevealed(true)}
                    title={t("pz.themeRevealHint")}
                    className="inline-flex items-center gap-2"
                  >
                    <span aria-hidden className="inline-block h-3 w-[78px] bg-line2" />
                    <span className="text-[11.5px] text-ink3">{t("blatt.covered")}</span>
                  </button>
                ) : puzzle?.source === "own" ? (
                  t("pz.missedMove")
                ) : mainTheme ? (
                  themeLabel(mainTheme, locale)
                ) : (
                  "…"
                ),
            },
            {
              label: t("blatt.difficulty"),
              wert: puzzle ? (
                <>
                  <span className="blatt-zahl">{deInt(puzzle.rating)}</span>
                  {" · "}
                  {t("blatt.yourRating")}{" "}
                  <span className="blatt-zahl">{deInt(stats.personal_rating)}</span>
                </>
              ) : (
                "—"
              ),
            },
            {
              label: t("blatt.streak"),
              wert: (
                <>
                  <span className="blatt-zahl">{deInt(stats.streak_days)}</span>{" "}
                  {t(stats.streak_days === 1 ? "common.days.one" : "common.days.many")}
                  {" · "}
                  {t("pz.todaySolved", { n: deInt(stats.today_solved) })}
                </>
              ),
            },
          ]}
          tagesziel={`${deInt(stats.today_attempts)} / ${deInt(goal)}`}
          amZug={orientation}
          amZugText={orientation === "white" ? t("pz.whiteToMove") : t("pz.blackToMove")}
          aufforderung={
            status === "loading"
              ? t("pz.loadingNext")
              : status === "empty"
                ? t("pz.noneFound")
                : t("pz.findBest")
          }
          brett={puzzleBoard("puzzle")}
          schalter={[
            { label: t("pz.hint"), onClick: status === "playing" ? () => setShowHint(true) : undefined },
            { label: t("pz.solution"), onClick: status === "playing" || wrong ? revealSolution : undefined },
            { label: t("common.next"), betont: true, onClick: () => load() },
          ]}
          verlaufSchalter={[
            { label: "⏮", titel: t("pz.firstPosition"), onClick: () => goToPly(0) },
            { label: "‹", titel: t("pz.previousPosition"), onClick: () => goToPly(viewPly - 1) },
            { label: "›", titel: t("pz.nextPosition"), onClick: () => goToPly(viewPly + 1) },
            { label: "⏭", titel: t("pz.currentPosition"), onClick: () => goToPly(lastPly) },
          ]}
          verlaufNote={t("blatt.historyNote")}
          heute={stats.today_attempts}
          ziel={goal}
          motive={themeStats.map((th) => ({
            name: themeLabel(th.theme, locale),
            quote: th.attempts > 0 ? (th.solved / th.attempts) * 100 : 0,
          }))}
          rating={stats.personal_rating}
          ratingDelta={history.length >= 2 ? history[history.length - 1] - history[0] : null}
          history={history}
          geloest={stats.solved}
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {t("pz.subtitle", {
              n: deInt(stats.db_total),
              o: deInt(stats.own_total),
              m: deInt(stats.solved),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DailyGoal attempts={stats.today_attempts} solved={stats.today_solved} goal={goal} />
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Flame size={15} className="text-gold" />
            <span className="font-medium">
              {stats.streak_days} {t(stats.streak_days === 1 ? "common.days.one" : "common.days.many")}
            </span>
            <span className="text-ink3">{t("pz.streakToday", { n: stats.today_solved })}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
        <div className="max-w-[var(--board-edge)]">
          {puzzleHead(false)}
          {puzzleBoard("puzzle")}
          {puzzleHistory(false)}

          {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}

          {puzzleActions(false)}
        </div>

        <div className="flex max-w-[528px] flex-col gap-4">
          <Card title={t("pz.rating")}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">
                  {deInt(stats.personal_rating)}
                </div>
                <div className="mt-1.5 text-[12px] text-ink3">
                  {stats.attempts > 0
                    ? t("pz.attempts", {
                        n: deInt(stats.attempts),
                        p: Math.round((stats.solved / stats.attempts) * 100),
                      })
                    : t("pz.eloStart")}
                </div>
              </div>
              <Spark data={history.map(Number)} width={140} height={44} />
            </div>
          </Card>

          <Card title={t("pz.themeAccuracy")}>
            {themeStats.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {themeStats.map((th) => {
                  const acc = Math.round((th.solved / th.attempts) * 100);
                  return (
                    <div key={th.theme} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[12.5px] text-ink2">{themeLabel(th.theme, locale)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${acc}%`,
                            background: acc >= 85 ? "var(--color-win)" : acc >= 70 ? "var(--color-gold)" : "var(--color-loss)",
                          }}
                        />
                      </div>
                      <span className="w-10 text-right text-[12.5px] tabular-nums text-ink2">{acc} %</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[12.5px] text-ink3">{t("pz.noAttempts")}</div>
            )}
          </Card>

          <Card title={t("pz.filter")}>
            <div className="mb-3 flex flex-wrap gap-2 border-b border-line pb-3">
              {/* Aufgaben aus den eigenen verpassten Zügen sind eine
                  Plus-Funktion. Der Filter bleibt sichtbar und erklärt sich
                  beim Antippen · verschwinden wäre der schlechtere Weg. */}
              {(["all", "own", "lichess"] as const).map((value) => (
                <Chip
                  key={value}
                  active={source === value}
                  onClick={() => {
                    if (value === "own" && !ownPuzzleGate.unlocked && !ownPuzzleGate.pending) {
                      openPlusDialog("personal_puzzles");
                      return;
                    }
                    setSource(value);
                    load(theme, value);
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {t(value === "all" ? "pz.sourceAll" : value === "own" ? "pz.sourceOwn" : "pz.sourceLichess")}
                    {value === "own" && !ownPuzzleGate.unlocked && !ownPuzzleGate.pending && (
                      <Sparkles size={11} className="text-accent" />
                    )}
                  </span>
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={theme === ""} onClick={() => { setTheme(""); load(""); }}>
                {t("pz.allThemes")}
              </Chip>
              {FILTER_THEMES.map((ft) => (
                <Chip key={ft} active={theme === ft} onClick={() => { setTheme(ft); load(ft); }}>
                  {themeLabel(ft, locale)}
                </Chip>
              ))}
            </div>
            {band && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2">
                <span className="text-[12px] text-accent">
                  {t("pz.bandActive", { lo: deInt(band.min), hi: deInt(band.max) })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBand(null);
                    // `band` steht erst im nächsten Render neu · deshalb geht
                    // das aufgehobene Band ausdrücklich mit in den Aufruf.
                    load(theme, source, null);
                  }}
                  className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink3 transition-colors hover:text-ink"
                >
                  {t("pz.bandClear")}
                </button>
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
              {t("pz.bandInfo")}
            </div>
          </Card>

          <PuzzleHistory />
        </div>
      </div>

      <FocusBoard
        open={focused}
        onClose={() => setFocused(false)}
        title={t("pz.title")}
        subtitle={puzzle ? `Rating ${puzzle.rating}` : undefined}
        above={puzzleHead(true)}
        below={
          <>
            {puzzleHistory(true)}
            {puzzleActions(true)}
          </>
        }
      >
        {puzzleBoard("puzzle-focus")}
      </FocusBoard>
    </div>
  );
}

/** Verlauf der letzten Versuche · standardmäßig zugeklappt. */
function PuzzleHistory() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AttemptRow[] | null>(null);

  // Lokale Versuche und ein abgeschlossener Geräte-Sync laufen beide durch
  // denselben Datenänderungs-Kanal. Den Cache verwerfen, damit eine bereits
  // geöffnete History den gemergten Stand ohne Seitenwechsel anzeigt.
  useEffect(() => onDataChange(() => setRows(null), ["puzzles", "database"]), []);

  useEffect(() => {
    if (!open || rows) return;
    puzzleHistory(25)
      .then(setRows)
      .catch(() => setRows([]));
  }, [open, rows]);

  return (
    <Card
      title={t("pz.history")}
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink3 hover:bg-panel2 hover:text-ink"
        >
          {t(open ? "pz.historyHide" : "pz.historyShow")}
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {!open ? (
        <p className="text-[12px] leading-relaxed text-ink3">{t("pz.historyHint")}</p>
      ) : rows == null ? (
        <div className="text-[12px] text-ink3">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-ink3">{t("pz.noAttempts")}</div>
      ) : (
        <ul className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const delta = row.rating_after - row.rating_before;
            return (
              <li
                key={`${row.puzzle_id}-${row.ts}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {row.solved ? (
                    <Check size={13} className="shrink-0 text-win" />
                  ) : (
                    <X size={13} className="shrink-0 text-loss" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink2">
                      {row.themes.slice(0, 2).map((theme) => themeLabel(theme, locale)).join(" · ") ||
                        row.puzzle_id}
                    </div>
                    <div className="text-[10.5px] text-ink3">
                      {new Date(row.ts * 1000).toLocaleString(dateLocale(), {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {row.puzzle_rating > 0 ? ` · ${deInt(row.puzzle_rating)}` : ""}
                    </div>
                  </div>
                </div>
                <span
                  className="shrink-0 text-[12px] font-medium tabular-nums"
                  style={{ color: delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                >
                  {delta >= 0 ? "+" : "−"}
                  {Math.abs(delta)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function DemoPuzzles() {
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"open" | "solved" | "wrong">("open");
  const [shake, setShake] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const puzzle = demoPuzzles[idx % demoPuzzles.length];
  const captureTheme =
    storeCapture && locale === "en" && puzzle.theme === "Grundreihenmatt"
      ? "Back rank mate"
      : puzzle.theme;

  const chessRef = useRef(new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);
  /** Der gelöste Zug bleibt markiert · davor gibt es auf diesem Brett keinen. */
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);

  const next = () => {
    const n = (idx + 1) % demoPuzzles.length;
    setIdx(n);
    const p = demoPuzzles[n];
    chessRef.current = new Chess(p.fen);
    setFen(p.fen);
    setLastMove(null);
    setStatus("open");
    setSelected(null);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (status === "solved") return false;
    const chess = chessRef.current;
    try {
      const move = chess.move({ from, to, promotion: "q" });
      if (move.san === puzzle.solutionSan) {
        setFen(chess.fen());
        setLastMove({ from: move.from, to: move.to });
        setStatus("solved");
        return true;
      }
      chess.undo();
      setStatus("wrong");
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return false;
    } catch {
      return false;
    }
  };

  const onSquareClick = (square: string) => {
    if (status === "solved") return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      setSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {storeCapture
              ? locale === "de"
                ? "Gezieltes Taktiktraining aus Millionen kuratierter Stellungen"
                : "Focused tactics training from millions of curated positions"
              : t("pz.demoSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DailyGoal
            attempts={demoStats.todaySolved}
            solved={demoStats.todaySolved}
            goal={demoStats.todayGoal}
          />
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Flame size={15} className="text-gold" />
            <span className="font-medium">{demoStats.streak} {t("common.days.many")}</span>
            <span className="text-ink3">{t("pz.streakToday", { n: demoStats.todaySolved })}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
        <div className="max-w-[var(--board-edge)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">{captureTheme}</span>
              <span className="text-ink3">· Rating {puzzle.rating}</span>
            </div>
            <span className="text-[12.5px] text-ink3">
              {puzzle.sideToMove === "white" ? t("pz.whiteToMove") : t("pz.blackToMove")}
            </span>
          </div>

          <div className="board-bleed">
            <Board
              boardId="puzzle"
              fen={fen}
              width={BOARD_MAX}
              lastMove={lastMove}
              draggable={status !== "solved"}
              onPieceDrop={tryMove}
              onSquareClick={onSquareClick}
              squareStyles={{
                ...moveTargetStyles(fen, selected),
                ...(selected ? { [selected]: { boxShadow: "inset 0 0 0 3px var(--color-accent)" } } : {}),
              }}
              orientation={puzzle.sideToMove}
              shake={shake}
              mouseDrag
            />
          </div>

          <div className="mt-3 flex h-[52px] items-center">
            {status === "solved" ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                  <CheckCircle2 size={17} />
                  {t("pz.correct")} {puzzle.solutionSan} · {captureTheme}
                </div>
                <Button primary onClick={next}>
                  <SkipForward size={15} /> {t("common.next")}
                </Button>
              </div>
            ) : status === "wrong" ? (
              <div className="flex w-full items-center rounded-lg border border-loss-dim bg-loss-soft px-4 py-2.5">
                <span className="text-[13.5px] text-loss">{t("pz.wrong", { d: "" })}</span>
              </div>
            ) : (
              <span className="text-[13px] text-ink3">{t("pz.findBestDemo")}</span>
            )}
          </div>
        </div>

        <div className="flex max-w-[528px] flex-col gap-4">
          <Card title={t("pz.rating")}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">{deInt(demoStats.rating)}</div>
                <div className="mt-1.5 text-[12px] text-win">{t("pz.rating3m")}</div>
              </div>
              <Spark data={demoStats.history} width={140} height={44} />
            </div>
          </Card>
          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            {t("pz.demoNote")}
          </div>
        </div>
      </div>
    </div>
  );
}
