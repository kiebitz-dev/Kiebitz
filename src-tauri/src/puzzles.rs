//! Puzzle-Training: importiert den Lichess-Puzzle-Dump (CC0) in die lokale
//! Datenbank, wählt Aufgaben nahe am persönlichen Rating und führt ein
//! Elo-basiertes Puzzle-Rating über alle Versuche.

use crate::db;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

pub(crate) mod rating;

use rating::{elo_after, DEFAULT_RATING};

pub struct PuzzleImportState(pub AtomicBool);

impl Default for PuzzleImportState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

const DUMP_URL: &str = "https://database.lichess.org/lichess_db_puzzle.csv.zst";

pub(crate) struct OwnPuzzleCandidate {
    pub ply: u32,
    pub fen: String,
    pub best_uci: String,
    pub phase: String,
    pub judgment: String,
    /// Verlorene Gewinnwahrscheinlichkeit dieses Zuges (0 … 1).
    pub loss: f64,
    /// Eigene Gewinnwahrscheinlichkeit vor dem Zug (0 … 1).
    pub win_prob_before: f64,
}

/// Höchstzahl eigener Aufgaben je Partie. Wer eine Partie zerlegt, patzt oft
/// ein Dutzend Mal · daraus ein Dutzend Aufgaben zu machen füllt den Vorrat mit
/// Varianten desselben verlorenen Spiels. Die teuersten Fehler genügen.
const MAX_OWN_PUZZLES_PER_GAME: usize = 3;

/// Derselbe beste Zug innerhalb dieses Abstands (Halbzüge) ist dieselbe
/// verpasste Idee. Wer eine Gabel drei Züge lang übersieht, bekommt sonst drei
/// fast identische Aufgaben · genau die Wiederholung, die im Training nervt.
const SAME_IDEA_PLY_WINDOW: u32 = 12;

/// Darunter ist die Partie praktisch entschieden. Der „beste Zug" in einer
/// hoffnungslosen Stellung ist keine Lektion, sondern nur der am wenigsten
/// schlechte · als Aufgabe wäre er unlösbar und unlehrreich.
const HOPELESS_WIN_PROB: f64 = 0.08;

/// Aus allen Fehlern einer Partie die Aufgaben auswählen, die etwas beibringen:
/// aussichtslose Stellungen raus, Wiederholungen derselben Idee zusammengefasst,
/// und von dem, was bleibt, die teuersten Fehler.
fn select_own_candidates(candidates: &[OwnPuzzleCandidate]) -> Vec<&OwnPuzzleCandidate> {
    let mut ordered: Vec<&OwnPuzzleCandidate> = candidates
        .iter()
        .filter(|c| c.best_uci.len() >= 4 && c.win_prob_before >= HOPELESS_WIN_PROB)
        .collect();
    ordered.sort_by_key(|c| c.ply);

    let mut kept: Vec<&OwnPuzzleCandidate> = Vec::new();
    let mut last_seen: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    for candidate in ordered {
        let idea = &candidate.best_uci[..4];
        // Auch eine übersprungene Wiederholung verlängert die Kette: sonst käme
        // bei einer sechs Züge lang verpassten Idee jede zweite doch wieder mit.
        if let Some(previous) = last_seen.insert(idea, candidate.ply) {
            if candidate.ply.saturating_sub(previous) <= SAME_IDEA_PLY_WINDOW {
                continue;
            }
        }
        kept.push(candidate);
    }

    if kept.len() > MAX_OWN_PUZZLES_PER_GAME {
        kept.sort_by(|a, b| {
            b.loss
                .partial_cmp(&a.loss)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.ply.cmp(&b.ply))
        });
        kept.truncate(MAX_OWN_PUZZLES_PER_GAME);
        kept.sort_by_key(|c| c.ply);
    }
    kept
}

/// Ersetzt die automatisch erzeugten Aufgaben einer Partie. Eine eigene
/// Aufgabe beginnt direkt vor dem verpassten Zug; deshalb gibt es keinen
/// automatisch abgespielten Setup-Zug (`setup_plies = 0`).
pub(crate) fn replace_own_game_puzzles(
    conn: &Connection,
    game_id: i64,
    player_rating: i64,
    candidates: &[OwnPuzzleCandidate],
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM puzzles WHERE source = 'own' AND source_game_id = ?1",
        params![game_id],
    )
    .map_err(|e| e.to_string())?;
    let mut inserted = 0usize;
    for candidate in select_own_candidates(candidates) {
        let rating = (player_rating
            + if candidate.judgment == "blunder" {
                50
            } else {
                -50
            })
        .clamp(600, 2800);
        let id = format!("own:{game_id}:{}", candidate.ply);
        // Das Motiv des verpassten Zugs steht hinten · Lichess führt das
        // tragende Motiv vorn, die Oberfläche sucht es aber in allen
        // Schlüsseln (siehe `motivTheorie` in lib/motivtheorie.ts).
        let motif = crate::motifs::solution_theme(&candidate.fen, &candidate.best_uci)
            .map(|name| format!(" {name}"))
            .unwrap_or_default();
        let themes = format!(
            "ownGame {} {} oneMove{motif}",
            candidate.phase, candidate.judgment
        );
        conn.execute(
            "INSERT OR REPLACE INTO puzzles
             (id, fen, moves, rating, themes, opening_tags, source,
              source_game_id, source_ply, setup_plies)
             VALUES (?1, ?2, ?3, ?4, ?5, '', 'own', ?6, ?7, 0)",
            params![
                id,
                candidate.fen,
                candidate.best_uci,
                rating,
                themes,
                game_id,
                candidate.ply
            ],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }
    Ok(inserted)
}

/// Eine Zeile aus `move_evals`: ply, eval_cp, mate_in, best_uci, phase, judgment.
type MoveEvalRow = (u32, Option<i32>, Option<i32>, String, String, String);

/// Erzeugt die Aufgaben aus eigenen Partien aus den gespeicherten Zugbewertungen
/// neu. Die Marke wandert mit den Auswahlregeln mit: `v2` fasst Wiederholungen
/// derselben verpassten Idee zusammen, lässt aussichtslose Stellungen weg und
/// begrenzt die Zahl je Partie · ohne erneuten Durchlauf behielten bestehende
/// Datenbanken ihren alten, deutlich größeren Bestand. `v3` gibt jeder Aufgabe
/// das Motiv ihres verpassten Zugs mit (`motifs::solution_theme`).
fn backfill_own_puzzles(conn: &Connection) -> Result<(), String> {
    if db::meta_get(conn, "own_puzzles_backfilled_v3").is_some() {
        return Ok(());
    }
    let games: Vec<(i64, String, String, String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, moves, start_fen, color, my_elo FROM games
                 WHERE analyzed = 1 AND analysis_excluded = 0 AND moves != ''
                   AND EXISTS (SELECT 1 FROM move_evals WHERE game_id = games.id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for (game_id, moves, start_fen, color, rating) in games {
        let walked = crate::chess::walk_from(&start_fen, &moves);
        let my_white = color == "white";
        // Alle Züge der Partie, nicht nur die Fehler: die Bewertung *vor* einem
        // Zug steht in der Zeile davor, und ohne sie ließe sich weder der
        // Verlust noch eine aussichtslose Stellung erkennen.
        let rows: Vec<MoveEvalRow> = {
            let mut stmt = conn
                .prepare(
                    "SELECT ply, eval_cp, mate_in, best_uci, phase, judgment FROM move_evals
                     WHERE game_id = ?1 ORDER BY ply",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![game_id], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        // Gewinnwahrscheinlichkeit aus Weiß-Sicht nach jedem Halbzug; Index 0
        // ist die Ausgangsstellung.
        let mut win_probs: Vec<f64> = vec![0.5; rows.len() + 1];
        for (ply, eval_cp, mate_in, _, _, _) in &rows {
            if let Some(slot) = win_probs.get_mut(*ply as usize) {
                *slot = crate::analysis::win_prob(*eval_cp, *mate_in);
            }
        }
        let candidates: Vec<OwnPuzzleCandidate> = rows
            .into_iter()
            .filter(|(_, _, _, _, _, judgment)| judgment == "mistake" || judgment == "blunder")
            .filter_map(|(ply, _, _, best_uci, phase, judgment)| {
                let walked_move = walked.get(ply.saturating_sub(1) as usize)?;
                if walked_move.by_white != my_white {
                    return None;
                }
                let before = *win_probs.get(ply.saturating_sub(1) as usize)?;
                let after = *win_probs.get(ply as usize)?;
                let loss = if walked_move.by_white {
                    before - after
                } else {
                    after - before
                };
                Some(OwnPuzzleCandidate {
                    ply,
                    fen: walked_move.fen_before.clone(),
                    best_uci,
                    phase,
                    judgment,
                    loss: loss.max(0.0),
                    win_prob_before: if my_white { before } else { 1.0 - before },
                })
            })
            .collect();
        replace_own_game_puzzles(
            conn,
            game_id,
            if rating > 0 { rating } else { DEFAULT_RATING },
            &candidates,
        )?;
    }
    // Aufgaben aus inzwischen gelöschten oder ausgeschlossenen Partien blieben
    // sonst als Karteileichen im Vorrat stehen.
    conn.execute(
        "DELETE FROM puzzles WHERE source = 'own' AND (source_game_id IS NULL OR source_game_id NOT IN
           (SELECT id FROM games WHERE analyzed = 1 AND analysis_excluded = 0 AND moves != ''))",
        [],
    )
    .map_err(|e| e.to_string())?;
    db::meta_set(conn, "own_puzzles_backfilled_v3", "1")
}

// ── Import ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ImportProgress {
    imported: u64,
    /// "download" oder "file"
    source: String,
    /// "download" oder "import" · welcher Abschnitt gerade läuft.
    phase: String,
    /// Bereits geladene und erwartete Bytes des Downloads (0 = unbekannt).
    bytes: u64,
    bytes_total: u64,
}

#[derive(Serialize, Clone)]
struct ImportDone {
    imported: u64,
    total: i64,
    error: Option<String>,
}

/// Importiert den Lichess-Puzzle-Dump. Mit `path` aus einer lokalen Datei
/// (.csv oder .csv.zst), ohne `path` als Direkt-Download (~250 MB).
#[tauri::command]
pub fn import_puzzles(
    app: tauri::AppHandle,
    state: State<PuzzleImportState>,
    path: Option<String>,
) -> Result<(), String> {
    if state.0.swap(true, Ordering::SeqCst) {
        return Err("Ein Puzzle-Import läuft bereits.".into());
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_import(&app2, path);
        let st = app2.state::<PuzzleImportState>();
        st.0.store(false, Ordering::SeqCst);
        let (imported, total, error) = match result {
            Ok((n, total)) => (n, total, None),
            Err(e) => (0, 0, Some(e)),
        };
        let _ = app2.emit(
            "puzzles://done",
            ImportDone {
                imported,
                total,
                error,
            },
        );
    });
    Ok(())
}

/// Zeilen je Transaktion. Der Dump kam vorher als eine einzige Transaktion über
/// Millionen Zeilen an · das hielt den gesamten Schreibvorgang im WAL und war
/// beim geringsten Abbruch komplett verloren. Blockweise festgeschrieben
/// überlebt der Fortschritt auch eine vom System beendete Android-App.
const IMPORT_CHUNK_ROWS: u64 = 250_000;

/// Lesepuffer für Netz und Datei. Der zstd-Strom liefert sonst in kleinen
/// Häppchen, was auf dem Handy spürbar bremst.
const READ_BUFFER: usize = 1 << 20;

/// So oft darf ein abgerissener Download fortgesetzt werden, ohne dass dabei
/// neue Bytes ankommen. Genau das passiert, wenn sich das Handy sperrt: die
/// Verbindung stirbt, die Datei bleibt · fortgesetzt wird sie per Range.
const DOWNLOAD_RETRIES: u32 = 8;

/// Nach so vielen Bytes meldet der Download seinen Stand an die Oberfläche.
const DOWNLOAD_PROGRESS_STEP: u64 = 4 << 20;

fn emit_progress(
    app: &tauri::AppHandle,
    source: &str,
    phase: &str,
    imported: u64,
    bytes: (u64, u64),
) {
    let _ = app.emit(
        "puzzles://progress",
        ImportProgress {
            imported,
            source: source.to_string(),
            phase: phase.to_string(),
            bytes: bytes.0,
            bytes_total: bytes.1,
        },
    );
}

/// Lädt den Dump in den Cache-Ordner und setzt einen Abbruch per HTTP-Range
/// fort. Rückgabe ist die vollständige lokale Datei.
fn download_dump(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Kein Cache-Verzeichnis: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join("lichess_db_puzzle.csv.zst");

    let mut have = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    let mut attempts = 0u32;
    loop {
        match fetch_range(app, &target, have) {
            Ok(()) => return Ok(target),
            Err(error) => {
                let now = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                // Ein Abbruch, der trotzdem Bytes gebracht hat, zählt nicht als
                // Fehlversuch · sonst gäbe eine wacklige Leitung nach acht
                // kurzen Stücken auf, obwohl der Download vorankommt.
                attempts = if now > have { 0 } else { attempts + 1 };
                have = now;
                if attempts > DOWNLOAD_RETRIES {
                    return Err(error);
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        }
    }
}

fn fetch_range(app: &tauri::AppHandle, target: &std::path::Path, have: u64) -> Result<(), String> {
    let mut request = ureq::get(DUMP_URL).timeout(std::time::Duration::from_secs(3600));
    if have > 0 {
        request = request.set("Range", &format!("bytes={have}-"));
    }
    let response = match request.call() {
        Ok(response) => response,
        // 416: der Server hat nichts mehr zu liefern · die Datei ist komplett.
        Err(ureq::Error::Status(416, _)) if have > 0 => return Ok(()),
        Err(e) => return Err(format!("Download fehlgeschlagen: {e}")),
    };
    let resumed = response.status() == 206;
    let announced = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let total = if announced == 0 {
        0
    } else if resumed {
        announced + have
    } else {
        announced
    };

    let mut file = if resumed {
        std::fs::OpenOptions::new()
            .append(true)
            .open(target)
            .map_err(|e| e.to_string())?
    } else {
        // Der Server ignoriert Range (oder es gibt noch nichts): von vorn.
        std::fs::File::create(target).map_err(|e| e.to_string())?
    };
    let mut reader = response.into_reader();
    let mut buffer = vec![0u8; READ_BUFFER];
    let mut done = if resumed { have } else { 0 };
    let mut announced_at = done;
    emit_progress(app, "download", "download", 0, (done, total));
    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..read]).map_err(|e| e.to_string())?;
        done += read as u64;
        if done - announced_at >= DOWNLOAD_PROGRESS_STEP {
            announced_at = done;
            emit_progress(app, "download", "download", 0, (done, total));
        }
    }
    std::io::Write::flush(&mut file).map_err(|e| e.to_string())?;
    // Ein unvollständiger Strom ohne Fehler bleibt ein unvollständiger Strom ·
    // der nächste Versuch setzt dann per Range fort.
    if total > 0 && done < total {
        return Err(format!(
            "Download unvollständig ({done} von {total} Bytes)."
        ));
    }
    Ok(())
}

/// Schlüssel, unter dem ein unterbrochener Import fortgesetzt werden darf: nur
/// exakt dieselbe Quelle in derselben Größe · ein neuerer Dump muss von vorn.
fn resume_key(path: &std::path::Path) -> String {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    format!("{}|{size}", path.display())
}

fn run_import(app: &tauri::AppHandle, path: Option<String>) -> Result<(u64, i64), String> {
    let db_path = app
        .state::<crate::analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "busy_timeout", "10000");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");

    let (file_path, source) = match &path {
        Some(p) => (std::path::PathBuf::from(p), "file"),
        None => (download_dump(app)?, "download"),
    };

    let imported = match import_dump(app, &mut conn, &file_path, source) {
        Ok(imported) => imported,
        Err(error) => {
            // Ein halb geladener oder zum Dump nicht passender Cache-Stand darf
            // den nächsten Versuch nicht dauerhaft blockieren.
            if source == "download" {
                let _ = std::fs::remove_file(&file_path);
                let _ = db::meta_set(&conn, "puzzle_import_key", "");
            }
            return Err(error);
        }
    };
    if source == "download" {
        let _ = std::fs::remove_file(&file_path);
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = db::meta_set(&conn, "puzzle_imported_at", &now.to_string());

    let lichess_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'lichess'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    db::meta_set(&conn, "puzzle_lichess_total", &lichess_total.to_string())?;
    let own_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total = lichess_total + own_total;
    // Millionen frisch geschriebener Zeilen liegen sonst im WAL und bremsen
    // jede spätere Puzzle-Abfrage aus.
    db::checkpoint(&conn);
    Ok((imported, total))
}

/// Liest den CSV-Dump blockweise in die Datenbank. Jeder Block ist eine eigene
/// Transaktion und hinterlässt seinen Stand in `meta`; ein abgebrochener Import
/// setzt beim nächsten Anlauf genau dort wieder auf.
fn import_dump(
    app: &tauri::AppHandle,
    conn: &mut Connection,
    file_path: &std::path::Path,
    source: &str,
) -> Result<u64, String> {
    let file = std::fs::File::open(file_path)
        .map_err(|e| format!("Datei nicht lesbar ({}): {e}", file_path.display()))?;
    let buffered = std::io::BufReader::with_capacity(READ_BUFFER, file);
    let compressed = file_path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zst"));
    let reader: Box<dyn Read> = if compressed {
        Box::new(
            zstd::stream::read::Decoder::new(buffered)
                .map_err(|e| format!("Dump nicht entpackbar: {e}"))?,
        )
    } else {
        Box::new(buffered)
    };
    let mut csv = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(std::io::BufReader::with_capacity(READ_BUFFER, reader));

    let key = resume_key(file_path);
    let resumed = db::meta_get(conn, "puzzle_import_key").as_deref() == Some(key.as_str());
    let already = if resumed {
        db::meta_get(conn, "puzzle_import_rows")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
    } else {
        0
    };
    db::meta_set(conn, "puzzle_import_key", &key)?;
    db::meta_set(conn, "puzzle_import_rows", &already.to_string())?;

    let mut record = csv::StringRecord::new();
    // Bereits verbuchte Zeilen überspringen · das Parsen ist billig, die
    // Einfügungen sind es nicht.
    for _ in 0..already {
        if !csv
            .read_record(&mut record)
            .map_err(|e| format!("CSV-Fehler: {e}"))?
        {
            break;
        }
    }

    let mut imported = already;
    emit_progress(app, source, "import", imported, (0, 0));
    loop {
        let mut in_chunk = 0u64;
        let mut done = true;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO puzzles
                        (id, fen, moves, rating, rd, popularity, nb_plays, themes, opening_tags,
                         source, setup_plies)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'lichess', 1)",
                )
                .map_err(|e| e.to_string())?;
            while csv
                .read_record(&mut record)
                .map_err(|e| format!("CSV-Fehler: {e}"))?
            {
                in_chunk += 1;
                // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
                let rating: i64 = record.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
                if record.len() >= 8 && rating > 0 {
                    stmt.execute(params![
                        record.get(0).unwrap_or(""),
                        record.get(1).unwrap_or(""),
                        record.get(2).unwrap_or(""),
                        rating,
                        record
                            .get(4)
                            .and_then(|v| v.parse::<i64>().ok())
                            .unwrap_or(0),
                        record
                            .get(5)
                            .and_then(|v| v.parse::<i64>().ok())
                            .unwrap_or(0),
                        record
                            .get(6)
                            .and_then(|v| v.parse::<i64>().ok())
                            .unwrap_or(0),
                        record.get(7).unwrap_or(""),
                        record.get(9).unwrap_or(""),
                    ])
                    .map_err(|e| e.to_string())?;
                }
                if in_chunk >= IMPORT_CHUNK_ROWS {
                    done = false;
                    break;
                }
            }
        }
        imported += in_chunk;
        // Der Stand gehört in dieselbe Transaktion wie die Zeilen · sonst
        // stünde nach einem Absturz eine Zahl in `meta`, die es nicht gibt.
        db::meta_set(&tx, "puzzle_import_rows", &imported.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        emit_progress(app, source, "import", imported, (0, 0));
        if done {
            break;
        }
    }

    db::meta_set(conn, "puzzle_import_key", "")?;
    db::meta_set(conn, "puzzle_import_rows", "0")?;
    Ok(imported)
}

// ── Trainer ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PuzzleOut {
    pub id: String,
    pub fen: String,
    /// UCI-Züge; der erste ist der Gegnerzug, der die Aufgabe stellt.
    pub moves: Vec<String>,
    pub rating: i64,
    pub themes: Vec<String>,
    pub source: String,
    pub source_game_id: Option<i64>,
    /// Anzahl der automatisch gespielten Züge, bevor der Löser am Zug ist.
    pub setup_plies: i64,
}

fn personal_rating(conn: &Connection) -> i64 {
    db::meta_get(conn, "puzzle_rating")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RATING)
}

/// Nächstes Puzzle: nahe am persönlichen Rating (oder im gewünschten Band),
/// optional nach Motiv gefiltert; bereits gelöste werden gemieden.
#[tauri::command]
pub async fn next_puzzle(
    app: tauri::AppHandle,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
) -> Result<Option<PuzzleOut>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        next_puzzle_from_conn(&conn, theme, source, min_rating, max_rating)
    })
    .await
    .map_err(|e| format!("Puzzle-Auswahl fehlgeschlagen: {e}"))?
}

/// Nach dieser Zeit darf eine gelöste Aufgabe wieder drankommen · Taktik will
/// wiederholt werden, nur eben nicht am selben Tag.
pub const SOLVED_COOLDOWN_DAYS: i64 = 30;

/// Auch eine verpatzte Aufgabe kommt nicht sofort zurück. Sie zu wiederholen
/// ist richtig, aber nicht, solange die Lösung noch im Kurzzeitgedächtnis
/// liegt · das misst dann nur noch Erinnerung statt Können.
pub const ATTEMPT_COOLDOWN_DAYS: i64 = 5;

/// So viele Nachbarn holt ein Indexsprung, bevor daraus zufällig einer genommen
/// wird.
///
/// Ohne das liefert `ORDER BY rating LIMIT 1` für dasselbe Zielrating immer
/// dieselbe Zeile: bei Millionen Aufgaben liegen auf jedem Rating tausende, und
/// welche davon zuerst im Index steht, ändert sich nie. Der Vorrat schrumpfte
/// dadurch auf zwei Aufgaben je möglichem Zielrating · in einem 150 Punkte
/// breiten Band also auf wenige hundert, und Wiederholungen kamen entsprechend
/// schnell.
const CANDIDATE_POOL: usize = 32;

fn next_puzzle_from_conn(
    conn: &Connection,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
) -> Result<Option<PuzzleOut>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    next_puzzle_at(conn, theme, source, min_rating, max_rating, now)
}

fn next_puzzle_at(
    conn: &Connection,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    now: i64,
) -> Result<Option<PuzzleOut>, String> {
    let me = personal_rating(conn);
    let (base_lo, base_hi) = match (min_rating, max_rating) {
        (Some(lo), Some(hi)) => (lo, hi),
        _ => (me - 75, me + 75),
    };

    let theme_filter = theme.filter(|t| !t.is_empty());
    let source_filter = source.filter(|s| s == "lichess" || s == "own");
    let theme_pattern = theme_filter.as_ref().map(|t| format!("% {t} %"));
    let solved_cooldown = now - SOLVED_COOLDOWN_DAYS * 86_400;
    let attempt_cooldown = now - ATTEMPT_COOLDOWN_DAYS * 86_400;
    // Kürzlich gelöste und überhaupt kürzlich versuchte Aufgaben überspringen;
    // ältere dürfen zurückkommen.
    let filter = puzzle_selection_filter(source_filter.as_deref());
    let columns = "SELECT id, fen, moves, rating, themes, source, source_game_id, setup_plies";
    // Ein zufälliges Zielrating und je ein Indexsprung nach oben und unten:
    // das ist auch bei Millionen Aufgaben konstant schnell, während COUNT(*)
    // plus OFFSET über das ganze Fenster laufen musste.
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1);
    let mut next_random = move |bound: u64| {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        (seed >> 33).rem_euclid(bound.max(1))
    };
    for widen in [0i64, 150, 400, 1200, 4000] {
        let lo = base_lo - widen;
        let hi = base_hi + widen;
        let span = (hi - lo).max(1) as u64;
        let target = lo + next_random(span) as i64;
        for (window_lo, window_hi, order) in [(target, hi, "ASC"), (lo, target, "DESC")] {
            let sql = format!("{columns} {filter} ORDER BY rating {order} LIMIT {CANDIDATE_POOL}");
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut found: Vec<PuzzleOut> = stmt
                .query_map(
                    params![
                        window_lo,
                        window_hi,
                        source_filter.as_deref(),
                        theme_pattern.as_deref(),
                        solved_cooldown,
                        attempt_cooldown
                    ],
                    map_puzzle,
                )
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            if found.is_empty() {
                continue;
            }
            let index = next_random(found.len() as u64) as usize;
            return Ok(Some(found.swap_remove(index)));
        }
    }
    Ok(None)
}

/// Eigene Aufgaben sind gegenüber dem Lichess-Dump sehr selten. Der
/// Rating-Index müsste daher bei einem leeren oder kleinen Own-Game-Bestand
/// Millionen fremde Aufgaben prüfen. Über den Source-Index bleibt die Suche
/// proportional zur Zahl der eigenen Aufgaben. Für alle anderen Quellen ist
/// der Rating-Index weiterhin der schnellste Einstieg.
fn puzzle_selection_filter(source: Option<&str>) -> &'static str {
    if source == Some("own") {
        "FROM puzzles INDEXED BY idx_puzzles_source
         WHERE source = ?3
           AND rating BETWEEN ?1 AND ?2
           AND (?4 IS NULL OR (' ' || themes || ' ') LIKE ?4)
           AND NOT EXISTS (
             SELECT 1 FROM puzzle_attempts AS pa
             WHERE pa.puzzle_id = puzzles.id
               AND ((pa.solved = 1 AND pa.ts >= ?5) OR pa.ts >= ?6)
           )"
    } else {
        "FROM puzzles INDEXED BY idx_puzzles_rating
         WHERE rating BETWEEN ?1 AND ?2
           AND (?3 IS NULL OR source = ?3)
           AND (?4 IS NULL OR (' ' || themes || ' ') LIKE ?4)
           AND NOT EXISTS (
             SELECT 1 FROM puzzle_attempts AS pa
             WHERE pa.puzzle_id = puzzles.id
               AND ((pa.solved = 1 AND pa.ts >= ?5) OR pa.ts >= ?6)
           )"
    }
}

fn map_puzzle(r: &rusqlite::Row) -> rusqlite::Result<PuzzleOut> {
    let moves: String = r.get(2)?;
    let themes: String = r.get(4)?;
    Ok(PuzzleOut {
        id: r.get(0)?,
        fen: r.get(1)?,
        moves: moves.split_whitespace().map(String::from).collect(),
        rating: r.get(3)?,
        themes: themes.split_whitespace().map(String::from).collect(),
        source: r.get(5)?,
        source_game_id: r.get(6)?,
        setup_plies: r.get(7)?,
    })
}

#[derive(Serialize)]
pub struct AttemptResult {
    pub rating_before: i64,
    pub rating_after: i64,
    pub delta: i64,
}

/// Verbucht einen Versuch (gelöst/gescheitert am ersten Anlauf) und
/// aktualisiert das persönliche Rating nach Elo.
#[tauri::command]
pub fn record_attempt(
    db: State<db::Db>,
    puzzle_id: String,
    solved: bool,
) -> Result<AttemptResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    record_attempt_at(&conn, &puzzle_id, solved, now)
}

fn record_attempt_at(
    conn: &Connection,
    puzzle_id: &str,
    solved: bool,
    now: i64,
) -> Result<AttemptResult, String> {
    let (puzzle_rating, themes): (i64, String) = conn
        .query_row(
            "SELECT rating, themes FROM puzzles WHERE id = ?1",
            params![puzzle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Puzzle nicht gefunden".to_string())?;

    let before = personal_rating(conn);
    let after = elo_after(before, puzzle_rating, solved);
    conn.execute(
        "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![puzzle_id, now, solved, before, after, themes, puzzle_rating],
    )
    .map_err(|e| e.to_string())?;
    db::meta_set(conn, "puzzle_rating", &after.to_string())?;

    Ok(AttemptResult {
        rating_before: before,
        rating_after: after,
        delta: after - before,
    })
}

// ── Statistik ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ThemeStat {
    pub theme: String,
    pub attempts: i64,
    pub solved: i64,
}

#[derive(Serialize)]
pub struct PuzzleStats {
    pub personal_rating: i64,
    pub db_total: i64,
    pub lichess_total: i64,
    pub own_total: i64,
    pub attempts: i64,
    pub solved: i64,
    pub today_solved: i64,
    /// Alle heutigen Versuche (gelöst oder nicht) · fürs Tagesziel im Dashboard.
    pub today_attempts: i64,
    pub streak_days: i64,
    pub history: Vec<i64>,
    pub themes: Vec<ThemeStat>,
    pub importing: bool,
    /// Unix-Sekunden des letzten Dump-Imports (None = nie importiert).
    pub imported_at: Option<i64>,
    /// Ein abgebrochener Import kann fortgesetzt werden: es liegt entweder ein
    /// halber Download im Cache oder ein Lesestand in `meta`.
    pub import_resumable: bool,
}

#[tauri::command]
pub async fn puzzle_stats(app: tauri::AppHandle) -> Result<PuzzleStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let importing = app.state::<PuzzleImportState>().0.load(Ordering::SeqCst);
        let partial_download = app
            .path()
            .app_cache_dir()
            .map(|dir| dir.join("lichess_db_puzzle.csv.zst").exists())
            .unwrap_or(false);
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        puzzle_stats_from_conn(&conn, importing, partial_download)
    })
    .await
    .map_err(|e| format!("Puzzle-Statistik fehlgeschlagen: {e}"))?
}

fn puzzle_stats_from_conn(
    conn: &Connection,
    importing: bool,
    partial_download: bool,
) -> Result<PuzzleStats, String> {
    backfill_own_puzzles(conn)?;
    let imported_at = db::meta_get(conn, "puzzle_imported_at").and_then(|v| v.parse().ok());
    let cached_lichess_total =
        db::meta_get(conn, "puzzle_lichess_total").and_then(|value| value.parse::<i64>().ok());
    let lichess_total = match cached_lichess_total {
        Some(total) => total,
        None => {
            let total: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM puzzles WHERE source = 'lichess'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            // Imported databases are static between explicit dump imports, so
            // this millions-row count only needs to run once after upgrading.
            if imported_at.is_some() {
                db::meta_set(conn, "puzzle_lichess_total", &total.to_string())?;
            }
            total
        }
    };
    let own_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let db_total = lichess_total + own_total;
    let (attempts, solved): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(solved), 0) FROM puzzle_attempts",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Lokale Tagesgrenzen sind hier nicht kritisch · UTC-Tage genügen.
    let day_start = now - now.rem_euclid(86_400);
    let today_solved: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzle_attempts WHERE solved = 1 AND ts >= ?1",
            params![day_start],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let today_attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1",
            params![day_start],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Serie: aufeinanderfolgende Tage (rückwärts ab heute) mit ≥ 1 gelöstem Puzzle.
    let days: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT ts / 86400 FROM puzzle_attempts WHERE solved = 1 ORDER BY 1 DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let today = now / 86_400;
    let streak = solved_streak(&days, today);

    let history: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rating_after FROM puzzle_attempts ORDER BY id DESC LIMIT 30")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut v: Vec<i64> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        v.reverse();
        v
    };

    // Motiv-Statistik aus den Versuchen.
    let mut theme_map: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT themes, solved FROM puzzle_attempts")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (themes, ok) = row.map_err(|e| e.to_string())?;
            for t in themes.split_whitespace() {
                let e = theme_map.entry(t.to_string()).or_insert((0, 0));
                e.0 += 1;
                e.1 += ok;
            }
        }
    }
    let mut themes: Vec<ThemeStat> = theme_map
        .into_iter()
        .map(|(theme, (attempts, solved))| ThemeStat {
            theme,
            attempts,
            solved,
        })
        .collect();
    themes.sort_by_key(|theme| std::cmp::Reverse(theme.attempts));
    themes.truncate(10);

    Ok(PuzzleStats {
        personal_rating: personal_rating(conn),
        db_total,
        lichess_total,
        own_total,
        attempts,
        solved,
        today_solved,
        today_attempts,
        streak_days: streak,
        history,
        themes,
        importing,
        imported_at,
        import_resumable: partial_download
            || db::meta_get(conn, "puzzle_import_key").is_some_and(|key| !key.is_empty()),
    })
}

// ── Verlauf ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
pub struct AttemptRow {
    pub puzzle_id: String,
    pub ts: i64,
    pub solved: bool,
    pub rating_before: i64,
    pub rating_after: i64,
    pub puzzle_rating: i64,
    pub themes: Vec<String>,
    /// FEN der Aufgabe, sofern sie noch in der Datenbank liegt.
    pub fen: Option<String>,
}

/// Die letzten Versuche, neueste zuerst.
#[tauri::command]
pub async fn puzzle_history(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<AttemptRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        puzzle_history_from_conn(&conn, limit.unwrap_or(25).clamp(1, 200))
    })
    .await
    .map_err(|e| format!("Puzzle-Verlauf fehlgeschlagen: {e}"))?
}

fn puzzle_history_from_conn(conn: &Connection, limit: i64) -> Result<Vec<AttemptRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT a.puzzle_id, a.ts, a.solved, a.rating_before, a.rating_after,
                    a.puzzle_rating, a.themes, p.fen
             FROM puzzle_attempts AS a
             LEFT JOIN puzzles AS p ON p.id = a.puzzle_id
             ORDER BY a.ts DESC, a.id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            let themes: String = r.get(6)?;
            Ok(AttemptRow {
                puzzle_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                rating_before: r.get(3)?,
                rating_after: r.get(4)?,
                puzzle_rating: r.get(5)?,
                themes: themes.split_whitespace().map(String::from).collect(),
                fen: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ── Detailanalyse (Insights-Unterreiter) ─────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
pub struct BucketStat {
    /// Untergrenze des Ratingfensters bzw. Index (Wochentag 0 = Montag, Stunde).
    pub key: i64,
    pub attempts: i64,
    pub solved: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DayPoint {
    /// Unix-Sekunden des UTC-Tagesbeginns.
    pub day_ts: i64,
    pub attempts: i64,
    pub solved: i64,
    /// Persönliches Rating am Ende dieses Tages.
    pub rating: i64,
}

#[derive(Serialize)]
pub struct PuzzleInsights {
    pub personal_rating: i64,
    pub attempts: i64,
    pub solved: i64,
    /// Ø Rating der versuchten Aufgaben; 0 ohne Versuche.
    pub avg_puzzle_rating: i64,
    /// Ø Rating der gelösten Aufgaben · die tatsächlich geknackte Härte.
    pub avg_solved_rating: i64,
    /// Längste Serie gelöster Aufgaben in Folge.
    pub best_run: i64,
    /// Aktuelle Serie gelöster Aufgaben (0 nach einem Fehlversuch).
    pub current_run: i64,
    /// Alle Motive mit mindestens einem Versuch, absteigend nach Versuchen.
    pub themes: Vec<ThemeStat>,
    /// Trefferquote nach Aufgabenschwierigkeit (400er-Fenster).
    pub by_rating: Vec<BucketStat>,
    /// Trefferquote nach Wochentag (0 = Montag) und Tagesstunde (UTC).
    pub by_weekday: Vec<BucketStat>,
    pub by_hour: Vec<BucketStat>,
    /// Tagesverlauf der letzten Wochen (aufsteigend).
    pub timeline: Vec<DayPoint>,
}

#[tauri::command]
pub async fn puzzle_insights(
    app: tauri::AppHandle,
    days: Option<i64>,
) -> Result<PuzzleInsights, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        puzzle_insights_from_conn(&conn, now, days.unwrap_or(30).clamp(7, 365))
    })
    .await
    .map_err(|e| format!("Puzzle-Analyse fehlgeschlagen: {e}"))?
}

fn puzzle_insights_from_conn(
    conn: &Connection,
    now: i64,
    window_days: i64,
) -> Result<PuzzleInsights, String> {
    // Ein Durchlauf über alle Versuche · die Tabelle bleibt auch nach Jahren
    // klein genug, und so bleiben alle Auswertungen konsistent zueinander.
    struct Attempt {
        ts: i64,
        solved: bool,
        rating_after: i64,
        puzzle_rating: i64,
        themes: String,
    }
    let attempts: Vec<Attempt> = {
        let mut stmt = conn
            .prepare(
                "SELECT ts, solved, rating_after, puzzle_rating, themes
                 FROM puzzle_attempts ORDER BY ts, id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Attempt {
                    ts: r.get(0)?,
                    solved: r.get::<_, i64>(1)? != 0,
                    rating_after: r.get(2)?,
                    puzzle_rating: r.get(3)?,
                    themes: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let solved = attempts.iter().filter(|a| a.solved).count() as i64;
    let rated: Vec<&Attempt> = attempts.iter().filter(|a| a.puzzle_rating > 0).collect();
    let avg = |values: &[i64]| -> i64 {
        if values.is_empty() {
            0
        } else {
            values.iter().sum::<i64>() / values.len() as i64
        }
    };
    let avg_puzzle_rating = avg(&rated.iter().map(|a| a.puzzle_rating).collect::<Vec<_>>());
    let avg_solved_rating = avg(&rated
        .iter()
        .filter(|a| a.solved)
        .map(|a| a.puzzle_rating)
        .collect::<Vec<_>>());

    let (mut best_run, mut current_run) = (0i64, 0i64);
    for attempt in &attempts {
        current_run = if attempt.solved { current_run + 1 } else { 0 };
        best_run = best_run.max(current_run);
    }

    let mut theme_map: std::collections::HashMap<&str, (i64, i64)> =
        std::collections::HashMap::new();
    let mut rating_map: std::collections::BTreeMap<i64, (i64, i64)> =
        std::collections::BTreeMap::new();
    let mut weekday = [(0i64, 0i64); 7];
    let mut hour = [(0i64, 0i64); 24];
    for attempt in &attempts {
        let ok = i64::from(attempt.solved);
        for theme in attempt.themes.split_whitespace() {
            let entry = theme_map.entry(theme).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += ok;
        }
        if attempt.puzzle_rating > 0 {
            let bucket = (attempt.puzzle_rating / 400) * 400;
            let entry = rating_map.entry(bucket).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += ok;
        }
        // 1970-01-01 war ein Donnerstag → Index 3 in einer Montagswoche.
        let index = ((attempt.ts.div_euclid(86_400) + 3).rem_euclid(7)) as usize;
        weekday[index].0 += 1;
        weekday[index].1 += ok;
        let slot = (attempt.ts.rem_euclid(86_400) / 3_600) as usize;
        hour[slot].0 += 1;
        hour[slot].1 += ok;
    }

    let mut themes: Vec<ThemeStat> = theme_map
        .into_iter()
        .map(|(theme, (attempts, solved))| ThemeStat {
            theme: theme.to_string(),
            attempts,
            solved,
        })
        .collect();
    themes.sort_by(|a, b| b.attempts.cmp(&a.attempts).then(a.theme.cmp(&b.theme)));

    let bucket_list = |entries: Vec<(i64, (i64, i64))>| -> Vec<BucketStat> {
        entries
            .into_iter()
            .map(|(key, (attempts, solved))| BucketStat {
                key,
                attempts,
                solved,
            })
            .collect()
    };

    // Tagesverlauf: letzte `window_days` Tage, Rating vom letzten Versuch des Tages.
    let today = now.div_euclid(86_400);
    let first_day = today - window_days + 1;
    let mut timeline: Vec<DayPoint> = (0..window_days)
        .map(|offset| DayPoint {
            day_ts: (first_day + offset) * 86_400,
            attempts: 0,
            solved: 0,
            rating: 0,
        })
        .collect();
    let mut rating_before_window = personal_rating(conn);
    for attempt in &attempts {
        let day = attempt.ts.div_euclid(86_400);
        if day < first_day {
            rating_before_window = attempt.rating_after;
            continue;
        }
        let Some(point) = timeline.get_mut((day - first_day) as usize) else {
            continue;
        };
        point.attempts += 1;
        point.solved += i64::from(attempt.solved);
        point.rating = attempt.rating_after;
    }
    // Tage ohne Versuch übernehmen das Rating des Vortags.
    let mut carried = if attempts.is_empty() {
        personal_rating(conn)
    } else {
        rating_before_window
    };
    for point in timeline.iter_mut() {
        if point.rating == 0 {
            point.rating = carried;
        } else {
            carried = point.rating;
        }
    }

    Ok(PuzzleInsights {
        personal_rating: personal_rating(conn),
        attempts: attempts.len() as i64,
        solved,
        avg_puzzle_rating,
        avg_solved_rating,
        best_run,
        current_run,
        themes,
        by_rating: bucket_list(rating_map.into_iter().collect()),
        by_weekday: bucket_list(
            weekday
                .iter()
                .enumerate()
                .map(|(i, v)| (i as i64, *v))
                .collect(),
        ),
        by_hour: bucket_list(
            hour.iter()
                .enumerate()
                .map(|(i, v)| (i as i64, *v))
                .collect(),
        ),
        timeline,
    })
}

fn solved_streak(days: &[i64], today: i64) -> i64 {
    let mut streak = 0i64;
    let mut expect = today;
    for &day in days {
        if day == expect {
            streak += 1;
            expect -= 1;
        } else if day == expect - 1 && streak == 0 {
            // Nothing solved today: a still-active streak may start yesterday.
            streak = 1;
            expect = day - 1;
        } else {
            break;
        }
    }
    streak
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn puzzle(conn: &Connection, id: &str, rating: i64, themes: &str) {
        conn.execute(
            "INSERT INTO puzzles (id, fen, moves, rating, themes)
             VALUES (?1, '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', ?2, ?3)",
            params![id, rating, themes],
        )
        .unwrap();
    }

    #[test]
    fn elo_moves_in_the_expected_direction() {
        assert_eq!(elo_after(1500, 1500, true), 1512);
        assert_eq!(elo_after(1500, 1500, false), 1488);
        assert!(elo_after(1500, 1800, true) > 1512);
        assert!(elo_after(1500, 1200, false) < 1488);
    }

    #[test]
    fn records_attempt_and_persists_new_personal_rating() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");

        let result = record_attempt_at(&conn, "fork-1", true, 1234).unwrap();
        assert_eq!(result.rating_before, 1500);
        assert_eq!(result.rating_after, 1512);
        assert_eq!(result.delta, 12);
        assert_eq!(personal_rating(&conn), 1512);

        let stored: (i64, i64, String) = conn
            .query_row(
                "SELECT ts, solved, themes FROM puzzle_attempts WHERE puzzle_id = 'fork-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, (1234, 1, "fork short".into()));
    }

    #[test]
    fn selects_by_theme_and_skips_already_solved_puzzles() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1500, "pin short");

        let selected =
            next_puzzle_from_conn(&conn, Some("fork".into()), None, Some(1400), Some(1600))
                .unwrap()
                .unwrap();
        assert_eq!(selected.id, "fork-1");
        assert_eq!(selected.moves, vec!["a1a2", "h1h2"]);
        assert_eq!(selected.themes, vec!["fork", "short"]);

        // Gerade gelöst · innerhalb der Sperrfrist kommt nichts zurück.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        record_attempt_at(&conn, "fork-1", true, now).unwrap();
        assert!(
            next_puzzle_from_conn(&conn, Some("fork".into()), None, Some(1400), Some(1600),)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn failed_puzzles_do_not_come_straight_back() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        let failed_at = 1_800_000_000i64;
        record_attempt_at(&conn, "fork-1", false, failed_at).unwrap();

        let pick = |now: i64| {
            next_puzzle_at(&conn, None, None, Some(1400), Some(1600), now)
                .unwrap()
                .map(|p| p.id)
        };
        // Der häufigste Fall: gescheitert, sofort weiter · dieselbe Aufgabe
        // dürfte hier nicht wieder erscheinen.
        assert_eq!(pick(failed_at + 60), None);
        assert_eq!(pick(failed_at + (ATTEMPT_COOLDOWN_DAYS - 1) * 86_400), None);
        // Später wieder · gescheiterte Aufgaben sollen ja zurückkommen, nur
        // nicht sofort. Insbesondere greift die 30-Tage-Sperre hier nicht.
        assert_eq!(
            pick(failed_at + (ATTEMPT_COOLDOWN_DAYS + 1) * 86_400),
            Some("fork-1".to_string())
        );
    }

    #[test]
    fn solved_puzzles_return_after_the_cooldown() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        let solved_at = 1_800_000_000i64;
        record_attempt_at(&conn, "fork-1", true, solved_at).unwrap();

        let pick = |now: i64| {
            next_puzzle_at(&conn, None, None, Some(1400), Some(1600), now)
                .unwrap()
                .map(|p| p.id)
        };
        // Frisch gelöst: nicht noch einmal.
        assert_eq!(pick(solved_at + 86_400), None);
        assert_eq!(pick(solved_at + (SOLVED_COOLDOWN_DAYS - 1) * 86_400), None);
        // Nach der Sperrfrist darf dieselbe Aufgabe wiederkommen.
        assert_eq!(
            pick(solved_at + (SOLVED_COOLDOWN_DAYS + 1) * 86_400),
            Some("fork-1".to_string())
        );
    }

    #[test]
    fn selection_covers_the_whole_rating_window() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        for rating in [1200, 1300, 1400, 1500, 1600] {
            puzzle(&conn, &format!("p{rating}"), rating, "fork short");
        }
        // Über viele Ziehungen müssen mehrere Aufgaben vorkommen · sonst
        // liefert der Indexsprung immer dieselbe Kante.
        let mut seen = std::collections::HashSet::new();
        for i in 0..40 {
            if let Some(p) =
                next_puzzle_at(&conn, None, None, Some(1200), Some(1600), 1_800_000_000 + i)
                    .unwrap()
            {
                seen.insert(p.id);
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert!(seen.len() >= 3, "zu wenig Streuung: {seen:?}");
    }

    #[test]
    fn selection_spreads_across_puzzles_of_the_same_rating() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        // Der reale Fall: der Lichess-Dump hat auf jedem Rating tausende
        // Aufgaben. Ein Indexsprung auf ein Zielrating traf davon immer
        // dieselbe · genau daher kamen die Wiederholungen.
        for i in 0..60 {
            puzzle(&conn, &format!("p{i}"), 1500, "fork short");
        }
        let mut seen = std::collections::HashSet::new();
        for i in 0..30 {
            if let Some(p) =
                next_puzzle_at(&conn, None, None, Some(1500), Some(1500), 1_800_000_000 + i)
                    .unwrap()
            {
                seen.insert(p.id);
            }
        }
        assert!(seen.len() >= 10, "zu wenig Streuung: {} von 30", seen.len());
    }

    #[test]
    fn stats_cache_the_static_lichess_total_after_an_import() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1550, "pin short");
        db::meta_set(&conn, "puzzle_imported_at", "1234").unwrap();

        let stats = puzzle_stats_from_conn(&conn, false, false).unwrap();
        assert_eq!(stats.db_total, 2);
        assert_eq!(stats.lichess_total, 2);
        assert_eq!(
            db::meta_get(&conn, "puzzle_lichess_total"),
            Some("2".into())
        );
    }

    #[test]
    fn insights_aggregate_themes_ratings_and_timeline() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1200, "fork short");
        puzzle(&conn, "fork-2", 1600, "fork long");
        puzzle(&conn, "pin-1", 1600, "pin short");
        let today = 20_000i64;
        let now = today * 86_400 + 12 * 3_600;

        // Zwei gelöste Aufgaben gestern, ein Fehlversuch heute.
        record_attempt_at(&conn, "fork-1", true, (today - 1) * 86_400 + 3_600).unwrap();
        record_attempt_at(&conn, "fork-2", true, (today - 1) * 86_400 + 7_200).unwrap();
        record_attempt_at(&conn, "pin-1", false, today * 86_400 + 3_600).unwrap();

        let insights = puzzle_insights_from_conn(&conn, now, 30).unwrap();
        assert_eq!(insights.attempts, 3);
        assert_eq!(insights.solved, 2);
        assert_eq!(insights.best_run, 2);
        assert_eq!(insights.current_run, 0);
        assert_eq!(insights.avg_puzzle_rating, (1200 + 1600 + 1600) / 3);
        assert_eq!(insights.avg_solved_rating, (1200 + 1600) / 2);

        let fork = insights
            .themes
            .iter()
            .find(|theme| theme.theme == "fork")
            .unwrap();
        assert_eq!((fork.attempts, fork.solved), (2, 2));

        // Ratingfenster in 400er-Schritten: 1200 und 1600.
        assert_eq!(
            insights.by_rating,
            vec![
                BucketStat {
                    key: 1200,
                    attempts: 1,
                    solved: 1
                },
                BucketStat {
                    key: 1600,
                    attempts: 2,
                    solved: 1
                },
            ]
        );
        assert_eq!(insights.timeline.len(), 30);
        assert_eq!(insights.timeline[29].day_ts, today * 86_400);
        assert_eq!(insights.timeline[29].attempts, 1);
        assert_eq!(insights.timeline[28].solved, 2);
        // Tage ohne Versuch tragen das zuletzt bekannte Rating weiter.
        assert!(insights.timeline[0].rating > 0);
    }

    #[test]
    fn history_returns_newest_attempts_with_puzzle_data() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1600, "pin short");
        record_attempt_at(&conn, "fork-1", true, 1_800_000_000).unwrap();
        record_attempt_at(&conn, "pin-1", false, 1_800_000_100).unwrap();

        let history = puzzle_history_from_conn(&conn, 25).unwrap();
        assert_eq!(history.len(), 2);
        // Neueste zuerst.
        assert_eq!(history[0].puzzle_id, "pin-1");
        assert!(!history[0].solved);
        assert_eq!(history[0].puzzle_rating, 1600);
        assert_eq!(history[1].themes, vec!["fork", "short"]);
        assert!(history[1].fen.is_some());
        assert_eq!(puzzle_history_from_conn(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn solved_streak_handles_today_yesterday_and_gaps() {
        assert_eq!(solved_streak(&[10, 9, 8], 10), 3);
        assert_eq!(solved_streak(&[9, 8], 10), 2);
        assert_eq!(solved_streak(&[10, 8], 10), 1);
        assert_eq!(solved_streak(&[], 10), 0);
    }

    fn candidate(ply: u32, best_uci: &str, loss: f64) -> OwnPuzzleCandidate {
        OwnPuzzleCandidate {
            ply,
            fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".into(),
            best_uci: best_uci.into(),
            phase: "middlegame".into(),
            judgment: "mistake".into(),
            loss,
            win_prob_before: 0.5,
        }
    }

    #[test]
    fn repeated_misses_of_the_same_move_become_one_puzzle() {
        // Der reale Fall: dieselbe Gabel drei Züge lang übersehen. Das ist eine
        // verpasste Idee, nicht drei Aufgaben.
        let candidates = vec![
            candidate(21, "d2h6", 0.25),
            candidate(23, "d2h6", 0.24),
            candidate(25, "d2h6", 0.22),
            // Weit später wieder derselbe Zug · andere Stellung, eigene Aufgabe.
            candidate(61, "d2h6", 0.30),
        ];
        let picked = select_own_candidates(&candidates);
        assert_eq!(
            picked.iter().map(|c| c.ply).collect::<Vec<_>>(),
            vec![21, 61]
        );
    }

    #[test]
    fn keeps_only_the_costliest_misses_of_a_game() {
        let candidates = vec![
            candidate(11, "a1a2", 0.21),
            candidate(31, "b1b2", 0.44),
            candidate(51, "c1c2", 0.22),
            candidate(71, "d1d2", 0.60),
            candidate(91, "e1e2", 0.31),
        ];
        let picked = select_own_candidates(&candidates);
        // Höchstens drei · und die in Zugreihenfolge, damit die IDs stabil sind.
        assert_eq!(
            picked.iter().map(|c| c.ply).collect::<Vec<_>>(),
            vec![31, 71, 91]
        );
    }

    #[test]
    fn skips_misses_in_already_lost_positions() {
        let mut hopeless = candidate(41, "a1a2", 0.25);
        hopeless.win_prob_before = 0.02;
        assert!(select_own_candidates(&[hopeless]).is_empty());
    }

    #[test]
    fn generates_and_replaces_puzzles_from_own_games() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let candidates = vec![OwnPuzzleCandidate {
            ply: 17,
            fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".into(),
            best_uci: "e1g1".into(),
            phase: "opening".into(),
            judgment: "blunder".into(),
            loss: 0.35,
            win_prob_before: 0.6,
        }];
        assert_eq!(
            replace_own_game_puzzles(&conn, 42, 1400, &candidates).unwrap(),
            1
        );

        let selected =
            next_puzzle_from_conn(&conn, None, Some("own".into()), Some(1000), Some(1800))
                .unwrap()
                .unwrap();
        assert_eq!(selected.id, "own:42:17");
        assert_eq!(selected.source, "own");
        assert_eq!(selected.source_game_id, Some(42));
        assert_eq!(selected.setup_plies, 0);
        assert_eq!(selected.moves, vec!["e1g1"]);

        replace_own_game_puzzles(&conn, 42, 1400, &[]).unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn own_game_selection_uses_source_index() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let sql = format!(
            "EXPLAIN QUERY PLAN SELECT id {} ORDER BY rating ASC LIMIT 1",
            puzzle_selection_filter(Some("own"))
        );
        let mut stmt = conn.prepare(&sql).unwrap();
        let details: Vec<String> = stmt
            .query_map(
                params![1400, 1600, "own", Option::<String>::None, 0, 0],
                |row| row.get(3),
            )
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();

        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_puzzles_source")),
            "unexpected query plan: {details:?}"
        );
        assert!(
            details
                .iter()
                .all(|detail| !detail.contains("idx_puzzles_rating")),
            "own-game query fell back to the large rating index: {details:?}"
        );
    }
}
