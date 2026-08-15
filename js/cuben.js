/*
 * cuben.js — the cube model for any size: 3x3, 4x4, 5x5.
 *
 * cube.js hand-writes the sticker cycles for a 3x3. That is fine for six moves
 * and 54 stickers; for a 4x4 it is twelve moves and 96 stickers, and for a 5x5
 * eighteen and 150. Hand-writing those is a transcription error waiting to
 * happen, and a wrong cycle produces a solver that confidently solves a cube
 * nobody owns.
 *
 * So nothing is transcribed here. Each sticker is placed in 3D, layers are
 * rotated by actually rotating them, and the sticker is looked up again at its
 * new position. The move tables fall out of the geometry, which means they are
 * right for every size by construction — and test/cuben.test.js checks the
 * N=3 tables come out identical to the hand-written ones in cube.js.
 *
 * Facelets are numbered face-major, row-major, in the same order and with the
 * same conventions as cube.js:
 *   U 0.., R .., F .., D .., L .., B ..   (each N*N)
 *   U: row 0 is the back edge, col 0 the left
 *   R/F/L/B: row 0 is the top edge
 *   D: row 0 is the front edge
 */
;(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeN = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FACE_LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];
  var AXIS = { x: 0, y: 1, z: 2 };

  /**
   * The 3D centre of a sticker, and the direction it faces.
   * Cell centres sit at -(N-1)/2 .. +(N-1)/2; the surface is at ±N/2.
   */
  function stickerPoint(N, face, row, col) {
    var h = N / 2;                       // distance from centre to a face
    var c = function (i) { return i - (N - 1) / 2; };
    switch (face) {
      case 0: return { p: [c(col), h, c(row)], n: [0, 1, 0] };        // U  row0 = back,  col0 = left
      case 1: return { p: [h, -c(row), -c(col)], n: [1, 0, 0] };      // R  row0 = top,   col0 = front
      case 2: return { p: [c(col), -c(row), h], n: [0, 0, 1] };       // F  row0 = top,   col0 = left
      case 3: return { p: [c(col), -h, -c(row)], n: [0, -1, 0] };     // D  row0 = front, col0 = left
      case 4: return { p: [-h, -c(row), c(col)], n: [-1, 0, 0] };     // L  row0 = top,   col0 = back
      default: return { p: [-c(col), -c(row), -h], n: [0, 0, -1] };   // B  row0 = top,   col0 = right
    }
  }

  /** The inverse: which sticker is at this point, facing this way. */
  function stickerIndex(N, p, n) {
    var h = N / 2;
    var unc = function (v) { return Math.round(v + (N - 1) / 2); };
    var near = function (a, b) { return Math.abs(a - b) < 1e-6; };
    var face, row, col;
    if (near(n[1], 1)) { face = 0; row = unc(p[2]); col = unc(p[0]); }
    else if (near(n[0], 1)) { face = 1; row = unc(-p[1]); col = unc(-p[2]); }
    else if (near(n[2], 1)) { face = 2; row = unc(-p[1]); col = unc(p[0]); }
    else if (near(n[1], -1)) { face = 3; row = unc(-p[2]); col = unc(p[0]); }
    else if (near(n[0], -1)) { face = 4; row = unc(-p[1]); col = unc(p[2]); }
    else { face = 5; row = unc(-p[1]); col = unc(-p[0]); }
    if (row < 0 || row >= N || col < 0 || col >= N) return -1;
    return face * N * N + row * N + col;
  }

  /** Right-handed rotation by a quarter turn, `dir` times, about `axis`. */
  function rotate(v, axis, dir) {
    var x = v[0], y = v[1], z = v[2];
    for (var t = 0; t < ((dir % 4) + 4) % 4; t++) {
      if (axis === AXIS.x) { var ny = -z, nz = y; y = ny; z = nz; }
      else if (axis === AXIS.y) { var nx = z, nz2 = -x; x = nx; z = nz2; }
      else { var nx2 = -y, ny2 = x; x = nx2; y = ny2; }
    }
    return [x, y, z];
  }

  /**
   * Which layer a sticker belongs to, counted from the positive end of the
   * axis: 0 is the outermost layer on the + side, N-1 the outermost on the -.
   * A sticker on a face perpendicular to the axis belongs to the layer it caps.
   */
  function layerOf(N, sticker, axis) {
    if (sticker.n[axis] > 0.5) return 0;
    if (sticker.n[axis] < -0.5) return N - 1;
    return Math.round((N - 1) / 2 - sticker.p[axis]);
  }

  /**
   * The permutation for turning one layer a quarter turn.
   * perm[i] = where the sticker now at i came from.
   */
  function layerPermutation(N, axis, layer, dir) {
    var size = 6 * N * N;
    var perm = new Int32Array(size);
    for (var i = 0; i < size; i++) perm[i] = i;

    for (var face = 0; face < 6; face++) {
      for (var row = 0; row < N; row++) {
        for (var col = 0; col < N; col++) {
          var from = face * N * N + row * N + col;
          var s = stickerPoint(N, face, row, col);
          if (layerOf(N, s, axis) !== layer) continue;
          var to = stickerIndex(N, rotate(s.p, axis, dir), rotate(s.n, axis, dir));
          if (to < 0) throw new Error('a sticker rotated off the cube — geometry is wrong');
          perm[to] = from;
        }
      }
    }
    return perm;
  }

  function composePerm(a, b) {          // apply a, then b
    var out = new Int32Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[b[i]];
    return out;
  }

  /**
   * Every move for a cube of this size.
   *
   * Outer faces keep their usual capitals. The layers underneath take the same
   * letter in lower case, numbered outwards: on a 4x4, `u` is the layer just
   * under U; on a 5x5, `u` then `u2layer`... which is why deeper layers are
   * written u1, u2 rather than piling on more letters.
   */
  function build(N) {
    var perms = {};
    var names = [];
    var depth = Math.floor(N / 2);        // layers reachable from each side

    FACE_LETTERS.forEach(function (letter, face) {
      var axis = (face === 0 || face === 3) ? AXIS.y : (face === 1 || face === 4) ? AXIS.x : AXIS.z;
      var positiveSide = (face === 0 || face === 1 || face === 2);
      for (var d = 0; d < depth; d++) {
        // a face turn is clockwise seen from outside that face
        var dir = positiveSide ? -1 : 1;
        var layer = positiveSide ? d : N - 1 - d;
        var base = d === 0 ? letter : (d === 1 ? letter.toLowerCase() : letter.toLowerCase() + d);
        var quarter = layerPermutation(N, axis, layer, dir);
        perms[base] = quarter;
        perms[base + '2'] = composePerm(quarter, quarter);
        perms[base + "'"] = composePerm(perms[base + '2'], quarter);
        names.push(base, base + '2', base + "'");
      }
    });

    var solved = new Uint8Array(6 * N * N);
    for (var i = 0; i < solved.length; i++) solved[i] = Math.floor(i / (N * N));

    return {
      N: N,
      stickers: 6 * N * N,
      perFace: N * N,
      MOVE_PERMS: perms,
      MOVE_NAMES: names,
      SOLVED: solved,
      FACE_LETTERS: FACE_LETTERS,
      apply: function (state, move) {
        var perm = perms[move];
        if (!perm) throw new Error('unknown move for ' + N + 'x' + N + ': ' + move);
        var out = new Uint8Array(state.length);
        for (var i = 0; i < state.length; i++) out[i] = state[perm[i]];
        return out;
      },
      applySeq: function (state, moves) {
        var s = state;
        for (var i = 0; i < moves.length; i++) s = this.apply(s, moves[i]);
        return s;
      },
      isSolved: function (state) {
        for (var i = 0; i < state.length; i++) if (state[i] !== solved[i]) return false;
        return true;
      },
      randomScramble: function (n) {
        var out = [], last = '';
        while (out.length < (n || 40)) {
          var move = names[Math.floor(Math.random() * names.length)];
          var letter = move[0].toUpperCase();
          if (letter === last) continue;
          last = letter;
          out.push(move);
        }
        return out;
      }
    };
  }

  var cache = {};
  function of(N) {
    if (!cache[N]) cache[N] = build(N);
    return cache[N];
  }

  /**
   * Which layer a move turns, and which way. Anything that draws the cube asks
   * for this rather than working it out again, so a move can never animate one
   * layer while the model turns another.
   */
  function moveGeometry(N, move) {
    var letter = move[0];
    var face = FACE_LETTERS.indexOf(letter.toUpperCase());
    if (face < 0) return null;
    var body = move.slice(1).replace(/['2]/g, '');
    var deeper = parseInt(body, 10);
    var depth = letter === letter.toUpperCase() ? 0 : (isNaN(deeper) ? 1 : deeper);

    var axis = (face === 0 || face === 3) ? AXIS.y : (face === 1 || face === 4) ? AXIS.x : AXIS.z;
    var positiveSide = (face === 0 || face === 1 || face === 2);
    var layer = positiveSide ? depth : N - 1 - depth;
    var dir = positiveSide ? -1 : 1;
    if (/'/.test(move)) dir = -dir;
    var quarters = /2/.test(move.slice(1)) ? 2 : 1;
    return { axis: axis, layer: layer, dir: dir, quarters: quarters, angle: dir * quarters * 90 };
  }

  return {
    of: of,
    build: build,
    stickerPoint: stickerPoint,
    stickerIndex: stickerIndex,
    layerPermutation: layerPermutation,
    layerOf: layerOf,
    moveGeometry: moveGeometry,
    AXIS: AXIS,
    FACE_LETTERS: FACE_LETTERS
  };
});
