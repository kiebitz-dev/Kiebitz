import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEEDBACK_ADDRESS,
  feedbackBody,
  feedbackMailto,
  feedbackSubject,
  installCrashReporter,
  logEvent,
  sendFeedback,
  startHeartbeat,
  type FeedbackDraft,
} from "./diag";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function draft(overrides: Partial<FeedbackDraft> = {}): FeedbackDraft {
  return {
    type: "crash",
    summary: "  Analyse friert ein  ",
    details: "  Partie geöffnet, dann Engine gestartet.  ",
    email: " tom@example.com ",
    platform: "Windows",
    version: "0.6.0",
    diagnostics: "",
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("feedback text", () => {
  it("puts the report together and trims what the user typed", () => {
    const body = feedbackBody(draft());
    expect(body).toContain("Type: Crash report");
    expect(body).toContain("Summary: Analyse friert ein");
    expect(body).toContain("Partie geöffnet, dann Engine gestartet.");
    expect(body).toContain("Platform: Windows");
    expect(body).toContain("App version: 0.6.0");
    expect(body).toContain("Email: tom@example.com");
  });

  it("marks a missing address as such instead of leaving a gap", () => {
    expect(feedbackBody(draft({ email: "   " }))).toContain("Email: (none)");
  });

  it("only carries the diagnostics when they were attached", () => {
    expect(feedbackBody(draft())).not.toContain("Diagnostics");
    const withReport = feedbackBody(draft({ diagnostics: "Kiebitz 0.6.0\nEngine: gefunden" }));
    expect(withReport).toContain("── Diagnostics ──");
    expect(withReport).toContain("Engine: gefunden");
  });

  it("names type and summary in the subject", () => {
    expect(feedbackSubject(draft())).toBe("Kiebitz · Crash report: Analyse friert ein");
    expect(feedbackSubject(draft({ type: "feature", summary: "" }))).toBe(
      "Kiebitz · Feature request"
    );
  });

  it("builds a mailto link to the published address", () => {
    const link = feedbackMailto(draft());
    expect(link.startsWith(`mailto:${FEEDBACK_ADDRESS}?`)).toBe(true);
    expect(link).toContain("subject=");
    expect(link).toContain("body=");
  });
});

describe("sending", () => {
  it("posts the fields the website form uses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: "true" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendFeedback(draft({ diagnostics: "report" }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(FEEDBACK_ADDRESS);
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      report_type: "Crash report",
      summary: "Analyse friert ein",
      message: "Partie geöffnet, dann Engine gestartet.",
      platform: "Windows",
      app_version: "0.6.0",
      email: "tom@example.com",
      diagnostics: "report",
    });
  });

  it("reports a refusal from the form service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: "false" }) })
    );
    await expect(sendFeedback(draft())).rejects.toThrow(/abgelehnt/);
  });

  it("reports an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(sendFeedback(draft())).rejects.toThrow("HTTP 503");
  });
});

describe("logging", () => {
  it("hands a line to the backend", () => {
    logEvent("warn", "ui", "Etwas ist seltsam");
    expect(invokeMock).toHaveBeenCalledWith("log_event", {
      level: "warn",
      source: "ui",
      message: "Etwas ist seltsam",
    });
  });

  it("swallows a failing backend so nothing stalls on a log line", async () => {
    invokeMock.mockRejectedValue(new Error("kein Backend"));
    expect(() => logEvent("info", "ui", "egal")).not.toThrow();
    await Promise.resolve();
  });

  it("records unhandled errors and rejections, and unhooks again", () => {
    const dispose = installCrashReporter();

    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 12 })
    );
    expect(invokeMock).toHaveBeenCalledWith("log_event", {
      level: "error",
      source: "ui",
      message: "boom (app.js:12)",
    });

    // jsdom kennt PromiseRejectionEvent nicht · das Event wird nachgebaut.
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("kaputt");
    window.dispatchEvent(rejection);
    expect(invokeMock).toHaveBeenCalledWith("log_event", {
      level: "error",
      source: "ui",
      message: "Unbehandeltes Promise · Error: kaputt",
    });

    dispose();
    invokeMock.mockClear();
    window.dispatchEvent(new ErrorEvent("error", { message: "danach" }));
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("startHeartbeat", () => {
  it("pocht nur, solange ein Wachhund zuhört", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue(true);
      const stop = startHeartbeat(1_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(invokeMock).toHaveBeenCalledWith("ui_heartbeat", { visible: true });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(invokeMock).toHaveBeenCalledTimes(4);

      stop();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(invokeMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hört nach dem ersten Schlag auf, wenn niemand zuhört (Windows, Android)", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue(false);
      const stop = startHeartbeat(1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
