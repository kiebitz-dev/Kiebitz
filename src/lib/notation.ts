/**
 * Englisches SAN für die Anzeige · Buchstaben bleiben, Typografie kommt dazu.
 *
 * Die App rechnet und speichert durchgehend in englischem SAN — chess.js
 * spricht es, die PGN-Dateien tragen es, und die Referenzdatenbank steht voll
 * davon. Gesetzt wird es auch so: `Rxe2` heißt auf jedem Blatt `Rxe2`.
 *
 * Bis 1.4 tauschte diese Datei die Figurenbuchstaben in die Sprache der
 * Oberfläche (deutsch K D T L S, französisch R D T F C, spanisch R D T A C).
 * Das war gut gemeint und stimmte nur halb: Übersetzt wurden die Sätze der
 * Analyse und der Satzspiegel des Diagramm-Modus, nicht aber die Zugliste,
 * das Eröffnungsbuch, die geteilten Bilder oder die Engine-Linien. Auf
 * demselben Bildschirm stand dann „Rxe2" über einem Satz, der von „Txe2"
 * sprach — zwei Namen für einen Zug sind schlechter als ein fremder. Jetzt
 * steht überall derselbe, und zwar der, den auch die PGN trägt.
 *
 * Was bleibt, ist die Typografie der Rochade: Der Buchsatz schreibt sie seit
 * je mit Nullen und Halbgeviertstrich (0–0), SAN mit Buchstaben-O und
 * Bindestrichen. Das ist keine Übersetzung, sondern Satz, und gilt deshalb in
 * jeder Sprache.
 */
import type { Locale } from "./i18n";
import { notationText } from "./share/notation";

/**
 * Ein einzelner Zug, fertig gesetzt.
 *
 * `locale` steht weiter im Kopf: Die Rochade ist heute in jeder Sprache
 * gleich, aber der Aufrufer soll nicht anfangen, die Anzeige an der Sprache
 * vorbei zu bauen, wenn morgen doch etwas daran hängt.
 */
export function translateSan(san: string, _locale: Locale): string {
  const move = san.trim();
  if (!move) return move;

  // Rochade · Nullen und Halbgeviertstrich statt O und Bindestrich.
  const castle = /^(O-O-O|O-O|0-0-0|0-0)([+#]?)(.*)$/.exec(move);
  if (castle) {
    const long = castle[1].length > 3;
    return `0\u20130${long ? "\u20130" : ""}${castle[2]}${castle[3]}`;
  }

  return move;
}

/**
 * Eine ganze Zugfolge · „14.d4 exd4 15.cxd4".
 *
 * Gesetzt wird aus den einzelnen Zügen und nicht aus einer fertigen Zeile:
 * Jeder geht einzeln durch `translateSan` und bekommt damit dieselbe
 * Rochaden-Typografie wie ein Zug, der allein steht. Die Nummerierung kommt
 * aus `share/notation.ts` · dieselbe Form, die die Seiten heute schon zeigen.
 *
 * `offset` sind die Halbzüge davor (0 = die Folge beginnt mit 1.).
 */
export function notationLine(
  sans: readonly string[],
  locale: Locale,
  offset = 0,
  continuing = false
): string {
  return notationText(
    sans.map((san) => translateSan(san, locale)),
    offset,
    continuing
  );
}
