//! ChessBase-Datenbanken (`.cbh`) lesen.
//!
//! Eine ChessBase-Datenbank ist kein einzelnes Dateiformat, sondern ein Dutzend
//! Dateien mit gemeinsamem Namen. Für die Partien selbst genügen vier:
//!
//! - `.cbh` · je Partie ein Kopfsatz von 46 Bytes (der erste Satz ist der
//!   Dateikopf): Lage der Partie in `.cbg`, Spieler, Turnier, Datum, Ergebnis,
//!   Wertungen.
//! - `.cbg` · die Züge.
//! - `.cbp` · die Spieler, Sätze von 67 Bytes.
//! - `.cbt` · die Turniere, Sätze von 99 Bytes.
//!
//! Das Format ist nicht offengelegt. Die Kenntnis darüber stammt aus der
//! Rückentwicklung von Jimmy Mårdell („Yarin", 2009) und aus **cbh2pgn** von
//! Dominik Klein (MIT, <https://github.com/asdfjkl/cbh2pgn>). Die Zugtabellen
//! und die Entschleierung unten sind aus cbh2pgn übertragen; der
//! Lizenztext liegt unter `scripts/ported-licenses/cbh2pgn/LICENSE` und
//! wird mit der App ausgeliefert (THIRD_PARTY_LICENSES.txt).
//!
//! ## Das Zugformat
//!
//! Jeder Zug ist ein Byte, das die ziehende Figur *und* ihren Weg nennt: „der
//! zweite weiße Springer, zwei nach rechts, eins nach oben". Figuren werden je
//! Art durchgezählt; wird die zweite Dame geschlagen, rückt die dritte nach.
//! Das Byte ist zusätzlich verschleiert: Vom gespeicherten Wert wird die Zahl
//! der bisher gelesenen Züge abgezogen. Nur die ersten drei Figuren einer Art
//! haben Einbyte-Züge; Umwandlungen und die vierte Dame stehen als
//! Zweibyte-Zug mit Herkunft und Ziel.
//!
//! Wie bei `.si4` prüft jeder gelesene Zug sich gegen die legalen Züge der
//! Stellung. Eine Partie, in der das nicht aufgeht, wird verworfen und nicht
//! geraten. Chess960 und Partien mit einer zweiten, unbekannten
//! Verschleierung lässt der Leser aus.

use crate::chess;
use owlchess::movegen::legal;
use owlchess::{Board, Color, Coord, Move, MoveKind, Piece};
use std::path::{Path, PathBuf};

/// Gehört diese Datei zu einer ChessBase-Datenbank?
pub fn is_chessbase(path: &Path) -> bool {
    matches!(extension(path).as_str(), "cbh" | "cbv" | "cbf" | "cbg")
}

/// Lesbar sind die offenen Datenbanken (`.cbh`) · das Archiv `.cbv` ist
/// gepackt, das alte `.cbf` ein anderes Format.
pub fn unsupported_hint(path: &Path) -> Option<&'static str> {
    match extension(path).as_str() {
        "cbv" => Some("ChessBase-Archive (.cbv) sind gepackt · in ChessBase entpacken („Datenbank wiederherstellen“) und dann die .cbh-Datei wählen."),
        "cbf" => Some("Das alte ChessBase-Format (.cbf) kann Kiebitz nicht lesen · in ChessBase nach PGN exportieren."),
        _ => None,
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Eine gelesene Partie · dieselbe Form wie beim Scid-Leser.
pub type CbhGame = crate::si4::Si4Game;

// ── Kopf, Spieler, Turniere ──────────────────────────────────────────────────

const RECORD: usize = 46;

fn be24(b: &[u8]) -> u32 {
    ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32
}
fn be16(b: &[u8]) -> u32 {
    ((b[0] as u32) << 8) | b[1] as u32
}
fn be32(b: &[u8]) -> u32 {
    ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8) | b[3] as u32
}

/// ChessBase schreibt Windows-1252 · UTF-8 kommt in neueren Dateien vor.
fn text(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let raw = &bytes[..end];
    match std::str::from_utf8(raw) {
        Ok(s) => s.trim().to_string(),
        Err(_) => raw
            .iter()
            .map(|&b| b as char)
            .collect::<String>()
            .trim()
            .to_string(),
    }
}

/// Satzanfang in `.cbp`/`.cbt` · der Dateikopf ist je nach Version 28 oder 32
/// Bytes lang, das Versionsbyte steht an Stelle 0x18.
fn table_start(data: &[u8]) -> Option<usize> {
    match data.get(0x18)? {
        4 => Some(32),
        0 => Some(28),
        _ => None,
    }
}

fn player(data: &[u8], id: u32) -> String {
    let Some(start) = table_start(data) else {
        return "?".into();
    };
    let at = start + id as usize * 67;
    let (Some(last), Some(first)) = (data.get(at + 9..at + 39), data.get(at + 39..at + 59)) else {
        return "?".into();
    };
    let (last, first) = (text(last), text(first));
    match (last.is_empty(), first.is_empty()) {
        (true, true) => "?".into(),
        (false, true) => last,
        (true, false) => first,
        (false, false) => format!("{last}, {first}"),
    }
}

fn tournament(data: &[u8], id: u32) -> (String, String) {
    let Some(start) = table_start(data) else {
        return ("?".into(), "?".into());
    };
    let at = start + id as usize * 99;
    let title = data.get(at + 9..at + 49).map(text).unwrap_or_default();
    let place = data.get(at + 49..at + 79).map(text).unwrap_or_default();
    let or_unknown = |s: String| if s.is_empty() { "?".to_string() } else { s };
    (or_unknown(title), or_unknown(place))
}

fn date_string(packed: u32) -> String {
    let year = (packed >> 9) & 0x7FFF;
    let month = (packed >> 5) & 0xF;
    let day = packed & 0x1F;
    let part = |v: u32, width: usize| {
        if v == 0 {
            "?".repeat(width)
        } else {
            format!("{v:0width$}")
        }
    };
    format!("{}.{}.{}", part(year, 4), part(month, 2), part(day, 2))
}

fn result_string(code: u8) -> &'static str {
    match code {
        2 => "1-0",
        1 => "1/2-1/2",
        0 => "0-1",
        _ => "*",
    }
}

// ── Züge ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    King,
    Queen,
    Rook,
    Bishop,
    Knight,
    Pawn,
}

impl Kind {
    fn of(piece: Piece) -> Self {
        match piece {
            Piece::King => Kind::King,
            Piece::Queen => Kind::Queen,
            Piece::Rook => Kind::Rook,
            Piece::Bishop => Kind::Bishop,
            Piece::Knight => Kind::Knight,
            Piece::Pawn => Kind::Pawn,
        }
    }
    fn slot(self) -> usize {
        self as usize
    }
}

/// Einbyte-Züge: Byte → (Figurenart, laufende Nummer, Weg in x/y). Die Wege
/// rechnen modulo 8 · (7, 1) heißt „eins nach links, eins nach oben".
/// Übertragen aus cbh2pgn (MIT, Dominik Klein).
#[rustfmt::skip]
const MOVES: &[(u8, Kind, u8, i8, i8)] = &[
    // König · 0x76 und 0xB5 sind die Rochaden.
    (0x49, Kind::King, 0, 0, 1), (0x39, Kind::King, 0, 1, 1), (0xD8, Kind::King, 0, 1, 0),
    (0x5D, Kind::King, 0, 1, 7), (0xC2, Kind::King, 0, 0, 7), (0xB1, Kind::King, 0, 7, 7),
    (0xB2, Kind::King, 0, 7, 0), (0x47, Kind::King, 0, 7, 1), (0x76, Kind::King, 0, 2, 0),
    (0xB5, Kind::King, 0, -2, 0),
    // Erste Dame
    (0xA5, Kind::Queen, 0, 0, 1), (0xB8, Kind::Queen, 0, 0, 2), (0xCB, Kind::Queen, 0, 0, 3),
    (0x53, Kind::Queen, 0, 0, 4), (0x7F, Kind::Queen, 0, 0, 5), (0x6B, Kind::Queen, 0, 0, 6),
    (0x8D, Kind::Queen, 0, 0, 7), (0x79, Kind::Queen, 0, 1, 0), (0xBE, Kind::Queen, 0, 2, 0),
    (0xEB, Kind::Queen, 0, 3, 0), (0x21, Kind::Queen, 0, 4, 0), (0x99, Kind::Queen, 0, 5, 0),
    (0xD2, Kind::Queen, 0, 6, 0), (0x57, Kind::Queen, 0, 7, 0), (0x4D, Kind::Queen, 0, 1, 1),
    (0xB4, Kind::Queen, 0, 2, 2), (0xBF, Kind::Queen, 0, 3, 3), (0x62, Kind::Queen, 0, 4, 4),
    (0xBD, Kind::Queen, 0, 5, 5), (0x24, Kind::Queen, 0, 6, 6), (0x96, Kind::Queen, 0, 7, 7),
    (0xA7, Kind::Queen, 0, 1, 7), (0x48, Kind::Queen, 0, 2, 6), (0x28, Kind::Queen, 0, 3, 5),
    (0x6E, Kind::Queen, 0, 4, 4), (0x2F, Kind::Queen, 0, 5, 3), (0x5A, Kind::Queen, 0, 6, 2),
    (0x18, Kind::Queen, 0, 7, 1),
    // Zweite Dame
    (0xE5, Kind::Queen, 1, 0, 1), (0x94, Kind::Queen, 1, 0, 2), (0x50, Kind::Queen, 1, 0, 3),
    (0x11, Kind::Queen, 1, 0, 4), (0xEA, Kind::Queen, 1, 0, 5), (0x31, Kind::Queen, 1, 0, 6),
    (0x01, Kind::Queen, 1, 0, 7), (0x5C, Kind::Queen, 1, 1, 0), (0x95, Kind::Queen, 1, 2, 0),
    (0xCA, Kind::Queen, 1, 3, 0), (0xD3, Kind::Queen, 1, 4, 0), (0x1D, Kind::Queen, 1, 5, 0),
    (0x7E, Kind::Queen, 1, 6, 0), (0xEF, Kind::Queen, 1, 7, 0), (0x44, Kind::Queen, 1, 1, 1),
    (0x80, Kind::Queen, 1, 2, 2), (0xA0, Kind::Queen, 1, 3, 3), (0x1F, Kind::Queen, 1, 4, 4),
    (0x83, Kind::Queen, 1, 5, 5), (0x00, Kind::Queen, 1, 6, 6), (0x4B, Kind::Queen, 1, 7, 7),
    (0x67, Kind::Queen, 1, 1, 7), (0x20, Kind::Queen, 1, 2, 6), (0x5B, Kind::Queen, 1, 3, 5),
    (0x2A, Kind::Queen, 1, 4, 4), (0x92, Kind::Queen, 1, 5, 3), (0xB6, Kind::Queen, 1, 6, 2),
    (0x60, Kind::Queen, 1, 7, 1),
    // Dritte Dame
    (0x1A, Kind::Queen, 2, 0, 1), (0x42, Kind::Queen, 2, 0, 2), (0x0F, Kind::Queen, 2, 0, 3),
    (0x0D, Kind::Queen, 2, 0, 4), (0xB0, Kind::Queen, 2, 0, 5), (0xD1, Kind::Queen, 2, 0, 6),
    (0x23, Kind::Queen, 2, 0, 7), (0xF0, Kind::Queen, 2, 1, 0), (0x7A, Kind::Queen, 2, 2, 0),
    (0x54, Kind::Queen, 2, 3, 0), (0x4F, Kind::Queen, 2, 4, 0), (0xF4, Kind::Queen, 2, 5, 0),
    (0xA8, Kind::Queen, 2, 6, 0), (0x72, Kind::Queen, 2, 7, 0), (0xE7, Kind::Queen, 2, 1, 1),
    (0x40, Kind::Queen, 2, 2, 2), (0x38, Kind::Queen, 2, 3, 3), (0x59, Kind::Queen, 2, 4, 4),
    (0x87, Kind::Queen, 2, 5, 5), (0xE8, Kind::Queen, 2, 6, 6), (0x6C, Kind::Queen, 2, 7, 7),
    (0x86, Kind::Queen, 2, 1, 7), (0x04, Kind::Queen, 2, 2, 6), (0xF1, Kind::Queen, 2, 3, 5),
    (0x8C, Kind::Queen, 2, 4, 4), (0xCE, Kind::Queen, 2, 5, 3), (0x6A, Kind::Queen, 2, 6, 2),
    (0xDB, Kind::Queen, 2, 7, 1),
    // Türme
    (0x4E, Kind::Rook, 0, 0, 1), (0xF8, Kind::Rook, 0, 0, 2), (0x43, Kind::Rook, 0, 0, 3),
    (0xD7, Kind::Rook, 0, 0, 4), (0x63, Kind::Rook, 0, 0, 5), (0x9C, Kind::Rook, 0, 0, 6),
    (0xE6, Kind::Rook, 0, 0, 7), (0x2E, Kind::Rook, 0, 1, 0), (0xC6, Kind::Rook, 0, 2, 0),
    (0x26, Kind::Rook, 0, 3, 0), (0x88, Kind::Rook, 0, 4, 0), (0x30, Kind::Rook, 0, 5, 0),
    (0x61, Kind::Rook, 0, 6, 0), (0x6F, Kind::Rook, 0, 7, 0),
    (0x14, Kind::Rook, 1, 0, 1), (0xA9, Kind::Rook, 1, 0, 2), (0x68, Kind::Rook, 1, 0, 3),
    (0xEE, Kind::Rook, 1, 0, 4), (0xFB, Kind::Rook, 1, 0, 5), (0x77, Kind::Rook, 1, 0, 6),
    (0xE2, Kind::Rook, 1, 0, 7), (0xA6, Kind::Rook, 1, 1, 0), (0x05, Kind::Rook, 1, 2, 0),
    (0x8B, Kind::Rook, 1, 3, 0), (0xA1, Kind::Rook, 1, 4, 0), (0x98, Kind::Rook, 1, 5, 0),
    (0x32, Kind::Rook, 1, 6, 0), (0x52, Kind::Rook, 1, 7, 0),
    (0x81, Kind::Rook, 2, 0, 1), (0x82, Kind::Rook, 2, 0, 2), (0x9A, Kind::Rook, 2, 0, 3),
    (0x1B, Kind::Rook, 2, 0, 4), (0x9D, Kind::Rook, 2, 0, 5), (0x0A, Kind::Rook, 2, 0, 6),
    (0x2B, Kind::Rook, 2, 0, 7), (0x8F, Kind::Rook, 2, 1, 0), (0xCD, Kind::Rook, 2, 2, 0),
    (0xED, Kind::Rook, 2, 3, 0), (0x10, Kind::Rook, 2, 4, 0), (0x74, Kind::Rook, 2, 5, 0),
    (0x69, Kind::Rook, 2, 6, 0), (0xD6, Kind::Rook, 2, 7, 0),
    // Läufer
    (0x02, Kind::Bishop, 0, 1, 1), (0x97, Kind::Bishop, 0, 2, 2), (0xE1, Kind::Bishop, 0, 3, 3),
    (0x41, Kind::Bishop, 0, 4, 4), (0xC3, Kind::Bishop, 0, 5, 5), (0x7C, Kind::Bishop, 0, 6, 6),
    (0xE4, Kind::Bishop, 0, 7, 7), (0x06, Kind::Bishop, 0, 1, 7), (0xB7, Kind::Bishop, 0, 2, 6),
    (0x55, Kind::Bishop, 0, 3, 5), (0xD9, Kind::Bishop, 0, 4, 4), (0x2C, Kind::Bishop, 0, 5, 3),
    (0xAE, Kind::Bishop, 0, 6, 2), (0x37, Kind::Bishop, 0, 7, 1),
    (0xF6, Kind::Bishop, 1, 1, 1), (0x3F, Kind::Bishop, 1, 2, 2), (0x08, Kind::Bishop, 1, 3, 3),
    (0x93, Kind::Bishop, 1, 4, 4), (0x73, Kind::Bishop, 1, 5, 5), (0x5E, Kind::Bishop, 1, 6, 6),
    (0x78, Kind::Bishop, 1, 7, 7), (0x35, Kind::Bishop, 1, 1, 7), (0xF2, Kind::Bishop, 1, 2, 6),
    (0x6D, Kind::Bishop, 1, 3, 5), (0x71, Kind::Bishop, 1, 4, 4), (0xA2, Kind::Bishop, 1, 5, 3),
    (0xF3, Kind::Bishop, 1, 6, 2), (0x16, Kind::Bishop, 1, 7, 1),
    (0x51, Kind::Bishop, 2, 1, 1), (0xB9, Kind::Bishop, 2, 2, 2), (0x45, Kind::Bishop, 2, 3, 3),
    (0x3B, Kind::Bishop, 2, 4, 4), (0x56, Kind::Bishop, 2, 5, 5), (0x91, Kind::Bishop, 2, 6, 6),
    (0xFD, Kind::Bishop, 2, 7, 7), (0xAB, Kind::Bishop, 2, 1, 7), (0x66, Kind::Bishop, 2, 2, 6),
    (0x3E, Kind::Bishop, 2, 3, 5), (0x46, Kind::Bishop, 2, 4, 4), (0xB3, Kind::Bishop, 2, 5, 3),
    (0xFC, Kind::Bishop, 2, 6, 2), (0xC8, Kind::Bishop, 2, 7, 1),
    // Springer
    (0x58, Kind::Knight, 0, 2, 1), (0x3D, Kind::Knight, 0, 1, 2), (0xFA, Kind::Knight, 0, -1, 2),
    (0xE9, Kind::Knight, 0, -2, 1), (0xBA, Kind::Knight, 0, -2, -1), (0xD4, Kind::Knight, 0, -1, -2),
    (0xDD, Kind::Knight, 0, 1, -2), (0x4A, Kind::Knight, 0, 2, -1),
    (0xC4, Kind::Knight, 1, 2, 1), (0x0E, Kind::Knight, 1, 1, 2), (0xFE, Kind::Knight, 1, -1, 2),
    (0x5F, Kind::Knight, 1, -2, 1), (0x75, Kind::Knight, 1, -2, -1), (0x07, Kind::Knight, 1, -1, -2),
    (0x89, Kind::Knight, 1, 1, -2), (0x34, Kind::Knight, 1, 2, -1),
    (0x9B, Kind::Knight, 2, 2, 1), (0xC0, Kind::Knight, 2, 1, 2), (0xE3, Kind::Knight, 2, -1, 2),
    (0xA3, Kind::Knight, 2, -2, 1), (0xAC, Kind::Knight, 2, -2, -1), (0xC9, Kind::Knight, 2, -1, -2),
    (0xEC, Kind::Knight, 2, 1, -2), (0x27, Kind::Knight, 2, 2, -1),
    // Bauern · nach Nummer, nicht nach Linie; aus Sicht der eigenen Farbe.
    (0x2D, Kind::Pawn, 0, 0, 1), (0xC1, Kind::Pawn, 0, 0, 2), (0x8E, Kind::Pawn, 0, 1, 1), (0xF5, Kind::Pawn, 0, -1, 1),
    (0x64, Kind::Pawn, 1, 0, 1), (0x17, Kind::Pawn, 1, 0, 2), (0x70, Kind::Pawn, 1, 1, 1), (0xA4, Kind::Pawn, 1, -1, 1),
    (0x7B, Kind::Pawn, 2, 0, 1), (0xDA, Kind::Pawn, 2, 0, 2), (0xE0, Kind::Pawn, 2, 1, 1), (0x85, Kind::Pawn, 2, -1, 1),
    (0xC5, Kind::Pawn, 3, 0, 1), (0x0B, Kind::Pawn, 3, 0, 2), (0x90, Kind::Pawn, 3, 1, 1), (0xF9, Kind::Pawn, 3, -1, 1),
    (0x84, Kind::Pawn, 4, 0, 1), (0xFF, Kind::Pawn, 4, 0, 2), (0x15, Kind::Pawn, 4, 1, 1), (0x36, Kind::Pawn, 4, -1, 1),
    (0x09, Kind::Pawn, 5, 0, 1), (0x9E, Kind::Pawn, 5, 0, 2), (0x7D, Kind::Pawn, 5, 1, 1), (0xDE, Kind::Pawn, 5, -1, 1),
    (0xBB, Kind::Pawn, 6, 0, 1), (0xDF, Kind::Pawn, 6, 0, 2), (0xBC, Kind::Pawn, 6, 1, 1), (0x3A, Kind::Pawn, 6, -1, 1),
    (0x12, Kind::Pawn, 7, 0, 1), (0x33, Kind::Pawn, 7, 0, 2), (0x13, Kind::Pawn, 7, 1, 1), (0x19, Kind::Pawn, 7, -1, 1),
];

/// Entschleierung der Bytes eines Zweibyte-Zugs · aus cbh2pgn (MIT).
#[rustfmt::skip]
const DEOBFUSCATE_2B: [u8; 256] = [
    0xA2, 0x95, 0x43, 0xF5, 0xC1, 0x3D, 0x4A, 0x6C, 0x53, 0x83, 0xCC, 0x7C, 0xFF, 0xAE, 0x68, 0xAD,
    0xD1, 0x92, 0x8B, 0x8D, 0x35, 0x81, 0x5E, 0x74, 0x26, 0x8E, 0xAB, 0xCA, 0xFD, 0x9A, 0xF3, 0xA0,
    0xA5, 0x15, 0xFC, 0xB1, 0x1E, 0xED, 0x30, 0xEA, 0x22, 0xEB, 0xA7, 0xCD, 0x4E, 0x6F, 0x2E, 0x24,
    0x32, 0x94, 0x41, 0x8C, 0x6E, 0x58, 0x82, 0x50, 0xBB, 0x02, 0x8A, 0xD8, 0xFA, 0x60, 0xDE, 0x52,
    0xBA, 0x46, 0xAC, 0x29, 0x9D, 0xD7, 0xDF, 0x08, 0x21, 0x01, 0x66, 0xA3, 0xF1, 0x19, 0x27, 0xB5,
    0x91, 0xD5, 0x42, 0x0E, 0xB4, 0x4C, 0xD9, 0x18, 0x5F, 0xBC, 0x25, 0xA6, 0x96, 0x04, 0x56, 0x6A,
    0xAA, 0x33, 0x1C, 0x2B, 0x73, 0xF0, 0xDD, 0xA4, 0x37, 0xD3, 0xC5, 0x10, 0xBF, 0x5A, 0x23, 0x34,
    0x75, 0x5B, 0xB8, 0x55, 0xD2, 0x6B, 0x09, 0x3A, 0x57, 0x12, 0xB3, 0x77, 0x48, 0x85, 0x9B, 0x0F,
    0x9E, 0xC7, 0xC8, 0xA1, 0x7F, 0x7A, 0xC0, 0xBD, 0x31, 0x6D, 0xF6, 0x3E, 0xC3, 0x11, 0x71, 0xCE,
    0x7D, 0xDA, 0xA8, 0x54, 0x90, 0x97, 0x1F, 0x44, 0x40, 0x16, 0xC9, 0xE3, 0x2C, 0xCB, 0x84, 0xEC,
    0x9F, 0x3F, 0x5C, 0xE6, 0x76, 0x0B, 0x3C, 0x20, 0xB7, 0x36, 0x00, 0xDC, 0xE7, 0xF9, 0x4F, 0xF7,
    0xAF, 0x06, 0x07, 0xE0, 0x1A, 0x0A, 0xA9, 0x4B, 0x0C, 0xD6, 0x63, 0x87, 0x89, 0x1D, 0x13, 0x1B,
    0xE4, 0x70, 0x05, 0x47, 0x67, 0x7B, 0x2F, 0xEE, 0xE2, 0xE8, 0x98, 0x0D, 0xEF, 0xCF, 0xC4, 0xF4,
    0xFB, 0xB0, 0x17, 0x99, 0x64, 0xF2, 0xD4, 0x2A, 0x03, 0x4D, 0x78, 0xC6, 0xFE, 0x65, 0x86, 0x88,
    0x79, 0x45, 0x3B, 0xE5, 0x49, 0x8F, 0x2D, 0xB9, 0xBE, 0x62, 0x93, 0x14, 0xE9, 0xD0, 0x38, 0x9C,
    0xB2, 0xC2, 0x59, 0x5D, 0xB6, 0x72, 0x51, 0xF8, 0x28, 0x7E, 0x61, 0x39, 0xE1, 0xDB, 0x69, 0x80,
];

const TWO_BYTE: u8 = 0x29;
const VARIATION_START: u8 = 0xDC;
const VARIATION_END: u8 = 0x0C;
const FILLER: u8 = 0x9F;
const NULL_MOVE: u8 = 0xAA;

/// Ein Einbyte-Zug: Figurenart, laufende Nummer, Weg in x und y.
type OneByteMove = (Kind, u8, i8, i8);

/// Tabelle Byte → Einbyte-Zug · einmal gebaut statt bei jedem Zug gesucht.
fn move_table() -> &'static [Option<OneByteMove>; 256] {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[Option<OneByteMove>; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [None; 256];
        for &(byte, kind, nr, dx, dy) in MOVES {
            table[byte as usize] = Some((kind, nr, dx, dy));
        }
        table
    })
}

/// Feld als (Linie, Reihe), beide 0 … 7.
type Sq = (i8, i8);

fn coord((x, y): Sq) -> Coord {
    Coord::from_index(((7 - y) as usize) * 8 + x as usize)
}

/// Stellung samt der Nummerierung, die ChessBase führt.
#[derive(Clone)]
struct State {
    board: Board,
    /// Je Farbe und Art die Felder in Nummernfolge · `None` ist frei.
    lists: [[Vec<Option<Sq>>; 6]; 2],
    /// Wer auf einem Feld steht, als (Farbe, Art, Nummer).
    grid: [[Option<(usize, Kind, u8)>; 8]; 8],
}

impl State {
    fn empty(board: Board) -> Self {
        Self {
            board,
            lists: Default::default(),
            grid: [[None; 8]; 8],
        }
    }

    fn put(&mut self, color: usize, kind: Kind, sq: Sq) {
        let list = &mut self.lists[color][kind.slot()];
        let nr = match list.iter().position(Option::is_none) {
            Some(free) => {
                list[free] = Some(sq);
                free
            }
            None => {
                list.push(Some(sq));
                list.len() - 1
            }
        };
        self.grid[sq.0 as usize][sq.1 as usize] = Some((color, kind, nr as u8));
    }

    /// Aus einer Stellung · die Nummern in der Reihenfolge a1, a2 … a8, b1 …,
    /// in der ChessBase eine Aufstellung speichert.
    fn from_board(board: Board) -> Self {
        let mut state = Self::empty(board.clone());
        for x in 0..8 {
            for y in 0..8 {
                let cell = board.get(coord((x, y)));
                if let (Some(piece), Some(color)) = (cell.piece(), cell.color()) {
                    state.put(
                        if color == Color::White { 0 } else { 1 },
                        Kind::of(piece),
                        (x, y),
                    );
                }
            }
        }
        state
    }

    /// Eine Figur verlässt das Brett · bei Figuren (nicht Bauern, nicht König)
    /// rücken die höheren Nummern ihrer Art nach.
    fn remove(&mut self, sq: Sq) {
        let Some((color, kind, nr)) = self.grid[sq.0 as usize][sq.1 as usize].take() else {
            return;
        };
        let list = &mut self.lists[color][kind.slot()];
        if matches!(kind, Kind::Pawn | Kind::King) {
            // Bauern behalten ihre Nummern; der Platz bleibt einfach leer.
            if let Some(slot) = list.get_mut(nr as usize) {
                *slot = None;
            }
            return;
        }
        let nr = nr as usize;
        if nr < list.len() {
            list.remove(nr);
            list.push(None);
        }
        for (i, entry) in list.iter().enumerate().skip(nr) {
            if let Some((x, y)) = entry {
                if let Some(cell) = self.grid[*x as usize][*y as usize].as_mut() {
                    cell.2 = i as u8;
                }
            }
        }
    }

    fn relocate(&mut self, from: Sq, to: Sq) {
        if let Some((color, kind, nr)) = self.grid[from.0 as usize][from.1 as usize].take() {
            self.lists[color][kind.slot()][nr as usize] = Some(to);
            self.grid[to.0 as usize][to.1 as usize] = Some((color, kind, nr));
        }
    }

    fn side(&self) -> usize {
        if self.board.side() == Color::White {
            0
        } else {
            1
        }
    }

    /// Führt einen gefundenen legalen Zug aus und hält die Nummern mit.
    fn apply(&mut self, mv: Move, from: Sq, to: Sq) -> Option<()> {
        let side = self.side();
        match mv.kind() {
            MoveKind::CastlingKingside | MoveKind::CastlingQueenside => {
                let y = from.1;
                let (rook_from, rook_to) = if mv.kind() == MoveKind::CastlingKingside {
                    ((7, y), (5, y))
                } else {
                    ((0, y), (3, y))
                };
                self.relocate(from, to);
                self.relocate(rook_from, rook_to);
            }
            MoveKind::Enpassant => {
                self.remove((to.0, from.1));
                self.relocate(from, to);
            }
            kind => {
                self.remove(to);
                let promoted = match kind {
                    MoveKind::PromoteQueen => Some(Kind::Queen),
                    MoveKind::PromoteRook => Some(Kind::Rook),
                    MoveKind::PromoteBishop => Some(Kind::Bishop),
                    MoveKind::PromoteKnight => Some(Kind::Knight),
                    _ => None,
                };
                match promoted {
                    Some(new_kind) => {
                        self.remove(from);
                        self.put(side, new_kind, to);
                    }
                    None => self.relocate(from, to),
                }
            }
        }
        self.board = self.board.make_move(mv).ok()?;
        Some(())
    }

    /// Den legalen Zug zu Herkunft, Ziel und Umwandlung suchen.
    ///
    /// Ein Bauer, der ohne Angabe die letzte Reihe erreicht, wird zur Dame ·
    /// ChessBase schreibt Umwandlungen sonst als Zweibyte-Zug mit Figur.
    fn find(
        &self,
        from: Sq,
        to: Sq,
        promo: Option<MoveKind>,
        castle: Option<MoveKind>,
    ) -> Option<Move> {
        let (src, dst) = (coord(from), coord(to));
        let moves = legal::gen_all(&self.board);
        let is_promotion = |kind: MoveKind| {
            matches!(
                kind,
                MoveKind::PromoteQueen
                    | MoveKind::PromoteRook
                    | MoveKind::PromoteBishop
                    | MoveKind::PromoteKnight
            )
        };
        let is_castle = |kind: MoveKind| {
            matches!(
                kind,
                MoveKind::CastlingKingside | MoveKind::CastlingQueenside
            )
        };
        if let Some(kind) = castle {
            return moves.iter().copied().find(|mv| mv.kind() == kind);
        }
        let candidates = || {
            moves
                .iter()
                .copied()
                .filter(move |mv| mv.src() == src && mv.dst() == dst && !is_castle(mv.kind()))
        };
        match promo {
            Some(kind) => candidates().find(|mv| mv.kind() == kind),
            None => candidates()
                .find(|mv| !is_promotion(mv.kind()))
                .or_else(|| candidates().find(|mv| mv.kind() == MoveKind::PromoteQueen)),
        }
    }

    /// Ein Einbyte-Zug · Art und Nummer sagen, wer zieht.
    fn one_byte(&mut self, token: u8) -> Option<Move> {
        let (kind, nr, dx, dy) = move_table()[token as usize]?;
        let side = self.side();
        let from = (*self.lists[side][kind.slot()].get(nr as usize)?)?;
        let (dx, dy) = if kind == Kind::Pawn && side == 1 {
            (-dx, -dy)
        } else {
            (dx, dy)
        };
        let castle = match (kind, dx) {
            (Kind::King, 2) => Some(MoveKind::CastlingKingside),
            (Kind::King, -2) => Some(MoveKind::CastlingQueenside),
            _ => None,
        };
        let to = ((from.0 + dx).rem_euclid(8), (from.1 + dy).rem_euclid(8));
        let to = if castle.is_some() {
            (if dx > 0 { 6 } else { 2 }, from.1)
        } else {
            to
        };
        let mv = self.find(from, to, None, castle)?;
        self.apply(mv, from, to)?;
        Some(mv)
    }

    /// Ein Zweibyte-Zug · Herkunft und Ziel als Feldnummer (a1 = 0, a2 = 1 …).
    fn two_byte(&mut self, value: u16) -> Option<Move> {
        let src = (value & 0x3F) as i8;
        let dst = ((value >> 6) & 0x3F) as i8;
        let promo_code = (value >> 12) & 0x3;
        let from = (src / 8, src % 8);
        let to = (dst / 8, dst % 8);
        let piece = self.board.get(coord(from)).piece()?;
        let promo = if piece == Piece::Pawn && (to.1 == 7 || to.1 == 0) {
            Some(match promo_code {
                0 => MoveKind::PromoteQueen,
                1 => MoveKind::PromoteRook,
                2 => MoveKind::PromoteBishop,
                _ => MoveKind::PromoteKnight,
            })
        } else {
            None
        };
        let mv = self.find(from, to, promo, None)?;
        self.apply(mv, from, to)?;
        Some(mv)
    }
}

/// Grundstellung mit ChessBase-Nummern.
fn standard() -> State {
    State::from_board(Board::initial())
}

/// Startstellung aus dem Aufstellungsblock (28 Bytes nach dem Längenwort).
fn setup(block: &[u8]) -> Option<(State, String)> {
    let ep_file = block.get(1)? & 0x7;
    let black = block[1] & 0x10 != 0;
    let castle = *block.get(2)?;
    let move_no = (*block.get(3)?).max(1);
    let bits: Vec<bool> = block
        .get(4..28)?
        .iter()
        .flat_map(|byte| (0..8).rev().map(move |i| byte >> i & 1 == 1))
        .collect();
    let mut grid = [[None::<char>; 8]; 8];
    let (mut i, mut square) = (0usize, 0usize);
    while i < bits.len() && square < 64 {
        if !bits[i] {
            i += 1;
            square += 1;
            continue;
        }
        let code: u8 = bits
            .get(i..i + 5)?
            .iter()
            .fold(0, |acc, &b| acc << 1 | b as u8);
        let piece = match code {
            0b10001 => 'K',
            0b10010 => 'Q',
            0b10011 => 'N',
            0b10100 => 'B',
            0b10101 => 'R',
            0b10110 => 'P',
            0b11001 => 'k',
            0b11010 => 'q',
            0b11011 => 'n',
            0b11100 => 'b',
            0b11101 => 'r',
            0b11110 => 'p',
            _ => return None,
        };
        grid[square / 8][square % 8] = Some(piece);
        i += 5;
        square += 1;
    }
    let mut fen = String::new();
    for y in (0..8).rev() {
        let mut empty = 0;
        for column in &grid {
            match column[y] {
                Some(piece) => {
                    if empty > 0 {
                        fen.push_str(&empty.to_string());
                        empty = 0;
                    }
                    fen.push(piece);
                }
                None => empty += 1,
            }
        }
        if empty > 0 {
            fen.push_str(&empty.to_string());
        }
        if y > 0 {
            fen.push('/');
        }
    }
    let mut rights = String::new();
    if castle & 2 != 0 {
        rights.push('K');
    }
    if castle & 1 != 0 {
        rights.push('Q');
    }
    if castle & 8 != 0 {
        rights.push('k');
    }
    if castle & 4 != 0 {
        rights.push('q');
    }
    if rights.is_empty() {
        rights.push('-');
    }
    let ep = if ep_file > 0 {
        format!(
            "{}{}",
            (b'a' + ep_file - 1) as char,
            if black { 3 } else { 6 }
        )
    } else {
        "-".into()
    };
    let fen = format!(
        "{fen} {} {rights} {ep} 0 {move_no}",
        if black { 'b' } else { 'w' }
    );
    let board = Board::from_fen(&fen).ok()?;
    Some((State::from_board(board), fen))
}

/// Die Hauptvariante einer Partie aus `.cbg` · `None`, wenn sie sich nicht
/// zweifelsfrei lesen lässt.
///
/// Varianten werden mitgespielt: Die Verschleierung zählt jeden gelesenen Zug,
/// auch die in Varianten, und ohne sie bliebe jeder spätere Zug falsch. Als
/// Hauptvariante gilt, wie in cbh2pgn, die erste Fortsetzung an jeder Stelle.
pub fn decode_game(data: &[u8]) -> Option<(Option<String>, Vec<String>)> {
    let head = be32(data.get(0..4)?);
    let not_initial = head & 0x4000_0000 != 0;
    let not_encoded = head & 0x8000_0000 != 0;
    let special = head & 0x0400_0000 != 0;
    let is_960 = head & 0x0A00_0000 != 0;
    if not_encoded || special || is_960 {
        return None;
    }
    let len = (head & 0x00FF_FFFF) as usize;
    let data = data.get(..len.min(data.len()))?;
    let (start, fen, mut i) = if not_initial {
        let (state, fen) = setup(data.get(4..32)?)?;
        (state, Some(fen), 32usize)
    } else {
        (standard(), None, 4usize)
    };

    // Die Züge als Baum: je Knoten Zug, Vorgänger und die erste Fortsetzung.
    struct Node {
        san: String,
        first_child: Option<usize>,
    }
    let mut nodes: Vec<Node> = vec![Node {
        san: String::new(),
        first_child: None,
    }];
    let mut cur = 0usize;
    let mut state = start;
    let mut stack: Vec<(usize, State)> = Vec::new();
    let mut counter: u8 = 0;

    while i < data.len() {
        let token = data[i].wrapping_sub(counter);
        match token {
            FILLER => {
                i += 1;
                continue;
            }
            VARIATION_START => {
                stack.push((cur, state.clone()));
                i += 1;
                continue;
            }
            VARIATION_END => {
                match stack.pop() {
                    Some((node, saved)) => {
                        cur = node;
                        state = saved;
                    }
                    // Das letzte 0x0C schließt die Partie.
                    None => break,
                }
                i += 1;
                continue;
            }
            _ => {}
        }

        let before = state.board.clone();
        let mv = if token == TWO_BYTE {
            let a = DEOBFUSCATE_2B[data.get(i + 1)?.wrapping_sub(counter) as usize];
            let b = DEOBFUSCATE_2B[data.get(i + 2)?.wrapping_sub(counter) as usize];
            i += 3;
            state.two_byte(u16::from_be_bytes([a, b]))?
        } else if token == NULL_MOVE {
            // Ein Nullzug steht nur in Kommentarvarianten · die Hauptvariante
            // einer echten Partie hat keinen. Ab hier wäre alles geraten.
            return None;
        } else {
            i += 1;
            state.one_byte(token)?
        };
        counter = counter.wrapping_add(1);

        let san = chess::canonical_san(&before, mv).ok()?;
        nodes.push(Node {
            san,
            first_child: None,
        });
        let id = nodes.len() - 1;
        if nodes[cur].first_child.is_none() {
            nodes[cur].first_child = Some(id);
        }
        cur = id;
    }

    let mut sans = Vec::new();
    let mut at = nodes[0].first_child;
    while let Some(id) = at {
        sans.push(nodes[id].san.clone());
        at = nodes[id].first_child;
    }
    Some((fen, sans))
}

// ── Lesen ────────────────────────────────────────────────────────────────────

fn parts(path: &Path) -> [PathBuf; 4] {
    [
        path.with_extension("cbh"),
        path.with_extension("cbg"),
        path.with_extension("cbp"),
        path.with_extension("cbt"),
    ]
}

/// Wie viele Partien die Datenbank führt · aus der Größe des Kopfs.
pub fn count(path: &Path) -> Result<u64, String> {
    let [cbh, ..] = parts(path);
    let len = std::fs::metadata(&cbh)
        .map_err(|e| format!("ChessBase-Datei nicht lesbar: {e}"))?
        .len();
    Ok((len / RECORD as u64).saturating_sub(1))
}

/// Liest alle Partien · `each` bekommt die Partie oder `None` für eine, die
/// sich nicht lesen ließ (Text statt Partie, gelöscht, Chess960, beschädigt).
///
/// Die Dateien werden ganz geladen: `.cbg` einer Megadatenbank wiegt einige
/// Gigabyte, liegt dann aber am Stück im Speicher statt in zwölf Millionen
/// einzelnen Lesezugriffen. Für große Sammlungen ist der PGN-Weg weiterhin
/// da; eigene Datenbanken sind meist klein.
pub fn for_each_game(
    path: &Path,
    mut each: impl FnMut(u64, Option<CbhGame>) -> bool,
) -> Result<u64, String> {
    let [cbh, cbg, cbp, cbt] = parts(path);
    for p in [&cbh, &cbg, &cbp, &cbt] {
        if !p.exists() {
            return Err(format!(
                "Zur ChessBase-Datenbank fehlt {} · kopiere alle Dateien der Datenbank (.cbh, .cbg, .cbp, .cbt …) in denselben Ordner.",
                p.file_name().and_then(|n| n.to_str()).unwrap_or("?")
            ));
        }
    }
    let read =
        |p: &Path| std::fs::read(p).map_err(|e| format!("ChessBase-Datei nicht lesbar: {e}"));
    let (head, games, players, tournaments) = (read(&cbh)?, read(&cbg)?, read(&cbp)?, read(&cbt)?);
    let total = (head.len() / RECORD).saturating_sub(1) as u64;

    for n in 0..total {
        let at = (n as usize + 1) * RECORD;
        let record = &head[at..at + RECORD];
        let is_game = record[0] & 1 == 1;
        let deleted = record[0] & 0x80 != 0;
        let game = if !is_game || deleted {
            None
        } else {
            let offset = be32(&record[1..5]) as usize;
            games
                .get(offset..)
                .and_then(decode_game)
                .map(|(start_fen, sans)| {
                    let (event, site) = tournament(&tournaments, be24(&record[15..18]));
                    let round = record[29];
                    let subround = record[30];
                    CbhGame {
                        white: player(&players, be24(&record[9..12])),
                        black: player(&players, be24(&record[12..15])),
                        event,
                        site,
                        round: match (round, subround) {
                            (0, _) => "?".into(),
                            (r, 0) => r.to_string(),
                            (r, s) => format!("{r}.{s}"),
                        },
                        date: date_string(be24(&record[24..27])),
                        result: result_string(record[27]).into(),
                        white_elo: be16(&record[31..33]) as i32,
                        black_elo: be16(&record[33..35]) as i32,
                        eco: String::new(),
                        start_fen,
                        sans,
                    }
                })
        };
        if !each(n, game) {
            break;
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_chessbase_files_regardless_of_case() {
        assert!(is_chessbase(&PathBuf::from("Mega Database 2026.CBH")));
        assert!(is_chessbase(&PathBuf::from("archiv.cbv")));
        assert!(!is_chessbase(&PathBuf::from("caissabase.pgn")));
        assert!(!is_chessbase(&PathBuf::from("dump.pgn.zst")));
        assert!(unsupported_hint(&PathBuf::from("archiv.cbv")).is_some());
        assert!(unsupported_hint(&PathBuf::from("mega.cbh")).is_none());
    }

    /// Kodiert Einbyte-Züge so, wie ChessBase sie schreibt: Byte plus Zähler.
    fn encode(tokens: &[u8]) -> Vec<u8> {
        let mut body: Vec<u8> = tokens
            .iter()
            .enumerate()
            .map(|(n, t)| t.wrapping_add(n as u8))
            .collect();
        body.push(VARIATION_END.wrapping_add(tokens.len() as u8));
        let len = (body.len() + 4) as u32;
        let mut out = len.to_be_bytes().to_vec();
        out.extend(body);
        out
    }

    #[test]
    fn decodes_the_obfuscated_opening_moves() {
        // 1.e4 (Bauer 4, zwei vor) e5 (schwarzer Bauer 4, aus seiner Sicht
        // zwei vor) 2.Nf3 (zweiter Springer g1: -1/+2)
        let data = encode(&[0xFF, 0xFF, 0xFE]);
        let (fen, sans) = decode_game(&data).unwrap();
        assert!(fen.is_none());
        assert_eq!(sans, vec!["e4", "e5", "Nf3"]);
    }

    #[test]
    fn renumbers_pieces_after_a_capture() {
        // 1.e4 Nc6 2.Bb5 a6 3.Bxc6 Nf6 · Lc6 schlägt den ersten schwarzen
        // Springer, danach ist der g8-Springer „der erste" und zieht mit dessen
        // Byte (-1/-2 → 0xD4). Ohne das Nachrücken fände der Leser keinen.
        let data = encode(&[
            0xFF, // e4
            0xDD, // Nc6 · Springer 0 b8 → c6 (+1, -2)
            0x93, // Bb5 · Läufer 1 f1 → b5 (-4, +4) = (4, 4)
            0x2D, // a6 · schwarzer Bauer 0, ein Schritt
            0xF6, // Bxc6 · Läufer 1 b5 → c6 (+1, +1)
            0xD4, // Nf6 · jetzt Springer 0: g8 → f6 (-1, -2)
        ]);
        let (_, sans) = decode_game(&data).unwrap();
        assert_eq!(sans, vec!["e4", "Nc6", "Bb5", "a6", "Bxc6", "Nf6"]);
    }

    #[test]
    fn keeps_the_first_continuation_as_main_line() {
        // 1.e4 [DC] 1...c5 [0C] 1...e5 · der erste Ast ist die Hauptvariante.
        let tokens = [0xFF, VARIATION_START, 0x7B, VARIATION_END, 0xFF];
        // Varianten-Marken zählen nicht mit · der Zähler steigt nur bei Zügen.
        let mut body = Vec::new();
        let mut counter = 0u8;
        for t in tokens {
            body.push(t.wrapping_add(counter));
            if t != VARIATION_START && t != VARIATION_END {
                counter = counter.wrapping_add(1);
            }
        }
        body.push(VARIATION_END.wrapping_add(counter));
        let mut data = ((body.len() + 4) as u32).to_be_bytes().to_vec();
        data.extend(body);
        let (_, sans) = decode_game(&data).unwrap();
        // c5 ist Bauer 2 (c-Bauer), aus Sicht von Schwarz zwei vor: 0xDA · der
        // Test nimmt 0x7B (ein Schritt), also 1...c6.
        assert_eq!(sans, vec!["e4", "c6"]);
    }

    #[test]
    fn refuses_what_is_not_a_legal_move() {
        // Erster Zug: König eins vor · e2 ist besetzt.
        assert!(decode_game(&encode(&[0x49])).is_none());
    }

    /// Gegen eine echte ChessBase-Datenbank:
    /// `KIEBITZ_CBH=…/Torim-CB-DB.cbh cargo test cbh::tests::reads_a_real_database -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn reads_a_real_database() {
        let path = std::env::var("KIEBITZ_CBH").expect("KIEBITZ_CBH setzen");
        let mut ok = 0u64;
        let mut failed = Vec::new();
        let total = for_each_game(Path::new(&path), |n, game| {
            match game {
                Some(g) => {
                    ok += 1;
                    if n < 2 {
                        println!("{}", crate::si4::to_pgn(&g));
                    }
                }
                None => failed.push(n),
            }
            true
        })
        .unwrap();
        println!(
            "{ok} von {total} Partien gelesen, nicht lesbar: {} {:?}",
            failed.len(),
            &failed[..failed.len().min(20)]
        );
    }
}
