/**
 * Theorie nachschlagen.
 *
 * Die Familienregel ist die aus den Insights, nachgebaut · diese Fälle sind
 * die, an denen eine abweichende Fassung sofort auffiele.
 */
import { describe, expect, it } from "vitest";
import { eroeffnungsfamilie, eroeffnungsTheorie, familienTheorie } from "./eroeffnungstheorie";
import { motivTheorie } from "./motivtheorie";
import { THEME_THEORY } from "../data/puzzleTheory";
import { OPENING_THEORY } from "../data/openingTheory";
import { PUZZLE_THEMES } from "./locales/themes";
import { LOCALES } from "./locales/registry";
import openingNames from "../data/opening-names.json";

describe("Eröffnungsfamilie", () => {
  it("cuts after the first family word, with or without a colon", () => {
    expect(eroeffnungsfamilie("Sicilian Defense: Alapin Variation")).toBe("Sicilian Defense");
    expect(eroeffnungsfamilie("Sicilian Defense Bowdler Attack")).toBe("Sicilian Defense");
    expect(eroeffnungsfamilie("Queen's Gambit Declined: Exchange Variation")).toBe("Queen's Gambit");
    expect(eroeffnungsfamilie("King's Indian Attack")).toBe("King's Indian Attack");
  });

  it("keeps a name without a family word, up to four words", () => {
    expect(eroeffnungsfamilie("Ruy Lopez: Berlin Defense")).toBe("Ruy Lopez");
    expect(eroeffnungsfamilie("Réti Opening")).toBe("Réti Opening");
    expect(eroeffnungsfamilie("")).toBe("");
  });

  it("finds the theory of a named variation through its family", () => {
    const theorie = eroeffnungsTheorie("Caro-Kann Defense: Advance Variation", "de");
    expect(theorie?.schluessel).toBe("Caro-Kann Defense");
    expect(theorie?.text).toContain("1.e4 c6");
    expect(eroeffnungsTheorie("Unbekannte Eröffnung", "de")).toBeNull();
    expect(eroeffnungsTheorie(null, "de")).toBeNull();
  });

  it("lists each played family once, in order, and only where a text exists", () => {
    const liste = familienTheorie(
      [
        "Sicilian Defense",
        "Sicilian Defense: Najdorf Variation",
        "Unbekannt",
        "French Defense: Advance Variation",
      ],
      "en"
    );
    expect(liste.map((eintrag) => eintrag.schluessel)).toEqual(["Sicilian Defense", "French Defense"]);
    expect(familienTheorie(["Sicilian Defense", "French Defense"], "en", 1)).toHaveLength(1);
  });

  /** Jeder Text muss zu einer Familie gehören, die es im Namensdatensatz gibt. */
  it("only explains families that the name table actually produces", () => {
    const familien = new Set(
      Object.values(openingNames as Record<string, string>).map(eroeffnungsfamilie)
    );
    const verwaist = Object.keys(OPENING_THEORY).filter((familie) => !familien.has(familie));
    expect(verwaist).toEqual([]);
  });
});

describe("Motivtheorie", () => {
  it("takes the first theme that has a text and skips classifications", () => {
    expect(motivTheorie(["middlegame", "short", "fork"], "en")?.schluessel).toBe("fork");
    expect(motivTheorie(["crushing", "long"], "en")).toBeNull();
  });

  it("only explains themes the catalogue knows", () => {
    const bekannt = new Set(Object.keys(PUZZLE_THEMES.en));
    expect(Object.keys(THEME_THEORY).filter((key) => !bekannt.has(key))).toEqual([]);
  });

  /** Kein Text fällt in einer Sprache stillschweigend auf Englisch zurück. */
  it("carries every text in every interface language", () => {
    const luecken: string[] = [];
    for (const [katalog, eintraege] of [
      ["theme", THEME_THEORY],
      ["opening", OPENING_THEORY],
    ] as const) {
      for (const [key, text] of Object.entries(eintraege)) {
        for (const locale of LOCALES) {
          if (!text[locale]?.trim()) luecken.push(`${katalog}:${key}:${locale}`);
        }
      }
    }
    expect(luecken).toEqual([]);
  });
});
