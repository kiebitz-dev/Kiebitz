import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import Dashboard from "./Dashboard";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: unknown }) => <div>{children as never}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    LineChart: Container,
    Line: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    Legend: Empty,
  };
});

const game = {
  id: 42,
  source: "lichess",
  source_id: "abc",
  url: "https://lichess.org/abc",
  played_at: "2026-07-20",
  played_ts: 1_784_500_000,
  time_class: "rapid",
  color: "white",
  opponent: "Testgegner",
  opp_elo: 1510,
  my_elo: 1500,
  result: "win",
  opening: "Italienische Partie",
  eco: "C50",
  moves_count: 32,
  accuracy: 87.4,
  moves: "e4 e5 Nf3 Nc6 Bc4",
  note: "",
  tags: [],
  analyzed: false,
};

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "app_info":
        return Promise.resolve({ version: "0.4.4", backend: "tauri", platform: "windows" });
      case "get_settings":
        return Promise.resolve({
          locale: "de",
          cc_user: "cc-user",
          li_user: "li-user",
          display_name: "Tori",
          puzzle_goal: 12,
        });
      case "dashboard_data": {
        const summary = { ...game, has_moves: true, has_note: false };
        return Promise.resolve({
          total: 1,
          unanalyzed: summary.analyzed ? 0 : 1,
          recent: [summary],
          games: [summary],
        });
      }
      case "rep_stats":
        return Promise.resolve({ my_positions: 20, due_now: 5, coverage_pct: 42, games_checked: 1 });
      case "puzzle_stats":
        return Promise.resolve({ today_attempts: 4 });
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
});

afterEach(cleanup);

function renderDashboard() {
  const go = vi.fn();
  const openAnalysis = vi.fn();
  const openGames = vi.fn();
  render(
    <LocaleProvider>
      <Dashboard go={go} openAnalysis={openAnalysis} openGames={openGames} />
    </LocaleProvider>
  );
  return { go, openAnalysis, openGames };
}

describe("Dashboard page", () => {
  it("replaces demo content with records loaded through Tauri invoke", async () => {
    renderDashboard();

    expect(await screen.findByText("Testgegner")).toBeTruthy();
    expect(screen.getByText(/Tori/)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("87,4 %").closest("td")?.className).toContain("whitespace-nowrap");
    expect(invokeMock).toHaveBeenCalledWith("dashboard_data", {
      window: expect.objectContaining({ spark: 12 }),
    });
    // Die ganze Übersicht braucht das Dashboard nicht mehr.
    expect(invokeMock).not.toHaveBeenCalledWith("list_game_summaries");
  });

  it("turns a live game field into a precise Games filter", async () => {
    const { openGames } = renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Testgegner" }));
    expect(openGames).toHaveBeenCalledWith({ opponent: "Testgegner" });
  });

  it("turns a rating card into a Games filter on platform and time control", async () => {
    const { openGames } = renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Partien anzeigen: lichess · Rapid" }));
    expect(openGames).toHaveBeenCalledWith({ source: "lichess", tc: "rapid" });
  });

  it("routes the live analysis action", async () => {
    const { go } = renderDashboard();

    fireEvent.click(await screen.findByRole("button", { name: "Starten" }));
    expect(go).toHaveBeenCalledWith("analysis");
  });
});
