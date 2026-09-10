/**
 * Das Blatt des Trainings.
 *
 * Geprüft wird, was der Modus lange nicht hatte und keine Frage der Erscheinung
 * war: Unter dem Coach und der Woche stehen der Plan der nächsten sieben Tage
 * und die Spielhygiene. Beides gehört zum Reiter — ein Layoutmodus darf die
 * Aufteilung ändern und keine Funktion kosten.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StudyBlatt, { type StudyBlattProps } from "./StudyBlatt";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({
    locale: "de",
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
  useT: () => (key: string) => key,
}));

afterEach(cleanup);

function zeichne(over: Partial<StudyBlattProps> = {}) {
  const props: StudyBlattProps = {
    mobile: false,
    // Ohne Desktop-Fassung zeigt die Plantafel ihre Vorschau · dieselbe, die
    // auch die Web-Vorschau bekommt, und ohne Griff in die Datenbank.
    desktop: false,
    kopfRechts: "st.weekBudgetValue",
    felder: [{ label: "nav.repertoire", wert: "14" }],
    serie: 23,
    befunde: <div>befund</div>,
    bereiche: [
      { name: "Spielen", farbe: "#1c9c5a", ist: 10, soll: 30, einheiten: 4, minuten28: 120 },
    ],
    tage: [{ name: "Mo", werte: [10] }],
    wocheIst: 71,
    wocheSoll: 110,
    aufgaben: [],
    hygiene: [
      "Trainiere Rapid häufiger",
      "Hör nach 3 Partien auf",
      "Nach einer Niederlage 5 Minuten Pause",
    ],
    hygieneLeer: "plan.hygieneEmpty",
    onInsights: vi.fn(),
    ...over,
  };
  return { props, ...render(<StudyBlatt {...props} />) };
}

describe("Das Trainingsblatt", () => {
  it("trägt den Plan der nächsten sieben Tage", () => {
    zeichne();
    expect(screen.getByText("st.weekTitle")).toBeTruthy();
    // Sieben Tage, jeder eine Zelle, an der eine Einheit landen kann.
    expect(document.querySelectorAll("[data-study-day]")).toHaveLength(7);
    expect(screen.getByText("st.unitsLibrary")).toBeTruthy();
  });

  it("setzt die Spielhygiene als nummerierte Sätze, nicht als Kacheln", () => {
    zeichne();
    expect(screen.getByText("plan.hygieneTitle")).toBeTruthy();
    expect(screen.getByText("Trainiere Rapid häufiger")).toBeTruthy();
    // Die Ziffer zählt mit und benotet nichts · zweistellig, damit die Spalte steht.
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
  });

  it("sagt es, solange die Sitzungen keine Muster hergeben", () => {
    zeichne({ hygiene: [] });
    expect(screen.getByText("plan.hygieneEmpty")).toBeTruthy();
  });
});
