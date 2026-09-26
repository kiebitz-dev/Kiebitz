import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LocaleProvider } from "./lib/i18n";
import { initAppearance } from "./lib/theme";
import "./index.css";

// Vor dem ersten Bild: Das Startskript in index.html hat den letzten Stand
// bereits gesetzt, hier übernimmt die Steuerung (Einstellungen, Systemvorgabe,
// Uhrzeit, Plus-Status).
initAppearance();

// WebKitGTK (Linux-Desktop) zeichnet mit abgeschaltetem DMA-BUF-Renderer
// (siehe `calm_webkit` in lib.rs) vieles in Software. Die wandernde Maske des
// Hintergrunds und `backdrop-filter` kosten dort ein Neuzeichnen des ganzen
// Fensters je Bild · auf CachyOS fror die App kurz nach dem ersten Bild ein.
// index.css nimmt beides unter diesem Merkmal zurück; das Muster bleibt stehen.
// Chrome unter Linux (Web-Vorschau) und Android sind nicht gemeint.
if (/Linux/.test(navigator.userAgent) && !/Android|Chrome/.test(navigator.userAgent)) {
  document.documentElement.dataset.webkitgtk = "true";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      {/* Angedeutetes Schachbrett hinter der ganzen App · siehe index.css.
          Es steht neben der App, nicht in ihr, damit beide Shells (Desktop
          und Mobile) denselben Hintergrund haben. */}
      <div className="chess-backdrop" aria-hidden="true" />
      <App />
    </LocaleProvider>
  </React.StrictMode>
);
