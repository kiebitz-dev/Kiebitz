import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { fenSquares, soundForMoment, soundsForTransition } from "./boardSound";

/** FEN nach einer Zugfolge · dieselbe Quelle wie die Bretter selbst. */
function after(sans: string[]): string {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return chess.fen();
}

const START = new Chess().fen();

describe("fenSquares", () => {
  it("expands a placement into 64 squares", () => {
    const squares = fenSquares(START)!;
    expect(squares).toHaveLength(64);
    expect(squares[0]).toBe("r");
    expect(squares[63]).toBe("R");
    expect(squares[24]).toBe("");
  });

  it("rejects malformed placements", () => {
    expect(fenSquares("")).toBeNull();
    expect(fenSquares("8/8/8/8 w - - 0 1")).toBeNull();
    expect(fenSquares("9/8/8/8/8/8/8/8 w - - 0 1")).toBeNull();
    expect(fenSquares("xxxxxxxx/8/8/8/8/8/8/8 w - - 0 1")).toBeNull();
  });
});

describe("soundsForTransition", () => {
  it("plays the move sound for a quiet move", () => {
    expect(soundsForTransition(START, after(["e4"]))).toEqual(["move"]);
  });

  it("plays the capture sound when a piece leaves the board", () => {
    const before = after(["e4", "d5"]);
    expect(soundsForTransition(before, after(["e4", "d5", "exd5"]))).toEqual(["capture"]);
  });

  it("uses the castle variation for castling", () => {
    const before = after(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
    expect(soundsForTransition(before, after(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]))).toEqual([
      "castle",
    ]);
  });

  it("recognizes en passant as a capture despite three changed squares", () => {
    const line = ["e4", "Nf6", "e5", "d5"];
    expect(soundsForTransition(after(line), after([...line, "exd6"]))).toEqual(["capture"]);
  });

  it("uses the check sound when the move checks the king", () => {
    const line = ["e4", "f5", "Qh5"];
    expect(soundsForTransition(after(["e4", "f5"]), after(line))).toEqual(["check"]);
  });

  it("uses the checkmate sound for mate", () => {
    const line = ["f3", "e5", "g4"];
    expect(soundsForTransition(after(line), after([...line, "Qh4#"]))).toEqual(["checkmate"]);
  });

  it("uses the regular move sound for a quiet promotion", () => {
    // Bauer auf a7, Umwandlung auf a8 ohne Schlag · der schwarze König steht
    // auf h5, also außerhalb der Linien der neuen Dame.
    const before = "8/P7/8/7k/8/8/8/K7 w - - 0 1";
    const promoted = "Q7/8/8/7k/8/8/8/K7 b - - 0 1";
    expect(soundsForTransition(before, promoted)).toEqual(["move"]);
  });

  it("uses the capture sound for a capturing promotion", () => {
    const before = "r7/1P6/8/7k/8/8/8/K7 w - - 0 1";
    const promoted = "Q7/8/8/7k/8/8/8/K7 b - - 0 1";
    expect(soundsForTransition(before, promoted)).toEqual(["capture"]);
  });

  it("stays silent when the position changes wholesale", () => {
    // Neue Puzzle-Aufgabe: mehr als vier Felder anders.
    expect(soundsForTransition(START, "8/8/8/4k3/8/8/4K3/8 w - - 0 1")).toEqual([]);
  });

  it("stays silent without a move, on identical positions and on junk", () => {
    expect(soundsForTransition(START, START)).toEqual([]);
    expect(soundsForTransition("", START)).toEqual([]);
    expect(soundsForTransition(START, "nonsense")).toEqual([]);
  });

  it("stays silent when the side to move did not change", () => {
    // Dieselbe Seite am Zug heißt: kein einzelner Zug, sondern ein Sprung.
    const doubled = after(["e4", "e5"]).replace(" w ", " b ");
    expect(soundsForTransition(after(["e4"]), doubled)).toEqual([]);
  });

  it("plays a move sound when stepping backwards through a game", () => {
    // Blättern ist ein Zug rückwärts · lichess klingt dabei genauso.
    expect(soundsForTransition(after(["e4", "e5"]), after(["e4"]))).toEqual(["move"]);
  });

  it("does not announce check again when stepping backwards", () => {
    const checked = after(["e4", "f5", "Qh5"]);
    expect(soundsForTransition(checked, after(["e4", "f5"]))).toEqual(["move"]);
  });
});

describe("soundForMoment", () => {
  it("separates a moment worth hearing from one worth wincing at", () => {
    expect(soundForMoment("brilliant")).toBe("glanz");
    expect(soundForMoment("great")).toBe("glanz");
    expect(soundForMoment("blunder")).toBe("moment");
    expect(soundForMoment("miss")).toBe("moment");
  });
});
