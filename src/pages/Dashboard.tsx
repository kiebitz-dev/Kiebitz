import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpen, ChevronRight, Cpu, Puzzle } from "lucide-react";
import {
  featuredGame,
  type AnalyzedMove,
  games as demoGames,
  profile,
  ratings,
  ratingHistory,
  repertoireStats,
  puzzleStats,
} from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { LOCALE_TAGS, useI18n } from "../lib/i18n";
import { getGame, listGameSummaries, type GameRecord, type GameSummary } from "../lib/db";
import { gameAnalysis, type MoveEvalRow } from "../lib/analysis";
import { begruendeZug, erklaereFazit, erklaereZug } from "../lib/erklaerung";
import { useDiagramMode } from "../lib/diagramMode";
import { getSettings } from "../lib/settings";
import { repStats, type RepStats } from "../lib/repertoire";
import { puzzleStats as fetchPuzzleStats, type PuzzleStats } from "../lib/puzzles";
import { buildDashboard, type HistoryPoint, type RatingHistorySeries } from "../lib/stats";
import type { GamesFilter, UiGame } from "../lib/gameUi";
import { Card, ExtLink, GameCard, ResultBadge, SourceBadge, Spark, Button } from "../components/ui";
import { useMobileShell } from "../components/MobileShell";
import { chart, RATING_CHART_HEIGHT } from "../components/chartTheme";
import { dateLocale, de, deInt } from "../lib/format";
import type { PageId } from "../App";
import type { Tagesquelle } from "./blatt/DashboardBlatt";

/**
 * Recharts kommt nach, nicht mit: Das Diagramm ist die einzige Stelle des
 * Starts, die es braucht, und der Rest der Seite steht ohne es sofort.
 */
const RatingHistoryChart = lazy(() => import("../components/RatingHistoryChart"));

/**
 * Das Blatt kommt nach, nicht mit.
 *
 * Es ist die zweite Darstellung derselben Seite und nur für die zu sehen, die
 * den Diagramm-Modus eingeschaltet haben · mitsamt der Serifenschrift, die es
 * mitbringt. Wer den Modus nicht benutzt, lädt davon nichts.
 */
import { LeereSeite } from "../components/blatt/LeereSeite";
const DashboardBlatt = lazy(() => import("./blatt/DashboardBlatt"));

/**
 * Was die übrigen Quellen anzubieten haben · schon aufbereitet.
 *
 * Nur Züge, Felder und Texte: Nachgespielt wird in der nachgeladenen Fassung,
 * damit chess.js und der Endspiel-Katalog nicht am Startbündel hängen.
 */
interface Nachrueck {
  rep: { sans: string[]; linie: string; seite: "white" | "black" } | null;
  puzzle: { fen: string; setup: string[]; rating: number } | null;
  endgame: { fen: string; seite: "white" | "black"; ziel: "win" | "draw"; name: string } | null;
}
import { isStoreCapture } from "../lib/storeCapture";

/**
 * Legende des Ratingverlaufs · bewusst außerhalb des Charts.
 *
 * Die eingebaute Recharts-Legende sitzt in der Zeichenfläche und bekommt eine
 * feste Höhe. Auf Telefonbreite passen die vier Modusnamen dort nicht in eine
 * Zeile; sie brechen um, laufen aus ihrer Höhe heraus und schieben sich über
 * die oberste Gitterlinie. Als normaler Textfluss unter dem Diagramm darf sie
 * dagegen umbrechen, so viele Zeilen belegen wie nötig, und die Zeichenfläche
 * bleibt unangetastet.
 */
function HistoryLegend({
  series,
  colors,
}: {
  series: RatingHistorySeries[];
  colors: Record<string, string>;
}) {
  if (series.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 text-[11.5px] text-ink2">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: colors[s.id] ?? chart.draw }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Urteil der Analyse als Marke, wie sie im Buch neben dem Zug steht. */
function nagOf(judgment: string): string | undefined {
  return judgment === "blunder"
    ? "??"
    : judgment === "mistake"
      ? "?"
      : judgment === "inaccuracy"
        ? "?!"
        : undefined;
}

/**
 * Das Datum im Formularkopf des Blatts · Tag und Monat zweistellig.
 *
 * Ein Formularfeld ist eine Tabelle, keine Prosa: „11.07.2026" steht in jeder
 * Zeile gleich breit, „11.7.2026" hätte je nach Monat eine andere Länge.
 * Ausgeschrieben steht dasselbe Datum in der Bildunterschrift darunter.
 */
const KURZDATUM: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

/**
 * Ein Zug der Demo-Partie als Zeile der Auto-Analyse.
 *
 * Die Vorschau hat keine Datenbank; die Motive liegen im Datensatz. Beides
 * geht durch dieselbe Satzmaschine wie in der App, damit die Vorschau zeigt,
 * was die App zeigen würde, und nicht etwas Ähnliches.
 */
function demoZeile(move: AnalyzedMove, index: number) {
  return {
    ply: index + 1,
    san: move.san,
    judgment: move.nag === "??" ? "blunder" : "inaccuracy",
    motif: move.motif,
    motif_detail: move.motifDetail,
    loss_cp: move.lossCp,
  };
}

/**
 * Wann die Demo-Partie der Web-Vorschau gespielt wurde · `demoGames[0].date`
 * steht dort als fertiger deutscher Text, das Blatt braucht ein Datum, das es
 * in der Sprache der Oberfläche ausschreiben kann.
 */
const DEMO_GESPIELT = new Date(2026, 6, 11);

export default function Dashboard({
  go,
  openAnalysis,
  openGames,
}: {
  go: (p: PageId) => void;
  openAnalysis: (gameId: number) => void;
  openGames: (filter?: GamesFilter) => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const mobile = useMobileShell();
  const [records, setRecords] = useState<GameSummary[] | null>(null);
  const [rep, setRep] = useState<RepStats | null>(null);
  const [pz, setPz] = useState<PuzzleStats | null>(null);
  // Desktop startet ohne Demo-Konto; die echten Werte kommen aus den Settings.
  const [users, setUsers] = useState(
    backend.mode === "desktop"
      ? { cc: "", li: "", name: "" }
      : { cc: profile.ccUser, li: profile.liUser, name: "" }
  );
  const [goal, setGoal] = useState(puzzleStats.todayGoal);
  const diagramMode = useDiagramMode();
  // Die Partie hinter dem Diagramm des Tages · nur der Modus braucht sie, und
  // nur er holt sie. Die Züge stehen nicht in der Übersicht, die Urteile der
  // Auto-Analyse ohnehin nicht.
  const [blattGame, setBlattGame] = useState<{ record: GameRecord; rows: MoveEvalRow[] } | null>(
    null
  );
  // Womit die übrigen Quellen aufwarten können, wenn keine Partie da ist ·
  // in der Reihenfolge Partie → Repertoire → Puzzle → Endspiel (lib/blatt.ts).
  // Sie sind schon aufbereitet: Was hier steht, sind Züge, Felder und Texte —
  // gerechnet wird erst in der nachgeladenen Fassung, damit chess.js und der
  // Endspiel-Katalog nicht am Startbündel hängen.
  const [nachrueck, setNachrueck] = useState<Nachrueck | null>(null);

  useEffect(() => {
    if (backend.mode === "desktop") {
      listGameSummaries().then(setRecords).catch(() => setRecords(null));
      repStats().then(setRep).catch(() => {});
      fetchPuzzleStats().then(setPz).catch(() => {});
      getSettings()
        .then((s) => {
          setUsers({ cc: s.cc_user, li: s.li_user, name: s.display_name });
          setGoal(s.puzzle_goal);
        })
        .catch(() => {});
    }
  }, [backend.mode]);

  const live = records !== null && records.length > 0;

  const dash = useMemo(
    () =>
      live ? buildDashboard(records!, { locale, ccUser: users.cc, liUser: users.li }) : null,
    [live, records, locale, users]
  );

  const cards = dash
    ? dash.cards
    : ratings.map((r) => ({ id: r.id, platform: r.platform, tc: r.tc, timeClass: r.timeClass, value: r.value, delta: r.delta, spark: r.spark, url: r.url }));

  const recent: UiGame[] = dash ? dash.recent : demoGames.slice(0, 5);
  const unanalyzed = dash ? dash.unanalyzed : demoGames.filter((g) => !g.analyzed).length;
  const history: HistoryPoint[] = dash ? dash.history : ratingHistory.map((point, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (ratingHistory.length - 1 - index));
    const monthLabel = date.toLocaleDateString(LOCALE_TAGS[locale], { month: "short" });
    return {
      ...point,
      month: monthLabel,
      monthLabel,
      dayLabel: monthLabel,
    };
  });
  const allSeries: RatingHistorySeries[] = dash?.historySeries ?? [
    { key: "cc", id: "cc", platform: "chess.com" as const, timeClass: "rapid", label: "chess.com" },
    { key: "li", id: "li", platform: "lichess" as const, timeClass: "rapid", label: "lichess" },
  ];
  // Ein Modus, der im gezeigten Halbjahr keinen einzigen Stützpunkt hat, zieht
  // keine Linie · dann gehört er auch nicht in die Legende. Vorher standen dort
  // Namen ohne sichtbare Entsprechung im Diagramm.
  const historySeries = allSeries.filter((s) => history.some((point) => point[s.key] != null));
  // ── Das Diagramm des Tages ────────────────────────────────────────────────
  //
  // Ein Buch druckt nicht die Schlussstellung, sondern die Stelle, an der die
  // Partie entschieden wurde. Welche das ist, hat die Auto-Analyse schon
  // beurteilt · `criticalPly` liest es aus ihren Urteilen (lib/blatt.ts).
  const featuredId = recent[0]?.dbId ?? null;

  useEffect(() => {
    if (!diagramMode || backend.mode !== "desktop" || featuredId == null) {
      setBlattGame(null);
      return;
    }
    let alive = true;
    void Promise.all([getGame(featuredId), gameAnalysis(featuredId).catch(() => [])])
      .then(([record, rows]) => {
        if (alive) setBlattGame({ record, rows });
      })
      .catch(() => {
        if (alive) setBlattGame(null);
      });
    return () => {
      alive = false;
    };
  }, [diagramMode, backend.mode, featuredId]);

  // Ohne Partie in der Datenbank rückt die Stellung aus der nächsten Quelle
  // nach, die etwas anzubieten hat. Geholt wird das nur dann — solange eine
  // Partie da ist, gewinnt sie ohnehin — und die Module dazu kommen mit, statt
  // im Startbündel zu liegen.
  useEffect(() => {
    if (!diagramMode || backend.mode !== "desktop" || featuredId != null) {
      setNachrueck(null);
      return;
    }
    let alive = true;
    void (async () => {
      const [repertoire, puzzles, endgame, drills] = await Promise.all([
        import("../lib/repertoire"),
        import("../lib/puzzles"),
        import("../lib/endgame"),
        import("../data/endgames"),
      ]);
      const [due, puzzle, stats] = await Promise.all([
        repertoire.repDue(1, 1).catch(() => []),
        puzzles.nextPuzzle({}).catch(() => null),
        endgame.endgameStats().catch(() => []),
      ]);
      if (!alive) return;
      // Die erste Aufgabe, die noch nicht gelöst wurde · aus der eigenen
      // Statistik, nicht geraten.
      const gemeistert = new Set(stats.filter((row) => row.solved > 0).map((row) => row.drill_id));
      const offen = drills.ENDGAME_DRILLS.find((drill) => !gemeistert.has(drill.id));
      setNachrueck({
        rep: due[0]
          ? { sans: due[0].prompt_sans, linie: due[0].line, seite: due[0].side }
          : null,
        puzzle: puzzle
          ? {
              fen: puzzle.fen,
              setup: puzzle.moves.slice(0, puzzle.setup_plies),
              rating: puzzle.rating,
            }
          : null,
        endgame: offen
          ? {
              fen: offen.fen,
              seite: offen.side,
              ziel: offen.goal,
              name: drills.drillText(offen.name, locale),
            }
          : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [diagramMode, backend.mode, featuredId, locale]);

  const historyColors: Record<string, string> = {
    "chess.com-rapid": chart.cc,
    "chess.com-blitz": chart.gold,
    "chess.com-bullet": chart.mistake,
    "chess.com-daily": chart.violet,
    "lichess-rapid": chart.li,
    "lichess-blitz": chart.accent,
    "lichess-bullet": chart.loss,
    "lichess-daily": "#b09bea",
    cc: chart.cc,
    li: chart.li,
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? t("dash.goodMorning") : h < 18 ? t("dash.goodDay") : t("dash.goodEvening");
  })();
  const name = storeCapture
    ? "Alex"
    : backend.mode === "desktop" ? users.name || users.cc || users.li : profile.name;

  /**
   * Woraus das Diagramm des Tages entsteht.
   *
   * Hier stehen nur Züge, Felder und Texte · nachgespielt und gesetzt wird in
   * der nachgeladenen Fassung. So bleiben chess.js, die Notation und der
   * Endspiel-Katalog dort, wo sie gebraucht werden, und nicht im Startbündel.
   */
  const quelle: Tagesquelle | null = (() => {
    if (!diagramMode) return null;
    if (blattGame) {
      const { record, rows } = blattGame;
      const sans = record.moves ? record.moves.split(" ").filter(Boolean) : [];
      if (sans.length === 0) return null;
      // Die Sätze zur Analyse · zu jedem Halbzug einer oder keiner. Der Same
      // hängt an Partie und Halbzug: Derselbe Zug liest sich in jeder Sitzung
      // gleich, zwei Züge nebeneinander lesen sich verschieden.
      const analysen = sans.map((_, index) => {
        const row = rows[index];
        return row
          ? (erklaereZug(row, { t, locale, seed: `${record.id}:${row.ply}` }) ?? undefined)
          : undefined;
      });
      // Und die Zeile darunter: woher der Preis kommt. Die Bewertung *vor*
      // dem Zug ist die Bewertung *nach* dem vorigen · beim ersten Halbzug
      // gibt es keine, und dann bleibt der Satz bei der Widerlegung.
      const gruende = sans.map((_, index) => {
        const row = rows[index];
        if (!row) return undefined;
        return (
          begruendeZug(row, {
            t,
            locale,
            evalDavor: index > 0 ? rows[index - 1]?.eval_cp : undefined,
            evalDanach: row.eval_cp,
          }) ?? undefined
        );
      });
      const me = record.my_name || users.name || users.cc || users.li || t("blatt.you");
      const white = record.color === "white" ? me : record.opponent;
      const black = record.color === "white" ? record.opponent : me;
      return {
        art: "game",
        sans,
        nags: sans.map((_, index) => nagOf(rows[index]?.judgment ?? "")),
        analysen,
        gruende,
        fazit: erklaereFazit(record.verdict, { t, locale }),
        weiss: white,
        weissElo: String(record.color === "white" ? record.my_elo : record.opp_elo),
        schwarz: black,
        schwarzElo: String(record.color === "white" ? record.opp_elo : record.my_elo),
        plattform: record.source ?? "",
        zeitform: record.time_class ?? "",
        datum: new Date(record.played_ts * 1000).toLocaleDateString(dateLocale(), KURZDATUM),
        datumLang: new Date(record.played_ts * 1000).toLocaleDateString(dateLocale(), {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        eco: record.eco,
        eroeffnung: record.opening,
        ergebnis:
          record.result === "draw"
            ? "½ : ½"
            : (record.result === "win") === (record.color === "white")
              ? "1 : 0"
              : "0 : 1",
        farbe: record.color,
        notiz: record.note?.trim() || undefined,
        onOeffnen: record.id != null ? () => openAnalysis(record.id!) : undefined,
      };
    }
    // Web-Vorschau: die Demo-Partie bringt ihre Marken selbst mit.
    if (!live) {
      return {
        art: "game",
        sans: featuredGame.moves.map((move) => move.san),
        nags: featuredGame.moves.map((move) => move.nag),
        kommentare: featuredGame.moves.map((move) => move.comment),
        // Auch in der Vorschau entstehen die Sätze in der Satzmaschine und
        // nicht im Datensatz · so zeigt sie, was die App zeigen würde.
        analysen: featuredGame.moves.map((move, index) =>
          move.motif
            ? (erklaereZug(demoZeile(move, index), {
                t,
                locale,
                seed: `demo:${index + 1}`,
              }) ?? undefined)
            : undefined
        ),
        gruende: featuredGame.moves.map((move, index) =>
          move.motif
            ? (begruendeZug(demoZeile(move, index), {
                t,
                locale,
                evalDavor: index > 0 ? featuredGame.moves[index - 1].eval : undefined,
                evalDanach: move.eval,
              }) ?? undefined)
            : undefined
        ),
        fazit: erklaereFazit(featuredGame.verdict, { t, locale }),
        weiss: profile.name,
        weissElo: "1462",
        schwarz: "DragonSlayer_88",
        schwarzElo: "1448",
        plattform: demoGames[0]?.source ?? "",
        zeitform: demoGames[0]?.tc ?? "",
        datum: DEMO_GESPIELT.toLocaleDateString(dateLocale(), KURZDATUM),
        datumLang: DEMO_GESPIELT.toLocaleDateString(dateLocale(), {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        eco: demoGames[0]?.eco ?? "",
        eroeffnung: demoGames[0]?.opening ?? "",
        ergebnis: "1 : 0",
        farbe: "white",
        notiz: demoGames[0]?.note,
      };
    }
    if (!nachrueck) return null;
    const eigener = users.name || users.cc || users.li || t("blatt.you");
    if (nachrueck.rep) return { art: "repertoire", ...nachrueck.rep, eigener };
    if (nachrueck.puzzle) return { art: "puzzle", ...nachrueck.puzzle, eigener };
    if (nachrueck.endgame) return { art: "endgame", ...nachrueck.endgame, eigener };
    return null;
  })();

  // Der Modus ist eine zweite Darstellung derselben Daten · alles, was oben
  // geladen und gerechnet wurde, gilt hier unverändert weiter.
  if (diagramMode) {
    return (
      <Suspense fallback={<LeereSeite />}>
        <DashboardBlatt
          mobile={mobile}
          bestand={live ? records!.length : null}
          quelle={quelle}
          angebot={
            // Nur wenn die Stellung *nicht* aus einer Partie kommt · dann
            // ersetzt die Herkunft die Anmerkung.
            quelle?.art === "game"
              ? undefined
              : {
                  repertoire: rep ? rep.due_now : repertoireStats.dueToday,
                  puzzles: Math.max(
                    0,
                    (pz ? goal : puzzleStats.todayGoal) -
                      (pz ? pz.today_attempts : puzzleStats.todaySolved)
                  ),
                  endgame: nachrueck?.endgame != null,
                }
          }
          wertungen={cards.map((r) => ({
            id: r.id,
            platform: r.platform,
            tc: r.tc,
            value: r.value,
            delta: r.delta,
          }))}
          letzte={recent}
          repDue={rep ? rep.due_now : repertoireStats.dueToday}
          repNeben={
            rep
              ? t("dash.repSummary", { n: rep.my_positions, p: de(rep.coverage_pct) })
              : t("dash.streak", { n: repertoireStats.streak })
          }
          unanalyzed={unanalyzed}
          puzzles={{
            done: pz ? pz.today_attempts : puzzleStats.todaySolved,
            goal: pz ? goal : puzzleStats.todayGoal,
          }}
          onRepertoire={() => go("repertoire")}
          onAnalyse={() => go("analysis")}
          onPuzzles={() => go("puzzles")}
          onAllePartien={() => openGames()}
          onPartie={(game) => (game.dbId != null ? openAnalysis(game.dbId) : openGames())}
          onFilter={openGames}
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{greeting}, {name}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {live ? t("dash.gamesInDb", { n: deInt(records!.length) }) : storeCapture ? "" : t("dash.demoData")}
          </p>
        </div>
        {!storeCapture && <div className="flex gap-2">
          <ExtLink href={`https://www.chess.com/member/${users.cc}`} label="chess.com" />
          <span className="text-line2">·</span>
          <ExtLink href={`https://lichess.org/@/${users.li}`} label="lichess" />
        </div>}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        {cards.map((r) => {
          // Die Karte beantwortet „welche Partien stecken hinter dieser Zahl?"
          // und führt in die Partienliste, gefiltert auf Plattform und
          // Bedenkzeit · dieselbe Leitung, die auch die Badges der letzten
          // Partien darunter benutzen.
          //
          // Ohne Bedenkzeitklasse gibt es nichts zu filtern (die Puzzle-Karte
          // der Demo-Daten): Sie bleibt eine Fläche und tut nichts, statt in
          // eine leere Liste zu führen.
          const target: GamesFilter | null = r.timeClass
            ? { source: r.platform, tc: r.timeClass }
            : null;
          const label = t("dash.showGamesFor", { p: r.platform, tc: r.tc });
          const body = (
            <>
              <div className="mb-2 flex items-center justify-between">
                <SourceBadge source={r.platform} />
                <span className="flex items-center gap-0.5 text-[11.5px] text-ink3">
                  {r.tc}
                  {/* Ohne Zeigegerät gibt es kein Hover · auf dem Telefon muss
                      der Hinweis deshalb stehen bleiben, sonst sieht die Karte
                      aus wie die Anzeige, die sie bisher war. */}
                  {target && (
                    <ChevronRight
                      size={13}
                      className={
                        mobile
                          ? "-mr-1"
                          : "-mr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      }
                      aria-hidden
                    />
                  )}
                </span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[26px] font-semibold leading-none tracking-tight">{r.value}</div>
                  <div
                    className="mt-1.5 flex items-center gap-1 text-[12px]"
                    style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                  >
                    {r.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {r.delta >= 0 ? "+" : ""}
                    {r.delta} · {t("dash.days30")}
                  </div>
                </div>
                <span className="hidden min-[440px]:block">
                  <Spark data={r.spark} color={r.platform === "chess.com" ? chart.cc : chart.li} />
                </span>
              </div>
            </>
          );

          if (!target) {
            return (
              <div key={r.id} className="rounded-xl border border-line bg-panel p-4">
                {body}
              </div>
            );
          }

          return (
            <button
              key={r.id}
              type="button"
              onClick={() => openGames(target)}
              title={label}
              aria-label={label}
              className="group w-full touch-manipulation rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line2 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim active:bg-panel2"
            >
              {body}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        <Card
          title={live ? t("dash.ratingHistoryLive") : t("dash.ratingHistoryDemo")}
          className="min-[1100px]:col-span-2"
        >
          <Suspense
            fallback={<div style={{ height: RATING_CHART_HEIGHT }} aria-hidden />}
          >
            <RatingHistoryChart
              history={history}
              series={historySeries}
              colors={historyColors}
              live={live}
            />
          </Suspense>
          <HistoryLegend series={historySeries} colors={historyColors} />
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <BookOpen size={15} className="text-accent" /> {t("dash.repTraining")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {rep ? rep.due_now : repertoireStats.dueToday}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.dueReviews")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">
                  {rep
                    ? t("dash.repSummary", { n: rep.my_positions, p: de(rep.coverage_pct) })
                    : t("dash.streak", { n: repertoireStats.streak })}
                </div>
              </div>
              <Button primary onClick={() => go("repertoire")}>{t("dash.train")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Cpu size={15} className="text-violet" /> {t("dash.analysisQueue")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {deInt(unanalyzed)}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.gamesWithoutAnalysis")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">{t("dash.stockfishNative")}</div>
              </div>
              <Button onClick={() => go("analysis")}>{t("dash.start")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Puzzle size={15} className="text-gold" /> {t("dash.puzzleGoal")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {pz ? pz.today_attempts : puzzleStats.todaySolved}
                  <span className="text-[15px] font-normal text-ink3"> / {pz ? goal : puzzleStats.todayGoal}</span>
                </div>
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-panel3">
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{
                      width: `${Math.min(100, ((pz ? pz.today_attempts : puzzleStats.todaySolved) / (pz ? goal : puzzleStats.todayGoal)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <Button onClick={() => go("puzzles")}>{t("dash.solve")}</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card title={t("dash.recentGames")} className="mt-4" pad={false}
        action={<button onClick={() => openGames()} className="text-[12.5px] text-ink3 hover:text-accent">{t("dash.showAll")}</button>}
      >
        {mobile ? (
          // Auf Handybreite wird aus jeder Zeile eine Karte · die achtspaltige
          // Tabelle liesse sich sonst nur quer scrollend lesen.
          <div>
            {recent.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onClick={g.dbId != null ? () => openAnalysis(g.dbId!) : undefined}
              />
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <tbody>
            {recent.map((g) => {
              const filterTo = (e: MouseEvent, f: GamesFilter) => {
                e.stopPropagation();
                openGames(f);
              };
              const openable = g.dbId != null;
              return (
                <tr
                  key={g.id}
                  onClick={() => openable && openAnalysis(g.dbId!)}
                  title={openable ? t("dash.openInAnalysis") : undefined}
                  className={`border-b border-line last:border-0 hover:bg-panel2 ${
                    openable ? "cursor-pointer" : ""
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <button
                      onClick={(e) => filterTo(e, { date: g.dateKey })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.date}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { source: g.source })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <SourceBadge source={g.source} />
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { tc: g.timeClass })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.tc}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opponent: g.opponent })}
                      className="text-ink transition-colors hover:text-accent"
                    >
                      {g.opponent}
                    </button>
                    <span className="ml-1.5 text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opening: g.opening })}
                      className="text-left text-ink2 transition-colors hover:text-accent"
                    >
                      {g.opening}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { result: g.result })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <ResultBadge result={g.result} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <ExtLink
                      href={
                        g.url ??
                        (g.source === "chess.com"
                          ? `https://www.chess.com/games/archive/${users.cc}`
                          : `https://lichess.org/@/${users.li}/all`)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </Card>
    </div>
  );
}
