/**
 * Gegen die Engine im Diagramm-Modus · ein Partieformular.
 *
 * Eine Partie gegen die Engine ist eine Partie: Oben der Kopf des
 * Turnierzettels mit Gegner, eigener Farbe, Ausgangsstellung und Bedenkzeit,
 * rechts daneben der Kasten fürs Ergebnis, der leer bleibt, bis es eins gibt.
 * Links das Brett, rechts die Mitschrift in Buchsatz und darunter, als eigene
 * Rubrik, wie die nächste Partie beginnt.
 *
 * Die Einstellungen kommen fertig von der Seite: Sie sind Bedienung und nicht
 * Satz, und zweimal gebaut liefen sie auseinander. `.blatt-formular` nimmt den
 * gewöhnlichen Knöpfen darin Rundung und Fläche (siehe blatt.css).
 */
import type { ReactNode } from "react";
import FocusBoard from "../../components/FocusBoard";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  Schalterreihe,
  Zugfolge,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";

export interface PlayBlattProps {
  mobile: boolean;
  felder: Feld[];
  /** „1 : 0", „½ : ½" oder ein Strich, solange gespielt wird. */
  ergebnis: string;
  oben: { name: string; farbe: "white" | "black" };
  unten: { name: string; farbe: "white" | "black" };
  stand: ReactNode;
  brett: ReactNode;
  zuege: string[];
  ersterHalbzugSchwarz: boolean;
  ersteZugnummer: number;
  schalter: { label: ReactNode; onClick?: () => void; betont?: boolean }[];
  einstellungen: ReactNode;
  fokus: {
    offen: boolean;
    onSchliessen: () => void;
    titel: string;
    untertitel?: string;
    brett: ReactNode;
  };
  fehler?: string | null;
}

/** Die Mitschrift · Zugnummer vor Weiß, bei Schwarz am Anfang mit Auslassung. */
function mitschrift(zuege: string[], schwarzZuerst: boolean, erste: number): string {
  const teile: string[] = [];
  zuege.forEach((san, index) => {
    const halbzug = index + (schwarzZuerst ? 1 : 0);
    const nummer = erste + Math.floor(halbzug / 2);
    if (halbzug % 2 === 0) teile.push(`${nummer}.${san}`);
    else teile.push(index === 0 ? `${nummer}…${san}` : san);
  });
  return teile.join(" ");
}

export default function PlayBlatt({
  mobile,
  felder,
  ergebnis,
  oben,
  unten,
  stand,
  brett,
  zuege,
  ersterHalbzugSchwarz,
  ersteZugnummer,
  schalter,
  einstellungen,
  fokus,
  fehler,
}: PlayBlattProps) {
  const { t } = useI18n();

  const zeile = (spieler: { name: string; farbe: "white" | "black" }, rechts?: ReactNode) => (
    <div className="flex items-center gap-[9px]">
      <Farbfeld farbe={spieler.farbe} kante={11} />
      <span className="truncate text-[14px] text-ink">{spieler.name}</span>
      <span className="flex-1" />
      {rechts != null && <span className="text-[12.5px] text-accent">{rechts}</span>}
    </div>
  );

  const brettSpalte = (
    <div className={mobile ? "flex flex-col" : "flex w-[var(--board-edge)] max-w-full flex-none flex-col"}>
      <div className="pb-[9px]">{zeile(oben)}</div>
      {brett}
      <div className="pt-[9px]">{zeile(unten, stand)}</div>
      <div className="mt-3">
        <Schalterreihe eintraege={schalter} />
      </div>
      {fehler && <p className="mt-2 text-[12.5px] text-loss">{fehler}</p>}
    </div>
  );

  const rechts = (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div>
        <Rubrik>{t("play.notation")}</Rubrik>
        <div className="mt-2 min-h-[48px]">
          {zuege.length === 0 ? (
            <p className="text-[12.5px] text-ink3">{t("play.noMoves")}</p>
          ) : (
            <Zugfolge>{mitschrift(zuege, ersterHalbzugSchwarz, ersteZugnummer)}</Zugfolge>
          )}
        </div>
      </div>
      <div>
        <Rubrik>{t("play.newGameTitle")}</Rubrik>
        <div className="blatt-formular mt-3">{einstellungen}</div>
      </div>
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("play.title")} rechts={t("play.subtitleShort")} />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "1.5fr 0.8fr 1.2fr 0.8fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-[120px] ps-3.5"}`}>
          <Feldname>{t("play.result")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {ergebnis}
            </Ergebniskasten>
          </div>
        </div>
      </div>
    </>
  );

  const fokusBogen = (
    <FocusBoard
      open={fokus.offen}
      onClose={fokus.onSchliessen}
      title={fokus.titel}
      subtitle={fokus.untertitel}
      above={zeile(oben)}
      below={
        <div>
          {zeile(unten, stand)}
          <div className="mt-3">
            <Schalterreihe eintraege={schalter} />
          </div>
        </div>
      }
    >
      {fokus.brett}
    </FocusBoard>
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3.5">{brettSpalte}</div>
        <div className="mt-4">{rechts}</div>
        {fokusBogen}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1240px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        {rechts}
      </div>
      {fokusBogen}
    </div>
  );
}
