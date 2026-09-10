import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import { grantPlus, revokePlus } from "../test/plus";
import { ShellProvider } from "../components/MobileShell";
import { fenAfter } from "../lib/position";
import type { RepNode } from "../lib/repertoire";
import Repertoire from "./Repertoire";

const mocks = vi.hoisted(() => ({
  repDue: vi.fn(),
  repList: vi.fn(),
  repStats: vi.fn(),
  repGaps: vi.fn(),
  repReview: vi.fn(),
  repReorder: vi.fn(),
  repDelete: vi.fn(),
  repAddLine: vi.fn(),
  repSetName: vi.fn(),
  /** Der Zug, den ein Klick auf das Brett-Double auslöst. */
  drop: { from: "", to: "" },
  engineMove: "e2e4",
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
  engineInfo: vi.fn(() => Promise.resolve({ ok: false, name: "", path: "" })),
}));
vi.mock("../lib/repertoire", () => ({
  repAddLine: mocks.repAddLine,
  repDelete: mocks.repDelete,
  repDue: mocks.repDue,
  repExportPgnFile: vi.fn(),
  repGaps: mocks.repGaps,
  repImportPgn: vi.fn(),
  repImportPgnFile: vi.fn(),
  repList: mocks.repList,
  repLookup: vi.fn(() => Promise.resolve([])),
  repNodeGames: vi.fn(() => new Promise(() => {})),
  repReorder: mocks.repReorder,
  repReview: mocks.repReview,
  repSetName: mocks.repSetName,
  repSetNote: vi.fn(),
  repStats: mocks.repStats,
}));
vi.mock("../lib/settings", () => ({
  chessdbQuery: vi.fn(() => Promise.resolve({ status: "unknown", moves: [], cached: false })),
  getSettings: vi.fn(() => Promise.resolve({ locale: "de", rep_due_limit: 20, rep_new_limit: 5 })),
}));
vi.mock("../components/LiveEngine", () => ({
  default: ({ onMove }: { onMove?: (uci: string) => void }) =>
    onMove ? <button onClick={() => onMove(mocks.engineMove)}>play engine move</button> : null,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
// Der Teilen-Dialog selbst hat eigene Tests · hier zählt nur, was die Seite
// ihm mitgibt.
vi.mock("../components/ShareDialog", () => ({
  default: ({ subject }: { subject: Record<string, unknown> }) => (
    <div data-testid="share-subject">{JSON.stringify(subject)}</div>
  ),
}));
// Das Brett-Double reicht den Zug durch, den der Test vorher in mocks.drop
// gelegt hat · so lässt sich ein Zug ohne echtes Drag-and-drop auslösen.
vi.mock("../components/Board", () => ({
  default: ({
    boardId,
    fen,
    onPieceDrop,
  }: {
    boardId: string;
    fen: string;
    onPieceDrop?: (from: string, to: string) => boolean;
  }) => (
    <div data-testid={`board-${boardId}`} data-fen={fen}>
      <button
        data-testid={`play-${boardId}`}
        onClick={() => onPieceDrop?.(mocks.drop.from, mocks.drop.to)}
      />
    </div>
  ),
}));

/** Vier Knoten: 1.e4 e5 2.Nf3 Nc6 · trainiert wird Schwarz. */
function blackTree(): RepNode[] {
  const base = { side: "black" as const, name: "", note: "", reps: 1, lapses: 0, due_ts: 0, stability: 1, sort_order: 0 };
  return [
    { ...base, id: 1, parent_id: 0, san: "e4", depth: 1, my_move: false, fen_key: "k1" },
    { ...base, id: 2, parent_id: 1, san: "e5", depth: 2, my_move: true, fen_key: "k2" },
    { ...base, id: 3, parent_id: 2, san: "Nf3", depth: 3, my_move: false, fen_key: "k3" },
    { ...base, id: 4, parent_id: 3, san: "Nc6", depth: 4, my_move: true, fen_key: "k4" },
  ];
}

/** Zwei vollständige Linien mit gemeinsamem ersten Zug. */
function variationTree(): RepNode[] {
  const base = { side: "white" as const, name: "", note: "", reps: 1, lapses: 0, due_ts: 0, stability: 1, sort_order: 0 };
  return [
    { ...base, id: 1, parent_id: 0, san: "e4", depth: 1, my_move: true, fen_key: "v1" },
    { ...base, id: 2, parent_id: 1, san: "e5", depth: 2, my_move: false, fen_key: "v2" },
    { ...base, id: 3, parent_id: 2, san: "Nf3", name: "Italian Game", depth: 3, my_move: true, fen_key: "v3" },
    { ...base, id: 4, parent_id: 1, san: "c5", depth: 2, my_move: false, fen_key: "v4" },
    { ...base, id: 5, parent_id: 4, san: "Nf3", name: "Sicilian Defense", depth: 3, my_move: true, fen_key: "v5" },
    { ...base, id: 6, parent_id: 3, san: "Nc6", name: "Italian Main Line", depth: 4, my_move: false, fen_key: "v6" },
  ];
}

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  mocks.drop = { from: "", to: "" };
  mocks.engineMove = "e2e4";
  mocks.repReview.mockResolvedValue({ due_ts: 0, interval_days: 1 });
  mocks.repReorder.mockResolvedValue(undefined);
  mocks.repDelete.mockResolvedValue(undefined);
  mocks.repSetName.mockResolvedValue(undefined);
  // Die Kennung des Endpunkts, den `rep_add_line` zurückmeldet · die Tests
  // setzen sie auf den Knoten, auf dem die gesicherte Zeile endet.
  mocks.repAddLine.mockResolvedValue(0);
  mocks.repList.mockResolvedValue([]);
  mocks.repGaps.mockResolvedValue([]);
  mocks.repStats.mockResolvedValue({
    my_positions: 1,
    due_now: 1,
    coverage_pct: 100,
    games_checked: 1,
    plies: 8,
    by_side: [],
  });
  mocks.repDue.mockResolvedValue([
    {
      node_id: 7,
      side: "white",
      prompt_sans: ["e4", "e5", "Nf3"],
      expected_san: "Nc6",
      line: "Testlinie",
      is_new: false,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Ohne Zurücksetzen liefe der nächste Test unbemerkt mit Plus weiter.
  revokePlus();
});

async function startTraining() {
  render(
    <LocaleProvider>
      <Repertoire />
    </LocaleProvider>
  );
  fireEvent.click(await screen.findByRole("button", { name: /Training starten/ }));
  return await screen.findByTestId("board-rep-train");
}

describe("Repertoire training", () => {
  it("recognizes the opening while adding a line and keeps a custom variation name", async () => {
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Variante hinzufügen" }));

    const name = screen.getByPlaceholderText("Name der Variante (optional)") as HTMLInputElement;
    for (const uci of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]) {
      mocks.engineMove = uci;
      fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    }
    await waitFor(() => expect(name.value).toBe("Italian Game"));
    expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(
      fenAfter(["e4", "e5", "Nf3", "Nc6", "Bc4"])
    );

    fireEvent.change(name, { target: { value: "Mein Königsbauer" } });
    mocks.engineMove = "g8f6";
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    await waitFor(() => expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(
      fenAfter(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"])
    ));
    expect(name.value).toBe("Mein Königsbauer");
  });

  it("points to the variation list below on mobile", async () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Repertoire />
        </ShellProvider>
      </LocaleProvider>
    );
    expect(
      await screen.findByText("Wähle unten eine Variante · oder lege mit „Variante hinzufügen“ los.")
    ).toBeTruthy();
  });

  /**
   * „Frei üben" heißt auf dem Telefon nur „Frei".
   *
   * Neben dem Trainingsknopf mit seiner Zahl blieb für den vollen Namen keine
   * Breite · er stand als „Frei üb…" da. Ein Wort sagt dasselbe und steht ganz.
   */
  it("shortens the free-practice button on the phone", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <Repertoire />
        </ShellProvider>
      </LocaleProvider>
    );

    expect(await screen.findByRole("button", { name: "Frei" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Frei üben" })).toBeNull();

    cleanup();
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );
    // Auf dem Rechner bleibt der volle Name stehen.
    expect(await screen.findByRole("button", { name: "Frei üben" })).toBeTruthy();
  });

  it("shows named variation lines and navigates lines and positions with the keyboard", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    const italian = await screen.findByRole("option", { name: "Italian Game: 1.e4 e5 2.Nf3" });
    const sicilian = screen.getByRole("option", { name: "Sicilian Defense: 1.e4 c5 2.Nf3" });
    expect(screen.getByRole("option", { name: "Italian Main Line: 1.e4 e5 2.Nf3 Nc6" })).toBeTruthy();
    const board = screen.getByTestId("board-repertoire");

    fireEvent.click(italian);
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));

    fireEvent.keyDown(italian, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    fireEvent.keyDown(italian, { key: "ArrowDown" });
    expect(sicilian.getAttribute("aria-selected")).toBe("true");
    expect(board.dataset.fen).toBe(fenAfter(["e4", "c5", "Nf3"]));

    fireEvent.keyDown(sicilian, { key: "Home" });
    expect(board.dataset.fen).toBe(fenAfter([]));

    fireEvent.keyDown(sicilian, { key: "End" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "c5", "Nf3"]));
  });

  it("shares the position on the board together with the rest of the line", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    const italian = await screen.findByRole("option", { name: "Italian Game: 1.e4 e5 2.Nf3" });
    fireEvent.click(italian);
    // Einen Halbzug zurück: geteilt wird, was auf dem Brett steht.
    fireEvent.keyDown(italian, { key: "ArrowLeft" });
    fireEvent.click(screen.getByTitle("Stellung teilen"));

    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.kind).toBe("repertoire");
    expect(subject.fen).toBe(fenAfter(["e4", "e5"]));
    expect(subject.lastMove).toEqual({ from: "e7", to: "e5" });
    // Was das Buch danach spielt, reist mit.
    expect(subject.line).toEqual([{ from: "g1", to: "f3" }]);
    // Und der Weg dorthin · dieselbe Zeile, die unter dem Brett steht.
    expect(subject.history).toBe("1.e4 e5");
    expect(subject.title).toBe("Italian Game");
  });

  // Welche Variante oben steht, weiß nur der Spieler · deshalb lässt sich die
  // Liste ziehen. Der Griff kann dasselbe über die Tastatur.
  it("moves a variation with the handle", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    const handle = await screen.findByRole("button", { name: /^Italian Game verschieben/ });
    fireEvent.keyDown(handle, { key: "ArrowDown" });

    // Gespeichert wird die vollständige Reihenfolge der Seite als Endpunkt-Ids:
    // die Italienische Partie rutscht hinter die Sizilianische.
    await waitFor(() => expect(mocks.repReorder).toHaveBeenCalledWith("white", [5, 3, 6]));
  });

  // Ohne gemerkte Reihenfolge steht die Liste in Einfügereihenfolge; sobald
  // eine gesetzt ist, gilt sie · später angelegte Linien hängen sich hinten an.
  it("lists the variations in the saved order", async () => {
    mocks.repList.mockResolvedValue(
      variationTree().map((node) =>
        node.id === 5 ? { ...node, sort_order: 1 } : node.id === 3 ? { ...node, sort_order: 2 } : node
      )
    );
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    await screen.findByRole("option", { name: /Italian Game/ });
    const names = screen.getAllByRole("option").map((option) => option.getAttribute("aria-label"));
    expect(names[0]).toContain("Sicilian Defense");
    expect(names[1]).toContain("Italian Game");
    expect(names[2]).toContain("Italian Main Line");
  });

  it("navigates previous positions with the left and right arrow keys", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
  });

  // Nur "richtig" unter dem Brett zu melden, während die Figur zurückspringt,
  // fühlt sich an, als hätte man den Zug gar nicht gemacht.
  it("plays the correct answer on the board", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "b8", to: "c6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
    // Schnell beantwortet · das ist die leichteste FSRS-Note.
    expect(mocks.repReview).toHaveBeenCalledWith(7, 4);
  });

  it("keeps the position after a wrong move and plays the book move on request", async () => {
    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "g8", to: "f6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    expect(mocks.repReview).toHaveBeenCalledWith(7, 1);

    fireEvent.click(screen.getByRole("button", { name: /Zeigen/ }));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
  });

  // Ein Fehler soll noch in derselben Sitzung wiederkommen, nicht erst morgen.
  it("puts a failed move back at the end of the session", async () => {
    await startTraining();
    await screen.findByText("1 / 1");

    mocks.drop = { from: "g8", to: "f6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));

    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  // Eine Karte ist der Anfang einer Linie, keine Einzelstellung: der Gegner
  // antwortet selbst und die nächste eigene Antwort wird gleich mitgefragt.
  it("answers for the opponent and continues the line", async () => {
    mocks.repList.mockResolvedValue(blackTree());
    mocks.repDue.mockResolvedValue([
      {
        node_id: 2,
        side: "black",
        prompt_sans: ["e4"],
        expected_san: "e5",
        line: "Offene Spiele",
        is_new: false,
      },
    ]);

    const board = await startTraining();
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4"]));
    });

    mocks.drop = { from: "e7", to: "e5" };
    fireEvent.click(screen.getByTestId("play-rep-train"));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5"]));

    // Der Gegnerzug kommt von allein · danach ist wieder Schwarz gefragt.
    await waitFor(() => {
      expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]));
    });

    mocks.drop = { from: "b8", to: "c6" };
    fireEvent.click(screen.getByTestId("play-rep-train"));
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
    // Beide eigenen Züge der Linie wurden einzeln bewertet.
    expect(mocks.repReview).toHaveBeenCalledWith(2, 4);
    expect(mocks.repReview).toHaveBeenCalledWith(4, 4);
  });
});

describe("Repertoire deleting and building", () => {
  it("asks before deleting and drops only the moves that belong to the line alone", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    // Der Mülleimer sitzt an der Zeile selbst · dort sucht man ihn.
    fireEvent.click(await screen.findByRole("button", { name: "Sicilian Defense löschen" }));
    expect(screen.getByText("Variante löschen?")).toBeTruthy();
    // Erst der Abbruch: gefragt heißt nicht gelöscht.
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByText("Variante löschen?")).toBeNull());
    expect(mocks.repDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sicilian Defense löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    // 1.e4 trägt auch die italienische Partie · fallen darf erst 1…c5 (id 4).
    await waitFor(() => expect(mocks.repDelete).toHaveBeenCalledWith(4));
  });

  it("keeps a named line above the deleted one", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Italian Main Line löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    // Über Nc6 steht die benannte italienische Partie · sie bleibt stehen.
    await waitFor(() => expect(mocks.repDelete).toHaveBeenCalledWith(6));
  });

  it("opens the builder with the move that was played on the overview board", async () => {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    await screen.findByTestId("board-repertoire");
    mocks.drop = { from: "d2", to: "d4" };
    fireEvent.click(screen.getByTestId("play-repertoire"));

    const board = await screen.findByTestId("board-rep-add");
    expect(board.dataset.fen).toBe(fenAfter(["d4"]));
    expect(screen.getByRole("button", { name: "Speichern (1 Zug)" })).toBeTruthy();
  });

  /**
   * Aus dem Fokus gezogen, bleibt man im Fokus.
   *
   * Ein Zug auf dem Brett der Übersicht öffnet den Baukasten. Wer dabei im
   * Fokus-Brett stand, wollte dort weiterziehen und nicht auf eine andere
   * Seite geworfen werden · der Baukasten geht hinter dem Brett auf.
   */
  it("keeps the focus board open when a move starts a new variation", async () => {
    grantPlus();
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    await screen.findByTestId("board-repertoire");
    fireEvent.click(screen.getByRole("button", { name: "Fokus-Brett öffnen" }));
    expect(screen.getByTestId("board-repertoire-focus")).toBeTruthy();

    mocks.drop = { from: "d2", to: "d4" };
    fireEvent.click(screen.getByTestId("play-repertoire-focus"));

    // Der Baukasten steht dahinter, das Brett im Fokus zeigt den Zug · und
    // weiterziehen lässt es sich dort auch.
    const focus = await screen.findByTestId("board-rep-add-focus");
    expect(focus.dataset.fen).toBe(fenAfter(["d4"]));
    expect(screen.getByTestId("board-rep-add")).toBeTruthy();
    mocks.drop = { from: "d7", to: "d5" };
    fireEvent.click(screen.getByTestId("play-rep-add-focus"));
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add-focus").dataset.fen).toBe(fenAfter(["d4", "d5"]))
    );

    // Zu ist der Fokus erst, wenn man ihn schließt · dann steht der Baukasten da.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("board-rep-add-focus")).toBeNull();
    expect(screen.getByRole("button", { name: "Speichern (2 Züge)" })).toBeTruthy();
  });

  /** Ohne Fokus bleibt es beim gewohnten Weg · der Baukasten als Seite. */
  it("opens the builder as a page when the move came from the page board", async () => {
    grantPlus();
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );

    await screen.findByTestId("board-repertoire");
    mocks.drop = { from: "d2", to: "d4" };
    fireEvent.click(screen.getByTestId("play-repertoire"));

    await screen.findByTestId("board-rep-add");
    expect(screen.queryByTestId("board-rep-add-focus")).toBeNull();
  });

  it("takes a move back with the left arrow key", async () => {
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Variante hinzufügen" }));

    for (const uci of ["e2e4", "e7e5"]) {
      mocks.engineMove = uci;
      fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    }
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4", "e5"]))
    );

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4"]))
    );

    // Im Namensfeld gehört der Pfeil dem Cursor, nicht dem Brett.
    const name = screen.getByPlaceholderText("Name der Variante (optional)");
    fireEvent.keyDown(name, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4"]))
    );
  });
});

/**
 * Eine angelegte Variante ändern.
 *
 * Bis hierher gab es zu einer Zeile nur zwei Wege: verschieben und wegwerfen.
 * Wer einen Zug anhängen oder den Namen richtigstellen wollte, musste sie neu
 * bauen — und verlor dabei den Lernstand. Der Griff zwischen den beiden legt
 * sie im Baukasten auf, mit ihren Zügen auf dem Brett.
 *
 * Geprüft wird vor allem, was danach von der *alten* Zeile übrig ist: Ein
 * Endpunkt, der seinen Namen behielte, stünde als zweite, gleichnamige Zeile
 * im Verzeichnis, und ein Rest, der zu viel mitnähme, risse fremde Varianten
 * mit.
 */
describe("Repertoire editing", () => {
  async function edit(name: string) {
    mocks.repList.mockResolvedValue(variationTree());
    render(
      <LocaleProvider>
        <Repertoire />
      </LocaleProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: `${name} bearbeiten` }));
    return await screen.findByTestId("board-rep-add");
  }

  const save = () => fireEvent.click(screen.getByRole("button", { name: "Änderungen sichern" }));
  const undo = () => fireEvent.click(screen.getByRole("button", { name: "Zug zurück" }));

  it("opens the line in the builder, moves and name and all", async () => {
    const board = await edit("Italian Main Line");
    expect(board.dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3", "Nc6"]));
    expect(
      (screen.getByPlaceholderText("Name der Variante (optional)") as HTMLInputElement).value
    ).toBe("Italian Main Line");
    // Die Seite steht fest · eine Variante wechselt beim Bearbeiten nicht die
    // Farbe, und die Wahl stünde nur im Weg.
    expect(screen.queryByRole("button", { name: "Als Schwarz" })).toBeNull();
  });

  /** Nur der Name · dann bleibt der Endpunkt derselbe und nichts ist aufzuräumen. */
  it("renames without touching the tree", async () => {
    mocks.repAddLine.mockResolvedValue(5);
    await edit("Sicilian Defense");
    fireEvent.change(screen.getByPlaceholderText("Name der Variante (optional)"), {
      target: { value: "Mein Sizilianer" },
    });
    save();

    await waitFor(() =>
      expect(mocks.repAddLine).toHaveBeenCalledWith("white", "Mein Sizilianer", ["e4", "c5", "Nf3"])
    );
    expect(mocks.repSetName).toHaveBeenCalledWith(5, "Mein Sizilianer");
    expect(mocks.repDelete).not.toHaveBeenCalled();
  });

  /**
   * Verlängert: Der alte Endpunkt liegt jetzt mitten in der Zeile · er verliert
   * seinen Namen, sonst stünde er ein zweites Mal im Verzeichnis.
   */
  it("takes the name off the old endpoint when the line grows", async () => {
    mocks.repAddLine.mockResolvedValue(9);
    await edit("Sicilian Defense");
    mocks.engineMove = "d7d6";
    fireEvent.click(screen.getByRole("button", { name: "play engine move" }));
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(
        fenAfter(["e4", "c5", "Nf3", "d6"])
      )
    );
    save();

    await waitFor(() =>
      expect(mocks.repAddLine).toHaveBeenCalledWith("white", "Sicilian Defense", [
        "e4",
        "c5",
        "Nf3",
        "d6",
      ])
    );
    expect(mocks.repSetName).toHaveBeenCalledWith(5, "");
    expect(mocks.repDelete).not.toHaveBeenCalled();
  });

  /**
   * Gekürzt: Was hinten abfällt, gehört allein dieser Zeile · es geht weg,
   * und zwar genau bis zur Abzweigung und keinen Knoten weiter.
   */
  it("sweeps up the tail that only belonged to the line", async () => {
    mocks.repAddLine.mockResolvedValue(3);
    await edit("Italian Main Line");
    undo();
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4", "e5", "Nf3"]))
    );
    save();

    await waitFor(() => expect(mocks.repDelete).toHaveBeenCalledWith(6));
    expect(mocks.repAddLine).toHaveBeenCalledWith("white", "Italian Main Line", [
      "e4",
      "e5",
      "Nf3",
    ]);
  });

  /**
   * Am Rest hängt noch eine benannte Fortsetzung · sie bleibt stehen, und der
   * alte Endpunkt verliert bloß seinen Namen. Eine Variante zu bearbeiten darf
   * keine zweite mitnehmen.
   */
  it("leaves a named continuation standing", async () => {
    mocks.repAddLine.mockResolvedValue(2);
    await edit("Italian Game");
    undo();
    await waitFor(() =>
      expect(screen.getByTestId("board-rep-add").dataset.fen).toBe(fenAfter(["e4", "e5"]))
    );
    save();

    await waitFor(() => expect(mocks.repSetName).toHaveBeenCalledWith(3, ""));
    expect(mocks.repDelete).not.toHaveBeenCalled();
  });
});
