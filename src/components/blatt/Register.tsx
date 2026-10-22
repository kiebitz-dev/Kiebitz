/**
 * Die Hülle des Diagramm-Modus · das Register statt der Navigationsleiste.
 *
 * Ein Buch führt vorne sein Inhaltsverzeichnis: Kapitel links, Punktlinie,
 * Zahl rechts. Dieselbe Zeile beantwortet damit zwei Fragen auf einmal — wohin
 * es geht und was dort offen ist. Der laufende Abschnitt bekommt kein
 * gefülltes Feld, sondern eine Marke am Bund, wie ein eingelegtes Lesezeichen.
 *
 * Das ist Hülle und nicht Seiteninhalt: Sie steht auf jedem Tab gleich, sonst
 * verwandelte sie sich beim Blättern. Sie erscheint nur, solange der Modus an
 * ist; App.tsx entscheidet das an einer Stelle.
 *
 * Die Zahlen unterscheiden Bestand und offenen Posten: 1.519 Partien sind ein
 * Bestand und stehen blass, 14 fällige Wiederholungen sind ein Grund
 * hinzugehen und stehen kräftig.
 */
import type { ReactNode } from "react";
import { ArrowLeft, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import type { PageId } from "../../lib/nav";
import { deInt } from "../../lib/format";
import { useT, type Key } from "../../lib/i18n";
import { COMPACT_LIMIT, taglineKey, taglineWidth } from "../../lib/tagline";
import PlanBadge from "../PlanBadge";
import BrandMark from "../BrandMark";
import "./blatt.css";

export interface RegisterItem {
  id: PageId;
  labelKey: Key;
  icon: LucideIcon;
}

/** Was rechts in der Zeile steht · `offen` macht daraus einen Grund, nicht nur eine Zahl. */
export interface RegisterZahl {
  text: string;
  offen: boolean;
}

export type RegisterZahlen = Partial<Record<PageId, RegisterZahl>>;

/**
 * Was neben den Kapiteln steht · aus dem Bestand und den offenen Posten.
 *
 * Zwei Regeln stecken darin, und beide gehören zum Register und nicht zu den
 * Seiten:
 *
 * - Ein Bestand steht blass, ein offener Posten kräftig. 1.519 Partien sind
 *   kein Grund hinzugehen, 14 fällige Wiederholungen schon.
 * - **Ein offener Posten, von dem keiner offen ist, steht gar nicht da.** Die
 *   Zeile behält dann nur ihre Punktlinie, wie Endspiele, Training und
 *   Insights. Eine 0 wäre eine Auskunft über nichts und zöge den Blick
 *   ausgerechnet auf die Zeile, die gerade nichts von einem will.
 *
 * Das Tagesziel der Puzzles ist die Ausnahme: „0/20" ist keine Null, sondern
 * ein Stand — es sagt, wie weit der Tag ist, und fehlte es, sähe der Tag ohne
 * Puzzle aus wie ein Tag ohne Ziel.
 */
export function registerZahlen({
  gameCount,
  openItems,
}: {
  /** Partien in der Datenbank · `null`, solange sie nicht gezählt sind. */
  gameCount: number | null;
  openItems: {
    analysis: number;
    repertoire: number;
    puzzles: number;
    puzzleGoal: number;
  } | null;
}): RegisterZahlen {
  return {
    ...(gameCount != null ? { games: { text: deInt(gameCount), offen: false } } : {}),
    ...(openItems
      ? {
          ...(openItems.analysis > 0
            ? { analysis: { text: deInt(openItems.analysis), offen: true } }
            : {}),
          ...(openItems.repertoire > 0
            ? { repertoire: { text: deInt(openItems.repertoire), offen: true } }
            : {}),
          puzzles: {
            text: `${deInt(openItems.puzzles)}/${deInt(openItems.puzzleGoal)}`,
            offen: openItems.puzzles < openItems.puzzleGoal,
          },
        }
      : {}),
  };
}

/** Die Marke · dieselbe wie in der heutigen Leiste, nur anders gesetzt. */
function Marke() {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
      {/* Kein Rund, kein Farbfeld · ein Kasten aus einer Haarlinie. */}
      <BrandMark icon={20} className="flex h-9 w-9 flex-none items-center justify-center border border-ink text-ink" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em]">Kiebitz</span>
          <PlanBadge />
        </div>
        <div className="mt-0.5 text-[11px] text-ink3">{t(taglineKey())}</div>
      </div>
    </div>
  );
}

export function RegisterSidebar({
  items,
  page,
  zahlen,
  onSelect,
  foot,
}: {
  items: readonly RegisterItem[];
  page: PageId;
  zahlen: RegisterZahlen;
  onSelect: (id: PageId) => void;
  /** Der Stand der Datenbank · zwei Zeilen Kleinsatz. */
  foot: ReactNode;
}) {
  const t = useT();
  const settingsActive = page === "settings";
  return (
    <>
      <Marke />
      <div className="px-5 pb-2">
        <div className="blatt-feld border-b border-ink pb-1.5 text-ink3">{t("blatt.contents")}</div>
      </div>
      <nav aria-label={t("nav.main")} className="flex flex-col">
        {items.map(({ id, labelKey }) => {
          const active = page === id;
          const zahl = zahlen[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              data-tour={`nav-${id}`}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-11 items-baseline gap-2 px-5 text-start"
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-[9px] start-0 w-[3px] bg-ink"
                />
              )}
              <span
                className={`text-[14.5px] ${active ? "font-semibold text-ink" : "text-ink2"}`}
              >
                {t(labelKey)}
              </span>
              <span aria-hidden className="blatt-punktlinie" />
              <span
                className={`blatt-zahl text-[11.5px] ${
                  zahl?.offen ? "font-medium text-ink" : "text-ink3"
                }`}
              >
                {zahl?.text ?? ""}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="flex-1" />
      <div className="px-5 pb-5">
        <div className="mb-[9px] h-px bg-line2" />
        <div className="blatt-zahl text-[11px] leading-[1.6] text-ink3">{foot}</div>
        <button
          type="button"
          onClick={() => onSelect("settings")}
          data-tour="nav-settings"
          aria-current={settingsActive ? "page" : undefined}
          className={`mt-1 flex min-h-11 w-full items-center gap-[9px] text-start text-[14px] ${
            settingsActive ? "font-medium text-ink" : "text-ink2"
          }`}
        >
          <SettingsIcon size={15} className="text-ink3" />
          {t("nav.settings")}
        </button>
      </div>
    </>
  );
}

/**
 * Die Marke im Zeilensatz · gesperrte Versalien neben einem Haarlinienkasten.
 *
 * Dieselben zwei Teile wie oben im Register, nur nebeneinander statt
 * übereinander: Wo die Hülle wenig Höhe hat — die App-Bar des Telefons, die
 * Kopfzeile des schmalen Fensters — steht die Marke in einer Zeile.
 */
export function RegisterMarke({ gross = 32 }: { gross?: number }) {
  return (
    <>
      <BrandMark
        icon={Math.round(gross * 0.53)}
        className="flex flex-none items-center justify-center border border-ink text-ink"
        style={{ height: gross, width: gross }}
      />
      <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink">
        Kiebitz
      </span>
    </>
  );
}

/**
 * Die App-Bar des Telefons im Register-Satz · der lebende Kolumnentitel.
 *
 * Sie trägt dasselbe wie die gewöhnliche Fassung und an denselben Stellen:
 * Zurück, Marke, Kontext, Modell, Zahnrad. Nur gesetzt ist sie anders. Oben
 * auf einer Buchseite steht der laufende Titel — links die Marke in gesperrten
 * Versalien, dahinter, im Buchsatz, das Kapitel. Kein Farbfeld hinter dem
 * Vogel, kein gerundeter Kasten: ein Rahmen aus einer Haarlinie, wie im
 * Register der Seitenleiste.
 *
 * Höhe, Randabstände und Sicherheitsbereiche bleiben, wie sie sind · die Hülle
 * wechselt im Modus ihren Satz, nicht ihre Maße.
 */
export function RegisterAppBar({
  title,
  showBack,
  onBack,
  onSettings,
  settingsActive,
}: {
  /** Seitentitel · null auf dem Start, dort steht der Claim daneben. */
  title: string | null;
  showBack: boolean;
  onBack: () => void;
  onSettings: () => void;
  settingsActive: boolean;
}) {
  const t = useT();
  return (
    <header
      className="mobile-app-bar flex shrink-0 items-center gap-0.5 border-b border-line bg-panel pb-2"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={t("app.back")}
          className="-ms-0.5 p-1.5 text-ink2 transition-colors hover:text-ink"
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <span className="ms-1 flex items-center gap-2.5">
        <RegisterMarke gross={32} />
      </span>
      {/* Das Kapitel steht im Buchsatz neben der Marke · aufrecht, wenn es
          eine Seite gibt, und als Claim auf dem Start. */}
      <span className="buch min-w-0 flex-1 truncate px-2 text-[14.5px] text-ink3">
        · {title ?? t(taglineKey((key) => taglineWidth(t(key)) <= COMPACT_LIMIT))}
      </span>
      <PlanBadge />
      <button
        type="button"
        onClick={onSettings}
        data-tour="nav-settings"
        aria-label={t("nav.settings")}
        aria-current={settingsActive ? "page" : undefined}
        className={`p-2 transition-colors hover:text-ink ${
          settingsActive ? "text-ink" : "text-ink3"
        }`}
      >
        <SettingsIcon size={20} />
      </button>
    </header>
  );
}

/**
 * Die Reiterleiste des Telefons im Register-Satz.
 *
 * Kein gefülltes Feld hinter dem Symbol, sondern ein Strich an der oberen
 * Kante — dort, wo die Leiste ansetzt, wie die Marke am Bund des Registers.
 * Höhe 56 px, damit die Trefferfläche über den 44 px bleibt; der Gestenbereich
 * unten kommt wie heute aus `mobile-bottom-nav`.
 */
export function RegisterNav({
  items,
  activeId,
  onSelect,
  rail,
}: {
  items: readonly RegisterItem[];
  activeId: PageId;
  onSelect: (id: PageId) => void;
  rail: boolean;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className={
        rail
          ? "mobile-nav-rail flex w-[72px] shrink-0 flex-col justify-center gap-1 border-e border-line bg-panel"
          : "mobile-bottom-nav flex shrink-0 items-stretch border-t border-line bg-panel"
      }
    >
      {items.map(({ id, labelKey, icon: Icon }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            data-tour={`nav-${id}`}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-[3px] ${
              rail ? "py-2" : "h-14 flex-1"
            } ${active ? "text-ink" : "text-ink3"}`}
          >
            {active && (
              <span
                aria-hidden
                className={
                  rail
                    ? "absolute inset-y-2 start-0 w-[2px] bg-ink"
                    : "absolute inset-x-[14px] top-0 h-[2px] bg-ink"
                }
              />
            )}
            <Icon size={19} />
            <span
              className={`blatt-feld max-w-full truncate px-0.5 ${active ? "font-semibold" : "font-normal"}`}
            >
              {t(labelKey)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
