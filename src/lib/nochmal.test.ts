import { describe, expect, it } from "vitest";
import {
  aufgabenKennung,
  beurteileVersuch,
  engineZahl,
  geloest,
  GLEICHWERTIG_CP,
  istBesterZug,
  nochmalMoeglich,
} from "./nochmal";
import type { ViewMove } from "./urteil";

const zug = (over: Partial<ViewMove> = {}): ViewMove => ({
  san: "Nf3",
  evalCp: 0,
  mateIn: null,
  bestUci: "g1f3",
  judgment: "mistake",
  ...over,
});

describe("retry in the analysis", () => {
  it("accepts the recommended move at once, without waiting for the engine", () => {
    const urteil = beurteileVersuch({ gespielt: "g1f3", beste: "g1f3", basis: null, nachher: null, weiss: true });
    expect(urteil).toEqual({ art: "gefunden", kosten: 0 });
    expect(geloest(urteil)).toBe(true);
  });

  it("matches a promotion only with the same piece", () => {
    expect(istBesterZug("e7e8q", "e7e8q")).toBe(true);
    expect(istBesterZug("e7e8n", "e7e8q")).toBe(false);
  });

  it("stays open as long as there is no engine number", () => {
    const urteil = beurteileVersuch({ gespielt: "b1c3", beste: "g1f3", basis: 30, nachher: null, weiss: true });
    expect(urteil.art).toBe("offen");
    expect(geloest(urteil)).toBe(false);
  });

  it("counts a different move that holds the position as solved", () => {
    const urteil = beurteileVersuch({
      gespielt: "b1c3",
      beste: "g1f3",
      basis: 40,
      nachher: 40 - GLEICHWERTIG_CP,
      weiss: true,
    });
    expect(urteil.art).toBe("gleichwertig");
    expect(geloest(urteil)).toBe(true);
  });

  it("says what a worse move still costs, from the mover's side", () => {
    // Black to move: the evaluation rising for White is Black's loss.
    const urteil = beurteileVersuch({ gespielt: "b8c6", beste: "g8f6", basis: -20, nachher: 150, weiss: false });
    expect(urteil).toEqual({ art: "teurer", kosten: 170 });
  });

  it("never reports a negative cost", () => {
    const urteil = beurteileVersuch({ gespielt: "b1c3", beste: "g1f3", basis: 0, nachher: 80, weiss: true });
    expect(urteil).toEqual({ art: "gleichwertig", kosten: 0 });
  });

  it("is offered only on the player's own flawed moves with a recommendation", () => {
    expect(nochmalMoeglich(zug(), 3, "white")).toBe(true);
    expect(nochmalMoeglich(zug({ judgment: "miss" }), 3, "white")).toBe(true);
    expect(nochmalMoeglich(zug(), 4, "white")).toBe(false);
    expect(nochmalMoeglich(zug({ judgment: "best" }), 3, "white")).toBe(false);
    expect(nochmalMoeglich(zug({ bestUci: undefined }), 3, "white")).toBe(false);
  });

  it("uses the same puzzle id as the backend", () => {
    // replace_own_game_puzzles in src-tauri/src/puzzles.rs: own:{game}:{ply}
    expect(aufgabenKennung(42, 17)).toBe("own:42:17");
  });

  it("turns the live engine's output into one number", () => {
    expect(engineZahl(null)).toBeNull();
    expect(engineZahl({ cp: null, mate: null })).toBeNull();
    expect(engineZahl({ cp: 35, mate: null })).toBe(35);
    expect(engineZahl({ cp: null, mate: -3 })).toBe(-1000);
  });
});
