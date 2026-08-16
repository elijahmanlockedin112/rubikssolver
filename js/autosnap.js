/*
 * autosnap.js — when has a face been recognised well enough to photograph it
 * without being asked?
 *
 * The scanner already looks for a face several times a second so it can draw
 * the green outline. Auto-capture is the question of when one of those looks is
 * good enough to keep. It is a separate file from scan.js because it is the
 * only interesting part: scan.js needs a camera, a canvas and a DOM, and this
 * needs a list of numbers, so this is the part that can actually be tested.
 *
 * Two things have to be right, and they fail in opposite directions.
 *
 * FIRING TOO EAGERLY is the worse one. A single frame saying "there is a grid
 * here" is not confidence — a half-turned cube, a hand moving through shot, or
 * a blurred frame will all produce one. So a face has to be found in several
 * consecutive looks, in the same place, at the same size, reading the same
 * colours, before anything is kept. That last one is the point: the phrase is
 * "recognised the colours confidently", and the operational meaning of that is
 * the colours came out the same twice running.
 *
 * FIRING TWICE for one face is the other. After a shot the cube is still
 * sitting in front of the camera showing the face that was just taken, and the
 * naive loop photographs it again immediately, and again, until six identical
 * photos of one face have been collected. So capturing disarms, and rearming
 * needs the view to become something else: the face gone, or a face that reads
 * differently from the one just taken, for several looks in a row.
 *
 * The rearm test is deliberately the forgiving one of the two. A false "that
 * is still the same face" costs one tap on Snap, which is right there. A false
 * "that is a new face" costs a duplicate photo, and the scanner then has five
 * faces of a cube and no idea why it will not assemble.
 */
;(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./assemble.js') : root.CubeAssemble,
    typeof require === 'function' ? require('./assemble4.js') : root.CubeAssemble4
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeAutoSnap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeAssemble, CubeAssemble4) {
  'use strict';

  /*
   * The bars. Every one of these is measured — see test/autosnap.test.js, which
   * renders moving cube faces, runs them through the real detector, and reports
   * the figures each of these is set against. Live looks come about every
   * 180ms, so the frame counts below are also a time: four looks is roughly
   * two-thirds of a second of holding still.
   */
  var DEFAULTS = {
    // Consecutive good, agreeing looks before a shot is taken. Live looks are
    // 180ms apart, so four of them is about two-thirds of a second of holding
    // the cube still — long enough to be a decision, short enough not to be a
    // chore six times over.
    stableHits: 4,

    /*
     * Fraction of the N*N cells that must be a patch the detector actually
     * saw, rather than one interpolated from the grid around it.
     *
     * The detector itself settles for 6 of 9 on a 3x3, deliberately, so a
     * sticker lost to glare still reads. That is the right bar for "can this
     * be read at all" and the wrong one for "is this good enough to keep
     * uninvited". Colour error against the known truth, by how many cells were
     * seen, over 858 detections of glared faces at 320x240:
     *
     *        all cells   med 1.09   p90 5.71
     *        0.90-0.99   med 3.16   p90 5.00
     *        0.80-0.89   med 4.44   p90 9.01
     *        0.70-0.79   med 4.65   p90 7.46
     *            <0.70   med 44.53             <- the reading is gone
     *
     * 0.85 lets a 3x3 lose exactly one sticker to glare — the case the
     * detector was built to tolerate — and keeps the p90 error at 9.01, inside
     * the 12 that assemble.js itself treats as "the same colour". Below 0.70
     * the reading falls off a cliff and this is nowhere near it.
     */
    matchFraction: 0.85,

    /*
     * One cell, as a fraction of the frame's short edge, under which a face is
     * worth outlining but not worth photographing.
     *
     * This one is a floor, not a measured cliff, and it is worth being honest
     * about which: the synthetic renderer stays perfectly sharp however far
     * away it is drawn, and read 100% of faces with every cell matched down to
     * 0.042. A real camera does not — a distant cube is blurry and JPEG-soft,
     * and at 0.05 on a 320px frame a cell is 12px and each colour is sampled
     * from a 2px radius. Where the real cliff is needs a phone; this only
     * stops it firing at a cube across the room.
     */
    minCell: 0.05,

    /*
     * How far the face may drift between looks, as a fraction of one cell, and
     * how much it may grow or shrink. Measured over 480 consecutive pairs:
     *
     *                    held in the hand        being turned on
     *        drift       med 0.060  max 0.155    med 0.233  max 0.250
     *        size        med 0.008  max 0.030    med 0.028  p90 0.031
     *
     * Drift separates the two and size does not — at a deliberate turning
     * speed the size barely changes, and the two distributions overlap. Size
     * is therefore left loose at twice its held maximum, where it catches a
     * lunge towards the camera and is not asked to do anything subtler.
     *
     * Drift at 0.20 is not enough on its own either. It is a fraction of one
     * cell, so the same 7px-per-look turn reads as 0.29 on a small cube and
     * 0.20 on a big one — right on the bar — and a slow turn of a cube that
     * fills the frame slipped past it in 2 of 12 runs.
     *
     * What actually says "this is being turned" is the angle of the grid
     * itself, which is the thing a turn changes and a wobble does not:
     *
     *        angle change per look, 1200 consecutive pairs
     *                         held                    turning
     *        median           0.010                   0.100
     *        p99 / p01        0.034                   0.089
     *        worst            0.048                   0.077
     *
     * 0.06 radians — about three and a half degrees — sits 1.25x above the
     * worst a held cube managed and 1.28x below the gentlest turn, which is as
     * evenly as a bar splits a gap this size. Against the 99th percentiles
     * rather than the extremes it has 1.8x and 1.5x, and those are the numbers
     * test/autosnap.test.js holds it to, because a sampled maximum is not a
     * bar, it is one unlucky frame.
     *
     * Drift stays as the second opinion, for a cube sliding across the frame
     * without rotating.
     */
    moveTol: 0.20,
    sizeTol: 0.06,
    angleTol: 0.06,

    /*
     * Mean colour distance between two looks at the same face, in
     * CubeAssemble.colorCost units — what the rest of the app compares in.
     *
     * Two looks at a face held still came out 0.63 apart at the 90th
     * percentile and never past 0.95. Two looks at different faces came out
     * 35.08 apart at the very closest. There is an enormous gap here, and the
     * bar sits high in it rather than low: a real camera hunting its exposure
     * will move colours around far more than a renderer does, and the cost of
     * being too tight is that auto-capture never fires at all.
     */
    colorTol: 6,

    /*
     * Consecutive looks at something else before it will fire again, and how
     * differently a face has to read to count as something else.
     *
     * Measured on faces of actual scrambled cubes rather than invented ones,
     * which matters: two faces of one cube share colours, so this is a much
     * harder question than telling apart two random patterns.
     *
     *                     one face, turned      two different faces
     *        2x2          max 1.31              min  7.76   p05 24.52
     *        3x3          max 1.31              min 24.69   p05 40.59
     *        4x4          max 1.31              min 34.88   p05 47.86
     *
     * 10 sits about 8x above the worst "still the same face", and above the
     * closest genuinely different pair on a 2x2. It is deliberately at that
     * end. Being too eager to call a face new means a second photo of a face
     * already taken, and six photos that will not assemble with nothing to
     * point at; being too reluctant means one tap on Snap.
     *
     * So the cost is paid in taps and it is small: of 499 real pairs of 2x2
     * faces, 1 came close enough to want one. On a 3x3 and a 4x4, none of 500
     * did. A 2x2 face is four stickers, which is the least a face can be told
     * apart by, and that is simply the size of the thing.
     */
    rearmHits: 3,
    rearmDiff: 10,

    // A floor under the rearm in ms, so one shot cannot be followed instantly
    // by another however fast the frames happen to arrive.
    cooldownMs: 700
  };

  /** k quarter turns of one face's samples, for any cube size. */
  function rotate(cells, N, k) { return CubeAssemble4.rotateFace(cells, N, k); }

  /**
   * How differently two readings of a face come out, ignoring which way up.
   *
   * Which way up matters because between two shots the cube gets turned in the
   * hand, and the same face photographed a quarter turn round is still the same
   * face. Comparing all four rotations and keeping the closest is what makes
   * "is this still the face I just took?" mean what it says.
   */
  function faceDistance(a, b, N) {
    if (!a || !b || a.length !== b.length) return Infinity;
    var best = Infinity;
    for (var k = 0; k < 4; k++) {
      var turned = rotate(b, N, k);
      var sum = 0;
      for (var i = 0; i < a.length; i++) sum += CubeAssemble.colorCost(a[i], turned[i]);
      best = Math.min(best, sum / a.length);
    }
    return best;
  }

  /** Same face, same place, same way up — the frame-to-frame version. */
  function sameColors(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    var sum = 0;
    for (var i = 0; i < a.length; i++) sum += CubeAssemble.colorCost(a[i], b[i]);
    return sum / a.length;
  }

  function centroid(quad) {
    var x = 0, y = 0;
    for (var i = 0; i < quad.length; i++) { x += quad[i].x; y += quad[i].y; }
    return { x: x / quad.length, y: y / quad.length };
  }

  /**
   * Which way the grid is lying, from the step between the first two sticker
   * centres. Only meaningful to within a quarter turn — a square grid looks
   * the same four ways round — so differences are folded into +/- 45 degrees,
   * which also stops a re-labelled corner reading as a violent spin.
   */
  function axisAngle(look) {
    var p = look.points;
    return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  }
  function angleGap(a, b) {
    var d = a - b, quarter = Math.PI / 2;
    while (d > quarter / 2) d -= quarter;
    while (d < -quarter / 2) d += quarter;
    return Math.abs(d);
  }

  function AutoSnap(opts) {
    this.opt = {};
    for (var k in DEFAULTS) this.opt[k] = (opts && opts[k] !== undefined) ? opts[k] : DEFAULTS[k];
    this.reset();
  }

  /** Back to the state a freshly opened scanner is in. */
  AutoSnap.prototype.reset = function () {
    this.hits = 0;          // consecutive good, agreeing looks
    this.prev = null;       // the previous accepted look
    this.armed = true;
    this.clear = 0;         // consecutive looks at something other than the last face
    this.lastFace = null;   // samples of the face just captured
    this.lastSize = 0;
    this.cooldownUntil = 0;
  };

  /**
   * Is this single look worth counting at all?
   *
   * Not "is there a cube here" — the detector answered that — but "is this a
   * good enough view to keep without being asked". A face at the far end of the
   * room, or one with a third of its stickers guessed at from the grid rather
   * than seen, is a face worth outlining and not worth photographing.
   */
  AutoSnap.prototype.worthKeeping = function (look, frame) {
    if (!look || look.failed || !look.samples || !look.quad) return false;
    var N = look.size;
    if (!N || look.samples.length !== N * N) return false;
    if (look.found !== undefined && look.found < Math.ceil(N * N * this.opt.matchFraction)) return false;
    if (frame && look.step) {
      var edge = Math.min(frame.width, frame.height);
      if (look.step < edge * this.opt.minCell) return false;
    }
    return true;
  };

  /** Has the face stayed put, at the same size, since the previous look? */
  AutoSnap.prototype.stillThere = function (look) {
    var prev = this.prev;
    if (!prev || prev.size !== look.size) return false;
    if (angleGap(axisAngle(prev), axisAngle(look)) > this.opt.angleTol) return false;
    var a = centroid(prev.quad), b = centroid(look.quad);
    var moved = Math.hypot(a.x - b.x, a.y - b.y);
    if (moved > this.opt.moveTol * look.step) return false;
    if (Math.abs(look.step - prev.step) > this.opt.sizeTol * prev.step) return false;
    return sameColors(prev.samples, look.samples) <= this.opt.colorTol;
  };

  /**
   * One live look. Returns what the scanner should do and what it should show.
   *
   *   fire   take the photo now
   *   lock   0..1, how much of the hold-still is done, for the outline
   *   state  'searching' | 'locking' | 'turn' — 'turn' means it is waiting for
   *          the cube to be moved on, which is a thing worth saying out loud
   */
  AutoSnap.prototype.feed = function (look, frame, now) {
    var good = this.worthKeeping(look, frame);

    // Rearming and steadying are counted at the same time, on purpose. Turning
    // to a new face satisfies both at once, so the wait after a shot is not
    // "clear, then steady" one after the other but the longer of the two.
    if (!this.armed) {
      var elsewhere = !good ||
        faceDistance(look.samples, this.lastFace, this.lastSize) > this.opt.rearmDiff;
      this.clear = elsewhere ? this.clear + 1 : 0;
      if (this.clear >= this.opt.rearmHits && now >= this.cooldownUntil) {
        this.armed = true;
        this.clear = 0;
      }
    }

    if (!good) {
      this.hits = 0;
      this.prev = null;
    } else {
      this.hits = this.stillThere(look) ? this.hits + 1 : 1;
      this.prev = look;
    }

    var lock = Math.min(1, this.hits / this.opt.stableHits);
    var fire = this.armed && this.hits >= this.opt.stableHits && now >= this.cooldownUntil;
    var state = !this.armed ? 'turn' : (this.hits ? 'locking' : 'searching');
    return { fire: fire, lock: lock, state: state };
  };

  /**
   * A photo was taken. Disarm until the view becomes something else.
   *
   * Told separately rather than done inside feed() because the scanner does not
   * keep the frame the live loop was looking at — it takes a fresh, much larger
   * one and detects again — and it is that reading, the one actually kept, that
   * the rearm has to compare against.
   */
  /**
   * Stand down without having kept anything — a shot that turned out not to
   * read at full size, or one refused as a face already taken. Same disarm as
   * a real capture, with no face to compare against, so it comes back after
   * the cooldown rather than trying again on the very next look.
   */
  AutoSnap.prototype.pause = function (now) {
    this.captured(null, 0, now);
  };

  AutoSnap.prototype.captured = function (samples, size, now) {
    this.armed = false;
    this.clear = 0;
    this.hits = 0;
    this.prev = null;
    this.lastFace = samples;
    this.lastSize = size;
    this.cooldownUntil = now + this.opt.cooldownMs;
  };

  AutoSnap.DEFAULTS = DEFAULTS;
  AutoSnap.faceDistance = faceDistance;
  AutoSnap.sameColors = sameColors;
  AutoSnap.axisAngle = axisAngle;
  AutoSnap.angleGap = angleGap;
  return AutoSnap;
});
