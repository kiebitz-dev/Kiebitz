/**
 * Einstellungen im Diagramm-Modus.
 *
 * Wenn der Modus an ist, gilt er auch hier. Aus den achtzehn Abschnittskarten
 * wird ein Verzeichnis, aus den Karten werden Rubriken mit Linien.
 *
 * Der Modus sortiert die Abschnitte nicht um — er setzt sie nur anders. Wer
 * eine Einstellung an ihrem Platz gelernt hat, findet sie hier an derselben
 * Stelle wieder; genau das ist der Unterschied zwischen einem Layoutmodus und
 * einer zweiten App.
 *
 * Der Inhalt jedes Abschnitts kommt unverändert von der Seite: Es sind
 * dieselben Eingaben, dieselben Schalter, dieselbe Speicherlogik.
 *
 * ── Warum das Telefon zuklappt ─────────────────────────────────────────────
 *
 * Auf dem Desktop steht jeder Abschnitt offen da: Ein Fenster hat den Platz.
 * Auf dem Telefon waren achtzehn offene Abschnitte eine Wand aus Text, durch
 * die man minutenlang wischt, um „Sprache" wiederzufinden — die gewöhnliche
 * Fassung klappt dort seit jeher zu, der Modus tat es nicht. Er tut es jetzt,
 * und zwar in seinem eigenen Satz: Die Seite ist zuerst ein Verzeichnis, in
 * dem ein Abschnitt dort aufschlägt, wo man ihn antippt.
 *
 * Das ist zugleich eine Frage der Last und nicht nur des Auges: Ein sichtbarer
 * Abschnitt meldet sich über `onSichtbar` und holt erst dann seine Daten.
 * Offen stehende Abschnitte zählten beim Öffnen der Seite Zeilen in Tabellen
 * mit Millionen Einträgen.
 *
 * ── Warum die Zeile nicht mehr in der Rubrik steht ─────────────────────────
 *
 * Die Zeile, die sagt, was ein Bereich enthält, stand bisher rechts in der
 * Rubrik — dort, wo im Satz der eine weiterführende Griff steht („Alle →").
 * Ein Griff ist ein Wort und darf nicht umbrechen, ein Satz ist keiner: Auf
 * dem Telefon schob „Zug-, Schlag- und Mattklänge · Motivhinweis im
 * Puzzle-Training" die Seite um achtzig Bildpunkte nach rechts und alles
 * darunter mit. Sie steht deshalb jetzt unter dem Titel, wo sie umbrechen
 * oder abschneiden darf.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Kolumnentitel,
  Rubrik,
  Verzeichnisteil,
  Verzeichniszeile,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { SectionTail } from "../settings/SettingsLayout";

export interface SettingsAbschnitt {
  id: string;
  titel: string;
  /** Eine Zeile, die sagt, was der Bereich enthält. */
  zeile: string;
  gruppe: string;
  inhalt: ReactNode;
}

export interface SettingsBlattProps {
  mobile: boolean;
  abschnitte: SettingsAbschnitt[];
  /** Überschrift einer Gruppe · derselbe Text wie in der Seite von heute. */
  gruppenTitel: (gruppe: string) => string;
  aktiv: string | null;
  /** Freiraum hinter dem letzten Abschnitt · siehe sectionTailHeight. */
  schluss?: number;
  /** Anker-Id eines Abschnitts · dieselbe wie in der gewöhnlichen Fassung. */
  ankerId: (id: string) => string;
  onSpringen: (id: string) => void;
  onSichtbar: (id: string) => void;
  /** Hinweise und Meldungen der Seite · stehen über dem Satzspiegel. */
  meldungen?: ReactNode;
  /** Der Speichern-Griff, falls die Seite einen hat. */
  speichern?: ReactNode;
}

/** Die laufende Nummer eines Abschnitts · zweistellig, damit die Spalte steht. */
const nummer = (index: number) => String(index + 1).padStart(2, "0");

/** Aufgeschlagen oder zu · das Zeichen des Formulars, kein Winkel. */
const ZU = "+";
const AUF = "−";

/**
 * Ein Abschnitt der Einstellungen.
 *
 * Auf dem Telefon ist er zuerst eine Verzeichniszeile: Nummer, Titel,
 * Punktlinie und rechts das Zeichen, ob er offen steht; darunter die Zeile,
 * die sagt, was drin ist. Aufgeschlagen bekommt er die Marke am Bund —
 * dieselbe, mit der das Register der Hülle das laufende Kapitel kennzeichnet.
 *
 * Auf dem Desktop entfällt der Griff, und der Abschnitt steht offen unter
 * seiner Rubrik.
 */
function Abschnitt({
  abschnitt,
  nr,
  mobile,
  ankerId,
  onSichtbar,
}: {
  abschnitt: SettingsAbschnitt;
  /** Laufende Nummer · dieselbe wie in der Sprungleiste daneben. */
  nr: string;
  mobile: boolean;
  ankerId: (id: string) => string;
  onSichtbar: (id: string) => void;
}) {
  const [offen, setOffen] = useState(false);
  const gezeigt = !mobile || offen;
  const { id, titel, zeile, inhalt } = abschnitt;

  useEffect(() => {
    if (gezeigt) onSichtbar(id);
  }, [gezeigt, id, onSichtbar]);

  if (!mobile) {
    return (
      <section id={ankerId(id)} data-settings-section={id} className="mt-7 min-w-0 scroll-mt-4">
        <Rubrik>{titel}</Rubrik>
        <p className="mt-2 text-[12px] leading-[1.5] text-ink3">{zeile}</p>
        <div className="min-w-0 pt-3.5">{inhalt}</div>
      </section>
    );
  }

  return (
    <section
      id={ankerId(id)}
      data-settings-section={id}
      className="relative min-w-0 scroll-mt-4 border-b border-line"
    >
      {offen && <span aria-hidden className="absolute inset-y-3 -start-2.5 w-[3px] bg-ink" />}
      <button
        type="button"
        onClick={() => setOffen((wert) => !wert)}
        aria-expanded={offen}
        aria-controls={`${ankerId(id)}-inhalt`}
        className="flex min-h-[52px] w-full items-baseline gap-2.5 py-2.5 text-start"
      >
        <span aria-hidden className="blatt-zahl w-[17px] shrink-0 text-[11px] text-ink3">
          {nr}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex w-full items-baseline gap-2">
            <span
              className={`min-w-0 truncate text-[14px] ${
                offen ? "font-semibold text-ink" : "text-ink2"
              }`}
            >
              {titel}
            </span>
            <span aria-hidden className="blatt-punktlinie" />
            <span aria-hidden className="blatt-zahl shrink-0 text-[13px] leading-none text-ink3">
              {offen ? AUF : ZU}
            </span>
          </span>
          <span className="block w-full truncate text-[11.5px] text-ink3">{zeile}</span>
        </span>
      </button>
      {offen && (
        <div id={`${ankerId(id)}-inhalt`} className="min-w-0 border-t border-line pb-5 pt-4">
          {inhalt}
        </div>
      )}
    </section>
  );
}

export default function SettingsBlatt({
  mobile,
  abschnitte,
  gruppenTitel,
  aktiv,
  schluss = 0,
  ankerId,
  onSpringen,
  onSichtbar,
  meldungen,
  speichern,
}: SettingsBlattProps) {
  const { t } = useI18n();

  // Die Sprungleiste daneben · Kapitel links, Punktlinie, Nummer rechts. Es
  // ist dieselbe Nummer, die auf dem Telefon vor der Zeile steht: Sie gibt der
  // Punktlinie ein Ziel und macht einen Bereich benennbar.
  const register = (
    <div className="hidden min-w-0 min-[1160px]:block">
      <nav aria-label={t("set.sections")} className="sticky top-0 flex flex-col pt-1">
        {abschnitte.map((abschnitt, index) => (
          <Fragment key={abschnitt.id}>
            {abschnitt.gruppe !== abschnitte[index - 1]?.gruppe && (
              <Verzeichnisteil>{gruppenTitel(abschnitt.gruppe)}</Verzeichnisteil>
            )}
            <Verzeichniszeile
              name={abschnitt.titel}
              zahl={nummer(index)}
              aktiv={abschnitt.id === aktiv}
              hoehe={34}
              onClick={() => onSpringen(abschnitt.id)}
            />
          </Fragment>
        ))}
      </nav>
    </div>
  );

  const liste = (
    <div className="flex min-w-0 flex-col">
      {abschnitte.map((abschnitt, index) => (
        <Fragment key={abschnitt.id}>
          {abschnitt.gruppe !== abschnitte[index - 1]?.gruppe && (
            <div className={index === 0 ? "" : "mt-8"}>
              <Kolumnentitel links={gruppenTitel(abschnitt.gruppe)} />
            </div>
          )}
          {/* Kein Rahmen, keine Karte · Verzeichniszeile und Haarlinie. */}
          <Abschnitt
            abschnitt={abschnitt}
            nr={nummer(index)}
            mobile={mobile}
            ankerId={ankerId}
            onSichtbar={onSichtbar}
          />
        </Fragment>
      ))}
      <SectionTail height={schluss} />
    </div>
  );

  return (
    // `blatt-formular` setzt die Bedienteile der Abschnitte in den
    // Formularsatz um · die Regeln dazu stehen in blatt.css und gelten nur
    // hier.
    <div className="blatt-formular mx-auto flex w-full min-w-0 max-w-[860px] flex-col px-4 pb-8 pt-6 sm:px-10 min-[1160px]:max-w-[1096px]">
      <Kolumnentitel links={t("blatt.settingsTitle")} rechts={speichern} />
      {meldungen && <div className="mt-4">{meldungen}</div>}
      {mobile ? (
        <div className="mt-2">{liste}</div>
      ) : (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-x-8 min-[1160px]:grid-cols-[188px_minmax(0,1fr)]">
          {register}
          {liste}
        </div>
      )}
    </div>
  );
}
