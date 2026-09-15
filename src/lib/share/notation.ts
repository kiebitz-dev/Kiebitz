/**
 * Die Züge vor einer geteilten Stellung, gesetzt als Notation.
 *
 * Ein Link zeigte bisher nur die Stellung. Bei einer Aufgabe ist das richtig ·
 * dort ist die Vorgeschichte gerade nicht die Frage. Bei einer Analyse und bei
 * einer Eröffnungslinie ist sie die halbe Aussage: „So spiele ich es" heißt
 * ohne die Züge davor nur „so steht es". Deshalb reist die Zeile mit, die in
 * der App ohnehin unter dem Brett steht.
 *
 * Sie reist als fertiger Text und nicht als Zugpaare: Beide Leser · App und
 * Landeseite · zeigen sie nur an, und aus Feldpaaren müsste erst wieder
 * Notation werden. Dafür bräuchte die Landeseite die Ausgangsstellung, die im
 * Link gar nicht steht, und einen vollständigen SAN-Schreiber. Der Text kostet
 * ein paar Bytes mehr und spart beides.
 */
import { HISTORY_MAX_BYTES } from "./codec";

/** Vorne gekürzt · das Zeichen sagt, dass davor noch etwas war. */
const ELLIPSIS = "…";

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Halbzüge vor einer Stellung · aus Zugnummer und Seite am Zug gelesen.
 *
 * Gebraucht für Stellungen, die nicht aus der Grundstellung stammen: Am freien
 * Brett hinter einem geteilten Link fangen die eigenen Züge mitten in einer
 * Partie an, und „1.Bg4" wäre dort schlicht falsch.
 */
export function plyOffset(fen: string): number {
  const parts = fen.trim().split(/\s+/);
  const full = Math.trunc(Number(parts[5]));
  const move = Number.isFinite(full) && full >= 1 ? full : 1;
  return (move - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}

/**
 * Zugliste als „1.e4 e5 2.Nf3" · dieselbe Form, die die Seiten zeigen.
 *
 * `offset` sind die Halbzüge davor. Beginnt die Liste mit einem schwarzen Zug,
 * steht die Nummer als „10...Bg4" davor · sonst wüsste niemand, wo man ist.
 * Nur wenn schon Text davorsteht, entfällt sie: Dort trägt der weiße Zug die
 * Nummer bereits.
 */
export function notationText(
  sans: readonly string[],
  offset = 0,
  continuing = false
): string {
  return notationTokens(sans, offset, continuing).join(" ");
}

/**
 * Dieselbe Zeile, aber in ihre Züge zerlegt.
 *
 * Gebraucht, wo jeder Zug für sich anzufassen sein muss · eine anklickbare
 * Variante in der Analyse. Die Nummerierung steht deshalb hier und nicht dort:
 * Eine zweite Fassung derselben Regel liefe irgendwann auseinander, und dann
 * trüge die Zeile zum Lesen eine andere Zugnummer als die zum Anklicken.
 */
export function notationTokens(
  sans: readonly string[],
  offset = 0,
  continuing = false
): string[] {
  return sans.map((san, i) => {
    const ply = offset + i;
    if (ply % 2 === 0) return `${ply / 2 + 1}.${san}`;
    if (i === 0 && !continuing) return `${(ply + 1) / 2}...${san}`;
    return san;
  });
}

/**
 * Kürzt eine Notation von vorne auf das Byte-Budget des Links.
 *
 * Gekürzt wird vorne, weil die letzten Züge die Stellung erklären und die
 * ersten sie nur eröffnen. Angesetzt wird immer an einem weißen Zug: Sonst
 * begänne die Zeile mit einer Antwort ohne Zugnummer, und die Zählung wäre
 * verloren. Passt selbst der letzte Zug nicht mehr, bleibt nichts übrig · dann
 * ist das Budget das Problem und nicht die Zeile.
 */
export function trimNotation(text: string, maxBytes = HISTORY_MAX_BYTES): string {
  const full = text.trim();
  if (!full || byteLength(full) <= maxBytes) return full;
  const tokens = full.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    if (!/^\d/.test(tokens[i])) continue;
    const rest = `${ELLIPSIS} ${tokens.slice(i).join(" ")}`;
    if (byteLength(rest) <= maxBytes) return rest;
  }
  return "";
}

/**
 * Die Vorgeschichte, wie sie in den Link geht.
 *
 * `prefix` ist die Zeile, die schon aus einem geteilten Link kam · wer eine
 * geteilte Stellung weiterspielt und wieder teilt, gibt die ganze Partie
 * weiter und nicht nur seinen eigenen Anbau.
 */
export function shareHistory(
  sans: readonly string[],
  offset = 0,
  prefix = ""
): string {
  const head = prefix.trim();
  const text = notationText(sans, offset, head !== "");
  return trimNotation([head, text].filter(Boolean).join(" "));
}
