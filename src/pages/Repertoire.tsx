import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Chess } from "chess.js";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CornerUpLeft,
  Download,
  FileUp,
  GraduationCap,
  GripVertical,
  Lightbulb,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { repertoire as demoRepertoire, repertoireStats, type RepNode as DemoNode } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, useT, type TFunc } from "../lib/i18n";
import {
  repAddLine,
  repDelete,
  repExportPgnFile,
  repGaps,
  repImportPgn,
  repImportPgnFile,
  repList,
  repLookup,
  repNodeGames,
  repReorder,
  repSetName,
  repSetNote,
  repStats,
  type NodeGameStats,
  type RepGap,
  type RepNode,
  type RepStats,
} from "../lib/repertoire";
import { chessdbQuery, getSettings, type ChessDbResult } from "../lib/settings";
import { useTrainingSession } from "../lib/session";
import Board from "../components/Board";
import LiveEngine from "../components/LiveEngine";
import RepertoireTrainer from "../components/RepertoireTrainer";
import ShareDialog, { type ShareSubject } from "../components/ShareDialog";
import { useMobileShell } from "../components/MobileShell";
import { BOARD_MAX } from "../lib/boardLayout";
import { useBoardSelection } from "../lib/boardMoves";
import { Button, Card, Chip } from "../components/ui";
import FocusBoard, { FocusButton } from "../components/FocusBoard";
import { de, deInt } from "../lib/format";
import { useDiagramMode } from "../lib/diagramMode";
import { notationLine } from "../lib/notation";

/** Das Buch kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const RepertoireBlatt = lazy(() => import("./blatt/RepertoireBlatt"));
import { errorMessage } from "../lib/errors";
import { replaySans } from "../lib/position";
import { shareHistory } from "../lib/share/notation";
import { isStoreCapture } from "../lib/storeCapture";
import { batchDataChanges } from "../lib/changes";
import { CoverageCard, GapsCard } from "./repertoire/RepertoireStats";

export default function Repertoire() {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return null;
  return backend.mode === "desktop" ? <LiveRepertoire /> : <DemoRepertoire />;
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

function moveLabel(n: RepNode): string {
  const num = Math.ceil(n.depth / 2);
  const san = n.depth % 2 === 1 ? `${num}.${n.san}` : `${num}…${n.san}`;
  return n.name ? `${san} · ${n.name}` : san;
}

function dueLabel(t: TFunc, n: RepNode, now: number): string {
  if (!n.my_move) return "";
  if (n.reps === 0) return t("rep.new");
  if (n.due_ts <= now) return t("rep.due");
  const days = Math.ceil((n.due_ts - now) / 86_400);
  return t(days === 1 ? "rep.inDays.one" : "rep.inDays.many", { n: days });
}

/** Zugliste als "1.e4 e5 2.Nf3" · dieselbe Form überall auf der Seite. */
function moveText(sans: string[]): string {
  return sans.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}

/** Eine laufende Ziehbewegung in der Variantenliste. */
interface DragState {
  side: "white" | "black";
  /** Reihenfolge der Seite, wie sie beim Greifen aussah. */
  keys: string[];
  from: number;
  /** Wohin die Linie fiele, wenn jetzt losgelassen wird. */
  to: number;
  dy: number;
  startY: number;
  rects: { top: number; height: number }[];
}

interface VariationLine {
  key: string;
  side: "white" | "black";
  targetId: number | string;
  name: string;
  sans: string[];
  due: number;
  nodeIds?: number[];
  hasNote?: boolean;
  hasTransposition?: boolean;
  /** Selbst gezogener Platz · 0 oder fehlend heisst "noch nie sortiert". */
  sortOrder?: number;
}

/**
 * Eine flache, tastaturbedienbare Linienliste. Der Repertoire-Baum bleibt das
 * Datenmodell, in der UI ist aber jede spielbare Variante ein lesbarer Eintrag.
 */
function VariationList({
  lines,
  selectedLineKey,
  selectedPly,
  onSelect,
  onReorder,
  onDelete,
  onEdit,
}: {
  lines: VariationLine[];
  selectedLineKey: string | null;
  selectedPly: number;
  onSelect: (line: VariationLine, ply: number) => void;
  /**
   * Neue Reihenfolge einer Seite · ohne den Handler gibt es keine Griffe
   * (die Demo-Liste der Web-Vorschau ist fest).
   */
  onReorder?: (side: "white" | "black", keys: string[]) => void;
  /**
   * Variante löschen · derselbe Weg wie ueber den Mülleimer in der
   * Detailkarte, nur direkt an der Zeile, wo man die Variante ohnehin
   * ansieht. Ohne den Handler bleibt die Liste lesend (Web-Vorschau).
   */
  onDelete?: (line: VariationLine) => void;
  /**
   * Variante bearbeiten · sie geht im Baukasten auf, mit ihren Zügen auf dem
   * Brett und ihrem Namen im Feld. Bis hierher gab es zu einer angelegten
   * Variante nur zwei Wege: verschieben und wegwerfen. Wer einen Zug
   * anhängen oder den Namen richtigstellen wollte, musste sie neu bauen · und
   * verlor dabei den Lernstand.
   *
   * Der Griff sitzt zwischen den beiden anderen, weil er dazwischen gehört:
   * Ändern ist mehr als Umsortieren und weniger als Löschen.
   */
  onEdit?: (line: VariationLine) => void;
}) {
  const t = useT();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);

  /** Schlüssel einer Seite in der gerade sichtbaren Reihenfolge. */
  const keysOf = (side: "white" | "black") =>
    lines.filter((line) => line.side === side).map((line) => line.key);

  /** Eine Linie an eine andere Stelle derselben Seite setzen. */
  const commitMove = (side: "white" | "black", from: number, to: number) => {
    const keys = keysOf(side);
    if (from === to || to < 0 || to >= keys.length) return;
    const next = [...keys];
    next.splice(to, 0, ...next.splice(from, 1));
    onReorder?.(side, next);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, line: VariationLine) => {
    if (!onReorder || drag || event.button !== 0) return;
    const keys = keysOf(line.side);
    // Die Zeilenhöhen stehen fest, sobald gegriffen wird · sie unterscheiden
    // sich je nach Länge der Zugliste, deshalb wird jede einzeln gemessen.
    const rects = keys.map((key) => {
      const rect = rowRefs.current.get(key)?.getBoundingClientRect();
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 };
    });
    const from = keys.indexOf(line.key);
    if (from < 0) return;
    // Der Zeiger bleibt beim Griff, auch wenn der Finger die Zeile verlässt.
    // Fehlt die Methode (Testumgebung) oder lehnt der Browser den Zeiger ab,
    // zieht die Zeile trotzdem · nur eben ohne Fang.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ohne Zeigerfang weiterziehen */
    }
    setDrag({ side: line.side, keys, from, to: from, dy: 0, startY: event.clientY, rects });
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointerY = event.clientY;
    setDrag((state) => {
      if (!state) return state;
      const held = state.rects[state.from];
      const last = state.rects[state.rects.length - 1];
      // Sichtbar bleibt die Zeile zwischen erster und letzter Linie ihrer
      // Seite · sonst zieht man sie aus der scrollenden Liste heraus und sieht
      // nicht mehr, was man in der Hand hat.
      const dy = Math.max(
        state.rects[0].top - held.top,
        Math.min(last.top + last.height - (held.top + held.height), pointerY - state.startY)
      );
      // Das Ziel richtet sich nach dem Finger, nicht nach der Zeile: über
      // welcher Zeile er steht, dorthin fällt die Variante. Am oberen und
      // unteren Rand ist das der erste bzw. letzte Platz.
      let to = state.rects.length - 1;
      if (pointerY < state.rects[0].top) to = 0;
      else {
        const hit = state.rects.findIndex((rect) => pointerY < rect.top + rect.height);
        if (hit >= 0) to = hit;
      }
      return { ...state, dy, to };
    });
  };

  const endDrag = () => {
    if (!drag) return;
    commitMove(drag.side, drag.from, drag.to);
    setDrag(null);
  };

  /**
   * Der Strich, der zeigt, wo die gegriffene Variante landet. Er steht vor der
   * Zeile mit dem Index `slot`; die Zeilen selbst bleiben stehen, weil sie
   * unterschiedlich hoch sind und ein Verrutschen der ganzen Liste beim Ziehen
   * mehr verwirrt als hilft.
   */
  const dropMarker = (side: "white" | "black", slot: number) => {
    if (!drag || drag.side !== side || drag.to === drag.from) return null;
    const target = drag.to > drag.from ? drag.to + 1 : drag.to;
    if (target !== slot) return null;
    return <div aria-hidden="true" className="h-0.5 rounded-full bg-accent" />;
  };

  const selectAndFocus = (line: VariationLine, ply: number) => {
    onSelect(line, ply);
    optionRefs.current.get(line.key)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, line: VariationLine) => {
    const index = lines.findIndex((candidate) => candidate.key === line.key);
    const currentPly = selectedLineKey === line.key ? selectedPly : line.sans.length - 1;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = lines[Math.max(0, Math.min(lines.length - 1, index + delta))];
      if (next) selectAndFocus(next, next.sans.length - 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      onSelect(line, Math.max(-1, Math.min(line.sans.length - 1, currentPly + delta)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onSelect(line, event.key === "Home" ? -1 : line.sans.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(line, line.sans.length - 1);
    }
  };

  return (
    <div>
      <div className="border-b border-line px-3 py-2 text-[11px] leading-relaxed text-ink3">
        {t("rep.variationKeys")}
      </div>
      <div
        role="listbox"
        aria-label={t("rep.variants")}
        className="max-h-[min(58vh,620px)] overflow-y-auto p-2"
      >
        {(["white", "black"] as const).map((side) => {
          const sideLines = lines.filter((line) => line.side === side);
          if (sideLines.length === 0) return null;
          return (
            <div
              key={side}
              role="group"
              aria-label={side === "white" ? t("common.asWhite") : t("common.asBlack")}
              className="mb-3 last:mb-0"
            >
              <div className="sticky top-0 z-10 bg-panel/95 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3 backdrop-blur-sm">
                {side === "white" ? t("common.asWhite") : t("common.asBlack")}
              </div>
              <div className={`space-y-1.5 ${drag ? "select-none" : ""}`}>
                {sideLines.map((line, index) => {
                  const active = selectedLineKey === line.key;
                  const globalIndex = lines.findIndex((candidate) => candidate.key === line.key);
                  const held = drag != null && drag.side === side && drag.from === index;
                  return (
                    <Fragment key={line.key}>
                      {dropMarker(side, index)}
                      <div
                        ref={(element) => {
                          if (element) rowRefs.current.set(line.key, element);
                          else rowRefs.current.delete(line.key);
                        }}
                        className={`flex items-stretch gap-1 ${held ? "relative z-10" : ""}`}
                        style={held ? { transform: `translateY(${drag.dy}px)` } : undefined}
                      >
                        <button
                          ref={(element) => {
                            if (element) optionRefs.current.set(line.key, element);
                            else optionRefs.current.delete(line.key);
                          }}
                          type="button"
                          role="option"
                          aria-selected={active}
                          aria-label={`${line.name}: ${moveText(line.sans)}`}
                          tabIndex={active || (selectedLineKey == null && globalIndex === 0) ? 0 : -1}
                          onClick={() => onSelect(line, line.sans.length - 1)}
                          onKeyDown={(event) => onKeyDown(event, line)}
                          className={`min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent-dim ${
                            active
                              ? "border-accent-dim bg-accent-soft text-ink"
                              : "border-line bg-panel2/60 text-ink2 hover:border-line2 hover:bg-panel2"
                          } ${held ? "shadow-lg shadow-black/40" : ""}`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{line.name}</span>
                            {line.hasNote && <Lightbulb aria-hidden="true" size={12} className="shrink-0 text-ink3" />}
                            {line.hasTransposition && <Shuffle aria-hidden="true" size={12} className="shrink-0 text-gold" />}
                            {line.due > 0 && (
                              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                                {line.due}
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 flex flex-wrap gap-1 font-mono text-[11px] leading-5">
                            <span
                              className={`rounded px-1 ${active && selectedPly === -1 ? "bg-accent text-accent-ink" : "text-ink3"}`}
                            >
                              {t("rep.startShort")}
                            </span>
                            {line.sans.map((san, ply) => (
                              <span
                                key={`${ply}:${san}`}
                                className={`rounded px-1 ${active && selectedPly === ply ? "bg-accent text-accent-ink" : "bg-panel3/70 text-ink2"}`}
                              >
                                {ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : san}
                              </span>
                            ))}
                          </span>
                        </button>
                        {/* Der Griff zieht die Variante an ihren Platz, mit der
                            Maus wie mit dem Finger; ueber die Tastatur schieben
                            ihn die Pfeiltasten um eine Position. */}
                        {onReorder && (
                          <button
                            type="button"
                            aria-label={t("rep.reorderHandle", { name: line.name })}
                            title={t("rep.reorderHandle", { name: line.name })}
                            onPointerDown={(event) => startDrag(event, line)}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                              event.preventDefault();
                              commitMove(side, index, index + (event.key === "ArrowUp" ? -1 : 1));
                            }}
                            className={`flex w-7 shrink-0 touch-none items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-dim ${
                              held
                                ? "border-accent-dim bg-accent-soft text-accent"
                                : "border-line bg-panel2/60 text-ink3 hover:border-line2 hover:text-ink2"
                            }`}
                          >
                            <GripVertical aria-hidden="true" size={14} />
                          </button>
                        )}
                        {onEdit && (
                          <button
                            type="button"
                            aria-label={t("rep.editLine", { name: line.name })}
                            title={t("rep.editVariant")}
                            onClick={() => onEdit(line)}
                            className="flex w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2/60 text-ink3 transition-colors hover:border-line2 hover:text-ink2 focus:outline-none focus:ring-2 focus:ring-accent-dim"
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            aria-label={t("rep.deleteLine", { name: line.name })}
                            title={t("rep.deleteVariant")}
                            onClick={() => onDelete(line)}
                            className="flex w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-panel2/60 text-ink3 transition-colors hover:border-loss-dim hover:text-loss focus:outline-none focus:ring-2 focus:ring-accent-dim"
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                {dropMarker(side, sideLines.length)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Auf dem Handy klappt ein Bereich zu, auf dem Desktop steht er offen. */
function Panel({
  compact,
  icon,
  title,
  children,
  defaultOpen = false,
  pad = true,
}: {
  compact: boolean;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  pad?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!compact) {
    return (
      <Card title={<span className="flex items-center gap-2">{icon} {title}</span>} pad={pad}>
        {children}
      </Card>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <span className="text-accent">{icon}</span>
        <span className="flex-1 text-[13.5px] font-medium text-ink">{title}</span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className={`border-t border-line ${pad ? "p-4" : ""}`}>{children}</div>}
    </section>
  );
}

function LiveRepertoire() {
  const t = useT();
  const { locale } = useI18n();
  const compact = useMobileShell();
  const diagramMode = useDiagramMode();
  // Eröffnungsbudget: gemessene Zeit im Repertoire statt 30 Sekunden je Karte.
  useTrainingSession("openings");
  const [nodes, setNodes] = useState<RepNode[]>([]);
  const [stats, setStats] = useState<RepStats | null>(null);
  const [gaps, setGaps] = useState<RepGap[] | null>(null);
  const [plies, setPlies] = useState(8);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const [nodeStats, setNodeStats] = useState<NodeGameStats | null>(null);
  const [mode, setMode] = useState<"browse" | "add" | "train" | "free">("browse");
  /** Zug, mit dem der Baukasten aufgeht, wenn er vom Brett aus gestartet wurde. */
  const [seedSans, setSeedSans] = useState<string[]>([]);
  /**
   * Ob der Baukasten gleich im Fokus aufgehen soll.
   *
   * Wer im Fokus-Brett einen Zug spielt, will weiterziehen und nicht die Seite
   * wechseln · der Baukasten geht dahinter auf, das Brett bleibt vorn.
   */
  const [seedFocused, setSeedFocused] = useState(false);
  /**
   * Die Variante, die im Baukasten bearbeitet wird · null heißt „neu anlegen".
   *
   * Sie hängt nicht an der Auswahl: Bearbeitet wird die Zeile, auf deren Griff
   * getippt wurde, und nicht die, die zufällig gerade aufgeschlagen ist.
   */
  const [editing, setEditing] = useState<VariationLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ due: number; fresh: number }>({ due: 20, fresh: 5 });
  const now = Math.floor(Date.now() / 1000);

  const reload = useCallback(() => {
    repList().then(setNodes).catch(() => {});
    repGaps().then(setGaps).catch(() => setGaps([]));
    repStats(plies).then(setStats).catch(() => {});
  }, [plies]);

  useEffect(() => {
    repList().then(setNodes).catch(() => {});
    repGaps().then(setGaps).catch(() => setGaps([]));
  }, []);

  // Die Prüftiefe ändert nur die Abdeckung · Baum und Lücken bleiben stehen.
  useEffect(() => {
    repStats(plies).then(setStats).catch(() => {});
  }, [plies]);

  useEffect(() => {
    getSettings()
      .then((s) => setLimits({ due: s.rep_due_limit, fresh: s.rep_new_limit }))
      .catch(() => {});
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const children = useMemo(() => {
    const map = new Map<string, RepNode[]>();
    for (const n of nodes) {
      const key = `${n.side}:${n.parent_id}`;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [nodes]);

  /**
   * Stellungen, die im Baum mehrfach vorkommen. Das Repertoire ist ein Baum,
   * Schach nicht: dieselbe Stellung über eine andere Zugfolge wird ein zweiter
   * Knoten mit eigenem Lernstand · sichtbar zu machen ist das Mindeste.
   */
  const transpositions = useMemo(() => {
    const map = new Map<string, RepNode[]>();
    for (const n of nodes) {
      const key = `${n.side}:${n.fen_key}`;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [nodes]);
  const twinsOf = useCallback(
    (n: RepNode) => (transpositions.get(`${n.side}:${n.fen_key}`) ?? []).filter((o) => o.id !== n.id),
    [transpositions]
  );

  /** Vollständige Knotenfolge von der Grundstellung bis zu diesem Zug. */
  const pathNodes = useCallback(
    (id: number | null): RepNode[] => {
      const path: RepNode[] = [];
      let cur = id;
      while (cur != null && cur !== 0) {
        const n = byId.get(cur);
        if (!n) break;
        path.push(n);
        cur = n.parent_id;
      }
      return path.reverse();
    },
    [byId]
  );

  const pathSans = useCallback(
    (id: number | null): string[] => pathNodes(id).map((node) => node.san),
    [pathNodes]
  );

  const variationLines = useMemo<VariationLine[]>(() => {
    const ordered = nodes
      // Benannte Zwischenlinien bleiben eigene Varianten (z. B. "Italian
      // Game" neben den längeren Fortsetzungen); unbenannte Pfade erscheinen
      // nur an ihrem Endpunkt.
      .filter((node) => node.name.trim() !== "" || (children.get(`${node.side}:${node.id}`) ?? []).length === 0)
      .map((endpoint) => {
        const path = pathNodes(endpoint.id);
        const ancestorName = [...path.slice(0, -1)].reverse().find((node) => node.name.trim() !== "")?.name.trim();
        return {
          key: `${endpoint.side}:${endpoint.id}`,
          side: endpoint.side,
          targetId: endpoint.id,
          name: endpoint.name.trim() || (ancestorName ? `${ancestorName} · ${moveLabel(endpoint)}` : moveLabel(endpoint)),
          sans: path.map((node) => node.san),
          nodeIds: path.map((node) => node.id),
          due: path.filter((node) => node.my_move && (node.reps === 0 || node.due_ts <= now)).length,
          hasNote: path.some((node) => node.note.trim() !== ""),
          hasTransposition: path.some((node) => twinsOf(node).length > 0),
          sortOrder: endpoint.sort_order,
        };
      });
    // Selbst gezogene Reihenfolge zuerst; was nie sortiert wurde (0), haengt
    // sich hinten an und bleibt dort in der Reihenfolge des Anlegens.
    return ordered.sort(
      (a, b) => (a.sortOrder || Number.MAX_SAFE_INTEGER) - (b.sortOrder || Number.MAX_SAFE_INTEGER)
    );
  }, [children, nodes, now, pathNodes, twinsOf]);

  /**
   * Neue Reihenfolge einer Seite speichern. Das Backend bekommt die Endpunkte
   * als Id-Liste; danach steht sie in `sort_order` und der Sync traegt sie zum
   * anderen Geraet.
   */
  const reorderLines = useCallback(
    (side: "white" | "black", keys: string[]) => {
      const byKey = new Map(variationLines.map((line) => [line.key, line]));
      const ids = keys
        .map((key) => byKey.get(key)?.targetId)
        .filter((id): id is number => typeof id === "number");
      repReorder(side, ids)
        .then(reload)
        .catch((e) => setNotice(errorMessage(e)));
    },
    [reload, variationLines]
  );

  const selectedLine = variationLines.find((line) => line.key === selectedLineKey) ?? null;
  const selectedPly = selectedLine && selectedId != null
    ? (selectedLine.nodeIds ?? []).indexOf(selectedId)
    : -1;

  const selectVariation = useCallback((line: VariationLine, ply: number) => {
    setSelectedLineKey(line.key);
    setSelectedId(ply >= 0 ? (line.nodeIds?.[ply] ?? null) : null);
  }, []);

  const selected = selectedId != null ? (byId.get(selectedId) ?? null) : null;
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  const baseSans = useMemo(() => pathSans(selectedId), [pathSans, selectedId]);
  const position = useMemo(() => replaySans(baseSans), [baseSans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

  useEffect(() => {
    setNodeStats(null);
    if (selectedId != null) {
      repNodeGames(selectedId).then(setNodeStats).catch(() => {});
    }
  }, [selectedId, nodes]);

  const seedStarter = async () => {
    const flat: { side: "white" | "black"; name: string; sans: string[] }[] = [];
    const collect = (side: "white" | "black", ns: DemoNode[]) => {
      for (const n of ns) {
        flat.push({ side, name: n.label, sans: n.moveSeq });
        if (n.children) collect(side, n.children);
      }
    };
    for (const grp of demoRepertoire) collect(grp.side === "Weiß" ? "white" : "black", grp.nodes);
    try {
      await batchDataChanges(async () => {
        for (const line of flat) await repAddLine(line.side, line.name, line.sans);
      });
      reload();
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  /**
   * Was beim Löschen einer Variante wirklich fallen darf.
   *
   * `rep_delete` nimmt einen Knoten samt Untervarianten · gäbe man ihm den
   * Endpunkt der Zeile, bliebe der ganze Weg dorthin als Rumpf stehen; gäbe
   * man ihm die Wurzel, risse man Schwesternvarianten mit. Gesucht ist der
   * höchste Knoten, der nur zu dieser einen Zeile gehört: von unten nach
   * oben, solange der Vorgaenger genau ein Kind hat und selbst keinen Namen
   * trägt (ein benannter Vorgaenger steht als eigene Variante in der Liste
   * und muss stehen bleiben).
   */
  const exclusiveRoot = useCallback(
    (endpointId: number): number => {
      const path = pathNodes(endpointId);
      // Von unten nach oben zurücklaufen und beim ersten Vorgänger halten,
      // der noch woanders gebraucht wird.
      let root = endpointId;
      for (let i = path.length - 2; i >= 0; i -= 1) {
        const node = path[i];
        if (node.name.trim() !== "") break;
        if ((children.get(`${node.side}:${node.id}`) ?? []).length !== 1) break;
        root = node.id;
      }
      return root;
    },
    [children, pathNodes]
  );

  /**
   * Eine bearbeitete Variante zurückschreiben.
   *
   * `rep_add_line` legt an und benutzt wieder: Was von der Zeile stehen bleibt,
   * behält seine Knoten und damit seinen Lernstand · genau deshalb ist
   * Bearbeiten nicht dasselbe wie Löschen und neu Anlegen. Drei Fälle
   * unterscheiden sich danach nur noch darin, was von der *alten* Zeile übrig
   * ist:
   *
   * · **Nur der Name geändert.** Der Endpunkt bleibt derselbe, es ist nichts
   *   aufzuräumen.
   * · **Verlängert.** Der alte Endpunkt liegt jetzt mitten in der Zeile. Er
   *   trüge den Namen weiter und stünde als zweite, gleichnamige Zeile im
   *   Verzeichnis · deshalb verliert er ihn.
   * · **Gekürzt oder abgebogen.** Der Rest ab der Abzweigung gehört nicht mehr
   *   dazu. Weggenommen wird er von unten nach oben, und nur so weit, wie er
   *   wirklich allein dieser Zeile gehört: Hängt daran noch eine benannte
   *   Fortsetzung oder eine Schwesternvariante, bleibt sie stehen, und der
   *   alte Endpunkt verliert bloß seinen Namen.
   *
   * Was oberhalb der Abzweigung liegt, wird nie angefasst · dort steht die
   * neue Zeile selbst.
   */
  const writeEdit = useCallback(
    async (line: VariationLine, side: "white" | "black", name: string, sans: string[]) => {
      const leafId = await repAddLine(side, name, sans);
      // Auch das Leeren muss ankommen · `rep_add_line` lässt einen alten Namen
      // stehen, wenn das Feld leer ist.
      await repSetName(leafId, name);
      const oldId = typeof line.targetId === "number" ? line.targetId : null;
      if (oldId == null || oldId === leafId) return;

      let gemeinsam = 0;
      while (
        gemeinsam < line.sans.length &&
        gemeinsam < sans.length &&
        line.sans[gemeinsam] === sans[gemeinsam]
      )
        gemeinsam += 1;
      if (gemeinsam === line.sans.length) {
        await repSetName(oldId, "");
        return;
      }

      // Von unten nach oben, bis etwas kommt, das bleiben muss. Der Baum unter
      // der Abzweigung hat sich beim Anlegen nicht geändert · die neue Zeile
      // führt dort nicht entlang, und deshalb stimmt der Stand, den die Seite
      // schon hat.
      const ids = line.nodeIds ?? [];
      let schnitt: number | null = null;
      for (let i = ids.length - 1; i >= gemeinsam; i -= 1) {
        const node = byId.get(ids[i]);
        if (!node) break;
        const kinder = children.get(`${node.side}:${node.id}`) ?? [];
        const letzter = i === ids.length - 1;
        const nurDieZeile = letzter
          ? kinder.length === 0
          : kinder.length === 1 && kinder[0].id === ids[i + 1];
        if (!nurDieZeile) break;
        // Ein benannter Zwischenknoten ist eine eigene Variante im Verzeichnis
        // · der einzige, dessen Name hier zur Debatte steht, ist der Endpunkt.
        if (!letzter && node.name.trim() !== "") break;
        schnitt = ids[i];
      }
      if (schnitt != null) await repDelete(schnitt);
      else await repSetName(oldId, "");
    },
    [byId, children]
  );

  const remove = async (id: number) => {
    await repDelete(id).catch((e) => setNotice(errorMessage(e)));
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedLineKey(null);
    }
    reload();
  };

  /**
   * Löschen fragt nach · eine Variante ist Wochen an Wiederholungen, und der
   * Mülleimer sitzt in der Liste direkt neben dem Zieh-Griff.
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    await remove(id);
  };

  /** Einen Zug aus einer Lücke ins Buch übernehmen. */
  const adoptGap = async (gap: RepGap) => {
    try {
      await repAddLine(gap.side, "", [...gap.path_sans, gap.san]);
      reload();
      setNotice(t("rep.gapAdded", { san: gap.san }));
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const dueTotal = stats?.due_now ?? 0;
  /**
   * Wie viele Fragen das Buch überhaupt hergibt · unabhängig davon, wann sie
   * das nächste Mal fällig wären. Ohne eine einzige eigene Stellung gibt es
   * nichts zu üben, und dann steht der Knopf auch nicht da.
   */
  const freeTotal = useMemo(() => {
    const asked = new Set<string>();
    for (const node of nodes) {
      if (node.my_move) asked.add(`${node.side}:${node.parent_id}`);
    }
    return asked.size;
  }, [nodes]);

  const treePanel = (
    <Panel compact={compact} icon={<ListTree size={14} />} title={t("rep.variants")} pad={false}>
      <VariationList
        lines={variationLines}
        selectedLineKey={selectedLineKey}
        selectedPly={selectedPly}
        onSelect={selectVariation}
        onReorder={reorderLines}
        onDelete={(line) =>
          typeof line.targetId === "number" &&
          setPendingDelete({ id: exclusiveRoot(line.targetId), name: line.name })
        }
        onEdit={(line) => {
          setEditing(line);
          setSeedSans([]);
          setSeedFocused(false);
          setMode("add");
        }}
      />
      <div className="border-t border-line p-2">
        {nodes.length === 0 && (
          <button
            onClick={seedStarter}
            className="mb-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-accent-dim px-3 py-2 text-[12.5px] text-accent transition-colors hover:bg-accent-soft"
          >
            <Sparkles size={14} /> {t("rep.seedStarter")}
          </button>
        )}
        <button
          onClick={() => {
            setEditing(null);
            setSeedSans([]);
            setSeedFocused(false);
            setMode("add");
          }}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 px-3 py-2 text-left text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
        >
          <Plus size={14} className="shrink-0" />
          <span className="min-w-0 truncate">
            {selected ? t("rep.addLineFrom", { label: moveLabel(selected) }) : t("rep.addLine")}
          </span>
        </button>
      </div>
    </Panel>
  );

  /**
   * Die Variante, wie sie beim Empfänger ankommt.
   *
   * Geteilt wird die Stellung, die auf dem Brett steht, und dazu die Züge, die
   * im Buch danach kommen · eine Eröffnung ist eine Fortsetzung und keine
   * Einzelstellung. Der Name der Linie steht schon in der Überschrift, damit
   * niemand abtippt, was die Seite längst weiß.
   */
  const openShare = () => {
    const line = selectedLine ? replaySans(selectedLine.sans).moves.slice(baseSans.length) : [];
    setSharing({
      kind: "repertoire",
      fen,
      orientation: selected?.side ?? "white",
      lastMove,
      line,
      // Der Weg zur Stellung gehört bei einer Eröffnung dazu · dieselbe Zeile,
      // die auch unter dem Brett steht.
      history: shareHistory(baseSans),
      title: selectedLine?.name,
    });
  };

  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);

  /**
   * Ein Zug auf dem Brett der Übersicht ist eine Absichtserklaerung: hier
   * soll etwas ins Buch. Statt ihn wirkungslos verpuffen zu lassen, oeffnet er
   * den Baukasten mit genau diesem Zug als erstem Schritt · das ist derselbe
   * Weg wie „Variante hinzufügen“, nur ohne den Umweg ueber den Knopf.
   */
  const startFromMove = (from: string, to: string): boolean => {
    try {
      const chess = new Chess(fen);
      const move = chess.move({ from, to, promotion: "q" });
      setEditing(null);
      setSeedSans([move.san]);
      // Aus dem Fokus heraus gezogen, bleibt der Fokus · der Baukasten
      // übernimmt ihn mit dem Zug, der ihn geöffnet hat. Das eigene Fokus-Brett
      // der Übersicht geht dabei zu: Es hat den Zug schon abgegeben, und beim
      // Zurückkommen aus dem Baukasten will man die Liste sehen.
      setSeedFocused(focused);
      setFocused(false);
      setMode("add");
      return true;
    } catch {
      return false;
    }
  };
  const browseSelection = useBoardSelection(fen, startFromMove);

  /**
   * Brett und Zugzeile als benannte Bausteine · die Seite und das Fokus-Brett
   * zeigen dieselben. Das Brett bekommt je eine eigene Kennung, weil
   * react-chessboard seine Instanzen daran unterscheidet.
   */
  const browseBoard = (boardId: string) => (
    <div className="board-bleed">
      <Board
        boardId={boardId}
        fen={fen}
        width={BOARD_MAX}
        lastMove={lastMove}
        draggable
        onPieceDrop={startFromMove}
        onSquareClick={browseSelection.onSquareClick}
        squareStyles={browseSelection.squareStyles}
        orientation={selected?.side ?? "white"}
        mouseDrag
      />
    </div>
  );

  /** Im Fokus fehlt der Griff zum Fokus · dort ist man schon. */
  const browseMoves = (inFocus: boolean) => (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2.5">
      <span className="min-w-0 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(baseSans) || t("rep.startPos")}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button onClick={openShare} title={t("sh.title")} label={t("sh.title")} compact>
          <Share2 size={14} />
        </Button>
        {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
      </div>
    </div>
  );

  const boardPane = (
    <div className="max-w-[var(--board-edge)]">
      {browseBoard("repertoire")}
      {browseMoves(false)}
      <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink3">{t("rep.playToAdd")}</p>

      <FocusBoard
        open={focused}
        onClose={() => setFocused(false)}
        title={t("rep.title")}
        subtitle={selected ? moveLabel(selected) : undefined}
        below={browseMoves(true)}
      >
        {browseBoard("repertoire-focus")}
      </FocusBoard>
    </div>
  );

  const detailsPane = (
    <div className="flex flex-col gap-4">
      {selected ? (
        <>
          <Card
            title={moveLabel(selected)}
            action={
              <button
                onClick={() => setPendingDelete({ id: selected.id, name: moveLabel(selected) })}
                className="text-ink3 transition-colors hover:text-loss"
                title={t("rep.deleteVariant")}
              >
                <Trash2 size={15} />
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">{t("rep.reps")}</div>
                <div className="mt-1 text-[20px] font-semibold">
                  {selected.reps}
                  {selected.lapses > 0 && (
                    <span className="ml-1.5 text-[12px] font-normal text-loss">
                      {t("rep.lapses", { n: selected.lapses })}
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">{t("rep.nextReview")}</div>
                <div className="mt-1 text-[20px] font-semibold">
                  {selected.my_move ? dueLabel(t, selected, now) : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 text-[12.5px] leading-relaxed text-ink3">
              {selected.my_move
                ? t("rep.stability", { n: de(Math.max(selected.stability, 0)) })
                : t("rep.opponentMove")}
            </div>
            <NoteEditor
              key={selected.id}
              node={selected}
              onSaved={reload}
              onError={(e) => setNotice(e)}
            />
            {twinsOf(selected).length > 0 && (
              <div className="mt-3 flex gap-2 rounded-lg border border-gold-dim bg-gold-soft px-3 py-2 text-[12px] leading-relaxed text-gold">
                <Shuffle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t("rep.transposition", {
                    lines: twinsOf(selected)
                      .map((n) => moveText(pathSans(n.id)))
                      .join(" · "),
                  })}
                </span>
              </div>
            )}
          </Card>

          <Card title={t("rep.gamesCard")}>
            {nodeStats && nodeStats.games > 0 ? (
              <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-win" />
                  <span className="text-ink2">
                    {t("rep.reachedIn", {
                      games: `${nodeStats.games} ${t(nodeStats.games === 1 ? "common.games.one" : "common.games.many")}`,
                      p: de(nodeStats.score_pct),
                    })}
                  </span>
                </li>
                {nodeStats.book_sans.length > 0 && (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span className="text-ink2">
                      {t("rep.bookContinuation", {
                        sans: nodeStats.book_sans.join(" / "),
                        n: nodeStats.followed_book,
                      })}
                    </span>
                  </li>
                )}
                {nodeStats.deviations.length > 0 && (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-loss" />
                    <span className="text-ink2">
                      {t("rep.deviations", {
                        list: nodeStats.deviations.map((d) => `${d.san} (${d.count}×)`).join(", "),
                      })}
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <div className="text-[12.5px] leading-relaxed text-ink3">{t("rep.posNotInGames")}</div>
            )}
          </Card>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-6 text-center text-[12.5px] leading-relaxed text-ink3">
          {t(compact ? "rep.selectHintMobile" : "rep.selectHint")}
        </div>
      )}

      <CoverageCard stats={stats} plies={plies} onPlies={setPlies} />
      <GapsCard gaps={gaps} onAdopt={adoptGap} />
      <BookCard onDone={reload} onNotice={setNotice} />
    </div>
  );

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("rep.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {stats
              ? t("rep.summary", {
                  n: stats.my_positions,
                  p: de(stats.coverage_pct),
                  g: stats.games_checked,
                })
              : t("common.loading")}
          </p>
        </div>
        {mode !== "train" && mode !== "free" && (
          /* „Daneben" heißt auch auf dem Telefon daneben: Die beiden Knöpfe
             teilen sich dort eine volle Zeile, statt umzubrechen. Untereinander
             las sich der freie Lauf wie eine Nachrangigkeit · dabei ist er an
             jedem Tag ohne fällige Wiederholung der einzige Weg, der etwas
             hergibt.

             Geteilt wird die Zeile aber nicht mehr hälftig: „Frei üben" heißt
             auf dem Telefon nur „Frei" und behält damit seine volle
             Beschriftung, statt als „Frei üb…" dazustehen. Was übrig bleibt,
             gehört dem Trainingsknopf, dessen Zahl in Klammern sonst als
             Erstes verschwindet. */
          <div className={compact ? "flex w-full items-center gap-2" : "flex flex-wrap items-center gap-2"}>
            <Button
              primary={dueTotal > 0}
              onClick={() => setMode("train")}
              className={`${compact ? "min-w-0 flex-auto" : ""} ${dueTotal === 0 ? "opacity-60" : ""}`}
            >
              <GraduationCap size={16} />
              <span className="truncate">{t("rep.startTraining", { n: dueTotal })}</span>
            </Button>
            {/* Üben, ohne zu müssen. Steht immer daneben und wird zum Haupt-
                knopf, sobald der Plan nichts mehr hergibt · sonst wäre der
                einzige sichtbare Weg an manchen Tagen ein grauer Knopf mit
                einer Null darauf. */}
            {freeTotal > 0 && (
              <Button
                primary={dueTotal === 0}
                onClick={() => setMode("free")}
                title={t("rep.freeNote")}
                className={compact ? "shrink-0" : ""}
              >
                <Shuffle size={16} />
                <span className="truncate">
                  {t(compact ? "rep.freeTrainingShort" : "rep.freeTraining")}
                </span>
              </Button>
            )}
          </div>
        )}
      </header>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-line2 bg-panel2 px-4 py-2.5 text-[12.5px] text-ink2">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-ink3 hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {mode === "train" || mode === "free" ? (
        <RepertoireTrainer
          // Die Kennung wechselt mit der Betriebsart · so zieht der Trainer
          // beim Umschalten einen frischen Stapel, statt den alten zu behalten.
          key={mode}
          nodes={nodes}
          dueLimit={limits.due}
          newLimit={limits.fresh}
          free={mode === "free"}
          onFreeTraining={freeTotal > 0 ? () => setMode("free") : undefined}
          onExit={() => {
            setMode("browse");
            reload();
          }}
        />
      ) : mode === "add" ? (
        <AddLine
          // Frisch aufsetzen, wenn eine andere Zeile drankommt · der Baukasten
          // hält seine Züge im eigenen Zustand.
          key={editing?.key ?? "neu"}
          // Beim Bearbeiten steht die ganze Zeile zur Verfügung, von der
          // Grundstellung an · sonst hinge sie an der Stellung, die zufällig
          // aufgeschlagen ist, und ließe sich nicht kürzen.
          baseSans={editing ? [] : baseSans}
          baseSide={editing ? editing.side : (selected?.side ?? null)}
          seedSans={editing ? editing.sans : seedSans}
          seedName={editing?.name ?? ""}
          eigeneIds={editing?.nodeIds}
          startFocused={seedFocused}
          onSave={editing ? (side, name, sans) => writeEdit(editing, side, name, sans) : undefined}
          onDone={(err) => {
            setMode("browse");
            setEditing(null);
            setSeedSans([]);
            setSeedFocused(false);
            if (err) setNotice(err);
            reload();
          }}
        />
      ) : diagramMode ? (
        // Das Buch · dieselben Varianten, dieselbe Stellung, anders gesetzt.
        // Die Buchstellung ist ein Abdruck: Hier wird gelesen, gezogen wird
        // erst im Training (oben, `mode === "train"`).
        <Suspense fallback={<LeereSeite />}>
          <RepertoireBlatt
            mobile={compact}
            kopfRechts={
              stats
                ? t("rep.summary", {
                    n: deInt(stats.my_positions),
                    p: de(stats.coverage_pct),
                    g: deInt(stats.games_checked),
                  })
                : t("common.loading")
            }
            felder={[
              {
                label: t("blatt.variant"),
                wert: selectedLine?.name ?? t("rep.startPos"),
                gross: true,
              },
              {
                label: t("blatt.side"),
                wert: selectedLine
                  ? t(selectedLine.side === "white" ? "common.white" : "common.black")
                  : "—",
              },
              {
                label: t("rep.reps"),
                wert: selected ? (
                  <>
                    <span className="blatt-zahl">{deInt(selected.reps)}</span>
                    {selected.lapses > 0 && (
                      <span className="text-ink3"> {t("rep.lapses", { n: deInt(selected.lapses) })}</span>
                    )}
                  </>
                ) : (
                  "—"
                ),
              },
              {
                label: t("rep.nextReview"),
                wert: selected ? dueLabel(t, selected, now) : "—",
              },
            ]}
            faellig={dueTotal}
            teile={(["white", "black"] as const).map((side) => ({
              titel: t(side === "white" ? "common.white" : "common.black"),
              seite: side,
              zeilen: variationLines
                .filter((line) => line.side === side)
                .map((line) => ({
                  key: line.key,
                  name: line.name,
                  faellig: line.due,
                  zuege: line.sans.length,
                })),
            }))}
            aktiv={selectedLineKey}
            fen={fen}
            unterschrift={[
              t("blatt.bookPosition"),
              selectedLine?.name ?? t("rep.startPos"),
            ]}
            amZug={baseSans.length % 2 === 0 ? "white" : "black"}
            seite={selected?.side ?? "white"}
            linie={notationLine(baseSans, locale)}
            angaben={[
              {
                label: t("blatt.positionsBelow"),
                wert: selectedLine ? deInt(selectedLine.sans.length) : "—",
              },
              {
                label: t("blatt.stability"),
                wert: selected ? t("blatt.days", { n: deInt(Math.round(selected.stability)) }) : "—",
              },
              {
                label: t("blatt.reachedIn"),
                wert: nodeStats ? deInt(nodeStats.games) : "—",
              },
              {
                label: t("blatt.scored"),
                wert: nodeStats && nodeStats.games > 0 ? `${de(nodeStats.score_pct)} %` : "—",
              },
            ]}
            notiz={selected?.note.trim() ?? ""}
            notizPlatzhalter={t("rep.notePlaceholder")}
            abdeckung={stats ? stats.coverage_pct : null}
            abdeckungNote={t("rep.coverageNote")}
            abdeckungUnter={
              stats
                ? `${t("rep.coverageOf", { g: deInt(stats.games_checked) })} · ${t("rep.coveragePlies", { n: deInt(stats.plies) })}`
                : ""
            }
            luecken={
              gaps == null
                ? t("common.loading")
                : gaps.length === 0
                  ? t("rep.gapsNone")
                  : t("rep.gapsCollapsed", { n: deInt(gaps.length) })
            }
            aktivZug={selectedPly}
            onWaehlen={(key) => {
              const line = variationLines.find((value) => value.key === key);
              if (line) selectVariation(line, (line.nodeIds?.length ?? 0) - 1);
            }}
            // Blättern ist Auswählen mit einem Halbzug daran · derselbe Weg,
            // den auch die Liste der gewöhnlichen Fassung geht.
            onZug={(key, zug) => {
              const line = variationLines.find((value) => value.key === key);
              if (line) selectVariation(line, zug);
            }}
            onVerschieben={reorderLines}
            onBearbeiten={(key) => {
              const line = variationLines.find((value) => value.key === key);
              if (!line) return;
              setEditing(line);
              setSeedSans([]);
              setSeedFocused(false);
              setMode("add");
            }}
            onLoeschen={(key) => {
              const line = variationLines.find((value) => value.key === key);
              if (line && typeof line.targetId === "number") {
                setPendingDelete({ id: exclusiveRoot(line.targetId), name: line.name });
              }
            }}
            onHinzufuegen={() => {
              setEditing(null);
              setSeedSans([]);
              setMode("add");
            }}
            onTraining={() => setMode(dueTotal > 0 || freeTotal === 0 ? "train" : "free")}
            // Derselbe Griff wie unter dem Brett der gewöhnlichen Fassung ·
            // ein Zug auf der Buchstellung öffnet den Baukasten mit genau
            // diesem Zug als erstem Schritt.
            onZugSpielen={startFromMove}
          />
        </Suspense>
      ) : compact ? (
        // Auf dem Handy zuerst das Brett · der Variantenbaum ist eine lange
        // Liste und schöbe sonst alles Wesentliche unter die Falz.
        <div className="flex flex-col gap-4">
          {boardPane}
          {detailsPane}
          {treePanel}
        </div>
      ) : (
        <RepertoireGrid tree={treePanel} board={boardPane} details={detailsPane} />
      )}

      {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-variation-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
        >
          {/* Die Rückfrage ist ein Bedienteil und nichts sonst · im
              Diagramm-Modus setzt `blatt-formular` sie um, statt sie ein
              zweites Mal zu bauen (siehe blatt.css). */}
          <div
            className={`w-full max-w-md overflow-hidden border border-line2 bg-panel ${
              diagramMode ? "blatt-formular" : "rounded-2xl shadow-2xl shadow-black/50"
            }`}
          >
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <div
                className={`flex size-9 shrink-0 items-center justify-center bg-loss-soft text-loss ${
                  diagramMode ? "" : "rounded-xl"
                }`}
              >
                <AlertTriangle size={18} />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
                  Kiebitz
                </div>
                <h2 id="delete-variation-title" className="text-[16px] font-semibold">
                  {t("rep.deleteTitle")}
                </h2>
              </div>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-ink2">
              {t("rep.deleteConfirm", { name: pendingDelete.name })}
            </p>
            <div className="flex justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
              <Button onClick={() => setPendingDelete(null)}>{t("common.cancel")}</Button>
              <button
                type="button"
                autoFocus
                onClick={confirmDelete}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-loss-dim bg-loss-soft px-3.5 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:border-loss"
              >
                <Trash2 size={14} /> {t("rep.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Die drei Bereiche der Browse-Ansicht über die Fensterbreite verteilt.
 *
 * Das Brett hat eine feste Kantenlänge, die beiden anderen Spalten nicht ·
 * deshalb hängt die Aufteilung an genau zwei Schwellen:
 *
 * - schmal · eine Spalte, Brett zuerst; der Baum ist Navigation und darf nach
 *   unten, sonst steht die Stellung unter der Falz.
 * - ab 1180 px · Brett und Baum links untereinander, Details rechts daneben.
 *   Dieselbe Schwelle wie auf der Puzzle-Seite, die dieselbe Form hat.
 * - ab 1480 px · alle drei nebeneinander, wie gehabt.
 *
 * Ohne die mittlere Stufe stand auf jedem üblichen Fenster (1440 px minus
 * Seitenleiste) alles untereinander, mit einem 1200 px breiten Variantenbaum
 * ganz oben.
 */
function RepertoireGrid({
  tree,
  board,
  details,
}: {
  tree: ReactNode;
  board: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)] min-[1480px]:grid-cols-[280px_minmax(0,var(--board-edge))_minmax(0,1fr)]">
      <div className="order-1 min-[1180px]:col-start-1 min-[1180px]:row-start-1 min-[1480px]:col-start-2">
        {board}
      </div>
      <div className="order-2 min-[1180px]:col-start-2 min-[1180px]:row-start-1 min-[1180px]:row-span-2 min-[1480px]:col-start-3">
        {details}
      </div>
      <div className="order-3 min-[1180px]:col-start-1 min-[1180px]:row-start-2 min-[1480px]:col-start-1 min-[1480px]:row-start-1 min-[1480px]:row-span-2">
        {tree}
      </div>
    </div>
  );
}

/** Freitext zur Stellung · Plan, Idee, Falle. */
function NoteEditor({
  node,
  onSaved,
  onError,
}: {
  node: RepNode;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(node.note);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== node.note.trim();

  const save = async () => {
    setBusy(true);
    try {
      await repSetNote(node.id, text);
      onSaved();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <label className="text-[11.5px] text-ink3">{t("rep.note")}</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t("rep.notePlaceholder")}
        className="mt-1.5 w-full resize-y rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => setText(node.note)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button primary onClick={save} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Buch als PGN einlesen und ausgeben · mit Varianten in Klammern. */
function BookCard({
  onDone,
  onNotice,
}: {
  onDone: () => void;
  onNotice: (message: string) => void;
}) {
  const t = useT();
  const [side, setSide] = useState<"white" | "black">("white");
  const [name, setName] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  const report = (result: { lines: number; added: number; skipped: number }) => {
    onNotice(t("rep.pgnImported", { lines: result.lines, n: result.added }));
    onDone();
  };

  const importFile = async () => {
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (typeof chosen !== "string") return;
    setBusy(true);
    try {
      report(await repImportPgnFile(side, name.trim(), chosen));
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const importText = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    try {
      report(await repImportPgn(side, name.trim(), pasted));
      setPasted("");
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async () => {
    const chosen = await saveDialog({
      defaultPath: `kiebitz-repertoire-${side}.pgn`,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!chosen) return;
    setBusy(true);
    try {
      const path = await repExportPgnFile(side, chosen);
      onNotice(t("rep.pgnExported", { path }));
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t("rep.book")}>
      <div className="flex flex-wrap gap-1.5">
        {(["white", "black"] as const).map((s) => (
          <Chip key={s} active={side === s} onClick={() => setSide(s)}>
            {s === "white" ? t("common.asWhite") : t("common.asBlack")}
          </Chip>
        ))}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("rep.namePlaceholder")}
        className="mt-3 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => !busy && importFile()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{" "}
          {t("rep.pgnImport")}
        </Button>
        <Button onClick={() => !busy && exportFile()}>
          <Download size={14} /> {t("rep.pgnExport")}
        </Button>
        <Button onClick={() => setShowPaste((v) => !v)}>{t("rep.pgnPaste")}</Button>
      </div>
      {showPaste && (
        <div className="mt-3">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder="1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6"
            className="w-full resize-y rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button primary onClick={() => !busy && importText()} disabled={!pasted.trim()}>
              <Check size={14} /> {t("common.import")}
            </Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.pgnNote")}</p>
    </Card>
  );
}

// ── Variante am Brett eingeben ───────────────────────────────────────────────

function AddLine({
  baseSans,
  baseSide,
  seedSans = [],
  seedName = "",
  startFocused = false,
  eigeneIds,
  onSave,
  onDone,
}: {
  baseSans: string[];
  baseSide: "white" | "black" | null;
  /** Züge, die schon auf dem Brett standen, als der Baukasten aufging. */
  seedSans?: string[];
  /**
   * Der Name, der schon dransteht · nur beim Bearbeiten. Steht er da, hält
   * der Baukasten die Finger davon: Der ECO-Namensgeber überschriebe sonst
   * genau den selbst vergebenen Namen, den man gerade richtigstellen wollte.
   */
  seedName?: string;
  /**
   * Gleich im Fokus aufgehen · wenn der Zug, der den Baukasten geöffnet hat,
   * im Fokus-Brett der Übersicht gespielt wurde.
   */
  startFocused?: boolean;
  /**
   * Die Knoten der Zeile, die gerade bearbeitet wird.
   *
   * Die Transpositionswarnung fragt, wer dieselbe Stellung sonst noch
   * erreicht · beim Bearbeiten ist die erste Antwort die Zeile selbst, und
   * eine Warnung vor sich selbst ist keine.
   */
  eigeneIds?: number[];
  /**
   * Was beim Sichern geschieht · ohne sie wird angelegt (`repAddLine`).
   * Beim Bearbeiten schreibt die Seite die Zeile zurück und räumt auf, was
   * von der alten übrig bleibt.
   */
  onSave?: (side: "white" | "black", name: string, sans: string[]) => Promise<void>;
  onDone: (err?: string) => void;
}) {
  const t = useT();
  const bearbeiten = onSave != null;
  const [draft, setDraft] = useState<string[]>(seedSans);
  const [name, setName] = useState(seedName);
  const [nameEdited, setNameEdited] = useState(seedName.trim() !== "");
  const [side, setSide] = useState<"white" | "black">(baseSide ?? "white");
  const [book, setBook] = useState<ChessDbResult | null>(null);
  const [twins, setTwins] = useState<RepNode[]>([]);
  /** Brett allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(startFocused);
  const chessRef = useRef<Chess>(new Chess());

  const sans = useMemo(() => [...baseSans, ...draft], [baseSans, draft]);

  // Der große ECO-Datensatz wird erst beim Anlegen einer Variante geladen. So
  // bleibt der normale Seitenstart klein, der Name funktioniert aber offline.
  useEffect(() => {
    if (nameEdited) return;
    let stale = false;
    import("../lib/openings")
      .then(({ openingName }) => {
        if (!stale) setName(openingName(sans));
      })
      .catch(() => {
        if (!stale) setName("");
      });
    return () => {
      stale = true;
    };
  }, [nameEdited, sans]);

  useEffect(() => {
    const c = new Chess();
    for (const s of sans) c.move(s);
    chessRef.current = c;
  }, [sans]);

  const position = useMemo(() => replaySans(sans), [sans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

  // Steht diese Stellung schon woanders im Buch? Entprellt, weil beim
  // schnellen Durchklicken sonst jede Zwischenstellung nachfragt.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      repLookup(side, sans)
        .then((found) => {
          if (!stale) setTwins(found.filter((node) => !(eigeneIds ?? []).includes(node.id)));
        })
        .catch(() => {});
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [side, sans, eigeneIds]);

  // ChessDB als Orientierung beim Bauen · ohne sie legt man Varianten an,
  // ohne zu wissen, was überhaupt gespielt wird.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      chessdbQuery(fen)
        .then((r) => {
          if (!stale) setBook(r);
        })
        .catch(() => {
          if (!stale) setBook(null);
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [fen]);

  /**
   * Brett und Zugzeile als benannte Bausteine · die Seite und das Fokus-Brett
   * zeigen dieselben. Die Kennung unterscheidet die beiden Brett-Instanzen.
   */
  const addBoard = (boardId: string) => (
    <div className="board-bleed">
      <Board
        boardId={boardId}
        fen={fen}
        width={BOARD_MAX}
        lastMove={lastMove}
        draggable
        onPieceDrop={tryMove}
        onSquareClick={addSelection.onSquareClick}
        squareStyles={addSelection.squareStyles}
        orientation={side}
        mouseDrag
      />
    </div>
  );

  /** Im Fokus fehlt der Griff zum Fokus · dort ist man schon. */
  const addMoves = (inFocus: boolean) => (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2.5">
      <span className="min-w-0 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(sans) || t("rep.playOnBoard")}
      </span>
      {!inFocus && <FocusButton onClick={() => setFocused(true)} />}
    </div>
  );

  const tryMove = (from: string, to: string): boolean => {
    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      setDraft((d) => [...d, move.san]);
      return true;
    } catch {
      return false;
    }
  };
  const addSelection = useBoardSelection(fen, tryMove);

  /** Zug aus dem Eröffnungsbuch übernehmen. */
  const playSan = (san: string) => {
    try {
      const move = chessRef.current.move(san);
      setDraft((d) => [...d, move.san]);
    } catch {
      /* Zug passt nicht zur Stellung · dann eben nicht. */
    }
  };

  /** Ersten Zug einer angeklickten Engine-Linie auf das Brett übernehmen. */
  const playUci = (uci: string) => {
    try {
      const move = chessRef.current.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] ?? "q",
      });
      setDraft((d) => [...d, move.san]);
    } catch {
      /* Veraltete Engine-Zeile nach einem Stellungswechsel ignorieren. */
    }
  };

  const undo = useCallback(() => setDraft((d) => d.slice(0, -1)), []);

  /**
   * Pfeil nach links nimmt den letzten Zug zurück · beim Bauen einer Variante
   * verklickt man sich, und der Griff zur Maus für „Zug zurück“ reißt aus
   * dem Fluss. Tippt gerade jemand den Namen, gehört die Taste dem Feld.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const save = async () => {
    if (draft.length === 0) return;
    try {
      await (onSave ? onSave(side, name, sans) : repAddLine(side, name, sans));
      onDone();
    } catch (e) {
      onDone(errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-[minmax(0,var(--board-edge))_minmax(0,1fr)]">
      <div className="max-w-[var(--board-edge)]">
        {addBoard("rep-add")}
        {addMoves(false)}
        {/* Beim Bearbeiten steht hier, was das Sichern mit der alten Zeile
            macht · dass gekürzte Züge wirklich weg sind und der Lernstand der
            übrigen bleibt, ist die Frage, die man sich davor stellt. */}
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink3">
          {bearbeiten ? t("rep.editHint") : t("rep.undoMoveHint")}
        </p>

        <FocusBoard
          open={focused}
          onClose={() => setFocused(false)}
          title={bearbeiten ? t("rep.editVariant") : t("rep.newVariant")}
          subtitle={side === "white" ? t("common.asWhite") : t("common.asBlack")}
          below={addMoves(true)}
        >
          {addBoard("rep-add-focus")}
        </FocusBoard>
      </div>
      <div className="flex max-w-[420px] flex-col gap-3">
        <Card title={bearbeiten ? t("rep.editVariant") : t("rep.newVariant")}>
          {baseSide == null && (
            <div className="mb-3 flex gap-2">
              {(["white", "black"] as const).map((s) => (
                <Chip key={s} active={side === s} onClick={() => setSide(s)}>
                  {s === "white" ? t("common.asWhite") : t("common.asBlack")}
                </Chip>
              ))}
            </div>
          )}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            placeholder={t("rep.namePlaceholder")}
            className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
          {twins.length > 0 && (
            <div className="mt-3 flex gap-2 rounded-lg border border-gold-dim bg-gold-soft px-3 py-2 text-[12px] leading-relaxed text-gold">
              <Shuffle size={14} className="mt-0.5 shrink-0" />
              <span>{t("rep.transpositionAdd", { n: twins.length })}</span>
            </div>
          )}
          {/* Drei Knöpfe in einer Zeile · auf 360 px reicht das nur, wenn
              „Zug zurück" dort auf sein Zeichen zusammengeht. Ausgeschrieben
              schob die Zeile das Abbrechen-Kreuz über die Kante des Schirms
              hinaus. Was der Pfeil bedeutet, steht ohnehin unter dem Brett. */}
          <div className="mt-3 flex gap-2">
            <Button
              onClick={undo}
              title={t("rep.undoMoveHint")}
              label={t("rep.undoMove")}
              className={`shrink-0 max-sm:px-2.5 ${draft.length === 0 ? "opacity-50" : ""}`}
            >
              <CornerUpLeft size={14} />
              <span className="max-sm:hidden">{t("rep.undoMove")}</span>
            </Button>
            <Button
              primary
              onClick={save}
              className={`min-w-0 max-sm:px-2.5 ${draft.length === 0 ? "opacity-50" : "flex-1"}`}
            >
              <Check size={14} />{" "}
              <span className="truncate">
                {/* Beim Anlegen zählt der Knopf die Züge, die ins Buch gehen ·
                    beim Bearbeiten wäre dieselbe Zahl irreführend: Die meisten
                    davon stehen längst drin. */}
                {bearbeiten
                  ? t("rep.saveEdit")
                  : t(draft.length === 1 ? "rep.saveMoves.one" : "rep.saveMoves.many", {
                      n: draft.length,
                    })}
              </span>
            </Button>
            <Button onClick={() => onDone()} label={t("common.cancel")} className="shrink-0" compact>
              <X size={14} />
            </Button>
          </div>
        </Card>

        <Card title={t("an.book")}>
          {book && book.status === "ok" && book.moves.length > 0 ? (
            <div className="flex flex-col gap-1">
              {book.moves.slice(0, 6).map((m) => (
                <button
                  key={m.uci}
                  onClick={() => playSan(m.san || m.uci)}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-panel2"
                >
                  <span className="w-14 text-left font-medium">{m.san || m.uci}</span>
                  <span className="tabular-nums text-ink2">
                    {m.score != null
                      ? `${m.score >= 0 ? "+" : "−"}${de(Math.abs(m.score) / 100, 2)}`
                      : "—"}
                  </span>
                  <span className="w-16 text-right text-[11.5px] text-ink3">
                    {m.winrate != null ? `${m.winrate} %` : ""}
                  </span>
                </button>
              ))}
              <div className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink3">
                {t("rep.bookClickHint")}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-ink3">{t("an.bookUnknown")}</div>
          )}
        </Card>

        <LiveEngine fen={fen} demoLines={[]} onMove={playUci} />

        <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
          {t("rep.playBothSides", {
            side: side === "white" ? t("common.white") : t("common.black"),
          })}
        </div>
      </div>
    </div>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function flatten(nodes: DemoNode[]): DemoNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}
const allDemoNodes = flatten(demoRepertoire.flatMap((r) => r.nodes));

const STORE_EN_NODE_LABELS: Record<string, string> = {
  w1: "Italian Game",
  w1a: "Giuoco Pianissimo (3…Bc5 4.c3)",
  w1b: "Two Knights Defense (3…Nf6 4.d3)",
  w1c: "Hungarian Defense (3…Be7)",
  w2: "Open Sicilian",
  w2a: "Najdorf (5…a6 6.Be3)",
  b1: "Queen's Gambit Declined",
  b2: "Caro–Kann",
  b2a: "Advance Variation (3.e5 Bf5)",
};

function DemoRepertoire() {
  const { locale, t } = useI18n();
  const compact = useMobileShell();
  const storeCapture = isStoreCapture();
  const englishCapture = storeCapture && locale === "en";
  const [selectedId, setSelectedId] = useState("w1a");
  const [selectedPly, setSelectedPly] = useState(
    () => (allDemoNodes.find((candidate) => candidate.id === "w1a")?.moveSeq.length ?? 1) - 1
  );
  const node = useMemo(() => allDemoNodes.find((n) => n.id === selectedId)!, [selectedId]);
  const demoLines = useMemo<VariationLine[]>(
    () => demoRepertoire.flatMap((group) =>
      flatten(group.nodes).map((variation) => ({
        key: `demo:${variation.id}`,
        side: group.side === "Weiß" ? "white" : "black",
        targetId: variation.id,
        name: englishCapture ? STORE_EN_NODE_LABELS[variation.id] ?? variation.label : variation.label,
        sans: variation.moveSeq,
        due: variation.due,
      }))
    ),
    [englishCapture]
  );
  const selectDemoVariation = useCallback((line: VariationLine, ply: number) => {
    setSelectedId(String(line.targetId));
    setSelectedPly(ply);
  }, []);
  const visibleSans = useMemo(() => node.moveSeq.slice(0, selectedPly + 1), [node, selectedPly]);
  const position = useMemo(() => replaySans(visibleSans), [visibleSans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

  const treePanel = (
    <Panel compact={compact} icon={<ListTree size={14} />} title={t("rep.variants")} pad={false}>
      <VariationList
        lines={demoLines}
        selectedLineKey={`demo:${selectedId}`}
        selectedPly={selectedPly}
        onSelect={selectDemoVariation}
      />
    </Panel>
  );

  const boardPane = (
    <div className="max-w-[var(--board-edge)]">
      <div className="board-bleed">
        <Board boardId="repertoire" fen={fen} width={BOARD_MAX} lastMove={lastMove} />
      </div>
      <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(visibleSans) || t("rep.startPos")}
      </div>
    </div>
  );

  const detailsPane = (
    <div className="flex flex-col gap-4">
      <Card title={englishCapture ? STORE_EN_NODE_LABELS[node.id] ?? node.label : node.label}>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-panel2 px-3 py-2.5">
            <div className="text-[11.5px] text-ink3">{t("rep.trainSuccess")}</div>
            <div
              className="mt-1 text-[20px] font-semibold"
              style={{
                color:
                  node.score >= 85
                    ? "var(--color-win)"
                    : node.score >= 70
                      ? "var(--color-gold)"
                      : "var(--color-loss)",
              }}
            >
              {node.score} %
            </div>
          </div>
          <div className="rounded-lg bg-panel2 px-3 py-2.5">
            <div className="text-[11.5px] text-ink3">{t("rep.dueLabel")}</div>
            <div className="mt-1 text-[20px] font-semibold">
              {node.due}
              <span className="ml-1 text-[12px] font-normal text-ink3">{t("rep.positions")}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
        {t("rep.demoNote")}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("rep.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {storeCapture
              ? locale === "de"
                ? `${repertoireStats.positions} Stellungen · dein persönlicher Eröffnungsplan`
                : `${repertoireStats.positions} positions · your personal opening plan`
              : t("rep.demoSummary", { n: repertoireStats.positions })}
          </p>
        </div>
        <Button primary>
          <GraduationCap size={16} />
          {t("rep.startTraining", { n: repertoireStats.dueToday })}
        </Button>
      </header>

      {compact ? (
        <div className="flex flex-col gap-4">
          {boardPane}
          {detailsPane}
          {treePanel}
        </div>
      ) : (
        <RepertoireGrid tree={treePanel} board={boardPane} details={detailsPane} />
      )}
    </div>
  );
}
