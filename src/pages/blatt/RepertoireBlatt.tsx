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
 *
 * ── Was am Verzeichnis zu tun ist ──────────────────────────────────────────
 *
 * Ein Inhaltsverzeichnis ist zuerst zum Lesen da, und deshalb standen die drei
 * Handgriffe der gewöhnlichen Fassung — verschieben, ändern, wegnehmen — hier
 * lange nicht. Das war kein Satz, sondern ein Verlust: Wer den Modus
 * einschaltete, konnte eine Variante nur noch ansehen. Sie stehen jetzt am
 * Zeilenende, aber nicht als drei Knöpfe an jeder Zeile: sichtbar werden sie
 * an der aufgeschlagenen Zeile und unter dem Zeiger, ihr Platz bleibt immer
 * stehen, damit die Punktlinie beim Überfahren nicht springt.
 *
 * Verschoben wird mit demselben Griff wie drüben — ziehen oder ↑/↓. Die Zeilen
 * eines Teils sind alle gleich hoch, und darum braucht das Ziehen hier keine
 * gemessenen Zeilenhöhen: Der Weg des Zeigers geteilt durch die Zeilenhöhe ist
 * die Zahl der Plätze.
 *
 * ── Blättern in der Linie ──────────────────────────────────────────────────
 *
 * ←/→ gehen durch die Züge der gewählten Variante, ↑/↓ zur nächsten. Die Seite
 * rechnet dafür nichts Eigenes: Ein Halbzug weiter ist derselbe `onZug`, den
 * auch der Klick auslöst, und der Abdruck in der Mitte folgt ihm, weil er die
 * Stellung des gewählten Knotens zeigt. Damit blättert man eine Variante durch
 * wie eine Seite im Buch, statt sie nur als Ganzes anzusehen.
 */
import {
  Fragment,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
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
  /** Halbzüge der Linie · die Grenze, bis zu der ←/→ blättern. */
  zuege: number;
}

export interface BuchTeil {
  titel: string;
  /** Für welche Farbe der Teil geführt wird · die Reihenfolge gilt je Seite. */
  seite: "white" | "black";
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
  /**
   * Für welche Farbe das Buch an dieser Stelle geführt wird · nicht, wer am
   * Zug ist. Ein Schwarzrepertoire liest man von unten aus Schwarzsicht, sonst
   * steht die eigene Vorbereitung auf dem Kopf. Die gewöhnliche Fassung dreht
   * das Brett längst so (siehe `orientation` in pages/Repertoire.tsx).
   */
  seite: "white" | "black";
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
  /** Halbzug, der gerade aufgeschlagen ist · −1 ist die Grundstellung. */
  aktivZug: number;
  onWaehlen: (key: string) => void;
  /** Eine Variante an einem bestimmten Halbzug aufschlagen. */
  onZug: (key: string, zug: number) => void;
  /**
   * Neue Reihenfolge eines Teils · dieselben Schlüssel, anders sortiert. Ohne
   * den Handler gibt es keine Griffe (die Web-Vorschau ist fest).
   */
  onVerschieben?: (seite: "white" | "black", keys: string[]) => void;
  onBearbeiten?: (key: string) => void;
  onLoeschen?: (key: string) => void;
  onHinzufuegen: () => void;
  onTraining: () => void;
}

/** Was gerade am Zeiger hängt · Teil, Herkunft, Ziel und der Weg dorthin. */
interface Ziehen {
  seite: "white" | "black";
  von: number;
  nach: number;
  dy: number;
  startY: number;
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
  seite,
  linie,
  angaben,
  notiz,
  notizPlatzhalter,
  abdeckung,
  abdeckungNote,
  abdeckungUnter,
  luecken,
  aktivZug,
  onWaehlen,
  onZug,
  onVerschieben,
  onBearbeiten,
  onLoeschen,
  onHinzufuegen,
  onTraining,
}: RepertoireBlattProps) {
  const { t } = useI18n();
  const knopfRefs = useRef(new Map<string, HTMLButtonElement>());
  const [ziehen, setZiehen] = useState<Ziehen | null>(null);
  const zeilenHoehe = mobile ? 46 : 44;

  /** Alle Varianten in der Reihenfolge, in der sie im Verzeichnis stehen. */
  const alle = teile.flatMap((teil) =>
    teil.zeilen.map((zeile) => ({ ...zeile, seite: teil.seite }))
  );

  const verschieben = (seite: "white" | "black", von: number, nach: number) => {
    const teil = teile.find((eintrag) => eintrag.seite === seite);
    if (!onVerschieben || !teil) return;
    if (von === nach || nach < 0 || nach >= teil.zeilen.length) return;
    const keys = teil.zeilen.map((zeile) => zeile.key);
    keys.splice(nach, 0, ...keys.splice(von, 1));
    onVerschieben(seite, keys);
  };

  const beginnZiehen = (
    event: PointerEvent<HTMLButtonElement>,
    seite: "white" | "black",
    index: number
  ) => {
    if (!onVerschieben || ziehen || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    // Der Zeiger bleibt am Griff, auch wenn der Finger die Zeile verlässt ·
    // fehlt die Methode (Testumgebung), zieht die Zeile eben ohne Fang.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ohne Zeigerfang weiterziehen */
    }
    setZiehen({ seite, von: index, nach: index, dy: 0, startY: event.clientY });
  };

  const beimZiehen = (event: PointerEvent<HTMLButtonElement>) => {
    const y = event.clientY;
    setZiehen((stand) => {
      if (!stand) return stand;
      const teil = teile.find((eintrag) => eintrag.seite === stand.seite);
      const anzahl = teil?.zeilen.length ?? 0;
      // Alle Zeilen eines Teils sind gleich hoch · der Weg des Zeigers geteilt
      // durch die Zeilenhöhe ist die Zahl der Plätze, um die es geht.
      const dy = Math.max(
        -stand.von * zeilenHoehe,
        Math.min((anzahl - 1 - stand.von) * zeilenHoehe, y - stand.startY)
      );
      const nach = Math.max(
        0,
        Math.min(anzahl - 1, stand.von + Math.round(dy / zeilenHoehe))
      );
      return { ...stand, dy, nach };
    });
  };

  const endeZiehen = () => {
    if (!ziehen) return;
    verschieben(ziehen.seite, ziehen.von, ziehen.nach);
    setZiehen(null);
  };

  const tasten = (event: KeyboardEvent<HTMLButtonElement>, zeile: BuchZeile) => {
    const index = alle.findIndex((eintrag) => eintrag.key === zeile.key);
    const jetzt = aktiv === zeile.key ? aktivZug : zeile.zuege - 1;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const schritt = event.key === "ArrowUp" ? -1 : 1;
      const ziel = alle[Math.max(0, Math.min(alle.length - 1, index + schritt))];
      if (!ziel) return;
      onZug(ziel.key, ziel.zuege - 1);
      knopfRefs.current.get(ziel.key)?.focus();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const schritt = event.key === "ArrowLeft" ? -1 : 1;
      onZug(zeile.key, Math.max(-1, Math.min(zeile.zuege - 1, jetzt + schritt)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onZug(zeile.key, event.key === "Home" ? -1 : zeile.zuege - 1);
    }
  };

  /**
   * Die Handgriffe am Zeilenende.
   *
   * Ihr Platz steht immer, sichtbar sind sie an der aufgeschlagenen Zeile und
   * unter dem Zeiger · sonst spränge die Punktlinie beim Überfahren.
   */
  const griffe = (teil: BuchTeil, zeile: BuchZeile, index: number) => {
    if (!onVerschieben && !onBearbeiten && !onLoeschen) return undefined;
    const gehalten = ziehen?.seite === teil.seite && ziehen.von === index;
    const sicht =
      zeile.key === aktiv || gehalten
        ? ""
        : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";
    const knopf = "flex w-[26px] flex-none items-center justify-center border-s border-line";
    return (
      <span className={`flex flex-none items-stretch ${sicht}`}>
        {onVerschieben && (
          <button
            type="button"
            aria-label={t("rep.reorderHandle", { name: zeile.name })}
            title={t("rep.reorderHandle", { name: zeile.name })}
            onPointerDown={(event) => beginnZiehen(event, teil.seite, index)}
            onPointerMove={beimZiehen}
            onPointerUp={endeZiehen}
            onPointerCancel={endeZiehen}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              verschieben(teil.seite, index, index + (event.key === "ArrowUp" ? -1 : 1));
            }}
            className={`${knopf} touch-none ${gehalten ? "text-ink" : "text-ink3 hover:text-ink"}`}
          >
            <GripVertical aria-hidden size={13} />
          </button>
        )}
        {onBearbeiten && (
          <button
            type="button"
            aria-label={t("rep.editLine", { name: zeile.name })}
            title={t("rep.editVariant")}
            onClick={() => onBearbeiten(zeile.key)}
            className={`${knopf} text-ink3 hover:text-ink`}
          >
            <Pencil aria-hidden size={13} />
          </button>
        )}
        {onLoeschen && (
          <button
            type="button"
            aria-label={t("rep.deleteLine", { name: zeile.name })}
            title={t("rep.deleteVariant")}
            onClick={() => onLoeschen(zeile.key)}
            className={`${knopf} text-ink3 hover:text-loss`}
          >
            <Trash2 aria-hidden size={13} />
          </button>
        )}
      </span>
    );
  };

  /** Der Strich, der zeigt, wo die gegriffene Variante landet. */
  const marke = (teil: BuchTeil, platz: number) => {
    if (!ziehen || ziehen.seite !== teil.seite || ziehen.nach === ziehen.von) return null;
    const ziel = ziehen.nach > ziehen.von ? ziehen.nach + 1 : ziehen.nach;
    if (ziel !== platz) return null;
    return <div aria-hidden className="h-px bg-ink" />;
  };

  const buch = (
    <div className={mobile ? "flex flex-col" : "flex w-[330px] flex-none flex-col"}>
      <Rubrik weg={t("rep.addLine")} onWeg={onHinzufuegen}>
        {t("blatt.theBook")}
      </Rubrik>
      {teile.map((teil) => (
        <div key={teil.titel} className={ziehen?.seite === teil.seite ? "select-none" : ""}>
          <Verzeichnisteil>{teil.titel}</Verzeichnisteil>
          {teil.zeilen.map((zeile, index) => {
            const gehalten = ziehen?.seite === teil.seite && ziehen.von === index;
            return (
              <Fragment key={zeile.key}>
                {marke(teil, index)}
                <div
                  className={gehalten ? "relative z-10" : ""}
                  style={gehalten ? { transform: `translateY(${ziehen.dy}px)` } : undefined}
                >
                  <Verzeichniszeile
                    name={zeile.name}
                    zahl={zeile.faellig > 0 ? deInt(zeile.faellig) : ""}
                    aktiv={zeile.key === aktiv}
                    hoehe={zeilenHoehe}
                    onClick={() => onWaehlen(zeile.key)}
                    onKeyDown={(event) => tasten(event, zeile)}
                    knopfRef={(element) => {
                      if (element) knopfRefs.current.set(zeile.key, element);
                      else knopfRefs.current.delete(zeile.key);
                    }}
                    griffe={griffe(teil, zeile, index)}
                  />
                </div>
              </Fragment>
            );
          })}
          {marke(teil, teil.zeilen.length)}
        </div>
      ))}
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-[1.6] text-ink3">
        {t("blatt.bookNumberNote")}
        <span className="mt-1 block">{t("rep.variationKeys")}</span>
      </div>
    </div>
  );

  // Der Abdruck ist so groß wie ein Brett in der gewöhnlichen Fassung ·
  // `--board-edge` ist dasselbe Maß, das dort die Spalte deckelt. Ohne `size`
  // nimmt das Diagramm die Breite, die es bekommt, und bleibt quadratisch;
  // die Hülle gibt sie vor, und die Bildunterschrift folgt ihr.
  const diagrammBlock = (
    <div className={mobile ? "" : "w-[var(--board-edge)] max-w-full flex-none"}>
      <Diagramm fen={fen} orientation={seite} />
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
