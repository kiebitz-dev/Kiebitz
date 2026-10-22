/**
 * Saison-Events · Halloween und was noch kommt.
 *
 * Jedes Event ist ein eigener Ordner unter `src/events/` mit einer
 * `event.ts`. Gefunden wird er über `import.meta.glob`, nirgends steht eine
 * Liste: Wer den Ordner herausnimmt, hat das Event aus der App entfernt, und
 * wer ihn zurücklegt, hat es wieder · ohne eine Zeile anderswo anzufassen.
 * Siehe README.md hier im Ordner.
 *
 * Fest im Startbündel liegt davon nur, was vor dem ersten Bild gebraucht wird:
 * das Zeitfenster und die Adresse des Logos. Die Startanimation kommt als
 * eigener Chunk nach, und auch nur in den Tagen, in denen das Event läuft.
 */
import type { ComponentType } from "react";
import { isStoreCapture } from "../lib/storeCapture";

/** Die Startanimation eines Events · meldet sich ab, wenn sie fertig ist. */
export type EventIntro = ComponentType<{ onDone: () => void }>;

/** Was ein Event-Ordner in seiner `event.ts` beschreibt. */
export type EventDef = {
  /** Kennung, gleich dem Ordnernamen · für `?event=<id>` beim Ausprobieren. */
  id: string;
  /**
   * Erster und letzter Tag als „MM-TT", beide eingeschlossen. Das Fenster
   * gilt jedes Jahr wieder und darf über den Jahreswechsel reichen
   * („12-28" bis „01-02").
   */
  from: string;
  to: string;
  /** Startanimation, nachgeladen · fehlt sie, gibt es keine. */
  intro?: () => Promise<{ default: EventIntro }>;
};

/** Ein gefundenes Event samt Logo, falls der Ordner eins mitbringt. */
export type SeasonEvent = EventDef & { logo: string | null };

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

export const EVENTS: SeasonEvent[] = Object.entries(definitions).map(([path, def]) => {
  const logo = Object.entries(logos)
    .filter(([logoPath]) => folder(logoPath) === folder(path))
    .sort(([a], [b]) => format(a) - format(b))[0];
  return { ...def, logo: logo?.[1] ?? null };
});

/** „MM-TT" als vergleichbare Zahl · 10-31 wird 1031. */
const dayKey = (monthDay: string) => Number(monthDay.replace("-", ""));

/** Liegt `date` (Ortszeit) im jährlichen Fenster des Events? */
export function inWindow(event: Pick<EventDef, "from" | "to">, date: Date): boolean {
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  const from = dayKey(event.from);
  const to = dayKey(event.to);
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

/**
 * Welches Event heute gilt · `override` ist die Kennung aus dem
 * Ausprobier-Schalter, „none" schaltet alles ab.
 */
export function pickEvent<T extends EventDef>(events: T[], date: Date, override?: string | null): T | null {
  if (override === "none") return null;
  if (override) return events.find((event) => event.id === override) ?? null;
  return events.find((event) => inWindow(event, date)) ?? null;
}

/**
 * Zum Ausprobieren außerhalb des Fensters: `?event=halloween` in der lokalen
 * Vorschau, auf einem Gerät `localStorage["kiebitz.event"]` über die
 * Entwicklerwerkzeuge. „none" schaltet ein laufendes Event ab.
 */
function override(): string | null {
  const local = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  const fromQuery = local ? new URLSearchParams(window.location.search).get("event") : null;
  if (fromQuery) return fromQuery;
  try {
    return localStorage.getItem("kiebitz.event");
  } catch {
    return null;
  }
}

let active: SeasonEvent | null | undefined;

/**
 * Das Event dieser Sitzung · einmal beim Start bestimmt.
 *
 * Läuft die App über Mitternacht in den ersten Tag hinein, kommt das Event
 * eben mit dem nächsten Start. Keins gibt es in Tests (die Oberfläche soll
 * nicht vom Kalender abhängen) und in Store-Aufnahmen.
 */
export function activeEvent(): SeasonEvent | null {
  if (active === undefined) {
    active =
      import.meta.env.MODE === "test" || isStoreCapture() ? null : pickEvent(EVENTS, new Date(), override());
  }
  return active;
}
