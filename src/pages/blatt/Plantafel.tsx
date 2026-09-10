/**
 * Der Plan im Diagramm-Modus · der Wochenbogen.
 *
 * Im Trainingsreiter fehlte er lange, und das war kein Satz, sondern ein
 * Verlust: Der Modus zeigte, was die Woche gebracht hat, aber nicht, was für
 * sie vorgesehen ist. Eine Seite verliert im Modus ihre Kacheln, nicht ihre
 * Funktionen (siehe docs/design.md).
 *
 * Gesetzt ist er als das Gegenstück zur Wochenleiste darüber. Die zählt die
 * gemessenen Minuten der vergangenen Tage; hier stehen dieselben sieben
 * Spalten für die kommenden, nur trägt jede zwei Größen: über der Grundlinie
 * die geplanten Minuten, nach Bereichen gestapelt, darunter als Strich die
 * gemessenen. Damit beantwortet eine Spalte „was ist vorgesehen?" und „was ist
 * daraus geworden?", ohne zwei Bilder zu brauchen.
 *
 * Gerechnet wird hier nichts. Das Fenster, der Kalender, das Ziehen, die
 * Serien und das Anlegen stehen in `components/plantafel.ts` und sind
 * dieselben, die auch die gewöhnliche Karte benutzt — ein Datenweg, zwei
 * Sätze.
 *
 * Wo ein Bedienteil ein Bedienteil ist und nichts sonst — das Datumsfeld der
 * Schnellplanung, der Editor einer Einheit, das Wiederholungsraster —, wird es
 * nicht ein zweites Mal gebaut, sondern unter `.blatt-formular` neu gesetzt.
 */
import { useRef, useState, type ReactNode } from "react";
import { Check, GripVertical, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { Feldname, Rubrik } from "../../components/blatt/Satz";
import { RepeatForm } from "../../components/StudyPlanner";
import {
  dayStart,
  useStudyPlanner,
  DAY_MS,
  EMPTY_TEMPLATE,
  REPEAT_LABEL,
} from "../../components/plantafel";
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
} from "../../lib/study";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import { isStoreCapture } from "../../lib/storeCapture";

export interface PlantafelProps {
  mobile: boolean;
  desktop: boolean;
  /** Der Wochenvorschlag, schon gesetzt · er steht unter der Tagesliste. */
  vorschlag?: ReactNode;
  /** Der Griff, der ihn anfordert · er steht in der Rubrikzeile. */
  vorschlagAktion?: ReactNode;
  suggestMinutes?: (areas: Area[]) => number;
}

export default function Plantafel({
  mobile,
  desktop,
  vorschlag,
  vorschlagAktion,
  suggestMinutes,
}: PlantafelProps) {
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const [listeOffen, setListeOffen] = useState(false);
  const listeRef = useRef<HTMLDivElement | null>(null);

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

  const saeule = mobile ? 62 : 78;

  /**
   * Die sieben Spalten.
   *
   * Über der Grundlinie der Plan, nach Bereichen gestapelt und mit einer
   * Ein-Pixel-Fuge dazwischen — ohne die verschwimmen mehrere Einheiten eines
   * Tages zu einem Klotz. Unter der Grundlinie der Strich der gemessenen Zeit,
   * auf derselben Skala; deshalb liest sich ein kurzer Strich unter einem
   * hohen Stapel sofort als „geplant, aber noch nicht getan".
   */
  const woche = (
    <div className="mt-3 flex items-stretch">
      {rows.map((row, index) => {
        const heute = row.day === today;
        const kuenftig = row.day > today;
        const gewaehlt = row.day === selected;
        const ausfuehrlich = kuenftig
          ? row.planned > 0
            ? t("st.dayPlanned", { m: deInt(row.planned) })
            : t("st.dayNothing")
          : t("st.dayActualPlanned", { a: deInt(row.measured), m: deInt(row.planned) });
        return (
          <button
            key={row.day}
            type="button"
            data-study-day={row.day}
            onClick={() => setSelected(row.day)}
            aria-pressed={gewaehlt}
            className={`flex min-w-0 flex-1 flex-col pb-1.5 text-start ${
              index ? "border-s border-line px-2" : "pe-2"
            } ${
              drag?.over === row.day ? "outline outline-1 -outline-offset-1 outline-accent" : ""
            }`}
          >
            {/* Der gewählte Tag ist am Kopf markiert · dieselbe Marke, mit der
                das Register die aufgeschlagene Seite kennzeichnet. */}
            <span
              aria-hidden
              className={`block h-[3px] ${gewaehlt ? "bg-ink" : "bg-transparent"}`}
            />
            <span className="mt-1.5 flex items-baseline gap-1.5">
              <span className="blatt-feld shrink-0 text-ink3">
                {row.date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}
              </span>
              <span
                className={`blatt-zahl text-[14px] ${
                  heute ? "font-semibold text-ink" : "text-ink2"
                }`}
              >
                {row.date.getUTCDate()}
              </span>
            </span>

            <span className="mt-1.5 flex flex-col justify-end" style={{ height: saeule }}>
              {row.events.map((event) => {
                const bereich = templateAreas(event.template)[0] ?? "play";
                const erledigt = event.completed || event.auto_done;
                return (
                  <span
                    key={event.id}
                    title={`${templateText(event.template, "title", t)} · ${t("plan.minutes", {
                      m: eventMinutes(event),
                    })}`}
                    className="mt-px block"
                    style={{
                      height: Math.max(2, (eventMinutes(event) / scale) * (saeule - 2)),
                      background: AREA_COLOR[bereich],
                      opacity: erledigt ? 0.45 : 1,
                    }}
                  />
                );
              })}
            </span>
            <span aria-hidden className="block h-px bg-ink" />
            {/* Gemessen wird nur, was schon vorbei ist · ein Strich unter einem
                künftigen Tag wäre eine Behauptung. */}
            <span aria-hidden className="mt-[3px] block h-[3px]">
              {!kuenftig && (
                <span
                  className="block h-full bg-ink"
                  style={{ width: `${Math.min(100, (row.measured / scale) * 100)}%` }}
                />
              )}
            </span>
            {/* Ausgeschrieben steht die Zeile nur, wo sie hinpasst · eine von
                sieben Spalten ist auf dem Telefon rund 46 Punkte breit, und
                „24 von 24 Min." stand dort als „24 v…". Schmal trägt deshalb
                die nackte Zahl die Aussage, der Satz bleibt im Titel. */}
            <span
              className="blatt-zahl mt-1.5 block truncate text-[10px] text-ink3"
              title={ausfuehrlich}
            >
              {mobile ? (kuenftig ? deInt(row.planned) : deInt(row.measured)) : ausfuehrlich}
            </span>
            {/* Fällige Wiederholungen nennt nur, wer sie noch abtragen kann. */}
            {(kuenftig || heute) && row.due > 0 && (
              <span className="blatt-zahl mt-0.5 block truncate text-[10px] text-gold">
                {t("st.due", { n: deInt(row.due) })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const griff = "flex h-[26px] w-[26px] flex-none items-center justify-center border-s border-line";

  const tagesListe = (
    <div className="mt-4">
      <Rubrik
        weg={desktop ? t(mobile ? "st.addUnitShort" : "st.addUnit") : undefined}
        onWeg={
          desktop
            ? () => {
                // Derselbe Griff wie in der Karte: Der gewählte Tag wird zum
                // Zieltag, die Liste klappt auf und kommt ins Bild — sonst tut
                // ein Tipp darauf nichts Sichtbares.
                setPlanningDay(selectedRow.day);
                setListeOffen(true);
                const sanft = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                requestAnimationFrame(() =>
                  listeRef.current?.scrollIntoView({
                    behavior: sanft ? "smooth" : "auto",
                    block: "start",
                  })
                );
              }
            : undefined
        }
      >
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
      </Rubrik>

      {selectedRow.events.length === 0 ? (
        <div className="border-b border-line py-3 text-[11.5px] text-ink3">{t("st.dropHere")}</div>
      ) : (
        selectedRow.events.map((event) => {
          const bereiche = templateAreas(event.template);
          const erledigt = event.completed || event.auto_done;
          return (
            <div key={event.id} data-study-unit={event.id} className="border-b border-line">
              <div
                className={`flex items-center gap-2.5 py-1.5 ${
                  drag?.kind === "event" && drag.id === event.id ? "opacity-40" : ""
                }`}
                style={{ minHeight: 44 }}
              >
                <span
                  onPointerDown={(pointerEvent) =>
                    startDrag(pointerEvent, {
                      kind: "event",
                      id: event.id,
                      label: templateText(event.template, "title", t),
                    })
                  }
                  className="flex-none cursor-grab touch-none text-ink3 active:cursor-grabbing"
                  aria-label={t("st.dragUnit")}
                >
                  <GripVertical size={13} />
                </span>
                {bereiche[0] && (
                  <span
                    aria-hidden
                    className="inline-block h-[9px] w-[9px] flex-none"
                    style={{ background: AREA_COLOR[bereiche[0]] }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13px] ${
                      erledigt ? "text-ink3 line-through" : "text-ink"
                    }`}
                  >
                    {templateText(event.template, "title", t)}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink3">
                    {[
                      ...bereiche.map((bereich) => t(AREA_KEY[bereich])),
                      !event.completed && event.auto_done ? t("st.doneMeasured") : null,
                      event.repeat_rule ? t(REPEAT_LABEL[event.repeat_rule]) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {eventMinutes(event) > 0 && (
                  <span className="blatt-zahl flex-none text-[11.5px] text-ink2">
                    {t("plan.minutes", { m: deInt(eventMinutes(event)) })}
                  </span>
                )}
                <span className="flex flex-none items-stretch">
                  <button
                    type="button"
                    disabled={!desktop}
                    onClick={() => void toggleUnit(event)}
                    aria-label={event.completed ? t("st.markOpen") : t("st.markDone")}
                    className={`${griff} disabled:opacity-40 ${
                      event.completed ? "text-accent" : "text-ink3 hover:text-accent"
                    }`}
                  >
                    <Check size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={!desktop}
                    aria-expanded={repeating === event.id}
                    onClick={() =>
                      setRepeating((laufend) => (laufend === event.id ? null : event.id))
                    }
                    aria-label={t("st.repeatSet")}
                    title={t("st.repeatSet")}
                    className={`${griff} disabled:opacity-40 ${
                      repeating === event.id || event.repeat_rule
                        ? "text-accent"
                        : "text-ink3 hover:text-accent"
                    }`}
                  >
                    <Repeat size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={!desktop}
                    onClick={() => void removeUnit(event)}
                    aria-label={t("common.delete")}
                    className={`${griff} text-ink3 hover:text-loss disabled:opacity-40`}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {repeating === event.id && (
                <div className="blatt-formular pb-2">
                  <RepeatForm
                    blatt
                    day={event.day}
                    current={event.repeat_rule}
                    busy={busy}
                    onCancel={() => setRepeating(null)}
                    onApply={(rule, until) => void applyRepeat(event, rule, until)}
                    onDeleteSeries={
                      event.series_key ? () => void deleteSeries(event) : undefined
                    }
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const einheiten = (
    <div ref={listeRef} className="mt-4 scroll-mt-4">
      <Rubrik>{t("st.unitsLibrary")}</Rubrik>
      {/* Aufklappen, Zieltag und Raster stehen in einer Zeile · alles drei
          stellt ein, was der Griff „Planen" gleich tut. */}
      <div className="blatt-formular mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line pb-2">
        <button
          type="button"
          onClick={() => setListeOffen((wert) => !wert)}
          aria-expanded={listeOffen}
          className="flex min-h-11 items-center gap-2 text-[12.5px] text-ink2 hover:text-ink"
        >
          <span aria-hidden className="blatt-zahl w-3 text-[13px] leading-none text-ink3">
            {listeOffen ? "−" : "+"}
          </span>
          {t("st.dragHint")}
        </button>
        <span className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
          <label className="flex items-baseline gap-2 text-[11px] text-ink3">
            {t("st.planFor")}
            <input
              type="date"
              value={planningDay}
              onChange={(event) => setPlanningDay(event.target.value)}
              className="border-line text-[12px] text-ink focus:border-accent-dim focus:outline-none"
            />
          </label>
          <label className="flex items-baseline gap-2 text-[11px] text-ink3">
            {t("st.repeatTitle")}
            <select
              value={planRepeat}
              onChange={(event) => setPlanRepeat(event.target.value as RepeatRule)}
              aria-label={t("st.repeatTitle")}
              className="border-line text-[12px] text-ink focus:border-accent-dim focus:outline-none"
            >
              <option value="">{t("st.repeatOnce")}</option>
              {REPEAT_RULES.map((wert) => (
                <option key={wert} value={wert}>
                  {t(REPEAT_LABEL[wert])}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!desktop}
            onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
            aria-label={t("st.addUnit")}
            className="flex h-[26px] w-[26px] items-center justify-center border border-line text-ink3 hover:text-accent disabled:opacity-40"
          >
            <Plus size={13} />
          </button>
        </span>
      </div>

      {listeOffen &&
        visibleCalendar.templates.map((template) => {
          const bereiche = templateAreas(template);
          return (
            <div
              key={template.id}
              data-study-template={template.id}
              className="flex items-center gap-2.5 border-b border-line py-1.5"
              style={{ minHeight: 44 }}
            >
              <span
                onPointerDown={(pointerEvent) =>
                  startDrag(pointerEvent, {
                    kind: "template",
                    id: template.id,
                    label: templateText(template, "title", t),
                  })
                }
                className="flex-none cursor-grab touch-none text-ink3 active:cursor-grabbing"
                aria-label={t("st.dragUnit")}
              >
                <GripVertical size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">
                  {templateText(template, "title", t)}
                </span>
                <span className="block truncate text-[10.5px] text-ink3">
                  {bereiche.length > 0
                    ? bereiche.map((bereich) => t(AREA_KEY[bereich])).join(" · ")
                    : t("st.areaNone")}
                </span>
              </span>
              <span className="flex flex-none items-stretch">
                <button
                  type="button"
                  disabled={!desktop}
                  // Bearbeitet wird der Text, der auf dem Bildschirm steht ·
                  // bei einer Standardeinheit ist das die Übersetzung.
                  onClick={() =>
                    setEditing({
                      id: template.id,
                      title: templateText(template, "title", t),
                      tool: templateText(template, "tool", t),
                      description: templateText(template, "desc", t),
                      areas: bereiche,
                    })
                  }
                  aria-label={t("common.edit")}
                  className={`${griff} text-ink3 hover:text-ink disabled:opacity-40`}
                >
                  <Pencil size={13} />
                </button>
                {/* Die fünf Standardeinheiten bleiben · an ihnen plant der
                    Wochenvorschlag. */}
                {!template.builtin && (
                  <button
                    type="button"
                    disabled={!desktop}
                    onClick={() => void removeTemplate(template)}
                    aria-label={t("common.delete")}
                    className={`${griff} text-ink3 hover:text-loss disabled:opacity-40`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy || !desktop || !planningDay}
                  onClick={() => void planTemplate(template)}
                  className="ms-2.5 flex h-[26px] flex-none items-center whitespace-nowrap px-1 text-[12px] text-accent hover:text-accent-hover disabled:text-ink3"
                >
                  {t("st.plan")} →
                </button>
              </span>
            </div>
          );
        })}
    </div>
  );

  const editor = editing && (
    <div className="blatt-formular mt-4 border border-accent-dim p-3.5">
      <Feldname>{editing.id ? t("st.editUnit") : t("st.newUnit")}</Feldname>
      <div className="mt-2 grid gap-x-6 gap-y-2 min-[700px]:grid-cols-2">
        <label className="block text-[11px] text-ink3">
          {t("st.unitTitle")}
          <input
            value={editing.title}
            onChange={(event) => setEditing({ ...editing, title: event.target.value })}
            className="mt-1 w-full border-line text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
          />
        </label>
        <label className="block text-[11px] text-ink3">
          {t("st.tool")}
          <input
            value={editing.tool}
            onChange={(event) => setEditing({ ...editing, tool: event.target.value })}
            className="mt-1 w-full border-line text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
          />
        </label>
      </div>
      {/* Bereiche statt Dauer: worauf die Einheit einzahlt, entscheidet der
          Nutzer · wie lang sie wird, das Wochenbudget. */}
      <div className="mt-3 text-[11px] text-ink3">{t("st.unitAreas")}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {AREAS.map((bereich) => {
          const an = editing.areas.includes(bereich);
          return (
            <button
              key={bereich}
              type="button"
              aria-pressed={an}
              onClick={() =>
                setEditing({
                  ...editing,
                  areas: an
                    ? editing.areas.filter((eintrag) => eintrag !== bereich)
                    : [...editing.areas, bereich],
                })
              }
              className={`border px-2.5 py-1 text-[12px] ${
                an ? "border-accent text-accent" : "border-line text-ink3 hover:text-ink"
              }`}
            >
              {t(AREA_KEY[bereich])}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">{t("st.unitAreasNote")}</p>
      <label className="mt-3 block text-[11px] text-ink3">
        {t("st.description")}
        <textarea
          rows={3}
          value={editing.description}
          onChange={(event) => setEditing({ ...editing, description: event.target.value })}
          className="mt-1 w-full resize-y border-line text-[12.5px] leading-relaxed text-ink focus:border-accent-dim focus:outline-none"
        />
      </label>
      <div className="mt-3 flex justify-end gap-4">
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="min-h-11 text-[12.5px] text-ink3 hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !editing.title.trim()}
          onClick={() => void saveTemplate()}
          className="min-h-11 text-[12.5px] text-accent hover:text-accent-hover disabled:text-ink3"
        >
          {t("common.save")} →
        </button>
      </div>
    </div>
  );

  return (
    <div className="pt-4">
      <Rubrik>{t("st.weekTitle")}</Rubrik>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="text-[12.5px] text-ink2">
          {days[0].toLocaleDateString(locale, { day: "2-digit", month: "long", timeZone: "UTC" })}
          {" – "}
          {days[6].toLocaleDateString(locale, {
            day: "2-digit",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
        <span className="flex flex-1 flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5">
          {/* Der Griff, der den Wochenvorschlag anfordert · ein Bedienteil und
              nichts sonst, deshalb nur neu gesetzt (siehe blatt.css). */}
          {vorschlagAktion && (
            <span className="blatt-formular min-w-0">{vorschlagAktion}</span>
          )}
          {/* Blättern wie im Register · drei Griffe auf einer Linie. */}
          <span className="flex flex-none items-center border border-line">
            <button
              type="button"
              onClick={() => setWindowStart(new Date(windowStart.getTime() - 7 * DAY_MS))}
              aria-label={t("st.prevWeek")}
              className="flex h-[26px] w-[26px] items-center justify-center text-ink3 hover:text-ink"
            >
              &#8249;
            </button>
            <button
              type="button"
              onClick={() => setWindowStart(dayStart(new Date()))}
              className="blatt-feld h-[26px] border-x border-line px-2.5 text-ink2 hover:text-ink"
            >
              {t("st.currentWeek")}
            </button>
            <button
              type="button"
              onClick={() => setWindowStart(new Date(windowStart.getTime() + 7 * DAY_MS))}
              aria-label={t("st.nextWeek")}
              className="flex h-[26px] w-[26px] items-center justify-center text-ink3 hover:text-ink"
            >
              &#8250;
            </button>
          </span>
        </span>
      </div>

      {woche}
      <div className="mt-1.5 text-[10.5px] text-ink3">{t("st.calendarHint")}</div>

      {!desktop && !storeCapture && (
        <div className="mt-2.5 border-t border-line pt-2 text-[11.5px] text-ink3">
          {t("st.plannerDesktop")}
        </div>
      )}

      {tagesListe}
      {vorschlag && <div className="blatt-formular mt-4">{vorschlag}</div>}
      {einheiten}
      {editor}

      {error && (
        <div className="mt-3 border-s-2 border-loss ps-2.5 text-[12px] text-loss">{error}</div>
      )}

      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-[1.6] text-ink3">
        {t("st.weekNote")}
      </div>

      {/* Zieh-Vorschau am Zeiger; pointer-events aus, damit elementFromPoint
          die Tageszelle darunter findet. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 border border-ink bg-panel px-2.5 py-1.5 text-[11.5px] text-ink"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
        </div>
      )}
    </div>
  );
}
