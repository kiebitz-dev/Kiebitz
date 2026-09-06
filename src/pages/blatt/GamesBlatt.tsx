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
 * zuletzt die Stichwörter und die Notiz auf liniertem Grund.
 *
 * Geschrieben wird auf diesem Blatt nichts: Der Eintrag ist eine Seite zum
 * Lesen, und die Angaben sind Griffe zurück in die Liste — ein Klick auf
 * Quelle, Datum, Gegner oder Eröffnung schränkt das Verzeichnis auf genau
 * diesen Wert ein. Der Tag-Editor bleibt in der gewöhnlichen Fassung. In der
 * Liste stehen Stichwörter und Notiz ohnehin nicht · dort ersetzen die zwei
 * Marken am Zeilenende die Tag-Spalte, und ein Register bleibt nur lesbar,
 * solange in seinen Zeilen nichts steht, was zur nächsten nicht passt.
 */
import type { ReactNode } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import { MarkenSchluessel, PartieZeile } from "../../components/blatt/PartieZeile";
import {
  Ergebniskasten,
  Feldname,
  Kolumnentitel,
  Rubrik,
  Stichwortzeile,
  Weg,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import type { GamesFilter, UiGame } from "../../lib/gameUi";

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
   * Auf diesem Blatt stehen sie zum Lesen: Geschrieben werden sie in der
   * gewöhnlichen Fassung, wo der Tag-Editor steht.
   */
  stichwoerter: string[];
  /** Wort, das die App selbst vergibt · steht mit wie ein eigenes. */
  stichwortVorsatz?: string;
  notiz: string;
  von: number;
  bis: number;
  blatt: number;
  blaetter: number;
  onZurueck: () => void;
  onWeiter: () => void;
  onWaehlen: (game: UiGame) => void;
  onAnalyse: () => void;
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
}

export default function GamesBlatt({
  mobile,
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
  notiz,
  von,
  bis,
  blatt,
  blaetter,
  onZurueck,
  onWeiter,
  onWaehlen,
  onAnalyse,
  onOriginal,
  einfuhr,
  filterOffen = false,
  onFilterUmschalten,
  onFilter,
}: GamesBlattProps) {
  const { t } = useI18n();

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
        <span className="blatt-feld w-[168px] flex-none text-ink3">{t("games.colOpponent")}</span>
        <span className="blatt-feld min-w-0 flex-1 text-ink3">{t("games.colOpening")}</span>
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
          <div key={game.id} className="relative flex items-center gap-[9px]">
            {/* Die Marke des laufenden Eintrags steht am Bund, also vor der
                Nummer und nicht zwischen Nummer und Datum · sie zeigt auf die
                ganze Zeile, nicht auf eine ihrer Spalten. Mobil gibt es keine
                Nummernspalte; dort setzt die Zeile sie selbst. */}
            {!mobile && aktiv && (
              <span aria-hidden className="absolute inset-y-1.5 -start-3.5 w-[3px] bg-ink" />
            )}
            {!mobile && (
              <span className="blatt-zahl w-8 flex-none text-[11px] text-ink3">{nummer ?? ""}</span>
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

  const blaettern = (
    <div className="mt-3.5 flex items-center justify-between border-t border-line pt-2.5">
      <span className="blatt-zahl text-[11.5px] text-ink3">
        {t("games.rangeInfo", { from: deInt(von), to: deInt(bis), total: deInt(treffer) })}
      </span>
      <span className="flex items-center gap-4 text-[12.5px]">
        <button
          type="button"
          onClick={onZurueck}
          disabled={blatt <= 1}
          className="min-h-11 text-ink2 disabled:text-ink3"
        >
          ← {t("games.prev")}
        </button>
        <span className="blatt-zahl border-b border-ink px-1.5 pb-0.5 text-ink">
          {t("blatt.sheetOf", { n: deInt(blatt), total: deInt(blaetter) })}
        </span>
        <button
          type="button"
          onClick={onWeiter}
          disabled={blatt >= blaetter}
          className="min-h-11 text-accent disabled:text-ink3"
        >
          {t("games.next")} →
        </button>
      </span>
    </div>
  );

  const eintrag = gewaehlt && (
    <div className="flex flex-col">
      <Rubrik weg={t("games.openAnalysis")} onWeg={onAnalyse}>
        {t("blatt.theEntry")}
      </Rubrik>
      <div className="mt-3.5">
        <Diagramm fen={fen} size={mobile ? undefined : 262} gutter={13} />
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
      {/* Stichwörter und Bemerkung gehören zusammen: Beides schreibt der Nutzer
          selbst zu dieser einen Partie, und beides steht im Band unter dem
          Diagramm und nicht in der Zeile darüber. */}
      <div className="mt-3.5">
        <Feldname>{t("games.colTags")}</Feldname>
        <Stichwortzeile
          woerter={stichwoerter}
          vorsatz={stichwortVorsatz}
          leer={t("games.noTags")}
        />
      </div>
      <div className="mt-3.5">
        <Feldname>{t("games.notes")}</Feldname>
        {/* Linierter Grund · das eine Feld auf dem Blatt, in das man schreibt.
            Die Linien kommen aus dem Token, nicht aus einer Farbe. */}
        <div
          className="buch mt-1.5 pb-px text-[14px] leading-[1.85] text-ink2"
          style={{
            background:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 24px, var(--color-line) 24px, var(--color-line) 25px)",
          }}
        >
          {notiz ? `„${notiz}“` : <span className="text-ink3">{t("blatt.noRemark")}</span>}
        </div>
      </div>
      {onOriginal && gewaehlt && (
        <div className="mt-3 flex gap-[18px]">
          <Weg onClick={onOriginal}>{t("blatt.originalAt", { p: gewaehlt.source })}</Weg>
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

      <div className="flex min-h-0 flex-1 gap-9 pt-[22px]">
        <div className="flex min-w-0 flex-1 flex-col">
          {liste}
          <div className="flex-1" />
          {blaettern}
        </div>
        <div className="w-[304px] flex-none">{eintrag}</div>
      </div>
    </div>
  );
}
