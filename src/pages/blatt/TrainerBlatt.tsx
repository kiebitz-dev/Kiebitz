/**
 * Das Repertoire-Training im Diagramm-Modus · der Übungsbogen.
 *
 * Der Trainer war bis 1.4 die eine Stelle, an der der Modus einfach aufhörte:
 * Das Buch stand als Buch da, das Verzeichnis als Verzeichnis — und wer auf
 * „Training starten" tippte, bekam ohne Übergang die gewöhnliche Fassung mit
 * ihren Karten und Knöpfen. Ein Modus, der beim eigentlichen Tun abbricht, ist
 * kein zweiter Satz derselben App, sondern eine halbe Oberfläche.
 *
 * Gesetzt ist er wie die beiden anderen Übungsseiten (Endspiele, Puzzles), und
 * aus demselben Grund: Hier wird gezogen, also ist das Brett ein Brett mit den
 * Feldfarben des Themas und kein Abdruck. Es kommt fertig von der Seite herein,
 * mit Zug, Hervorhebung und Drehung.
 *
 * Zwei Zustände, ein Bogen:
 *
 * · Die Karte (`aufgabe`). Kopf mit Variante, Farbe und Kartenzahl, das Brett
 *   links, rechts die Frage, der Sitzungsstand und die Notiz.
 * · Das Ende (`ende`). Auch ein leerer Stapel ist eine Seite des Buches — sie
 *   trägt denselben Kolumnentitel und sagt in einem Satz, was die Sitzung
 *   gebracht hat.
 *
 * Gerechnet wird hier nichts. Der Stapel, die Noten und der Lernstand liegen
 * in `components/RepertoireTrainer.tsx`; diese Datei ist eine zweite Art, sie
 * zu zeigen.
 */
import type { ReactNode } from "react";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Fussnote,
  Kolumnentitel,
  Rubrik,
  Schalterreihe,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";

/** Ein Schalter der Haarlinienreihe · dieselbe Form wie in den Nachbarblättern. */
interface Schalter {
  label: ReactNode;
  onClick?: () => void;
  betont?: boolean;
  titel?: string;
}

/** Woran die Meldung unter dem Brett ihre Farbe nimmt. */
export type Tonart = "offen" | "richtig" | "falsch";

export interface TrainerAufgabe {
  felder: Feld[];
  /** Der Sitzungsstand im Kasten rechts · „3 : 1". */
  stand: string;
  oben: { name: string; farbe: "white" | "black" };
  unten: { name: string; farbe: "white" | "black" };
  brett: ReactNode;
  /** Die Frage, das Lob oder der Buchzug · ein Satz, kein Kasten. */
  meldung: ReactNode;
  tonart: Tonart;
  /** Was aus der Meldung folgt · „Zug zeigen", „Zeigen & weiter". */
  schalter: Schalter[];
  /** Die Nebengriffe zum Brett · hier ist das der Fokus. */
  griffe?: ReactNode;
  /** Vier Griffe zum Zurückblättern in der Linie. */
  verlaufSchalter: Schalter[];
  /** „Halbzug 3 / 5" · die Zählung neben den Griffen. */
  verlaufZaehler: string;
  verlaufNote: string;
  /** Wie weit die Sitzung ist, in Prozent. */
  fortschritt: number;
  /** Richtig, falsch, übrig · drei Zeilen, keine drei Kacheln. */
  zahlen: { name: string; wert: string }[];
  /** Wie tief die Linie gerade läuft · fehlt am ersten Zug einer Karte. */
  tiefe?: string | null;
  /** Der Satz zum freien Üben · fehlt im Plan. */
  freiNote?: string | null;
  /** Das fertig gesetzte Notizfeld · verdeckt oder offen, siehe der Trainer. */
  notiz: ReactNode;
  hinweis: string;
  onBeenden: () => void;
}

export interface TrainerEnde {
  /** „Training abgeschlossen!" oder „Nichts fällig." */
  titel: string;
  text: string;
  schalter: Schalter[];
}

export interface TrainerBlattProps {
  mobile: boolean;
  kopfRechts: ReactNode;
  /** Der leere Stapel · dann steht nur der Schlusssatz auf der Seite. */
  ende?: TrainerEnde;
  aufgabe?: TrainerAufgabe;
}

const TON: Record<Tonart, string> = {
  offen: "var(--color-line2)",
  richtig: "var(--color-accent)",
  falsch: "var(--color-loss)",
};

const TONFARBE: Record<Tonart, string> = {
  offen: "var(--color-ink2)",
  richtig: "var(--color-accent)",
  falsch: "var(--color-loss)",
};

export default function TrainerBlatt({ mobile, kopfRechts, ende, aufgabe }: TrainerBlattProps) {
  const { t } = useI18n();

  const kolumne = <Kolumnentitel links={t("blatt.trainerTitle")} rechts={kopfRechts} />;

  // ── Der leere Stapel ──────────────────────────────────────────────────────
  //
  // Kein Kasten in der Mitte des Schirms, sondern das, was am Ende eines
  // Kapitels steht: eine Rubrik, ein Satz, und die Wege, die daraus folgen.
  if (ende) {
    return (
      <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-10 pb-[22px] pt-6 max-[720px]:px-3.5 max-[720px]:pt-3">
        {kolumne}
        <div className="mt-6 max-w-[520px]">
          <Rubrik>{t("rep.session")}</Rubrik>
          <div className="buch mt-3 text-[19px] leading-[1.4] text-ink">{ende.titel}</div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink2">{ende.text}</p>
          <div className="mt-5">
            <Schalterreihe eintraege={ende.schalter} />
          </div>
        </div>
      </div>
    );
  }

  if (!aufgabe) return null;

  const {
    felder,
    stand,
    oben,
    unten,
    brett,
    meldung,
    tonart,
    schalter,
    griffe,
    verlaufSchalter,
    verlaufZaehler,
    verlaufNote,
    fortschritt,
    zahlen,
    tiefe,
    freiNote,
    notiz,
    hinweis,
    onBeenden,
  } = aufgabe;

  // Das Brett ist so groß wie in der gewöhnlichen Fassung · `--board-edge`
  // ist dasselbe Maß, das dort die Spalte deckelt.
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
      </div>
      {/* Die Meldung steht zwischen Brett und Bedienung, wo sie auch drüben
          steht · ein Strich in ihrer Farbe statt einer getönten Fläche. Die
          feste Höhe hält die Reihe darunter ruhig: Ohne sie sprang die
          Schalterreihe bei jedem Wechsel zwischen Frage und Antwort. */}
      <div
        className="mt-3 flex min-h-[42px] items-center border-s-2 ps-3 text-[13.5px] leading-[1.45]"
        style={{ borderColor: TON[tonart], color: TONFARBE[tonart] }}
      >
        {meldung}
      </div>
      <div className="mt-3">
        <Schalterreihe eintraege={schalter} griffe={griffe} />
      </div>
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <Feldname>{t("pz.positionHistory")}</Feldname>
          <span className="blatt-zahl text-[11px] text-ink3">{verlaufZaehler}</span>
        </div>
        <div className="mt-2">
          <Schalterreihe eintraege={verlaufSchalter} />
        </div>
        <p className="mt-2 text-[11px] leading-[1.55] text-ink3">{verlaufNote}</p>
      </div>
    </div>
  );

  const sitzung = (
    <div>
      <Rubrik>{t("rep.session")}</Rubrik>
      {/* Der Fortschritt als Haarlinie über die ganze Spalte · kein Balken mit
          Fläche, sondern der Teil der Strecke, der hinter einem liegt. */}
      <div className="mt-2.5 h-px w-full bg-line">
        <div
          className="h-px bg-ink"
          style={{ width: `${Math.max(0, Math.min(100, fortschritt))}%` }}
        />
      </div>
      <div className="mt-1">
        {zahlen.map((zahl) => (
          <div
            key={zahl.name}
            className="flex h-[30px] items-center justify-between border-b border-line text-[12.5px]"
          >
            <span className="truncate text-ink2">{zahl.name}</span>
            <span className="blatt-zahl text-ink">{zahl.wert}</span>
          </div>
        ))}
      </div>
      {tiefe && <div className="mt-2 text-[11.5px] text-ink3">{tiefe}</div>}
      {freiNote && <div className="mt-2 text-[11.5px] leading-[1.55] text-ink3">{freiNote}</div>}
    </div>
  );

  const notizBlock = (
    <div>
      <Rubrik>{t("rep.note")}</Rubrik>
      <div className="mt-1.5">{notiz}</div>
    </div>
  );

  const schluss = (
    <div>
      <Fussnote>{hinweis}</Fussnote>
      <div className="mt-3">
        <Schalterreihe eintraege={[{ label: t("rep.endTraining"), onClick: onBeenden }]} />
      </div>
    </div>
  );

  const rechts = (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      {sitzung}
      {notizBlock}
      <div className="flex-1" />
      {schluss}
    </div>
  );

  const kopf = (
    <>
      {kolumne}
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1.6fr 0.9fr 0.9fr 1.1fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-[110px] ps-3.5"}`}>
          <Feldname>{t("rep.session")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {stand}
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
        <div className="mt-4">{rechts}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        {rechts}
      </div>
    </div>
  );
}
