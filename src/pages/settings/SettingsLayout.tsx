import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // Steht das Feld in einem Raster, ist seine Zelle so hoch wie die höchste
    // der Reihe · eine Beschriftung, die auf zwei Zeilen umbricht (etwa
    // „Analyse-Engines (0 = automatisch)"), schob dann ihre Eingabe gegenüber
    // den Nachbarn nach unten. Die Beschriftung bleibt oben, die Eingabe
    // rutscht ans untere Ende der Zelle: So stehen die Eingaben einer Reihe
    // auf einer Linie, ganz gleich wie lang die Wörter darüber sind.
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[12px] text-ink3">{label}</span>
      <span className="mt-auto flex flex-col gap-1.5">{children}</span>
    </label>
  );
}

/** Wochentage der Trainingstage-Auswahl · Index 0 = Montag. */
export const WEEKDAY_KEYS = [
  "set.dayMon",
  "set.dayTue",
  "set.dayWed",
  "set.dayThu",
  "set.dayFri",
  "set.daySat",
  "set.daySun",
] as const;

export const inputCls =
  "w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none";

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls}
      />
    </Field>
  );
}

/** Bereichskennung · trägt Sprungmarke, Navigationseintrag und Nachladen. */
export type SectionId =
  | "language"
  | "appearance"
  | "tour"
  | "plus"
  | "accounts"
  | "annotations"
  | "sound"
  | "notify"
  | "widgets"
  | "sync"
  | "updates"
  | "privacy"
  | "support"
  | "engine"
  | "database"
  | "chessdb"
  | "explorer"
  | "refdb"
  | "puzzles"
  | "about"
  | "reset";

/**
 * Gruppen der Einstellungen · sie beantworten die Frage, mit der man die Seite
 * öffnet: „Wo suche ich?"
 *
 * Vorher war es eine Liste aus achtzehn gleichwertigen Karten mit einer
 * einzigen Zwischenüberschrift ganz unten. Wer die Sprache umstellen wollte,
 * las an Erinnerungen, Synchronisierung und Eröffnungsbuch vorbei.
 *
 * · `basics`   — einmal einstellen, gilt überall: Sprache, Thema, Rundgang.
 * · `account`  — wer man ist und wo die Daten herkommen: Plus, Schachkonten,
 *                Synchronisierung.
 * · `training` — was beim Üben passiert: Klänge, Erinnerungen, Widgets.
 * · `app`      — die App als Programm: Updates, Datenschutz, Rückmeldung,
 *                Lizenzen.
 * · `advanced` — was man einmal einrichtet und danach nie wieder anfasst,
 *                plus alles, was Daten löschen kann.
 */
export const SECTION_GROUPS = ["basics", "account", "training", "app", "advanced"] as const;

export type GroupId = (typeof SECTION_GROUPS)[number];

export interface Section {
  id: SectionId;
  icon: LucideIcon;
  title: string;
  /** Eine Zeile, die sagt, was der Bereich enthält. */
  summary: string;
  tone?: "accent" | "loss";
  /** Bestimmt Zwischenüberschrift und Reihenfolge · siehe SECTION_GROUPS. */
  group: GroupId;
  content: ReactNode;
}

/**
 * Bereiche in Gruppenreihenfolge. Innerhalb einer Gruppe bleibt die
 * Reihenfolge der Deklaration erhalten (`sort` ist stabil) · so steht die
 * Gruppierung an einer Stelle und muss nicht zusätzlich in die Reihenfolge
 * des Quelltexts einsortiert werden.
 */
export function inGroupOrder(sections: Section[]): Section[] {
  return [...sections].sort(
    (a, b) => SECTION_GROUPS.indexOf(a.group) - SECTION_GROUPS.indexOf(b.group)
  );
}

/** DOM-Id der Sprungmarke eines Bereichs. */
export const anchorId = (id: SectionId) => `set-${id}`;

/**
 * Die Höhe unter der Fensterkante, an der die Sprungleiste umschaltet · der
 * Bereich, dessen Kopf zuletzt über dieser Linie durchgelaufen ist, gilt als
 * der laufende.
 */
export const SPY_LINE = 88;

/** Der scrollende Vorfahr eines Knotens · in der Shell das `<main>`. */
function scrollParent(node: HTMLElement): HTMLElement {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

/**
 * Wie viel Freiraum hinter dem letzten Bereich stehen muss.
 *
 * Die Liste hört bisher dort auf, wo das Fenster aufhört · die letzten
 * Bereiche kommen dadurch nie bis an die Linie der Sprungleiste heran. Das
 * hatte zwei sichtbare Folgen: Ganz unten blieb der drittletzte Eintrag
 * („Referenzdatenbank") hervorgehoben, und ein Klick auf die beiden darunter
 * tat gar nichts, weil schon nichts mehr zu scrollen war.
 *
 * Der Freiraum ist genau so hoch, dass auch der letzte Bereich noch nach oben
 * wandern kann · keinen Bildpunkt höher. Er steht nur in der breiten Fassung,
 * denn nur dort gibt es die Sprungleiste, zu der er gehört.
 */
export function sectionTailHeight(last: HTMLElement | undefined): number {
  if (!last) return 0;
  const box = scrollParent(last);
  const rect = box.getBoundingClientRect();
  // Ein Stück über der Linie, damit der Bereich nach dem Sprung sicher als
  // laufender gilt und nicht genau auf der Kante liegen bleibt.
  const target = SPY_LINE - 16;
  return Math.max(0, Math.round(rect.top + box.clientHeight - target - last.offsetHeight));
}

/** Der Freiraum selbst · leer, und nur da, wo die Sprungleiste steht. */
export function SectionTail({ height }: { height: number }) {
  return <div aria-hidden className="hidden min-[1160px]:block" style={{ height }} />;
}

/**
 * Ein Einstellungsbereich.
 *
 * Auf dem Desktop steht der Bereich offen da · ein Fenster hat den Platz, und
 * Scrollen mit dem Rad kostet nichts.
 *
 * Auf dem Handy sind dreizehn offene Karten eine Wand aus Text. Dort wird
 * derselbe Bereich eine zugeklappte Zeile mit Symbol, Titel und einer Zeile
 * darüber, was drin steckt · aufgeklappt wird, was man gerade sucht.
 *
 * Sichtbar werden heißt auch: die Daten des Bereichs werden jetzt gebraucht.
 * Deshalb meldet der Bereich das nach oben, statt dass die Seite beim Öffnen
 * alles auf einmal lädt.
 */
export function SettingsSection({
  mobile,
  id,
  icon: Icon,
  title,
  summary,
  tone = "accent",
  onReveal,
  children,
}: {
  mobile: boolean;
  id: SectionId;
  icon: LucideIcon;
  title: string;
  summary: string;
  tone?: "accent" | "loss";
  onReveal: (id: SectionId) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const color = tone === "loss" ? "text-loss" : "text-accent";
  const shown = !mobile || open;

  useEffect(() => {
    if (shown) onReveal(id);
  }, [shown, id, onReveal]);

  const badge = (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel2 ${color}`}
    >
      <Icon size={16} />
    </span>
  );

  if (!mobile) {
    return (
      <section
        id={anchorId(id)}
        data-settings-section={id}
        className="scroll-mt-4 overflow-hidden rounded-xl border border-line bg-panel"
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          {badge}
          <span className="min-w-0">
            <h2 className="text-[13.5px] font-medium text-ink">{title}</h2>
            <span className="block truncate text-[11.5px] text-ink3">{summary}</span>
          </span>
        </header>
        <div className="p-4">{children}</div>
      </section>
    );
  }

  return (
    <section id={anchorId(id)} className="overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        {badge}
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium text-ink">{title}</span>
          <span className="block truncate text-[11.5px] text-ink3">{summary}</span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-line p-4">{children}</div>}
    </section>
  );
}

/**
 * Sprungleiste für breite Fenster · dieselbe Reihenfolge und Gruppierung wie
 * die Bereiche selbst, nur als stehendes Verzeichnis daneben. Auf dem Handy
 * übernimmt das Zuklappen diese Aufgabe, dort gibt es sie nicht.
 */
export function SectionNav({
  sections,
  active,
  groupLabel,
  label,
  onJump,
}: {
  sections: Section[];
  active: SectionId | null;
  /** Überschrift einer Gruppe · dieselben Wörter wie in der Seite daneben. */
  groupLabel: (group: GroupId) => string;
  label: string;
  onJump: (id: SectionId) => void;
}) {
  return (
    <div className="hidden min-[1160px]:block">
      <nav aria-label={label} className="sticky top-0 flex flex-col gap-0.5 pt-1">
        {sections.map((section, index) => {
          const Icon = section.icon;
          const current = section.id === active;
          return (
            <Fragment key={section.id}>
              {section.group !== sections[index - 1]?.group && (
                <div className="px-3 pb-1 pt-4 text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink3 first:pt-0">
                  {groupLabel(section.group)}
                </div>
              )}
              <button
                type="button"
                onClick={() => onJump(section.id)}
                aria-current={current ? "true" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[12.5px] transition-colors ${
                  current
                    ? "bg-panel2 font-medium text-ink"
                    : "text-ink2 hover:bg-panel2/60 hover:text-ink"
                }`}
              >
                <Icon
                  size={15}
                  className={
                    section.tone === "loss"
                      ? "shrink-0 text-loss"
                      : current
                        ? "shrink-0 text-accent"
                        : "shrink-0 text-ink3"
                  }
                />
                <span className="truncate">{section.title}</span>
              </button>
            </Fragment>
          );
        })}
      </nav>
    </div>
  );
}
