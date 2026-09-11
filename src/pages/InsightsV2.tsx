import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  Clock,
  Gauge,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useMobileShell } from "../components/MobileShell";
import { PlusLock } from "../components/PlusLock";
import { usePlusGate } from "../lib/plus/usePlus";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { listGameSummaries, type GameSummary } from "../lib/db";
import { errorStats, type PhaseErrors } from "../lib/analysis";
import { puzzleInsights, type PuzzleInsights } from "../lib/puzzles";
import { buildInsights } from "../lib/stats";
import { deepInsights, type DeepInsights } from "../lib/insights";
import { buildDna, weakestAxis } from "../lib/dna";
import {
  buildFindings,
  findingsFor,
  localizeFindingParams,
  type Finding,
  type FindingTab,
} from "../lib/findings";
import { de, deInt } from "../lib/format";
import { useDiagramMode } from "../lib/diagramMode";
import { Befund } from "../components/blatt/Befund";
import { Rubrik } from "../components/blatt/Satz";

/** Das Profil kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const InsightsBlatt = lazy(() => import("./blatt/InsightsBlatt"));
// Die fünf Tiefenreiter im Modus · jeder lädt erst, wenn er aufgeschlagen
// wird. Der Dashboard-Modus zahlt für keinen von ihnen.
const StrengthBlatt = lazy(() => import("./blatt/insights/StrengthBlatt"));
const TimeBlatt = lazy(() => import("./blatt/insights/TimeBlatt"));
const OpeningsBlatt = lazy(() => import("./blatt/insights/OpeningsBlatt"));
const PatternsBlatt = lazy(() => import("./blatt/insights/PatternsBlatt"));
const TrainingBlatt = lazy(() => import("./blatt/insights/TrainingBlatt"));
import { usePageMemory } from "../lib/pageMemory";
import type { PageId } from "../App";
import Overview from "./insights/Overview";
import Strength from "./insights/Strength";
import Time from "./insights/Time";
import Openings from "./insights/Openings";
import Patterns from "./insights/Patterns";
import Training from "./insights/Training";
import {
  DEMO_ERRORS,
  DEMO_RECORDS,
  demoDeepInsights,
  demoPuzzleInsights,
} from "./insights/demo";

type InsightTab = "overview" | FindingTab;

const TABS: { id: InsightTab; key: Key; icon: typeof Gauge }[] = [
  { id: "overview", key: "ins.tabOverview", icon: Gauge },
  { id: "strength", key: "ins.tabStrength", icon: BarChart3 },
  { id: "time", key: "ins.tabTime", icon: Clock },
  { id: "openings", key: "ins.tabOpenings", icon: BookOpen },
  { id: "patterns", key: "ins.tabPatterns", icon: CalendarClock },
  { id: "training", key: "ins.tabTraining", icon: GraduationCap },
];

export default function InsightsV2({
  go,
  openPuzzles,
  openAnalysis,
  openRepertoire,
  openEndgame,
}: {
  go: (page: PageId) => void;
  openPuzzles: (theme?: string) => void;
  openAnalysis: (gameId: number) => void;
  /**
   * Repertoire und Endspiele hängen unter dem Training · von hier aus sind sie
   * trotzdem eine Detailebene, sonst führte der Zurück-Pfeil nach dem Absprung
   * aus einem Befund auf den Start statt zurück auf den Befund.
   */
  openRepertoire?: () => void;
  openEndgame?: () => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const desktop = backend.mode === "desktop";
  const diagramMode = useDiagramMode();

  // Der Reiter übersteht einen Absprung in die Puzzles oder ins Repertoire ·
  // ohne ihn käme man zwar an derselben Scroll-Position, aber auf einer anderen
  // Seite heraus. Beim Tabwechsel ist er vergessen (siehe lib/pageMemory).
  const [tab, setTab] = usePageMemory<InsightTab>("insights.tab", "overview");
  const deepGate = usePlusGate("full_insights");
  const [records, setRecords] = useState<GameSummary[]>([]);
  const [errors, setErrors] = useState<PhaseErrors[]>([]);
  const [deep, setDeep] = useState<DeepInsights | null>(null);
  const [puzzles, setPuzzles] = useState<PuzzleInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listGameSummaries().catch(() => [] as GameSummary[]),
      errorStats().catch(() => [] as PhaseErrors[]),
      // Die Tiefenanalyse läuft über die Zugebene · sie darf ruhig eine Sekunde
      // brauchen, aber sie darf die Seite nicht blockieren.
      deepInsights().catch(() => null),
    ]).then(([nextRecords, nextErrors, nextDeep]) => {
      if (cancelled) return;
      setRecords(nextRecords);
      setErrors(nextErrors);
      setDeep(nextDeep);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  // Die Puzzle-Detailauswertung erst holen, wenn der Reiter geöffnet wird.
  useEffect(() => {
    if (!desktop || tab !== "training" || puzzles) return;
    let cancelled = false;
    puzzleInsights()
      .then((next) => !cancelled && setPuzzles(next))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktop, tab, puzzles]);

  const analysisRecords = desktop ? records : DEMO_RECORDS;
  const live = useMemo(() => buildInsights(analysisRecords, locale), [analysisRecords, locale]);
  const deepData = useMemo(() => (desktop ? deep : demoDeepInsights()), [desktop, deep]);
  const puzzleData = desktop ? puzzles : demoPuzzleInsights();
  const analysisErrors = desktop ? errors : DEMO_ERRORS;

  const dna = useMemo(
    () => (deepData ? buildDna(deepData, live) : []),
    [deepData, live]
  );
  // Die Befunde rechnen über das Fenster (das steckt in `buildFindings`), die
  // Reiter über die ganze Historie · die Frage „woran arbeite ich jetzt" hätte
  // sonst für jeden mit langer Historie auf Jahre dieselbe Antwort.
  const findings = useMemo(
    () => (deepData ? buildFindings(deepData, live) : []),
    [deepData, live]
  );

  const toRepertoire = () => (openRepertoire ? openRepertoire() : go("repertoire"));

  const onAction = (finding: Finding) => {
    switch (finding.action?.kind) {
      case "repertoire":
        toRepertoire();
        break;
      case "puzzles":
        openPuzzles(finding.action.theme);
        break;
      case "endgame":
        if (openEndgame) openEndgame();
        else go("endgame");
        break;
      case "analysis":
        go("analysis");
        break;
      case "games":
        go("games");
        break;
    }
  };

  const subtitle = deepData
    ? t("ins.subtitleDeep", { n: deInt(live.totalGames) })
    : t("common.loading");

  // ── Das Profil ────────────────────────────────────────────────────────────
  //
  // Dieselben Daten, andere Form: Aus dem Netz werden gestapelte Skalen, aus
  // der Reiterleiste ein Register. Die fünf Tiefenreiter haben ihre eigene
  // Fassung in `blatt/insights/` · aus den aufklappbaren Abschnitten werden
  // dort Rubriken mit Linie.
  //
  // Solange die Zahlen fehlen, bleibt die Seite leer, statt einen Augenblick
  // in ihrer gewöhnlichen Fassung zu stehen · siehe LeereSeite.tsx.
  if (diagramMode && (loading || !deepData)) return <LeereSeite />;
  if (diagramMode && !loading && deepData) {
    const monate = deepData.progress.months;
    const befundListe = findings.slice(0, 3);
    /**
     * Die Befunde eines Tiefenreiters · in der gewöhnlichen Fassung stehen
     * sie als Streifen über der Seite, im Blatt als Rubrik mit Rangzahl.
     * Ohne Befund steht dort nichts: Eine leere Rubrik ist kein Abschnitt.
     */
    const reiterBefunde = (id: InsightTab) => {
      // Drei · so viele zeigt auch der Befundstreifen der gewöhnlichen
      // Fassung. Alle stehen weiterhin auf der Übersicht.
      const liste = findingsFor(findings, id as FindingTab).slice(0, 3);
      if (liste.length === 0) return null;
      return (
        <div className="mb-5">
          <Rubrik>{t("blatt.strongestFindings")}</Rubrik>
          <div className="mt-0.5">
            {liste.map((finding, index) => {
              const params = localizeFindingParams(finding.params, t, locale);
              return (
                <Befund
                  key={finding.id}
                  titel={t(finding.titleKey, params)}
                  text={t(finding.bodyKey, params)}
                  schwere={finding.severity}
                  ton={finding.tone}
                  letzte={index === liste.length - 1}
                  onClick={finding.action ? () => onAction(finding) : undefined}
                />
              );
            })}
          </div>
        </div>
      );
    };
    return (
      <Suspense fallback={<LeereSeite />}>
        <InsightsBlatt
          mobile={mobile}
          kopfRechts={subtitle}
          reiter={TABS.map(({ id, key }) => ({
            id,
            name: t(key),
            plus: id !== "overview" && !deepGate.unlocked && !deepGate.pending,
          }))}
          aktiv={tab}
          onReiter={(id) => setTab(id as InsightTab)}
          felder={[
            {
              label: t("nav.games"),
              wert: (
                <>
                  <span className="blatt-zahl">{deInt(live.totalGames)}</span>{" "}
                  {t("blatt.inTheDatabase")}
                </>
              ),
              gross: true,
            },
            {
              label: t("ins.scoreRate"),
              wert: <span className="blatt-zahl">{de(live.scoreRate)} %</span>,
            },
            {
              label: t("ins.avgAccuracy"),
              wert:
                live.avgAccuracy != null ? (
                  <span className="blatt-zahl">{de(live.avgAccuracy)} %</span>
                ) : (
                  "—"
                ),
            },
            {
              label: t("ins.form20"),
              wert: <span className="blatt-zahl">{de(live.recentForm.scorePct)} %</span>,
            },
          ]}
          schwaechste={
            dna.length > 0 ? t(`dna.${weakestAxis(dna)?.key ?? "tactics"}` as Key) : "—"
          }
          dna={dna.map((axis) => ({
            name: t(`dna.${axis.key}` as Key),
            wert: axis.value,
            feld: axis.field,
          }))}
          dnaNote={t("dna.note")}
          grundlage={[
            {
              name: t("nav.games"),
              wert: deInt(live.totalGames),
              neben: t("blatt.analysedShort", { p: de(live.analysisCoverage) }),
            },
            {
              name: t("ins.avgAccuracy"),
              wert: live.avgAccuracy != null ? `${de(live.avgAccuracy)} %` : "—",
              neben: t("ins.scoreRate"),
            },
          ]}
          // Der Kurzbericht · dieselben zwei Sätze und dieselben drei Zahlen
          // wie in der gewöhnlichen Übersicht (siehe insights/Overview.tsx).
          bericht={{
            text: t("ins.reportBody", {
              n: deInt(live.totalGames),
              p: de(live.scoreRate),
              acc: live.avgAccuracy == null ? "—" : de(live.avgAccuracy),
            }),
            fokus: (() => {
              const schwach = weakestAxis(dna);
              return schwach
                ? t("ins.reportFocus", {
                    axis: t(`dna.${schwach.key}` as Key),
                    v: schwach.value,
                    detail: schwach.detail,
                  })
                : null;
            })(),
            deckung: [
              { name: t("ins.covAnalyzed"), wert: deInt(deepData.coverage.analyzed) },
              { name: t("ins.covClocks"), wert: deInt(deepData.coverage.with_clocks) },
              { name: t("ins.covMoves"), wert: deInt(deepData.coverage.moves_judged) },
            ],
          }}
          schluesselmoment={
            deepData.spotlight
              ? {
                  text: t(
                    deepData.spotlight.kind === "missed_win"
                      ? "ins.spotlightMissedWin"
                      : "ins.spotlightCollapse",
                    {
                      m: de(deepData.spotlight.magnitude),
                      move: Math.ceil(deepData.spotlight.ply / 2),
                    }
                  ),
                  weg: t("ins.spotlightOpen"),
                  onWeg: () => openAnalysis(deepData.spotlight!.game_id),
                }
              : undefined
          }
          phasen={live.phaseAccuracy.map((phase) => ({
            name: t(`ins.phase.${phase.phase}` as Key),
            wert: phase.accuracy != null ? `${de(phase.accuracy)} %` : "—",
            neben: t("blatt.gamesN", { n: deInt(phase.games) }),
          }))}
          befunde={
            befundListe.length > 0 ? (
              befundListe.map((finding, index) => {
                const params = localizeFindingParams(finding.params, t, locale);
                return (
                  <Befund
                    key={finding.id}
                    titel={t(finding.titleKey, params)}
                    text={t(finding.bodyKey, params)}
                    schwere={finding.severity}
                    ton={finding.tone}
                    letzte={index === befundListe.length - 1}
                    onClick={finding.action ? () => onAction(finding) : undefined}
                  />
                );
              })
            ) : (
              <div className="py-3 text-[12.5px] text-ink3">{t("ins.noGames")}</div>
            )
          }
          genauigkeit={monate
            .map((month) => month.accuracy)
            .filter((value): value is number => value != null)}
          patzer={monate
            .map((month) => month.blunders_per_100)
            .filter((value): value is number => value != null)}
          kurvenNote={t("blatt.curvesNote")}
          monateNote={t("blatt.monthsNote")}
          kinder={
            tab === "overview" ? undefined : (
              <PlusLock feature="full_insights">
                {/* Die Befunde des Reiters stehen auch im Blatt oben · der
                    Modus ändert die Darstellung und darf keinen Weg kosten. */}
                {reiterBefunde(tab)}
                {tab === "strength" && (
                  <StrengthBlatt
                    mobile={mobile}
                    deep={deepData}
                    live={live}
                    errors={analysisErrors}
                  />
                )}
                {tab === "time" && <TimeBlatt mobile={mobile} deep={deepData} />}
                {tab === "openings" && (
                  <OpeningsBlatt
                    mobile={mobile}
                    deep={deepData}
                    live={live}
                    desktop={desktop}
                    onOpenRepertoire={toRepertoire}
                  />
                )}
                {tab === "patterns" && (
                  <PatternsBlatt mobile={mobile} deep={deepData} live={live} />
                )}
                {tab === "training" && (
                  <TrainingBlatt
                    mobile={mobile}
                    desktop={desktop}
                    deep={deepData}
                    puzzles={puzzleData}
                  />
                )}
              </PlusLock>
            )
          }
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("ins.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{subtitle}</p>
      </header>

      {/* Sechs Reiter passen mobil in zwei Reihen zu dritt · quer scrollende
          Leisten verstecken genau die Reiter, die niemand findet. */}
      <nav
        className={`mb-5 rounded-xl border border-line bg-panel p-1 ${
          mobile ? "grid grid-cols-3 gap-1" : "flex gap-1"
        }`}
        aria-label={t("ins.sections")}
        data-tour="insights-tabs"
      >
        {TABS.map(({ id, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex items-center justify-center rounded-lg font-medium transition-colors ${
              mobile
                ? "min-w-0 flex-col gap-1 px-1 py-2 text-[11.5px]"
                : "min-w-fit flex-1 gap-2 px-3 py-2.5 text-[12.5px]"
            } ${tab === id ? "bg-panel3 text-ink shadow-sm" : "text-ink3 hover:bg-panel2 hover:text-ink2"}`}
          >
            <Icon size={14} className={`shrink-0 ${tab === id ? "text-accent" : ""}`} />
            {/* Beschriftung und Sternchen bleiben eine Zeile · mobil stehen die
                Reiter sonst dreistöckig da, und das Sternchen sähe aus wie eine
                eigene Angabe statt wie eine Marke am Namen. */}
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <span className="truncate">{t(key)}</span>
              {id !== "overview" && !deepGate.unlocked && !deepGate.pending && (
                <Sparkles size={11} className="shrink-0 text-accent" />
              )}
            </span>
          </button>
        ))}
      </nav>

      {desktop && loading && (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-10 text-center text-[12.5px] text-ink3">
          {t("ins.loadingDeep")}
        </div>
      )}

      {desktop && !loading && records.length === 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-3 text-[12.5px] text-ink3">
          {t("ins.noGames")}
        </div>
      )}

      {!loading && deepData && (
        <>
          {tab === "overview" && (
            <Overview
              deep={deepData}
              live={live}
              dna={dna}
              findings={findings}
              onAction={onAction}
              onOpenGame={(gameId) => openAnalysis(gameId)}
            />
          )}
          {/* Die Übersicht ist die grundlegende Statistik und bleibt frei.
              Die fünf Tiefenseiten sind „Vollständige Insights" · gesperrt
              stehen sie als Vorschau da, nicht als leere Seite. */}
          {tab !== "overview" && (
            <PlusLock feature="full_insights">
              {tab === "strength" && (
                <Strength
                  deep={deepData}
                  live={live}
                  errors={analysisErrors}
                  findings={findingsFor(findings, "strength")}
                  onAction={onAction}
                />
              )}
              {tab === "time" && (
                <Time deep={deepData} findings={findingsFor(findings, "time")} onAction={onAction} />
              )}
              {tab === "openings" && (
                <Openings
                  deep={deepData}
                  live={live}
                  findings={findingsFor(findings, "openings")}
                  onAction={onAction}
                  desktop={desktop}
                  onOpenRepertoire={toRepertoire}
                />
              )}
              {tab === "patterns" && (
                <Patterns
                  deep={deepData}
                  live={live}
                  findings={findingsFor(findings, "patterns")}
                  onAction={onAction}
                />
              )}
              {tab === "training" && (
                <Training
                  deep={deepData}
                  puzzles={puzzleData}
                  findings={findingsFor(findings, "training")}
                  onAction={onAction}
                  desktop={desktop}
                />
              )}
            </PlusLock>
          )}
        </>
      )}

      {!loading && !deepData && desktop && (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-10 text-center text-[12.5px] text-ink3">
          {t("ins.deepFailed")}
        </div>
      )}
    </div>
  );
}
