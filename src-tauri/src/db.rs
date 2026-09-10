//! SQLite-Persistenz: die lokale Partien-Datenbank.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

/// Current SQLite schema version. It is stored only after the complete
/// migration has committed successfully.
const SCHEMA_VERSION: i64 = 21;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GameRecord {
    pub id: Option<i64>,
    pub source: String,
    pub source_id: String,
    pub url: String,
    pub played_at: String,
    /// Unix-Sekunden des Partie-Endes (für Heatmaps nach Uhrzeit).
    #[serde(default)]
    pub played_ts: i64,
    pub time_class: String,
    pub color: String,
    #[serde(default)]
    pub my_name: String,
    pub opponent: String,
    pub opp_elo: i64,
    pub my_elo: i64,
    pub result: String,
    pub opening: String,
    pub eco: String,
    pub moves_count: i64,
    pub accuracy: Option<f64>,
    #[serde(default)]
    pub accuracy_opening: Option<f64>,
    #[serde(default)]
    pub accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub accuracy_endgame: Option<f64>,
    /// Gesamtgenauigkeit des Gegners aus Import oder eigener Auto-Analyse.
    #[serde(default)]
    pub opponent_accuracy: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_opening: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_endgame: Option<f64>,
    pub moves: String,
    /// Restzeit nach jedem Halbzug in Hundertstelsekunden, leerzeichengetrennt ·
    /// aus den %clk-Kommentaren der PGN bzw. der lichess-Uhrenliste. Leer, wenn
    /// die Partie keine Zeitdaten mitgebracht hat.
    #[serde(default)]
    pub clocks: String,
    /// PGN-TimeControl der Partie ("600+5"), leer wenn unbekannt.
    #[serde(default)]
    pub time_control: String,
    /// Wie die Partie endete: mate, resign, timeout, stalemate, agreement,
    /// repetition, fifty, insufficient, abandoned, rules · leer, wenn die Quelle
    /// nichts hergibt und die Schlussstellung selbst nichts verrät.
    #[serde(default)]
    pub termination: String,
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub analyzed: bool,
    /// Partie bleibt in der Bibliothek, wird aber von Engine, Statistiken und
    /// daraus abgeleiteten Trainingsinhalten ausgeschlossen.
    #[serde(default)]
    pub analysis_excluded: bool,
    /// Das Fazit der Auto-Analyse als JSON-Liste von `{key, params}`.
    ///
    /// Leer, solange die Partie nicht analysiert wurde oder die Analyse aus
    /// einer Fassung vor dem Fazit stammt. Ein Import setzt es nie — es
    /// entsteht ausschließlich in `analysis::run_worker`.
    #[serde(default)]
    pub verdict: String,
}

#[derive(Serialize)]
pub struct UpsertResult {
    pub inserted: usize,
    pub total: i64,
}

/// Standardeinheiten des Studienkalenders · genau eine je Trainingsbereich.
///
/// Die Texte sind der Rückfall, nicht die Anzeige: solange eine Standardeinheit
/// unbearbeitet ist, zeigt die Oberfläche sie über `i18n_key` in der
/// eingestellten Sprache. Ab der ersten Bearbeitung gehört der Text dem Nutzer,
/// und `i18n_key` fällt weg.
///
/// `builtin` überlebt das Bearbeiten: daran hängt, dass es zu jedem der fünf
/// Bereiche dauerhaft eine Einheit gibt, die der Wochenvorschlag einplanen kann.
/// Früher fiel ein Bereich ohne passende Vorlage stillschweigend aus der
/// Planung — Analyse hatte nie eine und wurde deshalb nie geplant.
struct SeedTemplate {
    title: &'static str,
    duration_min: i64,
    tool: &'static str,
    description: &'static str,
    /// Trainingsbereich · derselbe Schlüssel wie in `study.rs`.
    area: &'static str,
    /// Basis der Übersetzungsschlüssel (`<base>.title`, `.tool`, `.desc`).
    i18n_key: &'static str,
}

const DEFAULT_STUDY_TEMPLATES: [SeedTemplate; 5] = [
    SeedTemplate {
        title: "Opening training",
        duration_min: 20,
        tool: "Kiebitz Repertoire",
        description: "Pick one opening for White and one for Black. Learn the first 8–10 moves and the ideas behind them.",
        area: "openings",
        i18n_key: "st.seed.openings",
    },
    SeedTemplate {
        title: "Endgame training",
        duration_min: 20,
        tool: "Kiebitz Endgames",
        description: "Fundamentals in order: queen vs. king, rook vs. king, pawn endings with opposition and the square rule.",
        area: "endgames",
        i18n_key: "st.seed.endgames",
    },
    SeedTemplate {
        title: "Tactics",
        duration_min: 20,
        tool: "Kiebitz Puzzles",
        description: "15–20 puzzles, slow and accurate. Focus: forks, pins, skewers and discovered attacks.",
        area: "tactics",
        i18n_key: "st.seed.tactics",
    },
    SeedTemplate {
        title: "Playing",
        duration_min: 40,
        tool: "Lichess / chess.com",
        description: "Play deliberately, not on the side: one long game beats five hasty ones.",
        area: "play",
        i18n_key: "st.seed.play",
    },
    SeedTemplate {
        title: "Game review",
        duration_min: 25,
        tool: "Kiebitz Analysis",
        description: "Review your own game first, then let the engine show you the three biggest mistakes.",
        area: "analysis",
        i18n_key: "st.seed.analysis",
    },
];

/// Deutsche Startvorlagen aus v0.5.x auf die englischen Texte heben · aber nur,
/// solange sie unverändert sind. Selbst bearbeitete Einheiten bleiben, wie sie
/// sind (Titelvergleich schützt sie).
fn translate_seeded_study_templates(conn: &Connection) -> Result<(), String> {
    if meta_get(conn, "study_templates_en").is_some() {
        return Ok(());
    }
    let legacy = [
        ("Eröffnungs-Training", 0usize),
        ("Endspiel-Training", 1),
        ("Taktik", 2),
        ("Partie + Analyse", 3),
    ];
    for (german_title, index) in legacy {
        let seed = &DEFAULT_STUDY_TEMPLATES[index];
        conn.execute(
            "UPDATE study_templates SET title = ?1, duration_min = ?2, tool = ?3, description = ?4
             WHERE title = ?5",
            params![
                seed.title,
                seed.duration_min,
                seed.tool,
                seed.description,
                german_title
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    meta_set(conn, "study_templates_en", "1")
}

/// Sorgt dafür, dass es zu jedem der fünf Bereiche genau eine Standardeinheit
/// gibt · auf jedem Gerät unter demselben `sync_key`, damit der Sync sie
/// vereinigt statt zu verdoppeln.
///
/// Die Einheit gehört dem Nutzer: Titel, Beschreibung und Bereiche darf er
/// ändern. Nur ihre Existenz ist nicht verhandelbar, denn der Wochenvorschlag
/// plant über sie. Solange sie unbearbeitet ist (`i18n_key` steht noch), wird
/// der hinterlegte englische Text mitgezogen — angezeigt wird ohnehin die
/// Übersetzung.
///
/// Läuft bei jedem Start, nicht nur bei einer Migration: eine Standardeinheit
/// kann auch über den Sync von einer älteren Gegenstelle verschwinden. Wo
/// nichts abweicht, wird auch nichts geschrieben — sonst reisten die fünf
/// Zeilen bei jedem Start erneut durch den Sync.
fn ensure_builtin_study_templates(conn: &Connection) -> Result<(), String> {
    let now = now_ts();
    for (index, seed) in DEFAULT_STUDY_TEMPLATES.iter().enumerate() {
        let sync_key = format!("seed-{}", index + 1);
        let existing: Option<(i64, String, String, String, i64)> = conn
            .query_row(
                "SELECT id, i18n_key, builtin, areas, deleted
                   FROM study_templates WHERE sync_key = ?1",
                params![sync_key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .ok();
        match existing {
            Some((id, i18n_key, builtin, areas, deleted)) => {
                // Bereich, Bereichsliste und Löschmarke gehören zur Existenz,
                // nicht zum Text · sie werden geradegezogen, falls nötig.
                if builtin != seed.area || deleted != 0 || areas.is_empty() {
                    conn.execute(
                        "UPDATE study_templates
                            SET builtin = ?1, area = ?1, deleted = 0,
                                areas = CASE WHEN areas = '' THEN ?1 ELSE areas END,
                                updated_ts = ?2
                          WHERE id = ?3",
                        params![seed.area, now, id],
                    )
                    .map_err(|e| e.to_string())?;
                }
                if i18n_key == seed.i18n_key {
                    conn.execute(
                        "UPDATE study_templates
                            SET title = ?1, duration_min = ?2, tool = ?3, description = ?4
                          WHERE id = ?5
                            AND (title <> ?1 OR duration_min <> ?2
                                 OR tool <> ?3 OR description <> ?4)",
                        params![
                            seed.title,
                            seed.duration_min,
                            seed.tool,
                            seed.description,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO study_templates
                     (sync_key, title, duration_min, tool, description, area, areas,
                      builtin, i18n_key, created_ts, updated_ts)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6, ?7, ?8, ?8)",
                    params![
                        sync_key,
                        seed.title,
                        seed.duration_min,
                        seed.tool,
                        seed.description,
                        seed.area,
                        seed.i18n_key,
                        now
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    // Altbestand ohne Bereichsliste: der einzelne Bereich ist die Liste.
    conn.execute(
        "UPDATE study_templates SET areas = area WHERE areas = '' AND area <> ''",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn init(conn: &Connection) -> Result<(), String> {
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    // Ohne Größenbremse wächst das WAL nach einem Puzzle-Import auf mehrere
    // Gigabyte an; jede Leseabfrage muss es dann durchsuchen, was Puzzles und
    // Statistiken spürbar ausbremst. 8 MB reichen als Schreibpuffer.
    let _ = conn.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024);
    let _ = conn.pragma_update(None, "wal_autocheckpoint", 1_000);
    checkpoint(conn);

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("Schema-Version konnte nicht gelesen werden: {e}"))?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "Die Datenbank verwendet Schema-Version {version}, diese Kiebitz-Version unterstützt höchstens {SCHEMA_VERSION}"
        ));
    }
    if version == SCHEMA_VERSION {
        // Ohne Migration nichts zu tun · außer der einen Zusicherung, die auch
        // zwischen zwei Versionen brechen kann: zu jedem Bereich gibt es eine
        // Standardeinheit. Ein Sync von einer älteren Gegenstelle könnte sie
        // sonst löschen und den Wochenvorschlag stillschweigend entkernen.
        return ensure_builtin_study_templates(conn);
    }

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("Migration konnte nicht gestartet werden: {e}"))?;
    let result = migrate_to_current(conn).and_then(|_| {
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("Schema-Version konnte nicht gespeichert werden: {e}"))
    });
    match result {
        Ok(()) => match conn.execute_batch("COMMIT") {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(format!(
                    "Migration konnte nicht abgeschlossen werden: {error}"
                ))
            }
        },
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// Lightweight representation used by lists, dashboards and statistics. The
/// potentially large move, clock and note payloads are loaded only on demand.
#[derive(Serialize, Clone, Debug)]
pub struct GameSummary {
    pub id: i64,
    pub source: String,
    pub url: String,
    pub played_at: String,
    pub played_ts: i64,
    pub time_class: String,
    pub color: String,
    pub my_name: String,
    pub opponent: String,
    pub opp_elo: i64,
    pub my_elo: i64,
    pub result: String,
    pub opening: String,
    pub eco: String,
    pub moves_count: i64,
    pub accuracy: Option<f64>,
    pub accuracy_opening: Option<f64>,
    pub accuracy_middlegame: Option<f64>,
    pub accuracy_endgame: Option<f64>,
    pub opponent_accuracy: Option<f64>,
    pub opponent_accuracy_opening: Option<f64>,
    pub opponent_accuracy_middlegame: Option<f64>,
    pub opponent_accuracy_endgame: Option<f64>,
    pub tags: Vec<String>,
    pub analyzed: bool,
    pub analysis_excluded: bool,
    pub has_moves: bool,
    pub has_note: bool,
    /// Beendigungsgrund; siehe `GameRecord::termination`.
    pub termination: String,
}

#[derive(Deserialize, Default)]
pub struct GamePageRequest {
    pub offset: i64,
    pub limit: i64,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub time_class: String,
    #[serde(default)]
    pub played_day: String,
    #[serde(default)]
    pub played_from: i64,
    #[serde(default)]
    pub played_to: i64,
    /// Untere Zeitgrenze des Zeitraum-Filters (Unix-Sekunden); 0 heisst: alle.
    #[serde(default)]
    pub since: i64,
    #[serde(default)]
    pub opponent: String,
    #[serde(default)]
    pub opening: String,
    /// Gespielte Farbe ("white"/"black"); leer heisst: beide.
    #[serde(default)]
    pub color: String,
    /// ECO-Kennung; leer heisst: alle.
    #[serde(default)]
    pub eco: String,
    #[serde(default)]
    pub query: String,
}

#[derive(Serialize)]
pub struct GamePage {
    pub items: Vec<GameSummary>,
    pub total: i64,
    pub library_total: i64,
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for name in names {
        if name.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )
        .map_err(|e| format!("Spalte {table}.{column} konnte nicht angelegt werden: {e}"))?;
    }
    Ok(())
}

/// Upgrades both new databases and legacy databases which predate
/// `user_version`. The caller owns the surrounding transaction.
fn migrate_to_current(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS games (
            id          INTEGER PRIMARY KEY,
            source      TEXT NOT NULL,
            source_id   TEXT NOT NULL,
            url         TEXT NOT NULL DEFAULT '',
            played_at   TEXT NOT NULL DEFAULT '',
            time_class  TEXT NOT NULL DEFAULT '',
            color       TEXT NOT NULL DEFAULT '',
            my_name     TEXT NOT NULL DEFAULT '',
            opponent    TEXT NOT NULL DEFAULT '',
            opp_elo     INTEGER NOT NULL DEFAULT 0,
            my_elo      INTEGER NOT NULL DEFAULT 0,
            result      TEXT NOT NULL DEFAULT '',
            opening     TEXT NOT NULL DEFAULT '',
            eco         TEXT NOT NULL DEFAULT '',
            moves_count INTEGER NOT NULL DEFAULT 0,
            accuracy    REAL,
            moves       TEXT NOT NULL DEFAULT '',
            note        TEXT NOT NULL DEFAULT '',
            analyzed    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(source, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at DESC);

        -- v3: Auto-Analyse · ein Eintrag pro gespieltem Halbzug
        CREATE TABLE IF NOT EXISTS move_evals (
            game_id  INTEGER NOT NULL,
            ply      INTEGER NOT NULL,          -- 1-basiert
            san      TEXT NOT NULL DEFAULT '',
            eval_cp  INTEGER,                   -- nach dem Zug, aus Weiß-Sicht
            mate_in  INTEGER,                   -- gesetzt statt eval_cp bei Matt
            best_uci TEXT NOT NULL DEFAULT '',  -- Engine-Empfehlung vor dem Zug
            judgment TEXT NOT NULL DEFAULT '',  -- '', inaccuracy, mistake, blunder
            phase    TEXT NOT NULL DEFAULT '',  -- opening, middlegame, endgame
            PRIMARY KEY (game_id, ply)
        );

        -- v3: Positionsindex für die Stellungssuche
        CREATE TABLE IF NOT EXISTS positions (
            fen_key TEXT NOT NULL,
            game_id INTEGER NOT NULL,
            ply     INTEGER NOT NULL,           -- Stellung nach `ply` Halbzügen
            PRIMARY KEY (fen_key, game_id, ply)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_positions_game ON positions(game_id);

        -- v3: Eval-Cache über Partien hinweg (Eröffnungen wiederholen sich)
        CREATE TABLE IF NOT EXISTS eval_cache (
            fen_key  TEXT PRIMARY KEY,
            eval_cp  INTEGER,                   -- aus Sicht des Spielers am Zug
            mate_in  INTEGER,
            best_uci TEXT NOT NULL DEFAULT '',
            depth    INTEGER NOT NULL DEFAULT 0,
            -- v21: Wer diese Zahl gerechnet hat ('Stockfish 19'). Ohne sie
            -- bekäme ein Lauf mit neuer Engine die Werte der alten serviert.
            engine   TEXT NOT NULL DEFAULT ''
        );

        -- v3: Eröffnungs-Repertoire als Zugbaum mit FSRS-Lernzustand
        CREATE TABLE IF NOT EXISTS rep_nodes (
            id         INTEGER PRIMARY KEY,
            parent_id  INTEGER NOT NULL DEFAULT 0,  -- 0 = Wurzel
            side       TEXT NOT NULL,               -- white | black
            san        TEXT NOT NULL,
            name       TEXT NOT NULL DEFAULT '',
            fen_key    TEXT NOT NULL,
            depth      INTEGER NOT NULL,            -- Halbzug des Zuges (1-basiert)
            stability  REAL NOT NULL DEFAULT 0,
            difficulty REAL NOT NULL DEFAULT 0,
            reps       INTEGER NOT NULL DEFAULT 0,
            lapses     INTEGER NOT NULL DEFAULT 0,
            due_ts     INTEGER NOT NULL DEFAULT 0,
            last_ts    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(side, parent_id, san)
        );
        CREATE INDEX IF NOT EXISTS idx_rep_fen ON rep_nodes(fen_key);

        -- v3: Lichess-Puzzle-Datenbank (lokal importiert)
        CREATE TABLE IF NOT EXISTS puzzles (
            id           TEXT PRIMARY KEY,
            fen          TEXT NOT NULL,
            moves        TEXT NOT NULL,          -- UCI, erster Zug ist der Gegnerzug
            rating       INTEGER NOT NULL,
            rd           INTEGER NOT NULL DEFAULT 0,
            popularity   INTEGER NOT NULL DEFAULT 0,
            nb_plays     INTEGER NOT NULL DEFAULT 0,
            themes       TEXT NOT NULL DEFAULT '',
            opening_tags TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles(rating);

        CREATE TABLE IF NOT EXISTS puzzle_attempts (
            id            INTEGER PRIMARY KEY,
            puzzle_id     TEXT NOT NULL,
            ts            INTEGER NOT NULL,
            solved        INTEGER NOT NULL,
            rating_before INTEGER NOT NULL,
            rating_after  INTEGER NOT NULL,
            themes        TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- v4: Cache für chessdb.cn-Antworten (Cloud-Eröffnungsbuch)
        CREATE TABLE IF NOT EXISTS chessdb_cache (
            fen_key TEXT PRIMARY KEY,
            json    TEXT NOT NULL,
            ts      INTEGER NOT NULL
        );

        -- v19: Cache für den Lichess-Eröffnungs-Explorer. Der Schlüssel
        -- enthält die Quelle samt Filtern, weil dieselbe Stellung in zwei
        -- Rating-Bändern verschieden aussieht · siehe explorer.rs.
        CREATE TABLE IF NOT EXISTS explorer_cache (
            source_key TEXT NOT NULL,
            fen_key    TEXT NOT NULL,
            json       TEXT NOT NULL,
            ts         INTEGER NOT NULL,
            PRIMARY KEY (source_key, fen_key)
        ) WITHOUT ROWID;

        -- v5: Endspiel-Trainer · ein Eintrag pro ausgespieltem Drill-Versuch
        CREATE TABLE IF NOT EXISTS endgame_attempts (
            id       INTEGER PRIMARY KEY,
            drill_id TEXT NOT NULL,               -- ID aus src/data/endgames.ts
            ts       INTEGER NOT NULL,
            solved   INTEGER NOT NULL,
            moves    INTEGER NOT NULL DEFAULT 0   -- Halbzüge bis zum Ende
        );
        CREATE INDEX IF NOT EXISTS idx_endgame_drill ON endgame_attempts(drill_id);",
    )
    .map_err(|e| format!("Schema-Init fehlgeschlagen: {e}"))?;

    // Migration v2: Zeitstempel-Spalte. Legacy-Datenbanken werden anhand ihrer
    // tatsächlichen Spaltenstruktur erkannt.
    add_column_if_missing(conn, "games", "played_ts", "INTEGER NOT NULL DEFAULT 0")?;
    // Migration v6 (Sync): Änderungs-Zeitstempel für den Delta-Sync und
    // Last-Write-Wins bei Notizen. DEFAULT 0 = "vor Einführung des Syncs" ·
    // der erste Sync (Cursor 0) überträgt damit den kompletten Bestand.
    add_column_if_missing(conn, "games", "updated_ts", "INTEGER NOT NULL DEFAULT 0")?;
    add_column_if_missing(conn, "games", "note_ts", "INTEGER NOT NULL DEFAULT 0")?;
    // Migration v8: Phasen-Genauigkeit und frei editierbare Tags.
    for (column, definition) in [
        ("accuracy_opening", "REAL"),
        ("accuracy_middlegame", "REAL"),
        ("accuracy_endgame", "REAL"),
        ("tags", "TEXT NOT NULL DEFAULT '[]'"),
        ("tags_ts", "INTEGER NOT NULL DEFAULT 0"),
        ("analysis_excluded", "INTEGER NOT NULL DEFAULT 0"),
        ("my_name", "TEXT NOT NULL DEFAULT ''"),
        // Migration v10: Zeitpunkt der Auto-Analyse · der Wochenkalender zählt
        // ein vollständiges Partie-Review als Lerneinheit an genau diesem Tag.
        ("analyzed_ts", "INTEGER NOT NULL DEFAULT 0"),
        // Migration v12: Uhrendaten · das Analyse-Brett zeigt die Restzeit
        // beider Seiten, sobald eine Partie sie mitbringt.
        ("clocks", "TEXT NOT NULL DEFAULT ''"),
        ("time_control", "TEXT NOT NULL DEFAULT ''"),
        // Migration v15: Die Partieanalyse zeigt dieselben Gesamt- und
        // Phasenwerte auch fuer den Gegner.
        ("opponent_accuracy", "REAL"),
        ("opponent_accuracy_opening", "REAL"),
        ("opponent_accuracy_middlegame", "REAL"),
        ("opponent_accuracy_endgame", "REAL"),
        // Migration v16: Wie die Partie endete. Aufgabe, Zeitüberschreitung und
        // Remisangebot stehen nicht in der Schlussstellung · ohne diese Spalte
        // koennte Kiebitz "auf Zeit verloren" nie anzeigen.
        ("termination", "TEXT NOT NULL DEFAULT ''"),
        // Migration v20: Das Fazit der Partie als Liste von Satzbausteinen
        // (JSON aus {key, params}) · gesetzt wird es aus der Auto-Analyse,
        // gesprochen wird es erst in der Oberfläche. `verdict_version` sagt,
        // nach welchen Regeln es entstand, damit eine spätere Fassung es ohne
        // neuen Stockfish-Lauf ersetzen kann.
        ("verdict", "TEXT NOT NULL DEFAULT ''"),
        ("verdict_version", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        add_column_if_missing(conn, "games", column, definition)?;
    }
    // Migration v20: Was die Erklärung eines Zuges braucht und die Pipeline
    // bisher wegwarf · die Hauptvariante vor dem Zug, der Verlust in
    // Zentibauern und das erkannte Motiv. Alles additiv: eine bestehende
    // Datenbank behält ihre Zeilen und füllt die Spalten beim nächsten Lauf.
    for (column, definition) in [
        ("pv", "TEXT NOT NULL DEFAULT ''"),
        ("loss_cp", "INTEGER"),
        ("motif", "TEXT NOT NULL DEFAULT ''"),
        ("motif_detail", "TEXT NOT NULL DEFAULT ''"),
        ("expl_version", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        add_column_if_missing(conn, "move_evals", column, definition)?;
    }
    // Dieselbe Hauptvariante im Cache: Wer eine Stellung schon kennt, soll
    // ihre Linie nicht ein zweites Mal rechnen lassen. Alte Zeilen haben sie
    // nicht — leer heißt „keine Linie", nicht „ungültig", damit ein großer
    // Cache nicht wegen einer Spalte verfällt.
    add_column_if_missing(conn, "eval_cache", "pv", "TEXT NOT NULL DEFAULT ''")?;
    // Migration v21: Der Cache sagt jetzt, welche Engine seine Zahlen gerechnet
    // hat, und wird nur noch für dieselbe gelesen (siehe analysis.rs).
    //
    // Hier ist das Gegenteil der Regel von oben richtig: Eine Bewertung ohne
    // Herkunft ist nicht „keine Bewertung", sondern eine, deren Gültigkeit
    // niemand mehr behaupten kann — sie stammt aus einer Stockfish-Fassung vor
    // dieser Spalte. Stehen bleiben dürfte sie nur als toter Ballast, denn
    // gelesen wird sie nie wieder. Der Cache ist reine Beschleunigung; die
    // Ergebnisse der Partien liegen in `move_evals` und bleiben unberührt.
    add_column_if_missing(conn, "eval_cache", "engine", "TEXT NOT NULL DEFAULT ''")?;
    conn.execute("DELETE FROM eval_cache WHERE engine = ''", [])
        .map_err(|e| format!("Alte Cache-Werte konnten nicht verworfen werden: {e}"))?;
    // Migration v7 (Sync-Grenzen): Repertoire-Löschungen propagieren über
    // Tombstones (Löschung gewinnt nur gegen ältere Knoten · created_ts
    // erlaubt das Wieder-Anlegen), und Puzzle-Versuche merken sich das
    // Puzzle-Rating zur Versuchszeit, damit die Elo-Kette nach einem Merge
    // deterministisch neu berechnet werden kann.
    add_column_if_missing(
        conn,
        "rep_nodes",
        "created_ts",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        conn,
        "puzzle_attempts",
        "puzzle_rating",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    // Migration v9: Herkunft eigener Puzzles sowie persistenter Studienkalender.
    for (column, definition) in [
        ("source", "TEXT NOT NULL DEFAULT 'lichess'"),
        ("source_game_id", "INTEGER"),
        ("source_ply", "INTEGER"),
        ("setup_plies", "INTEGER NOT NULL DEFAULT 1"),
    ] {
        add_column_if_missing(conn, "puzzles", column, definition)?;
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_puzzles_source ON puzzles(source);
         CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_puzzle
           ON puzzle_attempts(puzzle_id, solved);
         -- Der Sync vereinigt den vollständigen Append-only-Verlauf anhand
         -- dieses natürlichen Schlüssels; der Index hält den Merge zügig.
         CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_sync
           ON puzzle_attempts(puzzle_id, ts);

         CREATE TABLE IF NOT EXISTS study_templates (
            id           INTEGER PRIMARY KEY,
            sync_key     TEXT NOT NULL DEFAULT '',
            title        TEXT NOT NULL,
            duration_min INTEGER NOT NULL DEFAULT 20,
            tool         TEXT NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            created_ts   INTEGER NOT NULL DEFAULT 0,
            updated_ts   INTEGER NOT NULL DEFAULT 0,
            deleted      INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE IF NOT EXISTS study_events (
            id           INTEGER PRIMARY KEY,
            sync_key     TEXT NOT NULL DEFAULT '',
            template_id  INTEGER NOT NULL,
            day          TEXT NOT NULL,
            position     INTEGER NOT NULL DEFAULT 0,
            completed    INTEGER NOT NULL DEFAULT 0,
            completed_ts INTEGER NOT NULL DEFAULT 0,
            created_ts   INTEGER NOT NULL DEFAULT 0,
            updated_ts   INTEGER NOT NULL DEFAULT 0,
            deleted      INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_study_events_day ON study_events(day, position, id);",
    )
    .map_err(|e| format!("Kalender-Schema fehlgeschlagen: {e}"))?;
    // Sync-fähiger Kalender (v11). Soft deletes prevent removed units from
    // reappearing when an older peer reconnects.
    for (table, column, definition) in [
        ("study_templates", "sync_key", "TEXT NOT NULL DEFAULT ''"),
        ("study_templates", "deleted", "INTEGER NOT NULL DEFAULT 0"),
        ("study_events", "sync_key", "TEXT NOT NULL DEFAULT ''"),
        ("study_events", "updated_ts", "INTEGER NOT NULL DEFAULT 0"),
        ("study_events", "deleted", "INTEGER NOT NULL DEFAULT 0"),
        // Migration v12: wiederkehrende Einheiten. Eine Serie ist keine Regel,
        // sondern eine Reihe echter Termine mit gemeinsamem `series_key` ·
        // dadurch bleiben Abhaken, Verschieben, Löschen und der Gerätesync
        // genau die Operationen, die es für einzelne Einheiten schon gibt.
        ("study_events", "repeat_rule", "TEXT NOT NULL DEFAULT ''"),
        ("study_events", "series_key", "TEXT NOT NULL DEFAULT ''"),
        // Migration v13: Notiz je Repertoire-Stellung. Ein Repertoire ohne
        // Begründung ist nach ein paar Monaten nur noch eine Zugliste · der
        // Plan hinter der Variante gehört an die Stellung, nicht ins Gedächtnis.
        ("rep_nodes", "note", "TEXT NOT NULL DEFAULT ''"),
        // Migration v16: Lerneinheiten tragen ihren Trainingsbereich selbst.
        //
        // Vorher riet der Wochenplaner ihn aus Teilwörtern des Titels, und zwar
        // aus englischen und deutschen · eine Vorlage "Táctica" traf nichts und
        // fiel damit stillschweigend aus der Planung. `i18n_key` markiert die
        // vier Startvorlagen, damit sie in der Sprache der Oberfläche stehen,
        // solange niemand sie bearbeitet hat.
        ("study_templates", "area", "TEXT NOT NULL DEFAULT ''"),
        ("study_templates", "i18n_key", "TEXT NOT NULL DEFAULT ''"),
        // Migration v17: die Länge einer Einheit steht am Termin, nicht mehr an
        // der Vorlage.
        //
        // Kiebitz misst die Trainingszeit selbst; eine von Hand eingetippte
        // Dauer war ab da nur noch eine zweite, schlechtere Zahl. Geplant wird
        // jetzt aus dem Wochenbudget: der Vorschlag rechnet die Lücke je
        // Bereich in Sitzungen um und schreibt deren Minuten an den Termin.
        // `duration_min` bleibt als Rückfall für Altbestand stehen.
        //
        // `areas` erlaubt einer eigenen Einheit mehrere Bereiche ("Taktik und
        // Endspiel"), `builtin` hält die fünf Standardeinheiten am Leben, und
        // `source` unterscheidet vom Vorschlag erzeugte Termine von selbst
        // geplanten · nur die eigenen darf ein neuer Vorschlag ersetzen.
        ("study_templates", "areas", "TEXT NOT NULL DEFAULT ''"),
        ("study_templates", "builtin", "TEXT NOT NULL DEFAULT ''"),
        ("study_events", "planned_min", "INTEGER NOT NULL DEFAULT 0"),
        ("study_events", "source", "TEXT NOT NULL DEFAULT ''"),
        // Migration v18: selbst gewählte Reihenfolge der Repertoire-Varianten.
        //
        // Die Linienliste stand bisher in Einfügereihenfolge; welche Variante
        // einem wichtig ist, weiß aber nur der Spieler. `sort_order` hält die
        // gezogene Reihenfolge (0 = noch nie sortiert · solche Linien hängen
        // sich hinten an), `sort_ts` entscheidet beim Gerätesync, wessen
        // Reihenfolge die jüngere ist.
        ("rep_nodes", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
        ("rep_nodes", "sort_ts", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        add_column_if_missing(conn, table, column, definition)?;
    }
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_study_events_series ON study_events(series_key)",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "UPDATE study_templates
           SET sync_key = CASE
             WHEN id BETWEEN 1 AND 4 THEN 'seed-' || id
             ELSE 'template-' || created_ts || '-' || id
           END
         WHERE sync_key = '';
         UPDATE study_events
           SET sync_key = 'event-' || created_ts || '-' || id
         WHERE sync_key = '';
         UPDATE study_events SET updated_ts = created_ts WHERE updated_ts = 0;",
    )
    .map_err(|e| format!("Kalender-Sync-Migration fehlgeschlagen: {e}"))?;

    // Einstellungen des Trainingsprogramms · sie liegen bewusst *hier* und
    // nicht in der settings.json: ein Wochenbudget, das auf jedem Gerät ein
    // anderes ist, ist kein Budget. Alles andere in den Einstellungen bleibt
    // gerätelokal (Engine-Pfade, Fenster, Sync-Adresse).
    conn.execute(
        "CREATE TABLE IF NOT EXISTS study_prefs (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_ts INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Englisch ausgeliefert, weil die App vielsprachig ist und Englisch die
    // kleinste gemeinsame Basis aller Nutzer ist.
    translate_seeded_study_templates(conn)?;
    ensure_builtin_study_templates(conn)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS rep_tombstones (
            side       TEXT NOT NULL,
            path       TEXT NOT NULL,
            deleted_ts INTEGER NOT NULL,
            PRIMARY KEY (side, path)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS game_tombstones (
            source      TEXT NOT NULL,
            source_id   TEXT NOT NULL,
            deleted_ts  INTEGER NOT NULL,
            PRIMARY KEY (source, source_id)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    // Backfill: Puzzle-Rating für Alt-Versuche aus der lokalen Puzzle-DB.
    conn.execute(
        "UPDATE puzzle_attempts
         SET puzzle_rating = COALESCE((SELECT rating FROM puzzles WHERE id = puzzle_id), 0)
         WHERE puzzle_rating = 0",
        [],
    )
    .map_err(|e| format!("Puzzle-Rating-Backfill fehlgeschlagen: {e}"))?;

    // Migration v14: Trainingsprogramm.
    //
    // `rep_review_log` schließt eine Lücke, die erst bei der Wirkungsmessung
    // auffällt: `rep_nodes.last_ts` hält nur die *letzte* Wiederholung, damit
    // löscht sich die Vergangenheit selbst, sobald eine Karte erneut drankommt.
    // Ein Verlauf über Wochen braucht ein append-only Log · dieselbe Bauart wie
    // `puzzle_attempts`, das der Sync bereits konfliktfrei vereinigt.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rep_review_log (
            id       INTEGER PRIMARY KEY,
            node_id  INTEGER NOT NULL,
            ts       INTEGER NOT NULL,
            grade    INTEGER NOT NULL,
            side     TEXT NOT NULL DEFAULT '',
            path     TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS idx_rep_review_log_ts ON rep_review_log(ts);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_review_log_key
           ON rep_review_log(side, path, ts);",
    )
    .map_err(|e| format!("Trainingsprogramm-Schema fehlgeschlagen: {e}"))?;

    // Migration v19: Fokus-Zyklen entfernt.
    //
    // `study_focus` hielt die Absicht „ich arbeite jetzt an X", aus der eine
    // Vorher/Nachher-Messung wurde. Der Coach nennt seine Baustellen inzwischen
    // von selbst und rechnet über ein Fenster, das der Spielhäufigkeit folgt ·
    // damit war der von Hand gesetzte Zyklus ein zweiter Weg zum selben Ziel,
    // der gepflegt werden wollte. Die Tabelle trug nur diese Absicht, keine
    // Messwerte; mit der Funktion verschwindet auch ihr Inhalt.
    conn.execute_batch("DROP TABLE IF EXISTS study_focus;")
        .map_err(|e| format!("Fokus-Tabelle konnte nicht entfernt werden: {e}"))?;

    // Migration v16: gemessene Trainingszeit.
    //
    // Das Trainingsbudget verglich bis hierhin eine getippte Wochenvorgabe mit
    // einer Hochrechnung aus Zählern (1,5 Minuten je Puzzle, 4 je Drill …).
    // Beide Seiten waren Schätzungen, und die Lücke dazwischen war die ganze
    // Aussage der Seite. `study_sessions` hält stattdessen, was tatsächlich
    // vor dem Brett verbracht wurde: die Trainerseiten zählen aktive Sekunden
    // und schreiben sie regelmäßig fort.
    //
    // Eine Sitzung ist über `sync_key` identifiziert und wächst · deshalb ist
    // dies keine append-only Tabelle wie `puzzle_attempts`, sondern eine mit
    // Fortschreibung, und der Sync vereinigt sie über MAX(seconds).
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS study_sessions (
            id         INTEGER PRIMARY KEY,
            sync_key   TEXT NOT NULL,
            area       TEXT NOT NULL,
            start_ts   INTEGER NOT NULL,
            end_ts     INTEGER NOT NULL DEFAULT 0,
            seconds    INTEGER NOT NULL DEFAULT 0,
            updated_ts INTEGER NOT NULL DEFAULT 0
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_study_sessions_key
           ON study_sessions(sync_key);
         CREATE INDEX IF NOT EXISTS idx_study_sessions_start
           ON study_sessions(start_ts);",
    )
    .map_err(|e| format!("Sitzungs-Schema fehlgeschlagen: {e}"))?;

    // Einmaliger Backfill des Wiederholungslogs aus dem FSRS-Zustand. Das
    // rekonstruiert nur die jeweils letzte Wiederholung je Knoten — mehr gibt
    // die alte Datenlage nicht her —, verhindert aber, dass der Verlauf am Tag
    // des Updates bei null anfängt.
    if meta_get(conn, "rep_review_log_backfilled").is_none() {
        // `path` ist die SAN-Kette von der Wurzel · derselbe geräteunabhängige
        // Schlüssel, den der Sync für Repertoire-Knoten und Tombstones nutzt.
        conn.execute(
            "WITH RECURSIVE chain(id, path) AS (
                 SELECT id, san FROM rep_nodes WHERE parent_id = 0
                 UNION ALL
                 SELECT n.id, chain.path || ' ' || n.san
                   FROM rep_nodes n JOIN chain ON n.parent_id = chain.id
             )
             INSERT OR IGNORE INTO rep_review_log (node_id, ts, grade, side, path)
             SELECT n.id, n.last_ts, 3, n.side, c.path
             FROM rep_nodes n JOIN chain c ON c.id = n.id
             WHERE n.reps > 0 AND n.last_ts > 0",
            [],
        )
        .map_err(|e| format!("Review-Log-Backfill fehlgeschlagen: {e}"))?;
        meta_set(conn, "rep_review_log_backfilled", "1")?;
    }

    // Migration v16: Beendigungsgrund für den Altbestand nachtragen.
    //
    // Aus der Zugfolge sind nur die Gründe rekonstruierbar, die in der
    // Schlussstellung stehen: Matt, Patt, ungenügendes Material, 50 Züge. Wer
    // aufgegeben hat oder auf Zeit verlor, hinterlässt dort nichts · diese
    // Partien behalten einen leeren Grund und zeigen weiterhin nur Sieg oder
    // Niederlage. Ein erneuter Import füllt sie später aus der Quelle.
    if meta_get(conn, "games_termination_backfilled").is_none() {
        let rows: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, moves FROM games WHERE termination = '' AND moves != ''")
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            mapped
        };
        let mut update = conn
            .prepare("UPDATE games SET termination = ?2 WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        for (id, moves) in rows {
            if let Some(reason) = crate::chess::terminal_reason(&moves) {
                update
                    .execute(params![id, reason])
                    .map_err(|e| format!("Termination-Backfill fehlgeschlagen: {e}"))?;
            }
        }
        drop(update);
        meta_set(conn, "games_termination_backfilled", "1")?;
    }

    // Read-heavy screens aggregate by timestamps and analysis state. These
    // indexes turn their former full-table scans into bounded range scans.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_games_played_ts
           ON games(played_ts DESC, played_at DESC, id DESC);
         CREATE INDEX IF NOT EXISTS idx_games_analysis_queue
           ON games(analysis_excluded, analyzed, played_ts);
         CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_ts
           ON puzzle_attempts(ts);
         CREATE INDEX IF NOT EXISTS idx_endgame_attempts_ts
           ON endgame_attempts(ts);
         CREATE INDEX IF NOT EXISTS idx_rep_nodes_due
           ON rep_nodes(due_ts);
         CREATE INDEX IF NOT EXISTS idx_study_events_completed
           ON study_events(completed_ts)
           WHERE completed = 1 AND deleted = 0;",
    )
    .map_err(|e| format!("Performance-Indizes konnten nicht angelegt werden: {e}"))?;
    Ok(())
}

/// Unix-Zeit in Sekunden · der gemeinsame Zeitstempel für Sync-Spalten.
/// Schreibt das WAL in die Datenbank zurück und kürzt es. Nach großen Importen
/// und beim Start hält das die Datei klein und die Lesezugriffe schnell.
pub fn checkpoint(conn: &Connection) {
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
}

pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
    .ok()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Eine Einstellung des Trainingsprogramms mit ihrem Änderungszeitpunkt · der
/// Zeitstempel entscheidet beim Sync, welches Gerät recht behält.
pub struct StudyPref {
    pub key: String,
    pub value: String,
    pub updated_ts: i64,
}

/// Die Namen, die zwischen Geräten wandern. Bewusst eine feste Liste: was hier
/// nicht steht, bleibt gerätelokal.
pub const STUDY_PREF_KEYS: [&str; 3] = ["weekly_minutes", "training_days", "goal_date"];

pub fn study_pref_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM study_prefs WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

/// Schreibt eine Einstellung fort. `updated_ts` ist der Konfliktschlüssel des
/// Syncs, deshalb steht er hier explizit und wird nicht intern erzeugt.
pub fn study_pref_set(
    conn: &Connection,
    key: &str,
    value: &str,
    updated_ts: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO study_prefs (key, value, updated_ts) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_ts = excluded.updated_ts
          WHERE excluded.updated_ts >= study_prefs.updated_ts",
        params![key, value, updated_ts],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn study_prefs_all(conn: &Connection) -> Result<Vec<StudyPref>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value, updated_ts FROM study_prefs")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(StudyPref {
                key: r.get(0)?,
                value: r.get(1)?,
                updated_ts: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Serialize)]
pub struct DbStats {
    pub total: i64,
}

pub fn stats(conn: &Connection) -> Result<DbStats, String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbStats { total })
}

/// Fügt Partien ein; bereits vorhandene (source, source_id) werden aktualisiert,
/// ohne Notizen oder den Analyse-Status zu überschreiben.
pub fn upsert_games(conn: &mut Connection, games: &[GameRecord]) -> Result<UpsertResult, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0usize;
    {
        let mut exists_stmt = tx
            .prepare("SELECT 1 FROM games WHERE source = ?1 AND source_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut upsert_stmt = tx
            .prepare(
                "INSERT INTO games (source, source_id, url, played_at, played_ts, time_class, color,
                    my_name, opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame,
                    opponent_accuracy, opponent_accuracy_opening,
                    opponent_accuracy_middlegame, opponent_accuracy_endgame, moves,
                    note, note_ts, tags, tags_ts, analysis_excluded, updated_ts,
                    clocks, time_control, termination)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33)
                 ON CONFLICT(source, source_id) DO UPDATE SET
                    url = excluded.url,
                    played_at = excluded.played_at,
                    played_ts = excluded.played_ts,
                    color = excluded.color,
                    my_name = CASE WHEN excluded.my_name != '' THEN excluded.my_name ELSE games.my_name END,
                    opponent = excluded.opponent,
                    opp_elo = excluded.opp_elo,
                    my_elo = excluded.my_elo,
                    accuracy = COALESCE(excluded.accuracy, games.accuracy),
                    accuracy_opening = COALESCE(excluded.accuracy_opening, games.accuracy_opening),
                    accuracy_middlegame = COALESCE(excluded.accuracy_middlegame, games.accuracy_middlegame),
                    accuracy_endgame = COALESCE(excluded.accuracy_endgame, games.accuracy_endgame),
                    opponent_accuracy = COALESCE(excluded.opponent_accuracy, games.opponent_accuracy),
                    opponent_accuracy_opening = COALESCE(excluded.opponent_accuracy_opening, games.opponent_accuracy_opening),
                    opponent_accuracy_middlegame = COALESCE(excluded.opponent_accuracy_middlegame, games.opponent_accuracy_middlegame),
                    opponent_accuracy_endgame = COALESCE(excluded.opponent_accuracy_endgame, games.opponent_accuracy_endgame),
                    moves = excluded.moves,
                    moves_count = excluded.moves_count,
                    time_class = excluded.time_class,
                    analysis_excluded = excluded.analysis_excluded,
                    updated_ts = excluded.updated_ts,
                    -- Ein Re-Import ohne Uhrendaten darf vorhandene nicht löschen.
                    clocks = CASE WHEN excluded.clocks != '' THEN excluded.clocks ELSE games.clocks END,
                    time_control = CASE WHEN excluded.time_control != ''
                        THEN excluded.time_control ELSE games.time_control END,
                    -- Wie bei den Uhren: ein Re-Import ohne Beendigungsgrund
                    -- darf einen bereits bekannten nicht wieder loeschen.
                    termination = CASE WHEN excluded.termination != ''
                        THEN excluded.termination ELSE games.termination END",
            )
            .map_err(|e| e.to_string())?;

        for g in games {
            let existed = exists_stmt
                .exists(params![g.source, g.source_id])
                .map_err(|e| e.to_string())?;
            let changed_at = now_ts();
            // Ein bewusster lokaler Re-Import legt die Partie neu an und hebt
            // deshalb einen älteren Löschmarker auf.
            tx.execute(
                "DELETE FROM game_tombstones WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
            )
            .map_err(|e| e.to_string())?;
            upsert_stmt
                .execute(params![
                    g.source,
                    g.source_id,
                    g.url,
                    g.played_at,
                    g.played_ts,
                    g.time_class,
                    g.color,
                    g.my_name,
                    g.opponent,
                    g.opp_elo,
                    g.my_elo,
                    g.result,
                    g.opening,
                    g.eco,
                    g.moves_count,
                    g.accuracy,
                    g.accuracy_opening,
                    g.accuracy_middlegame,
                    g.accuracy_endgame,
                    g.opponent_accuracy,
                    g.opponent_accuracy_opening,
                    g.opponent_accuracy_middlegame,
                    g.opponent_accuracy_endgame,
                    g.moves,
                    g.note,
                    if g.note.is_empty() { 0 } else { changed_at },
                    serde_json::to_string(&g.tags).map_err(|e| e.to_string())?,
                    if g.tags.is_empty() { 0 } else { changed_at },
                    g.analysis_excluded as i64,
                    changed_at,
                    g.clocks,
                    g.time_control,
                    g.termination
                ])
                .map_err(|e| e.to_string())?;
            if !existed {
                inserted += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(UpsertResult { inserted, total })
}

pub fn list_games(conn: &Connection) -> Result<Vec<GameRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, source, source_id, url, played_at, played_ts, time_class, color, my_name, opponent,
                    opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame,
                    opponent_accuracy, opponent_accuracy_opening,
                    opponent_accuracy_middlegame, opponent_accuracy_endgame, moves,
                    note, tags, analyzed, analysis_excluded, clocks, time_control, termination
             FROM games ORDER BY played_ts DESC, played_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GameRecord {
                id: r.get(0)?,
                source: r.get(1)?,
                source_id: r.get(2)?,
                url: r.get(3)?,
                played_at: r.get(4)?,
                played_ts: r.get(5)?,
                time_class: r.get(6)?,
                color: r.get(7)?,
                my_name: r.get(8)?,
                opponent: r.get(9)?,
                opp_elo: r.get(10)?,
                my_elo: r.get(11)?,
                result: r.get(12)?,
                opening: r.get(13)?,
                eco: r.get(14)?,
                moves_count: r.get(15)?,
                accuracy: r.get(16)?,
                accuracy_opening: r.get(17)?,
                accuracy_middlegame: r.get(18)?,
                accuracy_endgame: r.get(19)?,
                opponent_accuracy: r.get(20)?,
                opponent_accuracy_opening: r.get(21)?,
                opponent_accuracy_middlegame: r.get(22)?,
                opponent_accuracy_endgame: r.get(23)?,
                moves: r.get(24)?,
                note: r.get(25)?,
                tags: serde_json::from_str(&r.get::<_, String>(26)?).unwrap_or_default(),
                analyzed: r.get::<_, i64>(27)? != 0,
                analysis_excluded: r.get::<_, i64>(28)? != 0,
                clocks: r.get(29)?,
                time_control: r.get(30)?,
                termination: r.get(31)?,
                // Die Vollliste trägt kein Fazit: Sie holt alle Partien mit
                // allen Zügen, und ein Absatz je Partie wäre Nutzlast, die
                // hier niemand liest. Wer es braucht, holt die Partie einzeln
                // (`get_game`).
                verdict: String::new(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE games SET note = ?1, note_ts = ?3, updated_ts = ?3 WHERE id = ?2",
        params![note, id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_tags(conn: &Connection, id: i64, tags: &[String]) -> Result<Vec<String>, String> {
    let mut clean: Vec<String> = tags
        .iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    clean.sort_by_key(|tag| tag.to_lowercase());
    clean.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    clean.truncate(20);
    let json = serde_json::to_string(&clean).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE games SET tags = ?1, tags_ts = ?3, updated_ts = ?3 WHERE id = ?2",
        params![json, id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(clean)
}

pub(crate) fn delete_game_rows(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM puzzle_attempts
         WHERE puzzle_id IN (
             SELECT id FROM puzzles WHERE source = 'own' AND source_game_id = ?1
         )",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM puzzles WHERE source = 'own' AND source_game_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM move_evals WHERE game_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM positions WHERE game_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM games WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Löscht eine Partie samt lokal abgeleiteten Daten und merkt den Natural Key,
/// damit die Löschung beim nächsten Gerätesync weitergegeben wird.
pub fn delete_game(conn: &mut Connection, id: i64) -> Result<bool, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let key: Option<(String, String)> = tx
        .query_row(
            "SELECT source, source_id FROM games WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let Some((source, source_id)) = key else {
        return Ok(false);
    };
    tx.execute(
        "INSERT INTO game_tombstones (source, source_id, deleted_ts) VALUES (?1, ?2, ?3)
         ON CONFLICT(source, source_id) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
        params![source, source_id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    delete_game_rows(&tx, id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

const GAME_SUMMARY_COLUMNS: &str =
    "id, source, url, played_at, played_ts, time_class, color, my_name, opponent,
     opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
     accuracy_opening, accuracy_middlegame, accuracy_endgame,
     opponent_accuracy, opponent_accuracy_opening, opponent_accuracy_middlegame,
     opponent_accuracy_endgame, tags, analyzed, analysis_excluded,
     CASE WHEN TRIM(moves) != '' THEN 1 ELSE 0 END,
     CASE WHEN TRIM(note) != '' THEN 1 ELSE 0 END,
     termination";

fn game_summary_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GameSummary> {
    Ok(GameSummary {
        id: row.get(0)?,
        source: row.get(1)?,
        url: row.get(2)?,
        played_at: row.get(3)?,
        played_ts: row.get(4)?,
        time_class: row.get(5)?,
        color: row.get(6)?,
        my_name: row.get(7)?,
        opponent: row.get(8)?,
        opp_elo: row.get(9)?,
        my_elo: row.get(10)?,
        result: row.get(11)?,
        opening: row.get(12)?,
        eco: row.get(13)?,
        moves_count: row.get(14)?,
        accuracy: row.get(15)?,
        accuracy_opening: row.get(16)?,
        accuracy_middlegame: row.get(17)?,
        accuracy_endgame: row.get(18)?,
        opponent_accuracy: row.get(19)?,
        opponent_accuracy_opening: row.get(20)?,
        opponent_accuracy_middlegame: row.get(21)?,
        opponent_accuracy_endgame: row.get(22)?,
        tags: serde_json::from_str(&row.get::<_, String>(23)?).unwrap_or_default(),
        analyzed: row.get::<_, i64>(24)? != 0,
        analysis_excluded: row.get::<_, i64>(25)? != 0,
        has_moves: row.get::<_, i64>(26)? != 0,
        has_note: row.get::<_, i64>(27)? != 0,
        termination: row.get(28)?,
    })
}

pub fn list_game_summaries(conn: &Connection) -> Result<Vec<GameSummary>, String> {
    let sql = format!(
        "SELECT {GAME_SUMMARY_COLUMNS}
         FROM games ORDER BY played_ts DESC, played_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], game_summary_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_game(conn: &Connection, id: i64) -> Result<GameRecord, String> {
    conn.query_row(
        "SELECT id, source, source_id, url, played_at, played_ts, time_class, color, my_name, opponent,
                opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                accuracy_opening, accuracy_middlegame, accuracy_endgame,
                opponent_accuracy, opponent_accuracy_opening,
                opponent_accuracy_middlegame, opponent_accuracy_endgame, moves,
                note, tags, analyzed, analysis_excluded, clocks, time_control, termination,
                verdict
         FROM games WHERE id = ?1",
        params![id],
        |r| {
            Ok(GameRecord {
                id: r.get(0)?, source: r.get(1)?, source_id: r.get(2)?, url: r.get(3)?,
                played_at: r.get(4)?, played_ts: r.get(5)?, time_class: r.get(6)?,
                color: r.get(7)?, my_name: r.get(8)?, opponent: r.get(9)?, opp_elo: r.get(10)?,
                my_elo: r.get(11)?, result: r.get(12)?, opening: r.get(13)?, eco: r.get(14)?,
                moves_count: r.get(15)?, accuracy: r.get(16)?, accuracy_opening: r.get(17)?,
                accuracy_middlegame: r.get(18)?, accuracy_endgame: r.get(19)?,
                opponent_accuracy: r.get(20)?, opponent_accuracy_opening: r.get(21)?,
                opponent_accuracy_middlegame: r.get(22)?, opponent_accuracy_endgame: r.get(23)?,
                moves: r.get(24)?, note: r.get(25)?,
                tags: serde_json::from_str(&r.get::<_, String>(26)?).unwrap_or_default(),
                analyzed: r.get::<_, i64>(27)? != 0,
                analysis_excluded: r.get::<_, i64>(28)? != 0,
                clocks: r.get(29)?, time_control: r.get(30)?, termination: r.get(31)?,
                verdict: r.get(32)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn list_games_page(conn: &Connection, request: &GamePageRequest) -> Result<GamePage, String> {
    const WHERE: &str = "WHERE (?1 = '' OR source = ?1)
           AND (?2 = '' OR result = ?2)
           AND (?3 = '' OR time_class = ?3)
           AND (?4 = '' OR (played_ts > 0 AND played_ts >= ?5 AND played_ts < ?6)
                OR (played_ts <= 0 AND played_at = ?4))
           AND (?7 = '' OR opponent = ?7)
           AND (?8 = '' OR opening = ?8 OR (?8 = char(8212) AND opening = ''))
           AND (?9 = '' OR instr(lower(opponent), lower(?9)) > 0
                OR instr(lower(opening), lower(?9)) > 0
                OR instr(lower(tags), lower(?9)) > 0)
           AND (?10 = 0 OR (played_ts > 0 AND played_ts >= ?10)
                OR (played_ts <= 0 AND played_at >= date(?10, 'unixepoch')))
           AND (?11 = '' OR color = ?11)
           AND (?12 = '' OR eco = ?12)";
    let total = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM games {WHERE}"),
            params![
                request.source,
                request.result,
                request.time_class,
                request.played_day,
                request.played_from,
                request.played_to,
                request.opponent,
                request.opening,
                request.query,
                request.since,
                request.color,
                request.eco
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let library_total = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {GAME_SUMMARY_COLUMNS} FROM games {WHERE}
         ORDER BY played_ts DESC, played_at DESC, id DESC LIMIT ?13 OFFSET ?14"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![
                request.source,
                request.result,
                request.time_class,
                request.played_day,
                request.played_from,
                request.played_to,
                request.opponent,
                request.opening,
                request.query,
                request.since,
                request.color,
                request.eco,
                request.limit.clamp(1, 100),
                request.offset.max(0)
            ],
            game_summary_from_row,
        )
        .map_err(|e| e.to_string())?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(GamePage {
        items,
        total,
        library_total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(source_id: &str) -> GameRecord {
        GameRecord {
            verdict: String::new(),
            id: None,
            source: "lichess".into(),
            source_id: source_id.into(),
            url: format!("https://lichess.org/{source_id}"),
            played_at: "2026-07-11".into(),
            played_ts: 1_783_769_082,
            time_class: "rapid".into(),
            color: "white".into(),
            my_name: "Torim98".into(),
            opponent: "PagasusFantasy".into(),
            opp_elo: 1203,
            my_elo: 1076,
            result: "loss".into(),
            opening: "Caro-Kann Defense".into(),
            eco: "B10".into(),
            moves_count: 32,
            accuracy: None,
            accuracy_opening: None,
            accuracy_middlegame: None,
            accuracy_endgame: None,
            opponent_accuracy: None,
            opponent_accuracy_opening: None,
            opponent_accuracy_middlegame: None,
            opponent_accuracy_endgame: None,
            moves: "e4 c6 Qf3 e5".into(),
            clocks: "59500 59300 58800 58100".into(),
            time_control: "600+0".into(),
            termination: String::new(),
            note: String::new(),
            tags: Vec::new(),
            analyzed: false,
            analysis_excluded: false,
        }
    }

    #[test]
    fn upsert_inserts_then_updates_without_touching_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        let mut tagged = sample("def");
        tagged.note = "Imported PGN note".into();
        tagged.tags = vec!["OTB".into(), "Club".into()];
        let r1 = upsert_games(&mut conn, &[sample("abc"), tagged]).unwrap();
        assert_eq!(r1.inserted, 2);
        assert_eq!(r1.total, 2);

        let games = list_games(&conn).unwrap();
        let imported = games.iter().find(|g| g.source_id == "def").unwrap();
        assert_eq!(imported.note, "Imported PGN note");
        assert_eq!(imported.tags, vec!["OTB", "Club"]);
        let cleaned = set_tags(
            &conn,
            imported.id.unwrap(),
            &[" club ".into(), "CLUB".into(), "Turnier".into()],
        )
        .unwrap();
        assert_eq!(cleaned, vec!["club", "Turnier"]);
        let id = games[0].id.unwrap();
        set_note(&conn, id, "Merken: Cb6!").unwrap();

        // Re-Import derselben Partie mit jetzt vorhandener Accuracy
        let mut updated = sample("abc");
        updated.accuracy = Some(84.2);
        updated.opponent_accuracy = Some(77.6);
        updated.opponent_accuracy_opening = Some(81.3);
        let r2 = upsert_games(&mut conn, &[updated, sample("ghi")]).unwrap();
        assert_eq!(r2.inserted, 1, "abc existierte schon, nur ghi ist neu");
        assert_eq!(r2.total, 3);

        let games = list_games(&conn).unwrap();
        let abc = games.iter().find(|g| g.source_id == "abc").unwrap();
        assert_eq!(abc.accuracy, Some(84.2), "Accuracy aktualisiert");
        assert_eq!(
            abc.opponent_accuracy,
            Some(77.6),
            "Gegner-Accuracy aktualisiert"
        );
        assert_eq!(
            abc.opponent_accuracy_opening,
            Some(81.3),
            "Gegner-Phase aktualisiert"
        );
        let noted = games.iter().find(|g| g.id == Some(id)).unwrap();
        assert_eq!(noted.note, "Merken: Cb6!", "Notiz überlebt den Re-Import");
    }

    #[test]
    fn delete_game_removes_derived_rows_but_keeps_other_games() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        upsert_games(&mut conn, &[sample("delete-me"), sample("keep-me")]).unwrap();
        let id = list_games(&conn)
            .unwrap()
            .into_iter()
            .find(|game| game.source_id == "delete-me")
            .and_then(|game| game.id)
            .unwrap();

        conn.execute(
            "INSERT INTO move_evals (game_id, ply) VALUES (?1, 1)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO positions (fen_key, game_id, ply) VALUES ('fen', ?1, 1)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzles
             (id, fen, moves, rating, source, source_game_id, setup_plies)
             VALUES ('own:test', 'fen', 'e2e4', 1200, 'own', ?1, 0)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after)
             VALUES ('own:test', 1, 1, 1200, 1210)",
            [],
        )
        .unwrap();

        assert!(delete_game(&mut conn, id).unwrap());
        assert_eq!(list_games(&conn).unwrap().len(), 1);
        for table in ["move_evals", "positions", "puzzles", "puzzle_attempts"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "derived rows remain in {table}");
        }
        assert!(!delete_game(&mut conn, id).unwrap());
    }

    #[test]
    fn init_migrates_once_and_records_schema_version() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        conn.execute(
            "INSERT INTO study_events
             (template_id, day, created_ts, updated_ts) VALUES (1, '2026-08-12', 42, 0)",
            [],
        )
        .unwrap();
        init(&conn).unwrap();

        let updated_ts: i64 = conn
            .query_row("SELECT updated_ts FROM study_events", [], |row| row.get(0))
            .unwrap();
        let templates: i64 = conn
            .query_row("SELECT COUNT(*) FROM study_templates", [], |row| row.get(0))
            .unwrap();
        assert_eq!(updated_ts, 0, "one-time backfill ran again");
        assert_eq!(templates, DEFAULT_STUDY_TEMPLATES.len() as i64);
        for index in [
            "idx_games_played_ts",
            "idx_games_analysis_queue",
            "idx_puzzle_attempts_ts",
            "idx_endgame_attempts_ts",
            "idx_rep_nodes_due",
            "idx_study_events_completed",
        ] {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1)",
                    params![index],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "missing performance index {index}");
        }
    }

    /// Der Cache einer älteren Fassung verfällt beim Wechsel der Engine.
    ///
    /// Er ist reine Beschleunigung, und seine Zahlen stammen aus einer
    /// Stockfish-Fassung, die niemand mehr benennen kann. Stehen zu bleiben
    /// hieße, sie einem neuen Lauf unterzuschieben — die Wanderung wirft sie
    /// deshalb weg. Was die Analyse selbst ergeben hat, steht in `move_evals`
    /// und bleibt.
    #[test]
    fn migration_drops_evaluations_without_an_engine() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE eval_cache (
                fen_key  TEXT PRIMARY KEY,
                eval_cp  INTEGER,
                mate_in  INTEGER,
                best_uci TEXT NOT NULL DEFAULT '',
                depth    INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO eval_cache (fen_key, eval_cp, best_uci, depth)
             VALUES ('alt', 20, 'e2e4', 18);
             CREATE TABLE move_evals (
                game_id  INTEGER NOT NULL,
                ply      INTEGER NOT NULL,
                san      TEXT NOT NULL DEFAULT '',
                eval_cp  INTEGER,
                mate_in  INTEGER,
                best_uci TEXT NOT NULL DEFAULT '',
                judgment TEXT NOT NULL DEFAULT '',
                phase    TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (game_id, ply)
             );
             INSERT INTO move_evals (game_id, ply, san, eval_cp)
             VALUES (1, 1, 'e4', 20);
             PRAGMA user_version = 20;",
        )
        .unwrap();

        init(&conn).unwrap();

        assert!(column_exists(&conn, "eval_cache", "engine").unwrap());
        let cached: i64 = conn
            .query_row("SELECT COUNT(*) FROM eval_cache", [], |row| row.get(0))
            .unwrap();
        assert_eq!(cached, 0, "Werte ohne Herkunft bleiben nicht liegen");
        // Die Ergebnisse der Partien sind kein Cache.
        let moves: i64 = conn
            .query_row("SELECT COUNT(*) FROM move_evals", [], |row| row.get(0))
            .unwrap();
        assert_eq!(moves, 1, "die Analyse selbst bleibt unberührt");
    }

    #[test]
    fn init_upgrades_v15_before_running_v16_game_queries() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                source_id TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                played_at TEXT NOT NULL DEFAULT '',
                time_class TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                opponent TEXT NOT NULL DEFAULT '',
                opp_elo INTEGER NOT NULL DEFAULT 0,
                my_elo INTEGER NOT NULL DEFAULT 0,
                result TEXT NOT NULL DEFAULT '',
                opening TEXT NOT NULL DEFAULT '',
                eco TEXT NOT NULL DEFAULT '',
                moves_count INTEGER NOT NULL DEFAULT 0,
                accuracy REAL,
                moves TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                analyzed INTEGER NOT NULL DEFAULT 0,
                UNIQUE(source, source_id)
             );
             INSERT INTO games (source, source_id, played_at, opponent)
             VALUES ('lichess', 'v15-game', '2026-08-12', 'Existing player');
             PRAGMA user_version = 15;",
        )
        .unwrap();

        init(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(column_exists(&conn, "games", "termination").unwrap());
        assert!(column_exists(&conn, "rep_nodes", "sort_order").unwrap());
        assert!(column_exists(&conn, "study_templates", "area").unwrap());
        assert!(column_exists(&conn, "study_templates", "i18n_key").unwrap());

        let study_sessions_exist: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'table' AND name = 'study_sessions'
                 )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(study_sessions_exist);

        let page = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 10,
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(page.library_total, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].opponent, "Existing player");
    }

    #[test]
    fn read_heavy_queries_keep_using_their_performance_indexes() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        let cases = [
            (
                "idx_games_played_ts",
                "SELECT id FROM games ORDER BY played_ts DESC, played_at DESC, id DESC LIMIT 25",
            ),
            (
                "idx_games_analysis_queue",
                "SELECT id FROM games WHERE analysis_excluded = 0 AND analyzed = 0 ORDER BY played_ts",
            ),
            (
                "idx_puzzle_attempts_ts",
                "SELECT id FROM puzzle_attempts WHERE ts >= 1 ORDER BY ts",
            ),
            (
                "idx_endgame_attempts_ts",
                "SELECT id FROM endgame_attempts WHERE ts >= 1 ORDER BY ts",
            ),
            (
                "idx_rep_nodes_due",
                "SELECT id FROM rep_nodes WHERE due_ts <= 1 ORDER BY due_ts",
            ),
            (
                "idx_study_events_completed",
                "SELECT id FROM study_events WHERE completed = 1 AND deleted = 0 AND completed_ts >= 1 ORDER BY completed_ts",
            ),
        ];
        for (index, query) in cases {
            let mut stmt = conn
                .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
                .unwrap();
            let plan = stmt
                .query_map([], |row| row.get::<_, String>(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
                .join("\n");
            assert!(plan.contains(index), "{index} is no longer used:\n{plan}");
        }
    }

    #[test]
    fn game_lists_are_lightweight_paginated_and_details_stay_complete() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let first = sample("first");
        let mut second = sample("second");
        second.time_class = "blitz".into();
        second.opponent = "Other player".into();
        second.played_ts -= 60;
        upsert_games(&mut conn, &[first, second]).unwrap();
        let first_id = list_games(&conn).unwrap()[0].id.unwrap();
        set_note(&conn, first_id, "Remember this position").unwrap();

        let summaries = list_game_summaries(&conn).unwrap();
        assert_eq!(summaries.len(), 2);
        assert!(summaries[0].has_moves);
        assert!(summaries[0].has_note);

        let page = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                time_class: "rapid".into(),
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.library_total, 2);
        assert_eq!(page.items[0].id, first_id);

        // Der Zeitraum-Filter greift ueber `played_ts`: Die Untergrenze laesst
        // die juengere Partie stehen und schneidet die eine Minute aeltere ab.
        let seit = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                since: 1_783_769_082,
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(seit.total, 1);
        assert_eq!(seit.items[0].id, first_id);

        // Farbe und ECO schraenken wie die uebrigen Exakt-Filter ein · beide
        // kommen aus einem Klick in der Partienzeile.
        let weiss = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                color: "white".into(),
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(weiss.total, 2);
        let schwarz = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                color: "black".into(),
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(schwarz.total, 0);
        let eco = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                eco: sample("first").eco,
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(eco.total, 2);
        let fremd = list_games_page(
            &conn,
            &GamePageRequest {
                limit: 25,
                eco: "Z99".into(),
                ..GamePageRequest::default()
            },
        )
        .unwrap();
        assert_eq!(fremd.total, 0);

        let detail = get_game(&conn, first_id).unwrap();
        assert_eq!(detail.moves, "e4 c6 Qf3 e5");
        assert_eq!(detail.note, "Remember this position");
        assert_eq!(detail.clocks, "59500 59300 58800 58100");
    }

    #[test]
    fn init_upgrades_an_unversioned_legacy_database_without_losing_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL,
                source_id TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                played_at TEXT NOT NULL DEFAULT '',
                time_class TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                opponent TEXT NOT NULL DEFAULT '',
                opp_elo INTEGER NOT NULL DEFAULT 0,
                my_elo INTEGER NOT NULL DEFAULT 0,
                result TEXT NOT NULL DEFAULT '',
                opening TEXT NOT NULL DEFAULT '',
                eco TEXT NOT NULL DEFAULT '',
                moves_count INTEGER NOT NULL DEFAULT 0,
                accuracy REAL,
                moves TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                analyzed INTEGER NOT NULL DEFAULT 0,
                UNIQUE(source, source_id)
             );
             INSERT INTO games (source, source_id, opponent)
             VALUES ('legacy', 'kept', 'Player');",
        )
        .unwrap();

        init(&conn).unwrap();

        let game = list_games(&conn).unwrap().pop().unwrap();
        assert_eq!(game.source_id, "kept");
        assert!(column_exists(&conn, "games", "opponent_accuracy_endgame").unwrap());
        assert!(column_exists(&conn, "study_events", "series_key").unwrap());
    }
}
