import type { EventDef } from "../index";

/**
 * Halloween · an, solange dieser Ordner unter `src/events/` liegt.
 *
 * Das Logo neben dieser Datei wird von allein gefunden: `logo.webp` ist die
 * kleine Fassung für die App (192 px, Ecken transparent). `logo-1024.png` ist
 * die Kachel für das App-Icon (`scripts/set-app-icon.py`), den Store und die
 * Website, `logo-original.jpg` die Datei, aus der beide stammen. Gebaut wird
 * davon nur `logo.webp`.
 */
const halloween: EventDef = {
  id: "halloween",
  intro: () => import("./Intro"),
};

export default halloween;
