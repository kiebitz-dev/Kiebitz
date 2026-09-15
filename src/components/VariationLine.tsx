/**
 * Die empfohlene Variante · zum Lesen und zum Nachspielen.
 *
 * Die Anmerkung zu einem Fehler nennt seit 1.4 die bessere Linie im Wortlaut
 * („Besser war axb3: 13…axb3 14.Rxa5 Qxa5 15.Qxb3"). Gemeldet worden ist, dass
 * genau das zu wenig ist: Wer die Linie sehen will, muss sie buchstabieren und
 * am Brett von Hand nachziehen. Die Engine-Linien daneben helfen dabei nicht —
 * ein Klick auf sie spielt ihren *ersten* Zug und sonst nichts.
 *
 * Deshalb steht die Linie hier ein einziges Mal und ist anklickbar: Ein Tipp
 * auf den n-ten Zug legt die Variante bis dorthin aufs Brett. Der nächste Zug
 * ist der nächste Tipp, und damit blättert man die Empfehlung durch, statt sie
 * zu lesen. Was schon auf dem Brett steht, ist hervorgehoben — sonst wüsste
 * man nach dem dritten Tipp nicht mehr, wo man ist.
 *
 * Zweimal steht sie deshalb nicht: `kommentiereZug` lässt die Notation aus dem
 * Satz, wo diese Zeile daneben steht (`ohneLinien` in lib/erklaerung.ts).
 *
 * Eine Bauart, zwei Sätze · wie beim Motor (`LiveEngine`): In der gewöhnlichen
 * Fassung sind die Züge kleine Schaltflächen, im Buchsatz ist es eine Zeile
 * Notation mit einer Feldbeschriftung davor.
 */
import { useI18n } from "../lib/i18n";
import { notationParts } from "../lib/notation";

export interface Variante {
  /** Woher sie abzweigt · Halbzüge der Partie vor ihrem ersten Zug. */
  basePly: number;
  /** Ihre Züge in englischem SAN. */
  sans: readonly string[];
  /** Wofür sie steht · „Besser", „Fortsetzung". */
  label: string;
}

export default function VariationLine({
  variante,
  /** So viele ihrer Züge stehen gerade auf dem Brett · 0 heißt: keiner. */
  aktiv = 0,
  onPlay,
  blatt = false,
}: {
  variante: Variante;
  aktiv?: number;
  /** Die Linie bis zum n-ten Halbzug (1-basiert) aufs Brett legen. */
  onPlay: (halbzuege: number) => void;
  blatt?: boolean;
}) {
  const { t, locale } = useI18n();
  const teile = notationParts(variante.sans, locale, variante.basePly);
  if (teile.length === 0) return null;

  return (
    <div
      className={
        blatt
          ? "mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1"
          : "mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1"
      }
    >
      <span
        className={
          blatt ? "blatt-feld flex-none text-ink3" : "flex-none text-[11px] text-ink3"
        }
      >
        {variante.label}
      </span>
      {teile.map((teil, index) => (
        <button
          key={index}
          type="button"
          // „13…axb3" allein ist als Beschriftung eine Zumutung · wer die
          // Zeile nicht sieht, hört sonst eine Zugnummer ohne Auftrag.
          aria-label={t("an.playLine", { san: teil })}
          onClick={() => onPlay(index + 1)}
          className={
            blatt
              ? `buch notation text-[13px] leading-[1.5] ${
                  index < aktiv ? "text-accent" : "text-ink2 hover:text-ink"
                }`
              : `rounded px-1 py-0.5 font-mono text-[12px] transition-colors ${
                  index < aktiv
                    ? "bg-accent-soft text-accent"
                    : "text-ink2 hover:bg-panel3 hover:text-ink"
                }`
          }
        >
          {teil}
        </button>
      ))}
    </div>
  );
}

/**
 * Stehen genau die ersten `n` Züge dieser Linie auf dem Brett?
 *
 * Gefragt wird an derselben Stelle wie gezeichnet, damit die Hervorhebung
 * nicht an einer *anderen* Variante hängen bleibt: Wer die Empfehlung
 * anspielt und dann selbst weiterzieht, hat eine eigene Linie, und die ist
 * nicht mehr diese.
 */
export function aktiveZuege(
  variante: Variante,
  laufend: { basePly: number; sans: string[] } | null
): number {
  if (!laufend || laufend.basePly !== variante.basePly) return 0;
  if (laufend.sans.length > variante.sans.length) return 0;
  return laufend.sans.every((san, index) => san === variante.sans[index])
    ? laufend.sans.length
    : 0;
}
