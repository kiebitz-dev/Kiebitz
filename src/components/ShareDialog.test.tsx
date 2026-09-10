/**
 * Was am Teilen-Dialog nachprüfbar sein muss.
 *
 * Der wichtigste Fall ist der unschöne: jsdom hat kein Canvas, also scheitert
 * die Bildkarte — genau wie sie es auf einem Gerät könnte, dessen WebView das
 * Bild nicht hergibt. Dann muss der Dialog trotzdem etwas taugen, denn der Link
 * ist der Teil, der die Stellung wirklich weiterträgt.
 *
 * Der zweite Fall ist der Spoiler: Wer eine Aufgabe weitergibt, darf die Lösung
 * nicht versehentlich mitschicken.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShareDialog, { type ShareSubject } from "./ShareDialog";
import { decodeShare } from "../lib/share/codec";

const copied: string[] = [];

vi.mock("../lib/share/deliver", () => ({
  shareTargets: () => ({ native: false, copyImage: false, saveImage: true }),
  copyText: (text: string) => {
    copied.push(text);
    return Promise.resolve();
  },
  copyImage: () => Promise.resolve(),
  saveImage: () => Promise.resolve("C:/temp/kiebitz.png"),
  shareNative: () => Promise.resolve(true),
}));

vi.mock("../lib/backend", () => ({
  useBackendInfo: () => ({ mode: "desktop", info: { platform: "windows" } }),
}));

const PUZZLE: ShareSubject = {
  kind: "puzzle",
  fen: "r4rk1/pp3ppp/8/8/8/8/PP3PPP/R4RK1 w - - 0 20",
  orientation: "white",
  lastMove: { from: "a7", to: "a8" },
  line: [
    { from: "f1", to: "f7" },
    { from: "g8", to: "h8" },
  ],
  rating: 1720,
  theme: "backRankMate",
};

/** Der Link, der beim Klick auf „Link kopieren" in der Zwischenablage landet. */
function copiedPayload(): ReturnType<typeof decodeShare> {
  const link = copied[copied.length - 1] ?? "";
  const match = /\/p\/([A-Za-z0-9_-]+)/.exec(link);
  return match ? decodeShare(match[1]) : null;
}

beforeEach(() => {
  copied.length = 0;
});

describe("ShareDialog", () => {
  it("keeps working when the picture cannot be drawn", async () => {
    render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    // Ohne Canvas bleibt die Vorschau aus · der Hinweis sagt das und der Link
    // steht weiter bereit.
    expect(await screen.findByText(/Link funktioniert trotzdem/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("https://s.kiebitz.dev/p/");
    expect(copied[0]).toContain("geteilt aus Kiebitz");
  });

  it("shares the puzzle position with its solution but without giving it away", async () => {
    render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));

    const payload = copiedPayload();
    expect(payload?.kind).toBe("puzzle");
    expect(payload?.fen).toBe(PUZZLE.fen);
    expect(payload?.line).toHaveLength(2);
    expect(payload?.rating).toBe(1720);
    // Der Zug bleibt vom Bild verdeckt, bis jemand den Schalter umlegt.
    const reveal = screen.getByLabelText(/Zug schon auf dem Bild zeigen/i) as HTMLInputElement;
    expect(reveal.checked).toBe(false);
  });

  it("leaves the solution out of the link when asked to", async () => {
    render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Lösung mitschicken/i));
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copiedPayload()?.line).toBeUndefined();
  });

  it("turns the board around without touching the position", async () => {
    render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Brett drehen/i }));
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));

    const payload = copiedPayload();
    expect(payload?.orientation).toBe("black");
    expect(payload?.fen).toBe(PUZZLE.fen);
  });

  it("names a repertoire line the way the repertoire does, moves and all", async () => {
    const line: ShareSubject = {
      kind: "repertoire",
      fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
      orientation: "white",
      lastMove: { from: "c7", to: "c5" },
      line: [{ from: "g1", to: "f3" }],
      title: "Sizilianisch · Offen",
    };
    render(<ShareDialog subject={line} onClose={() => {}} />);
    // Der Name der Linie steht schon im Feld · niemand tippt ihn ab.
    expect((screen.getByLabelText(/Überschrift/i) as HTMLInputElement).value)
      .toBe("Sizilianisch · Offen");
    expect(screen.getByLabelText(/Buchzüge mitgeben/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    const payload = copiedPayload();
    expect(payload?.kind).toBe("repertoire");
    expect(payload?.title).toBe("Sizilianisch · Offen");
    expect(payload?.line).toEqual([{ from: "g1", to: "f3" }]);
  });

  it("takes the moves so far along, and lets the sender leave them out", async () => {
    const line: ShareSubject = {
      kind: "analysis",
      fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
      orientation: "white",
      lastMove: { from: "c7", to: "c5" },
      history: "1.e4 c5",
    };
    render(<ShareDialog subject={line} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copiedPayload()?.history).toBe("1.e4 c5");

    fireEvent.click(screen.getByLabelText(/Bisherige Züge mitgeben/i));
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(2));
    expect(copiedPayload()?.history).toBeUndefined();
  });

  it("sends an endgame drill with its goal and nothing to give away", async () => {
    const drill: ShareSubject = {
      kind: "endgame",
      fen: "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1",
      orientation: "white",
      title: "Bauernendspiel · Gewinn",
    };
    render(<ShareDialog subject={drill} onClose={() => {}} />);
    expect(screen.getByText(/Schick das Endspiel weiter/i)).toBeTruthy();
    // Ohne Lösung gibt es auch keinen Schalter, der eine verspräche.
    expect(screen.queryByLabelText(/mitgeben|mitschicken/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    const payload = copiedPayload();
    expect(payload?.kind).toBe("endgame");
    expect(payload?.fen).toBe(drill.fen);
    expect(payload?.title).toBe("Bauernendspiel · Gewinn");
  });

  it("carries the sender's own heading", async () => {
    render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Überschrift/i), {
      target: { value: "Hier hänge ich fest" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Link kopieren/i }));
    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copiedPayload()?.title).toBe("Hier hänge ich fest");
    expect(copied[0]).toContain("Hier hänge ich fest");
  });

  /**
   * Der Griff „Teilen" steht auf jeder Brettseite auch in der Fokusleiste, und
   * der Fokus hängt am `document.body` (siehe components/FocusBoard.tsx).
   * Blieb der Dialog im Baum der Seite, lag er unter dem Fokus — aus dem Fokus
   * heraus ließ sich deshalb gar nichts teilen. Er hängt jetzt selbst am
   * Dokument und eine Stufe höher.
   */
  it("hangs on the document above the focus board", () => {
    const { container } = render(<ShareDialog subject={PUZZLE} onClose={() => {}} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const dialog = document.body.querySelector(':scope > [role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain("z-[55]");
  });
});
