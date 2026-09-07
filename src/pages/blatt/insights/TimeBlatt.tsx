/**
 * Zeit im Diagramm-Modus · das dichteste der fünf Blätter.
 *
 * Die Zeitauswertung hat in der gewöhnlichen Fassung acht aufklappbare
 * Abschnitte. Hier stehen sie aufgeschlagen untereinander: Ein Satzspiegel hat
 * kein Platzproblem, das ein Aufklappen lösen müsste.
 *
 * Gemessen wird durchweg der Anteil der Restzeit, den ein Zug kostet, nicht
 * die Sekunde — nur so sind Bullet und Rapid vergleichbar, und nur deshalb
 * dürfen „hingeworfen" und „lange gegrübelt" in einer Reihe stehen.
 *
 * Die Formattabelle bleibt eine Tabelle. Nicht alles wird im Blatt zur Bahn:
 * Sechs Spalten über drei Formate sind eine Kreuztabelle, und daraus eine
 * Reihe Balken zu machen hieße, fünf Spalten wegzuwerfen.
 */
import {
  Bahn,
  Bahnkopf,
  Blatttabelle,
  Fussnote,
  Kennzahlen,
  Rubrik,
} from "../../../components/blatt/Satz";
import { useI18n, type Key } from "../../../lib/i18n";
import { de, deInt } from "../../../lib/format";
import type { DeepInsights } from "../../../lib/insights";
import Reiterkopf from "./Reiterkopf";

export default function TimeBlatt({ mobile, deep }: { mobile: boolean; deep: DeepInsights }) {
  const { t } = useI18n();
  const { time, formats } = deep;
  const phasenname = (phase: string) => t(`ins.phase.${phase}` as Key);

  if (time.games === 0 || time.moves === 0) {
    return <div className="py-3 text-[12.5px] text-ink3">{t("ins.tmNoClocks")}</div>;
  }

  const schnell = time.by_speed.find((bucket) => bucket.key === "instant");
  const langsam = time.by_speed.find((bucket) => bucket.key === "long");
  const maxTempo = Math.max(4, ...time.by_speed.map((bucket) => bucket.errors_per_100));
  const spanne = { breite: mobile ? 104 : 104, wertBreite: 46 };

  const kopf = (
    <Reiterkopf
      mobile={mobile}
      spalten="1.35fr 1.3fr 1.2fr 1.2fr"
      felder={[
        {
          label: t("ins.tmTroubleShare"),
          wert: (
            <>
              <span className="blatt-zahl">{de(time.trouble.share_pct)} %</span>
              {" · "}
              {t("ins.tmTroubleSub", {
                n: deInt(time.trouble.games),
                p: de(time.trouble.games_pct),
              })}
            </>
          ),
          gross: true,
        },
        {
          label: t("ins.tmBookShare"),
          wert: (
            <>
              <span className="blatt-zahl">{de(time.theory.book_share_pct)} %</span>
              {" · "}
              {t("ins.tmBookSub", { n: deInt(time.theory.book_moves) })}
            </>
          ),
        },
        {
          label: t("ins.tmEdge"),
          wert: (
            <>
              <span className="blatt-zahl">{de(time.edge.avg_diff)} %</span>
              {" · "}
              {t("ins.tmEdgeSub", { n: deInt(time.edge.games) })}
            </>
          ),
        },
        {
          label: t("ins.tmFlag"),
          wert: (
            <>
              <span className="blatt-zahl">{deInt(time.trouble.flag_losses)}</span>
              {" · "}
              {t("ins.tmFlagSub", {
                p: de((time.trouble.flag_losses / Math.max(1, time.games)) * 100),
              })}
            </>
          ),
        },
      ]}
      kasten={{
        label: t("ins.tmTroubleStart"),
        wert: t("ins.tmMoveNo", { n: de(time.trouble.first_move) }),
        gross: 12,
      }}
    />
  );

  const tempo = time.by_speed.length > 0 && (
    <div>
      <Rubrik
        weg={
          schnell && langsam
            ? t("ins.tmSpeedSummary", {
                fast: de(schnell.errors_per_100),
                slow: de(langsam.errors_per_100),
              })
            : undefined
        }
      >
        {t("ins.tmSpeedTitle")}
      </Rubrik>
      <Bahnkopf was={t("ins.tmSpeedTitle")} wert={t("ins.tmErrorsPer100")} {...spanne} />
      {time.by_speed.map((bucket, index) => (
        <Bahn
          key={bucket.key}
          name={t(`ins.tmSpeed.${bucket.key}` as Key)}
          neben={t("ins.tmSpeedHint", { n: deInt(bucket.moves), s: de(bucket.share_pct) })}
          wert={bucket.errors_per_100}
          anzeige={de(bucket.errors_per_100)}
          max={maxTempo}
          hoehe={40}
          letzte={index === time.by_speed.length - 1}
          {...spanne}
        />
      ))}
      <Fussnote>{t("ins.tmSpeedNote")}</Fussnote>
    </div>
  );

  const phasen = time.by_phase.length > 0 && (
    <div>
      <Rubrik weg={t("ins.tmPhaseSummary")}>{t("ins.tmPhaseTitle")}</Rubrik>
      <Bahnkopf was={t("ins.tmPhaseTitle")} wert={t("ins.tmAvgShare")} {...spanne} />
      {time.by_phase.map((phase, index) => (
        <Bahn
          key={phase.phase}
          name={phasenname(phase.phase)}
          neben={t("ins.tmPhaseNote", { n: deInt(phase.moves), s: de(phase.avg_share) })}
          wert={phase.clock_pct}
          anzeige={`${de(phase.clock_pct)} %`}
          max={Math.max(60, ...time.by_phase.map((p) => p.clock_pct))}
          hoehe={38}
          letzte={index === time.by_phase.length - 1}
          {...spanne}
        />
      ))}
    </div>
  );

  const theorie = time.theory.games > 0 && (
    <div>
      <Rubrik weg={t("ins.tmTheorySummary", { p: de(time.theory.book_share_pct) })}>
        {t("ins.tmTheoryTitle")}
      </Rubrik>
      <Bahn
        name={t("ins.tmBookMove")}
        neben={t("blatt.moves") + " " + deInt(time.theory.book_moves)}
        wert={time.theory.book_avg_share}
        anzeige={`${de(time.theory.book_avg_share)} %`}
        max={Math.max(9, time.theory.book_avg_share, time.theory.own_avg_share)}
        breite={mobile ? 104 : 128}
        wertBreite={52}
        hoehe={32}
      />
      <Bahn
        name={t("ins.tmOwnMove")}
        wert={time.theory.own_avg_share}
        anzeige={`${de(time.theory.own_avg_share)} %`}
        max={Math.max(9, time.theory.book_avg_share, time.theory.own_avg_share)}
        breite={mobile ? 104 : 128}
        wertBreite={52}
        hoehe={32}
        letzte
      />
      <Fussnote>{t("ins.tmTheoryNote")}</Fussnote>
    </div>
  );

  const verlauf = time.drift.length > 0 && (
    <div>
      <Rubrik weg={t("ins.tmDriftSummary")}>{t("ins.tmDriftTitle")}</Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.paGameNo", { n: "" }), breite: 62 },
          { label: t("ins.games"), breite: 60, rechts: true, zahl: true, blass: true },
          { label: t("ins.tmAvgShare"), rechts: true, zahl: true },
          { label: t("ins.scoreRate"), breite: 62, rechts: true, zahl: true },
        ]}
        zeilen={time.drift.map((punkt) => [
          t("ins.paGameNo", { n: deInt(punkt.index) }),
          deInt(punkt.games),
          `${de(punkt.avg_share)} %`,
          `${de(punkt.score_pct)} %`,
        ])}
      />
      <Fussnote>{t("ins.tmDriftNote")}</Fussnote>
    </div>
  );

  const zeitnot = (
    <div>
      <Rubrik
        weg={t("ins.tmTroubleSummary", {
          e: de(time.trouble.errors_per_100),
          b: de(time.trouble.baseline_per_100),
        })}
      >
        {t("ins.tmTroubleTitle")}
      </Rubrik>
      <Kennzahlen
        zahlen={[
          {
            name: t("ins.tmTroubleMoves"),
            wert: deInt(time.trouble.moves),
            neben: t("ins.tmTroubleMovesHint", { p: de(time.trouble.share_pct) }),
          },
          {
            name: t("ins.tmErrorsPer100"),
            wert: de(time.trouble.errors_per_100),
            neben: de(time.trouble.baseline_per_100),
          },
          {
            name: t("ins.tmScoreTrouble"),
            wert: `${de(time.trouble.score_in_trouble)} %`,
            neben: t("ins.tmScoreWithout", { p: de(time.trouble.score_without) }),
          },
          {
            name: t("ins.tmFlag"),
            wert: deInt(time.trouble.flag_losses),
            neben: t("blatt.gamesN", { n: deInt(time.games) }),
          },
          ...(time.increment.games > 0
            ? [
                {
                  name: t("ins.tmIncrement"),
                  wert: `${de(time.increment.over_increment_pct)} %`,
                  neben: t("ins.tmIncrementHint", {
                    s: de(time.increment.avg_spent),
                    i: deInt(time.increment.increment),
                  }),
                },
              ]
            : []),
        ]}
      />
      <div className="mt-3">
        <Bahn
          name={t("ins.tmTroubleTitle")}
          neben={t("ins.tmTroubleMovesHint", { p: de(time.trouble.share_pct) })}
          wert={time.trouble.errors_per_100}
          anzeige={de(time.trouble.errors_per_100)}
          max={Math.max(12, time.trouble.errors_per_100)}
          farbe="var(--color-loss)"
          breite={mobile ? 104 : 118}
          wertBreite={44}
        />
        <Bahn
          name={t("ins.tmOnRest")}
          wert={time.trouble.baseline_per_100}
          anzeige={de(time.trouble.baseline_per_100)}
          max={Math.max(12, time.trouble.errors_per_100)}
          breite={mobile ? 104 : 118}
          wertBreite={44}
          letzte
        />
      </div>
      <Fussnote>
        {t("ins.tmErrorsPer100")} · {t("ins.tmTroubleStartHint")}
      </Fussnote>
    </div>
  );

  const denken = (
    <div>
      <Rubrik
        weg={t("ins.tmFocusSummary", {
          e: de(time.focus.error_share),
          o: de(time.focus.ok_share),
        })}
      >
        {t("ins.tmFocusTitle")}
      </Rubrik>
      {(
        [
          [t("ins.tmOnErrors"), time.focus.error_share, undefined],
          [t("ins.tmOnRest"), time.focus.ok_share, undefined],
          [
            t("ins.tmBalanced"),
            time.focus.balanced_share,
            t("blatt.moves") + " " + deInt(time.focus.balanced_moves),
          ],
          [
            t("ins.tmDecided"),
            time.focus.decided_share,
            t("blatt.moves") + " " + deInt(time.focus.decided_moves),
          ],
        ] as const
      ).map(([name, wert, neben], index, alle) => (
        <Bahn
          key={name}
          name={name}
          neben={neben}
          wert={wert}
          anzeige={`${de(wert)} %`}
          max={Math.max(
            9,
            time.focus.error_share,
            time.focus.ok_share,
            time.focus.balanced_share,
            time.focus.decided_share
          )}
          breite={mobile ? 128 : 154}
          hoehe={neben ? 34 : 30}
          letzte={index === alle.length - 1}
        />
      ))}
      <Fussnote>{t("ins.tmFocusNote")}</Fussnote>
    </div>
  );

  const uhrDuell = time.edge.games > 0 && (
    <div>
      <Rubrik
        weg={t("ins.tmEdgeSummary", {
          a: de(time.edge.ahead_score),
          b: de(time.edge.behind_score),
        })}
      >
        {t("ins.tmEdgeTitle")}
      </Rubrik>
      <Bahn
        name={t("ins.tmAhead", { n: deInt(time.edge.ahead_games) })}
        wert={time.edge.ahead_score}
        anzeige={`${de(time.edge.ahead_score)} %`}
        marke={50}
        markeFarbe="var(--color-ink3)"
        breite={mobile ? 128 : 148}
        hoehe={32}
      />
      <Bahn
        name={t("ins.tmBehind", { n: deInt(time.edge.behind_games) })}
        wert={time.edge.behind_score}
        anzeige={`${de(time.edge.behind_score)} %`}
        marke={50}
        markeFarbe="var(--color-ink3)"
        breite={mobile ? 128 : 148}
        hoehe={32}
        letzte
      />
      <Fussnote>{t("ins.tmEdgeNote")}</Fussnote>
    </div>
  );

  const formatTabelle = formats.formats.length > 0 && (
    <div>
      <Rubrik weg={t("ins.fmtSummaryPlain", { n: deInt(formats.comparable) })}>
        {t("ins.fmtTitle")}
      </Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.fmtFormat") },
          { label: t("ins.games"), breite: 50, rechts: true, zahl: true, blass: true },
          { label: t("ins.scoreRate"), breite: 54, rechts: true, zahl: true },
          { label: t("ins.fmtRating"), breite: 54, rechts: true, zahl: true, blass: true },
          { label: t("ins.fmtEdge"), breite: 50, rechts: true, zahl: true },
          { label: t("ins.fmtBlunders"), breite: 66, rechts: true, zahl: true },
          { label: t("ins.fmtMinutes"), breite: 58, rechts: true, zahl: true, blass: true },
        ]}
        zeilen={formats.formats.map((format) => [
          `${format.source} · ${format.time_class}`,
          deInt(format.games),
          `${de(format.score_pct)} %`,
          format.rating == null ? "—" : deInt(format.rating),
          format.perf_edge == null
            ? "—"
            : `${format.perf_edge > 0 ? "+" : ""}${deInt(format.perf_edge)}`,
          format.blunders_per_100 == null ? "—" : de(format.blunders_per_100),
          deInt(format.minutes),
        ])}
      />
      <Fussnote>{t("ins.fmtSkillNote")}</Fussnote>
    </div>
  );

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {tempo}
        {zeitnot}
        {denken}
        {phasen}
        {uhrDuell}
        {theorie}
        {verlauf}
        {formatTabelle}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {tempo}
          {phasen}
          {theorie}
          {verlauf}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {zeitnot}
          {denken}
          {uhrDuell}
          {formatTabelle}
        </div>
      </div>
    </div>
  );
}
