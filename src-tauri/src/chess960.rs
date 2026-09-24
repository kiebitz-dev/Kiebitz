//! Chess960 im Backend · dieselbe Aufteilung wie vorn in `lib/chess960.ts`.
//!
//! owlchess rochiert nach den Regeln des Standardschachs: König von e1 nach g1,
//! Turm von h1. In Chess960 stehen beide woanders, und genau dieses eine Stück
//! Regelwerk ist anders. Statt eines zweiten Zuggenerators bekommt owlchess
//! deshalb jede Stellung *ohne* Rochaderechte — dann stimmt alles, was es über
//! die übrigen Züge sagt — und die Rochade macht dieses Modul selbst: Es führt
//! die Rechte als Linie des Turms mit, baut den Zug als Stellung und liest
//! die Folgestellung wieder ein.
//!
//! Gebraucht wird das an zwei Stellen: beim Nachspielen einer importierten
//! 960-Partie (`walk`, Grundlage der Auto-Analyse) und beim Reden mit der
//! Engine, die für solche Stellungen `UCI_Chess960` gesetzt bekommt.

use owlchess::movegen::is_cell_attacked;
use owlchess::{Board, Color, Coord, Move, Piece};

/// Rochaderechte als Linie (0 = a … 7 = h) des Turms.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rights {
    pub white: (Option<u8>, Option<u8>),
    pub black: (Option<u8>, Option<u8>),
}

impl Rights {
    fn side(&self, color: Color) -> (Option<u8>, Option<u8>) {
        match color {
            Color::White => self.white,
            Color::Black => self.black,
        }
    }

    fn set(&mut self, color: Color, kingside: bool, file: Option<u8>) {
        let slot = match color {
            Color::White => &mut self.white,
            Color::Black => &mut self.black,
        };
        if kingside {
            slot.0 = file;
        } else {
            slot.1 = file;
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == Rights::default()
    }
}

fn back_rank(color: Color) -> usize {
    if color == Color::White {
        0
    } else {
        7
    }
}

/// Die Belegung einer FEN als Reihen von unten (Index 0 = erste Reihe).
fn rows(placement: &str) -> Vec<Vec<Option<char>>> {
    let mut out = Vec::new();
    for line in placement.split('/').rev() {
        let mut row = Vec::new();
        for ch in line.chars() {
            match ch.to_digit(10) {
                Some(n) => row.extend(std::iter::repeat_n(None, n as usize)),
                None => row.push(Some(ch)),
            }
        }
        row.resize(8, None);
        out.push(row);
    }
    out.resize(8, vec![None; 8]);
    out
}

fn placement(rows: &[Vec<Option<char>>]) -> String {
    let mut out = String::new();
    for (index, row) in rows.iter().enumerate().rev() {
        let mut empty = 0;
        for cell in row {
            match cell {
                Some(piece) => {
                    if empty > 0 {
                        out.push_str(&empty.to_string());
                        empty = 0;
                    }
                    out.push(*piece);
                }
                None => empty += 1,
            }
        }
        if empty > 0 {
            out.push_str(&empty.to_string());
        }
        if index > 0 {
            out.push('/');
        }
    }
    out
}

fn king_file(rows: &[Vec<Option<char>>], color: Color) -> Option<usize> {
    let king = if color == Color::White { 'K' } else { 'k' };
    rows[back_rank(color)].iter().position(|c| *c == Some(king))
}

/// Liest das Rochadefeld · KQkq, Shredder (HAha) und X-FEN.
pub fn parse_rights(field: &str, placement_field: &str) -> Rights {
    let board = rows(placement_field);
    let mut rights = Rights::default();
    if field == "-" {
        return rights;
    }
    for ch in field.chars() {
        let color = if ch.is_ascii_uppercase() {
            Color::White
        } else {
            Color::Black
        };
        let Some(king) = king_file(&board, color) else {
            continue;
        };
        let rank = back_rank(color);
        let rook = if color == Color::White { 'R' } else { 'r' };
        let lower = ch.to_ascii_lowercase();
        let file = match lower {
            'k' => (king + 1..8).rev().find(|f| board[rank][*f] == Some(rook)),
            'q' => (0..king).find(|f| board[rank][*f] == Some(rook)),
            'a'..='h' => {
                let f = (lower as u8 - b'a') as usize;
                (board[rank][f] == Some(rook)).then_some(f)
            }
            _ => None,
        };
        let Some(file) = file.filter(|f| *f != king) else {
            continue;
        };
        rights.set(color, file > king, Some(file as u8));
    }
    rights
}

/// Schreibt die Rechte als X-FEN · `K`/`Q`, solange der Turm der äußerste
/// seiner Seite ist, sonst die Linie.
pub fn format_rights(rights: &Rights, placement_field: &str) -> String {
    let board = rows(placement_field);
    let mut out = String::new();
    for color in [Color::White, Color::Black] {
        let rank = back_rank(color);
        let king = king_file(&board, color);
        let rook = if color == Color::White { 'R' } else { 'r' };
        let (kingside, queenside) = rights.side(color);
        for (file, is_kingside) in [(kingside, true), (queenside, false)] {
            let Some(file) = file else { continue };
            let mut letter = if is_kingside { 'k' } else { 'q' };
            if let Some(king) = king {
                let outer = if is_kingside {
                    (king + 1..8).rev().find(|f| board[rank][*f] == Some(rook))
                } else {
                    (0..king).find(|f| board[rank][*f] == Some(rook))
                };
                if outer != Some(file as usize) {
                    letter = (b'a' + file) as char;
                }
            }
            out.push(if color == Color::White {
                letter.to_ascii_uppercase()
            } else {
                letter
            });
        }
    }
    if out.is_empty() {
        "-".into()
    } else {
        out
    }
}

/// Braucht diese Stellung die Chess960-Rochade, kann das Standardschach sie
/// also nicht spielen?
pub fn needs_chess960(fen: &str) -> bool {
    let fields: Vec<&str> = fen.split_whitespace().collect();
    let (Some(placement_field), Some(castling)) = (fields.first(), fields.get(2)) else {
        return false;
    };
    let rights = parse_rights(castling, placement_field);
    if rights.is_empty() {
        // Ohne Rochaderechte spielt sich auch eine 960-Stellung wie Standard.
        return false;
    }
    let board = rows(placement_field);
    for color in [Color::White, Color::Black] {
        let (kingside, queenside) = rights.side(color);
        if kingside.is_none() && queenside.is_none() {
            continue;
        }
        if king_file(&board, color) != Some(4) {
            return true;
        }
        if kingside.is_some_and(|f| f != 7) || queenside.is_some_and(|f| f != 0) {
            return true;
        }
    }
    false
}

/// Eine Stellung samt der Rochaderechte, die owlchess nicht kennt.
#[derive(Clone)]
pub struct Position960 {
    /// Ohne Rochaderechte · alles außer der Rochade rechnet owlchess.
    pub board: Board,
    pub rights: Rights,
}

/// Die FEN ohne Rochaderechte · so bekommt owlchess sie.
fn without_rights(fen: &str) -> String {
    let mut fields: Vec<&str> = fen.split_whitespace().collect();
    if fields.len() >= 3 {
        fields[2] = "-";
    }
    fields.join(" ")
}

impl Position960 {
    pub fn from_fen(fen: &str) -> Result<Self, String> {
        let fields: Vec<&str> = fen.split_whitespace().collect();
        let placement_field = fields.first().copied().unwrap_or_default();
        let castling = fields.get(2).copied().unwrap_or("-");
        let board =
            Board::from_fen(&without_rights(fen)).map_err(|e| format!("Ungültige FEN: {e}"))?;
        Ok(Self {
            board,
            rights: parse_rights(castling, placement_field),
        })
    }

    /// Die vollständige FEN dieser Stellung, Rochaderechte eingesetzt.
    pub fn fen(&self) -> String {
        let fen = self.board.as_fen();
        let mut fields: Vec<String> = fen.split(' ').map(String::from).collect();
        if fields.len() >= 3 {
            fields[2] = format_rights(&self.rights, &fields[0]);
        }
        fields.join(" ")
    }

    fn side(&self) -> Color {
        self.board.side()
    }

    /// Die Rochade der Seite am Zug · `None`, wenn sie nicht möglich ist.
    fn castle(&self, kingside: bool) -> Option<Position960> {
        let color = self.side();
        let rank = back_rank(color);
        let fen = self.board.as_fen();
        let fields: Vec<&str> = fen.split(' ').collect();
        let mut board = rows(fields[0]);
        let king = king_file(&board, color)?;
        let (kingside_right, queenside_right) = self.rights.side(color);
        let rook = (if kingside {
            kingside_right
        } else {
            queenside_right
        })? as usize;
        let king_to = if kingside { 6 } else { 2 };
        let rook_to = if kingside { 5 } else { 3 };
        // Frei sein muss alles, was König und Turm überqueren · die beiden
        // selbst ausgenommen.
        let lo = king.min(rook).min(king_to).min(rook_to);
        let hi = king.max(rook).max(king_to).max(rook_to);
        for (file, cell) in board[rank].iter().enumerate().take(hi + 1).skip(lo) {
            if file != king && file != rook && cell.is_some() {
                return None;
            }
        }
        if self.board.is_check() {
            return None;
        }
        // Kein Feld auf dem Weg des Königs darf angegriffen sein. Geprüft wird
        // auf dem Brett *ohne den rochierenden Turm*: Sonst verdeckte er einen
        // Angriff, der nach der Rochade über die Reihe durchgeht (weißer Turm
        // e1, schwarzer Turm e8, König läuft über e1).
        //
        // Der König bleibt dabei stehen, denn owlchess nimmt keine Stellung
        // ohne König an. Er verdeckt nur Angriffe von der Seite, aus der er
        // kommt — und ein Angreifer auf dieser Seite gäbe bereits Schach, was
        // die Rochade ohnehin ausschließt.
        let mut probe = board.clone();
        let rook_piece = probe[rank][rook].take();
        let probe_fen = format!(
            "{} {} - - 0 1",
            placement(&probe),
            if color == Color::White { 'w' } else { 'b' }
        );
        if let Ok(probe_board) = Board::from_fen(&probe_fen) {
            let step: i32 = if king_to >= king { 1 } else { -1 };
            let mut file = king as i32;
            loop {
                let square = Coord::from_index((7 - rank) * 8 + file as usize);
                if is_cell_attacked(&probe_board, square, color.inv()) {
                    return None;
                }
                if file == king_to as i32 {
                    break;
                }
                file += step;
            }
        } else {
            // Ohne prüfbare Stellung wird nicht geraten.
            return None;
        }
        let king_piece = board[rank][king].take();
        board[rank][rook] = None;
        board[rank][king_to] = king_piece;
        board[rank][rook_to] = rook_piece;
        let half: u32 = fields[4].parse().unwrap_or(0);
        let full: u32 = fields[5].parse().unwrap_or(1);
        let next = format!(
            "{} {} - - {} {}",
            placement(&board),
            if color == Color::White { 'b' } else { 'w' },
            half + 1,
            if color == Color::White {
                full
            } else {
                full + 1
            }
        );
        let mut rights = self.rights;
        rights.set(color, true, None);
        rights.set(color, false, None);
        Some(Position960 {
            board: Board::from_fen(&next).ok()?,
            rights,
        })
    }

    /// Führt einen Zug in SAN aus · `None`, wenn er in dieser Stellung nicht
    /// geht. Rochaden macht dieses Modul selbst, alles andere owlchess.
    pub fn play_san(&self, san: &str) -> Option<Position960> {
        let plain = san.trim_end_matches(['+', '#', '!', '?']).replace('0', "O");
        if plain == "O-O" || plain == "O-O-O" {
            return self.castle(plain == "O-O");
        }
        let parsed: owlchess::moves::san::Move = san.parse().ok()?;
        let mv = parsed.into_move(&self.board).ok()?;
        Some(self.after(mv))
    }

    /// Dieselbe Stellung nach einem gewöhnlichen Zug · die Rochaderechte
    /// fallen weg, wenn König oder Turm sie verlassen oder geschlagen werden.
    pub fn after(&self, mv: Move) -> Position960 {
        let color = self.side();
        let enemy = color.inv();
        let mut rights = self.rights;
        let from = mv.src();
        let to = mv.dst();
        if self.board.get(from).piece() == Some(Piece::King) {
            rights.set(color, true, None);
            rights.set(color, false, None);
        }
        for (side_color, square) in [(color, from), (enemy, to)] {
            let rank = back_rank(side_color);
            if (7 - square.rank().index()) != rank {
                continue;
            }
            let file = square.file().index() as u8;
            let (kingside, queenside) = rights.side(side_color);
            if kingside == Some(file) {
                rights.set(side_color, true, None);
            }
            if queenside == Some(file) {
                rights.set(side_color, false, None);
            }
        }
        Position960 {
            board: self
                .board
                .make_move(mv)
                .unwrap_or_else(|_| self.board.clone()),
            rights,
        }
    }

    /// Alle Stellungen, die aus dieser mit einem legalen Zug entstehen ·
    /// owlchess erzeugt alles außer der Rochade, die kommt von hier. Gebraucht
    /// wird das für die Perft-Zählung, die dieses Modul gegen Stockfish hält.
    #[cfg(test)]
    pub fn children(&self) -> Vec<Position960> {
        let mut out: Vec<Position960> = owlchess::movegen::legal::gen_all(&self.board)
            .iter()
            .map(|mv| self.after(*mv))
            .collect();
        out.extend(
            [true, false]
                .into_iter()
                .filter_map(|side| self.castle(side)),
        );
        out
    }
}

/// Zählt die Blätter des Zugbaums · nur für die Tests gegen Stockfish.
#[cfg(test)]
fn perft(pos: &Position960, depth: u32) -> u64 {
    let children = pos.children();
    if depth <= 1 {
        return children.len() as u64;
    }
    children.iter().map(|child| perft(child, depth - 1)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dieselben Sollwerte wie vorn in `lib/chess960.test.ts` · sie stammen
    /// aus Stockfish (`go perft 3` mit `UCI_Chess960`).
    #[test]
    fn counts_the_same_moves_as_stockfish() {
        for (fen, nodes) in [
            (
                "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                8902u64,
            ),
            (
                "bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9",
                12189,
            ),
            (
                "2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9",
                18002,
            ),
            (
                "b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9",
                10471,
            ),
            (
                "qbbnnrkr/2pp2pp/p7/1p2pp2/8/P3PP2/1PPP1KPP/QBBNNR1R w hf - 0 9",
                13440,
            ),
            (
                "1rqbkrbn/1ppppp1p/1n6/p1N3p1/8/2P4P/PP1PPPP1/1RQBKRBN w FBfb - 0 9",
                14569,
            ),
            (
                "rbbqn1kr/pp2p1pp/6n1/2pp1p2/2P4P/P7/BP1PPPP1/R1BQNNKR w HAha - 0 9",
                25798,
            ),
            (
                "1rkr3b/1ppn3p/3pB1n1/6q1/R2P4/4N1P1/1P5P/2KRQ1B1 b Dbd - 0 14",
                46468,
            ),
        ] {
            let pos = Position960::from_fen(fen).unwrap();
            assert_eq!(perft(&pos, 3), nodes, "{fen}");
        }
    }

    #[test]
    fn reads_and_writes_castling_fields() {
        let placement_field = "rk2r3/8/8/8/8/8/8/RK2R3";
        assert_eq!(
            parse_rights("KQkq", placement_field),
            parse_rights("EAea", placement_field)
        );
        assert_eq!(
            format_rights(&parse_rights("EAea", placement_field), placement_field),
            "KQkq"
        );
        // Ein innerer Turm steht mit seiner Linie da.
        let inner = "1r1k1r1r/8/8/8/8/8/8/1R1K1R1R";
        assert_eq!(format_rights(&parse_rights("FBfb", inner), inner), "FQfq");
    }

    #[test]
    fn tells_chess960_apart_from_standard() {
        assert!(!needs_chess960(
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        ));
        assert!(needs_chess960(
            "bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9"
        ));
        // Ohne Rechte spielt auch eine 960-Stellung wie Standardschach.
        assert!(!needs_chess960(
            "bqnb1rkr/pppppppp/8/8/8/8/PPPPPPPP/BQNBNRKR w - - 0 1"
        ));
    }

    #[test]
    fn castles_with_the_rook_wherever_it_stands() {
        let pos = Position960::from_fen("1k6/8/8/8/8/8/8/RK2R3 w KQ - 0 1").unwrap();
        let after = pos.play_san("O-O").unwrap();
        assert_eq!(after.fen(), "1k6/8/8/8/8/8/8/R4RK1 b - - 1 1");

        // Lange Rochade derselben Stellung: König b1 nach c1, Turm a1 nach d1
        // · der Turm auf e1 bleibt, wo er steht.
        let long = pos.play_san("O-O-O").unwrap();
        assert_eq!(long.fen(), "1k6/8/8/8/8/8/8/2KRR3 b - - 1 1");
    }

    #[test]
    fn refuses_castling_through_an_attack_the_rook_was_hiding() {
        let pos = Position960::from_fen("1k2r3/8/8/8/8/8/8/RK2R3 w KQ - 0 1").unwrap();
        assert!(pos.play_san("O-O").is_none());
    }

    #[test]
    fn drops_a_right_when_its_rook_moves() {
        let pos = Position960::from_fen("1k6/8/8/8/8/8/8/RK2R3 w KQ - 0 1").unwrap();
        let after = pos.play_san("Re2").unwrap();
        assert_eq!(after.fen().split(' ').nth(2), Some("Q"));
    }
}
