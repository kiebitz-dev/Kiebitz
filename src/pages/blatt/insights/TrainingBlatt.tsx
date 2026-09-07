/**
 * Training im Diagramm-Modus · nicht zu verwechseln mit dem Training-Tab.
 *
 * Dort steht der Coach mit den Befunden; hier steht die Frage, ob das Training
 * wirkt. Zwei Regeln bestimmen das Blatt:
 *
 * · Können und Rating bekommen zwei getrennte Kurven. Genauigkeit in Prozent
 *   und Elo teilen sich keine Achse — dasselbe Argument wie auf der Übersicht.
 * · Auch Trainingsaufkommen und Patzerquote stehen untereinander statt
 *   ineinander: Balken oben, Kurve darunter, gemeinsame Zeitachse. Die
 *   gewöhnliche Fassung legt beides in ein Bild mit zwei Achsen.
 *
 * Die Lernkurve je Motiv ist die einzige Figur, die der Modus hinzufügt: zwei
 * Marken auf einer Bahn, dazwischen die Strecke, rechts die Veränderung.
 * „63,2 → 84,2" liest sich als Bewegung; zwei Balken nebeneinander täten das
 * nicht.
 */
import {
  Bahn,
  Blatttabelle,
  Figur,
  Fussnote,
  Kennzahlen,
  Kurve,
  Rubrik,
} from "../../../components/blatt/Satz";
import { useI18n } from "../../../lib/i18n";
import { de, deInt } from "../../../lib/format";
import { themeLabel, type PuzzleInsights } from "../../../lib/puzzles";
import type { DeepInsights } from "../../../lib/insights";
import Reiterkopf from "./Reiterkopf";

/** Eine Lernkurve · zwei Marken auf einer Bahn, dazwischen die Strecke. */
function Lernbahn({
  name,
  neben,
  frueh,
  spaet,
  delta,
  breite,
  letzte,
}: {
  name: string;
  neben: string;
  frueh: number;
  spaet: number;
  delta: number;
  breite: number;
  letzte: boolean;
}) {
  const von = Math.max(0, Math.min(100, Math.min(frueh, spaet)));
  const bis = Math.max(0, Math.min(100, Math.max(frueh, spaet)));
  const besser = delta >= 0;
  return (
    <div
      className={`flex h-[38px] items-center gap-[11px] text-[12.5px] ${
        letzte ? "" : "border-b border-line"
      }`}
    >
      <span className="min-w-0 flex-none" style={{ width: breite }}>
        <span className="block truncate text-ink2">{name}</span>
        <span className="blatt-zahl block truncate text-[10px] text-ink3">{neben}</span>
      </span>
      <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
        <span
          className="absolute bottom-1 h-[2px]"
          style={{
            insetInlineStart: `${von.toFixed(1)}%`,
            width: `${(bis - von).toFixed(1)}%`,
            background: besser ? "var(--color-win)" : "var(--color-loss)",
          }}
        />
        <span
          className="absolute bottom-0 h-[11px] w-[2px]"
          style={{
            insetInlineStart: `${Math.max(0, Math.min(100, frueh)).toFixed(1)}%`,
            background: "var(--color-ink3)",
          }}
        />
        <span
          className="absolute -bottom-[3px] h-[17px] w-[2px]"
          style={{
            insetInlineStart: `${Math.max(0, Math.min(100, spaet)).toFixed(1)}%`,
            background: "var(--color-ink)",
          }}
        />
      </span>
      <span className="blatt-zahl w-12 flex-none text-end text-[13px] text-ink">
        {de(spaet)} %
      </span>
      <span
        className="blatt-zahl w-11 flex-none text-end text-[11px]"
        style={{ color: besser ? "var(--color-win)" : "var(--color-loss)" }}
      >
        {besser ? "+" : ""}
        {de(delta)}
      </span>
    </div>
  );
}

export default function TrainingBlatt({
  mobile,
  deep,
  puzzles,
}: {
  mobile: boolean;
  deep: DeepInsights;
  puzzles: PuzzleInsights | null;
}) {
  const { t, locale } = useI18n();
  const { progress } = deep;

  const genauigkeit = progress.months
    .map((monat) => monat.accuracy)
    .filter((wert): wert is number => wert != null);
  const rating = progress.months
    .map((monat) => monat.rating)
    .filter((wert): wert is number => wert != null);
  const patzer = progress.months
    .map((monat) => monat.blunders_per_100)
    .filter((wert): wert is number => wert != null);
  const versuche = progress.months.map((monat) => monat.puzzle_attempts);
  const maxVersuche = Math.max(1, ...versuche);
  const trefferquote = (eintrag: { attempts: number; solved: number }) =>
    eintrag.attempts === 0 ? 0 : (eintrag.solved / eintrag.attempts) * 100;

  const kopf = (
    <Reiterkopf
      mobile={mobile}
      spalten="1.4fr 1.1fr 1.25fr 1.25fr"
      felder={[
        {
          label: t("ins.trAccuracyTrend"),
          wert:
            progress.accuracy_delta == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">
                  {progress.accuracy_delta > 0 ? "+" : ""}
                  {de(progress.accuracy_delta)}
                </span>
                {" · "}
                {t("ins.trAccuracyTrendSub")}
              </>
            ),
          gross: true,
        },
        {
          label: t("ins.trRatingTrend"),
          wert:
            progress.rating_delta == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">
                  {progress.rating_delta > 0 ? "+" : ""}
                  {deInt(progress.rating_delta)}
                </span>
                {" · "}
                {t("ins.trRatingTrendSub")}
              </>
            ),
        },
        {
          label: t("ins.pzRating"),
          wert:
            puzzles == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">{deInt(puzzles.personal_rating)}</span>
                {" · "}
                {t("ins.pzRatingSub")}
              </>
            ),
        },
        {
          label: t("ins.pzSolveRate"),
          wert:
            puzzles == null || puzzles.attempts === 0 ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">{de(trefferquote(puzzles))} %</span>
                {" · "}
                {t("ins.pzSolveRateSub", {
                  s: deInt(puzzles.solved),
                  n: deInt(puzzles.attempts),
                })}
              </>
            ),
        },
      ]}
      kasten={{
        label: t("ins.pzRun"),
        wert: puzzles == null ? "—" : deInt(puzzles.best_run),
        gross: 15,
      }}
    />
  );

  const koennen = (genauigkeit.length > 1 || rating.length > 1) && (
    <div>
      <Rubrik weg={t("ins.trSkillSummary")}>{t("ins.trSkillTitle")}</Rubrik>
      {genauigkeit.length > 1 && (
        <Figur
          titel={t("blatt.accuracyByMonth")}
          rechts={`${de(genauigkeit[genauigkeit.length - 1])} %`}
          links={`${de(genauigkeit[0])} %`}
          unten={t("blatt.monthsNote")}
        >
          <Kurve werte={genauigkeit} breite={380} hoehe={44} />
        </Figur>
      )}
      {rating.length > 1 && (
        <Figur
          titel={t("ins.trRatingTrend")}
          rechts={deInt(rating[rating.length - 1])}
          links={deInt(rating[0])}
          unten={t("blatt.monthsNote")}
        >
          <Kurve werte={rating} breite={380} hoehe={44} farbe="var(--color-violet)" />
        </Figur>
      )}
      <Fussnote>{t("ins.trSkillNote")}</Fussnote>
    </div>
  );

  const aufkommen = patzer.length > 1 && (
    <div>
      <Rubrik weg={t("ins.trVolumeSummary")}>{t("ins.trVolumeTitle")}</Rubrik>
      <div className="mt-2.5">
        <div className="blatt-feld text-ink3">{t("ins.pzAttempts")}</div>
        <div className="mt-1.5 flex h-[52px] items-end gap-[3px] border-b border-ink">
          {versuche.map((anzahl, index) => (
            <span
              key={index}
              title={t("ins.trAttemptsNote", { n: deInt(anzahl) })}
              className="block flex-1 bg-ink2"
              style={{ height: `${((anzahl / maxVersuche) * 50).toFixed(1)}px` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2.5">
        <div className="blatt-feld text-ink3">{t("ins.fmtBlunders")}</div>
        <div className="mt-1.5 border-b border-line pb-1.5">
          <Kurve werte={patzer} breite={380} hoehe={34} farbe="var(--color-loss)" />
        </div>
        <div className="blatt-zahl mt-1 flex justify-between text-[10px] text-ink3">
          <span>{de(patzer[0])}</span>
          <span>{de(patzer[patzer.length - 1])}</span>
        </div>
      </div>
      <Fussnote>{t("ins.trVolumeNote")}</Fussnote>
    </div>
  );

  const wirkung = (progress.themes.length > 0 || progress.rep_effect.before_games > 0) && (
    <div>
      <Rubrik weg={t("ins.trEffectSummary")}>{t("ins.trEffectTitle")}</Rubrik>
      {progress.themes.length > 0 && (
        <>
          <div className="blatt-feld pt-2 text-ink3">{t("ins.trThemeCurve")}</div>
          {progress.themes.map((thema, index) => (
            <Lernbahn
              key={thema.theme}
              name={themeLabel(thema.theme, locale)}
              neben={t("ins.trAttemptsNote", { n: deInt(thema.attempts) })}
              frueh={thema.early_pct}
              spaet={thema.late_pct}
              delta={thema.delta}
              breite={mobile ? 108 : 118}
              letzte={index === progress.themes.length - 1}
            />
          ))}
        </>
      )}
      {progress.rep_effect.before_games > 0 && (
        <div className="mt-3">
          <div className="blatt-feld text-ink3">{t("ins.trRepEffect")}</div>
          <div className="mt-1.5">
            <Bahn
              name={t("ins.trBefore", { n: deInt(progress.rep_effect.before_games) })}
              wert={progress.rep_effect.before_score}
              anzeige={`${de(progress.rep_effect.before_score)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={mobile ? 128 : 148}
              hoehe={32}
            />
            <Bahn
              name={t("ins.trAfter", { n: deInt(progress.rep_effect.after_games) })}
              wert={progress.rep_effect.after_score}
              anzeige={`${de(progress.rep_effect.after_score)} %`}
              marke={50}
              markeFarbe="var(--color-ink3)"
              breite={mobile ? 128 : 148}
              hoehe={32}
              letzte
            />
          </div>
          <Fussnote>{t("ins.trRepEffectNote")}</Fussnote>
        </div>
      )}
    </div>
  );

  const motive = puzzles != null && puzzles.attempts > 0 && (
    <div>
      <Rubrik
        weg={t("ins.trPuzzleSummary", {
          r: deInt(puzzles.personal_rating),
          b: deInt(puzzles.best_run),
        })}
      >
        {t("ins.tabPuzzles")}
      </Rubrik>
      <Kennzahlen
        zahlen={[
          {
            name: t("ins.pzSolveRate"),
            wert: `${de(trefferquote(puzzles))} %`,
            neben: t("ins.pzSolveRateSub", {
              s: deInt(puzzles.solved),
              n: deInt(puzzles.attempts),
            }),
          },
          {
            name: t("ins.pzHardest"),
            wert: deInt(puzzles.avg_solved_rating),
            neben: t("ins.pzHardestSub", { n: deInt(puzzles.avg_puzzle_rating) }),
          },
          {
            name: t("ins.pzRun"),
            wert: deInt(puzzles.best_run),
            neben: t("ins.pzRunSub", { n: deInt(puzzles.current_run) }),
          },
        ]}
      />
      <div className={mobile ? "mt-4 flex flex-col gap-4" : "mt-4 flex gap-6"}>
        <div className="min-w-0 flex-1">
          <div className="blatt-feld text-ink3">{t("blatt.hitRateByTheme")}</div>
          {[...puzzles.themes]
            .filter((thema) => thema.attempts >= 5)
            .sort((a, b) => trefferquote(b) - trefferquote(a))
            .map((thema, index, alle) => (
              <Bahn
                key={thema.theme}
                name={themeLabel(thema.theme, locale)}
                wert={trefferquote(thema)}
                anzeige={`${de(trefferquote(thema))} %`}
                breite={mobile ? 108 : 104}
                wertBreite={48}
                hoehe={25}
                letzte={index === alle.length - 1}
              />
            ))}
        </div>
        <div className={mobile ? "" : "w-[196px] flex-none"}>
          <div className="blatt-feld text-ink3">{t("blatt.difficulty")}</div>
          {puzzles.by_rating.map((band, index) => (
            <Bahn
              key={band.key}
              name={`${deInt(band.key)}–${deInt(band.key + 399)}`}
              neben={t("ins.trAttemptsNote", { n: deInt(band.attempts) })}
              wert={trefferquote(band)}
              anzeige={`${de(trefferquote(band))} %`}
              breite={88}
              wertBreite={48}
              hoehe={34}
              letzte={index === puzzles.by_rating.length - 1}
            />
          ))}
          <Fussnote>{t("ins.pzByDifficultyNote")}</Fussnote>
        </div>
      </div>
    </div>
  );

  const motivtabelle = puzzles != null && puzzles.themes.length > 0 && (
    <div>
      <Rubrik weg={t("ins.trThemeTableSummary", { n: deInt(puzzles.themes.length) })}>
        {t("ins.pzThemeTable")}
      </Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.pzTheme") },
          { label: t("ins.pzAttempts"), breite: 62, rechts: true, zahl: true, blass: true },
          { label: t("ins.pzSolved"), breite: 62, rechts: true, zahl: true, blass: true },
          { label: t("ins.pzSolveRate"), breite: 66, rechts: true, zahl: true },
        ]}
        zeilen={[...puzzles.themes]
          .sort((a, b) => b.attempts - a.attempts)
          .map((thema) => [
            themeLabel(thema.theme, locale),
            deInt(thema.attempts),
            deInt(thema.solved),
            `${de(trefferquote(thema))} %`,
          ])}
      />
    </div>
  );

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {koennen}
        {wirkung}
        {aufkommen}
        {motive}
        {motivtabelle}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {koennen}
          {aufkommen}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {wirkung}
          {motive}
          {motivtabelle}
        </div>
      </div>
    </div>
  );
}
