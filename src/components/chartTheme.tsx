/**
 * Farben und Tooltip der Diagramme.
 *
 * Auch hier stehen keine Farbwerte, sondern Tokens: Recharts reicht `stroke`
 * und `fill` als SVG-Präsentationsattribute durch, und die behandelt der
 * Browser als CSS-Eigenschaften · `var()` trägt darin genauso wie in einer
 * Klasse. Die Diagramme folgen dem Thema deshalb ohne Zutun und ohne ein
 * Neuzeichnen von Hand.
 */
import type { TooltipContentProps } from "recharts";
import { deInt } from "../lib/format";

export const chart = {
  grid: "var(--color-line)",
  axis: "var(--color-line2)",
  tick: { fill: "var(--color-ink3)", fontSize: 11.5 },
  cc: "var(--color-cc)",
  li: "var(--color-blue)",
  win: "var(--color-win)",
  draw: "var(--color-draw)",
  loss: "var(--color-loss)",
  inaccuracy: "var(--color-gold)",
  mistake: "var(--color-warn)",
  blunder: "var(--color-loss)",
  accent: "var(--color-accent)",
  gold: "var(--color-gold)",
  violet: "var(--color-violet)",
};

/**
 * Die Farbe einer Ratingreihe · je Plattform und Modus dieselbe, auf dem Start
 * wie in den Insights und in beiden Modi. `cc` und `li` sind die Reihen der
 * Demo-Ansicht.
 */
export const RATING_COLORS: Record<string, string> = {
  "chess.com-rapid": chart.cc,
  "chess.com-blitz": chart.gold,
  "chess.com-bullet": chart.mistake,
  "chess.com-daily": chart.violet,
  "lichess-rapid": chart.li,
  "lichess-blitz": chart.accent,
  "lichess-bullet": chart.loss,
  "lichess-daily": "#b09bea",
  cc: chart.cc,
  li: chart.li,
};

/**
 * Eigenschaften, die jede Zeichenfläche trägt.
 *
 * Recharts 3 macht ein Diagramm von sich aus tastaturbedienbar:
 * `accessibilityLayer` steht auf `true` und setzt `tabindex="0"` samt
 * `role="application"` auf das <svg>. Auf dem Telefon ist das ein Rückschritt.
 * Eine Berührung setzt damit den Fokus, der Browser zieht seinen eigenen
 * orangefarbenen Fokusrahmen um die ganze Fläche · ein Rahmen, den sonst kein
 * Bedienelement der App hat · und der Fokus stellt den Tooltip zusätzlich auf
 * den *ersten* Messpunkt, statt auf den berührten. Wer im August tippt, liest
 * den Stand vom April.
 *
 * Verloren geht dadurch nichts: Die Zahlen hinter den Diagrammen stehen auf
 * denselben Seiten als Kennzahl, Liste oder Legende, und die Zeichenfläche
 * selbst hat nie eine Auskunft getragen, die es nur dort gab.
 */
export const chartSurface = { accessibilityLayer: false } as const;

/**
 * Höhe der Ratingverlaufs-Zeichenfläche.
 *
 * Sie steht hier und nicht in RatingHistoryChart.tsx, weil der Start sie schon
 * für seinen Platzhalter braucht · ein statischer Import der Diagrammdatei
 * zöge Recharts wieder ins Startbündel und machte das Nachladen sinnlos.
 */
export const RATING_CHART_HEIGHT = 230;

/**
 * Hover-Fläche der Balkendiagramme. Recharts hebt die Spalte sonst mit einem
 * hellen Grau hervor, das im dunklen Layout wie ein Fehler aussieht.
 */
export const barCursor = {
  fill: "var(--color-accent)",
  fillOpacity: 0.1,
  radius: 6,
} as const;

/**
 * Tooltip der Diagramme · liegt auf Panel-Farben und folgt dem Thema damit
 * ohne Zutun.
 */
/**
 * Die Eigenschaften, die Recharts einem eigenen Tooltip übergibt.
 *
 * `Partial`, weil Recharts sie erst beim Zeigen füllt: Als Element geschrieben
 * (`content={<ChartTooltip />}`) trägt der Aufruf keine einzige davon, und die
 * Bibliothek klont ihn zur Laufzeit mit den Werten der Stelle unter dem
 * Zeiger. Seit Version 3 sind sie im Typ verpflichtend · ohne `Partial` müsste
 * jede Diagrammseite Fantasiewerte hinschreiben.
 */
export type ChartTooltipProps = Partial<TooltipContentProps<number, string>>;

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 shadow-xl">
      {label != null && <div className="mb-1 text-[11.5px] text-ink3">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-[12.5px] text-ink">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink2">{p.name}:</span>
          <span className="font-medium">{typeof p.value === "number" ? deInt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
