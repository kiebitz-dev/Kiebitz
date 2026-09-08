/**
 * Das Blatt der Analyse.
 *
 * Geprüft wird, was die Seite an Bedienung trägt und nicht bloß an Satz: die
 * Bewertungskurve als Griff in die Partie — mit dem Zeiger wie mit der Tastatur
 * —, die Schlagliste unter dem Namen und die Brettspalte auf dem Maß der
 * gewöhnlichen Fassung.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AnalysisBlatt, { type AnalysisBlattProps } from "./AnalysisBlatt";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

/** Zehn Halbzüge · genug für eine Kurve, kurz genug zum Nachrechnen. */
const kurve = [0.1, 0.3, -0.2, 0.4, 1.2, 0.8, -1.5, -2, -1.8, -3];

function show(props: Partial<AnalysisBlattProps> = {}) {
  const onPly = vi.fn();
  render(
    <AnalysisBlatt
      mobile={false}
      frei={false}
      kopfRechts="Nr. 7"
      felder={[{ label: "common.white", wert: "Torim98" }]}
      ergebnis="1 : 0"
      oben={{ name: "DragonSlayer_88", elo: 1448, farbe: "black" }}
      unten={{ name: "Torim98", elo: 1462, farbe: "white" }}
      brett={<div data-testid="brett" />}
      zuege={kurve.map((_, i) => ({ san: i % 2 === 0 ? "e4" : "e5" }))}
      ply={5}
      onPly={onPly}
      kurve={kurve}
      bewertung={1.2}
      bilanz={[]}
      acpl={{ white: 20, black: 30 }}
      genauigkeit={91.2}
      {...props}
    />
  );
  return onPly;
}

const kurvengriff = () => screen.getByRole("slider");

describe("Blatt der Analyse", () => {
  /**
   * jsdom misst nichts · der Kasten kommt deshalb gestellt. Geprüft wird die
   * Rechnung vom Zeigepunkt auf den Halbzug, nicht der Layoutalgorithmus des
   * Browsers.
   */
  it("springt vom Zeigepunkt auf der Kurve in die Partie", () => {
    const onPly = show();
    const griff = kurvengriff();
    griff.getBoundingClientRect = () =>
      ({ left: 100, width: 300, top: 0, height: 76 }) as DOMRect;
    // Ohne echten Zeiger gibt es nichts einzufangen · die beiden Rufe sind für
    // den Test nur Rauschen.
    griff.setPointerCapture = () => {};
    griff.hasPointerCapture = () => false;

    // Genau in der Mitte von zehn Werten liegt Index 4,5 · aufgerundet 5, und
    // der erste Wert ist Halbzug 1.
    fireEvent.pointerDown(griff, { clientX: 250, pointerId: 1 });
    expect(onPly).toHaveBeenLastCalledWith(6);

    fireEvent.pointerDown(griff, { clientX: 100, pointerId: 1 });
    expect(onPly).toHaveBeenLastCalledWith(1);

    fireEvent.pointerDown(griff, { clientX: 400, pointerId: 1 });
    expect(onPly).toHaveBeenLastCalledWith(kurve.length);

    // Weit daneben bleibt in der Partie, statt hinter ihr Ende zu laufen.
    fireEvent.pointerDown(griff, { clientX: 900, pointerId: 1 });
    expect(onPly).toHaveBeenLastCalledWith(kurve.length);
  });

  it("führt dieselbe Bewegung mit der Tastatur", () => {
    const onPly = show({ ply: 5 });
    const griff = kurvengriff();
    expect(griff.getAttribute("aria-valuenow")).toBe("5");

    fireEvent.keyDown(griff, { key: "ArrowRight" });
    expect(onPly).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(griff, { key: "ArrowLeft" });
    expect(onPly).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(griff, { key: "Home" });
    expect(onPly).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(griff, { key: "End" });
    expect(onPly).toHaveBeenLastCalledWith(kurve.length);
  });

  it("zeigt die Schlagliste unter dem Namen, den sie meint", () => {
    show({
      oben: { name: "DragonSlayer_88", elo: 1448, farbe: "black", geschlagen: <i>oben</i> },
      unten: { name: "Torim98", elo: 1462, farbe: "white", geschlagen: <i>unten</i> },
    });
    const zeile = screen.getByText("DragonSlayer_88").closest("span.flex-1")!;
    expect(zeile.textContent).toContain("oben");
    expect(zeile.textContent).not.toContain("unten");
  });

  /**
   * Das Brett ist das, wofür man den Tab öffnet · es steht auf dem Maß der
   * gewöhnlichen Fassung und nicht auf einem eigenen, kleineren.
   */
  it("gibt der Brettspalte das Maß der gewöhnlichen Fassung", () => {
    show();
    const spalte = screen.getByTestId("brett").parentElement!;
    expect(spalte.className).toContain("w-[var(--board-col)]");
  });
});
