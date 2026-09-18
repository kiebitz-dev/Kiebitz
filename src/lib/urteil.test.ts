import { describe, expect, it } from "vitest";
import { MARKED_IN_LIST, NAG, rowsToViewMoves } from "./urteil";
import type { MoveEvalRow } from "./analysis";

/** The Greek gift: 6.Bxh7+ gives a bishop for a pawn and keeps the balance. */
const GREEK = "d4 d5 Nf3 Nf6 e3 e6 Bd3 Be7 O-O O-O Bxh7+".split(" ");
const GREEK_UCI = "d2d4 d7d5 g1f3 g8f6 e2e3 e7e6 f1d3 f8e7 e1g1 e8g8 d3h7".split(" ");

/** A quiet Ruy Lopez that ends in a plain recapture, 12.cxd4. */
const RUY =
  "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 cxd4 cxd4".split(" ");
const RUY_UCI =
  ("e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8 h2h3 c6a5 " +
    "b3c2 c7c5 d2d4 c5d4 c3d4").split(" ");

/**
 * Rows the way the analysis run stores them: one per ply, with the evaluation
 * after the move and the engine's pick before it. `evals` may be shorter than
 * the game; the remaining plies simply repeat the last value.
 */
function rows(
  uci: string[],
  evals: Record<number, number>,
  best?: Record<number, string>,
  judgments?: Record<number, MoveEvalRow["judgment"]>
): MoveEvalRow[] {
  let letzte = 20;
  return uci.map((played, index) => {
    const ply = index + 1;
    letzte = evals[ply] ?? letzte;
    return {
      ply,
      san: "",
      eval_cp: letzte,
      mate_in: null,
      best_uci: best?.[ply] ?? played,
      judgment: judgments?.[ply] ?? "",
      phase: "middlegame",
    };
  });
}

describe("move judgments", () => {
  it("calls a real sacrifice brilliant, even inside the book plies", () => {
    // 6.Bxh7+ is the eleventh half-move, so the old book rule would have
    // claimed it. A bishop against a pawn is an investment of two.
    const moves = rowsToViewMoves(GREEK, rows(GREEK_UCI, { 10: 30, 11: 60 }));
    expect(moves[10].judgment).toBe("brilliant");
    expect(moves[10].nag).toBe("!!");
    // Everything before it is ordinary opening play.
    expect(moves.slice(0, 10).every((m) => m.judgment !== "brilliant")).toBe(true);
  });

  it("does not call a sacrifice brilliant when the game is already decided", () => {
    // Same move, but White is a full rook up beforehand: nothing is risked
    // that the position does not already give away.
    const moves = rowsToViewMoves(GREEK, rows(GREEK_UCI, { 10: 500, 11: 540 }));
    expect(moves[10].judgment).not.toBe("brilliant");
  });

  it("does not call a sacrifice brilliant when it loses the game", () => {
    const moves = rowsToViewMoves(GREEK, rows(GREEK_UCI, { 10: 30, 11: -400 }));
    expect(moves[10].judgment).not.toBe("brilliant");
  });

  it("leaves a plain recapture at best move", () => {
    // 12.cxd4 is a capture, the best move and worth half a pawn — the three
    // conditions the old rule needed for "!!". Nothing is given up, so the
    // new rule stops at the star.
    const moves = rowsToViewMoves(RUY, rows(RUY_UCI, { 21: 0, 22: 10, 23: 60 }));
    expect(moves[22].judgment).toBe("best");
  });

  it("marks a turning point as great", () => {
    // White is lost, Black throws it away, and White's next move keeps the
    // new evaluation: lost → won across one round.
    const moves = rowsToViewMoves(RUY, rows(RUY_UCI, { 7: -500, 8: 300, 9: 320 }));
    expect(moves[8].judgment).toBe("great");
    expect(moves[8].nag).toBe("!");
  });

  it("does not hand out great for merely collecting a hanging piece", () => {
    // Same swing, but the move that follows it is 11...cxd4, taking a pawn
    // that stands there for the taking. The rule wants a find, not a pickup.
    const moves = rowsToViewMoves(RUY, rows(RUY_UCI, { 20: -500, 21: 300, 22: 320 }));
    expect(moves[21].judgment).not.toBe("great");
  });

  it("ranks a near-best move below best instead of calling it great", () => {
    // The old cascade put "great" on any move that lost almost nothing, which
    // placed it above "best move" in the list. Now it is an excellent move.
    const moves = rowsToViewMoves(
      RUY,
      rows(RUY_UCI, { 22: 10, 23: 8 }, { 23: "b1c3" })
    );
    expect(moves[22].judgment).toBe("excellent");
  });

  it("turns an error that follows an opponent blunder into a miss", () => {
    // Black blunders on ply 20, White answers with a mistake on ply 21: the
    // chance was there and went by. That is what the insights already count
    // as an unpunished opponent error.
    const moves = rowsToViewMoves(
      RUY,
      rows(RUY_UCI, {}, {}, { 20: "blunder", 21: "mistake" })
    );
    expect(moves[20].judgment).toBe("miss");
    expect(moves[20].nag).toBe("✗");
    // The opponent's blunder keeps its own name.
    expect(moves[19].judgment).toBe("blunder");
  });

  it("leaves the same error a mistake when nothing was there to punish", () => {
    const moves = rowsToViewMoves(RUY, rows(RUY_UCI, {}, {}, { 21: "mistake" }));
    expect(moves[20].judgment).toBe("mistake");
  });

  it("counts a miss as an opening for the other side", () => {
    // A miss stays an error in its own right, so the move after it can be a
    // miss as well — otherwise the player who let the first one through would
    // be let off by a relabelling.
    const moves = rowsToViewMoves(
      RUY,
      rows(RUY_UCI, {}, {}, { 20: "blunder", 21: "blunder", 22: "mistake" })
    );
    expect(moves[20].judgment).toBe("miss");
    expect(moves[21].judgment).toBe("miss");
  });

  describe("book moves", () => {
    it("guesses the first sixteen quiet plies without a source", () => {
      const moves = rowsToViewMoves(RUY, rows(RUY_UCI, {}), null);
      expect(moves.slice(0, 16).every((m) => m.judgment === "book")).toBe(true);
      expect(moves[16].judgment).not.toBe("book");
    });

    it("ends the book where the data says the game left it", () => {
      // The reference database knows the Ruy Lopez to 5.O-O and not 5...Be7.
      const moves = rowsToViewMoves(RUY, rows(RUY_UCI, {}), { plies: 9, decided: true, source: "own" });
      expect(moves.slice(0, 9).every((m) => m.judgment === "book")).toBe(true);
      // Ply ten would pass the rule of thumb · the data overrules it.
      expect(moves[9].judgment).toBe("best");
    });

    it("falls back to the rule of thumb where the sources fall silent", () => {
      const moves = rowsToViewMoves(RUY, rows(RUY_UCI, {}), { plies: 6, decided: false, source: "masters" });
      expect(moves.slice(0, 16).every((m) => m.judgment === "book")).toBe(true);
    });

    it("keeps a book sacrifice a book move", () => {
      // Theory learnt by heart is not a find.
      const moves = rowsToViewMoves(GREEK, rows(GREEK_UCI, { 10: 30, 11: 60 }), {
        plies: 11,
        decided: true,
        source: "own",
      });
      expect(moves[10].judgment).toBe("book");
    });

    it("never hides an error from the analysis behind the book", () => {
      const moves = rowsToViewMoves(RUY, rows(RUY_UCI, {}, {}, { 5: "inaccuracy" }), {
        plies: 9,
        decided: true,
        source: "own",
      });
      expect(moves[4].judgment).toBe("inaccuracy");
    });
  });

  it("shows a mark next to every judgment that has one", () => {
    const mitKuerzel = (Object.keys(NAG) as (keyof typeof NAG)[]).filter((k) => NAG[k] !== "");
    const ohneSymbol = mitKuerzel.filter((k) => !["best", "good"].includes(k));
    for (const k of ohneSymbol) expect(MARKED_IN_LIST).toContain(k);
  });
});
