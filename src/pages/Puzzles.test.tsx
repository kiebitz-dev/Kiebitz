import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { fenAfter } from "../lib/position";
import Puzzles from "./Puzzles";

const mocks = vi.hoisted(() => ({
  nextPuzzle: vi.fn(),
  puzzleStats: vi.fn(),
  recordAttempt: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/puzzles", () => ({
  importLabel: () => "…",
  importPuzzles: vi.fn(),
  nextPuzzle: mocks.nextPuzzle,
  onPuzzleImportDone: vi.fn(() => Promise.resolve(vi.fn())),
  onPuzzleImportProgress: vi.fn(() => Promise.resolve(vi.fn())),
  puzzleHistory: vi.fn(() => Promise.resolve([])),
  puzzleStats: mocks.puzzleStats,
  recordAttempt: mocks.recordAttempt,
  themeLabel: (theme: string) => theme,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("../lib/changes", () => ({
  onDataChange: vi.fn(() => vi.fn()),
}));
vi.mock("../components/Board", () => ({
  default: ({ fen, draggable, onPieceDrop }: {
    fen: string;
    draggable?: boolean;
    onPieceDrop?: (from: string, to: string) => boolean;
  }) => (
    <div data-testid="puzzle-board" data-fen={fen} data-draggable={String(!!draggable)}>
      <button onClick={() => onPieceDrop?.("e2", "e4")}>play e4</button>
      {/* Ein Zug, der nicht in der Lösung steht · für den Fehlerfall. */}
      <button onClick={() => onPieceDrop?.("a2", "a3")}>play a3</button>
    </div>
  ),
}));

const initialFen = fenAfter([]);

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.puzzleStats.mockResolvedValue({
    personal_rating: 1500,
    db_total: 1,
    lichess_total: 1,
    own_total: 0,
    attempts: 0,
    solved: 0,
    today_solved: 0,
    today_attempts: 0,
    streak_days: 0,
    history: [],
    themes: [],
    importing: false,
    imported_at: null,
  });
  mocks.nextPuzzle.mockResolvedValue({
    id: "test-puzzle",
    fen: initialFen,
    moves: ["e2e4", "e7e5", "g1f3", "b8c6"],
    rating: 1500,
    themes: ["fork"],
    source: "own",
    source_game_id: 1,
    setup_plies: 0,
  });
  mocks.recordAttempt.mockResolvedValue({ rating_before: 1500, rating_after: 1508, delta: 8 });
  mocks.getSettings.mockResolvedValue({ locale: "de", puzzle_goal: 10, puzzle_hide_theme: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Puzzle training", () => {
  it("navigates through played positions with buttons and arrow keys", async () => {
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    const board = await screen.findByTestId("puzzle-board");
    await waitFor(() => expect(board.dataset.draggable).toBe("true"));
    expect(screen.getByText("0 / 0")).toBeTruthy();

    // Die automatische gegnerische Antwort bleibt angehalten, damit gezielt
    // durch genau den bereits gespielten Zug geblättert werden kann.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "play e4" }));
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    expect(screen.getByText("1 / 1")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Zur Ausgangsstellung"));
    expect(board.dataset.fen).toBe(initialFen);
    expect(board.dataset.draggable).toBe("false");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    expect(board.dataset.draggable).toBe("true");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(initialFen);
    fireEvent.click(screen.getByTitle("Zur aktuellen Stellung"));
    expect(board.dataset.fen).toBe(fenAfter(["e4"]));
  });

  it("asks for the Lichess dump even when own games already yield puzzles", async () => {
    mocks.puzzleStats.mockResolvedValue({
      personal_rating: 1500,
      db_total: 12,
      lichess_total: 0,
      own_total: 12,
      attempts: 0,
      solved: 0,
      today_solved: 0,
      today_attempts: 0,
      streak_days: 0,
      history: [],
      themes: [],
      importing: false,
      imported_at: null,
    });
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    // Eigene Aufgaben sind kein durchlaufener Import · die Einrichtung bleibt.
    await screen.findByText("Puzzle-Datenbank importieren");
    // Sie sperrt aber nicht aus, was schon da ist.
    fireEvent.click(screen.getByRole("button", { name: "Mit eigenen Aufgaben trainieren" }));
    expect(await screen.findByTestId("puzzle-board")).toBeTruthy();
  });

  it("offers the local dump file on the desktop but not on the phone", async () => {
    const emptyDb = {
      personal_rating: 1500,
      db_total: 0,
      lichess_total: 0,
      own_total: 0,
      attempts: 0,
      solved: 0,
      today_solved: 0,
      today_attempts: 0,
      streak_days: 0,
      history: [],
      themes: [],
      importing: false,
      imported_at: null,
    };
    mocks.puzzleStats.mockResolvedValue(emptyDb);

    render(<LocaleProvider><Puzzles /></LocaleProvider>);
    // Auf dem Desktop steht neben dem Download der Weg über eine lokale Datei ·
    // samt Beispielpfad der laufenden Plattform.
    await screen.findByText("Puzzle-Datenbank importieren");
    expect(screen.getByPlaceholderText("C:\\Downloads\\lichess_db_puzzle.csv.zst")).toBeTruthy();
    cleanup();

    // Auf Handybreite fällt er weg: Dort gibt es keinen Dateimanager im Blick,
    // und ein absoluter Pfad ist auf einer Bildschirmtastatur eine Zumutung.
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Puzzles />
        </ShellProvider>
      </LocaleProvider>
    );
    await screen.findByText("Puzzle-Datenbank importieren");
    expect(screen.queryByPlaceholderText(/lichess_db_puzzle/)).toBeNull();
    // Der Download-Weg bleibt · er ist auf dem Handy ohnehin der richtige.
    expect(screen.getByRole("button", { name: /Herunterladen/ })).toBeTruthy();
  });

  /**
   * Die Zeile unter dem Brett behält ihre Höhe, wenn die Meldung erscheint.
   *
   * Ohne diese Zusage wandert im Fokus-Brett das Brett darüber: Sein Vorlauf
   * ist durch den Platz begrenzt, der unter ihm bleibt, und der schrumpft,
   * sobald die Zeile wächst. Geprüft wird sie an der Bauart, weil JSDOM keine
   * Höhen kennt — alle drei Zustände müssen gleichzeitig im DOM stehen, und
   * genau einer davon sichtbar sein.
   */
  it("keeps every state of the message row in the layout", async () => {
    render(<LocaleProvider><Puzzles /></LocaleProvider>);
    // Erst wenn das Brett Züge annimmt, steht die Aufgabe wirklich · vorher
    // liefe der Fehlzug unten ins Leere und die Meldezeile bliebe offen.
    const board = await screen.findByTestId("puzzle-board");
    await waitFor(() => expect(board.dataset.draggable).toBe("true"));

    const rows = () => Array.from(document.querySelectorAll("[data-action-row]"));
    const visible = () =>
      rows()
        .filter((row) => !row.className.includes("invisible"))
        .map((row) => row.getAttribute("data-action-row"));

    // „reserve" ist die Meldung mit Rating-Zusatz · sie bleibt immer
    // unsichtbar und hält die Höhe frei, die der Zusatz später braucht.
    expect(rows().map((row) => row.getAttribute("data-action-row"))).toEqual([
      "solved",
      "wrong",
      "reserve",
      "open",
    ]);
    expect(visible()).toEqual(["open"]);

    fireEvent.click(screen.getByRole("button", { name: "play a3" }));
    await waitFor(() => expect(visible()).toEqual(["wrong"]));
    // Die anderen bleiben stehen und halten die Höhe.
    expect(rows()).toHaveLength(4);
  });

  /**
   * Hilfe kostet · dieselbe Wertung wie ein falscher Zug.
   *
   * Die Zeilen unter dem Brett stehen alle vier im Baum und halten nur die
   * Höhe frei (siehe `actionShell`); sichtbar ist immer eine. Für den Test ist
   * das gleichgültig — geprüft wird, was der Griff auslöst, nicht welche Zeile
   * ihn gerade trägt. Deshalb der erste Treffer und kein `getByRole`.
   */
  const griff = (name: string) => screen.getAllByRole("button", { name })[0];

  /** Warten, bis die Aufgabe wirklich steht · vorher ist noch nichts zu holen. */
  const bereit = async () => {
    const brett = await screen.findByTestId("puzzle-board");
    await waitFor(() => expect(brett.dataset.draggable).toBe("true"));
  };

  it("books a hint as a failed attempt, before the move that follows it", async () => {
    render(<LocaleProvider><Puzzles /></LocaleProvider>);
    await bereit();

    fireEvent.click(griff("Tipp"));
    // Der Versuch ist mit der Hilfe entschieden · gebucht wird sofort und
    // nicht erst, wenn der Zug danach kommt.
    await waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledWith("test-puzzle", false));

    fireEvent.click(griff("play e4"));
    // Der richtige Zug danach bucht nichts nach und macht aus dem Versuch
    // keinen gelösten.
    expect(mocks.recordAttempt).toHaveBeenCalledTimes(1);
    expect(mocks.recordAttempt).not.toHaveBeenCalledWith("test-puzzle", true);
  });

  it("books the revealed solution too, instead of counting nothing at all", async () => {
    render(<LocaleProvider><Puzzles /></LocaleProvider>);
    await bereit();

    fireEvent.click(griff("Lösung"));
    await waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledWith("test-puzzle", false));
  });

  it("leaves a puzzle solved without help at full value", async () => {
    // Eine Aufgabe aus einem Zug · das Brett der Testumgebung kennt nur e2e4.
    mocks.nextPuzzle.mockResolvedValue({
      id: "one-mover",
      fen: initialFen,
      moves: ["e2e4"],
      rating: 1500,
      themes: ["fork"],
      source: "own",
      source_game_id: 1,
      setup_plies: 0,
    });
    render(<LocaleProvider><Puzzles /></LocaleProvider>);
    await bereit();

    fireEvent.click(griff("play e4"));
    await waitFor(() => expect(mocks.recordAttempt).toHaveBeenCalledWith("one-mover", true));
  });

  it("keeps the theme covered until it is tapped", async () => {
    mocks.getSettings.mockResolvedValue({ locale: "de", puzzle_goal: 10, puzzle_hide_theme: true });
    mocks.nextPuzzle.mockResolvedValue({
      id: "lichess-puzzle",
      fen: initialFen,
      moves: ["e2e4"],
      rating: 1500,
      themes: ["backRankMate"],
      source: "lichess",
      source_game_id: null,
      setup_plies: 0,
    });
    render(<LocaleProvider><Puzzles /></LocaleProvider>);

    const cover = await screen.findByRole("button", { name: "Motiv verdeckt" });
    // Das Motiv steht auch als Filter-Chip auf der Seite · verdeckt ist nur die
    // Zeile über dem Brett, und die kommt beim Antippen dazu.
    expect(screen.queryAllByText("backRankMate")).toHaveLength(1);
    fireEvent.click(cover);
    await waitFor(() => expect(screen.queryAllByText("backRankMate")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Motiv verdeckt" })).toBeNull();
  });
});
