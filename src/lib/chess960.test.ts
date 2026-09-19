import { describe, expect, it } from "vitest";
import {
  VariantChess,
  chess960Position,
  formatCastling,
  needsChess960,
  parseCastling,
  perft,
  validatePosition,
} from "./chess960";

// Die Sollwerte stammen aus Stockfish (`go perft 3`, bei 960 mit
// `UCI_Chess960`) · nicht aus einer Tabelle, deren Herkunft man glauben muss.
const STANDARD: [string, number, number][] = [
  ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 8902],
  ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2, 2039],
];

const CHESS960: [string, number][] = [
  ["bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9", 12189],
  ["2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9", 18002],
  ["b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9", 10471],
  ["qbbnnrkr/2pp2pp/p7/1p2pp2/8/P3PP2/1PPP1KPP/QBBNNR1R w hf - 0 9", 13440],
  ["1rqbkrbn/1ppppp1p/1n6/p1N3p1/8/2P4P/PP1PPPP1/1RQBKRBN w FBfb - 0 9", 14569],
  ["rbbqn1kr/pp2p1pp/6n1/2pp1p2/2P4P/P7/BP1PPPP1/R1BQNNKR w HAha - 0 9", 25798],
  ["1rkr3b/1ppn3p/3pB1n1/6q1/R2P4/4N1P1/1P5P/2KRQ1B1 b Dbd - 0 14", 46468],
];

describe("VariantChess", () => {
  it.each(STANDARD)("counts standard chess like Stockfish: %s", (fen, depth, nodes) => {
    expect(perft(new VariantChess(fen), depth)).toBe(nodes);
  });

  it.each(CHESS960)("counts Chess960 like Stockfish: %s", (fen, nodes) => {
    expect(perft(new VariantChess(fen, { chess960: true }), 3)).toBe(nodes);
  });

  it("castles in Chess960 by moving the king onto its rook", () => {
    const game = new VariantChess("1k6/8/8/8/8/8/8/RK2R3 w KQ - 0 1", { chess960: true });
    const castle = game.move({ from: "b1", to: "e1" });
    expect(castle?.san).toBe("O-O");
    expect(castle?.uci).toBe("b1e1");
    expect(game.fen()).toBe("1k6/8/8/8/8/8/8/R4RK1 b - - 1 1");
    // Die Rochade ist wieder zurückzunehmen, samt Rechten.
    game.undo();
    expect(game.fen()).toBe("1k6/8/8/8/8/8/8/RK2R3 w KQ - 0 1");
  });

  it("refuses castling through an attack the rook was hiding", () => {
    // Der Turm e8 sieht durch den weißen Turm e1 hindurch auf das Feld, über
    // das der König nach g1 geht.
    const game = new VariantChess("1k2r3/8/8/8/8/8/8/RK2R3 w KQ - 0 1", { chess960: true });
    expect(game.moves().some((m) => m.castle === "k")).toBe(false);
  });

  it("reads engine moves in both castling notations", () => {
    const standard = new VariantChess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    expect(standard.move("e1g1")?.san).toBe("O-O");
    const fischer = new VariantChess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", { chess960: true });
    expect(fischer.move("e1a1")?.san).toBe("O-O-O");
    expect(fischer.history()[0].uci).toBe("e1a1");
  });

  it("drops a right when its rook moves or is captured", () => {
    const game = new VariantChess("r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1");
    game.move("Bxa8");
    expect(game.fen().split(" ")[2]).toBe("KQk");
    game.move("Rh7");
    game.move("Rh2");
    expect(game.fen().split(" ")[2]).toBe("Q");
  });

  it("detects threefold repetition across its own history", () => {
    const game = new VariantChess("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
    // Der Turm zieht hin und her · die Rochade ist danach weg, also zählt die
    // erste Stellung (mit Recht) nicht zu den späteren.
    for (const san of ["Kf1", "Kd8", "Ke1", "Ke8", "Kf1", "Kd8", "Ke1", "Ke8"]) game.move(san);
    expect(game.isThreefoldRepetition()).toBe(false);
    for (const san of ["Kf1", "Kd8", "Ke1", "Ke8"]) game.move(san);
    expect(game.isThreefoldRepetition()).toBe(true);
  });
});

describe("castling rights", () => {
  it("reads KQkq, Shredder and X-FEN the same way", () => {
    const placement = "rk2r3/8/8/8/8/8/8/RK2R3";
    expect(parseCastling("KQkq", placement)).toEqual(parseCastling("EAea", placement));
    expect(formatCastling(parseCastling("EAea", placement), placement, true)).toBe("KQkq");
  });

  it("writes an inner rook by its file", () => {
    const placement = "1r1k1r1r/8/8/8/8/8/8/1R1K1R1R";
    expect(formatCastling(parseCastling("FBfb", placement), placement, true)).toBe("FQfq");
  });
});

describe("chess960Position", () => {
  it("numbers the standard position 518", () => {
    expect(chess960Position(518)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });

  it("follows Scharnagl for the first positions", () => {
    expect(chess960Position(0).split("/")[0]).toBe("bbqnnrkr");
    expect(chess960Position(959).split("/")[0]).toBe("rkrnnqbb");
  });

  it("always puts the king between its rooks and the bishops on both colours", () => {
    for (let id = 0; id < 960; id++) {
      const row = chess960Position(id).split("/")[0];
      const rooks = [...row].map((c, i) => (c === "r" ? i : -1)).filter((i) => i >= 0);
      const king = row.indexOf("k");
      const bishops = [...row].map((c, i) => (c === "b" ? i : -1)).filter((i) => i >= 0);
      expect(rooks[0] < king && king < rooks[1]).toBe(true);
      expect((bishops[0] + bishops[1]) % 2).toBe(1);
    }
  });
});

describe("validatePosition / needsChess960", () => {
  it("accepts playable positions and names what is wrong otherwise", () => {
    expect(validatePosition("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBeNull();
    expect(validatePosition("8/8/8/8/8/8/8/4K3 w - - 0 1")).not.toBeNull();
    // Schwarz steht im Schach, aber Weiß ist am Zug.
    expect(validatePosition("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1")).toBe("check");
  });

  it("tells Chess960 castling apart from standard castling", () => {
    expect(needsChess960("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe(false);
    expect(needsChess960(chess960Position(0))).toBe(true);
    expect(needsChess960("4k3/8/8/8/8/8/8/4K3 w - - 0 1")).toBe(false);
  });
});
