/**
 * Eröffnungen: die gespielten Systeme und der Abgleich mit dem Repertoire.
 *
 * Die zweite Hälfte ist der eigentliche Gewinn · sie beantwortet, ob die
 * Vorbereitung überhaupt bis aufs Brett kommt und wo sie zuerst reißt.
 */
import { useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { barCursor, chart, chartSurface, ChartTooltip } from "../../components/chartTheme";
import { useMobileShell } from "../../components/MobileShell";
import { Disclosure } from "../../components/ui";
import { familienTheorie } from "../../lib/eroeffnungstheorie";
import { useI18n } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import { repGaps, type RepGap } from "../../lib/repertoire";
import type { DeepInsights } from "../../lib/insights";
import type { LiveInsights } from "../../lib/stats";
import type { Finding } from "../../lib/findings";
import { Empty, FindingStrip, Kpi, MetricBar, Section, Stat } from "./parts";

export default function Openings({
  deep,
  live,
  findings,
  onAction,
  desktop,
  onOpenRepertoire,
}: {
  deep: DeepInsights;
  live: LiveInsights;
  findings: Finding[];
  onAction: (finding: Finding) => void;
  desktop: boolean;
  onOpenRepertoire: () => void;
}) {
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const { repertoire } = deep;
  const [gaps, setGaps] = useState<RepGap[] | null>(null);
  /**
   * Die Ideen der eigenen Eröffnungsfamilien · je eine, meistgespielte zuerst.
   *
   * Die Familien stehen oben schon als Auswertung; hier steht, worum es in
   * ihnen geht. Jede liegt zugeklappt, denn acht offene Absätze wären eine
   * Wand, und wer die Eröffnung kennt, braucht den Text nicht (siehe
   * lib/eroeffnungstheorie.ts).
   */
  const ideen = useMemo(
    () => familienTheorie(deep.openings.families.map((familie) => familie.label), locale),
    [deep.openings.families, locale]
  );
  const [offeneIdeen, setOffeneIdeen] = useState<ReadonlySet<string>>(new Set());
  const umschalten = (familie: string) =>
    setOffeneIdeen((stand) => {
      const neu = new Set(stand);
      if (neu.has(familie)) neu.delete(familie);
      else neu.add(familie);
      return neu;
    });

  // Die Lückenkarte spielt jede Partie am Buch entlang · erst laden, wenn der
  // Reiter offen ist und ein Repertoire überhaupt existiert.
  useEffect(() => {
    if (!desktop || repertoire.nodes === 0 || gaps) return;
    let cancelled = false;
    repGaps(20, 400, 10)
      .then((result) => !cancelled && setGaps(result))
      .catch(() => !cancelled && setGaps([]));
    return () => {
      cancelled = true;
    };
  }, [desktop, repertoire.nodes, gaps]);

  const totals = repertoire.by_side.reduce(
    (sum, side) => ({
      games: sum.games + side.games,
      mine: sum.mine + side.mine,
      theirs: sum.theirs + side.theirs,
      inBook: sum.inBook + side.in_book,
    }),
    { games: 0, mine: 0, theirs: 0, inBook: 0 }
  );

  return (
    <div className="space-y-4">
      <FindingStrip findings={findings} window={deep.window} onAction={onAction} />

      {repertoire.nodes > 0 && totals.games > 0 && (
        <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
          <Kpi
            label={t("ins.opInBook")}
            value={`${Math.round((totals.inBook / totals.games) * 100)} %`}
            sub={t("ins.opInBookSub", { n: deInt(totals.inBook), total: deInt(totals.games) })}
            tone={totals.inBook / totals.games >= 0.5 ? "good" : "warn"}
          />
          <Kpi
            label={t("ins.opMineFirst")}
            value={deInt(totals.mine)}
            sub={t("ins.opMineFirstSub")}
            tone={totals.mine > totals.theirs ? "bad" : undefined}
          />
          <Kpi
            label={t("ins.opTheirsFirst")}
            value={deInt(totals.theirs)}
            sub={t("ins.opTheirsFirstSub")}
          />
          <Kpi
            label={t("ins.opNodes")}
            value={deInt(repertoire.nodes)}
            sub={t("ins.opNodesSub", { n: repertoire.plies })}
          />
        </div>
      )}

      <Section
        title={t("ins.opDeviationTitle")}
        summary={
          repertoire.by_side.length > 0
            ? t("ins.opDeviationSummary", {
                n: deInt(totals.mine),
                total: deInt(totals.games),
              })
            : undefined
        }
        disabled={repertoire.nodes === 0}
        disabledNote={t("ins.opNoRepertoire")}
        defaultOpen
      >
        <div className="space-y-4">
          {repertoire.by_side.map((side) => (
            <div key={side.side} className="rounded-lg border border-line bg-panel2 p-3.5">
              <div className="mb-3 text-[12.5px] font-medium text-ink">
                {t(side.side === "white" ? "common.asWhite" : "common.asBlack")}{" "}
                <span className="text-ink3">· {t("ins.gamesCount", { n: side.games })}</span>
              </div>
              <div className="space-y-3">
                <MetricBar
                  label={t("ins.opStayed")}
                  note={t("ins.opStayedNote", { n: deInt(side.in_book) })}
                  value={side.in_book_score}
                />
                <MetricBar
                  label={t("ins.opTheyLeft")}
                  note={t("ins.opLeftNote", { n: deInt(side.theirs), m: de(side.avg_theirs_move) })}
                  value={side.theirs_score}
                />
                <MetricBar
                  label={t("ins.opILeft")}
                  note={t("ins.opLeftNote", { n: deInt(side.mine), m: de(side.avg_mine_move) })}
                  value={side.mine_score}
                />
              </div>
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.opDeviationNote")}</p>
        </div>
      </Section>

      <Section
        title={t("ins.opGapsTitle")}
        summary={gaps == null ? undefined : t("ins.opGapsSummary", { n: gaps.length })}
        disabled={repertoire.nodes === 0}
        disabledNote={t("ins.opNoRepertoire")}
      >
        {gaps == null ? (
          <Empty text={t("common.loading")} />
        ) : gaps.length === 0 ? (
          <Empty text={t("ins.opNoGaps")} />
        ) : (
          <div className="flex flex-col gap-2">
            {gaps.map((gap) => (
              <div
                key={`${gap.node_id}-${gap.side}-${gap.san}`}
                className="rounded-lg border border-line bg-panel2 px-3.5 py-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {gap.line || t("ins.opRootLine")}{" "}
                    <span className="font-medium text-accent">{gap.san}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink2">
                    {de(gap.score_pct)} %
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-ink3">
                  {t(gap.mine ? "ins.opGapMine" : "ins.opGapTheirs", { n: gap.count })}
                  {gap.book_sans.length > 0 && ` · ${t("ins.opBookKnows")}: ${gap.book_sans.join(", ")}`}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={onOpenRepertoire}
              className="mt-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] text-ink2 transition-colors hover:border-line2 hover:text-ink"
            >
              {t("fnd.action.repertoire")}
            </button>
          </div>
        )}
      </Section>

      <Section
        title={t("ins.opShakyTitle")}
        summary={t("ins.opShakySummary", { n: repertoire.shaky.length })}
        disabled={repertoire.shaky.length === 0}
        disabledNote={t("ins.opNoShaky")}
      >
        <div className="grid gap-2 min-[800px]:grid-cols-2">
          {repertoire.shaky.map((line) => (
            <Stat
              key={line.node_id}
              label={line.line || line.san}
              value={t("ins.opLapses", { n: line.lapses })}
              hint={t("ins.opShakyHint", { g: line.games, r: line.reps })}
            />
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.opShakyNote")}</p>
      </Section>

      {/* Familien statt PGN-Namen: „Sizilianisch" ist eine Trainingseinheit,
          „Sicilian Defense: Alapin, 2...d5" nicht. Getrennt nach Farbe, weil
          das die beiden verschiedenen Fragen sind. */}
      {(["white", "black"] as const).map((color) => {
        const families = deep.openings.families.filter((family) => family.color === color);
        if (families.length === 0) return null;
        return (
          <Section
            key={color}
            title={t(color === "white" ? "ins.opFamiliesWhite" : "ins.opFamiliesBlack")}
            summary={t(
              color === "white" ? "ins.opFamiliesWhiteSub" : "ins.opFamiliesBlackSub",
              { n: families.length, b: de(deep.openings.baseline_score) }
            )}
            defaultOpen={color === "black"}
          >
            <div className="space-y-3">
              {families.map((family) => (
                <MetricBar
                  key={family.key}
                  label={family.label}
                  note={t("ins.opFamilyNote", {
                    n: deInt(family.games),
                    m: family.avg_departure_ply > 0
                      ? Math.ceil(family.avg_departure_ply / 2)
                      : 0,
                    a: family.opening_accuracy == null ? "—" : de(family.opening_accuracy),
                  })}
                  value={family.score_pct}
                  good={deep.openings.baseline_score + 5}
                  bad={deep.openings.baseline_score - 5}
                />
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">
              {t("ins.opFamilyLegend", { b: de(deep.openings.baseline_score) })}
            </p>
          </Section>
        );
      })}

      {ideen.length > 0 && (
        <Section
          title={t("op.theoryTitle")}
          summary={t("op.theorySummary", { n: deInt(ideen.length) })}
          defaultOpen
        >
          <div className="flex flex-col gap-2">
            {ideen.map((idee) => (
              <Disclosure
                key={idee.schluessel}
                icon={<BookOpen size={14} className="text-accent" />}
                title={idee.schluessel}
                open={offeneIdeen.has(idee.schluessel)}
                onToggle={() => umschalten(idee.schluessel)}
              >
                {idee.text}
              </Disclosure>
            ))}
          </div>
        </Section>
      )}

      <Section title={t("ins.openingsTitle")} summary={t("ins.opPlayedSummary")} defaultOpen>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart {...chartSurface}
            data={live.openings}
            layout="vertical"
            margin={{ top: 0, right: 42, bottom: 0, left: 12 }}
            barSize={17}
          >
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={mobile ? 120 : 170}
              tick={{ ...chart.tick, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} cursor={barCursor} />
            <Bar dataKey="win" name={t("ins.winRate")} radius={[0, 4, 4, 0]}>
              {live.openings.map((opening) => (
                <Cell key={opening.name} fill={opening.win >= 50 ? chart.win : chart.loss} />
              ))}
              <LabelList
                dataKey="win"
                position="right"
                formatter={(value) => `${value} %`}
                style={{ fill: "var(--color-ink2)", fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <Section title={t("ins.openingTableTitle")} summary={t("ins.opTableSummary")}>
        {mobile ? (
          <div className="-mx-4 -my-4">
            {live.openingDetails.map((opening) => (
              <div
                key={`${opening.name}-${opening.color}`}
                className="border-b border-line/70 px-4 py-3 last:border-0"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{opening.name}</span>
                  <span
                    className={`shrink-0 text-[12.5px] font-medium tabular-nums ${
                      opening.scorePct >= 55 ? "text-win" : opening.scorePct < 40 ? "text-loss" : "text-ink2"
                    }`}
                  >
                    {opening.scorePct} %
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-ink3">
                  {t(opening.color === "white" ? "common.white" : "common.black")} ·{" "}
                  {t("ins.gamesCount", { n: opening.games })} · {t("ins.accuracyShort")}{" "}
                  {opening.accuracy == null ? "—" : `${de(opening.accuracy)} %`}
                </div>
              </div>
            ))}
            {live.openingDetails.length === 0 && <Empty text={t("ins.tooFewData")} />}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="border-b border-line bg-panel2 text-[10.5px] uppercase tracking-wide text-ink3">
                <tr>
                  <th className="px-4 py-2.5">{t("ins.opening")}</th>
                  <th className="px-3 py-2.5">{t("ins.color")}</th>
                  <th className="px-3 py-2.5 text-right">{t("ins.games")}</th>
                  <th className="px-3 py-2.5 text-right">{t("ins.scoreRate")}</th>
                  <th className="px-4 py-2.5 text-right">{t("ins.accuracyShort")}</th>
                </tr>
              </thead>
              <tbody>
                {live.openingDetails.map((opening) => (
                  <tr key={`${opening.name}-${opening.color}`} className="border-b border-line/70 last:border-0">
                    <td className="max-w-[310px] truncate px-4 py-3 text-[12.5px] text-ink">{opening.name}</td>
                    <td className="px-3 py-3 text-[12px] text-ink3">
                      {t(opening.color === "white" ? "common.white" : "common.black")}
                    </td>
                    <td className="px-3 py-3 text-right text-[12px] tabular-nums text-ink2">{opening.games}</td>
                    <td
                      className={`px-3 py-3 text-right text-[12px] font-medium tabular-nums ${
                        opening.scorePct >= 55 ? "text-win" : opening.scorePct < 40 ? "text-loss" : "text-ink2"
                      }`}
                    >
                      {opening.scorePct} %
                    </td>
                    <td className="px-4 py-3 text-right text-[12px] tabular-nums text-ink2">
                      {opening.accuracy == null ? "—" : `${de(opening.accuracy)} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {live.openingDetails.length === 0 && <Empty text={t("ins.tooFewData")} />}
          </div>
        )}
      </Section>
    </div>
  );
}
