/*
 * node test/solver4.test.js [trials]
 *
 * The 4x4 solver, as far as it is built. Two things are being checked:
 * that the finished stage really finishes, and that the unfinished one refuses
 * out loud instead of handing back moves that do not solve the cube.
 */
var CubeN = require('../js/cuben.js');
var S4 = require('../js/solver4.js');
var I = S4._internals;

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var N = 4, per = N * N;
var cube = CubeN.of(N);
var trials = +(process.argv[2] || 30);

function scrambled() {
  return cube.applySeq(cube.SOLVED, cube.randomScramble(40));
}

console.log('\nworking out which colour belongs on which face');

check('a solved cube gives a scheme with three opposite pairs', (function () {
  var s = I.schemeOf(cube.SOLVED);
  if (!s.ok) return false;
  for (var c = 0; c < 6; c++) if (s.opposite[s.opposite[c]] !== c) return false;
  return true;
})());

check('scrambling never changes the scheme', (function () {
  var base = I.schemeOf(cube.SOLVED);
  for (var t = 0; t < 20; t++) {
    var s = I.schemeOf(scrambled());
    if (!s.ok) return false;
    for (var c = 0; c < 6; c++) if (s.opposite[c] !== base.opposite[c]) return false;
  }
  return true;
})());

check('normalising a solved cube leaves it solved', (function () {
  var s = I.schemeOf(cube.SOLVED);
  return s.ok && cube.isSolved(I.normalise(cube.SOLVED, s));
})());

// A cube that cannot exist has to be refused here rather than three stages
// later, because by then the failure looks like a solver bug instead of a
// misread sticker.
check('a cube whose colours cannot be opposite is refused with a reason', (function () {
  var broken = Uint8Array.from(scrambled());
  // paint one whole face a colour it cannot be: every corner now disagrees
  for (var i = 0; i < 16; i++) broken[i] = broken[16];
  var s = I.schemeOf(broken);
  return !s.ok && /not a cube|do not agree|not one cube|real scheme/i.test(s.message);
})());

console.log('\nthe centres');

var lens = [], times = [], solved = 0, refused = 0;
for (var t = 0; t < trials; t++) {
  var start = scrambled();
  var scheme = I.schemeOf(start);
  if (!scheme.ok) { refused++; continue; }
  var norm = I.normalise(start, scheme);
  var t0 = Date.now();
  var res = I.solveCentres(norm);
  var ms = Date.now() - t0;
  if (!res) { refused++; continue; }
  // the only check that counts: replay the moves and look at the cube
  if (I.centresSolved(cube.applySeq(norm, res.moves))) solved++;
  lens.push(res.moves.length);
  times.push(ms);
}
lens.sort(function (a, b) { return a - b; });
times.sort(function (a, b) { return a - b; });
var worstLen = lens[lens.length - 1], worstMs = times[times.length - 1];
console.log('  ' + trials + ' cubes: ' + solved + ' centres solved, ' + refused + ' refused' +
  '  [longest ' + worstLen + ' moves, slowest ' + worstMs + 'ms]');

check('every cube\'s centres come out solved', solved === trials, solved + '/' + trials);

// Measured over 60 random cubes: 14 to 20 moves, median 17. The bar is 26.
check('the centre solution stays a sensible length', worstLen <= 26, 'longest was ' + worstLen);

// Measured over 60 random cubes: 21 to 941ms, median 172. The bar is 5s, which
// is slow for a click but nowhere near a hang; the search is meet-in-the-middle
// so the tail is what matters, not the median.
check('the centres are solved quickly enough to feel like a click', worstMs <= 5000, 'slowest was ' + worstMs + 'ms');

console.log('\nthe edge pairs');

var pairOk = 0, pairMoves = [];
for (var e = 0; e < Math.min(trials, 12); e++) {
  var s0 = scrambled();
  var sch = I.schemeOf(s0);
  var c0 = I.solveCentres(I.normalise(s0, sch));
  if (!c0) continue;
  var pr = I.solveEdges(c0.state);
  if (!pr) continue;
  // pairing must not have undone the centres it was handed
  if (I.allEdgesPaired(pr.state) && I.centresSolved(pr.state)) pairOk++;
  pairMoves.push(pr.moves.length);
}
console.log('  ' + pairMoves.length + ' cubes paired, longest ' + Math.max.apply(null, pairMoves) + ' moves');
check('pairing finishes and leaves the centres alone', pairOk === pairMoves.length && pairOk > 0,
  pairOk + '/' + pairMoves.length);

console.log('\nparity');

// Both algorithms must leave the reduction intact for ANY cube, not just the
// one they were checked on. That holds because it is a property of the
// permutation, so checking it once on a solved cube settles it.
check('the OLL parity algorithm keeps the centres solid and the pairs joined',
  I.preservesReduction(I.OLL_PARITY));
check('the PLL parity algorithm keeps the centres solid and the pairs joined',
  I.preservesReduction(I.PLL_PARITY));

check('a solved cube shows no parity', I.parityOf(cube.SOLVED) === null);

check('the OLL algorithm produces exactly the case it is meant to fix',
  I.parityOf(cube.applySeq(cube.SOLVED, I.OLL_PARITY)) === 'oll');
check('the PLL algorithm produces exactly the case it is meant to fix',
  I.parityOf(cube.applySeq(cube.SOLVED, I.PLL_PARITY)) === 'pll');

check('each parity algorithm undoes itself', (function () {
  var a = cube.applySeq(cube.applySeq(cube.SOLVED, I.OLL_PARITY), I.OLL_PARITY);
  var b = cube.applySeq(cube.applySeq(cube.SOLVED, I.PLL_PARITY), I.PLL_PARITY);
  return I.parityOf(a) === null && I.parityOf(b) === null;
})());

console.log('\nsolving the whole cube');

var solvedCount = 0, refused = 0, lengths = [], durations = [];
for (var w = 0; w < trials; w++) {
  var cubeIn = scrambled();
  var t0 = Date.now();
  var res = S4.solve(cubeIn);
  var took = Date.now() - t0;
  if (!res.ok) { refused++; continue; }
  // Replay the moves independently of anything the solver returned, and look
  // at the cube. This is the only check that actually matters.
  var end = cube.applySeq(cubeIn, res.moves);
  var uniform = true;
  for (var f2 = 0; f2 < 6; f2++) {
    for (var k2 = 0; k2 < per; k2++) if (end[f2 * per + k2] !== end[f2 * per]) uniform = false;
  }
  if (uniform) solvedCount++;
  lengths.push(res.moves.length);
  durations.push(took);
}
lengths.sort(function (a, b) { return a - b; });
durations.sort(function (a, b) { return a - b; });
var longest = lengths[lengths.length - 1], slowest = durations[durations.length - 1];
console.log('  ' + trials + ' cubes: ' + solvedCount + ' solved, ' + refused + ' refused' +
  '  [' + lengths[0] + '-' + longest + ' moves, median ' + lengths[lengths.length >> 1] +
  '; slowest ' + slowest + 'ms]');

check('every scrambled cube comes out solved', solvedCount === trials, solvedCount + '/' + trials);

// Measured over 150 random cubes: all 150 solved, 65 to 112 moves, median 89,
// 90th percentile 104. Reduction is not
// a short method and there is no practical optimal solver at this size, so the
// bar is about catching a stage that has started flailing, not move-count
// tuning. 150 leaves room above the worst seen.
check('the solution stays a sensible length', longest <= 150, 'longest was ' + longest);

// Measured over 300 random cubes: median 991ms, 95th percentile 3095ms, 99th
// 4870ms — but a long tail, worst seen 25658ms. The tail is the last-two-edges
// escape: when it finds nothing it has still tried every combination it was
// allowed. The bar is set above the worst measured rather than at the median,
// because what it is guarding against is a stage that never returns, not a
// slow one.
check('a cube is always solved in bounded time', slowest <= 40000, 'slowest was ' + slowest + 'ms');

console.log('\nrefusing what cannot be solved');

check('an impossible cube is refused with a reason, not solved', (function () {
  var broken = Uint8Array.from(scrambled());
  for (var i = 0; i < per; i++) broken[i] = broken[per];   // paint a whole face wrong
  var out = S4.solve(broken);
  return !out.ok && !!out.message && !out.moves;
})());

check('a refusal never comes with moves attached', (function () {
  for (var t = 0; t < 6; t++) {
    var broken = Uint8Array.from(scrambled());
    broken[0] = (broken[0] + 1) % 6;                       // one sticker wrong
    var out = S4.solve(broken);
    if (!out.ok && out.moves) return false;
    if (out.ok) {
      // if it claims success it had better be telling the truth
      var end2 = cube.applySeq(broken, out.moves);
      for (var f3 = 0; f3 < 6; f3++) {
        for (var k3 = 0; k3 < per; k3++) if (end2[f3 * per + k3] !== end2[f3 * per]) return false;
      }
    }
  }
  return true;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
