/**
 * Die Tiefenreiter der Insights im Diagramm-Modus.
 *
 * Geprüft wird, was den Satz dieser Blätter ausmacht und was beim Umsetzen
 * schiefgehen kann:
 *
 * · Der Reiter bringt seinen eigenen Formularkopf mit · vier Felder und den
 *   eingekastelten Wert, nicht die vier Zahlen der Übersicht.
 * · Ein Halbzug wird zum Zug, bevor er dasteht (Eröffnungen) — die Zahl aus
 *   der Auswertung ist ein Halbzug, und in der Bildunterschrift stünde sonst
 *   Zug 13, wo Zug 7 gemeint ist.
 * · Fehlt eine Zahl, steht ein Gedankenstrich · nie „NaN" und nie eine
 *   ausgedachte Null.
 * · Ein Abschnitt ohne Daten fällt weg, statt leer dazustehen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StrengthBlatt from "./StrengthBlatt";
import OpeningsBlatt from "./OpeningsBlatt";
import TimeBlatt from "./TimeBlatt";
import TrainingBlatt from "./TrainingBlatt";
import { demoDeepInsights, demoPuzzleInsights, DEMO_ERRORS } from "../../insights/demo";
import type { DeepInsights } from "../../../lib/insights";
import type { LiveInsights } from "../../../lib/stats";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

// Die Lückenliste holt sich das Blatt selbst · im Test antwortet niemand.
vi.mock("../../../lib/repertoire", () => ({ repGaps: () => Promise.resolve([]) }));

afterEach(cleanup);

const live = {
  phaseAccuracy: [
    { phase: "opening" as const, accuracy: 84.4, games: 96 },
    { phase: "middlegame" as const, accuracy: 79.2, games: 96 },
    { phase: "endgame" as const, accuracy: 81.5, games: 32 },
  ],
  byWeekday: [],
  byTimeSlot: [],
  byLength: [],
  resultTrend: [],
  activity: { days: [], slots: [], values: [] },
} as unknown as LiveInsights;

describe("Stärke", () => {
  it("setzt den eigenen Formularkopf statt der Zahlen der Übersicht", () => {
    render(<StrengthBlatt mobile={false} deep={demoDeepInsights()} live={live} errors={DEMO_ERRORS} />);
    expect(screen.getAllByText("ins.stConversion").length).toBeGreaterThan(0);
    expect(screen.getByText("ins.stDecisive")).toBeTruthy();
    // Der eingekastelte Wert ist die schwächste Phase, nicht die schwächste Achse.
    expect(screen.getByText("blatt.weakest")).toBeTruthy();
    expect(screen.getAllByText("ins.phase.middlegame").length).toBeGreaterThan(0);
  });

  it("lässt den Vergleich weg, wenn das Gegnerfeld fehlt", () => {
    const ohne: DeepInsights = {
      ...demoDeepInsights(),
      benchmark: { games: 0, avg_opp_elo: 0, me: null, field: null },
    };
    render(<StrengthBlatt mobile={false} deep={ohne} live={live} errors={DEMO_ERRORS} />);
    expect(screen.queryByText("ins.stBenchTitle")).toBeNull();
    // Der Rest des Blattes steht trotzdem.
    expect(screen.getByText("ins.stResultTitle")).toBeTruthy();
  });

  it("sagt es, wenn keine Partie analysiert ist", () => {
    const leer: DeepInsights = {
      ...demoDeepInsights(),
      content: { ...demoDeepInsights().content, games: 0 },
    };
    render(<StrengthBlatt mobile={false} deep={leer} live={live} errors={[]} />);
    expect(screen.getByText("ins.stNoAnalysis")).toBeTruthy();
    expect(screen.queryByText("ins.stResultTitle")).toBeNull();
  });
});

describe("Eröffnungen", () => {
  it("rechnet den Halbzug in einen Zug um, bevor er dasteht", () => {
    // avg_departure_ply 13,2 · daraus wird Zug 7, nicht Zug 13.
    render(
      <OpeningsBlatt
        mobile={false}
        deep={demoDeepInsights()}
        desktop={false}
        onOpenRepertoire={vi.fn()}
      />
    );
    const noten = screen.getAllByText("ins.opFamilyNote");
    expect(noten.length).toBeGreaterThan(0);
  });

  it("zeigt die Lückenrubrik nur am Rechner", () => {
    render(
      <OpeningsBlatt
        mobile={false}
        deep={demoDeepInsights()}
        desktop={false}
        onOpenRepertoire={vi.fn()}
      />
    );
    expect(screen.queryByText("ins.opGapsTitle")).toBeNull();
  });
});

describe("Zeit", () => {
  it("sagt es, wenn Uhrdaten fehlen", () => {
    const ohneUhr: DeepInsights = {
      ...demoDeepInsights(),
      time: { ...demoDeepInsights().time, games: 0, moves: 0 },
    };
    render(<TimeBlatt mobile={false} deep={ohneUhr} />);
    expect(screen.getByText("ins.tmNoClocks")).toBeTruthy();
    expect(screen.queryByText("ins.tmSpeedTitle")).toBeNull();
  });

  it("setzt Tempo, Zeitnot und die Formattabelle", () => {
    render(<TimeBlatt mobile={false} deep={demoDeepInsights()} />);
    // Der Titel steht zweimal: als Rubrik und als Kopf der Spalte darunter.
    expect(screen.getAllByText("ins.tmSpeedTitle").length).toBe(2);
    expect(screen.getAllByText("ins.tmTroubleTitle").length).toBeGreaterThan(0);
    expect(screen.getByText("ins.fmtTitle")).toBeTruthy();
  });
});

describe("Training", () => {
  it("kommt ohne Puzzle-Auswertung aus", () => {
    render(<TrainingBlatt mobile={false} deep={demoDeepInsights()} puzzles={null} />);
    // Der Kopf steht, die Puzzle-Rubrik fällt weg.
    expect(screen.getByText("ins.pzRating")).toBeTruthy();
    expect(screen.queryByText("ins.tabPuzzles")).toBeNull();
  });

  it("setzt die Lernkurve je Motiv, sobald es Puzzles gibt", () => {
    render(
      <TrainingBlatt mobile={false} deep={demoDeepInsights()} puzzles={demoPuzzleInsights()} />
    );
    expect(screen.getByText("ins.trThemeCurve")).toBeTruthy();
    expect(screen.getByText("ins.tabPuzzles")).toBeTruthy();
  });

  it("schreibt keine NaN, wenn ein Monatswert fehlt", () => {
    const deep = demoDeepInsights();
    const luecke: DeepInsights = {
      ...deep,
      progress: {
        ...deep.progress,
        accuracy_delta: null,
        rating_delta: null,
        months: deep.progress.months.map((monat) => ({
          ...monat,
          accuracy: null,
          rating: null,
          blunders_per_100: null,
        })),
      },
    };
    const { container } = render(
      <TrainingBlatt mobile={false} deep={luecke} puzzles={null} />
    );
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});
