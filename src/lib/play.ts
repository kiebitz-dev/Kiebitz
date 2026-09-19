/**
 * Gegen die Engine spielen · Aufruf ans Backend (src-tauri/src/play.rs) und
 * die Einstellungen, mit denen man zuletzt gespielt hat.
 */
import { invoke } from "@tauri-apps/api/core";

export interface PlayRequest {
  startFen: string;
  /** Bisherige Züge in UCI · die Rochade in der Schreibweise der Variante. */
  moves: string[];
  chess960: boolean;
  /** Angestrebte Stärke · 0 heißt volle Kraft. */
  elo: number;
  movetimeMs: number;
}

export interface PlayReply {
  bestmove: string;
  evalCp: number | null;
  mateIn: number | null;
}

export function playMove(request: PlayRequest): Promise<PlayReply> {
  return invoke<PlayReply>("play_move", { request });
}

/** Wie die nächste Partie beginnt · gemerkt je Gerät. */
export interface PlaySetup {
  color: "white" | "black" | "random";
  /** 0 = volle Kraft. */
  elo: number;
  movetimeMs: number;
  start: "standard" | "chess960";
}

/** Die Stufen des Reglers · unter 1320 schwächt das Backend über die Suchtiefe ab. */
export const PLAY_LEVELS = [600, 900, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 2800, 0] as const;

export const DEFAULT_SETUP: PlaySetup = {
  color: "white",
  elo: 1400,
  movetimeMs: 800,
  start: "standard",
};

const STORAGE_KEY = "kiebitz.play";

export function loadSetup(): PlaySetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETUP;
    const parsed = JSON.parse(raw) as Partial<PlaySetup>;
    return {
      color: parsed.color === "black" || parsed.color === "random" ? parsed.color : "white",
      elo: PLAY_LEVELS.includes(parsed.elo as (typeof PLAY_LEVELS)[number]) ? parsed.elo! : DEFAULT_SETUP.elo,
      movetimeMs:
        typeof parsed.movetimeMs === "number" ? Math.min(10_000, Math.max(100, parsed.movetimeMs)) : DEFAULT_SETUP.movetimeMs,
      start: parsed.start === "chess960" ? "chess960" : "standard",
    };
  } catch {
    return DEFAULT_SETUP;
  }
}

export function saveSetup(setup: PlaySetup): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Privates Fenster oder gesperrter Speicher · dann eben die Vorgabe.
  }
}
