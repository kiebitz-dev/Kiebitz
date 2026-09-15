/**
 * Der Kopf eines Tiefenreiters im Diagramm-Modus.
 *
 * Jeder der fünf Reiter beantwortet eine andere Frage, also trägt jeder seinen
 * eigenen Formularkopf: vier Felder auf Linien und rechts der eine Wert, der
 * eingekastelt gehört. Auf der Übersicht setzt ihn `InsightsBlatt` selbst;
 * hier bringt ihn der Reiter mit, weil nur er weiß, was oben stehen muss —
 * gerechnet wird es in der Variante und nicht in der gemeinsamen Seite.
 *
 * Mobil stehen zwei Felder statt vier: Vier Spalten auf Telefonbreite sind
 * vier abgeschnittene Wörter.
 */
import { Ergebniskasten, Feldname, Formularkopf, type Feld } from "../../../components/blatt/Satz";

export default function Reiterkopf({
  mobile,
  felder,
  kasten,
  spalten = "1fr 1.2fr 1.4fr 1.4fr",
}: {
  mobile: boolean;
  felder: Feld[];
  /**
   * Der eingekastelte Wert rechts · die eine Antwort des Reiters.
   *
   * `wort` sagt, dass dort ein Name steht und keine Zahl: die schwächste Phase,
   * die schwächste Eröffnung. Der Kasten misst sich dann an seinem Inhalt und
   * bricht um, statt ihn abzuschneiden — „Italian Game: Giuoco Piano" wurde in
   * 112 Pixel gezwängt und las sich als „Italian G…".
   */
  kasten: { label: string; wert: string; gross?: number; wort?: boolean };
  spalten?: string;
}) {
  return (
    <div className="mb-5 flex items-end">
      <div className="min-w-0 flex-1">
        <Formularkopf
          felder={mobile ? felder.slice(0, 2) : felder}
          spalten={mobile ? "1fr 1fr" : spalten}
        />
      </div>
      <div
        className={`flex-none border-s border-line ${
          kasten.wort
            ? mobile
              ? "ps-2.5"
              : "ps-3.5"
            : mobile
              ? "w-[80px] ps-2.5"
              : "w-[112px] ps-3.5"
        }`}
      >
        <Feldname>{kasten.label}</Feldname>
        <div className={`mt-1.5 ${kasten.wort ? (mobile ? "min-w-[78px]" : "min-w-[96px]") : ""}`}>
          <Ergebniskasten
            hoehe={mobile ? 27 : 32}
            gross={mobile ? (kasten.wort ? 12 : 11) : (kasten.gross ?? 13)}
            wort={kasten.wort}
            maxBreite={kasten.wort ? (mobile ? 124 : 176) : undefined}
          >
            {kasten.wert}
          </Ergebniskasten>
        </div>
      </div>
    </div>
  );
}
