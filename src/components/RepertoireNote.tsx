/**
 * Die Notiz zu einer Repertoire-Stellung · Plan, Idee, Falle.
 *
 * Ein Feld, zwei Orte. Es stand seit jeher am gewählten Knoten des Buches;
 * seit 1.4 steht dasselbe Feld auch im Training, und zwar aus dem Grund, aus
 * dem man Notizen überhaupt schreibt: Der Satz, den man sich vornimmt, fällt
 * einem ein, wenn man die Stellung gerade *nicht* gewusst hat — nicht drei
 * Klicks später im Verzeichnis.
 *
 * Deshalb liegt es hier und nicht mehr in `pages/Repertoire.tsx`. Ein
 * Textfeld, das an zwei Stellen dasselbe tut, gehört einmal geschrieben; sonst
 * treiben die beiden Fassungen auseinander, sobald eine von ihnen etwas dazu
 * bekommt.
 *
 * Gespeichert wird auf Zuruf: Die beiden Wege stehen erst da, wenn im Feld
 * etwas anderes steht als im Buch. Ein Feld, das bei jedem Anschlag schreibt,
 * spart einen Klick und kostet die Möglichkeit, einen Satz zu verwerfen.
 */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { repSetNote } from "../lib/repertoire";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { Button } from "./ui";

export default function RepertoireNote({
  nodeId,
  note,
  rows = 3,
  onSaved,
  onError,
}: {
  /** Der Knoten, an dem die Notiz hängt. */
  nodeId: number;
  /** Was im Buch steht · der Stand, gegen den „geändert" gemessen wird. */
  note: string;
  rows?: number;
  /** Nach dem Schreiben · die Seite lädt ihren Baum neu. */
  onSaved?: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== note.trim();

  const save = async () => {
    setBusy(true);
    try {
      await repSetNote(nodeId, text);
      onSaved?.(text);
    } catch (e) {
      onError?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={rows}
        placeholder={t("rep.notePlaceholder")}
        aria-label={t("rep.note")}
        className="w-full resize-y rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => setText(note)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button primary onClick={save} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("common.save")}
          </Button>
        </div>
      )}
    </>
  );
}
