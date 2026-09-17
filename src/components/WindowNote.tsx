/**
 * Woraus die Befunde gerechnet sind.
 *
 * Ein Ratschlag ohne seinen Zeitraum ist nicht prüfbar: „Du gerätst in Zeitnot"
 * heißt etwas anderes, wenn es aus drei Wochen kommt, als wenn es aus fünf
 * Jahren kommt. Die Zeile steht deshalb überall dort, wo Befunde stehen · in
 * den Insights und beim Study-Coach.
 */
import { useI18n } from "../lib/i18n";
import { deInt } from "../lib/format";
import type { FindingWindow } from "../lib/insights";

export default function WindowNote({
  // Umbenannt beim Auspacken: `window` ist im Browser schon vergeben, und ein
  // verdecktes globales Objekt ist eine Falle für die nächste Änderung hier.
  window: span,
  className = "",
  blatt = false,
}: {
  window: FindingWindow;
  className?: string;
  /** Im Diagramm-Modus als Fußnote unter den Befunden gesetzt. */
  blatt?: boolean;
}) {
  const { t } = useI18n();
  if (span.games <= 0) return null;
  return (
    <p
      className={`${
        blatt ? "mt-2.5 text-[10.5px] leading-[1.6]" : "text-[11.5px] leading-relaxed"
      } text-ink3 ${className}`}
    >
      {span.days > 0
        ? t("ins.windowNote", { d: deInt(span.days), n: deInt(span.games) })
        : t("ins.windowAll", { n: deInt(span.games) })}
    </p>
  );
}
