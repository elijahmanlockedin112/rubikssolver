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

**4x4 — everything except solving.** Model, grid detection, colour reading, face
identification, the 96-sticker map and the 3D view all work; scanning a 4x4 lands
correctly on the map. Pressing solve refuses with an explanation.

Of the solver itself, the colour scheme and the centres are done and tested
(`js/solver4.js`, `test/solver4.test.js`); edge pairing is not. `Solver4.solve()`
refuses and says how far it got. See "Where the 4x4 solver actually is" below.

| File | Does |
| --- | --- |
| `js/cube.js` | 3x3: 54 facelets, six moves as permutations, validator that explains *why* a cube is impossible |
| `js/cuben.js` | any size: move tables derived from geometry, piece grouping, whole-cube rotations |
| `js/kociemba.js` | two-phase 3x3 solver |
| `js/solver.js` | layer-by-layer 3x3 solver |
| `js/detect.js` | finds an NxN grid in a photo; auto-detects size |
| `js/assemble.js` | colour naming, and 3x3 face assembly |
| `js/assemble4.js` | 4x4 face identification from cube structure |
| `js/repair.js` | fixes an obviously-wrong cube, refuses ambiguous ones |
| `js/render.js` | software 3D on a 2D canvas, any size |
| `js/scan.js`, `js/app.js` | scanner and UI |

## The remaining job: a 4x4 solver

Reduction method:

1. **Pair the centres** — four matching centre pieces per face.
2. **Pair the edges** — 24 wings into 12 matched pairs.
3. **Solve it as a 3x3** — `solver.js` or `kociemba.js` already exist; outer-layer
   moves map straight across.
4. **Parity** — OLL parity (one edge pair flipped) and PLL parity (two pairs
   swapped) cannot happen on a 3x3 and need their own algorithms.

Expect ~70-120 moves. There is no practical optimal 4x4 solver, so "fewest moves"
does not apply at this size.

## Where the 4x4 solver actually is

`js/solver4.js`. Done and under test:

- **The colour scheme.** A 4x4 has no fixed centre, so which colour belongs on
  which face has to be read off the corners: two colours are opposite exactly
  when no corner shows both. Seed it from the corner *at the U-R-F position*,
  read U, R, F. Seeding from any other corner also gives a valid scheme and the
  centres will happily solve to it — but it is the cube's own scheme turned a
  quarter round, and no moves can turn a cube's faces into different faces, so
  nothing complains until the 3x3 stage cannot finish.
- **The centres.** Measured over 60 random cubes: solved 60/60, 14-20 moves
  (median 17), 21-941ms (median 172).

Both centre stages are meet-in-the-middle searches over a *projection* — only the
stickers that stage cares about. Measured sizes: U+D together is ~51M states with
diameter 8; the four side centres are ~63M with diameter ~11. Each half of the
search therefore only reaches depth 4-6, a few hundred thousand states.

U and D have to be solved **together**. A face turn only spins its own centres on
the spot, so only slices move a centre between faces, and an x- or z-axis slice
drags two of U's centre slots with it. So no move set both moves centres between
faces and leaves a finished U and D alone — the last two opposite faces can never
be done one after the other.

### Edge pairing — not built, and what is already known

Do not re-derive these; each was measured in the model.

- **Outer face turns are free.** They keep solid centres solid, and they map an
  edge's pair of wing slots onto another edge's pair, so they can never break a
  pair already made. Every setup move can be one.
- **Only a slice can make a new pair**, and a slice alone wrecks the centres. A
  sandwich `s A s'` restores them exactly when `A` turns each side face a net
  whole turn — which is why `u' R U R' F R' F' R u` is centre-safe (R: +1-1-1+1,
  F: +1-1) and `u R2 u'` is not.
- **Searching for the pairs the way the centres were searched does not work.** A
  projection is only valid when its slots are closed under the moves, and
  "the centres, the edges already paired, and the one being built" is not: a move
  carries a tracked facelet to an untracked one, and the search silently returns
  nonsense. Closing it means all 48 edge facelets, and then the goal stops being
  a single state — exactly what meet-in-the-middle needs. Pairing must be done by
  algorithm, not by search.
- **A usable algorithm exists.** `U2 r l' U2 l r'` keeps the centres solid, moves
  no corner at all, and disturbs only six wings. Found by sweeping all 1116x1116
  commutators [A,B] with A and B up to two moves; nothing in that family touches
  fewer than six wings.

What is left is the textbook method's bookkeeping: keeping finished pairs out of
the slice being worked, and the last few edges, which need their own case. Then
the 3x3 handoff and the two parity algorithms.

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

## Commands

```bash
npm test                  # full suite
node tools/serve.js       # local server on :8123, what Tailscale fronts
node tools/diagnose.js    # replay scan frames the detector failed on
```

Failed scans write themselves to `testdata/` automatically, with a `.marked.png`
showing what the detector actually saw.
