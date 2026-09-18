import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { emitDataChange } from "./changes";
import type { InformatorZeichen } from "./informator";

// ── Live-Engine (persistente Stockfish-Instanz, Streaming) ──────────────────

/** Eine gestreamte info-Zeile; eval_cp aus Sicht des Spielers am Zug. */
export interface LiveInfo {
  generation: number;
  depth: number;
  multipv: number;
  eval_cp: number | null;
  mate_in: number | null;
  nps: number | null;
  pv: string[];
}

export interface LiveDone {
  generation: number;
  bestmove: string;
}

interface LiveInfoBatch {
  lines: LiveInfo[];
}

/** Startet die Dauer-Analyse; liefert die Generation dieser Anfrage. */
export function analyzeLive(fen: string, depth?: number): Promise<number> {
  return invoke<number>("analyze_live", { fen, depth: depth ?? null });
}

export function stopLive(): Promise<void> {
  return invoke("stop_live");
}

export function onEngineInfo(cb: (info: LiveInfo) => void): Promise<UnlistenFn> {
  // Rust coalesces the latest MultiPV slots into one bridge message. Fan-out
  // happens only after deserialization, keeping Stockfish chatter away from
  // the WebView event queue while preserving the small callback API.
  return listen<LiveInfoBatch>("engine://info-batch", (e) => {
    e.payload.lines.forEach(cb);
  });
}

export function onEngineDone(cb: (done: LiveDone) => void): Promise<UnlistenFn> {
  return listen<LiveDone>("engine://done", (e) => cb(e.payload));
}

// ── Auto-Analyse-Pipeline ────────────────────────────────────────────────────

export interface MoveEvalRow {
  ply: number;
  san: string;
  eval_cp: number | null; // nach dem Zug, aus Weiß-Sicht
  mate_in: number | null;
  best_uci: string; // Engine-Empfehlung vor dem Zug
  judgment: "" | "inaccuracy" | "mistake" | "blunder";
  phase: "opening" | "middlegame" | "endgame";
  /** Verlust in Zentibauern · fehlt, wo ein Matt im Spiel ist. */
  loss_cp?: number | null;
  /**
   * Was an dem Zug erzählenswert ist · `fork`, `pin`, `hanging_piece` und so
   * weiter, erkannt in `src-tauri/src/motifs.rs`. Leer, wenn nichts
   * Belastbares gefunden wurde, und `none`, wenn der Zug zwar bemängelt
   * wurde, aber kein Motiv dahintersteht. Zum Satz wird es in
   * `lib/erklaerung.ts`.
   */
  motif?: string;
  /** Die Felder des Motivs als JSON · leer, wenn es keine gibt. */
  motif_detail?: string;
  /** Die Hauptvariante vor dem Zug, in englischem SAN. */
  pv?: string[];
  /**
   * Die Informator-Zeichen der Stellung *vor* diesem Zug · entstanden im
   * Analyselauf (`src-tauri/src/informator.rs`). Leer, solange keine
   * abgelegt sind.
   */
  signs?: InformatorZeichen[];
}

export interface AnalysisProgress {
  game_index: number;
  games_total: number;
  game_id: number;
  opponent: string;
  ply: number;
  plies: number;
}

export interface AnalysisGameDone {
  game_id: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

export interface AnalysisAllDone {
  analyzed: number;
  canceled: boolean;
  error: string | null;
}

export function startAnalysis(opts: {
  gameIds?: number[];
  depth?: number;
  limit?: number;
}): Promise<void> {
  return invoke("start_analysis", {
    gameIds: opts.gameIds ?? null,
    depth: opts.depth ?? null,
    limit: opts.limit ?? null,
  });
}

export function cancelAnalysis(): Promise<void> {
  return invoke("cancel_analysis");
}

export function gameAnalysis(gameId: number): Promise<MoveEvalRow[]> {
  return invoke<MoveEvalRow[]>("game_analysis", { gameId });
}

export function onAnalysisProgress(cb: (p: AnalysisProgress) => void): Promise<UnlistenFn> {
  return listen<AnalysisProgress>("analysis://progress", (e) => cb(e.payload));
}

export function onAnalysisGameDone(cb: (p: AnalysisGameDone) => void): Promise<UnlistenFn> {
  return listen<AnalysisGameDone>("analysis://game_done", (e) => cb(e.payload));
}

export function onAnalysisDone(cb: (p: AnalysisAllDone) => void): Promise<UnlistenFn> {
  return listen<AnalysisAllDone>("analysis://done", (e) => {
    if (e.payload.analyzed > 0) emitDataChange("analysis", "games", "puzzles");
    cb(e.payload);
  });
}

// ── Buchtiefe ────────────────────────────────────────────────────────────────

/** Wie weit eine Partie in der Theorie lief · siehe src-tauri/src/book.rs. */
export interface BookLine {
  /** So viele Halbzüge ab dem Start sind als Buch belegt. */
  plies: number;
  /**
   * `true`: Danach ging die Partie nachweislich aus dem Buch. `false`: Ab dort
   * wissen die Quellen nichts mehr, und die alte Faustregel übernimmt.
   */
  decided: boolean;
  /** `own` (Referenzdatenbank) oder `masters` (Explorer-Zwischenspeicher). */
  source: string;
}

/** Nur lokale Quellen, nie das Netz · `null`, wenn keine etwas weiß. */
export function bookLine(moves: string): Promise<BookLine | null> {
  return invoke<BookLine | null>("book_line", { moves });
}

// ── Fehler nach Spielphase ───────────────────────────────────────────────────

export interface PhaseErrors {
  phase: "opening" | "middlegame" | "endgame";
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

export function errorStats(): Promise<PhaseErrors[]> {
  return invoke<PhaseErrors[]>("error_stats");
}

// ── Positionssuche ───────────────────────────────────────────────────────────

export interface NextMoveStat {
  san: string;
  games: number;
  score_pct: number;
}

export interface PositionHit {
  game_id: number;
  ply: number;
  opponent: string;
  color: "white" | "black";
  result: "win" | "loss" | "draw";
  played_at: string;
  time_class: string;
  next_san: string;
}

export interface PositionSearch {
  total_games: number;
  next_moves: NextMoveStat[];
  sample: PositionHit[];
}

export function searchPosition(fen: string): Promise<PositionSearch> {
  return invoke<PositionSearch>("search_position", { fen });
}

export function indexPositions(): Promise<number> {
  return invoke<number>("index_positions");
}
