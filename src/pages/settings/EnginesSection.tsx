/**
 * Engines · Verwaltung, Rechenwerte und Turnier in einem Abschnitt.
 *
 * Kiebitz rechnet mit einer Engine, und das bleibt so: Analyse, Live-Brett und
 * Trainer benutzen die eine, die in der Liste markiert ist. Wer aber eine
 * zweite ausprobiert, will zwei Dinge — schnell umschalten, welche rechnet,
 * und wissen, welche stärker ist. Beides steht deshalb hier und nicht im
 * Training: Es ist Werkzeugpflege, kein Üben.
 *
 * Bis 1.6 waren das zwei Abschnitte, „Schach-Engine" mit einem Pfadfeld und
 * „Engines und Turnier" mit der Liste · zwei Wege zur selben Einstellung, und
 * der Pfad aus dem ersten stand in der Liste des zweiten nicht. Jetzt gibt es
 * nur die Liste. Jede Zeile ist kurz (Name, Herkunft, „Für Analyse"); Name,
 * Pfad und Test liegen hinter dem Stift, weil man sie einmal einrichtet und
 * dann nicht mehr ansieht. Die Rechenwerte darunter (`children`) gelten für
 * die Engine, die gerade rechnet.
 *
 * Die mitgelieferte Engine steht als feste erste Zeile darüber. Sie hat keinen
 * Eintrag in `engines` und keinen Pfad (`engine_path` leer heißt: sie rechnet),
 * aber sie muss wählbar bleiben · sonst führte, sobald eine zweite Engine
 * eingetragen und übernommen war, kein Klick mehr zurück, und ein Turnier
 * gegen die eigene Stockfish ging gar nicht. Ans Backend geht sie mit leerem
 * Pfad; `tournament_start` setzt dafür die mitgelieferte ein.
 *
 * Das Turnier selbst läuft im Backend weiter, auch wenn man die Einstellungen
 * verlässt (siehe src-tauri/src/tournament.rs). Zu sehen ist es im Turniersaal
 * (./TournamentHall.tsx), der sich beim Start öffnet. Die Seite fragt beim
 * Öffnen den Stand ab und hängt sich an den Ereignisstrom; sie führt nichts
 * mit, was sie nicht vom Backend hat.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Check, Cpu, Eye, FolderOpen, Loader2, Pencil, Play, Plus, Square, Trash2, Trophy } from "lucide-react";
import { Button } from "../../components/ui";
import { Field, NumberField, inputCls } from "./SettingsLayout";
import { useI18n } from "../../lib/i18n";
import { testEngine, type EngineEntry } from "../../lib/settings";
import { bundledEngineInfo } from "../../lib/backend";
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
import TournamentHall from "./TournamentHall";

const MAX_ENGINES = 8;

/** Schlüssel der mitgelieferten Engine in der Teilnehmerauswahl · kein Pfad kann so heißen. */
const BUNDLED = "\u0000bundled";

/** Dateiname ohne Endung · der vorläufige Name einer neu eingetragenen Engine. */
const nameFromPath = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "Engine";

export default function EnginesSection({
  engines,
  analysisPath,
  onChange,
  onUseForAnalysis,
  children,
}: {
  engines: EngineEntry[];
  /** Die Engine, mit der Kiebitz rechnet · leer heißt: die mitgelieferte. */
  analysisPath: string | null;
  onChange: (engines: EngineEntry[]) => void;
  /** `null` stellt auf die mitgelieferte Engine zurück. */
  onUseForAnalysis: (path: string | null) => void;
  /** Die Rechenwerte · sie stehen zwischen Liste und Turnier. */
  children?: ReactNode;
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
  /** Die Zeile, deren Stift offen ist. */
  const [editing, setEditing] = useState<number | null>(null);
  const [hallOpen, setHallOpen] = useState(false);
  const [bundledName, setBundledName] = useState("Stockfish");
  const alive = useRef(true);
  /** Sobald eine Meldung da war, ist die Abfrage von vorhin überholt. */
  const live = useRef(false);

  useEffect(() => {
    alive.current = true;
    live.current = false;
    // Die Abfrage beim Öffnen und der Ereignisstrom laufen nebeneinander. Käme
    // die Antwort der Abfrage nach der ersten Meldung an, zeigte die Seite
    // wieder den Stand von vor dem Zug · deshalb gewinnt die Meldung.
    bundledEngineInfo()
      .then((info) => {
        if (alive.current && info.available) setBundledName(info.name);
      })
      .catch(() => {});
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

  /**
   * Ein Pfad aus dem alten Feld „Schach-Engine", der in der Liste fehlt,
   * kommt als Eintrag dazu · sonst rechnete eine Engine, die man nirgends
   * sieht und nicht wieder abwählen kann.
   */
  useEffect(() => {
    const path = analysisPath?.trim();
    if (!path || engines.some((engine) => engine.path === path) || engines.length >= MAX_ENGINES) return;
    onChange([...engines, { name: nameFromPath(path), path }]);
  }, [analysisPath, engines, onChange]);

  // Teilnehmer sind die mitgelieferte und die eingetragenen Engines; ohne
  // Auswahl spielen alle. Ein Eintrag ohne Pfad (gerade von Hand angelegt)
  // spielt nicht mit · das Backend läse ihn als die mitgelieferte.
  const takesPart = (key: string) => picked.length === 0 || picked.includes(key);
  const chosen: EngineEntry[] = [
    ...(takesPart(BUNDLED) ? [{ name: bundledName, path: "" }] : []),
    ...engines.filter((engine) => engine.path.trim() !== "" && takesPart(engine.path)),
  ];
  const allKeys = () => [BUNDLED, ...engines.map((e) => e.path)];
  const toggle = (key: string, on: boolean) =>
    setPicked((current) => {
      const base = current.length === 0 ? allKeys() : current;
      return on ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    });
  const bundledActive = !analysisPath;

  const patch = (index: number, change: Partial<EngineEntry>) =>
    onChange(engines.map((engine, i) => (i === index ? { ...engine, ...change } : engine)));

  const add = async () => {
    const chosenPath = await openDialog({ multiple: false, directory: false });
    if (typeof chosenPath !== "string") return;
    onChange([...engines, { name: nameFromPath(chosenPath), path: chosenPath }].slice(0, MAX_ENGINES));
  };

  /** Ein leerer Eintrag · der Stift steht gleich offen, sonst gäbe es nichts auszufüllen. */
  const addManual = () => {
    onChange([...engines, { name: "", path: "" }]);
    setEditing(engines.length);
  };

  const browse = async (index: number) => {
    const chosenPath = await openDialog({ multiple: false, directory: false });
    if (typeof chosenPath !== "string") return;
    const current = engines[index];
    patch(index, { path: chosenPath, name: current.name.trim() ? current.name : nameFromPath(chosenPath) });
  };

  const remove = (index: number) => {
    const removed = engines[index];
    onChange(engines.filter((_, i) => i !== index));
    // Rechnete sie gerade, rechnet ab jetzt wieder die mitgelieferte.
    if (removed && analysisPath === removed.path) onUseForAnalysis(null);
    setEditing(null);
    setTested({});
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
      setHallOpen(true);
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
  const leader = status.standings[0];

  /** Eine Zeile der Liste · die mitgelieferte hat keinen Stift und keinen Papierkorb. */
  const row = (props: {
    key: string;
    testId?: string;
    partKey: string;
    name: string;
    detail: string;
    active: boolean;
    onUse: () => void;
    index?: number;
  }) => {
    const { index } = props;
    const open = index != null && editing === index;
    const engine = index != null ? engines[index] : null;
    const result = index != null ? tested[index] : undefined;
    return (
      <div
        key={props.key}
        data-testid={props.testId}
        className={`rounded-lg border bg-panel2 transition-colors ${props.active ? "border-accent-dim" : "border-line"}`}
      >
        <div className="flex flex-wrap items-center gap-2 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink2">
            <input
              type="checkbox"
              checked={takesPart(props.partKey)}
              onChange={(event) => toggle(props.partKey, event.target.checked)}
              aria-label={t("tn.takePart")}
              disabled={running}
              className="size-4 accent-[var(--color-accent)]"
            />
            <Cpu size={15} className={props.active ? "text-accent" : "text-ink3"} />
          </label>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{props.name || t("tn.unnamed")}</div>
            <div className="truncate text-[11.5px] text-ink3" title={props.detail}>
              {props.detail}
            </div>
          </div>
          {props.active ? (
            <span
              className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent"
              title={t("tn.isAnalysisEngine")}
            >
              <Check size={12} /> {t("tn.inUse")}
            </span>
          ) : (
            <Button compact onClick={props.onUse} title={t("tn.useForAnalysis")} disabled={index != null && !engine?.path.trim()}>
              {t("tn.use")}
            </Button>
          )}
          {index != null && (
            <>
              <Button
                compact
                onClick={() => setEditing(open ? null : index)}
                title={t("tn.edit")}
                label={t("tn.edit")}
                className={open ? "border-accent-dim text-accent" : ""}
              >
                <Pencil size={14} />
              </Button>
              <Button compact onClick={() => remove(index)} title={t("common.delete")} label={t("common.delete")} disabled={running}>
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
        {open && engine && (
          <div className="flex flex-col gap-3 border-t border-line px-3 pb-3 pt-3">
            <Field label={t("tn.engineName")}>
              <input
                value={engine.name}
                onChange={(event) => patch(index, { name: event.target.value })}
                aria-label={t("tn.engineName")}
                className={inputCls}
                autoFocus={!engine.name}
              />
            </Field>
            <Field label={t("tn.enginePath")}>
              <div className="flex gap-2">
                <input
                  value={engine.path}
                  onChange={(event) => {
                    const path = event.target.value;
                    // Die rechnende Engine zieht mit · sonst zeigte der
                    // Eintrag auf die neue Datei und gerechnet würde mit der alten.
                    if (props.active) onUseForAnalysis(path || null);
                    patch(index, { path });
                  }}
                  aria-label={t("tn.enginePath")}
                  className={inputCls}
                />
                <Button onClick={() => browse(index)} title={t("tn.browse")} label={t("tn.browse")} compact>
                  <FolderOpen size={14} />
                </Button>
                <Button onClick={() => check(index)} disabled={!engine.path.trim()}>
                  {testing === index ? <Loader2 size={14} className="animate-spin" /> : t("set.engineTest")}
                </Button>
              </div>
            </Field>
            {result && (
              <p className={`text-[12px] ${result.ok ? "text-accent" : "text-loss"}`}>
                {result.ok ? t("set.engineOk", { name: result.name }) : t("set.engineFail", { name: result.name })}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink3">{t("tn.lead")}</p>

      <div className="mt-3 flex flex-col gap-2">
        {row({
          key: "bundled",
          testId: "bundled-engine",
          partKey: BUNDLED,
          name: bundledName,
          detail: t("tn.bundled"),
          active: bundledActive,
          onUse: () => onUseForAnalysis(null),
        })}
        {engines.map((engine, index) =>
          row({
            key: `engine-${index}`,
            partKey: engine.path,
            name: engine.name,
            detail: engine.path || t("tn.noPath"),
            active: !!analysisPath && analysisPath === engine.path,
            onUse: () => onUseForAnalysis(engine.path),
            index,
          })
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={add} disabled={engines.length >= MAX_ENGINES || running}>
          <Plus size={14} /> {t("tn.add")}
        </Button>
        <Button onClick={addManual} disabled={engines.length >= MAX_ENGINES || running}>
          <FolderOpen size={14} /> {t("tn.addManual")}
        </Button>
      </div>

      {children && <div className="mt-5 border-t border-line pt-4">{children}</div>}

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
          {(running || status.games.length > 0) && (
            <Button onClick={() => setHallOpen(true)}>
              <Eye size={14} /> {t("tn.watch")}
            </Button>
          )}
          {status.games.length > 0 && <Button onClick={savePgn}>{t("tn.savePgn")}</Button>}
          {leader && status.played > 0 && (
            <span className="text-[12.5px] text-ink3">
              {t("tn.leader", { name: leader.name, points: points(leader.halfPoints, locale) })}
            </span>
          )}
        </div>

        {(error || status.error) && (
          <p className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
            {error ?? status.error}
          </p>
        )}
        {notice && <p className="mt-3 text-[12.5px] text-accent">{notice}</p>}
        {status.cancelled && !running && <p className="mt-3 text-[12.5px] text-ink3">{t("tn.cancelled")}</p>}
      </div>

      {hallOpen && (
        <TournamentHall
          status={status}
          onClose={() => setHallOpen(false)}
          onStop={() => tournamentCancel()}
          onSavePgn={savePgn}
        />
      )}
    </>
  );
}
