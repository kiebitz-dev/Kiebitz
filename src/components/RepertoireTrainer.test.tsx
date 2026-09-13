/**
 * Was am Trainer nachprüfbar sein muss · das freie Üben.
 *
 * Die eine Zusage, die dabei zählt, ist eine Zusage über etwas, das *nicht*
 * passiert: Wer außer der Reihe übt, verschiebt seinen Wiederholungsplan
 * nicht. Ein richtiger Zug darf eine Karte nicht wegschieben, ein falscher sie
 * nicht zurückwerfen. Genau das prüft dieser Test · und nebenher, dass der
 * Stapel überhaupt aus dem Buch kommt und nicht aus `rep_due`.
 *
 * Dazu die Notiz zur Stellung: Sie steht seit 1.4 auch im Training, und zwar
 * verdeckt, solange die Frage offen ist — in einer Notiz steht „hier immer
 * c3", und damit stünde die Antwort neben der Frage. Und der Diagramm-Modus:
 * Der Trainer war die eine Stelle, an der er in die gewöhnliche Fassung
 * zurückfiel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RepertoireTrainer from "./RepertoireTrainer";
import type { RepNode } from "../lib/repertoire";

const repDue = vi.hoisted(() => vi.fn(() => Promise.resolve([])));
const repReview = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ due_ts: 0, interval_days: 1 }))
);

vi.mock("../lib/repertoire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/repertoire")>();
  return { ...actual, repDue, repReview };
});

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));

/** Welche der beiden Fassungen gerade geprüft wird. */
const modus = vi.hoisted(() => ({ diagramm: false }));
vi.mock("../lib/diagramMode", () => ({ useDiagramMode: () => modus.diagramm }));

vi.mock("../lib/i18n", () => ({
  useI18n: () => ({ locale: "en", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

// Das Brett meldet einen Zug, sobald jemand darauf tippt · welchen, sagt der
// Test über `data-move`.
vi.mock("./Board", () => ({
  default: ({ onPieceDrop }: { onPieceDrop: (from: string, to: string) => boolean }) => (
    <button data-testid="board" onClick={() => onPieceDrop("g1", "f3")}>
      play Nf3
    </button>
  ),
}));

function node(over: Partial<RepNode> & Pick<RepNode, "id" | "parent_id" | "san">): RepNode {
  return {
    side: "white",
    name: "",
    note: "",
    fen_key: "",
    depth: 1,
    reps: 3,
    lapses: 0,
    due_ts: Number.MAX_SAFE_INTEGER, // weit in der Zukunft · nichts ist fällig
    stability: 30,
    sort_order: 0,
    my_move: false,
    ...over,
  };
}

/** 1.e4 e5 2.Nf3 · eine einzige eigene Antwort, die gerade nicht dran wäre. */
const BOOK: RepNode[] = [
  node({ id: 1, parent_id: 0, san: "e4", my_move: true, name: "Open games", depth: 1 }),
  node({ id: 2, parent_id: 1, san: "e5", depth: 2 }),
  node({ id: 3, parent_id: 2, san: "Nf3", my_move: true, depth: 3 }),
];

beforeEach(() => {
  repDue.mockClear();
  repReview.mockClear();
  modus.diagramm = false;
});

afterEach(cleanup);

describe("RepertoireTrainer · free practice", () => {
  it("builds its stack from the book instead of asking the scheduler", async () => {
    render(<RepertoireTrainer nodes={BOOK} free onExit={() => {}} />);
    // Zwei Fragen · die Grundstellung und die Stellung nach 1...e5.
    expect(await screen.findByTestId("board")).toBeTruthy();
    expect(repDue).not.toHaveBeenCalled();
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy();
  });

  it("leaves the review schedule alone, right or wrong", async () => {
    render(<RepertoireTrainer nodes={BOOK} free onExit={() => {}} />);
    fireEvent.click(await screen.findByTestId("board"));
    // Ob der Zug in dieser Stellung passte, ist hier gleichgültig · gebucht
    // werden darf in keinem der beiden Fälle etwas.
    expect(repReview).not.toHaveBeenCalled();
  });

  it("still asks the scheduler when it is not a free session", async () => {
    render(<RepertoireTrainer nodes={BOOK} onExit={() => {}} onFreeTraining={() => {}} />);
    expect(repDue).toHaveBeenCalledTimes(1);
    // Ohne fällige Karten bleibt das Schlussbild · mit dem Ausweg ins freie Üben.
    expect(await screen.findByText("rep.nothingDue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /rep.freeTraining/ })).toBeTruthy();
  });
});

/**
 * Dasselbe Buch, aber mit einem Satz an jeder gefragten Stellung.
 *
 * An *jeder*, weil `repFreeItems` den Stapel würfelt: Würde nur eine der
 * beiden Karten einen Satz tragen, prüfte der Test mal ihn und mal die andere.
 */
const NOTIZ = "Immer mit Tempo entwickeln.";
const BOOK_MIT_NOTIZ: RepNode[] = [
  node({
    id: 1,
    parent_id: 0,
    san: "e4",
    my_move: true,
    name: "Open games",
    depth: 1,
    note: NOTIZ,
  }),
  node({ id: 2, parent_id: 1, san: "e5", depth: 2 }),
  node({ id: 3, parent_id: 2, san: "Nf3", my_move: true, depth: 3, note: NOTIZ }),
];

describe("RepertoireTrainer · die Notiz zur Stellung", () => {
  it("steht gleich offen da, wo es nichts zu verraten gibt", async () => {
    render(<RepertoireTrainer nodes={BOOK} free onExit={() => {}} />);
    await screen.findByTestId("board");

    // Ein leeres Feld verrät keinen Zug · also gibt es auch nichts zuzudecken.
    expect(screen.getByRole("textbox", { name: "rep.note" })).toBeTruthy();
    expect(screen.queryByText("blatt.covered")).toBeNull();
  });

  it("hält einen vorhandenen Satz zu, solange die Frage offen ist", async () => {
    render(<RepertoireTrainer nodes={BOOK_MIT_NOTIZ} free onExit={() => {}} />);
    await screen.findByTestId("board");

    // In einer Notiz steht der Plan, und der nennt oft genug den Zug selbst.
    expect(screen.getByText("blatt.covered")).toBeTruthy();
    expect(screen.getByText("rep.noteHidden")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "rep.note" })).toBeNull();
  });

  it("deckt ihn auf Wunsch auf", async () => {
    render(<RepertoireTrainer nodes={BOOK_MIT_NOTIZ} free onExit={() => {}} />);
    await screen.findByTestId("board");

    fireEvent.click(screen.getByText("blatt.covered"));

    const feld = screen.getByRole("textbox", { name: "rep.note" }) as HTMLTextAreaElement;
    expect(feld.value).toBe(NOTIZ);
  });
});

describe("RepertoireTrainer · im Diagramm-Modus", () => {
  it("setzt die Sitzung als Bogen und nicht als Karten", async () => {
    modus.diagramm = true;
    render(<RepertoireTrainer nodes={BOOK} free onExit={() => {}} />);

    // Der Kolumnentitel ist das Zeichen, dass wirklich das Blatt dasteht.
    expect(await screen.findByText("blatt.trainerTitle")).toBeTruthy();
    // Und die Bedienung ist die Haarlinienreihe, nicht die Knopfzeile.
    expect(screen.getByRole("button", { name: "rep.reveal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "rep.endTraining" })).toBeTruthy();
  });

  it("setzt auch den leeren Stapel als Seite des Buches", async () => {
    modus.diagramm = true;
    render(<RepertoireTrainer nodes={BOOK} onExit={() => {}} onFreeTraining={() => {}} />);

    expect(await screen.findByText("blatt.trainerTitle")).toBeTruthy();
    expect(screen.getByText("rep.nothingDue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "rep.backToRep" })).toBeTruthy();
  });
});
