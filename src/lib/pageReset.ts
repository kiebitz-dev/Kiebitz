/**
 * Was einem Neustart der offenen Seite im Weg steht.
 *
 * Ein Tipp auf den Reiter, auf dem man ohnehin steht, hängt die Seite neu ein
 * und nimmt ihr dabei alles, was sie führt (siehe `resetPage` in App.tsx). Das
 * ist gewollt: Die besondere Analyse wird wieder das freie Brett.
 *
 * Genau einmal ist es nicht gewollt. Die Einstellungen sammeln Änderungen bis
 * zum Speichern; ein Reiter, der sie wortlos wegwirft, wäre kein Zurücksetzen,
 * sondern ein Verlust — und zwar einer, den niemand kommen sieht, weil er wie
 * ein Griff nach oben aussieht. Dort bleibt es deshalb beim alten Verhalten:
 * an den Kopf der Seite, sonst nichts.
 *
 * Angemeldet wird von der Seite selbst und nur, solange sie wirklich etwas
 * festhält. Mehr als eine Seite auf einmal kann es nicht sein · es ist immer
 * die offene, und die Abmeldung läuft über das Aushängen.
 */

let held: (() => boolean) | null = null;

/**
 * Meldet an, dass die offene Seite ungesicherte Arbeit halten *kann*. Gefragt
 * wird erst im Augenblick des Tipps — die Seite gibt eine Auskunft, keinen
 * Zustand, und muss sich deshalb bei jeder Änderung nicht neu anmelden.
 *
 * Gibt die Abmeldung zurück (für den Aufräumteil eines Effekts).
 */
export function holdPage(hold: () => boolean): () => void {
  held = hold;
  return () => {
    if (held === hold) held = null;
  };
}

/** Hält die offene Seite gerade etwas fest, das ein Neustart wegwürfe? */
export function pageHeld(): boolean {
  try {
    return held?.() === true;
  } catch {
    // Eine Auskunft, die wirft, ist keine · dann eben zurücksetzen.
    return false;
  }
}
