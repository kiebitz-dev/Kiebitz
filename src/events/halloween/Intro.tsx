/**
 * Fledermäuse beim Start · der Schirm wird kurz Nacht, ein Schwarm bricht
 * unten links heraus, ein paar kommen ganz nah, dann ist Ruhe.
 *
 * Die Ebene liegt über der App, fängt aber keinen Klick ab: Die App lädt und
 * bedient sich darunter, als wäre nichts. Bewegt wird nur `transform` und
 * `opacity`, beides rechnet der Compositor ohne Neuzeichnen.
 */
import { useEffect, type CSSProperties } from "react";
import "./intro.css";

/** Wie lange der Auftritt dauert, bis sich die Ebene selbst entfernt. */
const DAUER_MS = 3_600;

/** Kleiner fester Zufall · jeder Start zeigt denselben, gut gesetzten Schwarm. */
function zufall(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Bahn = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bogen: number;
  s0: number;
  s1: number;
  verz: number;
  zeit: number;
  groesse: number;
};

/**
 * Der Schwarm · Start und Ziel in Prozent der Fensterbreite und -höhe, die
 * Größe in Hundertstel der kürzeren Fensterseite (auf dem Telefon nicht zu
 * viel, am Rechner nicht zu wenig), `s0`/`s1` die Skalierung unterwegs.
 */
const SCHWARM: Bahn[] = (() => {
  const r = zufall(31);
  const zwischen = (a: number, b: number) => a + (b - a) * r();
  const schwarm: Bahn[] = Array.from({ length: 18 }, () => ({
    x0: zwischen(-18, 25),
    y0: zwischen(98, 118),
    x1: zwischen(65, 125),
    y1: zwischen(-25, 35),
    bogen: zwischen(-18, 18),
    s0: zwischen(0.5, 0.9),
    s1: zwischen(1, 1.6),
    verz: zwischen(0, 1.1),
    zeit: zwischen(1.5, 2.3),
    groesse: zwischen(6, 11),
  }));
  // Zwei kommen ganz nah: aus der Mitte heraus, groß werdend, seitlich vorbei.
  schwarm.push(
    { x0: 40, y0: 62, x1: -30, y1: 20, bogen: -10, s0: 0.3, s1: 5, verz: 0.55, zeit: 1.5, groesse: 10 },
    { x0: 58, y0: 70, x1: 130, y1: 45, bogen: 12, s0: 0.3, s1: 4, verz: 1.05, zeit: 1.4, groesse: 10 }
  );
  return schwarm;
})();

export default function HalloweenIntro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, DAUER_MS);
    return () => window.clearTimeout(id);
  }, [onDone]);

  return (
    <div className="halloween-intro" aria-hidden="true">
      <div className="halloween-nacht" />
      {SCHWARM.map((bahn, i) => (
        <span
          key={i}
          className="halloween-bahn"
          style={
            {
              "--x0": `${bahn.x0}vw`,
              "--y0": `${bahn.y0}vh`,
              "--x1": `${bahn.x1}vw`,
              "--y1": `${bahn.y1}vh`,
              "--bogen": `${bahn.bogen}vh`,
              "--s0": bahn.s0,
              "--s1": bahn.s1,
              animationDelay: `${bahn.verz}s`,
              animationDuration: `${bahn.zeit}s`,
            } as CSSProperties
          }
        >
          <Fledermaus groesse={bahn.groesse} takt={0.12 + (i % 4) * 0.025} />
        </span>
      ))}
    </div>
  );
}

/** Eine Fledermaus · die Flügel schlagen, der Körper bleibt. */
function Fledermaus({ groesse, takt }: { groesse: number; takt: number }) {
  const fluegel =
    "M-1.6-1.2C-5-5.6-10.5-7-17.5-3.6-14.2-2.6-13.4.2-14.2 2.4-11.4.6-9.4 1.4-8.6 3.6-6.8 1-4.8.8-2.6 2Z";
  return (
    <svg
      className="halloween-fledermaus"
      viewBox="-18 -9 36 18"
      style={{ width: `max(${groesse * 3}px, ${groesse}vmin)`, "--takt": `${takt}s` } as CSSProperties}
    >
      <g className="halloween-fluegel">
        <path d={fluegel} />
        <path d={fluegel} transform="scale(-1 1)" />
      </g>
      <path d="M-1.8-3.4-1.4-5.6-.5-3.9H.5L1.4-5.6 1.8-3.4C2.6-2 2.4 1.6 0 4-2.4 1.6-2.6-2-1.8-3.4Z" />
      <circle cx="-.75" cy="-2.3" r=".5" className="halloween-auge" />
      <circle cx=".75" cy="-2.3" r=".5" className="halloween-auge" />
    </svg>
  );
}
