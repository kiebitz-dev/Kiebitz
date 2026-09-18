import { describe, expect, it } from "vitest";
import { ELO_JE_PUNKT, KAPPE, partieRating } from "./partierating";

describe("game rating", () => {
  it("is the opponent's rating when both sides played equally well", () => {
    expect(partieRating(1400, 82.5, 82.5)).toBe(1400);
  });

  it("adds about 55 points for every point of accuracy ahead", () => {
    expect(partieRating(1400, 84, 82)).toBe(1510);
    expect(partieRating(1400, 80, 82)).toBe(1290);
    expect(ELO_JE_PUNKT).toBeCloseTo(55.3, 1);
  });

  it("caps like the performance of a single game", () => {
    expect(partieRating(1400, 95, 60)).toBe(1400 + KAPPE);
    expect(partieRating(1400, 40, 90)).toBe(1400 - KAPPE);
  });

  it("rounds to ten, not to the point", () => {
    expect(partieRating(1403, 80.1, 80)! % 10).toBe(0);
  });

  it("says nothing without an anchor or without both accuracies", () => {
    expect(partieRating(0, 80, 70)).toBeNull();
    expect(partieRating(null, 80, 70)).toBeNull();
    expect(partieRating(1400, null, 70)).toBeNull();
    expect(partieRating(1400, 80, undefined)).toBeNull();
  });
});
