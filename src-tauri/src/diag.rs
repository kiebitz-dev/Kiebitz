//! Diagnose: Logbuch, Absturzberichte und der Datensatz, den ein Nutzer einer
//! Rückmeldung beilegen kann.
//!
//! Kiebitz sendet von sich aus nichts. Deshalb ist das hier kein Telemetrie-,
//! sondern ein Protokollmodul: Ereignisse landen in einem Ringpuffer im Speicher
//! und in einer Datei neben der Datenbank, und der Nutzer entscheidet, ob er den
//! Bericht mitschickt. Der Bericht enthält bewusst keine Kontonamen und keine
//! Partieinhalte · nur Versionen, Pfade, Zählwerte und die letzten Logzeilen.
//!
//! Der Puffer ist prozessglobal statt Tauri-State, weil auch der Panic-Hook und
//! der `log`-Adapter hineinschreiben · beide haben kein `AppHandle`.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// So viele Zeilen hält der Speicher; die Datei reicht weiter zurück.
const BUFFER_LINES: usize = 400;
/// Ab dieser Größe wird die Logdatei einmal weggerollt.
const MAX_LOG_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogEntry {
    /// Unix-Sekunden.
    pub ts: i64,
    /// "error", "warn", "info" oder "debug".
    pub level: String,
    /// Woher die Zeile kommt: "ui", "engine", "sync", "panic" …
    pub source: String,
    pub message: String,
}

static BUFFER: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());
static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Kürzt und entschärft eine Zeile: keine Zeilenumbrüche, begrenzte Länge.
fn clean(value: &str, max: usize) -> String {
    value
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn normalize_level(level: &str) -> String {
    match level.to_ascii_lowercase().as_str() {
        "error" | "warn" | "info" | "debug" => level.to_ascii_lowercase(),
        _ => "info".to_string(),
    }
}

/// Legt fest, wohin das Logbuch geschrieben wird. Vor diesem Aufruf sammelt der
/// Ringpuffer trotzdem schon Zeilen · sie gehen dann nur nicht in die Datei.
pub fn set_log_file(path: PathBuf) {
    if let Ok(mut slot) = LOG_FILE.lock() {
        *slot = Some(path);
    }
}

fn append_to_file(entry: &LogEntry) {
    let Ok(slot) = LOG_FILE.lock() else { return };
    let Some(path) = slot.as_ref() else { return };
    // Eine Rotation, kein Archiv: die vorige Datei bleibt als .1 liegen.
    if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > MAX_LOG_BYTES {
        let _ = std::fs::rename(path, path.with_extension("log.1"));
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(
            file,
            "{} [{}] {}: {}",
            entry.ts, entry.level, entry.source, entry.message
        );
    }
}

/// Schreibt eine Zeile ins Logbuch · aus dem Frontend, aus Rust oder aus dem
/// Panic-Hook. Fehler beim Schreiben bleiben still: ein Logbuch darf nie die
/// Ursache eines weiteren Problems sein.
pub fn record(level: &str, source: &str, message: &str) {
    let entry = LogEntry {
        ts: now_ts(),
        level: normalize_level(level),
        source: clean(source, 40),
        message: clean(message, 2_000),
    };
    if let Ok(mut buffer) = BUFFER.lock() {
        if buffer.len() >= BUFFER_LINES {
            buffer.pop_front();
        }
        buffer.push_back(entry.clone());
    }
    append_to_file(&entry);
}

/// Leitet `log::warn!` und Co. ins Logbuch. Wird nur registriert, wenn nicht
/// schon das Log-Plugin (Debug-Builds) den globalen Logger belegt hat.
struct DiagLogger;

impl log::Log for DiagLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record_data: &log::Record) {
        if !self.enabled(record_data.metadata()) {
            return;
        }
        record(
            &record_data.level().to_string(),
            record_data.target(),
            &record_data.args().to_string(),
        );
    }

    fn flush(&self) {}
}

/// Panic-Hook und `log`-Adapter einhängen. Beides ist bewusst tolerant: ist der
/// globale Logger schon belegt (Debug-Builds nutzen das Log-Plugin), bleibt es
/// beim Panic-Hook.
pub fn install() {
    if log::set_boxed_logger(Box::new(DiagLogger)).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unbekannt".into());
        record("error", "panic", &format!("{info} · bei {location}"));
        default_hook(info);
    }));
}

#[tauri::command(async)]
pub fn log_event(level: String, source: String, message: String) {
    record(&level, &source, &message);
}

#[tauri::command(async)]
pub fn diag_logs(limit: Option<usize>) -> Vec<LogEntry> {
    let take = limit.unwrap_or(BUFFER_LINES).min(BUFFER_LINES);
    let Ok(buffer) = BUFFER.lock() else {
        return Vec::new();
    };
    buffer
        .iter()
        .skip(buffer.len().saturating_sub(take))
        .cloned()
        .collect()
}

#[tauri::command(async)]
pub fn diag_clear() {
    if let Ok(mut buffer) = BUFFER.lock() {
        buffer.clear();
    }
    if let Ok(slot) = LOG_FILE.lock() {
        if let Some(path) = slot.as_ref() {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(path.with_extension("log.1"));
        }
    }
    record("info", "app", "Logbuch geleert");
}

#[tauri::command(async)]
pub fn diag_log_path() -> String {
    LOG_FILE
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|p| p.to_string_lossy().to_string()))
        .unwrap_or_default()
}

/// Technischer Bericht für eine Rückmeldung · alles, was bei einem Fehler hilft,
/// und nichts, was den Nutzer identifiziert. Kontonamen, Partien, Notizen und
/// der Sync-Code bleiben draußen; von den Pfaden interessiert nur, ob der
/// Standardort benutzt wird.
#[tauri::command(async)]
pub fn diag_report(app: tauri::AppHandle, db: tauri::State<crate::db::Db>) -> String {
    let mut out = String::new();
    let package = app.package_info();
    out.push_str(&format!("Kiebitz {}\n", package.version));
    out.push_str(&format!(
        "Plattform: {} ({})\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    let distribution = crate::build_info::distribution_channel();
    out.push_str(&format!("Vertriebskanal: {distribution}\n"));
    out.push_str(&format!(
        "Build: {}\n",
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    ));

    match crate::resolve_engine(&app) {
        Some(path) => out.push_str(&format!(
            "Engine: gefunden ({})\n",
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        )),
        None => out.push_str("Engine: nicht gefunden\n"),
    }

    if let Ok(settings) = app.state::<crate::settings::SettingsState>().0.lock() {
        out.push_str(&format!(
            "Einstellungen: locale={} engine_threads={} live_depth={} batch_depth={} \
             chessdb={} auto_import={} auto_update={} sync_enabled={} sync_auto={} \
             notify={} sound={} eigene_engine={} syzygy={} eigener_db_pfad={}\n",
            settings.locale,
            settings.engine_threads,
            settings.live_depth,
            settings.batch_depth,
            settings.chessdb_enabled,
            settings.auto_import,
            settings.auto_update,
            settings.sync_enabled,
            settings.sync_auto,
            settings.notify_enabled,
            settings.sound_enabled,
            settings.engine_path.is_some(),
            settings.syzygy_path.is_some(),
            settings.db_path.is_some(),
        ));
    }

    if let Ok(conn) = db.0.lock() {
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(-1) };
        out.push_str(&format!(
            "Datenbank: {} Partien, {} Puzzles, {} Puzzle-Versuche, {} Repertoire-Knoten, \
             {} Zug-Bewertungen, {} Kalendereinträge\n",
            count("SELECT COUNT(*) FROM games"),
            count("SELECT COUNT(*) FROM puzzles"),
            count("SELECT COUNT(*) FROM puzzle_attempts"),
            count("SELECT COUNT(*) FROM rep_nodes"),
            count("SELECT COUNT(*) FROM move_evals"),
            count("SELECT COUNT(*) FROM study_events WHERE deleted = 0"),
        ));
        out.push_str(&format!(
            "Partien mit Uhrendaten: {}\n",
            count("SELECT COUNT(*) FROM games WHERE clocks != ''")
        ));
    }

    out.push_str("\nLetzte Logzeilen:\n");
    let entries = diag_logs(Some(60));
    if entries.is_empty() {
        out.push_str("(leer)\n");
    }
    for entry in entries {
        out.push_str(&format!(
            "{} [{}] {}: {}\n",
            entry.ts, entry.level, entry.source, entry.message
        ));
    }
    out
}

/// Schreibt einen Bericht in eine Datei · für "Bericht speichern" im UI.
#[tauri::command(async)]
pub fn diag_save_report(path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Zielpfad angegeben.".into());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    std::fs::write(&path, contents).map_err(|e| format!("Bericht nicht speicherbar: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ein Test für beides: der Puffer ist prozessglobal, zwei parallel
    /// laufende Tests würden sich gegenseitig die Zeilen wegräumen.
    #[test]
    fn cleans_normalizes_and_caps_log_lines() {
        diag_clear();
        record("SHOUTING", "ui", "erste\nZeile");
        record("nonsense", "ui", "zweite");
        let entries = diag_logs(None);
        // diag_clear schreibt selbst eine Zeile · sie steht vor den beiden.
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[1].level, "info", "unbekannte Stufen werden info");
        assert_eq!(entries[1].message, "erste Zeile", "keine Zeilenumbrüche");
        assert_eq!(entries[2].message, "zweite");
        assert_eq!(entries[2].source, "ui");
        assert!(entries[2].ts > 0);
        assert_eq!(record_level("ERROR"), "error");

        for i in 0..(BUFFER_LINES + 25) {
            record("info", "test", &format!("Zeile {i}"));
        }
        let entries = diag_logs(None);
        assert_eq!(entries.len(), BUFFER_LINES, "der Ringpuffer wächst nicht");
        assert_eq!(
            entries.last().unwrap().message,
            format!("Zeile {}", BUFFER_LINES + 24)
        );
        assert_eq!(diag_logs(Some(5)).len(), 5);
        diag_clear();
    }

    fn record_level(level: &str) -> String {
        normalize_level(level)
    }
}
