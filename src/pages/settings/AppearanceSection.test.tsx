/**
 * Die Zeile für den Layoutmodus, die Reihenfolge der Abschnitte und das, was
 * ohne Plus gesperrt ist.
 *
 * Die Themenauswahl daneben hat ihre Prüfung in theme.test.ts; hier geht es um
 * die eine Zeile darüber — darum, dass sie den Modus nennt, in den sie führt,
 * und dass sie auch ohne Plus schaltet statt in die Erklärung zu springen —,
 * darum, dass der automatische Wechsel direkt unter den Kacheln steht, und
 * darum, welche Bretter die Sperre überhaupt betrifft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AppearanceSection from "./AppearanceSection";
import { onPlusDialog } from "../../lib/plus/dialog";
import { DEFAULT_APPEARANCE, THEME_FEATURE, type Appearance } from "../../lib/theme";
import { grantPlus, revokePlus } from "../../test/plus";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
}));

// Die Zeichnungen kommen sonst über die Tauri-Brücke · für diese Zeile zählt
// nur, dass die Vorschau daneben rendert.
vi.mock("../../lib/pieces/glyphs", () => ({
  PIECE_VIEWBOX: "0 0 45 45",
  glyphsVersion: () => 0,
  loadPieceGlyphs: () => Promise.resolve({}),
  pieceGlyphs: () => ({}),
  subscribeGlyphs: () => () => {},
}));

const onChange = vi.fn();

function show(overrides: Partial<Appearance> = {}) {
  render(<AppearanceSection appearance={{ ...DEFAULT_APPEARANCE, ...overrides }} onChange={onChange} />);
}

beforeEach(() => {
  onChange.mockReset();
  grantPlus();
});

afterEach(cleanup);

describe("automatischer Wechsel", () => {
  it("steht zwischen den Themenkacheln und dem Brett", () => {
    show();
    const themes = screen.getByText("theme.dark");
    const wechsel = screen.getByText("set.themeAuto");
    const brett = screen.getByText("set.boardSet");
    const folgt = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(folgt(themes, wechsel)).toBe(true);
    expect(folgt(wechsel, brett)).toBe(true);
  });

  it("sagt nicht mehr, dass die Wahl übergangen wurde", () => {
    // Der Hinweis stand zwischen Wahl und Wechsel · mit dem Wechsel eine Zeile
    // unter den Kacheln erklärt sich der übergangene Fall von selbst.
    localStorage.setItem("kiebitz.appearance", JSON.stringify({ theme: "dark" }));
    show({ theme: "paper", auto: "time", night: "dark" });
    expect(screen.queryByText("set.themeOverridden")).toBeNull();
    expect(screen.queryByText("set.themeAutoStop")).toBeNull();
    localStorage.clear();
  });
});

describe("layout mode row", () => {
  it("stands above the themes", () => {
    show();
    const row = screen.getByText("set.diagramMode");
    const themes = screen.getByText("theme.dark");
    // "vorangestellt" heißt hier wörtlich: die Zeile steht im Dokument vor der
    // ersten Themenkachel.
    expect(row.compareDocumentPosition(themes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the other mode and switches to it", () => {
    show();
    fireEvent.click(screen.getByText("set.diagramMode"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: true });
  });

  it("names the way back once the diagram mode is on", () => {
    show({ diagram: true });
    expect(screen.queryByText("set.diagramMode")).toBeNull();
    fireEvent.click(screen.getByText("set.dashboardMode"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: false });
  });

  it("switches without Plus", () => {
    revokePlus();
    show();

    const asked: (string | null)[] = [];
    const stop = onPlusDialog((feature) => asked.push(feature));
    fireEvent.click(screen.getByText("set.diagramMode"));
    stop();

    // Der Layoutmodus hängt an keiner Freischaltung · kein Schloss, keine
    // Erklärung, nur der Wechsel.
    expect(asked).toEqual([]);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, diagram: true });
  });
});

describe("automatic switch by time", () => {
  /**
   * Erst wann die Nacht ist, dann wie sie aussieht · die zwei Uhrzeiten
   * standen hinter acht Kacheln und wurden dort übersehen.
   */
  it("sets the hours above the night themes", () => {
    show({ auto: "time" });
    const von = screen.getByText("set.themeNightFrom");
    const nachtUeberschrift = screen.getByText("set.themeNight");
    expect(
      von.compareDocumentPosition(nachtUeberschrift) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps the hours away when the switch follows the system", () => {
    show({ auto: "system" });
    expect(screen.queryByText("set.themeNightFrom")).toBeNull();
    expect(screen.getByText("set.themeNight")).toBeTruthy();
  });
});

describe("with Plus", () => {
  /**
   * Der Stern sagt „das gibt es mit Plus". Wer Plus hat, dem sagt er nichts
   * mehr — dreiundzwanzig davon auf einer Seite unterscheiden nichts.
   */
  it("drops every Plus star", () => {
    const { container } = render(
      <AppearanceSection appearance={{ ...DEFAULT_APPEARANCE, auto: "time" }} onChange={onChange} />
    );
    expect(container.querySelectorAll(".lucide-sparkles").length).toBe(0);
  });

  it("still shows them without Plus", () => {
    revokePlus();
    const { container } = render(
      <AppearanceSection appearance={{ ...DEFAULT_APPEARANCE, auto: "time" }} onChange={onChange} />
    );
    expect(container.querySelectorAll(".lucide-sparkles").length).toBeGreaterThan(0);
  });
});

describe("without Plus", () => {
  it("leaves the default board open", () => {
    revokePlus();
    show();

    const asked: (string | null)[] = [];
    const stop = onPlusDialog((feature) => asked.push(feature));
    fireEvent.click(screen.getByText("board.auto"));
    stop();

    // "Zum Thema" ist die Vorgabe · wer sie wählt, wählt nichts Bezahltes.
    expect(asked).toEqual([]);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, boardSet: "auto" });
  });

  it("sends the other boards to the explanation", () => {
    revokePlus();
    show();

    const asked: (string | null)[] = [];
    const stop = onPlusDialog((feature) => asked.push(feature));
    fireEvent.click(screen.getByText("board.sepia"));
    stop();

    expect(asked).toEqual([THEME_FEATURE]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says nothing twice about the preview", () => {
    revokePlus();
    show();

    // Was Plus kostet, trägt sein Sternchen und erklärt sich beim Antippen ·
    // ein Kasten, der dasselbe noch einmal sagt, stand nur im Weg.
    expect(screen.queryByText("plus.previewHint")).toBeNull();
  });
});
