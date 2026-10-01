import { describe, expect, it } from "vitest";
import type { RepNode } from "./repertoire";
import { abruf, repertoireKarte, sichtFuer, SITZT_STABILITAET, zugSitzt } from "./repertoireKarte";

const NOW = 1_800_000_000;
const TAG = 86_400;

let naechsteId = 1;
function knoten(teil: Partial<RepNode> & Pick<RepNode, "san" | "depth">): RepNode {
  const side = teil.side ?? "white";
  return {
    id: naechsteId++,
    parent_id: 0,
    side,
    name: "",
    note: "",
    fen_key: "",
    reps: 0,
    lapses: 0,
    due_ts: 0,
    stability: 0,
    sort_order: 0,
    my_move: side === "white" ? teil.depth % 2 === 1 : teil.depth % 2 === 0,
    ...teil,
  };
}

/** Ein Zug, der gerade erst beantwortet wurde und `stability` Tage hält. */
const gelernt = (stability: number) => ({
  reps: 3,
  stability,
  due_ts: NOW + Math.round(stability) * TAG,
});

describe("zugSitzt", () => {
  it("braucht eine Antwort und genug Stabilität", () => {
    expect(zugSitzt(knoten({ san: "e4", depth: 1 }), NOW)).toBe(false);
    expect(zugSitzt(knoten({ san: "e4", depth: 1, ...gelernt(3.7) }), NOW)).toBe(false);
    expect(zugSitzt(knoten({ san: "e4", depth: 1, ...gelernt(SITZT_STABILITAET) }), NOW)).toBe(true);
  });

  it("zählt Gegnerzüge nie", () => {
    expect(zugSitzt(knoten({ san: "e5", depth: 2, ...gelernt(30) }), NOW)).toBe(false);
  });

  it("lässt den Nebel über einer liegengelassenen Linie wieder aufziehen", () => {
    // Vor 40 Tagen zuletzt gefragt, bei zehn Tagen Stabilität · fällig war
    // der Zug vor 30 Tagen.
    const vergessen = knoten({ san: "e4", depth: 1, reps: 3, stability: 10, due_ts: NOW - 30 * TAG });
    expect(abruf(40, 10)).toBeLessThan(0.8);
    expect(zugSitzt(vergessen, NOW)).toBe(false);
    // Ein paar Tage über dem Termin ist er noch da.
    const knapp = knoten({ san: "e4", depth: 1, reps: 3, stability: 10, due_ts: NOW - 3 * TAG });
    expect(zugSitzt(knapp, NOW)).toBe(true);
  });
});

describe("sichtFuer", () => {
  it("lichtet den Dunst mit jedem sitzenden Zug, ohne klar zu werden", () => {
    expect(sichtFuer("nebel", 0, 2)).toBe(0);
    expect(sichtFuer("dunst", 0, 2)).toBeCloseTo(0.3);
    expect(sichtFuer("dunst", 1, 2)).toBeCloseTo(0.5);
    expect(sichtFuer("dunst", 1, 2)).toBeLessThan(sichtFuer("klar", 2, 2));
    expect(sichtFuer("klar", 2, 2)).toBe(1);
  });
});

describe("repertoireKarte", () => {
  it("ordnet Linien nach Lage und deckt den gemeinsamen Stamm auf", () => {
    const e4 = knoten({ san: "e4", depth: 1, ...gelernt(20) });
    const e5 = knoten({ san: "e5", depth: 2, parent_id: e4.id });
    const nf3 = knoten({ san: "Nf3", depth: 3, parent_id: e5.id, ...gelernt(12) });
    const c5 = knoten({ san: "c5", depth: 2, parent_id: e4.id });
    const c3 = knoten({ san: "c3", depth: 3, parent_id: c5.id, name: "Alapin", reps: 1, stability: 3.7, due_ts: NOW + 4 * TAG });
    const d4 = knoten({ san: "d4", depth: 1 });
    const karte = repertoireKarte([e4, e5, nf3, c5, c3, d4], NOW);

    expect(karte.zaehlung).toEqual({ klar: 1, dunst: 1, nebel: 1, gesamt: 3 });
    expect(karte.anteil).toBe(33);
    const [weiss] = karte.teile;
    const lage = Object.fromEntries(weiss.linien.map((linie) => [linie.endId, linie.lage]));
    expect(lage[nf3.id]).toBe("klar");
    // c3 ist einmal beantwortet, sitzt aber noch nicht · trainiert, nicht gelernt.
    expect(lage[c3.id]).toBe("dunst");
    expect(lage[d4.id]).toBe("nebel");

    const ort = new Map(weiss.orte.map((eintrag) => [eintrag.id, eintrag]));
    // Der Stamm gehört der klarsten Linie, die durch ihn führt.
    expect(ort.get(e4.id)?.lage).toBe("klar");
    expect(ort.get(e4.id)?.sicht).toBe(1);
    expect(ort.get(c5.id)?.lage).toBe("dunst");
    // Endpunkte bekommen ganze Zeilen, Kreuzungen stehen zwischen ihren Zweigen.
    expect(ort.get(nf3.id)?.zeile).toBe(0);
    expect(ort.get(c3.id)?.zeile).toBe(1);
    expect(ort.get(e4.id)?.zeile).toBe(0.5);
    expect(ort.get(d4.id)?.zeile).toBe(2);
    expect(weiss.tiefe).toBe(3);
    expect(weiss.zeilen).toBe(3);
    // Der Schlüssel ist derselbe wie in der Variantenliste.
    expect(ort.get(c3.id)?.key).toBe(`white:${c3.id}`);
    expect(ort.get(e5.id)?.key).toBeNull();
  });

  it("hebt den Nebel über einem Zweig nicht schon wegen des Stamms", () => {
    // 1.e4 sitzt · die Spanische Linie dahinter wurde noch nie gefragt.
    const e4 = knoten({ san: "e4", depth: 1, ...gelernt(20) });
    const e5 = knoten({ san: "e5", depth: 2, parent_id: e4.id });
    const nf3 = knoten({ san: "Nf3", depth: 3, parent_id: e5.id, ...gelernt(12) });
    const nc6 = knoten({ san: "Nc6", depth: 4, parent_id: nf3.id });
    const bb5 = knoten({ san: "Bb5", depth: 5, parent_id: nc6.id, name: "Ruy Lopez" });
    const bc4 = knoten({ san: "Bc4", depth: 5, parent_id: nc6.id, name: "Italian", reps: 1, stability: 3, due_ts: NOW + 3 * TAG });
    const c5 = knoten({ san: "c5", depth: 2, parent_id: e4.id });
    const karte = repertoireKarte([e4, e5, nf3, nc6, bb5, bc4, c5], NOW);
    const lage = Object.fromEntries(karte.teile[0].linien.map((linie) => [linie.endId, linie.lage]));
    expect(lage[bb5.id]).toBe("nebel");
    expect(lage[bc4.id]).toBe("dunst");
    // Endet eine Linie mit dem Gegnerzug, entscheidet die ganze Linie · hier
    // ist 1.e4 ihr einziger eigener Zug, und der sitzt.
    expect(lage[c5.id]).toBe("klar");
  });

  it("folgt der selbst gezogenen Reihenfolge der Liste", () => {
    const e4 = knoten({ san: "e4", depth: 1, sort_order: 2 });
    const d4 = knoten({ san: "d4", depth: 1, sort_order: 1 });
    const [weiss] = repertoireKarte([e4, d4], NOW).teile;
    const zeile = Object.fromEntries(weiss.orte.map((ort) => [ort.san, ort.zeile]));
    expect(zeile.d4).toBe(0);
    expect(zeile.e4).toBe(1);
  });

  it("führt Weiß und Schwarz als zwei Teile und lässt leere weg", () => {
    const e4 = knoten({ san: "e4", depth: 1, side: "black" });
    const c5 = knoten({ san: "c5", depth: 2, side: "black", parent_id: e4.id });
    const karte = repertoireKarte([e4, c5], NOW);
    expect(karte.teile.map((teil) => teil.seite)).toEqual(["black"]);
    expect(karte.teile[0].linien[0].eigene).toBe(1);
    expect(repertoireKarte([], NOW)).toEqual({
      teile: [],
      zaehlung: { klar: 0, dunst: 0, nebel: 0, gesamt: 0 },
      anteil: 0,
    });
  });
});
