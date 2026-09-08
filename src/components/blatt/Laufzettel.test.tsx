/**
 * Der Laufzettel.
 *
 * Geprüft wird, was ihn vom Kreisel der gewöhnlichen Fassung unterscheidet:
 * zwei gezählte Größen statt einer, ein Abbruch, der abbricht, und ein Zettel,
 * der lieber leer bleibt als erfundene Zahlen zu tragen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Laufzettel, type LaufStand } from "./Laufzettel";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

const stand: LaufStand = {
  partie: 2,
  partienGesamt: 216,
  opponent: "e_goncalvees",
  halbzug: 27,
  halbzuege: 58,
};

describe("Laufzettel", () => {
  it("zählt Stapel und Partie getrennt", () => {
    render(<Laufzettel stand={stand} onStopp={() => {}} />);
    expect(screen.getByText("216")).toBeTruthy();
    expect(screen.getByText("e_goncalvees")).toBeTruthy();
    // Gerechnet wird in Halbzügen, gelesen in ganzen · 27 von 58 ist Zug 14
    // von 29, und genau so steht es auf jedem Formular.
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("29")).toBeTruthy();
  });

  /**
   * Beide Striche stehen auf demselben Maßstab: gleicher Anfang, gleiche
   * Länge. Sonst verglichen die Zeilen zwei Größen, die verschieden weit
   * laufen.
   */
  it("stellt beide Striche auf dasselbe Maß", () => {
    const { container } = render(<Laufzettel stand={stand} onStopp={() => {}} />);
    const striche = container.querySelectorAll("span.border-line2");
    expect(striche.length).toBe(2);
    const anteile = [...striche].map(
      (strich) => (strich.firstElementChild as HTMLElement).style.width
    );
    expect(anteile[0]).toBe(`${(2 / 216) * 100}%`);
    // Der Strich rechnet mit den Zahlen, die daneben stehen · ein Balken, der
    // 46,6 % füllt, während „14 / 29" dasteht, wäre ein zweiter Wert.
    expect(anteile[1]).toBe(`${(14 / 29) * 100}%`);
  });

  it("trägt nur die Überschrift, solange nichts gemeldet ist", () => {
    render(<Laufzettel stand={null} onStopp={() => {}} />);
    expect(screen.getByText("an.running")).toBeTruthy();
    expect(screen.queryByText("an.game")).toBeNull();
  });

  it("bricht den Lauf ab", () => {
    const onStopp = vi.fn();
    render(<Laufzettel stand={stand} onStopp={onStopp} />);
    fireEvent.click(screen.getByRole("button", { name: "an.stop" }));
    expect(onStopp).toHaveBeenCalled();
  });

  /** Ohne gemeldete Gesamtzahl bleibt der Strich leer statt durch null zu teilen. */
  it("bleibt bei einer fehlenden Gesamtzahl leer", () => {
    const { container } = render(
      <Laufzettel stand={{ ...stand, partienGesamt: 0 }} onStopp={() => {}} />
    );
    const strich = container.querySelector("span.border-line2")!;
    expect((strich.firstElementChild as HTMLElement).style.width).toBe("0%");
  });
});
