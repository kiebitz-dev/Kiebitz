/**
 * Training im Diagramm-Modus · der Coach.
 *
 * Die Seite hat zwei Hälften, und im Formularsatz sieht man das endlich:
 * links, woran gearbeitet werden soll, rechts, was die Woche daraus gemacht
 * hat.
 *
 * Rechts die Woche als gestapelter Balken je Tag, mit einer 2-px-Fuge zwischen
 * den Abschnitten — ohne die verschwimmen fünf Bereiche zu einem Klotz.
 * Darunter je Bereich ein Balken für die gemessenen Minuten und ein Strich für
 * das Ziel aus dem Plan; damit beantwortet eine Zeile zwei Fragen, ohne zwei
 * Achsen zu brauchen.
 *
 * Die fünf Bereichsfarben sind nicht neu erfunden: Es sind `AREA_COLOR` aus
 * lib/study.ts, in derselben festen Reihenfolge — und damit Tokens wie alles
 * andere.
 */
import type { ReactNode } from "react";
import {
  Ergebniskasten,
  ErledigenZeile,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";

export interface BereichZeile {
  name: string;
  farbe: string;
  /** Gemessene Minuten dieser Woche. */
  ist: number;
  /** Ziel aus dem Plan. */
  soll: number;
  /** Letzte 28 Tage · Einheiten und Minuten. */
  einheiten: number;
  minuten28: number;
}

export interface TagSpalte {
  name: string;
  /** Minuten je Bereich, in der Reihenfolge von `bereiche`. */
  werte: number[];
}

export interface StudyAufgabe {
  zahl: string;
  zusatz?: string;
  sache: string;
  neben: string;
  weg: string;
  erledigt: boolean;
  onWeg: () => void;
}

export interface StudyBlattProps {
  mobile: boolean;
  kopfRechts: ReactNode;
  felder: Feld[];
  /** Die Serie im Kasten rechts. */
  serie: number;
  befunde: ReactNode;
  bereiche: BereichZeile[];
  tage: TagSpalte[];
  wocheIst: number;
  wocheSoll: number;
  aufgaben: StudyAufgabe[];
  onInsights: () => void;
}

export default function StudyBlatt({
  mobile,
  kopfRechts,
  felder,
  serie,
  befunde,
  bereiche,
  tage,
  wocheIst,
  wocheSoll,
  aufgaben,
  onInsights,
}: StudyBlattProps) {
  const { t } = useI18n();

  const tagesSummen = tage.map((tag) => tag.werte.reduce((sum, value) => sum + value, 0));
  const maxTag = Math.max(1, ...tagesSummen);
  const maxBereich = Math.max(1, ...bereiche.map((b) => Math.max(b.ist, b.soll)));
  const hoehe = mobile ? 84 : 106;

  const wochenleiste = (
    <div>
      <div className="flex items-end gap-2" style={{ height: hoehe + 16 }}>
        {tage.map((tag, index) => (
          <div key={tag.name} className="flex min-w-0 flex-1 flex-col justify-end">
            <span className="blatt-zahl pb-[3px] text-center text-[10px] text-ink3">
              {tagesSummen[index] || ""}
            </span>
            <span className="block">
              {tag.werte.map((wert, bereichIndex) =>
                wert > 0 ? (
                  <span
                    key={bereichIndex}
                    className="mt-0.5 block"
                    style={{
                      height: (wert / maxTag) * (hoehe - 2),
                      background: bereiche[bereichIndex]?.farbe,
                    }}
                  />
                ) : null
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-ink pt-1">
        {tage.map((tag) => (
          <span key={tag.name} className="blatt-feld flex-1 text-center text-ink3">
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  );

  const bereichsZeilen = (
    <div className="mt-3.5">
      {bereiche.map((bereich) => (
        <div
          key={bereich.name}
          className="flex h-[29px] items-center gap-[9px] border-b border-line text-[12.5px]"
        >
          <span
            aria-hidden
            className="inline-block h-[9px] w-[9px] flex-none"
            style={{ background: bereich.farbe }}
          />
          <span className="w-[74px] flex-none truncate text-ink2">{bereich.name}</span>
          {/* Balken = gemessen, Strich = Ziel · eine Zeile, zwei Antworten,
              ohne zweite Achse. */}
          <span className="relative h-[9px] min-w-0 flex-1 border-b border-line2">
            <span
              className="absolute bottom-0 start-0 h-[7px]"
              style={{
                width: `${Math.min(100, (bereich.ist / maxBereich) * 100)}%`,
                background: bereich.farbe,
              }}
            />
            <span
              className="absolute -bottom-0.5 h-[13px] w-px bg-ink"
              style={{ insetInlineStart: `${Math.min(100, (bereich.soll / maxBereich) * 100)}%` }}
            />
          </span>
          <span className="blatt-zahl w-[62px] flex-none text-end text-ink">
            {deInt(bereich.ist)}
            <span className="text-ink3"> / {deInt(bereich.soll)}</span>
          </span>
        </div>
      ))}
    </div>
  );

  const letzte28 = (
    <div className="mt-4">
      <Rubrik>{t("blatt.last28")}</Rubrik>
      <div className="mt-1">
        {bereiche.map((bereich) => (
          <div
            key={bereich.name}
            className="flex h-[26px] items-baseline gap-[9px] border-b border-line text-[12px]"
          >
            <span
              aria-hidden
              className="inline-block h-2 w-2 flex-none"
              style={{ background: bereich.farbe }}
            />
            <span className="flex-1 truncate text-ink2">{bereich.name}</span>
            <span className="blatt-zahl text-ink3">
              {t("blatt.units", { n: deInt(bereich.einheiten) })}
            </span>
            <span className="blatt-zahl w-14 text-end text-ink">
              {t("blatt.minutes", { n: deInt(bereich.minuten28) })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const woche = (
    <div className={mobile ? "flex flex-col" : "flex w-[336px] flex-none flex-col"}>
      <Rubrik weg={t("blatt.weekOf", { a: deInt(wocheIst), m: deInt(wocheSoll) })}>
        {t("blatt.thisWeek")}
      </Rubrik>
      <div className="mt-3">{wochenleiste}</div>
      {bereichsZeilen}
      <div className="mt-1.5 text-[10.5px] text-ink3">{t("blatt.barVsGoal")}</div>
      {letzte28}
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-[1.6] text-ink3">
        {t("blatt.measuredNote")}
      </div>
    </div>
  );

  const coach = (
    <div className="flex min-w-0 flex-1 flex-col">
      <Rubrik weg={t("blatt.allFindings")} onWeg={onInsights}>
        {t("blatt.theCoach")}
      </Rubrik>
      <div className="mt-0.5">{befunde}</div>
      <div className="flex-1" />
      <div className="mt-3 border-t border-line pt-2.5 text-[10.5px] leading-[1.6] text-ink3">
        {t("blatt.severityNote")}
      </div>
    </div>
  );

  const heute = aufgaben.length > 0 && (
    <div className="pt-4">
      <Rubrik>{t("blatt.today")}</Rubrik>
      {/* Drei Aufgaben nebeneinander brauchen Platz: Bei 1.000 Punkten
          Fensterbreite blieben jeder gut 180, und davon gingen Kästchen, Zahl
          und Weg schon 175 · von der Sache selbst stand dann ein Buchstabe da.
          Sie umbrechen deshalb lieber in eine zweite Reihe. */}
      <div className={mobile ? "flex flex-col" : "flex flex-wrap gap-x-8"}>
        {aufgaben.map((aufgabe) => (
          <div key={aufgabe.sache} className="min-w-[212px] flex-1">
            <ErledigenZeile
              zahl={aufgabe.zahl}
              zusatz={aufgabe.zusatz}
              sache={aufgabe.sache}
              neben={aufgabe.neben}
              weg={aufgabe.weg}
              onWeg={aufgabe.onWeg}
              erledigt={aufgabe.erledigt}
              letzte={!mobile}
              hoehe={46}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("blatt.studyTitle")} rechts={kopfRechts} />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1.2fr 1fr 1fr 1.5fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-[104px] ps-3.5"}`}>
          <Feldname>{t("blatt.streak")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {deInt(serie)}
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
        {heute}
        <div className="mt-4">{coach}</div>
        <div className="mt-6">{woche}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1280px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {coach}
        {woche}
      </div>
      {heute}
    </div>
  );
}
