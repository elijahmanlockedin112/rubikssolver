/*
 * node test/solver2.test.js [trials]
 *
 * The 2x2 solver.
 *
 * This one can be checked far harder than the others, because the whole puzzle
 * is small enough to walk: 3,674,160 positions with one corner held still. The
 * distance table is therefore not a sample of the cube, it IS the cube, and how
 * many positions sit at each distance is a published result that a wrong move
 * table cannot accidentally reproduce.
 */
var CubeN = require('../js/cuben.js');
var S2 = require('../js/solver2.js');
var I = S2._internals;

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var cube = CubeN.of(2);
var trials = +(process.argv[2] || 200);

function scrambled() { return cube.applySeq(cube.SOLVED, cube.randomScramble(30)); }
function shuffledLabels() {
  var a = [0, 1, 2, 3, 4, 5];
  for (var i = 5; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

console.log('\nreading the corners');

check('a solved cube has every corner home and untwisted', (function () {
  var r = I.readCorners(cube.SOLVED);
  if (!r) return false;
  for (var i = 0; i < 8; i++) if (r.cp[i] !== i || r.co[i] !== 0) return false;
  return true;
})());

/*
 * Twist has to be counted the same way round on every corner or adding two
 * twists is meaningless — and adding twists is what the move tables do. Reading
 * it off stickers sorted by face number does not give that: it winds one way on
 * some corners and the other way on their neighbours. The symptom is a distance
 * table with far too many positions near solved, which is exactly what the
 * histogram below would catch.
 */
check('the solved cube sits at the very start of the table', (function () {
  var c = I.coordsOf(cube.SOLVED);
  return c && c.perm === 0 && c.ori === 0;
})());

console.log('\nthe distance table');

var built = Date.now();
I.buildDistances();
var buildMs = Date.now() - built;
var dist = I.distances();
console.log('  built in ' + buildMs + 'ms');

// Measured: 150ms. The bar is 8s — it runs once, but it runs on a phone.
check('the table builds fast enough to sit through', buildMs <= 8000, buildMs + 'ms');

var hist = {}, unreached = 0;
for (var i = 0; i < dist.length; i++) {
  if (dist[i] === 255) unreached++; else hist[dist[i]] = (hist[dist[i]] || 0) + 1;
}
check('every one of the 3,674,160 positions is reachable', unreached === 0, unreached + ' unreachable');

/*
 * This is the check that matters. The number of 2x2 positions at each distance
 * in the half-turn metric is a known published result, and it is not something
 * a wrong move table lands on by luck — get the twist bookkeeping even slightly
 * wrong and the counts near solved balloon.
 */
var EXPECTED = { 0: 1, 1: 9, 2: 54, 3: 321, 4: 1847, 5: 9992, 6: 50136,
  7: 227536, 8: 870072, 9: 1887748, 10: 623800, 11: 2644 };
check('the positions at each distance match the published figures', (function () {
  var keys = Object.keys(EXPECTED);
  if (Object.keys(hist).length !== keys.length) return false;
  for (var k = 0; k < keys.length; k++) if (hist[keys[k]] !== EXPECTED[keys[k]]) return false;
  return true;
})(), JSON.stringify(hist));

check('no position is further than eleven moves from solved', (function () {
  for (var d in hist) if (+d > 11) return false;
  return true;
})());

console.log('\nsolving');

var solved = 0, lengths = [], slowest = 0, refused = 0;
for (var t = 0; t < trials; t++) {
  var start = scrambled();
  // half of them numbered the way a scan numbers them, not by face
  if (t % 2) {
    var labels = shuffledLabels();
    var relabelled = new Uint8Array(24);
    for (var i2 = 0; i2 < 24; i2++) relabelled[i2] = labels[start[i2]];
    start = relabelled;
  }
  var began = Date.now();
  var out = S2.solve(start);
  var took = Date.now() - began;
  if (took > slowest) slowest = took;
  if (!out.ok) { refused++; continue; }
  var end = cube.applySeq(start, out.moves);
  var uniform = true;
  for (var f = 0; f < 6; f++) {
    for (var k2 = 0; k2 < 4; k2++) if (end[f * 4 + k2] !== end[f * 4]) uniform = false;
  }
  if (uniform) solved++;
  lengths.push(out.moves.length);
}
lengths.sort(function (a, b) { return a - b; });
console.log('  ' + trials + ' cubes: ' + solved + ' solved, ' + refused + ' refused' +
  '  [' + lengths[0] + '-' + lengths[lengths.length - 1] + ' moves, median ' + lengths[lengths.length >> 1] +
  '; slowest ' + slowest + 'ms]');

check('every cube comes out solved', solved === trials, solved + '/' + trials);

// Not a bar with headroom — a fact. The table holds the true distance to every
// position, so a solution longer than 11 would mean the table itself is wrong.
check('no solution is longer than eleven moves', lengths[lengths.length - 1] <= 11,
  'longest was ' + lengths[lengths.length - 1]);

check('the solution is exactly as long as the table says it should be', (function () {
  for (var t2 = 0; t2 < 20; t2++) {
    var start2 = scrambled();
    var out2 = S2.solve(start2);
    if (!out2.ok) return false;
    var scheme = I.schemeOf(start2);
    var co = I.coordsOf(I.normalise(start2, scheme));
    if (out2.moves.length !== dist[co.perm * I.N_ORI + co.ori]) return false;
  }
  return true;
})());

console.log('\nrefusing what cannot be solved');

check('a corner twisted on its own is refused with a reason', (function () {
  var broken = Uint8Array.from(cube.SOLVED);
  // rotate one corner's three stickers, which no amount of turning can do
  var c = I.CORNERS[1];
  var keep = broken[c[0]];
  broken[c[0]] = broken[c[1]]; broken[c[1]] = broken[c[2]]; broken[c[2]] = keep;
  var out3 = S2.solve(broken);
  return !out3.ok && /twisted/i.test(out3.message);
})());

check('a cube whose colours cannot be opposite is refused', (function () {
  var broken = Uint8Array.from(scrambled());
  for (var i3 = 0; i3 < 4; i3++) broken[i3] = broken[4];   // paint a face wrong
  var out4 = S2.solve(broken);
  return !out4.ok && !out4.moves;
})());

check('a refusal never comes with moves attached', (function () {
  for (var t3 = 0; t3 < 10; t3++) {
    var broken2 = Uint8Array.from(scrambled());
    broken2[0] = (broken2[0] + 1) % 6;
    var out5 = S2.solve(broken2);
    if (!out5.ok && out5.moves) return false;
    if (out5.ok) {
      var end2 = cube.applySeq(broken2, out5.moves);
      for (var f2 = 0; f2 < 6; f2++) {
        for (var k3 = 0; k3 < 4; k3++) if (end2[f2 * 4 + k3] !== end2[f2 * 4]) return false;
      }
    }
  }
  return true;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
