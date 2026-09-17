//! Informator-Zeichen · was ein Schachbuch ohne Worte über eine Stellung sagt.
//!
//! Der Schach-Informator kommt ohne Sprache aus: ± heißt „Weiß steht deutlich
//! besser", △ „mit der Idee", ▽ „gerichtet gegen". Das Blatt druckt diese
//! Zeichen auf sein Diagramm und darunter den Schlüssel, wie ihn jeder Band
//! vorn trägt.
//!
//! Entstehen tun sie hier, im Analyselauf, und nicht beim Ansehen: Was ein
//! Zeichen behauptet, muss die Analyse belegen können · die Bewertung, die
//! Empfehlung der Engine, das erkannte Motiv, die Uhr. Die Oberfläche liest
//! nur noch, was hier abgelegt wurde, und setzt es.
//!
//! **Ein Zeichen gehört zu einer Stellung**, und zwar zu der *vor* dem
//! Halbzug seiner Zeile in `move_evals`. Das ist die Stellung, die das Blatt
//! als Diagramm druckt (vor dem Zug, um den es geht) und die das Analysebrett
//! zeigt, bevor der nächste Zug fällt. Aus zwei Zeilen wird sie beschrieben:
//! aus der eigenen (was hier gespielt wurde und was besser war) und aus der
//! davor (welcher Zug hierher führte und was er zuließ).
//!
//! Wie bei den Motiven entstehen keine Sätze, sondern Kennungen und Felder ·
//! Kiebitz spricht sieben Sprachen, und der Schlüssel unter dem Diagramm wird
//! in der Oberfläche gesetzt. SAN steht englisch.
//!
//! Behauptet wird nur, was geprüft ist. Keine Zeile trägt „Initiative" oder
//! „Kompensation": Dafür gibt die Analyse nichts her, was man vorzeigen könnte.

use crate::chess;
use owlchess::{Board, Color, Coord, Move, Piece};
use serde_json::{json, Value};

/// Regelstand der Zeichen · steht in `move_evals.signs_version`.
///
/// Ändert sich eine Regel, zählt die Zahl hoch, und `backfill_signs` leitet
/// die Zeichen des ganzen Bestandes neu ab — ohne Stockfish, denn alles, was
/// hier gebraucht wird, liegt schon in der Datenbank.
pub const SIGNS_VERSION: i64 = 1;

/// Was von einer gespeicherten Analysezeile gebraucht wird.
pub struct RowFacts<'a> {
    /// Bewertung *nach* dem Zug, aus Weiß-Sicht.
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    /// Empfehlung der Engine in der Stellung *vor* dem Zug, UCI.
    pub best_uci: &'a str,
    /// `""`, `inaccuracy`, `mistake` oder `blunder`.
    pub judgment: &'a str,
    /// Das erkannte Motiv und seine Felder als JSON.
    pub motif: &'a str,
    pub motif_detail: &'a str,
}

/// Die Bewertung einer Stellung als Informator-Zeichen.
///
/// Die Stufen folgen dem Gebrauch in der Literatur, in Bauerneinheiten:
/// bis 0,3 ausgeglichen, bis 0,8 „etwas besser", bis 3 „deutlich besser",
/// darüber entscheidend. Ein Matt ist immer entscheidend.
pub fn eval_sign(eval_cp: Option<i32>, mate_in: Option<i32>) -> Option<&'static str> {
    if let Some(mate) = mate_in {
        return Some(if mate > 0 { "+-" } else { "-+" });
    }
    let cp = eval_cp?;
    Some(match cp {
        c if c > 300 => "+-",
        c if c > 80 => "+/-",
        c if c > 30 => "+=",
        c if c >= -30 => "=",
        c if c >= -80 => "=+",
        c if c >= -300 => "-/+",
        _ => "-+",
    })
}

/// Das Zeichen für ein Urteil über einen Zug.
fn nag_of(judgment: &str) -> Option<&'static str> {
    match judgment {
        "inaccuracy" => Some("?!"),
        "mistake" => Some("?"),
        "blunder" => Some("??"),
        _ => None,
    }
}

fn square_of(coord: Coord) -> String {
    coord.to_string()
}

fn is_light(coord: Coord) -> bool {
    // Rang 8 hat den Index 0 · a8 ist ein helles Feld.
    (coord.file().index() + coord.rank().index()).is_multiple_of(2)
}

fn color_letter(color: Color) -> &'static str {
    if color == Color::White {
        "w"
    } else {
        "b"
    }
}

/// Die Läufer einer Farbe, getrennt nach Feldfarbe (hell, dunkel).
fn bishops(board: &Board, color: Color) -> (u32, u32) {
    let mut out = (0, 0);
    for coord in Coord::iter() {
        let cell = board.get(coord);
        if cell.color() == Some(color) && cell.piece() == Some(Piece::Bishop) {
            if is_light(coord) {
                out.0 += 1;
            } else {
                out.1 += 1;
            }
        }
    }
    out
}

/// Freibauern und Doppelbauern beider Seiten.
///
/// Ein Freibauer hat vor sich, auf seiner und den beiden Nachbarlinien, keinen
/// gegnerischen Bauern mehr. Doppelbauern sind zwei oder mehr eigene Bauern auf
/// einer Linie · markiert werden alle.
fn pawn_structure(board: &Board) -> (Vec<String>, Vec<String>) {
    let mut passed = Vec::new();
    let mut doubled = Vec::new();
    for color in [Color::White, Color::Black] {
        let enemy = color.inv();
        let mut per_file: [Vec<Coord>; 8] = Default::default();
        for coord in Coord::iter() {
            let cell = board.get(coord);
            if cell.color() == Some(color) && cell.piece() == Some(Piece::Pawn) {
                per_file[coord.file().index()].push(coord);
            }
        }
        for (file, pawns) in per_file.iter().enumerate() {
            if pawns.len() > 1 {
                doubled.extend(pawns.iter().map(|c| square_of(*c)));
            }
            for pawn in pawns {
                // Rangindex zählt von oben · Weiß zieht zu kleineren Indizes.
                let rank = pawn.rank().index();
                let blocked = Coord::iter().any(|other| {
                    let cell = board.get(other);
                    if cell.color() != Some(enemy) || cell.piece() != Some(Piece::Pawn) {
                        return false;
                    }
                    let near = (other.file().index() as isize - file as isize).abs() <= 1;
                    let ahead = if color == Color::White {
                        other.rank().index() < rank
                    } else {
                        other.rank().index() > rank
                    };
                    near && ahead
                });
                if !blocked {
                    passed.push(square_of(*pawn));
                }
            }
        }
    }
    (passed, doubled)
}

/// Das Zielfeld eines UCI-Zuges · leer, wenn er nicht zur Stellung passt.
fn uci_target(board: &Board, uci: &str) -> Option<(String, String)> {
    let mv = Move::from_uci_legal(uci, board).ok()?;
    let san = chess::canonical_san(board, mv).ok()?;
    Some((square_of(mv.dst()), san))
}

/// Die Grundzeit in Hundertstelsekunden aus einer PGN-Zeitkontrolle („600+5").
pub fn base_centis(time_control: &str) -> Option<u32> {
    let base = time_control.split('+').next()?.trim();
    let seconds: u32 = base.parse().ok()?;
    (seconds > 0).then_some(seconds * 100)
}

/// Die Zeichen einer Stellung.
///
/// `fen` ist die Stellung vor dem Halbzug; `row` ist dessen Zeile, `previous`
/// die des Halbzugs davor und `last_target` das Zielfeld des Zuges, der
/// hierher führte (die Stellung allein sagt es nicht eindeutig).
/// `clock_centis` ist die Restzeit der Seite am Zug, `base` ihre Grundzeit,
/// beides wenn bekannt.
pub fn signs(
    fen: &str,
    phase: &str,
    row: &RowFacts,
    previous: Option<&RowFacts>,
    last_target: Option<&str>,
    clock_centis: Option<u32>,
    base: Option<u32>,
) -> Vec<Value> {
    let Ok(board) = Board::from_fen(fen) else {
        return Vec::new();
    };
    let mover = board.side();
    let mut out = Vec::new();

    // Die Bewertung der Stellung · das ist die Zahl nach dem Zug davor. Vor dem
    // ersten Zug gibt es keine, und eine erfundene Grundstellung-Bewertung
    // stünde hier nur als Behauptung.
    if let Some(prev) = previous {
        if let Some(sign) = eval_sign(prev.eval_cp, prev.mate_in) {
            out.push(json!({ "kind": "eval", "value": sign }));
        }
    }

    // Der Zug, der hierher führte, trägt sein Urteil auf seinem Zielfeld · und
    // was er zuließ, steht gleich daneben: Die Empfehlung *dieser* Stellung ist
    // der Gegenzug, der ihn bestraft.
    if let Some(prev) = previous {
        if let Some(nag) = nag_of(prev.judgment) {
            if let Some(last) = last_target {
                out.push(json!({ "kind": "nag", "value": nag, "squares": [last] }));
            }
            if let Some(traits) = chess::uci_traits(fen, row.best_uci) {
                if traits.forcing() {
                    if let Some((square, san)) = uci_target(&board, row.best_uci) {
                        out.push(json!({ "kind": "attack", "squares": [square], "san": san }));
                    }
                }
            }
            let detail: Value = serde_json::from_str(prev.motif_detail).unwrap_or(Value::Null);
            let text = |key: &str| detail.get(key).and_then(Value::as_str).map(str::to_string);
            let against: Vec<String> = match prev.motif {
                "fork" => detail
                    .get("targets")
                    .and_then(Value::as_array)
                    .map(|targets| {
                        targets
                            .iter()
                            .filter_map(|t| t.get("square").and_then(Value::as_str))
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
                "pin" | "skewer" => [text("square"), text("behind")]
                    .into_iter()
                    .flatten()
                    .collect(),
                "hanging_piece" | "discovered_attack" | "back_rank" => {
                    text("square").into_iter().collect()
                }
                _ => Vec::new(),
            };
            if !against.is_empty() {
                out.push(json!({ "kind": "against", "squares": against }));
            }
            // Die Linie einer Fesselung oder eines Spießes · Linie oder
            // Diagonale, je nachdem, worauf die drei Felder stehen.
            if matches!(prev.motif, "pin" | "skewer") {
                if let (Some(from), Some(front), Some(behind)) =
                    (text("from"), text("square"), text("behind"))
                {
                    let files_equal = from.as_bytes().first() == behind.as_bytes().first();
                    let ranks_equal = from.as_bytes().get(1) == behind.as_bytes().get(1);
                    let kind = if files_equal || ranks_equal {
                        "file"
                    } else {
                        "diagonal"
                    };
                    out.push(json!({ "kind": kind, "squares": [from, front, behind] }));
                }
            }
        }
    }

    // Die Idee · nur, wo der gespielte Zug sie verfehlt hat. An jedem ruhigen
    // Zug ein Dreieck wäre keine Anmerkung mehr, sondern die Engine im Buch.
    if nag_of(row.judgment).is_some() {
        if let Some((square, san)) = uci_target(&board, row.best_uci) {
            out.push(json!({ "kind": "idea", "squares": [square], "san": san }));
        }
    }

    // Läufer · Paar, ungleich- oder gleichfarbig.
    let (white_light, white_dark) = bishops(&board, Color::White);
    let (black_light, black_dark) = bishops(&board, Color::Black);
    let white_pair = white_light > 0 && white_dark > 0;
    let black_pair = black_light > 0 && black_dark > 0;
    if white_pair != black_pair {
        let side = if white_pair {
            Color::White
        } else {
            Color::Black
        };
        out.push(json!({ "kind": "bishop_pair", "side": color_letter(side) }));
    } else if white_light + white_dark == 1 && black_light + black_dark == 1 {
        let same = (white_light == 1) == (black_light == 1);
        out.push(json!({ "kind": if same { "same_bishops" } else { "opposite_bishops" } }));
    }

    let (passed, doubled) = pawn_structure(&board);
    if !passed.is_empty() {
        out.push(json!({ "kind": "passed", "squares": passed }));
    }
    if !doubled.is_empty() {
        out.push(json!({ "kind": "doubled", "squares": doubled }));
    }

    if phase == "endgame" {
        out.push(json!({ "kind": "ending" }));
    }

    // Zeitnot · weniger als ein Zehntel der Grundzeit, ohne Grundzeit weniger
    // als dreißig Sekunden. Gilt für die Seite, die hier ziehen muss.
    if let Some(clock) = clock_centis {
        let short = match base {
            Some(base) => clock * 10 < base,
            None => clock < 3000,
        };
        if short {
            out.push(json!({ "kind": "time_trouble", "side": color_letter(mover) }));
        }
    }

    out
}

/// Die Zeichen einer Partie.
pub struct GameSigns {
    /// Eine JSON-Zeichenkette je Zeile · die Stellung vor ihrem Halbzug.
    pub rows: Vec<String>,
    /// Die Schlussstellung · sie hat keine eigene Zeile, steht aber in der
    /// Partienvorschau. Leer, wenn die Analyse nicht bis zum Ende reicht.
    pub end: String,
}

fn list_text(list: Vec<Value>) -> String {
    if list.is_empty() {
        String::new()
    } else {
        Value::Array(list).to_string()
    }
}

/// Die Zeichen aller Stellungen einer Partie.
///
/// `rows` sind die gespeicherten Zeilen nach Halbzug geordnet, gleich lang
/// wie `walked` oder kürzer. `clocks` ist die Uhrenliste der Partie (Restzeit
/// nach jedem Halbzug), `time_control` ihre Zeitkontrolle.
pub fn signs_for_game(
    walked: &[chess::WalkedMove],
    rows: &[RowFacts],
    clocks: &str,
    time_control: &str,
) -> GameSigns {
    let clock_list: Vec<Option<u32>> = clocks
        .split_whitespace()
        .map(|value| value.parse().ok())
        .collect();
    let base = base_centis(time_control);
    let per_row = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let Some(w) = walked.get(index) else {
                return String::new();
            };
            let previous = index.checked_sub(1).and_then(|i| rows.get(i));
            // Die eigene Uhr steht nach dem vorletzten Halbzug · davor gilt
            // die Grundzeit, und die ist nie Zeitnot.
            let clock = index
                .checked_sub(2)
                .and_then(|i| clock_list.get(i).copied().flatten());
            // Das Zielfeld des Zuges davor · das kennt nur die nachgespielte
            // Partie.
            let last_target = index
                .checked_sub(1)
                .and_then(|i| walked.get(i))
                .and_then(|prev| san_target(&prev.fen_before, &prev.san));
            let list = signs(
                &w.fen_before,
                w.phase,
                row,
                previous,
                last_target.as_deref(),
                clock,
                base,
            );
            list_text(list)
        })
        .collect();

    // Die Schlussstellung · beschrieben von der letzten Zeile, ohne eigene.
    let end = match (rows.last(), walked.get(rows.len().wrapping_sub(1))) {
        (Some(last), Some(last_walk)) if !rows.is_empty() && rows.len() == walked.len() => {
            let none = RowFacts {
                eval_cp: None,
                mate_in: None,
                best_uci: "",
                judgment: "",
                motif: "",
                motif_detail: "",
            };
            let clock = rows
                .len()
                .checked_sub(2)
                .and_then(|i| clock_list.get(i).copied().flatten());
            let target = san_target(&last_walk.fen_before, &last_walk.san);
            list_text(signs(
                &last_walk.fen_after,
                last_walk.phase,
                &none,
                Some(last),
                target.as_deref(),
                clock,
                base,
            ))
        }
        _ => String::new(),
    };
    GameSigns { rows: per_row, end }
}

/// Das Zielfeld eines SAN-Zuges in einer Stellung.
fn san_target(fen: &str, san: &str) -> Option<String> {
    let board = Board::from_fen(fen).ok()?;
    let mv = chess::parse_san(&board, san).ok()?;
    Some(square_of(mv.dst()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row<'a>(judgment: &'a str, best: &'a str, cp: Option<i32>) -> RowFacts<'a> {
        RowFacts {
            eval_cp: cp,
            mate_in: None,
            best_uci: best,
            judgment,
            motif: "",
            motif_detail: "",
        }
    }

    fn kinds(list: &[Value]) -> Vec<&str> {
        list.iter().filter_map(|s| s["kind"].as_str()).collect()
    }

    #[test]
    fn eval_steps_follow_the_informator() {
        assert_eq!(eval_sign(Some(0), None), Some("="));
        assert_eq!(eval_sign(Some(50), None), Some("+="));
        assert_eq!(eval_sign(Some(-150), None), Some("-/+"));
        assert_eq!(eval_sign(Some(900), None), Some("+-"));
        assert_eq!(eval_sign(Some(0), Some(-3)), Some("-+"));
        assert_eq!(eval_sign(None, None), None);
    }

    #[test]
    fn the_idea_needs_a_missed_move() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let quiet = signs(
            fen,
            "opening",
            &row("", "e2e4", Some(20)),
            None,
            None,
            None,
            None,
        );
        assert!(!kinds(&quiet).contains(&"idea"));
        let missed = signs(
            fen,
            "opening",
            &row("mistake", "e2e4", Some(20)),
            None,
            None,
            None,
            None,
        );
        let idea = missed.iter().find(|s| s["kind"] == "idea").unwrap();
        assert_eq!(idea["squares"][0], "e4");
        assert_eq!(idea["san"], "e4");
    }

    #[test]
    fn a_fork_marks_its_targets_and_the_attack() {
        // Nach 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4?? 4.Nxe5 · Weiß am Zug nach dem
        // Fehler; die Empfehlung Bxf7+ ist ein Schach und zählt als Angriff.
        let fen = "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
        let before = RowFacts {
            eval_cp: Some(250),
            mate_in: None,
            best_uci: "g8f6",
            judgment: "blunder",
            motif: "fork",
            motif_detail: r#"{"square":"f7","targets":[{"piece":"K","square":"e8"},{"piece":"R","square":"h8"}]}"#,
        };
        let here = row("", "c4f7", Some(260));
        let list = signs(fen, "opening", &here, Some(&before), None, None, None);
        let found = kinds(&list);
        assert!(found.contains(&"eval"));
        assert!(found.contains(&"attack"));
        let against = list.iter().find(|s| s["kind"] == "against").unwrap();
        assert_eq!(against["squares"], json!(["e8", "h8"]));
    }

    #[test]
    fn bishops_and_pawns_are_read_from_the_board() {
        // Weiß: Läuferpaar, Doppelbauer auf c, Freibauer auf a. Schwarz: ein Läufer.
        let fen = "4k3/5pb1/8/8/8/2P5/P1P5/2B1KB2 w - - 0 1";
        let list = signs(fen, "endgame", &row("", "", None), None, None, None, None);
        let pair = list.iter().find(|s| s["kind"] == "bishop_pair").unwrap();
        assert_eq!(pair["side"], "w");
        let doubled = list.iter().find(|s| s["kind"] == "doubled").unwrap();
        assert_eq!(doubled["squares"], json!(["c3", "c2"]));
        let passed = list.iter().find(|s| s["kind"] == "passed").unwrap();
        assert!(passed["squares"].as_array().unwrap().contains(&json!("a2")));
        assert!(kinds(&list).contains(&"ending"));
    }

    #[test]
    fn opposite_bishops_are_named() {
        let fen = "4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1";
        let list = signs(fen, "endgame", &row("", "", None), None, None, None, None);
        // c1 ist dunkel, f8 ist dunkel · gleichfarbig.
        assert!(kinds(&list).contains(&"same_bishops"));
        let fen = "4k1b1/8/8/8/8/8/8/2B1K3 w - - 0 1";
        let list = signs(fen, "endgame", &row("", "", None), None, None, None, None);
        assert!(kinds(&list).contains(&"opposite_bishops"));
    }

    #[test]
    fn time_trouble_uses_the_base_time() {
        let fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
        let list = signs(
            fen,
            "endgame",
            &row("", "", None),
            None,
            None,
            Some(5000),
            Some(60000),
        );
        assert!(kinds(&list).contains(&"time_trouble"));
        let list = signs(
            fen,
            "endgame",
            &row("", "", None),
            None,
            None,
            Some(9000),
            Some(60000),
        );
        assert!(!kinds(&list).contains(&"time_trouble"));
        assert_eq!(base_centis("600+5"), Some(60000));
        assert_eq!(base_centis("-"), None);
    }

    #[test]
    fn a_game_gets_the_nag_on_the_square_it_landed() {
        let walked = chess::walk_sans("e4 e5 Qh5 Nc6");
        let rows = [
            row("", "e2e4", Some(30)),
            row("", "e7e5", Some(30)),
            row("inaccuracy", "g1f3", Some(-20)),
            row("", "b8c6", Some(-20)),
        ];
        let out = signs_for_game(&walked, &rows, "", "").rows;
        let fourth: Value = serde_json::from_str(&out[3]).unwrap();
        let nag = fourth
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["kind"] == "nag")
            .unwrap();
        assert_eq!(nag["value"], "?!");
        assert_eq!(nag["squares"], json!(["h5"]));
        let third: Value = serde_json::from_str(&out[2]).unwrap();
        let idea = third
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["kind"] == "idea")
            .unwrap();
        assert_eq!(idea["squares"], json!(["f3"]));
    }
}
