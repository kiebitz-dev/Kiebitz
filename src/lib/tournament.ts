/**
 * Engine-Turnier · Aufruf ans Backend (src-tauri/src/tournament.rs).
 *
 * Der Lauf gehört dem Backend und nicht der Seite: Wer die Einstellungen
 * schließt, soll ein laufendes Turnier nicht abbrechen. Deshalb gibt es neben
 * dem Ereignisstrom auch `tournamentStatus()` zum Nachfragen beim Öffnen.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface EngineRef {
  name: string;
  path: string;
}

export interface TournamentConfig {
  engines: EngineRef[];
  movetimeMs: number;
  rounds: number;
  maxPlies?: number;
  threads?: number;
  hashMb?: number;
  /** Bretter zugleich · weggelassen entscheidet das Backend nach den Kernen. */
  boards?: number;
}

export interface Standing {
  name: string;
  /** Punkte in Halben · 3 heißt anderthalb. */
  halfPoints: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface PlayedGame {
  round: number;
  white: string;
  black: string;
  result: string;
  /** "mate" | "stalemate" | "insufficient" | "fifty" | "repetition" | … */
  reason: string;
  plies: number;
  moves: string;
  /** Schlussstellung · leer bei Partien aus älteren Ständen. */
  fen?: string;
}

/** Ein Brett, an dem gerade gespielt wird. */
export interface LiveBoard {
  /** Nummer des Bretts ab 1 · bleibt, während die Partien daran wechseln. */
  board: number;
  round: number;
  white: string;
  black: string;
  fen: string;
  plies: number;
  /** Letzter Zug als UCI · leer vor dem ersten. */
  lastMove: string;
}

export interface TournamentStatus {
  running: boolean;
  played: number;
  total: number;
  white: string;
  black: string;
  fen: string;
  plies: number;
  /** Alle Bretter, an denen gerade gespielt wird. */
  boards: LiveBoard[];
  standings: Standing[];
  games: PlayedGame[];
  error: string | null;
  cancelled: boolean;
}

export const EMPTY_STATUS: TournamentStatus = {
  running: false,
  played: 0,
  total: 0,
  white: "",
  black: "",
  fen: "",
  plies: 0,
  boards: [],
  standings: [],
  games: [],
  error: null,
  cancelled: false,
};

export function tournamentStart(config: TournamentConfig): Promise<void> {
  return invoke<void>("tournament_start", { config });
}

export function tournamentStatus(): Promise<TournamentStatus> {
  return invoke<TournamentStatus>("tournament_status");
}

export function tournamentCancel(): Promise<void> {
  return invoke<void>("tournament_cancel");
}

export function tournamentPgn(): Promise<string> {
  return invoke<string>("tournament_pgn");
}

export function onTournamentProgress(cb: (status: TournamentStatus) => void): Promise<UnlistenFn> {
  // Ohne Tauri (Web-Vorschau, Tests) gibt es keinen Ereignisstrom · dann
  // wird eben nichts gemeldet, statt dass eine Ablehnung ins Leere läuft.
  return listen<TournamentStatus>("tournament://progress", (event) => cb(event.payload)).catch(
    () => () => {}
  );
}

/** Punkte, wie sie in einer Tabelle stehen: 3 Halbe sind „1,5". */
export function points(halfPoints: number, locale: string): string {
  return (halfPoints / 2).toLocaleString(locale, { maximumFractionDigits: 1 });
}
