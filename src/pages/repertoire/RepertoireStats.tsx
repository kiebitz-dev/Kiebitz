import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useT } from "../../lib/i18n";
import { type RepGap, type RepStats } from "../../lib/repertoire";
import { Button, Card, Chip } from "../../components/ui";
import { useMobileShell } from "../../components/MobileShell";
import { de } from "../../lib/format";

const COVERAGE_PLIES = [6, 8, 12, 16];

function moveText(sans: string[]): string {
  return sans.map((move, index) => (index % 2 === 0 ? `${index / 2 + 1}.${move}` : move)).join(" ");
}

/** Abdeckung: wie oft die letzten Partien im Buch blieben · je Farbe getrennt. */
export function CoverageCard({
  stats,
  plies,
  onPlies,
}: {
  stats: RepStats | null;
  plies: number;
  onPlies: (value: number) => void;
}) {
  const t = useT();
  return (
    <Card title={t("rep.coverage")}>
      <div className="flex flex-wrap gap-1.5">
        {COVERAGE_PLIES.map((value) => (
          <Chip key={value} active={plies === value} onClick={() => onPlies(value)}>
            {t("rep.coveragePlies", { n: value })}
          </Chip>
        ))}
      </div>
      {stats ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[24px] font-semibold">{de(stats.coverage_pct)} %</span>
            <span className="text-[12px] text-ink3">
              {t("rep.coverageOf", { g: stats.games_checked })}
            </span>
          </div>
          {stats.by_side.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {stats.by_side.map((side) => (
                <div key={side.side} className="flex items-center gap-3 text-[12.5px]">
                  <span className="w-20 shrink-0 text-ink3">
                    {side.side === "white" ? t("common.asWhite") : t("common.asBlack")}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${side.pct}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums text-ink2">
                    {de(side.pct)} % · {side.games}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 text-[12.5px] text-ink3">{t("common.loading")}</div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.coverageNote")}</p>
    </Card>
  );
}

/**
 * Lücken aus den eigenen Partien · der kürzeste Weg zu neuen Varianten.
 *
 * Zugeklappt, weil die Liste lang wird und niemand sie bei jedem Blick aufs
 * Repertoire braucht · die Kopfzeile sagt trotzdem, wie viele es sind.
 */
export function GapsCard({ gaps, onAdopt }: { gaps: RepGap[] | null; onAdopt: (gap: RepGap) => void }) {
  const t = useT();
  const mobile = useMobileShell();
  const [open, setOpen] = useState(false);
  // Auf dem Handy bricht die Überschrift zweizeilig um, und die Zahl blieb
  // hinter ihrer zweiten Zeile stehen — mit Luft nach links und dem Knopf
  // dicht rechts daneben sah sie aus, als gehöre sie zu ihm. Sie gehört zur
  // Überschrift, also steht sie dort nur, wo dafür eine Zeile da ist. Verloren
  // geht sie nicht: Zugeklappt beginnt der Satz darunter mit derselben Zahl,
  // aufgeklappt steht die Liste selbst da.
  const count = !mobile && gaps != null && gaps.length > 0 ? gaps.length : null;
  return (
    <Card
      title={
        <span className="flex items-baseline gap-2">
          {t("rep.gaps")}
          {count != null && (
            <span className="text-[11.5px] font-normal tabular-nums text-ink3">{count}</span>
          )}
        </span>
      }
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
        >
          {t(open ? "rep.gapsHide" : "rep.gapsShow")}
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {!open ? (
        <p className="text-[12px] leading-relaxed text-ink3">
          {gaps == null
            ? t("common.loading")
            : gaps.length === 0
              ? t("rep.gapsNone")
              : t("rep.gapsCollapsed", { n: gaps.length })}
        </p>
      ) : gaps == null ? (
        <div className="text-[12.5px] text-ink3">{t("common.loading")}</div>
      ) : gaps.length === 0 ? (
        <div className="text-[12.5px] leading-relaxed text-ink3">{t("rep.gapsNone")}</div>
      ) : (
        <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {gaps.map((gap) => (
            <li
              key={`${gap.node_id}-${gap.side}-${gap.san}`}
              className="rounded-lg border border-line bg-panel2 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink">
                    {gap.mine
                      ? t("rep.gapMine", { san: gap.san, n: gap.count })
                      : t("rep.gapTheirs", { san: gap.san, n: gap.count })}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink3">
                    {moveText(gap.path_sans) || t("rep.startPos")}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">
                    {t("rep.gapBook", { sans: gap.book_sans.join(" / ") })} · {de(gap.score_pct)} %
                  </div>
                </div>
                <Button onClick={() => onAdopt(gap)} title={t("rep.gapAdopt")}>
                  <Plus size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.gapsNote")}</p>}
    </Card>
  );
}
