# How photogram absorbs fifteen more features without becoming a cockpit

The gap audit (see PARITY.md) points at roughly fifteen features worth adding.
Bolted on the way the first dozen were — a button here, a popover there — they
would bury the app. Every editor that handles this many tools well on a phone
(Lightroom Mobile, CapCut, Procreate, Instagram's editor) survives on the same
architecture, and photogram should adopt it before the next feature lands.

## The core shift: from a button model to a selection model

Today every feature owns chrome: a dock button, a slide-header icon, a chip, a
popover. That scales linearly with features — which is the problem.

The editors that scale show tools for **what is selected**, not everything at
once. Tap a clip in CapCut and the whole bottom strip swaps to clip tools. Tap
nothing and it shows project tools. One strip, many contents. Nielsen Norman
calls out the danger — [modes cause mode slips](https://www.nngroup.com/articles/modes/)
when the active mode isn't loudly visible — so the rule is: the selection is
always visible (outlined photo, highlighted slide), the strip always names it,
and one tap on empty space always exits.

photogram's selection states, in order of specificity:

| Selected | How | The strip shows |
| --- | --- | --- |
| nothing | default | today's dock: Add, Remix, Canvas, Download |
| a slide | its header / long-press | Template, Text, Background, Duplicate, Shuffle, Save, Delete |
| a photo | tap (exists today) | Size, Pan, Rotate, Flip, Replace, To playground, To new slide |
| a text object | tap (future) | Edit, Font, Size, Colour, Curve, Delete |

## One strip, four layers, hard budgets

Instagram's edit screen is the model: a single horizontally-scrollable tool
carousel in the thumb zone, where picking a tool opens **one inline control in
place** — a slider, a swatch row — never a second stacked panel.

- **L0 — persistent:** the dock. Budget: 5 items, ever.
- **L1 — contextual strip:** scrollable icon+label tiles for the current
  selection. Budget: 9 visible.
- **L2 — one inline control:** tapping a tool swaps the strip for that tool's
  single control with a ✓ to confirm. Only one L2 open, ever.
- **L3 — browsing sheets:** full bottom sheets only for collections you scan
  (template gallery, font list, export options). Never opened from another
  sheet.

Every feature from the audit has exactly one home:

| Feature | Layer | Home |
| --- | --- | --- |
| Undo / redo | L0 | lives in the dock's tally lobe — the "p" becomes functional |
| Filter intensity | L2 | slider appears under the filter strip when a look is active |
| PNG / print-size export | L3 | one Download sheet: format + size, replaces the bare button action |
| Custom background colour | L2 | slide strip → Background → swatches + wheel |
| Duplicate slide | L1 | slide strip |
| Custom aspect ratio | L2 | canvas strip → Aspect → presets + two number fields |
| More filter looks | L1 | the existing bubble strip, which already scrolls |
| Decorative border styles | L2 | canvas strip → Borders → style row above the width slider |
| Rotate / flip | L1+gesture | photo strip buttons **and** two-finger rotate on the selected photo |
| Replace photo | L1 | photo strip → opens the playground/import as the picker |
| Free text boxes | selection | tap-to-place, then the text strip; caption becomes just a preset |
| Curved caption | L2 | text strip → Curve slider |
| Doodle layer | full mode | the one true full-screen mode, entered deliberately, exited by ✓ — strong signifier per NN/g |
| Freeform slide mode | template | "Freeform" is a template choice; within such a slide, drag means move-absolutely. The pinned-template chip is the mode signifier |
| Picture-in-picture | L1 | photo strip → Inset, reusing the mesh overlay drawing path |

## Direct manipulation beats controls

Half the audit needs no new buttons at all if gestures carry it: drag inside a
selected photo to pan its crop (the nudge arrows stay as the accessible
fallback), two-finger twist to rotate, drag a text box to place it. Buttons
are for the discrete things; gestures for the continuous ones. Haptics mark
every selection change and mode boundary, as they already do for drags.

## Why undo/redo goes first

A selection model invites experimentation, and experimentation needs a safety
net. Every mutation already flows through a handful of set-state paths feeding
the IndexedDB snapshot — a history stack wraps them in one place. Undo/redo
also fills the tally lobe with something worth touching.

## Migration in three phases, shippable at every step

1. **Quick wins into existing homes** (no architecture change): undo/redo in
   the lobe, filter intensity, PNG export, background colour, duplicate slide,
   custom aspect, more looks, border styles.
2. **The contextual strip**: photo-selected and slide-selected strips replace
   the tap popover's grab-bag and the ⋯ sheet's list. Same features, one
   grammar.
3. **New object types on the selection model**: text boxes, doodle mode,
   freeform slides, insets — each is just another thing that can be selected.

## Guardrails (the part that keeps it intuitive)

- Budgets are hard: dock ≤ 5, strip ≤ 9 visible, one open layer.
- Selection is always visible; tapping empty space always deselects.
- Every mode names itself and shows its exit.
- Nothing important lives only behind a gesture — every gesture has a button
  twin somewhere reachable.
- The top of the screen stays chrome-free; photos remain the brightest thing.

Sources: [NN/g on modes](https://www.nngroup.com/articles/modes/),
[Mobbin's toolbar patterns](https://mobbin.com/glossary/toolbar),
[Unity's contextual tooling pattern](https://www.foundations.unity.com/patterns/contextual-tooling),
[thumb-zone research](https://www.brandvm.com/post/mobile-ux-best-practices),
[progressive disclosure on mobile](https://www.digia.tech/post/progressive-disclosure-mobile-ux/).
