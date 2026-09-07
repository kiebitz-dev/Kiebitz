/**
 * Eine Partie als Zeile eines Registers — nicht als Karte.
 *
 * Am Rechner die Zeile aus dem Turnierbuch: laufende Angaben nebeneinander,
 * Haarlinie darunter, Ergebnis als Punkt statt als Pille, gespielte Farbe als
 * Feld statt als eigener Wortspalte.
 *
 * Auf dem Telefon wird daraus ein zweizeiliger Eintrag. Die neunspaltige
 * Tabelle ließe sich dort nur quer scrollend lesen, und ein Blatt, das seitlich
 * wegläuft, ist kein Blatt mehr.
 *
 * Zwei Marken am Zeilenende ersetzen die Tag-Spalte: gefülltes Quadrat = Notiz
 * vorhanden, leeres = noch ohne Analyse. Der Schlüssel dazu steht unter der
 * Liste, wie in jedem Band.
 *
 * `filter` macht aus einzelnen Angaben Griffe: Datum, Farbfeld, Gegner,
 * Eröffnung, ECO und Ergebnispunkt führen dann nicht in die Partie, sondern in
 * das Partienverzeichnis, auf genau diese Angabe eingeschränkt — dieselbe
 * Bewegung wie in der gewöhnlichen Fassung. Weil eine Schaltfläche nicht in
 * einer Schaltfläche stehen darf, wird die Zeile in diesem Fall zur Fläche mit
 * `role="button"`; ohne `filter` bleibt sie die schlichte Schaltfläche, die sie
 * war.
 *
 * Zwei der Griffe tragen keinen Text: das Kästchen der gespielten Farbe und
 * der Ergebnispunkt. Sie bekommen deshalb ihre Beschriftung aus dem
 * Wörterbuch — ein Griff ohne Namen ist für eine Vorlesehilfe kein Griff.
 */
import type { ReactNode } from "react";
import type { UiGame } from "../../lib/gameUi";
import { de } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { Farbfeld, Punkt } from "./Satz";
import "./blatt.css";

/** Was sich aus einer Zeile heraus filtern lässt · fehlt einer, bleibt die
 *  Angabe stehender Text. */
export interface ZeilenFilter {
  onDatum?: () => void;
  /** Das Kästchen vor dem Namen · „Partien als Weiß" bzw. „als Schwarz". */
  onFarbe?: () => void;
  onGegner?: () => void;
  onEroeffnung?: () => void;
  /** Die ECO-Kennung · gröber als der Eröffnungsname, absichtlich. */
  onEco?: () => void;
  /** Der Punkt am Zeilenende · Siege, Remisen oder Niederlagen. */
  onErgebnis?: () => void;
}

export interface PartieZeileProps {
  game: UiGame;
  mobile: boolean;
  /** Der laufende Eintrag bekommt die Marke am Bund, wie im Register. */
  aktiv?: boolean;
  /** Gefülltes Quadrat · zu dieser Partie steht eine Notiz. */
  notiz?: boolean;
  /** Leeres Quadrat · diese Partie ist noch ohne Analyse. */
  offen?: boolean;
  /** Griffe in einzelnen Spalten · nur am Rechner, siehe oben. */
  filter?: ZeilenFilter;
  onClick: () => void;
}

/**
 * Eine Angabe, die zugleich ein Filtergriff sein kann.
 *
 * Ohne `onClick` steht sie als Text da · so trägt dieselbe Zeile beide Fälle,
 * ohne dass der Satz sich unterscheidet.
 */
function Angabe({
  onClick,
  className,
  beschriftung,
  stumm = false,
  children,
}: {
  onClick?: () => void;
  className: string;
  /** Name des Griffs · Pflicht, wo die Spalte selbst keinen Text trägt. */
  beschriftung?: string;
  /**
   * Die Spalte zeigt keine Schriftfarbe (Kästchen, Punkt) · dort sagt die
   * Deckkraft, dass hier etwas anzufassen ist, und nicht der Akzent.
   */
  stumm?: boolean;
  children: ReactNode;
}) {
  if (!onClick) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      title={beschriftung}
      aria-label={beschriftung}
      onClick={(event) => {
        // Der Griff gilt der Spalte, nicht der Zeile · sonst öffnete er
        // zugleich die Partie.
        event.stopPropagation();
        onClick();
      }}
      className={`${className} text-start ${stumm ? "hover:opacity-60" : "hover:text-accent"}`}
    >
      {children}
    </button>
  );
}

export function PartieZeile({
  game,
  mobile,
  aktiv = false,
  notiz = false,
  offen = false,
  filter,
  onClick,
}: PartieZeileProps) {
  const { t } = useI18n();
  const ergebnisWort =
    game.result === "win"
      ? t("games.wins")
      : game.result === "loss"
        ? t("games.losses")
        : t("games.draws");
  const marke = notiz ? (
    <span aria-hidden className="inline-block h-[7px] w-[7px] bg-ink" />
  ) : offen ? (
    <span aria-hidden className="inline-block h-[7px] w-[7px] border border-line2" />
  ) : null;

  if (mobile) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="relative flex min-h-14 w-full items-center gap-2.5 border-b border-line text-start"
      >
        {aktiv && <span aria-hidden className="absolute inset-y-2 -start-3.5 w-[3px] bg-ink" />}
        <Farbfeld farbe={game.color} kante={9} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{game.opponent}</span>
            <span className="blatt-zahl text-[11px] text-ink3">{game.oppElo}</span>
          </span>
          <span className="buch block truncate text-[13px] italic text-ink2">{game.opening}</span>
        </span>
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span className="blatt-zahl text-[15px] font-medium">
            <Punkt ergebnis={game.result} />
          </span>
          <span className="blatt-zahl text-[10.5px] text-ink3">{game.date}</span>
        </span>
        <span className="flex w-2.5 flex-none justify-center">{marke}</span>
      </button>
    );
  }

  const inhalt = (
    <>
      {aktiv && <span aria-hidden className="absolute inset-y-1.5 -start-3.5 w-[3px] bg-ink" />}
      {/* Der Entwurf setzt hier „11.07." · die App schreibt das Datum in der
          Form der Sprache, und die ist länger. Lieber die Spalte breiter als
          das Datum beschnitten. */}
      <Angabe
        onClick={filter?.onDatum}
        className="blatt-zahl w-[76px] flex-none whitespace-nowrap text-ink3"
      >
        {game.date}
      </Angabe>
      {/* Das Kästchen behält seine zehn Bildpunkte in der Reihe; als Griff
          reicht es über die volle Zeilenhöhe, damit es zu treffen ist. */}
      <Angabe
        onClick={filter?.onFarbe}
        beschriftung={t("games.filterColor", {
          v: t(game.color === "white" ? "common.white" : "common.black"),
        })}
        stumm
        className="flex h-11 w-2.5 flex-none items-center justify-center"
      >
        <Farbfeld farbe={game.color} />
      </Angabe>
      {/* Gegner und Eröffnung geben nach, wenn das Fenster schmal wird · sie
          tragen Namen, und ein Name verträgt die Kürzung. Die Zahlenspalten
          daneben bleiben fest: Ein halbes Datum ist kein Datum. Beide behalten
          eine Untergrenze, sonst schöbe sich die eine auf null. */}
      <Angabe onClick={filter?.onGegner} className="w-[168px] min-w-20 shrink truncate text-ink">
        {game.opponent} <span className="blatt-zahl text-ink3">({game.oppElo})</span>
      </Angabe>
      <Angabe
        onClick={filter?.onEroeffnung}
        className="buch min-w-[72px] flex-1 truncate text-[13.5px] italic text-ink2"
      >
        {game.opening}
      </Angabe>
      <Angabe
        onClick={game.eco ? filter?.onEco : undefined}
        beschriftung={t("games.filterEco", { v: game.eco })}
        className="blatt-zahl w-[34px] flex-none text-[11.5px] text-ink3"
      >
        {game.eco}
      </Angabe>
      <Angabe
        onClick={filter?.onErgebnis}
        beschriftung={t("games.filterResult", { v: ergebnisWort })}
        stumm
        className="blatt-zahl flex h-11 w-[18px] flex-none items-center justify-center"
      >
        <Punkt ergebnis={game.result} />
      </Angabe>
      <span className="blatt-zahl w-[52px] flex-none text-end text-ink2">
        {game.accuracy != null ? `${de(game.accuracy)} %` : "—"}
      </span>
      <span className="flex w-2.5 flex-none justify-center">{marke}</span>
    </>
  );

  const klasse =
    "relative flex min-h-11 w-full items-center gap-[14px] border-b border-line text-start text-[12.5px]";

  // Mit Filtergriffen stehen Schaltflächen in der Zeile · dann trägt die Zeile
  // selbst die Rolle, statt eine Schaltfläche zu sein.
  if (filter) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        className={`${klasse} cursor-pointer`}
      >
        {inhalt}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={klasse}>
      {inhalt}
    </button>
  );
}

/**
 * Der Schlüssel zu den Marken · steht unter der Liste, wie in jedem Band.
 *
 * Rechtsbündig, weil die Spalte rechtsbündig steht: Die Marke, die er erklärt,
 * ist die letzte der Zeile, und ein Schlüssel gehört unter das, was er
 * aufschlüsselt.
 */
export function MarkenSchluessel({ notiz, offen }: { notiz: string; offen: string }) {
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-4 text-[10.5px] text-ink3">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] bg-ink" />
        {notiz}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] border border-line2" />
        {offen}
      </span>
    </div>
  );
}
