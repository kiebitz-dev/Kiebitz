/**
 * Stärke im Diagramm-Modus.
 *
 * Aus den aufklappbaren Abschnitten der gewöhnlichen Fassung werden Rubriken
 * mit Linie. Eine Karte, die zugeklappt nur ihre Kernaussage zeigt, ist die
 * Antwort auf ein Platzproblem des Dashboards; im Satzspiegel steht die
 * Kernaussage in der Rubrikzeile, und darunter steht sie ausgeschrieben.
 *
 * Zwei Entscheidungen, die dieses Blatt trägt:
 *
 * · Phasen und Fehler stehen als ein geteilter Balken je Phase. Die Länge ist
 *   der Schaden, die Teilung sagt, woraus er besteht — beschriftet am Ende der
 *   Linie statt in einer Legende darunter.
 * · Der Vergleich mit dem Gegnerfeld nimmt die Bahnen der Spieler-DNA wieder
 *   auf: Balken ist das eigene Maß, der violette Strich das des Feldes. Vier
 *   Zeilen, kein zweites Bild.
 *
 * Gerechnet wird hier nichts, was die gewöhnliche Fassung nicht auch rechnet ·
 * dieselben Felder aus derselben Tiefenauswertung.
 *
 * Der Kontext am Fuß — gegen wen, in welchem Tempo, über welche Länge — stand
 * lange nur drüben. Er ist dreimal dieselbe Frage („wo stehe ich besser als im
 * Schnitt?"), und deshalb dreimal dieselbe Bahnenreihe mit der 50-%-Marke,
 * nebeneinander und über die ganze Breite. Er steht hier und nicht auf dem
 * Muster-Blatt, weil er drüben hier steht: Der Modus ändert den Satz und nicht,
 * in welchem Kapitel eine Auskunft zu finden ist.
 */
import { Bahn, Bahnkopf, Blatttabelle, Fussnote, Kennzahlen, Rubrik } from "../../../components/blatt/Satz";
import { useI18n, type Key } from "../../../lib/i18n";
import { de, deInt } from "../../../lib/format";
import type { PhaseErrors } from "../../../lib/analysis";
import type { DeepInsights } from "../../../lib/insights";
import type { LiveInsights } from "../../../lib/stats";
import Reiterkopf from "./Reiterkopf";

/** Der geteilte Balken einer Phase · Ungenauigkeit, Fehler, Patzer. */
function Fehlerbalken({
  name,
  ungenau,
  fehler,
  patzer,
  max,
  letzte,
}: {
  name: string;
  ungenau: number;
  fehler: number;
  patzer: number;
  max: number;
  letzte: boolean;
}) {
  const { t } = useI18n();
  const summe = ungenau + fehler + patzer;
  const teil = (anzahl: number, farbe: string) => (
    <span
      className="block h-full"
      style={{ width: `${((anzahl / max) * 100).toFixed(1)}%`, background: farbe }}
    />
  );
  return (
    <div className={`py-[9px] ${letzte ? "" : "border-b border-line"}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
        <span className="blatt-zahl flex-none text-[11.5px] text-ink3">
          {t("blatt.errorMoves", { n: deInt(summe) })}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="flex h-[10px] min-w-0 flex-1 gap-[2px] border-b border-line2 pb-px">
          {teil(ungenau, "var(--color-ink3)")}
          {teil(fehler, "var(--color-ink2)")}
          {teil(patzer, "var(--color-loss)")}
        </span>
        <span className="blatt-zahl flex-none text-end text-[11.5px] text-ink3">
          {deInt(ungenau)} · {deInt(fehler)} ·{" "}
          <span style={{ color: "var(--color-loss)" }}>{deInt(patzer)}</span>
        </span>
      </div>
    </div>
  );
}

export default function StrengthBlatt({
  mobile,
  deep,
  live,
  errors,
}: {
  mobile: boolean;
  deep: DeepInsights;
  live: LiveInsights;
  errors: PhaseErrors[];
}) {
  const { t } = useI18n();
  const { content, benchmark } = deep;
  const phasenname = (phase: string) => t(`ins.phase.${phase}` as Key);

  if (content.games === 0) {
    return <div className="py-3 text-[12.5px] text-ink3">{t("ins.stNoAnalysis")}</div>;
  }

  const fehlerzeilen = errors.filter((e) => e.inaccuracy + e.mistake + e.blunder > 0);
  const maxFehler = Math.max(
    1,
    ...fehlerzeilen.map((e) => e.inaccuracy + e.mistake + e.blunder)
  );
  // Die schwächste Phase steht in der Rubrikzeile · dieselbe Rechnung wie in
  // der gewöhnlichen Fassung.
  const schwaechstePhase =
    [...live.phaseAccuracy]
      .filter((p) => p.accuracy != null)
      .sort((a, b) => a.accuracy! - b.accuracy!)[0]?.phase ?? "middlegame";
  const haeufigstePhase =
    [...content.decisive.by_phase].sort((a, b) => b.games - a.games)[0]?.phase ?? "middlegame";

  const spanne = { breite: mobile ? 96 : 104, wertBreite: 46 };
  const feld = benchmark.field;
  const ich = benchmark.me;

  const kopf = (
    <Reiterkopf
      mobile={mobile}
      spalten="1.1fr 1.25fr 1.4fr 1.3fr"
      felder={[
        {
          label: t("ins.stConversion"),
          wert: (
            <>
              <span className="blatt-zahl">{de(content.conversion.score_pct)} %</span>
              {" · "}
              {t("ins.stConversionSub", {
                w: deInt(content.conversion.won),
                n: deInt(content.conversion.games),
              })}
            </>
          ),
          gross: true,
        },
        {
          label: t("ins.stDefense"),
          wert: (
            <>
              <span className="blatt-zahl">{de(content.defense.save_pct)} %</span>
              {" · "}
              {t("ins.stDefenseSub", {
                s: deInt(content.defense.saved),
                n: deInt(content.defense.games),
              })}
            </>
          ),
        },
        {
          label: t("ins.stBlunders"),
          wert:
            ich == null ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">{de(ich.blunders_per_100)}</span>
                {feld != null && (
                  <>
                    {" · "}
                    {t("ins.stBlundersField", { f: de(feld.blunders_per_100) })}
                  </>
                )}
              </>
            ),
        },
        {
          label: t("ins.stDecisive"),
          wert:
            content.decisive.games === 0 ? (
              "—"
            ) : (
              <>
                <span className="blatt-zahl">
                  {t("ins.tmMoveNo", { n: de(content.decisive.avg_move) })}
                </span>
                {" · "}
                {t("ins.stDecisiveSub", { phase: phasenname(haeufigstePhase) })}
              </>
            ),
        },
      ]}
      kasten={{ label: t("blatt.weakest"), wert: phasenname(schwaechstePhase), gross: 12 }}
    />
  );

  const phasenblock = fehlerzeilen.length > 0 && (
    <div>
      <Rubrik weg={t("ins.stPhaseSummary", { phase: phasenname(schwaechstePhase) })}>
        {t("ins.stPhaseTitle")}
      </Rubrik>
      <div className="flex items-baseline gap-2.5 border-b border-line pb-1 pt-[7px]">
        <span className="blatt-feld flex-1 text-ink3">{t("ins.stPhaseTitle")}</span>
        <span className="blatt-feld text-ink3">
          {t("ins.legInaccuracies")} · {t("ins.legMistakes")} ·{" "}
          <span style={{ color: "var(--color-loss)" }}>{t("ins.legBlunders")}</span>
        </span>
      </div>
      {fehlerzeilen.map((zeile, index) => (
        <Fehlerbalken
          key={zeile.phase}
          name={phasenname(zeile.phase)}
          ungenau={zeile.inaccuracy}
          fehler={zeile.mistake}
          patzer={zeile.blunder}
          max={maxFehler}
          letzte={index === fehlerzeilen.length - 1}
        />
      ))}
    </div>
  );

  const vergleich = ich && feld && (
    <div>
      <Rubrik>{t("ins.stBenchTitle")}</Rubrik>
      <Bahnkopf
        was={t("blatt.axis")}
        wert={t("dna.you")}
        rechts={t("dna.field")}
        {...spanne}
      />
      {ich.accuracy != null && feld.accuracy != null && (
        <Bahn
          name={t("ins.stAccuracyMe")}
          wert={ich.accuracy}
          anzeige={`${de(ich.accuracy)} %`}
          marke={feld.accuracy}
          markeTitel={t("ins.stFieldValue", { v: de(feld.accuracy) })}
          rechts={de(feld.accuracy)}
          {...spanne}
        />
      )}
      <Bahn
        name={t("ins.stLossMe")}
        wert={ich.avg_loss}
        anzeige={de(ich.avg_loss)}
        max={Math.max(6, ich.avg_loss, feld.avg_loss)}
        marke={feld.avg_loss}
        markeTitel={t("ins.stFieldValue", { v: de(feld.avg_loss) })}
        rechts={de(feld.avg_loss)}
        {...spanne}
      />
      <Bahn
        name={t("ins.stBlunders")}
        wert={ich.blunders_per_100}
        anzeige={de(ich.blunders_per_100)}
        max={Math.max(6, ich.blunders_per_100, feld.blunders_per_100)}
        marke={feld.blunders_per_100}
        markeTitel={t("ins.stFieldValue", { v: de(feld.blunders_per_100) })}
        rechts={de(feld.blunders_per_100)}
        {...spanne}
      />
      {ich.trouble_pct != null && feld.trouble_pct != null && (
        <Bahn
          name={t("ins.stTroubleMe")}
          wert={ich.trouble_pct}
          anzeige={`${de(ich.trouble_pct)} %`}
          max={Math.max(25, ich.trouble_pct, feld.trouble_pct)}
          marke={feld.trouble_pct}
          markeTitel={t("ins.stFieldValue", { v: de(feld.trouble_pct) })}
          rechts={de(feld.trouble_pct)}
          letzte
          {...spanne}
        />
      )}
      <Fussnote>
        {t("blatt.gamesN", { n: deInt(benchmark.games) })} · {t("ins.stBenchWindow")} · Ø{" "}
        {deInt(benchmark.avg_opp_elo)} {t("ins.stBenchNote")}
      </Fussnote>
    </div>
  );

  const endspiele = content.endgames.length > 0 && (
    <div>
      <Rubrik weg={t("ins.stEndgameSummary", { n: deInt(content.endgames.length) })}>
        {t("ins.stEndgameTitle")}
      </Rubrik>
      <Blatttabelle
        hoehe={26}
        spalten={[
          { label: t("ins.stEndgameTitle"), buch: true },
          { label: t("ins.games"), breite: 52, rechts: true, zahl: true, blass: true },
          { label: t("ins.scoreRate"), breite: 56, rechts: true, zahl: true },
          { label: t("ins.accuracyShort"), breite: 74, rechts: true, zahl: true, blass: true },
        ]}
        zeilen={content.endgames.map((typ) => [
          t(`ins.endgame.${typ.key}` as Key),
          deInt(typ.games),
          `${de(typ.score_pct)} %`,
          typ.accuracy == null ? "—" : `${de(typ.accuracy)} %`,
        ])}
      />
    </div>
  );

  const ausgang = (
    <div>
      <Rubrik>{t("ins.stResultTitle")}</Rubrik>
      <Kennzahlen
        zahlen={[
          {
            name: t("ins.stWonPositions"),
            wert: deInt(content.conversion.games),
            neben: t("ins.stWonPositionsHint", {
              w: deInt(content.conversion.won),
              d: deInt(content.conversion.drawn),
              l: deInt(content.conversion.lost),
            }),
          },
          {
            name: t("ins.stConversion"),
            wert: `${de(content.conversion.score_pct)} %`,
            neben: t("ins.scoreRate"),
          },
          {
            name: t("ins.stLostAt"),
            wert: t("ins.tmMoveNo", { n: de(content.conversion.lost_at_move) }),
            neben: t("ins.stLostAtHint", { phase: phasenname(content.conversion.phase) }),
          },
          {
            name: t("ins.stSaved"),
            wert: `${de(content.defense.save_pct)} %`,
            neben: t("ins.stSavedHint", { n: deInt(content.defense.games) }),
          },
          {
            name: t("ins.stPunish"),
            wert: `${de(content.punishment.missed_pct)} %`,
            neben: t("ins.stPunishHint", { n: deInt(content.punishment.chances) }),
          },
        ]}
      />
      {content.conversion.games > 0 && (
        <div className="mt-3">
          <div className="flex h-3.5 gap-[2px]">
            {(
              [
                [content.conversion.won, "var(--color-win)"],
                [content.conversion.drawn, "var(--color-draw)"],
                [content.conversion.lost, "var(--color-loss)"],
              ] as const
            ).map(([anzahl, farbe], index) => (
              <span
                key={index}
                style={{
                  width: `${((anzahl / content.conversion.games) * 100).toFixed(1)}%`,
                  background: farbe,
                }}
              />
            ))}
          </div>
          <div className="blatt-zahl mt-1 text-[10.5px] text-ink3">
            {t("ins.stWonPositionsHint", {
              w: deInt(content.conversion.won),
              d: deInt(content.conversion.drawn),
              l: deInt(content.conversion.lost),
            })}
          </div>
        </div>
      )}
      <Fussnote>
        {t("ins.stResultNote")}{" "}
        {content.decisive.games > 0 && (
          <>
            {t("ins.stDecidedIn", { n: deInt(content.decisive.games) })} ·{" "}
            {t("ins.tmMoveNo", { n: de(content.decisive.avg_move) })} ·{" "}
            {t("ins.stDecisiveSub", { phase: phasenname(haeufigstePhase) })}
          </>
        )}
      </Fussnote>
    </div>
  );

  const anatomie = content.anatomy.errors > 0 && (
    <div>
      <Rubrik
        weg={t("ins.stAnatomySummary", {
          p: de(content.anatomy.forcing_pct),
          b: de(content.anatomy.forcing_base_pct),
        })}
      >
        {t("ins.stAnatomyTitle")}
      </Rubrik>
      <div className="mt-2.5 flex items-end gap-5">
        <div className="min-w-0 flex-1">
          <div className="blatt-feld text-ink3">{t("ins.stForcingMissed")}</div>
          <div className="relative mt-[7px] h-[13px] border-b border-line2">
            <span
              className="absolute bottom-0 start-0 h-[11px] bg-ink"
              style={{ width: `${content.anatomy.forcing_pct.toFixed(1)}%` }}
            />
            <span
              title={t("ins.stForcingBase")}
              className="absolute -bottom-[3px] h-[19px] w-[2px]"
              style={{
                insetInlineStart: `${content.anatomy.forcing_base_pct.toFixed(1)}%`,
                background: "var(--color-violet)",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between gap-2 text-[10.5px] text-ink3">
            <span className="blatt-zahl">
              {t("ins.stPieceNote", {
                e: deInt(content.anatomy.forcing_missed),
                n: deInt(content.anatomy.errors),
              })}
            </span>
            <span className="blatt-zahl" style={{ color: "var(--color-violet)" }}>
              {t("ins.stForcingBase")} {de(content.anatomy.forcing_base_pct)} %
            </span>
          </div>
        </div>
        <div className="blatt-zahl w-[92px] flex-none whitespace-nowrap text-end text-[22px] font-medium text-ink">
          {de(content.anatomy.forcing_pct)} %
        </div>
      </div>
      {content.anatomy.by_piece.length > 0 && (
        <div className="mt-3.5">
          <div className="blatt-feld text-ink3">
            {t("ins.stByPiece")} · {t("ins.tmErrorsPer100")}
          </div>
          {[...content.anatomy.by_piece]
            .sort((a, b) => b.errors_per_100 - a.errors_per_100)
            .map((figur, index, alle) => (
              <Bahn
                key={figur.piece}
                name={t(`ins.piece.${figur.piece}` as Key)}
                neben={t("ins.stPieceNote", {
                  e: deInt(figur.errors),
                  n: deInt(figur.moves),
                })}
                wert={figur.errors_per_100}
                anzeige={de(figur.errors_per_100)}
                max={Math.max(6, ...alle.map((f) => f.errors_per_100))}
                breite={mobile ? 92 : 86}
                wertBreite={40}
                hoehe={30}
                letzte={index === alle.length - 1}
              />
            ))}
        </div>
      )}
      <div className="mt-3 border-t border-line pt-2">
        <div className="blatt-feld text-ink3">{t("ins.stLossMe")}</div>
        <Bahn
          name={t("ins.stForcingLoss")}
          neben={t("blatt.moves") + " " + deInt(content.anatomy.forcing_moves)}
          wert={content.anatomy.forcing_loss}
          anzeige={de(content.anatomy.forcing_loss)}
          max={Math.max(6, content.anatomy.forcing_loss, content.anatomy.quiet_loss)}
          breite={mobile ? 118 : 128}
          wertBreite={40}
          hoehe={30}
        />
        <Bahn
          name={t("ins.stQuietLoss")}
          neben={t("blatt.moves") + " " + deInt(content.anatomy.quiet_moves)}
          wert={content.anatomy.quiet_loss}
          anzeige={de(content.anatomy.quiet_loss)}
          max={Math.max(6, content.anatomy.forcing_loss, content.anatomy.quiet_loss)}
          breite={mobile ? 118 : 128}
          wertBreite={40}
          hoehe={30}
          letzte
        />
      </div>
      <Fussnote>{t("ins.stAnatomyNote")}</Fussnote>
    </div>
  );

  /**
   * Eine Spalte des Kontexts · Bahnen mit der 50-%-Marke, sonst nichts.
   *
   * `rechts` trägt die Genauigkeit, wo es eine gibt · bei der Partielänge ist
   * sie die zweite Hälfte der Auskunft, und eine zweite Bahn dafür wäre eine
   * zweite Größe auf einer fremden Skala.
   */
  const kontextspalte = (
    titel: string,
    zeilen: { name: string; games: number; wert: number; genau?: number | null }[]
  ) => (
    <div className="min-w-0 flex-1">
      {/* Jede Spalte sagt selbst, was in ihr steht · eine Fußnote unter drei
          Spalten gehörte zu keiner von ihnen. */}
      <Bahnkopf
        was={titel}
        wert={t("ins.scoreRate")}
        rechts={zeilen[0]?.genau === undefined ? undefined : t("ins.accuracyShort")}
        breite={mobile ? 112 : 124}
        wertBreite={52}
      />
      {zeilen.map((zeile, index) => (
        <Bahn
          key={zeile.name}
          name={zeile.name}
          neben={t("blatt.gamesN", { n: deInt(zeile.games) })}
          wert={zeile.wert}
          anzeige={zeile.games === 0 ? "—" : `${de(zeile.wert)} %`}
          rechts={
            zeile.genau === undefined
              ? undefined
              : zeile.genau == null
                ? "—"
                : `${de(zeile.genau)} %`
          }
          marke={50}
          markeFarbe="var(--color-ink3)"
          breite={mobile ? 112 : 124}
          wertBreite={52}
          hoehe={30}
          letzte={index === zeilen.length - 1}
        />
      ))}
    </div>
  );

  const kontext =
    (live.byOppStrength.length > 0 ||
      live.byTimeControl.length > 0 ||
      live.byLength.length > 0) && (
      <div>
        <Rubrik weg={t("ins.stContextSummary")}>{t("ins.stContextTitle")}</Rubrik>
        <div className={mobile ? "flex flex-col gap-5" : "flex gap-9"}>
          {live.byOppStrength.length > 0 &&
            kontextspalte(
              t("ins.oppStrengthTitle"),
              live.byOppStrength.map((eimer) => ({
                name: eimer.bucket,
                games: eimer.games,
                wert: eimer.winRate,
              }))
            )}
          {live.byTimeControl.length > 0 &&
            kontextspalte(
              t("ins.timeControlTitle"),
              live.byTimeControl.map((eimer) => ({
                name: eimer.tc,
                games: eimer.games,
                wert: eimer.winRate,
              }))
            )}
          {live.byLength.length > 0 &&
            kontextspalte(
              t("ins.lengthTitle"),
              live.byLength.map((eimer) => ({
                name: eimer.bucket,
                games: eimer.games,
                wert: eimer.scorePct,
                genau: eimer.accuracy,
              }))
            )}
        </div>
      </div>
    );

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {phasenblock}
        {ausgang}
        {vergleich}
        {anatomie}
        {endspiele}
        {kontext}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {phasenblock}
          {vergleich}
          {endspiele}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {ausgang}
          {anatomie}
        </div>
      </div>
      {/* Drei Spalten über die ganze Breite · in einer der beiden Spalten
          oben stünden die Beschriftungen abgeschnitten da. */}
      {kontext}
    </div>
  );
}
