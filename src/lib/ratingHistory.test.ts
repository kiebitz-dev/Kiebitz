import { afterEach, describe, expect, it } from "vitest";
import { buildRatingHistory } from "./ratingHistory";
import type { GameRecord } from "./db";

function g(partial: Partial<GameRecord>): GameRecord {
  return {
    id: 1,
    source: "chess.com",
    source_id: "abc",
    url: "",
    played_at: "",
    played_ts: 0,
    time_class: "rapid",
    color: "white",
    opponent: "villain",
    opp_elo: 1400,
    my_elo: 1500,
    result: "win",
    opening: "Italian Game",
    eco: "C50",
    moves_count: 20,
    accuracy: null,
    moves: "e4 e5",
    note: "",
    analyzed: true,
    ...partial,
  };
}

const ts = (year: number, month: number, day: number) =>
  Math.floor(new Date(year, month, day, 18).getTime() / 1000);

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

describe("buildRatingHistory", () => {
  const records = [
    // Vor dem Zeitraum · Bezugswert der Veränderung.
    g({ played_ts: ts(2025, 11, 20), my_elo: 1400 }),
    g({ played_ts: ts(2026, 5, 2), my_elo: 1480 }),
    g({ played_ts: ts(2026, 6, 10), my_elo: 1530 }),
    g({ played_ts: ts(2026, 7, 5), my_elo: 1510 }),
    g({ source: "lichess", time_class: "blitz", played_ts: ts(2026, 7, 20), my_elo: 1700 }),
    // Ohne Wertung · zählt nicht.
    g({ source: "manual", played_ts: ts(2026, 7, 21), my_elo: 0 }),
  ];

  it("summarises every platform and mode over the chosen range", () => {
    Date.now = () => new Date(2026, 7, 31, 9).getTime();
    const data = buildRatingHistory(records, { locale: "en", range: "6m" });

    expect(data.series.map((series) => series.id).sort()).toEqual([
      "chess.com-rapid",
      "lichess-blitz",
    ]);
    const rapid = data.summaries.find((row) => row.series.id === "chess.com-rapid")!;
    expect(rapid.current).toBe(1510);
    // Bezug ist die letzte Wertung vor dem März, nicht die erste im Zeitraum.
    expect(rapid.change).toBe(110);
    expect(rapid.peak).toBe(1530);
    expect(rapid.peakTs).toBe(ts(2026, 6, 10));
    expect(rapid.low).toBe(1480);
    expect(rapid.games).toBe(3);
    // März bis 31. August, ein Stützpunkt je Tag.
    expect(data.history.length).toBe(184);
  });

  it("leaves chess.com games without readable moves out of the line", () => {
    Date.now = () => new Date(2026, 7, 31, 9).getTime();
    // Ein altes Daily-960 · eigene Wertung, Züge nicht lesbar.
    const variant = g({ played_ts: ts(2026, 7, 20), my_elo: 730, moves: "" });
    const data = buildRatingHistory([...records, variant], { locale: "en", range: "6m" });
    const rapid = data.summaries.find((row) => row.series.id === "chess.com-rapid")!;
    expect(rapid.current).toBe(1510);
    expect(rapid.low).toBe(1480);
    expect(rapid.games).toBe(3);
  });

  it("gives Chess960 a series of its own instead of mixing it into the mode", () => {
    Date.now = () => new Date(2026, 7, 31, 9).getTime();
    const daily = [
      g({ time_class: "daily", played_ts: ts(2026, 7, 10), my_elo: 1000 }),
      g({ time_class: "daily", variant: "chess960", played_ts: ts(2026, 7, 11), my_elo: 730 }),
      g({ time_class: "daily", played_ts: ts(2026, 7, 12), my_elo: 1004 }),
    ];
    const data = buildRatingHistory(daily, { locale: "en", range: "3m" });
    expect(data.series.map((series) => series.id).sort()).toEqual([
      "chess.com-daily",
      "chess.com-daily-960",
    ]);
    const standard = data.summaries.find((row) => row.series.id === "chess.com-daily")!;
    expect(standard.low).toBe(1000);
    expect(standard.games).toBe(2);
    const fischer = data.summaries.find((row) => row.series.id === "chess.com-daily-960")!;
    expect(fischer.current).toBe(730);
    expect(fischer.series.label).toMatch(/960/);
  });

  it("switches to weekly points beyond a year and still ends today", () => {
    Date.now = () => new Date(2026, 7, 31, 9).getTime();
    const data = buildRatingHistory(
      [g({ played_ts: ts(2023, 0, 5), my_elo: 1200 }), ...records],
      { locale: "en", range: "all" }
    );
    expect(data.history.length).toBeLessThan(200);
    expect(data.history[data.history.length - 1].dayLabel).toBe("Aug 31, 2026");
    // Über mehr als drei Jahre ist nur der Januar beschriftet, mit der Jahreszahl.
    expect(data.history.filter((point) => point.month).map((point) => point.month)).toEqual([
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
  });
});
