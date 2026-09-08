/**
 * Analyse im Diagramm-Modus · die kommentierte Partie.
 *
 * Hier zahlt sich der Modus am deutlichsten aus. Die Zugliste von heute ist
 * eine umbrechende Reihe von Schaltflächen; im Turnierbuch ist eine
 * kommentierte Partie Fließsatz, und die Anmerkungen stehen eingerückt
 * zwischen den Zügen, wo sie hingehören.
 *
 * Gedruckt oder gespielt: Das Brett der Analyse ist kein Abdruck, sondern ein
 * Instrument, an dem man zieht — es trägt die Brettfarben des Themas, wie
 * heute. Deshalb kommt es als fertiges Stück von der Seite herein: Zug,
 * Hervorhebung, Drehung und Klänge hängen dort, und ein zweites Brett wäre
 * eine zweite Bedienung derselben Sache.
 *
 * Alle Anmerkungen bleiben stehen, auch bei langen Partien. Die
 * Auto-Annotation vergibt nur für Ungenauigkeit, Fehler und Patzer einen
 * Kommentar; das sind wenige, und eine Partie, in der es viele sind, ist genau
 * die, bei der man sie alle sehen will.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { translateSan } from "../../lib/notation";
import { de, deInt } from "../../lib/format";
import "../../components/blatt/blatt.css";

/** Ein Zug, wie ihn der Fließsatz braucht. */
export interface SatzZug {
  san: string;
  /** Kürzel der Bewertung ("?!", "?", "??", "!!") · leer heißt: unauffällig. */
  nag?: string;
  /** Farbe des Kürzels · schon als Token, nicht als Wert. */
  farbe?: string;
  /** Die Anmerkung zu diesem Zug, falls die Analyse eine hat. */
  kommentar?: string | null;
}

export interface BilanzZeile {
  name: string;
  zahl: number;
  farbe: string;
}

/** Eine Seite des Bretts · der Kopf über bzw. unter der Spielfläche. */
export interface Brettseite {
  name: string;
  elo: number;
  farbe: "white" | "black";
  /**
   * Die Figuren, die diese Seite geschlagen hat, samt Materialvorsprung.
   *
   * Fertig gesetzt von der Seite · dieselbe Zeile wie in der gewöhnlichen
   * Fassung, nur im Satz des Blattes. Fehlt sie, steht unter dem Namen nichts
   * — am freien Brett und in gestellten Aufgaben gibt es keine Schlagliste.
   */
  geschlagen?: ReactNode;
}

export interface AnalysisBlattProps {
  mobile: boolean;
  /**
   * Das freie Brett · keine Partie, also auch kein Formularkopf.
   *
   * Ein leerer Turnierzettel wäre gelogen: Es gibt keine Namen, keine
   * Eröffnung und kein Ergebnis einzutragen. Stattdessen führt die Seite,
   * was sie hat — die Züge, die auf dem Brett entstehen, und die Linien der
   * Engine.
   */
  frei: boolean;
  /**
   * Die Laufleiste der Seite · Partiewahl, Blättern, Rechnen lassen.
   *
   * Sie kommt fertig von der Seite, wie das Brett: Der Modus setzt sie neu
   * (`blatt-formular`), baut sie aber nicht ein zweites Mal.
   */
  laufleiste?: ReactNode;
  /** Meldung eines Laufs, falls eine ansteht. */
  meldung?: ReactNode;
  /** Die Engine · nur am freien Brett, wo sie die rechte Spalte trägt. */
  motor?: ReactNode;
  /** Züge aus einer geteilten Stellung · sie stehen vor den eigenen. */
  vorlauf?: string | null;
  /** Kopfzeile rechts · Partienummer und Engine, von der Seite gesetzt. */
  kopfRechts: ReactNode;
  felder: Feld[];
  ergebnis: string;
  /** Namen über und unter dem Brett · oben der Gegner, unten die eigene Farbe. */
  oben: Brettseite;
  unten: Brettseite;
  /**
   * Brett und Bewertungsbalken · ein Instrument, kein Abdruck (siehe oben).
   *
   * Sie kommen als fertiges Stück von der Seite: Der Balken nimmt dort schon
   * die Feldfarben des Bretts und dreht sich mit ihm, und ein zweiter Aufbau
   * hier wäre dieselbe Bedienung ein zweites Mal.
   */
  brett: ReactNode;
  zuege: SatzZug[];
  /** Der gezeigte Halbzug · die Marke in der Kurve und im Satz. */
  ply: number;
  onPly: (ply: number) => void;
  /** Bewertung je Halbzug in Bauerneinheiten · so lang wie analysiert wurde. */
  kurve: number[];
  /** Bewertung an der gezeigten Stellung, in Bauerneinheiten. */
  bewertung: number;
  bilanz: BilanzZeile[];
  acpl: { white: number; black: number };
  genauigkeit: number | null;
}

/**
 * Die Bewertungskurve als Haarlinienzeichnung.
 *
 * Kein Diagrammwerkzeug: eine Linie, eine Nulllinie, eine gestrichelte Marke
 * am gezeigten Halbzug. Alles über Tokens.
 *
 * Und sie ist ein Griff, keine Abbildung: Wer auf einen Ausschlag zeigt, will
 * die Stellung sehen, in der er entstanden ist. Ein Klick setzt den Halbzug,
 * Ziehen fährt die Partie ab — dieselbe Bewegung wie in der gewöhnlichen
 * Fassung, wo das Diagramm dasselbe tut.
 *
 * Der Griff sitzt auf der Hülle, nicht auf dem `svg`: Die Zeichnung bleibt für
 * eine Vorlesehilfe stumm, die Hülle trägt Rolle, Wert und Tastatur. Damit ist
 * die Kurve auch ohne Zeigegerät zu bedienen, und das ist sie in der
 * gewöhnlichen Fassung bis heute nicht.
 */
function Kurve({
  werte,
  ply,
  onPly,
  hoehe = 76,
}: {
  werte: number[];
  ply: number;
  onPly: (ply: number) => void;
  hoehe?: number;
}) {
  const { t } = useI18n();
  if (werte.length < 2) return null;
  const breite = 470;
  const max = 6;
  const x = (i: number) => (i / (werte.length - 1)) * breite;
  const y = (cp: number) => hoehe / 2 - (Math.max(-max, Math.min(max, cp)) / max) * (hoehe / 2 - 3);
  const punkte = werte.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(" ");
  const flaeche = `${x(0)},${hoehe / 2} ${punkte} ${x(werte.length - 1)},${hoehe / 2}`;
  const cx = x(Math.max(0, Math.min(werte.length - 1, ply - 1)));

  /**
   * Vom Zeigepunkt auf den Halbzug.
   *
   * Gemessen wird am Kasten der Hülle, nicht an der viewBox: Die Zeichnung
   * skaliert auf die Spaltenbreite, und der Punkt kommt in Bildschirmpunkten.
   * Der erste Wert der Reihe ist Halbzug 1, deshalb der Versatz.
   */
  const zumPunkt = (clientX: number, ziel: Element) => {
    const kasten = ziel.getBoundingClientRect();
    if (kasten.width === 0) return;
    const anteil = (clientX - kasten.left) / kasten.width;
    const index = Math.round(Math.max(0, Math.min(1, anteil)) * (werte.length - 1));
    onPly(index + 1);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("an.evalChart")}
      aria-valuemin={0}
      aria-valuemax={werte.length}
      aria-valuenow={Math.max(0, Math.min(werte.length, ply))}
      // `touch-pan-y` und nicht `touch-none`: Waagerecht fährt der Finger die
      // Partie ab, senkrecht scrollt die Seite weiter. Ganz abgeschaltet wäre
      // die Kurve auf dem Telefon eine Sperre quer über dem Blatt.
      className="cursor-pointer touch-pan-y"
      onPointerDown={(event) => {
        // Zeigen und ziehen in einem: Der Zeiger wird eingefangen, damit das
        // Fahren nicht abreißt, sobald er die Kurve nach oben verlässt.
        event.currentTarget.setPointerCapture(event.pointerId);
        zumPunkt(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          zumPunkt(event.clientX, event.currentTarget);
        }
      }}
      onKeyDown={(event) => {
        // Die Kurve läuft in jeder Sprache von links nach rechts · die Pfeile
        // meinen deshalb den Halbzug und nicht die Leserichtung.
        const schritt =
          event.key === "ArrowLeft" || event.key === "ArrowDown"
            ? -1
            : event.key === "ArrowRight" || event.key === "ArrowUp"
              ? 1
              : 0;
        if (schritt !== 0) {
          event.preventDefault();
          onPly(Math.max(0, Math.min(werte.length, ply + schritt)));
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          onPly(0);
        } else if (event.key === "End") {
          event.preventDefault();
          onPly(werte.length);
        }
      }}
    >
      <svg
        viewBox={`0 0 ${breite} ${hoehe}`}
        width="100%"
        height={hoehe}
        className="block overflow-visible"
        aria-hidden="true"
      >
        <polygon points={flaeche} fill="var(--color-win)" opacity="0.13" />
        <line x1="0" y1={hoehe / 2} x2={breite} y2={hoehe / 2} stroke="var(--color-line2)" strokeWidth="1" />
        <polyline points={punkte} fill="none" stroke="var(--color-ink)" strokeWidth="1.25" strokeLinejoin="round" />
        <line x1={cx} y1="0" x2={cx} y2={hoehe} stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    </div>
  );
}

export default function AnalysisBlatt({
  mobile,
  frei,
  laufleiste,
  meldung,
  motor,
  vorlauf,
  kopfRechts,
  felder,
  ergebnis,
  oben,
  unten,
  brett,
  zuege,
  ply,
  onPly,
  kurve,
  bewertung,
  bilanz,
  acpl,
  genauigkeit,
}: AnalysisBlattProps) {
  const { t, locale } = useI18n();

  /**
   * Der Fließsatz der Partie.
   *
   * Züge laufen durch, bis einer eine Anmerkung trägt; dann bricht der Satz,
   * die Anmerkung steht eingerückt darunter, und der nächste Satz beginnt.
   * Genau so steht eine kommentierte Partie im Turnierbuch.
   */
  const abschnitte: { zuege: { zug: SatzZug; index: number }[]; anmerkung: { zug: SatzZug; index: number } | null }[] =
    [];
  let laufend: { zug: SatzZug; index: number }[] = [];
  zuege.forEach((zug, index) => {
    laufend.push({ zug, index });
    if (zug.kommentar) {
      abschnitte.push({ zuege: laufend, anmerkung: { zug, index } });
      laufend = [];
    }
  });
  if (laufend.length > 0) abschnitte.push({ zuege: laufend, anmerkung: null });

  const zugLabel = (zug: SatzZug, index: number) =>
    `${index % 2 === 0 ? `${index / 2 + 1}.` : ""}${translateSan(zug.san, locale)}`;

  const satz = (stuecke: { zug: SatzZug; index: number }[]) => (
    <div className="buch notation text-[15px] leading-[1.6] text-ink" style={{ fontVariantNumeric: "lining-nums" }}>
      {stuecke.map(({ zug, index }) => (
        <button
          key={index}
          type="button"
          onClick={() => onPly(index + 1)}
          className={`me-1.5 ${
            ply === index + 1 ? "bg-panel3 font-semibold text-ink" : "hover:text-accent"
          }`}
        >
          {zugLabel(zug, index)}
          {zug.nag && <span style={{ color: zug.farbe }}>{zug.nag}</span>}
        </button>
      ))}
    </div>
  );

  const partietext = (
    <div>
      <Rubrik>{frei ? t("an.freeBoard") : t("blatt.theGame")}</Rubrik>
      {/* Die Züge aus einem geteilten Link stehen vor den eigenen und sind
          nicht anklickbar · die Stellungen davor reisen nicht mit, nur ihre
          Notation. Dieselbe Regel wie in der gewöhnlichen Fassung. */}
      {vorlauf && (
        <div className="buch notation mt-3 border-b border-line pb-2 text-[13px] leading-[1.6] text-ink3">
          {vorlauf}
        </div>
      )}
      {frei && zuege.length === 0 && (
        <div className="mt-3 text-[12.5px] leading-[1.6] text-ink3">{t("blatt.freeBoardHint")}</div>
      )}
      {abschnitte.map((abschnitt, i) => (
        <div key={i} className={i === 0 ? "mt-3" : "mt-2.5"}>
          {satz(abschnitt.zuege)}
          {abschnitt.anmerkung && (
            <div
              className="mt-[7px] border-s-2 ps-[18px]"
              style={{ borderColor: abschnitt.anmerkung.zug.farbe ?? "var(--color-line2)" }}
            >
              <span
                className="buch notation text-[13px] font-semibold"
                style={{ color: abschnitt.anmerkung.zug.farbe }}
              >
                {zugLabel(abschnitt.anmerkung.zug, abschnitt.anmerkung.index)}
                {abschnitt.anmerkung.zug.nag}
              </span>{" "}
              <span className="buch text-[13.5px] leading-[1.55] text-ink2">
                {abschnitt.anmerkung.zug.kommentar}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const auswertung = (
    <div>
      <Rubrik>{t("an.autoAnnotation")}</Rubrik>
      <div className="mt-2 grid grid-cols-2 gap-x-[26px]">
        {bilanz.map((zeile) => (
          <div key={zeile.name} className="flex items-baseline gap-2 border-b border-line py-[5px]">
            <span
              aria-hidden
              className="inline-block h-2 w-2 flex-none"
              style={{ background: zeile.farbe }}
            />
            <span className="flex-1 truncate text-[12.5px] text-ink2">{zeile.name}</span>
            <span className="blatt-zahl text-[13.5px] text-ink">{deInt(zeile.zahl)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-[22px] gap-y-1 text-[11.5px] text-ink3">
        <span>
          {t("an.acpl")}: <span className="blatt-zahl text-ink2">{t("common.white")} {deInt(acpl.white)}</span>
          {" · "}
          <span className="blatt-zahl text-ink2">{t("common.black")} {deInt(acpl.black)}</span>
        </span>
        {genauigkeit != null && (
          <span>
            {t("games.colAccuracy")} <span className="blatt-zahl text-ink2">{de(genauigkeit)} %</span>
          </span>
        )}
      </div>
    </div>
  );

  /**
   * Der Kopf einer Brettseite · Farbfeld, Name, Wertung — und darunter, was
   * diese Seite geschlagen hat.
   *
   * Die Schlagliste steht unter dem Namen und nicht neben ihm: Sie wächst im
   * Lauf der Partie, und eine Zeile, die nach rechts wächst, schöbe irgendwann
   * die Wertung aus dem Satz. Gerechnet wird sie nicht hier · sie kommt wie das
   * Brett fertig von der Seite, aus derselben Stellung.
   */
  const spieler = (seite: Brettseite, unten_: boolean) => (
    <div className={`flex items-start gap-[9px] ${unten_ ? "pt-[9px]" : "pb-[9px]"}`}>
      {/* Das Kästchen sitzt auf der Grundlinie des Namens, nicht in der Mitte
          eines zweizeiligen Blocks. */}
      <span className="mt-[4px] flex-none">
        <Farbfeld farbe={seite.farbe} kante={11} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-[9px]">
          <span className="min-w-0 truncate text-[14px] text-ink">{seite.name}</span>
          {seite.elo > 0 && <span className="blatt-zahl text-[12px] text-ink3">{seite.elo}</span>}
        </span>
        {seite.geschlagen}
      </span>
    </div>
  );

  const steuerung = (
    <div className="mt-3 flex items-center border-y border-line">
      {[
        { icon: SkipBack, label: t("an.toStart"), to: 0 },
        { icon: ChevronLeft, label: t("an.prevMove"), to: Math.max(0, ply - 1) },
        { icon: ChevronRight, label: t("an.nextMove"), to: Math.min(zuege.length, ply + 1) },
        { icon: SkipForward, label: t("an.toEnd"), to: zuege.length },
      ].map(({ icon: Icon, label, to }, index) => (
        <button
          key={label}
          type="button"
          onClick={() => onPly(to)}
          aria-label={label}
          className={`flex h-11 flex-1 items-center justify-center text-ink2 hover:text-ink ${
            index ? "border-s border-line" : ""
          }`}
        >
          <Icon size={16} />
        </button>
      ))}
      <span className="blatt-zahl flex h-11 flex-[2] items-center justify-center border-s border-line text-[12.5px] text-ink3">
        {t("blatt.plyOf", { n: deInt(ply), total: deInt(zuege.length) })}
      </span>
    </div>
  );

  // Die Spalte ist so breit wie in der gewöhnlichen Fassung: `--board-col` ist
  // Brett plus Bewertungsbalken, und beide kommen hier als ein Stück herein.
  // Ein eigenes, kleineres Maß hätte den Modus zu einer Ansicht gemacht, in
  // der man schlechter sieht — und ausgerechnet das Brett ist das, wofür man
  // die Analyse öffnet.
  const brettSpalte = (
    <div className={mobile ? "flex flex-col" : "flex w-[var(--board-col)] max-w-full flex-none flex-col"}>
      {spieler(oben, false)}
      {brett}
      {spieler(unten, true)}
      {steuerung}
      {kurve.length > 1 && (
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between">
            <Feldname>{t("blatt.evalCurve")}</Feldname>
            <span
              className="blatt-zahl text-[13px] font-medium"
              style={{ color: bewertung >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
            >
              {bewertung >= 0 ? "+" : "−"}
              {de(Math.abs(bewertung))}
            </span>
          </div>
          <div className="mt-[7px] border-y border-line py-1.5">
            <Kurve werte={kurve} ply={ply} onPly={onPly} hoehe={mobile ? 56 : 76} />
          </div>
          <div className="mt-1 flex justify-between text-[9.5px] text-ink3">
            <span className="blatt-feld">{t("ins.phase.opening")}</span>
            <span className="blatt-feld">{t("ins.phase.middlegame")}</span>
            <span className="blatt-zahl">{t("blatt.halfMoves", { n: deInt(zuege.length) })}</span>
          </div>
        </div>
      )}
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("blatt.analysisTitle")} rechts={kopfRechts} />
      {/* Erst die Wahl, dann der Zettel: Die Laufleiste sagt, welche Partie
          aufgeschlagen ist, der Formularkopf darunter, was in ihr steht. */}
      {laufleiste && <div className="mt-3.5">{laufleiste}</div>}
      {meldung}
      {!frei && (
        <div className="mt-4 flex items-end">
          <div className="min-w-0 flex-1">
            <Formularkopf
              felder={mobile ? felder.slice(0, 2) : felder}
              spalten={mobile ? "1fr 1fr" : "0.95fr 1.3fr 1.35fr 1.4fr"}
            />
          </div>
          <div
            className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-24 ps-3.5"}`}
          >
            <Feldname>{t("blatt.result")}</Feldname>
            <div className="mt-1.5">
              <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
                {ergebnis}
              </Ergebniskasten>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Was rechts neben dem Brett steht. Mit Partie ist es die Bilanz der
  // Auto-Annotation; am freien Brett gibt es keine, dafür rechnet die Engine
  // mit — ihre Linien sind hier das, was auf einer Buchseite die Varianten
  // sind.
  const neben = frei ? motor : auswertung;

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3.5">{brettSpalte}</div>
        <div className="mt-4">{partietext}</div>
        {neben && <div className="mt-4">{neben}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        {/* Mit Partie stehen Text und Bilanz an den beiden Enden der Spalte,
            wie Satz und Fußnote auf einer Buchseite. Am freien Brett wächst
            der Zugtext von oben nach; dann rückt die Engine dicht darunter
            und nicht an den Fuß einer leeren Spalte. */}
        <div
          className={`flex min-w-0 flex-1 flex-col gap-6 ${frei ? "" : "justify-between"}`}
        >
          {partietext}
          {neben}
        </div>
      </div>
    </div>
  );
}
