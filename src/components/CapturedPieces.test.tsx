import { describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import CapturedPieces from "./CapturedPieces";
import { PIECE_GLYPH } from "./pieceGlyphs";
import { DEFAULT_APPEARANCE, setAppearance, setPlusUnlocked } from "../lib/theme";

afterEach(cleanup);

describe("Schlagliste", () => {
  it("zeigt je geschlagener Figur eine Zeichnung", () => {
    const { container } = render(
      <CapturedPieces pieces={["p", "p", "n"]} color="black" advantage={0} />
    );
    expect(container.querySelectorAll("[data-glyph]").length).toBe(3);
  });

  it("benutzt dieselben Zeichnungen wie das Brett", () => {
    // Nicht „sieht \u00e4hnlich aus", sondern derselbe Inhalt: sonst h\u00e4tte die App
    // zwei Figurens\u00e4tze, die bei einem Update auseinanderlaufen.
    const { container } = render(<CapturedPieces pieces={["n"]} color="white" advantage={0} />);
    expect(container.querySelector("[data-glyph='wN']")?.innerHTML).toBe(PIECE_GLYPH.wN);
  });

  // Ein gewähltes Set kommt nachgeladen (`lib/pieces/glyphs.ts`). Bis es da
  // ist, steht der klassische Satz auf dem Brett · danach muss der Tausch von
  // allein passieren, sonst zeigt die Schlagliste dauerhaft die falschen
  // Figuren.
  it("tauscht die Zeichnungen, sobald das gewählte Set da ist", async () => {
    setPlusUnlocked(true);
    act(() => setAppearance({ ...DEFAULT_APPEARANCE, pieceSet: "merida" }));
    const { container } = render(<CapturedPieces pieces={["n"]} color="white" advantage={0} />);
    const glyph = () => container.querySelector("[data-glyph='wN']")?.innerHTML ?? "";

    expect(glyph()).toBe(PIECE_GLYPH.wN);
    await waitFor(() => expect(glyph()).toContain("merida-wN-"));

    act(() => setAppearance(DEFAULT_APPEARANCE));
    setPlusUnlocked(null);
    await waitFor(() => expect(glyph()).toBe(PIECE_GLYPH.wN));
  });

  it("nennt den Materialvorsprung nur, wenn es einen gibt", () => {
    const { rerender } = render(
      <CapturedPieces pieces={["r"]} color="black" advantage={5} />
    );
    expect(screen.getByText("+5")).toBeTruthy();

    // Die R\u00fcckstandsseite zeigt ihre Figuren, aber keine negative Zahl.
    rerender(<CapturedPieces pieces={["p"]} color="white" advantage={-5} />);
    expect(screen.queryByText(/[+-]5/)).toBeNull();
  });

  it("entf\u00e4llt ganz, solange nichts geschlagen ist", () => {
    const { container } = render(<CapturedPieces pieces={[]} color="white" advantage={0} />);
    expect(container.firstChild).toBeNull();
  });

  /**
   * Im Diagramm-Modus bleibt der Streifen \u2014 die Figuren brauchen ihr helles
   * Feld \u2014, aber er wird eckig, und der Vorsprung steht in den Ziffern des
   * Formulars. Auf einem Bogen ist nichts abgerundet.
   */
  it("setzt denselben Streifen im Blatt eckig", () => {
    const { container, rerender } = render(
      <CapturedPieces pieces={["p", "n"]} color="black" advantage={3} />
    );
    const streifen = () => container.querySelector("[data-captured] > span")!;
    expect(streifen().className).toContain("rounded-");
    expect(screen.getByText("+3").className).toContain("tabular-nums");

    rerender(<CapturedPieces blatt pieces={["p", "n"]} color="black" advantage={3} />);
    expect(streifen().className).toContain("bg-board-light");
    expect(streifen().className).not.toContain("rounded-");
    expect(screen.getByText("+3").className).toContain("blatt-zahl");
  });
});
