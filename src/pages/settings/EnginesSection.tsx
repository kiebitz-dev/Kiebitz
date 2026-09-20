/**
 * Mehrere Engines · Verwaltung und Turnier.
 *
 * Kiebitz rechnet mit einer Engine, und das bleibt so: Analyse, Live-Brett und
 * Trainer benutzen die eine Engine aus dem Abschnitt darüber. Wer aber eine
 * zweite ausprobiert, will zwei Dinge — schnell umschalten, welche rechnet,
 * und wissen, welche stärker ist. Beides steht deshalb hier und nicht im
 * Training: Es ist Werkzeugpflege, kein Üben.
 *
 * Das Turnier selbst läuft im Backend weiter, auch wenn man die Einstellungen
 * verlässt (siehe src-tauri/src/tournament.rs). Die Seite fragt beim Öffnen
 * den Stand ab und hängt sich an den Ereignisstrom; sie führt nichts mit, was
 * sie nicht vom Backend hat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Check, Cpu, FolderOpen, Loader2, Play, Plus, Square, Trash2, Trophy } from "lucide-react";
import { Button } from "../../components/ui";
import { Field, NumberField, inputCls } from "./SettingsLayout";
import { useI18n, type Key } from "../../lib/i18n";
import { testEngine, type EngineEntry } from "../../lib/settings";
import { writePgnFile } from "../../lib/db";
import {
  EMPTY_STATUS,
  onTournamentProgress,
  points,
  tournamentCancel,
  tournamentPgn,
  tournamentStart,
  tournamentStatus,
  type TournamentStatus,
} from "../../lib/tournament";

const MAX_ENGINES = 8;

/** Gründe, die das Backend meldet · alles andere bleibt ohne Zusatz. */
const REASON_KEY: Record<string, Key> = {
  mate: "end.reason.mate",
  stalemate: "end.reason.stalemate",
  insufficient: "end.reason.insufficient",
  fifty: "end.reason.fifty",
  repetition: "end.reason.repetition",
  invalidMove: "tn.reasonInvalid",
  engineError: "tn.reasonEngine",
  adjudicated: "tn.reasonAdjudicated",
};

export default function EnginesSection({
  engines,
  analysisPath,
  onChange,
  onUseForAnalysis,
}: {
  engines: EngineEntry[];
  /** Die Engine, mit der Kiebitz rechnet · leer heißt: die mitgelieferte. */
  analysisPath: string | null;
  onChange: (engines: EngineEntry[]) => void;
  onUseForAnalysis: (path: string) => void;
}) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<TournamentStatus>(EMPTY_STATUS);
  const [movetime, setMovetime] = useState(500);
  const [rounds, setRounds] = useState(2);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [tested, setTested] = useState<Record<number, { ok: boolean; name: string }>>({});
  const alive = useRef(true);
  /** Sobald eine Meldung da war, ist die Abfrage von vorhin überholt. */
  const live = useRef(false);

  useEffect(() => {
    alive.current = true;
    live.current = false;
    // Die Abfrage beim Öffnen und der Ereignisstrom laufen nebeneinander. Käme
    // die Antwort der Abfrage nach der ersten Meldung an, zeigte die Seite
    // wieder den Stand von vor dem Zug · deshalb gewinnt die Meldung.
    tournamentStatus()
      .then((s) => {
        if (alive.current && !live.current) setStatus(s);
      })
      .catch(() => {});
    const unlisten = onTournamentProgress((s) => {
      live.current = true;
      if (alive.current) setStatus(s);
    });
    return () => {
      alive.current = false;
      unlisten.then((off) => off()).catch(() => {});
    };
  }, []);

  // Teilnehmer sind die eingetragenen Engines; ohne Auswahl spielen alle.
  const chosen = useMemo(
    () => engines.filter((engine) => picked.length === 0 || picked.includes(engine.path)),
    [engines, picked]
  );

  const patch = (index: number, change: Partial<EngineEntry>) =>
    onChange(engines.map((engine, i) => (i === index ? { ...engine, ...change } : engine)));

  const add = async () => {
    const chosenPath = await openDialog({ multiple: false, directory: false });
    if (typeof chosenPath !== "string") return;
    const name = chosenPath.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? "Engine";
    onChange([...engines, { name, path: chosenPath }].slice(0, MAX_ENGINES));
  };

  const check = async (index: number) => {
    setTesting(index);
    try {
      const result = await testEngine(engines[index].path);
      setTested((current) => ({ ...current, [index]: result }));
      // Die Engine nennt ihren Namen selbst · der ist besser als der Dateiname.
      if (result.ok && result.name) patch(index, { name: result.name });
    } finally {
      setTesting(null);
    }
  };

  const start = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await tournamentStart({
        engines: chosen.map((engine) => ({ name: engine.name, path: engine.path })),
        movetimeMs: movetime,
        rounds,
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const savePgn = async () => {
    setError(null);
    try {
      const path = await saveDialog({
        defaultPath: "kiebitz-turnier.pgn",
        filters: [{ name: "Portable Game Notation", extensions: ["pgn"] }],
      });
      if (!path) return;
      const target = path.toLowerCase().endsWith(".pgn") ? path : `${path}.pgn`;
      await writePgnFile(target, await tournamentPgn());
      setNotice(t("tn.saved", { path: target }));
    } catch (reason) {
      setError(String(reason));
    }
  };

  const running = status.running;

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink3">{t("tn.lead")}</p>

      <div className="mt-3 flex flex-col gap-2">
        {engines.length === 0 && (
          <p className="rounded-lg border border-dashed border-line2 px-3 py-2.5 text-[12.5px] text-ink3">
            {t("tn.empty")}
          </p>
        )}
        {engines.map((engine, index) => {
          const active = analysisPath != null && analysisPath === engine.path;
          const result = tested[index];
          return (
            <div key={`${engine.path}-${index}`} className="rounded-lg border border-line bg-panel2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink2">
                  <input
                    type="checkbox"
                    checked={picked.length === 0 || picked.includes(engine.path)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const base = current.length === 0 ? engines.map((e) => e.path) : current;
                        return event.target.checked
                          ? [...new Set([...base, engine.path])]
                          : base.filter((path) => path !== engine.path);
                      })
                    }
                    aria-label={t("tn.takePart")}
                    disabled={running}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  <Cpu size={15} className={active ? "text-accent" : "text-ink3"} />
                </label>
                <input
                  value={engine.name}
                  onChange={(event) => patch(index, { name: event.target.value })}
                  aria-label={t("tn.engineName")}
                  className={`${inputCls} max-w-[200px] flex-1`}
                />
                <input
                  value={engine.path}
                  onChange={(event) => patch(index, { path: event.target.value })}
                  aria-label={t("tn.enginePath")}
                  className={`${inputCls} min-w-[180px] flex-[2]`}
                />
                <Button compact onClick={() => check(index)} title={t("set.engineTest")}>
                  {testing === index ? <Loader2 size={14} className="animate-spin" /> : t("set.engineTest")}
                </Button>
                <Button
                  compact
                  onClick={() => onUseForAnalysis(engine.path)}
                  disabled={active}
                  title={t("tn.useForAnalysis")}
                >
                  {active ? <Check size={14} /> : t("tn.use")}
                </Button>
                <Button
                  compact
                  onClick={() => onChange(engines.filter((_, i) => i !== index))}
                  title={t("common.delete")}
                  label={t("common.delete")}
                  disabled={running}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              {result && (
                <p className={`mt-2 text-[12px] ${result.ok ? "text-accent" : "text-loss"}`}>
                  {result.ok ? t("set.engineOk", { name: result.name }) : t("set.engineFail", { name: result.name })}
                </p>
              )}
              {active && <p className="mt-2 text-[12px] text-ink3">{t("tn.isAnalysisEngine")}</p>}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={add} disabled={engines.length >= MAX_ENGINES || running}>
          <Plus size={14} /> {t("tn.add")}
        </Button>
        <Button onClick={() => onChange([...engines, { name: "", path: "" }])} disabled={engines.length >= MAX_ENGINES || running}>
          <FolderOpen size={14} /> {t("tn.addManual")}
        </Button>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Trophy size={15} className="text-gold" /> {t("tn.title")}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink3">{t("tn.hint")}</p>

        <div className="mt-3 grid grid-cols-2 gap-3 min-[640px]:grid-cols-4">
          <NumberField label={t("tn.movetime")} value={movetime} min={50} max={30000} onChange={setMovetime} />
          <NumberField label={t("tn.rounds")} value={rounds} min={1} max={20} onChange={setRounds} />
          <Field label={t("tn.participants")}>
            <span className="py-2 text-[13px] text-ink">{chosen.length}</span>
          </Field>
          <Field label={t("tn.games")}>
            <span className="py-2 text-[13px] text-ink">
              {running || status.total > 0
                ? `${status.played} / ${status.total}`
                : (chosen.length * (chosen.length - 1) * rounds) / 2}
            </span>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {running ? (
            <Button onClick={() => tournamentCancel()}>
              <Square size={14} /> {t("tn.stop")}
            </Button>
          ) : (
            <Button primary onClick={start} disabled={busy || chosen.length < 2}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {t("tn.start")}
            </Button>
          )}
          {status.games.length > 0 && (
            <Button onClick={savePgn}>{t("tn.savePgn")}</Button>
          )}
          {running && (
            <span className="text-[12.5px] text-ink3">
              {t("tn.playing", { white: status.white, black: status.black, n: Math.ceil(status.plies / 2) })}
            </span>
          )}
        </div>

        {(error || status.error) && (
          <p className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
            {error ?? status.error}
          </p>
        )}
        {notice && <p className="mt-3 text-[12.5px] text-accent">{notice}</p>}
        {status.cancelled && !running && (
          <p className="mt-3 text-[12.5px] text-ink3">{t("tn.cancelled")}</p>
        )}

        {status.standings.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-ink3">
                  <th className="py-1.5 pr-2 font-normal">{t("tn.engine")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("tn.points")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("common.win")}</th>
                  <th className="py-1.5 pr-2 text-right font-normal">{t("common.draw")}</th>
                  <th className="py-1.5 text-right font-normal">{t("common.loss")}</th>
                </tr>
              </thead>
              <tbody>
                {status.standings.map((row) => (
                  <tr key={row.name} className="border-t border-line">
                    <td className="py-1 pr-2">{row.name}</td>
                    <td className="py-1 pr-2 text-right font-medium tabular-nums">
                      {points(row.halfPoints, locale)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-win">{row.wins}</td>
                    <td className="py-1 pr-2 text-right tabular-nums text-ink2">{row.draws}</td>
                    <td className="py-1 text-right tabular-nums text-loss">{row.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {status.games.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
              {t("tn.played")}
            </div>
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
              {status.games.map((game, index) => (
                <div key={index} className="flex items-baseline gap-2 text-[12.5px] text-ink2">
                  <span className="w-10 shrink-0 text-ink3">{game.round}.</span>
                  <span className="min-w-0 flex-1 truncate">
                    {game.white} – {game.black}
                  </span>
                  <span className="shrink-0 font-medium text-ink">{game.result.replace("1/2-1/2", "½–½")}</span>
                  <span className="hidden shrink-0 text-ink3 sm:inline">
                    {REASON_KEY[game.reason] ? t(REASON_KEY[game.reason]) : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
