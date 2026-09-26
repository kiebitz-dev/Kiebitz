import { describe, it, expect } from "vitest";
import { buildDashboard, buildInsights, dashboardWindow } from "./stats";
import type { GameRecord } from "./db";

const NOW = Math.floor(Date.now() / 1000);

function g(partial: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 1,
    source: "chess.com",
    source_id: "abc",
    url: "https://example.com/1",
    played_at: "2026-07-01",
    played_ts: NOW,
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

describe("buildDashboard", () => {
  it("draws a daily line and drops a mode that has been idle too long", () => {
    const june = Math.floor(new Date(2026, 5, 30, 18).getTime() / 1000);
    const july = Math.floor(new Date(2026, 6, 31, 18).getTime() / 1000);
    const records = [
      g({ source: "chess.com", played_ts: june, my_elo: 812 }),
      g({ source: "lichess", played_ts: july, my_elo: 1078 }),
    ];
    const realNow = Date.now;
    const at = (day: number) => {
      Date.now = () => new Date(2026, 7, day, 9).getTime();
      const d = buildDashboard(records, { locale: "en", ccUser: "u", liUser: "u" });
      const byId = new Map(d.historySeries.map((series) => [series.id, series]));
      const last = d.history[d.history.length - 1];
      return { d, last, key: (id: string) => byId.get(id)!.key };
    };
    try {
      const first = at(1);
      expect(first.last.monthLabel).toBe("Aug");
      // Jeder Stützpunkt trägt seinen Tag · den zeigt der Tooltip.
      expect(first.last.dayLabel).toBe("Aug 1, 2026");
      // 1. März bis 1. August: 31 + 30 + 31 + 30 + 31 + 1 Tage.
      expect(first.d.history.length).toBe(154);
      // Sechs Monate mit einem Stützpunkt je Tag · beschriftet ist auf der
      // Achse trotzdem nur der Monatserste.
      expect(first.d.history.filter((point) => point.month !== "").length).toBe(6);
      // Am 1. August liegt die letzte chess.com-Partie 32 Tage zurück · das
      // Rating gilt weiter, die Linie läuft waagerecht mit.
      expect(first.last[first.key("chess.com-rapid")]).toBe(812);
      expect(first.last[first.key("lichess-rapid")]).toBe(1078);

      // Am 10. August sind es 41 Tage · der Modus gilt als ruhend und setzt aus.
      const later = at(10);
      expect(later.last[later.key("chess.com-rapid")]).toBeNull();
      expect(later.last[later.key("lichess-rapid")]).toBe(1078);
    } finally {
      Date.now = realNow;
    }
  });

  it("uses the same four most active modes for cards and rating history", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) => g({ id: 10 + i, source: "chess.com", time_class: "rapid", played_ts: NOW - i * 60 })),
      ...Array.from({ length: 4 }, (_, i) => g({ id: 20 + i, source: "lichess", time_class: "blitz", played_ts: NOW - i * 60 })),
      ...Array.from({ length: 3 }, (_, i) => g({ id: 30 + i, source: "chess.com", time_class: "bullet", played_ts: NOW - i * 60 })),
      ...Array.from({ length: 2 }, (_, i) => g({ id: 40 + i, source: "lichess", time_class: "rapid", played_ts: NOW - i * 60 })),
      g({ id: 50, source: "chess.com", time_class: "blitz", played_ts: NOW }),
    ];
    const d = buildDashboard(records, { locale: "en", ccUser: "u", liUser: "u" });
    expect(d.cards.map((card) => card.id)).toEqual([
      "chess.com-rapid",
      "lichess-blitz",
      "chess.com-bullet",
      "lichess-rapid",
    ]);
    expect(d.historySeries.map((series) => series.id)).toEqual(d.cards.map((card) => card.id));
  });

  it("takes the latest rating per platform/time-control bucket", () => {
    const d = buildDashboard(
      [
        g({ played_ts: NOW - 3600, my_elo: 1500 }),
        g({ played_ts: NOW - 60, my_elo: 1520 }),
      ],
      { locale: "en", ccUser: "u", liUser: "u" }
    );
    const rapid = d.cards.find((c) => c.id === "chess.com-rapid");
    expect(rapid).toBeDefined();
    expect(rapid!.value).toBe(1520);
    // both games are within 30d, so the reference is the bucket's first rating
    expect(rapid!.delta).toBe(20);
    expect(rapid!.spark).toEqual([1500, 1520]);
  });

  it("ignores games without a rating and counts unanalyzed games", () => {
    const d = buildDashboard(
      [g({ my_elo: 0 }), g({ analyzed: false }), g({ analyzed: false })],
      { locale: "en", ccUser: "u", liUser: "u" }
    );
    expect(d.cards.find((c) => c.id === "chess.com-rapid" && c.value === 0)).toBeUndefined();
    expect(d.unanalyzed).toBe(2);
  });

  it("does not count metadata-only games that the engine cannot queue", () => {
    const d = buildDashboard(
      [g({ analyzed: false, moves: "" }), g({ analyzed: false, moves: "   " })],
      { locale: "en", ccUser: "u", liUser: "u" }
    );
    expect(d.unanalyzed).toBe(0);
  });

  it("caps cards at four and recent at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => g({ id: i, my_elo: 1500 + i }));
    const d = buildDashboard(many, { locale: "en", ccUser: "u", liUser: "u" });
    expect(d.cards.length).toBeLessThanOrEqual(4);
    expect(d.recent.length).toBe(5);
  });
});

describe("buildInsights", () => {
  it("computes totals, win rate and average opponent Elo", () => {
    const ins = buildInsights(
      [
        g({ result: "win", opp_elo: 1400 }),
        g({ result: "win", opp_elo: 1600 }),
        g({ result: "loss", opp_elo: 1500 }),
      ],
      "en"
    );
    expect(ins.totalGames).toBe(3);
    expect(ins.winRate).toBeCloseTo((2 / 3) * 100, 5);
    expect(ins.avgOppElo).toBe(1500);
  });

  it("averages accuracy only over rated-accuracy games", () => {
    const ins = buildInsights(
      [g({ accuracy: 90 }), g({ accuracy: 80 }), g({ accuracy: null })],
      "en"
    );
    expect(ins.avgAccuracy).toBeCloseTo(85, 5);
  });

  it("returns null accuracy when no game has one", () => {
    expect(buildInsights([g({ accuracy: null })], "en").avgAccuracy).toBeNull();
  });

  it("keeps library-only games out of insights and analysis backlog", () => {
    const included = g({ source_id: "included", accuracy: 80, analyzed: false });
    const excluded = g({ source_id: "excluded", accuracy: 20, analyzed: false, analysis_excluded: true });
    expect(buildInsights([included, excluded], "en").totalGames).toBe(1);
    const dashboard = buildDashboard([included, excluded], { locale: "en", ccUser: "me", liUser: "me" });
    expect(dashboard.unanalyzed).toBe(1);
    expect(dashboard.recent).toHaveLength(2);
  });

  it("averages each analysis phase independently", () => {
    const phases = buildInsights([
      g({ accuracy_opening: 90, accuracy_middlegame: 70, accuracy_endgame: null }),
      g({ accuracy_opening: 80, accuracy_middlegame: null, accuracy_endgame: 95 }),
    ], "en").phaseAccuracy;
    expect(phases).toEqual([
      { phase: "opening", accuracy: 85, games: 2 },
      { phase: "middlegame", accuracy: 70, games: 1 },
      { phase: "endgame", accuracy: 95, games: 1 },
    ]);
  });

  it("ranks openings by frequency with per-opening win rate", () => {
    const ins = buildInsights(
      [
        g({ opening: "Italian Game", result: "win" }),
        g({ opening: "Italian Game", result: "loss" }),
        g({ opening: "Sicilian Defense", result: "win" }),
      ],
      "en"
    );
    expect(ins.openings[0]).toMatchObject({ name: "Italian Game", games: 2, win: 50 });
  });

  it("splits results by color", () => {
    const ins = buildInsights(
      [
        g({ color: "white", result: "win" }),
        g({ color: "white", result: "draw" }),
        g({ color: "black", result: "loss" }),
      ],
      "en"
    );
    const white = ins.byColor.find((c) => c.color === "White")!;
    const black = ins.byColor.find((c) => c.color === "Black")!;
    expect(white).toMatchObject({ win: 1, draw: 1, loss: 0 });
    expect(black).toMatchObject({ win: 0, draw: 0, loss: 1 });
  });

  it("produces a 7x6 activity matrix", () => {
    const ins = buildInsights([g()], "en");
    expect(ins.activity.values.length).toBe(7);
    expect(ins.activity.values.every((row) => row.length === 6)).toBe(true);
  });

  it("compares two 20-game form windows and computes point score", () => {
    const games = Array.from({ length: 40 }, (_, index) =>
      g({
        id: index,
        played_ts: NOW - (39 - index) * 60,
        result: index < 20 ? "loss" : index % 2 ? "win" : "draw",
      })
    );
    const ins = buildInsights(games, "en");
    expect(ins.recentForm.games).toBe(20);
    expect(ins.recentForm.previousScorePct).toBe(0);
    expect(ins.recentForm.scorePct).toBe(75);
    expect(ins.scoreRate).toBeCloseTo(37.5);
  });

  it("builds detailed opening, game-length, and bounce-back segments", () => {
    const ins = buildInsights([
      g({ opening: "Italian Game", color: "white", result: "loss", moves_count: 18, accuracy: 70 }),
      g({ opening: "Italian Game", color: "white", result: "win", moves_count: 30, accuracy: 90 }),
      g({ opening: "Sicilian", color: "black", result: "draw", moves_count: 50, accuracy: 80 }),
    ], "en");
    expect(ins.openingDetails[0]).toMatchObject({ name: "Italian Game", color: "white", games: 2, scorePct: 50 });
    expect(ins.byLength.map((bucket) => bucket.games)).toEqual([1, 1, 1]);
    expect(ins.bounceBack).toEqual({ games: 1, scorePct: 100 });
    expect(ins.longestLossStreak).toBe(1);
    expect(ins.accuracyConsistency).toBeCloseTo(8.2, 1);
  });
});

describe("dashboardWindow", () => {
  it("reicht so weit zurück, wie Karten und Verlauf schauen", () => {
    const nowMs = new Date(2026, 8, 26, 13, 0).getTime();
    const window = dashboardWindow(nowMs);
    expect(window.spark).toBe(12);
    expect(window.recent_from).toBe(Math.floor(nowMs / 1000) - 30 * 86400);
    // Verlauf ab 1. April · der erste Stützpunkt sieht 35 Tage weiter zurück.
    expect(window.history_from).toBe(Math.floor(new Date(2026, 3, 1).getTime() / 1000) - 35 * 86400);
  });
});

describe("buildDashboard mit Auswahl aus dem Backend", () => {
  it("nimmt die jüngsten Partien und die Warteschlange aus der Bibliothek", () => {
    const shown = g({ id: 1, opponent: "aus der Auswahl" });
    const excluded = g({ id: 2, opponent: "ausgeschlossen", analysis_excluded: true, played_ts: NOW + 60 });
    const d = buildDashboard([shown], { locale: "en", ccUser: "u", liUser: "u" }, {
      recent: [excluded, shown],
      unanalyzed: 17,
    });
    expect(d.recent.map((game) => game.opponent)).toEqual(["ausgeschlossen", "aus der Auswahl"]);
    expect(d.unanalyzed).toBe(17);
    expect(d.cards).toHaveLength(1);
  });
});
