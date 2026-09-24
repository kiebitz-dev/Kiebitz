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

/**
 * Die Stufen des Reglers · in Hunderterschritten von 600 bis 3100, dann volle
 * Kraft (0). Ab 1320 stellt Stockfish die Stärke selbst ein (`UCI_Elo`),
 * darunter schwächt das Backend über Skill Level 0 und eine flache Suche ab ·
 * und weil das nur wenige echte Stufen hergibt, kommt dort `blunderChance`
 * dazu.
 */
export const PLAY_LEVELS: readonly number[] = [
  ...Array.from({ length: 26 }, (_, i) => 600 + i * 100),
  0,
];

/** Ab hier regelt Stockfish die Stärke selbst · siehe MIN_UCI_ELO in play.rs. */
const MIN_UCI_ELO = 1320;

/**
 * Wie oft die Engine unter 1320 statt ihres Zuges einen beliebigen spielt.
 * Linear von 0 knapp unter 1320 bis 60 % bei 600 · so unterscheidet sich jede
 * Hunderterstufe spürbar von der nächsten, statt dass drei Suchtiefen sie
 * unter sich aufteilen.
 */
export function blunderChance(elo: number): number {
  if (elo === 0 || elo >= MIN_UCI_ELO) return 0;
  const clamped = Math.max(600, elo);
  return (0.6 * (MIN_UCI_ELO - clamped)) / (MIN_UCI_ELO - 600);
}

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
      elo: PLAY_LEVELS.includes(parsed.elo as number) ? parsed.elo! : DEFAULT_SETUP.elo,
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
