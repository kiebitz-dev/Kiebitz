/**
 * Endspiele im Diagramm-Modus · die Aufgabe.
 *
 * Hier zieht man, also ist das Brett ein Brett: Feldfarben des Themas, kein
 * Abdruck. Der Unterschied zum Diagramm auf dem Start ist Absicht und soll
 * sofort sagen, ob man liest oder spielt. Deshalb kommt das Brett fertig von
 * der Seite herein, mit Zug, Hervorhebung und Drehung.
 *
 * Die fünfzehn Aufgaben stehen rechts als Verzeichnis, nach Kategorien
 * gegliedert. Die Zahl am Zeilenende ist das Ziel — 1 gewinnen, ½ Remis
 * halten —, dieselbe Schreibweise wie das Ergebnis in der Partienliste.
 *
 * Der Entwurf ließ die Fortschrittszahl offen, weil die Demo-Daten keine
 * Endspiel-Statistik führen. Die App führt eine: `endgame_stats` weiß, welche
 * Aufgabe gelöst wurde, und daraus steht „x von 15 gemeistert" im Kopf.
 */
import type { ReactNode } from "react";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  Schalterreihe,
  Verzeichnisteil,
  Verzeichniszeile,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";

export interface EndgameEintrag {
  id: string;
  name: string;
  /** Ziel der Aufgabe · „1" gewinnen, „½" Remis halten. */
  ziel: string;
  gemeistert: boolean;
}

export interface EndgameGruppe {
  titel: string;
  eintraege: EndgameEintrag[];
}

export interface EndgameBlattProps {
  mobile: boolean;
  felder: Feld[];
  /** Ziel im Kasten rechts · „1 : 0" oder „½ : ½". */
  ziel: string;
  /** Namen über und unter dem Brett. */
  oben: { name: string; farbe: "white" | "black" };
  unten: { name: string; farbe: "white" | "black" };
  /** Stand der Aufgabe · rechts neben dem eigenen Namen. */
  stand: ReactNode;
  brett: ReactNode;
  hinweis: string;
  /** Was mit den Tablebases anders wäre · der Satz der Seite, nicht erfunden. */
  fussnote: string;
  gruppen: EndgameGruppe[];
  aktiv: string;
  gemeistert: number;
  gesamt: number;
  schalter: { label: ReactNode; onClick?: () => void; betont?: boolean }[];
  /** Die Zufallsstellung als eigener Block unter der Bedienung. */
  zufall?: { titel: string; text: string; knopf: string; onClick: () => void };
  onWaehlen: (id: string) => void;
}

export default function EndgameBlatt({
  mobile,
  felder,
  ziel,
  oben,
  unten,
  stand,
  brett,
  hinweis,
  fussnote,
  gruppen,
  aktiv,
  gemeistert,
  gesamt,
  schalter,
  zufall,
  onWaehlen,
}: EndgameBlattProps) {
  const { t } = useI18n();

  // Das Brett ist so groß wie in der gewöhnlichen Fassung · `--board-edge`
  // ist dasselbe Maß, das dort die Spalte deckelt. Ein eigenes, kleineres
  // Maß hätte den Modus zu einer Ansicht gemacht, in der man schlechter
  // sieht.
  const brettSpalte = (
    <div className={mobile ? "flex flex-col" : "flex w-[var(--board-edge)] max-w-full flex-none flex-col"}>
      <div className="flex items-center gap-[9px] pb-[9px]">
        <Farbfeld farbe={oben.farbe} kante={11} />
        <span className="truncate text-[14px] text-ink">{oben.name}</span>
      </div>
      {brett}
      <div className="flex items-center gap-[9px] pt-[9px]">
        <Farbfeld farbe={unten.farbe} kante={11} />
        <span className="truncate text-[14px] text-ink">{unten.name}</span>
        <span className="flex-1" />
        <span className="text-[12.5px] text-accent">{stand}</span>
      </div>
      <div className="mt-3">
        <Schalterreihe eintraege={schalter} />
      </div>
      {zufall && (
        <>
          <div className="flex-1" />
          <div className="mt-3 border-t border-line pt-3">
            <Feldname>{zufall.titel}</Feldname>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{zufall.text}</p>
            <button
              type="button"
              onClick={zufall.onClick}
              className="mt-2 flex h-11 w-full items-center justify-center border border-ink text-[13px] text-ink"
            >
              {zufall.knopf}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const verzeichnis = (
    <div className="flex min-w-0 flex-1 flex-col">
      <Rubrik>{t("blatt.theHint")}</Rubrik>
      <div className="buch mt-2.5 border-s-2 border-line2 ps-3 text-[14.5px] leading-[1.55] text-ink2">
        {`„${hinweis}“`}
      </div>
      <div className="mt-2 text-[11px] leading-[1.55] text-ink3">{fussnote}</div>
      <div className="mt-4 min-h-0 flex-1">
        <Rubrik weg={t("eg.progress", { n: deInt(gemeistert), m: deInt(gesamt) })}>
          {t("eg.drills")}
        </Rubrik>
        {gruppen.map((gruppe) => (
          <div key={gruppe.titel}>
            <Verzeichnisteil>{gruppe.titel}</Verzeichnisteil>
            {gruppe.eintraege.map((eintrag) => (
              <Verzeichniszeile
                key={eintrag.id}
                name={
                  <span className="flex items-center gap-2">
                    {/* Gemeistert bekommt ein gefülltes Kästchen · dieselbe
                        Marke wie die Tagesaufgaben auf dem Start. */}
                    <span
                      aria-hidden
                      className={`inline-block h-[9px] w-[9px] flex-none border ${
                        eintrag.gemeistert ? "border-ink bg-ink" : "border-line2"
                      }`}
                    />
                    {eintrag.name}
                  </span>
                }
                zahl={eintrag.ziel}
                aktiv={eintrag.id === aktiv}
                hoehe={mobile ? 46 : 34}
                onClick={() => onWaehlen(eintrag.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] text-ink3">
        {t("blatt.goalKey")}
      </div>
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel
        links={t("blatt.endgameTitle")}
        rechts={t("eg.progress", { n: deInt(gemeistert), m: deInt(gesamt) })}
      />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1.5fr 1fr 0.8fr 1.2fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-[120px] ps-3.5"}`}>
          <Feldname>{t("blatt.goal")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {ziel}
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
        <div className="mt-3.5">{brettSpalte}</div>
        <div className="mt-4">{verzeichnis}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        {verzeichnis}
      </div>
    </div>
  );
}
