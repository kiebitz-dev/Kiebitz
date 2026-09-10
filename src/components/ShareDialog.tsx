/**
 * „Teilen" für jedes Brett.
 *
 * Der Dialog macht aus einer Stellung zwei Dinge: eine Bildkarte, die für sich
 * spricht, und einen Link, der die Stellung überall wieder aufmacht. Beides
 * zusammen ist der Punkt: Ein Bild allein lässt sich nicht weiterspielen, ein
 * Link allein sieht in einem Chat nach nichts aus.
 *
 * Die Vorschau zeigt genau das Bild, das hinausgeht. Wer einen Schalter
 * umlegt, sieht die Wirkung sofort; nichts wird erst beim Absenden entschieden.
 * „Sofort" ist wörtlich gemeint: Die Vorschau *ist* die Leinwand, auf die
 * gezeichnet wird, kein PNG-Abzug davon. Nur wer das Bild mitnimmt, bezahlt
 * die Kodierung (siehe `share/card.ts`).
 *
 * Verdeckt bleibt beim Puzzle nicht nur die Lösung, sondern auch das Motiv:
 * „Matt in 2" über dem Brett wäre schon die halbe Lösung · dieselbe Überlegung
 * wie hinter `hideTheme` im Trainer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ClipboardCopy,
  Copy,
  Download,
  FlipVertical2,
  Link2,
  Loader2,
  Share2,
  X,
} from "lucide-react";
import { useBackDismiss } from "../lib/backDismiss";
import { useBackendInfo } from "../lib/backend";
import { errorMessage } from "../lib/errors";
import { useI18n, type Key } from "../lib/i18n";
import { evalLabel } from "../lib/evaluation";
import { themeLabel } from "../lib/puzzles";
import { appliedPieceSet } from "../lib/theme";
import { CARD_SIZE, drawShareCard, shareCardBlob } from "../lib/share/card";
import type { ShareEval, ShareKind, ShareMove, SharePayload } from "../lib/share/codec";
import { copyImage, copyText, saveImage, shareNative, shareTargets } from "../lib/share/deliver";
import { shareUrl } from "../lib/share/link";
import { Button } from "./ui";

/** Was geteilt werden soll · die Seiten reichen ihre Stellung genau so herein. */
export interface ShareSubject {
  kind: ShareKind;
  fen: string;
  orientation: "white" | "black";
  /** Zug, der zu dieser Stellung führte · beim Puzzle der Gegnerzug. */
  lastMove?: ShareMove | null;
  /** Variante der Analyse, Lösung der Aufgabe oder Züge der Repertoire-Linie. */
  line?: ShareMove[];
  eval?: ShareEval | null;
  rating?: number;
  theme?: string;
  /**
   * Die Züge vor der Stellung, fertig gesetzt · siehe `share/notation.ts`.
   * Bei Aufgabe und Endspiel bleibt sie leer: Dort gibt es keine Vorgeschichte,
   * und ein Weg zur Stellung wäre schon ein Wink.
   */
  history?: string;
  /**
   * Vorschlag für die Überschrift · der Name der Variante, der Titel des
   * Drills. Der Absender kann ihn überschreiben, aber er muss ihn nicht
   * abtippen, nur weil die Seite ihn längst kennt.
   */
  title?: string;
}

/**
 * Die Wörter, die an der Art hängen. Jede Art bringt ihren Aufmacher, ihren
 * Vorgabetitel und die Beschriftung des Linien-Schalters mit · dieselbe Reihe
 * an Texten wie auf der Landeseite, nur hier für den Absender.
 */
const KIND_TEXT: Record<
  ShareKind,
  { badge: Key; lead: Key; heading: Key; line: Key }
> = {
  analysis: {
    badge: "sh.badgeAnalysis",
    lead: "sh.leadAnalysis",
    heading: "sh.defaultAnalysis",
    line: "sh.optLine",
  },
  puzzle: {
    badge: "sh.badgePuzzle",
    lead: "sh.leadPuzzle",
    heading: "sh.defaultPuzzle",
    line: "sh.optSolution",
  },
  repertoire: {
    badge: "sh.badgeRepertoire",
    lead: "sh.leadRepertoire",
    heading: "sh.defaultRepertoire",
    line: "sh.optVariation",
  },
  endgame: {
    badge: "sh.badgeEndgame",
    lead: "sh.leadEndgame",
    heading: "sh.defaultEndgame",
    line: "sh.optLine",
  },
};

function other(orientation: "white" | "black"): "white" | "black" {
  return orientation === "white" ? "black" : "white";
}

/** Wer am Zug ist, steht im FEN · für die Karte reicht das zweite Feld. */
function whiteToMove(fen: string): boolean {
  return (fen.trim().split(/\s+/)[1] ?? "w") === "w";
}

function evalText(value: ShareEval | null | undefined): string {
  if (!value) return "";
  if (value.mate != null) return `#${Math.abs(value.mate)}`;
  return value.cp != null ? evalLabel(value.cp) : "";
}

export default function ShareDialog({
  subject,
  onClose,
}: {
  subject: ShareSubject;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const backend = useBackendInfo();
  const targets = shareTargets(backend.info?.platform, backend.mode === "desktop");
  const puzzle = subject.kind === "puzzle";
  const words = KIND_TEXT[subject.kind] ?? KIND_TEXT.analysis;

  const [heading, setHeading] = useState(subject.title?.slice(0, 60) ?? "");
  const [flipped, setFlipped] = useState(false);
  const [withLine, setWithLine] = useState(true);
  const [withHistory, setWithHistory] = useState(true);
  const [withEval, setWithEval] = useState(!puzzle);
  const [revealed, setRevealed] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [cardError, setCardError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLCanvasElement | null>(null);

  // Eigene Kennung, damit Vorschau und Link nicht bei jedem Tastendruck neu
  // gebaut werden, nur weil `subject.line` ein neues leeres Feld ist.
  const line = useMemo(() => subject.line ?? [], [subject]);
  const orientation = flipped ? other(subject.orientation) : subject.orientation;
  const evaluation = withEval ? (subject.eval ?? null) : null;

  const payload: SharePayload = useMemo(
    () => ({
      kind: subject.kind,
      fen: subject.fen,
      orientation,
      lastMove: subject.lastMove ?? null,
      line: withLine ? line : [],
      eval: evaluation,
      title: heading.trim() || undefined,
      rating: subject.rating,
      history: withHistory ? subject.history : undefined,
      // Das Motiv reist mit, die Landeseite hält es hinter derselben Klappe wie
      // die Lösung.
      theme: subject.theme,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, orientation, withLine, withHistory, evaluation, heading, line]
  );

  const url = useMemo(() => shareUrl(payload), [payload]);
  const defaultHeading = t(words.heading);
  const shownHeading = heading.trim() || defaultHeading;
  const message = `${shownHeading} · ${t("sh.via")}\n${url}`;

  // Die Überschrift für das Bild hinkt dem Feld absichtlich hinterher: Ein
  // Neuzeichnen je Tastendruck wäre verschenkte Arbeit. Alles andere im Dialog
  // ist ein Schalter, und ein Schalter wartet auf nichts.
  const [settledHeading, setSettledHeading] = useState(shownHeading);
  useEffect(() => {
    if (settledHeading === shownHeading) return;
    const timer = window.setTimeout(() => setSettledHeading(shownHeading), 140);
    return () => window.clearTimeout(timer);
  }, [shownHeading, settledHeading]);

  // Vorschau zeichnen · unmittelbar auf die Leinwand, die im Dialog hängt.
  useEffect(() => {
    let alive = true;
    const chips = [
      t(whiteToMove(subject.fen) ? "sh.whiteToMove" : "sh.blackToMove"),
      evalText(evaluation),
      subject.rating ? t("sh.rating", { n: subject.rating }) : "",
      // Motiv erst mit der Lösung · vorher verrät es zu viel.
      revealed && subject.theme ? themeLabel(subject.theme, locale) : "",
    ].filter(Boolean);

    drawShareCard(
      {
        fen: subject.fen,
        orientation,
        lastMove: subject.lastMove ?? null,
        arrow: revealed ? (line.length ? line[0] : null) : null,
        heading: settledHeading,
        chips,
        badge: t(words.badge),
        tagline: t("sh.tagline"),
        // Das geteilte Bild zeigt die Figuren, die der Absender vor sich hat.
        pieceSet: appliedPieceSet(),
      },
      cardRef.current
    )
      .then(() => {
        if (!alive) return;
        setCardReady(true);
        setCardError(false);
      })
      .catch(() => {
        if (alive) setCardError(true);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, orientation, revealed, evaluation, settledHeading, locale, t]);

  // Auf Android gibt es kein Escape · dort schließt die Zurück-Taste. Der
  // Dialog meldet sich dafür als Schicht an, wie der Fokus und der Wochenbrief
  // (siehe lib/backDismiss.ts). Ohne die Anmeldung blieb er nach einem Tipp auf
  // Zurück über der Seite stehen, während der Fokus unter ihm wegging.
  useBackDismiss(onClose);

  // Escape schließt · derselbe Griff wie in den übrigen Dialogen der App.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Das PNG der Vorschau · gebaut in dem Augenblick, in dem es gebraucht wird.
   * Solange niemand kopiert, speichert oder teilt, entsteht es gar nicht.
   */
  const cardBlob = async (): Promise<Blob | null> => {
    const canvas = cardRef.current;
    if (!canvas || !cardReady) return null;
    return await shareCardBlob(canvas);
  };

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const done = await action();
      if (done) setNotice(done);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (label: string, value: boolean, onChange: (next: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-ink2">
      <input
        type="checkbox"
        checked={value}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );

  // Am Dokument und nicht in der Seite · und über dem Fokus-Brett.
  //
  // „Teilen" steht auf jeder Brettseite auch in der Fokusleiste, und der Fokus
  // hängt selbst am `document.body` (siehe components/FocusBoard.tsx). Blieb
  // der Dialog im Baum der Seite, lag er unter dem Fokus: Er war da, er hörte
  // auf Escape · zu sehen war er nicht. Aus dem Fokus heraus ließ sich das
  // Bild deshalb gar nicht teilen.
  //
  // Die Stufe darüber löst es. 55 liegt über dem Fokus (50) und unter der
  // Führung (60): Der Rundgang erklärt die Seite und muss auch einen offenen
  // Dialog überdecken dürfen.
  const dialog = (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Share2 size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="share-dialog-title" className="text-[16px] font-semibold">
              {t("sh.title")}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink3">
              {t(words.lead)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="relative overflow-hidden rounded-xl border border-line bg-panel2">
            <canvas
              ref={cardRef}
              width={CARD_SIZE}
              height={CARD_SIZE}
              role="img"
              aria-label={t("sh.preview")}
              className={`block aspect-square w-full ${cardReady ? "" : "invisible"}`}
            />
            {/* Der Hinweis liegt nur so lange darüber, bis zum ersten Mal
                gezeichnet wurde · danach wird an Ort und Stelle ersetzt, ohne
                dass die Vorschau zwischendurch verschwindet. */}
            {!cardReady && (
              <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-ink3">
                {cardError ? (
                  <span className="px-6 text-center">{t("sh.imageFailed")}</span>
                ) : (
                  <Loader2 size={18} className="animate-spin" />
                )}
              </div>
            )}
          </div>

          <input
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
            placeholder={defaultHeading}
            aria-label={t("sh.headingLabel")}
            maxLength={60}
            className="mt-4 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-line2"
          />

          <div className="mt-3 flex flex-col gap-2.5">
            {line.length > 0 && toggle(t(words.line), withLine, setWithLine)}
            {subject.history ? toggle(t("sh.optHistory"), withHistory, setWithHistory) : null}
            {line.length > 0 && toggle(t("sh.optReveal"), revealed, setRevealed)}
            {subject.eval && toggle(t("sh.optEval"), withEval, setWithEval)}
            <button
              type="button"
              onClick={() => setFlipped((value) => !value)}
              className="flex w-fit items-center gap-2 text-[12.5px] text-ink3 transition-colors hover:text-ink"
            >
              <FlipVertical2 size={14} /> {t("sh.optFlip")}
            </button>
          </div>

          <p className="mt-4 rounded-lg border border-line bg-panel2 px-3 py-2 text-[11.5px] leading-relaxed text-ink3">
            {t("sh.privacy")}
          </p>

          {notice && (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-accent">
              <Check size={14} /> {notice}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12.5px] text-loss">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          {targets.native && (
            <Button
              primary
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await shareNative({
                    title: shownHeading,
                    text: message,
                    image: await cardBlob(),
                  });
                  return null;
                })
              }
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              {t("sh.share")}
            </Button>
          )}
          <Button
            primary={!targets.native}
            disabled={busy}
            onClick={() => run(async () => (await copyText(message), t("sh.linkCopied")))}
          >
            <Link2 size={14} /> {t("sh.copyLink")}
          </Button>
          {targets.copyImage && (
            <Button
              disabled={busy || !cardReady}
              onClick={() =>
                run(async () => {
                  const blob = await cardBlob();
                  if (!blob) return null;
                  await copyImage(blob);
                  return t("sh.imageCopied");
                })
              }
            >
              <Copy size={14} /> {t("sh.copyImage")}
            </Button>
          )}
          {targets.saveImage && (
            <Button
              disabled={busy || !cardReady}
              onClick={() =>
                run(async () => {
                  const blob = await cardBlob();
                  if (!blob) return null;
                  const path = await saveImage(blob, "kiebitz-stellung.png");
                  return path ? t("sh.imageSaved", { path }) : null;
                })
              }
            >
              <Download size={14} /> {t("sh.saveImage")}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => run(async () => (await copyText(subject.fen), t("sh.fenCopied")))}
          >
            <ClipboardCopy size={14} /> {t("sh.copyFen")}
          </Button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
