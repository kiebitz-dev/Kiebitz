/**
 * Erscheinungsbild: Farbwelt, automatischer Wechsel, Brett und Figuren.
 *
 * Der Wechsel steht seit 1.4 direkt unter den Themenkacheln und nicht mehr
 * am Ende der Seite. Er ist die Fortsetzung derselben Frage — welches Thema
 * gilt wann — und gehört deshalb neben die Wahl und nicht hinter zwei
 * Abschnitte über Feldfarben und Figurenzeichnungen. Ein Hinweis stand
 * zwischen beidem („Gerade gilt Dunkel · der automatische Wechsel hat die
 * Wahl übernommen"); mit dem Wechsel eine Zeile darunter erklärt sich das
 * von selbst.
 *
 * Die Vorschau ist keine Nachbildung, sondern die Sache selbst: Jede Kachel
 * trägt `data-theme` ihres Themas, und die Farbtokens darin gelten für ihren
 * Inhalt. Deshalb steht in dieser Datei kein einziger Farbwert — was in
 * `src/themes.css` steht, ist auch in der Kachel zu sehen. Für die Figuren
 * gilt dasselbe: Die Vorschau zeichnet die Figuren des Sets, nicht ein Bild
 * davon.
 */
import {
  ArrowLeftRight,
  BookMarked,
  Crown,
  LayoutGrid,
  Palette,
  Sparkles,
} from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Chip } from "../../components/ui";
import { useI18n } from "../../lib/i18n";
import { openPlusDialog } from "../../lib/plus/dialog";
import { usePlusGate } from "../../lib/plus/usePlus";
import {
  PIECE_VIEWBOX,
  glyphsVersion,
  loadPieceGlyphs,
  pieceGlyphs,
  subscribeGlyphs,
} from "../../lib/pieces/glyphs";
import { PIECE_SETS, pieceSetDef, type PieceSetId } from "../../lib/pieces/sets";
import {
  BOARD_SETS,
  DEFAULT_BOARD_SET,
  THEMES,
  THEME_FEATURE,
  type Appearance,
  type BoardSetId,
  type ThemeId,
} from "../../lib/theme";
import { Field, inputCls } from "./SettingsLayout";

/** Angedeutete Oberfläche: Fläche, zwei Textzeilen, Akzent und ein Brett. */
function ThemePreview() {
  return (
    <span className="flex items-center gap-2 rounded-md bg-bg p-2">
      <span className="flex flex-1 flex-col gap-1">
        <span className="h-1.5 w-full rounded-full bg-ink2" />
        <span className="h-1.5 w-2/3 rounded-full bg-ink3" />
        <span className="h-1.5 w-1/3 rounded-full bg-accent" />
      </span>
      <BoardPreview />
    </span>
  );
}

/**
 * Drei Figuren eines Sets auf einem Stück Brett · die Vorschau zeigt die
 * Zeichnungen selbst und nicht ihre Beschreibung. Dame, Springer und Bauer
 * sind die drei, an denen ein Set als erstes auseinandergeht.
 */
function PiecePreview({ set }: { set: PieceSetId }) {
  const glyphs = pieceGlyphs(set);
  return (
    <span className="flex items-center gap-px overflow-hidden rounded-sm">
      {(["wQ", "bN", "wP"] as const).map((code, index) => (
        <span
          key={code}
          className={`flex h-7 w-7 items-center justify-center ${
            index % 2 === 0 ? "bg-board-light" : "bg-board-dark"
          }`}
        >
          <svg
            viewBox={PIECE_VIEWBOX}
            className="h-full w-full"
            aria-hidden="true"
            // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
            dangerouslySetInnerHTML={{ __html: glyphs[code] ?? "" }}
          />
        </span>
      ))}
    </span>
  );
}

/** Zwei mal zwei Felder · genug, um die Feldfarben zu zeigen. */
function BoardPreview() {
  return (
    <span className="grid h-6 w-6 shrink-0 grid-cols-2 overflow-hidden rounded-sm">
      <span className="bg-board-light" />
      <span className="bg-board-dark" />
      <span className="bg-board-dark" />
      <span className="bg-board-light" />
    </span>
  );
}

/**
 * Miniatur des Blatts · Kolumnentitel, kräftige Linie, Registerzeilen.
 *
 * Dieselbe Regel wie bei den Themenkacheln: gezeigt wird die Sache und nicht
 * ihre Beschreibung. Was das Blatt ausmacht, steht hier in klein — der
 * Satzspiegel auf hellem Grund, die Linie unter dem Kolumnentitel und die
 * Punktlinien des Registers.
 *
 * Ohne Serife: Die Buchschrift lädt erst, wenn ein Zeichen in ihr gesetzt
 * werden soll, und das soll sie erst im Blatt und nicht schon in den
 * Einstellungen. Die Form allein sagt hier ohnehin mehr als ein Wort.
 */
function BlattPreview() {
  return (
    <span className="flex h-11 w-16 shrink-0 flex-col gap-[3px] overflow-hidden rounded-md border border-line bg-bg px-2 py-1.5">
      <span className="h-[3px] w-5 rounded-[1px] bg-ink3" />
      <span className="h-px w-full bg-ink" />
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex items-center gap-1">
          <span className="h-[3px] w-2.5 shrink-0 rounded-[1px] bg-ink2" />
          <span className="flex-1 border-b border-dotted border-line2" />
          <span className="h-[3px] w-1.5 shrink-0 rounded-[1px] bg-ink2" />
        </span>
      ))}
    </span>
  );
}

/** Miniatur des Dashboards · zwei Wertungskacheln und ein Verlauf darunter. */
function KachelPreview() {
  return (
    <span className="flex h-11 w-16 shrink-0 flex-col gap-1 overflow-hidden rounded-md border border-line bg-bg p-1.5">
      <span className="flex flex-1 gap-1">
        {[0, 1].map((card) => (
          <span
            key={card}
            className="flex flex-1 flex-col justify-center gap-[3px] rounded-[3px] bg-panel3 px-1"
          >
            <span className="h-[3px] w-2.5 rounded-full bg-ink3" />
            <span
              className={`h-[5px] w-4 rounded-full ${card === 0 ? "bg-ink2" : "bg-accent"}`}
            />
          </span>
        ))}
      </span>
      <span className="h-2.5 shrink-0 rounded-[3px] bg-panel3" />
    </span>
  );
}

/**
 * Der Layoutmodus · die zweite Art, dieselbe App zu lesen.
 *
 * Er steht über der Farbwelt, weil er die Seiten anders *setzt* und nicht
 * anders färbt · beides gehört ins Erscheinungsbild, aber der Satz kommt vor
 * der Farbe.
 *
 * Die Zeile nennt nicht den Modus, in dem man steckt, sondern den, in den sie
 * führt: Wer im Dashboard sitzt, liest hier „Diagramm-Modus", wer im Blatt
 * sitzt, liest „Dashboard-Modus". Ein Schalter stand hier früher — der
 * beantwortete aber die Frage „wo bin ich?" und nicht die Frage „wo will ich
 * hin?", und daneben brauchte er drei Zeilen Erklärung. Ein Ziel und ein Tipp
 * darauf sagen dasselbe kürzer.
 *
 * Neben dem Ziel steht es auch: eine Miniatur dessen, was einen dort erwartet.
 * Ein Name allein verrät nicht, dass der eine Modus in Kacheln und der andere
 * in Formularzeilen denkt — ein Blick darauf schon.
 */
function LayoutModeRow({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  const { t } = useI18n();
  // Angezeigt wird der jeweils andere Modus · er ist das Ziel des Tipps.
  const target = on ? t("set.dashboardMode") : t("set.diagramMode");
  const toBlatt = !on;
  const Icon = on ? LayoutGrid : BookMarked;
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      // Der sichtbare Name steht im vorlesbaren enthalten · so hört die
      // Sprachbedienung, wohin der Tipp führt, und die Suche nach dem
      // gelesenen Wort findet trotzdem dieselbe Schaltfläche.
      aria-label={t("set.layoutModeSwitch", { m: target })}
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-panel2 p-2.5 text-start transition-colors hover:border-accent-dim hover:bg-panel3"
    >
      {toBlatt ? <BlattPreview /> : <KachelPreview />}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Icon size={15} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{target}</span>
      </span>
      <ArrowLeftRight
        size={15}
        className="shrink-0 text-ink3 transition-colors group-hover:text-accent"
      />
    </button>
  );
}

export default function AppearanceSection({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  /** Wirkt sofort · die Seite wendet die Wahl an und speichert sie. */
  onChange: (next: Appearance) => void;
}) {
  const { t } = useI18n();
  const gate = usePlusGate(THEME_FEATURE);
  // Die Vorschau zeigt jedes Set nebeneinander · dafür müssen hier ausnahmsweise
  // alle Zeichnungen her, nicht nur die des geltenden Sets. Sie kommen einzeln
  // an, und jede angekommene färbt ihre Kachel nach.
  useEffect(() => {
    for (const set of PIECE_SETS) void loadPieceGlyphs(set.id);
  }, []);
  useSyncExternalStore(subscribeGlyphs, glyphsVersion, glyphsVersion);
  // Solange der Plus-Zustand geprüft wird, bleiben die Kacheln offen: Ein
  // Schloss, das nach einer Sekunde verschwindet, ist schlechter als eines,
  // das eine Sekunde später erscheint.
  const locked = !gate.unlocked && !gate.pending;
  /**
   * Der Stern sagt „das gibt es mit Plus" · er ist ein Hinweis für den, der
   * es noch nicht hat. Wer Plus hat, bekäme sonst dreiundzwanzig Sterne auf
   * einer Seite gezeigt, die nichts mehr unterscheiden: Alles steht ihm offen,
   * und ein Merkmal, das auf alles zutrifft, ist keins. Er hängt deshalb an
   * derselben Bedingung wie die Sperre selbst — und bleibt während der Prüfung
   * ebenso weg, statt für einen Wimpernschlag aufzublitzen.
   */
  const hint = locked;

  const pickTheme = (theme: ThemeId) => onChange({ ...appearance, theme });
  const pickNight = (night: ThemeId) => onChange({ ...appearance, night });
  const pickBoard = (boardSet: BoardSetId) => onChange({ ...appearance, boardSet });
  const pickPieces = (pieceSet: PieceSetId) => onChange({ ...appearance, pieceSet });
  const pickDiagram = (diagram: boolean) => onChange({ ...appearance, diagram });

  /** Kachel eines Themas · gesperrte führen zur Plus-Erklärung. */
  const themeTile = (id: ThemeId, selected: boolean, onPick: (id: ThemeId) => void) => {
    const def = THEMES.find((theme) => theme.id === id)!;
    const blocked = def.plus && locked;
    return (
      <button
        key={id}
        // Die Kachel steht in ihrem eigenen Thema · alles darin färbt sich
        // daraus, ohne dass hier eine Farbe stünde.
        data-theme={id}
        onClick={() => (blocked ? openPlusDialog(THEME_FEATURE) : onPick(id))}
        aria-pressed={selected}
        title={t(def.descKey)}
        // Die Fläche gehört zur Vorschau: Ohne eigenen Grund stünde die
        // Beschriftung eines hellen Themas in dunkler Schrift auf dunklem Panel.
        className={`flex flex-col gap-2 rounded-xl border bg-panel p-2.5 text-start transition-colors ${
          selected ? "border-accent-dim ring-1 ring-accent-dim" : "border-line hover:border-line2"
        } ${blocked ? "opacity-70" : ""}`}
      >
        <ThemePreview />
        <span className="flex items-center gap-1.5 px-0.5">
          <span className="flex-1 truncate text-[12.5px] font-medium text-ink">{t(def.nameKey)}</span>
          {def.plus && hint && <Sparkles size={12} className="shrink-0 text-accent" />}
        </span>
      </button>
    );
  };

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.appearanceNote")}</p>

      <div className="mt-3.5">
        <LayoutModeRow on={appearance.diagram} onToggle={pickDiagram} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
        {THEMES.map((theme) => themeTile(theme.id, appearance.theme === theme.id, pickTheme))}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        {t(THEMES.find((theme) => theme.id === appearance.theme)!.descKey)}
      </p>

      {/* ── Automatischer Wechsel ─────────────────────────────────────────── */}
      <h4 className="mt-5 text-[13px] font-medium text-ink">{t("set.themeAuto")}</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.themeAutoNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {(["off", "system", "time"] as const).map((mode) => {
          // „Aus" ist die Vorgabe und bleibt frei · der Wechsel selbst gehört
          // zu Plus und trägt deshalb denselben Stern und dasselbe Blass wie
          // die Bretter und Figuren weiter unten.
          const plus = mode !== "off";
          const blocked = plus && locked;
          return (
            <Chip
              key={mode}
              active={appearance.auto === mode}
              className={blocked ? "opacity-70" : ""}
              onClick={() =>
                blocked ? openPlusDialog(THEME_FEATURE) : onChange({ ...appearance, auto: mode })
              }
            >
              <span className="flex items-center gap-1.5">
                {t(
                  mode === "off"
                    ? "set.themeAutoOff"
                    : mode === "system"
                      ? "set.themeAutoSystem"
                      : "set.themeAutoTime"
                )}
                {plus && hint && <Sparkles size={12} className="text-accent" />}
              </span>
            </Chip>
          );
        })}
      </div>

      {/* Die Grenzen der Nacht stehen vor der Nachtseite und nicht hinter den
          Kacheln: Erst sagt man, wann die Nacht ist, dann, wie sie aussieht ·
          und hinter acht Kacheln übersieht man die zwei Uhrzeiten ohnehin.
          Beides zusammen ist ein Satz, und die Zeitspanne ist sein Anfang. */}
      {appearance.auto === "time" && (
        <div className="mt-3 grid grid-cols-2 gap-3 min-[640px]:max-w-sm">
          <Field label={t("set.themeNightFrom")}>
            <input
              type="time"
              value={appearance.nightFrom}
              onChange={(e) => onChange({ ...appearance, nightFrom: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label={t("set.themeNightTo")}>
            <input
              type="time"
              value={appearance.nightTo}
              onChange={(e) => onChange({ ...appearance, nightTo: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {appearance.auto !== "off" && (
        <>
          <p className="mt-3 text-[12px] text-ink3">{t("set.themeNight")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
            {THEMES.map((theme) => themeTile(theme.id, appearance.night === theme.id, pickNight))}
          </div>
        </>
      )}
      {/* ── Brett ─────────────────────────────────────────────────────────── */}
      <h4 className="mt-5 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Palette size={14} className="text-ink3" /> {t("set.boardSet")}
      </h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.boardSetNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {BOARD_SETS.map((set) => {
          // "auto" ist die Vorgabe und damit das Brett, mit dem jeder ohnehin
          // spielt · es gehört nicht hinter die Freischaltung. Zu Plus
          // gehören allein die eigenen Bretter daneben.
          const plus = set.id !== DEFAULT_BOARD_SET;
          const blocked = plus && locked;
          return (
            <button
              key={set.id}
              // "auto" zeigt das Brett des gewählten Themas, die übrigen ihr
              // eigenes · derselbe Weg wie bei den Themenkacheln.
              data-theme={plus ? undefined : appearance.theme}
              data-board={plus ? set.id : undefined}
              onClick={() => (blocked ? openPlusDialog(THEME_FEATURE) : pickBoard(set.id))}
              aria-pressed={appearance.boardSet === set.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors ${
                appearance.boardSet === set.id
                  ? "border-accent-dim bg-accent-soft text-accent"
                  : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
              } ${blocked ? "opacity-70" : ""}`}
            >
              <BoardPreview />
              {t(set.nameKey)}
              {plus && hint && <Sparkles size={12} className="text-accent" />}
            </button>
          );
        })}
      </div>

      {/* ── Figuren ───────────────────────────────────────────────────────── */}
      <h4 className="mt-5 flex items-center gap-2 text-[13px] font-medium text-ink">
        <Crown size={14} className="text-ink3" /> {t("set.pieceSet")}
      </h4>
      <p className="mt-1 text-[12px] leading-relaxed text-ink3">{t("set.pieceSetNote")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {PIECE_SETS.map((set) => {
          const blocked = set.plus && locked;
          const selected = appearance.pieceSet === set.id;
          return (
            <button
              key={set.id}
              onClick={() => (blocked ? openPlusDialog(THEME_FEATURE) : pickPieces(set.id))}
              aria-pressed={selected}
              title={t(set.descKey)}
              className={`flex items-center gap-2 rounded-lg border p-1.5 pe-2.5 text-[12.5px] transition-colors ${
                selected
                  ? "border-accent-dim bg-accent-soft text-accent"
                  : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
              } ${blocked ? "opacity-70" : ""}`}
            >
              <PiecePreview set={set.id} />
              {t(set.nameKey)}
              {set.plus && hint && <Sparkles size={12} className="text-accent" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink3">
        {t(pieceSetDef(appearance.pieceSet).descKey)}
      </p>

    </>
  );
}
