/**
 * Der Stellungseditor · das Textfeld und das Brett müssen dasselbe meinen,
 * und eine Stellung, die nicht spielbar ist, darf nicht weitergereicht werden.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PositionEditor, { parseEditorFen } from "./PositionEditor";
import { ShellProvider } from "./MobileShell";

const modus = vi.hoisted(() => ({ diagramm: false }));
vi.mock("../lib/diagramMode", () => ({ useDiagramMode: () => modus.diagramm }));

// Das echte Brett misst sich mit einem ResizeObserver, den jsdom nicht kennt ·
// hier zählt nur, was der Editor daraus macht.
vi.mock("./Board", () => ({
  default: ({ fen }: { fen: string }) => <div data-testid="board">{fen}</div>,
}));

describe("parseEditorFen", () => {
  it("keeps side to move, castling and clocks", () => {
    const state = parseEditorFen("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 3 17")!;
    expect(state.turn).toBe("b");
    expect(state.castle).toEqual({ K: true, Q: false, k: false, q: true });
    expect(state.half).toBe(3);
    expect(state.full).toBe(17);
    expect(state.chess960).toBe(false);
  });

  it("recognises a Chess960 position by its castling", () => {
    expect(parseEditorFen("nbqrbkrn/pppppppp/8/8/8/8/PPPPPPPP/NBQRBKRN w KQkq - 0 1")!.chess960).toBe(true);
  });

  it("rejects text that is not a board", () => {
    expect(parseEditorFen("hello")).toBeNull();
    expect(parseEditorFen("8/8/8/8/8/8/8 w - - 0 1")).toBeNull();
  });
});

describe("PositionEditor", () => {
  it("hands a pasted FEN on to the analysis", () => {
    const onAnalyze = vi.fn();
    render(<PositionEditor onClose={() => {}} onAnalyze={onAnalyze} />);
    const field = screen.getByLabelText("FEN");
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    fireEvent.change(field, { target: { value: fen } });
    fireEvent.click(screen.getByRole("button", { name: /Analysieren/ }));
    expect(onAnalyze).toHaveBeenCalledWith({ fen, chess960: false });
  });

  it("blocks a position without a king and says why", () => {
    const onAnalyze = vi.fn();
    render(<PositionEditor onClose={() => {}} onAnalyze={onAnalyze} initialFen="8/8/8/8/8/8/8/4K3 w - - 0 1" />);
    expect(screen.getByRole("status").textContent).toMatch(/genau einen König/);
    expect((screen.getByRole("button", { name: /Analysieren/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers castling only where king and rook stand", () => {
    render(<PositionEditor onClose={() => {}} initialFen="4k3/8/8/8/8/8/8/4K2R w K - 0 1" />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // Weiß O-O, Weiß O-O-O, Schwarz O-O, Schwarz O-O-O, Chess960.
    expect(boxes.map((box) => box.disabled)).toEqual([false, true, true, true, false]);
    expect(boxes[0].checked).toBe(true);
  });

  /**
   * Mobil brach „Weiß am Zug" neben drei Knöpfen in Stücke. Dort steht der
   * Stand allein, und Abbrechen fällt weg · Kreuz und Zurück-Geste schließen.
   */
  it("keeps the status on its own line and drops cancel on the phone", () => {
    render(
      <ShellProvider mobile>
        <PositionEditor onClose={() => {}} onAnalyze={() => {}} onPlay={() => {}} />
      </ShellProvider>
    );
    expect(screen.getByRole("status").textContent).toBe("Weiß am Zug");
    expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull();
    expect(screen.getByRole("button", { name: /Gegen die Engine/ })).toBeTruthy();
  });

  /** Im Diagramm-Modus ein Bogen des Blattes, nicht die Karte der gewöhnlichen Fassung. */
  it("is set as a sheet in diagram mode", () => {
    modus.diagramm = true;
    try {
      const onAnalyze = vi.fn();
      render(<PositionEditor onClose={() => {}} onAnalyze={onAnalyze} />);
      const dialog = screen.getByRole("dialog");
      expect(dialog.querySelector("[data-blatt]")).not.toBeNull();
      expect(dialog.querySelector(".blatt-formular")).not.toBeNull();
      expect(dialog.querySelector(".rounded-2xl")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Analysieren" }));
      expect(onAnalyze).toHaveBeenCalled();
    } finally {
      modus.diagramm = false;
    }
  });
});
