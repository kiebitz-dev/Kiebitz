import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Activity,
  BarChart3,
  Bird,
  BookOpen,
  Crown,
  Database,
  Download,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Menu,
  Puzzle as PuzzleIcon,
  RefreshCw,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useBackendInfo } from "./lib/backend";
import { dbStats } from "./lib/db";
import { onDataChange } from "./lib/changes";
import { getSettings, type Settings } from "./lib/settings";
import { syncInfo } from "./lib/sync";
import { configureAutoSync, useSyncStatus } from "./lib/syncManager";
import { setBoardSoundEnabled, setBoardSoundVolume } from "./lib/sound";
import { installCrashReporter, logEvent } from "./lib/diag";
import { onDeviceShake } from "./lib/shake";
import {
  checkUpdate,
  installUpdate,
  onUpdateAvailable,
  onUpdateState,
  type UpdateAvailable,
  type UpdateState,
} from "./lib/updater";
import { useT, type Key } from "./lib/i18n";
import { useNavStack, type PageId, type RouteParams } from "./lib/nav";
import { forgetPages, keepScroll, rememberScroll, takeScroll } from "./lib/pageMemory";
import { pageHeld } from "./lib/pageReset";
import {
  MobileAppBar,
  MobileNav,
  ShellProvider,
  useLandscapePhone,
} from "./components/MobileShell";
import { SHEET_ROOT_ID } from "./components/MobileSheet";
import { dismissLayers } from "./lib/backDismiss";
import type { EndgameCategory } from "./data/endgames";
import AdBanner from "./components/AdBanner";
import PlanBadge from "./components/PlanBadge";
import PlusDialog from "./components/PlusDialog";
import { installDeepLinks } from "./lib/plus/deepLink";
import { usePlus } from "./lib/plus/usePlus";
import { dateLocale, deInt } from "./lib/format";
import type { GamesFilter } from "./lib/gameUi";
import { isMobilePreview, isStoreCapture } from "./lib/storeCapture";
import { taglineKey } from "./lib/tagline";
import { useDiagramMode } from "./lib/diagramMode";
import { useOpenItems } from "./lib/openItems";
import {
  RegisterAppBar,
  RegisterMarke,
  RegisterNav,
  RegisterSidebar,
  registerZahlen,
} from "./components/blatt/Register";
import { tourSteps } from "./lib/tourSteps";

export type { PageId };

const pageLoaders = {
  dashboard: () => import("./pages/Dashboard"),
  games: () => import("./pages/Games"),
  analysis: () => import("./pages/Analysis"),
  repertoire: () => import("./pages/Repertoire"),
  endgame: () => import("./pages/Endgame"),
  puzzles: () => import("./pages/Puzzles"),
  study: () => import("./pages/Study"),
  insights: () => import("./pages/InsightsV2"),
  settings: () => import("./pages/Settings"),
  support: () => import("./pages/Support"),
} satisfies Record<PageId, () => Promise<{ default: ComponentType<any> }>>;

const Dashboard = lazy(pageLoaders.dashboard);
const Games = lazy(pageLoaders.games);
const Analysis = lazy(pageLoaders.analysis);
const Repertoire = lazy(pageLoaders.repertoire);
const Endgame = lazy(pageLoaders.endgame);
const Puzzles = lazy(pageLoaders.puzzles);
const Study = lazy(pageLoaders.study);
const Insights = lazy(pageLoaders.insights);
const SettingsPage = lazy(pageLoaders.settings);
const Support = lazy(pageLoaders.support);
const Onboarding = lazy(() => import("./components/Onboarding"));
const GuidedTour = lazy(() => import("./components/GuidedTour"));

const LIKELY_NEXT_PAGES: Record<PageId, PageId[]> = {
  dashboard: ["games", "study"],
  games: ["analysis", "dashboard"],
  analysis: ["games", "insights"],
  repertoire: ["study", "games"],
  endgame: ["study", "puzzles"],
  puzzles: ["study", "analysis"],
  study: ["puzzles", "endgame"],
  insights: ["study", "analysis"],
  settings: ["support", "dashboard"],
  support: ["settings", "dashboard"],
};

function preloadLikelyPages(page: PageId): () => void {
  // Unit tests exercise lazy navigation itself; speculative imports would keep
  // resolving after assertions and create unrelated React act warnings.
  if (import.meta.env.MODE === "test") return () => {};
  const preload = () => LIKELY_NEXT_PAGES[page].forEach((target) => void pageLoaders[target]());
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(preload, { timeout: 2_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(preload, 500);
  return () => globalThis.clearTimeout(id);
}

const nav: { id: PageId; labelKey: Key; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "games", labelKey: "nav.games", icon: Database },
  { id: "analysis", labelKey: "nav.analysis", icon: Activity },
  { id: "repertoire", labelKey: "nav.repertoire", icon: BookOpen },
  { id: "puzzles", labelKey: "nav.puzzles", icon: PuzzleIcon },
  { id: "endgame", labelKey: "nav.endgame", icon: Crown },
  { id: "study", labelKey: "nav.study", icon: GraduationCap },
  { id: "insights", labelKey: "nav.insights", icon: BarChart3 },
];

// Die fünf Hauptziele der mobilen Bottom-Navigation · Material 3 lässt für eine
// Leiste 3 bis 5 Einträge zu. Der Rest bleibt vorerst im Drawer, bis der
// Training-Hub Repertoire, Endspiele und Puzzles aufnimmt.
const BOTTOM_NAV: PageId[] = ["dashboard", "games", "analysis", "study", "insights"];
const bottomNav = BOTTOM_NAV.map((id) => nav.find((n) => n.id === id)!);

// Ziele, die später unter "Training" einziehen. Sie markieren schon jetzt den
// passenden Tab, damit die Leiste nie ganz ohne Auswahl dasteht.
const NAV_PARENT: Partial<Record<PageId, PageId>> = {
  repertoire: "study",
  endgame: "study",
  puzzles: "study",
};

// Wartezeiten zwischen den Anläufen, ein Update aus dem Hinweis zu
// installieren · zwei Pausen, also drei Versuche. Kurz genug, dass jemand
// davor sitzen bleibt, lang genug für eine Leitung, die gerade hakt.
const UPDATE_RETRY_DELAYS = [2000, 8000] as const;

export default function App() {
  // Der Stapel hält die Seite samt Deep-Link-Parametern und hängt an der
  // Session-History · siehe lib/nav.ts. Erst dadurch tut die Android-Zurück-
  // Taste etwas anderes, als die App zu beenden.
  const { route, depth, navigate: switchTo, push: pushLevel, back } = useNavStack();
  const page = route.page;
  // Der Scroll-Container der Shell · dieselbe Fläche für alle Seiten.
  const mainRef = useRef<HTMLElement>(null);
  const depthRef = useRef(depth);
  depthRef.current = depth;

  // Absprung in eine Detailebene: vorher merken, wo der Nutzer stand · der
  // Zurück-Pfeil bringt ihn dann wieder genau dorthin (siehe lib/pageMemory).
  const push = useCallback(
    (target: PageId, params?: RouteParams) => {
      rememberScroll(depthRef.current, mainRef.current?.scrollTop ?? 0);
      pushLevel(target, params);
    },
    [pushLevel]
  );

  // Der Tabwechsel bleibt ein Tabwechsel · er vergisst das Gemerkte, damit
  // jedes Hauptziel wie bisher am Kopf der Seite beginnt.
  const goTo = useCallback(
    (target: PageId, params?: RouteParams) => {
      forgetPages();
      switchTo(target, params);
    },
    [switchTo]
  );
  const backend = useBackendInfo();
  const t = useT();
  const storeCapture = isStoreCapture();
  const [gameCount, setGameCount] = useState<number | null>(null);
  const plus = usePlus();
  // Werbefreiheit ist eine Plus-Funktion · solange der Zustand noch geladen
  // wird, bleibt die Anzeige, wie sie war. Ein kurzes Auf- und Zuklappen des
  // Banners wäre auffälliger als eine halbe Sekunde später zu verschwinden.
  const showAds = !plus.has("no_ads");

  useEffect(() => preloadLikelyPages(page), [page]);

  // Partie öffnen ist eine Detailebene: Zurück führt in die Partienliste
  // zurück, nicht aus der App heraus.
  const openAnalysis = (gameId: number) => push("analysis", { gameId });

  // Deep-Link vom Dashboard: Games mit einem Vorfilter öffnen (Datum, Quelle,
  // Modus, Gegner, Eröffnung oder Ergebnis).
  const openGames = (filter?: GamesFilter) => goTo("games", { filter: filter ?? null });

  // Deep-Link aus dem Trainingsplan: Puzzles mit Motiv *und* Schwierigkeitsband
  // öffnen · ebenfalls eine Detailebene, damit Zurück wieder im Training landet.
  // Ohne das Band bliebe von „15 Aufgaben zwischen 1420 und 1580" nur ein
  // Ratschlag übrig, den der Nutzer von Hand nachstellen müsste.
  const openPuzzles = (theme?: string, band?: { minRating?: number; maxRating?: number }) =>
    push("puzzles", {
      theme: theme ?? "",
      minRating: band?.minRating ?? 0,
      maxRating: band?.maxRating ?? 0,
    });

  // Dasselbe fürs Endspiel: der Lernplan kennt den schwachen Typ, also soll er
  // ihn auch vorwählen können.
  const openEndgame = (category?: EndgameCategory) =>
    push("endgame", { endgameCategory: category });

  // Aus einem Befund ins Repertoire ist ebenfalls eine Detailebene · aus dem
  // Training ergibt sich das schon aus NAV_PARENT, aus den Insights nicht.
  const openRepertoire = () => push("repertoire");

  // Rückmeldung ist immer eine Detailebene · Zurück führt dorthin zurück, wo
  // der Nutzer gerade war, egal ob er über die Einstellungen kam oder geschüttelt hat.
  const openSupport = (reportType: "feedback" | "crash" | "feature" = "feedback") =>
    push("support", { reportType });

  useEffect(() => {
    if (backend.mode !== "desktop") return;
    const refresh = () => {
      dbStats().then((s) => setGameCount(s.total)).catch(() => {});
    };
    refresh();
    return onDataChange(refresh, ["games", "database"]);
  }, [backend.mode]);

  // Brettklänge nach den gespeicherten Einstellungen scharfschalten. Ohne
  // Backend (Web-Preview) bleiben die Voreinstellungen aus lib/sound stehen.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    getSettings()
      .then((s) => {
        setBoardSoundEnabled(s.sound_enabled);
        setBoardSoundVolume(s.sound_volume / 100);
      })
      .catch(() => {});
  }, [backend.mode]);

  // Unbehandelte Fehler der Oberfläche landen im lokalen Logbuch · sie sind
  // die Datenbasis für einen Absturzbericht, den niemand abtippen muss.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    return installCrashReporter();
  }, [backend.mode]);

  // Ersteinrichtung: nur beim allerersten Start, danach nie wieder.
  const [onboarding, setOnboarding] = useState<Settings | null>(null);
  // Der geführte Rundgang · einmal direkt nach der Ersteinrichtung, danach nur
  // noch auf Zuruf aus den Einstellungen. Er hält nichts fest: Wer ihn noch
  // einmal will, bekommt ihn noch einmal, ohne dass irgendwo ein
  // "schon gesehen"-Merker stehen müsste.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    getSettings()
      .then((s) => setOnboarding(s.onboarded ? null : s))
      .catch(() => {});
  }, [backend.mode]);

  // Auto-Sync (Mobile-Client) nach den Einstellungen scharfschalten. Läuft nur,
  // wenn wir mobil sind, es aktiviert ist und ein Hub konfiguriert wurde.
  const isMobile =
    backend.info?.platform === "android" ||
    backend.info?.platform === "ios" ||
    isMobilePreview();
  // Querformat auf Telefonhöhe: die Navigation tritt an die linke Kante.
  const rail = useLandscapePhone();

  // Beide Shells behalten denselben Scroll-Container über alle Seiten hinweg.
  // Ohne Reset übernimmt der nächste Tab die Position des vorherigen und
  // beginnt dadurch irgendwo mitten im Inhalt · auf dem Desktop war das
  // besonders auffällig, weil die Seiten dort länger sind.
  //
  // Nach dem Zurück aus einer Detailebene steht dort stattdessen die gemerkte
  // Position: Wer aus dem Coach abgesprungen ist, kommt genau bei seinem
  // Befund wieder heraus, statt am Kopf der Seite.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollLeft = 0;
    return keepScroll(main, takeScroll(depth) ?? 0);
  }, [page, depth]);

  // Kräftiges Schütteln öffnet auf dem Handy die Rückmeldung · vorgewählt als
  // Absturzbericht, weil man das Gerät selten aus Begeisterung schüttelt.
  // Der Ref hält die aktuelle Seite, damit die Geste nicht bei jedem
  // Seitenwechsel neu angemeldet werden muss.
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!isMobile) return;
    return onDeviceShake(() => {
      if (pageRef.current === "support") return;
      logEvent("info", "ui", "Feedback über Schüttelgeste geöffnet");
      push("support", { reportType: "crash" });
    });
  }, [isMobile, push]);

  // Markiert die mobile Shell fürs Stylesheet · dort unterdrückt die Regel für
  // .page-title die von der App-Bar bereits gezeigten Überschriften.
  useEffect(() => {
    if (!isMobile) return;
    document.documentElement.dataset.shell = "mobile";
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, [isMobile]);
  useEffect(() => {
    if (!storeCapture) return;
    document.documentElement.dataset.storeCapture = "true";
    return () => {
      delete document.documentElement.dataset.storeCapture;
    };
  }, [storeCapture]);
  const syncStatus = useSyncStatus();
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    Promise.all([getSettings(), syncInfo().catch(() => null)])
      .then(([s, info]) =>
        configureAutoSync({
          isMobile,
          syncAuto: s.sync_auto,
          syncHost: s.sync_host,
          lastSync: info?.last_sync,
        })
      )
      .catch(() => {});
  }, [backend.mode, isMobile]);

  // Trainings-Erinnerungen: der Prüf-Timer liest die Einstellungen bei jedem
  // Durchlauf selbst, Änderungen greifen also ohne Neustart.
  //
  // Beide Hintergrundläufe kommen nachgeladen. Sie melden sich frühestens
  // Minuten nach dem Start, ziehen aber Lernplan, Wochenbericht und
  // Benachrichtigungen hinter sich her · zusammen rund ein Fünftel des
  // Startbündels für Code, den das erste Bild nicht braucht.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    let disposed = false;
    let stopImport = () => {};
    let stopReminders = () => {};
    import("./lib/notify")
      .then((module) => {
        if (disposed) return;
        module.startReminders();
        stopReminders = module.stopReminders;
      })
      .catch(() => {});
    import("./lib/autoImport")
      .then(({ startAutoImport, stopAutoImport }) => {
        if (disposed) return;
        startAutoImport();
        stopImport = stopAutoImport;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stopReminders();
      stopImport();
    };
  }, [backend.mode]);

  // Deep Links: `kiebitz://auth?code=…` aus dem Magic-Link der E-Mail und
  // `kiebitz://open?page=…` von den Android-Widgets. Die Einlösung der
  // Anmeldung passiert im Hintergrund; sichtbar wird sie dort, wo der
  // Kontostatus steht.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    return installDeepLinks({
      onSignedIn: () => logEvent("info", "plus", "Anmeldung über Deep-Link abgeschlossen"),
      onError: () => logEvent("warn", "plus", "Anmeldelink konnte nicht eingelöst werden"),
      onOpenPage: (page) => goTo(page),
      // Eine geteilte Stellung landet am freien Brett der Analyse · dort kann
      // man sie sofort weiterspielen und rechnen lassen.
      onSharedPosition: (shared) => push("analysis", { shared }),
    });
  }, [backend.mode, goTo, push]);

  // Datenstand der Android-Widgets · nur dort gibt es welche, und auch dort
  // erst, nachdem die App steht.
  useEffect(() => {
    if (backend.mode !== "desktop" || backend.info?.platform !== "android") return;
    let disposed = false;
    let stop = () => {};
    import("./lib/widgets")
      .then(({ startWidgetSnapshots }) => {
        if (disposed) return;
        stop = startWidgetSnapshots();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop();
    };
  }, [backend.mode, backend.info?.platform]);

  // Lebenszeichen der Nutzungsstatistik · höchstens eines pro Tag, und nur
  // solange sie nicht abgeschaltet ist. Es wartet auf `plus.loading`: Vorher
  // ist der Plus-Stand noch nicht aus der sicheren Ablage gelesen, und die
  // Stufe stünde als "free" in der Statistik, obwohl Plus aktiv ist. Der
  // Tagesriegel im Modul verhindert, dass ein späterer Wechsel ein zweites
  // Lebenszeichen auslöst.
  const info = backend.info;
  useEffect(() => {
    if (backend.mode !== "desktop" || !info || plus.loading) return;
    void import("./lib/analytics")
      .then(({ reportDailyHeartbeat }) =>
        reportDailyHeartbeat({
          platform: info.platform ?? "",
          distribution: info.distribution ?? "",
          version: info.version,
          plus: plus.isPlus,
        })
      )
      .catch(() => {});
  }, [backend.mode, info, plus.loading, plus.isPlus]);

  // Toast für den Auto-Update-Lauf beim Start (der Neustart soll nicht
  // kommentarlos passieren); Fehler zeigt die Settings-Seite.
  const [update, setUpdate] = useState<UpdateState | null>(null);
  // Bei deaktiviertem Auto-Update meldet das Backend nur, dass eine Version
  // bereitsteht · wir zeigen dann unten rechts einen Hinweis mit Aktion.
  const [available, setAvailable] = useState<UpdateAvailable | null>(null);
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const track = (u: () => void) => (disposed ? u() : cleanups.push(u));
    onUpdateState((s) => setUpdate(s.phase === "error" ? null : s)).then(track);
    onUpdateAvailable(setAvailable).then(track);
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [backend.mode]);

  // Android aus dem Play Store: Dort gibt es keinen Start-Check im Backend,
  // weil Play-Apps nichts selbst herunterladen dürfen. Gefragt wird deshalb
  // hier, einmal je App-Start, und der Hinweis führt in Plays eigenen Ablauf.
  const playStore = info?.platform === "android" && info?.distribution === "play-store";
  useEffect(() => {
    if (backend.mode !== "desktop" || !playStore) return;
    let cancelled = false;
    checkUpdate()
      .then((check) => {
        if (cancelled || !check.available) return;
        setAvailable({ version: check.available, notes: check.notes });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backend.mode, playStore]);

  // Der Nutzer startet das Update aus der Benachrichtigung; ab da übernimmt
  // der Fortschritts-Toast (update://state) · im Play-Build führt derselbe
  // Knopf direkt in Plays Update-Ablauf.
  //
  // Ein Fehlschlag darf den Hinweis nicht verschlucken: Vorher verschwand der
  // Toast beim Klick und niemand erfuhr, dass gar nichts installiert wurde.
  // Jetzt bleibt er stehen, versucht es im Hintergrund noch zweimal · ein
  // abgebrochener Download oder eine kurz nicht erreichbare Release-Seite ist
  // der wahrscheinlichste Grund · und zeigt danach den Fehler mit einem Knopf
  // zum Wiederholen, wie ihn auch die Settings-Seite stehen lässt.
  const [updBusy, setUpdBusy] = useState(false);
  const [updError, setUpdError] = useState<string | null>(null);
  // Zählt Anläufe: Wer den Hinweis wegklickt oder die App verlässt, erhöht
  // den Zähler und ein noch laufender Anlauf schreibt nichts mehr.
  const updRun = useRef(0);
  useEffect(() => () => void updRun.current++, []);

  const startUpdate = useCallback(() => {
    setUpdBusy((busy) => {
      if (busy) return busy;
      const run = ++updRun.current;
      setUpdError(null);
      void (async () => {
        let last = "";
        for (let attempt = 0; attempt <= UPDATE_RETRY_DELAYS.length; attempt++) {
          try {
            await installUpdate();
            // Der Desktop kehrt hier gewöhnlich nicht zurück (Neustart);
            // Android hat Play bzw. den APK-Download geöffnet · beides fertig.
            if (updRun.current !== run) return;
            setUpdBusy(false);
            setAvailable(null);
            return;
          } catch (e) {
            last = String(e);
          }
          if (updRun.current !== run) return;
          const wait = UPDATE_RETRY_DELAYS[attempt];
          if (wait == null) break;
          await new Promise((done) => setTimeout(done, wait));
          if (updRun.current !== run) return;
        }
        setUpdBusy(false);
        setUpdError(last || "?");
      })();
      return true;
    });
  }, []);

  /** „Später", das X und der Wechsel weg vom Hinweis brechen auch die Anläufe ab. */
  const dismissUpdate = useCallback(() => {
    updRun.current++;
    setUpdBusy(false);
    setUpdError(null);
    setAvailable(null);
  }, []);

  // Mobile: Sidebar wird zum Slide-in-Drawer hinter einem Hamburger-Button.
  const [navOpen, setNavOpen] = useState(false);
  /**
   * Zurück an den Kopf der offenen Seite.
   *
   * Der Griff, den jede Reiterleiste hat: Wer weit unten steht und denselben
   * Reiter noch einmal antippt, meint damit nicht „dorthin, wo ich schon bin",
   * sondern „nach oben". Ohne das bleibt einem auf dem Telefon nur, eine lange
   * Seite von Hand zurückzuwischen.
   */
  const scrollToTop = useCallback(() => {
    const main = mainRef.current;
    if (!main || main.scrollTop === 0) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    main.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /**
   * Die laufende Nummer der offenen Seite · sie steht im Schlüssel des
   * Seiteninhalts und ist die einzige Stelle, an der er sich ändert, ohne dass
   * die Seite gewechselt hätte. Ein anderer Schlüssel heißt für React: neu
   * einhängen, also von vorn.
   */
  const [pageRun, setPageRun] = useState(0);

  /**
   * Zurück auf Anfang · dieselbe Seite, aber wie beim ersten Mal.
   *
   * Wer den Reiter antippt, auf dem er ohnehin steht, meint nicht „dorthin, wo
   * ich schon bin", sondern „von vorn": Die besondere Analyse einer Partie
   * wird wieder das freie Brett, der gefilterte Bestand wieder der ganze, das
   * halb ausgefüllte Formular wieder leer.
   *
   * Beides gehört dazu, und beides fehlte einzeln:
   *
   * · `goTo` nimmt der Seite ihre Deep-Link-Parameter (die vorgewählte Partie,
   *   den Vorfilter aus dem Dashboard) und kürzt den Stapel auf das Hauptziel.
   *   Ohne das schlüge dieselbe Partie beim Neueinhängen sofort wieder auf.
   * · Der neue Schlüssel nimmt ihr den Zustand, den sie selbst führt. Ohne das
   *   bliebe bei gleichen Parametern alles stehen, weil React dieselbe Instanz
   *   weiterlaufen ließe.
   *
   * An den Kopf geht es zuletzt: Eine neu eingehängte Seite ist zwar kurz,
   * aber der Scroll-Container gehört der Hülle und behielte seinen Stand.
   */
  const resetPage = useCallback(
    (id: PageId) => {
      goTo(id);
      setPageRun((run) => run + 1);
      scrollToTop();
    },
    [goTo, scrollToTop]
  );

  // Ein Ziel, dessen Elternseite gerade offen ist, wird als Detailebene
  // geöffnet · Zurück führt dann dorthin zurück statt auf den Start.
  //
  // Liegt ein Detailblatt über der Seite (mobil das Blatt einer Partie), dann
  // ist es das, was zwischen ihm und der Seite steht · derselbe Tipp schließt
  // es, statt darunter aufzuräumen. Erst der nächste stellt die Seite zurück.
  //
  // Und hält die Seite ungesicherte Arbeit — die Einstellungen tun das bis zum
  // Speichern —, bleibt es beim Griff nach oben: Zurücksetzen hieße dort
  // wegwerfen, und das sieht dem Griff nach oben zu ähnlich (siehe
  // lib/pageReset.ts).
  const navigate = useCallback(
    (id: PageId) => {
      if (id === pageRef.current) {
        if (dismissLayers()) {
          // Die Schicht darüber ist weg · die Seite darunter bleibt, wie sie war.
        } else if (pageHeld()) scrollToTop();
        else resetPage(id);
      } else if (NAV_PARENT[id] === pageRef.current) push(id);
      else goTo(id);
      setNavOpen(false);
    },
    [goTo, push, resetPage, scrollToTop]
  );

  // Auf dem Desktop führt der Rundgang an der Seitenleiste entlang, mobil an
  // der Leiste unten · dieselben Texte, andere Stellen.
  const steps = useMemo(() => tourSteps(isMobile), [isMobile]);

  const activeTab = NAV_PARENT[page] ?? page;

  // Auf der App-Bar steht der Seitenname; der Start zeigt stattdessen die
  // Wortmarke, weil "Dashboard" schon in der Leiste darunter steht.
  const pageLabel = [
    ...nav,
    { id: "settings" as PageId, labelKey: "nav.settings" as Key },
    { id: "support" as PageId, labelKey: "nav.support" as Key },
  ].find((n) => n.id === page);
  const barTitle = page === "dashboard" ? null : pageLabel ? t(pageLabel.labelKey) : null;

  // Der Zurück-Pfeil erscheint nur auf Ebenen, die kein Hauptziel sind ·
  // zwischen den Tabs navigiert die Leiste, nicht der Pfeil.
  const showBack = depth > 2 || !BOTTOM_NAV.includes(page);

  // Inhalt der Desktop-Sidebar · auch für den Drawer im schmalen Fenster.
  // ── Die Hülle des Diagramm-Modus ─────────────────────────────────────────
  //
  // Sie wechselt mit dem Modus, und sie wechselt vollständig: Register statt
  // Leiste, auf jedem Tab. Das ist Hülle und nicht Seiteninhalt — stiege sie
  // von Tab zu Tab um, wäre sie keine Hülle mehr.
  //
  // Was die Zahlen daneben bedeuten — Bestand oder offener Posten, und wann
  // gar keine dasteht — ist die Sache des Registers und steht in
  // `registerZahlen` (Register.tsx).
  const diagramMode = useDiagramMode();
  const openItems = useOpenItems();

  const zahlen = registerZahlen({ gameCount, openItems });

  const registerFoot = (
    <>
      {backend.mode === "desktop"
        ? gameCount != null
          ? t("app.dbCount", { n: deInt(gameCount) })
          : t("app.dbReady")
        : t("app.demoSync")}
      <br />
      {backend.mode === "desktop"
        ? t("app.desktopBackend", { v: backend.info?.version ?? "?" })
        : backend.mode === "web"
          ? t("app.webMode")
          : t("app.connecting")}
    </>
  );

  const sidebarContent = diagramMode ? (
    <RegisterSidebar
      items={nav}
      page={page}
      zahlen={zahlen}
      onSelect={navigate}
      foot={registerFoot}
    />
  ) : (
    <>
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Bird size={20} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">Kiebitz</span>
            <PlanBadge />
          </div>
          <div className="text-[11px] text-ink3">{t(taglineKey())}</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {nav.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            data-tour={`nav-${id}`}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
              page === id
                ? "bg-panel3 font-medium text-ink"
                : "text-ink2 hover:bg-panel2 hover:text-ink"
            }`}
          >
            <Icon size={17} className={page === id ? "text-accent" : "text-ink3"} />
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div className="mt-auto px-3 pb-5">
        {!storeCapture && (
        <div className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[12px] text-ink2">
            {syncStatus.active ? (
              <>
                <RefreshCw
                  size={13}
                  className={
                    syncStatus.phase === "syncing"
                      ? "animate-spin text-accent"
                      : syncStatus.phase === "error"
                        ? "text-ink3"
                        : "text-accent"
                  }
                />
                {syncStatus.phase === "syncing"
                  ? t("app.syncing")
                  : syncStatus.phase === "error"
                    ? t("app.syncOffline")
                    : syncStatus.lastSync > 0
                      ? t("app.syncedAt", {
                          t: new Date(syncStatus.lastSync * 1000).toLocaleTimeString(dateLocale()),
                        })
                      : t("app.synced")}
              </>
            ) : (
              <>
                <RefreshCw size={13} className="text-accent" />
                {backend.mode === "desktop" ? t("app.localDb") : t("app.synced")}
              </>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-ink3">
            {backend.mode === "desktop"
              ? gameCount != null
                ? t("app.dbCount", { n: deInt(gameCount) })
                : t("app.dbReady")
              : t("app.demoSync")}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5 text-[11px] text-ink3">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  backend.mode === "desktop" ? "var(--color-win)" : backend.mode === "web" ? "var(--color-gold)" : "var(--color-draw)",
              }}
            />
            {backend.mode === "desktop"
              ? t("app.desktopBackend", { v: backend.info?.version ?? "?" })
              : backend.mode === "web"
                ? t("app.webMode")
                : t("app.connecting")}
          </div>
        </div>
        )}
        <button
          onClick={() => navigate("settings")}
          data-tour="nav-settings"
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
            page === "settings"
              ? "bg-panel3 font-medium text-ink"
              : "text-ink2 hover:bg-panel2 hover:text-ink"
          }`}
        >
          <SettingsIcon size={17} className={page === "settings" ? "text-accent" : "text-ink3"} />
          {t("nav.settings")}
        </button>
      </div>
    </>
  );

  /** Die Reiterleiste des Telefons · im Modus das Register, sonst wie heute. */
  const bottomBar = (rail: boolean) =>
    diagramMode ? (
      <RegisterNav items={bottomNav} activeId={activeTab} onSelect={navigate} rail={rail} />
    ) : (
      <MobileNav items={bottomNav} activeId={activeTab} onSelect={navigate} rail={rail} />
    );

  const mainContent = (
    <Suspense fallback={
      <div className="flex min-h-[40vh] items-center justify-center text-ink3" aria-busy="true">
        <Loader2 size={22} className="animate-spin text-accent" />
      </div>
    }>
      {/* Der Schlüssel wechselt bei jedem Seitenwechsel — dort hängt React
          ohnehin um — und zusätzlich, wenn jemand den offenen Reiter antippt.
          Das ist die eine Stelle, an der eine Seite von vorn beginnt, ohne dass
          eine andere dazwischen gestanden hätte · siehe `resetPage`. */}
      <Fragment key={`${page}:${pageRun}`}>
      {page === "dashboard" && (
        <Dashboard go={navigate} openAnalysis={openAnalysis} openGames={openGames} />
      )}
      {page === "games" && (
        <Games openAnalysis={openAnalysis} initialFilter={route.filter ?? null} />
      )}
      {page === "analysis" && (
        <Analysis targetGameId={route.gameId ?? null} shared={route.shared ?? null} />
      )}
      {page === "repertoire" && <Repertoire />}
      {page === "endgame" && <Endgame initialCategory={route.endgameCategory} />}
      {page === "puzzles" && (
        <Puzzles
          initialTheme={route.theme ?? ""}
          initialMinRating={route.minRating ?? 0}
          initialMaxRating={route.maxRating ?? 0}
        />
      )}
      {page === "study" && (
        <Study go={navigate} openPuzzles={openPuzzles} openEndgame={openEndgame} />
      )}
      {page === "insights" && (
        <Insights
          go={navigate}
          openPuzzles={openPuzzles}
          openAnalysis={openAnalysis}
          openRepertoire={openRepertoire}
          openEndgame={openEndgame}
        />
      )}
      {page === "settings" && (
        <SettingsPage openSupport={openSupport} startTour={() => setTourOpen(true)} />
      )}
      {page === "support" && <Support initialType={route.reportType ?? "feedback"} />}
      </Fragment>
    </Suspense>
  );

  /**
   * Der Update-Hinweis · auf dem Desktop eine Karte unten rechts, auf dem
   * Handy eine Leiste über der Navigation.
   *
   * Fest an den unteren Rand geklebt liegt der Hinweis mobil auf der
   * Navigation und, je nach Gerät, halb unter der Systemleiste · dann verdeckt
   * er die Leiste und sein eigener Knopf ist kaum zu treffen. In der Spalte der
   * Shell steht er stattdessen zwischen Inhalt und Leisten: Er nimmt die volle
   * Breite, deckt nichts zu und schiebt die Navigation nicht weg.
   */
  const noticeShell = isMobile
    ? "shrink-0 border-t border-line bg-panel2 px-4 py-3"
    : "fixed bottom-4 right-4 z-50 rounded-lg border border-line bg-panel2 px-4 py-3 shadow-xl";

  const updateNotice = update ? (
    <div className={`flex items-center gap-2.5 text-[12.5px] text-ink2 ${noticeShell}`}>
      <Loader2 size={15} className="animate-spin text-accent" />
      {update.phase === "installing"
        ? t("app.updateInstalling", { v: update.version })
        : t("app.updateDownloading", { v: update.version })}
    </div>
  ) : (
    available && (
      <div className={`flex flex-col gap-2.5 ${isMobile ? "" : "w-[288px]"} ${noticeShell}`}>
        <div className="flex items-start gap-2.5">
          {updBusy ? (
            <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-accent" />
          ) : (
            <RefreshCw
              size={15}
              className={`mt-0.5 shrink-0 ${updError ? "text-loss" : "text-accent"}`}
            />
          )}
          <div className={`min-w-0 flex-1 text-[12.5px] ${updError ? "text-loss" : "text-ink2"}`}>
            {updError
              ? t("app.updateFailed", { e: updError })
              : updBusy
                ? t("app.updateStarting")
                : playStore
                  ? t("app.updatePlayAvailable")
                  : t("app.updateAvailable", { v: available.version })}
          </div>
          <button
            onClick={dismissUpdate}
            aria-label={t("app.updateLater")}
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-ink3 transition-colors hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
        {!updBusy && (
          <div className="flex justify-end gap-2">
            <button
              onClick={dismissUpdate}
              className="rounded-md px-2.5 py-1 text-[12px] text-ink3 transition-colors hover:text-ink"
            >
              {t("app.updateLater")}
            </button>
            <button
              onClick={startUpdate}
              className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              {updError ? <RefreshCw size={13} /> : <Download size={13} />}{" "}
              {updError ? t("app.updateRetry") : t("app.updateNow")}
            </button>
          </div>
        )}
      </div>
    )
  );

  const overlays = (
    <>
      <PlusDialog openSettings={() => navigate("settings")} />
      {tourOpen && (
        <Suspense fallback={null}>
          <GuidedTour steps={steps} onNavigate={navigate} onDone={() => setTourOpen(false)} />
        </Suspense>
      )}
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding
            settings={onboarding}
            onDone={(applied) => {
              setOnboarding(null);
              // Direkt im Anschluss der Rundgang: Jetzt steht die App hinter
              // dem Fenster, und es gibt etwas zu zeigen.
              setTourOpen(true);
              // Neue Konten sofort nutzen (Sprache steckt schon im Provider).
              void applied;
            }}
          />
        </Suspense>
      )}
    </>
  );

  // ── Mobile Shell ───────────────────────────────────────────────────────────
  // App-Bar oben (Titel, Zurück, Einstellungen), Navigation unten bzw. im
  // Querformat als Rail links. Kein Drawer mehr · alle Ziele hängen entweder
  // in der Leiste oder unter dem Training.
  if (isMobile) {
    return (
      <ShellProvider mobile>
      <div className={`flex h-full ${rail ? "flex-row" : "flex-col"}`}>
        {rail && bottomBar(true)}
        {/* min-h-0: sonst wächst die Spalte mit dem Inhalt, statt <main>
            scrollen zu lassen · Flex-Kinder schrumpfen ohne das nicht. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Auch die App-Bar wechselt mit dem Modus · sie ist Hülle, und die
              Hülle wechselt vollständig: Register unten, Kolumnentitel oben. */}
          {diagramMode ? (
            <RegisterAppBar
              title={barTitle}
              showBack={showBack}
              onBack={back}
              onSettings={() => navigate("settings")}
              settingsActive={page === "settings"}
            />
          ) : (
            <MobileAppBar
              title={barTitle}
              showBack={showBack}
              onBack={back}
              onSettings={() => navigate("settings")}
              settingsActive={page === "settings"}
            />
          )}
          {/* Der Wrapper spannt genau die Fläche von <main> auf · darin legt
              sich das Detailblatt (MobileSheet) über den Inhalt, während
              App-Bar und Navigation scharf und bedienbar bleiben. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Waagerecht wird nie geblättert · siehe die Desktop-Fassung
                unten. */}
            <main ref={mainRef} className="safe-x min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {mainContent}
            </main>
            <div
              id={SHEET_ROOT_ID}
              className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto"
            />
          </div>
          {updateNotice}
          {showAds && <AdBanner android={backend.info?.platform === "android"} />}
        </div>
        {!rail && bottomBar(false)}
        {overlays}
      </div>
      </ShellProvider>
    );
  }

  // ── Desktop-Shell ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-[228px] shrink-0 flex-col border-r border-line bg-panel md:flex">
        {sidebarContent}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Topbar im schmalen Fenster (unter md) */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 pb-2 md:hidden"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        {/* Dieselbe Marke, derselbe Platz · im Modus nur anders gesetzt. */}
        <div className="flex items-center gap-2.5">
          {diagramMode ? (
            <RegisterMarke gross={32} />
          ) : (
            <>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Bird size={17} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Kiebitz</span>
            </>
          )}
          <PlanBadge />
        </div>
        <button
          onClick={() => setNavOpen(true)}
          aria-label={t("app.menu")}
          className="rounded-lg p-2 text-ink2 transition-colors hover:bg-panel2 hover:text-ink"
        >
          <Menu size={20} />
        </button>
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-[248px] flex-col overflow-y-auto border-r border-line bg-panel shadow-2xl"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Gescrollt wird hier nur senkrecht.

          `overflow-y-auto` allein macht aus der waagerechten Achse still
          ebenfalls `auto`: Alles, was auch nur ein paar Pixel breiter ist als
          der Inhaltsbereich, brachte deshalb eine waagerechte Bildlaufleiste
          mit — der Zitterschlag eines Bretts nach einem Fehlversuch
          (`animate-shake`, ±5 px) ließ sie eine halbe Sekunde lang in jedem
          Bild erscheinen und wieder verschwinden. Waagerecht blättern soll man
          hier ohnehin nie; breite Inhalte (Zugleiste, Tabellen) bringen ihren
          eigenen Bildlauf mit.

          Geschnitten wurde auch bisher schon · `auto` schneidet genauso, es
          hing nur eine Leiste daran. */}
      <main
        ref={mainRef}
        className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {mainContent}
      </main>

      {showAds && <AdBanner android={false} />}
      </div>

      {updateNotice}
      {overlays}
    </div>
  );
}
