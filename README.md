# Kiebitz

Local-first chess companion for desktop and Android. Import your chess.com and
Lichess games, analyze them with a native Stockfish, build an opening repertoire,
train tactics and endgames — all from a single dashboard, with your data staying
on your own devices.

No Kiebitz account and no chess-data cloud. Games, analyses, and settings stay
on your device. Devices sync directly with each other over the local network.

**Website:** <https://kiebitz.dev/> · **Downloads:**
[latest release](https://github.com/kiebitz-dev/Kiebitz/releases/latest)

## Features

- **Dashboard** — ratings, recent games, quick jumps to chess.com & Lichess.
- **Game database** — duplicate-safe import from chess.com/Lichess, PGN
  import/export, tags, per-game and per-move notes, position search.
- **Analysis** — live Stockfish analysis plus a background pipeline that
  annotates every game (per-move evals, inaccuracy/mistake/blunder, accuracy),
  and a board that shows how the game ended — checkmate, resignation, timeout
  or draw, marked on the losing king.
- **Insights** — four in-depth pages on playing strength, openings by color,
  behavioral patterns and error phases across your whole history.
- **Repertoire** — a position tree trained with FSRS spaced repetition, with
  the variation list in an order you drag yourself.
- **Puzzles** — offline tactics from the Lichess database *and* from your own
  missed moves, with Elo and per-theme tracking.
- **Endgames** — curated theoretical drills against the engine, optional Syzygy.
- **Study** — a training programme built on measured time: the trainer pages
  count the minutes you actually spend, games contribute their real length from
  the clocks. A weekly bar shows where you stand, the day's session lists what
  to do with the dose attached (which puzzle band, which opening, which endgame
  type) and opens it in one click, planned units complete themselves once the
  measured time covers them, and what a week leaves open carries into the next.
  What to work on is read from the stretch you actually played in — a few weeks
  if you play daily, a quarter if you play now and then — so the advice moves
  when your play moves. A symbol in the header lights up once a week for a
  report on the week that just ended — what changed, what the training did,
  what to work on now — and opens it over the page. Every number in it is
  checked against the noise its own sample carries, so a quiet week is
  reported as a quiet week and not as progress.
- **Sharing** — send a position from the analysis board, a puzzle from the
  trainer, an opening line from the repertoire or an endgame drill: a picture
  card in Kiebitz' own colours plus a link that opens the position anywhere.
  The position travels inside the link itself, so nothing is stored on a
  server; a shared puzzle keeps its solution covered until the person on the
  other end asks for it, and its board plays by the rules — only the side to
  move can be picked up, and every legal target is marked.
- **Mobile** — Android build with native per-ABI Stockfish and encrypted
  device-to-device LAN sync (QR pairing) with the desktop as hub.

German, English, Spanish, French, Hindi, Arabic and Chinese, with one carefully
made dark theme.

## Development

```sh
npm install        # frontend dependencies
npm run dev        # web preview at http://localhost:5173
npm run tauri dev  # desktop app (requires Rust + MSVC C++ toolchain)
```

Live analysis needs a Stockfish binary (not bundled in the repo). Place one at
`src-tauri/binaries/stockfish.exe`, or point the `KIEBITZ_ENGINE` environment
variable at any UCI engine. In the web preview the analysis panel shows demo
values instead.

Build, packaging and release mechanics: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
The two layout modes and what each one is for: [`docs/design.md`](docs/design.md).

## Stack

Tauri 2 · React + TypeScript · Rust · SQLite · Stockfish

## License

Kiebitz is **source-available, not open source**. You may read the code, build it
and run it privately; what you may not do is redistribute it or build a product
on it. Using Kiebitz itself — including while you teach, stream or otherwise earn
money from your own chess — is not restricted. See [`LICENSE`](LICENSE) for the
exact terms, and https://kiebitz.dev/terms for the account and Kiebitz Plus.

Bundled third-party software keeps its own license — notably Stockfish under
GPL-3.0, whose corresponding source is attached to every release. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
