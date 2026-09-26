/// Trainingsbereiche. Dieselben Schlüssel benutzt `lib/plan.ts`.
pub const AREAS: [&str; 5] = ["play", "tactics", "openings", "endgames", "analysis"];

/// Aufwand eines Bereichs in einem Zeitraum · Minuten sind geschätzt, damit
/// Puzzles, Drills, Wiederholungen und Partien überhaupt vergleichbar werden.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct AreaLoad {
    pub area: String,
    /// Rohzähler (Puzzleversuche, Drills, Wiederholungen, Partien, Analysen).
    pub items: i64,
    pub minutes: i64,
}

/// Ein Tag der Trainingslast · Grundlage der Verlaufsdarstellung.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct LoadDay {
    pub day_ts: i64,
    pub play: i64,
    pub tactics: i64,
    pub openings: i64,
    pub endgames: i64,
    pub analysis: i64,
}

#[derive(Serialize, Default)]
pub struct TrainingProgram {
    /// Ist-Aufwand der letzten 28 Tage je Bereich.
    pub load_28d: Vec<AreaLoad>,
    /// Tageslast (Minuten) über das angefragte Fenster, aufsteigend.
    pub days: Vec<LoadDay>,
    /// Aus der Historie abgeleitetes Wochenbudget in Minuten (Median-nah:
    /// Durchschnitt der letzten acht Wochen).
    pub observed_weekly_minutes: i64,
}

/// Aufwandsschätzung in Hundertstelminuten · **nur noch für die Zeit vor der
/// ersten gemessenen Sitzung**. Ab dann zählt `study_sessions`, siehe
/// `sessions.rs`. Die Konstanten stehen hier weiter, damit die Vergangenheit
/// beim Update nicht auf null fällt.
const CENTI_PER_PUZZLE: i64 = 150;
const CENTI_PER_DRILL: i64 = 400;
const CENTI_PER_REVIEW: i64 = 50;

/// Gilt für diesen Tag schon die Messung?
///
/// Der Schnitt liegt am Tag der ersten Sitzung. Davor wäre eine gemessene Null
/// keine Aussage, sondern nur die Abwesenheit des Features; danach ist sie
/// genau die Aussage, um die es geht — an diesem Tag wurde nicht trainiert.
fn measured_day(measurement_start: Option<i64>, day: i64) -> bool {
    matches!(measurement_start, Some(start) if day >= day_bucket(start))
}

fn round_centi(value: i64) -> i64 {
    ((value.max(0) as f64) / 100.0).round() as i64
}

/// Spielminuten einer Partie.
///
/// Bringt die Partie Uhrenstände mit, ist die Dauer **gemessen**: verbraucht
/// haben beide Seiten Grundzeit plus Zuschläge minus Restzeit, und genau so
/// lange saß der Spieler vor dem Brett. Ohne Uhren bleibt die alte Schätzung
/// aus der Zeitkontrolle · besser als die Partie zu verschweigen.
fn game_minutes_real(
    clocks: &str,
    time_control: &str,
    time_class: &str,
    moves_count: i64,
) -> f64 {
    if matches!(time_class, "daily" | "correspondence") {
        return 0.0;
    }
    match game_seconds_measured(clocks, time_control) {
        Some(seconds) => (seconds / 60.0).clamp(0.0, 180.0),
        None => game_minutes(time_control, time_class, moves_count),
    }
}

/// Schätzung aus der Zeitkontrolle ("300+3"), sonst nach Zeitklasse. Beide
/// Seiten zusammen, gedeckelt · eine Fernpartie über zwei Wochen ist keine
/// zweiwöchige Trainingseinheit.
fn game_minutes(time_control: &str, time_class: &str, moves_count: i64) -> f64 {
    // Bei Fernpartien verteilt sich die Arbeit über Tage; der Endzeitpunkt und
    // die mehrtägige Nominaluhr taugen nicht als Trainingsdauer. Eine erfundene
    // 180-Minuten-Buchung wäre schlechter als keine Schätzung.
    if matches!(time_class, "daily" | "correspondence") {
        return 0.0;
    }
    let base = time_control
        .split_once('+')
        .and_then(|(base, inc)| {
            let base: f64 = base.trim().parse().ok()?;
            let inc: f64 = inc.trim().parse().ok()?;
            Some(base + inc * moves_count.clamp(0, 120) as f64 / 2.0)
        })
        .or_else(|| time_control.trim().parse::<f64>().ok());
    let seconds = match base {
        Some(seconds) => seconds,
        None => match time_class {
            "bullet" => 120.0,
            "blitz" => 400.0,
            "rapid" => 900.0,
            "classical" => 2_400.0,
            _ => 600.0,
        },
    };
    // Partien enden selten mit leerer Uhr; zwei Drittel der Nominalzeit ist
    // eine ehrlichere Schätzung als die volle Bedenkzeit.
    (seconds * 2.0 / 3.0 / 60.0).clamp(1.0, 180.0)
}

/// Live-Partien und ihre geschätzte eigene Spielzeit im Zeitraum.
fn game_load_between(conn: &Connection, from: i64, to: i64) -> Result<(i64, i64), String> {
    let mut stmt = conn
        .prepare(
            "SELECT time_control, time_class, moves_count
               FROM games
              WHERE played_ts >= ?1 AND played_ts < ?2 AND analysis_excluded = 0
                AND time_class NOT IN ('daily', 'correspondence')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut items = 0;
    let mut centi = 0;
    for row in rows {
        let (control, class, moves) = row.map_err(|e| e.to_string())?;
        items += 1;
        centi += (game_minutes(&control, &class, moves) * 100.0).round() as i64;
    }
    Ok((items, centi))
}

/// Nur bewusst abgehakte Analyse-Termine sind reale Lernzeit. Das bloße
/// Fertigwerden der Engine ist Rechenarbeit und darf kein Ist-Budget erzeugen.
fn completed_analysis_load(conn: &Connection, from: i64, to: i64) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(COALESCE(NULLIF(e.planned_min, 0), t.duration_min)), 0) * 100
           FROM study_events e JOIN study_templates t ON t.id = e.template_id
          WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
            AND e.completed_ts >= ?1 AND e.completed_ts < ?2
            AND (t.areas LIKE '%analysis%'
                         OR LOWER(t.tool) LIKE '%analys%'
                         OR LOWER(t.title) LIKE '%analys%')",
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|e| e.to_string())
}

fn day_bucket(ts: i64) -> i64 {
    ts.div_euclid(86_400) * 86_400
}

/// Tageseintrag der Lastkurve, bei Bedarf angelegt.
fn day_entry(map: &mut BTreeMap<i64, LoadDay>, day: i64) -> &mut LoadDay {
    map.entry(day).or_insert(LoadDay {
        day_ts: day,
        ..Default::default()
    })
}

#[tauri::command(async)]
pub fn training_program(db: State<db::Db>, days: Option<i64>) -> Result<TrainingProgram, String> {
    db.read(|conn| {
        training_program_from_conn(conn, now_ts(), days.unwrap_or(180).clamp(28, 730))
    })
}

fn training_program_from_conn(
    conn: &Connection,
    now: i64,
    window_days: i64,
) -> Result<TrainingProgram, String> {
    let today = day_bucket(now);
    let from = today - (window_days - 1) * 86_400;
    let mut by_day: BTreeMap<i64, LoadDay> = BTreeMap::new();
    let measured_from = measurement_start(conn)?;

    // Gemessene Trainingszeit der vier Trainerseiten.
    for ((day, area), seconds) in measured_seconds(conn, from, now + 86_400)? {
        let entry = day_entry(&mut by_day, day);
        let centi = (seconds as f64 / 60.0 * 100.0).round() as i64;
        match area.as_str() {
            "tactics" => entry.tactics += centi,
            "endgames" => entry.endgames += centi,
            "openings" => entry.openings += centi,
            "analysis" => entry.analysis += centi,
            _ => {}
        }
    }

    // Tage vor der ersten Messung behalten die alte Hochrechnung aus Zählern.
    // Ohne sie stünde die gesamte Vergangenheit am Tag des Updates auf null.
    for (sql, area) in [
        ("SELECT ts FROM puzzle_attempts WHERE ts >= ?1", "tactics"),
        ("SELECT ts FROM endgame_attempts WHERE ts >= ?1", "endgames"),
        ("SELECT ts FROM rep_review_log WHERE ts >= ?1", "openings"),
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        for ts in rows {
            let day = day_bucket(ts.map_err(|e| e.to_string())?);
            if measured_day(measured_from, day) {
                continue;
            }
            let entry = day_entry(&mut by_day, day);
            match area {
                "tactics" => entry.tactics += CENTI_PER_PUZZLE,
                "endgames" => entry.endgames += CENTI_PER_DRILL,
                _ => entry.openings += CENTI_PER_REVIEW,
            }
        }
    }

    // Vor der Messung war Analysezeit das, was im Lernkalender abgehakt wurde ·
    // eine Engine kann 1.000 Partien im Hintergrund rechnen, ohne dass jemand
    // 1.000 Partie-Reviews gemacht hat. Seit der Messung zählt die Zeit auf der
    // Analyseseite selbst.
    {
        let mut stmt = conn
            .prepare(
                "SELECT e.completed_ts, COALESCE(NULLIF(e.planned_min, 0), t.duration_min)
                   FROM study_events e JOIN study_templates t ON t.id = e.template_id
                  WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
                    AND e.completed_ts >= ?1
                    AND (t.areas LIKE '%analysis%'
                         OR LOWER(t.tool) LIKE '%analys%'
                         OR LOWER(t.title) LIKE '%analys%')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, minutes) = row.map_err(|e| e.to_string())?;
            let day = day_bucket(ts);
            if measured_day(measured_from, day) {
                continue;
            }
            day_entry(&mut by_day, day).analysis += minutes.max(0) * 100;
        }
    }

    // Gespielte Partien: aus den Uhrenständen gemessen, sonst geschätzt.
    {
        let mut stmt = conn
            .prepare(
                "SELECT played_ts, clocks, time_control, time_class, moves_count
                 FROM games WHERE played_ts >= ?1 AND analysis_excluded = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, clocks, tc, class, moves) = row.map_err(|e| e.to_string())?;
            let day = day_bucket(ts);
            let centi = (game_minutes_real(&clocks, &tc, &class, moves) * 100.0).round() as i64;
            if centi > 0 {
                day_entry(&mut by_day, day).play += centi;
            }
        }
    }

    // Summen werden aus den ungerundeten Hundertstelminuten gebildet. So geht
    // etwa eine einzelne 30-Sekunden-Repertoirewiederholung nicht an jedem Tag
    // durch Ganzzahldivision verloren.
    let centi_days: Vec<LoadDay> = by_day.into_values().collect();
    let days: Vec<LoadDay> = centi_days
        .iter()
        .map(|d| LoadDay {
            day_ts: d.day_ts,
            play: round_centi(d.play),
            tactics: round_centi(d.tactics),
            openings: round_centi(d.openings),
            endgames: round_centi(d.endgames),
            analysis: round_centi(d.analysis),
        })
        .collect();

    let cutoff_28 = today - 27 * 86_400;
    let recent: Vec<&LoadDay> = centi_days
        .iter()
        .filter(|d| d.day_ts >= cutoff_28)
        .collect();
    let sum =
        |pick: fn(&LoadDay) -> i64| -> i64 { round_centi(recent.iter().map(|d| pick(d)).sum()) };
    let recent_end = now + 86_400;
    let (play_items, _) = game_load_between(conn, cutoff_28, recent_end)?;
    let (analysis_items, _) = completed_analysis_load(conn, cutoff_28, recent_end)?;
    let load_28d = vec![
        AreaLoad {
            area: "play".into(),
            items: play_items,
            minutes: sum(|d| d.play),
        },
        AreaLoad {
            area: "tactics".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.tactics),
        },
        AreaLoad {
            area: "openings".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM rep_review_log WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.openings),
        },
        AreaLoad {
            area: "endgames".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.endgames),
        },
        AreaLoad {
            area: "analysis".into(),
            items: analysis_items,
            minutes: sum(|d| d.analysis),
        },
    ];

    // Beobachtetes Wochenbudget aus den letzten acht Wochen · ohne Vorgabe in
    // den Einstellungen plant der Wochenplan damit.
    let cutoff_8w = today - 55 * 86_400;
    let observed_centi: i64 = centi_days
        .iter()
        .filter(|d| d.day_ts >= cutoff_8w)
        .map(|d| d.play + d.tactics + d.openings + d.endgames + d.analysis)
        .sum();

    Ok(TrainingProgram {
        load_28d,
        days,
        observed_weekly_minutes: round_centi(observed_centi / 8),
    })
}
