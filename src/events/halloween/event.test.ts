import { describe, expect, it } from "vitest";
import { EVENTS, inWindow } from "../index";
import halloween from "./event";

describe("Halloween", () => {
  it("wird gefunden und läuft über den 31. Oktober", () => {
    expect(EVENTS.map((event) => event.id)).toContain("halloween");
    expect(inWindow(halloween, new Date("2027-10-31T20:00:00"))).toBe(true);
  });

  it("zeigt die kleine WebP-Fassung des Logos, nicht die Vorlagen", () => {
    const event = EVENTS.find((candidate) => candidate.id === "halloween");
    expect(event?.logo).toMatch(/logo\.webp/);
  });

  it("bringt eine ladbare Startanimation mit", async () => {
    const intro = await halloween.intro!();
    expect(typeof intro.default).toBe("function");
  });
});
