/*
 * node test/detect.test.js [trials]
 *
 * Paints synthetic photos of a cube face — rotated, off-centre, at various
 * sizes, on various backgrounds, under uneven light — and checks the detector
 * finds the 3x3 grid.
 *
 * Note what is and is not measured here. The detector's job is geometry: work
 * out where the nine stickers are. Deciding that a particular patch is "orange
 * rather than red" is not its job — that needs all six faces together, and it
 * belongs to assemble.js, which is tested in assemble.test.js. Judging this
 * file's output with a naive nearest-colour match would fail it for the
 * classifier's reasons, so geometry is checked directly, and the end of this
 * file runs the real pipeline end to end.
 */
var D = require('../js/detect.js');
var A = require('../js/assemble.js');
var Cube = require('../js/cube.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var BASE = [
  [238, 238, 236], [247, 209, 58], [22, 152, 82],
  [22, 82, 178], [198, 40, 54], [232, 126, 34]
];

/**
 * Draw one face. opts: angle (rad), scale (px per cell), cx/cy (centre),
 * background rgb, shade (light falloff), noise, gap (fraction of a cell).
 */
function renderFace(cells, opts) {
  var W = opts.width || 480, H = opts.height || 360;
  var data = new Uint8ClampedArray(W * H * 4);
  var cos = Math.cos(-opts.angle), sin = Math.sin(-opts.angle);
  var gap = opts.gap === undefined ? 0.1 : opts.gap;
  var plastic = [26, 26, 28];

  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var dx = (x - opts.cx) / opts.scale, dy = (y - opts.cy) / opts.scale;
      var u = dx * cos - dy * sin + 1.5;
      var v = dx * sin + dy * cos + 1.5;
      var rgb;
      if (u >= 0 && u < 3 && v >= 0 && v < 3) {
        var col = Math.floor(u), row = Math.floor(v);
        var fu = u - col, fv = v - row;
        var onPlastic = fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap;
        rgb = onPlastic ? plastic : BASE[cells[row * 3 + col]];
      } else {
        rgb = opts.background || [120, 120, 125];
      }
      var light = 1 - (opts.shade || 0) * (x / W * 0.6 + y / H * 0.4);
      var o = (y * W + x) * 4;
      for (var c = 0; c < 3; c++) data[o + c] = rgb[c] * light + (Math.random() - 0.5) * (opts.noise || 0);
      data[o + 3] = 255;
    }
  }
  return { data: data, width: W, height: H };
}

/** Where the nine sticker centres really ended up, in image pixels. */
function trueCenters(opts) {
  var ca = Math.cos(opts.angle), sa = Math.sin(opts.angle);
  var out = [];
  for (var row = 0; row < 3; row++) {
    for (var col = 0; col < 3; col++) {
      var du = col + 0.5 - 1.5, dv = row + 0.5 - 1.5;
      var dx = du * ca - dv * sa, dy = du * sa + dv * ca;
      out.push({ x: opts.cx + dx * opts.scale, y: opts.cy + dy * opts.scale });
    }
  }
  return out;
}

function randomCells() {
  var cells = [];
  for (var i = 0; i < 9; i++) cells.push(Math.floor(Math.random() * 6));
  return cells;
}
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

/** Did it find the real grid, in the right order? */
function gridError(opts, found) {
  var truth = trueCenters(opts);
  var worst = 0;
  for (var i = 0; i < 9; i++) {
    var d = Math.hypot(found.points[i].x - truth[i].x, found.points[i].y - truth[i].y);
    if (d > worst) worst = d;
  }
  return worst / opts.scale;   // as a fraction of one cell
}

var trials = parseInt(process.argv[2], 10) || 60;

function sweep(label, make) {
  var good = 0, notFound = 0, wrongGrid = 0, worstErr = 0, slowest = 0;
  for (var t = 0; t < trials; t++) {
    var opts = make();
    var started = Date.now();
    var found = D.detectFace(renderFace(randomCells(), opts));
    var ms = Date.now() - started;
    if (ms > slowest) slowest = ms;
    if (!found) { notFound++; continue; }
    var err = gridError(opts, found);
    if (err < 0.3) { good++; if (err > worstErr) worstErr = err; }
    else wrongGrid++;
  }
  console.log('  ' + label + ': ' + good + '/' + trials + ' located, ' + notFound +
    ' not found, ' + wrongGrid + ' wrong grid  [worst offset ' +
    (worstErr * 100).toFixed(0) + '% of a cell, ' + slowest + 'ms]');
  return good / trials;
}

console.log('\nlocating the grid');

check('a square-on face is always found', sweep('square on   ', function () {
  return { angle: 0, scale: rand(45, 95), cx: 240, cy: 180, shade: 0.15, noise: 8 };
}) === 1);

check('a tilted face is always found', sweep('tilted      ', function () {
  return { angle: rand(-0.3, 0.3), scale: rand(45, 95), cx: 240, cy: 180, shade: 0.2, noise: 10 };
}) === 1);

check('an off-centre face at any size is always found', sweep('off-centre  ', function () {
  return { angle: rand(-0.25, 0.25), scale: rand(40, 80), cx: rand(150, 330), cy: rand(110, 250), shade: 0.25, noise: 12 };
}) === 1);

var messy = sweep('busy room   ', function () {
  return {
    angle: rand(-0.3, 0.3), scale: rand(40, 85), cx: rand(160, 320), cy: rand(110, 250),
    shade: 0.35, noise: 18, background: [rand(30, 220), rand(30, 220), rand(30, 220)]
  };
});
check('a random background does not throw it off', messy >= 0.98, (messy * 100).toFixed(0) + '%');

console.log('\nrefusing what is not a cube');
check('an empty frame is refused', (function () {
  for (var t = 0; t < 20; t++) {
    var img = renderFace(randomCells(), { angle: 0, scale: 60, cx: 3000, cy: 3000, noise: 6 });
    if (D.detectFace(img)) return false;
  }
  return true;
})());
check('a plain wall is refused', (function () {
  for (var t = 0; t < 20; t++) {
    var W = 320, H = 240, data = new Uint8ClampedArray(W * H * 4);
    for (var i = 0; i < W * H; i++) {
      data[i * 4] = 180 + (Math.random() - 0.5) * 10;
      data[i * 4 + 1] = 178 + (Math.random() - 0.5) * 10;
      data[i * 4 + 2] = 172 + (Math.random() - 0.5) * 10;
      data[i * 4 + 3] = 255;
    }
    if (D.detectFace({ data: data, width: W, height: H })) return false;
  }
  return true;
})());

console.log('\nawkward cases');
check('a sticker lost to glare is filled in from the grid', (function () {
  var opts = { angle: 0, scale: 70, cx: 240, cy: 180, shade: 0, noise: 0 };
  var img = renderFace(randomCells(), opts);
  for (var y = 120; y < 160; y++) {
    for (var x = 180; x < 220; x++) {
      var o = (y * img.width + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
    }
  }
  var found = D.detectFace(img);
  return !!found && found.points.length === 9 && gridError(opts, found) < 0.3;
})());

check('the reading comes out upright, not upside down', (function () {
  // the drawn grid and the returned grid must agree on which cell is top-left
  for (var t = 0; t < 30; t++) {
    var opts = { angle: rand(-0.3, 0.3), scale: rand(50, 90), cx: 240, cy: 180, shade: 0.2, noise: 8 };
    var found = D.detectFace(renderFace(randomCells(), opts));
    if (!found || gridError(opts, found) > 0.3) return false;
  }
  return true;
})());

// ---- the whole pipeline -------------------------------------------------
console.log('\nend to end: six photos in, one cube out');

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

(function () {
  var runs = Math.max(8, Math.round(trials / 4));
  var exact = 0, flagged = 0, failed = 0, undetected = 0;
  for (var t = 0; t < runs; t++) {
    var truth = Cube.applySeq(solvedColors(), Cube.randomScramble(25));
    var order = shuffleOrder();
    var captures = [], missed = false;
    for (var n = 0; n < 6 && !missed; n++) {
      var face = order[n];
      var cells = [];
      for (var i = 0; i < 9; i++) cells.push(truth[face * 9 + i]);
      var turns = Math.floor(Math.random() * 4);
      cells = A.rotateFace(cells, turns);
      var opts = {
        angle: rand(-0.22, 0.22), scale: rand(45, 85),
        cx: rand(180, 300), cy: rand(120, 240),
        shade: rand(0.1, 0.3), noise: 12,
        background: [rand(40, 200), rand(40, 200), rand(40, 200)]
      };
      var found = D.detectFace(renderFace(cells, opts));
      if (!found) { missed = true; break; }
      captures.push(found.samples);
    }
    if (missed) { undetected++; continue; }

    var result = A.assemble(captures);
    if (result.ok) {
      var same = true;
      for (var k = 0; k < 54; k++) if (result.colors[k] !== truth[k]) { same = false; break; }
      if (same) exact++;
      else if (result.ambiguous) flagged++;
      else failed++;
    } else failed++;
  }
  console.log('  ' + runs + ' whole cubes: ' + exact + ' exact, ' + flagged +
    ' ambiguous (flagged), ' + failed + ' rejected, ' + undetected + ' a face went undetected');
  check('photos straight through to a finished cube', exact === runs,
    exact + '/' + runs);
})();

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
