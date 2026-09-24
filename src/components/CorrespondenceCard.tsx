/**
 * Fernschach auf dem Start · die laufenden Daily-Partien, wer am Zug ist und
 * wie lange noch.
 *
 * Die Karte erscheint nur, wenn es laufende Partien gibt: Wer kein Fernschach
 * spielt, soll dafür keinen leeren Kasten sehen. Oben stehen die Partien, in
 * denen man selbst am Zug ist, darunter nach der nächsten Frist · das ist die
 * Reihenfolge, in der man sie abarbeitet.
 *
 * „Analysieren" öffnet die Partie am freien Brett, samt der Züge bis jetzt,
 * wo die Plattform sie mitliefert. Gerechnet wird dort wie an jeder anderen
 * Stellung; Kiebitz zieht nicht selbst, das bleibt der Plattform.
 */
import { useCallback, useEffect, useState } from "react";
import { Clock, ExternalLink, Mail, Microscope, RefreshCw } from "lucide-react";
import { Button, Card } from "./ui";
import { useI18n } from "../lib/i18n";
import { loadOngoing, timeLeft, type OngoingGame } from "../lib/correspondence";
import { openExternal } from "../lib/ext";
import { deInt } from "../lib/format";

export interface CorrespondenceLine {
  fen: string;
  sans: string[];
  chess960: boolean;
}

export default function CorrespondenceCard({
  ccUser,
  liUser,
  openLine,
  className = "",
}: {
  ccUser: string;
  liUser: string;
  openLine: (line: CorrespondenceLine) => void;
  className?: string;
}) {
  const { t } = useI18n();
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

  return (
    <Card
      className={className}
      title={t("corr.title")}
      action={
        <Button
          compact
          onClick={() => reload()}
          title={t("corr.refresh")}
          label={t("corr.refresh")}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      }
    >
      <p className="mb-3 flex items-center gap-2 text-[12.5px] text-ink3">
        <Mail size={14} className="text-accent" />
        {t("corr.summary", { n: deInt(games.length), m: deInt(myTurn) })}
      </p>
      {failed && <p className="mb-2 text-[12px] text-loss">{t("corr.failed")}</p>}
      <ul className="flex flex-col divide-y divide-line">
        {games.map((game) => {
          const left = timeLeft(game.deadline);
          const urgent = game.myTurn && left != null && left.unit !== "d";
          return (
            <li key={`${game.source}-${game.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${game.myTurn ? "bg-accent" : "bg-line2"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {game.opponent}
                  {game.opponentRating ? (
                    <span className="ml-1 font-normal text-ink3">({game.opponentRating})</span>
                  ) : null}
                  {game.variant === "chess960" && (
                    <span className="ml-1.5 rounded bg-panel3 px-1.5 py-0.5 text-[10.5px] font-normal text-ink2">960</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink3">
                  <span className={game.myTurn ? "text-accent" : ""}>
                    {t(game.myTurn ? "corr.yourMove" : "corr.theirMove")}
                  </span>
                  <span>· {game.source}</span>
                  {left && (
                    <span className={`inline-flex items-center gap-1 ${urgent ? "text-loss" : ""}`}>
                      · <Clock size={11} /> {t(`corr.left.${left.unit}`, { n: left.value })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  compact
                  onClick={() =>
                    openLine({ fen: game.startFen, sans: game.sans, chess960: game.variant === "chess960" })
                  }
                  title={t("corr.analyze")}
                >
                  <Microscope size={14} /> {t("corr.analyze")}
                </Button>
                <Button
                  compact
                  onClick={() => openExternal(game.url)}
                  title={t("corr.open", { site: game.source })}
                  label={t("corr.open", { site: game.source })}
                >
                  <ExternalLink size={14} />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
