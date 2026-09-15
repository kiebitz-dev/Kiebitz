/**
 * Die Tatsachen unter dem ruhigen Zug.
 *
 * Geprüft wird das, wovon die Sätze leben: dass nur behauptet wird, was auf
 * dem Brett steht. Eine Drohung, die keine ist, wäre schlimmer als gar kein
 * Satz — sie klänge nach Analyse und wäre eine Erfindung.
 */
import { describe, expect, it } from "vitest";
import { zugfakten } from "./zugfakten";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** Nach 1.e4 e5 2.Nf3 Nc6 · die Stellung aus der gemeldeten Partie. */
const ITALIENISCH = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3";

describe("Zugfakten", () => {
  it("erkennt den Zug ins Zentrum", () => {
    const fakten = zugfakten(START, "e4");
    expect(fakten?.zentrum).toBe(true);
    expect(fakten?.entwicklung).toBe(false);
    expect(fakten?.figur).toBe("P");
  });

  it("erkennt die erste Entwicklung einer Leichtfigur", () => {
    const fakten = zugfakten(ITALIENISCH, "Bc4");
    expect(fakten?.entwicklung).toBe(true);
    expect(fakten?.figur).toBe("B");
    expect(fakten?.feld).toBe("c4");
  });

  it("nennt keine Drohung, wo das Ziel gedeckt ist", () => {
    // Lc4 greift f7 an, und f7 deckt der König · genau der Satz, den eine
    // naive Fassung hier schriebe und der nichts wert wäre.
    expect(zugfakten(ITALIENISCH, "Bc4")?.drohung).toBeUndefined();
  });

  it("nennt die ungedeckte Figur im Feuer", () => {
    // Nach 1.e4 e5 2.Sf3 Sc6 3.Lc4 Lc5 trifft 4.d4 den ungedeckten Läufer c5.
    // Der Bauer e5 daneben zählt nicht: Ein Bauer ist kein Gewinn für einen
    // Bauern, und genannt wird ohnehin nur das wertvollste Ziel.
    const italienisch = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    expect(zugfakten(italienisch, "d4")?.drohung).toEqual({ figur: "B", feld: "c5" });
  });

  it("nennt keine Drohung, die schon vorher bestand", () => {
    // Derselbe Läufer, ein Feld weiter auf derselben Diagonale: Lb5 greift den
    // Springer c6 an, den der Bauer b7 deckt · kein Gewinn, also kein Satz.
    expect(zugfakten(ITALIENISCH, "Bb5")?.drohung).toBeUndefined();
  });

  it("hält einen Rückschlag für einen Rückschlag und nicht für einen Gewinn", () => {
    const nachSxe5 = "r1bqkbnr/pppp1ppp/2n5/4N3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 0 3";
    const fakten = zugfakten(nachSxe5, "Nxe5", "Nxe5");
    expect(fakten?.schlaegt).toBe("N");
    expect(fakten?.rueckschlag).toBe(true);
  });

  it("zählt einen Schlag auf einem anderen Feld nicht als Rückschlag", () => {
    const fakten = zugfakten(ITALIENISCH, "Nxe5", "Nc6");
    expect(fakten?.schlaegt).toBe("P");
    expect(fakten?.rueckschlag).toBe(false);
  });

  it("erkennt die Figur, die dem Angriff ausweicht", () => {
    // Nach 8.Sg5 steht die Dame e6 im Feuer eines Springers · 8…De7 ist keine
    // Idee, sondern eine Rettung, und genau das soll dastehen.
    const nachNg5 = "r3kb1r/pppp1ppp/2n1qn2/6N1/4P3/2N5/PPPP1PPP/R1BQR1K1 b kq - 5 8";
    expect(zugfakten(nachNg5, "Qe7")?.flucht).toBe("e6");
  });

  it("hält einen gedeckten Stein nicht für bedroht", () => {
    // Der Springer c6 wird vom Läufer b5 angegriffen und vom Bauern b7
    // gedeckt · wer ihn zieht, flieht nicht, er zieht um.
    const spanisch = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 3";
    expect(zugfakten(spanisch, "Nf6")?.flucht).toBeUndefined();
  });

  it("erkennt Schach, Matt und Rochade", () => {
    const schaefermatt = "r1bqkbnr/pppp1ppp/2n5/2b1p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const matt = zugfakten(schaefermatt, "Qxf7#");
    expect(matt?.matt).toBe(true);
    expect(matt?.schach).toBe(true);
    expect(matt?.schlaegt).toBe("P");

    const rochade = zugfakten("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5", "O-O");
    expect(rochade?.rochade).toBe(true);
    expect(rochade?.figur).toBe("K");
  });

  it("schweigt zu einer Stellung, die den Zug nicht hergibt", () => {
    expect(zugfakten(START, "Qh5xf7")).toBeNull();
    expect(zugfakten("Unsinn", "e4")).toBeNull();
  });
});
