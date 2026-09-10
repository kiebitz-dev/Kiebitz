/**
 * Das Partienverzeichnis im Diagramm-Modus.
 *
 * Geprüft wird, was den Satz dieser Seite ausmacht: dass jede Angabe der Zeile
 * ein Griff in die Liste ist, dass der Schlüssel zu den Marken unter der
 * Spalte steht, die er erklärt, und dass die Leiste des Telefons in eine Zeile
 * passt — Suchfeld, Filter, Import — statt das Formular über die halbe Seite
 * zu legen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import GamesBlatt, { type Filterfeld } from "./GamesBlatt";
import type { UiGame } from "../../lib/gameUi";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const partie = (over: Partial<UiGame> = {}): UiGame =>
  ({
    id: "g1",
    date: "11.07.2026",
    dateKey: "2026-07-11",
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

const suchfeld: Filterfeld = {
  label: "blatt.search",
  wert: "",
  leer: true,
  suche: true,
  onChange: vi.fn(),
};

const quelle: Filterfeld = {
  label: "games.colSource",
  wert: "chess.com",
  leer: false,
  breite: 112,
  onClick: vi.fn(),
};

const ergebnis: Filterfeld = {
  label: "games.colResult",
  wert: "blatt.filterAll",
  leer: true,
  breite: 96,
  onClick: vi.fn(),
};

function show(props: Partial<Parameters<typeof GamesBlatt>[0]> = {}) {
  const handlers = {
    onZurueck: vi.fn(),
    onWeiter: vi.fn(),
    onWaehlen: vi.fn(),
    onAnalyse: vi.fn(),
    onProBlatt: vi.fn(),
    onBlattWaehlen: vi.fn(),
  };
  render(
    <GamesBlatt
      mobile={false}
      bestand={1523}
      filter={[suchfeld, quelle, ergebnis]}
      treffer={1}
      zeilen={[{ game: partie(), nummer: 1523 }]}
      gewaehlt={partie()}
      fen={START}
      unterschrift={{ nummer: "blatt.entryNo", zeilen: ["Tom – DragonSlayer_88"] }}
      angaben={[]}
      stichwoerter={[]}
      notiz=""
      von={1}
      bis={1}
      blatt={1}
      blaetter={1}
      proBlatt={10}
      minProBlatt={10}
      maxProBlatt={100}
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

/**
 * Dasselbe Blatt, aber mit der Möglichkeit, die gewählte Partie zu wechseln ·
 * dafür braucht es dieselben Pflichtangaben ein zweites Mal, und die stehen
 * schon in `show`. Gebaut wird deshalb ein Blatt, das sich neu setzen lässt.
 */
function renderBlatt(props: Partial<Parameters<typeof GamesBlatt>[0]> = {}) {
  const blatt = (gewaehlt: UiGame, notiz: string) => (
    <GamesBlatt
      mobile={false}
      bestand={1523}
      filter={[suchfeld]}
      treffer={1}
      zeilen={[{ game: gewaehlt, nummer: 1523 }]}
      gewaehlt={gewaehlt}
      fen={START}
      unterschrift={{ nummer: "blatt.entryNo", zeilen: [] }}
      angaben={[]}
      stichwoerter={[]}
      von={1}
      bis={1}
      blatt={1}
      blaetter={1}
      proBlatt={10}
      minProBlatt={10}
      maxProBlatt={100}
      onZurueck={vi.fn()}
      onWeiter={vi.fn()}
      onWaehlen={vi.fn()}
      onProBlatt={vi.fn()}
      onBlattWaehlen={vi.fn()}
      onNotiz={vi.fn()}
      {...props}
      notiz={notiz}
    />
  );
  const view = render(blatt(partie(), props.notiz ?? ""));
  return {
    rerender: (gewaehlt: UiGame, notiz: string) => view.rerender(blatt(gewaehlt, notiz)),
  };
}

/** Der Gegnername in der Zeile · in der Bildunterschrift steht er auch. */
const gegnerInDerZeile = () =>
  screen
    .getAllByText(/DragonSlayer_88/)
    .map((el) => el.closest("button"))
    .find((el): el is HTMLButtonElement => el != null)!;

describe("Partienverzeichnis im Blatt", () => {
  it("makes every column of a row a handle into the list", () => {
    const onFilter = vi.fn();
    show({ onFilter });

    fireEvent.click(screen.getByLabelText("games.filterColor"));
    expect(onFilter).toHaveBeenLastCalledWith({ color: "white" });
    fireEvent.click(screen.getByLabelText("games.filterEco"));
    expect(onFilter).toHaveBeenLastCalledWith({ eco: "C50" });
    fireEvent.click(screen.getByLabelText("games.filterResult"));
    expect(onFilter).toHaveBeenLastCalledWith({ result: "win" });
    fireEvent.click(gegnerInDerZeile());
    expect(onFilter).toHaveBeenLastCalledWith({ opponent: "DragonSlayer_88" });
    fireEvent.click(screen.getByText("Italienische Partie"));
    expect(onFilter).toHaveBeenLastCalledWith({ opening: "Italienische Partie" });
    fireEvent.click(screen.getByText("11.07.2026"));
    expect(onFilter).toHaveBeenLastCalledWith({ date: "2026-07-11" });
  });

  it("still opens the entry when a row is clicked next to its handles", () => {
    const handlers = show({ onFilter: vi.fn() });
    // Die Genauigkeit trägt keinen Griff · ein Klick darauf gilt der Zeile.
    fireEvent.click(screen.getByText(/91[.,]2/));
    expect(handlers.onWaehlen).toHaveBeenCalled();
  });

  /**
   * Der Griff ist der Text, nicht die Spalte: Die Eröffnung nimmt den ganzen
   * Rest der Zeile, und ein Klick weit rechts neben ihrem Namen soll die
   * Partie aufschlagen und nicht das Verzeichnis filtern.
   */
  it("leaves the empty part of a column to the row", () => {
    const onFilter = vi.fn();
    const handlers = show({ onFilter });
    const spalte = screen.getByText("Italienische Partie").parentElement!;
    expect(spalte.tagName).toBe("SPAN");
    fireEvent.click(spalte);
    expect(onFilter).not.toHaveBeenCalled();
    expect(handlers.onWaehlen).toHaveBeenCalled();
  });

  /**
   * Die Beschriftung der Genauigkeit ist kürzer als ihre Zahlen · sie steht
   * deshalb linksbündig eingerückt und nicht rechtsbündig, sonst begänne sie
   * rechts vom ersten Zeichen der Prozentzahlen.
   */
  it("sets the accuracy label over the start of its numbers", () => {
    show();
    const kopf = screen.getByText("blatt.accuracyShort");
    expect(kopf.className).toContain("ps-[9px]");
    expect(kopf.className).toContain("text-start");
    expect(kopf.className).not.toContain("text-end");
  });

  it("puts the key to the marks under the column it explains", () => {
    show();
    const schluessel = screen.getByText("blatt.markNote").closest("div")!;
    expect(schluessel.className).toContain("justify-end");
  });

  /**
   * Auf dem Telefon steht nur das Suchfeld in der Leiste; die übrigen Felder
   * kommen erst, wenn man die Filter aufschlägt.
   */
  it("keeps search, filters and import on one line on the phone", () => {
    const onFilterUmschalten = vi.fn();
    const onUmschalten = vi.fn();
    show({
      mobile: true,
      onFilterUmschalten,
      einfuhr: { offen: false, onUmschalten, inhalt: <div>Einfuhr</div> },
    });

    expect(screen.getByLabelText("blatt.search")).toBeTruthy();
    expect(screen.queryByText("games.colSource")).toBeNull();
    expect(screen.queryByText("Einfuhr")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "games.filters" }));
    expect(onFilterUmschalten).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "games.manageImports" }));
    expect(onUmschalten).toHaveBeenCalled();
  });

  it("unfolds the remaining fields and the import below the bar", () => {
    show({
      mobile: true,
      filterOffen: true,
      onFilterUmschalten: vi.fn(),
      einfuhr: { offen: true, onUmschalten: vi.fn(), inhalt: <div>Einfuhr</div> },
    });
    expect(screen.getByText("games.colSource")).toBeTruthy();
    expect(screen.getByText("games.colResult")).toBeTruthy();
    expect(screen.getByText("Einfuhr")).toBeTruthy();
  });

  /** Ein gesetzter Filter zählt am Griff mit, auch zugeklappt. */
  it("counts the set filters on the handle", () => {
    show({ mobile: true, onFilterUmschalten: vi.fn() });
    const griff = screen.getByRole("button", { name: "games.filters" });
    // „chess.com" ist gesetzt, „alle" nicht · also genau einer.
    expect(griff.textContent).toBe("1");
  });

  // Bei hundertfünfzig Blättern ist der Weg an den Anfang kein Weg aus
  // hundertneunundvierzig Schritten · er ist ein Griff.
  it("reaches the first and the last sheet in one step", () => {
    const onBlattWaehlen = vi.fn();
    show({ blatt: 4, blaetter: 153, onBlattWaehlen });

    fireEvent.click(screen.getByRole("button", { name: "blatt.firstSheet" }));
    expect(onBlattWaehlen).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "blatt.lastSheet" }));
    expect(onBlattWaehlen).toHaveBeenCalledWith(153);
  });

  it("turns the sheet number into a field that jumps", () => {
    const onBlattWaehlen = vi.fn();
    show({ blatt: 4, blaetter: 153, onBlattWaehlen });

    fireEvent.click(screen.getByRole("button", { name: "blatt.sheetOf" }));
    const feld = screen.getByLabelText("blatt.goToSheet") as HTMLInputElement;
    expect(feld.value).toBe("4");
    fireEvent.change(feld, { target: { value: "42" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(onBlattWaehlen).toHaveBeenCalledWith(42);
  });

  it("takes a freely typed number of games per sheet", () => {
    const onProBlatt = vi.fn();
    show({ onProBlatt });

    fireEvent.click(screen.getByRole("button", { name: "blatt.setPerSheet" }));
    const feld = screen.getByLabelText("blatt.setPerSheet") as HTMLInputElement;
    expect(feld.value).toBe("10");
    fireEvent.change(feld, { target: { value: "37" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(onProBlatt).toHaveBeenCalledWith(37);
  });

  /**
   * Sechs der acht Spalten einer Zeile führen ins Verzeichnis zurück · die
   * laufende Nummer ist der Griff, der die Partie selbst aufschlägt. Ohne sie
   * bliebe dafür nur der Rest zwischen den Spalten.
   */
  it("opens the entry from the running number", () => {
    const handlers = show({ onFilter: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "blatt.openEntry" }));
    expect(handlers.onWaehlen).toHaveBeenCalled();
  });

  it("writes the keywords of the entry", () => {
    const onStichwoerter = vi.fn();
    show({ stichwoerter: ["Italienisch"], onStichwoerter });

    // Anlegen · das Feld unter der Zeile nimmt das Wort auf.
    const feld = screen.getByLabelText("blatt.addKeyword");
    fireEvent.change(feld, { target: { value: "Miniatur" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(onStichwoerter).toHaveBeenLastCalledWith(["Italienisch", "Miniatur"]);

    // Wegnehmen · ein Klick auf das Wort selbst. Es trägt seinen Namen
    // sichtbar, der Griff heißt also wie das Stichwort und nicht wie die
    // Handlung — genau wie die Pille in der gewöhnlichen Fassung.
    fireEvent.click(screen.getByRole("button", { name: "Italienisch" }));
    expect(onStichwoerter).toHaveBeenLastCalledWith([]);
  });

  /**
   * Ohne Stichwörter stand die Auskunft „noch keine" auf der einen Linie und
   * das Feld auf der nächsten · zwei Zeilen für eine Sache, und die obere sah
   * aus wie die Stelle, an der man schreibt. Jetzt steht dort das Feld.
   */
  it("puts the keyword field where the empty notice stood", () => {
    const onStichwoerter = vi.fn();
    show({ stichwoerter: [], onStichwoerter });

    expect(screen.queryByText("blatt.noKeywords")).toBeNull();
    const feld = screen.getByLabelText("blatt.addKeyword");
    fireEvent.change(feld, { target: { value: "Miniatur" } });
    fireEvent.keyDown(feld, { key: "Enter" });
    expect(onStichwoerter).toHaveBeenLastCalledWith(["Miniatur"]);
  });

  it("keeps the entry readable where nothing can be written", () => {
    show({ stichwoerter: ["Italienisch"], notiz: "Springergabel" });
    expect(screen.queryByLabelText("blatt.addKeyword")).toBeNull();
    expect(screen.queryByLabelText("blatt.remarks")).toBeNull();
    expect(screen.getByText(/Springergabel/)).toBeTruthy();
  });

  /** Ohne Datenbank bleibt die Zeile Auskunft · dann sagt sie, dass nichts da ist. */
  it("says so where keywords cannot be written", () => {
    show({ stichwoerter: [] });
    expect(screen.getByText("blatt.noKeywords")).toBeTruthy();
  });

  /**
   * Das Diagramm steht aus der Sicht dessen, der gespielt hat · wie das Brett
   * der gewöhnlichen Fassung. Bei Schwarz beginnt die Reihe der Felder
   * deshalb bei h1 und nicht bei a8.
   */
  it("turns the diagram to the side that was played", () => {
    show({ gewaehlt: partie({ color: "white" }) });
    expect(document.querySelectorAll("[data-square]")[0].getAttribute("data-square")).toBe("a8");
    cleanup();

    show({ gewaehlt: partie({ color: "black" }) });
    expect(document.querySelectorAll("[data-square]")[0].getAttribute("data-square")).toBe("h1");
  });

  /**
   * Ein Formular auf Papier hat keinen Knopf „Sichern" · abgelegt wird beim
   * Verlassen des Feldes. Was sich nicht geändert hat, wird dabei auch nicht
   * abgelegt: Sonst schriebe jeder Blick in das Feld einen Datenbanksatz.
   */
  it("keeps the remark when the field is left", () => {
    const onNotiz = vi.fn();
    show({ notiz: "Springergabel", onNotiz });

    const feld = screen.getByLabelText("blatt.remarks");
    fireEvent.blur(feld);
    expect(onNotiz).not.toHaveBeenCalled();

    fireEvent.change(feld, { target: { value: "Springergabel nach d4" } });
    fireEvent.blur(feld);
    expect(onNotiz).toHaveBeenCalledWith("Springergabel nach d4");
    expect(screen.getByText("blatt.saved")).toBeTruthy();
  });

  /**
   * Ein Griff, der nichts tut, sieht aus wie ein Angebot und ist keins · ohne
   * Datenbank steht hinter der Partie keine Analyse, also steht der Weg nicht
   * da.
   */
  it("shows the way into the analysis only where there is one", () => {
    const onAnalyse = vi.fn();
    show({ onAnalyse, analysiert: true });
    fireEvent.click(screen.getByRole("button", { name: /games.openAnalysis/ }));
    expect(onAnalyse).toHaveBeenCalled();

    cleanup();
    show({ onAnalyse, analysiert: false });
    expect(screen.getByRole("button", { name: /games.analyze/ })).toBeTruthy();

    cleanup();
    show({ onAnalyse: undefined });
    expect(screen.queryByRole("button", { name: /games.openAnalysis/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /games.analyze/ })).toBeNull();
  });

  /**
   * Die Bemerkung hängt an genau einer Partie · ein halb getippter Satz darf
   * nicht in die nächste rutschen, wenn im Register weitergeblättert wird.
   */
  it("starts the remark field over for the next entry", () => {
    const { rerender } = renderBlatt({ notiz: "Erste" });
    expect((screen.getByLabelText("blatt.remarks") as HTMLTextAreaElement).value).toBe("Erste");
    rerender(partie({ id: "g2", dbId: 8 }), "Zweite");
    expect((screen.getByLabelText("blatt.remarks") as HTMLTextAreaElement).value).toBe("Zweite");
  });
});

/**
 * Die Partie-Ansicht des Telefons.
 *
 * Am Rechner steht der Eintrag neben der Liste, auf dem Telefon darüber. Die
 * Ansicht ist dieselbe Detailschicht wie in der gewöhnlichen Fassung — sie
 * bringt Wischen und die Zurück-Geste schon mit — nur im Buchsatz. Geprüft
 * wird, dass sie erst auf Tipp erscheint, die Phasenwerte trägt und dass ein
 * fehlender Wert als Gedankenstrich dasteht.
 */
describe("Die Partie auf dem Telefon", () => {
  const blaettern = {
    offen: true,
    onSchliessen: vi.fn(),
    onZurueck: vi.fn(),
    onWeiter: vi.fn(),
    stelle: 3,
    gesamt: 1523,
  };

  it("bleibt zu, solange niemand eine Partie aufschlägt", () => {
    show({ mobile: true, eintragBlatt: { ...blaettern, offen: false } });
    expect(screen.queryByTestId("game-detail-sheet")).toBeNull();
  });

  it("trägt Kopf, Phasenwerte und die Stelle in der Trefferliste", () => {
    show({
      mobile: true,
      eintragBlatt: blaettern,
      gewaehlt: partie({ accuracyOpening: 92.6, accuracyMiddlegame: null, accuracyEndgame: null }),
    });
    const blatt = screen.getByTestId("game-detail-sheet");
    expect(blatt.textContent).toContain("DragonSlayer_88");
    // Genauigkeit im Kopf, Phasen darunter · der fehlende Wert als Strich.
    // Die Trennzeichen setzt die Sprache · geprüft wird die Zahl, nicht das Komma.
    expect(blatt.textContent).toMatch(/91[.,]2 %/);
    expect(blatt.textContent).toContain("blatt.accuracyByPhase");
    expect(blatt.textContent).toMatch(/92[.,]6 %/);
    expect(blatt.textContent).toContain("—");
    // Die Stelle steht wie in der gewöhnlichen Fassung: Zahl / Zahl.
    expect(blatt.textContent).toMatch(/3 \/ 1[.,]523/);
  });

  it("blättert über die Leiste weiter", () => {
    show({ mobile: true, eintragBlatt: blaettern });
    fireEvent.click(screen.getByText("games.next"));
    expect(blaettern.onWeiter).toHaveBeenCalled();
  });

  it("lässt die Phasenzeile weg, solange die Partie nicht analysiert ist", () => {
    show({
      mobile: true,
      eintragBlatt: blaettern,
      gewaehlt: partie({ analyzed: false }),
    });
    const blatt = screen.getByTestId("game-detail-sheet");
    expect(blatt.textContent).not.toContain("blatt.accuracyByPhase");
  });
});
