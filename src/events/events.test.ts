import { describe, expect, it } from "vitest";
import { activeEvent, inWindow, pickEvent, type EventDef } from "./index";

const day = (iso: string) => new Date(`${iso}T12:00:00`);

describe("Saison-Events", () => {
  const herbst: EventDef = { id: "herbst", from: "10-24", to: "11-01" };
  const silvester: EventDef = { id: "silvester", from: "12-28", to: "01-02" };

  it("gilt jedes Jahr im Fenster, beide Ränder eingeschlossen", () => {
    expect(inWindow(herbst, day("2026-10-23"))).toBe(false);
    expect(inWindow(herbst, day("2026-10-24"))).toBe(true);
    expect(inWindow(herbst, day("2027-10-31"))).toBe(true);
    expect(inWindow(herbst, day("2031-11-01"))).toBe(true);
    expect(inWindow(herbst, day("2026-11-02"))).toBe(false);
  });

  it("darf über den Jahreswechsel reichen", () => {
    expect(inWindow(silvester, day("2026-12-31"))).toBe(true);
    expect(inWindow(silvester, day("2027-01-02"))).toBe(true);
    expect(inWindow(silvester, day("2027-01-03"))).toBe(false);
    expect(inWindow(silvester, day("2026-06-15"))).toBe(false);
  });

  it("wählt nach Datum, ein Schalter übersteuert", () => {
    const events = [herbst, silvester];
    expect(pickEvent(events, day("2026-10-30"))?.id).toBe("herbst");
    expect(pickEvent(events, day("2026-07-01"))).toBeNull();
    expect(pickEvent(events, day("2026-07-01"), "silvester")?.id).toBe("silvester");
    expect(pickEvent(events, day("2026-10-30"), "none")).toBeNull();
    expect(pickEvent(events, day("2026-10-30"), "gibtsnicht")).toBeNull();
  });

  it("bleibt in Tests aus, damit die Oberfläche nicht vom Kalender abhängt", () => {
    expect(activeEvent()).toBeNull();
  });
});
