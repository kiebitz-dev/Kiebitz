/**
 * Der Turniersaal im Diagramm-Modus · ein Bogen aus dem Turnierbuch.
 *
 * Die gewöhnliche Fassung (pages/settings/TournamentHall.tsx) ist ein Saal:
 * Goldschimmer, Kacheln mit gerundeten Brettern, ein Verlaufsbalken, Punkte
 * als Farbbalken. Im Blatt wird daraus, was ein Turnierbuch an derselben
 * Stelle druckt, und zwar mit denselben Angaben:
 *
 * · Der Kopf ist ein Kolumnentitel · Titel, der Stand in Worten, rechts der
 *   Zustand, darunter die kräftige Linie. Der Fortschritt ist ein `Balken` aus
 *   Haarlinie und Tinte statt eines Verlaufs.
 * · Jedes laufende Brett ist ein gedrucktes Diagramm mit Bildunterschrift:
 *   Brett und Runde als Nummer, die Paarung als Titel, der Zug kursiv, und
 *   darunter, wer am Zug ist · das Gegenstück zum pulsierenden Punkt.
 * · Die Tabelle ist eine Tabelle (Rang, Engine, +, =, −, Punkte) und kein
 *   Stapel Farbbalken · Ränge, nicht Balken, wie überall im Modus.
 * · Die gespielten Partien sind Zeilen im Turnierbuch statt Kacheln. Die
 *   Schlussstellung, die die Kachel zeigte, liegt hinter der Zeile: Ein Tipp
 *   deckt sie als Diagramm auf. So kostet der Modus die Stellung nicht, und
 *   eine lange Liste bleibt trotzdem eine Liste.
 *
 * Gerechnet wird nichts, was nicht im Stand vom Backend steht. Schleier,
 * Escape und Portal gehören der gewöhnlichen Fassung, die dieses Blatt lädt.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import { Balken, Blatttabelle, Farbfeld, Rubrik, Schalterreihe } from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import {
  REASON_KEY,
  lastMoveSquares,
  points,
  resultText,
  type LiveBoard,
  type PlayedGame,
  type TournamentStatus,
} from "../../lib/tournament";

/** Koordinatenspalte der kleinen Diagramme · wie bei den Fernpartien. */
const GUTTER = 13;

/** Wer am Zug ist · aus der Stellung, nicht aus einem zweiten Feld. */
const amZug = (fen: string): "white" | "black" => (fen.split(" ")[1] === "b" ? "black" : "white");

function Brett({ board }: { board: LiveBoard }) {
  const { t } = useI18n();
  const farbe = amZug(board.fen);
  return (
    <figure data-testid="tournament-board" className="min-w-0">
      <Diagramm fen={board.fen} gutter={GUTTER} highlight={lastMoveSquares(board.lastMove)} />
      <Bildunterschrift
        nummer={`${t("tn.boardNo", { n: board.board })} · ${t("tn.roundNo", { n: board.round })}`}
        gutter={GUTTER}
        zeilen={[
          <span key="paarung">
            {board.white} – {board.black}
          </span>,
          <span key="zug">{t("corr.moveNo", { n: deInt(Math.max(1, Math.ceil(board.plies / 2))) })}</span>,
        ]}
        amZug={{ farbe, text: farbe === "white" ? board.white : board.black }}
      />
    </figure>
  );
}

/**
 * Eine gespielte Partie als Zeile · Runde, Weiß, Schwarz, Ergebnis, Züge.
 * Die ganze Zeile ist der Griff, der die Schlussstellung aufdeckt.
 */
function Partiezeile({
  game,
  offen,
  onUmschalten,
  letzte,
}: {
  game: PlayedGame;
  offen: boolean;
  onUmschalten: () => void;
  letzte: boolean;
}) {
  const { t } = useI18n();
  const grund = REASON_KEY[game.reason] ? t(REASON_KEY[game.reason]) : "";
  return (
    <li className={letzte && !offen ? "" : "border-b border-line"}>
      <button
        type="button"
        onClick={onUmschalten}
        disabled={!game.fen}
        aria-expanded={game.fen ? offen : undefined}
        title={grund || undefined}
        className="flex min-h-11 w-full items-center gap-2.5 text-start text-[12.5px] disabled:cursor-default"
      >
        <span className="blatt-zahl w-8 flex-none text-ink3">{deInt(game.round)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Farbfeld farbe="white" />
          <span className="min-w-0 truncate text-ink">{game.white}</span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Farbfeld farbe="black" />
          <span className="min-w-0 truncate text-ink">{game.black}</span>
        </span>
        <span className="blatt-zahl w-14 flex-none text-end text-[13px] font-medium text-ink">
          {resultText(game.result)}
        </span>
        <span className="blatt-zahl hidden w-12 flex-none text-end text-ink3 min-[640px]:block">
          {deInt(Math.ceil(game.plies / 2))}
        </span>
      </button>
      {offen && game.fen && (
        <div className="flex justify-center pb-4 pt-1">
          <div className="w-full max-w-[260px]">
            <Diagramm fen={game.fen} gutter={GUTTER} />
            <Bildunterschrift
              nummer={t("blatt.finalPosition")}
              gutter={GUTTER}
              zeilen={[
                <span key="paarung">
                  {game.white} – {game.black} · {resultText(game.result)}
                </span>,
                ...(grund ? [<span key="grund">{grund}</span>] : []),
              ]}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export default function TurnierBlatt({
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
  /** Die Partie, deren Schlussstellung aufgedeckt ist · gezählt ab der ersten. */
  const [offen, setOffen] = useState<number | null>(null);

  const running = status.running;
  const progress = status.total > 0 ? status.played / status.total : 0;
  // Die neueste zuerst, wie in der gewöhnlichen Fassung · die Nummer bleibt
  // die der Partie, damit eine neue Zeile die aufgedeckte nicht verschiebt.
  const gespielt = status.games.map((game, index) => ({ game, nummer: index })).reverse();
  const zustand = running ? t("tn.live") : status.games.length > 0 ? (status.cancelled ? t("tn.stopped") : t("tn.done")) : null;

  const schalter = [
    ...(running ? [{ label: t("tn.stop"), onClick: onStop }] : []),
    ...(status.games.length > 0 ? [{ label: t("tn.savePgn"), onClick: onSavePgn, betont: !running }] : []),
  ];

  return (
    <div
      data-blatt=""
      className="tournament-hall-panel relative flex max-h-full w-full max-w-[1320px] flex-col overflow-hidden bg-bg shadow-2xl shadow-black/50 sm:border sm:border-ink"
    >
      {/* Kolumnentitel · Titel und Stand links, Zustand und Schließen rechts. */}
      <header className="shrink-0 px-5 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <span className="blatt-kolumne shrink-0 text-ink3">{t("tn.title")}</span>
            <span className="buch min-w-0 truncate text-[13px] italic text-ink2">
              {t("tn.progress", { played: deInt(status.played), total: deInt(status.total) })}
            </span>
          </div>
          {status.total > 0 && (
            <span className="hidden w-[140px] flex-none min-[640px]:block">
              <Balken anteil={progress * 100} hoehe={6} />
            </span>
          )}
          {zustand && (
            <span className={`blatt-kolumne flex flex-none items-center gap-1.5 ${running ? "text-loss" : "text-ink3"}`}>
              {running && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-loss" />}
              {zustand}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            className="-me-2 flex-none p-2 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-1 h-px bg-ink" />
      </header>

      {schalter.length > 0 && (
        <div className="shrink-0 px-5 pt-3">
          <Schalterreihe eintraege={schalter} />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-8 gap-y-6 overflow-y-auto px-5 pb-5 pt-4 min-[1000px]:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          {status.error && (
            <p className="mb-4 border-s-2 border-loss ps-3 text-[12.5px] text-loss">{status.error}</p>
          )}
          {status.boards.length > 0 ? (
            <div
              className={`grid gap-x-6 gap-y-6 ${
                status.boards.length === 1
                  ? "mx-auto max-w-[420px] grid-cols-1"
                  : "grid-cols-[repeat(auto-fit,minmax(200px,1fr))]"
              }`}
            >
              {status.boards.map((board) => (
                <Brett key={board.board} board={board} />
              ))}
            </div>
          ) : (
            running && <p className="buch py-10 text-center text-[14px] italic text-ink3">{t("tn.setting")}</p>
          )}

          {gespielt.length > 0 && (
            <div className={status.boards.length > 0 ? "mt-8" : ""}>
              <Rubrik>{t("tn.played")}</Rubrik>
              {/* Die Spaltenköpfe stehen in denselben Breiten wie die Zeilen darunter. */}
              <div aria-hidden className="flex items-baseline gap-2.5 border-b border-line pb-[5px] pt-2 text-ink3">
                <span className="blatt-feld w-8 flex-none">{t("tn.colRound")}</span>
                <span className="blatt-feld min-w-0 flex-1 truncate">{t("common.white")}</span>
                <span className="blatt-feld min-w-0 flex-1 truncate">{t("common.black")}</span>
                <span className="blatt-feld w-14 flex-none text-end">{t("blatt.result")}</span>
                <span className="blatt-feld hidden w-12 flex-none text-end min-[640px]:block">{t("blatt.moves")}</span>
              </div>
              <ol>
                {gespielt.map(({ game, nummer }, index) => (
                  <Partiezeile
                    key={nummer}
                    game={game}
                    offen={offen === nummer}
                    onUmschalten={() => setOffen(offen === nummer ? null : nummer)}
                    letzte={index === gespielt.length - 1}
                  />
                ))}
              </ol>
            </div>
          )}
        </section>

        <aside className="min-w-0">
          <Rubrik>{t("tn.standings")}</Rubrik>
          <div className="mt-2">
            <Blatttabelle
              hoehe={34}
              spalten={[
                { label: "#", breite: 18, zahl: true, blass: true },
                { label: t("tn.engine") },
                { label: "+", breite: 22, zahl: true, rechts: true },
                { label: "=", breite: 22, zahl: true, rechts: true },
                { label: "−", breite: 22, zahl: true, rechts: true },
                { label: t("tn.points"), breite: 44, zahl: true, rechts: true },
              ]}
              zeilen={status.standings.map((row, index) => [
                deInt(index + 1),
                <span key="name" className={index === 0 && status.played > 0 ? "font-semibold" : undefined}>
                  {row.name}
                </span>,
                deInt(row.wins),
                deInt(row.draws),
                deInt(row.losses),
                <span key="punkte" className="text-[13.5px] font-medium">
                  {points(row.halfPoints, locale)}
                </span>,
              ])}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
