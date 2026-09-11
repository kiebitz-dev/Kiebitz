import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Cpu,
  Crown,
  Flame,
  Gauge,
  Lightbulb,
  Puzzle as PuzzleIcon,
  Timer,
} from "lucide-react";
import { useBackendInfo } from "../lib/backend";
import { isoDay } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { listGameSummaries, type GameSummary } from "../lib/db";
import { puzzleInsights, type PuzzleInsights } from "../lib/puzzles";
import {
  applyWeekPlan,
  completeStudyUnit,
  eventMinutes,
  getStudyCalendar,
  studyData,
  templateAreas,
  templateText,
  trainingProgram,
  AREA_COLOR,
  AREA_KEY,
  AREAS,
  AREA_SOFT,
  type Area,
  type StudyData,
  type StudyEvent,
  type StudyTemplate,
  type TrainingProgram,
} from "../lib/study";
import { getSettings, trainingDayList } from "../lib/settings";
import { buildInsights } from "../lib/stats";
import {
  deepInsights,
  studyMetrics,
  type FindingWindow,
  type MetricWindow,
} from "../lib/insights";
import { buildFindings, localizeFindingParams, type Finding } from "../lib/findings";
import { useDiagramMode } from "../lib/diagramMode";
import { Befund } from "../components/blatt/Befund";

/** Der Coach kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const StudyBlatt = lazy(() => import("./blatt/StudyBlatt"));
import {
  buildPlan,
  buildWeekPlan,
  sessionMinutes,
  type PlannedUnit,
  type Prescription,
  type TrainingPlan,
} from "../lib/plan";
import { measureRating, type RatingEffect } from "../lib/effect";
import { buildWeekBudget, lastWeekDeficit, weekStartOf, type WeekBudget } from "../lib/week";
import {
  areaRuns,
  buildWeeklyReport,
  markWeeklyReportSeen,
  previousWeek,
  reportWeek,
  weeklyReportSeen,
  weeklyReportSeenStored,
  type AreaRun,
  type WeeklyReport,
} from "../lib/weekly";
import { Button, Card } from "../components/ui";
import { PlusBadge } from "../components/PlusLock";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import StudyPlanner from "../components/StudyPlanner";
import PrescriptionCard from "../components/PrescriptionCard";
import WeeklyReportDialog, { WeeklyReportButton } from "../components/WeeklyReportDialog";
import WeekBudgetBar, {
  WeekAreaList,
  WeekBar,
  WeekNote,
} from "../components/WeekBudgetBar";
import WindowNote from "../components/WindowNote";
import TodaySession, {
  SessionHero,
  SessionList,
  type SessionItem,
} from "../components/TodaySession";
import { useMobileShell } from "../components/MobileShell";
import { onDataChange } from "../lib/changes";
import { dateLocale, deInt } from "../lib/format";
import { isStoreCapture } from "../lib/storeCapture";
import { DEMO_PLAN_STATE } from "./studyDemo";
import { ENDGAME_TYPE_CATEGORY, type EndgameCategory } from "../data/endgames";
import type { PageId } from "../App";

const DAY = 86_400;

export interface StudyState {
  data: StudyData | null;
  program: TrainingProgram | null;
  plan: TrainingPlan | null;
  findings: Finding[];
  /** Zeitraum, aus dem die Befunde stammen · steht unter dem Coach. */
  window: FindingWindow;
  templates: StudyTemplate[];
  /** Geplante Einheiten der nächsten sieben Tage, ab heute. */
  events: StudyEvent[];
  rating: RatingEffect | null;
  /** Rückblick auf die zuletzt abgeschlossene Woche · null, wenn sie leer war. */
  weekly: WeeklyReport | null;
  /** Trainingstage aus den Einstellungen, Index 0 = Montag. */
  trainingDays: boolean[];
  /** Beobachtetes Wochenmittel der letzten acht Wochen. */
  observedWeeklyMinutes: number;
  /** Steht ein Wochenbudget in den Einstellungen? */
  budgetSet: boolean;
}

export default function Study({
  go,
  openPuzzles,
  openEndgame,
}: {
  go: (p: PageId) => void;
  openPuzzles: (theme?: string, band?: { minRating?: number; maxRating?: number }) => void;
  openEndgame?: (category?: EndgameCategory) => void;
}) {
  const backend = useBackendInfo();
  // Mobil ist diese Seite auch der Einstieg zu Repertoire, Puzzles und
  // Endspielen · am Desktop stehen die in der Sidebar.
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";
  const storeCapture = isStoreCapture();

  const [state, setState] = useState<StudyState | null>(null);
  const [planning, setPlanning] = useState<PlannedUnit[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** Die Wochenzahlen mobil · zugeklappt ist die Karte eine Zeile. */
  const [weekOpen, setWeekOpen] = useState(false);
  /**
   * Gelesene Berichtswoche · der Merker liegt im WebView-Speicher und wird hier
   * nur gespiegelt, damit das Öffnen sofort auf das Symbol durchschlägt und
   * nicht erst beim nächsten Laden der Seite.
   */
  const [reportSeen, setReportSeen] = useState(0);
  /** Liegt der Bericht gerade im Vordergrund? */
  const [reportOpen, setReportOpen] = useState(false);
  const planGate = usePlusGate("adaptive_plan");

  const loadRef = useRef<Promise<void> | null>(null);
  const loadFresh = useCallback(async () => {
    // Bewusst hier und nicht aus dem Render-Scope: `load` hängt an einem
    // Änderungs-Abo und läuft womöglich Stunden später erneut. Mit einem
    // eingefrorenen Zeitpunkt endete das Messfenster beim Öffnen der Seite, und
    // genau die Partien, die seither dazukamen, fehlten in der Messung.
    const now = Math.floor(Date.now() / 1000);
    const [data, program, records, deep, puzzles, settings] = await Promise.all([
      studyData().catch(() => null),
      trainingProgram().catch(() => null),
      listGameSummaries().catch(() => [] as GameSummary[]),
      deepInsights().catch(() => null),
      puzzleInsights().catch(() => null as PuzzleInsights | null),
      getSettings().catch(() => null),
    ]);
    const live = buildInsights(records, locale);
    const findings = deep ? buildFindings(deep, live) : [];
    const trainingDays = trainingDayList(settings?.training_days ?? 0);
    const plan =
      deep && settings
        ? buildPlan({
            deep,
            live,
            findings,
            puzzles,
            program,
            weeklyMinutes: settings.weekly_minutes,
            trainingDays,
          })
        : null;

    // Die Ratingveränderung im selben Zeitraum, aus dem auch die Befunde
    // kommen. Ohne Fenster (zu wenig Material) gibt es keine Zahl: „+140 Elo
    // seit 2021" beantwortet keine Frage, die auf dieser Seite gestellt wird.
    const findingWindow = deep?.window ?? { days: 0, from_ts: 0, games: 0, analyzed: 0 };

    // Alle Fenster in einem Aufruf: das Befundfenster für den Ratingstand oben,
    // die zwei abgeschlossenen Wochen des Berichts und je eine Woche vor einer
    // laufenden Serie. Der Backend-Befehl geht die Datenbank je Aufruf einmal
    // komplett durch · getrennt gefragt wäre es dieselbe Runde mehrfach.
    const week = reportWeek(new Date());
    const before = previousWeek(week);
    const specs: { from_ts: number; to_ts: number }[] = [];
    const ratingSpec =
      findingWindow.days > 0
        ? specs.push({ from_ts: findingWindow.from_ts, to_ts: now + 1 }) - 1
        : -1;
    const weekSpec = specs.push({ from_ts: week.start, to_ts: week.end }) - 1;
    const beforeSpec = specs.push({ from_ts: before.start, to_ts: before.end }) - 1;
    // Die Serien stehen in den gemessenen Tagen, die längst geladen sind ·
    // gebraucht wird nur noch die Woche vor jeder Serie als Vergleichsbasis
    // (siehe `areaRuns` in lib/weekly.ts).
    const runs = program ? areaRuns(program.days, week) : [];
    const runSpecs = runs.map(
      (run) => specs.push({ from_ts: run.before.start, to_ts: run.before.end }) - 1
    );
    const measured = await studyMetrics(specs).catch(() => [] as MetricWindow[]);

    // Der Wochenbericht braucht beide Fenster und die gemessenen Tage · fehlt
    // eines davon, gibt es keinen. Ein Rückblick auf halbe Daten wäre schlimmer
    // als keiner.
    const weekly =
      measured[weekSpec] && measured[beforeSpec] && program
        ? buildWeeklyReport({
            week,
            metrics: measured[weekSpec],
            previous: measured[beforeSpec],
            days: program.days,
            allocation: plan?.allocation ?? [],
            prescriptions: plan?.prescriptions ?? [],
            runs: runs
              .map((run, index) => ({ run, before: measured[runSpecs[index]] }))
              .filter(
                (entry): entry is { run: AreaRun; before: MetricWindow } => entry.before != null
              ),
          })
        : null;

    // Die nächsten sieben Tage, nicht nur heute: der Tagesplan ist ein
    // Ausschnitt davon, und der Wochenvorschlag muss wissen, was in diesem
    // Fenster schon geplant ist.
    const today = new Date();
    const windowEnd = new Date(today.getTime() + 6 * DAY * 1_000);
    const calendar = await getStudyCalendar(isoDay(today), isoDay(windowEnd)).catch(() => ({
      templates: [] as StudyTemplate[],
      events: [] as StudyEvent[],
      days: [],
    }));

    setState({
      data,
      program,
      plan,
      findings,
      window: findingWindow,
      templates: calendar.templates,
      events: calendar.events,
      rating: ratingSpec >= 0 && measured[ratingSpec] ? measureRating([measured[ratingSpec]]) : null,
      weekly,
      trainingDays,
      observedWeeklyMinutes: program?.observed_weekly_minutes ?? 0,
      budgetSet: (settings?.weekly_minutes ?? 0) > 0,
    });
  }, [locale]);

  const load = useCallback(() => {
    if (loadRef.current) return loadRef.current;
    const request = loadFresh().finally(() => {
      if (loadRef.current === request) loadRef.current = null;
    });
    loadRef.current = request;
    return request;
  }, [loadFresh]);

  useEffect(() => {
    if (!desktop) {
      setState(DEMO_PLAN_STATE(locale));
      return;
    }
    load().catch(() => setState(null));
    return onDataChange(() => {
      load().catch(() => {});
    }, ["games", "analysis", "puzzles", "endgame", "repertoire", "study", "database"]);
  }, [desktop, load, locale]);

  const plan = state?.plan ?? null;
  const data = state?.data ?? null;

  // ── Woche ──────────────────────────────────────────────────────────────────

  const weekStart = useMemo(() => weekStartOf(new Date()), []);
  const week: WeekBudget | null = useMemo(
    () =>
      state?.program && plan
        ? buildWeekBudget(state.program.days, plan.allocation, weekStart, new Date())
        : null,
    [state, plan, weekStart]
  );

  /**
   * Was in den nächsten sieben Tagen von Hand geplant und noch offen ist.
   *
   * Nur eigene Einheiten: die Termine früherer Vorschläge räumt der nächste
   * Vorschlag selbst weg, sie dürfen den Bedarf deshalb nicht senken.
   * Mehrbereichs-Einheiten teilen ihre Minuten unter ihren Bereichen auf.
   */
  const plannedMinutes = useMemo(() => {
    const out: Partial<Record<Area, number>> = {};
    for (const event of state?.events ?? []) {
      if (event.source === "plan" || event.completed || event.auto_done) continue;
      const areas = templateAreas(event.template);
      if (areas.length === 0) continue;
      const share = eventMinutes(event) / areas.length;
      for (const area of areas) out[area] = (out[area] ?? 0) + share;
    }
    return out;
  }, [state]);

  const proposePlan = () => {
    if (!plan || !state?.program || !week) return;
    // `due_week[0]` bedeutet heute. Die alte Verankerung am Montag verschob
    // diese Fälligkeiten mitten in der Woche rückwärts auf vergangene Tage.
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    setPlanning(
      buildWeekPlan({
        // Ziel und gemessenes Ist derselben Woche, die oben auf der Seite
        // steht · der Vorschlag plant genau die Lücke dazwischen.
        week: week.byArea,
        templates: state.templates,
        dueWeek: data?.due_week ?? [],
        trainingDayMask: state.trainingDays,
        startDay: firstDay,
        // Was die Vorwoche schuldig blieb, kommt oben drauf; was von Hand
        // schon im Kalender steht, wird abgezogen.
        carryOver: lastWeekDeficit(state.program.days, plan.allocation, weekStart, today),
        planned: plannedMinutes,
      })
    );
  };

  const applyPlan = async () => {
    if (!planning || !desktop) return;
    setBusy(true);
    try {
      const first = isoDay(new Date());
      const last = isoDay(new Date(Date.now() + 6 * DAY * 1_000));
      await applyWeekPlan(
        first,
        last,
        planning.map((unit) => ({
          template_id: unit.templateId,
          day: unit.day,
          planned_min: unit.minutes,
        }))
      );
      setPlanning(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Vorgeschlagene Länge einer von Hand geplanten Einheit.
   *
   * Sie kommt aus derselben Rechnung wie der Vorschlag: die offene Lücke der
   * gewählten Bereiche, verteilt auf die verbleibenden Trainingstage. Damit
   * muss niemand mehr eine Dauer eintippen, die Kiebitz ohnehin misst.
   */
  const suggestMinutes = useCallback(
    (areas: Area[]) => {
      if (!week || areas.length === 0) return 0;
      const dayCount = Math.max(1, plan?.trainingDayCount ?? 7);
      const perDay = areas.reduce((sum, area) => {
        const entry = week.byArea.find((candidate) => candidate.area === area);
        if (!entry) return sum;
        return sum + (entry.gap > 0 ? entry.gap : entry.target) / dayCount;
      }, 0);
      return sessionMinutes(perDay);
    },
    [week, plan]
  );

  // ── Tagesplan ──────────────────────────────────────────────────────────────

  const dose = plan?.dose ?? null;

  /** Icon und Sprungziel je Bereich · dasselbe wie in den Fokuskarten. */
  const areaAction = useCallback(
    (
      area: Area
    ): { icon: typeof BookOpen; label: string; heroLabel: string; run: () => void } => {
      switch (area) {
        case "tactics":
          return {
            icon: PuzzleIcon,
            label: t("dash.solve"),
            heroLabel: t("st.toPuzzles"),
            run: () =>
              openPuzzles(
                dose?.theme,
                dose ? { minRating: dose.minRating, maxRating: dose.maxRating } : undefined
              ),
          };
        case "openings":
          return {
            icon: BookOpen,
            label: t("dash.train"),
            heroLabel: t("st.toRepertoire"),
            run: () => go("repertoire"),
          };
        case "endgames":
          return {
            icon: Crown,
            label: t("dash.train"),
            heroLabel: t("st.toEndgame"),
            run: () => (openEndgame ? openEndgame() : go("endgame")),
          };
        case "analysis":
          return {
            icon: Cpu,
            label: t("dash.start"),
            heroLabel: t("st.toAnalysis"),
            run: () => go("analysis"),
          };
        default:
          // Gespielt wird außerhalb von Kiebitz · das Dashboard hält die
          // Absprünge zu chess.com und Lichess bereit.
          return {
            icon: Timer,
            label: t("st.sessionPlay"),
            heroLabel: t("st.sessionPlay"),
            run: () => go("dashboard"),
          };
      }
    },
    [t, go, openPuzzles, openEndgame, dose]
  );

  /** Die Endspielzeit der laufenden Woche · Statuszeile der mobilen Kachel. */
  const endgameWeek = useMemo(
    () => week?.byArea.find((entry) => entry.area === "endgames" && entry.target > 0) ?? null,
    [week]
  );

  /**
   * Eine geplante Einheit von Hand abhaken · und wieder öffnen.
   *
   * Die gemessene Zeit erfüllt Einheiten von selbst; das Häkchen ist für das,
   * was außerhalb von Kiebitz passiert ist — eine Partie am Brett, ein Buch.
   * Was ohnehin täglich anfällt (Wiederholungen, Tagesdosis, Analyse-Rückstand)
   * bekommt keins: dort wäre es eine Behauptung gegen die eigene Messung.
   */
  const toggleUnit = useCallback(
    async (event: StudyEvent) => {
      if (!desktop) return;
      try {
        await completeStudyUnit(event.id, !event.completed);
      } finally {
        await load();
      }
    },
    [desktop, load]
  );

  /**
   * Die Sitzung für heute: erst die geplanten Einheiten in ihrer Reihenfolge,
   * darunter das, was ohne Plan täglich anfällt und noch offen ist.
   */
  const todayIso = isoDay(new Date());
  const sessionItems = useMemo<SessionItem[]>(() => {
    const items: SessionItem[] = [];
    for (const event of (state?.events ?? []).filter((entry) => entry.day === todayIso)) {
      // Bei mehreren Bereichen führt der erste in den Trainer · er steht auch
      // als Erster im Editor und ist damit der, den der Nutzer gemeint hat.
      const area = templateAreas(event.template)[0] ?? null;
      const done = event.completed || event.auto_done;
      const action = area ? areaAction(area) : null;
      // Für Taktik trägt die Dosis das Band und das Motiv · sonst steht dort
      // die Beschreibung der Einheit.
      const detail =
        area === "tactics" && dose
          ? t(dose.theme ? "plan.dosePuzzlesTheme" : "plan.dosePuzzles", {
              n: deInt(dose.perDay),
              lo: deInt(dose.minRating),
              hi: deInt(dose.maxRating),
              theme: dose.theme
                ? localizeFindingParams({ theme: dose.theme }, t, locale).theme
                : "",
            })
          : templateText(event.template, "desc", t) || templateText(event.template, "tool", t);
      items.push({
        id: `event-${event.id}`,
        area,
        icon: action?.icon ?? Lightbulb,
        label: templateText(event.template, "title", t),
        detail: String(detail),
        dose: String(detail),
        // Woher die Einheit kommt · sie steht im Kalender, im Gegensatz zu
        // dem, was ohnehin jeden Tag anfällt.
        meta: `${t("plan.minutes", { m: deInt(eventMinutes(event)) })} · ${t("st.fromWeekPlan")}`,
        minutes: eventMinutes(event) || null,
        done,
        auto: !event.completed && event.auto_done,
        action: action
          ? { label: action.label, heroLabel: action.heroLabel, run: action.run }
          : undefined,
        // Nur geplante Einheiten lassen sich von Hand abhaken · und nur, wenn
        // ein Backend da ist, das die Änderung behält.
        toggle: desktop ? () => void toggleUnit(event) : undefined,
      });
    }

    if (data) {
      // Fällige Wiederholungen, Tagesdosis und offene Analysen sind Mengen,
      // keine Zeitbudgets · sie hängen deshalb nicht am Wochenplan, sondern
      // stehen jeden Tag hier. Auch erledigt: der erreichte Zustand ist die
      // halbe Rückmeldung.
      const puzzleTarget = dose ? dose.perDay : data.puzzle_goal;
      items.push(
        {
          id: "reviews",
          area: "openings",
          icon: BookOpen,
          label: t("st.taskReviews"),
          detail: t("st.due", { n: deInt(data.due_now) }),
          minutes: null,
          done: data.due_now === 0,
          auto: false,
          action: {
            label: t("dash.train"),
            heroLabel: t("st.toRepertoire"),
            run: () => go("repertoire"),
          },
        },
        {
          id: "puzzles",
          area: "tactics",
          icon: PuzzleIcon,
          label: t("st.taskPuzzles"),
          detail: `${deInt(data.today_puzzle_attempts)} / ${deInt(puzzleTarget)}`,
          minutes: null,
          done: data.today_puzzle_attempts >= puzzleTarget,
          auto: false,
          action: {
            label: t("dash.solve"),
            heroLabel: t("st.toPuzzles"),
            run: () =>
              openPuzzles(
                dose?.theme,
                dose ? { minRating: dose.minRating, maxRating: dose.maxRating } : undefined
              ),
          },
        },
        {
          id: "analysis",
          area: "analysis",
          icon: Cpu,
          label: t("st.taskAnalysis"),
          detail: t("st.gamesPending", { n: deInt(data.unanalyzed) }),
          minutes: null,
          done: data.unanalyzed === 0,
          auto: false,
          action: {
            label: t("dash.start"),
            heroLabel: t("st.toAnalysis"),
            run: () => go("analysis"),
          },
        }
      );
    }
    return items;
  }, [state, data, todayIso, areaAction, dose, t, locale, go, openPuzzles, desktop, toggleUnit]);

  const areas = useMemo(
    () => [
      {
        id: "repertoire" as const,
        area: "openings" as Area,
        icon: BookOpen,
        label: t("nav.repertoire"),
        status: data ? t("st.due", { n: deInt(data.due_now) }) : "",
        onClick: () => go("repertoire"),
      },
      {
        id: "puzzles" as const,
        area: "tactics" as Area,
        icon: PuzzleIcon,
        label: t("nav.puzzles"),
        status: data
          ? `${deInt(data.today_puzzle_attempts)} / ${deInt(dose?.perDay ?? data.puzzle_goal)}`
          : "",
        onClick: () => openPuzzles(),
      },
      {
        id: "endgame" as const,
        area: "endgames" as Area,
        icon: Crown,
        label: t("nav.endgame"),
        // Endspiele haben keinen Fälligkeits-Zähler · dort steht die Zeit der
        // laufenden Woche gegen ihr Ziel, dieselbe Zahl wie in der Wochenkarte.
        status: endgameWeek
          ? t("st.weekBudgetValue", {
              a: deInt(endgameWeek.minutes),
              m: deInt(endgameWeek.target),
            })
          : t("st.areaEndgame"),
        onClick: () => go("endgame"),
      },
    ],
    [data, dose, t, go, openPuzzles, endgameWeek]
  );

  /**
   * Der Kopf der Tagessitzung und der Rest · mobil stehen die beiden nicht
   * beieinander: dazwischen liegen die drei Trainer, weil man von dieser Seite
   * aus auch ohne Tagesplan ins Repertoire oder in die Puzzles springt.
   */
  const nextItem = sessionItems.find((item) => !item.done) ?? null;
  const restItems = sessionItems.filter((item) => item.id !== nextItem?.id);
  const doneCount = sessionItems.filter((item) => item.done).length;

  /** Woran es morgen weitergeht · steht nur da, wenn heute nichts offen ist. */
  const tomorrowNote = useMemo(() => {
    const day = isoDay(new Date(Date.now() + DAY * 1_000));
    const event = (state?.events ?? []).find(
      (entry) => entry.day === day && !entry.completed && !entry.auto_done
    );
    if (!event) return undefined;
    const title = templateText(event.template, "title", t);
    const minutes = eventMinutes(event);
    return minutes > 0
      ? t("st.tomorrowNext", { m: deInt(minutes), title })
      : t("st.tomorrowNextPlain", { title });
  }, [state, t]);

  const todayHeading = (
    <span className="flex items-center gap-2">
      <Timer size={14} className="shrink-0 text-accent" />
      {t("st.todayOn", {
        d: new Date().toLocaleDateString(locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
      })}
    </span>
  );
  const todayProgress =
    sessionItems.length > 0 ? (
      <span className="shrink-0 text-[12px] tabular-nums text-ink3">
        {t("st.doneOf", { a: deInt(doneCount), n: deInt(sessionItems.length) })}
      </span>
    ) : undefined;

  /** Die Wochenkarte · am Desktop der Ring, mobil eine Zeile zum Aufklappen. */
  const weekChip = week && (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        week.open === 0
          ? "border-accent-dim bg-accent-soft text-accent"
          : "border-line text-ink3"
      }`}
    >
      {week.open === 0 ? t("st.weekBudgetDone") : t("st.weekBudgetLeft", { m: deInt(week.open) })}
    </span>
  );
  const weekSource = state?.budgetSet ? (
    // Steht ein Budget in den Einstellungen, ist es auf allen Geräten dasselbe
    // · das ist die halbe Aussage dieser Zeile.
    t("st.weekBudgetSource", { m: deInt(plan?.weeklyMinutes ?? 0) })
  ) : (
    t("st.weekBudgetObserved", { m: deInt(state?.observedWeeklyMinutes ?? 0) })
  );

  /* Der Wochenvorschlag gehört zu Kiebitz Plus. Von Hand planen, verschieben
     und abhaken bleibt frei · gesperrt ist nur, dass Kiebitz die Woche selbst
     zusammenstellt. */
  const proposalAction =
    desktop && plan && planning == null ? (
      <button
        type="button"
        onClick={() => {
          if (!planGate.unlocked && !planGate.pending) {
            openPlusDialog("adaptive_plan");
            return;
          }
          proposePlan();
        }}
        className={`inline-flex items-center justify-center gap-2 border border-dashed border-line2 px-3 py-1.5 text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent ${
          diagramMode ? "" : "rounded-lg"
        } ${mobile ? "w-full py-2.5" : ""}`}
      >
        <CalendarPlus size={15} /> {t("plan.proposeWeek")}
        {!planGate.unlocked && !planGate.pending && <PlusBadge />}
      </button>
    ) : undefined;

  const proposalBox =
    desktop && plan && planning != null ? (
      <div
        className={`border border-accent-dim p-3 ${
          diagramMode ? "" : "rounded-xl bg-panel2"
        }`}
      >
        <div className="mb-2 text-[13px] font-medium text-ink">{t("plan.proposalTitle")}</div>
        {planning.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-ink3">{t("plan.proposalEmpty")}</p>
        ) : (
          <>
            <p className="mb-3 text-[12.5px] leading-relaxed text-ink3">
              {t("plan.proposalNote", { n: planning.length, m: plan.weeklyMinutes })}
            </p>
            <ul className="mb-3 grid gap-1.5 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
              {planning.map((unit, index) => (
                <li
                  key={`${unit.day}-${unit.templateId}-${index}`}
                  className={`flex items-baseline justify-between gap-3 border border-line px-3 py-2 text-[12.5px] ${
                    diagramMode ? "" : "rounded-lg bg-panel"
                  }`}
                  style={{ borderLeftColor: AREA_COLOR[unit.area], borderLeftWidth: 3 }}
                >
                  <span className="tabular-nums text-ink3">{unit.day}</span>
                  <span className="min-w-0 flex-1 truncate text-ink2">{unit.templateTitle}</span>
                  <span className="shrink-0 tabular-nums text-ink3">
                    {t("plan.minutes", { m: unit.minutes })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {planning.length > 0 && (
            <Button onClick={applyPlan} disabled={busy}>
              {t("plan.proposalApply")}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setPlanning(null)}
            className={`border border-line px-3 py-1.5 text-[12.5px] text-ink3 transition-colors hover:text-ink ${
              diagramMode ? "" : "rounded-lg"
            }`}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    ) : undefined;

  /**
   * Der Knopf einer Verordnung · dieselbe Handlung im Coach wie im
   * Wochenbericht. Sie stand einmal nur in der Coach-Karte; der Bericht endet
   * aber in genau derselben Verordnung, und zwei Wege in denselben Trainer
   * wären zwei Stellen, an denen der Endspieltyp verloren gehen kann.
   */
  const runPrescription = useCallback(
    (prescription: Prescription) => {
      const action = prescription.action;
      if (!action) return;
      if (action.kind === "puzzles") {
        openPuzzles(action.theme, {
          minRating: action.minRating,
          maxRating: action.maxRating,
        });
      } else if (action.kind === "repertoire") go("repertoire");
      else if (action.kind === "endgame") {
        // Der Befund nennt den Endspieltyp aus der Materialsignatur · daraus
        // wird die Drill-Kategorie.
        const type = prescription.finding.params.type;
        const category = typeof type === "string" ? ENDGAME_TYPE_CATEGORY[type] : undefined;
        if (openEndgame) openEndgame(category);
        else go("endgame");
      } else if (action.kind === "analysis") go("analysis");
      else go("games");
    },
    [go, openPuzzles, openEndgame]
  );

  /**
   * Der Wochenbericht · ein Symbol im Kopf, der Bericht im Vordergrund.
   *
   * Als Karte über der Seite nahm er den halben Bildschirm ein und verdrängte
   * an jedem ungelesenen Tag die Frage, mit der man den Reiter öffnet. Als
   * Symbol kostet er eine Zeile im Kopf, leuchtet, solange er ungelesen ist,
   * und bleibt danach die Woche über erreichbar — das erste Wegklicken macht
   * ihn nicht mehr unwiederbringlich.
   */
  const weekly = state?.weekly ?? null;
  // Der Merker wird je Berichtswoche einmal gelesen und nicht bei jedem
  // Rendern · `reportSeen` trägt das Öffnen im selben Besuch nach.
  const seen = useMemo(() => (weekly ? weeklyReportSeen(weekly.week) : true), [weekly]);
  const reportUnread = Boolean(weekly) && !seen && reportSeen !== weekly?.week.start;

  // Der schnelle Merker oben kennt nur diese Installation. Der dauerhafte in
  // der Datenbank kommt eine Runde später und schaltet das Symbol nachträglich
  // ab · sichtbar wird das nach einem Update, das den WebView-Speicher
  // mitgenommen hat.
  useEffect(() => {
    if (!weekly || seen) return;
    let current = true;
    void weeklyReportSeenStored(weekly.week).then((stored) => {
      if (current && stored) setReportSeen(weekly.week.start);
    });
    return () => {
      current = false;
    };
  }, [weekly, seen]);

  const openReport = useCallback(() => {
    if (!weekly) return;
    // Geöffnet ist gelesen · das Symbol hört auf zu leuchten, sobald der
    // Bericht im Vordergrund steht, und nicht erst beim Schließen.
    markWeeklyReportSeen(weekly.week);
    setReportSeen(weekly.week.start);
    setReportOpen(true);
  }, [weekly]);

  const weeklyDialog =
    weekly && reportOpen ? (
      <WeeklyReportDialog
        report={weekly}
        mobile={mobile}
        onClose={() => setReportOpen(false)}
        onAction={() => {
          // Der Absprung schließt den Bericht · sonst läge er über dem
          // Trainer, in den er gerade geführt hat.
          setReportOpen(false);
          if (weekly.next) runPrescription(weekly.next);
        }}
      />
    ) : null;

  const coachCard = (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Lightbulb size={14} className="shrink-0 text-gold" /> {t("st.coach")}
        </span>
      }
      // Woraus die Befunde gerechnet sind, ist ein Satz und keine Beschriftung ·
      // neben der Überschrift bleibt auf dem Handy für beide zu wenig Platz,
      // und die Zeile drückt den Titel in zwei Zeilen um das Symbol herum.
      // Dort steht sie deshalb über den Befunden, auf die sie sich bezieht.
      action={state && !mobile ? <WindowNote window={state.window} /> : undefined}
      tour="study-plan"
      className={mobile ? "mt-3" : "mt-4"}
    >
      {state && mobile && <WindowNote window={state.window} className="mb-3" />}
      {plan && plan.prescriptions.length > 0 ? (
        <div
          className={
            mobile
              ? "flex flex-col gap-2"
              : "grid gap-3 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3"
          }
        >
          {plan.prescriptions.map((prescription, index) => (
            <PrescriptionCard
              key={prescription.id}
              prescription={prescription}
              mobile={mobile}
              index={index}
              total={plan.prescriptions.length}
              onAction={() => runPrescription(prescription)}
            />
          ))}
        </div>
      ) : (
        <p className="py-2 text-[13px] leading-relaxed text-ink3">{t("st.coachEmpty")}</p>
      )}
      {state && state.findings.length > (plan?.prescriptions.length ?? 0) && (
        <div className={`flex ${mobile ? "" : "justify-end"} mt-3`}>
          <button
            type="button"
            onClick={() => go("insights")}
            className={`inline-flex items-center justify-between gap-2 rounded-lg text-[12.5px] text-ink3 transition-colors hover:text-ink ${
              mobile ? "w-full border border-line bg-panel2 px-3 py-2.5" : ""
            }`}
          >
            {t("st.allFindings", { n: state.findings.length })}
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </Card>
  );

  const hygieneCard = plan && (
    <Card
      className={mobile ? "mt-3" : "mt-4"}
      title={
        <span className="flex items-center gap-2">
          <Timer size={14} className="shrink-0 text-gold" /> {t("plan.hygieneTitle")}
        </span>
      }
    >
      {plan.hygiene.length > 0 ? (
        <ul className="grid gap-2 min-[900px]:grid-cols-2">
          {plan.hygiene.map((tip) => (
            <li
              key={tip.id}
              className="rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink2"
            >
              {/* Der Formattipp trägt Zeitformate als Rohwerte · dieselbe
                  Übersetzung wie in den Befunden. */}
              {t(tip.key, localizeFindingParams(tip.params, t, locale))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-[12.5px] leading-relaxed text-ink3">{t("plan.hygieneEmpty")}</p>
      )}
    </Card>
  );

  const planner = (
    <StudyPlanner
      desktop={desktop}
      suggestMinutes={suggestMinutes}
      proposal={proposalBox}
      proposalAction={proposalAction}
    />
  );

  // ── Der Coach ─────────────────────────────────────────────────────────────
  //
  // Links, woran gearbeitet werden soll, rechts, was die Woche daraus gemacht
  // hat. Dieselben Befunde, dieselben gemessenen Minuten — anders gesetzt.
  // Ohne die Woche gibt es nichts zu setzen · bis dahin die leere Seite und
  // nicht die Kachelfassung (siehe LeereSeite.tsx).
  if (diagramMode && !week) return <LeereSeite />;
  if (diagramMode && week) {
    const bereiche = AREAS.map((area) => {
      const wocheArea = week.byArea.find((entry) => entry.area === area);
      const last = (state?.program?.load_28d ?? []).find((entry) => entry.area === area);
      return {
        name: t(AREA_KEY[area]),
        farbe: AREA_COLOR[area],
        ist: wocheArea?.minutes ?? 0,
        soll: wocheArea?.target ?? 0,
        einheiten: last?.items ?? 0,
        minuten28: last?.minutes ?? 0,
      };
    });
    const wochentage = (state?.program?.days ?? []).slice(-7);
    return (
      <Suspense fallback={<LeereSeite />}>
        {/* Der Wochenbericht ist im Blatt derselbe Dialog wie drüben · nur
            sein Inhalt ist neu gesetzt (siehe components/WeeklyReportDialog
            und pages/blatt/Wochenblatt). Der Weg zu ihm steht am Fuß der
            Wochenspalte, weil der Kolumnentitel keinen Symbolknopf trägt. */}
        {weeklyDialog}
        <StudyBlatt
          mobile={mobile}
          desktop={desktop}
          kopfRechts={t("st.weekBudgetValue", { a: deInt(week.minutes), m: deInt(week.target) })}
          felder={[
            {
              label: t("nav.repertoire"),
              wert: (
                <>
                  <span className="blatt-zahl">{deInt(data?.due_now ?? 0)}</span>{" "}
                  {t("dash.dueReviews")}
                </>
              ),
              gross: true,
            },
            {
              label: t("blatt.puzzlesToday"),
              wert: (
                <span className="blatt-zahl">
                  {deInt(data?.today_puzzle_attempts ?? 0)} / {deInt(dose?.perDay ?? data?.puzzle_goal ?? 0)}
                </span>
              ),
            },
            {
              label: t("dash.gamesWithoutAnalysis"),
              wert: <span className="blatt-zahl">{deInt(data?.unanalyzed ?? 0)}</span>,
            },
            {
              label: t("st.weekBudget"),
              wert: (
                <span className="blatt-zahl">
                  {t("st.weekBudgetValue", { a: deInt(week.minutes), m: deInt(week.target) })}
                </span>
              ),
            },
          ]}
          serie={data?.streak_days ?? 0}
          befunde={
            (plan?.prescriptions.length ?? 0) > 0 ? (
              plan!.prescriptions.map((prescription, index) => {
                const finding = prescription.finding;
                const params = localizeFindingParams(finding.params, t, locale);
                const doseParams: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(prescription.doseParams)) {
                  doseParams[key] = typeof value === "number" ? deInt(value) : value;
                }
                return (
                  <Befund
                    key={prescription.id}
                    titel={t(finding.titleKey, params)}
                    text={t(finding.bodyKey, params)}
                    schwere={finding.severity}
                    ton={finding.tone}
                    verordnung={prescription.doseKey ? t(prescription.doseKey, doseParams) : undefined}
                    letzte={index === plan!.prescriptions.length - 1}
                    onClick={() => areaAction(prescription.area)}
                  />
                );
              })
            ) : (
              <div className="py-3 text-[12.5px] text-ink3">{t("st.coachEmpty")}</div>
            )
          }
          bereiche={bereiche}
          tage={wochentage.map((day) => ({
            name: new Date(day.day_ts * 1000).toLocaleDateString(dateLocale(), { weekday: "short" }),
            werte: AREAS.map((area) => day[area]),
          }))}
          wocheIst={week.minutes}
          wocheSoll={week.target}
          aufgaben={areas.map((area) => ({
            zahl: area.status,
            sache: area.label,
            neben: t(AREA_KEY[area.area]),
            weg: t("blatt.wayTrain"),
            erledigt: false,
            onWeg: area.onClick,
          }))}
          hygiene={(plan?.hygiene ?? []).map((tip) =>
            // Derselbe Satz wie in der gewöhnlichen Fassung · der Formattipp
            // trägt Zeitformate als Rohwerte und wird wie ein Befund übersetzt.
            t(tip.key, localizeFindingParams(tip.params, t, locale))
          )}
          hygieneLeer={t("plan.hygieneEmpty")}
          onBericht={weekly ? openReport : undefined}
          berichtUngelesen={reportUnread}
          vorschlag={proposalBox}
          vorschlagAktion={proposalAction}
          suggestMinutes={suggestMinutes}
          onInsights={() => go("insights")}
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header
        className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-3 ${
          mobile ? "mb-3" : "mb-5"
        }`}
      >
        {/* Mobil trägt die App-Bar den Seitennamen, und der Untertitel erklärt
            eine Seite, die man ohnehin schon offen hat · die Zeile kostet dort
            nur den Platz, den „Jetzt dran" braucht. */}
        {!mobile && (
          <div>
            <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("st.title")}</h1>
            <p className="mt-0.5 text-[13px] text-ink3">{t("st.subtitle")}</p>
          </div>
        )}
        {/* Rechts im Kopf steht, was über die Woche zu sagen ist: der Bericht,
            die Ratingveränderung, die Serie. Der Bericht bekommt ein eigenes
            Feld, weil er als einziges anklickbar ist · in der Leiste daneben
            sähen die beiden Kennzahlen sonst auch nach Knöpfen aus.

            Mobil ist das dieselbe eine Zeile und nicht mehr zwei: Der Bericht
            ist dort nur noch sein Symbol, die Leiste nimmt den Rest der Breite.
            Zwei Zeilen kosteten oben genau den Platz, den auf dem Handy
            „Jetzt dran" braucht.

            Hinter der Zahl steht nichts mehr. Der Zusatz („über 4 Pools", „im
            Rauschen") war das, was mobil als erstes abgeschnitten wurde, und ein
            halber Satz beantwortet die Frage, die er beantworten soll, nicht.
            Wie gemessen wurde, sagt weiterhin der Titel des Feldes. */}
        <div className={`flex items-center gap-2 ${mobile ? "w-full" : "flex-wrap"}`}>
        {weekly && <WeeklyReportButton unread={reportUnread} onClick={openReport} />}
        {(state?.rating || (data && data.streak_days > 0)) && (
          <div className="flex items-stretch overflow-hidden rounded-lg border border-line bg-panel">
            {state?.rating && (
              <div
                className={`flex items-center text-[13px] ${
                  mobile ? "gap-1.5 px-2.5 py-1.5" : "gap-2 px-3 py-1.5"
                }`}
                title={`${t(
                  state.rating.confidence === "measured" ? "plan.ratingExact" : "plan.ratingApprox"
                )} ${t("plan.ratingWindow", { d: deInt(state.window.days) })}`}
              >
                <Gauge size={15} className="shrink-0 text-violet" />
                <span className="font-medium tabular-nums">
                  {t("plan.ratingDelta", {
                    d: `${state.rating.delta > 0 ? "+" : ""}${deInt(state.rating.delta)}`,
                  })}
                </span>
              </div>
            )}
            {state?.rating && data && data.streak_days > 0 && (
              <div className="w-px shrink-0 bg-line" />
            )}
            {data && data.streak_days > 0 && (
              <div
                className={`flex shrink-0 items-center text-[13px] ${
                  mobile ? "gap-1.5 px-2.5 py-1.5" : "gap-2 px-3 py-1.5"
                }`}
              >
                <Flame size={15} className="shrink-0 text-gold" />
                <span className="font-medium">{t("st.streak", { n: deInt(data.streak_days) })}</span>
              </div>
            )}
          </div>
        )}
        </div>
      </header>

      {!desktop && !storeCapture && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("st.webNote")}
        </div>
      )}

      {mobile ? (
        <>
          {/* Was jetzt dran ist, steht über allem · danach erst, wohin man
              sonst springen kann. */}
          {sessionItems.length > 0 && (
            <SessionHero item={nextItem} mobile tomorrow={tomorrowNote} />
          )}

          <nav
            aria-label={t("st.areas")}
            className={`grid grid-cols-3 gap-2 ${sessionItems.length > 0 ? "mt-3" : ""}`}
            data-tour="study-areas"
          >
            {areas.map((area) => (
              <button
                key={area.id}
                onClick={area.onClick}
                className="flex min-h-[88px] flex-col items-start gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:bg-panel2"
              >
                <span
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
                  style={{ background: AREA_SOFT[area.area], color: AREA_COLOR[area.area] }}
                >
                  <area.icon size={17} />
                </span>
                <span className="w-full min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {area.label}
                  </span>
                  <span
                    className="block truncate text-[11.5px] font-medium tabular-nums"
                    style={{ color: AREA_COLOR[area.area] }}
                  >
                    {area.status}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <Card className="mt-3" title={todayHeading} action={todayProgress}>
            {restItems.length > 0 ? (
              <SessionList items={restItems} mobile />
            ) : (
              <p className="py-2 text-[13px] leading-relaxed text-ink3">{t("st.sessionEmpty")}</p>
            )}
          </Card>

          {/* Die Woche ist mobil eine Zeile · aufgeklappt dieselben Zahlen wie
              am Desktop. */}
          {week && (
            <section
              data-week-budget=""
              className="mt-3 rounded-xl border border-line bg-panel"
            >
              <button
                type="button"
                onClick={() => setWeekOpen((value) => !value)}
                aria-expanded={weekOpen}
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink2">{t("st.weekBudget")}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-ink">
                      {t("st.weekBudgetValue", {
                        a: deInt(week.minutes),
                        m: deInt(week.target),
                      })}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {weekChip}
                    <ChevronDown
                      size={14}
                      className={`text-ink3 transition-transform ${weekOpen ? "" : "-rotate-90"}`}
                    />
                  </span>
                </div>
                <div className="mt-2.5">
                  <WeekBar budget={week} />
                </div>
              </button>
              {weekOpen && (
                <div className="border-t border-line px-4 py-3">
                  <WeekAreaList budget={week} />
                  <WeekNote budget={week} source={weekSource} className="mt-3" />
                </div>
              )}
            </section>
          )}

          {coachCard}
          {planner}
          {hygieneCard}
        </>
      ) : (
        <>
          <div className="flex flex-col items-start gap-4 min-[1100px]:flex-row">
            <Card
              className="w-full min-w-0 flex-1"
              title={todayHeading}
              action={todayProgress}
            >
              <TodaySession
                items={sessionItems}
                emptyKey="st.sessionEmpty"
                mobile={false}
                tomorrow={tomorrowNote}
              />
            </Card>

            {/* Die Woche als eine Figur · sie beantwortet „bin ich auf Kurs?",
                ohne die Frage zu verdrängen, mit der man die Seite öffnet. */}
            {week && (
              <Card
                className="w-full min-[1100px]:w-[372px] min-[1100px]:shrink-0"
                title={
                  <span className="flex items-center gap-2">
                    <Gauge size={14} className="text-accent" /> {t("st.weekBudget")}
                  </span>
                }
                action={weekChip}
              >
                <WeekBudgetBar budget={week} source={weekSource} />
              </Card>
            )}
          </div>

          {coachCard}
          {planner}
          {hygieneCard}
        </>
      )}

      {weeklyDialog}
    </div>
  );
}

export { DAY };
