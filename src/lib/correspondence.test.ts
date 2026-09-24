import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOngoing, timeLeft } from "./correspondence";

const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("./lichess", () => ({ lichessToken: () => mocks.token() }));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.token.mockReset();
});

const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

const PGN = ['[White "villain"]', '[Black "Torim98"]', "", "1. e4 e5 2. Nf3 *", ""].join("\n");

describe("loadOngoing", () => {
  it("reads chess.com daily games from the player's side, own move first", async () => {
    mocks.token.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          games: [
            {
              url: "https://www.chess.com/game/daily/1",
              pgn: PGN,
              fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
              turn: "black",
              move_by: 2_000_000_000,
              rules: "chess",
              white: "https://api.chess.com/pub/player/villain",
              black: "https://api.chess.com/pub/player/torim98",
            },
            {
              url: "https://www.chess.com/game/daily/2",
              fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              turn: "white",
              move_by: 1_900_000_000,
              rules: "chess",
              white: "https://api.chess.com/pub/player/other",
              black: "https://api.chess.com/pub/player/Torim98",
            },
            // Bughouse spielt Kiebitz nicht.
            { url: "u3", fen: "", turn: "white", rules: "bughouse", white: "a/torim98", black: "b/x" },
          ],
        })
      )
    );

    const { games, errors } = await loadOngoing({ ccUser: "Torim98", liUser: "" });
    expect(errors).toEqual([]);
    expect(games.map((game) => game.id)).toEqual(["1", "2"]);
    const [first, second] = games;
    expect(first).toMatchObject({ opponent: "villain", myColor: "black", myTurn: true, deadline: 2_000_000_000 });
    expect(first.sans).toEqual(["e4", "e5", "Nf3"]);
    expect(second).toMatchObject({ opponent: "other", myTurn: false });
  });

  it("leaves lichess out without a token instead of failing", async () => {
    mocks.token.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => json({ games: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { games, errors } = await loadOngoing({ ccUser: "", liUser: "Torim98" });
    expect(games).toEqual([]);
    expect(errors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads lichess correspondence games with a token and skips faster ones", async () => {
    mocks.token.mockResolvedValue("lip_token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          nowPlaying: [
            {
              gameId: "abc",
              fullId: "abcd1234",
              color: "white",
              fen: "8/8/8/8/8/8/8/8 w - - 0 1",
              isMyTurn: true,
              secondsLeft: 7200,
              speed: "correspondence",
              variant: { key: "standard" },
              opponent: { username: "friend", rating: 1650 },
            },
            { gameId: "blitz", color: "white", fen: "", isMyTurn: true, speed: "blitz" },
          ],
        })
      )
    );
    const { games } = await loadOngoing({ ccUser: "", liUser: "Torim98" });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      source: "lichess",
      url: "https://lichess.org/abcd1234",
      opponent: "friend",
      opponentRating: 1650,
      myTurn: true,
    });
  });
});

describe("timeLeft", () => {
  it("rounds down to the largest sensible unit", () => {
    expect(timeLeft(null)).toBeNull();
    expect(timeLeft(1000 + 3 * 86_400 + 5, 1000)).toEqual({ value: 3, unit: "d" });
    expect(timeLeft(1000 + 5 * 3_600, 1000)).toEqual({ value: 5, unit: "h" });
    expect(timeLeft(1000 + 30, 1000)).toEqual({ value: 1, unit: "m" });
  });
});
