/**
 * Mobile App-Shell: obere App-Bar und die Navigation als Bottom-Leiste
 * (Hochformat) bzw. als Rail an der linken Kante (Querformat).
 *
 * Im Querformat bleibt von einem Telefon kaum Höhe übrig · eine liegende
 * Leiste kostet dort genau die Achse, die knapp ist, während Breite reichlich
 * vorhanden ist. Deshalb wandert dieselbe Navigation an die Seite.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { useT, type Key } from "../lib/i18n";
import { COMPACT_LIMIT, taglineKey, taglineWidth } from "../lib/tagline";
import type { PageId } from "../lib/nav";
import PlanBadge from "./PlanBadge";
import BrandMark from "./BrandMark";

export interface NavItem {
  id: PageId;
  labelKey: Key;
  icon: LucideIcon;
}

/**
 * Ob die mobile Shell läuft. Seiten und tief verschachtelte Komponenten
 * (Insights-Tabellen, Wochenkalender) brauchen das für ihr Layout, ohne dass
 * es durch drei Ebenen Props gereicht werden muss. Ausserhalb der Shell ·
 * etwa in Tests, die eine Seite einzeln rendern · gilt der Desktop-Fall.
 */
const ShellContext = createContext(false);

export function ShellProvider({ mobile, children }: { mobile: boolean; children: ReactNode }) {
  return <ShellContext.Provider value={mobile}>{children}</ShellContext.Provider>;
}

export function useMobileShell(): boolean {
  return useContext(ShellContext);
}

const LANDSCAPE_PHONE = "(orientation: landscape) and (max-height: 600px)";

/** Querformat auf Telefonhöhe · dort tritt die Navigation an die Seite. */
export function useLandscapePhone(): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(LANDSCAPE_PHONE).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(LANDSCAPE_PHONE);
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches);
    setMatch(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return match;
}

export function MobileAppBar({
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
  // Neben der Marke bleibt auf 360 px nur eine Handbreit für den Claim · was
  // dort nicht ganz hinpasst, wird gar nicht erst gezogen (siehe lib/tagline).
  const claim = title ?? t(taglineKey((key) => taglineWidth(t(key)) <= COMPACT_LIMIT));
  return (
    <header
      className="mobile-app-bar flex shrink-0 items-center gap-0.5 border-b border-line bg-panel pb-2"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      {showBack && (
        <button
          onClick={onBack}
          aria-label={t("app.back")}
          className="-ml-0.5 rounded-lg p-1.5 text-ink2 transition-colors hover:bg-panel2 hover:text-ink"
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <BrandMark
        icon={17}
        className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"
      />
      {/* Marke bleibt auf jedem Tab stehen; dahinter der Kontext · auf dem
          Start ist das der Claim, sonst der Seitenname. */}
      <span className="min-w-0 flex-1 truncate px-2 text-[15px] tracking-tight">
        <span className="font-semibold">Kiebitz</span>
        <span className="text-ink3"> · {claim}</span>
      </span>
      {/* Welches Modell gerade gilt, gehört neben die Marke · nicht erst in die
          Einstellungen, wo man es suchen müsste. */}
      <PlanBadge />
      <button
        onClick={onSettings}
        data-tour="nav-settings"
        aria-label={t("nav.settings")}
        aria-current={settingsActive ? "page" : undefined}
        className={`rounded-lg p-2 transition-colors hover:bg-panel2 hover:text-ink ${
          settingsActive ? "text-accent" : "text-ink2"
        }`}
      >
        <SettingsIcon size={20} />
      </button>
    </header>
  );
}

export function MobileNav({
  items,
  activeId,
  onSelect,
  rail,
}: {
  items: NavItem[];
  activeId: PageId;
  onSelect: (id: PageId) => void;
  /** Querformat: senkrechte Rail links statt Leiste unten. */
  rail: boolean;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className={
        rail
          ? "mobile-nav-rail flex w-[72px] shrink-0 flex-col justify-center gap-1 border-r border-line bg-panel"
          : "mobile-bottom-nav flex shrink-0 items-stretch border-t border-line bg-panel"
      }
    >
      {items.map(({ id, labelKey, icon: Icon }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            data-tour={`nav-${id}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center gap-0.5 transition-colors ${
              rail ? "py-1.5" : "flex-1 pt-1.5"
            } ${active ? "text-accent" : "text-ink3"}`}
          >
            <span
              className={`flex h-6 w-12 items-center justify-center rounded-full transition-colors ${
                active ? "bg-accent-soft" : ""
              }`}
            >
              <Icon size={19} />
            </span>
            <span className="max-w-full truncate px-0.5 text-[10.5px]">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
