/*
 * node test/assemble4.test.js [trials]
 *
 * Photograph a 4x4's six faces in a random order, each turned a random way up,
 * and check the cube comes back exactly — with no fixed centre anywhere to
 * help. The question this answers is whether the cube's own structure (eight
 * real corners, twelve real edges twice over) pins the arrangement down, or
 * whether several arrangements fit and it has to say so.
 */
var CubeN = require('../js/cuben.js');
var A4 = require('../js/assemble4.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var N = 4, per = N * N;
var cube = CubeN.of(N);

function randomCube() {
  return cube.applySeq(cube.SOLVED, cube.randomScramble(40));
}
function shuffle(list) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/** Photograph a cube: random face order, random rotation each. */
function photograph(state, opts) {
  opts = opts || {};
  var order = opts.order || shuffle([0, 1, 2, 3, 4, 5]);
  var turns = opts.turns || order.map(function () { return Math.floor(Math.random() * 4); });
  var captures = order.map(function (face, n) {
    var cells = [];
    for (var i = 0; i < per; i++) cells.push(state[face * per + i]);
    return A4.rotateFace(cells, N, turns[n]);
  });
  return { captures: captures, order: order, turns: turns };
}

function same(a, b) {
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Is this the same physical cube, allowing for it being held differently?
 *
 * The search deliberately pins the first photo to the top face, which fixes
 * one of the 24 ways to hold a cube. So a correct answer comes back rotated —
 * the same cube seen from another angle — and comparing raw arrays would call
 * every correct answer wrong.
 */
var ROTATIONS = CubeN.rotations(N);
function sameCube(a, b) {
  return ROTATIONS.some(function (perm) {
    for (var i = 0; i < b.length; i++) if (a[i] !== b[perm[i]]) return false;
    return true;
  });
}

console.log('\npiece structure comes out of the geometry');
(function () {
  var layout = CubeN.pieces(N);
  check('eight corners of three stickers', layout.corners.length === 8 &&
    layout.corners.every(function (g) { return g.length === 3; }));
  check('twenty-four edge wings of two stickers', layout.edges.length === 24 &&
    layout.edges.every(function (g) { return g.length === 2; }));
  check('twenty-four single-sticker centres', layout.centres.length === 24);
  check('every sticker belongs to exactly one piece', (function () {
    var seen = new Set();
    [].concat(layout.corners, layout.edges, layout.centres).forEach(function (g) {
      g.forEach(function (f) { seen.add(f); });
    });
    return seen.size === 6 * per;
  })());

  var three = CubeN.pieces(3);
  check('a 3x3 comes out as 8 corners, 12 edges, 6 centres',
    three.corners.length === 8 && three.edges.length === 12 && three.centres.length === 6);
})();

console.log('\na solved cube must obviously fit together');
check('the solved cube is accepted', (function () {
  var layout = CubeN.pieces(N);
  return !!A4.structureOf(cube.SOLVED, layout);
})());

console.log('\nfitting six photos back together');
var trials = parseInt(process.argv[2], 10) || 40;
(function () {
  var exact = 0, flagged = 0, wrong = 0, refused = 0, worstChecked = 0, slowest = 0;
  for (var t = 0; t < trials; t++) {
    var truth = randomCube();
    var shot = photograph(truth);
    var started = Date.now();
    var result = A4.assemble(shot.captures, N);
    var ms = Date.now() - started;
    if (ms > slowest) slowest = ms;
    if (result.checked > worstChecked) worstChecked = result.checked;

    if (!result.ok) { refused++; continue; }
    if (sameCube(result.colors, truth)) exact++;
    else if (result.ambiguous) flagged++;
    else wrong++;
  }
  console.log('  ' + trials + ' cubes: ' + exact + ' exact, ' + flagged + ' ambiguous (flagged), ' +
    wrong + ' silently wrong, ' + refused + ' refused' +
    '  [worst ' + worstChecked + ' arrangements tried, ' + slowest + 'ms]');
  check('no cube is ever silently wrong', wrong === 0, wrong + ' of ' + trials);
  check('most cubes are pinned down exactly', exact >= trials * 0.8, exact + '/' + trials);
})();

console.log('\norder and rotation really are free');
check('photographed backwards, every face turned', (function () {
  for (var t = 0; t < 10; t++) {
    var truth = randomCube();
    var shot = photograph(truth, { order: [5, 4, 3, 2, 1, 0], turns: [1, 2, 3, 0, 2, 1] });
    var out = A4.assemble(shot.captures, N);
    if (!out.ok) return false;
    if (!sameCube(out.colors, truth) && !out.ambiguous) return false;
  }
  return true;
})());

check('a solved cube still assembles', (function () {
  var shot = photograph(cube.SOLVED);
  var out = A4.assemble(shot.captures, N);
  return out.ok;
})());

console.log('\nrefusing the impossible');
check('a miscounted colour is refused with a reason', (function () {
  var truth = randomCube();
  var shot = photograph(truth);
  shot.captures[0][0] = (shot.captures[0][0] + 1) % 6;
  var out = A4.assemble(shot.captures, N);
  return !out.ok && /do not add up/.test(out.message);
})());

/*
 * Corrupting a reading must never produce a confident answer.
 *
 * Two figures, because they are not the same promise. "Never confidently
 * wrong" is the one that matters and it is absolute: an impossible cube gets
 * refused, or at worst accepted with the ambiguous flag set, but it never
 * comes back as a cube the user is told to go and turn. "Refused outright" is
 * a quality figure, and it gets a bar with room under it.
 *
 * Measured over 4,987 corrupted cubes: 4,987 refused (100.0%), 0 accepted as
 * ambiguous, 0 confidently wrong. The bar below sits at 90%.
 *
 * The count here used to decrement `total` on a skipped trial, which shortened
 * the loop as well as the denominator: with k skips the best score possible was
 * (20-2k)/(20-k), so k=3 could not beat 0.82 and k=4 could not beat 0.75. It
 * failed about half of all runs against a 0.8 bar while the code underneath was
 * refusing every single corrupted cube.
 */
check('two stickers swapped between faces is never confidently answered', (function () {
  var refused = 0, flagged = 0, confident = 0, attempted = 0;
  for (var t = 0; t < 20; t++) {
    var truth = randomCube();
    var shot = photograph(truth, { order: [0, 1, 2, 3, 4, 5], turns: [0, 0, 0, 0, 0, 0] });
    // swap a corner sticker with a centre sticker of a different colour
    var a = shot.captures[0][0], b = shot.captures[1][5];
    if (a === b) continue;               // nothing was corrupted, so nothing to catch
    shot.captures[0][0] = b; shot.captures[1][5] = a;
    attempted++;
    var out = A4.assemble(shot.captures, N);
    if (!out.ok) refused++;
    else if (out.ambiguous) flagged++;
    else confident++;
  }
  console.log('    refused ' + refused + '/' + attempted +
    ', flagged ' + flagged + ', confidently answered ' + confident);
  return attempted > 0 && confident === 0 && refused >= attempted * 0.9;
})());

console.log('\nfitting a 2x2 together, which has nothing but corners');

/*
 * A 2x2 has no centres and no edges — eight corners is the whole cube — so the
 * edge pattern this file leans on for a 4x4 simply does not exist. What is left
 * is that the corners must be the eight corners of one real colour scheme, must
 * all wind the same way round (a cube has no mirrored corners), and must have
 * twists adding to a multiple of three.
 *
 * It genuinely does not always come out to a single answer: six faces of a 2x2
 * can fit together more than one way, which is a fact about the puzzle rather
 * than a shortcoming here. What must never happen is a confident wrong one.
 */
(function () {
  var small = CubeN.of(2);
  var ROT2 = CubeN.rotations(2);
  function sameSmall(a, b) {
    for (var r = 0; r < ROT2.length; r++) {
      var ok = true;
      for (var i = 0; i < 24; i++) if (a[ROT2[r][i]] !== b[i]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  var exact = 0, ambiguous = 0, silentlyWrong = 0, refusedSmall = 0;
  var runs = Math.max(40, trials);
  for (var t2 = 0; t2 < runs; t2++) {
    var truth2 = small.applySeq(small.SOLVED, small.randomScramble(30));
    var order2 = shuffle([0, 1, 2, 3, 4, 5]);
    var turns2 = order2.map(function () { return Math.floor(Math.random() * 4); });
    var caps2 = order2.map(function (f, i) {
      var cells = [];
      for (var j = 0; j < 4; j++) cells.push(truth2[f * 4 + j]);
      return A4.rotateFace(cells, 2, turns2[i]);
    });
    var out2 = A4.assemble(caps2, 2);
    if (!out2.ok) { refusedSmall++; continue; }
    if (out2.ambiguous) { ambiguous++; continue; }
    if (sameSmall(out2.colors, truth2)) exact++; else silentlyWrong++;
  }
  console.log('  ' + runs + ' cubes: ' + exact + ' exact, ' + ambiguous + ' ambiguous (flagged), ' +
    silentlyWrong + ' silently wrong, ' + refusedSmall + ' refused');

  check('a 2x2 is never silently wrong', silentlyWrong === 0, silentlyWrong + ' of ' + runs);
  check('a 2x2 always fits together somehow', refusedSmall === 0, refusedSmall + ' refused');

  // Measured over 150 cubes: 115 exact, 35 ambiguous, none wrong or refused.
  // The bar is 60%, comfortably under the 77% seen, because which cubes come
  // out ambiguous is a property of the cube and the sample here is small.
  check('most 2x2 cubes come out pinned to one answer', exact >= runs * 0.6, exact + '/' + runs);
})();

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);

