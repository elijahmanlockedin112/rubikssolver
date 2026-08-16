/*
 * academy.js — what the layer-by-layer solution is actually teaching.
 *
 * solver.js produces the moves and tags which algorithm each one came from.
 * This is the other half: what each stage is *for*, what to look for on your
 * own cube to spot it, and the names the six algorithms go by everywhere else,
 * so what is learned here is transferable rather than local to this app.
 *
 * The wording is aimed at someone who has never solved a cube. Two rules it
 * tries to keep:
 *
 *   - Say what to look for before saying what to do. Recognition is the part
 *     that does not come from following arrows, and it is the part every
 *     tutorial skips fastest.
 *   - Never say "just". The whole point is that none of it is obvious yet.
 *
 * The stage ids match solver.js's STAGES exactly; the algorithm ids match the
 * tags macroSearch attaches. Both are asserted in test/academy.test.js, because
 * a rename on either side would otherwise show up as a silently blank panel.
 */
;(function (root) {
  'use strict';

  var STAGES = [
    {
      id: 'cross',
      title: 'The bottom cross',
      goal: 'A plus sign on the bottom face, with each arm matching the centre next to it.',
      look: 'Find the four edge pieces that carry the bottom colour — an edge is a piece with two ' +
        'stickers. Each one has a second colour, and that colour has to end up on the face whose ' +
        'centre matches it. Matching both is the whole job.',
      why: 'This is the only stage with no algorithm, and that is deliberate: four pieces, each ' +
        'placed by looking at where it is and turning it down. Slow at first, and the stage that ' +
        'stops feeling like work soonest.'
    },
    {
      id: 'corners',
      title: 'The bottom corners',
      goal: 'The whole bottom layer finished — the cross plus four corners, and a matching band ' +
        'of colour all the way round the bottom of the sides.',
      look: 'A corner has three stickers. Find one carrying the bottom colour, park it directly ' +
        'above the gap it belongs in, and bring it down. If it is already in the right place but ' +
        'twisted the wrong way, take it out first and put it back.',
      why: 'Everything after this is done without ever disturbing what is underneath. That is the ' +
        'idea the whole method rests on: each stage protects the last.'
    },
    {
      id: 'middle',
      title: 'The middle layer',
      goal: 'Two full layers. The bottom is untouched and the middle band of every side matches ' +
        'its centre.',
      look: 'Four edges to place, and none of them carry the top colour — that is how you spot ' +
        'them. Line one up with the centre it matches on a side face, then send it left or right ' +
        'into the gap.',
      why: 'The insert is your first proper algorithm: a sequence that takes a piece out of the ' +
        'top, puts it in the middle, and repairs the corner it borrowed on the way past.'
    },
    {
      id: 'topcross',
      title: 'The top cross',
      goal: 'A plus sign on the top face. Only the top colour matters here — the sides of those ' +
        'edges can be anything.',
      look: 'Look at the top face and count the top-coloured edges: a dot, an L shape, a straight ' +
        'line, or the cross. The algorithm takes you a step along that chain each time you run it, ' +
        'so it may take two or three goes.',
      why: 'Orientation before position. Getting pieces facing the right way and getting them in ' +
        'the right place are two separate problems, and doing them at once is what makes the last ' +
        'layer feel impossible.'
    },
    {
      id: 'topface',
      title: 'The whole top face',
      goal: 'The top face a single solid colour. The sides will look scrambled, and that is fine.',
      look: 'Count the corners already showing the top colour: none, one, two, or all four. Hold ' +
        'the cube as the algorithm asks, run it, and count again. It is the same one or two ' +
        'sequences repeated.',
      why: 'This one looks like it is destroying the cube half way through and then puts it back. ' +
        'That is normal, and trusting it is most of the skill.'
    },
    {
      id: 'topcorners',
      title: 'Putting the corners home',
      goal: 'The four top corners in the right places — each one between the two centres whose ' +
        'colours it carries. They may still be twisted; that is the next stage.',
      look: 'A corner is in the right place if its three colours match the three faces it touches, ' +
        'in any order. Find one that is already right and hold the cube with it at the back, then ' +
        'cycle the other three.',
      why: 'Position before the last details. From here every remaining move only shuffles pieces ' +
        'that are already facing the right way.'
    },
    {
      id: 'topedges',
      title: 'The last four edges',
      goal: 'A solved cube.',
      look: 'Three edges to cycle round, and often a face that already matches — hold that one at ' +
        'the back. If nothing matches, run the algorithm once anyway and something will.',
      why: 'The last stage is one algorithm, run once or twice. Everyone gets here and thinks they ' +
        'have broken it; run it again and the cube finishes.'
    }
  ];

  /*
   * The six algorithms, under the names they go by elsewhere.
   *
   * Named on purpose. "Sune" and "T-perm" are what every other tutorial, every
   * video and every cuber calls these, so someone who learns them here can ask
   * about them anywhere. An app-local name would be a dead end.
   */
  var ALGS = {
    /*
     * The two middle-layer inserts, which are the first real algorithms anyone
     * learns and were being shown as anonymous free moves until this was
     * written down. They are `relative`: the solver turns them to face
     * whichever slot is being filled, so the notation on screen has to come
     * from the moves actually being made rather than from the string here.
     * The string is the shape they are taught in, and is what the reason below
     * refers to.
     */
    rightinsert: {
      name: 'Right-hand insert',
      nick: 'the right insert',
      notation: "U R U' R' U' F' U F",
      relative: true,
      why: 'Sends the edge from the top layer into the slot on the RIGHT of the face you are ' +
        'looking at. The first half lifts a corner out of the way; the second half puts it back ' +
        'with the edge underneath it.'
    },
    leftinsert: {
      name: 'Left-hand insert',
      nick: 'the left insert',
      notation: "U' L' U L U F U' F'",
      relative: true,
      why: 'The same thing mirrored, for the slot on the LEFT. Every move is the opposite hand ' +
        'and the opposite direction — learn one and you have both.'
    },

    fruruf: {
      // named for what it does, because its usual name *is* its notation and
      // the strip is already showing that a line below
      name: 'The top-cross algorithm',
      nick: 'F R U R′ U′ F′',
      notation: "F R U R' U' F'",
      why: 'Flips the top edges without touching the two layers underneath. Run it once from a ' +
        'dot, twice from an L or a line — the shape tells you how many.'
    },
    sune: {
      name: 'Sune',
      nick: 'Sune',
      notation: "R U R' U R U2 R'",
      why: 'Twists three top corners at once. The most-used seven moves in the whole method — ' +
        'everybody learns this one first and keeps it forever.'
    },
    antisune: {
      name: 'Anti-Sune',
      nick: 'Anti-Sune',
      notation: "R U2 R' U' R U' R'",
      why: 'Sune the other way round. Which one you need depends on which way the corners are ' +
        'twisted, and running the wrong one costs you a repeat rather than the cube.'
    },
    niklas: {
      name: 'Niklas',
      nick: 'the corner three-cycle',
      notation: "U R U' L' U R' U' L",
      why: 'Rotates three corners between places and leaves everything else exactly as it was. ' +
        'Short, and much easier to remember than it looks — it is the same four moves mirrored.'
    },
    tperm: {
      name: 'T-perm',
      nick: 'the T-perm',
      notation: "R U R' U' R' F R2 U' R' U' R U R' F'",
      why: 'Swaps two corners and two edges. It comes out when the corners need an odd swap, ' +
        'which no three-cycle can do; the edges it disturbs get tidied in the last stage.'
    },
    uperm: {
      name: 'U-perm',
      nick: 'the edge three-cycle',
      notation: "R U' R U R U R U' R' U' R2",
      why: 'Cycles three top edges and touches nothing else. The last algorithm in the method, ' +
        'and often the only one the cube still needs.'
    }
  };

  function stage(id) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i];
    return null;
  }

  function alg(id) { return (id && ALGS[id]) || null; }

  /**
   * Where you are in the algorithm you are running.
   *
   * Steps that came out of an algorithm are tagged with its id, and the same
   * algorithm run twice in a row is one unbroken run of tags — so the position
   * within a single repetition is the offset into the run, modulo the length
   * of the algorithm itself.
   *
   * If those do not divide evenly something upstream has changed the moves, so
   * this says so rather than highlighting the wrong turn: a notation strip
   * pointing at the wrong move is worse than one pointing at nothing.
   */
  function placeInAlg(steps, index) {
    var here = steps[index];
    if (!here || !here.alg) return null;
    var info = alg(here.alg);
    if (!info) return null;
    var start = index;
    while (start > 0 && steps[start - 1].alg === here.alg) start--;
    var end = index;
    while (end < steps.length - 1 && steps[end + 1].alg === here.alg) end++;

    var length = info.notation.split(/\s+/).length;
    var runLength = end - start + 1;
    var offset = index - start;
    if (runLength % length !== 0) return { alg: info, tokens: [], at: -1, round: 0, rounds: 0 };

    var at = offset % length;
    var round = Math.floor(offset / length);
    /*
     * What to print. A fixed algorithm prints the notation it is known by; a
     * relative one has been turned to face the slot being filled, so its own
     * moves are the only honest thing to show — "U R U' R' U' F' U F" above a
     * cube doing U L U' L' U' B' U B would be teaching the wrong turns while
     * naming the right idea.
     */
    var tokens;
    if (info.relative) {
      tokens = [];
      for (var k = 0; k < length; k++) tokens.push(steps[start + round * length + k].move);
    } else {
      tokens = info.notation.split(/\s+/);
    }

    return { alg: info, tokens: tokens, at: at, round: round + 1, rounds: runLength / length };
  }

  /*
   * Naming the piece being placed.
   *
   * The first three stages put in four pieces each, one at a time, and the
   * difference between "twenty-five moves" and "four pieces, here is the
   * second one" is most of whether those stages are followable. A piece is
   * named the way a person names it: by its colours, which are the colours of
   * the centres of the faces its home slot touches.
   *
   * `target` is the face letters of that slot, from solver.js — 'DF' is the
   * bottom-front edge, 'DFR' the corner between them. `colourOf` turns one
   * face letter into a colour name.
   */
  function pieceLabel(target, colourOf) {
    if (!target) return null;
    var names = target.split('').map(colourOf).filter(Boolean);
    if (names.length < 2) return null;
    var kind = target.length === 3 ? 'corner' : 'edge';
    var last = names.pop();
    return 'the ' + names.join(', ') + ' and ' + last + ' ' + kind;
  }

  var api = {
    STAGES: STAGES, ALGS: ALGS,
    stage: stage, alg: alg, placeInAlg: placeInAlg, pieceLabel: pieceLabel
  };
  root.Academy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
