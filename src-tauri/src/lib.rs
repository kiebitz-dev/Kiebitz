mod ads;
mod analysis;
mod billing;
mod build_info;
mod cbh;
mod chess;
mod chessdb;
mod db;
mod db3;
mod diag;
mod endgame;
mod engine;
mod explorer;
mod insights;
mod legal;
mod live;
mod motifs;
mod plus;
mod puzzles;
mod refdb;
mod reminder;
mod rep_pgn;
mod repertoire;
mod review;
mod settings;
mod share;
mod study;
mod sync;
mod systembars;
mod updater;
mod verdict;
mod widgets;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct AppInfo {
    version: String,
    backend: String,
    /// Betriebssystem ("windows", "android", …) · steuert u. a. die Sync-UI.
    platform: String,
    /// Vertriebskanal; Play-Builds dürfen keine externen APK-Updates anbieten.
    distribution: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        // Version aus tauri.conf.json (das Feld, das beim Release erhöht wird),
        // nicht aus Cargo.toml · sonst driften Anzeige und Release auseinander.
        version: app.package_info().version.to_string(),
        backend: "tauri".to_string(),
        platform: std::env::consts::OS.to_string(),
        distribution: build_info::distribution_channel().to_string(),
    }
}

#[derive(Serialize)]
struct EngineInfo {
    available: bool,
    name: String,
    path: String,
}

/// Sucht die Engine: konfigurierter Pfad aus den Einstellungen zuerst,
/// dann `KIEBITZ_ENGINE`, dann die gebündelte Stockfish (Dev-Ordner
/// `src-tauri/binaries/` bzw. App-Ressourcen im Release).
pub(crate) fn resolve_engine(app: &tauri::AppHandle) -> Option<PathBuf> {
    let configured = app
        .state::<settings::SettingsState>()
        .0
        .lock()
        .ok()
        .and_then(|s| s.engine_path.clone());
    if let Some(custom) = configured {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(custom) = std::env::var("KIEBITZ_ENGINE") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    // Android: Stockfish liegt als libstockfish.so im nativeLibraryDir der
    // App · dem einzigen Ort, aus dem Android das Ausführen erlaubt. Den
    // Ordner liefert der Ladepfad unserer eigenen Bibliothek (libapp_lib.so)
    // in /proc/self/maps.
    #[cfg(target_os = "android")]
    if let Ok(maps) = std::fs::read_to_string("/proc/self/maps") {
        for line in maps.lines() {
            let Some(idx) = line.find('/') else { continue };
            let path = line[idx..].trim();
            if path.ends_with("/libapp_lib.so") {
                if let Some(p) = std::path::Path::new(path)
                    .parent()
                    .map(|dir| dir.join("libstockfish.so"))
                    .filter(|p| p.exists())
                {
                    return Some(p);
                }
                break;
            }
        }
    }

    let exe = if cfg!(windows) {
        "stockfish.exe"
    } else {
        "stockfish"
    };

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(exe);
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("binaries").join(exe);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
fn engine_info(app: tauri::AppHandle) -> EngineInfo {
    match resolve_engine(&app) {
        // Do not start Stockfish just to render the Analysis page. The former
        // UCI handshake was repeated by the first live analysis and blocked
        // the UI noticeably, especially on Android.
        Some(path) => {
            let file_name = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Engine");
            let name = if file_name.to_ascii_lowercase().contains("stockfish") {
                format!("Stockfish {}", env!("KIEBITZ_STOCKFISH_VERSION"))
            } else {
                file_name.to_string()
            };
            EngineInfo {
                available: true,
                name,
                path: path.to_string_lossy().to_string(),
            }
        }
        None => EngineInfo {
            available: false,
            name: "Keine Engine gefunden".to_string(),
            path: String::new(),
        },
    }
}

#[tauri::command]
fn list_games_for_export(db: tauri::State<db::Db>) -> Result<Vec<db::GameRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_games(&conn)
}

#[tauri::command]
fn list_game_summaries(db: tauri::State<db::Db>) -> Result<Vec<db::GameSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_game_summaries(&conn)
}

#[tauri::command]
fn game_detail(db: tauri::State<db::Db>, id: i64) -> Result<db::GameRecord, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::get_game(&conn, id)
}

#[tauri::command]
fn list_games_page(
    db: tauri::State<db::Db>,
    request: db::GamePageRequest,
) -> Result<db::GamePage, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_games_page(&conn, &request)
}

#[tauri::command]
fn upsert_games(
    db: tauri::State<db::Db>,
    games: Vec<db::GameRecord>,
) -> Result<db::UpsertResult, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db::upsert_games(&mut conn, &games)
}

#[tauri::command]
fn set_game_note(db: tauri::State<db::Db>, id: i64, note: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_note(&conn, id, &note)
}

#[tauri::command]
fn set_game_tags(
    db: tauri::State<db::Db>,
    id: i64,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_tags(&conn, id, &tags)
}

#[tauri::command]
fn delete_game(db: tauri::State<db::Db>, id: i64) -> Result<bool, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db::delete_game(&mut conn, id)
}

#[tauri::command]
fn read_pgn_file(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein PGN-Pfad angegeben.".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("PGN nicht lesbar: {e}"))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("PGN-Datei ist größer als 64 MB.".into());
    }
    std::fs::read_to_string(path).map_err(|e| format!("PGN nicht lesbar: {e}"))
}

#[tauri::command]
fn write_pgn_file(path: String, contents: String) -> Result<usize, String> {
    use std::io::Write;
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Exportpfad angegeben.".into());
    }
    if path.exists() {
        return Err("Die Zieldatei existiert bereits.".into());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("PGN nicht speicherbar: {e}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("PGN nicht speicherbar: {e}"))?;
    Ok(contents.len())
}

#[tauri::command]
fn db_stats(db: tauri::State<db::Db>) -> Result<db::DbStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::stats(&conn)
}

/// Ein Merker der Oberfläche, der einen Neuaufbau der WebView überleben muss.
///
/// Kleinigkeiten wie „diese Meldung habe ich gelesen" lagen bisher im
/// `localStorage`. Der ist auf dem Desktop aber kein dauerhafter Speicher,
/// sondern das Profil der WebView: ein Update, ein zurückgesetztes
/// Edge-WebView2-Profil oder eine geleerte Chromium-Datenablage nehmen ihn mit.
/// Sichtbar wurde das am Wochenbericht, der nach jeder Installation wieder
/// ungelesen leuchtete.
///
/// Deshalb liegen solche Merker in der `meta`-Tabelle der kiebitz.db. Sie ist
/// gerätelokal und reist bewusst nicht im Sync mit: Ob der Bericht auf dem
/// Handy schon gelesen wurde, sagt über den Desktop nichts aus.
#[tauri::command]
fn ui_flag_get(db: tauri::State<db::Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(db::meta_get(&conn, &ui_flag_key(&key)))
}

#[tauri::command]
fn ui_flag_set(db: tauri::State<db::Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::meta_set(&conn, &ui_flag_key(&key), &value)
}

/// Eigener Namensraum in `meta` · dort stehen sonst Wanderungsmarken des
/// Schemas, und ein Merker der Oberfläche darf keinen davon überschreiben
/// können.
fn ui_flag_key(key: &str) -> String {
    format!("ui.{key}")
}

/// Dauer-Analyse über die persistente Engine: `info`-Zeilen kommen als
/// `engine://info-batch`-Events. Liefert die Generation dieser Anfrage.
#[tauri::command]
async fn analyze_live(
    app: tauri::AppHandle,
    fen: String,
    depth: Option<u32>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve_engine(&app).ok_or("Keine Engine gefunden")?;
        let live_depth = app
            .state::<settings::SettingsState>()
            .0
            .lock()
            .map(|s| s.live_depth)
            .unwrap_or(24);
        app.state::<live::LiveEngine>().analyze(
            &app,
            &path.to_string_lossy(),
            &fen,
            depth.unwrap_or(live_depth).clamp(6, 40),
        )
    })
    .await
    .map_err(|e| format!("Engine-Start fehlgeschlagen: {e}"))?
}

#[tauri::command]
async fn stop_live(app: tauri::AppHandle) {
    // A process pipe or engine-state mutex must never stall Tauri's command
    // dispatcher, especially while Android is busy scheduling Stockfish.
    let _ = tauri::async_runtime::spawn_blocking(move || {
        app.state::<live::LiveEngine>().stop();
    })
    .await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logbuch und Panic-Hook zuerst · alles, was danach schiefgeht, ist damit
    // im Diagnosebericht sichtbar, auch wenn kein Fenster mehr aufgeht.
    diag::install();
    // Von der Aufgabenplanung gestartet: erinnern und beenden, ohne Fenster.
    #[cfg(desktop)]
    if reminder::run_headless("de.torim.kiebitz") {
        return;
    }
    let mut builder = tauri::Builder::default();

    // Muss vor allen anderen Plugins stehen · und vor allem vor dem
    // Deep-Link-Plugin.
    //
    // Klickt jemand den Anmeldelink, während Kiebitz schon läuft, startet
    // Windows einen zweiten Prozess und übergibt ihm die URL als Argument. Die
    // laufende Instanz erfährt davon nichts, und der zweite Prozess stritte
    // sich mit ihr um dieselbe SQLite-Datei. Diese Weiche gibt die URL an die
    // offene Instanz weiter und beendet den Zweitstart; das Fenster kommt nach
    // vorn, damit sichtbar wird, dass etwas passiert ist.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    // Alle Plugins gehören an den Builder, nicht in den Setup-Hook · auf Android
    // hängt sonst die App beim Start schwarz.
    //
    // Tauri baut in `setup()` zuerst die Fenster aus der Konfiguration und ruft
    // erst danach unseren Hook auf. Der WebView lädt zu diesem Zeitpunkt schon
    // seine Startseite und fragt dabei aus dem Android-UI-Thread heraus per JNI
    // in Rust zurück (`shouldOverride`). `register_android_plugin` schickt
    // seinerseits Arbeit auf genau diesen UI-Thread und wartet blockierend auf
    // das Ergebnis. Beide warten dann aufeinander: Der UI-Thread kommt nicht aus
    // dem Callback, unser Thread nicht aus der Registrierung, die Seite wird nie
    // geladen — sichtbar bleibt die Hintergrundfarbe des Fensters.
    //
    // Am Builder registrierte Plugins richtet Tauri dagegen in `build()` ein,
    // bevor das erste Fenster existiert. Dann ist der UI-Thread frei und die
    // Registrierung kehrt sofort zurück.
    builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Anmeldung per Magic-Link: Die API bietet nach dem Bestätigen
        // `kiebitz://auth?code=…` an, das Betriebssystem reicht die URL an
        // diese Instanz weiter. Android registriert das Schema über den
        // Intent-Filter im Manifest; auf dem Desktop übernimmt das der
        // Installer, und die Laufzeitregistrierung im Setup deckt zusätzlich
        // portable Starts und die Entwicklung ab.
        .plugin(tauri_plugin_deep_link::init());

    // QR-Scanner (nur Mobile): das Handy liest den Pairing-QR des Desktops.
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    #[cfg(target_os = "android")]
    {
        builder = builder
            // Android rendert Werbung als native Google-AdView über dem vom
            // React-Layout reservierten Platz. Desktop verwendet keinen
            // Google-Code, weil AdSense in Desktopsoftware nicht zulässig ist.
            .plugin(ads::init())
            // Konto- und Entitlement-Token liegen auf Android im Keystore.
            .plugin(plus::init())
            // Homescreen-Widgets · nur Android, und ausdrücklich nur dort.
            .plugin(widgets::init())
            // Kiebitz Plus auf Android kauft man über Google Play, nicht über
            // Stripe · so verlangt es Google für digitale Inhalte in der App.
            .plugin(billing::init())
            // Geteilte Stellungen gehen über das Systemblatt hinaus · den Weg
            // dorthin kennt nur Android selbst.
            .plugin(share::init())
            // Status- und Navigationsleiste folgen dem Thema, nicht dem
            // Nachtmodus des Geräts · sonst stehen bei einem hellen Thema
            // weiße Symbole auf hellem Grund.
            .plugin(systembars::init());
        // Die Play-In-App-Review-API existiert nur im Play-Build. Der
        // eigentliche Aufruf kommt aus der UI ausschließlich nach einem
        // Erfolgsmoment; beim App-Start wird bewusst nichts angefordert.
        //
        // Dasselbe gilt für die Update-Brücke: Play-Apps dürfen sich nur über
        // Play aktualisieren, und der GitHub-Weg der Sideload-Builds existiert
        // in diesem Build nicht.
        #[cfg(feature = "play-store")]
        {
            builder = builder.plugin(review::init()).plugin(updater::init());
        }
    }

    builder
        .setup(|app| {
            // Das Fenster startet unsichtbar (tauri.conf.json) · erst einfärben,
            // dann zeigen, sonst blitzt beim Start die blaue Systemtitelleiste
            // auf. Beides passiert vor allem Fehlbaren hier unten: geht die
            // Datenbank nicht auf, ist immer noch ein Fenster da, das die
            // Meldung zeigen kann.
            if let Some(window) = app.get_webview_window("main") {
                // Der Standardton · das gewählte Thema meldet die Oberfläche
                // gleich nach dem ersten Bild über `set_system_bars` nach.
                systembars::apply_default(&window);
                let _ = window.show();
            }
            if cfg!(debug_assertions) {
                // `diag::install()` hat den globalen Logger in der Regel schon
                // belegt · dann lehnt das Plugin ab. Das ist kein Grund, den
                // Start abzubrechen, geloggt wird ohnehin über diag.
                if let Err(e) = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                ) {
                    log::warn!("Log-Plugin nicht registriert: {e}");
                }
            }
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register("kiebitz") {
                    log::warn!("Deep-Link-Schema nicht registriert: {e}");
                }
            }
            // Windows verwirft Toasts unbekannter Absender · AppUserModelID
            // registrieren, bevor die erste Erinnerung ansteht. Das Zeichen
            // daneben ist die PNG neben den Einstellungen: Windows liest für
            // `IconUri` eine Bilddatei, keine `.ico`, und im Hintergrundlauf
            // gibt es kein Ressourcenverzeichnis.
            #[cfg(windows)]
            {
                let identifier = app.handle().config().identifier.clone();
                reminder::register_windows_app_id(
                    &identifier,
                    "Kiebitz",
                    reminder::notify_icon_path(&identifier),
                );
            }

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            diag::set_log_file(data_dir.join("kiebitz.log"));
            diag::record(
                "info",
                "app",
                &format!(
                    "Start · Kiebitz {} auf {}",
                    app.package_info().version,
                    std::env::consts::OS
                ),
            );

            let mut loaded = settings::load(app.handle());
            // Konfigurierter DB-Pfad, mit Fallback auf den Standardort, falls
            // er nicht erreichbar ist (z. B. Nextcloud-Ordner nicht gemountet).
            let mut db_file = loaded
                .db_path
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("kiebitz.db"));
            let conn = match rusqlite::Connection::open(&db_file) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "Datenbank unter {db_file:?} nicht erreichbar ({e}); nutze Standardort"
                    );
                    db_file = data_dir.join("kiebitz.db");
                    rusqlite::Connection::open(&db_file)?
                }
            };
            db::init(&conn).map_err(std::io::Error::other)?;
            // Das Trainingsprogramm steht in der Datenbank und reist mit dem
            // Sync · es überschreibt hier die Kopie aus der settings.json.
            settings::adopt_study_prefs(&conn, &mut loaded);
            app.manage(settings::SettingsState(std::sync::Mutex::new(loaded)));
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            app.manage(analysis::DbPath(std::sync::Mutex::new(db_file)));
            app.manage(analysis::AnalysisState::default());
            app.manage(live::LiveEngine::default());
            app.manage(endgame::EndgameEngine::default());
            app.manage(puzzles::PuzzleImportState::default());
            app.manage(refdb::RefDbState::default());
            app.manage(sync::SyncServer::default());

            // Sync-Server (Desktop-Hub) automatisch starten, wenn aktiviert.
            // Nur auf dem Desktop sinnvoll · das Handy ist im v1-Modell Client.
            #[cfg(desktop)]
            {
                let sync_enabled = app
                    .state::<settings::SettingsState>()
                    .0
                    .lock()
                    .map(|s| s.sync_enabled)
                    .unwrap_or(false);
                if sync_enabled {
                    if let Err(e) = sync::start_server(app.handle()) {
                        log::warn!("Sync-Server nicht gestartet: {e}");
                    }
                }
            }

            // Erklärungen für den Bestand nachtragen · einmal je Datenstand.
            //
            // Der Lauf braucht keine Engine (siehe `backfill_explanations`),
            // aber er liest und schreibt über den ganzen Bestand. Deshalb
            // gehört er in einen eigenen Thread mit eigener Verbindung: Der
            // erste Bildaufbau soll nicht auf tausend Partien warten, und die
            // Verbindung der App soll nicht minutenlang gesperrt sein.
            {
                let state = app.state::<analysis::DbPath>();
                let db_file = state.0.lock().map(|path| path.clone());
                if let Ok(db_file) = db_file {
                    std::thread::spawn(move || {
                        let Ok(conn) = rusqlite::Connection::open(&db_file) else {
                            return;
                        };
                        let _ = conn.pragma_update(None, "busy_timeout", "10000");
                        match analysis::backfill_explanations(&conn) {
                            Ok(0) => {}
                            Ok(count) => log::info!("Erklärungen nachgetragen: {count} Partien"),
                            Err(error) => log::warn!("Erklärungen nicht nachgetragen: {error}"),
                        }
                    });
                }
            }

            // Auto-Update (nur Desktop): Plugin registrieren und beim Start
            // prüfen; ist die Einstellung aktiv, wird direkt installiert, sonst
            // nur eine Benachrichtigung ans Frontend geschickt. Android-
            // Sideload-Builds haben einen manuellen GitHub-Pfad; Play-Builds
            // liefern in updater.rs ausschließlich Store-Stubs.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                let auto_update = app
                    .state::<settings::SettingsState>()
                    .0
                    .lock()
                    .map(|s| s.auto_update)
                    .unwrap_or(false);
                updater::spawn_startup_check(app.handle(), auto_update);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            ads::set_ad_banner,
            ads::show_ad_privacy_options,
            review::request_play_review,
            engine_info,
            analyze_live,
            stop_live,
            list_games_for_export,
            list_game_summaries,
            game_detail,
            list_games_page,
            upsert_games,
            set_game_note,
            set_game_tags,
            delete_game,
            read_pgn_file,
            write_pgn_file,
            db_stats,
            ui_flag_get,
            ui_flag_set,
            analysis::start_analysis,
            analysis::cancel_analysis,
            analysis::index_positions,
            analysis::game_analysis,
            analysis::error_stats,
            analysis::search_position,
            insights::deep_insights,
            insights::study_metrics,
            repertoire::rep_list,
            repertoire::rep_add_line,
            repertoire::rep_delete,
            repertoire::rep_due,
            repertoire::rep_review,
            repertoire::rep_stats,
            repertoire::rep_node_games,
            repertoire::rep_set_note,
            repertoire::rep_set_name,
            repertoire::rep_reorder,
            repertoire::rep_lookup,
            repertoire::rep_gaps,
            repertoire::rep_import_pgn,
            repertoire::rep_import_pgn_file,
            repertoire::rep_export_pgn_file,
            puzzles::import_puzzles,
            puzzles::next_puzzle,
            puzzles::record_attempt,
            puzzles::puzzle_stats,
            puzzles::puzzle_insights,
            puzzles::puzzle_history,
            reminder::notify_now,
            reminder::sync_reminder_schedule,
            reminder::save_reminder_snapshot,
            settings::get_settings,
            settings::set_settings,
            settings::test_engine,
            settings::move_database,
            settings::use_database,
            settings::backup_database,
            settings::restore_database,
            settings::db_info,
            settings::factory_reset,
            share::share_position,
            share::write_share_image,
            plus::plus_secret_get,
            plus::plus_secret_set,
            plus::plus_secret_delete,
            widgets::widget_snapshot_write,
            billing::billing_available,
            billing::billing_purchase,
            billing::billing_restore,
            billing::billing_acknowledge,
            chessdb::chessdb_query,
            explorer::explorer_query,
            refdb::refdb_status,
            refdb::refdb_precheck,
            refdb::refdb_import,
            refdb::refdb_cancel_import,
            refdb::refdb_delete_source,
            refdb::refdb_clear,
            refdb::refdb_query,
            refdb::refdb_game,
            endgame::endgame_move,
            endgame::endgame_record,
            endgame::endgame_stats,
            study::study_data,
            study::study_calendar,
            study::save_study_template,
            study::delete_study_template,
            study::schedule_study_unit,
            study::apply_week_plan,
            study::repeat_study_unit,
            study::move_study_unit,
            study::complete_study_unit,
            study::delete_study_unit,
            study::training_program,
            study::record_study_time,
            sync::sync_info,
            sync::sync_server_start,
            sync::sync_now,
            sync::sync_discover,
            sync::sync_pair,
            updater::check_update,
            updater::install_update,
            legal::legal_documents,
            legal::legal_document,
            diag::log_event,
            diag::diag_logs,
            diag::diag_clear,
            diag::diag_log_path,
            diag::diag_report,
            diag::diag_save_report,
            systembars::set_system_bars
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
