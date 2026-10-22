import type { EventDef } from "../index";

/**
 * Halloween · eine gute Woche bis Allerheiligen.
 *
 * Das Logo neben dieser Datei wird von allein gefunden: `logo.webp` ist die
 * kleine Fassung für die App (192 px, Ecken transparent). `logo-1024.png` ist
 * die große Vorlage für Store, Website und Social Media, `logo-original.jpg`
 * die Datei, aus der beide stammen. Beide liegen nur hier, gebaut wird nur
 * `logo.webp`.
 */
const halloween: EventDef = {
  id: "halloween",
  from: "10-24",
  to: "11-01",
  intro: () => import("./Intro"),
};

export default halloween;
