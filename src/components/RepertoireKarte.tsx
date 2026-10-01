/**
 * Die Landkarte des Repertoires · gezeichnet.
 *
 * Gerechnet wird in lib/repertoireKarte.ts; hier steht nur, wie die Rechnung
 * aussieht. Ein Bild, zwei Sätze:
 *
 * · Die gewöhnliche Fassung zeichnet eine Karte, wie man sie aus Spielen
 *   kennt: Wege in der Akzentfarbe, wo die Linie sitzt, und darüber Wolken,
 *   die nur dort aufreißen, wo schon trainiert wurde.
 * · Das Blatt sticht dieselbe Karte als Tafel eines Atlas: Tinte statt Farbe,
 *   ungesicherte Wege gestrichelt, und das unbekannte Land schraffiert als
 *   Terra incognita, wie auf den alten Karten, auf denen hinter der Küste
 *   noch nichts eingetragen war.
 *
 * Der Nebel ist eine Maske, kein Filter. Ein Weichzeichner über die ganze
 * Fläche wäre einfacher zu schreiben, kostet aber bei jedem Neuzeichnen eine
 * Faltung über das ganze Bild · und WebKitGTK unter Linux hat schon an
 * leichteren Dingen gehangen. Die Löcher im Nebel sind deshalb Kreise mit
 * einem radialen Verlauf: an jedem Ort einer, zwei auf jedem Weg dazwischen,
 * und eine Ellipse unter dem Namen am Ende. Jeder Ort wird dabei nur einmal
 * aufgedeckt, von der klarsten Linie, die durch ihn führt · so wächst die
 * Maske mit den Orten und nicht mit den Linien mal ihrer Länge.
 *
 * Neu aufgedeckt wird sichtbar: Was seit dem letzten Besuch klar geworden ist,
 * liegt beim Aufschlagen noch im Nebel, und der zieht dann ab. Weil die schon
 * klaren Orte zuerst gezeichnet werden, lichtet er sich nur über dem Stück,
 * das wirklich neu ist · der Stamm, den eine andere Linie längst aufgedeckt
 * hat, bleibt einfach klar.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Map as MapIcon, Sparkles } from "lucide-react";
import {
  linieZu,
  SITZT_STABILITAET,
  type Karte,
  type KartenOrt,
  type KartenTeil,
  type Lage,
} from "../lib/repertoireKarte";
import { useT } from "../lib/i18n";
import { deInt } from "../lib/format";
import { Card } from "./ui";

/** Was zuletzt klar war · der Vergleich, an dem sich „neu aufgedeckt" misst. */
const GESEHEN_KEY = "kiebitz.repertoireKarte.klar";
/** So lange zieht der Nebel über einer neu aufgedeckten Linie ab. */
const AUFDECKEN_MS = 1800;

function gelesen(): Set<string> | null {
  try {
    const roh = localStorage.getItem(GESEHEN_KEY);
    if (roh == null) return null;
    const liste = JSON.parse(roh);
    return Array.isArray(liste) ? new Set(liste.filter((x) => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

function merken(keys: string[]) {
  try {
    localStorage.setItem(GESEHEN_KEY, JSON.stringify(keys));
  } catch {
    /* privates Fenster, gesperrter Speicher · dann eben ohne Gedächtnis */
  }
}

/**
 * Welche Linien seit dem letzten Besuch klar geworden sind, und ob ihr Nebel
 * schon abzieht.
 *
 * Das Gedächtnis ist der `localStorage` und nicht die Datenbank: Es ist eine
 * Annehmlichkeit dieses Geräts, kein Lernstand. Fehlt es, war noch niemand
 * hier · dann zieht der Nebel über allem ab, was schon sitzt, und das ist der
 * erste Blick auf die Karte, den man haben will.
 */
export function useAufdecken(karte: Karte): { frisch: Set<string>; offen: boolean } {
  const klar = useMemo(
    () =>
      karte.teile
        .flatMap((teil) => teil.linien)
        .filter((linie) => linie.lage === "klar")
        .map((linie) => linie.key)
        .sort(),
    [karte]
  );
  const signatur = klar.join("|");
  const [stand, setStand] = useState<{ frisch: Set<string>; offen: boolean }>({
    frisch: new Set(),
    offen: true,
  });

  useEffect(() => {
    // Erst rechnen, wenn das Buch geladen ist · sonst gälte ein leerer Stapel
    // als „zuletzt gesehen", und beim nächsten Mal wäre alles neu.
    if (karte.zaehlung.gesamt === 0) return;
    const vorher = gelesen();
    merken(klar);
    const ruhig = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const frisch = ruhig ? new Set<string>() : new Set(klar.filter((key) => !vorher?.has(key)));
    if (frisch.size === 0) {
      setStand((alt) => (alt.frisch.size === 0 && alt.offen ? alt : { frisch, offen: true }));
      return;
    }
    setStand({ frisch, offen: false });
    // Zwei Bilder Abstand · im ersten steht der Nebel, erst im zweiten darf
    // der Übergang beginnen. In einem einzigen Bild sähe der Browser nur den
    // Endzustand und zöge nichts ab.
    let zweites = 0;
    const erstes = requestAnimationFrame(() => {
      zweites = requestAnimationFrame(() => setStand({ frisch, offen: true }));
    });
    return () => {
      cancelAnimationFrame(erstes);
      cancelAnimationFrame(zweites);
    };
    // `klar` hängt an der Signatur · ein neues Array mit denselben Schlüsseln
    // ist kein neuer Stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatur, karte.zaehlung.gesamt]);

  return stand;
}

/** Ein gleichmäßiger, aber wiederholbarer Zufall · die Wolken stehen still. */
function zufall(saat: number): () => number {
  let a = saat >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (wert: number, min: number, max: number) => Math.min(max, Math.max(min, wert));

/** Kürzt einen Namen auf `max` Zeichen · ein Ortsname bricht nicht um. */
function kuerzen(text: string, max: number): string {
  // Am Schnitt fällt weg, was mit dem Auslassungszeichen doppelt stünde · aus
  // „Alapin 2…d5" würde sonst „Alapin 2……".
  return text.length <= max
    ? text
    : `${text.slice(0, Math.max(1, max - 1)).replace(/[\s.…·:]+$/u, "")}…`;
}

interface Masse {
  breite: number;
  hoehe: number;
  dx: number;
  dy: number;
  /** Wo die Ortsnamen beginnen, relativ zum Ort. */
  namensRaum: number;
  zeichen: number;
  /** Mittlere Breite eines Zeichens der Ortsnamen in diesem Satz. */
  zeichenBreite: number;
  x: (ort: { tiefe: number }) => number;
  y: (ort: { zeile: number }) => number;
  hafenY: number;
}

const RAND_X = 16;
const RAND_Y = 14;
/**
 * Grobe Breite eines Zeichens der Ortsnamen · reicht zum Kürzen und Freilegen.
 * Inter in 11,5 Punkt läuft breiter als die kursive Serife in 12,5.
 */
const ZEICHEN = { dashboard: 6.3, blatt: 5.8 };

function masse(teil: KartenTeil, breite: number, dy: number, blatt: boolean): Masse {
  // Die Namen bekommen ein gutes Drittel der Breite, auf dem Telefon gut zwei
  // Fünftel · der Rest gehört den Wegen. Dort stand sonst „Philidor Defen…"
  // neben einer leeren Spalte, während die Wege mehr hatten, als sie brauchen.
  // Wird es zu eng, bleiben die Wege bei 14 Punkten je Halbzug stehen, und
  // die Karte läuft quer aus ihrem Rahmen (der Rahmen scrollt dann).
  const zeichenBreite = blatt ? ZEICHEN.blatt : ZEICHEN.dashboard;
  const namensRaum = clamp(breite * (breite < 520 ? 0.44 : 0.34), 92, 220);
  const dx = clamp((breite - 2 * RAND_X - namensRaum - 8) / Math.max(1, teil.tiefe), 14, 60);
  const innen = 2 * RAND_X + teil.tiefe * dx + 8 + namensRaum;
  const hoehe = 2 * RAND_Y + 6 + teil.zeilen * dy;
  const y = (ort: { zeile: number }) => RAND_Y + 6 + ort.zeile * dy + dy / 2;
  const wurzeln = teil.orte.filter((ort) => ort.parentId === 0).map((ort) => ort.zeile);
  const hafenZeile = wurzeln.length > 0 ? (Math.min(...wurzeln) + Math.max(...wurzeln)) / 2 : 0;
  return {
    // Ein halber Punkt Rundung ist kein Überlauf · mit `ceil` allein bekam die
    // Karte auf dem Telefon für ein Pixel eine Bildlaufleiste.
    breite: innen <= breite + 0.5 ? breite : Math.ceil(innen),
    hoehe,
    dx,
    dy,
    namensRaum,
    zeichen: Math.max(6, Math.floor(namensRaum / zeichenBreite)),
    zeichenBreite,
    x: (ort) => RAND_X + ort.tiefe * dx,
    y,
    hafenY: y({ zeile: hafenZeile }),
  };
}

/** Ein Weg zwischen zwei Orten · ein sanfter Bogen, wie ein Fluss im Delta. */
function wegPfad(x1: number, y1: number, x2: number, y2: number): string {
  const mitte = (x2 - x1) / 2;
  return `M${x1} ${y1} C${x1 + mitte} ${y1} ${x2 - mitte} ${y2} ${x2} ${y2}`;
}

/** Ein Punkt auf diesem Bogen · für die Löcher, die den Weg im Nebel freilegen. */
function aufDemWeg(x1: number, y1: number, x2: number, y2: number, t: number): [number, number] {
  const mitte = (x2 - x1) / 2;
  const u = 1 - t;
  const px = u ** 3 * x1 + 3 * u * u * t * (x1 + mitte) + 3 * u * t * t * (x2 - mitte) + t ** 3 * x2;
  const py = u ** 3 * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y2;
  return [px, py];
}

/** Wie ein Weg gezogen wird · Farbe, Stärke und, wo er noch unsicher ist, gestrichelt. */
interface Wegstil {
  farbe: string;
  breite: number;
  strich?: string;
}

const WEG_DASHBOARD: Record<Lage, Wegstil> = {
  klar: { farbe: "var(--color-accent)", breite: 2.2 },
  dunst: { farbe: "var(--color-gold)", breite: 1.6 },
  nebel: { farbe: "var(--color-line2)", breite: 1.3 },
};

const WEG_BLATT: Record<Lage, Wegstil> = {
  klar: { farbe: "var(--color-ink)", breite: 1.3 },
  dunst: { farbe: "var(--color-ink2)", breite: 1, strich: "1 2.4" },
  nebel: { farbe: "var(--color-ink3)", breite: 0.9, strich: "3.5 3" },
};

export interface KartenBildProps {
  teil: KartenTeil;
  breite: number;
  /** Höhe einer Zeile · auf dem Telefon mehr, damit ein Ort zu treffen ist. */
  zeilenHoehe: number;
  blatt: boolean;
  aktiv: string | null;
  /** Der volle Name einer Variante, wie in der Liste · für Vorlesen und Tooltip. */
  namen: Record<string, string>;
  /** Wie ein Zug auf der Karte heißt · im Blatt in der Sprache der Oberfläche. */
  zugText: (san: string, tiefe: number) => string;
  /** Wie eine Lage ausgesprochen wird · „sitzt", „im Training", „im Nebel". */
  lageText: (lage: Lage) => string;
  terraIncognita: string;
  titel: string;
  frisch: Set<string>;
  offen: boolean;
  onWaehlen?: (key: string) => void;
}

/** Eine Seite des Repertoires als Karte. */
export function KartenBild({
  teil,
  breite,
  zeilenHoehe,
  blatt,
  aktiv,
  namen,
  zugText,
  lageText,
  terraIncognita,
  titel,
  frisch,
  offen,
  onWaehlen,
}: KartenBildProps) {
  // Kennungen für Maske, Verläufe und Muster · `useId` liefert Zeichen, die in
  // `url(#…)` nichts verloren haben.
  const roh = useId();
  const id = `karte-${roh.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const m = useMemo(() => masse(teil, breite, zeilenHoehe, blatt), [teil, breite, zeilenHoehe, blatt]);
  const ortVon = useMemo(() => new Map(teil.orte.map((ort) => [ort.id, ort])), [teil]);
  const wege = blatt ? WEG_BLATT : WEG_DASHBOARD;

  /** Die Knoten des gewählten Weges · er wird über dem Nebel nachgezogen. */
  const aktivPfad = useMemo(() => {
    // Ohne Wahl kein Weg · `key` ist bei Kreuzungen ohne Namen ebenfalls null,
    // und null fände sonst die erste davon.
    if (!aktiv) return [];
    const ziel = teil.orte.find((ort) => ort.key === aktiv);
    if (!ziel) return [];
    const pfad: KartenOrt[] = [];
    let jetzt: KartenOrt | undefined = ziel;
    while (jetzt) {
      pfad.unshift(jetzt);
      jetzt = jetzt.parentId ? ortVon.get(jetzt.parentId) : undefined;
    }
    return pfad;
  }, [aktiv, ortVon, teil.orte]);

  const vonPunkt = (ort: KartenOrt): [number, number] => {
    const parent = ort.parentId ? ortVon.get(ort.parentId) : undefined;
    return parent ? [m.x(parent), m.y(parent)] : [RAND_X, m.hafenY];
  };

  /** Was am Ende einer Variante steht · ihr eigener Name oder ihr letzter Zug. */
  const ortsname = (ort: KartenOrt) => kuerzen(ort.name || zugText(ort.san, ort.tiefe), m.zeichen);

  /**
   * Die Löcher im Nebel, Linie für Linie.
   *
   * Reihenfolge: erst was schon klar war, dann was neu klar ist, dann der
   * Dunst nach seiner Sicht. Ein Ort, den eine frühere Linie schon so klar
   * aufgedeckt hat, wird nicht noch einmal gezeichnet · daran hängt, dass die
   * Maske klein bleibt und dass beim Aufdecken nur das neue Stück abzieht.
   */
  const loecher = useMemo(() => {
    const radius = Math.max(m.dy * 1.05, m.dx * 0.72);
    const gezeichnet = new Map<number, number>();
    const reihe = [...teil.linien]
      .filter((linie) => linie.sicht > 0)
      .sort((a, b) => {
        const rang = (key: string, sicht: number) => (sicht === 1 ? (frisch.has(key) ? 1 : 0) : 2);
        return rang(a.key, a.sicht) - rang(b.key, b.sicht) || b.sicht - a.sicht;
      });
    return reihe.map((linie) => {
      const teile: ReactNode[] = [];
      for (const knoten of linie.pfad) {
        const ort = ortVon.get(knoten);
        if (!ort) continue;
        if ((gezeichnet.get(ort.id) ?? 0) >= linie.sicht) continue;
        gezeichnet.set(ort.id, linie.sicht);
        const [x1, y1] = vonPunkt(ort);
        const x2 = m.x(ort);
        const y2 = m.y(ort);
        for (const t of [1 / 3, 2 / 3]) {
          const [px, py] = aufDemWeg(x1, y1, x2, y2, t);
          teile.push(<circle key={`${ort.id}:${t}`} cx={px} cy={py} r={radius} fill={`url(#${id}-loch)`} />);
        }
        teile.push(<circle key={ort.id} cx={x2} cy={y2} r={radius} fill={`url(#${id}-loch)`} />);
      }
      const ende = ortVon.get(linie.endId);
      if (ende) {
        const w = ortsname(ende).length * m.zeichenBreite;
        teile.push(
          <ellipse
            key="name"
            cx={m.x(ende) + 9 + w / 2}
            cy={m.y(ende)}
            rx={w / 2 + 14}
            ry={m.dy * 0.95}
            fill={`url(#${id}-loch)`}
          />
        );
      }
      const neu = frisch.has(linie.key);
      return (
        <g
          key={linie.key}
          opacity={linie.sicht}
          style={
            neu
              ? { opacity: offen ? linie.sicht : 0, transition: `opacity ${AUFDECKEN_MS}ms ease-out` }
              : undefined
          }
        >
          {teile}
        </g>
      );
    });
    // `ortsname` und `vonPunkt` hängen nur an `m`, `ortVon` und `zugText`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teil, m, ortVon, frisch, offen, id, zugText]);

  /** Wolken über dem Nebel · nur in der gewöhnlichen Fassung, das Blatt schraffiert. */
  const wolken = useMemo(() => {
    if (blatt) return [];
    const r = zufall(Math.round(m.breite * 31 + m.hoehe * 17 + teil.zeilen));
    const anzahl = clamp(Math.round((m.breite * m.hoehe) / 4200), 8, 140);
    return Array.from({ length: anzahl }, (_, index) => ({
      key: index,
      x: r() * m.breite,
      y: r() * m.hoehe,
      rx: 26 + r() * 54,
      ry: 14 + r() * 26,
    }));
  }, [blatt, m.breite, m.hoehe, teil.zeilen]);

  /**
   * Wo „Terra incognita" steht · über den Namen, die noch niemand lesen kann.
   *
   * Gesucht wird die längste Folge von Endpunkten im Nebel, die auf der Karte
   * untereinander stehen. Mitten in ihr, über der Spalte der Ortsnamen, ist
   * das Land wirklich unbekannt · ein Schriftzug quer über das ganze Bild
   * fiele dagegen in aufgedeckte Gegenden und würde dort zerschnitten. Eine
   * einzelne Linie im Nebel ist kein Land, sondern ein Weg; dort steht nichts.
   */
  const inkognita = useMemo(() => {
    if (!blatt) return null;
    const enden = teil.orte
      .filter((ort) => ort.endpunkt)
      .sort((a, b) => a.zeile - b.zeile);
    let beste: KartenOrt[] = [];
    let lauf: KartenOrt[] = [];
    for (const ort of enden) {
      lauf = ort.lage === "nebel" ? [...lauf, ort] : [];
      if (lauf.length > beste.length) beste = lauf;
    }
    if (beste.length < 2) return null;
    const x = Math.min(...beste.map((ort) => m.x(ort))) + 9;
    const y = (m.y(beste[0]) + m.y(beste[beste.length - 1])) / 2;
    // Gesperrt läuft der Schriftzug gut zehn Punkte je Zeichen · er bleibt
    // ganz im Rahmen, auch wenn die Ortsnamen ganz rechts beginnen.
    const halb = (terraIncognita.length * 10.5) / 2 + 8;
    return { x: clamp(x + m.namensRaum / 2, halb, m.breite - halb), y };
  }, [blatt, m, teil.orte, terraIncognita]);

  const waehlen = (key: string | null) => (key && onWaehlen ? () => onWaehlen(key) : undefined);
  const tasten = (key: string | null) => (event: KeyboardEvent<SVGGElement>) => {
    if (!key || !onWaehlen) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onWaehlen(key);
    }
  };

  const papier = blatt ? "var(--color-bg)" : "var(--color-panel2)";
  const hafenX = RAND_X;

  return (
    <svg
      role="group"
      aria-label={titel}
      width={m.breite}
      height={m.hoehe}
      viewBox={`0 0 ${m.breite} ${m.hoehe}`}
      className="block"
      style={{ maxWidth: "none" }}
    >
      <defs>
        {/* Ein Loch im Nebel · innen ganz frei, zum Rand hin wieder dicht.
            Schwarz und Weiß sind hier keine Farben, sondern die Dichte der
            Maske: Weiß zeigt den Nebel, Schwarz nimmt ihn weg. */}
        <radialGradient id={`${id}-loch`}>
          <stop offset="0" stopColor="black" stopOpacity="1" />
          <stop offset={blatt ? "0.7" : "0.5"} stopColor="black" stopOpacity={blatt ? "0.95" : "0.85"} />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-maske`} maskUnits="userSpaceOnUse" x="0" y="0" width={m.breite} height={m.hoehe}>
          <rect width={m.breite} height={m.hoehe} fill="white" />
          <circle cx={hafenX} cy={m.hafenY} r={m.dy * 1.4} fill={`url(#${id}-loch)`} />
          {loecher}
        </mask>
        {blatt ? (
          <>
            {/* Die Schraffur der Terra incognita · feine Tinte unter 45°. */}
            <pattern
              id={`${id}-schraffur`}
              width="4.5"
              height="4.5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="4.5" style={{ stroke: "var(--color-ink3)" }} strokeWidth="0.6" />
            </pattern>
            <pattern id={`${id}-netz`} width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" style={{ stroke: "var(--color-line)" }} strokeWidth="0.6" />
            </pattern>
          </>
        ) : (
          <>
            <radialGradient id={`${id}-wolke`}>
              <stop offset="0" style={{ stopColor: "var(--color-ink3)", stopOpacity: 0.2 }} />
              <stop offset="1" style={{ stopColor: "var(--color-ink3)", stopOpacity: 0 }} />
            </radialGradient>
            <pattern id={`${id}-raster`} width="18" height="18" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.9" style={{ fill: "var(--color-line2)" }} />
            </pattern>
          </>
        )}
      </defs>

      {/* Das Land · Papier und Gradnetz, darauf die Wege. */}
      <rect width={m.breite} height={m.hoehe} rx={blatt ? 0 : 12} style={{ fill: papier }} />
      <rect width={m.breite} height={m.hoehe} rx={blatt ? 0 : 12} fill={`url(#${id}-${blatt ? "netz" : "raster"})`} />

      <g fill="none" strokeLinecap="round">
        {teil.orte.map((ort) => {
          const [x1, y1] = vonPunkt(ort);
          const stil = wege[ort.lage];
          return (
            <path
              key={ort.id}
              d={wegPfad(x1, y1, m.x(ort), m.y(ort))}
              style={{ stroke: stil.farbe }}
              strokeWidth={stil.breite}
              strokeDasharray={stil.strich}
            />
          );
        })}
      </g>

      {teil.orte.map((ort) => (
        <Ortszeichen key={ort.id} ort={ort} x={m.x(ort)} y={m.y(ort)} blatt={blatt} />
      ))}

      {/* Landschaftsnamen · benannte Kreuzungen, gesperrt über dem Weg. */}
      {teil.orte
        .filter((ort) => ort.gegend)
        .map((ort) => (
          <text
            key={`gegend:${ort.id}`}
            x={m.x(ort) + 5}
            y={m.y(ort) - 7}
            className={blatt ? "buch" : undefined}
            style={{
              fill: "var(--color-ink3)",
              stroke: papier,
              strokeWidth: 3,
              paintOrder: "stroke",
              fontSize: blatt ? 10.5 : 9,
              letterSpacing: blatt ? "0.08em" : "0.12em",
              fontWeight: blatt ? 400 : 600,
              fontVariant: blatt ? "small-caps" : undefined,
              textTransform: blatt ? undefined : "uppercase",
            }}
          >
            {kuerzen(ort.name, 26)}
          </text>
        ))}

      {/* Ortsnamen am Ende jeder Variante. */}
      {teil.orte
        .filter((ort) => ort.endpunkt)
        .map((ort) => (
          <text
            key={`name:${ort.id}`}
            x={m.x(ort) + 9}
            y={m.y(ort)}
            dominantBaseline="central"
            className={blatt ? "buch" : undefined}
            style={{
              fill:
                ort.lage === "klar"
                  ? "var(--color-ink)"
                  : ort.lage === "dunst"
                    ? "var(--color-ink2)"
                    : "var(--color-ink3)",
              stroke: papier,
              strokeWidth: 3,
              paintOrder: "stroke",
              fontSize: blatt ? 12.5 : 11.5,
              fontStyle: blatt ? "italic" : undefined,
              fontWeight: !blatt && ort.key === aktiv ? 600 : undefined,
            }}
          >
            {ortsname(ort)}
          </text>
        ))}

      {/* Der Nebel · was nicht aufgedeckt ist, liegt darunter. */}
      <g mask={`url(#${id}-maske)`} pointerEvents="none">
        {blatt ? (
          <>
            <rect width={m.breite} height={m.hoehe} style={{ fill: "var(--color-bg)" }} opacity={0.8} />
            <rect width={m.breite} height={m.hoehe} fill={`url(#${id}-schraffur)`} opacity={0.75} />
          </>
        ) : (
          <>
            <rect width={m.breite} height={m.hoehe} rx={12} style={{ fill: "var(--color-panel2)" }} opacity={0.86} />
            {wolken.map((wolke) => (
              <ellipse
                key={wolke.key}
                cx={wolke.x}
                cy={wolke.y}
                rx={wolke.rx}
                ry={wolke.ry}
                fill={`url(#${id}-wolke)`}
              />
            ))}
          </>
        )}
      </g>

      {/* Über dem Nebel, nicht in ihm · in der Maske würde der Schriftzug
          überall dort zerschnitten, wo ein Nachbarweg schon aufgedeckt ist. */}
      {inkognita && (
        <text
          x={inkognita.x}
          y={inkognita.y}
          textAnchor="middle"
          dominantBaseline="central"
          className="buch"
          pointerEvents="none"
          style={{
            fill: "var(--color-ink2)",
            stroke: "var(--color-bg)",
            strokeWidth: 6,
            strokeLinejoin: "round",
            paintOrder: "stroke",
            fontSize: 13.5,
            fontStyle: "italic",
            letterSpacing: "0.28em",
          }}
        >
          {terraIncognita}
        </text>
      )}

      {/* Der Hafen · die Grundstellung, von der alles abgeht. Liegt nie im Nebel. */}
      <g pointerEvents="none">
        <circle
          cx={hafenX}
          cy={m.hafenY}
          r={blatt ? 5 : 6}
          style={{ fill: papier, stroke: blatt ? "var(--color-ink)" : "var(--color-ink2)" }}
          strokeWidth={blatt ? 1 : 1.5}
        />
        <circle cx={hafenX} cy={m.hafenY} r={blatt ? 1.6 : 2.2} style={{ fill: blatt ? "var(--color-ink)" : "var(--color-ink2)" }} />
      </g>

      {/* Der gewählte Weg · über dem Nebel, weil man ihn gerade selbst geht. */}
      {aktivPfad.length > 0 && (
        <g fill="none" strokeLinecap="round" pointerEvents="none">
          {aktivPfad.map((ort) => {
            const [x1, y1] = vonPunkt(ort);
            return (
              <path
                key={ort.id}
                d={wegPfad(x1, y1, m.x(ort), m.y(ort))}
                style={{ stroke: blatt ? "var(--color-ink)" : "var(--color-accent-hover)" }}
                strokeWidth={blatt ? 2.4 : 3}
                strokeDasharray={ort.lage === "nebel" ? (blatt ? "4 3" : "5 4") : undefined}
              />
            );
          })}
          {(() => {
            const ziel = aktivPfad[aktivPfad.length - 1];
            return (
              <circle
                cx={m.x(ziel)}
                cy={m.y(ziel)}
                r={blatt ? 6 : 7}
                style={{ stroke: blatt ? "var(--color-ink)" : "var(--color-accent-hover)", fill: "none" }}
                strokeWidth={blatt ? 1.2 : 2}
              />
            );
          })()}
        </g>
      )}

      {/* Treffer · eine Zeile je Ort mit Namen, vom Ort bis zum Rand. Liegt
          obenauf, damit auch ein Ort im Nebel aufzuschlagen ist. */}
      {onWaehlen &&
        teil.orte
          .filter((ort) => ort.key)
          .map((ort) => {
            const linie = teil.linien.find((eintrag) => eintrag.key === ort.key);
            const name = (ort.key && namen[ort.key]) || ort.name || zugText(ort.san, ort.tiefe);
            const lage = linie?.lage ?? ort.lage;
            const auskunft = linie
              ? `${name} · ${lageText(lage)} · ${linie.sitzend}/${linie.eigene}`
              : `${name} · ${lageText(lage)}`;
            const x = m.x(ort) - 8;
            const breiteTreffer = ort.endpunkt ? m.breite - x : Math.min(m.breite - x, m.dx * 1.6 + 120);
            return (
              <g
                key={`treffer:${ort.id}`}
                role="button"
                tabIndex={0}
                aria-label={auskunft}
                aria-pressed={ort.key === aktiv}
                onClick={waehlen(ort.key)}
                onKeyDown={tasten(ort.key)}
                className="group cursor-pointer outline-none"
              >
                <title>{auskunft}</title>
                <rect
                  x={x}
                  y={m.y(ort) - m.dy / 2 - (ort.gegend ? 8 : 0)}
                  width={breiteTreffer}
                  height={m.dy + (ort.gegend ? 8 : 0)}
                  rx={blatt ? 0 : 6}
                  // Durchsichtig, bis der Zeiger darüber steht · dann eine
                  // halb deckende Linienfarbe, in beiden Sätzen dieselbe.
                  fill="transparent"
                  fillOpacity={0.6}
                  className="group-hover:fill-line group-focus-visible:stroke-accent"
                  strokeWidth={1}
                />
              </g>
            );
          })}
    </svg>
  );
}

/** Ein Ort auf der Karte · eigener Zug, Gegnerzug oder Endpunkt. */
function Ortszeichen({ ort, x, y, blatt }: { ort: KartenOrt; x: number; y: number; blatt: boolean }) {
  if (blatt) {
    // Gestochen: gefüllt, was sitzt, offen, was noch nicht · der Endpunkt ist
    // ein doppelter Kreis, wie eine Stadt auf der Karte.
    const tinte = ort.lage === "nebel" ? "var(--color-ink3)" : ort.lage === "dunst" ? "var(--color-ink2)" : "var(--color-ink)";
    if (ort.endpunkt) {
      return (
        <g pointerEvents="none">
          <circle cx={x} cy={y} r={4} style={{ fill: "var(--color-bg)", stroke: tinte }} strokeWidth={0.9} />
          <circle
            cx={x}
            cy={y}
            r={1.8}
            style={{ fill: ort.lage === "klar" ? tinte : "var(--color-bg)", stroke: tinte }}
            strokeWidth={0.7}
          />
        </g>
      );
    }
    if (!ort.eigener) {
      return <circle cx={x} cy={y} r={1.3} style={{ fill: tinte }} pointerEvents="none" />;
    }
    return (
      <circle
        cx={x}
        cy={y}
        r={2.5}
        style={{ fill: ort.lage === "klar" ? tinte : "var(--color-bg)", stroke: tinte }}
        strokeWidth={0.9}
        pointerEvents="none"
      />
    );
  }
  const farbe =
    ort.lage === "klar" ? "var(--color-accent)" : ort.lage === "dunst" ? "var(--color-gold)" : "var(--color-line2)";
  if (ort.endpunkt) {
    return (
      <g pointerEvents="none">
        <circle cx={x} cy={y} r={5} style={{ fill: "var(--color-panel2)", stroke: farbe }} strokeWidth={1.6} />
        <circle cx={x} cy={y} r={2.2} style={{ fill: farbe }} />
      </g>
    );
  }
  if (!ort.eigener) {
    return <circle cx={x} cy={y} r={1.9} style={{ fill: ort.lage === "nebel" ? "var(--color-line2)" : "var(--color-ink3)" }} pointerEvents="none" />;
  }
  return <circle cx={x} cy={y} r={3.2} style={{ fill: farbe }} pointerEvents="none" />;
}

/** Misst die Breite, die die Karte bekommt · im Test ohne Layout bleibt es beim Vorgabewert. */
function useBreite(vorgabe: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [breite, setBreite] = useState(vorgabe);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const messen = () => {
      const wert = Math.floor(element.getBoundingClientRect().width);
      if (wert > 0) setBreite((alt) => (Math.abs(alt - wert) < 1 ? alt : wert));
    };
    messen();
    if (typeof ResizeObserver === "undefined") return;
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    return () => beobachter.disconnect();
  }, []);
  return { ref, breite };
}

export interface KartenTafelnProps
  extends Omit<KartenBildProps, "teil" | "breite" | "titel" | "frisch" | "offen"> {
  karte: Karte;
  /** Überschrift je Teil · „Als Weiß", „Als Schwarz". */
  teilTitel: (seite: "white" | "black") => string;
  /** Was neben der Überschrift steht · etwa „5 / 12". */
  teilZahl: (teil: KartenTeil) => string;
  frisch: Set<string>;
  offen: boolean;
}

/**
 * Beide Teile der Karte · nebeneinander, solange jeder mindestens 420 Punkte
 * bekommt, sonst untereinander.
 *
 * Nebeneinander halbiert die Höhe, und eine Karte will man auf einen Blick
 * sehen. Unter 420 Punkten blieben für die Wege aber nur noch ein paar Punkte
 * je Halbzug · dann lieber zwei Karten übereinander, jede in voller Breite.
 */
export function KartenTafeln({ karte, teilTitel, teilZahl, blatt, ...bild }: KartenTafelnProps) {
  const { ref, breite } = useBreite(640);
  const nebeneinander = karte.teile.length > 1 && breite >= 2 * 420 + 24;
  const spalte = nebeneinander ? Math.floor((breite - 24) / 2) : breite;
  return (
    <div ref={ref} className={nebeneinander ? "grid grid-cols-2 gap-6" : "flex flex-col gap-5"}>
      {karte.teile.map((teil) => (
        <figure key={teil.seite} className="m-0 min-w-0">
          <figcaption
            className={
              blatt
                ? "blatt-kolumne mb-2 flex items-baseline justify-between gap-3 text-ink3"
                : "mb-2 flex items-baseline justify-between gap-3 text-[11px] font-medium uppercase tracking-wider text-ink3"
            }
          >
            <span className="flex items-center gap-2">
              {blatt && (
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 flex-none border border-ink"
                  style={{ background: teil.seite === "black" ? "var(--color-ink)" : "transparent" }}
                />
              )}
              {teilTitel(teil.seite)}
            </span>
            <span className={blatt ? "blatt-zahl" : "tabular-nums"}>{teilZahl(teil)}</span>
          </figcaption>
          {/* Wird die Karte breiter als ihr Platz, scrollt nur sie · die
              Seite selbst bekommt keine Bildlaufleiste quer. */}
          <div
            className={`overflow-x-auto ${blatt ? "border border-ink" : "rounded-xl"}`}
            style={blatt ? { padding: 3 } : undefined}
          >
            <div className={blatt ? "border border-line" : ""}>
              <KartenBild
                {...bild}
                blatt={blatt}
                teil={teil}
                breite={Math.max(240, spalte - (blatt ? 10 : 0))}
                titel={teilTitel(teil.seite)}
              />
            </div>
          </div>
        </figure>
      ))}
    </div>
  );
}

/** Zug auf der Karte · „5.d3", „7…Nf6", wie in der Variantenliste. */
export function zugAufDerKarte(san: string, tiefe: number): string {
  return `${Math.ceil(tiefe / 2)}${tiefe % 2 === 1 ? "." : "…"}${san}`;
}

/**
 * Die Karte als Karte der gewöhnlichen Fassung · Überschrift, Stand, Bild.
 *
 * Über dem Bild steht, wie viel schon aufgedeckt ist, als ein Balken in drei
 * Lagen und mit den Zahlen daneben · unter ihm, was die gewählte Variante
 * gerade zeigt. Was „sitzt" heißt, sagt die Fußnote, und zwar mit der Zahl,
 * mit der gerechnet wird.
 */
export default function RepertoireKarteKarte({
  karte,
  aktiv,
  namen,
  compact,
  onWaehlen,
}: {
  karte: Karte;
  aktiv: string | null;
  namen: Record<string, string>;
  compact: boolean;
  onWaehlen?: (key: string) => void;
}) {
  const t = useT();
  const { frisch, offen } = useAufdecken(karte);
  const lageText = useCallback(
    (lage: Lage) => t(lage === "klar" ? "rep.mapClear" : lage === "dunst" ? "rep.mapHaze" : "rep.mapFog"),
    [t]
  );
  if (karte.zaehlung.gesamt === 0) return null;
  const { klar, dunst, nebel, gesamt } = karte.zaehlung;
  const gewaehlt = linieZu(karte, aktiv);
  const lagen: { lage: Lage; zahl: number; zeichen: string }[] = [
    { lage: "klar", zahl: klar, zeichen: "bg-accent" },
    { lage: "dunst", zahl: dunst, zeichen: "bg-gold" },
    { lage: "nebel", zahl: nebel, zeichen: "border border-line2 bg-panel3" },
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MapIcon size={14} /> {t("rep.mapTitle")}
        </span>
      }
      action={
        <span className="text-[12px] font-medium tabular-nums text-accent">
          {t("rep.mapRevealed", { p: deInt(karte.anteil) })}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[180px] flex-1">
          <div
            className="flex h-2 overflow-hidden rounded-full bg-panel3"
            role="img"
            aria-label={t("rep.mapLines", { k: deInt(klar), n: deInt(gesamt) })}
          >
            {/* Übergang und Deckkraft als Stil, nicht als Klasse · jede neue
                Hilfsklasse landet im einen Stylesheet der App, und dessen
                Grenze ist knapp (scripts/check-bundle-size.mjs). */}
            <div
              className="h-full bg-accent"
              style={{ width: `${(klar / gesamt) * 100}%`, transition: "width 700ms" }}
            />
            <div
              className="h-full bg-gold"
              style={{ width: `${(dunst / gesamt) * 100}%`, transition: "width 700ms", opacity: 0.7 }}
            />
          </div>
          <div className="mt-1.5 text-[12px] text-ink3">
            {t("rep.mapLines", { k: deInt(klar), n: deInt(gesamt) })}
          </div>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink2">
          {lagen.map(({ lage, zahl, zeichen }) => (
            <li key={lage} className="flex items-center gap-1.5">
              <span aria-hidden className={`inline-block size-2.5 rounded-full ${zeichen}`} />
              {lageText(lage)}
              <span className="font-semibold tabular-nums text-ink">{deInt(zahl)}</span>
            </li>
          ))}
        </ul>
      </div>

      {frisch.size > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
          <Sparkles size={14} className="shrink-0" />
          <span>
            {frisch.size === 1
              ? t("rep.mapNew.one")
              : t("rep.mapNew.many", { n: deInt(frisch.size) })}
          </span>
        </div>
      )}

      <div className="mt-4">
        <KartenTafeln
          karte={karte}
          blatt={false}
          zeilenHoehe={compact ? 28 : 22}
          aktiv={aktiv}
          namen={namen}
          zugText={zugAufDerKarte}
          lageText={lageText}
          terraIncognita={t("rep.mapTerra")}
          teilTitel={(seite) => t(seite === "white" ? "common.asWhite" : "common.asBlack")}
          teilZahl={(teil) =>
            `${deInt(teil.linien.filter((linie) => linie.lage === "klar").length)} / ${deInt(teil.linien.length)}`
          }
          frisch={frisch}
          offen={offen}
          onWaehlen={onWaehlen}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12px]">
        {gewaehlt && aktiv ? (
          <span className="min-w-0 text-ink2">
            <span className="font-medium text-ink">{namen[aktiv] ?? ""}</span>
            {" · "}
            {lageText(gewaehlt.lage)}
            {" · "}
            {t("rep.mapSelected", { s: deInt(gewaehlt.sitzend), n: deInt(gewaehlt.eigene) })}
          </span>
        ) : (
          onWaehlen && <span className="text-ink3">{t("rep.mapHint")}</span>
        )}
      </div>
      <p className="mt-2 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
        {t("rep.mapNote", { d: deInt(SITZT_STABILITAET) })}
      </p>
    </Card>
  );
}
