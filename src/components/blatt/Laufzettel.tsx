/**
 * Der Laufzettel · ein laufender Stapel im Satz des Blattes.
 *
 * Die gewöhnliche Fassung zeigt einen Kreisel, einen Satz und eine
 * abgerundete Pille. Auf einem Bogen gibt es beides nicht: Ein Formular dreht
 * sich nicht, und was zählt, steht in Feldern und wird abgestrichen.
 *
 * Deshalb steht hier ein Zettel, wie ihn die Turnierleitung führt: zwei
 * Zeilen, jede mit ihrer Beschriftung, ihrer Zählung und ihrem Strich. Oben
 * der Stapel — die wievielte Partie von wie vielen —, unten die Partie selbst
 * — der wievielte Zug von wie vielen. Der Gegner steht am Ende der oberen
 * Zeile, wo auf einem Zettel der Name steht.
 *
 * Zwei Striche und nicht einer: Beides sind Größen, und übereinander gelegt
 * wäre keine mehr abzulesen. Bei zweihundert Partien ist eine einzelne im
 * Stapelstrich ein halber Bildpunkt breit — der Zugstrich wäre in ihm
 * unsichtbar.
 *
 * Ohne Meldung vom Backend (der erste Augenblick eines Laufs) trägt der Zettel
 * nur seine Überschrift. Erfundene Zahlen stehen dort nicht; ein Formular, in
 * dem etwas steht, was niemand gemessen hat, ist schlimmer als ein leeres.
 *
 * Kein Farbwert und keine Zeichnung · `Balken` ist derselbe Kasten aus einer
 * Haarlinie, der im Repertoire die Abdeckung trägt.
 */
import { Balken } from "./Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import "./blatt.css";

export interface LaufStand {
  /** Die wievielte Partie des Stapels · 1-basiert, wie sie gezählt wird. */
  partie: number;
  partienGesamt: number;
  opponent: string;
  /** Halbzüge · gerechnet wird in ihnen, angezeigt werden ganze Züge. */
  halbzug: number;
  halbzuege: number;
}

/** Anteil in Prozent, gegen Null und gegen eine fehlende Gesamtzahl gesichert. */
function anteil(teil: number, ganzes: number): number {
  if (!Number.isFinite(ganzes) || ganzes <= 0) return 0;
  return Math.max(0, Math.min(100, (teil / ganzes) * 100));
}

/**
 * Eine Zeile des Zettels · Beschriftung, Zählung, Strich.
 *
 * Die Zählung steht in einer Spalte fester Breite und rechtsbündig vor dem
 * Bruchstrich: So springt der Strich nicht, wenn aus „9" eine „10" wird.
 */
function Zeile({
  label,
  ist,
  soll,
  rechts,
}: {
  label: string;
  ist: number;
  soll: number;
  rechts?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="blatt-feld w-[52px] flex-none text-ink3">{label}</span>
      <span className="blatt-zahl w-[86px] flex-none whitespace-nowrap text-[12.5px] text-ink">
        <span className="inline-block min-w-[30px] text-end">{deInt(ist)}</span>
        <span className="text-ink3"> / </span>
        {deInt(soll)}
      </span>
      <span className="min-w-[60px] flex-1">
        <Balken anteil={anteil(ist, soll)} hoehe={7} />
      </span>
      {/* Die Namensspalte steht auch dort, wo kein Name hingehört · sonst
          endeten die beiden Striche des Zettels an verschiedenen Stellen, und
          zwei Größen, die man vergleichen soll, hätten verschiedene Maßstäbe. */}
      <span className="buch w-[136px] flex-none truncate text-end text-[13px] italic text-ink2">
        {rechts}
      </span>
    </div>
  );
}

export function Laufzettel({
  stand,
  onStopp,
}: {
  /** Der gemeldete Stand · fehlt er, läuft die Analyse gerade erst an. */
  stand: LaufStand | null;
  onStopp: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="w-full min-w-0 basis-full border-y border-ink py-2.5">
      <div className="flex items-baseline gap-4">
        <span className="blatt-kolumne min-w-0 flex-1 truncate text-ink3">
          {t("an.running")}
        </span>
        {/* Der Abbruch steht eingekastelt am rechten Rand · dieselbe Form wie
            das Ergebnisfeld des Formulars, weil beides eine Eintragung ist,
            die den Zettel abschließt. */}
        <button
          type="button"
          onClick={onStopp}
          className="blatt-kolumne flex-none border border-ink px-3 py-1.5 text-ink hover:text-accent"
        >
          {t("an.stop")}
        </button>
      </div>
      {stand && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          <Zeile
            label={t("an.game")}
            ist={stand.partie}
            soll={stand.partienGesamt}
            rechts={stand.opponent}
          />
          <Zeile
            label={t("common.moves.one")}
            ist={Math.ceil(stand.halbzug / 2)}
            soll={Math.ceil(stand.halbzuege / 2)}
          />
        </div>
      )}
    </div>
  );
}
