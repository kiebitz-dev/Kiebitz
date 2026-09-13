/**
 * Das Notizfeld des Blattes · liniertes Papier, auf dem man auch schreiben darf.
 *
 * Zwei Blätter stellen es auf: das Buch (`pages/blatt/RepertoireBlatt.tsx`) an
 * der aufgeschlagenen Stellung und der Trainer (`pages/blatt/TrainerBlatt.tsx`)
 * an der Karte, die gerade drankommt. Ein Feld, das an zwei Stellen dasselbe
 * tut, gehört einmal geschrieben.
 */
import { useState } from "react";
import { useI18n } from "../../lib/i18n";

/**
 * Die Notiz zur Stellung · liniertes Papier, auf dem man auch schreiben darf.
 *
 * Sie stand hier bis 1.4 als bloßer Abdruck: Der Satz war gesetzt, das Feld
 * sah aus wie ein Formularfeld, und getippt werden konnte darin nichts. Wer
 * den Modus einschaltete, verlor damit eine Funktion — und zwar die eine, bei
 * der der Modus am ehesten dazu einlädt, sie zu benutzen.
 *
 * Geschrieben wird deshalb im Feld selbst, und das Papier bleibt, was es ist:
 * dieselben Linien im Abstand von 25 Bildpunkten, auf denen der Text auch
 * vorher stand. Die Zeilenhöhe ist genau dieser Abstand, sonst liefen Schrift
 * und Linien nach drei Zeilen auseinander.
 *
 * Gespeichert wird auf Zuruf und nicht bei jedem Anschlag: Zwei Wege stehen
 * unter dem Feld, sobald etwas anderes darin steht als im Buch — verwerfen
 * und schreiben. Dieselbe Regel wie im `NoteEditor` der gewöhnlichen Fassung,
 * nur ohne Knöpfe mit Fläche.
 */
export function Notizfeld({
  notiz,
  platzhalter,
  onSpeichern,
}: {
  notiz: string;
  platzhalter: string;
  onSpeichern: (text: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(notiz);
  const [laeuft, setLaeuft] = useState(false);
  const offen = text.trim() !== notiz.trim();

  const linien =
    "repeating-linear-gradient(to bottom, transparent 0, transparent 24px, var(--color-line) 24px, var(--color-line) 25px)";

  return (
    <>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder={platzhalter}
        aria-label={t("rep.note")}
        className="buch mt-1.5 block w-full resize-y border-0 p-0 text-[14px] text-ink2 outline-none placeholder:text-ink3"
        style={{ background: linien, lineHeight: "25px" }}
      />
      {offen && (
        <div className="mt-1.5 flex justify-end gap-4 text-[12px]">
          <button
            type="button"
            onClick={() => setText(notiz)}
            disabled={laeuft}
            className="text-ink3 hover:text-ink disabled:text-line2"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={async () => {
              setLaeuft(true);
              try {
                await onSpeichern(text);
              } finally {
                setLaeuft(false);
              }
            }}
            disabled={laeuft}
            className="text-accent hover:underline disabled:text-line2"
          >
            {t("common.save")}
          </button>
        </div>
      )}
    </>
  );
}
