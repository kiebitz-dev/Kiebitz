import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Endgame from "./Endgame";
import { ShellProvider } from "../components/MobileShell";

const engineMove = vi.hoisted(() => vi.fn(() => new Promise<string>(() => {})));

const mocks = vi.hoisted(() => ({
  /** Die Zufallsaufgabe, die die Seite bekommt · Tests dürfen sie tauschen. */
  drill: {
    id: "rnd-kr-k",
    category: "random",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: { de: "Zufall: Turm gegen König", en: "Random: rook vs. king" },
    hint: { de: "Hinweis", en: "Hint" },
  },
  /** Der Zug, den ein Klick auf das Brett-Double auslöst. */
  drop: { from: "a1", to: "a2" },
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));

vi.mock("../lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) => key,
  }),
  // Das Fokus-Brett und seine Schaltfläche beschriften sich selbst.
  useT: () => (key: string) => key,
}));

vi.mock("../lib/endgame", () => ({
  endgameMove: engineMove,
  endgameRecord: vi.fn(() => Promise.resolve()),
  endgameStats: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../lib/randomEndgame", () => ({
  randomDrill: () => mocks.drill,
}));

vi.mock("../components/Board", () => ({
  default: ({
    fen,
    onPieceDrop,
  }: {
    fen: string;
    onPieceDrop: (from: string, to: string) => boolean;
  }) => (
    <button
      data-testid="endgame-board"
      data-fen={fen}
      onClick={() => onPieceDrop(mocks.drop.from, mocks.drop.to)}
    >
      make move
    </button>
  ),
}));

// Der Teilen-Dialog hat eigene Tests · hier zählt, was die Seite ihm mitgibt.
vi.mock("../components/ShareDialog", () => ({
  default: ({ subject }: { subject: Record<string, unknown> }) => (
    <div data-testid="share-subject">{JSON.stringify(subject)}</div>
  ),
}));

afterEach(() => {
  cleanup();
  engineMove.mockClear();
  mocks.drill = {
    id: "rnd-kr-k",
    category: "random",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: { de: "Zufall: Turm gegen König", en: "Random: rook vs. king" },
    hint: { de: "Hinweis", en: "Hint" },
  };
  mocks.drop = { from: "a1", to: "a2" };
});

/** Matt in einem Zug · der kürzeste Weg zum Schlussstand einer Aufgabe. */
function mateInOne() {
  mocks.drill = {
    ...mocks.drill,
    fen: "7k/8/6K1/8/8/8/1Q6/8 w - - 0 1",
  };
  mocks.drop = { from: "b2", to: "b8" };
}

/**
 * Patt in einem Zug · der kürzeste Weg zu einer verlorenen Aufgabe.
 *
 * Dg2–g6 nimmt dem König auf h8 g8, g7 und h7, ohne ihn anzugreifen. Bei
 * einer Gewinnaufgabe ist das kein Remis, das man hält, sondern eines, das
 * man sich einhandelt.
 */
function staleMateInOne() {
  mocks.drill = {
    ...mocks.drill,
    fen: "7k/8/8/8/8/8/6Q1/7K w - - 0 1",
  };
  mocks.drop = { from: "g2", to: "g6" };
}

describe("Endgame trainer", () => {
  it("starts with a random position by default", () => {
    render(<Endgame />);

    expect(screen.getByText("Random: rook vs. king")).toBeTruthy();
    expect(screen.getByTestId("endgame-board").getAttribute("data-fen")).toBe(
      "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"
    );
  });

  it("shares the drill as it starts, with its goal, not the half-played position", () => {
    render(<Endgame />);
    fireEvent.click(screen.getByRole("button", { name: "make move" }));

    fireEvent.click(screen.getByTitle("sh.title"));
    const subject = JSON.parse(screen.getByTestId("share-subject").textContent!);
    expect(subject.kind).toBe("endgame");
    expect(subject.fen).toBe("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    expect(subject.orientation).toBe("white");
    expect(subject.title).toBe("Random: rook vs. king · eg.goalWin");
  });

  it("keeps a fixed status slot while the engine starts thinking", () => {
    render(<Endgame />);
    fireEvent.click(screen.getByRole("button", { name: "eg.randomStart" }));

    const status = screen.getByTestId("endgame-status");
    expect(status.textContent).toBe("eg.yourTurn");
    // Der Stand hat eine eigene Zeile mit reservierter Hoehe · er teilt sie
    // sich nur mit dem Ziel und rutscht deshalb nicht mit dem Namen mit.
    expect(status.className).toContain("min-h-5");
    expect(status.parentElement?.className).toContain("justify-between");

    fireEvent.click(screen.getByRole("button", { name: "make move" }));
    expect(status.textContent).toBe("eg.thinking");
    expect(engineMove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("endgame-status")).toBe(status);
  });

  /**
   * Vier Knöpfe nebeneinander sind auf 360 px eine Zeile zu viel · der Fokus
   * stand allein in einer zweiten darunter. In der App liegen Teilen und
   * Fokus deshalb hinter einem Zeichen, wie schon unter dem Analysebrett.
   */
  it("folds sharing and focus into one menu on the phone", () => {
    render(
      <ShellProvider mobile>
        <Endgame />
      </ShellProvider>
    );

    expect(screen.queryByTitle("sh.title")).toBeNull();
    expect(screen.queryByRole("button", { name: /^board\.focus/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "an.boardActions" }));
    expect(screen.getByRole("menuitem", { name: "sh.title" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /board.focus/ })).toBeTruthy();
  });

  /**
   * Der Schlussstand · auf dem Telefon zwei Zeilen statt drei.
   *
   * Nebeneinander passten Meldung und Knopfreihe dort nie; die Reihe brach
   * mitten zwischen den Knöpfen um und ließ „Nächste Zufallsstellung" allein
   * in einer dritten Zeile stehen. Jetzt steht der Satz oben, die Knöpfe
   * darunter in einer Reihe · und der Weg nach vorn heißt dort nur „Nächste".
   */
  it("stacks the result over its buttons on the phone", () => {
    mateInOne();
    render(
      <ShellProvider mobile>
        <Endgame />
      </ShellProvider>
    );

    fireEvent.click(screen.getByTestId("endgame-board"));

    const weiter = screen.getByRole("button", { name: "eg.nextShort" });
    expect(screen.queryByRole("button", { name: "eg.randomNext" })).toBeNull();
    expect(screen.getByRole("button", { name: /eg.retry/ })).toBeTruthy();
    // Meldung und Knopfreihe stehen untereinander im selben Kasten.
    const kasten = weiter.closest("div.rounded-lg")!;
    expect(kasten.className).toContain("flex-col");
    expect(kasten.firstElementChild!.textContent).toContain("eg.successWin");
  });

  /** Auf dem Rechner ist Platz für den vollen Namen · und für eine Zeile. */
  it("keeps the result and its buttons on one line on the desktop", () => {
    mateInOne();
    render(<Endgame />);

    fireEvent.click(screen.getByTestId("endgame-board"));

    const weiter = screen.getByRole("button", { name: "eg.randomNext" });
    const kasten = weiter.closest("div.rounded-lg")!;
    expect(kasten.className).not.toContain("flex-col");
    expect(kasten.className).toContain("justify-between");
  });

  /**
   * Der Weg nach vorn steht auch unter einer verpatzten Aufgabe.
   *
   * Bis 1.4 hätte man von hier aus nur „Nochmal" gehabt: Wer eine
   * Gewinnstellung nur remis gehalten hatte, kam zur nächsten Zufallsstellung
   * allein über das Verzeichnis. Eine gescheiterte Aufgabe ist aber genau der
   * Moment, in dem man weiterziehen will.
   */
  it("offers the next random position after a lost drill too", () => {
    staleMateInOne();
    render(<Endgame />);

    fireEvent.click(screen.getByTestId("endgame-board"));

    const weiter = screen.getByRole("button", { name: "eg.randomNext" });
    const kasten = weiter.closest("div.rounded-lg")!;
    // Der Schlusssatz sagt, dass es schiefging · und daneben steht trotzdem
    // der Weg zur nächsten Stellung.
    expect(kasten.textContent).toContain("eg.failedWin");
    expect(screen.getByRole("button", { name: /eg.retry/ })).toBeTruthy();
  });

  /**
   * Der Hinweis ist die Theorie zur Aufgabe · wer ihn beim ersten Hinsehen
   * mitliest, übt nicht, sondern liest. Er liegt deshalb verdeckt, und mit der
   * nächsten Aufgabe fällt er wieder zu — sonst stünde die Lösung der zweiten
   * Stellung da, bevor man sie gesehen hat.
   */
  it("keeps the hint covered until it is asked for", () => {
    render(<Endgame />);

    expect(screen.queryByText("Hint")).toBeNull();
    const knopf = screen.getByRole("button", { name: /eg\.hintTitle/ });
    expect(knopf.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(knopf);
    expect(screen.getByText("Hint")).toBeTruthy();
    expect(screen.getByRole("button", { name: /eg\.hintTitle/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "eg.randomStart" }));
    expect(screen.queryByText("Hint")).toBeNull();
  });

  it("keeps both handles side by side on the desktop", () => {
    render(<Endgame />);
    expect(screen.getByTitle("sh.title")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^board\.focus/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "an.boardActions" })).toBeNull();
  });
});
