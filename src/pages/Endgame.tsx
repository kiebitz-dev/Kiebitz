import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  CheckCircle2,
  Crown,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Share2,
  Shuffle,
  SkipForward,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  CATEGORY_ORDER,
  drillText,
  ENDGAME_DRILLS,
  type EndgameCategory,
  type EndgameDrill,
} from "../data/endgames";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { endgameMove, endgameRecord, endgameStats, type DrillStat } from "../lib/endgame";
import Board from "../components/Board";
import ShareDialog, { type ShareSubject } from "../components/ShareDialog";
import { useBoardEndView } from "../components/BoardEndView";
import { endForPosition } from "../lib/boardEnd";
import { BOARD_MAX } from "../lib/boardLayout";
import { moveTargetStyles } from "../lib/boardMoves";
import { randomDrill } from "../lib/randomEndgame";
import { useTrainingSession } from "../lib/session";
import { Button, Card, Disclosure, Menu, MenuItem } from "../components/ui";
import FocusBoard, { FocusButton, FocusMenuItem } from "../components/FocusBoard";
import { deInt } from "../lib/format";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
import { useDiagramMode } from "../lib/diagramMode";
import { useMobileShell } from "../components/MobileShell";

/** Die Aufgabe im Buchsatz kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const EndgameBlatt = lazy(() => import("./blatt/EndgameBlatt"));

const CATEGORY_KEY: Record<EndgameCategory, Key> = {
  mates: "eg.catMates",
  pawn: "eg.catPawn",
  rook: "eg.catRook",
  queen: "eg.catQueen",
  minor: "eg.catMinor",
  random: "eg.randomTitle",
};

type Status = "playing" | "thinking" | "solved" | "failed";

/**
 * `initialCategory` kommt aus dem Lernplan: der Befund nennt einen
 * Endspieltyp aus der Materialsignatur, und `ENDGAME_TYPE_CATEGORY` übersetzt
 * ihn in die Drill-Kategorie · sonst landet der Nutzer nach dem Klick auf
 * „Endspiel trainieren" wieder beim Damenmatt.
 */
export default function Endgame({ initialCategory }: { initialCategory?: EndgameCategory }) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  // Endspielbudget: gemessene Zeit am Brett statt vier Minuten je Drill.
  useTrainingSession("endgames", desktop);

  const [drill, setDrill] = useState<EndgameDrill>(() =>
    (initialCategory && ENDGAME_DRILLS.find((d) => d.category === initialCategory)) ??
    randomDrill()
  );
  const [fen, setFen] = useState(drill.fen);
  const [status, setStatus] = useState<Status>("playing");
  const [endMsg, setEndMsg] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Zuletzt gezogener Zug · eigener wie Engine-Antwort, für die Markierung. */
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [hintMove, setHintMove] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  /**
   * Ob der Hinweistext zur Stellung aufgedeckt ist.
   *
   * Verdeckt ist der Normalfall: Der Text sagt, wie das Endspiel technisch
   * geht, und wer ihn beim ersten Hinsehen mitliest, übt nichts. Er steht in
   * beiden Fassungen an derselben Stelle im Ablauf, deshalb liegt der Stand
   * hier und nicht in der Darstellung · mit der nächsten Aufgabe (`start`)
   * fällt er wieder zu.
   */
  const [hintOpen, setHintOpen] = useState(false);
  const [shake, setShake] = useState(false);
  const [stats, setStats] = useState<Record<string, DrillStat>>({});
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);

  const chessRef = useRef(new Chess(drill.fen));
  // Läuft eine Engine-Anfrage noch, während der Drill gewechselt wird,
  // darf ihre Antwort das neue Brett nicht mehr anfassen.
  const runRef = useRef(0);

  const reloadStats = () => {
    if (!desktop) return Promise.resolve(null);
    return endgameStats()
      .then((list) => {
        const map: Record<string, DrillStat> = {};
        for (const s of list) map[s.drill_id] = s;
        setStats(map);
        return map;
      })
      .catch(() => null);
  };

  useEffect(() => {
    reloadStats();
  }, [desktop]);

  const userColor = drill.side === "white" ? "w" : "b";

  /** Prüft auf Partieende; true, wenn der Drill vorbei ist. */
  const checkEnd = (d: EndgameDrill): boolean => {
    const c = chessRef.current;
    if (!c.isGameOver()) return false;
    let success: boolean;
    let msg: Key;
    if (c.isCheckmate()) {
      // Matt gesetzt hat, wer den letzten Zug machte.
      const winner = c.turn() === "w" ? "black" : "white";
      success = winner === d.side;
      msg = success ? "eg.successWin" : "eg.failedLost";
    } else {
      success = d.goal === "draw";
      msg = success ? "eg.successDraw" : "eg.failedWin";
      if (!success && d.goal === "draw") msg = "eg.failedDraw";
    }
    setStatus(success ? "solved" : "failed");
    setEndMsg(msg);
    if (desktop) {
      endgameRecord(d.id, success, c.history().length)
        .then(reloadStats)
        .then((nextStats) => {
          if (!success || !nextStats) return;
          void maybeRequestPlayReview(backend.info, {
            kind: "endgame-drill-mastered",
            masteredDrills: ENDGAME_DRILLS.filter(
              (drill) => (nextStats[drill.id]?.solved ?? 0) > 0
            ).length,
          });
        })
        .catch(() => {});
    }
    return true;
  };

  /** Fordert den Engine-Zug für die Gegenseite an. */
  const engineTurn = (d: EndgameDrill) => {
    if (!desktop) return; // Web-Preview: der Spieler zieht beide Seiten.
    const run = runRef.current;
    setStatus("thinking");
    endgameMove(chessRef.current.fen())
      .then((uci) => {
        if (run !== runRef.current) return;
        const move = chessRef.current.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
        setFen(chessRef.current.fen());
        setLastMove({ from: move.from, to: move.to });
        if (!checkEnd(d)) setStatus("playing");
      })
      .catch((e) => {
        if (run !== runRef.current) return;
        setError(String(e));
        setStatus("playing");
      });
  };

  const start = (d: EndgameDrill) => {
    runRef.current += 1;
    setDrill(d);
    chessRef.current = new Chess(d.fen);
    setFen(d.fen);
    setLastMove(null);
    setStatus("playing");
    setEndMsg(null);
    setError(null);
    setSelected(null);
    setHintMove(null);
    setHintOpen(false);
    // Ist die Gegenseite am Zug (z. B. Opposition-Drill), beginnt die Engine.
    const engineFirst = d.fen.split(" ")[1] !== (d.side === "white" ? "w" : "b");
    if (engineFirst) setTimeout(() => engineTurn(d), 400);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (status !== "playing") return false;
    const c = chessRef.current;
    if (desktop && c.turn() !== userColor) return false;
    let move;
    try {
      move = c.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    setFen(c.fen());
    setLastMove({ from: move.from, to: move.to });
    setSelected(null);
    setHintMove(null);
    setError(null);
    if (checkEnd(drill)) return true;
    // Desktop: Engine antwortet; Web: der Spieler zieht selbst weiter.
    if (desktop && c.turn() !== userColor) engineTurn(drill);
    return true;
  };

  const onSquareClick = (square: string) => {
    if (status !== "playing") return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      if (!moved && piece && piece.color === chess.turn()) {
        setSelected(square);
      } else if (!moved) {
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setSelected(null);
      }
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  /** Engine-Vorschlag für den eigenen Zug (Desktop). */
  const showHint = () => {
    if (!desktop || status !== "playing" || hintLoading) return;
    const run = runRef.current;
    setHintLoading(true);
    endgameMove(chessRef.current.fen())
      .then((uci) => {
        if (run !== runRef.current) return;
        setHintMove(uci);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setHintLoading(false));
  };

  const squareStyles: Record<string, React.CSSProperties> = {
    // Zugpunkte wie im Analyse-Brett.
    ...(status === "playing" ? moveTargetStyles(fen, selected) : {}),
  };
  if (selected) squareStyles[selected] = { boxShadow: "inset 0 0 0 3px var(--color-accent)" };
  if (hintMove) {
    squareStyles[hintMove.slice(0, 2)] = { boxShadow: "inset 0 0 0 3px var(--color-gold)" };
    squareStyles[hintMove.slice(2, 4)] = { boxShadow: "inset 0 0 0 3px #d9a02888" };
  }

  /**
   * Das Endspiel, wie es beim Empfänger ankommt.
   *
   * Geteilt wird die Ausgangsstellung des Drills und nicht der eigene
   * Zwischenstand · wie bei einer Aufgabe gibt man das Problem weiter und
   * nicht die halbe Lösung. Das Ziel steht in der Überschrift: Ohne „Gewinn"
   * oder „Remis" ist eine Endspielstellung nur ein Haufen Figuren.
   */
  const openShare = () => {
    setSharing({
      kind: "endgame",
      fen: drill.fen,
      orientation: drill.side,
      title: `${drillText(drill.name, locale)} · ${t(drill.goal === "win" ? "eg.goalWin" : "eg.goalDraw")}`,
    });
  };

  const shareButton = (
    <Button onClick={openShare} className="px-2" title={t("sh.title")}>
      <Share2 size={14} />
    </Button>
  );

  const mastered = useMemo(
    () => ENDGAME_DRILLS.filter((d) => (stats[d.id]?.solved ?? 0) > 0).length,
    [stats]
  );

  // Der Drill spielt sich selbst aus · was am Ende steht, sagt die Stellung.
  // Aufgabe oder Zeitüberschreitung gibt es hier nicht.
  const boardEnd = useBoardEndView(
    status === "solved" || status === "failed" ? endForPosition(fen) : null
  );

  const nextUnsolved = (): EndgameDrill | null => {
    const idx = ENDGAME_DRILLS.findIndex((d) => d.id === drill.id);
    for (let i = 1; i <= ENDGAME_DRILLS.length; i++) {
      const cand = ENDGAME_DRILLS[(idx + i) % ENDGAME_DRILLS.length];
      if ((stats[cand.id]?.solved ?? 0) === 0) return cand;
    }
    return null;
  };

  /**
   * Statuszeile, Brett und Bedienung als benannte Bausteine · die Seite und
   * das Fokus-Brett zeigen dieselben. Das Brett bekommt je eine eigene
   * Kennung, weil react-chessboard seine Instanzen daran unterscheidet.
   */
  /**
   * Der Kopf des Drills · zwei feste Zeilen statt einer, die umbricht.
   *
   * Vorher standen Name, Ziel und Stand in einer Reihe, die sich den Platz
   * teilen mussten. Auf 360 Pixel geht das nicht auf: „Zufall: zwei Damen
   * gegen König" braucht zwei Zeilen, das Ziel rutschte auf eine dritte, und
   * „Du bist am Zug" stand oben rechts an der Zeile klebend, mit der es nichts
   * zu tun hat. Drei Angaben, drei Höhen, keine Ordnung.
   *
   * Jetzt hat jede Angabe ihren Platz: der Name über die volle Breite, weil er
   * die längste ist und ohnehin umbrechen darf · darunter, an ihm ausgerichtet,
   * das Ziel links und der Stand rechts. Der Stand bleibt damit auf seiner
   * Zeile stehen, egal wie lang der Name ist, und wechselt zwischen „am Zug"
   * und „rechnet", ohne dass etwas darunter springt.
   */
  const drillHead = (
    <div className="mb-3 flex min-h-10 flex-col justify-center gap-1">
      <div className="flex items-start gap-2 text-[13.5px] leading-snug">
        <Crown size={15} className="mt-[2px] shrink-0 text-accent" />
        <span className="min-w-0 font-medium">{drillText(drill.name, locale)}</span>
      </div>
      {/* Eingerückt auf Höhe des Namens · Zeichenbreite plus Abstand. */}
      <div className="flex min-h-5 items-center justify-between gap-3 ps-[23px]">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${
            drill.goal === "win" ? "bg-accent-soft text-accent" : "bg-panel3 text-gold"
          }`}
        >
          {drill.goal === "win" ? t("eg.goalWin") : t("eg.goalDraw")}
        </span>
        <span
          data-testid="endgame-status"
          className="min-h-5 min-w-0 truncate text-[12.5px] leading-5 text-ink3"
        >
          {status === "thinking" ? t("eg.thinking") : status === "playing" ? t("eg.yourTurn") : ""}
        </span>
      </div>
    </div>
  );

  const drillBoard = (boardId: string) => (
    <div className="board-bleed">
      <Board
        boardId={boardId}
        fen={fen}
        width={BOARD_MAX}
        lastMove={lastMove}
        draggable={status === "playing"}
        onPieceDrop={tryMove}
        onSquareClick={onSquareClick}
        squareStyles={squareStyles}
        orientation={drill.side}
        shake={shake}
        end={boardEnd}
        mouseDrag
      />
    </div>
  );

  /**
   * Die Nebenaktionen der Knopfreihe · Teilen und der Fokus.
   *
   * In der App stehen sie hinter einem Zeichen. Ausgeschrieben passten
   * „Zug zeigen", „Neu starten" und die beiden Zeichen auf einem 360 px
   * breiten Schirm nicht in eine Zeile: Der Fokus rutschte allein in eine
   * zweite Zeile unter die anderen. Es ist dieselbe Zusammenfassung, die die
   * Analyse unter ihrem Brett schon benutzt.
   *
   * Im Fokus fehlt der Griff zum Fokus · dort ist man schon.
   */
  const nebenaktionen = (inFocus: boolean) =>
    mobile ? (
      <Menu label={t("an.boardActions")} align="end" compact icon={<MoreHorizontal size={15} />}>
        <MenuItem onClick={openShare}>
          <Share2 size={15} /> {t("sh.title")}
        </MenuItem>
        {!inFocus && <FocusMenuItem onClick={() => setFocused(true)} />}
      </Menu>
    ) : (
      <>
        {shareButton}
        {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
      </>
    );

  const drillActions = (inFocus: boolean) => {
    return (
      <div className="mt-3 min-h-[52px]">
        {status === "solved" || status === "failed" ? (
          /* Der Schlussstand · Urteil und die Wege, die daraus folgen.
             Nebeneinander passt beides nur auf dem Rechner. Auf einem 360 px
             breiten Schirm brach die Reihe früher mitten zwischen den Knöpfen
             um: die Meldung oben, darunter „Neu starten" und das Zeichen an
             der rechten Kante, ganz unten allein der laute Knopf — drei
             Zeilen, die nichts miteinander zu tun zu haben schienen.

             In der App stehen deshalb zwei saubere Zeilen: der Satz, darunter
             die Knopfreihe, in der die Nebenwege links und der Weg nach vorn
             rechts steht. Damit die drei nebeneinander bleiben, heißt der Weg
             nach vorn dort nur „Nächste" · gegenüber von „Nochmal" sagt das
             Wort allein schon alles, und „Nächste Zufallsstellung" hätte die
             Reihe erneut umbrechen lassen. */
          <div
            className={`flex w-full gap-2 rounded-lg px-4 py-2.5 ${
              mobile ? "flex-col" : "flex-wrap items-center justify-between"
            } ${
              status === "solved"
                ? "border border-accent-dim bg-accent-soft"
                : "border border-loss-dim bg-loss-soft"
            }`}
          >
            <div
              className={`flex items-center gap-2 text-[13.5px] font-medium ${
                status === "solved" ? "text-accent" : "text-loss"
              }`}
            >
              {status === "solved" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              {endMsg ? t(endMsg) : ""}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={() => start(drill)}>
                <RotateCcw size={14} /> {t("eg.retry")}
              </Button>
              {nebenaktionen(inFocus)}
              {/* Nach einer Zufallsaufgabe kommt die nächste Zufallsaufgabe ·
                  und zwar auch dann, wenn die eben nicht geklappt hat. Der Weg
                  nach vorn stand bis 1.4 nur unter einem Haken: Wer „nur Remis"
                  gehalten hatte, kam von hier allein zurück auf dieselbe
                  Stellung. „Nochmal" steht daneben und bleibt der Weg für den,
                  der es wirklich noch einmal wissen will; wer weiterziehen
                  will, soll nicht erst über das Verzeichnis müssen. */}
              {drill.category === "random" && (
                <Button primary className={mobile ? "ms-auto" : ""} onClick={() => start(randomDrill())}>
                  <Shuffle size={15} /> {t(mobile ? "eg.nextShort" : "eg.randomNext")}
                </Button>
              )}
              {drill.category !== "random" && nextUnsolved() && (
                <Button primary className={mobile ? "ms-auto" : ""} onClick={() => start(nextUnsolved()!)}>
                  <SkipForward size={15} /> {t(mobile ? "eg.nextShort" : "eg.nextDrill")}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap justify-end gap-2">
              {desktop && status === "playing" && (
                <Button onClick={showHint}>
                  {hintLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Lightbulb size={14} />
                  )}{" "}
                  {t("eg.hintMove")}
                </Button>
              )}
              <Button onClick={() => start(drill)}>
                <RotateCcw size={14} /> {t("eg.restart")}
              </Button>
              {nebenaktionen(inFocus)}
            </div>
            {/* Die Theorie hinter der Stellung · verdeckt, bis man sie
                verlangt. Sie stand bis hierher offen unter dem Brett, und
                damit las man beim ersten Hinsehen mit, wie das Endspiel geht,
                statt es zu rechnen. Dieselbe Entscheidung wie im Blatt, im
                Register dieser Fassung gesetzt: eine Fläche mit Rand, ein
                Knopf mit Winkel, der Text darunter. */}
            <Disclosure
              className="mt-2.5"
              icon={<Lightbulb size={14} className="text-gold" />}
              title={t("eg.hintTitle")}
              open={hintOpen}
              onToggle={() => setHintOpen((offen) => !offen)}
            >
              {drillText(drill.hint, locale)}
            </Disclosure>
          </>
        )}
      </div>
    );
  };

  if (diagramMode) {
    const eigenerName = drill.side === "white" ? t("common.white") : t("common.black");
    const gegenName = desktop ? t("blatt.engine") : drill.side === "white" ? t("common.black") : t("common.white");
    return (
      <Suspense fallback={<LeereSeite />}>
        <EndgameBlatt
          mobile={mobile}
          felder={[
            { label: t("eg.task"), wert: drillText(drill.name, locale), gross: true },
            { label: t("blatt.category"), wert: t(CATEGORY_KEY[drill.category]) },
            {
              label: t("blatt.youPlay"),
              wert: (
                <span className="inline-flex items-center gap-[7px]">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 flex-none border border-ink"
                    style={{ background: drill.side === "black" ? "var(--color-ink)" : "transparent" }}
                  />
                  {eigenerName}
                </span>
              ),
            },
            { label: t("blatt.opponent"), wert: gegenName },
          ]}
          ziel={drill.goal === "win" ? "1 : 0" : "½ : ½"}
          oben={{ name: gegenName, farbe: drill.side === "white" ? "black" : "white" }}
          unten={{ name: eigenerName, farbe: drill.side }}
          stand={
            status === "thinking"
              ? t("eg.thinking")
              : status === "playing"
                ? t("eg.yourTurn")
                : endMsg
                  ? t(endMsg)
                  : ""
          }
          brett={drillBoard("endgame")}
          hinweis={drillText(drill.hint, locale)}
          hinweisOffen={hintOpen}
          onHinweis={() => setHintOpen((offen) => !offen)}
          fussnote={t("eg.engineNote")}
          gruppen={CATEGORY_ORDER.map((cat) => ({
            titel: t(CATEGORY_KEY[cat]),
            eintraege: ENDGAME_DRILLS.filter((d) => d.category === cat).map((d) => ({
              id: d.id,
              name: drillText(d.name, locale),
              ziel: d.goal === "win" ? "1" : "½",
              gemeistert: (stats[d.id]?.solved ?? 0) > 0,
            })),
          }))}
          aktiv={drill.id}
          gemeistert={mastered}
          gesamt={ENDGAME_DRILLS.length}
          schalter={[
            { label: t("eg.restart"), onClick: () => start(drill) },
            ...(desktop && status === "playing"
              ? [{ label: t("eg.hintMove"), onClick: showHint }]
              : []),
            {
              label: t("eg.nextDrill"),
              betont: true,
              onClick: nextUnsolved() ? () => start(nextUnsolved()!) : undefined,
            },
          ]}
          griffe={nebenaktionen(false)}
          zufall={{
            titel: t("eg.randomTitle"),
            text: t("eg.randomHint"),
            knopf: t("eg.randomStart"),
            onClick: () => start(randomDrill()),
          }}
          onWaehlen={(id) => {
            const gewaehlt = ENDGAME_DRILLS.find((d) => d.id === id);
            if (gewaehlt) start(gewaehlt);
          }}
        />
        {/* Teilen und Fokus sind zwei Dialoge und kein Satz · sie gehören in
            beide Fassungen unverändert. Bis 1.4 standen sie nur im `return`
            der gewöhnlichen, und damit kostete der Modus zwei Wege. */}
        {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}
        <FocusBoard
          open={focused}
          onClose={() => setFocused(false)}
          title={t("eg.title")}
          subtitle={drillText(drill.name, locale)}
          above={drillHead}
          below={drillActions(true)}
        >
          {drillBoard("endgame-focus")}
        </FocusBoard>
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("eg.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("eg.subtitle")}</p>
        </div>
        {desktop && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Trophy size={15} className="text-gold" />
            <span className="font-medium">
              {t("eg.progress", { n: mastered, m: ENDGAME_DRILLS.length })}
            </span>
          </div>
        )}
      </header>

      {!desktop && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("eg.webNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
        {/* Brett + Statuszeile · auf Brettbreite begrenzt, damit lange
            Hinweistexte die auto-Grid-Spalte nicht aufblähen. */}
        <div className="max-w-[var(--board-edge)]">
          {drillHead}
          {drillBoard("endgame")}
          {drillActions(false)}

          {error && (
            <div className="mt-2 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
              {error}
            </div>
          )}

          {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}

          <FocusBoard
            open={focused}
            onClose={() => setFocused(false)}
            title={t("eg.title")}
            subtitle={drillText(drill.name, locale)}
            above={drillHead}
            below={drillActions(true)}
          >
            {drillBoard("endgame-focus")}
          </FocusBoard>
        </div>

        {/* Aufgabenliste */}
        <div className="flex max-w-[460px] flex-col gap-4">
          <Card title={t("eg.randomTitle")}>
            <p className="text-[12.5px] leading-relaxed text-ink3">{t("eg.randomHint")}</p>
            <Button primary onClick={() => start(randomDrill())} className="mt-3">
              <Shuffle size={15} /> {t("eg.randomStart")}
            </Button>
          </Card>

          <Card title={t("eg.drills")}>
            <div className="flex flex-col gap-4">
              {CATEGORY_ORDER.map((cat) => (
                <div key={cat}>
                  <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
                    {t(CATEGORY_KEY[cat])}
                  </div>
                  <div className="flex flex-col gap-1">
                    {ENDGAME_DRILLS.filter((d) => d.category === cat).map((d) => {
                      const st = stats[d.id];
                      const done = (st?.solved ?? 0) > 0;
                      const active = d.id === drill.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => start(d)}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                            active
                              ? "border-accent-dim bg-accent-soft"
                              : "border-line bg-panel2 hover:bg-panel3"
                          }`}
                        >
                          <span className="flex items-center gap-2 text-[13px]">
                            {done ? (
                              <CheckCircle2 size={15} className="shrink-0 text-win" />
                            ) : (
                              <span className="inline-block h-[15px] w-[15px] shrink-0 rounded-full border border-line2" />
                            )}
                            <span className={active ? "font-medium text-ink" : "text-ink2"}>
                              {drillText(d.name, locale)}
                            </span>
                          </span>
                          <span className="shrink-0 pl-3 text-[11.5px] text-ink3">
                            {d.goal === "win" ? t("eg.goalWin") : t("eg.goalDraw")}
                            {st && st.attempts > 0 && (
                              <>
                                {" · "}
                                {done
                                  ? t("eg.solvedTimes", { n: deInt(st.solved) })
                                  : t("eg.attempts", { n: deInt(st.attempts) })}
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {desktop && (
              <div className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
                {t("eg.engineNote")}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
