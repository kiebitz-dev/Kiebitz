/**
 * Insights im Diagramm-Modus · das Profil.
 *
 * Die eine Stelle, an der der Entwurf die Form der App bewusst ändert: Aus dem
 * Netzdiagramm der Spieler-DNA werden sechs gestapelte Skalen. Sechs benannte
 * Achsen mit je einem Vergleichswert liest man auf Bahnen zuverlässig ab und
 * im Netz nur ungefähr; jede Zeile ist direkt beschriftet, deshalb braucht es
 * keine Legende. Der violette Strich ist dasselbe Maß für das Gegnerfeld — er
 * steht nur dort, wo er sich berechnen lässt.
 *
 * Genauigkeit und Patzerquote bekommen zwei getrennte Kurven. Zwei Größen mit
 * verschiedenen Skalen in ein Bild mit zwei Achsen zu legen ist der häufigste
 * Diagrammfehler überhaupt; zwei kleine Bilder untereinander kosten nichts und
 * lügen nicht.
 *
 * Die Reiterleiste wird zum Register mit Marke an der Kante. Diese Datei setzt
 * die Übersicht; die fünf Tiefenreiter stehen in `blatt/insights/` und bringen
 * ihren eigenen Formularkopf mit — Kolumnentitel und Register sind Hülle und
 * bleiben hier.
 */
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import {
  Ergebniskasten,
  Feldname,
  Figur,
  Formularkopf,
  Kennzahlen,
  Kolumnentitel,
  Kurve,
  Rubrik,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { de } from "../../lib/format";
import "../../components/blatt/blatt.css";

export interface DnaZeile {
  name: string;
  wert: number;
  /** Dasselbe Maß für das Gegnerfeld · null, wo es sich nicht rechnen lässt. */
  feld: number | null;
}

export interface Kennzahl {
  name: string;
  wert: string;
  neben: string;
}

export interface InsightsReiter {
  id: string;
  name: string;
  /** Trägt das Plus-Zeichen · gesperrte Tiefenreiter. */
  plus: boolean;
}

export interface InsightsBlattProps {
  mobile: boolean;
  kopfRechts: ReactNode;
  reiter: InsightsReiter[];
  aktiv: string;
  onReiter: (id: string) => void;
  felder: Feld[];
  /** Die schwächste Achse · der Kasten rechts. */
  schwaechste: string;
  dna: DnaZeile[];
  dnaNote: string;
  /** Woraus das gerechnet ist · vier Kennzahlen nebeneinander. */
  grundlage: Kennzahl[];
  /** Genauigkeit nach Phase · drei Kennzahlen. */
  phasen: Kennzahl[];
  /** Die Befunde · als fertige Blöcke von der Seite. */
  befunde: ReactNode;
  genauigkeit: number[];
  patzer: number[];
  kurvenNote: string;
  monateNote: string;
  /** Auf einem Tiefenreiter steht hier dessen Blatt · siehe blatt/insights/. */
  kinder?: ReactNode;
}

/** Eine Monatskurve mit ihren beiden Randwerten · zweimal auf diesem Blatt. */
function Monatsfigur({
  titel,
  werte,
  einheit,
  farbe,
  unten,
}: {
  titel: string;
  werte: number[];
  einheit: string;
  farbe: string;
  unten: string;
}) {
  if (werte.length < 2) return null;
  return (
    <Figur
      titel={titel}
      rechts={`${de(werte[werte.length - 1])}${einheit}`}
      links={`${de(werte[0])}${einheit}`}
      unten={unten}
    >
      <Kurve werte={werte} farbe={farbe} />
    </Figur>
  );
}

export default function InsightsBlatt({
  mobile,
  kopfRechts,
  reiter,
  aktiv,
  onReiter,
  felder,
  schwaechste,
  dna,
  dnaNote,
  grundlage,
  phasen,
  befunde,
  genauigkeit,
  patzer,
  kurvenNote,
  monateNote,
  kinder,
}: InsightsBlattProps) {
  const { t } = useI18n();

  const register = (
    <div className="mt-3.5 flex border-b border-line">
      {reiter.map((r) => {
        const an = r.id === aktiv;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onReiter(r.id)}
            aria-current={an ? "page" : undefined}
            className={`relative flex min-h-11 flex-1 items-center justify-center gap-1.5 text-[12.5px] ${
              an ? "font-semibold text-ink" : "text-ink3 hover:text-ink2"
            }`}
          >
            {/* Marke an der Kante, wie im Register der Hülle. */}
            {an && <span aria-hidden className="absolute inset-x-2.5 -bottom-px h-[2px] bg-ink" />}
            <span className="truncate">{r.name}</span>
            {!an && r.plus && <Sparkles size={11} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );

  const dnaBlock = (
    <div>
      <Rubrik>{t("dna.title")}</Rubrik>
      <div className="flex items-baseline gap-[11px] border-b border-line pb-[5px] pt-2">
        <span className="blatt-feld w-[86px] flex-none text-ink3">{t("blatt.axis")}</span>
        <span className="blatt-feld flex-1 text-ink3">0 – 100</span>
        <span className="blatt-feld w-[26px] text-end text-ink3">{t("dna.you")}</span>
        <span
          className="blatt-feld w-[34px] truncate text-end"
          style={{ color: "var(--color-violet)" }}
        >
          {t("dna.field")}
        </span>
      </div>
      {dna.map((zeile, index) => (
        <div
          key={zeile.name}
          className={`flex h-[38px] items-center gap-[11px] text-[12.5px] ${
            index === dna.length - 1 ? "" : "border-b border-line"
          }`}
        >
          <span className="w-[86px] flex-none truncate text-ink2">{zeile.name}</span>
          <span className="relative h-[11px] min-w-0 flex-1 border-b border-line2">
            <span
              className="absolute bottom-0 start-0 h-[9px] bg-ink"
              style={{ width: `${Math.max(0, Math.min(100, zeile.wert))}%` }}
            />
            {zeile.feld != null && (
              <span
                className="absolute -bottom-[3px] h-[17px] w-[2px]"
                style={{
                  insetInlineStart: `${Math.max(0, Math.min(100, zeile.feld))}%`,
                  background: "var(--color-violet)",
                }}
              />
            )}
          </span>
          <span className="blatt-zahl w-[26px] flex-none text-end text-[13.5px] text-ink">
            {zeile.wert}
          </span>
          <span
            className="blatt-zahl w-[34px] flex-none text-end text-[11px]"
            style={{ color: zeile.feld != null ? "var(--color-violet)" : "var(--color-ink3)" }}
          >
            {zeile.feld ?? "—"}
          </span>
        </div>
      ))}
      <div className="mt-2.5 text-[10.5px] leading-[1.6] text-ink3">{dnaNote}</div>
    </div>
  );

  const titelUndRegister = (
    <>
      <Kolumnentitel links={t("blatt.insightsTitle")} rechts={kopfRechts} />
      {register}
    </>
  );

  const kopf = (
    <>
      {titelUndRegister}
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1fr 1.2fr 1.4fr 1.4fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[80px] ps-2.5" : "w-[104px] ps-3.5"}`}>
          <Feldname>{t("blatt.weakest")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={13}>
              {schwaechste}
            </Ergebniskasten>
          </div>
        </div>
      </div>
    </>
  );

  // Ein Tiefenreiter bringt seinen eigenen Formularkopf mit · nur er weiß,
  // welche vier Zahlen seine Frage beantworten. Gemeinsam bleiben der
  // Kolumnentitel und das Register: Sie sind die Hülle, nicht die Seite.
  if (kinder) {
    return (
      <div
        className={`mx-auto flex min-h-full max-w-[1280px] flex-col ${
          mobile ? "px-3.5 pb-6 pt-3" : "px-10 pb-[22px] pt-6"
        }`}
      >
        {titelUndRegister}
        <div className="pt-5">{kinder}</div>
      </div>
    );
  }

  const links = (
    <div className={mobile ? "flex flex-col gap-6" : "flex w-[404px] flex-none flex-col justify-between gap-6"}>
      {dnaBlock}
      {grundlage.length > 0 && (
        <div>
          <Rubrik>{t("blatt.basis")}</Rubrik>
          <Kennzahlen zahlen={grundlage} gross={15} />
        </div>
      )}
      {phasen.length > 0 && (
        <div>
          <Rubrik>{t("blatt.accuracyByPhase")}</Rubrik>
          <Kennzahlen zahlen={phasen} gross={17} />
        </div>
      )}
    </div>
  );

  const rechts = (
    <div className="flex min-w-0 flex-1 flex-col">
      <Rubrik>{t("blatt.strongestFindings")}</Rubrik>
      <div className="mt-0.5">{befunde}</div>
      <div className="flex-1" />
      <Monatsfigur
        titel={t("blatt.accuracyByMonth")}
        werte={genauigkeit}
        einheit=" %"
        farbe="var(--color-ink)"
        unten={monateNote}
      />
      <Monatsfigur
        titel={t("blatt.blundersPer100")}
        werte={patzer}
        einheit=""
        farbe="var(--color-loss)"
        unten={monateNote}
      />
      <div className="mt-2.5 border-t border-line pt-2 text-[10.5px] leading-[1.6] text-ink3">
        {kurvenNote}
      </div>
    </div>
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-4">{links}</div>
        <div className="mt-6">{rechts}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1280px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {links}
        {rechts}
      </div>
    </div>
  );
}
