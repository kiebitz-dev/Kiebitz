/**
 * Diagnose und Rückmeldungen.
 *
 * Kiebitz schickt nichts von sich aus. Das Logbuch bleibt lokal, der
 * Diagnosebericht wird nur auf Knopfdruck angehängt, und abgesendet wird eine
 * Rückmeldung ausschließlich durch den Nutzer selbst · dieselbe Adresse und
 * derselbe Weg wie im Formular der Website.
 */
import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "error" | "warn" | "info" | "debug";

/** Spiegelt diag::LogEntry. */
export interface LogEntry {
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}

export type ReportType = "feedback" | "crash" | "feature";

/** Empfänger und Endpunkt sind dieselben wie im Formular der Website. */
export const FEEDBACK_ADDRESS = "support@kiebitz.dev";
const FEEDBACK_ENDPOINT = `https://formsubmit.co/ajax/${FEEDBACK_ADDRESS}`;

/**
 * Schreibt eine Zeile ins lokale Logbuch. Schluckt eigene Fehler: ein
 * fehlgeschlagener Logaufruf darf den Ablauf nicht anhalten, und im Web-Preview
 * gibt es gar kein Backend.
 */
export function logEvent(level: LogLevel, source: string, message: string): void {
  invoke("log_event", { level, source, message }).catch(() => {});
}

export function diagLogs(limit = 200): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("diag_logs", { limit });
}

export function diagClear(): Promise<void> {
  return invoke<void>("diag_clear");
}

export function diagLogPath(): Promise<string> {
  return invoke<string>("diag_log_path");
}

export function diagReport(): Promise<string> {
  return invoke<string>("diag_report");
}

export function diagSaveReport(path: string, contents: string): Promise<string> {
  return invoke<string>("diag_save_report", { path, contents });
}

/**
 * Fängt unbehandelte Fehler der Oberfläche ab und schreibt sie ins Logbuch ·
 * das ist die Datenbasis für einen Absturzbericht, den niemand von Hand
 * abtippen muss. Gibt eine Abmeldefunktion zurück.
 */
export function installCrashReporter(): () => void {
  const onError = (event: ErrorEvent) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno})` : "";
    logEvent("error", "ui", `${event.message}${where}`);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason ?? "unbekannter Grund");
    logEvent("error", "ui", `Unbehandeltes Promise · ${message}`);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export interface FeedbackDraft {
  type: ReportType;
  summary: string;
  details: string;
  /** Optional · ohne Adresse bleibt die Meldung anonym. */
  email: string;
  platform: string;
  version: string;
  /** Technischer Bericht, den der Nutzer bewusst angehängt hat. */
  diagnostics: string;
}

const TYPE_SUBJECT: Record<ReportType, string> = {
  feedback: "Feedback",
  crash: "Crash report",
  feature: "Feature request",
};

/** Der Text, der abgeschickt bzw. kopiert wird · genau das und nichts sonst. */
export function feedbackBody(draft: FeedbackDraft): string {
  const lines = [
    `Type: ${TYPE_SUBJECT[draft.type]}`,
    `Summary: ${draft.summary.trim()}`,
    "",
    draft.details.trim(),
    "",
    `Platform: ${draft.platform || "—"}`,
    `App version: ${draft.version || "—"}`,
    `Email: ${draft.email.trim() || "(none)"}`,
  ];
  if (draft.diagnostics) {
    lines.push("", "── Diagnostics ──", draft.diagnostics.trim());
  }
  return lines.join("\n");
}

/** Betreffzeile im Postfach des Entwicklers. */
export function feedbackSubject(draft: FeedbackDraft): string {
  const summary = draft.summary.trim();
  return `Kiebitz · ${TYPE_SUBJECT[draft.type]}${summary ? `: ${summary}` : ""}`;
}

/**
 * Schickt die Rückmeldung über denselben Formulardienst, den die Website
 * benutzt. Wird ausschließlich aus einem Klick auf "Senden" heraus aufgerufen ·
 * es gibt keinen automatischen Versand.
 */
export async function sendFeedback(draft: FeedbackDraft): Promise<void> {
  const response = await fetch(FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _subject: feedbackSubject(draft),
      _template: "table",
      _captcha: "false",
      report_type: TYPE_SUBJECT[draft.type],
      summary: draft.summary.trim(),
      message: draft.details.trim(),
      platform: draft.platform,
      app_version: draft.version,
      email: draft.email.trim(),
      diagnostics: draft.diagnostics,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = (await response.json().catch(() => null)) as { success?: string } | null;
  // FormSubmit antwortet mit success: "true" als Zeichenkette.
  if (result && result.success != null && String(result.success) !== "true") {
    throw new Error("Der Formulardienst hat die Meldung abgelehnt.");
  }
}

/** mailto-Link als Weg ohne Formulardienst · das Postfach übernimmt der Nutzer. */
export function feedbackMailto(draft: FeedbackDraft): string {
  const query = new URLSearchParams({
    subject: feedbackSubject(draft),
    body: feedbackBody(draft),
  });
  return `mailto:${FEEDBACK_ADDRESS}?${query.toString()}`;
}
