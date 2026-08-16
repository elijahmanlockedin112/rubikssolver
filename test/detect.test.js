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
  var N = opts.N || 3;
  var W = opts.width || 480, H = opts.height || 360;
  var data = new Uint8ClampedArray(W * H * 4);
  var cos = Math.cos(-opts.angle), sin = Math.sin(-opts.angle);
  var gap = opts.gap === undefined ? 0.1 : opts.gap;
  var plastic = [26, 26, 28];

  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var dx = (x - opts.cx) / opts.scale, dy = (y - opts.cy) / opts.scale;
      var u = dx * cos - dy * sin + N / 2;
      var v = dx * sin + dy * cos + N / 2;
      var rgb;
      if (u >= 0 && u < N && v >= 0 && v < N) {
        var col = Math.floor(u), row = Math.floor(v);
        var fu = u - col, fv = v - row;
        var onPlastic = fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap;
        rgb = onPlastic ? plastic : BASE[cells[row * N + col]];
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

/** Where the sticker centres really ended up, in image pixels. */
function trueCenters(opts) {
  var N = opts.N || 3;
  var ca = Math.cos(opts.angle), sa = Math.sin(opts.angle);
  var out = [];
  for (var row = 0; row < N; row++) {
    for (var col = 0; col < N; col++) {
      var du = col + 0.5 - N / 2, dv = row + 0.5 - N / 2;
      var dx = du * ca - dv * sa, dy = du * sa + dv * ca;
      out.push({ x: opts.cx + dx * opts.scale, y: opts.cy + dy * opts.scale });
    }
  }
  return out;
}

function randomCells(N) {
  var cells = [];
  for (var i = 0; i < (N || 3) * (N || 3); i++) cells.push(Math.floor(Math.random() * 6));
  return cells;
}
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

/** Did it find the real grid, in the right order? */
function gridError(opts, found) {
  var truth = trueCenters(opts);
  if (found.points.length !== truth.length) return Infinity;
  var worst = 0;
  for (var i = 0; i < truth.length; i++) {
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
    var N = opts.N || 3;
    var started = Date.now();
    var found = D.detectFace(renderFace(randomCells(N), opts), { size: N });
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

console.log('\nlocating a 4x4 grid');

check('a square-on 4x4 is always found', sweep('square on   ', function () {
  return { N: 4, angle: 0, scale: rand(34, 70), cx: 240, cy: 180, shade: 0.15, noise: 8 };
}) === 1);

check('a tilted 4x4 is always found', sweep('tilted      ', function () {
  return { N: 4, angle: rand(-0.3, 0.3), scale: rand(34, 70), cx: 240, cy: 180, shade: 0.2, noise: 10 };
}) === 1);

check('an off-centre 4x4 at any size is always found', sweep('off-centre  ', function () {
  return { N: 4, angle: rand(-0.25, 0.25), scale: rand(30, 60), cx: rand(170, 310), cy: rand(120, 240), shade: 0.25, noise: 12 };
}) === 1);

var messy4 = sweep('busy room   ', function () {
  return {
    N: 4, angle: rand(-0.3, 0.3), scale: rand(30, 62), cx: rand(170, 310), cy: rand(120, 240),
    shade: 0.35, noise: 18, background: [rand(30, 220), rand(30, 220), rand(30, 220)]
  };
});
check('a 4x4 survives a random background', messy4 >= 0.98, (messy4 * 100).toFixed(0) + '%');

/*
 * A 2x2, which had no coverage here at all — and that is exactly why it was
 * the size that behaved worst. Four stickers is the least a face can be, so it
 * is the size with the least to spare, and it was the one being held to the
 * strictest standard: the minimum-match rule gave a 3x3 six of nine and a 2x2
 * four of four, which is no tolerance whatsoever. One sticker lost to a
 * highlight, a thumb, or a merge with the cell beside it, and the whole face
 * was refused.
 */
console.log('\nlocating a 2x2 grid');

check('a square-on 2x2 is always found', sweep('square on   ', function () {
  return { N: 2, angle: 0, scale: rand(60, 120), cx: 240, cy: 180, shade: 0.15, noise: 8 };
}) === 1);

check('a tilted 2x2 is always found', sweep('tilted      ', function () {
  return { N: 2, angle: rand(-0.3, 0.3), scale: rand(55, 110), cx: 240, cy: 180, shade: 0.2, noise: 10 };
}) === 1);

check('an off-centre 2x2 at any size is always found', sweep('off-centre  ', function () {
  return { N: 2, angle: rand(-0.25, 0.25), scale: rand(45, 90), cx: rand(150, 330), cy: rand(110, 250), shade: 0.25, noise: 12 };
}) === 1);

var messy2 = sweep('busy room   ', function () {
  return {
    N: 2, angle: rand(-0.3, 0.3), scale: rand(45, 95), cx: rand(160, 320), cy: rand(110, 250),
    shade: 0.35, noise: 18, background: [rand(30, 220), rand(30, 220), rand(30, 220)]
  };
});
check('a 2x2 survives a random background', messy2 >= 0.98, (messy2 * 100).toFixed(0) + '%');

/*
 * One sticker gone, at every size.
 *
 * The commonest real loss there is: a highlight blows a cell out to white, a
 * thumb covers one, or it merges into a same-coloured neighbour. A 3x3 has
 * always shrugged this off. A 2x2 could not, because four of four leaves
 * nothing to lose — measured 0% found before the rule was changed, against a
 * 3x3's 100% on the same case.
 */
console.log('\none sticker missing');

function withCellHidden(N, opts) {
  var cells = randomCells(N);
  var img = renderFace(cells, opts);
  // paint one whole cell, seams and all, the colour of the surroundings
  var hide = (Math.random() * N * N) | 0;
  var row = (hide / N) | 0, col = hide % N;
  var ca = Math.cos(opts.angle), sa = Math.sin(opts.angle);
  var du = col + 0.5 - N / 2, dv = row + 0.5 - N / 2;
  var px = opts.cx + (du * ca - dv * sa) * opts.scale;
  var py = opts.cy + (du * sa + dv * ca) * opts.scale;
  var r = opts.scale * 0.62;
  for (var y = Math.max(0, (py - r) | 0); y < Math.min(360, py + r); y++) {
    for (var x = Math.max(0, (px - r) | 0); x < Math.min(480, px + r); x++) {
      if (Math.hypot(x - px, y - py) > r) continue;
      var o = (y * 480 + x) * 4;
      // dark, not blown out: a white patch is still a blob and would be
      // read as a white sticker. A thumb, a deep shadow or a merge with the
      // neighbour is a cell that is not there at all, which is the real loss.
      for (var c = 0; c < 3; c++) img.data[o + c] = 18;
    }
  }
  return img;
}

[2, 3, 4].forEach(function (N) {
  var found = 0;
  for (var t = 0; t < trials; t++) {
    var opts = {
      N: N, angle: rand(-0.25, 0.25), scale: rand(34, 62) * 3 / N,
      cx: 240, cy: 180, shade: 0.2, noise: 8
    };
    var out = D.detectFace(withCellHidden(N, opts), { size: N });
    if (out && !out.failed) found++;
  }
  var rate = found / trials;
  console.log('  ' + N + 'x' + N + ' with a cell lost: ' + found + '/' + trials +
    '  (' + (rate * 100).toFixed(0) + '%)');
  check(N + 'x' + N + ' survives losing one sticker', rate >= 0.9, (rate * 100).toFixed(0) + '%');
});

console.log('\nworking out the size without being told');
// Bigger-first is the whole basis of auto-detection, and it rests on this
// asymmetry: a 3x3 grid fits inside a 4x4, but a 4x4 cannot hide in a 3x3.
check('a 3x3 photo is never read as a 4x4', (function () {
  for (var t = 0; t < 40; t++) {
    var opts = { angle: rand(-0.2, 0.2), scale: rand(45, 90), cx: 240, cy: 180, shade: 0.2, noise: 10 };
    var asFour = D.detectFace(renderFace(randomCells(3), opts), { size: 4 });
    if (asFour && !asFour.failed) return false;
  }
  return true;
})());

check('auto-detect calls a 4x4 a 4x4', (function () {
  for (var t = 0; t < 40; t++) {
    var opts = { N: 4, angle: rand(-0.25, 0.25), scale: rand(34, 66), cx: rand(200, 280), cy: rand(140, 220), shade: 0.2, noise: 10 };
    var found = D.detectAny(renderFace(randomCells(4), opts));
    if (!found || found.size !== 4 || gridError(opts, found) > 0.3) return false;
  }
  return true;
})());

check('auto-detect calls a 3x3 a 3x3', (function () {
  for (var t = 0; t < 40; t++) {
    var opts = { angle: rand(-0.25, 0.25), scale: rand(45, 90), cx: rand(200, 280), cy: rand(140, 220), shade: 0.2, noise: 10 };
    var found = D.detectAny(renderFace(randomCells(3), opts));
    if (!found || found.size !== 3 || gridError(opts, found) > 0.3) return false;
  }
  return true;
})());

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

// The detector used to demand dark plastic between the stickers. Plenty of
// cubes are stickerless with barely a seam, and on a real one that check threw
// away grids it had already located perfectly. Never again.
check('a stickerless cube with barely any seam is found', (function () {
  var thin = 0;
  for (var t = 0; t < 25; t++) {
    var opts = {
      angle: rand(-0.2, 0.2), scale: rand(50, 90), cx: rand(200, 280), cy: rand(140, 220),
      shade: 0.2, noise: 8, gap: 0.03           // a hairline between the tiles
    };
    var found = D.detectFace(renderFace(randomCells(), opts));
    if (found && !found.failed && gridError(opts, found) < 0.3) thin++;
  }
  return thin >= 23;
})());

check('a face with bright seams is still found', (function () {
  // some cubes are white-bodied: the gaps are lighter than the colours
  var opts = { angle: 0.1, scale: 70, cx: 240, cy: 180, shade: 0.1, noise: 6 };
  var img = renderFace(randomCells(), opts);
  // repaint the seams white by drawing a light grid over them
  var cos = Math.cos(-opts.angle), sin = Math.sin(-opts.angle);
  for (var y = 0; y < img.height; y++) {
    for (var x = 0; x < img.width; x++) {
      var dx = (x - opts.cx) / opts.scale, dy = (y - opts.cy) / opts.scale;
      var u = dx * cos - dy * sin + 1.5, v = dx * sin + dy * cos + 1.5;
      if (u < 0 || u >= 3 || v < 0 || v >= 3) continue;
      var fu = u - Math.floor(u), fv = v - Math.floor(v);
      if (fu < 0.1 || fu > 0.9 || fv < 0.1 || fv > 0.9) {
        var o = (y * img.width + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 245;
      }
    }
  }
  var found = D.detectFace(img);
  return !!found && !found.failed && gridError(opts, found) < 0.3;
})());
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
  // Same standard as the other suites: a cube that could be fitted together two
  // ways is flagged, not guessed at, and that is a pass. Silently wrong is not.
  check('photos go straight through to a finished cube', exact >= runs * 0.9,
    exact + '/' + runs);
  check('nothing is silently wrong or lost', exact + flagged === runs,
    failed + ' rejected, ' + undetected + ' undetected');
})();

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
