/**
 * Der ausführliche Ratingverlauf der Insights.
 *
 * Eine eigene Datei und nicht lib/stats.ts: stats.ts liegt im Startbündel,
 * weil der Start seine Karten daraus rechnet, und diese Rechnung braucht nur,
 * wer die Insights öffnet. Die Stützpunkte selbst (`historyPoints`) teilen
 * sich beide.
 */
import type { GameSummary } from "./db";
import type { Locale } from "./i18n";
import { tcLabel } from "./gameUi";
import { countsForRating, historyPoints, seriesId, variantOf, type HistoryPoint, type RatingHistorySeries } from "./stats";

/** Wie weit der Ratingverlauf der Insights zurückreicht. */
export type RatingRange = "3m" | "6m" | "12m" | "all";

export const RATING_RANGES: RatingRange[] = ["3m", "6m", "12m", "all"];

/** Was sich über eine Reihe im gewählten Zeitraum sagen lässt. */
export interface RatingSeriesSummary {
  series: RatingHistorySeries;
  /** Letzte Wertung im Zeitraum · null, wenn dort keine Partie liegt. */
  current: number | null;
  /** Veränderung gegen die letzte Wertung vor dem Zeitraum (sonst die erste darin). */
  change: number | null;
  peak: number | null;
  peakTs: number | null;
  low: number | null;
  lowTs: number | null;
  /** Gewertete Partien im Zeitraum. */
  games: number;
}

export interface RatingHistory {
  history: HistoryPoint[];
  /** Alle Paare mit mindestens einer gewerteten Partie, aktivste zuerst. */
  series: RatingHistorySeries[];
  summaries: RatingSeriesSummary[];
}

/**
 * Der ausführliche Ratingverlauf der Insights.
 *
 * Dieselbe Rechnung wie der Verlauf des Starts, aber mit wählbarem Zeitraum,
 * über *alle* Plattform-/Modus-Paare und mit dem, was man zu einer Linie wissen
 * will: Stand, Veränderung, Höchst- und Tiefstwert samt Tag, Partien. Ab gut
 * einem Jahr steht ein Stützpunkt je Woche statt je Tag · die Linie bleibt
 * gleich lesbar, und ein Verlauf über fünf Jahre zeichnet keine 1.800 Punkte.
 */
export function buildRatingHistory(
  records: GameSummary[],
  opts: { locale: Locale; range: RatingRange }
): RatingHistory {
  const asc = records
    .filter(
      (game) =>
        !game.analysis_excluded
        && countsForRating(game)
        && (game.source === "chess.com" || game.source === "lichess")
    )
    .sort((a, b) => a.played_ts - b.played_ts);
  const cutoff30d = Math.floor(Date.now() / 1000) - 30 * 86400;

  const buckets = new Map<string, GameSummary[]>();
  for (const game of asc) {
    const id = seriesId(game.source, game.time_class, variantOf(game));
    const list = buckets.get(id) ?? [];
    list.push(game);
    buckets.set(id, list);
  }
  // Dieselbe Reihenfolge wie die Karten des Starts: die zuletzt aktivsten
  // Paare zuerst, bei Gleichstand entscheidet die jüngste Partie.
  const ordered = [...buckets.values()].sort((a, b) => {
    const recentA = a.filter((game) => game.played_ts > cutoff30d).length;
    const recentB = b.filter((game) => game.played_ts > cutoff30d).length;
    return recentB - recentA || b[b.length - 1].played_ts - a[a.length - 1].played_ts;
  });
  const series: RatingHistorySeries[] = ordered.map((games, index) => {
    const platform = games[0].source as "chess.com" | "lichess";
    const timeClass = games[0].time_class;
    const variant = variantOf(games[0]);
    const mode = tcLabel(timeClass, opts.locale);
    return {
      key: `rating${index}`,
      id: seriesId(platform, timeClass, variant),
      platform,
      timeClass,
      variant,
      label: `${platform} · ${variant === "chess960" ? `${mode} 960` : mode}`,
    };
  });

  const today = new Date(Date.now());
  today.setHours(0, 0, 0, 0);
  const months = opts.range === "3m" ? 3 : opts.range === "6m" ? 6 : opts.range === "12m" ? 12 : null;
  let firstDay: Date;
  if (months != null) {
    firstDay = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  } else if (asc.length > 0) {
    const first = new Date(asc[0].played_ts * 1000);
    firstDay = new Date(first.getFullYear(), first.getMonth(), 1);
  } else {
    firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  }
  const spanDays = Math.round((today.getTime() - firstDay.getTime()) / 86_400_000);
  const { points, games: seriesGames } = historyPoints(
    asc,
    series,
    firstDay,
    today,
    opts.locale,
    spanDays > 400 ? 7 : 1
  );

  const fromTs = Math.floor(firstDay.getTime() / 1000);
  const summaries: RatingSeriesSummary[] = series.map((entry) => {
    const all = seriesGames.get(entry.key) ?? [];
    const inRange = all.filter((game) => game.played_ts >= fromTs);
    const before = all.filter((game) => game.played_ts < fromTs);
    let peak: GameSummary | null = null;
    let low: GameSummary | null = null;
    for (const game of inRange) {
      if (peak == null || game.my_elo > peak.my_elo) peak = game;
      if (low == null || game.my_elo < low.my_elo) low = game;
    }
    const current = inRange.length > 0 ? inRange[inRange.length - 1].my_elo : null;
    const reference =
      before.length > 0
        ? before[before.length - 1].my_elo
        : inRange.length > 0
          ? inRange[0].my_elo
          : null;
    return {
      series: entry,
      current,
      change: current != null && reference != null ? current - reference : null,
      peak: peak?.my_elo ?? null,
      peakTs: peak?.played_ts ?? null,
      low: low?.my_elo ?? null,
      lowTs: low?.played_ts ?? null,
      games: inRange.length,
    };
  });

  return { history: points, series, summaries };
}
