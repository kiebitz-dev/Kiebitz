/**
 * Die Informator-Zeichen im Satz des Blattes.
 *
 * Drei Teile: das Zeichen selbst (`Glyphe`), die Ebene, die sie auf die 64
 * Felder eines Bretts legt (`Zeichenebene`), und der Schlüssel darunter
 * (`Zeichenschluessel`), wie ihn jeder Informator-Band vorn trägt.
 *
 * Gezeichnet wird jedes Zeichen als Linie und nicht als Schriftzeichen. △, ⩲
 * oder ⊕ stehen in Source Serif 4 nicht, und die Ersatzschriften der Systeme
 * setzen sie in drei verschiedenen Größen und Strichstärken · ein Diagramm,
 * das auf jedem Gerät anders gedruckt ist, ist kein Abdruck mehr. Nur die
 * Urteile (?, ??, ?!) sind Buchstaben: Die hat jede Schrift.
 *
 * Kein Farbwert · Tinte ist `--color-ink`, das Urteil trägt die Farbe, die
 * die Partienotation dafür schon hat.
 *
 * Gerechnet wird hier nichts. Welche Zeichen eine Stellung trägt, hat die
 * Analyse entschieden (`src-tauri/src/informator.rs`, `lib/informator.ts`).
 */
import type { ReactNode } from "react";
import { useBoardSigns } from "../../lib/boardSigns";
import { fenSquares } from "../../lib/boardSound";
import { useI18n } from "../../lib/i18n";
import {
  brettZeichen,
  randZeichen,
  schluesselFolge,
  type InformatorZeichen,
  type ZeichenArt,
} from "../../lib/informator";
import { translateSan } from "../../lib/notation";
import type { Key } from "../../lib/locales/de";
import "./blatt.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** Die Linien eines Zeichens im Raster 24 × 24 · Strich, keine Fläche. */
function Linien({ art, wert }: { art: ZeichenArt; wert?: string }): ReactNode {
  const plus = (y: number) => (
    <>
      <path d={`M7 ${y}h10`} />
      <path d={`M12 ${y - 5}v10`} />
    </>
  );
  const minus = (y: number) => <path d={`M7 ${y}h10`} />;
  switch (art) {
    case "idea":
      return <path d="M12 4 21 19H3Z" />;
    case "against":
      return <path d="M3 5h18L12 20Z" />;
    case "attack":
      return <path d="M3 12h17M14 6l6 6-6 6" />;
    case "file":
      return <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />;
    case "diagonal":
      return <path d="M5 19 19 5M11 5h8v8" />;
    case "bishop_pair":
      return <path d="M4 8h11v11H4ZM9 4h11v11" />;
    case "opposite_bishops":
      return (
        <>
          <path d="M4 4h16v16H4Z" />
          <path d="M4 4h16L4 20Z" fill="currentColor" stroke="none" />
        </>
      );
    case "same_bishops":
      return (
        <>
          <path d="M4 4h16v16H4Z" />
          <path d="M8 8h8v8H8Z" fill="currentColor" stroke="none" />
        </>
      );
    case "passed":
      return <path d="M12 21V5M7 10l5-5 5 5M6 3h12" />;
    case "doubled":
      return (
        <>
          <circle cx="12" cy="7.5" r="3.5" />
          <circle cx="12" cy="16.5" r="3.5" />
        </>
      );
    case "ending":
      return <path d="M12 4v16M5 20h14" />;
    case "time_trouble":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 6v12M6 12h12" />
        </>
      );
    case "eval":
      switch (wert) {
        case "=":
          return <path d="M6 9h12M6 15h12" />;
        case "+=":
          return (
            <>
              {plus(7)}
              <path d="M7 15h10M7 19.5h10" />
            </>
          );
        case "=+":
          return (
            <>
              <path d="M7 4.5h10M7 9h10" />
              {plus(17)}
            </>
          );
        case "+/-":
          return (
            <>
              {plus(8)}
              {minus(18)}
            </>
          );
        case "-/+":
          return (
            <>
              {minus(6)}
              {plus(16)}
            </>
          );
        case "+-":
          return <path d="M2 12h8M6 8v8M14 12h8" />;
        case "-+":
          return <path d="M2 12h8M14 12h8M18 8v8" />;
        default:
          return null;
      }
    default:
      return null;
  }
}

/** Ein Zeichen · als Linie, das Urteil als Buchstabe. */
export function Glyphe({
  zeichen,
  groesse = 14,
  rand = false,
}: {
  zeichen: Pick<InformatorZeichen, "kind" | "value">;
  groesse?: number | string;
  /**
   * Ein Rand in Papierfarbe unter der Linie · für Zeichen, die frei auf einem
   * Feld stehen. Tinte allein verschwindet auf dem Feld, das ihr am nächsten
   * ist: im dunklen Thema auf den hellen Feldern, im hellen auf den dunklen.
   */
  rand?: boolean;
}) {
  if (zeichen.kind === "nag") {
    return (
      <span
        className="buch inline-flex items-center justify-center font-semibold leading-none"
        style={{
          color: "var(--color-loss)",
          fontSize: typeof groesse === "number" ? groesse * 0.95 : groesse,
          minWidth: groesse,
          height: groesse,
        }}
      >
        {zeichen.value}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={groesse}
      height={groesse}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block flex-none"
    >
      {rand && (
        <g stroke="var(--color-bg)" strokeWidth={5.5} opacity={0.85}>
          <Linien art={zeichen.kind} wert={zeichen.value} />
        </g>
      )}
      <Linien art={zeichen.kind} wert={zeichen.value} />
    </svg>
  );
}

/**
 * Die vier Ecken eines Feldes · in dieser Reihenfolge besetzt.
 *
 * Oben rechts zuerst, obwohl dort auch der Marker der Auto-Analyse sitzt
 * („!!", „?"): Den gibt es auf genau einem Feld, dem Zielfeld des letzten
 * Zuges. Oben links stehen dagegen auf einer ganzen Linie die Ziffern der
 * Koordinaten. Deshalb weicht nur das eine Feld mit Marker aus, siehe
 * `MIT_MARKE`, statt dass alle anderen in die Ziffern rücken.
 */
const ECKEN = [
  { top: "3%", right: "3%" },
  { top: "3%", left: "3%" },
  { bottom: "3%", right: "3%" },
  { bottom: "3%", left: "3%" },
] as const;

/** Die Ecken des Feldes, auf dem der Marker steht · oben rechts ist belegt. */
const MIT_MARKE = [ECKEN[1], ECKEN[3], ECKEN[2]] as const;

/**
 * Die Zeichen auf den 64 Feldern · eine Ebene über einem Brett.
 *
 * Sie füllt ihre Fläche und rechnet die Felder aus der Ausrichtung, genau wie
 * das Diagramm selbst · deshalb liegt sie auf dem gedruckten Diagramm ebenso
 * wie auf dem Brett der Analyse, das eine andere Bibliothek zeichnet.
 *
 * Auf einem leeren Feld steht ein einzelnes Zeichen groß in der Mitte, wie im
 * Buch das △ auf d4. Wo eine Figur steht oder mehrere Zeichen zusammenkommen,
 * rücken sie klein in die Ecken, auf einem Kästchen aus Papier: Die Figur
 * bleibt lesbar, und das Zeichen auch.
 */
export function Zeichenebene({
  zeichen,
  fen,
  orientation = "white",
  marke,
}: {
  zeichen: readonly InformatorZeichen[];
  fen: string;
  orientation?: "white" | "black";
  /** Das Feld mit dem Marker der Auto-Analyse · dort bleibt oben rechts frei. */
  marke?: string;
}) {
  const an = useBoardSigns();
  const felder = brettZeichen(zeichen);
  if (!an || felder.size === 0) return null;
  const board = fenSquares(fen) ?? [];
  return (
    <div
      aria-hidden="true"
      data-testid="informator-ebene"
      className="pointer-events-none absolute inset-0 z-[15]"
      dir="ltr"
    >
      {[...felder.entries()].map(([feld, liste]) => {
        const datei = FILES.indexOf(feld[0] as (typeof FILES)[number]);
        const rang = Number(feld[1]);
        if (datei < 0 || !(rang >= 1 && rang <= 8)) return null;
        const spalte = orientation === "white" ? datei : 7 - datei;
        const zeile = orientation === "white" ? 8 - rang : rang - 1;
        const besetzt = Boolean(board[(8 - rang) * 8 + datei]);
        const mitte = !besetzt && liste.length === 1;
        const ecken = feld === marke ? MIT_MARKE : ECKEN;
        return (
          <div
            key={feld}
            data-informator-feld={feld}
            className="absolute text-ink"
            style={{
              left: `${spalte * 12.5}%`,
              top: `${zeile * 12.5}%`,
              width: "12.5%",
              height: "12.5%",
            }}
          >
            {mitte ? (
              <span className="absolute inset-[18%] flex items-center justify-center">
                <Glyphe zeichen={liste[0]} groesse="100%" rand />
              </span>
            ) : (
              liste.slice(0, ecken.length).map((z, index) => (
                <span
                  key={`${z.kind}-${index}`}
                  className="absolute flex h-[40%] min-w-[40%] items-center justify-center border border-ink bg-bg px-[1px]"
                  style={ecken[index]}
                >
                  <Glyphe zeichen={z} groesse="82%" />
                </span>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

const BEWERTUNG: Record<string, Key> = {
  "=": "inf.eval.equal",
  "+=": "inf.eval.whiteSlightly",
  "=+": "inf.eval.blackSlightly",
  "+/-": "inf.eval.whiteClearly",
  "-/+": "inf.eval.blackClearly",
  "+-": "inf.eval.whiteDecisive",
  "-+": "inf.eval.blackDecisive",
};

const URTEIL: Record<string, Key> = {
  "?!": "inf.nag.dubious",
  "?": "inf.nag.mistake",
  "??": "inf.nag.blunder",
};

/** Die Bedeutung eines Zeichens als Satz · für den Schlüssel und die Tooltips. */
function useZeichenText(): (z: InformatorZeichen) => string | null {
  const { t, locale } = useI18n();
  const felder = (liste?: string[]) => (liste ?? []).join(", ");
  const seite = (side?: "w" | "b") => t(side === "b" ? "common.black" : "common.white");
  const text = (z: InformatorZeichen): string | null => {
    switch (z.kind) {
      case "eval":
        return z.value && BEWERTUNG[z.value] ? t(BEWERTUNG[z.value]) : null;
      case "nag":
        return z.value && URTEIL[z.value] ? t(URTEIL[z.value], { square: felder(z.squares) }) : null;
      case "idea":
        return t("inf.idea", { san: z.san ? translateSan(z.san, locale) : felder(z.squares) });
      case "attack":
        return t("inf.attack", { san: z.san ? translateSan(z.san, locale) : felder(z.squares) });
      case "against":
        return t("inf.against", { squares: felder(z.squares) });
      case "file":
        return t("inf.file", { squares: felder(z.squares) });
      case "diagonal":
        return t("inf.diagonal", { squares: felder(z.squares) });
      case "bishop_pair":
        return t("inf.bishopPair", { side: seite(z.side) });
      case "opposite_bishops":
        return t("inf.oppositeBishops");
      case "same_bishops":
        return t("inf.sameBishops");
      case "passed":
        return t("inf.passed", { squares: felder(z.squares) });
      case "doubled":
        return t("inf.doubled", { squares: felder(z.squares) });
      case "ending":
        return t("inf.ending");
      case "time_trouble":
        return t("inf.timeTrouble", { side: seite(z.side) });
      default:
        return null;
    }
  };
  return text;
}

/**
 * Der Zeichenschlüssel · je Zeichen eine Zeile, Zeichen links, Bedeutung
 * kursiv daneben. Er nennt nur, was auf dieser Stellung wirklich steht ·
 * ein Band druckt den ganzen Schlüssel einmal vorn, eine Seite nicht.
 */
export function Zeichenschluessel({
  zeichen,
  titel = true,
}: {
  zeichen: readonly InformatorZeichen[];
  /** Die Kolumne „Zeichenschlüssel" darüber · fehlt, wo schon eine Rubrik steht. */
  titel?: boolean;
}) {
  const { t } = useI18n();
  const text = useZeichenText();
  if (zeichen.length === 0) return null;
  const zeilen = schluesselFolge(zeichen)
    .map((z) => ({ z, text: text(z) }))
    .filter((zeile): zeile is { z: InformatorZeichen; text: string } => Boolean(zeile.text));
  if (zeilen.length === 0) return null;
  return (
    <div data-testid="informator-schluessel">
      {titel && <div className="blatt-feld text-ink3">{t("inf.key")}</div>}
      <ul className={`${titel ? "mt-1.5" : ""} flex flex-col gap-[3px]`}>
        {zeilen.map(({ z, text: bedeutung }, index) => (
          <li key={`${z.kind}-${index}`} className="flex items-center gap-2 text-ink">
            <span className="flex w-[18px] flex-none justify-center">
              <Glyphe zeichen={z} groesse={14} />
            </span>
            <span className="buch min-w-0 text-[12.5px] italic leading-[1.35] text-ink2">{bedeutung}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Die Zeichen ohne Feld · am Rand des Bretts, klein wie im Buch unter dem
 * Diagramm. Bewertung, Läuferfarben und Endspiel stehen unter dem Brett, das
 * Läuferpaar und die Zeitnot an der Seite, die sie betreffen. Hängt an
 * derselben Einstellung wie die Zeichen auf den Feldern.
 */
export function Randzeichen({
  zeichen,
  teil,
}: {
  zeichen: readonly InformatorZeichen[];
  teil: "weiss" | "schwarz" | "stellung";
}) {
  const an = useBoardSigns();
  const text = useZeichenText();
  const liste = randZeichen(zeichen)[teil];
  if (!an || liste.length === 0) return null;
  return (
    <span data-testid={`informator-rand-${teil}`} className="flex flex-none items-center gap-1.5 text-ink">
      {liste.map((z, index) => {
        const bedeutung = text(z) ?? undefined;
        return (
          <span key={`${z.kind}-${index}`} title={bedeutung} className="inline-flex">
            <Glyphe zeichen={z} groesse={15} />
            {bedeutung && <span className="sr-only">{bedeutung}</span>}
          </span>
        );
      })}
    </span>
  );
}
