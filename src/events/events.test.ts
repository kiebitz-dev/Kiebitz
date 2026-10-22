import { describe, expect, it } from "vitest";
import { activeEvent, EVENTS } from "./index";

describe("Events", () => {
  it("liegt höchstens ein Event-Ordner gleichzeitig unter src/events/", () => {
    expect(EVENTS.length).toBeLessThanOrEqual(1);
  });

  it("bleibt in Tests aus, damit die Oberfläche nicht vom Event-Ordner abhängt", () => {
    expect(activeEvent()).toBeNull();
  });
});
