import { describe, expect, it } from "vitest";
import { brettZeichen, leseZeichen, randZeichen, schluesselFolge } from "./informator";

describe("informator signs", () => {
  it("reads stored JSON and drops kinds this build cannot explain", () => {
    const raw = JSON.stringify([
      { kind: "eval", value: "+/-" },
      { kind: "initiative" },
      { kind: "idea", squares: ["e7"], san: "Qe7" },
    ]);
    expect(leseZeichen(raw).map((z) => z.kind)).toEqual(["eval", "idea"]);
    expect(leseZeichen("")).toEqual([]);
    expect(leseZeichen("kein json")).toEqual([]);
    expect(leseZeichen(undefined)).toEqual([]);
  });

  it("keeps pawn structure on the board next to an annotation", () => {
    const annotated = brettZeichen([
      { kind: "doubled", squares: ["g3", "g2"] },
      { kind: "attack", squares: ["e3"], san: "Qxe3+" },
      { kind: "file", squares: ["d1", "d8"] },
    ]);
    expect([...annotated.keys()].sort()).toEqual(["e3", "g2", "g3"]);
  });

  it("puts signs without a square beside the board, by side", () => {
    const rand = randZeichen([
      { kind: "same_bishops" },
      { kind: "doubled", squares: ["f6"] },
      { kind: "bishop_pair", side: "b" },
      { kind: "eval", value: "-/+" },
      { kind: "time_trouble", side: "w" },
    ]);
    expect(rand.stellung.map((z) => z.kind)).toEqual(["eval", "same_bishops"]);
    expect(rand.schwarz.map((z) => z.kind)).toEqual(["bishop_pair"]);
    expect(rand.weiss.map((z) => z.kind)).toEqual(["time_trouble"]);
  });

  it("orders the key from verdict to structure", () => {
    const order = schluesselFolge([
      { kind: "ending" },
      { kind: "idea", squares: ["d5"] },
      { kind: "eval", value: "=" },
    ]).map((z) => z.kind);
    expect(order).toEqual(["eval", "idea", "ending"]);
  });
});
