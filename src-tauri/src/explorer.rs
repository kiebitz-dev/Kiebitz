//! Eröffnungs-Explorer von Lichess: Häufigkeiten statt Engine-Urteil.
//!
//! Zwei Datenbanken über dieselbe API (`explorer.lichess.org`, CC0):
//!
//! * `masters` · rund 2,5 Millionen Turnierpartien ab 2200 Elo · „was spielen
//!   Starke hier?"
//! * `lichess` · der komplette Online-Bestand, nach Rating-Band und
//!   Zeitkontrolle filterbar · „was spielt die Masse — und was spielt meine
//!   Klasse?"
//!
//! Das ist die Ergänzung zu chessdb.rs, nicht dessen Ersatz: ChessDB sagt, was
//! eine Engine von einem Zug hält, der Explorer sagt, wie oft er gespielt wird
//! und was dabei herauskommt. Beides zusammen beantwortet erst die Frage, die
//! man vor dem Brett hat.
//!
//! Antworten werden lokal gecacht (Tabelle `explorer_cache`), damit das
//! Durchblättern einer Partie nicht bei jedem Halbzug ins Netz greift ·
//! Eröffnungsstellungen wiederholen sich ohnehin über alle Partien hinweg.
//!
//! **Seit Anfang 2026 nicht mehr ohne Anmeldung.** Lichess hat den Explorer
//! nach anhaltenden Überlastungsangriffen hinter eine Anmeldung gelegt: Jede
//! Abfrage ohne `Authorization`-Kopfzeile beantwortet der vorgelagerte nginx
//! mit 401, noch bevor die Anwendung sie sieht. Kiebitz schickt deshalb einen
//! persönlichen API-Token mit, den der Nutzer in den Einstellungen hinterlegt
//! (Schlüsselspeicher, siehe plus.rs). Ohne Token bleibt nur eine klare
//! Auskunft — und die eigene Referenzdatenbank, die dieselbe Frage offline
//! beantwortet.

use crate::{chess, db, settings};
use rusqlite::params;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// Der dokumentierte Endpunkt. `explorer.lichess.ovh` beantwortet dieselben
/// Pfade noch, die offizielle Spezifikation nennt aber seit dem Umzug
/// ausschließlich diesen Namen.
const API: &str = "https://explorer.lichess.org";

/// Lichess bittet Anwendungen, sich erkennbar zu machen · anonyme Aufrufe
/// landen im selben Topf wie jeder Skriptverkehr.
const USER_AGENT: &str = "Kiebitz (https://kiebitz.dev)";

/// Rückgaben, die die Oberfläche übersetzen soll, statt sie durchzureichen.
///
/// Der Rest der Fehlertexte ist Diagnose („Verbindung abgelehnt"), die genau so
/// nützlich ist, wie sie kommt. Diese beiden sind dagegen Zustände mit einer
/// Handlung dahinter, und die gehört in die Sprache des Nutzers.
const ERR_AUTH: &str = "explorer:auth";
const ERR_RATE: &str = "explorer:rate";

/// Meisterpartien wachsen im Monatsrhythmus · ein Vierteljahr Cache ist für
/// eine Statistik aus 2,5 Millionen Partien mehr als genug.
const MASTERS_TTL_SECS: i64 = 90 * 86_400;
/// Der Online-Bestand wächst schneller, die Verteilung deshalb weniger stabil.
const LICHESS_TTL_SECS: i64 = 30 * 86_400;

/// So viele Züge holt und zeigt der Explorer je Stellung.
const MOVE_LIMIT: u32 = 12;
/// So viele Musterpartien hängt die Antwort an.
const TOP_GAMES: u32 = 6;

/// Mindestabstand zwischen zwei echten Netzanfragen. Lichess bittet um
/// Zurückhaltung, und beim schnellen Durchblättern einer Partie käme sonst pro
/// Halbzug eine Anfrage. Der Cache fängt Wiederholungen ab, dieser Riegel die
/// erste Fahrt durch eine frische Partie.
const MIN_REQUEST_GAP: Duration = Duration::from_millis(1_100);

static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Serialize, Clone)]
pub struct ExplorerMove {
    pub uci: String,
    pub san: String,
    /// Partien, die aus dieser Stellung mit diesem Zug fortgesetzt wurden.
    pub white: i64,
    pub draws: i64,
    pub black: i64,
    /// Durchschnittliches Elo der Spieler, die den Zug gewählt haben.
    pub average_rating: Option<i32>,
}

impl ExplorerMove {
    fn games(&self) -> i64 {
        self.white + self.draws + self.black
    }
}

#[derive(Serialize, Clone)]
pub struct ExplorerGame {
    pub id: String,
    pub white: String,
    pub black: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    /// "white", "black" oder "" für Remis.
    pub winner: String,
    pub year: Option<i32>,
    /// Nur bei Meisterpartien gesetzt.
    pub month: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ExplorerResult {
    /// "masters" oder "lichess".
    pub source: String,
    /// "ok" · "unknown" (Stellung nicht im Bestand) · "invalid".
    pub status: String,
    pub white: i64,
    pub draws: i64,
    pub black: i64,
    pub moves: Vec<ExplorerMove>,
    pub top_games: Vec<ExplorerGame>,
    pub opening: Option<String>,
    pub cached: bool,
}

fn as_i64(value: &serde_json::Value) -> i64 {
    value.as_i64().unwrap_or(0)
}

pub(crate) fn parse_response(source: &str, json: &str) -> ExplorerResult {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => {
            return ExplorerResult {
                source: source.to_string(),
                status: "invalid".into(),
                white: 0,
                draws: 0,
                black: 0,
                moves: Vec::new(),
                top_games: Vec::new(),
                opening: None,
                cached: false,
            }
        }
    };

    let moves: Vec<ExplorerMove> = value["moves"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| ExplorerMove {
                    uci: m["uci"].as_str().unwrap_or("").to_string(),
                    san: m["san"].as_str().unwrap_or("").to_string(),
                    white: as_i64(&m["white"]),
                    draws: as_i64(&m["draws"]),
                    black: as_i64(&m["black"]),
                    average_rating: m["averageRating"].as_i64().map(|v| v as i32),
                })
                .filter(|m| !m.uci.is_empty() && m.games() > 0)
                .collect()
        })
        .unwrap_or_default();

    let top_games = value["topGames"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|g| ExplorerGame {
                    id: g["id"].as_str().unwrap_or("").to_string(),
                    white: g["white"]["name"].as_str().unwrap_or("?").to_string(),
                    black: g["black"]["name"].as_str().unwrap_or("?").to_string(),
                    white_elo: g["white"]["rating"].as_i64().map(|v| v as i32),
                    black_elo: g["black"]["rating"].as_i64().map(|v| v as i32),
                    winner: g["winner"].as_str().unwrap_or("").to_string(),
                    year: g["year"].as_i64().map(|v| v as i32),
                    month: g["month"].as_str().map(String::from),
                })
                .collect()
        })
        .unwrap_or_default();

    let white = as_i64(&value["white"]);
    let draws = as_i64(&value["draws"]);
    let black = as_i64(&value["black"]);
    // Eine Stellung, die niemand erreicht hat, ist keine kaputte Antwort ·
    // sie ist die Auskunft, dass hier das Buch endet.
    let status = if white + draws + black == 0 && moves.is_empty() {
        "unknown"
    } else {
        "ok"
    };

    ExplorerResult {
        source: source.to_string(),
        status: status.into(),
        white,
        draws,
        black,
        moves,
        top_games,
        opening: value["opening"]["name"].as_str().map(String::from),
        cached: false,
    }
}

/// Erlaubte Rating-Bänder der Lichess-Datenbank. Andere Werte weist die API mit
/// 400 zurück, deshalb wird hier gefiltert statt durchgereicht.
const RATING_BUCKETS: [&str; 9] = [
    "0", "1000", "1200", "1400", "1600", "1800", "2000", "2200", "2500",
];
const SPEEDS: [&str; 6] = [
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
];

fn sanitize(list: &str, allowed: &[&str]) -> String {
    let mut parts: Vec<&str> = list
        .split(',')
        .map(str::trim)
        .filter(|p| allowed.contains(p))
        .collect();
    parts.dedup();
    parts.join(",")
}

/// Wartet, bis der Mindestabstand zur letzten Netzanfrage erreicht ist.
fn throttle() {
    let mut guard = match LAST_REQUEST.lock() {
        Ok(g) => g,
        // Ein vergifteter Mutex darf den Explorer nicht lahmlegen · der Riegel
        // ist Höflichkeit, keine Korrektheitsbedingung.
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(last) = *guard {
        let elapsed = last.elapsed();
        if elapsed < MIN_REQUEST_GAP {
            std::thread::sleep(MIN_REQUEST_GAP - elapsed);
        }
    }
    *guard = Some(Instant::now());
}

/// Fragt eine der beiden Lichess-Datenbanken nach den Zügen einer Stellung.
///
/// `ratings` und `speeds` gelten nur für `source = "lichess"` und kommen als
/// Kommaliste ("1600,1800,2000"). Sie gehören in den Cache-Schlüssel: dieselbe
/// Stellung sieht in zwei Rating-Bändern verschieden aus, und genau das ist der
/// Sinn der Filter.
///
/// `token` ist der persönliche Lichess-API-Token; ihn holt die Oberfläche aus
/// dem Schlüsselspeicher und reicht ihn durch, statt dass dieses Modul auf zwei
/// Betriebssystemen an zwei verschiedenen Ablagen vorbeigreifen müsste.
///
/// `(async)` und nicht schlicht `#[tauri::command]`: Eine synchrone Funktion
/// ohne dieses Attribut läuft im Hauptthread, und der zeichnet das Fenster.
/// Zwischen Höflichkeitsriegel (bis 1,1 s) und Netz-Zeitgrenze (12 s) stand die
/// gesamte App still, bis die Abfrage fehlgeschlagen war. Mit dem Attribut
/// nimmt Tauri denselben Rumpf auf einen Arbeitsthread.
#[tauri::command(async)]
pub fn explorer_query(
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    fen: String,
    source: String,
    ratings: Option<String>,
    speeds: Option<String>,
    token: Option<String>,
) -> Result<ExplorerResult, String> {
    let masters = source == "masters";
    if !masters && source != "lichess" {
        return Err(format!("Unbekannte Explorer-Quelle: {source}"));
    }
    {
        let state = app.state::<settings::SettingsState>();
        let settings = state.0.lock().map_err(|e| e.to_string())?;
        if !settings.explorer_enabled {
            return Err("Der Eröffnungs-Explorer ist in den Einstellungen deaktiviert.".into());
        }
    }

    let key = chess::normalize_fen(&fen)?;
    let ratings = sanitize(ratings.as_deref().unwrap_or(""), &RATING_BUCKETS);
    let speeds = sanitize(speeds.as_deref().unwrap_or(""), &SPEEDS);
    let source_key = if masters {
        "masters".to_string()
    } else {
        format!("lichess|{ratings}|{speeds}")
    };
    let ttl = if masters {
        MASTERS_TTL_SECS
    } else {
        LICHESS_TTL_SECS
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Cache zuerst · ohne gehaltenen Lock ins Netz zu gehen ist die halbe
    // Miete, die andere Hälfte ist, gar nicht erst hineinzugehen.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let hit: Option<String> = conn
            .query_row(
                "SELECT json FROM explorer_cache
                 WHERE source_key = ?1 AND fen_key = ?2 AND ts > ?3",
                params![source_key, key, now - ttl],
                |r| r.get(0),
            )
            .ok();
        if let Some(json) = hit {
            let mut result = parse_response(&source, &json);
            result.cached = true;
            return Ok(result);
        }
    }

    // Ohne Token braucht es die Anfrage nicht: Lichess beantwortet sie mit 401,
    // und der Riegel oben hätte vorher noch eine Sekunde geschlafen.
    let token = token
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    let Some(token) = token else {
        return Err(ERR_AUTH.into());
    };

    throttle();
    let mut request = ureq::get(&format!(
        "{API}/{}",
        if masters { "masters" } else { "lichess" }
    ))
    .set("Authorization", &format!("Bearer {token}"))
    .set("User-Agent", USER_AGENT)
    .query("fen", &fen)
    .query("moves", &MOVE_LIMIT.to_string())
    .query("topGames", &TOP_GAMES.to_string())
    .timeout(Duration::from_secs(12));
    if !masters {
        request = request
            .query("variant", "standard")
            .query("recentGames", "0");
        if !ratings.is_empty() {
            request = request.query("ratings", &ratings);
        }
        if !speeds.is_empty() {
            request = request.query("speeds", &speeds);
        }
    }
    let body = match request.call() {
        Ok(response) => response
            .into_string()
            .map_err(|e| format!("Explorer-Antwort unlesbar: {e}"))?,
        // 429 ist kein Ausfall, sondern die Bitte, langsamer zu machen · sie
        // gehört als eigener Zustand in die Oberfläche.
        Err(ureq::Error::Status(429, _)) => return Err(ERR_RATE.into()),
        // 401/403 heißt: der Token fehlt, ist abgelaufen oder widerrufen. Ein
        // technischer Text mit der vollen URL hilft dagegen niemandem — die
        // Oberfläche sagt stattdessen, was zu tun ist.
        Err(ureq::Error::Status(401 | 403, _)) => return Err(ERR_AUTH.into()),
        Err(e) => return Err(format!("Explorer nicht erreichbar: {e}")),
    };

    let result = parse_response(&source, &body);
    if result.status != "invalid" {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO explorer_cache (source_key, fen_key, json, ts)
             VALUES (?1, ?2, ?3, ?4)",
            params![source_key, key, body, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "white": 1200, "draws": 800, "black": 1000,
        "moves": [
            {"uci":"e2e4","san":"e4","white":600,"draws":400,"black":500,"averageRating":2412},
            {"uci":"d2d4","san":"d4","white":300,"draws":200,"black":250,"averageRating":2388},
            {"uci":"a2a3","san":"a3","white":0,"draws":0,"black":0,"averageRating":2100}
        ],
        "topGames": [
            {"id":"abc12345","winner":"white","year":1997,"month":"1997-05",
             "white":{"name":"Kasparov, G.","rating":2820},
             "black":{"name":"Karpov, A.","rating":2745}}
        ],
        "opening": {"eco":"C50","name":"Italian Game"}
    }"#;

    #[test]
    fn parses_move_statistics_and_top_games() {
        let r = parse_response("masters", SAMPLE);
        assert_eq!(r.status, "ok");
        assert_eq!((r.white, r.draws, r.black), (1200, 800, 1000));
        // a3 kommt in keiner Partie vor · ein Zug ohne Partien ist keine
        // Statistik, sondern eine leere Zeile in der Karte.
        assert_eq!(r.moves.len(), 2);
        assert_eq!(r.moves[0].san, "e4");
        assert_eq!(r.moves[0].average_rating, Some(2412));
        assert_eq!(r.top_games.len(), 1);
        assert_eq!(r.top_games[0].white, "Kasparov, G.");
        assert_eq!(r.top_games[0].black_elo, Some(2745));
        assert_eq!(r.opening.as_deref(), Some("Italian Game"));
    }

    #[test]
    fn treats_an_empty_position_as_unknown() {
        let r = parse_response("lichess", r#"{"white":0,"draws":0,"black":0,"moves":[]}"#);
        assert_eq!(r.status, "unknown");
        assert!(r.moves.is_empty());
    }

    #[test]
    fn survives_garbage() {
        assert_eq!(
            parse_response("masters", "<html>502</html>").status,
            "invalid"
        );
    }

    #[test]
    fn drops_filter_values_the_api_would_reject() {
        assert_eq!(sanitize("1600,1800,9999", &RATING_BUCKETS), "1600,1800");
        assert_eq!(sanitize("blitz, rapid ,drunk", &SPEEDS), "blitz,rapid");
        assert_eq!(sanitize("", &RATING_BUCKETS), "");
    }
}
