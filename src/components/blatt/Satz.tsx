/**
 * Die Teile, aus denen ein Blatt gesetzt wird.
 *
 * Kein Baustein holt Daten und keiner weiß, auf welcher Seite er steht — sie
 * bekommen, was sie zeigen sollen, und setzen es. Der Modus ist eine zweite
 * Darstellung derselben Daten, keine zweite Datenbeschaffung.
 *
 * Kein Farbwert: alles über die Tokens aus src/themes.css.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
// Wie eine Eingabe in mehrere Stichwörter zerfällt, ist eine Regel und keine
// Darstellung · sie steht deshalb weiter beim Tag-Editor der gewöhnlichen
// Fassung und wird hier nur benutzt.
import { parseTagInput } from "../TagEditor";
import "./blatt.css";

/** Kolumnentitel · oben auf jeder Buchseite, darunter die kräftige Linie. */
export function Kolumnentitel({ links, rechts }: { links: ReactNode; rechts?: ReactNode }) {
  return (
    <div>
      <div className="blatt-kolumne flex items-baseline justify-between gap-4 text-ink3">
        <span className="min-w-0 truncate">{links}</span>
        {rechts != null && <span className="shrink-0">{rechts}</span>}
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
      {weg && !onWeg && <span className="shrink-0 tracking-[0.12em] text-accent">{weg}</span>}
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
export function Formularkopf({ felder, spalten }: { felder: Feld[]; spalten?: string }) {
  return (
    <div
      className="grid items-end"
      style={{ gridTemplateColumns: spalten ?? `repeat(${felder.length}, minmax(0, 1fr))` }}
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
      {children}
    </div>
  );
}

/** Gespielte Farbe als Feld · gefüllt = Schwarz, leer = Weiß. */
export function Farbfeld({ farbe, kante = 10 }: { farbe: "white" | "black"; kante?: number }) {
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
export const PUNKT: Record<string, string> = { win: "1", draw: "\u00bd", loss: "0" };
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
        {zusatz != null && <span className="text-[13px] font-normal text-ink3">{zusatz}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">{sache}</span>
        <span className="block truncate text-[11.5px] text-ink3">{neben}</span>
      </span>
      {/* Der Weg gibt nicht nach · zusammengedrückt liefe er sonst in die
          Sache links von ihm hinein, statt sie zu kürzen. */}
      <span className="flex-none whitespace-nowrap text-[12.5px] text-accent">{weg} →</span>
    </button>
  );
}

/**
 * Ein Zitat aus den Daten der App · mit Herkunft darüber.
 *
 * Die Herkunft ist nicht Zierrat: Sie sagt, dass der Satz aus der Analyse oder
 * aus der eigenen Notiz stammt und nicht hier entstanden ist.
 */
export function Zitat({ quelle, children }: { quelle: string; children: ReactNode }) {
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
export function Weg({ children, onClick }: { children: ReactNode; onClick: () => void }) {
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

  return (
    <div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-line pb-[5px] text-[12.5px]">
        {vorsatz && <span className="text-ink2">{vorsatz}</span>}
        {woerter.length === 0 && !vorsatz && <span className="text-ink3">{leer}</span>}
        {woerter.map((wort) =>
          onSchreiben ? (
            <button
              key={wort}
              type="button"
              onClick={() => onSchreiben(woerter.filter((value) => value !== wort))}
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
          )
        )}
      </div>
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
 */
export function Verzeichniszeile({
  name,
  zahl,
  aktiv = false,
  tief = 0,
  hoehe = 44,
  onClick,
}: {
  name: ReactNode;
  zahl?: ReactNode;
  aktiv?: boolean;
  /** Einrückung in Stufen · ein Kapitel unter einem Teil. */
  tief?: number;
  hoehe?: number;
  onClick?: () => void;
}) {
  const inhalt = (
    <>
      {aktiv && <span aria-hidden className="absolute inset-y-[7px] -start-3.5 w-[3px] bg-ink" />}
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
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-current={aktiv ? "true" : undefined}
      className={klasse}
      style={{ minHeight: hoehe, paddingInlineStart: tief * 16 }}
    >
      {inhalt}
    </button>
  ) : (
    <div className={klasse} style={{ minHeight: hoehe, paddingInlineStart: tief * 16 }}>
      {inhalt}
    </div>
  );
}

/** Der Teil über den Kapiteln · Beschriftung auf kräftiger Linie. */
export function Verzeichnisteil({ children }: { children: ReactNode }) {
  return <div className="blatt-feld mt-3.5 border-b border-ink pb-[5px] text-ink3">{children}</div>;
}

/**
 * Ein Balken im Formularsatz · Haarlinienrahmen, gefüllt bis zum Wert.
 *
 * Kein Diagrammwerkzeug und keine Farbe: ein Kasten aus einer Linie, gefüllt
 * mit der Schriftfarbe. So liest er sich in jedem der acht Themen gleich.
 */
export function Balken({ anteil, hoehe = 7 }: { anteil: number; hoehe?: number }) {
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
  eintraege: { label: ReactNode; onClick?: () => void; betont?: boolean; titel?: string }[];
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
