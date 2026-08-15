/*
 * node test/cuben.test.js
 *
 * The generic N-sized cube model. The load-bearing check is the first one: for
 * N=3 the geometry must produce byte-identical move tables to the hand-written
 * ones in cube.js, which are themselves proven by thousands of solved cubes.
 * If the generic model agrees with those, the same code is trustworthy at 4x4
 * and 5x5 where there is nothing to compare against.
 */
var Cube = require('../js/cube.js');
var CubeN = require('../js/cuben.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\n3x3: does the geometry agree with the hand-written tables?');
var three = CubeN.of(3);
check('same number of stickers', three.stickers === 54);
['U', 'R', 'F', 'D', 'L', 'B'].forEach(function (letter) {
  ['', '2', "'"].forEach(function (suffix) {
    var move = letter + suffix;
    var mine = three.MOVE_PERMS[move];
    var theirs = Cube.MOVE_PERMS[move];
    var identical = mine && theirs && mine.length === theirs.length &&
      Array.prototype.every.call(mine, function (v, i) { return v === theirs[i]; });
    check('move ' + move + ' matches cube.js exactly', identical);
  });
});

check('a scramble applied both ways gives the same cube', (function () {
  for (var t = 0; t < 200; t++) {
    var seq = Cube.randomScramble(25);
    var a = Cube.applySeq(Cube.SOLVED, seq);
    var b = three.applySeq(three.SOLVED, seq);
    for (var i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
  }
  return true;
})());

function suite(N) {
  console.log('\n' + N + 'x' + N);
  var cube = CubeN.of(N);
  check('sticker count is ' + (6 * N * N), cube.stickers === 6 * N * N);
  check('a solved cube reads as solved', cube.isSolved(cube.SOLVED));

  check('every move is a permutation — nothing lost, nothing duplicated', (function () {
    return cube.MOVE_NAMES.every(function (move) {
      var seen = new Uint8Array(cube.stickers);
      var perm = cube.MOVE_PERMS[move];
      for (var i = 0; i < perm.length; i++) {
        if (perm[i] < 0 || perm[i] >= cube.stickers || seen[perm[i]]) return false;
        seen[perm[i]] = 1;
      }
      return true;
    });
  })());

  check('any move four times is the identity', (function () {
    return cube.MOVE_NAMES.filter(function (m) { return m.length === 1 || !/['2]/.test(m[m.length - 1]); })
      .every(function (move) {
        return cube.isSolved(cube.applySeq(cube.SOLVED, [move, move, move, move]));
      });
  })());

  check('a move then its inverse is the identity', (function () {
    return cube.MOVE_NAMES.every(function (move) {
      var inverse = move.indexOf("'") >= 0 ? move.replace("'", '') :
        (move.indexOf('2') >= 0 ? move : move + "'");
      return cube.isSolved(cube.applySeq(cube.SOLVED, [move, inverse]));
    });
  })());

  check('a scramble undone move by move comes back solved', (function () {
    for (var t = 0; t < 50; t++) {
      var seq = cube.randomScramble(40);
      var state = cube.applySeq(cube.SOLVED, seq);
      for (var i = seq.length - 1; i >= 0; i--) {
        var m = seq[i];
        var inv = m.indexOf("'") >= 0 ? m.replace("'", '') : (m.indexOf('2') >= 0 ? m : m + "'");
        state = cube.apply(state, inv);
      }
      if (!cube.isSolved(state)) return false;
    }
    return true;
  })());

  check('every colour still appears the right number of times after scrambling', (function () {
    var per = N * N;
    for (var t = 0; t < 50; t++) {
      var state = cube.applySeq(cube.SOLVED, cube.randomScramble(40));
      var tally = [0, 0, 0, 0, 0, 0];
      for (var i = 0; i < state.length; i++) tally[state[i]]++;
      for (var c = 0; c < 6; c++) if (tally[c] !== per) return false;
    }
    return true;
  })());

  check('an outer turn leaves the opposite face alone', (function () {
    var after = cube.apply(cube.SOLVED, 'U');
    for (var i = 3 * N * N; i < 4 * N * N; i++) if (after[i] !== cube.SOLVED[i]) return false;
    return true;
  })());

  return cube;
}

var four = suite(4);
suite(5);

console.log('\n4x4 specifics');
check('has inner-layer moves the 3x3 does not', (function () {
  return four.MOVE_PERMS['u'] && four.MOVE_PERMS['r'] && four.MOVE_PERMS['f'] &&
    four.MOVE_PERMS['d'] && four.MOVE_PERMS['l'] && four.MOVE_PERMS['b'] &&
    !CubeN.of(3).MOVE_PERMS['u'];
})());

check('the inner slice does not disturb either outer face', (function () {
  var after = four.apply(four.SOLVED, 'u');
  for (var i = 0; i < 16; i++) if (after[i] !== four.SOLVED[i]) return false;          // U
  for (var j = 48; j < 64; j++) if (after[j] !== four.SOLVED[j]) return false;         // D
  return true;
})());

check('centres move on a 4x4 — the thing that breaks the 3x3 assumptions', (function () {
  // On a 3x3 the centre sticker never moves. On a 4x4 the four centre stickers
  // of a face are pieces in their own right, and an inner slice turn moves them.
  var after = four.apply(four.SOLVED, 'u');
  var centreCells = [5, 6, 9, 10];             // the middle 2x2 of the front face
  var moved = centreCells.some(function (cell) {
    return after[2 * 16 + cell] !== four.SOLVED[2 * 16 + cell];
  });
  return moved;
})());

check('u and U turn the same way round', (function () {
  // Both take the front face towards the left, one layer apart. Compare the
  // sticker each brings to the front face from the right.
  var byU = four.apply(four.SOLVED, 'U');
  var byu = four.apply(four.SOLVED, 'u');
  return byU[2 * 16 + 0] === byu[2 * 16 + 4] && byU[2 * 16 + 0] === 1;   // both pull red onto the front
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
