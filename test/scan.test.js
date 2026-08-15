/*
 * node test/scan.test.js
 * Feeds the color classifier synthetic camera samples — real sticker colors
 * pushed around by lighting, white balance and sensor noise — and checks it
 * still reconstructs the cube it started from.
 */
var Cube = require('../js/cube.js');
var Scanner = require('../js/scan.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// Roughly what a camera sees for each palette color: white yellow green blue red orange
var BASE = [
  [232, 233, 236], [236, 204, 62], [30, 150, 84],
  [26, 86, 178], [196, 46, 60], [225, 124, 40]
];

function makeSamples(colorState, opts) {
  // one global lighting tint plus per-sticker noise and vignetting
  var tint = [1 + (Math.random() - 0.5) * opts.tint, 1 + (Math.random() - 0.5) * opts.tint, 1 + (Math.random() - 0.5) * opts.tint];
  var samples = {};
  for (var face = 0; face < 6; face++) {
    var faceLight = 1 - Math.random() * opts.shade;
    samples[face] = [];
    for (var i = 0; i < 9; i++) {
      var base = BASE[colorState[face * 9 + i]];
      var px = [];
      for (var ch = 0; ch < 3; ch++) {
        var v = base[ch] * tint[ch] * faceLight + (Math.random() - 0.5) * opts.noise;
        px.push(Math.max(0, Math.min(255, v)));
      }
      samples[face].push(px);
    }
  }
  return samples;
}

function randomColorState() {
  var solved = new Int8Array(54);
  var faceColor = [0, 4, 2, 1, 5, 3]; // U R F D L B in palette ids
  for (var i = 0; i < 54; i++) solved[i] = faceColor[(i / 9) | 0];
  return Cube.applySeq(solved, Cube.randomScramble(25));
}

function run(label, opts, trials) {
  var perfect = 0, valid = 0, worstWrong = 0;
  for (var t = 0; t < trials; t++) {
    var truth = randomColorState();
    var got = Scanner.classify(makeSamples(truth, opts));
    var wrong = 0;
    for (var i = 0; i < 54; i++) if (got[i] !== truth[i]) wrong++;
    if (wrong === 0) perfect++;
    if (wrong > worstWrong) worstWrong = wrong;
    var solverState = Cube.toSolverSpace(got);
    if (solverState && Cube.validate(solverState).ok) valid++;
  }
  console.log('  ' + label + ': ' + perfect + '/' + trials + ' scans exact, ' +
    valid + '/' + trials + ' immediately valid, worst case ' + worstWrong + ' stickers off');
  return perfect / trials;
}

console.log('\ncolor classification');
var clean = run('clean light   ', { tint: 0.0, shade: 0.0, noise: 6 }, 60);
check('clean samples read perfectly', clean === 1);

var tinted = run('warm/dim light', { tint: 0.18, shade: 0.25, noise: 14 }, 60);
check('tinted, uneven light still reads perfectly', tinted === 1, (tinted * 100).toFixed(0) + '% exact');

// Harsh = strong color cast, half a stop of shading between faces, heavy noise.
// Anything it misses is a sticker the user fixes on the map in one click.
var rough = run('harsh light   ', { tint: 0.3, shade: 0.4, noise: 26 }, 60);
check('harsh light reads at least 85% of scans exactly', rough >= 0.85, (rough * 100).toFixed(0) + '% exact');

console.log('\nquota');
check('every color is used exactly nine times', (function () {
  for (var t = 0; t < 20; t++) {
    var got = Scanner.classify(makeSamples(randomColorState(), { tint: 0.3, shade: 0.4, noise: 40 }));
    var counts = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 54; i++) counts[got[i]]++;
    for (var c = 0; c < 6; c++) if (counts[c] !== 9) return false;
  }
  return true;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
