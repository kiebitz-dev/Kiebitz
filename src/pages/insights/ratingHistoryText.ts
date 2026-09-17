/**
 * Beschriftungen des Ratingverlaufs · von beiden Fassungen geteilt.
 *
 * Eine eigene Datei, damit das Blatt sie holen kann, ohne die gewöhnliche
 * Karte und mit ihr Recharts mitzuladen.
 */
import type { Key } from "../../lib/i18n";
import { dateLocale } from "../../lib/format";
import type { RatingRange } from "../../lib/ratingHistory";

export const RANGE_KEY: Record<RatingRange, Key> = {
  "3m": "ins.ratingRange3m",
  "6m": "ins.ratingRange6m",
  "12m": "ins.ratingRange12m",
  all: "ins.ratingRangeAll",
};

/** „14.03.26" · der Tag eines Höchst- oder Tiefstwerts. */
export function shortDate(ts: number | null): string {
  if (ts == null) return "";
  return new Date(ts * 1000).toLocaleDateString(dateLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
