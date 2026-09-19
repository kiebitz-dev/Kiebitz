/**
 * Gegen die Engine spielen · was die Seite ans Backend schickt und was sie aus
 * der Antwort macht.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import Play from "./Play";

const mocks = vi.hoisted(() => ({
  playMove: vi.fn(),
  upsertGames: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/diagramMode", () => ({ useDiagramMode: () => false }));
vi.mock("../lib/session", () => ({ useTrainingSession: () => {} }));
vi.mock("../lib/play", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/play")>()),
  playMove: (...args: unknown[]) => mocks.playMove(...args),
}));
vi.mock("../lib/db", () => ({ upsertGames: (...args: unknown[]) => mocks.upsertGames(...args) }));
vi.mock("../components/Board", () => ({
  default: ({ fen, onPieceDrop }: { fen: string; onPieceDrop?: (from: string, to: string) => boolean }) => (
    <div data-testid="play-board" data-fen={fen}>
      {onPieceDrop && <button onClick={() => onPieceDrop("e2", "e4")}>drop e4</button>}
      {onPieceDrop && <button onClick={() => onPieceDrop("f2", "f3")}>drop f3</button>}
      {onPieceDrop && <button onClick={() => onPieceDrop("g2", "g4")}>drop g4</button>}
    </div>
  ),
}));

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  localStorage.removeItem("kiebitz.play");
  mocks.playMove.mockReset();
  mocks.upsertGames.mockReset().mockResolvedValue({ inserted: 1, updated: 0 });
});
afterEach(cleanup);

const fenOf = () => screen.getByTestId("play-board").dataset.fen;

describe("Play", () => {
  it("sends the moves so far and plays the engine's reply", async () => {
    mocks.playMove.mockResolvedValue({ bestmove: "e7e5", evalCp: 10, mateIn: null });
    render(<LocaleProvider><Play openAnalysis={() => {}} /></LocaleProvider>);

    fireEvent.click(screen.getAllByRole("button", { name: /Partie starten/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "drop e4" }));

    await waitFor(() => expect(fenOf()).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"));
    expect(mocks.playMove).toHaveBeenCalledWith(
      expect.objectContaining({ moves: ["e2e4"], chess960: false, elo: 1400 })
    );
  });

  it("recognises mate, and saves the game with its result", async () => {
    // Narrenmatt: 1.f3 e5 2.g4 Dh4#.
    mocks.playMove
      .mockResolvedValueOnce({ bestmove: "e7e5", evalCp: 0, mateIn: null })
      .mockResolvedValueOnce({ bestmove: "d8h4", evalCp: null, mateIn: 1 });
    render(<LocaleProvider><Play openAnalysis={() => {}} /></LocaleProvider>);

    fireEvent.click(screen.getAllByRole("button", { name: /Partie starten/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "drop f3" }));
    await waitFor(() => expect(mocks.playMove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("play-status").textContent).toMatch(/Du bist am Zug/));
    fireEvent.click(screen.getByRole("button", { name: "drop g4" }));

    await waitFor(() => expect(screen.getByTestId("play-status").textContent).toMatch(/Verloren/));
    fireEvent.click(screen.getByRole("button", { name: /In Partien speichern/ }));
    await waitFor(() => expect(mocks.upsertGames).toHaveBeenCalled());
    const [[records]] = mocks.upsertGames.mock.calls;
    expect(records[0]).toMatchObject({ moves: "f3 e5 g4 Qh4#", result: "loss", termination: "mate", color: "white" });
  });

  it("starts from a position handed in, with the side to move", async () => {
    mocks.playMove.mockResolvedValue({ bestmove: "e1g1", evalCp: 0, mateIn: null });
    const openAnalysis = vi.fn();
    render(
      <LocaleProvider>
        <Play
          initial={{ fen: "4k3/8/8/8/8/8/8/4K2R b K - 0 1", chess960: false }}
          openAnalysis={openAnalysis}
        />
      </LocaleProvider>
    );
    // Schwarz ist am Zug, also spielt man Schwarz · die Engine wartet.
    expect(fenOf()).toBe("4k3/8/8/8/8/8/8/4K2R b K - 0 1");
    expect(mocks.playMove).not.toHaveBeenCalled();
  });
});
