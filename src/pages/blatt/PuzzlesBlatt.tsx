/**
 * Puzzles im Diagramm-Modus · der Tagesbogen.
 *
 * Aus dem Fortschrittsbalken wird ein Bogen mit einem Kästchen je Aufgabe:
 * gelöste sind ausgefüllt, die laufende trägt ihre Nummer und steht auf dem
 * Brett. Ein Balken sagt „62 Prozent"; ein Bogen sagt „noch acht". Für ein
 * Tagesziel ist das Zweite die richtige Auskunft.
 *
 * Das Motiv bleibt verdeckt, wenn die Einstellung das will — im Formularsatz
 * wird daraus ein geschwärztes Feld, die Stelle, die man erst freirubbelt.
 *
 * Hier wird gezogen, also ist das Brett ein Brett und kommt fertig von der
 * Seite herein.
 */
import type { ReactNode } from "react";
import {
  Aufdeckfeld,
  Balken,
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  Schalterreihe,
  Zugfolge,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";

/** Der Ratingverlauf als Haarlinie · so viele Messpunkte wie vorliegen. */
function Verlauf({ werte, breite = 240, hoehe = 34 }: { werte: number[]; breite?: number; hoehe?: number }) {
  if (werte.length < 2) return null;
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const spanne = max - min || 1;
  const x = (i: number) => (i / (werte.length - 1)) * breite;
  const y = (v: number) => hoehe - ((v - min) / spanne) * (hoehe - 4) - 2;
  const punkte = werte.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${breite} ${hoehe}`} width="100%" height={hoehe} className="block" aria-hidden="true">
      <polyline points={punkte} fill="none" stroke="var(--color-ink)" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

export interface MotivZeile {
  name: string;
  quote: number;
}

export interface PuzzlesBlattProps {
  mobile: boolean;
  kopfRechts: ReactNode;
  felder: Feld[];
  /** Tagesziel im Kasten rechts · „12 / 20". */
  tagesziel: string;
  /** Wer am Zug ist · über dem Brett steht die Gegenseite. */
  amZug: "white" | "black";
  amZugText: string;
  aufforderung: string;
  brett: ReactNode;
  schalter: { label: ReactNode; onClick?: () => void; betont?: boolean }[];
  /** Der Stellungsverlauf · vier Griffe zum Zurückblättern. */
  verlaufSchalter: { label: ReactNode; onClick?: () => void; titel?: string }[];
  /**
   * Teilen und der Fokus · sie stehen am Ende der Verlaufsreihe, weil sie in
   * der gewöhnlichen Fassung genau dort stehen. Fertig von der Seite herein.
   */
  griffe?: ReactNode;
  verlaufNote: string;
  /** Versuche heute, Ziel, und die Nummer der laufenden Aufgabe. */
  heute: number;
  ziel: number;
  motive: MotivZeile[];
  rating: number;
  ratingDelta: number | null;
  history: number[];
  geloest: number;
  /**
   * Die Lösung in Worten · erst, wenn die Aufgabe vorbei ist.
   *
   * `zeile` ist die ganze Folge, `saetze` nur die Züge des Lösers, zu denen es
   * etwas zu sagen gibt (siehe lib/loesung.ts). Fehlt sie, steht keine Rubrik
   * da · eine leere Rubrik ist kein Abschnitt.
   */
  loesung?: { zeile: string; saetze: { zug: string; satz: string }[] };
  /** Die Theorie zum Motiv · verdeckt, bis sie verlangt wird. */
  motiv?: { titel: string; text: string; offen: boolean; onUmschalten: () => void };
}

export default function PuzzlesBlatt({
  mobile,
  kopfRechts,
  felder,
  tagesziel,
  amZug,
  amZugText,
  aufforderung,
  brett,
  schalter,
  verlaufSchalter,
  griffe,
  verlaufNote,
  heute,
  ziel,
  motive,
  rating,
  ratingDelta,
  history,
  geloest,
  loesung,
  motiv,
}: PuzzlesBlattProps) {
  const { t } = useI18n();

  // Das Brett ist so groß wie in der gewöhnlichen Fassung · `--board-edge`
  // ist dasselbe Maß, das dort die Spalte deckelt. Ein eigenes, kleineres
  // Maß hätte den Modus zu einer Ansicht gemacht, in der man schlechter
  // sieht.
  const brettSpalte = (
    <div className={mobile ? "flex flex-col" : "flex w-[var(--board-edge)] max-w-full flex-none flex-col"}>
      <div className="flex items-center gap-[9px] pb-[9px]">
        <Farbfeld farbe={amZug === "white" ? "black" : "white"} kante={11} />
        <span className="text-[14px] text-ink">
          {amZug === "white" ? t("common.black") : t("common.white")}
        </span>
      </div>
      {brett}
      <div className="flex flex-wrap items-center gap-[9px] pt-[9px]">
        <Farbfeld farbe={amZug} kante={11} />
        <span className="text-[14px] text-ink">{amZugText}</span>
        <span className="flex-1" />
        <span className="buch text-[13px] italic text-ink2">{aufforderung}</span>
      </div>
      <div className="mt-3">
        <Schalterreihe eintraege={schalter} />
      </div>
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-3">
        <Feldname>{t("pz.positionHistory")}</Feldname>
        <div className="mt-2">
          <Schalterreihe eintraege={verlaufSchalter} griffe={griffe} />
        </div>
        <p className="mt-2 text-[11px] leading-[1.55] text-ink3">{verlaufNote}</p>
      </div>
    </div>
  );

  const bogen = (
    <div>
      <Rubrik>{t("blatt.dailySheet")}</Rubrik>
      <div className="mt-3 flex flex-wrap gap-[7px]">
        {Array.from({ length: Math.max(ziel, heute + 1) }, (_, index) => {
          const fertig = index < heute;
          const jetzt = index === heute;
          return (
            <span
              key={index}
              aria-hidden
              className={`flex h-[30px] w-[30px] items-center justify-center border ${
                jetzt ? "border-ink" : "border-line2"
              }`}
              style={{ background: fertig ? "var(--color-ink)" : "transparent" }}
            >
              {jetzt && <span className="blatt-zahl text-[11px] text-ink">{deInt(index + 1)}</span>}
            </span>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-ink3">
        {t("blatt.sheetNote", { done: deInt(heute), left: deInt(Math.max(0, ziel - heute)) })}
      </div>
    </div>
  );

  const motivBlock = motive.length > 0 && (
    <div>
      <Rubrik>{t("blatt.hitRateByTheme")}</Rubrik>
      <div className="mt-1.5">
        {motive.map((motiv) => (
          <div
            key={motiv.name}
            className="flex h-[30px] items-center gap-2.5 border-b border-line text-[12.5px]"
          >
            <span className="w-24 flex-none truncate text-ink2">{motiv.name}</span>
            <span className="min-w-0 flex-1">
              <Balken anteil={motiv.quote} />
            </span>
            <span className="blatt-zahl w-[34px] flex-none text-end text-ink">
              {deInt(Math.round(motiv.quote))} %
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const ratingBlock = (
    <div>
      <Rubrik>{t("pz.rating")}</Rubrik>
      <div className="mt-2.5 flex items-end gap-4">
        <span className="blatt-zahl text-[26px] font-medium leading-none text-ink">
          {deInt(rating)}
        </span>
        {ratingDelta != null && ratingDelta !== 0 && (
          <span
            className="blatt-zahl pb-[3px] text-[12.5px]"
            style={{ color: ratingDelta > 0 ? "var(--color-win)" : "var(--color-loss)" }}
          >
            {ratingDelta > 0 ? "+" : "−"}
            {deInt(Math.abs(ratingDelta))}
          </span>
        )}
        <span className="min-w-0 flex-1 border-y border-line py-1.5">
          <Verlauf werte={history} hoehe={mobile ? 26 : 34} />
        </span>
      </div>
      <div className="mt-2 text-[11px] text-ink3">
        {t("blatt.ratingNote", { points: deInt(history.length), solved: deInt(geloest) })}
      </div>
    </div>
  );

  const loesungBlock = loesung && (
    <div>
      <Rubrik>{t("pz.solutionTitle")}</Rubrik>
      <div className="mt-2">
        <Zugfolge gross={15}>{loesung.zeile}</Zugfolge>
      </div>
      {/* Die Sätze ohne eigene Beschriftung · jeder nennt seinen Zug selbst,
          und ein Etikett „21.Rxc1" über „Rxc1 schlägt die Dame" sagte ihn
          zweimal. Die Zugfolge darüber sagt, wo er steht. */}
      {loesung.saetze.length > 0 && (
        <div className="buch mt-2.5 flex flex-col gap-1 border-s-2 border-line2 ps-[11px] text-[14px] leading-[1.5] text-ink2">
          {loesung.saetze.map((eintrag) => (
            <p key={eintrag.zug}>{eintrag.satz}</p>
          ))}
        </div>
      )}
    </div>
  );

  // Das Motiv steht im Satz der Seite wie der Hinweis im Endspiel: verdeckt
  // hinter seiner Rubrik, bis man es aufdeckt. Heißt die Rubrik das Motiv beim
  // Namen, ist es schon aufgedeckt · sonst trägt sie nur „Das Motiv".
  const motivTheorieBlock = motiv && (
    <Aufdeckfeld
      titel={motiv.titel}
      offen={motiv.offen}
      onUmschalten={motiv.onUmschalten}
      wegAuf={t("theory.show")}
      wegZu={t("theory.hide")}
      verdeckt={t("pz.theoryCovered")}
    >
      <div className="buch text-[14px] leading-[1.55] text-ink2">{motiv.text}</div>
    </Aufdeckfeld>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("blatt.puzzlesTitle")} rechts={kopfRechts} />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1fr 1.2fr 1.4fr 1.2fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[70px] ps-2.5" : "w-[120px] ps-3.5"}`}>
          <Feldname>{t("dash.puzzleGoal")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {tagesziel}
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
        {loesungBlock && <div className="mt-4">{loesungBlock}</div>}
        {motivTheorieBlock && <div className="mt-4">{motivTheorieBlock}</div>}
        <div className="mt-4">{bogen}</div>
        {motivBlock && <div className="mt-4">{motivBlock}</div>}
        <div className="mt-4">{ratingBlock}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
          {bogen}
          {loesungBlock}
          {motivTheorieBlock}
          {motivBlock}
          {ratingBlock}
        </div>
      </div>
    </div>
  );
}
