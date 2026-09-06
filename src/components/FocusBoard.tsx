/**
 * Fokus-Brett · dieselbe Stellung, nur ohne alles andere.
 *
 * Jede Brettseite der App hat neben dem Brett noch etwas zu sagen:
 * Bewertungsverlauf, Zugliste, Statistik, Trainingsplan. Das ist der Grund,
 * warum man die Seiten benutzt · und genau das, was im Weg steht, wenn man
 * eine Stellung wirklich ansehen will. Der Fokus räumt es für einen Moment
 * weg: Kopfzeile, Brett, Bedienung, sonst nichts.
 *
 * Zwei Erscheinungsformen, eine Bauart:
 *
 * · Auf dem Handy ist es ein eigener Schirm. Er deckt den Inhaltsbereich
 *   vollständig ab, weil dort ohnehin nichts danebenpasst, und die
 *   Zurück-Taste schließt ihn wie eine Seite (siehe `useBackDismiss`).
 * · Auf dem Desktop legt er sich als Karte über die unscharf gestellte Seite ·
 *   dieselbe Form, die die App schon für Bestätigungen und Lizenztexte
 *   benutzt. Der Hintergrund bleibt sichtbar, weil man ihn gleich wieder
 *   braucht.
 *
 * Die Brettmaße rechnet `.board-focus` neu: Im Fokus gilt der ganze Schirm,
 * nicht mehr die Spalte einer Seite (siehe „Brettmaße" in src/index.css). Wie
 * viel davon das Brett bekommt, misst der Fokus selbst · siehe `useChrome`.
 *
 * Das Fokus-Brett gehört zu Kiebitz Plus. Gesperrt bleibt der Griff sichtbar
 * und führt in die Erklärung · dieselbe Regel wie bei jeder anderen gesperrten
 * Funktion (siehe components/PlusLock.tsx).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { useMobileShell } from "./MobileShell";
import { useBackDismiss } from "../lib/backDismiss";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import { PlusBadge } from "./PlusLock";
import { Button, MenuItem } from "./ui";

/** Die Feature-ID des Fokus-Bretts · steht hier, weil hier das Gate sitzt. */
const FOCUS_FEATURE = "focus_board" as const;

/**
 * Der Griff, der den Fokus öffnet · gehört auf jeder Seite in die Leiste beim
 * Brett, damit er dort steht, wo man das Brett gerade bedient.
 *
 * Das Gate sitzt im Griff und nicht auf den sieben Seiten, die ihn aufstellen:
 * So kann keine Seite es vergessen, und der gesperrte Fall sieht überall
 * gleich aus · Symbol, Funke, ein Tipp führt in die Erklärung.
 */
export function FocusButton({ onClick, compact = true }: { onClick: () => void; compact?: boolean }) {
  const t = useT();
  const { unlocked, pending } = usePlusGate(FOCUS_FEATURE);
  const locked = !unlocked && !pending;
  const label = locked ? t("board.focusPlus") : t("board.focusOpen");
  return (
    <Button
      onClick={() => (locked ? openPlusDialog(FOCUS_FEATURE) : onClick())}
      title={label}
      label={label}
      className={compact ? "relative" : ""}
      compact={compact}
    >
      <Maximize2 size={15} />
      {!compact && t("board.focus")}
      {/* Trägt der Griff nur sein Zeichen, sitzt die Funke als kleine Marke in
          der Ecke und nicht als zweites Zeichen daneben: Nebeneinander war der
          Knopf anderthalb mal so breit wie die Zeichenknöpfe neben ihm, und
          beides stand darin gedrängt bis an den Rand. */}
      {locked && (
        <Sparkles
          size={compact ? 9 : 11}
          className={compact ? "absolute end-[3px] top-[3px] text-accent" : "text-accent"}
          aria-hidden="true"
        />
      )}
    </Button>
  );
}

/**
 * Derselbe Griff als Menüeintrag · für Leisten, die auf schmalen Schirmen
 * ihre Nebenaktionen zusammenfassen (siehe `boardControls` in der Analyse).
 * Gate und Beschriftung sind dieselben wie beim Knopf.
 */
export function FocusMenuItem({ onClick }: { onClick: () => void }) {
  const t = useT();
  const { unlocked, pending } = usePlusGate(FOCUS_FEATURE);
  const locked = !unlocked && !pending;
  return (
    <MenuItem onClick={() => (locked ? openPlusDialog(FOCUS_FEATURE) : onClick())}>
      <Maximize2 size={15} />
      {t("board.focus")}
      {locked && <PlusBadge />}
    </MenuItem>
  );
}

export default function FocusBoard({
  open,
  onClose,
  title,
  subtitle,
  above,
  below,
  frameWidth = "var(--board-edge)",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Woher die Stellung kommt · „Analyse", „Tagesaufgabe", der Drill-Name. */
  title: string;
  /** Eine Zeile Kontext, wenn die Seite eine hat. */
  subtitle?: ReactNode;
  /** Direkt über dem Brett · Aufgabe, Spieler, Status. */
  above?: ReactNode;
  /** Direkt unter dem Brett · die Bedienleiste der Seite. */
  below?: ReactNode;
  /**
   * Breite des Bretts. Ohne sie hätte es hier gar keine Grenze: Die Karte
   * richtet sich nach ihrem Inhalt, der Inhalt nach der Karte, und am Ende
   * gilt nur noch `BOARD_MAX` · das Brett würde höher als der Schirm.
   *
   * Voreinstellung ist die Brettkante. Seiten, die neben dem Brett noch etwas
   * stehen haben (die Analyse ihren Bewertungsbalken), reichen stattdessen
   * `var(--board-col)` herein.
   *
   * Für die Reihen über und unter dem Brett gilt sie nur als Untergrenze von
   * 20 rem an · und das ist der Punkt. `--board-edge` hängt an der Höhe, die
   * die Reihen übrig lassen; machte man die Reihen genauso breit, hinge auch
   * ihre Breite wieder am Brett: Ein Knopf mehr macht das Brett kleiner, das
   * kleinere Brett macht die Spalte schmaler, die schmalere Spalte bricht die
   * Zeile um, der Umbruch macht das Brett wieder kleiner. Genau so ist der
   * Puzzle-Fokus auf einem 360 px breiten Telefon bis auf die Untergrenze des
   * Bretts zusammengelaufen · mit einer Bildlaufleiste am Ende. Unterhalb von
   * 20 rem behalten die Reihen ihre Breite, und die Rechnung läuft nur noch in
   * eine Richtung.
   */
  frameWidth?: string;
  children: ReactNode;
}) {
  // Zweiter Riegel hinter dem Griff: Läuft ein Abo während der Sitzung ab,
  // schließt sich der Fokus, statt weiterzulaufen, bis die Seite gewechselt
  // wird. Solange der Plus-Zustand noch lädt, bleibt alles offen · ein kurz
  // zuklappender Fokus wäre schlimmer als eine halbe Sekunde Geduld.
  const { unlocked, pending } = usePlusGate(FOCUS_FEATURE);
  if (!open || (!unlocked && !pending)) return null;
  return (
    <FocusLayer
      title={title}
      subtitle={subtitle}
      above={above}
      below={below}
      frameWidth={frameWidth}
      onClose={onClose}
    >
      {children}
    </FocusLayer>
  );
}

/** Oberer plus unterer Innenabstand eines Elements in px. */
function verticalPadding(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
}

/** Kopfzeile und Innenabstand · alles, was die Hülle über dem Inhalt braucht. */
function shellAround(shell: HTMLElement, body: HTMLElement): number {
  return (
    shell.getBoundingClientRect().height -
    body.getBoundingClientRect().height +
    verticalPadding(body)
  );
}

/**
 * Wie viel Höhe im Fokus *nicht* dem Brett gehört.
 *
 * `--board-chrome` ist auf jeder Seite ein Schätzwert · das reicht dort, weil
 * eine Seite scrollen darf. Der Fokus darf es nicht: Er ist die Ansicht, in
 * der nur das Brett zählt, und eine Bildlaufleiste an seiner Kante ist genau
 * das Gegenteil davon. Sie erschien trotzdem, sobald eine Leiste um ein paar
 * Pixel wuchs · die gelöste Aufgabe tauscht im Puzzle-Trainer den schmalen
 * Hinweis gegen einen umrandeten Streifen mit Knopf.
 *
 * Statt den Schätzwert nachzubessern, misst der Fokus ihn: Kopfzeile, Ränder,
 * Innenabstände und die Reihen über und unter dem Brett ergeben zusammen genau
 * die Höhe, die dem Brett fehlt. Keiner dieser Summanden hängt an der
 * Brettgröße · deshalb ist die Messung eine Rechnung und keine Schleife.
 *
 * Gemessen werden dafür die Reihen und nicht die Spalte: Die Spalte füllt die
 * Fläche aus (`grow`), ihre Höhe ist also der Schirm und nicht der Inhalt.
 *
 * Derselbe Griff beantwortet die zweite Frage: wo in der Fläche das Brett
 * steht. Bleibt Platz übrig — auf einem hohen Telefon ist das Brett so breit
 * wie der Schirm und damit niedriger als er —, dann gehört er *vor* das Brett,
 * und zwar so viel, dass das Brett in der Mitte der Fläche sitzt. Was darunter
 * steht, zählt für diese Rechnung nicht mit: Genau daran hing das Zappeln.
 * Zentriert man die ganze Spalte, verteilt sich jede gewachsene Leiste je zur
 * Hälfte nach oben und unten · im Puzzle-Trainer sprang das Brett dadurch bei
 * jedem Zug, weil die Zeile darunter richtig wie falsch gegen einen Streifen
 * mit Knöpfen getauscht wird. Der Vorlauf hängt nur an Brett und Statuszeile
 * und bleibt deshalb stehen.
 *
 * Die Grenze ist der Platz, der wirklich da ist: Passt die Bedienung unter dem
 * mittig stehenden Brett nicht mehr auf den Schirm, schrumpft der Vorlauf
 * genau um so viel, wie ihr fehlt · abgeschnitten wird nichts.
 *
 * Dieselbe Messung beantwortet auch, *wovon* der Platz abgezogen wird. Das
 * Stylesheet rechnet mit `100dvh`, und auf dem Rechner stimmt das. Die
 * Android-WebView löst `dvh` aber gegen den ganzen Schirm auf, während ihre
 * eigene Fläche um Status- und Navigationsleiste kleiner ist: Das Brett wurde
 * dadurch um genau diese beiden Leisten zu hoch, und der Fokus bekam die
 * Bildlaufleiste, die er per Definition nicht haben darf. Gemessen wird
 * deshalb die Höhe des Fokus selbst und als `--board-vh` weitergereicht.
 *
 * Die Werte gehen als `--board-chrome`, als `--board-vh` und als Vorlauf an
 * den Fokus; die Rechnung für `--board-edge` steht unverändert im Stylesheet.
 */
function useChrome(mobile: boolean) {
  const layer = useRef<HTMLDivElement | null>(null);
  /** Die Karte auf dem Desktop; auf dem Handy trägt der Schirm selbst alles. */
  const card = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const column = useRef<HTMLDivElement | null>(null);
  const board = useRef<HTMLDivElement | null>(null);
  const rows = useRef<HTMLDivElement | null>(null);
  const controls = useRef<HTMLDivElement | null>(null);
  const [chrome, setChrome] = useState<number | null>(null);
  /** Die Höhe, die dem Fokus wirklich gehört · null bis zur ersten Messung. */
  const [viewport, setViewport] = useState<number | null>(null);
  const [lead, setLead] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const layerEl = layer.current;
      const bodyEl = body.current;
      const columnEl = column.current;
      const boardEl = board.current;
      if (!layerEl || !bodyEl || !columnEl || !boardEl) return;
      const shell = card.current ?? layerEl;
      const boardHeight = boardEl.getBoundingClientRect().height;
      // Ohne Layout (JSDOM) ist jede Höhe 0 · dann bleibt der Wert aus dem
      // Stylesheet stehen, statt ihn auf null zu setzen.
      if (boardHeight <= 0) return;
      // Der Fokus liegt über dem ganzen Fenster · seine Höhe ist die Höhe, die
      // zu vergeben ist, und zwar auch dort, wo `dvh` etwas anderes behauptet.
      const height = Math.floor(layerEl.getBoundingClientRect().height);
      setViewport((previous) =>
        previous != null && Math.abs(previous - height) < 1 ? previous : height
      );
      const around = shell === layerEl ? 0 : verticalPadding(layerEl);
      const gap = parseFloat(getComputedStyle(columnEl).rowGap) || 0;
      const aboveHeight = rows.current?.getBoundingClientRect().height ?? 0;
      const belowHeight = controls.current?.getBoundingClientRect().height ?? 0;
      const gaps = gap * Math.max(0, columnEl.children.length - 1);
      // Ein Pixel Zugabe. Jeder Summand ist eine gemessene Bruchzahl, und das
      // Stylesheet rechnet mit dem Ergebnis weiter · ohne die Zugabe blieb am
      // Ende ein halbes Pixel übrig, und ein halbes Pixel ist eine ganze
      // Bildlaufleiste.
      const next =
        Math.ceil(around + shellAround(shell, bodyEl) + aboveHeight + belowHeight + gaps) + 1;
      setChrome((previous) => (previous != null && Math.abs(previous - next) < 1 ? previous : next));

      // Der Vorlauf rechnet in der Fläche, die der Spalte bleibt · das ist die
      // Höhe des Bereichs ohne seinen Innenabstand.
      const area = bodyEl.getBoundingClientRect().height - verticalPadding(bodyEl);
      const over = aboveHeight + (aboveHeight > 0 ? gap : 0);
      const under = belowHeight + (belowHeight > 0 ? gap : 0);
      const middle = (area - boardHeight) / 2 - over;
      const free = area - over - boardHeight - under;
      // Abgerundet, nicht gerundet: Der Vorlauf ist Schmuck, der Platz unter
      // dem Brett ist es nicht.
      const room = Math.max(0, Math.floor(Math.min(middle, free)));
      setLead((previous) => (Math.abs(previous - room) < 1 ? previous : room));
    };

    measure();
    const observed = [body.current, rows.current, controls.current, board.current].filter(
      (element): element is HTMLDivElement => element != null
    );
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    for (const element of observed) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mobile]);

  return { chrome, viewport, lead, layer, card, body, column, board, rows, controls };
}

/**
 * Eigene Komponente, damit die Haken (History-Eintrag, Escape) erst laufen,
 * wenn der Fokus wirklich offen ist · ein Haken hinter einem `if` gäbe es
 * nicht.
 */
function FocusLayer({
  title,
  subtitle,
  above,
  below,
  frameWidth,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  above?: ReactNode;
  below?: ReactNode;
  frameWidth: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const mobile = useMobileShell();
  const { chrome, viewport, lead, layer, card, body, column, board, rows, controls } =
    useChrome(mobile);
  const [container] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  useBackDismiss(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!container) return null;

  const head = (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold tracking-tight text-ink">{title}</div>
        {subtitle && <div className="truncate text-[12px] text-ink3">{subtitle}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("board.focusClose")}
        title={t("board.focusClose")}
        className="-mr-1 shrink-0 rounded-lg p-2 text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
      >
        {mobile ? <Minimize2 size={19} /> : <X size={18} />}
      </button>
    </header>
  );

  // Der Innenabstand steht hier und nicht an der Karte: Das Brett tritt über
  // `.board-bleed` genau um ihn wieder heraus und erreicht so die Kante,
  // während Beschriftungen und Leisten ihren Rand behalten.
  //
  // Der Vorlauf oben stellt das Brett in die Mitte der Fläche · siehe
  // `useChrome`. Er ersetzt das frühere `m-auto` an der Spalte: Zentriert man
  // die Spalte als Ganzes, wandert das Brett bei jeder Leiste mit, die unter
  // ihm um eine Zeile wächst.
  const content = (
    <div
      ref={body}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-2"
    >
      <div
        ref={column}
        className="mx-auto flex w-full grow flex-col gap-2"
        style={{ maxWidth: `min(100%, max(${frameWidth}, 20rem))`, paddingTop: lead || undefined }}
      >
        {/* Die Reihen tragen eigene Hüllen, damit `useChrome` weiß, welcher
            Teil der Spalte das Brett ist · alles andere ist die Höhe, die ihm
            fehlt. `gap-2` in den Hüllen, damit mehrteilige Reihen denselben
            Abstand behalten wie als direkte Kinder der Spalte. */}
        {above && (
          <div ref={rows} className="flex flex-col gap-2">
            {above}
          </div>
        )}
        <div ref={board} className="mx-auto w-full min-w-0" style={{ maxWidth: frameWidth }}>
          {children}
        </div>
        {below && (
          <div ref={controls} className="flex flex-col gap-2">
            {below}
          </div>
        )}
      </div>
    </div>
  );

  // Die gemessenen Höhen ersetzen die Werte aus dem Stylesheet. Sie stehen als
  // Variablen am Fokus selbst · `--board-edge` löst sie dort auf, egal ob sie
  // aus der Regel oder von hier kommen.
  const measured = {
    "--board-chrome": chrome != null ? `${chrome}px` : undefined,
    "--board-vh": viewport != null ? `${viewport}px` : undefined,
  } as CSSProperties;

  // Auf dem Handy trägt der Schirm die Fläche selbst; auf dem Desktop ist er
  // eine Karte auf einem unscharfen Schleier.
  if (mobile) {
    return createPortal(
      <div
        ref={layer}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="focus-board"
        className="board-focus fixed inset-0 z-50 flex flex-col bg-bg"
        style={{
          ...measured,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {head}
        {content}
      </div>,
      container
    );
  }

  return createPortal(
    <div
      ref={layer}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="focus-board"
      className="board-focus fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[3px]"
      style={measured}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={card}
        className="flex max-h-full w-auto max-w-full flex-col overflow-hidden rounded-2xl border border-line2 bg-panel pb-1 shadow-2xl shadow-black/50"
      >
        {head}
        {content}
      </div>
    </div>,
    container
  );
}
