/**
 * Die gemeinsame Erklärung zu Kiebitz Plus.
 *
 * Jede gesperrte Funktion öffnet diesen einen Dialog. Er sagt, was Plus
 * enthält, was gerade angefragt wurde und wie man es bekommt · und zwar ohne
 * Preis: Preise stehen in Stripe beziehungsweise Google Play und werden im
 * Checkout genannt, nicht im App-Code.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ExternalLink, Loader2, Sparkles, X } from "lucide-react";
import { useI18n, useT } from "../lib/i18n";
import { openExternal } from "../lib/ext";
import { errorMessage } from "../lib/errors";
import { onPlusDialog } from "../lib/plus/dialog";
import {
  FEATURE_DESC_KEY,
  FEATURE_NAME_KEY,
  FEATURE_ORDER,
} from "../lib/plus/labels";
import { billingAvailable } from "../lib/plus/billing";
import { pollAfterReturn, purchaseWithGooglePlay, startCheckout } from "../lib/plus/store";
import { usePlus } from "../lib/plus/usePlus";
import { isPlusOnlyFeature, type PlusFeature } from "../lib/plus/types";
import { useBackDismiss } from "../lib/backDismiss";
import { useMobileShell } from "./MobileShell";
import { SHEET_ROOT_ID } from "./MobileSheet";
import { Button } from "./ui";

export default function PlusDialog({ openSettings }: { openSettings?: () => void }) {
  const t = useT();
  const plus = usePlus();
  const mobile = useMobileShell();
  // Der Checkout und die spätere Vertragsbestätigung folgen der Sprache, in
  // der dieser Dialog gerade steht.
  const { locale } = useI18n();
  const [requested, setRequested] = useState<PlusFeature | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Wo Google Play antwortet, laeuft der Kauf dort · siehe PlusSection.
  const [playBilling, setPlayBilling] = useState<boolean | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(
    () =>
      onPlusDialog((feature) => {
        setRequested(feature);
        setError(null);
        setNotice(null);
        setOpen(true);
      }),
    []
  );

  useEffect(() => {
    let alive = true;
    void billingAvailable().then((available) => {
      if (alive) setPlayBilling(available);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Escape schließt · derselbe Griff wie bei den übrigen Dialogen der App.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Der Dialog nennt sich modal · dann muss er es auch sein.
   *
   * Beim Öffnen wandert der Fokus hinein, der Tabulator bleibt drin, und beim
   * Schließen kehrt er dorthin zurück, wo er herkam. Ohne das landet die
   * Tastatur nach einem Klick auf eine gesperrte Vorschau wieder am Seitenanfang
   * und muss sich den Weg zurück suchen.
   */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = Array.from(
        panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")
      ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Android-Zurück schliesst den Dialog, statt die Seite darunter zu wechseln
  // und ihn stehen zu lassen. Zugleich ist er damit eine Schicht wie jede
  // andere · ein zweiter Tipp auf den eigenen Tab räumt ihn ab.
  useBackDismiss(() => setOpen(false), open);

  if (!open) return null;

  /**
   * Wohin der Dialog gezeichnet wird · dieselbe Überlegung wie beim
   * Wochenbericht (siehe WeeklyReportDialog).
   *
   * Auf dem Handy in den Behälter, der genau die Fläche von <main> abdeckt:
   * Die Navigationsleiste bleibt sichtbar und bedienbar, und der Dialog endet
   * oberhalb des Anzeigenbands. Das Band ist auf Android eine native Fläche
   * über der WebView — was darunter läuft, verschwindet dahinter und ist von
   * HTML aus nicht zu überdecken. Ausserhalb der mobilen Schale gibt es den
   * Behälter nicht, dann bleibt es beim Dialog über dem Fenster.
   */
  const container = mobile ? document.getElementById(SHEET_ROOT_ID) : null;

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      if (playBilling) {
        const outcome = await purchaseWithGooglePlay();
        if (outcome === "pending") setNotice(t("plus.purchasePending"));
        return;
      }
      const session = await startCheckout(locale);
      openExternal(session.checkout_url);
      // Der Webhook trifft asynchron ein · ab jetzt kurz nachfragen.
      pollAfterReturn();
      setNotice(
        session.trial_days > 0
          ? t("plus.checkoutTrial", { n: session.trial_days })
          : t("plus.checkoutOpened")
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cta = plus.isPlus || playBilling === null ? null : plus.signedIn ? (
    <Button primary onClick={buy} disabled={busy}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      {!playBilling && plus.trialEligible ? t("plus.startTrial") : t("plus.subscribe")}
    </Button>
  ) : (
    <Button
      primary
      onClick={() => {
        setOpen(false);
        openSettings?.();
      }}
    >
      <ExternalLink size={14} /> {t("plus.openSettings")}
    </Button>
  );

  const dialog = (
    <div
      className={`${container ? "absolute z-40 p-3" : "fixed z-50 p-4"} inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px]`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plus-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50 ${
          container ? "max-h-full" : "max-h-[88vh]"
        }`}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              Kiebitz
            </div>
            <h2 id="plus-dialog-title" className="text-[16px] font-semibold">
              {t("plus.title")}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="-mr-1 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {requested && isPlusOnlyFeature(requested) && (
            <p className="mb-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
              {t("plus.requested", { f: t(FEATURE_NAME_KEY[requested]) })}
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-ink2">{t("plus.dialogLead")}</p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {FEATURE_ORDER.map((feature) => (
              <li key={feature} className="flex gap-2.5">
                <Check size={15} className="mt-0.5 shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{t(FEATURE_NAME_KEY[feature])}</span>
                  <span className="block text-[12px] leading-relaxed text-ink3">
                    {t(FEATURE_DESC_KEY[feature])}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12px] leading-relaxed text-ink3">{t("plus.localFirst")}</p>
          {!plus.signedIn && (
            <p className="mt-2 text-[12px] leading-relaxed text-ink3">{t("plus.signInFirst")}</p>
          )}
          {notice && (
            <p className="mt-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
              {notice}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
          <Button onClick={() => setOpen(false)}>{t("common.close")}</Button>
          {cta}
        </div>
      </div>
    </div>
  );

  return container ? createPortal(dialog, container) : dialog;
}
