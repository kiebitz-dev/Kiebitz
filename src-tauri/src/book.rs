//! Buchzüge aus echten Daten · wie weit eine Partie in der Theorie lief.
//!
//! Die Zugliste der Analyse schrieb „Buchzug" bisher nach einer Faustregel:
//! die ersten sechzehn Halbzüge, sofern sie kaum etwas kosteten. Das traf
//! häufig, lag aber ebenso häufig daneben — ein ruhiger Zug im siebten Zug
//! einer abseitigen Eröffnung ist kein Buch, nur weil er nichts verdirbt.
//!
//! Hier wird stattdessen nachgesehen. Befragt werden nur Quellen, die schon auf
//! der Platte liegen, und zwar in dieser Reihenfolge:
//!
//! 1. die eigene Referenzdatenbank (`refdb.rs`), wenn eine eingelesen ist;
//! 2. der Zwischenspeicher des Lichess-Explorers für Meisterpartien
//!    (`explorer_cache`, `source_key = 'masters'`). Er füllt sich beim
//!    Durchblättern mit geöffnetem Buch. Das Alter spielt hier keine Rolle:
//!    Theorie von vor drei Monaten ist immer noch Theorie.
//!
//! Ins Netz geht diese Abfrage nie. Eine Partie zu öffnen soll nicht ein
//! Dutzend Anfragen an Lichess auslösen, und ohne Token beantwortet Lichess sie
//! ohnehin nicht. ChessDB fragt sie ebenfalls nicht: Deren Datenbank kennt, was
//! eine Engine von einem Zug hält, nicht, wie oft Menschen ihn spielen — und
//! das zweite ist, was „Buch" heißt.
//!
//! Die Antwort unterscheidet sorgfältig zwischen „hat das Buch verlassen" und
//! „dazu weiß keine Quelle etwas". Nur das erste ist eine Auskunft über die
//! Partie; beim zweiten fällt die Oberfläche für die restlichen Halbzüge auf
//! die alte Faustregel zurück.

use crate::{chess, db, refdb};
use rusqlite::{params, Connection};
use serde::Serialize;

/// So oft muss ein Zug in einer Stellung gespielt worden sein, damit er als
/// Buch gilt. Einmal ist ein Einfall, fünfmal eine Linie.
const MIN_GAMES: i64 = 5;

/// Und diesen Anteil an allen Partien aus der Stellung muss er haben, in
/// Promille. In einer Millionensammlung hat auch ein Unsinnszug seine fünf
/// Partien — erst der Anteil trennt die Linie vom Ausrutscher.
///
/// Ein Promille und nicht mehr: Gegengeprüft an 300 eigenen Partien gegen die
/// eingelesene Referenzdatenbank (rund sechs Millionen Partien ab der
/// Grundstellung) fielen bei zwei Prozent Züge mit 14 000 und 43 000 Partien
/// aus dem Buch, weil die Stellung davor Millionen hatte. Bei einem Promille
/// bleiben sie drin, und was fällt, sind Züge wie 2.Qf3 (301 von 1,58 Mio.).
const MIN_SHARE_PROMILLE: i64 = 1;

/// Was eine Quelle über einen Zug sagt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Auskunft {
    /// Der Zug ist Theorie.
    Buch,
    /// Die Stellung ist bekannt, der Zug darin nicht (oder zu selten).
    Verlassen,
    /// Die Quelle kennt die Stellung nicht.
    Unbekannt,
}

/// Wie weit die Partie im Buch lief.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct BookLine {
    /// So viele Halbzüge ab dem Start sind als Buch belegt.
    pub plies: u32,
    /// `true`, wenn die Partie danach nachweislich aus dem Buch ging (oder zu
    /// Ende war); `false`, wenn die Quellen ab dort schweigen.
    pub decided: bool,
    /// Welche Quelle zuletzt geantwortet hat · `own` oder `masters`.
    pub source: String,
}

/// Urteil über einen Zug anhand der Zeilen einer Stellung (SAN, Partien).
pub(crate) fn beurteile(
    pos: &chess::Position,
    gespielt: &owlchess::Move,
    zeilen: &[(String, i64)],
) -> Auskunft {
    let gesamt: i64 = zeilen.iter().map(|(_, n)| *n).sum();
    if gesamt <= 0 {
        return Auskunft::Unbekannt;
    }
    // Verglichen wird der Zug, nicht seine Schreibweise · „O-O" und „0-0",
    // „Nf3" und „Nf3+" sind dasselbe.
    let partien: i64 = zeilen
        .iter()
        .filter(|(san, _)| {
            chess::parse_san(pos, san)
                .map(|mv| mv == *gespielt)
                .unwrap_or(false)
        })
        .map(|(_, n)| *n)
        .sum();
    if partien >= MIN_GAMES && partien * 1000 >= gesamt * MIN_SHARE_PROMILLE {
        Auskunft::Buch
    } else {
        Auskunft::Verlassen
    }
}

/// Die Buchtiefe einer Zugfolge über eine beliebige Quelle.
///
/// `quelle` bekommt den Stellungsschlüssel und liefert, wenn sie die Stellung
/// kennt, ihren Namen und die Zeilen. `None` als Ergebnis heißt: Schon zur
/// Grundstellung weiß niemand etwas — dann soll die Oberfläche gar nichts
/// von hier übernehmen.
pub(crate) fn buchtiefe(
    moves: &str,
    mut quelle: impl FnMut(&str) -> Option<(&'static str, Vec<(String, i64)>)>,
) -> Option<BookLine> {
    let mut pos = chess::Position::initial();
    let mut plies = 0u32;
    let mut letzte = "";
    for san in moves.split_whitespace() {
        let Ok(mv) = chess::parse_san(&pos, san) else {
            break;
        };
        let key = chess::fen_key(&pos);
        let auskunft = match quelle(&key) {
            Some((name, zeilen)) => {
                letzte = name;
                beurteile(&pos, &mv, &zeilen)
            }
            None => Auskunft::Unbekannt,
        };
        match auskunft {
            Auskunft::Buch => plies += 1,
            Auskunft::Verlassen => {
                return Some(BookLine {
                    plies,
                    decided: true,
                    source: letzte.into(),
                });
            }
            Auskunft::Unbekannt => {
                return if plies == 0 {
                    None
                } else {
                    Some(BookLine {
                        plies,
                        decided: false,
                        source: letzte.into(),
                    })
                };
            }
        }
        pos = match pos.make_move(mv) {
            Ok(next) => next,
            Err(_) => break,
        };
    }
    // Die ganze Partie war Buch · kurz, aber möglich.
    if plies == 0 {
        None
    } else {
        Some(BookLine {
            plies,
            decided: true,
            source: letzte.into(),
        })
    }
}

/// Zeilen der Referenzdatenbank zu einer Stellung.
fn aus_refdb(conn: &Connection, key: &str) -> Vec<(String, i64)> {
    let Ok(mut stmt) =
        conn.prepare_cached("SELECT san, white + draws + black FROM ref_book WHERE fen_key = ?1")
    else {
        return Vec::new();
    };
    stmt.query_map(params![key], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

/// Zeilen aus dem Explorer-Zwischenspeicher (Meisterpartien) zu einer Stellung.
fn aus_explorer(conn: &Connection, key: &str) -> Vec<(String, i64)> {
    let json: Option<String> = conn
        .query_row(
            "SELECT json FROM explorer_cache WHERE source_key = 'masters' AND fen_key = ?1",
            params![key],
            |r| r.get(0),
        )
        .ok();
    let Some(json) = json else {
        return Vec::new();
    };
    crate::explorer::parse_response("masters", &json)
        .moves
        .into_iter()
        .map(|m| {
            let partien = m.white + m.draws + m.black;
            (m.san, partien)
        })
        .collect()
}

/// Wie weit eine Partie im Buch lief · `None`, wenn keine Quelle etwas weiß.
#[tauri::command(async)]
pub fn book_line(
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    moves: String,
) -> Result<Option<BookLine>, String> {
    let ref_conn = refdb::ref_path(&app)
        .ok()
        .filter(|path| path.exists())
        .and_then(|path| refdb::open_readonly(&path).ok());
    let main = db.0.lock().map_err(|e| e.to_string())?;
    Ok(buchtiefe(&moves, |key| {
        if let Some(conn) = &ref_conn {
            let zeilen = aus_refdb(conn, key);
            if !zeilen.is_empty() {
                return Some(("own", zeilen));
            }
        }
        let zeilen = aus_explorer(&main, key);
        (!zeilen.is_empty()).then_some(("masters", zeilen))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Ein Buch aus Zugfolgen · jede Folge zählt `n` Partien für jeden ihrer Züge.
    fn buch(linien: &[(&str, i64)]) -> HashMap<String, Vec<(String, i64)>> {
        let mut out: HashMap<String, HashMap<String, i64>> = HashMap::new();
        for (linie, n) in linien {
            let mut pos = chess::Position::initial();
            for san in linie.split_whitespace() {
                let mv = chess::parse_san(&pos, san).unwrap();
                *out.entry(chess::fen_key(&pos))
                    .or_default()
                    .entry(san.to_string())
                    .or_default() += n;
                pos = pos.make_move(mv).unwrap();
            }
        }
        out.into_iter()
            .map(|(k, v)| (k, v.into_iter().collect()))
            .collect()
    }

    fn tiefe(moves: &str, b: &HashMap<String, Vec<(String, i64)>>) -> Option<BookLine> {
        buchtiefe(moves, |key| b.get(key).map(|z| ("own", z.clone())))
    }

    #[test]
    fn follows_the_game_while_the_book_knows_its_moves() {
        let b = buch(&[("e4 e5 Nf3 Nc6 Bb5 a6", 100), ("e4 c5 Nf3 d6", 80)]);
        let line = tiefe("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6", &b).unwrap();
        // Die Quelle kennt die Stellung nach 6...a6 nicht mehr · das ist kein
        // Verlassen des Buchs, sondern das Ende dessen, was sie weiß.
        assert_eq!(
            line,
            BookLine {
                plies: 6,
                decided: false,
                source: "own".into()
            }
        );
    }

    #[test]
    fn a_known_position_with_an_unknown_move_ends_the_book() {
        let b = buch(&[("e4 e5 Nf3 Nc6 Bb5", 100)]);
        let line = tiefe("e4 e5 Nf3 Nc6 Bc4", &b).unwrap();
        assert_eq!(line.plies, 4);
        assert!(line.decided);
    }

    /// Gegenprobe an echten Daten · nur von Hand, mit
    /// `KIEBITZ_REFDB=<reference.sqlite> KIEBITZ_GAMES=<games.json>
    /// KIEBITZ_OUT=<out.json> cargo test book_gegenprobe -- --ignored`.
    /// Die Datenbank wird unveränderlich geöffnet (`immutable=1`).
    #[test]
    #[ignore]
    fn book_gegenprobe() {
        let refdb = std::env::var("KIEBITZ_REFDB").unwrap();
        let games = std::env::var("KIEBITZ_GAMES").unwrap();
        let out = std::env::var("KIEBITZ_OUT").unwrap();
        let pfad = refdb.replace('\\', "/");
        // Ein UNC-Pfad („//rechner/freigabe/…") braucht eine leere Autorität
        // davor, ein Laufwerkspfad einen dritten Schrägstrich.
        let uri = if pfad.starts_with("//") {
            format!("file://{pfad}?immutable=1")
        } else {
            format!("file:///{pfad}?immutable=1")
        };
        let conn = Connection::open_with_flags(
            uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .unwrap();
        let text = std::fs::read_to_string(games).unwrap();
        let list: Vec<serde_json::Value> =
            serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
        let mut result = serde_json::Map::new();
        for game in &list {
            let id = game["id"].as_i64().unwrap();
            let moves = game["moves"].as_str().unwrap_or("");
            let line = buchtiefe(moves, |key| {
                let zeilen = aus_refdb(&conn, key);
                (!zeilen.is_empty()).then_some(("own", zeilen))
            });
            // Wo und mit welchem Anteil die Partie das Buch verließ · zum
            // Nachprüfen der Schwellen.
            if let Some(l) = &line {
                if l.decided && result.len() < 25 {
                    let sans: Vec<&str> = moves.split_whitespace().collect();
                    let mut pos = chess::Position::initial();
                    for san in sans.iter().take(l.plies as usize) {
                        let mv = chess::parse_san(&pos, san).unwrap();
                        pos = pos.make_move(mv).unwrap();
                    }
                    if let Some(san) = sans.get(l.plies as usize) {
                        let zeilen = aus_refdb(&conn, &chess::fen_key(&pos));
                        let gesamt: i64 = zeilen.iter().map(|(_, n)| n).sum();
                        let mv = chess::parse_san(&pos, san).unwrap();
                        let partien: i64 = zeilen
                            .iter()
                            .filter(|(s, _)| {
                                chess::parse_san(&pos, s).map(|m| m == mv).unwrap_or(false)
                            })
                            .map(|(_, n)| n)
                            .sum();
                        println!(
                            "{id}: verlässt bei Halbzug {} mit {san} · {partien} von {gesamt}",
                            l.plies + 1
                        );
                    }
                }
            }
            result.insert(id.to_string(), serde_json::to_value(line).unwrap());
        }
        std::fs::write(out, serde_json::Value::Object(result).to_string()).unwrap();
    }

    #[test]
    fn a_rare_move_is_not_theory() {
        // Qh5 kommt vor, aber nur in 3 Partien · keine fünf.
        let b = buch(&[("e4 e5 Nf3", 1000), ("e4 e5 Qh5", 3)]);
        let line = tiefe("e4 e5 Qh5 Nc6", &b).unwrap();
        assert_eq!(line.plies, 2);
        assert!(line.decided);
    }

    #[test]
    fn compares_moves_not_spellings() {
        // Das Buch schreibt den Schachzug mit Zeichen, die Partie ohne ·
        // derselbe Zug, also Buch.
        let mut pos = chess::Position::initial();
        for san in ["e4", "f6"] {
            let mv = chess::parse_san(&pos, san).unwrap();
            pos = pos.make_move(mv).unwrap();
        }
        let gespielt = chess::parse_san(&pos, "Qh5").unwrap();
        assert_eq!(
            beurteile(&pos, &gespielt, &[("Qh5+".into(), 50)]),
            Auskunft::Buch
        );
        assert_eq!(
            beurteile(&pos, &gespielt, &[("Qe2".into(), 50)]),
            Auskunft::Verlassen
        );
    }

    #[test]
    fn without_any_source_there_is_no_answer() {
        let leer = HashMap::new();
        assert_eq!(tiefe("e4 e5", &leer), None);
    }
}
