//! Persistente App-Einstellungen: eine settings.json im Config-Verzeichnis.
//! Die Datei liegt bewusst NICHT in der SQLite-Datenbank, damit der
//! Datenbank-Pfad selbst konfigurierbar bleibt (Henne-Ei-Problem).

use crate::{analysis, db, endgame, live, puzzles};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// UI-Sprache: "de" oder "en".
    pub locale: String,
    /// Abweichender Speicherort der kiebitz.db (None = App-Datenverzeichnis).
    pub db_path: Option<String>,
    /// Eigene UCI-Engine (None = gebündelte Stockfish / KIEBITZ_ENGINE).
    pub engine_path: Option<String>,
    /// 0 = automatisch (Kerne − 2).
    pub engine_threads: u32,
    pub engine_hash_mb: u32,
    pub engine_multipv: u32,
    /// Zieltiefe der Live-Analyse.
    pub live_depth: u32,
    /// Tiefe der Hintergrund-Analyse (Auto-Analyse-Pipeline).
    pub batch_depth: u32,
    /// Ordner mit Syzygy-Tablebases (None = keine); Endspiel-Trainer und
    /// Engine nutzen sie für perfektes Endspiel.
    pub syzygy_path: Option<String>,
    /// Online-Eröffnungsbuch chessdb.cn (Cloud-Evals), cache-gestützt.
    pub chessdb_enabled: bool,
    /// Eröffnungs-Explorer von Lichess (Häufigkeiten aus Meister- und
    /// Online-Partien), cache-gestützt · siehe explorer.rs.
    pub explorer_enabled: bool,
    /// Rating-Bänder der Lichess-Datenbank als Kommaliste ("1600,1800").
    /// Leer = alle Bänder · das ist "die Masse", gefiltert ist es "meine Klasse".
    pub explorer_ratings: String,
    /// Zeitkontrollen der Lichess-Datenbank als Kommaliste. Leer = alle.
    pub explorer_speeds: String,
    /// Neue Partien beim Start und im Hintergrund nachladen.
    pub auto_import: bool,
    pub cc_user: String,
    pub li_user: String,
    /// Anzeigename fürs Dashboard (leer = chess.com-/Lichess-Benutzername).
    pub display_name: String,
    /// Farbwelt der Oberfläche · Liste in THEMES, Farben in src/themes.css.
    /// Gerätelokal und bewusst nicht im Sync: Das Handy am Abend und der
    /// Desktop am Tag dürfen verschieden stehen.
    pub theme: String,
    /// Feldfarben des Bretts ("auto" = das Brett des Themas).
    pub board_set: String,
    /// Zeichnungen der Figuren ("classic" = der Satz des Bretts).
    pub piece_set: String,
    /// Wann `theme_night` übernimmt: "off", "system" (Vorgabe des
    /// Betriebssystems) oder "time" (Nachtfenster unten).
    pub theme_auto: String,
    /// Thema der Dunkelphase des automatischen Wechsels.
    pub theme_night: String,
    /// Nachtfenster als lokale "HH:MM" · nur bei theme_auto = "time".
    pub theme_night_from: String,
    pub theme_night_to: String,
    /// Diagramm-Modus ("Das Blatt") · experimenteller Layoutmodus, der die
    /// Oberfläche als Buchseite im Turnierformular-Satz setzt. Er verändert
    /// ausschließlich das Layout; die Farbwelt oben bleibt unberührt. Wie die
    /// übrigen Erscheinungsbild-Werte gerätelokal und nicht im Sync.
    pub diagram_mode: bool,
    /// Anmerkungen der Auto-Analyse nur zu den eigenen Zügen zeigen.
    ///
    /// Die Analyse rechnet weiter über die ganze Partie — Genauigkeit und
    /// Bilanz brauchen beide Seiten. Zurückgehalten wird allein die Anzeige:
    /// Wer eine Partie nachspielt, um an sich zu arbeiten, will nicht neben
    /// jedem gegnerischen Zug lesen, was der falsch gemacht hat. Ab Werk aus,
    /// weil die Fehler des Gegners erklären, warum die Partie so lief.
    pub annotate_own_only: bool,
    /// Monatsfenster für den Schnell-Import ("Neueste importieren").
    pub import_months: u32,
    /// Puzzle-Tagesziel (Versuche pro Tag) für Dashboard und Lernplan.
    pub puzzle_goal: u32,
    /// Motiv der laufenden Aufgabe im Puzzle-Training verdecken. Der Hinweis
    /// („Grundreihenmatt“) nimmt einen Teil der Aufgabe vorweg; wer das nicht
    /// will, blendet ihn aus. Ab Werk bleibt er sichtbar.
    pub puzzle_hide_theme: bool,
    /// Höchstzahl fälliger Repertoire-Züge je Trainingssitzung (0 = alle).
    pub rep_due_limit: u32,
    /// Höchstzahl neuer Repertoire-Züge je Trainingssitzung (0 = alle).
    /// Ein frisch importiertes Buch bringt sonst hunderte auf einmal mit.
    pub rep_new_limit: u32,
    /// Zug- und Schlagklänge auf allen Brettern.
    pub sound_enabled: bool,
    /// Lautstärke der Brettklänge in Prozent.
    pub sound_volume: u32,
    /// Beim Start im Hintergrund nach Updates suchen und sie installieren.
    pub auto_update: bool,
    /// Sync-Server (Desktop als Hub) beim Start mitstarten.
    pub sync_enabled: bool,
    /// Pairing-Code für den Geräte-Sync (leer = noch nie aktiviert;
    /// wird beim ersten Aktivieren generiert).
    pub sync_code: String,
    /// Mobile: Adresse des Desktop-Hubs ("host:port").
    pub sync_host: String,
    /// SHA-256-Fingerprint des Hub-Zertifikats. Wird ausschließlich durch den
    /// QR-Pairing-Link gesetzt und pinnt den selbstsignierten HTTPS-Endpunkt.
    pub sync_fingerprint: String,
    /// Mobile: automatisch im Hintergrund synchronisieren (bei Änderungen,
    /// per Timer und bei App-Fokus), statt manuell in den Settings.
    pub sync_auto: bool,
    /// Tägliche Erinnerung an anstehendes Training (Desktop und Android).
    pub notify_enabled: bool,
    /// Uhrzeit der Erinnerung als lokale "HH:MM".
    pub notify_time: String,
    /// Welche Fälligkeiten die Erinnerung nennt.
    pub notify_study: bool,
    pub notify_repertoire: bool,
    pub notify_puzzles: bool,
    pub notify_endgame: bool,
    pub notify_analysis: bool,
    /// Wochenbericht am Montagabend statt der Erinnerung dieses Tages.
    /// Ab Werk an · er ersetzt die Meldung, statt eine zweite zu sein.
    pub notify_weekly: bool,
    /// Trainingsbudget in Minuten pro Woche · Obergrenze für den Wochenplan.
    /// 0 = keine Vorgabe, dann leitet der Plan das Budget aus der bisherigen
    /// Aktivität ab (die Historie weiß besser als die Selbsteinschätzung, was
    /// realistisch ist · die Eingabe ist die Grenze, nicht die Schätzung).
    pub weekly_minutes: u32,
    /// Wochentage, an denen trainiert wird · Bitmaske, Bit 0 = Montag.
    /// 0 = keine Vorgabe (alle Tage erlaubt).
    pub training_days: u32,
    /// Optionales Zieldatum ("YYYY-MM-DD"), z. B. ein Turnier. Leer = keins.
    pub goal_date: String,
    /// Wurde die Ersteinrichtung durchlaufen? Steuert das Onboarding.
    pub onboarded: bool,
    /// Pseudonyme Nutzungsstatistik · ab Werk an, jederzeit abschaltbar.
    ///
    /// Ab Werk aus hieß in der Praxis aus: Ein Schalter, den niemand sucht,
    /// wird von den wenigen gefunden, die ihn ohnehin gutheißen, und eine Zahl,
    /// die nur diese wenigen zählt, taugt zu keiner Entscheidung. Deshalb ist
    /// die Statistik ab Werk an und der Schalter der Weg hinaus, nicht hinein.
    /// Wer sie abschaltet, bleibt abgeschaltet · dieses Feld ist die einzige
    /// Stelle, die darüber entscheidet.
    pub analytics_enabled: bool,
    /// Kennung dieser Installation für die Statistik (leer = noch keine).
    ///
    /// Gerätelokal und bewusst nicht im Sync: Zwei gekoppelte Geräte sind zwei
    /// Installationen. Sie wird erst beim ersten Lebenszeichen erzeugt und
    /// bleibt danach stabil · wechselte sie bei jedem Start, zählte jeder Start
    /// als neue Installation. Die API sieht ohnehin nur ihren HMAC.
    pub analytics_installation_id: String,
}

/// "YYYY-MM-DD" oder leer · alles andere wird verworfen, statt später in
/// Datumsrechnungen als stiller Unsinn aufzutauchen.
fn normalize_day(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() || value.len() != 10 {
        return String::new();
    }
    let bytes = value.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return String::new();
    }
    let ok = |range: std::ops::Range<usize>, lo: u32, hi: u32| {
        value[range]
            .parse::<u32>()
            .is_ok_and(|v| (lo..=hi).contains(&v))
    };
    if ok(0..4, 1970, 2999) && ok(5..7, 1, 12) && ok(8..10, 1, 31) {
        value.to_string()
    } else {
        String::new()
    }
}

/// Eine UUID in Kleinschreibung oder leer.
///
/// Die API prüft das Format ihrerseits und lehnt ab, was ihr nicht gefällt;
/// hier steht dieselbe Prüfung, damit gar nichts Unbrauchbares gespeichert wird
/// und der Fehler nicht erst als abgewiesenes Lebenszeichen auffällt.
fn normalize_installation_id(value: &str) -> String {
    let value = value.trim().to_lowercase();
    let groups = [8usize, 4, 4, 4, 12];
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != groups.len() {
        return String::new();
    }
    let shaped = parts
        .iter()
        .zip(groups)
        .all(|(part, len)| part.len() == len && part.bytes().all(|b| b.is_ascii_hexdigit()));
    if shaped {
        value
    } else {
        String::new()
    }
}

/// "HH:MM" auf eine gültige Uhrzeit begrenzen; Unsinn fällt auf `fallback`
/// zurück. Die Erinnerung und das Nachtfenster haben verschiedene Vorgaben.
fn normalize_time_or(value: &str, fallback: &str) -> String {
    let (Some(hours), Some(minutes)) = (
        value.get(0..2).and_then(|h| h.parse::<u32>().ok()),
        value.get(3..5).and_then(|m| m.parse::<u32>().ok()),
    ) else {
        return fallback.into();
    };
    if value.as_bytes().get(2) != Some(&b':') || hours > 23 || minutes > 59 {
        return fallback.into();
    }
    format!("{hours:02}:{minutes:02}")
}

/// Uhrzeit der täglichen Erinnerung; Unsinn fällt auf 18:00 zurück.
fn normalize_time(value: &str) -> String {
    normalize_time_or(value, "18:00")
}

/// Ein Wert aus `allowed` oder dessen erster Eintrag als Rückfallebene.
/// Deckt alte Dateien und ein Gerät ab, das eine neuere Fassung geschrieben
/// hat: Ein unbekanntes Thema soll die Oberfläche nicht farblos lassen.
fn normalize_choice(value: &str, allowed: &[&str]) -> String {
    let value = value.trim();
    if allowed.contains(&value) {
        value.to_string()
    } else {
        allowed[0].to_string()
    }
}

impl Default for Settings {
    fn default() -> Self {
        // Mobile: konservative Engine-Defaults (Akku/Thermik) · weniger
        // Threads, kleiner Hash, geringere Tiefe als auf dem Desktop.
        #[cfg(target_os = "android")]
        let (threads, hash, live, batch) = (2, 64, 14, 10);
        #[cfg(not(target_os = "android"))]
        let (threads, hash, live, batch) = (0, 256, 24, 14);
        Self {
            // Englisch ist die kleinste gemeinsame Basis; umstellbar bleibt es.
            locale: "en".into(),
            db_path: None,
            engine_path: None,
            engine_threads: threads,
            engine_hash_mb: hash,
            engine_multipv: 3,
            live_depth: live,
            batch_depth: batch,
            syzygy_path: None,
            // Beide Komfortfunktionen sind ab Werk an; abschaltbar bleiben sie.
            chessdb_enabled: true,
            explorer_enabled: true,
            // Ab Werk der ganze Bestand · wer seine eigene Klasse sehen will,
            // grenzt in den Einstellungen ein.
            explorer_ratings: String::new(),
            explorer_speeds: String::new(),
            auto_import: true,
            cc_user: String::new(),
            li_user: String::new(),
            display_name: String::new(),
            theme: "dark".into(),
            board_set: "auto".into(),
            piece_set: "classic".into(),
            theme_auto: "off".into(),
            theme_night: "dusk".into(),
            theme_night_from: "19:00".into(),
            theme_night_to: "07:00".into(),
            diagram_mode: false,
            annotate_own_only: false,
            import_months: 3,
            puzzle_goal: 20,
            puzzle_hide_theme: false,
            rep_due_limit: 20,
            rep_new_limit: 5,
            sound_enabled: true,
            sound_volume: 70,
            auto_update: true,
            sync_enabled: false,
            sync_code: String::new(),
            sync_host: String::new(),
            sync_fingerprint: String::new(),
            sync_auto: false,
            notify_enabled: false,
            notify_time: "18:00".into(),
            notify_study: true,
            notify_repertoire: true,
            notify_puzzles: true,
            notify_endgame: true,
            notify_analysis: true,
            notify_weekly: true,
            weekly_minutes: 0,
            training_days: 0,
            goal_date: String::new(),
            onboarded: false,
            // Die Statistik ist ab Werk an · sonst zählt sie nur die Neugierigen.
            analytics_enabled: true,
            analytics_installation_id: String::new(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

// ── Trainingsprogramm: geteilt statt gerätelokal ────────────────────────────
//
// Wochenbudget, Trainingstage und Zieldatum beschreiben *einen*
// Trainingsplan, nicht die Einrichtung eines Geräts. Solange sie in der
// settings.json lagen, rechnete jedes Gerät mit einem anderen Wochenziel — der
// Desktop mit 84 Minuten, das Handy mit 114, beide aus ihrer eigenen Historie
// abgeleitet, weil ohne Vorgabe der beobachtete Schnitt einsprang. Deshalb
// liegen sie jetzt in `study_prefs` und reisen mit dem Sync.
//
// Die `Settings`-Struktur behält die Felder: die Oberfläche kennt weiter genau
// eine Einstellungsseite, und nur diese Datei weiß, dass drei Werte woanders
// zu Hause sind.

fn pref_value(settings: &Settings, key: &str) -> String {
    match key {
        "weekly_minutes" => settings.weekly_minutes.to_string(),
        "training_days" => settings.training_days.to_string(),
        _ => settings.goal_date.clone(),
    }
}

fn apply_pref(settings: &mut Settings, key: &str, value: &str) {
    match key {
        "weekly_minutes" => settings.weekly_minutes = value.parse().unwrap_or(0),
        "training_days" => settings.training_days = value.parse().unwrap_or(0),
        "goal_date" => settings.goal_date = value.to_string(),
        _ => {}
    }
}

/// Legt die geteilten Werte über die geladene settings.json.
///
/// Fehlt ein Wert noch, wandert der bisherige aus der Datei hinein. Ein
/// unveränderter Standardwert bekommt dabei den Zeitstempel 1: er ist keine
/// Entscheidung, und ein Gerät, auf dem tatsächlich etwas eingestellt wurde,
/// soll ihn beim ersten Sync überschreiben statt umgekehrt.
pub fn adopt_study_prefs(conn: &Connection, settings: &mut Settings) {
    let defaults = Settings::default();
    let now = db::now_ts();
    for key in db::STUDY_PREF_KEYS {
        match db::study_pref_get(conn, key) {
            Some(value) => apply_pref(settings, key, &value),
            None => {
                let value = pref_value(settings, key);
                let touched = value != pref_value(&defaults, key);
                let _ = db::study_pref_set(conn, key, &value, if touched { now } else { 1 });
            }
        }
    }
}

/// Schreibt die geteilten Werte zurück · nach jeder Änderung durch den Nutzer.
pub fn store_study_prefs(conn: &Connection, settings: &Settings) -> Result<(), String> {
    let now = db::now_ts();
    for key in db::STUDY_PREF_KEYS {
        db::study_pref_set(conn, key, &pref_value(settings, key), now)?;
    }
    Ok(())
}

/// Übernimmt Werte, die der Sync gebracht hat, in den laufenden Zustand.
/// Gibt zurück, ob sich dabei etwas geändert hat.
pub fn refresh_study_prefs(app: &tauri::AppHandle, conn: &Connection) -> bool {
    let state = app.state::<SettingsState>();
    let Ok(mut settings) = state.0.lock() else {
        return false;
    };
    let before = settings.clone();
    for key in db::STUDY_PREF_KEYS {
        if let Some(value) = db::study_pref_get(conn, key) {
            apply_pref(&mut settings, key, &value);
        }
    }
    *settings = normalize(settings.clone());
    before.weekly_minutes != settings.weekly_minutes
        || before.training_days != settings.training_days
        || before.goal_date != settings.goal_date
}

/// Oberflächensprachen · muss mit LOCALES in src/lib/i18n.tsx übereinstimmen.
/// Ein unbekannter Wert (alte Datei, fremdes Gerät) fällt auf Englisch zurück.
pub const LOCALES: [&str; 7] = ["en", "de", "es", "fr", "hi", "ar", "zh"];

/// Farbwelten · muss mit THEMES in src/lib/theme.ts übereinstimmen. Der erste
/// Eintrag ist die Rückfallebene.
const THEMES: [&str; 8] = [
    "dark", "light", "dusk", "graphite", "paper", "contrast", "signal", "rose",
];

/// Brett-Sets · muss mit BOARD_SETS in src/lib/theme.ts übereinstimmen.
const BOARD_SETS: [&str; 6] = ["auto", "forest", "graphite", "sepia", "ice", "contrast"];

/// Figurensets · muss mit PIECE_SETS in src/lib/pieces/sets.ts übereinstimmen.
const PIECE_SETS: [&str; 6] = [
    "classic", "kiebitz", "monolith", "merida", "fantasy", "chessnut",
];

/// Auslöser des automatischen Themenwechsels.
const AUTO_MODES: [&str; 3] = ["off", "system", "time"];

fn normalize(mut s: Settings) -> Settings {
    if !LOCALES.contains(&s.locale.as_str()) {
        s.locale = "en".into();
    }
    // Stockfish can run as batch + live process at the same time. Bounding the
    // batch table prevents a manual "Max" setting from paging out the WebView;
    // live analysis applies the tighter 128 MiB cap in engine.rs.
    s.engine_hash_mb = s.engine_hash_mb.clamp(16, 512);
    // The live panel renders at most three lines. Asking Stockfish for more
    // would spend CPU and bridge bandwidth on invisible variations.
    s.engine_multipv = s.engine_multipv.clamp(1, 3);
    s.live_depth = s.live_depth.clamp(8, 40);
    s.batch_depth = s.batch_depth.clamp(6, 30);
    s.engine_threads = s.engine_threads.min(128);
    s.import_months = s.import_months.clamp(1, 240);
    s.puzzle_goal = s.puzzle_goal.clamp(1, 200);
    s.rep_due_limit = s.rep_due_limit.min(500);
    s.rep_new_limit = s.rep_new_limit.min(500);
    s.sound_volume = s.sound_volume.min(100);
    // 0 bleibt 0 ("keine Vorgabe"); alles andere auf eine sinnvolle Woche.
    if s.weekly_minutes > 0 {
        s.weekly_minutes = s.weekly_minutes.clamp(30, 3000);
    }
    s.training_days &= 0b111_1111;
    s.goal_date = normalize_day(&s.goal_date);
    s.cc_user = s.cc_user.trim().to_string();
    s.li_user = s.li_user.trim().to_string();
    s.display_name = s.display_name.trim().to_string();
    s.engine_path = s
        .engine_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.db_path = s
        .db_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.syzygy_path = s
        .syzygy_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.notify_time = normalize_time(&s.notify_time);
    s.theme = normalize_choice(&s.theme, &THEMES);
    s.board_set = normalize_choice(&s.board_set, &BOARD_SETS);
    s.piece_set = normalize_choice(&s.piece_set, &PIECE_SETS);
    s.theme_auto = normalize_choice(&s.theme_auto, &AUTO_MODES);
    s.theme_night = normalize_choice(&s.theme_night, &THEMES);
    s.theme_night_from = normalize_time_or(&s.theme_night_from, "19:00");
    s.theme_night_to = normalize_time_or(&s.theme_night_to, "07:00");
    s.sync_fingerprint = s
        .sync_fingerprint
        .trim()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_lowercase();
    // Die Statistik-Kennung existiert nur, solange die Statistik an ist. Wer
    // sie abschaltet, lässt keine Kennung zurück, die beim späteren Einschalten
    // wieder auftauchte · das Abschalten wäre sonst nur halb wahr. Die Regel
    // steht hier und nicht in der Oberfläche, damit sie für jeden Weg gilt, der
    // Einstellungen schreibt.
    s.analytics_installation_id = if s.analytics_enabled {
        normalize_installation_id(&s.analytics_installation_id)
    } else {
        String::new()
    };
    s
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Lädt die Einstellungen; fehlende/kaputte Datei ergibt Defaults.
pub fn load(app: &tauri::AppHandle) -> Settings {
    let Ok(path) = config_file(app) else {
        return Settings::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .map(normalize)
        .unwrap_or_default()
}

pub(crate) fn save(app: &tauri::AppHandle, s: &Settings) -> Result<(), String> {
    let path = config_file(app)?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Einstellungen nicht speicherbar: {e}"))
}

#[tauri::command]
pub fn get_settings(state: tauri::State<SettingsState>) -> Result<Settings, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// Speichert neue Einstellungen und wendet sie an. Die Live-Engine wird
/// beendet, damit sie beim nächsten Zug mit den neuen Optionen startet.
#[tauri::command]
pub async fn set_settings(
    app: tauri::AppHandle,
    new_settings: Settings,
) -> Result<Settings, String> {
    // Persisting settings and restarting a currently thinking engine both use
    // blocking OS primitives. In particular the endgame engine owns its mutex
    // until Stockfish returns a move; never make the IPC executor wait on it.
    tauri::async_runtime::spawn_blocking(move || {
        let normalized = normalize(new_settings);
        save(&app, &normalized)?;
        // Das Trainingsprogramm gehört in die Datenbank, damit es beim Sync
        // mitreist · die settings.json behält nur noch eine Kopie davon.
        if let Ok(conn) = app.state::<db::Db>().0.lock() {
            store_study_prefs(&conn, &normalized)?;
        }
        *app.state::<SettingsState>()
            .0
            .lock()
            .map_err(|e| e.to_string())? = normalized.clone();
        app.state::<live::LiveEngine>().shutdown();
        app.state::<endgame::EndgameEngine>().shutdown();
        Ok(normalized)
    })
    .await
    .map_err(|e| format!("Einstellungen konnten nicht angewendet werden: {e}"))?
}

#[derive(Serialize)]
pub struct EngineTest {
    pub ok: bool,
    pub name: String,
    pub path: String,
}

/// Testet eine Engine (expliziter Pfad oder die aktuell aufgelöste).
#[tauri::command]
pub async fn test_engine(app: tauri::AppHandle, path: Option<String>) -> EngineTest {
    tauri::async_runtime::spawn_blocking(move || test_engine_blocking(&app, path))
        .await
        .unwrap_or_else(|e| EngineTest {
            ok: false,
            name: format!("Engine-Test fehlgeschlagen: {e}"),
            path: String::new(),
        })
}

fn test_engine_blocking(app: &tauri::AppHandle, path: Option<String>) -> EngineTest {
    let resolved = match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p.trim());
            if p.exists() {
                Some(p)
            } else {
                return EngineTest {
                    ok: false,
                    name: "Datei nicht gefunden".into(),
                    path: p.to_string_lossy().to_string(),
                };
            }
        }
        None => crate::resolve_engine(app),
    };
    match resolved {
        Some(p) => match crate::engine::UciEngine::spawn(&p.to_string_lossy()) {
            Ok(uci) => EngineTest {
                ok: true,
                name: uci.name().to_string(),
                path: p.to_string_lossy().to_string(),
            },
            Err(e) => EngineTest {
                ok: false,
                name: e,
                path: p.to_string_lossy().to_string(),
            },
        },
        None => EngineTest {
            ok: false,
            name: "Keine Engine gefunden".into(),
            path: String::new(),
        },
    }
}

// ── Datenbank-Speicherort ────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub games: i64,
    pub puzzles: i64,
    pub is_default: bool,
}

fn default_db_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kiebitz.db"))
}

fn ensure_workers_idle(app: &tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<analysis::AnalysisState>()
        .running
        .load(Ordering::SeqCst)
    {
        return Err("Bitte zuerst die laufende Analyse stoppen.".into());
    }
    if app
        .state::<puzzles::PuzzleImportState>()
        .0
        .load(Ordering::SeqCst)
    {
        return Err("Bitte warten, bis der Puzzle-Import abgeschlossen ist.".into());
    }
    Ok(())
}

/// Öffnet die Datenbank am neuen Ort und tauscht alle States aus.
fn switch_to(app: &tauri::AppHandle, path: PathBuf) -> Result<DbInfo, String> {
    let conn = Connection::open(&path).map_err(|e| format!("Öffnen fehlgeschlagen: {e}"))?;
    db::init(&conn)?;
    *app.state::<db::Db>().0.lock().map_err(|e| e.to_string())? = conn;
    *app.state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = path.clone();

    let settings_state = app.state::<SettingsState>();
    let mut settings = settings_state.0.lock().map_err(|e| e.to_string())?.clone();
    let is_default = default_db_file(app).map(|d| d == path).unwrap_or(false);
    settings.db_path = if is_default {
        None
    } else {
        Some(path.to_string_lossy().to_string())
    };
    save(app, &settings)?;
    *settings_state.0.lock().map_err(|e| e.to_string())? = settings;
    collect_db_info(app)
}

/// Verschiebt die Datenbank: konsistente Kopie per VACUUM INTO, dann Umschalten.
/// Die alte Datei bleibt als Sicherung liegen.
#[tauri::command]
pub fn move_database(app: tauri::AppHandle, target: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let target = PathBuf::from(target.trim());
    if target.as_os_str().is_empty() {
        return Err("Kein Zielpfad angegeben.".into());
    }
    if target.exists() {
        return Err(
            "Die Zieldatei existiert bereits · nutze „Vorhandene Datenbank verwenden“.".into(),
        );
    }
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "VACUUM INTO ?1",
            rusqlite::params![target.to_string_lossy()],
        )
        .map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;
    }
    switch_to(&app, target)
}

/// Nutzt eine Datenbank an einem anderen Ort (z. B. im Nextcloud-Ordner eines
/// zweiten Geräts). Existiert die Datei nicht, wird dort eine neue angelegt.
#[tauri::command]
pub fn use_database(app: tauri::AppHandle, path: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Pfad angegeben.".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Ordner nicht anlegbar: {e}"))?;
    }
    switch_to(&app, path)
}

/// Erstellt über die SQLite Online Backup API einen konsistenten Snapshot.
fn backup_to(source: &Connection, target: &std::path::Path) -> Result<(), String> {
    if target.exists() {
        return Err("Die Sicherungsdatei existiert bereits.".into());
    }
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    let mut destination =
        Connection::open(target).map_err(|e| format!("Sicherungsdatei nicht anlegbar: {e}"))?;
    let result = (|| {
        let backup = rusqlite::backup::Backup::new(source, &mut destination)
            .map_err(|e| format!("Backup nicht startbar: {e}"))?;
        backup
            .run_to_completion(128, std::time::Duration::from_millis(10), None)
            .map_err(|e| format!("Backup fehlgeschlagen: {e}"))
    })();
    drop(destination);
    if let Err(e) = result {
        let _ = std::fs::remove_file(target);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn backup_database(app: tauri::AppHandle, target: String) -> Result<String, String> {
    ensure_workers_idle(&app)?;
    let target = PathBuf::from(target.trim());
    if target.as_os_str().is_empty() {
        return Err("Kein Sicherungspfad angegeben.".into());
    }
    let source = app.state::<db::Db>();
    let source = source.0.lock().map_err(|e| e.to_string())?;
    backup_to(&source, &target)?;
    Ok(target.to_string_lossy().to_string())
}

/// Validiert einen Snapshot und spielt ihn über die SQLite Backup API in die
/// aktuell geöffnete Datenbank ein. Der Connection-Handle bleibt dabei stabil.
fn restore_from(source_path: &std::path::Path, destination: &mut Connection) -> Result<(), String> {
    let source =
        Connection::open_with_flags(source_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Sicherung nicht lesbar: {e}"))?;
    let check: String = source
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("Sicherung ungültig: {e}"))?;
    if check != "ok" {
        return Err(format!("Sicherung beschädigt: {check}"));
    }
    let has_games: i64 = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='games'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Sicherung ungültig: {e}"))?;
    if has_games != 1 {
        return Err("Die Datei ist keine Kiebitz-Datenbank.".into());
    }
    let backup = rusqlite::backup::Backup::new(&source, destination)
        .map_err(|e| format!("Wiederherstellung nicht startbar: {e}"))?;
    backup
        .run_to_completion(128, std::time::Duration::from_millis(10), None)
        .map_err(|e| format!("Wiederherstellung fehlgeschlagen: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn restore_database(app: tauri::AppHandle, source: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let source_path = PathBuf::from(source.trim());
    if !source_path.is_file() {
        return Err("Sicherungsdatei nicht gefunden.".into());
    }
    let current_path = app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if source_path.canonicalize().ok() == current_path.canonicalize().ok() {
        return Err("Die Sicherung darf nicht die aktuell geöffnete Datenbank sein.".into());
    }
    {
        let state = app.state::<db::Db>();
        let mut destination = state.0.lock().map_err(|e| e.to_string())?;
        restore_from(&source_path, &mut destination)?;
        db::init(&destination)?;
    }
    collect_db_info(&app)
}

/// Setzt die App auf Werkseinstellungen zurück: Datenbankinhalt leeren,
/// Einstellungen verwerfen, Hilfsdateien löschen. Die Datenbankdatei selbst
/// bleibt bestehen (der Connection-Handle wird weiterverwendet), aber sie ist
/// danach leer und frisch migriert.
#[tauri::command]
pub fn factory_reset(app: tauri::AppHandle) -> Result<(), String> {
    ensure_workers_idle(&app)?;
    {
        let state = app.state::<db::Db>();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN")
            .map_err(|e| e.to_string())?;
        for table in &tables {
            conn.execute(&format!("DELETE FROM \"{table}\""), [])
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        // Schema und Startvorlagen neu anlegen, dann die Datei schrumpfen.
        db::init(&conn)?;
        let _ = conn.execute_batch("VACUUM");
        db::checkpoint(&conn);
    }

    // Einstellungen auf Werk zurück (inkl. Sync-Kopplung und Onboarding).
    let defaults = Settings::default();
    save(&app, &defaults)?;
    *app.state::<SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = defaults;

    // Abgeleitete Dateien: Sync-Zertifikat, Pairing und Erinnerungs-Snapshot.
    if let Ok(dir) = app.path().app_config_dir() {
        for name in ["reminder.json", "sync-cert.pem", "sync-key.pem"] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
    app.state::<live::LiveEngine>().shutdown();
    app.state::<endgame::EndgameEngine>().shutdown();
    Ok(())
}

/// Zustand der Datenbank für die Einstellungen.
///
/// Die beiden Zählabfragen laufen über Tabellen, die nach einem Puzzle-Import
/// Millionen Zeilen haben · deshalb nicht im Hauptthread, sonst steht auf
/// Android die Oberfläche, bis SQLite fertig gezählt hat.
#[tauri::command]
pub async fn db_info(app: tauri::AppHandle) -> Result<DbInfo, String> {
    tauri::async_runtime::spawn_blocking(move || collect_db_info(&app))
        .await
        .map_err(|e| format!("Datenbankinfo fehlgeschlagen: {e}"))?
}

fn collect_db_info(app: &tauri::AppHandle) -> Result<DbInfo, String> {
    let path = app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let db = app.state::<db::Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let games: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let puzzles: i64 = conn
        .query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let is_default = default_db_file(app).map(|d| d == path).unwrap_or(false);
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        games,
        puzzles,
        is_default,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clamps_and_trims() {
        let s = normalize(Settings {
            locale: "fr".into(),
            engine_hash_mb: 999_999,
            engine_multipv: 0,
            live_depth: 99,
            batch_depth: 1,
            cc_user: "  Torim98  ".into(),
            engine_path: Some("   ".into()),
            ..Settings::default()
        });
        // Französisch ist eine der sieben Oberflächensprachen und bleibt stehen.
        assert_eq!(s.locale, "fr");
        // Ein unbekanntes Kürzel fällt dagegen auf Englisch zurück.
        assert_eq!(
            normalize(Settings {
                locale: "kl".into(),
                ..Settings::default()
            })
            .locale,
            "en"
        );
        assert_eq!(s.engine_hash_mb, 512);
        assert_eq!(s.engine_multipv, 1);
        assert_eq!(
            normalize(Settings {
                engine_multipv: 99,
                ..Settings::default()
            })
            .engine_multipv,
            3
        );
        assert_eq!(s.live_depth, 40);
        assert_eq!(s.batch_depth, 6);
        assert_eq!(s.cc_user, "Torim98");
        assert_eq!(s.engine_path, None);
    }

    #[test]
    fn normalize_repairs_reminder_times() {
        assert_eq!(normalize_time("7:5"), "18:00");
        assert_eq!(normalize_time("24:00"), "18:00");
        assert_eq!(normalize_time("09:30"), "09:30");
        assert_eq!(normalize_time("23:59"), "23:59");
        assert_eq!(
            normalize(Settings {
                notify_time: "".into(),
                ..Settings::default()
            })
            .notify_time,
            "18:00"
        );
    }

    /// Ein unbekanntes Thema darf die Oberfläche nicht farblos lassen: Es
    /// fällt auf den Standard zurück, ebenso ein unbrauchbares Nachtfenster.
    #[test]
    fn normalize_repairs_the_appearance() {
        let s = normalize(Settings {
            theme: "neon".into(),
            board_set: "marmor".into(),
            piece_set: "origami".into(),
            theme_auto: "vielleicht".into(),
            theme_night: " dusk ".into(),
            theme_night_from: "25:00".into(),
            theme_night_to: "6:5".into(),
            ..Settings::default()
        });
        assert_eq!(s.theme, "dark");
        assert_eq!(s.board_set, "auto");
        assert_eq!(s.piece_set, "classic");
        assert_eq!(s.theme_auto, "off");
        assert_eq!(s.theme_night, "dusk");
        assert_eq!(s.theme_night_from, "19:00");
        assert_eq!(s.theme_night_to, "07:00");

        let kept = normalize(Settings {
            theme: "paper".into(),
            board_set: "sepia".into(),
            piece_set: "kiebitz".into(),
            theme_auto: "time".into(),
            theme_night_from: "20:15".into(),
            ..Settings::default()
        });
        assert_eq!(kept.theme, "paper");
        assert_eq!(kept.board_set, "sepia");
        assert_eq!(kept.piece_set, "kiebitz");
        assert_eq!(kept.theme_auto, "time");
        assert_eq!(kept.theme_night_from, "20:15");
    }

    #[test]
    fn settings_roundtrip_json() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.locale, "en");
        assert_eq!(back.engine_hash_mb, 256);
    }

    #[test]
    fn fresh_installs_start_empty_and_in_english() {
        let s = Settings::default();
        assert_eq!(s.locale, "en");
        // Keine fremden Konten, keine Pfade eines anderen Rechners.
        assert_eq!(s.cc_user, "");
        assert_eq!(s.li_user, "");
        assert_eq!(s.engine_path, None);
        assert_eq!(s.db_path, None);
        assert_eq!(s.syzygy_path, None);
        // Komfortfunktionen an, Ersteinrichtung offen.
        assert!(s.chessdb_enabled);
        assert!(s.auto_import);
        assert!(!s.onboarded);
        // Die Nutzungsstatistik ist ab Werk an, aber noch ohne Kennung: Die
        // entsteht erst beim ersten Lebenszeichen.
        assert!(s.analytics_enabled);
        assert_eq!(s.analytics_installation_id, "");
    }

    #[test]
    fn switching_analytics_off_drops_the_installation_id() {
        let id = "0189f0c2-1b3d-4a5e-8f70-9a1b2c3d4e5f";
        let on = normalize(Settings {
            analytics_installation_id: id.to_uppercase(),
            ..Settings::default()
        });
        // Solange die Statistik an ist, bleibt die Kennung · kleingeschrieben.
        assert_eq!(on.analytics_installation_id, id);
        let off = normalize(Settings {
            analytics_enabled: false,
            analytics_installation_id: id.into(),
            ..Settings::default()
        });
        // Abgeschaltet heißt: keine Kennung, die beim Wiedereinschalten
        // dieselbe Installation weiterzählte.
        assert_eq!(off.analytics_installation_id, "");
    }

    #[test]
    fn an_old_settings_file_gets_the_new_analytics_default() {
        // Eine settings.json von vor der Statistik kennt das Feld nicht. Sie
        // soll dieselbe Vorgabe bekommen wie eine frische Installation, sonst
        // hinge die Statistik allein an Neuinstallationen.
        let back: Settings = serde_json::from_str(r#"{"locale":"de"}"#).unwrap();
        assert!(back.analytics_enabled);
        // Ein ausdrückliches Nein in der Datei bleibt dagegen ein Nein.
        let off: Settings = serde_json::from_str(r#"{"analytics_enabled":false}"#).unwrap();
        assert!(!off.analytics_enabled);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let back: Settings = serde_json::from_str(r#"{"locale":"de"}"#).unwrap();
        assert_eq!(back.locale, "de");
        assert_eq!(back.engine_multipv, 3);
        assert_eq!(back.import_months, 3);
        assert!(back.auto_update);
        assert_eq!(back.display_name, "");
    }

    #[test]
    fn database_backup_and_restore_roundtrip() {
        let source = Connection::open_in_memory().unwrap();
        db::init(&source).unwrap();
        source
            .execute_batch(
                "CREATE TABLE backup_marker (value TEXT); INSERT INTO backup_marker VALUES ('ok');",
            )
            .unwrap();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("kiebitz-backup-{unique}.db"));

        backup_to(&source, &path).unwrap();
        assert!(path.is_file());

        let mut destination = Connection::open_in_memory().unwrap();
        restore_from(&path, &mut destination).unwrap();
        let value: String = destination
            .query_row("SELECT value FROM backup_marker", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "ok");

        std::fs::remove_file(path).unwrap();
    }
}
