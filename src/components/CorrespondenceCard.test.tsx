/**
 * Die Fernschach-Karte · unsichtbar ohne laufende Partien, und „Analysieren"
 * reicht die Partie samt Zügen an die Analyse weiter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CorrespondenceCard from "./CorrespondenceCard";
import { LocaleProvider } from "../lib/i18n";
import type { OngoingGame } from "../lib/correspondence";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/correspondence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/correspondence")>()),
  loadOngoing: (...args: unknown[]) => mocks.load(...args),
}));
vi.mock("../lib/ext", () => ({ openExternal: vi.fn() }));

const GAME: OngoingGame = {
  source: "chess.com",
  id: "1",
  url: "https://www.chess.com/game/daily/1",
  opponent: "villain",
  opponentRating: null,
  myColor: "black",
  myTurn: true,
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  deadline: Math.floor(Date.now() / 1000) + 5 * 3600 + 120,
  variant: "standard",
  startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  sans: ["e4", "e5", "Nf3"],
};

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.load.mockReset();
});
afterEach(cleanup);

describe("CorrespondenceCard", () => {
  it("stays hidden when nothing is being played", async () => {
    mocks.load.mockResolvedValue({ games: [], errors: [] });
    const { container } = render(
      <LocaleProvider>
        <CorrespondenceCard ccUser="Torim98" liUser="" openLine={() => {}} />
      </LocaleProvider>
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("lists the games and opens one in the analysis", async () => {
    mocks.load.mockResolvedValue({ games: [GAME], errors: [] });
    const openLine = vi.fn();
    render(
      <LocaleProvider>
        <CorrespondenceCard ccUser="Torim98" liUser="" openLine={openLine} />
      </LocaleProvider>
    );
    expect(await screen.findByText("villain")).toBeTruthy();
    expect(screen.getByText("Du bist am Zug")).toBeTruthy();
    expect(screen.getByText(/noch 5 Std/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Analysieren/ }));
    expect(openLine).toHaveBeenCalledWith({ fen: GAME.startFen, sans: GAME.sans, chess960: false });
  });
});
