/**
 * Events · Halloween und was noch kommt.
 *
 * Ein Event ist ein eigener Ordner unter `src/events/` mit einer `event.ts`.
 * Gefunden wird er über `import.meta.glob`, nirgends steht eine Liste, und
 * einen Kalender gibt es auch nicht: Liegt der Ordner da, ist das Event in
 * diesem Build an. Wer es beenden will, nimmt den Ordner heraus und baut neu.
 * Siehe README.md hier im Ordner.
 *
 * Fest im Startbündel liegt davon nur, was vor dem ersten Bild gebraucht wird:
 * die Kennung und die Adresse des Logos. Die Startanimation kommt als eigener
 * Chunk nach.
 */
import type { ComponentType } from "react";
import { isStoreCapture } from "../lib/storeCapture";

/** Die Startanimation eines Events · meldet sich ab, wenn sie fertig ist. */
export type EventIntro = ComponentType<{ onDone: () => void }>;

/** Was ein Event-Ordner in seiner `event.ts` beschreibt. */
export type EventDef = {
  /** Kennung, gleich dem Ordnernamen. */
  id: string;
  /** Startanimation, nachgeladen · fehlt sie, gibt es keine. */
  intro?: () => Promise<{ default: EventIntro }>;
};

/** Ein gefundenes Event samt Logo, falls der Ordner eins mitbringt. */
export type AppEvent = EventDef & { logo: string | null };

const definitions = import.meta.glob<EventDef>("./*/event.ts", { eager: true, import: "default" });
// Das Logo ist eine Datei im Event-Ordner, kein Eintrag in `event.ts`: Wer
// ein neues hat, legt es dazu oder tauscht es aus. Ins Bündel kommt nur die
// Adresse, das Bild selbst lädt erst, wenn es gezeigt wird. Liegen mehrere
// da, gewinnt das erste Format dieser Liste.
const LOGO_FORMATE = ["svg", "webp", "png", "jpg"];
const logos = import.meta.glob<string>("./*/logo.{svg,webp,png,jpg}", {
  eager: true,
  query: "?url",
  import: "default",
});

const folder = (path: string) => path.split("/")[1];
const format = (path: string) => LOGO_FORMATE.indexOf(path.slice(path.lastIndexOf(".") + 1));

/** Alle Event-Ordner dieses Builds · gedacht ist höchstens einer. */
export const EVENTS: AppEvent[] = Object.entries(definitions).map(([path, def]) => {
  const logo = Object.entries(logos)
    .filter(([logoPath]) => folder(logoPath) === folder(path))
    .sort(([a], [b]) => format(a) - format(b))[0];
  return { ...def, logo: logo?.[1] ?? null };
});

/** Zum Vergleichen in der lokalen Vorschau: `?event=none` zeigt die App ohne. */
function switchedOff(): boolean {
  const local = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  return local && new URLSearchParams(window.location.search).get("event") === "none";
}

/**
 * Das Event dieses Builds. Keins gibt es in Tests (die Oberfläche soll nicht
 * davon abhängen, welcher Ordner gerade liegt) und in Store-Aufnahmen.
 */
export function activeEvent(): AppEvent | null {
  if (import.meta.env.MODE === "test" || isStoreCapture() || switchedOff()) return null;
  return EVENTS[0] ?? null;
}
