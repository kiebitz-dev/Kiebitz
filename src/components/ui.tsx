import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ExternalLink } from "lucide-react";
import type { Result, Source } from "../data/demo";
import { resultColor, type UiGame } from "../lib/gameUi";
import { useT } from "../lib/i18n";
import { de } from "../lib/format";
import { openExternal } from "../lib/ext";

export function Card({
  title,
  action,
  children,
  className = "",
  bodyClass = "",
  pad = true,
  tour,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Klassen für den Rumpf unter der Überschrift. Braucht, wer eine Karte in
   * einer gestreckten Spalte füllen lässt: Die Höhe kommt dann von der Spalte,
   * und der Rumpf muss sie übernehmen, statt bei seinem Inhalt aufzuhören.
   */
  bodyClass?: string;
  pad?: boolean;
  /** Marke für den geführten Rundgang · siehe lib/tourSteps.ts. */
  tour?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`} data-tour={tour}>
      {(title || action) && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-medium text-ink2">{title}</h2>
          {action}
        </header>
      )}
      <div className={`${pad ? "p-4" : ""} ${bodyClass}`.trim()}>{children}</div>
    </section>
  );
}

/**
 * Eine Partie als zweizeilige Karte · die Handy-Alternative zur achtspaltigen
 * Tabelle, die sonst quer gescrollt werden muss. Oben steht, was die Partie
 * identifiziert (Ergebnis, Gegner, Genauigkeit), unten der Kontext.
 *
 * Die Filter-per-Klick-Verknüpfungen der Tabellenzellen entfallen hier · sie
 * wären bei dieser Größe kaum treffbar, und beide Seiten haben eigene
 * Filter-Bedienelemente.
 */
export function GameCard({
  game,
  onClick,
  selected = false,
  trailing,
}: {
  game: UiGame;
  onClick?: () => void;
  selected?: boolean;
  /** Zusatz rechts unten, etwa Tags oder ein externer Link. */
  trailing?: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`border-b border-line px-4 py-3 last:border-0 ${
        selected ? "bg-panel2" : ""
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-2">
        <ResultBadge result={game.result} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
          {game.opponent} <span className="text-ink3">({game.oppElo})</span>
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink2">
          {game.accuracy != null ? `${de(game.accuracy)} %` : "—"}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink3">
        <SourceBadge source={game.source} />
        <span className="min-w-0 flex-1 truncate">
          {game.tc} · {game.opening}
        </span>
        <span className="shrink-0">{game.date}</span>
        {trailing}
      </div>
    </div>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
        active
          ? "border-accent-dim bg-accent-soft text-accent"
          : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11.5px] text-ink2">
      {children}
    </span>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  const t = useT();
  const label =
    result === "win" ? t("common.win") : result === "loss" ? t("common.loss") : t("common.draw");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: resultColor[result] }}>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: resultColor[result] }}
      />
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: Source }) {
  const cc = source === "chess.com";
  const manual = source === "manual";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: cc ? "var(--color-cc)" : manual ? "var(--color-gold)" : "var(--color-blue)",
        background: cc ? "rgba(129,182,76,0.12)" : manual ? "rgba(210,170,70,0.12)" : "rgba(57,135,229,0.12)",
      }}
    >
      {cc ? "chess.com" : manual ? "PGN" : "lichess"}
    </span>
  );
}

export function ExtLink({ href, label, title }: { href: string; label?: string; title?: string }) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className="inline-flex items-center gap-1 text-[12.5px] text-ink3 transition-colors hover:text-accent"
    >
      {label}
      <ExternalLink size={13} />
    </a>
  );
}

/**
 * Aussehen einer Schaltfläche · als Zeichenkette, damit auch Elemente, die
 * keine `Button` sein können (das Menü unten braucht eigene ARIA-Attribute),
 * exakt gleich aussehen.
 *
 * `compact` ist ein Schalter und keine mitgegebene Klasse: Tailwind entscheidet
 * bei zwei Klassen derselben Eigenschaft nach der Reihenfolge im erzeugten
 * Stylesheet, nicht nach der Reihenfolge im `class`-Attribut · ein angehängtes
 * `px-2.5` verliert deshalb gegen das `px-3.5` von hier.
 */
export function buttonCls(primary = false, className = "", compact = false): string {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg ${
    compact ? "px-2.5" : "px-3.5"
  } py-2 text-[13px] font-medium transition-colors [&>svg]:shrink-0 ${
    primary
      ? "bg-accent text-accent-ink hover:bg-accent-hover"
      : "border border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
  } disabled:cursor-not-allowed disabled:opacity-45 ${className}`;
}

export function Button({
  children,
  primary = false,
  onClick,
  className = "",
  disabled = false,
  title,
  label,
  compact = false,
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  /** Vorlesbarer Name, wenn die Schaltfläche nur ein Symbol trägt. */
  label?: string;
  /** Schmaler · für Schaltflächen, die nur ein Symbol tragen. */
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={buttonCls(primary, className, compact)}
    >
      {children}
    </button>
  );
}

/**
 * Klapp-Menü für Aktionen, die eine Leiste sonst zumauern.
 *
 * Die Regel dahinter: Was man in einer Sitzung mehrmals anfasst, steht als
 * eigene Schaltfläche da; was man einmal im Monat braucht, steht hier drin.
 * Eine Leiste mit vier gleich lauten Knöpfen hat keinen Hauptknopf mehr.
 */
export function Menu({
  label,
  align = "end",
  compact = false,
  up = false,
  primary = false,
  icon,
  leading,
  className = "",
  block = false,
  children,
}: {
  label: string;
  /** An welcher Kante der Schaltfläche das Blatt aufgeht. */
  align?: "start" | "end";
  /** Nur der Pfeil · für Leisten, in denen kein Wort mehr Platz hat. */
  compact?: boolean;
  /**
   * Nach oben aufklappen · für Leisten am unteren Rand ihrer Fläche. Unter dem
   * Brett bliebe ein Blatt, das nach unten aufgeht, halb im Nichts stehen: auf
   * dem Handy hinter der Navigationsleiste, im Fokus-Brett abgeschnitten.
   */
  up?: boolean;
  /**
   * Laut wie eine Hauptschaltfläche · für den Fall, dass das Menü selbst die
   * Hauptaktion ist und nicht die Ablage neben ihr (siehe die Analyse-Leiste
   * auf Telefonbreite).
   */
  primary?: boolean;
  /** Ersetzt den Pfeil · für Leisten, in denen das Blatt keine Liste ist. */
  icon?: ReactNode;
  /** Symbol vor der Beschriftung · wie bei einer Schaltfläche mit Zeichen. */
  leading?: ReactNode;
  /** Klassen der Schaltfläche · für Leisten, die selbst über die Breite wachen. */
  className?: string;
  /**
   * Über die ganze Zeile · für Leisten, in denen das Menü die Hauptaktion ist
   * und allein in seiner Zeile steht. Ein Knopf, der dort rechts klebt und den
   * Rest der Zeile leer lässt, sieht aus wie ein Rest, nicht wie ein Angebot.
   */
  block?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // pointerdown statt click: Das Menü soll schon zugehen, bevor der Klick
    // auf dem Element darunter ankommt.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative min-w-0 ${block ? "w-full" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonCls(primary, `${block ? "w-full" : ""} ${className}`, compact)}
      >
        {leading}
        {!compact && label}
        {icon ?? (
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && (
        <div
          role="menu"
          // Ein Eintrag im Menü führt immer irgendwohin · danach hat das Blatt
          // seine Aufgabe erfüllt.
          onClick={() => setOpen(false)}
          // `w-max` statt der Breite, die sich aus der Lage ergibt: Ein
          // absolut gesetztes Blatt darf von Haus aus nur so breit werden wie
          // sein Anker, und aus „Alle analysieren (1 offen)" wurden neben dem
          // Plus-Hinweis drei gestapelte Wortfetzen. Es misst sich jetzt an
          // seinem längsten Eintrag und erst dann am Schirm.
          className={`absolute z-40 flex w-max min-w-[240px] max-w-[calc(100vw-1.5rem)] flex-col gap-0.5 rounded-xl border border-line2 bg-panel p-1.5 shadow-2xl shadow-black/40 ${
            up ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] leading-snug text-ink2 transition-colors hover:bg-panel2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 [&>svg]:shrink-0"
    >
      {children}
    </button>
  );
}

export function Spark({ data, color = "var(--color-accent)", width = 96, height = 30 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (width - 8) + 4;
      const y = height - 4 - ((v - min) / range) * (height - 8);
      return `${x},${y}`;
    })
    .join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} stroke="var(--color-panel)" strokeWidth="2" />
    </svg>
  );
}
