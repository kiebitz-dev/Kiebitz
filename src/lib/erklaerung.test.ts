/**
 * Die Satzmaschine der Analyse.
 *
 * Geprüft wird, was den Unterschied zwischen „hilfreich" und „peinlich"
 * ausmacht: dass ohne Motiv geschwiegen wird, dass Notation und Zahlen in der
 * Sprache der Oberfläche stehen, und dass ein Schlüssel aus der Datenbank
 * nicht ungeprüft auf die Seite kommt.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  begruendeZug,
  erklaereFazit,
  erklaereZug,
  kommentiereZug,
  type Zugzeile,
} from "./erklaerung";
import { loadLocale, translator } from "./locales/registry";
import { setFormatLocale } from "./format";

beforeAll(async () => {
  await loadLocale("de");
});

const de = () => translator("de");

function zeile(over: Partial<Zugzeile> = {}): Zugzeile {
  return {
    ply: 34,
    san: "Nxe5",
    judgment: "blunder",
    ...over,
  };
}

describe("Erklärung eines Zuges", () => {
  it("schweigt zu einem Zug, an dem nichts auffiel", () => {
    const satz = erklaereZug(zeile({ judgment: "", motif: "" }), {
      t: de(),
      locale: "de",
    });
    expect(satz).toBeNull();
  });

  it("nennt die Gabel mit Figur und Feld", () => {
    const satz = erklaereZug(
      zeile({
        motif: "fork",
        motif_detail: JSON.stringify({
          reply: "Qd5+",
          piece: "Q",
          square: "d5",
          targets: [
            { piece: "K", square: "g8" },
            { piece: "N", square: "e5" },
          ],
        }),
      }),
      { t: de(), locale: "de" }
    );
    expect(satz).toContain("d5");
    expect(satz).toContain("König");
    expect(satz).toContain("Springer");
    // Deutsche Notation, nicht englische.
    expect(satz).toContain("Dd5+");
    expect(satz).not.toContain("Qd5+");
  });

  it("fällt auf den Preis zurück, wenn kein Motiv gefunden wurde", () => {
    setFormatLocale("de-DE");
    const satz = erklaereZug(
      zeile({
        motif: "none",
        motif_detail: JSON.stringify({ best: "Nf3" }),
        loss_cp: 120,
      }),
      { t: de(), locale: "de" }
    );
    // Der Verlust steht in Bauern und in deutscher Schreibweise.
    expect(satz).toContain("1,2");
    expect(satz).toContain("Sf3");
  });

  it("behauptet kein Motiv, dem die Felder fehlen", () => {
    // „fork" ohne Ziele ist keine Gabel, sondern eine kaputte Zeile.
    const satz = erklaereZug(
      zeile({ motif: "fork", motif_detail: JSON.stringify({ reply: "Qd5+" }), loss_cp: 90 }),
      { t: de(), locale: "de" }
    );
    expect(satz).not.toBeNull();
    expect(satz).not.toContain("Gabel");
  });

  it("liest denselben Zug immer gleich und zwei Züge verschieden", () => {
    const t = de();
    const eins = { t, locale: "de" as const, seed: "7:34" };
    const zwei = { t, locale: "de" as const, seed: "7:35" };
    const row = zeile({ motif: "back_rank", motif_detail: JSON.stringify({ square: "g1" }) });
    expect(erklaereZug(row, eins)).toBe(erklaereZug(row, eins));
    // Über die beiden Formulierungen hinweg trifft irgendein Samenpaar auch
    // zwei verschiedene · sonst wäre die Auswahl wirkungslos.
    const alle = new Set(
      ["a", "b", "c", "d", "e"].map((seed) => erklaereZug(row, { t, locale: "de", seed }))
    );
    expect(alle.size).toBeGreaterThan(1);
    expect(erklaereZug(row, zwei)).not.toBeUndefined();
  });

  it("sagt ohne Motiv lieber Figuren als Bewertungspunkte", () => {
    const satz = erklaereZug(
      zeile({ motif: "none", motif_detail: JSON.stringify({ best: "Qd2" }), loss_cp: 300 }),
      {
        t: de(),
        locale: "de",
        folge: {
          schlag: "Bxe5",
          geschlagen: "N",
          schach: false,
          netto: { figuren: ["N"], wert: 3 },
          danach: { figuren: [], wert: 0 },
        },
      }
    );
    expect(satz).toBe("Lxe5 schlägt einen Springer.");
  });

  it("bleibt beim Preis, wo sich nichts nachspielen ließ", () => {
    setFormatLocale("de-DE");
    const satz = erklaereZug(
      zeile({ motif: "none", motif_detail: JSON.stringify({ best: "Qd2" }), loss_cp: 300 }),
      { t: de(), locale: "de", folge: null }
    );
    expect(satz).toContain("3,0");
  });

  it("nimmt ein unbekanntes Motiv nicht für bare Münze", () => {
    // Eine spätere Rust-Fassung könnte ein Motiv liefern, das diese Fassung
    // nicht kennt. Dann darf kein roher Schlüssel auf der Seite stehen.
    const satz = erklaereZug(
      zeile({ motif: "zwischenzug", motif_detail: "{}", loss_cp: 40 }),
      { t: de(), locale: "de" }
    );
    expect(satz).not.toContain("expl.");
  });
});

describe("Begründung eines Zuges", () => {
  it("schweigt, solange die Engine den Zug nicht bemängelt", () => {
    const satz = begruendeZug(zeile({ judgment: "" }), { t: de(), locale: "de" });
    expect(satz).toBeNull();
  });

  it("schweigt, wenn keine Widerlegung gespeichert ist", () => {
    expect(begruendeZug(zeile(), { t: de(), locale: "de" })).toBeNull();
  });

  it("nennt die Widerlegung, wo kein Motiv erkannt wurde", () => {
    // Der Fall, für den die Zeile gebaut ist: Die Analyse hat ein Urteil, aber
    // kein Motiv · dann sagt der Satz darüber nichts über den Gegenzug.
    const satz = begruendeZug(
      zeile({ ply: 25, motif: "none", motif_detail: JSON.stringify({ reply: "Nxe4" }) }),
      { t: de(), locale: "de" }
    );
    // In deutscher Notation · dieselbe Sprache wie die Oberfläche.
    expect(satz).toContain("Sxe4");
  });

  it("wiederholt die Widerlegung nicht, die das Motiv schon nennt", () => {
    const satz = begruendeZug(
      zeile({ ply: 25, motif: "fork", motif_detail: JSON.stringify({ reply: "Qd5+" }) }),
      { t: de(), locale: "de" }
    );
    expect(satz).toBeNull();
  });

  it("nennt keine Bewertungen mehr", () => {
    // Zwei Zahlen auf einer Skala, die außerhalb einer Engine niemand im Kopf
    // hat, waren keine Begründung · siehe `begruendeZug`.
    const satz = begruendeZug(
      zeile({ ply: 25, motif: "none", motif_detail: JSON.stringify({ reply: "Nxe4" }) }),
      { t: de(), locale: "de" }
    );
    expect(satz).not.toMatch(/[+−]\d/);
  });
});

describe("Anmerkung zu einem Zug", () => {
  /** Die Umstände eines bemängelten Zuges · Halbzug 7, also zieht Weiß. */
  const umstand = (over: Record<string, unknown> = {}) => ({
    t: de(),
    locale: "de" as const,
    urteil: "Ungenauigkeit",
    bemaengelt: true,
    ...over,
  });

  it("nennt die Fortsetzung des Gegners und was besser war", () => {
    setFormatLocale("de-DE");
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "inaccuracy", motif: "none" }),
      umstand({
        linieDavor: ["Ne2", "Bg4", "O-O"],
        linieDanach: ["Bg4", "Be2", "Nd4"],
      })
    );
    // Das Urteil steht für sich · ohne Rechnung dahinter.
    expect(text).toContain("Ungenauigkeit");
    // Die Fortsetzung des Gegners, mit Zugzahlen und in deutscher Notation.
    expect(text).toContain("4...Lg4 5.Le2 Sd4");
    // Und die Linie, die es besser gemacht hätte.
    expect(text).toContain("4.Se2 Lg4 5.0–0");
    expect(text).toContain("Se2");
  });

  it("nennt keine Bewertungszahlen mehr", () => {
    setFormatLocale("de-DE");
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "inaccuracy", motif: "none" }),
      umstand({ linieDanach: ["Bg4", "Be2", "Nd4"] })
    );
    expect(text).not.toMatch(/[+−]\d/);
    expect(text).not.toContain("Vorteil");
  });

  it("kürzt eine lange Variante auf ein lesbares Maß", () => {
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "inaccuracy", motif: "none" }),
      umstand({ linieDanach: ["Bg4", "Be2", "Nd4", "Nxd4", "Bxe2", "Qxe2", "exd4"] })
    );
    // Fünf Halbzüge stehen da, der sechste nicht mehr.
    expect(text).toContain("Sxd4");
    expect(text).not.toContain("Dxe2");
  });

  it("bleibt beim kurzen Satz, solange keine Linie gespeichert ist", () => {
    // Partien aus der Zeit vor der Hauptvarianten-Spalte · sie haben den
    // besseren Zug und sonst nichts.
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "inaccuracy", motif: "none" }),
      umstand({ besser: "Ne2" })
    );
    expect(text).toContain("Besser war Se2");
    expect(text).not.toContain("4.");
  });

  it("nennt das Motiv, wo eines erkannt wurde", () => {
    const text = kommentiereZug(
      zeile({
        ply: 7,
        san: "d3",
        judgment: "blunder",
        motif: "hanging_piece",
        motif_detail: JSON.stringify({ piece: "N", square: "f3", reply: "Bxf3" }),
      }),
      umstand({ urteil: "Patzer" })
    );
    expect(text).toContain("Springer");
    expect(text).toContain("f3");
  });

  it("bleibt zu einem Zug ohne Motiv und ohne Linie beim Urteil", () => {
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "inaccuracy", motif: "none", loss_cp: 100 }),
      umstand()
    );
    expect(text).toBe("Ungenauigkeit.");
  });

  it("sagt in Figuren, was die Fortsetzung kostet", () => {
    // Der Fall aus docs/EXPLANATIONS.md: Der Gegner nimmt einen Bauern mit
    // Schach und holt sich hinterher den Turm.
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "blunder", motif: "none" }),
      umstand({
        urteil: "Patzer",
        folge: {
          schlag: "Qxa4+",
          geschlagen: "P",
          schach: true,
          netto: { figuren: ["P", "R"], wert: 6 },
          danach: { figuren: ["R"], wert: 5 },
        },
      })
    );
    expect(text).toContain("Dxa4+ schlägt einen Bauern mit Schach");
    expect(text).toContain("gewinnt danach einen Turm");
  });

  it("nennt den Schlagzug nicht zweimal, wenn das Motiv ihn schon hat", () => {
    const text = kommentiereZug(
      zeile({
        ply: 7,
        san: "Nxb5",
        judgment: "blunder",
        motif: "hanging_piece",
        motif_detail: JSON.stringify({ piece: "N", square: "b5", reply: "Bxb5" }),
      }),
      umstand({
        urteil: "Patzer",
        folge: {
          schlag: "Bxb5",
          geschlagen: "N",
          schach: false,
          netto: { figuren: ["N"], wert: 3 },
          danach: { figuren: [], wert: 0 },
        },
      })
    );
    // Einmal im Motivsatz und kein zweites Mal daneben.
    expect(text.match(/Lxb5/g)).toHaveLength(1);
  });

  it("lässt die Notation der Fortsetzung fort, wo ein Satz sie schon erzählt", () => {
    const text = kommentiereZug(
      zeile({ ply: 7, san: "d3", judgment: "blunder", motif: "none" }),
      umstand({
        urteil: "Patzer",
        linieDanach: ["Bg4", "Be2", "Nd4"],
        folge: {
          schlag: "Bxg4",
          geschlagen: "B",
          schach: false,
          netto: { figuren: ["B"], wert: 3 },
          danach: { figuren: [], wert: 0 },
        },
      })
    );
    expect(text).toContain("Lxg4 schlägt einen Läufer");
    expect(text).not.toContain("4...Lg4");
  });

  it("führt zu einem gutgeheißenen Zug die Hauptvariante weiter", () => {
    const text = kommentiereZug(
      zeile({ ply: 25, san: "h3", judgment: "", motif: "best_move" }),
      umstand({
        urteil: "Großartig",
        bemaengelt: false,
        linieDavor: ["h3", "Nd5", "Ne4"],
      })
    );
    expect(text).toContain("Großartig.");
    // Der Motivsatz zum besten Zug · er nennt den Zug selbst.
    expect(text).toContain("h3");
    // Und die Linie, in der er steht.
    expect(text).toContain("13.h3 Sd5 14.Se4");
    // „Besser war" gibt es hier nicht · es gab nichts Besseres.
    expect(text).not.toContain("Besser");
  });

  it("bietet keinen besseren Zug an, der der gespielte ist", () => {
    const text = kommentiereZug(
      zeile({ ply: 7, san: "Ne2", judgment: "inaccuracy", motif: "none" }),
      umstand({ linieDavor: ["Ne2", "Bg4"], besser: "Ne2" })
    );
    expect(text).not.toContain("Besser");
  });
});

describe("Fazit der Partie", () => {
  const fazit = JSON.stringify([
    { key: "verdict.grade.solid", params: { acc: 84.2 } },
    { key: "verdict.turningPoint", params: { n: 17, san: "Nxe5" } },
    { key: "verdict.recurring", params: { n: 2, motif: "fork" } },
  ]);

  it("setzt die Bausteine in der Sprache der Oberfläche", () => {
    setFormatLocale("de-DE");
    const saetze = erklaereFazit(fazit, { t: de(), locale: "de" });
    expect(saetze).toHaveLength(3);
    expect(saetze[0]).toContain("84,2");
    expect(saetze[1]).toContain("Sxe5");
    expect(saetze[2]).toContain("Gabel");
  });

  it("lässt einen Baustein weg, den es nicht kennt", () => {
    const mit = JSON.stringify([
      { key: "verdict.grade.solid", params: { acc: 84.2 } },
      { key: "verdict.erfunden", params: {} },
    ]);
    expect(erklaereFazit(mit, { t: de(), locale: "de" })).toHaveLength(1);
  });

  it("verträgt ein fehlendes oder kaputtes Fazit", () => {
    expect(erklaereFazit(undefined, { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit("", { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit("kein JSON", { t: de(), locale: "de" })).toEqual([]);
    expect(erklaereFazit('{"key":"x"}', { t: de(), locale: "de" })).toEqual([]);
  });
});
