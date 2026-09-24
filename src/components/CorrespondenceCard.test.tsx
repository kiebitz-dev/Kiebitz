/**
 * Die Fernschach-Karte · unsichtbar ohne laufende Partien, jede Partie eine
 * Postkarte, die zur Plattform führt. In die Analyse führt keine: Die Partie
 * läuft noch, und die Engine daran zu setzen, wäre Schummeln.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CorrespondenceCard from "./CorrespondenceCard";
import { LocaleProvider } from "../lib/i18n";
import type { OngoingGame } from "../lib/correspondence";

const mocks = vi.hoisted(() => ({ load: vi.fn(), open: vi.fn(), diagramm: false }));
vi.mock("../lib/correspondence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/correspondence")>()),
  loadOngoing: (...args: unknown[]) => mocks.load(...args),
}));
vi.mock("../lib/ext", () => ({ openExternal: (url: string) => mocks.open(url) }));
vi.mock("../lib/diagramMode", () => ({ useDiagramMode: () => mocks.diagramm }));

const GAME: OngoingGame = {
  source: "chess.com",
  id: "1",
  url: "https://www.chess.com/game/daily/1",
  opponent: "villain",
  opponentRating: null,
  myColor: "black",
  myTurn: true,
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  moveNumber: 2,
  deadline: Math.floor(Date.now() / 1000) + 5 * 3600 + 120,
  variant: "standard",
};

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.load.mockReset();
  mocks.open.mockReset();
  mocks.diagramm = false;
});
afterEach(cleanup);

describe("CorrespondenceCard", () => {
  it("stays hidden when nothing is being played", async () => {
    mocks.load.mockResolvedValue({ games: [], errors: [] });
    const { container } = render(
      <LocaleProvider>
        <CorrespondenceCard ccUser="Torim98" liUser="" />
      </LocaleProvider>
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("shows each game as a postcard that leads to the platform, not to the analysis", async () => {
    mocks.load.mockResolvedValue({ games: [GAME], errors: [] });
    render(
      <LocaleProvider>
        <CorrespondenceCard ccUser="Torim98" liUser="" />
      </LocaleProvider>
    );
    expect(await screen.findByText("villain")).toBeTruthy();
    expect(screen.getByText("Du bist am Zug")).toBeTruthy();
    expect(screen.getByText("noch 5 Std")).toBeTruthy();
    expect(screen.getByText("Zug 2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Analysieren/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /villain/ }));
    expect(mocks.open).toHaveBeenCalledWith(GAME.url);
  });

  it("sets the games as numbered diagrams in diagram mode", async () => {
    mocks.diagramm = true;
    mocks.load.mockResolvedValue({ games: [GAME, { ...GAME, id: "2", opponent: "other", myTurn: false }], errors: [] });
    render(
      <LocaleProvider>
        <CorrespondenceCard ccUser="Torim98" liUser="" />
      </LocaleProvider>
    );
    expect(await screen.findByText("Fernpartie 1")).toBeTruthy();
    expect(screen.getByText("Fernpartie 2")).toBeTruthy();
    expect(screen.getByText("Gegner am Zug")).toBeTruthy();
    fireEvent.click(screen.getByText("other"));
    expect(mocks.open).toHaveBeenCalledWith(GAME.url);
  });
});
