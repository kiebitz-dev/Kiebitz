/**
 * Der Wochenbericht · ein Symbol im Kopf der Seite, der Bericht als Dialog.
 *
 * Er stand zuerst als Karte ganz oben im Study-Reiter und nahm dort den halben
 * Bildschirm ein — an jedem Tag, an dem er noch nicht gelesen war, verdrängte
 * er genau die Frage, mit der man diese Seite öffnet („was mache ich jetzt").
 * Ein Rückblick ist aber kein Tagesgeschäft: Er wird einmal gelesen und dann
 * höchstens noch einmal nachgeschlagen.
 *
 * Deshalb jetzt zweiteilig. Im Kopf sitzt ein Symbol neben Rating und Serie ·
 * es leuchtet, solange der Bericht der Woche ungelesen ist, und bleibt danach
 * ruhig stehen. Das ist der zweite Gewinn: Der Bericht verschwindet nicht mehr
 * für immer, wenn man ihn einmal weggeklickt hat, sondern ist die Woche über
 * erreichbar. Ein Menüpunkt ist er trotzdem nicht — nichts in der Navigation
 * verweist auf ihn.
 *
 * Der Dialog selbst trägt drei Blöcke in fester Reihenfolge, weil sie eine
 * Kette bilden: was sich verändert hat → was das Training dazu beigetragen
 * haben könnte → was daraus für die begonnene Woche folgt. Der letzte Block
 * ist der einzige mit einem Knopf: Der Bericht endet in einer Handlung und
 * nicht in einer Zahl.
 *
 * Gerechnet wird nichts hier · siehe `lib/weekly.ts`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarCheck, Check, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { isoWeek } from "../lib/dates";
import { localizeFindingParams } from "../lib/findings";
import { ratingNoise } from "../lib/effect";
import { AREA_COLOR, AREA_KEY } from "../lib/study";
import { useBackDismiss } from "../lib/backDismiss";
import { useMobileShell } from "./MobileShell";
import { SHEET_ROOT_ID } from "./MobileSheet";
import {
  formatDelta,
  formatMetric,
  reportHeadline,
  type WeeklyChange,
  type WeeklyReport,
} from "../lib/weekly";
import { PlusLock } from "./PlusLock";

/** Überschrift eines der drei Blöcke · sie tragen den Bericht, nicht die Zahlen. */
function BlockTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-ink3">{children}</h3>
  );
}

/**
 * Ein Block als Karte · dieselbe Form, in der die Verordnungen des Coaches
 * stehen (siehe components/PrescriptionCard.tsx).
 *
 * Vorher lagen die drei Blöcke als durchlaufender Text übereinander und waren
 * nur an ihren Überschriften auseinanderzuhalten. Auf dem Handy, wo ohnehin
 * jede Zeile umbricht, wurde daraus eine Wand: Überschrift, Zahlenzeile,
 * Fußnote, Überschrift, Zahlenzeile · nichts trennte den Rückblick von der
 * Trainingszeit. Als Karten hat jeder Block eine Kante, und die Trennung
 * kostet keine Zeile Text.
 */
function Block({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div data-weekly-block={name} className="rounded-xl border border-line bg-panel2 px-3.5 py-3">
      {children}
    </div>
  );
}

/**
 * Die Veränderung als Plakette · Pfeilrichtung aus dem Vorzeichen, Farbe
 * daraus, ob sie in die gewünschte Richtung zeigt.
 *
 * Beides zusammen, weil beides verschieden ist: Bei „Patzer/100 Züge" ist
 * weniger besser, der Pfeil zeigt dann nach unten und die Plakette ist trotzdem
 * grün. Als bloße farbige Zahl am Zeilenende war das nicht zu sehen.
 */
function DeltaPill({ change, quiet = false }: { change: WeeklyChange; quiet?: boolean }) {
  const tone = quiet
    ? "border-line2 bg-panel3 text-ink3"
    : change.better
      ? "border-accent-dim bg-accent-soft text-accent"
      : "border-loss-dim bg-loss-soft text-loss";
  const Arrow = change.delta > 0 ? TrendingUp : change.delta < 0 ? TrendingDown : Minus;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[11.5px] font-medium tabular-nums ${tone}`}
    >
      <Arrow size={11} aria-hidden="true" />
      {formatDelta(change)}
    </span>
  );
}

/**
 * Eine Veränderung: Name, Vorher-Nachher, Vorzeichen.
 *
 * `quiet` ist derselbe Aufbau in Grau · eine Bewegung, die ihre Rauschgrenze
 * nicht erreicht hat, wird gezeigt und als das beschriftet, was sie ist. Sie
 * wegzulassen wäre ehrlicher, aber der Bericht stünde dann in ruhigen Wochen
 * leer da; sie wie einen Fortschritt zu färben wäre gelogen.
 */
function ChangeRow({ change, quiet = false }: { change: WeeklyChange; quiet?: boolean }) {
  const { t } = useI18n();
  return (
    // Umbrechend statt abschneidend: „Züge in Zeitnot" neben zwei Zahlen und
    // einer Plakette passt auf ein Telefon nicht in eine Zeile, und abgekürzt
    // („Züge in Zeitn…") ist der Name der Kennzahl gerade das, was fehlt. Auf
    // dem Desktop bleibt es eine Zeile · dort ist der Platz da.
    <li
      data-weekly-change={change.key}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
    >
      <span className="min-w-0 text-[12.5px] text-ink2">{t(`metric.${change.key}` as Key)}</span>
      <span className="ms-auto flex items-center gap-2">
        <span className="text-[12.5px] tabular-nums text-ink3">
          {formatMetric(change.from, change.unit)}
          <ArrowRight size={11} className="mx-1 inline align-[-1px]" aria-hidden="true" />
          <span className="text-[13.5px] font-semibold text-ink">
            {formatMetric(change.to, change.unit)}
          </span>
        </span>
        <DeltaPill change={change} quiet={quiet} />
      </span>
    </li>
  );
}

/**
 * Die Woche als ein Balken · je Bereich ein Stück, Skala bis Ziel oder Ist.
 *
 * Dieselbe Figur wie im Study-Reiter (siehe components/WeekBudgetBar.tsx), und
 * aus demselben Grund: Wie sich die Zeit verteilt hat, ist eine Fläche und
 * keine Liste. Die Liste darunter bleibt trotzdem — sie trägt die Kennzahl,
 * die zu jedem Bereich gehört.
 */
function AreaBar({ report }: { report: WeeklyReport }) {
  const scale = Math.max(report.target, report.minutes, 1);
  const filled = report.byArea.filter((entry) => entry.minutes > 0);
  return (
    <div className="relative mt-2.5 flex h-2 overflow-hidden rounded-full bg-panel3">
      {filled.map((entry) => (
        <div
          key={entry.area}
          style={{
            width: `${(entry.minutes / scale) * 100}%`,
            background: AREA_COLOR[entry.area],
          }}
        />
      ))}
      {/* Die Zielmarke steht nur da, wo sie etwas sagt: innerhalb des Balkens,
          also in einer Woche, die über ihr Ziel hinausgegangen ist. */}
      {report.target > 0 && report.minutes > report.target && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-ink/60"
          style={{ insetInlineStart: `${(report.target / scale) * 100}%` }}
        />
      )}
    </div>
  );
}

/**
 * Das Symbol im Kopf der Seite.
 *
 * Es steht neben Rating und Serie, weil es dieselbe Art Angabe ist: eine
 * Kennzahl über die Woche, kein Bedienelement des Tagesgeschäfts. Ungelesen
 * trägt es die Akzentfarbe, danach steht es ruhig daneben — der Bericht bleibt
 * die Woche über erreichbar, statt nach dem ersten Wegklicken verschwunden zu
 * sein.
 */
export function WeeklyReportButton({
  unread,
  onClick,
}: {
  /** Ist der Bericht dieser Woche noch ungelesen? */
  unread: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  // Überall nur das Symbol · mobil trug der Knopf einmal seinen Namen, weil er
  // dort in einer eigenen Zeile stand und ein Quadrat allein wie ein Rest
  // aussah. Inzwischen steht er in derselben Zeile wie Rating und Serie, und
  // dort ist „Wochenbericht" das Wort, das den beiden Kennzahlen den Platz
  // wegnimmt. Beschriftet bleibt er trotzdem · über `aria-label` und `title`.
  const mobile = useMobileShell();
  const label = unread ? t("wk.openNew") : t("wk.open");
  return (
    <button
      type="button"
      data-weekly-open=""
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border text-[13px] transition-colors ${
        mobile ? "px-2.5 py-2" : "px-3 py-1.5"
      } ${
        unread
          ? "border-accent-dim bg-accent-soft text-accent hover:border-accent"
          : "border-line bg-panel text-ink3 hover:border-line2 hover:text-ink"
      }`}
    >
      <CalendarCheck size={15} aria-hidden="true" />
      {/* Ein Punkt statt einer Zahl · es gibt genau einen Bericht pro Woche,
          und „1" daneben wäre eine Zählung ohne Gegenstand. */}
      {unread && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
    </button>
  );
}

export default function WeeklyReportDialog({
  report,
  mobile,
  onClose,
  onAction,
}: {
  report: WeeklyReport;
  mobile: boolean;
  onClose: () => void;
  /** Der Knopf des letzten Blocks · dieselbe Verordnungslogik wie im Coach. */
  onAction: () => void;
}) {
  const { locale, t } = useI18n();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Wohin der Bericht gezeichnet wird.
   *
   * Auf dem Handy in denselben Behälter wie das Detailblatt der Partien · er
   * deckt genau die Fläche von <main>. Das hat zwei Gründe, und beide fehlten,
   * solange der Bericht über dem ganzen Bildschirm lag: Die Navigationsleiste
   * bleibt sichtbar und bedienbar, statt unter dem Schleier zu verschwinden.
   * Und das Anzeigenband darunter ist kein Element dieser Seite, sondern eine
   * native Fläche über der WebView — was dort hinläuft, kann sie nicht
   * überdecken, sondern verschwindet dahinter. Oberhalb davon zu bleiben ist
   * der einzige Weg, den ganzen Bericht zu sehen.
   *
   * Ausserhalb der mobilen Schale (Desktop, einzeln gerenderte Tests) gibt es
   * den Behälter nicht · dann bleibt es beim Dialog über dem Fenster.
   */
  const [container] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" || !mobile ? null : document.getElementById(SHEET_ROOT_ID)
  );

  // Escape schließt · derselbe Griff wie in den übrigen Dialogen der App.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Android-Zurück schließt den Bericht, statt die App zu verlassen.
  useBackDismiss(onClose);

  const from = new Date(report.week.start * 1_000);
  const to = new Date((report.week.end - 86_400) * 1_000);
  // Die Tagesgrenzen sind UTC · ohne `timeZone` würde westlich von Greenwich
  // der Sonntag davor als Wochenanfang dastehen.
  const day = (date: Date) =>
    date.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  // Bereiche in der Reihenfolge ihrer Zeit · was am meisten Zeit gekostet hat,
  // ist das, worüber der Block Auskunft geben soll.
  const trained = report.byArea
    .filter((entry) => entry.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const ratingLine =
    report.rating &&
    (Math.abs(report.rating.delta) > ratingNoise(report.rating.games)
      ? t("wk.ratingMoved", {
          d: `${report.rating.delta > 0 ? "+" : ""}${deInt(report.rating.delta)}`,
          n: deInt(report.rating.games),
        })
      : t("wk.ratingNoise", { n: deInt(report.rating.games) }));

  const changed = (
    <Block name="changes">
      <BlockTitle>{t("wk.blockChanged")}</BlockTitle>
      {report.changes.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {report.changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </ul>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.changesQuiet")}</p>
          {report.quiet && (
            <ul className="mt-2.5">
              <ChangeRow change={report.quiet} quiet />
            </ul>
          )}
        </>
      )}
      {ratingLine && (
        <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
          {ratingLine}
        </p>
      )}
    </Block>
  );

  /** Der längste Bereich gibt den Maßstab der Balken · nicht das Wochenziel. */
  const longest = Math.max(1, ...trained.map((entry) => entry.minutes));

  const effect = (
    <Block name="effect">
      <BlockTitle>{t("wk.blockEffect")}</BlockTitle>
      <p className="text-[13px] text-ink2">
        <span className="text-[17px] font-semibold tabular-nums text-ink">
          {deInt(report.minutes)}
        </span>{" "}
        {report.target > 0
          ? t("wk.minutesOfTarget", { m: deInt(report.target) })
          : t("wk.minutesPlain")}
        {report.previousMinutes > 0 && (
          <span className="text-ink3">
            {" · "}
            {t("wk.minutesBefore", { m: deInt(report.previousMinutes) })}
          </span>
        )}
      </p>
      {trained.length > 0 ? (
        <>
          <AreaBar report={report} />
          <ul className="mt-3 flex flex-col gap-2.5">
            {trained.map((entry) => (
              <li key={entry.area} data-weekly-area={entry.area} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: AREA_COLOR[entry.area] }}
                  />
                  {/* Feste Breite, damit die Balken auf einer Linie beginnen ·
                      an unterschiedlich langen Namen ausgerichtet wären sie
                      fünf verschieden lange Striche ohne gemeinsamen Anfang. */}
                  <span className="w-[66px] shrink-0 truncate text-[12px] text-ink2">
                    {t(AREA_KEY[entry.area])}
                  </span>
                  <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(entry.minutes / longest) * 100}%`,
                        background: AREA_COLOR[entry.area],
                      }}
                    />
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink">
                    {t("plan.minutes", { m: deInt(entry.minutes) })}
                  </span>
                </div>
                {/* Die Kennzahl des Bereichs steht unter seiner Zeile und nicht
                    daneben: „Im Repertoire geblieben +6,7 %" ist auf einem
                    Telefon breiter als alles, was links davon stünde.

                    Läuft der Bereich seit mehreren Wochen, steht dort die
                    Serie statt der Woche · derselbe Platz, der längere Bogen
                    und die beiden Zahlen dazu: „3. Woche in Folge ·
                    Endspiel-Genauigkeit 71 → 78". Das ist der ganze
                    Wirkungsnachweis; siehe `WeeklyRun` in lib/weekly.ts. */}
                {entry.run ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ps-3.5">
                    <span className="min-w-0 text-[11.5px] text-ink3">
                      {t("wk.areaRun", { n: deInt(entry.run.weeks) })}
                      {" · "}
                      {t(`metric.${entry.run.change.key}` as Key)}
                    </span>
                    <span className="ms-auto flex items-center gap-2">
                      <span className="text-[11.5px] tabular-nums text-ink3">
                        {formatMetric(entry.run.change.from, entry.run.change.unit)}
                        <ArrowRight size={10} className="mx-1 inline align-[-1px]" aria-hidden="true" />
                        <span className="text-[12.5px] font-semibold text-ink">
                          {formatMetric(entry.run.change.to, entry.run.change.unit)}
                        </span>
                      </span>
                      <DeltaPill change={entry.run.change} quiet={!entry.run.change.moved} />
                    </span>
                  </div>
                ) : (
                  entry.change && (
                    <div className="flex items-center justify-between gap-2 ps-3.5">
                      <span className="min-w-0 text-[11.5px] text-ink3">
                        {t(`metric.${entry.change.key}` as Key)}
                      </span>
                      <DeltaPill change={entry.change} quiet={!entry.change.moved} />
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.effectNone")}</p>
      )}
      <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
        {t("wk.effectNote")}
      </p>
    </Block>
  );

  const next = report.next;
  const nextParams = next ? localizeFindingParams(next.finding.params, t, locale) : undefined;
  const doseParams: Record<string, string | number> = {};
  if (next) {
    for (const [key, value] of Object.entries(next.doseParams)) {
      doseParams[key] = typeof value === "number" ? deInt(value) : value;
    }
    if (typeof doseParams.theme === "string" && doseParams.theme) {
      doseParams.theme = localizeFindingParams({ theme: doseParams.theme }, t, locale).theme;
    }
  }

  const nextBlock = (
    <Block name="next">
      <BlockTitle>{t("wk.blockNext")}</BlockTitle>
      {next ? (
        <div className="flex flex-col">
          <div
            className={`font-semibold leading-snug text-ink ${mobile ? "text-[14px]" : "text-[13.5px]"}`}
          >
            {t(next.finding.titleKey, nextParams)}
          </div>
          {/* Die Dosis in derselben Form wie auf der Verordnungskarte des
              Coaches · es ist dieselbe Angabe, und sie soll auch so aussehen. */}
          {next.doseKey && (
            <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-accent-dim bg-accent-soft px-2.5 py-2">
              <Check size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <span className="text-[12.5px] leading-relaxed text-accent">
                {t(next.doseKey, doseParams)}
              </span>
            </div>
          )}
          {next.action && (
            <button
              type="button"
              onClick={onAction}
              className={`mt-3 inline-flex items-center justify-center gap-2 self-start rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px] font-medium text-ink2 transition-colors hover:border-line2 hover:text-ink ${
                mobile ? "h-11 w-full self-stretch" : ""
              }`}
            >
              {t(`fnd.action.${next.action.kind}` as Key)}
            </button>
          )}
        </div>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.nextNone")}</p>
      )}
    </Block>
  );

  // Die deutlichste Bewegung gibt den Ton · dieselbe, aus der `reportHeadline`
  // seinen Satz baut.
  const leading = report.changes[0];
  const heroTone = leading
    ? leading.better
      ? "var(--color-accent)"
      : "var(--color-loss)"
    : "var(--color-line2)";

  const dialog = (
    <div
      className={`${container ? "absolute z-40" : "fixed z-50"} inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px] ${
        mobile ? "p-3" : "p-4"
      }`}
      // Ohne Behälter liegt der Schleier über der ganzen Fläche — auch unter
      // Statusleiste und Navigationsleiste, weil die App randlos zeichnet. Ohne
      // diesen Zuschlag begann der Bericht hinter der Uhr und endete hinter den
      // Systemtasten. Der Rand des Dialogs trägt sie deshalb zusätzlich zu
      // seinem eigenen Abstand; der Schleier bleibt randlos. Im Behälter der
      // mobilen Schale erledigt das die Schale selbst.
      style={
        mobile && !container
          ? {
              paddingTop: "calc(0.75rem + env(safe-area-inset-top))",
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-weekly-report=""
        // Mobil an der Höhe des gepolsterten Schleiers und nicht an `vh`: `vh`
        // zählt die Systemleisten mit, die der Zuschlag oben gerade frei
        // gehalten hat, und der Bericht liefe wieder darunter.
        className={`flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50 ${
          mobile ? "max-h-full" : "max-h-[92vh]"
        }`}
      >
        <div className={`flex items-start gap-3 border-b border-line py-3.5 ${mobile ? "px-3.5" : "px-5"}`}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <CalendarCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="weekly-report-title" className="text-[16px] font-semibold">
              {t("wk.title")}
            </h2>
            <p className="mt-0.5 text-[12px] tabular-nums text-ink3">
              {t("wk.weekRange", { w: deInt(isoWeek(from)), a: day(from), b: day(to) })}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("wk.close")}
            title={t("wk.close")}
            className="-me-1 shrink-0 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Gesperrt bleibt der Bericht sichtbar, aber unlesbar · wer den
            Knopf im Kopf gefunden hat, soll sehen, was dahinter steckt, ohne
            es geschenkt zu bekommen. Der Schließen-Knopf sitzt außerhalb der
            Sperre und funktioniert weiter. */}
        <div className={`min-h-0 flex-1 overflow-auto py-4 ${mobile ? "px-3.5" : "px-5"}`}>
          <PlusLock feature="adaptive_plan" label={t("wk.plusLabel")}>
            {/* Der Aufmacher trägt die Farbe der Woche an der Kante · grün,
                wenn die deutlichste Bewegung in die gewünschte Richtung ging,
                rot, wenn nicht, grau in einer Woche ohne Aussage. Der Satz
                daneben sagt dasselbe in Worten; die Kante sagt es, bevor man
                ihn gelesen hat. */}
            <div
              data-weekly-hero=""
              style={{ borderInlineStartColor: heroTone, borderInlineStartWidth: 3 }}
              className="rounded-xl border border-line bg-panel2 px-3.5 py-3"
            >
              <p
                className={`font-semibold leading-snug text-ink ${
                  mobile ? "text-[15px]" : "text-[15.5px]"
                }`}
              >
                {reportHeadline(report, t)}
              </p>
              <p className="mt-1.5 text-[12px] tabular-nums text-ink3">
                {t("wk.summary", {
                  g: deInt(report.games),
                  d: deInt(report.activeDays),
                  m: deInt(report.minutes),
                })}
              </p>
            </div>
            {/* Untereinander und nicht nebeneinander · die drei Blöcke sind
                eine Kette, und in der Breite eines Dialogs wären drei Spalten
                so schmal, dass „Patzer/100 Züge" abgeschnitten dasteht. */}
            <div className="mt-3 flex flex-col gap-3">
              {changed}
              {effect}
              {nextBlock}
            </div>
          </PlusLock>
        </div>
      </div>
    </div>
  );

  return container ? createPortal(dialog, container) : dialog;
}
