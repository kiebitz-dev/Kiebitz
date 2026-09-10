import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";

/** Spiegelt repertoire::RepNodeOut aus dem Rust-Backend. */
export interface RepNode {
  id: number;
  parent_id: number; // 0 = Wurzel
  side: "white" | "black";
  san: string;
  name: string;
  /** Freitext zur Stellung: Plan, Idee, Falle. */
  note: string;
  /** Gleiche Schlüssel auf derselben Seite sind Transpositionen. */
  fen_key: string;
  depth: number; // Halbzug des Zuges (1-basiert)
  reps: number;
  lapses: number;
  due_ts: number;
  stability: number;
  /** Selbst gezogene Position in der Variantenliste · 0 = nie sortiert. */
  sort_order: number;
  my_move: boolean;
}

export interface DueItem {
  node_id: number;
  side: "white" | "black";
  prompt_sans: string[];
  expected_san: string;
  line: string;
  is_new: boolean;
}

export interface ReviewResult {
  due_ts: number;
  interval_days: number;
}

export interface SideCoverage {
  side: "white" | "black";
  games: number;
  covered: number;
  pct: number;
}

export interface RepStats {
  my_positions: number;
  due_now: number;
  coverage_pct: number;
  games_checked: number;
  /** Prüftiefe in Halbzügen · ohne sie ist die Quote nicht zu deuten. */
  plies: number;
  by_side: SideCoverage[];
}

/** Ein Zug aus den eigenen Partien, den das Buch an dieser Stelle nicht kennt. */
export interface RepGap {
  node_id: number;
  side: "white" | "black";
  path_sans: string[];
  san: string;
  count: number;
  /** True = ich bin abgewichen; false = mir fehlt eine Antwort. */
  mine: boolean;
  score_pct: number;
  book_sans: string[];
  line: string;
}

export interface PgnImportResult {
  lines: number;
  added: number;
  skipped: number;
}

export interface Deviation {
  san: string;
  count: number;
}

export interface NodeGameStats {
  games: number;
  score_pct: number;
  book_sans: string[];
  deviations: Deviation[];
  followed_book: number;
}

export function repList(): Promise<RepNode[]> {
  return invoke<RepNode[]>("rep_list");
}

export function repAddLine(side: "white" | "black", name: string, sans: string[]): Promise<number> {
  return invoke<number>("rep_add_line", { side, name, sans }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

/**
 * Reihenfolge der Varianten einer Seite festschreiben.
 *
 * `nodeIds` ist die vollständige Liste der Linien-Endpunkte in ihrer neuen
 * Reihenfolge · das Backend schreibt daraus die Plätze 1..n.
 */
export function repReorder(side: "white" | "black", nodeIds: number[]): Promise<void> {
  return invoke<void>("rep_reorder", { side, nodeIds }).then(() => emitDataChange("repertoire"));
}

export function repDelete(id: number): Promise<void> {
  return invoke<void>("rep_delete", { id }).then(() => emitDataChange("repertoire"));
}

/** Fällige Karten einer Sitzung · 0 oder undefined heißt "ohne Grenze". */
export function repDue(dueLimit?: number, newLimit?: number): Promise<DueItem[]> {
  return invoke<DueItem[]>("rep_due", {
    dueLimit: dueLimit ?? null,
    newLimit: newLimit ?? null,
  });
}

/**
 * Karten für das freie Üben · aus dem Buch selbst statt aus dem Plan.
 *
 * FSRS entscheidet, *was* wiederholt werden muss, und das ist die richtige
 * Antwort auf die Frage „womit halte ich mein Repertoire?". Es ist die falsche
 * Antwort auf „ich will jetzt üben": Wer abends eine halbe Stunde Zeit hat,
 * bekommt vom Plan an manchen Tagen nichts, und das Buch steht ungenutzt da.
 * Diese Liste ist die Gegenrichtung · sie nimmt jede Stelle, an der ich am Zug
 * bin, ganz gleich wann sie das nächste Mal dran wäre.
 *
 * Geschwister fallen zusammen: Kennt das Buch an einer Stelle zwei eigene
 * Züge, ist das *eine* Frage mit zwei richtigen Antworten und keine zwei
 * Fragen · genau so behandelt der Trainer sie auch. Gefragt wird deshalb je
 * Elternstellung einmal.
 *
 * Die Reihenfolge ist gewürfelt. Der Baum von oben nach unten abzufragen hieße,
 * jede Sitzung mit demselben ersten Zug zu beginnen und dabei den Weg zur
 * Stellung mitzulernen statt der Stellung.
 *
 * `random` ist nur für den Test da · im Betrieb würfelt `Math.random`.
 */
export function repFreeItems(nodes: RepNode[], random: () => number = Math.random): DueItem[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /** SAN-Kette von der Grundstellung bis zu diesem Zug. */
  const pathSans = (node: RepNode): string[] => {
    const sans: string[] = [];
    let current: RepNode | undefined = node;
    // Die Obergrenze schützt nur vor einer defekten `parent_id`, die die
    // Schleife sonst ewig laufen ließe · dieselbe Vorsicht wie im Backend.
    for (let step = 0; current && step < 64; step += 1) {
      sans.push(current.san);
      current = current.parent_id === 0 ? undefined : byId.get(current.parent_id);
    }
    return sans.reverse();
  };

  /** Name der Variante · der nächste benannte Knoten über dem Zug, wie im Backend. */
  const lineName = (node: RepNode): string => {
    let current: RepNode | undefined = node;
    for (let step = 0; current && step < 64; step += 1) {
      if (current.name.trim() !== "") return current.name;
      current = current.parent_id === 0 ? undefined : byId.get(current.parent_id);
    }
    return "";
  };

  const asked = new Set<string>();
  const items: DueItem[] = [];
  for (const node of nodes) {
    if (!node.my_move) continue;
    const question = `${node.side}:${node.parent_id}`;
    if (asked.has(question)) continue;
    asked.add(question);
    const sans = pathSans(node);
    items.push({
      node_id: node.id,
      side: node.side,
      prompt_sans: sans.slice(0, -1),
      expected_san: node.san,
      line: lineName(node),
      is_new: node.reps === 0,
    });
  }

  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Grade: 1 = falsch, 2 = schwer, 3 = gut, 4 = leicht. */
export function repReview(nodeId: number, grade: 1 | 2 | 3 | 4): Promise<ReviewResult> {
  return invoke<ReviewResult>("rep_review", { nodeId, grade }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

export function repStats(plies?: number, games?: number): Promise<RepStats> {
  return invoke<RepStats>("rep_stats", { plies: plies ?? null, games: games ?? null });
}

export function repNodeGames(nodeId: number): Promise<NodeGameStats> {
  return invoke<NodeGameStats>("rep_node_games", { nodeId });
}

/** Lücken im Buch, abgeleitet aus den eigenen Partien. */
export function repGaps(plies?: number, games?: number, limit?: number): Promise<RepGap[]> {
  return invoke<RepGap[]>("rep_gaps", {
    plies: plies ?? null,
    games: games ?? null,
    limit: limit ?? null,
  });
}

export function repSetNote(nodeId: number, note: string): Promise<void> {
  return invoke<void>("rep_set_note", { nodeId, note }).then(() => emitDataChange("repertoire"));
}

/**
 * Namen einer Variante setzen · leerer Text nimmt ihn weg.
 *
 * Gebraucht beim Bearbeiten: `repAddLine` benennt den Endpunkt der *neuen*
 * Zugfolge, der alte Endpunkt trüge seinen Namen sonst weiter und stünde als
 * zweite, gleichnamige Zeile im Verzeichnis.
 *
 * Wie beim Notizfeld gilt: Der Gerätesync trägt den Namen nur mit, wenn der
 * Knoten beim Gegenüber neu entsteht · eine Umbenennung bleibt auf dem Gerät,
 * auf dem sie geschah.
 */
export function repSetName(nodeId: number, name: string): Promise<void> {
  return invoke<void>("rep_set_name", { nodeId, name }).then(() => emitDataChange("repertoire"));
}

/** Knoten derselben Seite, die dieselbe Stellung erreichen (Transpositionen). */
export function repLookup(side: "white" | "black", sans: string[]): Promise<RepNode[]> {
  return invoke<RepNode[]>("rep_lookup", { side, sans });
}

export function repImportPgn(
  side: "white" | "black",
  name: string,
  pgn: string
): Promise<PgnImportResult> {
  return invoke<PgnImportResult>("rep_import_pgn", { side, name, pgn }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

/** Import aus einer Datei · das Frontend kennt nur den Pfad, nicht den Inhalt. */
export function repImportPgnFile(
  side: "white" | "black",
  name: string,
  path: string
): Promise<PgnImportResult> {
  return invoke<PgnImportResult>("rep_import_pgn_file", { side, name, path }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

export function repExportPgnFile(side: "white" | "black", path: string): Promise<string> {
  return invoke<string>("rep_export_pgn_file", { side, path });
}
