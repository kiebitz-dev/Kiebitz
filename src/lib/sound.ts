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
  /** Ein Halt im Durchgang durch die Partie · siehe `SYNTH`. */
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

/**
 * Ein einzelner Sinuston einer gerechneten Figur · Frequenz, Einsatz nach dem
 * Anschlag, Klingdauer, alles in Sekunden.
 */
type Ton = { hz: number; ab: number; dauer: number };

/**
 * Die beiden Klänge des Durchgangs · gerechnet statt aufgenommen.
 *
 * Sie kommen nicht vom Brett: Keine Figur wird aufgesetzt, sondern die
 * Analyse hält an einer Stelle an. Deshalb sollen sie auch nicht nach Holz
 * klingen, und deshalb steht hier kein sechster Ausschnitt aus derselben
 * Aufnahme, sondern ein Paar weicher Sinustöne: „Moment" ein einzelner
 * Anschlag, „Glanz" zwei steigende. Das spart eine Datei im Bündel und einen
 * Eintrag in den Lizenzhinweisen, und leise genug einstellen lässt es sich
 * nur so.
 */
const SYNTH: Partial<Record<BoardSoundKind, Ton[]>> = {
  moment: [{ hz: 523.25, ab: 0, dauer: 0.17 }],
  glanz: [
    { hz: 659.25, ab: 0, dauer: 0.14 },
    { hz: 987.77, ab: 0.085, dauer: 0.22 },
  ],
};

/** Wie laut die gerechneten Töne über dem Brettklang stehen dürfen. */
const SYNTH_SPITZE = 0.2;

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

/**
 * Einen gerechneten Klang ausgeben.
 *
 * Der Kontext entsteht beim ersten Ton und bleibt dann stehen; Browser starten
 * ihn erst nach der ersten Bedienung, deshalb der Weckruf davor. Fällt etwas
 * davon aus — kein Web Audio, kein erlaubter Kontext —, bleibt es still, und
 * der Durchgang läuft weiter.
 */
let tonkontext: AudioContext | null = null;

function audioKontext(): AudioContext | null {
  if (tonkontext) return tonkontext;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    tonkontext = new Ctor();
  } catch {
    return null;
  }
  return tonkontext;
}

function playSynth(toene: Ton[]): void {
  const ctx = audioKontext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const jetzt = ctx.currentTime;
    const spitze = Math.max(0.0002, SYNTH_SPITZE * outputVolume());
    for (const ton of toene) {
      const oszillator = ctx.createOscillator();
      const huelle = ctx.createGain();
      oszillator.type = "sine";
      oszillator.frequency.value = ton.hz;
      const beginn = jetzt + ton.ab;
      // Ein harter Einsatz knackt · zwölf Millisekunden reichen dagegen.
      huelle.gain.setValueAtTime(0.0001, beginn);
      huelle.gain.linearRampToValueAtTime(spitze, beginn + 0.012);
      huelle.gain.exponentialRampToValueAtTime(0.0001, beginn + ton.dauer);
      oszillator.connect(huelle);
      huelle.connect(ctx.destination);
      oszillator.start(beginn);
      oszillator.stop(beginn + ton.dauer + 0.02);
    }
  } catch {
    /* Ein fehlgeschlagener Klang darf keinen Durchgang unterbrechen. */
  }
}

function start(kind: BoardSoundKind): void {
  if (!enabled) return;
  const toene = SYNTH[kind];
  if (toene) {
    playSynth(toene);
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
