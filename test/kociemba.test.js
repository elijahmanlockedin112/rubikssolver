/*
 * node test/kociemba.test.js [trials]
 * Checks the cubie layer, the coordinate round-trips, then solves scrambles.
 */
var Cube = require('../js/cube.js');
var K = require('../js/kociemba.js');
var I = K._internals;

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\ncubie layer');
check('solved cube is the identity', (function () {
  var cc = K.toCubie(Cube.SOLVED);
  for (var i = 0; i < 8; i++) if (cc.cp[i] !== i || cc.co[i] !== 0) return false;
  for (var j = 0; j < 12; j++) if (cc.ep[j] !== j || cc.eo[j] !== 0) return false;
  return true;
})());

check('cubie multiply matches the facelet engine', (function () {
  for (var t = 0; t < 200; t++) {
    var seq = Cube.randomScramble(12);
    var viaFacelets = K.toCubie(Cube.applySeq(Cube.SOLVED, seq));
    var cc = K.identityCubie();
    for (var i = 0; i < seq.length; i++) {
      cc = K.multiply(cc, I.MOVE_CUBIE[K.MOVE_NAMES.indexOf(seq[i])]);
    }
    for (var a = 0; a < 8; a++) if (cc.cp[a] !== viaFacelets.cp[a] || cc.co[a] !== viaFacelets.co[a]) return false;
    for (var b = 0; b < 12; b++) if (cc.ep[b] !== viaFacelets.ep[b] || cc.eo[b] !== viaFacelets.eo[b]) return false;
  }
  return true;
})());

console.log('\ncoordinates');
check('permutation index round-trips', (function () {
  for (var i = 0; i < 40320; i += 137) {
    if (I.permToIndex(I.indexToPerm(i, 8)) !== i) return false;
  }
  for (var j = 0; j < 24; j++) if (I.permToIndex(I.indexToPerm(j, 4)) !== j) return false;
  return true;
})());

function roundTrip(size, setter, getter, patch) {
  for (var v = 0; v < size; v++) {
    var cc = K.identityCubie();
    setter(cc, v);
    if (getter(cc) !== v) return 'value ' + v + ' -> ' + getter(cc);
  }
  return null;
}
check('twist round-trips', roundTrip(2187, I.setTwist, I.getTwist) === null, roundTrip(2187, I.setTwist, I.getTwist));
check('flip round-trips', roundTrip(2048, I.setFlip, I.getFlip) === null, roundTrip(2048, I.setFlip, I.getFlip));
check('slice round-trips', roundTrip(495, I.setSlice, I.getSlice) === null, roundTrip(495, I.setSlice, I.getSlice));
check('slice of a solved cube is 0', I.getSlice(K.toCubie(Cube.SOLVED)) === 0);
check('corner permutation round-trips', roundTrip(40320, I.setCornPerm, I.getCornPerm) === null);
check('slice2 round-trips', roundTrip(24, I.setSlice2, I.getSlice2) === null);

console.log('\nbuilding tables');
var tb = Date.now();
K.prepareSync();
console.log('  built in ' + ((Date.now() - tb) / 1000).toFixed(1) + 's');
check('tables ready', K.isReady());

console.log('\nsolving random scrambles');
var trials = parseInt(process.argv[2], 10) || 100;
var total = 0, max = 0, bad = 0, slowest = 0, worst = null;
var t0 = Date.now();
for (var i = 0; i < trials; i++) {
  var scramble = Cube.randomScramble(30);
  var state = Cube.applySeq(Cube.SOLVED, scramble);
  var started = Date.now();
  var moves = K.solveMoves(state);
  var ms = Date.now() - started;
  if (ms > slowest) { slowest = ms; worst = scramble.join(' '); }
  if (!Cube.isSolved(Cube.applySeq(state, moves))) {
    bad++;
    console.log('  FAIL did not solve: ' + scramble.join(' '));
  }
  total += moves.length;
  if (moves.length > max) max = moves.length;
}
check(trials + ' scrambles solved', bad === 0, bad + ' failures');
console.log('  avg moves: ' + (total / trials).toFixed(1) +
  '   longest: ' + max +
  '   slowest: ' + slowest + 'ms' +
  '   total: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
if (worst) console.log('  slowest scramble: ' + worst);

console.log('\nedge cases');
check('already-solved cube returns no moves', K.solveMoves(Cube.SOLVED).length === 0);
check('one-move scramble solves in one move', (function () {
  var s = Cube.applySeq(Cube.SOLVED, ['R']);
  var m = K.solveMoves(s);
  return m.length === 1 && Cube.isSolved(Cube.applySeq(s, m));
})());
check('superflip solves', (function () {
  var sf = Cube.parse("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  var s = Cube.applySeq(Cube.SOLVED, sf);
  var m = K.solveMoves(s);
  console.log('    superflip solution: ' + m.length + ' moves');
  return Cube.isSolved(Cube.applySeq(s, m));
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
