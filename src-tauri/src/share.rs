//! Eine Stellung nach draußen geben.
//!
//! Android hat dafür ein Systemblatt, das jede App kennt; der Desktop hat es
//! nicht. Beide Wege liegen hier nebeneinander, damit die Oberfläche nur „teile
//! das" sagen muss und nicht wissen muss, wohin.
//!
//! Die Bildkarte entsteht im Frontend auf einem Canvas und kommt als Base64
//! herüber. Das ist der schmalste Weg durch die IPC: ein `Vec<u8>` würde als
//! JSON-Zahlenliste reisen und dabei auf das Vierfache anschwellen.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "de.torim.kiebitz";

/// Was an das Systemblatt geht · Text und Bild sind beide freiwillig.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRequest {
    /// Überschrift des Blatts · viele Ziele zeigen sie nicht, manche schon.
    pub title: String,
    /// Der Text, der mitgeschickt wird · in aller Regel Einladung und Link.
    pub text: String,
    /// Die Bildkarte als Base64 ohne Präfix · leer heißt: nur Text teilen.
    pub image: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ShareResult {
    /// Ob überhaupt ein Blatt geöffnet werden konnte.
    pub shared: bool,
}

#[cfg(target_os = "android")]
struct Share<R: Runtime>(PluginHandle<R>);

/// Registriert die native Brücke zum Android-Systemblatt.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SharePlugin")?;
            app.manage(Share(handle));
            Ok(())
        })
        .build()
}

/// Öffnet das Systemblatt. Auf dem Desktop gibt es keines · dort meldet der
/// Befehl schlicht, dass nichts geteilt wurde, und die Oberfläche bietet
/// Kopieren und Speichern an.
#[tauri::command]
pub async fn share_position(
    app: tauri::AppHandle,
    request: ShareRequest,
) -> Result<ShareResult, String> {
    #[cfg(target_os = "android")]
    {
        return app
            .state::<Share<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("share", request)
            .await
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, request);
        Ok(ShareResult { shared: false })
    }
}

/// Base64 ohne Fremdbibliothek · die Bildkarte ist der einzige Nutzer, und
/// eine Abhängigkeit für zwanzig Zeilen wäre keine gute Rechnung.
fn from_base64(text: &str) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (index, byte) in ALPHABET.iter().enumerate() {
        lookup[*byte as usize] = index as u8;
    }

    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = lookup[byte as usize];
        if value == 255 {
            return Err("Ungültiges Base64 im Bild.".into());
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Ok(out)
}

/// Schreibt die Bildkarte an einen vom Nutzer gewählten Ort.
///
/// Bewusst dieselbe Vorsicht wie beim PGN-Export: kein Überschreiben einer
/// vorhandenen Datei, und der Zielordner wird angelegt, falls der Dialog auf
/// einen frisch benannten Pfad zeigt.
#[tauri::command(async)]
pub fn write_share_image(path: String, image: String) -> Result<usize, String> {
    use std::io::Write;
    let bytes = from_base64(&image)?;
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Speicherort angegeben.".into());
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
        .map_err(|e| format!("Bild nicht speicherbar: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Bild nicht speicherbar: {e}"))?;
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64_with_and_without_padding() {
        assert_eq!(from_base64("S2llYml0eg==").unwrap(), b"Kiebitz");
        assert_eq!(from_base64("S2llYml0eg").unwrap(), b"Kiebitz");
        // Der Kopf einer PNG-Datei · das ist, was wirklich durch die IPC kommt.
        assert_eq!(
            from_base64("iVBORw0KGgo=").unwrap(),
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        );
    }

    #[test]
    fn rejects_anything_that_is_not_base64() {
        assert!(from_base64("nicht base64!").is_err());
    }

    #[test]
    fn share_request_uses_the_mobile_plugin_field_names() {
        let json = serde_json::to_value(ShareRequest {
            title: "Kiebitz".into(),
            text: "https://s.kiebitz.dev/p/abc".into(),
            image: "iVBORw0KGgo=".into(),
        })
        .unwrap();
        assert_eq!(json["title"], "Kiebitz");
        assert_eq!(json["text"], "https://s.kiebitz.dev/p/abc");
        assert_eq!(json["image"], "iVBORw0KGgo=");
    }
}
