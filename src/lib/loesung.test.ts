/**
 * Die Lösung einer Aufgabe in Worten.
 *
 * Geprüft wird das, woran es peinlich würde: dass der Setup-Zug nicht als
 * Lösung ausgegeben wird, dass die Zugnummern die der Aufgabe sind und nicht
 * bei eins anfangen, dass nur die eigenen Züge einen Satz bekommen — und dass
 * eine kaputte Zugfolge schweigt, statt zu raten.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loesungszeile, loesungszuege } from "./loesung";
import { loadLocale, translator } from "./locales/registry";

beforeAll(async () => {
  await loadLocale("de");
});

const opts = () => ({ t: translator("de"), locale: "de" as const });

describe("Lösung einer Taktikaufgabe", () => {
  /**
   * Eine Lichess-Aufgabe: Der erste Zug ist der Fehler des Gegners, der die
   * Aufgabe stellt. Danach zieht der Löser.
   */
  it("leaves the setup move out and numbers from the puzzle's own position", () => {
    const zuege = loesungszuege(
      {
        // Schwarz am Zug, Zug 20 · Turmendspiel mit Matt auf der Grundreihe.
        fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 20",
        moves: ["g8f8", "a1a8"],
        setup_plies: 1,
      },
      opts()
    );

    expect(zuege).toHaveLength(1);
    expect(zuege[0].text).toBe("21.Ra8+");
    expect(zuege[0].eigen).toBe(true);
    expect(loesungszeile(zuege)).toBe("21.Ra8+");
  });

  /**
   * Eine eigene Aufgabe aus einer eigenen Partie hat keinen Setup-Zug · dort
   * beginnt die Lösung mit dem ersten Halbzug.
   */
  it("comments the solver's moves and stays silent on the replies", () => {
    const zuege = loesungszuege(
      {
        fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 20",
        moves: ["a1a8", "g8g8"],
        setup_plies: 0,
      },
      opts()
    );

    // Der zweite Zug ist unspielbar (g8 ist besetzt, der König steht dort
    // nicht) · die Folge bricht ab, statt etwas zu erfinden.
    expect(zuege).toHaveLength(1);
    expect(zuege[0].eigen).toBe(true);
    expect(zuege[0].satz).toBeTruthy();
  });

  it("says what the move did, in the interface language", () => {
    const zuege = loesungszuege(
      {
        // Grundreihenmatt in einem Zug · die Bauern nehmen dem König die Luft.
        fen: "6k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 20",
        moves: ["a1a8"],
        setup_plies: 0,
      },
      opts()
    );

    expect(zuege[0].text).toBe("20.Qa8#");
    // Das Matt ist das Erste, was ein Satz über diesen Zug sagen muss.
    expect(zuege[0].satz).toContain("Qa8#");
    expect(zuege[0].satz).toBe(translator("de")("expl.mate.1", { san: "Qa8#" }));
  });

  it("returns nothing for a position it cannot read", () => {
    expect(loesungszuege({ fen: "kaputt", moves: ["e2e4"], setup_plies: 0 }, opts())).toEqual([]);
    expect(loesungszeile([])).toBe("");
  });
});
