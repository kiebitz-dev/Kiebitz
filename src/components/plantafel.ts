/**
 * Der Zustand der Plantafel · einmal, für beide Sätze.
 *
 * Die Plantafel gibt es zweimal auf dem Bildschirm und nur einmal im Kopf: als
 * Karte in der gewöhnlichen Fassung (`StudyPlanner.tsx`) und als Bogen im
 * Diagramm-Modus (`pages/blatt/Plantafel.tsx`). Was beide teilen, ist alles
 * außer der Erscheinung — das Fenster aus sieben Tagen, der Kalender aus der
 * Datenbank, die Vorschau der Web-Fassung, das Ziehen, das Anlegen, das
 * Abhaken, die Serien.
 *
 * Genau das steht hier. Der Modus ist eine zweite Darstellung derselben Daten
 * und keine zweite Datenbeschaffung (siehe docs/design.md): Eine neue
 * Einstellung an der Planung wird an dieser einen Stelle gepflegt, und beide
 * Sätze haben sie.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  completeStudyUnit,
  deleteStudyTemplate,
  deleteStudyUnit,
  eventMinutes,
  getStudyCalendar,
  moveStudyUnit,
  repeatStudyUnit,
  saveStudyTemplate,
  scheduleStudyUnit,
  templateAreas,
  REPEAT_STEP_DAYS,
  type Area,
  type RepeatRule,
  type StudyCalendar,
  type StudyEvent,
  type StudyTemplate,
  type StudyTemplateInput,
} from "../lib/study";
import type { Key } from "../lib/i18n";
import { onDataChange } from "../lib/changes";
import { isoDay } from "../lib/dates";

export const DAY_MS = 86_400_000;

export const EMPTY_TEMPLATE: StudyTemplateInput = {
  title: "",
  tool: "",
  description: "",
  areas: [],
};

/** UTC-Mitternacht des Tages, in dem `date` liegt. */
export function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const REPEAT_LABEL: Record<Exclude<RepeatRule, "">, Key> = {
  daily: "st.repeatDaily",
  weekly: "st.repeatWeekly",
  biweekly: "st.repeatBiweekly",
};

/** Vorschlag fürs Enddatum: zwölf Termine im gewählten Raster. */
export function defaultUntil(day: string, rule: Exclude<RepeatRule, "">): string {
  const start = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(start)) return day;
  return isoDay(new Date(start + 11 * REPEAT_STEP_DAYS[rule] * DAY_MS));
}

/** Was gerade am Zeiger hängt: eine Vorlage oder eine bereits geplante Einheit. */
export interface DragPayload {
  kind: "template" | "event";
  id: number;
  label: string;
}

export interface DragState extends DragPayload {
  x: number;
  y: number;
  /** Tag unter dem Zeiger (ISO), sonst null. */
  over: string | null;
}

/** Tag-Zelle unter einem Bildschirmpunkt · die Zellen tragen `data-study-day`. */
export function dayAtPoint(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest("[data-study-day]") as HTMLElement | null;
  return cell?.dataset.studyDay ?? null;
}

/** Eine Zeile der Plantafel · ein Tag mit dem, was für ihn steht und zählt. */
export interface PlanZeile {
  date: Date;
  day: string;
  events: StudyEvent[];
  /** Summe der geplanten Minuten. */
  planned: number;
  /** Gemessene Minuten des Tages. */
  measured: number;
  /** Fällige Wiederholungen plus offene Einheiten. */
  due: number;
}

export function useStudyPlanner({
  desktop,
  suggestMinutes,
}: {
  desktop: boolean;
  /** Vorgeschlagene Länge einer von Hand geplanten Einheit, aus dem Budget. */
  suggestMinutes?: (areas: Area[]) => number;
}) {
  const [windowStart, setWindowStart] = useState(() => dayStart(new Date()));
  const [calendar, setCalendar] = useState<StudyCalendar>({ templates: [], events: [], days: [] });
  const [planningDay, setPlanningDay] = useState(() => isoDay(new Date()));
  const [editing, setEditing] = useState<StudyTemplateInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Termin, für den gerade das Wiederholungsraster eingestellt wird. */
  const [repeating, setRepeating] = useState<number | null>(null);
  /** Raster für die nächste Planung aus der Einheiten-Liste. */
  const [planRepeat, setPlanRepeat] = useState<RepeatRule>("");
  const today = isoDay(new Date());
  /** Der Tag, dessen Einheiten unter der Woche stehen · heute zuerst. */
  const [selected, setSelected] = useState(today);

  const days = useMemo(
    () => [...Array(7)].map((_, index) => new Date(windowStart.getTime() + index * DAY_MS)),
    [windowStart]
  );
  // Beim Blättern in eine andere Woche muss der gewählte Tag mitwandern ·
  // sonst zeigt die Detailzeile einen Tag, der in der Leiste fehlt.
  useEffect(() => {
    const window = days.map((date) => isoDay(date));
    if (window.includes(selected)) return;
    setSelected(window.includes(today) ? today : window[0]);
  }, [days, selected, today]);

  const previewCalendar = useMemo<StudyCalendar>(() => {
    // Die Vorschau zeigt dieselben Standardeinheiten wie eine frische
    // Installation · über i18n_key stehen sie in der Sprache der Oberfläche.
    const seed = (
      id: number,
      title: string,
      tool: string,
      description: string,
      area: Area,
      key: string
    ): StudyTemplate => ({
      id,
      title,
      duration_min: 0,
      tool,
      description,
      area,
      areas: [area],
      builtin: area,
      i18n_key: key,
    });
    const templates: StudyTemplate[] = [
      seed(1, "Opening training", "Kiebitz Repertoire", "Reinforce the first 8–10 moves and the ideas behind them.", "openings", "st.seed.openings"),
      seed(2, "Endgame training", "Kiebitz Endgames", "Train queen, rook, and fundamental pawn endings.", "endgames", "st.seed.endgames"),
      seed(3, "Tactics", "Kiebitz Puzzles", "15–20 puzzles: forks, pins, skewers, and discovered attacks.", "tactics", "st.seed.tactics"),
      seed(4, "Playing", "Lichess / chess.com", "Play deliberately, not on the side.", "play", "st.seed.play"),
      seed(5, "Game review", "Kiebitz Analysis", "Review yourself first, then the three biggest engine mistakes.", "analysis", "st.seed.analysis"),
    ];
    const demoMinutes = [24, 0, 16, 40, 10, 19, 0];
    const demoPlanned: [number, number, number][] = [
      [0, 3, 15],
      [1, 1, 20],
      [2, 4, 40],
      [2, 5, 25],
      [4, 3, 15],
      [5, 1, 20],
      [6, 2, 20],
    ];
    return {
      templates,
      events: demoPlanned.map(([index, templateId, minutes], position) => ({
        id: position + 1,
        template_id: templateId,
        day: isoDay(days[index]),
        position,
        completed: index === 0,
        completed_ts: index === 0 ? 1 : 0,
        auto_done: false,
        repeat_rule: "" as RepeatRule,
        series_key: "",
        planned_min: minutes,
        source: "plan" as const,
        template: templates[templateId - 1],
      })),
      days: days.map((date, index) => {
        const day = isoDay(date);
        const past = day <= today;
        return {
          day,
          puzzle_attempts: past ? demoMinutes[index] / 2 : 0,
          puzzle_solved: past ? Math.round(demoMinutes[index] / 3) : 0,
          endgame_attempts: 0,
          rep_reviews: 0,
          game_reviews: past && index === 3 ? 1 : 0,
          actual_minutes: past ? demoMinutes[index] : 0,
          due_reviews: day >= today ? [14, 6, 9, 4, 11, 3, 7][index] : 0,
        };
      }),
    };
  }, [days, today]);
  const visibleCalendar = desktop ? calendar : previewCalendar;

  const refreshRef = useRef<{ key: string; request: Promise<void> } | null>(null);
  const refresh = useCallback(() => {
    if (!desktop) return Promise.resolve();
    const from = isoDay(days[0]);
    const to = isoDay(days[6]);
    const key = `${from}:${to}`;
    if (refreshRef.current?.key === key) return refreshRef.current.request;
    const request = getStudyCalendar(from, to)
      .then(setCalendar)
      .finally(() => {
        if (refreshRef.current?.request === request) refreshRef.current = null;
      });
    refreshRef.current = { key, request };
    return request;
  }, [days, desktop]);

  useEffect(() => {
    if (!desktop) return;
    refresh().catch((reason) => setError(String(reason)));
    const unsubscribe = onDataChange(() => {
      refresh().catch((reason) => setError(String(reason)));
    }, ["study", "database"]);
    return unsubscribe;
  }, [desktop, refresh]);

  const mutate = useCallback(
    async (operation: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await operation();
        await refresh();
        return true;
      } catch (reason) {
        setError(String(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  /**
   * Der Papierkorb löscht immer genau diesen Termin · eine ganze Serie geht nur
   * über das Wiederholungs-Menü verloren, damit ein Fehlklick nicht Wochen an
   * geplanten Einheiten mitnimmt.
   */
  const removeUnit = useCallback(
    (event: StudyEvent) => mutate(() => deleteStudyUnit(event.id)),
    [mutate]
  );

  /** Länge einer neu geplanten Einheit · aus dem Budget, nicht aus einer Eingabe. */
  const minutesFor = useCallback(
    (template: StudyTemplate) => suggestMinutes?.(templateAreas(template)) ?? 0,
    [suggestMinutes]
  );

  const dropOnDay = useCallback(
    (day: string, payload: DragPayload) => {
      if (!desktop) return;
      if (payload.kind === "template") {
        const template = visibleCalendar.templates.find((entry) => entry.id === payload.id);
        void mutate(() =>
          scheduleStudyUnit(payload.id, day, "", undefined, template ? minutesFor(template) : 0)
        );
      }
      if (payload.kind === "event") {
        const position = visibleCalendar.events.filter((event) => event.day === day).length;
        void mutate(() => moveStudyUnit(payload.id, day, position));
      }
    },
    [desktop, minutesFor, mutate, visibleCalendar]
  );

  /**
   * Drag-and-drop über Pointer-Events statt der HTML5-API: die Windows-WebView
   * liefert für `dragstart`/`drop` keine brauchbaren Events (gleiche Ursache wie
   * beim Analyse-Brett), Pointer-Events funktionieren dort und auf Touch.
   */
  const startDrag = useCallback(
    (event: ReactPointerEvent, payload: DragPayload) => {
      if (!desktop || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;
      const move = (pointer: PointerEvent) => {
        if (!moved && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 5) return;
        moved = true;
        setDrag({
          ...payload,
          x: pointer.clientX,
          y: pointer.clientY,
          over: dayAtPoint(pointer.clientX, pointer.clientY),
        });
      };
      const stop = (pointer: PointerEvent | null) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        setDrag(null);
        if (!moved || !pointer) return;
        const day = dayAtPoint(pointer.clientX, pointer.clientY);
        if (day) dropOnDay(day, payload);
      };
      const finish = (pointer: PointerEvent) => stop(pointer);
      const cancel = () => stop(null);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    },
    [desktop, dropOnDay]
  );

  const saveTemplate = useCallback(async () => {
    if (!editing) return;
    if (await mutate(() => saveStudyTemplate(editing))) setEditing(null);
  }, [editing, mutate]);

  // Gemeinsame Skala aller sieben Zeilen · sonst sähe ein 20-Minuten-Tag neben
  // einem 90-Minuten-Tag genauso voll aus.
  const rows = useMemo<PlanZeile[]>(
    () =>
      days.map((date) => {
        const day = isoDay(date);
        const events = visibleCalendar.events.filter((event) => event.day === day);
        const metrics = (visibleCalendar.days ?? []).find((entry) => entry.day === day);
        return {
          date,
          day,
          events,
          planned: events.reduce((sum, event) => sum + eventMinutes(event), 0),
          measured: metrics?.actual_minutes ?? 0,
          due:
            (metrics?.due_reviews ?? 0) +
            events.filter((event) => !event.completed && !event.auto_done).length,
        };
      }),
    [days, visibleCalendar]
  );
  const scale = Math.max(30, ...rows.map((row) => Math.max(row.planned, row.measured)));
  // Der gewählte Tag muss immer einer der sieben sein: beim Blättern in eine
  // andere Woche zeigt sonst die Detailzeile auf einen Tag, der nicht mehr
  // in der Leiste steht.
  const selectedRow = rows.find((row) => row.day === selected) ?? rows[0];

  /** Eine Einheit abhaken oder wieder aufmachen. */
  const toggleUnit = useCallback(
    (event: StudyEvent) => mutate(() => completeStudyUnit(event.id, !event.completed)),
    [mutate]
  );

  /** Eine Serie einstellen · Raster plus Enddatum. */
  const applyRepeat = useCallback(
    async (event: StudyEvent, rule: Exclude<RepeatRule, "">, until: string) => {
      if (await mutate(() => repeatStudyUnit(event.id, rule, until))) setRepeating(null);
    },
    [mutate]
  );

  const deleteSeries = useCallback(
    async (event: StudyEvent) => {
      if (await mutate(() => deleteStudyUnit(event.id, "series"))) setRepeating(null);
    },
    [mutate]
  );

  const removeTemplate = useCallback(
    (template: StudyTemplate) => mutate(() => deleteStudyTemplate(template.id)),
    [mutate]
  );

  /** Eine Vorlage auf den eingestellten Tag legen · mit Raster, wenn eines steht. */
  const planTemplate = useCallback(
    (template: StudyTemplate) =>
      mutate(() =>
        scheduleStudyUnit(
          template.id,
          planningDay,
          planRepeat,
          planRepeat ? defaultUntil(planningDay, planRepeat) : undefined,
          minutesFor(template)
        )
      ),
    [minutesFor, mutate, planRepeat, planningDay]
  );

  return {
    today,
    days,
    windowStart,
    setWindowStart,
    visibleCalendar,
    rows,
    scale,
    selected,
    setSelected,
    selectedRow,
    planningDay,
    setPlanningDay,
    planRepeat,
    setPlanRepeat,
    editing,
    setEditing,
    busy,
    error,
    drag,
    repeating,
    setRepeating,
    startDrag,
    minutesFor,
    mutate,
    removeUnit,
    toggleUnit,
    applyRepeat,
    deleteSeries,
    removeTemplate,
    planTemplate,
    saveTemplate,
  };
}
