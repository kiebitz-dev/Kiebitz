/**
 * Die Startanimation des Events dieses Builds · neben der App, nicht in ihr.
 *
 * Sie hält nichts auf: Der Chunk wird erst nach dem ersten Bild geholt, die
 * Ebene fängt keine Klicks ab, und wenn das Laden scheitert, gibt es eben
 * keine Animation. Wo Bewegung abbestellt ist, das Fenster verborgen startet
 * oder WebKitGTK alles in Software zeichnet (siehe main.tsx), bleibt sie aus.
 */
import { useCallback, useEffect, useState } from "react";
import { activeEvent, type EventIntro as Intro } from "./index";

function introAllowed(): boolean {
  const root = document.documentElement;
  return (
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches &&
    document.visibilityState !== "hidden" &&
    root.dataset.webkitgtk !== "true"
  );
}

export default function EventIntro() {
  const [Intro, setIntro] = useState<Intro | null>(null);
  const done = useCallback(() => setIntro(null), []);

  useEffect(() => {
    const event = activeEvent();
    if (!event?.intro || !introAllowed()) return;
    let cancelled = false;
    event
      .intro()
      .then((module) => {
        if (!cancelled) setIntro(() => module.default);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return Intro ? <Intro onDone={done} /> : null;
}
