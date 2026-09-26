// ── Tauri-Commands ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SyncInfo {
    pub running: bool,
    pub addr: Option<String>,
    pub code: String,
    pub fingerprint: String,
    pub host: String,
    pub last_sync: i64,
}

/// Dateizugriff (Code, Zertifikat) und eine Datenbanksperre · beides gehört
/// nicht in den Hauptthread, sonst wartet auf Android die Oberfläche mit.
#[tauri::command]
pub async fn sync_info(app: tauri::AppHandle) -> Result<SyncInfo, String> {
    tauri::async_runtime::spawn_blocking(move || collect_sync_info(&app))
        .await
        .map_err(|e| format!("Sync-Status fehlgeschlagen: {e}"))?
}

fn collect_sync_info(app: &tauri::AppHandle) -> Result<SyncInfo, String> {
    let code = ensure_code(app)?;
    #[cfg(desktop)]
    let fingerprint = tls_material(app)?.fingerprint;
    #[cfg(not(desktop))]
    let fingerprint = String::new();
    let (host, running) = {
        let s = app.state::<settings::SettingsState>();
        let host = s.0.lock().map(|s| s.sync_host.clone()).unwrap_or_default();
        (host, app.state::<SyncServer>().0.load(Ordering::SeqCst))
    };
    let last_sync = {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db::meta_get(&conn, "sync_last_ts")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    };
    Ok(SyncInfo {
        running,
        addr: local_ip().map(|ip| format!("{ip}:{SYNC_PORT}")),
        code,
        fingerprint,
        host,
        last_sync,
    })
}

#[tauri::command(async)]
pub fn sync_server_start(app: tauri::AppHandle) -> Result<SyncInfo, String> {
    start_server(&app)?;
    collect_sync_info(&app)
}

/// Pairing per QR-Code: Adresse, Code und Zertifikats-Fingerprint in eine
/// `kiebitz://sync?...`-URI packen, die das Handy scannt. Die eingebettete Adresse
/// ist die LAN-IP des Desktops · sie ist im Heim-WLAN *und* über das
/// Fritzbox-WireGuard erreichbar (die Fritzbox routet das Heimnetz in den
/// Tunnel), anders als die UDP-Broadcast-Discovery, die Subnetzgrenzen nicht
/// überschreitet. Deshalb funktioniert QR-Pairing auch entfernt über VPN.
#[derive(Serialize)]
pub struct PairInfo {
    /// URI mit Adresse, Code und TLS-Fingerprint (im QR kodiert).
    pub uri: String,
    /// Kodierte Adresse "ip:port".
    pub addr: String,
    pub code: String,
    /// SHA-256-Fingerprint des selbstsignierten Hub-Zertifikats.
    pub fingerprint: String,
    /// Fertiges SVG des QR-Codes (schwarz auf weiß, mit Quiet-Zone).
    pub qr_svg: String,
}

/// Baut die Pairing-URI aus Adresse, Code und TLS-Fingerprint.
#[cfg(any(desktop, test))]
pub fn pair_uri(addr: &str, code: &str, fingerprint: &str) -> String {
    format!("kiebitz://sync?host={addr}&code={code}&fingerprint={fingerprint}")
}

/// Erzeugt ein eigenständiges QR-SVG (nur die Kernkodierung von `qrcode`,
/// kein optionales Renderer-Feature): ein Pfad aus 1×1-Modulen auf weißem Grund.
#[cfg(desktop)]
fn qr_svg(data: &str) -> Result<String, String> {
    use qrcode::{Color, QrCode};
    let code = QrCode::new(data.as_bytes()).map_err(|e| e.to_string())?;
    let w = code.width();
    let quiet = 4usize;
    let n = w + quiet * 2;
    let colors = code.to_colors();
    let mut path = String::new();
    for (i, c) in colors.iter().enumerate() {
        if *c == Color::Dark {
            let x = i % w + quiet;
            let y = i / w + quiet;
            path.push_str(&format!("M{x} {y}h1v1h-1z"));
        }
    }
    Ok(format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {n} {n}' \
         shape-rendering='crispEdges'><rect width='{n}' height='{n}' fill='#ffffff'/>\
         <path d='{path}' fill='#0b0b0b'/></svg>"
    ))
}

/// Desktop-Hub: Pairing-Infos inkl. QR-SVG. Mobile ist Client · dort Stub.
#[cfg(desktop)]
#[tauri::command(async)]
pub fn sync_pair(app: tauri::AppHandle) -> Result<PairInfo, String> {
    let code = ensure_code(&app)?;
    let fingerprint = tls_material(&app)?.fingerprint;
    let addr = local_ip()
        .map(|ip| format!("{ip}:{SYNC_PORT}"))
        .ok_or("Keine LAN-Adresse gefunden.")?;
    let uri = pair_uri(&addr, &code, &fingerprint);
    let qr_svg = qr_svg(&uri)?;
    Ok(PairInfo {
        uri,
        addr,
        code,
        fingerprint,
        qr_svg,
    })
}

/// Mobile-Stub: das Handy zeigt keinen QR (es scannt ihn nur).
#[cfg(not(desktop))]
#[tauri::command(async)]
pub fn sync_pair(_app: tauri::AppHandle) -> Result<PairInfo, String> {
    Err("QR-Pairing wird nur auf dem Desktop-Hub angezeigt.".into())
}

/// Handy: sucht den Desktop-Hub per UDP-Broadcast im lokalen Netz.
/// Liefert "ip:port" oder None, wenn nichts antwortet.
#[tauri::command]
pub async fn sync_discover() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        sock.set_broadcast(true).map_err(|e| e.to_string())?;
        let _ = sock.set_read_timeout(Some(std::time::Duration::from_millis(600)));
        let mut buf = [0u8; 64];
        for _ in 0..3 {
            let _ = sock.send_to(DISCOVER_MSG, ("255.255.255.255", DISCOVERY_PORT));
            if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                let msg = String::from_utf8_lossy(&buf[..n]).to_string();
                if let Some(port) = msg.strip_prefix(DISCOVER_REPLY) {
                    return Ok(Some(format!("{}:{}", peer.ip(), port.trim())));
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct SyncSummary {
    pub games_pulled: usize,
    pub rep_merged: usize,
    pub own_puzzles_pulled: usize,
    pub puzzle_attempts_pulled: usize,
    pub endgame_attempts_pulled: usize,
    pub study_merged: usize,
}

/// Client-Seite: kompletter Sync-Roundtrip gegen den Desktop-Hub.
#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (host, code, fingerprint) = {
            let s = app.state::<settings::SettingsState>();
            let s = s.0.lock().map_err(|e| e.to_string())?;
            (
                s.sync_host.clone(),
                s.sync_code.clone(),
                s.sync_fingerprint.clone(),
            )
        };
        if host.is_empty() {
            return Err("Keine Sync-Adresse konfiguriert.".into());
        }
        let tls_config = pinned_tls_config(&fingerprint)?;

        // Lokalen Stand einsammeln (kurz locken, dann Netz ohne Lock).
        let (since, request) = {
            let db = app.state::<db::Db>();
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let since: i64 = db::meta_get(&conn, "sync_last_ts")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let req = SyncRequest {
                code,
                since,
                games: collect_games(&conn, since)?,
                game_tombstones: collect_game_tombstones(&conn)?,
                rep_nodes: collect_rep(&conn)?,
                rep_tombstones: collect_tombstones(&conn)?,
                puzzle_attempts: collect_puzzle_attempts(&conn, since)?,
                endgame_attempts: collect_endgame_attempts(&conn, since)?,
                study_templates: collect_study_templates(&conn, since)?,
                study_events: collect_study_events(&conn, since)?,
                rep_reviews: collect_rep_reviews(&conn, since)?,
                study_sessions: collect_study_sessions(&conn, since)?,
                prefs: collect_prefs(&conn)?,
            };
            (since, req)
        };
        let _ = since;

        let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        let agent = ureq::AgentBuilder::new()
            .https_only(true)
            .tls_config(tls_config)
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(600))
            .build();
        let resp = agent
            .post(&format!("https://{host}/sync"))
            .set("Content-Type", "application/json")
            .send_string(&body)
            .map_err(|e| format!("Sync fehlgeschlagen: {e}"))?;
        let resp: SyncResponse = serde_json::from_reader(resp.into_reader().take(MAX_BODY as u64))
            .map_err(|e| format!("Antwort unlesbar: {e}"))?;

        let db = app.state::<db::Db>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        apply_game_tombstones(&mut conn, &resp.game_tombstones)?;
        let games_pulled = apply_games(&mut conn, &resp.games)?;
        apply_tombstones(&mut conn, &resp.rep_tombstones)?;
        let rep_merged = apply_rep(&mut conn, &resp.rep_nodes)?;
        let own_puzzles_pulled = match &resp.own_puzzles {
            Some(puzzles) => apply_own_puzzles(&mut conn, puzzles)?,
            None => 0,
        };
        let pz = apply_puzzle_attempts(&conn, &resp.puzzle_attempts)?;
        if pz > 0 {
            replay_puzzle_ratings(&mut conn)?;
        }
        let eg = apply_endgame_attempts(&conn, &resp.endgame_attempts)?;
        let study_templates = apply_study_templates(&conn, &resp.study_templates)?;
        let study_events = apply_study_events(&conn, &resp.study_events)?;
        let rep_reviews = apply_rep_reviews(&conn, &resp.rep_reviews)?;
        let study_sessions = apply_study_sessions(&conn, &resp.study_sessions)?;
        // Wochenbudget und Trainingstage können vom anderen Gerät kommen ·
        // der laufende Einstellungs-Zustand muss ihnen sofort folgen, sonst
        // rechnet der Lernplan bis zum Neustart mit dem alten Ziel weiter.
        let prefs = apply_prefs(&conn, &resp.prefs)?;
        if prefs > 0 {
            settings::refresh_study_prefs(&app, &conn);
        }
        db::meta_set(&conn, "sync_last_ts", &resp.now.to_string())?;
        Ok(SyncSummary {
            games_pulled,
            rep_merged,
            own_puzzles_pulled,
            puzzle_attempts_pulled: pz,
            endgame_attempts_pulled: eg,
            study_merged: study_templates
                + study_events
                + rep_reviews
                + study_sessions
                + prefs,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
