//! Engine gegen Engine · ein kleines Turnier in den Einstellungen.
//!
//! Wer eine zweite Engine einträgt, will früher oder später wissen, welche
//! stärker ist. Das ist keine Trainingsfunktion und steht deshalb dort, wo die
//! Engines verwaltet werden, und nicht neben Analyse und Training.
//!
//! Gespielt wird jeder gegen jeden, je Durchgang mit getauschten Farben, mit
//! fester Bedenkzeit je Zug. Die Regeln kommen aus owlchess: Matt, Patt,
//! ungenügendes Material, 50 Züge und Wiederholung erkennt `MoveChain` selbst.
//! Ein Zug, den die Engine nicht legal spielen kann, beendet die Partie zu
//! ihren Ungunsten · so hängt kein Turnier an einer Engine, die sich vertut.
//!
//! Der Lauf hängt an einem eigenen Faden und meldet sich über
//! `tournament://progress`. Die Oberfläche fragt den Stand außerdem beim
//! Öffnen ab (`tournament_status`), damit ein laufendes Turnier auch nach
//! einem Seitenwechsel wieder sichtbar ist.

use crate::engine::UciEngine;
use owlchess::chain::{GameStatusPolicy, MoveChain, NumberPolicy};
use owlchess::moves::make;
use owlchess::moves::Style;
use owlchess::{Color, DrawReason, Outcome, WinReason};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Höchstens acht Teilnehmer · darüber wächst ein Rundenturnier ins
/// Unabsehbare (acht Engines sind schon 28 Partien je Durchgang).
const MAX_ENGINES: usize = 8;
const MAX_ROUNDS: u32 = 20;

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct EngineRef {
    pub name: String,
    pub path: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TournamentConfig {
    pub engines: Vec<EngineRef>,
    /// Bedenkzeit je Zug.
    pub movetime_ms: u32,
    /// Durchgänge · jeder Durchgang ist ein vollständiges Rundenturnier mit
    /// getauschten Farben.
    pub rounds: u32,
    /// Ab hier gilt die Partie als remis · sonst zögen zwei gleich starke
    /// Engines ein Endspiel über tausend Züge.
    #[serde(default = "default_max_plies")]
    pub max_plies: u32,
    #[serde(default)]
    pub threads: u32,
    #[serde(default = "default_hash")]
    pub hash_mb: u32,
}

fn default_max_plies() -> u32 {
    300
}
fn default_hash() -> u32 {
    64
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Standing {
    pub name: String,
    /// Punkte in Halben · zwei Punkte je Sieg, einer je Remis. So bleibt die
    /// Zahl ganz und die Oberfläche teilt sie erst beim Anzeigen.
    pub half_points: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayedGame {
    pub round: u32,
    pub white: String,
    pub black: String,
    /// „1-0", „0-1" oder „1/2-1/2".
    pub result: String,
    /// Warum die Partie endete · als Schlüssel, übersetzt wird vorn.
    pub reason: String,
    pub plies: u32,
    pub moves: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TournamentStatus {
    pub running: bool,
    pub played: u32,
    pub total: u32,
    /// Die laufende Partie · Namen, Stellung und Halbzug.
    pub white: String,
    pub black: String,
    pub fen: String,
    pub plies: u32,
    pub standings: Vec<Standing>,
    pub games: Vec<PlayedGame>,
    pub error: Option<String>,
    pub cancelled: bool,
}

#[derive(Default)]
pub struct TournamentState {
    status: Mutex<TournamentStatus>,
    cancel: AtomicBool,
    running: AtomicBool,
}

/// Die Paarungen eines Rundenturniers · je Durchgang jeder gegen jeden, und
/// im zweiten Durchgang hat die andere Seite Weiß.
fn schedule(count: usize, rounds: u32) -> Vec<(u32, usize, usize)> {
    let mut games = Vec::new();
    for round in 0..rounds {
        for i in 0..count {
            for j in (i + 1)..count {
                let (white, black) = if round % 2 == 0 { (i, j) } else { (j, i) };
                games.push((round + 1, white, black));
            }
        }
    }
    games
}

/// Ergebnis und Grund, wie die Oberfläche sie liest · `adjudicated` ist der
/// Abbruch am Zuglimit und kein Remis nach Regel.
fn outcome_text(outcome: Outcome, adjudicated: bool) -> (String, String) {
    if adjudicated {
        return ("1/2-1/2".into(), "adjudicated".into());
    }
    let reason = match outcome {
        Outcome::Win { reason, .. } => match reason {
            WinReason::Checkmate => "mate",
            WinReason::InvalidMove => "invalidMove",
            WinReason::EngineError => "engineError",
            _ => "other",
        },
        Outcome::Draw(reason) => match reason {
            DrawReason::Stalemate => "stalemate",
            DrawReason::InsufficientMaterial => "insufficient",
            DrawReason::Moves50 | DrawReason::Moves75 => "fifty",
            DrawReason::Repeat3 | DrawReason::Repeat5 => "repetition",
            _ => "other",
        },
    };
    let result = match outcome {
        Outcome::Win {
            side: Color::White, ..
        } => "1-0",
        Outcome::Win {
            side: Color::Black, ..
        } => "0-1",
        Outcome::Draw(_) => "1/2-1/2",
    };
    (result.into(), reason.into())
}

/// Eine Partie zwischen zwei Engines.
fn play_game(
    white: &mut UciEngine,
    black: &mut UciEngine,
    config: &TournamentConfig,
    cancel: &AtomicBool,
    mut on_move: impl FnMut(&str, u32),
) -> Result<(Outcome, MoveChain, bool), String> {
    let mut chain = MoveChain::new(owlchess::Board::initial());
    white.new_game()?;
    black.new_game()?;
    let movetime = config.movetime_ms.clamp(50, 30_000);
    loop {
        if let Some(outcome) = chain.calc_outcome() {
            return Ok((outcome, chain, false));
        }
        if chain.len() as u32 >= config.max_plies {
            // Am Zuglimit abgebrochen und als remis gewertet · das ist keine
            // Regel, sondern eine Setzung, und heißt in der Tabelle auch so.
            return Ok((Outcome::Draw(DrawReason::Moves50), chain, true));
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let to_move = chain.last().side();
        let moves: Vec<String> = chain
            .uci()
            .to_string()
            .split_whitespace()
            .map(String::from)
            .collect();
        let position = if moves.is_empty() {
            "position startpos".to_string()
        } else {
            format!("position startpos moves {}", moves.join(" "))
        };
        let engine = if to_move == Color::White {
            &mut *white
        } else {
            &mut *black
        };
        let answer = engine.search(&position, &format!("go movetime {movetime}"));
        let bestmove = match answer {
            Ok(result) if !result.bestmove.is_empty() && result.bestmove != "(none)" => {
                result.bestmove
            }
            // Keine Antwort oder abgestürzt · die Partie geht an die Gegenseite.
            _ => {
                return Ok((
                    Outcome::Win {
                        side: to_move.inv(),
                        reason: WinReason::EngineError,
                    },
                    chain,
                    false,
                ))
            }
        };
        // Ein Zug, den die Stellung nicht hergibt, beendet die Partie ebenso ·
        // geraten wird hier nichts.
        if chain.push(make::Uci(bestmove.as_str())).is_err() {
            return Ok((
                Outcome::Win {
                    side: to_move.inv(),
                    reason: WinReason::InvalidMove,
                },
                chain,
                false,
            ));
        }
        on_move(&chain.last().as_fen(), chain.len() as u32);
    }
}

fn standings_from(games: &[PlayedGame], names: &[String]) -> Vec<Standing> {
    let mut table: Vec<Standing> = names
        .iter()
        .map(|name| Standing {
            name: name.clone(),
            ..Default::default()
        })
        .collect();
    let index = |name: &str| table.iter().position(|s| s.name == name);
    let mut updates: Vec<(usize, u32, bool, bool)> = Vec::new();
    for game in games {
        let (Some(w), Some(b)) = (index(&game.white), index(&game.black)) else {
            continue;
        };
        match game.result.as_str() {
            "1-0" => {
                updates.push((w, 2, true, false));
                updates.push((b, 0, false, false));
            }
            "0-1" => {
                updates.push((w, 0, false, false));
                updates.push((b, 2, true, false));
            }
            _ => {
                updates.push((w, 1, false, true));
                updates.push((b, 1, false, true));
            }
        }
    }
    for (slot, points, win, draw) in updates {
        let row = &mut table[slot];
        row.half_points += points;
        if win {
            row.wins += 1;
        } else if draw {
            row.draws += 1;
        } else {
            row.losses += 1;
        }
    }
    table.sort_by(|a, b| b.half_points.cmp(&a.half_points).then(a.name.cmp(&b.name)));
    table
}

/// Das Turnier als PGN · eine Partie je Block, wie aus jedem anderen Programm.
pub fn as_pgn(status: &TournamentStatus) -> String {
    let mut out = String::new();
    for (index, game) in status.games.iter().enumerate() {
        out.push_str(&format!(
            "[Event \"Kiebitz\"]\n[Site \"?\"]\n[Date \"????.??.??\"]\n[Round \"{}.{}\"]\n[White \"{}\"]\n[Black \"{}\"]\n[Result \"{}\"]\n[PlyCount \"{}\"]\n\n{} {}\n\n",
            game.round,
            index + 1,
            game.white.replace('"', "'"),
            game.black.replace('"', "'"),
            game.result,
            game.plies,
            game.moves,
            game.result
        ));
    }
    out
}

fn update(app: &tauri::AppHandle, change: impl FnOnce(&mut TournamentStatus)) {
    let state = app.state::<TournamentState>();
    let snapshot = {
        let Ok(mut status) = state.status.lock() else {
            return;
        };
        change(&mut status);
        status.clone()
    };
    let _ = app.emit("tournament://progress", snapshot);
}

fn run(app: tauri::AppHandle, config: TournamentConfig) {
    let names: Vec<String> = config.engines.iter().map(|e| e.name.clone()).collect();
    let plan = schedule(config.engines.len(), config.rounds);
    update(&app, |status| {
        *status = TournamentStatus {
            running: true,
            total: plan.len() as u32,
            standings: names
                .iter()
                .map(|name| Standing {
                    name: name.clone(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
    });

    let state = app.state::<TournamentState>();
    let mut games: Vec<PlayedGame> = Vec::new();
    let mut failure: Option<String> = None;

    for (round, white_idx, black_idx) in plan {
        if state.cancel.load(Ordering::SeqCst) {
            break;
        }
        let white_ref = &config.engines[white_idx];
        let black_ref = &config.engines[black_idx];
        update(&app, |status| {
            status.white = white_ref.name.clone();
            status.black = black_ref.name.clone();
            status.fen = owlchess::Board::initial().as_fen();
            status.plies = 0;
        });

        let start = |engine: &EngineRef| -> Result<UciEngine, String> {
            let mut uci = UciEngine::spawn(&engine.path)?;
            let threads = UciEngine::configured_worker_threads(config.threads).min(4);
            let _ = uci.set_option("Threads", &threads.to_string());
            let _ = uci.set_option("Hash", &config.hash_mb.clamp(16, 1024).to_string());
            Ok(uci)
        };
        let (mut white, mut black) = match (start(white_ref), start(black_ref)) {
            (Ok(w), Ok(b)) => (w, b),
            (Err(e), _) | (_, Err(e)) => {
                failure = Some(e);
                break;
            }
        };

        let played = play_game(
            &mut white,
            &mut black,
            &config,
            &state.cancel,
            |fen, plies| {
                let fen = fen.to_string();
                update(&app, |status| {
                    status.fen = fen;
                    status.plies = plies;
                });
            },
        );
        let (outcome, chain, adjudicated) = match played {
            Ok(result) => result,
            // Abbruch · was gespielt wurde, bleibt stehen.
            Err(_) => break,
        };
        let (result, reason) = outcome_text(outcome, adjudicated);
        games.push(PlayedGame {
            round,
            white: white_ref.name.clone(),
            black: black_ref.name.clone(),
            result,
            reason,
            plies: chain.len() as u32,
            moves: chain
                .styled(NumberPolicy::FromBoard, Style::San, GameStatusPolicy::Hide)
                .to_string(),
        });
        let standings = standings_from(&games, &names);
        let snapshot = games.clone();
        update(&app, |status| {
            status.played += 1;
            status.games = snapshot;
            status.standings = standings;
        });
    }

    let cancelled = state.cancel.load(Ordering::SeqCst);
    state.running.store(false, Ordering::SeqCst);
    state.cancel.store(false, Ordering::SeqCst);
    update(&app, |status| {
        status.running = false;
        status.cancelled = cancelled;
        status.error = failure;
        status.white = String::new();
        status.black = String::new();
    });
}

#[tauri::command]
pub fn tournament_start(app: tauri::AppHandle, mut config: TournamentConfig) -> Result<(), String> {
    // Ein leerer Pfad ist die mitgelieferte Engine · sie steht in der Liste
    // der Einstellungen als feste erste Zeile und hat keinen eigenen Eintrag.
    for engine in &mut config.engines {
        if engine.path.trim().is_empty() {
            let bundled = crate::resolve_bundled_engine(&app)
                .ok_or_else(|| "Die mitgelieferte Engine wurde nicht gefunden.".to_string())?;
            engine.path = bundled.to_string_lossy().to_string();
        }
    }
    if config.engines.len() < 2 {
        return Err("Für ein Turnier braucht es mindestens zwei Engines.".into());
    }
    if config.engines.len() > MAX_ENGINES {
        return Err(format!("Höchstens {MAX_ENGINES} Engines je Turnier."));
    }
    if !(1..=MAX_ROUNDS).contains(&config.rounds) {
        return Err(format!("Durchgänge: 1 bis {MAX_ROUNDS}."));
    }
    let state = app.state::<TournamentState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Es läuft schon ein Turnier.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let handle = app.clone();
    std::thread::spawn(move || run(handle, config));
    Ok(())
}

#[tauri::command]
pub fn tournament_status(app: tauri::AppHandle) -> TournamentStatus {
    app.state::<TournamentState>()
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn tournament_cancel(app: tauri::AppHandle) {
    app.state::<TournamentState>()
        .cancel
        .store(true, Ordering::SeqCst);
}

/// Die gespielten Partien als PGN · für „Speichern unter".
#[tauri::command]
pub fn tournament_pgn(app: tauri::AppHandle) -> String {
    let status = tournament_status(app);
    as_pgn(&status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_everyone_against_everyone_and_swaps_colours() {
        let plan = schedule(3, 2);
        assert_eq!(plan.len(), 6);
        assert_eq!(plan[0], (1, 0, 1));
        assert_eq!(plan[1], (1, 0, 2));
        assert_eq!(plan[2], (1, 1, 2));
        // Zweiter Durchgang: dieselben Paarungen, andere Farben.
        assert_eq!(plan[3], (2, 1, 0));
        assert_eq!(plan[5], (2, 2, 1));
    }

    #[test]
    fn counts_points_in_halves() {
        let game = |white: &str, black: &str, result: &str| PlayedGame {
            round: 1,
            white: white.into(),
            black: black.into(),
            result: result.into(),
            reason: "mate".into(),
            plies: 40,
            moves: String::new(),
        };
        let names = vec!["A".to_string(), "B".to_string()];
        let table = standings_from(&[game("A", "B", "1-0"), game("B", "A", "1/2-1/2")], &names);
        assert_eq!(table[0].name, "A");
        assert_eq!(table[0].half_points, 3);
        assert_eq!(table[0].wins, 1);
        assert_eq!(table[0].draws, 1);
        assert_eq!(table[1].half_points, 1);
        assert_eq!(table[1].losses, 1);
    }

    #[test]
    fn names_the_outcome_the_way_the_ui_reads_it() {
        assert_eq!(
            outcome_text(
                Outcome::Win {
                    side: Color::Black,
                    reason: WinReason::Checkmate
                },
                false
            ),
            ("0-1".to_string(), "mate".to_string())
        );
        assert_eq!(
            outcome_text(Outcome::Draw(DrawReason::Repeat3), false),
            ("1/2-1/2".to_string(), "repetition".to_string())
        );
        // Am Zuglimit abgebrochen · nicht als Regel-Remis ausgeben.
        assert_eq!(
            outcome_text(Outcome::Draw(DrawReason::Moves50), true).1,
            "adjudicated"
        );
    }

    /// Eine echte Partie zwischen zwei Engines · belegt, dass Kommandos,
    /// Antworten und Regelwerk zusammenpassen.
    /// `KIEBITZ_ENGINE=…/stockfish.exe cargo test tournament::tests::plays_a_real_game -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn plays_a_real_game() {
        let path = std::env::var("KIEBITZ_ENGINE").expect("KIEBITZ_ENGINE setzen");
        let mut white = UciEngine::spawn(&path).unwrap();
        let mut black = UciEngine::spawn(&path).unwrap();
        let config = TournamentConfig {
            engines: Vec::new(),
            movetime_ms: 50,
            rounds: 1,
            // Kurz halten · hier zählt, dass eine Partie sauber durchläuft.
            max_plies: 40,
            threads: 1,
            hash_mb: 16,
        };
        let cancel = AtomicBool::new(false);
        let mut seen = 0u32;
        let (outcome, chain, adjudicated) =
            play_game(&mut white, &mut black, &config, &cancel, |_, plies| {
                seen = plies
            })
            .unwrap();
        let (result, reason) = outcome_text(outcome, adjudicated);
        println!(
            "{result} ({reason}) nach {} Halbzügen: {}",
            chain.len(),
            chain.styled(NumberPolicy::FromBoard, Style::San, GameStatusPolicy::Hide)
        );
        assert!(chain.len() >= 10, "die Partie blieb sofort stehen");
        assert_eq!(seen as usize, chain.len());
        assert!(["1-0", "0-1", "1/2-1/2"].contains(&result.as_str()));
        // Weder Protokollfehler noch ein Zug, den das Regelwerk nicht kennt.
        assert_ne!(reason, "engineError");
        assert_ne!(reason, "invalidMove");
    }

    #[test]
    fn writes_one_pgn_block_per_game() {
        let status = TournamentStatus {
            games: vec![PlayedGame {
                round: 1,
                white: "Stockfish".into(),
                black: "Andere".into(),
                result: "1-0".into(),
                reason: "mate".into(),
                plies: 3,
                moves: "1. e4 e5 2. Qh5".into(),
            }],
            ..Default::default()
        };
        let pgn = as_pgn(&status);
        assert!(pgn.contains("[White \"Stockfish\"]"));
        assert!(pgn.contains("[Result \"1-0\"]"));
        assert!(pgn.trim_end().ends_with("1. e4 e5 2. Qh5 1-0"));
    }
}
