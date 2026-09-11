/**
 * Das Blatt des Starts.
 *
 * Geprüft wird, was den Modus ausmacht: ein gerechnetes Diagramm statt vier
 * Kacheln, Notation in der Sprache der Oberfläche, Formularzeilen statt
 * Karten — und dass die Wege dorthin führen, wohin die Karten von heute
 * führen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import DashboardBlatt, { type Tagesquelle } from "./DashboardBlatt";
import type { UiGame } from "../../lib/gameUi";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

/**
 * Die Partie kommt als Zugliste herein · die Stellung rechnet das Blatt selbst.
 * Nach 1.e4 e5 2.Sf3 folgt 2…Sc6??, also steht das Diagramm davor.
 */
const spiel: Tagesquelle = {
  art: "game",
  sans: ["e4", "e5", "Nf3", "Nc6"],
  nags: [undefined, undefined, undefined, "??"],
  weiss: "Tom",
  weissElo: "1462",
  schwarz: "DragonSlayer_88",
  schwarzElo: "1448",
  plattform: "chess.com",
  zeitform: "Rapid",
  datum: "11.07.2026",
  datumLang: "11. Juli 2026",
  eco: "C50",
  eroeffnung: "Italienische Partie",
  ergebnis: "1 : 0",
  farbe: "white",
};

const partie = (over: Partial<UiGame> = {}): UiGame =>
  ({
    id: "g1",
    date: "11.07.2026",
    source: "chess.com",
    tc: "Rapid",
    color: "white",
    opponent: "DragonSlayer_88",
    oppElo: 1448,
    myElo: 1462,
    result: "win",
    opening: "Italienische Partie",
    eco: "C50",
    moves: 39,
    accuracy: 91.2,
    analyzed: true,
    tags: [],
    dbId: 7,
    ...over,
  }) as UiGame;

const wege = () => ({
  onRepertoire: vi.fn(),
  onAnalyse: vi.fn(),
  onPuzzles: vi.fn(),
  onAllePartien: vi.fn(),
  onPartie: vi.fn(),
});

function show(props: Partial<Parameters<typeof DashboardBlatt>[0]> = {}) {
  const handlers = wege();
  render(
    <DashboardBlatt
      mobile={false}
      bestand={1519}
      quelle={spiel}
      wertungen={[{ id: "cc", platform: "chess.com", tc: "Rapid", value: 1462, delta: 24 }]}
      letzte={[partie()]}
      repDue={14}
      repNeben="Serie"
      unanalyzed={4}
      puzzles={{ done: 12, goal: 20 }}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

/**
 * Der Gegnername in der Partienliste · er steht auch im Formularkopf, und dort
 * ist er Auskunft und kein Griff.
 */
const gegnerInDerListe = () =>
  screen
    .getAllByText(/DragonSlayer_88/)
    .map((el) => el.closest("button"))
    .find((el): el is HTMLButtonElement => el != null)!;

describe("Blatt des Starts", () => {
  it("prints a diagram instead of four tiles", () => {
    show();
    // 64 Felder, gerechnet aus dem FEN · nicht gemalt.
    expect(document.querySelectorAll("[data-square]")).toHaveLength(64);
    // Und die Figuren stehen dort, wo die Stellung sie hat.
    expect(document.querySelector('[data-square="f3"] svg')).toBeTruthy();
    expect(document.querySelector('[data-square="e4"] svg')).toBeTruthy();
    expect(document.querySelector('[data-square="d4"] svg')).toBeNull();
  });

  it("sets the moves in English SAN, like the rest of the app", () => {
    show();
    // Seit 1.4 heißt der Springer auch auf einem deutschen Blatt N · die
    // Zugliste, das Buch und die PGN schreiben ihn ohnehin so.
    const satz = [...document.querySelectorAll(".notation")].map((n) => n.textContent).join(" ");
    expect(satz).toContain("Nf3");
    expect(satz).not.toContain("Sf3");
  });

  it("carries the verdict of the auto analysis next to the move", () => {
    show();
    expect(screen.getByText("??")).toBeTruthy();
  });

  it("leads where the cards of today lead", () => {
    const handlers = show();
    fireEvent.click(screen.getByText("dash.dueReviews"));
    expect(handlers.onRepertoire).toHaveBeenCalled();
    fireEvent.click(screen.getByText("dash.gamesWithoutAnalysis"));
    expect(handlers.onAnalyse).toHaveBeenCalled();
    fireEvent.click(screen.getByText("blatt.puzzlesToday"));
    expect(handlers.onPuzzles).toHaveBeenCalled();
    const eintraege = screen.getAllByText("DragonSlayer_88");
    fireEvent.click(eintraege[eintraege.length - 1]);
    expect(handlers.onPartie).toHaveBeenCalled();
  });

  it("shows where the diagram came from when no game is left", () => {
    show({
      quelle: {
        art: "repertoire",
        sans: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"],
        linie: "Giuoco Pianissimo",
        seite: "white",
        eigener: "Tom",
      },
      angebot: { repertoire: 3, puzzles: 8, endgame: true },
    });
    expect(screen.getByText("blatt.whereFrom")).toBeTruthy();
    expect(screen.getByText("blatt.srcRepertoireDue")).toBeTruthy();
  });

  it("says nothing at all rather than inventing a diagram", () => {
    show({ quelle: null, angebot: undefined });
    expect(document.querySelectorAll("[data-square]")).toHaveLength(0);
    // Die Tagesliste bleibt · sie hängt nicht am Diagramm.
    expect(screen.getByText("dash.dueReviews")).toBeTruthy();
  });

  it("prints what the analysis has to say about the diagram move", () => {
    // Das Diagramm steht vor dem Patzer · erklärt wird also `sans[3]`, und
    // nicht der Zug davor.
    show({
      quelle: {
        ...spiel,
        analysen: [undefined, undefined, undefined, "Springer c6 bleibt ungedeckt."],
        fazit: ["Solide gespielt.", "Gekippt ist es bei 2. Sc6."],
      },
    });
    expect(screen.getByText("expl.source")).toBeTruthy();
    expect(screen.getByText(/Springer c6/)).toBeTruthy();
    // Das Fazit der ganzen Partie gehört nicht zu dieser einen Stellung.
    expect(screen.queryByText("expl.verdict")).toBeNull();
    expect(screen.queryByText(/Solide gespielt/)).toBeNull();
  });

  it("says where the price comes from under the note", () => {
    show({
      quelle: {
        ...spiel,
        analysen: [undefined, undefined, undefined, "Sc6 kostet 5,3 Bewertungspunkte."],
        gruende: [undefined, undefined, undefined, "Widerlegt wird der Zug durch Sxe5."],
      },
    });
    expect(screen.getByText(/Sc6 kostet 5,3/)).toBeTruthy();
    expect(screen.getByText(/Widerlegt wird der Zug durch Sxe5/)).toBeTruthy();
  });

  /**
   * Jede Angabe der Zeile ist ein Griff in das Verzeichnis · geprüft werden
   * die drei, die keinen eigenen Text tragen oder erst dazugekommen sind.
   */
  it("filters from the colour box, the ECO and the result dot", () => {
    const onFilter = vi.fn();
    show({ onFilter });
    fireEvent.click(screen.getByLabelText("games.filterColor"));
    expect(onFilter).toHaveBeenLastCalledWith({ color: "white" });
    fireEvent.click(screen.getByLabelText("games.filterEco"));
    expect(onFilter).toHaveBeenLastCalledWith({ eco: "C50" });
    fireEvent.click(screen.getByLabelText("games.filterResult"));
    expect(onFilter).toHaveBeenLastCalledWith({ result: "win" });
    // Und der Gegner, den es vorher schon gab · die Zeile trägt beides.
    // Sein Name steht auch im Formularkopf; gemeint ist der in der Liste.
    fireEvent.click(gegnerInDerListe());
    expect(onFilter).toHaveBeenLastCalledWith({ opponent: "DragonSlayer_88" });
  });

  /**
   * Der Griff ist der Text, nicht die Spalte: Die Eröffnung nimmt den ganzen
   * Rest der Zeile, und ein Klick weit rechts neben ihrem Namen soll die
   * Analyse aufschlagen und nicht das Verzeichnis filtern.
   */
  it("leaves the empty part of a column to the row", () => {
    const onFilter = vi.fn();
    const handlers = show({ onFilter });
    const zeile = screen.getByText(/91[.,]2/).closest("[role=button]")!;
    const spalte = within(zeile as HTMLElement).getByText("Italienische Partie")
      .parentElement!;
    expect(spalte.tagName).toBe("SPAN");
    fireEvent.click(spalte);
    expect(onFilter).not.toHaveBeenCalled();
    expect(handlers.onPartie).toHaveBeenCalled();
  });

  it("keeps the row a plain button on the phone, where there are no columns", () => {
    const onFilter = vi.fn();
    const handlers = show({ mobile: true, onFilter });
    expect(screen.queryByLabelText("games.filterColor")).toBeNull();
    fireEvent.click(gegnerInDerListe());
    expect(onFilter).not.toHaveBeenCalled();
    expect(handlers.onPartie).toHaveBeenCalled();
  });

  it("stays silent when the analysis found nothing to say", () => {
    show();
    expect(screen.queryByText("expl.source")).toBeNull();
    expect(screen.queryByText("expl.verdict")).toBeNull();
  });

  /** Kopfzeile und Bildunterschrift sagen beide, woher die Partie kommt. */
  it("colours the platform in the head and writes the date out below", () => {
    show();
    // „chess.com" steht auch unten bei den Wertungen · gemeint ist der Kopf.
    const kopf = screen
      .getAllByText("chess.com")
      .find((el) => el.parentElement?.textContent?.includes("Rapid"))!;
    expect(kopf.getAttribute("style")).toContain("--color-cc");
    expect(kopf.parentElement?.textContent).toContain("chess.com · Rapid · 11.07.2026");
    expect(
      screen.getByText(/chess\.com Rapid · 11\. Juli 2026 · blatt\.positionAfter/)
    ).toBeTruthy();
  });

});
