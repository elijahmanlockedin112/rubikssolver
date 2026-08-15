/*
 * Node test harness: node test/solver.test.js [trials]
 * Checks the move engine, the algorithms the solver leans on, the validator,
 * and then solves a pile of random scrambles.
 */
var Cube = require('../js/cube.js');
var Solver = require('../js/solver.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (extra ? ' — ' + extra : ''));
  }
}

console.log('\nmove engine');
Cube.FACE_LETTERS.forEach(function (f) {
  var s = Cube.applySeq(Cube.SOLVED, [f, f, f, f]);
  check(f + ' x4 == identity', Cube.isSolved(s));
  var t = Cube.applySeq(Cube.SOLVED, [f, f + "'"]);
  check(f + " then " + f + "' == identity", Cube.isSolved(t));
  var u = Cube.applySeq(Cube.SOLVED, [f + '2', f + '2']);
  check(f + '2 x2 == identity', Cube.isSolved(u));
});
check('sexy move has order 6', Cube.isSolved(Cube.applySeq(Cube.SOLVED, Cube.parse("R U R' U'").concat(
  Cube.parse("R U R' U'"), Cube.parse("R U R' U'"), Cube.parse("R U R' U'"),
  Cube.parse("R U R' U'"), Cube.parse("R U R' U'")))));
check('scramble then inverse == identity', (function () {
  var sc = Cube.randomScramble(30);
  return Cube.isSolved(Cube.applySeq(Cube.applySeq(Cube.SOLVED, sc), Cube.invertSeq(sc)));
})());
check('every state stays valid after scrambling', (function () {
  for (var i = 0; i < 50; i++) {
    var st = Cube.applySeq(Cube.SOLVED, Cube.randomScramble(30));
    if (!Cube.validate(st).ok) return false;
  }
  return true;
})());

// Which pieces does an algorithm actually move?
function affected(alg) {
  var s = Cube.applySeq(Cube.SOLVED, Cube.parse(alg));
  var corners = [], edges = [];
  for (var c = 0; c < 8; c++) {
    var fl = Cube.CORNER_FACELETS[c], fc = Cube.CORNER_FACES[c];
    if (s[fl[0]] !== fc[0] || s[fl[1]] !== fc[1] || s[fl[2]] !== fc[2]) corners.push(Cube.CORNER_NAMES[c]);
  }
  for (var e = 0; e < 12; e++) {
    var ef = Cube.EDGE_FACELETS[e], ec = Cube.EDGE_FACES[e];
    if (s[ef[0]] !== ec[0] || s[ef[1]] !== ec[1]) edges.push(Cube.EDGE_NAMES[e]);
  }
  return { corners: corners, edges: edges };
}

console.log('\nalgorithms the solver relies on');
var niklas = affected("U R U' L' U R' U' L");
check('corner-placement alg touches only 3 top corners',
  niklas.edges.length === 0 && niklas.corners.length === 3 &&
  niklas.corners.every(function (c) { return c[0] === 'U'; }),
  'corners=' + niklas.corners + ' edges=' + niklas.edges);
var uperm = affected("R U' R U R U R U' R' U' R2");
check('last-edge alg touches only 3 top edges',
  uperm.corners.length === 0 && uperm.edges.length === 3 &&
  uperm.edges.every(function (e) { return e[0] === 'U'; }),
  'corners=' + uperm.corners + ' edges=' + uperm.edges);
var sexy = affected("R U R' U'");
check('sexy move leaves the rest of the bottom layer alone',
  sexy.corners.filter(function (c) { return c[0] === 'D' && c !== 'DFR'; }).length === 0 &&
  sexy.edges.filter(function (e) { return e[0] === 'D'; }).length === 0,
  'corners=' + sexy.corners + ' edges=' + sexy.edges);

console.log('\nvalidator');
check('solved cube is valid', Cube.validate(Cube.SOLVED).ok);
check('twisted corner rejected', (function () {
  var s = Uint8Array.from(Cube.SOLVED);
  var fl = Cube.CORNER_FACELETS[0];
  var t = s[fl[0]]; s[fl[0]] = s[fl[1]]; s[fl[1]] = s[fl[2]]; s[fl[2]] = t;
  return !Cube.validate(s).ok;
})());
check('flipped edge rejected', (function () {
  var s = Uint8Array.from(Cube.SOLVED);
  var fl = Cube.EDGE_FACELETS[0];
  var t = s[fl[0]]; s[fl[0]] = s[fl[1]]; s[fl[1]] = t;
  return !Cube.validate(s).ok;
})());
check('swapped pair rejected', (function () {
  var s = Uint8Array.from(Cube.SOLVED);
  var a = Cube.EDGE_FACELETS[0], b = Cube.EDGE_FACELETS[1];
  for (var i = 0; i < 2; i++) { var t = s[a[i]]; s[a[i]] = s[b[i]]; s[b[i]] = t; }
  return !Cube.validate(s).ok;
})());
check('bad sticker count rejected', (function () {
  var s = Uint8Array.from(Cube.SOLVED);
  s[0] = s[9];
  return !Cube.validate(s).ok;
})());

console.log('\nsolving random scrambles');
var trials = parseInt(process.argv[2], 10) || 300;
var total = 0, max = 0, worstScramble = null, slowest = 0, badly = 0;
var t0 = Date.now();
for (var i = 0; i < trials; i++) {
  var scramble = Cube.randomScramble(30);
  var state = Cube.applySeq(Cube.SOLVED, scramble);
  var started = Date.now();
  try {
    var res = Solver.solve(state);
    var elapsed = Date.now() - started;
    if (elapsed > slowest) slowest = elapsed;
    var check1 = Cube.applySeq(state, res.moves);
    if (!Cube.isSolved(check1)) {
      badly++;
      console.log('  FAIL solution does not solve: ' + scramble.join(' '));
    }
    var replay = res.states[res.states.length - 1];
    if (!Cube.isSolved(replay)) {
      badly++;
      console.log('  FAIL state replay mismatch: ' + scramble.join(' '));
    }
    total += res.moves.length;
    if (res.moves.length > max) { max = res.moves.length; worstScramble = scramble.join(' '); }
  } catch (err) {
    badly++;
    console.log('  FAIL threw on ' + scramble.join(' ') + ' :: ' + err.message);
  }
}
check(trials + ' scrambles solved', badly === 0, badly + ' failures');
console.log('  avg moves: ' + (total / trials).toFixed(1) +
  '   longest: ' + max + '   slowest solve: ' + slowest + 'ms' +
  '   total: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (worstScramble) console.log('  worst scramble: ' + worstScramble);

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
