/**
 * Informator-Zeichen · gelesen, nicht gerechnet.
 *
 * Die Zeichen entstehen im Analyselauf (`src-tauri/src/informator.rs`) und
 * liegen an den Zeilen von `move_evals` und an der Partie. Die Oberfläche
 * holt sie dort ab und setzt sie aufs Diagramm; hier steht nur, wie sie
 * aussehen, welche davon aufs Brett gehören und in welcher Reihenfolge der
 * Schlüssel sie nennt.
 *
 * Eine Liste von Zeichen gehört zu *einer* Stellung: die an der Zeile eines
 * Halbzugs zur Stellung vor diesem Zug, `end_signs` zur Schlussstellung.
 */

export type ZeichenArt =
  | "eval"
  | "nag"
  | "idea"
  | "attack"
  | "against"
  | "file"
  | "diagonal"
  | "bishop_pair"
  | "opposite_bishops"
  | "same_bishops"
  | "passed"
  | "doubled"
  | "ending"
  | "time_trouble";

export interface InformatorZeichen {
  kind: ZeichenArt;
  /** Bewertung („+/-") oder Urteil („??"). */
  value?: string;
  squares?: string[];
  /** Der Zug hinter einer Idee oder einem Angriff, englisches SAN. */
  san?: string;
  /** Wen das Zeichen betrifft · Läuferpaar, Zeitnot. */
  side?: "w" | "b";
}

const ARTEN = new Set<string>([
  "eval",
  "nag",
  "idea",
  "attack",
  "against",
  "file",
  "diagonal",
  "bishop_pair",
  "opposite_bishops",
  "same_bishops",
  "passed",
  "doubled",
  "ending",
  "time_trouble",
]);

/**
 * Was vom Backend kommt · als Liste oder als JSON-Text (`end_signs`).
 * Unbekannte Arten fallen heraus: Ein neuer Regelstand soll eine ältere
 * Oberfläche nicht mit Zeichen füllen, die sie nicht erklären kann.
 */
export function leseZeichen(raw: unknown): InformatorZeichen[] {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is InformatorZeichen =>
      typeof entry === "object" && entry !== null && ARTEN.has((entry as { kind?: string }).kind ?? "")
  );
}

/**
 * Die Zeichen aufs Brett · je Feld in der Reihenfolge, in der sie gelesen
 * werden sollen. Freibauern und Doppelbauern stehen nur dann auf dem Brett,
 * wenn es sonst nichts zu sagen gibt: Neben einer Idee und einem Angriff
 * wären sie Rauschen, und im Schlüssel stehen sie ohnehin.
 */
export function brettZeichen(zeichen: readonly InformatorZeichen[]): Map<string, InformatorZeichen[]> {
  const out = new Map<string, InformatorZeichen[]>();
  const anmerkung = zeichen.some((z) => ["nag", "idea", "attack", "against"].includes(z.kind));
  for (const z of zeichen) {
    if (!z.squares) continue;
    if (z.kind === "file" || z.kind === "diagonal") continue;
    if (anmerkung && (z.kind === "passed" || z.kind === "doubled")) continue;
    for (const feld of z.squares) {
      const liste = out.get(feld) ?? [];
      liste.push(z);
      out.set(feld, liste);
    }
  }
  return out;
}

/** Reihenfolge im Schlüssel · Urteil vor Idee vor Struktur. */
const RANG: Record<ZeichenArt, number> = {
  eval: 0,
  nag: 1,
  idea: 2,
  attack: 3,
  against: 4,
  file: 5,
  diagonal: 5,
  time_trouble: 6,
  bishop_pair: 7,
  opposite_bishops: 7,
  same_bishops: 7,
  passed: 8,
  doubled: 9,
  ending: 10,
};

export function schluesselFolge(zeichen: readonly InformatorZeichen[]): InformatorZeichen[] {
  return [...zeichen].sort((a, b) => RANG[a.kind] - RANG[b.kind]);
}
