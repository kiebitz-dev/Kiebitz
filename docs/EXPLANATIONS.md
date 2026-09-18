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

## The quiet move

Everything above needs a judgment or a motif, and most half-moves have
neither: a game has five of them and seventy-five others. Those seventy-five
stood there without a word until 1.4, and that does not read as restraint —
it reads as an analysis that failed. It was reported as exactly that.

They speak now, and without breaking the rule the rest of the file stands on.
Nothing is guessed: `lib/zugfakten.ts` replays the position with chess.js and
reports what was actually there — what the move took, whether it gave check,
whether the king left the centre, whether a knight or bishop left its home
square for the first time, whether a pawn entered the centre, whether an enemy
piece is now in the line of fire, whether the piece that moved was itself
under attack and got out. `schlichterSatz` in `lib/erklaerung.ts` turns that
into **one** sentence:

```
3.Bc4      Bishop c4 comes into play.
8…Qe7      Queen e6 was under attack and moves away.
6…Be6      Bishop e6 comes into play. It takes aim at bishop c4 along the way.
10.a3      The engine finds nothing to fault in a3.
```

One, not a list. What a move does is a list; what is notable about it is a
sentence, and a reader clicking through eighty half-moves wants the second.
Only the threat may attach itself, because it points past the move instead of
describing it.

Two of these facts are deliberately narrow, and the narrowness is the point:

- **A threat is only a threat where it wins something.** The target has to be
  worth more than the attacker, or be undefended and at least a minor piece.
  Without that, every bishop move would say "takes aim at f7" — and f7 is
  covered by the king.
- **Being attacked is not the same as being hit.** A knight on c6 attacked by
  a bishop and defended by a pawn is not in danger; moving it is not an
  escape. The cheapest attacker has to be worth less than the piece, or the
  piece has to stand there undefended.

Where nothing at all is left, the last sentence says the only thing still
true: the engine has nothing against this move. That is not filler — it is
what the missing mark next to the move already claims. It is the one sentence
that repeats within a game, and it has two phrasings for that reason.

This layer is in TypeScript and not, like the motifs, in Rust. It needs no
engine and no new column, so it needs no second analysis run over fifteen
hundred games — and the position it works from is already there wherever the
page replays the game. The same reasoning put `lib/folge.ts` on this side.

The page has to hand the facts over (`fakten`), and only two places do:
the analysis board and its sheet, both of which replay the game anyway.
`Dashboard.tsx` does not, on purpose — it keeps chess.js out of the startup
bundle, and the one move it shows is a blunder, which has a motif of its own.
Without `fakten` the function is silent exactly as it was before.

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
| The quiet move | `src/lib/zugfakten.ts` | what the move did on the board |
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

The overview in front of a game shows one of these sentences, not all of them:
`fazitKernsatz` picks the first that no number next to it already says —
result against play, turning point, recurring motif, weakest phase, the
comparison, the tally, and only then the grade, which just repeats the
accuracy printed beside it.

## The game rating

"Played like 1510" in the overview is a single-game performance: the
opponent's rating plus 55.3 points per percentage point of accuracy ahead,
capped at ±400 like any one-game performance, rounded to ten
(`lib/partierating.ts`).

The 55.3 comes from 1344 of the author's analysed games with both accuracies
and an opponent rating (18 Sep 2026). Two findings decided the form:

- Accuracy on its own hardly predicts rating: across all 2688 player sides
  r = 0.15, 2.7 rating points per accuracy point, ±236 scatter. A table of the
  form "86 % means 1650" would be noise, so there is none.
- The *gap* between both accuracies predicts the result well. A symmetric
  logistic fit P(point) = 1 / (1 + e^(−b·Δ)) gives b = 0.3185 and matches the
  actual score in every band of Δ within a few points. Turned into a rating
  difference with the Elo formula, 400 · log10(p / (1 − p)), that is linear in
  Δ: 400 / ln 10 · b = 55.3.

The cap is reached at about seven points of gap; 616 of the 1344 games sit
there. Without an opponent rating or without both accuracies there is no
number at all.

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

Both modes, and **word for word the same in both**. Which of the two texts a
move gets depends on the move, never on the mode:

- **A move that was faulted** — inaccuracy, mistake, blunder — gets the
  annotation: the indented paragraph in the game text of `AnalysisBlatt`, the
  coloured callout under the move list on the dashboard, whose border keeps
  saying which judgment it carries.
- **Every other move** gets the sentence from the analysis (`erklaereZug` plus
  its reason line) — the `AUS DER ANALYSE` block in diagram mode, the same
  callout on the dashboard. Since 1.4 that is *every* other move and not only
  the judged ones: where there is neither judgment nor motif, the sentence
  comes from what the move did on the board (see "The quiet move" above).

Until 1.4 the dashboard put the annotation under every judged move, so an
approved one read differently on either side: "Bester Zug. Rxe2 trifft die
Hauptvariante. Die Engine rechnet weiter mit …" against "Rxe2 trifft die
Hauptvariante." Two versions of one sentence are not two modes. `currentComment`
in `pages/Analysis.tsx` now follows the same split `blattKommentar` always did.

## The line you can play

The annotation names the better move and its line — and until 1.4 that line
was dead text. A reader who wanted to see it had to spell it out and push the
pieces around by hand; the engine lines beside it were no help, since clicking
one plays its *first* move and nothing else. That was reported, and it was
right.

The line now stands once and is a handle. Each of its moves is a button
(`components/VariationLine.tsx`); tapping the *n*-th puts the variation on the
board up to that point, so tapping along the line is how you play through it.
What is already on the board is marked, otherwise you lose your place after
the third tap.

Once, not twice: where the clickable line stands, `kommentiereZug` leaves the
notation out of the sentence (`ohneLinien`) and the sentence says only *which*
move was better. Only the move the reader is standing on trades its notation
that way — the other four annotations in the game text of diagram mode have no
line beside them and keep theirs in full.

Two lines are offered, and both are already in the database: `move_evals.pv`
of the row is the engine's line *before* the move — the recommendation — and
the `pv` of the row after it is what the opponent does with a mistake. The
second one only appears under a faulted move; after a good move that line is
the game itself, and the game is in the move list next to it.

The lines hang on the move the reader is standing on, not on the position on
the board — which stops being the same thing the moment you play one. That
anchor (`ankerPly` in `pages/Analysis.tsx`) is what keeps the line on screen
while you are inside it; without it the first tap would make it disappear and
"replaying" would mean seeing one move.

Both modes, again: the page builds the lines and each layout sets them — small
buttons on the dashboard, a line of book notation under the game text in
diagram mode (`varianten` in `AnalysisBlatt`).

A note on the **notation**: moves are set in English SAN everywhere — `Rxe2`,
not `Txe2`. `translateSan` in `lib/notation.ts` swapped the piece letters into
the interface language until 1.4, but only in the analysis sentences and the
diagram-mode game text, never in the move list, the opening book, the engine
lines or the shared images. Two names for one move on one screen are worse than
a foreign one. What the function still does is typography: castling is set
`0–0`, as print has always set it.

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

## Puzzles and openings

Two more places explain themselves since 1.4, and both follow the rule of
this file: the facts are checked, the words are written by a person.

**The solution of a puzzle, in words.** A puzzle said *whether* you found
the move and nothing about *why*. `lib/loesung.ts` replays the solution the
puzzle carries anyway (`PuzzleOut.moves`, UCI) and hands each of the
solver's moves to `zugfakten` — the same facts a game move gets. The sentence
comes from `tatsachensatz` in `lib/erklaerung.ts`, which is `schlichterSatz`
without its fallback: "the engine finds nothing to fault in Rxc1" is true
about a quiet game move and absurd about the key move of a combination, so
where nothing is notable the puzzle says nothing. The opponent's replies get
no sentence (forced defence, and a list is not an explanation), the setup
move of a Lichess puzzle is played but not shown, and numbering goes through
`notationParts` like every other line. The block appears only once the
puzzle is over — solved or revealed. Before that it would be the answer.

No motif is detected here. The puzzle brings its motif as a Lichess theme,
and what that theme means is the second piece:

**Theory texts** — `data/puzzleTheory.ts` (37 motifs) and
`data/openingTheory.ts` (55 opening families), two or three sentences each,
in all seven languages. They are content, not interface, and sit next to
`data/endgames.ts` for the same reason its hints do. A test fails if a text
is missing in any language, if a motif key is unknown to the theme catalogue,
or if an opening family is one the name table can never produce.

Openings are explained per **family**, never per variation: 3,807 named
positions cannot carry hand-written text, 120 families can, and the family is
what the reader actually asks about. `eroeffnungsfamilie` in
`lib/eroeffnungstheorie.ts` is `family_from_name` from the Rust insights,
rebuilt word for word — the text next to a table row has to explain the same
family the row counts. What the texts deliberately do not contain is lines or
verdicts; that would be a second repertoire beside the user's own.

All of it lies **covered** until asked for, like the endgame hint: the motif
theory names the motif (and uncovers it with it), and eight open paragraphs
in the openings tab would be a wall. Dashboard mode sets the cover as
`Disclosure` (`components/ui.tsx`), diagram mode as `Aufdeckfeld`
(`components/blatt/Satz.tsx`) and, for the list of families, as index lines
with the handle at the end. The two catalogues load separately
(`lib/motivtheorie.ts`, `lib/eroeffnungstheorie.ts`) — together they are
about 190 KB of prose, and a page loads only the one it shows.

Where it stands:

| | Dashboard mode | Diagram mode |
| --- | --- | --- |
| Solution in words | card under the board | THE SOLUTION, right column |
| Motif theory | strip under the board | covered field, right column |
| Opening families | section in Insights → Openings | index in `OpeningsBlatt` |
| Opening of the open variation | strip above the details | covered field in the apparatus |

## Adding a phrasing

Each motif has two phrasings, picked by hashing `${gameId}:${ply}`: the same
move reads the same in every session, two moves next to each other read
differently. To add a third, add `expl.<motif>.3` in all seven dictionaries and
raise `VARIANTS` in `lib/erklaerung.ts`.

Pronouns for pieces are avoided on purpose. Der Springer is masculine, die Dame
feminine, and a sentence that has to serve both gets it wrong in a different
way in every language.
