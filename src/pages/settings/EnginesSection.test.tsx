/**
 * Die Engine-Liste und das Turnier: was die Seite ans Backend schickt und was
 * sie aus dessen Meldungen macht.
 *
 * Der Lauf gehört dem Backend · die Seite darf nichts erfinden, was nicht aus
 * `tournament_status` oder dem Ereignisstrom kommt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../../lib/db", () => ({ writePgnFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

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
    fireEvent.click(await screen.findByRole("button", { name: /Turnier starten/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0]).toMatchObject({
      engines: ENGINES,
      rounds: 2,
      movetimeMs: 500,
    });
  });

  it("leaves out an engine that was unticked", async () => {
    show();
    const boxes = await screen.findAllByRole("checkbox");
    fireEvent.click(boxes[2]);
    fireEvent.click(screen.getByRole("button", { name: /Turnier starten/ }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.start.mock.calls[0][0].engines).toEqual([ENGINES[0], ENGINES[1]]);
    // Eine Engine allein ist kein Turnier.
    fireEvent.click(boxes[1]);
    expect((screen.getByRole("button", { name: /Turnier starten/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the table and the games the backend reports", async () => {
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
    expect(await screen.findByText("1,5")).toBeTruthy();
    expect(screen.getByText("0,5")).toBeTruthy();
    expect(screen.getByText("Dragon – Stockfish")).toBeTruthy();
    expect(screen.getByText("Matt")).toBeTruthy();
  });

  it("offers stopping while a tournament runs", async () => {
    mocks.status.mockResolvedValue({ ...EMPTY_STATUS, running: true, white: "A", black: "B", plies: 7, total: 2 });
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Abbrechen/ }));
    expect(mocks.cancel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Turnier starten/ })).toBeNull();
  });

  it("takes the name the engine reports for itself", async () => {
    const onChange = vi.fn();
    show({ onChange });
    fireEvent.click((await screen.findAllByRole("button", { name: "Testen" }))[0]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0][0]).toEqual({ name: "Stockfish 19", path: "C:/sf.exe" });
  });
});
