/**
 * Der Ratingverlauf der Insights · der Verlauf des Starts, ausführlich.
 *
 * Der Start zeigt die vier aktivsten Modi über sechs Monate, und mehr soll er
 * auch nicht: Er ist ein Blick. Hier ist die Frage eine andere — „wo stand ich,
 * wo war mein Höchstwert, was hat das letzte Jahr gebracht?" —, deshalb ist der
 * Zeitraum wählbar, jede Plattform-/Modus-Reihe lässt sich ein- und
 * ausblenden, und unter dem Bild steht je Reihe, was man sonst mit dem Zeiger
 * aus der Linie lesen müsste.
 *
 * Gerechnet wird in `buildRatingHistory` (lib/stats.ts); die Seite hält
 * Zeitraum und Auswahl, damit beide Fassungen denselben Stand zeigen.
 */
import { Card, Chip } from "../../components/ui";
import RatingHistoryChart from "../../components/RatingHistoryChart";
import { RATING_COLORS, chart } from "../../components/chartTheme";
import { useMobileShell } from "../../components/MobileShell";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import { RANGE_KEY, shortDate } from "./ratingHistoryText";
import { RATING_RANGES, type RatingHistory, type RatingRange } from "../../lib/ratingHistory";

export default function RatingHistoryCard({
  data,
  range,
  onRange,
  hidden,
  onToggle,
}: {
  data: RatingHistory;
  range: RatingRange;
  onRange: (range: RatingRange) => void;
  /** Ausgeblendete Reihen · nach `series.id`. */
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const mobile = useMobileShell();
  const visible = data.series.filter((series) => !hidden.has(series.id));
  // Eine Reihe ohne Stützpunkt im Zeitraum zieht keine Linie · sie steht in
  // der Tabelle trotzdem da, damit man sieht, dass sie ruht.
  const drawn = visible.filter((series) => data.history.some((point) => point[series.key] != null));

  return (
    <Card
      title={t("ins.ratingTitle")}
      action={
        <div className="flex flex-wrap justify-end gap-1.5">
          {RATING_RANGES.map((value) => (
            <Chip key={value} active={range === value} onClick={() => onRange(value)}>
              {t(RANGE_KEY[value])}
            </Chip>
          ))}
        </div>
      }
    >
      {data.series.length === 0 ? (
        <p className="text-[12.5px] text-ink3">{t("ins.ratingEmpty")}</p>
      ) : (
        <>
          <div data-rating-history>
            <RatingHistoryChart
              history={data.history}
              series={drawn}
              colors={RATING_COLORS}
              live
            />
          </div>

          <div className="mt-3 overflow-x-auto border-t border-line pt-2">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-ink3">
                  <th className="py-1.5 pr-2 font-normal">{t("ins.ratingMode")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("ins.ratingCurrent")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("ins.ratingChange")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("ins.ratingPeak")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("ins.ratingLow")}</th>
                  <th className="py-1.5 text-right font-normal">{t("ins.ratingGames")}</th>
                </tr>
              </thead>
              <tbody>
                {data.summaries.map((row) => {
                  const on = !hidden.has(row.series.id);
                  const color = RATING_COLORS[row.series.id] ?? chart.draw;
                  return (
                    <tr key={row.series.id} className="border-t border-line">
                      <td className="py-1 pr-2">
                        {/* Die Zeile ist zugleich die Legende und der Schalter
                            für ihre Linie. */}
                        <button
                          type="button"
                          onClick={() => onToggle(row.series.id)}
                          aria-pressed={on}
                          title={t("ins.ratingShown")}
                          className={`flex min-h-11 items-center gap-2 text-left ${
                            on ? "text-ink" : "text-ink3 line-through"
                          }`}
                        >
                          <span
                            aria-hidden
                            className="inline-block h-0.5 w-4 shrink-0 rounded-full"
                            style={{ background: on ? color : "var(--color-line2)" }}
                          />
                          {row.series.label}
                        </button>
                      </td>
                      <td className="py-1 pr-2 text-right font-medium tabular-nums">
                        {row.current == null ? "—" : deInt(row.current)}
                      </td>
                      <td
                        className="py-1 pr-2 text-right tabular-nums"
                        style={{
                          color:
                            row.change == null || row.change === 0
                              ? "var(--color-ink3)"
                              : row.change > 0
                                ? "var(--color-win)"
                                : "var(--color-loss)",
                        }}
                      >
                        {row.change == null
                          ? "—"
                          : `${row.change > 0 ? "+" : row.change < 0 ? "−" : "±"}${deInt(Math.abs(row.change))}`}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {row.peak == null ? "—" : deInt(row.peak)}
                        {row.peakTs != null && !mobile && (
                          <span className="ml-1.5 text-[11px] text-ink3">{shortDate(row.peakTs)}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {row.low == null ? "—" : deInt(row.low)}
                        {row.lowTs != null && !mobile && (
                          <span className="ml-1.5 text-[11px] text-ink3">{shortDate(row.lowTs)}</span>
                        )}
                      </td>
                      <td className="py-1 text-right tabular-nums text-ink2">{deInt(row.games)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("ins.ratingNote")}</p>
        </>
      )}
    </Card>
  );
}
