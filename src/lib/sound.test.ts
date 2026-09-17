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
