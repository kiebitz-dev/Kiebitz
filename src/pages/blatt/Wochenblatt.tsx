/**
 * Der Wochenbericht im Diagramm-Modus · der Rückblick als Seite im Buch.
 *
 * Er beantwortet dieselbe Kette wie die gewöhnliche Fassung und in derselben
 * Reihenfolge: was sich verändert hat → was das Training dazu beigetragen
 * haben könnte → was daraus für die begonnene Woche folgt. Gerechnet wird auch
 * hier nichts · siehe `lib/weekly.ts`.
 *
 * Im Modus gefehlt hat er lange ganz, und das war dieselbe Art Verlust wie der
 * fehlende Plan auf dem Trainingsblatt: Wer das Blatt einschaltete, verlor den
 * einzigen Rückblick, den die App führt. Ein Layoutmodus darf die Aufteilung
 * ändern und keine Funktion kosten (siehe docs/design.md).
 *
 * Anders ist deshalb nur der Satz, an drei Stellen:
 *
 * · Die drei Blöcke sind keine Karten, sondern Rubriken mit Linie. Eine Kante
 *   trennt so gut wie ein Kasten und kostet keine Fläche.
 * · Die Plakette am Zeilenende wird zur Ziffer mit Vorzeichen. Eine
 *   Veränderung trägt ihre Richtung im Vorzeichen und ihre Bewertung in der
 *   Farbe der Ziffer — bei „Patzer je 100 Züge" ist weniger besser, und ein
 *   grünes Minus ist dort die richtige Auskunft. Was unter der Rauschgrenze
 *   blieb, steht grau da: dieselbe Aussage wie das `quiet` der gewöhnlichen
 *   Fassung, nur ohne zweite Form.
 * · Die Woche wird zur Reihe Bahnen: je Bereich eine Zeile, Balken in der
 *   Bereichsfarbe, Minuten rechts, und eingerückt darunter die Kennzahl, an
 *   der dieser Bereich sichtbar würde.
 *
 * Der Aufmacher bleibt der Satz, den `reportHeadline` baut. Seine farbige
 * Kante trägt er im Blatt nicht: Im Buchsatz steht er als Satz da, und was er
 * wert ist, sagen die Zahlen darunter.
 */
import type { ReactNode } from "react";
import { AREA_COLOR, AREA_KEY } from "../../lib/study";
import { Fussnote, Rubrik, Weg } from "../../components/blatt/Satz";
import { useI18n, type Key } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import { localizeFindingParams } from "../../lib/findings";
import { ratingNoise } from "../../lib/effect";
import {
  formatDelta,
  formatMetric,
  reportHeadline,
  type WeeklyChange,
  type WeeklyReport,
} from "../../lib/weekly";

/** Vorher → Nachher in Zahlen · dieselbe Folge wie in der Kartenfassung. */
function Spanne({ change, klein = false }: { change: WeeklyChange; klein?: boolean }) {
  return (
    <span className={`blatt-zahl flex-none text-ink3 ${klein ? "text-[11px]" : "text-[12px]"}`}>
      {formatMetric(change.from, change.unit)} <span aria-hidden>→</span>{" "}
      <span className={`text-ink ${klein ? "text-[12px]" : "text-[13px]"}`}>
        {formatMetric(change.to, change.unit)}
      </span>
    </span>
  );
}

/**
 * Das Vorzeichen als Ziffer · grün, rot oder grau.
 *
 * Grau heißt hier nicht „unwichtig", sondern „noch keine Aussage": Die
 * Bewegung hat ihre Rauschgrenze nicht erreicht. Sie wegzulassen wäre
 * ehrlicher, aber der Bericht stünde in ruhigen Wochen leer da; sie wie einen
 * Fortschritt zu färben wäre gelogen.
 */
function Vorzeichen({
  change,
  leise,
  klein = false,
}: {
  change: WeeklyChange;
  leise: boolean;
  klein?: boolean;
}) {
  return (
    <span
      className={`blatt-zahl w-[58px] flex-none text-end ${klein ? "text-[11px]" : "text-[12px]"}`}
      style={{
        color: leise
          ? "var(--color-ink3)"
          : change.better
            ? "var(--color-win)"
            : "var(--color-loss)",
      }}
    >
      {formatDelta(change)}
    </span>
  );
}

/** Eine Veränderung als Zeile · Name, Vorher → Nachher, Vorzeichen. */
function Veraenderung({
  change,
  leise = false,
  letzte = false,
}: {
  change: WeeklyChange;
  leise?: boolean;
  letzte?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      data-weekly-change={change.key}
      className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-[7px] ${
        letzte ? "" : "border-b border-line"
      }`}
    >
      <span className="min-w-0 flex-1 text-[12.5px] text-ink2">
        {t(`metric.${change.key}` as Key)}
      </span>
      <span className="ms-auto flex items-baseline gap-2.5">
        <Spanne change={change} />
        <Vorzeichen change={change} leise={leise} />
      </span>
    </div>
  );
}

export default function Wochenblatt({
  report,
  onAction,
}: {
  report: WeeklyReport;
  /** Der Griff des letzten Blocks · dieselbe Verordnung wie im Coach. */
  onAction: () => void;
}) {
  const { locale, t } = useI18n();

  // Bereiche in der Reihenfolge ihrer Zeit · was am meisten Zeit gekostet hat,
  // ist das, worüber der Block Auskunft geben soll.
  const trainiert = report.byArea
    .filter((eintrag) => eintrag.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  /** Der längste Bereich gibt den Maßstab der Balken · nicht das Wochenziel. */
  const laengster = Math.max(1, ...trainiert.map((eintrag) => eintrag.minutes));

  const ratingZeile =
    report.rating &&
    (Math.abs(report.rating.delta) > ratingNoise(report.rating.games)
      ? t("wk.ratingMoved", {
          d: `${report.rating.delta > 0 ? "+" : ""}${deInt(report.rating.delta)}`,
          n: deInt(report.rating.games),
        })
      : t("wk.ratingNoise", { n: deInt(report.rating.games) }));

  const aufmacher = (
    <div data-weekly-hero="">
      <div className="buch text-[16px] leading-[1.45] text-ink">{reportHeadline(report, t)}</div>
      <div className="blatt-zahl mt-1.5 text-[11.5px] text-ink3">
        {t("wk.summary", {
          g: deInt(report.games),
          d: deInt(report.activeDays),
          m: deInt(report.minutes),
        })}
      </div>
    </div>
  );

  const veraendert = (
    <div data-weekly-block="changes">
      <Rubrik>{t("wk.blockChanged")}</Rubrik>
      {report.changes.length > 0 ? (
        <div className="mt-0.5">
          {report.changes.map((change, index) => (
            <Veraenderung
              key={change.key}
              change={change}
              leise={!change.moved}
              letzte={index === report.changes.length - 1}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-2 text-[12.5px] leading-[1.6] text-ink3">{t("wk.changesQuiet")}</div>
          {report.quiet && (
            <div className="mt-1.5">
              <Veraenderung change={report.quiet} leise letzte />
            </div>
          )}
        </>
      )}
      {ratingZeile && <Fussnote linie>{ratingZeile}</Fussnote>}
    </div>
  );

  /**
   * Die Zeile unter einer Bereichsbahn.
   *
   * Läuft der Bereich seit mehreren Wochen, steht dort die Serie statt der
   * Woche · derselbe Platz, der längere Bogen und die beiden Zahlen dazu.
   * Das ist der ganze Wirkungsnachweis; siehe `WeeklyRun` in lib/weekly.ts.
   */
  const bereichsnachweis = (eintrag: (typeof trainiert)[number]): ReactNode => {
    const change = eintrag.run?.change ?? eintrag.change;
    if (!change) return null;
    return (
      <div
        data-weekly-area={eintrag.area}
        className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 ps-[89px]"
      >
        <span className="min-w-0 flex-1 text-[11px] text-ink3">
          {eintrag.run && (
            <>
              {t("wk.areaRun", { n: deInt(eintrag.run.weeks) })}
              {" · "}
            </>
          )}
          {t(`metric.${change.key}` as Key)}
        </span>
        <span className="ms-auto flex items-baseline gap-2.5">
          {eintrag.run && <Spanne change={change} klein />}
          <Vorzeichen change={change} leise={!change.moved} klein />
        </span>
      </div>
    );
  };

  const wirkung = (
    <div data-weekly-block="effect">
      <Rubrik
        weg={
          report.previousMinutes > 0
            ? t("wk.minutesBefore", { m: deInt(report.previousMinutes) })
            : undefined
        }
      >
        {t("wk.blockEffect")}
      </Rubrik>
      {trainiert.length > 0 ? (
        <div className="mt-0.5">
          {trainiert.map((eintrag, index) => (
            <div
              key={eintrag.area}
              className={`py-[7px] ${index === trainiert.length - 1 ? "" : "border-b border-line"}`}
            >
              <div className="flex items-center gap-[11px] text-[12.5px]">
                <span className="w-[78px] flex-none truncate text-ink2">
                  {t(AREA_KEY[eintrag.area])}
                </span>
                <span className="relative h-[9px] min-w-0 flex-1 border-b border-line2">
                  <span
                    className="absolute bottom-0 start-0 h-[7px]"
                    style={{
                      width: `${((eintrag.minutes / laengster) * 100).toFixed(1)}%`,
                      background: AREA_COLOR[eintrag.area],
                    }}
                  />
                </span>
                <span className="blatt-zahl w-[62px] flex-none text-end text-[13px] text-ink">
                  {t("plan.minutes", { m: deInt(eintrag.minutes) })}
                </span>
              </div>
              {bereichsnachweis(eintrag)}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[12.5px] leading-[1.6] text-ink3">{t("wk.effectNone")}</div>
      )}
      <Fussnote linie>{t("wk.effectNote")}</Fussnote>
    </div>
  );

  const naechste = report.next;
  const naechsteParams = naechste
    ? localizeFindingParams(naechste.finding.params, t, locale)
    : undefined;
  const dosis: Record<string, string | number> = {};
  if (naechste) {
    for (const [schluessel, wert] of Object.entries(naechste.doseParams)) {
      dosis[schluessel] = typeof wert === "number" ? deInt(wert) : wert;
    }
    if (typeof dosis.theme === "string" && dosis.theme) {
      dosis.theme = localizeFindingParams({ theme: dosis.theme }, t, locale).theme as string;
    }
  }

  const jetzt = (
    <div data-weekly-block="next">
      <Rubrik>{t("wk.blockNext")}</Rubrik>
      {naechste ? (
        <div className="mt-2">
          <div className="buch text-[15px] leading-[1.45] text-ink">
            {t(naechste.finding.titleKey, naechsteParams)}
          </div>
          {/* Die Dosis als Verordnung · dieselbe Form wie unter einem Befund
              im Blatt (siehe components/blatt/Befund.tsx): eine Zeile auf
              einer Linie, kein farbig gefüllter Kasten. */}
          {naechste.doseKey && (
            <div className="mt-2.5 border-t border-line pt-2">
              <div className="blatt-feld text-ink3">{t("blatt.prescription")}</div>
              <div className="mt-1 text-[12.5px] leading-[1.55] text-accent">
                {t(naechste.doseKey, dosis)}
              </div>
            </div>
          )}
          {naechste.action && (
            <div className="mt-0.5">
              <Weg onClick={onAction}>{t(`fnd.action.${naechste.action.kind}` as Key)}</Weg>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[12.5px] leading-[1.6] text-ink3">{t("wk.nextNone")}</div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {aufmacher}
      {veraendert}
      {wirkung}
      {jetzt}
    </div>
  );
}
