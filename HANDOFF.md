# Handoff — Rubik's Cube Coach

State as of the 4x4 branch. Everything below is verified, not assumed.

## What this is

`C:\Users\elija\Downloads\rubiks-cube-coach` — a browser app that takes a cube's
colors (typed or scanned) and shows an animated 3D solution one turn at a time,
with no notation to learn. Plain HTML/CSS/JS. **No build, no dependencies, no
backend, no API keys, no network.** Node is used only to run tests and a local
static server.

## Deployment — two places, do not mix them up

| Branch | Serves | Where |
| --- | --- | --- |
| `main` | **stable 3x3 app, shared with a friend** | auto-deploys to GitHub Pages: https://elijahmanlockedin112.github.io/rubikssolver/ |
| `4x4` | in-progress work, orange "in progress" badge in the header | `node tools/serve.js` (:8123), exposed by Tailscale Serve at https://elijahman.taileb0bc0.ts.net (tailnet only) |

Pushing to `main` publishes immediately, so 4x4 work stays on the branch until
it is worth publishing. Repo: https://github.com/elijahmanlockedin112/rubikssolver

Licence is **all rights reserved** — public to read, not to reuse.

This machine has no global git identity, so commits are made with
`git -c user.name="Rubik's Cube Coach" -c user.email="noreply@example.com" commit`.

## What works

**3x3 — complete, on `main`.** Scan or type a cube, get a solution, follow it in
3D. Two solvers: `kociemba.js` (two-phase, ~20 moves, ~250ms) and `solver.js`
(layer-by-layer, ~110 moves in seven teachable stages).

**4x4 — complete.** Model, grid detection, colour reading, face identification,
the 96-sticker map and the 3D view all work; scanning a 4x4 lands correctly on
the map, and solving works — about 45 face turns via `tpr.js`.

**2x2 — complete.** Scan or type, and the solution is always the shortest one
that exists (never more than 11 moves). Scanning works, though six faces of a
2x2 sometimes fit together more than one way and it says so.

| File | Does |
| --- | --- |
| `js/cube.js` | 3x3: 54 facelets, six moves as permutations, validator that explains *why* a cube is impossible |
| `js/cuben.js` | any size: move tables derived from geometry, piece grouping, whole-cube rotations |
| `js/kociemba.js` | two-phase 3x3 solver |
| `js/solver.js` | layer-by-layer 3x3 solver |
| `js/detect.js` | finds an NxN grid in a photo; auto-detects size |
| `js/assemble.js` | colour naming, and 3x3 face assembly |
| `js/assemble4.js` | face identification from cube structure, for 2x2 and 4x4 |
| `js/solver2.js` | optimal 2x2 solver, from a full distance table |
| `js/tpr.js` | three-phase 4x4 solver, ~45 moves |
| `js/solver4.js` | 4x4 by reduction — the fallback, and what the tests drive |
| `js/repair.js` | fixes an obviously-wrong cube, refuses ambiguous ones |
| `js/autosnap.js` | when a face has been recognised well enough to photograph it unasked |
| `js/render.js` | software 3D on a 2D canvas, any size |
| `js/scan.js`, `js/app.js` | scanner and UI |

## The 2x2 solver (js/solver2.js)

Optimal, and provably so. A 2x2 is eight corners and nothing else, and with one
corner held still the whole puzzle is 7! x 3^6 = **3,674,160** positions - few
enough to walk outward from solved once and record the true distance to every
single one. Solving is then not a search: read the distance, step to a neighbour
one closer, repeat. The table builds in 150ms.

Measured over 500 cubes: **500 solved and verified, 5-11 moves, median 9**. No
2x2 needs more than 11 and this never returns more.

Holding the back-bottom-left corner still and turning only U, R and F is what
keeps it small: nothing pins a 2x2’s orientation, so the other three faces would
just re-reach the same positions 24 times over.

### The check that proves it

How many positions sit at each distance is a published result, and
`test/solver2.test.js` asserts it exactly:

    0:1  1:9  2:54  3:321  4:1847  5:9992  6:50136
    7:227536  8:870072  9:1887748  10:623800  11:2644

A wrong move table does not land on that by luck. It caught a real bug here:
twist has to be counted the same way round on every corner, or adding two twists
together is meaningless - and adding twists is exactly what the move tables do.
Ordering each corner’s stickers by face number does NOT give that; it winds one
way on some corners and the other way on their neighbours. The counts near solved
ballooned (54 became 76) while the total stayed right. Each corner is now wound
the same way as U,R,F and turned so its up-or-down sticker comes first, which
also makes every solved corner twist zero.

### Scanning a 2x2

It works. Six photos, any order, any way up, same as the bigger cubes.

Measured over 150 cubes (photos in a random order, each turned a random way up):
**115 exact, 35 flagged ambiguous, 0 silently wrong, 0 refused** — and through the
whole scan path including colour clustering, 48 exact of 60 with none wrong.

The ambiguity is real and will not go away. A 2x2 has no centres and no edges;
eight corners is the entire cube, and six faces genuinely can fit together more
than one way. Those alternatives are all solvable cubes. The app flags it and
asks for a look at the map, which is the honest answer.

Three things were needed to get from "refuses everything" to that:

- **The edge and centre checks had to become conditional.** `structureOf`
  required twelve edge colour-pairs; a 2x2 has none, so every arrangement was
  rejected — even six photos already in the right order.
- **Corners had to be checked for winding.** A cube has no mirrored corners.
  Number the opposite pairs 0,1,2 and a corner read the same way round gives
  them in the order 0,1,2 when an even number of far-side colours are used and
  0,2,1 when odd. Mirrored arrangements pass every count and fail this. Without
  it, nothing pinned a 2x2 down at all.
- **Twists had to add up**, but measured against the *right* axis. The eight
  twists come to a multiple of three only when counted against the colour pair
  that genuinely belongs on top and bottom. Measuring against "whichever pair
  holds colour 0" threw out true arrangements and broke a 3x3 that had been
  fine. The corner at the bottom-back-left names the right pair.

And one that was pure book-keeping: **two arrangements ending in the same cube
are one answer, not two**. A face that is all one colour reads the same
whichever way up it is photographed, so it turns up under several different
order-and-rotation pairs. On a 2x2, where a face is four stickers, that is
common enough that a third of perfectly certain cubes were calling themselves
ambiguous.

## Auto-capture (js/autosnap.js)

Nobody presses anything. Hold a face up, hold still for about two-thirds of a
second, and it takes the photo — six times, and the scanner closes itself. The
outline fills in green as it makes up its mind, the picture blinks white when it
has one, and the outline goes amber while it waits for the cube to be turned to
a face it has not done.

The judgement is a separate file from `scan.js` on purpose: `scan.js` needs a
camera, a canvas and a DOM, and this needs a list of numbers, so this is the
part that can be tested. `test/autosnap.test.js` drives it with faces of
actually scrambled cubes rendered and run through the real `detect.js`.

Two failures matter, and they pull opposite ways.

**Firing too eagerly** keeps a photo nobody would have taken. One frame saying
"there is a grid here" is not confidence — a half-turned cube, a hand crossing
the shot, or a blurred frame all produce one. So a face has to be found in four
consecutive looks, in the same place, at the same size, at the same angle,
reading the same colours.

The angle of the grid is what actually separates a held cube from a turning one,
and it was not the first thing tried. Drift was, measured as a fraction of one
cell — and the same 7px-per-look turn reads as 0.29 on a small cube and 0.20 on
a big one, so a slow turn of a cube filling the frame slipped past in 2 runs of
12. Grid angle does not care how big the cube is: **held 0.010 rad per look
(p99 0.034), turning 0.100 (p01 0.089)**, and the bar sits at 0.06 between them.

**Firing twice** is the other. After a shot the cube is still sitting in front
of the camera showing the face just taken, and the naive loop photographs it
again, and again, filling all six slots in about four seconds with six pictures
of one face — which then cannot assemble, for no reason the scanner can explain.
So capturing disarms, and rearming needs the view to become something else: the
face gone, or a face reading more than 10 away, for three looks running.

Measured over real pairs of faces from scrambled cubes: **one face against
itself a quarter turn round comes to 1.3 at worst; two different faces to 7.76
at the very closest on a 2x2, 24.69 on a 3x3, 34.88 on a 4x4.** The bar is
deliberately at the top of that gap, because the two mistakes do not cost the
same: calling a face new when it is not means a duplicate photo and six faces
that will not fit; calling it old when it is not means one tap on Snap. On a
2x2, 1 pair in 499 wants that tap. On a 3x3 and a 4x4, none in 500 did.

A 3x3 had this protection already — `capture()` refuses a face whose centre
sticker matches one it has. The rearm is what covers the 2x2 and the 4x4, which
have no centre sticker and nothing else to go on. That is worth knowing when
testing it: a 3x3 held in front of the camera sits at one photo with the rearm
deliberately deleted, and proves nothing.

### Two things this turned up

- **The live loop never stopped.** The sixth photo closes the scanner from
  inside the loop — `loop → capture → finish → done → close` — so
  `cancelAnimationFrame` was cancelling the frame it was already running, and
  the bottom of the same function scheduled another. The detector kept running
  several times a second, on a stopped video, for the life of the page, on a
  phone. It was silent before auto-capture and showed up as "Turn the cube to a
  face you have not done yet" appearing after the modal had closed. `running`
  is the flag that fixes it, and `scanner-camera.spec.js` checks the loop is
  stopped rather than merely invisible.
- **The flash never plays on the sixth photo**, because the modal is hidden in
  the same tick. Left alone — the scanner vanishing and the map filling in is
  louder feedback than a blink — but the test asserts 5 blinks, not 6, so that
  if the closing is ever delayed it says so.

Note that 2 must stay out of `detectAny`'s size list — a 2x2 lattice fits inside
every larger grid, so it would match anything. The app scans the size that is
selected, which is what makes it safe.

## The 4x4 solver

`js/solver4.js`, tested by `test/solver4.test.js`. Measured over 150 random
cubes: **150 solved and verified, 65-112 moves (median 89, 90th percentile 104),
332-4096ms (median 1153)**. Verification replays the move list on the cube it was
given and looks at the six faces; anything less than solved is thrown away and
the solve refuses.

Four stages, averaging roughly 16 / 44 / 12 / 20 moves:

1. **The colour scheme.** A 4x4 has no fixed centre, so which colour belongs on
   which face is read off the corners: two colours are opposite exactly when no
   corner shows both. Seed it from the corner *at the U-R-F position*, read U,
   R, F. Seeding from any other corner also gives a valid scheme and the centres
   solve to it happily — but it is the cube's own scheme turned a quarter round,
   and no moves can turn a cube's faces into different faces, so nothing
   complains until the 3x3 stage cannot finish.
2. **Centres**, as two meet-in-the-middle searches over a projection of the cube
   — only the stickers that stage cares about, which is what brings an
   impossible space down to a crossable one. U and D must go together: a face
   turn only spins its own centres on the spot, so only slices carry a centre
   between faces, and an x or z slice drags two of U's centre slots with it.
   There is therefore no move set that both moves centres between faces and
   leaves a finished U and D alone. Measured: U+D is ~51M states with diameter
   8, the four side centres ~63M with diameter ~11, so each half of each search
   only reaches depth 4-6.
3. **Edge pairs**, by hill-climbing on how many edges are paired. Two facts make
   it work: outer face turns are free (they keep solid centres solid, and carry
   an edge's pair of wing slots onto another edge's pair, so they never break a
   finished pair), and a slice sandwich — slice out, three outer turns, slice
   back — restores the centres exactly when the inner block turns each side face
   a net whole turn. Setups aim, sandwiches work.
4. **Parity**, the two positions a 3x3 cannot be in. `cube.js`'s validator names
   both exactly ("one edge is flipped in place", "two pieces look swapped"), so
   the case is read off the reduced cube rather than guessed.

### Things worth not rediscovering

- **The projection search cannot pair edges.** A projection is only valid when
  its slots are closed under the moves, and "the centres, the edges already
  paired, and the one being built" is not — a move carries a tracked facelet to
  an untracked one and the search silently returns nonsense. Closing it means
  all 48 edge facelets, and then the goal stops being a single state, which is
  what meet-in-the-middle needs.
- **Climbing always stalls at 10 of 12.** That is the textbook last two edges:
  the pair left over are crossed, and no single sandwich improves on it from any
  setup — every sandwich from every setup was tried. The way out is a two-step
  move whose first half makes things worse, which is what a person does when
  they break a finished pair to rebuild the last two. A fixed list of shakes
  catches the remainder; they are fixed, not random, so a cube that defeats them
  fails the same way twice.
- **The PLL parity algorithm is not the published one.** Published algorithms
  are written with wide turns, and `u` here is a single inner slice, so they do
  not carry across — the usual `r2 U2 r2 u2 r2 u2` wrecks the centres in this
  notation. `u2 R2 F2 u2 F2 R2 u2` came from sweeping every half-turn sequence
  up to seven moves for one that keeps the centres solid, the pairs joined, and
  leaves a cube the validator calls two-pieces-swapped. Twelve exist at seven
  moves.
- **Both parity algorithms preserve the reduction for any cube**, because that
  is a property of the permutation rather than of a particular cube — so
  checking it once on a solved cube settles it. It is checked at load.

## The three-phase solver (js/tpr.js)

A JavaScript port of Shuang Chen’s
[TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver), taken under its
**MIT** option (it is dual GPLv3/MIT). This is what actually solves a 4x4 now;
solver4.js stays as the fallback and is still what the tests drive directly.

Measured over 50 random cubes: **50 solved and verified, 40-47 moves in the
face-turn metric the original quotes (44.39 average), 48-60 single-layer turns,
median 409ms**. Tables build in 670ms, about 22MB.

**Do not port from csTimer.** csTimer is GPLv3-only; taking its 4x4 solver would
put this whole app under the GPL. The TPR repo itself is dual-licensed, which is
why this port came from there.

### What went wrong in the port, so it is not repeated

- **Java's `long` does not survive the trip.** Three routines pack twelve 4-bit
  values into one register; JavaScript's bitwise operators are 32-bit. The author
  wrote 32-bit fallbacks for two of them, and `Edge3.get` needed one writing.
  Every step is forced back through `|0`, because Java int arithmetic wraps and
  JavaScript numbers do not.
- **A labelled break is not a flag on the loop condition.** Rewriting the
  original's `break OUT` as `for (...; cond && !found; i++)` still runs the
  increment on the way out, so `length123` ends one too high and the wrong
  number of moves comes out of `move3`. And when a pass genuinely fails, the
  retry restarts with a deeper limit and never returns — 90 seconds and counting.
- **The reduced cube is not in solver space.** Phases 1-3 work in a symmetry
  frame, so the centres come out solid but carrying whatever colours that frame
  landed on (5,0,4,2,3,1 rather than 0,1,2,3,4,5). kociemba.js needs the centre
  of face f to BE f. Unrelabelled, this produced move lists that reduced the
  cube perfectly — six solid centres, twelve joined pairs — and then finished it
  wrongly, with not one uniform face. That symptom is the signature of this bug.

### Checks that would catch a bad port

The symmetry class counts (15582 and 1538) and the edge pruning table’s exact
population (2,778,197 states within 9 moves) are all published by the original,
and all three are asserted in . They fail loudly if the
symmetry tables or the two-bit packing are wrong, which a move list will not.

## Lessons already paid for — do not relearn these

1. **Never edit source with PowerShell `Get-Content`/`Set-Content`.** It mangles
   UTF-8 and a "repair" pass can destroy every non-ASCII character in a file. Use
   the editing tools, or Node's `fs`.
2. **Compare colours in CIELAB a\*b\* divided by lightness.** Hue-based comparison
   put red and orange 1.06x apart on a real cube — touching — and overlapped
   yellow with green outright.
3. **Do not assume a cube has dark seams.** Stickerless cubes barely have any. A
   face is verified by each cell being *flat in colour*, not by dark gaps.
4. **A 3x3 grid fits inside a 4x4; a 4x4 never fits inside a 3x3.** Hence
   bigger-size-first auto-detection, and a strict 80% match for sizes above 3
   (3x3 keeps 6-of-9 so it tolerates a sticker lost to glare).
5. **Never silently wrong.** Ambiguous gets flagged, impossible gets refused with
   a reason. Handing over confident moves for a cube the user does not own is the
   worst failure this app has. Tests assert this explicitly.
6. **Set test bars from measurement, not hope.** A bar at the measured average
   fails on sampling noise; measure, then leave headroom, and record the real
   figure in a comment.
7. **Real camera frames beat synthetic ones.** `testdata/` (gitignored) holds
   actual frames; `test/realshots.test.js` replays them. Synthetic tests passed
   100% while the scanner did not work on a real cube even once.

## On a phone

This app is used almost entirely on a phone — that is what the Tailscale address
is for — so phone layout is the primary surface, not a fallback. There are two
halves to checking it, and they do not overlap.

```bash
npm run test:mobile       # Playwright, six emulated profiles, ~20s
npm run test:camera       # the scanner end to end, on a fake camera, ~55s
```

Six projects: iPhone SE (375), iPhone 15 (393) and Pixel 7 (412), each portrait
and landscape. The iPhones run on WebKit because that is the engine iOS Safari
is built on; the Pixel runs on Chromium. Per profile it checks that **no screen
has to be scrolled**, that nothing overflows sideways at 2x2, 3x3 or 4x4, that
every control on all three screens clears 44px, that the stickers clear 24px,
that the home screen has not grown anything back onto it, that the scanner fits
on screen with its buttons reachable, and that the header, the scanner and the
solve screen's own top row clear simulated notch and home-indicator insets.
`--project=iphone-se` narrows it to one.

`npm run test:camera` is the other browser suite, and it is the only automated
thing that drives the scanner itself. Chromium will read its webcam from a raw
Y4M file, so `tools/make-cube-video.js` renders six faces of a scrambled cube
being held up to one, and the suite watches getUserMedia, the live loop,
auto-capture, six faces and the assembler do their thing on a 2x2, a 3x3 and a
4x4 — plus one face held up and never turned away, on the two sizes with no
centre sticker, which is the double-capture case. Chromium only: the flag does
not exist in WebKit, so this is the one part that cannot pretend to be an
iPhone. The videos are built into the OS temp directory, about 34MB each.

**Neither is part of `npm test`.** The fifteen-file Node suite must keep running
on a machine with no Playwright and no 300MB browser download, so both go
through `tools/mobile-test.js`, which checks for both and prints the install
command and exits 0 rather than failing. Playwright is a devDependency; the
shipped app is still plain files with no build and no dependencies.

To set it up on a fresh machine:

```bash
npm install --save-dev @playwright/test
npx playwright install webkit chromium
```

**`test/MOBILE-CHECKLIST.md` is the other half**, and it is not optional. There
is no camera, no notch, no touch and no Safari under emulation, so the whole
scanning path — permission, the live green outline, six snaps assembling into a
cube — has never actually run there. Nor has the thing this app is really about:
that the solved cube is turned to match the **last** photo, so the moves suit
how the cube is already being held. That is a claim about how it feels in the
hand and only a person holding a cube can settle it.

### What the phone work changed, measured on a 375px iPhone SE

Stickers and overflow under WebKit, which is what the suite asserts; the
control sizes and the landscape figures under Chromium at 812x375.

| | before | after |
| --- | --- | --- |
| document overflow | 1px (the panel's min-content was 366px in a 355px column) | 0px |
| 2x2 sticker | 37.3px | 78.3px |
| 3x3 sticker | 24.3px | 51.7px |
| 4x4 sticker | 17.1px | 37.6px |
| 4x4 sticker, same phone on its side | 17.1px | 36.2px |
| size buttons | 58x39 | 58x44 |
| colour swatches | 40x44 | 44x44 |
| speed slider | 110x16 | 110x44 |
| notation summary | 329x20 | 329x44 |
| solve view, landscape 812x375 | 1739px of scrolling, transport at y=951 | 786px, transport at y=315 |
| scanner, landscape | card 553px tall in a 375px window, Snap at y=423 | card 320px, Snap at y=95 |

The map no longer scrolls sideways on a phone, because on a phone it is no
longer a cross: below 640px, and in landscape where the column is just as
narrow, the six faces lay out two per row in the order the cross reads. The
cross needs four face-columns side by side, which on a 4x4 is sixteen stickers
across. There were `env(safe-area-inset-*)` in neither the CSS nor the HTML
before this; there are now, and `index.html` asks for `viewport-fit=cover`,
without which iOS reports them all as zero.

### The one-screen rebuild

The page no longer scrolls anywhere. `html, body` are `overflow: hidden` and the
body is a flex column of `100dvh` — `dvh`, because on iOS Safari `100vh` is the
height with the address bar hidden, which is taller than what you can see. Each
screen is a flex column with exactly one row that can give up space: the cube,
or the sticker map.

That has a sharp edge worth knowing about: **anything that does not fit is now
clipped rather than scrolled**, silently. `no screen ever has to be scrolled` in
the mobile suite is the guard, and it measures `scrollHeight` against
`clientHeight`, which still reports the truth through a hidden overflow.

Three screens rather than two:

| Screen | Is |
| --- | --- |
| `#view-setup` | home: a size, a cube, and **Scan my cube**. Nothing else. |
| `#view-edit` | the sticker map, for typing a cube in or fixing one sticker |
| `#view-solve` | one move at a time. The header hides here (`body.solving`) so the cube gets the room, which is why this screen clears the notch with its own top row. |

What changed in the flow, and why:

- **A finished scan solves itself** and lands on move 1. The map-then-press-solve
  step existed because the code had one, not because anyone wanted it. A scan
  that does not assemble still lands on the map, with the reason.
- **No solution style to choose.** `js/solver.js` (layer-by-layer, ~110 moves) is
  no longer loaded by `index.html`; the fast solver is the only one. The module
  and its tests are untouched and still pass on their own.
- **No play, no speed slider.** Stepping is the whole interaction, so Next is the
  big button and everything that existed to serve autoplay is gone.
- **Half turns are split into two quarter turns** — `expandHalfTurns()` in
  `app.js`. A 180° turn has no direction to read and both halves of it happen
  too fast to follow. Move counts therefore read higher than the solver's:
  a 20-move solution is about 31 steps. States that came with a solution (the
  2x2 and 4x4 bring their own) are kept exactly as given at every original move
  boundary; only the new midpoint is derived.
- **`MOVE_MS = 1100`**, up from a default of 440. One quarter turn, slowly.
- **The camera is square on** (`yaw 0, pitch 30`; the inset is `yaw 180, pitch
  -30`) instead of off a corner. Three faces at once is more of the cube but a
  harder picture to match against the thing in your hand.
- **The map is fitted in JS**, not by a media query. `fitNet()` measures the box
  and picks whichever of 2x3 or 3x2 faces gives the bigger sticker. A
  ResizeObserver on the box refits it, because a message appearing underneath
  changes the box as surely as turning the phone does.

Measured on a 375x667 iPhone SE under WebKit, smallest sticker on the map:
54px at 2x2, 31.2px at 3x3, 26px at 4x4 — down from the cross-free two-column
figures above, and that is the trade: fitting a 4x4's 96 stickers into a screen
that also cannot scroll is what costs it. The full six-profile table is in the
header of `test/mobile-layout.spec.js`.

### Guidance — the route round the cube (js/guide.js)

Both ways in walk the same six faces in the same order: front, three turns to
the LEFT, then tip toward you, then tip twice more. A grey cube fills in as
faces arrive and turns the way your hands should; in the scanner it sits under
the camera preview, in the editor beside the face being painted.

The part worth not rediscovering is the bookkeeping. Once the cube has been
turned, the face toward you is not the face it was, and the top of what you see
is not the top of that face — after the last tip the bottom face arrives a
quarter turn round from the way a flat map draws it. Nothing in guide.js
reasons about that case by case. It carries the accumulated whole-cube rotation
as one permutation `W`, where

    currentState[i] = original[W[i]]

so `faceCells()` is `W` applied to the front face, and writing a photo back into
the cube's own frame is the same identity read the other way. `setStep` replays
the route from the start rather than inverting anything, so stepping back cannot
drift.

**Get this wrong and nothing complains.** The colours land in the wrong places
and a different cube from the one in your hands is solved, confidently. That is
what `test/guide.test.js` is for: it turns a numbered cube — every facelet
distinguishable — through the whole route by applying the rotations one at a
time, reads the front face at each step, and checks the six faces rebuild the
original exactly at 2x2, 3x3 and 4x4. The two paths (composed vs. applied
one-by-one) are independent, so it is not circular.

The route is guidance, not a requirement: the centre sticker still says which
face is which and the assembler still tries all rotations, so any order and any
way up comes out right. Someone who ignores the arrows just sees the little cube
paint faces into the wrong slots for a while.

### Everything else this round

- **The solve screen is one cube, fixed.** The back-view inset is gone, dragging
  is off (`draggable: false`), and the orientation banner is gone with it. A
  swipe that quietly rotated the picture away from the cube in your hand was
  worse than not being able to look round.
- **The editor is one face at a time**, on the same route. That took 4x4
  stickers from 26px to about 80px on a 375px phone. It also assumes the
  standard colour scheme, since the first face is named by its centre — the
  "change the centre colours" toggle is gone, and an unusual cube should be
  scanned rather than typed.
- **Voice** (`js/voice.js`) is opt-in, off by default, and is the only thing in
  the app that leaves the device — Safari and Chrome both transcribe on their
  own servers. Two things make a naive version unusable and are worth keeping:
  every command restarts recognition (interim results otherwise re-fire the
  same word as the transcript firms up), and `onend` restarts it for as long as
  the button is lit, because recognition stops on its own constantly.
- **Confetti** (`js/celebrate.js`) is guarded by a `celebrated` flag, because
  `applyIndex()` runs on every step and stepping back and forth over the finish
  would otherwise fire it each time.
- **Two `.row-buttons` in one grid cell** is the layout bug to remember: a rule
  that sets `grid-column` without `grid-row` puts both rows in the same cell,
  where they overlap, look fine, and swallow each other's taps. Playwright
  caught it as "Clear intercepts pointer events" on Next.

### Academy mode

The layer-by-layer solver came back, not as a second answer but as a second
*mode*: the beginner method, taught on the scramble in your hands. The mode is
picked on the home screen before scanning, and switched on the solve screen
without rescanning (`#btn-mode`).

What makes it teaching rather than a longer move list, and therefore what would
be worth noticing if it broke:

- **Seven stages, always seven.** A scramble can arrive with a stage already
  done — the top cross more often than you would think — and the solver then
  emits no group for it. Numbering off the solution says "stage 5 of 6", which
  is a method that does not exist; `stagePlan()` in app.js walks
  `Academy.STAGES` instead and marks a stage with no moves as done.
- **A lesson card before each stage**, held by `introDone` so it appears once
  per stage and again if you jump back to that stage deliberately.
- **The algorithm named, written out, with your place in it.** solver.js now
  tags every last-layer move with the id of the algorithm it came from
  (`macroSearch` does it), academy.js holds the names and notation, and
  `Academy.placeInAlg` works out where in the seven-or-fourteen you are, and
  which repetition. It refuses rather than guesses if the run length is not a
  whole number of repetitions — a strip pointing at the wrong turn is worse
  than a strip pointing at nothing.
- **Cancellation stops at an algorithm.** `cancel()` in solver.js will not fold
  two turns together if either is part of an algorithm. Costs a few moves; buys
  a solution that is the thing it claims to be. Average went 110 → 116.

- **The first three stages are taught a piece at a time.** They place four
  pieces each and the solver now says which — `target` is the face letters of
  the piece's home slot, 'DF' for the bottom-front edge, 'DFR' for the corner
  between them — so the app can say *Piece 2 of 4, the white and red edge*
  instead of showing twenty-five undifferentiated moves. The colours come from
  the cube's own centres, so an unusual scheme names itself correctly.
- **The two middle-layer inserts are algorithms too**, and were being shown as
  loose moves — the first real algorithm anybody learns, unnamed. They are
  `relative: true` in academy.js: the solver turns them to face whichever slot
  is being filled, so the notation printed comes from the moves themselves.
  Printing the textbook "U R U' R' U' F' U F" over a cube doing
  U L U' L' U' B' U B would name the right idea and teach the wrong turns.

`test/academy.test.js` is the guard for the join between the two files: the
stage ids have to match, everything that comes up has to have teaching, every
move of the first three stages has to name its piece, and the highlighted token
has to be the move actually being made.

**Two bugs of the same shape, worth recognising the third time.** A tag added
to a step has to survive every place a step is copied: `cancel()` in solver.js
rebuilds merged steps, and `expandHalfTurns()` in app.js rebuilds all of them
when it splits half turns. Both dropped `target` on the floor, and the symptom
in each case was a stage that looked like it had simply never been tagged.

**And the one that mattered most.** Academy shipped drawing the cube in the
wrong colours. The 2x2 and 4x4 solvers work on the colours, so their states are
the cube as it will look; the beginner solver works in solver space, where a
facelet holds a face *number*. Handing those to the renderer recolours every
sticker on the cube and still looks like a perfectly plausible scramble — what
gave it away was Academy describing a piece as "the blue and green edge" on a
cube whose bottom is yellow. `expandHalfTurns` now checks a solver's states
against the cube it was handed and works them out from the moves if they
disagree, which is what the fast solver has always done. The mobile suite
samples the front centre pixel against the stored cube, because a picture that
is wrong in a consistent way is not one anybody notices.

### The audit, and what it found

- **The render loop never stopped.** `stop()` cancelled the current frame id —
  which had already fired — and the bottom of `loop()` scheduled another
  unconditionally. Exactly the bug that once kept the scanner's detector
  running on a stopped video, in a different file. Five views, one screen
  visible, all five drawing: measured 480 ticks in two seconds, 120 after.
  Views now also stop when an IntersectionObserver says nobody can see them,
  and `getBoundingClientRect` is cached rather than called per frame per view.
- **The waiting arrow's pulse cost a full redraw at 60fps** on the screen the
  app spends nearly all its time on. Throttled to 25fps: 120 draws per two
  seconds became 40, and it looks identical.
- **`Kociemba.prepare` could run twice at once** now that the app warms the
  tables while the page is idle. A build in flight collects later callers
  instead of starting a second one.
- **The 4x4 solver is fetched on demand.** 98KB of parse that a 3x3 never used.
- **Automated runs were filing diagnostic frames.** `reportMiss` posts frames
  the detector could not read to `testdata/`, which is the corpus
  `realshots.test.js` measures against — three synthetic frames from one
  afternoon of Playwright runs dropped it from 8/10 to 8/13, which reads as a
  regression in a detector nobody had touched. It now refuses when
  `navigator.webdriver` is set.
- **`autosnap.test.js` was flaky about one run in six**, two different ways.
  Both were the same cause: a "p99" of 45 samples is the maximum wearing a
  percentile's clothes, and asserting on the maximum is what the percentiles
  were introduced to stop. `at()` now caps the quantile at whatever leaves
  three samples above it and prints which percentile it really used. The 2x2
  "two faces in a row" check also got the 10% allowance its sibling already
  had, for the documented reason: four stickers is the least a face can be told
  apart by, and the measured worst pair sits at 12 against a bar of 10.
- **Keyboard focus was invisible** — the button styling removed the default
  ring and nothing put one back. `:focus-visible` does now.
- **Two `.row-buttons` in one grid cell** overlapped and ate each other's taps.

### Offline, and the home screen

`sw.js` is network-first, cache-fallback. Cache-first is the usual advice and
is a trap for something published this often: it is how people end up looking
at yesterday's version and being told their change did not land. Bump `VERSION`
when the file list changes.

`manifest.webmanifest` + `icon.svg` + the two PNGs make it installable. iOS
will not use an SVG for a home-screen icon and Chrome wants a raster in the
manifest, so `node tools/make-icons.js` rasterises the SVG with the WebKit that
is already installed for the mobile tests. The icons are committed; that script
is not part of any suite.

Also new and small: the screen is kept awake while solving (`navigator.wakeLock`,
released on leaving the solve screen), and a 12ms buzz marks a move landing
where the hardware has one — Android does, iOS Safari has never supported the
Vibration API and ignores it.

## Commands

```bash
npm test                  # full suite
npm run test:mobile       # phone layout, six emulated profiles (needs Playwright)
npm run test:camera       # the scanner end to end, on a fake camera (needs Playwright)
node tools/serve.js       # local server on :8123, what Tailscale fronts
node tools/diagnose.js    # replay scan frames the detector failed on
```

Failed scans write themselves to `testdata/` automatically, with a `.marked.png`
showing what the detector actually saw.
