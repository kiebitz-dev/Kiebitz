/**
 * Navigations-Stapel der App-Shell.
 *
 * Bis hierher war die aktuelle Seite ein einzelner useState-Wert · damit hatte
 * die Android-Zurück-Taste nichts zu tun und beendete die App von jeder Seite
 * aus. Die generierte `WryActivity` ruft `webView.goBack()` nur, wenn
 * `canGoBack()` true meldet, also genau dann, wenn echte History-Einträge
 * existieren. Deshalb spiegeln wir die Stapeltiefe in die Session-History:
 * jede Ebene bekommt einen Eintrag mit `{ kd: <Tiefe> }`, und `popstate` kürzt
 * den Stapel auf die Tiefe des Ziel-Eintrags. Das ist idempotent · doppelte
 * oder verschluckte Events können den Stapel nicht aus dem Tritt bringen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GamesFilter } from "./gameUi";
import type { SharePayload } from "./share/codec";
import type { EndgameCategory } from "../data/endgames";
import { capturePage } from "./storeCapture";

export type PageId =
  | "dashboard"
  | "games"
  | "analysis"
  | "play"
  | "repertoire"
  | "endgame"
  | "puzzles"
  | "study"
  | "insights"
  | "settings"
  | "support";

/** Ein Navigationsziel samt seiner Deep-Link-Parameter. */
export interface Route {
  page: PageId;
  /** Analyse: vorselektierte Partie. */
  gameId?: number | null;
  /** Partien: Vorfilter aus dem Dashboard. */
  filter?: GamesFilter | null;
  /** Puzzles: Motiv-Filter aus dem Trainingsplan. */
  theme?: string;
  /** Puzzles: Schwierigkeitsband aus der Verordnung (0 = keine Vorgabe). */
  minRating?: number;
  maxRating?: number;
  /** Endspiele: vorgewählte Drill-Kategorie aus dem Lernplan. */
  endgameCategory?: EndgameCategory;
  /** Rückmeldung: vorgewählte Meldungsart (z. B. Absturz nach Schütteln). */
  reportType?: "feedback" | "crash" | "feature";
  /** Analyse: Stellung aus einem geteilten Link (`kiebitz://p/…`). */
  shared?: SharePayload | null;
  /** Analyse: eine Zugfolge ab einer Stellung · etwa eine Partie gegen die Engine. */
  line?: { fen: string; sans: string[]; chess960: boolean } | null;
  /** Spielen: Stellung, aus der gegen die Engine gespielt wird. */
  play?: { fen: string; chess960: boolean } | null;
}

export type RouteParams = Omit<Route, "page">;

/** Die Wurzel des Stapels · von hier beendet Zurück die App. */
const ROOT: Route = { page: "dashboard" };

const PAGES: readonly PageId[] = [
  "dashboard",
  "games",
  "analysis",
  "play",
  "repertoire",
  "endgame",
  "puzzles",
  "study",
  "insights",
  "settings",
  "support",
];

/**
 * Startstapel. Normalerweise das Dashboard; im Aufnahmemodus für die
 * Store-Bilder darf `?page=` eine andere Seite vorgeben (siehe storeCapture.ts).
 */
function initialStack(): Route[] {
  const wanted = capturePage();
  const page = PAGES.find((id) => id === wanted);
  return page && page !== ROOT.page ? [ROOT, { page }] : [ROOT];
}

export interface NavStack {
  route: Route;
  /** Tiefe des Stapels; 1 heißt "auf der Wurzel". */
  depth: number;
  /** Hauptziel wechseln · der Stapel wird auf [Start, Ziel] gekürzt. */
  navigate: (page: PageId, params?: RouteParams) => void;
  /** Detailebene öffnen · legt ein Ziel auf den aktuellen Stapel. */
  push: (page: PageId, params?: RouteParams) => void;
  /** Eine Ebene zurück; false, wenn schon die Wurzel erreicht ist. */
  back: () => boolean;
}

function depthOf(state: unknown): number {
  const kd = (state as { kd?: unknown } | null)?.kd;
  return typeof kd === "number" && kd >= 1 ? kd : 1;
}

export function useNavStack(): NavStack {
  const [stack, setStack] = useState<Route[]>(initialStack);
  // Der Ref führt den Stapel synchron mit; History-Aufrufe dürfen nicht auf
  // den nächsten Render warten.
  const stackRef = useRef<Route[]>(stack);
  const set = useCallback((next: Route[]) => {
    stackRef.current = next;
    setStack(next);
  }, []);

  useEffect(() => {
    // Die History spiegelt die Stapeltiefe · sie ist beim Start nur dann
    // größer als eins, wenn der Aufnahmemodus eine Seite vorgegeben hat.
    window.history.replaceState({ kd: 1 }, "");
    for (let depth = 2; depth <= stackRef.current.length; depth++) {
      window.history.pushState({ kd: depth }, "");
    }
    const onPop = (e: PopStateEvent) => {
      const kd = depthOf(e.state);
      if (stackRef.current.length > kd) set(stackRef.current.slice(0, kd));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [set]);

  // Stapel setzen und die History auf dieselbe Tiefe bringen. Wächst der
  // Stapel, kommen Einträge dazu; schrumpft er, laufen wir die Differenz
  // zurück · das folgende popstate kürzt dann auf dieselbe Tiefe (no-op).
  const goTo = useCallback(
    (next: Route[]) => {
      const prev = stackRef.current.length;
      set(next);
      if (next.length > prev) {
        for (let d = prev + 1; d <= next.length; d++) window.history.pushState({ kd: d }, "");
      } else if (next.length < prev) {
        window.history.go(next.length - prev);
      }
    },
    [set]
  );

  const navigate = useCallback(
    (page: PageId, params?: RouteParams) =>
      goTo(page === ROOT.page ? [{ ...ROOT, ...params }] : [ROOT, { page, ...params }]),
    [goTo]
  );

  const push = useCallback(
    (page: PageId, params?: RouteParams) => goTo([...stackRef.current, { page, ...params }]),
    [goTo]
  );

  const back = useCallback(() => {
    if (stackRef.current.length <= 1) return false;
    window.history.back();
    return true;
  }, []);

  return { route: stack[stack.length - 1], depth: stack.length, navigate, push, back };
}
