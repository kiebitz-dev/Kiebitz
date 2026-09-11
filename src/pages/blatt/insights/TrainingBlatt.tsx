/**
 * Training im Diagramm-Modus · nicht zu verwechseln mit dem Training-Tab.
 *
 * Dort steht der Coach mit den Befunden; hier steht die Frage, ob das Training
 * wirkt. Zwei Regeln bestimmen das Blatt:
 *
 * · Können und Rating bekommen zwei getrennte Kurven. Genauigkeit in Prozent
 *   und Elo teilen sich keine Achse — dasselbe Argument wie auf der Übersicht.
 * · Auch Trainingsaufkommen und Patzerquote stehen untereinander statt
 *   ineinander: Balken oben, Kurve darunter, gemeinsame Zeitachse. Die
 *   gewöhnliche Fassung legt beides in ein Bild mit zwei Achsen.
 *
 * Die Lernkurve je Motiv ist die einzige Figur, die der Modus hinzufügt: zwei
 * Marken auf einer Bahn, dazwischen die Strecke, rechts die Veränderung.
 * „63,2 → 84,2" liest sich als Bewegung; zwei Balken nebeneinander täten das
 * nicht.
 *
 * ── Die Trainingsbilanz ────────────────────────────────────────────────────
 *
 * Last je Woche, die Patzerquote daneben und der Vergleich zwischen starken
 * und schwachen Wochen standen lange nur in der gewöhnlichen Fassung. Das war
 * derselbe Fehler wie beim fehlenden Wochenplan auf dem Trainingsblatt: drei
 * Auskünfte, die der Modus gekostet hat, statt sie neu zu setzen.
 *
 * Sie holt dieses Blatt selbst, wie es die gewöhnliche Fassung tut: Die
 * Wochenlast steht nicht in der Tiefenauswertung, sondern wird beim Öffnen des
 * Reiters aus dem Trainingsprogramm gerechnet · deshalb dieselbe Bedingung
 * dort wie hier (nur am Rechner).
 *
 * Gesetzt ist sie nach derselben Regel wie das Aufkommen darüber: gestapelte
 * Balken oben, Kurve darunter, eine gemeinsame Zeitachse — und nicht beides in
 * einem Bild mit zwei Achsen. Der Nachlauf ist kein Kachelpaar, sondern zwei
 * Bahnen auf einer Skala; nur so ist zu sehen, wie weit die beiden Zahlen
 * auseinanderliegen.
 */
import { useEffect, useState } from "react";
import {
  Bahn,
  Bahnkopf,
  Blatttabelle,
  Figur,
  Fussnote,
  Kennzahlen,
  Kurve,
  Rubrik,
} from "../../../components/blatt/Satz";
import { useI18n, type Key } from "../../../lib/i18n";
import { dateLocale, de, deInt } from "../../../lib/format";
import { isoWeek } from "../../../lib/dates";
import { themeLabel, type PuzzleInsights } from "../../../lib/puzzles";
import { studyMetrics, type DeepInsights, type MetricWindow } from "../../../lib/insights";
import { AREAS, AREA_COLOR, AREA_KEY, trainingProgram } from "../../../lib/study";
import { lagComparison, weeklyLoad, type WeekLoad } from "../../../lib/balance";
import Reiterkopf from "./Reiterkopf";

/** Eine Lernkurve · zwei Marken auf einer Bahn, dazwischen die Strecke. */
function Lernbahn({
  name,
  neben,
  frueh,
  spaet,
  delta,
  breite,
  letzte,
}: {
  name: string;
  neben: string;
  frueh: number;
  spaet: number;
  delta: number;
  breite: number;
  letzte: boolean;
}) {
  const von = Math.max(0, Math.min(100, Math.min(frueh, spaet)));
  const bis = Math.max(0, Math.min(100, Math.max(frueh, spaet)));
  const besser = delta >= 0;
  return (
    <div
      className={`flex h-[38px] items-center gap-[11px] text-[12.5px] ${
        letzte ? "" : "border-b border-line"
      }`}
    >
      <span className="min-w-0 flex-none" style={{ width: breite }}>
        <span className="block truncate text-ink2">{name}</span>
        <span className="blatt-zahl block truncate text-[10px] text-ink3">{neben}</span>
      </span>
      <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
        <span
          className="absolute bottom-1 h-[2px]"
          style={{
            insetInlineStart: `${von.toFixed(1)}%`,
            width: `${(bis - von).toFixed(1)}%`,
            background: besser ? "var(--color-win)" : "var(--color-loss)",
          }}
        />
        <span
          className="absolute bottom-0 h-[11px] w-[2px]"
          style={{
            insetInlineStart: `${Math.max(0, Math.min(100, frueh)).toFixed(1)}%`,
            background: "var(--color-ink3)",
          }}
        />
        <span
          className="absolute -bottom-[3px] h-[17px] w-[2px]"
          style={{
            insetInlineStart: `${Math.max(0, Math.min(100, spaet)).toFixed(1)}%`,
            background: "var(--color-ink)",
          }}
        />
      </span>
      <span className="blatt-zahl w-12 flex-none text-end text-[13px] text-ink">
        {de(spaet)} %
      </span>
      <span
        className="blatt-zahl w-11 flex-none text-end text-[11px]"
        style={{ color: besser ? "var(--color-win)" : "var(--color-loss)" }}
      >
        {besser ? "+" : ""}
        {de(delta)}
      </span>
    </div>
  );
}

/**
 * Die Trainingsbilanz · Last je Woche, Leitkennzahl und Nachlauf.
 *
 * Sie lädt eigenständig nach, weil `deep_insights` diese Daten nicht
 * mitbringt · genau wie die gewöhnliche Fassung (siehe `Balance` in
 * pages/insights/Training.tsx). Dieselbe Abfrage, dieselbe Rechnung, anderer
 * Satz.
 */
function Bilanz({ mobile }: { mobile: boolean }) {
  const { t } = useI18n();
  const [wochen, setWochen] = useState<WeekLoad[]>([]);
  const [fenster, setFenster] = useState<MetricWindow[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    trainingProgram(180)
      .then(async (programm) => {
        if (abgebrochen) return;
        const last = weeklyLoad(programm.days);
        setWochen(last);
        // Ein Fenster je Woche in einem Aufruf · der Backend-Befehl geht die
        // Datenbank sonst mehrfach durch.
        const specs = last.map((woche) => ({ from_ts: woche.from_ts, to_ts: woche.to_ts }));
        if (specs.length === 0) return;
        const gemessen = await studyMetrics(specs).catch(() => [] as MetricWindow[]);
        if (abgebrochen || gemessen.length !== specs.length) return;
        setFenster(gemessen);
      })
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
  }, []);

  if (wochen.length === 0) return null;

  // Die Leitkennzahl der Verlaufskurve: die Patzerrate reagiert am schnellsten
  // von allem, was über Partien messbar ist.
  const kennzahl = "blunders_per100";
  const werte = wochen.map(
    (_, index) => fenster[index]?.metrics.find((eintrag) => eintrag.key === kennzahl) ?? null
  );
  const kurve = werte
    .map((eintrag) => (eintrag?.n ? eintrag.value : null))
    .filter((wert): wert is number => wert != null);
  const maxLast = Math.max(1, ...wochen.map((woche) => woche.total));
  const nachlauf = lagComparison(wochen, fenster, kennzahl);
  // Beide Zahlen auf einer Skala · sonst sagen zwei Bahnen nebeneinander
  // nichts über ihren Abstand.
  const maxNachlauf = nachlauf ? Math.max(nachlauf.high, nachlauf.low, 0.1) : 1;

  const last = (
    <div>
      <Rubrik weg={t("ins.trLoadSummary")}>{t("ins.trLoadTitle")}</Rubrik>
      <div className="mt-2.5">
        <div className="blatt-feld text-ink3">{t("ins.trLoadMinutes")}</div>
        {/* Gestapelte Wochenbalken mit 2-px-Fuge · ohne die verschwimmen fünf
            Bereiche zu einem Klotz (siehe StudyBlatt). */}
        <div className="mt-1.5 flex h-[62px] items-end gap-[3px] border-b border-ink">
          {wochen.map((woche) => (
            <span
              key={woche.from_ts}
              title={`${t("ins.trWeek")}${isoWeek(new Date(woche.from_ts * 1000))} · ${t(
                "plan.minutes",
                { m: deInt(woche.total) }
              )}`}
              className="flex min-w-0 flex-1 flex-col justify-end"
            >
              {AREAS.map((bereich) =>
                woche[bereich] > 0 ? (
                  <span
                    key={bereich}
                    className="mt-[2px] block"
                    style={{
                      height: `${((woche[bereich] / maxLast) * 56).toFixed(1)}px`,
                      background: AREA_COLOR[bereich],
                    }}
                  />
                ) : null
              )}
            </span>
          ))}
        </div>
        {/* Die Legende steht als Zeile und nicht als Kasten neben dem Bild. */}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {AREAS.map((bereich) => (
            <span key={bereich} className="flex items-center gap-1.5 text-[10.5px] text-ink3">
              <span
                aria-hidden
                className="inline-block h-[8px] w-[8px] flex-none"
                style={{ background: AREA_COLOR[bereich] }}
              />
              {t(AREA_KEY[bereich])}
            </span>
          ))}
        </div>
      </div>
      {kurve.length > 1 && (
        <Figur
          titel={t(`metric.${kennzahl}` as Key)}
          rechts={de(kurve[kurve.length - 1])}
          links={de(kurve[0])}
          unten={t("blatt.weeksNote")}
        >
          <Kurve werte={kurve} breite={380} hoehe={34} farbe="var(--color-loss)" />
        </Figur>
      )}
      <Fussnote>{t("ins.trLoadNote")}</Fussnote>
    </div>
  );

  const verzoegert = (
    <div>
      <Rubrik weg={t("ins.trLagSummary")}>{t("ins.trLagTitle")}</Rubrik>
      {nachlauf ? (
        <>
          <Bahnkopf
            was={t(`metric.${nachlauf.metricKey}` as Key)}
            wert={t("ins.trLagTitle")}
            breite={mobile ? 118 : 138}
            wertBreite={54}
          />
          {/* Zwei Bahnen auf einer Skala · welche die bessere ist, sagt die
              Farbe der Ziffer und nicht ihre Größe: Bei der Patzerquote
              gewinnt die kleinere. */}
          {[
            { name: t("ins.trLagHigh"), wert: nachlauf.high },
            { name: t("ins.trLagLow"), wert: nachlauf.low },
          ].map((seite, index, alle) => {
            const besser = nachlauf.lowerIsBetter
              ? seite.wert <= Math.min(nachlauf.high, nachlauf.low)
              : seite.wert >= Math.max(nachlauf.high, nachlauf.low);
            return (
              <Bahn
                key={seite.name}
                name={seite.name}
                wert={seite.wert}
                max={maxNachlauf}
                anzeige={de(seite.wert)}
                farbe={besser ? "var(--color-win)" : "var(--color-ink2)"}
                breite={mobile ? 118 : 138}
                wertBreite={54}
                hoehe={34}
                letzte={index === alle.length - 1}
              />
            );
          })}
          <Fussnote>
            {t(`metric.${nachlauf.metricKey}` as Key)}
            {" · "}
            {t("ins.trAttemptsNote", { n: deInt(nachlauf.highWeeks + nachlauf.lowWeeks) })}
          </Fussnote>
          <Fussnote>{t("ins.trLagNote")}</Fussnote>
        </>
      ) : (
        <div className="py-3 text-[12.5px] leading-[1.6] text-ink3">{t("ins.trLagNeed")}</div>
      )}
    </div>
  );

  return (
    <>
      {last}
      {verzoegert}
    </>
  );
}

export default function TrainingBlatt({
  mobile,
  desktop,
  deep,
  puzzles,
}: {
  mobile: boolean;
  /** Die Trainingsbilanz gibt es nur am Rechner · dort liegt das Programm. */
  desktop: boolean;
  deep: DeepInsights;
  puzzles: PuzzleInsights | null;
}) {
  const { t, locale } = useI18n();
  const { progress } = deep;

  const genauigkeit = progress.months
    .map((monat) => monat.accuracy)
    .filter((wert): wert is number => wert != null);
  const rating = progress.months
    .map((monat) => monat.rating)
    .filter((wert): wert is number => wert != null);
  const patzer = progress.months
    .map((monat) => monat.blunders_per_100)
    .filter((wert): wert is number => wert != null);
  const versuche = progress.months.map((monat) => monat.puzzle_attempts);
  const maxVersuche = Math.max(1, ...versuche);
  const trefferquote = (eintrag: { attempts: number; solved: number }) =>
    eintrag.attempts === 0 ? 0 : (eintrag.solved / eintrag.attempts) * 100;

  // Nur Stunden, in denen überhaupt etwas versucht wurde · leere Zeilen sind
  // keine Auskunft (dieselbe Auswahl wie in der gewöhnlichen Fassung).
  const stunden = (puzzles?.by_hour ?? []).filter((fenster) => fenster.attempts > 0);
  const maxTag = Math.max(1, ...(puzzles?.timeline ?? []).map((punkt) => punkt.attempts));
  /** Erster und letzter Tag des Verlaufs · die Beschriftung der Zeitachse. */
  const tagesspanne = (() => {
    const punkte = puzzles?.timeline ?? [];
    if (punkte.length === 0) return "";
    const tag = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString(dateLocale(), {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      });
    return `${tag(punkte[0].day_ts)} – ${tag(punkte[punkte.length - 1].day_ts)}`;
  })();

  const kopf = (
    <Reiterkopf
      mobile={mobile}
      spalten="1.4fr 1.1fr 1.25fr 1.25fr"
      felder={[
        {
          label: t("ins.trAccuracyTrend"),
          wert:
            progress.accuracy_delta == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">
                  {progress.accuracy_delta > 0 ? "+" : ""}
                  {de(progress.accuracy_delta)}
                </span>
                {" · "}
                {t("ins.trAccuracyTrendSub")}
              </>
            ),
          gross: true,
        },
        {
          label: t("ins.trRatingTrend"),
          wert:
            progress.rating_delta == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">
                  {progress.rating_delta > 0 ? "+" : ""}
                  {deInt(progress.rating_delta)}
                </span>
                {" · "}
                {t("ins.trRatingTrendSub")}
              </>
            ),
        },
        {
          label: t("ins.pzRating"),
          wert:
            puzzles == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">{deInt(puzzles.personal_rating)}</span>
                {" · "}
                {t("ins.pzRatingSub")}
              </>
            ),
        },
        {
          label: t("ins.pzSolveRate"),
          wert:
            puzzles == null || puzzles.attempts === 0 ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">{de(trefferquote(puzzles))} %</span>
                {" · "}
                {t("ins.pzSolveRateSub", {
                  s: deInt(puzzles.solved),
                  n: deInt(puzzles.attempts),
                })}
              </>
            ),
        },
      ]}
      kasten={{
        label: t("ins.pzRun"),
        wert: puzzles == null ? "—" : deInt(puzzles.best_run),
        gross: 15,
      }}
    />
  );

  const koennen = (genauigkeit.length > 1 || rating.length > 1) && (
    <div>
      <Rubrik weg={t("ins.trSkillSummary")}>{t("ins.trSkillTitle")}</Rubrik>
      {genauigkeit.length > 1 && (
        <Figur
          titel={t("blatt.accuracyByMonth")}
          rechts={`${de(genauigkeit[genauigkeit.length - 1])} %`}
          links={`${de(genauigkeit[0])} %`}
          unten={t("blatt.monthsNote")}
        >
          <Kurve werte={genauigkeit} breite={380} hoehe={44} />
        </Figur>
      )}
      {rating.length > 1 && (
        <Figur
          titel={t("ins.trRatingTrend")}
          rechts={deInt(rating[rating.length - 1])}
          links={deInt(rating[0])}
          unten={t("blatt.monthsNote")}
        >
          <Kurve werte={rating} breite={380} hoehe={44} farbe="var(--color-violet)" />
        </Figur>
      )}
      <Fussnote>{t("ins.trSkillNote")}</Fussnote>
    </div>
  );

  const aufkommen = patzer.length > 1 && (
    <div>
      <Rubrik weg={t("ins.trVolumeSummary")}>{t("ins.trVolumeTitle")}</Rubrik>
      <div className="mt-2.5">
        <div className="blatt-feld text-ink3">{t("ins.pzAttempts")}</div>
        <div className="mt-1.5 flex h-[52px] items-end gap-[3px] border-b border-ink">
          {versuche.map((anzahl, index) => (
            <span
              key={index}
              title={t("ins.trAttemptsNote", { n: deInt(anzahl) })}
              className="block flex-1 bg-ink2"
              style={{ height: `${((anzahl / maxVersuche) * 50).toFixed(1)}px` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2.5">
        <div className="blatt-feld text-ink3">{t("ins.fmtBlunders")}</div>
        <div className="mt-1.5 border-b border-line pb-1.5">
          <Kurve werte={patzer} breite={380} hoehe={34} farbe="var(--color-loss)" />
        </div>
        <div className="blatt-zahl mt-1 flex justify-between text-[10px] text-ink3">
          <span>{de(patzer[0])}</span>
          <span>{de(patzer[patzer.length - 1])}</span>
        </div>
      </div>
      <Fussnote>{t("ins.trVolumeNote")}</Fussnote>
    </div>
  );

  const wirkung = (progress.themes.length > 0 || progress.rep_effect.before_games > 0) && (
    <div>
      <Rubrik weg={t("ins.trEffectSummary")}>{t("ins.trEffectTitle")}</Rubrik>
      {progress.themes.length > 0 && (
        <>
          <div className="blatt-feld pt-2 text-ink3">{t("ins.trThemeCurve")}</div>
          {progress.themes.map((thema, index) => (
            <Lernbahn
              key={thema.theme}
              name={themeLabel(thema.theme, locale)}
              neben={t("ins.trAttemptsNote", { n: deInt(thema.attempts) })}
              frueh={thema.early_pct}
              spaet={thema.late_pct}
              delta={thema.delta}
              breite={mobile ? 108 : 118}
              letzte={index === progress.themes.length - 1}
            />
          ))}
        </>
      )}
      {progress.rep_effect.before_games > 0 && (
        <div className="mt-3">
          <div className="blatt-feld text-ink3">{t("ins.trRepEffect")}</div>
          <div className="mt-1.5">
            <Bahn
              name={t("ins.trBefore", { n: deInt(progress.rep_effect.before_games) })}
              wert={progress.rep_effect.before_score}
              anzeige={`${de(progress.rep_effect.before_score)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={mobile ? 128 : 148}
              hoehe={32}
            />
            <Bahn
              name={t("ins.trAfter", { n: deInt(progress.rep_effect.after_games) })}
              wert={progress.rep_effect.after_score}
              anzeige={`${de(progress.rep_effect.after_score)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={mobile ? 128 : 148}
              hoehe={32}
              letzte
            />
          </div>
          <Fussnote>{t("ins.trRepEffectNote")}</Fussnote>
        </div>
      )}
    </div>
  );

  const motive = puzzles != null && puzzles.attempts > 0 && (
    <div>
      <Rubrik
        weg={t("ins.trPuzzleSummary", {
          r: deInt(puzzles.personal_rating),
          b: deInt(puzzles.best_run),
        })}
      >
        {t("ins.tabPuzzles")}
      </Rubrik>
      <Kennzahlen
        zahlen={[
          {
            name: t("ins.pzSolveRate"),
            wert: `${de(trefferquote(puzzles))} %`,
            neben: t("ins.pzSolveRateSub", {
              s: deInt(puzzles.solved),
              n: deInt(puzzles.attempts),
            }),
          },
          {
            name: t("ins.pzHardest"),
            wert: deInt(puzzles.avg_solved_rating),
            neben: t("ins.pzHardestSub", { n: deInt(puzzles.avg_puzzle_rating) }),
          },
          {
            name: t("ins.pzRun"),
            wert: deInt(puzzles.best_run),
            neben: t("ins.pzRunSub", { n: deInt(puzzles.current_run) }),
          },
        ]}
      />
      <div className={mobile ? "mt-4 flex flex-col gap-4" : "mt-4 flex gap-6"}>
        <div className="min-w-0 flex-1">
          <div className="blatt-feld text-ink3">{t("blatt.hitRateByTheme")}</div>
          {[...puzzles.themes]
            .filter((thema) => thema.attempts >= 5)
            .sort((a, b) => trefferquote(b) - trefferquote(a))
            .map((thema, index, alle) => (
              <Bahn
                key={thema.theme}
                name={themeLabel(thema.theme, locale)}
                wert={trefferquote(thema)}
                anzeige={`${de(trefferquote(thema))} %`}
                breite={mobile ? 108 : 104}
                wertBreite={48}
                hoehe={25}
                letzte={index === alle.length - 1}
              />
            ))}
        </div>
        <div className={mobile ? "" : "w-[196px] flex-none"}>
          <div className="blatt-feld text-ink3">{t("blatt.difficulty")}</div>
          {puzzles.by_rating.map((band, index) => (
            <Bahn
              key={band.key}
              name={`${deInt(band.key)}–${deInt(band.key + 399)}`}
              neben={t("ins.trAttemptsNote", { n: deInt(band.attempts) })}
              wert={trefferquote(band)}
              anzeige={`${de(trefferquote(band))} %`}
              breite={88}
              wertBreite={48}
              hoehe={34}
              letzte={index === puzzles.by_rating.length - 1}
            />
          ))}
          <Fussnote>{t("ins.pzByDifficultyNote")}</Fussnote>
        </div>
      </div>
    </div>
  );

  /**
   * Der Puzzle-Verlauf · Rating als Kurve, Versuche als Balken.
   *
   * In der gewöhnlichen Fassung stehen beide Bilder nebeneinander; hier
   * untereinander auf derselben Zeitachse. Der Balken ist zweigeteilt:
   * unten gelöst, oben gescheitert — dieselbe Stapelung wie drüben, nur ohne
   * Legende, weil die beiden Beschriftungen an den Rändern stehen.
   */
  const verlauf = puzzles != null && puzzles.timeline.length > 1 && (
    <div>
      <Rubrik
        weg={t("ins.trPuzzleSummary", {
          r: deInt(puzzles.personal_rating),
          b: deInt(puzzles.best_run),
        })}
      >
        {t("ins.pzRatingTrend")}
      </Rubrik>
      <Figur
        titel={t("ins.pzRating")}
        rechts={deInt(puzzles.timeline[puzzles.timeline.length - 1].rating)}
        links={deInt(puzzles.timeline[0].rating)}
        unten={tagesspanne}
      >
        <Kurve
          werte={puzzles.timeline.map((punkt) => punkt.rating)}
          breite={380}
          hoehe={44}
          farbe="var(--color-accent)"
        />
      </Figur>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="blatt-feld text-ink3">{t("ins.pzSolved")}</span>
          <span className="blatt-feld text-ink3">{t("ins.pzFailed")}</span>
        </div>
        <div className="mt-1.5 flex h-[52px] items-end gap-[2px] border-b border-ink">
          {puzzles.timeline.map((punkt) => (
            <span
              key={punkt.day_ts}
              title={t("ins.pzSolvedOfAttempts", {
                s: deInt(punkt.solved),
                n: deInt(punkt.attempts),
              })}
              className="flex min-w-0 flex-1 flex-col justify-end"
            >
              <span
                className="block"
                style={{
                  height: `${(((punkt.attempts - punkt.solved) / maxTag) * 48).toFixed(1)}px`,
                  background: "var(--color-loss)",
                }}
              />
              <span
                className="block"
                style={{
                  height: `${((punkt.solved / maxTag) * 48).toFixed(1)}px`,
                  background: "var(--color-win)",
                }}
              />
            </span>
          ))}
        </div>
        <div className="blatt-zahl mt-1 flex justify-between text-[10px] text-ink3">
          <span>{tagesspanne}</span>
          <span>{t("ins.pzAttempts")}</span>
        </div>
      </div>
    </div>
  );

  /**
   * Trefferquote nach Tageszeit · je Stunde eine Bahn mit der 50-%-Marke.
   *
   * Die gewöhnliche Fassung färbt die Balken nach gut/mittel/schlecht; im
   * Blatt sagt das der Strich auf der Bahn, und die Zeilen beschriften sich
   * selbst. Stunden ohne Versuch stehen gar nicht erst da.
   */
  const tageszeit = puzzles != null && stunden.length > 0 && (
    <div>
      <Rubrik weg={t("ins.pzByHourNote")}>{t("ins.pzByHour")}</Rubrik>
      {stunden.map((fenster, index) => (
        <Bahn
          key={fenster.key}
          name={`${deInt(fenster.key)} ${t("ins.oclock")}`}
          neben={t("ins.trAttemptsNote", { n: deInt(fenster.attempts) })}
          wert={trefferquote(fenster)}
          anzeige={`${de(trefferquote(fenster))} %`}
          marke={50}
          markeFarbe="var(--color-ink3)"
          breite={mobile ? 72 : 78}
          wertBreite={58}
          hoehe={30}
          letzte={index === stunden.length - 1}
        />
      ))}
    </div>
  );

  const motivtabelle = puzzles != null && puzzles.themes.length > 0 && (
    <div>
      <Rubrik weg={t("ins.trThemeTableSummary", { n: deInt(puzzles.themes.length) })}>
        {t("ins.pzThemeTable")}
      </Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.pzTheme") },
          { label: t("ins.pzAttempts"), breite: 62, rechts: true, zahl: true, blass: true },
          { label: t("ins.pzSolved"), breite: 62, rechts: true, zahl: true, blass: true },
          { label: t("ins.pzSolveRate"), breite: 66, rechts: true, zahl: true },
        ]}
        zeilen={[...puzzles.themes]
          .sort((a, b) => b.attempts - a.attempts)
          .map((thema) => [
            themeLabel(thema.theme, locale),
            deInt(thema.attempts),
            deInt(thema.solved),
            `${de(trefferquote(thema))} %`,
          ])}
      />
    </div>
  );

  // Die Bilanz kommt nach · sie lädt eigenständig und gibt es nur am Rechner.
  const bilanz = desktop && <Bilanz mobile={mobile} />;

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {koennen}
        {wirkung}
        {aufkommen}
        {bilanz}
        {verlauf}
        {motive}
        {tageszeit}
        {motivtabelle}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {koennen}
          {aufkommen}
          {verlauf}
          {tageszeit}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {wirkung}
          {bilanz}
          {motive}
          {motivtabelle}
        </div>
      </div>
    </div>
  );
}
