/**
 * Die Sätze zur Analyse · aus Motiv und Feldern wird Sprache.
 *
 * Die Auto-Analyse legt zu jedem Halbzug ein Motiv und dessen Felder ab
 * (`src-tauri/src/motifs.rs`) und zu jeder Partie ein Fazit aus Bausteinen
 * (`src-tauri/src/verdict.rs`). Beides ist absichtlich textfrei: Rust spricht
 * eine Sprache, Kiebitz spricht sieben. Gesetzt wird deshalb hier, aus den
 * Wörterbüchern.
 *
 * Zwei Dinge, die dieses Modul nicht tut:
 *
 * - **Es erfindet nichts.** Ohne Motiv und ohne Urteil kommt `null` zurück und
 *   die Seite schweigt. Ein Satz über einen ruhigen Zug wäre Füllung.
 * - **Es vertraut den Schlüsseln nicht.** Was aus der Datenbank kommt, ist
 *   eine Zeichenkette und kein `Key`. Erkannt wird nur, was in den Listen hier
 *   steht — eine spätere Rust-Fassung mit einem neuen Motiv soll keinen rohen
 *   Schlüssel auf die Seite schreiben.
 *
 * Die Auswahl der Formulierung hängt am Halbzug und nicht am Zufall: Derselbe
 * Zug liest sich bei jedem Öffnen gleich, aber zwei Züge nebeneinander lesen
 * sich verschieden.
 */
import type { Key, Locale, TFunc } from "./i18n";
import { notationLine, translateSan } from "./notation";
import { de } from "./format";
import { evalLabel } from "./evaluation";

/** So viele Formulierungen gibt es je Motiv · siehe `expl.*.1` / `expl.*.2`. */
const VARIANTS = 2;

/**
 * Die Motive, zu denen es Sätze gibt.
 *
 * `none` und `best_move` stehen mit in der Liste, weil auch sie einen Satz
 * bekommen — nur einen über die Bewertung statt über ein Motiv.
 */
const MOTIFS = [
  "mate",
  "missed_mate",
  "allowed_mate",
  "hanging_piece",
  "fork",
  "pin",
  "skewer",
  "discovered_attack",
  "back_rank",
  "best_move",
] as const;

type Motif = (typeof MOTIFS)[number];

function isMotif(value: string): value is Motif {
  return (MOTIFS as readonly string[]).includes(value);
}

/** Was eine Zeile der Auto-Analyse für einen Satz hergeben muss. */
export interface Zugzeile {
  ply: number;
  san: string;
  judgment: string;
  motif?: string;
  motif_detail?: string;
  loss_cp?: number | null;
}

/**
 * Eine Zahl aus dem Streuwert einer Zeichenkette · FNV-1a mit Nachmischung.
 *
 * Gebraucht wird nur Gleichverteilung über eine Handvoll Formulierungen, und
 * das leistet sie mit acht Zeilen.
 */
function seedIndex(seed: string, count: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return (hash >>> 0) % count;
}

/** Die Felder eines Motivs, so wie Rust sie abgelegt hat. */
interface Detail {
  san?: string;
  best?: string;
  reply?: string;
  piece?: string;
  square?: string;
  behind?: string;
  behindPiece?: string;
  from?: string;
  targetPiece?: string;
  targets?: { piece?: string; square?: string }[];
}

function parseDetail(raw: string | undefined): Detail {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Detail) : {};
  } catch {
    return {};
  }
}

/** Der Name einer Figur · derselbe Schlüssel wie in den Insights. */
function pieceName(t: TFunc, letter: string | undefined): string {
  if (!letter || !"PNBRQK".includes(letter)) return "";
  return t(`ins.piece.${letter}` as Key);
}

/**
 * Ein Satz zu einem Halbzug · `null`, wenn es nichts Belastbares zu sagen gibt.
 *
 * `seed` unterscheidet die Formulierungen. Üblich ist `${gameId}:${ply}` —
 * damit steht derselbe Satz zu demselben Zug in jeder Sitzung.
 */
/**
 * Der Satz zum erkannten Motiv · `null`, wenn keines belastbar dasteht.
 *
 * Getrennt vom Satz über den Preis, weil beide verschiedene Fragen
 * beantworten und nicht überall beide gebraucht werden: Die Anmerkung im
 * Fließsatz nennt den Preis schon in ihrem ersten Satz und will von hier nur
 * noch wissen, *was* passiert ist. Stünde der Preis auch hier, stünde er
 * zweimal.
 *
 * `null` heißt hier zweierlei, und beides führt zum selben Schweigen: Es gibt
 * kein Motiv, oder es gibt eines, aber die Felder dazu fehlen. Der zweite Fall
 * ist der Grund für die `break`-Zweige — ein Motivsatz ohne seine Felder wäre
 * eine Behauptung.
 */
function motivSatz(
  row: Zugzeile,
  options: { t: TFunc; locale: Locale; seed?: string }
): string | null {
  const { t, locale } = options;
  const seed = options.seed ?? `${row.ply}`;
  const san = (value: string | undefined): string =>
    value ? translateSan(value, locale) : "";
  const detail = parseDetail(row.motif_detail);
  const pick = (name: string): Key =>
    `expl.${name}.${seedIndex(seed, VARIANTS) + 1}` as Key;

  const motif = row.motif ?? "";
  if (isMotif(motif)) {
    switch (motif) {
      case "mate":
      case "best_move":
        return t(pick(motif), { san: san(detail.san ?? row.san) });
      case "missed_mate":
      case "allowed_mate":
        // Ohne den Zug, um den es geht, wäre der Satz eine Behauptung.
        if (!detail.best) break;
        return t(pick(motif), { best: san(detail.best) });
      case "hanging_piece":
        if (!detail.piece || !detail.square || !detail.reply) break;
        return t(pick(motif), {
          piece: pieceName(t, detail.piece),
          square: detail.square,
          reply: san(detail.reply),
        });
      case "fork": {
        const targets = detail.targets ?? [];
        if (!detail.square || !detail.reply || targets.length < 2) break;
        // Figur und Feld getrennt: „König g8" und „g8 的王" stellen dieselben
        // zwei Angaben in verschiedener Reihenfolge, und die gehört in die
        // Vorlage und nicht in diesen Code.
        return t(pick(motif), {
          piece: pieceName(t, detail.piece),
          square: detail.square,
          reply: san(detail.reply),
          firstPiece: pieceName(t, targets[0].piece),
          first: targets[0].square ?? "",
          secondPiece: pieceName(t, targets[1].piece),
          second: targets[1].square ?? "",
        });
      }
      case "pin":
      case "skewer":
        if (!detail.square || !detail.behind) break;
        return t(pick(motif), {
          piece: pieceName(t, detail.piece),
          square: detail.square,
          behindPiece: pieceName(t, detail.behindPiece),
          behind: detail.behind,
        });
      case "discovered_attack":
        // Die Linie öffnet der Gegenzug · ohne ihn stünde im Satz, der
        // gespielte Zug habe sie geöffnet, und das wäre falsch.
        if (!detail.from || !detail.square || !detail.reply) break;
        return t(pick(motif), {
          reply: san(detail.reply),
          piece: pieceName(t, detail.piece),
          from: detail.from,
          targetPiece: pieceName(t, detail.targetPiece),
          square: detail.square,
        });
      case "back_rank":
        if (!detail.square) break;
        return t(pick(motif), { square: detail.square });
    }
  }
  return null;
}

export function erklaereZug(
  row: Zugzeile,
  options: { t: TFunc; locale: Locale; seed?: string }
): string | null {
  const motiv = motivSatz(row, options);
  if (motiv) return motiv;

  // Kein Motiv · dann bleibt der Satz über den Preis. Er stimmt immer.
  if (!row.judgment) return null;
  const { t, locale } = options;
  const seed = options.seed ?? `${row.ply}`;
  const san = (value: string | undefined): string =>
    value ? translateSan(value, locale) : "";
  const detail = parseDetail(row.motif_detail);
  const pick = (name: string): Key =>
    `expl.${name}.${seedIndex(seed, VARIANTS) + 1}` as Key;
  const loss = row.loss_cp;
  if (detail.best && loss != null && loss > 0) {
    return t(pick("loss"), {
      san: san(row.san),
      loss: de(loss / 100, 1),
      best: san(detail.best),
    });
  }
  return t(pick("lossOnly"), { san: san(row.san) });
}

/**
 * Warum ein bemängelter Zug so teuer ist · `null`, wenn sich das nicht sagen
 * lässt.
 *
 * Der Satz aus `erklaereZug` nennt den Preis. Diese Zeile nennt, woher er
 * kommt, und sie tut es aus zwei Angaben, die ohnehin gespeichert sind: dem
 * Gegenzug, mit dem die Analyse den Zug widerlegt (`motif_detail.reply`, in
 * `motifs.rs` gesetzt), und den beiden Bewertungen davor und danach. Fehlt
 * beides, bleibt die Zeile fort — erfunden wird hier so wenig wie eine Zeile
 * höher.
 *
 * Die Widerlegung steht nur da, wo der Satz darüber sie nicht schon nennt. Zu
 * einer Gabel oder einer hängenden Figur sagt er den Gegenzug selbst; ihn
 * gleich darunter zu wiederholen, machte aus einer Begründung eine
 * Verdopplung. Bleibt es beim schlichten Satz über den Preis — dem Fall, für
 * den diese Zeile überhaupt gebaut ist —, steht die Widerlegung hier zum
 * ersten Mal.
 *
 * Nur zu bemängelten Zügen: „Widerlegt" ist ein Wort über einen Fehler, und
 * ein gutgeheißener Zug wird nicht widerlegt. Dieselbe Regel, nach der
 * `motifs.rs` seine Bestrafungsmotive erst ab einem Urteil vergibt.
 *
 * Gespeichert sind die Bewertungen aus Sicht von Weiß; gedreht werden sie hier
 * auf die Sicht des Ziehenden. Nur so geht die Rechnung des Satzes darüber
 * sichtbar auf: „kostet 5,3" und „fällt von +0,4 auf −4,9" sind dann dieselbe
 * Auskunft, einmal als Differenz und einmal als die beiden Zahlen. Aus
 * Weiß-Sicht stiege die Zahl, während Schwarz verliert, und der Leser müsste
 * die Umrechnung selbst machen.
 */
export function begruendeZug(
  row: Zugzeile,
  options: {
    t: TFunc;
    locale: Locale;
    /** Bewertung vor dem Zug in Zentibauern, aus Weiß-Sicht. */
    evalDavor?: number | null;
    /** Bewertung nach dem Zug, ebenso · bei einem Matt fehlt sie. */
    evalDanach?: number | null;
  }
): string | null {
  const { t, locale, evalDavor, evalDanach } = options;
  if (!row.judgment) return null;
  const detail = parseDetail(row.motif_detail);
  // Steht ein erkanntes Motiv dahinter, hat `erklaereZug` den Gegenzug schon
  // gesagt · dann bleibt hier nur die Rechnung.
  const reply =
    detail.reply && !isMotif(row.motif ?? "") ? translateSan(detail.reply, locale) : "";
  // Halbzüge zählen ab eins · ungerade zieht Weiß, und dann steht die
  // gespeicherte Zahl schon richtig herum.
  const dreh = row.ply % 2 === 1 ? 1 : -1;
  // Gleiche Zahlen auf beiden Seiten wären keine Auskunft · dann bleibt der
  // Teil über die Bewertung fort.
  const zahlen =
    evalDavor != null && evalDanach != null && evalDavor !== evalDanach
      ? { before: evalLabel(dreh * evalDavor), after: evalLabel(dreh * evalDanach) }
      : null;
  if (reply && zahlen) return t("expl.why.replyEval", { reply, ...zahlen });
  if (reply) return t("expl.why.reply", { reply });
  if (zahlen) return t("expl.why.eval", zahlen);
  return null;
}

/**
 * So viele Halbzüge einer Variante kommen in eine Anmerkung.
 *
 * Fünf sind zweieinhalb Züge und damit gerade so viel, dass die Absicht
 * sichtbar wird — „4…Lg4 5.Le2 Sd4" zeigt, worauf Schwarz aus ist. Die ganze
 * Linie stünde am Ende bei zwölf Halbzügen, und ab dem sechsten ist sie
 * Engine-Prosa: Wer so weit rechnet, liest keine Anmerkung mehr.
 */
const LINIE = 5;

/** Die Urteile, zu denen es überhaupt etwas zu bemängeln gibt. */
const BEMAENGELT = ["inaccuracy", "mistake", "blunder"];

export function istBemaengelt(judgment: string | undefined): boolean {
  return BEMAENGELT.includes(judgment ?? "");
}

/**
 * Die Bewertung in Worten · was die Zahl für die Stellung bedeutet.
 *
 * „−1,1" ist eine Auskunft für den, der die Skala im Kopf hat. Für alle
 * anderen ist es eine Zahl, und eine Anmerkung, die nur Zahlen nennt, erklärt
 * nichts. Die vier Bänder sind die üblichen Schwellen: eine halbe Bauerneinheit
 * ist Rauschen, anderthalb sind spürbar, dreieinhalb sind entschieden.
 *
 * Gelesen wird aus Weiß-Sicht, wie die gespeicherte Zahl selbst · die Seite
 * steht im Satz und nicht im Vorzeichen.
 */
function bewertungsband(
  cp: number,
  matt: number | null | undefined,
  t: TFunc
): string {
  const seite = (weiss: boolean) => t(weiss ? "common.white" : "common.black");
  if (matt != null) return t("expl.band.mate", { side: seite(matt > 0) });
  const betrag = Math.abs(cp);
  if (betrag < 50) return t("expl.band.equal");
  const side = seite(cp > 0);
  if (betrag < 150) return t("expl.band.slight", { side });
  if (betrag < 350) return t("expl.band.clear", { side });
  return t("expl.band.winning", { side });
}

/**
 * Die Anmerkung zu einem Zug · der ganze Kommentar, nicht nur sein Urteil.
 *
 * Bis zur Version 1.3 stand hier ein Satz: „Ungenauigkeit. Die Bewertung
 * springt von −0,1 auf −1,1. Besser war Se2." Er ist wahr und beantwortet die
 * Frage nicht, die man beim Nachspielen hat — *warum* ist er ungenau, und was
 * hätte der andere Zug besser gemacht? Beides steht längst in der Datenbank
 * und wurde nur nicht gesetzt:
 *
 * - `move_evals.pv` ist die Hauptvariante **vor** dem Zug. Sie beginnt beim
 *   besten Zug und zeigt damit, was er erreicht hätte.
 * - Dieselbe Spalte der **nächsten** Zeile ist die Hauptvariante nach dem
 *   gespielten Zug — also genau das, was der Gegner jetzt damit anfängt. Das
 *   ist die Herkunft der Zahl, über die sich der Leser wundert.
 *
 * Daraus werden bis zu fünf Sätze, jeder mit einer Bedingung, unter der er
 * wegbleibt:
 *
 * 1. **Das Urteil und der Preis.** Steht immer da.
 * 2. **Was die Zahlen bedeuten** · die beiden Bewertungsbänder. Liegen beide
 *    im selben Band, bleibt der Satz fort: „vorher klarer Vorteil, jetzt
 *    klarer Vorteil" ist keine Auskunft.
 * 3. **Was passiert ist** · der Motivsatz, wenn `motifs.rs` eines erkannt hat.
 *    Ohne Motiv bleibt er fort — der Rückfallsatz von `erklaereZug` sagte nur
 *    noch einmal, was der erste Satz schon gesagt hat.
 * 4. **Woher die Zahl kommt** · die Fortsetzung des Gegners.
 * 5. **Was besser war** · der Zug und seine Linie, mit der Bewertung, die er
 *    gehalten hätte.
 *
 * Zu einem gutgeheißenen Zug stehen nur 1, 3 und — wenn der Zug selbst der
 * Anfang der Hauptvariante ist — deren Fortsetzung. „Besser war" gibt es dort
 * nicht: Es gab nichts Besseres, und ein Band-Satz auch nicht — er gehört zu
 * einem Sprung, und einen gab es nicht.
 *
 * Alle Zahlen stehen aus Weiß-Sicht, wie schon der erste Satz. Der Reason-Satz
 * in `begruendeZug` dreht sie auf den Ziehenden, weil er neben „kostet 5,3"
 * steht und dieselbe Rechnung sichtbar machen soll; hier stünden zwei
 * Blickrichtungen in einem Absatz.
 */
export function kommentiereZug(
  row: Zugzeile,
  options: {
    t: TFunc;
    locale: Locale;
    seed?: string;
    /** Das Urteil der Auto-Annotation, schon als Wort der Oberfläche. */
    urteil: string;
    /** Ob dieses Urteil ein Mangel ist · Ungenauigkeit, Fehler, Patzer. */
    bemaengelt: boolean;
    /** Bewertung vor dem Zug in Zentibauern, aus Weiß-Sicht. */
    evalDavor: number;
    /** Bewertung nach dem Zug, ebenso · `null` bei einem Matt. */
    evalDanach: number | null;
    /** Steht nach dem Zug ein Matt, dann in wie vielen Zügen. */
    mattDanach?: number | null;
    /**
     * Der bessere Zug in englischem SAN, wo er nicht aus der Linie hervorgeht.
     *
     * Partien, die vor der Hauptvarianten-Spalte analysiert wurden, haben
     * `best_uci` und keine Linie. Für sie bleibt der kurze Satz von früher.
     */
    besser?: string;
    /** Die Hauptvariante vor dem Zug, englisches SAN. */
    linieDavor?: readonly string[];
    /** Die Hauptvariante nach dem Zug, englisches SAN. */
    linieDanach?: readonly string[];
  }
): string {
  const { t, locale, urteil, bemaengelt, evalDavor, evalDanach } = options;
  const saetze: string[] = [];

  if (bemaengelt) {
    saetze.push(
      t("an.comment", {
        judgment: urteil,
        from: evalLabel(evalDavor),
        to: options.mattDanach != null ? `#${options.mattDanach}` : evalLabel(evalDanach ?? 0),
      })
    );
  } else {
    saetze.push(t("an.qualityComment", { judgment: urteil }));
  }

  // Was die beiden Zahlen bedeuten. Stehen sie im selben Band, sagt der Satz
  // nichts — dann bleibt er fort.
  if (bemaengelt) {
    const before = bewertungsband(evalDavor, null, t);
    const after = bewertungsband(evalDanach ?? 0, options.mattDanach, t);
    if (before !== after) saetze.push(t("expl.swing", { before, after }));
  }

  const motiv = motivSatz(row, options);
  if (motiv) saetze.push(motiv);

  const davor = (options.linieDavor ?? []).slice(0, LINIE);
  const danach = (options.linieDanach ?? []).slice(0, LINIE);

  if (bemaengelt) {
    // Woher die Zahl kommt · zwei Halbzüge sind das Mindeste, sonst stünde da
    // ein einzelner Gegenzug und keine Fortsetzung.
    if (danach.length >= 2) {
      saetze.push(t("expl.replyLine", { line: notationLine(danach, locale, row.ply) }));
    }
    // Und was besser war. Die Linie beginnt beim besseren Zug selbst; ist sie
    // nur dieser eine Zug, bleibt der kurze Satz von früher.
    const besserSan = davor[0] ?? options.besser;
    if (davor.length >= 2 && davor[0] !== row.san) {
      saetze.push(
        t("expl.betterLine", {
          san: translateSan(davor[0], locale),
          line: notationLine(davor, locale, row.ply - 1),
          eval: evalLabel(evalDavor),
        })
      );
    } else if (besserSan && besserSan !== row.san) {
      saetze.push(t("an.commentBetter", { san: translateSan(besserSan, locale) }));
    }
  } else if (davor.length >= 2 && davor[0] === row.san) {
    // Der Zug *ist* die Hauptvariante · dann ist ihre Fortsetzung die Antwort
    // auf „und was ist daran gut?".
    saetze.push(t("expl.mainLine", { line: notationLine(davor, locale, row.ply - 1) }));
  }

  // `an.commentBetter` trägt seit jeher ein führendes Leerzeichen · es wurde
  // angehängt und nicht gefügt. Hier werden Sätze gefügt.
  return saetze.map((satz) => satz.trim()).join(" ");
}

// ── Das Fazit der Partie ─────────────────────────────────────────────────────

/**
 * Die Bausteine, die das Fazit kennen darf.
 *
 * Eine Liste und keine Regel: Was Rust ablegt, ist eine Zeichenkette aus der
 * Datenbank, und die soll nicht ungeprüft zu einem Schlüssel werden. Steht ein
 * Baustein nicht hier, fällt er weg — lieber ein Satz weniger als „verdict.x"
 * mitten im Absatz.
 */
const VERDICT_KEYS = [
  "verdict.grade.excellent",
  "verdict.grade.solid",
  "verdict.grade.mixed",
  "verdict.grade.shaky",
  "verdict.grade.rough",
  "verdict.versus.better",
  "verdict.versus.worse",
  "verdict.errors.none",
  "verdict.errors.count",
  "verdict.phase.opening",
  "verdict.phase.middlegame",
  "verdict.phase.endgame",
  "verdict.turningPoint",
  "verdict.recurring",
  "verdict.result.wellPlayedLoss",
  "verdict.result.luckyWin",
] as const;

interface Baustein {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Das gespeicherte Fazit als fertige Sätze.
 *
 * Zahlen kommen als Zahlen aus der Datenbank und werden hier erst zur
 * Schreibweise der Sprache — „84.2" ist auf einem deutschen Blatt falsch.
 */
export function erklaereFazit(
  verdict: string | undefined,
  options: { t: TFunc; locale: Locale }
): string[] {
  if (!verdict) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(verdict);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const { t, locale } = options;
  const out: string[] = [];
  for (const entry of parsed as Baustein[]) {
    if (!entry || typeof entry.key !== "string") continue;
    if (!(VERDICT_KEYS as readonly string[]).includes(entry.key)) continue;
    const params: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(entry.params ?? {})) {
      if (name === "acc" || name === "opp") {
        params[name] = de(Number(value), 1);
      } else if (name === "san") {
        params[name] = translateSan(String(value), locale);
      } else if (name === "motif") {
        params[name] = isMotif(String(value))
          ? t(`expl.motif.${value}` as Key)
          : String(value);
      } else {
        params[name] = value as string | number;
      }
    }
    out.push(t(entry.key as Key, params));
  }
  return out;
}
