/**
 * Was die Fortsetzung kostet · gezählt am nachgespielten Brett.
 *
 * Geprüft wird das, worauf die Anmerkung sich verlässt: dass der erste
 * Schlagzug des Gegners richtig erkannt wird, dass das Schach dransteht, wo
 * eines ist, dass ein Rückschlag gegengerechnet wird, und dass eine Linie,
 * die nicht zur Stellung passt, nichts erfindet.
 */
import { describe, expect, it } from "vitest";
import { fortsetzung } from "./folge";

/** Italienisch bis zum achten Halbzug · danach zieht Weiß. */
const ITALIENISCH = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "d6"];

/**
 * Ein Turmendspiel als Stellungsbild: Weiß stellt den Turm nach e6, Schwarz
 * nimmt erst den Bauern mit Schach und danach den Turm. Genau der Fall, für
 * den der Satz gebaut ist — nur ohne die dreißig Züge davor.
 */
const ENDSPIEL = "6k1/8/8/4R3/q7/8/P5K1/8 w - - 0 1";

describe("Fortsetzung nach einem Zug", () => {
  it("schweigt ohne gespeicherte Linie", () => {
    expect(fortsetzung(ITALIENISCH, "O-O", undefined)).toBeNull();
    expect(fortsetzung(ITALIENISCH, "O-O", [])).toBeNull();
  });

  it("schweigt, wo in der Linie nichts geschlagen wird", () => {
    expect(fortsetzung(ITALIENISCH, "O-O", ["Nf6", "Re1", "O-O"])).toBeNull();
  });

  it("nennt den ersten Schlagzug des Gegners und die Figur", () => {
    // 9.h3 Sf6 10.Lg5 Lxf2+ · der erste Schlag der Linie gehört dem Gegner.
    const folge = fortsetzung(ITALIENISCH, "h3", ["Nf6", "Bg5", "Bxf2+"]);
    expect(folge?.schlag).toBe("Bxf2+");
    expect(folge?.geschlagen).toBe("P");
    // Das Schach steht am Zug und wird deshalb im Satz mitgesagt.
    expect(folge?.schach).toBe(true);
    expect(folge?.netto.figuren).toEqual(["P"]);
  });

  it("rechnet den Rückschlag gegen", () => {
    // 9.Sg5 Dxg5 10.Lxg5 · Schwarz nimmt einen Springer, Weiß die Dame
    // zurück. Für den Gegner bleibt nichts übrig, also auch kein Satz.
    const folge = fortsetzung(ITALIENISCH, "Ng5", ["Qxg5", "Bxg5", "Nd4"]);
    expect(folge?.schlag).toBe("Qxg5");
    expect(folge?.netto.wert).toBe(0);
    expect(folge?.netto.figuren).toEqual([]);
  });

  it("zählt über die ganze Linie und nennt, was danach noch fällt", () => {
    const folge = fortsetzung([], "Re6", ["Qxa2+", "Kg3", "Qxe6"], ENDSPIEL);
    expect(folge?.schlag).toBe("Qxa2+");
    expect(folge?.geschlagen).toBe("P");
    expect(folge?.schach).toBe(true);
    expect(folge?.netto.figuren).toEqual(["P", "R"]);
    // Der erste Schlag steht im Satz schon mit Namen · „danach" ist der Rest.
    expect(folge?.danach.figuren).toEqual(["R"]);
  });

  it("erfindet nichts, wenn die Linie nicht zur Stellung passt", () => {
    // Eine Linie aus einer anderen Partie · gerechnet wird nur, was passt,
    // und hier passt schon der erste Zug nicht.
    expect(fortsetzung(ITALIENISCH, "O-O", ["Qxh8", "Rxh8"])).toBeNull();
  });

  it("erfindet nichts, wenn sich die Partie nicht nachspielen lässt", () => {
    expect(fortsetzung(["e4", "e4"], "e4", ["e5"])).toBeNull();
  });
});
