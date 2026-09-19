# Third-party notices

Kiebitz itself is source-available under the [Kiebitz Source-Available
License](LICENSE). The third-party software it uses and bundles stays under the
licenses of its respective authors; those terms are not superseded by Kiebitz'
own license.

## Stockfish (GPL-3.0)

Kiebitz distributes the Stockfish version pinned in
[`config/toolchain-pins.json`](config/toolchain-pins.json) and starts it as a separate process,
communicating over the public UCI text protocol. The Android binary is compiled
without source modifications from the pinned official commit; the Windows binary
comes from the official release archive. No part of Stockfish is linked into the
Kiebitz binary.

The notices, the complete GPL-3.0 text, the exact source revision, the binary
provenance with archive checksums, and the **written offer for the corresponding
source** live in [`src-tauri/resources/stockfish/`](src-tauri/resources/stockfish/).
These files ship as application resources in both the desktop and the Android
bundle, so every recipient of a binary also receives the notice and the offer.

Corresponding source is attached at no charge to every Kiebitz release. Its
exact, generated asset name is recorded in the bundled Stockfish notice.

The release workflow verifies the documented Windows archive and NNUE hashes,
compiles Android Stockfish from the pinned commit, and generates the source
archive straight from that same commit, so binary and source cannot drift apart.

## Lichess puzzle database (CC0 1.0)

The offline tactics trainer imports the public Lichess puzzle dump, released
under the CC0 1.0 public domain dedication. The database is downloaded per
device and is not redistributed by Kiebitz.

## Lichess opening names (CC0 1.0)

The offline opening-name lookup is generated from the public
[`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings)
dataset at commit `51b886249b9e418498d25b6e39b926c3de99c29a`, released under the CC0 1.0
public domain dedication.

## Additional piece sets (Merida, Fantasy, Chessnut)

Kiebitz Plus offers three further piece sets. They are **not** Kiebitz artwork:
each one is bundled unmodified, keeps its own license, and is credited here, in
the generated module, and on the picture card the app exports.

Set | Artwork | License
--- | --- | ---
Merida | Armando Hernandez Marroquin | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
Fantasy | [Maurizio Monge](https://github.com/maurimo/chess-art) | [MIT](https://github.com/maurimo/chess-art/blob/main/LICENSE)
Chessnut | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces) | [Apache 2.0](https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt)

All three are taken from the piece sets distributed with
[`lichess-org/lila`](https://github.com/lichess-org/lila/tree/master/public/piece),
whose [COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md)
records the authors and licenses above. Sets that lichess lists as non-free or
non-commercial are deliberately absent: Kiebitz Plus is a paid product.

The twelve original SVG files of each set live unmodified in
[`src/lib/pieces/vendor/`](src/lib/pieces/vendor/) so the source of the artwork
is in the repository and the licenses refer to something that can be checked.
[`scripts/generate-vendor-pieces.mjs`](scripts/generate-vendor-pieces.mjs) turns
them into the modules the app loads. It changes no shape and no colour; it only
makes twelve drawings survive sharing one document: element ids are prefixed per
set and piece, `<style>` rules become `style` attributes so no stylesheet leaks
into the app, and each file is given the 45x45 size the board draws in.

Regenerate after replacing an original:

```sh
npm run pieces:sync
```

The GPLv2+ of Merida applies to that artwork, not to Kiebitz' own code: the
drawings are data the app renders, they are unmodified, and the complete
corresponding source of the artwork is the SVG files in this repository. The
same holds for the picture card: it carries the credit of whichever set drew it.

## Chess piece artwork (CC BY-SA 3.0)

The pieces on every board are the **SVG chess pieces** by Wikimedia Commons user
**en:User:Cburnett**, licensed CC BY-SA 3.0:

<https://commons.wikimedia.org/w/index.php?curid=1499810>

They reach Kiebitz through `react-chessboard`, which embeds this set as its
default pieces and carries the same attribution. The captured-pieces list next
to each board draws the *same* artwork rather than a second, look-alike set:
[`scripts/generate-piece-glyphs.mjs`](scripts/generate-piece-glyphs.mjs) renders
a real board and copies the drawings into
[`src/components/pieceGlyphs.ts`](src/components/pieceGlyphs.ts).

Regenerate after updating `react-chessboard`:

```sh
npm run pieces:sync
```

CI runs `npm run pieces:check` and fails if the copied drawings no longer match
the installed `react-chessboard`, so board and capture list cannot drift apart.

Share-alike applies to the artwork, not to Kiebitz' own code: the drawings are
data the app renders, they are unmodified, and they are attributed here and in
the generated file. Any change *to the drawings themselves* would have to be
published under CC BY-SA 3.0 as well.

Sharing a position hands the same artwork to people who never installed
Kiebitz, so the attribution has to travel with it. It is printed on the picture
card the app exports (`src/lib/share/card.ts`), in the footer of every landing
page the share worker serves, and on the preview image that chat apps fetch.
The drawings stay unmodified there too: they are placed on a board, not
redrawn.

## ChessBase format tables (MIT)

The ChessBase reader (`src-tauri/src/cbh.rs`) carries the move tables and the
de-obfuscation table of **cbh2pgn** by Dominik Klein, ported from Python to
Rust: <https://github.com/asdfjkl/cbh2pgn>, MIT license, Copyright (c) 2022
Dominik Klein. The license text lives in
[`scripts/ported-licenses/cbh2pgn/LICENSE`](scripts/ported-licenses/cbh2pgn/LICENSE)
and is bundled with the app through the generated license file below.

The Scid reader (`src-tauri/src/si4.rs`) contains no third-party code; it
follows the published description of the `.si4` format.

## Wooden chess-piece recordings (CC0 1.0)

The short board sounds are edited excerpts from **"chess pieces.wav"** by
Freesound user **simone_ds**, dedicated to the public domain under CC0 1.0:

<https://freesound.org/people/simone_ds/sounds/366065/>

## Libraries

MIT, BSD and ISC require the license text and copyright notice to travel with
the binary, so the full texts of every shipped npm package and Rust crate are
bundled as an application resource:

[`src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt`](src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt)

The app reaches them under **Settings → About Kiebitz → Licenses & notices**,
next to the Stockfish notice and the GPL-3.0 text.

Regenerate after changing dependencies:

```sh
npm run licenses
```

The generator (`scripts/generate-third-party-licenses.mjs`) reads the npm
production tree from `package-lock.json` and the Rust graph from `cargo
metadata`, then takes each component's license text from the package itself.
CI runs `npm run licenses:check` and fails if the bundled file no longer matches
the dependency set, so it cannot silently go stale.

Development-only dependencies are excluded on purpose: they are not distributed
and therefore trigger no obligation.

### No copyleft in the linked dependencies

Everything statically linked into Kiebitz is permissively licensed (MIT,
Apache-2.0, ISC, BSD, MPL-2.0). The chess-rules crate is `owlchess` (MIT); the
GPL-3.0-or-later `shakmaty` it replaced would have made the binary a derivative
work. Stockfish is the one GPL component and stays at arm's length as a separate
UCI process. Keep it that way: a copyleft crate in the link graph would override
the terms in [`LICENSE`](LICENSE).
