# Move explanations

Every analysed half-move carries a sentence saying *what happened*, not just
how many centipawns it cost, and every analysed game carries a short verdict.
Both are produced by the auto-analysis in the background; so far exactly one
place in the interface shows them.

```
AUS DER ANALYSE
„Dd5+ trifft König g8 und Springer e5 zugleich."
Die Bewertung fällt dabei von −2,1 auf −5,2.
```

The second line is the **reason**, and it exists because the first one alone
does not answer "why that much?". It is built from two things the analysis has
already stored: the reply the engine punishes the move with, and the two
evaluations around it. Where neither is there, the line stays out.

Two rules of its own:

- **It repeats nothing.** A fork sentence names the refuting move itself, so
  the reason line then carries only the numbers. After the plain sentence about
  the price — the case it was built for — it names the refutation first.
- **It counts from the mover's side.** The database stores evaluations from
  White's point of view; the line flips them, so "costs 5.3" and "falls from
  +0.4 to −4.9" are visibly the same statement. `begruendeZug`, same file.

The price itself is stated in **points of evaluation**, not in pawns. "5.3
pawns" is correct engine speech and reads as a claim about material, which it
is not.

## The shape of it

Rust detects and stores **facts**; TypeScript turns them into **sentences**.
That split is the whole design, and the reason is Kiebitz's seven languages:
text written in Rust speaks one of them.

| Layer | File | Produces |
| --- | --- | --- |
| Motif detection | `src-tauri/src/motifs.rs` | a motif name plus its squares, as JSON |
| Game verdict | `src-tauri/src/verdict.rs` | a list of `{key, params}` building blocks |
| Wiring | `src-tauri/src/analysis.rs` | writes both during the analysis run |
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

`DashboardBlatt` only, for now, in both its layouts: a quote block
`AUS DER ANALYSE` carrying the sentence for the diagram move — which
`lib/blatt.ts` already chooses as the first blunder or mistake — its reason
line under it, and one `FAZIT DER PARTIE` under that.

Everything else — the analysis board, the move list, Dashboard mode, an
Insights aggregation over recurring motifs — comes later, deliberately.

## Adding a phrasing

Each motif has two phrasings, picked by hashing `${gameId}:${ply}`: the same
move reads the same in every session, two moves next to each other read
differently. To add a third, add `expl.<motif>.3` in all seven dictionaries and
raise `VARIANTS` in `lib/erklaerung.ts`.

Pronouns for pieces are avoided on purpose. Der Springer is masculine, die Dame
feminine, and a sentence that has to serve both gets it wrong in a different
way in every language.
