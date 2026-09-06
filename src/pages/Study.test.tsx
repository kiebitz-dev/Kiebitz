import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import Study from "./Study";
import { demoDeepInsights } from "./insights/demo";
import { grantPlus } from "../test/plus";
import { reportWeek } from "../lib/weekly";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const DAY = 86_400;

function liveStudy(overrides: Record<string, unknown> = {}) {
  const today = Math.floor(Date.now() / 1000 / DAY);
  return {
    due_now: 7,
    due_week: [7, 3, 0, 2, 1, 0, 4],
    unanalyzed: 2,
    today_puzzle_attempts: 3,
    puzzle_goal: 10,
    activity: [...Array(7)].map((_, index) => ({
      day_ts: (today - 6 + index) * DAY,
      puzzle_attempts: index === 6 ? 3 : 0,
      endgame_attempts: 0,
      rep_reviews: 0,
    })),
    streak_days: 4,
    ...overrides,
  };
}

function emptyProgram(overrides: Record<string, unknown> = {}) {
  return {
    load_28d: [
      { area: "play", items: 20, minutes: 200 },
      { area: "tactics", items: 40, minutes: 60 },
      { area: "openings", items: 10, minutes: 5 },
      { area: "endgames", items: 0, minutes: 0 },
      { area: "analysis", items: 4, minutes: 24 },
    ],
    days: [],
    observed_weekly_minutes: 72,
    ...overrides,
  };
}

interface BackendOptions {
  study?: ReturnType<typeof liveStudy>;
  deep?: unknown;
  program?: ReturnType<typeof emptyProgram>;
  puzzles?: unknown;
  /** Feste Antwort oder eine Funktion, die je Fenster eine baut. */
  metrics?: unknown[] | ((spec: { from_ts: number; to_ts: number }) => unknown);
  settings?: Record<string, unknown>;
}

function mockBackend(options: BackendOptions = {}) {
  const {
    study = liveStudy(),
    deep = null,
    program = emptyProgram(),
    puzzles = null,
    metrics = [],
    settings = {},
  } = options;
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "app_info":
        return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
      case "get_settings":
        return Promise.resolve({
          locale: "de",
          weekly_minutes: 0,
          training_days: 0,
          goal_date: "",
          ...settings,
        });
      case "study_data":
        return Promise.resolve(study);
      case "training_program":
        return Promise.resolve(program);
      case "list_game_summaries":
        return Promise.resolve([]);
      case "puzzle_insights":
        return Promise.resolve(puzzles);
      case "study_metrics":
        // Der Aufruf trägt inzwischen mehrere Fenster (Befundfenster plus die
        // zwei Wochen des Berichts). Die Antwort folgt deshalb den Fenstern
        // und nicht ihrer Reihenfolge · sonst hinge der Test an der internen
        // Sortierung der Seite.
        return Promise.resolve(
          typeof metrics === "function"
            ? (args as { windows: { from_ts: number; to_ts: number }[] }).windows.map(metrics)
            : metrics
        );
      case "study_calendar":
        return Promise.resolve({
          templates: [
            {
              id: 1,
              title: "Taktik",
              duration_min: 0,
              tool: "Kiebitz Puzzles",
              description: "15–20 Aufgaben",
              area: "tactics",
              areas: ["tactics"],
              builtin: "tactics",
              i18n_key: "",
            },
          ],
          events: [],
          days: [],
        });
      case "schedule_study_unit":
        return Promise.resolve(1);
      case "apply_week_plan":
        return Promise.resolve(1);
      case "set_settings":
        return Promise.resolve({ locale: "de", weekly_minutes: 72, training_days: 0 });
      case "deep_insights":
        return deep ? Promise.resolve(deep) : Promise.reject(new Error("keine Tiefenanalyse"));
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
}

function renderStudy(
  go = vi.fn(),
  openPuzzles = vi.fn(),
  mobile = false,
  openEndgame = vi.fn()
) {
  render(
    <LocaleProvider>
      <ShellProvider mobile={mobile}>
        <Study go={go} openPuzzles={openPuzzles} openEndgame={openEndgame} />
      </ShellProvider>
    </LocaleProvider>
  );
  return { go, openPuzzles, openEndgame };
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  // Wochenvorschlag und Fokuszyklen gehören zu Kiebitz Plus · hier geht es um
  // ihr Verhalten, nicht um das Gate davor.
  grantPlus();
});

afterEach(cleanup);

describe("Study page", () => {
  it("loads and renders the data-backed daily plan through Tauri invoke", async () => {
    mockBackend();
    renderStudy();

    expect(await screen.findByText("3 / 10")).toBeTruthy();
    expect(screen.getAllByText("7 fällig").length).toBeGreaterThan(0);
    expect(screen.getByText("2 Partien offen")).toBeTruthy();
    expect(screen.getByText("4 Tage Serie")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("study_data");
    expect(invokeMock).toHaveBeenCalledWith("training_program", { days: null });
  });

  it("routes an unfinished puzzle task to the puzzle trainer", async () => {
    mockBackend();
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    await screen.findByText("3 / 10");
    fireEvent.click(screen.getByRole("button", { name: "Lösen" }));
    expect(openPuzzles).toHaveBeenCalled();
  });

  it("turns findings into quantified prescriptions with a budget split", async () => {
    mockBackend({ deep: demoDeepInsights() });
    const go = vi.fn();
    renderStudy(go);

    // Ein Befund aus der Tiefenanalyse …
    expect(await screen.findByText("Zeitnot kostet dich Partien")).toBeTruthy();
    // … und die Soll-Verteilung, die aus allen Befunden entsteht: sie steht
    // in der Wochenkarte, neben dem gemessenen Ist, und nirgends sonst.
    expect(document.querySelector("[data-week-area='tactics']")).toBeTruthy();
    expect(document.querySelectorAll("[data-week-budget]")).toHaveLength(1);
    // Der Rest der Liste bleibt über die Insights erreichbar.
    fireEvent.click(screen.getByRole("button", { name: /Befunde in den Insights/ }));
    expect(go).toHaveBeenCalledWith("insights");
  });

  it("passes the recommended rating band into the puzzle trainer", async () => {
    mockBackend({
      deep: demoDeepInsights(),
      puzzles: {
        personal_rating: 1500,
        attempts: 120,
        solved: 70,
        avg_puzzle_rating: 1480,
        avg_solved_rating: 1450,
        best_run: 8,
        current_run: 2,
        themes: [{ theme: "fork", attempts: 20, solved: 6 }],
        by_rating: [{ key: 1200, attempts: 40, solved: 26 }],
        by_weekday: [],
        by_hour: [],
        timeline: [],
      },
    });
    const openPuzzles = vi.fn();
    renderStudy(vi.fn(), openPuzzles);

    // Die Dosis nennt Band und Motiv, statt "üb mal Taktik" zu sagen.
    expect(await screen.findByText(/Aufgaben pro Tag im Band 1\.400–1\.650/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Puzzles" })[0]);
    expect(openPuzzles).toHaveBeenCalledWith(
      "fork",
      expect.objectContaining({ minRating: 1400, maxRating: 1650 })
    );
  });

  it("names the window its advice comes from", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    await screen.findByText("Zeitnot kostet dich Partien");

    // Der Coach nennt seinen Zeitraum · ein Ratschlag ohne ihn ist nicht
    // prüfbar, und genau das war das Problem der ganzen Historie.
    expect(
      screen.getByText(/Aus deinen letzten 42 Tagen · 96 Partien/)
    ).toBeTruthy();
  });

  it("marks a fully completed backend plan as done", async () => {
    mockBackend({ study: liveStudy({ due_now: 0, unanalyzed: 0, today_puzzle_attempts: 30 }) });
    renderStudy();

    expect(await screen.findByText("Tagesplan komplett · starke Arbeit!")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Erledigt")).toHaveLength(3);
    });
  });

  it("lifts the first open task out of the list and into one block", async () => {
    mockBackend();
    renderStudy();

    // Der Block nennt dieselbe Einheit, die sonst als erste Zeile käme · und
    // trägt die ausführliche Beschriftung, nicht das kurze Listen-Verb.
    await screen.findByText("3 / 10");
    const hero = document.querySelector("[data-session-hero]");
    expect(hero?.getAttribute("data-session-hero")).toBe("reviews");
    expect(within(hero as HTMLElement).getByRole("button", { name: /Repertoire trainieren/ })).toBeTruthy();

    // Und sie steht kein zweites Mal in der Liste darunter.
    expect(document.querySelector("[data-session-item='reviews']")).toBeNull();
    expect(document.querySelector("[data-session-item='puzzles']")).toBeTruthy();
  });

  it("puts what is due now above the trainers on mobile", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy(vi.fn(), vi.fn(), true);
    await screen.findAllByText("3 / 10");

    // Reihenfolge der Seite: erst „jetzt dran", dann die Absprünge, dann der
    // Rest des Tages · vorher stand die Wochentabelle vor allem anderen.
    const hero = document.querySelector("[data-session-hero]") as HTMLElement;
    const hub = screen.getByRole("navigation", { name: "Trainingsbereiche" });
    expect(hero.compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Die Woche ist mobil eine Zeile · ihre Bereichszahlen kommen erst auf Tipp.
    expect(document.querySelector("[data-week-area='tactics']")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Diese Woche/ }));
    await waitFor(() => {
      expect(document.querySelector("[data-week-area='tactics']")).toBeTruthy();
    });
  });

  it("acts as the training hub on mobile, but leaves the desktop page alone", async () => {
    mockBackend();
    const { go, openPuzzles } = renderStudy(vi.fn(), vi.fn(), true);
    await screen.findAllByText("3 / 10");

    const hub = within(screen.getByRole("navigation", { name: "Trainingsbereiche" }));
    expect(hub.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Repertoire7 fällig",
      "Puzzles3 / 10",
      // Endspiele haben keinen Fälligkeits-Zähler · die Kachel zeigt deshalb
      // die Endspielzeit der laufenden Woche gegen ihr Ziel.
      "Endspiele0 von 2 Min.",
    ]);

    fireEvent.click(hub.getByRole("button", { name: /^Endspiele/ }));
    expect(go).toHaveBeenCalledWith("endgame");
    fireEvent.click(hub.getByRole("button", { name: /^Puzzles/ }));
    expect(openPuzzles).toHaveBeenCalled();

    cleanup();
    renderStudy();
    await screen.findByText("3 / 10");
    expect(screen.queryByRole("navigation", { name: "Trainingsbereiche" })).toBeNull();
  });

  it("stacks the prescription action below the text only in the mobile shell", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy(vi.fn(), vi.fn(), true);

    const mobileCard = (await screen.findByText("Zeitnot kostet dich Partien")).closest(
      "[data-prescription]"
    ) as HTMLElement;
    const mobileAction = within(mobileCard).queryByRole("button", {
      name: /Puzzles|Repertoire|Endspiele|Analyse|Partien/,
    });
    if (mobileAction) expect(mobileAction.className).toContain("w-full");

    cleanup();
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    const desktopCard = (await screen.findByText("Zeitnot kostet dich Partien")).closest(
      "[data-prescription]"
    ) as HTMLElement;
    const desktopAction = within(desktopCard).queryByRole("button", {
      name: /Puzzles|Repertoire|Endspiele|Analyse|Partien/,
    });
    if (desktopAction) expect(desktopAction.className).not.toContain("w-full");
  });

  it("proposes a week plan and only writes it after confirmation", async () => {
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();
    await screen.findByText("Zeitnot kostet dich Partien");

    fireEvent.click(screen.getByRole("button", { name: /Die nächsten 7 Tage planen/ }));
    expect(await screen.findByText("Vorschlag für die nächsten 7 Tage")).toBeTruthy();
    // Bis hierher darf nichts gespeichert sein.
    expect(invokeMock).not.toHaveBeenCalledWith("apply_week_plan", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "In den Kalender übernehmen" }));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find(([command]) => command === "apply_week_plan");
      // Ein Aufruf für die ganze Woche: er ersetzt frühere Vorschläge, statt
      // sie ein zweites Mal danebenzulegen. Jede Einheit trägt ihre Minuten.
      expect(call?.[1].units.length).toBeGreaterThan(0);
      expect(call?.[1].units[0]).toMatchObject({ template_id: 1 });
      expect(call?.[1].units.every((unit: { planned_min: number }) => unit.planned_min >= 10)).toBe(
        true
      );
    });
  });

  it("names the source of the weekly target without offering to adopt it", async () => {
    // Ohne Vorgabe rechnet der Plan mit dem beobachteten Schnitt · und sagt
    // das auch, denn genau diese Zahl kann sich je Gerät unterscheiden. Die
    // Zeile ist reine Auskunft: das Budget wird in den Einstellungen gesetzt.
    mockBackend({ deep: demoDeepInsights() });
    renderStudy();

    expect(await screen.findByText(/Kein Wochenbudget gesetzt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\d+ Min\. übernehmen/ })).toBeNull();
  });

  it("schedules an editable unit from the week calendar", async () => {
    mockBackend();
    renderStudy();
    await screen.findByText("3 / 10");

    // Die Vorlagen liegen eingeklappt unter dem Kalender.
    fireEvent.click(screen.getByRole("button", { name: /Lerneinheiten/ }));
    expect(await screen.findByText("15–20 Aufgaben")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Planen" }));

    await waitFor(() => {
      // Die Länge kommt aus dem Budget, nicht aus einem Eingabefeld.
      const call = invokeMock.mock.calls.find(([command]) => command === "schedule_study_unit");
      expect(call?.[1]).toMatchObject({ templateId: 1 });
      expect(call?.[1].plannedMin).toBeGreaterThanOrEqual(10);
    });
  });
  describe("weekly report", () => {
    /**
     * Kennzahlen je Fenster · die berichtete Woche steht besser da als die
     * davor. Alles außerhalb der beiden Wochen bekommt dieselben Zahlen wie
     * die Vorwoche: das Befundfenster spielt für den Bericht keine Rolle.
     */
    function reportMetrics() {
      const week = reportWeek(new Date());
      return (spec: { from_ts: number }) => ({
        from_ts: spec.from_ts,
        to_ts: spec.from_ts + 7 * DAY,
        games: 12,
        ratings: [],
        metrics: [
          {
            key: "blunders_per100",
            value: spec.from_ts === week.start ? 2.3 : 4.4,
            n: 600,
            sd: null,
            unit: "per100",
            lower_is_better: true,
          },
        ],
      });
    }

    /** Eine gemessene Trainingswoche in genau dem berichteten Zeitraum. */
    function reportedDays() {
      const week = reportWeek(new Date());
      return [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
        day_ts: week.start + offset * DAY,
        play: 12,
        tactics: 9,
        openings: 0,
        endgames: 0,
        analysis: 0,
      }));
    }

    const backend = () => ({
      deep: demoDeepInsights(),
      program: emptyProgram({ days: reportedDays() }),
      metrics: reportMetrics(),
    });

    it("stays out of the page until the symbol in the header is used", async () => {
      mockBackend(backend());
      renderStudy();

      // Ungelesen leuchtet das Symbol · der Bericht selbst nimmt der Seite
      // keinen Platz weg, solange ihn niemand aufgemacht hat.
      const open = await screen.findByRole("button", { name: /Neuer Wochenbericht/ });
      expect(screen.queryByText(/Besser geworden/)).toBeNull();
      expect(document.querySelector("[data-weekly-report]")).toBeNull();

      fireEvent.click(open);

      expect(await screen.findByText(/Besser geworden: Patzer\/100 Züge/)).toBeTruthy();
      // Die drei Blöcke des Berichts · sie sind seine ganze Aussage.
      expect(document.querySelector("[data-weekly-block='changes']")).toBeTruthy();
      expect(document.querySelector("[data-weekly-block='effect']")).toBeTruthy();
      expect(document.querySelector("[data-weekly-block='next']")).toBeTruthy();
      // Gemessene Zeit der berichteten Woche, nicht der laufenden.
      expect(screen.getByText("147")).toBeTruthy();
      // Als Dialog über der Seite, nicht als Karte darin.
      expect(document.querySelector("[role='dialog']")).toBeTruthy();
    });

    // Der Bericht lag als Vollbild-Dialog über allem — auch über der
    // Navigationsleiste, und unter dem Anzeigenband, das auf Android als native
    // Fläche über der WebView liegt und deshalb von nichts zu überdecken ist.
    it("stays inside the content area of the mobile shell", async () => {
      const root = document.createElement("div");
      root.id = "mobile-sheet-root";
      document.body.appendChild(root);
      try {
        mockBackend(backend());
        renderStudy(vi.fn(), vi.fn(), true);

        fireEvent.click(await screen.findByRole("button", { name: /Neuer Wochenbericht/ }));
        const report = document.querySelector("[data-weekly-report]");
        expect(report).toBeTruthy();
        expect(root.contains(report as Node)).toBe(true);
        // Kein `fixed` mehr · der Schleier deckt genau den Behälter.
        expect((report as HTMLElement).parentElement?.className).toContain("absolute");
      } finally {
        root.remove();
      }
    });

    it("keeps the window-wide dialog where there is no such shell", async () => {
      mockBackend(backend());
      renderStudy();

      fireEvent.click(await screen.findByRole("button", { name: /Neuer Wochenbericht/ }));
      const report = document.querySelector("[data-weekly-report]") as HTMLElement;
      expect(report.parentElement?.className).toContain("fixed");
    });

    it("stops flagging the report as new once it has been opened", async () => {
      mockBackend(backend());
      renderStudy();

      fireEvent.click(await screen.findByRole("button", { name: /Neuer Wochenbericht/ }));
      fireEvent.click(screen.getByRole("button", { name: "Bericht schließen" }));
      expect(document.querySelector("[data-weekly-report]")).toBeNull();

      // Gelesen ist gelesen · das Symbol bleibt aber stehen, der Bericht ist
      // die Woche über erreichbar. Auch nach einem Neustart der Seite: der
      // Merker liegt im Speicher der Installation und trägt den Wochenanfang.
      cleanup();
      mockBackend(backend());
      renderStudy();
      const again = await screen.findByRole("button", { name: "Wochenbericht öffnen" });
      fireEvent.click(again);
      expect(screen.getByText(/Besser geworden/)).toBeTruthy();
    });

    it("closes itself on the way into the trainer it points at", async () => {
      mockBackend(backend());
      const openPuzzles = vi.fn();
      renderStudy(vi.fn(), openPuzzles);

      fireEvent.click(await screen.findByRole("button", { name: /Neuer Wochenbericht/ }));
      const next = document.querySelector("[data-weekly-block='next'] button");
      fireEvent.click(next!);

      expect(openPuzzles).toHaveBeenCalled();
      // Sonst läge der Bericht über dem Trainer, in den er gerade geführt hat.
      expect(document.querySelector("[data-weekly-report]")).toBeNull();
    });

    /**
     * Auf dem Handy stand der Bericht als beschrifteter Knopf in einer eigenen
     * Zeile über Rating und Serie · zwei Zeilen für drei Angaben, von denen
     * eine ein Symbol ist. Jetzt ist es eine Zeile wie auf dem Desktop: Der
     * Bericht ist nur noch sein Symbol und steht mit den beiden Kennzahlen im
     * selben Feld. Beschriftet bleibt er über sein `aria-label`.
     */
    it("keeps the symbol next to rating and streak in one row on the phone", async () => {
      mockBackend(backend());
      renderStudy(vi.fn(), vi.fn(), true);

      const open = await screen.findByRole("button", { name: /Neuer Wochenbericht/ });
      expect(open.textContent).toBe("");
      const row = open.parentElement!;
      expect(row.textContent).toContain("Tage Serie");
    });

    it("has no report for a week that was neither played nor trained", async () => {
      mockBackend({ deep: demoDeepInsights(), metrics: () => null });
      renderStudy();
      await screen.findByText("3 / 10");
      // Kein Bericht, kein Symbol · ein Knopf, der eine leere Woche aufmacht,
      // wäre ein Versprechen ohne Inhalt.
      expect(document.querySelector("[data-weekly-open]")).toBeNull();
    });
  });
});
