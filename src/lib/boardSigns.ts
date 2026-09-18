/**
 * Stehen die Informator-Zeichen auf dem Brett? · Einstellung `board_signs`.
 *
 * Wie die Brettklänge in `sound.ts` hängt der Wert an einem Modul und nicht
 * an einer Seite: Gezeichnet werden die Zeichen von `Zeichenebene` auf jedem
 * Brett des Diagramm-Modus, und keine dieser Stellen soll die Einstellungen
 * selbst lesen. App.tsx setzt den gespeicherten Stand beim Start, die
 * Einstellungsseite beim Umschalten. Der Zeichenschlüssel hängt nicht daran.
 */
import { useSyncExternalStore } from "react";

let enabled = true;
const listeners = new Set<() => void>();

export function setBoardSignsEnabled(on: boolean): void {
  if (enabled === on) return;
  enabled = on;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return enabled;
}

export function useBoardSigns(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
