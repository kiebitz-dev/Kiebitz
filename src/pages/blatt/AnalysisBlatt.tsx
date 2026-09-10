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
 *
 * Neben dem Satz steht der Apparat: das Eröffnungsbuch und die eigenen
 * Partien, die durch diese Stellung gingen. Beides gibt es in der
 * gewöhnlichen Fassung als Karte, und beides ist am freien Brett das, was den
 * Tab überhaupt brauchbar macht — ein Modus, der eine Funktion kostet, ist
 * kein Modus. Gerechnet wird hier nichts: Die Zahlen kommen fertig von der
 * Seite, dieselben wie dort, nur anders gesetzt (siehe docs/design.md).
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward, Sparkles } from "lucide-react";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Fussnote,
  Kolumnentitel,
  Punkt,
  Rubrik,
  type Feld,
} from "../../components/blatt/Satz";
// Die Sperre wird im Modus nicht neu gebaut, sondern neu gesetzt · dieselbe
// Regel wie beim Einstellungsformular, siehe `.blatt-formular` in blatt.css.
import { PlusLock } from "../../components/PlusLock";
import type { PlusFeature } from "../../lib/plus/types";
import { useI18n } from "../../lib/i18n";
import { translateSan } from "../../lib/notation";
import { de, deInt, deShort } from "../../lib/format";
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
  /**
   * Der Satz der Analyse zu diesem Zug · was passiert ist, nicht was es
   * gekostet hat. Gebaut in `lib/erklaerung.ts`, siehe docs/EXPLANATIONS.md.
   */
  erklaerung?: string | null;
  /** Die Zeile darunter: woher der Preis kommt. */
  grund?: string | null;
  /**
   * Was der Zug gekostet hat, in Zentibauern.
   *
   * Nicht zum Anzeigen · daran hängt allein die Auswahl, welche Erklärungen
   * „die wichtigsten" sind, wenn kein Zug angeklickt ist.
   */
  gewicht?: number | null;
}

/** Ein Zug im Eröffnungsbuch · dieselben Zahlen wie in der Karte von heute. */
export interface BuchZug {
  san: string;
  weiss: number;
  remis: number;
  schwarz: number;
  /** Schnitt-Elo der Partien · fehlt, wo die Quelle keines führt. */
  elo: number | null;
}

/** Eine Musterpartie unter den Zügen · eine Zeile aus dem Turnierbuch. */
export interface BuchPartie {
  id: string;
  /** Die Paarung, fertig gesetzt · „Carlsen 2882 – Caruana 2820". */
  paarung: string;
  jahr: string;
  /** „1–0", „0–1", „½–½" · das Ergebnis dieser Partie, nicht das eigene. */
  ergebnis: string;
  onOeffnen: () => void;
}

/**
 * Ein Zug aus ChessDB.
 *
 * Die vierte Quelle beantwortet eine andere Frage als die drei anderen: nicht
 * „was wird hier gespielt?", sondern „was hält eine Engine davon?". Deshalb
 * trägt sie eine Bewertung und keine Bilanz.
 */
export interface MotorZug {
  san: string;
  /** In Bauerneinheiten, aus Sicht der Seite am Zug. */
  bewertung: number | null;
  /** Gewinnquote, wie die Quelle sie schreibt. */
  quote: string | null;
}

/** Was eine Häufigkeits-Quelle zur Stellung zu sagen hat. */
export interface BuchStand {
  partien: number;
  eroeffnung: string | null;
  zuege: BuchZug[];
  musterpartien: BuchPartie[];
  ausCache: boolean;
}

export interface BuchProps {
  reiter: { id: string; name: string; plus: boolean }[];
  quelle: string;
  onQuelle: (id: string) => void;
  /** Ein Satz statt einer Tabelle · warum hier gerade nichts steht. */
  hinweis?: string;
  /** Häufigkeiten · Meister, Online, eigene Datenbank. */
  stand?: BuchStand;
  /** ChessDB · steht anstelle der Häufigkeiten. */
  motor?: { zuege: MotorZug[]; ausCache: boolean };
  /** Gesperrt · `stand` ist dann die Vorschau, über der die Sperre liegt. */
  sperre?: PlusFeature;
  onZug: (san: string) => void;
}

/** Ein Fortsetzungszug aus den eigenen Partien. */
export interface StellungZug {
  san: string;
  partien: number;
  /** Punktequote in Prozent, aus eigener Sicht. */
  quote: number;
}

/** Eine eigene Partie, die durch diese Stellung gegangen ist. */
export interface StellungTreffer {
  id: number;
  ply: number;
  datum: string;
  gegner: string;
  /** „win" · „draw" · „loss", aus eigener Sicht. */
  ergebnis: string;
  onOeffnen: () => void;
}

export interface StellungenProps {
  gesamt: number;
  zuege: StellungZug[];
  treffer: StellungTreffer[];
  onZug: (san: string) => void;
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
  /**
   * Die Nebengriffe zum Brett · Drehen, Teilen, Fokus, neues Brett.
   *
   * Sie kommen wie das Brett fertig von der Seite (`boardExtras` in
   * pages/Analysis.tsx) und stehen hier am Ende der Tastenreihe unter dem
   * Brett, hinter der Zählung. Der Modus setzt sie neu — `blatt-formular`
   * nimmt Rundungen und Flächen zurück (siehe blatt.css) —, er baut sie aber
   * nicht ein zweites Mal.
   *
   * Ohne sie war das Blatt die Fassung, in der man das Brett nicht drehen und
   * die Stellung nicht teilen kann. Ein Modus, der Bedienung kostet, ist kein
   * Modus, sondern ein Nachteil.
   */
  griffe?: ReactNode;
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
  /**
   * Der Apparat neben dem Satz · Eröffnungsbuch und eigene Partien.
   *
   * Beides steht nur da, wo es etwas zu holen gibt (auf dem Desktop); im Web
   * fehlt die Datenbank, und eine leere Rubrik ist kein Abschnitt.
   */
  buch?: BuchProps;
  stellungen?: StellungenProps;
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
  griffe,
  zuege,
  ply,
  onPly,
  kurve,
  bewertung,
  bilanz,
  acpl,
  genauigkeit,
  buch,
  stellungen,
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

  /**
   * Aus der Analyse · was zu einem Zug gefunden wurde, nicht was er kostete.
   *
   * Zwei Fälle, ein Abschnitt. Steht man auf einem Zug, zu dem die Analyse
   * etwas gefunden hat, dann steht dessen Satz hier — ein Klick im Fließsatz
   * ist damit zugleich die Frage „was war hier los?". Steht man irgendwo
   * sonst, führt der Abschnitt die schwersten Stellen der Partie und bleibt
   * ein Weg dorthin: Jede Zeile schlägt ihren Zug auf.
   *
   * Höchstens drei · alle wären die Auto-Annotation ein zweites Mal, und die
   * steht schon eingerückt im Satz darüber.
   */
  const zumZug = ply > 0 && zuege[ply - 1]?.erklaerung ? { zug: zuege[ply - 1], index: ply - 1 } : null;
  const wichtigste = zuege
    .map((zug, index) => ({ zug, index }))
    .filter(({ zug }) => zug.erklaerung && (zug.gewicht ?? 0) > 0)
    .sort((a, b) => (b.zug.gewicht ?? 0) - (a.zug.gewicht ?? 0))
    .slice(0, 3)
    // Zurück in die Reihenfolge der Partie · gelesen wird von vorn nach hinten,
    // ausgewählt wurde nach Gewicht.
    .sort((a, b) => a.index - b.index);

  const analyse =
    zumZug || wichtigste.length > 0 ? (
      <div className="mt-4">
        <Feldname>{t("expl.source")}</Feldname>
        {zumZug ? (
          <div
            className="mt-1.5 border-s-2 ps-[11px]"
            style={{ borderColor: zumZug.zug.farbe ?? "var(--color-line2)" }}
          >
            <span
              className="buch notation text-[13px] font-semibold"
              style={{ color: zumZug.zug.farbe }}
            >
              {zugLabel(zumZug.zug, zumZug.index)}
              {zumZug.zug.nag}
            </span>{" "}
            <span className="buch text-[14px] leading-[1.5] text-ink2">
              {`„${zumZug.zug.erklaerung}“`}
            </span>
            {/* Der Satz darüber nennt, was passiert ist; diese Zeile, woher
                der Preis kommt. Ohne Anführungszeichen: Sie ist keine zweite
                Anmerkung, sondern die Rechnung dahinter. */}
            {zumZug.zug.grund && (
              <div className="mt-1 text-[12px] leading-[1.5] text-ink3">{zumZug.zug.grund}</div>
            )}
          </div>
        ) : (
          <div className="mt-1">
            {wichtigste.map(({ zug, index }, i) => (
              <button
                key={index}
                type="button"
                onClick={() => onPly(index + 1)}
                className={`flex w-full items-baseline gap-2.5 py-[7px] text-start ${
                  i === wichtigste.length - 1 ? "" : "border-b border-line"
                }`}
              >
                <span
                  className="buch notation blatt-zahl w-[58px] flex-none truncate text-[12.5px] font-semibold"
                  style={{ color: zug.farbe }}
                >
                  {zugLabel(zug, index)}
                  {zug.nag}
                </span>
                <span className="buch min-w-0 flex-1 text-[13.5px] leading-[1.5] text-ink2">
                  {`„${zug.erklaerung}“`}
                </span>
              </button>
            ))}
          </div>
        )}
        <Fussnote>{t("blatt.explNote")}</Fussnote>
      </div>
    ) : null;

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
      {analyse}
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


  // ── Der Apparat ───────────────────────────────────────────────────────────
  //
  // Was in der gewöhnlichen Fassung zwei Karten sind, sind hier zwei Rubriken:
  // Überschrift, Linie, Tabelle. Kein Kasten, keine Pille, keine Fläche.

  /** Anteil eines Wertes an der Summe · als Prozentbreite für die Bahn. */
  const anteil = (wert: number, von: number) =>
    von > 0 ? `${((wert / von) * 100).toFixed(1)}%` : "0%";

  /** Der Kopf einer Zugtabelle · dieselben Spalten wie die Zeilen darunter. */
  const spaltenkopf = (spalten: { label: ReactNode; breite?: number; rechts?: boolean }[]) => (
    <div className="mt-2 flex items-baseline gap-[11px] border-b border-line pb-[5px]">
      {spalten.map((spalte, index) => (
        <span
          key={index}
          className={`blatt-feld truncate text-ink3 ${
            spalte.breite ? "flex-none" : "min-w-0 flex-1"
          } ${spalte.rechts ? "text-end" : ""}`}
          style={spalte.breite ? { width: spalte.breite } : undefined}
        >
          {spalte.label}
        </span>
      ))}
    </div>
  );

  /**
   * Eine Zugzeile des Buches · Zug, Bilanzbahn, Zahl der Partien, Elo-Schnitt.
   *
   * Die Bahn ist die eigentliche Auskunft: drei Abschnitte in den Farben, die
   * die App überall für Sieg, Remis und Niederlage benutzt, aus Sicht von Weiß
   * gelesen. Der Kopf darüber sagt in denselben Farben, welcher welcher ist —
   * so braucht die Reihe keine Legende unter sich.
   */
  const buchzeile = (zug: BuchZug, letzte: boolean, onZug: (san: string) => void) => {
    const partien = zug.weiss + zug.remis + zug.schwarz;
    return (
      <button
        key={zug.san}
        type="button"
        onClick={() => onZug(zug.san)}
        title={t("an.bookPlay", { san: translateSan(zug.san, locale) })}
        className={`flex h-[30px] w-full items-center gap-[11px] text-start ${
          letzte ? "" : "border-b border-line"
        }`}
      >
        <span className="notation blatt-zahl w-11 flex-none truncate text-[12.5px] text-ink">
          {translateSan(zug.san, locale)}
        </span>
        <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
          <span className="absolute bottom-0 start-0 flex h-[9px] w-full">
            <span style={{ width: anteil(zug.weiss, partien), background: "var(--color-win)" }} />
            <span style={{ width: anteil(zug.remis, partien), background: "var(--color-draw)" }} />
            <span style={{ width: anteil(zug.schwarz, partien), background: "var(--color-loss)" }} />
          </span>
        </span>
        {/* Der Online-Bestand zählt in Milliarden · ausgeschrieben liefe die
            Zahl über die Spalte daneben. Genau steht sie im Tooltip. */}
        <span
          title={deInt(partien)}
          className="blatt-zahl w-[66px] flex-none truncate text-end text-[12px] text-ink"
        >
          {deShort(partien)}
        </span>
        <span className="blatt-zahl w-10 flex-none truncate text-end text-[11px] text-ink3">
          {zug.elo ?? "—"}
        </span>
      </button>
    );
  };

  /** Die Häufigkeits-Auskunft einer Quelle · Kopfzeile, Bahnen, Musterpartien. */
  const buchstand = (stand: BuchStand, onZug: (san: string) => void) => (
    <>
      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <span className="blatt-zahl flex-none text-[12px] text-ink2" title={deInt(stand.partien)}>
          {t(stand.partien === 1 ? "an.bookGames.one" : "an.bookGames.many", {
            n: deShort(stand.partien),
          })}
        </span>
        {stand.eroeffnung && (
          <span className="buch min-w-0 truncate text-[13px] italic text-ink2">
            {stand.eroeffnung}
          </span>
        )}
      </div>
      {spaltenkopf([
        { label: t("common.moves.one"), breite: 44 },
        {
          label: (
            <>
              <span style={{ color: "var(--color-win)" }}>{t("common.white")}</span>
              {" · "}
              <span style={{ color: "var(--color-draw)" }}>{t("common.draw")}</span>
              {" · "}
              <span style={{ color: "var(--color-loss)" }}>{t("common.black")}</span>
            </>
          ),
        },
        { label: t("ins.games"), breite: 66, rechts: true },
        { label: t("blatt.bookElo"), breite: 40, rechts: true },
      ])}
      {stand.zuege.map((zug, index) => buchzeile(zug, index === stand.zuege.length - 1, onZug))}
      {stand.musterpartien.length > 0 && (
        <div className="mt-3.5">
          <Feldname>{t("an.bookTopGames")}</Feldname>
          <div className="mt-1">
            {stand.musterpartien.map((partie, index) => (
              <button
                key={partie.id}
                type="button"
                onClick={partie.onOeffnen}
                className={`flex w-full items-baseline gap-2.5 py-[6px] text-start ${
                  index === stand.musterpartien.length - 1 ? "" : "border-b border-line"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink2">
                  {partie.paarung}
                </span>
                <span className="blatt-zahl flex-none text-[11px] text-ink3">{partie.jahr}</span>
                <span className="blatt-zahl w-10 flex-none text-end text-[11.5px] text-ink">
                  {partie.ergebnis}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const buchTeil = buch ? (
    <div>
      <Rubrik>{t("an.book")}</Rubrik>
      {/* Vier Quellen, vier Fragen · als Register mit Marke an der Kante, wie
          die Tiefenreiter der Insights. Die Reiter stehen auch dann da, wenn
          eine Quelle gesperrt ist: Was es gibt, soll man sehen können, bevor
          man es kauft. */}
      <div className="flex border-b border-line">
        {buch.reiter.map((reiter) => {
          const an = reiter.id === buch.quelle;
          return (
            <button
              key={reiter.id}
              type="button"
              onClick={() => buch.onQuelle(reiter.id)}
              aria-current={an ? "page" : undefined}
              className={`relative flex min-h-11 flex-1 items-center justify-center gap-1 px-1 text-[12px] ${
                an ? "font-semibold text-ink" : "text-ink3 hover:text-ink2"
              }`}
            >
              {an && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] bg-ink" />}
              <span className="truncate">{reiter.name}</span>
              {!an && reiter.plus && <Sparkles size={10} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
      {buch.hinweis ? (
        <div className="mt-3 text-[12.5px] leading-[1.6] text-ink3">{buch.hinweis}</div>
      ) : buch.motor ? (
        <>
          {spaltenkopf([
            { label: t("common.moves.one"), breite: 44 },
            { label: t("blatt.bookEval") },
            { label: t("blatt.bookWinrate"), breite: 68, rechts: true },
          ])}
          {buch.motor.zuege.map((zug, index) => (
            <button
              key={zug.san}
              type="button"
              onClick={() => buch.onZug(zug.san)}
              title={t("an.bookPlay", { san: translateSan(zug.san, locale) })}
              className={`flex h-[30px] w-full items-center gap-[11px] text-start ${
                index === (buch.motor?.zuege.length ?? 0) - 1 ? "" : "border-b border-line"
              }`}
            >
              <span className="notation blatt-zahl w-11 flex-none truncate text-[12.5px] text-ink">
                {translateSan(zug.san, locale)}
              </span>
              <span className="blatt-zahl min-w-0 flex-1 truncate text-[12.5px] text-ink2">
                {zug.bewertung == null
                  ? "—"
                  : `${zug.bewertung >= 0 ? "+" : "−"}${de(Math.abs(zug.bewertung), 2)}`}
              </span>
              <span className="blatt-zahl w-[68px] flex-none truncate text-end text-[11.5px] text-ink3">
                {zug.quote != null ? `${zug.quote} %` : ""}
              </span>
            </button>
          ))}
        </>
      ) : buch.stand && buch.sperre ? (
        // Gesperrt steht dieselbe Form da, nur unscharf · gefragt wird nichts.
        // `blatt-formular` nimmt der Sperrfläche ihre runden Ecken.
        <div className="blatt-formular">
          <PlusLock feature={buch.sperre}>{buchstand(buch.stand, buch.onZug)}</PlusLock>
        </div>
      ) : buch.stand ? (
        buchstand(buch.stand, buch.onZug)
      ) : null}
      {(buch.stand || buch.motor) && (
        <Fussnote linie>
          {buch.motor ? t("set.chessdbNote") : t("blatt.bookNote")}
          {(buch.stand?.ausCache || buch.motor?.ausCache) && ` · ${t("an.bookCached")}`}
        </Fussnote>
      )}
    </div>
  ) : null;

  /**
   * Diese Stellung in den eigenen Partien.
   *
   * Zwei Auskünfte, beide zugleich Griffe: was man von hier aus gespielt hat
   * und wie es ausging, und welche Partien durch diese Stellung gingen. Die
   * Bahn trägt den Strich bei fünfzig Prozent — ohne ihn sähen 47 % nach viel
   * aus.
   */
  const stellungenTeil = stellungen ? (
    <div>
      <Rubrik>{t("an.posInGames")}</Rubrik>
      {stellungen.gesamt > 0 ? (
        <>
          <div className="mt-2.5 text-[12.5px] text-ink2">
            {t(stellungen.gesamt === 1 ? "an.reachedIn.one" : "an.reachedIn.many", {
              n: deInt(stellungen.gesamt),
            })}
          </div>
          {stellungen.zuege.length > 0 && (
            <>
              {spaltenkopf([
                { label: t("common.moves.one"), breite: 44 },
                { label: t("blatt.scored") },
                { label: t("ins.games"), breite: 62, rechts: true },
              ])}
              {stellungen.zuege.map((zug, index) => (
                <button
                  key={zug.san}
                  type="button"
                  onClick={() => stellungen.onZug(zug.san)}
                  title={t("an.bookPlay", { san: translateSan(zug.san, locale) })}
                  className={`flex h-[30px] w-full items-center gap-[11px] text-start ${
                    index === stellungen.zuege.length - 1 ? "" : "border-b border-line"
                  }`}
                >
                  <span className="notation blatt-zahl w-11 flex-none truncate text-[12.5px] text-ink">
                    {translateSan(zug.san, locale)}
                  </span>
                  <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
                    <span
                      className="absolute bottom-0 start-0 h-[9px]"
                      style={{
                        width: anteil(Math.max(0, Math.min(100, zug.quote)), 100),
                        background: zug.quote >= 50 ? "var(--color-win)" : "var(--color-loss)",
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute -bottom-[3px] h-[17px] w-px"
                      style={{ insetInlineStart: "50%", background: "var(--color-ink3)" }}
                    />
                  </span>
                  <span className="blatt-zahl w-[62px] flex-none truncate text-end text-[12px] text-ink">
                    {deInt(zug.partien)}
                    {" · "}
                    {de(zug.quote)} %
                  </span>
                </button>
              ))}
            </>
          )}
          {stellungen.treffer.length > 0 && (
            <div className="mt-3.5">
              <Feldname>{t("nav.games")}</Feldname>
              <div className="mt-1">
                {stellungen.treffer.map((treffer, index) => (
                  <button
                    key={`${treffer.id}-${treffer.ply}`}
                    type="button"
                    onClick={treffer.onOeffnen}
                    className={`flex w-full items-baseline gap-2.5 py-[6px] text-start ${
                      index === stellungen.treffer.length - 1 ? "" : "border-b border-line"
                    }`}
                  >
                    <span className="blatt-zahl w-[72px] flex-none truncate text-[11.5px] text-ink3">
                      {treffer.datum}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">
                      {treffer.gegner}
                    </span>
                    <span className="flex-none">
                      <Punkt ergebnis={treffer.ergebnis} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <Fussnote linie>{t("blatt.posNote")}</Fussnote>
        </>
      ) : (
        <div className="mt-3 text-[12.5px] leading-[1.6] text-ink3">{t("an.posNotFound")}</div>
      )}
    </div>
  ) : null;

  const apparat =
    buchTeil || stellungenTeil ? (
      <div className="flex min-w-0 flex-col gap-6">
        {buchTeil}
        {stellungenTeil}
      </div>
    ) : null;

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
      {/* Die Zählung nimmt ohne Nebengriffe die doppelte Breite einer Taste,
          mit ihnen nur die ihres Textes · sonst stünden auf einem schmalen
          Telefon acht Zellen in einer Reihe, die für sechs Platz hat. */}
      <span
        className={`blatt-zahl flex h-11 items-center justify-center border-s border-line text-[12.5px] text-ink3 ${
          griffe ? "flex-none px-3" : "flex-[2]"
        }`}
      >
        {t("blatt.plyOf", { n: deInt(ply), total: deInt(zuege.length) })}
      </span>
      {griffe && (
        <span className="blatt-formular flex h-11 flex-none items-center gap-1 border-s border-line px-1.5">
          {griffe}
        </span>
      )}
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
        {apparat && <div className="mt-6">{apparat}</div>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      {/* Ein Raster und keine Reihe, weil der Apparat eine dritte Spalte ist,
          sobald das Fenster sie hergibt · dieselbe Schwelle wie in der
          gewöhnlichen Fassung. Darunter steht er unter dem Satz und nicht
          unter dem Brett: Er gehört zur Stellung, nicht zur Partie. Zweimal
          gesetzt wird er nie — die Spalte wechselt, das Stück bleibt. */}
      <div
        className={`grid min-h-0 min-w-0 flex-1 gap-x-9 gap-y-8 pt-5 ${
          // Die Textspalte darf bis auf null schrumpfen · sonst nähme sie in
          // einem schmalen Fenster dem Brett die Breite, und ausgerechnet das
          // Brett ist das, wofür man die Analyse öffnet.
          apparat
            ? "grid-cols-[minmax(0,var(--board-col))_minmax(0,1fr)] min-[1660px]:grid-cols-[minmax(0,var(--board-col))_minmax(0,1fr)_320px]"
            : "grid-cols-[minmax(0,var(--board-col))_minmax(0,1fr)]"
        }`}
      >
        {brettSpalte}
        {/* Mit Partie stehen Text und Bilanz an den beiden Enden der Spalte,
            wie Satz und Fußnote auf einer Buchseite. Am freien Brett wächst
            der Zugtext von oben nach; dann rückt die Engine dicht darunter
            und nicht an den Fuß einer leeren Spalte. */}
        <div
          className={`flex min-w-0 flex-col gap-6 ${frei ? "" : "justify-between"}`}
        >
          {partietext}
          {neben}
        </div>
        {apparat && (
          <div className="col-start-2 min-w-0 min-[1660px]:col-start-3 min-[1660px]:row-start-1">
            {apparat}
          </div>
        )}
      </div>
    </div>
  );
}
