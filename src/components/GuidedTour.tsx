/**
 * Geführter Rundgang durch die laufende App.
 *
 * Statt Folien zu zeigen, auf denen die App abgebildet ist, blättert der
 * Rundgang die App selbst durch: Er wechselt auf die Seite, um die es geht,
 * leuchtet dort das echte Bedienelement aus und stellt sich mit einer
 * Sprechblase daneben. Wer den Rundgang durch hat, hat jeden Punkt einmal an
 * seiner Stelle gesehen · nicht auf einem Bild davon.
 *
 * Warum ein rAF-Takt und kein einmaliges Messen: Die Seiten kommen als
 * Lazy-Chunks, ihre Daten kommen danach, und das Ausrollen einer Liste
 * verschiebt alles darunter. Ein einmal gemessenes Rechteck wäre nach 200 ms
 * falsch. Der Takt vergleicht und schreibt nur, wenn sich wirklich etwas
 * bewegt hat · das Ausleuchten folgt damit auch dem weichen Scrollen zum Ziel.
 *
 * Bedienen lässt sich währenddessen nichts: Die Schicht schluckt alle Klicks.
 * Ein Fehlgriff, der mitten im Rundgang die Seite wechselt, wäre schlimmer als
 * die Einschränkung · den Weg gibt hier der Rundgang vor.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useT } from "../lib/i18n";
import type { PageId } from "../lib/nav";
import type { TourSide, TourStep } from "../lib/tourSteps";
import BrandMark from "./BrandMark";

/** Luft zwischen Element und Ausschnitt. */
const PAD = 6;
/** Abstand der Sprechblase zum Ausschnitt. */
const GAP = 14;
/** Mindestabstand der Sprechblase zum Fensterrand. */
const MARGIN = 12;
/** Maße, mit denen der erste Frame rechnet · danach wird gemessen. */
const BUBBLE_FALLBACK = { width: 340, height: 210 };

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Wo die Blase steht und auf welcher Seite des Ausschnitts sie sitzt. */
interface Placement {
  rect: Rect | null;
  top: number;
  left: number;
  side: TourSide | "center";
}

const SIDES: TourSide[] = ["bottom", "top", "right", "left"];

/**
 * Der Bereich, den die Marken eines Schritts gemeinsam aufspannen.
 *
 * Unsichtbare Treffer fallen heraus: Beide Shells halten Navigationen doppelt
 * im Baum (Seitenleiste und Schublade, Leiste unten und Rail), und die gerade
 * ausgeblendete misst sich als 0 × 0.
 */
function measure(anchors: string[]): { rect: Rect; node: Element } | null {
  const boxes: { rect: DOMRect; node: Element }[] = [];
  for (const anchor of anchors) {
    for (const node of document.querySelectorAll(`[data-tour="${anchor}"]`)) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) boxes.push({ rect, node });
    }
  }
  if (boxes.length === 0) return null;
  const top = Math.min(...boxes.map((b) => b.rect.top));
  const left = Math.min(...boxes.map((b) => b.rect.left));
  const right = Math.max(...boxes.map((b) => b.rect.right));
  const bottom = Math.max(...boxes.map((b) => b.rect.bottom));
  return {
    rect: { top, left, width: right - left, height: bottom - top },
    node: boxes[0].node,
  };
}

/** Höchster Anteil des Fensters, den ein Ausschnitt einnehmen darf. */
const SPOT_MAX = 0.55;

/**
 * Unterkante der Fläche, auf der die Blase stehen darf.
 *
 * Auf Android liegt die Anzeige nicht im Dokument, sondern als native Fläche
 * über dem WebView — das DOM kennt davon nur den reservierten Slot. Wer allein
 * mit `innerHeight` rechnet, stellt die Blase deshalb ahnungslos unter die
 * Anzeige, und ihre untere Hälfte samt "Weiter" verschwindet dahinter. Für die
 * Blase endet das Fenster darum an der Oberkante des Slots.
 *
 * Der Ausschnitt bleibt davon unberührt: Die Leiste unten liegt *unter* der
 * Anzeige und ist weiterhin ganz zu sehen · nur die Blase weicht ihr aus.
 */
function bubbleBottom(): number {
  const vh = window.innerHeight;
  const slot = document.querySelector('[data-ad-slot="android-banner"]');
  if (!slot) return vh;
  const rect = slot.getBoundingClientRect();
  // Ungeladen ist der Slot 0 px hoch und nichts liegt über der Seite.
  return rect.height > 0 ? Math.min(vh, rect.top) : vh;
}

/**
 * Der sichtbare Teil des Bereichs, und höchstens ein gutes halbes Fenster.
 *
 * Ohne die Deckelung verschluckt eine lange Karte (die Trainingsvorschläge
 * sind auf dem Handy über tausend Pixel hoch) das ganze Fenster: Es bliebe
 * keine Seite mehr übrig, auf der die Blase stehen könnte, und sie läge
 * mitten im Text. Gezeigt wird deshalb der Anfang der Karte · das ist die
 * Stelle, auf die "sieh mal hier" ohnehin zeigt.
 */
function visible(rect: Rect): Rect {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const top = Math.max(rect.top, MARGIN);
  const bottom = Math.min(rect.top + rect.height, vh - MARGIN);
  // Noch (fast) ganz außerhalb: Das Rohmaß stimmt gleich wieder, sobald der
  // Lauf das Ziel ins Bild geholt hat.
  if (bottom - top < 24) return rect;
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.left + rect.width, vw);
  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.min(bottom - top, vh * SPOT_MAX),
  };
}

/** Passt die Blase auf diese Seite des Ausschnitts? */
function fits(side: TourSide, rect: Rect, w: number, h: number, vw: number, vh: number): boolean {
  if (side === "top") return rect.top - GAP - MARGIN >= h;
  if (side === "bottom") return vh - (rect.top + rect.height) - GAP - MARGIN >= h;
  if (side === "left") return rect.left - GAP - MARGIN >= w;
  return vw - (rect.left + rect.width) - GAP - MARGIN >= w;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Setzt die Blase neben den Ausschnitt · Wunschseite zuerst, sonst die erste,
 * auf der sie ganz hinpasst. Passt keine (schmales Fenster, großer
 * Ausschnitt), bleibt die Wunschseite und die Blase wird an den Rand geklemmt.
 */
function place(rect: Rect, w: number, h: number, prefer?: TourSide): Placement {
  const vw = window.innerWidth;
  const vh = bubbleBottom();
  const order = prefer ? [prefer, ...SIDES.filter((s) => s !== prefer)] : SIDES;
  const side = order.find((s) => fits(s, rect, w, h, vw, vh)) ?? prefer ?? "bottom";

  let top: number;
  let left: number;
  if (side === "top" || side === "bottom") {
    top = side === "top" ? rect.top - GAP - h : rect.top + rect.height + GAP;
    left = rect.left + rect.width / 2 - w / 2;
  } else {
    left = side === "left" ? rect.left - GAP - w : rect.left + rect.width + GAP;
    top = rect.top + rect.height / 2 - h / 2;
  }
  return {
    rect,
    side,
    top: clamp(top, MARGIN, vh - h - MARGIN),
    left: clamp(left, MARGIN, vw - w - MARGIN),
  };
}

/** Blase in der Fenstermitte · für Schritte, deren Element nicht da ist. */
function centered(w: number, h: number): Placement {
  return {
    rect: null,
    side: "center",
    top: Math.max(MARGIN, bubbleBottom() / 2 - h / 2),
    left: Math.max(MARGIN, window.innerWidth / 2 - w / 2),
  };
}

function same(a: Placement | null, b: Placement): boolean {
  if (!a || a.side !== b.side) return false;
  if (Math.round(a.top) !== Math.round(b.top) || Math.round(a.left) !== Math.round(b.left)) {
    return false;
  }
  if (!a.rect || !b.rect) return a.rect === b.rect;
  return (
    Math.round(a.rect.top) === Math.round(b.rect.top) &&
    Math.round(a.rect.left) === Math.round(b.rect.left) &&
    Math.round(a.rect.width) === Math.round(b.rect.width) &&
    Math.round(a.rect.height) === Math.round(b.rect.height)
  );
}

export default function GuidedTour({
  steps,
  onNavigate,
  onDone,
}: {
  steps: TourStep[];
  /** Seitenwechsel der App · der Rundgang steuert die Shell, nicht umgekehrt. */
  onNavigate: (page: PageId) => void;
  /** Rundgang beendet · durch Abschließen, Überspringen oder Escape. */
  onDone: () => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const prefer = step.prefer;
  const last = index === steps.length - 1;
  const Icon = step.icon;

  // Der Wechsel gehört vor das Suchen: Das Element des Schritts entsteht erst
  // mit seiner Seite. Die Suche selbst wartet danach im Takt darauf.
  useEffect(() => {
    if (step.page) onNavigate(step.page);
  }, [step.page, onNavigate]);

  // Der Takt läuft, solange der Schritt steht · nicht als Notlösung, sondern
  // weil sich das Ziel bis zuletzt bewegt: Die Blase bleibt dabei stehen, wo
  // sie ist, bis die neue Stelle feststeht, und gleitet dann hinüber.
  const anchorKey = step.anchors.join(" ");
  useEffect(() => {
    let raf = 0;
    let scrolled = false;
    const anchors = anchorKey.split(" ");

    const tick = () => {
      const bubble = bubbleRef.current?.getBoundingClientRect();
      const w = bubble?.width || BUBBLE_FALLBACK.width;
      const h = bubble?.height || BUBBLE_FALLBACK.height;
      const found = measure(anchors);

      // Nur holen, was nicht schon zu sehen ist · ein Ziel in der Leiste unten
      // steht immer im Bild, und ein "Zentrieren" würde den Inhalt dahinter
      // grundlos verschieben.
      if (found && !scrolled) {
        scrolled = true;
        const offscreen =
          found.rect.top < MARGIN || found.rect.top + found.rect.height > window.innerHeight - MARGIN;
        if (offscreen) {
          const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          found.node.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
        }
      }

      const next = found ? place(visible(found.rect), w, h, prefer) : centered(w, h);
      setPlacement((prev) => (same(prev, next) ? prev : next));
      raf = requestAnimationFrame(tick);
    };

    // Ohne Layout (Tests, jsdom) misst sich alles als 0 · dann steht die Blase
    // mittig, und ein Takt wäre nur Leerlauf.
    if (typeof requestAnimationFrame !== "function") return;
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchorKey, prefer]);

  // Die Tastatur soll im Rundgang landen, nicht auf der Seite dahinter, die
  // gerade ohnehin niemand bedienen kann.
  useEffect(() => {
    bubbleRef.current?.focus();
  }, []);

  // Weiter/zurück auch über die Pfeiltasten · in Sprachen von rechts nach
  // links liegt "weiter" auf der linken Taste.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const rtl = document.documentElement.dir === "rtl";
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const backward = rtl ? "ArrowRight" : "ArrowLeft";
      if (event.key === "Escape") onDone();
      else if (event.key === forward) setIndex((i) => (i === steps.length - 1 ? i : i + 1));
      else if (event.key === backward) setIndex((i) => Math.max(0, i - 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length, onDone]);

  const rect = placement?.rect ?? null;
  // Ohne transform, weil der Auftritt der Blase per Animation genau den
  // besetzt · der erste Frame steht deshalb über negative Ausmaße mittig.
  const style = placement
    ? { top: `${placement.top}px`, left: `${placement.left}px` }
    : {
        top: "50%",
        left: "50%",
        marginTop: `${-BUBBLE_FALLBACK.height / 2}px`,
        marginLeft: `${-BUBBLE_FALLBACK.width / 2}px`,
      };

  return (
    <>
      {/* Die Schicht schluckt Klicks und dunkelt ab · dort, wo kein Ausschnitt
          sitzt, tut sie das selbst, sonst der Schatten des Ausschnitts. */}
      <div
        className={`fixed inset-0 z-[60] overflow-hidden ${rect ? "" : "bg-black/70"}`}
        aria-hidden="true"
        onMouseDown={(event) => event.preventDefault()}
      >
        {rect && (
          <div
            className="tour-spot absolute rounded-xl border-2 border-accent"
            style={{
              top: `${rect.top - PAD}px`,
              left: `${rect.left - PAD}px`,
              width: `${rect.width + 2 * PAD}px`,
              height: `${rect.height + 2 * PAD}px`,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.7)",
            }}
          />
        )}
      </div>

      <div
        ref={bubbleRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={t("tour.title")}
        className="tour-bubble fixed z-[61] w-[min(340px,calc(100vw-24px))] rounded-xl border border-line bg-panel shadow-2xl outline-none"
        style={style}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <BrandMark
            icon={14}
            className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent"
          />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink2">
            {t("tour.title")}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-ink3">
            {index + 1}/{steps.length}
          </span>
          <button
            type="button"
            onClick={onDone}
            aria-label={t("tour.close")}
            className="-mr-1 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon size={18} />
            </span>
            <div className="min-w-0" aria-live="polite">
              <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">
                {t(step.title)}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink2">{t(step.body)}</p>
            </div>
          </div>

          {/* Punkte statt einer Fortschrittsleiste: Sie zeigen die Länge und
              lassen zurück- oder vorspringen, ohne sich durchzuklicken. */}
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t("tour.step", { n: i + 1, total: steps.length })}
                aria-current={i === index ? "step" : undefined}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-accent" : "w-1.5 bg-line2 hover:bg-ink3"
                }`}
              />
            ))}
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-ink3 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={14} /> {t("tour.back")}
            </button>
            <div className="flex items-center gap-1.5">
              {!last && (
                <button
                  type="button"
                  onClick={onDone}
                  className="rounded-lg px-2 py-1.5 text-[12.5px] text-ink3 transition-colors hover:text-ink"
                >
                  {t("tour.skip")}
                </button>
              )}
              <button
                type="button"
                onClick={() => (last ? onDone() : setIndex((i) => i + 1))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                {last ? (
                  <>
                    <Check size={14} /> {t("tour.done")}
                  </>
                ) : (
                  <>
                    {t("tour.next")} <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
