//! Rechtliche Hinweise für den „Über Kiebitz"-Bereich in den Einstellungen.
//!
//! MIT, BSD und ISC verlangen, dass Lizenztext und Copyright-Hinweis das
//! ausgelieferte Binary begleiten · es genügt nicht, sie nur im Repository zu
//! haben. Die Dateien werden deshalb als App-Ressourcen gebündelt. Android
//! liefert Tauri-Ressourcen allerdings als APK-Assets aus, die nicht über
//! `std::fs` erreichbar sind. Dort werden die Texte daher zusätzlich direkt
//! in die native Bibliothek eingebettet.
//!
//! Zwei Kommandos statt einem: `legal_documents` liefert nur das Verzeichnis,
//! `legal_document` den Text. Die Lizenzsammlung ist ein paar hundert Kilobyte
//! groß und soll nicht beim Öffnen der Einstellungen über die IPC-Brücke gehen,
//! sondern erst, wenn sie wirklich gelesen wird.

#[cfg(not(target_os = "android"))]
use std::path::{Path, PathBuf};

use serde::Serialize;
#[cfg(not(target_os = "android"))]
use tauri::Manager;

/// Ein anzeigbares Dokument: stabile `id` für die Abfrage, `title` als
/// Fallback-Beschriftung, `bytes` für die Größenanzeige.
#[derive(Serialize)]
pub struct LegalDoc {
    pub id: String,
    pub title: String,
    pub bytes: u64,
}

/// Reihenfolge = Anzeigereihenfolge. Die relativen Pfade entsprechen den
/// `bundle.resources`-Einträgen in `tauri.conf.json` bzw.
/// `tauri.android.conf.json`.
const DOCS: &[(&str, &str, &str)] = &[
    (
        "third-party",
        "Third-party licenses",
        "resources/licenses/THIRD_PARTY_LICENSES.txt",
    ),
    (
        "stockfish-notice",
        "Stockfish · notice & source offer",
        "resources/stockfish/NOTICE.txt",
    ),
    (
        "stockfish-gpl",
        "Stockfish · GNU GPL v3",
        "resources/stockfish/COPYING.txt",
    ),
];

/// Android-Assets haben keinen normalen Dateisystempfad. `include_str!`
/// garantiert, dass die rechtlich erforderlichen Texte dennoch im APK liegen
/// und ohne einen zusätzlichen Asset-Reader verfügbar sind.
#[cfg(target_os = "android")]
fn embedded_document(id: &str) -> Option<&'static str> {
    match id {
        "third-party" => Some(include_str!(
            "../resources/licenses/THIRD_PARTY_LICENSES.txt"
        )),
        "stockfish-notice" => Some(include_str!("../resources/stockfish/NOTICE.txt")),
        "stockfish-gpl" => Some(include_str!("../resources/stockfish/COPYING.txt")),
        _ => None,
    }
}

/// Sucht eine gebündelte Ressource: erst im Ressourcenverzeichnis der
/// installierten App, dann im Entwicklungsbaum. Gleiche Reihenfolge wie
/// `resolve_engine` in `lib.rs`, damit `tauri dev` ohne Bundle funktioniert.
///
/// Ohne `AppHandle`, damit die Pfadlogik testbar bleibt.
#[cfg(not(target_os = "android"))]
fn locate(resource_dir: Option<&Path>, relative: &str) -> Option<PathBuf> {
    if let Some(dir) = resource_dir {
        let path = dir.join(relative);
        if path.is_file() {
            return Some(path);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    dev.is_file().then_some(dev)
}

#[cfg(not(target_os = "android"))]
fn resolve(app: &tauri::AppHandle, relative: &str) -> Option<PathBuf> {
    locate(app.path().resource_dir().ok().as_deref(), relative)
}

#[tauri::command(async)]
pub fn legal_documents(app: tauri::AppHandle) -> Vec<LegalDoc> {
    #[cfg(target_os = "android")]
    let _ = app;
    DOCS.iter()
        .filter_map(|(id, title, relative)| {
            #[cfg(target_os = "android")]
            let bytes = {
                let _ = relative;
                embedded_document(id)?.len() as u64
            };
            #[cfg(not(target_os = "android"))]
            let path = resolve(&app, relative)?;
            Some(LegalDoc {
                id: (*id).to_string(),
                title: (*title).to_string(),
                #[cfg(target_os = "android")]
                bytes,
                #[cfg(not(target_os = "android"))]
                bytes: path.metadata().map(|meta| meta.len()).unwrap_or(0),
            })
        })
        .collect()
}

#[tauri::command(async)]
pub fn legal_document(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let (_, _, relative) = DOCS
        .iter()
        .find(|(candidate, _, _)| *candidate == id)
        .ok_or_else(|| format!("Unbekanntes Dokument: {id}"))?;
    #[cfg(target_os = "android")]
    {
        let _ = app;
        let _ = relative;
        return embedded_document(&id)
            .map(str::to_owned)
            .ok_or_else(|| format!("Nicht gebündelt: {id}"));
    }
    #[cfg(not(target_os = "android"))]
    {
        let path = resolve(&app, relative).ok_or_else(|| format!("Nicht gebündelt: {relative}"))?;
        std::fs::read_to_string(&path).map_err(|err| format!("{}: {err}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::{locate, DOCS};
    use std::path::{Path, PathBuf};

    /// Die gebündelten Dateien müssen im Repository existieren · sonst
    /// verspricht `bundle.resources` etwas, das der Build nicht liefern kann,
    /// und die Auslieferung wäre lizenzrechtlich unvollständig.
    #[test]
    fn every_declared_document_exists() {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for (id, _, relative) in DOCS {
            let path = manifest.join(relative);
            assert!(path.is_file(), "{id}: {} fehlt", path.display());
            let len = path.metadata().expect("metadata").len();
            assert!(
                len > 500,
                "{id}: {} ist verdächtig klein ({len} B)",
                path.display()
            );
        }
    }

    #[test]
    fn document_ids_are_unique() {
        let mut ids: Vec<_> = DOCS.iter().map(|(id, _, _)| *id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(count, ids.len(), "doppelte Dokument-ID in DOCS");
    }

    /// Ohne Ressourcenverzeichnis (also unter `tauri dev`) und bei einem
    /// Ressourcenverzeichnis ohne die Dateien muss der Entwicklungsbaum
    /// greifen · sonst zeigen die Einstellungen im Dev-Build nichts an.
    #[test]
    fn falls_back_to_the_development_tree() {
        for (_, _, relative) in DOCS {
            assert!(
                locate(None, relative).is_some(),
                "{relative}: kein Dev-Fallback"
            );
            assert!(
                locate(Some(Path::new("does-not-exist")), relative).is_some(),
                "{relative}: Fallback greift nicht bei leerem Ressourcenverzeichnis",
            );
        }
    }

    /// Inhaltliche Absicherung: die Dateien sind Compliance-Artefakte, ein
    /// versehentliches Leeren oder Vertauschen darf nicht unbemerkt bleiben.
    #[test]
    fn documents_contain_their_expected_content() {
        for (id, _, relative) in DOCS {
            let path = locate(None, relative).expect("Dokument gefunden");
            let text = std::fs::read_to_string(&path).expect("lesbar");
            let marker = match *id {
                "third-party" => "Third-party licenses",
                "stockfish-notice" => "Written offer for the corresponding source",
                "stockfish-gpl" => "GNU GENERAL PUBLIC LICENSE",
                other => panic!("Test kennt {other} nicht · Marker ergänzen"),
            };
            assert!(
                text.contains(marker),
                "{id}: erwartet \"{marker}\" in {}",
                path.display()
            );
        }
    }
}
