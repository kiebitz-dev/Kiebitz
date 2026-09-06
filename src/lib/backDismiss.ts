/**
 * Android-Zurück schließt eine Schicht, statt die App zu verlassen.
 *
 * Der Seiten-Stapel (`lib/nav`) spiegelt seine Tiefe in die Session-History,
 * weil die generierte `WryActivity` die Zurück-Taste nur dann an die WebView
 * gibt, wenn dort echte Einträge liegen. Eine modale Schicht ist keine neue
 * Seite · sie bekommt deshalb einen eigenen Eintrag auf *derselben* Tiefe: Der
 * Stapel vergleicht nur `kd` und lässt ihn dadurch in Ruhe.
 *
 * Die Liste der offenen Schichten ist bewusst modulweit und nicht pro Schicht:
 * Detailblatt und Fokus-Brett können gleichzeitig offen sein, und dann darf nur
 * die letzte schließende Schicht den Eintrag abräumen. Über dieselbe Liste
 * schließt `dismissLayers()` alles, was gerade offen liegt · das braucht die
 * Navigationsleiste, wenn jemand den Tab antippt, auf dem er schon steht.
 *
 * Beide Richtungen sind gegen den doppelten Effektlauf des StrictMode
 * gesichert · ein zweiter Eintrag entsteht nicht (die Marke steht schon), und
 * das Abräumen prüft erst im nächsten Task, ob wirklich keine Schicht mehr
 * offen ist.
 */
import { useEffect, useRef } from "react";

/**
 * Die offenen Schichten in der Reihenfolge ihres Öffnens · nur die letzte
 * räumt den History-Eintrag ab.
 */
const layers: Array<{ close: () => void }> = [];

/**
 * Alle offenen Schichten schließen · meldet, ob es welche gab.
 *
 * Zurück ist nicht der einzige Weg heraus: Wer unten noch einmal auf den Tab
 * tippt, auf dem er ohnehin steht, will die Liste sehen und nicht weiter das
 * Blatt darüber. Die Schichten schließen dabei wie über ihren Knopf · den
 * eigenen History-Eintrag räumt die letzte im Aufräumen ihres Effekts ab.
 */
export function dismissLayers(): boolean {
  if (layers.length === 0) return false;
  // Von oben nach unten · Detailblatt und Fokus-Brett können übereinander
  // liegen, und die obere Schicht geht zuerst.
  for (const layer of [...layers].reverse()) layer.close();
  return true;
}

/** Steht die eigene Marke im aktuellen History-Eintrag? */
function layerState(state: unknown): boolean {
  return (state as { sheet?: boolean } | null)?.sheet === true;
}

/**
 * @param active Ob die Schicht gerade offen ist. Der Vorgabewert passt für
 *   alles, was nur solange überhaupt gerendert wird · eine Schicht, die
 *   dauerhaft hängt und sich selbst ein- und ausblendet (der Plus-Dialog),
 *   reicht ihren Zustand hier herein, statt den Haken bedingt aufzurufen.
 */
export function useBackDismiss(onClose: () => void, active = true): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    if (!layerState(window.history.state)) {
      const depth = (window.history.state as { kd?: number } | null)?.kd ?? 1;
      window.history.pushState({ kd: depth, sheet: true }, "");
    }
    const layer = { close: () => closeRef.current() };
    layers.push(layer);
    let popped = false;
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      if (popped) return;
      // Über die Schaltfläche geschlossen · den eigenen Eintrag abräumen,
      // sofern nicht sofort wieder eine Schicht aufgeht (StrictMode).
      setTimeout(() => {
        if (layers.length === 0 && layerState(window.history.state)) window.history.back();
      }, 0);
    };
  }, [active]);
}
