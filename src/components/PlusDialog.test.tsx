/**
 * Wo die Plus-Erklärung liegt und wie man sie wieder los wird.
 *
 * Als fensterweiter Dialog lag sie über der Navigationsleiste und lief unter
 * dem Anzeigenband hindurch — das ist auf Android eine native Fläche über der
 * WebView und von HTML aus nicht zu überdecken. Auf dem Handy gehört sie
 * deshalb in den Behälter, der genau den Inhaltsbereich abdeckt; damit ist sie
 * zugleich eine Schicht wie jede andere und geht auf Zurück wieder zu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PlusDialog from "./PlusDialog";
import { ShellProvider } from "./MobileShell";
import { SHEET_ROOT_ID } from "./MobileSheet";
import { LocaleProvider } from "../lib/i18n";
import { openPlusDialog } from "../lib/plus/dialog";
import { revokePlus } from "../test/plus";

// Ob hier gekauft werden kann, entscheidet sonst die Tauri-Brücke.
vi.mock("../lib/plus/billing", () => ({ billingAvailable: () => Promise.resolve(false) }));

let root: HTMLElement | null = null;

/** Die mobile Schale stellt den Behälter über <main> bereit. */
function withSheetRoot(): HTMLElement {
  root = document.createElement("div");
  root.id = SHEET_ROOT_ID;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  localStorage.setItem("kiebitz.locale", "de");
  revokePlus();
});

afterEach(() => {
  cleanup();
  root?.remove();
  root = null;
});

function show(mobile: boolean) {
  render(
    <LocaleProvider>
      <ShellProvider mobile={mobile}>
        <PlusDialog />
      </ShellProvider>
    </LocaleProvider>
  );
  act(() => openPlusDialog("focus_board"));
}

describe("PlusDialog", () => {
  it("stays inside the content area of the mobile shell", () => {
    const sheetRoot = withSheetRoot();
    show(true);

    const dialog = screen.getByRole("dialog");
    expect(sheetRoot.contains(dialog)).toBe(true);
    // Kein `fixed` mehr · der Schleier deckt genau den Behälter.
    expect(dialog.className).toContain("absolute");
  });

  it("keeps the window-wide dialog where there is no such shell", () => {
    show(false);
    expect(screen.getByRole("dialog").className).toContain("fixed");
  });

  it("closes on Android back instead of changing the page underneath", async () => {
    withSheetRoot();
    show(true);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Die eigene Marke steht im History-Eintrag · sie ist es, die Zurück
    // abräumt, statt die Seite darunter zu wechseln.
    expect((window.history.state as { sheet?: boolean } | null)?.sheet).toBe(true);

    window.history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("takes its own history entry with it when the button closes it", async () => {
    withSheetRoot();
    show(true);

    // Zweimal "Schliessen": das Kreuz im Kopf und der Knopf im Fuss.
    const buttons = screen.getAllByRole("button", { name: "Schließen" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect((window.history.state as { sheet?: boolean } | null)?.sheet).toBeUndefined()
    );
  });
});
