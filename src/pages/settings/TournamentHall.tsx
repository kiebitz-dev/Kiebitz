/**
 * Der Turniersaal · ein laufendes Engine-Turnier als eigene Ebene über der App.
 *
 * In den Einstellungen war das Turnier eine Zeile Text („A – B, Zug 23") und
 * eine Tabelle darunter. Das ist, was man wissen muss, aber nicht, was man
 * sehen will: Wer zwei Engines gegeneinander antreten lässt, will ihnen beim
 * Spielen zusehen. Deshalb liegen hier alle Bretter nebeneinander, an denen
 * gerade gespielt wird, daneben die Tabelle und darunter jede fertige Partie
 * mit ihrer Schlussstellung.
 *
 * Die Ebene liegt auf einem unscharfen Schleier über der Seite, wie das
 * Fokus-Brett (components/FocusBoard.tsx). Schließen beendet das Turnier
 * nicht · es läuft im Backend weiter, und die Einstellungen führen wieder
 * hierher zurück.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, Square, Trophy, X } from "lucide-react";
import { Button } from "../../components/ui";
import { DiagrammFelder } from "../../components/blatt/Diagramm";
import { useI18n, type Key } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import { points, type LiveBoard, type PlayedGame, type TournamentStatus } from "../../lib/tournament";

/** Gründe, die das Backend meldet · alles andere bleibt ohne Zusatz. */
export const REASON_KEY: Record<string, Key> = {
  mate: "end.reason.mate",
  stalemate: "end.reason.stalemate",
  insufficient: "end.reason.insufficient",
  fifty: "end.reason.fifty",
  repetition: "end.reason.repetition",
  invalidMove: "tn.reasonInvalid",
  engineError: "tn.reasonEngine",
  adjudicated: "tn.reasonAdjudicated",
};

const resultText = (result: string) => result.replace("1/2-1/2", "½–½");

/** Felder des letzten Zuges · `e1g1` wird zu e1 und g1. */
function lastMoveSquares(uci: string): string[] {
  return uci.length >= 4 ? [uci.slice(0, 2), uci.slice(2, 4)] : [];
}

/** Ein Spieler am Brett · der Punkt pulsiert, solange diese Seite rechnet. */
function PlayerLine({ name, white, thinking }: { name: string; white: boolean; thinking: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
      <span
        aria-hidden
        className="inline-block size-2.5 flex-none rounded-full border border-line2"
        style={{ background: white ? "#f4f1ea" : "#1f1f1f" }}
      />
      <span className={`min-w-0 flex-1 truncate ${thinking ? "font-semibold text-ink" : "text-ink2"}`}>{name}</span>
      {thinking && (
        <span aria-hidden className="size-2 flex-none animate-pulse rounded-full bg-accent" />
      )}
    </div>
  );
}

function LiveBoardTile({ board }: { board: LiveBoard }) {
  const { t } = useI18n();
  const whiteToMove = board.fen.split(" ")[1] !== "b";
  return (
    <figure
      data-testid="tournament-board"
      className="tournament-tile flex min-w-0 flex-col gap-2 rounded-xl border border-line2 bg-panel2 p-3"
    >
      <figcaption className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-ink3">
        <span className="font-semibold text-accent">{t("tn.boardNo", { n: board.board })}</span>
        <span>
          {t("tn.roundNo", { n: board.round })} · {t("corr.moveNo", { n: deInt(Math.max(1, Math.ceil(board.plies / 2))) })}
        </span>
      </figcaption>
      <PlayerLine name={board.black} white={false} thinking={!whiteToMove} />
      <div className="aspect-square w-full overflow-hidden rounded-md border border-line2">
        <DiagrammFelder fen={board.fen} live highlight={lastMoveSquares(board.lastMove)} />
      </div>
      <PlayerLine name={board.white} white thinking={whiteToMove} />
    </figure>
  );
}

function FinishedTile({ game }: { game: PlayedGame }) {
  const { t } = useI18n();
  const reason = REASON_KEY[game.reason] ? t(REASON_KEY[game.reason]) : "";
  return (
    <li className="flex min-w-0 flex-col gap-1" title={`${game.white} – ${game.black} · ${resultText(game.result)}${reason ? ` · ${reason}` : ""}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded-md border border-line">
        {game.fen ? <DiagrammFelder fen={game.fen} live /> : <div className="size-full bg-panel3" />}
        <span className="absolute bottom-1 end-1 rounded bg-overlay px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink shadow">
          {resultText(game.result)}
        </span>
      </div>
      <div className="truncate text-[11px] text-ink2">
        {game.white} – {game.black}
      </div>
    </li>
  );
}

export default function TournamentHall({
  status,
  onClose,
  onStop,
  onSavePgn,
}: {
  status: TournamentStatus;
  onClose: () => void;
  onStop: () => void;
  onSavePgn: () => void;
}) {
  const { t, locale } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const running = status.running;
  const progress = status.total > 0 ? status.played / status.total : 0;
  // Die meisten Partien, die eine Engine spielen kann · daran misst sich der
  // Balken hinter den Punkten.
  const perEngine = status.standings.length > 1 ? (status.total * 2) / status.standings.length : 1;
  const finished = [...status.games].reverse();
  const medal = ["text-gold", "text-ink2", "text-[#b0764a]"];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("tn.title")}
      data-testid="tournament-hall"
      className="tournament-hall fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-[6px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="tournament-hall-panel relative flex max-h-full w-full max-w-[1320px] flex-col overflow-hidden border-line2 bg-panel shadow-2xl shadow-black/50 sm:rounded-2xl sm:border">
        {/* Ein Hauch Gold hinter dem Kopf · der Saal, nicht der Einstellungsdialog. */}
        <div aria-hidden className="tournament-hall-glow pointer-events-none absolute inset-x-0 top-0 h-40" />

        <header className="relative flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-gold-soft text-gold">
            <Trophy size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-tight">{t("tn.title")}</h2>
              {running ? (
                <span className="flex items-center gap-1.5 rounded-full bg-loss-soft px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-widest text-loss">
                  <span className="size-1.5 animate-pulse rounded-full bg-loss" /> {t("tn.live")}
                </span>
              ) : (
                status.games.length > 0 && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
                    {status.cancelled ? t("tn.stopped") : t("tn.done")}
                  </span>
                )
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-panel3">
                <div
                  className="tournament-progress h-full rounded-full"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-ink3">
                {t("tn.progress", { played: deInt(status.played), total: deInt(status.total) })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.games.length > 0 && (
              <Button compact onClick={onSavePgn} title={t("tn.savePgn")} label={t("tn.savePgn")}>
                <Download size={14} />
              </Button>
            )}
            {running && (
              <Button onClick={onStop}>
                <Square size={13} /> {t("tn.stop")}
              </Button>
            )}
            <Button compact onClick={onClose} title={t("common.close")} label={t("common.close")}>
              <X size={16} />
            </Button>
          </div>
        </header>

        <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 min-[1000px]:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            {status.error && (
              <p className="mb-4 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
                {status.error}
              </p>
            )}
            {status.boards.length > 0 ? (
              <div
                className={`grid gap-4 ${
                  status.boards.length === 1
                    ? "mx-auto max-w-[440px] grid-cols-1"
                    : "grid-cols-[repeat(auto-fit,minmax(220px,1fr))]"
                }`}
              >
                {status.boards.map((board) => (
                  <LiveBoardTile key={board.board} board={board} />
                ))}
              </div>
            ) : (
              running && <p className="py-10 text-center text-[13px] text-ink3">{t("tn.setting")}</p>
            )}

            {finished.length > 0 && (
              <div className={status.boards.length > 0 ? "mt-6" : ""}>
                <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink3">{t("tn.played")}</h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                  {finished.map((game, index) => (
                    <FinishedTile key={finished.length - index} game={game} />
                  ))}
                </ul>
              </div>
            )}
          </section>

          <aside className="min-w-0">
            <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink3">{t("tn.standings")}</h3>
            <ol className="flex flex-col gap-1.5">
              {status.standings.map((row, index) => (
                <li
                  key={row.name}
                  className="relative overflow-hidden rounded-lg border border-line bg-panel2 px-3 py-2"
                >
                  <div
                    aria-hidden
                    className="tournament-progress-bar absolute inset-y-0 start-0 bg-accent-soft"
                    style={{ width: `${Math.min(100, (row.halfPoints / 2 / perEngine) * 100)}%` }}
                  />
                  <div className="relative flex items-center gap-2 text-[13px]">
                    <span className={`w-5 text-center font-semibold tabular-nums ${medal[index] ?? "text-ink3"}`}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                    <span className="font-semibold tabular-nums">{points(row.halfPoints, locale)}</span>
                  </div>
                  <div className="relative mt-0.5 ps-7 text-[11px] tabular-nums text-ink3">
                    <span className="text-win">+{row.wins}</span> <span>={row.draws}</span>{" "}
                    <span className="text-loss">−{row.losses}</span>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}
