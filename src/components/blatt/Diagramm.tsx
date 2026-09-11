/**
 * Das gedruckte Diagramm.
 *
 * Haarlinienrahmen, Koordinaten außerhalb, Bildunterschrift darunter — die
 * Form, in der ein Diagramm in jedem Schachbuch steht. Es ist kein Brett: Man
 * liest es.
 *
 * Ziehen lässt sich daran trotzdem, wenn der Aufrufer einen `zug` mitgibt.
 * Das ist kein Widerspruch, sondern derselbe Griff, den im Blatt auch eine
 * Partiezeile hat: Jede Angabe ist zugleich ein Handgriff. Im Repertoire ist
 * ein Zug auf der Buchstellung eine Absichtserklärung — hier soll etwas ins
 * Buch —, und die darf der Modus nicht verschlucken. Das Diagramm bleibt dabei
 * ein Abdruck: Es wechselt die Feldfarben nicht, und markiert wird gedruckt,
 * mit Rahmen, Punkt und Ring statt mit eingefärbten Flächen.
 *
 * Gedruckt oder gespielt. Genau dieser Unterschied steckt in `live`:
 *
 * · Ein Abdruck (Start, Partien-Eintrag, Repertoire-Buchstellung) nimmt die
 *   gedämpften Feldfarben, die die App für Nebenbretter längst benutzt.
 * · Ein Brett, an dem gezogen wird (Analyse, Endspiele, Puzzles, Repertoire-
 *   Training), nimmt die Feldfarben des Themas — wie heute.
 *
 * Der Unterschied ist sofort zu sehen und sagt dem Nutzer, womit er es zu tun
 * hat. Beides sind Tokens; der Modus tauscht keine Farbe.
 *
 * Die Figuren kommen aus dem Set, das gerade gilt — dieselben Zeichnungen wie
 * auf dem Brett daneben, nicht ein zweiter Satz.
 */
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { fenSquares } from "../../lib/boardSound";
import { usePieceGlyphs } from "../../lib/pieces/usePieceSet";
import { glyphKey } from "../../lib/pieces/sets";
import { PIECE_VIEWBOX } from "../pieceGlyphs";
import "./blatt.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

/**
 * Was ein Diagramm zum Ziehen braucht.
 *
 * Gerechnet wird hier nichts: Welches Feld gewählt ist und wohin es ziehen
 * kann, weiß der Aufrufer (`useBoardSelection` und `moveTargets` in
 * lib/boardMoves) · das Diagramm zeichnet es nur.
 */
export interface DiagrammZug {
  /** Gewähltes Feld · es trägt den kräftigen Rahmen. */
  gewaehlt: string | null;
  /** Felder, auf die der gewählte Stein ziehen kann. */
  ziele: readonly string[];
  /** Davon die, auf denen etwas steht · Ring am Feldrand statt Punkt. */
  schlaege: readonly string[];
  /** Ein Tipp auf ein Feld · dieselbe Folge wie `onSquareClick` am Brett. */
  onFeld: (feld: string) => void;
  /** Gezogen statt getippt · meldet zurück, ob der Zug zulässig war. */
  onZiehen?: (von: string, nach: string) => boolean;
}

export interface DiagrammProps {
  fen: string;
  /**
   * Kantenlänge des Bretts in Bildpunkten. Ohne Angabe nimmt das Diagramm die
   * Breite, die es bekommt, und bleibt quadratisch · so steht es auf dem
   * Telefon, wo die Spalte das Maß vorgibt.
   */
  size?: number | string;
  /** Breite der Koordinatenspalte links · im Entwurf 15 px, mobil 13. */
  gutter?: number;
  orientation?: "white" | "black";
  /** Brett zum Ziehen statt Abdruck · siehe oben. */
  live?: boolean;
  /** Felder, die den letzten Zug tragen · leer lassen heißt: keine Marke. */
  highlight?: readonly string[];
  /** Ohne ihn ist das Diagramm ein reiner Abdruck · siehe oben. */
  zug?: DiagrammZug;
}

/** Welcher Halbzug unter einem Punkt liegt · aus dem Maß des Bretts gerechnet. */
function feldUnter(
  flaeche: DOMRect,
  x: number,
  y: number,
  orientation: "white" | "black"
): string | null {
  if (x < flaeche.left || x > flaeche.right || y < flaeche.top || y > flaeche.bottom) return null;
  const spalte = Math.min(7, Math.max(0, Math.floor(((x - flaeche.left) / flaeche.width) * 8)));
  const zeile = Math.min(7, Math.max(0, Math.floor(((y - flaeche.top) / flaeche.height) * 8)));
  const index = orientation === "white" ? zeile * 8 + spalte : 63 - (zeile * 8 + spalte);
  return `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;
}

/** Ab so vielen Bildpunkten Weg ist es ein Zug und kein Tipp. */
const ZIEH_SCHWELLE = 6;

/**
 * Nur die 64 Felder · ohne Rahmen, Koordinaten und Unterschrift. Sie füllen,
 * was ihnen der Aufrufer an Fläche gibt.
 *
 * Mit `zug` nimmt die Fläche Zeigereingaben an, und zwar beide Gesten, die die
 * gewöhnliche Fassung kennt: tippen–tippen und ziehen. Beides läuft über
 * dieselben Zeigerereignisse, weil sie sich erst am Ende unterscheiden — unter
 * der Schwelle war es ein Tipp, darüber ein Zug. Ein zweites Ereignispaar für
 * Maus und Finger, wie es die Bibliothek des Bretts braucht, gibt es hier
 * nicht: 64 `div` sind kein Brett, sondern ein Raster mit bekanntem Maß, und
 * aus dem Maß folgt das Feld unter dem Zeiger.
 */
export function DiagrammFelder({
  fen,
  orientation = "white",
  live = false,
  highlight,
  zug,
}: Omit<DiagrammProps, "gutter" | "size">) {
  const glyphs = usePieceGlyphs();
  const flaeche = useRef<HTMLDivElement | null>(null);
  /** Was gerade am Zeiger hängt · null, solange nur getippt wird. */
  const [gezogen, setGezogen] = useState<{ von: string; x: number; y: number } | null>(null);
  const start = useRef<{ von: string; x: number; y: number } | null>(null);

  const board = fenSquares(fen) ?? Array.from({ length: 64 }, () => "");
  const marked = new Set(highlight ?? []);
  const ziele = new Set(zug?.ziele ?? []);
  const schlaege = new Set(zug?.schlaege ?? []);
  const light = live ? "var(--color-board-light)" : "var(--color-board-light-muted)";
  const dark = live ? "var(--color-board-dark)" : "var(--color-board-dark-muted)";
  const order = orientation === "white" ? board : [...board].reverse();

  const feldAus = (event: PointerEvent<HTMLDivElement>) => {
    const rect = flaeche.current?.getBoundingClientRect();
    return rect ? feldUnter(rect, event.clientX, event.clientY, orientation) : null;
  };

  const beginn = (event: PointerEvent<HTMLDivElement>) => {
    if (!zug || (event.pointerType === "mouse" && event.button !== 0)) return;
    const feld = feldAus(event);
    if (!feld) return;
    start.current = { von: feld, x: event.clientX, y: event.clientY };
    // Der Zeiger bleibt an der Fläche, auch wenn der Finger sie verlässt ·
    // fehlt die Methode (Testumgebung), zieht es eben ohne Fang.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ohne Zeigerfang weiter */
    }
  };

  const bewegen = (event: PointerEvent<HTMLDivElement>) => {
    const angefangen = start.current;
    if (!zug?.onZiehen || !angefangen) return;
    const weg = Math.hypot(event.clientX - angefangen.x, event.clientY - angefangen.y);
    if (!gezogen && weg < ZIEH_SCHWELLE) return;
    // Solange gezogen wird, gehört die Geste dem Diagramm · sonst scrollt die
    // Seite unter dem Finger weg.
    event.preventDefault();
    setGezogen({ von: angefangen.von, x: event.clientX, y: event.clientY });
  };

  const ende = (event: PointerEvent<HTMLDivElement>) => {
    const angefangen = start.current;
    start.current = null;
    const zogGerade = gezogen != null;
    setGezogen(null);
    if (!zug || !angefangen) return;
    const feld = feldAus(event);
    // Unter der Schwelle geblieben: ein Tipp, und der geht denselben Weg wie
    // ein Klick auf dem Brett · erst die eigene Figur, dann das Zielfeld.
    if (!zogGerade || !feld || feld === angefangen.von) {
      zug.onFeld(angefangen.von);
      return;
    }
    if (!zug.onZiehen?.(angefangen.von, feld)) zug.onFeld(angefangen.von);
  };

  /** Die Figur am Zeiger · nur während eines Zuges, und nie klickbar. */
  const schleppe = (() => {
    if (!gezogen) return null;
    const rect = flaeche.current?.getBoundingClientRect();
    const index = board.findIndex(
      (_, i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}` === gezogen.von
    );
    const glyph = index >= 0 && board[index] ? glyphs[glyphKey(board[index])] : undefined;
    if (!rect || !glyph) return null;
    const kante = rect.width / 8;
    return (
      <svg
        viewBox={PIECE_VIEWBOX}
        aria-hidden="true"
        className="pointer-events-none fixed z-50"
        style={{
          width: kante,
          height: kante,
          left: gezogen.x - kante / 2,
          top: gezogen.y - kante / 2,
        }}
        // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
        dangerouslySetInnerHTML={{ __html: glyph }}
      />
    );
  })();

  return (
    <div
      ref={flaeche}
      // Kein `touch-none` an der ganzen Fläche · das Stylesheet regelt das
      // längst feiner (siehe `.kiebitz-board [data-piece]` in index.css): An
      // einer Figur gehört die Geste dem Brett, über einem leeren Feld bleibt
      // sie der Seite, damit man am Diagramm vorbeiscrollen kann.
      className={`kiebitz-board grid h-full w-full ${zug ? "cursor-pointer" : ""}`}
      style={{ gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr)" }}
      onPointerDown={zug ? beginn : undefined}
      onPointerMove={zug ? bewegen : undefined}
      onPointerUp={zug ? ende : undefined}
      onPointerCancel={
        zug
          ? () => {
              start.current = null;
              setGezogen(null);
            }
          : undefined
      }
    >
      {order.map((piece, index) => {
        const boardIndex = orientation === "white" ? index : 63 - index;
        const file = FILES[boardIndex % 8];
        const rank = 8 - Math.floor(boardIndex / 8);
        const square = `${file}${rank}`;
        const isLight = (Math.floor(boardIndex / 8) + (boardIndex % 8)) % 2 === 0;
        const glyph = piece ? glyphs[glyphKey(piece)] : undefined;
        const amZeiger = gezogen?.von === square;
        return (
          <div
            key={square}
            data-square={square}
            className="relative"
            style={{ background: isLight ? light : dark }}
          >
            {/* Der letzte Zug bekommt keine Fläche, sondern einen Rahmen ·
                eine eingefärbte Fläche nähme dem Abdruck die Ruhe, und im
                Druck markiert man mit einem Kasten. Das gewählte Feld trägt
                denselben Kasten, nur kräftiger: Es ist dieselbe Art Auskunft,
                nur die, die gerade zählt. */}
            {(marked.has(square) || zug?.gewaehlt === square) && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 border border-ink"
                style={zug?.gewaehlt === square ? { borderWidth: 2 } : undefined}
              />
            )}
            {/* Zielfelder: Punkt, wo nichts steht, Ring, wo etwas zu holen ist
                · dieselbe Unterscheidung wie am Brett (lib/boardMoves), nur in
                der Tinte des Blattes statt im Grün der Oberfläche. Der Ring
                liegt am Feldrand, damit die Figur darunter sichtbar bleibt. */}
            {ziele.has(square) &&
              (schlaege.has(square) ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-[5%] rounded-full border-[3px] border-ink2/70"
                />
              ) : (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-[39%] rounded-full bg-ink2/70"
                />
              ))}
            {glyph && !amZeiger && (
              <svg
                viewBox={PIECE_VIEWBOX}
                className="h-full w-full"
                aria-hidden="true"
                // Dieselbe Kennung wie am Brett · das Stylesheet hängt die
                // Zeigergeste daran fest (siehe index.css).
                data-piece={zug ? "" : undefined}
                // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
                dangerouslySetInnerHTML={{ __html: glyph }}
              />
            )}
          </div>
        );
      })}
      {schleppe}
    </div>
  );
}

/**
 * Das Diagramm mit Rahmen und Koordinaten · ohne Bildunterschrift.
 *
 * Ohne `size` nimmt es die Breite, die es bekommt, und bleibt quadratisch ·
 * das ist der Fall auf dem Telefon, wo die Spalte die Größe vorgibt. Mit
 * `size` steht es auf dem angegebenen Maß, wie im Entwurf für den Rechner.
 */
export function Diagramm({
  fen,
  size,
  gutter = 15,
  orientation = "white",
  live = false,
  highlight,
  zug,
}: DiagrammProps) {
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();
  const files = orientation === "white" ? FILES : [...FILES].reverse();
  return (
    // Ein Diagramm sieht in jeder Sprache gleich aus · Koordinaten links,
    // a bis h von links nach rechts. `.kiebitz-board` hält die Felder selbst
    // schon von links nach rechts; hier geht es um den Rahmen darum.
    <div
      dir="ltr"
      className={`flex flex-col ${size == null ? "w-full" : "items-center"}`}
    >
      <div className="flex">
        {/* Ohne eigene Höhe · die Spalte zieht sich auf die des Bretts. */}
        <div
          className="blatt-zahl flex flex-col text-[9.5px] text-ink3"
          style={{ width: gutter, flex: "none" }}
          aria-hidden
        >
          {ranks.map((rank) => (
            <span key={rank} className="flex flex-1 items-center justify-center">
              {rank}
            </span>
          ))}
        </div>
        {/* Der Rahmen liegt auf dem Maß, nicht darum herum · sonst stünden
            die Koordinaten daneben um zwei Bildpunkte versetzt. */}
        <div
          className={`border border-ink ${size == null ? "aspect-square min-w-0 flex-1" : ""}`}
          style={size == null ? undefined : { width: size, height: size }}
        >
          <DiagrammFelder
            fen={fen}
            orientation={orientation}
            live={live}
            highlight={highlight}
            zug={zug}
          />
        </div>
      </div>
      <div
        className="blatt-zahl flex pt-1 text-[9.5px] text-ink3"
        style={{ marginLeft: gutter, width: size }}
        aria-hidden
      >
        {files.map((file) => (
          <span key={file} className="flex-1 text-center">
            {file}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Die Bildunterschrift unter einem Diagramm.
 *
 * Nummer, Titelzeile, kursive Beizeile, und darunter, wer am Zug ist — die
 * Reihenfolge, in der eine Bildunterschrift im Schachbuch steht. Sie ist so
 * breit wie das Brett und um die Koordinatenspalte eingerückt, damit sie
 * darunter bündig sitzt und nicht über sie hinausragt.
 */
export function Bildunterschrift({
  nummer,
  zeilen,
  amZug,
  breite,
  gutter = 15,
}: {
  nummer: string;
  /**
   * Erste Zeile trägt den Titel, weitere stehen kursiv darunter. Kein reiner
   * Text: In der Titelzeile kann ein Name zugleich ein Filtergriff sein.
   */
  zeilen: readonly ReactNode[];
  amZug?: { farbe: "white" | "black"; text: string };
  breite?: number | string;
  gutter?: number;
}) {
  return (
    // Der Einzug ist physisch links, nicht „am Anfang": Er richtet die
    // Unterschrift auf ein Diagramm aus, das in jeder Sprache von links nach
    // rechts steht.
    <div className="buch pt-[13px] text-center" style={{ marginLeft: gutter, width: breite }}>
      <div className="blatt-feld tracking-[0.18em] text-ink3">{nummer}</div>
      {zeilen.map((zeile, index) => (
        <div
          key={index}
          className={
            index === 0 ? "mt-[7px] text-[14px] text-ink" : "mt-[3px] text-[13px] italic text-ink2"
          }
        >
          {zeile}
        </div>
      ))}
      {amZug && (
        <div className="mt-2 flex items-center justify-center gap-[7px] text-[13px] text-ink">
          <span
            aria-hidden
            className="inline-block h-[9px] w-[9px] flex-none border border-ink"
            style={{ background: amZug.farbe === "black" ? "var(--color-ink)" : "transparent" }}
          />
          <span>{amZug.text}</span>
        </div>
      )}
    </div>
  );
}
