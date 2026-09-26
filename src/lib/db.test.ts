import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { decodeSummaries } from "./db";

const cols = ["id", "source", "played_ts", "tags", "accuracy"];
const rows = [
  [7, "lichess", 1_790_000_000, ["Endspiel"], 91.5],
  [3, "chess.com", 1_780_000_000, [], null],
];
const expected = [
  { id: 7, source: "lichess", played_ts: 1_790_000_000, tags: ["Endspiel"], accuracy: 91.5 },
  { id: 3, source: "chess.com", played_ts: 1_780_000_000, tags: [], accuracy: null },
];

describe("decodeSummaries", () => {
  it("setzt die Objekte aus Spalten und Zeilen wieder zusammen", () => {
    expect(decodeSummaries({ cols, rows })).toEqual(expected);
  });

  it("liest die rohen Bytes, die das Backend als Response schickt", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ cols, rows }));
    expect(decodeSummaries(bytes.buffer)).toEqual(expected);
    expect(decodeSummaries(bytes)).toEqual(expected);
    // IPC über postMessage: Bytes kommen als Zahlenfeld an.
    expect(decodeSummaries(Array.from(bytes))).toEqual(expected);
  });

  it("nimmt fertige Objekte unverändert · Web-Vorschau und Tests", () => {
    expect(decodeSummaries(expected)).toBe(expected);
    expect(decodeSummaries([])).toEqual([]);
  });
});
