/**
 * Überblick: was gerade zählt, auf einem Bildschirm.
 *
 * Reihenfolge nach Nutzen · zuerst die Befunde (das ist die Antwort auf „woran
 * soll ich arbeiten"), dann das Profil, dann die Kennzahlen. Alles andere liegt
 * in den Fachreitern.
 */
import type { ReactNode } from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { Compass, Crosshair, Sparkles } from "lucide-react";
import { Card } from "../../components/ui";
import { chart, chartSurface } from "../../components/chartTheme";
import { useI18n, type Key } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import type { DeepInsights } from "../../lib/insights";
import type { LiveInsights } from "../../lib/stats";
import type { DnaAxis } from "../../lib/dna";
import { weakestAxis } from "../../lib/dna";
import type { Finding } from "../../lib/findings";
import { topFindings } from "../../lib/findings";
import { FindingCard, Kpi, Empty } from "./parts";
import WindowNote from "../../components/WindowNote";

export default function Overview({
  deep,
  live,
  dna,
  findings,
  onAction,
  onOpenGame,
  ratingHistory,
}: {
  deep: DeepInsights;
  live: LiveInsights;
  dna: DnaAxis[];
  findings: Finding[];
  onAction: (finding: Finding) => void;
  onOpenGame: (gameId: number, ply: number) => void;
  /** Der Ratingverlauf · fertig von der Seite, die Zeitraum und Auswahl hält. */
  ratingHistory?: ReactNode;
}) {
  const { t } = useI18n();
  const top = topFindings(findings);
  const weakest = weakestAxis(dna);
  const formDelta =
    live.recentForm.previousScorePct == null
      ? null
      : live.recentForm.scorePct - live.recentForm.previousScorePct;

  const radarData = dna.map((axis) => ({
    axis: t(`dna.${axis.key}` as Key),
    value: axis.reliable ? axis.value : 0,
    field: axis.field ?? 0,
  }));
  /**
   * Das Vergleichsfeld wird nur gezeichnet, wenn es zu *jeder* Achse eine
   * Vergleichszahl gibt.
   *
   * Es gibt sie nur zu zweien. Die übrigen Achsen bekamen darum eine 0, und
   * die Fläche fiel dort in den Mittelpunkt zusammen: ein Vieleck, das keine
   * Aussage ist, plus ein grauer Punkt in der Mitte, den nichts erklärt.
   * Lieber gar kein Vergleich als ein Vergleich mit einer erfundenen Null.
   */
  const hasField = dna.every((axis) => axis.field != null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi label={t("ins.totalGames")} value={deInt(live.totalGames)} sub={t("ins.localDb")} />
        <Kpi
          label={t("ins.scoreRate")}
          value={`${de(live.scoreRate)} %`}
          sub={t("ins.pointsNotWins")}
        />
        <Kpi
          label={t("ins.avgAccuracy")}
          value={live.avgAccuracy == null ? "—" : `${de(live.avgAccuracy)} %`}
          sub={t("ins.analysisCoverage", { p: live.analysisCoverage })}
        />
        <Kpi
          label={t("ins.form20")}
          value={`${live.recentForm.scorePct} %`}
          sub={
            formDelta == null
              ? t("ins.noComparison")
              : t(formDelta >= 0 ? "ins.formUp" : "ins.formDown", { p: Math.abs(formDelta) })
          }
          tone={formDelta == null ? undefined : formDelta >= 0 ? "good" : "bad"}
        />
      </div>

      {/* Befunde zuerst: das ist der Grund, warum jemand diese Seite öffnet. */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <Crosshair size={15} className="text-accent" /> {t("ins.topFindings")}
          </span>
        }
      >
        {top.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {top.map((finding) => (
              <FindingCard key={finding.id} finding={finding} onAction={onAction} />
            ))}
          </div>
        ) : (
          <Empty text={t("ins.noFindings")} />
        )}
        <WindowNote window={deep.window} className="mt-3 border-t border-line pt-3" />
      </Card>

      {ratingHistory}

      <div className="grid gap-4 min-[900px]:grid-cols-[1.1fr_1fr]">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Compass size={15} className="text-violet" /> {t("dna.title")}
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart {...chartSurface} data={radarData} outerRadius="72%">
              <PolarGrid stroke={chart.grid} />
              <PolarAngleAxis dataKey="axis" tick={{ ...chart.tick, fontSize: 11 }} />
              {hasField && (
                <Radar
                  name={t("dna.field")}
                  dataKey="field"
                  stroke={chart.axis}
                  fill={chart.axis}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={false}
                />
              )}
              {/* Ohne Tooltip erklärt nichts, was ein Punkt unter dem Zeiger
                  bedeutet · die Zahlen stehen ohnehin unter dem Bild. */}
              <Radar
                name={t("dna.you")}
                dataKey="value"
                stroke={chart.accent}
                fill={chart.accent}
                fillOpacity={0.28}
                dot={false}
                activeDot={false}
              />
            </RadarChart>
          </ResponsiveContainer>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-3 min-[560px]:grid-cols-3">
            {dna.map((axis) => (
              <div key={axis.key} className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[11.5px] ${axis.reliable ? "text-ink3" : "text-ink3/50"}`}>
                  {t(`dna.${axis.key}` as Key)}
                </span>
                <span
                  className={`shrink-0 text-[12px] font-medium tabular-nums ${
                    axis.reliable ? "text-ink2" : "text-ink3/50"
                  }`}
                >
                  {axis.reliable ? axis.value : "—"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("dna.note")}</p>
        </Card>

        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Sparkles size={15} className="text-gold" /> {t("ins.reportTitle")}
              </span>
            }
          >
            <p className="text-[12.5px] leading-relaxed text-ink2">
              {t("ins.reportBody", {
                n: deInt(live.totalGames),
                p: de(live.scoreRate),
                acc: live.avgAccuracy == null ? "—" : de(live.avgAccuracy),
              })}
            </p>
            {weakest && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink3">
                {t("ins.reportFocus", {
                  axis: t(`dna.${weakest.key}` as Key),
                  v: weakest.value,
                  detail: weakest.detail,
                })}
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              {[
                { label: t("ins.covAnalyzed"), value: deInt(deep.coverage.analyzed) },
                { label: t("ins.covClocks"), value: deInt(deep.coverage.with_clocks) },
                { label: t("ins.covMoves"), value: deInt(deep.coverage.moves_judged) },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[15px] font-semibold tabular-nums">{item.value}</div>
                  <div className="text-[10.5px] leading-snug text-ink3">{item.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {deep.spotlight && (
            <Card title={t("ins.spotlightTitle")}>
              <p className="text-[12.5px] leading-relaxed text-ink3">
                {t(
                  deep.spotlight.kind === "missed_win"
                    ? "ins.spotlightMissedWin"
                    : "ins.spotlightCollapse",
                  { m: de(deep.spotlight.magnitude), move: Math.ceil(deep.spotlight.ply / 2) }
                )}
              </p>
              <button
                type="button"
                onClick={() => onOpenGame(deep.spotlight!.game_id, deep.spotlight!.ply)}
                className="mt-3 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] text-ink2 transition-colors hover:border-line2 hover:text-ink"
              >
                {t("ins.spotlightOpen")}
              </button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
