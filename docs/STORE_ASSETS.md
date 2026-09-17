# Kiebitz Store Assets

Kiebitz keeps the in-app captures and their marketing presentation separate:

- `artifacts/store-assets/` contains the reproducible source captures.
- `artifacts/store-assets-v3/` contains the current branded Google Play assets.

Seven locales ship: `de-DE`, `en-US`, `es-ES`, `fr-FR`, `hi-IN`, `ar` and
`zh-CN`. The listing texts for them live in
[store-listing/](store-listing/README.md).

## 1. Capture

```sh
node scripts/capture-store-assets.mjs --locales fr-FR,es-ES,hi-IN,ar,zh-CN
```

Starts Vite, drives headless Chrome (or Edge) over the DevTools protocol and
writes one PNG per locale, device and screen into `artifacts/store-assets/`.
The app is put into capture mode with the query flags it already knows:
`store-capture` hides the browser-preview labels, `mobile-preview` forces the
phone shell, and `page=` picks the screen so the script never has to click a
localized label. The interface language is seeded into `localStorage` before the
bundle boots. `--locales all` recaptures every locale, which overwrites the
hand-checked German and English captures — pass the list explicitly unless that
is what you want.

Capture mode also shows Kiebitz **with Plus**: `initPlus` hands out a local
all-features entitlement instead of reading the secure store, so the Plus
screens (Insights strength tab and so on) are not blurred behind the lock. It
only exists in the dev server (`import.meta.env.DEV`) with `?store-capture` on
localhost. The engine card reads "Stockfish 19" and the demo hints ("demo
view", "preview values") are hidden.

The script waits for spinners to disappear and for charts to animate in
before each shot; do not edit `src/` while a run is going, Vite reloads the
page and the run aborts.

### Website screenshots

```sh
node scripts/capture-store-assets.mjs --site
```

Takes the four feature screenshots for kiebitz.dev (English, 1920 × 1009 like
the desktop window) into `artifacts/site-shots/`. Copy them to
`kiebitz-site/assets/shots/` and check the figure captions in
`src/pages/index.html.template`, which quote numbers from the shots.

### Real captures (September 2026)

The browser preview only knows demo pages (puzzles and repertoire without a
real trainer, analysis without an engine). The current upload set was
therefore taken from the real apps instead, with the real database and Plus:

- `phone` / `tablet-7`: Kiebitz 1.4.0 (published AAB) on the `Kiebitz_API_36`
  emulator, display set to 1080 × 1920 with `adb shell wm size`, the desktop
  database copied in via `VACUUM INTO`, pages opened with
  `kiebitz://open?page=…`, the language switched in the app's
  `settings.json`. Status bar and gesture bar are cropped
  (y 100–1870); the renderer draws its own status bar.
- `tablet-10` / `chromebook`: the desktop app maximised on a 1920 × 1080
  monitor (client area 1920 × 1009), grabbed with `PrintWindow` so windows in
  front of it do not end up in the picture.

The raw files live in `artifacts/real-shots/`; copy them into
`artifacts/store-assets/<locale>/<device>/` with the names above and run the
marketing step.

## 2. Marketing layer

```sh
npm run store-assets:marketing
```

The renderer never touches the source captures. It adds the marketing layer,
generates review strips, validates dimensions and color mode, and packages all
133 upload files as `artifacts/Kiebitz-Play-Store-Assets-v3.zip`.

### Text shaping

Chinese, Hindi and Arabic cannot be drawn by Pillow alone: Devanagari reorders
the i-matra and builds conjuncts, Arabic joins its letters and runs right to
left. `scripts/storetext.py` shapes those three with HarfBuzz, fills the glyph
outlines from fontTools, and lays mixed runs out by direction so "chess.com
وLichess" comes out right. Arabic slides are set flush right inside the text
column. Latin locales keep the original Pillow path unchanged.

It needs two packages and three Windows system fonts:

```sh
pip install uharfbuzz fonttools
```

Microsoft YaHei (`msyh.ttc`), Nirmala UI (`Nirmala.ttc`) and Segoe UI
(`segoeui.ttf`) ship with Windows; the renderer stops with a clear message if
one of them is missing.

## v3 design

- **Device frames.** Every capture sits in a dark Android frame with bezel, mint
  rim light, and a synthetic status bar (clock, signal, wifi, battery,
  punch-hole camera). The frame is tilted alternately ±4° and bleeds off the
  bottom edge, so the UI stays large and readable.
- **Editorial headline.** Eyebrow pill in Kiebitz mint, then a two-line headline
  — first line white, second line mint — and two lines of supporting copy. The
  headline size is computed once per series so all frames line up in the
  carousel.
- **Continuous backdrop.** One wide scene is rendered per device series and each
  frame crops its own window out of it: dark green gradient, rotated chessboard
  texture, and a mint light that pulses across the whole strip. Swiping the
  carousel reads as panning across a single image.
- **Feature graphic.** Wordmark, headline, tagline, and a trust pill next to two
  overlapping phones.

The upload sequence is:

1. Dashboard — ownership and local-first positioning
2. Analysis — Stockfish analysis
3. Insights — patterns and weaknesses
4. Study — personal training plan
5. Repertoire — phone only
6. Puzzles — phone only

Edit the localized `COPY` mapping in `scripts/compose-store-assets-v3.py` to
adjust eyebrows, headlines, or supporting copy. Headlines are two short lines
(all caps in the Latin locales); keep the longest line under roughly 13
characters or the shared font size shrinks for the whole series.

## Known gap

The demo data in `src/data/demo.ts` — the sample engine lines and move comments
— is German in every locale, so it shows up untranslated in the Analysis
screenshot. That has been true for the English assets all along; translating the
demo content would fix it for all seven locales at once.
