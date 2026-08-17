/*
 * academy.js — what the layer-by-layer solution is actually teaching.
 *
 * solver.js produces the moves and tags which algorithm each one came from.
 * This is the other half: what each stage is *for*, what it looks like when it
 * is done, what to do to get there, and the names the eight algorithms go by
 * everywhere else, so what is learned here is transferable rather than local to
 * this app.
 *
 * The wording is aimed at someone who has never solved a cube. Three rules it
 * tries to keep:
 *
 *   - Show the finished thing first. `picture` below is the stage's goal drawn
 *     as a cube, and it is the reason this file is not only prose: "make it
 *     look like this" is an instruction anyone can follow, and a paragraph
 *     describing a pattern is one nobody can.
 *   - Then say how, in short numbered steps you can hold in your head while
 *     looking at a cube. `steps`, not another paragraph.
 *   - Never say "just". The whole point is that none of it is obvious yet.
 *
 * The stage ids match solver.js's STAGES exactly; the algorithm ids match the
 * tags macroSearch attaches. Both are asserted in test/academy.test.js, because
 * a rename on either side would otherwise show up as a silently blank panel.
 */
;(function (root) {
  'use strict';

  /*
   * ---------------------------------------------------------------------
   * The goal pictures.
   *
   * A stage's goal, as a cube you can look at. Every sticker that has to be a
   * particular colour when the stage is finished is listed here; everything
   * else is left black, which is the honest thing to draw — "any colour at
   * all" is a real and important part of most of these goals, and it is the
   * part prose gets wrong. The yellow cross does not care what the sides of
   * its edges are, and a learner who thinks it does will fight the cube for an
   * hour.
   *
   * Two levels, because "what am I adding" and "what must I not break" are
   * different questions:
   *
   *   bright — what this stage puts there. The new thing.
   *   faded  — what earlier stages already put there and this one keeps.
   *
   * Facelets are the standard 54: U 0-8, R 9-17, F 18-26, D 27-35, L 36-44,
   * B 45-53, each face read row-major off the unfolded net, so on a side face
   * cells 0,1,2 touch the top and 6,7,8 touch the bottom.
   *
   * Colours are named by the face they belong to, because the cube's own
   * centres decide what those colours are — OWN means "this face's own centre
   * colour", which is what makes the picture correct on a cube with an unusual
   * scheme instead of merely conventional.
   */
  var U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;
  var SIDES = [R, F, L, B];
  var OWN = -1;

  var TOP_ROW = [0, 1, 2], MIDDLE_ROW = [3, 4, 5], BOTTOM_ROW = [6, 7, 8];
  var WHOLE_FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  var PLUS = [1, 3, 4, 5, 7];
  var FACE_CORNERS = [0, 2, 6, 8];

  /** The same cells on all four side faces, each in its own colour. */
  function sides(cells) {
    return SIDES.map(function (f) { return [f, cells, OWN]; });
  }
  /** Everything the bottom two layers own, which four stages carry forward. */
  function twoLayers() {
    return [[D, WHOLE_FACE, D]].concat(sides(BOTTOM_ROW)).concat(sides(MIDDLE_ROW));
  }

  var PICTURES = {
    // yellow centre, four white petals; the rest of the cube is anybody's guess
    daisy: {
      bright: [[U, [4], U], [U, [1, 3, 5, 7], D]],
      faded: []
    },
    // the plus underneath, and the four upside-down T's that prove it is lined up
    cross: {
      bright: [[D, PLUS, D]].concat(sides([7])),
      faded: []
    },
    corners: {
      bright: [[D, FACE_CORNERS, D]].concat(sides([6, 8])),
      faded: [[D, PLUS, D]].concat(sides([7]))
    },
    middle: {
      bright: sides(MIDDLE_ROW),
      faded: [[D, WHOLE_FACE, D]].concat(sides(BOTTOM_ROW))
    },
    // only the yellow facing up counts: the sides of these edges stay black
    topcross: {
      bright: [[U, PLUS, U]],
      faded: twoLayers()
    },
    topface: {
      bright: [[U, FACE_CORNERS, U]],
      faded: twoLayers().concat([[U, PLUS, U]])
    },
    // corners home: their side stickers line up, the edges between them do not
    topcorners: {
      bright: sides([0, 2]),
      faded: twoLayers().concat([[U, WHOLE_FACE, U]])
    },
    topedges: {
      bright: sides([1]),
      faded: twoLayers().concat([[U, WHOLE_FACE, U]]).concat(sides([0, 2]))
    }
  };

  var STAGES = [
    {
      id: 'daisy',
      title: 'The daisy',
      goal: 'A white edge on each side of the yellow centre, white facing up.',
      steps: [
        'Find a white edge — a piece with two stickers, one of them white.',
        'Turn the face it sits on until that edge reaches the top, white up.',
        'If a petal is already in the way, spin the top layer first. Four petals, done.'
      ],
      look: 'White edges — two stickers, one of them white. One turn of the face it sits on ' +
        'brings it up to the top.',
      why: 'Everyone is told to build the white cross straight onto the bottom, and everyone finds ' +
        'it impossible — you are matching two colours at once, on the face you cannot see, in a ' +
        'slot you then have to protect. The daisy splits that in half. Get the white edges up here ' +
        'where you can see them, while nothing is finished and nothing can be knocked out.'
    },
    {
      id: 'cross',
      title: 'The white cross',
      goal: 'A white plus underneath, each arm matching the centre above it — four upside-down ' +
        'T shapes.',
      steps: [
        'Read the side colour of one petal.',
        'Turn the TOP until that colour sits above the centre of the same colour.',
        'Turn that whole face twice — the petal swings down the right way round.'
      ],
      look: 'Turn the top until the petal’s side colour sits above the centre of the same colour, ' +
        'then turn that face twice.',
      why: 'Two turns, not one, and that is the whole trick: a half turn carries the edge from the ' +
        'top of a face to the bottom of it without flipping it over, so it arrives the right way ' +
        'round. The turn of the top layer is you doing the matching; the half turn is the cube ' +
        'doing the rest. Once a petal is down nothing later disturbs it — turning the top never ' +
        'reaches the bottom, and each side face gets used exactly once.'
    },
    {
      id: 'corners',
      title: 'The white corners',
      goal: 'The whole bottom layer: white face done, and a matching band round every side.',
      steps: [
        'Find a top-layer corner with white on it. Its other two colours name its slot.',
        'Turn the top until it sits directly above that gap.',
        'Take it out, turn the top, put it back — until the white sticker faces down.'
      ],
      look: 'A corner with white on it, held above the gap between the two centres its other two ' +
        'colours name.',
      why: 'The corner goes out of its slot and back in with the same pair of turns repeated: take ' +
        'it out, spin the top, put it back. Watch the white sticker as you go — each repeat turns ' +
        'it a third of the way round, so it comes to face downwards eventually, and the moment it ' +
        'does the corner drops home. A corner already in the right place but twisted has to come ' +
        'out first and go back the same way.'
    },
    {
      id: 'middle',
      title: 'The middle layer',
      goal: 'Two whole layers. Every side’s middle band matching its centre, the bottom still ' +
        'untouched.',
      steps: [
        'Find a top-layer edge with NO yellow on it.',
        'Turn the top until its front colour matches the centre below: an upside-down T.',
        // the edge that is already stuck in a middle slot is in `why`, which is
        // one tap away — four steps here does not fit above a goal picture on a
        // 375px phone, and the picture is the part that cannot be replaced
        'Its top colour names a side: that centre on the RIGHT → right insert, LEFT → left.'
      ],
      look: 'Top-layer edges with no yellow on them. Line one up into an upside-down T, then read ' +
        'which side its top colour belongs on.',
      why: 'The first algorithm worth learning by heart. It takes a corner of the finished bottom ' +
        'layer out of the way, drops the edge into the gap behind it, and puts the corner straight ' +
        'back — which is why the bottom looks broken half way through and is fine at the end. If ' +
        'the edge you need is stuck in a middle slot already, run the insert on that slot anyway ' +
        'to kick it up to the top, then place it properly.'
    },
    {
      id: 'topcross',
      title: 'The yellow cross',
      goal: 'A yellow plus on top. Only the yellow facing UP counts — the sides can be anything.',
      steps: [
        'Look down at the top: a dot, an L, a line, or the cross already.',
        'Hold an L pointing left and away from you; hold a line left to right.',
        'Run F R U R′ U′ F′ and look again. Dot → L → line → cross.'
      ],
      look: 'A dot, an L, or a line on top. The shape you have is what says how many times to run it.',
      why: 'One algorithm walks you along that chain — dot to L, L to line, line to cross — so it ' +
        'is the same six moves run once, twice or three times depending on where you started. It ' +
        'only flips edges and does not care where they are, which is deliberate: getting pieces ' +
        'facing the right way and getting them into the right places are two separate problems, ' +
        'and trying to do both at once is what makes a last layer feel impossible.'
    },
    {
      id: 'topface',
      title: 'The whole yellow face',
      goal: 'The top face solid yellow. The sides of that layer will look scrambled, and that is ' +
        'right.',
      steps: [
        'Count the corners already yellow on top: none, one, two or four.',
        'With one, hold it at the front left; with two, hold one with yellow facing LEFT there.',
        'Run Sune, look again, repeat. It takes up to three goes.'
      ],
      look: 'How many corners already show yellow on top, and where the yellow of the others is ' +
        'pointing.',
      why: 'Sune: seven moves, and the most-used algorithm in the method. It twists three corners ' +
        'at once and leaves the fourth alone. It looks like it is wrecking the cube half way ' +
        'through and then puts it all back — trusting that is most of the skill. Run it, look ' +
        'again, run it again if you need to.'
    },
    {
      id: 'topcorners',
      title: 'Putting the corners home',
      goal: 'Every top corner between the two centres whose colours it carries.',
      steps: [
        'A corner is home when its three colours match the three faces it touches.',
        'Find one that already is and hold the cube with it at the back right.',
        'None home? Run the algorithm once from anywhere and one will be. Then repeat.'
      ],
      look: 'The one corner already between the right two centres. That is the one being protected.',
      why: 'The algorithm cycles three corners round and leaves the fourth exactly where it is, ' +
        'which is why finding the one already home matters — that is the one you are protecting. ' +
        'Everything left is facing the right way by now, so all that remains is moving pieces ' +
        'about.'
    },
    {
      id: 'topedges',
      title: 'The last four edges',
      goal: 'A solved cube. Three edges to cycle round and every face comes out one colour.',
      steps: [
        'Find a side that is already a solid wall of one colour.',
        'Hold the cube with that finished side at the BACK.',
        'None finished? Run it once from anywhere, then again from there.'
      ],
      look: 'A side that is already a solid wall of one colour. Hold that one at the back.',
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
   * A stage's goal drawn as a cube.
   *
   * `colours[f]` is the colour of face f on the cube being taught — read off
   * its own centres, so this comes out right on a cube whose stickers are not
   * the usual six. Returns two maps from facelet to colour: `bright` is what
   * this stage puts there, `faded` is what earlier stages did and this one has
   * to keep. Anything in neither is deliberately left out: those stickers can
   * be any colour at all when the stage is done, and saying so in a picture is
   * the whole reason this exists.
   */
  function goalPicture(id, colours) {
    var pic = PICTURES[id];
    if (!pic || !colours) return null;
    function paint(list) {
      var out = {};
      list.forEach(function (entry) {
        var face = entry[0], cells = entry[1], from = entry[2];
        var colour = colours[from === OWN ? face : from];
        if (colour === undefined || colour === null || colour < 0) return;
        cells.forEach(function (cell) { out[face * 9 + cell] = colour; });
      });
      return out;
    }
    var bright = paint(pic.bright);
    var faded = paint(pic.faded);
    // a sticker this stage places is not also one it is keeping, whatever the
    // lists say — bright wins, so the two can never disagree on screen
    Object.keys(bright).forEach(function (i) { delete faded[i]; });
    return { bright: bright, faded: faded };
  }

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
    STAGES: STAGES, ALGS: ALGS, PICTURES: PICTURES,
    stage: stage, alg: alg, goalPicture: goalPicture,
    placeInAlg: placeInAlg, pieceLabel: pieceLabel
  };
  root.Academy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
