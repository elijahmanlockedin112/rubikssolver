/*
 * node test/autosnap.test.js [trials]
 *
 * Auto-capture: does it fire when a face is held up, and does it fire once?
 *
 * Nothing here fabricates a detector reading. Every look fed to AutoSnap comes
 * out of the real detect.js, run over a rendered frame at 320x240 — the size
 * the live loop actually hands it — and every face rendered is a face of an
 * actually scrambled cube from cuben.js.
 *
 * That last part is not decoration. An earlier version of this file made its
 * "two different faces" out of a colour swap, and on a 2x2 that produces faces
 * which are each other turned a quarter round, so the test insisted two
 * identical pictures ought to be told apart. Real faces of one cube are the
 * harder and more honest case anyway: they share colours, and telling them
 * apart is the whole job the rearm has to do.
 *
 * The two failures worth having a test for are opposite:
 *
 *   - firing on a cube that is being moved, or on one glimpse of a grid, which
 *     keeps a photo nobody would have taken;
 *   - firing twice on one face, which quietly fills the six slots with the same
 *     face and leaves the assembler with no explanation for why it will not fit.
 *
 * The bars in js/autosnap.js were set from the measurements this file prints.
 */
var D = require('../js/detect.js');
var CubeN = require('../js/cuben.js');
var Assemble4 = require('../js/assemble4.js');
var AutoSnap = require('../js/autosnap.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var BASE = [
  [238, 238, 236], [247, 209, 58], [22, 152, 82],
  [22, 82, 178], [198, 40, 54], [232, 126, 34]
];

// The live loop searches a copy PREVIEW_EDGE (320) across, so measure there.
var W = 320, H = 240;
var FRAME = { width: W, height: H };
// ms between live looks. The interval autosnap.js's motion bars were measured
// at, not scan.js's live loop, which is faster — "the rate the looks arrive at
// does not change the answer" below is what says those two can differ safely.
var TICK = 180;

/** One frame. Same renderer as detect.test.js, plus a specular blob. */
function renderFace(cells, o) {
  var N = o.N || 3;
  var data = new Uint8ClampedArray(W * H * 4);
  var cos = Math.cos(-o.angle), sin = Math.sin(-o.angle);
  var gap = 0.1, plastic = [26, 26, 28];
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var dx = (x - o.cx) / o.scale, dy = (y - o.cy) / o.scale;
      var u = dx * cos - dy * sin + N / 2, v = dx * sin + dy * cos + N / 2, rgb;
      if (u >= 0 && u < N && v >= 0 && v < N) {
        var col = Math.floor(u), row = Math.floor(v), fu = u - col, fv = v - row;
        rgb = (fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap) ? plastic : BASE[cells[row * N + col]];
      } else {
        rgb = [120, 120, 125];
      }
      var light = 1 - (o.shade || 0) * (x / W * 0.6 + y / H * 0.4);
      if (o.glare) {
        var gd = Math.hypot(x - o.glare.x, y - o.glare.y);
        if (gd < o.glare.r) light += (1 - gd / o.glare.r) * o.glare.k;
      }
      var i = (y * W + x) * 4;
      for (var c = 0; c < 3; c++) data[i + c] = rgb[c] * light + (Math.random() - 0.5) * (o.noise || 0);
      data[i + 3] = 255;
    }
  }
  return { data: data, width: W, height: H };
}

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

/** The six faces of a freshly scrambled cube, as arrays of colour indices. */
function scrambledFaces(N) {
  var cube = CubeN.of(N), per = N * N;
  var state = cube.applySeq(cube.SOLVED, cube.randomScramble(30));
  var faces = [];
  for (var f = 0; f < 6; f++) faces.push(Array.prototype.slice.call(state.slice(f * per, (f + 1) * per)));
  return faces;
}

/** Is one face the same picture as another, some way up? Then it is not a pair. */
function samePicture(a, b, N) {
  for (var k = 0; k < 4; k++) {
    var turned = Assemble4.rotateFace(b, N, k);
    var all = true;
    for (var i = 0; i < a.length; i++) if (turned[i] !== a[i]) { all = false; break; }
    if (all) return true;
  }
  return false;
}

/** Two faces of one cube that are genuinely different pictures. */
function facePair(N) {
  for (var attempt = 0; attempt < 40; attempt++) {
    var faces = scrambledFaces(N);
    for (var a = 0; a < 6; a++) {
      for (var b = a + 1; b < 6; b++) {
        if (!samePicture(faces[a], faces[b], N)) return [faces[a], faces[b]];
      }
    }
  }
  throw new Error('no distinguishable pair of faces on a ' + N + 'x' + N);
}

/** A frame through the real detector, the way the live loop does it. */
function look(cells, o) {
  var out = D.detectFace(renderFace(cells, o), { size: o.N });
  return out && !out.failed ? out : null;
}

/** Where the cube is, look by look. `held` is hand tremor; `turning` is not. */
function motion(kind, base, f) {
  if (kind === 'held') {
    return {
      N: base.N, angle: base.angle + rand(-0.017, 0.017), scale: base.scale * rand(0.988, 1.012),
      cx: base.cx + rand(-1.7, 1.7), cy: base.cy + rand(-1.7, 1.7),
      noise: 9, shade: 0.18, glare: base.glare
    };
  }
  return {
    N: base.N, angle: base.angle + f * 0.10, scale: base.scale * (1 + f * 0.03),
    cx: base.cx + f * 7, cy: base.cy + f * 3, noise: 9, shade: 0.18, glare: base.glare
  };
}

function baseFor(N) {
  return { N: N, angle: rand(-0.25, 0.25), scale: rand(26, 38), cx: rand(148, 172), cy: rand(110, 130), glare: null };
}

/** n looks at one face doing one thing. */
function run(kind, cells, base, n) {
  var out = [];
  for (var f = 0; f < n; f++) {
    var o = motion(kind, base, f);
    o.cells = cells;
    out.push(o);
  }
  return out;
}

function nothing(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(null);
  return out;
}

/**
 * Run a sequence of looks past an AutoSnap and report every shot it took.
 * Captures are fed back in, exactly as scan.js does it, so the rearm is under
 * test as much as the trigger.
 */
function play(auto, frames, tick) {
  var now = 0, shots = [];
  frames.forEach(function (o, i) {
    var reading = o === null ? null : look(o.cells, o);
    var out = auto.feed(reading, FRAME, now);
    if (out.fire) {
      shots.push({ at: i, cells: o.cells });
      auto.captured(reading.samples, reading.size, now);
    }
    now += tick || TICK;
  });
  return shots;
}

var trials = parseInt(process.argv[2], 10) || 20;
var SIZES = [2, 3, 4];

// ---------------------------------------------------------------- firing

console.log('\na face held up gets photographed, once');

SIZES.forEach(function (N) {
  var fired = 0, doubled = 0, latency = [];
  for (var t = 0; t < trials; t++) {
    // twenty looks is 3.6 seconds of holding one face up and waiting
    var shots = play(new AutoSnap(), run('held', scrambledFaces(N)[0], baseFor(N), 20));
    if (shots.length >= 1) { fired++; latency.push(shots[0].at); }
    if (shots.length > 1) doubled++;
  }
  latency.sort(function (a, b) { return a - b; });
  check(N + 'x' + N + ': held up, it fires', fired === trials, fired + '/' + trials);
  check(N + 'x' + N + ': held up, it does not fire twice', doubled === 0, doubled + ' of ' + trials + ' fired again');
  console.log('       first shot after ' + (latency.length ? latency[latency.length >> 1] : '--') +
    ' looks (' + (latency.length ? latency[latency.length >> 1] * TICK : '--') + 'ms), worst ' +
    (latency.length ? latency[latency.length - 1] : '--'));
});

console.log('\nit does not fire at nothing, or at a cube on the move');

var falseFires = 0, movingFires = 0;
for (var t = 0; t < trials; t++) {
  var N = SIZES[t % 3];
  if (play(new AutoSnap(), nothing(20)).length) falseFires++;
  // Turning steadily for twenty looks. The face is readable the whole way and
  // must not be kept, because it is not being offered — it is on its way past.
  if (play(new AutoSnap(), run('turning', scrambledFaces(N)[0], baseFor(N), 20)).length) movingFires++;
}
check('an empty frame is never photographed', falseFires === 0, falseFires + '/' + trials);
check('a cube being turned is never photographed', movingFires === 0, movingFires + '/' + trials);

/*
 * The same judgement, whatever rate the looks arrive at.
 *
 * scan.js's live loop got faster, and the three motion bars are quantities per
 * look — how far the face drifted, grew and turned since the last one. Halve
 * the interval and a cube being turned moves half as far between looks, so
 * every one of those bars would silently become twice as forgiving and a cube
 * on its way past would get photographed mid-turn.
 *
 * autosnap.js scales them by the gap it measures between looks, so this runs
 * the identical motion at three different rates and demands the same answer
 * each time: a held face is kept, a turning one is not. It is the guard on the
 * live interval being a free choice rather than a load-bearing constant.
 */
console.log('\nthe rate the looks arrive at does not change the answer');

[100, 180, 260].forEach(function (tick) {
  var held = 0, turning = 0, twice = 0;
  for (var t = 0; t < trials; t++) {
    var N = SIZES[t % 3];
    /*
     * Sixty looks of one face, which at 100ms is six seconds of leaving it
     * sitting in front of the camera. The rearm counts looks at something
     * else rather than milliseconds, so a faster loop should not shorten it —
     * but the cooldown under it is in milliseconds, and that one did come
     * down with the interval.
     */
    var shots = play(new AutoSnap(), run('held', scrambledFaces(N)[0], baseFor(N), 60), tick);
    if (shots.length >= 1) held++;
    if (shots.length > 1) twice++;
    if (play(new AutoSnap(), run('turning', scrambledFaces(N)[0], baseFor(N), 20), tick).length) turning++;
  }
  check('at ' + tick + 'ms a look: a held face is still photographed',
    held === trials, held + '/' + trials);
  check('at ' + tick + 'ms a look: a turning cube is still refused',
    turning === 0, turning + '/' + trials + ' fired mid-turn');
  check('at ' + tick + 'ms a look: one face left there is still one photo',
    twice === 0, twice + '/' + trials + ' fired twice');
});

console.log('\none glimpse is not confidence');
var glimpses = 0;
for (t = 0; t < trials; t++) {
  var Ng = SIZES[t % 3];
  // a face flashes past for three looks, one short of the bar, then gone
  if (play(new AutoSnap(), run('held', scrambledFaces(Ng)[0], baseFor(Ng), 3).concat(nothing(6))).length) glimpses++;
}
check('a face seen for three looks and gone is not photographed', glimpses === 0, glimpses + '/' + trials);

// ---------------------------------------------------------------- rearming

console.log('\nthe same face left in front of the camera is photographed once');

SIZES.forEach(function (N) {
  var wrong = 0, counts = [];
  for (var t = 0; t < trials; t++) {
    // sixty looks — eleven seconds of leaving one face sitting there
    var shots = play(new AutoSnap(), run('held', scrambledFaces(N)[0], baseFor(N), 60));
    counts.push(shots.length);
    if (shots.length !== 1) wrong++;
  }
  check(N + 'x' + N + ': eleven seconds of one face is one photo', wrong === 0,
    'shot counts: ' + counts.join(','));
});

console.log('\nturning to a new face arms it again');

SIZES.forEach(function (N) {
  var got = 0, latency = [];
  for (var t = 0; t < trials; t++) {
    var pair = facePair(N);
    var seq = run('held', pair[0], baseFor(N), 8)
      .concat(nothing(2))                      // the moment of turning it over
      .concat(run('held', pair[1], baseFor(N), 12));
    var shots = play(new AutoSnap(), seq);
    if (shots.length === 2) { got++; latency.push(shots[1].at - 10); }
  }
  latency.sort(function (x, y) { return x - y; });
  /*
   * A 2x2 is allowed to miss one in ten, and the others none.
   *
   * Four stickers is the least a face can be told apart by, and the pairs are
   * drawn at random from a real scrambled cube: the measured gap between two
   * faces of a 2x2 has a median around 51 but a minimum around 12, against a
   * rearm bar of 10. Some runs draw a pair under it, and when they do the
   * scanner does the right thing — it waits, says "turn the cube to a face you
   * have not done yet", and Snap still works. That is a known, documented and
   * recoverable limit of four stickers, not a regression, and demanding 15 of
   * 15 from a sample of 15 made this file fail for it about one run in six.
   *
   * The bigger cubes have no such excuse and get none.
   */
  var bar = N === 2 ? Math.ceil(trials * 0.9) : trials;
  check(N + 'x' + N + ': two faces in a row give two photos', got >= bar,
    got + '/' + trials + (N === 2 ? ' (bar ' + bar + ')' : ''));
  console.log('       second face caught ' + (latency.length ? latency[latency.length >> 1] : '--') +
    ' looks after it appeared');
});

console.log('\nturning to a new face without ever losing sight of one');

/*
 * The hard version of the rearm: the cube never leaves the frame, so there is
 * no gap of "nothing" for it to notice, and only the colours say the face
 * changed. This is the case that decides whether rearmDiff is set right.
 */
SIZES.forEach(function (N) {
  var both = 0;
  for (var t = 0; t < trials; t++) {
    var pair = facePair(N);
    var shots = play(new AutoSnap(),
      run('held', pair[0], baseFor(N), 8).concat(run('held', pair[1], baseFor(N), 14)));
    if (shots.length === 2) both++;
  }
  // The 2x2 is four stickers, and about one pair of faces in a hundred reads
  // close enough to the other to want a tap on Snap instead. Measured over 205
  // real pairs the closest came to 11.08 against a bar of 10, so the margin is
  // thin by design — erring towards a tap and away from a duplicate photo.
  var bar = N === 2 ? Math.ceil(trials * 0.9) : trials;
  check(N + 'x' + N + ': a face swapped in place is seen as a new face', both >= bar,
    both + '/' + trials + ' (bar ' + bar + ')');
});

// ---------------------------------------------------------------- the bars

console.log('\nthe numbers the bars in autosnap.js are set against');

var stillGap = [], stillDrift = [], stillAngle = [], turnAngle = [], sameFace = [];
var diffFace = { 2: [], 3: [], 4: [] };
for (t = 0; t < trials * 3; t++) {
  var Nm = SIZES[t % 3], base = baseFor(Nm), prev = null;
  var faces = scrambledFaces(Nm);

  run('held', faces[0], base, 5).forEach(function (o) {
    var r = look(o.cells, o);
    if (r && prev) {
      stillGap.push(AutoSnap.sameColors(prev.samples, r.samples));
      stillAngle.push(AutoSnap.angleGap(AutoSnap.axisAngle(prev), AutoSnap.axisAngle(r)));
      var c1 = prev.quad.reduce(function (a, p) { return { x: a.x + p.x / 4, y: a.y + p.y / 4 }; }, { x: 0, y: 0 });
      var c2 = r.quad.reduce(function (a, p) { return { x: a.x + p.x / 4, y: a.y + p.y / 4 }; }, { x: 0, y: 0 });
      stillDrift.push(Math.hypot(c1.x - c2.x, c1.y - c2.y) / r.step);
    }
    if (r) prev = r;
  });

  prev = null;
  run('turning', faces[0], base, 5).forEach(function (o) {
    var r = look(o.cells, o);
    if (r && prev) turnAngle.push(AutoSnap.angleGap(AutoSnap.axisAngle(prev), AutoSnap.axisAngle(r)));
    if (r) prev = r;
  });

  // one face against itself a quarter turn round, and against every other face
  var flat = { N: Nm, angle: 0.08, scale: 32, cx: 160, cy: 120, noise: 9, shade: 0.18 };
  var straight = look(faces[0], flat);
  var turned = look(faces[0], { N: Nm, angle: 0.08 + Math.PI / 2, scale: 32, cx: 160, cy: 120, noise: 9, shade: 0.18 });
  if (straight && turned) sameFace.push(AutoSnap.faceDistance(straight.samples, turned.samples, Nm));
  for (var f2 = 1; f2 < 6 && straight; f2++) {
    if (samePicture(faces[0], faces[f2], Nm)) continue;
    var other = look(faces[f2], flat);
    if (other) diffFace[Nm].push(AutoSnap.faceDistance(straight.samples, other.samples, Nm));
  }
}

/*
 * A percentile the sample is actually big enough to have.
 *
 * The bars below are asserted against a p99 on purpose: the detector now and
 * then re-registers the grid one cell across between two looks at a cube that
 * has not moved, every number jumps when it does, and those outliers are the
 * exact thing the bars exist to throw away rather than a problem the bars
 * have. Asking for the 99th percentile of 45 samples, though, hands back the
 * largest of the 45 — which is the maximum, wearing a percentile's clothes,
 * and is precisely the thing that made this file fail about one run in five
 * before the percentiles went in.
 *
 * So the quantile is capped at whatever leaves three samples above it. Below
 * about 300 samples that is no longer the 99th, and `pct()` prints which one
 * it really was, because a number called p99 that is not one is worse than a
 * number called p93.
 */
function quantile(n, q) {
  if (q >= 0.5) return Math.min(q, Math.max(0.5, 1 - 3 / n));
  return Math.max(q, Math.min(0.5, 3 / n));      // the same, at the low end
}

function at(list, q) {
  var s = list.slice().sort(function (a, b) { return a - b; });
  if (q > 0 && q < 1) q = quantile(s.length, q);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

/** What `at(list, q)` really reported, for printing. Not `label`: show()
 *  has a parameter by that name, and it shadowed this into a TypeError. */
function pct(list, q) {
  return 'p' + Math.round(quantile(list.length, q) * 100);
}
function show(label, list, bar, side) {
  console.log('  ' + label.padEnd(32) + 'n=' + String(list.length).padStart(4) +
    '  med ' + at(list, 0.5).toFixed(3) + '  ' + pct(list, 0.99) + ' ' + at(list, 0.99).toFixed(3) +
    '  min ' + at(list, 0).toFixed(3) + '  max ' + at(list, 1).toFixed(3) +
    (bar === undefined ? '' : '   (bar ' + bar + ', ' + side + ')'));
}
var K = AutoSnap.DEFAULTS;
show('colour gap, held still', stillGap, K.colorTol, 'stay under');
show('drift per look, held still', stillDrift, K.moveTol, 'stay under');
show('angle change, held still', stillAngle, K.angleTol, 'stay under');
show('angle change, being turned', turnAngle, K.angleTol, 'stay over');
show('one face vs itself, turned', sameFace, K.rearmDiff, 'stay under');
SIZES.forEach(function (N) { show(N + 'x' + N + ' face vs another face', diffFace[N], K.rearmDiff, 'stay over'); });

/*
 * Percentiles, not sampled extremes.
 *
 * The detector will now and then re-register the grid one cell across between
 * two looks at a cube that has not moved, and when it does, every one of these
 * numbers jumps: the colours are read off different stickers, so the gap goes
 * from 0.4 to 44, and the centroid moves nearly two whole cells. Asserting on
 * the maximum meant asserting that never happens, which made this file fail
 * about one run in five and said nothing true about the bars.
 *
 * It is worth being clear about what those outliers are: not a problem the
 * bars have, but the exact thing they exist to throw away. A pair of looks
 * that disagree that violently is a pair that should not be counted, and is
 * not. The typical case is what a bar has to clear, so the typical case is
 * what is checked, and the outliers are printed above rather than hidden.
 */
check('a held face reads the same twice, inside colorTol',
  at(stillGap, 0.99) * 3 < K.colorTol,
  pct(stillGap, 0.99) + ' ' + at(stillGap, 0.99).toFixed(2) + ' vs bar ' + K.colorTol);
check('a held face stays put, inside moveTol',
  at(stillDrift, 0.99) * 1.4 < K.moveTol,
  pct(stillDrift, 0.99) + ' ' + at(stillDrift, 0.99).toFixed(3) + ' vs bar ' + K.moveTol);
check('a held face keeps its angle, inside angleTol',
  at(stillAngle, 0.99) * 1.4 < K.angleTol,
  pct(stillAngle, 0.99) + ' ' + at(stillAngle, 0.99).toFixed(4) + ' vs bar ' + K.angleTol);
check('a turning face breaks angleTol',
  at(turnAngle, 0.01) > K.angleTol * 1.3,
  pct(turnAngle, 0.01) + ' ' + at(turnAngle, 0.01).toFixed(4) + ' vs bar ' + K.angleTol);
check('the angle bar sits between the two, not on either',
  at(stillAngle, 0.99) < K.angleTol && K.angleTol < at(turnAngle, 0.01),
  'held ' + pct(stillAngle, 0.99) + ' ' + at(stillAngle, 0.99).toFixed(4) + ' / bar ' + K.angleTol +
  ' / turning low ' + at(turnAngle, 0.01).toFixed(4));
check('one face turned round still reads as itself',
  at(sameFace, 0.99) * 5 < K.rearmDiff,
  pct(sameFace, 0.99) + ' ' + at(sameFace, 0.99).toFixed(2) + ' vs bar ' + K.rearmDiff);

/*
 * How often two genuinely different faces read close enough to be taken for
 * one, which costs a tap on Snap. Measured over 499 real 2x2 pairs: 1. Over
 * 500 each on a 3x3 and a 4x4: none. The bars here are those figures with
 * headroom, and they are stated as rates because "never" is not true on a
 * 2x2 and pretending otherwise is how a test starts lying.
 */
SIZES.forEach(function (N) {
  var v = diffFace[N];
  var close = v.filter(function (d) { return d <= K.rearmDiff; }).length;
  var rate = close / v.length;
  var bar = N === 2 ? 0.02 : 0.004;    // measured 0.002 on a 2x2, 0 on the others
  check(N + 'x' + N + ': two faces of one cube are told apart',
    rate <= bar, close + ' of ' + v.length + ' too close (' + (rate * 100).toFixed(1) +
    '%, bar ' + (bar * 100).toFixed(1) + '%)');
});

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
