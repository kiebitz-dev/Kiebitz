import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendState } from "../lib/backend";
import { dbInfo, type Settings } from "../lib/settings";
import { puzzleStats } from "../lib/puzzles";
import { syncInfo } from "../lib/sync";
import { legalDocuments } from "../lib/legal";
import { checkUpdate, installUpdate } from "../lib/updater";
import { ShellProvider } from "../components/MobileShell";
import { DEFAULT_APPEARANCE, setAppearance } from "../lib/theme";
import { grantPlus, revokePlus } from "../test/plus";
import SettingsPage from "./Settings";

const mocks = vi.hoisted(() => ({
  backend: { mode: "pending" } as BackendState,
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  refdbStatus: vi.fn(),
  refdbPrecheck: vi.fn(),
  refdbImport: vi.fn(),
  refdbDeleteSource: vi.fn(),
  lichessToken: vi.fn(),
  setLichessToken: vi.fn(),
}));

vi.mock("../lib/backend", () => ({ useBackendInfo: () => mocks.backend }));
vi.mock("../lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/i18n")>()),
  useI18n: () => ({
    locale: "en" as const,
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
  useT: () => (key: string) => key,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
  refreshSettings: vi.fn(),
  setSettings: mocks.setSettings,
  dbInfo: vi.fn(() => new Promise(() => {})),
  backupDatabase: vi.fn(),
  factoryReset: vi.fn(),
  formatBytes: (bytes: number) => String(bytes),
  moveDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  testEngine: vi.fn(),
  useDatabase: vi.fn(),
  onRefDbDone: vi.fn(() => Promise.resolve(() => {})),
  onRefDbProgress: vi.fn(() => Promise.resolve(() => {})),
  refdbCancelImport: vi.fn(),
  refdbClear: vi.fn(),
  refdbDeleteSource: mocks.refdbDeleteSource,
  refdbImport: mocks.refdbImport,
  refdbPrecheck: mocks.refdbPrecheck,
  refdbStatus: mocks.refdbStatus,
  // Reine Helfer · die echten Implementierungen, damit die Trainingstage
  // im Test dasselbe tun wie in der App.
  trainingDayList: (mask: number) =>
    Array.from({ length: 7 }, (_, index) => (mask & (1 << index)) !== 0),
  trainingDayMask: (days: boolean[]) =>
    days.reduce((mask, active, index) => (active ? mask | (1 << index) : mask), 0),
}));
vi.mock("../lib/puzzles", () => ({
  importPuzzles: vi.fn(),
  onPuzzleImportDone: vi.fn(() => Promise.resolve(() => {})),
  onPuzzleImportProgress: vi.fn(() => Promise.resolve(() => {})),
  puzzleStats: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/updater", () => ({
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateState: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../lib/sync", () => ({
  scanPairingQr: vi.fn(),
  syncDiscover: vi.fn(),
  syncInfo: vi.fn(() => new Promise(() => {})),
  syncNow: vi.fn(),
  syncPair: vi.fn(() => new Promise(() => {})),
  syncServerStart: vi.fn(),
}));
vi.mock("../lib/legal", () => ({
  legalDocument: vi.fn(),
  legalDocuments: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/ext", () => ({ openExternal: vi.fn() }));
vi.mock("../lib/lichess", () => ({
  lichessToken: mocks.lichessToken,
  setLichessToken: mocks.setLichessToken,
}));
vi.mock("../lib/syncManager", () => ({
  configureAutoSync: vi.fn(),
  useSyncStatus: () => ({ active: false, phase: "idle", lastSync: 0, lastError: null }),
}));
vi.mock("../lib/notify", () => ({
  applyReminderSchedule: vi.fn(),
  sendTestReminder: vi.fn(),
}));
vi.mock("../lib/analysis", () => ({ indexPositions: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const androidSettings = {
  locale: "en",
  db_path: null,
  engine_path: null,
  engine_threads: 0,
  engine_hash_mb: 64,
  engine_multipv: 1,
  live_depth: 16,
  batch_depth: 18,
  syzygy_path: null,
  chessdb_enabled: true,
  explorer_enabled: true,
  explorer_ratings: "",
  explorer_speeds: "",
  auto_import: false,
  cc_user: "",
  li_user: "",
  display_name: "",
  theme: "dark",
  board_set: "auto",
  piece_set: "classic",
  theme_auto: "off",
  theme_night: "dusk",
  theme_night_from: "19:00",
  theme_night_to: "07:00",
  diagram_mode: false,
  annotate_own_only: false,
  import_months: 3,
  puzzle_goal: 10,
  puzzle_hide_theme: false,
  rep_due_limit: 20,
  rep_new_limit: 5,
  sound_enabled: true,
  sound_volume: 70,
  auto_update: true,
  sync_enabled: false,
  sync_code: "",
  sync_host: "",
  sync_fingerprint: "",
  sync_auto: false,
  notify_enabled: false,
  notify_time: "18:00",
  notify_study: true,
  notify_repertoire: true,
  notify_puzzles: true,
  notify_endgame: true,
  notify_analysis: true,
  notify_weekly: true,
  weekly_minutes: 0,
  training_days: 0,
  goal_date: "",
  onboarded: true,
  analytics_enabled: false,
  analytics_installation_id: "",
} satisfies Settings;

const sectionLoads = [dbInfo, puzzleStats, syncInfo, legalDocuments].map((fn) => vi.mocked(fn));

const emptyRefdb = {
  games: 0,
  positions: 0,
  size_bytes: 0,
  source: "",
  imported_at: 0,
  importing: false,
  path: "reference.sqlite",
  sources: [],
};

beforeEach(() => {
  mocks.backend = { mode: "pending" };
  mocks.getSettings.mockReset();
  mocks.setSettings.mockReset();
  mocks.setSettings.mockImplementation((s: Settings) => Promise.resolve(s));
  mocks.refdbStatus.mockReset();
  mocks.refdbStatus.mockResolvedValue(emptyRefdb);
  mocks.refdbPrecheck.mockReset();
  mocks.refdbPrecheck.mockResolvedValue(null);
  mocks.refdbImport.mockReset();
  mocks.refdbImport.mockResolvedValue(undefined);
  mocks.refdbDeleteSource.mockReset();
  mocks.refdbDeleteSource.mockResolvedValue(undefined);
  mocks.lichessToken.mockReset();
  mocks.lichessToken.mockResolvedValue(null);
  mocks.setLichessToken.mockReset();
  mocks.setLichessToken.mockResolvedValue(undefined);
  sectionLoads.forEach((fn) => fn.mockClear());
  revokePlus();
});

/** Die Seite auf dem Desktop, wo jeder Bereich offen steht. */
async function renderDesktop(settings: Partial<Settings> = {}) {
  mocks.getSettings.mockResolvedValue({ ...androidSettings, ...settings });
  mocks.backend = {
    mode: "desktop",
    info: { version: "0.6.0", backend: "tauri", platform: "windows" },
  };
  await act(async () => {
    render(<SettingsPage />);
  });
}

/**
 * Der Lichess-Token liegt im Schlüsselspeicher und nicht in den Einstellungen.
 *
 * Das war der Grund, aus dem er sich am Speichern vorbeimogelte: Er wurde still
 * beim Verlassen des Feldes geschrieben, die Leiste „ungespeicherte Änderungen"
 * bekam ihn nie zu sehen, und wer stattdessen direkt oben auf Speichern klickte,
 * speicherte alles außer ihm.
 */
describe("Lichess token", () => {
  it("counts as an unsaved change and is written by the save button", async () => {
    await renderDesktop();

    expect(screen.queryByText("set.dirtyHint")).toBeNull();
    const field = screen.getByPlaceholderText("lip_…");
    fireEvent.change(field, { target: { value: "  lip_abc  " } });

    expect(screen.getByText("set.dirtyHint")).toBeTruthy();
    expect(screen.getByText("set.explorerTokenUnsaved")).toBeTruthy();
    // Das Feld allein speichert nichts mehr · auch nicht beim Verlassen.
    fireEvent.blur(field);
    expect(mocks.setLichessToken).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getAllByText("common.save")[0]);
    });

    expect(mocks.setLichessToken).toHaveBeenCalledWith("lip_abc");
    expect(screen.queryByText("set.dirtyHint")).toBeNull();
    expect(screen.getByText("set.explorerTokenSaved")).toBeTruthy();
  });

  it("does not call a change what was only surrounded by spaces", async () => {
    mocks.lichessToken.mockResolvedValue("lip_abc");
    await renderDesktop();

    fireEvent.change(screen.getByPlaceholderText("lip_…"), {
      target: { value: " lip_abc " },
    });
    expect(screen.queryByText("set.dirtyHint")).toBeNull();
  });
});

/**
 * Die Referenzdatenbank als Liste von Sammlungen.
 *
 * Vorher gab es nur „alles löschen": Wer eine Sammlung einlas, die er nicht
 * wollte, musste die andere daneben mitopfern und stundenlang neu einlesen.
 */
describe("reference database", () => {
  const sources = [
    { id: 2, name: "MillionBase.db3", path: "D:/chess/MillionBase.db3", games: 3_400_000, imported_at: 1_788_000_000 },
    { id: 0, name: "AJ-COR.db3", path: "", games: 11_905_762, imported_at: 1_780_000_000 },
  ];

  it("lists every imported file and removes one on its own", async () => {
    mocks.refdbStatus.mockResolvedValue({
      ...emptyRefdb,
      games: 15_305_762,
      positions: 53_034_369,
      sources,
    });
    await renderDesktop();

    expect(screen.getByText("MillionBase.db3")).toBeTruthy();
    expect(screen.getByText("AJ-COR.db3")).toBeTruthy();

    // Gefragt wird vorher · das Entfernen läuft danach im Hintergrund.
    const remove = screen.getAllByText("set.refdbDrop");
    await act(async () => {
      fireEvent.click(remove[0]);
    });
    expect(mocks.refdbDeleteSource).not.toHaveBeenCalled();
    expect(screen.getByText("set.refdbDropConfirm")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getAllByText("set.refdbDrop").slice(-1)[0]);
    });
    expect(mocks.refdbDeleteSource).toHaveBeenCalledWith(2);
  });

  it("warns before reading the same file a second time", async () => {
    grantPlus();
    mocks.refdbStatus.mockResolvedValue({ ...emptyRefdb, games: 11_905_762, sources });
    mocks.refdbPrecheck.mockResolvedValue(sources[1]);
    await renderDesktop();

    // „Importieren" steht auch an der Puzzle-Datenbank · gefragt ist der
    // Knopf in diesem Bereich.
    const section = within(
      document.querySelector<HTMLElement>('[data-settings-section="refdb"]')!
    );
    fireEvent.change(section.getByPlaceholderText(/caissabase\.pgn/), {
      target: { value: "D:/chess/AJ-COR.db3" },
    });
    await act(async () => {
      fireEvent.click(section.getByText("common.import"));
    });

    // Erst die Warnung, kein Import.
    expect(mocks.refdbPrecheck).toHaveBeenCalledWith("D:/chess/AJ-COR.db3");
    expect(mocks.refdbImport).not.toHaveBeenCalled();
    expect(screen.getByText("set.refdbAlreadyImported")).toBeTruthy();

    // Der zweite Klick ist die Antwort darauf.
    await act(async () => {
      fireEvent.click(section.getByText("set.refdbImportAnyway"));
    });
    expect(mocks.refdbImport).toHaveBeenCalledWith("D:/chess/AJ-COR.db3");
  });
});

describe("Settings loading", () => {
  it("never renders web or desktop-only placeholders while Android settings load", async () => {
    let resolveSettings!: (settings: Settings) => void;
    mocks.getSettings.mockReturnValue(
      new Promise<Settings>((resolve) => {
        resolveSettings = resolve;
      })
    );
    // Die Android-Shell entscheidet über das kompakte Layout. Jeder Aufruf
    // baut ein neues Element · React überspringt sonst das erneute Rendern.
    const mobileShell = () => (
      <ShellProvider mobile>
        <SettingsPage />
      </ShellProvider>
    );
    const view = render(mobileShell());

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    expect(screen.queryByText("set.langNote")).toBeNull();

    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "android" },
    };
    view.rerender(mobileShell());

    expect(screen.getByText("set.loading")).toBeTruthy();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();

    await act(async () => resolveSettings(androidSettings));

    expect(screen.queryByText("set.loading")).toBeNull();
    expect(screen.queryByText("set.desktopOnly")).toBeNull();
    // Mobil sind die Bereiche zugeklappt · sichtbar ist die Zeile, nicht ihr Inhalt.
    expect(screen.getByText("set.language")).toBeTruthy();
    expect(screen.queryByText("set.langNoteApp")).toBeNull();
    expect(screen.queryByText("set.langNote")).toBeNull();

    // Aufgeklappt steht dort der App-Hinweis · nicht der Web-Hinweis.
    fireEvent.click(screen.getByRole("button", { name: /set\.language/ }));
    expect(screen.getByText("set.langNoteApp")).toBeTruthy();
    expect(screen.queryByText("set.langNote")).toBeNull();
  });

  // Auf dem Handy stehen alle Bereiche zugeklappt · dann darf die Seite beim
  // Öffnen auch keine Zählabfragen über Millionen Zeilen anstoßen.
  it("loads section data on Android only once a section is opened", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.1", backend: "tauri", platform: "android" },
    };

    await act(async () => {
      render(
        <ShellProvider mobile>
          <SettingsPage />
        </ShellProvider>
      );
    });

    sectionLoads.forEach((fn) => expect(fn).not.toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /set\.database/ }));
    expect(vi.mocked(dbInfo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(puzzleStats)).not.toHaveBeenCalled();
    expect(vi.mocked(syncInfo)).not.toHaveBeenCalled();
    expect(vi.mocked(legalDocuments)).not.toHaveBeenCalled();
  });

  it("keeps every settings section open on the desktop", async () => {
    mocks.getSettings.mockResolvedValue({ ...androidSettings, locale: "de" });
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "windows" },
    };

    await act(async () => {
      render(<SettingsPage />);
    });

    // Kein Aufklappen nötig: der Inhalt steht direkt da.
    expect(screen.getByText("set.langNoteApp")).toBeTruthy();
    expect(screen.getByText("set.soundToggle")).toBeTruthy();
    expect(screen.queryByText("set.soundTest")).toBeNull();
    const soundToggle = screen
      .getByText("set.soundToggle")
      .closest("label")!
      .querySelector("input") as HTMLInputElement;
    expect(soundToggle.checked).toBe(true);
    fireEvent.click(soundToggle);
    expect(soundToggle.checked).toBe(false);
    expect(screen.getByText("set.engineNote")).toBeTruthy();
    // Jede Gruppe trägt ihre Überschrift zweimal: in der Seite und in der
    // Sprungleiste daneben.
    for (const group of ["set.group.basics", "set.group.account", "set.group.training", "set.group.app", "set.advanced"]) {
      expect(screen.getAllByText(group).length).toBe(2);
    }
    // Die Reihenfolge folgt den Gruppen, nicht der Reihenfolge im Quelltext:
    // Grundlagen, Konto, Training, App, Erweitert.
    const order = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(order).toEqual([
      // Grundlagen
      "set.language",
      "set.appearance",
      "set.tour",
      // Konto
      "plus.title",
      "set.accounts",
      "set.sync",
      // Training · Widgets fehlen bewusst: die Homescreen-Widgets gibt es nur
      // unter Android · siehe eigener Test weiter unten.
      "set.annotations",
      "set.sound",
      "set.notify",
      // App
      "set.updates",
      "set.adsPrivacy",
      "set.support",
      "set.about",
      // Erweitert
      "set.engine",
      "set.database",
      "set.chessdb",
      "set.explorer",
      "set.refdb",
      "set.puzzleDb",
      "set.reset",
    ]);
  });

  // Der Bereich hatte auf dem Desktop nur einen Satz zu sagen: dass es hier
  // keine Widgets gibt. Ein Bereich ohne Bedienung gehört weder in die Seite
  // noch in die Sprungleiste.
  it("shows the widgets section on Android only", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "android" },
    };

    await act(async () => {
      render(
        <ShellProvider mobile>
          <SettingsPage />
        </ShellProvider>
      );
    });

    expect(screen.getByRole("button", { name: /set\.widgets/ })).toBeTruthy();
  });

  // Play-Builds dürfen sich nicht selbst aktualisieren · geprüft wird trotzdem,
  // und der Knopf übergibt an Play.
  it("offers the Play update check on a Play Store build", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: {
        version: "0.6.0",
        backend: "tauri",
        platform: "android",
        distribution: "play-store",
      },
    };
    vi.mocked(checkUpdate).mockResolvedValue({ current: "0.6.0", available: "42", notes: null });
    vi.mocked(installUpdate).mockResolvedValue(undefined);

    await act(async () => {
      render(
        <ShellProvider mobile>
          <SettingsPage />
        </ShellProvider>
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /set\.updates/ }));
    // Kein Auto-Update-Schalter: Play entscheidet, wann installiert wird.
    expect(screen.queryByText("set.autoUpdateToggle")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set.updateCheck" }));
    });

    // Der Versionscode aus Play ist keine Versionsnummer · die Meldung nennt
    // deshalb keine.
    expect(screen.getByText("set.updatePlayAvailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /set\.updatePlayInstall/ }));
    expect(vi.mocked(installUpdate)).toHaveBeenCalledTimes(1);
  });

  it("hands the guided tour over to the app shell", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.0", backend: "tauri", platform: "windows" },
    };
    const startTour = vi.fn();

    await act(async () => {
      render(<SettingsPage startTour={startTour} />);
    });

    // Die Seite zeigt den Rundgang nicht selbst: Er wechselt durch die Seiten
    // und leuchtet Elemente aus, die es hier gar nicht gibt.
    fireEvent.click(screen.getByRole("button", { name: "set.tourOpen" }));
    expect(startTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/**
 * Der Diagramm-Modus ist eine zweite Darstellung derselben Seite · keine
 * zweite Seite. Geprüft wird genau das: Er darf nichts wegnehmen, was die
 * gewöhnliche Fassung kann, und er muss dasselbe tun, was sie tut.
 */
describe("Settings in diagram mode", () => {
  beforeEach(() => {
    act(() => setAppearance({ ...DEFAULT_APPEARANCE, diagram: true }));
  });

  afterEach(() => {
    act(() => setAppearance(DEFAULT_APPEARANCE));
  });

  /**
   * Das Blatt kehrte vorher vor den beiden Fenstern der Seite um: Es gab sein
   * eigenes Ergebnis zurück, bevor Lizenztexte und Werksrücksetzung überhaupt
   * gerendert wurden. Die Schaltflächen dazu standen also da und taten nichts.
   */
  it("still opens the windows the page has", async () => {
    await renderDesktop();

    // Das Blatt wird nachgeladen · erst danach steht die Seite da.
    const griff = await screen.findByRole("button", { name: /set\.resetAction/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(griff);
    const fenster = screen.getByRole("dialog");
    expect(within(fenster).getByText("set.resetConfirm")).toBeTruthy();
  });

  // Achtzehn offene Abschnitte sind auf einem Telefon eine Wand aus Text ·
  // und jeder offene Abschnitt holt seine Daten. Der Modus klappt deshalb zu,
  // wie es die gewöhnliche Fassung dort seit jeher tut.
  it("collapses the sections on the phone and fetches nothing until one opens", async () => {
    mocks.getSettings.mockResolvedValue(androidSettings);
    mocks.backend = {
      mode: "desktop",
      info: { version: "0.6.1", backend: "tauri", platform: "android" },
    };

    await act(async () => {
      render(
        <ShellProvider mobile>
          <SettingsPage />
        </ShellProvider>
      );
    });

    expect(await screen.findByText("set.database")).toBeTruthy();
    sectionLoads.forEach((fn) => expect(fn).not.toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set\.database/ }));
    });
    expect(vi.mocked(dbInfo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(puzzleStats)).not.toHaveBeenCalled();
  });
});
