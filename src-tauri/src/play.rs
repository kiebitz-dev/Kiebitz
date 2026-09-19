//! Gegen die Engine spielen · eine ganze Partie, aus der Grundstellung, aus
//! einer Chess960-Aufstellung oder aus jeder Stellung der Analyse heraus.
//!
//! Der Endspiel-Trainer hat dafür schon eine Engine, aber für einen anderen
//! Zweck: Dort verteidigt sie perfekt, hier soll sie so stark spielen, wie man
//! es einstellt. Deshalb eine eigene Instanz, die ihre Stärke und die
//! Chess960-Regel nur umstellt, wenn sich beides ändert.
//!
//! Die Stellung geht als Ausgangs-FEN plus Zugliste an die Engine und nicht als
//! FEN der aktuellen Stellung: Nur so kennt Stockfish die Vorgeschichte und
//! weiß, dass eine Wiederholung Remis ist. Die Zugliste kommt aus der
//! Oberfläche und wird deshalb Zeichen für Zeichen geprüft, bevor sie in ein
//! UCI-Kommando wandert.

use crate::{engine::UciEngine, settings};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

/// Unter dieser Wertung bietet Stockfish kein `UCI_Elo` an · darunter
/// schwächt die Stufe über Skill Level und eine flache Suche ab.
const MIN_UCI_ELO: u32 = 1320;
/// Darüber spielt die Engine ohnehin mit voller Kraft.
const MAX_UCI_ELO: u32 = 3190;

struct Session {
    uci: UciEngine,
    chess960: bool,
    /// Zuletzt gesetzte Stärke · `0` heißt volle Kraft.
    elo: Option<u32>,
}

#[derive(Default)]
pub struct PlayEngine(Mutex<Option<Session>>);

impl PlayEngine {
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    /// Ausgangsstellung der Partie.
    pub start_fen: String,
    /// Bisher gespielte Züge in UCI · in Chess960 die Rochade als König auf Turm.
    pub moves: Vec<String>,
    #[serde(default)]
    pub chess960: bool,
    /// Angestrebte Spielstärke · `0` heißt volle Kraft.
    #[serde(default)]
    pub elo: u32,
    /// Bedenkzeit je Zug.
    #[serde(default = "default_movetime")]
    pub movetime_ms: u32,
}

fn default_movetime() -> u32 {
    800
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayReply {
    pub bestmove: String,
    /// Bewertung aus Sicht der Engine · nur als Auskunft, nicht zum Anzeigen
    /// während der Partie.
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
}

/// Wie die Engine für eine Stufe sucht · Optionen und `go`-Begrenzung.
#[derive(Debug, PartialEq)]
struct Strength {
    limit: bool,
    uci_elo: Option<u32>,
    skill: u32,
    go: String,
}

fn strength(elo: u32, movetime_ms: u32) -> Strength {
    let movetime = movetime_ms.clamp(50, 30_000);
    if elo == 0 || elo >= MAX_UCI_ELO {
        return Strength {
            limit: false,
            uci_elo: None,
            skill: 20,
            go: format!("go movetime {movetime}"),
        };
    }
    if elo >= MIN_UCI_ELO {
        return Strength {
            limit: true,
            uci_elo: Some(elo),
            skill: 20,
            go: format!("go movetime {movetime}"),
        };
    }
    // Unter 1320: Skill Level 0 und eine flache Suche. Tiefe 1 übersieht
    // fast alles, Tiefe 3 hält wenigstens einzügige Drohungen.
    let depth = match elo {
        0..=699 => 1,
        700..=1049 => 2,
        _ => 3,
    };
    Strength {
        limit: false,
        uci_elo: None,
        skill: 0,
        go: format!("go depth {depth}"),
    }
}

/// Prüft eine FEN für die Engine · in Chess960 ohne Rochadefeld, das owlchess
/// in dieser Form nicht kennt. Geprüft wird ohnehin nur, ob die Stellung
/// möglich ist (siehe `chess::engine_fen`).
fn checked_fen(fen: &str, chess960: bool) -> Result<String, String> {
    let fen = fen.trim();
    if fen.contains(|c: char| c.is_control()) {
        return Err("Ungültige FEN".into());
    }
    let parts: Vec<&str> = fen.split_whitespace().collect();
    if parts.len() < 4 {
        return Err("Ungültige FEN".into());
    }
    if chess960 {
        let castling = parts[2];
        if !castling
            .chars()
            .all(|c| c == '-' || c.is_ascii_alphabetic())
            || castling.len() > 4
        {
            return Err("Ungültige FEN".into());
        }
        let mut probe = parts.clone();
        probe[2] = "-";
        crate::chess::engine_fen(&probe.join(" "))?;
    } else {
        crate::chess::engine_fen(fen)?;
    }
    Ok(parts.join(" "))
}

/// Ein Zug in UCI · alles andere wäre ein Kommando, kein Zug.
fn valid_uci(token: &str) -> bool {
    let b = token.as_bytes();
    (b.len() == 4 || b.len() == 5)
        && (b'a'..=b'h').contains(&b[0])
        && (b'1'..=b'8').contains(&b[1])
        && (b'a'..=b'h').contains(&b[2])
        && (b'1'..=b'8').contains(&b[3])
        && (b.len() == 4 || matches!(b[4], b'q' | b'r' | b'b' | b'n'))
}

fn position_command(request: &PlayRequest) -> Result<String, String> {
    let fen = checked_fen(&request.start_fen, request.chess960)?;
    if let Some(bad) = request.moves.iter().find(|m| !valid_uci(m)) {
        return Err(format!("Ungültiger Zug: {bad}"));
    }
    Ok(if request.moves.is_empty() {
        format!("position fen {fen}")
    } else {
        format!("position fen {fen} moves {}", request.moves.join(" "))
    })
}

/// Der Zug der Engine in der Stellung nach `moves`.
#[tauri::command]
pub async fn play_move(app: tauri::AppHandle, request: PlayRequest) -> Result<PlayReply, String> {
    tauri::async_runtime::spawn_blocking(move || play_move_blocking(&app, &request))
        .await
        .map_err(|e| format!("Engine-Zug fehlgeschlagen: {e}"))?
}

fn play_move_blocking(app: &tauri::AppHandle, request: &PlayRequest) -> Result<PlayReply, String> {
    let position = position_command(request)?;
    let plan = strength(request.elo, request.movetime_ms);
    let path = crate::resolve_engine(app).ok_or("Keine Engine gefunden")?;
    let state = app.state::<PlayEngine>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let mut uci = UciEngine::spawn(&path.to_string_lossy())?;
        let configured = app
            .state::<settings::SettingsState>()
            .0
            .lock()
            .map(|s| s.engine_threads)
            .unwrap_or(0);
        // Höchstens vier Fäden · die Partie soll den Rechner nicht auslasten,
        // und für begrenzte Stufen zählt die Bedenkzeit mehr als die Breite.
        let threads = UciEngine::configured_worker_threads(configured).min(4);
        let _ = uci.set_option("Threads", &threads.to_string());
        let _ = uci.set_option("Hash", "64");
        *guard = Some(Session {
            uci,
            chess960: false,
            elo: None,
        });
    }
    let session = guard.as_mut().unwrap();
    if session.chess960 != request.chess960 {
        let _ = session.uci.set_option(
            "UCI_Chess960",
            if request.chess960 { "true" } else { "false" },
        );
        session.chess960 = request.chess960;
    }
    if session.elo != Some(request.elo) {
        // Nicht jede UCI-Engine kennt diese Optionen · eine eigene Engine ohne
        // sie spielt dann eben mit voller Kraft.
        let _ = session.uci.set_option(
            "UCI_LimitStrength",
            if plan.limit { "true" } else { "false" },
        );
        if let Some(elo) = plan.uci_elo {
            let _ = session.uci.set_option("UCI_Elo", &elo.to_string());
        }
        let _ = session
            .uci
            .set_option("Skill Level", &plan.skill.to_string());
        session.elo = Some(request.elo);
    }
    match session.uci.search(&position, &plan.go) {
        Ok(r) if !r.bestmove.is_empty() && r.bestmove != "(none)" => Ok(PlayReply {
            bestmove: r.bestmove,
            eval_cp: r.eval_cp,
            mate_in: r.mate_in,
        }),
        Ok(_) => Err("Keine Züge möglich · die Partie ist beendet.".into()),
        Err(e) => {
            *guard = None;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(moves: &[&str]) -> PlayRequest {
        PlayRequest {
            start_fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            moves: moves.iter().map(|m| m.to_string()).collect(),
            chess960: false,
            elo: 0,
            movetime_ms: 100,
        }
    }

    #[test]
    fn sends_moves_after_the_start_position() {
        assert_eq!(
            position_command(&request(&["e2e4", "e7e5", "g1f3"])).unwrap(),
            "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3"
        );
    }

    #[test]
    fn refuses_anything_that_is_not_a_move() {
        assert!(position_command(&request(&["e2e4", "quit"])).is_err());
        assert!(position_command(&request(&["e7e8k"])).is_err());
        assert!(position_command(&request(&["e2e4\nquit"])).is_err());
    }

    #[test]
    fn accepts_chess960_castling_fields() {
        let mut req = request(&["b1e1"]);
        req.start_fen = "1k6/8/8/8/8/8/8/RK2R3 w EA - 0 1".into();
        req.chess960 = true;
        assert!(position_command(&req).is_ok());
    }

    #[test]
    fn maps_levels_to_engine_options() {
        assert_eq!(strength(0, 500).go, "go movetime 500");
        assert!(!strength(0, 500).limit);
        let club = strength(1600, 500);
        assert!(club.limit);
        assert_eq!(club.uci_elo, Some(1600));
        let beginner = strength(600, 500);
        assert_eq!(beginner.skill, 0);
        assert_eq!(beginner.go, "go depth 1");
    }
}
