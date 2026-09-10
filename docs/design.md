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
  endgames, puzzles) keeps the theme's squares. `src/components/blatt/Diagramm.tsx`
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
| Diagram-mode page variants | `src/pages/blatt/*Blatt.tsx`, the five Insights tabs in `src/pages/blatt/insights/` |

Each page renders its regular version and lazy-loads its `*Blatt.tsx` variant
when the mode is on — Dashboard mode must not pay for type and layout it never
shows. Anything a diagram-mode page has to compute belongs in that variant, not
in the shared page.
