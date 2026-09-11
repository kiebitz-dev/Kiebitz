import { describe, expect, it } from "vitest";
import { notationLine, translateSan } from "./notation";

describe("translateSan", () => {
  it("keeps the English piece letters in every language", () => {
    // Seit 1.4 heißt der Turm überall R · dieselbe Schreibweise wie in der
    // Zugliste, im Buch, in der PGN und in den geteilten Bildern.
    expect(translateSan("Nf3", "de")).toBe("Nf3");
    expect(translateSan("Qd5+", "de")).toBe("Qd5+");
    expect(translateSan("Bb5", "de")).toBe("Bb5");
    expect(translateSan("Rxe5", "de")).toBe("Rxe5");
    expect(translateSan("Kh8", "de")).toBe("Kh8");
    expect(translateSan("Nf3", "fr")).toBe("Nf3");
    expect(translateSan("Bb5", "es")).toBe("Bb5");
    expect(translateSan("Nf3", "en")).toBe("Nf3");
    expect(translateSan("Nf3", "zh")).toBe("Nf3");
  });

  it("leaves the capture sign, the squares and the qualifier alone", () => {
    expect(translateSan("Nxe5", "de")).toBe("Nxe5");
    expect(translateSan("exd4", "de")).toBe("exd4");
    expect(translateSan("bxc4", "de")).toBe("bxc4");
    expect(translateSan("Nbd2", "de")).toBe("Nbd2");
    expect(translateSan("R1e2", "de")).toBe("R1e2");
  });

  it("leaves the promotion piece alone too", () => {
    expect(translateSan("e8=Q", "de")).toBe("e8=Q");
    expect(translateSan("axb8=N+", "de")).toBe("axb8=N+");
  });

  it("sets castling with zeros and an en dash, in every language", () => {
    expect(translateSan("O-O", "de")).toBe("0\u20130");
    expect(translateSan("O-O-O", "de")).toBe("0\u20130\u20130");
    expect(translateSan("O-O+", "en")).toBe("0\u20130+");
    expect(translateSan("O-O-O#", "zh")).toBe("0\u20130\u20130#");
  });

  it("survives empty input", () => {
    expect(translateSan("", "de")).toBe("");
    expect(translateSan("   ", "de")).toBe("");
  });
});

describe("notationLine", () => {
  it("numbers the moves", () => {
    expect(notationLine(["e4", "e5", "Nf3", "Nc6"], "de")).toBe("1.e4 e5 2.Nf3 Nc6");
  });

  it("starts at the right move when the line begins in mid-game", () => {
    // 26 Halbzüge davor · der nächste Zug ist der 14. von Weiß.
    expect(notationLine(["d4", "exd4", "cxd4"], "de", 26)).toBe("14.d4 exd4 15.cxd4");
  });

  it("marks a line that begins with Black", () => {
    expect(notationLine(["Nh7", "Ne5"], "de", 25)).toBe("13...Nh7 14.Ne5");
  });

  it("sets castling inside a line as well", () => {
    expect(notationLine(["O-O", "O-O-O"], "de")).toBe("1.0\u20130 0\u20130\u20130");
  });
});
