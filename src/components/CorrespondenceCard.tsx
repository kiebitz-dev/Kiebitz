/**
 * Fernschach auf dem Start · die laufenden Daily-Partien, wer am Zug ist und
 * wie lange noch.
 *
 * Die Karte erscheint nur, wenn es laufende Partien gibt: Wer kein Fernschach
 * spielt, soll dafür keinen leeren Kasten sehen. Vorn stehen die Partien, in
 * denen man selbst am Zug ist, dahinter nach der nächsten Frist · das ist die
 * Reihenfolge, in der man sie abarbeitet.
 *
 * Fernschach wurde auf Postkarten gespielt, und so steht jede Partie hier:
 * eine Karte mit der Stellung jetzt, aus der eigenen Sicht, dem Gegner als
 * Empfänger und der Frist als Poststempel. Die Karten, auf die man antworten
 * muss, tragen die Akzentkante. Ein Tipp führt zur Partie auf der Plattform.
 *
 * Kein Weg in die Analyse: Die Engine an eine Stellung zu setzen, in der man
 * noch selbst zieht, wäre Schummeln. Im Diagramm-Modus setzt `Fernpartien`
 * (components/blatt/) dieselben Partien als nummerierte Buchdiagramme · Laden
 * und Reihenfolge bleiben hier.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button, Card } from "./ui";
import { DiagrammFelder } from "./blatt/Diagramm";
import { useI18n } from "../lib/i18n";
import { useDiagramMode } from "../lib/diagramMode";
import { deadlineOf, loadOngoing, type OngoingGame } from "../lib/correspondence";
import { openExternal } from "../lib/ext";
import { deInt } from "../lib/format";

const Fernpartien = lazy(() => import("./blatt/Fernpartien"));

/** Eine Partie als Postkarte · Stellung, Empfänger, Poststempel. */
function Postkarte({ game }: { game: OngoingGame }) {
  const { t } = useI18n();
  const deadline = deadlineOf(game, t);
  const site = t("corr.open", { site: game.source });
  return (
    <button
      type="button"
      onClick={() => openExternal(game.url)}
      title={site}
      aria-label={`${game.opponent} · ${t(game.myTurn ? "corr.yourMove" : "corr.theirMove")} · ${site}`}
      className={`group relative flex w-full min-w-0 flex-col rounded-xl border p-2.5 text-start transition-colors ${
        game.myTurn
          ? "border-accent bg-accent-soft/40 hover:bg-accent-soft"
          : "border-line bg-panel2 hover:border-line2 hover:bg-panel3"
      }`}
    >
      <div className="mb-2 flex min-h-9 items-start justify-between gap-2">
        <div className="min-w-0 pt-0.5">
          <div className="truncate text-[10.5px] uppercase tracking-wide text-ink3">
            {game.source}
            {game.variant === "chess960" && " · 960"}
          </div>
          <div className="truncate text-[11.5px] text-ink3">{t("corr.moveNo", { n: deInt(game.moveNumber) })}</div>
        </div>
        {/* Der Poststempel · Frist statt Datum, schräg aufgedrückt. */}
        {deadline && (
          <span
            className={`flex size-11 shrink-0 -rotate-[10deg] items-center justify-center rounded-full border-[1.5px] border-dashed px-1 text-center text-[9.5px] font-semibold uppercase leading-tight ${
              deadline.urgent ? "border-loss text-loss" : game.myTurn ? "border-accent text-accent" : "border-line2 text-ink3"
            }`}
          >
            {deadline.text}
          </span>
        )}
      </div>
      <div className="aspect-square w-full overflow-hidden rounded-md">
        <DiagrammFelder fen={game.fen} orientation={game.myColor} live />
      </div>
      <div className="mt-2 flex min-w-0 items-baseline gap-1 text-[13px] font-medium text-ink">
        <span className="truncate">{game.opponent}</span>
        {game.opponentRating ? <span className="shrink-0 font-normal text-ink3">({game.opponentRating})</span> : null}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <span className={game.myTurn ? "font-medium text-accent" : "text-ink3"}>
          {t(game.myTurn ? "corr.yourMove" : "corr.theirMove")}
        </span>
        <ExternalLink size={12} className="shrink-0 text-ink3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </button>
  );
}

export default function CorrespondenceCard({
  ccUser,
  liUser,
  mobile = false,
  className = "",
}: {
  ccUser: string;
  liUser: string;
  /** Telefonbreite · nur das Blatt setzt sich danach um. */
  mobile?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const diagramMode = useDiagramMode();
  const [games, setGames] = useState<OngoingGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    (signal?: AbortSignal) => {
      if (!ccUser.trim() && !liUser.trim()) return;
      setLoading(true);
      loadOngoing({ ccUser, liUser }, signal)
        .then((result) => {
          if (signal?.aborted) return;
          setGames(result.games);
          setFailed(result.errors.length > 0 && result.games.length === 0);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [ccUser, liUser]
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  // Keine laufenden Partien, keine Karte · auch nicht als leerer Kasten.
  if (!games || games.length === 0) return null;

  const myTurn = games.filter((game) => game.myTurn).length;
  const summary = t("corr.summary", { n: deInt(games.length), m: deInt(myTurn) });

  if (diagramMode) {
    return (
      <Suspense fallback={null}>
        <Fernpartien
          games={games}
          mobile={mobile}
          summary={summary}
          loading={loading}
          failed={failed}
          onReload={() => reload()}
          className={className}
        />
      </Suspense>
    );
  }

  return (
    <Card
      className={className}
      title={t("corr.title")}
      action={
        <div className="flex items-center gap-2">
          <span className="hidden text-[12px] text-ink3 sm:inline">{summary}</span>
          <Button
            compact
            onClick={() => reload()}
            title={t("corr.refresh")}
            label={t("corr.refresh")}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-[12px] text-ink3 sm:hidden">{summary}</p>
      {failed && <p className="mb-2 text-[12px] text-loss">{t("corr.failed")}</p>}
      {/* Schmal ein Stapel zum Durchwischen, breit ein Raster · eine Karte in
          voller Breite wäre auf dem Telefon ein zweites Analysebrett. */}
      <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:overflow-visible sm:px-0">
        {games.map((game) => (
          <li key={`${game.source}-${game.id}`} className="flex w-[156px] min-w-0 shrink-0 snap-start sm:w-auto">
            <Postkarte game={game} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
