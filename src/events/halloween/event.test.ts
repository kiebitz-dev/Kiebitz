import { describe, expect, it } from "vitest";
import { EVENTS } from "../index";
import halloween from "./event";

describe("Halloween", () => {
  it("wird gefunden", () => {
    expect(EVENTS.map((event) => event.id)).toContain("halloween");
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
