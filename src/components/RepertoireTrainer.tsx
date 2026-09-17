import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  Lightbulb,
  Shuffle,
} from "lucide-react";
import {
  repDue,
  repFreeItems,
  repReview,
  repSetNote,
  type DueItem,
  type RepNode,
} from "../lib/repertoire";
import { errorMessage } from "../lib/errors";
import Board from "./Board";
import { BOARD_MAX } from "../lib/boardLayout";
import CapturedPieces from "./CapturedPieces";
import { capturedFromFen } from "../lib/captured";
import { useBoardSelection } from "../lib/boardMoves";
import { Button, Card } from "./ui";
import FocusBoard, { FocusButton } from "./FocusBoard";
import RepertoireNote from "./RepertoireNote";
import { useT } from "../lib/i18n";
import { fenAfter, replaySans } from "../lib/position";
import { useBackendInfo } from "../lib/backend";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
import { useDiagramMode } from "../lib/diagramMode";
import { useMobileShell } from "./MobileShell";
import { Notizfeld } from "./blatt/Notizfeld";

/** Der Übungsbogen kommt nach · siehe pages/blatt/TrainerBlatt.tsx. */
import { LeereSeite } from "./blatt/LeereSeite";
const TrainerBlatt = lazy(() => import("../pages/blatt/TrainerBlatt"));

/** Wie lange die gelöste Stellung stehen bleibt, bevor die nächste Karte kommt. */
const ADVANCE_MS = 1000;
/** Pause, bevor der Gegner antwortet · ohne sie wirkt es wie ein Sprung. */
const REPLY_MS = 550;
/** Höchstzahl eigener Züge je Karte, damit eine Linie nicht endlos läuft. */
const MAX_CHAIN = 6;
/** Antwortzeiten, aus denen die FSRS-Note abgeleitet wird. */
const EASY_MS = 3_000;
const HARD_MS = 10_000;

const EMPTY_SANS: string[] = [];

/** Schach- und Mattzeichen zählen für den Vergleich nicht. */
const bareSan = (san: string) => san.replace(/[+#]/g, "");

/**
 * Note aus der Antwortzeit. Wer sofort zieht, kann die Stellung · wer lange
 * überlegt, hat sie gerade noch zusammenbekommen. Genau diesen Unterschied
 * verarbeitet FSRS, und ohne ihn liefen alle Karten im selben Takt.
 */
function gradeForAnswer(elapsedMs: number): 1 | 2 | 3 | 4 {
  if (elapsedMs <= EASY_MS) return 4;
  if (elapsedMs <= HARD_MS) return 3;
  return 2;
}

/**
 * Umwandlungsfigur aus den erwarteten Antworten · sonst wäre jede Linie, die
 * nicht in eine Dame umwandelt, unbeantwortbar.
 */
function promotionFor(answers: { san: string }[]): "q" | "r" | "b" | "n" {
  for (const answer of answers) {
    const match = /=([QRBN])/.exec(answer.san);
    if (match) return match[1].toLowerCase() as "q" | "r" | "b" | "n";
  }
  return "q";
}

interface Answer {
  id: number;
  san: string;
}

/**
 * Repertoire-Training.
 *
 * Eine Karte ist keine Einzelstellung, sondern der Anfang einer Linie: nach der
 * richtigen Antwort zieht der Gegner selbst · bei mehreren Buchantworten
 * gewürfelt · und die Linie läuft weiter, solange das Buch sie kennt. Dadurch
 * trainiert man die Variante und nicht eine Sammlung zusammenhangloser Züge.
 *
 * Bewertet wird jeder eigene Zug einzeln (FSRS), die Note kommt aus der
 * Antwortzeit. Ein Fehler hängt die Karte ans Ende der Sitzung, statt sie erst
 * am nächsten Tag wiederzubringen.
 *
 * Zwei Betriebsarten teilen sich diesen Trainer:
 *
 *  · Der Plan (`free` aus). Der Stapel kommt von FSRS, jede Antwort schreibt
 *    einen Lernstand, und wenn nichts fällig ist, gibt es nichts zu tun.
 *  · Das freie Üben (`free` an). Der Stapel kommt aus dem Buch selbst, in
 *    gewürfelter Reihenfolge, und **keine** Antwort rührt den Lernstand an.
 *    Das ist der Punkt daran: Wer zwischendurch übt, soll seinen Plan nicht
 *    verschieben. Ein richtiger Zug in einer Stellung, die morgen ohnehin
 *    drankäme, würde sie sonst um Wochen wegschieben · und ein falscher würde
 *    eine sitzende Variante zurückwerfen, nur weil jemand freiwillig geübt
 *    hat. Gezählt wird die Sitzung trotzdem; sie steht nur nirgends nach.
 */
export default function RepertoireTrainer({
  nodes,
  dueLimit,
  newLimit,
  free = false,
  onExit,
  onFreeTraining,
}: {
  nodes: RepNode[];
  dueLimit?: number;
  newLimit?: number;
  /** Freies Üben statt Plan · siehe Kopf dieser Datei. */
  free?: boolean;
  onExit: () => void;
  /** Angeboten, wenn der Plan nichts hergibt · fehlt beim freien Üben selbst. */
  onFreeTraining?: () => void;
}) {
  const backend = useBackendInfo();
  const t = useT();
  const diagramMode = useDiagramMode();
  const mobile = useMobileShell();
  const [items, setItems] = useState<DueItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<"ask" | "correct" | "wrong">("ask");
  const [shake, setShake] = useState(false);
  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);
  const [doneCount, setDoneCount] = useState({ ok: 0, fail: 0 });
  const [viewPly, setViewPly] = useState(0);
  /** Züge nach der Ausgangsstellung · eigene Antworten und Gegnerzüge. */
  const [played, setPlayed] = useState<string[]>([]);
  /** Buchzüge, die an der aktuellen Stelle zählen. */
  const [answers, setAnswers] = useState<Answer[]>([]);
  /**
   * Der Knoten, an dem die Notiz hängt · die Stelle, nach der gerade gefragt
   * wird, und nach der Antwort der Zug, der tatsächlich gezogen wurde.
   */
  const [noteId, setNoteId] = useState<number | null>(null);
  /** Aufgedeckt, obwohl die Frage noch offen ist · siehe `noteCovered`. */
  const [noteOpen, setNoteOpen] = useState(false);
  /**
   * Was seit dem Start dieser Sitzung geschrieben wurde. Der Baum kommt als
   * Eigenschaft herein und wird hier nicht neu geladen · ohne diese Ablage
   * stünde nach dem Speichern wieder der alte Satz im Feld.
   */
  const [noteEdits, setNoteEdits] = useState<Record<number, string>>({});
  const [noteError, setNoteError] = useState<string | null>(null);

  const failedRef = useRef(false);
  const askedAtRef = useRef(0);
  const chainRef = useRef(0);
  const answeredRef = useRef<Set<number>>(new Set());
  const requeuedRef = useRef<Set<number>>(new Set());
  const itemsRef = useRef<DueItem[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reviewMomentSentRef = useRef(false);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  // Der Stapel wird genau einmal gezogen · träfen später geladene Grenzen oder
  // ein nachgeladenes Buch ein, würde die laufende Sitzung mitten im Zählen
  // neu beginnen.
  const startRef = useRef({ dueLimit, newLimit, free, nodes });
  useEffect(() => {
    const start = startRef.current;
    if (start.free) {
      setItems(repFreeItems(start.nodes));
      return;
    }
    repDue(start.dueLimit, start.newLimit)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  /**
   * Den Lernstand einer Karte fortschreiben · beim freien Üben bleibt er, wie
   * er war. Alles andere an der Sitzung läuft in beiden Fällen gleich.
   */
  const record = useCallback(
    (nodeId: number, grade: 1 | 2 | 3 | 4) => {
      if (free) return;
      repReview(nodeId, grade).catch(() => {});
    },
    [free]
  );

  // Ein laufender Vorlauf darf nicht in eine beendete Sitzung hineinfeuern.
  useEffect(() => clearTimers, [clearTimers]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useCallback(
    (parentId: number, side: "white" | "black") =>
      nodes.filter((n) => n.parent_id === parentId && n.side === side),
    [nodes]
  );

  const item = items?.[idx] ?? null;
  const promptSans = item?.prompt_sans ?? EMPTY_SANS;
  const lineSans = useMemo(() => [...promptSans, ...played], [promptSans, played]);
  const position = useMemo(() => replaySans(lineSans, viewPly), [lineSans, viewPly]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;
  const liveFen = useMemo(() => fenAfter(lineSans), [lineSans]);
  /** Steht das Brett auf der Stellung, in der gerade gefragt wird? */
  const atLive = viewPly === lineSans.length;

  itemsRef.current = items ?? [];

  useEffect(() => {
    if (
      items == null ||
      item != null ||
      !backend.info ||
      reviewMomentSentRef.current
    ) {
      return;
    }
    reviewMomentSentRef.current = true;
    void maybeRequestPlayReview(backend.info, {
      kind: "repertoire-session-complete",
      correctAnswers: doneCount.ok,
    });
  }, [backend.info, doneCount.ok, item, items]);

  // Neue Karte: Brett auf die Ausgangsstellung, Kette zurücksetzen und die
  // erlaubten Antworten aus dem Baum holen (das Buch darf hier mehrere kennen).
  useEffect(() => {
    if (!item) return;
    clearTimers();
    setPlayed([]);
    setViewPly(item.prompt_sans.length);
    setState("ask");
    failedRef.current = false;
    chainRef.current = 0;
    askedAtRef.current = Date.now();
    const parentId = byId.get(item.node_id)?.parent_id ?? 0;
    const alternatives = childrenOf(parentId, item.side).filter((n) => n.my_move);
    setAnswers(
      alternatives.length > 0
        ? alternatives.map((n) => ({ id: n.id, san: n.san }))
        : [{ id: item.node_id, san: item.expected_san }]
    );
    setNoteId(alternatives[0]?.id ?? item.node_id);
    setNoteOpen(false);
  }, [item, byId, childrenOf, clearTimers]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setViewPly((value) => Math.max(0, value - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setViewPly((value) => Math.min(lineSans.length, value + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lineSans.length]);

  /** Zur nächsten Karte · schon beantwortete Züge werden übersprungen. */
  const advance = useCallback(() => {
    setIdx((current) => {
      let next = current + 1;
      while (
        next < itemsRef.current.length
        && answeredRef.current.has(itemsRef.current[next].node_id)
      ) {
        next += 1;
      }
      return next;
    });
  }, []);

  const finishCard = useCallback(() => later(advance, ADVANCE_MS), [advance, later]);

  const show = (san: string) => {
    setPlayed((current) => [...current, san]);
    setViewPly((value) => value + 1);
  };

  /**
   * Nach meinem Zug antwortet der Gegner selbst. Kennt das Buch mehrere
   * Antworten, entscheidet der Zufall · sonst übt man immer denselben Pfad
   * durch eine Variante, die in Wahrheit mehrere hat.
   */
  const continueLine = useCallback(
    (nodeId: number, side: "white" | "black") => {
      if (chainRef.current >= MAX_CHAIN) return finishCard();
      const replies = childrenOf(nodeId, side);
      if (replies.length === 0) return finishCard();
      const reply = replies[Math.floor(Math.random() * replies.length)];
      later(() => {
        show(reply.san);
        const mine = childrenOf(reply.id, side).filter((n) => n.my_move);
        if (mine.length === 0) {
          finishCard();
          return;
        }
        chainRef.current += 1;
        setAnswers(mine.map((n) => ({ id: n.id, san: n.san })));
        setNoteId(mine[0].id);
        setNoteOpen(false);
        setState("ask");
        failedRef.current = false;
        askedAtRef.current = Date.now();
      }, REPLY_MS);
    },
    [childrenOf, finishCard, later]
  );

  const accept = (answer: Answer, san: string, side: "white" | "black") => {
    if (!failedRef.current) {
      record(answer.id, gradeForAnswer(Date.now() - askedAtRef.current));
      setDoneCount((c) => ({ ...c, ok: c.ok + 1 }));
      // Nur sauber Gekonntes gilt als erledigt · ein Fehler soll später in
      // dieser Sitzung noch einmal drankommen.
      answeredRef.current.add(answer.id);
    }
    setNoteId(answer.id);
    setState("correct");
    show(san);
    continueLine(answer.id, side);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (!item || state !== "ask" || !atLive) return false;
    let san: string;
    try {
      const chess = new Chess(liveFen);
      san = chess.move({ from, to, promotion: promotionFor(answers) }).san;
    } catch {
      return false;
    }
    const hit = answers.find((a) => bareSan(a.san) === bareSan(san));
    if (hit) {
      accept(hit, san, item.side);
      return true;
    }
    if (!failedRef.current) {
      failedRef.current = true;
      const missed = answers[0];
      record(missed.id, 1);
      setDoneCount((c) => ({ ...c, fail: c.fail + 1 }));
      // Der Zug kommt am Ende der Sitzung wieder · einmal falsch heißt nicht
      // "morgen wieder", sondern "gleich noch einmal".
      if (!requeuedRef.current.has(item.node_id)) {
        requeuedRef.current.add(item.node_id);
        setItems((current) => (current ? [...current, item] : current));
      }
    }
    setState("wrong");
    setShake(true);
    later(() => setShake(false), 600);
    return false;
  };

  /** Buchzug zeigen und die Karte beenden · nach einem Fehler läuft die Linie nicht weiter. */
  const reveal = () => {
    if (!item || state !== "ask") return;
    if (!failedRef.current) {
      failedRef.current = true;
      record(answers[0].id, 1);
      setDoneCount((c) => ({ ...c, fail: c.fail + 1 }));
      if (!requeuedRef.current.has(item.node_id)) {
        requeuedRef.current.add(item.node_id);
        setItems((current) => (current ? [...current, item] : current));
      }
    }
    setState("correct");
    show(answers[0].san);
    finishCard();
  };

  const revealAndNext = () => {
    if (!item) return;
    setState("correct");
    show(answers[0].san);
    finishCard();
  };

  // "h" wie Hinweis · im Training hat man die Hand an der Maus, nicht auf Tab.
  // Der Ref hält die aktuelle Aktion, damit der Listener einmal hängen bleibt.
  const hintRef = useRef<() => void>(() => {});
  hintRef.current = () => {
    if (state === "ask") reveal();
    else if (state === "wrong") revealAndNext();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "h" && event.key !== "H") return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      hintRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trainSelection = useBoardSelection(fen, tryMove, state === "ask" && atLive);

  if (items == null) return null;
  if (!item) {
    const answered = doneCount.ok + doneCount.fail > 0;
    const endeTitel = answered
      ? t("rep.trainingDone")
      : free
        ? t("rep.freeEmpty")
        : t("rep.nothingDue");
    const endeText = answered
      ? t(free ? "rep.freeResult" : "rep.sessionResult", {
          ok: doneCount.ok,
          fail: doneCount.fail,
        })
      : free
        ? t("rep.freeEmptyHint")
        : t("rep.allLearned");
    if (diagramMode) {
      return (
        <Suspense fallback={<LeereSeite />}>
          <TrainerBlatt
            mobile={mobile}
            kopfRechts={t("rep.nLeft", { n: 0 })}
            ende={{
              titel: endeTitel,
              text: endeText,
              schalter: [
                { label: t("rep.backToRep"), betont: true, onClick: onExit },
                ...(onFreeTraining && !free
                  ? [{ label: t("rep.freeTraining"), onClick: onFreeTraining }]
                  : []),
              ],
            }}
          />
        </Suspense>
      );
    }
    return (
      <div className="mx-auto max-w-[480px] rounded-xl border border-line bg-panel px-6 py-10 text-center">
        <GraduationCap size={28} className="mx-auto text-accent" />
        <div className="mt-3 text-[17px] font-semibold">{endeTitel}</div>
        <div className="mt-1.5 text-[13px] text-ink3">{endeText}</div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button primary onClick={onExit}>
            {t("rep.backToRep")}
          </Button>
          {/* Der Ausweg aus dem leeren Plan · üben kann man trotzdem. */}
          {onFreeTraining && !free && (
            <Button onClick={onFreeTraining}>
              <Shuffle size={14} /> {t("rep.freeTraining")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const askPly = lineSans.length;
  const moveNo = Math.floor(askPly / 2) + 1;
  const previousSan = lineSans[lineSans.length - 1];
  const previousMove = previousSan
    ? `${Math.ceil(askPly / 2)}${askPly % 2 === 1 ? "." : "…"}${previousSan}`
    : t("rep.startPos");
  const expectedLabel = answers.map((a) => a.san).join(" / ");
  /**
   * Die Notiz zur gefragten Stellung · sichtbar, sobald die Karte beantwortet
   * ist.
   *
   * Verdeckt, solange die Frage offen ist, und zwar aus einem Grund, der sich
   * beim ersten Versuch von selbst zeigt: In einer Notiz steht „hier immer
   * c3 und d4", und damit stünde die Antwort neben der Frage. Geschrieben
   * werden darf trotzdem jederzeit — ein Blick auf den eigenen Satz deckt ihn
   * auf, und wer das tut, hat die Karte ohnehin nicht gewusst.
   */
  const storedNote = noteId != null ? (noteEdits[noteId] ?? byId.get(noteId)?.note ?? "") : "";
  const noteCovered = state === "ask" && !noteOpen && storedNote.trim() !== "";
  const playedSan = played[played.length - 1] ?? expectedLabel;
  const captured = capturedFromFen(fen);

  /**
   * Kopf, Brett und Bedienung als benannte Bausteine · die Seite und das
   * Fokus-Brett zeigen dieselben. Das Brett bekommt je eine eigene Kennung,
   * weil react-chessboard seine Instanzen daran unterscheidet.
   */
  const trainHead = (
    <>
      {/* Der Name einer Variante ist lang · „Scandinavian Defense: Bronstein
          Variation" bricht auf dem Telefon in zwei Zeilen um. Der Zähler
          rechts darf davon nichts abbekommen: Ohne `shrink-0` gab die Seite ihm
          den Rest der Zeile und brach ihn selbst um, sodass „3 /" und „12"
          untereinander neben dem Merkmal standen. Er behält deshalb seine
          Breite, und beide Seiten stehen oben bündig · bei einzeiligem Namen
          sieht das aus wie vorher. */}
      <div className="mb-3 flex items-start justify-between gap-3 text-[13px]">
        <span className="min-w-0 font-medium">
          {item.line || t("rep.fallbackLine")} ·{" "}
          {item.side === "white" ? t("common.white") : t("common.black")}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ink3">
          {free && (
            <span
              className="flex items-center gap-1 rounded-full border border-line2 px-2 py-0.5 text-[11px]"
              title={t("rep.freeNote")}
            >
              <Shuffle size={11} /> {t("rep.freeTag")}
            </span>
          )}
          {idx + 1} / {items.length} {item.is_new && !free && t("rep.newTag")}
        </span>
      </div>
      {/* Eine Repertoire-Zeile läuft aus der Grundstellung · was fehlt, wurde
          wirklich geschlagen, also steht es an der Seite, die es schlug. Ohne
          Namen bleibt es bei den Figuren allein; in einer Eröffnung ist meist
          nichts geschlagen, und dann entfällt die Zeile ganz. */}
      <div className="mb-2 empty:hidden">
        <CapturedPieces
          pieces={item.side === "white" ? captured.black : captured.white}
          color={item.side === "white" ? "white" : "black"}
          advantage={item.side === "white" ? -captured.diff : captured.diff}
        />
      </div>
    </>
  );

  const trainBoard = (boardId: string) => (
    <>
      <div className="board-bleed">
        <Board
          boardId={boardId}
          fen={fen}
          width={BOARD_MAX}
          lastMove={lastMove}
          draggable={state === "ask" && atLive}
          onPieceDrop={tryMove}
          onSquareClick={trainSelection.onSquareClick}
          squareStyles={trainSelection.squareStyles}
          orientation={item.side}
          shake={shake}
          mouseDrag
        />
      </div>
      <div className="mt-2 empty:hidden">
        <CapturedPieces
          pieces={item.side === "white" ? captured.white : captured.black}
          color={item.side === "white" ? "black" : "white"}
          advantage={item.side === "white" ? captured.diff : -captured.diff}
        />
      </div>
    </>
  );

  /** Im Fokus fehlt der Griff zum Fokus · dort ist man schon. */
  const trainControls = (inFocus: boolean) => (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2">
        <span className="text-[12.5px] text-ink2">{t("rep.lastMove", { move: previousMove })}</span>
        <div className="flex items-center gap-1">
          <Button onClick={() => setViewPly(0)} title={t("rep.firstPosition")} compact>
            <ChevronFirst size={14} />
          </Button>
          <Button
            onClick={() => setViewPly((value) => Math.max(0, value - 1))}
            title={t("rep.previousPosition")}
            compact
          >
            <ChevronLeft size={14} />
          </Button>
          <span className="min-w-[54px] text-center text-[11.5px] tabular-nums text-ink3">
            {viewPly} / {lineSans.length}
          </span>
          <Button
            onClick={() => setViewPly((value) => Math.min(lineSans.length, value + 1))}
            title={t("rep.nextPosition")}
            compact
          >
            <ChevronRight size={14} />
          </Button>
          <Button
            onClick={() => setViewPly(lineSans.length)}
            title={t("rep.promptPosition")}
            compact
          >
            <ChevronLast size={14} />
          </Button>
          {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
        </div>
      </div>
      <div className="mt-3 flex min-h-[52px] items-center">
        {state === "correct" ? (
          <div className="flex w-full items-center gap-2 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[13.5px] font-medium text-accent">
            <Check size={17} /> {t("rep.correct", { san: playedSan })}
          </div>
        ) : state === "wrong" ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-loss-dim bg-loss-soft px-4 py-2.5">
            <span className="text-[13.5px] text-loss">
              {t("rep.bookMoveIs", { san: expectedLabel })}
            </span>
            <Button onClick={revealAndNext} title={t("rep.revealShortcut")}>
              {t("rep.showAndNext")}
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-ink3">
              {t("rep.whatToPlay", {
                n: moveNo,
                side: item.side === "white" ? t("common.white") : t("common.black"),
              })}
            </span>
            <Button onClick={reveal} title={t("rep.revealShortcut")}>
              <Lightbulb size={14} /> {t("rep.reveal")}
            </Button>
          </div>
        )}
      </div>
    </>
  );

  /**
   * Das Notizfeld, fertig gesetzt · verdeckt oder offen, je nach Zustand.
   *
   * Beide Fassungen zeigen dasselbe Feld, nur anders gesetzt: das Blatt auf
   * liniertem Papier, die gewöhnliche Fassung im Kasten. Die Regel darüber —
   * verdeckt, solange die Frage offen ist — steht einmal hier und nicht
   * zweimal in den beiden Ansichten.
   */
  const notizDeckel = (
    <button
      type="button"
      onClick={() => setNoteOpen(true)}
      className={
        diagramMode
          ? "flex w-full items-center gap-2.5 border-b border-line py-2.5 text-start"
          : "flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line2 px-3 py-2.5 text-start transition-colors hover:border-line"
      }
    >
      <span
        aria-hidden
        className={diagramMode ? "h-3 flex-1 bg-line2" : "h-3 flex-1 rounded-sm bg-panel3"}
      />
      <span className="shrink-0 text-[11.5px] text-ink3">{t("blatt.covered")}</span>
    </button>
  );

  const notizBlatt =
    noteId == null ? null : noteCovered ? (
      <>
        {notizDeckel}
        <p className="mt-2 text-[11.5px] leading-[1.55] text-ink3">{t("rep.noteHidden")}</p>
      </>
    ) : (
      <Notizfeld
        key={noteId}
        notiz={storedNote}
        platzhalter={t("rep.notePlaceholder")}
        onSpeichern={async (text) => {
          try {
            await repSetNote(noteId, text);
            setNoteEdits((current) => ({ ...current, [noteId]: text }));
            setNoteError(null);
          } catch (e) {
            setNoteError(errorMessage(e));
          }
        }}
      />
    );

  if (diagramMode) {
    const eigenerName = item.side === "white" ? t("common.white") : t("common.black");
    const gegenName = item.side === "white" ? t("common.black") : t("common.white");
    return (
      <Suspense fallback={<LeereSeite />}>
        <TrainerBlatt
          mobile={mobile}
          kopfRechts={t("rep.nLeft", { n: items.length - idx })}
          aufgabe={{
            felder: [
              {
                label: t("blatt.variant"),
                wert: item.line || t("rep.fallbackLine"),
                gross: true,
              },
              {
                label: t("blatt.youPlay"),
                wert: (
                  <span className="inline-flex items-center gap-[7px]">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 flex-none border border-ink"
                      style={{
                        background: item.side === "black" ? "var(--color-ink)" : "transparent",
                      }}
                    />
                    {eigenerName}
                  </span>
                ),
              },
              {
                label: t("blatt.cardNo"),
                wert: (
                  <>
                    <span className="blatt-zahl">{idx + 1}</span>
                    <span className="text-ink3"> / {items.length}</span>
                  </>
                ),
              },
              {
                label: t("blatt.category"),
                wert: free ? t("rep.freeTraining") : item.is_new ? t("rep.new") : t("rep.due"),
              },
            ],
            stand: `${doneCount.ok} : ${doneCount.fail}`,
            oben: { name: gegenName, farbe: item.side === "white" ? "black" : "white" },
            unten: { name: eigenerName, farbe: item.side },
            brett: trainBoard("rep-train"),
            meldung:
              state === "correct"
                ? t("rep.correct", { san: playedSan })
                : state === "wrong"
                  ? t("rep.bookMoveIs", { san: expectedLabel })
                  : t("rep.whatToPlay", {
                      n: moveNo,
                      side: item.side === "white" ? t("common.white") : t("common.black"),
                    }),
            tonart: state === "correct" ? "richtig" : state === "wrong" ? "falsch" : "offen",
            // Beide Wege stehen immer da, und der, der gerade gilt, ist der
            // bedienbare · sonst spränge die Reihe bei jeder Antwort um.
            schalter: [
              {
                label: t("rep.reveal"),
                titel: t("rep.revealShortcut"),
                onClick: state === "ask" ? reveal : undefined,
              },
              {
                label: t("rep.showAndNext"),
                betont: true,
                titel: t("rep.revealShortcut"),
                onClick: state === "wrong" ? revealAndNext : undefined,
              },
            ],
            griffe: <FocusButton onClick={() => setFocused(true)} />,
            verlaufSchalter: [
              { label: "⏮", titel: t("rep.firstPosition"), onClick: () => setViewPly(0) },
              {
                label: "‹",
                titel: t("rep.previousPosition"),
                onClick: () => setViewPly((value) => Math.max(0, value - 1)),
              },
              {
                label: "›",
                titel: t("rep.nextPosition"),
                onClick: () => setViewPly((value) => Math.min(lineSans.length, value + 1)),
              },
              {
                label: "⏭",
                titel: t("rep.promptPosition"),
                onClick: () => setViewPly(lineSans.length),
              },
            ],
            verlaufZaehler: t("blatt.plyOf", { n: viewPly, total: lineSans.length }),
            verlaufNote: t("rep.lastMove", { move: previousMove }),
            fortschritt: (idx / items.length) * 100,
            zahlen: [
              { name: t("rep.rightLabel"), wert: String(doneCount.ok) },
              { name: t("rep.wrongLabel"), wert: String(doneCount.fail) },
              { name: t("rep.leftLabel"), wert: String(items.length - idx) },
            ],
            tiefe: chainRef.current > 0 ? t("rep.lineDepth", { n: chainRef.current + 1 }) : null,
            freiNote: free ? t("rep.freeNote") : null,
            notiz: (
              <>
                {notizBlatt}
                {noteError && <p className="mt-2 text-[12px] text-loss">{noteError}</p>}
              </>
            ),
            hinweis: t("rep.trainerHint"),
            onBeenden: onExit,
            fokus: {
              offen: focused,
              onSchliessen: () => setFocused(false),
              titel: t("rep.trainerTitle"),
              untertitel: item.line || t("rep.fallbackLine"),
              brett: trainBoard("rep-train-focus"),
            },
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
      <div className="max-w-[var(--board-edge)]">
        {trainHead}
        {trainBoard("rep-train")}
        {trainControls(false)}

        <FocusBoard
          open={focused}
          onClose={() => setFocused(false)}
          title={t("rep.trainerTitle")}
          subtitle={item.line || t("rep.fallbackLine")}
          above={trainHead}
          below={trainControls(true)}
        >
          {trainBoard("rep-train-focus")}
        </FocusBoard>
      </div>

      <div className="flex max-w-[420px] flex-col gap-4">
        <Card title={t("rep.session")}>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-win">{t("rep.nCorrect", { n: doneCount.ok })}</span>
            <span className="text-loss">{t("rep.nWrong", { n: doneCount.fail })}</span>
            <span className="text-ink3">{t("rep.nLeft", { n: items.length - idx })}</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(idx / items.length) * 100}%` }}
            />
          </div>
          {chainRef.current > 0 && (
            <div className="mt-3 border-t border-line pt-2.5 text-[12px] text-ink3">
              {t("rep.lineDepth", { n: chainRef.current + 1 })}
            </div>
          )}
          {free && (
            <div className="mt-3 border-t border-line pt-2.5 text-[12px] leading-relaxed text-ink3">
              {t("rep.freeNote")}
            </div>
          )}
        </Card>
        {noteId != null && (
          <Card title={t("rep.note")}>
            {noteCovered ? (
              <>
                {notizDeckel}
                <p className="mt-2 text-[12px] leading-relaxed text-ink3">{t("rep.noteHidden")}</p>
              </>
            ) : (
              <RepertoireNote
                key={noteId}
                nodeId={noteId}
                note={storedNote}
                onSaved={(text) => {
                  setNoteEdits((current) => ({ ...current, [noteId]: text }));
                  setNoteError(null);
                }}
                onError={setNoteError}
              />
            )}
            {noteError && <p className="mt-2 text-[12px] text-loss">{noteError}</p>}
          </Card>
        )}
        <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
          {t("rep.trainerHint")}
        </div>
        <Button onClick={onExit}>{t("rep.endTraining")}</Button>
      </div>
    </div>
  );
}
