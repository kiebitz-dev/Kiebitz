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
import type { Fortsetzung, Materialstand } from "./folge";
import type { Key, Locale, TFunc } from "./i18n";
import { notationLine, translateSan } from "./notation";
import { de } from "./format";

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
  options: {
    t: TFunc;
    locale: Locale;
    seed?: string;
    /**
     * Die nachgespielte Fortsetzung · wo sie vorliegt, sagt sie in Figuren,
     * was der Zug kostet, und geht dem Satz über Bewertungspunkte vor.
     * Gerechnet wird sie dort, wo die Stellung steht · siehe lib/folge.ts.
     */
    folge?: Fortsetzung | null;
  }
): string | null {
  const motiv = motivSatz(row, options);
  if (motiv) return motiv;

  if (!row.judgment) return null;
  const { t, locale } = options;

  // Kein Motiv · dann sagt die Fortsetzung, was sie einbringt. „Sxe5 kostet
  // 3,0 Bewertungspunkte" ist wahr und in einer Einheit, die außerhalb einer
  // Engine niemand benutzt; „Lxe5 schlägt einen Springer" ist dasselbe in der
  // Währung, in der man Schach spielt.
  const kosten = folgeSatz(t, locale, options.folge, undefined);
  if (kosten) return kosten;

  // Und wo auch die fehlt, bleibt der Satz über den Preis. Er stimmt immer.
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
 * Womit der Zug widerlegt wird · `null`, wenn sich das nicht sagen lässt.
 *
 * Eine Zeile aus einer Angabe, die ohnehin gespeichert ist: dem Gegenzug, mit
 * dem die Analyse den Zug widerlegt (`motif_detail.reply`, in `motifs.rs`
 * gesetzt). Fehlt er, bleibt die Zeile fort — erfunden wird hier so wenig wie
 * eine Zeile höher.
 *
 * Bewertungen standen hier bis 1.3 daneben („die Bewertung fällt von +0,4 auf
 * −4,9"). Sie sind fort: Zwei Zahlen auf einer Skala, die der Leser nicht im
 * Kopf hat, sind keine Begründung, sondern eine zweite Frage. Was der Zug
 * wirklich kostet, steht jetzt in der Anmerkung selbst und in Figuren statt in
 * Punkten · siehe `kommentiereZug` und lib/folge.ts.
 *
 * Die Widerlegung steht nur da, wo der Satz darüber sie nicht schon nennt. Zu
 * einer Gabel oder einer hängenden Figur sagt er den Gegenzug selbst; ihn
 * gleich darunter zu wiederholen, machte aus einer Begründung eine
 * Verdopplung.
 *
 * Nur zu bemängelten Zügen: „Widerlegt" ist ein Wort über einen Fehler, und
 * ein gutgeheißener Zug wird nicht widerlegt. Dieselbe Regel, nach der
 * `motifs.rs` seine Bestrafungsmotive erst ab einem Urteil vergibt.
 */
export function begruendeZug(
  row: Zugzeile,
  options: { t: TFunc; locale: Locale }
): string | null {
  const { t, locale } = options;
  if (!row.judgment) return null;
  const detail = parseDetail(row.motif_detail);
  if (!detail.reply || isMotif(row.motif ?? "")) return null;
  return t("expl.why.reply", { reply: translateSan(detail.reply, locale) });
}

/**
 * Material in Worten · „einen Läufer", „zwei Bauern", sonst „Material".
 *
 * Genannt wird eine Figur nur, wenn sie eindeutig übrig bleibt. Ein ungleicher
 * Tausch (Turm gegen Läufer und Bauer) hat keinen Namen — dort steht das
 * allgemeine Wort, und der Satz bleibt trotzdem wahr.
 */
function materialWort(t: TFunc, stand: Materialstand): string | null {
  if (stand.wert <= 0) return null;
  const { figuren } = stand;
  if (figuren.length === 1) return t(`expl.mat.${figuren[0]}` as Key);
  if (figuren.length > 1 && figuren.every((figur) => figur === "P")) {
    return t("expl.mat.pawns", { n: figuren.length });
  }
  return t("expl.mat.some");
}

/**
 * Was die Fortsetzung kostet · der Satz, der die Bewertungszahlen ersetzt.
 *
 * Gezählt wird in lib/folge.ts, gesetzt hier. Zwei Fälle:
 *
 * - **Der Schlagzug steht noch nicht da.** Dann nennt der Satz ihn mitsamt der
 *   Figur, die er nimmt, und — falls die Linie darüber hinaus noch etwas
 *   einbringt — was danach noch fällt.
 * - **Der Motivsatz hat ihn schon genannt.** Zu einer hängenden Figur sagt er
 *   „Lxb5 schlägt auf b5"; ihn hier zu wiederholen, wäre derselbe Zug in zwei
 *   Sätzen. Dann bleibt nur, was über den ersten Schlag hinausgeht.
 */
function folgeSatz(
  t: TFunc,
  locale: Locale,
  folge: Fortsetzung | null | undefined,
  /** Der Gegenzug, den der Motivsatz bereits genannt hat (englisches SAN). */
  motivZug: string | undefined
): string | null {
  if (!folge) return null;
  const schonGenannt = Boolean(folge.schlag && folge.schlag === motivZug);
  if (folge.schlag && folge.geschlagen && !schonGenannt) {
    const reply = translateSan(folge.schlag, locale);
    const mat = t(`expl.mat.${folge.geschlagen}` as Key);
    const gain = materialWort(t, folge.danach);
    if (gain) {
      return t(folge.schach ? "expl.cost.captureCheckGain" : "expl.cost.captureGain", {
        reply,
        mat,
        gain,
      });
    }
    return t(folge.schach ? "expl.cost.captureCheck" : "expl.cost.capture", { reply, mat });
  }
  const rest = materialWort(t, schonGenannt ? folge.danach : folge.netto);
  return rest ? t("expl.cost.only", { mat: rest }) : null;
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
 * Die Anmerkung zu einem Zug · der ganze Kommentar, nicht nur sein Urteil.
 *
 * Bis 1.3 stand hier eine Rechnung:
 *
 *     Txd5?? Patzer. Die Bewertung springt von −1,7 auf +1,6. Vorher klarer
 *     Vorteil für Schwarz, jetzt klarer Vorteil für Weiß. Die Zahl kommt aus
 *     der Fortsetzung 14.Dxa4+ Dd7 15.cxd5 Le7. Besser war axb3: 13…axb3
 *     14.Txa5 Dxa5 15.Dxb3 hält die Bewertung bei −1,7.
 *
 * Jeder Satz darin ist wahr, und zusammen beantworten sie die Frage nicht, die
 * man beim Nachspielen hat. „Die Bewertung springt von −1,7 auf +1,6" setzt
 * eine Skala voraus, die außerhalb einer Engine niemand im Kopf hat; „vorher
 * klarer Vorteil, jetzt klarer Vorteil" ist dieselbe Auskunft noch einmal in
 * Worten. Was tatsächlich passiert ist — der Gegner nimmt einen Bauern mit
 * Schach und holt sich hinterher den Turm —, stand nirgends.
 *
 * Jetzt steht genau das da, und zwar in Figuren:
 *
 *     Txd5?? Patzer. Dxa4+ schlägt einen Bauern mit Schach und gewinnt danach
 *     einen Turm. Besser war axb3: 13…axb3 14.Txa5 Dxa5 15.Dxb3.
 *
 * Bis zu vier Sätze, jeder mit einer Bedingung, unter der er wegbleibt:
 *
 * 1. **Das Urteil.** Steht immer da — mehr als ein Wort ist es nicht mehr.
 * 2. **Was passiert ist** · der Motivsatz, wenn `motifs.rs` eines erkannt hat.
 * 3. **Was es kostet** · der Schlagzug des Gegners und das Material, das die
 *    Fortsetzung einbringt (`lib/folge.ts`). Ohne nachgespielte Linie und ohne
 *    einen einzigen Schlag darin bleibt er fort; dann steht ersatzweise die
 *    Fortsetzung selbst da, aber nur, wenn auch kein Motivsatz sie erzählt.
 * 4. **Was besser war** · der Zug und seine Linie. Ohne Bewertung am Ende:
 *    Sie war der Rest derselben Rechnung, die oben herausgeflogen ist.
 *
 * Zu einem gutgeheißenen Zug stehen nur 1, 2 und — wenn der Zug selbst der
 * Anfang der Hauptvariante ist — deren Fortsetzung. „Besser war" gibt es dort
 * nicht: Es gab nichts Besseres.
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
    /**
     * Die nachgespielte Fortsetzung · was der Gegner mit dem Zug anfängt.
     *
     * Gerechnet wird sie dort, wo die Stellung steht (die Analyseseite kennt
     * die Züge davor), nicht hier: Dieses Modul setzt Sprache und spielt kein
     * Schach nach. Siehe `fortsetzung` in lib/folge.ts.
     */
    folge?: Fortsetzung | null;
  }
): string {
  const { t, locale, urteil, bemaengelt } = options;
  const saetze: string[] = [];

  saetze.push(t("an.qualityComment", { judgment: urteil }));

  const motiv = motivSatz(row, options);
  if (motiv) saetze.push(motiv);

  // Der Gegenzug, den der Motivsatz schon genannt hat · er darf im
  // Kostensatz nicht ein zweites Mal auftauchen.
  const motivZug = motiv && isMotif(row.motif ?? "") ? parseDetail(row.motif_detail).reply : undefined;
  const kosten = bemaengelt ? folgeSatz(t, locale, options.folge, motivZug) : null;
  if (kosten) saetze.push(kosten);

  const davor = (options.linieDavor ?? []).slice(0, LINIE);
  const danach = (options.linieDanach ?? []).slice(0, LINIE);

  if (bemaengelt) {
    // Die Fortsetzung im Wortlaut nur dort, wo weder Motiv noch Kostensatz
    // schon erzählt haben, was in ihr passiert · sonst stünde dieselbe Linie
    // zweimal, einmal als Satz und einmal als Notation.
    if (!motiv && !kosten && danach.length >= 2) {
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
