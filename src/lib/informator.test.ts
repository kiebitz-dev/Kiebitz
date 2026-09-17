import { describe, expect, it } from "vitest";
import { brettZeichen, leseZeichen, schluesselFolge } from "./informator";

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

  it("keeps pawn structure off the board once there is an annotation", () => {
    const quiet = brettZeichen([{ kind: "passed", squares: ["e4"] }]);
    expect([...quiet.keys()]).toEqual(["e4"]);

    const annotated = brettZeichen([
      { kind: "passed", squares: ["e4"] },
      { kind: "against", squares: ["g8", "e5"] },
      { kind: "nag", value: "??", squares: ["e5"] },
    ]);
    expect([...annotated.keys()].sort()).toEqual(["e5", "g8"]);
    expect(annotated.get("e5")?.map((z) => z.kind)).toEqual(["against", "nag"]);
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
