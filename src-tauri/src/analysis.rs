//! Auto-Analyse-Pipeline: läuft als Hintergrund-Thread mit eigener
//! Engine-Instanz über alle unanalysierten Partien, cached Bewertungen pro
//! Stellung, erkennt Patzer/Fehler/Ungenauigkeiten aus Win-Prob-Schwankungen
//! und schreibt Annotationen in die Datenbank.

use crate::chess::{self, WalkedMove};
use crate::db;
use crate::engine::UciEngine;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

const PROGRESS_EVENT_INTERVAL: Duration = Duration::from_millis(100);

pub struct AnalysisState {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
}

impl Default for AnalysisState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        }
    }
}

/// Pfad zur Datenbank · Hintergrund-Threads öffnen eigene Verbindungen.
/// Mutex, weil der Speicherort in den Einstellungen änderbar ist.
pub struct DbPath(pub Mutex<PathBuf>);

// ── Win-Prob & Judgments ─────────────────────────────────────────────────────

/// Weiß-Gewinnwahrscheinlichkeit (0..1) aus Weiß-Sicht-Bewertung.
pub(crate) fn win_prob(eval_cp: Option<i32>, mate_in: Option<i32>) -> f64 {
    if let Some(m) = mate_in {
        return if m > 0 { 1.0 } else { 0.0 };
    }
    let cp = f64::from(eval_cp.unwrap_or(0));
    1.0 / (1.0 + (-0.004 * cp).exp())
}

fn judgment_for(drop: f64) -> &'static str {
    if drop >= 0.30 {
        "blunder"
    } else if drop >= 0.20 {
        "mistake"
    } else if drop >= 0.10 {
        "inaccuracy"
    } else {
        ""
    }
}

/// Genauigkeit nach der Lichess-Formel aus mittlerem Win-Prob-Verlust (×100).
fn accuracy_from_losses(losses: &[f64]) -> Option<f64> {
    if losses.is_empty() {
        return None;
    }
    let mean = losses.iter().sum::<f64>() / losses.len() as f64 * 100.0;
    let acc = 103.1668 * (-0.04354 * mean).exp() - 3.1669;
    Some((acc.clamp(0.0, 100.0) * 10.0).round() / 10.0)
}

// ── Bewertung der Stellungen einer Partie (mit Cache) ────────────────────────

/// Bewertung aus Weiß-Sicht plus bester Zug (aus Sicht des Spielers am Zug).
#[derive(Clone)]
struct PosEval {
    eval_cp: Option<i32>,
    mate_in: Option<i32>,
    best_uci: String,
    /// Hauptvariante ab dieser Stellung, UCI, leerzeichengetrennt.
    ///
    /// Die Engine liest sie ohnehin mit (`engine.rs`), und ohne sie könnte
    /// keine Erklärung sagen, *was* nach dem Zug passiert wäre. Gespeichert
    /// werden nur die ersten Halbzüge · siehe `motifs::PV_PLIES`.
    pv: String,
}

/// Eine Bewertung aus Sicht des Spielers am Zug · so liegt sie im Cache.
type CachedEval = (Option<i32>, Option<i32>, String, String);

/// So viele Stellungen holt sich eine Engine auf einmal aus der Warteschlange.
///
/// Nicht eine: Aufeinanderfolgende Stellungen einer Partie unterscheiden sich
/// um einen Zug, und die Transpositionstabelle trägt von der einen zur
/// nächsten. Wer die Stellungen reihum verteilt, wirft genau diese Nähe weg
/// (gemessen 14,7 statt 13,9 ms je Stellung). Ein Block ist groß genug, dass
/// die Nähe bleibt, und klein genug, dass am Ende einer Partie nicht eine
/// Engine allein weiterrechnet, während die anderen zusehen.
const EVAL_CHUNK: usize = 8;

/// Unter welchen Bedingungen eine Bewertung entsteht — und damit, unter
/// welchen eine gespeicherte noch gilt.
///
/// Die Suchtiefe stand schon immer im Cache. Der Name der Engine (ihr
/// `id name`, etwa „Stockfish 19") kam dazu, weil eine andere Engine dieselbe
/// Stellung anders bewertet: Ohne ihn bekäme ein Lauf mit Stockfish 19 auf
/// ewig die Zahlen von Stockfish 18 serviert, und die Genauigkeitskurve der
/// Insights liefe über zwei Engines, ohne es zu sagen.
#[derive(Clone, Copy)]
struct Lauf<'a> {
    depth: u32,
    engine: &'a str,
}

/// Bewertet alle Stellungen einer Partie und füllt dabei den Cache.
///
/// Was schon bewertet ist, kommt aus der Datenbank; der Rest wird auf die
/// Engines verteilt. Zurück kommt `None`, wenn zwischendurch abgebrochen
/// wurde — dann ist die Partie unvollständig, und was gerechnet wurde, liegt
/// trotzdem im Cache und ist beim nächsten Lauf geschenkt.
///
/// `on_position` wird aus den Engine-Threads gerufen und bekommt die Zahl der
/// fertigen Stellungen; die Drossel sitzt im Aufrufer.
fn eval_game_positions(
    conn: &Connection,
    engines: &mut [UciEngine],
    lauf: Lauf<'_>,
    cancel: &AtomicBool,
    fens: &[String],
    keys: &[String],
    on_position: &(dyn Fn(usize) + Sync),
) -> Result<Option<Vec<CachedEval>>, String> {
    let Lauf { depth, engine } = lauf;
    let count = fens.len();
    let mut evals: Vec<Option<CachedEval>> = Vec::with_capacity(count);
    {
        let mut stmt = conn
            .prepare_cached(
                "SELECT eval_cp, mate_in, best_uci, pv FROM eval_cache
                 WHERE fen_key = ?1 AND depth >= ?2 AND engine = ?3",
            )
            .map_err(|e| e.to_string())?;
        for key in keys {
            evals.push(
                stmt.query_row(params![key, depth, engine], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .ok(),
            );
        }
    }

    let pending: Vec<usize> = (0..count).filter(|index| evals[*index].is_none()).collect();
    let done = AtomicUsize::new(count - pending.len());
    on_position(done.load(Ordering::Relaxed));

    // Eine gemeinsame Warteschlange statt fester Abschnitte: Ein Teil der
    // Stellungen liegt schon im Cache, und feste Abschnitte hätten am Ende
    // immer eine Engine, die alles allein nachholt.
    let cursor = AtomicUsize::new(0);
    let searched: Vec<(usize, CachedEval)> = std::thread::scope(|scope| {
        let handles: Vec<_> = engines
            .iter_mut()
            .map(|engine| {
                let (cursor, done, pending, fens) = (&cursor, &done, &pending, fens);
                scope.spawn(move || -> Result<Vec<(usize, CachedEval)>, String> {
                    let mut found = Vec::new();
                    loop {
                        let from = cursor.fetch_add(EVAL_CHUNK, Ordering::SeqCst);
                        if from >= pending.len() {
                            return Ok(found);
                        }
                        for &index in &pending[from..(from + EVAL_CHUNK).min(pending.len())] {
                            if cancel.load(Ordering::SeqCst) {
                                return Ok(found);
                            }
                            let result = engine.analyze(&fens[index], depth)?;
                            // Matt in 0 = der Spieler am Zug ist bereits matt.
                            let mate = result.mate_in.map(|m| if m == 0 { -1 } else { m });
                            found.push((
                                index,
                                (
                                    result.eval_cp,
                                    mate,
                                    result.bestmove,
                                    crate::motifs::pv_text(&result.pv),
                                ),
                            ));
                            on_position(done.fetch_add(1, Ordering::Relaxed) + 1);
                        }
                    }
                })
            })
            .collect();
        let mut all = Vec::new();
        for handle in handles {
            all.extend(
                handle
                    .join()
                    .map_err(|_| "Analyse-Thread abgestürzt".to_string())??,
            );
        }
        Ok::<_, String>(all)
    })?;

    // Einmal schreiben statt einmal je Stellung · auch nach einem Abbruch,
    // sonst beginnt der nächste Lauf wieder bei null.
    let complete = searched.len() == pending.len();
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    {
        let mut stmt = conn
            .prepare_cached(
                "INSERT OR REPLACE INTO eval_cache
                     (fen_key, eval_cp, mate_in, best_uci, pv, depth, engine)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for (index, (eval_cp, mate_in, best_uci, pv)) in &searched {
            stmt.execute(params![
                keys[*index],
                eval_cp,
                mate_in,
                best_uci,
                pv,
                depth,
                engine
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

    if !complete {
        return Ok(None);
    }
    for (index, value) in searched {
        evals[index] = Some(value);
    }
    Ok(evals.into_iter().collect())
}

// ── Positionsindex ───────────────────────────────────────────────────────────

fn index_game_positions(
    conn: &Connection,
    game_id: i64,
    walked: &[WalkedMove],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare_cached(
            "INSERT OR IGNORE INTO positions (fen_key, game_id, ply) VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| e.to_string())?;
    stmt.execute(params![chess::start_key(), game_id, 0])
        .map_err(|e| e.to_string())?;
    for w in walked {
        stmt.execute(params![w.key_after, game_id, w.ply])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Indiziert alle Partien, die noch nicht im Positionsindex stehen.
#[tauri::command]
pub fn index_positions(db: State<db::Db>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let missing: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT g.id, g.moves FROM games g
                 WHERE g.moves != '' AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.game_id = g.id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut indexed = 0usize;
    for (id, moves) in &missing {
        let walked = chess::walk_sans(moves);
        if walked.is_empty() {
            continue;
        }
        index_game_positions(&conn, *id, &walked)?;
        indexed += 1;
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(indexed)
}

// ── Analyse-Worker ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct Progress {
    game_index: usize,
    games_total: usize,
    game_id: i64,
    opponent: String,
    ply: u32,
    plies: u32,
}

#[derive(Serialize, Clone)]
struct GameDone {
    game_id: i64,
    inaccuracies: u32,
    mistakes: u32,
    blunders: u32,
}

#[derive(Serialize, Clone)]
struct AllDone {
    analyzed: usize,
    canceled: bool,
    error: Option<String>,
}

/// Startet die Hintergrund-Analyse. `game_ids` analysiert gezielt (auch neu),
/// sonst werden unanalysierte Partien abgearbeitet (neueste zuerst, `limit`).
#[tauri::command]
pub fn start_analysis(
    app: tauri::AppHandle,
    state: State<AnalysisState>,
    game_ids: Option<Vec<i64>>,
    depth: Option<u32>,
    limit: Option<u32>,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Die Analyse läuft bereits.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);

    let engine_path = match crate::resolve_engine(&app) {
        Some(p) => p,
        None => {
            state.running.store(false, Ordering::SeqCst);
            return Err("Keine Engine gefunden".into());
        }
    };
    let batch_depth = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map(|s| s.batch_depth)
        .unwrap_or(14);
    let depth = depth.unwrap_or(batch_depth).clamp(6, 30);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_worker(&app2, &engine_path, game_ids, depth, limit);
        let st = app2.state::<AnalysisState>();
        let canceled = st.cancel.load(Ordering::SeqCst);
        st.running.store(false, Ordering::SeqCst);
        let _ = app2.emit(
            "analysis://done",
            AllDone {
                analyzed: result.as_ref().copied().unwrap_or(0),
                canceled,
                error: result.err(),
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_analysis(state: State<AnalysisState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Eine Partie, wie der Worker sie aus der Datenbank holt.
///
/// Benannt und nicht als Tupel, weil das Fazit am Ende drei Felder mehr
/// braucht als die Analyse selbst: Ergebnis und die beiden Genauigkeiten, die
/// eine Plattform mitgeliefert haben kann.
struct Target {
    id: i64,
    moves: String,
    opponent: String,
    color: String,
    my_elo: i64,
    excluded: bool,
    result: String,
    accuracy: Option<f64>,
    opponent_accuracy: Option<f64>,
}

fn run_worker(
    app: &tauri::AppHandle,
    engine_path: &std::path::Path,
    game_ids: Option<Vec<i64>>,
    depth: u32,
    limit: Option<u32>,
) -> Result<usize, String> {
    let db_path = app
        .state::<DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "busy_timeout", "10000");

    const TARGET_COLUMNS: &str = "id, moves, opponent, color, my_elo, analysis_excluded,
         result, accuracy, opponent_accuracy";
    let read_target = |r: &rusqlite::Row| -> rusqlite::Result<Target> {
        Ok(Target {
            id: r.get(0)?,
            moves: r.get(1)?,
            opponent: r.get(2)?,
            color: r.get(3)?,
            my_elo: r.get(4)?,
            excluded: r.get::<_, i64>(5)? != 0,
            result: r.get(6)?,
            accuracy: r.get(7)?,
            opponent_accuracy: r.get(8)?,
        })
    };
    let targets: Vec<Target> = {
        let (sql, use_ids) = match &game_ids {
            Some(_) => (
                format!("SELECT {TARGET_COLUMNS} FROM games WHERE id = ?1"),
                true,
            ),
            None => (
                format!(
                    "SELECT {TARGET_COLUMNS} FROM games
                     WHERE analyzed = 0 AND analysis_excluded = 0 AND moves != ''
                     ORDER BY played_ts DESC LIMIT {}",
                    limit.unwrap_or(u32::MAX)
                ),
                false,
            ),
        };
        if use_ids {
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut v = Vec::new();
            for id in game_ids.unwrap() {
                if let Ok(row) = stmt.query_row(params![id], read_target) {
                    v.push(row);
                }
            }
            v
        } else {
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], &read_target)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        }
    };

    if targets.is_empty() {
        return Ok(0);
    }

    let (workers, hash_mb) = {
        let s = app.state::<crate::settings::SettingsState>();
        let s = s.0.lock().map_err(|e| e.to_string())?;
        let workers = UciEngine::analysis_workers(s.engine_threads);
        (
            workers,
            UciEngine::worker_hash_mb(s.engine_hash_mb, workers),
        )
    };
    // Je Engine ein Thread · parallel wird über die Stellungen einer Partie
    // (siehe `UciEngine::analysis_workers`).
    let mut engines: Vec<UciEngine> = Vec::with_capacity(workers);
    for _ in 0..workers {
        let mut engine = UciEngine::spawn(&engine_path.to_string_lossy())?;
        let _ = engine.set_option("Threads", "1");
        let _ = engine.set_option("Hash", &hash_mb.to_string());
        engines.push(engine);
    }
    // Alle Arbeiter sind dieselbe Binärdatei · einmal fragen genügt.
    let engine_name = engines
        .first()
        .map(|engine| engine.name().to_string())
        .unwrap_or_default();

    let state = app.state::<AnalysisState>();
    let total = targets.len();
    let mut analyzed = 0usize;

    for (idx, target) in targets.into_iter().enumerate() {
        let Target {
            id: game_id,
            moves,
            opponent,
            color,
            my_elo,
            excluded: analysis_excluded,
            result: game_result,
            accuracy: stored_accuracy,
            opponent_accuracy: stored_opponent_accuracy,
        } = target;
        if state.cancel.load(Ordering::SeqCst) {
            break;
        }
        let walked = chess::walk_sans(&moves);
        if walked.is_empty() {
            // Nichts zu analysieren (abgebrochene/leere Partie) · aus der Queue nehmen.
            conn.execute(
                "UPDATE games SET analyzed = 1, updated_ts = ?2, analyzed_ts = ?2 WHERE id = ?1",
                params![game_id, crate::db::now_ts()],
            )
            .map_err(|e| e.to_string())?;
            continue;
        }
        let plies = walked.len() as u32;

        // Grundstellung + je eine Stellung nach jedem Halbzug.
        let start_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let mut fens: Vec<String> = Vec::with_capacity(walked.len() + 1);
        let mut keys: Vec<String> = Vec::with_capacity(walked.len() + 1);
        fens.push(start_fen.to_string());
        keys.push(chess::start_key());
        for w in &walked {
            fens.push(w.fen_after.clone());
            keys.push(w.key_after.clone());
        }

        // Der Fortschritt kommt jetzt aus mehreren Threads · die Drossel
        // braucht deshalb ein gemeinsames Schloss. Gezählt werden Stellungen,
        // gemeldet werden Halbzüge: Stellung 0 ist die Grundstellung.
        let last_progress_emit: Mutex<Option<Instant>> = Mutex::new(None);
        let on_position = |done: usize| {
            let now = Instant::now();
            let due = {
                let Ok(mut last) = last_progress_emit.lock() else {
                    return;
                };
                let due = last
                    .map(|at| now.saturating_duration_since(at) >= PROGRESS_EVENT_INTERVAL)
                    .unwrap_or(true)
                    || done == fens.len();
                if due {
                    *last = Some(now);
                }
                due
            };
            if !due {
                return;
            }
            let _ = app.emit(
                "analysis://progress",
                Progress {
                    game_index: idx + 1,
                    games_total: total,
                    game_id,
                    opponent: opponent.clone(),
                    ply: done.saturating_sub(1).min(plies as usize) as u32,
                    plies,
                },
            );
        };

        let Some(raw) = eval_game_positions(
            &conn,
            &mut engines,
            Lauf {
                depth,
                engine: &engine_name,
            },
            &state.cancel,
            &fens,
            &keys,
            &on_position,
        )?
        else {
            break;
        };

        // Der Cache liegt aus Sicht des Spielers am Zug · gerechnet wird ab
        // hier aus Weiß-Sicht.
        let evals: Vec<PosEval> = raw
            .into_iter()
            .enumerate()
            .map(|(index, (eval_cp, mate_in, best_uci, pv))| {
                let white_to_move = index == 0 || !walked[index - 1].by_white;
                let sign = if white_to_move { 1 } else { -1 };
                PosEval {
                    eval_cp: eval_cp.map(|v| v * sign),
                    mate_in: mate_in.map(|v| v * sign),
                    best_uci,
                    pv,
                }
            })
            .collect();

        // Judgments + Genauigkeit meiner Züge.
        let my_white = color == "white";
        let mut my_losses: Vec<f64> = Vec::new();
        let mut opening_losses: Vec<f64> = Vec::new();
        let mut middlegame_losses: Vec<f64> = Vec::new();
        let mut endgame_losses: Vec<f64> = Vec::new();
        let mut opponent_losses: Vec<f64> = Vec::new();
        let mut opponent_opening_losses: Vec<f64> = Vec::new();
        let mut opponent_middlegame_losses: Vec<f64> = Vec::new();
        let mut opponent_endgame_losses: Vec<f64> = Vec::new();
        let mut counts = (0u32, 0u32, 0u32); // inaccuracy, mistake, blunder
        let mut my_counts = (0u32, 0u32, 0u32); // dieselben, aber nur meine

        // Zug, Bewertung, Urteil, Verlust · aus dem Verlust wählen die eigenen
        // Puzzles unten die teuersten Fehler aus.
        let mut rows: Vec<(u32, &WalkedMove, &PosEval, &'static str, f64)> = Vec::new();
        for (i, w) in walked.iter().enumerate() {
            let before = &evals[i];
            let after = &evals[i + 1];
            let wp_before = win_prob(before.eval_cp, before.mate_in);
            let wp_after = win_prob(after.eval_cp, after.mate_in);
            let drop = if w.by_white {
                (wp_before - wp_after).max(0.0)
            } else {
                (wp_after - wp_before).max(0.0)
            };
            if w.by_white == my_white {
                my_losses.push(drop);
                match w.phase {
                    "opening" => opening_losses.push(drop),
                    "middlegame" => middlegame_losses.push(drop),
                    "endgame" => endgame_losses.push(drop),
                    _ => {}
                }
            } else {
                opponent_losses.push(drop);
                match w.phase {
                    "opening" => opponent_opening_losses.push(drop),
                    "middlegame" => opponent_middlegame_losses.push(drop),
                    "endgame" => opponent_endgame_losses.push(drop),
                    _ => {}
                }
            }
            let judgment = judgment_for(drop);
            match judgment {
                "inaccuracy" => counts.0 += 1,
                "mistake" => counts.1 += 1,
                "blunder" => counts.2 += 1,
                _ => {}
            }
            if w.by_white == my_white {
                match judgment {
                    "inaccuracy" => my_counts.0 += 1,
                    "mistake" => my_counts.1 += 1,
                    "blunder" => my_counts.2 += 1,
                    _ => {}
                }
            }
            rows.push((w.ply, w, after, judgment, drop));
        }

        // ── Was an jedem Zug erzählenswert ist ────────────────────────────
        //
        // Reine Rechnung über Daten, die ohnehin im Speicher liegen: keine
        // Engine-Zeit, kein zweiter Lauf, keine Konkurrenz um die Kerne, auf
        // denen Stockfish gerade sucht. Deshalb darf sie für jeden Zug jeder
        // Partie laufen und nicht nur für die, die jemand ansieht.
        //
        // Gelesen wird aus `rows`: Dort steht das Urteil, das die Zeile
        // gleich mit in die Datenbank nimmt. Es hier ein zweites Mal
        // auszurechnen hieße, zwei Fassungen derselben Schwelle zu pflegen —
        // und die erste, die abweicht, erzählt zu einem Zug etwas, den die
        // Marke daneben gar nicht bemängelt.
        let told: Vec<(Option<i32>, crate::motifs::Motif)> = rows
            .iter()
            .map(|(ply, w, _, judgment, _)| {
                let index = *ply as usize - 1;
                let (before, after) = (&evals[index], &evals[index + 1]);
                let sign = if w.by_white { 1 } else { -1 };
                // Der Verlust in Zentibauern · nur da, wo beide Seiten eine
                // Zahl haben. Gegen ein Matt ist „kostet 3,2 Bauern" keine
                // Aussage, sondern eine Verharmlosung.
                let loss_cp = match (before.eval_cp, after.eval_cp) {
                    (Some(a), Some(b)) => Some(((a - b) * sign).max(0)),
                    _ => None,
                };
                let reply: Vec<String> = after.pv.split_whitespace().map(str::to_string).collect();
                let motif = crate::motifs::detect(&crate::motifs::MoveFacts {
                    fen_before: &w.fen_before,
                    san: &w.san,
                    best_uci: &before.best_uci,
                    pv_after: &reply,
                    judgment,
                    mate_before: before.mate_in.map(|v| v * sign),
                    mate_after: after.mate_in.map(|v| v * sign),
                });
                (loss_cp, motif)
            })
            .collect();
        let accuracy = accuracy_from_losses(&my_losses);
        let accuracy_opening = accuracy_from_losses(&opening_losses);
        let accuracy_middlegame = accuracy_from_losses(&middlegame_losses);
        let accuracy_endgame = accuracy_from_losses(&endgame_losses);
        let opponent_accuracy = accuracy_from_losses(&opponent_losses);
        let opponent_accuracy_opening = accuracy_from_losses(&opponent_opening_losses);
        let opponent_accuracy_middlegame = accuracy_from_losses(&opponent_middlegame_losses);
        let opponent_accuracy_endgame = accuracy_from_losses(&opponent_endgame_losses);
        let own_puzzles: Vec<crate::puzzles::OwnPuzzleCandidate> = rows
            .iter()
            .filter(|(_, w, _, judgment, _)| {
                w.by_white == my_white && matches!(*judgment, "mistake" | "blunder")
            })
            .map(|(ply, w, _, judgment, drop)| {
                let before = &evals[*ply as usize - 1];
                let white_view = win_prob(before.eval_cp, before.mate_in);
                crate::puzzles::OwnPuzzleCandidate {
                    ply: *ply,
                    fen: w.fen_before.clone(),
                    best_uci: before.best_uci.clone(),
                    phase: w.phase.to_string(),
                    judgment: (*judgment).to_string(),
                    loss: *drop,
                    win_prob_before: if my_white {
                        white_view
                    } else {
                        1.0 - white_view
                    },
                }
            })
            .collect();

        // ── Das Fazit der Partie ─────────────────────────────────────────
        //
        // Es entsteht aus demselben Lauf und nicht beim Ansehen: So steht es
        // auch dann in der Datenbank, wenn die Partie nie geöffnet wird — und
        // das Blatt muss für einen Absatz nicht alle Halbzüge nachladen.
        //
        // Gerechnet wird über die eigenen Züge. Die Genauigkeit der Plattform
        // hat Vorrang, weil sie auch in der Spalte gewinnt (`COALESCE`) · ein
        // Fazit, das eine andere Zahl nennt als die Partieübersicht, wäre ein
        // Fehler, den niemand einordnen kann.
        let turning_point = rows
            .iter()
            .filter(|(_, w, _, judgment, _)| {
                w.by_white == my_white && matches!(*judgment, "blunder" | "mistake")
            })
            .min_by_key(|(ply, _, _, judgment, _)| {
                // Der erste grobe Fehler zählt; nur wenn es keinen gibt, der
                // erste Fehler.
                (if *judgment == "blunder" { 0 } else { 1 }, *ply)
            })
            .map(|(ply, w, _, _, _)| ((*ply).div_ceil(2), w.san.clone()));
        let recurring = {
            let mut tally: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
            for (ply, w, _, judgment, _) in &rows {
                if w.by_white != my_white || judgment.is_empty() {
                    continue;
                }
                let motif = told[*ply as usize - 1].1.name;
                if motif.is_empty() || motif == "none" || motif == "best_move" {
                    continue;
                }
                *tally.entry(motif).or_default() += 1;
            }
            tally
                .into_iter()
                .max_by_key(|(motif, count)| (*count, *motif))
                .map(|(motif, count)| (motif.to_string(), count))
        };
        let verdict = crate::verdict::build(&crate::verdict::GameSummary {
            result: &game_result,
            accuracy: stored_accuracy.or(accuracy),
            opponent_accuracy: stored_opponent_accuracy.or(opponent_accuracy),
            accuracy_opening,
            accuracy_middlegame,
            accuracy_endgame,
            inaccuracies: my_counts.0,
            mistakes: my_counts.1,
            blunders: my_counts.2,
            turning_point,
            recurring,
        });

        // In einer Transaktion schreiben.
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM move_evals WHERE game_id = ?1",
            params![game_id],
        )
        .map_err(|e| e.to_string())?;
        {
            let mut stmt = conn
                .prepare_cached(
                    "INSERT INTO move_evals
                        (game_id, ply, san, eval_cp, mate_in, best_uci, judgment, phase,
                         pv, loss_cp, motif, motif_detail, expl_version)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                )
                .map_err(|e| e.to_string())?;
            for (ply, w, after, judgment, _) in &rows {
                let index = *ply as usize - 1;
                let before = &evals[index];
                let (loss_cp, motif) = &told[index];
                stmt.execute(params![
                    game_id,
                    ply,
                    w.san,
                    after.eval_cp,
                    after.mate_in,
                    before.best_uci,
                    judgment,
                    w.phase,
                    before.pv,
                    loss_cp,
                    motif.name,
                    motif.detail_json(),
                    crate::motifs::EXPL_VERSION,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        crate::puzzles::replace_own_game_puzzles(
            &conn,
            game_id,
            if my_elo > 0 { my_elo } else { 1500 },
            if analysis_excluded { &[] } else { &own_puzzles },
        )?;
        index_game_positions(&conn, game_id, &walked)?;
        conn.execute(
            "UPDATE games SET analyzed = 1, accuracy = COALESCE(accuracy, ?2),
                accuracy_opening = ?3, accuracy_middlegame = ?4, accuracy_endgame = ?5,
                opponent_accuracy = COALESCE(opponent_accuracy, ?6),
                opponent_accuracy_opening = ?7, opponent_accuracy_middlegame = ?8,
                opponent_accuracy_endgame = ?9,
                verdict = ?11, verdict_version = ?12,
                updated_ts = ?10, analyzed_ts = ?10 WHERE id = ?1",
            params![
                game_id,
                accuracy,
                accuracy_opening,
                accuracy_middlegame,
                accuracy_endgame,
                opponent_accuracy,
                opponent_accuracy_opening,
                opponent_accuracy_middlegame,
                opponent_accuracy_endgame,
                crate::db::now_ts(),
                verdict,
                crate::verdict::VERDICT_VERSION,
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

        analyzed += 1;
        let _ = app.emit(
            "analysis://game_done",
            GameDone {
                game_id,
                inaccuracies: counts.0,
                mistakes: counts.1,
                blunders: counts.2,
            },
        );
    }

    Ok(analyzed)
}

// ── Gespeicherte Analyse lesen ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct MoveEvalRow {
    pub ply: u32,
    pub san: String,
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub best_uci: String,
    pub judgment: String,
    pub phase: String,
    /// Verlust in Zentibauern · fehlt, wo ein Matt im Spiel ist.
    pub loss_cp: Option<i32>,
    /// Erkanntes Motiv · leer, wenn keines belastbar war.
    pub motif: String,
    /// Die Felder des Motivs als JSON · leer, wenn es keine gibt.
    pub motif_detail: String,
    /// Die Hauptvariante vor dem Zug, lesbar statt in UCI.
    pub pv: Vec<String>,
}

#[tauri::command]
pub fn game_analysis(db: State<db::Db>, game_id: i64) -> Result<Vec<MoveEvalRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Die Varianten liegen in UCI, die Oberfläche zeigt Züge. Übersetzt wird
    // hier, weil dafür die Stellung vor dem Halbzug nötig ist — und die steht
    // nirgends in `move_evals`, sondern entsteht aus der Zugliste der Partie.
    let moves: String = conn
        .query_row(
            "SELECT moves FROM games WHERE id = ?1",
            params![game_id],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let fens: Vec<String> = chess::walk_sans(&moves)
        .into_iter()
        .map(|w| w.fen_before)
        .collect();
    let mut stmt = conn
        .prepare(
            "SELECT ply, san, eval_cp, mate_in, best_uci, judgment, phase,
                    loss_cp, motif, motif_detail, pv
             FROM move_evals WHERE game_id = ?1 ORDER BY ply",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            let ply: u32 = r.get(0)?;
            let pv: String = r.get(10)?;
            Ok(MoveEvalRow {
                ply,
                san: r.get(1)?,
                eval_cp: r.get(2)?,
                mate_in: r.get(3)?,
                best_uci: r.get(4)?,
                judgment: r.get(5)?,
                phase: r.get(6)?,
                loss_cp: r.get(7)?,
                motif: r.get(8)?,
                motif_detail: r.get(9)?,
                pv: fens
                    .get(ply as usize - 1)
                    .map(|fen| crate::motifs::pv_sans(fen, &pv))
                    .unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ── Erklärungen für schon analysierte Partien ────────────────────────────────

/// Trägt Motive und Fazit in Partien nach, die vor dieser Fassung analysiert
/// wurden.
///
/// **Ohne Engine.** Das klingt nach einem Kompromiss, ist keiner: Die
/// Erkennung braucht von der Gegenvariante nur ihren ersten Halbzug — und der
/// steht längst in der Datenbank. `move_evals.best_uci` der Zeile *danach* ist
/// genau der beste Gegenzug in der Stellung nach dem Zug. Was fehlt, ist die
/// Linie darüber hinaus; die bleibt leer, bis die Partie ohnehin einmal neu
/// gerechnet wird.
///
/// Ohne diesen Durchlauf bliebe das Blatt zu jeder bestehenden Partie stumm,
/// und die Auskunft käme erst mit der nächsten neuen. Für einen Bestand von
/// tausend Partien wäre das die falsche Antwort.
pub fn backfill_explanations(conn: &Connection) -> Result<usize, String> {
    type Pending = (
        i64,
        String,
        String,
        String,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<f64>,
        Option<f64>,
    );
    let games: Vec<Pending> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, moves, color, result, accuracy, opponent_accuracy,
                        accuracy_opening, accuracy_middlegame, accuracy_endgame
                 FROM games
                 WHERE analyzed = 1 AND moves != '' AND verdict_version < ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![crate::verdict::VERDICT_VERSION], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    if games.is_empty() {
        return Ok(0);
    }

    let mut done = 0usize;
    for (
        game_id,
        moves,
        color,
        result,
        accuracy,
        opponent_accuracy,
        accuracy_opening,
        accuracy_middlegame,
        accuracy_endgame,
    ) in games
    {
        let walked = chess::walk_sans(&moves);
        // Die abgelegten Zeilen, nach Halbzug geordnet.
        /// Halbzug, Empfehlung davor, Urteil und Bewertung danach.
        type StoredRow = (u32, String, String, Option<i32>, Option<i32>);
        let stored: Vec<StoredRow> = {
            let mut stmt = conn
                .prepare_cached(
                    "SELECT ply, best_uci, judgment, eval_cp, mate_in
                     FROM move_evals WHERE game_id = ?1 ORDER BY ply",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![game_id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        let my_white = color == "white";
        let mut motifs: Vec<(u32, crate::motifs::Motif, Option<i32>)> = Vec::new();
        let mut counts = (0u32, 0u32, 0u32);
        // Zugnummer, Zug und Rang des Urteils · der grobe Fehler schlägt den
        // Fehler, und unter gleichen der frühere.
        let mut turning_point: Option<(u32, String, u32)> = None;
        for (index, (ply, best_uci, judgment, _, _)) in stored.iter().enumerate() {
            let Some(w) = walked.get(*ply as usize - 1) else {
                continue;
            };
            let reply: Vec<String> = stored
                .get(index + 1)
                .map(|(_, uci, _, _, _)| uci.clone())
                .filter(|uci| !uci.is_empty())
                .into_iter()
                .collect();
            // Bewertungen stehen aus Weiß-Sicht; die Erkennung will sie aus
            // Sicht des Ziehenden.
            let sign = if w.by_white { 1 } else { -1 };
            let (before_cp, before_mate) = if index == 0 {
                (None, None)
            } else {
                let (_, _, _, cp, mate) = &stored[index - 1];
                (*cp, *mate)
            };
            let (after_cp, after_mate) = {
                let (_, _, _, cp, mate) = &stored[index];
                (*cp, *mate)
            };
            let loss_cp = match (before_cp, after_cp) {
                (Some(a), Some(b)) => Some(((a - b) * sign).max(0)),
                _ => None,
            };
            let motif = crate::motifs::detect(&crate::motifs::MoveFacts {
                fen_before: &w.fen_before,
                san: &w.san,
                best_uci,
                pv_after: &reply,
                judgment,
                mate_before: before_mate.map(|v| v * sign),
                mate_after: after_mate.map(|v| v * sign),
            });
            if w.by_white == my_white {
                match judgment.as_str() {
                    "inaccuracy" => counts.0 += 1,
                    "mistake" => counts.1 += 1,
                    "blunder" => counts.2 += 1,
                    _ => {}
                }
                let rank = match judgment.as_str() {
                    "blunder" => Some(0u32),
                    "mistake" => Some(1),
                    _ => None,
                };
                if let Some(rank) = rank {
                    let better = turning_point
                        .as_ref()
                        .map(|(_, _, seen)| rank < *seen)
                        .unwrap_or(true);
                    if better {
                        turning_point = Some(((*ply).div_ceil(2), w.san.clone(), rank));
                    }
                }
            }
            motifs.push((*ply, motif, loss_cp));
        }

        let recurring = {
            let mut tally: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
            for (index, (_, _, judgment, _, _)) in stored.iter().enumerate() {
                let Some((ply, motif, _)) = motifs.get(index) else {
                    continue;
                };
                let Some(w) = walked.get(*ply as usize - 1) else {
                    continue;
                };
                if w.by_white != my_white || judgment.is_empty() {
                    continue;
                }
                if motif.name.is_empty() || motif.name == "none" || motif.name == "best_move" {
                    continue;
                }
                *tally.entry(motif.name).or_default() += 1;
            }
            tally
                .into_iter()
                .max_by_key(|(motif, count)| (*count, *motif))
                .map(|(motif, count)| (motif.to_string(), count))
        };
        let verdict = crate::verdict::build(&crate::verdict::GameSummary {
            result: &result,
            accuracy,
            opponent_accuracy,
            accuracy_opening,
            accuracy_middlegame,
            accuracy_endgame,
            inaccuracies: counts.0,
            mistakes: counts.1,
            blunders: counts.2,
            turning_point: turning_point.map(|(number, san, _)| (number, san)),
            recurring,
        });

        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        {
            let mut stmt = conn
                .prepare_cached(
                    "UPDATE move_evals SET loss_cp = ?3, motif = ?4, motif_detail = ?5,
                        expl_version = ?6
                     WHERE game_id = ?1 AND ply = ?2",
                )
                .map_err(|e| e.to_string())?;
            for (ply, motif, loss_cp) in &motifs {
                stmt.execute(params![
                    game_id,
                    ply,
                    loss_cp,
                    motif.name,
                    motif.detail_json(),
                    crate::motifs::EXPL_VERSION,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        // Auch ein leeres Fazit bekommt seine Nummer: Sonst versucht es der
        // nächste Start wieder, und der übernächste auch.
        conn.execute(
            "UPDATE games SET verdict = ?2, verdict_version = ?3 WHERE id = ?1",
            params![game_id, verdict, crate::verdict::VERDICT_VERSION],
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        done += 1;
    }
    Ok(done)
}

// ── Fehler nach Spielphase (nur eigene Züge) ─────────────────────────────────

#[derive(Serialize)]
pub struct PhaseErrors {
    pub phase: String,
    pub inaccuracy: i64,
    pub mistake: i64,
    pub blunder: i64,
}

#[tauri::command]
pub fn error_stats(db: State<db::Db>) -> Result<Vec<PhaseErrors>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT e.phase, e.judgment, COUNT(*) FROM move_evals e
             JOIN games g ON g.id = e.game_id
             WHERE e.judgment != '' AND g.analysis_excluded = 0
               AND ((g.color = 'white' AND e.ply % 2 = 1) OR (g.color = 'black' AND e.ply % 2 = 0))
             GROUP BY e.phase, e.judgment",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out: Vec<PhaseErrors> = ["opening", "middlegame", "endgame"]
        .iter()
        .map(|p| PhaseErrors {
            phase: p.to_string(),
            inaccuracy: 0,
            mistake: 0,
            blunder: 0,
        })
        .collect();
    for (phase, judgment, count) in rows {
        if let Some(entry) = out.iter_mut().find(|e| e.phase == phase) {
            match judgment.as_str() {
                "inaccuracy" => entry.inaccuracy = count,
                "mistake" => entry.mistake = count,
                "blunder" => entry.blunder = count,
                _ => {}
            }
        }
    }
    Ok(out)
}

// ── Positionssuche ───────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct NextMoveStat {
    pub san: String,
    pub games: i64,
    /// Meine Punktquote in Prozent (Sieg 1, Remis 0,5).
    pub score_pct: f64,
}

#[derive(Serialize)]
pub struct PositionHit {
    pub game_id: i64,
    pub ply: u32,
    pub opponent: String,
    pub color: String,
    pub result: String,
    pub played_at: String,
    pub time_class: String,
    pub next_san: String,
}

#[derive(Serialize)]
pub struct PositionSearch {
    pub total_games: i64,
    pub next_moves: Vec<NextMoveStat>,
    pub sample: Vec<PositionHit>,
}

type PositionRow = (i64, u32, String, String, String, String, String, String);

#[tauri::command]
pub fn search_position(db: State<db::Db>, fen: String) -> Result<PositionSearch, String> {
    let key = chess::normalize_fen(&fen)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.game_id, p.ply, g.moves, g.opponent, g.color, g.result, g.played_at, g.time_class
             FROM positions p JOIN games g ON g.id = p.game_id
             WHERE p.fen_key = ?1
             ORDER BY g.played_ts DESC, p.ply ASC LIMIT 800",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<PositionRow> = stmt
        .query_map(params![key], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Pro Partie nur das erste Erreichen der Stellung zählen (Zugwiederholung).
    let mut seen = std::collections::HashSet::new();
    let mut agg: Vec<(String, i64, f64)> = Vec::new(); // san, games, score sum
    let mut sample = Vec::new();
    let mut total = 0i64;

    for (game_id, ply, moves, opponent, color, result, played_at, time_class) in rows {
        if !seen.insert(game_id) {
            continue;
        }
        total += 1;
        let next_san = moves
            .split_whitespace()
            .nth(ply as usize)
            .unwrap_or("—")
            .to_string();
        let score = match result.as_str() {
            "win" => 1.0,
            "draw" => 0.5,
            _ => 0.0,
        };
        match agg.iter_mut().find(|(s, _, _)| *s == next_san) {
            Some(e) => {
                e.1 += 1;
                e.2 += score;
            }
            None => agg.push((next_san.clone(), 1, score)),
        }
        if sample.len() < 12 {
            sample.push(PositionHit {
                game_id,
                ply,
                opponent,
                color,
                result,
                played_at,
                time_class,
                next_san,
            });
        }
    }

    agg.sort_by_key(|row| std::cmp::Reverse(row.1));
    let next_moves = agg
        .into_iter()
        .take(6)
        .map(|(san, games, score)| NextMoveStat {
            san,
            games,
            score_pct: (score / games as f64 * 1000.0).round() / 10.0,
        })
        .collect();

    Ok(PositionSearch {
        total_games: total,
        next_moves,
        sample,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn judgments_follow_thresholds() {
        assert_eq!(judgment_for(0.35), "blunder");
        assert_eq!(judgment_for(0.25), "mistake");
        assert_eq!(judgment_for(0.12), "inaccuracy");
        assert_eq!(judgment_for(0.05), "");
    }

    #[test]
    fn win_prob_symmetry() {
        assert!((win_prob(Some(0), None) - 0.5).abs() < 1e-9);
        assert!(win_prob(Some(300), None) > 0.7);
        assert_eq!(win_prob(None, Some(3)), 1.0);
        assert_eq!(win_prob(None, Some(-2)), 0.0);
    }

    #[test]
    fn accuracy_reasonable() {
        // Fehlerfreie Partie ≈ 100 %, viele grobe Fehler deutlich darunter.
        let perfect = accuracy_from_losses(&[0.0, 0.0, 0.01]).unwrap();
        assert!(perfect > 95.0, "{perfect}");
        let sloppy = accuracy_from_losses(&[0.3, 0.25, 0.2, 0.1]).unwrap();
        assert!(sloppy < 60.0, "{sloppy}");
    }

    /// Pfad zur gebündelten Engine · `None`, wenn keine da ist.
    fn bundled_engine() -> Option<std::path::PathBuf> {
        let exe = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(if cfg!(windows) {
                "stockfish.exe"
            } else {
                "stockfish"
            });
        exe.exists().then_some(exe)
    }

    /// Die Stellungen der ersten Züge einer Partie · Grundstellung zuerst.
    fn sample_positions() -> (Vec<String>, Vec<String>) {
        let moves = "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O";
        let walked = crate::chess::walk_sans(moves);
        assert!(!walked.is_empty(), "Zugliste ließ sich nicht abspielen");
        let mut fens = vec!["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".to_string()];
        let mut keys = vec![crate::chess::start_key()];
        for w in &walked {
            fens.push(w.fen_after.clone());
            keys.push(w.key_after.clone());
        }
        (fens, keys)
    }

    /// Der Pool bewertet dieselben Stellungen wie eine einzelne Engine — in
    /// derselben Reihenfolge und mit denselben Aussagen.
    ///
    /// Geprüft wird beides getrennt, weil nur das eine exakt sein kann:
    ///
    /// * **Die Zuordnung exakt.** Jeder Wert muss unter dem Schlüssel seiner
    ///   eigenen Stellung im Cache liegen. Eine verrutschte Reihenfolge wäre
    ///   der teuerste Fehler dieses Umbaus und an den Zahlen selbst nicht zu
    ///   sehen — eine Bewertung im falschen Fach sieht aus wie eine Bewertung.
    /// * **Die Zahlen nur ungefähr.** Eine Suche mit fester Tiefe hängt am
    ///   Inhalt der Transpositionstabelle: Die Vergleichs-Engine läuft die
    ///   Partie der Reihe nach durch und trifft bei jeder Stellung auf die
    ///   Reste der vorigen, die Engines des Pools auf andere. Ein paar
    ///   Centipawn Unterschied sind deshalb normal und waren es auch vorher
    ///   schon, denn eine Stellung aus dem Cache wird gar nicht mehr gesucht.
    ///   Verglichen mit den Schwellen der Urteile (0,10/0,20/0,30 Gewinn-
    ///   wahrscheinlichkeit, also ~25 cp und mehr) ist das nichts.
    ///
    /// Wird übersprungen, wenn keine Engine vorhanden ist.
    #[test]
    fn pool_matches_a_single_engine_and_fills_the_cache() {
        let Some(exe) = bundled_engine() else {
            eprintln!("übersprungen: keine gebündelte Engine");
            return;
        };
        let path = exe.to_string_lossy().to_string();
        let depth = 10;
        let (fens, keys) = sample_positions();

        let mut reference = Vec::new();
        {
            let mut engine = UciEngine::spawn(&path).expect("Engine-Start");
            engine.set_option("Threads", "1").expect("Threads");
            for fen in &fens {
                let r = engine.analyze(fen, depth).expect("Analyse");
                reference.push((r.eval_cp, r.mate_in.map(|m| if m == 0 { -1 } else { m })));
            }
        }

        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        let cancel = AtomicBool::new(false);
        let mut engines: Vec<UciEngine> = (0..3)
            .map(|_| {
                let mut engine = UciEngine::spawn(&path).expect("Engine-Start");
                engine.set_option("Threads", "1").expect("Threads");
                engine
            })
            .collect();

        let seen = Mutex::new(Vec::new());
        let record = |done: usize| seen.lock().unwrap().push(done);
        let name = engines[0].name().to_string();
        let pooled = eval_game_positions(
            &conn,
            &mut engines,
            Lauf {
                depth,
                engine: &name,
            },
            &cancel,
            &fens,
            &keys,
            &record,
        )
        .expect("Stapelbewertung")
        .expect("nicht abgebrochen");

        assert_eq!(pooled.len(), fens.len());
        for (index, (eval_cp, mate_in, best_uci, pv)) in pooled.iter().enumerate() {
            assert!(!best_uci.is_empty(), "Stellung {index} ohne besten Zug");
            // Die Hauptvariante beginnt mit dem besten Zug · sonst passen
            // Empfehlung und Linie nicht zusammen.
            assert!(
                pv.split_whitespace().next() == Some(best_uci.as_str()),
                "Stellung {index}: Linie {pv:?} beginnt nicht mit {best_uci}"
            );
            // Jeder Wert steht unter dem Schlüssel seiner eigenen Stellung.
            let stored: CachedEval = conn
                .query_row(
                    "SELECT eval_cp, mate_in, best_uci, pv FROM eval_cache WHERE fen_key = ?1",
                    params![keys[index]],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap_or_else(|_| panic!("Stellung {index} fehlt im Cache"));
            assert_eq!(&stored, &pooled[index], "Stellung {index} falsch abgelegt");

            let (reference_cp, reference_mate) = reference[index];
            assert_eq!(*mate_in, reference_mate, "Stellung {index}: anderes Matt");
            if let (Some(mine), Some(theirs)) = (eval_cp, reference_cp) {
                assert!(
                    (mine - theirs).abs() <= 50,
                    "Stellung {index}: {mine} statt {theirs} cp"
                );
            }
        }
        // Der Fortschritt beginnt bei null und endet bei allen Stellungen.
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.first().copied(), Some(0));
        assert_eq!(seen.last().copied(), Some(fens.len()));

        // Zweiter Lauf: alles liegt im Cache, keine Engine muss noch suchen.
        let seen = Mutex::new(Vec::new());
        let record = |done: usize| seen.lock().unwrap().push(done);
        let cached = eval_game_positions(
            &conn,
            &mut Vec::new(),
            Lauf {
                depth,
                engine: &name,
            },
            &cancel,
            &fens,
            &keys,
            &record,
        )
        .expect("Cache-Lauf")
        .expect("nicht abgebrochen");
        assert_eq!(cached, pooled);
        assert_eq!(seen.into_inner().unwrap(), vec![fens.len()]);

        // Dritter Lauf, andere Engine: Der Cache gilt für sie nicht. Ohne
        // Arbeiter kann auch nichts nachgerechnet werden, also kommt nichts
        // zurück — genau das soll er tun, statt fremde Zahlen auszugeben.
        let andere = eval_game_positions(
            &conn,
            &mut Vec::new(),
            Lauf {
                depth,
                engine: "Stockfish 1",
            },
            &cancel,
            &fens,
            &keys,
            &|_| {},
        )
        .expect("Lauf mit fremder Engine");
        assert!(
            andere.is_none(),
            "die Werte einer anderen Engine dürfen nicht durchgereicht werden"
        );
    }

    /// Ein Abbruch liefert keine halbe Partie, aber auch keinen verlorenen
    /// Rechenaufwand: Was fertig wurde, steht danach im Cache.
    #[test]
    fn a_cancelled_run_reports_nothing_and_keeps_what_it_computed() {
        let Some(exe) = bundled_engine() else {
            eprintln!("übersprungen: keine gebündelte Engine");
            return;
        };
        let (fens, keys) = sample_positions();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        let cancel = AtomicBool::new(true);
        let mut engines = vec![UciEngine::spawn(&exe.to_string_lossy()).expect("Engine-Start")];

        let name = engines[0].name().to_string();
        let result = eval_game_positions(
            &conn,
            &mut engines,
            Lauf {
                depth: 10,
                engine: &name,
            },
            &cancel,
            &fens,
            &keys,
            &|_| {},
        )
        .expect("Stapelbewertung");
        assert!(result.is_none(), "abgebrochener Lauf liefert keine Werte");

        let cached: i64 = conn
            .query_row("SELECT COUNT(*) FROM eval_cache", [], |r| r.get(0))
            .unwrap();
        assert!(
            cached < fens.len() as i64,
            "der Abbruch hat gar nicht gegriffen"
        );
    }

    /// Eine Partie, wie eine ältere Fassung sie hinterlassen hat: analysiert,
    /// mit Urteilen, aber ohne Motiv, ohne Verlust und ohne Fazit.
    fn old_analysis(conn: &Connection) {
        // 1.e4 e5 2.Sf3 Sc6 3.Lc4 Lc5 4.Sc3 Lxf2+?? 5.Kxf2 — der Läufer geht
        // ohne Gegenwert verloren.
        let moves = "e4 e5 Nf3 Nc6 Bc4 Bc5 Nc3 Bxf2+ Kxf2";
        conn.execute(
            "INSERT INTO games (id, source, source_id, color, result, moves, analyzed,
                                accuracy, opponent_accuracy, accuracy_middlegame)
             VALUES (1, 'manual', 'x', 'black', 'loss', ?1, 1, 62.5, 88.0, 55.0)",
            params![moves],
        )
        .unwrap();
        // Halbzug, bester Zug in der Stellung davor, Urteil, Bewertung danach.
        let rows: &[(u32, &str, &str, i32)] = &[
            (1, "e2e4", "", 30),
            (2, "e7e5", "", 25),
            (3, "g1f3", "", 30),
            (4, "b8c6", "", 28),
            (5, "f1c4", "", 25),
            (6, "f8c5", "", 30),
            (7, "b1c3", "", 25),
            (8, "g8f6", "blunder", 300),
            (9, "e1f2", "", 295),
        ];
        for (ply, best, judgment, eval_cp) in rows {
            conn.execute(
                "INSERT INTO move_evals (game_id, ply, san, eval_cp, best_uci, judgment, phase)
                 VALUES (1, ?1, '', ?2, ?3, ?4, 'opening')",
                params![ply, eval_cp, best, judgment],
            )
            .unwrap();
        }
    }

    #[test]
    fn carries_explanations_into_an_old_analysis() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        old_analysis(&conn);

        assert_eq!(backfill_explanations(&conn).unwrap(), 1);

        // Der Patzer bekommt sein Motiv · und zwar aus dem besten Gegenzug der
        // nächsten Zeile, ohne dass eine Engine gelaufen wäre.
        let (motif, detail, loss): (String, String, Option<i32>) = conn
            .query_row(
                "SELECT motif, motif_detail, loss_cp FROM move_evals
                 WHERE game_id = 1 AND ply = 8",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(motif, "hanging_piece");
        assert!(detail.contains("\"square\":\"f2\""), "{detail}");
        assert!(detail.contains("\"piece\":\"B\""), "{detail}");
        assert!(detail.contains("\"reply\":\"Kxf2\""), "{detail}");
        // Aus Sicht des Ziehenden (Schwarz) kostet der Zug 275 Zentibauern.
        assert_eq!(loss, Some(275));

        // Und die Partie bekommt ihr Fazit.
        let (verdict, version): (String, i64) = conn
            .query_row(
                "SELECT verdict, verdict_version FROM games WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, crate::verdict::VERDICT_VERSION);
        assert!(verdict.contains("verdict.grade.shaky"), "{verdict}");
        assert!(verdict.contains("verdict.turningPoint"), "{verdict}");
        // Der Wendepunkt ist der vierte Zug von Schwarz, also Zugnummer 4.
        assert!(verdict.contains("\"n\":4"), "{verdict}");

        // Ein zweiter Lauf findet nichts mehr · die Nummer steht.
        assert_eq!(backfill_explanations(&conn).unwrap(), 0);
    }
}
