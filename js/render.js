/*
 * render.js — a small software 3D renderer for the cube, drawn on a 2D canvas.
 *
 * No libraries: every sticker is a quad, drawn back to front with backface
 * culling. The default camera sits off a corner so three faces are visible at
 * once, which is how the instructions are meant to be read.
 *
 * A move is shown by actually rotating the affected layer, dimming everything
 * else, and drawing a curved arrow around the turning axis.
 *
 * Works at any cube size. The sticker positions are not worked out here — they
 * come from cuben.js, the same code the model uses, so what is drawn and what
 * is turned can never disagree about where a sticker is.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cuben.js') : root.CubeN);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN) {
  'use strict';

  var DEG = Math.PI / 180;
  var STICKER = 0.44;       // half-width of a sticker, in cell widths
  var PLASTIC = '#14161c';
  var BLANK = '#31363f';    // a sticker with no color chosen yet

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(v, k) { return [v[0] * k, v[1] * k, v[2] * k]; }
  function add() {
    var out = [0, 0, 0];
    for (var i = 0; i < arguments.length; i++) {
      out[0] += arguments[i][0]; out[1] += arguments[i][1]; out[2] += arguments[i][2];
    }
    return out;
  }

  function rotateAbout(p, axis, a) {
    var c = Math.cos(a), s = Math.sin(a);
    if (axis === 0) return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
    if (axis === 1) return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }

  function CubeView(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colors = opts.colors || ['#eee', '#fd0', '#0a6', '#05b', '#c23', '#f80'];
    this.size = opts.size || 3;
    this.state = opts.state || new Int8Array(6 * this.size * this.size).fill(-1);
    this.yaw = opts.yaw === undefined ? -34 : opts.yaw;
    this.pitch = opts.pitch === undefined ? 26 : opts.pitch;
    this.zoom = opts.zoom || 1;
    this.showArrowFor = null;   // move string to draw a hint arrow for
    this.anim = null;
    this.dirty = true;
    this.geometry = this.buildGeometry();
    this.onStickerPick = opts.onStickerPick || null;

    var self = this;
    this.loop = function () {
      self.tick();
      self.raf = requestAnimationFrame(self.loop);
    };
    this.raf = requestAnimationFrame(this.loop);
    if (opts.draggable !== false) this.enableDrag();
    if (this.onStickerPick) this.enablePicking();
  }

  /** Swap in a different cube size, keeping the camera where it is. */
  CubeView.prototype.setSize = function (N) {
    if (N === this.size) return;
    this.size = N;
    this.state = new Int8Array(6 * N * N).fill(-1);
    this.geometry = this.buildGeometry();
    this.anim = null;
    this.dirty = true;
  };

  /**
   * Every quad to draw: one backing panel per face so the cube reads as solid,
   * then a sticker per facelet. Positions come from cuben.js.
   */
  CubeView.prototype.buildGeometry = function () {
    var N = this.size;
    var list = [];

    for (var face = 0; face < 6; face++) {
      var origin = CubeN.stickerPoint(N, face, 0, 0);
      var right = sub(CubeN.stickerPoint(N, face, 0, 1).p, origin.p);
      var down = sub(CubeN.stickerPoint(N, face, 1, 0).p, origin.p);
      var normal = origin.n;

      // the black panel behind the stickers, a hair below the surface
      var centre = add(origin.p, scale(right, (N - 1) / 2), scale(down, (N - 1) / 2), scale(normal, -0.02));
      var halfR = scale(right, N / 2), halfD = scale(down, N / 2);
      list.push({
        facelet: -1,
        normal: normal,
        layerFor: null,
        verts: [
          add(centre, scale(halfR, -1), scale(halfD, -1)),
          add(centre, halfR, scale(halfD, -1)),
          add(centre, halfR, halfD),
          add(centre, scale(halfR, -1), halfD)
        ]
      });

      for (var row = 0; row < N; row++) {
        for (var col = 0; col < N; col++) {
          var s = CubeN.stickerPoint(N, face, row, col);
          var r = scale(right, STICKER), d = scale(down, STICKER);
          list.push({
            facelet: face * N * N + row * N + col,
            normal: normal,
            point: s.p,
            verts: [
              add(s.p, scale(r, -1), scale(d, -1)),
              add(s.p, r, scale(d, -1)),
              add(s.p, r, d),
              add(s.p, scale(r, -1), d)
            ]
          });
        }
      }
    }

    // which layer each quad belongs to, per axis, so a turn knows what to move
    list.forEach(function (quad) {
      quad.layer = [0, 1, 2].map(function (axis) {
        var reference = quad.point || quad.verts.reduce(function (acc, v) {
          return [acc[0] + v[0] / 4, acc[1] + v[1] / 4, acc[2] + v[2] / 4];
        }, [0, 0, 0]);
        return CubeN.layerOf(N, { p: reference, n: quad.normal }, axis);
      });
    });
    return list;
  };

  CubeView.prototype.setState = function (state) {
    this.state = state;
    this.dirty = true;
  };

  CubeView.prototype.setView = function (yaw, pitch) {
    this.yaw = yaw; this.pitch = pitch; this.dirty = true;
  };

  CubeView.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
  };

  /** Animate one move. `onDone` fires once the layer has landed. */
  CubeView.prototype.playMove = function (move, duration, onDone) {
    var g = CubeN.moveGeometry(this.size, move);
    if (!g) { if (onDone) onDone(); return; }
    this.anim = {
      axis: g.axis, layer: g.layer, angle: g.angle,
      t: 0, dur: Math.max(60, duration || 420), move: move, onDone: onDone
    };
    this.last = performance.now();
    this.dirty = true;
  };

  CubeView.prototype.stopAnimation = function () {
    if (this.anim && this.anim.onDone) this.anim.onDone();
    this.anim = null;
    this.dirty = true;
  };

  CubeView.prototype.tick = function () {
    var now = performance.now();
    this.resize();
    if (this.anim) {
      var dt = now - (this.last || now);
      this.last = now;
      this.anim.t = Math.min(1, this.anim.t + dt / this.anim.dur);
      this.dirty = true;
      if (this.anim.t >= 1) {
        var done = this.anim.onDone;
        this.anim = null;
        if (done) done();
      }
    } else if (this.showArrowFor) {
      this.dirty = true;
    }
    if (this.dirty) { this.draw(); this.dirty = false; }
  };

  CubeView.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }
  };

  CubeView.prototype.camera = function () {
    var cy = Math.cos(this.yaw * DEG), sy = Math.sin(this.yaw * DEG);
    var cp = Math.cos(this.pitch * DEG), sp = Math.sin(this.pitch * DEG);
    return function (p) {
      var x = p[0] * cy + p[2] * sy;
      var z = -p[0] * sy + p[2] * cy;
      var y = p[1];
      return [x, y * cp - z * sp, y * sp + z * cp];
    };
  };

  CubeView.prototype.projector = function () {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = rect.width * dpr, h = rect.height * dpr;
    var dist = 9.5 * this.size / 3;
    // a bigger cube is physically bigger, so pull the camera back with it and
    // the thing stays the same size on screen
    var focal = Math.min(w, h) * 1.55 * this.zoom * (this.size / 3);
    var cx = w / 2, cy = h / 2;
    this.dist = dist;
    return function (v) {
      var k = focal / (dist - v[2]);
      return [cx + v[0] * k, cy - v[1] * k];
    };
  };

  CubeView.prototype.draw = function () {
    var ctx = this.ctx;
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width * dpr, rect.height * dpr);

    var cam = this.camera();
    var project = this.projector();
    var dist = this.dist;
    var anim = this.anim;
    var angle = anim ? anim.angle * DEG * this.ease(anim.t) : 0;
    var hint = !anim && this.showArrowFor ? CubeN.moveGeometry(this.size, this.showArrowFor) : null;
    var focusAxis = anim ? anim.axis : (hint ? hint.axis : -1);
    var focusLayer = anim ? anim.layer : (hint ? hint.layer : -1);

    var quads = [];
    for (var i = 0; i < this.geometry.length; i++) {
      var g = this.geometry[i];
      var moving = anim && g.layer[anim.axis] === anim.layer;
      var inFocus = focusAxis >= 0 && g.layer[focusAxis] === focusLayer;
      var pts = [], depth = 0, cx3 = 0, cy3 = 0, cz3 = 0;
      for (var k = 0; k < 4; k++) {
        var p = g.verts[k];
        if (moving) p = rotateAbout(p, anim.axis, angle);
        var v = cam(p);
        pts.push(v);
        depth += v[2] / 4; cx3 += v[0] / 4; cy3 += v[1] / 4; cz3 += v[2] / 4;
      }
      var n = g.normal;
      if (moving) n = rotateAbout(n, anim.axis, angle);
      n = cam(n);
      if (n[0] * -cx3 + n[1] * -cy3 + n[2] * (dist - cz3) <= 0) continue;
      quads.push({ pts: pts.map(project), depth: depth, facelet: g.facelet, focus: inFocus });
    }
    quads.sort(function (a, b) { return a.depth - b.depth; });

    var dim = focusAxis >= 0;
    for (var q = 0; q < quads.length; q++) {
      this.drawQuad(ctx, quads[q], dim && !quads[q].focus ? 0.42 : 1);
    }

    if (anim || hint) {
      var info = anim || { axis: hint.axis, layer: hint.layer, angle: hint.angle };
      this.drawArrow(ctx, cam, project, info);
    }
  };

  CubeView.prototype.ease = function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  CubeView.prototype.drawQuad = function (ctx, quad, alpha) {
    var pts = quad.pts;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();

    if (quad.facelet < 0) {
      ctx.fillStyle = PLASTIC;
      ctx.fill();
    } else {
      var v = this.state[quad.facelet];
      ctx.fillStyle = (v === undefined || v === null || v < 0) ? BLANK : this.colors[v];
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.1);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  /** Curved arrow wrapped around the turning axis, on the side facing us. */
  CubeView.prototype.drawArrow = function (ctx, cam, project, info) {
    var N = this.size;
    var axis = info.axis, angle = info.angle;
    var basis = axis === 0 ? [[0, 1, 0], [0, 0, 1]]
      : axis === 1 ? [[0, 0, 1], [1, 0, 0]]
        : [[1, 0, 0], [0, 1, 0]];
    var radius = N * 0.72;
    // sit the arrow over the middle of the layer being turned
    var offset = (N / 2 - 0.5) - info.layer;
    if (info.layer === 0) offset = N / 2 + 0.05;
    if (info.layer === N - 1) offset = -(N / 2 + 0.05);

    function point(theta) {
      var p = [0, 0, 0];
      for (var i = 0; i < 3; i++) {
        p[i] = basis[0][i] * Math.cos(theta) * radius + basis[1][i] * Math.sin(theta) * radius;
      }
      p[axis] += offset;
      return p;
    }

    var best = 0, bestZ = -Infinity;
    for (var a = 0; a < 48; a++) {
      var th = a / 48 * Math.PI * 2;
      var v = cam(point(th));
      if (v[2] > bestZ) { bestZ = v[2]; best = th; }
    }

    var span = (Math.abs(angle) >= 180 ? 150 : 105) * DEG;
    var dir = angle >= 0 ? 1 : -1;
    var start = best - dir * span / 2;

    var pts = [];
    var steps = 28;
    for (var i2 = 0; i2 <= steps; i2++) {
      pts.push(project(cam(point(start + dir * span * (i2 / steps)))));
    }

    var dpr = window.devicePixelRatio || 1;
    var pulse = this.anim ? 1 : 0.75 + 0.25 * Math.sin(performance.now() / 320);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 11 * dpr;
    strokePath(ctx, pts);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.92 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 6 * dpr;
    strokePath(ctx, pts);

    var end = pts[pts.length - 1], prev = pts[pts.length - 4];
    var dx = end[0] - prev[0], dy = end[1] - prev[1];
    var len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    var size = 17 * dpr;
    var nx = -dy, ny = dx;
    ctx.beginPath();
    ctx.moveTo(end[0] + dx * size, end[1] + dy * size);
    ctx.lineTo(end[0] - dx * size * 0.35 + nx * size * 0.62, end[1] - dy * size * 0.35 + ny * size * 0.62);
    ctx.lineTo(end[0] - dx * size * 0.35 - nx * size * 0.62, end[1] - dy * size * 0.35 - ny * size * 0.62);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.92 * pulse).toFixed(3) + ')';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3 * dpr;
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    function strokePath(c, list) {
      c.beginPath();
      c.moveTo(list[0][0], list[0][1]);
      for (var j = 1; j < list.length; j++) c.lineTo(list[j][0], list[j][1]);
      c.stroke();
    }
  };

  CubeView.prototype.enableDrag = function () {
    var self = this, dragging = false, lastX = 0, lastY = 0;
    this.canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      self.canvas.setPointerCapture(e.pointerId);
      self.canvas.classList.add('grabbing');
    });
    this.canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      self.yaw += (e.clientX - lastX) * 0.45;
      self.pitch = Math.max(-80, Math.min(80, self.pitch - (e.clientY - lastY) * 0.45));
      lastX = e.clientX; lastY = e.clientY;
      self.dirty = true;
    });
    function stop(e) {
      dragging = false;
      self.canvas.classList.remove('grabbing');
      try { self.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  };

  /** Click a visible sticker (used by the 3D painting mode). */
  CubeView.prototype.enablePicking = function () {
    var self = this;
    var downAt = null;
    this.canvas.addEventListener('pointerdown', function (e) { downAt = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointerup', function (e) {
      if (!downAt) return;
      var moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      var hit = self.pick(e);
      if (hit >= 0) self.onStickerPick(hit, e);
    });
  };

  CubeView.prototype.pick = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
    var cam = this.camera(), project = this.projector();
    var dist = this.dist;
    var best = -1, bestDepth = -Infinity;
    for (var i = 0; i < this.geometry.length; i++) {
      var g = this.geometry[i];
      if (g.facelet < 0) continue;
      var pts = [], cx = 0, cy = 0, cz = 0, depth = 0;
      for (var k = 0; k < 4; k++) {
        var v = cam(g.verts[k]);
        cx += v[0] / 4; cy += v[1] / 4; cz += v[2] / 4;
        depth += v[2] / 4;
        pts.push(project(v));
      }
      var n = cam(g.normal);
      if (n[0] * -cx + n[1] * -cy + n[2] * (dist - cz) <= 0) continue;
      if (pointInQuad(mx, my, pts) && depth > bestDepth) { bestDepth = depth; best = g.facelet; }
    }
    return best;
  };

  function pointInQuad(x, y, pts) {
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  return CubeView;
});
