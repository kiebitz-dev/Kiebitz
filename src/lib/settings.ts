import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { emitDataChange } from "./changes";
import { lichessToken } from "./lichess";
// Nur der Typ · zur Laufzeit importiert i18n dieses Modul, nicht umgekehrt.
import type { Locale } from "./i18n";
// Ebenso: theme.ts liest die Einstellungen, nicht umgekehrt.
import type { AutoMode, BoardSetId, PieceSetId, ThemeId } from "./theme";

/** Spiegelt settings::Settings aus dem Rust-Backend. */
export interface Settings {
  locale: Locale;
  db_path: string | null;
  engine_path: string | null;
  engine_threads: number; // 0 = automatisch
  engine_hash_mb: number;
  engine_multipv: number;
  live_depth: number;
  batch_depth: number;
  syzygy_path: string | null;
  chessdb_enabled: boolean;
  /** Eröffnungs-Explorer von Lichess (Meister- und Online-Häufigkeiten). */
  explorer_enabled: boolean;
  /** Rating-Bänder der Lichess-Datenbank ("1600,1800"), leer = alle. */
  explorer_ratings: string;
  /** Zeitkontrollen der Lichess-Datenbank ("blitz,rapid"), leer = alle. */
  explorer_speeds: string;
  /** Neue Partien beim Start und im Hintergrund nachladen. */
  auto_import: boolean;
  cc_user: string;
  li_user: string;
  /** Anzeigename fürs Dashboard (leer = Benutzername). */
  display_name: string;
  /** Farbwelt der Oberfläche · siehe lib/theme.ts. */
  theme: ThemeId;
  /** Feldfarben des Bretts ("auto" = das Brett des Themas). */
  board_set: BoardSetId;
  /** Zeichnungen der Figuren ("classic" = der Satz des Bretts). */
  piece_set: PieceSetId;
  /** Wann `theme_night` übernimmt ("off" | "system" | "time"). */
  theme_auto: AutoMode;
  /** Thema der Dunkelphase des automatischen Wechsels. */
  theme_night: ThemeId;
  /** Nachtfenster als lokale "HH:MM" (nur bei theme_auto = "time"). */
  theme_night_from: string;
  theme_night_to: string;
  /** Diagramm-Modus („Das Blatt") · Layoutmodus, siehe lib/theme.ts. */
  diagram_mode: boolean;
  /**
   * Anmerkungen der Auto-Analyse nur zu den eigenen Zügen zeigen.
   *
   * Gerechnet wird weiter über die ganze Partie · zurückgehalten wird allein
   * die Anzeige. Siehe `zeigtUrteil` in pages/Analysis.tsx.
   */
  annotate_own_only: boolean;
  import_months: number;
  puzzle_goal: number;
  /** Motiv der laufenden Aufgabe im Puzzle-Training verdecken. */
  puzzle_hide_theme: boolean;
  /** Fällige Repertoire-Züge je Trainingssitzung (0 = alle). */
  rep_due_limit: number;
  /** Neue Repertoire-Züge je Trainingssitzung (0 = alle). */
  rep_new_limit: number;
  /** Zug- und Schlagklänge auf allen Brettern. */
  sound_enabled: boolean;
  /** Lautstärke der Brettklänge in Prozent (0 … 100). */
  sound_volume: number;
  auto_update: boolean;
  /** Sync-Server (Desktop-Hub) beim Start mitstarten. */
  sync_enabled: boolean;
  /** Pairing-Code · Desktop: generiert/angezeigt; Mobile: vom Desktop übernommen. */
  sync_code: string;
  /** Mobile: Adresse des Desktop-Hubs ("host:port"). */
  sync_host: string;
  /** SHA-256-Fingerprint des per QR gekoppelten HTTPS-Hubs. */
  sync_fingerprint: string;
  /** Mobile: automatisch im Hintergrund synchronisieren (Änderungen/Timer/Fokus). */
  sync_auto: boolean;
  /** Tägliche Erinnerung an anstehendes Training. */
  notify_enabled: boolean;
  /** Uhrzeit der Erinnerung als lokale "HH:MM". */
  notify_time: string;
  notify_study: boolean;
  notify_repertoire: boolean;
  notify_puzzles: boolean;
  notify_endgame: boolean;
  notify_analysis: boolean;
  /** Der Wochenbericht am Montagabend statt der Erinnerung dieses Tages. */
  notify_weekly: boolean;
  /** Trainingsbudget in Minuten pro Woche (0 = aus der Aktivität ableiten). */
  weekly_minutes: number;
  /** Trainingstage als Bitmaske, Bit 0 = Montag (0 = keine Vorgabe). */
  training_days: number;
  /** Optionales Zieldatum "YYYY-MM-DD" (leer = keins). */
  goal_date: string;
  /** Wurde die Ersteinrichtung durchlaufen? */
  onboarded: boolean;
  /** Pseudonyme Nutzungsstatistik (ab Werk an, hier abschaltbar). */
  analytics_enabled: boolean;
  /**
   * Kennung dieser Installation für die Statistik (leer = keine).
   *
   * Das Backend löscht sie, sobald die Statistik abgeschaltet wird · ein
   * gesetzter Wert bedeutet also immer, dass sie an ist.
   */
  analytics_installation_id: string;
}

/** Wochentage aus der Bitmaske · Index 0 = Montag. */
export function trainingDayList(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, index) => (mask & (1 << index)) !== 0);
}

export function trainingDayMask(days: boolean[]): number {
  return days.reduce((mask, active, index) => (active ? mask | (1 << index) : mask), 0);
}

export interface EngineTest {
  ok: boolean;
  name: string;
  path: string;
}

export interface DbInfo {
  path: string;
  size_bytes: number;
  games: number;
  puzzles: number;
  is_default: boolean;
}

export interface ChessDbMove {
  uci: string;
  san: string;
  score: number | null; // Centipawns aus Sicht des Spielers am Zug
  rank: number | null;
  winrate: string | null;
}

export interface ChessDbResult {
  status: string; // "ok" | "unknown" | …
  moves: ChessDbMove[];
  cached: boolean;
}

/**
 * Ein Zug im Eröffnungsbuch, wie ihn alle Häufigkeits-Quellen liefern ·
 * Lichess-Meister, Lichess-Online und die eigene Referenzdatenbank. Eine Form
 * für drei Quellen, damit die Karte in der Analyse nur eine Zeile kennt.
 */
export interface BookMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  average_rating: number | null;
}

export interface BookGame {
  /** Lichess-ID oder, bei der eigenen Datenbank, die Zeilennummer. */
  id: string;
  white: string;
  black: string;
  white_elo: number | null;
  black_elo: number | null;
  /** "white" · "black" · "" für Remis. */
  winner: string;
  year: number | null;
  month: string | null;
}

export interface BookResult {
  source: BookSource;
  status: string; // "ok" | "unknown" | "invalid"
  white: number;
  draws: number;
  black: number;
  moves: BookMove[];
  top_games: BookGame[];
  opening: string | null;
  cached: boolean;
}

/** Die Häufigkeits-Quellen · `engine` (ChessDB) steht daneben, nicht darin. */
export type BookSource = "masters" | "lichess" | "own";

export interface RefDbStatus {
  games: number;
  positions: number;
  size_bytes: number;
  source: string;
  imported_at: number;
  importing: boolean;
  path: string;
  /** Die einzeln eingelesenen Sammlungen, neueste zuerst. */
  sources: RefSource[];
}

/** Eine eingelesene Sammlung · spiegelt refdb::RefSource. */
export interface RefSource {
  id: number;
  /** Dateiname beim Import · unterscheidet zwei Sammlungen voneinander. */
  name: string;
  path: string;
  games: number;
  imported_at: number;
}

export interface RefGame {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  played_at: string;
  event: string;
  eco: string;
  moves: string;
}

let settingsCache: Settings | null = null;
let settingsRequest: Promise<Settings> | null = null;
let settingsGeneration = 0;

function invalidateSettingsCache() {
  settingsGeneration += 1;
  settingsCache = null;
  settingsRequest = null;
}

function loadSettings(): Promise<Settings> {
  if (settingsCache) return Promise.resolve(settingsCache);
  if (settingsRequest) return settingsRequest;
  const generation = settingsGeneration;
  const request = invoke<Settings>("get_settings")
    .then((settings) => {
      if (generation === settingsGeneration) settingsCache = settings;
      return settings;
    });
  const trackedRequest = request.finally(() => {
    if (settingsRequest === trackedRequest) settingsRequest = null;
  });
  settingsRequest = trackedRequest;
  return settingsRequest;
}

export function getSettings(): Promise<Settings> {
  return loadSettings();
}

/** Erzwingt ein Nachladen, wenn das Backend Einstellungen indirekt geändert hat. */
export function refreshSettings(): Promise<Settings> {
  invalidateSettingsCache();
  return loadSettings();
}

export function setSettings(newSettings: Settings): Promise<Settings> {
  invalidateSettingsCache();
  const generation = settingsGeneration;
  const request = invoke<Settings>("set_settings", { newSettings }).then((settings) => {
    if (generation === settingsGeneration) settingsCache = settings;
    return settings;
  });
  const trackedRequest = request.finally(() => {
    if (settingsRequest === trackedRequest) settingsRequest = null;
  });
  settingsRequest = trackedRequest;
  return trackedRequest;
}

export function testEngine(path?: string): Promise<EngineTest> {
  return invoke<EngineTest>("test_engine", { path: path ?? null });
}

export function dbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>("db_info");
}

export function moveDatabase(target: string): Promise<DbInfo> {
  return invoke<DbInfo>("move_database", { target }).then((info) => {
    invalidateSettingsCache();
    emitDataChange("database");
    return info;
  });
}

export function useDatabase(path: string): Promise<DbInfo> {
  return invoke<DbInfo>("use_database", { path }).then((info) => {
    invalidateSettingsCache();
    emitDataChange("database");
    return info;
  });
}

export function backupDatabase(target: string): Promise<string> {
  return invoke<string>("backup_database", { target });
}

export function restoreDatabase(source: string): Promise<DbInfo> {
  return invoke<DbInfo>("restore_database", { source }).then((info) => {
    emitDataChange("database");
    return info;
  });
}

export function chessdbQuery(fen: string): Promise<ChessDbResult> {
  return invoke<ChessDbResult>("chessdb_query", { fen });
}

/**
 * Lichess-Explorer · `ratings` und `speeds` gelten nur für "lichess".
 *
 * Der Token kommt aus dem Schlüsselspeicher und reist mit jeder Abfrage mit ·
 * ohne ihn antwortet Lichess seit Anfang 2026 mit 401, siehe lib/lichess.ts.
 */
export function explorerQuery(
  fen: string,
  source: "masters" | "lichess",
  ratings?: string,
  speeds?: string
): Promise<BookResult> {
  return lichessToken().then((token) =>
    invoke<BookResult>("explorer_query", { fen, source, ratings, speeds, token })
  );
}

/** Eigene Referenzdatenbank · Buchauskunft zu einer Stellung. */
export function refdbQuery(fen: string): Promise<BookResult> {
  return invoke<BookResult>("refdb_query", { fen });
}

export function refdbStatus(): Promise<RefDbStatus> {
  return invoke<RefDbStatus>("refdb_status");
}

/** Startet den Import; der Fortschritt kommt als Ereignis `refdb://progress`. */
export function refdbImport(path: string): Promise<void> {
  return invoke("refdb_import", { path });
}

export function refdbCancelImport(): Promise<void> {
  return invoke("refdb_cancel_import");
}

/**
 * Steht diese Datei schon in der Referenzdatenbank?
 *
 * Gefragt wird vor dem Import und nicht danach: Ein zweiter Lauf über dieselbe
 * Sammlung dauert Stunden und bringt nichts, weil jede Partie als Doppelung
 * wieder herausfiele.
 */
export function refdbPrecheck(path: string): Promise<RefSource | null> {
  return invoke<RefSource | null>("refdb_precheck", { path });
}

/**
 * Löst eine einzelne Sammlung wieder heraus · läuft im Hintergrund und meldet
 * sich über dieselben Ereignisse wie der Import.
 */
export function refdbDeleteSource(id: number): Promise<void> {
  return invoke("refdb_delete_source", { id });
}

export function refdbClear(): Promise<void> {
  return invoke("refdb_clear");
}

/** Eine Referenzpartie zum Nachspielen. */
export function refdbGame(id: number): Promise<RefGame> {
  return invoke<RefGame>("refdb_game", { id });
}

/** Fortschritt des Referenz-Imports (spiegelt refdb::ImportProgress). */
export interface RefDbProgress {
  games: number;
  bytes: number;
  bytes_total: number;
  /** Partien insgesamt, wo die Arbeit in Partien zählt statt in Bytes. */
  games_total: number;
  /** "scanning" · "reading" · "finishing" · "removing" */
  phase: string;
}

export interface RefDbDone {
  games: number;
  total: number;
  /**
   * Partien der Quelle, die nicht übernommen wurden. Bei `.db3` sind das die,
   * deren Zugfolge sich nicht zweifelsfrei nachspielen ließ oder die aus einer
   * Sonderstellung begannen · siehe src-tauri/src/db3.rs.
   */
  skipped: number;
  /** Partien, die schon in der Referenzdatenbank standen · übersprungen. */
  duplicates: number;
  /** "import" · "delete" — dieselbe Meldung, zwei Anlässe. */
  action: string;
  cancelled: boolean;
  error: string | null;
}

export function onRefDbProgress(cb: (p: RefDbProgress) => void): Promise<UnlistenFn> {
  return listen<RefDbProgress>("refdb://progress", (e) => cb(e.payload));
}

export function onRefDbDone(cb: (p: RefDbDone) => void): Promise<UnlistenFn> {
  return listen<RefDbDone>("refdb://done", (e) => cb(e.payload));
}

/** Leert die Datenbank und setzt alle Einstellungen zurück. */
export function factoryReset(): Promise<void> {
  return invoke("factory_reset").then(() => {
    invalidateSettingsCache();
    emitDataChange("database");
  });
}

/** Bytes menschenlesbar (1 Dezimalstelle ab MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
