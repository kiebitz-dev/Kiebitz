/**
 * Die Lösung einer Taktikaufgabe, in Worten.
 *
 * Eine Aufgabe sagte bis hierher nur, *ob* man sie getroffen hat. Der Zug
 * stand danach auf dem Brett, und was an ihm das Entscheidende war, musste man
 * sich selbst zusammenreimen — bei einer Aufgabe, die man gerade nicht
 * gefunden hat, also genau dann nicht, wenn man es gebraucht hätte.
 *
 * Gerechnet wird das hier und nicht in Rust, aus demselben Grund wie
 * `lib/zugfakten.ts` und `lib/folge.ts`: Es braucht keine Engine, keine neue
 * Spalte und keinen zweiten Durchlauf über die Aufgabendatenbank. Die Aufgabe
 * bringt ihre Lösung als UCI-Züge schon mit (`PuzzleOut.moves`), chess.js
 * läuft auf der Puzzle-Seite ohnehin, und `zugfakten` sagt über jeden dieser
 * Züge dasselbe, was es über einen Partiezug sagt.
 *
 * Es gilt dieselbe Regel wie in docs/EXPLANATIONS.md: **Behauptet wird nur,
 * was geprüft wurde.** Kein Motiv wird hier erkannt und keines erfunden — den
 * Namen des Motivs bringt die Aufgabe selbst mit (`PuzzleOut.themes`, aus dem
 * Lichess-Katalog), und was dieses Motiv bedeutet, steht als Theorie in
 * `data/puzzleTheory.ts`. Dieses Modul sagt nur, was der Zug auf dem Brett
 * getan hat.
 *
 * Kommentiert wird allein, was der Löser zieht. Die Antworten dazwischen sind
 * erzwungene Verteidigung; ein Satz zu jedem zweiten Halbzug machte aus einer
 * Kombination eine Liste, und die Regel „was auffällt, ist ein Satz und keine
 * Liste" gilt hier wie drüben.
 */
import { Chess } from "chess.js";
import { tatsachensatz } from "./erklaerung";
import { zugfakten } from "./zugfakten";
import { notationParts } from "./notation";
import { plyOffset } from "./share/notation";
import type { Locale, TFunc } from "./i18n";

export interface Loesungszug {
  /**
   * Der Halbzug, fertig gesetzt · „3…Qd5+", „4.Kh1".
   *
   * Nummeriert wird über `notationParts` und damit nach derselben Regel wie
   * jede andere Zugfolge der App. Eine zweite Nummerierung hier liefe
   * irgendwann auseinander, und dann trüge die Lösung eine andere Zugzahl als
   * die Partie, aus der sie stammt.
   */
  text: string;
  /** Zieht hier der Löser? Nur seine Züge bekommen einen Satz. */
  eigen: boolean;
  /** Was der Zug getan hat · fehlt, wo nichts Belastbares zu sagen ist. */
  satz: string | null;
}

/**
 * Die Aufgabe, so viel davon dieses Modul braucht.
 *
 * Bewusst nicht `PuzzleOut`: Das ist die Antwort eines Tauri-Befehls, und wer
 * hier nur eine Stellung und ein paar Züge nachspielen will, soll dafür nicht
 * die halbe Puzzle-Brücke hereinziehen — die Tests täten es dann auch.
 */
export interface Aufgabe {
  fen: string;
  /** UCI-Züge · die ersten `setup_plies` gehören noch zur Aufgabenstellung. */
  moves: string[];
  setup_plies: number;
}

/** Die Lösung als Folge kommentierter Halbzüge · leer, wo sie nicht aufgeht. */
export function loesungszuege(
  aufgabe: Aufgabe,
  options: { t: TFunc; locale: Locale }
): Loesungszug[] {
  const { t, locale } = options;
  let brett: Chess;
  try {
    brett = new Chess(aufgabe.fen);
  } catch {
    return [];
  }

  /** Halbzug für Halbzug nachgespielt · der Setup-Zug gehört nicht dazu. */
  const sans: string[] = [];
  const saetze: (string | null)[] = [];
  let offset = plyOffset(aufgabe.fen);
  let vorheriger: string | undefined;

  for (const [index, uci] of aufgabe.moves.entries()) {
    const fenDavor = brett.fen();
    let zug;
    try {
      zug = brett.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
    } catch {
      // Ein unspielbarer Zug bricht die Folge ab · alles davor bleibt wahr.
      break;
    }
    if (!zug) break;

    // Der Setup-Zug stellt die Aufgabe, er löst sie nicht: Er gehört aufs
    // Brett, damit die Stellung und die Zugnummern stimmen, aber nicht in die
    // Lösung. Die Nummerierung rückt deshalb mit ihm weiter.
    if (index < aufgabe.setup_plies) {
      offset += 1;
      vorheriger = zug.san;
      continue;
    }

    const eigen = (index - aufgabe.setup_plies) % 2 === 0;
    const fakten = eigen ? zugfakten(fenDavor, zug.san, vorheriger) : null;
    sans.push(zug.san);
    saetze.push(
      fakten ? tatsachensatz(fakten, zug.san, { t, locale, seed: `${uci}:${index}` }) : null
    );
    vorheriger = zug.san;
  }

  return notationParts(sans, locale, offset).map((text, index) => ({
    text,
    eigen: index % 2 === 0,
    satz: saetze[index],
  }));
}

/**
 * Dieselbe Lösung als eine Zeile Notation · „3…Qd5+ 4.Kh1 Qxa2".
 *
 * Aus den fertigen Halbzügen und nicht aus einem zweiten Durchlauf: Die Zeile
 * und die Liste darunter müssen auf den Buchstaben dieselbe sein, und zwei
 * Rechnungen dafür sind eine zu viel. `notationText` setzt genauso zusammen.
 */
export function loesungszeile(zuege: readonly Loesungszug[]): string {
  return zuege.map((zug) => zug.text).join(" ");
}
