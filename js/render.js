/*
 * render.js — a small software 3D renderer for the cube, drawn on a 2D canvas.
 *
 * No libraries: 27 cubies, six quads each, painter's algorithm plus backface
 * culling. The default camera sits off a corner so three faces are visible at
 * once, which is how the instructions are meant to be read.
 *
 * A move is shown by actually rotating the affected layer, dimming everything
 * else, and drawing a curved arrow around the turning axis.
 */
;(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  var HALF = 0.47;          // half-size of a cubie (leaves a seam between them)
  var PLASTIC = '#14161c';
  var BLANK = '#31363f';    // sticker with no color chosen yet

  // Sticker plane normals, in facelet order U R F D L B.
  var NORMALS = [
    [0, 1, 0], [1, 0, 0], [0, 0, 1],
    [0, -1, 0], [-1, 0, 0], [0, 0, -1]
  ];

  // Which facelet index does the sticker on `face` of cubie (x,y,z) use?
  function faceletIndex(face, x, y, z) {
    switch (face) {
      case 0: return 0 + (z + 1) * 3 + (x + 1);   // U  (+y)
      case 1: return 9 + (1 - y) * 3 + (1 - z);   // R  (+x)
      case 2: return 18 + (1 - y) * 3 + (x + 1);  // F  (+z)
      case 3: return 27 + (1 - z) * 3 + (x + 1);  // D  (-y)
      case 4: return 36 + (1 - y) * 3 + (z + 1);  // L  (-x)
      default: return 45 + (1 - y) * 3 + (1 - x); // B  (-z)
    }
  }

  // Four corners of a sticker quad, wound counter-clockwise seen from outside.
  function quadFor(face, x, y, z) {
    var s = HALF;
    switch (face) {
      case 0: return [[x - s, y + s, z + s], [x + s, y + s, z + s], [x + s, y + s, z - s], [x - s, y + s, z - s]];
      case 1: return [[x + s, y + s, z + s], [x + s, y - s, z + s], [x + s, y - s, z - s], [x + s, y + s, z - s]];
      case 2: return [[x - s, y - s, z + s], [x + s, y - s, z + s], [x + s, y + s, z + s], [x - s, y + s, z + s]];
      case 3: return [[x - s, y - s, z - s], [x + s, y - s, z - s], [x + s, y - s, z + s], [x - s, y - s, z + s]];
      case 4: return [[x - s, y + s, z - s], [x - s, y - s, z - s], [x - s, y - s, z + s], [x - s, y + s, z + s]];
      default: return [[x + s, y - s, z - s], [x - s, y - s, z - s], [x - s, y + s, z - s], [x + s, y + s, z - s]];
    }
  }

  // move letter -> turning axis, which layer, and the sign of a clockwise turn
  var MOVE_GEOM = {
    U: { axis: 1, layer: 1, dir: -1 },
    D: { axis: 1, layer: -1, dir: 1 },
    R: { axis: 0, layer: 1, dir: -1 },
    L: { axis: 0, layer: -1, dir: 1 },
    F: { axis: 2, layer: 1, dir: -1 },
    B: { axis: 2, layer: -1, dir: 1 }
  };

  function moveGeometry(move) {
    var g = MOVE_GEOM[move[0]];
    if (!g) return null;
    var quarter = move.length > 1 && move[1] === '2' ? 2 : 1;
    var sign = move.length > 1 && move[1] === "'" ? -1 : 1;
    return { axis: g.axis, layer: g.layer, angle: g.dir * sign * quarter * 90 };
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
    this.state = opts.state || new Int8Array(54).fill(-1);
    this.yaw = opts.yaw === undefined ? -34 : opts.yaw;
    this.pitch = opts.pitch === undefined ? 26 : opts.pitch;
    this.zoom = opts.zoom || 1;
    this.showArrowFor = null;   // move string to draw a hint arrow for
    this.anim = null;           // { axis, layer, from, to, t, dur }
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

  CubeView.prototype.buildGeometry = function () {
    var list = [];
    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          for (var f = 0; f < 6; f++) {
            var n = NORMALS[f];
            var outer = (n[0] && x === n[0]) || (n[1] && y === n[1]) || (n[2] && z === n[2]);
            list.push({
              cubie: [x, y, z],
              face: f,
              normal: n,
              verts: quadFor(f, x, y, z),
              facelet: outer ? faceletIndex(f, x, y, z) : -1
            });
          }
        }
      }
    }
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
    var g = moveGeometry(move);
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
    this.resize(); // marks dirty when the canvas box changed size
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
      this.dirty = true; // the hint arrow pulses
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
      // yaw about Y, then pitch about X
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
    var dist = 9.5;
    // chosen so the cube fills roughly 80% of the shorter canvas edge
    var focal = Math.min(w, h) * 1.55 * this.zoom;
    var cx = w / 2, cy = h / 2;
    return function (v) {
      var k = focal / (dist - v[2]);
      return [cx + v[0] * k, cy - v[1] * k];
    };
  };

  CubeView.prototype.draw = function () {
    this.resize();
    var ctx = this.ctx;
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width * dpr, rect.height * dpr);

    var cam = this.camera();
    var project = this.projector();
    var anim = this.anim;
    var angle = anim ? anim.angle * DEG * this.ease(anim.t) : 0;
    var hint = !anim && this.showArrowFor ? moveGeometry(this.showArrowFor) : null;
    var focusAxis = anim ? anim.axis : (hint ? hint.axis : -1);
    var focusLayer = anim ? anim.layer : (hint ? hint.layer : 0);

    var quads = [];
    for (var i = 0; i < this.geometry.length; i++) {
      var g = this.geometry[i];
      var moving = anim && g.cubie[anim.axis] === anim.layer;
      var inFocus = focusAxis >= 0 && g.cubie[focusAxis] === focusLayer;
      var pts = [], depth = 0, cx3 = 0, cy3 = 0, cz3 = 0;
      for (var k = 0; k < 4; k++) {
        var p = g.verts[k];
        if (moving) p = rotateAbout(p, anim.axis, angle);
        var v = cam(p);
        pts.push(v);
        depth += v[2]; cx3 += v[0]; cy3 += v[1]; cz3 += v[2];
      }
      var n = g.normal;
      if (moving) n = rotateAbout(n, anim.axis, angle);
      n = cam(n);
      // visible if the outward normal points back toward the camera
      var vx = -cx3 / 4, vy = -cy3 / 4, vz = 9.5 - cz3 / 4;
      if (n[0] * vx + n[1] * vy + n[2] * vz <= 0) continue;
      quads.push({ pts: pts.map(project), depth: depth / 4, facelet: g.facelet, focus: inFocus });
    }
    quads.sort(function (a, b) { return a.depth - b.depth; });

    var dim = focusAxis >= 0;
    for (var q = 0; q < quads.length; q++) {
      this.drawQuad(ctx, quads[q], dim && !quads[q].focus ? 0.42 : 1);
    }

    if (anim || hint) {
      this.drawArrow(ctx, cam, project, anim ? anim : { axis: hint.axis, layer: hint.layer, angle: hint.angle, t: 0 });
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
    ctx.fillStyle = PLASTIC;
    ctx.fill();

    if (quad.facelet >= 0) {
      var v = this.state[quad.facelet];
      var color = (v === undefined || v === null || v < 0) ? BLANK : this.colors[v];
      var mx = 0, my = 0;
      for (var j = 0; j < 4; j++) { mx += pts[j][0] / 4; my += pts[j][1] / 4; }
      var inset = 0.13;
      ctx.beginPath();
      for (var k = 0; k < 4; k++) {
        var x = pts[k][0] + (mx - pts[k][0]) * inset;
        var y = pts[k][1] + (my - pts[k][1]) * inset;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Curved arrow wrapped around the turning axis, placed on the side of the
  // cube that currently faces the camera.
  CubeView.prototype.drawArrow = function (ctx, cam, project, info) {
    var axis = info.axis, layer = info.layer, angle = info.angle;
    var basis = axis === 0 ? [[0, 1, 0], [0, 0, 1]]
      : axis === 1 ? [[0, 0, 1], [1, 0, 0]]
        : [[1, 0, 0], [0, 1, 0]];
    var radius = 2.05;
    var offset = layer * 1.55;

    function point(theta) {
      var p = [0, 0, 0];
      for (var i = 0; i < 3; i++) p[i] = basis[0][i] * Math.cos(theta) * radius + basis[1][i] * Math.sin(theta) * radius;
      p[axis] += offset;
      return p;
    }

    // pick the arc position closest to the viewer
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
    for (var i = 0; i <= steps; i++) {
      pts.push(project(cam(point(start + dir * span * (i / steps)))));
    }

    var dpr = window.devicePixelRatio || 1;
    var pulse = this.anim ? 1 : 0.75 + 0.25 * Math.sin(performance.now() / 320);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // dark backing so the arrow reads over any sticker color
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 11 * dpr;
    strokePath(ctx, pts);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.92 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 6 * dpr;
    strokePath(ctx, pts);

    // arrowhead
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
      if (moved > 6) return; // that was a drag, not a click
      var hit = self.pick(e);
      if (hit >= 0) self.onStickerPick(hit, e);
    });
  };

  CubeView.prototype.pick = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
    var cam = this.camera(), project = this.projector();
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
      if (n[0] * -cx + n[1] * -cy + n[2] * (9.5 - cz) <= 0) continue;
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

  root.CubeView = CubeView;
  root.cubeMoveGeometry = moveGeometry;
})(typeof globalThis !== 'undefined' ? globalThis : this);
