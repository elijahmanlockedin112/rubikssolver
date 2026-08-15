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

## Scanning with Gemini (optional)

The built-in color reader is fussy: it samples nine fixed patches out of a fixed
square, so the cube has to be square-on and filling the frame. Handing the
photos to a vision model removes that constraint.

```bash
cp .env.example .env      # then paste your key into GEMINI_API_KEY
npm start
```

The key is read by the server process only — it is never sent to the browser,
and `.env` is gitignored. Leave `GEMINI_MODEL` blank and the server asks the API
which models exist and picks a current vision-capable one, so nothing here
breaks when model names change. With no key present, `/api/scan` returns 501 and
the app silently uses the built-in reader instead.

Point the face at the camera and press the button — angle, distance and framing
are all loose, because the reader on the other end can find the cube in the
photo. All six photos go up in a single request, so the model can compare colors
across faces rather than judging each in isolation, which is exactly what
red-versus-orange needs.

- `Cube.validate()` decides whether the answer is a physically possible cube. If
  it isn't, the specific complaint ("that is not a physically possible cube:
  one edge is flipped in place") goes back to the model and it tries again,
  twice at most.
- Whatever the model itself flags as uncertain gets outlined on the map.
- The newest model is also the busiest, so a "high demand" failure is retried
  and then falls back to the next model down the ranking.

The built-in classifier is **only** a fallback for when the server or the API is
unreachable. It is not used as a second opinion, because it samples nine fixed
patches from the middle of the frame — so unless the face happens to be square-on
it disagrees constantly, and cross-checking a reliable reader against an
unreliable one produces noise, not signal.

## What's inside

| File | What it does |
| --- | --- |
| `js/cube.js` | Cube state: 54 facelets, the six moves as permutations, and a validator that explains *why* an impossible cube is impossible. |
| `js/kociemba.js` | Two-phase solver. Builds ~4 MB of move and pruning tables, then runs two IDA\* searches. Typically 20 moves in ~250 ms. |
| `js/solver.js` | Layer-by-layer beginner solver: bottom cross, bottom corners, middle edges, top cross, top face, place corners, last edges. |
| `js/render.js` | A small software 3D renderer on a 2D canvas — 27 cubies, painter's algorithm, backface culling, animated layer turns and curved direction arrows. No WebGL, no libraries. |
| `js/scan.js` | Camera scanning. Six guided captures with auto-capture once the cube is held still, then the photos go to both readers. |
| `tools/gemini.js` | Prompt, response parsing, cube validation and model selection for the Gemini reader. Deliberately I/O-free so it can be tested without a key. |
| `tools/serve.js` | Static server plus `POST /api/scan` — the only place the API key exists. |
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
- `test/gemini.test.js` — fabricated model responses through the real parse,
  validate and model-selection paths. No key, no network.
- `test/gemini-live.test.js` — renders six synthetic photos of a known cube,
  sends them through the real endpoint, and checks all 54 stickers come back
  right. Proves prompt, face order and sticker order line up end to end.
  Skips itself when the server is down or has no key; costs one API call.
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
