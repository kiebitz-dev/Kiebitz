/**
 * Schachregeln mit Chess960-Rochade · eine dünne Schicht über chess.js.
 *
 * chess.js kennt nur die Rochade des Standardschachs: König von e1 nach g1,
 * Turm von h1 nach f1. In Chess960 stehen König und Türme irgendwo auf der
 * Grundreihe, und genau das eine Stück Regelwerk ändert sich. Ein zweiter
 * Zuggenerator neben chess.js wäre dafür viel Code für wenig Unterschied,
 * und chessops (das es könnte) ist GPL und damit für Kiebitz tabu.
 *
 * Die Schicht teilt die Arbeit deshalb auf: chess.js bekommt jede Stellung
 * *ohne* Rochaderechte und liefert alle übrigen Züge, Schach, Matt und
 * Materialremis. Die Rochaderechte führt diese Klasse selbst, als Linie des
 * Turms, und erzeugt die Rochade auch selbst. Für die Legalität der übrigen
 * Züge spielen Rochaderechte keine Rolle, also stimmt, was chess.js darüber
 * sagt, unverändert.
 *
 * Dieselbe Klasse spielt auch Standardschach: Dort stehen die Türme eben auf
 * a und h. Belegt ist beides durch Perft-Zählungen gegen Stockfish
 * (chess960.test.ts).
 */
import { Chess, validateFen, type Square } from "chess.js";

export type Color = "w" | "b";
export type Side = "k" | "q";
type PieceSymbol = "p" | "n" | "b" | "r" | "q" | "k";

const FILES = "abcdefgh";

/** Rochaderechte als Linie (0 = a … 7 = h) des Turms, mit dem rochiert werden darf. */
export interface CastlingRights {
  w: { k: number | null; q: number | null };
  b: { k: number | null; q: number | null };
}

export interface VariantMove {
  from: Square;
  to: Square;
  san: string;
  /**
   * Der Zug in UCI · die Rochade in der Schreibweise der Variante: im
   * Standardschach als Königszug (e1g1), in Chess960 als König auf den Turm
   * (e1h1), so wie Stockfish mit `UCI_Chess960` beides erwartet und liefert.
   */
  uci: string;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  /** Gesetzt bei einer Rochade · dann ist `to` das Zielfeld des Königs. */
  castle?: Side;
  /** Feld des rochierenden Turms · nur bei einer Rochade. */
  rookFrom?: Square;
}

interface Snapshot {
  /** FEN ohne Rochaderechte · so, wie chess.js sie bekommt. */
  bare: string;
  rights: CastlingRights;
}

const sq = (file: number, rank: number) => `${FILES[file]}${rank + 1}` as Square;
const fileOf = (square: string) => FILES.indexOf(square[0]);
const backRank = (color: Color) => (color === "w" ? 0 : 7);
const cloneRights = (r: CastlingRights): CastlingRights => ({
  w: { ...r.w },
  b: { ...r.b },
});

/** Die Belegung einer FEN als 8×8 · Reihe 0 ist die erste Reihe. */
function boardOf(placement: string): (string | null)[][] {
  const rows = placement.split("/");
  const board: (string | null)[][] = [];
  for (let rank = 0; rank < 8; rank++) {
    const row: (string | null)[] = [];
    for (const ch of rows[7 - rank] ?? "") {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) row.push(null);
      else row.push(ch);
    }
    board.push(row);
  }
  return board;
}

function placementOf(board: (string | null)[][]): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece == null) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += piece;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join("/");
}

function kingFile(board: (string | null)[][], color: Color): number | null {
  const rank = backRank(color);
  const king = color === "w" ? "K" : "k";
  const file = board[rank].indexOf(king);
  return file < 0 ? null : file;
}

/**
 * Liest das Rochadefeld einer FEN · KQkq, Shredder (HAha) und X-FEN.
 *
 * `K`/`Q` meinen den äußersten Turm auf der jeweiligen Seite des Königs, ein
 * Buchstabe die Linie des Turms. Ein Recht ohne passenden König oder Turm auf
 * der Grundreihe fällt stillschweigend weg · genauso verfährt Stockfish.
 */
export function parseCastling(field: string, placement: string): CastlingRights {
  const board = boardOf(placement);
  const rights: CastlingRights = { w: { k: null, q: null }, b: { k: null, q: null } };
  if (!field || field === "-") return rights;
  for (const ch of field) {
    const color: Color = ch === ch.toUpperCase() ? "w" : "b";
    const rank = backRank(color);
    const king = kingFile(board, color);
    if (king == null) continue;
    const rook = color === "w" ? "R" : "r";
    const lower = ch.toLowerCase();
    let file: number | null = null;
    if (lower === "k") {
      for (let f = 7; f > king; f--) if (board[rank][f] === rook) { file = f; break; }
    } else if (lower === "q") {
      for (let f = 0; f < king; f++) if (board[rank][f] === rook) { file = f; break; }
    } else if (lower >= "a" && lower <= "h") {
      const f = FILES.indexOf(lower);
      if (board[rank][f] === rook) file = f;
    }
    if (file == null || file === king) continue;
    rights[color][file > king ? "k" : "q"] = file;
  }
  return rights;
}

/**
 * Schreibt die Rochaderechte zurück · im Standardschach als KQkq, in Chess960
 * als X-FEN: `K`/`Q`, solange der Turm der äußerste seiner Seite ist, sonst
 * die Linie. Das verstehen Stockfish, Lichess und der eigene Leser.
 */
export function formatCastling(
  rights: CastlingRights,
  placement: string,
  chess960: boolean
): string {
  const board = boardOf(placement);
  let out = "";
  for (const color of ["w", "b"] as const) {
    const rank = backRank(color);
    const king = kingFile(board, color);
    const rook = color === "w" ? "R" : "r";
    for (const side of ["k", "q"] as const) {
      const file = rights[color][side];
      if (file == null) continue;
      let letter = side === "k" ? "k" : "q";
      if (chess960 && king != null) {
        const outer =
          side === "k"
            ? [...Array(8).keys()].filter((f) => f > king && board[rank][f] === rook).pop()
            : [...Array(8).keys()].find((f) => f < king && board[rank][f] === rook);
        if (outer !== file) letter = FILES[file];
      }
      out += color === "w" ? letter.toUpperCase() : letter;
    }
  }
  return out || "-";
}

/** Zerlegt eine FEN in ihre sechs Felder · fehlende Zähler bekommen Vorgaben. */
function splitFen(fen: string): string[] {
  const parts = fen.trim().split(/\s+/);
  return [parts[0] ?? "", parts[1] ?? "w", parts[2] ?? "-", parts[3] ?? "-", parts[4] ?? "0", parts[5] ?? "1"];
}

/** Die FEN, wie chess.js sie bekommt: ohne Rochaderechte. */
function bareFen(fen: string): string {
  const [placement, turn, , ep, half, full] = splitFen(fen);
  return [placement, turn, "-", ep, half, full].join(" ");
}

/**
 * Prüft eine Stellung · null, wenn sie spielbar ist, sonst der Grund.
 *
 * chess.js prüft Aufbau, Könige und Bauern auf der Grundreihe. Die
 * Rochaderechte prüft es in Chess960 nicht richtig · sie werden deshalb
 * vorher abgetrennt und hier gegen die Belegung gelesen.
 */
export function validatePosition(fen: string): string | null {
  const parts = splitFen(fen);
  const result = validateFen(bareFen(fen));
  if (!result.ok) return result.error ?? "invalid";
  const board = boardOf(parts[0]);
  for (const color of ["w", "b"] as const) {
    const king = color === "w" ? "K" : "k";
    const count = board.flat().filter((p) => p === king).length;
    if (count !== 1) return "kings";
  }
  // Wer nicht am Zug ist, darf nicht im Schach stehen · sonst ließe sich der
  // König schlagen, und Stockfish stürzt über so eine Stellung ab.
  const probe = new Chess(bareFen(fen), { skipValidation: true });
  const turn = parts[1] as Color;
  const other: Color = turn === "w" ? "b" : "w";
  const kingSquare = findKing(probe, other);
  if (kingSquare && probe.isAttacked(kingSquare, turn)) return "check";
  return null;
}

function findKing(chess: Chess, color: Color): Square | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === "k" && cell.color === color) return cell.square;
    }
  }
  return null;
}

export class VariantChess {
  readonly chess960: boolean;
  private chess: Chess;
  private rights: CastlingRights;
  private stack: { snapshot: Snapshot; move: VariantMove }[] = [];
  private readonly startFen: string;
  /** Wie oft jede Stellung schon dastand · für die dreifache Wiederholung. */
  private seen = new Map<string, number>();
  private legalCache: VariantMove[] | null = null;

  constructor(fen: string, opts: { chess960?: boolean } = {}) {
    this.chess960 = opts.chess960 ?? false;
    const [placement, , castling] = splitFen(fen);
    this.rights = parseCastling(castling, placement);
    this.chess = new Chess(bareFen(fen));
    this.startFen = this.fen();
    this.count(1);
  }

  // ── Stellung ─────────────────────────────────────────────────────────────

  fen(): string {
    const [placement, turn, , ep, half, full] = splitFen(this.chess.fen());
    return [placement, turn, formatCastling(this.rights, placement, this.chess960), ep, half, full].join(" ");
  }

  /** Ausgangsstellung der Partie. */
  initialFen(): string {
    return this.startFen;
  }

  turn(): Color {
    return this.chess.turn();
  }

  get(square: Square) {
    return this.chess.get(square);
  }

  board() {
    return this.chess.board();
  }

  castlingRights(): CastlingRights {
    return cloneRights(this.rights);
  }

  history(): VariantMove[] {
    return this.stack.map((entry) => entry.move);
  }

  // ── Züge ─────────────────────────────────────────────────────────────────

  moves(opts: { square?: Square } = {}): VariantMove[] {
    if (!this.legalCache) this.legalCache = [...this.normalMoves(), ...this.castleMoves()];
    return opts.square
      ? this.legalCache.filter((m) => m.from === opts.square)
      : this.legalCache;
  }

  /**
   * Führt einen Zug aus · als SAN, als UCI oder als Feldpaar vom Brett.
   *
   * Vom Brett rochiert man, indem man den König auf den eigenen Turm zieht
   * oder auf sein Zielfeld. Das Zielfeld allein ist in Chess960 manchmal
   * zweideutig (König b1, Zielfeld c1 ist auch ein gewöhnlicher Königszug);
   * dann gilt der gewöhnliche Zug, und die Rochade geht über den Turm.
   */
  move(input: string | { from: string; to: string; promotion?: string }): VariantMove | null {
    const legal = this.moves();
    let found: VariantMove | undefined;
    if (typeof input === "string") {
      const text = input.trim();
      const plain = stripSan(text);
      found =
        legal.find((m) => stripSan(m.san) === plain)
        ?? legal.find((m) => m.uci === text)
        ?? legal.find((m) => m.castle && castleUciAlternatives(m).includes(text))
        ?? legal.find((m) => !m.castle && `${m.from}${m.to}${m.promotion ?? ""}` === text);
    } else {
      const promotion = input.promotion?.toLowerCase();
      const byPair = legal.filter((m) => m.from === input.from && !m.castle && m.to === input.to);
      found =
        byPair.find((m) => !m.promotion || m.promotion === (promotion ?? "q"))
        ?? legal.find((m) => m.castle && m.from === input.from && m.rookFrom === input.to)
        ?? legal.find((m) => m.castle && m.from === input.from && m.to === input.to);
    }
    if (!found) return null;
    this.apply(found);
    return found;
  }

  /**
   * Führt einen Zug aus, den `moves()` eben geliefert hat · ohne ihn erst
   * wiederzufinden. Für Schleifen über alle Züge (Perft, Engine-Turnier).
   */
  play(move: VariantMove): void {
    this.apply(move);
  }

  undo(): VariantMove | null {
    const last = this.stack.pop();
    if (!last) return null;
    this.count(-1);
    this.chess = new Chess(last.snapshot.bare);
    this.rights = cloneRights(last.snapshot.rights);
    this.legalCache = null;
    return last.move;
  }

  // ── Partieende ───────────────────────────────────────────────────────────

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  isCheckmate(): boolean {
    return this.chess.inCheck() && this.moves().length === 0;
  }

  isStalemate(): boolean {
    return !this.chess.inCheck() && this.moves().length === 0;
  }

  isInsufficientMaterial(): boolean {
    return this.chess.isInsufficientMaterial();
  }

  isThreefoldRepetition(): boolean {
    return (this.seen.get(this.key()) ?? 0) >= 3;
  }

  isFiftyMoves(): boolean {
    return Number(splitFen(this.chess.fen())[4]) >= 100;
  }

  isDraw(): boolean {
    return (
      this.isStalemate()
      || this.isInsufficientMaterial()
      || this.isThreefoldRepetition()
      || this.isFiftyMoves()
    );
  }

  isGameOver(): boolean {
    return this.moves().length === 0 || this.isDraw();
  }

  // ── Innen ────────────────────────────────────────────────────────────────

  /** Schlüssel für Wiederholungen · Belegung, Zugrecht, Rochade, e.p. */
  private key(): string {
    const [placement, turn, , ep] = splitFen(this.chess.fen());
    return `${placement} ${turn} ${formatCastling(this.rights, placement, true)} ${ep}`;
  }

  private count(delta: 1 | -1) {
    const key = this.key();
    const next = (this.seen.get(key) ?? 0) + delta;
    if (next <= 0) this.seen.delete(key);
    else this.seen.set(key, next);
  }

  private normalMoves(): VariantMove[] {
    return this.chess.moves({ verbose: true }).map((m) => ({
      from: m.from,
      to: m.to,
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ""}`,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
    }));
  }

  private castleMoves(): VariantMove[] {
    const color = this.chess.turn();
    const enemy: Color = color === "w" ? "b" : "w";
    if (this.chess.inCheck()) return [];
    const rank = backRank(color);
    const [placement] = splitFen(this.chess.fen());
    const board = boardOf(placement);
    const king = kingFile(board, color);
    if (king == null) return [];
    const out: VariantMove[] = [];
    for (const side of ["k", "q"] as const) {
      const rook = this.rights[color][side];
      if (rook == null) continue;
      const kingTo = side === "k" ? 6 : 2;
      const rookTo = side === "k" ? 5 : 3;
      // Alle Felder, die König und Turm überqueren oder betreten, müssen frei
      // sein · bis auf die beiden selbst.
      const lo = Math.min(king, rook, kingTo, rookTo);
      const hi = Math.max(king, rook, kingTo, rookTo);
      let blocked = false;
      for (let f = lo; f <= hi; f++) {
        if (f === king || f === rook) continue;
        if (board[rank][f] != null) blocked = true;
      }
      if (blocked) continue;
      // Kein Feld auf dem Weg des Königs darf angegriffen sein, das Zielfeld
      // eingeschlossen. Geprüft wird auf dem Brett ohne König und Turm: Sonst
      // verdeckte der rochierende Turm einen Angriff, der nach der Rochade
      // über die Reihe durchgeht.
      const probe = new Chess(this.chess.fen(), { skipValidation: true });
      probe.remove(sq(king, rank));
      probe.remove(sq(rook, rank));
      const step = kingTo >= king ? 1 : -1;
      let attacked = false;
      for (let f = king; ; f += step) {
        if (probe.isAttacked(sq(f, rank), enemy)) attacked = true;
        if (f === kingTo) break;
      }
      if (attacked) continue;
      const move: VariantMove = {
        from: sq(king, rank),
        to: sq(kingTo, rank),
        san: side === "k" ? "O-O" : "O-O-O",
        uci: this.chess960 ? `${sq(king, rank)}${sq(rook, rank)}` : `${sq(king, rank)}${sq(kingTo, rank)}`,
        color,
        piece: "k",
        castle: side,
        rookFrom: sq(rook, rank),
      };
      // Schach- und Mattzeichen · nur durch Ausführen zu wissen.
      const after = this.castledFen(move);
      const test = new Chess(after, { skipValidation: true });
      if (test.inCheck()) {
        const replies = test.moves().length;
        move.san += replies === 0 ? "#" : "+";
      }
      out.push(move);
    }
    return out;
  }

  /** FEN (ohne Rochaderechte) nach einer Rochade. */
  private castledFen(move: VariantMove): string {
    const [placement, turn, , , half, full] = splitFen(this.chess.fen());
    const board = boardOf(placement);
    const rank = backRank(turn as Color);
    const king = board[rank][fileOf(move.from)];
    const rook = board[rank][fileOf(move.rookFrom!)];
    board[rank][fileOf(move.from)] = null;
    board[rank][fileOf(move.rookFrom!)] = null;
    board[rank][fileOf(move.to)] = king;
    board[rank][move.castle === "k" ? 5 : 3] = rook;
    const nextTurn = turn === "w" ? "b" : "w";
    const nextFull = turn === "b" ? Number(full) + 1 : Number(full);
    return [placementOf(board), nextTurn, "-", "-", String(Number(half) + 1), String(nextFull)].join(" ");
  }

  private apply(move: VariantMove) {
    const snapshot: Snapshot = { bare: this.chess.fen(), rights: cloneRights(this.rights) };
    const color = move.color;
    const enemy: Color = color === "w" ? "b" : "w";
    if (move.castle) {
      this.chess = new Chess(this.castledFen(move), { skipValidation: true });
      this.rights[color] = { k: null, q: null };
    } else {
      this.chess.move({ from: move.from, to: move.to, promotion: move.promotion });
      if (move.piece === "k") this.rights[color] = { k: null, q: null };
      const own = backRank(color);
      const theirs = backRank(enemy);
      for (const side of ["k", "q"] as const) {
        const file = this.rights[color][side];
        if (file != null && move.from === sq(file, own)) this.rights[color][side] = null;
        const opp = this.rights[enemy][side];
        if (opp != null && move.to === sq(opp, theirs)) this.rights[enemy][side] = null;
      }
    }
    this.stack.push({ snapshot, move });
    this.legalCache = null;
    this.count(1);
  }
}

/** SAN ohne Schach-, Matt- und Wertungszeichen · „0-0" liest sich wie „O-O". */
function stripSan(san: string): string {
  return san.replace(/[+#!?]+$/g, "").replace(/0/g, "O");
}

/** Beide UCI-Schreibweisen einer Rochade · König aufs Zielfeld und auf den Turm. */
function castleUciAlternatives(move: VariantMove): string[] {
  return [`${move.from}${move.to}`, `${move.from}${move.rookFrom}`];
}

/**
 * Dasselbe für eine Partie aus eigener Startstellung · Chess960.
 *
 * chess.js liest so ein PGN nicht: Die Rochade steht darin als „O-O", der
 * Turm aber woanders. Der Zugtext wird deshalb selbst zerlegt (Zugnummern,
 * Kommentare und Ergebnis fallen weg) und über die eigene Regelschicht
 * gespielt (lib/chess960.ts).
 */
export function sansFromVariantPgn(pgn: string, startFen: string): string[] {
  const body = pgn
    .split(/\r?\n\r?\n/)
    .slice(1)
    .join("\n\n")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\([^()]*\)/g, " ");
  let game: VariantChess;
  try {
    game = new VariantChess(startFen, { chess960: true });
  } catch {
    return [];
  }
  const sans: string[] = [];
  for (const token of body.split(/\s+/)) {
    if (!token || /^\d+\.+$/.test(token) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) continue;
    const move = game.move(token);
    if (!move) break;
    sans.push(move.san);
  }
  return sans;
}

// ── Chess960-Startstellungen ─────────────────────────────────────────────────

/**
 * Die Startstellung Nummer `n` (0 … 959) nach Scharnagl · 518 ist die
 * Grundstellung des Standardschachs.
 */
export function chess960Position(n: number): string {
  const id = ((Math.floor(n) % 960) + 960) % 960;
  const row: (string | null)[] = Array(8).fill(null);
  let rest = id;
  // Läufer auf ein helles (b, d, f, h) und ein dunkles Feld (a, c, e, g).
  row[(rest % 4) * 2 + 1] = "b";
  rest = Math.floor(rest / 4);
  row[(rest % 4) * 2] = "b";
  rest = Math.floor(rest / 4);
  const free = () => row.map((p, i) => (p == null ? i : -1)).filter((i) => i >= 0);
  row[free()[rest % 6]] = "q";
  rest = Math.floor(rest / 6);
  // Die zwei Springer auf den verbleibenden fünf Feldern · zehn Möglichkeiten.
  const KNIGHTS: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
  ];
  const [n1, n2] = KNIGHTS[rest];
  const five = free();
  row[five[n1]] = "n";
  row[five[n2]] = "n";
  // Übrig bleiben drei Felder: Turm, König, Turm.
  const three = free();
  row[three[0]] = "r";
  row[three[1]] = "k";
  row[three[2]] = "r";
  const black = row.join("");
  const white = black.toUpperCase();
  return `${black}/pppppppp/8/8/8/8/PPPPPPPP/${white} w KQkq - 0 1`;
}

/** Eine zufällige Chess960-Startstellung samt Nummer. */
export function randomChess960(): { id: number; fen: string } {
  const id = Math.floor(Math.random() * 960);
  return { id, fen: chess960Position(id) };
}

/**
 * Ist das eine Chess960-Stellung, die das Standardschach nicht spielen kann?
 * Das ist der Fall, sobald ein Rochaderecht auf einen König außerhalb von e
 * oder einen Turm außerhalb von a/h zeigt.
 */
export function needsChess960(fen: string): boolean {
  const [placement, , castling] = splitFen(fen);
  const rights = parseCastling(castling, placement);
  const board = boardOf(placement);
  for (const color of ["w", "b"] as const) {
    const r = rights[color];
    if (r.k == null && r.q == null) continue;
    if (kingFile(board, color) !== 4) return true;
    if (r.k != null && r.k !== 7) return true;
    if (r.q != null && r.q !== 0) return true;
  }
  // Ein Rochadebuchstabe außer KQkq ist Shredder-Schreibweise und damit 960.
  return /[A-HJ-Pa-hj-p]/.test(castling.replace(/[KQkq-]/g, ""));
}

/** Zählt die Blätter des Zugbaums · nur für die Tests gegen Stockfish. */
export function perft(game: VariantChess, depth: number): number {
  if (depth === 0) return 1;
  const moves = game.moves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of [...moves]) {
    game.play(move);
    nodes += perft(game, depth - 1);
    game.undo();
  }
  return nodes;
}
