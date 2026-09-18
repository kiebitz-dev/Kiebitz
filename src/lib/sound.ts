/**
 * Kurze Brettklänge aus echten Aufnahmen von Holzfiguren auf einem Holzbrett.
 *
 * Quelle: "chess pieces.wav" von simone_ds, CC0 1.0
 * https://freesound.org/people/simone_ds/sounds/366065/
 *
 * Die fünf Ausschnitte liegen als kleine Offline-Assets im App-Bundle. Zug,
 * Schlag, Rochade und Matt stammen aus dem gewählten Set D; für Schach wird
 * auf Wunsch der kräftige Matt-Anschlag aus Set F verwendet.
 *
 * Alle fünf sind mit *einem* gemeinsamen Faktor auf 0,89 Vollausschlag
 * angehoben · gemeinsam, damit der Schlag lauter bleibt als der Zug.
 */

export type BoardSoundKind =
  | "move"
  | "capture"
  | "castle"
  | "check"
  | "checkmate"
  | "error"
  /** Ein Halt im Durchgang durch die Partie · siehe lib/soundSynth.ts. */
  | "moment"
  /** Derselbe Halt, aber an einem Zug mit „!!“ oder „!“. */
  | "glanz";

/** Die Klänge, zu denen es eine Aufnahme gibt. */
type Aufgenommen = Exclude<BoardSoundKind, "moment" | "glanz">;

const SOUND_URLS: Record<Aufgenommen, string> = {
  move: new URL("../assets/sounds/move.wav", import.meta.url).href,
  capture: new URL("../assets/sounds/capture.wav", import.meta.url).href,
  castle: new URL("../assets/sounds/castle.wav", import.meta.url).href,
  check: new URL("../assets/sounds/check.wav", import.meta.url).href,
  checkmate: new URL("../assets/sounds/checkmate.wav", import.meta.url).href,
  // Für Fehlbedienungen bleibt derselbe unaufdringliche Kontakt wie beim Zug.
  error: new URL("../assets/sounds/move.wav", import.meta.url).href,
};

const POOL_SIZE = 3;
let enabled = true;
let volume = 0.7;
let unavailable = false;
const pools = new Map<BoardSoundKind, HTMLAudioElement[]>();

export function setBoardSoundEnabled(on: boolean): void {
  enabled = on;
  if (on) primeBoardSounds();
}

export function boardSoundEnabled(): boolean {
  return enabled;
}

/** 0 … 1; 100 % gibt die Aufnahmen unverändert aus. */
export function setBoardSoundVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  for (const pool of pools.values()) {
    for (const audio of pool) audio.volume = outputVolume();
  }
}

function outputVolume(): number {
  // Der leicht gekrümmte Verlauf gibt dem unteren Teil des Reglers mehr Raum.
  // Den Kopfraum gegen Übersteuerung tragen die Aufnahmen selbst · sie sind auf
  // 0,89 Vollausschlag normalisiert, damit hier nichts mehr abgeregelt werden
  // muss. Vorher lag der Regler bei Voreinstellung effektiv bei knapp 30 %
  // Amplitude, und das war schlicht zu leise.
  return Math.pow(volume, 1.15);
}

function createAudio(kind: BoardSoundKind): HTMLAudioElement | null {
  if (unavailable || typeof Audio === "undefined") return null;
  const url = SOUND_URLS[kind as Aufgenommen];
  if (!url) return null;
  try {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = outputVolume();
    return audio;
  } catch {
    unavailable = true;
    return null;
  }
}

function soundPool(kind: BoardSoundKind): HTMLAudioElement[] {
  const cached = pools.get(kind);
  if (cached) return cached;
  const pool: HTMLAudioElement[] = [];
  const audio = createAudio(kind);
  if (audio) pool.push(audio);
  pools.set(kind, pool);
  return pool;
}

/**
 * Lädt die kurzen lokalen Dateien frühzeitig an. Das startet noch keine
 * Wiedergabe und erzeugt auch außerhalb eines Browsers keine Nebenwirkung.
 */
function primeBoardSounds(): void {
  // Nur die Aufnahmen · die gerechneten Töne haben nichts zu laden.
  for (const kind of Object.keys(SOUND_URLS) as Aufgenommen[]) {
    const pool = soundPool(kind);
    for (const audio of pool) {
      try {
        audio.load();
      } catch {
        /* Vorladen ist optional; abgespielt wird beim ersten Brettzug. */
      }
    }
  }
}

function availableAudio(kind: BoardSoundKind): HTMLAudioElement | null {
  const pool = soundPool(kind);
  const idle = pool.find((audio) => audio.paused || audio.ended);
  if (idle) return idle;
  if (pool.length < POOL_SIZE) {
    const audio = createAudio(kind);
    if (audio) {
      pool.push(audio);
      return audio;
    }
  }
  // Bei mehr als drei fast gleichzeitigen Ereignissen darf der älteste Klang
  // neu beginnen; Brettinteraktionen selbst dürfen nie auf Audio warten.
  return pool[0] ?? null;
}

function start(kind: BoardSoundKind): void {
  if (!enabled) return;
  if (kind === "moment" || kind === "glanz") {
    // Gerechnet statt aufgenommen, und erst beim ersten Ton geladen · siehe
    // lib/soundSynth.ts.
    const lautstaerke = outputVolume();
    void import("./soundSynth").then((m) => m.spieleTon(kind, lautstaerke)).catch(() => {});
    return;
  }
  const audio = availableAudio(kind);
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
    audio.volume = outputVolume();
    const playing = audio.play();
    if (playing) void playing.catch(() => {});
  } catch {
    /* Ein fehlgeschlagener Klang darf keinen Zug unterbrechen. */
  }
}

/**
 * Spielt einen Brettklang. Fehlt Audio oder ist der Ton abgeschaltet, passiert
 * nichts; Aufrufer müssen das nicht prüfen.
 */
export function playBoardSound(kind: BoardSoundKind, delaySeconds = 0): void {
  if (!enabled) return;
  const delayMs = Math.max(0, delaySeconds) * 1_000;
  if (delayMs > 0) {
    globalThis.setTimeout(() => start(kind), delayMs);
  } else {
    start(kind);
  }
}
