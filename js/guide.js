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
   * Two routes, because there are two places the cube gets looked at from.
   *
   * Which rotation shows you a new face depends entirely on where the lens is,
   * and this is not a detail:
   *
   *   - a turn about the vertical axis changes the FRONT face and leaves the
   *     top exactly where it was;
   *   - a roll about the front-back axis changes the TOP and leaves the front
   *     where it was;
   *   - only a tip about the left-right axis changes both.
   *
   * So a route of left-turns works perfectly when the cube is held up to the
   * camera and shows the same face three times running when the phone is
   * overhead — which is how this app tells people to scan, cube on a table and
   * the phone held over it. That was the bug: the route assumed one thing and
   * the advice said another.
   *
   *   camera — the phone is above the cube. The face being read is the TOP
   *            one, so the route is tips and rolls.
   *   hand   — nobody is holding a phone: the map screen, where the face being
   *            painted is the one toward you. Left-turns, as before.
   *
   * `face` is which slot of the cube the person is looking at, and everything
   * else here is asked of it. `axis`/`dir` are the whole-cube rotation the
   * hands make; `dYaw`/`dPitch` are the same rotation for the camera, and the
   * two have to agree or the picture stops being an instruction.
   */
  var X = CubeN.AXIS.x, Y = CubeN.AXIS.y;

  // one quarter turn of the whole cube, and the same turn for the camera
  function tip() { return { axis: X, dir: 1, dYaw: 0, dPitch: -90 }; }
  function spinLeft() { return { axis: Y, dir: -1, dYaw: -90, dPitch: 0 }; }
  function turnLeft() { return { axis: Y, dir: -1, dYaw: -90, dPitch: 0 }; }
  function tipToward() { return { axis: X, dir: 1, dYaw: 0, dPitch: 90 }; }

  var ROUTES = {
    /*
     * The phone is above the cube, so the face it reads is the TOP one, and
     * the route is rolls: three of them cover the top, back, bottom and front,
     * and the last two need a quarter turn first to bring a side face round to
     * where a roll can reach it.
     *
     * A roll about the front-back axis would be the tidy way to fetch the two
     * sides, and it is not available: the renderer has a yaw and a pitch and
     * no roll, so an instruction it cannot draw is an instruction that has to
     * be said in two parts instead. Turn, then roll.
     */
    camera: {
      face: 0,               // U
      view: { yaw: 180, pitch: 90 },
      steps: [
        { moves: [], arrow: '', text: 'Stand the cube in front of the camera, any face up.' },
        { moves: [tip()], arrow: '▼',
          text: 'ROLL the cube toward you — the face that was at the back comes up.' },
        { moves: [tip()], arrow: '▼',
          text: 'Roll it toward you again: now the face that was underneath is up.' },
        { moves: [tip()], arrow: '▼',
          text: 'Once more toward you, for the face that started nearest you.' },
        { moves: [spinLeft(), tip()], arrow: '◄',
          text: 'Now a quarter turn to the LEFT first, then roll toward you again — that brings a side face up.' },
        { moves: [tip(), tip()], arrow: '▼',
          text: 'Roll it toward you twice more, and that is the last face.' }
      ]
    },
    /*
     * Nobody is holding a phone here — this is the map screen, where the face
     * being painted is the one toward you, so a turn about the upright axis is
     * what brings a new one round.
     */
    hand: {
      face: 2,               // F
      view: { yaw: 0, pitch: 0 },
      steps: [
        { moves: [], arrow: '', text: 'Hold the cube upright, any face toward you.' },
        { moves: [turnLeft()], arrow: '◄',
          text: 'Turn the cube LEFT — the right-hand face comes round to the front.' },
        { moves: [turnLeft()], arrow: '◄',
          text: 'Turn it LEFT again — now the back face.' },
        { moves: [turnLeft()], arrow: '◄',
          text: 'Once more to the LEFT — the left-hand face.' },
        { moves: [tipToward()], arrow: '▼',
          text: 'Now TIP the cube toward you — the top face comes round to the front.' },
        { moves: [tipToward(), tipToward()], arrow: '▼',
          text: 'TIP it toward you twice more — the bottom face, and the last one.' }
      ]
    }
  };

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
    this.route = ROUTES[opts.route] || ROUTES.hand;
    this.seq = this.route.steps;
    this.startText = opts.startText || this.seq[0].text;
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

  CubeGuide.STEPS = ROUTES.hand.steps.length;

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
    n = Math.max(0, Math.min(this.seq.length - 1, n));
    this.step = n;

    var W = identity(6 * this.size * this.size);
    var yaw = this.route.view.yaw, pitch = this.route.view.pitch;
    for (var i = 1; i <= n; i++) {
      var moves = this.seq[i].moves;
      for (var t = 0; t < moves.length; t++) {
        W = compose(W, rotationFor(this.size, moves[t].axis, moves[t].dir));
        yaw += moves[t].dYaw;
        pitch += moves[t].dPitch;
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
  CubeGuide.prototype.atEnd = function () { return this.step >= this.seq.length - 1; };

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
    var per = this.size * this.size, base = this.route.face * per;
    var out = new Array(per);
    for (var k = 0; k < per; k++) out[k] = this.W[base + k];
    return out;
  };

  /** Which of the cube's own six faces is the one toward you. */
  CubeGuide.prototype.faceIndex = function () {
    var per = this.size * this.size;
    return Math.floor(this.W[this.route.face * per] / per);
  };

  /** Write what was photographed (or painted) into the cube's own frame. */
  CubeGuide.prototype.fill = function (values) {
    var cells = this.faceCells();
    for (var k = 0; k < cells.length; k++) this.state[cells[k]] = values[k];
    if (this.view) this.view.dirty = true;
  };

  CubeGuide.prototype.instruction = function () {
    var s = this.seq[this.step];
    return { arrow: s.arrow, text: this.step === 0 ? this.startText : s.text, step: this.step };
  };

  CubeGuide.ROUTES = ROUTES;
  return CubeGuide;
});
