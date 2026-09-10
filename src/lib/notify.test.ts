import { beforeEach, describe, expect, it, vi } from "vitest";
import { translator } from "./i18n";
import { setFormatLocale } from "./format";
import type { Settings } from "./settings";
import {
  applyReminderSchedule,
  ensureNotificationChannel,
  ensurePermission,
  localDay,
  minutesOfDay,
  notify,
  reminderBody,
  reminderMessage,
  type ReminderInput,
} from "./notify";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const t = translator("de");

beforeEach(() => {
  invokeMock.mockReset();
  // Wie in der App: `loadTranslator` stellt das Zahlformat auf die Sprache der
  // Meldung. Der Aufmacher des Wochenberichts trägt Kennzahlen, und die müssen
  // dem Satz folgen, in dem sie stehen.
  setFormatLocale("de-DE");
});

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: "de",
    db_path: null,
    engine_path: null,
    engine_threads: 0,
    engine_hash_mb: 256,
    engine_multipv: 3,
    live_depth: 24,
    batch_depth: 14,
    syzygy_path: null,
    chessdb_enabled: true,
    explorer_enabled: true,
    explorer_ratings: "",
    explorer_speeds: "",
    auto_import: true,
    cc_user: "",
    li_user: "",
    display_name: "",
    theme: "dark",
    board_set: "auto",
    piece_set: "classic",
    theme_auto: "off",
    theme_night: "dusk",
    theme_night_from: "19:00",
    theme_night_to: "07:00",
    diagram_mode: false,
    annotate_own_only: false,
    import_months: 3,
    puzzle_goal: 20,
    puzzle_hide_theme: false,
    rep_due_limit: 20,
    rep_new_limit: 5,
    sound_enabled: true,
    sound_volume: 70,
    auto_update: true,
    sync_enabled: false,
    sync_code: "",
    sync_host: "",
    sync_fingerprint: "",
    sync_auto: false,
    notify_enabled: true,
    notify_time: "18:00",
    notify_study: true,
    notify_repertoire: true,
    notify_puzzles: true,
    notify_endgame: true,
    notify_analysis: true,
    notify_weekly: true,
    weekly_minutes: 0,
    training_days: 0,
    goal_date: "",
      onboarded: true,
    analytics_enabled: false,
    analytics_installation_id: "",
    ...overrides,
  };
}

function due(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    study: 0,
    repertoire: 0,
    puzzlesLeft: 0,
    endgameDone: true,
    unanalyzed: 0,
    streakDays: 0,
    todayMinutes: 0,
    weekMinutes: 0,
    report: null,
    lastWeekMinutes: 0,
    ...overrides,
  };
}

/**
 * Ein Bericht mit genau einer Aussage · mehr braucht der Aufmacher nicht, und
 * die Rechnung dahinter prüft `weekly.test.ts`.
 */
function weeklyReport(): NonNullable<ReminderInput["report"]> {
  const week = { start: 1_786_060_800, end: 1_786_060_800 + 7 * 86_400 };
  return {
    week,
    games: 14,
    previousGames: 11,
    minutes: 196,
    previousMinutes: 142,
    target: 240,
    activeDays: 5,
    byArea: [],
    changes: [
      {
        key: "blunders_per100",
        from: 4.1,
        to: 2.8,
        delta: -1.3,
        unit: "per100",
        lowerIsBetter: true,
        n: 612,
        noise: 0.8,
        moved: true,
        better: true,
      },
    ],
    quiet: null,
    rating: null,
    next: null,
  };
}

describe("reminder text", () => {
  it("lists every pending activity that is switched on", () => {
    const body = reminderBody(
      t,
      settings(),
      due({ study: 2, repertoire: 14, puzzlesLeft: 8, endgameDone: false, unanalyzed: 3 })
    );
    expect(body).toBe(
      "2 geplante Einheiten · 14 Wiederholungen fällig · 8 Puzzles bis zum Tagesziel · Endspiel-Training offen · 3 Partien unanalysiert"
    );
  });

  it("skips categories the user switched off", () => {
    const body = reminderBody(
      t,
      settings({ notify_repertoire: false, notify_endgame: false }),
      due({ repertoire: 14, endgameDone: false, puzzlesLeft: 5 })
    );
    expect(body).toBe("5 Puzzles bis zum Tagesziel");
  });

  it("stays silent when nothing is pending", () => {
    expect(reminderBody(t, settings(), due())).toBeNull();
    // Ein erledigtes Endspiel darf die Erinnerung nicht auslösen.
    expect(reminderBody(t, settings(), due({ endgameDone: true }))).toBeNull();
  });

  it("parses the reminder time and falls back to 18:00", () => {
    expect(minutesOfDay("07:30")).toBe(450);
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("nope")).toBe(18 * 60);
    expect(minutesOfDay("25:00")).toBe(18 * 60);
  });

  it("builds a local day key", () => {
    expect(localDay(new Date(2026, 6, 5, 23, 30))).toBe("2026-07-05");
    expect(localDay(new Date(2026, 11, 31, 0, 5))).toBe("2026-12-31");
  });
});

// Mittwoch bzw. Montag · der Wochentag entscheidet über die Form der Meldung.
const WEDNESDAY = new Date(2026, 7, 12, 18, 0);
const MONDAY = new Date(2026, 7, 17, 18, 0);

describe("reminder message", () => {
  it("puts the reason first and the list below it", () => {
    const message = reminderMessage(
      t,
      settings(),
      due({ repertoire: 14, weekMinutes: 20 }),
      WEDNESDAY
    );
    expect(message?.title).toBe("Training");
    expect(message?.lead).toBe("Zeit fürs Training.");
    expect(message?.detail).toBe("14 Wiederholungen fällig");
    expect(message?.body).toBe("Zeit fürs Training.\n14 Wiederholungen fällig");
  });

  it("leads with a streak that would break tonight", () => {
    const message = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ repertoire: 3, streakDays: 12, todayMinutes: 0, weekMinutes: 90 }),
      WEDNESDAY
    );
    expect(message?.lead).toBe("12 Tage in Folge — heute noch nichts.");
  });

  it("drops the streak line once the day has minutes on it", () => {
    // Trainiert ist trainiert · dann steht dort das offene Wochenziel.
    const message = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ repertoire: 3, streakDays: 12, todayMinutes: 25, weekMinutes: 90 }),
      WEDNESDAY
    );
    expect(message?.lead).toBe("Noch 90 Min. bis zum Wochenziel.");
  });

  it("reports the finished week on monday, even with nothing left to do", () => {
    // Unter der Woche schweigt Kiebitz, wenn nichts offen ist · der Bericht
    // erzählt aber von der vergangenen Woche und nicht von diesem Abend.
    expect(reminderMessage(t, settings(), due(), WEDNESDAY)).toBeNull();

    const review = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      // Der Montag steht am Anfang seiner eigenen Woche · berichtet wird über
      // die abgeschlossene davor.
      due({ weekMinutes: 0, lastWeekMinutes: 145 }),
      MONDAY
    );
    expect(review?.title).toBe("Deine Woche");
    expect(review?.lead).toBe("145 von 180 Min. letzte Woche.");
    expect(review?.detail).toBe("");
    expect(review?.body).toBe("145 von 180 Min. letzte Woche.");
  });

  it("reports without a budget too", () => {
    const review = reminderMessage(t, settings(), due({ lastWeekMinutes: 45 }), MONDAY);
    expect(review?.lead).toBe("45 Min. letzte Woche trainiert.");
  });

  it("leads with the report itself once there is one", () => {
    // Der Wochenbericht schlägt die Minutenzahl · er sagt in einem Satz, was
    // die Woche verändert hat, und genau dafür gibt es ihn.
    const review = reminderMessage(
      t,
      settings({ weekly_minutes: 180 }),
      due({ lastWeekMinutes: 145, report: weeklyReport() }),
      MONDAY
    );
    expect(review?.title).toBe("Deine Woche");
    expect(review?.lead).toBe("Besser geworden: Patzer/100 Züge von 4,1 auf 2,8.");
  });

  it("keeps monday an ordinary evening once the weekly report is switched off", () => {
    const off = settings({ notify_weekly: false, weekly_minutes: 180 });
    expect(reminderMessage(t, off, due({ lastWeekMinutes: 145 }), MONDAY)).toBeNull();
    expect(reminderMessage(t, off, due({ repertoire: 3, weekMinutes: 20 }), MONDAY)?.title).toBe(
      "Training"
    );
  });
});

describe("native notification bridge", () => {
  it("requests Android permission through the native plugin", async () => {
    invokeMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("granted");

    await expect(ensurePermission()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "plugin:notification|is_permission_granted"
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "plugin:notification|request_permission"
    );
  });

  it("sends an Android test notification without window.Notification", async () => {
    invokeMock.mockImplementation((command?: string) => {
      // The notification package performs one capability probe without a
      // command in jsdom; it is unrelated to the native path under test.
      if (!command) return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") {
        return Promise.resolve(true);
      }
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|create_channel") return Promise.resolve();
      if (command === "plugin:notification|notify") return Promise.resolve();
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await ensureNotificationChannel(t);
    await notify("Training", "Zeit fürs Training.\n14 Wiederholungen fällig");

    // Der Kanal heißt wie in den Systemeinstellungen und trägt die Akzentfarbe.
    expect(invokeMock).toHaveBeenCalledWith(
      "plugin:notification|create_channel",
      expect.objectContaining({ id: "training", lightsColor: "#22C08A" })
    );
    // Zusammengeklappt eine Zeile, aufgeklappt beide · sonst bricht Android
    // den Aufmacher mitten im Satz ab.
    expect(invokeMock).toHaveBeenCalledWith("plugin:notification|notify", {
      options: {
        title: "Training",
        body: "Zeit fürs Training.",
        icon: "ic_notification",
        iconColor: "#22C08A",
        largeBody: "Zeit fürs Training.\n14 Wiederholungen fällig",
        autoCancel: true,
        visibility: 1,
        channelId: "training",
      },
    });
  });

  it("falls back to the default channel when the app cannot create its own", async () => {
    invokeMock.mockImplementation((command?: string) => {
      if (!command) return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") return Promise.resolve(true);
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|notify") return Promise.resolve();
      // Kein Kanal · Android verwirft eine Meldung stillschweigend, die auf
      // einen Kanal zeigt, den es nicht gibt.
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await ensureNotificationChannel(t);
    await notify("Training", "Zeit fürs Training.");
    const call = invokeMock.mock.calls.find(
      ([command]) => command === "plugin:notification|notify"
    );
    expect(call?.[1].options.channelId).toBeUndefined();
  });

  it("persists one alarm per weekday and verifies each without serializing native pending objects", async () => {
    invokeMock.mockImplementation((command?: string) => {
      if (!command) return Promise.resolve();
      if (command === "get_settings") {
        return Promise.resolve(settings({ notify_time: "07:35" }));
      }
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|cancel") return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") {
        return Promise.resolve(true);
      }
      if (command === "study_data") {
        return Promise.resolve({
          due_now: 4,
          puzzle_goal: 20,
          today_puzzle_attempts: 2,
          unanalyzed: 1,
          activity: [{ endgame_attempts: 0 }],
          streak_days: 0,
        });
      }
      if (command === "study_calendar") {
        return Promise.resolve({ events: [], days: [] });
      }
      // Der AlarmManager bestätigt alle sieben · die Prüfung verlangt genau das.
      if (command === "plugin:notification|batch") {
        return Promise.resolve([4711, 4712, 4713, 4714, 4715, 4716, 4717]);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await applyReminderSchedule();

    const batchCall = invokeMock.mock.calls.find(
      ([command]) => command === "plugin:notification|batch"
    );
    const batch = batchCall?.[1]?.notifications ?? [];
    // Ein Alarm je Wochentag, `weekday` zählt ab Sonntag = 1 · ein einzelner
    // täglicher Alarm könnte den Sonntagsrückblick nicht vom Rest trennen.
    expect(batch.map((entry: { id: number }) => entry.id)).toEqual([
      4711, 4712, 4713, 4714, 4715, 4716, 4717,
    ]);
    expect(
      batch.map(
        (entry: { schedule: { interval: { interval: { weekday: number } } } }) =>
          entry.schedule.interval.interval.weekday
      )
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // Der Montag trägt den Wochenbericht, die übrigen sechs die Erinnerung ·
    // `weekday` zählt ab Sonntag = 1, der Montag ist also der zweite Alarm.
    expect(batch[1].title).toBe("Deine Woche");
    expect(
      batch
        .filter((_: unknown, index: number) => index !== 1)
        .every((entry: { title: string }) => entry.title === "Training")
    ).toBe(true);

    expect(batch[1]).toEqual(
      expect.objectContaining({
        schedule: expect.objectContaining({
          interval: { interval: { weekday: 2, hour: 7, minute: 35 }, allowWhileIdle: false },
        }),
        sourceJson: expect.any(String),
      })
    );
    expect(JSON.parse(batch[1].sourceJson)).toEqual(
      expect.objectContaining({
        id: 4712,
        title: expect.any(String),
        body: expect.any(String),
        schedule: {
          interval: {
            interval: { weekday: 2, hour: 7, minute: 35 },
            allowWhileIdle: false,
          },
        },
      })
    );
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:notification|get_pending");
  });

  it("refuses a week the alarm manager only half accepted", async () => {
    invokeMock.mockImplementation((command?: string) => {
      if (!command) return Promise.resolve();
      if (command === "get_settings") return Promise.resolve(settings());
      if (command === "app_info") {
        return Promise.resolve({ version: "test", backend: "tauri", platform: "android" });
      }
      if (command === "plugin:notification|cancel") return Promise.resolve();
      if (command === "plugin:notification|is_permission_granted") return Promise.resolve(true);
      if (command === "study_data") {
        return Promise.resolve({
          due_now: 1,
          puzzle_goal: 20,
          today_puzzle_attempts: 0,
          unanalyzed: 0,
          activity: [{ endgame_attempts: 0 }],
          streak_days: 0,
        });
      }
      if (command === "study_calendar") return Promise.resolve({ events: [], days: [] });
      // Drei fehlen · eine halb angelegte Woche ist schlimmer als keine.
      if (command === "plugin:notification|batch") return Promise.resolve([4711, 4712, 4713, 4714]);
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    await expect(applyReminderSchedule()).rejects.toThrow(/nicht registriert/);
  });
});
