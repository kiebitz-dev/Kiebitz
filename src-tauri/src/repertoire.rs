//! Eröffnungs-Repertoire: persistenter Zugbaum, FSRS-Spaced-Repetition
//! und Abgleich gegen die gespielten Partien.

use crate::chess;
use crate::db;
use crate::rep_pgn;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

// ── FSRS-Scheduler (Default-Gewichte, Retention 0,9) ─────────────────────────

const W: [f64; 17] = [
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
    0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const FACTOR: f64 = 19.0 / 81.0;
const DECAY: f64 = -0.5;

/// Abrufwahrscheinlichkeit nach `days` Tagen bei Stabilität `s`.
fn retrievability(days: f64, s: f64) -> f64 {
    (1.0 + FACTOR * days / s.max(0.1)).powf(DECAY)
}

fn init_stability(grade: u8) -> f64 {
    W[(grade as usize - 1).min(3)].max(0.1)
}

fn init_difficulty(grade: u8) -> f64 {
    (W[4] - (grade as f64 - 3.0) * W[5]).clamp(1.0, 10.0)
}

fn next_difficulty(d: f64, grade: u8) -> f64 {
    let d_new = d - W[6] * (grade as f64 - 3.0);
    (W[7] * W[4] + (1.0 - W[7]) * d_new).clamp(1.0, 10.0)
}

fn next_stability(s: f64, d: f64, r: f64, grade: u8) -> f64 {
    if grade == 1 {
        // Lapse: Stabilität bricht ein, aber nie über den alten Wert.
        let s_fail =
            W[11] * d.powf(-W[12]) * ((s + 1.0).powf(W[13]) - 1.0) * (W[14] * (1.0 - r)).exp();
        return s_fail.min(s).max(0.1);
    }
    let hard = if grade == 2 { W[15] } else { 1.0 };
    let easy = if grade == 4 { W[16] } else { 1.0 };
    let growth = (W[8]).exp() * (11.0 - d) * s.powf(-W[9]) * ((W[10] * (1.0 - r)).exp() - 1.0);
    s * (growth * hard * easy + 1.0)
}

/// FSRS-Update: liefert (neue Stabilität, neue Schwierigkeit, Intervall in Tagen).
fn fsrs_review(
    stability: f64,
    difficulty: f64,
    reps: i64,
    elapsed_days: f64,
    grade: u8,
) -> (f64, f64, i64) {
    let (s, d) = if reps == 0 {
        (init_stability(grade), init_difficulty(grade))
    } else {
        let r = retrievability(elapsed_days.max(0.0), stability);
        (
            next_stability(stability, difficulty, r, grade),
            next_difficulty(difficulty, grade),
        )
    };
    // Bei Retention 0,9 entspricht das Intervall der Stabilität.
    let interval = if grade == 1 {
        0
    } else {
        (s.round() as i64).clamp(1, 365)
    };
    (s, d, interval)
}

// ── Datenformen ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct RepNodeOut {
    pub id: i64,
    pub parent_id: i64,
    pub side: String,
    pub san: String,
    pub name: String,
    /// Freitext zur Stellung: Plan, Idee, Falle.
    pub note: String,
    /// Normalisierter Stellungsschlüssel · gleiche Schlüssel auf derselben
    /// Seite sind Transpositionen.
    pub fen_key: String,
    pub depth: i64,
    pub reps: i64,
    pub lapses: i64,
    pub due_ts: i64,
    pub stability: f64,
    /// Selbst gewählte Position in der Variantenliste · 0 = nie sortiert.
    pub sort_order: i64,
    /// True, wenn dieser Zug von mir zu spielen ist (trainierbar).
    pub my_move: bool,
}

pub(crate) fn is_my_move(side: &str, depth: i64) -> bool {
    if side == "white" {
        depth % 2 == 1
    } else {
        depth % 2 == 0
    }
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub(crate) fn load_nodes(conn: &Connection) -> Result<Vec<RepNodeOut>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, side, san, name, depth, reps, lapses, due_ts, stability,
                    note, fen_key, sort_order
             FROM rep_nodes ORDER BY depth, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let side: String = r.get(2)?;
            let depth: i64 = r.get(5)?;
            Ok(RepNodeOut {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                my_move: is_my_move(&side, depth),
                side,
                san: r.get(3)?,
                name: r.get(4)?,
                depth,
                reps: r.get(6)?,
                lapses: r.get(7)?,
                due_ts: r.get(8)?,
                stability: r.get(9)?,
                note: r.get(10)?,
                fen_key: r.get(11)?,
                sort_order: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rep_list(db: State<db::Db>) -> Result<Vec<RepNodeOut>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    load_nodes(&conn)
}

/// Reihenfolge der Varianten einer Seite festschreiben.
///
/// `node_ids` ist die vollständige Liste der Linien-Endpunkte in ihrer neuen
/// Reihenfolge; jeder bekommt seinen Platz als 1-basierte Zahl. Später
/// angelegte Linien behalten die 0 und hängen sich damit hinten an.
#[tauri::command]
pub fn rep_reorder(db: State<db::Db>, side: String, node_ids: Vec<i64>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    reorder_nodes(&mut conn, &side, &node_ids, now_ts())
}

fn reorder_nodes(
    conn: &mut Connection,
    side: &str,
    node_ids: &[i64],
    ts: i64,
) -> Result<(), String> {
    if side != "white" && side != "black" {
        return Err("Seite muss white oder black sein".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut update = tx
            .prepare(
                "UPDATE rep_nodes SET sort_order = ?2, sort_ts = ?3
                 WHERE id = ?1 AND side = ?4",
            )
            .map_err(|e| e.to_string())?;
        for (index, id) in node_ids.iter().enumerate() {
            update
                .execute(params![id, index as i64 + 1, ts, side])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Notiz einer Stellung setzen (leerer Text löscht sie).
#[tauri::command]
pub fn rep_set_note(db: State<db::Db>, node_id: i64, note: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE rep_nodes SET note = ?2 WHERE id = ?1",
            params![node_id, note.trim()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Knoten nicht gefunden".into());
    }
    Ok(())
}

/// Name einer Variante setzen (leerer Text nimmt ihn weg).
///
/// Gebraucht wird das beim Bearbeiten einer Variante: `rep_add_line` benennt
/// den *neuen* Endpunkt, der alte trüge seinen Namen sonst weiter und stünde
/// als zweite, gleichnamige Zeile in der Liste. Ein leerer Name macht aus ihm
/// wieder einen gewöhnlichen Zwischenzug.
#[tauri::command]
pub fn rep_set_name(db: State<db::Db>, node_id: i64, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE rep_nodes SET name = ?2 WHERE id = ?1",
            params![node_id, name.trim()],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Knoten nicht gefunden".into());
    }
    Ok(())
}

/// Stellung nach `sans` von der Grundstellung aus · Fehler nennt den Zug.
fn position_after(sans: &[String]) -> Result<chess::Position, String> {
    let mut pos = chess::Position::initial();
    for (i, san_str) in sans.iter().enumerate() {
        let m = chess::parse_san(&pos, san_str).map_err(|e| format!("Zug {} {e}", i + 1))?;
        pos = pos
            .make_move(m)
            .map_err(|_| format!("Zug {} illegal: {san_str}", i + 1))?;
    }
    Ok(pos)
}

/// Knoten derselben Seite, die dieselbe Stellung erreichen wie `sans`.
///
/// Das Repertoire ist ein Baum, Schach aber nicht: dieselbe Stellung über eine
/// andere Zugfolge ist ein zweiter Knoten mit eigenem Lernstand. Wer das beim
/// Anlegen sieht, kann sich für eine der beiden Fassungen entscheiden.
#[tauri::command]
pub fn rep_lookup(
    db: State<db::Db>,
    side: String,
    sans: Vec<String>,
) -> Result<Vec<RepNodeOut>, String> {
    let key = chess::fen_key(&position_after(&sans)?);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(load_nodes(&conn)?
        .into_iter()
        .filter(|n| n.side == side && n.fen_key == key)
        .collect())
}

/// Fügt eine Zugfolge ab der Grundstellung ein; vorhandene Knoten werden
/// wiederverwendet. `name` benennt den letzten Knoten der Linie.
#[tauri::command]
pub fn rep_add_line(
    db: State<db::Db>,
    side: String,
    name: String,
    sans: Vec<String>,
) -> Result<i64, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    insert_line(&conn, &side, &name, &sans).map(|(id, _)| id)
}

/// Legt eine Linie an und meldet (Blatt-Id, Anzahl neu angelegter Knoten).
fn insert_line(
    conn: &Connection,
    side: &str,
    name: &str,
    sans: &[String],
) -> Result<(i64, i64), String> {
    if side != "white" && side != "black" {
        return Err("Seite muss white oder black sein".into());
    }
    if sans.is_empty() {
        return Err("Keine Züge angegeben".into());
    }
    let mut added = 0i64;

    let mut pos = chess::Position::initial();
    let mut parent_id = 0i64;
    let mut leaf_id = 0i64;
    for (i, san_str) in sans.iter().enumerate() {
        // parse_san liefert "nicht lesbar: …" bzw. "illegal: …", die Meldung
        // bleibt damit wortgleich zur früheren Fassung.
        let m = chess::parse_san(&pos, san_str).map_err(|e| format!("Zug {} {e}", i + 1))?;
        let clean_san = chess::canonical_san(&pos, m)
            .map_err(|_| format!("Zug {} illegal: {san_str}", i + 1))?;
        pos = pos
            .make_move(m)
            .map_err(|_| format!("Zug {} illegal: {san_str}", i + 1))?;
        let key = chess::fen_key(&pos);
        let depth = (i + 1) as i64;

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM rep_nodes WHERE side = ?1 AND parent_id = ?2 AND san = ?3",
                params![side, parent_id, clean_san],
                |r| r.get(0),
            )
            .ok();
        leaf_id = match existing {
            Some(id) => id,
            None => {
                conn.execute(
                    "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, created_ts)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![parent_id, side, clean_san, key, depth, db::now_ts()],
                )
                .map_err(|e| e.to_string())?;
                added += 1;
                conn.last_insert_rowid()
            }
        };
        parent_id = leaf_id;
    }
    if !name.trim().is_empty() {
        conn.execute(
            "UPDATE rep_nodes SET name = ?2 WHERE id = ?1",
            params![leaf_id, name.trim()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok((leaf_id, added))
}

#[derive(Serialize)]
pub struct ImportResult {
    pub lines: i64,
    pub added: i64,
    pub skipped: i64,
}

/// Liest ein PGN mit Varianten in den Baum einer Seite ein.
#[tauri::command]
pub fn rep_import_pgn(
    db: State<db::Db>,
    side: String,
    name: String,
    pgn: String,
) -> Result<ImportResult, String> {
    let lines = rep_pgn::parse_lines(&pgn);
    if lines.is_empty() {
        return Err("Keine lesbaren Züge im PGN gefunden.".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut added = 0i64;
    let mut skipped = 0i64;
    let mut ok = 0i64;
    for (index, line) in lines.iter().enumerate() {
        // Der Name gehört an die erste (längste) Linie · sonst hinge er an
        // einer beliebigen Nebenvariante.
        let label = if index == 0 { name.as_str() } else { "" };
        match insert_line(&conn, &side, label, line) {
            Ok((_, n)) => {
                added += n;
                ok += 1;
            }
            Err(_) => skipped += 1,
        }
    }
    Ok(ImportResult {
        lines: ok,
        added,
        skipped,
    })
}

/// Wie `rep_import_pgn`, liest den Text aber aus einer Datei · das Frontend
/// bekommt vom Dateidialog nur einen Pfad und kann selbst nichts lesen.
#[tauri::command]
pub fn rep_import_pgn_file(
    db: State<db::Db>,
    side: String,
    name: String,
    path: String,
) -> Result<ImportResult, String> {
    let text =
        std::fs::read_to_string(path.trim()).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    rep_import_pgn(db, side, name, text)
}

/// Schreibt das PGN einer Seite in eine Datei und meldet den Pfad zurück.
#[tauri::command]
pub fn rep_export_pgn_file(
    db: State<db::Db>,
    side: String,
    path: String,
) -> Result<String, String> {
    let pgn = rep_export_pgn(db, side)?;
    let target = path.trim();
    std::fs::write(target, pgn).map_err(|e| format!("Datei nicht schreibbar: {e}"))?;
    Ok(target.to_string())
}

/// Schreibt den Baum einer Seite als PGN mit Klammervarianten.
fn rep_export_pgn(db: State<db::Db>, side: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let mut children: HashMap<i64, Vec<&RepNodeOut>> = HashMap::new();
    for n in nodes.iter().filter(|n| n.side == side) {
        children.entry(n.parent_id).or_default().push(n);
    }
    fn build(children: &HashMap<i64, Vec<&RepNodeOut>>, parent: i64) -> Vec<rep_pgn::ExportNode> {
        children
            .get(&parent)
            .map(|kids| {
                kids.iter()
                    .map(|n| rep_pgn::ExportNode {
                        san: n.san.clone(),
                        note: n.note.clone(),
                        children: build(children, n.id),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
    let roots = build(&children, 0);
    if roots.is_empty() {
        return Err("Für diese Seite steht noch nichts im Repertoire.".into());
    }
    Ok(rep_pgn::export_pgn(&side, &roots))
}

/// Löscht einen Knoten samt aller Untervarianten.
#[tauri::command]
pub fn rep_delete(db: State<db::Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Pfad des Knotens für den Sync-Tombstone bestimmen (Wurzel → Knoten),
    // damit die Löschung auf gepairte Geräte propagiert.
    let mut parts: Vec<String> = Vec::new();
    let mut side = String::new();
    let mut cur = id;
    while cur != 0 {
        match conn
            .query_row(
                "SELECT parent_id, san, side FROM rep_nodes WHERE id = ?1",
                params![cur],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .ok()
        {
            Some((parent, san, s)) => {
                parts.push(san);
                side = s;
                cur = parent;
            }
            None => break,
        }
    }
    if !parts.is_empty() {
        parts.reverse();
        let path = parts.join(" ");
        let _ = conn.execute(
            "INSERT INTO rep_tombstones (side, path, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(side, path) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![side, path, db::now_ts()],
        );
    }
    conn.execute(
        "DELETE FROM rep_nodes WHERE id IN (
            WITH RECURSIVE sub(i) AS (
                SELECT ?1
                UNION ALL
                SELECT r.id FROM rep_nodes r JOIN sub ON r.parent_id = sub.i
            ) SELECT i FROM sub)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Training ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DueItem {
    pub node_id: i64,
    pub side: String,
    /// Züge bis zur Ausgangsstellung (vor meinem Zug).
    pub prompt_sans: Vec<String>,
    pub expected_san: String,
    pub line: String,
    pub is_new: bool,
}

fn path_to(nodes: &HashMap<i64, RepNodeOut>, id: i64) -> Vec<String> {
    let mut path = Vec::new();
    let mut cur = id;
    while cur != 0 {
        match nodes.get(&cur) {
            Some(n) => {
                path.push(n.san.clone());
                cur = n.parent_id;
            }
            None => break,
        }
    }
    path.reverse();
    path
}

/// Name der Linie: nächster benannter Vorfahre (oder eigener Name).
fn line_name(nodes: &HashMap<i64, RepNodeOut>, id: i64) -> String {
    let mut cur = id;
    while cur != 0 {
        match nodes.get(&cur) {
            Some(n) => {
                if !n.name.is_empty() {
                    return n.name.clone();
                }
                cur = n.parent_id;
            }
            None => break,
        }
    }
    String::new()
}

/// Fällige Karten einer Sitzung.
///
/// Die Grenzen sind das Gegenstück zum Import: ein frisch eingelesenes Buch
/// bringt hunderte neue Züge mit, und ein Stapel, den man nicht schaffen kann,
/// wird gar nicht erst angefangen. `due_limit`/`new_limit` <= 0 heißt "alles".
#[tauri::command]
pub fn rep_due(
    db: State<db::Db>,
    due_limit: Option<i64>,
    new_limit: Option<i64>,
) -> Result<Vec<DueItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let by_id: HashMap<i64, RepNodeOut> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let now = now_ts();

    let mut due: Vec<(&RepNodeOut, bool)> = nodes
        .iter()
        .filter(|n| n.my_move && (n.reps == 0 || n.due_ts <= now))
        .map(|n| (n, n.reps == 0))
        .collect();
    // Fällige zuerst (älteste zuerst), neue danach.
    due.sort_by_key(|(n, is_new)| (*is_new, n.due_ts, n.depth));

    let due_cap = due_limit.filter(|v| *v > 0).map(|v| v as usize);
    let new_cap = new_limit.filter(|v| *v > 0).map(|v| v as usize);
    let mut taken_due = 0usize;
    let mut taken_new = 0usize;

    Ok(due
        .into_iter()
        .filter(|(_, is_new)| {
            let (count, cap) = if *is_new {
                (&mut taken_new, new_cap)
            } else {
                (&mut taken_due, due_cap)
            };
            if cap.is_some_and(|c| *count >= c) {
                return false;
            }
            *count += 1;
            true
        })
        .map(|(n, is_new)| {
            let mut prompt = path_to(&by_id, n.id);
            prompt.pop(); // letzter Zug ist die gesuchte Antwort
            DueItem {
                node_id: n.id,
                side: n.side.clone(),
                prompt_sans: prompt,
                expected_san: n.san.clone(),
                line: line_name(&by_id, n.id),
                is_new,
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct ReviewResult {
    pub due_ts: i64,
    pub interval_days: i64,
}

/// SAN-Kette von der Wurzel bis zum Knoten, plus seine Seite · derselbe
/// geräteunabhängige Schlüssel, den der Sync für Knoten und Tombstones nutzt.
/// Damit kann das Wiederholungslog zwischen Geräten vereinigt werden, ohne
/// dass lokale `id`-Werte kollidieren.
pub(crate) fn node_path(conn: &Connection, node_id: i64) -> Option<(String, String)> {
    let mut sans: Vec<String> = Vec::new();
    let mut side = String::new();
    let mut cur = node_id;
    // Ein Repertoirepfad ist kurz · die Obergrenze schützt nur davor, dass eine
    // defekte parent_id die Schleife ewig laufen lässt.
    for _ in 0..64 {
        if cur == 0 {
            break;
        }
        let row = conn.query_row(
            "SELECT parent_id, side, san FROM rep_nodes WHERE id = ?1",
            params![cur],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        );
        match row {
            Ok((parent, node_side, san)) => {
                side = node_side;
                sans.push(san);
                cur = parent;
            }
            Err(_) => return None,
        }
    }
    sans.reverse();
    Some((side, sans.join(" ")))
}

/// Bewertet eine Trainingsantwort: 1 = falsch, 2 = schwer, 3 = gut, 4 = leicht.
#[tauri::command]
pub fn rep_review(db: State<db::Db>, node_id: i64, grade: u8) -> Result<ReviewResult, String> {
    if !(1..=4).contains(&grade) {
        return Err("Grade muss 1–4 sein".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (stability, difficulty, reps, lapses, last_ts): (f64, f64, i64, i64, i64) = conn
        .query_row(
            "SELECT stability, difficulty, reps, lapses, last_ts FROM rep_nodes WHERE id = ?1",
            params![node_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "Knoten nicht gefunden".to_string())?;

    let now = now_ts();
    let elapsed_days = (now - last_ts) as f64 / 86_400.0;
    let (s, d, interval) = fsrs_review(stability, difficulty, reps, elapsed_days, grade);
    let due_ts = if grade == 1 {
        now + 600
    } else {
        now + interval * 86_400
    };
    let lapses = lapses + i64::from(grade == 1 && reps > 0);

    conn.execute(
        "UPDATE rep_nodes SET stability = ?2, difficulty = ?3, reps = reps + 1,
            lapses = ?4, due_ts = ?5, last_ts = ?6 WHERE id = ?1",
        params![node_id, s, d, lapses, due_ts, now],
    )
    .map_err(|e| e.to_string())?;
    // Append-only Verlauf für die Wirkungsmessung. `rep_nodes.last_ts` hält nur
    // die letzte Wiederholung · ohne dieses Log löscht sich die Trainingslast
    // der Vergangenheit selbst. Ein Fehler hier darf das Training nicht stoppen.
    if let Some((side, path)) = node_path(&conn, node_id) {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO rep_review_log (node_id, ts, grade, side, path)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![node_id, now, grade as i64, side, path],
        );
    }
    Ok(ReviewResult {
        due_ts,
        interval_days: interval,
    })
}

// ── Abgleich mit den Partien ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SideCoverage {
    pub side: String,
    pub games: i64,
    pub covered: i64,
    pub pct: f64,
}

#[derive(Serialize)]
pub struct RepStats {
    /// Anzahl trainierbarer Stellungen (meine Züge).
    pub my_positions: i64,
    pub due_now: i64,
    /// Anteil der geprüften Partien, die bis `plies` im Buch blieben.
    pub coverage_pct: f64,
    pub games_checked: i64,
    /// Tiefe der Prüfung in Halbzügen · steht mit im Ergebnis, weil die
    /// Zahl ohne sie nicht zu deuten ist.
    pub plies: i64,
    /// Dieselbe Rechnung getrennt nach Farbe · als Weiß und als Schwarz sind
    /// das zwei verschiedene Repertoires mit verschiedenen Löchern.
    pub by_side: Vec<SideCoverage>,
}

/// Ein Zug aus den eigenen Partien, den das Buch an dieser Stelle nicht kennt.
#[derive(Serialize)]
pub struct RepGap {
    /// Knoten, an dem das Buch verlassen wurde (0 = Grundstellung).
    pub node_id: i64,
    pub side: String,
    /// Züge bis zu dieser Stellung.
    pub path_sans: Vec<String>,
    pub san: String,
    pub count: i64,
    /// True, wenn ich selbst abgewichen bin · sonst fehlt mir eine Antwort.
    pub mine: bool,
    /// Ergebnis der betroffenen Partien aus meiner Sicht.
    pub score_pct: f64,
    /// Züge, die das Buch hier stattdessen kennt.
    pub book_sans: Vec<String>,
    /// Name der Linie, in der die Lücke sitzt.
    pub line: String,
}

/// (side, parent_id) → [(san, id)]
pub(crate) type BookChildren = HashMap<(String, i64), Vec<(String, i64)>>;

pub(crate) fn book_children(nodes: &[RepNodeOut]) -> BookChildren {
    let mut children: BookChildren = HashMap::new();
    for n in nodes {
        children
            .entry((n.side.clone(), n.parent_id))
            .or_default()
            .push((n.san.clone(), n.id));
    }
    children
}

/// Wo eine Partie das Buch verlässt.
pub(crate) struct Departure {
    pub(crate) node_id: i64,
    pub(crate) path: Vec<String>,
    pub(crate) san: String,
    pub(crate) ply: i64,
    /// Kannte das Buch an dieser Stelle überhaupt eine Fortsetzung?
    pub(crate) book_has_moves: bool,
}

/// Spielt eine Partie am Buch entlang und meldet die erste Abweichung.
/// `None` heißt: bis `plies` blieb alles im Buch.
pub(crate) fn walk_book(
    children: &BookChildren,
    color: &str,
    moves: &str,
    plies: usize,
) -> Option<Departure> {
    let mut node_id = 0i64;
    let mut path: Vec<String> = Vec::new();
    for (i, san) in moves.split_whitespace().take(plies).enumerate() {
        let kids = children.get(&(color.to_string(), node_id));
        match kids.and_then(|k| k.iter().find(|(s, _)| s == san)) {
            Some((_, id)) => {
                node_id = *id;
                path.push(san.to_string());
            }
            None => {
                return Some(Departure {
                    node_id,
                    path,
                    san: san.to_string(),
                    ply: (i + 1) as i64,
                    book_has_moves: kids.map(|k| !k.is_empty()).unwrap_or(false),
                })
            }
        }
    }
    None
}

fn recent_games(conn: &Connection, limit: i64) -> Result<Vec<(String, String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT color, moves, result FROM games
             WHERE moves != '' AND analysis_excluded = 0
             ORDER BY played_ts DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn clamp_plies(plies: Option<i64>) -> i64 {
    plies.unwrap_or(8).clamp(2, 40)
}

fn clamp_games(games: Option<i64>) -> i64 {
    games.unwrap_or(50).clamp(1, 1000)
}

fn pct(part: f64, whole: f64) -> f64 {
    if whole > 0.0 {
        (part / whole * 1000.0).round() / 10.0
    } else {
        0.0
    }
}

fn score_of(result: &str) -> f64 {
    match result {
        "win" => 1.0,
        "draw" => 0.5,
        _ => 0.0,
    }
}

#[tauri::command]
pub fn rep_stats(
    db: State<db::Db>,
    plies: Option<i64>,
    games: Option<i64>,
) -> Result<RepStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let now = now_ts();
    let my_positions = nodes.iter().filter(|n| n.my_move).count() as i64;
    let due_now = nodes
        .iter()
        .filter(|n| n.my_move && (n.reps == 0 || n.due_ts <= now))
        .count() as i64;

    let depth = clamp_plies(plies);
    let children = book_children(&nodes);
    let games = recent_games(&conn, clamp_games(games))?;

    let mut covered = 0i64;
    let mut per_side: HashMap<String, (i64, i64)> = HashMap::new();
    for (color, moves, _) in &games {
        // Buch verlassen: nur mein eigener Abweichler zählt gegen mich, und
        // nur wenn das Buch hier überhaupt eine Fortsetzung kennt.
        let ok = match walk_book(&children, color, moves, depth as usize) {
            Some(d) => !(is_my_move(color, d.ply) && d.book_has_moves),
            None => true,
        };
        let entry = per_side.entry(color.clone()).or_insert((0, 0));
        entry.0 += 1;
        if ok {
            entry.1 += 1;
            covered += 1;
        }
    }

    let checked = games.len() as i64;
    let mut by_side: Vec<SideCoverage> = ["white", "black"]
        .iter()
        .filter_map(|side| {
            per_side.get(*side).map(|(total, ok)| SideCoverage {
                side: (*side).to_string(),
                games: *total,
                covered: *ok,
                pct: pct(*ok as f64, *total as f64),
            })
        })
        .collect();
    by_side.sort_by_key(|side| std::cmp::Reverse(side.games));

    Ok(RepStats {
        my_positions,
        due_now,
        coverage_pct: pct(covered as f64, checked as f64),
        games_checked: checked,
        plies: depth,
        by_side,
    })
}

/// Lücken im Buch aus den eigenen Partien: Stellungen, die das Buch kennt, in
/// denen aber ein Zug fiel, den es nicht kennt · einmal als eigener Ausrutscher
/// und einmal als unbeantwortete Gegnerantwort.
#[tauri::command]
pub fn rep_gaps(
    db: State<db::Db>,
    plies: Option<i64>,
    games: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<RepGap>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let by_id: HashMap<i64, RepNodeOut> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let children = book_children(&nodes);
    let depth = clamp_plies(plies.or(Some(20)));
    let games = recent_games(&conn, clamp_games(games))?;

    // (node_id, side, san) → (Anzahl, Punkte, Pfad, mein Zug?)
    type GapKey = (i64, String, String);
    type GapAggregate = (i64, f64, Vec<String>, bool);
    let mut found: HashMap<GapKey, GapAggregate> = HashMap::new();
    for (color, moves, result) in &games {
        let Some(d) = walk_book(&children, color, moves, depth as usize) else {
            continue;
        };
        // Ohne bekannte Fortsetzung ist das schlicht das Ende der Linie und
        // keine Lücke · sonst stünde jede Blattstellung in der Liste.
        if !d.book_has_moves {
            continue;
        }
        let entry = found
            .entry((d.node_id, color.clone(), d.san.clone()))
            .or_insert((0, 0.0, d.path.clone(), is_my_move(color, d.ply)));
        entry.0 += 1;
        entry.1 += score_of(result);
    }

    let mut out: Vec<RepGap> = found
        .into_iter()
        .map(
            |((node_id, side, san), (count, score, path, mine))| RepGap {
                book_sans: children
                    .get(&(side.clone(), node_id))
                    .map(|k| k.iter().map(|(s, _)| s.clone()).collect())
                    .unwrap_or_default(),
                line: line_name(&by_id, node_id),
                node_id,
                side,
                path_sans: path,
                san,
                count,
                mine,
                score_pct: pct(score, count as f64),
            },
        )
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.san.cmp(&b.san)));
    out.truncate(limit.unwrap_or(12).clamp(1, 100) as usize);
    Ok(out)
}

#[derive(Serialize)]
pub struct Deviation {
    pub san: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct NodeGameStats {
    pub games: i64,
    pub score_pct: f64,
    /// Buchzüge ab dieser Stellung.
    pub book_sans: Vec<String>,
    /// Gespielte Züge, die nicht im Buch stehen.
    pub deviations: Vec<Deviation>,
    pub followed_book: i64,
}

/// Statistik zu einem Repertoire-Knoten: wie oft wurde die Stellung erreicht,
/// wie lief es, und wo wurde vom Buch abgewichen.
#[tauri::command]
pub fn rep_node_games(db: State<db::Db>, node_id: i64) -> Result<NodeGameStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (fen_key, side): (String, String) = conn
        .query_row(
            "SELECT fen_key, side FROM rep_nodes WHERE id = ?1",
            params![node_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Knoten nicht gefunden".to_string())?;

    let book_sans: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT san FROM rep_nodes WHERE parent_id = ?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![node_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut stmt = conn
        .prepare(
            "SELECT p.game_id, MIN(p.ply), g.result, g.moves
             FROM positions p JOIN games g ON g.id = p.game_id
             WHERE p.fen_key = ?1 AND g.color = ?2 AND g.analysis_excluded = 0
             GROUP BY p.game_id",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, u32, String, String)> = stmt
        .query_map(params![fen_key, side], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut score = 0.0;
    let mut followed = 0i64;
    let mut dev: Vec<Deviation> = Vec::new();
    for (_id, ply, result, moves) in &rows {
        score += match result.as_str() {
            "win" => 1.0,
            "draw" => 0.5,
            _ => 0.0,
        };
        if let Some(next) = moves.split_whitespace().nth(*ply as usize) {
            if book_sans.iter().any(|s| s == next) {
                followed += 1;
            } else if !book_sans.is_empty() {
                match dev.iter_mut().find(|d| d.san == next) {
                    Some(d) => d.count += 1,
                    None => dev.push(Deviation {
                        san: next.to_string(),
                        count: 1,
                    }),
                }
            }
        }
    }
    dev.sort_by_key(|deviation| std::cmp::Reverse(deviation.count));
    dev.truncate(4);

    let games = rows.len() as i64;
    Ok(NodeGameStats {
        games,
        score_pct: if games > 0 {
            (score / games as f64 * 1000.0).round() / 10.0
        } else {
            0.0
        },
        book_sans,
        deviations: dev,
        followed_book: followed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fsrs_new_card_good() {
        let (s, d, interval) = fsrs_review(0.0, 0.0, 0, 0.0, 3);
        assert!((s - W[2]).abs() < 1e-9, "S0(good) = w2");
        assert!(d > 1.0 && d < 10.0);
        assert!(interval >= 1);
    }

    #[test]
    fn fsrs_success_grows_interval() {
        let (s1, d1, i1) = fsrs_review(0.0, 0.0, 0, 0.0, 3);
        let (s2, _, i2) = fsrs_review(s1, d1, 1, i1 as f64, 3);
        assert!(s2 > s1, "Stabilität wächst: {s1} → {s2}");
        assert!(i2 >= i1, "Intervall wächst: {i1} → {i2}");
    }

    #[test]
    fn fsrs_lapse_shrinks_stability() {
        let (s, d, _) = fsrs_review(20.0, 5.0, 5, 20.0, 1);
        assert!(s < 20.0, "Lapse reduziert Stabilität: {s}");
        let _ = d;
    }

    #[test]
    fn my_move_parity() {
        assert!(is_my_move("white", 1));
        assert!(!is_my_move("white", 2));
        assert!(is_my_move("black", 2));
        assert!(!is_my_move("black", 1));
    }

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn
    }

    fn line(sans: &[&str]) -> Vec<String> {
        sans.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn insert_line_reuses_existing_nodes() {
        let conn = memory_db();
        let (_, first) =
            insert_line(&conn, "white", "Italienisch", &line(&["e4", "e5", "Nf3"])).unwrap();
        assert_eq!(first, 3);
        // Dieselbe Linie noch einmal legt nichts Neues an, der Ast danach schon.
        let (_, again) =
            insert_line(&conn, "white", "", &line(&["e4", "e5", "Nf3", "Nc6"])).unwrap();
        assert_eq!(again, 1);
    }

    /// Die selbst gezogene Reihenfolge steht an den Endpunkten der Linien ·
    /// Linien, die danach dazukommen, behalten die 0 und hängen sich hinten an.
    #[test]
    fn reorder_writes_places_for_one_side_only() {
        let mut conn = memory_db();
        let (italian, _) =
            insert_line(&conn, "white", "Italienisch", &line(&["e4", "e5"])).unwrap();
        let (sicilian, _) =
            insert_line(&conn, "white", "Sizilianisch", &line(&["e4", "c5"])).unwrap();
        let (caro, _) = insert_line(&conn, "black", "Caro-Kann", &line(&["e4", "c6"])).unwrap();

        reorder_nodes(&mut conn, "white", &[sicilian, italian], 4_711).unwrap();

        fn places(conn: &Connection, id: i64) -> (i64, i64) {
            conn.query_row(
                "SELECT sort_order, sort_ts FROM rep_nodes WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        }
        assert_eq!(places(&conn, sicilian), (1, 4_711));
        assert_eq!(places(&conn, italian), (2, 4_711));
        // Die andere Seite bleibt unberührt, auch wenn eine fremde Id käme.
        assert_eq!(places(&conn, caro), (0, 0));
        reorder_nodes(&mut conn, "white", &[caro], 4_712).unwrap();
        assert_eq!(places(&conn, caro), (0, 0));
    }

    /// Der Vertrag, auf dem das Bearbeiten einer Variante aufsitzt.
    ///
    /// Wird eine Zeile verlängert, wandert der Name auf den neuen Endpunkt ·
    /// der alte behält ihn aber. Die Oberfläche muss ihn deshalb selbst
    /// abnehmen (`repSetName(alt, "")` in pages/Repertoire.tsx), sonst stünde
    /// die Variante zweimal gleichnamig im Verzeichnis. Ändert sich nur der
    /// Name, bleibt es bei einem Knoten und einem Namen.
    #[test]
    fn extending_a_line_names_the_new_leaf_and_leaves_the_old_name() {
        let conn = memory_db();
        let (kurz, _) = insert_line(&conn, "white", "Italienisch", &line(&["e4", "e5"])).unwrap();
        let (lang, _) =
            insert_line(&conn, "white", "Italienisch", &line(&["e4", "e5", "Nf3"])).unwrap();
        assert_ne!(kurz, lang, "der Endpunkt ist ein anderer");

        fn name_of(conn: &Connection, id: i64) -> String {
            conn.query_row(
                "SELECT name FROM rep_nodes WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap()
        }
        assert_eq!(name_of(&conn, lang), "Italienisch");
        assert_eq!(
            name_of(&conn, kurz),
            "Italienisch",
            "der alte Name bleibt stehen"
        );

        // Nur umbenennen: derselbe Endpunkt, kein zweiter Knoten.
        let (wieder, neu) = insert_line(
            &conn,
            "white",
            "Mein Italiener",
            &line(&["e4", "e5", "Nf3"]),
        )
        .unwrap();
        assert_eq!(wieder, lang);
        assert_eq!(neu, 0);
        assert_eq!(name_of(&conn, lang), "Mein Italiener");
    }

    #[test]
    fn nodes_carry_note_and_position_key() {
        let conn = memory_db();
        let (leaf, _) = insert_line(&conn, "white", "", &line(&["e4", "e5"])).unwrap();
        conn.execute(
            "UPDATE rep_nodes SET note = 'Plan: d4' WHERE id = ?1",
            params![leaf],
        )
        .unwrap();
        let nodes = load_nodes(&conn).unwrap();
        let node = nodes.iter().find(|n| n.id == leaf).unwrap();
        assert_eq!(node.note, "Plan: d4");
        assert!(!node.fen_key.is_empty());
    }

    /// Transpositionen: 1.e4 e5 2.Nf3 und 1.Nf3 e5 2.e4 sind dieselbe Stellung.
    #[test]
    fn same_position_through_another_move_order_shares_the_key() {
        let conn = memory_db();
        let (a, _) = insert_line(&conn, "white", "", &line(&["e4", "e5", "Nf3"])).unwrap();
        let (b, _) = insert_line(&conn, "white", "", &line(&["Nf3", "e5", "e4"])).unwrap();
        let nodes = load_nodes(&conn).unwrap();
        let key_a = &nodes.iter().find(|n| n.id == a).unwrap().fen_key;
        let key_b = &nodes.iter().find(|n| n.id == b).unwrap().fen_key;
        assert_eq!(key_a, key_b);
        assert_ne!(a, b, "zwei Knoten mit eigenem Lernstand");
    }

    fn book(lines: &[(&str, &[&str])]) -> BookChildren {
        let conn = memory_db();
        for (side, sans) in lines {
            insert_line(&conn, side, "", &line(sans)).unwrap();
        }
        book_children(&load_nodes(&conn).unwrap())
    }

    #[test]
    fn walk_book_reports_the_first_move_outside_the_book() {
        let children = book(&[("white", &["e4", "e5", "Nf3", "Nc6"])]);
        let departure = walk_book(&children, "white", "e4 e5 Nf3 d6 Bc4", 8).unwrap();
        assert_eq!(departure.san, "d6");
        assert_eq!(departure.ply, 4);
        assert_eq!(departure.path, line(&["e4", "e5", "Nf3"]));
        assert!(departure.book_has_moves, "Nc6 steht hier im Buch");
    }

    #[test]
    fn walk_book_stays_silent_while_the_game_follows_the_book() {
        let children = book(&[("white", &["e4", "e5", "Nf3", "Nc6"])]);
        assert!(walk_book(&children, "white", "e4 e5 Nf3 Nc6", 8).is_none());
    }

    #[test]
    fn walk_book_stops_at_the_requested_depth() {
        let children = book(&[("white", &["e4", "e5"])]);
        // Der Ausstieg läge auf Halbzug 3, geprüft werden aber nur zwei.
        assert!(walk_book(&children, "white", "e4 e5 Nf3", 2).is_none());
    }

    #[test]
    fn walk_book_marks_the_end_of_a_line_as_such() {
        let children = book(&[("white", &["e4", "e5"])]);
        let departure = walk_book(&children, "white", "e4 e5 Nf3", 8).unwrap();
        assert!(
            !departure.book_has_moves,
            "hinter e5 kennt das Buch nichts · das ist keine Lücke, sondern das Ende"
        );
    }

    #[test]
    fn export_writes_variations_that_the_parser_reads_back() {
        let conn = memory_db();
        insert_line(&conn, "white", "", &line(&["e4", "e5", "Nf3"])).unwrap();
        insert_line(&conn, "white", "", &line(&["e4", "c5", "Nf3"])).unwrap();
        let nodes = load_nodes(&conn).unwrap();
        let mut children: HashMap<i64, Vec<&RepNodeOut>> = HashMap::new();
        for n in nodes.iter().filter(|n| n.side == "white") {
            children.entry(n.parent_id).or_default().push(n);
        }
        fn build(
            children: &HashMap<i64, Vec<&RepNodeOut>>,
            parent: i64,
        ) -> Vec<rep_pgn::ExportNode> {
            children
                .get(&parent)
                .map(|kids| {
                    kids.iter()
                        .map(|n| rep_pgn::ExportNode {
                            san: n.san.clone(),
                            note: n.note.clone(),
                            children: build(children, n.id),
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        let pgn = rep_pgn::export_pgn("white", &build(&children, 0));
        let lines = rep_pgn::parse_lines(&pgn);
        assert!(lines.contains(&line(&["e4", "e5", "Nf3"])));
        assert!(lines.contains(&line(&["e4", "c5", "Nf3"])));
    }
}
