# Design modes

Kiebitz draws the same data in two layouts: **Dashboard mode** (the default)
and **Diagram mode** (in German, *Das Blatt*). Both are switched in
Settings → Appearance, above the theme picker, and both are free.

A mode is not a colour theme. All eight themes keep working in either one,
light and dark, and neither mode swaps a single token. The choice is stored as
`appearance.diagram` (`src/lib/theme.ts`), applied as `data-diagram="on"` on
`<html>`, and read in React through `useDiagramMode()` (`src/lib/diagramMode.ts`).

## Dashboard mode

Product UI. Inter throughout, rounded panels on `bg-panel` with a `border-line`
edge, KPI tiles, cards, Recharts graphics, and the ordinary shell: sidebar on
the desktop, bottom bar on the phone (`src/components/MobileShell.tsx`).

The register it speaks: a control looks like a control. Numbers sit in tiles,
lists sit in cards, an action sits on a button. Density and filters belong
here — this is the mode that has to survive 1,500 games and a search field.

When adding to it, follow what is already on the page: `Card`, `Button` and
friends from `src/components/ui.tsx`, `Kpi` from `src/pages/insights/parts.tsx`,
chart colours from `src/components/chartTheme.tsx`.

## Diagram mode

A page from a chess book, set with the rigour of an OTB tournament form. Chess
first, statistics as a marginal note. It is a second reading of the same app,
not a skin: the layout changes, the shell changes, the data does not.

Its rules:

- **A printed diagram, not a board.** Hairline frame, coordinates outside,
  caption underneath. A print (dashboard, game entry, repertoire position) uses
  the muted square colours; a board that is actually played on (analysis,
  endgames, puzzles) keeps the theme's squares. A print can still be played on
  — the repertoire's book position takes a move and opens the variation builder
  with it — and it stays a print while doing so: same muted squares, and the
  selection, the targets and the captures are marked with a frame, a dot and a
  ring rather than coloured squares. `src/components/blatt/Diagramm.tsx`
- **Hairlines, not card borders.** A section is a heading with a rule under it,
  not a box. Nothing is nested in a panel that a rule can separate.
- **A register, not a nav bar.** Chapter left, dotted leader, number right; the
  current page is marked at the spine like a bookmark. `Register.tsx`
- **Rows, not cards.** A game is a line in a tournament book — result as a dot,
  colour as a field, two marks at the end instead of a tag column, and the key
  to those marks right-aligned under the column it explains. Every column of a
  row is also a handle: date, colour box, opponent, opening, ECO and result dot
  each narrow the game index to that one value, the same move the ordinary
  version makes. `PartieZeile.tsx`
- **Ranks, not colour bars.** A finding carries its severity as a number saying
  which one is due first, not as a red bar saying how bad it is. `Befund.tsx`
- **Every state of a page, not only the full one.** A tab opened with nothing
  chosen yet is a page of the book too: the analysis board without a game
  carries no form head and no annotations, but it keeps the controls that get
  you to a game and shows the engine's lines where the commentary would be.
  A page hands those controls to its variant (`laufleiste`, `motor` in
  `AnalysisBlatt`, `einfuhr` in `GamesBlatt`) instead of dropping them — the
  mode changes the layout and must not cost a function. Where a control is a
  control and nothing else, the variant hands the ordinary one back and only
  re-sets it: `.blatt-formular` in `blatt.css` squares the corners and turns
  filled surfaces into edges, which is how the settings, the PGN import and
  the analysis notes live in the mode without being built a second time.

  The rule cuts the other way too, and that is the harder half: three pieces
  of the analysis tab used to exist only in the ordinary version — the engine
  next to a game, the accuracy per phase, and notes and tags. Each of them was
  a function the mode cost, which is the one thing a second layout must not
  do. They are in it since 1.3, set as the mode sets things: the engine at the
  head of the apparatus, where the other two answers about *this position*
  stand; the accuracy as a table of two columns rather than four tiles; the
  notes as the ordinary field, re-set.

  Two more were caught the same way. The training tab had the coach and the
  week but neither the plan for the next seven days nor the play hygiene: it
  said what the week had brought and not what was meant for it. Both are on
  the sheet now — the plan as the counterpart of the week bar (planned minutes
  stacked above the baseline, measured time as a rule below it,
  `pages/blatt/Plantafel.tsx`), the hygiene as what it is, a few numbered
  sentences on rules rather than a field of tiles. And the repertoire's index
  could only be read: moving, editing and deleting a variation existed only in
  the ordinary list. The three handles sit at the end of a line now, visible on
  the open line and under the pointer, their space always reserved so the dotted
  leader does not jump; ←/→ page through the moves of the open variation, ↑/↓
  go to the next one.

  A third sweep, in 1.4, closed what was left. The weekly report existed only
  as an icon in the ordinary page head, and a column title has no room for an
  icon button — so the mode simply had no retrospective at all. It is the same
  dialog now, with the report inside it set as a page of the book
  (`pages/blatt/Wochenblatt.tsx`), and the way to it sits at the foot of the
  week column, where that section ends. The repertoire's book position took
  a move but dropped it: playing one on the ordinary board opens the builder
  seeded with exactly that move, and in the mode nothing happened. A print can
  be a handle — that is the same rule the game rows follow — so `Diagramm` now
  takes tap-tap and drag when a page hands it a `zug`, and marks with a frame,
  a dot and a ring instead of filled squares. And five reports of the Insights
  tabs were only in the ordinary version: the short report and the key moment
  on the overview, the context at the foot of strength, the format
  recommendation above the format table, the played openings, the training
  balance with its lag, the puzzle history and the hit rate by hour. Each of
  them is a question the mode stopped answering; each is set the way the mode
  sets things, and none of them is a new number.

  The same sweep reached the three pages you actually play on. **Sharing a
  position and the focus board** existed only in the ordinary version of the
  repertoire, the puzzles and the endgames — two ways the mode simply did not
  have, which is the one thing a second layout must not cost. They are the
  ordinary buttons, handed to the variant and re-set: `Schalterreihe` takes a
  `griffe` slot that closes the hairline row with a `.blatt-formular` group,
  exactly as the ply counter in `AnalysisBlatt` already did. The repertoire's
  print owns its focus itself, because it is the sheet that builds that print.
  The **note on a position** was set but not writable — a field that looked
  like a field and swallowed every keystroke; it is the same textarea now, on
  the same ruled paper (`components/blatt/Notizfeld.tsx`). And the **opening
  trainer** had no sheet at all: tapping "start training" dropped the reader
  out of the book and into cards and buttons. `pages/blatt/TrainerBlatt.tsx`
  sets it as the drill sheet its two neighbours already are, in both its
  states — the card and the empty deck. The state machine did not move:
  `components/RepertoireTrainer.tsx` still holds the stack, the grades and the
  schedule, and picks a presentation.

  A fourth closed three. The analysis got the **recommended line as a handle**
  — every move of it a button that plays the variation up to there — and a
  layout that showed it only on one side would have cost the other the one
  thing the reader asked for. The page builds the lines, each mode sets them:
  small buttons over there, a line of book notation under the game text here
  (`varianten` in `AnalysisBlatt`). The repertoire's **note on a position** printed
  the invitation to write one even where no position was chosen — a field that
  looked like it was waiting for an entry while nothing could hang on it; the
  em dash of the fields above it stands there now, and the invitation stays
  where it belongs, in the field you can actually type in. And the **book as
  PGN** — reading a repertoire in and writing it out — existed only as a card
  at the foot of the ordinary page. It is the same card, handed in and re-set
  (`buch` in `RepertoireBlatt`), behind a way at the foot of the index, where
  the week column already offers its report.

  A fifth sweep was about *when* a thing is shown rather than whether it is.
  The endgame hint is the theory behind the position — how the technique
  actually goes — and it stood open next to the board in both layouts, so the
  first look at a drill already gave the answer away. It lies covered now and
  is uncovered on a tap, in both modes and from one piece of state on the page
  (`hintOpen` in `pages/Endgame.tsx`): the sheet covers it with a ruled field
  and puts REVEAL in the section rule, the dashboard with a bordered strip and
  a chevron. The next drill covers it again. Which layout you read makes no
  difference to what is covered, only to how the cover is set.

  Two measurements were wrong rather than missing. A boxed value in a form head
  is two characters wide when it is a result and twelve when it is a word, and
  the head had a fixed width for both — the weakest axis of the Insights read
  "Verwertu…", the weakest opening "Italian G…". `Ergebniskasten` takes `wort`
  now: the box measures itself against its content, up to a maximum, and breaks
  onto a second line instead of clipping. And the repertoire's three columns
  only fit a window that is wider than the app's default: at 1440 × 900 the
  apparatus on the right was left with about 200 points, which is a column of
  word fragments. Each column names the width below which it is no longer
  worth setting; where the line cannot carry all three, the apparatus breaks as
  a whole and stands full width under the index and the print — the phone's
  order, two steps later.

  Where a shared piece is a whole machine rather than a control — the planner
  is a window of seven days, a calendar, drag-and-drop, series and a template
  library — neither copying it nor handing it back works. Its state moves out
  instead: `components/plantafel.ts` holds the hook both settings call, and
  `StudyPlanner.tsx` and `Plantafel.tsx` are two ways of drawing the same one.
  One data path, one set of mutations, two sheets.
- **A focus is a page too.** The focus board used to open as the dashboard's
  rounded card in both modes. In the mode it is a sheet now: a running head
  with a heavy rule instead of a title bar, an ink frame instead of a card,
  paper instead of a panel (`FocusBoard.tsx` reads `useDiagramMode()`). The
  drill sheets — puzzles, endgames, the opening trainer — own their focus,
  like the repertoire's print: the rows around the board in the focus are the
  same colour-field lines, hairline switch rows and toned message as on the
  sheet, built once and set twice. Where a page hands its ordinary bar into the
  focus (analysis, repertoire), `.blatt-formular` and `.blatt-fokusreihe`
  re-set it. The puzzle sheet has no "next" until a puzzle is over: skipping
  left no trace, while hint and solution are booked as failed attempts.
- **Informator signs, from the analysis.** A book comments without words:
  ± = ∓, △ with the idea, ▽ aimed against, → with attack, ⊕ time trouble,
  bishop pair, passed and doubled pawns, ⊥ ending. The signs are derived in
  the analysis run (`src-tauri/src/informator.rs`) from what it can prove —
  evaluation, engine recommendation, detected motif, clocks, the position —
  and stored per position (`move_evals.signs`, `games.end_signs`); nothing
  is computed when a page opens. The sheet prints them onto the dashboard's
  diagram, the game entry's final position and the analysis board
  (`components/blatt/Zeichen.tsx`), drawn as strokes rather than glyphs so
  every device prints the same sign, with the key underneath listing only
  what stands on this board. An idea is only marked where the move played
  missed it — a triangle on every quiet move would be the engine, not a book.
- **Book type.** Source Serif 4, and only where `.buch` is set — the interface
  stays on Inter. `blatt.css` also holds the four typographic rules the mode
  uses: `.blatt-kolumne` (running heads and section rules), `.blatt-feld` (form
  labels), `.blatt-zahl` (tabular figures), `.blatt-punktlinie` (dotted leader).

Composition pieces live in `src/components/blatt/Satz.tsx` and are named in
German, like the design vocabulary they carry: `Kolumnentitel`, `Rubrik`,
`Farbfeld`, `Punkt`. Keep that when adding to them.

## What never differs

- **One data path.** A page fetches as it always did and only picks the
  presentation. Diagram mode never gets its own query, its own statistic or its
  own number.
- **Tokens only.** No colour value in either mode; everything comes from
  `src/themes.css`, so both follow the theme and the light/dark switch.
- **The same board and piece sets**, the same 44 px touch targets, the same RTL
  rule (board and notation stay ltr).

## Where the code lives

| | |
| --- | --- |
| Mode flag, cache, `data-diagram` | `src/lib/theme.ts`, `src/lib/diagramMode.ts` |
| Rules that can be computed | `src/lib/blatt.ts` |
| Composition pieces, type | `src/components/blatt/`, `blatt.css` |
| State shared by both settings | `src/components/plantafel.ts` |
| Diagram-mode page variants | `src/pages/blatt/*Blatt.tsx`, the five Insights tabs in `src/pages/blatt/insights/` |
| Informator signs (derived, stored, drawn) | `src-tauri/src/informator.rs`, `src/lib/informator.ts`, `src/components/blatt/Zeichen.tsx` |
| Shared field both modes write | `src/components/RepertoireNote.tsx` (ordinary), `src/components/blatt/Notizfeld.tsx` (sheet) |

Each page renders its regular version and lazy-loads its `*Blatt.tsx` variant
when the mode is on — Dashboard mode must not pay for type and layout it never
shows. Anything a diagram-mode page has to compute belongs in that variant, not
in the shared page.
