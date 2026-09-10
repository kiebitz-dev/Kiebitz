/**
 * Die Teile, aus denen ein Blatt gesetzt wird.
 *
 * Kein Baustein holt Daten und keiner weiß, auf welcher Seite er steht — sie
 * bekommen, was sie zeigen sollen, und setzen es. Der Modus ist eine zweite
 * Darstellung derselben Daten, keine zweite Datenbeschaffung.
 *
 * Kein Farbwert: alles über die Tokens aus src/themes.css.
 */
import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
// Wie eine Eingabe in mehrere Stichwörter zerfällt, ist eine Regel und keine
// Darstellung · sie steht deshalb weiter beim Tag-Editor der gewöhnlichen
// Fassung und wird hier nur benutzt.
import { parseTagInput } from "../TagEditor";
import "./blatt.css";

/** Kolumnentitel · oben auf jeder Buchseite, darunter die kräftige Linie. */
export function Kolumnentitel({
  links,
  rechts,
}: {
  links: ReactNode;
  rechts?: ReactNode;
}) {
  return (
    <div>
      <div className="blatt-kolumne flex items-baseline justify-between gap-4 text-ink3">
        <span className="min-w-0 truncate">{links}</span>
        {rechts != null && <span className="min-w-0 truncate">{rechts}</span>}
      </div>
      <div className="mt-[7px] h-px bg-ink" />
    </div>
  );
}

/**
 * Überschrift einer Rubrik · Linie darunter, wie im Formular.
 *
 * `weg` steht rechts in der Linie: der eine weiterführende Griff, den ein
 * Abschnitt hat. Als Schaltfläche und nicht als Text — er soll auch mit der
 * Tastatur erreichbar sein.
 */
export function Rubrik({
  children,
  weg,
  onWeg,
}: {
  children: ReactNode;
  weg?: string;
  onWeg?: () => void;
}) {
  return (
    <div className="blatt-kolumne flex items-baseline justify-between gap-4 border-b border-ink pb-[5px] text-ink3">
      <span className="min-w-0 truncate">{children}</span>
      {weg && onWeg && (
        <button
          type="button"
          onClick={onWeg}
          className="blatt-kolumne shrink-0 tracking-[0.12em] text-accent hover:text-accent-hover"
        >
          {weg}
        </button>
      )}
      {/* Die Kernaussage steht in der Rubrikzeile · in einer schmalen Spalte
          kürzt sie, statt die Spalte breiter zu machen. Ausgeschrieben steht
          sie ohnehin darunter. */}
      {weg && !onWeg && (
        <span className="min-w-0 truncate tracking-[0.12em] text-accent">
          {weg}
        </span>
      )}
    </div>
  );
}

/** Ein beschriftetes Feld des Turnierformulars · Wert auf einer Linie. */
export interface Feld {
  label: string;
  wert: ReactNode;
  /** Namen der Spieler stehen größer als die Angaben daneben. */
  gross?: boolean;
}

/**
 * Kopf eines Turnierformulars: beschriftete Felder auf Linien.
 *
 * `spalten` ist die Rasterangabe des Entwurfs; ohne sie stehen alle Felder
 * gleich breit.
 */
export function Formularkopf({
  felder,
  spalten,
}: {
  felder: Feld[];
  spalten?: string;
}) {
  return (
    <div
      className="grid items-end"
      style={{
        gridTemplateColumns:
          spalten ?? `repeat(${felder.length}, minmax(0, 1fr))`,
      }}
    >
      {/* `min-w-0` ist hier keine Feinheit, sondern das Ganze: Eine Rasterzelle
          ist von Haus aus mindestens so breit wie ihr Inhalt. Ein langer
          Eröffnungsname sprengt damit seine Spalte und schiebt sich über die
          nächste — bei schmalem Fenster stand das Ergebnis im Namen. Erst mit
          der Null greift das `truncate` darunter. */}
      {felder.map((feld, index) => (
        <div
          key={feld.label + index}
          className={`min-w-0 ${index ? "border-s border-line px-3" : "pe-3"}`}
        >
          <div className="blatt-feld truncate text-ink3">{feld.label}</div>
          <div
            className={`mt-1.5 truncate border-b border-line2 pb-[5px] text-ink ${
              feld.gross ? "text-[14.5px]" : "text-[13px]"
            }`}
          >
            {feld.wert}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Das Ergebnis, wie es auf dem Zettel eingekastelt steht. */
export function Ergebniskasten({
  children,
  hoehe = 32,
  gross = 15,
}: {
  children: ReactNode;
  hoehe?: number;
  gross?: number;
}) {
  return (
    <div
      className="blatt-zahl flex items-center justify-center border border-ink font-medium tracking-[0.06em] text-ink"
      style={{ height: hoehe, fontSize: gross }}
    >
      <span className="truncate px-1">{children}</span>
    </div>
  );
}

/** Gespielte Farbe als Feld · gefüllt = Schwarz, leer = Weiß. */
export function Farbfeld({
  farbe,
  kante = 10,
}: {
  farbe: "white" | "black";
  kante?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-block flex-none border border-ink"
      style={{
        height: kante,
        width: kante,
        background: farbe === "black" ? "var(--color-ink)" : "transparent",
      }}
    />
  );
}

/** Ergebnis als Punkt · 1 / ½ / 0 statt Gewonnen-/Verloren-Pillen. */
export const PUNKT: Record<string, string> = {
  win: "1",
  draw: "\u00bd",
  loss: "0",
};
export const PUNKTFARBE: Record<string, string> = {
  win: "var(--color-win)",
  draw: "var(--color-draw)",
  loss: "var(--color-loss)",
};

export function Punkt({ ergebnis }: { ergebnis: string }) {
  return (
    <span
      className="blatt-zahl text-[14px] font-medium"
      style={{ color: PUNKTFARBE[ergebnis] ?? "var(--color-draw)" }}
    >
      {PUNKT[ergebnis] ?? "\u2014"}
    </span>
  );
}

/**
 * Eine Zeile der Tagesliste · Kästchen, Zahl, Sache, Weg dorthin.
 *
 * Die ganze Zeile ist die Schaltfläche; 52 px hoch, damit sie auch auf dem
 * Telefon sicher zu treffen ist.
 */
export function ErledigenZeile({
  zahl,
  zusatz,
  sache,
  neben,
  weg,
  onWeg,
  erledigt = false,
  letzte = false,
  hoehe = 52,
}: {
  zahl: ReactNode;
  zusatz?: ReactNode;
  sache: string;
  neben: string;
  weg: string;
  onWeg: () => void;
  erledigt?: boolean;
  letzte?: boolean;
  hoehe?: number;
}) {
  return (
    <button
      type="button"
      onClick={onWeg}
      className={`flex w-full items-center gap-3 text-start ${letzte ? "" : "border-b border-line"}`}
      style={{ minHeight: hoehe }}
    >
      <span
        aria-hidden
        className="flex h-[15px] w-[15px] flex-none items-center justify-center border border-line2 text-ink"
      >
        {erledigt && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="blatt-zahl min-w-[56px] text-[22px] font-medium text-ink">
        {zahl}
        {zusatz != null && (
          <span className="text-[13px] font-normal text-ink3">{zusatz}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">{sache}</span>
        <span className="block truncate text-[11.5px] text-ink3">{neben}</span>
      </span>
      {/* Der Weg gibt nicht nach · zusammengedrückt liefe er sonst in die
          Sache links von ihm hinein, statt sie zu kürzen. */}
      <span className="flex-none whitespace-nowrap text-[12.5px] text-accent">
        {weg} →
      </span>
    </button>
  );
}

/**
 * Ein Zitat aus den Daten der App · mit Herkunft darüber.
 *
 * Die Herkunft ist nicht Zierrat: Sie sagt, dass der Satz aus der Analyse oder
 * aus der eigenen Notiz stammt und nicht hier entstanden ist.
 */
export function Zitat({
  quelle,
  children,
}: {
  quelle: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="blatt-feld text-ink3">{quelle}</div>
      <div className="buch mt-1 border-s-2 border-line2 ps-[11px] text-[14px] leading-[1.5] text-ink2">
        {children}
      </div>
    </div>
  );
}

/** Weiterführender Weg · dieselbe Rolle wie die Schaltflächen von heute. */
export function Weg({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center whitespace-nowrap text-[12.5px] text-accent hover:text-accent-hover"
    >
      {children} →
    </button>
  );
}

/**
 * Zugfolge im Satz des Buches.
 *
 * `.notation` hält sie in Arabisch von links nach rechts — die Regel dafür
 * steht in src/index.css und gilt für jede Notation der App.
 */
export function Zugfolge({
  children,
  gross = 14.5,
  style,
}: {
  children: ReactNode;
  gross?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="buch notation leading-[1.6] text-ink"
      style={{ fontSize: gross, fontVariantNumeric: "lining-nums", ...style }}
    >
      {children}
    </div>
  );
}

/**
 * Die Stichwörter eines Eintrags · im Buchsatz keine Pillen, sondern Wörter.
 *
 * Ein Tag ist in der gewöhnlichen Fassung eine Pille: gefüllte Fläche,
 * abgerundete Ecken, ein Kreuz zum Wegnehmen. Auf einem Blatt gibt es das
 * nicht. Dort stehen Stichwörter als Wörter auf einer Linie, durch Punkte
 * getrennt, wie das Schlagwortregister hinten im Band — und weil sie zum
 * Eintrag gehören und nicht zur Liste, stehen sie da, wo auch die Bemerkung
 * steht.
 *
 * Geschrieben wird hier wie in der gewöhnlichen Fassung: Ein Klick auf ein
 * Wort nimmt es weg, das Feld darunter legt eines an. Ohne `onSchreiben`
 * bleibt beides fort und die Zeile ist nur noch Auskunft — so wie die Partie
 * ohne Datenbank auch keine Bemerkung annimmt.
 *
 * `vorsatz` ist ein Wort, das die App selbst vergibt („Nicht in Analysen") ·
 * es steht mit, aber es lässt sich nicht wegnehmen.
 */
export function Stichwortzeile({
  woerter,
  vorsatz,
  leer,
  platzhalter,
  entfernen,
  onSchreiben,
}: {
  woerter: string[];
  vorsatz?: string;
  /** Was dasteht, solange keines vergeben ist. */
  leer: string;
  /** Beschriftung des Schreibfeldes · nur mit `onSchreiben` von Belang. */
  platzhalter?: string;
  /** Titel des Griffs, der ein Wort wieder wegnimmt. */
  entfernen?: string;
  /** Fehlt sie, ist die Zeile nur zu lesen · dann steht auch kein Feld darunter. */
  onSchreiben?: (woerter: string[]) => void;
}) {
  const [entwurf, setEntwurf] = useState("");

  const anlegen = () => {
    const neue = parseTagInput(entwurf);
    if (!neue.length || !onSchreiben) return;
    onSchreiben([...woerter, ...neue]);
    setEntwurf("");
  };

  // Solange nichts dasteht und geschrieben werden darf, ist das Feld die Zeile.
  //
  // „Noch keine Stichwörter" auf einer Linie und darunter „Stichwort
  // eintragen …" auf der nächsten: Das waren zwei Zeilen für eine Sache, und
  // die obere sagte nur, dass die untere noch nichts gebracht hat. Schlimmer,
  // sie sah aus wie die Auskunft, die sie war — wer sie antippte, tippte ins
  // Leere und suchte danach nicht weiter.
  //
  // Ohne Wörter bleibt deshalb nur das Feld stehen, und es steht da, wo vorher
  // der Satz stand. Die Auskunft behält, wer nichts schreiben darf: Ohne
  // Datenbank nimmt die Partie keine Stichwörter an, und dann ist die leere
  // Zeile die ganze Wahrheit.
  const zeile = Boolean(vorsatz) || woerter.length > 0 || !onSchreiben;

  return (
    <div>
      {zeile && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-line pb-[5px] text-[12.5px]">
          {vorsatz && <span className="text-ink2">{vorsatz}</span>}
          {woerter.length === 0 && !vorsatz && (
            <span className="text-ink3">{leer}</span>
          )}
          {woerter.map((wort) =>
            onSchreiben ? (
              <button
                key={wort}
                type="button"
                onClick={() =>
                  onSchreiben(woerter.filter((value) => value !== wort))
                }
                title={entfernen}
                className="py-0.5 text-ink hover:text-accent"
              >
                {wort}
                <span aria-hidden className="text-ink3">
                  {" ×"}
                </span>
              </button>
            ) : (
              <span key={wort} className="py-0.5 text-ink">
                {wort}
              </span>
            ),
          )}
        </div>
      )}
      {onSchreiben && (
        <input
          value={entwurf}
          onChange={(event) => setEntwurf(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              anlegen();
            }
          }}
          onBlur={anlegen}
          placeholder={platzhalter}
          aria-label={platzhalter}
          className="mt-1.5 block min-h-11 w-full border-b border-line2 bg-transparent pb-[5px] text-[12.5px] text-ink placeholder:text-ink3 focus:border-ink focus:outline-none"
        />
      )}
    </div>
  );
}

/**
 * Die Hausfarbe einer Plattform · dieselbe auf jedem Blatt.
 *
 * Wo „chess.com" oder „lichess" steht, sagt die Farbe es schon, bevor man das
 * Wort gelesen hat. Groß geschrieben wird dabei nichts: Der Formularkopf setzt
 * die Herkunft so, wie die Plattform sich selbst schreibt. Kein Farbwert steht
 * hier · nur der Name des Tokens aus src/themes.css.
 */
export function plattformFarbe(name: string): string | undefined {
  const kurz = name.trim().toLowerCase();
  if (kurz === "chess.com") return "var(--color-cc)";
  if (kurz === "lichess" || kurz === "lichess.org") return "var(--color-blue)";
  return undefined;
}

/** Beschriftung eines Formularfeldes, wo kein ganzer Kopf nötig ist. */
export function Feldname({ children }: { children: ReactNode }) {
  return <div className="blatt-feld text-ink3">{children}</div>;
}

/**
 * Eine Zeile im Verzeichnis · Name, Punktlinie, Zahl.
 *
 * Derselbe Satz wie im Register der Hülle, nur innerhalb einer Seite: das
 * Inhaltsverzeichnis eines Repertoires, die Aufgabenliste der Endspiele. Die
 * Zahl rechts steht kräftig, wenn sie etwas offenes meint, und blass, wenn sie
 * nur ein Wert ist.
 *
 * `griffe` sind die Handgriffe am Zeilenende — verschieben, ändern, wegnehmen.
 * Sie stehen neben der Zahl und nicht in ihr: Ein Verzeichnis bleibt lesbar,
 * auch wenn an seinen Zeilen etwas zu tun ist. Weil eine Schaltfläche keine
 * zweite enthalten darf, wird die Zeile mit Griffen zur Reihe aus Zeile und
 * Griffen; ohne sie bleibt sie die eine Schaltfläche, die sie immer war.
 */
export function Verzeichniszeile({
  name,
  zahl,
  aktiv = false,
  tief = 0,
  hoehe = 44,
  onClick,
  onKeyDown,
  griffe,
  knopfRef,
}: {
  name: ReactNode;
  zahl?: ReactNode;
  aktiv?: boolean;
  /** Einrückung in Stufen · ein Kapitel unter einem Teil. */
  tief?: number;
  hoehe?: number;
  onClick?: () => void;
  /** Tastatur an der Zeile · das Blättern durch die Züge hängt daran. */
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /** Handgriffe am Zeilenende · stehen rechts neben der Zahl. */
  griffe?: ReactNode;
  knopfRef?: (element: HTMLButtonElement | null) => void;
}) {
  const inhalt = (
    <>
      {aktiv && (
        <span
          aria-hidden
          className="absolute inset-y-[7px] -start-3.5 w-[3px] bg-ink"
        />
      )}
      <span
        className={`min-w-0 truncate ${tief ? "text-[13px]" : "text-[14px]"} ${
          aktiv ? "font-semibold text-ink" : "text-ink2"
        }`}
      >
        {name}
      </span>
      <span aria-hidden className="blatt-punktlinie" />
      <span
        className={`blatt-zahl shrink-0 text-[11.5px] ${
          zahl != null && zahl !== "" && zahl !== "0" ? "text-ink" : "text-ink3"
        }`}
      >
        {zahl}
      </span>
    </>
  );
  const klasse = "relative flex w-full items-baseline gap-2 text-start";
  const zeile = onClick ? (
    <button
      type="button"
      ref={knopfRef}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-current={aktiv ? "true" : undefined}
      className={klasse}
      style={{ minHeight: hoehe, paddingInlineStart: tief * 16 }}
    >
      {inhalt}
    </button>
  ) : (
    <div
      className={klasse}
      style={{ minHeight: hoehe, paddingInlineStart: tief * 16 }}
    >
      {inhalt}
    </div>
  );
  if (!griffe) return zeile;
  return (
    <div className="group flex items-stretch">
      <span className="flex min-w-0 flex-1 items-center">{zeile}</span>
      {griffe}
    </div>
  );
}

/** Der Teil über den Kapiteln · Beschriftung auf kräftiger Linie. */
export function Verzeichnisteil({ children }: { children: ReactNode }) {
  return (
    <div className="blatt-feld mt-3.5 border-b border-ink pb-[5px] text-ink3">
      {children}
    </div>
  );
}

/**
 * Ein Balken im Formularsatz · Haarlinienrahmen, gefüllt bis zum Wert.
 *
 * Kein Diagrammwerkzeug und keine Farbe: ein Kasten aus einer Linie, gefüllt
 * mit der Schriftfarbe. So liest er sich in jedem der acht Themen gleich.
 */
export function Balken({
  anteil,
  hoehe = 7,
}: {
  anteil: number;
  hoehe?: number;
}) {
  return (
    <span className="block border border-line2" style={{ height: hoehe }}>
      <span
        className="block h-full bg-ink"
        style={{ width: `${Math.max(0, Math.min(100, anteil))}%` }}
      />
    </span>
  );
}

/**
 * Eine Reihe gleichwertiger Schaltflächen unter dem Brett · Haarlinien oben
 * und unten, senkrechte Trennstriche dazwischen, 44 px hoch.
 */
export function Schalterreihe({
  eintraege,
}: {
  eintraege: {
    label: ReactNode;
    onClick?: () => void;
    betont?: boolean;
    titel?: string;
  }[];
}) {
  return (
    <div className="flex items-center border-y border-line">
      {eintraege.map((eintrag, index) => (
        <button
          key={index}
          type="button"
          onClick={eintrag.onClick}
          disabled={!eintrag.onClick}
          title={eintrag.titel}
          className={`flex h-11 flex-1 items-center justify-center text-[12.5px] disabled:text-ink3 ${
            eintrag.betont ? "text-accent" : "text-ink2 hover:text-ink"
          } ${index ? "border-s border-line" : ""}`}
        >
          {eintrag.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Eine Bahn · Beschriftung links, Balken auf der Grundlinie, Wert rechts.
 *
 * Die Figur, mit der die Tiefenreiter der Insights gesetzt sind. Sie ist
 * dieselbe wie in der Spieler-DNA, nur allgemein gehalten: Jede Zeile trägt
 * ihre Beschriftung selbst, deshalb braucht eine Reihe von Bahnen keine
 * Legende darunter.
 *
 * `marke` ist der Vergleichswert auf derselben Bahn — das Gegnerfeld, der
 * eigene Schnitt, die Fünfzig-Prozent-Linie. Er steht als Strich und nicht als
 * zweiter Balken: Zwei Balken übereinander liest man als zwei Größen, einen
 * Strich als Maßstab.
 */
export function Bahn({
  name,
  neben,
  wert,
  anzeige,
  max = 100,
  marke,
  markeTitel,
  markeFarbe = "var(--color-violet)",
  rechts,
  breite = 96,
  wertBreite = 52,
  hoehe = 34,
  letzte = false,
  farbe = "var(--color-ink)",
}: {
  name: ReactNode;
  /** Zweite Zeile unter der Beschriftung · woraus der Wert gerechnet ist. */
  neben?: ReactNode;
  wert: number;
  /** Der Wert, wie er dasteht · mit Einheit und in der Schreibweise der Sprache. */
  anzeige: ReactNode;
  max?: number;
  marke?: number | null;
  markeTitel?: string;
  markeFarbe?: string;
  /** Zahl ganz rechts · der Vergleichswert als Ziffer. */
  rechts?: ReactNode;
  breite?: number;
  wertBreite?: number;
  hoehe?: number;
  letzte?: boolean;
  farbe?: string;
}) {
  const anteil = (wert: number) =>
    `${Math.max(0, Math.min(100, (wert / max) * 100)).toFixed(1)}%`;
  return (
    <div
      className={`flex items-center gap-[11px] text-[12.5px] ${letzte ? "" : "border-b border-line"}`}
      style={{ height: hoehe }}
    >
      <span className="min-w-0 flex-none" style={{ width: breite }}>
        <span className="block truncate text-ink2">{name}</span>
        {neben != null && (
          <span className="blatt-zahl block truncate text-[10px] text-ink3">
            {neben}
          </span>
        )}
      </span>
      <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
        <span
          className="absolute bottom-0 start-0 h-[9px]"
          style={{ width: anteil(wert), background: farbe }}
        />
        {marke != null && (
          <span
            title={markeTitel}
            className="absolute -bottom-[3px] h-[17px] w-[2px]"
            style={{ insetInlineStart: anteil(marke), background: markeFarbe }}
          />
        )}
      </span>
      <span
        className="blatt-zahl flex-none text-end text-[13px] text-ink"
        style={{ width: wertBreite }}
      >
        {anzeige}
      </span>
      {rechts != null && (
        <span className="blatt-zahl w-10 flex-none truncate text-end text-[11px] text-ink3">
          {rechts}
        </span>
      )}
    </div>
  );
}

/** Kopfzeile über einer Reihe Bahnen · sagt, was in welcher Spalte steht. */
export function Bahnkopf({
  was,
  skala,
  wert,
  rechts,
  breite = 96,
  wertBreite = 52,
}: {
  was: ReactNode;
  /** Wonach die Bahn misst · fehlt sie, bleibt die Spalte leer. */
  skala?: ReactNode;
  wert: ReactNode;
  rechts?: ReactNode;
  breite?: number;
  wertBreite?: number;
}) {
  return (
    <div className="flex items-baseline gap-[11px] border-b border-line pb-[5px] pt-2">
      <span
        className="blatt-feld flex-none truncate text-ink3"
        style={{ width: breite }}
      >
        {was}
      </span>
      <span className="blatt-feld min-w-0 flex-1 truncate text-ink3">
        {skala}
      </span>
      <span
        className="blatt-feld flex-none text-end text-ink3"
        style={{ width: wertBreite }}
      >
        {wert}
      </span>
      {rechts != null && (
        <span
          className="blatt-feld w-10 flex-none truncate text-end"
          style={{ color: "var(--color-violet)" }}
        >
          {rechts}
        </span>
      )}
    </div>
  );
}

/**
 * Ein Eintrag mit Rangzahl · dieselbe Regel wie beim Befund.
 *
 * Die Reihenfolge ist die Aussage: Sie sagt, was zuerst dran ist. Deshalb
 * steht links eine Zahl und kein Farbbalken.
 */
export function Rangzeile({
  rang,
  titel,
  unter,
  rechts,
  rechtsUnter,
  letzte = false,
}: {
  rang: number;
  titel: ReactNode;
  unter: ReactNode;
  rechts: ReactNode;
  rechtsUnter?: ReactNode;
  letzte?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-[11px] py-[9px] ${letzte ? "" : "border-b border-line"}`}
    >
      <span className="blatt-zahl w-4 flex-none text-end text-[12.5px] text-ink3">
        {rang}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] text-ink">{titel}</span>
        <span className="mt-0.5 block text-[11.5px] text-ink3">{unter}</span>
      </span>
      <span className="flex-none text-end">
        <span className="blatt-zahl block text-[13.5px] text-ink">
          {rechts}
        </span>
        {rechtsUnter != null && (
          <span className="blatt-zahl block text-[10.5px] text-ink3">
            {rechtsUnter}
          </span>
        )}
      </span>
    </div>
  );
}

/** Eine Spalte der Blatttabelle · die Angaben, die ihr Satz braucht. */
export interface Tabellenspalte {
  label: ReactNode;
  /** Feste Breite in Punkten · ohne sie nimmt die Spalte, was übrig bleibt. */
  breite?: number;
  rechts?: boolean;
  /** Ziffern stehen untereinander. */
  zahl?: boolean;
  /** Eröffnungsnamen stehen im Buchsatz und kursiv. */
  buch?: boolean;
  blass?: boolean;
}

/**
 * Eine Tabelle im Turnierbuchsatz · Haarlinie unter jeder Zeile, kein Rahmen.
 *
 * Nicht alles wird im Blatt zur Bahn: Sieben Spalten über drei Zeitformate
 * sind eine Kreuztabelle, und daraus eine Reihe Balken zu machen hieße, sechs
 * Spalten wegzuwerfen. Eine Tabelle bleibt eine Tabelle · sie verliert nur
 * ihren Rahmen und ihre Flächen.
 */
export function Blatttabelle({
  spalten,
  zeilen,
  hoehe = 28,
}: {
  spalten: Tabellenspalte[];
  zeilen: ReactNode[][];
  hoehe?: number;
}) {
  const zelle = (
    inhalt: ReactNode,
    spalte: Tabellenspalte,
    kopf: boolean,
    key: number,
  ) => {
    const satz = kopf
      ? "blatt-feld text-ink3"
      : [
          spalte.zahl ? "blatt-zahl" : "",
          spalte.buch ? "buch italic text-[13.5px]" : "text-[12.5px]",
          spalte.blass ? "text-ink3" : "text-ink",
        ].join(" ");
    return (
      <span
        key={key}
        className={`truncate ${satz} ${spalte.breite ? "flex-none" : "min-w-0 flex-1"} ${
          spalte.rechts ? "text-end" : ""
        }`}
        style={spalte.breite ? { width: spalte.breite } : undefined}
      >
        {inhalt}
      </span>
    );
  };
  // Was die Spalten mindestens brauchen · darunter scrollt die Tabelle in
  // ihrem eigenen Rahmen, statt die Seite mitzunehmen. 120 px ist die
  // schmalste Spalte, die einen Namen noch lesbar hält, 10 px der Abstand.
  const mindestbreite =
    spalten.reduce((summe, spalte) => summe + (spalte.breite ?? 120), 0) +
    (spalten.length - 1) * 10;
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: mindestbreite }}>
        <div className="flex items-baseline gap-2.5 border-b border-line pb-[5px]">
          {spalten.map((spalte, index) =>
            zelle(spalte.label, spalte, true, index),
          )}
        </div>
        {zeilen.map((zeile, index) => (
          <div
            key={index}
            className={`flex items-center gap-2.5 ${
              index === zeilen.length - 1 ? "" : "border-b border-line"
            }`}
            style={{ height: hoehe }}
          >
            {zeile.map((wert, spalte) =>
              zelle(wert, spalten[spalte], false, spalte),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Die Fußnote einer Rubrik · warum die Zahl das sagt, was sie sagt.
 *
 * Sie steht ausgeschrieben da, wo die gewöhnliche Fassung sie hinter einem
 * aufklappbaren Abschnitt hält: Ein Satzspiegel hat kein Platzproblem, das ein
 * Aufklappen lösen müsste.
 */
export function Fussnote({
  children,
  linie = false,
}: {
  children: ReactNode;
  linie?: boolean;
}) {
  return (
    <div
      className={`mt-2.5 text-[10.5px] leading-[1.6] text-ink3 ${
        linie ? "border-t border-line pt-2" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** Eine Reihe beschrifteter Zahlen · der Formularkopf im Kleinen. */
export function Kennzahlen({
  zahlen,
  gross = 15,
}: {
  zahlen: { name: ReactNode; wert: ReactNode; neben?: ReactNode }[];
  gross?: number;
}) {
  return (
    <div className="mt-2 flex">
      {zahlen.map((zahl, index) => (
        <div
          key={index}
          className={`min-w-0 flex-1 ${index ? "border-s border-line ps-3" : ""} ${
            index < zahlen.length - 1 ? "pe-3" : ""
          }`}
        >
          {/* Eine Kennzahlenspalte ist schmal, und „Verwertung" bricht nicht ·
              deshalb kürzt die Beschriftung hier, wie im Formularkopf. */}
          <div className="blatt-feld truncate text-ink3">{zahl.name}</div>
          <div
            className="blatt-zahl mt-1 truncate text-ink"
            style={{ fontSize: gross }}
          >
            {zahl.wert}
          </div>
          {zahl.neben != null && (
            <div className="blatt-zahl mt-0.5 truncate text-[10px] text-ink3">
              {zahl.neben}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Eine Kurve mit eigener Skala · nie zwei Größen an zwei Achsen in einem Bild.
 *
 * `linie` legt eine gestrichelte Marke quer durch das Bild — die Fünfzig-
 * Prozent-Linie einer Punktequote, ohne die 47 % nach viel aussehen.
 */
export function Kurve({
  werte,
  farbe = "var(--color-ink)",
  breite = 460,
  hoehe = 46,
  min,
  max,
  linie,
}: {
  werte: number[];
  farbe?: string;
  breite?: number;
  hoehe?: number;
  min?: number;
  max?: number;
  linie?: number;
}) {
  if (werte.length < 2) return null;
  const lo = min ?? Math.min(...werte);
  const hi = max ?? Math.max(...werte);
  const spanne = hi - lo || 1;
  const x = (index: number) => (index / (werte.length - 1)) * breite;
  const y = (wert: number) => hoehe - ((wert - lo) / spanne) * (hoehe - 6) - 3;
  const punkte = werte
    .map((wert, index) => `${x(index).toFixed(1)},${y(wert).toFixed(1)}`)
    .join(" ");
  const letzte = werte.length - 1;
  return (
    <svg
      viewBox={`0 0 ${breite} ${hoehe}`}
      width="100%"
      height={hoehe}
      className="block overflow-visible"
      aria-hidden="true"
    >
      {linie != null && (
        <line
          x1="0"
          y1={y(linie)}
          x2={breite}
          y2={y(linie)}
          stroke="var(--color-line2)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <polyline
        points={punkte}
        fill="none"
        stroke={farbe}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(letzte)} cy={y(werte[letzte])} r="4" fill={farbe} />
    </svg>
  );
}

/**
 * Ein kleines Bild im Blatt · Beschriftung, Linien darüber und darunter, und
 * an den Rändern die Werte, die es sonst beschriften müsste.
 */
export function Figur({
  titel,
  rechts,
  links,
  unten,
  children,
}: {
  titel: ReactNode;
  /** Der letzte Wert · steht rechts über dem Bild. */
  rechts?: ReactNode;
  /** Der erste Wert · steht links unter dem Bild. */
  links?: ReactNode;
  /** Was rechts unter dem Bild steht · meist die Zahl der Messpunkte. */
  unten?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <Feldname>{titel}</Feldname>
        {rechts != null && (
          <span className="blatt-zahl text-[12.5px] text-ink">{rechts}</span>
        )}
      </div>
      <div className="mt-1.5 border-y border-line py-[7px]">{children}</div>
      {(links != null || unten != null) && (
        <div className="mt-1 flex justify-between gap-3 text-[10px] text-ink3">
          <span className="blatt-zahl truncate">{links}</span>
          <span className="truncate">{unten}</span>
        </div>
      )}
    </div>
  );
}
