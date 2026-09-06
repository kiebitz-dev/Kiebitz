import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { loadLocale, LocaleProvider } from "./lib/i18n";
import App from "./App";
import { resetTagline } from "./lib/tagline";

const mocks = vi.hoisted(() => ({
  backend: {
    mode: "desktop",
    info: { platform: "android", version: "0.5.2" },
  } as { mode: string; info: Record<string, unknown> },
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

vi.mock("./lib/backend", () => ({ useBackendInfo: () => mocks.backend }));
vi.mock("./lib/db", () => ({ dbStats: () => new Promise(() => {}) }));
vi.mock("./lib/settings", () => ({
  // Diese Navigationstests brauchen keine asynchron geladenen Einstellungen.
  // Eine offene Promise verhindert fachfremde State-Updates nach dem Assert.
  getSettings: () => new Promise(() => {}),
}));
vi.mock("./lib/sync", () => ({ syncInfo: () => Promise.resolve({ last_sync: 0 }) }));
vi.mock("./lib/notify", () => ({ startReminders: vi.fn(), stopReminders: vi.fn() }));
vi.mock("./lib/autoImport", () => ({ startAutoImport: vi.fn(), stopAutoImport: vi.fn() }));
vi.mock("./lib/syncManager", () => ({
  configureAutoSync: vi.fn(),
  useSyncStatus: () => ({ active: false, phase: "idle", lastSync: 0 }),
}));
vi.mock("./lib/updater", () => ({
  checkUpdate: mocks.checkUpdate,
  installUpdate: mocks.installUpdate,
  onUpdateAvailable: () => Promise.resolve(() => {}),
  onUpdateState: () => Promise.resolve(() => {}),
}));
// Vom Start führt ein Absprung in die Analyse *einer* Partie · daran hängt der
// Test, der prüft, dass ein zweiter Tipp auf den Reiter wieder das freie Brett
// zeigt.
vi.mock("./pages/Dashboard", () => ({
  default: ({ openAnalysis }: { openAnalysis: (id: number) => void }) => (
    <div>
      <div>Dashboard</div>
      <button onClick={() => openAnalysis(42)}>Partie analysieren</button>
    </div>
  ),
}));
// Die Partien-Seite legt ihr Detail mobil als Blatt über den Inhalt · der
// Mock tut dasselbe mit demselben Bauteil, damit die Leiste unten prüfbar
// bleibt: Ein zweiter Tipp auf den eigenen Tab soll das Blatt schliessen.
vi.mock("./pages/Games", async () => {
  const { useState } = await import("react");
  const MobileSheet = (await import("./components/MobileSheet")).default;
  return {
    default: () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <div>Games</div>
          <button onClick={() => setOpen(true)}>Partie öffnen</button>
          {open && (
            <MobileSheet ariaLabel="Partiedetails" title="Partie" onClose={() => setOpen(false)}>
              Zugliste
            </MobileSheet>
          )}
        </div>
      );
    },
  };
});
// Die Analyse hat beides, was ein Zurücksetzen betrifft: einen Parameter von
// außen (die vorgewählte Partie) und einen Zustand, den sie selbst führt.
vi.mock("./pages/Analysis", async () => {
  const { useState } = await import("react");
  return {
    default: ({ targetGameId }: { targetGameId: number | null }) => {
      const [note, setNote] = useState("");
      return (
        <div>
          <div>Analysis</div>
          <div>Partie: {targetGameId ?? "frei"}</div>
          <input aria-label="Notiz" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      );
    },
  };
});
vi.mock("./pages/Repertoire", () => ({ default: () => <div>Repertoire</div> }));
vi.mock("./pages/Endgame", () => ({ default: () => <div>Endgame</div> }));
vi.mock("./pages/Puzzles", () => ({ default: () => <div>Puzzles</div> }));
// Der Training-Hub reicht seine Navigations-Props durch; der Mock macht sie
// klickbar, damit die Detailebene auf App-Ebene prüfbar bleibt.
vi.mock("./pages/Study", () => ({
  default: ({ go, openPuzzles }: { go: (p: string) => void; openPuzzles: () => void }) => (
    <div>
      <div>Study</div>
      <button onClick={() => go("endgame")}>Zu den Endspielen</button>
      <button onClick={() => openPuzzles()}>Zu den Puzzles</button>
    </div>
  ),
}));
// Die Insights reichen ihre Absprünge genauso durch wie der Training-Hub ·
// aus einem Befund heraus sind Repertoire und Endspiele eine Detailebene.
vi.mock("./pages/InsightsV2", () => ({
  default: ({ openRepertoire }: { openRepertoire?: () => void }) => (
    <div>
      <div>Insights</div>
      <button onClick={() => openRepertoire?.()}>Zum Repertoire</button>
    </div>
  ),
}));
// Die Einstellungen halten ihren Entwurf bis zum Speichern · der Mock meldet
// das über dieselbe Anmeldung wie die Seite selbst.
vi.mock("./pages/Settings", async () => {
  const { useEffect, useRef, useState } = await import("react");
  const { holdPage } = await import("./lib/pageReset");
  // Wie oft die Seite eingehängt wurde · daran ist ein Neustart zu erkennen,
  // auch wenn danach dasselbe dasteht wie vorher.
  let eingehaengt = 0;
  return {
    default: () => {
      const [wert, setWert] = useState("");
      const ref = useRef(wert);
      ref.current = wert;
      const nr = useRef(0);
      if (nr.current === 0) nr.current = ++eingehaengt;
      useEffect(() => holdPage(() => ref.current !== ""), []);
      return (
        <div>
          <div>Settings</div>
          <div>Eingehängt: {nr.current}</div>
          <input aria-label="Feld" value={wert} onChange={(e) => setWert(e.target.value)} />
        </div>
      );
    },
  };
});

const realMatchMedia = window.matchMedia;

beforeEach(async () => {
  mocks.backend = { mode: "desktop", info: { platform: "android", version: "0.5.2" } };
  mocks.checkUpdate.mockReset();
  mocks.checkUpdate.mockRejectedValue(new Error("kein Backend"));
  mocks.installUpdate.mockReset();
  mocks.installUpdate.mockResolvedValue(undefined);
  // Ab Werk startet die App auf Englisch; hier werden deutsche Labels geprüft.
  localStorage.setItem("kiebitz.locale", "de");
  await loadLocale("de");
  window.matchMedia = realMatchMedia;
});

afterEach(async () => {
  cleanup();
  // jsdom teilt die Session-History über alle Tests der Datei · zurückspulen,
  // damit jeder Test wieder auf einem leeren Stapel startet.
  const behind = window.history.length - 1;
  if (behind > 0) window.history.go(-behind);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** Die mobile Bottom-Leiste. */
function bottomBar() {
  return within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
}

/** Der aktive Eintrag der Bottom-Leiste. */
function activeTab() {
  return bottomBar()
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-current") === "page")?.textContent;
}

/** Die gerenderte Seite · die Mocks geben den Namen als <div> aus. */
function pageTitle() {
  return screen.getByText(/^(Dashboard|Games|Analysis|Repertoire|Endgame|Puzzles|Study|Insights|Settings)$/, {
    selector: "div",
  }).textContent;
}

describe("mobile navigation", () => {
  it("replaces the drawer with an app bar carrying title, back and settings", async () => {
    // Der Claim wird beim Start gezogen · für den Test wird die Wahl auf den
    // ersten Satz festgelegt, sonst stünde in jedem Lauf ein anderer da.
    resetTagline();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let container: HTMLElement = document.createElement("div");
    await act(async () => {
      container = render(<LocaleProvider><App /></LocaleProvider>).container;
    });
    await screen.findByText("Dashboard", { selector: "div" });
    await screen.findByRole("button", { name: "Partien" });
    // Weder Hamburger noch Sidebar · die Leiste trägt die Ziele.
    expect(screen.queryByRole("button", { name: "Menü" })).toBeNull();
    expect(container.querySelector("aside")).toBeNull();

    const header = container.querySelector("header") as HTMLElement;
    const bar = within(header);
    // Die Marke steht auf jedem Tab; auf dem Start ergänzt sie der Claim.
    expect(header.textContent).toContain("Kiebitz · Zug um Zugvogel");
    // Daneben steht das Modell · ohne Konto ist das Free.
    expect(bar.getByLabelText("Aktuelles Modell: Free")).toBeTruthy();
    expect(bar.queryByRole("button", { name: "Zurück" })).toBeNull();

    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    expect(header.textContent).toContain("Kiebitz · Partien");
    // Hauptziele erreicht man über die Leiste · dort ist kein Pfeil nötig.
    expect(bar.queryByRole("button", { name: "Zurück" })).toBeNull();
  });

  it("opens the settings from the app bar and offers a way back", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);

    fireEvent.click(bar.getByRole("button", { name: "Einstellungen" }));
    await waitFor(() => expect(pageTitle()).toBe("Settings"));
    // Einstellungen sind kein Tab · von dort führt der Pfeil zurück.
    expect(activeTab()).toBeUndefined();

    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Dashboard"));
  });

  it("shows the five main destinations in the bottom bar and marks the active one", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const labels = bottomBar()
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual(["Dashboard", "Partien", "Analyse", "Training", "Insights"]);
    expect(activeTab()).toBe("Dashboard");

    fireEvent.click(bottomBar().getByRole("button", { name: "Insights" }));
    await waitFor(() => expect(pageTitle()).toBe("Insights"));
    expect(activeTab()).toBe("Insights");

    const main = container.querySelector("main") as HTMLElement;
    main.scrollTop = 640;
    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    await waitFor(() => expect(pageTitle()).toBe("Study"));
    expect(main.scrollTop).toBe(0);
  });

  it("closes an open detail sheet when its own tab is tapped again", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const main = container.querySelector("main") as HTMLElement;

    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    fireEvent.click(await screen.findByRole("button", { name: "Partie öffnen" }));
    expect(screen.getByRole("dialog", { name: "Partiedetails" })).toBeTruthy();

    // Der Tipp gilt dem Blatt, nicht dem Anfang der Liste · deren Stand bleibt.
    main.scrollTop = 640;
    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(main.scrollTop).toBe(640);
    expect(pageTitle()).toBe("Games");
    // Der eigene History-Eintrag des Blattes ist mit ihm gegangen · die Tiefe
    // steht wieder auf der Seite, und Zurück führt von hier zum Start.
    await waitFor(() => expect(window.history.state).toEqual({ kd: 2 }));
  });

  /**
   * Ein Tipp auf den offenen Reiter ist kein Weg irgendwohin · er ist die Bitte,
   * hier von vorn anzufangen. Vorher scrollte er nur nach oben, und die
   * besondere Analyse einer Partie stand weiter da.
   */
  it("starts the open tab over when its own tab is tapped again", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Partie analysieren" }));
    await waitFor(() => expect(pageTitle()).toBe("Analysis"));
    expect(screen.getByText("Partie: 42")).toBeTruthy();

    // Was die Seite selbst führt, zählt genauso wie ihr Parameter.
    const notiz = screen.getByLabelText("Notiz") as HTMLInputElement;
    fireEvent.change(notiz, { target: { value: "Halb getippt" } });
    expect((screen.getByLabelText("Notiz") as HTMLInputElement).value).toBe("Halb getippt");

    fireEvent.click(bottomBar().getByRole("button", { name: "Analyse" }));

    await waitFor(() => expect(screen.getByText("Partie: frei")).toBeTruthy());
    expect((screen.getByLabelText("Notiz") as HTMLInputElement).value).toBe("");
    // Und der Stapel steht wieder auf dem Hauptziel · Zurück führt zum Start.
    await waitFor(() => expect(window.history.state).toEqual({ kd: 2 }));
  });

  /**
   * Eine Seite, die ungesicherte Arbeit hält, wird nicht zurückgesetzt · dort
   * bleibt der Tipp der Griff an den Kopf der Seite.
   */
  it("spares a page that is holding unsaved work", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);

    fireEvent.click(bar.getByRole("button", { name: "Einstellungen" }));
    await waitFor(() => expect(pageTitle()).toBe("Settings"));

    const feld = screen.getByLabelText("Feld") as HTMLInputElement;
    fireEvent.change(feld, { target: { value: "Halb getippt" } });

    const eingehaengt = screen.getByText(/^Eingehängt: /).textContent;

    fireEvent.click(bar.getByRole("button", { name: "Einstellungen" }));
    await waitFor(() => expect(pageTitle()).toBe("Settings"));
    // Der Entwurf steht noch, und die Seite ist dieselbe geblieben.
    expect((screen.getByLabelText("Feld") as HTMLInputElement).value).toBe("Halb getippt");
    expect(screen.getByText(/^Eingehängt: /).textContent).toBe(eingehaengt);

    // Gespeichert (hier: geleert) hält die Seite nichts mehr fest · dann hängt
    // derselbe Tipp sie wieder neu ein.
    fireEvent.change(screen.getByLabelText("Feld"), { target: { value: "" } });
    fireEvent.click(bar.getByRole("button", { name: "Einstellungen" }));
    await waitFor(() =>
      expect(screen.getByText(/^Eingehängt: /).textContent).not.toBe(eingehaengt)
    );
  });

  it("opens a training area as a detail level under Training", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);

    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zu den Endspielen" }));

    await waitFor(() => expect(pageTitle()).toBe("Endgame"));
    // Der Tab bleibt markiert, der Pfeil führt eine Ebene zurück ins Training.
    expect(activeTab()).toBe("Training");
    expect(window.history.state).toEqual({ kd: 3 });

    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Study"));
  });

  it("comes back to the exact spot the jump started from", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);
    const main = container.querySelector("main") as HTMLElement;

    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    const jump = await screen.findByRole("button", { name: "Zu den Puzzles" });
    // So weit unten steht der Befund, aus dem der Nutzer abspringt.
    main.scrollTop = 640;
    fireEvent.click(jump);

    await waitFor(() => expect(pageTitle()).toBe("Puzzles"));
    // Die Detailebene selbst beginnt oben.
    expect(main.scrollTop).toBe(0);

    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Study"));
    expect(main.scrollTop).toBe(640);
  });

  it("forgets the spot when the next stop is a tab, not the way back", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const main = container.querySelector("main") as HTMLElement;

    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    main.scrollTop = 640;
    fireEvent.click(await screen.findByRole("button", { name: "Zu den Puzzles" }));
    await waitFor(() => expect(pageTitle()).toBe("Puzzles"));

    // Über die Leiste zurück ins Training ist ein Tabwechsel · der beginnt oben.
    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    await waitFor(() => expect(pageTitle()).toBe("Study"));
    expect(main.scrollTop).toBe(0);
  });

  it("opens the repertoire from an insight as a detail level", async () => {
    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = within(container.querySelector("header") as HTMLElement);
    const main = container.querySelector("main") as HTMLElement;

    fireEvent.click(bottomBar().getByRole("button", { name: "Insights" }));
    const jump = await screen.findByRole("button", { name: "Zum Repertoire" });
    main.scrollTop = 320;
    fireEvent.click(jump);

    await waitFor(() => expect(pageTitle()).toBe("Repertoire"));
    // Der Pfeil führt zurück in die Insights · nicht auf den Start.
    fireEvent.click(bar.getByRole("button", { name: "Zurück" }));
    await waitFor(() => expect(pageTitle()).toBe("Insights"));
    expect(main.scrollTop).toBe(320);
  });

  it("keeps the puzzle theme deep link under Training as well", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);
    fireEvent.click(bottomBar().getByRole("button", { name: "Training" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zu den Puzzles" }));

    await waitFor(() => expect(pageTitle()).toBe("Puzzles"));
    expect(activeTab()).toBe("Training");

    window.history.back();
    await waitFor(() => expect(pageTitle()).toBe("Study"));
  });
});

describe("landscape phone", () => {
  it("moves the navigation to a rail so the scarce axis stays free", () => {
    // Im Querformat ist Höhe knapp und Breite reichlich · die Leiste wandert
    // an die linke Kante.
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("landscape"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    const { container } = render(<LocaleProvider><App /></LocaleProvider>);
    const bar = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(bar.className).toContain("mobile-nav-rail");
    expect(bar.className).not.toContain("mobile-bottom-nav");
    // Die Rail steht neben dem Inhalt, nicht darunter.
    expect(container.firstElementChild?.className).toContain("flex-row");
  });
});

describe("back navigation", () => {
  it("adds a history entry per level so the Android back button has something to pop", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);

    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    // Die Seiten werden nachgeladen · erst abwarten, dann prüfen. Ohne das
    // hängt der Test daran, ob ein früherer ihn zufällig vorgewärmt hat.
    await waitFor(() => expect(pageTitle()).toBe("Games"));
    expect(window.history.state).toEqual({ kd: 2 });

    window.history.back();
    await waitFor(() => expect(window.history.state).toEqual({ kd: 1 }));
    expect(pageTitle()).toBe("Dashboard");
  });

  it("returns to the start destination from any main destination", async () => {
    render(<LocaleProvider><App /></LocaleProvider>);

    // Mehrfaches Wechseln zwischen Hauptzielen darf den Stapel nicht wachsen
    // lassen · sonst braucht der Nutzer vier Mal Zurück, um herauszukommen.
    fireEvent.click(bottomBar().getByRole("button", { name: "Partien" }));
    fireEvent.click(bottomBar().getByRole("button", { name: "Analyse" }));
    fireEvent.click(bottomBar().getByRole("button", { name: "Insights" }));
    expect(window.history.state).toEqual({ kd: 2 });

    window.history.back();
    await waitFor(() => expect(pageTitle()).toBe("Dashboard"));
  });
});

describe("Play-Updates", () => {
  // Andere Android-Apps sagen beim Start, wenn im Store etwas Neueres steht ·
  // Kiebitz tut das jetzt auch, und der Knopf übergibt an Play.
  it("reports a Play Store update after the start and hands over to Play", async () => {
    mocks.backend = {
      mode: "desktop",
      info: { platform: "android", version: "0.5.2", distribution: "play-store" },
    };
    mocks.checkUpdate.mockResolvedValue({ current: "0.5.2", available: "42", notes: null });

    await act(async () => {
      render(<LocaleProvider><App /></LocaleProvider>);
    });

    // Der Versionscode von Play ist keine Versionsnummer · der Hinweis nennt
    // deshalb keine.
    const notice = await screen.findByText("Im Play Store steht eine neuere Version von Kiebitz.");
    expect(notice).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
    expect(mocks.installUpdate).toHaveBeenCalledTimes(1);
  });

  // Vorher verschwand der Hinweis beim Klick, das Update schlug fehl und
  // niemand erfuhr davon. Jetzt bleibt er stehen, versucht es im Hintergrund
  // weiter und bietet danach das Wiederholen an.
  it("keeps the notice and retries when the install fails", async () => {
    vi.useFakeTimers();
    try {
      mocks.backend = {
        mode: "desktop",
        info: { platform: "android", version: "0.5.2", distribution: "play-store" },
      };
      mocks.checkUpdate.mockResolvedValue({ current: "0.5.2", available: "42", notes: null });
      mocks.installUpdate.mockRejectedValue(new Error("Play antwortet nicht"));

      await act(async () => {
        render(<LocaleProvider><App /></LocaleProvider>);
      });
      await act(async () => {});

      fireEvent.click(screen.getByRole("button", { name: "Jetzt aktualisieren" }));
      await act(async () => {});
      // Der Hinweis steht noch, jetzt mit laufendem Versuch.
      expect(screen.getByText("Update wird gestartet …")).toBeTruthy();

      // Zwei Pausen, drei Versuche.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(mocks.installUpdate).toHaveBeenCalledTimes(3);

      // Danach der Fehler, und ein Knopf, der es noch einmal versucht.
      expect(screen.getByText(/Play antwortet nicht/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
      await act(async () => {});
      expect(mocks.installUpdate).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet on a sideloaded build · there the backend asks GitHub", async () => {
    mocks.checkUpdate.mockResolvedValue({ current: "0.5.2", available: "0.6.0", notes: null });

    await act(async () => {
      render(<LocaleProvider><App /></LocaleProvider>);
    });

    expect(mocks.checkUpdate).not.toHaveBeenCalled();
  });
});
