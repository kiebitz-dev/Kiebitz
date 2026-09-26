//! Trainings-Erinnerungen.
//!
//! Zwei Wege führen zur Benachrichtigung:
//!   * Läuft die App, schickt das Frontend den fertigen Text an `notify_now`.
//!   * Läuft sie nicht, übernimmt das Betriebssystem: Windows startet die
//!     Anwendung per Aufgabenplanung mit `--reminder` (siehe `run_headless`),
//!     Android weckt die vom Frontend vorab geplante Notification per
//!     AlarmManager.
//!
//! Windows verwirft Toasts ohne registrierte AppUserModelID kommentarlos ·
//! deshalb legt `register_windows_app_id` den passenden Registry-Eintrag an.

#[cfg(any(desktop, test))]
use crate::settings::Settings;
#[cfg(any(desktop, test))]
use rusqlite::Connection;
use serde::Serialize;
#[cfg(any(desktop, test))]
use std::path::PathBuf;

/// Offene Aufgaben des Tages.
#[cfg(any(desktop, test))]
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct DueSummary {
    /// Geplante, noch offene Lerneinheiten von heute.
    pub study: i64,
    /// Fällige Repertoire-Wiederholungen (inkl. neuer Karten).
    pub repertoire: i64,
    /// Bis zum Puzzle-Tagesziel fehlende Versuche.
    pub puzzles_left: i64,
    /// Wurde heute schon ein Endspiel gespielt?
    pub endgame_done: bool,
    /// Partien ohne Auto-Analyse.
    pub unanalyzed: i64,
    /// Tage in Folge mit gemessenem Training.
    pub streak_days: i64,
    /// Heute gemessene Minuten.
    pub today_minutes: i64,
    /// Diese Woche gemessene Minuten (Montag bis heute).
    pub week_minutes: i64,
    /// Gemessene Minuten der zuletzt abgeschlossenen Woche · die Zahl des
    /// Wochenberichts am Montag. Ohne sie stünde dort der Stand des laufenden
    /// Montags, also fast immer eine Null.
    pub last_week_minutes: i64,
}

/// Eine fertige Benachrichtigung · Aufmacher und Aufzählung.
///
/// Die Zweiteilung ist der Grund, warum es diesen Typ gibt: Windows kann zwei
/// Textzeilen, und die erste soll sagen, *warum* die Meldung heute kommt. Eine
/// bloße Aufzählung sieht auf dem Sperrbildschirm aus wie eine Systemmeldung.
#[cfg(any(desktop, test))]
#[derive(Debug, PartialEq)]
pub struct ReminderMessage {
    pub title: String,
    pub lead: String,
    /// Leer, wenn nichts mehr offen ist · dann trägt der Aufmacher allein.
    pub detail: String,
}

#[cfg(any(desktop, test))]
impl ReminderMessage {
    /// Beide Zeilen untereinander · für Kanäle mit nur einem Textfeld.
    pub fn body(&self) -> String {
        if self.detail.is_empty() {
            self.lead.clone()
        } else {
            format!("{}\n{}", self.lead, self.detail)
        }
    }
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Zählt zusammen, was heute noch aussteht.
#[cfg(any(desktop, test))]
pub fn collect_due(conn: &Connection, now: i64, puzzle_goal: i64) -> Result<DueSummary, String> {
    let day_start = now - now.rem_euclid(86_400);
    let day_end = day_start + 86_400;
    let one = |sql: &str, args: &[i64]| -> Result<i64, String> {
        conn.query_row(sql, rusqlite::params_from_iter(args.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    // my_move-Parität wie in repertoire.rs: Weiß trainiert ungerade Halbzüge.
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    let today = crate::study::iso_day(day_start);
    // Montag bis heute · derselbe Zeitraum, den auch das Wochenbudget zeigt.
    let monday = week_start(day_start);
    let week = crate::study::study_days(conn, monday, day_start, now)?;
    // Die abgeschlossene Woche davor · sie trägt den Wochenbericht am Montag.
    let last_week = crate::study::study_days(conn, monday - 7 * 86_400, monday - 86_400, now)?;
    Ok(DueSummary {
        study: conn
            .query_row(
                "SELECT COUNT(*) FROM study_events WHERE day = ?1 AND completed = 0",
                rusqlite::params![today],
                |r| r.get(0),
            )
            .unwrap_or(0),
        repertoire: one(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts < ?1)"
            ),
            &[day_end],
        )?,
        puzzles_left: (puzzle_goal
            - one(
                "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
                &[day_start, day_end],
            )?)
        .max(0),
        endgame_done: one(
            "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
            &[day_start, day_end],
        )? > 0,
        unanalyzed: one(
            "SELECT COUNT(*) FROM games WHERE analyzed = 0 AND analysis_excluded = 0",
            &[],
        )
        .unwrap_or(0),
        // Serie und gemessene Minuten kommen aus dem Lernplan-Modul und nicht
        // aus eigenen Abfragen · sonst könnte die Benachrichtigung eine andere
        // Zahl nennen als der Kopf der App, und beide wären dann verdächtig.
        streak_days: crate::study::training_streak(conn, day_start / 86_400).unwrap_or(0),
        today_minutes: week.last().map(|day| day.actual_minutes).unwrap_or(0),
        week_minutes: week.iter().map(|day| day.actual_minutes).sum(),
        last_week_minutes: last_week.iter().map(|day| day.actual_minutes).sum(),
    })
}

/// Montag der laufenden Woche als Tagesbeginn in Sekunden.
///
/// Wie `is_review_day` ohne `chrono`: Der 1.1.1970 war ein Donnerstag, also ist
/// der Wochentag `(Tage + 3) mod 7` mit Montag = 0.
#[cfg(any(desktop, test))]
fn week_start(day_start: i64) -> i64 {
    let weekday = (day_start.div_euclid(86_400) + 3).rem_euclid(7);
    day_start - weekday * 86_400
}

/// Kurztexte der Erinnerung. Bewusst dupliziert statt aus dem Frontend geladen:
/// der Headless-Lauf hat kein WebView. Die Vorlagen tragen `{n}` an derselben
/// Stelle wie die Wörterbücher unter src/lib/locales · eine unbekannte Sprache
/// fällt auf Englisch zurück.
#[cfg(any(desktop, test))]
fn template(locale: &str, key: &str) -> &'static str {
    match key {
        "study" => match locale {
            "de" => "{n} geplante Einheiten",
            "es" => "{n} unidades planificadas",
            "fr" => "{n} séances prévues",
            "hi" => "{n} नियोजित सत्र",
            "ar" => "{n} وحدات مخططة",
            "zh" => "{n} 个计划单元",
            _ => "{n} planned units",
        },
        "repertoire" => match locale {
            "de" => "{n} Wiederholungen fällig",
            "es" => "{n} repasos pendientes",
            "fr" => "{n} révisions à faire",
            "hi" => "{n} दोहराव बाकी",
            "ar" => "{n} مراجعات مستحقة",
            "zh" => "{n} 项复习到期",
            _ => "{n} reviews due",
        },
        "puzzles" => match locale {
            "de" => "{n} Puzzles bis zum Tagesziel",
            "es" => "{n} problemas para tu meta diaria",
            "fr" => "{n} problèmes avant ton objectif du jour",
            "hi" => "दैनिक लक्ष्य तक {n} पहेलियाँ",
            "ar" => "{n} ألغاز حتى هدفك اليومي",
            "zh" => "距离每日目标还差 {n} 道题",
            _ => "{n} puzzles to your daily goal",
        },
        "endgame" => match locale {
            "de" => "Endspiel-Training offen",
            "es" => "Entrenamiento de finales pendiente",
            "fr" => "Entraînement de finales en attente",
            "hi" => "अंत्यखेल अभ्यास बाकी",
            "ar" => "تدريب النهايات معلّق",
            "zh" => "残局训练待完成",
            _ => "Endgame training pending",
        },
        "analysis" => match locale {
            "de" => "{n} Partien unanalysiert",
            "es" => "{n} partidas sin analizar",
            "fr" => "{n} parties non analysées",
            "hi" => "{n} गेम बिना विश्लेषण",
            "ar" => "{n} مباريات دون تحليل",
            "zh" => "{n} 局未分析",
            _ => "{n} games unanalyzed",
        },
        // Aufmacher · dieselben Texte wie in src/lib/locales, siehe Modulkopf.
        "leadPlain" => match locale {
            "de" => "Zeit fürs Training.",
            "es" => "Hora de entrenar.",
            "fr" => "C’est l’heure de s’entraîner.",
            "hi" => "अभ्यास का समय।",
            "ar" => "حان وقت التدريب.",
            "zh" => "该训练了。",
            _ => "Time to train.",
        },
        "leadStreak" => match locale {
            "de" => "{n} Tage in Folge — heute noch nichts.",
            "es" => "{n} días seguidos: hoy aún nada.",
            "fr" => "{n} jours d’affilée — rien encore aujourd’hui.",
            "hi" => "{n} दिन लगातार — आज अभी कुछ नहीं।",
            "ar" => "{n} أيام متتالية — لا شيء اليوم بعد.",
            "zh" => "连续 {n} 天 — 今天还没开始。",
            _ => "{n} days in a row — nothing yet today.",
        },
        "leadWeekOpen" => match locale {
            "de" => "Noch {n} Min. bis zum Wochenziel.",
            "es" => "Faltan {n} min para tu meta semanal.",
            "fr" => "Encore {n} min avant ton objectif hebdomadaire.",
            "hi" => "साप्ताहिक लक्ष्य तक {n} मिनट बाकी।",
            "ar" => "يبقى {n} دقيقة لبلوغ هدفك الأسبوعي.",
            "zh" => "距周目标还差 {n} 分钟。",
            _ => "{n} min left to your weekly goal.",
        },
        "leadWeekReviewOpen" => match locale {
            "de" => "{n} Min. letzte Woche trainiert.",
            "es" => "{n} min entrenados la semana pasada.",
            "fr" => "{n} min travaillées la semaine dernière.",
            "hi" => "पिछले सप्ताह {n} मिनट अभ्यास।",
            "ar" => "{n} دقيقة تدريب الأسبوع الماضي.",
            "zh" => "上周训练 {n} 分钟。",
            _ => "{n} min trained last week.",
        },
        _ => "",
    }
}

/// Zweistellige Vorlagen · der Wochenbericht nennt Ist und Soll.
#[cfg(any(desktop, test))]
fn week_review(locale: &str, actual: i64, target: i64) -> String {
    match locale {
        "de" => format!("{actual} von {target} Min. letzte Woche."),
        "es" => format!("{actual} de {target} min la semana pasada."),
        "fr" => format!("{actual} sur {target} min la semaine dernière."),
        "hi" => format!("पिछले सप्ताह {target} में से {actual} मिनट।"),
        "ar" => format!("{actual} من {target} دقيقة الأسبوع الماضي."),
        "zh" => format!("上周 {actual} / {target} 分钟。"),
        _ => format!("{actual} of {target} min last week."),
    }
}

/// Titel des Wochenberichts.
#[cfg(any(desktop, test))]
pub fn title_week(locale: &str) -> String {
    match locale {
        "de" => "Deine Woche",
        "es" => "Tu semana",
        "fr" => "Ta semaine",
        "hi" => "आपका सप्ताह",
        "ar" => "أسبوعك",
        "zh" => "你的一周",
        _ => "Your week",
    }
    .into()
}

#[cfg(any(desktop, test))]
fn phrase(locale: &str, key: &str, n: i64) -> String {
    template(locale, key).replace("{n}", &n.to_string())
}

#[cfg(any(desktop, test))]
pub fn title(locale: &str) -> String {
    match locale {
        "de" => "Training",
        "es" => "Entrenamiento",
        "fr" => "Entraînement",
        "hi" => "अभ्यास",
        "ar" => "تدريب",
        "zh" => "训练",
        _ => "Training",
    }
    .into()
}

/// Erinnerungstext aus den aktivierten Kategorien; None = nichts zu tun.
#[cfg(any(desktop, test))]
pub fn reminder_body(settings: &Settings, due: &DueSummary) -> Option<String> {
    let locale = settings.locale.as_str();
    let mut parts: Vec<String> = Vec::new();
    if settings.notify_study && due.study > 0 {
        parts.push(phrase(locale, "study", due.study));
    }
    if settings.notify_repertoire && due.repertoire > 0 {
        parts.push(phrase(locale, "repertoire", due.repertoire));
    }
    if settings.notify_puzzles && due.puzzles_left > 0 {
        parts.push(phrase(locale, "puzzles", due.puzzles_left));
    }
    if settings.notify_endgame && !due.endgame_done {
        parts.push(phrase(locale, "endgame", 0));
    }
    if settings.notify_analysis && due.unanalyzed > 0 {
        parts.push(phrase(locale, "analysis", due.unanalyzed));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

/// Ist der Zeitpunkt ein Montag? Dann tritt der Wochenbericht an die Stelle
/// der Erinnerung · dieselbe Regel wie in `notify.ts`.
///
/// Ohne `chrono`: Der 1.1.1970 war ein Donnerstag, also ist Montag der Rest 4
/// der ganzzahligen Tage seit der Epoche. `rem_euclid` hält das auch für
/// Zeitpunkte vor 1970 richtig.
#[cfg(any(desktop, test))]
pub fn is_review_day(now: i64) -> bool {
    now.div_euclid(86_400).rem_euclid(7) == 4
}

/// Berichtstag *und* eingeschaltet · wie `isReview` im Frontend.
#[cfg(any(desktop, test))]
fn is_review(settings: &Settings, now: i64) -> bool {
    settings.notify_weekly && is_review_day(now)
}

/// Der Aufmacher · eine Zeile, die sagt, warum die Meldung heute kommt.
///
/// Die Rangfolge ist dieselbe wie im Frontend: Rückblick, dann die Serie, die
/// heute reißen würde, dann das offene Wochenziel, sonst der schlichte Anlass.
#[cfg(any(desktop, test))]
pub fn reminder_lead(settings: &Settings, due: &DueSummary, now: i64) -> String {
    let locale = settings.locale.as_str();
    let target = settings.weekly_minutes as i64;
    if is_review(settings, now) {
        // Der Hintergrundlauf kennt die Kennzahlen des Berichts nicht — die
        // rechnet das Frontend (`weekly.ts`). Bleibt die Minutenzahl der
        // abgeschlossenen Woche · dieselbe Zeile, mit der diese Meldung schon
        // vor dem Bericht auskam.
        return if target > 0 {
            week_review(locale, due.last_week_minutes, target)
        } else {
            phrase(locale, "leadWeekReviewOpen", due.last_week_minutes)
        };
    }
    if due.streak_days >= 2 && due.today_minutes == 0 {
        return phrase(locale, "leadStreak", due.streak_days);
    }
    if target > 0 && target > due.week_minutes {
        return phrase(locale, "leadWeekOpen", target - due.week_minutes);
    }
    phrase(locale, "leadPlain", 0)
}

/// Die fertige Meldung; None = nichts zu sagen.
///
/// Am Montag ist das anders als unter der Woche: Der Wochenbericht lohnt sich
/// auch ohne offene Punkte, denn er berichtet über die vergangene Woche und
/// nicht über diesen Abend.
#[cfg(any(desktop, test))]
pub fn reminder_message(
    settings: &Settings,
    due: &DueSummary,
    now: i64,
) -> Option<ReminderMessage> {
    let detail = reminder_body(settings, due).unwrap_or_default();
    let review = is_review(settings, now);
    if detail.is_empty() && !review {
        return None;
    }
    Some(ReminderMessage {
        title: if review {
            title_week(&settings.locale)
        } else {
            title(&settings.locale)
        },
        lead: reminder_lead(settings, due, now),
        detail,
    })
}

// ── Zustellung ───────────────────────────────────────────────────────────────

/// Registriert die AppUserModelID in HKCU. Ohne sie verwirft Windows Toasts
/// stillschweigend · auch die des Tauri-Plugins.
///
/// Bewusst über die Registry-API und nicht über `reg.exe`: Ein Programm ohne
/// Code-Signatur, das versteckte `reg add`-Prozesse startet, erfüllt genau das
/// Muster, an dem die Verhaltenserkennung von Defender einen Schädling erkennt,
/// der sich im System einnistet (`Behavior:Win32/Persistence.A!ml`). Derselbe
/// Eintrag aus dem eigenen Prozess heraus ist unauffällig und kostet nebenbei
/// zwei Prozessstarts weniger bei jedem Start der App.
#[cfg(windows)]
pub fn register_windows_app_id(app_id: &str, display_name: &str, icon: Option<PathBuf>) {
    let path = format!("Software\\Classes\\AppUserModelId\\{app_id}");
    let Ok(key) = windows_registry::CURRENT_USER.create(&path) else {
        return;
    };
    let _ = key.set_string("DisplayName", display_name);
    if let Some(icon) = icon.filter(|p| p.exists()) {
        let _ = key.set_string("IconUri", icon.to_string_lossy().as_ref());
    }
}

#[cfg(windows)]
fn no_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

/// Das Kiebitz-Zeichen für Benachrichtigungen · dieselbe Datei, die auch als
/// App-Symbol ausgeliefert wird.
#[cfg(any(desktop, test))]
const NOTIFY_ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// Pfad zum Zeichen, das eine Benachrichtigung tragen soll.
///
/// Windows nimmt für die Kachel *eine Bilddatei*, keine `.ico` und kein Symbol
/// aus der Anwendung · und der Erinnerungslauf startet ohne Fenster, hat also
/// auch kein Ressourcenverzeichnis zur Hand. Deshalb legt Kiebitz die PNG
/// einmal neben seine Einstellungen und benutzt von da an diesen Pfad · in der
/// laufenden App wie im Hintergrundlauf, unter Windows wie unter Linux.
#[cfg(any(desktop, test))]
pub fn notify_icon_path(identifier: &str) -> Option<PathBuf> {
    let dir = app_dir(identifier)?;
    let path = dir.join("notification-icon.png");
    // Größenvergleich statt Byte-Vergleich: er kostet nichts und erkennt den
    // Fall, der wirklich vorkommt · eine ältere Fassung nach einem Update.
    let current = std::fs::metadata(&path)
        .map(|meta| meta.len() == NOTIFY_ICON.len() as u64)
        .unwrap_or(false);
    if !current {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&path, NOTIFY_ICON).ok()?;
    }
    Some(path)
}

/// Android trägt Symbol und Farbe direkt an jeder Benachrichtigung aus dem
/// Frontend (`notify.ts`) · dort gibt es nichts neben den Einstellungen
/// abzulegen.
#[cfg(not(any(desktop, test)))]
pub fn notify_icon_path(_identifier: &str) -> Option<std::path::PathBuf> {
    None
}

/// Zeigt eine Systembenachrichtigung. Auf Windows direkt über WinRT, damit ein
/// Fehlschlag sichtbar wird (das Plugin verschluckt ihn).
///
/// Der Text darf zwei Zeilen tragen: Windows setzt `text1` und `text2`
/// untereinander, und genau dafür ist der Aufmacher da. Ein `\n` im Text
/// selbst würde die Kachel dagegen einfach länger machen.
///
/// Links davon steht das Kiebitz-Zeichen · ohne `appLogoOverride` zeigt
/// Windows an dieser Stelle nichts und die Kachel sieht aus wie eine Meldung
/// des Systems.
#[cfg(windows)]
pub fn show(app_id: &str, title: &str, body: &str) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, IconCrop, Toast};
    let (lead, detail) = match body.split_once('\n') {
        Some((lead, detail)) => (lead, detail),
        None => (body, ""),
    };
    let mut toast = Toast::new(app_id).title(title).text1(lead);
    if !detail.is_empty() {
        toast = toast.text2(detail);
    }
    let icon = notify_icon_path(app_id);
    if let Some(path) = icon.as_deref().filter(|path| path.exists()) {
        toast = toast.icon(path, IconCrop::Circular, "Kiebitz");
    }
    toast
        .duration(Duration::Short)
        .show()
        .map_err(|e| format!("Windows lehnt die Benachrichtigung ab: {e}"))
}

#[cfg(all(not(windows), any(desktop, test)))]
pub fn show(_app_id: &str, _title: &str, _body: &str) -> Result<(), String> {
    Err("Auf dieser Plattform verschickt das Frontend die Benachrichtigung.".into())
}

/// Sofortige Benachrichtigung aus dem Frontend (App läuft).
#[cfg_attr(windows, tauri::command)]
#[cfg_attr(not(windows), tauri::command(async))]
pub fn notify_now(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = &app;
        show(&app.config().identifier, &title, &body)
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        // Ohne Pfad sucht notify-rust ein Symbol im Icon-Theme unter dem Namen
        // der ausführbaren Datei · das findet sich nur auf einem installierten
        // Linux-System und auch dort nicht zuverlässig.
        let icon = notify_icon_path(&app.config().identifier);
        let mut builder = app.notification().builder().title(title).body(body);
        if let Some(path) = icon.as_deref().filter(|path| path.exists()) {
            builder = builder.icon(path.to_string_lossy());
        }
        builder.show().map_err(|e| e.to_string())
    }
}

// ── Hintergrundplanung (Windows-Aufgabenplanung) ─────────────────────────────

#[cfg(windows)]
const TASK_NAME: &str = "Kiebitz Trainings-Erinnerung";

/// Text für ein XML-Attribut bzw. einen Elementinhalt entschärfen. Pfade
/// dürfen `&` enthalten, und ein unmaskiertes `&` macht die Aufgabendatei
/// ungültig.
#[cfg(windows)]
fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Die Aufgabendefinition, wie die Aufgabenplanung sie selbst schreibt.
///
/// Alles, was früher ein zweiter PowerShell-Aufruf nachträglich gesetzt hat,
/// steht hier gleich mit drin: Akkubetrieb ist kein Grund, die Erinnerung
/// ausfallen zu lassen, ein wegen Standby verpasster Termin wird nachgeholt,
/// und länger als fünf Minuten darf der Lauf nicht dauern.
#[cfg(windows)]
fn task_xml(exe: &std::path::Path, time: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Kiebitz erinnert einmal am Tag an das offene Training.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2020-01-01T{time}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
      <Arguments>--reminder</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        time = xml_escape(time),
        exe = xml_escape(&exe.display().to_string()),
    )
}

/// `schtasks` mit den gegebenen Argumenten, ohne aufblitzendes Konsolenfenster.
#[cfg(windows)]
fn schtasks(args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = std::process::Command::new("schtasks");
    command.args(args);
    no_window(&mut command);
    command.output().map_err(|e| e.to_string())
}

/// Legt die tägliche Aufgabe an bzw. entfernt sie. Die Aufgabe startet Kiebitz
/// mit `--reminder`; der Lauf zeigt die Benachrichtigung und beendet sich.
///
/// Die Definition geht als fertige XML-Datei an `schtasks`. Der ältere Weg
/// (`/Delete`, dann `/Create /SC DAILY`, dann `powershell.exe` für die
/// Akku-Einstellungen) startete für dasselbe Ergebnis drei versteckte
/// Kindprozesse — ein unsigniertes Programm aus `%LOCALAPPDATA%`, das
/// verstecktes PowerShell aufruft und sich anschließend einen Autostart
/// einträgt, ist die Lehrbuchsignatur von `Behavior:Win32/Persistence.A!ml`.
/// Ein `schtasks /Create /XML` erledigt dasselbe mit einem Prozess und ohne
/// PowerShell.
#[cfg(windows)]
fn apply_windows_schedule(
    enabled: bool,
    time: &str,
    dir: &std::path::Path,
) -> Result<String, String> {
    if !enabled {
        let _ = schtasks(&["/Delete", "/TN", TASK_NAME, "/F"]);
        return Ok(String::new());
    }
    // `HH:MM` gehört unverändert in die XML-Datei · alles andere wäre entweder
    // eine kaputte Aufgabe oder eingeschleustes Markup.
    let valid = time.len() == 5
        && time.as_bytes()[2] == b':'
        && time
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 2 || b.is_ascii_digit());
    if !valid {
        return Err(format!("Unbrauchbare Uhrzeit für die Erinnerung: {time}"));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Die Datei liegt neben den Einstellungen und nicht in %TEMP%: aus dem
    // Temp-Verzeichnis gestartete Dateien sind für sich schon ein Verdacht.
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let xml_path = dir.join("reminder-task.xml");
    // `schtasks /XML` liest UTF-16 mit Stückliste · UTF-8 lehnt es ab.
    let mut bytes = vec![0xFF, 0xFE];
    for unit in task_xml(&exe, time).encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(&xml_path, bytes).map_err(|e| e.to_string())?;

    // `/F` überschreibt eine vorhandene Aufgabe · ein eigener `/Delete`-Lauf
    // davor wäre nur ein weiterer Prozess.
    let created = schtasks(&[
        "/Create",
        "/TN",
        TASK_NAME,
        "/XML",
        &xml_path.to_string_lossy(),
        "/F",
    ])?;
    let _ = std::fs::remove_file(&xml_path);
    if created.status.success() {
        return Ok(TASK_NAME.to_string());
    }

    // Sollte eine Windows-Fassung die Datei ablehnen, bleibt der frühere Weg:
    // eine einfache Tagesaufgabe. Sie startet dann nach Windows-Vorgabe nicht
    // im Akkubetrieb — unschön, aber besser als gar keine Erinnerung.
    let fallback = schtasks(&[
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        &format!("\"{}\" --reminder", exe.display()),
        "/SC",
        "DAILY",
        "/ST",
        time,
        "/F",
    ])?;
    if !fallback.status.success() {
        return Err(format!(
            "Aufgabenplanung meldet: {}",
            String::from_utf8_lossy(&created.stderr).trim()
        ));
    }
    Ok(TASK_NAME.to_string())
}

/// Was zuletzt erfolgreich eingetragen wurde · damit ein gewöhnlicher App-Start
/// die Aufgabenplanung gar nicht erst anfassen muss.
#[cfg(windows)]
#[derive(Serialize, serde::Deserialize, PartialEq)]
struct ScheduleState {
    enabled: bool,
    time: String,
    exe: String,
    ts: i64,
}

/// Wie lange ein Eintrag ohne Nachprüfen gilt.
///
/// Ohne diese Frist müsste jeder Start `schtasks` fragen, ob die Aufgabe noch
/// steht; mit ihr fasst eine unveränderte Installation die Aufgabenplanung
/// höchstens einmal pro Woche an. Verschwindet die Aufgabe doch einmal (von
/// Hand gelöscht, von einem Virenscanner entfernt), holt Kiebitz sie innerhalb
/// dieser Woche von selbst zurück.
#[cfg(windows)]
const SCHEDULE_RECHECK_SECS: i64 = 7 * 86_400;

/// Bringt die Betriebssystem-Planung mit den Einstellungen in Einklang.
/// Rückgabe: Name der Aufgabe (leer = keine Planung nötig/möglich).
#[tauri::command(async)]
pub fn sync_reminder_schedule(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    #[cfg(windows)]
    {
        let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let marker = dir.join("reminder-schedule.json");
        let wanted = ScheduleState {
            enabled: settings.notify_enabled,
            time: settings.notify_time.clone(),
            exe: std::env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
            ts: now_ts(),
        };
        // Steht dieselbe Planung schon und ist der Eintrag frisch, bleibt die
        // Aufgabenplanung unberührt · siehe SCHEDULE_RECHECK_SECS.
        let known = std::fs::read_to_string(&marker)
            .ok()
            .and_then(|text| serde_json::from_str::<ScheduleState>(&text).ok());
        if let Some(known) = known {
            if known.enabled == wanted.enabled
                && known.time == wanted.time
                && known.exe == wanted.exe
                && wanted.ts - known.ts < SCHEDULE_RECHECK_SECS
            {
                return Ok(if known.enabled {
                    TASK_NAME.to_string()
                } else {
                    String::new()
                });
            }
        }
        let name = apply_windows_schedule(settings.notify_enabled, &settings.notify_time, &dir)?;
        if let Ok(text) = serde_json::to_string(&wanted) {
            let _ = std::fs::write(&marker, text);
        }
        Ok(name)
    }
    #[cfg(not(windows))]
    {
        // Android plant über den AlarmManager im Frontend, andere Desktops
        // haben keinen einheitlichen Weg.
        let _ = settings;
        Ok(String::new())
    }
}

// ── Headless-Lauf (`--reminder`) ─────────────────────────────────────────────

/// Vorberechneter Erinnerungstext der laufenden App. Der Hintergrundlauf nutzt
/// ihn, wenn die Datenbank gerade nicht zweitgeöffnet werden kann (WAL-Zustand,
/// Sperren, verschobener Speicherort).
#[derive(Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Snapshot {
    pub title: String,
    pub body: String,
    /// Unix-Sekunden der Berechnung.
    pub ts: i64,
}

/// Hinterlegt den zuletzt bekannten Stand für den Hintergrundlauf.
#[tauri::command(async)]
pub fn save_reminder_snapshot(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let snapshot = Snapshot {
        title,
        body,
        ts: now_ts(),
    };
    std::fs::write(
        dir.join("reminder.json"),
        serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[cfg(any(desktop, test))]
fn read_snapshot(dir: &std::path::Path) -> Option<Snapshot> {
    let text = std::fs::read_to_string(dir.join("reminder.json")).ok()?;
    let snapshot: Snapshot = serde_json::from_str(&text).ok()?;
    // Älter als eine Woche: lieber schweigen als grob falsch erinnern.
    if snapshot.body.trim().is_empty() || now_ts() - snapshot.ts > 7 * 86_400 {
        return None;
    }
    Some(snapshot)
}

/// Konfig-/Datenverzeichnis ohne Tauri-Handle: Tauri legt beides unter
/// `%APPDATA%\<identifier>` bzw. `$XDG_CONFIG_HOME/<identifier>` ab.
#[cfg(any(desktop, test))]
fn app_dir(identifier: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|dir| dir.join(identifier))
}

/// Wurde die App nur zum Erinnern gestartet? Dann Benachrichtigung zeigen und
/// `true` zurückgeben, damit `run()` ohne Fenster endet.
#[cfg(any(desktop, test))]
pub fn run_headless(identifier: &str) -> bool {
    if !std::env::args().any(|arg| arg == "--reminder") {
        return false;
    }
    #[cfg(windows)]
    register_windows_app_id(identifier, "Kiebitz", notify_icon_path(identifier));
    let Some(dir) = app_dir(identifier) else {
        return true;
    };
    let settings: Settings = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if !settings.notify_enabled {
        return true;
    }
    let db_file = settings
        .db_path
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("kiebitz.db"));
    // Erste Wahl: frisch aus der Datenbank. Normal öffnen (WAL braucht
    // Schreibzugriff auf die -shm-Datei), aber ohne `db::init` · der
    // Erinnerungslauf migriert nichts.
    let now = now_ts();
    let fresh = Connection::open(&db_file)
        .map_err(|e| format!("Datenbank {}: {e}", db_file.display()))
        .and_then(|conn| collect_due(&conn, now, settings.puzzle_goal as i64))
        .map(|due| reminder_message(&settings, &due, now));
    let result = match fresh {
        Ok(None) => Ok("nichts fällig".to_string()),
        Ok(Some(message)) => {
            let body = message.body();
            show(identifier, &message.title, &body).map(|()| body)
        }
        // Zweite Wahl: der Stand, den die App zuletzt hinterlegt hat. Die
        // Datenbank ist aus einem zweiten Prozess nicht immer lesbar.
        Err(error) => match read_snapshot(&dir) {
            Some(snapshot) => show(identifier, &snapshot.title, &snapshot.body)
                .map(|()| format!("{} (Stand der App)", snapshot.body)),
            None => Err(error),
        },
    };
    // Der Lauf hat keine Konsole; die Zeile hilft beim Prüfen von Hand
    // (`kiebitz.exe --reminder`) und in den Logs der Aufgabenplanung.
    match result {
        Ok(text) => println!("Kiebitz-Erinnerung: {text}"),
        Err(error) => eprintln!("Kiebitz-Erinnerung fehlgeschlagen: {error}"),
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const TODAY: i64 = 20_000;
    const NOW: i64 = TODAY * 86_400 + 12 * 3_600;

    /// Die Aufgabendefinition trägt Uhrzeit, Pfad und die Akku-Einstellungen,
    /// die früher ein zweiter PowerShell-Aufruf nachgereicht hat.
    #[cfg(windows)]
    #[test]
    fn task_definition_carries_time_path_and_battery_settings() {
        let xml = task_xml(
            std::path::Path::new(r"C:\Users\a b\AppData\Local\Rock & Roll\kiebitz.exe"),
            "19:30",
        );
        assert!(xml.contains("<StartBoundary>2020-01-01T19:30:00</StartBoundary>"));
        assert!(xml.contains(
            r"<Command>C:\Users\a b\AppData\Local\Rock &amp; Roll\kiebitz.exe</Command>"
        ));
        assert!(xml.contains("<Arguments>--reminder</Arguments>"));
        // Ohne diese drei fällt die Erinnerung auf einem Notebook aus.
        assert!(xml.contains("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>"));
        assert!(xml.contains("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>"));
        assert!(xml.contains("<StartWhenAvailable>true</StartWhenAvailable>"));
    }

    /// Eine Uhrzeit, die keine ist, darf keine Aufgabe anlegen — und schon gar
    /// nicht als Markup in der Datei landen.
    #[cfg(windows)]
    #[test]
    fn refuses_a_time_that_is_not_a_time() {
        let dir = std::env::temp_dir().join("kiebitz-schedule-test");
        for bad in ["", "19:3", "abcde", "</Task><x>"] {
            assert!(apply_windows_schedule(true, bad, &dir).is_err(), "{bad}");
        }
    }

    fn settings() -> Settings {
        Settings {
            locale: "de".into(),
            ..Settings::default()
        }
    }

    #[test]
    fn collects_open_work_of_the_day() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
             VALUES (0, 'white', 'e4', 'fen-e4', 1, 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed) VALUES ('manual', 'open', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
            rusqlite::params![TODAY * 86_400 + 60],
        )
        .unwrap();

        let due = collect_due(&conn, NOW, 20).unwrap();
        assert_eq!(due.repertoire, 1);
        assert_eq!(due.unanalyzed, 1);
        assert_eq!(due.puzzles_left, 19);
        assert!(!due.endgame_done);
    }

    #[test]
    fn body_lists_enabled_categories_only() {
        let due = DueSummary {
            study: 2,
            repertoire: 14,
            puzzles_left: 8,
            endgame_done: false,
            unanalyzed: 3,
            ..DueSummary::default()
        };
        assert_eq!(
            reminder_body(&settings(), &due).unwrap(),
            "2 geplante Einheiten · 14 Wiederholungen fällig · 8 Puzzles bis zum Tagesziel · Endspiel-Training offen · 3 Partien unanalysiert"
        );

        let quiet = Settings {
            notify_repertoire: false,
            notify_endgame: false,
            notify_analysis: false,
            notify_study: false,
            ..settings()
        };
        assert_eq!(
            reminder_body(&quiet, &due).unwrap(),
            "8 Puzzles bis zum Tagesziel"
        );
    }

    /// Mittwoch, 12.08.2026, 18:00 UTC · und der Montag der Folgewoche.
    const WEDNESDAY: i64 = 1_786_492_800 + 18 * 3_600;
    const MONDAY: i64 = WEDNESDAY + 5 * 86_400;

    #[test]
    fn review_day_is_monday() {
        assert!(!is_review_day(WEDNESDAY));
        assert!(is_review_day(MONDAY));
        // Und auch über die Jahresgrenze hinweg, ohne Kalenderbibliothek.
        assert!(is_review_day(MONDAY + 7 * 86_400));
        // Der Sonntag davor trägt ihn nicht mehr · dort lief die Woche noch.
        assert!(!is_review_day(MONDAY - 86_400));
    }

    #[test]
    fn message_puts_the_reason_first() {
        let due = DueSummary {
            repertoire: 14,
            endgame_done: true,
            ..DueSummary::default()
        };
        let quiet = Settings {
            notify_study: false,
            notify_puzzles: false,
            notify_analysis: false,
            ..settings()
        };
        let message = reminder_message(&quiet, &due, WEDNESDAY).unwrap();
        assert_eq!(message.title, "Training");
        assert_eq!(message.lead, "Zeit fürs Training.");
        assert_eq!(message.detail, "14 Wiederholungen fällig");
        assert_eq!(
            message.body(),
            "Zeit fürs Training.\n14 Wiederholungen fällig"
        );
    }

    #[test]
    fn message_leads_with_a_streak_that_would_break_tonight() {
        let due = DueSummary {
            repertoire: 3,
            endgame_done: true,
            streak_days: 12,
            today_minutes: 0,
            week_minutes: 90,
            ..DueSummary::default()
        };
        let with_budget = Settings {
            weekly_minutes: 180,
            ..settings()
        };
        assert_eq!(
            reminder_lead(&with_budget, &due, WEDNESDAY),
            "12 Tage in Folge — heute noch nichts."
        );

        // Trainiert ist trainiert · dann steht dort das offene Wochenziel.
        let started = DueSummary {
            today_minutes: 25,
            ..due
        };
        assert_eq!(
            reminder_lead(&with_budget, &started, WEDNESDAY),
            "Noch 90 Min. bis zum Wochenziel."
        );
    }

    #[test]
    fn monday_reports_the_finished_week_even_with_nothing_left() {
        let done = DueSummary {
            endgame_done: true,
            // Der Montag steht am Anfang seiner eigenen Woche · berichtet wird
            // über die abgeschlossene, und nur deren Zahl darf hier stehen.
            week_minutes: 0,
            last_week_minutes: 145,
            ..DueSummary::default()
        };
        // Unter der Woche schweigt Kiebitz · der Bericht erzählt aber von der
        // vergangenen Woche und nicht von diesem Abend.
        assert!(reminder_message(&settings(), &done, WEDNESDAY).is_none());

        let with_budget = Settings {
            weekly_minutes: 180,
            ..settings()
        };
        let review = reminder_message(&with_budget, &done, MONDAY).unwrap();
        assert_eq!(review.title, "Deine Woche");
        assert_eq!(review.lead, "145 von 180 Min. letzte Woche.");
        assert_eq!(review.detail, "");
        assert_eq!(review.body(), "145 von 180 Min. letzte Woche.");

        // Ohne Budget nennt der Bericht nur das Ist.
        let open = reminder_message(&settings(), &done, MONDAY).unwrap();
        assert_eq!(open.lead, "145 Min. letzte Woche trainiert.");

        // Abgeschaltet ist der Montag ein Abend wie jeder andere.
        let off = Settings {
            notify_weekly: false,
            ..with_budget
        };
        assert!(reminder_message(&off, &done, MONDAY).is_none());
    }

    #[test]
    fn body_is_empty_when_nothing_is_due() {
        let due = DueSummary {
            endgame_done: true,
            ..DueSummary::default()
        };
        assert!(reminder_body(&settings(), &due).is_none());
    }

    #[test]
    fn snapshot_is_used_only_while_it_is_fresh() {
        let dir = std::env::temp_dir().join(format!("kiebitz-reminder-{}", now_ts()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |ts: i64| {
            std::fs::write(
                dir.join("reminder.json"),
                serde_json::to_string(&Snapshot {
                    title: "Kiebitz".into(),
                    body: "14 Wiederholungen fällig".into(),
                    ts,
                })
                .unwrap(),
            )
            .unwrap();
        };

        write(now_ts());
        assert_eq!(
            read_snapshot(&dir).unwrap().body,
            "14 Wiederholungen fällig"
        );

        // Älter als eine Woche: lieber nichts sagen als etwas Falsches.
        write(now_ts() - 8 * 86_400);
        assert!(read_snapshot(&dir).is_none());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn english_settings_produce_english_text() {
        let english = Settings {
            locale: "en".into(),
            ..settings()
        };
        let due = DueSummary {
            repertoire: 5,
            endgame_done: true,
            ..DueSummary::default()
        };
        assert_eq!(reminder_body(&english, &due).unwrap(), "5 reviews due");
        assert_eq!(title("en"), "Training");
    }
}
