# Move explanations

Every analysed half-move carries a sentence saying *what happened*, not just
how many centipawns it cost, and every analysed game carries a short verdict.
Both are produced by the auto-analysis in the background; diagram mode shows
them, on the dashboard and on the analysis board.

```
AUS DER ANALYSE
„Dd5+ trifft König g8 und Springer e5 zugleich."
Widerlegt wird der Zug durch Dd5+.
```

The second line is the **reason**: the reply the engine punishes the move
with, which the analysis has stored anyway (`motif_detail.reply`). Where there
is none, the line stays out, and where the sentence above already names that
reply — a fork sentence does — it stays out too rather than saying the same
move twice. `begruendeZug`, same file.

Evaluations used to stand there ("falls from +0.4 to −4.9") and are gone. Two
numbers on a scale nobody outside an engine carries in their head are not a
reason, they are a second question. What a move actually costs is now said in
**pieces**, in the annotation itself — see below.

## The annotation

The sentence above answers *what happened*. The **annotation** — the indented
paragraph under a move in the game text, and the coloured callout on the
dashboard — answers the question a player actually has while replaying:
*why was that bad, and why was the other move better?*

Until 1.3 it was one sentence and answered neither:

```
4.d3?! Ungenauigkeit. Die Bewertung springt von −0,1 auf −1,1. Besser war Se2.
```

1.3 answered them with more numbers, which was worse:

```
13…Txd5?? Patzer. Die Bewertung springt von −1,7 auf +1,6. Vorher klarer
          Vorteil für Schwarz, jetzt klarer Vorteil für Weiß. Die Zahl kommt
          aus der Fortsetzung 14.Dxa4+ Dd7 15.cxd5 Le7. Besser war axb3:
          13…axb3 14.Txa5 Dxa5 15.Dxb3 hält die Bewertung bei −1,7.
```

Every sentence in it is true, and together they still do not say what
happened: the opponent takes a pawn with check and helps himself to the rook
afterwards. That is what the reader wants, and it is computable — the line is
already stored, it just has to be **played out** instead of quoted.

`move_evals.pv` of the **next** row is the engine's best line after the played
move: exactly what the opponent now does with it. `fortsetzung` in
`lib/folge.ts` replays it with chess.js and counts the captures;
`kommentiereZug` in `lib/erklaerung.ts` turns that into up to four sentences,
each with a condition under which it stays out:

| | Sentence | Stays out when |
| --- | --- | --- |
| 1 | the judgment | never — and it is one word now |
| 2 | the motif — what happened | no motif was detected |
| 3 | what it costs, in pieces — the opponent's capture and what the line collects after it | nothing is captured, or the line cannot be replayed |
| 4 | what was better — the move and its line | no line, or the line starts with the move that was played |

Where neither 2 nor 3 has anything to say, the continuation itself stands
there in notation instead ("Der Gegner setzt mit 14.Dxa4+ Dd7 15.cxd5 fort.").

```
13…Txd5?? Patzer. Dxa4+ schlägt einen Bauern mit Schach und gewinnt danach
          einen Turm. Besser war axb3: 13…axb3 14.Txa5 Dxa5 15.Dxb3.
```

Four rules:

- **Five half-moves of a line, no more.** Two and a half moves show the intent;
  from the sixth on it is engine prose, and whoever reads that far is not
  reading an annotation any more. `LINIE`, same file. The *counting* in
  `lib/folge.ts` uses the whole stored line — cut at five, the tally would end
  in the middle of an exchange.
- **The refutation is counted, not the whole trade.** If the played move
  captured something itself, that stays out of the sum. The annotation tells
  what the opponent does now; the balance of an exchange the reader just
  watched is not the point.
- **An uneven trade gets no piece named.** Rook for bishop and pawn is not
  "wins a rook". Then the sentence says "material" and stays true.
- **A move that was approved gets no "better was".** There was nothing better.
  It gets sentences 1 and 2, and the continuation of the main line where the
  move played *is* its first half-move.

**Games analysed before the `pv` column** have `best_uci` and no line. They
keep the short form — the judgment, the motif, and " Besser war {san}."
Nothing is invented for them; re-analysing the game fills the lines in.

## The shape of it

Rust detects and stores **facts**; TypeScript turns them into **sentences**.
That split is the whole design, and the reason is Kiebitz's seven languages:
text written in Rust speaks one of them.

| Layer | File | Produces |
| --- | --- | --- |
| Motif detection | `src-tauri/src/motifs.rs` | a motif name plus its squares, as JSON |
| Game verdict | `src-tauri/src/verdict.rs` | a list of `{key, params}` building blocks |
| Wiring | `src-tauri/src/analysis.rs` | writes both during the analysis run |
| Captures | `src/lib/folge.ts` | the opponent's first capture and the material tally of the line |
| Sentences | `src/lib/erklaerung.ts` | the finished text, per interface language |
| Words | `src/lib/locales/*.ts` | `expl.*` and `verdict.*` |

Two rules keep it from being embarrassing:

1. **Only what is checked gets claimed.** No motif means no motif sentence —
   the fallback is the honest one about the price, and if there is no judgment
   either, the page stays silent.
2. **Punishment motifs need a judgment.** "Fork" is only said about a move the
   engine already called an inaccuracy or worse. Otherwise every quiet move
   grows a story.

Deliberately absent: a language model. Nothing here needs one, and one would
speak English at a moment when the app is speaking Hindi. Where a model would
earn its place is off to the side — writing more phrasings for the locale
files at build time, or a cloud "explain this position in depth" as a Plus
feature.

## What the detector knows

`motifs.rs` works from the position before the move, the move, the engine's
recommendation, and the opponent's best reply. No engine, no I/O, pure
functions with golden-position tests.

| Motif | Fires when |
| --- | --- |
| `mate` | the position after the move is checkmate |
| `allowed_mate` | after the move the opponent has a forced mate, and did not before |
| `missed_mate` | the best line mated, the played move does not |
| `hanging_piece` | the opponent's best reply captures and wins material |
| `fork` | one piece hits two targets worth more than it, or loose and worth at least a minor piece |
| `pin` / `skewer` | an enemy slider through one piece onto a second, ordered by value |
| `discovered_attack` | a piece that did not move now attacks a rook, queen or king it did not before |
| `back_rank` | the king's escape squares are blocked by its own pieces and a heavy piece is on the board |
| `best_move` | the move matched the engine and nothing was lost |
| `none` | judged, but nothing found — say the plain thing |
| `""` | nothing to say at all |

The order is the order of the table: a mate outranks a material loss, a
material loss outranks a positional weakness.

## The verdict

Four to six sentences per game, from what the analysis computed anyway:
grade band from accuracy, a comparison with the opponent when the gap is worth
mentioning, the error tally, the weakest phase when it was actually weak, the
turning point, and a recurring motif when it recurred. Every block has a
condition under which it stays out — a sentence that says nothing makes the
paragraph longer and worse.

## Storage

Additive columns only, schema version 20:

- `move_evals`: `pv` (the best line before the move, UCI), `loss_cp`, `motif`,
  `motif_detail` (JSON), `expl_version`
- `eval_cache`: `pv` — the engine parsed it all along and the pipeline threw it
  away; carrying it costs no search time
- `games`: `verdict` (JSON), `verdict_version`

`expl_version` and `verdict_version` mean a later rules change can be
regenerated without running Stockfish again.

## Games analysed before this existed

`analysis::backfill_explanations` fills them in, **without an engine**. The
detector needs only the first half-move of the opponent's line, and that has
been in the database all along: `move_evals.best_uci` of the *next* row is
exactly the best reply in the position after the move. What it cannot recover
is the line beyond that, which stays empty until the game is re-analysed.

It runs once per data state in a background thread at startup, over games whose
`verdict_version` is behind. An empty verdict still gets its version number, so
a game that cannot produce one is not retried on every launch.

## In the interface

Both modes. The annotation goes wherever a move is commented — the indented
paragraph in the game text of `AnalysisBlatt`, and the coloured callout under
the move list on the dashboard, whose border keeps saying which judgment it
carries. The sentences below are the ones that belong to diagram mode alone.

**Only five annotations stand in the game text by themselves** (`ANMERKUNGEN`
in `AnalysisBlatt`), chosen by what the move cost and read back in game order,
plus whichever move the reader is standing on. A badly played blitz game
carries twenty otherwise, and the game itself disappears between them — that is
a protocol, not a tournament book. Nothing is lost: clicking a move opens its
annotation in place, and a footnote says so.

**"Only for my own moves"** (Settings › Annotations,
`Settings.annotate_own_only`) holds the annotation back on the opponent's
half-moves — the judgment mark in the move list, the badge on the board and the
annotation itself. `zeigtUrteil` in `pages/Analysis.tsx` is the one place that
decides it. The analysis still runs over the whole game: accuracy, ACPL, the
tally and the curve read both sides, and a count over half a game would be
wrong rather than brief.

`DashboardBlatt`, in both its layouts: a quote block `AUS DER ANALYSE`
carrying the sentence for the diagram move — which `lib/blatt.ts` already
chooses as the first blunder or mistake — its reason line under it, and one
`FAZIT DER PARTIE` under that. Without a motif it falls back to the sentence
about the price in points, not to the one about pieces: counting captures
needs chess.js, and `Dashboard.tsx` keeps chess.js out of the startup bundle
on purpose (the board is replayed in the lazily loaded variant).

`AnalysisBlatt`, under the game text, as a section of the same name. It
answers one question — *what happened here?* — and which "here" it means
depends on where the reader is standing:

- On a half-move the analysis found something about, that move's sentence
  stands there, with its reason line under it. Clicking a move in the flowing
  text is therefore also the question. Not on a move that carries an
  annotation, though: since the annotation brings the motif sentence itself,
  it would otherwise stand twice, three lines apart. There the section stays
  with the list below and leads on from it instead of repeating.
- Anywhere else, the section lists the game's heaviest moments instead — at
  most three, ranked by `loss_cp` and then read back in game order. Each line
  is a way there: clicking it opens that half-move.

Three and not all of them: the whole list would be the auto-annotation a
second time, and that already stands indented in the text above. The
selection happens in the variant (`AnalysisBlatt`), the sentences are built
once per game in `pages/Analysis.tsx` and only when the mode is on — a
Dashboard-mode reader never pays for eighty sentences nobody shows.

Still to come, deliberately: an Insights aggregation over recurring motifs.

## Adding a phrasing

Each motif has two phrasings, picked by hashing `${gameId}:${ply}`: the same
move reads the same in every session, two moves next to each other read
differently. To add a third, add `expl.<motif>.3` in all seven dictionaries and
raise `VARIANTS` in `lib/erklaerung.ts`.

Pronouns for pieces are avoided on purpose. Der Springer is masculine, die Dame
feminine, and a sentence that has to serve both gets it wrong in a different
way in every language.
