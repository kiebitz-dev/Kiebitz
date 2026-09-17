/**
 * Zustand von Konto und Kiebitz Plus.
 *
 * Ein Modul-Singleton, kein React-State: Die Freischaltung wird an vielen
 * Stellen abgefragt, und jede neu geöffnete Seite soll nicht erneut bei
 * „lädt" beginnen. Komponenten hängen sich über `usePlus()` daran.
 *
 * Grundregeln:
 *   * Freigeschaltet ist nur, was in einem gültig signierten Token steht.
 *   * Fällt die API aus, bleibt der zwischengespeicherte Token gültig, bis er
 *     abläuft; danach gilt wieder Free. Ein Providerausfall darf Free nie
 *     blockieren.
 *   * Es werden keine Schachdaten übertragen · nur Anmeldung, Abrechnung und
 *     Freischaltung.
 */
import {
  PlusApiError,
  consumeAuthorizationCode,
  createCheckout,
  createPortalSession,
  deleteAccount,
  fetchAccount,
  fetchEntitlement,
  fetchJwks,
  logoutSession,
  requestMagicLink,
  verifyGooglePlayPurchase,
} from "./api";
import { acknowledgePurchase, playPurchaseTokens, purchasePlus } from "./billing";
import type { Locale } from "../i18n";
import { deleteSecret, readSecret, writeSecret } from "./storage";
import { isStoreCapture } from "../storeCapture";
import { claimsStillValid, verifyEntitlementToken } from "./token";
import {
  ALL_FEATURES,
  isPlusOnlyFeature,
  type CachedEntitlement,
  type CachedEntitlementKeys,
  type CheckoutSession,
  type EntitlementClaims,
  type EntitlementResponse,
  type JsonWebKeySet,
  type PlusAccount,
  type PlusFeature,
} from "./types";

/** Sperrzeit, bevor ein neuer Magic-Link angefordert werden darf. */
export const RESEND_LOCKOUT_SECONDS = 60;

/**
 * Nachlauf nach der Rückkehr aus dem Checkout. Der Stripe-Webhook trifft
 * asynchron ein; ohne diese kurzen Wiederholungen stünde direkt nach dem Kauf
 * noch „Free" da.
 */
const RETURN_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 40_000];

export interface PlusState {
  /** Der erste Blick in die sichere Ablage läuft noch. */
  loading: boolean;
  signedIn: boolean;
  account: PlusAccount | null;
  /** Geprüfte Claims des zwischengespeicherten Tokens. */
  claims: EntitlementClaims | null;
  /** Läuft gerade eine Aktualisierung? */
  refreshing: boolean;
  /** Letzter Fehler einer Aktualisierung · blockiert nichts. */
  error: PlusApiError | null;
  /** Zeitpunkt der letzten erfolgreichen Entitlement-Abfrage (ms). */
  fetchedAt: number | null;
  /** Frühester Zeitpunkt für den nächsten Magic-Link (ms). */
  resendAllowedAt: number;
}

const initialState: PlusState = {
  loading: true,
  signedIn: false,
  account: null,
  claims: null,
  refreshing: false,
  error: null,
  fetchedAt: null,
  resendAllowedAt: 0,
};

let state: PlusState = initialState;
const listeners = new Set<(next: PlusState) => void>();
let sessionToken: string | null = null;
let bootstrap: Promise<void> | null = null;
let returnTimers: ReturnType<typeof setTimeout>[] = [];

function setState(patch: Partial<PlusState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function plusState(): PlusState {
  return state;
}

export function subscribePlus(listener: (next: PlusState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function cancelReturnPolling(): void {
  returnTimers.forEach((timer) => clearTimeout(timer));
  returnTimers = [];
}

async function clearSession(): Promise<void> {
  cancelReturnPolling();
  sessionToken = null;
  await Promise.all([
    deleteSecret("session"),
    deleteSecret("entitlement"),
    deleteSecret("entitlement_keys"),
  ]);
  setState({ signedIn: false, account: null, claims: null, error: null, fetchedAt: null });
}

/** Einen Eintrag der Ablage als JSON lesen · Unsinn darin zählt als nichts. */
async function readCached<T>(key: "entitlement" | "entitlement_keys"): Promise<T | null> {
  const raw = await readSecret(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    await deleteSecret(key);
    return null;
  }
}

/** Beide Einträge zusammen · die Ablage löschen heißt: beide löschen. */
async function dropCachedEntitlement(): Promise<void> {
  await Promise.all([deleteSecret("entitlement"), deleteSecret("entitlement_keys")]);
}

/**
 * Den zwischengespeicherten Token prüfen · offline der einzige Weg zu Plus.
 *
 * Token und Prüfschlüssel stehen seit der Aufteilung in zwei Einträgen (siehe
 * `CachedEntitlementKeys`). Ein Zwischenspeicher aus einer älteren Fassung
 * trägt beides noch in einem · der gilt hier weiter und wird gleich in die
 * neue Form übernommen, damit niemand nach dem Update ohne Netz auf Free fällt.
 */
async function restoreCachedEntitlement(now: number): Promise<EntitlementClaims | null> {
  const [cached, stored] = await Promise.all([
    readCached<CachedEntitlement>("entitlement"),
    readCached<CachedEntitlementKeys>("entitlement_keys"),
  ]);
  if (!cached?.token) return null;

  const legacy = stored === null && Boolean(cached.jwks?.keys?.length);
  const keys: CachedEntitlementKeys | null = legacy
    ? { jwks: cached.jwks!, account: cached.account }
    : stored;
  if (!keys?.jwks?.keys?.length) return null;

  let claims: EntitlementClaims;
  try {
    claims = await verifyEntitlementToken(cached.token, keys.jwks, now);
  } catch {
    // Abgelaufen oder nicht mehr prüfbar: still auf Free zurück. Der nächste
    // erfolgreiche Netzaufruf stellt Plus wieder her.
    await dropCachedEntitlement();
    return null;
  }

  // Das Konto gehört zum geprüften Token und kommt deshalb mit heraus: So
  // steht die Adresse schon beim ersten Bild da · auch ohne Netz.
  setState({ fetchedAt: cached.fetched_at ?? null, account: keys.account ?? null });
  // Die Übernahme darf den Start nicht aufhalten und ihn erst recht nicht
  // scheitern lassen · gelingt sie nicht, gilt beim nächsten Mal wieder die
  // alte Form, und die funktioniert ja.
  if (legacy) void writeCachedEntitlement(cached, keys).catch(() => {});
  return claims;
}

/** Beide Teile ablegen · erst die Schlüssel, dann der Token, der sie braucht. */
async function writeCachedEntitlement(
  cached: CachedEntitlement,
  keys: CachedEntitlementKeys
): Promise<void> {
  await writeSecret("entitlement_keys", JSON.stringify(keys));
  await writeSecret(
    "entitlement",
    JSON.stringify({
      token: cached.token,
      fetched_at: cached.fetched_at,
      refresh_after: cached.refresh_after,
    } satisfies CachedEntitlement)
  );
}

/**
 * Einmalige Initialisierung: Sitzung und Token aus der sicheren Ablage holen,
 * danach im Hintergrund aktualisieren, wenn das nötig ist.
 */
export function initPlus(): Promise<void> {
  if (bootstrap) return bootstrap;
  if (import.meta.env.DEV && typeof window !== "undefined" && isStoreCapture()) {
    bootstrap = Promise.resolve().then(() => setState({ loading: false, claims: captureClaims() }));
    return bootstrap;
  }
  bootstrap = (async () => {
    const now = Date.now();
    const [session, claims] = await Promise.all([
      readSecret("session"),
      restoreCachedEntitlement(now),
    ]);
    sessionToken = session;
    setState({ loading: false, signedIn: Boolean(session), claims });
    if (session) void refreshEntitlement().catch(() => {});
  })();
  return bootstrap;
}

/**
 * Die Store-Screenshots zeigen Kiebitz mit Plus · ohne Konto und ohne Netz.
 * Nur im Dev-Server mit `?store-capture` erreichbar; ein Release-Build hat
 * den Zweig gar nicht (`import.meta.env.DEV` ist dort konstant `false`).
 */
function captureClaims(): EntitlementClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "store-capture",
    sub: "store-capture",
    aud: "kiebitz",
    plan: "plus",
    features: [...ALL_FEATURES],
    provider: null,
    providers: [],
    status: "active",
    trial: false,
    trial_until: null,
    entitlement_valid_until: null,
    iat: now,
    exp: now + 86_400,
  };
}

/** Steht eine Aktualisierung an? `refresh_after` der letzten Antwort zählt. */
async function refreshDue(now: number): Promise<boolean> {
  const raw = await readSecret("entitlement");
  if (!raw) return true;
  try {
    const cached = JSON.parse(raw) as CachedEntitlement;
    if (!cached.refresh_after) return true;
    return Date.parse(cached.refresh_after) <= now;
  } catch {
    return true;
  }
}

/**
 * Fremde Fehler auf den einen Fehlertyp der Oberfläche abbilden.
 *
 * `status: 0` heißt „es gab keine HTTP-Antwort" und stimmt für all diese Fälle;
 * unterschieden werden sie am Code, denn nur `network_unavailable` bedeutet
 * wirklich „kein Netz" (siehe `PlusApiError.offline`).
 */
function asPlusError(error: unknown, code: string): PlusApiError {
  return error instanceof PlusApiError ? error : new PlusApiError(0, code, String(error));
}

/**
 * Entitlement neu holen, prüfen und ablegen.
 *
 * Der Aufruf schlägt bewusst nicht durch: Die Oberfläche zeigt den Fehler an,
 * arbeitet aber mit dem zuletzt gültigen Stand weiter.
 */
export async function refreshEntitlement(options: { force?: boolean } = {}): Promise<void> {
  if (!sessionToken) return;
  const now = Date.now();
  // Fehlt das Konto, ist die Abfrage immer fällig · `refresh_after` gilt für
  // die Freischaltung, und die kann gültig sein, während niemand weiß, wer
  // angemeldet ist. Genau das war der Zwischenspeicher einer älteren Fassung,
  // in dem das Konto noch nicht mitstand.
  if (!options.force && state.account && !(await refreshDue(now))) return;
  if (state.refreshing) return;
  setState({ refreshing: true });
  const token = sessionToken;

  let account: PlusAccount;
  let entitlement: EntitlementResponse;
  let jwks: JsonWebKeySet;
  try {
    [account, entitlement, jwks] = await Promise.all([
      fetchAccount(token),
      fetchEntitlement(token),
      fetchJwks(),
    ]);
  } catch (error) {
    // Eine ungültige Sitzung ist der einzige Fehler, der den lokalen Zustand
    // ändert · alles andere lässt den zwischengespeicherten Token stehen.
    if (error instanceof PlusApiError && (error.status === 401 || error.status === 403)) {
      await clearSession();
      setState({ refreshing: false, error });
      return;
    }
    setState({ refreshing: false, error: asPlusError(error, "refresh_failed") });
    return;
  }

  let claims: EntitlementClaims;
  try {
    claims = await verifyEntitlementToken(entitlement.entitlement_token, jwks, Date.now(), account.id);
  } catch (error) {
    // Eine unsignierte oder fremde Antwort schaltet nichts frei · und sie ist
    // ausdrücklich kein Netzfehler, auch wenn beide hier zusammenliefen.
    setState({ refreshing: false, error: asPlusError(error, "verify_failed") });
    return;
  }

  // Ab hier steht ein geprüfter Stand fest, und ab hier gilt er auch.
  //
  // Das Ablegen kommt danach und nicht davor: Es ist die Vorsorge für den
  // nächsten Start, nicht die Bedingung für diesen. Vorher stand das Schreiben
  // im selben `try` wie die Abfrage — nahm der Schlüsselspeicher den Wert nicht
  // an, verfiel damit auch das eben Geprüfte, und Plus blieb auf dem Gerät aus,
  // obwohl Konto und Berechtigung in Ordnung waren.
  const cached: CachedEntitlement = {
    token: entitlement.entitlement_token,
    fetched_at: Date.now(),
    refresh_after: entitlement.refresh_after,
  };
  setState({
    account,
    claims,
    error: null,
    refreshing: false,
    signedIn: true,
    fetchedAt: cached.fetched_at,
  });

  try {
    await writeCachedEntitlement(cached, { jwks, account });
  } catch (error) {
    // Der Stand von eben bleibt stehen; gemeldet wird nur, dass er den
    // nächsten Start nicht überlebt.
    setState({ error: asPlusError(error, "cache_unavailable") });
  }
}

/**
 * Magic-Link anfordern; erst nach der Sperrzeit wieder möglich.
 *
 * `locale` reicht die Oberfläche durch · der Store kennt die Spracheinstellung
 * nicht und soll sie auch nicht erraten.
 */
export async function requestSignInLink(email: string, locale: Locale): Promise<void> {
  const now = Date.now();
  if (now < state.resendAllowedAt) {
    throw new PlusApiError(429, "rate_limited", "resend locked");
  }
  await requestMagicLink(email.trim(), locale);
  setState({ resendAllowedAt: now + RESEND_LOCKOUT_SECONDS * 1000, error: null });
}

/** Einmalcode aus `kiebitz://auth?code=…` einlösen. */
export async function signInWithCode(code: string): Promise<void> {
  const session = await consumeAuthorizationCode(code);
  sessionToken = session.access_token;
  await writeSecret("session", session.access_token);
  setState({ signedIn: true, error: null, resendAllowedAt: 0 });
  await refreshEntitlement({ force: true });
}

export async function signOut(): Promise<void> {
  const token = sessionToken;
  // Erst lokal abmelden: Ob der Server die Sitzung noch widerrufen kann, darf
  // nicht darüber entscheiden, ob das Gerät abgemeldet ist.
  await clearSession();
  if (token) await logoutSession(token).catch(() => {});
}

/** Konto löschen. Wirft bei laufendem Abo mit `409 active_subscription`. */
export async function deletePlusAccount(): Promise<void> {
  if (!sessionToken) return;
  await deleteAccount(sessionToken);
  await clearSession();
}

export function startCheckout(locale: Locale): Promise<CheckoutSession> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  return createCheckout(sessionToken, locale);
}

/**
 * Kiebitz Plus über Google Play kaufen.
 *
 * Die Reihenfolge ist die ganze Sicherheit dieser Funktion: kaufen, von der
 * API gegen Google prüfen lassen, erst dann gegenüber Google bestätigen. Wer
 * zuerst bestätigt und danach prüft, verschenkt die einzige Rückholung, die
 * Google vorsieht · ein unbestätigter Kauf wird nach drei Tagen erstattet.
 */
export async function purchaseWithGooglePlay(): Promise<"purchased" | "pending" | "cancelled"> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  const accountId = state.account?.id ?? "";
  const outcome = await purchasePlus(accountId);
  if (outcome.state === "cancelled" || !outcome.purchase_token) return "cancelled";

  await verifyGooglePlayPurchase(sessionToken, outcome.purchase_token);
  if (outcome.state === "purchased") {
    // Scheitert nur die Bestätigung, ist Plus trotzdem zugeordnet · das
    // Wiederherstellen holt sie beim nächsten Mal nach.
    await acknowledgePurchase(outcome.purchase_token).catch(() => {});
  }
  await refreshEntitlement({ force: true });
  return outcome.state;
}

/**
 * Vorhandene Play-Käufe erneut zuordnen.
 *
 * Nach einem Gerätewechsel, einer Neuinstallation oder einer abgebrochenen
 * Zuordnung kennt Google den Kauf weiterhin. Gibt die Zahl der Käufe zurück,
 * die die API angenommen hat.
 *
 * Ein einzelnes Token, das die API zurückweist, bricht den Vorgang nicht ab:
 * In einem Play-Konto können Abos anderer Apps oder abgelaufene Käufe liegen,
 * und deretwegen soll ein gültiger Kauf daneben nicht liegen bleiben.
 */
export async function restoreGooglePlayPurchases(): Promise<number> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  const tokens = await playPurchaseTokens();
  let restored = 0;
  for (const purchaseToken of tokens) {
    try {
      await verifyGooglePlayPurchase(sessionToken, purchaseToken);
      await acknowledgePurchase(purchaseToken).catch(() => {});
      restored += 1;
    } catch {
      // Nicht unser Produkt oder nicht mehr gültig · der nächste Kauf zählt.
    }
  }
  if (restored > 0) await refreshEntitlement({ force: true });
  return restored;
}

export function startPortal(): Promise<{ portal_url: string }> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  return createPortalSession(sessionToken);
}

/**
 * Nach der Rückkehr aus Checkout oder Portal mehrfach mit wachsendem Abstand
 * nachfragen. Sobald Plus aktiv ist, hört das Nachfragen auf.
 */
export function pollAfterReturn(): void {
  if (!sessionToken) return;
  cancelReturnPolling();
  returnTimers = RETURN_BACKOFF_MS.map((delay) =>
    setTimeout(() => {
      if (state.claims?.plan === "plus") {
        cancelReturnPolling();
        return;
      }
      void refreshEntitlement({ force: true }).catch(() => {});
    }, delay)
  );
}

/** Prüft eine Feature-ID gegen den geprüften Token. */
export function featureUnlocked(feature: PlusFeature, current: PlusState = state): boolean {
  if (!isPlusOnlyFeature(feature)) return true;
  const claims = current.claims;
  if (!claims || claims.plan !== "plus") return false;
  if (!claimsStillValid(claims)) return false;
  return claims.features.includes(feature);
}

/**
 * Nur für Tests · setzt einen Zustand ein, ohne über das Netz zu gehen.
 *
 * Die Oberflächentests prüfen die Funktionen selbst, nicht das Gate davor;
 * sie brauchen deshalb einen Weg, eine geprüfte Berechtigung zu setzen.
 */
export function setPlusStateForTests(patch: Partial<PlusState>): void {
  setState(patch);
}

/** Nur für Tests · setzt das Singleton in den Ausgangszustand zurück. */
export function resetPlusStore(): void {
  cancelReturnPolling();
  state = initialState;
  sessionToken = null;
  bootstrap = null;
  listeners.clear();
}
