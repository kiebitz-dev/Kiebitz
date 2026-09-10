//! Minimaler UCI-Client: spricht mit einer beliebigen UCI-Engine
//! (Stockfish) über stdin/stdout eines Kindprozesses.

use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

/// Stockfish is a console application. Without this flag Windows opens a
/// visible console window whenever the engine process starts.
pub(crate) fn configure_child_process(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Stockfish is deliberately a background workload. Giving its process a
/// lower scheduler priority keeps the WebView and input handling responsive
/// even when the configured engine threads saturate the device.
pub(crate) fn lower_child_process_priority(child: &Child) {
    #[cfg(windows)]
    {
        use std::ffi::c_void;
        use std::os::windows::io::AsRawHandle;

        const IDLE_PRIORITY_CLASS: u32 = 0x0000_0040;
        #[link(name = "kernel32")]
        extern "system" {
            fn SetPriorityClass(process: *mut c_void, priority_class: u32) -> i32;
        }

        // A failed priority adjustment is not fatal: the engine remains usable
        // with the platform default priority.
        let _ = unsafe { SetPriorityClass(child.as_raw_handle(), IDLE_PRIORITY_CLASS) };
    }

    #[cfg(unix)]
    {
        const PRIO_PROCESS: i32 = 0;
        #[link(name = "c")]
        extern "C" {
            fn setpriority(which: i32, who: u32, priority: i32) -> i32;
        }

        // Positive niceness gives the UI precedence without throttling the
        // engine while the device is otherwise idle.
        let _ = unsafe { setpriority(PRIO_PROCESS, child.id(), 15) };
    }

    #[cfg(not(any(windows, unix)))]
    let _ = child;
}

/// Wie viele Engines die Stapelanalyse ab Werk nebeneinander laufen lässt.
///
/// Vier, weil hier der Knick liegt. Gemessen an einer Partie mit 80
/// Stellungen (Tiefe 14, sechzehn Kerne): vier Engines brauchen 19,6 ms je
/// Stellung, sechs 13,9 ms, vierzehn 10,7 ms. Der Speicher wächst dabei
/// gerade und ohne Bremse — jeder Stockfish hält seine eigene Kopie beider
/// Netze und liegt bei gut 250 MB, bevor ein einziger Hash-Eintrag da ist.
/// Vier Engines belegen zusammen rund 1,0 GB gegenüber 0,53 GB der einen
/// vielfädigen Engine von vorher; das ist der Preis für gut fünfmal so
/// schnell und ein Viertel der belegten Kerne. Sechs wären noch etwas
/// schneller und 1,5 GB, vierzehn kaufen die letzten 23 % für 3,5 GB.
const DEFAULT_ANALYSIS_WORKERS: usize = 4;

/// Obergrenze auch für eine ausdrückliche Einstellung.
///
/// Auf dem Handy genau eine: Der zweite Prozess bringt dort nichts, was den
/// Speicher rechtfertigt (1 Thread 56,2 ms je Stellung, 2 Threads 59,2 ms —
/// die alte Vorgabe war schon die langsamere), und ein Viertelgigabyte mehr
/// ist genau das, wofür Android eine App im Hintergrund abräumt. Auf dem
/// Desktop acht, weil darüber der Speicher weiterläuft und das Tempo nicht.
#[cfg(target_os = "android")]
const MAX_ANALYSIS_WORKERS: usize = 1;
#[cfg(not(target_os = "android"))]
const MAX_ANALYSIS_WORKERS: usize = 8;

#[derive(Serialize)]
pub struct AnalysisResult {
    pub bestmove: String,
    /// Bewertung in Centipawns aus Sicht des Spielers am Zug.
    /// `None`, wenn die Engine ein Matt meldet (dann ist `mate_in` gesetzt).
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub depth: u32,
    pub pv: Vec<String>,
}

pub struct UciEngine {
    child: Child,
    reader: BufReader<std::process::ChildStdout>,
    name: String,
}

impl UciEngine {
    pub fn spawn(path: &str) -> Result<Self, String> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        configure_child_process(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Engine konnte nicht gestartet werden ({path}): {e}"))?;
        lower_child_process_priority(&child);

        let stdout = child.stdout.take().ok_or("stdout nicht verfügbar")?;
        let mut engine = Self {
            child,
            reader: BufReader::new(stdout),
            name: String::new(),
        };

        engine.send("uci")?;
        engine.name = engine.read_id_name()?;
        engine.send("isready")?;
        engine.wait_for("readyok")?;
        Ok(engine)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Setzt eine UCI-Option und wartet, bis die Engine bereit ist.
    pub fn set_option(&mut self, name: &str, value: &str) -> Result<(), String> {
        self.send(&format!("setoption name {name} value {value}"))?;
        self.send("isready")?;
        self.wait_for("readyok")
    }

    /// Sinnvolle Thread-Zahl für Hintergrund-Analyse: Kerne minus zwei.
    pub fn worker_threads() -> usize {
        std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(2).max(1))
            .unwrap_or(1)
    }

    /// Applies an explicit setting without allowing it to consume the logical
    /// cores reserved for input, the WebView compositor and audio. Stockfish
    /// can still use every remaining core while the UI is idle.
    pub fn configured_worker_threads(configured: u32) -> usize {
        let ceiling = Self::worker_threads();
        if configured == 0 {
            ceiling
        } else {
            (configured as usize).clamp(1, ceiling)
        }
    }

    /// Wie viele Ein-Thread-Engines die Stapelanalyse nebeneinander laufen
    /// lässt.
    ///
    /// Vorher lief sie in *einer* Engine mit `Kerne - 2` Threads. Für eine
    /// Suche bis zu einer festen Tiefe ist das der falsche Griff: Lazy SMP
    /// verbreitert die Suche, statt sie zu verkürzen · `go depth 14` zahlt ein
    /// Vielfaches an Knoten und gewinnt an der Uhr nichts. An derselben Partie
    /// gemessen braucht eine Engine mit vierzehn Threads 111 ms je Stellung,
    /// dieselbe Engine mit *einem* Thread 58 ms. Die zusätzlichen Threads
    /// waren nicht nur verschwendet, sie waren langsamer — und sie sind der
    /// Grund, warum die Analyse den Rechner auslastete, ohne schneller zu
    /// werden.
    ///
    /// Parallel wird deshalb über Stellungen statt über Threads: Die
    /// Stellungen einer Partie hängen nicht voneinander ab, und jede Engine
    /// sucht für sich mit einem Thread.
    pub fn analysis_workers(configured: u32) -> usize {
        let ceiling = Self::worker_threads().min(MAX_ANALYSIS_WORKERS);
        if configured == 0 {
            ceiling.min(DEFAULT_ANALYSIS_WORKERS)
        } else {
            (configured as usize).clamp(1, ceiling)
        }
    }

    /// Der eingestellte Hash, geteilt durch die Zahl der Engines · die
    /// Einstellung sagt, was die Analyse insgesamt belegen darf, und nicht,
    /// was jeder Prozess obendrauf legt. Unter 16 MB wird nicht mehr geteilt:
    /// Eine Engine ganz ohne Tabelle sucht dieselbe Stellung mehrfach.
    pub fn worker_hash_mb(configured: u32, workers: usize) -> u32 {
        let workers = workers.max(1) as u32;
        (configured / workers).clamp(16, configured.max(16))
    }

    /// Live analysis deliberately uses a single search thread. The batch
    /// analyzer may be running in its own Stockfish processes; on normal 4+
    /// core devices this leaves at least one logical core unsaturated even at
    /// the maximum setting. Very small devices additionally rely on the engine
    /// process's idle scheduler class.
    pub fn configured_live_threads(configured: u32) -> usize {
        Self::configured_worker_threads(configured).min(1)
    }

    /// A second 4 GiB transposition table next to batch analysis can force the
    /// WebView into paging. Live evaluation benefits far more from immediacy
    /// than from a huge hash, so its independent process stays compact.
    pub fn configured_live_hash_mb(configured: u32) -> u32 {
        configured.clamp(16, 128)
    }

    /// Liest Zeilen bis `uciok` und merkt sich dabei den `id name`-Wert.
    fn read_id_name(&mut self) -> Result<String, String> {
        let mut name = String::new();
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("id name ") {
                name = rest.to_string();
            } else if trimmed.starts_with("uciok") {
                return Ok(name);
            }
        }
    }

    fn send(&mut self, cmd: &str) -> Result<(), String> {
        let stdin = self.child.stdin.as_mut().ok_or("stdin nicht verfügbar")?;
        writeln!(stdin, "{cmd}").map_err(|e| format!("Schreiben fehlgeschlagen: {e}"))
    }

    fn wait_for(&mut self, token: &str) -> Result<(), String> {
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            if line.trim_start().starts_with(token) {
                return Ok(());
            }
        }
    }

    /// Analysiert eine Stellung bis zur angegebenen Tiefe und liefert
    /// besten Zug, Bewertung und Hauptvariante.
    ///
    /// Die Stellung wird vorher geprüft · eine unmögliche kostet seit
    /// Stockfish 19 den Prozess (siehe `chess::engine_fen`). Sie kommt hier als
    /// gewöhnlicher Fehler zurück, ohne dass die Engine sie je zu sehen bekommt.
    pub fn analyze(&mut self, fen: &str, depth: u32) -> Result<AnalysisResult, String> {
        let fen = crate::chess::engine_fen(fen)?;
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth}"))?;

        let mut result = AnalysisResult {
            bestmove: String::new(),
            eval_cp: None,
            mate_in: None,
            depth: 0,
            pv: Vec::new(),
        };

        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("Lesen fehlgeschlagen: {e}"))?;
            if n == 0 {
                return Err("Engine-Prozess wurde unerwartet beendet".into());
            }
            let trimmed = line.trim();

            if trimmed.starts_with("info ") {
                Self::parse_info(trimmed, &mut result);
            } else if let Some(rest) = trimmed.strip_prefix("bestmove ") {
                result.bestmove = rest.split_whitespace().next().unwrap_or("").to_string();
                return Ok(result);
            }
        }
    }

    fn parse_info(line: &str, result: &mut AnalysisResult) {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let mut i = 0;
        while i < tokens.len() {
            match tokens[i] {
                "depth" => {
                    if let Some(d) = tokens.get(i + 1).and_then(|t| t.parse().ok()) {
                        result.depth = d;
                    }
                    i += 2;
                }
                "score" => match (tokens.get(i + 1), tokens.get(i + 2)) {
                    (Some(&"cp"), Some(v)) => {
                        result.eval_cp = v.parse().ok();
                        result.mate_in = None;
                        i += 3;
                    }
                    (Some(&"mate"), Some(v)) => {
                        result.mate_in = v.parse().ok();
                        result.eval_cp = None;
                        i += 3;
                    }
                    _ => i += 1,
                },
                "pv" => {
                    result.pv = tokens[i + 1..].iter().map(|s| s.to_string()).collect();
                    return;
                }
                _ => i += 1,
            }
        }
    }
}

impl Drop for UciEngine {
    fn drop(&mut self) {
        let _ = self.send("quit");
        // A custom UCI engine is allowed to misbehave. Never wait forever in a
        // Tauri command (for example while settings restart the engine).
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn configured_threads_always_preserve_the_ui_reserve() {
        let ceiling = UciEngine::worker_threads();
        assert!(ceiling >= 1);
        assert_eq!(UciEngine::configured_worker_threads(0), ceiling);
        assert_eq!(UciEngine::configured_worker_threads(1), 1);
        assert_eq!(UciEngine::configured_worker_threads(u32::MAX), ceiling);
        assert_eq!(UciEngine::configured_live_threads(0), 1);
        assert_eq!(UciEngine::configured_live_threads(u32::MAX), 1);
        assert_eq!(UciEngine::configured_live_hash_mb(64), 64);
        assert_eq!(UciEngine::configured_live_hash_mb(u32::MAX), 128);
    }

    #[test]
    fn analysis_workers_stay_below_the_ceiling() {
        let ceiling = UciEngine::worker_threads().min(MAX_ANALYSIS_WORKERS);
        // Ab Werk höchstens vier Engines · darüber wächst vor allem der
        // Speicher.
        assert_eq!(
            UciEngine::analysis_workers(0),
            ceiling.min(DEFAULT_ANALYSIS_WORKERS)
        );
        assert_eq!(UciEngine::analysis_workers(1), 1);
        // Auch eine ausdrückliche Einstellung kommt nicht über die Grenze ·
        // auf dem Handy bleibt es bei einer einzigen Engine.
        assert_eq!(UciEngine::analysis_workers(u32::MAX), ceiling);
        assert!(UciEngine::analysis_workers(u32::MAX) <= MAX_ANALYSIS_WORKERS);
    }

    #[test]
    fn worker_hash_is_shared_between_the_engines() {
        // Vier Engines teilen sich den eingestellten Hash.
        assert_eq!(UciEngine::worker_hash_mb(256, 4), 64);
        // Der Boden liegt bei 16 MB · lieber etwas mehr belegen als eine
        // Engine ohne Tabelle suchen lassen.
        assert_eq!(UciEngine::worker_hash_mb(64, 8), 16);
        // Eine einzelne Engine bekommt, was eingestellt ist.
        assert_eq!(UciEngine::worker_hash_mb(256, 1), 256);
        // Auch unterhalb des Bodens bleibt die Einstellung eine Obergrenze
        // für die einzelne Engine, nicht der Boden.
        assert_eq!(UciEngine::worker_hash_mb(16, 4), 16);
    }

    /// Testet den echten Analyse-Pfad gegen die gebündelte Engine.
    /// Wird übersprungen, wenn keine stockfish.exe vorhanden ist.
    #[test]
    fn analyzes_italian_position() {
        let exe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(if cfg!(windows) {
                "stockfish.exe"
            } else {
                "stockfish"
            });
        if !exe.exists() {
            eprintln!("übersprungen: keine Engine unter {}", exe.display());
            return;
        }

        let mut e = UciEngine::spawn(&exe.to_string_lossy()).expect("Engine-Start");
        assert!(
            e.name().contains("Stockfish"),
            "unerwarteter Name: {}",
            e.name()
        );

        let fen = "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1";
        let r = e.analyze(fen, 18).expect("Analyse");

        assert_eq!(r.depth, 18);
        assert!(!r.bestmove.is_empty(), "bestmove leer");
        assert!(
            r.eval_cp.is_some() || r.mate_in.is_some(),
            "keine Bewertung"
        );
        assert!(!r.pv.is_empty(), "keine Hauptvariante");
        eprintln!(
            "OK: name={} bestmove={} eval_cp={:?} depth={} pv={:?}",
            e.name(),
            r.bestmove,
            r.eval_cp,
            r.depth,
            &r.pv[..r.pv.len().min(3)]
        );
    }
}
