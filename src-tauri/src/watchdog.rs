//! Wachhund für eingefrorene Fenster · nur Linux-Desktop.
//!
//! Auf CachyOS kam Kiebitz 1.6.3 bis zum Start, zeigte das Dashboard und fror
//! dann vollständig ein. Von außen sieht das immer gleich aus, dahinter stecken
//! aber zwei verschiedene Fehler:
//!
//! * Der **Hauptthread** hängt. Er treibt die GTK-Schleife, beantwortet die
//!   `tauri://`-Anfragen (auch nachgeladene JS-Stücke) und die IPC der
//!   Oberfläche. Steht er, lädt nichts mehr nach und kein Klick kommt an.
//! * Der **WebKit-Prozess** hängt (Zeichnen, GPU, JavaScript). Der Hauptthread
//!   läuft weiter, die Oberfläche meldet sich aber nicht mehr.
//!
//! Der Wachhund unterscheidet beides und schreibt es ins Logbuch
//! (`kiebitz.log` im Datenordner). Die Datei wird auch dann noch beschrieben,
//! wenn das Fenster längst steht · genau die Zeilen braucht der Bericht.
//!
//! Anderswo läuft nichts davon: `ui_heartbeat` antwortet dort mit `false`, und
//! die Oberfläche fängt gar nicht erst an zu pochen.

#[cfg(all(desktop, target_os = "linux"))]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    /// Wie oft der Wachhund nachsieht.
    const TICK: Duration = Duration::from_secs(2);
    /// Ab so langer Stille gilt der Hauptthread als hängend.
    const MAIN_LIMIT: Duration = Duration::from_secs(5);
    /// Ab so langer Stille gilt die Oberfläche als hängend. Großzügiger als
    /// der Takt der Oberfläche (2 s), weil WebKit Timer beim Laden drosselt.
    const UI_LIMIT_MS: u64 = 8_000;

    static START: OnceLock<Instant> = OnceLock::new();
    /// Millisekunden seit `START` beim letzten Herzschlag; 0 = noch keiner.
    static LAST_BEAT: AtomicU64 = AtomicU64::new(0);
    /// Die Oberfläche war beim letzten Herzschlag sichtbar. Verborgene Fenster
    /// drosseln ihre Timer · Stille ist dann kein Befund.
    static VISIBLE: AtomicBool = AtomicBool::new(true);

    fn now_ms() -> u64 {
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    pub fn beat(visible: bool) {
        VISIBLE.store(visible, Ordering::Relaxed);
        LAST_BEAT.store(now_ms().max(1), Ordering::Relaxed);
    }

    pub fn spawn(app: tauri::AppHandle) {
        let _ = now_ms();
        let spawned = std::thread::Builder::new()
            .name("kiebitz-watchdog".into())
            .spawn(move || watch(app));
        if let Err(error) = spawned {
            log::warn!("Wachhund nicht gestartet: {error}");
        }
    }

    fn watch(app: tauri::AppHandle) {
        let mut ui_silent = false;
        loop {
            std::thread::sleep(TICK);

            // Hauptthread anpingen und auf die Antwort warten.
            let (tx, rx) = mpsc::channel::<()>();
            let sent = Instant::now();
            if app
                .run_on_main_thread(move || {
                    let _ = tx.send(());
                })
                .is_err()
            {
                // Die Ereignisschleife ist beendet · die App geht gerade zu.
                return;
            }
            if rx.recv_timeout(MAIN_LIMIT).is_err() {
                crate::diag::record(
                    "error",
                    "watchdog",
                    &format!(
                        "Hauptthread antwortet seit {} s nicht · Fenster eingefroren (GTK-Schleife blockiert)",
                        MAIN_LIMIT.as_secs()
                    ),
                );
                // Weiter warten, bis er zurückkommt · die Dauer ist der Befund.
                match rx.recv() {
                    Ok(()) => crate::diag::record(
                        "warn",
                        "watchdog",
                        &format!(
                            "Hauptthread wieder da nach {:.1} s",
                            sent.elapsed().as_secs_f32()
                        ),
                    ),
                    Err(_) => return,
                }
                continue;
            }

            // Hauptthread lebt · jetzt die Oberfläche.
            let last = LAST_BEAT.load(Ordering::Relaxed);
            if last == 0 || !VISIBLE.load(Ordering::Relaxed) {
                continue;
            }
            let silence = now_ms().saturating_sub(last);
            if silence > UI_LIMIT_MS && !ui_silent {
                ui_silent = true;
                crate::diag::record(
                    "error",
                    "watchdog",
                    &format!(
                        "Oberfläche meldet sich seit {:.1} s nicht, Hauptthread läuft · WebKit-Prozess hängt",
                        silence as f32 / 1000.0
                    ),
                );
            } else if silence <= UI_LIMIT_MS && ui_silent {
                ui_silent = false;
                crate::diag::record("warn", "watchdog", "Oberfläche meldet sich wieder");
            }
        }
    }
}

/// Startet den Wachhund (nur Linux-Desktop, sonst ohne Wirkung).
pub fn spawn(app: &tauri::AppHandle) {
    #[cfg(all(desktop, target_os = "linux"))]
    imp::spawn(app.clone());
    #[cfg(not(all(desktop, target_os = "linux")))]
    let _ = app;
}

/// Herzschlag der Oberfläche. `true`, wenn ein Wachhund zuhört · nur dann
/// pocht die Oberfläche weiter.
#[tauri::command]
pub async fn ui_heartbeat(visible: bool) -> bool {
    #[cfg(all(desktop, target_os = "linux"))]
    {
        imp::beat(visible);
        true
    }
    #[cfg(not(all(desktop, target_os = "linux")))]
    {
        let _ = visible;
        false
    }
}
