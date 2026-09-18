/**
 * Die beiden gerechneten Klänge des Durchgangs · „Moment" und „Glanz".
 *
 * Sie kommen nicht vom Brett: Keine Figur wird aufgesetzt, sondern die
 * Analyse hält an einer Stelle an. Deshalb sollen sie auch nicht nach Holz
 * klingen, und deshalb steht hier kein sechster Ausschnitt aus derselben
 * Aufnahme wie in `sound.ts`, sondern ein Paar weicher Sinustöne: „Moment"
 * ein einzelner Anschlag, „Glanz" zwei steigende. Das spart eine Datei im
 * Bündel und einen Eintrag in den Lizenzhinweisen, und leise genug einstellen
 * lässt es sich nur so.
 *
 * Die Datei lädt erst beim ersten Ton nach (`sound.ts` holt sie dynamisch):
 * Gespielt werden die Klänge nur im Durchgang der Analyse, und die Startseite
 * soll dafür nichts tragen.
 */

/** Ein Sinuston · Frequenz, Einsatz nach dem Anschlag, Klingdauer in Sekunden. */
type Ton = { hz: number; ab: number; dauer: number };

const TOENE: Record<"moment" | "glanz", Ton[]> = {
  moment: [{ hz: 523.25, ab: 0, dauer: 0.17 }],
  glanz: [
    { hz: 659.25, ab: 0, dauer: 0.14 },
    { hz: 987.77, ab: 0.085, dauer: 0.22 },
  ],
};

/** Wie laut die gerechneten Töne über dem Brettklang stehen dürfen. */
const SPITZE = 0.2;

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

/** Einen der beiden Klänge ausgeben · `lautstaerke` wie beim Brettklang. */
export function spieleTon(art: "moment" | "glanz", lautstaerke: number): void {
  const ctx = audioKontext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const jetzt = ctx.currentTime;
    const spitze = Math.max(0.0002, SPITZE * lautstaerke);
    for (const ton of TOENE[art]) {
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
