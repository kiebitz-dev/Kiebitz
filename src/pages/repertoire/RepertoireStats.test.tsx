/**
 * Die Kopfzeile der Lücken-Karte.
 *
 * Auf dem Handy bricht ihre Überschrift zweizeilig um. Die Anzahl stand
 * danach frei zwischen der zweiten Zeile und dem Aufklapp-Knopf und las sich
 * wie dessen Beschriftung. Auf dem Desktop, wo die Überschrift in eine Zeile
 * passt, gehört sie weiterhin dorthin.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "../../lib/i18n";
import { ShellProvider } from "../../components/MobileShell";
import type { RepGap } from "../../lib/repertoire";
import { GapsCard } from "./RepertoireStats";

const gaps: RepGap[] = [
  {
    node_id: 1,
    side: "white",
    path_sans: ["e4", "e5"],
    san: "Nf3",
    count: 12,
    mine: true,
    score_pct: 48.5,
    book_sans: ["Bc4"],
    line: "Testlinie",
  },
];

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
});

afterEach(cleanup);

function header(): HTMLElement {
  return screen.getByRole("heading", { name: /Lücken/ }).closest("header") as HTMLElement;
}

describe("GapsCard", () => {
  it("keeps the count in the header on the desktop", () => {
    render(
      <LocaleProvider>
        <GapsCard gaps={gaps} onAdopt={() => {}} />
      </LocaleProvider>
    );
    expect(within(header()).getByText("1")).toBeTruthy();
  });

  it("drops the loose count on the phone and leaves it to the line below", () => {
    render(
      <LocaleProvider>
        <ShellProvider mobile>
          <GapsCard gaps={gaps} onAdopt={() => {}} />
        </ShellProvider>
      </LocaleProvider>
    );
    // In der Kopfzeile stehen nur noch Überschrift und Knopf.
    expect(within(header()).queryByText("1")).toBeNull();
    expect(within(header()).getByRole("button", { name: /Anzeigen/ })).toBeTruthy();
    // Die Zahl ist trotzdem da · zugeklappt beginnt der Satz mit ihr.
    expect(screen.getByText(/^1 Züge/)).toBeTruthy();
  });
});
