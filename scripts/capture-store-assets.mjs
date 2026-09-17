/**
 * Reproducible in-app captures for the Play Store assets.
 *
 * Drives the Vite preview in headless Chrome over the DevTools protocol and
 * writes one PNG per locale, device and screen into `artifacts/store-assets/`.
 * The marketing layer is added afterwards by compose-store-assets-v3.py.
 *
 * The app is put into capture mode through the query flags it already knows
 * (`store-capture` hides browser-preview labels, `mobile-preview` forces the
 * phone shell) and the interface language is seeded into localStorage before
 * the app boots, so no click has to find a localized label.
 *
 *   node scripts/capture-store-assets.mjs --locales fr-FR,es-ES,hi-IN,ar,zh-CN
 *   node scripts/capture-store-assets.mjs --locales all
 *   node scripts/capture-store-assets.mjs --site
 *
 * `--site` takes the four desktop screenshots for kiebitz.dev instead
 * (English, 1920 × 1009 like the Tauri window) and writes them into
 * `artifacts/site-shots/`, ready to copy to `kiebitz-site/assets/shots/`.
 *
 * Requires Chrome or Edge; both ship a `--headless` mode that speaks CDP.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5173;
const DEBUG_PORT = 9223;

/** Play Console locale → the app's own language code. */
const LOCALES = {
  "de-DE": "de",
  "en-US": "en",
  "es-ES": "es",
  "fr-FR": "fr",
  "hi-IN": "hi",
  ar: "ar",
  "zh-CN": "zh",
};

const DEVICES = {
  phone: { width: 1080, height: 1920, scale: 2, mobile: true },
  "tablet-7": { width: 1080, height: 1920, scale: 2, mobile: true },
  "tablet-10": { width: 1920, height: 1080, scale: 1, mobile: false },
  chromebook: { width: 1920, height: 1080, scale: 1, mobile: false },
};

/**
 * One recipe per screen. `page` is the app page (see lib/nav.ts), `tab` the
 * index in the section bar of a page that has one, `scroll` the offset of the
 * scroll container in CSS pixels.
 */
const SCREENS = [
  { name: "01-dashboard", page: "dashboard", scroll: 0 },
  { name: "02-analysis", page: "analysis", scroll: 0 },
  { name: "03-insights", page: "insights", tab: 1, scroll: 0 },
  { name: "04-study", page: "study", scroll: 0 },
  { name: "05-repertoire", page: "repertoire", scroll: 0, phoneOnly: true },
  { name: "06-puzzles", page: "puzzles", scroll: 0, phoneOnly: true },
];

/** The feature screenshots on kiebitz.dev · file names as the site uses them. */
const SITE_DEVICE = { width: 1920, height: 1009, scale: 1, mobile: false };
const SITE_SCREENS = [
  { name: "insights", page: "insights", tab: 1, scroll: 0 },
  { name: "repertoire", page: "repertoire", scroll: 0 },
  { name: "puzzles", page: "puzzles", scroll: 0 },
  { name: "study", page: "study", scroll: 0 },
];

function findBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("Neither Chrome nor Edge found · install one to capture.");
  return found;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await sleep(300);
  }
}

/** Minimal CDP client · one WebSocket, promises keyed by message id. */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Session(socket);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

const CLICK_TAB = (index) => `
  (() => {
    const bar = document.querySelector("main nav");
    const target = bar && bar.querySelectorAll("button")[${index}];
    if (!target) return "no tab ${index}";
    target.click();
    return "ok";
  })()`;

const SCROLL = (offset) => `
  (() => {
    const main = document.querySelector("main") || document.scrollingElement;
    main.scrollTop = ${offset};
    window.scrollTo(0, ${offset});
    return main.scrollTop;
  })()`;

/**
 * Waits until the layout has settled: lazy pages loaded (no spinner left),
 * fonts loaded, no pending animation. A fixed sleep was not enough · on the
 * phone the first screens were captured while their chunk still loaded.
 */
const SETTLED = `
  (async () => {
    const deadline = Date.now() + 15000;
    while (document.querySelector('[aria-busy=true], main .animate-spin') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`;

async function captureScreen(browserUrl, language, metrics, screen, file) {
  const session = await Session.open(browserUrl);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: Math.round(metrics.width / metrics.scale),
    height: Math.round(metrics.height / metrics.scale),
    deviceScaleFactor: metrics.scale,
    mobile: metrics.mobile,
  });
  // Seed the language before the bundle runs · the LocaleProvider reads
  // exactly this key on its first render.
  await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem("kiebitz.locale", ${JSON.stringify(language)}); } catch {}`,
  });

  const flags = [
    "store-capture",
    metrics.mobile ? "mobile-preview" : "",
    `page=${screen.page}`,
  ].filter(Boolean);
  await session.send("Page.navigate", {
    url: `http://127.0.0.1:${PORT}/?${flags.join("&")}`,
  });
  await sleep(1800);
  await session.evaluate(SETTLED);

  if (screen.tab != null) {
    await session.evaluate(CLICK_TAB(screen.tab));
    await sleep(400);
  }
  await session.evaluate(SCROLL(screen.scroll ?? 0));
  // Charts load as their own chunk without a spinner and then animate
  // their lines in · give both time, or the rating chart stays empty.
  await sleep(2500);
  await session.evaluate(SETTLED);

  const shot = await session.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  session.close();
}

async function captureLocale(browserUrl, locale, outRoot) {
  const language = LOCALES[locale];
  for (const [device, metrics] of Object.entries(DEVICES)) {
    const targetDir = join(outRoot, locale, device);
    mkdirSync(targetDir, { recursive: true });
    const screens = SCREENS.filter((screen) => device === "phone" || !screen.phoneOnly);

    for (const screen of screens) {
      await captureScreen(browserUrl, language, metrics, screen, join(targetDir, `${screen.name}.png`));
      process.stdout.write(`  ${locale}/${device}/${screen.name}\n`);
    }
  }
}

async function captureSite(browserUrl, outRoot) {
  mkdirSync(outRoot, { recursive: true });
  for (const screen of SITE_SCREENS) {
    await captureScreen(browserUrl, "en", SITE_DEVICE, screen, join(outRoot, `${screen.name}.png`));
    process.stdout.write(`  site/${screen.name}\n`);
  }
}

async function warmUp(browserUrl) {
  const session = await Session.open(browserUrl);
  const { targetId } = await session.send("Target.createTarget", { url: "about:blank" });
  const targets = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = await Session.open(targets.find((t) => t.id === targetId).webSocketDebuggerUrl);
  for (const name of ["dashboard", "analysis", "insights", "study", "repertoire", "puzzles"]) {
    await page.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?store-capture&page=${name}` });
    await sleep(2500);
  }
  page.close();
  await session.send("Target.closeTarget", { targetId });
  session.close();
}

async function main() {
  const args = process.argv.slice(2);
  const site = args.includes("--site");
  const localeArg = args.includes("--locales") ? args[args.indexOf("--locales") + 1] : "all";
  const outRoot = join(ROOT, "artifacts", site ? "site-shots" : "store-assets");
  const locales = site
    ? ["en-US"]
    : localeArg === "all" ? Object.keys(LOCALES) : localeArg.split(",").map((s) => s.trim());
  for (const locale of locales) {
    if (!(locale in LOCALES)) throw new Error(`unknown locale ${locale}`);
  }

  // Vite directly, not through npm · on Windows only the direct child can be
  // killed again, an npm wrapper would leave the server behind on port 5173.
  const vite = spawn(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const profile = join(tmpdir(), `kiebitz-capture-${process.pid}`);
  const browser = spawn(
    findBrowser(),
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--disable-extensions",
      "--force-color-profile=srgb",
      "--allow-insecure-localhost",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    // Vite answers HTML, not JSON · a plain fetch check is enough.
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/`);
        if (response.ok) break;
      } catch {
        /* keep waiting */
      }
      if (Date.now() > deadline) throw new Error("vite did not start");
      await sleep(300);
    }
    const version = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const browserUrl = version.webSocketDebuggerUrl;

    // Warm-up · Vite compiles lazy chunks (the rating chart) on first request,
    // and the first shot of a run would otherwise miss them.
    await warmUp(browserUrl);

    for (const locale of locales) {
      process.stdout.write(`${locale}\n`);
      const session = await Session.open(browserUrl);
      const { targetId } = await session.send("Target.createTarget", { url: "about:blank" });
      session.close();
      const targets = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = targets.find((t) => t.id === targetId);
      if (site) await captureSite(page.webSocketDebuggerUrl, outRoot);
      else await captureLocale(page.webSocketDebuggerUrl, locale, outRoot);
      const closer = await Session.open(browserUrl);
      await closer.send("Target.closeTarget", { targetId });
      closer.close();
    }
  } finally {
    browser.kill();
    vite.kill();
    // The browser needs a moment to let go of its profile directory; a leftover
    // temp folder is not worth failing a finished capture run over.
    await sleep(1500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Windows still had a handle on it */
    }
  }
  process.stdout.write(`captures written to ${outRoot}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
