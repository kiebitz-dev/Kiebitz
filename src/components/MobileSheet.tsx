/**
 * Modale Detailschicht der mobilen Shell.
 *
 * Auf Handybreite ist kein Platz für eine zweite Spalte · Details, die auf dem
 * Desktop neben der Liste stehen, kommen hier auf Tipp in den Vordergrund,
 * genau wie der Bestätigungsdialog in den Einstellungen: abgedunkelter,
 * unscharfer Hintergrund, darüber eine Karte.
 *
 * Anders als jener Dialog liegt das Blatt nur über dem Inhaltsbereich · es
 * portalt sich in einen Container, der genau die Fläche von <main> abdeckt.
 * App-Bar und Navigation bleiben scharf und bedienbar, damit man die Seite
 * nicht erst schließen muss, um den Tab zu wechseln. Fehlt der Container
 * (Tests, einzeln gerenderte Seiten), fällt es auf den ganzen Bildschirm
 * zurück.
 *
 * Blättern geht per Wischen: die Karte folgt dem Finger gedämpft und rastet
 * zurück, wenn der Weg zu kurz war oder es in die Richtung nichts mehr gibt.
 */
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";
import { useBackDismiss } from "../lib/backDismiss";

/** Ziel des Portals · liegt in der mobilen Shell deckungsgleich über <main>. */
export const SHEET_ROOT_ID = "mobile-sheet-root";

/** Ab dieser Fingerstrecke (px) gilt eine Wischbewegung als Blättern. */
const SWIPE_MIN = 56;
/** Wie eindeutig waagerecht die Geste sein muss, damit sie nicht scrollt. */
const SWIPE_RATIO = 1.3;
/** Bevor überhaupt entschieden wird, ob gewischt oder gescrollt wird. */
const AXIS_LOCK = 10;

type Gesture = { x: number; y: number; axis: "x" | "y" | null };

export default function MobileSheet({
  ariaLabel,
  title,
  subtitle,
  headerRight,
  footer,
  onClose,
  onPrev,
  onNext,
  /** Wechselt dieser Wert, beginnt der Inhalt wieder oben. */
  scrollKey,
  testId,
  blatt = false,
  children,
}: {
  ariaLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Kennzahl rechts im Kopf · steht rechtsbündig vor dem Schließen-Knopf. */
  headerRight?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Fehlt der Handler, federt die Geste in die Richtung zurück. */
  onPrev?: () => void;
  onNext?: () => void;
  scrollKey?: string;
  testId?: string;
  /**
   * Im Diagramm-Modus verliert die Karte ihre Rundung und ihren Schatten und
   * wird zum Blatt · dieselbe Regel, mit der die Einstellungen im Modus
   * auskommen, ohne sich zu verdoppeln (siehe blatt.css). Die Mechanik —
   * Wischen, Zurück-Geste, Tastatur — bleibt genau dieselbe.
   */
  blatt?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  // Der Container steht, sobald die Shell gerendert hat · das Blatt öffnet
  // erst auf Tipp, also lange danach.
  const [container] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : document.getElementById(SHEET_ROOT_ID) ?? document.body
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Pfeiltasten gehören im Textfeld dem Text, nicht der Navigation.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [scrollKey]);

  // Android-Zurück schließt das Blatt, statt die App zu verlassen · dieselbe
  // Mechanik nutzt auch das Fokus-Brett, deshalb steht sie in lib/backDismiss.
  useBackDismiss(onClose);

  const shift = (dx: number, snapBack: boolean) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = snapBack ? "transform 170ms ease-out" : "";
    el.style.transform = dx ? `translateX(${dx}px)` : "";
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      gesture.current = null;
      return;
    }
    gesture.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
  };

  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - g.x;
    const dy = e.touches[0].clientY - g.y;
    if (g.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      g.axis = Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO ? "x" : "y";
    }
    if (g.axis !== "x") return;
    // Gedämpft, und am Rand der Liste spürbar zäher · das sagt schon während
    // der Bewegung, dass dort nichts mehr kommt.
    const open = dx < 0 ? onNext : onPrev;
    shift(dx * (open ? 0.38 : 0.12), false);
  };

  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    gesture.current = null;
    shift(0, true);
    if (!g || g.axis !== "x") return;
    const dx = e.changedTouches[0].clientX - g.x;
    if (dx <= -SWIPE_MIN) onNext?.();
    else if (dx >= SWIPE_MIN) onPrev?.();
  };

  if (!container) return null;

  return createPortal(
    <div
      className={`${
        container === document.body ? "fixed" : "absolute"
      } mobile-sheet-scrim inset-0 z-40 flex items-center justify-center bg-black/65 p-3 backdrop-blur-[3px]`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`mobile-sheet-panel flex max-h-full w-full max-w-md flex-col overflow-hidden border border-line2 bg-panel ${
          blatt ? "blatt-formular" : "rounded-2xl shadow-2xl shadow-black/60"
        }`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <header className="flex shrink-0 items-start gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            {title}
            {subtitle}
          </div>
          {headerRight && <div className="shrink-0 self-center text-right">{headerRight}</div>}
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1.5 -mt-1 rounded-lg p-2 text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line bg-panel2/40 px-2 py-2">{footer}</div>
        )}
      </div>
    </div>,
    container
  );
}
