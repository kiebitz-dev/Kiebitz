import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { ShellProvider } from "../components/MobileShell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Games from "./Games";
import { emitDataChange } from "../lib/changes";

const { invokeMock, fetchAllMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  fetchAllMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../lib/importer", () => ({ fetchAll: fetchAllMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../components/Board", () => ({ default: () => <div data-testid="board" /> }));

const game = {
  id: 1,
  source: "lichess",
  source_id: "test-game",
  url: "https://lichess.org/test-game",
  played_at: "2026-07-15",
  played_ts: 1_784_067_200,
  time_class: "rapid",
  color: "white",
  my_name: "Tom",
  opponent: "Testgegner",
  opp_elo: 1450,
  my_elo: 1500,
  result: "win",
  opening: "Italian Game",
  eco: "C50",
  moves_count: 12,
  accuracy: 83.4,
  accuracy_opening: 90,
  accuracy_middlegame: 80,
  accuracy_endgame: null,
  moves: "e4 e5 Nf3 Nc6",
  note: "",
  tags: [],
  analyzed: true,
};
let listedGame: typeof game & { analysis_excluded?: boolean } = { ...game };
let gameDetail: Promise<typeof listedGame> | null = null;
let deleted = false;

beforeEach(() => {
  localStorage.clear();
  emitDataChange();
  listedGame = { ...game };
  gameDetail = null;
  deleted = false;
  invokeMock.mockReset();
  fetchAllMock.mockReset();
  vi.mocked(openDialog).mockReset();
  invokeMock.mockImplementation((command: string) => {
    if (command === "app_info") {
      return Promise.resolve({ version: "0.5.0", backend: "tauri", platform: "windows" });
    }
    if (command === "get_settings") {
      return Promise.resolve({
        locale: "de",
        cc_user: "Tom",
        li_user: "Tom",
        display_name: "Tom",
        import_months: 3,
      });
    }
    if (command === "list_games_page") return Promise.resolve({
      items: deleted ? [] : [{
        ...listedGame,
        moves: undefined,
        note: undefined,
        source_id: undefined,
        has_moves: true,
        has_note: Boolean(listedGame.note),
      }],
      total: deleted ? 0 : 1,
      library_total: deleted ? 0 : 1,
    });
    if (command === "game_detail") return gameDetail ?? Promise.resolve(listedGame);
    if (command === "list_games_for_export") return Promise.resolve(deleted ? [] : [listedGame]);
    if (command === "delete_game") { deleted = true; return Promise.resolve(true); }
    if (command === "read_pgn_file") return Promise.resolve(`[Event "Friend"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 1-0`);
    if (command === "upsert_games") return Promise.resolve({ inserted: 3, total: 4 });
    if (command === "index_positions") return Promise.resolve(undefined);
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  // Ein geschlossenes Detailblatt räumt seinen History-Eintrag verzögert ab
  // (MobileSheet). Ohne dieses Auslaufen träfe das popstate erst den nächsten
  // Test und schlösse dort das Blatt, das er gerade geöffnet hat.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.history.replaceState(null, "");
});

describe("Games page", () => {
  it("loads only a paginated summary and the selected detail", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });

    expect(invokeMock).toHaveBeenCalledWith("list_games_page", {
      request: expect.objectContaining({ offset: 0, limit: 10 }),
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("game_detail", { id: 1 }));
    expect(invokeMock).not.toHaveBeenCalledWith("list_games_for_export");
  });

  it("shows both ratings in the preview without captured pieces", async () => {
    listedGame = {
      ...game,
      my_name: "PartieTom",
      moves: "e4 d5 exd5 Qxd5",
    };

    const { container } = render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);

    expect(await screen.findByText("Testgegner (1450)")).toBeTruthy();
    expect(await screen.findByText("PartieTom (1500)")).toBeTruthy();
    expect(container.querySelector("[data-captured]")).toBeNull();
  });

  it("shows a note once the selected game detail finishes loading", async () => {
    listedGame = { ...game, note: "Review the missed tactic on move 18." };
    let resolveDetail!: (value: typeof listedGame) => void;
    gameDetail = new Promise((resolve) => { resolveDetail = resolve; });

    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });
    const notes = screen.getByPlaceholderText("Gedanken zur Partie festhalten …") as HTMLTextAreaElement;
    expect(notes.value.trim()).toBe("");

    await act(async () => { resolveDetail(listedGame); });

    await waitFor(() => expect((screen.getByPlaceholderText(
      "Gedanken zur Partie festhalten …",
    ) as HTMLTextAreaElement).value).toBe("Review the missed tactic on move 18."));
  });

  it("deletes the selected database game after confirmation", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    expect(await screen.findByRole("button", { name: "Testgegner" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Partie löschen" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Kiebitz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_game", { id: 1 }));
    expect(await screen.findByText("Keine Partien gefunden.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Testgegner" })).toBeNull();
  });

  it("explains PGN player perspective and separates import from export", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });
    fireEvent.click(screen.getByRole("button", { name: /Import \/ Export/ }));

    expect(screen.getByText("PGN importieren")).toBeTruthy();
    expect(screen.getByText("PGN exportieren")).toBeTruthy();
    expect(screen.getByText(/ordnet beim Import Weiß\/Schwarz, Gegner, Elo und Ergebnis/)).toBeTruthy();
  });

  it("renders a player-name mismatch as a yellow warning", async () => {
    vi.mocked(openDialog).mockResolvedValue("friend.pgn");
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });
    fireEvent.click(screen.getByRole("button", { name: /Import \/ Export/ }));
    fireEvent.click(screen.getByRole("button", { name: "Datei wählen" }));
    await screen.findByText("friend.pgn");
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));

    const warning = await screen.findByText(/stimmt bei 1 PGN-Partie/);
    expect(warning.closest("div")?.className).toContain("text-gold");
  });

  // Die Spanne stand auf dem Handy früher nicht: Rechts daneben zählte schon
  // "Seite 1 / n". Sie trägt jetzt aber die Seitengröße — und die einzige
  // Stelle, an der sich etwas einstellen lässt, darf nicht am Format hängen.
  it("keeps the range line on mobile because it carries the page size", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    await screen.findByTestId("games-list");
    expect(screen.getByText(/^\d+–\d+ von /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Partien je Seite festlegen" })).toBeTruthy();
  });

  it("turns the page size into a field that takes any number in range", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });

    fireEvent.click(screen.getByRole("button", { name: "Partien je Seite festlegen" }));
    const feld = screen.getByLabelText("Partien je Seite festlegen") as HTMLInputElement;
    expect(feld.value).toBe("10");

    // Eine Zahl zwischen den festen Stufen von früher · sie muss durchgehen.
    fireEvent.change(feld, { target: { value: "37" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(await screen.findByText("37 je Seite")).toBeTruthy();

    // Und was darüber hinausgeht, wird geholt statt verworfen.
    fireEvent.click(screen.getByRole("button", { name: "Partien je Seite festlegen" }));
    const zweites = screen.getByLabelText("Partien je Seite festlegen");
    fireEvent.change(zweites, { target: { value: "500" } });
    fireEvent.keyDown(zweites, { key: "Enter" });
    expect(await screen.findByText("100 je Seite")).toBeTruthy();
  });

  // Die dritte Quelle ist kein Eigenname wie chess.com und lichess · sie stand
  // trotzdem in jeder Sprache als "manual" da.
  it("names the hand-entered source in the reading language", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });
    expect(screen.getByRole("button", { name: "Manuell" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "manual" })).toBeNull();
  });

  // Zwischen den Pfeilen ist auf einem Telefon kaum Breite · "Seite 1 / 153"
  // brach dort hinter dem Wort *und* hinter dem Schrägstrich, also dreizeilig.
  it("keeps the page count together so the label stays two lines", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    await screen.findByTestId("games-list");
    const label = screen.getByRole("button", { name: /^Seite/ }).textContent ?? "";
    expect(label).toBe("Seite 1 / 1");
  });

  it("keeps the range line on the desktop", async () => {
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });
    expect(screen.getByText("1–1 von 1")).toBeTruthy();
  });

  it("swaps the wide table for cards on mobile without losing the row action", async () => {
    const { container } = render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    // Der Gegnername steht auf der Seite zweimal — auf der Karte und am
    // Vorschaubrett · deshalb wird hier auf die Liste eingegrenzt.
    const list = await screen.findByTestId("games-list");
    const card = within(list).getByText(/Testgegner/).closest("div")?.parentElement;

    // Die achtspaltige Tabelle erzwingt sonst 760 px Breite.
    expect(container.querySelector("table")).toBeNull();
    // Alles Wesentliche steht weiterhin auf der Karte.
    expect(card?.textContent).toContain("1450");
    expect(card?.textContent).toContain("83,4 %");
    expect(card?.textContent).toContain("Italian Game");

    // Antippen wählt die Partie weiterhin aus und öffnet das Detail.
    fireEvent.click(within(list).getByText(/Testgegner/));
    expect(await screen.findByRole("button", { name: "Partie löschen" })).toBeTruthy();
  });

  // Auf Handybreite kosteten die beiden Chip-Reihen über der Liste mehr Höhe
  // als die ersten beiden Partien zusammen. Sie stecken jetzt im Filterblatt ·
  // Import und Export bleiben aber erreichbar, sie sind mobil nur ein Symbol.
  it("puts the filters into a sheet on mobile and keeps the import reachable", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    await screen.findByTestId("games-list");

    // Die Chip-Reihen stehen nicht mehr auf der Seite.
    expect(screen.queryByRole("button", { name: "Alle Quellen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Siege" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const sheet = await screen.findByTestId("games-filter-sheet");
    expect(within(sheet).getByRole("button", { name: "Alle Quellen" })).toBeTruthy();

    // Auswahl im Blatt filtert die Liste und schlägt sich als Pille nieder.
    fireEvent.click(within(sheet).getByRole("button", { name: "Siege" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Fertig" }));
    await waitFor(() => expect(screen.queryByTestId("games-filter-sheet")).toBeNull());
    expect(screen.getByRole("button", { name: "Filter entfernen" })).toBeTruthy();

    // Import/Export liegt mobil als Symbol in derselben Leiste · und kommt
    // wie die Filter als Blatt in den Vordergrund, statt die Liste nach unten
    // zu schieben.
    fireEvent.click(screen.getByRole("button", { name: "Import / Export" }));
    const importSheet = await screen.findByTestId("games-import-sheet");
    expect(within(importSheet).getByText("PGN importieren")).toBeTruthy();
    expect(within(importSheet).getByRole("button", { name: "Alles importieren" })).toBeTruthy();

    fireEvent.click(within(importSheet).getByRole("button", { name: "Fertig" }));
    await waitFor(() => expect(screen.queryByTestId("games-import-sheet")).toBeNull());
  });

  /**
   * Ein Lauf über die komplette Historie zieht sich über Dutzende
   * Monatsarchive. Wer ihn versehentlich angestossen hat, kommt über denselben
   * Knopf wieder heraus · und behält, was bis dahin geholt wurde.
   */
  it("cancels a running import from the button that shows its progress", async () => {
    let signal: AbortSignal | undefined;
    fetchAllMock.mockImplementation(
      (_cc: string, _li: string, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          signal = opts.signal;
          opts.signal?.addEventListener("abort", () =>
            resolve({ games: [], summary: { fetched: { cc: 0, li: 0 }, errors: [], aborted: true } })
          );
        })
    );
    render(<LocaleProvider><Games openAnalysis={vi.fn()} /></LocaleProvider>);
    await screen.findByRole("button", { name: "Testgegner" });

    fireEvent.click(screen.getByRole("button", { name: /Import \/ Export/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Alles importieren" }));

    // Aus dem Hauptknopf wird der Abbruch · beschriftet bleibt er der Lauf.
    const cancel = await screen.findByRole("button", { name: "Import abbrechen" });
    expect(cancel.textContent).toContain("Importiere");
    // Solange er läuft, lässt sich der Lauf nicht ein zweites Mal anstossen.
    expect((screen.getByRole("button", { name: "Alles importieren" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(cancel);
    expect(signal?.aborted).toBe(true);

    // Abgebrochen wird trotzdem gespeichert, was schon da war.
    expect(await screen.findByText(/Import abgebrochen · 3 neue Partien/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import abbrechen" })).toBeNull();
  });

  it("keeps the detail out of the mobile page until a game is tapped", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    const list = await screen.findByTestId("games-list");

    // Ohne Tipp ist die Seite eine reine Liste · Brett, Kennzahlen und Notizen
    // stehen mobil nicht mehr darunter.
    expect(screen.queryByTestId("game-detail-sheet")).toBeNull();
    expect(screen.queryByPlaceholderText("Gedanken zur Partie festhalten …")).toBeNull();
    expect(screen.queryByRole("button", { name: "Partie löschen" })).toBeNull();

    fireEvent.click(within(list).getByText(/Testgegner/));
    const sheet = await screen.findByTestId("game-detail-sheet");
    expect(within(sheet).getByPlaceholderText("Gedanken zur Partie festhalten …")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Partie löschen" })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByTestId("game-detail-sheet")).toBeNull());
  });

  it("pages through the result list from inside the detail sheet", async () => {
    const both = [game, { ...game, id: 2, source_id: "test-game-2", opponent: "Zweitgegner" }];
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "app_info") {
        return Promise.resolve({ version: "0.5.0", backend: "tauri", platform: "android" });
      }
      if (command === "get_settings") {
        return Promise.resolve({ locale: "de", cc_user: "Tom", li_user: "Tom", display_name: "Tom" });
      }
      if (command === "list_games_page") {
        return Promise.resolve({
          items: both.map((g) => ({ ...g, moves: undefined, note: undefined, source_id: undefined, has_moves: true, has_note: false })),
          total: 2,
          library_total: 2,
        });
      }
      if (command === "game_detail") return Promise.resolve(both.find((g) => g.id === args?.id));
      if (command === "upsert_games") return Promise.resolve({ inserted: 3, total: 4 });
    if (command === "index_positions") return Promise.resolve(undefined);
    return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    });

    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Games openAnalysis={vi.fn()} />
        </ShellProvider>
      </LocaleProvider>
    );
    const list = await screen.findByTestId("games-list");
    fireEvent.click(within(list).getByText(/Testgegner/));

    const sheet = await screen.findByTestId("game-detail-sheet");
    expect(within(sheet).getByText("1 / 2")).toBeTruthy();
    // Am Anfang der Liste geht es nur vorwärts.
    expect(within(sheet).getByRole("button", { name: "Vorherige Partie" })).toHaveProperty("disabled", true);

    fireEvent.click(within(sheet).getByRole("button", { name: "Nächste Partie" }));
    await waitFor(() => expect(within(screen.getByTestId("game-detail-sheet")).getByText("2 / 2")).toBeTruthy());
    // Kopfzeile und Brett tragen den Namen beide.
    expect(within(screen.getByTestId("game-detail-sheet")).getAllByText(/Zweitgegner/).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("game-detail-sheet")).getByRole("button", { name: "Nächste Partie" }))
      .toHaveProperty("disabled", true);
  });

  it("keeps an excluded game individually openable in analysis", async () => {
    listedGame = { ...game, analyzed: false, analysis_excluded: true };
    const openAnalysis = vi.fn();
    render(<LocaleProvider><Games openAnalysis={openAnalysis} /></LocaleProvider>);

    expect(await screen.findByText("Nicht in Analysen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analysieren" }));
    expect(openAnalysis).toHaveBeenCalledWith(1);
  });
});
