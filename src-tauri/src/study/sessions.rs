/// Gemessene Trainingszeit.
///
/// Zwei Quellen, und beide messen statt zu schätzen:
///
/// · **Trainerseiten.** Puzzles, Repertoire, Endspiele und Analyse zählen im
///   Frontend aktive Sekunden (sichtbares Fenster, Eingabe innerhalb des
///   Aufmerksamkeitsfensters) und schreiben sie hierher fort. Eine Sitzung ist
///   über ihren `sync_key` identifiziert und wächst; ein Absturz kostet
///   höchstens das letzte Fortschreibe-Intervall.
/// · **Partien.** Die eigene Spielzeit steht in den Uhrenständen, die der
///   Import ohnehin mitbringt: verbraucht hat eine Seite Grundzeit plus
///   Zuschläge minus Restzeit. Beide Seiten zusammen ergeben die Dauer, die
///   der Spieler tatsächlich am Brett saß.
///
/// Vor der ersten gemessenen Sitzung gibt es keine Messwerte. Für diese Tage
/// bleibt die alte Hochrechnung stehen — sonst fiele die Vergangenheit am Tag
/// des Updates auf null, und das wäre eine schlechtere Lüge als die Schätzung.
///
/// Bereiche, für die eine Sitzung gemessen werden kann. „play" fehlt bewusst:
/// gespielt wird außerhalb von Kiebitz, dort messen die Partieuhren.
const SESSION_AREAS: [&str; 4] = ["tactics", "openings", "endgames", "analysis"];

/// Obergrenze einer einzelnen Sitzung. Eine offene App zählt nur aktive Zeit,
/// aber ein kaputter Client soll das Budget nicht sprengen können.
const MAX_SESSION_SECONDS: i64 = 6 * 3600;

/// Schreibt eine laufende Trainingssitzung fort.
///
/// Der Schlüssel kommt vom Client und bleibt über die Sitzung gleich; `seconds`
/// ist die bisher gezählte Gesamtzeit, nicht ein Zuwachs. Damit ist der Aufruf
/// wiederholbar: ein doppelt gesendeter Herzschlag ändert nichts, ein
/// verlorener kostet nur die Sekunden bis zum nächsten.
#[tauri::command(async)]
pub fn record_study_time(
    db: State<db::Db>,
    session_key: String,
    area: String,
    start_ts: i64,
    seconds: i64,
) -> Result<(), String> {
    if !SESSION_AREAS.contains(&area.as_str()) {
        return Err(format!("Unbekannter Trainingsbereich: {area}"));
    }
    let key = session_key.trim();
    if key.is_empty() {
        return Err("Sitzung ohne Schlüssel".into());
    }
    let seconds = seconds.clamp(0, MAX_SESSION_SECONDS);
    if seconds == 0 {
        return Ok(());
    }
    let now = now_ts();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4)
         ON CONFLICT(sync_key) DO UPDATE SET
            -- Fortschreibung, nie Rückschritt: ein verspäteter Herzschlag mit
            -- altem Stand darf die Sitzung nicht verkürzen.
            seconds = MAX(study_sessions.seconds, excluded.seconds),
            end_ts = MAX(study_sessions.end_ts, excluded.end_ts),
            updated_ts = excluded.updated_ts",
        params![key, area, start_ts.max(0), now, seconds],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Erste je gemessene Sitzung · ab diesem Tag gelten Messwerte, davor die
/// Hochrechnung. `None` heißt: es wurde noch nie gemessen.
pub fn measurement_start(conn: &Connection) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT MIN(start_ts) FROM study_sessions WHERE seconds > 0",
        [],
        |r| r.get::<_, Option<i64>>(0),
    )
    .map_err(|e| e.to_string())
}

/// Gemessene Sekunden je (Tagesbeginn, Bereich) ab `from`.
pub fn measured_seconds(
    conn: &Connection,
    from: i64,
    to: i64,
) -> Result<BTreeMap<(i64, String), i64>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT (start_ts / 86400) * 86400, area, SUM(seconds)
               FROM study_sessions
              WHERE start_ts >= ?1 AND start_ts < ?2
              GROUP BY start_ts / 86400, area",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = BTreeMap::new();
    for row in rows {
        let (day, area, seconds) = row.map_err(|e| e.to_string())?;
        *out.entry((day, area)).or_insert(0) += seconds;
    }
    Ok(out)
}

/// Grundzeit und Zuschlag aus einem PGN-TimeControl ("600+5", "300", "40/7200:1800").
/// Nur die erste Stufe zählt · sie bestimmt, womit die Uhr startete.
fn time_control_parts(raw: &str) -> Option<(f64, f64)> {
    let first = raw.split(':').next()?.trim();
    if first.is_empty() || first == "-" || first == "?" {
        return None;
    }
    // Ein "40/7200" nennt vor dem Schrägstrich die Zugzahl, dahinter die Zeit.
    let stage = first.rsplit('/').next()?;
    let (base, increment) = match stage.split_once('+') {
        Some((base, increment)) => (base, increment.parse::<f64>().ok()?),
        None => (stage, 0.0),
    };
    let base: f64 = base.trim().parse().ok()?;
    if base <= 0.0 || increment < 0.0 {
        return None;
    }
    Some((base, increment))
}

/// Tatsächlich am Brett verbrachte Sekunden einer Partie, aus den Uhrenständen.
///
/// `clocks` hält die Restzeit nach jedem Halbzug in Hundertstelsekunden ·
/// derselbe Wert, den `%clk` in der PGN und die Uhrenliste von Lichess nennen.
/// Verbraucht hat eine Seite damit Grundzeit + Zuschläge − Restzeit; beide
/// Seiten zusammen sind die Dauer, die der Spieler vor dem Brett saß.
///
/// `None`, wenn Uhren oder Zeitvorgabe fehlen · dann bleibt nur die Schätzung.
pub fn game_seconds_measured(clocks: &str, time_control: &str) -> Option<f64> {
    let (initial, increment) = time_control_parts(time_control)?;
    let values: Vec<f64> = clocks
        .split_whitespace()
        .map(|value| value.parse::<f64>())
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if values.is_empty() {
        return None;
    }

    let mut total = 0.0;
    for side in 0..2usize {
        let own: Vec<f64> = values.iter().skip(side).step_by(2).copied().collect();
        let moves = own.len() as f64;
        let Some(last) = own.last() else {
            continue;
        };
        // Der gespeicherte Reststand enthält den Zuschlag des jeweiligen Zuges
        // bereits · siehe `clocksFromPgn` auf der Frontend-Seite.
        total += (initial * 100.0 + increment * 100.0 * moves - last).max(0.0);
    }
    let seconds = total / 100.0;
    // Eine Partie, deren Uhren Unsinn ergeben (fehlende Stände, andere
    // Zeitvorgabe als angegeben), zählt lieber gar nicht als falsch.
    if seconds <= 0.0 || seconds > (MAX_SESSION_SECONDS as f64) {
        return None;
    }
    Some(seconds)
}
