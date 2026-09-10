/**
 * Was die Fortsetzung kostet · Material statt Bewertungspunkte.
 *
 * Eine Anmerkung, die „die Bewertung springt von −1,7 auf +1,6" sagt, ist
 * wahr und hilft niemandem: Wer die Skala nicht im Kopf hat, liest zwei
 * Zahlen. Was der Leser beim Nachspielen wissen will, steht in derselben
 * Fortsetzung, nur eine Ebene tiefer — *welche Figuren* dabei über den Tisch
 * gehen.
 *
 * Dieses Modul spielt die Hauptvariante nach dem gespielten Zug nach und
 * zählt, was geschlagen wird. Herausgegeben wird nur, was gezählt wurde:
 * der erste Schlagzug des Gegners mitsamt der Figur, die er nimmt, und die
 * Bilanz über die ganze Linie. Ein Satz daraus wird in `lib/erklaerung.ts`.
 *
 * Drei Grenzen, die bewusst so gezogen sind:
 *
 * - **Gezählt wird die Widerlegung, nicht die Gesamtrechnung.** Hat der
 *   gespielte Zug selbst etwas geschlagen, bleibt das außen vor. Die Anmerkung
 *   erzählt, was der Gegner jetzt damit anfängt — „Dxa4+ schlägt einen Bauern
 *   und gewinnt danach den Turm" ist der Satz, den man hören will, und nicht
 *   die Schlussbilanz eines Abtauschs, den man gerade erst gesehen hat.
 * - **Ungleiche Tausche bekommen keine Figur genannt.** Turm gegen Läufer und
 *   Bauer ist kein „gewinnt einen Turm". Dann steht nur der Wert, und der Satz
 *   sagt „Material" statt eines Namens.
 * - **Die ganze gespeicherte Linie, nicht ihr sichtbarer Anfang.** Angezeigt
 *   werden fünf Halbzüge (`LINIE` in erklaerung.ts); gerechnet wird über
 *   alles, was die Engine abgelegt hat, sonst endete die Zählung mitten in
 *   einem Abtausch.
 */
import { Chess } from "chess.js";

/** Figurenwerte in Bauerneinheiten · dieselbe Skala wie überall im Schach. */
const WERT: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9 };

/** Was am Ende einer Linie netto übrig bleibt. */
export interface Materialstand {
  /**
   * Die Figuren, die eine Seite netto mehr hat · leer bei einem ungleichen
   * Tausch, den man nicht als eine Figur benennen kann.
   */
  figuren: string[];
  /** Der Vorsprung in Bauerneinheiten · immer ≥ 0, immer für den Gegner. */
  wert: number;
}

export interface Fortsetzung {
  /** Der erste Schlagzug des Gegners, in englischem SAN · fehlt ohne einen. */
  schlag?: string;
  /** Die Figur, die er nimmt (P, N, B, R, Q). */
  geschlagen?: string;
  /** Gibt dieser Zug Schach (oder matt)? */
  schach: boolean;
  /** Die Bilanz der ganzen Linie, aus Sicht des Gegners. */
  netto: Materialstand;
  /** Dieselbe Bilanz ohne den ersten Schlag · was „danach" noch dazukommt. */
  danach: Materialstand;
}

/**
 * Gleiches gegen Gleiches streichen, dann den Rest verrechnen.
 *
 * Erst fallen die Paare gleicher Figuren weg (Läufer gegen Läufer), dann wird
 * gezählt. Bleibt danach nur auf einer Seite etwas übrig, sind das die
 * Figuren, die man nennen darf; steht auf beiden Seiten noch etwas, war es ein
 * ungleicher Tausch und es bleibt beim Wert.
 */
function bilanz(gewinn: readonly string[], verlust: readonly string[]): Materialstand {
  const g = [...gewinn];
  const v = [...verlust];
  for (const figur of [...v]) {
    const treffer = g.indexOf(figur);
    if (treffer < 0) continue;
    g.splice(treffer, 1);
    v.splice(v.indexOf(figur), 1);
  }
  const summe = (liste: string[]) => liste.reduce((wert, figur) => wert + (WERT[figur] ?? 0), 0);
  const wert = summe(g) - summe(v);
  if (wert <= 0) return { figuren: [], wert: 0 };
  return { figuren: v.length === 0 ? g : [], wert };
}

/** Ein Schlagzug der Linie · wer schlug was. */
interface Schlag {
  san: string;
  figur: string;
  gegner: boolean;
  schach: boolean;
}

/**
 * Die Fortsetzung nach einem Zug · `null`, wenn sie sich nicht nachspielen
 * lässt oder nichts geschlagen wird.
 *
 * `sansDavor` und `san` bauen die Stellung auf, in der die Linie beginnt.
 * Nachgespielt wird mit chess.js, weil dieselbe Bibliothek überall in der
 * Analyse zieht — eine zweite Regelimplementierung für eine Anmerkung wäre
 * eine zweite Fehlerquelle.
 */
export function fortsetzung(
  sansDavor: readonly string[],
  san: string,
  linie: readonly string[] | undefined,
  startFen?: string
): Fortsetzung | null {
  if (!linie || linie.length === 0) return null;
  const chess = startFen ? new Chess(startFen) : new Chess();
  try {
    for (const zug of sansDavor) chess.move(zug);
    chess.move(san);
  } catch {
    // Die Partie lässt sich nicht nachspielen (geteilte Stellung, Datenfehler)
    // · dann bleibt die Anmerkung ohne diesen Satz, statt zu raten.
    return null;
  }
  const gegner = chess.turn();
  const schlaege: Schlag[] = [];
  for (const zug of linie) {
    let gezogen;
    try {
      gezogen = chess.move(zug);
    } catch {
      // Eine Linie, die nicht zur Stellung passt (alte Analyse, andere
      // Zählung) · gerechnet wird mit dem, was bis hierher stimmte.
      break;
    }
    if (!gezogen) break;
    if (!gezogen.captured) continue;
    schlaege.push({
      san: gezogen.san,
      figur: gezogen.captured.toUpperCase(),
      gegner: gezogen.color === gegner,
      schach: gezogen.san.includes("+") || gezogen.san.includes("#"),
    });
  }
  if (schlaege.length === 0) return null;

  const gewinn = schlaege.filter((s) => s.gegner).map((s) => s.figur);
  const verlust = schlaege.filter((s) => !s.gegner).map((s) => s.figur);
  const erster = schlaege.find((s) => s.gegner);
  return {
    schlag: erster?.san,
    geschlagen: erster?.figur,
    schach: erster?.schach ?? false,
    netto: bilanz(gewinn, verlust),
    // Der erste Schlag steht im Satz schon mit Namen · „danach" ist alles,
    // was über ihn hinausgeht.
    danach: bilanz(erster ? gewinn.slice(1) : gewinn, verlust),
  };
}
