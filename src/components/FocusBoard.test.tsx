import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FocusBoard, { FocusButton } from "./FocusBoard";
import { ShellProvider } from "./MobileShell";
import type { PlusFeature } from "../lib/plus/types";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
}));

/**
 * Das Fokus-Brett gehört zu Kiebitz Plus. Hier geht es um die Ansicht selbst
 * und um das, was der Griff im gesperrten Fall tut · den Zustand dahinter
 * prüft plus/store.test.ts.
 */
const gate = { unlocked: true, pending: false };
vi.mock("../lib/plus/usePlus", () => ({
  usePlusGate: () => ({ ...gate, plus: {} }),
}));

const opened = vi.fn();
vi.mock("../lib/plus/dialog", () => ({
  openPlusDialog: (feature: PlusFeature) => opened(feature),
}));

beforeEach(() => {
  gate.unlocked = true;
  gate.pending = false;
  opened.mockClear();
});

afterEach(cleanup);

function open(mobile: boolean, onClose = () => {}) {
  return render(
    <ShellProvider mobile={mobile}>
      <FocusBoard
        open
        onClose={onClose}
        title="Analyse"
        subtitle="Torim98 vs. Rival"
        above={<div>oben</div>}
        below={<div>unten</div>}
      >
        <div data-testid="board">Brett</div>
      </FocusBoard>
    </ShellProvider>
  );
}

describe("focus board", () => {
  it("renders nothing while it is closed", () => {
    render(
      <FocusBoard open={false} onClose={() => {}} title="Analyse">
        <div data-testid="board">Brett</div>
      </FocusBoard>
    );
    expect(screen.queryByTestId("focus-board")).toBeNull();
  });

  it("shows title, context and the surrounding rows around the board", () => {
    open(false);
    const layer = screen.getByTestId("focus-board");
    expect(layer.getAttribute("aria-label")).toBe("Analyse");
    expect(screen.getByText("Torim98 vs. Rival")).toBeTruthy();
    expect(screen.getByText("oben")).toBeTruthy();
    expect(screen.getByTestId("board")).toBeTruthy();
    expect(screen.getByText("unten")).toBeTruthy();
  });

  /**
   * Auf dem Desktop legt sich der Fokus als Karte über die unscharf gestellte
   * Seite; auf dem Handy ist er ein eigener, deckender Schirm.
   */
  it("blurs the page behind it on the desktop and covers it on the phone", () => {
    open(false);
    expect(screen.getByTestId("focus-board").className).toContain("backdrop-blur");
    cleanup();

    open(true);
    const layer = screen.getByTestId("focus-board");
    expect(layer.className).toContain("bg-bg");
    expect(layer.className).not.toContain("backdrop-blur");
  });

  it("closes on Escape and on a click next to the card", () => {
    const onClose = vi.fn();
    open(false, onClose);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const layer = screen.getByTestId("focus-board");
    fireEvent.mouseDown(layer);
    expect(onClose).toHaveBeenCalledTimes(2);

    // Ein Klick *in* die Karte schließt nicht.
    fireEvent.mouseDown(screen.getByTestId("board"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /**
   * Android-Zurück soll den Fokus schließen und nicht die App verlassen · der
   * eigene History-Eintrag liegt dafür auf derselben Stapeltiefe wie die Seite.
   */
  it("takes a history entry of its own so the back key closes it", () => {
    window.history.replaceState({ kd: 2 }, "");
    const onClose = vi.fn();
    open(false, onClose);

    expect((window.history.state as { sheet?: boolean }).sheet).toBe(true);
    expect((window.history.state as { kd?: number }).kd).toBe(2);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { kd: 2 } }));
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * Die Reihe unter dem Brett wechselt im Puzzle-Trainer bei jedem Zug ihre
   * Höhe · gelöst und danebengehauen tragen einen umrandeten Streifen mit
   * Knöpfen, die Aufgabe davor nur eine Zeile Text. Solange darunter noch Platz
   * ist, darf das Brett davon nichts merken.
   */
  it("keeps the board in place when the row below it grows", () => {
    open(true);
    const layer = screen.getByTestId("focus-board");
    const content = layer.querySelector(".overflow-y-auto") as HTMLDivElement;
    const column = content.firstElementChild as HTMLDivElement;
    const [rows, board, controls] = [...column.children] as HTMLDivElement[];

    // jsdom rechnet kein Layout · die Höhen kommen deshalb von Hand, und zwar
    // in denselben Größenordnungen wie auf einem Telefon.
    const stub = (element: HTMLElement, height: number) => {
      element.getBoundingClientRect = () =>
        ({ height, width: 360, top: 0, bottom: height, left: 0, right: 360, x: 0, y: 0 }) as DOMRect;
    };
    stub(layer, 800);
    stub(content, 740);
    stub(rows, 40);
    stub(board, 360);
    stub(controls, 100);
    fireEvent(window, new Event("resize"));

    // Vorlauf = halbe freie Fläche über dem Brett: (740 − 360) / 2 − 40.
    expect(column.style.paddingTop).toBe("150px");
    // 60 (Hülle) + 40 (Reihe) + 100 (Leiste) + 0 (Abstände, jsdom kennt keine)
    // · plus das eine Pixel Zugabe gegen Bruchzahlen (siehe `useChrome`).
    expect(layer.style.getPropertyValue("--board-chrome")).toBe("201px");
    // Die Höhe, von der abgezogen wird, ist die gemessene und nicht `100dvh` ·
    // die Android-WebView löst `dvh` gegen den ganzen Schirm auf, also samt
    // Status- und Navigationsleiste, und das Brett wurde um genau die beiden
    // zu hoch. Siehe „Fokus-Brett" in src/index.css.
    expect(layer.style.getPropertyValue("--board-vh")).toBe("800px");

    stub(controls, 160);
    fireEvent(window, new Event("resize"));
    expect(column.style.paddingTop).toBe("150px");
    // Die Leiste zählt weiter als Chrom · nur eben nicht mehr als Verschiebung.
    expect(layer.style.getPropertyValue("--board-chrome")).toBe("261px");
  });

  /**
   * Die Breite der Reihen darf nicht am Brett hängen · sonst dreht sich die
   * Rechnung im Kreis: Eine Zeile mehr macht das Brett kleiner, das kleinere
   * Brett macht die Spalte schmaler, die schmalere Spalte bricht die nächste
   * Zeile um. Genau daran ist der Puzzle-Fokus auf einem schmalen Telefon bis
   * auf die Untergrenze des Bretts zusammengelaufen. Deshalb bindet die
   * Brettbreite nur noch das Brett; die Spalte behält 20 rem.
   */
  it("keeps the rows from shrinking along with the board", () => {
    open(true);
    const layer = screen.getByTestId("focus-board");
    const content = layer.querySelector(".overflow-y-auto") as HTMLDivElement;
    const column = content.firstElementChild as HTMLDivElement;
    const board = column.children[1] as HTMLDivElement;

    expect(column.style.maxWidth).toBe("min(100%, max(var(--board-edge), 20rem))");
    expect(board.style.maxWidth).toBe("var(--board-edge)");
  });

  /** Passt die Bedienung unter dem mittigen Brett nicht mehr, weicht es hoch. */
  it("gives up the lead before it lets the controls run off the screen", () => {
    open(true);
    const layer = screen.getByTestId("focus-board");
    const content = layer.querySelector(".overflow-y-auto") as HTMLDivElement;
    const column = content.firstElementChild as HTMLDivElement;
    const [rows, board, controls] = [...column.children] as HTMLDivElement[];
    const stub = (element: HTMLElement, height: number) => {
      element.getBoundingClientRect = () =>
        ({ height, width: 360, top: 0, bottom: height, left: 0, right: 360, x: 0, y: 0 }) as DOMRect;
    };
    stub(layer, 800);
    stub(content, 740);
    stub(rows, 40);
    stub(board, 360);
    stub(controls, 300);
    fireEvent(window, new Event("resize"));

    // 740 − 40 − 360 − 300 = 40 · mehr Vorlauf gäbe es nur auf Kosten der Leiste.
    expect(column.style.paddingTop).toBe("40px");
  });

  it("offers a labelled handle for opening the focus", () => {
    const onClick = vi.fn();
    render(<FocusButton onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "board.focusOpen" }));
    expect(onClick).toHaveBeenCalled();
  });

  /**
   * Gesperrt bleibt der Griff stehen und erklärt sich · verschwinden würde er
   * nur als Fehler gelesen (siehe components/PlusLock.tsx).
   */
  it("sends the handle into the Plus explanation while it is locked", () => {
    gate.unlocked = false;
    const onClick = vi.fn();
    render(<FocusButton onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "board.focusPlus" }));
    expect(onClick).not.toHaveBeenCalled();
    expect(opened).toHaveBeenCalledWith("focus_board");
  });

  it("stays closed without Plus, even when a page asks for it", () => {
    gate.unlocked = false;
    open(false);
    expect(screen.queryByTestId("focus-board")).toBeNull();
  });

  /** Solange der Plus-Zustand lädt, bleibt alles offen · kein Aufblitzen. */
  it("keeps showing while the entitlement is still loading", () => {
    gate.unlocked = false;
    gate.pending = true;
    open(false);
    expect(screen.getByTestId("focus-board")).toBeTruthy();
  });
});
