//! Scid-Datenbanken (`.si4`) lesen.
//!
//! LumbrasGigaBase und Caissabase, die verbreitetsten freien Sammlungen, liegen
//! im Format von Scid vor. Bisher führte der Weg nur über einen PGN-Export,
//! und der kostet bei Millionen Partien Stunden und Plattenplatz. Eine
//! Scid-Datenbank sind drei Dateien mit gemeinsamem Namen:
//!
//! - `.si4` · Kopf (182 Bytes) und je Partie ein Indexsatz von 47 Bytes:
//!   Lage der Partie in `.sg4`, Namenskennungen, Datum, Wertungen, ECO.
//! - `.sn4` · die Namen (Spieler, Turniere, Orte, Runden), alphabetisch und
//!   vorn verdichtet (jeder Name teilt sich einen Anfang mit dem vorigen).
//! - `.sg4` · die Partien selbst: Zusatztags, Startstellung, Züge.
//!
//! Alle Zahlen stehen big-endian. Grundlage ist die Formatbeschreibung von
//! Fabrice Garcia (chess-scid-rw, `docs/scid-si4-specification.md`) und der
//! Abgleich mit Scids eigenem Lesecode · übernommen ist daraus kein Code, nur
//! das Format.
//!
//! ## Das Zugformat
//!
//! Ein Zug ist ein Byte: oben die *Nummer* der ziehenden Figur in der Liste
//! ihrer Seite, unten, wohin sie zieht, in einer Kodierung je Figurenart. Nur
//! der diagonale Damenzug braucht ein zweites Byte. Die Figurenliste ist dabei
//! kein fester Plan: Sie beginnt in der Grundstellung als König, a1-Turm,
//! b1-Springer … h1-Turm, a2-Bauer … h2-Bauer, und bei jedem Schlag rückt die
//! Figur mit der höchsten Nummer auf den Platz der geschlagenen. Wer das
//! vergisst, liest nach dem ersten Schlag einer hoch nummerierten Figur
//! lauter falsche, aber legale Züge. Deshalb führt der Leser die Liste genau
//! so mit, wie der Schreiber sie geführt hat, und prüft jeden Zug gegen die
//! legalen Züge der Stellung.

use crate::chess;
use owlchess::movegen::legal;
use owlchess::{Board, Color, Coord, Move, MoveKind, Piece};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const INDEX_MAGIC: &[u8; 8] = b"Scid.si\0";
const NAME_MAGIC: &[u8; 8] = b"Scid.sn\0";
const INDEX_HEADER: usize = 182;
const INDEX_ENTRY: usize = 47;
/// Obergrenze einer Partie in `.sg4` · 17 Bit Länge.
const MAX_GAME_LENGTH: usize = 131_072;

const ENCODE_NAG: u8 = 11;
const ENCODE_COMMENT: u8 = 12;
const ENCODE_START_MARKER: u8 = 13;
const ENCODE_END_MARKER: u8 = 14;
const ENCODE_END_GAME: u8 = 15;

/// Eine gelesene Partie · die Hauptvariante in SAN.
#[derive(Debug, Clone, Default)]
pub struct Si4Game {
    pub white: String,
    pub black: String,
    pub event: String,
    pub site: String,
    pub round: String,
    /// PGN-Datum „2024.03.17", unbekannte Teile als „??".
    pub date: String,
    /// „1-0", „0-1", „1/2-1/2" oder „*".
    pub result: String,
    pub white_elo: i32,
    pub black_elo: i32,
    pub eco: String,
    /// Startstellung, wenn die Partie nicht aus der Grundstellung beginnt.
    pub start_fen: Option<String>,
    pub sans: Vec<String>,
}

/// Gehört die Datei zu einer Scid-Datenbank (Version 4)?
pub fn is_si4(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("si4") | Some("sg4") | Some("sn4")
    )
}

/// Die drei Dateien einer Datenbank · egal, welche davon gewählt wurde.
fn parts(path: &Path) -> (PathBuf, PathBuf, PathBuf) {
    (
        path.with_extension("si4"),
        path.with_extension("sn4"),
        path.with_extension("sg4"),
    )
}

fn be16(b: &[u8]) -> u32 {
    ((b[0] as u32) << 8) | b[1] as u32
}
fn be24(b: &[u8]) -> u32 {
    ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32
}
fn be32(b: &[u8]) -> u32 {
    ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8) | b[3] as u32
}

/// Die Namen der vier Arten · nach Kennung, nicht alphabetisch.
struct Names {
    lists: [Vec<String>; 4],
}

impl Names {
    fn get(&self, kind: usize, id: u32) -> String {
        let name = self.lists[kind]
            .get(id as usize)
            .map(String::as_str)
            .unwrap_or("");
        // Scid schreibt „?" für unbekannt · im PGN heißt das ebenso.
        if name.is_empty() {
            "?".into()
        } else {
            name.to_string()
        }
    }
}

/// Liest die Namensdatei ganz · sie ist auch bei Millionen Partien nur
/// wenige Megabyte groß.
fn read_names(path: &Path) -> Result<Names, String> {
    let data = std::fs::read(path).map_err(|e| format!("Namensdatei nicht lesbar: {e}"))?;
    if data.len() < 36 || &data[..8] != NAME_MAGIC {
        return Err("Keine Scid-Namensdatei (.sn4)".into());
    }
    let mut counts = [0usize; 4];
    let mut max_freq = [0u32; 4];
    for kind in 0..4 {
        counts[kind] = be24(&data[12 + kind * 3..]) as usize;
        max_freq[kind] = be24(&data[24 + kind * 3..]);
    }
    let mut pos = 36usize;
    let mut take = |n: usize| -> Result<&[u8], String> {
        let slice = data
            .get(pos..pos + n)
            .ok_or("Namensdatei ist abgeschnitten")?;
        pos += n;
        Ok(slice)
    };
    let mut lists: [Vec<String>; 4] = Default::default();
    for kind in 0..4 {
        let count = counts[kind];
        let mut by_id = vec![String::new(); count];
        let id_bytes = if count >= 65_536 { 3 } else { 2 };
        let freq_bytes = if max_freq[kind] >= 65_536 {
            3
        } else if max_freq[kind] >= 256 {
            2
        } else {
            1
        };
        let mut previous: Vec<u8> = Vec::new();
        for i in 0..count {
            let raw_id = take(id_bytes)?;
            let id = if id_bytes == 3 {
                be24(raw_id)
            } else {
                be16(raw_id)
            } as usize;
            take(freq_bytes)?;
            let total = take(1)?[0] as usize;
            let prefix = if i == 0 { 0 } else { take(1)?[0] as usize };
            if prefix > total || prefix > previous.len() {
                return Err("Namensdatei ist beschädigt".into());
            }
            let suffix = take(total - prefix)?;
            let mut name = previous[..prefix].to_vec();
            name.extend_from_slice(suffix);
            if let Some(slot) = by_id.get_mut(id) {
                *slot = latin1_or_utf8(&name);
            }
            previous = name;
        }
        lists[kind] = by_id;
    }
    Ok(Names { lists })
}

/// Scid speichert Bytes, wie sie im PGN standen · meist UTF-8, in älteren
/// Sammlungen Latin-1. Was kein gültiges UTF-8 ist, wird als Latin-1 gelesen.
fn latin1_or_utf8(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

fn date_string(date: u32) -> String {
    let year = (date >> 9) & 0x7FF;
    let month = (date >> 5) & 0xF;
    let day = date & 0x1F;
    let part = |v: u32, width: usize| {
        if v == 0 {
            "?".repeat(width)
        } else {
            format!("{v:0width$}")
        }
    };
    format!("{}.{}.{}", part(year, 4), part(month, 2), part(day, 2))
}

fn eco_string(code: u32) -> String {
    if code == 0 {
        return String::new();
    }
    let basic = (code - 1) / 131;
    if basic >= 500 {
        return String::new();
    }
    format!(
        "{}{}{}",
        (b'A' + (basic / 100) as u8) as char,
        (basic % 100) / 10,
        basic % 10
    )
}

fn result_string(code: u32) -> &'static str {
    match code {
        1 => "1-0",
        2 => "0-1",
        3 => "1/2-1/2",
        _ => "*",
    }
}

// ── Züge ─────────────────────────────────────────────────────────────────────

/// Feld in Scids Zählung (a1 = 0, h8 = 63) als owlchess-Koordinate.
fn coord(square: i32) -> Option<Coord> {
    if !(0..64).contains(&square) {
        return None;
    }
    let rank = square / 8;
    let file = square % 8;
    Some(Coord::from_index(((7 - rank) * 8 + file) as usize))
}

/// Umgekehrt · owlchess zählt von a8 an.
fn square(c: Coord) -> i32 {
    ((7 - c.rank().index()) * 8 + c.file().index()) as i32
}

/// Eine Stellung samt den Figurenlisten des Schreibers.
#[derive(Clone)]
struct State {
    board: Board,
    /// Feld je Nummer · Index 0 ist immer der König.
    list: [Vec<i32>; 2],
}

impl State {
    fn from_board(board: Board) -> Self {
        // Aufbau wie Scid ihn beim Lesen einer FEN macht: von der achten Reihe
        // abwärts, je Reihe von a nach h · der König tauscht auf Nummer 0.
        let mut list: [Vec<i32>; 2] = [Vec::new(), Vec::new()];
        for rank in (0..8).rev() {
            for file in 0..8 {
                let sq = rank * 8 + file;
                let cell = board.get(coord(sq).unwrap());
                let (Some(piece), Some(color)) = (cell.piece(), cell.color()) else {
                    continue;
                };
                let side = &mut list[if color == Color::White { 0 } else { 1 }];
                if piece == Piece::King {
                    if side.is_empty() {
                        side.push(sq);
                    } else {
                        let first = side[0];
                        side.push(first);
                        side[0] = sq;
                    }
                } else {
                    side.push(sq);
                }
            }
        }
        Self { board, list }
    }

    fn standard() -> Self {
        let mut white = vec![4, 0, 1, 2, 3, 5, 6, 7];
        white.extend(8..16);
        let mut black = vec![60, 56, 57, 58, 59, 61, 62, 63];
        black.extend(48..56);
        Self {
            board: Board::initial(),
            list: [white, black],
        }
    }

    fn side(&self) -> usize {
        if self.board.side() == Color::White {
            0
        } else {
            1
        }
    }

    /// Liest einen Zug ab `data[*i]` und führt ihn aus · `None` bei einem
    /// Byte, das zu keinem legalen Zug passt.
    fn play(&mut self, data: &[u8], i: &mut usize) -> Option<Move> {
        let byte = *data.get(*i)?;
        *i += 1;
        let side = self.side();
        let index = (byte >> 4) as usize;
        let code = (byte & 0x0F) as i32;
        let from = *self.list[side].get(index)?;
        let piece = self.board.get(coord(from)?).piece()?;
        let white = side == 0;

        let mut castle: Option<MoveKind> = None;
        let mut promo: Option<MoveKind> = None;
        let to: i32 = match piece {
            Piece::Pawn => {
                const DIFF: [i32; 16] = [7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 16];
                promo = match code {
                    3..=5 => Some(MoveKind::PromoteQueen),
                    6..=8 => Some(MoveKind::PromoteRook),
                    9..=11 => Some(MoveKind::PromoteBishop),
                    12..=14 => Some(MoveKind::PromoteKnight),
                    _ => None,
                };
                if white {
                    from + DIFF[code as usize]
                } else {
                    from - DIFF[code as usize]
                }
            }
            Piece::Bishop => {
                let file_diff = (code & 7) - from % 8;
                if code >= 8 {
                    from - 7 * file_diff
                } else {
                    from + 9 * file_diff
                }
            }
            Piece::Knight => {
                const DIFF: [i32; 16] = [0, -17, -15, -10, -6, 6, 10, 15, 17, 0, 0, 0, 0, 0, 0, 0];
                if !(1..=8).contains(&code) {
                    return None;
                }
                from + DIFF[code as usize]
            }
            Piece::Queen if code == from % 8 => {
                // Diagonal · das Ziel steht im nächsten Byte, um 64 versetzt.
                let second = *data.get(*i)? as i32;
                *i += 1;
                second - 64
            }
            Piece::Queen | Piece::Rook => {
                if code >= 8 {
                    (code - 8) * 8 + from % 8
                } else {
                    (from / 8) * 8 + code
                }
            }
            Piece::King => {
                const DIFF: [i32; 9] = [0, -9, -8, -7, -1, 1, 7, 8, 9];
                match code {
                    1..=8 => from + DIFF[code as usize],
                    9 => {
                        castle = Some(MoveKind::CastlingQueenside);
                        from
                    }
                    10 => {
                        castle = Some(MoveKind::CastlingKingside);
                        from
                    }
                    // Nullzug oder unbekannt · beides spielt ein Buch nicht nach.
                    _ => return None,
                }
            }
        };

        let moves = legal::gen_all(&self.board);
        let mv = moves.iter().copied().find(|mv| match castle {
            Some(kind) => mv.kind() == kind,
            None => {
                square(mv.src()) == from
                    && square(mv.dst()) == to
                    && !matches!(
                        mv.kind(),
                        MoveKind::CastlingKingside | MoveKind::CastlingQueenside
                    )
                    && match promo {
                        Some(kind) => mv.kind() == kind,
                        None => !matches!(
                            mv.kind(),
                            MoveKind::PromoteQueen
                                | MoveKind::PromoteRook
                                | MoveKind::PromoteBishop
                                | MoveKind::PromoteKnight
                        ),
                    }
            }
        })?;

        // Die Listen wie beim Schreiber · erst der Schlag, dann der Zug.
        let enemy = 1 - side;
        match mv.kind() {
            MoveKind::CastlingKingside | MoveKind::CastlingQueenside => {
                let rank = from / 8;
                let (king_to, rook_from, rook_to) = if mv.kind() == MoveKind::CastlingKingside {
                    (rank * 8 + 6, rank * 8 + 7, rank * 8 + 5)
                } else {
                    (rank * 8 + 2, rank * 8, rank * 8 + 3)
                };
                self.list[side][0] = king_to;
                if let Some(slot) = self.list[side].iter_mut().find(|sq| **sq == rook_from) {
                    *slot = rook_to;
                }
            }
            kind => {
                let captured = if kind == MoveKind::Enpassant {
                    Some(if white { to - 8 } else { to + 8 })
                } else if self.board.get(mv.dst()).piece().is_some() {
                    Some(to)
                } else {
                    None
                };
                if let Some(sq) = captured {
                    let list = &mut self.list[enemy];
                    if let Some(pos) = list.iter().position(|s| *s == sq) {
                        list.swap_remove(pos);
                    }
                }
                self.list[side][index] = to;
            }
        }
        self.board = self.board.make_move(mv).ok()?;
        Some(mv)
    }
}

/// Überspringt die Zusatztags am Anfang einer Partie · `None`, wenn sie über
/// das Ende hinausreichen.
fn skip_tags(data: &[u8]) -> Option<usize> {
    let mut i = 0usize;
    loop {
        let len = *data.get(i)? as usize;
        i += 1;
        if len == 0 {
            return Some(i);
        }
        // Bis 240 steht der Name ausgeschrieben dahinter, darüber ist es ein
        // häufiger Tag als Nummer. 255 ist das gepackte Turnierdatum aus Scid 2:
        // drei Bytes Wert ohne Längenangabe.
        if len <= 240 {
            i += len;
        }
        let value = if len == 255 {
            3
        } else {
            let n = *data.get(i)? as usize;
            i += 1;
            n
        };
        i += value;
        if i >= data.len() {
            return None;
        }
    }
}

/// Die Hauptvariante einer Partie · Startstellung und Züge in SAN.
///
/// Varianten werden mitgespielt statt übersprungen: Ob ein Byte ein ganzer
/// Zug ist oder die erste Hälfte eines Damenzugs, weiß man erst, wenn man die
/// Stellung kennt, in der er steht.
pub fn decode_game(data: &[u8]) -> Option<(Option<String>, Vec<String>)> {
    let mut i = skip_tags(data)?;
    let flags = *data.get(i)?;
    i += 1;
    let mut start_fen = None;
    let start = if flags & 1 != 0 {
        let end = data[i..].iter().position(|&b| b == 0)? + i;
        let fen = std::str::from_utf8(&data[i..end]).ok()?.trim().to_string();
        i = end + 1;
        let board = Board::from_fen(&fen).ok()?;
        start_fen = Some(fen);
        State::from_board(board)
    } else {
        State::standard()
    };

    // Je Ebene: die Stellung vor dem letzten Zug und die danach. Eine Variante
    // ersetzt den letzten Zug ihrer Ebene und beginnt deshalb vor ihm.
    let mut stack: Vec<(State, State)> = vec![(start.clone(), start)];
    let mut sans = Vec::new();
    loop {
        let byte = *data.get(i)?;
        match byte {
            ENCODE_NAG => i += 2,
            ENCODE_COMMENT => i += 1,
            ENCODE_START_MARKER => {
                i += 1;
                let before = stack.last()?.0.clone();
                stack.push((before.clone(), before));
            }
            ENCODE_END_MARKER => {
                i += 1;
                if stack.len() <= 1 {
                    return None;
                }
                stack.pop();
            }
            ENCODE_END_GAME => {
                return if stack.len() == 1 {
                    Some((start_fen, sans))
                } else {
                    None
                };
            }
            _ => {
                let depth = stack.len();
                let frame = stack.last_mut()?;
                let mut next = frame.1.clone();
                let mv = next.play(data, &mut i)?;
                if depth == 1 {
                    sans.push(chess::canonical_san(&frame.1.board, mv).ok()?);
                }
                frame.0 = std::mem::replace(&mut frame.1, next);
            }
        }
    }
}

// ── Lesen ────────────────────────────────────────────────────────────────────

/// Was eine Datenbank über sich sagt, bevor sie gelesen wird.
pub struct Si4Info {
    pub games: u64,
}

pub fn info(path: &Path) -> Result<Si4Info, String> {
    let (index, _, _) = parts(path);
    let mut head = [0u8; INDEX_HEADER];
    File::open(&index)
        .and_then(|mut f| f.read_exact(&mut head))
        .map_err(|e| format!("Scid-Index nicht lesbar: {e}"))?;
    check_header(&head)?;
    Ok(Si4Info {
        games: be24(&head[14..]) as u64,
    })
}

fn check_header(head: &[u8]) -> Result<(), String> {
    if &head[..8] != INDEX_MAGIC {
        return Err("Keine Scid-Datenbank (.si4)".into());
    }
    let version = be16(&head[8..]);
    if version != 400 {
        return Err(format!(
            "Scid-Datenbank in Version {}.{} · lesbar ist Version 4 (.si4). Neuere Scid-Fassungen (.si5) lassen sich nach PGN exportieren.",
            version / 100,
            version % 100
        ));
    }
    Ok(())
}

/// Liest alle Partien nacheinander · `each` bekommt die Partie oder, wenn sie
/// sich nicht lesen ließ, `None` (dann wird sie gezählt, nicht geraten), und
/// meldet mit `false`, dass aufgehört werden soll.
pub fn for_each_game(
    path: &Path,
    mut each: impl FnMut(u64, Option<Si4Game>) -> bool,
) -> Result<u64, String> {
    let (index_path, names_path, games_path) = parts(path);
    for p in [&index_path, &names_path, &games_path] {
        if !p.exists() {
            return Err(format!(
                "Zur Scid-Datenbank fehlt {} · eine Datenbank sind drei Dateien (.si4, .sn4, .sg4) im selben Ordner.",
                p.file_name().and_then(|n| n.to_str()).unwrap_or("?")
            ));
        }
    }
    let names = read_names(&names_path)?;
    let mut index = BufReader::with_capacity(
        1 << 20,
        File::open(&index_path).map_err(|e| format!("Scid-Index nicht lesbar: {e}"))?,
    );
    let mut head = [0u8; INDEX_HEADER];
    index
        .read_exact(&mut head)
        .map_err(|e| format!("Scid-Index nicht lesbar: {e}"))?;
    check_header(&head)?;
    let total = be24(&head[14..]) as u64;

    let mut games = BufReader::with_capacity(
        1 << 20,
        File::open(&games_path).map_err(|e| format!("Scid-Partien nicht lesbar: {e}"))?,
    );
    let mut games_pos: u64 = 0;
    let mut entry = [0u8; INDEX_ENTRY];
    let mut blob = Vec::with_capacity(4096);

    for n in 0..total {
        if index.read_exact(&mut entry).is_err() {
            break;
        }
        let offset = be32(&entry[0..]) as u64;
        let length = (be16(&entry[4..]) + (((entry[6] as u32) & 0x80) << 9)) as usize;
        let flags = be16(&entry[7..]);
        // Zum Löschen markiert · Scid zeigt sie noch, gemeint sind sie nicht mehr.
        let deleted = flags & 8 != 0;

        let game = if deleted || length == 0 || length > MAX_GAME_LENGTH {
            None
        } else {
            if offset != games_pos {
                games
                    .seek(SeekFrom::Start(offset))
                    .map_err(|e| format!("Scid-Partien nicht lesbar: {e}"))?;
            }
            blob.resize(length, 0);
            let ok = games.read_exact(&mut blob).is_ok();
            games_pos = offset + length as u64;
            if !ok {
                games_pos = u64::MAX;
            }
            if ok {
                decode_game(&blob).map(|(start_fen, sans)| {
                    let white_id = ((entry[9] as u32 >> 4) << 16) | be16(&entry[10..]);
                    let black_id = ((entry[9] as u32 & 0x0F) << 16) | be16(&entry[12..]);
                    let event_id = ((entry[14] as u32 >> 5) << 16) | be16(&entry[15..]);
                    let site_id = (((entry[14] as u32 >> 2) & 7) << 16) | be16(&entry[17..]);
                    let round_id = ((entry[14] as u32 & 3) << 16) | be16(&entry[19..]);
                    let var_counts = be16(&entry[21..]);
                    Si4Game {
                        white: names.get(0, white_id),
                        black: names.get(0, black_id),
                        event: names.get(1, event_id),
                        site: names.get(2, site_id),
                        round: names.get(3, round_id),
                        date: date_string(be32(&entry[25..]) & 0xF_FFFF),
                        result: result_string(var_counts >> 12).into(),
                        white_elo: (be16(&entry[29..]) & 0x0FFF) as i32,
                        black_elo: (be16(&entry[31..]) & 0x0FFF) as i32,
                        eco: eco_string(be16(&entry[23..])),
                        start_fen,
                        sans,
                    }
                })
            } else {
                None
            }
        };
        if !each(n, game) {
            break;
        }
    }
    Ok(total)
}

/// Eine Partie als PGN · für den Import in die eigene Partienliste.
pub fn to_pgn(game: &Si4Game) -> String {
    let mut out = String::new();
    let tag = |out: &mut String, key: &str, value: &str| {
        out.push_str(&format!(
            "[{key} \"{}\"]\n",
            value.replace('\\', "\\\\").replace('"', "\\\"")
        ));
    };
    tag(&mut out, "Event", &game.event);
    tag(&mut out, "Site", &game.site);
    tag(&mut out, "Date", &game.date);
    tag(&mut out, "Round", &game.round);
    tag(&mut out, "White", &game.white);
    tag(&mut out, "Black", &game.black);
    tag(&mut out, "Result", &game.result);
    if game.white_elo > 0 {
        tag(&mut out, "WhiteElo", &game.white_elo.to_string());
    }
    if game.black_elo > 0 {
        tag(&mut out, "BlackElo", &game.black_elo.to_string());
    }
    if !game.eco.is_empty() {
        tag(&mut out, "ECO", &game.eco);
    }
    if let Some(fen) = &game.start_fen {
        tag(&mut out, "SetUp", "1");
        tag(&mut out, "FEN", fen);
    }
    out.push('\n');
    let black_first = game
        .start_fen
        .as_deref()
        .and_then(|f| f.split_whitespace().nth(1))
        == Some("b");
    let first_no: usize = game
        .start_fen
        .as_deref()
        .and_then(|f| f.split_whitespace().nth(5))
        .and_then(|n| n.parse().ok())
        .unwrap_or(1);
    let mut line = String::new();
    for (i, san) in game.sans.iter().enumerate() {
        let ply = i + usize::from(black_first);
        let no = first_no + ply / 2;
        if ply % 2 == 0 {
            line.push_str(&format!("{no}. "));
        } else if i == 0 {
            line.push_str(&format!("{no}... "));
        }
        line.push_str(san);
        line.push(' ');
    }
    line.push_str(&game.result);
    out.push_str(&wrap(&line, 79));
    out.push_str("\n\n");
    out
}

fn wrap(text: &str, width: usize) -> String {
    let mut out = String::new();
    let mut len = 0;
    for word in text.split(' ') {
        if len > 0 && len + 1 + word.len() > width {
            out.push('\n');
            len = 0;
        } else if len > 0 {
            out.push(' ');
            len += 1;
        }
        out.push_str(word);
        len += word.len();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kodiert eine Partie aus der Grundstellung so, wie Scid sie schreibt ·
    /// nur für die Tests, damit sie ohne Fremddatei auskommen.
    fn encode(moves: &[(u8, u8)]) -> Vec<u8> {
        let mut out = vec![0u8, 0u8]; // keine Tags, Flags 0
        for (index, code) in moves {
            out.push((index << 4) | code);
        }
        out.push(ENCODE_END_GAME);
        out
    }

    #[test]
    fn decodes_pawn_and_knight_moves_from_the_start() {
        // 1.e4 (Bauer e2 = Nummer 12, Doppelschritt 15) e5 (Bauer e7 = 12)
        // 2.Nf3 (Springer g1 = 6, +15 → Code 7)
        let data = encode(&[(12, 15), (12, 15), (6, 7)]);
        let (fen, sans) = decode_game(&data).unwrap();
        assert!(fen.is_none());
        assert_eq!(sans, vec!["e4", "e5", "Nf3"]);
    }

    #[test]
    fn renumbers_the_list_after_a_capture() {
        // 1.e4 d5 2.exd5 Qxd5 · danach steht der schwarze h-Bauer (Nummer 15)
        // auf dem Platz des geschlagenen d-Bauern (Nummer 11). 3.Nc3 greift die
        // Dame an, 3...h6 muss deshalb als Nummer 11 kommen.
        let data = encode(&[
            (12, 15), // e4
            (11, 15), // d5
            (12, 0),  // exd5 · weißer Bauer schlägt zur a-Linie hin (+7)
            (4, 12),  // Qxd5 · Dame d8 senkrecht, Code 8 + Reihe (fünfte = 4)
            (2, 8),   // Nc3 · b1 +17
            (11, 1),  // h6 · der h-Bauer, jetzt Nummer 11
        ]);
        let (_, sans) = decode_game(&data).unwrap();
        assert_eq!(sans, vec!["e4", "d5", "exd5", "Qxd5", "Nc3", "h6"]);
    }

    #[test]
    fn follows_a_diagonal_queen_move_over_two_bytes() {
        // 1.e4 e5 2.Qh5 · die Dame d1 zieht diagonal: erstes Byte trägt die
        // eigene Linie (d = 3), das zweite 64 + h5 (= 39).
        let mut data = vec![
            0u8,
            0u8,
            (12 << 4) | 15,
            (12 << 4) | 15,
            (4 << 4) | 3,
            64 + 39,
        ];
        data.push(ENCODE_END_GAME);
        let (_, sans) = decode_game(&data).unwrap();
        assert_eq!(sans, vec!["e4", "e5", "Qh5"]);
    }

    #[test]
    fn plays_variations_without_taking_them_into_the_main_line() {
        // 1.e4 (1.d4 d5) 1...e5
        let data = vec![
            0,
            0,
            (12 << 4) | 15,
            ENCODE_START_MARKER,
            (11 << 4) | 15,
            (11 << 4) | 15,
            ENCODE_END_MARKER,
            ENCODE_NAG,
            1,
            (12 << 4) | 15,
            ENCODE_END_GAME,
        ];
        let (_, sans) = decode_game(&data).unwrap();
        assert_eq!(sans, vec!["e4", "e5"]);
    }

    #[test]
    fn refuses_a_move_that_is_not_legal() {
        // Der Springer b1 kann nicht nach d2 (+11 gibt es nicht) · Code 9 ist leer.
        assert!(decode_game(&encode(&[(2, 9)])).is_none());
    }

    #[test]
    fn skips_extra_tags_including_the_packed_event_date() {
        let mut data = vec![
            243, 3, b'A', b'B', b'C', 255, 1, 2, 3, 5, b'M', b'y', b'T', b'a', b'g', 1, b'x', 0, 0,
        ];
        data.push((12 << 4) | 15);
        data.push(ENCODE_END_GAME);
        let (_, sans) = decode_game(&data).unwrap();
        assert_eq!(sans, vec!["e4"]);
    }

    #[test]
    fn reads_dates_and_eco_codes() {
        assert_eq!(date_string((2024 << 9) | (3 << 5) | 17), "2024.03.17");
        assert_eq!(date_string(1998 << 9), "1998.??.??");
        assert_eq!(eco_string(1), "A00");
        // C42 = (2 * 100 + 42) * 131 + 1
        assert_eq!(eco_string((242 * 131) + 1), "C42");
    }

    /// Validierungslauf gegen eine echte Scid-Datenbank:
    /// `KIEBITZ_SI4=…/chess_database.si4 cargo test si4::tests::reads_a_real_database -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn reads_a_real_database() {
        let path = std::env::var("KIEBITZ_SI4").expect("KIEBITZ_SI4 setzen");
        let mut ok = 0u64;
        let mut failed = Vec::new();
        let mut plies = 0usize;
        let total = for_each_game(Path::new(&path), |n, game| {
            match game {
                Some(g) => {
                    ok += 1;
                    plies += g.sans.len();
                    if n < 3 {
                        println!("{}", to_pgn(&g));
                    }
                }
                None => failed.push(n),
            }
            true
        })
        .unwrap();
        println!(
            "{ok} von {total} Partien gelesen, {plies} Halbzüge, nicht lesbar: {:?}",
            &failed[..failed.len().min(20)]
        );
        assert!(failed.is_empty());
    }
}
