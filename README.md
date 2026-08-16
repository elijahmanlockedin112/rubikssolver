# Rubik's Cube Coach

*A fun weekend project for a Rubik's cube solver.*

Tell it what your cube looks like, and it shows you — in 3D, one turn at a time —
exactly how to solve it. No notation to learn: every step is an animated cube
with an arrow on the layer you turn.

**▶ Try it: https://elijahmanlockedin112.github.io/rubikssolver/**

Runs entirely in the browser. No build step, no dependencies, no server, no
accounts, no API keys, no network. Open `index.html` and it works, offline, forever.

## Using it

1. Open the [live version](https://elijahmanlockedin112.github.io/rubikssolver/),
   or `index.html` from a copy of this repo. On a phone, use the live version —
   browsers only hand over the camera on an https:// address. Add it to your
   home screen and it opens without browser chrome and works with no signal.
   Then pick what you want out of it: **⚡ Solve it** or **🎓 Teach me**.
2. Pick your cube's size and press **Scan my cube**. Two cubes appear: what the
   camera sees, and the cube being built from it. Show it a face — it takes the
   photo itself — and the second cube paints that face in, holds it long enough
   for you to check it against the one in your hand, then **turns to show you
   which way to turn yours**. Three turns to the left, then two tips, and it
   has all six. Best with the cube standing on a flat surface in even light.
3. That is the whole flow. The scan feeds straight into the solver and you land
   on the first move — there is nothing to confirm and no solution style to
   choose. Press **Next** for each turn (← → and space work too), or turn on
   the microphone and just say "next".

If the cube in your hand stops matching the one on screen, **Not solved? Start
over** goes back to the camera.

If you would rather type the colours in, *Type the colours in instead* walks
the same six-face route with a palette instead of a camera — one face at a
time, with the same cube beside it saying which face you are on.

## Academy mode

**🎓 Teach me** solves the cube the way a person does, on the scramble you
actually have, and tells you what it is doing:

- **Seven stages, always seven** — bottom cross, bottom corners, middle layer,
  top cross, top face, place the corners, last edges. A stage your cube arrives
  with already done is shown as done rather than quietly dropped, because the
  method has seven stages whether or not this particular cube needs them all.
- **A lesson before each stage**: what you are trying to end up with, and —
  the part every tutorial skips fastest — *what to look for on your own cube*
  to spot the case you are in. Recognition is the thing that does not come from
  following arrows.
- **The algorithms by name**: Sune, Anti-Sune, the T-perm, the U-perm, the
  corner three-cycle. Written out in notation with the turn you are on picked
  out, and repeated for as many rounds as your cube needs. They are named
  because they are named everywhere else — someone who learns "Sune" here can
  ask about it anywhere.
- You can jump between stages, switch to the short solution on the same cube
  without rescanning, and switch back.

It is about 110 moves against the fast solver's 20, and that is the trade: the
short answer is unlearnable — its moves are not reasons — and the method is not
short. `test/academy.test.js` checks the notation being shown is always the
move actually being made, which is the one way this could teach the wrong
thing convincingly.

Academy is a 3×3 method. A 2×2 or a 4×4 gets the direct solution and is told
why.

Keep the cube in the same orientation the whole way through. After a scan there
is nothing to line up at all: the cube on screen has been turned to match your
last photo, so however you are already holding it is right.

The whole app is built for a phone held in one hand with a cube in the other:
three screens, each exactly one window tall, none of which ever scrolls. The
cube is drawn square on and cannot be dragged — one accidental swipe and the
picture no longer matches what you are holding. Every half turn is shown as two
separate quarter turns, slowly, because a 180° spin has no direction to read.

## Hosting it

The whole app is static files, and every path in it is relative, so it drops
onto GitHub Pages as-is: *Settings → Pages → deploy from `main`, folder `/ (root)`*.
That is what the link at the top is.

There is no backend, no API key and no account to sign up for. Everything —
solving, scanning, reading the colors — happens in the browser.

`sw.js` keeps a copy so the app runs with no signal at all. It is **network
first**, deliberately the slower way round: for something published several
times a day, a cache-first service worker is how people end up looking at
yesterday's version and being told their own change did not land. Bump
`VERSION` in it when the file list changes.

`js/tpr.js` and `js/solver4.js` — 98KB of 4×4 solver between them — are not in
the page. They are fetched the first time a 4×4 is actually solved, so a 3×3
never pays for them.

## Testing changes on your phone (Tailscale)

Handy while working on it: rather than pushing to see a change on a phone,
Tailscale Serve gives this machine a real HTTPS certificate on your tailnet,
reachable from any device signed into the same account — and **not** from the
public internet.

Double-click `tools/phone.cmd`, or run it by hand:

```bash
npm start
tailscale serve --bg 8123
```

Then open the `https://<machine>.<tailnet>.ts.net` address it prints on your
phone, with Tailscale connected there. The Serve config survives reboots; the
little Node server does not, so re-run the script (or `npm start`) after a
restart.

To stop sharing:

```bash
tailscale serve --https=443 off
```

## Scanning

Point a face at the camera and press Snap, six times. **Any order, any way up.**
A green outline shows when it has found the face. Reading happens on the device
in about 50 milliseconds for the whole cube — nothing is uploaded.

Three things make the loose framing possible:

**Finding the face.** `js/detect.js` segments the frame into blobs, then uses
the grid arrangement itself as the signature: nine similarly-sized square-ish
blobs sitting in a 3×3 lattice is a cube face, and almost nothing else in a room
is. It guesses a lattice from a pair of blobs and counts how many others land
where that lattice predicts, so one stray blob from the background cannot invent
a grid. A final check that the seams between stickers are darker than the
stickers is what stops a patterned rug from passing as a cube.

**Naming the colours.** Nothing is compared against a hardcoded RGB value — red
versus orange under a warm lamp is where that always fails. The six centre
stickers become the reference swatches, every other sticker is matched against
*those*, and a quota forces exactly nine of each colour. Brightness is ignored
entirely, since each face is shot under its own light.

**Working out which face is which, and which way up.** The centre sticker never
moves, so it names the face — photograph them in any order. For rotation, all
4⁶ = 4096 combinations are tried and the one that assembles into a *physically
possible cube* wins. Validity is an extremely tight filter: every one of the
twelve edges and eight corners has to be a real piece, appearing exactly once,
with the corner twists and edge flips adding up. Usually exactly one combination
survives; when more than one does, the app says so rather than guessing quietly.

## What's inside

| File | What it does |
| --- | --- |
| `js/cube.js` | Cube state: 54 facelets, the six moves as permutations, and a validator that explains *why* an impossible cube is impossible. |
| `js/kociemba.js` | Two-phase solver. Builds ~4 MB of move and pruning tables, then runs two IDA\* searches. Typically 20 moves in ~250 ms. |
| `js/solver.js` | Layer-by-layer beginner solver: bottom cross, bottom corners, middle edges, top cross, top face, place corners, last edges. Every move it emits is tagged with the stage it belongs to and, on the last layer, the algorithm it came out of — which is what Academy mode is built on. |
| `js/academy.js` | The teaching half: what each stage is for, what to look for to spot it, and the six algorithms under the names they go by everywhere else. |
| `js/render.js` | A small software 3D renderer on a 2D canvas — 27 cubies, painter's algorithm, backface culling, animated layer turns and curved direction arrows. No WebGL, no libraries. |
| `js/detect.js` | Finds the 3×3 grid in a photo: blob segmentation, a RANSAC-style lattice search, and a check that the seams are darker than the stickers. Runs in a few milliseconds, so it also drives the live outline. |
| `js/assemble.js` | Names the colors against the six centres with a nine-per-color quota, then fits six unordered, arbitrarily-rotated faces into one cube by finding the arrangement that is physically possible. |
| `js/scan.js` | Camera scanning: six snaps, any order, any way up, read on the device — with the cube being built shown beside the camera. |
| `js/guide.js` | The route round the cube — three turns left, two tips — and the one permutation that keeps track of which face you are looking at and which way up, so a photo (or a painted sticker) lands where it belongs. Shared by the scanner and the editor. |
| `js/celebrate.js` | Confetti. Canvas, no images, puts itself away, and drops to a slow drift under `prefers-reduced-motion`. |
| `js/voice.js` | "Next", out loud, via the Web Speech API. Off until asked for — it is the only thing here that leaves the device. |
| `tools/serve.js` | Static file server for testing on a phone, plus an endpoint that saves a frame the detector could not read. No API key, nothing leaves the machine. |
| `js/app.js` | The editor, the validation messages, and the step player. |

### How the fast solver works

Phase 1 searches for a sequence that lands the cube in the subgroup
`⟨U, D, R2, L2, F2, B2⟩` — every piece correctly oriented and the four middle
edges back in the middle slice. Phase 2 finishes inside that subgroup, where
only ten moves are legal. Both phases are IDA\* over coordinate move tables
with pruning tables giving a lower bound on the moves remaining.

Rather than accepting the first answer, the search keeps feeding it better
phase-1 sequences and keeps the shortest total it finds within its time budget.
Result: about 20 moves on average, 22 at worst over thousands of scrambles.

### Unused, on purpose

An earlier version cross-checked the two readers and flagged every sticker they
disagreed about. That was dropped: the old reader sampled nine fixed patches
from a fixed square, so unless the cube was square-on it disagreed constantly,
and checking a reliable reader against an unreliable one produces noise rather
than signal.

## Tests

```bash
npm test
```

Or a single suite with a bigger sample:

```bash
node test/solver.test.js 1000
```

- `test/kociemba.test.js` — cubie algebra against the facelet engine,
  coordinate round-trips, then solves random scrambles and checks each result.
- `test/solver.test.js` — move engine identities, the properties each
  beginner-method algorithm is relied on for, the validator, and full solves.
- `test/detect.test.js` — paints synthetic photos of a face (rotated,
  off-centre, any size, random backgrounds, uneven light) and checks the grid is
  located to within a few percent of a cell, that a plain wall and an empty
  frame are refused, and that six photos run straight through to a finished cube.
- `test/assemble.test.js` — photographs cubes in random face order at random
  rotations under awkward light and checks the cube comes back exactly. Also
  checks the failure modes: a face shot twice, a misread sticker, and the rare
  case where the photos fit together two different ways, which must be flagged
  rather than returned quietly.
- `test/scan.test.js` — feeds the classifier synthetic camera samples under
  tinted, uneven, noisy light and checks the cube comes back intact.
- `test/guide.test.js` — turns a cube through the whole guided route and checks
  the six faces read off it rebuild the original exactly, at every size. Get
  this wrong and nothing complains: the colours simply land in the wrong
  places, and a different cube from yours gets solved, confidently.
- `test/academy.test.js` — solves real scrambles and checks every stage and
  algorithm that comes up has teaching attached, and that the move highlighted
  in the notation strip is the move actually being made. A strip that says
  `R U R' U R U2 R'` while the cube does something else teaches the wrong
  thing, confidently, which is worse than no strip.

## Notes and limits

- The camera needs a secure context. Browsers usually allow it for a file
  opened directly, but if yours refuses, serve the folder over `http://localhost`
  and it will work.
- The 3×3 solution is near-optimal, not proven optimal. God's number is 20;
  a proven-optimal solver needs vastly larger tables and far more time for the
  last move or two. The move count you see is higher than that, because every
  half turn is counted — and shown — as two quarter turns.
- 2×2, 3×3 and 4×4. A 5×5 has the model and the renderer but no solver.
- **Voice is the one thing that is not local.** Safari and Chrome both send the
  audio to their own servers to transcribe it. That is why it is off until you
  press the microphone, and why nothing else in the app needs a network.
- Typing a cube in by hand assumes the standard colour scheme — white opposite
  yellow, green opposite blue, red opposite orange — because the guided route
  names the first face by its centre. Scanning has no such assumption: it reads
  whatever centres it finds, so an unusual cube should be scanned, not typed.

## License

**All rights reserved.** The code is public to read, not to reuse — no copying,
modifying, redistributing or building on it without written permission. See
[LICENSE](LICENSE).
