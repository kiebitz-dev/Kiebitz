/**
 * Partien im Diagramm-Modus · das Partienverzeichnis.
 *
 * Aus der Tabelle wird das Register hinten im Turnierbuch: laufende Nummer
 * links, Haarlinie unter jeder Zeile, Ergebnis als Punkt statt als Pille,
 * gespielte Farbe als Feld statt als eigener Wortspalte.
 *
 * Die größere Änderung steht darüber: Die Filter sind keine Pillenreihe mehr,
 * sondern ausgefüllte Formularfelder. Damit liest man den Filterzustand als
 * Satz und nicht als Sammlung angeschalteter Knöpfe.
 *
 * Auf dem Telefon stehen sie nicht alle nebeneinander — dort passen zwei
 * Felder in eine Zeile, und vier davon schöben die erste Partie unter den
 * Bildrand. Die Leiste trägt deshalb nur das Suchfeld und daneben zwei Griffe
 * in derselben Höhe: Filter und Import, beide als Kästchen aus einer Haarlinie,
 * beide schlagen ihren Abschnitt darunter auf. Am Rechner ist die Zeile breit
 * genug für alle Felder; dort steht nur der Import als Griff daneben.
 *
 * Auch die Zeilen der Liste sind Griffe: Datum, Farbfeld, Gegner, Eröffnung,
 * ECO und Ergebnispunkt schränken das Verzeichnis auf genau diesen Wert ein,
 * statt die Partie zu wählen — dieselbe Bewegung wie auf dem Startblatt.
 *
 * Rechts der Eintrag zur gewählten Partie: Schlussstellung als Diagramm — hier
 * wird gelesen, nicht gezogen, also ein Abdruck — darunter die Bildunterschrift
 * mit dem letzten Zug und dem Ausgang, die Angaben als Formularfelder, und
 * zuletzt die Stichwörter und die Bemerkung auf liniertem Grund.
 *
 * Geschrieben wird im Eintrag, nicht in der Liste: Stichwörter und Bemerkung
 * gehören zu genau einer Partie, und der Eintrag ist die Stelle, an der genau
 * eine Partie steht. Das Register daneben bleibt lesbar — in seinen Zeilen
 * steht nichts, was zur nächsten nicht passt. Was der Nutzer schreibt, geht
 * beim Verlassen des Feldes in die Datenbank; ein Formular auf Papier hat
 * keinen Knopf „Sichern", und die Zeile darüber sagt, dass es angekommen ist.
 *
 * Die Angaben darüber bleiben Griffe zurück in die Liste — ein Klick auf
 * Quelle, Datum, Gegner oder Eröffnung schränkt das Verzeichnis auf genau
 * diesen Wert ein.
 */
import { useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, SlidersHorizontal } from "lucide-react";
import MobileSheet from "../../components/MobileSheet";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import { MarkenSchluessel, PartieZeile } from "../../components/blatt/PartieZeile";
import {
  Ergebniskasten,
  Feldname,
  Kolumnentitel,
  Punkt,
  Rubrik,
  Stichwortzeile,
  Weg,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import type { GamesFilter, UiGame } from "../../lib/gameUi";

/**
 * Der linierte Grund der Bemerkung · 24 px Zeile, 1 px Linie.
 *
 * Er steht hier und nicht zweimal im Satz: Gelesen und geschrieben wird auf
 * demselben Papier, und zwei Verläufe, die gleich aussehen sollen, laufen
 * irgendwann auseinander. Die Farbe kommt aus dem Token.
 */
const LINIEN =
  "repeating-linear-gradient(to bottom, transparent 0, transparent 24px," +
  " var(--color-line) 24px, var(--color-line) 25px)";

/**
 * Ein Filter als ausgefülltes Formularfeld.
 *
 * Drei Arten: ein Feld, in das man schreibt (`onChange`), eines, das
 * weiterschaltet (`onClick`), und eines, das nur dasteht.
 */
export interface Filterfeld {
  label: string;
  /** Was drinsteht · leer heißt „alle", und dann steht die Linie blass. */
  wert: string;
  leer: boolean;
  breite?: number;
  /** Platzhalter des Schreibfeldes. */
  platzhalter?: string;
  /**
   * Das Suchfeld · genau eines der Felder trägt die Marke.
   *
   * Am Rechner ändert sie nichts: Dort stehen alle Felder nebeneinander. Auf
   * dem Telefon bleibt allein dieses in der Leiste stehen, und die übrigen
   * kommen erst, wenn man die Filter aufschlägt — sonst steht die halbe Seite
   * voll Formular, bevor die erste Partie zu sehen ist.
   */
  suche?: boolean;
  onChange?: (value: string) => void;
  onClick?: () => void;
}

/**
 * Der Import als aufklappbarer Abschnitt.
 *
 * Der Inhalt kommt fertig aus `Games.tsx` — es ist derselbe Import wie in der
 * gewöhnlichen Fassung, nur unter `.blatt-formular` gesetzt (siehe
 * `blatt.css`): eckige Felder, Linien statt Flächen. Ihn hier ein zweites Mal
 * zu bauen hieße, jede neue Importquelle an zwei Stellen zu pflegen, und die
 * zweite bliebe zurück.
 */
export interface Importbereich {
  offen: boolean;
  onUmschalten: () => void;
  inhalt: ReactNode;
  /** Die Meldung des laufenden Imports · steht über dem Abschnitt. */
  meldung?: ReactNode;
}

export interface GamesBlattProps {
  mobile: boolean;
  /** Bestand der Datenbank · null in der Web-Vorschau. */
  bestand: number | null;
  filter: Filterfeld[];
  treffer: number;
  /** Die Zeilen dieses Blattes und ihre laufenden Nummern. */
  zeilen: { game: UiGame; nummer: number | null }[];
  gewaehlt: UiGame | undefined;
  /** Schlussstellung der gewählten Partie · schon gerechnet. */
  fen: string;
  /**
   * Die Bildunterschrift dazu, von der Seite gesetzt · die Nummer des
   * Eintrags und darunter, was zu dieser Stellung zu sagen ist. Kein reiner
   * Text: In der Titelzeile ist der Name des Gegners zugleich ein Filtergriff.
   */
  unterschrift: { nummer: string; zeilen: ReactNode[] };
  /**
   * Angaben zur gewählten Partie · Formularfelder unter dem Diagramm. Mit
   * `onClick` wird aus der Angabe ein Griff, der die Liste auf genau diesen
   * Wert einschränkt — dieselbe Bewegung wie in der gewöhnlichen Fassung.
   */
  angaben: { label: string; wert: ReactNode; onClick?: () => void }[];
  /**
   * Stichwörter der gewählten Partie · dieselben Tags wie in der Tabelle.
   * Geschrieben werden sie hier, sobald `onStichwoerter` mitkommt; ohne die
   * Rückmeldung bleibt die Zeile Auskunft — so in der Web-Vorschau, wo hinter
   * der Partie keine Datenbank steht, die sie behalten könnte.
   */
  stichwoerter: string[];
  /** Wort, das die App selbst vergibt · steht mit wie ein eigenes. */
  stichwortVorsatz?: string;
  /** Nimmt die geänderte Liste entgegen · fehlt sie, ist die Zeile nur zu lesen. */
  onStichwoerter?: (woerter: string[]) => void;
  notiz: string;
  /** Nimmt die geschriebene Bemerkung entgegen · dieselbe Bedingung. */
  onNotiz?: (text: string) => void;
  von: number;
  bis: number;
  blatt: number;
  blaetter: number;
  /** Wie viele Partien auf ein Blatt gehen · steht mit in der Fußzeile. */
  proBlatt: number;
  minProBlatt: number;
  maxProBlatt: number;
  onProBlatt: (n: number) => void;
  /** Sprung auf ein bestimmtes Blatt · die Zahl in der Fußzeile ist der Griff. */
  onBlattWaehlen: (n: number) => void;
  onZurueck: () => void;
  onWeiter: () => void;
  onWaehlen: (game: UiGame) => void;
  /**
   * Der Weg in die Analyse · fehlt er, gibt es zu dieser Partie keine, weil
   * sie nicht in der Datenbank steht. Ein Griff, der nichts tut, ist schlimmer
   * als keiner: Er sieht aus wie ein Angebot und ist keins.
   */
  onAnalyse?: () => void;
  /** Ist sie schon analysiert? Danach heißt der Weg „öffnen" statt „starten". */
  analysiert?: boolean;
  onOriginal?: () => void;
  /** Import und Export · fehlt ohne Datenbank, also in der Web-Vorschau. */
  einfuhr?: Importbereich;
  /**
   * Sind die Filter auf dem Telefon aufgeschlagen?  Am Rechner stehen sie
   * ohnehin alle in der Kopfleiste.
   */
  filterOffen?: boolean;
  onFilterUmschalten?: () => void;
  /**
   * Ein Klick auf eine einzelne Angabe in der Liste · er schränkt das
   * Verzeichnis auf genau diesen Wert ein, statt die Partie zu wählen.
   * Dieselben sechs Griffe wie auf dem Startblatt: Datum, Farbfeld, Gegner,
   * Eröffnung, ECO und Ergebnispunkt. Mobil gibt es sie nicht — dort steht die
   * Zeile zweizeilig und ohne eigene Spalten, und ein Griff bräuchte eine
   * Spalte, an der er hinge.
   */
  onFilter?: (filter: GamesFilter) => void;
  /**
   * Die Partie-Ansicht des Telefons.
   *
   * Am Rechner steht der Eintrag rechts neben dem Verzeichnis; auf dem Telefon
   * gibt es die zweite Spalte nicht, dort liegt er als eigenes Blatt darüber.
   * Geblättert wird in der festen Leiste darunter und per Wischen — beides
   * bringt die Detailschicht der Hülle schon mit, der Modus setzt sie nur neu.
   */
  eintragBlatt?: {
    offen: boolean;
    onSchliessen: () => void;
    onZurueck?: () => void;
    onWeiter?: () => void;
    /** Stelle der Partie in der Trefferliste · eins­basiert wie in der Liste. */
    stelle: number;
    gesamt: number;
  };
}

export default function GamesBlatt({
  mobile,
  eintragBlatt,
  bestand,
  filter,
  treffer,
  zeilen,
  gewaehlt,
  fen,
  unterschrift,
  angaben,
  stichwoerter,
  stichwortVorsatz,
  onStichwoerter,
  notiz,
  onNotiz,
  von,
  bis,
  blatt,
  blaetter,
  proBlatt,
  minProBlatt,
  maxProBlatt,
  onProBlatt,
  onBlattWaehlen,
  onZurueck,
  onWeiter,
  onWaehlen,
  onAnalyse,
  analysiert = false,
  onOriginal,
  einfuhr,
  filterOffen = false,
  onFilterUmschalten,
  onFilter,
}: GamesBlattProps) {
  const { t } = useI18n();

  /**
   * Die beiden Zahlen der Fußzeile, solange in sie geschrieben wird.
   *
   * `null` heißt: Es steht die Zahl da, nicht das Feld. Der Zustand bleibt
   * hier und geht nicht an die Seite: Was jemand halb getippt hat, ist keine
   * Einstellung, sondern ein Zwischenstand — und ein „7" auf dem Weg zu „70"
   * dürfte die Liste nicht schon neu laden.
   */
  const [sprung, setSprung] = useState<string | null>(null);
  const [groesse, setGroesse] = useState<string | null>(null);

  /**
   * Die Bemerkung, solange sie im Feld steht, und die Auskunft, dass sie
   * angekommen ist.
   *
   * Der Entwurf liegt in einem Ref und nicht im Zustand: Getippt wird Zeichen
   * für Zeichen, zu sehen ist davon nichts, was die App setzen müsste — ein
   * Zustand ließe das ganze Blatt bei jedem Buchstaben neu laufen. Beim
   * Verlassen des Feldes wird er geleert; deshalb trägt er nie den halben Satz
   * der einen Partie in die nächste.
   */
  const bemerkung = useRef<string | null>(null);
  const [gesichert, setGesichert] = useState(false);

  const sichereBemerkung = () => {
    const text = bemerkung.current;
    bemerkung.current = null;
    // Nichts geschrieben oder nichts geändert · dann ist auch nichts zu melden.
    if (!onNotiz || text === null || text === notiz) return;
    onNotiz(text);
    setGesichert(true);
    window.setTimeout(() => setGesichert(false), 1500);
  };

  const uebernehmeSprung = () => {
    const n = parseInt(sprung ?? "", 10);
    if (!Number.isNaN(n)) onBlattWaehlen(n);
    setSprung(null);
  };

  const uebernehmeGroesse = () => {
    const n = parseInt(groesse ?? "", 10);
    if (!Number.isNaN(n)) onProBlatt(n);
    setGroesse(null);
  };

  /** Ein einzelnes Filterfeld · ausgefülltes Formular statt Pillenreihe. */
  const feldSatz = (feld: Filterfeld) => {
    // Ein gefülltes Feld steht auf einer kräftigen Linie, ein leeres auf
    // einer blassen · so liest man den Filterzustand als Satz.
    const linie = `mt-1.5 block w-full min-h-11 truncate border-b pb-[5px] text-start text-[13.5px] ${
      feld.leer ? "border-line2 text-ink3" : "border-ink text-ink"
    }`;
    return (
      <div
        key={feld.label}
        className={feld.breite ? "flex-none" : "min-w-0 flex-1"}
        style={feld.breite ? { width: feld.breite } : undefined}
      >
        <Feldname>{feld.label}</Feldname>
        {feld.onChange ? (
          <input
            value={feld.wert}
            onChange={(event) => feld.onChange!(event.target.value)}
            placeholder={feld.platzhalter}
            aria-label={feld.label}
            className={`${linie} bg-transparent placeholder:text-ink3 focus:outline-none`}
          />
        ) : feld.onClick ? (
          <button type="button" onClick={feld.onClick} className={linie}>
            {feld.wert}
          </button>
        ) : (
          <span className={linie}>{feld.wert}</span>
        )}
      </div>
    );
  };

  // Über die vier festen Felder hinaus kommen die Einschränkungen dazu, die
  // aus dem Start oder aus dem Eintrag gesetzt wurden · sie umbrechen lieber
  // in eine zweite Zeile, als das Suchfeld auf nichts zusammenzudrücken.
  const filterfelder = (
    <div className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-2">{filter.map(feldSatz)}</div>
  );

  // ── Die Leiste des Telefons ───────────────────────────────────────────────
  // Ein Feld zum Suchen, eines zum Filtern, eines zum Einlesen — in einer
  // Zeile, wie in der gewöhnlichen Fassung. Untereinander gesetzt schöbe das
  // Formular die erste Partie unter den Bildrand, und ein Verzeichnis, dessen
  // Einträge man erst suchen muss, ist keins.
  const suchfeld = filter.find((feld) => feld.suche);
  const weitereFelder = filter.filter((feld) => !feld.suche);
  const gesetzt = weitereFelder.filter((feld) => !feld.leer).length;

  /** Ein Griff der Leiste · quadratisch, Haarlinie, wie ein Formularkästchen. */
  const leistenGriff = (
    name: string,
    aktiv: boolean,
    zeichen: ReactNode,
    onClick: () => void,
    zahl?: number
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={name}
      aria-label={name}
      aria-expanded={aktiv}
      className={`relative flex h-11 w-11 flex-none items-center justify-center border ${
        aktiv ? "border-ink text-ink" : "border-line2 text-ink2"
      }`}
    >
      {zeichen}
      {zahl != null && zahl > 0 && (
        <span className="blatt-zahl absolute end-[3px] top-[3px] text-[10px] text-ink">{zahl}</span>
      )}
    </button>
  );

  const leiste = (
    <div className="flex items-end gap-3">
      {suchfeld && feldSatz(suchfeld)}
      {onFilterUmschalten &&
        leistenGriff(
          t("games.filters"),
          filterOffen,
          <SlidersHorizontal size={17} />,
          onFilterUmschalten,
          gesetzt
        )}
      {einfuhr &&
        leistenGriff(
          t("games.manageImports"),
          einfuhr.offen,
          <Download size={17} />,
          einfuhr.onUmschalten
        )}
    </div>
  );

  /**
   * Der Tabellenkopf ist genauso gebaut wie die Zeile darunter: die laufende
   * Nummer außen, alles übrige in einer zweiten Reihe mit demselben Abstand
   * wie in `PartieZeile`. Nur so steht jede Beschriftung wirklich über ihrer
   * Spalte — mit einem einzigen flachen Raster liefe der Kopf um die
   * Differenz der beiden Abstände aus dem Tritt.
   */
  const kopfzeile = (
    <div className="flex items-center gap-[9px] border-b border-ink pb-[5px]">
      <span className="blatt-feld w-8 flex-none text-ink3">{t("blatt.no")}</span>
      <span className="flex min-w-0 flex-1 items-center gap-[14px]">
        <span className="blatt-feld w-[76px] flex-none text-ink3">{t("games.colDate")}</span>
        <span className="w-2.5 flex-none" />
        {/* Die Gegnerspalte ist die einzige feste, die nachgeben darf: Namen
            sind ohnehin gekürzt, ein Datum oder eine Prozentzahl dagegen wäre
            gekürzt nur noch falsch. Sie und die Eröffnung behalten dabei eine
            Untergrenze — zwei Spalten, die auf null zusammengehen, sind keine
            Spalten mehr. Der Kopf hält dieselben Maße wie die Zeile. */}
        <span className="blatt-feld w-[168px] min-w-20 shrink truncate text-ink3">
          {t("games.colOpponent")}
        </span>
        <span className="blatt-feld min-w-[72px] flex-1 truncate text-ink3">
          {t("games.colOpening")}
        </span>
        <span className="blatt-feld w-[34px] flex-none text-ink3">ECO</span>
        <span className="blatt-feld w-[18px] flex-none text-center text-ink3">
          {t("blatt.points")}
        </span>
        {/* Die Genauigkeit ist die einzige Spalte, deren Beschriftung kürzer
            ist als ihre Zahlen. Rechtsbündig stünde sie deshalb zwar bündig
            mit deren Ende, aber gut fünf Bildpunkte rechts von deren Anfang —
            und über einer Zahlenspalte liest man die Beschriftung von links.
            Sie steht deshalb linksbündig, um genau den leeren Teil einer
            zweistelligen Prozentzahl eingerückt („91,2 %" ist 43 der 52
            Bildpunkte breit). Beides sind Logik-Eigenschaften, also stimmt es
            auch in einer Sprache, die von rechts nach links läuft. */}
        <span className="blatt-feld w-[52px] flex-none truncate ps-[9px] text-start text-ink3">
          {t("blatt.accuracyShort")}
        </span>
        <span className="w-2.5 flex-none" />
      </span>
    </div>
  );

  const liste = (
    <div>
      {!mobile && kopfzeile}
      {zeilen.map(({ game, nummer }) => {
        const aktiv = gewaehlt?.id === game.id;
        return (
          <div key={game.id} className="group relative flex items-center gap-[9px]">
            {/* Die Marke des laufenden Eintrags steht am Bund, also vor der
                Nummer und nicht zwischen Nummer und Datum · sie zeigt auf die
                ganze Zeile, nicht auf eine ihrer Spalten. Mobil gibt es keine
                Nummernspalte; dort setzt die Zeile sie selbst.

                Beim Überfahren steht sie blass schon da. Das ist keine Zierde:
                In dieser Zeile führen sechs Spalten ins Verzeichnis zurück und
                nur der Rest zur Partie — ohne die Marke sähe man der Zeile
                nicht an, dass sie überhaupt eine Partie aufschlägt. */}
            {!mobile && (
              <span
                aria-hidden
                className={`absolute inset-y-1.5 -start-3.5 w-[3px] ${
                  aktiv ? "bg-ink" : "group-hover:bg-line2"
                }`}
              />
            )}
            {/* Die laufende Nummer ist der Griff auf die ganze Partie · im
                Register schlägt man einen Eintrag über seine Nummer auf, und
                sie ist die eine Spalte der Zeile, die nicht filtert. */}
            {!mobile && (
              <button
                type="button"
                onClick={() => onWaehlen(game)}
                title={t("blatt.openEntry")}
                aria-label={t("blatt.openEntry")}
                className="blatt-zahl min-h-11 w-8 flex-none text-start text-[11px] text-ink3 hover:text-ink"
              >
                {nummer ?? ""}
              </button>
            )}
            <span className="min-w-0 flex-1">
              <PartieZeile
                game={game}
                mobile={mobile}
                aktiv={mobile && aktiv}
                notiz={Boolean(game.note)}
                offen={!game.analyzed}
                filter={
                  onFilter && !mobile
                    ? {
                        onDatum: () => onFilter({ date: game.dateKey ?? game.date }),
                        onFarbe: () => onFilter({ color: game.color }),
                        onGegner: () => onFilter({ opponent: game.opponent }),
                        onEroeffnung: () => onFilter({ opening: game.opening }),
                        onEco: () => onFilter({ eco: game.eco }),
                        onErgebnis: () => onFilter({ result: game.result }),
                      }
                    : undefined
                }
                onClick={() => onWaehlen(game)}
              />
            </span>
          </div>
        );
      })}
      <MarkenSchluessel notiz={t("blatt.markNote")} offen={t("blatt.markOpen")} />
    </div>
  );

  /**
   * Die Fußzeile des Blattes · links, was auf diesem Blatt steht, rechts, wie
   * man weiterblättert.
   *
   * Beide Zahlen darin sind Griffe und keine bloße Auskunft: die Zahl je Blatt
   * ändert den Umfang, die Blattzahl springt. Das ist derselbe Weg wie in der
   * gewöhnlichen Fassung, nur im Satz des Blattes — angetippt wird die Zahl
   * selbst zum Feld, in dem sie steht, statt neben sich ein zweites zu öffnen.
   *
   * Außen die Sprünge an den Anfang und ans Ende. Wer bei einer Sammlung mit
   * hundertfünfzig Blättern zurück auf das erste will, soll nicht
   * hundertneunundvierzigmal „Zurück" drücken und auch nicht erst die Zahl
   * antippen müssen.
   */
  const blaetternGriff = (name: string, zeichen: string, aus: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={aus}
      title={name}
      aria-label={name}
      className="blatt-zahl min-h-11 text-ink2 disabled:text-ink3"
    >
      {zeichen}
    </button>
  );

  const blaettern = (
    <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-t border-line pt-2.5">
      <span className="blatt-zahl flex items-center gap-1.5 text-[11.5px] text-ink3">
        {t("games.rangeInfo", { from: deInt(von), to: deInt(bis), total: deInt(treffer) })}
        <span aria-hidden>·</span>
        {groesse !== null ? (
          <input
            autoFocus
            type="number"
            min={minProBlatt}
            max={maxProBlatt}
            value={groesse}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setGroesse(event.target.value)}
            onBlur={uebernehmeGroesse}
            onKeyDown={(event) => {
              if (event.key === "Enter") uebernehmeGroesse();
              else if (event.key === "Escape") setGroesse(null);
            }}
            aria-label={t("blatt.setPerSheet")}
            className="blatt-zahl w-10 border-b border-ink bg-transparent pb-px text-center text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setGroesse(String(proBlatt))}
            title={t("blatt.setPerSheet")}
            aria-label={t("blatt.setPerSheet")}
            className="border-b border-dotted border-line2 pb-px text-ink2 hover:border-ink hover:text-ink"
          >
            {t("blatt.perSheet", { n: proBlatt })}
          </button>
        )}
      </span>
      <span className="flex items-center gap-4 text-[12.5px]">
        {blaetternGriff(t("blatt.firstSheet"), "|←", blatt <= 1, () => onBlattWaehlen(1))}
        <button
          type="button"
          onClick={onZurueck}
          disabled={blatt <= 1}
          className="min-h-11 text-ink2 disabled:text-ink3"
        >
          ← {t("games.prev")}
        </button>
        {sprung !== null ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={blaetter}
            value={sprung}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setSprung(event.target.value)}
            onBlur={uebernehmeSprung}
            onKeyDown={(event) => {
              if (event.key === "Enter") uebernehmeSprung();
              else if (event.key === "Escape") setSprung(null);
            }}
            aria-label={t("blatt.goToSheet")}
            className="blatt-zahl w-14 border-b border-ink bg-transparent px-1.5 pb-0.5 text-center text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setSprung(String(blatt))}
            title={t("blatt.goToSheet")}
            className="blatt-zahl min-h-11 border-b border-ink px-1.5 pb-0.5 text-ink"
          >
            {t("blatt.sheetOf", { n: deInt(blatt), total: deInt(blaetter) })}
          </button>
        )}
        <button
          type="button"
          onClick={onWeiter}
          disabled={blatt >= blaetter}
          className="min-h-11 text-accent disabled:text-ink3"
        >
          {t("games.next")} →
        </button>
        {blaetternGriff(t("blatt.lastSheet"), "→|", blatt >= blaetter, () =>
          onBlattWaehlen(blaetter)
        )}
      </span>
    </div>
  );

  /**
   * Genauigkeit nach Phase · drei Felder auf Linien statt drei Kacheln.
   *
   * Sie stehen nur im Blatt des Telefons, weil sie auch in der gewöhnlichen
   * Fassung nur dort stehen. Ohne Analyse gibt es sie nicht; ohne Wert steht
   * ein Gedankenstrich, wie überall im Formular.
   */
  const phasen = gewaehlt?.analyzed && (
    <div className="mt-3.5">
      <Feldname>{t("blatt.accuracyByPhase")}</Feldname>
      <div className="mt-1.5 flex gap-4">
        {(
          [
            [t("ins.phase.opening"), gewaehlt.accuracyOpening],
            [t("ins.phase.middlegame"), gewaehlt.accuracyMiddlegame],
            [t("ins.phase.endgame"), gewaehlt.accuracyEndgame],
          ] as const
        ).map(([label, wert]) => (
          <div key={label} className="min-w-0 flex-1">
            <Feldname>{label}</Feldname>
            <div
              className={`blatt-zahl mt-1 border-b border-line2 pb-1 text-[13.5px] ${
                wert == null ? "text-ink3" : "text-ink"
              }`}
            >
              {wert == null ? "\u2014" : `${de(wert)} %`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const eintrag = gewaehlt && (
    <div className="flex flex-col">
      {!mobile && <Rubrik>{t("blatt.theEntry")}</Rubrik>}
      {/* Aus der Sicht dessen, der gespielt hat · nicht aus der von Weiß.
          Ein Diagramm ist ein Abdruck, aber es ist der Abdruck *seiner*
          Partie: Wer mit Schwarz gespielt hat, hat die Stellung von unten
          gesehen, und genau so soll er sie wiederfinden. Die gewöhnliche
          Fassung dreht das Brett längst so (siehe `orientation` in
          pages/Games.tsx) — hier stand bis eben immer Weiß unten. */}
      <div className={mobile ? "" : "mt-3.5"}>
        <Diagramm
          fen={fen}
          orientation={gewaehlt.color}
          size={mobile ? undefined : 262}
          gutter={13}
        />
        <Bildunterschrift
          nummer={unterschrift.nummer}
          zeilen={unterschrift.zeilen}
          breite={mobile ? undefined : 262}
          gutter={13}
        />
      </div>
      {/* Die Angaben sind zugleich die Griffe in die Liste: Ein Klick auf das
          Datum, die Quelle oder die Eröffnung schränkt das Verzeichnis auf
          genau diesen Wert ein · dieselbe Bewegung wie in der gewöhnlichen
          Fassung. */}
      <div className="mt-4 grid grid-cols-2 gap-x-[18px]">
        {angaben.map((angabe) => (
          <div key={angabe.label} className="border-b border-line py-[5px]">
            <Feldname>{angabe.label}</Feldname>
            {angabe.onClick ? (
              <button
                type="button"
                onClick={angabe.onClick}
                className="mt-[3px] block w-full truncate text-start text-[12.5px] text-ink hover:text-accent"
              >
                {angabe.wert}
              </button>
            ) : (
              <div className="mt-[3px] truncate text-[12.5px] text-ink">{angabe.wert}</div>
            )}
          </div>
        ))}
      </div>
      {phasen}
      {/* Stichwörter und Bemerkung gehören zusammen: Beides schreibt der Nutzer
          selbst zu dieser einen Partie, und beides steht im Band unter dem
          Diagramm und nicht in der Zeile darüber.

          Beide Felder tragen die Kennung der Partie als Schlüssel: Sie halten
          einen Entwurf, und ein halb getipptes Stichwort gehört zu der Partie,
          bei der es getippt wurde, nicht zu der, die als Nächstes drankommt. */}
      <div className="mt-3.5">
        <Feldname>{t("blatt.keywords")}</Feldname>
        <Stichwortzeile
          key={gewaehlt.id}
          woerter={stichwoerter}
          vorsatz={stichwortVorsatz}
          leer={t("blatt.noKeywords")}
          platzhalter={t("blatt.addKeyword")}
          entfernen={t("blatt.removeKeyword")}
          onSchreiben={onStichwoerter}
        />
      </div>
      <div className="mt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <Feldname>{t("blatt.remarks")}</Feldname>
          {/* Kein Knopf „Sichern" · ein Formular auf Papier hat keinen. Dass
              das Geschriebene angekommen ist, sagt dieses Wort, und es steht
              in der Zeile der Beschriftung statt als Meldung über der Seite. */}
          {gesichert && <span className="blatt-feld text-accent">{t("blatt.saved")}</span>}
        </div>
        {/* Linierter Grund · das eine Feld auf dem Blatt, in das man schreibt.
            Die Zeilenhöhe ist genau der Abstand der Linien: Auf 1,85 gesetzt
            liefe die Schrift gegen sie an, statt auf ihnen zu stehen. */}
        {onNotiz ? (
          <textarea
            key={gewaehlt.id}
            defaultValue={notiz}
            onChange={(event) => {
              bemerkung.current = event.target.value;
            }}
            onBlur={sichereBemerkung}
            placeholder={t("blatt.writeRemark")}
            aria-label={t("blatt.remarks")}
            rows={4}
            className="buch mt-1.5 block w-full resize-none border-0 bg-transparent p-0 text-[14px] text-ink2 placeholder:text-ink3 focus:outline-none"
            style={{ lineHeight: "25px", background: LINIEN }}
          />
        ) : (
          <div
            className="buch mt-1.5 pb-px text-[14px] text-ink2"
            style={{ lineHeight: "25px", background: LINIEN }}
          >
            {notiz ? `„${notiz}“` : <span className="text-ink3">{t("blatt.noRemark")}</span>}
          </div>
        )}
      </div>
      {/* Die Wege aus dem Eintrag heraus · sie stehen unter dem, was man
          geschrieben hat, und nicht oben in der Rubrik: Wer die Bemerkung
          gerade abgelegt hat, ist mit der Hand hier unten. */}
      {(onAnalyse || onOriginal) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-[18px]">
          {onAnalyse && (
            <Weg onClick={onAnalyse}>
              {analysiert ? t("games.openAnalysis") : t("games.analyze")}
            </Weg>
          )}
          {onOriginal && (
            <Weg onClick={onOriginal}>{t("blatt.originalAt", { p: gewaehlt.source })}</Weg>
          )}
        </div>
      )}
    </div>
  );

  /**
   * Der aufgeschlagene Import · derselbe Abschnitt in beiden Fassungen.
   *
   * `.blatt-formular` setzt die gewöhnlichen Bedienteile in den Satz des
   * Blattes um (eckige Felder, Linien statt Flächen) — dieselbe Regel, mit der
   * die Einstellungen im Modus auskommen, ohne sich zu verdoppeln.
   */
  const einfuhrBereich = einfuhr?.offen && (
    <div className="blatt-formular mt-4 border-t border-ink pt-3">
      <Rubrik>{t("games.importPanelTitle")}</Rubrik>
      {einfuhr.meldung && <div className="mt-2 text-[12px] text-ink2">{einfuhr.meldung}</div>}
      <div className="mt-3">{einfuhr.inhalt}</div>
    </div>
  );

  // Die Leiste unter dem Blatt · 44 px je Griff, die Stelle dazwischen.
  const blaetternImBlatt = eintragBlatt && (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={eintragBlatt.onZurueck}
        disabled={!eintragBlatt.onZurueck}
        className="flex min-h-11 items-center gap-1 px-2.5 text-[12.5px] text-ink2 disabled:text-ink3"
      >
        <ChevronLeft size={16} /> {t("games.prev")}
      </button>
      <span className="blatt-zahl shrink-0 text-[11.5px] text-ink3">
{`${deInt(eintragBlatt.stelle)} / ${deInt(eintragBlatt.gesamt)}`}
      </span>
      <button
        type="button"
        onClick={eintragBlatt.onWeiter}
        disabled={!eintragBlatt.onWeiter}
        className="flex min-h-11 items-center gap-1 px-2.5 text-[12.5px] text-accent disabled:text-ink3"
      >
        {t("games.next")} <ChevronRight size={16} />
      </button>
    </div>
  );

  const partieBlatt = eintragBlatt?.offen && gewaehlt && (
    <MobileSheet
      blatt
      testId="game-detail-sheet"
      ariaLabel={t("games.detailTitle")}
      scrollKey={gewaehlt.id}
      onClose={eintragBlatt.onSchliessen}
      onPrev={eintragBlatt.onZurueck}
      onNext={eintragBlatt.onWeiter}
      title={
        <div className="flex items-center gap-2">
          <Punkt ergebnis={gewaehlt.result} />
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
            {gewaehlt.opponent}{" "}
            <span className="blatt-zahl text-ink3">({deInt(gewaehlt.oppElo)})</span>
          </span>
        </div>
      }
      subtitle={
        <div className="blatt-kolumne mt-1.5 truncate text-ink3">
          {gewaehlt.source} · {gewaehlt.tc} · {gewaehlt.date}
        </div>
      }
      headerRight={
        <div>
          <Feldname>{t("games.colAccuracy")}</Feldname>
          <div className="blatt-zahl mt-0.5 text-[14px] text-ink">
            {gewaehlt.accuracy == null ? "\u2014" : `${de(gewaehlt.accuracy)} %`}
          </div>
        </div>
      }
      footer={blaetternImBlatt}
    >
      <div className="px-3.5 pb-4 pt-3">{eintrag}</div>
    </MobileSheet>
  );

  const kopf = (
    <Kolumnentitel
      links={t("blatt.gamesTitle")}
      rechts={bestand != null ? t("app.dbCount", { n: deInt(bestand) }) : undefined}
    />
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3">{leiste}</div>
        {/* Aufgeschlagen stehen die übrigen Felder unter der Leiste, in
            denselben zwei Spalten wie ein Formularkopf. */}
        {filterOffen && weitereFelder.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2">
            {weitereFelder.map((feld) => (
              <div key={feld.label} className="min-w-[126px] flex-1">
                {feldSatz({ ...feld, breite: undefined })}
              </div>
            ))}
          </div>
        )}
        {einfuhrBereich}
        <div className="mt-4">
          <Rubrik>{t("games.rangeInfo", { from: deInt(von), to: deInt(bis), total: deInt(treffer) })}</Rubrik>
          {liste}
        </div>
        {blaettern}
        {partieBlatt}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      {einfuhrBereich}
      <div className="mt-4 flex items-end gap-4">
        {filterfelder}
        {/* Der Import steht am Rechner neben den Filtern und nicht in einer
            Leiste · dort ist die Zeile breit genug für beides. */}
        {einfuhr &&
          leistenGriff(
            t("games.manageImports"),
            einfuhr.offen,
            <Download size={17} />,
            einfuhr.onUmschalten
          )}
        <div className="w-24 flex-none border-s border-line ps-4">
          <Feldname>{t("blatt.hits")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten>{deInt(treffer)}</Ergebniskasten>
          </div>
        </div>
      </div>

      {/* Zwei Spalten sind eine aufgeschlagene Doppelseite, und die braucht
          ihre Breite: Register und Eintrag zusammen wollen gut 1.200 Punkte.
          Darunter — das Fenster darf bis auf 1.000 herunter — steht der
          Eintrag unter dem Register statt neben ihm. Nebeneinander gezwungen
          liefen die Spalten der Zeile in den Eintrag hinein, weil die festen
          Breiten der Zahlenspalten nicht schmaler werden können; genau das war
          zu sehen. Eine Seite, die nicht für eine Doppelseite reicht, wird
          eine einfache. */}
      <div className="flex min-h-0 flex-1 flex-col gap-7 pt-[22px] min-[1220px]:flex-row min-[1220px]:gap-9">
        <div className="flex min-w-0 flex-1 flex-col">
          {liste}
          <div className="flex-1" />
          {blaettern}
        </div>
        <div className="w-full max-w-[304px] flex-none border-t border-line pt-4 min-[1220px]:w-[304px] min-[1220px]:border-t-0 min-[1220px]:pt-0">
          {eintrag}
        </div>
      </div>
    </div>
  );
}
