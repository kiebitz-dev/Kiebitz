import { Chess } from "chess.js";
import type { GameRecord } from "./db";
import {
  clocksFromPgn,
  parseTimeControl,
  serializeClocks,
} from "./clocks";
import { terminationFromChessCom, terminationFromLichess } from "./boardEnd";

/** Liest einen PGN-Header-Wert, z. B. header(pgn, "ECO") → "B20". */
function pgnHeader(pgn: string, key: string): string {
  const m = pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`));
  return m ? m[1] : "";
}

/** "Sicilian-Defense-Bowdler-Attack-2...e6" → "Sicilian Defense Bowdler Attack" */
function openingFromSlug(url: string): string {
  const slug = url.split("/openings/")[1] ?? "";
  const words: string[] = [];
  for (const w of slug.split("-")) {
    if (/\d/.test(w)) break; // ab der Zugangabe abschneiden
    if (w) words.push(w);
  }
  return words.join(" ");
}

/** PGN-Movetext → SAN-Liste (über chess.js, ignoriert Uhr-Kommentare). */
function sansFromPgn(pgn: string): string[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.history();
  } catch {
    return [];
  }
}

interface CcSide {
  username: string;
  rating: number;
  result: string;
}

interface CcGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  /** "chess" für normales Schach, sonst die Variante ("chess960", …). */
  rules?: string;
  white: CcSide;
  black: CcSide;
  accuracies?: { white?: number; black?: number };
}

const TIME_CLASS: Record<string, string> = {
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  daily: "daily",
  classical: "classical",
  correspondence: "daily",
  ultraBullet: "bullet",
};

function ccResult(me: CcSide, opp: CcSide): "win" | "loss" | "draw" {
  if (me.result === "win") return "win";
  if (opp.result === "win") return "loss";
  return "draw";
}

/**
 * Import von chess.com. `months` begrenzt auf die letzten n Monatsarchive;
 * ohne Angabe wird die komplette Historie geholt.
 *
 * Ein `signal` bricht den Lauf ab. Die Monatsarchive kommen einzeln, deshalb
 * wird hier nicht geworfen, sondern zurückgegeben, was bis dahin geholt wurde ·
 * ein Abbruch nach dreißig von achtundvierzig Monaten soll diese dreißig nicht
 * wegwerfen. Der Import ist duplikatsicher, der Rest kommt beim nächsten Lauf.
 */
export async function importChessCom(
  user: string,
  months?: number,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal
): Promise<GameRecord[]> {
  // Kein Konto hinterlegt: nichts holen, statt fremde Partien zu laden.
  if (!user.trim()) return [];
  const res = await fetch(
    `https://api.chess.com/pub/player/${user.toLowerCase()}/games/archives`,
    { signal }
  );
  if (!res.ok) throw new Error(`chess.com: ${res.status}`);
  const all: string[] = (await res.json()).archives ?? [];
  const selected = months != null ? all.slice(-months) : all;

  const games: GameRecord[] = [];
  for (const [i, url] of selected.entries()) {
    if (signal?.aborted) break;
    onProgress?.(i + 1, selected.length);
    const monthRes = await fetch(url, { signal });
    if (!monthRes.ok) continue;
    const monthGames: CcGame[] = (await monthRes.json()).games ?? [];

    for (const g of monthGames) {
      // Varianten führen auf chess.com eine eigene Wertung, stehen aber unter
      // demselben Modus · im Ratingverlauf sprang die Daily-Linie dadurch
      // zwischen Daily und Daily-960 hin und her. Ihre Züge liest chess.js
      // ohnehin nicht, analysieren ließen sie sich also auch nicht.
      if (g.rules && g.rules !== "chess") continue;
      const iAmWhite = g.white.username.toLowerCase() === user.toLowerCase();
      const me = iAmWhite ? g.white : g.black;
      const opp = iAmWhite ? g.black : g.white;
      const pgn = g.pgn ?? "";
      const sans = sansFromPgn(pgn);
      const timeControl = pgnHeader(pgn, "TimeControl");
      const clocks = clocksFromPgn(pgn, parseTimeControl(timeControl));
      const date = pgnHeader(pgn, "Date").split(".").join("-") ||
        new Date(g.end_time * 1000).toISOString().slice(0, 10);

      games.push({
        id: null,
        source: "chess.com",
        source_id: g.url.split("/").pop() ?? g.url,
        url: g.url,
        played_at: date,
        played_ts: g.end_time,
        time_class: TIME_CLASS[g.time_class] ?? g.time_class,
        color: iAmWhite ? "white" : "black",
        my_name: me.username,
        opponent: opp.username,
        opp_elo: opp.rating,
        my_elo: me.rating,
        result: ccResult(me, opp),
        termination: terminationFromChessCom(me.result, opp.result),
        opening: openingFromSlug(pgnHeader(pgn, "ECOUrl")) || pgnHeader(pgn, "ECO"),
        eco: pgnHeader(pgn, "ECO"),
        moves_count: Math.ceil(sans.length / 2),
        accuracy: (iAmWhite ? g.accuracies?.white : g.accuracies?.black) ?? null,
        opponent_accuracy: (iAmWhite ? g.accuracies?.black : g.accuracies?.white) ?? null,
        moves: sans.join(" "),
        clocks: serializeClocks(clocks.slice(0, sans.length)),
        time_control: timeControl,
        note: "",
        analyzed: false,
      });
    }
  }
  return games;
}

interface LiGame {
  id: string;
  speed: string;
  /** "standard", "chess960", "crazyhouse", "fromPosition", … */
  variant?: string;
  winner?: "white" | "black";
  /** "mate", "resign", "outoftime", "stalemate", "draw", … */
  status?: string;
  createdAt: number;
  moves?: string;
  /** Restzeit nach jedem Halbzug in Hundertstelsekunden (clocks=true). */
  clocks?: number[];
  /** Bedenkzeit-Vorgabe; fehlt bei Correspondence-Partien. */
  clock?: { initial: number; increment: number };
  opening?: { eco: string; name: string };
  players: {
    white: { user?: { name: string }; rating?: number };
    black: { user?: { name: string }; rating?: number };
  };
}

/**
 * Import von Lichess als NDJSON; ohne `max` die komplette Historie.
 *
 * Anders als bei chess.com ist das eine einzige Antwort · ein Abbruch mitten
 * im Strom lässt nichts Brauchbares übrig, deshalb wirft er hier.
 */
export async function importLichess(
  user: string,
  max?: number,
  signal?: AbortSignal
): Promise<GameRecord[]> {
  if (!user.trim()) return [];
  const maxParam = max != null ? `max=${max}&` : "";
  // clocks=true liefert die Restzeiten je Halbzug · ohne den Parameter
  // schickt Lichess die Partie ohne Uhren, und das Analyse-Brett hätte keine.
  const res = await fetch(
    `https://lichess.org/api/games/user/${user}?${maxParam}opening=true&clocks=true`,
    { headers: { Accept: "application/x-ndjson" }, signal }
  );
  if (!res.ok) throw new Error(`lichess: ${res.status}`);
  const text = await res.text();

  const games: GameRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const g: LiGame = JSON.parse(line);
    // Wie bei chess.com: Varianten haben eine eigene Wertung und eine eigene
    // Startstellung · beides passt nicht in Verlauf und Analyse.
    if (g.variant && g.variant !== "standard") continue;
    const whiteName = g.players.white.user?.name ?? "?";
    const iAmWhite = whiteName.toLowerCase() === user.toLowerCase();
    const me = iAmWhite ? g.players.white : g.players.black;
    const opp = iAmWhite ? g.players.black : g.players.white;
    const myColor = iAmWhite ? "white" : "black";
    const plies = g.moves ? g.moves.split(" ").length : 0;

    games.push({
      id: null,
      source: "lichess",
      source_id: g.id,
      url: `https://lichess.org/${g.id}`,
      played_at: new Date(g.createdAt).toISOString().slice(0, 10),
      played_ts: Math.floor(g.createdAt / 1000),
      time_class: TIME_CLASS[g.speed] ?? g.speed,
      color: myColor,
      my_name: me.user?.name ?? user,
      opponent: opp.user?.name ?? "Anonym",
      opp_elo: opp.rating ?? 0,
      my_elo: me.rating ?? 0,
      result: g.winner == null ? "draw" : g.winner === myColor ? "win" : "loss",
      termination: terminationFromLichess(g.status ?? ""),
      opening: g.opening?.name ?? "",
      eco: g.opening?.eco ?? "",
      moves_count: Math.ceil(plies / 2),
      accuracy: null,
      moves: g.moves ?? "",
      clocks: serializeClocks((g.clocks ?? []).slice(0, plies)),
      time_control: g.clock ? `${g.clock.initial}+${g.clock.increment}` : "",
      note: "",
      analyzed: false,
    });
  }
  return games;
}

export interface ImportSummary {
  fetched: { cc: number; li: number };
  errors: string[];
  /** Auf Wunsch abgebrochen · was bis dahin geholt wurde, ist trotzdem dabei. */
  aborted: boolean;
}

/** Ein Abbruch ist kein Fehler · er soll nicht in der Fehlerliste landen. */
function isAbort(reason: unknown): boolean {
  return (reason as { name?: string } | null)?.name === "AbortError";
}

/**
 * Holt Partien von beiden Plattformen; Fehler einer Quelle blockieren die
 * andere nicht. `full` lädt die komplette Historie statt der letzten Monate.
 *
 * `signal` bricht beide Quellen ab. Der Abbruch steht in der Zusammenfassung,
 * nicht in den Fehlern, und die bereits geholten Partien kommen mit zurück.
 */
export async function fetchAll(
  ccUser: string,
  liUser: string,
  opts: {
    full?: boolean;
    months?: number;
    onProgress?: (current: number, total: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<{ games: GameRecord[]; summary: ImportSummary }> {
  const months = opts.full ? undefined : (opts.months ?? 3);
  const liMax = opts.full ? undefined : 200;
  const [cc, li] = await Promise.allSettled([
    importChessCom(ccUser, months, opts.onProgress, opts.signal),
    importLichess(liUser, liMax, opts.signal),
  ]);
  const games: GameRecord[] = [];
  const summary: ImportSummary = {
    fetched: { cc: 0, li: 0 },
    errors: [],
    aborted: opts.signal?.aborted ?? false,
  };

  if (cc.status === "fulfilled") {
    games.push(...cc.value);
    summary.fetched.cc = cc.value.length;
  } else if (!isAbort(cc.reason)) {
    summary.errors.push(`chess.com: ${cc.reason}`);
  }
  if (li.status === "fulfilled") {
    games.push(...li.value);
    summary.fetched.li = li.value.length;
  } else if (!isAbort(li.reason)) {
    summary.errors.push(`Lichess: ${li.reason}`);
  }
  return { games, summary };
}
