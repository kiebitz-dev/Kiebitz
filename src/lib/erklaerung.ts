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
import { translateSan } from "./notation";
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
export function erklaereZug(
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

  // Kein Motiv · dann bleibt der Satz über den Preis. Er stimmt immer.
  if (!row.judgment) return null;
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
