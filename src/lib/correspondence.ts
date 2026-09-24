/**
 * Fernschach · die laufenden Daily-Partien auf chess.com und lichess.
 *
 * Der Import holt nur beendete Partien. Wer Fernschach spielt, hat aber
 * immer ein paar Partien offen, und die Frage ist dann eine andere: Wo bin
 * ich am Zug, und wie lange noch? Die Plattformen beantworten sie jede für
 * sich; diese Datei stellt beide Antworten nebeneinander.
 *
 * chess.com gibt die laufenden Daily-Partien ohne Anmeldung heraus. Lichess
 * nur mit dem persönlichen Token, den die App für den Eröffnungs-Explorer
 * ohnehin kennt (lib/lichess.ts) · ohne ihn bleibt die Lichess-Hälfte leer,
 * statt einen Fehler zu zeigen.
 *
 * Geladen wird aus dem Frontend wie beim Import (lib/importer.ts). Gespeichert
 * wird nichts: Eine laufende Partie ist in einer Stunde eine andere.
 *
 * Eine laufende Partie geht bewusst nicht an die Analyse · die Engine auf eine
 * Stellung loszulassen, in der man noch selbst ziehen muss, wäre Schummeln.
 * Gezeigt wird deshalb nur die Stellung jetzt, und der Weg führt zur Partie
 * auf der Plattform.
 */
import { lichessToken } from "./lichess";
import type { Key } from "./i18n";

export interface OngoingGame {
  source: "chess.com" | "lichess";
  /** Eindeutig je Quelle · für React und zum Wiederfinden. */
  id: string;
  url: string;
  opponent: string;
  opponentRating: number | null;
  myColor: "white" | "black";
  myTurn: boolean;
  /** Stellung jetzt. */
  fen: string;
  /** Zugnummer der Stellung jetzt · aus der FEN. */
  moveNumber: number;
  /** Unix-Sekunden, bis wann die Seite am Zug ziehen muss · null, wenn unbekannt. */
  deadline: number | null;
  variant: "standard" | "chess960";
}

/** Das sechste Feld der FEN · ohne es die erste Zugnummer. */
export function moveNumberOf(fen: string): number {
  const value = Number(fen.trim().split(/\s+/)[5]);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** Letzter Pfadteil einer Profil-URL · chess.com nennt Spieler so. */
function userFromUrl(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? "?";
}

interface CcOngoing {
  url: string;
  fen: string;
  turn: "white" | "black";
  move_by?: number;
  rules?: string;
  white: string;
  black: string;
}

async function chessComOngoing(user: string, signal?: AbortSignal): Promise<OngoingGame[]> {
  if (!user.trim()) return [];
  const res = await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}/games`, { signal });
  if (!res.ok) throw new Error(`chess.com: ${res.status}`);
  const games: CcOngoing[] = (await res.json()).games ?? [];
  const me = user.toLowerCase();
  const out: OngoingGame[] = [];
  for (const game of games) {
    const chess960 = game.rules === "chess960";
    // Wie beim Import · andere Varianten spielt Kiebitz nicht.
    if (game.rules && game.rules !== "chess" && !chess960) continue;
    const white = userFromUrl(game.white);
    const black = userFromUrl(game.black);
    const myColor = white.toLowerCase() === me ? "white" : "black";
    out.push({
      source: "chess.com",
      id: game.url.split("/").pop() ?? game.url,
      url: game.url,
      opponent: myColor === "white" ? black : white,
      opponentRating: null,
      myColor,
      myTurn: game.turn === myColor,
      fen: game.fen,
      moveNumber: moveNumberOf(game.fen),
      deadline: game.move_by && game.move_by > 0 ? game.move_by : null,
      variant: chess960 ? "chess960" : "standard",
    });
  }
  return out;
}

interface LiOngoing {
  gameId: string;
  fullId?: string;
  color: "white" | "black";
  fen: string;
  isMyTurn: boolean;
  secondsLeft?: number | null;
  speed?: string;
  variant?: { key?: string };
  opponent?: { username?: string; rating?: number };
}

async function lichessOngoing(signal?: AbortSignal): Promise<OngoingGame[]> {
  const token = await lichessToken();
  if (!token) return [];
  const res = await fetch("https://lichess.org/api/account/playing?nb=50", {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  // Ein Token ohne Berechtigung für das Konto ist kein Fehler dieser Seite ·
  // dann gibt es eben keine Lichess-Partien zu zeigen.
  if (res.status === 401 || res.status === 403) return [];
  if (!res.ok) throw new Error(`lichess: ${res.status}`);
  const games: LiOngoing[] = (await res.json()).nowPlaying ?? [];
  const now = Math.floor(Date.now() / 1000);
  return games
    .filter((game) => game.speed === "correspondence")
    .filter((game) => !game.variant?.key || game.variant.key === "standard" || game.variant.key === "chess960")
    .map((game) => ({
      source: "lichess" as const,
      id: game.gameId,
      url: `https://lichess.org/${game.fullId ?? game.gameId}`,
      opponent: game.opponent?.username ?? "?",
      opponentRating: game.opponent?.rating ?? null,
      myColor: game.color,
      myTurn: game.isMyTurn,
      fen: game.fen,
      moveNumber: moveNumberOf(game.fen),
      deadline: game.secondsLeft != null && game.secondsLeft > 0 ? now + game.secondsLeft : null,
      variant: game.variant?.key === "chess960" ? ("chess960" as const) : ("standard" as const),
    }));
}

/**
 * Beide Quellen · eine, die scheitert, nimmt die andere nicht mit. Wer am Zug
 * ist, steht oben, darunter nach der Frist, die am nächsten liegt.
 */
export async function loadOngoing(
  opts: { ccUser: string; liUser: string },
  signal?: AbortSignal
): Promise<{ games: OngoingGame[]; errors: string[] }> {
  const results = await Promise.allSettled([
    chessComOngoing(opts.ccUser, signal),
    opts.liUser.trim() ? lichessOngoing(signal) : Promise.resolve([]),
  ]);
  const games: OngoingGame[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") games.push(...result.value);
    else errors.push(String(result.reason));
  }
  games.sort(
    (a, b) =>
      Number(b.myTurn) - Number(a.myTurn)
      || (a.deadline ?? Number.MAX_SAFE_INTEGER) - (b.deadline ?? Number.MAX_SAFE_INTEGER)
  );
  return { games, errors };
}

/**
 * Die Frist als Text · dringend, sobald man selbst ziehen muss und kein ganzer
 * Tag mehr bleibt. Beide Fassungen der Karte setzen sie gleich.
 */
export function deadlineOf(
  game: OngoingGame,
  t: (key: Key, vars?: Record<string, string | number>) => string
): { text: string; urgent: boolean } | null {
  const left = timeLeft(game.deadline);
  return left
    ? { text: t(`corr.left.${left.unit}`, { n: left.value }), urgent: game.myTurn && left.unit !== "d" }
    : null;
}

/** Restzeit als kurze Angabe · „2 T", „5 Std", „40 Min" · null ohne Frist. */
export function timeLeft(deadline: number | null, now = Date.now() / 1000): { value: number; unit: "d" | "h" | "m" } | null {
  if (deadline == null) return null;
  const seconds = Math.max(0, deadline - now);
  if (seconds >= 86_400) return { value: Math.floor(seconds / 86_400), unit: "d" };
  if (seconds >= 3_600) return { value: Math.floor(seconds / 3_600), unit: "h" };
  return { value: Math.max(1, Math.floor(seconds / 60)), unit: "m" };
}
