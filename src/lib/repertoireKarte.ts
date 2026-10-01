/**
 * Das Repertoire als Landkarte · welche Linien sitzen, welche im Nebel liegen.
 *
 * Ein Repertoire ist ein Baum, und ein Baum lässt sich lesen wie ein Wegenetz:
 * Von der Grundstellung gehen die ersten Züge ab wie Straßen aus einem Hafen,
 * jede Verzweigung ist eine Kreuzung, jede Variante endet an einem Ort. Was
 * noch nie trainiert wurde, liegt im Nebel; jede Linie, die sitzt, deckt ihr
 * Stück der Karte auf.
 *
 * Diese Datei rechnet nur · Lage jeder Linie, Sicht jedes Ortes und wo er auf
 * der Karte steht. Gezeichnet wird zweimal, in der gewöhnlichen Fassung als
 * Karte mit Wolken (components/RepertoireKarte.tsx) und auf dem Blatt als
 * gestochene Tafel mit schraffierter Terra incognita. Beide lesen dieselbe
 * Rechnung; der Modus bekommt keine eigene Zahl.
 *
 * ── Wann eine Linie sitzt ─────────────────────────────────────────────────
 *
 * Trainiert werden nur die eigenen Züge, also zählen nur sie. Ein Zug sitzt,
 * wenn er mindestens einmal beantwortet wurde, seine FSRS-Stabilität
 * `SITZT_STABILITAET` Tage erreicht hat und er *heute noch* sicher abgerufen
 * wird. Die Stabilität allein reichte nicht: Sie sinkt nur bei einem Fehler,
 * und wer eine Linie ein halbes Jahr liegen lässt, hätte sonst eine Karte, die
 * nichts mehr mit seinem Gedächtnis zu tun hat. Mit der Abrufwahrscheinlichkeit
 * zieht der Nebel über vernachlässigten Linien wieder auf · dieselbe Formel,
 * mit der der Planer rechnet (`retrievability` in src-tauri/src/repertoire.rs).
 *
 * Eine Linie ist
 *
 *  · klar, wenn jeder eigene Zug darin sitzt,
 *  · im Dunst, wenn schon trainiert wurde, aber noch nicht alles sitzt,
 *  · im Nebel, solange auf ihrem eigenen Zweig noch kein Zug gefragt wurde.
 *
 * „Ihr eigener Zweig" ist das Stück hinter der letzten Gabelung, das nur ihr
 * gehört. Zählte der Stamm mit, läge nach der ersten Woche nichts mehr im
 * Nebel: 1.e4 ist in jeder Linie eines Weißrepertoires, und wer es einmal
 * beantwortet hat, hätte jede Variante „angefangen" · auch die, deren eigene
 * Züge er noch nie gesehen hat. Hat der Zweig keinen eigenen Zug (die Linie
 * endet mit dem Gegnerzug, auf den noch keine Antwort steht), entscheidet die
 * ganze Linie.
 */
import type { RepNode } from "./repertoire";

/** Ab so vielen Tagen Stabilität gilt ein Zug als gelernt. */
export const SITZT_STABILITAET = 7;
/** Unter dieser Abrufwahrscheinlichkeit zieht der Nebel wieder auf. */
export const SITZT_ABRUF = 0.8;

/** Wie die Gewichte im Planer · siehe src-tauri/src/repertoire.rs. */
const FACTOR = 19 / 81;
const DECAY = -0.5;
const TAG = 86_400;

export type Lage = "klar" | "dunst" | "nebel";

/** Abrufwahrscheinlichkeit nach `tage` Tagen bei Stabilität `s`. */
export function abruf(tage: number, s: number): number {
  return (1 + (FACTOR * Math.max(0, tage)) / Math.max(0.1, s)) ** DECAY;
}

/**
 * Sitzt dieser Zug heute?
 *
 * Wann er zuletzt gefragt wurde, steht nicht am Knoten, lässt sich aber
 * zurückrechnen: Der Planer legt den nächsten Termin bei Retention 0,9 genau
 * eine Stabilität (gerundet, 1 bis 365 Tage) hinter die letzte Antwort.
 */
export function zugSitzt(node: RepNode, now: number): boolean {
  if (!node.my_move || node.reps === 0) return false;
  if (node.stability < SITZT_STABILITAET) return false;
  const intervall = Math.min(365, Math.max(1, Math.round(node.stability)));
  const zuletzt = node.due_ts - intervall * TAG;
  return abruf((now - zuletzt) / TAG, node.stability) >= SITZT_ABRUF;
}

/**
 * Wie klar eine Linie zu sehen ist · 1 ganz, 0 gar nicht.
 *
 * Der Dunst beginnt bei einem knappen Drittel, damit schon die erste Antwort
 * sichtbar etwas bewirkt, und wird mit jedem sitzenden Zug lichter. Ganz klar
 * wird er erst, wenn die Linie sitzt · sonst wäre der Unterschied zwischen
 * „fast" und „fertig" ein Pixel Grau.
 */
export function sichtFuer(lage: Lage, sitzend: number, eigene: number): number {
  if (lage === "klar") return 1;
  if (lage === "nebel") return 0;
  return 0.3 + 0.4 * (eigene > 0 ? sitzend / eigene : 0);
}

export interface KartenOrt {
  id: number;
  /** 0 ist die Grundstellung, der Hafen, von dem alles abgeht. */
  parentId: number;
  san: string;
  /** Halbzug · zugleich die Spalte auf der Karte. */
  tiefe: number;
  /** Zeile auf der Karte · Blätter ganzzahlig, Kreuzungen dazwischen. */
  zeile: number;
  name: string;
  eigener: boolean;
  /** Endpunkt einer Variante · dort steht ein Ort mit Namen. */
  endpunkt: boolean;
  /** Ein benannter Zwischenknoten · dort steht ein Landschaftsname. */
  gegend: boolean;
  /** Schlüssel der Variante, die hier aufgeschlagen wird · wie in der Liste. */
  key: string | null;
  /** Die beste Lage einer Linie, die hier durchführt. */
  lage: Lage;
  sicht: number;
}

export interface KartenLinie {
  /** Derselbe Schlüssel wie in der Variantenliste · `${seite}:${endId}`. */
  key: string;
  endId: number;
  /** Knoten von der Grundstellung bis zum Endpunkt. */
  pfad: number[];
  lage: Lage;
  sicht: number;
  /** Eigene Züge der Linie und wie viele davon sitzen. */
  eigene: number;
  sitzend: number;
  trainiert: number;
}

export interface KartenTeil {
  seite: "white" | "black";
  orte: KartenOrt[];
  linien: KartenLinie[];
  /** Tiefster Halbzug · so viele Spalten hat die Karte. */
  tiefe: number;
  /** Anzahl der Zeilen · eine je Endpunkt. */
  zeilen: number;
}

export interface Zaehlung {
  klar: number;
  dunst: number;
  nebel: number;
  gesamt: number;
}

export interface Karte {
  teile: KartenTeil[];
  zaehlung: Zaehlung;
  /** Anteil der klaren Linien in Prozent, ganzzahlig. */
  anteil: number;
}

const RANG_LEER = Number.MAX_SAFE_INTEGER;

function teilFuer(seite: "white" | "black", nodes: RepNode[], now: number): KartenTeil | null {
  const eigene = nodes.filter((node) => node.side === seite);
  if (eigene.length === 0) return null;
  const byId = new Map(eigene.map((node) => [node.id, node]));
  const kinder = new Map<number, RepNode[]>();
  for (const node of eigene) {
    // Ein Knoten, dessen Vorgänger fehlt, hängt am Hafen · so geht beim
    // Zeichnen nichts verloren, auch wenn der Baum einmal unvollständig ankommt.
    const parent = byId.has(node.parent_id) ? node.parent_id : 0;
    kinder.set(parent, [...(kinder.get(parent) ?? []), node]);
  }

  // Die Reihenfolge der Liste · ein Zweig steht so weit oben wie die erste
  // seiner Varianten im Verzeichnis. Die Karte und die Liste sollen dieselbe
  // Variante an derselben Stelle haben, sonst sucht man zweimal.
  const rang = new Map<number, number>();
  const rangVon = (node: RepNode): number => {
    const bekannt = rang.get(node.id);
    if (bekannt != null) return bekannt;
    const unten = kinder.get(node.id) ?? [];
    let wert = node.name.trim() !== "" || unten.length === 0 ? node.sort_order || RANG_LEER : RANG_LEER;
    for (const kind of unten) wert = Math.min(wert, rangVon(kind));
    rang.set(node.id, wert);
    return wert;
  };
  const geordnet = (parent: number) =>
    [...(kinder.get(parent) ?? [])].sort((a, b) => rangVon(a) - rangVon(b) || a.id - b.id);

  const orte: KartenOrt[] = [];
  const ortVon = new Map<number, KartenOrt>();
  const linien: KartenLinie[] = [];
  let naechsteZeile = 0;
  let tiefe = 1;

  const besuche = (node: RepNode, pfad: number[]): number => {
    const weg = [...pfad, node.id];
    const unten = geordnet(node.id);
    const ort: KartenOrt = {
      id: node.id,
      parentId: byId.has(node.parent_id) ? node.parent_id : 0,
      san: node.san,
      tiefe: node.depth,
      zeile: 0,
      name: node.name.trim(),
      eigener: node.my_move,
      endpunkt: unten.length === 0,
      gegend: unten.length > 0 && node.name.trim() !== "",
      key: unten.length === 0 || node.name.trim() !== "" ? `${seite}:${node.id}` : null,
      lage: "nebel",
      sicht: 0,
    };
    orte.push(ort);
    ortVon.set(node.id, ort);
    tiefe = Math.max(tiefe, node.depth);
    if (unten.length === 0) {
      ort.zeile = naechsteZeile++;
      const pfadKnoten = weg.map((id) => byId.get(id)!);
      const zuege = pfadKnoten.filter((zug) => zug.my_move);
      const sitzend = zuege.filter((zug) => zugSitzt(zug, now)).length;
      const trainiert = zuege.filter((zug) => zug.reps > 0).length;
      // Der eigene Zweig beginnt hinter der letzten Gabelung · siehe Kopf.
      let gabel = 0;
      pfadKnoten.forEach((zug, index) => {
        const parent = byId.has(zug.parent_id) ? zug.parent_id : 0;
        if ((kinder.get(parent)?.length ?? 0) > 1) gabel = index;
      });
      const zweig = pfadKnoten.slice(gabel).filter((zug) => zug.my_move);
      const begonnen = zweig.length > 0 ? zweig.some((zug) => zug.reps > 0) : trainiert > 0;
      const lage: Lage =
        zuege.length > 0 && sitzend === zuege.length ? "klar" : begonnen ? "dunst" : "nebel";
      linien.push({
        key: `${seite}:${node.id}`,
        endId: node.id,
        pfad: weg,
        lage,
        sicht: sichtFuer(lage, sitzend, zuege.length),
        eigene: zuege.length,
        sitzend,
        trainiert,
      });
      return ort.zeile;
    }
    const zeilen = unten.map((kind) => besuche(kind, weg));
    // Eine Kreuzung steht zwischen ihrem ersten und letzten Abzweig · so
    // laufen die Wege von ihr aus symmetrisch auseinander.
    ort.zeile = (zeilen[0] + zeilen[zeilen.length - 1]) / 2;
    return ort.zeile;
  };
  for (const wurzel of geordnet(0)) besuche(wurzel, []);

  // Ein Ort ist so klar wie die klarste Linie, die durch ihn führt.
  const rangDerLage: Record<Lage, number> = { nebel: 0, dunst: 1, klar: 2 };
  for (const linie of linien) {
    for (const id of linie.pfad) {
      const ort = ortVon.get(id);
      if (!ort) continue;
      if (linie.sicht > ort.sicht) ort.sicht = linie.sicht;
      if (rangDerLage[linie.lage] > rangDerLage[ort.lage]) ort.lage = linie.lage;
    }
  }

  return { seite, orte, linien, tiefe, zeilen: naechsteZeile };
}

/** Die ganze Karte · Weiß und Schwarz als zwei Teile, gezählt wird gemeinsam. */
export function repertoireKarte(nodes: RepNode[], now: number): Karte {
  const teile = (["white", "black"] as const)
    .map((seite) => teilFuer(seite, nodes, now))
    .filter((teil): teil is KartenTeil => teil != null);
  const zaehlung: Zaehlung = { klar: 0, dunst: 0, nebel: 0, gesamt: 0 };
  for (const teil of teile) {
    for (const linie of teil.linien) {
      zaehlung[linie.lage] += 1;
      zaehlung.gesamt += 1;
    }
  }
  const anteil = zaehlung.gesamt > 0 ? Math.round((zaehlung.klar / zaehlung.gesamt) * 100) : 0;
  return { teile, zaehlung, anteil };
}

/** Der Ort, an dem eine Linie endet · für die Auskunft unter der Karte. */
export function linieZu(karte: Karte, key: string | null): KartenLinie | null {
  if (!key) return null;
  for (const teil of karte.teile) {
    const linie = teil.linien.find((eintrag) => eintrag.key === key);
    if (linie) return linie;
  }
  return null;
}
