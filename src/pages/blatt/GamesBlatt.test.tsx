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
      {...handlers}
      {...props}
    />
  );
  return handlers;
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
});
