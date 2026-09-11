/**
 * Eröffnungen im Diagramm-Modus.
 *
 * Die Seite, auf der die Notation im Satz steht: Grundzug links, Familienname
 * kursiv im Buchsatz, die Züge einer wackeligen Linie als Zug und nicht als
 * umschriebener Text.
 *
 * Auf jeder Bahn dieses Blattes steht derselbe violette Strich: der eigene
 * Schnitt über alle Partien. Eine Punktequote ohne dieses Maß ist nicht zu
 * lesen — 46 % klingt nach wenig und ist über dem eigenen Schnitt womöglich
 * gut. Die Legende dazu steht als Fußnote und nicht als Kasten daneben.
 *
 * Die Lücken holt dieses Blatt selbst, wie es die gewöhnliche Fassung tut:
 * Sie stehen nicht in der Tiefenauswertung, sondern werden erst beim Öffnen
 * des Reiters am Buch entlanggerechnet · deshalb dieselbe Bedingung wie dort
 * (nur am Rechner, nur mit angelegtem Repertoire).
 *
 * Familien und gespielte Eröffnungen sind zwei verschiedene Fragen und
 * standen deshalb schon drüben als zwei Abschnitte: Die Familie ist die
 * Trainingseinheit („Sizilianisch"), der gespielte Name ist das, was in den
 * Partien steht („Sicilian Defense: Alapin, 2…d5"). Das Verzeichnis der
 * gespielten Namen fehlte hier lange — mit ihm ist der Reiter wieder
 * vollständig. Es kommt aus derselben Auswertung wie drüben (`live`), nicht
 * aus einer eigenen Rechnung.
 */
import { useEffect, useState } from "react";
import {
  Bahn,
  Blatttabelle,
  Farbfeld,
  Fussnote,
  Kennzahlen,
  Rangzeile,
  Rubrik,
  Weg,
} from "../../../components/blatt/Satz";
import { useI18n } from "../../../lib/i18n";
import { de, deInt } from "../../../lib/format";
import { repGaps, type RepGap } from "../../../lib/repertoire";
import type { DeepInsights, OpeningFamily } from "../../../lib/insights";
import type { LiveInsights } from "../../../lib/stats";
import Reiterkopf from "./Reiterkopf";

export default function OpeningsBlatt({
  mobile,
  deep,
  live,
  desktop,
  onOpenRepertoire,
}: {
  mobile: boolean;
  deep: DeepInsights;
  /** Die gespielten Eröffnungsnamen · dieselbe Quelle wie drüben. */
  live: LiveInsights;
  desktop: boolean;
  onOpenRepertoire: () => void;
}) {
  const { t } = useI18n();
  const { repertoire, openings } = deep;
  const [gaps, setGaps] = useState<RepGap[] | null>(null);

  // Dieselbe Bedingung wie in der gewöhnlichen Fassung · die Lückenkarte
  // spielt jede Partie am Buch entlang und lädt erst, wenn der Reiter offen
  // ist und ein Repertoire überhaupt existiert.
  useEffect(() => {
    if (!desktop || repertoire.nodes === 0 || gaps) return;
    let abgebrochen = false;
    repGaps(20, 400, 10)
      .then((liste) => !abgebrochen && setGaps(liste))
      .catch(() => !abgebrochen && setGaps([]));
    return () => {
      abgebrochen = true;
    };
  }, [desktop, repertoire.nodes, gaps]);

  const summe = repertoire.by_side.reduce(
    (stand, seite) => ({
      partien: stand.partien + seite.games,
      buch: stand.buch + seite.in_book,
      meine: stand.meine + seite.mine,
      ihre: stand.ihre + seite.theirs,
    }),
    { partien: 0, buch: 0, meine: 0, ihre: 0 }
  );
  const schnitt = openings.baseline_score;
  // Die schwächste Familie · dieselbe Frage wie „schwächste Achse" auf der
  // Übersicht, nur eine Ebene tiefer.
  const schwaechste = [...openings.families]
    .filter((familie) => familie.games >= 5)
    .sort((a, b) => a.score_pct - b.score_pct)[0];

  const kopf = (
    <Reiterkopf
      mobile={mobile}
      spalten="1.15fr 1.35fr 1.5fr 1.2fr"
      felder={[
        {
          label: t("ins.opInBook"),
          wert: t("ins.opInBookSub", { n: deInt(summe.buch), total: deInt(summe.partien) }),
          gross: true,
        },
        {
          label: t("ins.opMineFirst"),
          wert: (
            <>
              <span className="blatt-zahl">{deInt(summe.meine)}</span>
              {" · "}
              {t("ins.opMineFirstSub")}
            </>
          ),
        },
        {
          label: t("ins.opTheirsFirst"),
          wert: (
            <>
              <span className="blatt-zahl">{deInt(summe.ihre)}</span>
              {" · "}
              {t("ins.opTheirsFirstSub")}
            </>
          ),
        },
        {
          label: t("ins.opNodes"),
          wert: (
            <>
              <span className="blatt-zahl">{deInt(repertoire.nodes)}</span>
              {" · "}
              {t("ins.opNodesSub", { n: deInt(repertoire.plies) })}
            </>
          ),
        },
      ]}
      kasten={{
        label: t("blatt.weakest"),
        wert: schwaechste ? schwaechste.label : "—",
        gross: 10,
      }}
    />
  );

  const abweichung = repertoire.by_side.length > 0 && (
    <div>
      <Rubrik
        weg={t("ins.opDeviationSummary", {
          n: deInt(summe.meine),
          total: deInt(summe.partien),
        })}
      >
        {t("ins.opDeviationTitle")}
      </Rubrik>
      {repertoire.by_side.map((seite) => {
        const zeilen = [
          {
            name: t("ins.opStayed"),
            neben: t("ins.opStayedNote", { n: deInt(seite.in_book) }),
            wert: seite.in_book_score,
          },
          {
            name: t("ins.opTheyLeft"),
            neben: t("ins.opLeftNote", {
              n: deInt(seite.theirs),
              m: deInt(Math.ceil(seite.avg_theirs_move)),
            }),
            wert: seite.theirs_score,
          },
          {
            name: t("ins.opILeft"),
            neben: t("ins.opLeftNote", {
              n: deInt(seite.mine),
              m: deInt(Math.ceil(seite.avg_mine_move)),
            }),
            wert: seite.mine_score,
          },
        ];
        return (
          <div key={seite.side} className="mt-3">
            <div className="flex items-baseline gap-2">
              <Farbfeld farbe={seite.side} />
              <span className="text-[13px] text-ink">
                {t(seite.side === "white" ? "common.white" : "common.black")}
              </span>
              <span aria-hidden className="blatt-punktlinie" />
              <span className="blatt-zahl shrink-0 text-[11px] text-ink3">
                {t("blatt.gamesN", { n: deInt(seite.games) })}
              </span>
            </div>
            {zeilen.map((zeile, index) => (
              <Bahn
                key={zeile.name}
                name={zeile.name}
                neben={zeile.neben}
                wert={zeile.wert}
                anzeige={`${de(zeile.wert)} %`}
                marke={schnitt}
                markeTitel={t("ins.opFamilyLegend", { b: de(schnitt) })}
                breite={mobile ? 116 : 118}
                hoehe={34}
                letzte={index === zeilen.length - 1}
              />
            ))}
          </div>
        );
      })}
      <Fussnote>{t("ins.opDeviationNote")}</Fussnote>
    </div>
  );

  const wackelig = repertoire.shaky.length > 0 && (
    <div>
      <Rubrik weg={t("ins.opShakySummary", { n: deInt(repertoire.shaky.length) })}>
        {t("ins.opShakyTitle")}
      </Rubrik>
      {repertoire.shaky.map((linie, index) => (
        <Rangzeile
          key={linie.node_id}
          rang={index + 1}
          titel={
            <>
              {linie.line || t("ins.opRootLine")}{" "}
              <span className="notation blatt-zahl text-ink2">{linie.san}</span>
            </>
          }
          unter={
            <>
              {t(linie.side === "white" ? "common.white" : "common.black")} ·{" "}
              {t("ins.opLapses", { n: deInt(linie.lapses) })} ·{" "}
              {t("ins.opShakyHint", { g: deInt(linie.games), r: deInt(linie.reps) })}
            </>
          }
          rechts={t("blatt.days", { n: de(linie.stability) })}
          rechtsUnter={t("blatt.stability")}
          letzte={index === repertoire.shaky.length - 1}
        />
      ))}
      <Fussnote>{t("ins.opShakyNote")}</Fussnote>
    </div>
  );

  /** Eine Familie · Grundzug, Name im Buchsatz, Bahn mit dem eigenen Schnitt. */
  const familienzeile = (familie: OpeningFamily, letzte: boolean) => (
    <div key={familie.key} className={`py-[9px] ${letzte ? "" : "border-b border-line"}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="notation blatt-zahl w-10 flex-none text-[12px] text-ink3">
          {familie.root}
        </span>
        <span className="buch min-w-0 flex-1 truncate text-[14.5px] italic text-ink">
          {familie.label}
        </span>
        <span className="blatt-zahl flex-none text-[11px] text-ink3">
          {t("blatt.gamesN", { n: deInt(familie.games) })}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-[11px]">
        <span className="w-10 flex-none" />
        <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
          <span
            className="absolute bottom-0 start-0 h-[9px]"
            style={{
              width: `${Math.max(0, Math.min(100, familie.score_pct)).toFixed(1)}%`,
              background:
                familie.score_pct >= schnitt ? "var(--color-win)" : "var(--color-loss)",
            }}
          />
          <span
            title={t("ins.opFamilyLegend", { b: de(schnitt) })}
            className="absolute -bottom-[3px] h-[17px] w-[2px]"
            style={{
              insetInlineStart: `${Math.max(0, Math.min(100, schnitt)).toFixed(1)}%`,
              background: "var(--color-violet)",
            }}
          />
        </span>
        <span className="blatt-zahl w-[52px] flex-none text-end text-[13px] text-ink">
          {de(familie.score_pct)} %
        </span>
      </div>
      <div className="mt-1 flex gap-[11px]">
        <span className="w-10 flex-none" />
        <span className="blatt-zahl flex-1 text-[10.5px] text-ink3">
          {t("ins.opFamilyNote", {
            n: deInt(familie.games),
            m: deInt(
              familie.avg_departure_ply > 0 ? Math.ceil(familie.avg_departure_ply / 2) : 0
            ),
            a: familie.opening_accuracy == null ? "—" : de(familie.opening_accuracy),
          })}
        </span>
      </div>
    </div>
  );

  const familienGruppe = (seite: "white" | "black") => {
    const gruppe = openings.families.filter((familie) => familie.color === seite);
    if (gruppe.length === 0) return null;
    return (
      <div>
        <Rubrik
          weg={t(seite === "white" ? "ins.opFamiliesWhiteSub" : "ins.opFamiliesBlackSub", {
            n: deInt(gruppe.length),
            b: de(schnitt),
          })}
        >
          {t(seite === "white" ? "ins.opFamiliesWhite" : "ins.opFamiliesBlack")}
        </Rubrik>
        {gruppe.map((familie, index) =>
          familienzeile(familie, index === gruppe.length - 1)
        )}
      </div>
    );
  };

  /**
   * Die gespielten Eröffnungen · Bahnen mit der 50-%-Marke.
   *
   * Die gewöhnliche Fassung färbt die Balken über und unter 50 %; im Blatt
   * steht der Strich auf der Bahn und sagt dasselbe, ohne eine zweite Farbe
   * einzuführen. Die Namen kommen ungekürzt aus der Partie und stehen deshalb
   * im Buchsatz kursiv, wie jeder Eröffnungsname in diesem Modus.
   */
  const gespielt = live.openings.length > 0 && (
    <div>
      <Rubrik weg={t("ins.opPlayedSummary")}>{t("ins.openingsTitle")}</Rubrik>
      {live.openings.map((eroeffnung, index) => (
        <Bahn
          key={eroeffnung.name}
          name={<span className="buch italic text-[13.5px]">{eroeffnung.name}</span>}
          neben={t("blatt.gamesN", { n: deInt(eroeffnung.games) })}
          wert={eroeffnung.win}
          anzeige={`${de(eroeffnung.win)} %`}
          marke={50}
          markeFarbe="var(--color-ink3)"
          breite={mobile ? 118 : 152}
          wertBreite={52}
          hoehe={32}
          letzte={index === live.openings.length - 1}
        />
      ))}
      <Fussnote>{t("ins.winRate")}</Fussnote>
    </div>
  );

  const akte = openings.families.length > 0 && (
    <div>
      <Rubrik weg={t("ins.opTableSummary")}>{t("ins.openingTableTitle")}</Rubrik>
      <Blatttabelle
        hoehe={27}
        spalten={[
          { label: t("ins.opening"), buch: true },
          { label: t("ins.color"), breite: 54, blass: true },
          { label: t("ins.games"), breite: 52, rechts: true, zahl: true, blass: true },
          { label: t("ins.scoreRate"), breite: 56, rechts: true, zahl: true },
          { label: t("ins.accuracyShort"), breite: 74, rechts: true, zahl: true, blass: true },
          { label: t("ins.opInBook"), breite: 54, rechts: true, zahl: true, blass: true },
        ]}
        zeilen={openings.families.map((familie) => [
          familie.label,
          t(familie.color === "white" ? "common.white" : "common.black"),
          deInt(familie.games),
          `${de(familie.score_pct)} %`,
          familie.accuracy == null ? "—" : `${de(familie.accuracy)} %`,
          deInt(familie.in_book),
        ])}
      />
      <Fussnote>{t("ins.opFamilyLegend", { b: de(schnitt) })}</Fussnote>
    </div>
  );

  // Die Lücken · nur am Rechner und nur mit Buch, sonst gäbe es nichts
  // abzugleichen. Der Ladezustand steht nicht als Zeile da: Ein Blatt, auf dem
  // „wird geladen" steht, ist kein Blatt.
  const luecken = desktop && repertoire.nodes > 0 && gaps != null && (
    <div>
      <Rubrik weg={t("ins.opGapsSummary", { n: deInt(gaps.length) })}>
        {t("ins.opGapsTitle")}
      </Rubrik>
      {gaps.length === 0 ? (
        <div className="py-3 text-[12.5px] text-ink3">{t("ins.opNoGaps")}</div>
      ) : (
        <>
          {gaps.map((luecke, index) => (
            <Rangzeile
              key={`${luecke.node_id}-${luecke.side}-${luecke.san}`}
              rang={index + 1}
              titel={
                <>
                  {luecke.line || t("ins.opRootLine")}{" "}
                  <span className="notation blatt-zahl text-ink2">{luecke.san}</span>
                </>
              }
              unter={
                <>
                  {t(luecke.mine ? "ins.opGapMine" : "ins.opGapTheirs", {
                    n: deInt(luecke.count),
                  })}
                  {luecke.book_sans.length > 0 &&
                    ` · ${t("ins.opBookKnows")}: ${luecke.book_sans.join(", ")}`}
                </>
              }
              rechts={`${de(luecke.score_pct)} %`}
              letzte={index === gaps.length - 1}
            />
          ))}
          <div className="mt-1">
            <Weg onClick={onOpenRepertoire}>{t("fnd.action.repertoire")}</Weg>
          </div>
        </>
      )}
    </div>
  );

  const buchstand = (
    <Kennzahlen
      zahlen={[
        { name: t("ins.opNodes"), wert: deInt(repertoire.nodes), neben: t("ins.opNodesSub", { n: deInt(repertoire.plies) }) },
        { name: t("ins.games"), wert: deInt(repertoire.checked_games) },
        { name: t("ins.opInBook"), wert: deInt(summe.buch), neben: deInt(summe.partien) },
        { name: t("ins.opMineFirst"), wert: deInt(summe.meine), neben: deInt(summe.partien) },
      ]}
    />
  );

  if (mobile) {
    return (
      <div className="flex flex-col gap-6">
        {kopf}
        {abweichung}
        {familienGruppe("white")}
        {familienGruppe("black")}
        {gespielt}
        {wackelig}
        {luecken}
        {akte}
        {buchstand}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9">
        <div className="flex w-[404px] flex-none flex-col gap-6">
          {abweichung}
          {wackelig}
          {buchstand}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {familienGruppe("white")}
          {familienGruppe("black")}
          {gespielt}
          {luecken}
          {akte}
        </div>
      </div>
    </div>
  );
}
