// ── Block J · Wirkungsfenster ────────────────────────────────────────────────
//
// Eine Kennzahl für einen beliebigen Zeitraum, mit Stichprobe und Streuung.
// Beides zusammen ist der Punkt: ohne die Streuung lässt sich nicht sagen, ob
// eine Veränderung mehr ist als das übliche Rauschen, und genau das entscheidet
// im Study-Reiter zwischen „wirkt" und „noch nicht messbar".
//
// Gerechnet wird immer neu aus den Rohdaten · es gibt bewusst keine
// gespeicherten Momentaufnahmen (siehe die Migration in `db.rs`).

/// Einheit einer Kennzahl · steuert Formatierung und Rauschgrenze im Frontend.
/// `pct` = Prozent, `per100` = Ereignisse je 100 Züge, `elo` = Ratingpunkte.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MetricValue {
    pub key: String,
    pub value: Option<f64>,
    /// Stichprobe: Partien, Züge oder Versuche · je nach Kennzahl.
    pub n: i64,
    /// Streuung der Einzelwerte, wo eine sinnvoll ist (sonst None · dann
    /// rechnet das Frontend die Grenze aus dem Verteilungsmodell).
    pub sd: Option<f64>,
    pub unit: String,
    /// Ist ein kleinerer Wert besser? Patzer ja, Genauigkeit nein.
    pub lower_is_better: bool,
}

/// Ratingstand eines Pools im Fenster. Ratings verschiedener Formate und
/// Plattformen sind nicht vergleichbar · deshalb reisen sie getrennt und
/// werden erst im Frontend über `formatScale.ts` auf eine Skala gebracht.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RatingPoint {
    pub source: String,
    pub time_class: String,
    pub first: i64,
    pub last: i64,
    pub games: i64,
}

#[derive(Deserialize)]
pub struct WindowSpec {
    pub from_ts: i64,
    pub to_ts: i64,
}

#[derive(Serialize, Default)]
pub struct MetricWindow {
    pub from_ts: i64,
    pub to_ts: i64,
    pub games: i64,
    pub metrics: Vec<MetricValue>,
    pub ratings: Vec<RatingPoint>,
}

fn metric(
    key: &str,
    value: Option<f64>,
    n: i64,
    sd: Option<f64>,
    unit: &str,
    lower: bool,
) -> MetricValue {
    MetricValue {
        key: key.into(),
        value: value.map(r1),
        n,
        sd: sd.map(r1),
        unit: unit.into(),
        lower_is_better: lower,
    }
}

fn sd_of(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let m = mean(values)?;
    let var = values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - 1) as f64;
    Some(var.sqrt())
}

/// Kennzahlen eines Fensters aus den vorbereiteten Partien.
fn metrics_for_window(
    views: &[&GameView],
    puzzles: &[(i64, bool, i64)],
    from_ts: i64,
    to_ts: i64,
) -> MetricWindow {
    let mut points = Vec::new();
    let mut accuracies: Vec<f64> = Vec::new();
    // Je Phase: eigene gewertete Züge, davon Patzer, davon Fehler, plus Verluste.
    let mut phase_moves = [0i64; 3];
    let mut phase_blunders = [0i64; 3];
    let mut phase_losses: [Vec<f64>; 3] = Default::default();
    let mut errors = 0i64;
    let (mut trouble_moves, mut safe_moves) = (0i64, 0i64);
    let (mut book_checked, mut book_stayed) = (0i64, 0i64);
    let mut ratings: BTreeMap<(String, String), (i64, i64, i64)> = BTreeMap::new();

    for view in views {
        let raw = view.raw;
        points.push(raw.score());
        if let Some(accuracy) = raw.accuracy {
            accuracies.push(accuracy);
        }
        if raw.my_elo > 0 {
            let entry = ratings
                .entry((raw.source.clone(), raw.time_class.clone()))
                .or_insert((raw.my_elo, raw.my_elo, 0));
            // `views` kommt aufsteigend sortiert · erster Eintrag bleibt stehen.
            entry.1 = raw.my_elo;
            entry.2 += 1;
        }
        if !view.evals.is_empty() {
            book_checked += 1;
            if view.book_departure.is_none() {
                book_stayed += 1;
            }
        }
        let clocks = view.clocks.as_ref();
        let trouble_limit = clocks.map(|c| c.initial * 0.10);
        for ev in view.evals {
            if !raw.mine(ev.ply) {
                continue;
            }
            let index = phase_index(&ev.phase);
            phase_moves[index] += 1;
            if let Some(loss) = view.loss(ev.ply) {
                phase_losses[index].push(loss);
            }
            match ev.judgment.as_str() {
                "blunder" => {
                    phase_blunders[index] += 1;
                    errors += 1;
                }
                "mistake" => errors += 1,
                _ => {}
            }
            if let (Some(clocks), Some(limit)) = (clocks, trouble_limit) {
                if clocks.before(ev.ply) < limit {
                    trouble_moves += 1;
                } else {
                    safe_moves += 1;
                }
            }
        }
    }

    let all_moves: i64 = phase_moves.iter().sum();
    let all_blunders: i64 = phase_blunders.iter().sum();
    let all_losses: Vec<f64> = phase_losses.iter().flatten().copied().collect();

    let mut metrics = vec![
        metric(
            "score_pct",
            mean(&points).map(|v| v * 100.0),
            points.len() as i64,
            sd_of(&points).map(|v| v * 100.0),
            "pct",
            false,
        ),
        metric(
            "acc_overall",
            mean(&accuracies),
            accuracies.len() as i64,
            sd_of(&accuracies),
            "pct",
            false,
        ),
        metric(
            "blunders_per100",
            if all_moves > 0 {
                Some(all_blunders as f64 / all_moves as f64 * 100.0)
            } else {
                None
            },
            all_moves,
            None,
            "per100",
            true,
        ),
        metric(
            "errors_per100",
            if all_moves > 0 {
                Some(errors as f64 / all_moves as f64 * 100.0)
            } else {
                None
            },
            all_moves,
            None,
            "per100",
            true,
        ),
        metric(
            "avg_loss",
            mean(&all_losses).map(|v| v * 100.0),
            all_moves,
            sd_of(&all_losses).map(|v| v * 100.0),
            "pct",
            true,
        ),
    ];

    for (index, phase) in PHASES.iter().enumerate() {
        metrics.push(metric(
            &format!("blunders_{phase}_per100"),
            if phase_moves[index] > 0 {
                Some(phase_blunders[index] as f64 / phase_moves[index] as f64 * 100.0)
            } else {
                None
            },
            phase_moves[index],
            None,
            "per100",
            true,
        ));
        metrics.push(metric(
            &format!("acc_{phase}"),
            accuracy_from_losses(&phase_losses[index]),
            phase_moves[index],
            None,
            "pct",
            false,
        ));
    }

    metrics.push(metric(
        "trouble_pct",
        if trouble_moves + safe_moves > 0 {
            Some(trouble_moves as f64 / (trouble_moves + safe_moves) as f64 * 100.0)
        } else {
            None
        },
        trouble_moves + safe_moves,
        None,
        "pct",
        true,
    ));
    metrics.push(metric(
        "in_book_pct",
        if book_checked > 0 {
            Some(book_stayed as f64 / book_checked as f64 * 100.0)
        } else {
            None
        },
        book_checked,
        None,
        "pct",
        false,
    ));

    // Puzzles: die schnellste Rückmeldung im ganzen Satz · sie reagiert
    // tagesgenau, während Partiekennzahlen Wochen brauchen.
    let window_puzzles: Vec<&(i64, bool, i64)> = puzzles
        .iter()
        .filter(|(ts, _, _)| *ts >= from_ts && *ts < to_ts)
        .collect();
    let solved = window_puzzles.iter().filter(|(_, ok, _)| *ok).count() as i64;
    let rated: Vec<f64> = window_puzzles
        .iter()
        .filter(|(_, _, rating)| *rating > 0)
        .map(|(_, _, rating)| *rating as f64)
        .collect();
    metrics.push(metric(
        "puzzle_solve_pct",
        if window_puzzles.is_empty() {
            None
        } else {
            Some(solved as f64 / window_puzzles.len() as f64 * 100.0)
        },
        window_puzzles.len() as i64,
        None,
        "pct",
        false,
    ));
    metrics.push(metric(
        "puzzle_rating",
        mean(&rated),
        rated.len() as i64,
        sd_of(&rated),
        "elo",
        false,
    ));

    MetricWindow {
        from_ts,
        to_ts,
        games: views.len() as i64,
        metrics,
        ratings: ratings
            .into_iter()
            .map(|((source, time_class), (first, last, games))| RatingPoint {
                source,
                time_class,
                first,
                last,
                games,
            })
            .collect(),
    }
}

/// Kennzahlen für mehrere Zeitfenster in einem Durchlauf.
///
/// Der Study-Reiter fragt typischerweise zwei an — vor und seit dem
/// Fokusstart —, die Trainingsbilanz eine Reihe von Wochen.
#[tauri::command]
pub async fn study_metrics(
    app: tauri::AppHandle,
    windows: Vec<WindowSpec>,
) -> Result<Vec<MetricWindow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        db.read(|conn| {
            metrics_from_conn(conn, &windows)
        })
    })
    .await
    .map_err(|e| format!("Wirkungsmessung fehlgeschlagen: {e}"))?
}

/// Höchstzahl gleichzeitig angefragter Fenster · schützt vor einem Aufruf, der
/// die Datenbank für jeden Tag eines Jahres einmal durchgeht.
const MAX_WINDOWS: usize = 64;

fn metrics_from_conn(
    conn: &Connection,
    windows: &[WindowSpec],
) -> Result<Vec<MetricWindow>, String> {
    if windows.is_empty() {
        return Ok(Vec::new());
    }
    if windows.len() > MAX_WINDOWS {
        return Err("Zu viele Zeitfenster angefragt".into());
    }
    let games = load_games(conn)?;
    let evals = load_evals(conn)?;
    let nodes = repertoire::load_nodes(conn).unwrap_or_default();
    let children = repertoire::book_children(&nodes);

    let mut asc: Vec<&RawGame> = games.iter().collect();
    asc.sort_by_key(|g| (g.played_ts, g.id));

    let empty: Vec<Ev> = Vec::new();
    let mut views: Vec<GameView> = Vec::with_capacity(asc.len());
    for game in &asc {
        let rows = evals.get(&game.id).unwrap_or(&empty);
        let wp = rows
            .iter()
            .map(|ev| win_prob(ev.eval_cp, ev.mate_in))
            .collect();
        let (book_departure, book_plies) = book_progress(&nodes, &children, game);
        views.push(GameView {
            raw: game,
            evals: rows,
            wp,
            clocks: clocks_of(game),
            book_departure,
            book_plies,
        });
    }

    let puzzles = load_puzzle_attempts(conn)?;

    Ok(windows
        .iter()
        .map(|window| {
            let selected: Vec<&GameView> = views
                .iter()
                .filter(|v| v.raw.played_ts >= window.from_ts && v.raw.played_ts < window.to_ts)
                .collect();
            metrics_for_window(&selected, &puzzles, window.from_ts, window.to_ts)
        })
        .collect())
}

/// Puzzleversuche als (Zeitpunkt, gelöst, Aufgabenrating).
fn load_puzzle_attempts(conn: &Connection) -> Result<Vec<(i64, bool, i64)>, String> {
    let mut stmt = conn
        .prepare("SELECT ts, solved, puzzle_rating FROM puzzle_attempts ORDER BY ts")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? != 0, r.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    rows
}

// ── Lehrreichste Partie ──────────────────────────────────────────────────────

/// Die Partie mit dem größten Lernwert: der größte einzelne Ausschlag der
/// Gewinnwahrscheinlichkeit aus eigener Sicht, gewichtet danach, ob er die
/// Partie tatsächlich gedreht hat.
fn spotlight(views: &[GameView]) -> Option<Spotlight> {
    let mut best: Option<(f64, Spotlight)> = None;
    // Nur die jüngere Vergangenheit · eine Lehre von vor zwei Jahren hilft nicht.
    for view in views.iter().rev().take(60) {
        if view.evals.is_empty() {
            continue;
        }
        for ply in 1..=view.evals.len() as i64 {
            if !view.raw.mine(ply) {
                continue;
            }
            let Some(loss) = view.loss(ply) else { continue };
            let Some(before) = view
                .cp_mine(ply - 1)
                .or(if ply == 1 { Some(0.0) } else { None })
            else {
                continue;
            };
            let Some(after) = view.cp_mine(ply) else {
                continue;
            };
            // Interessant ist der Zug, der Gewinn zu Nicht-Gewinn macht.
            let kind = if before >= 200.0 && after < 50.0 {
                "missed_win"
            } else if before > -50.0 && after <= -200.0 {
                "collapse"
            } else {
                continue;
            };
            let magnitude = loss * 100.0;
            if best.as_ref().map(|(m, _)| magnitude > *m).unwrap_or(true) {
                best = Some((
                    magnitude,
                    Spotlight {
                        game_id: view.raw.id,
                        ply,
                        kind: kind.to_string(),
                        magnitude: r1(magnitude),
                        opponent: String::new(),
                        played_at: String::new(),
                    },
                ));
            }
        }
    }
    best.map(|(_, s)| s)
}
