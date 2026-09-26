#[tauri::command(async)]
pub fn study_calendar(
    db: State<db::Db>,
    start_day: String,
    end_day: String,
) -> Result<StudyCalendar, String> {
    db.read(|conn| {
        calendar_from_conn(conn, &start_day, &end_day, now_ts())
    })
}

#[tauri::command(async)]
pub fn save_study_template(
    db: State<db::Db>,
    template: StudyTemplateInput,
) -> Result<StudyTemplate, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let title = clean_text(template.title, 80);
    if title.is_empty() {
        return Err("Titel darf nicht leer sein".into());
    }
    let tool = clean_text(template.tool, 100);
    let description = clean_text(template.description, 2_000);
    let now = now_ts();
    // Eine Einheit nennt Bereiche, keine Dauer: gemessen wird ohnehin, und die
    // Länge einer Sitzung ergibt sich aus dem Wochenbudget.
    let mut areas: Vec<String> = template
        .areas
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| AREAS.contains(&value.as_str()))
        .collect();
    areas.dedup();
    let area = areas.first().cloned().unwrap_or_default();
    let areas = areas.join(",");
    let id = if let Some(id) = template.id {
        let changed = conn
            .execute(
                // Ab der ersten Bearbeitung gehört der Text dem Nutzer · der
                // Übersetzungsschlüssel der Standardeinheit fällt damit weg,
                // sonst überschriebe die nächste Sprachumstellung seine
                // Formulierung.
                "UPDATE study_templates SET title=?1, tool=?2,
                    description=?3, area=?4, areas=?5, i18n_key='', updated_ts=?6, deleted=0
                 WHERE id=?7",
                params![title, tool, description, area, areas, now, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Lerneinheit nicht gefunden".into());
        }
        id
    } else {
        conn.execute(
            "INSERT INTO study_templates
             (sync_key, title, duration_min, tool, description, area, areas,
              created_ts, updated_ts)
             VALUES (lower(hex(randomblob(16))), ?1, 0, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![title, tool, description, area, areas, now],
        )
        .map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };
    read_template(&conn, id)
}

/// Löscht eine Lerneinheit samt ihrer Termine.
///
/// Die fünf Standardeinheiten bleiben: an ihnen hängt der Wochenvorschlag, und
/// ein Bereich ohne Einheit fiele stillschweigend aus der Planung. Wer sie
/// nicht mag, benennt sie um.
#[tauri::command(async)]
pub fn delete_study_template(db: State<db::Db>, template_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let builtin: String = conn
        .query_row(
            "SELECT builtin FROM study_templates WHERE id = ?1",
            params![template_id],
            |r| r.get(0),
        )
        .map_err(|_| "Lerneinheit nicht gefunden".to_string())?;
    if !builtin.is_empty() {
        return Err("Standardeinheiten lassen sich nicht löschen".into());
    }
    let now = now_ts();
    conn.execute(
        "UPDATE study_events SET deleted = 1, updated_ts = ?2 WHERE template_id = ?1",
        params![template_id, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE study_templates SET deleted = 1, updated_ts = ?2 WHERE id = ?1",
        params![template_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Termine einer Serie ab `first_day`: der erste Tag plus jeder weitere im
/// Raster, bis `until` erreicht ist. Ohne Raster bleibt es bei einem Termin.
fn series_days(first_day: &str, rule: &str, until: Option<&str>) -> Result<Vec<String>, String> {
    let Some(start) = day_start_ts(first_day) else {
        return Err("Ungültiges Datum".into());
    };
    let Some(step) = repeat_step(rule) else {
        return Ok(vec![first_day.to_string()]);
    };
    let end = match until {
        Some(value) if !value.is_empty() => {
            day_start_ts(value).ok_or_else(|| "Ungültiges Enddatum".to_string())?
        }
        _ => start + default_horizon(rule) * 86_400,
    };
    if end < start {
        return Err("Das Enddatum liegt vor dem Starttermin".into());
    }
    let mut days = Vec::new();
    let mut cursor = start;
    while cursor <= end && days.len() < MAX_OCCURRENCES {
        days.push(iso_day(cursor));
        cursor += step * 86_400;
    }
    Ok(days)
}

/// Geplante Minuten eines neuen Termins · in 5er-Schritten und in dem Rahmen,
/// in dem eine Sitzung überhaupt eine Sitzung ist.
fn clamp_planned(minutes: i64) -> i64 {
    if minutes <= 0 {
        return 0;
    }
    (minutes.clamp(10, 90) as f64 / 5.0).round() as i64 * 5
}

/// Legt für jeden Tag einen Termin an; alle teilen `series_key` und Raster.
fn insert_units(
    conn: &Connection,
    template_id: i64,
    days: &[String],
    rule: &str,
    series_key: &str,
    planned_min: i64,
    source: &str,
) -> Result<usize, String> {
    let now = now_ts();
    for day in days {
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM study_events WHERE day = ?1",
                params![day],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO study_events
             (sync_key, template_id, day, position, created_ts, updated_ts,
              repeat_rule, series_key, planned_min, source)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8)",
            params![
                template_id,
                day,
                position,
                now,
                rule,
                series_key,
                planned_min,
                source
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(days.len())
}

#[tauri::command(async)]
pub fn schedule_study_unit(
    db: State<db::Db>,
    template_id: i64,
    day: String,
    repeat_rule: Option<String>,
    until: Option<String>,
    planned_min: Option<i64>,
) -> Result<usize, String> {
    if !valid_day(&day) {
        return Err("Ungültiges Datum".into());
    }
    let rule = repeat_rule.unwrap_or_default();
    if !rule.is_empty() && repeat_step(&rule).is_none() {
        return Err("Unbekanntes Wiederholungsraster".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    read_template(&conn, template_id)?;
    let days = series_days(&day, &rule, until.as_deref())?;
    let series_key = if rule.is_empty() {
        String::new()
    } else {
        new_series_key(&conn)?
    };
    insert_units(
        &conn,
        template_id,
        &days,
        &rule,
        &series_key,
        clamp_planned(planned_min.unwrap_or(0)),
        "",
    )
}

/// Eine Einheit aus dem Wochenvorschlag.
#[derive(Deserialize)]
pub struct PlannedUnitInput {
    pub template_id: i64,
    pub day: String,
    pub planned_min: i64,
}

/// Übernimmt einen Wochenvorschlag.
///
/// Der Vorschlag ist ein Regelkreis, kein einmaliger Wurf: er darf jederzeit
/// neu gezogen werden. Deshalb räumt er im Fenster seine *eigenen* offenen
/// Termine weg (`source = 'plan'`) und legt sie neu an. Von Hand geplante
/// Einheiten und alles bereits Erledigte bleiben unangetastet — sonst würde ein
/// zweiter Vorschlag die Woche entweder verdoppeln oder überschreiben.
#[tauri::command(async)]
pub fn apply_week_plan(
    db: State<db::Db>,
    from_day: String,
    to_day: String,
    units: Vec<PlannedUnitInput>,
) -> Result<usize, String> {
    if !valid_day(&from_day) || !valid_day(&to_day) || from_day > to_day {
        return Err("Ungültiger Planungszeitraum".into());
    }
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let now = now_ts();
    tx.execute(
        "UPDATE study_events SET deleted = 1, updated_ts = ?3
          WHERE source = 'plan' AND completed = 0 AND deleted = 0
            AND day >= ?1 AND day <= ?2",
        params![from_day, to_day, now],
    )
    .map_err(|e| e.to_string())?;
    let mut created = 0usize;
    for unit in &units {
        if !valid_day(&unit.day) || unit.day < from_day || unit.day > to_day {
            return Err("Tag liegt außerhalb des Planungszeitraums".into());
        }
        read_template(&tx, unit.template_id)?;
        created += insert_units(
            &tx,
            unit.template_id,
            std::slice::from_ref(&unit.day),
            "",
            "",
            clamp_planned(unit.planned_min),
            "plan",
        )?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(created)
}

/// Zufälliger Serienschlüssel · dieselbe Quelle wie die sync_keys.
fn new_series_key(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Macht aus einem geplanten Einzeltermin eine Serie: der Termin selbst bleibt
/// stehen und bekommt das Raster, die weiteren Termine kommen dazu. Gehört er
/// schon zu einer Serie, wird deren Zukunft ab diesem Tag neu gesetzt · so
/// bleibt Abgehaktes in der Vergangenheit unberührt.
#[tauri::command(async)]
pub fn repeat_study_unit(
    db: State<db::Db>,
    event_id: i64,
    repeat_rule: String,
    until: Option<String>,
) -> Result<usize, String> {
    if repeat_step(&repeat_rule).is_none() {
        return Err("Unbekanntes Wiederholungsraster".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (template_id, day, series_key): (i64, String, String) = conn
        .query_row(
            "SELECT template_id, day, series_key FROM study_events
             WHERE id = ?1 AND deleted = 0",
            params![event_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Geplante Einheit nicht gefunden".to_string())?;
    let now = now_ts();
    let series_key = if series_key.is_empty() {
        new_series_key(&conn)?
    } else {
        // Bestehende Serie: alles ab diesem Tag weicht der neuen Reihe.
        conn.execute(
            "UPDATE study_events SET deleted = 1, updated_ts = ?3
             WHERE series_key = ?1 AND day > ?2 AND deleted = 0",
            params![series_key, day, now],
        )
        .map_err(|e| e.to_string())?;
        series_key
    };
    let days = series_days(&day, &repeat_rule, until.as_deref())?;
    conn.execute(
        "UPDATE study_events SET repeat_rule = ?1, series_key = ?2, updated_ts = ?3
         WHERE id = ?4",
        params![repeat_rule, series_key, now, event_id],
    )
    .map_err(|e| e.to_string())?;
    // Der erste Tag der Reihe ist der Termin selbst · er wird nicht doppelt angelegt.
    // Die weiteren Termine erben die Länge des ersten.
    let planned_min: i64 = conn
        .query_row(
            "SELECT planned_min FROM study_events WHERE id = ?1",
            params![event_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    insert_units(
        &conn,
        template_id,
        &days[1..],
        &repeat_rule,
        &series_key,
        planned_min,
        "",
    )
}

#[tauri::command(async)]
pub fn move_study_unit(
    db: State<db::Db>,
    event_id: i64,
    day: String,
    position: i64,
) -> Result<(), String> {
    if !valid_day(&day) {
        return Err("Ungültiges Datum".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE study_events SET day = ?1, position = ?2, updated_ts = ?3
             WHERE id = ?4 AND deleted = 0",
            params![day, position.max(0), now_ts(), event_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Geplante Einheit nicht gefunden".into());
    }
    Ok(())
}

#[tauri::command(async)]
pub fn complete_study_unit(
    db: State<db::Db>,
    event_id: i64,
    completed: bool,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE study_events
         SET completed = ?1, completed_ts = ?2, updated_ts = ?3
         WHERE id = ?4 AND deleted = 0",
        params![
            completed,
            if completed { now_ts() } else { 0 },
            now_ts(),
            event_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Löscht eine geplante Einheit. `scope = "series"` löscht stattdessen diesen
/// und alle folgenden Termine derselben Serie · vergangene Termine bleiben, weil
/// dort schon abgehakt sein kann, was passiert ist.
#[tauri::command(async)]
pub fn delete_study_unit(
    db: State<db::Db>,
    event_id: i64,
    scope: Option<String>,
) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_ts();
    if scope.as_deref() == Some("series") {
        let series: Option<(String, String)> = conn
            .query_row(
                "SELECT series_key, day FROM study_events WHERE id = ?1",
                params![event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((key, day)) = series.filter(|(key, _)| !key.is_empty()) {
            return conn
                .execute(
                    "UPDATE study_events SET deleted = 1, updated_ts = ?3
                     WHERE series_key = ?1 AND day >= ?2 AND deleted = 0",
                    params![key, day, now],
                )
                .map_err(|e| e.to_string());
        }
    }
    conn.execute(
        "UPDATE study_events SET deleted = 1, updated_ts = ?2 WHERE id = ?1",
        params![event_id, now],
    )
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn study_data(app: tauri::AppHandle, db: State<db::Db>) -> Result<StudyData, String> {
    db.read(|conn| {
        let now = now_ts();
        let puzzle_goal = app
            .state::<settings::SettingsState>()
            .0
            .lock()
            .map(|s| s.puzzle_goal as i64)
            .unwrap_or(20);
        study_data_from_conn(conn, now, puzzle_goal)
    })
}

fn study_data_from_conn(
    conn: &Connection,
    now: i64,
    puzzle_goal: i64,
) -> Result<StudyData, String> {
    let today = now / 86_400;
    let day_start = today * 86_400;
    // One grouped pass covers both the last seven activity days and the next
    // seven due-date buckets (today is the shared middle element).
    let summary_days = study_days(conn, day_start - 6 * 86_400, day_start + 6 * 86_400, now)?;

    // ── Repertoire-Fälligkeiten ──────────────────────────────────────────────
    // my_move-Parität wie in repertoire.rs: Weiß trainiert ungerade Halbzüge.
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    let due_now: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts <= ?1)"
            ),
            params![now],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let due_week: Vec<i64> = summary_days[6..13]
        .iter()
        .map(|day| day.due_reviews)
        .collect();
    // Heute: alles, was bis Tagesende fällig ist (inkl. neuer Karten).

    // ── Backlog & Tagesziel ──────────────────────────────────────────────────
    let unanalyzed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM games
             WHERE analyzed = 0 AND analysis_excluded = 0 AND TRIM(moves) != ''",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let today_puzzle_attempts = summary_days[6].puzzle_attempts;
    // ── Aktivität der letzten 7 Tage ─────────────────────────────────────────
    let activity = summary_days[..7]
        .iter()
        .enumerate()
        .map(|(index, day)| DayActivity {
            day_ts: day_start - (6 - index as i64) * 86_400,
            puzzle_attempts: day.puzzle_attempts,
            puzzle_solved: day.puzzle_solved,
            endgame_attempts: day.endgame_attempts,
            rep_reviews: day.rep_reviews,
            game_reviews: day.game_reviews,
        })
        .collect();

    let streak = training_streak(conn, today)?;

    Ok(StudyData {
        due_now,
        due_week,
        unanalyzed,
        today_puzzle_attempts,
        puzzle_goal,
        activity,
        streak_days: streak,
    })
}

/// Zusammenhängende Tage mit irgendeiner Lernaktivität.
///
/// Steht hier und nicht in `reminder.rs`, obwohl die Erinnerung sie ebenfalls
/// braucht: Zwei Zählweisen für dieselbe Serie wären die sicherste Art, beiden
/// nicht mehr zu glauben · die Zahl im Kopf der App und die in der
/// Benachrichtigung müssen dieselbe sein.
///
/// `today` ist der Tagesindex (Sekunden / 86400, UTC wie überall in diesem
/// Modul).
pub(crate) fn training_streak(conn: &Connection, today: i64) -> Result<i64, String> {
    let mut days: BTreeSet<i64> = BTreeSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT ts / 86400 FROM puzzle_attempts
             UNION SELECT ts / 86400 FROM endgame_attempts
             UNION SELECT ts / 86400 FROM rep_review_log
             UNION SELECT e.completed_ts / 86400
               FROM study_events e JOIN study_templates t ON t.id = e.template_id
              WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
                AND (t.areas LIKE '%analysis%'
                         OR LOWER(t.tool) LIKE '%analys%'
                         OR LOWER(t.title) LIKE '%analys%')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    for day in rows {
        days.insert(day.map_err(|e| e.to_string())?);
    }
    let mut streak = 0i64;
    // Heute zählt, sobald etwas passiert ist; sonst ab gestern rückwärts.
    let mut expect = if days.contains(&today) { today } else { today - 1 };
    while days.contains(&expect) {
        streak += 1;
        expect -= 1;
    }
    Ok(streak)
}
