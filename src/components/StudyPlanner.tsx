import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { Button, Card } from "./ui";
import { useI18n } from "../lib/i18n";
import {
  eventMinutes,
  templateAreas,
  templateText,
  AREAS,
  AREA_COLOR,
  AREA_KEY,
  REPEAT_RULES,
  type Area,
  type RepeatRule,
} from "../lib/study";
import {
  dayStart,
  defaultUntil,
  useStudyPlanner,
  DAY_MS,
  EMPTY_TEMPLATE,
  REPEAT_LABEL,
} from "./plantafel";
import { useMobileShell } from "./MobileShell";
import { deInt } from "../lib/format";
import { isStoreCapture } from "../lib/storeCapture";

/**
 * Serie einstellen: Raster plus Enddatum. Eine Serie ist im Kalender eine Reihe
 * echter Termine · deshalb steht hier auch das Ende, statt eine Regel offen zu
 * lassen, die irgendwann Termine erfindet, die niemand geplant hat.
 */
export function RepeatForm({
  day,
  current,
  busy,
  blatt = false,
  onApply,
  onCancel,
  onDeleteSeries,
}: {
  day: string;
  current: RepeatRule;
  busy: boolean;
  /** Im Diagramm-Modus ist der Rahmen eine Kante und keine Karte. */
  blatt?: boolean;
  onApply: (rule: Exclude<RepeatRule, "">, until: string) => void;
  onCancel: () => void;
  /** Nur bei einem Termin, der schon zu einer Serie gehört. */
  onDeleteSeries?: () => void;
}) {
  const t = useI18n().t;
  const [rule, setRule] = useState<Exclude<RepeatRule, "">>(current === "" ? "weekly" : current);
  const [until, setUntil] = useState(() => defaultUntil(day, current === "" ? "weekly" : current));

  return (
    <div
      className={`mt-2 border border-accent-dim p-2 ${blatt ? "" : "rounded-lg bg-panel2"}`}
    >
      <div className="text-[10.5px] uppercase tracking-wide text-ink3">{t("st.repeatTitle")}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {REPEAT_RULES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setRule(value);
              setUntil(defaultUntil(day, value));
            }}
            className={`rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors ${
              rule === value
                ? "border-accent-dim bg-accent-soft text-accent"
                : "border-line text-ink3 hover:text-ink"
            }`}
          >
            {t(REPEAT_LABEL[value])}
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[10.5px] text-ink3">
        {t("st.repeatUntil")}
        <input
          type="date"
          value={until}
          min={day}
          onChange={(event) => setUntil(event.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-panel px-1.5 py-1 text-[11px] text-ink focus:border-accent-dim focus:outline-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        {onDeleteSeries && (
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteSeries}
            className="mr-auto rounded-md px-1.5 py-1 text-[10.5px] text-ink3 hover:text-loss disabled:opacity-45"
          >
            {t("st.repeatEnd")}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-1.5 py-1 text-[10.5px] text-ink3 hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !until}
          onClick={() => onApply(rule, until)}
          className="rounded-md bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-45"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * Die Plantafel: sieben Tage ab heute.
 *
 * Jede Zeile ist ein Tag, und sie beantwortet dieselbe Frage wie die
 * Wochenleiste oben, nur für diesen einen Tag: der obere Balken ist der Plan,
 * nach Bereichen eingefärbt, der untere die gemessene Zeit. Die Einheiten
 * selbst stehen erst da, wenn man den Tag aufklappt · vorher waren sieben
 * dauerhaft ausgeklappte Tageskästen die halbe Seite, und die Antwort auf
 * „wann mache ich was?" ging darin unter.
 */
export default function StudyPlanner({
  desktop,
  /** Der Wochenvorschlag · er gehört in dieselbe Karte wie der Plan. */
  proposal,
  /**
   * Der Knopf, der den Vorschlag anfordert. Er steht in der Kopfzeile neben
   * der Wochenwahl · dort, wo die anderen Schalter der Karte sitzen, statt
   * als breite gestrichelte Fläche über dem Kalender.
   */
  proposalAction,
  /** Vorgeschlagene Länge einer von Hand geplanten Einheit, aus dem Budget. */
  suggestMinutes,
}: {
  desktop: boolean;
  proposal?: ReactNode;
  proposalAction?: ReactNode;
  suggestMinutes?: (areas: Area[]) => number;
}) {
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const storeCapture = isStoreCapture();
  // Der Plan ist der Hauptinhalt; die Einheiten bleiben bis zum Aufklappen aus dem Weg.
  const [libraryOpen, setLibraryOpen] = useState(false);
  /**
   * Die Einheiten-Liste steht unter dem Tageskasten · auf dem Telefon so weit
   * darunter, dass „+ Einheit" oben nichts Sichtbares tat. Der Knopf klappt
   * sie deshalb nicht nur auf, er holt sie auch ins Bild.
   */
  const libraryRef = useRef<HTMLDivElement | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  // Alles, was nicht Erscheinung ist, steht in `plantafel.ts` · die
  // Plantafel des Diagramm-Modus benutzt denselben Haken.
  const {
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
    removeUnit,
    toggleUnit,
    applyRepeat,
    deleteSeries,
    removeTemplate,
    planTemplate,
    saveTemplate,
  } = useStudyPlanner({ desktop, suggestMinutes });

  // Erst nach dem Aufklappen scrollen · vorher ist die Liste noch leer und
  // stünde nach dem Ausklappen wieder halb außerhalb des Bildes.
  useEffect(() => {
    if (!showLibrary) return;
    setShowLibrary(false);
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    libraryRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  }, [showLibrary]);

  return (
    <Card
      className="mt-4"
      title={
        <span className="flex items-center gap-2">
          <CalendarDays size={15} className="text-accent" /> {t("st.weekTitle")}
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          {/* Der Vorschlag gehört neben die Wochenwahl · beides stellt ein,
              was die Karte darunter zeigt. Mobil ist dafür kein Platz, dort
              steht er als eigene Zeile über den Lerneinheiten. */}
          {!mobile && proposalAction}
          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWindowStart(new Date(windowStart.getTime() - 7 * DAY_MS))}
            aria-label={t("st.prevWeek")}
            className="rounded-lg border border-line p-1.5 text-ink3 hover:text-ink"
          >
            <ChevronLeft size={15} />
          </button>
          <Button
            onClick={() => setWindowStart(dayStart(new Date()))}
            className="!px-2.5 !py-1.5 !text-[12px]"
          >
            {t("st.currentWeek")}
          </Button>
          <button
            type="button"
            onClick={() => setWindowStart(new Date(windowStart.getTime() + 7 * DAY_MS))}
            aria-label={t("st.nextWeek")}
            className="rounded-lg border border-line p-1.5 text-ink3 hover:text-ink"
          >
            <ChevronRight size={15} />
          </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {!desktop && !storeCapture && (
          <div className="rounded-lg border border-dashed border-line2 px-3 py-2 text-[12px] text-ink3">
            {t("st.plannerDesktop")}
          </div>
        )}

        {/* Am Desktop steht der Vorschlag oben in der Karte · dort sitzt auch
            der Knopf, der ihn anfordert (in der Kopfzeile). Mobil steht der
            Knopf unter dem Kalender, und der Vorschlag gehört an dieselbe
            Stelle · siehe unten. */}
        {!mobile && proposal}

        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[13px] font-medium text-ink">
              {days[0].toLocaleDateString(locale, {
                day: "2-digit",
                month: "long",
                timeZone: "UTC",
              })}
              {" – "}
              {days[6].toLocaleDateString(locale, {
                day: "2-digit",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </div>
            <div className="text-[11.5px] text-ink3">{t("st.calendarHint")}</div>
          </div>

          {/* Die Woche als sieben Spalten nebeneinander · vorher waren es
              sieben gestapelte Aufklapper, die alle gleichzeitig offen sein
              konnten und dann die halbe Seite füllten. Jede Spalte trägt
              dieselbe Aussage wie zuvor die Zeile: oben der Plan nach
              Bereichen, darunter die gemessene Zeit. */}
          <div className="grid grid-cols-7 gap-1 min-[700px]:gap-2">
            {rows.map((row) => {
              const isToday = row.day === today;
              const future = row.day > today;
              const active = row.day === selected;
              return (
                <button
                  key={row.day}
                  type="button"
                  data-study-day={row.day}
                  onClick={() => setSelected(row.day)}
                  aria-pressed={active}
                  className={`rounded-xl border px-1 py-2 text-center transition-colors min-[1100px]:p-2.5 min-[1100px]:text-left ${
                    drag?.over === row.day
                      ? "border-accent bg-accent-soft/60"
                      : active
                        ? "border-accent-dim bg-accent-soft/40"
                        : "border-line bg-panel2 hover:border-line2"
                  }`}
                >
                  {/* Eine von sieben Spalten ist auf dem Telefon rund 45 px
                      breit, im schmalen Desktop-Fenster rund 65 · unterhalb von
                      1100 px steht der Wochentag deshalb über dem Datum und
                      alles Weitere fällt weg. Das hängt an der Fensterbreite und
                      nicht an der Shell: ein schmales Desktop-Fenster hat
                      dasselbe Platzproblem wie ein Telefon. */}
                  <span className="block min-[1100px]:flex min-[1100px]:items-baseline min-[1100px]:justify-between min-[1100px]:gap-1">
                    <span className="block min-[1100px]:flex min-[1100px]:items-baseline min-[1100px]:gap-1.5">
                      <span className="block text-[10px] uppercase tracking-wide text-ink3 min-[1100px]:inline min-[1100px]:text-[10.5px]">
                        {row.date.toLocaleDateString(locale, {
                          weekday: "short",
                          timeZone: "UTC",
                        })}
                      </span>
                      <span
                        className={`block text-[15px] font-semibold min-[1100px]:inline min-[1100px]:text-[14px] ${
                          isToday ? "text-accent" : "text-ink"
                        }`}
                      >
                        {row.date.getUTCDate()}
                      </span>
                    </span>
                    {/* Fällige Wiederholungen nennt nur, wer sie noch abtragen
                        kann · für vergangene Tage ist die Zahl keine Aufgabe
                        mehr, sondern ein Vorwurf. */}
                    {(future || isToday) && row.due > 0 && (
                      <span className="hidden shrink-0 text-[10.5px] tabular-nums text-gold min-[1100px]:inline">
                        {t("st.due", { n: deInt(row.due) })}
                      </span>
                    )}
                  </span>

                  <span className="mt-2 flex h-[5px] overflow-hidden rounded-full bg-panel3">
                    {row.events.map((event) => (
                      <span
                        key={event.id}
                        title={`${templateText(event.template, "title", t)} · ${t("plan.minutes", { m: eventMinutes(event) })}`}
                        style={{
                          width: `${(eventMinutes(event) / scale) * 100}%`,
                          background:
                            AREA_COLOR[templateAreas(event.template)[0] ?? "play"] ??
                            "var(--color-ink3)",
                          opacity: event.completed || event.auto_done ? 0.45 : 1,
                        }}
                      />
                    ))}
                  </span>
                  <span className="mt-[3px] flex h-[5px] overflow-hidden rounded-full bg-panel3">
                    {!future && (
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, (row.measured / scale) * 100)}%` }}
                      />
                    )}
                  </span>

                  {/* Schmal tragen die Balken die Aussage · die Titel stehen
                      dann unten beim gewählten Tag. */}
                  <span className="mt-2 hidden min-h-[40px] flex-col gap-1 min-[1100px]:flex">
                      {row.events.slice(0, 2).map((event) => (
                        <span
                          key={event.id}
                          style={{
                            borderLeftColor:
                              AREA_COLOR[templateAreas(event.template)[0] ?? "play"] ??
                              "var(--color-ink3)",
                            borderLeftWidth: 3,
                          }}
                          className={`truncate rounded bg-panel3 px-1.5 py-0.5 text-[10.5px] ${
                            event.completed || event.auto_done ? "text-ink3" : "text-ink"
                          }`}
                        >
                          {templateText(event.template, "title", t)}
                        </span>
                      ))}
                      {row.events.length > 2 && (
                        <span className="px-1.5 text-[10px] tabular-nums text-ink3">
                          + {row.events.length - 2}
                        </span>
                      )}
                  </span>

                  {/* Schmal bleibt die nackte Zahl unter den Balken · "14
                      fällig" sprengt eine 45-px-Spalte. */}
                  {(future || isToday) && row.due > 0 && (
                    <span
                      className="mt-1.5 block text-[10px] tabular-nums text-gold min-[1100px]:hidden"
                      title={t("st.due", { n: deInt(row.due) })}
                    >
                      {deInt(row.due)}
                    </span>
                  )}

                  <span className="mt-2 hidden text-[10.5px] tabular-nums text-ink2 min-[1100px]:block">
                    {future
                      ? row.planned > 0
                        ? t("st.dayPlanned", { m: deInt(row.planned) })
                        : t("st.dayNothing")
                      : t("st.dayActualPlanned", {
                          a: deInt(row.measured),
                          m: deInt(row.planned),
                        })}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Die Einheiten zeigt nur der gewählte Tag. Sieben gleichzeitig
              offene Tage beantworteten die Frage „wann mache ich was?" mit
              einer Wand aus Kacheln. */}
          <div className="mt-2.5 rounded-xl border border-line bg-panel2 p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-[12.5px] font-medium text-ink">
                {selectedRow.date.toLocaleDateString(locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                })}
                {" · "}
                {selectedRow.events.length === 1
                  ? t("st.dayUnitOne")
                  : t("st.dayUnitMany", { n: deInt(selectedRow.events.length) })}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[11.5px] tabular-nums text-ink3 min-[1100px]:hidden">
                  {selectedRow.day > today
                    ? t("st.dayPlanned", { m: deInt(selectedRow.planned) })
                    : t("st.dayActualPlanned", {
                        a: deInt(selectedRow.measured),
                        m: deInt(selectedRow.planned),
                      })}
                </span>
                <button
                  type="button"
                  disabled={!desktop}
                  onClick={() => {
                    setPlanningDay(selectedRow.day);
                    setLibraryOpen(true);
                    setShowLibrary(true);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[11.5px] text-ink2 transition-colors hover:border-line2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 min-[1100px]:min-h-0 min-[1100px]:px-2.5 min-[1100px]:py-1.5"
                >
                  <Plus size={12} /> {t("st.addUnitShort")}
                </button>
              </span>
            </div>

            <div className="grid gap-2 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
              {selectedRow.events.map((event) => {
                const areas = templateAreas(event.template);
                const done = event.completed || event.auto_done;
                return (
                  <div
                    key={event.id}
                    data-study-unit={event.id}
                    // Der farbige Streifen links nennt den Bereich, ohne
                    // eine Zeile dafür zu verbrauchen.
                    style={
                      areas[0]
                        ? { borderLeftColor: AREA_COLOR[areas[0]], borderLeftWidth: 3 }
                        : undefined
                    }
                    className={`rounded-lg border p-2 ${
                      drag?.kind === "event" && drag.id === event.id ? "opacity-40" : ""
                    } ${done ? "border-accent-dim bg-accent-soft/50" : "border-line2 bg-panel"}`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        onPointerDown={(pointerEvent) =>
                          startDrag(pointerEvent, {
                            kind: "event",
                            id: event.id,
                            label: templateText(event.template, "title", t),
                          })
                        }
                        className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                        aria-label={t("st.dragUnit")}
                      >
                        <GripVertical size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-[11.5px] font-medium leading-tight ${done ? "text-ink3 line-through" : "text-ink"}`}
                        >
                          {templateText(event.template, "title", t)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-ink3">
                          {eventMinutes(event) > 0 && (
                            <span className="tabular-nums">
                              {t("plan.minutes", { m: deInt(eventMinutes(event)) })}
                            </span>
                          )}
                          {areas.map((area) => (
                            <span key={area}>{t(AREA_KEY[area])}</span>
                          ))}
                          {/* Von der gemessenen Zeit erfüllt · das
                              unterscheidet sich von Hand abgehakt und
                              soll auch so aussehen. */}
                          {!event.completed && event.auto_done && (
                            <span className="text-accent">{t("st.doneMeasured")}</span>
                          )}
                          {event.repeat_rule && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded border border-line2 px-1 text-accent"
                              title={t("st.repeatSeries")}
                            >
                              <Repeat size={9} /> {t(REPEAT_LABEL[event.repeat_rule])}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void toggleUnit(event)}
                        disabled={!desktop}
                        className={`rounded-md p-1 ${event.completed ? "bg-accent-soft text-accent" : "text-ink3 hover:bg-panel2 hover:text-accent"}`}
                        aria-label={event.completed ? t("st.markOpen") : t("st.markDone")}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setRepeating((current) =>
                            current === event.id ? null : event.id
                          )
                        }
                        disabled={!desktop}
                        aria-expanded={repeating === event.id}
                        className={`rounded-md p-1 ${
                          repeating === event.id || event.repeat_rule
                            ? "bg-accent-soft text-accent"
                            : "text-ink3 hover:bg-panel2 hover:text-accent"
                        }`}
                        aria-label={t("st.repeatSet")}
                        title={t("st.repeatSet")}
                      >
                        <Repeat size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeUnit(event)}
                        disabled={!desktop}
                        className="rounded-md p-1 text-ink3 hover:bg-panel2 hover:text-loss"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {repeating === event.id && (
                      <RepeatForm
                        day={event.day}
                        current={event.repeat_rule}
                        busy={busy}
                        onCancel={() => setRepeating(null)}
                        onApply={(rule, until) => void applyRepeat(event, rule, until)}
                        onDeleteSeries={
                          event.series_key ? () => void deleteSeries(event) : undefined
                        }
                      />
                    )}
                  </div>
                );
              })}
              {selectedRow.events.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-[10.5px] text-ink3">
                  {t("st.dropHere")}
                </div>
              )}
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("st.weekNote")}</p>
        </div>

        {/* Der Vorschlag tritt genau dort auf, wo der Knopf stand, der ihn
            angefordert hat. Oben in der Karte erschien er weit außerhalb des
            Bildes: Auf dem Telefon liegen zwischen Knopf und Kartenkopf der
            ganze Kalender und die Tagesliste, und ein Tipp auf „Die nächsten
            sieben Tage planen" sah dadurch nach nichts aus. Beide schließen
            einander aus · den Knopf gibt es nur ohne Vorschlag. */}
        {mobile && (proposal ?? proposalAction)}

        <div ref={libraryRef} className="scroll-mt-4 rounded-xl border border-line bg-panel2 p-3">
          {/* Schmal stehen Titel und Schalter untereinander · nebeneinander
              blieben für den Hinweis unter „Lerneinheiten" drei gequetschte
              Zeilen neben dem Raster-Feld übrig. */}
          <div className="flex flex-col gap-2 min-[700px]:flex-row min-[700px]:items-center min-[700px]:justify-between">
            <button
              type="button"
              onClick={() => setLibraryOpen((value) => !value)}
              aria-expanded={libraryOpen}
              className="flex items-center gap-2 text-left"
            >
              <ChevronDown
                size={15}
                className={`text-ink3 transition-transform ${libraryOpen ? "" : "-rotate-90"}`}
              />
              <span>
                <span className="block text-[13px] font-medium text-ink">
                  {t("st.unitsLibrary")}
                </span>
                <span className="block text-[11.5px] text-ink3">{t("st.dragHint")}</span>
              </span>
            </button>
            <div className="flex items-center justify-end gap-2">
              <label className="hidden text-[11px] text-ink3 min-[700px]:block">
                {t("st.planFor")}{" "}
                <input
                  type="date"
                  value={planningDay}
                  onChange={(event) => setPlanningDay(event.target.value)}
                  className="ml-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12px] text-ink focus:border-accent-dim focus:outline-none"
                />
              </label>
              {/* Raster für die Schaltfläche "Planen" · leer bleibt ein
                  Einzeltermin, sonst entsteht direkt eine Serie. */}
              <label className="text-[11px] text-ink3">
                <span className="hidden min-[700px]:inline">{t("st.repeatTitle")} </span>
                <select
                  value={planRepeat}
                  onChange={(event) => setPlanRepeat(event.target.value as RepeatRule)}
                  aria-label={t("st.repeatTitle")}
                  className="ml-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12px] text-ink focus:border-accent-dim focus:outline-none"
                >
                  <option value="">{t("st.repeatOnce")}</option>
                  {REPEAT_RULES.map((value) => (
                    <option key={value} value={value}>
                      {t(REPEAT_LABEL[value])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
                disabled={!desktop}
                className="rounded-lg border border-line p-2 text-ink3 hover:border-line2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("st.addUnit")}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          {libraryOpen && (
            <div className="mt-3 grid gap-2 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3 min-[1300px]:grid-cols-5">
              {visibleCalendar.templates.map((template) => {
                const areas = templateAreas(template);
                return (
                  <div
                    key={template.id}
                    data-study-template={template.id}
                    className="group rounded-lg border border-line bg-panel p-3 hover:border-line2"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        onPointerDown={(pointerEvent) =>
                          startDrag(pointerEvent, {
                            kind: "template",
                            id: template.id,
                            label: templateText(template, "title", t),
                          })
                        }
                        className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                        aria-label={t("st.dragUnit")}
                      >
                        <GripVertical size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium text-ink">
                          {templateText(template, "title", t)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {areas.map((area) => (
                            <span
                              key={area}
                              className="rounded border border-line2 px-1 text-[10px]"
                              style={{ color: AREA_COLOR[area] }}
                            >
                              {t(AREA_KEY[area])}
                            </span>
                          ))}
                          {areas.length === 0 && (
                            <span className="text-[10px] text-ink3">{t("st.areaNone")}</span>
                          )}
                        </div>
                        {template.description && (
                          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
                            {templateText(template, "desc", t)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        type="button"
                        // Bearbeitet wird der Text, der auf dem Bildschirm
                        // steht · bei einer Standardeinheit ist das die Übersetzung.
                        onClick={() =>
                          setEditing({
                            id: template.id,
                            title: templateText(template, "title", t),
                            tool: templateText(template, "tool", t),
                            description: templateText(template, "desc", t),
                            areas,
                          })
                        }
                        disabled={!desktop}
                        className="rounded-md p-1.5 text-ink3 hover:bg-panel2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t("common.edit")}
                      >
                        <Pencil size={13} />
                      </button>
                      {/* Die fünf Standardeinheiten bleiben · an ihnen plant
                          der Wochenvorschlag. */}
                      {!template.builtin && (
                        <button
                          type="button"
                          onClick={() => void removeTemplate(template)}
                          disabled={!desktop}
                          className="rounded-md p-1.5 text-ink3 hover:bg-panel2 hover:text-loss disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                      <Button
                        disabled={busy || !desktop || !planningDay}
                        onClick={() => void planTemplate(template)}
                        className="ml-1 !px-2.5 !py-1.5 !text-[11.5px]"
                      >
                        {planRepeat ? <Repeat size={12} /> : <Plus size={12} />} {t("st.plan")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {editing && (
          <div className="rounded-xl border border-accent-dim bg-panel2 p-4">
            <div className="mb-3 text-[13px] font-medium text-ink">
              {editing.id ? t("st.editUnit") : t("st.newUnit")}
            </div>
            <div className="grid gap-3 min-[700px]:grid-cols-2">
              <label className="text-[11px] text-ink3">
                {t("st.unitTitle")}
                <input
                  value={editing.title}
                  onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
                />
              </label>
              <label className="text-[11px] text-ink3">
                {t("st.tool")}
                <input
                  value={editing.tool}
                  onChange={(event) => setEditing({ ...editing, tool: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
                />
              </label>
            </div>
            {/* Bereiche statt Dauer: worauf die Einheit einzahlt, entscheidet
                der Nutzer · wie lang sie wird, das Wochenbudget. */}
            <div className="mt-3">
              <div className="text-[11px] text-ink3">{t("st.unitAreas")}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {AREAS.map((area) => {
                  const active = editing.areas.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          areas: active
                            ? editing.areas.filter((entry) => entry !== area)
                            : [...editing.areas, area],
                        })
                      }
                      className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                        active
                          ? "border-accent-dim bg-accent-soft text-accent"
                          : "border-line text-ink3 hover:text-ink"
                      }`}
                    >
                      {t(AREA_KEY[area])}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">{t("st.unitAreasNote")}</p>
            </div>
            <label className="mt-3 block text-[11px] text-ink3">
              {t("st.description")}
              <textarea
                rows={3}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-ink focus:border-accent-dim focus:outline-none"
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button primary disabled={busy || !editing.title.trim()} onClick={() => void saveTemplate()}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-[12px] text-loss">
            {error}
          </div>
        )}
      </div>

      {/* Zieh-Vorschau am Zeiger; pointer-events aus, damit elementFromPoint die
          Tageszelle darunter findet. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-accent-dim bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-ink shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
        </div>
      )}
    </Card>
  );
}
