/**
 * Das Blatt der Analyse.
 *
 * Geprüft wird, was die Seite an Bedienung trägt und nicht bloß an Satz: die
 * Bewertungskurve als Griff in die Partie — mit dem Zeiger wie mit der Tastatur
 * —, die Schlagliste unter dem Namen und die Brettspalte auf dem Maß der
 * gewöhnlichen Fassung.
 *
 * Dazu die beiden Stücke, die der Modus zuletzt bekommen hat: der Abschnitt
 * „Aus der Analyse" unter dem Satz — der auf den angeklickten Zug umschaltet
 * und sonst die schwersten Stellen führt — und der Apparat daneben, in dem
 * jede Zeile ein Griff ist.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AnalysisBlatt, { type AnalysisBlattProps } from "./AnalysisBlatt";
import { setFormatLocale } from "../../lib/format";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

// Zahlen stehen in der Schreibweise der Oberfläche · „91.2 %" wäre auf
// einem deutschen Blatt falsch.
beforeAll(() => setFormatLocale("de-DE"));

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

  // ── Aus der Analyse ──────────────────────────────────────────────────────

  /**
   * Ohne gewählten Zug führt der Abschnitt die schwersten Stellen · höchstens
   * drei, nach Gewicht ausgewählt und in der Reihenfolge der Partie gelesen.
   */
  it("führt die schwersten Erklärungen, solange kein Zug angeklickt ist", () => {
    show({
      ply: 0,
      zuege: kurve.map((_, i) => ({
        san: i % 2 === 0 ? "e4" : "e5",
        erklaerung: `Satz ${i}`,
        gewicht: i * 10,
      })),
    });
    const saetze = screen
      .getAllByRole("button")
      .map((knopf) => knopf.textContent ?? "")
      .filter((text) => text.includes("Satz "));
    // Die drei größten Gewichte sind 7, 8 und 9 · und sie stehen in der
    // Reihenfolge der Partie, nicht in der der Auswahl.
    expect(saetze).toHaveLength(3);
    expect(saetze[0]).toContain("Satz 7");
    expect(saetze[1]).toContain("Satz 8");
    expect(saetze[2]).toContain("Satz 9");
  });

  it("schlägt den Zug auf, dessen Erklärung man anklickt", () => {
    const onPly = show({
      ply: 0,
      zuege: kurve.map((_, i) => ({
        san: "e4",
        erklaerung: `Satz ${i}`,
        gewicht: i * 10,
      })),
    });
    fireEvent.click(screen.getByText(/Satz 8/));
    // Halbzüge zählen ab eins · Index 8 ist Halbzug 9.
    expect(onPly).toHaveBeenLastCalledWith(9);
  });

  /**
   * Ein Klick im Fließsatz ist zugleich die Frage „was war hier los?" · dann
   * steht der Satz zu diesem Zug da, mit seiner Rechnung darunter, und die
   * Liste der schwersten Stellen tritt zurück.
   */
  it("zeigt zum angeklickten Zug dessen Erklärung samt Rechnung", () => {
    show({
      ply: 3,
      zuege: kurve.map((_, i) => ({
        san: "e4",
        erklaerung: `Satz ${i}`,
        grund: i === 2 ? "Von −2,1 auf −5,2." : undefined,
        gewicht: i * 10,
      })),
    });
    expect(screen.getByText(/Satz 2/)).toBeTruthy();
    expect(screen.getByText("Von −2,1 auf −5,2.")).toBeTruthy();
    expect(screen.queryByText(/Satz 9/)).toBeNull();
  });

  /** Ohne Erklärungen bleibt der Abschnitt fort · eine leere Rubrik ist keine. */
  it("lässt den Abschnitt fort, wenn es nichts zu erklären gibt", () => {
    show();
    expect(screen.queryByText("expl.source")).toBeNull();
  });

  // ── Der Apparat ──────────────────────────────────────────────────────────

  /**
   * Das Eröffnungsbuch ist im Blatt kein Abdruck, sondern dieselbe Bedienung:
   * Die Reiter wechseln die Quelle, und jede Zugzeile legt ihren Zug aufs
   * Brett. Ein Modus, der eine Funktion kostet, ist kein Modus.
   */
  it("bedient das Eröffnungsbuch wie die gewöhnliche Fassung", () => {
    const onQuelle = vi.fn();
    const onZug = vi.fn();
    show({
      buch: {
        reiter: [
          { id: "masters", name: "Meister", plus: true },
          { id: "engine", name: "Engine", plus: false },
        ],
        quelle: "masters",
        onQuelle,
        stand: {
          partien: 1200,
          eroeffnung: "Sizilianisch",
          zuege: [{ san: "e4", weiss: 600, remis: 300, schwarz: 300, elo: 2412 }],
          musterpartien: [],
          ausCache: false,
        },
        onZug,
      },
    });
    expect(screen.getByText("an.book")).toBeTruthy();
    expect(screen.getByText("Sizilianisch")).toBeTruthy();

    fireEvent.click(screen.getByText("Engine"));
    expect(onQuelle).toHaveBeenCalledWith("engine");

    fireEvent.click(screen.getByText("e4"));
    expect(onZug).toHaveBeenCalledWith("e4");
  });

  it("nennt beim Buch den einen Satz, wenn es nichts zu zeigen gibt", () => {
    show({
      buch: {
        reiter: [{ id: "own", name: "Meine Datenbank", plus: false }],
        quelle: "own",
        onQuelle: vi.fn(),
        hinweis: "Noch keine Referenzdatenbank.",
        onZug: vi.fn(),
      },
    });
    expect(screen.getByText("Noch keine Referenzdatenbank.")).toBeTruthy();
  });

  it("führt aus den eigenen Partien zurück in die Partie", () => {
    const onOeffnen = vi.fn();
    const onZug = vi.fn();
    show({
      stellungen: {
        gesamt: 7,
        zuege: [{ san: "Sf3", partien: 4, quote: 62.5 }],
        treffer: [
          {
            id: 12,
            ply: 18,
            datum: "03.09.2026",
            gegner: "karpov_fanboy",
            ergebnis: "win",
            onOeffnen,
          },
        ],
        onZug,
      },
    });
    fireEvent.click(screen.getByText("Sf3"));
    expect(onZug).toHaveBeenCalledWith("Sf3");

    fireEvent.click(screen.getByText("karpov_fanboy"));
    expect(onOeffnen).toHaveBeenCalled();
  });

  it("sagt es, wenn die Stellung in keiner eigenen Partie vorkam", () => {
    show({ stellungen: { gesamt: 0, zuege: [], treffer: [], onZug: vi.fn() } });
    expect(screen.getByText("an.posNotFound")).toBeTruthy();
  });

  // ── Was der Modus zuletzt nachgeholt hat ─────────────────────────────────
  //
  // Drei Stücke standen nur in der gewöhnlichen Fassung, und damit kostete
  // der Modus drei Funktionen: die Engine zu einer Partie, die Genauigkeit
  // nach Phase und das Notizfeld.

  it("stellt die Genauigkeit nach Phase als Tabelle", () => {
    show({
      genauigkeiten: {
        ich: "Torim98",
        gegner: "DragonSlayer_88",
        zeilen: [
          { name: "Gesamt", ich: 88.5, gegner: 76.8 },
          { name: "Eröffnung", ich: 95, gegner: 88 },
          { name: "Endspiel", ich: null, gegner: null },
        ],
      },
    });
    expect(screen.getByText("an.phaseAccuracy")).toBeTruthy();
    expect(screen.getByText("88,5 %")).toBeTruthy();
    expect(screen.getByText("76,8 %")).toBeTruthy();
    // Ohne gerechnete Phase steht ein Gedankenstrich · keine Null. Eine
    // Partie ohne Endspiel hat keine Endspielgenauigkeit von 0 %.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("setzt das Notizfeld neu, statt es ein zweites Mal zu bauen", () => {
    show({ notizen: <textarea defaultValue="Zu passiv gespielt." /> });
    expect(screen.getByText("an.notesAndTags")).toBeTruthy();
    const feld = screen.getByDisplayValue("Zu passiv gespielt.");
    // Es ist genau das Feld der gewöhnlichen Fassung, nur im Satz des
    // Blattes · siehe `.blatt-formular` in blatt.css.
    expect(feld.closest(".blatt-formular")).toBeTruthy();
  });

  it("stellt die Engine zu einer Partie in den Apparat", () => {
    show({ motor: <div data-testid="motor" />, stellungen: undefined });
    expect(screen.getByTestId("motor")).toBeTruthy();
  });

  it("lässt die Engine am freien Brett in der rechten Spalte", () => {
    // Dort gibt es keine Anmerkungen · ihre Linien sind das, was auf einer
    // Buchseite die Varianten sind. Zweimal darf sie nicht dastehen.
    show({ frei: true, motor: <div data-testid="motor" /> });
    expect(screen.getAllByTestId("motor")).toHaveLength(1);
  });

  /**
   * Die Anmerkung im Fließsatz bringt den Motivsatz seit 1.3 selbst mit ·
   * dann darf er drei Zeilen darunter nicht noch einmal stehen.
   */
  it("wiederholt unter dem Satz nicht, was im Satz schon steht", () => {
    show({
      ply: 3,
      zuege: kurve.map((_, i) => ({
        san: "e4",
        erklaerung: `Satz ${i}`,
        kommentar: i === 2 ? "Ungenauigkeit. Satz 2" : null,
        gewicht: i * 10,
      })),
    });
    // Einmal im Satz, kein zweites Mal darunter.
    expect(screen.getAllByText(/Satz 2/)).toHaveLength(1);
    // Der Abschnitt bleibt bei den schwersten Stellen und führt von dort
    // weiter, statt zu wiederholen.
    expect(screen.getByText(/Satz 9/)).toBeTruthy();
  });
});
