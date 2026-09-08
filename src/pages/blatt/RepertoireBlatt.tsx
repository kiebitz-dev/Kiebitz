/**
 * Repertoire im Diagramm-Modus · das Buch.
 *
 * Die Seite, für die das Idiom gemacht scheint: Ein Repertoire *ist* ein Buch,
 * und die App nennt es selbst so („Buch als PGN"). Links steht es als
 * Inhaltsverzeichnis — Weiß und Schwarz als Teile, die Varianten als Kapitel,
 * Punktlinie, und rechts die Zahl. Die Zahl ist bewusst nicht die Länge der
 * Variante, sondern was heute fällig ist; die Fußnote sagt das.
 *
 * In der Mitte die Buchstellung als gedrucktes Diagramm — nicht als Brett,
 * denn hier wird gelesen, nicht gezogen. Erst im Training wird daraus ein
 * Brett mit den Feldfarben des Themas.
 */
import type { ReactNode } from "react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import {
  Balken,
  Ergebniskasten,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  Verzeichnisteil,
  Verzeichniszeile,
  Zugfolge,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";

export interface BuchZeile {
  key: string;
  name: string;
  /** Was an dieser Variante heute fällig ist · nicht ihre Länge. */
  faellig: number;
}

export interface BuchTeil {
  titel: string;
  zeilen: BuchZeile[];
}

export interface RepertoireBlattProps {
  mobile: boolean;
  kopfRechts: ReactNode;
  felder: Feld[];
  /** Was heute insgesamt fällig ist · der Kasten rechts. */
  faellig: number;
  teile: BuchTeil[];
  aktiv: string | null;
  /** Buchstellung · ein Abdruck, kein Brett. */
  fen: string;
  unterschrift: string[];
  amZug: "white" | "black";
  /** Die Zugfolge der Linie, schon in der Sprache der Oberfläche gesetzt. */
  linie: string;
  /** Angaben zum gewählten Knoten · Formularfelder. */
  angaben: { label: string; wert: ReactNode }[];
  notiz: string;
  notizPlatzhalter: string;
  abdeckung: number | null;
  abdeckungNote: string;
  abdeckungUnter: string;
  luecken: ReactNode;
  onWaehlen: (key: string) => void;
  onHinzufuegen: () => void;
  onTraining: () => void;
}

export default function RepertoireBlatt({
  mobile,
  kopfRechts,
  felder,
  faellig,
  teile,
  aktiv,
  fen,
  unterschrift,
  amZug,
  linie,
  angaben,
  notiz,
  notizPlatzhalter,
  abdeckung,
  abdeckungNote,
  abdeckungUnter,
  luecken,
  onWaehlen,
  onHinzufuegen,
  onTraining,
}: RepertoireBlattProps) {
  const { t } = useI18n();

  const buch = (
    <div className={mobile ? "flex flex-col" : "flex w-[290px] flex-none flex-col"}>
      <Rubrik weg={t("rep.addLine")} onWeg={onHinzufuegen}>
        {t("blatt.theBook")}
      </Rubrik>
      {teile.map((teil) => (
        <div key={teil.titel}>
          <Verzeichnisteil>{teil.titel}</Verzeichnisteil>
          {teil.zeilen.map((zeile) => (
            <Verzeichniszeile
              key={zeile.key}
              name={zeile.name}
              zahl={zeile.faellig > 0 ? deInt(zeile.faellig) : ""}
              aktiv={zeile.key === aktiv}
              hoehe={mobile ? 46 : 44}
              onClick={() => onWaehlen(zeile.key)}
            />
          ))}
        </div>
      ))}
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-[1.6] text-ink3">
        {t("blatt.bookNumberNote")}
      </div>
    </div>
  );

  // Der Abdruck ist so groß wie ein Brett in der gewöhnlichen Fassung ·
  // `--board-edge` ist dasselbe Maß, das dort die Spalte deckelt. Ohne `size`
  // nimmt das Diagramm die Breite, die es bekommt, und bleibt quadratisch;
  // die Hülle gibt sie vor, und die Bildunterschrift folgt ihr.
  const diagrammBlock = (
    <div className={mobile ? "" : "w-[var(--board-edge)] max-w-full flex-none"}>
      <Diagramm fen={fen} orientation={amZug === "black" ? "white" : "white"} />
      <Bildunterschrift
        nummer={unterschrift[0]}
        zeilen={unterschrift.slice(1)}
        amZug={{
          farbe: amZug,
          text: amZug === "white" ? t("sh.whiteToMove") : t("sh.blackToMove"),
        }}
      />
    </div>
  );

  const rechts = (
    <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
      <div>
        <Rubrik>{t("blatt.theLine")}</Rubrik>
        <div className="mt-[11px]">
          <Feldname>{t("blatt.bookMoves")}</Feldname>
          <div className="mt-1">
            <Zugfolge gross={15}>{linie}</Zugfolge>
          </div>
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-x-5">
          {angaben.map((angabe) => (
            <div key={angabe.label} className="border-b border-line py-[5px]">
              <Feldname>{angabe.label}</Feldname>
              <div className="mt-[3px] truncate text-[12.5px] text-ink">{angabe.wert}</div>
            </div>
          ))}
        </div>
        <div className="mt-3.5">
          <Feldname>{t("rep.note")}</Feldname>
          <div
            className={`buch mt-1.5 text-[14px] leading-[1.85] ${notiz ? "text-ink2" : "text-ink3"}`}
            style={{
              background:
                "repeating-linear-gradient(to bottom, transparent 0, transparent 24px, var(--color-line) 24px, var(--color-line) 25px)",
            }}
          >
            {notiz || notizPlatzhalter}
          </div>
        </div>
      </div>

      {abdeckung != null && (
        <div>
          <Rubrik>{t("rep.coverage")}</Rubrik>
          <div className="mt-2.5 flex items-end gap-3.5">
            <span className="blatt-zahl text-[26px] font-medium leading-none text-ink">
              {de(abdeckung)} %
            </span>
            <span className="min-w-0 flex-1 pb-[3px]">
              <Balken anteil={abdeckung} hoehe={8} />
              <span className="mt-1 block text-[11px] text-ink3">{abdeckungUnter}</span>
            </span>
          </div>
          <div className="mt-2 text-[11px] leading-[1.55] text-ink3">{abdeckungNote}</div>
        </div>
      )}

      <div>
        <Rubrik weg={t("rep.startTraining", { n: deInt(faellig) })} onWeg={onTraining}>
          {t("rep.gaps")}
        </Rubrik>
        <div className="mt-2 text-[12.5px] leading-[1.6] text-ink3">{luecken}</div>
      </div>
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("blatt.repertoireTitle")} rechts={kopfRechts} />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1.4fr 0.6fr 1.2fr 1.5fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-[110px] ps-3.5"}`}>
          <Feldname>{t("blatt.dueToday")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {deInt(faellig)}
            </Ergebniskasten>
          </div>
        </div>
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3.5">{diagrammBlock}</div>
        <div className="mt-4">{rechts}</div>
        <div className="mt-4">{buch}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-8 pt-5">
        {buch}
        {diagrammBlock}
        {rechts}
      </div>
    </div>
  );
}
