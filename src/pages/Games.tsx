import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  FileDown,
  FileUp,
  History,
  Loader2,
  FolderOpen,
  Save,
  Search,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { games as demoGames, profile, type Result, type Source } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { deleteGame, getGame, listGamesForExport, listGamesPage, readPgnFile, setGameNote, setGameTags, upsertGames, writePgnFile, type GameRecord } from "../lib/db";
import { fetchAll } from "../lib/importer";
import { indexPositions } from "../lib/analysis";
import { getSettings } from "../lib/settings";
import { gamePlayedTs, tcLabel, toUi, type GamesFilter, type UiGame } from "../lib/gameUi";
import Board from "../components/Board";
import { BOARD_MAX, BOARD_WIDTH } from "../lib/boardLayout";
import { Button, Card, Chip, ExtLink, GameCard, ResultBadge, SourceBadge, Tag } from "../components/ui";
import FocusBoard, { FocusButton } from "../components/FocusBoard";
import { useMobileShell } from "../components/MobileShell";
import MobileSheet from "../components/MobileSheet";
import TagEditor from "../components/TagEditor";
import { de, deInt } from "../lib/format";
import { useDiagramMode } from "../lib/diagramMode";
import { naechsterZeitraum, zeitraumStart, type Zeitraum } from "../lib/blatt";
import { plattformFarbe } from "../components/blatt/Satz";
import { endLabel } from "../components/BoardEndView";
import { isTermination } from "../lib/boardEnd";
import { notationLine } from "../lib/notation";
import { openExternal } from "../lib/ext";

/** Das Verzeichnis kommt nach · siehe Dashboard.tsx. */
import { LeereSeite } from "../components/blatt/LeereSeite";
const GamesBlatt = lazy(() => import("./blatt/GamesBlatt"));
import { replaySans } from "../lib/position";
import { exportPgn, importPgn, PgnPlayerMismatchError } from "../lib/pgn";

const PAGE_SIZE_KEY = "kiebitz.games.pageSize";
/**
 * Wie viele Partien auf eine Seite gehen · frei zwischen diesen Grenzen.
 *
 * Vier feste Stufen standen hier früher als Pillenreihe. Sie kosteten eine
 * eigene Zeile, um eine Frage zu beantworten, die man einmal beantwortet und
 * dann nie wieder — und wer fünfzehn wollte, bekam fünfzig. Jetzt steht der
 * geltende Wert im Satz neben der Spanne („1–10 von 1.523 · 10 je Seite") und
 * ist zugleich der Griff, der ihn ändert.
 *
 * Unten zehn, damit die Seite auf dem Telefon eine Seite bleibt; oben hundert,
 * weil darüber jede Seite die Datenbank spürbar länger befragt.
 */
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
type ImportTone = "info" | "success" | "warning" | "error";

/** Ein gesetzter Filter, wie ihn die Pillenzeile zeigt und wieder entfernt. */
interface ActiveFilter {
  key: string;
  label: string;
  clear: () => void;
}

/** Auf den gültigen Bereich holen · alles andere wäre keine Seite. */
function clampPageSize(n: number): number {
  return Math.min(Math.max(Math.round(n), MIN_PAGE_SIZE), MAX_PAGE_SIZE);
}

/** Gemerkte Seitengröße lesen; beim ersten Öffnen auf 10 (ungültig/leer). */
function readStoredPageSize(): number {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (Number.isFinite(n) && n > 0) return clampPageSize(n);
  } catch {
    /* Storage nicht verfügbar */
  }
  return MIN_PAGE_SIZE;
}

export default function Games({
  openAnalysis,
  initialFilter,
}: {
  openAnalysis: (gameId: number) => void;
  initialFilter?: GamesFilter | null;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const diagramMode = useDiagramMode();
  const [dbGames, setDbGames] = useState<UiGame[] | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<GameRecord | null>(null);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importTone, setImportTone] = useState<ImportTone>("info");
  // Der laufende Import · über ihn wird er auch wieder abgebrochen.
  const importAbort = useRef<AbortController | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [pgnPath, setPgnPath] = useState("");
  const [pgnExportPath, setPgnExportPath] = useState("");
  const [pgnPlayer, setPgnPlayer] = useState("");
  const [pgnBusy, setPgnBusy] = useState(false);
  const [pgnExcludeFromAnalysis, setPgnExcludeFromAnalysis] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Mobil stehen Details und Notizen nicht unter der Liste, sondern kommen auf
  // Tipp als Blatt in den Vordergrund.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Beim Blättern über eine Seitengrenze: welche Partie der neuen Seite gilt.
  const [edgeSelect, setEdgeSelect] = useState<"first" | "last" | null>(null);
  // Mobil stehen Quelle und Ergebnis nicht als zwei Chip-Reihen über der
  // Liste, sondern hinter einer Schaltfläche · siehe Filterblatt unten.
  const [filterOpen, setFilterOpen] = useState(false);

  const [source, setSource] = useState<Source | "alle">(initialFilter?.source ?? "alle");
  const [result, setResult] = useState<Result | "alle">(initialFilter?.result ?? "alle");
  const [query, setQuery] = useState("");
  // Exakt-Filter (aus dem Dashboard vorbelegt, per Pill wieder entfernbar).
  const [tc, setTc] = useState(initialFilter?.tc ?? "");
  const [dateKey, setDateKey] = useState(initialFilter?.date ?? "");
  const [opponent, setOpponent] = useState(initialFilter?.opponent ?? "");
  const [opening, setOpening] = useState(initialFilter?.opening ?? "");
  // Farbe und ECO kommen aus einem Klick in der Partienzeile · das Kästchen
  // vor dem Namen und die Kennung hinter der Eröffnung sind dort Griffe.
  const [color, setColor] = useState<"" | "white" | "black">(initialFilter?.color ?? "");
  const [eco, setEco] = useState(initialFilter?.eco ?? "");
  // Der Zeitraum ist ein Filter des Diagramm-Modus: Dort steht er als
  // Formularfeld neben Quelle und Ergebnis · in der gewöhnlichen Fassung
  // führen die Pillen dieselbe Einschränkung über das genaue Datum.
  const [zeitraum, setZeitraum] = useState<Zeitraum>("alle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Vorschau allein · siehe components/FocusBoard.tsx. */
  const [focused, setFocused] = useState(false);
  const [pageSize, setPageSize] = useState(readStoredPageSize);
  const [page, setPage] = useState(1);
  // Inline-Eingabe zum direkten Springen auf eine bestimmte Seite.
  const [pageInput, setPageInput] = useState<string | null>(null);
  // Dieselbe Bewegung für die Seitengröße: Der geltende Wert steht im Satz,
  // ein Klick macht ihn zum Eingabefeld.
  const [sizeInput, setSizeInput] = useState<string | null>(null);
  const reloadSequence = useRef(0);

  // Gewählte Seitengröße merken (nur UI-Präferenz → localStorage).
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(pageSize));
    } catch {
      /* Storage nicht verfügbar · gilt nur für die Sitzung */
    }
  }, [pageSize]);

  const reload = () => {
    const day = dateKey ? new Date(`${dateKey}T00:00:00`) : null;
    const nextDay = day ? new Date(day) : null;
    nextDay?.setDate(nextDay.getDate() + 1);
    const sequence = ++reloadSequence.current;
    return listGamesPage({
      offset: (page - 1) * pageSize,
      limit: pageSize,
      source: source === "alle" ? "" : source,
      result: result === "alle" ? "" : result,
      time_class: tc,
      played_day: dateKey,
      played_from: day ? Math.floor(day.getTime() / 1000) : 0,
      played_to: nextDay ? Math.floor(nextDay.getTime() / 1000) : 0,
      since: zeitraumStart(zeitraum),
      opponent,
      opening,
      color,
      eco,
      query,
    })
      .then((resultPage) => {
        if (sequence !== reloadSequence.current) return;
        setDbGames(resultPage.items.map((r) => toUi(r, locale)));
        setFilteredTotal(resultPage.total);
        setLibraryTotal(resultPage.library_total);
      })
      .catch(() => setDbGames(null));
  };

  useEffect(() => {
    if (backend.mode === "desktop") reload();
  }, [backend.mode, locale, source, result, query, pageSize, page, tc, dateKey, opponent, opening, color, eco, zeitraum]);

  const databaseLoaded = dbGames !== null;
  const allGames: UiGame[] = databaseLoaded ? dbGames : demoGames;

  // Einmal gerechnet · die Grenze gilt für die Abfrage und für die Vorschau.
  const zeitraumSeit = zeitraumStart(zeitraum);

  const filtered = useMemo(
    () => databaseLoaded
      ? allGames
      : allGames.filter(
        (g) =>
          (source === "alle" || g.source === source) &&
          (result === "alle" || g.result === result) &&
          // Demo-Partien tragen nur das übersetzte Label („Rapid"), aus der
          // Datenbank kommt der Rohschlüssel („rapid") · ein Vorfilter aus dem
          // Dashboard nennt den Rohschlüssel, weil die Datenbankabfrage ihn braucht.
          // Ohne den Vergleich ohne Groß- und Kleinschreibung fände er im
          // Demo-Modus nichts und die Liste stünde leer da.
          (tc === "" ||
            g.timeClass === tc ||
            g.tc === tc ||
            g.tc.toLowerCase() === tc.toLowerCase()) &&
          (dateKey === "" || g.dateKey === dateKey || g.date === dateKey) &&
          // Ohne lesbares Datum bleibt die Partie draußen, sobald ein
          // Zeitraum gilt · sonst zählte sie in jedem mit.
          (zeitraumSeit === 0 || (gamePlayedTs(g) ?? -1) >= zeitraumSeit) &&
          (opponent === "" || g.opponent === opponent) &&
          (opening === "" || g.opening === opening) &&
          (color === "" || g.color === color) &&
          (eco === "" || g.eco === eco) &&
          (query === "" ||
            g.opponent.toLowerCase().includes(query.toLowerCase()) ||
            g.opening.toLowerCase().includes(query.toLowerCase()) ||
            g.tags.some((tag) => tag.toLowerCase().includes(query.toLowerCase())))
      ),
    [allGames, databaseLoaded, source, result, tc, dateKey, opponent, opening, color, eco, query, zeitraumSeit]
  );

  const selectedSummary = filtered.find((g) => g.id === selectedId) ?? filtered[0];
  const selected: UiGame | undefined = selectedRecord && selectedRecord.id === selectedSummary?.dbId
    ? toUi(selectedRecord, locale)
    : selectedSummary;

  // Schlussstellung der gewählten Partie · einmal für das Vorschaubrett gerechnet,
  // samt dem Zug, mit dem die Partie endete.
  const preview = useMemo(() => replaySans(selected ? selected.sans : []), [selected]);
  const previewFen = selected ? preview.fen : "";
  const previewLastMove = preview.moves[preview.moves.length - 1] ?? null;
  useEffect(() => {
    if (!selectedSummary?.dbId) {
      setSelectedRecord(null);
      return;
    }
    let current = true;
    getGame(selectedSummary.dbId)
      .then((record) => { if (current) setSelectedRecord(record); })
      .catch(() => { if (current) setSelectedRecord(null); });
    return () => { current = false; };
  }, [selectedSummary?.dbId]);

  // Paginierung: bei Filter-/Seitengröße-Wechsel zurück auf Seite 1.
  useEffect(() => setPage(1), [source, result, query, pageSize, tc, dateKey, opponent, opening, color, eco, zeitraum]);
  const totalResults = databaseLoaded ? filteredTotal : filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const paged = databaseLoaded ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeFrom = totalResults === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeTo = Math.min(safePage * pageSize, totalResults);
  const dateFilterLabel = locale === "de" && dateKey
    ? dateKey.split("-").reverse().join(".")
    : dateKey;

  // ── Filterzustand als Liste ────────────────────────────────────────────────
  // Beide Ansichten zeigen dieselben Filter, nur an anderer Stelle: auf dem
  // Desktop stehen Quelle und Ergebnis als Chip-Reihen über der Tabelle, mobil
  // im Filterblatt · dort führt die Pillenzeile alles auf, was gerade gilt.
  const resultLabels: Record<Result, string> = {
    win: t("games.wins"),
    loss: t("games.losses"),
    draw: t("games.draws"),
  };
  /** Wie ein Zeitraum heißt · dasselbe Wort im Feld und in der Pille. */
  const zeitraumLabel: Record<Zeitraum, string> = {
    alle: t("blatt.filterAll"),
    heute: t("blatt.periodToday"),
    monat: t("blatt.periodMonth"),
    jahr: t("blatt.periodYear"),
  };
  const exactFilters: ActiveFilter[] = [];
  if (dateKey) exactFilters.push({ key: "date", label: t("games.filterDate", { v: dateFilterLabel }), clear: () => setDateKey("") });
  // Gesetzt wird er im Diagramm-Modus · sichtbar und abwerfbar bleibt er auch
  // in der gewöhnlichen Fassung, sonst filterte dort etwas Unsichtbares mit.
  if (zeitraum !== "alle")
    exactFilters.push({
      key: "period",
      label: t("games.filterPeriod", { v: zeitraumLabel[zeitraum] }),
      clear: () => setZeitraum("alle"),
    });
  if (tc) exactFilters.push({ key: "tc", label: t("games.filterMode", { v: tcLabel(tc, locale) }), clear: () => setTc("") });
  if (opponent) exactFilters.push({ key: "opponent", label: t("games.filterOpponent", { v: opponent }), clear: () => setOpponent("") });
  if (opening) exactFilters.push({ key: "opening", label: t("games.filterOpening", { v: opening }), clear: () => setOpening("") });
  if (color)
    exactFilters.push({
      key: "color",
      label: t("games.filterColor", { v: t(color === "white" ? "common.white" : "common.black") }),
      clear: () => setColor(""),
    });
  if (eco) exactFilters.push({ key: "eco", label: t("games.filterEco", { v: eco }), clear: () => setEco("") });
  const chipFilters: ActiveFilter[] = [];
  if (source !== "alle")
    chipFilters.push({
      key: "source",
      label: source === "manual" ? t("games.sourceManual") : source,
      clear: () => setSource("alle"),
    });
  if (result !== "alle") chipFilters.push({ key: "result", label: resultLabels[result], clear: () => setResult("alle") });
  const activeFilters = mobile ? [...chipFilters, ...exactFilters] : exactFilters;

  /**
   * Einen Vorfilter übernehmen · aus dem Start oder aus einem Klick in der
   * Liste. Gesetzt wird nur, was der Filter nennt; was er auslässt, bleibt so,
   * wie der Nutzer es eingestellt hat.
   */
  const applyFilter = (filter: GamesFilter) => {
    if (filter.source !== undefined) setSource(filter.source);
    if (filter.result !== undefined) setResult(filter.result);
    if (filter.tc !== undefined) setTc(filter.tc);
    if (filter.date !== undefined) setDateKey(filter.date);
    if (filter.opponent !== undefined) setOpponent(filter.opponent);
    if (filter.opening !== undefined) setOpening(filter.opening);
    if (filter.color !== undefined) setColor(filter.color);
    if (filter.eco !== undefined) setEco(filter.eco);
  };

  const clearExactFilters = () => {
    setDateKey("");
    setTc("");
    setOpponent("");
    setOpening("");
    setColor("");
    setEco("");
    setZeitraum("alle");
  };
  const clearAllFilters = () => {
    clearExactFilters();
    setSource("alle");
    setResult("alle");
  };

  /** Eine Pille je gesetztem Filter · das X entfernt genau diesen. */
  const filterPills = (filters: ActiveFilter[], clearAll: () => void) => (
    <div
      className={`flex items-center gap-2 ${
        mobile ? "-mx-4 flex-nowrap overflow-x-auto px-4 pb-1" : "flex-wrap"
      }`}
    >
      {filters.map((filter) => (
        <span
          key={filter.key}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent-dim bg-accent-soft py-1 pl-3 pr-1.5 text-[12px] text-accent"
        >
          {filter.label}
          <button
            onClick={filter.clear}
            aria-label={t("games.clearFilter")}
            className="rounded-full p-0.5 text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent"
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <button
        onClick={clearAll}
        className="shrink-0 text-[12px] text-ink3 transition-colors hover:text-accent"
      >
        {t("games.clearAll")}
      </button>
    </div>
  );

  // "chess.com" und "lichess" bleiben stehen · das sind Eigennamen. Die
  // dritte Quelle ist keiner: Sie heißt in jeder Sprache anders.
  const sourceChips = (["alle", "chess.com", "lichess", "manual"] as const).map((s) => (
    <Chip key={s} active={source === s} onClick={() => setSource(s)}>
      {s === "alle" ? t("games.allSources") : s === "manual" ? t("games.sourceManual") : s}
    </Chip>
  ));
  const resultChips = (
    [
      ["alle", t("games.allResults")],
      ["win", resultLabels.win],
      ["loss", resultLabels.loss],
      ["draw", resultLabels.draw],
    ] as const
  ).map(([val, label]) => (
    <Chip key={val} active={result === val} onClick={() => setResult(val)}>
      {label}
    </Chip>
  ));

  // Partie auswählen · mobil öffnet derselbe Tipp das Detailblatt.
  const selectGame = (id: string, openSheet = false) => {
    setSelectedId(id);
    setNoteDraft(null);
    setDeleteError(null);
    if (openSheet) setSheetOpen(true);
  };

  // Position der gewählten Partie in der gesamten Trefferliste · das Blatt
  // blättert darüber hinweg, auch über Seitengrenzen.
  const selectedIndex = paged.findIndex((g) => g.id === selected?.id);
  const globalIndex = selectedIndex < 0 ? 0 : (safePage - 1) * pageSize + selectedIndex + 1;
  const canPrev = globalIndex > 1;
  const canNext = globalIndex > 0 && globalIndex < totalResults;

  /**
   * Eine Partie weiter oder zurück. Am Rand der Seite wird geblättert und die
   * Auswahl nachgezogen, sobald die neue Seite geladen ist · welche Partie das
   * ist, merkt sich `edgeSelect`.
   */
  const stepGame = (delta: 1 | -1) => {
    const next = selectedIndex + delta;
    if (selectedIndex >= 0 && next >= 0 && next < paged.length) {
      selectGame(paged[next].id);
      return;
    }
    if (delta === 1 && safePage < totalPages) {
      setPage(safePage + 1);
      setEdgeSelect("first");
    } else if (delta === -1 && safePage > 1) {
      setPage(safePage - 1);
      setEdgeSelect("last");
    }
  };

  useEffect(() => {
    if (!edgeSelect || paged.length === 0) return;
    selectGame(edgeSelect === "first" ? paged[0].id : paged[paged.length - 1].id);
    setEdgeSelect(null);
  }, [edgeSelect, paged]);

  /**
   * "Seite 1 / 153" · zwischen den Pfeilen bleibt auf einem Telefon so wenig
   * Breite, dass der Text umbricht. Wo er umbricht, entscheidet sonst der
   * Zufall: Bei dreistelliger Seitenzahl fiel er hinter das Wort *und* hinter
   * den Schrägstrich und stand dreizeilig da. Geschützte Leerzeichen um den
   * Schrägstrich halten die Zahlengruppe zusammen · umbrochen wird dann nur
   * noch hinter dem Wort, und mehr als zwei Zeilen können es nicht werden.
   */
  const pageOfLabel = t("games.pageOf", { page: safePage, pages: totalPages }).replace(
    /\s*\/\s*/,
    "\u00a0/\u00a0"
  );

  // Eingetippte Zielseite übernehmen (auf gültigen Bereich begrenzt).
  const commitPageJump = () => {
    const n = parseInt(pageInput ?? "", 10);
    if (!Number.isNaN(n)) setPage(Math.min(Math.max(n, 1), totalPages));
    setPageInput(null);
  };

  /**
   * Eingetippte Seitengröße übernehmen · dieselbe Regel wie beim Sprung: Was
   * außerhalb der Grenzen liegt, wird auf die nächste gültige Zahl geholt und
   * nicht verworfen. Wer 500 tippt, will offensichtlich „viele" und soll nicht
   * mit seiner alten Zehnerseite dastehen.
   */
  const commitPageSize = () => {
    const n = parseInt(sizeInput ?? "", 10);
    if (!Number.isNaN(n)) setPageSize(clampPageSize(n));
    setSizeInput(null);
  };

  /**
   * "1–10 von 1.523 · 10 je Seite" · Spanne und Seitengröße in einem Satz.
   *
   * Die Zahl je Seite ist zugleich der Griff, der sie ändert; im Blatt heißt
   * dieselbe Angabe „je Blatt", weil dort eine Seite ein Blatt ist. Beide
   * Fassungen lesen dieselbe Zahl und schreiben in denselben Zustand — der
   * Modus wechselt nur das Wort und den Satz drumherum.
   */
  const rangeLabel = t("games.rangeInfo", {
    from: deInt(rangeFrom),
    to: deInt(rangeTo),
    total: deInt(totalResults),
  });

  /**
   * Ein Lauf über die komplette Historie zieht sich über Dutzende Monatsarchive
   * · wer ihn versehentlich angestossen hat, soll ihn auch wieder loswerden,
   * ohne die App zu schliessen. Deshalb ist der Knopf, der währenddessen
   * „Importiere …“ zeigt, zugleich der Abbruch.
   */
  const cancelImport = () => {
    if (!importAbort.current) return;
    importAbort.current.abort();
    setImportMsg(t("games.importCancelling"));
  };

  const runImport = async (full: boolean) => {
    const abort = new AbortController();
    importAbort.current = abort;
    setImporting(true);
    setImportTone("info");
    setImportMsg(full ? t("games.loadingFull") : t("games.loadingLatest"));
    try {
      const settings = await getSettings().catch(() => null);
      const ccUser = settings?.cc_user ?? "";
      const liUser = settings?.li_user ?? "";
      if (!ccUser && !liUser) {
        setImporting(false);
        setImportTone("warning");
        setImportMsg(t("games.noAccounts"));
        return;
      }
      const { games: fetched, summary } = await fetchAll(ccUser, liUser, {
        full,
        months: settings?.import_months,
        // Nach dem Abbruch bleibt der Fortschritt der letzten Anfrage stehen ·
        // die Meldung gehört dann dem Abbruch.
        onProgress: (i, n) => !abort.signal.aborted && setImportMsg(t("games.ccProgress", { i, n })),
        signal: abort.signal,
      });
      const res = await upsertGames(fetched as GameRecord[]);
      await reload();
      // Positionsindex im Hintergrund auffrischen (für die Stellungssuche).
      indexPositions().catch(() => {});
      // Abgebrochen wird trotzdem gespeichert, was schon da war · der Import
      // ist duplikatsicher, der Rest kommt beim nächsten Lauf dazu.
      let msg = summary.aborted
        ? t("games.importAborted", { ins: res.inserted, total: deInt(res.total) })
        : t("games.importResult", {
            ins: res.inserted,
            cc: summary.fetched.cc,
            li: summary.fetched.li,
            total: deInt(res.total),
          });
      if (summary.errors.length) msg += t("games.importErrors", { e: summary.errors.join("; ") });
      setImportTone(summary.errors.length || summary.aborted ? "warning" : "success");
      setImportMsg(msg);
    } catch (e) {
      setImportTone("error");
      setImportMsg(t("games.importFailed", { e: String(e) }));
    } finally {
      importAbort.current = null;
      setImporting(false);
    }
  };

  /**
   * Die Notiz ablegen · derselbe Weg für beide Fassungen.
   *
   * Die gewöhnliche Fassung schickt den Entwurf, den ihr Textfeld im Zustand
   * hält, und sagt es mit ihrem Knopf; das Blatt schickt beim Verlassen des
   * Feldes den Text selbst und sagt es in der Beschriftungszeile. Abgelegt
   * wird beides gleich, also steht das Ablegen einmal da.
   */
  const storeNote = async (text: string) => {
    if (!selected?.dbId) return;
    await setGameNote(selected.dbId, text);
    setDbGames((gs) =>
      gs ? gs.map((g) => (g.id === selected.id ? { ...g, note: text || undefined } : g)) : gs
    );
    setSelectedRecord((record) => (record ? { ...record, note: text } : record));
  };

  const saveNote = async () => {
    if (noteDraft === null) return;
    await storeNote(noteDraft);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
  };

  const saveTags = async (next: string[]) => {
    if (!selected?.dbId) return;
    const saved = await setGameTags(selected.dbId, next);
    setDbGames((gs) => gs?.map((g) => (g.id === selected.id ? { ...g, tags: saved } : g)) ?? gs);
    setSelectedRecord((record) => record ? { ...record, tags: saved } : record);
  };

  const deleteSelected = async () => {
    if (!selected?.dbId || deleting) return;
    setDeleteConfirmOpen(false);
    setDeleting(true);
    setDeleteError(null);
    try {
      const deleted = await deleteGame(selected.dbId);
      if (!deleted) throw new Error(t("games.deleteMissing"));
      await reload();
      setSheetOpen(false);
      setSelectedId(null);
      setSelectedRecord(null);
      setNoteDraft(null);
    } catch (e) {
      setDeleteError(t("games.deleteFailed", { e: String(e) }));
    } finally {
      setDeleting(false);
    }
  };

  const choosePgnImport = async () => {
    const path = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
    });
    if (typeof path === "string") setPgnPath(path);
  };

  const choosePgnExport = async () => {
    const path = await saveDialog({
      defaultPath: "kiebitz-export.pgn",
      filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
    });
    if (path) setPgnExportPath(path.toLowerCase().endsWith(".pgn") ? path : `${path}.pgn`);
  };

  const runPgnImport = async () => {
    if (!pgnPath.trim()) return;
    setPgnBusy(true);
    try {
      const parsed = importPgn(await readPgnFile(pgnPath.trim()), pgnPlayer, {
        excludeFromAnalysis: pgnExcludeFromAnalysis,
      });
      const res = await upsertGames(parsed);
      await reload();
      indexPositions().catch(() => {});
      setImportTone("success");
      setImportMsg(t("games.pgnImported", { n: parsed.length, ins: res.inserted }));
    } catch (e) {
      setImportTone(e instanceof PgnPlayerMismatchError ? "warning" : "error");
      setImportMsg(
        e instanceof PgnPlayerMismatchError
          ? t("games.pgnPlayerMismatch", {
              player: e.playerName || t("games.pgnPlayerEmpty"),
              n: e.unmatchedGames,
            })
          : t("games.pgnFailed", { e: String(e) })
      );
    } finally {
      setPgnBusy(false);
    }
  };

  const runPgnExport = async (onlySelected: boolean) => {
    if (!pgnExportPath.trim()) return;
    setPgnBusy(true);
    try {
      const chosen = onlySelected && selected?.dbId
        ? [selectedRecord?.id === selected.dbId ? selectedRecord : await getGame(selected.dbId)]
        : await listGamesForExport();
      if (!chosen.length) return;
      await writePgnFile(pgnExportPath.trim(), exportPgn(chosen, pgnPlayer));
      setImportTone("success");
      setImportMsg(t("games.pgnExported", { n: chosen.length, path: pgnExportPath.trim() }));
    } catch (e) {
      setImportTone("error");
      setImportMsg(t("games.pgnFailed", { e: String(e) }));
    } finally {
      setPgnBusy(false);
    }
  };

  // Ohne hinterlegtes Konto bleibt der eigene Name leer statt auf Demo-Daten
  // zurückzufallen · sonst importierte eine frische Installation fremde Partien.
  const [myUser, setMyUser] = useState(backend.mode === "desktop" ? "" : profile.ccUser);

  // Unten steht immer die eigene Farbe · das Brett ist danach gedreht. Wie im
  // Analysis-Tab hat jede Seite ihre Elo direkt hinter dem Namen. Der konkrete
  // Partiedatensatz ist die verlässlichste Quelle für den damaligen Eigennamen.
  const ownName = selectedRecord && selectedRecord.id === selected?.dbId
    ? selectedRecord.my_name?.trim() || myUser
    : myUser;
  const previewBottom = {
    name: ownName,
    elo: selected?.myElo ?? 0,
  };
  const previewTop = {
    name: selected?.opponent ?? "",
    elo: selected?.oppElo ?? 0,
  };
  useEffect(() => {
    if (backend.mode === "desktop") {
      getSettings()
        .then((s) => {
          const own = s.display_name || s.cc_user || s.li_user;
          setMyUser(own);
          setPgnPlayer(own);
        })
        .catch(() => {});
    }
  }, [backend.mode]);

  // ── Detailbausteine ────────────────────────────────────────────────────────
  // Dieselben drei Blöcke tragen beide Ansichten: auf dem Desktop stehen sie in
  // zwei Karten neben der Liste, mobil im Blatt über der Liste.
  /**
   * Die Vorschau bleibt in der Liste bewusst klein · daneben steht eine
   * Tabelle, und ein Diagramm neben einer Tabelle ist eine Abbildung. Wer die
   * Stellung wirklich sehen will, holt sie über den Fokus groß heraus: Dort
   * gilt dann `--board-edge` wie bei jedem anderen Brett.
   */
  const previewBoard = (boardId: string, width: number) => (
    <Board
      boardId={boardId}
      fen={previewFen}
      width={width}
      lastMove={previewLastMove}
      orientation={selected?.color ?? "white"}
      silent
    />
  );

  /**
   * Der Name trägt seinen Abstand nicht selbst: Über dem Brett steht er in
   * einer Zeile mit dem Griff zum Fokus, im Fokus setzt die Spalte die
   * Abstände. Ein eigener Rand käme dort doppelt und ließe hier den Griff
   * schief neben dem Namen hängen · die Analyse hält es mit ihren
   * Spielerzeilen genauso.
   */
  const previewName = (top: boolean) => {
    const player = top ? previewTop : previewBottom;
    return (
      <div className="min-w-0 text-[12.5px]">
        <div className="truncate font-semibold text-ink2">
          {player.name}{player.elo > 0 ? ` (${player.elo})` : ""}
        </div>
      </div>
    );
  };

  const detailBoard = selected && (
    <div className="mx-auto max-w-[528px]">
      {/* Name und Griff teilen sich eine Mittellinie · der Griff ist höher als
          die Zeile, und oben ausgerichtet stünde er sonst über dem Namen und
          zugleich auf der Brettkante. */}
      <div className="mb-2 flex min-h-[33px] items-center justify-between gap-2">
        {previewName(true)}
        <FocusButton onClick={() => setFocused(true)} />
      </div>
      {previewBoard("games-preview", BOARD_WIDTH)}
      <div className="mt-2">{previewName(false)}</div>

      <FocusBoard
        open={focused}
        onClose={() => setFocused(false)}
        title={t("nav.games")}
        subtitle={`${previewTop.name} vs. ${previewBottom.name}`}
        above={previewName(true)}
        below={previewName(false)}
      >
        <div className="board-bleed">{previewBoard("games-preview-focus", BOARD_MAX)}</div>
      </FocusBoard>
    </div>
  );

  const detailFacts = selected && (
    <>
      {/* Die Paarung stand früher hier als eine Zeile · seit beide
          Namen am Brett stehen, bliebe davon nur eine Wiederholung.
          Der Ausgang gehört trotzdem hierher, zu Eröffnung und Zügen. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-[12px] text-ink3">
          {selected.opening} {selected.eco && `(${selected.eco})`} ·{" "}
          {t("games.movesTc", { n: selected.moves, tc: selected.tc })}
        </div>
        <ResultBadge result={selected.result} />
      </div>
      {selected.analyzed && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {([
            [t("ins.phase.opening"), selected.accuracyOpening],
            [t("ins.phase.middlegame"), selected.accuracyMiddlegame],
            [t("ins.phase.endgame"), selected.accuracyEndgame],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-md bg-panel2 px-1.5 py-1.5">
              <div className="text-[10px] text-ink3">{label}</div>
              <div className="text-[12px] font-medium text-ink2">{value == null ? "—" : `${de(value)} %`}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <TagEditor
          key={selected.id}
          tags={selected.tags}
          onChange={saveTags}
          editable={Boolean(selected.dbId)}
          prefix={selected.analysisExcluded ? <Tag>{t("games.analysisExcludedTag")}</Tag> : undefined}
        />
      </div>
    </>
  );

  const detailNotes = selected && (
    <>
      <textarea
        key={`${selected.id}-${selectedRecord?.id === selected.dbId ? "detail" : "summary"}`}
        defaultValue={selected.note ?? ""}
        onChange={(e) => setNoteDraft(e.target.value)}
        placeholder={t("games.notesPlaceholder")}
        rows={4}
        className="w-full resize-none rounded-lg border border-line bg-panel2 p-3 text-[13px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      <div className="mt-3 grid gap-2 min-[480px]:grid-cols-2">
        {selected.dbId ? (
          <>
            <Button primary onClick={saveNote} className="w-full">
              <Save size={15} />
              {noteSaved ? t("games.noteSaved") : t("games.saveNote")}
            </Button>
            <Button className="w-full" onClick={() => openAnalysis(selected.dbId!)}>
              {selected.analyzed ? t("games.openAnalysis") : t("games.analyze")}
            </Button>
          </>
        ) : (
          <Button primary className="w-full min-[480px]:col-span-2">
            {selected.analyzed ? t("games.openAnalysis") : t("games.analyzeStockfish")}
          </Button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        {selected.source !== "manual" ? (
          <ExtLink
            href={selected.url || (selected.source === "chess.com" ? `https://www.chess.com/games/archive/${myUser}` : `https://lichess.org/@/${myUser}/all`)}
            label={t("games.original")}
          />
        ) : (
          <span />
        )}
        {selected.dbId && (
          <button
            type="button"
            disabled={deleting}
            onClick={() => setDeleteConfirmOpen(true)}
            className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-loss-dim bg-loss-soft px-3 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:border-loss disabled:cursor-not-allowed disabled:opacity-45"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {deleting ? t("games.deleting") : t("games.delete")}
          </button>
        )}
      </div>
      {deleteError && (
        <div className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12px] text-loss">
          {deleteError}
        </div>
      )}
    </>
  );

  /** Farbe der Importmeldung · sie steht auf der Seite und im Blatt. */
  const importNoteCls =
    importTone === "warning"
      ? "border-gold-dim bg-gold-soft text-gold"
      : importTone === "error"
        ? "border-loss-dim bg-loss-soft text-loss"
        : "border-accent-dim bg-accent-soft text-accent";

  /**
   * Import und Export · derselbe Inhalt in zwei Fassungen.
   *
   * Auf dem Desktop steht er als Karte unter der Kopfzeile; dort ist Platz,
   * und die Liste darunter bleibt sichtbar. Mobil kam er bisher als Block
   * zwischen Leiste und Liste, hat die Seite um seine ganze Höhe verschoben
   * und die Partien nach unten gedrückt. Jetzt kommt er wie das Filterblatt
   * in den Vordergrund: abgedunkelter, unscharfer Hintergrund, darüber die
   * Karte · siehe components/MobileSheet.tsx.
   */
  const importBody = (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-ink2">{t("games.onlineImportTitle")}</div>
          <div className="mt-0.5 text-[11.5px] text-ink3">{t("games.onlineImportHint")}</div>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[460px]:grid-cols-2 sm:flex">
          <Button className="w-full sm:w-auto" disabled={importing} onClick={() => !importing && runImport(true)}>
            <History size={15} /> {t("games.importAll")}
          </Button>
          {/* Während des Laufs ist derselbe Knopf der Abbruch · das Kreuz sagt
              es, der Titel nennt es beim Namen. Ein zweiter Knopf daneben
              hätte nur in genau dieser Sekunde etwas zu tun. */}
          <Button
            className="w-full sm:w-auto"
            primary
            title={importing ? t("games.importCancel") : undefined}
            label={importing ? t("games.importCancel") : undefined}
            onClick={() => (importing ? cancelImport() : runImport(false))}
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {importing ? t("games.importing") : t("games.importLatest")}
            {importing && <X size={14} className="opacity-70" />}
          </Button>
        </div>
      </div>
      <div className="mb-4 border-t border-line" />
      <div className="mb-3 text-[12.5px] font-medium text-ink2">{t("games.pgnTitle")}</div>
      <div className="mb-3 grid max-w-md gap-1.5 sm:grid-cols-[auto_minmax(0,14rem)] sm:items-center">
        <label className="text-[12px] text-ink3" htmlFor="pgn-player">{t("games.pgnPlayer")}</label>
        <input id="pgn-player" value={pgnPlayer} onChange={(e) => setPgnPlayer(e.target.value)} className="min-w-0 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" />
      </div>
      <p className="mb-3 max-w-3xl text-[11.5px] leading-relaxed text-ink3">{t("games.pgnHint", { user: pgnPlayer })}</p>
      <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-2">
        <section className="min-w-0 rounded-lg border border-line bg-panel2/35 p-3">
          <div className="mb-2 text-[11.5px] font-medium text-ink2">{t("games.pgnImportGroup")}</div>
          <button onClick={choosePgnImport} className="w-full min-w-0 truncate rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12.5px] text-ink3 hover:border-line2">
            {pgnPath || t("games.pgnChooseImport")}
          </button>
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-ink2">
            <input
              type="checkbox"
              checked={pgnExcludeFromAnalysis}
              onChange={(event) => setPgnExcludeFromAnalysis(event.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
            />
            <span>
              <span className="block font-medium text-ink">{t("games.pgnExcludeAnalysis")}</span>
              <span className="text-ink3">{t("games.pgnExcludeAnalysisHint")}</span>
            </span>
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <Button className="w-full" onClick={choosePgnImport}><FolderOpen size={14} /> {t("games.chooseFile")}</Button>
            <Button className="w-full" primary disabled={!pgnPath || pgnBusy} onClick={() => runPgnImport()}><FileUp size={14} /> {t("common.import")}</Button>
          </div>
        </section>
        <section className="min-w-0 rounded-lg border border-line bg-panel2/35 p-3">
          <div className="mb-2 text-[11.5px] font-medium text-ink2">{t("games.pgnExportGroup")}</div>
          <button onClick={choosePgnExport} className="w-full min-w-0 truncate rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-[12.5px] text-ink3 hover:border-line2">
            {pgnExportPath || t("games.pgnChooseExport")}
          </button>
          <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 min-[620px]:grid-cols-3">
            <Button className="w-full" onClick={choosePgnExport}><FolderOpen size={14} /> {t("games.chooseTarget")}</Button>
            <Button className="w-full" onClick={() => !pgnBusy && runPgnExport(true)} disabled={!pgnExportPath || !selected?.dbId}><FileDown size={14} /> {t("games.pgnSelected")}</Button>
            <Button className="w-full min-[420px]:col-span-2 min-[620px]:col-span-1" onClick={() => !pgnBusy && runPgnExport(false)} disabled={!pgnExportPath}>{t("games.pgnAll")}</Button>
          </div>
        </section>
      </div>
    </>
  );

  const showImport = backend.mode === "desktop" && importOpen;
  const importPanel = showImport && !mobile ? (
    <Card title={t("games.importPanelTitle")} className="mb-4">{importBody}</Card>
  ) : null;
  const importSheet = showImport && mobile ? (
    <MobileSheet
      testId="games-import-sheet"
      ariaLabel={t("games.importPanelTitle")}
      onClose={() => setImportOpen(false)}
      title={
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Download size={15} className="text-accent" />
          {t("games.importPanelTitle")}
        </div>
      }
      footer={
        <div className="flex items-center justify-end px-1">
          <Button primary onClick={() => setImportOpen(false)}>
            {t("common.done")}
          </Button>
        </div>
      }
    >
      {/* Der Fortschritt gehört ins Blatt · die Meldung auf der Seite liegt
          hinter dem Schleier und wäre während des Laufs nicht zu lesen. */}
      {importMsg && (
        <div className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-[12px] ${importNoteCls}`}>
          {importMsg}
        </div>
      )}
      <div className="px-4 py-3">{importBody}</div>
    </MobileSheet>
  ) : null;

  // Dieselben Daten, anders gesetzt · Filter, Liste und Eintrag stehen oben
  // schon fertig da und werden hier nur anders ausgegeben.
  if (diagramMode) {
    // Der letzte Zug der Partie · er benennt die Stellung, die im Diagramm
    // steht, so wie eine Bildunterschrift im Buch sie benennt.
    const letzterZug =
      selected?.sans && selected.sans.length > 0
        ? notationLine(
            [selected.sans[selected.sans.length - 1]],
            locale,
            selected.sans.length - 1
          )
        : "";
    // Wie die Partie ausging · der Grund steht im Datensatz, geraten wird
    // nichts. Ohne Grund bleibt der bloße Ausgang.
    const grund =
      selectedRecord?.termination && isTermination(selectedRecord.termination)
        ? selectedRecord.termination
        : null;
    const sieger =
      selected == null || selected.result === "draw"
        ? null
        : selected.result === "win"
          ? selected.color
          : selected.color === "white"
            ? "black"
            : "white";
    const ausgang = selected ? endLabel(grund, sieger, t) : "";
    // „nach 19...Dg6, Weiß gewinnt durch Aufgabe" · ohne Züge bleibt der
    // Ausgang allein, weil ein „nach nichts" kein Satz wäre.
    const beizeile = !selected
      ? ""
      : letzterZug
        ? t("blatt.captionAfter", { m: letzterZug, end: ausgang })
        : ausgang;
    // Die laufende Nummer der gewählten Partie im Bestand.
    const gewaehltNummer =
      selected != null && databaseLoaded
        ? libraryTotal - (rangeFrom - 1) - paged.findIndex((g) => g.id === selected.id)
        : null;
    return (
      <Suspense fallback={<LeereSeite />}>
        <GamesBlatt
          mobile={mobile}
          bestand={databaseLoaded ? libraryTotal : null}
          filter={[
            {
              label: t("blatt.search"),
              wert: query,
              platzhalter: t("games.searchPlaceholder"),
              leer: query === "",
              suche: true,
              onChange: setQuery,
            },
            {
              label: t("games.colSource"),
              wert: source === "alle" ? t("blatt.filterAll") : source,
              leer: source === "alle",
              breite: 112,
              onClick: () => setSource(source === "alle" ? "chess.com" : source === "chess.com" ? "lichess" : "alle"),
            },
            {
              label: t("games.colResult"),
              wert: result === "alle" ? t("blatt.filterAll") : resultLabels[result],
              leer: result === "alle",
              breite: 96,
              onClick: () =>
                setResult(
                  result === "alle" ? "win" : result === "win" ? "draw" : result === "draw" ? "loss" : "alle"
                ),
            },
            {
              label: t("blatt.period"),
              wert: zeitraumLabel[zeitraum],
              leer: zeitraum === "alle",
              breite: 112,
              onClick: () => setZeitraum(naechsterZeitraum(zeitraum)),
            },
            // Was aus dem Start oder aus dem Eintrag heraus gesetzt wurde,
            // bekommt sein eigenes Feld — aber erst dann. Ein Feld, das fast
            // immer „alle" sagt, sagt nichts; ein Filter dagegen, der ohne
            // Feld gilt, wäre eine Einschränkung, die niemand sieht und
            // niemand wieder loswird. Ein Klick nimmt ihn zurück.
            ...(tc
              ? [
                  {
                    label: t("games.colMode"),
                    wert: tcLabel(tc, locale),
                    leer: false,
                    breite: 104,
                    onClick: () => setTc(""),
                  },
                ]
              : []),
            ...(dateKey
              ? [
                  {
                    label: t("games.colDate"),
                    wert: dateFilterLabel,
                    leer: false,
                    breite: 104,
                    onClick: () => setDateKey(""),
                  },
                ]
              : []),
            ...(opponent
              ? [
                  {
                    label: t("games.colOpponent"),
                    wert: opponent,
                    leer: false,
                    breite: 136,
                    onClick: () => setOpponent(""),
                  },
                ]
              : []),
            ...(opening
              ? [
                  {
                    label: t("games.colOpening"),
                    wert: opening,
                    leer: false,
                    breite: 160,
                    onClick: () => setOpening(""),
                  },
                ]
              : []),
            ...(color
              ? [
                  {
                    label: t("ins.color"),
                    wert: t(color === "white" ? "common.white" : "common.black"),
                    leer: false,
                    breite: 96,
                    onClick: () => setColor(""),
                  },
                ]
              : []),
            ...(eco
              ? [
                  {
                    label: "ECO",
                    wert: eco,
                    leer: false,
                    breite: 80,
                    onClick: () => setEco(""),
                  },
                ]
              : []),
          ]}
          treffer={totalResults}
          zeilen={paged.map((game, index) => ({
            game,
            // Die laufende Nummer zählt rückwärts vom Bestand · die neueste
            // Partie trägt die höchste, wie der letzte Eintrag im Band.
            nummer: databaseLoaded ? libraryTotal - (rangeFrom - 1) - index : null,
          }))}
          gewaehlt={selected}
          fen={previewFen}
          unterschrift={{
            // Eine Eintragsnummer ist eine Kennung und keine Menge · sie steht
            // ohne Tausenderpunkt, wie eine Seitenzahl.
            nummer:
              gewaehltNummer != null
                ? `${t("blatt.entryNo", { n: String(gewaehltNummer) })} · ${t("blatt.finalPosition")}`
                : t("blatt.finalPosition"),
            zeilen: [
              selected ? (
                <>
                  {ownName} –{" "}
                  <button
                    type="button"
                    onClick={() => setOpponent(selected.opponent)}
                    className="hover:text-accent"
                  >
                    {selected.opponent}
                  </button>
                </>
              ) : (
                ""
              ),
              beizeile,
            ],
          }}
          angaben={
            selected
              ? [
                  {
                    label: t("games.colSource"),
                    wert: (
                      <>
                        <span style={{ color: plattformFarbe(selected.source) }}>
                          {selected.source}
                        </span>
                        {` · ${selected.tc}`}
                      </>
                    ),
                    onClick:
                      selected.source === "manual" ? undefined : () => setSource(selected.source),
                  },
                  {
                    label: t("games.colDate"),
                    wert: selected.date,
                    // Aus der Datenbank kommt der ISO-Schlüssel, die
                    // Demo-Partien tragen nur das gesetzte Datum · der Filter
                    // nimmt beides an.
                    onClick: () => setDateKey(selected.dateKey ?? selected.date),
                  },
                  {
                    label: t("games.colOpening"),
                    wert: (
                      <>
                        <span className="blatt-zahl text-ink3">{selected.eco} </span>
                        {selected.opening}
                      </>
                    ),
                    onClick: () => setOpening(selected.opening),
                  },
                  {
                    // Nicht „Genauigkeit": Vorne steht die Zahl der Züge, die
                    // Genauigkeit folgt ihr wie im Entwurf — zwei Angaben auf
                    // einer Linie, und die Beschriftung nennt die erste.
                    label: t("blatt.moves"),
                    wert: [
                      deInt(selected.moves),
                      selected.accuracy != null ? `${de(selected.accuracy)} %` : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  },
                ]
              : []
          }
          // Dieselben Tags wie in der Tabelle · gelesen wird der Datensatz,
          // wenn er schon da ist, sonst die Zeile aus der Liste.
          stichwoerter={selectedRecord?.tags ?? selected?.tags ?? []}
          stichwortVorsatz={selected?.analysisExcluded ? t("games.analysisExcludedTag") : undefined}
          notiz={selectedRecord?.note ?? selected?.note ?? ""}
          // Geschrieben wird nur, wo die Partie auch bleibt · ohne Datenbank
          // (Web-Vorschau, Demo-Partien) bleiben beide Felder Auskunft.
          onStichwoerter={selected?.dbId != null ? saveTags : undefined}
          onNotiz={selected?.dbId != null ? storeNote : undefined}
          von={rangeFrom}
          bis={rangeTo}
          blatt={safePage}
          blaetter={totalPages}
          proBlatt={pageSize}
          minProBlatt={MIN_PAGE_SIZE}
          maxProBlatt={MAX_PAGE_SIZE}
          onProBlatt={(n) => setPageSize(clampPageSize(n))}
          onBlattWaehlen={(n) => setPage(Math.min(Math.max(n, 1), totalPages))}
          onZurueck={() => setPage((value) => Math.max(1, value - 1))}
          onWeiter={() => setPage((value) => Math.min(totalPages, value + 1))}
          onWaehlen={(game) => setSelectedId(game.id)}
          onFilter={applyFilter}
          // Aufschlagen lassen sich die Filter nur mobil · am Rechner stehen
          // sie ohnehin alle in der Kopfleiste.
          filterOffen={filterOpen}
          onFilterUmschalten={mobile ? () => setFilterOpen((open) => !open) : undefined}
          einfuhr={
            backend.mode === "desktop"
              ? {
                  offen: importOpen,
                  onUmschalten: () => setImportOpen((open) => !open),
                  inhalt: importBody,
                  meldung: importMsg,
                }
              : undefined
          }
          onAnalyse={
            selected?.dbId != null ? () => openAnalysis(selected.dbId!) : undefined
          }
          analysiert={selected?.analyzed}
          onOriginal={
            selected && selected.source !== "manual"
              ? () =>
                  openExternal(
                    selected.url ||
                      (selected.source === "chess.com"
                        ? `https://www.chess.com/games/archive/${myUser}`
                        : `https://lichess.org/@/${myUser}/all`)
                  )
              : undefined
          }
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className={`flex flex-wrap items-end justify-between gap-x-4 gap-y-3 ${mobile ? "mb-3" : "mb-5"}`}>
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("games.title")}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink3">
            {databaseLoaded ? (
              <>
                <Database size={13} className="text-accent" />
                {t("games.dbCount", { n: deInt(libraryTotal) })}
              </>
            ) : (
              t("games.demoHint")
            )}
          </p>
        </div>
        {/* Mobil steht der Import als Symbol in der Suchleiste · siehe unten. */}
        {backend.mode === "desktop" && !mobile && (
          <Button onClick={() => setImportOpen((open) => !open)}>
            <Download size={15} /> {t("games.manageImports")}
            {importOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        )}
      </header>

      {importMsg && (
        <div className={`mb-4 rounded-lg border px-4 py-2.5 text-[12.5px] ${importNoteCls}`}>
          {importMsg}
        </div>
      )}

      {/* Auf dem Desktop öffnet der Import/Export-Bereich unter seiner
          Schaltfläche · mobil als Blatt, weiter unten. */}
      {importPanel}

      {/* Mobil ist aus der Suchzeile und den beiden Chip-Reihen eine einzige
          Leiste geworden: suchen, filtern, importieren · die Filter selbst
          stehen im Blatt, ihr Zustand als Pillen darunter. Auf dem Desktop
          bleibt alles sichtbar, dort ist der Platz dafür da. */}
      {mobile ? (
        <div className="mb-3 flex items-center gap-2" data-tour="games-search">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("games.searchPlaceholder")}
              className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label={t("games.filters")}
            className={`relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
              activeFilters.length > 0
                ? "border-accent-dim bg-accent-soft text-accent"
                : "border-line bg-panel text-ink2"
            }`}
          >
            <SlidersHorizontal size={17} />
            {activeFilters.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                {activeFilters.length}
              </span>
            )}
          </button>
          {backend.mode === "desktop" && (
            <button
              type="button"
              onClick={() => setImportOpen((open) => !open)}
              aria-label={t("games.manageImports")}
              aria-haspopup="dialog"
              className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
                importOpen
                  ? "border-accent-dim bg-accent-soft text-accent"
                  : "border-line bg-panel text-ink2"
              }`}
            >
              <Download size={17} />
            </button>
          )}
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2" data-tour="games-search">
          <div className="relative mr-2">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("games.searchPlaceholder")}
              className="w-64 rounded-lg border border-line bg-panel py-1.5 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
            />
          </div>
          {sourceChips}
          <span className="mx-1 h-4 w-px bg-line2" />
          {resultChips}
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="mb-4">
          {filterPills(activeFilters, mobile ? clearAllFilters : clearExactFilters)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_320px] min-[1500px]:grid-cols-[minmax(0,1fr)_560px]">
        <div className="flex min-w-0 flex-col gap-3">
        <Card pad={false}>
          {mobile ? (
          // Auf Handybreite wird aus jeder Zeile eine Karte · die achtspaltige
          // Tabelle liesse sich sonst nur quer scrollend lesen.
          <div data-testid="games-list">
            {paged.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                // Ohne Tipp ist nichts markiert · die Vorauswahl der ersten
                // Partie hat mobil keine sichtbare Entsprechung mehr.
                selected={selectedId === g.id}
                onClick={() => selectGame(g.id, true)}
                trailing={
                  (g.tags.length > 0 || g.note) && (
                    <span className="flex shrink-0 items-center gap-1">
                      {g.tags[0] && (
                        <span className="inline-block max-w-[68px] truncate align-middle">
                          <Tag>{g.tags[0]}</Tag>
                        </span>
                      )}
                      {g.tags.length > 1 && <span>+{g.tags.length - 1}</span>}
                      {g.note && <StickyNote size={13} className="text-gold" />}
                    </span>
                  )
                }
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-ink3">
                {t("games.noneFound")}
              </div>
            )}
          </div>
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-ink3">
                <th className="py-2.5 pl-4 pr-2 font-medium">{t("games.colDate")}</th>
                <th className="px-2 font-medium">{t("games.colSource")}</th>
                <th className="px-2 font-medium">{t("games.colMode")}</th>
                <th className="px-2 font-medium">{t("games.colOpponent")}</th>
                <th className="px-2 font-medium">{t("games.colOpening")}</th>
                <th className="px-2 font-medium">{t("games.colResult")}</th>
                <th className="px-2 text-right font-medium">{t("games.colAccuracy")}</th>
                <th className="w-[112px] py-2.5 pl-2 pr-4 text-right font-medium">{t("games.colTags")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((g) => {
                const filterTo = (e: MouseEvent, fn: () => void) => {
                  e.stopPropagation();
                  fn();
                };
                return (
                <tr
                  key={g.id}
                  onClick={() => selectGame(g.id)}
                  className={`cursor-pointer border-b border-line last:border-0 ${
                    selected?.id === g.id ? "bg-panel2" : "hover:bg-panel2/60"
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <button
                      onClick={(e) => filterTo(e, () => setDateKey(g.dateKey ?? g.date))}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.date}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setSource(g.source))}
                      className="transition-opacity hover:opacity-80"
                    >
                      <SourceBadge source={g.source} />
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setTc(g.timeClass ?? g.tc))}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.tc}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setOpponent(g.opponent))}
                      className="text-ink transition-colors hover:text-accent"
                    >
                      {g.opponent}
                    </button>{" "}
                    <span className="text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setOpening(g.opening))}
                      className="text-left text-ink2 transition-colors hover:text-accent"
                    >
                      {g.opening}
                    </button>{" "}
                    {g.eco && <span className="text-ink3">· {g.eco}</span>}
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, () => setResult(g.result))}
                      className="transition-opacity hover:opacity-80"
                    >
                      <ResultBadge result={g.result} />
                    </button>
                  </td>
                  <td className="px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      {g.tags[0] && <span className="inline-block max-w-[68px] truncate align-middle"><Tag>{g.tags[0]}</Tag></span>}
                      {g.tags.length > 1 && <span className="text-[11px] text-ink3">+{g.tags.length - 1}</span>}
                      {g.note && <StickyNote size={14} className="ml-1 inline text-gold" />}
                    </div>
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-ink3">
                    {t("games.noneFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          )}
        </Card>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-ink3">
            {/* Spanne und Seitengröße in einem Satz · die Zahl je Seite ist
                zugleich der Griff, der sie ändert. Auf dem Telefon steht die
                Spanne mit, obwohl die Seitenzahl rechts schon zählt: Sie trägt
                jetzt die einzige Stelle, an der die Seitengröße zu sehen und zu
                ändern ist, und die darf nicht am Bildschirmformat hängen. */}
            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
              <span>{rangeLabel}</span>
              <span aria-hidden className="text-ink3/60">
                ·
              </span>
              {sizeInput !== null ? (
                <input
                  autoFocus
                  type="number"
                  min={MIN_PAGE_SIZE}
                  max={MAX_PAGE_SIZE}
                  value={sizeInput}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setSizeInput(e.target.value)}
                  onBlur={commitPageSize}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPageSize();
                    else if (e.key === "Escape") setSizeInput(null);
                  }}
                  aria-label={t("games.setPerPage")}
                  className="w-14 rounded-lg border border-accent-dim bg-panel px-2 py-1 text-center tabular-nums text-ink focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              ) : (
                <button
                  onClick={() => setSizeInput(String(pageSize))}
                  title={t("games.setPerPage")}
                  aria-label={t("games.setPerPage")}
                  className="rounded-lg px-1.5 py-1 underline decoration-line2 decoration-dotted underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                >
                  {t("games.perPageValue", { n: pageSize })}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(1)}
                disabled={safePage <= 1}
                title={t("games.firstPage")}
                aria-label={t("games.firstPage")}
                className="flex items-center rounded-lg border border-line bg-panel px-2 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronsLeft size={15} />
              </button>
              <button
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={15} /> {t("games.prev")}
              </button>
              {pageInput !== null ? (
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={totalPages}
                  value={pageInput}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={commitPageJump}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPageJump();
                    else if (e.key === "Escape") setPageInput(null);
                  }}
                  aria-label={t("games.goToPage")}
                  className="w-14 rounded-lg border border-accent-dim bg-panel px-2 py-1 text-center tabular-nums text-ink focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              ) : (
                <button
                  onClick={() => setPageInput(String(safePage))}
                  title={t("games.goToPage")}
                  className="rounded-lg px-1.5 py-1 tabular-nums transition-colors hover:text-accent"
                >
                  {pageOfLabel}
                </button>
              )}
              <button
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                className="flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t("games.next")} <ChevronRight size={15} />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={safePage >= totalPages}
                title={t("games.lastPage")}
                aria-label={t("games.lastPage")}
                className="flex items-center rounded-lg border border-line bg-panel px-2 py-1.5 text-ink2 transition-colors hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronsRight size={15} />
              </button>
            </div>
          </div>
        )}
        </div>

        {/* Mobil liegt das Detail nicht unter der Liste, sondern kommt auf
            Tipp als Blatt darüber · siehe unten. */}
        {!mobile && selected && (
          <div className="flex flex-col gap-4">
            <Card pad={false}>
              {/* Brett mit beiden Namen und Elo-Zahlen, analog zur Analyse. */}
              <div className="p-4 pb-3">{detailBoard}</div>
              <div className="border-t border-line px-4 py-3">{detailFacts}</div>
            </Card>

            <Card title={t("games.notes")}>{detailNotes}</Card>
          </div>
        )}
      </div>

      {importSheet}

      {/* Filterblatt · mobil ersetzt es die beiden Chip-Reihen über der Liste.
          Es schließt nicht bei jeder Auswahl: Quelle und Ergebnis werden oft
          zusammen gesetzt, und die Trefferzahl im Kopf zeigt sofort, was die
          Auswahl übrig lässt. */}
      {mobile && filterOpen && (
        <MobileSheet
          testId="games-filter-sheet"
          ariaLabel={t("games.filters")}
          onClose={() => setFilterOpen(false)}
          title={
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
              <SlidersHorizontal size={15} className="text-accent" />
              {t("games.filters")}
            </div>
          }
          subtitle={
            <div className="mt-1 text-[11.5px] tabular-nums text-ink3">
              {t("games.filterMatches", { n: deInt(totalResults) })}
            </div>
          }
          footer={
            <div className="flex items-center justify-between gap-2 px-1">
              <button
                onClick={clearAllFilters}
                disabled={activeFilters.length === 0}
                className="rounded-lg px-2 py-2 text-[12.5px] text-ink3 transition-colors hover:text-accent disabled:opacity-35 disabled:hover:text-ink3"
              >
                {t("games.clearAll")}
              </button>
              <Button primary onClick={() => setFilterOpen(false)}>
                {t("common.done")}
              </Button>
            </div>
          }
        >
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-ink3">
              {t("games.colSource")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">{sourceChips}</div>
          </div>
          <div className="border-t border-line px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-ink3">
              {t("games.colResult")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">{resultChips}</div>
          </div>
          {exactFilters.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink3">
                {t("games.filterExact")}
              </div>
              <div className="flex flex-wrap gap-2">
                {exactFilters.map((filter) => (
                  <span
                    key={filter.key}
                    className="flex items-center gap-1.5 rounded-full border border-accent-dim bg-accent-soft py-1 pl-3 pr-1.5 text-[12px] text-accent"
                  >
                    {filter.label}
                    <button
                      onClick={filter.clear}
                      aria-label={t("games.clearFilter")}
                      className="rounded-full p-0.5 text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </MobileSheet>
      )}

      {/* Detailblatt · mobil die einzige Stelle, an der Brett, Kennzahlen und
          Notizen zu sehen sind. Gewischt wird über die ganze Trefferliste. */}
      {mobile && sheetOpen && selected && (
        <MobileSheet
          testId="game-detail-sheet"
          ariaLabel={t("games.detailTitle")}
          scrollKey={selected.id}
          onClose={() => setSheetOpen(false)}
          onPrev={canPrev ? () => stepGame(-1) : undefined}
          onNext={canNext ? () => stepGame(1) : undefined}
          title={
            <div className="flex items-center gap-2">
              <ResultBadge result={selected.result} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                {selected.opponent} <span className="font-normal text-ink3">({selected.oppElo})</span>
              </span>
            </div>
          }
          subtitle={
            <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ink3">
              <SourceBadge source={selected.source} />
              <span className="min-w-0 flex-1 truncate">{selected.tc} · {selected.date}</span>
            </div>
          }
          /* Die Genauigkeit stand bisher als nackte Zahl am Ende der
             Untertitelzeile, wo sie mit Modus und Datum um denselben Platz
             stritt. Als beschrifteter Block rechts im Kopf hat sie eine feste
             Kante und ist auf einen Blick als Kennzahl zu lesen. */
          headerRight={
            <div className="rounded-lg border border-line bg-panel2 px-2.5 py-1">
              <div className="text-[9.5px] font-medium uppercase tracking-wider text-ink3">
                {t("games.colAccuracy")}
              </div>
              <div className="text-[14px] font-semibold leading-tight tabular-nums text-ink">
                {selected.accuracy != null ? `${de(selected.accuracy)} %` : "—"}
              </div>
            </div>
          }
          footer={
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => stepGame(-1)}
                disabled={!canPrev}
                aria-label={t("games.prevGame")}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] text-ink2 transition-colors hover:text-accent disabled:opacity-35 disabled:hover:text-ink2"
              >
                <ChevronLeft size={16} /> {t("games.prev")}
              </button>
              <span className="shrink-0 text-[11.5px] tabular-nums text-ink3">
                {`${deInt(globalIndex)} / ${deInt(totalResults)}`}
              </span>
              <button
                onClick={() => stepGame(1)}
                disabled={!canNext}
                aria-label={t("games.nextGame")}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-[12.5px] text-ink2 transition-colors hover:text-accent disabled:opacity-35 disabled:hover:text-ink2"
              >
                {t("games.next")} <ChevronRight size={16} />
              </button>
            </div>
          }
        >
          {/* Auf niedrigen Geräten bekommt das Brett nur so viel Breite, wie
              es an Höhe geben darf · sonst steht es angeschnitten da und die
              Kennzahlen darunter wären erst nach einer Wischbewegung zu sehen.
              Auf üblichen Telefonhöhen bleibt es die volle Blattbreite. */}
          <div
            className="mx-auto px-4 pt-4"
            style={{ maxWidth: "min(100%, max(13rem, calc(100vh - 25.5rem)))" }}
          >
            {detailBoard}
          </div>
          <div className="mt-3 border-t border-line px-4 py-3">{detailFacts}</div>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 text-[13px] font-medium text-ink2">{t("games.notes")}</div>
            {detailNotes}
          </div>
        </MobileSheet>
      )}

      {deleteConfirmOpen && selected?.dbId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-game-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setDeleteConfirmOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-loss-soft text-loss">
                <AlertTriangle size={18} />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">Kiebitz</div>
                <h2 id="delete-game-title" className="text-[16px] font-semibold">{t("games.deleteTitle")}</h2>
              </div>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-ink2">
              {t("games.deleteConfirm", { opponent: selected.opponent })}
            </p>
            <div className="flex justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
              <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>{t("common.cancel")}</Button>
              <button
                type="button"
                disabled={deleting}
                onClick={deleteSelected}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-loss-dim bg-loss-soft px-3.5 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:border-loss disabled:opacity-45"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? t("games.deleting") : t("games.deleteConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
