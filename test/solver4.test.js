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

var N = 4;
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

console.log('\nwhat is not built yet');

// The rule this codebase runs on: never silently wrong. A solver that cannot
// finish must say so, not hand over a move list that leaves a scrambled cube.
check('solve() refuses rather than returning moves that do not solve', (function () {
  for (var t = 0; t < 5; t++) {
    var out = S4.solve(scrambled());
    if (out.ok) return false;                       // must not claim success
    if (!out.message || !/not finished yet/i.test(out.message)) return false;
  }
  return true;
})());

check('the refusal still says how far it got', (function () {
  var out = S4.solve(scrambled());
  return !!out.partial && out.partial.stage === 'centres' && out.partial.moves.length > 0;
})());

check('an impossible cube is refused before any solving is attempted', (function () {
  var broken = Uint8Array.from(scrambled());
  for (var i = 0; i < 16; i++) broken[i] = broken[16];
  var out = S4.solve(broken);
  return !out.ok && !out.partial;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
