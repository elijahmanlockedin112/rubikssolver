/*
 * node test/assemble.test.js [trials]
 *
 * Photograph the six faces in a random order, each at a random rotation, under
 * awkward light — then check the cube comes back exactly as it went in.
 */
var Cube = require('../js/cube.js');
var A = require('../js/assemble.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// white yellow green blue red orange, roughly as a camera sees them
var BASE = [
  [232, 233, 236], [236, 204, 62], [30, 150, 84],
  [26, 86, 178], [196, 46, 60], [225, 124, 40]
];

function solvedColors(faceColor) {
  var s = new Int8Array(54);
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}
function standardCube() { return solvedColors([0, 4, 2, 1, 5, 3]); }   // U R F D L B

function randomCube() {
  return Cube.applySeq(standardCube(), Cube.randomScramble(25));
}

function rotate(cells, k) { return A.rotateFace(cells, k); }

function shuffle(list) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/** Photograph a cube: random face order, random rotations, per-face lighting. */
function photograph(colors, opts) {
  opts = opts || {};
  var order = opts.order || shuffle([0, 1, 2, 3, 4, 5]);
  var turns = opts.turns || order.map(function () { return Math.floor(Math.random() * 4); });
  var tint = [1 + (Math.random() - 0.5) * (opts.tint || 0),
    1 + (Math.random() - 0.5) * (opts.tint || 0),
    1 + (Math.random() - 0.5) * (opts.tint || 0)];
  var captures = order.map(function (face, n) {
    var cells = [];
    for (var i = 0; i < 9; i++) cells.push(colors[face * 9 + i]);
    cells = rotate(cells, turns[n]);
    var light = 1 - Math.random() * (opts.shade || 0);
    return cells.map(function (c) {
      return BASE[c].map(function (v, ch) {
        return Math.max(0, Math.min(255, v * tint[ch] * light + (Math.random() - 0.5) * (opts.noise || 0)));
      });
    });
  });
  return { captures: captures, order: order, turns: turns };
}

function sameCube(a, b) {
  for (var i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log('\nrotating a face');
check('four quarter turns is the identity', (function () {
  var cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return A.rotateFace(cells, 4).join() === cells.join();
})());
check('one quarter turn moves the corners the right way', (function () {
  // clockwise: the top-left sticker ends up top-right
  return A.rotateFace([0, 1, 2, 3, 4, 5, 6, 7, 8], 1).join() === [6, 3, 0, 7, 4, 1, 8, 5, 2].join();
})());
check('the centre never moves', (function () {
  for (var k = 0; k < 4; k++) if (A.rotateFace([0, 1, 2, 3, 4, 5, 6, 7, 8], k)[4] !== 4) return false;
  return true;
})());

console.log('\nopposite colours');
check('all fifteen pairings are generated, the usual one first', (function () {
  var all = A.allPairings();
  if (all.length !== 15) return false;
  var seen = {};
  all.forEach(function (p) { seen[p.map(function (q) { return q.slice().sort().join('-'); }).sort().join(' ')] = true; });
  if (Object.keys(seen).length !== 15) return false;
  var first = A.orderedPairings()[0];
  return first.map(function (p) { return p.slice().sort().join('-'); }).sort().join(' ') === '0-1 2-3 4-5';
})());

// This is the assumption that used to be baked in, and it is false. Keeping it
// as a test so nobody re-introduces the shortcut.
check('a scrambled face really can show its own opposite colour', (function () {
  for (var t = 0; t < 200; t++) {
    var cube = randomCube();
    for (var f = 0; f < 6; f++) {
      var center = cube[f * 9 + 4];
      var opposite = center === 0 ? 1 : center === 1 ? 0 : center === 2 ? 3 : center === 3 ? 2 : center === 4 ? 5 : 4;
      for (var i = 0; i < 9; i++) if (cube[f * 9 + i] === opposite) return true;
    }
  }
  return false;
})());

check('only two layouts are tried per pairing', A.candidateAssignments([[0, 1], [2, 3], [4, 5]]).length === 2);
check('the usual scheme lands white up, green front, red right', (function () {
  var map = A.candidateAssignments([[0, 1], [2, 3], [4, 5]])[0].map;
  return map[0] === 0 && map[2] === 2 && map[4] === 1;
})());

console.log('\nassembling');
var trials = parseInt(process.argv[2], 10) || 40;

/** How many stickers did the colour naming itself get wrong? */
function misreadCount(shot, truth) {
  var named = A.classifyCaptures(shot.captures);
  var wrong = 0;
  shot.order.forEach(function (face, n) {
    var cells = [];
    for (var i = 0; i < 9; i++) cells.push(truth[face * 9 + i]);
    cells = A.rotateFace(cells, shot.turns[n]);
    for (var k = 0; k < 9; k++) if (named[n * 9 + k] !== cells[k]) wrong++;
  });
  return wrong;
}

function run(label, opts, trials) {
  var exact = 0, flagged = 0, misread = 0, unassembled = 0, worstChecked = 0, slowest = 0;
  for (var t = 0; t < trials; t++) {
    var truth = randomCube();
    var shot = photograph(truth, opts);
    var started = Date.now();
    var result = A.assemble(shot.captures);
    var ms = Date.now() - started;
    if (ms > slowest) slowest = ms;
    if (result.checked > worstChecked) worstChecked = result.checked;

    if (result.ok && sameCube(result.colors, truth)) { exact++; continue; }
    var bad = misreadCount(shot, truth);
    if (bad) misread++;
    else if (!result.ok) unassembled++;
    else if (result.ambiguous) flagged++;
    else {
      console.log('    SILENTLY WRONG: a different cube, read correctly, not flagged');
      unassembled++;
    }
  }
  console.log('  ' + label + ': ' + exact + '/' + trials + ' exact, ' + flagged +
    ' ambiguous (flagged), ' + misread + ' colour misreads, ' + unassembled + ' no fit' +
    '  [worst ' + worstChecked + ' combos, ' + slowest + 'ms]');
  return { exact: exact, flagged: flagged, misread: misread, unassembled: unassembled, trials: trials };
}

// How people actually hold a cube: roughly the same way up for every photo.
var upright = run('held upright ', { tint: 0.14, shade: 0.2, noise: 10, turns: [0, 0, 0, 0, 0, 0] }, trials);
check('every cube recovered when the photos are upright', upright.exact === trials,
  upright.exact + '/' + trials);

// The hard case: every face at a random rotation, which is what the feature promises.
var spun = run('any rotation ', { tint: 0.14, shade: 0.2, noise: 10 }, trials);
check('no cube is ever silently wrong', spun.exact + spun.flagged + spun.misread + spun.unassembled === trials);
check('at least 95% land exactly right', spun.exact >= trials * 0.95,
  spun.exact + '/' + trials + ' exact');
check('anything not exact was flagged or refused, never returned quietly',
  spun.exact + spun.flagged + spun.misread + spun.unassembled === trials);

console.log('\norder and rotation really are free');
check('every rotation of a single face is handled', (function () {
  var truth = randomCube();
  for (var k = 0; k < 4; k++) {
    var shot = photograph(truth, { order: [0, 1, 2, 3, 4, 5], turns: [k, 0, 0, 0, 0, 0] });
    var out = A.assemble(shot.captures);
    if (!out.ok || !sameCube(out.colors, truth)) return false;
  }
  return true;
})());

check('photographing the faces backwards works', (function () {
  var truth = randomCube();
  var shot = photograph(truth, { order: [5, 4, 3, 2, 1, 0], turns: [2, 3, 1, 0, 2, 1] });
  var out = A.assemble(shot.captures);
  return out.ok && sameCube(out.colors, truth);
})());

check('a solved cube still assembles', (function () {
  var truth = standardCube();
  var shot = photograph(truth, {});
  var out = A.assemble(shot.captures);
  return out.ok && sameCube(out.colors, truth);
})());

check('a non-standard colour scheme assembles', (function () {
  // build a cube whose opposite pairs are white/green, yellow/blue, red/orange
  var faceColor = [0, 4, 1, 2, 5, 3]; // U=white R=red F=yellow D=green L=orange B=blue
  var truth = Cube.applySeq(solvedColors(faceColor), Cube.randomScramble(20));
  var shot = photograph(truth, {});
  var out = A.assemble(shot.captures);
  return out.ok && sameCube(out.colors, truth);
})());

console.log('\nrefusing the impossible');
check('two photos of the same face are called out', (function () {
  var truth = randomCube();
  var shot = photograph(truth, { order: [0, 1, 2, 3, 4, 0] });
  var out = A.assemble(shot.captures);
  return !out.ok && /same colour in the middle/.test(out.message);
})());

check('a misread sticker is reported rather than guessed at', (function () {
  var truth = randomCube();
  var shot = photograph(truth, { order: [0, 1, 2, 3, 4, 5], turns: [0, 0, 0, 0, 0, 0] });
  // corrupt one sticker into a colour that cannot be there
  var target = shot.captures[0][1];
  var wrongColor = BASE[(truth[1] + 3) % 6];
  target[0] = wrongColor[0]; target[1] = wrongColor[1]; target[2] = wrongColor[2];
  var out = A.assemble(shot.captures);
  return !out.ok && /do not fit together/.test(out.message);
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
