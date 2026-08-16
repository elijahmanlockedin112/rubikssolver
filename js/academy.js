/*
 * academy.js — what the layer-by-layer solution is actually teaching.
 *
 * solver.js produces the moves and tags which algorithm each one came from.
 * This is the other half: what each stage is *for*, what to look for on your
 * own cube to spot it, and the names the eight algorithms go by everywhere else,
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
      id: 'daisy',
      title: 'The daisy',
      goal: 'The yellow centre on top with the four white edges around it, white facing up. It ' +
        'looks like a flower, and it is the one step here that does not have to match anything.',
      look: 'Find a white edge — an edge is a piece with two stickers. Wherever it is, one turn of ' +
        'the face it sits on brings it up to the top. If a petal you already have is in the way, ' +
        'turn the top layer out of the way first: nothing is placed yet, so the top spins freely.',
      why: 'Everyone is told to build the white cross straight onto the bottom, and everyone finds ' +
        'it impossible — you are matching two colours at once, on the face you cannot see, in a ' +
        'slot you then have to protect. The daisy splits that in half. Get the white edges up here ' +
        'where you can see them, while nothing is finished and nothing can be knocked out.'
    },
    {
      id: 'cross',
      title: 'The white cross',
      goal: 'A white plus on the bottom, and — the part that actually matters — each arm matching ' +
        'the centre above it. Look at the sides: four little upside-down T shapes.',
      look: 'One petal at a time. Turn the top until that petal’s other colour sits above the ' +
        'centre of the same colour, then turn that whole face twice and it swings down into place.',
      why: 'Two turns, not one, and that is the whole trick: a half turn carries the edge from the ' +
        'top of a face to the bottom of it without flipping it over, so it arrives the right way ' +
        'round. The turn of the top layer is you doing the matching; the half turn is the cube ' +
        'doing the rest. Once a petal is down nothing later disturbs it — turning the top never ' +
        'reaches the bottom, and each side face gets used exactly once.'
    },
    {
      id: 'corners',
      title: 'The white corners',
      goal: 'The whole bottom layer: the cross plus four white corners, with a matching band of ' +
        'colour running round the bottom of all four sides.',
      look: 'A corner has three stickers. Find one with white on it and read its other two ' +
        'colours — they name the two centres it belongs between. Turn the top until the corner is ' +
        'directly above that gap, then work it down.',
      why: 'The corner goes out of its slot and back in with the same pair of turns repeated: take ' +
        'it out, spin the top, put it back. Watch the white sticker as you go — each repeat turns ' +
        'it a third of the way round, so it comes to face downwards eventually, and the moment it ' +
        'does the corner drops home. A corner already in the right place but twisted has to come ' +
        'out first and go back the same way.'
    },
    {
      id: 'middle',
      title: 'The middle layer',
      goal: 'Two full layers. The bottom untouched, and the middle band of every side matching its ' +
        'centre. Only the yellow layer left after this.',
      look: 'You want the edges with no yellow on them — that is how you pick them out from up ' +
        'here. Turn the top until one makes an upside-down T with the centre below it. Then look ' +
        'at its top colour: if that colour’s centre is to the RIGHT, use the right insert; if ' +
        'it is to the LEFT, use the left one.',
      why: 'The first algorithm worth learning by heart. It takes a corner of the finished bottom ' +
        'layer out of the way, drops the edge into the gap behind it, and puts the corner straight ' +
        'back — which is why the bottom looks broken half way through and is fine at the end. If ' +
        'the edge you need is stuck in a middle slot already, run the insert on that slot anyway ' +
        'to kick it up to the top, then place it properly.'
    },
    {
      id: 'topcross',
      title: 'The yellow cross',
      goal: 'A yellow plus on the top face. Only the yellow facing up counts here — the sides of ' +
        'those edges can be any colour at all.',
      look: 'Look down at the top and you will see one of four things: a dot, an L, a line, or the ' +
        'cross. Hold an L so its two yellow edges point left and away from you; hold a line so it ' +
        'runs left to right; from a dot, hold it however you like.',
      why: 'One algorithm walks you along that chain — dot to L, L to line, line to cross — so it ' +
        'is the same six moves run once, twice or three times depending on where you started. It ' +
        'only flips edges and does not care where they are, which is deliberate: getting pieces ' +
        'facing the right way and getting them into the right places are two separate problems, ' +
        'and trying to do both at once is what makes a last layer feel impossible.'
    },
    {
      id: 'topface',
      title: 'The whole yellow face',
      goal: 'The top face a solid yellow. The sides will look thoroughly scrambled, and that is ' +
        'exactly what it should look like.',
      look: 'Count the corners already showing yellow on top: none, one, two or four. With one, ' +
        'hold the cube so that corner is at the front left. With two, find a yellow sticker facing ' +
        'left on the front-left corner and hold it there.',
      why: 'Sune: seven moves, and the most-used algorithm in the method. It twists three corners ' +
        'at once and leaves the fourth alone. It looks like it is wrecking the cube half way ' +
        'through and then puts it all back — trusting that is most of the skill. Run it, look ' +
        'again, run it again if you need to.'
    },
    {
      id: 'topcorners',
      title: 'Putting the corners home',
      goal: 'The four top corners in the right places — each between the two centres whose colours ' +
        'it carries. They may still be twisted; that is the next stage, not this one.',
      look: 'A corner is in the right place if its three colours match the three faces it touches, ' +
        'in any order at all. Find one that already is — there is nearly always one — and hold the ' +
        'cube with it at the back right. If there is none, run the algorithm once from anywhere ' +
        'and one will appear.',
      why: 'The algorithm cycles three corners round and leaves the fourth exactly where it is, ' +
        'which is why finding the one already home matters — that is the one you are protecting. ' +
        'Everything left is facing the right way by now, so all that remains is moving pieces ' +
        'about.'
    },
    {
      id: 'topedges',
      title: 'The last four edges',
      goal: 'A solved cube.',
      look: 'Three edges to cycle round. Look for a side that is already finished — a solid wall ' +
        'of one colour — and hold the cube with that side at the back. If no side is finished, run ' +
        'the algorithm once from anywhere and one will be.',
      why: 'The last algorithm in the method, run once or twice. Everyone reaches this point at ' +
        'least once convinced they have broken the cube two moves from the end. Run it again and ' +
        'it finishes.'
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
