/*
 * cube.js — 3x3x3 Rubik's cube state model.
 *
 * State is a 54-entry array of facelets, indexed in the standard order:
 *   U: 0-8, R: 9-17, F: 18-26, D: 27-35, L: 36-44, B: 45-53
 *
 * Each face panel is read row-major as it appears on the classic unfolded net:
 *
 *              U0 U1 U2
 *              U3 U4 U5
 *              U6 U7 U8
 *   L0 L1 L2   F0 F1 F2   R0 R1 R2   B0 B1 B2
 *   L3 L4 L5   F3 F4 F5   R3 R4 R5   B3 B4 B5
 *   L6 L7 L8   F6 F7 F8   R6 R7 R8   B6 B7 B8
 *              D0 D1 D2
 *              D3 D4 D5
 *              D6 D7 D8
 *
 * Values in a state array are either face ids (0..5, "solver space") or
 * palette color ids (0..5, "display space"). Moves are plain permutations, so
 * the same tables drive both.
 */
;(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Cube = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;
  var FACE_LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  var CENTERS = [4, 13, 22, 31, 40, 49];
  var OPPOSITE_FACE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

  // Each cycle lists facelet positions in the order the stickers travel:
  // [a, b, c, d] means the sticker on a moves to b, b to c, c to d, d to a.
  var BASE_CYCLES = {
    U: [[0, 2, 8, 6], [1, 5, 7, 3], [18, 36, 45, 9], [19, 37, 46, 10], [20, 38, 47, 11]],
    R: [[9, 11, 17, 15], [10, 14, 16, 12], [20, 2, 51, 29], [23, 5, 48, 32], [26, 8, 45, 35]],
    F: [[18, 20, 26, 24], [19, 23, 25, 21], [6, 9, 29, 44], [7, 12, 28, 41], [8, 15, 27, 38]],
    D: [[27, 29, 35, 33], [28, 32, 34, 30], [24, 15, 51, 42], [25, 16, 52, 43], [26, 17, 53, 44]],
    L: [[36, 38, 44, 42], [37, 41, 43, 39], [0, 18, 27, 53], [3, 21, 30, 50], [6, 24, 33, 47]],
    B: [[45, 47, 53, 51], [46, 50, 52, 48], [0, 42, 35, 11], [1, 39, 34, 14], [2, 36, 33, 17]]
  };

  // perm[i] = index the sticker at i is pulled FROM.
  function buildPerm(cycles) {
    var p = new Int32Array(54);
    for (var i = 0; i < 54; i++) p[i] = i;
    for (var c = 0; c < cycles.length; c++) {
      var cyc = cycles[c];
      for (var k = 0; k < cyc.length; k++) {
        p[cyc[(k + 1) % cyc.length]] = cyc[k];
      }
    }
    return p;
  }

  function composePerm(a, b) { // apply a, then b
    var out = new Int32Array(54);
    for (var i = 0; i < 54; i++) out[i] = a[b[i]];
    return out;
  }

  var MOVE_PERMS = {};
  var MOVE_NAMES = [];
  FACE_LETTERS.forEach(function (letter) {
    var p1 = buildPerm(BASE_CYCLES[letter]);
    var p2 = composePerm(p1, p1);
    var p3 = composePerm(p2, p1);
    MOVE_PERMS[letter] = p1;
    MOVE_PERMS[letter + '2'] = p2;
    MOVE_PERMS[letter + "'"] = p3;
    MOVE_NAMES.push(letter, letter + "'", letter + '2');
  });

  var SOLVED = (function () {
    var s = new Uint8Array(54);
    for (var i = 0; i < 54; i++) s[i] = (i / 9) | 0;
    return s;
  })();

  function permute(src, perm, dst) {
    for (var i = 0; i < 54; i++) dst[i] = src[perm[i]];
    return dst;
  }

  function apply(state, move) {
    var perm = MOVE_PERMS[move];
    if (!perm) throw new Error('Unknown move: ' + move);
    return permute(state, perm, new Uint8Array(54));
  }

  function applySeq(state, moves) {
    var s = Uint8Array.from(state);
    var tmp = new Uint8Array(54);
    for (var i = 0; i < moves.length; i++) {
      permute(s, MOVE_PERMS[moves[i]], tmp);
      var swap = s; s = tmp; tmp = swap;
    }
    return s;
  }

  function parse(text) {
    return String(text).trim().split(/[\s,]+/).filter(Boolean).map(function (t) {
      var m = t.replace('’', "'").replace('`', "'");
      if (!MOVE_PERMS[m]) throw new Error('Unknown move: ' + t);
      return m;
    });
  }

  function invertMove(m) {
    if (m.length === 1) return m + "'";
    if (m[1] === '2') return m;
    return m[0];
  }

  function invertSeq(moves) {
    return moves.slice().reverse().map(invertMove);
  }

  function isSolved(state) {
    for (var i = 0; i < 54; i++) if (state[i] !== SOLVED[i]) return false;
    return true;
  }

  function randomScramble(n) {
    n = n || 25;
    var out = [];
    var lastFace = '', beforeLastFace = '';
    while (out.length < n) {
      var face = FACE_LETTERS[(Math.random() * 6) | 0];
      if (face === lastFace) continue;
      if (face === beforeLastFace && OPPOSITE_FACE[face] === lastFace) continue;
      var suffix = ["", "'", '2'][(Math.random() * 3) | 0];
      out.push(face + suffix);
      beforeLastFace = lastFace;
      lastFace = face;
    }
    return out;
  }

  // ---- piece definitions -------------------------------------------------
  // Corner facelets are listed clockwise as seen from outside that corner,
  // starting with the U or D sticker. Edge facelets start with the U/D sticker,
  // or the F/B sticker for the four middle-layer edges.
  var CORNER_FACELETS = [
    [8, 9, 20],   // URF
    [6, 18, 38],  // UFL
    [0, 36, 47],  // ULB
    [2, 45, 11],  // UBR
    [29, 26, 15], // DFR
    [27, 44, 24], // DLF
    [33, 53, 42], // DBL
    [35, 17, 51]  // DRB
  ];
  var CORNER_FACES = [
    [U, R, F], [U, F, L], [U, L, B], [U, B, R],
    [D, F, R], [D, L, F], [D, B, L], [D, R, B]
  ];
  var CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];

  var EDGE_FACELETS = [
    [5, 10],  // UR
    [7, 19],  // UF
    [3, 37],  // UL
    [1, 46],  // UB
    [32, 16], // DR
    [28, 25], // DF
    [30, 43], // DL
    [34, 52], // DB
    [23, 12], // FR
    [21, 41], // FL
    [50, 39], // BL
    [48, 14]  // BR
  ];
  var EDGE_FACES = [
    [U, R], [U, F], [U, L], [U, B],
    [D, R], [D, F], [D, L], [D, B],
    [F, R], [F, L], [B, L], [B, R]
  ];
  var EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

  function edgeIndex(a, b) {
    for (var i = 0; i < 12; i++) {
      var e = EDGE_FACES[i];
      if ((e[0] === a && e[1] === b) || (e[0] === b && e[1] === a)) return i;
    }
    return -1;
  }

  function cornerIndex(a, b, c) {
    for (var i = 0; i < 8; i++) {
      var k = CORNER_FACES[i];
      if (k.indexOf(a) >= 0 && k.indexOf(b) >= 0 && k.indexOf(c) >= 0) return i;
    }
    return -1;
  }

  // ---- validation --------------------------------------------------------

  var HUMAN_SPOT = {
    URF: 'top-front-right', UFL: 'top-front-left', ULB: 'top-back-left', UBR: 'top-back-right',
    DFR: 'bottom-front-right', DLF: 'bottom-front-left', DBL: 'bottom-back-left', DRB: 'bottom-back-right',
    UR: 'top-right', UF: 'top-front', UL: 'top-left', UB: 'top-back',
    DR: 'bottom-right', DF: 'bottom-front', DL: 'bottom-left', DB: 'bottom-back',
    FR: 'front-right', FL: 'front-left', BL: 'back-left', BR: 'back-right'
  };

  function permutationParity(arr) {
    var p = 0;
    for (var i = 0; i < arr.length; i++) {
      for (var j = i + 1; j < arr.length; j++) if (arr[i] > arr[j]) p ^= 1;
    }
    return p;
  }

  /**
   * Validate a state given in solver space (values 0..5 == U R F D L B).
   * Returns { ok:true } or { ok:false, message:'...' }.
   */
  function validate(state) {
    var counts = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 54; i++) {
      var v = state[i];
      if (v < 0 || v > 5) return { ok: false, message: 'Every sticker needs a color before solving.' };
      counts[v]++;
    }
    for (var f = 0; f < 6; f++) {
      if (counts[f] !== 9) {
        return {
          ok: false,
          message: 'Color counts are off: the ' + FACE_LETTERS[f] + '-center color appears ' +
            counts[f] + ' times instead of 9. Recount that color on your cube.'
        };
      }
    }

    // corners
    var cp = [], co = [], seenC = {};
    for (var c = 0; c < 8; c++) {
      var st = CORNER_FACELETS[c].map(function (ix) { return state[ix]; });
      var twist = -1;
      for (var k = 0; k < 3; k++) if (st[k] === U || st[k] === D) twist = k;
      if (twist < 0) {
        return { ok: false, message: 'The ' + HUMAN_SPOT[CORNER_NAMES[c]] + ' corner has no top or bottom color on it — check those three stickers.' };
      }
      var target = -1;
      for (var j = 0; j < 8; j++) {
        var cf = CORNER_FACES[j];
        if (cf.indexOf(st[0]) >= 0 && cf.indexOf(st[1]) >= 0 && cf.indexOf(st[2]) >= 0 &&
            st[0] !== st[1] && st[1] !== st[2] && st[0] !== st[2]) { target = j; break; }
      }
      if (target < 0) {
        return { ok: false, message: 'The ' + HUMAN_SPOT[CORNER_NAMES[c]] + ' corner is not a real corner of a cube — check those three stickers.' };
      }
      if (seenC[target]) {
        return { ok: false, message: 'Two corners have the same three colors (' + HUMAN_SPOT[CORNER_NAMES[c]] + ' duplicates another corner).' };
      }
      seenC[target] = true;
      cp.push(target);
      co.push(twist);
    }
    var twistSum = co.reduce(function (a, b) { return a + b; }, 0);
    if (twistSum % 3 !== 0) {
      return { ok: false, message: 'A corner is twisted in place — that state is impossible unless the cube was taken apart. Re-check the corner stickers (one corner is probably rotated in your input).' };
    }

    // edges
    var ep = [], eo = [], seenE = {};
    for (var e = 0; e < 12; e++) {
      var s0 = state[EDGE_FACELETS[e][0]], s1 = state[EDGE_FACELETS[e][1]];
      var tgt = -1, ori = 0;
      for (var m = 0; m < 12; m++) {
        var ef = EDGE_FACES[m];
        if (ef[0] === s0 && ef[1] === s1) { tgt = m; ori = 0; break; }
        if (ef[0] === s1 && ef[1] === s0) { tgt = m; ori = 1; break; }
      }
      if (tgt < 0) {
        return { ok: false, message: 'The ' + HUMAN_SPOT[EDGE_NAMES[e]] + ' edge has a color pair that does not exist on a cube — check those two stickers.' };
      }
      if (seenE[tgt]) {
        return { ok: false, message: 'Two edges have the same color pair (' + HUMAN_SPOT[EDGE_NAMES[e]] + ' duplicates another edge).' };
      }
      seenE[tgt] = true;
      ep.push(tgt);
      eo.push(ori);
    }
    var flipSum = eo.reduce(function (a, b) { return a + b; }, 0);
    if (flipSum % 2 !== 0) {
      return { ok: false, message: 'One edge is flipped in place — impossible on an intact cube. Re-check your edge stickers (two colors are probably swapped).' };
    }
    if (permutationParity(cp) !== permutationParity(ep)) {
      return { ok: false, message: 'Two pieces look swapped — impossible on an intact cube. Re-check the stickers, especially any two pieces you may have entered in the wrong order.' };
    }
    return { ok: true };
  }

  /**
   * Convert a display-space state (palette color ids) into solver space using
   * the six center stickers to define which color is which face.
   */
  function toSolverSpace(colorState) {
    var map = {};
    for (var f = 0; f < 6; f++) {
      var col = colorState[CENTERS[f]];
      if (col === undefined || col === null || col < 0) return null;
      if (map[col] !== undefined) return null;
      map[col] = f;
    }
    var out = new Uint8Array(54);
    for (var i = 0; i < 54; i++) {
      var v = colorState[i];
      if (v === undefined || v === null || v < 0 || map[v] === undefined) return null;
      out[i] = map[v];
    }
    return out;
  }

  return {
    U: U, R: R, F: F, D: D, L: L, B: B,
    FACE_LETTERS: FACE_LETTERS,
    FACE_INDEX: FACE_INDEX,
    CENTERS: CENTERS,
    OPPOSITE_FACE: OPPOSITE_FACE,
    MOVE_PERMS: MOVE_PERMS,
    MOVE_NAMES: MOVE_NAMES,
    SOLVED: SOLVED,
    permute: permute,
    apply: apply,
    applySeq: applySeq,
    parse: parse,
    invertMove: invertMove,
    invertSeq: invertSeq,
    isSolved: isSolved,
    randomScramble: randomScramble,
    CORNER_FACELETS: CORNER_FACELETS,
    CORNER_FACES: CORNER_FACES,
    CORNER_NAMES: CORNER_NAMES,
    EDGE_FACELETS: EDGE_FACELETS,
    EDGE_FACES: EDGE_FACES,
    EDGE_NAMES: EDGE_NAMES,
    edgeIndex: edgeIndex,
    cornerIndex: cornerIndex,
    validate: validate,
    toSolverSpace: toSolverSpace
  };
});
