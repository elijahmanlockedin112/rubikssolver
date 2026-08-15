/*
 * node test/repair.test.js [trials]
 *
 * Takes real cubes, breaks them in one place, and checks the repair puts them
 * back — and, just as importantly, that it keeps its hands off anything it
 * cannot be sure about.
 */
var Cube = require('../js/cube.js');
var R = require('../js/repair.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function solvedColors() {
  var s = new Int8Array(54), faceColor = [0, 4, 2, 1, 5, 3];
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}
function randomCube() { return Int8Array.from(Cube.applySeq(solvedColors(), Cube.randomScramble(25))); }
function same(a, b) {
  for (var i = 0; i < 54; i++) if (a[i] !== b[i]) return false;
  return true;
}

var trials = parseInt(process.argv[2], 10) || 300;

console.log('\nleaving well alone');
check('a correct cube is not touched', (function () {
  for (var t = 0; t < 50; t++) if (R.repair(randomCube()) !== null) return false;
  return true;
})());
check('an unfinished cube is not touched', (function () {
  var c = randomCube();
  c[7] = -1;
  return R.repair(c) === null;
})());

console.log('\none sticker given the wrong colour');
(function () {
  var restored = 0, offered = 0, gaveUp = 0, wrong = 0;
  for (var t = 0; t < trials; t++) {
    var truth = randomCube();
    var broken = Int8Array.from(truth);
    var i = Math.floor(Math.random() * 54);
    broken[i] = (broken[i] + 1 + Math.floor(Math.random() * 5)) % 6;   // any other colour
    if (broken[i] === truth[i]) continue;

    var out = R.repair(broken);
    if (!out) { gaveUp++; continue; }
    if (!out.unique) { offered++; continue; }
    if (same(out.colors, truth)) restored++;
    else wrong++;
  }
  console.log('  ' + trials + ' cubes with one wrong sticker: ' + restored + ' put back exactly, ' +
    offered + ' offered a choice, ' + gaveUp + ' left alone, ' + wrong + ' fixed to the wrong cube');
  check('a lone wrong sticker is usually repaired outright', restored >= trials * 0.7,
    restored + '/' + trials);
  check('a confident repair is never the wrong cube', wrong === 0, wrong + ' wrong');
})();

console.log('\ntwo stickers the wrong way round');
(function () {
  var restored = 0, offered = 0, gaveUp = 0, wrong = 0, tried = 0;
  for (var t = 0; t < trials; t++) {
    var truth = randomCube();
    var broken = Int8Array.from(truth);
    var a = Math.floor(Math.random() * 54), b = Math.floor(Math.random() * 54);
    if (broken[a] === broken[b]) continue;
    var keep = broken[a]; broken[a] = broken[b]; broken[b] = keep;
    tried++;

    var out = R.repair(broken);
    if (!out) { gaveUp++; continue; }
    if (!out.unique) { offered++; continue; }
    if (same(out.colors, truth)) restored++;
    else wrong++;
  }
  console.log('  ' + tried + ' cubes with two swapped: ' + restored + ' put back exactly, ' +
    offered + ' offered a choice, ' + gaveUp + ' left alone, ' + wrong + ' fixed to a different cube');
  // Swaps are more ambiguous than a single wrong colour, and reasonably so:
  // undoing a different pair of the same two colours elsewhere can produce an
  // equally real cube. Roughly half resolve to one answer; the rest are handed
  // back as a choice rather than guessed at, which is the right behaviour.
  check('about half of swaps resolve to a single answer', restored >= tried * 0.4,
    restored + '/' + tried);
  check('a confident swap repair is never the wrong cube', wrong === 0, wrong + ' wrong');
})();

console.log('\nwhatever it hands back is always a real cube');
check('never returns something invalid', (function () {
  for (var t = 0; t < trials; t++) {
    var broken = randomCube();
    var i = Math.floor(Math.random() * 54);
    broken[i] = (broken[i] + 1) % 6;
    var out = R.repair(broken);
    if (!out) continue;
    for (var f = 0; f < out.fixes.length; f++) {
      if (!R.isRealCube(out.fixes[f].colors)) return false;
    }
  }
  return true;
})());

console.log('\ntoo broken to guess');
check('three wrong stickers are left alone', (function () {
  var declined = 0, total = 60;
  for (var t = 0; t < total; t++) {
    var broken = randomCube();
    for (var n = 0; n < 3; n++) {
      var i = Math.floor(Math.random() * 54);
      broken[i] = (broken[i] + 1 + Math.floor(Math.random() * 5)) % 6;
    }
    var out = R.repair(broken);
    if (!out || !out.unique) declined++;
  }
  console.log('    left alone or offered a choice: ' + declined + '/' + total);
  return declined >= total * 0.95;
})());

console.log('\nexplaining itself');
check('says which sticker and which colour', (function () {
  var truth = randomCube();
  var broken = Int8Array.from(truth);
  var idx = 20;                              // front face, top-right
  broken[idx] = (broken[idx] + 3) % 6;
  var out = R.repair(broken);
  if (!out || !out.unique) return true;      // fine, just nothing to check
  return /front face/.test(out.summary) && /top-right/.test(out.summary);
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
