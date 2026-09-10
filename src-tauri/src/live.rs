//! Langlebige Stockfish-Instanz für die Live-Analyse: die Engine bleibt als
//! gemanagter Tauri-State im Speicher, `info`-Zeilen werden fortlaufend als
//! Events an das Frontend gestreamt (Eval-Bar und Tiefe aktualisieren live).

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub struct LiveEngine {
    inner: Mutex<Option<LiveProc>>,
    /// Anfrage-Generation: das Frontend ignoriert Events älterer Anfragen.
    generation: Arc<AtomicU64>,
}

struct LiveProc {
    stdin: Arc<Mutex<ChildStdin>>,
    search: Arc<Mutex<SearchState>>,
    child: Child,
}

#[derive(Clone)]
struct PendingSearch {
    generation: u64,
    fen: String,
    depth: u32,
}

#[derive(Default)]
struct SearchState {
    active_generation: Option<u64>,
    pending: Option<PendingSearch>,
    stopping: bool,
}

/// Eine gestreamte Analyse-Zeile (eine MultiPV-Linie bei einer Tiefe).
#[derive(Serialize, Clone)]
pub struct LiveInfo {
    pub generation: u64,
    pub depth: u32,
    pub multipv: u32,
    /// Centipawns aus Sicht des Spielers am Zug.
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub nps: Option<u64>,
    pub pv: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct LiveDone {
    pub generation: u64,
    pub bestmove: String,
}

#[derive(Serialize, Clone)]
struct LiveInfoBatch {
    lines: Vec<LiveInfo>,
}

/// Crossing the Tauri/WebView bridge for every Stockfish `info` line can make
/// the JavaScript event loop contend with board input. Keep draining stdout at
/// full speed, but send only the newest line per MultiPV slot in one bounded
/// bridge event. The final values are always flushed before `engine://done`.
const INFO_BATCH_INTERVAL: Duration = Duration::from_millis(120);

#[derive(Default)]
struct InfoBatcher {
    pending: BTreeMap<u32, LiveInfo>,
    last_emit: Option<Instant>,
}

impl InfoBatcher {
    fn push(&mut self, info: LiveInfo, now: Instant) -> Option<Vec<LiveInfo>> {
        self.pending.insert(info.multipv, info);
        if self
            .last_emit
            .map(|last| now.saturating_duration_since(last) < INFO_BATCH_INTERVAL)
            .unwrap_or(false)
        {
            return None;
        }
        self.last_emit = Some(now);
        self.take_pending()
    }

    fn finish_generation(&mut self) -> Option<Vec<LiveInfo>> {
        let lines = self.take_pending();
        // A new position should get its first evaluation immediately, even if
        // the previous search ended less than one interval ago.
        self.last_emit = None;
        lines
    }

    fn take_pending(&mut self) -> Option<Vec<LiveInfo>> {
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending).into_values().collect())
        }
    }
}

fn emit_info_batch(app: &tauri::AppHandle, lines: Option<Vec<LiveInfo>>) {
    if let Some(lines) = lines {
        let _ = app.emit("engine://info-batch", LiveInfoBatch { lines });
    }
}

impl Default for LiveEngine {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl LiveEngine {
    /// Startet die Engine, falls nötig, und beginnt eine neue Analyse.
    /// Liefert die Generation, unter der die Events dieser Anfrage laufen.
    ///
    /// Die Stellung wird geprüft, bevor irgendetwas geschieht. Seit
    /// Stockfish 19 beendet eine unmögliche Stellung den Prozess, und der
    /// Wiederanlauf weiter unten schickt dieselbe Anfrage noch einmal — ohne
    /// die Prüfung wäre das eine Schleife aus Sterben und Neustarten, während
    /// die Oberfläche auf eine Bewertung wartet. Siehe `chess::engine_fen`.
    pub fn analyze(
        &self,
        app: &tauri::AppHandle,
        engine_path: &str,
        fen: &str,
        depth: u32,
    ) -> Result<u64, String> {
        let fen = crate::chess::engine_fen(fen)?;
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            *guard = Some(self.spawn(app, engine_path)?);
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let request = PendingSearch {
            generation,
            fen: fen.to_string(),
            depth,
        };
        let proc = guard.as_mut().unwrap();
        if queue_search(proc, request.clone()).is_err() {
            // Engine-Prozess ist gestorben · einmal neu starten.
            *guard = Some(self.spawn(app, engine_path)?);
            let proc = guard.as_mut().unwrap();
            queue_search(proc, request).map_err(|e| format!("Engine nicht erreichbar: {e}"))?;
        }
        Ok(generation)
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(proc) = guard.as_mut() {
                if let (Ok(mut search), Ok(mut stdin)) = (proc.search.lock(), proc.stdin.lock()) {
                    search.pending = None;
                    if search.active_generation.is_some()
                        && !search.stopping
                        && stdin.write_all(b"stop\n").is_ok()
                    {
                        search.stopping = true;
                    }
                }
            }
        }
    }

    /// Beendet die Engine vollständig · z. B. nach geänderten Einstellungen.
    /// Die nächste Analyse startet sie mit den aktuellen Optionen neu.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(proc) = guard.as_mut() {
                if let Ok(mut search) = proc.search.lock() {
                    search.pending = None;
                }
                if let Ok(mut stdin) = proc.stdin.lock() {
                    let _ = stdin.write_all(b"quit\n");
                }
            }
            *guard = None;
        }
    }

    fn spawn(&self, app: &tauri::AppHandle, path: &str) -> Result<LiveProc, String> {
        let mut command = Command::new(path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::engine::configure_child_process(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("Engine konnte nicht gestartet werden ({path}): {e}"))?;
        crate::engine::lower_child_process_priority(&child);

        let stdout = child.stdout.take().ok_or("stdout nicht verfügbar")?;
        let mut child_stdin = child.stdin.take().ok_or("stdin nicht verfügbar")?;

        let (threads, hash_mb, multipv) = {
            let s = app.state::<crate::settings::SettingsState>();
            let s = s.0.lock().map_err(|e| e.to_string())?;
            (
                crate::engine::UciEngine::configured_live_threads(s.engine_threads),
                crate::engine::UciEngine::configured_live_hash_mb(s.engine_hash_mb),
                s.engine_multipv,
            )
        };
        write!(
            child_stdin,
            "uci\nsetoption name MultiPV value {multipv}\nsetoption name Threads value {threads}\nsetoption name Hash value {hash_mb}\nisready\n"
        )
        .map_err(|e| format!("Engine-Handshake fehlgeschlagen: {e}"))?;

        // Reader-Thread: parst info-Zeilen und streamt sie als Events.
        let app = app.clone();
        let stdin = Arc::new(Mutex::new(child_stdin));
        let reader_stdin = Arc::clone(&stdin);
        let search = Arc::new(Mutex::new(SearchState::default()));
        let reader_search = Arc::clone(&search);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let mut info_batcher = InfoBatcher::default();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break, // Engine beendet
                    Ok(_) => {}
                }
                let trimmed = line.trim();
                if trimmed.starts_with("info ") {
                    let generation = reader_search
                        .lock()
                        .ok()
                        .and_then(|state| state.active_generation);
                    if let Some(info) =
                        generation.and_then(|generation| parse_info(trimmed, generation))
                    {
                        let lines = info_batcher.push(info, Instant::now());
                        emit_info_batch(&app, lines);
                    }
                } else if let Some(rest) = trimmed.strip_prefix("bestmove ") {
                    emit_info_batch(&app, info_batcher.finish_generation());
                    let finished_generation = if let Ok(mut state) = reader_search.lock() {
                        let finished = state.active_generation.take();
                        state.stopping = false;
                        if let Some(next) = state.pending.take() {
                            if let Ok(mut stdin) = reader_stdin.lock() {
                                if write_search(&mut stdin, &next).is_ok() {
                                    state.active_generation = Some(next.generation);
                                }
                            }
                        }
                        finished
                    } else {
                        None
                    };
                    if let Some(generation) = finished_generation {
                        let _ = app.emit(
                            "engine://done",
                            LiveDone {
                                generation,
                                bestmove: rest.split_whitespace().next().unwrap_or("").to_string(),
                            },
                        );
                    }
                }
            }
            emit_info_batch(&app, info_batcher.finish_generation());
        });

        Ok(LiveProc {
            stdin,
            search,
            child,
        })
    }
}

/// Start immediately when idle. While Stockfish is still calculating, only
/// retain the newest request and wait for the mandatory `bestmove` response to
/// `stop` before sending the next `position`/`go` pair.
fn queue_search(proc: &mut LiveProc, request: PendingSearch) -> Result<(), std::io::Error> {
    let mut search = proc.search.lock().unwrap_or_else(|e| e.into_inner());
    let mut stdin = proc.stdin.lock().unwrap_or_else(|e| e.into_inner());
    if search.active_generation.is_none() {
        write_search(&mut stdin, &request)?;
        search.active_generation = Some(request.generation);
    } else {
        search.pending = Some(request);
        if !search.stopping {
            stdin.write_all(b"stop\n")?;
            search.stopping = true;
        }
    }
    Ok(())
}

fn write_search(stdin: &mut ChildStdin, request: &PendingSearch) -> Result<(), std::io::Error> {
    write!(
        stdin,
        "position fen {}\ngo depth {}\n",
        request.fen, request.depth
    )
}

impl Drop for LiveProc {
    fn drop(&mut self) {
        if let Ok(mut stdin) = self.stdin.lock() {
            let _ = stdin.write_all(b"quit\n");
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Parst eine `info …`-Zeile; None, wenn sie keine PV-Bewertung enthält.
fn parse_info(line: &str, generation: u64) -> Option<LiveInfo> {
    if !line.starts_with("info ") || !line.contains(" pv ") {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut info = LiveInfo {
        generation,
        depth: 0,
        multipv: 1,
        eval_cp: None,
        mate_in: None,
        nps: None,
        pv: Vec::new(),
    };
    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                info.depth = tokens.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "multipv" => {
                info.multipv = tokens.get(i + 1).and_then(|t| t.parse().ok()).unwrap_or(1);
                i += 2;
            }
            "nps" => {
                info.nps = tokens.get(i + 1).and_then(|t| t.parse().ok());
                i += 2;
            }
            "score" => {
                match (tokens.get(i + 1), tokens.get(i + 2)) {
                    (Some(&"cp"), Some(v)) => info.eval_cp = v.parse().ok(),
                    (Some(&"mate"), Some(v)) => info.mate_in = v.parse().ok(),
                    _ => {}
                }
                i += 3;
            }
            "pv" => {
                info.pv = tokens[i + 1..].iter().map(|s| s.to_string()).collect();
                break;
            }
            _ => i += 1,
        }
    }
    if info.depth == 0 || (info.eval_cp.is_none() && info.mate_in.is_none()) {
        return None;
    }
    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_centipawn_multipv_line() {
        let info = parse_info(
            "info depth 18 seldepth 25 multipv 2 score cp -37 nodes 123 nps 456789 pv e2e4 e7e5 g1f3",
            7,
        )
        .unwrap();
        assert_eq!(info.generation, 7);
        assert_eq!(info.depth, 18);
        assert_eq!(info.multipv, 2);
        assert_eq!(info.eval_cp, Some(-37));
        assert_eq!(info.mate_in, None);
        assert_eq!(info.nps, Some(456_789));
        assert_eq!(info.pv, vec!["e2e4", "e7e5", "g1f3"]);
    }

    #[test]
    fn parses_mate_score() {
        let info = parse_info("info depth 24 score mate 3 pv h5h7 g8f8 h7h8", 2).unwrap();
        assert_eq!(info.depth, 24);
        assert_eq!(info.eval_cp, None);
        assert_eq!(info.mate_in, Some(3));
        assert_eq!(info.multipv, 1);
    }

    #[test]
    fn ignores_incomplete_or_non_analysis_lines() {
        assert!(parse_info("bestmove e2e4", 1).is_none());
        assert!(parse_info("info depth 18 score cp 20", 1).is_none());
        assert!(parse_info("info depth 0 score cp 20 pv e2e4", 1).is_none());
        assert!(parse_info("info depth 18 pv e2e4", 1).is_none());
        assert!(parse_info("info depth nope score cp 20 pv e2e4", 1).is_none());
    }

    #[test]
    fn batches_latest_line_per_multipv_and_flushes_the_final_values() {
        let start = Instant::now();
        let mut batcher = InfoBatcher::default();
        let make_info = |multipv, depth| LiveInfo {
            generation: 4,
            depth,
            multipv,
            eval_cp: Some(depth as i32),
            mate_in: None,
            nps: Some(10_000),
            pv: vec!["e2e4".into()],
        };

        let first = batcher.push(make_info(1, 8), start).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].depth, 8);

        assert!(batcher
            .push(make_info(2, 8), start + Duration::from_millis(10))
            .is_none());
        assert!(batcher
            .push(make_info(2, 12), start + Duration::from_millis(20))
            .is_none());
        assert!(batcher
            .push(make_info(1, 14), start + Duration::from_millis(30))
            .is_none());

        let latest = batcher
            .push(
                make_info(3, 13),
                start + INFO_BATCH_INTERVAL + Duration::from_millis(1),
            )
            .unwrap();
        assert_eq!(
            latest.iter().map(|line| line.multipv).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            latest.iter().map(|line| line.depth).collect::<Vec<_>>(),
            vec![14, 12, 13]
        );

        assert!(batcher
            .push(
                make_info(1, 16),
                start + INFO_BATCH_INTERVAL + Duration::from_millis(2)
            )
            .is_none());
        let final_lines = batcher.finish_generation().unwrap();
        assert_eq!(final_lines.len(), 1);
        assert_eq!(final_lines[0].depth, 16);

        // Resetting at bestmove makes the first value of the next position
        // visible immediately instead of inheriting the old throttle window.
        assert!(batcher
            .push(
                make_info(1, 6),
                start + INFO_BATCH_INTERVAL + Duration::from_millis(3)
            )
            .is_some());
    }

    #[test]
    fn default_engine_starts_idle_and_shutdown_is_idempotent() {
        let engine = LiveEngine::default();
        assert_eq!(engine.generation.load(Ordering::SeqCst), 0);
        engine.stop();
        engine.shutdown();
        engine.shutdown();
        assert!(engine.inner.lock().unwrap().is_none());
    }
}
