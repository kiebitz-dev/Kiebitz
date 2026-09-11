/**
 * Das Buch · was sich an einer Zeile tun lässt.
 *
 * Geprüft wird das, was dem Modus lange fehlte und keine Frage der Erscheinung
 * ist: Eine Variante lässt sich verschieben, ändern und wegnehmen, und mit den
 * Pfeiltasten blättert man durch ihre Züge. Die Griffe stehen dabei nicht an
 * jeder Zeile im Weg — sichtbar sind sie an der aufgeschlagenen.
 *
 * Dazu der Zug auf der Buchstellung: Der Abdruck in der Mitte ist ein Griff,
 * und ein Zug darauf führt in den Baukasten. Geprüft wird die Geste, nicht das
 * Aussehen — tippen–tippen wie am Brett, und ein unzulässiges Ziel darf nichts
 * auslösen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RepertoireBlatt, { type BuchTeil, type RepertoireBlattProps } from "./RepertoireBlatt";

// Die Beschriftungen tragen den Namen der Variante mit · sonst hießen die drei
// Griffe jeder Zeile gleich, und der Test prüfte nur noch Reihenfolgen.
vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({
    locale: "de",
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

const teile: BuchTeil[] = [
  {
    titel: "Weiß",
    seite: "white",
    zeilen: [
      { key: "white:1", name: "Italienische Partie", faellig: 3, zuege: 6 },
      { key: "white:2", name: "Giuoco Pianissimo", faellig: 0, zuege: 10 },
      { key: "white:3", name: "Offener Sizilianer", faellig: 5, zuege: 8 },
    ],
  },
  {
    titel: "Schwarz",
    seite: "black",
    zeilen: [{ key: "black:1", name: "Damengambit Abgelehnt", faellig: 2, zuege: 4 }],
  },
];

function zeichne(over: Partial<RepertoireBlattProps> = {}) {
  const props: RepertoireBlattProps = {
    mobile: false,
    kopfRechts: "rep.summary",
    felder: [{ label: "blatt.variant", wert: "Italienische Partie" }],
    faellig: 10,
    teile,
    aktiv: "white:1",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    unterschrift: ["blatt.bookPosition", "Italienische Partie"],
    amZug: "white",
    seite: "white",
    linie: "1.e4 e5 2.Sf3",
    angaben: [],
    notiz: "",
    notizPlatzhalter: "rep.notePlaceholder",
    abdeckung: null,
    abdeckungNote: "",
    abdeckungUnter: "",
    luecken: "rep.gapsNone",
    aktivZug: 2,
    onWaehlen: vi.fn(),
    onZug: vi.fn(),
    onHinzufuegen: vi.fn(),
    onTraining: vi.fn(),
    ...over,
  };
  return { props, ...render(<RepertoireBlatt {...props} />) };
}

/** Die Zeile einer Variante · sie trägt Namen und Zahl als Beschriftung. */
const zeile = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const griff = (name: string) =>
  screen.getByRole("button", { name: `rep.reorderHandle ${name}` });

describe("Das Buch im Diagramm-Modus", () => {
  it("blättert mit den Pfeiltasten durch die Züge der aufgeschlagenen Variante", () => {
    const onZug = vi.fn();
    zeichne({ onZug, aktiv: "white:1", aktivZug: 2 });

    fireEvent.keyDown(zeile("Italienische Partie"), { key: "ArrowRight" });
    expect(onZug).toHaveBeenLastCalledWith("white:1", 3);

    fireEvent.keyDown(zeile("Italienische Partie"), { key: "ArrowLeft" });
    expect(onZug).toHaveBeenLastCalledWith("white:1", 1);
  });

  it("kommt nicht vor die Grundstellung und nicht hinter den letzten Zug", () => {
    const onZug = vi.fn();
    const { unmount } = zeichne({ onZug, aktiv: "white:1", aktivZug: -1 });
    fireEvent.keyDown(zeile("Italienische Partie"), { key: "ArrowLeft" });
    expect(onZug).toHaveBeenLastCalledWith("white:1", -1);
    unmount();

    zeichne({ onZug, aktiv: "white:1", aktivZug: 5 });
    fireEvent.keyDown(zeile("Italienische Partie"), { key: "ArrowRight" });
    // Sechs Halbzüge · der letzte trägt den Index 5.
    expect(onZug).toHaveBeenLastCalledWith("white:1", 5);
  });

  it("legt die Grundstellung und das Ende der Linie auf Pos1 und Ende", () => {
    const onZug = vi.fn();
    zeichne({ onZug, aktiv: "white:1", aktivZug: 2 });

    fireEvent.keyDown(zeile("Italienische Partie"), { key: "Home" });
    expect(onZug).toHaveBeenLastCalledWith("white:1", -1);

    fireEvent.keyDown(zeile("Italienische Partie"), { key: "End" });
    expect(onZug).toHaveBeenLastCalledWith("white:1", 5);
  });

  it("geht mit ↑/↓ zur nächsten Variante, über den Teil hinweg", () => {
    const onZug = vi.fn();
    zeichne({ onZug, aktiv: "white:3", aktivZug: 7 });

    fireEvent.keyDown(zeile("Offener Sizilianer"), { key: "ArrowDown" });
    // Die letzte Zeile von Weiß führt zur ersten von Schwarz, am letzten Zug.
    expect(onZug).toHaveBeenLastCalledWith("black:1", 3);

    fireEvent.keyDown(zeile("Offener Sizilianer"), { key: "ArrowUp" });
    expect(onZug).toHaveBeenLastCalledWith("white:2", 9);
  });

  it("legt eine Variante mit ↑/↓ am Griff an eine andere Stelle ihrer Seite", () => {
    const onVerschieben = vi.fn();
    zeichne({ onVerschieben });

    fireEvent.keyDown(griff("Italienische Partie"), { key: "ArrowDown" });
    expect(onVerschieben).toHaveBeenCalledWith("white", ["white:2", "white:1", "white:3"]);
  });

  it("schiebt die erste Zeile nicht über den Anfang hinaus", () => {
    const onVerschieben = vi.fn();
    zeichne({ onVerschieben });

    fireEvent.keyDown(griff("Italienische Partie"), { key: "ArrowUp" });
    expect(onVerschieben).not.toHaveBeenCalled();
  });

  it("sortiert nur innerhalb einer Seite · Schwarz bleibt bei Schwarz", () => {
    const onVerschieben = vi.fn();
    zeichne({ onVerschieben });

    fireEvent.keyDown(griff("Damengambit Abgelehnt"), { key: "ArrowUp" });
    expect(onVerschieben).not.toHaveBeenCalled();
  });

  it("reicht Ändern und Wegnehmen mit dem Schlüssel der Zeile nach oben", () => {
    const onBearbeiten = vi.fn();
    const onLoeschen = vi.fn();
    zeichne({ onBearbeiten, onLoeschen, aktiv: "white:2" });

    fireEvent.click(screen.getByRole("button", { name: "rep.editLine Giuoco Pianissimo" }));
    expect(onBearbeiten).toHaveBeenCalledWith("white:2");

    fireEvent.click(screen.getByRole("button", { name: "rep.deleteLine Giuoco Pianissimo" }));
    expect(onLoeschen).toHaveBeenCalledWith("white:2");
  });

  it("gibt einen Zug auf der Buchstellung nach oben", () => {
    const onZugSpielen = vi.fn(() => true);
    const { container } = zeichne({ onZugSpielen });
    const feld = (name: string) =>
      container.querySelector(`[data-square="${name}"]`) as HTMLElement;

    // Tippen–tippen · erst die eigene Figur, dann das Ziel. Die Felder liegen
    // im Raster; das Diagramm rechnet das Feld aus dem Maß, deshalb bekommt
    // die Fläche hier eines gesetzt.
    const flaeche = container.querySelector(".kiebitz-board") as HTMLElement;
    flaeche.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 }) as DOMRect;

    // e2 · Spalte 4, Reihe 6 aus Weißsicht · Mitte des Feldes.
    fireEvent.pointerDown(flaeche, { clientX: 450, clientY: 650 });
    fireEvent.pointerUp(flaeche, { clientX: 450, clientY: 650 });
    // e4 · zwei Reihen höher.
    fireEvent.pointerDown(flaeche, { clientX: 450, clientY: 450 });
    fireEvent.pointerUp(flaeche, { clientX: 450, clientY: 450 });
    expect(onZugSpielen).toHaveBeenCalledWith("e2", "e4");
    expect(feld("e2")).toBeTruthy();
  });

  it("nimmt denselben Zug auch gezogen an", () => {
    const onZugSpielen = vi.fn(() => true);
    const { container } = zeichne({ onZugSpielen });
    const flaeche = container.querySelector(".kiebitz-board") as HTMLElement;
    flaeche.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 }) as DOMRect;

    // Von e2 nach e4 in einem Zug · über der Schwelle ist es ein Ziehen und
    // kein Tippen, und dann geht der Zug direkt nach oben.
    fireEvent.pointerDown(flaeche, { clientX: 450, clientY: 650 });
    fireEvent.pointerMove(flaeche, { clientX: 450, clientY: 560 });
    fireEvent.pointerMove(flaeche, { clientX: 450, clientY: 450 });
    fireEvent.pointerUp(flaeche, { clientX: 450, clientY: 450 });
    expect(onZugSpielen).toHaveBeenCalledWith("e2", "e4");
  });

  it("bleibt ein Abdruck, wo die Seite keinen Zug annimmt", () => {
    const { container } = zeichne({ onZugSpielen: undefined });
    const flaeche = container.querySelector(".kiebitz-board") as HTMLElement;
    flaeche.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 }) as DOMRect;
    // Ohne Handler passiert nichts · und vor allem wirft nichts.
    fireEvent.pointerDown(flaeche, { clientX: 450, clientY: 650 });
    fireEvent.pointerUp(flaeche, { clientX: 450, clientY: 650 });
    expect(screen.queryByText("rep.playToAdd")).toBeNull();
  });

  it("lässt die Griffe fort, wo die Seite keine Handhabe gibt", () => {
    zeichne({ onVerschieben: undefined, onBearbeiten: undefined, onLoeschen: undefined });
    expect(screen.queryByRole("button", { name: /rep\.reorderHandle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /rep\.editLine/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /rep\.deleteLine/ })).toBeNull();
  });
});
