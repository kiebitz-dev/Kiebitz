/**
 * Muster im Diagramm-Modus · der Reiter, der nicht vom Schach handelt,
 * sondern vom Spieler: Sitzungslänge, Tilt, Aufwärmen, und woher der
 * Ratingverlust kommt.
 *
 * Jede Bahn dieses Blattes trägt denselben Strich bei fünfzig Prozent. Eine
 * Punktequote ohne diese Marke ist nicht zu lesen — 47 % klingt nach viel und
 * ist es nicht.
 *
 * Der Ratingverlust steht als ein geteilter Balken: die drei schlimmsten
 * Sitzungen gegen alle übrigen. Das ist die ganze Aussage der Rubrik; ein
 * Balken je Sitzung hätte dreißig Striche und keine Pointe.
 *
 * Die Wärmekarte bleibt eine Karte. Wochentag mal Vier-Stunden-Fenster ist
 * eine Kreuztabelle, und die zwei Achsen dieser Tabelle sind genau die Frage —
 * sie zu Bahnen zu strecken hieße, eine davon wegzuwerfen. Sie verliert im
 * Blatt nur ihre Farbskala: Die Dichte einer Zelle steht als Deckung derselben
 * Schriftfarbe, und die Zahl steht in der Zelle.
 */
import { Fragment } from "react";
import { Bahn, Blatttabelle, Figur, Fussnote, Kennzahlen, Kurve, Rubrik } from "../../../components/blatt/Satz";
import { useI18n } from "../../../lib/i18n";
import { de, deInt } from "../../../lib/format";
import type { DeepInsights } from "../../../lib/insights";
import type { LiveInsights } from "../../../lib/stats";

export default function PatternsBlatt({
  mobile,
  deep,
  live,
}: {
  mobile: boolean;
  deep: DeepInsights;
  live: LiveInsights;
}) {
  const { t } = useI18n();
  const { sessions } = deep;

  const erste = sessions.by_index[0];
  const letzte = sessions.by_index[sessions.by_index.length - 1];
  const rest = 100 - sessions.damage.worst3_pct;
  const monate = live.resultTrend.filter((punkt) => punkt.games > 0);
  const punktequote = monate.map((punkt) => punkt.scorePct);
  const spanne = { breite: mobile ? 96 : 96, wertBreite: 52 };

  const kopf = (
    <div className="mb-5 flex items-end">
      <div className="min-w-0 flex-1">
        <Kennzahlen
          zahlen={[
            {
              name: t("ins.paSessions"),
              wert: deInt(sessions.sessions),
              neben: t("ins.paSessionsSub", { n: de(sessions.avg_games) }),
            },
            {
              name: t("ins.paLimit"),
              wert:
                sessions.recommended_length > 0
                  ? deInt(sessions.recommended_length)
                  : t("ins.paLimitNone"),
              neben: t("ins.paLimitSub"),
            },
            {
              name: t("ins.paTotalLoss"),
              wert: deInt(sessions.damage.total_loss),
              neben: t("ins.paTotalLossHint", { n: deInt(sessions.damage.sessions) }),
            },
            {
              name: t("ins.paWorst3"),
              wert: `${de(sessions.damage.worst3_pct)} %`,
              neben: t("ins.paWorst3Hint"),
            },
          ]}
        />
      </div>
    </div>
  );

  const sitzungskurve = sessions.by_index.length > 0 && (
    <div>
      <Rubrik
        weg={
          erste && letzte
            ? t("ins.paCurveSummary", { a: de(erste.score_pct), b: de(letzte.score_pct) })
            : undefined
        }
      >
        {t("ins.paCurveTitle")}
      </Rubrik>
      {sessions.by_index.map((punkt, index) => (
        <Bahn
          key={punkt.index}
          name={t("ins.paGameNo", { n: deInt(punkt.index) })}
          neben={t("blatt.gamesN", { n: deInt(punkt.games) })}
          wert={punkt.score_pct}
          anzeige={`${de(punkt.score_pct)} %`}
          max={Math.max(70, ...sessions.by_index.map((p) => p.score_pct))}
          marke={50}
          markeFarbe="var(--color-ink3)"
          rechts={punkt.accuracy == null ? "—" : de(punkt.accuracy)}
          hoehe={36}
          letzte={index === sessions.by_index.length - 1}
          {...spanne}
        />
      ))}
      <Fussnote>{t("ins.paCurveNote")}</Fussnote>
    </div>
  );

  const schaden = (
    <div>
      <Rubrik weg={t("ins.paDamageSummary", { p: de(sessions.damage.worst3_pct) })}>
        {t("ins.paDamageTitle")}
      </Rubrik>
      <Kennzahlen
        zahlen={[
          {
            name: t("ins.paTotalLoss"),
            wert: deInt(sessions.damage.total_loss),
            neben: t("ins.paTotalLossHint", { n: deInt(sessions.damage.sessions) }),
          },
          {
            name: t("ins.paWorst3"),
            wert: `${de(sessions.damage.worst3_pct)} %`,
            neben: t("ins.paWorst3Hint"),
          },
          {
            name: t("ins.paWorstSingle"),
            wert: deInt(sessions.damage.worst_delta),
            neben: t("ins.paWorstSingleHint"),
          },
        ]}
      />
      {sessions.damage.sessions > 3 && (
        <div className="mt-3">
          <div className="flex h-3.5 gap-[2px]">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, sessions.damage.worst3_pct)).toFixed(1)}%`,
                background: "var(--color-loss)",
              }}
            />
            <span
              style={{
                width: `${Math.max(0, Math.min(100, rest)).toFixed(1)}%`,
                background: "var(--color-ink3)",
              }}
            />
          </div>
          <div className="blatt-zahl mt-1 flex justify-between text-[10.5px] text-ink3">
            <span>{t("ins.paWorst3Hint")}</span>
            <span>{t("blatt.gamesN", { n: deInt(sessions.damage.sessions - 3) })}</span>
          </div>
        </div>
      )}
      <Fussnote>{t("ins.paDamageNote")}</Fussnote>
    </div>
  );

  const tilt = (
    <div>
      <Rubrik
        weg={t("ins.paRequeueSummary", {
          f: de(sessions.requeue.fast_score),
          s: de(sessions.requeue.slow_score),
        })}
      >
        {t("ins.paRequeueTitle")}
      </Rubrik>
      <Bahn
        name={t("ins.paFast", {
          t: deInt(sessions.requeue.threshold),
          n: deInt(sessions.requeue.fast_games),
        })}
        wert={sessions.requeue.fast_score}
        anzeige={`${de(sessions.requeue.fast_score)} %`}
        marke={50}
        markeFarbe="var(--color-ink3)"
        breite={mobile ? 140 : 148}
        hoehe={34}
      />
      <Bahn
        name={t("ins.paSlow", { n: deInt(sessions.requeue.slow_games) })}
        wert={sessions.requeue.slow_score}
        anzeige={`${de(sessions.requeue.slow_score)} %`}
        marke={50}
        markeFarbe="var(--color-ink3)"
        breite={mobile ? 140 : 148}
        hoehe={34}
        letzte
      />
      <Fussnote>{t("ins.paRequeueNote")}</Fussnote>
    </div>
  );

  const aufwaermen = (
    <div>
      <Rubrik
        weg={t("ins.paWarmupSummary", {
          f: de(sessions.warmup.first_score),
          r: de(sessions.warmup.rest_score),
        })}
      >
        {t("ins.paWarmupTitle")}
      </Rubrik>
      {(
        [
          [t("ins.paFirstOfDay", { n: deInt(sessions.warmup.first_games) }), sessions.warmup.first_score],
          [t("ins.paRestOfDay", { n: deInt(sessions.warmup.rest_games) }), sessions.warmup.rest_score],
          [t("ins.paPrimed", { n: deInt(sessions.warmup.primed_games) }), sessions.warmup.primed_score],
          [t("ins.paCold", { n: deInt(sessions.warmup.cold_games) }), sessions.warmup.cold_score],
        ] as const
      ).map(([name, wert], index, alle) => (
        <Bahn
          key={name}
          name={name}
          wert={wert}
          anzeige={`${de(wert)} %`}
          marke={50}
          markeFarbe="var(--color-ink3)"
          breite={mobile ? 140 : 148}
          hoehe={32}
          letzte={index === alle.length - 1}
        />
      ))}
      <Fussnote>{t("ins.paPrimedNote")}</Fussnote>
    </div>
  );

  const verlauf = punktequote.length > 1 && (
    <div>
      <Rubrik weg={t("ins.paTrendSummary")}>{t("ins.resultTrendTitle")}</Rubrik>
      <Figur
        titel={t("ins.scoreRate")}
        rechts={`${de(punktequote[punktequote.length - 1])} %`}
        links={`${de(punktequote[0])} %`}
        unten={t("blatt.monthsNote")}
      >
        <Kurve
          werte={punktequote}
          linie={50}
          min={Math.min(40, ...punktequote)}
          max={Math.max(60, ...punktequote)}
        />
      </Figur>
      <Fussnote>{t("ins.resultTrendNote")}</Fussnote>
    </div>
  );

  // Wochentag und Tageszeit · zwei Bahnenreihen und darunter die Wärmekarte.
  const rhythmus = (live.byWeekday.length > 0 || live.byTimeSlot.length > 0) && (
    <div>
      <Rubrik weg={t("ins.paRhythmSummary")}>{t("ins.paRhythmTitle")}</Rubrik>
      <div className={mobile ? "flex flex-col gap-5" : "flex gap-9"}>
        <div className="min-w-0 flex-1">
          <div className="blatt-feld text-ink3">{t("ins.weekdayPerformance")}</div>
          {live.byWeekday.map((tag, index) => (
            <Bahn
              key={tag.day}
              name={tag.day}
              neben={t("blatt.gamesN", { n: deInt(tag.games) })}
              wert={tag.scorePct}
              anzeige={tag.games === 0 ? "—" : `${de(tag.scorePct)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={64}
              wertBreite={48}
              hoehe={28}
              letzte={index === live.byWeekday.length - 1}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="blatt-feld text-ink3">{t("ins.timePerformance")}</div>
          {live.byTimeSlot.map((fenster, index) => (
            <Bahn
              key={fenster.slot}
              name={`${fenster.slot} ${t("ins.oclock")}`}
              neben={t("blatt.gamesN", { n: deInt(fenster.games) })}
              wert={fenster.scorePct}
              anzeige={fenster.games === 0 ? "—" : `${de(fenster.scorePct)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={72}
              wertBreite={48}
              hoehe={28}
              letzte={index === live.byTimeSlot.length - 1}
            />
          ))}
        </div>
      </div>
      {live.activity.values.length > 0 && (
        <div className="mt-4">
          <div className="blatt-feld text-ink3">{t("ins.activityTitle")}</div>
          <Waermekarte activity={live.activity} />
        </div>
      )}
    </div>
  );

  const laenge = live.byLength.length > 0 && (
    <div>
      <Rubrik>{t("ins.lengthTitle")}</Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.lengthTitle") },
          { label: t("ins.games"), breite: 60, rechts: true, zahl: true, blass: true },
          { label: t("ins.scoreRate"), breite: 62, rechts: true, zahl: true },
          { label: t("ins.accuracyShort"), breite: 74, rechts: true, zahl: true, blass: true },
        ]}
        zeilen={live.byLength.map((eintrag) => [
          eintrag.bucket,
          deInt(eintrag.games),
          `${de(eintrag.scorePct)} %`,
          eintrag.accuracy == null ? "—" : `${de(eintrag.accuracy)} %`,
        ])}
      />
    </div>
  );

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {sitzungskurve}
        {tilt}
        {aufwaermen}
        {schaden}
        {verlauf}
        {rhythmus}
        {laenge}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {sitzungskurve}
          {schaden}
          {laenge}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {tilt}
          {aufwaermen}
          {verlauf}
          {rhythmus}
        </div>
      </div>
    </div>
  );
}

/**
 * Wochentag mal Vier-Stunden-Fenster · im Blatt ohne Farbskala.
 *
 * Die Dichte einer Zelle steht als Deckung der Schriftfarbe, die Zahl steht
 * darin. Damit bleibt die Karte auch dann lesbar, wenn jemand sie ausdruckt
 * oder in einem Thema mit wenig Farbe liest.
 */
function Waermekarte({
  activity,
}: {
  activity: { days: string[]; slots: string[]; values: number[][] };
}) {
  const max = Math.max(1, ...activity.values.flat());
  return (
    <div className="mt-2 overflow-x-auto">
      <div
        className="grid min-w-[280px] gap-px"
        style={{ gridTemplateColumns: `32px repeat(${activity.slots.length}, minmax(0, 1fr))` }}
      >
        <span />
        {activity.slots.map((fenster) => (
          <span key={fenster} className="blatt-feld pb-1 text-center text-ink3">
            {fenster}
          </span>
        ))}
        {activity.days.map((tag, zeile) => (
          <Fragment key={tag}>
            <span className="flex items-center text-[11px] text-ink3">{tag}</span>
            {activity.values[zeile].map((anzahl, spalte) => (
              <span
                key={spalte}
                className="relative flex h-7 items-center justify-center border border-line"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 bg-ink"
                  style={{ opacity: anzahl === 0 ? 0 : 0.08 + (anzahl / max) * 0.5 }}
                />
                <span className="blatt-zahl relative text-[10.5px] text-ink2">
                  {anzahl === 0 ? "" : anzahl}
                </span>
              </span>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
