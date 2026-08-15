# Rubik's Cube Coach

Tell it what your cube looks like, and it shows you — in 3D, one turn at a time —
exactly how to solve it. No notation to learn: every step is an animated cube
with an arrow on the layer you turn.

Runs entirely in the browser. No build step, no dependencies, no server, no
network. Open `index.html` and it works, offline, forever.

## Using it

1. Open `index.html` in a browser.
2. Enter your cube's colors — either **scan them with your camera** (six snaps)
   or click them onto the flat map / the 3D cube.
3. Pick a solution style:
   - **Fewest moves** — around 20 moves, found by a two-phase search.
   - **Teach me** — around 110 moves in seven named stages you could learn.
4. Hit solve and follow the pictures. Space plays and pauses, ← → step.

Keep the cube in the same orientation the whole way through — the banner at the
top of the solve screen reminds you which color goes up and which faces you.

## On your phone (Tailscale)

Scanning really wants a phone's rear camera, and phone browsers only allow
camera access over HTTPS. Tailscale Serve solves both: it gives the machine a
real HTTPS certificate on your tailnet, reachable from any device signed into
the same account — and **not** from the public internet.

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

## What's inside

| File | What it does |
| --- | --- |
| `js/cube.js` | Cube state: 54 facelets, the six moves as permutations, and a validator that explains *why* an impossible cube is impossible. |
| `js/kociemba.js` | Two-phase solver. Builds ~4 MB of move and pruning tables, then runs two IDA\* searches. Typically 20 moves in ~250 ms. |
| `js/solver.js` | Layer-by-layer beginner solver: bottom cross, bottom corners, middle edges, top cross, top face, place corners, last edges. |
| `js/render.js` | A small software 3D renderer on a 2D canvas — 27 cubies, painter's algorithm, backface culling, animated layer turns and curved direction arrows. No WebGL, no libraries. |
| `js/scan.js` | Webcam scanning. Six guided captures, then each sticker is matched against the six center stickers with a nine-per-color quota. |
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

### How the scanner decides what's red

Fixed RGB thresholds fall apart under a warm lamp, and red versus orange is the
classic failure. So nothing is compared against a hardcoded color: the six
center stickers are the reference swatches, every other sticker is matched
against *those*, and a quota forces exactly nine of each color. Brightness is
ignored entirely (each face is shot under its own light); only hue and
saturation are compared. Whatever it still gets wrong is one click to fix on
the map.

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
- `test/scan.test.js` — feeds the classifier synthetic camera samples under
  tinted, uneven, noisy light and checks the cube comes back intact.

## Notes and limits

- The camera needs a secure context. Browsers usually allow it for a file
  opened directly, but if yours refuses, serve the folder over `http://localhost`
  and it will work.
- "Fewest moves" is near-optimal, not proven optimal. God's number is 20;
  a proven-optimal solver needs vastly larger tables and far more time for the
  last move or two.
- 3×3×3 only.

## License

MIT — see [LICENSE](LICENSE).
