/**
 * Der Ratingverlauf im Diagramm-Modus · eine Figur mit ihrer Tabelle.
 *
 * Dieselben Zahlen wie in der gewöhnlichen Fassung (`buildRatingHistory`,
 * gehalten von der Seite), gesetzt wie eine Tabelle im Turnierbuch: oben die
 * Zeiträume als Wörter auf einer Linie, darunter die Linien der Wertungen
 * zwischen zwei Haarlinien, mit drei Hilfslinien und ihren Zahlen am Rand, und
 * darunter je Reihe Stand, Veränderung, Höchst- und Tiefstwert und Partien.
 * Die Zeile der Tabelle ist zugleich die Legende und der Schalter ihrer Linie.
 *
 * Kein Recharts: Das Blatt zeichnet seine Bilder selbst, als Striche in den
 * Tokens des Themas (siehe `Kurve` in components/blatt/Satz.tsx).
 */
import { Blatttabelle, Fussnote, Rubrik } from "../../../components/blatt/Satz";
import { RATING_COLORS, chart } from "../../../components/chartTheme";
import { useI18n } from "../../../lib/i18n";
import { deInt } from "../../../lib/format";
import { RATING_RANGES, type RatingHistory, type RatingRange } from "../../../lib/ratingHistory";
import { RANGE_KEY, shortDate } from "../../insights/ratingHistoryText";

const BREITE = 720;

export interface WertungsverlaufProps {
  daten: RatingHistory;
  zeitraum: RatingRange;
  onZeitraum: (range: RatingRange) => void;
  ausgeblendet: ReadonlySet<string>;
  onUmschalten: (id: string) => void;
}

/** Hilfslinien auf runden Werten · so fein, dass drei bis fünf ins Bild passen. */
function hilfswerte(lo: number, hi: number): number[] {
  const spanne = hi - lo;
  const schritt = [5, 10, 25, 50, 100, 200, 500].find((wert) => spanne / wert <= 5) ?? 1000;
  const werte: number[] = [];
  for (let wert = Math.ceil(lo / schritt) * schritt; wert <= hi; wert += schritt) werte.push(wert);
  return werte;
}

export default function WertungsverlaufBlatt({
  daten,
  zeitraum,
  onZeitraum,
  ausgeblendet,
  onUmschalten,
  mobile,
}: WertungsverlaufProps & { mobile: boolean }) {
  const { t } = useI18n();
  const hoehe = mobile ? 150 : 190;
  const sichtbar = daten.series.filter((reihe) => !ausgeblendet.has(reihe.id));
  const punkte = daten.history;

  const werte = punkte.flatMap((punkt) =>
    sichtbar.map((reihe) => punkt[reihe.key]).filter((wert): wert is number => typeof wert === "number")
  );
  // Etwas Luft über und unter den Linien · ein Zehntel der Spanne, mindestens
  // fünf Punkte, damit eine flache Linie nicht auf der Haarlinie liegt.
  const roh = werte.length ? [Math.min(...werte), Math.max(...werte)] : [0, 1];
  const luft = Math.max(5, (roh[1] - roh[0]) * 0.1);
  const lo = roh[0] - luft;
  const hi = roh[1] + luft;
  const x = (index: number) => (punkte.length > 1 ? (index / (punkte.length - 1)) * BREITE : 0);
  const y = (wert: number) => hoehe - ((wert - lo) / (hi - lo || 1)) * (hoehe - 8) - 4;

  /** Eine Linie je Reihe · an Lücken (ruhender Modus) abgesetzt. */
  const linien = (key: string) => {
    const stuecke: string[] = [];
    let aktuell: string[] = [];
    punkte.forEach((punkt, index) => {
      const wert = punkt[key];
      if (typeof wert === "number") {
        aktuell.push(`${x(index).toFixed(1)},${y(wert).toFixed(1)}`);
      } else if (aktuell.length) {
        stuecke.push(aktuell.join(" "));
        aktuell = [];
      }
    });
    if (aktuell.length) stuecke.push(aktuell.join(" "));
    return stuecke;
  };

  const monate = punkte
    .map((punkt, index) => ({ label: punkt.month, index }))
    .filter((eintrag) => eintrag.label);

  const zeitraumZeile = (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 border-b border-line pb-[3px] text-[12.5px]">
      {RATING_RANGES.map((wert) => (
        <button
          key={wert}
          type="button"
          onClick={() => onZeitraum(wert)}
          aria-pressed={zeitraum === wert}
          className={`inline-flex min-h-11 items-center ${
            zeitraum === wert
              ? "text-ink underline"
              : "text-ink3 hover:text-ink"
          }`}
        >
          {t(RANGE_KEY[wert])}
        </button>
      ))}
    </div>
  );

  return (
    <div data-rating-history>
      <Rubrik>{t("ins.ratingTitle")}</Rubrik>
      {zeitraumZeile}
      {daten.series.length === 0 ? (
        <div className="py-3 text-[12.5px] text-ink3">{t("ins.ratingEmpty")}</div>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            {/* Die Zahlen der Hilfslinien am Rand · außerhalb der Zeichnung,
                damit sie nicht mit ihr skaliert werden. */}
            <div className="relative w-9 flex-none" style={{ height: hoehe }} aria-hidden>
              {werte.length > 0 &&
                hilfswerte(lo, hi).map((wert) => (
                  <span
                    key={wert}
                    className="blatt-zahl absolute -translate-y-1/2 text-[10px] text-ink3"
                    style={{ top: y(wert), insetInlineEnd: 0 }}
                  >
                    {deInt(wert)}
                  </span>
                ))}
            </div>
            <div className="min-w-0 flex-1 border-y border-line">
              <svg
                viewBox={`0 0 ${BREITE} ${hoehe}`}
                preserveAspectRatio="none"
                width="100%"
                height={hoehe}
                className="block overflow-visible"
                aria-hidden="true"
              >
                {werte.length > 0 &&
                  hilfswerte(lo, hi).map((wert) => (
                    <line
                      key={wert}
                      x1="0"
                      x2={BREITE}
                      y1={y(wert)}
                      y2={y(wert)}
                      stroke="var(--color-line)"
                      strokeWidth="1"
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                {sichtbar.map((reihe) =>
                  linien(reihe.key).map((stueck, index) => (
                    <polyline
                      key={`${reihe.id}-${index}`}
                      points={stueck}
                      fill="none"
                      stroke={RATING_COLORS[reihe.id] ?? chart.draw}
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))
                )}
              </svg>
            </div>
          </div>
          {/* Die Monate unter der Figur · an ihrer Stelle, nicht gleich verteilt. */}
          <div className="relative mt-1 h-3.5" style={{ marginInlineStart: 44 }}>
            {monate.map((monat) => (
              <span
                key={monat.index}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-ink3"
                style={{ left: `${(x(monat.index) / BREITE) * 100}%` }}
              >
                {monat.label}
              </span>
            ))}
          </div>

          <div className="mt-3">
            <Blatttabelle
              hoehe={34}
              spalten={[
                { label: t("ins.ratingMode") },
                { label: t("ins.ratingCurrent"), breite: 56, zahl: true, rechts: true },
                { label: t("ins.ratingChange"), breite: mobile ? 52 : 74, zahl: true, rechts: true },
                { label: t("ins.ratingPeak"), breite: mobile ? 56 : 104, zahl: true, rechts: true },
                { label: t("ins.ratingLow"), breite: mobile ? 56 : 104, zahl: true, rechts: true },
                { label: t("ins.ratingGames"), breite: 52, zahl: true, rechts: true, blass: true },
              ]}
              zeilen={daten.summaries.map((zeile) => {
                const an = !ausgeblendet.has(zeile.series.id);
                const farbe = RATING_COLORS[zeile.series.id] ?? chart.draw;
                return [
                  <button
                    key="reihe"
                    type="button"
                    onClick={() => onUmschalten(zeile.series.id)}
                    aria-pressed={an}
                    title={t("ins.ratingShown")}
                    className={`flex max-w-full items-center gap-2 text-start ${
                      an ? "text-ink" : "text-ink3 line-through"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="inline-block h-[2px] w-4 flex-none"
                      style={{ background: an ? farbe : "var(--color-line2)" }}
                    />
                    <span className="truncate">{zeile.series.label}</span>
                  </button>,
                  zeile.current == null ? "—" : deInt(zeile.current),
                  <span
                    key="d"
                    style={{
                      color:
                        zeile.change == null || zeile.change === 0
                          ? "var(--color-ink3)"
                          : zeile.change > 0
                            ? "var(--color-win)"
                            : "var(--color-loss)",
                    }}
                  >
                    {zeile.change == null
                      ? "—"
                      : `${zeile.change > 0 ? "+" : zeile.change < 0 ? "−" : "±"}${deInt(Math.abs(zeile.change))}`}
                  </span>,
                  <span key="h">
                    {zeile.peak == null ? "—" : deInt(zeile.peak)}
                    {!mobile && zeile.peakTs != null && (
                      <span className="text-[10px] text-ink3"> {shortDate(zeile.peakTs)}</span>
                    )}
                  </span>,
                  <span key="t">
                    {zeile.low == null ? "—" : deInt(zeile.low)}
                    {!mobile && zeile.lowTs != null && (
                      <span className="text-[10px] text-ink3"> {shortDate(zeile.lowTs)}</span>
                    )}
                  </span>,
                  deInt(zeile.games),
                ];
              })}
            />
          </div>
          <Fussnote linie>{t("ins.ratingNote")}</Fussnote>
        </>
      )}
    </div>
  );
}
