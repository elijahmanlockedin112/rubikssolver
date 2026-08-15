/*
 * node test/colors.test.js [trials]
 *
 * Colour naming, tested against colours measured off a real cube rather than
 * invented ones. Every value below was read by the detector from actual camera
 * frames (a stickerless cube, indoor light, handheld) â€” see testdata/.
 *
 * Red versus orange is the pair that matters. Under the old hue-based metric
 * these two sat 1.06x apart relative to their own spread, i.e. touching, and
 * yellow and green actually overlapped. That is what made stickers swap and
 * made two different faces look like the same face.
 */
var Cube = require('../js/cube.js');
var A = require('../js/assemble.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' â€” ' + extra : '')); }
}

// Palette order: white yellow green blue red orange
var REAL = [
  [[228, 184, 135], [224, 201, 173], [231, 209, 174], [226, 205, 167], [242, 211, 200], [245, 214, 202], [246, 219, 207], [243, 213, 201]],
  [[232, 204, 0], [227, 200, 0], [224, 207, 0], [239, 209, 0], [244, 217, 1], [243, 210, 0], [239, 210, 0]],
  [[73, 187, 40], [52, 178, 21], [48, 177, 15], [101, 188, 19], [34, 179, 70], [97, 196, 34], [74, 192, 10], [59, 170, 4]],
  [[58, 123, 197], [15, 94, 174], [46, 109, 203], [9, 96, 195], [24, 95, 187], [9, 97, 167], [12, 101, 176]],
  [[224, 32, 20], [223, 18, 10], [228, 37, 0], [214, 20, 0], [220, 17, 0], [224, 38, 0], [235, 30, 2]],
  [[249, 98, 0], [248, 101, 0], [245, 97, 0], [250, 104, 0], [252, 98, 0], [253, 96, 0], [254, 96, 0], [254, 95, 0]]
];
var NAMES = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];

function pick(color) { return REAL[color][Math.floor(Math.random() * REAL[color].length)]; }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

console.log('\nseparation between the six colours');
(function () {
  var worstPair = null, worstMargin = Infinity;
  for (var i = 0; i < 6; i++) {
    var spreadI = 0;
    REAL[i].forEach(function (p) { REAL[i].forEach(function (q) { spreadI = Math.max(spreadI, A.colorCost(p, q)); }); });
    for (var j = i + 1; j < 6; j++) {
      var spreadJ = 0;
      REAL[j].forEach(function (p) { REAL[j].forEach(function (q) { spreadJ = Math.max(spreadJ, A.colorCost(p, q)); }); });
      var closest = Infinity;
      REAL[i].forEach(function (p) { REAL[j].forEach(function (q) { closest = Math.min(closest, A.colorCost(p, q)); }); });
      var margin = closest / Math.max(spreadI, spreadJ, 0.001);
      if (margin < worstMargin) { worstMargin = margin; worstPair = NAMES[i] + '/' + NAMES[j]; }
    }
  }
  console.log('  tightest pair: ' + worstPair + ' at ' + worstMargin.toFixed(2) + 'x its own spread');
  check('no two colours overlap', worstMargin > 1, worstPair + ' at ' + worstMargin.toFixed(2) + 'x');
})();

console.log('\ntelling two faces apart (the "same as face 3" bug)');
var DUPLICATE_LIMIT = 12;

// The threshold cannot catch every repeat without also accusing red of being
// orange, and those two mistakes are not equally bad. A repeat that slips
// through fails to assemble a few seconds later, with an explanation. A false
// accusation blocks a face that was perfectly fine and leaves the user stuck.
// So this asks that most repeats are caught, and that false accusations are
// impossible.
check('most repeats are caught', (function () {
  var caught = 0, total = 600;
  for (var t = 0; t < total; t++) {
    var base = pick(Math.floor(Math.random() * 6));
    function shot() {
      var light = rand(0.92, 1.06);
      return base.map(function (v) {
        return Math.max(0, Math.min(255, v * light + (Math.random() - 0.5) * 10));
      });
    }
    if (A.colorCost(shot(), shot()) < DUPLICATE_LIMIT) caught++;
  }
  console.log('    two shots of one face flagged as a repeat: ' +
    Math.round(caught / total * 100) + '%');
  return caught / total >= 0.9;
})());

check('a red face is never mistaken for an orange one', (function () {
  var closest = Infinity;
  REAL[4].forEach(function (p) { REAL[5].forEach(function (q) { closest = Math.min(closest, A.colorCost(p, q)); }); });
  console.log('    closest red/orange centres: ' + closest.toFixed(1) +
    ' (must clear ' + DUPLICATE_LIMIT + ')');
  return closest >= DUPLICATE_LIMIT;
})());

check('no two different colours ever read as one repeated face', (function () {
  var closest = Infinity, pair = '';
  for (var i = 0; i < 6; i++) {
    for (var j = i + 1; j < 6; j++) {
      for (var a = 0; a < REAL[i].length; a++) {
        for (var b = 0; b < REAL[j].length; b++) {
          var d = A.colorCost(REAL[i][a], REAL[j][b]);
          if (d < closest) { closest = d; pair = NAMES[i] + '/' + NAMES[j]; }
        }
      }
    }
  }
  console.log('    closest two different colours: ' + pair + ' at ' + closest.toFixed(1));
  return closest >= DUPLICATE_LIMIT;
})());

console.log('\nreading whole cubes made of real colours');
function solvedColors() {
  var s = new Int8Array(54), faceColor = [0, 4, 2, 1, 5, 3];
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}
function shuffleOrder() {
  var o = [0, 1, 2, 3, 4, 5];
  for (var i = 5; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = o[i]; o[i] = o[j]; o[j] = t; }
  return o;
}

var trials = parseInt(process.argv[2], 10) || 200;
(function () {
  var exact = 0, misread = 0, rejected = 0, flagged = 0;
  for (var t = 0; t < trials; t++) {
    var truth = Cube.applySeq(solvedColors(), Cube.randomScramble(25));
    var order = shuffleOrder();
    var captures = order.map(function (face) {
      // each face gets its own lamp brightness, as six real photos would
      var light = rand(0.78, 1.06);
      var cells = [];
      for (var i = 0; i < 9; i++) {
        var base = pick(truth[face * 9 + i]);
        cells.push(base.map(function (v) {
          return Math.max(0, Math.min(255, v * light + (Math.random() - 0.5) * 10));
        }));
      }
      return A.rotateFace(cells, Math.floor(Math.random() * 4));
    });

    var result = A.assemble(captures);
    if (result.ok) {
      var same = true;
      for (var k = 0; k < 54; k++) if (result.colors[k] !== truth[k]) { same = false; break; }
      if (same) exact++;
      else if (result.ambiguous) flagged++;
      else misread++;
    } else rejected++;
  }
  console.log('  ' + trials + ' cubes: ' + exact + ' exact, ' + flagged +
    ' ambiguous (flagged), ' + misread + ' silently wrong, ' + rejected + ' refused');
  // Silently wrong is the only unacceptable outcome: it hands over a solution
  // for a cube that is not the one in your hands. Flagged and refused both tell
  // the user something is up.
  check('no cube is ever silently wrong', misread === 0, misread + ' of ' + trials);
  check('at least 99% are read exactly', exact >= trials * 0.99, exact + '/' + trials);
})();

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);


