/**
 * Der Turniersaal im Blatt: dieselben Angaben und Griffe wie die gewöhnliche
 * Fassung, gesetzt als Bogen aus dem Turnierbuch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import TournamentHall from "../settings/TournamentHall";
import { LocaleProvider } from "../../lib/i18n";
import { EMPTY_STATUS, type TournamentStatus } from "../../lib/tournament";

vi.mock("../../lib/diagramMode", () => ({ useDiagramMode: () => true }));
vi.mock("../../lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/settings")>()),
  getSettings: () => Promise.resolve({ locale: "de" }),
}));

const FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const FINAL = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 40";

const STATUS: TournamentStatus = {
  ...EMPTY_STATUS,
  running: true,
  played: 1,
  total: 6,
  boards: [{ board: 2, round: 1, white: "Dragon", black: "Berserk", fen: FEN, plies: 1, lastMove: "e2e4" }],
  standings: [
    { name: "Stockfish", halfPoints: 2, wins: 1, draws: 0, losses: 0 },
    { name: "Reckless", halfPoints: 0, wins: 0, draws: 0, losses: 1 },
  ],
  games: [
    { round: 1, white: "Stockfish", black: "Reckless", result: "1-0", reason: "mate", plies: 79, moves: "1. e4", fen: FINAL },
  ],
};

function show(status: TournamentStatus, handlers: Partial<Record<"onClose" | "onStop" | "onSavePgn", () => void>> = {}) {
  return render(
    <LocaleProvider>
      <TournamentHall
        status={status}
        onClose={handlers.onClose ?? (() => {})}
        onStop={handlers.onStop ?? (() => {})}
        onSavePgn={handlers.onSavePgn ?? (() => {})}
      />
    </LocaleProvider>
  );
}

beforeEach(() => localStorage.setItem("kiebitz.locale", "de"));
afterEach(cleanup);

describe("TurnierBlatt", () => {
  it("prints every live board as a diagram with its caption", async () => {
    show(STATUS);
    const hall = await screen.findByTestId("tournament-hall");
    const board = await within(hall).findByTestId("tournament-board");
    expect(board.textContent).toContain("Brett 2 · Runde 1");
    expect(board.textContent).toContain("Dragon – Berserk");
    // Schwarz ist am Zug · die Unterschrift nennt die Engine, die rechnet.
    expect(board.textContent).toContain("Berserk");
    expect(within(hall).getByText("1 von 6 Partien")).toBeTruthy();
  });

  it("sets the standings as a table and the games as rows that uncover the final position", async () => {
    show(STATUS);
    const hall = await screen.findByTestId("tournament-hall");
    await within(hall).findByTestId("tournament-board");
    // 2 Halbe sind ein Punkt, 0 bleibt 0 · in der Punktespalte der Tabelle.
    expect(within(hall).getAllByText("0").length).toBeGreaterThan(0);
    expect(within(hall).getAllByText("Stockfish").length).toBeGreaterThan(0);
    const row = within(hall).getByRole("button", { expanded: false });
    expect(row.textContent).toContain("1-0");
    expect(within(hall).queryByText("Schlussstellung")).toBeNull();
    fireEvent.click(row);
    expect(within(hall).getByText("Schlussstellung")).toBeTruthy();
    expect(within(hall).getByText("Stockfish – Reckless · 1-0")).toBeTruthy();
  });

  it("keeps stop, PGN and close as handles", async () => {
    const onStop = vi.fn();
    const onSavePgn = vi.fn();
    const onClose = vi.fn();
    show(STATUS, { onStop, onSavePgn, onClose });
    const hall = await screen.findByTestId("tournament-hall");
    fireEvent.click(await within(hall).findByRole("button", { name: "Abbrechen" }));
    fireEvent.click(within(hall).getByRole("button", { name: "Partien als PGN speichern" }));
    fireEvent.click(within(hall).getByRole("button", { name: "Schließen" }));
    expect(onStop).toHaveBeenCalled();
    expect(onSavePgn).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
