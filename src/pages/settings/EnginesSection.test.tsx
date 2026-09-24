/**
 * Die Engine-Liste und das Turnier: was die Seite ans Backend schickt und was
 * sie aus dessen Meldungen macht.
 *
 * Der Lauf gehört dem Backend · die Seite darf nichts erfinden, was nicht aus
 * `tournament_status` oder dem Ereignisstrom kommt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EnginesSection from "./EnginesSection";
import { LocaleProvider } from "../../lib/i18n";
import { EMPTY_STATUS, type TournamentStatus } from "../../lib/tournament";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  status: vi.fn(),
  test: vi.fn(),
  listeners: [] as ((status: TournamentStatus) => void)[],
}));

vi.mock("../../lib/tournament", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/tournament")>()),
  tournamentStart: (...args: unknown[]) => mocks.start(...args),
  tournamentCancel: () => mocks.cancel(),
  tournamentStatus: () => mocks.status(),
  tournamentPgn: () => Promise.resolve("[Event \"Kiebitz\"]"),
  onTournamentProgress: (cb: (status: TournamentStatus) => void) => {
    mocks.listeners.push(cb);
    return Promise.resolve(() => {});
  },
}));
// Nur der Engine-Test wird ersetzt · die Sprachumschaltung liest aus
// demselben Modul die Einstellungen.
vi.mock("../../lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/settings")>()),
  getSettings: () => Promise.resolve({ locale: "de" }),
  testEngine: (...args: unknown[]) => mocks.test(...args),
}));
vi.mock("../../lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/backend")>()),
  bundledEngineInfo: () => Promise.resolve({ available: true, name: "Stockfish 19", path: "C:/kiebitz/stockfish.exe" }),
}));
vi.mock("../../lib/db", () => ({ writePgnFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Die mitgelieferte · sie geht mit leerem Pfad ans Backend. */
const BUNDLED = { name: "Stockfish 19", path: "" };

const ENGINES = [
  { name: "Stockfish", path: "C:/sf.exe" },
  { name: "Dragon", path: "C:/dragon.exe" },
  { name: "Berserk", path: "C:/berserk.exe" },
];

function show(props: Partial<Parameters<typeof EnginesSection>[0]> = {}) {
  return render(
    <LocaleProvider>
      <EnginesSection
        engines={ENGINES}
        analysisPath={null}
        onChange={() => {}}
        onUseForAnalysis={() => {}}
        {...props}
      />
    </LocaleProvider>
  );
}

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.listeners.length = 0;
  mocks.start.mockReset().mockResolvedValue(undefined);
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.status.mockReset().mockResolvedValue(EMPTY_STATUS);
  mocks.test.mockReset().mockResolvedValue({ ok: true, name: "Stockfish 19" });
});
afterEach(cleanup);

describe("EnginesSection", () => {
  it("starts a tournament with the engines it shows", async () => {
    show();
    await screen.findByText("Stockfish 19");
    fireEvent.click(await screen.findByRole("button", { name: /Turnier starten/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0]).toMatchObject({
      engines: [BUNDLED, ...ENGINES],
      rounds: 2,
      movetimeMs: 500,
    });
  });

  it("leaves out an engine that was unticked", async () => {
    show();
    await screen.findByText("Stockfish 19");
    const boxes = await screen.findAllByRole("checkbox");
    // Die mitgelieferte, dann die drei eingetragenen.
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[3]);
    fireEvent.click(screen.getByRole("button", { name: /Turnier starten/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0].engines).toEqual([BUNDLED, ENGINES[1]]);
    // Eine Engine allein ist kein Turnier.
    fireEvent.click(boxes[2]);
    expect((screen.getByRole("button", { name: /Turnier starten/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the table and the games the backend reports in the tournament hall", async () => {
    show();
    const status: TournamentStatus = {
      ...EMPTY_STATUS,
      played: 1,
      total: 2,
      standings: [
        { name: "Dragon", halfPoints: 3, wins: 1, draws: 1, losses: 0 },
        { name: "Stockfish", halfPoints: 1, wins: 0, draws: 1, losses: 1 },
      ],
      games: [
        {
          round: 1,
          white: "Dragon",
          black: "Stockfish",
          result: "1-0",
          reason: "mate",
          plies: 61,
          moves: "1. e4",
        },
      ],
    };
    // Erst die Abfrage beim Öffnen abwarten · danach meldet sich das Backend.
    await screen.findByRole("button", { name: /Turnier starten/ });
    act(() => mocks.listeners.forEach((cb) => cb(status)));
    expect(await screen.findByText(/Vorn: Dragon mit 1,5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Turnier ansehen/ }));
    const hall = await screen.findByTestId("tournament-hall");
    expect(within(hall).getByText("1,5")).toBeTruthy();
    expect(within(hall).getByText("0,5")).toBeTruthy();
    expect(within(hall).getByText("Dragon – Stockfish")).toBeTruthy();
  });

  it("opens the hall on start and shows every board that is being played", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Turnier starten/ }));
    const hall = await screen.findByTestId("tournament-hall");
    const board = (n: number, white: string, black: string) => ({
      board: n,
      round: 1,
      white,
      black,
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      plies: 1,
      lastMove: "e2e4",
    });
    act(() =>
      mocks.listeners.forEach((cb) =>
        cb({
          ...EMPTY_STATUS,
          running: true,
          total: 6,
          boards: [board(1, "Stockfish 19", "Stockfish"), board(2, "Dragon", "Berserk")],
        })
      )
    );
    expect(within(hall).getAllByTestId("tournament-board")).toHaveLength(2);
    expect(within(hall).getByText("Brett 2")).toBeTruthy();
    // Schließen hält das Turnier nicht an.
    fireEvent.click(within(hall).getByRole("button", { name: "Schließen" }));
    expect(screen.queryByTestId("tournament-hall")).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("offers stopping while a tournament runs", async () => {
    mocks.status.mockResolvedValue({ ...EMPTY_STATUS, running: true, white: "A", black: "B", plies: 7, total: 2 });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Abbrechen/ }));
    expect(mocks.cancel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Turnier starten/ })).toBeNull();
  });

  it("keeps name, path and test behind the pencil and takes the name the engine reports for itself", async () => {
    const onChange = vi.fn();
    show({ onChange });
    expect(screen.queryByRole("button", { name: "Testen" })).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: "Engine bearbeiten" }))[0]);
    expect((screen.getByRole("textbox", { name: "Pfad der Engine" }) as HTMLInputElement).value).toBe("C:/sf.exe");
    fireEvent.click(screen.getByRole("button", { name: "Testen" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0]).toEqual({ name: "Stockfish 19", path: "C:/sf.exe" });
  });

  /**
   * War eine zweite Engine übernommen, führte kein Klick mehr zur
   * mitgelieferten zurück, und gegen sie ließ sich kein Turnier starten.
   */
  it("keeps the bundled engine as a row of its own and switches back to it", async () => {
    const onUseForAnalysis = vi.fn();
    show({ engines: [ENGINES[1]], analysisPath: "C:/dragon.exe", onUseForAnalysis });
    const row = await screen.findByTestId("bundled-engine");
    expect(row.textContent).toContain("Stockfish 19");
    fireEvent.click(screen.getAllByRole("button", { name: "Für Analyse" })[0]);
    expect(onUseForAnalysis).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: /Turnier starten/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0].engines).toEqual([BUNDLED, ENGINES[1]]);
  });
});
