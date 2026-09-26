import { invoke } from "@tauri-apps/api/core";

/**
 * Herzschlag an den Wachhund (`watchdog.rs`, nur Linux-Desktop). Friert das
 * Fenster ein, sieht der Wachhund daran, ob die Oberfläche noch lebt oder der
 * Hauptthread steht. Eigenes Modul, nachgeladen: Nur Linux braucht es, und
 * im Startbündel zählt jedes Byte (scripts/check-bundle-size.mjs). Antwortet das Backend mit `false` (Windows, Android),
 * hört der Takt nach dem ersten Schlag auf. Gibt eine Abmeldefunktion zurück.
 */
export function startHeartbeat(intervalMs = 2_000): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let listening = false;
  const beat = () =>
    invoke<boolean>("ui_heartbeat", { visible: document.visibilityState === "visible" }).then(
      (answer) => answer,
      () => false,
    );
  void beat().then((answer) => {
    listening = answer;
    if (!listening || stopped) return;
    timer = setInterval(() => void beat(), intervalMs);
  });
  // Sichtbarkeit sofort melden · ein verborgenes Fenster drosselt seine Timer,
  // und die Stille soll dann nicht als Hänger gelten.
  const onVisibility = () => {
    if (listening) void beat();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
