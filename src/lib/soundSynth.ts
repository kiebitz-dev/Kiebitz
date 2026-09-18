/**
 * Die beiden gerechneten Klänge des Durchgangs · „Moment" und „Glanz".
 *
 * Sie kommen nicht vom Brett: Keine Figur wird aufgesetzt, sondern die
 * Analyse schlägt eine Stelle auf. „Moment" ist deshalb ein Umblättern ·
 * gefiltertes Rauschen, das wie ein Blatt durch die Luft streicht und leise
 * aufliegt. Das bleibt ein Material-Geräusch wie Holz auf Holz und passt so
 * zu den Aufnahmen in `sound.ts`, ohne eine sechste Datei ins Bündel und
 * einen Eintrag in die Lizenzhinweise zu bringen. „Glanz" bleibt ein Paar
 * weicher, steigender Sinustöne · der Durchgang legt ihn über das Umblättern,
 * der Nochmal-Versuch spielt ihn allein.
 *
 * Die Datei lädt erst beim ersten Ton nach (`sound.ts` holt sie dynamisch):
 * Gespielt werden die Klänge nur in der Analyse, und die Startseite soll
 * dafür nichts tragen.
 */

/** Ein Sinuston · Frequenz, Einsatz nach dem Anschlag, Klingdauer in Sekunden. */
type Ton = { hz: number; ab: number; dauer: number };

const GLANZ: Ton[] = [
  { hz: 659.25, ab: 0, dauer: 0.14 },
  { hz: 987.77, ab: 0.085, dauer: 0.22 },
];

/** Wie laut die Sinustöne über dem Brettklang stehen dürfen. */
const SPITZE = 0.2;

/**
 * Wie laut das Umblättern werden darf. Rauschen verteilt seine Energie über
 * das ganze Band und klingt bei gleicher Spitze leiser als ein Ton · die
 * Zahl ist am Zugklang (move.wav) abgeglichen, siehe `umblaettern`.
 */
const BLATT_SPITZE = 0.55;

/**
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

/**
 * Ein fester Zufall · jedes Umblättern knistert gleich. Ein echtes Blatt
 * klänge jedes Mal ein wenig anders, aber ein Klang, der sich wiederholt,
 * wird zum Zeichen, und das soll er hier sein.
 */
function zufall(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Weißes Rauschen einer bestimmten Länge. */
function rauschen(ctx: BaseAudioContext, sekunden: number, seed: number): AudioBuffer {
  const laenge = Math.max(1, Math.round(ctx.sampleRate * sekunden));
  const puffer = ctx.createBuffer(1, laenge, ctx.sampleRate);
  const daten = puffer.getChannelData(0);
  const naechste = zufall(seed);
  for (let i = 0; i < laenge; i++) daten[i] = naechste() * 2 - 1;
  return puffer;
}

/**
 * Das Umblättern · zwei Teile.
 *
 * Das Streichen: Rauschen durch einen Bandpass, der von 700 Hz auf 3,2 kHz
 * steigt und wieder etwas fällt, während das Blatt sich hebt und dreht. Die
 * Hüllkurve steigt rasch, trägt ein unregelmäßiges Knistern und läuft aus.
 *
 * Das Aufliegen: ein kurzer, dumpfer Stoß unter 900 Hz am Ende · das Blatt
 * legt sich auf den Stapel. Er bindet den Klang an die Holzaufnahmen, die
 * alle mit einem Anschlag enden.
 */
export function umblaettern(ctx: BaseAudioContext, ziel: AudioNode, beginn: number, lautstaerke: number): void {
  const spitze = Math.max(0.0002, BLATT_SPITZE * lautstaerke);

  const streichDauer = 0.26;
  const streich = ctx.createBufferSource();
  streich.buffer = rauschen(ctx, streichDauer + 0.02, 7);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(700, beginn);
  band.frequency.exponentialRampToValueAtTime(3200, beginn + 0.14);
  band.frequency.exponentialRampToValueAtTime(2100, beginn + streichDauer);
  const tief = ctx.createBiquadFilter();
  tief.type = "highpass";
  tief.frequency.value = 350;
  const streichHuelle = ctx.createGain();
  const punkte = 96;
  const kurve = new Float32Array(punkte);
  const knistern = zufall(19);
  for (let i = 0; i < punkte; i++) {
    const x = i / (punkte - 1);
    // Rasch an, langsam aus · die Spitze liegt bei einem Drittel.
    const form = x < 0.3 ? Math.sin((x / 0.3) * (Math.PI / 2)) : Math.pow(1 - (x - 0.3) / 0.7, 1.6);
    const korn = 0.62 + 0.38 * knistern();
    kurve[i] = Math.max(0.0001, spitze * form * korn);
  }
  kurve[0] = 0.0001;
  kurve[punkte - 1] = 0.0001;
  streichHuelle.gain.setValueCurveAtTime(kurve, beginn, streichDauer);
  streich.connect(band);
  band.connect(tief);
  tief.connect(streichHuelle);
  streichHuelle.connect(ziel);
  streich.start(beginn);
  streich.stop(beginn + streichDauer + 0.02);

  const aufAb = beginn + 0.2;
  const aufDauer = 0.09;
  const auf = ctx.createBufferSource();
  auf.buffer = rauschen(ctx, aufDauer + 0.02, 31);
  const dumpf = ctx.createBiquadFilter();
  dumpf.type = "lowpass";
  dumpf.frequency.value = 900;
  dumpf.Q.value = 0.7;
  const aufHuelle = ctx.createGain();
  aufHuelle.gain.setValueAtTime(0.0001, aufAb);
  aufHuelle.gain.linearRampToValueAtTime(spitze * 1.1, aufAb + 0.006);
  aufHuelle.gain.exponentialRampToValueAtTime(0.0001, aufAb + aufDauer);
  auf.connect(dumpf);
  dumpf.connect(aufHuelle);
  aufHuelle.connect(ziel);
  auf.start(aufAb);
  auf.stop(aufAb + aufDauer + 0.02);
}

function glanz(ctx: BaseAudioContext, ziel: AudioNode, jetzt: number, lautstaerke: number): void {
  const spitze = Math.max(0.0002, SPITZE * lautstaerke);
  for (const ton of GLANZ) {
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
    huelle.connect(ziel);
    oszillator.start(beginn);
    oszillator.stop(beginn + ton.dauer + 0.02);
  }
}

/** Einen der beiden Klänge ausgeben · `lautstaerke` wie beim Brettklang. */
export function spieleTon(art: "moment" | "glanz", lautstaerke: number): void {
  const ctx = audioKontext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    if (art === "moment") umblaettern(ctx, ctx.destination, ctx.currentTime, lautstaerke);
    else glanz(ctx, ctx.destination, ctx.currentTime, lautstaerke);
  } catch {
    /* Ein fehlgeschlagener Klang darf keinen Durchgang unterbrechen. */
  }
}
