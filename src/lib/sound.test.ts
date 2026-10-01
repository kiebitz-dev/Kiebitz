import { expect, it, vi } from "vitest";
import {
  boardSoundEnabled,
  playBoardSound,
  setBoardSoundEnabled,
  setBoardSoundVolume,
  type BoardSoundKind,
} from "./sound";

const KINDS: BoardSoundKind[] = [
  "move",
  "capture",
  "castle",
  "check",
  "checkmate",
  "error",
];

it("preloads and plays every recorded board sound while respecting settings", () => {
  const instances: FakeAudio[] = [];

  class FakeAudio {
    src: string;
    preload = "";
    volume = 1;
    currentTime = 4;
    paused = true;
    ended = false;
    load = vi.fn();
    pause = vi.fn(() => {
      this.paused = true;
    });
    play = vi.fn(() => {
      this.paused = false;
      return Promise.resolve();
    });

    constructor(src: string) {
      this.src = src;
      instances.push(this);
    }
  }

  vi.stubGlobal("Audio", FakeAudio);
  setBoardSoundVolume(0.5);
  setBoardSoundEnabled(true);

  expect(boardSoundEnabled()).toBe(true);
  expect(instances).toHaveLength(KINDS.length);
  expect(instances.every((audio) => audio.preload === "auto")).toBe(true);
  expect(instances.every((audio) => audio.load.mock.calls.length === 1)).toBe(true);

  for (const kind of KINDS) playBoardSound(kind);
  expect(instances.every((audio) => audio.play.mock.calls.length === 1)).toBe(true);
  expect(instances.every((audio) => audio.currentTime === 0)).toBe(true);
  expect(instances.every((audio) => audio.volume > 0 && audio.volume < 0.5)).toBe(true);

  // Die gerechneten Töne laden nichts nach · ohne Web Audio bleiben sie
  // still, und kein weiteres Audio-Element entsteht.
  playBoardSound("moment");
  playBoardSound("glanz");
  expect(instances).toHaveLength(KINDS.length);

  setBoardSoundEnabled(false);
  const played = instances.reduce((sum, audio) => sum + audio.play.mock.calls.length, 0);
  playBoardSound("move");
  expect(boardSoundEnabled()).toBe(false);
  expect(instances.reduce((sum, audio) => sum + audio.play.mock.calls.length, 0)).toBe(played);

  vi.unstubAllGlobals();
});

// WebKitGTK (Linux) spielt `tauri://` nicht ab · dort laufen die Aufnahmen
// über einmal geholte blob:-URLs.
it("plays tauri:// recordings through blob URLs", async () => {
  vi.resetModules();
  const RealURL = URL;
  class TauriURL extends RealURL {
    // Nur die Klänge · der Modullader braucht seine file:-Adressen weiter.
    override get href(): string {
      const real = super.href;
      return real.endsWith(".wav") ? `tauri://localhost/assets/${real.split("/").pop()}` : real;
    }
  }
  let blobs = 0;
  TauriURL.createObjectURL = () => `blob:tauri://localhost/${++blobs}`;
  // Kein echtes Response · Node-Response und jsdom-Blob vertragen sich nicht
  // auf jeder Plattform (unter Linux in CI blieb die Antwort aus).
  const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["RIFF"]) }));
  const sources: string[] = [];
  class FakeAudio {
    preload = "";
    volume = 1;
    currentTime = 0;
    paused = true;
    ended = false;
    load = vi.fn();
    pause = vi.fn();
    play = vi.fn(() => Promise.resolve());
    constructor(src: string) {
      sources.push(src);
    }
  }
  vi.stubGlobal("URL", TauriURL);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Audio", FakeAudio);

  const sound = await import("./sound");
  sound.setBoardSoundEnabled(true);
  // Erst die Dateien holen, dann die Elemente · keins zeigt auf tauri://.
  await vi.waitFor(() => expect(sources).toHaveLength(KINDS.length));
  expect(sources.every((src) => src.startsWith("blob:"))).toBe(true);
  // move.wav dient auch als Fehlerklang und wird nur einmal geholt.
  expect(fetchMock).toHaveBeenCalledTimes(KINDS.length - 1);

  vi.unstubAllGlobals();
  vi.resetModules();
});
