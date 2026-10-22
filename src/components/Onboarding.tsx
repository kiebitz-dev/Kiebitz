import { useState } from "react";
import { Check, Download, Loader2, SkipForward } from "lucide-react";
import { LOCALES, LOCALE_NAMES, useI18n, type Locale } from "../lib/i18n";
import { setSettings, type Settings } from "../lib/settings";
import { runAutoImport } from "../lib/autoImport";
import { Button, Card, Chip } from "./ui";
import BrandMark from "./BrandMark";

/**
 * Ersteinrichtung beim allerersten Start: Sprache, dann (optional) die
 * Online-Konten. Ohne Konto bleibt Kiebitz voll nutzbar · Partien lassen sich
 * später per PGN importieren.
 *
 * Erklärt wird hier nichts mehr, außer in einem Satz, wozu die Kontoabfrage
 * überhaupt da ist: Was Kiebitz kann, zeigt der geführte Rundgang danach in
 * der App selbst, an den Stellen, an denen es steht. Fünf Folien vor dem
 * ersten Blick auf die Oberfläche hatten das Problem, dass sie Namen für Dinge
 * einführten, die man noch nie gesehen hatte.
 */
export default function Onboarding({
  settings,
  onDone,
}: {
  settings: Settings;
  /** Ersteinrichtung fertig · die App startet danach den Rundgang. */
  onDone: (applied: Settings) => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const [step, setStep] = useState<0 | 1>(0);
  const [ccUser, setCcUser] = useState(settings.cc_user);
  const [liUser, setLiUser] = useState(settings.li_user);
  const [displayName, setDisplayName] = useState(settings.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseLocale = (next: Locale) => {
    setLocale(next);
    setSettings({ ...settings, locale: next }).catch(() => {});
  };

  /** Speichert die Angaben und startet · je nach Konto · den ersten Import. */
  const finish = async (withImport: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const applied = await setSettings({
        ...settings,
        locale,
        cc_user: ccUser.trim(),
        li_user: liUser.trim(),
        display_name: displayName.trim(),
        onboarded: true,
      });
      onDone(applied);
      if (withImport) runAutoImport(true).catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const hasAccount = ccUser.trim() !== "" || liUser.trim() !== "";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-[560px] items-center px-4 py-8">
        <div className="w-full">
          <div className="mb-5 flex items-center gap-3">
            <BrandMark
              icon={24}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"
            />
            <div>
              <div className="text-[19px] font-semibold tracking-tight">{t("onb.welcome")}</div>
              <div className="text-[12.5px] text-ink3">{t("onb.subtitle")}</div>
            </div>
          </div>

          {step === 0 ? (
            <Card title={t("onb.languageTitle")}>
              {/* Jede Sprache in sich selbst · beim allerersten Start ist die
                  Oberfläche noch auf Englisch, und "English/Deutsch/العربية"
                  ist für jeden lesbar, "Arabic" nicht. */}
              <div className="flex flex-wrap gap-2">
                {LOCALES.map((l) => (
                  <Chip key={l} active={locale === l} onClick={() => chooseLocale(l)}>
                    <span lang={l}>{LOCALE_NAMES[l]}</span>
                  </Chip>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink3">{t("onb.languageNote")}</p>
              <div className="mt-4 flex justify-end">
                <Button primary onClick={() => setStep(1)}>
                  {t("common.next")}
                </Button>
              </div>
            </Card>
          ) : (
            <Card title={t("onb.accountsTitle")}>
              {/* Der eine Satz, der vor der Frage nach dem Benutzernamen fehlen
                  würde: wozu Kiebitz ihn überhaupt haben will. */}
              <p className="text-[12.5px] leading-relaxed text-ink2">{t("onb.what")}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink3">{t("onb.accountsNote")}</p>
              <div className="mt-4 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-ink3">{t("set.ccUser")}</span>
                  <input
                    value={ccUser}
                    onChange={(e) => setCcUser(e.target.value)}
                    placeholder={t("onb.optional")}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-ink3">{t("set.liUser")}</span>
                  <input
                    value={liUser}
                    onChange={(e) => setLiUser(e.target.value)}
                    placeholder={t("onb.optional")}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-ink3">{t("set.displayName")}</span>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={ccUser || liUser || t("onb.optional")}
                    className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-line bg-panel2 px-3 py-2.5 text-[12px] leading-relaxed text-ink3">
                {hasAccount ? t("onb.willImport") : t("onb.noAccountNote")}
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12px] text-loss">
                  {error}
                </div>
              )}

              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <Button onClick={() => setStep(0)} disabled={busy}>
                  {t("onb.back")}
                </Button>
                <div className="flex gap-2">
                  <Button onClick={() => void finish(false)} disabled={busy}>
                    <SkipForward size={14} /> {t("onb.skip")}
                  </Button>
                  <Button primary onClick={() => void finish(hasAccount)} disabled={busy}>
                    {busy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : hasAccount ? (
                      <Download size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                    {hasAccount ? t("onb.startImport") : t("onb.start")}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
