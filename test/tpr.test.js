/*
 * node test/tpr.test.js [trials]
 *
 * The three-phase solver, ported from Java.
 *
 * A port like this fails silently: an index off by one in a symmetry table
 * still produces a plausible-looking move list. So the checks here are the ones
 * that cannot be fooled — the sizes the original asserts, and whether the moves
 * actually solve the cube when replayed on the model that produced it.
 */
var CubeN = require('../js/cuben.js');
var TPR = require('../js/tpr.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var cube = CubeN.of(4);
var trials = +(process.argv[2] || 12);

console.log('\nthe tables');

var t0 = Date.now();
TPR.init();
var initMs = Date.now() - t0;
console.log('  built in ' + initMs + 'ms');

// The original asserts both of these counts. They come out of the symmetry
// reduction, so getting them right means the 48 cube symmetries and their
// multiplication table are right — which nothing else here would reveal.
var counts = TPR._parts.counts();
check('phase 1 reduces to 15582 symmetry classes', counts.c1sym === 15582, 'got ' + counts.c1sym);
check('the edge stage reduces to 1538 symmetry classes', counts.e3sym === 1538, 'got ' + counts.e3sym);

// Measured: 667ms. The bar is 10s — this runs once, but it runs on a phone.
check('the tables build fast enough to sit through', initMs <= 10000, initMs + 'ms');

check('a solved edge state prunes to zero', (function () {
  var e = new TPR._parts.Edge3();
  e.set(0);
  return TPR._parts.e3Getprun(e.getsym()) === 0;
})());

// Every state within 9 moves is filled in; the rest read as "10 or more". The
// original publishes this figure, so it is a direct check on the whole
// breadth-first fill and the two-bit packing it is stored in.
check('the edge pruning table has exactly the 2,778,197 states it should', (function () {
  var filled = 0;
  for (var i = 0; i < 1538 * 20160; i++) if (TPR._parts.e3GetPruning(i) !== 3) filled++;
  return filled === 2778197;
})());

console.log('\nsolving');

var solved = 0, refused = 0, faceTurns = [], layerTurns = [], times = [];
for (var t = 0; t < trials; t++) {
  var start = cube.applySeq(cube.SOLVED, cube.randomScramble(40));
  var began = Date.now();
  var out = TPR.solve(start);
  var took = Date.now() - began;
  if (!out) { refused++; continue; }
  // Replay on cuben.js — a different model from the one the solver searched in.
  var end = cube.applySeq(start, out.moves);
  var uniform = true;
  for (var f = 0; f < 6; f++) {
    for (var k = 0; k < 16; k++) if (end[f * 16 + k] !== end[f * 16]) uniform = false;
  }
  if (uniform) solved++;
  layerTurns.push(out.moves.length);
  times.push(took);
}
layerTurns.sort(function (a, b) { return a - b; });
times.sort(function (a, b) { return a - b; });
var longest = layerTurns[layerTurns.length - 1], slowest = times[times.length - 1];
console.log('  ' + trials + ' cubes: ' + solved + ' solved, ' + refused + ' refused' +
  '  [' + layerTurns[0] + '-' + longest + ' layer turns, median ' + layerTurns[layerTurns.length >> 1] +
  '; slowest ' + slowest + 'ms]');

check('every cube comes out solved', solved === trials, solved + '/' + trials);

// Measured over 50 cubes: 40-47 in the face-turn metric the original quotes
// (44.39 average), which is 48-60 single-layer turns because a wide turn is two
// of them here. The bar is 80 — well clear, and low enough to catch a port that
// has started producing padding.
check('solutions stay near the length this solver is meant to give', longest <= 80, 'longest was ' + longest);

// Measured over 50 cubes: median 409ms, 95th percentile 710ms, worst 828ms.
check('a cube is solved in about the time the original takes', slowest <= 8000, 'slowest was ' + slowest + 'ms');

console.log('\nrefusing rather than hanging');

/*
 * This solver reads a cube by face number and, given anything else, will search
 * for a position that cannot exist. It runs on the page's own thread, so that
 * is not a slow answer — it is a dead tab, which is exactly what a real scan
 * produced. It has to say no, quickly.
 */
check('a cube whose colours are not face numbers comes back rather than hunting', (function () {
  var start = cube.applySeq(cube.SOLVED, cube.randomScramble(40));
  var labels = [4, 2, 0, 5, 1, 3];
  var relabelled = new Uint8Array(96);
  for (var i = 0; i < 96; i++) relabelled[i] = labels[start[i]];
  var began = Date.now();
  TPR.solve(relabelled);
  return Date.now() - began < 5000;
})());

check('a cube with the wrong number of each colour is refused', (function () {
  var broken = new Uint8Array(96);
  for (var i = 0; i < 96; i++) broken[i] = i % 5;      // five colours, not six
  var began = Date.now();
  return TPR.solve(broken) === null && Date.now() - began < 5000;
})());

check('a colour outside 0-5 is refused', (function () {
  var bad = Uint8Array.from(cube.applySeq(cube.SOLVED, cube.randomScramble(40)));
  bad[0] = 9;
  return TPR.solve(bad) === null;
})());

console.log('\nwide turns');

check('a wide turn becomes the face turn and the slice under it', (function () {
  // Uw is index 18; it should come back as U then u
  var got = TPR.toCubenMoves([18]);
  if (got.join(' ') !== 'U u') return false;
  var got2 = TPR.toCubenMoves([22]);          // Rw2
  return got2.join(' ') === 'R2 r2';
})());

check('the translation matches the model turn for turn', (function () {
  // a wide turn done as two single-layer turns must equal what the solver's own
  // centre model does with it
  for (var m = 0; m < 36; m++) {
    var cc = new TPR._parts.CenterCube();
    cc.move(m);
    var st = cube.applySeq(cube.SOLVED, TPR.toCubenMoves([m]));
    for (var i = 0; i < 24; i++) {
      if (st[TPR._parts.centerFacelet[i]] !== cc.ct[i]) return false;
    }
  }
  return true;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
