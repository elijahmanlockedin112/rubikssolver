/*
 * guide.js — "turn the cube this way", shown rather than described.
 *
 * Six faces have to get in front of the camera (or under the palette), and the
 * order they arrive in used to be entirely up to the person holding the cube:
 * any order, any way up, the assembler works it out. That is a good property
 * and it is still true — but "do whatever" is not guidance, and a person
 * holding a cube in one hand and a phone in the other wants to be told.
 *
 * So there is a route: front, then three turns to the left for right, back and
 * left, then tip the top round, then tip twice more for the bottom. A grey cube
 * on screen fills in as faces are read and turns the same way you should, which
 * is the whole instruction — the words underneath are the backup.
 *
 * The awkward part is bookkeeping, and it is the reason this is one file used
 * by both the scanner and the editor rather than two lots of case analysis.
 * Once the cube has been turned, "the face toward you" is no longer the face it
 * was, and the top of what you see is no longer the top of that face — after
 * the last tip, the bottom face arrives rotated a quarter turn from the way the
 * flat map draws it. Nothing here reasons about that case by case. It carries
 * the accumulated whole-cube rotation as one permutation, `W`, and every
 * question is asked of that:
 *
 *   currentState[i] = original[W[i]]
 *
 * so the cells you are looking at, in the order you see them, are W applied to
 * the front face — and writing a photo (or a painted sticker) back into the
 * cube's own frame is the same identity read the other way. Verified end to
 * end in test/guide.test.js by turning a cube through the whole route and
 * checking the six faces read off it rebuild the cube exactly.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cuben.js') : root.CubeN,
                    typeof require === 'function' ? null : root.CubeView);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeGuide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN, CubeView) {
  'use strict';

  // A cube drawn exactly face-on reads as a flat square, so the camera sits a
  // little off to one side of whichever face it is looking at.
  var TILT_YAW = -18, TILT_PITCH = 14;
  var SPIN_MS = 900;

  /*
   * The route, and how the cube gets from each face to the next.
   *
   * `axis`/`dir` are the whole-cube rotation the hands make; `dYaw`/`dPitch`
   * are the same rotation for the camera, and the two have to agree or the
   * picture stops being an instruction. A turn to the left brings the
   * right-hand face round to the front, which is the camera swinging to -90.
   */
  var SEQ = [
    { turns: 0, arrow: '', text: 'Hold the cube upright, any face toward you.' },
    { axis: CubeN.AXIS.y, dir: -1, turns: 1, dYaw: -90, dPitch: 0, arrow: '◄',
      text: 'Turn the cube LEFT — the right-hand face comes round to the front.' },
    { axis: CubeN.AXIS.y, dir: -1, turns: 1, dYaw: -90, dPitch: 0, arrow: '◄',
      text: 'Turn it LEFT again — now the back face.' },
    { axis: CubeN.AXIS.y, dir: -1, turns: 1, dYaw: -90, dPitch: 0, arrow: '◄',
      text: 'Once more to the LEFT — the left-hand face.' },
    { axis: CubeN.AXIS.x, dir: 1, turns: 1, dYaw: 0, dPitch: 90, arrow: '▼',
      text: 'Now TIP the cube toward you — the top face comes round to the front.' },
    { axis: CubeN.AXIS.x, dir: 1, turns: 2, dYaw: 0, dPitch: 90, arrow: '▼',
      text: 'TIP it toward you twice more — the bottom face, and the last one.' }
  ];

  function identity(n) {
    var p = new Int32Array(n);
    for (var i = 0; i < n; i++) p[i] = i;
    return p;
  }

  /** apply a, then b — the same convention cuben.js uses internally. */
  function compose(a, b) {
    var out = new Int32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[b[i]];
    return out;
  }

  var rotCache = {};
  function rotationFor(N, axis, dir) {
    var key = N + ':' + axis + ':' + dir;
    if (!rotCache[key]) rotCache[key] = CubeN.wholeRotation(N, axis, dir);
    return rotCache[key];
  }

  /**
   * @param canvas  where to draw the grey cube; omit for the bookkeeping alone
   * @param opts    { size, colors, state, blank, startText }
   */
  function CubeGuide(canvas, opts) {
    opts = opts || {};
    this.size = opts.size || 3;
    this.colors = opts.colors || [];
    this.state = opts.state || null;
    this.startText = opts.startText || SEQ[0].text;
    this.step = 0;
    this.W = identity(6 * this.size * this.size);
    this.yaw = 0;
    this.pitch = 0;

    if (canvas && CubeView) {
      this.view = new CubeView(canvas, {
        colors: this.colors,
        size: this.size,
        state: this.state,
        // no dragging: this is an instruction, and an instruction you can spin
        // to a different angle is no longer telling you anything
        draggable: false,
        blank: opts.blank || '#5b6270'
      });
      this.paint();
    }
  }

  CubeGuide.STEPS = SEQ.length;

  CubeGuide.prototype.setSize = function (N) {
    this.size = N;
    if (this.view) this.view.setSize(N);
    this.setStep(0, false);
  };

  CubeGuide.prototype.setState = function (state) {
    this.state = state;
    if (this.view) this.view.setState(state);
  };

  /**
   * Go to a step, replaying the route from the start so back works too.
   *
   * `hold` delays the turn without delaying the step. A face that is filled in
   * and whisked away in the same instant was never actually shown — the point
   * of the second cube is that you get to look at what was read — so the
   * scanner asks for a beat before it turns. The bookkeeping moves on straight
   * away regardless, because someone quicker than the animation can take the
   * next photo during that beat and it has to land on the next face, not on
   * top of the one they are still looking at.
   */
  CubeGuide.prototype.setStep = function (n, animate, onDone, hold) {
    n = Math.max(0, Math.min(SEQ.length - 1, n));
    this.step = n;

    var W = identity(6 * this.size * this.size);
    var yaw = 0, pitch = 0;
    for (var i = 1; i <= n; i++) {
      var s = SEQ[i];
      for (var t = 0; t < s.turns; t++) {
        W = compose(W, rotationFor(this.size, s.axis, s.dir));
        yaw += s.dYaw;
        pitch += s.dPitch;
      }
    }
    this.W = W;

    if (!animate) {
      this.yaw = yaw; this.pitch = pitch;
      this.paint();
      if (onDone) onDone();
      return;
    }
    this.spinTo(yaw, pitch, onDone, hold);
  };

  CubeGuide.prototype.next = function (onDone, hold) { this.setStep(this.step + 1, true, onDone, hold); };
  CubeGuide.prototype.back = function (onDone) { this.setStep(this.step - 1, true, onDone); };
  CubeGuide.prototype.atEnd = function () { return this.step >= SEQ.length - 1; };

  CubeGuide.prototype.spinTo = function (yaw, pitch, onDone, hold) {
    var self = this;
    clearTimeout(this.timer);
    if (hold) {
      this.timer = setTimeout(function () { self.spinTo(yaw, pitch, onDone); }, hold);
      return;
    }
    var fromYaw = this.yaw, fromPitch = this.pitch;
    var start = null;
    cancelAnimationFrame(this.raf);
    var tick = function (now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / SPIN_MS);
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      self.yaw = fromYaw + (yaw - fromYaw) * e;
      self.pitch = fromPitch + (pitch - fromPitch) * e;
      self.paint();
      if (t < 1) self.raf = requestAnimationFrame(tick);
      else if (onDone) onDone();
    };
    this.raf = requestAnimationFrame(tick);
  };

  CubeGuide.prototype.paint = function () {
    if (!this.view) return;
    this.view.setView(this.yaw + TILT_YAW, this.pitch + TILT_PITCH);
  };

  CubeGuide.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    if (this.view) this.view.destroy();
  };

  /**
   * The facelets of the face now toward you, in the order you see them:
   * left to right, top to bottom, as a photo of it would come out.
   */
  CubeGuide.prototype.faceCells = function () {
    var per = this.size * this.size, base = 2 * per;   // 2 is F, the front
    var out = new Array(per);
    for (var k = 0; k < per; k++) out[k] = this.W[base + k];
    return out;
  };

  /** Which of the cube's own six faces is the one toward you. */
  CubeGuide.prototype.faceIndex = function () {
    var per = this.size * this.size;
    return Math.floor(this.W[2 * per] / per);
  };

  /** Write what was photographed (or painted) into the cube's own frame. */
  CubeGuide.prototype.fill = function (values) {
    var cells = this.faceCells();
    for (var k = 0; k < cells.length; k++) this.state[cells[k]] = values[k];
    if (this.view) this.view.dirty = true;
  };

  CubeGuide.prototype.instruction = function () {
    var s = SEQ[this.step];
    return { arrow: s.arrow, text: this.step === 0 ? this.startText : s.text, step: this.step };
  };

  CubeGuide.SEQ = SEQ;
  return CubeGuide;
});
