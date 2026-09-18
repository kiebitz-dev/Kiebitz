//! Eigene Referenzdatenbank · die große Fremdsammlung neben den eigenen Partien.
//!
//! Wer heute eine Mega Database, Caissabase oder die wöchentliche TWIC-Ausgabe
//! besitzt, hat damit genau das, was Kiebitz bisher fehlte: Millionen fremder
//! Partien als Vergleichsmaßstab. Dieses Modul liest so eine Sammlung ein und
//! macht daraus zweierlei — eine Häufigkeitsstatistik je Stellung (das „Buch")
//! und einen Vorrat an Musterpartien.
//!
//! Drei Entscheidungen, die den Rest erklären:
//!
//! **Eigene Datei.** Die Referenz liegt in `reference.sqlite` neben der
//! `kiebitz.db`, nicht darin. Eine Fremdsammlung kann ein Vielfaches der
//! eigenen Datenbank wiegen; sie hat in einer Datei, die gesichert, gesynct und
//! auf das Handy getragen wird, nichts verloren. Löschen ist so auch nur ein
//! Dateilöschen und kann die eigenen Partien gar nicht erst treffen.
//!
//! **Getrennt von `games`.** Fremdpartien dürfen niemals in die eigene
//! Partientabelle. Sonst zählten vier Millionen fremde Partien in Insights, im
//! Ratingverlauf, in der Analyse-Warteschlange und in den eigenen Puzzles mit ·
//! aus einem Werkzeug für die eigene Entwicklung würde eine Suchmaschine.
//!
//! **Buch statt Archiv.** Für die Frage „was wird hier gespielt?" ist die
//! Partienliste das falsche Format. Der Import verdichtet jede Partie beim
//! Lesen zu Zeilen der Form (Stellung, Zug) → Weiß/Remis/Schwarz, Elo-Schnitt,
//! beste Beispielpartie. Danach ist die Auskunft eine einzige indizierte
//! Abfrage, egal wie groß die Sammlung war.

use crate::{chess, explorer::ExplorerGame, explorer::ExplorerMove, explorer::ExplorerResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Bis zu welchem Halbzug eine Partie ins Buch einzahlt.
///
/// Ab hier wird aus Statistik Einzelfall: Eine Stellung im 16. Zug kommt in
/// einer Millionensammlung meist genau einmal vor, und eine Zeile „1 Partie,
/// 100 % Weiß" ist keine Auskunft. Die Grenze hält zugleich die Datenbank
/// klein · sie ist der einzige Hebel, der linear auf Größe und Importdauer
/// wirkt. Die Partien selbst werden vollständig gespeichert, nur das Buch
/// endet hier.
const BOOK_PLIES: usize = 24;

/// Partien je Schreibblock. Innerhalb eines Blocks fasst eine Hashmap gleiche
/// Stellungen zusammen · in der Eröffnung sind das die meisten. Größere Blöcke
/// sparen Schreibarbeit, kosten aber Arbeitsspeicher.
///
/// Vier Millionen Partien ergeben ein Buch mit zweistelligen Millionen Zeilen,
/// und `ref_book` ist ein B-Baum über einen Textschlüssel: Jede Zeile landet an
/// einer zufälligen Stelle darin. Je mehr Partien ein Block umfasst, desto mehr
/// davon fallen schon im Arbeitsspeicher zusammen und desto weniger Seiten muss
/// die Platte für dieselbe Menge Buch anfassen. Zwanzigtausend Partien sind
/// dabei rund hundert Megabyte Hashmap — auf dem Desktop unauffällig, auf dem
/// Telefon nicht, deshalb der kleinere Wert dort.
const fn flush_games() -> u64 {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        4_000
    } else {
        20_000
    }
}

/// Seitenpuffer von SQLite während des Imports, in Kibibyte (negativ = KiB).
///
/// Der Vorgabewert von zwei Megabyte reicht für einen B-Baum von mehreren
/// Gigabyte nicht annähernd; jede Buchzeile kostet dann eine eigene Lese- und
/// Schreibrunde auf die Platte. Ein halbes Gigabyte Puffer hält den oberen Teil
/// des Baums dauerhaft im Speicher, und genau dort spielt sich die Suche ab.
const fn import_cache_kib() -> i32 {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        -64_000
    } else {
        -512_000
    }
}

/// So oft meldet der Import seinen Fortschritt an die Oberfläche.
const PROGRESS_GAMES: u64 = 2_000;

/// Bis zu wie vielen Partien der Bestand für die Doppelungsprüfung in den
/// Arbeitsspeicher passt.
///
/// Ein Fingerabdruck sind acht Byte, die Hashmenge braucht mit Verwaltung rund
/// elf · dreißig Millionen Partien sind damit etwa dreihundert Megabyte, neben
/// dem halben Gigabyte Seitenpuffer des Imports gerade noch vertretbar. Darüber
/// wird die Prüfung übersprungen: eine übersehene Doppelung kostet eine Zeile
/// zu viel im Buch, ein erschöpfter Arbeitsspeicher den ganzen Import.
const fn dedup_limit() -> u64 {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        2_000_000
    } else {
        30_000_000
    }
}

/// Musterpartien je Stellung in der Antwort.
const TOP_GAMES: usize = 6;

#[derive(Default)]
pub struct RefDbState {
    pub importing: AtomicBool,
    pub cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
pub struct RefDbStatus {
    /// Partien in der Referenzdatenbank.
    pub games: i64,
    /// Zeilen im Buch (Stellung + Zug).
    pub positions: i64,
    /// Dateigröße in Bytes.
    pub size_bytes: u64,
    /// Zuletzt eingelesene Datei (Anzeige).
    pub source: String,
    /// Unix-Zeit des letzten Imports.
    pub imported_at: i64,
    pub importing: bool,
    pub path: String,
    /// Die einzeln eingelesenen Sammlungen · siehe `ref_sources`.
    pub sources: Vec<RefSource>,
}

/// Eine eingelesene Sammlung · eine Zeile der Liste in den Einstellungen.
///
/// `first_id`/`last_id` sind kein Anzeigewert, sondern der Grund, warum sich
/// eine einzelne Sammlung wieder herauslösen lässt: Partien bekommen ihre
/// Kennung fortlaufend, ein Import belegt deshalb einen zusammenhängenden
/// Block. Damit ist „welche Partien stammen von hier?" ein Bereich im
/// Primärschlüssel und keine Suche über zwölf Millionen Zeilen.
#[derive(Serialize, Clone)]
pub struct RefSource {
    pub id: i64,
    /// Dateiname beim Import · unterscheidet die Sammlungen in der Liste.
    pub name: String,
    /// Vollständiger Pfad beim Import · sagt, welche von zwei gleichnamigen.
    pub path: String,
    pub games: i64,
    pub imported_at: i64,
}

#[derive(Serialize, Clone)]
struct ImportProgress {
    games: u64,
    bytes: u64,
    bytes_total: u64,
    /// Partien insgesamt, wenn die Arbeit in Partien zählt (Prüfen, Entfernen).
    games_total: u64,
    /// "scanning" · "reading" · "finishing" · "removing"
    phase: String,
}

#[derive(Serialize, Clone)]
struct ImportDone {
    games: u64,
    /// Bestand nach dem Lauf.
    total: i64,
    /// Partien, die die Quelle enthielt, die aber nicht übernommen wurden ·
    /// bei `.db3` die, deren Zugfolge sich nicht zweifelsfrei nachspielen ließ.
    skipped: u64,
    /// Partien, die schon in der Referenzdatenbank standen · übersprungen.
    duplicates: u64,
    /// "import" · "delete" — dieselbe Meldung, zwei Anlässe.
    action: String,
    cancelled: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct RefGame {
    pub id: i64,
    pub white: String,
    pub black: String,
    pub white_elo: i32,
    pub black_elo: i32,
    pub result: String,
    pub played_at: String,
    pub event: String,
    pub eco: String,
    pub moves: String,
}

// ── Datei und Schema ─────────────────────────────────────────────────────────

/// Die Referenzdatei liegt neben der Hauptdatenbank · verlegt der Nutzer die
/// eine, wandert die andere mit.
pub fn ref_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let main = app
        .state::<crate::analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let dir = main
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Kein Datenverzeichnis".to_string())?;
    Ok(dir.join("reference.sqlite"))
}

/// Nur lesend öffnen · für Abfragen, die nichts anlegen und nichts umziehen.
///
/// `open` legt fehlende Tabellen an und übernimmt Altbestände; das ist beim
/// Import und in der Buchkarte richtig, bei der Buchtiefe einer Partie
/// (`book.rs`) aber ein Schreibzugriff auf eine Zehn-Gigabyte-Datei für eine
/// reine Nachfrage.
pub(crate) fn open_readonly(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "busy_timeout", "10000");
    Ok(conn)
}

fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024);
    let _ = conn.pragma_update(None, "busy_timeout", "10000");
    init_schema(&conn)?;
    adopt_legacy(&conn);
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ref_games (
            id        INTEGER PRIMARY KEY,
            white     TEXT NOT NULL DEFAULT '',
            black     TEXT NOT NULL DEFAULT '',
            white_elo INTEGER NOT NULL DEFAULT 0,
            black_elo INTEGER NOT NULL DEFAULT 0,
            result    TEXT NOT NULL DEFAULT '',
            played_at TEXT NOT NULL DEFAULT '',
            event     TEXT NOT NULL DEFAULT '',
            eco       TEXT NOT NULL DEFAULT '',
            moves     TEXT NOT NULL DEFAULT ''
        );

        -- Das Buch: je Stellung und Zug die Bilanz aus allen Partien, die ihn
        -- gespielt haben. `game_id` zeigt auf die bestbesetzte davon, `best_elo`
        -- ist der Schnitt, an dem sich dieser Titel entscheidet.
        CREATE TABLE IF NOT EXISTS ref_book (
            fen_key  TEXT NOT NULL,
            san      TEXT NOT NULL,
            white    INTEGER NOT NULL DEFAULT 0,
            draws    INTEGER NOT NULL DEFAULT 0,
            black    INTEGER NOT NULL DEFAULT 0,
            elo_sum  INTEGER NOT NULL DEFAULT 0,
            elo_n    INTEGER NOT NULL DEFAULT 0,
            best_elo INTEGER NOT NULL DEFAULT 0,
            game_id  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (fen_key, san)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS ref_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Je eingelesener Datei eine Zeile. Sie ist das, was der Nutzer in den
        -- Einstellungen sieht und einzeln wieder loswerden kann.
        CREATE TABLE IF NOT EXISTS ref_sources (
            id          INTEGER PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            path        TEXT NOT NULL DEFAULT '',
            games       INTEGER NOT NULL DEFAULT 0,
            first_id    INTEGER NOT NULL DEFAULT 0,
            last_id     INTEGER NOT NULL DEFAULT 0,
            imported_at INTEGER NOT NULL DEFAULT 0
        );",
    )
    .map_err(|e| format!("Referenz-Schema fehlgeschlagen: {e}"))?;

    // `ref_games` gab es vor den Sammlungen. Eine Spalte anzuhängen kostet in
    // SQLite nur einen Schemaeintrag und keine einzige Zeile — bei zwölf
    // Millionen Partien ist das der Unterschied zwischen sofort und Minuten.
    let has_source = conn
        .prepare("SELECT source_id FROM ref_games LIMIT 0")
        .is_ok();
    if !has_source {
        conn.execute_batch(
            "ALTER TABLE ref_games ADD COLUMN source_id INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(|e| format!("Referenz-Schema fehlgeschlagen: {e}"))?;
    }
    Ok(())
}

/// Was vor den Sammlungen eingelesen wurde, bekommt nachträglich eine.
///
/// Die alten Partien tragen `source_id = 0` · das ist der Vorgabewert der
/// gerade angehängten Spalte, kein `UPDATE` über Millionen Zeilen. Ihr Bereich
/// ist deshalb genau `1 … MAX(id)`, und weil Kennungen lückenlos vergeben
/// werden, ist `MAX(id)` zugleich ihre Anzahl. Alles hier ist ein Blick in den
/// Primärschlüssel; nichts davon liest eine Zeile.
fn adopt_legacy(conn: &Connection) {
    let sources: i64 = conn
        .query_row("SELECT COUNT(*) FROM ref_sources", [], |r| r.get(0))
        .unwrap_or(0);
    if sources > 0 {
        return;
    }
    let last_id: i64 = conn
        .query_row("SELECT COALESCE(MAX(id), 0) FROM ref_games", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    if last_id == 0 {
        return;
    }
    let name = meta_get(conn, "source");
    let imported_at = meta_get(conn, "imported_at").parse::<i64>().unwrap_or(0);
    let _ = conn.execute(
        "INSERT OR IGNORE INTO ref_sources (id, name, path, games, first_id, last_id, imported_at)
         VALUES (0, ?1, '', ?2, 1, ?2, ?3)",
        params![name, last_id, imported_at],
    );
}

fn meta_get(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM ref_meta WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_default()
}

fn meta_set(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO ref_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    );
}

/// Bestand zählen und die Zahlen merken.
///
/// `SELECT COUNT(*)` ist in SQLite ein vollständiger Durchlauf, und `ref_book`
/// ist bei einer Millionensammlung mehrere Gigabyte groß — auf der Festplatte
/// sind das zweistellige Sekunden. Der Einstellungsbereich fragt den Bestand
/// aber bei jedem Öffnen ab, und solange das im Hauptthread lief, stand
/// währenddessen die ganze App. Gezählt wird deshalb genau dann, wenn sich der
/// Bestand ändert: nach einem Import und nach dem Löschen.
fn count_and_remember(conn: &Connection) -> i64 {
    let games: i64 = conn
        .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
        .unwrap_or(0);
    let positions: i64 = conn
        .query_row("SELECT COUNT(*) FROM ref_book", [], |r| r.get(0))
        .unwrap_or(0);
    meta_set(conn, "games", &games.to_string());
    meta_set(conn, "positions", &positions.to_string());
    games
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Die Sammlungen, neueste zuerst.
fn source_list(conn: &Connection) -> Vec<RefSource> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, path, games, imported_at FROM ref_sources
         ORDER BY imported_at DESC, id DESC",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |r| {
        Ok(RefSource {
            id: r.get(0)?,
            name: r.get(1)?,
            path: r.get(2)?,
            games: r.get(3)?,
            imported_at: r.get(4)?,
        })
    });
    match rows {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

// ── Doppelte Partien ─────────────────────────────────────────────────────────

/// Fingerabdruck einer Partie · zwei Partien mit demselben sind dieselbe.
///
/// Genommen wird, was eine Partie ausmacht und in jeder Quelle gleich
/// geschrieben steht: die beiden Namen, das Datum, das Ergebnis und die
/// vollständige Zugfolge. Der Zugtext allein genügte nicht — dieselbe kurze
/// Remispartie kommt in einer Millionensammlung dutzendfach vor, gespielt von
/// verschiedenen Leuten.
///
/// FNV-1a, weil es hier nur auf zwei Dinge ankommt: Streuung über 64 Bit und
/// Tempo. Bei zwölf Millionen Partien liegt die Wahrscheinlichkeit einer
/// zufälligen Kollision bei rund eins zu zweihundertfünfzigtausend — und eine
/// Kollision kostet eine übersprungene Partie, nicht die Datenbank.
fn game_hash(white: &str, black: &str, date: &str, result: &str, moves: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            hash ^= *b as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for part in [white, black, date, result, moves] {
        eat(part.as_bytes());
        eat(&[0]);
    }
    hash
}

/// Fingerabdrücke des Bestands, einmal vor dem Import.
///
/// Der Alternativweg wäre eine Spalte mit Index gewesen. Der scheitert am
/// Bestand: eine Spalte nachträglich zu füllen schreibt die ganze Tabelle neu,
/// und ohne gefüllte Spalte erkennt der Index Doppelungen gegen alles, was vor
/// der Umstellung eingelesen wurde, gerade nicht. Ein einmaliger Lesedurchlauf
/// je Import kostet dagegen nichts, was der Import nicht ohnehin kostet, und
/// erfasst den gesamten Bestand.
fn load_hashes(
    conn: &Connection,
    known: u64,
    progress: &mut impl FnMut(u64, u64, &str),
) -> Result<HashSet<u64>, String> {
    if known > dedup_limit() {
        log::warn!(
            "Referenz-Import: {known} Partien im Bestand · Doppelungsprüfung nur innerhalb der Datei"
        );
        return Ok(HashSet::new());
    }
    let mut seen: HashSet<u64> = HashSet::with_capacity(known.min(dedup_limit()) as usize + 1024);
    let mut stmt = conn
        .prepare("SELECT white, black, played_at, result, moves FROM ref_games")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut read: u64 = 0;
    let mut last: u64 = 0;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let white: String = row.get(0).unwrap_or_default();
        let black: String = row.get(1).unwrap_or_default();
        let date: String = row.get(2).unwrap_or_default();
        let result: String = row.get(3).unwrap_or_default();
        let moves: String = row.get(4).unwrap_or_default();
        seen.insert(game_hash(&white, &black, &date, &result, &moves));
        read += 1;
        if read - last >= PROGRESS_GAMES * 10 {
            last = read;
            progress(read, known.max(read), "scanning");
        }
    }
    Ok(seen)
}

// ── Buchzeilen einer Partie ──────────────────────────────────────────────────

/// Läuft die Buchzüge einer Partie ab · einmal geschrieben, zweimal gebraucht.
///
/// Der Import addiert damit, das Entfernen einer Sammlung subtrahiert damit.
/// Beide müssen exakt dieselben Zeilen treffen, sonst bliebe nach einem
/// Entfernen eine Bilanz stehen, die es nie gab · deshalb steht der Weg durch
/// die Partie hier und nicht zweimal.
fn for_each_book_row(sans: &[String], key: &mut String, mut each: impl FnMut(&str)) {
    let mut pos = chess::Position::initial();
    for san in sans.iter().take(BOOK_PLIES) {
        let mv = match chess::parse_san(&pos, san) {
            Ok(mv) => mv,
            // Ein unlesbarer Zug beendet nur diese Partie · eine
            // Millionensammlung enthält immer ein paar kaputte.
            Err(_) => break,
        };
        key.clear();
        chess::fen_key_into(&pos, key);
        key.push(KEY_SEP);
        key.push_str(san);
        each(key);
        pos = match pos.make_move(mv) {
            Ok(next) => next,
            Err(_) => break,
        };
    }
}

/// Ergebnis → Spalte im Buch. `None` heißt „zahlt nicht ein".
///
/// Eine Partie ohne Ergebnis hätte in keiner der drei Spalten etwas zu suchen.
/// Gespeichert wird sie trotzdem, als Musterpartie taugt sie.
fn result_bucket(result: &str) -> Option<u8> {
    match result {
        "1-0" => Some(0),
        "0-1" => Some(2),
        "1/2-1/2" | "½-½" => Some(1),
        _ => None,
    }
}

// ── PGN lesen ────────────────────────────────────────────────────────────────

/// Eine gelesene Partie, so wie sie aus der Quelldatei kommt.
pub struct RawGame {
    pub white: String,
    pub black: String,
    pub white_elo: i32,
    pub black_elo: i32,
    pub result: String,
    pub date: String,
    pub event: String,
    pub eco: String,
    /// Zugtext der Hauptvariante, SAN durch Leerzeichen getrennt.
    pub sans: Vec<String>,
}

impl RawGame {
    fn empty() -> Self {
        Self {
            white: String::new(),
            black: String::new(),
            white_elo: 0,
            black_elo: 0,
            result: String::new(),
            date: String::new(),
            event: String::new(),
            eco: String::new(),
            sans: Vec::new(),
        }
    }

    /// Elo-Schnitt der Partie · 0, wenn keine Zahl bekannt ist.
    fn avg_elo(&self) -> i32 {
        avg_elo(self.white_elo, self.black_elo)
    }
}

/// Elo-Schnitt aus zwei Zahlen · 0 heißt „unbekannt" und zählt nicht mit.
///
/// Steht hier und nicht nur in `RawGame`, weil das Entfernen einer Sammlung
/// denselben Wert noch einmal ausrechnen muss — aus der gespeicherten Partie
/// statt aus der gelesenen. Zwei Formeln, die dasselbe meinen, sind genau die
/// Sorte Unterschied, die im Buch eine Bilanz stehen ließe, die es nie gab.
fn avg_elo(white: i32, black: i32) -> i32 {
    match (white, black) {
        (0, 0) => 0,
        (w, 0) => w,
        (0, b) => b,
        (w, b) => (w + b) / 2,
    }
}

/// `[White "Kasparov, G."]` → ("White", "Kasparov, G.")
fn parse_header(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim().strip_prefix('[')?.strip_suffix(']')?;
    let (key, value) = rest.split_once(' ')?;
    let value = value.trim().strip_prefix('"')?.strip_suffix('"')?;
    Some((key, value))
}

/// Züge der Hauptvariante aus einem Zugtext.
///
/// Klammervarianten fallen weg · für ein Buch zählt, was am Brett stand, nicht
/// was jemand als Nebenlinie notiert hat. Kommentare, NAGs und Zugnummern
/// ebenso.
pub fn main_line(movetext: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let bytes = movetext.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => {
                while i < bytes.len() && bytes[i] != b'}' {
                    i += 1;
                }
                i += 1;
            }
            b';' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            b'$' => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                let start = i;
                while i < bytes.len()
                    && !bytes[i].is_ascii_whitespace()
                    && !matches!(bytes[i], b'(' | b')' | b'{' | b'}' | b';')
                {
                    i += 1;
                }
                if depth == 0 {
                    if let Ok(word) = std::str::from_utf8(&bytes[start..i]) {
                        if let Some(san) = crate::rep_pgn::clean_san(word) {
                            out.push(san);
                        }
                    }
                }
            }
        }
    }
    out
}

/// Liest eine PGN-Datei Partie für Partie und ruft `each` damit auf.
///
/// Streamend, weil eine Referenzsammlung mehrere Gigabyte groß sein kann: Die
/// Datei als String einzulesen wäre auf dem Handy das Ende und auf dem Desktop
/// eine Wette auf den Arbeitsspeicher. `each` gibt `false` zurück, um
/// abzubrechen.
pub fn read_pgn<R: Read>(
    reader: R,
    mut on_bytes: impl FnMut(u64),
    mut each: impl FnMut(RawGame) -> bool,
) -> Result<(), String> {
    let mut reader = BufReader::with_capacity(1 << 20, reader);
    let mut line = String::new();
    let mut game = RawGame::empty();
    let mut movetext = String::new();
    let mut in_moves = false;
    let mut read_total: u64 = 0;
    // Außerhalb der Schleife: Eine Achtgigabyte-Sammlung hat zweihundert
    // Millionen Zeilen, und ein `Vec::new()` je Zeile ist ebenso viele
    // Speicheranforderungen für immer denselben Puffer.
    let mut raw = Vec::new();

    loop {
        line.clear();
        // Fremde PGN-Dateien sind selten sauberes UTF-8 (ChessBase-Exporte
        // kommen oft als Latin-1). Ungültige Bytes dürfen den Import nicht
        // abbrechen · sie werden ersetzt.
        let read = read_line_lossy(&mut reader, &mut raw, &mut line)?;
        if read == 0 {
            break;
        }
        read_total += read as u64;
        on_bytes(read_total);

        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Ein Header nach gelesenem Zugtext beginnt die nächste Partie.
            if in_moves {
                game.sans = main_line(&movetext);
                if !each(std::mem::replace(&mut game, RawGame::empty())) {
                    return Ok(());
                }
                movetext.clear();
                in_moves = false;
            }
            if let Some((key, value)) = parse_header(&line) {
                match key {
                    "White" => game.white = value.to_string(),
                    "Black" => game.black = value.to_string(),
                    "WhiteElo" => game.white_elo = value.parse().unwrap_or(0),
                    "BlackElo" => game.black_elo = value.parse().unwrap_or(0),
                    "Result" => game.result = value.to_string(),
                    "Date" => game.date = value.to_string(),
                    "Event" => game.event = value.to_string(),
                    "ECO" => game.eco = value.to_string(),
                    _ => {}
                }
            }
            continue;
        }
        if !trimmed.is_empty() {
            in_moves = true;
            movetext.push_str(&line);
            movetext.push(' ');
        }
    }
    if in_moves || !game.white.is_empty() {
        game.sans = main_line(&movetext);
        each(game);
    }
    Ok(())
}

/// Liest eine Zeile und ersetzt ungültige UTF-8-Bytes, statt zu scheitern.
fn read_line_lossy<R: BufRead>(
    reader: &mut R,
    raw: &mut Vec<u8>,
    out: &mut String,
) -> Result<usize, String> {
    raw.clear();
    let read = reader
        .read_until(b'\n', raw)
        .map_err(|e| format!("Lesefehler: {e}"))?;
    if read > 0 {
        out.push_str(&String::from_utf8_lossy(raw));
    }
    Ok(read)
}

// ── Import ───────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy)]
struct BookAgg {
    white: i64,
    draws: i64,
    black: i64,
    elo_sum: i64,
    elo_n: i64,
    best_elo: i32,
    game_id: i64,
}

/// Erkennt das Format an der Endung · zstd-gepackte Dumps kommen so von
/// Lichess, `.cbh`/`.cbv` sind ChessBase.
fn is_zstd(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zst") || e.eq_ignore_ascii_case("zstd"))
        .unwrap_or(false)
}

/// Eine En-Croissant-Sammlung · siehe db3.rs.
fn is_db3(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("db3"))
        .unwrap_or(false)
}

/// Der gemeinsame Teil beider Quellen: aus Partien werden Buchzeilen.
///
/// PGN und `.db3` unterscheiden sich nur darin, wie eine Partie zustande kommt.
/// Was danach mit ihr passiert — Bilanz je Stellung führen, Musterpartie
/// merken, blockweise schreiben — ist dasselbe und steht deshalb hier und nicht
/// zweimal.
struct Ingest {
    conn: Connection,
    /// Schlüssel ist `fen_key`, ein Trennzeichen und der Zug. Vorher standen
    /// hier zwei getrennte Strings als Tupel; einer spart bei jeder der
    /// zweistelligen Millionen Buchzeilen eine Speicheranforderung und dem
    /// Hashwert einen zweiten Durchlauf.
    book: HashMap<String, BookAgg>,
    /// Kennung, fertiger Zugtext und die Partie selbst.
    pending: Vec<(i64, String, RawGame)>,
    next_id: i64,
    kept: u64,
    flush_every: u64,
    /// Wiederverwendeter Puffer für den Schlüssel oben.
    key: String,
    /// Buchzeilen vor dem Schreiben sortieren · nur der Messlauf schaltet das
    /// ab, um den Gewinn zu beziffern.
    sorted: bool,
    /// Die Sammlung, der die gelesenen Partien gehören.
    source_id: i64,
    /// Kennung der ersten Partie dieses Laufs · zusammen mit `next_id` der
    /// Bereich, an dem sich die Sammlung später wieder herauslösen lässt.
    first_id: i64,
    /// Fingerabdrücke des Bestands · siehe `game_hash`. Neue Partien wandern
    /// beim Aufnehmen hinein, damit auch Doppelungen innerhalb einer Datei
    /// auffallen.
    seen: HashSet<u64>,
    /// Partien, die schon da waren.
    duplicates: u64,
}

/// Trennt Stellung und Zug im Schlüssel · in keinem von beiden kommt es vor.
const KEY_SEP: char = '\u{1}';

impl Ingest {
    fn new(conn: Connection, source_id: i64, seen: HashSet<u64>) -> Self {
        let next_id = conn
            .query_row("SELECT COALESCE(MAX(id), 0) FROM ref_games", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        Self {
            conn,
            book: HashMap::new(),
            pending: Vec::new(),
            next_id,
            kept: 0,
            flush_every: flush_games(),
            key: String::new(),
            sorted: true,
            source_id,
            first_id: next_id + 1,
            seen,
            duplicates: 0,
        }
    }

    /// Nimmt eine Partie auf und schreibt den Block weg, wenn er voll ist.
    ///
    /// Wer dieselbe Datei zweimal einliest — oder zwei Sammlungen, die sich
    /// überschneiden —, soll dieselbe Partie nicht zweimal im Buch zählen.
    /// Erkannt wird sie am Fingerabdruck; erkannt heißt hier übergangen, nicht
    /// ersetzt: Die Fassung, die schon da ist, hat ihre Sammlung.
    fn absorb(&mut self, game: RawGame) -> Result<(), String> {
        if game.sans.is_empty() {
            return Ok(());
        }
        let moves = game.sans.join(" ");
        let hash = game_hash(&game.white, &game.black, &game.date, &game.result, &moves);
        if !self.seen.insert(hash) {
            self.duplicates += 1;
            return Ok(());
        }
        self.kept += 1;
        self.next_id += 1;
        let id = self.next_id;
        let avg = game.avg_elo();
        if let Some(bucket) = result_bucket(&game.result) {
            let Self { key, book, .. } = self;
            for_each_book_row(&game.sans, key, |row| {
                if !book.contains_key(row) {
                    book.insert(row.to_string(), BookAgg::default());
                }
                let entry = book.get_mut(row).expect("gerade eingefügt");
                match bucket {
                    0 => entry.white += 1,
                    1 => entry.draws += 1,
                    _ => entry.black += 1,
                }
                if avg > 0 {
                    entry.elo_sum += avg as i64;
                    entry.elo_n += 1;
                }
                if avg >= entry.best_elo {
                    entry.best_elo = avg;
                    entry.game_id = id;
                }
            });
        }
        self.pending.push((id, moves, game));
        if self.kept.is_multiple_of(self.flush_every) {
            self.flush()?;
        }
        Ok(())
    }

    /// Schreibt Partien und Buchzeilen eines Blocks in einer Transaktion.
    fn flush(&mut self) -> Result<(), String> {
        if self.pending.is_empty() && self.book.is_empty() {
            return Ok(());
        }
        // Sortiert statt in Hashmap-Reihenfolge. `ref_book` ist ein B-Baum über
        // den Schlüssel; in zufälliger Reihenfolge fasst ein Block von
        // hunderttausend Zeilen fast ebenso viele verschiedene Seiten an, in
        // sortierter Reihenfolge wandert er einmal von links nach rechts durch
        // den Baum und findet die nächste Seite meist schon im Puffer.
        let mut rows: Vec<(String, BookAgg)> = self.book.drain().collect();
        if self.sorted {
            rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        }
        // Vor der Transaktion abgelesen · sie leiht sich `self` aus.
        let (kept, first_id, last_id) = (self.kept as i64, self.first_id, self.next_id);

        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut insert = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO ref_games
                     (id, white, black, white_elo, black_elo, result, played_at, event, eco, moves, source_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                )
                .map_err(|e| e.to_string())?;
            let source_id = self.source_id;
            for (id, moves, game) in self.pending.drain(..) {
                insert
                    .execute(params![
                        id,
                        game.white,
                        game.black,
                        game.white_elo,
                        game.black_elo,
                        game.result,
                        game.date,
                        game.event,
                        game.eco,
                        moves,
                        source_id,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            let mut upsert = tx
                .prepare_cached(
                    "INSERT INTO ref_book (fen_key, san, white, draws, black, elo_sum, elo_n, best_elo, game_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(fen_key, san) DO UPDATE SET
                       white    = white + excluded.white,
                       draws    = draws + excluded.draws,
                       black    = black + excluded.black,
                       elo_sum  = elo_sum + excluded.elo_sum,
                       elo_n    = elo_n + excluded.elo_n,
                       game_id  = CASE WHEN excluded.best_elo >= best_elo THEN excluded.game_id ELSE game_id END,
                       best_elo = MAX(best_elo, excluded.best_elo)",
                )
                .map_err(|e| e.to_string())?;
            for (key, agg) in rows {
                let Some((fen_key, san)) = key.split_once(KEY_SEP) else {
                    continue;
                };
                upsert
                    .execute(params![
                        fen_key,
                        san,
                        agg.white,
                        agg.draws,
                        agg.black,
                        agg.elo_sum,
                        agg.elo_n,
                        agg.best_elo,
                        agg.game_id,
                    ])
                    .map_err(|e| e.to_string())?;
            }
            // Die Sammlungszeile wandert mit jedem Block mit. Sie beschreibt
            // damit immer genau das, was auch wirklich in der Datei steht —
            // auch dann, wenn der Lauf gleich danach abbricht oder der Rechner
            // ausgeht. Stünde sie erst am Ende richtig, wäre alles, was ein
            // abgestürzter Import hinterlässt, unauffindbar und unlöschbar.
            tx.execute(
                "UPDATE ref_sources SET games = ?2, first_id = ?3, last_id = ?4 WHERE id = ?1",
                params![source_id, kept, first_id, last_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}

fn run_import(app: &tauri::AppHandle, path: String) -> Result<(u64, i64, u64, u64), String> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!("Datei nicht gefunden: {path}"));
    }
    if crate::cbh::is_chessbase(&source) {
        return Err(crate::cbh::UNSUPPORTED_HINT.to_string());
    }
    let bytes_total = std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0);

    let target = ref_path(app)?;
    let conn = open(&target)?;
    // Import ist ein Massenschreibvorgang; die Haltbarkeit einzelner Blöcke
    // ist hier weniger wert als die Dauer. Ein Absturz mittendrin kostet den
    // laufenden Block, nicht die Datenbank.
    let _ = conn.pragma_update(None, "synchronous", "OFF");
    let _ = conn.pragma_update(None, "cache_size", import_cache_kib());
    // Der Sortierlauf jedes Blocks (siehe `Ingest::flush`) soll nicht über eine
    // temporäre Datei gehen.
    let _ = conn.pragma_update(None, "temp_store", "MEMORY");

    let mut progress = |games: u64, bytes: u64, phase: &str| {
        let _ = app.emit(
            "refdb://progress",
            ImportProgress {
                games,
                bytes,
                bytes_total,
                games_total: 0,
                phase: phase.into(),
            },
        );
    };
    let mut scan_progress = |games: u64, games_total: u64, phase: &str| {
        let _ = app.emit(
            "refdb://progress",
            ImportProgress {
                games,
                bytes: 0,
                bytes_total,
                games_total,
                phase: phase.into(),
            },
        );
    };

    // Erst den Bestand kennen, dann lesen · siehe `load_hashes`.
    let known = meta_get(&conn, "games").parse::<u64>().unwrap_or(0);
    scan_progress(0, known, "scanning");
    let seen = load_hashes(&conn, known, &mut scan_progress)?;

    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    let source_id = new_source(&conn, &name, &path)?;

    let state = app.state::<RefDbState>();
    let mut ingest = Ingest::new(conn, source_id, seen);

    let (cancelled, skipped) = if is_db3(&source) {
        import_db3(&source, &mut ingest, state, &mut progress)?
    } else {
        (import_pgn(&source, &mut ingest, state, &mut progress)?, 0)
    };

    progress(ingest.kept, bytes_total, "finishing");
    ingest.flush()?;

    let total = count_and_remember(&ingest.conn);
    // Eine Sammlung, aus der nichts hereinkam — alles Doppelungen, oder gleich
    // beim ersten Zug abgebrochen —, hinterlässt keine Zeile. Sie hätte nichts,
    // was sich später entfernen ließe.
    if ingest.kept == 0 {
        let _ = ingest
            .conn
            .execute("DELETE FROM ref_sources WHERE id = ?1", params![source_id]);
    } else {
        meta_set(&ingest.conn, "source", &name);
        meta_set(&ingest.conn, "imported_at", &now_secs().to_string());
    }
    let _ = ingest.conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = ingest.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    if cancelled {
        // Abgebrochen heißt „behalten, was schon da ist" · genau wie beim
        // Partien-Import. Was gelesen wurde, steht als eigene Sammlung da und
        // lässt sich einzeln wieder entfernen.
        log::info!("Referenz-Import abgebrochen nach {} Partien", ingest.kept);
    }
    Ok((ingest.kept, total, skipped, ingest.duplicates))
}

/// Legt die Zeile für eine neue Sammlung an und gibt ihre Kennung zurück.
///
/// Kennung 0 gehört dem, was vor den Sammlungen eingelesen wurde (siehe
/// `adopt_legacy`) · neue fangen deshalb bei 1 an.
fn new_source(conn: &Connection, name: &str, path: &str) -> Result<i64, String> {
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(id), 0) + 1 FROM ref_sources",
            [],
            |r| r.get(0),
        )
        .unwrap_or(1)
        .max(1);
    conn.execute(
        "INSERT INTO ref_sources (id, name, path, games, first_id, last_id, imported_at)
         VALUES (?1, ?2, ?3, 0, 0, 0, ?4)",
        params![next, name, path, now_secs()],
    )
    .map_err(|e| format!("Sammlung konnte nicht angelegt werden: {e}"))?;
    Ok(next)
}

/// Liest eine PGN-Datei (auch zstd-gepackt) ein · `true`, wenn abgebrochen wurde.
fn import_pgn(
    source: &Path,
    ingest: &mut Ingest,
    state: tauri::State<RefDbState>,
    progress: &mut impl FnMut(u64, u64, &str),
) -> Result<bool, String> {
    let file = std::fs::File::open(source).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    let reader: Box<dyn Read> = if is_zstd(source) {
        Box::new(zstd::Decoder::new(file).map_err(|e| format!("zstd: {e}"))?)
    } else {
        Box::new(file)
    };

    let mut games_read: u64 = 0;
    let mut last_progress: u64 = 0;
    let mut cancelled = false;
    let mut failure: Option<String> = None;
    // Beide Rückrufe von `read_pgn` brauchen den Lesestand · der eine schreibt
    // ihn, der andere meldet ihn.
    let bytes_read = std::cell::Cell::new(0u64);

    read_pgn(
        reader,
        |n| bytes_read.set(n),
        |game| {
            games_read += 1;
            if state.cancel.load(Ordering::SeqCst) {
                cancelled = true;
                return false;
            }
            if let Err(e) = ingest.absorb(game) {
                log::error!("Referenz-Import: {e}");
                failure = Some(e);
                return false;
            }
            if games_read - last_progress >= PROGRESS_GAMES {
                last_progress = games_read;
                progress(ingest.kept, bytes_read.get(), "reading");
            }
            true
        },
    )?;
    match failure {
        Some(e) => Err(e),
        None => Ok(cancelled),
    }
}

/// Eine Spalte als Text, egal was tatsächlich darin steht.
///
/// Die Spaltentypen einer `.db3` sind Absichtserklärungen: `Result` ist als
/// INTEGER deklariert und enthält "1-0", `Round` ist INTEGER und enthält
/// gelegentlich "1.2". SQLite stört das nicht, ein Lesen mit festem Typ schon —
/// deshalb wird hier gelesen, was da ist.
fn text_column(row: &rusqlite::Row, index: usize) -> String {
    match row.get_ref(index) {
        Ok(rusqlite::types::ValueRef::Text(bytes)) => String::from_utf8_lossy(bytes).into_owned(),
        Ok(rusqlite::types::ValueRef::Integer(value)) => value.to_string(),
        Ok(rusqlite::types::ValueRef::Real(value)) => value.to_string(),
        _ => String::new(),
    }
}

/// Ergebnis in der Schreibweise, die `Ingest::absorb` erwartet.
///
/// Die Spalte heißt `Result` und ist als INTEGER deklariert, enthält aber Text
/// ("1-0"); SQLite nimmt das hin. Alles, was keine der drei Formen ist — "*"
/// zum Beispiel —, gilt als unbekannt und zahlt nicht ins Buch ein.
fn db3_result(raw: &str) -> String {
    match raw.trim() {
        "1-0" | "1" => "1-0".into(),
        "0-1" | "0" => "0-1".into(),
        "1/2-1/2" | "½-½" | "1/2" => "1/2-1/2".into(),
        _ => String::new(),
    }
}

/// Liest eine En-Croissant-Sammlung ein · `true`, wenn abgebrochen wurde.
///
/// Die Namen liegen in eigenen Tabellen und werden über `LEFT JOIN` geholt;
/// eine Sammlung mit einer halben Million Spielern in eine Hashmap zu laden
/// wäre der andere Weg, kostet aber Speicher, den die Buch-Hashmap besser
/// gebrauchen kann.
///
/// Der Fortschritt zählt hier Partien statt Bytes und rechnet sie auf die
/// Dateigröße hoch — die Oberfläche zeigt einen Balken, und ein Balken braucht
/// eine Skala, die zur gemeldeten Größe passt.
fn import_db3(
    source: &Path,
    ingest: &mut Ingest,
    state: tauri::State<RefDbState>,
    progress: &mut impl FnMut(u64, u64, &str),
) -> Result<(bool, u64), String> {
    let bytes_total = std::fs::metadata(source).map(|m| m.len()).unwrap_or(0);
    let src = Connection::open_with_flags(
        source,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Datei nicht lesbar: {e}"))?;

    let total: i64 = src
        .query_row("SELECT COUNT(*) FROM Games", [], |r| r.get(0))
        .map_err(|_| {
            "Diese .db3-Datei enthält keine Partientabelle · erwartet wird eine \
             En-Croissant-Datenbank."
                .to_string()
        })?;

    let mut stmt = src
        .prepare(
            "SELECT g.FEN, g.Moves, g.PawnHome, g.Result, g.Date, g.ECO,
                    g.WhiteElo, g.BlackElo, w.Name, b.Name, e.Name
             FROM Games g
             LEFT JOIN Players w ON w.ID = g.WhiteID
             LEFT JOIN Players b ON b.ID = g.BlackID
             LEFT JOIN Events  e ON e.ID = g.EventID",
        )
        .map_err(|e| format!("Partien nicht lesbar: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Partien nicht lesbar: {e}"))?;

    let mut read: u64 = 0;
    let mut last_progress: u64 = 0;
    // Partien, deren Zugfolge sich nicht zweifelsfrei nachspielen lässt · siehe
    // die Prüfsumme in db3.rs. Sie werden übergangen, nicht geraten.
    let mut rejected: u64 = 0;

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Partien nicht lesbar: {e}"))?
    {
        read += 1;
        if state.cancel.load(Ordering::SeqCst) {
            return Ok((true, rejected));
        }

        let fen = text_column(row, 0);
        let bytes: Vec<u8> = row
            .get::<_, Option<Vec<u8>>>(1)
            .unwrap_or_default()
            .unwrap_or_default();
        let home: Option<i64> = row.get(2).unwrap_or(None);
        let result = text_column(row, 3);
        let date = text_column(row, 4);
        let eco = text_column(row, 5);
        let white_elo: i32 = row.get(6).unwrap_or(0);
        let black_elo: i32 = row.get(7).unwrap_or(0);
        let white = text_column(row, 8);
        let black = text_column(row, 9);
        let event = text_column(row, 10);

        // Eine Partie aus einer Sonderstellung (Chess960, Stellungsübungen)
        // gehört nicht in ein Eröffnungsbuch, das von der Grundstellung aus
        // gerechnet wird.
        let Some(start) = crate::db3::start_position(&fen) else {
            rejected += 1;
            continue;
        };
        if start != crate::chess::Position::initial() {
            rejected += 1;
            continue;
        }
        let Some(game) = crate::db3::decode_mainline(&start, &bytes) else {
            rejected += 1;
            continue;
        };
        // Die Prüfsumme der Datei · stimmt sie nicht, wäre die Partie erfunden.
        if let Some(home) = home {
            if game.pawn_home != home as u16 {
                rejected += 1;
                continue;
            }
        }

        ingest.absorb(RawGame {
            white,
            black,
            white_elo,
            black_elo,
            result: db3_result(&result),
            date,
            event,
            eco,
            sans: game.sans,
        })?;

        if read - last_progress >= PROGRESS_GAMES {
            last_progress = read;
            let done = if total > 0 {
                (bytes_total as f64 * (read as f64 / total as f64)) as u64
            } else {
                0
            };
            progress(ingest.kept, done, "reading");
        }
    }

    if rejected > 0 {
        log::warn!("Referenz-Import: {rejected} von {read} Partien übergangen");
    }
    Ok((false, rejected))
}

// ── Kommandos ────────────────────────────────────────────────────────────────

/// Bestand der Referenzdatenbank für die Einstellungen und den Analyse-Reiter.
///
/// Die Zahlen kommen aus `ref_meta` und nicht aus `COUNT(*)` · siehe
/// `count_and_remember`. Eine Datei aus einer älteren Fassung hat sie noch
/// nicht; dann wird einmal gezählt und das Ergebnis gemerkt. Das dauert einmal,
/// nicht bei jedem Öffnen — und dank `(async)` steht dabei nicht das Fenster.
#[tauri::command(async)]
pub fn refdb_status(app: tauri::AppHandle) -> Result<RefDbStatus, String> {
    let path = ref_path(&app)?;
    let importing = app.state::<RefDbState>().importing.load(Ordering::SeqCst);
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if !path.exists() {
        return Ok(RefDbStatus {
            games: 0,
            positions: 0,
            size_bytes: 0,
            source: String::new(),
            imported_at: 0,
            importing,
            path: path.display().to_string(),
            sources: Vec::new(),
        });
    }
    let conn = open(&path)?;
    let counted = meta_get(&conn, "games").parse::<i64>().ok();
    if counted.is_none() && !importing {
        count_and_remember(&conn);
    }
    Ok(RefDbStatus {
        games: meta_get(&conn, "games").parse().unwrap_or(0),
        positions: meta_get(&conn, "positions").parse().unwrap_or(0),
        size_bytes,
        source: meta_get(&conn, "source"),
        imported_at: meta_get(&conn, "imported_at").parse().unwrap_or(0),
        importing,
        path: path.display().to_string(),
        sources: source_list(&conn),
    })
}

/// Steht diese Datei schon in der Referenzdatenbank?
///
/// Die Frage vor dem Import, nicht danach: Ein zweiter Lauf über dieselbe
/// Sammlung nähme Stunden und brächte am Ende nichts, weil jede einzelne Partie
/// als Doppelung wieder herausfiele. Verglichen wird der Dateiname und nicht der
/// Pfad · dieselbe Datei wandert zwischen Ordnern, ohne eine andere zu werden.
#[tauri::command(async)]
pub fn refdb_precheck(app: tauri::AppHandle, path: String) -> Result<Option<RefSource>, String> {
    let target = ref_path(&app)?;
    if !target.exists() {
        return Ok(None);
    }
    let name = PathBuf::from(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    if name.is_empty() {
        return Ok(None);
    }
    let conn = open(&target)?;
    Ok(conn
        .query_row(
            "SELECT id, name, path, games, imported_at FROM ref_sources
             WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |r| {
                Ok(RefSource {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    path: r.get(2)?,
                    games: r.get(3)?,
                    imported_at: r.get(4)?,
                })
            },
        )
        .ok())
}

#[tauri::command]
pub fn refdb_import(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<RefDbState>();
    if state.importing.swap(true, Ordering::SeqCst) {
        return Err("Ein Referenz-Import läuft bereits.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_import(&app2, path);
        let state = app2.state::<RefDbState>();
        let cancelled = state.cancel.swap(false, Ordering::SeqCst);
        state.importing.store(false, Ordering::SeqCst);
        let (games, total, skipped, duplicates, error) = match result {
            Ok((games, total, skipped, duplicates)) => (games, total, skipped, duplicates, None),
            Err(e) => (0, 0, 0, 0, Some(e)),
        };
        let _ = app2.emit(
            "refdb://done",
            ImportDone {
                games,
                total,
                skipped,
                duplicates,
                action: "import".into(),
                cancelled,
                error,
            },
        );
    });
    Ok(())
}

/// Eine einzelne Sammlung wieder herauslösen.
///
/// Das Buch ist eine Bilanz, kein Archiv: In seinen Zeilen steht nur noch, wie
/// oft ein Zug gewonnen hat, nicht mehr von wem. Eine Sammlung daraus zu
/// entfernen heißt deshalb, ihre Partien noch einmal abzuspielen und dabei
/// abzuziehen, was der Import addiert hat — dieselben Zeilen (siehe
/// `for_each_book_row`), dieselbe Reihenfolge, umgekehrtes Vorzeichen. Zeilen,
/// die dabei auf null fallen, verschwinden.
///
/// Gearbeitet wird blockweise und in Kennungsreihenfolge, und jeder Block
/// löscht seine Partien in derselben Transaktion, in der er das Buch
/// verkleinert. Ein Abbruch mittendrin hinterlässt damit keine halbe Bilanz,
/// sondern eine kleinere Sammlung, die sich beim nächsten Mal zu Ende entfernen
/// lässt.
fn run_delete(app: &tauri::AppHandle, id: i64) -> Result<(u64, i64), String> {
    let target = ref_path(app)?;
    if !target.exists() {
        return Err("Keine Referenzdatenbank vorhanden.".into());
    }
    let mut conn = open(&target)?;
    let _ = conn.pragma_update(None, "cache_size", import_cache_kib());
    let _ = conn.pragma_update(None, "temp_store", "MEMORY");

    let cancel = &app.state::<RefDbState>().cancel;
    let (removed, cancelled) = shrink_source(&mut conn, id, cancel, &mut |done, total| {
        let _ = app.emit(
            "refdb://progress",
            ImportProgress {
                games: done,
                bytes: 0,
                bytes_total: 0,
                games_total: total,
                phase: "removing".into(),
            },
        );
    })?;

    if !cancelled {
        let _ = conn.execute("DELETE FROM ref_sources WHERE id = ?1", params![id]);
    }
    let total_left = count_and_remember(&conn);
    let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    Ok((removed, total_left))
}

/// Der Rechenteil des Entfernens · ohne Fenster, deshalb prüfbar.
///
/// Gibt zurück, wie viele Partien herausgelöst wurden und ob dabei abgebrochen
/// wurde. Die Sammlungszeile selbst bleibt stehen: Ob sie verschwindet oder als
/// Rest weiterlebt, entscheidet der Aufrufer.
fn shrink_source(
    conn: &mut Connection,
    id: i64,
    cancel: &AtomicBool,
    progress: &mut impl FnMut(u64, u64),
) -> Result<(u64, bool), String> {
    let (first_id, last_id, mut left) = conn
        .query_row(
            "SELECT first_id, last_id, games FROM ref_sources WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|_| "Diese Sammlung gibt es nicht (mehr).".to_string())?;
    // Der Bereich, in dem die Musterpartien dieser Sammlung liegen. Er ändert
    // sich während des Laufs nicht · anders als der Lesezeiger unten.
    let (range_from, range_to) = (first_id, last_id);
    let total = left.max(0) as u64;

    let block = flush_games() as i64;
    let mut cursor = first_id;
    let mut removed: u64 = 0;

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok((removed, true));
        }
        if cursor > range_to {
            break;
        }
        let mut stmt = conn
            .prepare_cached(
                "SELECT id, white_elo, black_elo, result, moves FROM ref_games
                 WHERE id >= ?1 AND id <= ?2 AND source_id = ?3
                 ORDER BY id LIMIT ?4",
            )
            .map_err(|e| e.to_string())?;
        let games: Vec<(i64, i32, i32, String, String)> = stmt
            .query_map(params![cursor, range_to, id, block], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1).unwrap_or(0),
                    r.get(2).unwrap_or(0),
                    r.get(3).unwrap_or_default(),
                    r.get(4).unwrap_or_default(),
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        drop(stmt);
        if games.is_empty() {
            break;
        }
        let block_to = games.last().map(|g| g.0).unwrap_or(cursor);

        // Was der Import addiert hat, noch einmal aufsummieren · abgezogen wird
        // es unten in einem Rutsch.
        let mut deltas: HashMap<String, BookAgg> = HashMap::new();
        let mut key = String::new();
        for (_, white_elo, black_elo, result, moves) in &games {
            let Some(bucket) = result_bucket(result) else {
                continue;
            };
            let avg = avg_elo(*white_elo, *black_elo);
            let sans: Vec<String> = moves
                .split(' ')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            for_each_book_row(&sans, &mut key, |row| {
                let entry = deltas.entry(row.to_string()).or_default();
                match bucket {
                    0 => entry.white += 1,
                    1 => entry.draws += 1,
                    _ => entry.black += 1,
                }
                if avg > 0 {
                    entry.elo_sum += avg as i64;
                    entry.elo_n += 1;
                }
            });
        }
        // Sortiert wie beim Import · derselbe Weg von links nach rechts durch
        // den B-Baum, dieselbe Ersparnis.
        let mut rows: Vec<(String, BookAgg)> = deltas.into_iter().collect();
        rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));

        let taken = games.len() as i64;
        left = (left - taken).max(0);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut shrink = tx
                .prepare_cached(
                    "UPDATE ref_book SET
                       white    = white   - ?3,
                       draws    = draws   - ?4,
                       black    = black   - ?5,
                       elo_sum  = elo_sum - ?6,
                       elo_n    = elo_n   - ?7,
                       best_elo = CASE WHEN game_id BETWEEN ?8 AND ?9 THEN 0 ELSE best_elo END,
                       game_id  = CASE WHEN game_id BETWEEN ?8 AND ?9 THEN 0 ELSE game_id END
                     WHERE fen_key = ?1 AND san = ?2",
                )
                .map_err(|e| e.to_string())?;
            let mut prune = tx
                .prepare_cached(
                    "DELETE FROM ref_book
                     WHERE fen_key = ?1 AND san = ?2 AND white + draws + black <= 0",
                )
                .map_err(|e| e.to_string())?;
            for (key, agg) in rows {
                let Some((fen_key, san)) = key.split_once(KEY_SEP) else {
                    continue;
                };
                shrink
                    .execute(params![
                        fen_key,
                        san,
                        agg.white,
                        agg.draws,
                        agg.black,
                        agg.elo_sum,
                        agg.elo_n,
                        range_from,
                        range_to,
                    ])
                    .map_err(|e| e.to_string())?;
                prune
                    .execute(params![fen_key, san])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "DELETE FROM ref_games WHERE id >= ?1 AND id <= ?2 AND source_id = ?3",
                params![cursor, block_to, id],
            )
            .map_err(|e| e.to_string())?;
            // Der Lesezeiger gehört in die Datenbank und nicht nur in diese
            // Schleife: Er ist es, der einen Abbruch fortsetzbar macht.
            tx.execute(
                "UPDATE ref_sources SET first_id = ?2, games = ?3 WHERE id = ?1",
                params![id, block_to + 1, left],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;

        cursor = block_to + 1;
        removed += taken as u64;
        progress(removed, total);
    }
    Ok((removed, false))
}

#[tauri::command]
pub fn refdb_delete_source(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<RefDbState>();
    if state.importing.swap(true, Ordering::SeqCst) {
        return Err("Ein Referenz-Import läuft bereits.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_delete(&app2, id);
        let state = app2.state::<RefDbState>();
        let cancelled = state.cancel.swap(false, Ordering::SeqCst);
        state.importing.store(false, Ordering::SeqCst);
        let (games, total, error) = match result {
            Ok((games, total)) => (games, total, None),
            Err(e) => (0, 0, Some(e)),
        };
        let _ = app2.emit(
            "refdb://done",
            ImportDone {
                games,
                total,
                skipped: 0,
                duplicates: 0,
                action: "delete".into(),
                cancelled,
                error,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn refdb_cancel_import(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<RefDbState>()
        .cancel
        .store(true, Ordering::SeqCst);
    Ok(())
}

/// Löscht die Referenzdatenbank vollständig · sie ist eine eigene Datei, die
/// eigenen Partien können davon gar nicht betroffen sein.
#[tauri::command]
pub fn refdb_clear(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<RefDbState>().importing.load(Ordering::SeqCst) {
        return Err("Während eines laufenden Imports nicht möglich.".into());
    }
    let path = ref_path(&app)?;
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("{}{suffix}", path.display()));
        if file.exists() {
            std::fs::remove_file(&file).map_err(|e| format!("Löschen fehlgeschlagen: {e}"))?;
        }
    }
    Ok(())
}

/// Auskunft des Buchs zu einer Stellung · dieselbe Form wie beim
/// Lichess-Explorer, damit die Karte in der Analyse nur eine Zeile kennt.
#[tauri::command(async)]
pub fn refdb_query(app: tauri::AppHandle, fen: String) -> Result<ExplorerResult, String> {
    let path = ref_path(&app)?;
    let key = chess::normalize_fen(&fen)?;
    let mut result = ExplorerResult {
        source: "own".into(),
        status: "unknown".into(),
        white: 0,
        draws: 0,
        black: 0,
        moves: Vec::new(),
        top_games: Vec::new(),
        opening: None,
        cached: true,
    };
    if !path.exists() {
        return Ok(result);
    }
    let conn = open(&path)?;
    let mut stmt = conn
        .prepare(
            "SELECT san, white, draws, black, elo_sum, elo_n, game_id
             FROM ref_book WHERE fen_key = ?1
             ORDER BY (white + draws + black) DESC LIMIT 12",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![key], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut game_ids: Vec<i64> = Vec::new();
    for (san, white, draws, black, elo_sum, elo_n, game_id) in rows {
        result.white += white;
        result.draws += draws;
        result.black += black;
        result.moves.push(ExplorerMove {
            // Das Buch speichert SAN · die UCI-Form braucht die Karte nur als
            // Schlüssel, und dafür genügt der Zug selbst.
            uci: san.clone(),
            san,
            white,
            draws,
            black,
            average_rating: if elo_n > 0 {
                Some((elo_sum / elo_n) as i32)
            } else {
                None
            },
        });
        if game_id > 0 && game_ids.len() < TOP_GAMES {
            game_ids.push(game_id);
        }
    }
    if !result.moves.is_empty() {
        result.status = "ok".into();
    }

    for id in game_ids {
        if let Ok(game) = conn.query_row(
            "SELECT id, white, black, white_elo, black_elo, result, played_at, eco
             FROM ref_games WHERE id = ?1",
            params![id],
            |r| {
                Ok(ExplorerGame {
                    id: r.get::<_, i64>(0)?.to_string(),
                    white: r.get(1)?,
                    black: r.get(2)?,
                    white_elo: r.get::<_, i64>(3).ok().filter(|v| *v > 0).map(|v| v as i32),
                    black_elo: r.get::<_, i64>(4).ok().filter(|v| *v > 0).map(|v| v as i32),
                    winner: match r.get::<_, String>(5)?.as_str() {
                        "1-0" => "white".into(),
                        "0-1" => "black".into(),
                        _ => String::new(),
                    },
                    year: r
                        .get::<_, String>(6)?
                        .get(0..4)
                        .and_then(|y| y.parse().ok()),
                    month: None,
                })
            },
        ) {
            result.top_games.push(game);
        }
    }
    Ok(result)
}

/// Eine Referenzpartie zum Nachspielen · das Analysebrett lädt sie damit.
#[tauri::command(async)]
pub fn refdb_game(app: tauri::AppHandle, id: i64) -> Result<RefGame, String> {
    let path = ref_path(&app)?;
    if !path.exists() {
        return Err("Keine Referenzdatenbank vorhanden.".into());
    }
    let conn = open(&path)?;
    conn.query_row(
        "SELECT id, white, black, white_elo, black_elo, result, played_at, event, eco, moves
         FROM ref_games WHERE id = ?1",
        params![id],
        |r| {
            Ok(RefGame {
                id: r.get(0)?,
                white: r.get(1)?,
                black: r.get(2)?,
                white_elo: r.get(3)?,
                black_elo: r.get(4)?,
                result: r.get(5)?,
                played_at: r.get(6)?,
                event: r.get(7)?,
                eco: r.get(8)?,
                moves: r.get(9)?,
            })
        },
    )
    .map_err(|e| format!("Partie nicht gefunden: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PGN: &str = "[Event \"Test\"]\n[White \"Kasparov, G.\"]\n[Black \"Karpov, A.\"]\n\
[WhiteElo \"2820\"]\n[BlackElo \"2745\"]\n[Result \"1-0\"]\n[Date \"1997.05.11\"]\n[ECO \"C50\"]\n\n\
1. e4 {beste Eröffnung} e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 3. Bc4 $1 Bc5 1-0\n\n\
[Event \"Test 2\"]\n[White \"Anand, V.\"]\n[Black \"Kramnik, V.\"]\n[Result \"1/2-1/2\"]\n\n\
1. d4 d5 2. c4 1/2-1/2\n";

    #[test]
    fn reads_headers_and_main_line() {
        let mut games = Vec::new();
        read_pgn(
            PGN.as_bytes(),
            |_| {},
            |g| {
                games.push(g);
                true
            },
        )
        .unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].white, "Kasparov, G.");
        assert_eq!(games[0].white_elo, 2820);
        assert_eq!(games[0].result, "1-0");
        assert_eq!(games[0].eco, "C50");
        // Klammervariante, Kommentar und NAG fallen weg.
        assert_eq!(games[0].sans, vec!["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
        assert_eq!(games[1].sans, vec!["d4", "d5", "c4"]);
        assert_eq!(games[1].avg_elo(), 0);
    }

    #[test]
    fn stops_when_the_callback_asks_to() {
        let mut seen = 0;
        read_pgn(
            PGN.as_bytes(),
            |_| {},
            |_| {
                seen += 1;
                false
            },
        )
        .unwrap();
        assert_eq!(seen, 1, "der Abbruch greift sofort");
    }

    #[test]
    fn averages_only_the_ratings_it_knows() {
        let mut game = RawGame::empty();
        game.white_elo = 2600;
        assert_eq!(game.avg_elo(), 2600);
        game.black_elo = 2400;
        assert_eq!(game.avg_elo(), 2500);
    }

    #[test]
    fn main_line_ignores_nested_variations() {
        let sans = main_line("1. e4 (1. d4 d5 (1... Nf6 2. c4)) 1... c5 2. Nf3 *");
        assert_eq!(sans, vec!["e4", "c5", "Nf3"]);
    }

    /// Das Ergebnisfeld einer `.db3` ist Text, obwohl die Spalte INTEGER heißt.
    #[test]
    fn reads_the_db3_result_column() {
        assert_eq!(db3_result("1-0"), "1-0");
        assert_eq!(db3_result("1/2-1/2"), "1/2-1/2");
        assert_eq!(db3_result("0-1"), "0-1");
        // Unentschieden im Sinne von „unbekannt" · zahlt nicht ins Buch ein.
        assert_eq!(db3_result("*"), "");
        assert_eq!(db3_result(""), "");
    }

    #[test]
    fn recognizes_the_supported_extensions() {
        assert!(is_db3(&PathBuf::from("MillionBase.db3")));
        assert!(is_db3(&PathBuf::from("Lumbra.DB3")));
        assert!(!is_db3(&PathBuf::from("caissabase.pgn")));
        assert!(is_zstd(&PathBuf::from("dump.pgn.zst")));
    }

    /// Der Weg von der gelesenen Partie ins Buch · zwei Partien mit demselben
    /// ersten Zug ergeben eine Buchzeile mit zwei Partien darin.
    #[test]
    fn builds_the_book_from_absorbed_games() {
        let target =
            std::env::temp_dir().join(format!("kiebitz-book-{}.sqlite", std::process::id()));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
        let mut ingest = Ingest::new(open(&target).unwrap(), 1, HashSet::new());

        let mut white_win = RawGame::empty();
        white_win.result = "1-0".into();
        white_win.white_elo = 2600;
        white_win.black_elo = 2400;
        white_win.sans = vec!["e4".into(), "c5".into(), "Nf3".into()];
        let mut draw = RawGame::empty();
        draw.result = "1/2-1/2".into();
        draw.sans = vec!["e4".into(), "e5".into()];
        // Ohne Ergebnis · sie wird gespeichert, zahlt aber nicht ins Buch ein.
        let mut unknown = RawGame::empty();
        unknown.sans = vec!["e4".into(), "c5".into()];

        ingest.absorb(white_win).unwrap();
        ingest.absorb(draw).unwrap();
        ingest.absorb(unknown).unwrap();
        ingest.flush().unwrap();

        let start = chess::start_key();
        let (white, draws, elo_n, best): (i64, i64, i64, i64) = ingest
            .conn
            .query_row(
                "SELECT white, draws, elo_n, best_elo FROM ref_book WHERE fen_key = ?1 AND san = 'e4'",
                params![start],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (white, draws),
            (1, 1),
            "die dritte Partie hat kein Ergebnis"
        );
        // Nur die eine Partie kennt Ratings · der Schnitt zählt einmal.
        assert_eq!((elo_n, best), (1, 2500));

        let games: i64 = ingest
            .conn
            .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(games, 3, "gespeichert werden alle drei");

        drop(ingest);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
    }

    /// Eine Testdatenbank mit einer eingelesenen Sammlung.
    fn ingest_source(target: &Path, source_id: i64, name: &str, games: Vec<RawGame>) -> Connection {
        let conn = open(target).unwrap();
        let seen = load_hashes(&conn, 0, &mut |_, _, _| {}).unwrap();
        conn.execute(
            "INSERT INTO ref_sources (id, name, path, games, first_id, last_id, imported_at)
             VALUES (?1, ?2, '', 0, 0, 0, 0)",
            params![source_id, name],
        )
        .unwrap();
        let mut ingest = Ingest::new(conn, source_id, seen);
        for game in games {
            ingest.absorb(game).unwrap();
        }
        // `flush` schreibt die Sammlungszeile mit · genau wie im Import.
        ingest.flush().unwrap();
        count_and_remember(&ingest.conn);
        ingest.conn
    }

    fn game(result: &str, white: &str, sans: &[&str]) -> RawGame {
        let mut g = RawGame::empty();
        g.result = result.into();
        g.white = white.into();
        g.sans = sans.iter().map(|s| (*s).to_string()).collect();
        g
    }

    fn scratch(tag: &str) -> PathBuf {
        let target = std::env::temp_dir().join(format!(
            "kiebitz-{tag}-{}-{}.sqlite",
            std::process::id(),
            now_secs()
        ));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
        target
    }

    fn cleanup(target: &Path) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
    }

    /// Dieselbe Partie zweimal · beim zweiten Mal fällt sie heraus.
    #[test]
    fn skips_games_that_are_already_there() {
        let target = scratch("dup");
        let conn = ingest_source(
            &target,
            1,
            "erste.pgn",
            vec![
                game("1-0", "Kasparov", &["e4", "c5"]),
                game("1-0", "Kasparov", &["e4", "c5"]),
                game("1-0", "Karpov", &["e4", "c5"]),
            ],
        );
        let stored: i64 = conn
            .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, 2, "die Wiederholung zählt nicht");
        drop(conn);

        // Zweiter Lauf über dieselben Partien, als andere Sammlung: Der
        // Fingerabdruck kommt jetzt aus dem Bestand und nicht aus dem Lauf.
        let conn = ingest_source(
            &target,
            2,
            "zweite.pgn",
            vec![game("1-0", "Kasparov", &["e4", "c5"])],
        );
        let stored: i64 = conn
            .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, 2, "auch gegen den Bestand wird geprüft");
        let white: i64 = conn
            .query_row(
                "SELECT white FROM ref_book WHERE fen_key = ?1 AND san = 'e4'",
                params![chess::start_key()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(white, 2, "das Buch zählt keine Doppelung mit");
        drop(conn);
        cleanup(&target);
    }

    /// Eine Sammlung entfernen lässt die andere unversehrt und räumt die
    /// Buchzeilen weg, die nur ihr gehörten.
    #[test]
    fn removes_one_collection_and_keeps_the_other() {
        let target = scratch("drop");
        let conn = ingest_source(
            &target,
            1,
            "alt.pgn",
            vec![
                game("1-0", "A", &["e4", "c5", "Nf3"]),
                game("0-1", "B", &["d4", "d5"]),
            ],
        );
        drop(conn);
        let mut conn = ingest_source(
            &target,
            2,
            "neu.pgn",
            vec![game("1/2-1/2", "C", &["e4", "e5"])],
        );

        let start = chess::start_key();
        let before: (i64, i64, i64) = conn
            .query_row(
                "SELECT white, draws, black FROM ref_book WHERE fen_key = ?1 AND san = 'e4'",
                params![start],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(before, (1, 1, 0), "beide Sammlungen stehen in der Zeile");

        let cancel = AtomicBool::new(false);
        let (removed, cancelled) = shrink_source(&mut conn, 1, &cancel, &mut |_, _| {}).unwrap();
        assert_eq!((removed, cancelled), (2, false));

        let after: (i64, i64, i64) = conn
            .query_row(
                "SELECT white, draws, black FROM ref_book WHERE fen_key = ?1 AND san = 'e4'",
                params![start],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(after, (0, 1, 0), "nur noch die verbliebene Partie");

        // Was allein an der entfernten Sammlung hing, ist ganz weg.
        let d4: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ref_book WHERE fen_key = ?1 AND san = 'd4'",
                params![start],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(d4, 0, "leere Zeilen bleiben nicht stehen");

        let games: i64 = conn
            .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(games, 1, "die Partien der anderen Sammlung bleiben");

        // Die Sammlungszeile beschreibt, was in der Datei steht · sie wird
        // blockweise mitgeschrieben und nicht erst am Ende.
        let left: i64 = conn
            .query_row("SELECT games FROM ref_sources WHERE id = 2", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(left, 1);

        // Die Musterpartie der Zeile darf nicht auf eine gelöschte zeigen.
        let dangling: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ref_book b
                 WHERE b.game_id > 0
                   AND NOT EXISTS (SELECT 1 FROM ref_games g WHERE g.id = b.game_id)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dangling, 0);
        drop(conn);
        cleanup(&target);
    }

    /// Sechs echte Eröffnungslinien · Präfixe daraus überschneiden sich stark
    /// und erzeugen genau die geteilten Buchzeilen, um die es hier geht.
    const LINES: [&str; 6] = [
        "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7",
        "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6",
        "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O",
        "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O",
        "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5",
        "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O",
    ];

    /// `n` Partien, deterministisch aus den Linien oben.
    fn sample_games(tag: &str, n: usize) -> Vec<RawGame> {
        (0..n)
            .map(|i| {
                let line = LINES[i % LINES.len()];
                let plies = 4 + (i * 3) % 7;
                let mut g = RawGame::empty();
                g.white = format!("{tag}-W{i}");
                g.black = format!("{tag}-B{i}");
                g.date = format!("2026.01.{:02}", 1 + i % 28);
                g.result = match i % 4 {
                    0 => "1-0",
                    1 => "0-1",
                    2 => "1/2-1/2",
                    // Jede vierte ohne Ergebnis · sie wird gespeichert, zahlt
                    // aber nicht ins Buch ein. Auch das muss beim Entfernen
                    // gleich behandelt werden.
                    _ => "*",
                }
                .into();
                g.white_elo = if i % 3 == 0 {
                    0
                } else {
                    2000 + (i as i32 % 700)
                };
                g.black_elo = if i % 5 == 0 {
                    0
                } else {
                    1900 + (i as i32 % 800)
                };
                g.sans = line.split(' ').take(plies).map(String::from).collect();
                g
            })
            .collect()
    }

    /// Die Bilanz des ganzen Buchs · ohne Musterpartie, die das Entfernen
    /// bewusst zurücksetzt.
    fn book_snapshot(conn: &Connection) -> Vec<(String, String, i64, i64, i64, i64, i64)> {
        let mut stmt = conn
            .prepare(
                "SELECT fen_key, san, white, draws, black, elo_sum, elo_n
                 FROM ref_book ORDER BY fen_key, san",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }

    /// Der Prüfstein des ganzen Verfahrens.
    ///
    /// Das Buch ist eine Bilanz, kein Archiv · eine Sammlung daraus zu
    /// entfernen heißt, ihre Partien noch einmal abzuspielen und abzuziehen,
    /// was der Import addiert hat. Ob Addieren und Subtrahieren wirklich
    /// dieselben Zeilen treffen, sieht man nur am Ergebnis: Was nach dem
    /// Entfernen dasteht, muss Zeile für Zeile dem gleichen, was ohne die
    /// entfernte Sammlung von Anfang an dagestanden hätte.
    #[test]
    fn removing_a_collection_restores_the_book_it_would_have_been() {
        // Zwei Sammlungen, dann die zweite wieder heraus.
        let both = scratch("both");
        drop_conn(ingest_source(
            &both,
            1,
            "keep.pgn",
            sample_games("keep", 140),
        ));
        let mut conn = ingest_source(&both, 2, "drop.pgn", sample_games("drop", 90));
        let cancel = AtomicBool::new(false);
        let (removed, cancelled) = shrink_source(&mut conn, 2, &cancel, &mut |_, _| {}).unwrap();
        assert_eq!((removed, cancelled), (90, false));
        let after = book_snapshot(&conn);
        drop_conn(conn);

        // Dieselbe erste Sammlung allein.
        let alone = scratch("alone");
        let conn = ingest_source(&alone, 1, "keep.pgn", sample_games("keep", 140));
        let expected = book_snapshot(&conn);
        drop_conn(conn);

        assert!(!expected.is_empty(), "der Vergleich braucht ein Buch");
        assert_eq!(after, expected);
        cleanup(&both);
        cleanup(&alone);
    }

    /// `Connection::close` gibt es nur als Selbstverbrauch · das liest sich in
    /// den Tests oben als eine Zeile besser.
    fn drop_conn(conn: Connection) {
        drop(conn);
    }

    /// Was vor den Sammlungen eingelesen wurde, bekommt beim Öffnen eine.
    #[test]
    fn adopts_what_was_there_before_collections() {
        let target = scratch("legacy");
        {
            let conn = Connection::open(&target).unwrap();
            conn.execute_batch(
                "CREATE TABLE ref_games (
                    id        INTEGER PRIMARY KEY,
                    white     TEXT NOT NULL DEFAULT '',
                    black     TEXT NOT NULL DEFAULT '',
                    white_elo INTEGER NOT NULL DEFAULT 0,
                    black_elo INTEGER NOT NULL DEFAULT 0,
                    result    TEXT NOT NULL DEFAULT '',
                    played_at TEXT NOT NULL DEFAULT '',
                    event     TEXT NOT NULL DEFAULT '',
                    eco       TEXT NOT NULL DEFAULT '',
                    moves     TEXT NOT NULL DEFAULT ''
                 );
                 CREATE TABLE ref_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO ref_meta (key, value) VALUES ('source', 'AJ-COR.db3');
                 INSERT INTO ref_games (id, result, moves) VALUES (1, '1-0', 'e4 c5');
                 INSERT INTO ref_games (id, result, moves) VALUES (2, '0-1', 'd4 d5');",
            )
            .unwrap();
        }
        let conn = open(&target).unwrap();
        let sources = source_list(&conn);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, 0, "der Altbestand behält seine Kennung");
        assert_eq!(sources[0].name, "AJ-COR.db3");
        assert_eq!(
            sources[0].games, 2,
            "lückenlose Kennungen zählen sich selbst"
        );
        drop(conn);
        cleanup(&target);
    }

    /// Wie schnell der Import ist · misst den Weg von der fertig gelesenen
    /// Partie bis in die Referenzdatei, also Buchführung und Schreiben.
    ///
    /// Läuft nicht mit; er braucht eine Sammlung, die nicht im Repository liegt:
    ///
    /// ```notrust
    /// KIEBITZ_DB3="…/MillionBase.db3" KIEBITZ_BENCH_GAMES=200000     ///   cargo test --release --lib refdb::tests::bench_ingest -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "Messlauf; braucht eine .db3-Sammlung in KIEBITZ_DB3"]
    fn bench_ingest() {
        let path = std::env::var("KIEBITZ_DB3").expect("KIEBITZ_DB3 nicht gesetzt");
        let count: usize = std::env::var("KIEBITZ_BENCH_GAMES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100_000);

        let target = std::env::temp_dir().join(format!("kiebitz-bench-{}.sqlite", now_secs()));
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
        let env_num = |name: &str, fallback: i64| -> i64 {
            std::env::var(name)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(fallback)
        };
        let cache = env_num("KIEBITZ_BENCH_CACHE", import_cache_kib() as i64) as i32;
        let flush = env_num("KIEBITZ_BENCH_FLUSH", flush_games() as i64) as u64;
        let sorted = env_num("KIEBITZ_BENCH_SORT", 1) != 0;

        let conn = open(&target).unwrap();
        let _ = conn.pragma_update(None, "synchronous", "OFF");
        let _ = conn.pragma_update(None, "cache_size", cache);
        let _ = conn.pragma_update(None, "temp_store", "MEMORY");
        let mut ingest = Ingest::new(conn, 1, HashSet::new());
        ingest.flush_every = flush.max(1);
        ingest.sorted = sorted;
        println!("Puffer {cache} KiB · Block {flush} Partien · sortiert {sorted}");

        // Blockweise statt alles auf einmal: Anderthalb Millionen dekodierte
        // Partien wären zwei Gigabyte Zeichenketten, bevor die erste davon
        // geschrieben wäre.
        let src = Connection::open(&path).unwrap();
        let mut stmt = src
            .prepare("SELECT FEN, Moves, Result, WhiteElo, BlackElo FROM Games LIMIT ?1 OFFSET ?2")
            .unwrap();

        let chunk = 25_000usize;
        let mut decode_secs = 0.0;
        let mut ingest_secs = 0.0;
        let mut offset = 0usize;
        while offset < count {
            let take = chunk.min(count - offset);
            let rows: Vec<(String, Vec<u8>, String, i32, i32)> = stmt
                .query_map(params![take as i64, offset as i64], |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        r.get(1)?,
                        text_column(r, 2),
                        r.get(3).unwrap_or(0),
                        r.get(4).unwrap_or(0),
                    ))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            if rows.is_empty() {
                break;
            }
            offset += rows.len();

            let started = std::time::Instant::now();
            let games: Vec<RawGame> = rows
                .iter()
                .filter_map(|(fen, bytes, result, we, be)| {
                    let start = crate::db3::start_position(fen)?;
                    let decoded = crate::db3::decode_mainline(&start, bytes)?;
                    let mut game = RawGame::empty();
                    game.result = db3_result(result);
                    game.white_elo = *we;
                    game.black_elo = *be;
                    game.sans = decoded.sans;
                    Some(game)
                })
                .collect();
            decode_secs += started.elapsed().as_secs_f64();

            let started = std::time::Instant::now();
            for game in games {
                ingest.absorb(game).unwrap();
            }
            ingest_secs += started.elapsed().as_secs_f64();
        }

        let started = std::time::Instant::now();
        ingest.flush().unwrap();
        ingest_secs += started.elapsed().as_secs_f64();

        let positions: i64 = ingest
            .conn
            .query_row("SELECT COUNT(*) FROM ref_book", [], |r| r.get(0))
            .unwrap();
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        println!(
            "{} Partien · dekodieren {decode_secs:.1} s ({:.0}/s) · einlesen {ingest_secs:.1} s ({:.0}/s)",
            ingest.kept,
            ingest.kept as f64 / decode_secs,
            ingest.kept as f64 / ingest_secs,
        );
        println!(
            "Buch: {positions} Zeilen · Datei {:.0} MB",
            size as f64 / 1e6
        );
        drop(ingest);
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", target.display()));
        }
    }
}
