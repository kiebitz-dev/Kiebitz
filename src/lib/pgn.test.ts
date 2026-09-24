import { describe, expect, it } from "vitest";
import { exportPgn, importPgn, PgnPlayerMismatchError } from "./pgn";

const SAMPLE = `[Event "Club game"]
[Site "Berlin"]
[Date "2026.07.20"]
[Round "3"]
[White "Alice"]
[Black "Tom"]
[Result "0-1"]
[WhiteElo "1500"]
[BlackElo "1550"]
[ECO "C20"]
[Opening "King's Pawn"]
[KiebitzTags "OTB, Club"]
[KiebitzNote "Good finish"]

1. e4 e5 2. Nf3 Nc6 0-1`;

describe("PGN import/export", () => {
  it("imports player perspective, metadata, notes and tags", () => {
    const [game] = importPgn(SAMPLE, "Tom");
    expect(game).toMatchObject({ source: "manual", color: "black", my_name: "Tom", result: "win", opponent: "Alice", eco: "C20" });
    expect(game.moves).toBe("e4 e5 Nf3 Nc6");
    expect(game.tags).toEqual(["OTB", "Club"]);
    expect(game.note).toBe("Good finish");
  });

  it("round-trips a Chess960 game with its start position", () => {
    const fen = "1k6/pppppppp/8/8/8/8/PPPPPPPP/RK2R3 w KQ - 0 1";
    const game = {
      ...importPgn(SAMPLE, "Tom")[0],
      color: "white" as const,
      opponent: "Alice",
      variant: "chess960",
      start_fen: fen,
      moves: "O-O a6 Kh1",
      clocks: "",
    };
    const text = exportPgn([game], "Tom");
    expect(text).toContain('[Variant "Chess960"]');
    expect(text).toContain(`[FEN "${fen}"]`);
    expect(text).toContain("1. O-O a6 2. Kh1");
    const [back] = importPgn(text, "Tom");
    expect(back).toMatchObject({ variant: "chess960", start_fen: fen, moves: "O-O a6 Kh1" });
  });

  it("round-trips multiple games", () => {
    const game = {
      ...importPgn(SAMPLE, "Tom")[0],
      accuracy: 88.4,
      accuracy_opening: 91.2,
      accuracy_middlegame: 86.7,
      accuracy_endgame: 84.1,
      opponent_accuracy: 75.6,
      opponent_accuracy_opening: 79.3,
      opponent_accuracy_middlegame: 73.2,
      opponent_accuracy_endgame: 70.8,
    };
    const text = exportPgn([game, { ...game, source_id: "second" }], "Tom");
    const imported = importPgn(text, "Tom");
    expect(imported).toHaveLength(2);
    expect(imported[0].moves).toBe(game.moves);
    expect(imported[0].tags).toEqual(game.tags);
    expect(imported[0]).toMatchObject({
      accuracy: 88.4,
      accuracy_opening: 91.2,
      accuracy_middlegame: 86.7,
      accuracy_endgame: 84.1,
      opponent_accuracy: 75.6,
      opponent_accuracy_opening: 79.3,
      opponent_accuracy_middlegame: 73.2,
      opponent_accuracy_endgame: 70.8,
    });

    // Der Export stammt aus Sicht von Schwarz (Tom). Wählt ein Import
    // stattdessen Weiß (Alice), müssen beide Genauigkeiten die Seiten tauschen.
    const fromWhite = importPgn(text, "Alice")[0];
    expect(fromWhite).toMatchObject({
      color: "white",
      accuracy: 75.6,
      accuracy_opening: 79.3,
      accuracy_middlegame: 73.2,
      accuracy_endgame: 70.8,
      opponent_accuracy: 88.4,
      opponent_accuracy_opening: 91.2,
      opponent_accuracy_middlegame: 86.7,
      opponent_accuracy_endgame: 84.1,
    });
  });

  it("keeps the player-relative interpretation of older accuracy headers", () => {
    const legacy = SAMPLE.replace(
      '[KiebitzNote "Good finish"]',
      '[KiebitzNote "Good finish"]\n[KiebitzAccuracy "87.2"]\n[KiebitzOpponentAccuracy "74.9"]'
    );
    expect(importPgn(legacy, "Tom")[0]).toMatchObject({
      color: "black",
      accuracy: 87.2,
      opponent_accuracy: 74.9,
    });
  });

  it("rejects an import when the player matches neither color", () => {
    expect(() => importPgn(SAMPLE, "AliceAndTom")).toThrow(PgnPlayerMismatchError);
  });

  it("rejects the complete multi-game import when one game does not match", () => {
    const other = SAMPLE.replace('[White "Alice"]', '[White "Carol"]').replace('[Black "Tom"]', '[Black "Dave"]');
    expect(() => importPgn(`${SAMPLE}\n\n${other}`, "Tom")).toThrowError(
      expect.objectContaining({ unmatchedGames: 1, playerName: "Tom" })
    );
  });

  it("matches player names case-insensitively with normalized whitespace", () => {
    expect(importPgn(SAMPLE, "  tOM  ")[0].color).toBe("black");
  });

  it("derives rapid, blitz and classical modes from PGN time controls", () => {
    const withControl = (control: string) => SAMPLE.replace('[Result "0-1"]', `[Result "0-1"]\n[TimeControl "${control}"]`);
    expect(importPgn(withControl("900+0"), "Tom")[0].time_class).toBe("rapid");
    expect(importPgn(withControl("300+3"), "Tom")[0].time_class).toBe("blitz");
    expect(importPgn(withControl("40/7200:3600"), "Tom")[0].time_class).toBe("classical");
  });

  it("marks optional library-only imports and preserves the marker on export", () => {
    const game = importPgn(SAMPLE, "Tom", { excludeFromAnalysis: true })[0];
    expect(game.analysis_excluded).toBe(true);
    expect(exportPgn([game], "Tom")).toContain('[KiebitzAnalysisExcluded "true"]');
  });
});
