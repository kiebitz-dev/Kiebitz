/**
 * Das Blatt · der Start im Diagramm-Modus.
 *
 * Ein Satzspiegel, kein Kartenraster: Kolumnentitel, Formularkopf, in der
 * Mitte das gedruckte Diagramm, rechts die Anmerkung und die Tagesliste,
 * unten die Partien als Formularzeilen. Die vier Wertungen stehen als
 * Randnotiz — sie sind das Kleingedruckte, nicht die Überschrift.
 *
 * Das Fazit der ganzen Partie steht hier bewusst nicht: Die Anmerkung gehört
 * zu der einen Stellung, die im Diagramm steht. Was aus der Analyse zu diesem
 * Zug zu sagen ist und was der Nutzer sich selbst notiert hat — mehr trägt die
 * Spalte nicht. Das Urteil über die ganze Partie steht in der Analyse.
 *
 * Die Komponente holt nichts. Sie bekommt genau das, was `Dashboard.tsx`
 * ohnehin schon geladen hat, und setzt es anders. Der Modus ist eine zweite
 * Darstellung derselben Daten.
 *
 * Auf dem Telefon gibt es die zweite Spalte nicht: Das Diagramm steht oben,
 * die Zahlen darunter, und die Reihenfolge sagt, was zuerst gebraucht wird.
 */
import type { ReactNode } from "react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import {
  ErledigenZeile,
  Ergebniskasten,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  plattformFarbe,
  Rubrik,
  Weg,
  Zitat,
  Zugfolge,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n, type Locale } from "../../lib/i18n";
import { translateSan } from "../../lib/notation";
import { criticalPly } from "../../lib/blatt";
import { fenAfter, fenAfterUci } from "../../lib/position";
import { dateLocale, deInt } from "../../lib/format";
import { PartieZeile } from "../../components/blatt/PartieZeile";
import type { GamesFilter, UiGame } from "../../lib/gameUi";
import type { DiagramSource } from "../../lib/blatt";

/** Ein Zug mit dem Urteil der Auto-Analyse, soweit es eines gibt. */
export interface BlattZug {
  san: string;
  /** „?!" · „?" · „??" — die drei Urteile, die die Analyse vergibt. */
  nag?: string;
  /** Die Anmerkung dazu · die Demo-Partie bringt eine mit, die App nicht. */
  kommentar?: string;
}

/**
 * Woraus das Diagramm des Tages entsteht.
 *
 * Die Seite reicht Züge, Felder und Texte herein; nachgespielt wird hier.
 * chess.js, die Notation und der Endspiel-Katalog hängen damit an dieser
 * nachgeladenen Fassung und nicht am Startbündel.
 */
export type Tagesquelle =
  | {
      art: "game";
      sans: string[];
      nags: (string | undefined)[];
      /** Anmerkungen der Demo-Partie · die App rechnet keine. */
      kommentare?: (string | undefined)[];
      /**
       * Der Satz der Analyse zu jedem Halbzug · gleich lang wie `sans`.
       *
       * Gesetzt wird er in `lib/erklaerung.ts` aus dem Motiv, das die
       * Auto-Analyse erkannt hat. Leer bleibt, wozu es nichts Belastbares zu
       * sagen gibt — das ist der Normalfall und kein Fehler.
       */
      analysen?: (string | undefined)[];
      /**
       * Warum der Zug so teuer war · eine Zeile je Halbzug, gleich lang wie
       * `sans`. Sie nennt die Widerlegung und die beiden Bewertungen und
       * bleibt leer, wo die Analyse nichts davon hergibt — siehe
       * `begruendeZug` in `lib/erklaerung.ts`.
       */
      gruende?: (string | undefined)[];
      /** Das Fazit der Partie · schon fertige Sätze, sonst leer. */
      fazit?: string[];
      weiss: string;
      weissElo: string;
      schwarz: string;
      schwarzElo: string;
      /**
       * Woher die Partie kommt · in Einzelteilen und nicht als fertige Zeile.
       *
       * Der Formularkopf setzt die Plattform in ihre Farbe (siehe
       * `plattformFarbe`), und die Bildunterschrift schreibt das Datum aus:
       * „chess.com Rapid · 11. Juli 2026". Aus einer zusammengesetzten Zeile
       * ließe sich beides nur wieder auseinanderpflücken.
       */
      plattform: string;
      zeitform: string;
      datum: string;
      datumLang: string;
      eco: string;
      eroeffnung: string;
      ergebnis: string;
      farbe: "white" | "black";
      notiz?: string;
      onOeffnen?: () => void;
    }
  | { art: "repertoire"; sans: string[]; linie: string; seite: "white" | "black"; eigener: string }
  | { art: "puzzle"; fen: string; setup: string[]; rating: number; eigener: string }
  | {
      art: "endgame";
      fen: string;
      seite: "white" | "black";
      ziel: "win" | "draw";
      name: string;
      eigener: string;
    };

/** Was im Diagramm des Tages steht · hier aus der Quelle gerechnet. */
interface Tagesdiagramm {
  quelle: DiagramSource;
  fen: string;
  orientation: "white" | "black";
  amZug: "white" | "black";
  /** Kopf des Formulars · Namen, Partie, Eröffnung. */
  felder: Feld[];
  /** Was im Kasten rechts steht ("1 : 0" oder ein Gedankenstrich). */
  ergebnis: string;
  /** Titelzeile und kursive Beizeile der Bildunterschrift. */
  zeilen: string[];
  /** Die Züge bis zur Stellung und die, die danach kamen. */
  davor?: BlattZug[];
  danach?: BlattZug[];
  /** Halbzüge vor `davor` · für die Zugnummern. */
  offset?: number;
  /** Was die Analyse zum Zug im Diagramm sagt · leer, wenn nichts. */
  analyse?: string;
  /** Woher der Preis kommt · steht unter der Anmerkung, leer wenn nichts. */
  grund?: string;
  /** Das Fazit der ganzen Partie · leer, solange keins gerechnet wurde. */
  fazit?: string[];
  /** Eigene Notiz zur Partie, wenn eine da ist. */
  notiz?: string;
  onOeffnen?: () => void;
}

export interface Wertung {
  id: string;
  platform: string;
  tc: string;
  value: number | string;
  delta: number;
}

export interface DashboardBlattProps {
  mobile: boolean;
  /** Partien in der Datenbank · null in der Web-Vorschau. */
  bestand: number | null;
  quelle: Tagesquelle | null;
  /** Die Quellen, die heute etwas anzubieten hätten · nur im Leerfall gesetzt. */
  angebot?: { repertoire: number; puzzles: number; endgame: boolean };
  wertungen: Wertung[];
  letzte: UiGame[];
  repDue: number;
  repNeben: string;
  unanalyzed: number;
  puzzles: { done: number; goal: number };
  onRepertoire: () => void;
  onAnalyse: () => void;
  onPuzzles: () => void;
  onAllePartien: () => void;
  onPartie: (game: UiGame) => void;
  /**
   * Ein Klick auf eine der Angaben in der Partienliste · er führt in das
   * Partienverzeichnis, auf genau diese Angabe eingeschränkt. Datum, Farbfeld,
   * Gegner, Eröffnung, ECO und Ergebnispunkt tragen je einen Griff. Dieselbe
   * Bewegung wie in der gewöhnlichen Fassung, damit sich der Modus nicht
   * anders bedienen lässt als die Seite, die er ersetzt.
   */
  onFilter?: (filter: GamesFilter) => void;
}

/** Zugfolge in der Notation der Oberflächensprache, mit den Urteilen daneben. */
function Zuege({
  zuege,
  offset,
  gross,
}: {
  zuege: readonly BlattZug[];
  offset: number;
  gross: number;
}) {
  const { locale } = useI18n();
  const teile: ReactNode[] = [];
  zuege.forEach((zug, index) => {
    const ply = offset + index;
    const nummer = ply % 2 === 0 ? `${ply / 2 + 1}.` : index === 0 ? `${(ply + 1) / 2}…` : "";
    teile.push(
      <span key={index}>
        {index > 0 && " "}
        {nummer}
        {translateSan(zug.san, locale)}
        {zug.nag && (
          <span style={{ color: zug.nag.includes("?") ? "var(--color-loss)" : "var(--color-win)" }}>
            {zug.nag}
          </span>
        )}
      </span>
    );
  });
  return <Zugfolge gross={gross}>{teile}</Zugfolge>;
}

/** „16…dxe5" · Nummer und Zug in der Notation der Oberflächensprache. */
function zugName(cut: number, san: string, locale: Locale): string {
  const ply = cut - 1;
  const nummer = ply % 2 === 0 ? `${ply / 2 + 1}.` : `${(ply + 1) / 2}…`;
  return nummer + translateSan(san, locale);
}

/** „chess.com · Rapid · 11.07.2026" · die Plattform trägt ihre Farbe. */
function partieFeld(quelle: { plattform: string; zeitform: string; datum: string }): ReactNode {
  const rest = [quelle.zeitform, quelle.datum].filter(Boolean).join(" · ");
  if (!quelle.plattform) return rest;
  return (
    <>
      <span style={{ color: plattformFarbe(quelle.plattform) }}>{quelle.plattform}</span>
      {rest && ` · ${rest}`}
    </>
  );
}

/** „Tom 1462" · der Wert eines Namensfeldes im Formularkopf. */
function nameMitElo(name: string, elo: string): ReactNode {
  return (
    <>
      {name} <span className="blatt-zahl text-ink3">{elo}</span>
    </>
  );
}

/**
 * Das Diagramm des Tages · nachgespielt, nicht gemalt.
 *
 * Ein Buch druckt nicht die Schlussstellung, sondern die Stelle, an der die
 * Partie entschieden wurde; welche das ist, sagen die Marken der Analyse
 * (`criticalPly`). Kommt die Stellung nicht aus einer Partie, bleibt der
 * Formularkopf derselbe Kopf und ist nur anders ausgefüllt.
 */
function bauen(
  quelle: Tagesquelle | null,
  t: ReturnType<typeof useI18n>["t"],
  locale: Locale
): Tagesdiagramm | null {
  if (!quelle) return null;

  if (quelle.art === "game") {
    const cut = Math.max(0, Math.min(criticalPly(quelle.nags, quelle.sans.length), quelle.sans.length));
    const von = Math.max(0, cut - 6);
    const letzterZug = cut > 0 ? quelle.sans[cut - 1] : null;
    const zug = (index: number): BlattZug => ({
      san: quelle.sans[index],
      nag: quelle.nags[index],
      kommentar: quelle.kommentare?.[index],
    });
    return {
      quelle: "game",
      fen: fenAfter(quelle.sans, cut),
      orientation: quelle.farbe,
      amZug: cut % 2 === 0 ? "white" : "black",
      felder: [
        { label: t("common.white"), wert: nameMitElo(quelle.weiss, quelle.weissElo), gross: true },
        { label: t("common.black"), wert: nameMitElo(quelle.schwarz, quelle.schwarzElo), gross: true },
        { label: t("blatt.gameField"), wert: partieFeld(quelle) },
        {
          label: t("games.colOpening"),
          wert: (
            <>
              {quelle.eco && <span className="blatt-zahl text-ink3">{quelle.eco} </span>}
              {quelle.eroeffnung}
            </>
          ),
        },
      ],
      ergebnis: quelle.ergebnis,
      // Zweite Zeile der Bildunterschrift wie im Entwurf: woher die Partie
      // kommt, wann sie gespielt wurde, und erst dann die Stellung. Das Datum
      // steht hier ausgeschrieben — die Unterschrift ist ein Satz, kein Feld.
      zeilen: [
        `${quelle.weiss} – ${quelle.schwarz}`,
        [
          [quelle.plattform, quelle.zeitform].filter(Boolean).join(" "),
          quelle.datumLang,
          letzterZug
            ? t("blatt.positionAfter", { m: zugName(cut, letzterZug, locale) })
            : t("blatt.startPosition"),
        ]
          .filter(Boolean)
          .join(" · "),
      ],
      davor: quelle.sans.slice(von, cut).map((_, index) => zug(von + index)),
      danach: quelle.sans.slice(cut, cut + 5).map((_, index) => zug(cut + index)),
      offset: von,
      // Das Diagramm steht *vor* dem Zug, um den es geht · erklärt wird
      // deshalb `sans[cut]` und nicht der letzte Zug davor.
      analyse: quelle.analysen?.[cut],
      grund: quelle.gruende?.[cut],
      fazit: quelle.fazit,
      notiz: quelle.notiz,
      onOeffnen: quelle.onOeffnen,
    };
  }

  // Der Leerfall · derselbe Kopf, anders ausgefüllt.
  const leerKopf = (woher: ReactNode, eigener: string) => [
    { label: t("common.white"), wert: nameMitElo(eigener, ""), gross: true },
    {
      label: t("common.black"),
      wert: <span className="text-ink3">{t("blatt.noNewGame")}</span>,
      gross: true,
    },
    { label: t("blatt.lastGame"), wert: <span className="text-ink3">{t("blatt.none")}</span> },
    { label: t("blatt.diagramFrom"), wert: woher },
  ];

  if (quelle.art === "repertoire") {
    const letzterZug = quelle.sans[quelle.sans.length - 1];
    return {
      quelle: "repertoire",
      fen: fenAfter(quelle.sans),
      orientation: quelle.seite,
      amZug: quelle.sans.length % 2 === 0 ? "white" : "black",
      felder: leerKopf(
        `${t("nav.repertoire")} · ${t(quelle.seite === "white" ? "common.white" : "common.black")}`,
        quelle.eigener
      ),
      ergebnis: t("blatt.none"),
      zeilen: [
        quelle.linie,
        letzterZug
          ? `${t("blatt.fromRepertoire")} · ${t("blatt.positionAfter", {
              m: zugName(quelle.sans.length, letzterZug, locale),
            })}`
          : t("blatt.fromRepertoire"),
      ],
    };
  }

  if (quelle.art === "puzzle") {
    const fen = fenAfterUci(quelle.fen, quelle.setup);
    const weissAmZug = fen.split(" ")[1] === "w";
    return {
      quelle: "puzzle",
      fen,
      orientation: weissAmZug ? "white" : "black",
      amZug: weissAmZug ? "white" : "black",
      felder: leerKopf(
        `${t("nav.puzzles")} · ${t("pz.rating")} ${quelle.rating}`,
        quelle.eigener
      ),
      ergebnis: t("blatt.none"),
      zeilen: [t("blatt.srcPuzzle"), t("blatt.fromPuzzles")],
    };
  }

  const weissAmZug = quelle.fen.split(" ")[1] === "w";
  return {
    quelle: "endgame",
    fen: quelle.fen,
    orientation: quelle.seite,
    amZug: weissAmZug ? "white" : "black",
    felder: leerKopf(
      `${t("nav.endgame")} · ${t(quelle.ziel === "win" ? "eg.goalWin" : "eg.goalDraw")}`,
      quelle.eigener
    ),
    ergebnis: t("blatt.none"),
    zeilen: [quelle.name, t("blatt.fromEndgames")],
  };
}

export default function DashboardBlatt({
  mobile,
  bestand,
  quelle,
  angebot,
  wertungen,
  letzte,
  repDue,
  repNeben,
  unanalyzed,
  puzzles,
  onRepertoire,
  onAnalyse,
  onPuzzles,
  onAllePartien,
  onPartie,
  onFilter,
}: DashboardBlattProps) {
  const { t, locale } = useI18n();
  const heute = new Date();

  // ── Aus der Quelle wird das Diagramm ──────────────────────────────────────
  const diagramm = bauen(quelle, t, locale);

  const tagesliste = (
    <div>
      <Rubrik>{t("blatt.today")}</Rubrik>
      <ErledigenZeile
        zahl={deInt(repDue)}
        sache={t("dash.dueReviews")}
        neben={repNeben}
        weg={t("blatt.wayTrain")}
        onWeg={onRepertoire}
        erledigt={repDue === 0}
        hoehe={mobile ? 48 : 52}
      />
      <ErledigenZeile
        zahl={deInt(unanalyzed)}
        sache={t("dash.gamesWithoutAnalysis")}
        neben={t("dash.stockfishNative")}
        weg={t("blatt.wayStart")}
        onWeg={onAnalyse}
        erledigt={unanalyzed === 0}
        hoehe={mobile ? 48 : 52}
      />
      <ErledigenZeile
        zahl={deInt(puzzles.done)}
        zusatz={` / ${deInt(puzzles.goal)}`}
        sache={t("blatt.puzzlesToday")}
        neben={t("dash.puzzleGoal")}
        weg={t("blatt.waySolve")}
        onWeg={onPuzzles}
        erledigt={puzzles.done >= puzzles.goal}
        letzte
        hoehe={mobile ? 48 : 52}
      />
    </div>
  );

  const anmerkung = diagramm && (
    <div>
      <Rubrik>{t("blatt.theNote")}</Rubrik>
      {diagramm.davor && diagramm.davor.length > 0 && (
        <div className="mt-[11px]">
          <Feldname>{t("blatt.upToDiagram")}</Feldname>
          <div className="mt-[3px]">
            <Zuege zuege={diagramm.davor} offset={diagramm.offset ?? 0} gross={14} />
          </div>
        </div>
      )}
      {diagramm.danach && diagramm.danach.length > 0 && (
        <div className="mt-[11px]">
          <Feldname>{t("blatt.thenFollowed")}</Feldname>
          <div className="mt-[3px]">
            <Zuege
              zuege={diagramm.danach}
              offset={(diagramm.offset ?? 0) + (diagramm.davor?.length ?? 0)}
              gross={17}
            />
          </div>
        </div>
      )}
      {diagramm.analyse && (
        <div className="mt-[13px]">
          <Zitat quelle={t("expl.source")}>
            {`„${diagramm.analyse}“`}
            {/* Der Satz darüber nennt den Preis, diese Zeile, woher er kommt.
                Ohne Anführungszeichen: Sie ist keine zweite Anmerkung, sondern
                die Rechnung dahinter. */}
            {diagramm.grund && <div className="mt-1 text-[12.5px] text-ink3">{diagramm.grund}</div>}
          </Zitat>
        </div>
      )}
      {diagramm.notiz && (
        <div className="mt-[13px]">
          <Zitat quelle={t("blatt.ownNote")}>{`„${diagramm.notiz}“`}</Zitat>
        </div>
      )}
      {diagramm.onOeffnen && (
        <div className="mt-2 flex gap-5">
          <Weg onClick={diagramm.onOeffnen}>{t("blatt.openGame")}</Weg>
        </div>
      )}
    </div>
  );

  /**
   * Der Leerfall · ein Tag ohne neue Partie.
   *
   * Das Formular bleibt dasselbe Formular, es ist nur anders ausgefüllt: Die
   * Liste zeigt angehakt, aus welcher Quelle die Stellung nachgerückt ist.
   */
  const herkunft = angebot && (
    <div>
      <Rubrik>{t("blatt.whereFrom")}</Rubrik>
      <div className="mt-[11px] border-t border-line">
        {(
          [
            ["game", t("blatt.srcGame"), t("blatt.srcGameNone")],
            [
              "repertoire",
              t("blatt.srcRepertoire"),
              angebot.repertoire > 0
                ? t("blatt.srcRepertoireDue", { n: deInt(angebot.repertoire) })
                : t("blatt.srcNothing"),
            ],
            [
              "puzzle",
              t("blatt.srcPuzzle"),
              angebot.puzzles > 0
                ? t("blatt.srcPuzzleLeft", { n: deInt(angebot.puzzles) })
                : t("blatt.srcNothing"),
            ],
            [
              "endgame",
              t("blatt.srcEndgame"),
              angebot.endgame ? t("blatt.srcEndgameOpen") : t("blatt.srcNothing"),
            ],
          ] as const
        ).map(([id, was, stand]) => {
          const aktiv = diagramm?.quelle === id;
          return (
            <div key={id} className="flex h-[34px] items-center gap-[11px] border-b border-line">
              <span
                aria-hidden
                className={`inline-flex h-[15px] w-[15px] flex-none items-center justify-center border text-ink ${
                  aktiv ? "border-ink" : "border-line2"
                }`}
              >
                {aktiv && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span
                className={`w-[150px] flex-none text-[13px] ${aktiv ? "text-ink" : "text-ink3"}`}
              >
                {was}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink3">{stand}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const wertungenBlock = wertungen.length > 0 && (
    <div>
      <Rubrik>{t("blatt.ratings")}</Rubrik>
      {/* Das Raster fragt seine eigene Breite und nicht die des Fensters:
          `auto-fit` legt so viele Spalten an, wie zu 240 Punkten passen. Die
          Fensterbreite log hier — die Wertungen stehen in der rechten Spalte,
          und die war bei schmalem Fenster gut 200 Punkte breit, während das
          Fenster die 900 längst überschritten hatte. Plattform, Zeit, Wert und
          Veränderung lagen dann übereinander. */}
      <div className="mt-0.5 grid gap-x-[26px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
        {wertungen.map((r) => (
          <div key={r.id} className="flex items-baseline gap-2 border-b border-line py-[5px]">
            <span
              className="blatt-feld min-w-[60px]"
              style={{
                color: r.platform === "chess.com" ? "var(--color-cc)" : "var(--color-blue)",
              }}
            >
              {r.platform}
            </span>
            <span className="flex-1 truncate text-[11.5px] text-ink3">{r.tc}</span>
            <span className="blatt-zahl text-[14px] text-ink">{r.value}</span>
            <span
              className="blatt-zahl min-w-[30px] text-end text-[11.5px]"
              style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
            >
              {r.delta >= 0 ? "+" : "−"}
              {Math.abs(r.delta)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] text-ink3">{t("blatt.change30")}</div>
    </div>
  );

  const partienZeilen = (
    <div>
      {letzte.map((g) => (
        <PartieZeile
          key={g.id}
          game={g}
          mobile={mobile}
          notiz={Boolean(g.note)}
          offen={!g.analyzed}
          // Auf dem Telefon steht die Zeile zweizeilig und ohne eigene
          // Spalten · dort gibt es nichts, woran ein Filtergriff hinge.
          filter={
            onFilter && !mobile
              ? {
                  onDatum: () => onFilter({ date: g.dateKey ?? g.date }),
                  onFarbe: () => onFilter({ color: g.color }),
                  onGegner: () => onFilter({ opponent: g.opponent }),
                  onEroeffnung: () => onFilter({ opening: g.opening }),
                  onEco: () => onFilter({ eco: g.eco }),
                  onErgebnis: () => onFilter({ result: g.result }),
                }
              : undefined
          }
          onClick={() => onPartie(g)}
        />
      ))}
    </div>
  );

  // Der Wochentag gehört auf das Blatt: eine Seite trägt oben, an welchem Tag
  // sie gesetzt wurde. Auf dem Telefon bleibt der Monat abgekürzt, damit der
  // Kolumnentitel links nicht abgeschnitten wird.
  const kopfDatum = heute.toLocaleDateString(dateLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const kurzDatum = heute.toLocaleDateString(dateLocale(), {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const diagrammBlock = diagramm && (
    <div className="flex-none">
      <Diagramm
        fen={diagramm.fen}
        size={mobile ? undefined : 420}
        gutter={mobile ? 13 : 15}
        orientation={diagramm.orientation}
      />
      <Bildunterschrift
        nummer={t("blatt.diagram", { n: "1" })}
        zeilen={diagramm.zeilen}
        amZug={{
          farbe: diagramm.amZug,
          text: diagramm.amZug === "white" ? t("sh.whiteToMove") : t("sh.blackToMove"),
        }}
        breite={mobile ? undefined : 420}
        gutter={mobile ? 13 : 15}
      />
    </div>
  );

  // ── Telefon ────────────────────────────────────────────────────────────────
  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        <Kolumnentitel links={t("blatt.dashTitleShort")} rechts={kurzDatum} />
        {diagramm && (
          <div className="mt-3">
            <Formularkopf felder={diagramm.felder.slice(0, 2)} spalten="1fr 1fr" />
          </div>
        )}
        {diagrammBlock && <div className="mt-3.5">{diagrammBlock}</div>}
        {diagramm?.danach && diagramm.danach.length > 0 && (
          <div className="mt-3">
            <Feldname>{t("blatt.thenFollowed")}</Feldname>
            <div className="mt-[3px]">
              <Zuege
                zuege={diagramm.danach}
                offset={(diagramm.offset ?? 0) + (diagramm.davor?.length ?? 0)}
                gross={15}
              />
            </div>
          </div>
        )}
        {diagramm?.analyse && (
          <div className="mt-3.5">
            <Zitat quelle={t("expl.source")}>
              {`„${diagramm.analyse}“`}
              {diagramm.grund && (
                <div className="mt-1 text-[12.5px] text-ink3">{diagramm.grund}</div>
              )}
            </Zitat>
          </div>
        )}
        {herkunft && <div className="mt-4">{herkunft}</div>}
        <div className="mt-3">{tagesliste}</div>
        <div className="mt-4">
          <Rubrik weg={t("dash.showAll")} onWeg={onAllePartien}>
            {t("dash.recentGames")}
          </Rubrik>
          {partienZeilen}
        </div>
      </div>
    );
  }

  // ── Rechner ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex min-h-full max-w-[1200px] flex-col px-10 pb-[22px] pt-6">
      <Kolumnentitel
        links={t("blatt.dashTitle")}
        rechts={
          <>
            {kopfDatum}
            {bestand != null && (
              <>
                {" · "}
                {t("blatt.page", { n: deInt(bestand) })}
              </>
            )}
          </>
        }
      />

      {diagramm && (
        <div className="mt-4 flex items-end">
          <div className="min-w-0 flex-1">
            <Formularkopf felder={diagramm.felder} spalten="0.95fr 1.3fr 1.35fr 1.4fr" />
          </div>
          <div className="w-24 flex-none border-s border-line ps-3.5">
            <Feldname>{t("blatt.result")}</Feldname>
            <div className="mt-1.5">
              <Ergebniskasten>{diagramm.ergebnis}</Ergebniskasten>
            </div>
          </div>
        </div>
      )}

      {/* Dieselbe Regel wie im Partienverzeichnis: Nebeneinander stehen
          Diagramm und Spalte erst, wenn beide ihre Breite bekommen. Das
          Diagramm misst mit seinem Steg 450 Punkte und kann nicht schmaler;
          bei 1.000 Punkten Fensterbreite blieben der Spalte daneben gut 200,
          und Tagesliste wie Wertungen liefen ineinander. Darunter steht das
          Diagramm deshalb über der Spalte statt neben ihr. */}
      <div className="flex min-h-0 flex-1 flex-col gap-7 pt-[22px] min-[1220px]:flex-row min-[1220px]:gap-9">
        {diagrammBlock}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
          {/* Kommt die Stellung nicht aus einer Partie, steht rechts, woher
              sie stattdessen kommt · der Kopf bleibt derselbe Kopf. */}
          {herkunft ?? anmerkung}
          {tagesliste}
          {wertungenBlock}
        </div>
      </div>

      <div className="pt-[18px]">
        <Rubrik weg={t("dash.showAll")} onWeg={onAllePartien}>
          {t("dash.recentGames")}
        </Rubrik>
        {partienZeilen}
      </div>
    </div>
  );
}
