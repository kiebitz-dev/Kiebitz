import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Board from "./Board";

const soundMock = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock("../lib/sound", () => ({
  playBoardSound: (kind: string) => soundMock.played.push(kind),
}));

const boardMock = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  renders: 0,
}));
/**
 * Seit Version 5 nimmt das Brett alles in einem `options`-Objekt entgegen ·
 * die Prüfungen hier lesen deshalb dieses Objekt, nicht die Props.
 */
vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: Record<string, unknown> }) => {
    boardMock.props = options;
    boardMock.renders += 1;
    const onSquareClick = options.onSquareClick as
      | ((args: { piece: null; square: string }) => void)
      | undefined;
    return (
      <div data-testid="chessboard">
        <div data-square="e2"><div data-piece="wP" /></div>
        <div data-square="e3" />
        <div
          data-square="e4"
          onClick={() => onSquareClick?.({ piece: null, square: "e4" })}
        />
      </div>
    );
  },
}));

// jsdom kennt den ResizeObserver nicht, den das Brett fürs Mitwachsen nutzt.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  boardMock.props = null;
  boardMock.renders = 0;
  soundMock.played = [];
});

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN_AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("Board badges", () => {
  it("shows legal targets while a piece is being dragged", () => {
    render(<Board boardId="test" fen={FEN} width={400} draggable />);

    act(() => {
      (boardMock.props?.onPieceDrag as (args: {
        isSparePiece: boolean;
        piece: { pieceType: string };
        square: string | null;
      }) => void)({ isSparePiece: false, piece: { pieceType: "wP" }, square: "e2" });
    });
    const styles = boardMock.props?.squareStyles as Record<string, CSSStyleDeclaration>;
    expect(Object.keys(styles).sort()).toEqual(["e2", "e3", "e4"]);

    act(() => {
      (boardMock.props?.onPieceDragCancel as () => void)();
    });
    expect(boardMock.props?.squareStyles).toEqual({});
  });

  it("uses the shared pointer fallback without rebuilding react-dnd", () => {
    const onPieceDrop = vi.fn(() => true);
    const onSquareClick = vi.fn();
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        draggable
        mouseDrag
        onPieceDrop={onPieceDrop}
        onSquareClick={onSquareClick}
      />
    );

    expect(boardMock.props?.allowDragging).toBe(false);
    expect(boardMock.props?.animationDurationInMs).toBe(0);
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;
    const target = document.querySelector<HTMLElement>('[data-square="e4"]')!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });

    const styles = boardMock.props?.squareStyles as Record<string, CSSStyleDeclaration>;
    expect(Object.keys(styles).sort()).toEqual(["e2", "e3", "e4"]);

    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).toHaveBeenCalledWith("e2", "e4");
    expect(piece.style.visibility).toBe("");

    // Ein verspäteter Android-Kompatibilitätsklick darf den Zug nicht als
    // Click-&-Move-Eingabe wiederholen.
    fireEvent.click(target);
    expect(onSquareClick).not.toHaveBeenCalled();

    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: undefined,
      });
    }
  });

  it("keeps engine overlays and changing callbacks out of the 64-square render tree", () => {
    const firstDrop = vi.fn(() => true);
    const latestDrop = vi.fn(() => true);
    const view = render(
      <Board
        boardId="stable"
        fen={FEN}
        width={400}
        draggable
        onPieceDrop={firstDrop}
        arrows={[["e2", "e4", "#22c08a"]]}
      />
    );
    expect(boardMock.renders).toBe(1);

    view.rerender(
      <Board
        boardId="stable"
        fen={FEN}
        width={400}
        draggable
        onPieceDrop={latestDrop}
        squareStyles={{}}
        arrows={[["d2", "d4", "#d9a028"]]}
      />
    );

    // The lightweight SVG changed, but react-chessboard did not reconcile.
    expect(boardMock.renders).toBe(1);
    expect(screen.getByTestId("board-arrows").querySelector("line")?.getAttribute("stroke"))
      .toBe("#d9a028");

    const drop = boardMock.props?.onPieceDrop as (args: {
      piece: { isSparePiece: boolean; position: string; pieceType: string };
      sourceSquare: string;
      targetSquare: string | null;
    }) => boolean;
    expect(
      drop({
        piece: { isSparePiece: false, position: "e2", pieceType: "wP" },
        sourceSquare: "e2",
        targetSquare: "e4",
      })
    ).toBe(true);
    expect(firstDrop).not.toHaveBeenCalled();
    expect(latestDrop).toHaveBeenCalledWith("e2", "e4");
  });

  it("marks both squares of the last move, under everything a page marks itself", () => {
    const view = render(
      <Board
        boardId="test"
        fen={FEN_AFTER_E4}
        width={400}
        lastMove={{ from: "e2", to: "e4" }}
        squareStyles={{ e4: { background: "own" } }}
      />
    );

    let styles = boardMock.props?.squareStyles as Record<string, { background: string }>;
    expect(String(styles.e2.background)).toBe("var(--color-mark-soft)");
    // Was die Seite selbst setzt, schlägt die Markierung.
    expect(String(styles.e4.background)).toBe("own");

    view.rerender(<Board boardId="test" fen={FEN_AFTER_E4} width={400} />);
    styles = boardMock.props?.squareStyles as Record<string, { background: string }>;
    expect(styles).toEqual({});
  });

  it("cancels the imperative drag when the position changes", () => {
    const onPieceDrop = vi.fn(() => true);
    const view = render(
      <Board
        boardId="changing"
        fen={FEN}
        width={400}
        draggable
        mouseDrag
        silent
        onPieceDrop={onPieceDrop}
      />
    );
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });
    expect(piece.style.visibility).toBe("hidden");
    expect(document.querySelectorAll('[data-piece="wP"]')).toHaveLength(2);

    view.rerender(
      <Board
        boardId="changing"
        fen={FEN_AFTER_E4}
        width={400}
        draggable
        mouseDrag
        silent
        onPieceDrop={onPieceDrop}
      />
    );
    expect(piece.style.visibility).toBe("");
    expect(document.querySelectorAll('[data-piece="wP"]')).toHaveLength(1);

    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).not.toHaveBeenCalled();
  });

  it("does not complete a drag on a square from another board", () => {
    const onPieceDrop = vi.fn(() => true);
    render(
      <>
        <Board boardId="active" fen={FEN} width={400} draggable mouseDrag onPieceDrop={onPieceDrop} />
        <div data-square="d4" data-testid="foreign-square" />
      </>
    );
    const piece = document.querySelector<HTMLElement>('[data-piece="wP"]')!;
    const foreignSquare = screen.getByTestId("foreign-square");
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => foreignSquare),
    });

    fireEvent.mouseDown(piece, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window, { button: 0, clientX: 20, clientY: 20 });
    expect(onPieceDrop).not.toHaveBeenCalled();

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });

  it("disables move animation on Android and blocks native text dragging", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36"
    );
    render(<Board boardId="android" fen={FEN} width={400} draggable mouseDrag />);

    expect(boardMock.props?.animationDurationInMs).toBe(0);
    const wrapper = screen.getByTestId("chessboard").closest(".kiebitz-board")!;
    expect(fireEvent.dragStart(wrapper)).toBe(false);
  });

  it("centers the marker on the top-right corner of the target square", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "e4", label: "!!", color: "#22c08a", title: "Brillant" }]}
      />
    );

    const badge = screen.getByTitle("Brillant");
    // e-Linie = Index 4 → rechte Kante bei (4 + 1) × 12,5 %, Reihe 4 → 50 % von oben.
    expect(badge.style.left).toBe("62.5%");
    expect(badge.style.top).toBe("50%");
    expect(badge.style.transform).toBe("translate(-50%, -50%)");
  });

  it("mirrors the corner when the board is flipped", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        orientation="black"
        badges={[{ square: "e4", label: "??", color: "#e66767", title: "Patzer" }]}
      />
    );

    // Gedreht liegt die e-Linie an Index 3 und Reihe 4 in der vierten Zeile.
    const badge = screen.getByTitle("Patzer");
    expect(badge.style.left).toBe("50%");
    expect(badge.style.top).toBe("37.5%");
  });

  it("keeps a marker at the edge of the board fully on the board", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "h8", label: "?", color: "#e66767", title: "Fehler" }]}
      />
    );

    // Ohne Grenze stünde der Marker bei 100 % / 0 % und damit zur Hälfte
    // neben dem Brett · auf dem Handy bekäme die Seite dadurch eine
    // waagerechte Bildlaufleiste. Er rückt um seinen halben Durchmesser
    // (6,5 % / 2) herein und schließt so genau mit der Brettkante ab.
    const badge = screen.getByTitle("Fehler");
    expect(badge.style.left).toBe("96.75%");
    expect(badge.style.top).toBe("3.25%");
  });

  it("renders element labels such as the book symbol", () => {
    render(
      <Board
        boardId="test"
        fen={FEN}
        width={400}
        badges={[{ square: "d4", label: <svg data-testid="book-icon" />, color: "#a88865", title: "Buchzug" }]}
      />
    );

    expect(screen.getByTestId("book-icon")).toBeTruthy();
  });
});

describe("Board end overlay", () => {
  const END = {
    square: "e1",
    mark: "#",
    color: "var(--color-loss)",
    label: "Schwarz gewinnt durch Matt",
    dismissLabel: "Hinweis ausblenden",
  };

  it("marks the king's square and shows the result strip", () => {
    render(<Board boardId="test" fen={FEN} width={400} end={END} />);

    const mark = screen.getByTestId("board-end-mark");
    // e1 aus Weiß-Sicht: fünfte Spalte (Index 4), unterste Reihe (Index 7) ·
    // der Marker sitzt auf der oberen rechten Feldecke wie die Zugmarker.
    expect(mark.style.left).toBe("62.5%");
    expect(mark.style.top).toBe("87.5%");
    expect(screen.getByText("Schwarz gewinnt durch Matt")).toBeTruthy();
  });

  it("follows the board orientation", () => {
    render(<Board boardId="test" fen={FEN} width={400} orientation="black" end={END} />);

    // Gedreht liegt e1 in Spalte 3 und der obersten Reihe · dort rückt der
    // Marker um seinen halben Durchmesser (7,5 % / 2) herein, statt zur
    // Hälfte über die Brettkante hinauszustehen.
    const mark = screen.getByTestId("board-end-mark");
    expect(mark.style.left).toBe("50%");
    expect(mark.style.top).toBe("3.75%");
  });

  it("hides the strip on click and brings it back for the next ending", () => {
    const { rerender } = render(<Board boardId="test" fen={FEN} width={400} end={END} />);

    fireEvent.click(screen.getByText("Schwarz gewinnt durch Matt"));
    expect(screen.queryByText("Schwarz gewinnt durch Matt")).toBeNull();
    // Der Marker bleibt · weggeklickt wird nur der Satz.
    expect(screen.getByTestId("board-end-mark")).toBeTruthy();

    rerender(
      <Board boardId="test" fen={FEN} width={400} end={{ ...END, label: "Remis durch Patt" }} />
    );
    expect(screen.getByText("Remis durch Patt")).toBeTruthy();
  });

  it("keeps the marker alone when there is no sentence to show", () => {
    render(<Board boardId="test" fen={FEN} width={400} end={{ ...END, label: "" }} />);

    expect(screen.getByTestId("board-end-mark")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing at all without an ending", () => {
    render(<Board boardId="test" fen={FEN} width={400} />);

    expect(screen.queryByTestId("board-end")).toBeNull();
  });
});

/**
 * Eigene Markierungen · rechte Maustaste am Rechner, zweiter Finger am Handy.
 *
 * Das Brett rechnet das Feld aus seiner eigenen Kante; in jsdom hat die
 * Kante keine Größe, deshalb legt `stubSurface` ihr eine an: 80 px Kante,
 * also 10 px je Feld.
 */
describe("Board shapes", () => {
  const stubSurface = () => {
    const surface = document.querySelector<HTMLElement>(".kiebitz-board > div")!;
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 80, height: 80, right: 80, bottom: 80, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return surface;
  };

  /** Mittelpunkt eines Feldes auf dem gestubbten Brett (Weiß unten). */
  const at = (square: string) => ({
    clientX: (square.charCodeAt(0) - 97) * 10 + 5,
    clientY: (8 - Number(square[1])) * 10 + 5,
  });

  const arrows = () =>
    document.querySelectorAll('[data-testid="board-arrows"] line').length;
  const circles = () =>
    document.querySelectorAll('[data-testid="board-circles"] circle').length;

  const drawWithMouse = (surface: HTMLElement, from: string, to: string, init = {}) => {
    fireEvent.pointerDown(surface, { button: 2, buttons: 2, pointerId: 3, ...at(from), ...init });
    fireEvent.pointerMove(window, { pointerId: 3, ...at(to), ...init });
    fireEvent.pointerUp(window, { button: 2, pointerId: 3, ...at(to), ...init });
  };

  it("draws an arrow by dragging with the right mouse button", () => {
    render(<Board boardId="test" fen={FEN} width={400} />);
    const surface = stubSurface();

    fireEvent.pointerDown(surface, { button: 2, buttons: 2, pointerId: 3, ...at("e2") });
    fireEvent.pointerMove(window, { pointerId: 3, ...at("e4") });
    // Der Pfeil hängt schon während des Ziehens am Zeiger.
    expect(arrows()).toBe(1);
    fireEvent.pointerUp(window, { button: 2, pointerId: 3, ...at("e4") });

    expect(arrows()).toBe(1);
    expect(circles()).toBe(0);
  });

  it("draws a circle when the right button stays on one square", () => {
    render(<Board boardId="test" fen={FEN} width={400} />);
    const surface = stubSurface();

    drawWithMouse(surface, "d4", "d4");
    expect(circles()).toBe(1);
    expect(arrows()).toBe(0);

    // Dieselbe Markierung noch einmal löscht sie wieder.
    drawWithMouse(surface, "d4", "d4");
    expect(circles()).toBe(0);
  });

  it("recolours the same squares instead of stacking a second shape", () => {
    render(<Board boardId="test" fen={FEN} width={400} />);
    const surface = stubSurface();

    drawWithMouse(surface, "d4", "d4");
    drawWithMouse(surface, "d4", "d4", { shiftKey: true });
    expect(circles()).toBe(1);
    expect(
      document.querySelector('[data-testid="board-circles"] circle')?.getAttribute("stroke")
    ).toBe("rgb(190,48,48)");
  });

  it("keeps the engine arrows underneath its own", () => {
    render(<Board boardId="test" fen={FEN} width={400} arrows={[["g1", "f3", "rgb(1,2,3)"]]} />);
    const surface = stubSurface();

    drawWithMouse(surface, "e2", "e4");
    const strokes = [...document.querySelectorAll('[data-testid="board-arrows"] line')].map(
      (line) => line.getAttribute("stroke")
    );
    expect(strokes).toEqual(["rgb(1,2,3)", "rgb(21,128,61)"]);
  });

  it("wipes the shapes on a left click and on a new position", () => {
    const { rerender } = render(<Board boardId="test" fen={FEN} width={400} />);
    const surface = stubSurface();

    drawWithMouse(surface, "e2", "e4");
    fireEvent.pointerDown(surface, { button: 0, buttons: 1, pointerId: 4, ...at("a1") });
    expect(arrows()).toBe(0);

    drawWithMouse(surface, "e2", "e4");
    expect(arrows()).toBe(1);
    rerender(<Board boardId="test" fen={FEN_AFTER_E4} width={400} />);
    expect(arrows()).toBe(0);
  });

  it("draws with a second finger and leaves the first one to the pieces", () => {
    const onPieceDrop = vi.fn(() => true);
    render(
      <Board boardId="test" fen={FEN} width={400} draggable mouseDrag onPieceDrop={onPieceDrop} />
    );
    const surface = stubSurface();

    // Der erste Finger liegt auf dem Brett · der zweite zeichnet. Welcher der
    // erste ist, sagt `isPrimary` — genau wie in der WebView.
    fireEvent.pointerDown(surface, {
      button: 0, buttons: 1, pointerId: 1, pointerType: "touch", isPrimary: true, ...at("a1"),
    });
    fireEvent.pointerDown(surface, {
      button: 0, buttons: 1, pointerId: 2, pointerType: "touch", isPrimary: false, ...at("e2"),
    });
    fireEvent.pointerMove(window, { pointerId: 2, pointerType: "touch", ...at("e4") });
    fireEvent.pointerUp(window, {
      button: 0, pointerId: 2, pointerType: "touch", isPrimary: false, ...at("e4"),
    });
    fireEvent.pointerUp(window, {
      button: 0, pointerId: 1, pointerType: "touch", isPrimary: true, ...at("a1"),
    });

    expect(arrows()).toBe(1);
    expect(onPieceDrop).not.toHaveBeenCalled();

    // Ein einzelner Finger wischt die Markierungen erst beim Loslassen weg ·
    // sonst hätte der Finger, der zum Zeichnen dazukommt, sie mitgenommen.
    fireEvent.pointerDown(surface, {
      button: 0, buttons: 1, pointerId: 5, pointerType: "touch", isPrimary: true, ...at("b3"),
    });
    expect(arrows()).toBe(1);
    fireEvent.pointerUp(window, {
      button: 0, pointerId: 5, pointerType: "touch", isPrimary: true, ...at("b3"),
    });
    expect(arrows()).toBe(0);
  });

  /**
   * Der Zug mit dem Finger hält sein `pointerup` an, damit der
   * Kompatibilitäts-Klick der WebView den Zug nicht ein zweites Mal auslöst.
   * Solange das Zeichnen die liegenden Finger selbst zählte, kam bei ihm
   * genau dieses Loslassen nie an: Nach dem ersten gezogenen Zug galt jeder
   * weitere Finger als der zweite, und statt der Figur bewegte sich ein Pfeil.
   */
  it("still drags pieces after a finished drag", () => {
    const onPieceDrop = vi.fn(() => true);
    render(
      <Board boardId="test" fen={FEN} width={400} draggable mouseDrag onPieceDrop={onPieceDrop} />
    );
    stubSurface();
    const piece = document.querySelector<HTMLElement>('[data-square="e2"] [data-piece]')!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.querySelector('[data-square="e4"]')),
    });

    // Ausgelöst wird am Feld und nicht am Fenster · nur so laufen die
    // Zeigerereignisse wirklich erst durch die Griff-, dann durch die
    // Blasenphase, und genau daran hing der Fehler.
    const dragPiece = (pointerId: number, from: string, to: string) => {
      fireEvent.pointerDown(piece, {
        button: 0, buttons: 1, pointerId, pointerType: "touch", isPrimary: true, ...at(from),
      });
      fireEvent.pointerMove(piece, { pointerId, pointerType: "touch", ...at(to) });
      fireEvent.pointerUp(piece, {
        button: 0, pointerId, pointerType: "touch", isPrimary: true, ...at(to),
      });
    };

    dragPiece(11, "e2", "e4");
    expect(onPieceDrop).toHaveBeenCalledTimes(1);

    // Derselbe Griff ein zweites Mal · und nicht plötzlich ein Pfeil.
    dragPiece(12, "e2", "e4");
    expect(onPieceDrop).toHaveBeenCalledTimes(2);
    expect(arrows()).toBe(0);

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
  });
});

/**
 * Der Klang gehört zum Zug und nicht zum Brett · und ein Zug ist einer, auch
 * wenn zwei Bretter ihn zeigen. Genau das passiert, sobald das Fokus-Brett
 * offen ist: Es legt sich über die Seite, das Brett darunter bleibt stehen,
 * und beide sehen denselben Stellungswechsel.
 */
describe("Board sound", () => {
  it("plays one sound per position change", () => {
    const view = render(<Board boardId="single" fen={FEN} width={400} />);
    view.rerender(<Board boardId="single" fen={FEN_AFTER_E4} width={400} />);
    expect(soundMock.played).toEqual(["move"]);
  });

  it("plays it once even while a second board shows the same position", () => {
    // Ein anderer Zug als in der Prüfung darüber · derselbe wäre für das
    // Fenster von 200 ms womöglich derselbe Wechsel, und die Prüfung liefe
    // dann gegen den Schutz statt gegen den Fehler.
    const nachD4 = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
    const paar = (fen: string) => (
      <>
        <Board boardId="page" fen={fen} width={400} />
        <Board boardId="focus" fen={fen} width={400} />
      </>
    );
    const view = render(paar(FEN));
    view.rerender(paar(nachD4));
    expect(soundMock.played).toEqual(["move"]);
  });

  it("stays silent where the page asks for silence", () => {
    const view = render(<Board boardId="quiet" fen={FEN} width={400} silent />);
    view.rerender(<Board boardId="quiet" fen={FEN_AFTER_E4} width={400} silent />);
    expect(soundMock.played).toEqual([]);
  });
});
