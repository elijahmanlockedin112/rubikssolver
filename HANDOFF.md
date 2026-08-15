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

**4x4 — complete.** Model, grid detection, colour reading, face
identification, the 96-sticker map and the 3D view all work; scanning a 4x4 lands
correctly on the map, and solving works.

The solver is done and tested — see "The 4x4 solver" below.

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

### If a shorter solution is wanted

[TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver) averages 44.39
moves against this solver's 89, so it is worth roughly half the moves. Two
things to know before starting:

- It is **Java**, 15 source files of table-heavy code, and it leans on min2phase
  for the final 3x3 — which this repo already has in `kociemba.js`. So the port
  is the reduction half: Center1/2/3, Edge3, the cube classes and the search.
- It is dual-licensed **GPLv3 and MIT**, so the MIT half is compatible with this
  repo being all rights reserved. **csTimer's JavaScript port is not** — csTimer
  is GPLv3 only, and taking its 4x4 solver would put this whole app under the
  GPL. Port from the TPR repo under MIT, not from csTimer.

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
