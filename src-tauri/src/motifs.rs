//! Motiverkennung · was an einem Zug erzählenswert ist.
//!
//! Die Auto-Analyse weiß nach ihrem Lauf, *wie teuer* ein Zug war. Sie weiß
//! nicht, *was passiert ist*. Genau das steht hier: Aus der Stellung vor dem
//! Zug, dem gespielten Zug und den beiden Hauptvarianten — der, die man hätte
//! spielen sollen, und der, mit der die Gegenseite den Zug bestraft — wird ein
//! benanntes Motiv samt seiner Felder.
//!
//! **Hier entstehen keine Sätze.** Zurück kommt eine Kennung („fork") und ein
//! kleines JSON mit den Feldern, aus denen die Oberfläche den Satz baut. Der
//! Grund ist die Mehrsprachigkeit: Kiebitz spricht sieben Sprachen, und ein
//! Text, der in Rust entsteht, spricht genau eine. Aus demselben Grund steht
//! SAN hier immer englisch — `lib/notation.ts` übersetzt es beim Setzen.
//!
//! Zwei Regeln entscheiden, ob das gut oder peinlich wird:
//!
//! 1. **Behauptet wird nur, was geprüft ist.** Findet keine Prüfung ein Motiv,
//!    bleibt es bei `none` — die Oberfläche sagt dann den schlichten Satz über
//!    den Verlust, der immer stimmt.
//! 2. **Bestrafungsmotive brauchen ein Urteil.** „Gabel" wird nur zu einem Zug
//!    gesagt, den die Engine ohnehin als Ungenauigkeit oder schlechter
//!    einstuft. Sonst wächst um jeden ruhigen Zug eine Geschichte.

use crate::chess;
use owlchess::movegen;
use owlchess::{Board, Color, Coord, Move, MoveKind, Piece};
use serde_json::{json, Map, Value};

/// Regelstand der Erkennung.
///
/// Steht in `move_evals.expl_version` an jeder Zeile. Ändert sich die
/// Erkennung, zählt diese Zahl hoch, und die Erklärungen lassen sich neu
/// ableiten, ohne Stockfish ein zweites Mal laufen zu lassen.
pub const EXPL_VERSION: i64 = 1;

/// So viele Halbzüge einer Hauptvariante werden gespeichert.
///
/// Vier reichen für den Satz „nach 17…Sxe5 folgt die Gabel auf d5" und für
/// jede Prüfung hier; alles darüber wäre Text, den nie jemand liest.
pub const PV_PLIES: usize = 4;

/// Was ein Zug an Fakten mitbringt · alles aus Sicht des Ziehenden.
pub struct MoveFacts<'a> {
    /// Volle FEN der Stellung vor dem Zug.
    pub fen_before: &'a str,
    /// Der gespielte Zug in englischem SAN.
    pub san: &'a str,
    /// Empfehlung der Engine in der Stellung davor, UCI.
    pub best_uci: &'a str,
    /// Hauptvariante ab der Stellung *nach* dem Zug · die Gegenseite zieht.
    pub pv_after: &'a [String],
    /// `""`, `inaccuracy`, `mistake` oder `blunder`.
    pub judgment: &'a str,
    /// Matt vor dem Zug, positiv = der Ziehende setzt matt.
    pub mate_before: Option<i32>,
    /// Matt nach dem Zug, weiterhin aus Sicht des Ziehenden.
    pub mate_after: Option<i32>,
}

/// Ein erkanntes Motiv.
pub struct Motif {
    /// Kennung · `""` heißt: nichts Belastbares gefunden.
    pub name: &'static str,
    /// Die Felder des Satzes, als JSON-Objekt.
    pub detail: Map<String, Value>,
}

impl Motif {
    fn none() -> Self {
        Self {
            name: "",
            detail: Map::new(),
        }
    }

    fn new(name: &'static str, detail: Value) -> Self {
        Self {
            name,
            detail: match detail {
                Value::Object(map) => map,
                _ => Map::new(),
            },
        }
    }

    /// Das Motiv als JSON-Zeichenkette für die Datenbank · leer, wenn keines.
    pub fn detail_json(&self) -> String {
        if self.detail.is_empty() {
            String::new()
        } else {
            Value::Object(self.detail.clone()).to_string()
        }
    }
}

// ── Kleines Handwerkszeug ────────────────────────────────────────────────────

/// Tauschwert einer Figur in Bauern · der König zählt als unbezahlbar.
fn value(piece: Piece) -> i32 {
    match piece {
        Piece::Pawn => 1,
        Piece::Knight | Piece::Bishop => 3,
        Piece::Rook => 5,
        Piece::Queen => 9,
        Piece::King => 100,
    }
}

/// Der SAN-Buchstabe einer Figur · derselbe Schlüssel wie `ins.piece.*`.
fn letter(piece: Piece) -> &'static str {
    match piece {
        Piece::Pawn => "P",
        Piece::Knight => "N",
        Piece::Bishop => "B",
        Piece::Rook => "R",
        Piece::Queen => "Q",
        Piece::King => "K",
    }
}

/// Die Felder, die die Figur auf `from` angreift.
///
/// Eigene Rechnung statt owlchess' Angriffstabellen: die sind dort privat.
/// Bauern greifen nur diagonal an — ihr Zug nach vorn ist kein Angriff, und
/// wer das verwechselt, meldet Gabeln, die keine sind.
fn attacks_of(board: &Board, from: Coord) -> Vec<Coord> {
    let cell = board.get(from);
    let (Some(color), Some(piece)) = (cell.color(), cell.piece()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    // Rangindizes zählen von oben: Weiß schlägt Richtung -1.
    let forward: isize = if color == Color::White { -1 } else { 1 };
    match piece {
        Piece::Pawn => {
            for df in [-1isize, 1] {
                if let Some(c) = from.shift(df, forward) {
                    out.push(c);
                }
            }
        }
        Piece::Knight => {
            for (df, dr) in [
                (1isize, 2isize),
                (2, 1),
                (2, -1),
                (1, -2),
                (-1, -2),
                (-2, -1),
                (-2, 1),
                (-1, 2),
            ] {
                if let Some(c) = from.shift(df, dr) {
                    out.push(c);
                }
            }
        }
        Piece::King => {
            for (df, dr) in [
                (1isize, 0isize),
                (1, 1),
                (0, 1),
                (-1, 1),
                (-1, 0),
                (-1, -1),
                (0, -1),
                (1, -1),
            ] {
                if let Some(c) = from.shift(df, dr) {
                    out.push(c);
                }
            }
        }
        Piece::Bishop | Piece::Rook | Piece::Queen => {
            for &(df, dr) in directions(piece) {
                let mut at = from;
                while let Some(next) = at.shift(df, dr) {
                    out.push(next);
                    if board.get(next).is_occupied() {
                        break;
                    }
                    at = next;
                }
            }
        }
    }
    out
}

/// Die Strahlrichtungen einer Fernfigur.
fn directions(piece: Piece) -> &'static [(isize, isize)] {
    const DIAG: &[(isize, isize)] = &[(1, 1), (1, -1), (-1, 1), (-1, -1)];
    const LINE: &[(isize, isize)] = &[(1, 0), (-1, 0), (0, 1), (0, -1)];
    const BOTH: &[(isize, isize)] = &[
        (1, 1),
        (1, -1),
        (-1, 1),
        (-1, -1),
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
    ];
    match piece {
        Piece::Bishop => DIAG,
        Piece::Rook => LINE,
        _ => BOTH,
    }
}

/// Deckt `color` das Feld `at`?
///
/// Eine gefesselte Figur zählt hier als Deckung. Das ist absichtlich die
/// vorsichtige Richtung: Der Fehler führt dazu, dass „hängt" *nicht* gesagt
/// wird, und nicht dazu, dass es zu Unrecht gesagt wird.
fn defended(board: &Board, at: Coord, color: Color) -> bool {
    movegen::cell_attackers(board, at, color).is_nonempty()
}

/// SAN eines UCI-Zuges in einer Stellung · englisch, wie überall gespeichert.
fn san_of(board: &Board, uci: &str) -> Option<String> {
    let mv = Move::from_uci_legal(uci, board).ok()?;
    chess::canonical_san(board, mv).ok()
}

// ── Die einzelnen Prüfungen ──────────────────────────────────────────────────

/// Gabel: Eine Figur greift zwei Ziele zugleich an, die sie auch bekommt.
///
/// Ein Ziel zählt, wenn es mehr wert ist als der Angreifer — oder wenn es
/// ungedeckt und wenigstens eine Leichtfigur ist. Ohne die erste Bedingung
/// meldete jeder Springer, der zwei Bauern anschaut, eine Gabel; ohne die
/// zweite bliebe der häufigste Fall von allen stumm: Damenschach mit
/// Abgriff auf eine ungedeckte Figur, die für die Dame zu billig ist.
struct Fork {
    at: Coord,
    piece: Piece,
    targets: Vec<(Coord, Piece)>,
}

fn detect_fork(board: &Board, at: Coord, victim: Color) -> Option<Fork> {
    let cell = board.get(at);
    let piece = cell.piece()?;
    if cell.color()? == victim {
        return None;
    }
    let worth = value(piece);
    let mut targets = Vec::new();
    for square in attacks_of(board, at) {
        let target = board.get(square);
        if target.color() != Some(victim) {
            continue;
        }
        let Some(kind) = target.piece() else { continue };
        let worth_taking =
            value(kind) > worth || (value(kind) >= 3 && !defended(board, square, victim));
        if worth_taking {
            targets.push((square, kind));
        }
    }
    if targets.len() < 2 {
        return None;
    }
    targets.sort_by_key(|(_, kind)| -value(*kind));
    Some(Fork { at, piece, targets })
}

/// Fesselung und Spieß · dieselbe Geometrie, andere Reihenfolge der Werte.
struct Line {
    kind: &'static str,
    slider: Coord,
    front: (Coord, Piece),
    behind: (Coord, Piece),
}

fn detect_line_motif(board: &Board, victim: Color) -> Option<Line> {
    let attacker = victim.inv();
    let mut best: Option<Line> = None;
    for slider in Coord::iter() {
        let cell = board.get(slider);
        if cell.color() != Some(attacker) {
            continue;
        }
        let Some(kind) = cell.piece() else { continue };
        if !matches!(kind, Piece::Bishop | Piece::Rook | Piece::Queen) {
            continue;
        }
        for (df, dr) in directions(kind) {
            // Erstes besetztes Feld auf dem Strahl · davor ist nichts.
            let mut at = slider;
            let front = loop {
                let Some(next) = at.shift(*df, *dr) else {
                    break None;
                };
                if board.get(next).is_occupied() {
                    break Some(next);
                }
                at = next;
            };
            let Some(front) = front else { continue };
            let front_cell = board.get(front);
            if front_cell.color() != Some(victim) {
                continue;
            }
            let Some(front_piece) = front_cell.piece() else {
                continue;
            };
            // Und das nächste dahinter, auf derselben Linie.
            let mut at = front;
            let behind = loop {
                let Some(next) = at.shift(*df, *dr) else {
                    break None;
                };
                if board.get(next).is_occupied() {
                    break Some(next);
                }
                at = next;
            };
            let Some(behind) = behind else { continue };
            let behind_cell = board.get(behind);
            if behind_cell.color() != Some(victim) {
                continue;
            }
            let Some(behind_piece) = behind_cell.piece() else {
                continue;
            };
            let (front_value, behind_value) = (value(front_piece), value(behind_piece));
            // Fesselung: das Wertvollere steht hinten und kann nicht weg.
            // Spieß: es steht vorn und muss weichen.
            //
            // Ein Bauer vorn zählt nur gegen den König. Sonst meldete jede
            // Partie mit Turm h1 und Bauer h2 eine Fesselung, sobald irgendwo
            // auf der h-Linie eine gegnerische Schwerfigur steht — formal
            // richtig und trotzdem keine Auskunft.
            let front_counts = front_value >= 3 || behind_piece == Piece::King;
            let kind = if behind_value > front_value && front_counts {
                "pin"
            } else if front_value > behind_value && behind_value >= 3 {
                "skewer"
            } else {
                continue;
            };
            let found = Line {
                kind,
                slider,
                front: (front, front_piece),
                behind: (behind, behind_piece),
            };
            // Der teuerste Fund gewinnt · eine Fesselung gegen den König
            // schlägt eine gegen den Turm.
            let weight = value(found.behind.1).max(value(found.front.1));
            if best
                .as_ref()
                .map(|b| value(b.behind.1).max(value(b.front.1)) < weight)
                .unwrap_or(true)
            {
                best = Some(found);
            }
        }
    }
    best
}

/// Hängende Figur: Der beste Gegenzug schlägt und gewinnt dabei Material.
struct Hanging {
    square: Coord,
    piece: Piece,
    /// Kann überhaupt zurückgeschlagen werden?
    recapture: bool,
}

fn detect_hanging(after: &Board, reply: Move, victim: Color) -> Option<Hanging> {
    let target = after.get(reply.dst());
    // En passant schlägt neben dem Zielfeld · für die Aussage „hängt" ist der
    // Fall zu speziell, und ein Bauer ist er ohnehin.
    if reply.kind() == MoveKind::Enpassant {
        return None;
    }
    if target.color() != Some(victim) {
        return None;
    }
    let piece = target.piece()?;
    // Nur Figuren. „Bauer b2 stand ohne Deckung" ist zu jedem zweiten Schlag
    // wahr und sagt über den Zug nichts; wo ein Bauer wirklich den Ausschlag
    // gab, trägt der schlichte Satz über den Preis die Auskunft besser.
    if value(piece) < 3 {
        return None;
    }
    let attacker = after.get(reply.src()).piece()?;
    let board = after.make_move(reply).ok()?;
    let recapture = defended(&board, reply.dst(), victim);
    // Entweder wir können gar nicht zurückschlagen, oder der Tausch bleibt
    // auch nach dem Zurückschlagen ein Verlust.
    if !recapture || value(piece) > value(attacker) {
        Some(Hanging {
            square: reply.dst(),
            piece,
            recapture,
        })
    } else {
        None
    }
}

/// Abzugsangriff: Eine Figur, die *nicht* gezogen hat, greift plötzlich an.
struct Discovered {
    from: Coord,
    piece: Piece,
    target: (Coord, Piece),
}

fn detect_discovered(
    before: &Board,
    after: &Board,
    moved_to: Coord,
    victim: Color,
) -> Option<Discovered> {
    let attacker = victim.inv();
    for square in Coord::iter() {
        if square == moved_to {
            continue;
        }
        let cell = after.get(square);
        if cell.color() != Some(attacker) {
            continue;
        }
        let Some(piece) = cell.piece() else { continue };
        if !matches!(piece, Piece::Bishop | Piece::Rook | Piece::Queen) {
            continue;
        }
        // Dieselbe Figur muss vorher auf demselben Feld gestanden haben —
        // sonst ist sie nicht „aufgedeckt" worden, sondern gezogen.
        if before.get(square) != cell {
            continue;
        }
        let was = attacks_of(before, square);
        for target in attacks_of(after, square) {
            if was.contains(&target) {
                continue;
            }
            let cell = after.get(target);
            if cell.color() != Some(victim) {
                continue;
            }
            let Some(kind) = cell.piece() else { continue };
            if value(kind) >= 5 && !defended(after, target, victim) || kind == Piece::King {
                return Some(Discovered {
                    from: square,
                    piece,
                    target: (target, kind),
                });
            }
        }
    }
    None
}

/// Grundreihenschwäche: Der König steht auf seiner Grundreihe, alle Felder
/// davor sind verstellt, und eine gegnerische Schwerfigur steht *bereits auf
/// dieser Reihe*.
///
/// Die letzte Bedingung ist die entscheidende. Ohne sie meldet die Prüfung
/// jede Rochade: Ein rochierter König hat immer drei eigene Bauern vor sich,
/// und irgendeinen Turm hat die Gegenseite fast immer noch. Erst die
/// Schwerfigur auf der Reihe macht aus der Stellung eine Drohung.
fn detect_back_rank(board: &Board, side: Color) -> Option<Coord> {
    let king = board.king_pos(side);
    let home = if side == Color::White { '1' } else { '8' };
    if king.rank().as_char() != home {
        return None;
    }
    // Vorwärts heißt für Weiß: kleinerer Rangindex.
    let forward: isize = if side == Color::White { -1 } else { 1 };
    let mut blocked = 0;
    let mut squares = 0;
    for df in [-1isize, 0, 1] {
        let Some(front) = king.shift(df, forward) else {
            continue;
        };
        squares += 1;
        if board.get(front).color() == Some(side) {
            blocked += 1;
        }
    }
    if squares == 0 || blocked < squares {
        return None;
    }
    let heavy = (board.piece2(side.inv(), Piece::Rook) | board.piece2(side.inv(), Piece::Queen))
        .into_iter()
        .any(|square| square.rank() == king.rank());
    if heavy {
        Some(king)
    } else {
        None
    }
}

// ── Die Erkennung als Ganzes ─────────────────────────────────────────────────

/// Erkennt das Motiv eines Zuges.
///
/// Die Reihenfolge ist die Aussagekraft: Ein Matt schlägt alles, ein konkreter
/// Materialverlust schlägt eine Stellungsschwäche, und was keine Prüfung
/// findet, bleibt ungesagt.
pub fn detect(facts: &MoveFacts) -> Motif {
    let Ok(before) = Board::from_fen(facts.fen_before) else {
        return Motif::none();
    };
    let mover = before.side();
    let Ok(played) = chess::parse_san(&before, facts.san) else {
        return Motif::none();
    };
    let Ok(after) = before.make_move(played) else {
        return Motif::none();
    };
    let best_san = san_of(&before, facts.best_uci).unwrap_or_default();

    // 1 · Matt gesetzt.
    if after.is_check() && !after.has_legal_moves() {
        return Motif::new("mate", json!({ "san": facts.san }));
    }

    // 2 · Matt zugelassen · nur, wenn es vorher noch keins gab.
    let already_lost = facts.mate_before.map(|m| m < 0).unwrap_or(false);
    if let Some(mate) = facts.mate_after {
        if mate < 0 && !already_lost {
            let mut detail = json!({ "moves": mate.abs() });
            if !best_san.is_empty() {
                detail["best"] = Value::String(best_san.clone());
            }
            return Motif::new("allowed_mate", detail);
        }
    }

    // 3 · Matt übersehen.
    if let Some(mate) = facts.mate_before {
        if mate > 0 && !facts.mate_after.map(|m| m > 0).unwrap_or(false) && !best_san.is_empty() {
            return Motif::new(
                "missed_mate",
                json!({ "best": best_san, "moves": mate.abs() }),
            );
        }
    }

    // Ab hier wird nur zu Zügen erzählt, die die Engine ohnehin bemängelt.
    if facts.judgment.is_empty() {
        if played.uci().to_string() == facts.best_uci {
            return Motif::new("best_move", json!({ "san": facts.san }));
        }
        return Motif::none();
    }

    // Die Bestrafung: der beste Zug der Gegenseite in der Stellung danach.
    let reply = facts
        .pv_after
        .first()
        .and_then(|uci| Move::from_uci_legal(uci, &after).ok());
    let reply_san = reply.and_then(|mv| chess::canonical_san(&after, mv).ok());
    let punished = reply
        .and_then(|mv| after.make_move(mv).ok())
        .unwrap_or_else(|| after.clone());

    let mut detail = Map::new();
    if !best_san.is_empty() {
        detail.insert("best".into(), Value::String(best_san.clone()));
    }
    if let Some(san) = &reply_san {
        detail.insert("reply".into(), Value::String(san.clone()));
    }
    let with = |name: &'static str, extra: Value| -> Motif {
        let mut map = detail.clone();
        if let Value::Object(object) = extra {
            for (key, value) in object {
                map.insert(key, value);
            }
        }
        Motif { name, detail: map }
    };

    // 4 · Eine Figur hängt.
    if let Some(mv) = reply {
        if let Some(found) = detect_hanging(&after, mv, mover) {
            return with(
                "hanging_piece",
                json!({
                    "piece": letter(found.piece),
                    "square": found.square.to_string(),
                    "recapture": found.recapture,
                }),
            );
        }
    }

    // 5 · Gabel · das Feld, auf dem der Gegenzug landet.
    if let Some(mv) = reply {
        if let Some(found) = detect_fork(&punished, mv.dst(), mover) {
            return with(
                "fork",
                json!({
                    "piece": letter(found.piece),
                    "square": found.at.to_string(),
                    "targets": found
                        .targets
                        .iter()
                        .map(|(square, kind)| json!({
                            "piece": letter(*kind),
                            "square": square.to_string(),
                        }))
                        .collect::<Vec<_>>(),
                }),
            );
        }
    }

    // 6 · Fesselung oder Spieß · nur, wenn der Gegenzug sie erst schafft.
    if let Some(found) = detect_line_motif(&punished, mover) {
        if detect_line_motif(&before, mover)
            .map(|had| had.front.0 != found.front.0 || had.behind.0 != found.behind.0)
            .unwrap_or(true)
        {
            return with(
                found.kind,
                json!({
                    "square": found.front.0.to_string(),
                    "piece": letter(found.front.1),
                    "behind": found.behind.0.to_string(),
                    "behindPiece": letter(found.behind.1),
                    "from": found.slider.to_string(),
                }),
            );
        }
    }

    // 7 · Abzugsangriff.
    if let Some(mv) = reply {
        if let Some(found) = detect_discovered(&after, &punished, mv.dst(), mover) {
            return with(
                "discovered_attack",
                json!({
                    "piece": letter(found.piece),
                    "from": found.from.to_string(),
                    "targetPiece": letter(found.target.1),
                    "square": found.target.0.to_string(),
                }),
            );
        }
    }

    // 8 · Grundreihe · geprüft wird die Stellung nach dem Gegenzug, wie bei
    // den anderen Bestrafungen: Die Drohung entsteht erst, wenn die
    // Schwerfigur auf der Reihe steht.
    if detect_back_rank(&punished, mover).is_some() && detect_back_rank(&before, mover).is_none() {
        let king = punished.king_pos(mover);
        return with("back_rank", json!({ "square": king.to_string() }));
    }

    Motif {
        name: "none",
        detail,
    }
}

/// Die gespeicherte Kurzform einer Hauptvariante.
pub fn pv_text(pv: &[String]) -> String {
    pv.iter()
        .take(PV_PLIES)
        .cloned()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Eine gespeicherte Hauptvariante als SAN-Folge, ab `fen`.
///
/// Die Oberfläche zeigt Züge, nicht Koordinaten · und sie zeigt sie in der
/// Sprache des Nutzers, weshalb hier englisches SAN herauskommt.
pub fn pv_sans(fen: &str, pv: &str) -> Vec<String> {
    let Ok(mut pos) = Board::from_fen(fen) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for uci in pv.split_whitespace() {
        let Ok(mv) = Move::from_uci_legal(uci, &pos) else {
            break;
        };
        let Ok(san) = chess::canonical_san(&pos, mv) else {
            break;
        };
        let Ok(next) = pos.make_move(mv) else {
            break;
        };
        out.push(san);
        pos = next;
    }
    out
}

/// Das Motiv einer Aufgabe aus einer eigenen Partie · als Lichess-Schlüssel.
///
/// `detect` erzählt, womit ein Fehler *bestraft* wurde. Eine eigene Aufgabe
/// fragt das Umgekehrte: Was hätte der verpasste Zug selbst getan? Dieselben
/// Prüfungen, nur aus Sicht dessen, der ihn hätte spielen sollen — mit genau
/// den Schlüsseln, unter denen Lichess seine Aufgaben führt. Damit tragen die
/// eigenen Aufgaben ein Motiv, eine Theorie dazu und eine Trefferquote, statt
/// als „verpasster Zug" ohne Namen dazustehen. Findet keine Prüfung etwas,
/// bleibt es dabei.
pub fn solution_theme(fen: &str, best_uci: &str) -> Option<&'static str> {
    let before = Board::from_fen(fen).ok()?;
    let mv = Move::from_uci_legal(best_uci, &before).ok()?;
    let after = before.make_move(mv).ok()?;
    let victim = before.side().inv();

    if after.is_check() && !after.has_legal_moves() {
        return Some(if detect_back_rank(&after, victim).is_some() {
            "backRankMate"
        } else {
            "mateIn1"
        });
    }
    if detect_hanging(&before, mv, victim).is_some() {
        return Some("hangingPiece");
    }
    if detect_fork(&after, mv.dst(), victim).is_some() {
        return Some("fork");
    }
    if let Some(found) = detect_line_motif(&after, victim) {
        let new = detect_line_motif(&before, victim)
            .map(|had| had.front.0 != found.front.0 || had.behind.0 != found.behind.0)
            .unwrap_or(true);
        if new {
            return Some(if found.kind == "pin" { "pin" } else { "skewer" });
        }
    }
    if detect_discovered(&before, &after, mv.dst(), victim).is_some() {
        return Some("discoveredAttack");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_own_puzzle_names_what_the_missed_move_does() {
        // Schäfermatt · der verpasste Zug setzt matt.
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
        assert_eq!(solution_theme(fen, "f3f7"), Some("mateIn1"));
        // Springer c7 greift König e8 und Turm a8 zugleich an.
        let fork = "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
        assert_eq!(solution_theme(fork, "b5c7"), Some("fork"));
        // Ein ruhiger Zug ohne Motiv bleibt ohne Namen.
        let quiet = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
        assert_eq!(solution_theme(quiet, "e1e2"), None);
    }

    fn facts<'a>(
        fen: &'a str,
        san: &'a str,
        best: &'a str,
        pv_after: &'a [String],
        judgment: &'a str,
    ) -> MoveFacts<'a> {
        MoveFacts {
            fen_before: fen,
            san,
            best_uci: best,
            pv_after,
            judgment,
            mate_before: None,
            mate_after: None,
        }
    }

    fn line(ucis: &[&str]) -> Vec<String> {
        ucis.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_mate_is_named_a_mate() {
        // Schäfermatt · 4.Dxf7#.
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
        let motif = detect(&facts(fen, "Qxf7#", "f3f7", &[], ""));
        assert_eq!(motif.name, "mate");
    }

    #[test]
    fn a_move_that_allows_mate_says_so() {
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 5 4";
        let pv = line(&["f3f7"]);
        let mut f = facts(fen, "Nf6", "d8e7", &pv, "blunder");
        f.mate_after = Some(-1);
        let motif = detect(&f);
        assert_eq!(motif.name, "allowed_mate");
        assert_eq!(motif.detail["moves"], json!(1));
    }

    #[test]
    fn a_missed_mate_names_the_move_that_was_there() {
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
        let mut f = facts(fen, "d3", "f3f7", &[], "blunder");
        f.mate_before = Some(1);
        let motif = detect(&f);
        assert_eq!(motif.name, "missed_mate");
        assert_eq!(motif.detail["best"], json!("Qxf7#"));
    }

    #[test]
    fn a_piece_left_en_prise_is_reported_with_its_square() {
        // Weiß stellt den Läufer auf b5, wo ihn nur der Bauer a6 erwartet.
        let fen = "rnbqkbnr/1ppppppp/p7/8/8/4B3/PPPPPPPP/RN1QKBNR w KQkq - 0 3";
        let motif = detect(&facts(fen, "Bb6", "e3d4", &line(&["c7b6"]), "blunder"));
        assert_eq!(motif.name, "hanging_piece");
        assert_eq!(motif.detail["square"], json!("b6"));
        assert_eq!(motif.detail["piece"], json!("B"));
        assert_eq!(motif.detail["reply"], json!("cxb6"));
    }

    #[test]
    fn a_knight_hitting_king_and_rook_is_a_fork() {
        // Schwarz stellt den König nach e7; der weiße Springer springt nach
        // d5 und trifft König und Turm — beide mehr wert als er.
        let fen = "4k3/2r5/8/8/5N2/8/8/4K3 b - - 0 1";
        let motif = detect(&facts(fen, "Ke7", "c7c1", &line(&["f4d5"]), "mistake"));
        assert_eq!(motif.name, "fork");
        assert_eq!(motif.detail["square"], json!("d5"));
        let targets = motif.detail["targets"].as_array().unwrap();
        assert_eq!(targets.len(), 2);
        // Das teuerste Ziel steht vorn.
        assert_eq!(targets[0]["piece"], json!("K"));
        assert_eq!(motif.detail["reply"], json!("Nd5+"));
    }

    #[test]
    fn a_queen_check_that_also_hits_a_loose_knight_is_a_fork() {
        // Schwarz: König h8, ungedeckter Springer e5. Weiß gibt Schach auf d5
        // und nimmt den Springer mit — für die Dame ist er zu billig, um
        // „mehr wert" zu sein, und trotzdem ist es eine Gabel.
        let fen = "7k/8/8/4n3/8/8/6PP/3Q2K1 b - - 0 1";
        let motif = detect(&facts(fen, "Kg8", "e5f3", &line(&["d1d5"]), "blunder"));
        assert_eq!(motif.name, "fork");
        assert_eq!(motif.detail["square"], json!("d5"));
        let targets = motif.detail["targets"].as_array().unwrap();
        assert_eq!(targets.len(), 2);
    }

    #[test]
    fn two_loose_pawns_are_not_a_fork() {
        // Derselbe Aufbau mit Bauern statt Figuren · zwei ungedeckte Bauern
        // sind kein Motiv, sondern der Alltag.
        let fen = "7k/8/8/3p1p2/8/8/6PP/3Q2K1 b - - 0 1";
        let motif = detect(&facts(fen, "Kg8", "d5d4", &line(&["d1d4"]), "blunder"));
        assert_ne!(motif.name, "fork");
    }

    #[test]
    fn a_bishop_pinning_a_knight_to_the_king_is_a_pin() {
        // Weiß spielt h3, Schwarz antwortet Lb4: der Springer c3 kann nicht
        // mehr weg, hinter ihm steht der König e1.
        let fen = "4kb2/8/8/8/8/2N5/7P/4K3 w - - 0 1";
        let motif = detect(&facts(fen, "h3", "c3d5", &line(&["f8b4"]), "mistake"));
        assert_eq!(motif.name, "pin");
        assert_eq!(motif.detail["square"], json!("c3"));
        assert_eq!(motif.detail["behind"], json!("e1"));
        assert_eq!(motif.detail["piece"], json!("N"));
    }

    #[test]
    fn a_quiet_move_that_the_engine_likes_gets_no_story() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let motif = detect(&facts(fen, "d4", "e2e4", &[], ""));
        assert_eq!(motif.name, "");
        assert!(motif.detail_json().is_empty());
    }

    #[test]
    fn the_engines_own_move_is_named_as_such() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let motif = detect(&facts(fen, "e4", "e2e4", &[], ""));
        assert_eq!(motif.name, "best_move");
    }

    #[test]
    fn a_bad_move_without_a_motif_still_carries_the_better_one() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let motif = detect(&facts(fen, "a4", "e2e4", &line(&["e7e5"]), "inaccuracy"));
        assert_eq!(motif.name, "none");
        assert_eq!(motif.detail["best"], json!("e4"));
    }

    #[test]
    fn a_line_becomes_readable_moves() {
        let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        assert_eq!(pv_sans(fen, "e2e4 e7e5 g1f3"), vec!["e4", "e5", "Nf3"]);
        // Was nicht mehr passt, bricht ab statt zu raten.
        assert_eq!(pv_sans(fen, "e2e4 e7e5 e2e4"), vec!["e4", "e5"]);
    }

    #[test]
    fn only_the_first_plies_of_a_line_are_kept() {
        let long = line(&["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"]);
        assert_eq!(pv_text(&long).split_whitespace().count(), PV_PLIES);
    }

    #[test]
    fn castling_is_not_a_back_rank_weakness() {
        // Der häufigste Fehlalarm von allen: Ein rochierter König hat immer
        // drei eigene Bauern vor sich. Erst eine Schwerfigur auf der Reihe
        // macht daraus eine Drohung.
        let fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5";
        let motif = detect(&facts(fen, "O-O", "d2d3", &line(&["e8g8"]), "inaccuracy"));
        assert_ne!(motif.name, "back_rank");
    }

    #[test]
    fn a_rook_on_the_back_rank_makes_it_one() {
        // Dieselbe Bauernwand · aber der schwarze Turm kommt auf die Reihe,
        // und die drei Bauern stehen noch, wo sie standen.
        let fen = "r5k1/8/8/8/8/8/5PPP/3R2K1 w - - 0 1";
        let motif = detect(&facts(fen, "Rd2", "d1d8", &line(&["a8a1"]), "mistake"));
        assert_eq!(motif.name, "back_rank");
        assert_eq!(motif.detail["square"], json!("g1"));
    }

    #[test]
    fn a_pawn_in_front_of_its_own_rook_is_not_a_pin() {
        // Turm h1, Bauer h2, schwarze Dame auf der h-Linie: formal eine
        // Fesselung, praktisch die Grundstellung jeder zweiten Partie.
        let fen = "6kq/8/8/8/8/8/6PP/5RK1 w - - 0 1";
        let motif = detect(&facts(fen, "Rf2", "g1f2", &line(&["h8h3"]), "mistake"));
        assert_ne!(motif.name, "pin");
    }

    #[test]
    fn a_captured_pawn_is_not_a_hanging_piece() {
        // „Bauer stand ohne Deckung" ist zu jedem zweiten Schlag wahr.
        let fen = "4k3/8/8/3p4/8/8/8/3RK3 b - - 0 1";
        let motif = detect(&facts(fen, "Ke7", "d5d4", &line(&["d1d5"]), "mistake"));
        assert_ne!(motif.name, "hanging_piece");
    }
}
