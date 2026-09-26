//! Endspiel-Trainer: die Engine spielt die Gegenseite theoretischer
//! Endspiele (Lucena, Philidor, Grundmatts …), der Fortschritt pro Drill
//! landet in `endgame_attempts`. Die Drill-Definitionen selbst leben im
//! Frontend (`src/data/endgames.ts`) · hier gibt es nur Züge und Zahlen.

use crate::{db, engine::UciEngine, settings};
use rusqlite::params;
use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

/// Suchtiefe der Verteidiger-Züge. Endspiele mit wenigen Steinen sind bei
/// dieser Tiefe praktisch sofort fertig; mit Syzygy-Tablebases spielt die
/// Engine ohnehin perfekt.
const REPLY_DEPTH: u32 = 20;

/// Persistente Engine des Endspiel-Trainers (eigene Instanz, damit sie der
/// Live-Analyse nicht in die Quere kommt). Wird bei Einstellungsänderungen
/// verworfen und beim nächsten Zug neu gestartet.
#[derive(Default)]
pub struct EndgameEngine(pub Mutex<Option<UciEngine>>);

impl EndgameEngine {
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None; // Drop sendet `quit`.
        }
    }
}

/// Liefert den Engine-Zug (UCI) für die Gegenseite in der Stellung `fen`.
#[tauri::command]
pub async fn endgame_move(app: tauri::AppHandle, fen: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || endgame_move_blocking(&app, &fen))
        .await
        .map_err(|e| format!("Engine-Zug fehlgeschlagen: {e}"))?
}

fn endgame_move_blocking(app: &tauri::AppHandle, fen: &str) -> Result<String, String> {
    let path = crate::resolve_engine(app).ok_or("Keine Engine gefunden")?;
    let state = app.state::<EndgameEngine>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let mut uci = UciEngine::spawn(&path.to_string_lossy())?;
        // Kleine Instanz reicht; mit Tablebases (falls konfiguriert) perfekt.
        let _ = uci.set_option("Threads", "1");
        let _ = uci.set_option("Hash", "64");
        let syzygy = app
            .state::<settings::SettingsState>()
            .0
            .lock()
            .ok()
            .and_then(|s| s.syzygy_path.clone());
        if let Some(dir) = syzygy {
            let _ = uci.set_option("SyzygyPath", &dir);
        }
        *guard = Some(uci);
    }
    match guard.as_mut().unwrap().analyze(fen, REPLY_DEPTH) {
        Ok(r) if !r.bestmove.is_empty() && r.bestmove != "(none)" => Ok(r.bestmove),
        Ok(_) => Err("Keine Züge möglich · die Partie ist beendet.".into()),
        Err(e) => {
            // Engine-Prozess gestorben · verwerfen, nächster Aufruf startet neu.
            *guard = None;
            Err(e)
        }
    }
}

#[derive(Serialize)]
pub struct DrillStat {
    pub drill_id: String,
    pub attempts: i64,
    pub solved: i64,
    pub last_solved_ts: Option<i64>,
}

/// Verbucht einen abgeschlossenen Versuch (Erfolg oder Fehlschlag).
#[tauri::command(async)]
pub fn endgame_record(
    db: tauri::State<db::Db>,
    drill_id: String,
    solved: bool,
    moves: i64,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    record_attempt(&conn, &drill_id, solved, moves, now)
}

fn record_attempt(
    conn: &rusqlite::Connection,
    drill_id: &str,
    solved: bool,
    moves: i64,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO endgame_attempts (drill_id, ts, solved, moves) VALUES (?1, ?2, ?3, ?4)",
        params![drill_id, now, solved as i64, moves],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fortschritt je Drill (Versuche, Erfolge, letzter Erfolg).
#[tauri::command(async)]
pub fn endgame_stats(db: tauri::State<db::Db>) -> Result<Vec<DrillStat>, String> {
    db.read(stats)
}

fn stats(conn: &rusqlite::Connection) -> Result<Vec<DrillStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT drill_id, COUNT(*), SUM(solved),
                    MAX(CASE WHEN solved = 1 THEN ts END)
             FROM endgame_attempts GROUP BY drill_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(DrillStat {
                drill_id: r.get(0)?,
                attempts: r.get(1)?,
                solved: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                last_solved_ts: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn records_and_aggregates_drill_progress() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        record_attempt(&conn, "lucena", false, 12, 100).unwrap();
        record_attempt(&conn, "lucena", true, 8, 200).unwrap();
        record_attempt(&conn, "philidor", false, 10, 300).unwrap();

        let all = stats(&conn).unwrap();
        let lucena = all.iter().find(|s| s.drill_id == "lucena").unwrap();
        assert_eq!(lucena.attempts, 2);
        assert_eq!(lucena.solved, 1);
        assert_eq!(lucena.last_solved_ts, Some(200));

        let philidor = all.iter().find(|s| s.drill_id == "philidor").unwrap();
        assert_eq!(philidor.attempts, 1);
        assert_eq!(philidor.solved, 0);
        assert_eq!(philidor.last_solved_ts, None);
    }

    #[test]
    fn shutting_down_an_empty_engine_is_safe() {
        let engine = EndgameEngine::default();
        engine.shutdown();
        assert!(engine.0.lock().unwrap().is_none());
    }
}
