/**
 * Die Stärkestufen gegen die Engine · Hunderterschritte, und unter 1320, wo
 * Stockfish nicht weiter herunterregelt, eine eigene Abschwächung je Stufe.
 */
import { describe, expect, it } from "vitest";
import { blunderChance, PLAY_LEVELS } from "./play";

describe("PLAY_LEVELS", () => {
  it("steps by one hundred from 600 to 3100 and ends at full strength", () => {
    expect(PLAY_LEVELS[0]).toBe(600);
    expect(PLAY_LEVELS[PLAY_LEVELS.length - 2]).toBe(3100);
    expect(PLAY_LEVELS[PLAY_LEVELS.length - 1]).toBe(0);
    for (let i = 1; i < PLAY_LEVELS.length - 1; i++) expect(PLAY_LEVELS[i] - PLAY_LEVELS[i - 1]).toBe(100);
  });
});

describe("blunderChance", () => {
  it("leaves Stockfish's own range alone", () => {
    expect(blunderChance(0)).toBe(0);
    expect(blunderChance(1400)).toBe(0);
    expect(blunderChance(2500)).toBe(0);
  });

  it("makes every step below 1320 weaker than the one above", () => {
    const below = PLAY_LEVELS.filter((elo) => elo > 0 && elo < 1320);
    expect(below).toEqual([600, 700, 800, 900, 1000, 1100, 1200, 1300]);
    for (let i = 1; i < below.length; i++) {
      expect(blunderChance(below[i])).toBeLessThan(blunderChance(below[i - 1]));
    }
    expect(blunderChance(600)).toBeCloseTo(0.6);
  });
});
