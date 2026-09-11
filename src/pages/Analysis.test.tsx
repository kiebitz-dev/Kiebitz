import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { grantPlus, revokePlus } from "../test/plus";
import Analysis from "./Analysis";

const mocks = vi.hoisted(() => ({
  explorerQuery: vi.fn(),
  refdbQuery: vi.fn(),
  refdbGame: vi.fn(),
  refdbStatus: vi.fn(),
  listGames: vi.fn(),
  startAnalysis: vi.fn(),
  gameAnalysis: vi.fn(),
  setGameNote: vi.fn(),
  setGameTags: vi.fn(),
  getSettings: vi.fn(),
  chessdbQuery: vi.fn(),
  searchPosition: vi.fn(),
  engineMove: "f1c4",
  diagram: false,
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));
vi.mock("../lib/diagramMode", () => ({ useDiagramMode: () => mocks.diagram }));
vi.mock("../lib/db", () => ({
  listGameSummaries: () => mocks.listGames().then((games: typeof excludedGame[]) =>
    games.map((game) => ({ ...game, has_moves: Boolean(game.moves), has_note: Boolean(game.note) }))
  ),
  getGame: (id: number) => mocks.listGames().then((games: typeof excludedGame[]) =>
    games.find((game) => game.id === id)
  ),
  setGameNote: mocks.setGameNote,
  setGameTags: mocks.setGameTags,
}));
vi.mock("../lib/settings", () => ({
  getSettings: mocks.getSettings,
  chessdbQuery: mocks.chessdbQuery,
  explorerQuery: mocks.explorerQuery,
  refdbQuery: mocks.refdbQuery,
  refdbGame: mocks.refdbGame,
  refdbStatus: mocks.refdbStatus,
}));
vi.mock("../lib/analysis", () => ({
  cancelAnalysis: vi.fn(),
  gameAnalysis: mocks.gameAnalysis,
  onAnalysisDone: () => Promise.resolve(() => {}),
  onAnalysisGameDone: () => Promise.resolve(() => {}),
  onAnalysisProgress: () => Promise.resolve(() => {}),
  searchPosition: (...args: unknown[]) => mocks.searchPosition(...args),
  startAnalysis: mocks.startAnalysis,
}));
vi.mock("../components/Board", () => ({
  default: ({ fen, onPieceDrop, draggable, muted, mouseDrag, arrows, badges, orientation }: {
    fen: string;
    onPieceDrop?: (from: string, to: string) => boolean;
    draggable?: boolean;
    muted?: boolean;
    mouseDrag?: boolean;
    orientation?: string;
    arrows?: unknown[];
    // `label` kann ein React-Element sein (Buch-Symbol) · nicht serialisierbar.
    badges?: { square: string; color: string; title?: string }[];
  }) => (
    <div
      data-testid="analysis-board"
      data-fen={fen}
      data-orientation={orientation}
      data-draggable={String(!!draggable)}
      data-mouse-drag={String(!!mouseDrag)}
      data-muted={String(!!muted)}
      data-arrows={JSON.stringify(arrows ?? [])}
      data-badges={JSON.stringify(
        (badges ?? []).map(({ square, color, title }) => ({ square, color, title }))
      )}
    >
      {onPieceDrop && <button onClick={() => onPieceDrop("e2", "e4")}>play e4</button>}
      {onPieceDrop && <button onClick={() => onPieceDrop("e7", "e5")}>play e5</button>}
    </div>
  ),
}));
vi.mock("../components/ShareDialog", () => ({
  default: ({ subject }: { subject: Record<string, unknown> }) => (
    <div data-testid="share-subject">{JSON.stringify(subject)}</div>
  ),
}));
vi.mock("../components/LiveEngine", () => ({
  default: ({ onMove }: { onMove?: (uci: string) => void }) => (
    <div data-testid="live-engine">
      {onMove && <button onClick={() => onMove(mocks.engineMove)}>play engine move</button>}
    </div>
  ),
}));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  const Empty = () => null;
  return {
    Area: Empty,
    AreaChart: Container,
    ReferenceLine: Empty,
    ResponsiveContainer: Container,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

const excludedGame = {
  id: 7,
  source: "manual",
  source_id: "friend-game",
  url: "",
  played_at: "2026-07-20",
  played_ts: 1_784_500_000,
  time_class: "rapid",
  color: "white",
  my_name: "Dr. Tom Maurer",
  opponent: "Friend",
  opp_elo: 1400,
  my_elo: 1500,
  result: "win",
  opening: "Italian Game",
  eco: "C50",
  moves_count: 2,
  accuracy: null,
  moves: "e4 e5 Nf3 Nc6",
  note: "",
  tags: [],
  analyzed: false,
  analysis_excluded: true,
};

/** Importierte Partie mit gespeicherter Original-URL. */
const onlineGame = {
  ...excludedGame,
  id: 11,
  source: "chess.com",
  source_id: "cc-123",
  url: "https://www.chess.com/game/live/123456789",
  opponent: "Rival",
  analysis_excluded: false,
};

/** Stellung nach 1.e4 e5 2.Nf3 Nc6 · dem Zugtext aller Vorlagen hier. */
const AFTER_FIXTURE_MOVES = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R";

/**
 * Warten, bis die gewählte Partie wirklich auf dem Brett liegt.
 *
 * Die Auswahl im Ausklappmenü steht zwei Renders früher fest als die Partie:
 * erst die Kennung, dann der geladene Datensatz, dann der Sprung ans Ende der
 * Partie. Wer nur auf das Ausklappmenü wartet, prüft die Oberfläche in einem
 * der Zwischenzustände · dort gibt es weder Züge noch Notizen noch eine
 * Schlussstellung. Die Schlussstellung ist deshalb das verlässliche Zeichen:
 * Sie steht erst, wenn alle drei Schritte durch sind.
 */
async function gameOnBoard(value: string) {
  await waitFor(() =>
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(value)
  );
  await waitFor(() =>
    expect(screen.getAllByTestId("analysis-board")[0].dataset.fen).toContain(AFTER_FIXTURE_MOVES)
  );
}

beforeEach(() => {
  // Die Oberfläche startet ab Werk auf Englisch; diese Tests prüfen die
  // deutschen Texte und stellen die Sprache deshalb explizit ein.
  localStorage.setItem("kiebitz.locale", "de");
  // Das Eröffnungsbuch merkt sich die zuletzt gewählte Quelle · ohne das
  // Zurücksetzen begänne der nächste Test bei der Quelle des vorherigen.
  localStorage.setItem("kiebitz.book.source", "masters");
  mocks.getSettings.mockResolvedValue({ locale: "de", chessdb_enabled: false, cc_user: "Torim98", li_user: "Torim98" });
  // Das Eröffnungsbuch fragt beim Öffnen den Bestand der Referenzdatenbank ab
  // und, sobald eine Quelle freigeschaltet ist, die Häufigkeiten der Stellung.
  mocks.refdbStatus.mockResolvedValue({
    games: 0,
    positions: 0,
    size_bytes: 0,
    source: "",
    imported_at: 0,
    importing: false,
    path: "",
  });
  mocks.chessdbQuery.mockResolvedValue({ status: "unknown", moves: [], cached: false });
  mocks.searchPosition.mockResolvedValue({ total_games: 0, next_moves: [], sample: [] });
  mocks.explorerQuery.mockResolvedValue({
    source: "masters",
    status: "unknown",
    white: 0,
    draws: 0,
    black: 0,
    moves: [],
    top_games: [],
    opening: null,
    cached: false,
  });
  mocks.refdbQuery.mockResolvedValue({
    source: "own",
    status: "unknown",
    white: 0,
    draws: 0,
    black: 0,
    moves: [],
    top_games: [],
    opening: null,
    cached: true,
  });
  mocks.listGames.mockResolvedValue([excludedGame]);
  mocks.gameAnalysis.mockResolvedValue([]);
  mocks.startAnalysis.mockResolvedValue(undefined);
  mocks.setGameNote.mockResolvedValue(undefined);
  mocks.setGameTags.mockImplementation((_id: number, tags: string[]) => Promise.resolve(tags));
  mocks.engineMove = "f1c4";
  mocks.diagram = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Eine im Test erteilte Berechtigung ist ein Modul-Singleton · ohne das
  // Zurücksetzen liefe der nächste Test unbemerkt mit Plus weiter.
  revokePlus();
});

/**
 * Eine gerechnete Zeile zu „2.Nf3" der Vorlagepartie · der Zug, den auch die
 * Engine wählt. `judgment` bleibt leer: Die Auto-Analyse vergibt nur Mängel,
 * alles Übrige leitet die Seite aus Bewertung und Empfehlung ab.
 */
const bestMoveRows = [
  { ply: 1, san: "e4", eval_cp: 20, mate_in: null, best_uci: "e2e4", judgment: "", phase: "opening" },
  { ply: 2, san: "e5", eval_cp: 20, mate_in: null, best_uci: "e7e5", judgment: "", phase: "opening" },
  {
    ply: 3,
    san: "Nf3",
    eval_cp: 20,
    mate_in: null,
    best_uci: "g1f3",
    judgment: "",
    phase: "opening",
    motif: "best_move",
    motif_detail: JSON.stringify({ san: "Nf3" }),
    pv: ["Nf3", "Nc6", "Bc4"],
  },
  { ply: 4, san: "Nc6", eval_cp: 20, mate_in: null, best_uci: "b8c6", judgment: "", phase: "opening" },
];

describe("Analysis page", () => {
  it("opens a playable new game when entered without a target", async () => {
    render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

    expect(await screen.findByText(/Neue Partie · Ziehe für beide Seiten/)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "play e4" }));
    expect(await screen.findByRole("button", { name: "e4" })).toBeTruthy();
  });

  it("allows an explicitly opened excluded game to run Stockfish analysis", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await gameOnBoard("7");
    fireEvent.click(screen.getByRole("button", { name: "Analysieren" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Diese Partie analysieren" }));
    expect(mocks.startAnalysis).toHaveBeenCalledWith({ gameIds: [7] });
  });

  /**
   * Derselbe Wortlaut in beiden Modi · siehe docs/EXPLANATIONS.md.
   *
   * Zu einem gutgeheißenen Zug stand auf dem Dashboard bis 1.4 die ganze
   * Anmerkung („Buchzug. Nf3 trifft die Hauptvariante. Die Engine rechnet
   * weiter mit …"), im Diagramm-Modus nur der Satz aus der Analyse. Zwei
   * Fassungen desselben Satzes sind keine zwei Modi.
   */
  it("writes the analysis sentence and nothing more under an approved move", async () => {
    mocks.gameAnalysis.mockResolvedValue(bestMoveRows);
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await gameOnBoard("7");
    fireEvent.click(await screen.findByRole("button", { name: /^Nf3/ }));

    const satz = await screen.findByText(/Hauptvariante|Engine wählt/);
    // Der Satz selbst · in englischem SAN, wie überall in der App.
    expect(satz.textContent).toContain("Nf3");
    // Und nichts davor und dahinter: weder das Urteil als Wort noch die
    // Fortsetzung, die der Diagramm-Modus an dieser Stelle auch nicht zeigt.
    expect(satz.textContent).not.toContain("Buchzug");
    expect(satz.textContent).not.toContain("Die Engine rechnet weiter mit");
  });

  describe("navigation", () => {
    /** Zwei Partien in der Liste · nur so gibt es ein „weiter". */
    const twoGames = [excludedGame, onlineGame];

    it("steps to the next game without opening the picker", async () => {
      mocks.listGames.mockResolvedValue(twoGames);
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");

      fireEvent.click(screen.getByRole("button", { name: "Nächste Partie" }));
      await gameOnBoard("11");

      // Am Ende der Liste hört das Blättern auf, statt umzulaufen.
      expect((screen.getByRole("button", { name: "Nächste Partie" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Vorherige Partie" }));
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));
    });

    it("turns the board around and back", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");
      // Die Partie wurde als Weiß gespielt · so beginnt auch das Brett.
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("white");

      fireEvent.click(screen.getByRole("button", { name: "Brett drehen" }));
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("black");
      // Die Namen tauschen mit: oben steht jetzt, wer unten stand.
      expect(screen.getByText("Dr. Tom Maurer (1500)")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Brett drehen" }));
      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("white");
    });

    /**
     * Der Grund für den Wächter in der Tastatur-Navigation: Ein Pfeil im
     * Notizfeld gehört dem Cursor, nicht dem Brett.
     */
    it("leaves the arrow keys to the notes field while it has the focus", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");
      const atEnd = screen.getByTestId("analysis-board").dataset.fen;

      fireEvent.keyDown(screen.getByPlaceholderText(/Gedanken zur Partie/), { key: "ArrowLeft" });
      expect(screen.getByTestId("analysis-board").dataset.fen).toBe(atEnd);

      // Außerhalb eines Eingabefelds blättert derselbe Tastendruck weiter.
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(screen.getByTestId("analysis-board").dataset.fen).not.toBe(atEnd);
      fireEvent.keyDown(document.body, { key: "End" });
      expect(screen.getByTestId("analysis-board").dataset.fen).toBe(atEnd);
    });

    /**
     * Das Fokus-Brett zeigt dieselbe Stellung ohne Zugliste, Kurve und
     * Engine-Panel · dieselben Namen, dieselbe Bedienung.
     */
    it("opens the same position as a focus board and closes it again", async () => {
      // Das Fokus-Brett gehört zu Kiebitz Plus · hier geht es um die Ansicht,
      // nicht um das Gate davor. Das prüft components/FocusBoard.test.tsx.
      grantPlus();
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");
      expect(screen.getAllByTestId("analysis-board")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "Fokus-Brett öffnen" }));

      const focus = screen.getByTestId("focus-board");
      expect(focus.getAttribute("aria-label")).toBe("Analyse");
      // Zwei Bretter: das der Seite dahinter und das im Fokus · beide zeigen
      // dieselbe Stellung.
      const boards = screen.getAllByTestId("analysis-board");
      expect(boards).toHaveLength(2);
      expect(boards[1].dataset.fen).toBe(boards[0].dataset.fen);
      expect(within(focus).getByText("Dr. Tom Maurer (1500)")).toBeTruthy();
      // Im Fokus fehlt der Griff zum Fokus · dort ist man schon.
      expect(within(focus).queryByRole("button", { name: "Fokus-Brett öffnen" })).toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("focus-board")).toBeNull();
      expect(screen.getAllByTestId("analysis-board")).toHaveLength(1);
    });

    /**
     * Beide Läufe stehen in einem Knopf · in der Leiste soll genau eine
     * Schaltfläche laut sein.
     */
    it("keeps both analysis runs in one menu behind a single button", async () => {
      mocks.listGames.mockResolvedValue(twoGames);
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");

      // Zugeklappt ist die Leiste eine Zeile mit einem Hauptknopf.
      expect(screen.queryByRole("menuitem", { name: /Alle analysieren/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Diese Partie analysieren" })).toBeNull();

      const trigger = screen.getByRole("button", { name: "Analysieren" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);

      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("menuitem", { name: /Diese Partie analysieren/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Alle analysieren/ })).toBeTruthy();
      // Die Zehnerportion ist fort · anhalten kann man den Lauf jederzeit.
      expect(screen.queryByRole("menuitem", { name: /Nächste 10/ })).toBeNull();
    });

    /**
     * Auf dem Telefon nimmt derselbe Knopf die ganze Zeile.
     *
     * „Diese Partie analysieren" neben „Mehrere Partien" passt auf 360 px
     * nicht in eine Zeile; untereinander gestellt hatte die Leiste zwei
     * Hauptknöpfe übereinander. Ein Knopf, zwei Wege darin.
     */
    it("merges both analysis controls into one button on the phone", async () => {
      mocks.listGames.mockResolvedValue(twoGames);
      render(
        <ShellProvider mobile>
          <LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>
        </ShellProvider>
      );
      await gameOnBoard("7");

      expect(screen.queryByRole("button", { name: "Diese Partie analysieren" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Mehrere Partien" })).toBeNull();

      const trigger = screen.getByRole("button", { name: "Analysieren" });
      fireEvent.click(trigger);
      expect(screen.getByRole("menuitem", { name: /Diese Partie analysieren/ })).toBeTruthy();
      expect(screen.getByRole("menuitem", { name: /Alle analysieren/ })).toBeTruthy();
    });

    /**
     * Auf Handybreite ist für acht Tasten und die Bewertung kein Platz. Die
     * Leiste bleibt trotzdem einzeilig und vollständig sichtbar: Blättern
     * steht da, alles Seltenere klappt darüber auf.
     */
    it("folds the rare board actions into a menu on the phone", async () => {
      grantPlus();
      render(
        <ShellProvider mobile>
          <LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>
        </ShellProvider>
      );
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("7"));

      // Blättern bleibt in der Leiste, das Seltenere ist zugeklappt.
      expect(screen.getByRole("button", { name: "An den Anfang" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Brett drehen" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Weitere Brettaktionen" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Brett drehen" }));

      expect(screen.getByTestId("analysis-board").dataset.orientation).toBe("black");
    });

    /**
     * Die Partiezeile ist für ein Telefon zu lang · als eine Zeile brach sie
     * um, während Herkunftslink und Ergebnis an ihrer Unterkante klebten.
     * Mobil steht die geladene Partie deshalb als eigene kleine Karte:
     * Ergebnis und Paarung oben, alles Weitere darunter.
     */
    it("puts the loaded game into its own header card on the phone", async () => {
      mocks.listGames.mockResolvedValue([onlineGame]);
      render(
        <ShellProvider mobile>
          <LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>
        </ShellProvider>
      );
      await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("11"));

      const header = await screen.findByText(/Dr\. Tom Maurer vs\. Rival/);
      const card = header.closest("header");
      expect(card).toBeTruthy();
      // Ergebnis, Herkunft und die Merkmale der Partie stehen in derselben
      // Karte · nicht mehr an der Unterkante eines umgebrochenen Absatzes.
      expect(card?.textContent).toContain("Sieg");
      expect(card?.textContent).toContain("Italian Game");
      expect(card?.textContent).toContain("2026-07-20");
      expect(within(card as HTMLElement).getByRole("link", { name: /Original/ })).toBeTruthy();
    });
  });

  it("lets desktop users branch from a played move with drag and drop", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await gameOnBoard("7");
    expect(screen.getByTestId("analysis-board").dataset.draggable).toBe("true");
    expect(screen.getByTestId("analysis-board").dataset.mouseDrag).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "e4" }));
    fireEvent.click(screen.getByRole("button", { name: "play e5" }));

    expect(await screen.findByText(/Variante ab Zug 1/)).toBeTruthy();
    expect(screen.getByTestId("analysis-board").dataset.muted).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Partie" }));
    expect(screen.getByTestId("analysis-board").dataset.muted).toBe("false");
  });

  it("shares the position together with the moves that led to it", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await gameOnBoard("7");
    // Zwei Halbzüge zurück: geteilt wird, was auf dem Brett steht.
    fireEvent.click(screen.getByRole("button", { name: "e5" }));
    fireEvent.click(screen.getByTitle("Stellung teilen"));

    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.kind).toBe("analysis");
    expect(subject.history).toBe("1.e4 e5");
  });

  it("shows the notation a shared link brings and keeps counting from there", async () => {
    const shared = {
      kind: "analysis" as const,
      // Nach 1.e4 · Schwarz ist am Zug.
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
      orientation: "white" as const,
      history: "1.e4",
    };
    render(<LocaleProvider><Analysis targetGameId={null} shared={shared} /></LocaleProvider>);

    expect(await screen.findByText("1.e4")).toBeTruthy();

    // Der eigene Anbau zählt weiter, statt wieder bei eins anzufangen · der
    // erste Zug ist ein schwarzer und trägt deshalb gar keine eigene Nummer.
    fireEvent.click(screen.getByRole("button", { name: "play e5" }));
    expect(await screen.findByRole("button", { name: "e5" })).toBeTruthy();
    expect(screen.queryByText("1.")).toBeNull();

    fireEvent.click(screen.getByTitle("Stellung teilen"));
    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.history).toBe("1.e4 e5");
  });

  it("shows database player names with parenthesized ratings and previews the next move", async () => {
    mocks.listGames.mockResolvedValue([{ ...excludedGame, moves: "e4 e5 Nf3 Nc6 Bc4" }]);
    mocks.gameAnalysis.mockResolvedValue([
      { ply: 1, san: "e4", eval_cp: 20, mate_in: null, best_uci: "e2e4", judgment: "book", phase: "opening" },
      { ply: 2, san: "e5", eval_cp: 80, mate_in: null, best_uci: "c7c5", judgment: "inaccuracy", phase: "opening" },
      { ply: 3, san: "Nf3", eval_cp: 70, mate_in: null, best_uci: "g1f3", judgment: "best", phase: "opening" },
      { ply: 4, san: "Nc6", eval_cp: 160, mate_in: null, best_uci: "g8f6", judgment: "blunder", phase: "opening" },
      { ply: 5, san: "Bc4", eval_cp: 150, mate_in: null, best_uci: "f1c4", judgment: "excellent", phase: "opening" },
    ]);
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    expect(await screen.findByText("Dr. Tom Maurer (1500)")).toBeTruthy();
    expect(screen.getByText("Friend (1400)")).toBeTruthy();
    expect(screen.getByText(/Dr\. Tom Maurer vs\. Friend · Rapid · Italian Game/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "e4" }));

    const board = screen.getByTestId("analysis-board");
    // Buchzüge tragen ein Symbol statt eines Kürzels · der Titel bleibt lesbar.
    expect(board.dataset.badges).toContain("Buchzug");
    expect(board.dataset.arrows).toContain("c7");
    expect(board.dataset.arrows).toContain("e7");
    expect(screen.getByRole("button", { name: "e4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /e5\s*\?!/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nf3" })).toBeTruthy();
    // Exzellente Züge werden in der Zugliste jetzt ebenfalls markiert.
    expect(screen.getByRole("button", { name: /Bc4\s*✓/ })).toBeTruthy();
  });

  it("plays a clicked engine move on the analysis board", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

    await gameOnBoard("7");
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));

    expect(await screen.findByText(/Variante ab Zug 3/)).toBeTruthy();
    expect(screen.getByTestId("analysis-board").dataset.fen).toContain("b KQkq");
    expect(screen.getByText(/Bc4/)).toBeTruthy();
  });

  it("shows overall and phase accuracy for both players in the same cells", async () => {
    mocks.listGames.mockResolvedValue([{
      ...excludedGame,
      analyzed: true,
      accuracy: 88.4,
      accuracy_opening: 91.2,
      accuracy_middlegame: 84.5,
      accuracy_endgame: 89.7,
      opponent_accuracy: 76.3,
      opponent_accuracy_opening: 82.1,
      opponent_accuracy_middlegame: 70.4,
      opponent_accuracy_endgame: 75.8,
    }]);
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
    await gameOnBoard("7");

    const overall = screen.getByRole("group", { name: "Gesamt · Partie" });
    expect(within(overall).getByText("88,4 %")).toBeTruthy();
    expect(within(overall).getByText("76,3 %")).toBeTruthy();
    expect(within(overall).getByTitle("Dr. Tom Maurer")).toBeTruthy();
    expect(within(overall).getByTitle("Friend")).toBeTruthy();

    const opening = screen.getByRole("group", { name: "Eröffnung" });
    expect(within(opening).getByText("91,2 %")).toBeTruthy();
    expect(within(opening).getByText("82,1 %")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Mittelspiel" })).getByText("70,4 %")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Endspiel" })).getByText("75,8 %")).toBeTruthy();
  });

  it("saves notes and tags of the selected game from the analysis panel", async () => {
    render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
    await gameOnBoard("7");

    fireEvent.change(screen.getByPlaceholderText("Tag eingeben …"), { target: { value: "Eröffnung" } });
    fireEvent.click(screen.getByRole("button", { name: /Hinzufügen/ }));
    await waitFor(() => expect(mocks.setGameTags).toHaveBeenCalledWith(7, ["Eröffnung"]));

    fireEvent.change(screen.getByPlaceholderText(/Gedanken zur Partie/), {
      target: { value: "Zu passiv gespielt." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Notiz speichern/ }));
    await waitFor(() => expect(mocks.setGameNote).toHaveBeenCalledWith(7, "Zu passiv gespielt."));
  });

  describe("clocks", () => {
    /** Restzeiten nach je vier Halbzügen · 10 Minuten ohne Zuschlag. */
    const timedGame = {
      ...excludedGame,
      id: 21,
      clocks: "59500 59300 58800 58100",
      time_control: "600",
    };

    it("shows both clocks and the time control once a game brings them", async () => {
      mocks.listGames.mockResolvedValue([timedGame]);
      render(<LocaleProvider><Analysis targetGameId={21} /></LocaleProvider>);
      await gameOnBoard("21");

      // Am Ende der Partie: Weiß 588,00 s, Schwarz 581,00 s.
      expect(await screen.findByText("9:48")).toBeTruthy();
      expect(screen.getByText("9:41")).toBeTruthy();
      // Die Bedenkzeit-Vorgabe steht in der Kopfzeile hinter der Zeitklasse.
      expect(screen.getByText(/Rapid 10 ·/)).toBeTruthy();
    });

    it("follows the move list backwards", async () => {
      mocks.listGames.mockResolvedValue([timedGame]);
      render(<LocaleProvider><Analysis targetGameId={21} /></LocaleProvider>);
      await gameOnBoard("21");
      await screen.findByText("9:48");

      // Zurück auf Halbzug 2: Weiß 595,00 s, Schwarz 593,00 s.
      fireEvent.click(await screen.findByRole("button", { name: "e5" }));
      expect(await screen.findByText("9:55")).toBeTruthy();
      expect(screen.getByText("9:53")).toBeTruthy();
    });

    it("shows nothing at all when a game has no clock data", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");

      expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
    });
  });

  /**
   * Das Eröffnungsbuch beantwortet drei verschiedene Fragen an derselben
   * Stelle: was Starke spielen, was die Masse spielt, was in der eigenen
   * Sammlung steht. ChessDB bleibt daneben stehen · es sagt etwas über die
   * Stellung, nicht über die Spieler.
   */
  describe("opening book", () => {
    const mastersAnswer = {
      source: "masters",
      status: "ok",
      white: 900,
      draws: 600,
      black: 500,
      moves: [
        { uci: "g1f3", san: "Nf3", white: 500, draws: 300, black: 200, average_rating: 2412 },
        { uci: "b1c3", san: "Nc3", white: 200, draws: 100, black: 150, average_rating: 2388 },
      ],
      top_games: [
        {
          id: "abc12345",
          white: "Kasparov, G.",
          black: "Karpov, A.",
          white_elo: 2820,
          black_elo: 2745,
          winner: "white",
          year: 1997,
          month: "1997-05",
        },
      ],
      opening: "Italienisch",
      cached: false,
    };

    /**
     * Der erste Blick in die Analyse darf keine Fehlermeldung sein.
     *
     * Meisterpartien und Online-Bestand hängen beide an einem Lichess-Token,
     * den zu Anfang niemand hat · stand die Karte dort, las man als Erstes die
     * Aufforderung, erst einmal einen anzulegen. ChessDB braucht keinen und
     * antwortet sofort, deshalb steht sie vorn, bis jemand etwas anderes wählt.
     */
    it("opens on the engine tab until a source has been chosen", async () => {
      grantPlus();
      localStorage.removeItem("kiebitz.book.source");
      mocks.getSettings.mockResolvedValue({ locale: "de", chessdb_enabled: true });
      mocks.explorerQuery.mockResolvedValue(mastersAnswer);
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      const engine = await screen.findByRole("button", { name: "Engine" }, { timeout: 3000 });
      expect(engine.getAttribute("aria-pressed")).toBe("true");
      // Kein Reiter fragt ungefragt · und der Explorer wird gar nicht erst
      // angesprochen, solange niemand auf ihn geklickt hat.
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(mocks.explorerQuery).not.toHaveBeenCalled();

      // Ein Klick genügt, und ab dann merkt sich das Gerät die Wahl.
      fireEvent.click(screen.getByRole("button", { name: "Meister" }));
      await waitFor(() => expect(mocks.explorerQuery).toHaveBeenCalled());
      expect(localStorage.getItem("kiebitz.book.source")).toBe("masters");
    });

    /** Ohne ChessDB gibt es den Reiter nicht · dann greift die alte Quelle. */
    it("falls back to the masters tab when ChessDB is switched off", async () => {
      grantPlus();
      localStorage.removeItem("kiebitz.book.source");
      mocks.explorerQuery.mockResolvedValue(mastersAnswer);
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      const masters = await screen.findByRole("button", { name: "Meister" }, { timeout: 3000 });
      await waitFor(() => expect(masters.getAttribute("aria-pressed")).toBe("true"));
      expect(screen.queryByRole("button", { name: "Engine" })).toBeNull();
    });

    /**
     * Milliarden passen nicht in eine Spalte, neben der noch der Elo-Schnitt
     * steht · sie werden gerundet und stehen genau nur noch im Tooltip.
     */
    it("shortens counts that would run over the column", async () => {
      grantPlus();
      mocks.explorerQuery.mockResolvedValue({
        ...mastersAnswer,
        white: 4_000_000_000,
        draws: 2_000_000_000,
        black: 1_826_583_724,
        moves: [
          { uci: "e2e4", san: "e4", white: 2_400_000_000, draws: 1_100_000_000, black: 1_081_682_673, average_rating: 1605 },
        ],
      });
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      const move = await screen.findByTitle("e4 aufs Brett legen", {}, { timeout: 3000 });
      const count = within(move).getByTitle("4.581.682.673");
      expect(count.textContent?.replace(/ /g, " ")).toBe("4,6 Mrd.");
      // Der Elo-Schnitt steht danach unangetastet daneben.
      expect(move.textContent).toContain("1605");
    });

    /**
     * Ein Zug ist ein Zug · aus dem Buch, aus der Engine-Linie und aus den
     * eigenen Partien führt derselbe Klick aufs Brett.
     */
    it("plays a move from the own games on the board", async () => {
      mocks.searchPosition.mockResolvedValue({
        total_games: 12,
        next_moves: [{ san: "Nf3", games: 7, score_pct: 57 }],
        sample: [],
      });
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      // Denselben Titel trägt die Zeile im Eröffnungsbuch · gesucht wird in
      // der Karte, um die es hier geht.
      const card = (await screen.findByRole("heading", { name: "Diese Stellung in deinen Partien" }))
        .closest("section")!;
      const move = await within(card).findByTitle("Nf3 aufs Brett legen", {}, { timeout: 3000 });
      expect(move.textContent).toContain("7×");
      fireEvent.click(move);
      await waitFor(() =>
        expect(screen.getByTestId("analysis-board").dataset.fen).toContain(
          "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R"
        )
      );
    });

    it("shows master frequencies and plays a clicked move on the board", async () => {
      grantPlus();
      mocks.explorerQuery.mockResolvedValue(mastersAnswer);
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      // Die Zeile trägt Zug, Partienzahl und Elo-Schnitt · der Balken daneben
      // ist die Bilanz und hat keinen Text.
      const move = await screen.findByTitle("Nf3 aufs Brett legen", {}, { timeout: 3000 });
      expect(move.textContent).toContain("1.000");
      expect(move.textContent).toContain("2412");
      expect(screen.getByText(/Kasparov/)).toBeTruthy();

      // Ein Klick spielt den Zug · das freie Brett steht danach eine Stellung
      // weiter, ohne dass jemand ein Feld anfassen musste.
      fireEvent.click(move);
      await waitFor(() =>
        expect(screen.getByTestId("analysis-board").dataset.fen).toContain(
          "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R"
        )
      );
    });

    /**
     * Gesperrt wird nicht gefragt. Eine Netzanfrage für eine Funktion, die
     * nicht freigeschaltet ist, wäre verschwendet · und die Vorschau soll die
     * Form zeigen, nicht die Zahlen.
     */
    it("asks nothing at all while the explorer is locked", async () => {
      mocks.explorerQuery.mockResolvedValue(mastersAnswer);
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      await screen.findByRole("button", { name: "Meister" });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(mocks.explorerQuery).not.toHaveBeenCalled();
      expect(screen.getByText("Mit Plus")).toBeTruthy();
    });

    it("reads the own reference database from its own source", async () => {
      grantPlus();
      mocks.refdbStatus.mockResolvedValue({
        games: 4_700_000,
        positions: 12_000_000,
        size_bytes: 1_000,
        source: "caissabase.pgn",
        imported_at: 1_780_000_000,
        importing: false,
        path: "reference.sqlite",
      });
      mocks.refdbQuery.mockResolvedValue({
        ...mastersAnswer,
        source: "own",
        top_games: [
          {
            id: "42",
            white: "Fischer, R.",
            black: "Spassky, B.",
            white_elo: 2785,
            black_elo: 2660,
            winner: "black",
            year: 1972,
            month: null,
          },
        ],
      });
      mocks.refdbGame.mockResolvedValue({
        id: 42,
        white: "Fischer, R.",
        black: "Spassky, B.",
        white_elo: 2785,
        black_elo: 2660,
        result: "0-1",
        played_at: "1972.07.11",
        event: "World Championship",
        eco: "E56",
        moves: "c4 e6 Nf3 d5",
      });
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      fireEvent.click(await screen.findByRole("button", { name: "Meine Datenbank" }));
      const game = await screen.findByRole("button", { name: /Fischer/ }, { timeout: 3000 });
      expect(mocks.refdbQuery).toHaveBeenCalled();

      // Eine Musterpartie der eigenen Sammlung kommt aufs Brett · als freies
      // Brett, nicht als eigene Partie.
      fireEvent.click(game);
      await waitFor(() => expect(screen.getByText(/Fischer, R\. \(2785\)/)).toBeTruthy());
      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: "c4" }).length).toBeGreaterThan(0)
      );
    });
  });

  describe("link to the original game", () => {
    const originLink = () => screen.queryByRole("link", { name: /Original/ });

    it("uses the stored game URL", async () => {
      mocks.listGames.mockResolvedValue([onlineGame]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await gameOnBoard("11");

      await waitFor(() => expect(originLink()).toBeTruthy());
      expect(originLink()?.getAttribute("href")).toBe("https://www.chess.com/game/live/123456789");
    });

    it("falls back to the account archive when the game has no URL", async () => {
      mocks.listGames.mockResolvedValue([{ ...onlineGame, source: "lichess", url: "" }]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await gameOnBoard("11");

      await waitFor(() =>
        expect(originLink()?.getAttribute("href")).toBe("https://lichess.org/@/Torim98/all")
      );
    });

    /** Eine Archiv-URL ohne Benutzernamen wäre ein Link ins Leere. */
    it("omits the link when neither a URL nor an account handle is known", async () => {
      mocks.getSettings.mockResolvedValue({ locale: "de", chessdb_enabled: false, cc_user: "", li_user: "" });
      mocks.listGames.mockResolvedValue([{ ...onlineGame, url: "" }]);
      render(<LocaleProvider><Analysis targetGameId={11} /></LocaleProvider>);
      await gameOnBoard("11");

      expect(originLink()).toBeNull();
    });

    it("omits the link for manually recorded games", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);
      await gameOnBoard("7");

      expect(originLink()).toBeNull();
    });
  });
  /**
   * Der Diagramm-Modus auf diesem Tab.
   *
   * Geprüft wird die Stelle, an der die Hülle sonst auseinanderfiele: Wer über
   * das Register auf „Analyse" geht, hat noch keine Partie gewählt. Auch
   * dieser Zustand ist eine Buchseite — und er behält die Laufleiste, sonst
   * käme man von hier zu keiner Partie mehr.
   */
  describe("diagram mode", () => {
    beforeEach(() => {
      mocks.diagram = true;
    });

    it("sets the free board as a page of the book and keeps the game picker", async () => {
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);

      // Der Kolumnentitel · daran hängt, dass überhaupt das Blatt dasteht.
      expect(await screen.findByText("Kiebitz · Analyse")).toBeTruthy();
      // Ohne Zug steht der Hinweis statt einer erfundenen Partie.
      expect(screen.getByText(/Noch kein Zug/)).toBeTruthy();
      // Die Laufleiste bleibt, und sie steht im Formularsatz.
      const picker = screen.getByRole("combobox") as HTMLSelectElement;
      expect(picker.value).toBe("");
      expect(picker.closest("[data-tour='analysis-run']")?.className).toContain("blatt-formular");
      // Am freien Brett trägt die Engine die rechte Spalte.
      expect(screen.getByTestId("live-engine")).toBeTruthy();
    });

    it("writes no demo annotation onto a move played on the free board", async () => {
      render(<LocaleProvider><Analysis targetGameId={null} /></LocaleProvider>);
      await screen.findByText("Kiebitz · Analyse");

      fireEvent.click(screen.getByRole("button", { name: "play e4" }));

      expect(await screen.findByRole("button", { name: "1.e4" })).toBeTruthy();
      expect(screen.queryByText(/Zu passiv/)).toBeNull();
    });

    it("keeps the commented game on a chosen game", async () => {
      render(<LocaleProvider><Analysis targetGameId={7} /></LocaleProvider>);

      await screen.findByText("Kiebitz · Analyse");
      // Mit Partie steht der Ergebniskasten da · das freie Brett hat keinen.
      expect(await screen.findByText("1 : 0")).toBeTruthy();
      // Und die Engine rechnet auch hier mit · sie steht dann im Apparat und
      // nicht in der rechten Spalte. Bis 1.3 fehlte sie mit Partie ganz, und
      // damit kostete der Modus eine Funktion.
      expect(screen.getByTestId("live-engine")).toBeTruthy();
    });
  });
});
