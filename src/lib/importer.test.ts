import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAll, importChessCom, importLichess } from "./importer";

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
function textResponse(text: string) {
  return { ok: true, status: 200, text: async () => text };
}

afterEach(() => vi.unstubAllGlobals());

describe("importChessCom", () => {
  const pgn = [
    '[Date "2026.07.01"]',
    '[ECO "B20"]',
    '[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-Bowdler-Attack-2...e6"]',
    "",
    "1. e4 c5 2. Bc4 e6 1-0",
    "",
  ].join("\n");

  const ccGame = {
    url: "https://www.chess.com/game/live/123456",
    pgn,
    end_time: 1751371200,
    time_class: "rapid",
    white: { username: "Torim98", rating: 1500, result: "win" },
    black: { username: "villain", rating: 1400, result: "resigned" },
    accuracies: { white: 88.5, black: 60.1 },
  };

  it("normalizes a chess.com game into a GameRecord", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/archives")
          ? jsonResponse({ archives: ["https://api.chess.com/pub/.../2026/07"] })
          : jsonResponse({ games: [ccGame] })
      )
    );

    const [game] = await importChessCom("Torim98");
    expect(game).toMatchObject({
      source: "chess.com",
      source_id: "123456",
      time_class: "rapid",
      color: "white",
      result: "win",
      opening: "Sicilian Defense Bowdler Attack", // slug parsed, move suffix dropped
      eco: "B20",
      moves_count: 2, // 4 plies -> 2 full moves
      opp_elo: 1400,
      my_elo: 1500,
      accuracy: 88.5,
      opponent_accuracy: 60.1,
      played_at: "2026-07-01",
    });
  });

  it("keeps Chess960 with its start position and skips the other variants", async () => {
    // Aufstellung mit König b1 und Türmen a1/e1 · Weiß rochiert kurz.
    const fen = "rk2r3/pppppppp/8/8/8/8/PPPPPPPP/RK2R3 w KQkq - 0 1";
    const pgn960 = [
      '[Variant "Chess960"]',
      '[SetUp "1"]',
      `[FEN "${fen}"]`,
      '[TimeControl "1/259200"]',
      "",
      "1. O-O {[%clk 71:59:59]} 1... a6 2. Kh1 1-0",
      "",
    ].join("\n");
    const chess960 = { ...ccGame, url: "https://www.chess.com/game/daily/960", rules: "chess960", pgn: pgn960 };
    const bughouse = { ...ccGame, url: "https://www.chess.com/game/live/77", rules: "bughouse" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/archives")
          ? jsonResponse({ archives: ["m"] })
          : jsonResponse({ games: [{ ...ccGame, rules: "chess" }, chess960, bughouse] })
      )
    );

    const games = await importChessCom("Torim98");
    expect(games.map((game) => game.source_id)).toEqual(["123456", "960"]);
    expect(games[0].variant).toBe("standard");
    const fischer = games[1];
    expect(fischer.variant).toBe("chess960");
    expect(fischer.start_fen).toBe(fen);
    expect(fischer.moves).toBe("O-O a6 Kh1");
  });

  it("derives a loss when the opponent won and maps correspondence to daily", async () => {
    const g = {
      ...ccGame,
      time_class: "correspondence",
      accuracies: undefined,
      white: { username: "villain", rating: 1400, result: "win" },
      black: { username: "Torim98", rating: 1500, result: "resigned" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/archives")
          ? jsonResponse({ archives: ["m"] })
          : jsonResponse({ games: [g] })
      )
    );

    const [game] = await importChessCom("Torim98");
    expect(game.color).toBe("black");
    expect(game.result).toBe("loss");
    expect(game.time_class).toBe("daily");
    expect(game.accuracy).toBeNull();
  });

  it("maps both chess.com accuracies into the player's perspective", async () => {
    const g = {
      ...ccGame,
      accuracies: { white: 92.4, black: 71.6 },
      white: { username: "villain", rating: 1400, result: "win" },
      black: { username: "Torim98", rating: 1500, result: "resigned" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/archives")
          ? jsonResponse({ archives: ["m"] })
          : jsonResponse({ games: [g] })
      )
    );

    const [game] = await importChessCom("Torim98");
    expect(game).toMatchObject({ accuracy: 71.6, opponent_accuracy: 92.4 });
  });

  it("throws on an HTTP error from the archive list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(importChessCom("nobody")).rejects.toThrow("chess.com: 404");
  });
});

describe("importLichess", () => {
  const line = (o: Record<string, unknown>) => JSON.stringify(o);

  it("keeps lichess Chess960 with its start position and skips the other variants", async () => {
    const players = {
      white: { user: { name: "Torim98" }, rating: 1600 },
      black: { user: { name: "villain" }, rating: 1550 },
    };
    const fen = "rk2r3/pppppppp/8/8/8/8/PPPPPPPP/RK2R3 w KQkq - 0 1";
    const ndjson = [
      line({ id: "std", speed: "blitz", variant: "standard", createdAt: 1, moves: "e4", players }),
      line({ id: "zh", speed: "blitz", variant: "crazyhouse", createdAt: 2, moves: "e4", players }),
      line({ id: "fr", speed: "blitz", variant: "chess960", initialFen: fen, createdAt: 3, moves: "O-O a6", players }),
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(ndjson)));

    const games = await importLichess("Torim98");
    expect(games.map((game) => game.source_id)).toEqual(["std", "fr"]);
    expect(games[1]).toMatchObject({ variant: "chess960", start_fen: fen, moves: "O-O a6" });
  });

  it("normalizes NDJSON and derives results relative to the player's color", async () => {
    const ndjson = [
      line({
        id: "abc123",
        speed: "blitz",
        winner: "white",
        createdAt: 1751371200000,
        moves: "e4 e5 Nf3",
        opening: { eco: "C20", name: "King's Pawn Game" },
        players: {
          white: { user: { name: "Torim98" }, rating: 1600 },
          black: { user: { name: "villain" }, rating: 1550 },
        },
      }),
      line({
        id: "def456",
        speed: "correspondence",
        winner: "white",
        createdAt: 1751371200000,
        moves: "d4",
        players: {
          white: { user: { name: "villain" }, rating: 1700 },
          black: { user: { name: "Torim98" }, rating: 1650 },
        },
      }),
      line({
        id: "ghi789",
        speed: "bullet",
        createdAt: 1751371200000,
        moves: "e4 e5",
        players: {
          white: { user: { name: "Torim98" }, rating: 1600 },
          black: { user: { name: "villain" }, rating: 1580 },
        },
      }),
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(ndjson)));

    const games = await importLichess("Torim98");
    expect(games).toHaveLength(3);

    expect(games[0]).toMatchObject({
      source: "lichess",
      source_id: "abc123",
      url: "https://lichess.org/abc123",
      time_class: "blitz",
      color: "white",
      result: "win",
      opening: "King's Pawn Game",
      eco: "C20",
      moves_count: 2, // 3 plies -> 2 full moves
      my_elo: 1600,
      opp_elo: 1550,
    });
    expect(games[0].played_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // I played black and White won -> loss; correspondence maps to daily
    expect(games[1]).toMatchObject({ color: "black", result: "loss", time_class: "daily" });
    // no winner -> draw
    expect(games[2].result).toBe("draw");
  });

  it("throws on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(importLichess("nobody")).rejects.toThrow("lichess: 429");
  });
});

/**
 * Ein Lauf über die komplette Historie kann Dutzende Monatsarchive umfassen.
 * Wird er abgebrochen, soll das Geholte nicht verloren gehen · der Import ist
 * duplikatsicher, der Rest kommt beim nächsten Lauf dazu.
 */
describe("fetchAll", () => {
  it("keeps what a cancelled run already fetched and reports no error", async () => {
    const abort = new AbortController();
    const pgn = ['[Date "2026.06.01"]', "", "1. e4 c5 1-0", ""].join("\n");
    const ccGame = {
      url: "https://www.chess.com/game/live/1",
      pgn,
      end_time: 1751371200,
      time_class: "blitz",
      white: { username: "Torim98", rating: 1500, result: "win" },
      black: { username: "villain", rating: 1400, result: "resigned" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/archives")) {
          return jsonResponse({
            archives: ["https://api.chess.com/pub/.../2026/06", "https://api.chess.com/pub/.../2026/07"],
          });
        }
        // Der erste Monat kommt noch an, danach greift der Abbruch.
        abort.abort();
        return jsonResponse({ games: [ccGame] });
      })
    );

    const { games, summary } = await fetchAll("Torim98", "", { full: true, signal: abort.signal });

    expect(games).toHaveLength(1);
    expect(summary.aborted).toBe(true);
    expect(summary.errors).toEqual([]);
    // Genau ein Monatsarchiv wurde geholt: Liste plus erster Monat.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
