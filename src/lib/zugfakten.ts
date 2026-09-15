/**
 * Was ein Zug *tut* · die Tatsachen unter dem ruhigen Zug.
 *
 * Bis 1.4 bekam ein Halbzug nur dann einen Satz, wenn die Engine ihn
 * bemängelte oder `motifs.rs` ein Motiv daran fand. Das sind in einer Partie
 * eine Handvoll Züge; die übrigen siebzig standen kommentarlos da. Wer eine
 * Partie durchklickt, liest also fünfmal etwas und fünfundsiebzigmal nichts —
 * und schließt daraus nicht „hier war nichts zu sagen", sondern „die Analyse
 * ist ausgefallen". Genau das hat ein Nutzer gemeldet.
 *
 * Dieses Modul schließt die Lücke, ohne die Regel zu brechen, auf der die
 * Sätze stehen (docs/EXPLANATIONS.md): **Behauptet wird nur, was geprüft
 * wurde.** Erfunden wird hier nichts und geschätzt auch nicht — nachgespielt
 * wird die Stellung mit chess.js, und herausgegeben wird, was dabei
 * tatsächlich zu sehen war: Wurde geschlagen und was, gab es Schach, ging der
 * König aus der Mitte, kam eine Figur zum ersten Mal von ihrem Grundfeld,
 * steht nach dem Zug eine gegnerische Figur ungedeckt im Feuer.
 *
 * Kein Urteil steht darin. Ob ein Zug gut war, sagt die Engine; dieses Modul
 * sagt, was auf dem Brett passiert ist. Die Trennung ist dieselbe wie bei
 * `lib/folge.ts`: Hier wird gezählt und geprüft, gesetzt wird in
 * `lib/erklaerung.ts`, und zwar in der Sprache, die gerade eingestellt ist.
 *
 * Warum in TypeScript und nicht wie die Motive in Rust: Es braucht keine
 * Engine und keine neue Spalte, also auch keinen zweiten Analyselauf über
 * fünfzehnhundert Partien. Die Stellung liegt beim Nachspielen ohnehin vor —
 * dieselbe Überlegung, aus der `lib/folge.ts` hier steht und nicht drüben.
 */
import { Chess, type Square } from "chess.js";

/** Figurenwerte in Bauerneinheiten · dieselbe Skala wie in lib/folge.ts. */
const WERT: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9 };

/** Die vier Felder, um die es in der Eröffnung geht. */
const ZENTRUM = ["d4", "e4", "d5", "e5"];

/** Grundfelder der Leichtfiguren · von hier aus wird entwickelt. */
const GRUNDFELDER: Record<string, string[]> = {
  wn: ["b1", "g1"],
  wb: ["c1", "f1"],
  bn: ["b8", "g8"],
  bb: ["c8", "f8"],
};

export interface Zugfakten {
  /** Die gezogene Figur als Großbuchstabe (P, N, B, R, Q, K). */
  figur: string;
  /** Ihr Zielfeld. */
  feld: string;
  schach: boolean;
  matt: boolean;
  rochade: boolean;
  umwandlung: boolean;
  /** Die geschlagene Figur · fehlt, wo nichts geschlagen wurde. */
  schlaegt?: string;
  /**
   * Nimmt der Zug dort zurück, wo der Gegenzug davor geschlagen hat?
   *
   * Ein Rückschlag ist kein Materialgewinn, sondern das Ende eines Abtauschs.
   * „Schlägt einen Springer" wäre über ihn zwar wahr, aber irreführend.
   */
  rueckschlag: boolean;
  /** Springer oder Läufer verlässt sein Grundfeld · die erste Entwicklung. */
  entwicklung: boolean;
  /** Ein Bauer betritt eines der vier Zentrumsfelder. */
  zentrum: boolean;
  /**
   * Was der Zug neu ins Visier nimmt · nur, wo das Visier etwas wert ist.
   *
   * Genannt wird eine gegnerische Figur nur dann, wenn die gezogene Figur sie
   * vorher *nicht* angriff und wenn der Angriff eine Drohung ist: Das Ziel ist
   * mehr wert als der Angreifer, oder es steht ungedeckt und ist mindestens
   * eine Leichtfigur. Ohne diese Schranke stünde unter jedem Läuferzug „greift
   * f7 an", und f7 ist vom König gedeckt.
   */
  drohung?: { figur: string; feld: string };
  /**
   * Das Feld, von dem die Figur sich in Sicherheit bringt · sonst `undefined`.
   *
   * Der häufigste ruhige Zug einer Partie unter 1500 ist kein Plan, sondern
   * eine Rettung: Eine Figur wird angegriffen und geht weg. Das steht in der
   * Stellung und ist damit sagbar — und es ist genau die Auskunft, die dem
   * Leser beim Durchklicken fehlt.
   */
  flucht?: string;
}

/** Das Zielfeld eines SAN-Zuges, falls er geschlagen hat · sonst null. */
function schlagfeld(san: string | undefined): string | null {
  if (!san || !san.includes("x")) return null;
  const rein = san.replace(/[+#?!]/g, "").replace(/=[QRBN]$/, "");
  const feld = rein.slice(-2);
  return /^[a-h][1-8]$/.test(feld) ? feld : null;
}

/**
 * Die Tatsachen zu einem Halbzug · `null`, wenn er sich nicht nachspielen
 * lässt (geteilte Stellung, Datenfehler). Dann bleibt der Satz fort, statt zu
 * raten — dieselbe Regel wie in `fortsetzung`.
 *
 * `sanDavor` ist der Zug des Gegners davor. Er wird für genau eine Frage
 * gebraucht — ist dieser Zug ein Rückschlag? — und darf deshalb fehlen.
 */
export function zugfakten(
  fenDavor: string,
  san: string,
  sanDavor?: string
): Zugfakten | null {
  let davor: Chess;
  let brett: Chess;
  let zug;
  try {
    davor = new Chess(fenDavor);
    brett = new Chess(fenDavor);
    zug = brett.move(san);
  } catch {
    return null;
  }
  if (!zug) return null;

  const figur = zug.piece.toUpperCase();
  // Der König steht in keiner Tabelle · für die Frage „steht die Figur im
  // Feuer?" ist er unbezahlbar, und jeder Angreifer ist billiger als er.
  const wert = figur === "K" ? 100 : (WERT[figur] ?? 0);
  const gegner = zug.color === "w" ? "b" : "w";
  const grund = GRUNDFELDER[`${zug.color}${zug.piece}`];

  return {
    figur,
    feld: zug.to,
    schach: brett.isCheck(),
    matt: brett.isCheckmate(),
    rochade: zug.flags.includes("k") || zug.flags.includes("q"),
    umwandlung: zug.flags.includes("p"),
    schlaegt: zug.captured ? zug.captured.toUpperCase() : undefined,
    rueckschlag: schlagfeld(sanDavor) === zug.to,
    entwicklung: Boolean(grund?.includes(zug.from)),
    zentrum: zug.piece === "p" && ZENTRUM.includes(zug.to),
    drohung: drohung(davor, brett, zug.from, zug.to, wert, gegner) ?? undefined,
    flucht:
      bedroht(davor, zug.from, wert, gegner) && !bedroht(brett, zug.to, wert, gegner)
        ? zug.from
        : undefined,
  };
}

/**
 * Steht auf diesem Feld eine Figur dieses Wertes im Feuer?
 *
 * Nicht „wird angegriffen": Ein Bauer, der eine Dame angreift, ist eine
 * Drohung, eine Dame, die einen gedeckten Bauern angreift, ist keine. Gezählt
 * wird deshalb gegen den Wert — der billigste Angreifer muss weniger wert sein
 * als die Figur, oder sie steht ohne Deckung da.
 */
function bedroht(brett: Chess, feld: Square, wert: number, gegner: "w" | "b"): boolean {
  const meine = gegner === "w" ? "b" : "w";
  const angreifer = brett.attackers(feld, gegner);
  if (angreifer.length === 0) return false;
  if (brett.attackers(feld, meine).length === 0) return true;
  return angreifer.some((quelle) => {
    const stein = brett.get(quelle);
    return stein ? (WERT[stein.type.toUpperCase()] ?? 0) < wert : false;
  });
}

/**
 * Die eine Figur, die der Zug neu ins Visier nimmt.
 *
 * Gefragt wird nicht das Brett, sondern die gezogene Figur: `attackers` gibt
 * die Felder aller Angreifer zurück, und interessant ist nur, ob das eigene
 * Zielfeld darunter ist. Stand sie schon vorher auf derselben Figur, ist das
 * keine neue Drohung, sondern dieselbe von einem anderen Feld aus.
 *
 * Bleibt mehr als eine übrig, gilt die wertvollste. Zwei Drohungen in einem
 * Satz wären eine Gabel, und die erkennt `motifs.rs` — mit mehr Sorgfalt, als
 * hier angebracht wäre.
 */
function drohung(
  davor: Chess,
  brett: Chess,
  von: Square,
  nach: Square,
  wert: number,
  gegner: "w" | "b"
): { figur: string; feld: string } | null {
  const meine = gegner === "w" ? "b" : "w";
  let beste: { figur: string; feld: string; wert: number } | null = null;
  for (const reihe of brett.board()) {
    for (const stein of reihe) {
      if (!stein || stein.color !== gegner || stein.type === "k") continue;
      const zielwert = WERT[stein.type.toUpperCase()] ?? 0;
      // Mehr wert als der Angreifer, oder ungedeckt und mindestens eine
      // Leichtfigur · alles darunter ist kein Gewinn, sondern ein Abtausch.
      // Geprüft in dieser Reihenfolge, weil nur die erste Frage ohne das
      // Brett auskommt und die Schleife über jede gegnerische Figur läuft.
      if (zielwert <= wert && zielwert < 3) continue;
      if (!brett.attackers(stein.square, meine).includes(nach)) continue;
      if (zielwert <= wert && brett.attackers(stein.square, gegner).length > 0) continue;
      // Griff dieselbe Figur die Stellung davor schon an, ist nichts neu.
      if (davor.attackers(stein.square, meine).includes(von)) continue;
      if (!beste || zielwert > beste.wert) {
        beste = { figur: stein.type.toUpperCase(), feld: stein.square, wert: zielwert };
      }
    }
  }
  return beste ? { figur: beste.figur, feld: beste.feld } : null;
}
