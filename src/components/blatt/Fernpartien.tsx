/**
 * Die laufenden Fernpartien im Diagramm-Modus · eine Reihe nummerierter
 * Diagramme, wie sie im Buch unter „Stellungen zum Nachdenken" stehen.
 *
 * Jede Partie ist ein Abdruck der Stellung jetzt, aus der eigenen Sicht, mit
 * der Bildunterschrift darunter: Gegner, Plattform und Frist, und wer am Zug
 * ist · das Kästchen der Farbe wie unter jedem Diagramm. Die Partien, in denen
 * man selbst ziehen muss, stehen vorn (die Reihenfolge kommt aus
 * lib/correspondence.ts). Das ganze Diagramm ist der Griff zur Partie auf der
 * Plattform; in die Analyse führt es nicht, weil die Partie noch läuft.
 *
 * Geladen wird in components/CorrespondenceCard.tsx · diese Datei setzt nur.
 */
import { Rubrik } from "./Satz";
import { Bildunterschrift, Diagramm } from "./Diagramm";
import { useI18n } from "../../lib/i18n";
import { openExternal } from "../../lib/ext";
import { deInt } from "../../lib/format";
import { deadlineOf, type OngoingGame } from "../../lib/correspondence";

/** Kantenlänge eines Diagramms auf dem Rechner · mobil nimmt es die halbe Spalte. */
const KANTE = 168;

export default function Fernpartien({
  games,
  mobile,
  summary,
  loading,
  failed,
  onReload,
  className = "",
}: {
  games: OngoingGame[];
  mobile: boolean;
  summary: string;
  loading: boolean;
  failed: boolean;
  onReload: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const gutter = mobile ? 13 : 15;

  return (
    <section className={className}>
      <Rubrik weg={loading ? "…" : t("corr.refresh")} onWeg={loading ? undefined : onReload}>
        {t("corr.title")}
      </Rubrik>
      <p className="buch mt-2 text-[13px] italic text-ink2">{summary}</p>
      {failed && <p className="mt-2 text-[12.5px] text-loss">{t("corr.failed")}</p>}
      <ol
        className={
          mobile
            ? "mt-3 grid grid-cols-2 gap-x-4 gap-y-5"
            : "mt-4 flex flex-wrap gap-x-9 gap-y-6"
        }
      >
        {games.map((game, index) => {
          const deadline = deadlineOf(game, t);
          const amZug: "white" | "black" = game.fen.split(" ")[1] === "b" ? "black" : "white";
          return (
            <li key={`${game.source}-${game.id}`} className="min-w-0">
              <button
                type="button"
                onClick={() => openExternal(game.url)}
                title={t("corr.open", { site: game.source })}
                className={`block w-full text-start transition-opacity ${
                  game.myTurn ? "hover:opacity-80" : "opacity-50 hover:opacity-90 focus-visible:opacity-90"
                }`}
                style={mobile ? undefined : { width: KANTE + gutter }}
              >
                <Diagramm
                  fen={game.fen}
                  size={mobile ? undefined : KANTE}
                  gutter={gutter}
                  orientation={game.myColor}
                />
                <Bildunterschrift
                  nummer={t("corr.number", { n: deInt(index + 1) })}
                  gutter={gutter}
                  breite={mobile ? undefined : KANTE}
                  zeilen={[
                    <span key="gegner" className={game.myTurn ? "text-accent" : undefined}>
                      {game.opponent}
                      {game.opponentRating ? ` (${game.opponentRating})` : ""}
                    </span>,
                    <span key="neben">
                      {game.source}
                      {game.variant === "chess960" && " · 960"}
                      {" · "}
                      {t("corr.moveNo", { n: deInt(game.moveNumber) })}
                      {deadline && (
                        <>
                          {" · "}
                          <span className={deadline.urgent ? "text-loss" : undefined}>{deadline.text}</span>
                        </>
                      )}
                    </span>,
                  ]}
                  amZug={{ farbe: amZug, text: t(game.myTurn ? "corr.yourMove" : "corr.theirMove") }}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
