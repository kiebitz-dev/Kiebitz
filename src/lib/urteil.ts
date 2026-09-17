import { Chess } from "chess.js";
import type { MoveEvalRow } from "./analysis";
import { winProb } from "./evaluation";

/**
 * Das Urteil über einen Zug · „Brillant" bis „Patzer".
 *
 * Die groben Fehler kommen aus dem Analyselauf (`src-tauri/src/analysis.rs`):
 * Ungenauigkeit, Fehler und Patzer stehen als `judgment` in der Zeile. Alles
 * darüber — Buchzug, Opfer, Wendepunkt, bester Zug — entsteht erst hier, weil
 * es sich aus den gespeicherten Zahlen und dem Brett ausrechnen lässt und
 * dafür keine zweite Engine-Runde nötig ist.
 *
 * Gerechnet wird in dieser Datei und nicht mehr in `pages/Analysis.tsx`, damit
 * die Blatt-Fassung dieselben Urteile bekommt und damit sich die Schwellen an
 * echten Partien nachprüfen lassen · siehe `urteil.test.ts`.
 */

/** Einheitliche Zug-Sicht für Demo- und DB-Partien. */
export interface ViewMove {
  san: string;
  evalCp: number | null; // nach dem Zug, aus Weiß-Sicht
  mateIn: number | null;
  nag?: string;
  bestUci?: string;
  playedUci?: string;
  judgment?: MoveJudgment;
}

export type MoveJudgment =
  | "book"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** Buchzüge tragen wie bei chess.com ein Buch-Symbol statt eines Kürzels. */
export const NAG: Record<MoveJudgment, string> = {
  book: "",
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "•",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

/**
 * Farbe je Bewertung · Tokens statt Werte, damit die Zugliste dem Thema folgt.
 * Im farbsicheren Thema hängt daran mehr als der Farbton: Dort laufen `win`
 * und `loss` über Blau und Orange, und genau hier wird das gebraucht.
 */
export const JUDGMENT_COLOR: Record<MoveJudgment, string> = {
  book: "var(--color-gold-dim)",
  brilliant: "var(--color-win)",
  great: "var(--color-blue)",
  best: "var(--color-win)",
  excellent: "var(--color-accent)",
  good: "var(--color-draw)",
  inaccuracy: "var(--color-gold)",
  mistake: "var(--color-warn)",
  blunder: "var(--color-loss)",
};

/**
 * Bewertungen, die in der Zugliste ein Kürzel hinter dem Zug tragen.
 *
 * Alles, was in `NAG` ein Satzzeichen trägt, steht auch hinter dem Zug. Vorher
 * fehlten „!" und „?" in dieser Liste: Die Bewertung gab es, das Kürzel
 * daneben nicht, und in der Zugliste sah ein Fehler aus wie ein gewöhnlicher
 * Zug.
 */
export const MARKED_IN_LIST: MoveJudgment[] = [
  "brilliant",
  "great",
  "excellent",
  "inaccuracy",
  "mistake",
  "blunder",
];

/** Zahl fürs Chart / die Eval-Bar: Matt zählt wie ±10 Bauern. */
export function evalNum(cp: number | null, mate: number | null): number {
  if (mate != null) return mate > 0 ? 1000 : -1000;
  return cp ?? 0;
}

// ── Opfer erkennen ───────────────────────────────────────────────────────────

/** Figurenwerte in Bauern · der König zählt nicht, er wird nicht geschlagen. */
const WERT: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Materialbilanz einer Stellung aus Sicht einer Seite, in Bauern. */
function material(brett: Chess, weiss: boolean): number {
  let summe = 0;
  for (const reihe of brett.board()) {
    for (const feld of reihe) {
      if (!feld) continue;
      summe += (feld.color === "w") === weiss ? WERT[feld.type] : -WERT[feld.type];
    }
  }
  return summe;
}

/**
 * Was die Seite am Zug auf einem Feld erobern kann · Schlagabtausch (SEE).
 *
 * Es schlägt immer die billigste Figur, und jede Seite darf aussteigen, sobald
 * der Abtausch sich nicht mehr lohnt (`Math.max(0, …)`). Das ist die übliche
 * Näherung: Sie sieht keine Zwischenzüge, dafür braucht sie keine Engine.
 */
function see(brett: Chess, feld: string): number {
  const schlaege = brett.moves({ verbose: true }).filter((z) => z.to === feld && z.captured);
  if (schlaege.length === 0) return 0;
  let billigste = schlaege[0];
  for (const z of schlaege) if (WERT[z.piece] < WERT[billigste.piece]) billigste = z;
  const gewinn = WERT[billigste.captured as string];
  brett.move(billigste);
  const wert = Math.max(0, gewinn - see(brett, feld));
  brett.undo();
  return wert;
}

/** Das beste Material, das die Seite am Zug irgendwo erobern kann. */
function beute(brett: Chess): number {
  const felder = new Set(
    brett
      .moves({ verbose: true })
      .filter((z) => z.captured)
      .map((z) => z.to)
  );
  let bestes = 0;
  for (const feld of felder) bestes = Math.max(bestes, see(brett, feld));
  return bestes;
}

/**
 * Steht überhaupt genug zum Schlagen? · die billige Vorprüfung vor `opfer`.
 *
 * Ein Opfer setzt voraus, dass der Gegner mindestens eine Leichtfigur nehmen
 * könnte. Das steht in einem einzigen Zuggenerator-Lauf fest, ohne jede
 * Abtauschrechnung, und sortiert den weitaus größten Teil der Kandidaten aus,
 * bevor die teure Rechnung anläuft.
 */
function genugZuHolen(brett: Chess): boolean {
  return brett
    .moves({ verbose: true })
    .some((z) => z.captured && WERT[z.captured] >= OPFER.IM_FEUER);
}

/**
 * Dieselbe Stellung, aber die andere Seite ist am Zug („Nullzug").
 *
 * Gebraucht wird sie als Vergleichsmaß: Nur so lässt sich sagen, ob *dieser
 * Zug* Material preisgibt oder ob es ohnehin schon im Feuer stand. `null`,
 * wenn die Seite am Zug im Schach steht — dann wäre die gedrehte Stellung
 * keine Schachstellung mehr, weil ein König schlagbar dastünde.
 */
function nullzug(fen: string): Chess | null {
  const teile = fen.split(" ");
  teile[1] = teile[1] === "w" ? "b" : "w";
  teile[3] = "-";
  try {
    return new Chess(teile.join(" "));
  } catch {
    return null;
  }
}

/**
 * Was ein Zug an Material einsetzt · in Bauern, aus Sicht des Ziehenden.
 *
 * `imFeuer` ist das Material, das der Zug dem Gegner *neu* zum Schlagen
 * hinstellt; `einsatz` ist, was unterm Strich draufgeht, wenn der Gegner
 * zugreift — was der Zug selbst erbeutet, ist da schon abgezogen. Eine
 * gewöhnliche Rücknahme kommt damit auf null, ein Läuferopfer auf drei, ein
 * Qualitätsopfer auf zwei.
 */
function opfer(vor: Chess, nach: Chess, fenVor: string, weiss: boolean): {
  einsatz: number;
  imFeuer: number;
} {
  const beuteNach = beute(nach);
  // Was danach nicht im Feuer steht, kann auch kein Opfer sein · die zweite,
  // gleich teure Rechnung für den Vergleichswert bleibt dann aus.
  if (beuteNach < OPFER.IM_FEUER) return { einsatz: 0, imFeuer: 0 };
  const gedreht = vor.isCheck() ? null : nullzug(fenVor);
  const imFeuer = beuteNach - (gedreht ? beute(gedreht) : 0);
  const einsatz = material(vor, weiss) - material(nach, weiss) + imFeuer;
  return { einsatz, imFeuer };
}

// ── Schwellen ────────────────────────────────────────────────────────────────

/**
 * Ab wann ein Einsatz ein Opfer ist.
 *
 * `IM_FEUER` verlangt, dass mindestens eine Leichtfigur neu zum Schlagen
 * steht — ein hingestellter Bauer ist ein Gambit, kein Opfer. `EINSATZ`
 * verlangt, dass unterm Strich auch etwas draufgeht: Wer schlägt und
 * zurückgeschlagen wird, hat nichts geopfert, und genau das hat die alte Regel
 * reihenweise mit „!!" ausgezeichnet.
 */
const OPFER = { IM_FEUER: 3, EINSATZ: 2 };

/**
 * Wie gut man vor dem Opfer schon stehen darf und wie gut man danach noch
 * stehen muss · Zentibauern aus Sicht des Ziehenden.
 *
 * Wer ohnehin klar gewinnt, opfert nichts, sondern verschenkt Vorsprung; und
 * ein Opfer, nach dem man verloren steht, war keines, sondern ein Einsteller.
 */
const OPFER_STELLUNG = { VORHER_HOECHSTENS: 200, NACHHER_MINDESTENS: -50 };

/** Ein Wendepunkt braucht diesen Sprung in der Gewinnwahrscheinlichkeit. */
const WENDE_SPRUNG = 0.25;

/** Bis zu diesem Verlust gilt ein Zug noch als „fast bester". */
const FAST_BESTER = 0.02;

/**
 * Gewinnwahrscheinlichkeit zu Lage: verloren (0), offen (1), gewonnen (2).
 *
 * Die Grenzen liegen dort, wo aus „schlechter" ein „verloren" wird · 0,30 und
 * 0,70 entsprechen ungefähr ∓2,3 Bauern.
 */
function lage(wp: number): 0 | 1 | 2 {
  return wp < 0.3 ? 0 : wp > 0.7 ? 2 : 1;
}

// ── Die Zugliste ─────────────────────────────────────────────────────────────

export function rowsToViewMoves(sans: string[], rows: MoveEvalRow[]): ViewMove[] {
  const byPly = new Map(rows.map((r) => [r.ply, r]));
  const chess = new Chess();
  /**
   * Die Bewertung nach dem Zug davor und die nach dem eigenen Zug davor.
   *
   * Der Wendepunkt braucht beide, weil er über eine ganze Runde misst: Der
   * Sprung entsteht am Fehler des Gegners, und die Frage ist, ob der eigene
   * Zug ihn hält. Über den eigenen Zug allein kann die Bewertung nicht
   * steigen — die Stellung davor ist schon mit bestem Spiel bewertet.
   */
  let prevEval = 20;
  let evalDavor = 20;
  let letztesZiel = "";
  return sans.map((san, i) => {
    const fenVor = chess.fen();
    const r = byPly.get(i + 1);
    let playedUci = "";
    let gezogen: { to: string; captured?: string } | null = null;
    try {
      const played = chess.move(san);
      playedUci = `${played.from}${played.to}${played.promotion ?? ""}`;
      gezogen = played;
    } catch {
      // Ungueltige Alt-Daten bleiben weiterhin sichtbar.
    }
    const currentEval = r ? evalNum(r.eval_cp, r.mate_in) : prevEval;
    const before = winProb(prevEval) / 100;
    const after = winProb(currentEval) / 100;
    const weiss = i % 2 === 0;
    const drop = weiss ? Math.max(0, before - after) : Math.max(0, after - before);
    const engineJudgment = r?.judgment as MoveJudgment | "" | undefined;
    const isBest = !!r?.best_uci && r.best_uci.slice(0, playedUci.length) === playedUci;
    let judgment: MoveJudgment | undefined = engineJudgment || undefined;
    if (r && !judgment) {
      const vorzeichen = weiss ? 1 : -1;
      const meinWp = (e: number) => (weiss ? winProb(e) : 100 - winProb(e)) / 100;
      /**
       * Opfer und Wendepunkt stehen vor dem Buchzug: Wer im achten Halbzug
       * eine Figur gibt, spielt kein Buch, auch wenn die Faustregel darunter
       * das sagen würde.
       *
       * Die teuren Prüfungen (Schlagabtausch auf dem Brett) laufen erst, wenn
       * die billigen Bedingungen stimmen. In einer gewöhnlichen Partie bleiben
       * davon eine Handvoll Züge übrig.
       */
      const opferkandidat =
        gezogen != null &&
        (isBest || drop <= FAST_BESTER) &&
        prevEval * vorzeichen <= OPFER_STELLUNG.VORHER_HOECHSTENS &&
        currentEval * vorzeichen >= OPFER_STELLUNG.NACHHER_MINDESTENS;
      const wendekandidat =
        gezogen != null &&
        i >= 1 &&
        isBest &&
        gezogen.to !== letztesZiel &&
        lage(meinWp(currentEval)) > lage(meinWp(evalDavor)) &&
        meinWp(currentEval) - meinWp(evalDavor) >= WENDE_SPRUNG;
      if (opferkandidat && istOpfer(fenVor, chess.fen(), weiss)) judgment = "brilliant";
      else if (wendekandidat && gezogen && !istGeschenk(fenVor, gezogen)) judgment = "great";
      else if (i < 16 && drop < 0.03) judgment = "book";
      else if (isBest) judgment = "best";
      else if (drop < 0.03) judgment = "excellent";
      else if (drop < 0.1) judgment = "good";
    }
    evalDavor = prevEval;
    prevEval = currentEval;
    letztesZiel = gezogen?.to ?? "";
    return {
      san,
      evalCp: r ? r.eval_cp : null,
      mateIn: r ? r.mate_in : null,
      nag: judgment ? NAG[judgment] : undefined,
      bestUci: r?.best_uci,
      playedUci,
      judgment,
    };
  });
}

/** Gibt der Zug wirklich Material her? · siehe `opfer`. */
function istOpfer(fenVor: string, fenNach: string, weiss: boolean): boolean {
  const nach = new Chess(fenNach);
  if (!genugZuHolen(nach)) return false;
  const { einsatz, imFeuer } = opfer(new Chess(fenVor), nach, fenVor, weiss);
  return imFeuer >= OPFER.IM_FEUER && einsatz >= OPFER.EINSATZ;
}

/**
 * War der Zug bloß das Einsammeln von etwas, das frei herumstand?
 *
 * Ein Wendepunkt soll ein Fund sein. Wenn der Gegner eine Figur hinstellt und
 * man sie nimmt, ist das kein Fund, sondern das Naheliegende — dafür ist die
 * Marke „bester Zug" da und nicht „großartig".
 */
function istGeschenk(fenVor: string, gezogen: { to: string; captured?: string }): boolean {
  if (!gezogen.captured) return false;
  return see(new Chess(fenVor), gezogen.to) >= 2;
}

/** ACPL je Seite aus der Evalkurve (Startstellung ≈ +20 cp). */
export function acpl(moves: ViewMove[]): { white: number; black: number } {
  let prev = 20;
  const losses: { white: number[]; black: number[] } = { white: [], black: [] };
  moves.forEach((m, i) => {
    if (m.evalCp == null && m.mateIn == null) return;
    const cur = Math.max(-1000, Math.min(1000, evalNum(m.evalCp, m.mateIn)));
    const side = i % 2 === 0 ? "white" : "black";
    const loss = side === "white" ? prev - cur : cur - prev;
    losses[side].push(Math.max(0, Math.min(1000, loss)));
    prev = cur;
  });
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  return { white: avg(losses.white), black: avg(losses.black) };
}
