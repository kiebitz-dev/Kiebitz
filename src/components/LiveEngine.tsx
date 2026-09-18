import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Cpu, Pause, Play } from "lucide-react";
import { engineInfo, type EngineInfo } from "../lib/backend";
import { useT } from "../lib/i18n";
import { isStoreCapture } from "../lib/storeCapture";
import { analyzeLive, onEngineDone, onEngineInfo, stopLive, type LiveInfo } from "../lib/analysis";

type EngineState =
  | { mode: "checking" }
  | { mode: "web" }
  | { mode: "desktop"; info: EngineInfo };

/** Engine-Werte müssen nicht häufiger als die Oberfläche sichtbar neu zeichnen. */
const ENGINE_UI_INTERVAL_MS = 150;
/** Bei Zugfolgen erst die Stellung analysieren, auf der der Nutzer kurz bleibt. */
const ENGINE_START_DELAY_MS = 120;

/** Wandelt die UCI-Hauptvariante (z. B. "e2e4") in lesbares SAN um. */
function pvToSan(fen: string, pv: string[]): string {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out.join(" ");
}

/** Bewertung einer Linie aus Weiß-Sicht formatieren. */
function lineEvalLabel(blackToMove: boolean, info: LiveInfo): string {
  const sign = blackToMove ? -1 : 1;
  if (info.mate_in != null) return `#${sign * info.mate_in}`;
  if (info.eval_cp != null) {
    const cp = (sign * info.eval_cp) / 100;
    return `${cp >= 0 ? "+" : "−"}${Math.abs(cp).toFixed(2)}`;
  }
  return "–";
}

function EngineLineCard({
  blackToMove,
  depthLabel,
  info,
  line,
  onMove,
  blatt = false,
}: {
  blackToMove: boolean;
  depthLabel: string;
  info: LiveInfo;
  line: string;
  onMove?: (uci: string) => void;
  /** Buchsatz statt Kachel · siehe die Anmerkung am Bauteil unten. */
  blatt?: boolean;
}) {
  const content = blatt ? (
    /* Eine Variante steht im Buch als Zeile: die Bewertung vorn, die Züge im
       Fließsatz dahinter, die Tiefe am Rand. Kein Kasten — die Haarlinie
       darunter trennt sie von der nächsten. */
    <div className="flex items-baseline gap-2.5">
      <span className="blatt-zahl w-[46px] shrink-0 text-[13px] font-medium text-accent">
        {lineEvalLabel(blackToMove, info)}
      </span>
      <span className="buch notation min-w-0 flex-1 truncate text-[13px] leading-[1.5] text-ink2">
        {line}
      </span>
      <span className="blatt-zahl shrink-0 text-[10.5px] text-ink3">{depthLabel}</span>
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold tabular-nums text-accent">
          {lineEvalLabel(blackToMove, info)}
        </span>
        <span className="text-[11px] text-ink3">{depthLabel}</span>
      </div>
      <div className="mt-1 truncate text-[12px] leading-relaxed text-ink2">{line}</div>
    </>
  );
  const firstMove = info.pv[0];
  const klasse = blatt
    ? "w-full border-b border-line py-[7px] text-left"
    : "w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-left";

  return onMove && firstMove ? (
    <button
      type="button"
      onClick={() => onMove(firstMove)}
      className={`${klasse} transition-colors ${
        blatt
          ? "hover:border-line2"
          : "hover:border-line2 hover:bg-panel3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim"
      }`}
    >
      {content}
    </button>
  ) : (
    <div className={klasse}>{content}</div>
  );
}

/**
 * Live-Analyse über die persistente Stockfish-Instanz: sobald sich die
 * Stellung ändert, rechnet die Engine neu; info-Zeilen streamen als Events
 * und aktualisieren Linien, Tiefe und (per onEval) die Eval-Bar.
 */
export default function LiveEngine({
  fen,
  demoLines,
  onEval,
  onBestMove,
  onMove,
  blatt = false,
  verdeckt = false,
}: {
  fen: string;
  demoLines: { eval: string; depth: number; line: string }[];
  /** Bewertung aus Weiß-Sicht, sobald die Engine Tiefe gewinnt. */
  onEval?: (evalCp: number | null, mateIn: number | null) => void;
  onBestMove?: (uci: string | null) => void;
  /** Spielt den ersten Zug einer angeklickten Hauptvariante. */
  onMove?: (uci: string) => void;
  /**
   * Buchsatz statt Kachel · für den Diagramm-Modus.
   *
   * Die Engine ist dieselbe und rechnet dasselbe; nur gesetzt ist sie anders.
   * Am freien Brett sind ihre Linien das, was auf einer kommentierten
   * Buchseite die Varianten sind — also stehen sie als Rubrik mit Zeilen und
   * nicht als Karte mit Kästen. Kein zweites Bauteil: Ein doppelter
   * Engine-Anschluss wäre ein zweiter Ort, an dem dieselbe Suche startet.
   */
  blatt?: boolean;
  /**
   * Die Linien verdecken, die Engine aber weiterrechnen lassen.
   *
   * Beim „Nochmal" in der Analyse steht die Stellung vor dem eigenen Fehler
   * auf dem Brett, und die erste Linie wäre die Lösung. Gebraucht wird die
   * Engine trotzdem: Ihre Bewertung sagt, was ein Versuch kostet. Also läuft
   * sie weiter und meldet über `onEval`, nur ihre Züge stehen nicht da.
   */
  verdeckt?: boolean;
}) {
  const t = useT();
  const [engine, setEngine] = useState<EngineState>({ mode: "checking" });
  const [running, setRunning] = useState(true);
  const [lines, setLines] = useState<Map<number, LiveInfo>>(new Map());
  const [nps, setNps] = useState<number | null>(null);
  const genRef = useRef(0);
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const onEvalRef = useRef(onEval);
  onEvalRef.current = onEval;
  const onBestMoveRef = useRef(onBestMove);
  onBestMoveRef.current = onBestMove;
  const pendingInfoRef = useRef<Map<number, LiveInfo>>(new Map());
  const earlyInfoRef = useRef<Map<number, Map<number, LiveInfo>>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInfoRef = useRef<() => void>(() => {});
  const lastEvalRef = useRef<{ fen: string; cp: number | null; mate: number | null } | null>(null);
  const lastBestMoveRef = useRef<{ fen: string; uci: string | null } | null>(null);
  // Tauri-Kommandos strikt ordnen: Ein verspäteter Stop einer alten
  // Stellung darf niemals eine bereits gestartete neuere Suche beenden.
  const engineCommandRef = useRef<Promise<void>>(Promise.resolve());
  const queueStop = useCallback(() => {
    const next = engineCommandRef.current.then(() => stopLive());
    engineCommandRef.current = next.catch(() => {});
    return engineCommandRef.current;
  }, []);

  useEffect(() => {
    engineInfo()
      .then((info) => setEngine({ mode: "desktop", info }))
      .catch(() => setEngine({ mode: "web" }));
  }, []);

  const available = engine.mode === "desktop" && engine.info.available;

  // Event-Listener einmalig registrieren.
  useEffect(() => {
    if (!available) return;
    let unInfo: (() => void) | undefined;
    let unDone: (() => void) | undefined;
    let disposed = false;

    const flushInfo = () => {
      flushTimerRef.current = null;
      const pending = pendingInfoRef.current;
      pendingInfoRef.current = new Map();
      if (pending.size === 0) return;

      const newest = [...pending.values()].sort((a, b) => b.depth - a.depth)[0];
      const primary = pending.get(1);
      startTransition(() => {
        setLines((prev) => {
          const next = new Map(prev);
          pending.forEach((info, multipv) => next.set(multipv, info));
          return next;
        });
        if (newest?.nps != null) setNps(newest.nps);

        if (primary) {
          const currentFen = fenRef.current;
          const blackToMove = currentFen.split(" ")[1] === "b";
          const sign = blackToMove ? -1 : 1;
          const cp = primary.eval_cp != null ? sign * primary.eval_cp : null;
          const mate = primary.mate_in != null ? sign * primary.mate_in : null;
          const previousEval = lastEvalRef.current;
          if (
            !previousEval
            || previousEval.fen !== currentFen
            || previousEval.cp !== cp
            || previousEval.mate !== mate
          ) {
            lastEvalRef.current = { fen: currentFen, cp, mate };
            onEvalRef.current?.(cp, mate);
          }

          const uci = primary.pv[0] ?? null;
          const previousMove = lastBestMoveRef.current;
          if (!previousMove || previousMove.fen !== currentFen || previousMove.uci !== uci) {
            lastBestMoveRef.current = { fen: currentFen, uci };
            onBestMoveRef.current?.(uci);
          }
        }
      });
    };

    flushInfoRef.current = flushInfo;

    const enqueue = (info: LiveInfo) => {
      const previous = pendingInfoRef.current.get(info.multipv);
      if (!previous || info.depth >= previous.depth) {
        pendingInfoRef.current.set(info.multipv, info);
      }
      if (flushTimerRef.current == null) {
        flushTimerRef.current = setTimeout(flushInfo, ENGINE_UI_INTERVAL_MS);
      }
    };

    onEngineInfo((info) => {
      if (info.generation === genRef.current) {
        enqueue(info);
      } else if (genRef.current === -1) {
        // The native reader can beat the invoke response for very short
        // searches. Retain those values by generation; the analyze promise
        // below adopts only the exact generation it requested.
        const bucket = earlyInfoRef.current.get(info.generation) ?? new Map<number, LiveInfo>();
        const previous = bucket.get(info.multipv);
        if (!previous || info.depth >= previous.depth) bucket.set(info.multipv, info);
        earlyInfoRef.current.set(info.generation, bucket);
        while (earlyInfoRef.current.size > 4) {
          const oldest = earlyInfoRef.current.keys().next().value;
          if (oldest == null) break;
          earlyInfoRef.current.delete(oldest);
        }
      }
    }).then((u) => (disposed ? u() : (unInfo = u)));
    onEngineDone((done) => {
      if (done.generation === genRef.current) {
        if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
        flushInfo();
      }
    }).then((u) => (disposed ? u() : (unDone = u)));
    return () => {
      disposed = true;
      if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      pendingInfoRef.current.clear();
      earlyInfoRef.current.clear();
      flushInfoRef.current = () => {};
      unInfo?.();
      unDone?.();
    };
  }, [available]);

  // Bei Stellungswechsel (oder Start/Stopp) neu analysieren.
  useEffect(() => {
    if (!available) return;
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    pendingInfoRef.current.clear();
    earlyInfoRef.current.clear();
    // Bis analyzeLive die neue Generation liefert, keine Rest-Events der
    // vorherigen Stellung mehr annehmen.
    genRef.current = -1;
    lastEvalRef.current = null;
    lastBestMoveRef.current = null;
    setLines(new Map());
    setNps(null);
    onBestMoveRef.current?.(null);
    queueStop();
    if (!running) {
      return;
    }
    let stale = false;
    // Die laufende Suche sofort stoppen, den Neustart aber kurz entprellen.
    // Dadurch bleibt schnelles Ziehen flüssig und erzeugt keine Engine-Queue.
    const startTimer = setTimeout(() => {
      const next = engineCommandRef.current.then(async () => {
        if (stale) return;
        const generation = await analyzeLive(fen);
        if (stale) return;
        genRef.current = generation;
        const early = earlyInfoRef.current.get(generation);
        earlyInfoRef.current.clear();
        if (early) {
          early.forEach((info, multipv) => {
            const previous = pendingInfoRef.current.get(multipv);
            if (!previous || info.depth >= previous.depth) {
              pendingInfoRef.current.set(multipv, info);
            }
          });
          if (flushTimerRef.current == null) {
            flushTimerRef.current = setTimeout(
              () => flushInfoRef.current(),
              ENGINE_UI_INTERVAL_MS
            );
          }
        }
      });
      engineCommandRef.current = next.catch(() => {});
    }, ENGINE_START_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(startTimer);
    };
  }, [available, fen, queueStop, running]);

  // Beim Verlassen der Seite die Engine anhalten.
  useEffect(() => {
    return () => {
      if (available) queueStop();
    };
  }, [available, queueStop]);

  const blackToMove = fen.split(" ")[1] === "b";
  const ordered = [1, 2, 3]
    .map((i) => lines.get(i))
    .filter((l): l is LiveInfo => l != null);
  const depth = ordered[0]?.depth ?? 0;

  // Im Aufnahmelauf steht die Engine so da wie in der App · die Demo-Zeilen
  // sollen nicht als „nicht verbunden" im Store landen.
  const capture = isStoreCapture();
  const stand =
    engine.mode === "checking"
      ? "…"
      : available
        ? (engine as { info: EngineInfo }).info.name
        : capture
          ? "Stockfish 19"
          : t("eng.notConnected");
  const lit = available || capture;

  return (
    <section className={blatt ? "" : "rounded-xl border border-line bg-panel"}>
      {blatt ? (
        /* Die Rubrik des Blattes · Beschriftung auf kräftiger Linie, der Name
           der Engine rechts darin statt in einer Pille. */
        <header className="blatt-kolumne flex items-baseline justify-between gap-4 border-b border-ink pb-[5px] text-ink3">
          <span className="min-w-0 truncate">{t("eng.title")}</span>
          <span className="shrink-0 truncate">{stand}</span>
        </header>
      ) : (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink2">
            <Cpu size={15} className={lit ? "text-accent" : "text-ink3"} />
            {t("eng.title")}
          </h2>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
            style={{
              color: lit ? "var(--color-win)" : "var(--color-ink3)",
              background: lit ? "var(--color-accent-soft)" : "var(--color-panel2)",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: lit ? "var(--color-win)" : "var(--color-draw)" }}
            />
            {stand}
          </span>
        </header>
      )}

      <div className={blatt ? "pt-2.5" : "p-4"}>
        {available ? (
          <>
            <div className={`flex items-center justify-between ${blatt ? "mb-1" : "mb-3"}`}>
              <button
                onClick={() => setRunning((r) => !r)}
                className={
                  blatt
                    ? "inline-flex min-h-11 items-center gap-2 text-[12.5px] text-ink2 transition-colors hover:text-ink"
                    : "inline-flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] text-ink2 transition-colors hover:border-line2 hover:text-ink"
                }
              >
                {running ? <Pause size={13} /> : <Play size={13} />}
                {running ? t("eng.pause") : t("eng.analyze")}
              </button>
              <span
                className={`text-[11.5px] text-ink3 ${blatt ? "blatt-zahl" : "tabular-nums"}`}
              >
                {running && depth > 0
                  ? `${t("eng.depth", { d: depth })}${nps ? ` · ${t("eng.mnps", { x: (nps / 1_000_000).toFixed(1) })}` : ""}`
                  : running
                    ? t("eng.thinking")
                    : t("eng.paused")}
              </span>
            </div>

            <div className={blatt ? "flex flex-col" : "flex flex-col gap-2"}>
              {verdeckt ? (
                <div
                  className={
                    blatt
                      ? "border-b border-line py-[7px] text-[12px] text-ink3"
                      : "rounded-lg border border-dashed border-line2 px-3 py-4 text-center text-[12px] text-ink3"
                  }
                >
                  {t("eng.hiddenForRetry")}
                </div>
              ) : ordered.length > 0
                ? ordered.map((l) => (
                    <EngineLineCard
                      key={l.multipv}
                      blackToMove={blackToMove}
                      depthLabel={t("eng.depth", { d: l.depth })}
                      info={l}
                      line={pvToSan(fen, l.pv)}
                      onMove={onMove}
                      blatt={blatt}
                    />
                  ))
                : running && (
                    <div
                      className={
                        blatt
                          ? "border-b border-line py-[7px] text-[12px] text-ink3"
                          : "rounded-lg border border-dashed border-line2 px-3 py-4 text-center text-[12px] text-ink3"
                      }
                    >
                      {t("eng.calculating")}
                    </div>
                  )}
            </div>
          </>
        ) : (
          <>
            <div className={blatt ? "flex flex-col" : "flex flex-col gap-2.5"}>
              {demoLines.map((l, i) =>
                blatt ? (
                  <div key={i} className="flex items-baseline gap-2.5 border-b border-line py-[7px]">
                    <span className="blatt-zahl w-[46px] shrink-0 text-[13px] font-medium text-accent">
                      {l.eval}
                    </span>
                    <span className="buch notation min-w-0 flex-1 truncate text-[13px] leading-[1.5] text-ink2">
                      {l.line}
                    </span>
                    <span className="blatt-zahl shrink-0 text-[10.5px] text-ink3">
                      {t("eng.depth", { d: l.depth })}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="rounded-lg border border-line bg-panel2 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-semibold text-accent">{l.eval}</span>
                      <span className="text-[11px] text-ink3">{t("eng.depth", { d: l.depth })}</span>
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-ink2">{l.line}</div>
                  </div>
                )
              )}
            </div>
            {!capture && (
              <p
                className={`text-[11.5px] leading-relaxed text-ink3 ${
                  blatt ? "mt-2.5" : "mt-3 border-t border-line pt-3"
                }`}
              >
                {engine.mode === "web" ? t("eng.webHint") : t("eng.notFound")}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
