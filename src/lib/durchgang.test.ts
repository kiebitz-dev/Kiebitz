import { describe, expect, it } from "vitest";
import { momente, MOMENTE_MAX } from "./durchgang";
import type { MoveJudgment, ViewMove } from "./urteil";

/** A move list where only the judgment and the cost matter. */
function spiel(entries: Record<number, [MoveJudgment, number?]>, plies = 40): ViewMove[] {
  return Array.from({ length: plies }, (_, index) => {
    const entry = entries[index + 1];
    return {
      san: "Nf3",
      evalCp: 0,
      mateIn: null,
      judgment: entry ? entry[0] : "best",
      verlust: entry?.[1] ?? 0,
    };
  });
}

describe("walk-through moments", () => {
  it("keeps only the player's own moves when the colour is known", () => {
    const moves = spiel({ 3: ["blunder", 0.4], 4: ["blunder", 0.5] });
    expect(momente(moves, "white").map((m) => m.ply)).toEqual([3]);
    expect(momente(moves, "black").map((m) => m.ply)).toEqual([4]);
    // Without a side of one's own there is no opponent to leave out.
    expect(momente(moves, null).map((m) => m.ply)).toEqual([3, 4]);
  });

  it("takes the first serious error, not the most expensive one", () => {
    // The later blunder costs more, but the game turned at the first one.
    const moves = spiel({ 5: ["blunder", 0.32], 21: ["blunder", 0.9] });
    expect(momente(moves, "white")[0].ply).toBe(5);
  });

  it("gives every kind a place before doubling up on one", () => {
    const moves = spiel({
      3: ["blunder", 0.4],
      7: ["blunder", 0.8],
      9: ["blunder", 0.7],
      11: ["brilliant"],
      13: ["miss", 0.3],
      15: ["great"],
    });
    const arten = momente(moves, "white").map((m) => m.art);
    expect(new Set(arten)).toEqual(new Set(["patzer", "glanz", "wende", "verpasst"]));
  });

  it("walks the game forwards and stops at six", () => {
    const moves = spiel({
      1: ["mistake", 0.2],
      3: ["blunder", 0.4],
      5: ["miss", 0.3],
      7: ["mistake", 0.25],
      9: ["blunder", 0.5],
      11: ["brilliant"],
      13: ["great"],
      15: ["mistake", 0.21],
      17: ["blunder", 0.6],
    });
    const liste = momente(moves, "white");
    expect(liste).toHaveLength(MOMENTE_MAX);
    expect(liste.map((m) => m.ply)).toEqual([...liste.map((m) => m.ply)].sort((a, b) => a - b));
  });

  it("offers nothing for a game without a single blemish", () => {
    expect(momente(spiel({}), "white")).toEqual([]);
  });

  it("does not report a move twice", () => {
    const moves = spiel({ 3: ["blunder", 0.4] });
    const liste = momente(moves, "white");
    expect(liste).toHaveLength(1);
    expect(liste[0]).toEqual({ ply: 3, art: "patzer", judgment: "blunder" });
  });
});
