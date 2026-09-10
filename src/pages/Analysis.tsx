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
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartSurface } from "../components/chartTheme";
import {
  BookOpen,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cpu,
  FlipVertical2,
  Layers,
  Loader2,
  MoreHorizontal,
  Save,
  Search,
  Share2,
  Sparkles,
  Square,
  Zap,
  RotateCcw,
} from "lucide-react";
import { featuredGame, games as demoGames } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key, type Locale, type TFunc } from "../lib/i18n";
import { isStoreCapture } from "../lib/storeCapture";
import { useTrainingSession } from "../lib/session";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
import { getGame, listGameSummaries, setGameNote, setGameTags, type GameRecord, type GameSummary } from "../lib/db";
import {
  chessdbQuery,
  explorerQuery,
  getSettings,
  refdbGame,
  refdbQuery,
  refdbStatus,
  type BookResult,
  type BookSource,
  type ChessDbResult,
} from "../lib/settings";
import {
  cancelAnalysis,
  gameAnalysis,
  onAnalysisDone,
  onAnalysisGameDone,
  onAnalysisProgress,
  searchPosition,
  startAnalysis,
  type AnalysisProgress,
  type MoveEvalRow,
  type PositionSearch,
} from "../lib/analysis";
import Board from "../components/Board";
import ShareDialog, { type ShareSubject } from "../components/ShareDialog";
import type { SharePayload } from "../lib/share/codec";
import { useBoardEndView } from "../components/BoardEndView";
import { endForPosition, gameEnd } from "../lib/boardEnd";
import { BOARD_MAX } from "../lib/boardLayout";
import CapturedPieces from "../components/CapturedPieces";
import { useMobileShell } from "../components/MobileShell";
import { capturedFromFen } from "../lib/captured";
import LiveEngine from "../components/LiveEngine";
import TagEditor from "../components/TagEditor";
import { Button, Card, ExtLink, Menu, MenuItem, ResultBadge } from "../components/ui";
import FocusBoard, { FocusButton, FocusMenuItem } from "../components/FocusBoard";
import { PlusBadge, PlusLock } from "../components/PlusLock";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import { de, deInt, deShort } from "../lib/format";
import { openExternal } from "../lib/ext";
import { evalLabel, winProb } from "../lib/evaluation";
import { replaySans } from "../lib/position";
import { plyOffset, shareHistory } from "../lib/share/notation";
import { selectionStyles } from "../lib/boardMoves";
import {
  clocksAtPly,
  formatClock,
  parseClocks,
  parseTimeControl,
  timeControlLabel,
} from "../lib/clocks";
import { tcLabel } from "../lib/gameUi";
import { accuraciesFromMoveEvals } from "../lib/accuracy";
import { useDiagramMode } from "../lib/diagramMode";

/** Die kommentierte Partie kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
import { Laufzettel } from "../components/blatt/Laufzettel";
const AnalysisBlatt = lazy(() => import("./blatt/AnalysisBlatt"));

/** Leere Zugliste als Konstante · ein neues Array je Render würde die
    davon abhängigen useMemo-Ketten bei jedem Durchlauf neu rechnen. */
const NO_MOVES: string[] = [];

/** Einheitliche Zug-Sicht für Demo- und DB-Partien. */
interface ViewMove {
  san: string;
  evalCp: number | null; // nach dem Zug, aus Weiß-Sicht
  mateIn: number | null;
  nag?: string;
  bestUci?: string;
  playedUci?: string;
  judgment?: MoveJudgment;
}

type MoveJudgment =
  | "book"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** Buchzüge tragen wie bei chess.com ein Buch-Symbol statt eines Kürzels. */
const NAG: Record<MoveJudgment, string> = {
  book: "",
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "•",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

/**
 * Farbe je Bewertung · Tokens statt Werte, damit die Zugliste dem Thema folgt.
 * Im farbsicheren Thema hängt daran mehr als der Farbton: Dort laufen `win`
 * und `loss` über Blau und Orange, und genau hier wird das gebraucht.
 */
const JUDGMENT_COLOR: Record<MoveJudgment, string> = {
  book: "var(--color-gold-dim)",
  brilliant: "var(--color-win)",
  great: "var(--color-blue)",
  best: "var(--color-win)",
  excellent: "var(--color-accent)",
  good: "var(--color-draw)",
  inaccuracy: "var(--color-gold)",
  mistake: "var(--color-warn)",
  blunder: "var(--color-loss)",
};

/** Bewertungen, die in der Zugliste ein Kürzel hinter dem Zug tragen. */
const MARKED_IN_LIST: MoveJudgment[] = ["brilliant", "excellent", "inaccuracy", "blunder"];

/**
 * Kürzel bzw. Symbol einer Bewertung. Das Buch bleibt so groß wie die Kürzel
 * daneben, damit alle Marker gleich wirken.
 */
function judgmentMark(judgment: MoveJudgment, size: number | string = "48%"): ReactNode {
  return judgment === "book" ? <BookOpen size={size} strokeWidth={2.6} /> : NAG[judgment];
}

function judgmentLabel(t: TFunc, judgment: string): string {
  const labels: Record<string, Parameters<TFunc>[0]> = {
    book: "an.bookMove",
    brilliant: "an.brilliant",
    great: "an.great",
    best: "an.best",
    excellent: "an.excellent",
    good: "an.good",
    inaccuracy: "an.inaccuracy",
    mistake: "an.mistake",
    blunder: "an.blunder",
  };
  return t(labels[judgment] ?? "an.good");
}

/**
 * Restzeit einer Seite an der gezeigten Stellung.
 *
 * Die Uhr ist keine laufende Uhr, sondern der Stand der Partie an genau diesem
 * Halbzug · beim Blättern läuft sie mit der Zugliste vor und zurück. Die Seite
 * am Zug ist hervorgehoben, darunter steht bei Bedarf, was ihr letzter Zug
 * gekostet hat.
 */
function ClockBadge({
  centiseconds,
  active,
  spent,
  locale,
}: {
  centiseconds: number | null;
  active: boolean;
  /** Verbrauchte Zeit des letzten Zuges dieser Seite (null = unbekannt). */
  spent: number | null;
  locale: Locale;
}) {
  if (centiseconds == null) return null;
  const low = centiseconds < 3000;
  return (
    <span className="flex items-baseline gap-1.5">
      {spent != null && (
        <span className="text-[11px] tabular-nums text-ink3">
          +{formatClock(spent, locale)}
        </span>
      )}
      <span
        className={`rounded-md border px-2 py-0.5 text-[13px] font-semibold tabular-nums ${
          active
            ? low
              ? "border-loss/50 bg-loss-soft text-loss"
              : "border-accent-dim bg-accent-soft text-accent"
            : "border-line bg-panel2 text-ink3"
        }`}
      >
        {formatClock(centiseconds, locale)}
      </span>
    </span>
  );
}

/** Zahl fürs Chart / die Eval-Bar: Matt zählt wie ±10 Bauern. */
function evalNum(cp: number | null, mate: number | null): number {
  if (mate != null) return mate > 0 ? 1000 : -1000;
  return cp ?? 0;
}

type Phase = "opening" | "middlegame" | "endgame";

/**
 * Halbzug, an dem Mittel- bzw. Endspiel beginnen · gleiche Regel wie
 * `chess::phase_of` im Backend: Endspiel ab höchstens sechs Offizieren,
 * Eröffnung bis Halbzug 20.
 */
function phaseStarts(sans: string[]): { middlegame: number | null; endgame: number | null } {
  const chess = new Chess();
  let middlegame: number | null = null;
  let endgame: number | null = null;
  for (let i = 0; i < sans.length; i++) {
    try {
      chess.move(sans[i]);
    } catch {
      break;
    }
    const ply = i + 1;
    const officers = chess
      .board()
      .flat()
      .filter((square) => square && "nbrq".includes(square.type)).length;
    const phase: Phase = officers <= 6 ? "endgame" : ply <= 20 ? "opening" : "middlegame";
    if (phase === "middlegame" && middlegame == null) middlegame = ply;
    if (phase === "endgame" && endgame == null) {
      endgame = ply;
      break;
    }
  }
  // Ein Endspiel, das vor Halbzug 21 beginnt, überspringt das Mittelspiel.
  if (endgame != null && middlegame != null && middlegame >= endgame) middlegame = null;
  return { middlegame, endgame };
}

function rowsToViewMoves(sans: string[], rows: MoveEvalRow[]): ViewMove[] {
  const byPly = new Map(rows.map((r) => [r.ply, r]));
  const chess = new Chess();
  let prevEval = 20;
  return sans.map((san, i) => {
    const r = byPly.get(i + 1);
    let playedUci = "";
    try {
      const played = chess.move(san);
      playedUci = `${played.from}${played.to}${played.promotion ?? ""}`;
    } catch {
      // Ungueltige Alt-Daten bleiben weiterhin sichtbar.
    }
    const currentEval = r ? evalNum(r.eval_cp, r.mate_in) : prevEval;
    const before = winProb(prevEval) / 100;
    const after = winProb(currentEval) / 100;
    const drop = i % 2 === 0 ? Math.max(0, before - after) : Math.max(0, after - before);
    const engineJudgment = r?.judgment as MoveJudgment | "" | undefined;
    const isBest = !!r?.best_uci && r.best_uci.slice(0, playedUci.length) === playedUci;
    let judgment: MoveJudgment | undefined = engineJudgment || undefined;
    if (r && !judgment) {
      if (i < 16 && drop < 0.03) judgment = "book";
      else if (isBest && i >= 16 && /[x+#=]/.test(san) && Math.abs(currentEval - prevEval) >= 40) judgment = "brilliant";
      else if (isBest) judgment = "best";
      else if (drop < 0.01) judgment = "great";
      else if (drop < 0.03) judgment = "excellent";
      else if (drop < 0.10) judgment = "good";
    }
    prevEval = currentEval;
    return {
      san,
      evalCp: r ? r.eval_cp : null,
      mateIn: r ? r.mate_in : null,
      nag: judgment ? NAG[judgment] : undefined,
      bestUci: r?.best_uci,
      playedUci,
      judgment,
    };
  });
}

/** ACPL je Seite aus der Evalkurve (Startstellung ≈ +20 cp). */
function acpl(moves: ViewMove[]): { white: number; black: number } {
  let prev = 20;
  const losses: { white: number[]; black: number[] } = { white: [], black: [] };
  moves.forEach((m, i) => {
    if (m.evalCp == null && m.mateIn == null) return;
    const cur = Math.max(-1000, Math.min(1000, evalNum(m.evalCp, m.mateIn)));
    const side = i % 2 === 0 ? "white" : "black";
    const loss = side === "white" ? prev - cur : cur - prev;
    losses[side].push(Math.max(0, Math.min(1000, loss)));
    prev = cur;
  });
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  return { white: avg(losses.white), black: avg(losses.black) };
}

/** Kommentar zu einem annotierten Zug: Bewertungssprung + bessere Alternative. */
function commentFor(t: TFunc, sansBefore: string[], m: ViewMove, prevEval: number): string | null {
  if (!m.judgment) return null;
  if (!(["inaccuracy", "mistake", "blunder"] as MoveJudgment[]).includes(m.judgment)) {
    return t("an.qualityComment", { judgment: judgmentLabel(t, m.judgment) });
  }
  let best = "";
  if (m.bestUci) {
    try {
      const chess = new Chess();
      for (const s of sansBefore) chess.move(s);
      const move = chess.move({
        from: m.bestUci.slice(0, 2),
        to: m.bestUci.slice(2, 4),
        promotion: m.bestUci.length > 4 ? m.bestUci[4] : undefined,
      });
      best = move.san;
    } catch {
      /* Zug nicht rekonstruierbar · Kommentar ohne Alternative */
    }
  }
  const from = evalLabel(prevEval);
  const to = m.mateIn != null ? `#${m.mateIn}` : evalLabel(m.evalCp ?? 0);
  const base = t("an.comment", { judgment: judgmentLabel(t, m.judgment), from, to });
  return best ? base + t("an.commentBetter", { san: best }) : base;
}

/**
 * Quellen des Eröffnungsbuchs.
 *
 * Drei davon zählen Partien und beantworten „was wird hier gespielt?" ·
 * Meisterpartien, der Online-Bestand und die eigene Referenzdatenbank. Die
 * vierte ist ChessDB und beantwortet etwas anderes: „was hält eine Engine
 * davon?". Beides gehört in dieselbe Karte, aber nicht in dieselbe Spalte.
 */
type BookTab = BookSource | "engine";

const BOOK_SOURCE_KEY = "kiebitz.book.source";

/**
 * Fehler des Eröffnungsbuchs in Worte fassen.
 *
 * Das Backend liefert für zwei Fälle eine Kennung statt eines Satzes, weil
 * beide eine Handlung nach sich ziehen und deshalb in der Sprache des Nutzers
 * stehen müssen: der fehlende oder abgelaufene Lichess-Token und die Bitte,
 * langsamer zu fragen. Alles andere ist Diagnose („Verbindung abgelehnt") und
 * wird durchgereicht — dort hilft der Wortlaut mehr als eine Umschreibung.
 */
function bookErrorText(error: string, t: TFunc): string {
  if (error.includes("explorer:auth")) return t("an.explorerAuth");
  if (error.includes("explorer:rate")) return t("an.explorerRate");
  return error;
}

/**
 * Welcher Reiter beim ersten Mal offen steht.
 *
 * ChessDB und nicht Meisterpartien · als einzige der vier Quellen braucht sie
 * weder Plus noch einen Lichess-Token und antwortet deshalb jedem sofort. Wer
 * die Analyse zum ersten Mal öffnet, bekam sonst dort, wo eine Auskunft stehen
 * sollte, die Aufforderung, erst einen Token anzulegen. Die Reiter stehen
 * daneben und sagen, was es sonst noch gibt; ein Klick genügt, und ab dann
 * merkt sich das Gerät die Wahl.
 */
function readBookSource(): BookTab {
  try {
    const stored = localStorage.getItem(BOOK_SOURCE_KEY);
    if (stored === "masters" || stored === "lichess" || stored === "own" || stored === "engine") {
      return stored;
    }
  } catch {
    /* Storage nicht verfügbar */
  }
  return "engine";
}

/**
 * Vorschau für die gesperrte Karte.
 *
 * Gesperrt wird nichts abgefragt · eine Netzanfrage für eine Funktion, die
 * nicht freigeschaltet ist, wäre verschwendet. Die Sperre legt ohnehin eine
 * Unschärfe darüber, gezeigt werden muss also nur die Form.
 */
const BOOK_PREVIEW: BookResult = {
  source: "masters",
  status: "ok",
  white: 1_240_113,
  draws: 812_004,
  black: 998_211,
  moves: [
    { uci: "e2e4", san: "e4", white: 620_000, draws: 400_000, black: 500_000, average_rating: 2412 },
    { uci: "d2d4", san: "d4", white: 300_000, draws: 260_000, black: 240_000, average_rating: 2388 },
    { uci: "g1f3", san: "Nf3", white: 140_000, draws: 90_000, black: 120_000, average_rating: 2401 },
    { uci: "c2c4", san: "c4", white: 96_000, draws: 62_000, black: 78_000, average_rating: 2396 },
  ],
  top_games: [],
  opening: null,
  cached: true,
};

export default function Analysis({
  targetGameId,
  shared = null,
}: {
  targetGameId: number | null;
  /** Stellung aus einem geteilten Link · sie eröffnet das freie Brett. */
  shared?: SharePayload | null;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const desktop = backend.mode === "desktop";
  // Die Bedienleiste unter dem Brett fasst auf Handybreite ihre Nebenaktionen
  // zusammen · siehe `boardControls`.
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  // Analysebudget: die Zeit, die vor einer Partie verbracht wird. Bisher zählte
  // nur ein im Kalender abgehakter Termin · eine Engine, die im Hintergrund
  // 1.000 Partien rechnet, hat nie ein Partie-Review ersetzt, aber wer eine
  // Stunde lang durch seine Fehler blättert, hat sie auch nicht angesammelt.
  useTrainingSession("analysis", desktop);
  const batchGate = usePlusGate("background_analysis");

  const [games, setGames] = useState<GameSummary[]>([]);
  const [game, setGame] = useState<GameRecord | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scratchSans, setScratchSans] = useState<string[]>([]);
  const [scratchSelected, setScratchSelected] = useState<string | null>(null);
  const [variation, setVariation] = useState<{ basePly: number; sans: string[] } | null>(null);
  const [rows, setRows] = useState<MoveEvalRow[] | null>(null);
  const [ply, setPly] = useState(0);
  const [liveEval, setLiveEval] = useState<{ cp: number | null; mate: number | null } | null>(null);
  const [liveBestUci, setLiveBestUci] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [posSearch, setPosSearch] = useState<PositionSearch | null>(null);
  /**
   * ChessDB · `null`, solange die Einstellungen nicht gelesen sind.
   *
   * Zwei Dinge hängen daran und wollen den Zwischenstand verschieden gedeutet
   * haben: Der Reiter steht schon da (er ist ab Werk an, und auf ihm landet
   * `readBookSource` beim ersten Öffnen), gefragt wird aber noch nicht. Ein
   * `false` als Startwert nähme den Reiter für einen Moment weg, ein `true`
   * schickte eine Anfrage ins Netz für jemanden, der ChessDB abgeschaltet hat.
   */
  const [chessdbOn, setChessdbOn] = useState<boolean | null>(null);
  const [playerProfile, setPlayerProfile] = useState({ cc: "", li: "", display: "" });
  const [book, setBook] = useState<ChessDbResult | null>(null);
  // „Wird geladen" und nicht „keine Auskunft": Bis die Einstellungen gelesen
  // sind, steht noch keine Anfrage · das ist ein Warten und kein Ergebnis.
  const [bookState, setBookState] = useState<"idle" | "loading" | "error">("loading");
  // Eröffnungsbuch · welche Quelle zuletzt gewählt war, merkt sich das Gerät.
  // Das ist eine Ansichtssache und gehört deshalb nicht in die Einstellungen.
  const [bookSource, setBookSource] = useState<BookTab>(readBookSource);
  // Vorbelegt wie die Voreinstellung selbst · sonst stünde für den Moment bis
  // zum Laden der Einstellungen „abgeschaltet" in der Karte.
  const [explorerOn, setExplorerOn] = useState(true);
  const [explorerFilters, setExplorerFilters] = useState({ ratings: "", speeds: "" });
  const [stats, setStats] = useState<BookResult | null>(null);
  const [statsState, setStatsState] = useState<"idle" | "loading" | "error">("idle");
  const [statsError, setStatsError] = useState<string | null>(null);
  const [refGames, setRefGames] = useState(0);
  const explorerGate = usePlusGate("opening_explorer");
  const refdbGate = usePlusGate("reference_database");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  /**
   * Brett von Hand gedreht.
   *
   * Ab Werk zeigt das Brett die eigene Seite (bzw. die Seite, die ein geteilter
   * Link mitbringt) · das ist fast immer die richtige. „Fast" ist der Grund
   * für diesen Schalter: Wer die Stellung des Gegners nachrechnet, dreht sie
   * einmal um und will danach weiterblättern, ohne die Drehung zu verlieren.
   * Eine andere Partie hebt sie wieder auf: Dort gilt wieder die eigene Seite.
   */
  const [flipped, setFlipped] = useState(false);
  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);
  /**
   * Ausgangsstellung des freien Bretts · normalerweise die Grundstellung, nach
   * einem geteilten Link die Stellung aus dem Link.
   */
  const [opened, setOpened] = useState<SharePayload | null>(null);

  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const reloadGames = useCallback(() => {
    return listGameSummaries().then((gs) => {
      setGames(gs.filter((g) => g.has_moves));
      return gs;
    });
  }, []);

  // Partien laden und Auswahl initialisieren.
  useEffect(() => {
    if (!desktop) return;
    reloadGames().then((gs) => {
      const withMoves = gs.filter((g) => g.has_moves);
      const pick = targetGameId != null ? withMoves.find((g) => g.id === targetGameId) : null;
      setSelectedId(pick?.id ?? null);
    });
  }, [desktop, targetGameId, reloadGames]);

  // Eine andere Partie fängt wieder aus der eigenen Sicht an · die Drehung
  // gehört zu der Stellung, für die man sie gemacht hat.
  useEffect(() => {
    setFlipped(false);
  }, [selectedId]);

  // Eine geteilte Stellung ersetzt die Auswahl: Sie gehört an das freie Brett,
  // nicht in eine importierte Partie.
  useEffect(() => {
    if (!shared) return;
    setOpened(shared);
    setSelectedId(null);
    setFlipped(false);
    setScratchSans([]);
    setScratchSelected(null);
    setVariation(null);
    setPly(0);
    setLiveEval(null);
    setLiveBestUci(null);
    setNotice(shared.title?.trim() || t("sh.opened"));
  }, [shared, t]);

  // Analyse-Events.
  useEffect(() => {
    if (!desktop) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const reg = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : cleanups.push(u)));
    reg(
      onAnalysisProgress((p) => {
        setRunning(true);
        setProgress(p);
      })
    );
    reg(
      onAnalysisGameDone((p) => {
        if (p.game_id === selectedRef.current) {
          gameAnalysis(p.game_id).then(setRows).catch(() => {});
        }
      })
    );
    reg(
      onAnalysisDone((p) => {
        setRunning(false);
        setProgress(null);
        const reloaded = reloadGames();
        if (!p.error && !p.canceled && p.analyzed > 0) {
          void reloaded
            .then((allGames) =>
              maybeRequestPlayReview(backend.info, {
                kind: "analysis-complete",
                totalAnalyzedGames: allGames.filter((game) => game.analyzed).length,
              })
            )
            .catch(() => {});
        }
        setNotice(
          p.error
            ? t("an.aborted", { e: p.error })
            : p.canceled
              ? t("an.stopped", { n: p.analyzed })
              : t("an.finished", { n: p.analyzed })
        );
      })
    );
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [backend.info, desktop, reloadGames, t]);

  // ChessDB-Einstellung einmalig lesen.
  useEffect(() => {
    if (!desktop) return;
    getSettings()
      .then((s) => {
        setChessdbOn(s.chessdb_enabled);
        setExplorerOn(s.explorer_enabled !== false);
        setExplorerFilters({
          ratings: s.explorer_ratings ?? "",
          speeds: s.explorer_speeds ?? "",
        });
        setPlayerProfile({ cc: s.cc_user ?? "", li: s.li_user ?? "", display: s.display_name ?? "" });
      })
      .catch(() => {});
  }, [desktop]);

  useEffect(() => {
    if (!desktop || selectedId == null) {
      setGame(null);
      return;
    }
    setGame(null);
    let current = true;
    getGame(selectedId)
      .then((record) => { if (current) setGame(record); })
      .catch(() => { if (current) setGame(null); });
    return () => { current = false; };
  }, [desktop, selectedId]);

  const scratch = desktop && selectedId == null;
  /**
   * Zwischen der Auswahl einer Partie und ihrem Datensatz liegt ein
   * Moment ohne Inhalt. Er gehört weder dem freien Brett noch der Demo:
   * Die Demo ist die Schaufensterpartie des Webs, und auf dem Desktop
   * hat sie nichts zu suchen · sie stünde für den Bruchteil einer
   * Sekunde als fremde Partie unter dem Kopf der eigenen.
   */
  const loadingGame = desktop && selectedId != null && game == null;

  // Wer eine Partie auswählt, verlässt die geteilte Stellung · sonst bliebe
  // ihre Ausgangsstellung unter der Partie liegen.
  useEffect(() => {
    if (selectedId != null) setOpened(null);
  }, [selectedId]);

  // Gespeicherte Analyse der gewählten Partie laden.
  useEffect(() => {
    if (!desktop || selectedId == null) return;
    setRows(null);
    gameAnalysis(selectedId).then(setRows).catch(() => setRows([]));
  }, [desktop, selectedId]);

  // Zug-Sicht: Demo im Web, echte Partie auf dem Desktop.
  const live = desktop && game != null;
  const sans = useMemo(
    () => live
      ? game.moves.split(" ").filter(Boolean)
      : scratch
        ? scratchSans
        : loadingGame
          ? NO_MOVES
          : featuredGame.moves.map((m) => m.san),
    [live, game, scratch, scratchSans, loadingGame]
  );
  const viewMoves: ViewMove[] = useMemo(() => {
    if (!desktop) {
      const byNag: Record<string, MoveJudgment> = { "?!": "inaccuracy", "?": "mistake", "??": "blunder" };
      return featuredGame.moves.map((m) => ({
        san: m.san,
        evalCp: m.eval,
        mateIn: null,
        nag: m.nag,
        judgment: m.nag ? byNag[m.nag] : undefined,
      }));
    }
    return rowsToViewMoves(sans, live ? rows ?? [] : []);
  }, [desktop, live, sans, rows]);

  const analyzedRows = live ? (rows?.length ?? 0) > 0 : !loadingGame;

  // Notizen und Tags der gewählten Partie in die Eingaben übernehmen.
  useEffect(() => {
    setNoteDraft(game?.note ?? "");
    setNoteSaved(false);
    setNotesError(null);
  }, [game?.id, game?.note]);

  /** Aktualisiert die Partie lokal, damit Liste und Panel sofort stimmen. */
  const patchGame = (patch: Partial<GameRecord>) => {
    setGame((current) => current ? { ...current, ...patch } : current);
    setGames((current) => current.map((g) =>
      g.id === selectedId
        ? { ...g, ...patch, has_note: patch.note == null ? g.has_note : Boolean(patch.note.trim()) }
        : g
    ));
  };

  const saveNote = async () => {
    if (!game?.id) return;
    setNotesError(null);
    try {
      await setGameNote(game.id, noteDraft);
      patchGame({ note: noteDraft });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    } catch (e) {
      setNotesError(String(e));
    }
  };

  const saveTags = async (next: string[]) => {
    if (!game?.id) return;
    setNotesError(null);
    try {
      patchGame({ tags: await setGameTags(game.id, next) });
    } catch (e) {
      setNotesError(String(e));
    }
  };

  // Beim Partiewechsel ans Ende springen.
  useEffect(() => {
    setPly(sans.length);
    setLiveEval(null);
    setLiveBestUci(null);
    setScratchSelected(null);
    setVariation(null);
  }, [selectedId, sans.length]);

  const openedFen = opened?.fen;
  /**
   * Die Züge bis zur gezeigten Stellung · in einer Variante deren Ast, sonst
   * die Partie bis zum aktuellen Halbzug. Sie tragen beides: das Brett und die
   * Notation, die ein geteilter Link mitnimmt.
   */
  const shownSans = useMemo(
    () => variation
      ? [...sans.slice(0, variation.basePly), ...variation.sans]
      : sans.slice(0, ply),
    [sans, ply, variation]
  );
  /**
   * Stellung und der Zug, der zu ihr führte · in einem Durchgang nachgespielt,
   * weil das Brett beides zugleich zeigt.
   */
  const position = useMemo(
    () => replaySans(shownSans, undefined, openedFen),
    [shownSans, openedFen]
  );
  /**
   * Halbzüge vor dem ersten eigenen Zug · am freien Brett hinter einem
   * geteilten Link fängt die Zählung nicht bei eins an, sondern dort, wo die
   * geteilte Stellung steht.
   */
  const moveOffset = openedFen ? plyOffset(openedFen) : 0;
  const fen = position.fen;
  /**
   * Der markierte Zug. In der Ausgangsstellung einer geteilten Stellung gibt
   * es keinen nachgespielten Zug · dort kommt er aus dem Link, denn auch dann
   * soll zu sehen sein, woher die Stellung kommt.
   */
  const boardLastMove = useMemo(
    () => position.moves[position.moves.length - 1] ?? opened?.lastMove ?? null,
    [position, opened]
  );

  /**
   * Partieende · nur an der Schlussstellung der Partie selbst. Wer
   * zurückblättert oder in einer Variante steht, sieht eine Stellung, die so
   * nie das Ende war; dort wäre der Hinweis schlicht falsch.
   *
   * Bei importierten Partien schlägt der gespeicherte Grund die Ableitung: nur
   * er kennt Aufgabe und Zeitüberschreitung. Am freien Brett und in der
   * Web-Vorschau bleibt, was in der Stellung steht.
   */
  const boardEndState = useMemo(() => {
    if (variation || ply !== sans.length || sans.length === 0) return null;
    if (live && game) {
      return gameEnd({
        fen,
        termination: game.termination,
        result: game.result,
        color: game.color,
      });
    }
    return endForPosition(fen);
  }, [variation, ply, sans.length, live, game, fen]);
  const boardEnd = useBoardEndView(boardEndState);

  const playBoardMove = (from: string, to: string, promotion = "q"): boolean => {
    if (!scratch && !live) return false;
    try {
      const chess = new Chess(fen);
      const move = chess.move({ from, to, promotion });
      if (scratch) {
        const next = [...scratchSans.slice(0, ply), move.san];
        setScratchSans(next);
        setPly(next.length);
      } else {
        setVariation((current) => current
          ? { ...current, sans: [...current.sans, move.san] }
          : { basePly: ply, sans: [move.san] });
      }
      setScratchSelected(null);
      setLiveEval(null);
      setLiveBestUci(null);
      return true;
    } catch {
      return false;
    }
  };

  const onBoardSquareClick = (square: string) => {
    if (!scratch && !live) return;
    const chess = new Chess(fen);
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (scratchSelected && scratchSelected !== square) {
      const moved = playBoardMove(scratchSelected, square);
      setScratchSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setScratchSelected(scratchSelected === square ? null : square);
    }
  };

  /**
   * Tastatur-Navigation · dieselben Tasten wie auf den großen Schachseiten:
   * Pfeile blättern Halbzüge, Pos1/Ende springen an die Ränder, „f" dreht das
   * Brett.
   *
   * Der Wächter oben ist kein Detail: Die Analyse hat ein Notizfeld, ein
   * Tag-Eingabefeld und die Partieauswahl. Ohne ihn sprang beim Schreiben
   * einer Notiz mit jedem Pfeil zusätzlich das Brett · der Cursor wanderte im
   * Text, und die Stellung darunter wechselte gleich mit.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      const jump = (next: (p: number) => number) => {
        e.preventDefault();
        setVariation(null);
        setPly((p) => Math.max(0, Math.min(sans.length, next(p))));
      };
      if (e.key === "ArrowLeft") jump((p) => p - 1);
      else if (e.key === "ArrowRight") jump((p) => p + 1);
      else if (e.key === "Home") jump(() => 0);
      else if (e.key === "End") jump(() => sans.length);
      else if (e.key === "f" || e.key === "F") setFlipped((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sans.length]);

  // Positionssuche (entprellt).
  useEffect(() => {
    if (!desktop) return;
    const timer = setTimeout(() => {
      searchPosition(fen).then(setPosSearch).catch(() => setPosSearch(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [desktop, fen]);

  // Gewählte Quelle merken · nächste Sitzung beginnt, wo diese aufgehört hat.
  useEffect(() => {
    try {
      localStorage.setItem(BOOK_SOURCE_KEY, bookSource);
    } catch {
      /* Storage nicht verfügbar */
    }
  }, [bookSource]);

  // Ohne ChessDB gibt es den Engine-Reiter nicht · dann steht die Karte auf
  // der Quelle, die sie ohne ihn hätte.
  useEffect(() => {
    if (chessdbOn === false && bookSource === "engine") setBookSource("masters");
  }, [chessdbOn, bookSource]);

  // Bestand der Referenzdatenbank · entscheidet, ob der Reiter „Meine
  // Datenbank" etwas zu zeigen hat oder erst auf den Import verweist.
  useEffect(() => {
    if (!desktop) return;
    refdbStatus()
      .then((status) => setRefGames(status.games))
      .catch(() => setRefGames(0));
  }, [desktop]);

  /**
   * Häufigkeiten zur aktuellen Stellung · Meister, Online oder eigene
   * Datenbank.
   *
   * Entprellt wie die Stellungssuche: Wer durch eine Partie blättert, erzeugt
   * sonst pro Halbzug eine Anfrage. Gesperrt (kein Plus) wird gar nicht erst
   * gefragt · die Karte zeigt dann die Vorschau.
   */
  useEffect(() => {
    if (!desktop || bookSource === "engine") return;
    const gate = bookSource === "own" ? refdbGate : explorerGate;
    if (!gate.unlocked) return;
    if (bookSource !== "own" && !explorerOn) return;
    setStatsState("loading");
    let stale = false;
    const timer = setTimeout(() => {
      const request =
        bookSource === "own"
          ? refdbQuery(fen)
          : explorerQuery(fen, bookSource, explorerFilters.ratings, explorerFilters.speeds);
      request
        .then((result) => {
          if (stale) return;
          setStats(result);
          setStatsError(null);
          setStatsState("idle");
        })
        .catch((error) => {
          if (stale) return;
          setStats(null);
          setStatsError(bookErrorText(String(error), t));
          setStatsState("error");
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [
    desktop,
    fen,
    bookSource,
    explorerOn,
    explorerFilters.ratings,
    explorerFilters.speeds,
    explorerGate.unlocked,
    refdbGate.unlocked,
  ]);

  // ChessDB-Eröffnungsbuch (entprellt, cache-gestützt im Backend).
  useEffect(() => {
    if (!desktop || chessdbOn !== true) return;
    setBookState("loading");
    let stale = false;
    const timer = setTimeout(() => {
      chessdbQuery(fen)
        .then((r) => {
          if (!stale) {
            setBook(r);
            setBookState("idle");
          }
        })
        .catch(() => {
          if (!stale) {
            setBook(null);
            setBookState("error");
          }
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [desktop, chessdbOn, fen]);

  // Eval an der aktuellen Stellung: live von der Engine, sonst gespeichert.
  const storedPly = variation?.basePly ?? ply;
  const storedEval = storedPly === 0 ? 20 : evalNum(viewMoves[storedPly - 1]?.evalCp ?? null, viewMoves[storedPly - 1]?.mateIn ?? null);
  const shownEval = liveEval ? evalNum(liveEval.cp, liveEval.mate) : storedEval;
  const whitePct = winProb(shownEval);
  const currentMove = !variation && ply > 0 ? viewMoves[ply - 1] : null;
  const currentComment = useMemo(() => {
    if (!currentMove) return null;
    if (scratch || variation) return null;
    if (!live) return featuredGame.moves[ply - 1]?.comment ?? null;
    const prevEval = ply <= 1 ? 20 : evalNum(viewMoves[ply - 2]?.evalCp ?? null, viewMoves[ply - 2]?.mateIn ?? null);
    return commentFor(t, sans.slice(0, ply - 1), currentMove, prevEval);
  }, [scratch, variation, live, currentMove, ply, sans, viewMoves, t]);

  /**
   * Die Anmerkung zu einem beliebigen Zug · dieselbe Regel wie für den
   * laufenden. Im Buchsatz stehen sie alle, nicht nur die des Halbzugs, auf
   * dem man gerade steht.
   */
  const blattKommentar = (index: number): string | null => {
    const move = viewMoves[index];
    if (!move) return null;
    // Im Web steht die Demo-Partie; auf dem freien Brett steht nichts. Die
    // Anmerkungen der Demo gehören zu deren Zügen und nicht zu den eigenen —
    // ohne diese Unterscheidung hätte das freie Brett fremde Urteile über
    // selbst gespielte Züge geschrieben.
    if (!desktop) return featuredGame.moves[index]?.comment ?? null;
    if (!live) return null;
    if (!move.judgment) return null;
    if (!(["inaccuracy", "mistake", "blunder"] as MoveJudgment[]).includes(move.judgment)) return null;
    const prevEval =
      index === 0 ? 20 : evalNum(viewMoves[index - 1]?.evalCp ?? null, viewMoves[index - 1]?.mateIn ?? null);
    return commentFor(t, sans.slice(0, index), move, prevEval);
  };

  const evalSeries = viewMoves
    .map((m, i) => ({ ply: i + 1, eval: Math.max(-600, Math.min(600, evalNum(m.evalCp, m.mateIn))) / 100 }))
    .filter((_, i) => !live || (rows ?? []).length > i);

  // Phasengrenzen und aktuelle Position für die Bewertungskurve.
  const phaseMarkers = useMemo(() => {
    const { middlegame, endgame } = phaseStarts(sans);
    const marks: { phase: Phase; ply: number }[] = [{ phase: "opening", ply: 1 }];
    if (middlegame != null) marks.push({ phase: "middlegame", ply: middlegame });
    if (endgame != null) marks.push({ phase: "endgame", ply: endgame });
    return marks;
  }, [sans]);
  const currentPly = variation?.basePly ?? ply;

  // ── Uhren ────────────────────────────────────────────────────────────────
  // Nur echte Partien bringen Zeitdaten mit; fehlen sie, entfällt die Anzeige
  // komplett statt Nullen zu zeigen.
  const clockValues = useMemo(
    () => (live ? parseClocks(game.clocks ?? "") : []),
    [live, game]
  );
  const timeControl = useMemo(
    () => (live ? parseTimeControl(game.time_control ?? "") : null),
    [live, game]
  );
  const clockPly = variation?.basePly ?? ply;
  const clockView = useMemo(
    () => clocksAtPly(clockValues, clockPly, timeControl),
    [clockValues, clockPly, timeControl]
  );
  const hasClocks = clockValues.length > 0;
  // Wer an der gezeigten Stellung am Zug ist · Weiß nach geraden Halbzügen.
  const whiteToMove = clockPly % 2 === 0;
  const spentBy = (white: boolean) =>
    hasClocks && clockView.spent != null && whiteToMove !== white ? clockView.spent : null;

  const summary = useMemo(() => {
    const counts: Record<MoveJudgment, number> = {
      book: 0,
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
    };
    viewMoves.forEach((m, i) => {
      const mine = !live || !game ? true : (game.color === "white") === (i % 2 === 0);
      if (m.judgment && mine) counts[m.judgment]++;
    });
    return { ...counts, acpl: acpl(viewMoves) };
  }, [viewMoves, live, game]);

  const derivedAccuracies = useMemo(
    () => game && rows?.length ? accuraciesFromMoveEvals(rows, game.color) : null,
    [game, rows]
  );

  const unanalyzed = games.filter((g) => !g.analyzed && !g.analysis_excluded);

  /**
   * In der Partienliste weiterblättern.
   *
   * Der Ablauf, den man an einem Abend am häufigsten wiederholt, ist „Partie
   * ansehen · nächste Partie ansehen". Über die Auswahlliste sind das drei
   * Griffe (aufklappen, suchen, treffen); hier ist es einer, und er steht
   * direkt neben der Liste, aus der er blättert.
   */
  const gameIndex = selectedId == null ? -1 : games.findIndex((g) => g.id === selectedId);
  const stepGame = (delta: number) => {
    const next = gameIndex < 0 ? games[0] : games[gameIndex + delta];
    if (next?.id != null) setSelectedId(next.id);
  };
  const canStepGame = (delta: number) =>
    gameIndex < 0 ? games.length > 0 && delta > 0 : games[gameIndex + delta]?.id != null;
  // Ein geteilter Link bringt die Blickrichtung mit · so sieht der Empfänger
  // dieselbe Seite wie der Absender.
  const baseOrientation = opened
    ? opened.orientation
    : live && game.color === "black"
      ? "black"
      : "white";
  const orientation: "white" | "black" = flipped
    ? baseOrientation === "white"
      ? "black"
      : "white"
    : baseOrientation;
  const ownPlayerName = live
    ? game.my_name?.trim()
      || (game.source === "chess.com" ? playerProfile.cc : game.source === "lichess" ? playerProfile.li : "")
      || playerProfile.display
      || t("an.me")
    : t("an.me");
  const demoPlayer = (label: string) => {
    const match = label.match(/^(.*?)\s*\((\d+)\)$/);
    return { name: match?.[1] ?? label, elo: match ? Number(match[2]) : 0 };
  };
  const captureWhite = "Alex (1462)";
  const captureBlack = locale === "de" ? "Springerfreund (1448)" : "KnightFriend (1448)";
  const whitePlayer = live
    ? { name: game.color === "white" ? ownPlayerName : game.opponent, elo: game.color === "white" ? game.my_elo : game.opp_elo }
    : scratch || loadingGame ? { name: t("common.white"), elo: 0 } : demoPlayer(storeCapture ? captureWhite : featuredGame.white);
  const blackPlayer = live
    ? { name: game.color === "black" ? ownPlayerName : game.opponent, elo: game.color === "black" ? game.my_elo : game.opp_elo }
    : scratch || loadingGame ? { name: t("common.black"), elo: 0 } : demoPlayer(storeCapture ? captureBlack : featuredGame.black);
  const topPlayer = orientation === "white" ? blackPlayer : whitePlayer;
  const bottomPlayer = orientation === "white" ? whitePlayer : blackPlayer;
  // Geschlagene Figuren zur gezeigten Stellung · jede Seite bekommt, was sie
  // selbst geschlagen hat, und der Führende zusätzlich seinen Vorsprung.
  const captured = capturedFromFen(fen);
  const topIsWhite = orientation !== "white";
  const accuracyCells = live ? [
    {
      key: "overall",
      label: t("an.overallAccuracy"),
      mine: game.accuracy ?? derivedAccuracies?.mine.overall ?? null,
      opponent: game.opponent_accuracy ?? derivedAccuracies?.opponent.overall ?? null,
    },
    {
      key: "opening",
      label: t("ins.phase.opening"),
      mine: game.accuracy_opening ?? derivedAccuracies?.mine.opening ?? null,
      opponent: game.opponent_accuracy_opening ?? derivedAccuracies?.opponent.opening ?? null,
    },
    {
      key: "middlegame",
      label: t("ins.phase.middlegame"),
      mine: game.accuracy_middlegame ?? derivedAccuracies?.mine.middlegame ?? null,
      opponent: game.opponent_accuracy_middlegame ?? derivedAccuracies?.opponent.middlegame ?? null,
    },
    {
      key: "endgame",
      label: t("ins.phase.endgame"),
      mine: game.accuracy_endgame ?? derivedAccuracies?.mine.endgame ?? null,
      opponent: game.opponent_accuracy_endgame ?? derivedAccuracies?.opponent.endgame ?? null,
    },
  ] : [];
  const currentQuality = currentMove?.judgment;
  const currentTarget = currentMove?.playedUci?.slice(2, 4);
  const nextMove = !variation ? viewMoves[ply] : null;
  const nextBestUci = liveBestUci || nextMove?.bestUci || "";
  const previewArrows: [string, string, string?][] = nextMove
    ? [
        ...(nextBestUci ? [[nextBestUci.slice(0, 2), nextBestUci.slice(2, 4), "rgba(34,192,138,0.78)"] as [string, string, string]] : []),
        ...(nextMove.playedUci && nextMove.playedUci.slice(0, 4) !== nextBestUci.slice(0, 4)
          ? [[nextMove.playedUci.slice(0, 2), nextMove.playedUci.slice(2, 4), "rgba(217,160,40,0.78)"] as [string, string, string]]
          : []),
      ]
    : nextBestUci ? [[nextBestUci.slice(0, 2), nextBestUci.slice(2, 4), "rgba(34,192,138,0.78)"]] : [];
  const liveArrows: [string, string, string?][] = liveBestUci
    ? [[liveBestUci.slice(0, 2), liveBestUci.slice(2, 4), "rgba(34,192,138,0.78)"]]
    : [];
  /**
   * Eine Stellung der Partie anspringen · aus dem Zugtext, den Tasten unter
   * dem Brett oder der Bewertungskurve.
   *
   * Der einzige Weg zu einem Halbzug; `setPly` allein bliebe hinter einer
   * offenen Variante stehen und zeigte ein Brett, das nicht zum angeklickten
   * Zug gehört.
   */
  const goToPly = (next: number) => {
    setVariation(null);
    setScratchSelected(null);
    setLiveEval(null);
    setLiveBestUci(null);
    setPly(Math.max(0, Math.min(sans.length, next)));
  };
  /**
   * Was von dieser Stellung nach draußen geht.
   *
   * Bewusst ohne Spielernamen: Geteilt wird eine Stellung, nicht die Partie
   * zweier Leute, die davon nichts wissen.
   */
  const openShare = () => {
    const best = nextBestUci;
    setSharing({
      kind: "analysis",
      fen,
      orientation,
      // Derselbe Zug, den auch das Brett hervorhebt · beim Empfänger soll die
      // Stellung so ankommen, wie sie hier steht.
      lastMove: boardLastMove,
      line: best ? [{ from: best.slice(0, 2), to: best.slice(2, 4) }] : [],
      // Wie die Stellung zustande kam · eine Analyse ohne ihre Züge ist nur ein
      // Diagramm. Kam die Stellung selbst aus einem Link, führt dessen Zeile
      // die eigenen Züge an.
      history: shareHistory(shownSans, moveOffset, opened?.history),
      eval: liveEval ?? (currentMove
        ? { cp: currentMove.evalCp ?? null, mate: currentMove.mateIn ?? null }
        : null),
    });
  };

  /**
   * Direktsprung zur Originalpartie, wie im Dashboard und im Partien-Tab.
   * Fehlt die gespeicherte URL (ältere Importe, PGN-Import), führt der Link
   * ersatzweise ins Partiearchiv des eigenen Kontos. Ohne konfigurierten
   * Kontonamen entfällt der Link ganz · eine Archiv-URL ohne Benutzernamen
   * wäre ein Link ins Leere. Manuell erfasste Partien haben kein Original.
   */
  const originUrl = useMemo(() => {
    if (!live || game.source === "manual") return null;
    if (game.url) return game.url;
    const handle = (game.source === "chess.com" ? playerProfile.cc : playerProfile.li).trim();
    if (!handle) return null;
    return game.source === "chess.com"
      ? `https://www.chess.com/games/archive/${encodeURIComponent(handle)}`
      : `https://lichess.org/@/${encodeURIComponent(handle)}/all`;
  }, [live, game, playerProfile.cc, playerProfile.li]);

  // Die Bedenkzeit-Vorgabe steht neben der Zeitklasse, sobald sie bekannt ist ·
  // "Blitz · 3+2" sagt mehr als "Blitz".
  const tcSuffix = live ? timeControlLabel(game.time_control ?? "") : null;
  // Die Kopfzeile einer geladenen Partie in ihren Teilen · auf dem Desktop zu
  // einer Zeile verkettet, mobil auf zwei Ebenen verteilt (siehe unten).
  const gamePlayers = live
    ? `${game.color === "white" ? ownPlayerName : game.opponent} vs. ${game.color === "white" ? game.opponent : ownPlayerName}`
    : null;
  const gameMeta = live
    ? [
        `${tcLabel(game.time_class, locale)}${tcSuffix ? ` ${tcSuffix}` : ""}`,
        game.opening || game.eco || "—",
        game.played_at,
      ]
    : [];
  const headerSub = live
    ? [gamePlayers, ...gameMeta].join(" · ")
    : loadingGame
      ? ""
      : scratch
      ? t("an.freeBoardHint")
      : storeCapture
        ? `${captureWhite} vs. ${captureBlack} · Rapid · 1–0`
        : `${featuredGame.white} vs. ${featuredGame.black} · ${featuredGame.event} · ${featuredGame.result}`;

  /**
   * Die Bestandteile der Brettspalte · einmal beschrieben, zweimal gerendert:
   * hier in der Seite und im Fokus-Brett. Nur die Kennung des Bretts
   * unterscheidet sich, weil react-chessboard seine Instanzen daran auseinander
   * hält · alles andere ist derselbe Zustand und dieselbe Bedienung.
   *
   * Die Einrückung rechnet mit dem Bewertungsbalken: `--board-gutter` minus
   * dem Rand, um den das Brett nach außen tritt. So steht der Spielername in
   * beiden Umgebungen genau über der linken Brettkante.
   */
  const playerLine = (top: boolean) => {
    // Wer in dieser Zeile steht · oben spielt die Seite, die *nicht* unten
    // spielt. Uhr, geschlagene Figuren und Vorteil hängen alle daran.
    const white = top ? topIsWhite : !topIsWhite;
    return (
      <div
        className={`flex min-h-[26px] items-start justify-between gap-3 pl-[calc(var(--board-gutter)-var(--board-bleed))] text-[12.5px] ${
          top ? "mb-2" : "mt-2"
        }`}
      >
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink2">
            {(top ? topPlayer : bottomPlayer).name}
            {(top ? topPlayer : bottomPlayer).elo > 0
              ? ` (${(top ? topPlayer : bottomPlayer).elo})`
              : ""}
          </div>
          <CapturedPieces
            pieces={white ? captured.white : captured.black}
            color={white ? "black" : "white"}
            advantage={white ? captured.diff : -captured.diff}
          />
        </div>
        {hasClocks && (
          <ClockBadge
            centiseconds={white ? clockView.white : clockView.black}
            active={white === whiteToMove}
            spent={spentBy(white)}
            locale={locale}
          />
        )}
      </div>
    );
  };

  /**
   * Die Schlagliste einer Brettseite im Satz des Blattes.
   *
   * Dieselbe Rechnung wie in `playerLine` und derselbe Baustein · das Blatt
   * setzt ihn nur eckig und mit den Ziffern des Formulars. Ein zweiter Weg,
   * geschlagene Figuren zu zählen, wäre der Anfang zweier Wahrheiten.
   */
  const blattGeschlagen = (top: boolean) => {
    const white = top ? topIsWhite : !topIsWhite;
    return (
      <CapturedPieces
        blatt
        pieces={white ? captured.white : captured.black}
        color={white ? "black" : "white"}
        advantage={white ? captured.diff : -captured.diff}
      />
    );
  };

  const boardRow = (boardId: string) => (
    <div className="board-bleed flex gap-3">
      <div className="flex w-5 shrink-0 flex-col self-stretch overflow-hidden rounded-md border border-line">
        {/* Weiß und Schwarz nehmen die Feldfarben des Bretts daneben · so
            bleibt der Balken in jedem Thema hell über dunkel.

            Der Balken dreht sich mit dem Brett: Wessen Seite unten spielt,
            dessen Anteil wächst hier von unten. Andernfalls zeigte er nach dem
            Drehen in die falsche Richtung. */}
        <div
          className={`w-full ${orientation === "white" ? "bg-board-dark" : "bg-board-light"}`}
          style={{
            height: `${orientation === "white" ? 100 - whitePct : whitePct}%`,
            transition: "height 0.3s",
          }}
        />
        <div
          className={`w-full ${orientation === "white" ? "bg-board-light" : "bg-board-dark"}`}
          style={{
            height: `${orientation === "white" ? whitePct : 100 - whitePct}%`,
            transition: "height 0.3s",
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Board
          boardId={boardId}
          fen={fen}
          width={BOARD_MAX}
          orientation={orientation}
          draggable={scratch || live}
          onPieceDrop={scratch || live ? playBoardMove : undefined}
          onSquareClick={scratch || live ? onBoardSquareClick : undefined}
          lastMove={boardLastMove}
          squareStyles={selectionStyles(fen, scratchSelected)}
          arrows={variation || scratch ? liveArrows : previewArrows}
          badges={currentQuality && currentTarget ? [{
            square: currentTarget,
            label: judgmentMark(currentQuality),
            color: JUDGMENT_COLOR[currentQuality],
            title: judgmentLabel(t, currentQuality),
          }] : []}
          muted={!!variation}
          end={boardEnd}
          mouseDrag
        />
      </div>
    </div>
  );

  const variationHint = variation ? (
    <div className="ml-[calc(var(--board-gutter)-var(--board-bleed))] mt-2 flex items-center justify-between rounded-lg border border-line2 bg-panel2 px-3 py-2 text-[12px]">
      <span className="text-ink2">
        {t("an.variationAt", { n: Math.floor(variation.basePly / 2) + 1 })}:{" "}
        <strong className="text-accent">{variation.sans.join(" ")}</strong>
      </span>
      <button
        onClick={() => goToPly(variation.basePly)}
        className="ml-3 text-ink3 transition-colors hover:text-ink"
      >
        {t("an.returnToGame")}
      </button>
    </div>
  ) : null;

  /** Die Reiter der Buchkarte · nur Quellen, die es hier gibt. */
  const bookTabs: { id: BookTab; label: string; locked: boolean }[] = [
    { id: "masters", label: t("an.bookMasters"), locked: !explorerGate.unlocked },
    { id: "lichess", label: t("an.bookLichess"), locked: !explorerGate.unlocked },
    { id: "own", label: t("an.bookOwn"), locked: !refdbGate.unlocked },
    ...(chessdbOn !== false
      ? [{ id: "engine" as BookTab, label: t("an.bookEngine"), locked: false }]
      : []),
  ];
  const bookLocked =
    bookSource === "own" ? !refdbGate.unlocked && !refdbGate.pending
    : bookSource === "engine" ? false
    : !explorerGate.unlocked && !explorerGate.pending;

  /**
   * Eine Zeile je Zug: wie oft er gespielt wurde, wie es ausging, von wem.
   *
   * Der Balken ist die eigentliche Auskunft · drei Abschnitte in den Farben,
   * die die App überall für Sieg, Remis und Niederlage benutzt, aus Sicht von
   * Weiß gelesen. Die Zahl daneben sagt, auf wie vielen Partien er steht;
   * ohne sie sähe eine einzelne Partie aus wie eine Statistik.
   */
  const statsRows = (data: BookResult) => {
    const total = data.white + data.draws + data.black;
    const share = (value: number, of: number) => (of > 0 ? `${(value / of) * 100}%` : "0%");
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-ink3">
          <span className="shrink-0 tabular-nums" title={deInt(total)}>
            {t(total === 1 ? "an.bookGames.one" : "an.bookGames.many", { n: deShort(total) })}
          </span>
          {data.opening && <span className="min-w-0 truncate">{data.opening}</span>}
        </div>
        {data.moves.slice(0, 8).map((m) => {
          const games = m.white + m.draws + m.black;
          return (
            <button
              key={m.uci || m.san}
              onClick={() => playBookMove(m.san)}
              title={t("an.bookPlay", { san: m.san })}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-panel2"
            >
              <span className="w-11 shrink-0 text-[12.5px] font-medium">{m.san}</span>
              <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3">
                <span style={{ width: share(m.white, games), background: "var(--color-win)" }} />
                <span style={{ width: share(m.draws, games), background: "var(--color-draw)" }} />
                <span style={{ width: share(m.black, games), background: "var(--color-loss)" }} />
              </span>
              {/* Der Online-Bestand zählt in Milliarden · ausgeschrieben wäre
                  das eine Zahl, die über die Spalte daneben läuft. Gerundet
                  passt sie; genau steht sie im Tooltip. */}
              <span
                title={deInt(games)}
                className="w-[68px] shrink-0 truncate text-right text-[11.5px] tabular-nums text-ink2"
              >
                {deShort(games)}
              </span>
              <span className="w-9 shrink-0 truncate text-right text-[11px] tabular-nums text-ink3">
                {m.average_rating ?? "—"}
              </span>
            </button>
          );
        })}
        {/* Legende einmal, damit der Balken sich selbst erklärt. */}
        <div className="flex items-center gap-2.5 pt-0.5 text-[10.5px] text-ink3">
          {([
            ["var(--color-win)", t("common.white")],
            ["var(--color-draw)", t("common.draw")],
            ["var(--color-loss)", t("common.black")],
          ] as const).map(([color, label]) => (
            <span key={label} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        {data.top_games.length > 0 && (
          <div className="mt-1 border-t border-line pt-1.5">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink3">
              {t("an.bookTopGames")}
            </div>
            <div className="flex flex-col gap-0.5">
              {data.top_games.slice(0, 4).map((g) => {
                const line = `${g.white}${g.white_elo ? ` ${g.white_elo}` : ""} – ${g.black}${
                  g.black_elo ? ` ${g.black_elo}` : ""
                }`;
                const score = g.winner === "white" ? "1–0" : g.winner === "black" ? "0–1" : "½–½";
                const meta = `${g.year ?? ""} ${score}`.trim();
                // Die eigene Datenbank hat die Partie im Haus · sie kommt aufs
                // Brett. Bei Lichess liegt sie dort und wird dort geöffnet.
                return data.source === "own" ? (
                  <button
                    key={g.id}
                    onClick={() => openRefGame(g.id)}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left text-[11.5px] text-ink2 transition-colors hover:bg-panel2"
                  >
                    <span className="min-w-0 truncate">{line}</span>
                    <span className="shrink-0 tabular-nums text-ink3">{meta}</span>
                  </button>
                ) : (
                  <a
                    key={g.id}
                    href={`https://lichess.org/${g.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openExternal(`https://lichess.org/${g.id}`);
                    }}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[11.5px] text-ink2 transition-colors hover:bg-panel2"
                  >
                    <span className="min-w-0 truncate">{line}</span>
                    <span className="shrink-0 tabular-nums text-ink3">{meta}</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
        {data.cached && data.source !== "own" && (
          <div className="pt-1 text-[11px] text-ink3">{t("an.bookCached")}</div>
        )}
      </div>
    );
  };

  /**
   * Einen Zug aus dem Buch aufs Brett bringen.
   *
   * Das Buch nennt Züge in SAN; das Brett will Feld und Ziel. Der Umweg über
   * chess.js ist der kürzeste Weg dahin und scheitert still, wenn der Zug in
   * dieser Stellung nicht geht · dann war die Auskunft veraltet.
   */
  const playBookMove = (san: string) => {
    try {
      const chess = new Chess(fen);
      const move = chess.move(san);
      playBoardMove(move.from, move.to, move.promotion ?? "q");
    } catch {
      /* Zug passt nicht zur Stellung */
    }
  };

  /**
   * Eine Musterpartie der eigenen Referenzdatenbank aufs Brett legen.
   *
   * Sie kommt als freies Brett, nicht als eigene Partie: Fremdpartien haben in
   * der eigenen Datenbank nichts verloren (siehe src-tauri/src/refdb.rs), und
   * durchblättern lässt sich das freie Brett genauso.
   */
  const openRefGame = async (id: string) => {
    try {
      const game = await refdbGame(Number(id));
      setSelectedId(null);
      setOpened(null);
      setVariation(null);
      setScratchSans(game.moves.split(" ").filter(Boolean));
      setScratchSelected(null);
      setPly(0);
      setLiveEval(null);
      setLiveBestUci(null);
      const elo = (value: number) => (value > 0 ? ` (${value})` : "");
      setNotice(
        `${game.white}${elo(game.white_elo)} – ${game.black}${elo(game.black_elo)} · ${game.played_at} · ${game.result}`
      );
    } catch (error) {
      setNotice(String(error));
    }
  };

  const flip = () => setFlipped((value) => !value);
  const newBoard = () => {
    setOpened(null);
    setScratchSans([]);
    setPly(0);
    setScratchSelected(null);
    setLiveEval(null);
    setLiveBestUci(null);
  };

  /**
   * Die Nebengriffe zum Brett · Brett drehen, teilen, Fokus und · am freien
   * Brett · von vorn anfangen.
   *
   * Sie stehen für sich, weil zwei Leisten sie tragen: die Leiste der
   * gewöhnlichen Fassung (`boardControls`) und die Tastenreihe des Blattes
   * (`griffe` in pages/blatt/AnalysisBlatt.tsx). Im Blatt fehlten sie ganz ·
   * dort kam man an das Drehen des Bretts und an das Teilen gar nicht mehr
   * heran, und das ist kein Layout mehr, sondern eine Fassung, die weniger
   * kann.
   *
   * Die Aufteilung mobil/Desktop steckt deshalb hier und nicht in den beiden
   * Leisten. Auf dem Telefon ist für alles nebeneinander kein Platz, und dort
   * greift die Regel, nach der die App ihre Menüs baut (siehe `Menu` in
   * components/ui.tsx): Was beim Durchsehen einer Partie ständig gebraucht
   * wird · Blättern · bleibt als eigene Taste stehen; was einmal pro Partie
   * vorkommt, rückt in ein Blatt am Ende der Tastengruppe. Es klappt nach
   * oben auf, weil unter der Leiste die Navigationsleiste steht. Auf dem
   * Desktop bleibt alles nebeneinander: Dort ist die Breite da, und ein Klick
   * weniger ist besser als ein aufgeräumteres Blatt.
   *
   * Im Fokus fehlt der Griff zum Fokus · dort ist man schon.
   */
  const boardExtras = (inFocus: boolean) =>
    mobile ? (
      <Menu label={t("an.boardActions")} align="end" up compact icon={<MoreHorizontal size={15} />}>
        <MenuItem onClick={flip}>
          <FlipVertical2 size={15} /> {t("an.flip")}
        </MenuItem>
        <MenuItem onClick={openShare}>
          <Share2 size={15} /> {t("sh.title")}
        </MenuItem>
        {!inFocus && <FocusMenuItem onClick={() => setFocused(true)} />}
        {scratch && (
          <MenuItem onClick={newBoard}>
            <RotateCcw size={15} /> {t("an.newBoard")}
          </MenuItem>
        )}
      </Menu>
    ) : (
      <>
        <Button onClick={flip} title={t("an.flip")} label={t("an.flip")} compact>
          <FlipVertical2 size={15} />
        </Button>
        <Button onClick={openShare} title={t("sh.title")} label={t("sh.title")} compact>
          <Share2 size={15} />
        </Button>
        {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
        {scratch && (
          <Button onClick={newBoard} title={t("an.newBoard")}>
            <RotateCcw size={15} /> {t("an.newBoard")}
          </Button>
        )}
      </>
    );

  /**
   * Eine Leiste statt einer Reihe verstreuter Knöpfe.
   *
   * Links alles, was die gezeigte Stellung ändert: blättern und die
   * Nebengriffe von oben. Rechts die Bewertung, unverrückbar. Beide Gruppen
   * liegen in einer gemeinsamen Fläche, damit die Leiste als ein
   * Bedienelement gelesen wird und nicht als acht gleich laute Angebote.
   *
   * Die Leiste bleibt einzeilig · und auf dem Telefon auch vollständig
   * sichtbar. Dort ist für acht Tasten und die Bewertung kein Platz, und eine
   * Leiste, die man erst zur Seite schieben muss, um an das Drehen des Bretts
   * zu kommen, ist keine Leiste mehr, sondern ein Versteck.
   */
  const boardControls = (inFocus: boolean) => {
    return (
      <div className="ml-[calc(var(--board-gutter)-var(--board-bleed))] mt-3 flex items-center gap-2 rounded-xl border border-line bg-panel px-2 py-1.5">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Button onClick={() => goToPly(0)} title={t("an.toStart")} label={t("an.toStart")} compact>
            <ChevronFirst size={15} />
          </Button>
          <Button
            onClick={() => goToPly((variation?.basePly ?? ply) - 1)}
            title={t("an.prevMove")}
            label={t("an.prevMove")}
            compact
          >
            <ChevronLeft size={15} />
          </Button>
          <Button
            onClick={() => goToPly((variation?.basePly ?? ply) + 1)}
            title={t("an.nextMove")}
            label={t("an.nextMove")}
            compact
          >
            <ChevronRight size={15} />
          </Button>
          <Button onClick={() => goToPly(sans.length)} title={t("an.toEnd")} label={t("an.toEnd")} compact>
            <ChevronLast size={15} />
          </Button>
          {!mobile && (
            <>
              <span className="mx-1 h-6 w-px shrink-0 bg-line2" aria-hidden="true" />
              {boardExtras(inFocus)}
            </>
          )}
        </div>
        {mobile && (
          <>
            <span className="h-6 w-px shrink-0 bg-line2" aria-hidden="true" />
            {boardExtras(inFocus)}
          </>
        )}
        <div
          className="shrink-0 px-1.5 text-[15px] font-semibold tabular-nums"
          style={{ color: shownEval >= 0 ? "var(--color-ink)" : "var(--color-ink2)" }}
        >
          {liveEval?.mate != null ? `#${liveEval.mate}` : evalLabel(shownEval)}
        </div>
      </div>
    );
  };

  // Eine angesteuerte Partie ist erst ausgewählt, wenn die Partienliste da ist.
  // Bis dahin sähe `scratch` wie das freie Brett aus, und die Seite stünde
  // einen Augenblick in ihrer gewöhnlichen Fassung (siehe LeereSeite.tsx).
  // Ohne Ziel bleibt es beim freien Brett · das ist keine Wartezeit, sondern
  // der Zustand, und für ihn gibt es kein Blatt.
  if (diagramMode && targetGameId != null && selectedId == null) return <LeereSeite />;

  // ── Die Laufleiste ────────────────────────────────────────────────────────
  //
  // Welche Partie gezeigt wird, ob sie gerechnet werden soll, wie weit ein Lauf
  // ist: Das steht in beiden Fassungen. Der Modus ändert das Layout und darf
  // keine Bedienung kosten — die Blatt-Fassung ohne Partiewahl hätte den Tab um
  // genau das gebracht, wofür man ihn öffnet.
  //
  // Gebaut wird sie deshalb nur einmal. Im Blatt trägt sie dieselben Teile im
  // Formularsatz: `blatt-formular` nimmt Rundungen und Flächen zurück (siehe
  // blatt.css), statt die Leiste ein zweites Mal zu setzen.
  /**
   * Die drei Wege, eine Analyse zu starten · einmal geschrieben, weil die
   * Leiste sie auf dem Rechner als Knopf plus Menü und in der App als ein
   * einziges Menü aufstellt.
   */
  const starteLauf = (options: Parameters<typeof startAnalysis>[0]) => {
    setNotice(null);
    setRunning(true);
    startAnalysis(options).catch((e) => {
      setRunning(false);
      setNotice(String(e));
    });
  };
  const analysiereDiese = () => {
    if (selectedId == null) return;
    starteLauf({ gameIds: [selectedId] });
  };
  /**
   * Der Stapel ist die automatische Hintergrundanalyse und damit eine
   * Plus-Funktion · sichtbar bleibt sie trotzdem, gesperrt führt sie in die
   * Erklärung. Eine einzelne Partie zu rechnen bleibt frei.
   */
  const starteStapel = (options: Parameters<typeof startAnalysis>[0]) => {
    if (!batchGate.unlocked) {
      openPlusDialog("background_analysis");
      return;
    }
    starteLauf(options);
  };
  const stapelBadge = !batchGate.unlocked && !batchGate.pending ? <PlusBadge /> : null;

  /** „Diese Partie analysieren" · der erste Weg im Menü. */
  const dieseAnalysieren = selectedId != null && (
    <MenuItem onClick={analysiereDiese}>
      <Zap size={15} /> {analyzedRows ? t("an.reanalyze") : t("an.analyzeThis")}
    </MenuItem>
  );

  /**
   * Der Stapel · alles, was noch offen ist.
   *
   * Eine Zehnerportion stand hier einmal daneben. Sie war die vorsichtige
   * Antwort auf einen Lauf, den man nicht überblickt — aber der Lauf lässt
   * sich jederzeit anhalten, und damit war sie nur ein zweiter Eintrag für
   * dieselbe Sache, zwischen dem man sich entscheiden musste.
   */
  const stapelEintrag = unanalyzed.length > 0 && (
    <MenuItem onClick={() => starteStapel({})}>
      <Layers size={15} /> {t("an.analyzeAll", { n: unanalyzed.length })}
      {stapelBadge}
    </MenuItem>
  );

  const laufleiste = desktop ? (
    <div
      className={
        diagramMode
          ? "blatt-formular flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-2.5"
          : "mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-line bg-panel px-3 py-2.5"
      }
      data-tour="analysis-run"
    >
      {/* Links steht, welche Partie gezeigt wird · Auswahlliste und die
          beiden Pfeile, die in ihr weiterblättern, gehören zusammen und
          stehen deshalb in einer Gruppe.

          Auf Telefonbreite nimmt die Gruppe eine eigene Zeile (`basis-full`).
          `flex-1` allein hätte das nicht getan: Ein Element mit
          `flex-basis: 0` bricht nie um, es schrumpft · und die Auswahlliste
          war unter der laufenden Analyse auf ihren blossen Pfeil
          zusammengedrückt, mit den beiden Blätterknöpfen quer über dem
          Fortschrittstext. */}
      <div className="flex w-full min-w-0 basis-full items-center gap-1.5 sm:w-auto sm:flex-1 sm:basis-0">
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 max-w-[380px] flex-1 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
        >
          <option value="">{t("an.freeBoard")}</option>
          {games.map((g) => (
            <option key={g.id} value={g.id ?? undefined}>
              {g.analyzed ? "✓" : "○"} {g.played_at} · {g.opponent} ·{" "}
              {g.result === "win" ? t("common.win") : g.result === "loss" ? t("common.loss") : t("common.draw")}
            </option>
          ))}
        </select>
        <Button
          onClick={() => stepGame(-1)}
          disabled={!canStepGame(-1)}
          title={t("an.prevGame")}
          label={t("an.prevGame")}
          className="shrink-0"
          compact
        >
          <ChevronUp size={15} />
        </Button>
        <Button
          onClick={() => stepGame(1)}
          disabled={!canStepGame(1)}
          title={t("an.nextGame")}
          label={t("an.nextGame")}
          className="shrink-0"
          compact
        >
          <ChevronDown size={15} />
        </Button>
      </div>

      {running && diagramMode ? (
        /* Auf dem Bogen ist der Stand eines Laufs ein Zettel und keine Pille ·
           siehe components/blatt/Laufzettel.tsx. Er nimmt die ganze Breite
           unter der Partiewahl, weil er zwei Zeilen führt statt einer. */
        <Laufzettel
          stand={
            progress
              ? {
                  partie: progress.game_index,
                  partienGesamt: progress.games_total,
                  opponent: progress.opponent,
                  halbzug: progress.ply,
                  halbzuege: progress.plies,
                }
              : null
          }
          onStopp={() => cancelAnalysis()}
        />
      ) : running ? (
        <>
          {/* Der Stand des Laufs · auf Telefonbreite eine eigene Zeile,
              in der Text und Balken übereinander stehen. Nebeneinander
              blieb für den Balken nichts übrig: Der Text brach auf zwei
              Zeilen um, der Balken schrumpfte auf null, und zu sehen war
              nur ein zerrissener Satz ohne jeden Fortschritt. */}
          <div className="flex w-full min-w-0 basis-full items-start gap-2 text-[12px] text-ink2 sm:w-auto sm:min-w-[220px] sm:flex-1 sm:basis-0 sm:items-center">
            {/* Der Kreisel steht an der ersten Textzeile, nicht in der
                Mitte eines mehrzeiligen Blocks. */}
            <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-accent sm:mt-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              <span className="min-w-0 leading-snug">
                {progress
                  ? t("an.progress", {
                      i: progress.game_index,
                      n: progress.games_total,
                      opp: progress.opponent,
                      a: Math.ceil(progress.ply / 2),
                      b: Math.ceil(progress.plies / 2),
                    })
                  : t("an.running")}
              </span>
              {progress && (
                <div className="h-1.5 w-full min-w-[72px] shrink-0 overflow-hidden rounded-full bg-panel3 sm:w-auto sm:flex-1 sm:shrink">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${(progress.ply / progress.plies) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          <Button className="ml-auto shrink-0" onClick={() => cancelAnalysis()}>
            <Square size={13} /> {t("an.stop")}
          </Button>
        </>
      ) : (
        /* Ein Knopf, zwei Wege · die Partie, die gerade offen ist, und der
           Stapel über alles, was noch aussteht.

           Beides als eigener Knopf nebeneinander hatte die Leiste um ihren
           Hauptknopf gebracht: zwei gleich laute Angebote, zwischen denen man
           sich erst entscheiden musste, bevor man rechnen ließ. Auf 360 px kam
           dazu, dass „Diese Partie analysieren" und „Mehrere Partien" nicht in
           eine Zeile passten. Auf dem Rechner steht jetzt dasselbe wie in der
           App: „Analysieren" mit einem Blatt darunter.

           In der App nimmt der Knopf die ganze Zeile · rechts angeklebt ließ
           er die halbe Leiste leer stehen. */
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap sm:shrink-0">
          {(selectedId != null || unanalyzed.length > 0) && (
            <Menu
              label={t("an.analyze")}
              primary
              block={mobile}
              leading={<Zap size={14} />}
              className="max-sm:px-2.5"
            >
              {dieseAnalysieren}
              {/* Eine Partie analysieren bleibt frei. Der Lauf über die ganze
                  Historie ist die automatische Hintergrundanalyse und damit
                  eine Plus-Funktion · sichtbar bleibt sie trotzdem. */}
              {stapelEintrag}
            </Menu>
          )}
        </div>
      )}
    </div>
  ) : null;

  /** Meldung eines Laufs · dieselbe Auskunft, im Blatt ohne Kasten. */
  const meldung = notice ? (
    <div
      className={
        diagramMode
          ? "border-b border-accent-dim pb-2 pt-2.5 text-[12.5px] text-accent"
          : "mb-4 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent"
      }
    >
      {notice}
    </div>
  ) : null;

  // ── Die kommentierte Partie ───────────────────────────────────────────────
  //
  // Dieselben Züge, dieselben Urteile, dasselbe Brett — anders gesetzt. Der
  // Kommentar kommt aus derselben `commentFor`-Regel, die die Seite unten
  // für den laufenden Zug benutzt; hier stehen sie alle.
  //
  // Auch das freie Brett gehört hierher. Der Modus ist eine Hülle über der
  // ganzen App: Wer über das Register auf „Analyse" geht, hat noch keine
  // Partie gewählt — stünde dort die gewöhnliche Fassung, wäre der Tab der
  // eine, der aus dem Buch herausfällt. Ohne Partie gibt es keine
  // Anmerkungen und keine Bilanz; was das freie Brett zu sagen hat, sagen
  // die Linien der Engine, und die stehen dann in der rechten Spalte.
  if (diagramMode) {
    return (
      <Suspense fallback={<LeereSeite />}>
        <AnalysisBlatt
          mobile={mobile}
          frei={scratch}
          laufleiste={laufleiste}
          meldung={meldung}
          motor={
            scratch ? (
              <LiveEngine
                blatt
                fen={fen}
                demoLines={[]}
                onEval={(cp, mate) => setLiveEval({ cp, mate })}
                onBestMove={setLiveBestUci}
                onMove={(uci) => playBoardMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] ?? "q")}
              />
            ) : null
          }
          vorlauf={opened?.history ?? null}
          kopfRechts={
            <>
              {live && game.id != null
                ? t("blatt.entryNo", { n: deInt(game.id) })
                : live || scratch || loadingGame
                  ? t("nav.analysis")
                  : featuredGame.engine}
            </>
          }
          felder={[
            {
              label: t("common.white"),
              wert: (
                <>
                  {whitePlayer.name}{" "}
                  {whitePlayer.elo > 0 && (
                    <span className="blatt-zahl text-ink3">{whitePlayer.elo}</span>
                  )}
                </>
              ),
              gross: true,
            },
            {
              label: t("common.black"),
              wert: (
                <>
                  {blackPlayer.name}{" "}
                  {blackPlayer.elo > 0 && (
                    <span className="blatt-zahl text-ink3">{blackPlayer.elo}</span>
                  )}
                </>
              ),
              gross: true,
            },
            {
              label: t("blatt.gameField"),
              wert: live
                ? gameMeta.slice(0, 1).concat(game.played_at).join(" · ")
                : scratch || loadingGame
                  ? "—"
                  : featuredGame.event,
            },
            {
              label: t("games.colOpening"),
              // Ohne Partie steht hier nichts · erfunden wird keine.
              wert:
                live || (!scratch && !loadingGame) ? (
                  <>
                    <span className="blatt-zahl text-ink3">
                      {(live ? game.eco : demoGames[0]?.eco) ?? ""}{" "}
                    </span>
                    {(live ? game.opening : demoGames[0]?.opening) ?? ""}
                  </>
                ) : (
                  "—"
                ),
            },
          ]}
          ergebnis={
            live
              ? game.result === "draw"
                ? "½ : ½"
                : (game.result === "win") === (game.color === "white")
                  ? "1 : 0"
                  : "0 : 1"
              : "—"
          }
          oben={{
            name: topPlayer.name,
            elo: topPlayer.elo,
            farbe: topIsWhite ? "white" : "black",
            geschlagen: blattGeschlagen(true),
          }}
          unten={{
            name: bottomPlayer.name,
            elo: bottomPlayer.elo,
            farbe: topIsWhite ? "black" : "white",
            geschlagen: blattGeschlagen(false),
          }}
          brett={boardRow("blatt")}
          griffe={boardExtras(false)}
          zuege={viewMoves.map((move, index) => ({
            san: move.san,
            nag: move.judgment && MARKED_IN_LIST.includes(move.judgment) ? NAG[move.judgment] : undefined,
            farbe: move.judgment ? JUDGMENT_COLOR[move.judgment] : undefined,
            kommentar: blattKommentar(index),
          }))}
          ply={ply}
          onPly={goToPly}
          kurve={evalSeries.map((point) => point.eval)}
          bewertung={shownEval / 100}
          bilanz={(["brilliant", "great", "excellent", "inaccuracy", "mistake", "blunder"] as const)
            .filter((key) => summary[key] > 0)
            .map((key) => ({
              name: judgmentLabel(t, key),
              zahl: summary[key],
              farbe: JUDGMENT_COLOR[key],
            }))}
          acpl={summary.acpl}
          genauigkeit={live ? (game.accuracy ?? derivedAccuracies?.mine.overall ?? null) : null}
        />
        {/* Fokus und Teilen gehören zum Brett und nicht zum Layout · beide
            Fassungen setzen dieselbe Stellung, und wer sie im Blatt groß sehen
            oder weitergeben will, hat denselben Grund wie in der gewöhnlichen
            Fassung. Der Fokus zeigt das Brett dabei so, wie es hier steht:
            gedreht wie die Seite, in den Farben, die im Modus gelten. */}
        <FocusBoard
          open={focused}
          onClose={() => setFocused(false)}
          title={t("an.title")}
          subtitle={headerSub}
          frameWidth="var(--board-col)"
          above={playerLine(true)}
          below={
            <>
              {playerLine(false)}
              {variationHint}
              {boardControls(true)}
            </>
          }
        >
          {boardRow("analysis-blatt-focus")}
        </FocusBoard>
        {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      {/* Kopf der Seite.
          Auf dem Desktop steht der Seitentitel links, die Partie als eine
          Zeile darunter, Herkunftslink und Ergebnis rechts an der Kante.

          Mobil verschwindet der Seitentitel (die App-Bar zeigt ihn schon),
          und die Partiezeile ist für die Breite eines Telefons zu lang: sie
          brach auf drei Zeilen um, während Link und Ergebnis an deren
          Unterkante klebten. Deshalb ist die geladene Partie dort eine eigene
          kleine Karte · oben das Ergebnis und die Paarung, darunter Modus,
          Eröffnung, Datum und der Weg zum Original. */}
      {mobile && live ? (
        <header className="mb-3 rounded-xl border border-line bg-panel px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ResultBadge result={game.result} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
              {gamePlayers}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] leading-snug text-ink3">
            {gameMeta.map((part, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                {part}
              </span>
            ))}
            {/* Trennzeichen und Link stehen im selben Kasten · sonst bliebe
                das Zeichen beim Umbruch allein am Zeilenende zurück. */}
            {originUrl && (
              <span className="flex items-center gap-1.5">
                {gameMeta.length > 0 && <span aria-hidden="true">·</span>}
                <ExtLink
                  href={originUrl}
                  label={t("an.original")}
                  title={t("an.originalTitle", { p: game.source })}
                />
              </span>
            )}
          </div>
        </header>
      ) : (
        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("an.title")}</h1>
            <p className="mt-0.5 text-[13px] text-ink3">{headerSub}</p>
          </div>
          {live && (
            <div className="flex shrink-0 items-center gap-3">
              {originUrl && (
                <ExtLink
                  href={originUrl}
                  label={t("an.original")}
                  title={t("an.originalTitle", { p: game.source })}
                />
              )}
              <ResultBadge result={game.result} />
            </div>
          )}
        </header>
      )}

      {laufleiste}

      {meldung}

      <div className="grid min-w-0 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,var(--board-col))_minmax(320px,1fr)] min-[1660px]:grid-cols-[minmax(0,var(--board-col))_minmax(360px,1fr)_340px]">
        {/* Brett + Eval-Bar. Die Spalte ist so breit wie Brett plus Balken ·
            das ist `--board-col`. */}
        <div className="min-w-0 max-w-[var(--board-col)]">
          {playerLine(true)}
          {boardRow("analysis")}
          {playerLine(false)}
          {variationHint}
          {boardControls(false)}
        </div>

        {/* Zugliste + Eval-Graph.

            Wie hoch diese Spalte ist, sagt das Brett links · nicht die Länge
            der Partie. Deshalb steht der Stapel ab zwei Spalten ausgehängt
            (`absolute`) in seinem Rahmen: Er trägt dann nichts zur Zeilenhöhe
            bei, sondern nimmt sie an. Stapelte er mit, wüchse die Gitterzeile
            mit jeder langen Partie, und neben dem Brett stünde ein Meter
            Notation. Einspaltig fällt er in den normalen Fluss zurück. */}
        <div className="relative min-w-0">
        <div className="flex min-w-0 flex-col gap-4 min-[1100px]:absolute min-[1100px]:inset-0">
          {/* Die Karte füllt die Spalte, und die Zugliste füllt die Karte.
              Vorher deckelte die Liste sich selbst auf 290 px · daneben stand
              dann eine halbe Kartenhöhe leer, während die Züge in einem
              handbreiten Fenster scrollten. Wie hoch die Spalte ist, sagt das
              Brett links; die Höhe wird hier nur durchgereicht. */}
          <Card
            title={scratch ? t("an.freeBoard") : t("an.game")}
            pad={false}
            className="flex min-h-0 flex-1 flex-col"
            bodyClass="flex min-h-0 flex-1 flex-col"
          >
            {/* Die Züge aus dem Link · sie stehen vor der eigenen Zugliste,
                weil die Stellung genau dort herkommt. Nicht anklickbar: Die
                Stellungen davor reisen nicht mit, nur ihre Notation. */}
            {opened?.history && (
              <p className="notation border-b border-line px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink3">
                {opened.history}
              </p>
            )}
            {/* Einspaltig gibt es keine Spaltenhöhe, an der die Liste sich
                ausrichten könnte · dort bleibt der alte Deckel, sonst schiebt
                eine lange Partie alles Weitere um Bildschirmlängen nach unten. */}
            <div className="max-h-[290px] flex-1 overflow-y-auto p-3 min-[1100px]:max-h-none">
              <div className="flex flex-wrap gap-x-1 gap-y-1.5 text-[13.5px] leading-relaxed">
                {viewMoves.map((m, i) => (
                  <span key={i} className="inline-flex items-center">
                    {(moveOffset + i) % 2 === 0 && (
                      <span className="mr-1 text-[12px] text-ink3">
                        {(moveOffset + i) / 2 + 1}.
                      </span>
                    )}
                    <button
                      onClick={() => goToPly(i + 1)}
                      title={m.judgment ? judgmentLabel(t, m.judgment) : undefined}
                      className={`rounded px-1 py-0.5 font-medium transition-colors ${
                        !variation && ply === i + 1 ? "bg-accent-soft text-accent" : "hover:bg-panel2"
                      }`}
                    >
                      {m.san}
                      {m.nag && m.judgment && MARKED_IN_LIST.includes(m.judgment) && (
                        <span className="ml-0.5" style={{ color: JUDGMENT_COLOR[m.judgment] }}>{m.nag}</span>
                      )}
                    </button>
                  </span>
                ))}
              </div>
              {live && !analyzedRows && (
                <div className="mt-3 rounded-lg border border-dashed border-line2 px-3 py-2 text-[12px] text-ink3">
                  {t("an.notAnalyzed")}
                </div>
              )}
              {currentComment && (
                <div className="mt-3 rounded-lg border-l-2 bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink2"
                  style={{ borderColor: currentMove?.judgment ? JUDGMENT_COLOR[currentMove.judgment] : "var(--color-accent)" }}>
                  <span className="font-medium" style={{ color: currentMove?.judgment ? JUDGMENT_COLOR[currentMove.judgment] : "var(--color-accent)" }}>
                    {Math.ceil(ply / 2)}.{ply % 2 === 0 ? ".." : ""} {currentMove?.san}{currentMove?.nag}
                  </span>{" "}
                  {currentComment}
                </div>
              )}
            </div>
          </Card>

          <Card title={t("an.evalChart")} pad={false}>
            <div className="px-2 pb-1 pt-2">
              {evalSeries.length >= 2 ? (
                <ResponsiveContainer width="100%" height={110}>
                  <AreaChart
                    {...chartSurface}
                    data={evalSeries}
                    margin={{ top: 4, right: 6, bottom: 0, left: 6 }}
                    onClick={(e) => e?.activeLabel != null && goToPly(Number(e.activeLabel))}
                  >
                    <XAxis dataKey="ply" hide />
                    <YAxis domain={[-6, 6]} hide />
                    <ReferenceLine y={0} stroke="var(--color-line2)" />
                    {/* Phasengrenzen: dünne Linie mit stehendem Namen. */}
                    {phaseMarkers.map((marker) => (
                      <ReferenceLine
                        key={marker.phase}
                        x={marker.ply}
                        stroke="var(--color-line2)"
                        strokeDasharray="2 3"
                        label={{
                          value: t(`ins.phase.${marker.phase}` as Key),
                          position: { x: 8, y: 6 },
                          angle: -90,
                          fill: "var(--color-ink3)",
                          fontSize: 9.5,
                        }}
                      />
                    ))}
                    {/* Aktueller Zug. */}
                    {currentPly > 0 && currentPly <= evalSeries.length && (
                      <ReferenceLine x={currentPly} stroke="var(--color-accent)" strokeWidth={1.5} />
                    )}
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="rounded-md border border-line2 bg-panel3 px-2 py-1 text-[12px]">
                            {t("an.moveTooltip", {
                              n: Math.ceil(Number(payload[0].payload.ply) / 2),
                              e: evalLabel(Number(payload[0].value) * 100),
                            })}
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="eval" stroke="var(--color-accent)" strokeWidth={2}
                      fill="var(--color-accent)" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[110px] items-center justify-center text-[12px] text-ink3">
                  {t("an.noEvalData")}
                </div>
              )}
            </div>
          </Card>
        </div>
        </div>

        {/* Engine-Panel + Annotationen + Positionssuche */}
        <div className="flex min-w-0 flex-col gap-4 min-[1100px]:contents">
          <LiveEngine
            fen={fen}
            demoLines={scratch || loadingGame ? [] : featuredGame.pvLines}
            onEval={(cp, mate) => setLiveEval({ cp, mate })}
            onBestMove={setLiveBestUci}
            onMove={(uci) => playBoardMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] ?? "q")}
          />

          <Card title={live ? t("an.myMoves") : t("an.autoAnnotation")}>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              {(["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"] as MoveJudgment[]).map((quality) => (
                <li key={quality} className="flex min-w-0 justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 truncate" style={{ color: JUDGMENT_COLOR[quality] }}>
                    {judgmentMark(quality, 13)} <span className="truncate">{judgmentLabel(t, quality)}</span>
                  </span>
                  <span className="font-medium">{summary[quality]}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
              {t("an.acpl")}{" "}
              <span className="text-ink2">{t("common.white")} {desktop ? summary.acpl.white : featuredGame.summary.acplWhite}</span> ·{" "}
              <span className="text-ink2">{t("common.black")} {desktop ? summary.acpl.black : featuredGame.summary.acplBlack}</span>
            </div>
          </Card>

          {live && (
            <Card title={t("an.phaseAccuracy")}>
              <div className="grid grid-cols-2 gap-2">
                {accuracyCells.map(({ key, label, mine, opponent }) => (
                  <div key={key} role="group" aria-label={label} className="min-w-0 rounded-lg bg-panel2 px-2 py-2">
                    <div className="mb-1.5 text-center text-[10.5px] font-medium text-ink3">{label}</div>
                    <div className="space-y-1 text-[11.5px]">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-ink3" title={ownPlayerName}>{ownPlayerName}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink2">
                          {mine == null ? "—" : `${de(mine)} %`}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-ink3" title={game.opponent}>{game.opponent}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink2">
                          {opponent == null ? "—" : `${de(opponent)} %`}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {accuracyCells.slice(1).every(({ mine, opponent }) => mine == null && opponent == null) && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("an.phaseAccuracyMissing")}</p>
              )}
            </Card>
          )}

          {live && (
            <Card title={t("an.notesAndTags")}>
              <TagEditor key={game.id} tags={game.tags ?? []} onChange={saveTags} />
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("games.notesPlaceholder")}
                rows={4}
                className="mt-3 w-full resize-y rounded-lg border border-line bg-panel2 p-2.5 text-[12.5px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <Button primary onClick={saveNote} disabled={noteDraft === (game.note ?? "")}>
                  <Save size={14} /> {noteSaved ? t("games.noteSaved") : t("games.saveNote")}
                </Button>
              </div>
              {notesError && (
                <div className="mt-2 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12px] text-loss">
                  {notesError}
                </div>
              )}
            </Card>
          )}

          {desktop && bookTabs.length > 0 && (
            <Card title={t("an.book")}>
              {/* Vier Quellen, vier Fragen · siehe BookTab oben. Die Reiter
                  stehen auch dann da, wenn eine Quelle gesperrt ist: Was es
                  gibt, soll man sehen können, bevor man es kauft. */}
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {bookTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setBookSource(tab.id)}
                    aria-pressed={bookSource === tab.id}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                      bookSource === tab.id
                        ? "border-accent-dim bg-accent-soft text-accent"
                        : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
                    }`}
                  >
                    {tab.label}
                    {tab.locked && <Sparkles size={11} className="text-accent" aria-hidden="true" />}
                  </button>
                ))}
              </div>
              {bookSource === "engine" ? (
                bookState === "loading" && !book ? (
                  <div className="text-[12px] text-ink3">{t("an.bookLoading")}</div>
                ) : bookState === "error" ? (
                  <div className="text-[12px] text-ink3">{t("an.bookError")}</div>
                ) : book && book.status === "ok" && book.moves.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {book.moves.slice(0, 5).map((m) => (
                      <button
                        key={m.uci}
                        onClick={() => playBookMove(m.san || m.uci)}
                        className="flex items-center justify-between rounded-md px-1 py-0.5 text-left text-[12.5px] transition-colors hover:bg-panel2"
                      >
                        <span className="w-14 font-medium">{m.san || m.uci}</span>
                        <span className="tabular-nums text-ink2">
                          {m.score != null
                            ? `${m.score >= 0 ? "+" : "−"}${de(Math.abs(m.score) / 100, 2)}`
                            : "—"}
                        </span>
                        <span className="w-16 text-right text-[11.5px] text-ink3">
                          {m.winrate != null ? `${m.winrate} %` : ""}
                        </span>
                      </button>
                    ))}
                    {book.cached && (
                      <div className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink3">
                        {t("an.bookCached")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-ink3">{t("an.bookUnknown")}</div>
                )
              ) : bookLocked ? (
                /* Gesperrt wird nichts abgefragt · die Vorschau zeigt die Form,
                   die Sperre legt die Unschärfe darüber. */
                <PlusLock feature={bookSource === "own" ? "reference_database" : "opening_explorer"}>
                  {statsRows(BOOK_PREVIEW)}
                </PlusLock>
              ) : bookSource === "own" && refGames === 0 ? (
                <div className="text-[12px] leading-relaxed text-ink3">{t("an.refdbEmpty")}</div>
              ) : bookSource !== "own" && !explorerOn ? (
                <div className="text-[12px] leading-relaxed text-ink3">{t("an.explorerOff")}</div>
              ) : statsState === "loading" && !stats ? (
                <div className="text-[12px] text-ink3">{t("an.bookLoading")}</div>
              ) : statsState === "error" ? (
                <div className="text-[12px] leading-relaxed text-ink3">
                  {statsError ?? t("an.bookError")}
                </div>
              ) : stats && stats.status === "ok" && stats.moves.length > 0 ? (
                statsRows(stats)
              ) : (
                <div className="text-[12px] text-ink3">{t("an.bookUnknown")}</div>
              )}
            </Card>
          )}

          {desktop && (
            <Card title={t("an.posInGames")}>
              {posSearch && posSearch.total_games > 0 ? (
                <>
                  <div className="text-[12.5px] text-ink2">
                    <Search size={13} className="mr-1.5 inline text-accent" />
                    {t(posSearch.total_games === 1 ? "an.reachedIn.one" : "an.reachedIn.many", {
                      n: posSearch.total_games,
                    })}
                  </div>
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {/* Ein Zug hier ist derselbe Zug wie im Buch oder in der
                        Engine-Linie · ein Klick legt ihn aufs Brett. */}
                    {posSearch.next_moves.slice(0, 4).map((m) => (
                      <button
                        key={m.san}
                        onClick={() => playBookMove(m.san)}
                        title={t("an.bookPlay", { san: m.san })}
                        className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12.5px] transition-colors hover:bg-panel2"
                      >
                        <span className="w-14 shrink-0 font-medium">{m.san}</span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${m.score_pct}%`,
                              background: m.score_pct >= 50 ? "var(--color-win)" : "var(--color-loss)",
                            }}
                          />
                        </div>
                        <span className="w-20 shrink-0 text-right tabular-nums text-ink3">
                          {m.games}× · {Math.round(m.score_pct)} %
                        </span>
                      </button>
                    ))}
                  </div>
                  {posSearch.sample.filter((h) => h.game_id !== selectedId).length > 0 && (
                    <div className="mt-3 border-t border-line pt-2.5">
                      {posSearch.sample
                        .filter((h) => h.game_id !== selectedId)
                        .slice(0, 4)
                        .map((h) => (
                          <button
                            key={`${h.game_id}-${h.ply}`}
                            onClick={() => {
                              setSelectedId(h.game_id);
                              setTimeout(() => setPly(h.ply), 0);
                            }}
                            className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[12px] text-ink2 transition-colors hover:bg-panel2"
                          >
                            <span className="truncate">{h.played_at} · {h.opponent}</span>
                            <span
                              className="ml-2 shrink-0"
                              style={{
                                color:
                                  h.result === "win"
                                    ? "var(--color-win)"
                                    : h.result === "loss"
                                      ? "var(--color-loss)"
                                      : "var(--color-draw)",
                              }}
                            >
                              {h.result === "win" ? "1–0" : h.result === "loss" ? "0–1" : "½"}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[12px] leading-relaxed text-ink3">
                  {t("an.posNotFound")}
                </div>
              )}
            </Card>
          )}

          {!desktop && (
            <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
              <Cpu size={13} className="mr-1.5 inline" />
              {t("an.demoNote")}
            </div>
          )}
        </div>
      </div>

      <FocusBoard
        open={focused}
        onClose={() => setFocused(false)}
        title={t("an.title")}
        subtitle={headerSub}
        frameWidth="var(--board-col)"
        above={playerLine(true)}
        below={
          <>
            {playerLine(false)}
            {variationHint}
            {boardControls(true)}
          </>
        }
      >
        {boardRow("analysis-focus")}
      </FocusBoard>

      {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}
