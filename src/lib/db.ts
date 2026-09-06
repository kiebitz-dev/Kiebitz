import { invoke } from "@tauri-apps/api/core";
import { emitDataChange, onDataChange } from "./changes";

/** Spiegelt db::GameRecord aus dem Rust-Backend (snake_case wie serialisiert). */
export interface GameSummary {
  id: number | null;
  source: "chess.com" | "lichess" | "manual";
  url: string;
  played_at: string; // ISO-Datum
  played_ts: number; // Unix-Sekunden (Partie-Ende)
  time_class: string;
  color: "white" | "black";
  /** Der in dieser konkreten Partie gefuehrte eigene Spielername. */
  my_name?: string;
  opponent: string;
  opp_elo: number;
  my_elo: number;
  result: "win" | "loss" | "draw";
  opening: string;
  eco: string;
  moves_count: number;
  accuracy: number | null;
  accuracy_opening?: number | null;
  accuracy_middlegame?: number | null;
  accuracy_endgame?: number | null;
  /** Genauigkeit des Gegners, aus Plattformdaten oder der Auto-Analyse. */
  opponent_accuracy?: number | null;
  opponent_accuracy_opening?: number | null;
  opponent_accuracy_middlegame?: number | null;
  opponent_accuracy_endgame?: number | null;
  has_moves?: boolean;
  has_note?: boolean;
  moves?: string; // Volltext ist nur im Detaildatensatz vorhanden.
  /** Restzeit nach jedem Halbzug in Hundertstelsekunden, leerzeichengetrennt. */
  clocks?: string;
  /** PGN-TimeControl der Partie ("600+5"); leer, wenn unbekannt. */
  time_control?: string;
  /**
   * Wie die Partie endete · siehe `TERMINATIONS` in lib/boardEnd.ts. Leer,
   * wenn weder Quelle noch Schlussstellung etwas hergeben.
   */
  termination?: string;
  note?: string;
  tags?: string[];
  analyzed: boolean;
  /** In Bibliothek behalten, aber aus Engine- und Statistik-Analysen auslassen. */
  analysis_excluded?: boolean;
  /**
   * Das Fazit der Auto-Analyse als JSON-Liste von `{key, params}` ·
   * Sätze macht daraus `erklaereFazit` in lib/erklaerung.ts.
   *
   * Nur der Einzeldatensatz trägt es. Die Listenabfragen lassen es weg, weil
   * ein Absatz je Partie über 1.500 Partien Nutzlast wäre, die dort niemand
   * liest.
   */
  verdict?: string;
}

export interface GameRecord extends GameSummary {
  source_id: string;
  moves: string;
  note: string;
}

export interface GamePageRequest {
  offset: number;
  limit: number;
  source?: string;
  result?: string;
  time_class?: string;
  played_day?: string;
  played_from?: number;
  played_to?: number;
  /** Untere Zeitgrenze des Zeitraum-Filters (Unix-Sekunden); 0 heisst: alle. */
  since?: number;
  opponent?: string;
  opening?: string;
  /** Gespielte Farbe ("white"/"black"); leer heisst: beide. */
  color?: string;
  /** ECO-Kennung; leer heisst: alle. */
  eco?: string;
  query?: string;
}

export interface GamePage {
  items: GameSummary[];
  total: number;
  library_total: number;
}

export interface UpsertResult {
  inserted: number;
  total: number;
}

let gamesRequest: Promise<GameRecord[]> | null = null;
let summariesRequest: Promise<GameSummary[]> | null = null;
const detailRequests = new Map<number, Promise<GameRecord>>();
let statsRequest: Promise<{ total: number }> | null = null;

onDataChange(() => {
  gamesRequest = null;
  summariesRequest = null;
  detailRequests.clear();
  statsRequest = null;
}, ["games", "analysis", "database"]);

export function listGamesForExport(): Promise<GameRecord[]> {
  if (!gamesRequest) {
    const request = invoke<GameRecord[]>("list_games_for_export");
    gamesRequest = request;
    void request.catch(() => {
      if (gamesRequest === request) gamesRequest = null;
    });
  }
  return gamesRequest;
}

export function listGameSummaries(): Promise<GameSummary[]> {
  if (!summariesRequest) {
    const request = invoke<GameSummary[]>("list_game_summaries");
    summariesRequest = request;
    void request.catch(() => {
      if (summariesRequest === request) summariesRequest = null;
    });
  }
  return summariesRequest;
}

export function getGame(id: number): Promise<GameRecord> {
  let request = detailRequests.get(id);
  if (!request) {
    request = invoke<GameRecord>("game_detail", { id });
    detailRequests.set(id, request);
    void request.catch(() => {
      if (detailRequests.get(id) === request) detailRequests.delete(id);
    });
  }
  return request;
}

export function listGamesPage(request: GamePageRequest): Promise<GamePage> {
  return invoke<GamePage>("list_games_page", { request });
}

export function upsertGames(games: GameRecord[]): Promise<UpsertResult> {
  return invoke<UpsertResult>("upsert_games", { games }).then((r) => {
    emitDataChange("games");
    return r;
  });
}

export function setGameNote(id: number, note: string): Promise<void> {
  return invoke<void>("set_game_note", { id, note }).then(() => emitDataChange("games"));
}

export function setGameTags(id: number, tags: string[]): Promise<string[]> {
  return invoke<string[]>("set_game_tags", { id, tags }).then((saved) => {
    emitDataChange("games");
    return saved;
  });
}

export function deleteGame(id: number): Promise<boolean> {
  return invoke<boolean>("delete_game", { id }).then((deleted) => {
    if (deleted) emitDataChange("games");
    return deleted;
  });
}

export function readPgnFile(path: string): Promise<string> {
  return invoke<string>("read_pgn_file", { path });
}

export function writePgnFile(path: string, contents: string): Promise<number> {
  return invoke<number>("write_pgn_file", { path, contents });
}

export function dbStats(): Promise<{ total: number }> {
  if (!statsRequest) {
    const request = invoke<{ total: number }>("db_stats");
    statsRequest = request;
    void request.catch(() => {
      if (statsRequest === request) statsRequest = null;
    });
  }
  return statsRequest;
}

/**
 * Ein Merker der Oberfläche, der einen Neuaufbau der WebView überlebt.
 *
 * Der `localStorage` ist auf dem Desktop kein dauerhafter Speicher, sondern das
 * Profil der eingebetteten WebView: Eine Neuinstallation nimmt ihn mit. Was
 * über eine Sitzung hinaus gelten soll, gehört deshalb in die `meta`-Tabelle
 * der Datenbank · gerätelokal und bewusst nicht im Sync.
 */
export function uiFlagGet(key: string): Promise<string | null> {
  return invoke<string | null>("ui_flag_get", { key });
}

export function uiFlagSet(key: string, value: string): Promise<void> {
  return invoke<void>("ui_flag_set", { key, value });
}
