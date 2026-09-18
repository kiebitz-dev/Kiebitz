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
 * werden sollen. Linien und Diagonalen bleiben dem Schlüssel: Sie reichen
 * über viele Felder, und ein Zeichen auf jedem davon wäre Rauschen.
 *
 * Frei- und Doppelbauern stehen immer mit auf dem Brett. Früher wichen sie
 * einer Idee oder einem Angriff · dann verschwanden sie aber von einem Zug
 * zum nächsten, obwohl die Bauern noch genauso standen, und das las sich wie
 * ein Fehler und nicht wie Zurückhaltung.
 */
export function brettZeichen(zeichen: readonly InformatorZeichen[]): Map<string, InformatorZeichen[]> {
  const out = new Map<string, InformatorZeichen[]>();
  for (const z of zeichen) {
    if (!z.squares) continue;
    if (z.kind === "file" || z.kind === "diagonal") continue;
    for (const feld of z.squares) {
      const liste = out.get(feld) ?? [];
      liste.push(z);
      out.set(feld, liste);
    }
  }
  return out;
}

/** Zeichen, die die ganze Stellung betreffen und kein Feld haben. */
const STELLUNG = new Set<ZeichenArt>([
  "eval",
  "bishop_pair",
  "opposite_bishops",
  "same_bishops",
  "ending",
  "time_trouble",
]);

/**
 * Die Zeichen ohne Feld · an den Rand des Bretts, wie im Buch unter das
 * Diagramm. Wer eine Seite hat (Läuferpaar, Zeitnot), steht an ihrem Namen,
 * alles andere (Bewertung, Läuferfarben, Endspiel) unter dem Brett.
 */
export function randZeichen(zeichen: readonly InformatorZeichen[]): {
  weiss: InformatorZeichen[];
  schwarz: InformatorZeichen[];
  stellung: InformatorZeichen[];
} {
  const out = { weiss: [] as InformatorZeichen[], schwarz: [] as InformatorZeichen[], stellung: [] as InformatorZeichen[] };
  for (const z of schluesselFolge(zeichen)) {
    if (!STELLUNG.has(z.kind) || (z.squares && z.squares.length > 0)) continue;
    if (z.side === "w") out.weiss.push(z);
    else if (z.side === "b") out.schwarz.push(z);
    else out.stellung.push(z);
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
