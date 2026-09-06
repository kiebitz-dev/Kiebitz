import type { Game, Result, Source } from "../data/demo";
import { translator, type Key, type Locale } from "./i18n";
import type { GameSummary } from "./db";

export const resultColor: Record<Result, string> = {
  win: "var(--color-win)",
  loss: "var(--color-loss)",
  draw: "var(--color-draw)",
};

/** UI-Form einer Partie: Demo-Partien und DB-Partien teilen diese Struktur. */
export interface UiGame extends Omit<Game, "tc"> {
  tc: string;
  timeClass?: string;
  dateKey?: string;
  dbId?: number;
  url?: string;
  analysisExcluded?: boolean;
}

/**
 * Vorfilter für die Partien-Liste (z. B. von einem Klick im Dashboard).
 * Alle Felder matchen exakt gegen die jeweiligen `UiGame`-Felder · `date` und
 * `tc` sind bereits lokalisierte Anzeige-Strings, die zwischen Dashboard und
 * Games übereinstimmen, solange dieselbe Locale gilt.
 */
export interface GamesFilter {
  source?: Source;
  result?: Result;
  tc?: string;
  date?: string;
  opponent?: string;
  opening?: string;
  /** Gespielte Farbe · „Partien als Weiß". */
  color?: "white" | "black";
  /** ECO-Kennung der Eröffnung · gröber als `opening`, absichtlich. */
  eco?: string;
}

/**
 * Bedenkzeit-Klassen kommen aus demselben Wörterbuch wie der Rest der
 * Oberfläche · eine zweite, je Sprache gepflegte Tabelle hier wäre genau die
 * Stelle, an der eine neue Sprache vergessen wird.
 */
const TC_KEY: Record<string, Key> = {
  bullet: "common.tc.bullet",
  blitz: "common.tc.blitz",
  rapid: "common.tc.rapid",
  daily: "common.tc.daily",
  classical: "common.tc.classical",
  otb: "common.tc.otb",
};

export function tcLabel(timeClass: string, locale: Locale): string {
  const key = TC_KEY[timeClass];
  return key ? translator(locale)(key) : timeClass;
}

/**
 * Anzeige-Datum einer Partie. Bevorzugt `played_ts` (Unix, überall die
 * kanonische Sortier-Zeit · bei chess.com das Partie-ENDE), damit Anzeige und
 * Reihenfolge übereinstimmen. Bei chess.com-Fernpartien weicht `played_at`
 * (Start-Datum aus dem PGN) sonst von der Sortierung ab. Fallback auf
 * `played_at` für Alt-Datensätze ohne Zeitstempel.
 */
function gameDateKey(r: GameSummary): string {
  if (r.played_ts > 0) {
    const dt = new Date(r.played_ts * 1000);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return r.played_at;
}

function gameDate(r: GameSummary, locale: Locale): string {
  const canonical = gameDateKey(r);
  if (locale !== "de") return canonical;
  const [y, m, d] = canonical.split("-");
  return d && m && y ? `${d}.${m}.${y}` : canonical;
}

/**
 * Wann eine Partie gespielt wurde, in Unix-Sekunden · null, wenn sich das
 * nicht sagen lässt.
 *
 * Aus der Datenbank kommt `dateKey` in ISO-Form; die Demo-Partien der
 * Web-Vorschau tragen nur das gesetzte Datum („11.07.2026"). Beides muss der
 * Zeitraum-Filter lesen können, sonst filterte er in der Vorschau nichts.
 * Gerechnet wird in der Zeitzone des Geräts, wie in `zeitraumStart`.
 */
export function gamePlayedTs(game: UiGame): number | null {
  const iso = game.dateKey ?? "";
  const teile = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) ?? null;
  if (teile) {
    return new Date(Number(teile[1]), Number(teile[2]) - 1, Number(teile[3])).getTime() / 1000;
  }
  const deutsch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(game.date);
  if (deutsch) {
    return (
      new Date(Number(deutsch[3]), Number(deutsch[2]) - 1, Number(deutsch[1])).getTime() / 1000
    );
  }
  const roh = Date.parse(game.date);
  return Number.isNaN(roh) ? null : Math.floor(roh / 1000);
}

export function toUi(r: GameSummary, locale: Locale = "en"): UiGame {
  const date = gameDate(r, locale);
  return {
    id: `db-${r.id}`,
    dbId: r.id ?? undefined,
    url: r.url,
    date,
    dateKey: gameDateKey(r),
    source: r.source,
    tc: tcLabel(r.time_class, locale),
    timeClass: r.time_class,
    color: r.color,
    opponent: r.opponent,
    oppElo: r.opp_elo,
    myElo: r.my_elo,
    result: r.result,
    opening: r.opening || "—",
    eco: r.eco,
    moves: r.moves_count,
    accuracy: r.accuracy,
    accuracyOpening: r.accuracy_opening,
    accuracyMiddlegame: r.accuracy_middlegame,
    accuracyEndgame: r.accuracy_endgame,
    analyzed: r.analyzed,
    analysisExcluded: r.analysis_excluded,
    tags: r.tags ?? [],
    note: r.note || (r.has_note ? " " : undefined),
    sans: r.moves ? r.moves.split(" ") : undefined,
  };
}
