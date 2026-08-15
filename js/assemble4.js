/*
 * assemble4.js — fit six photos of a big cube into one cube.
 *
 * On a 3x3 this is easy: the centre sticker never moves, so it names the face,
 * and the rotations fall out of trying all four per face and keeping whatever
 * makes a physically possible cube.
 *
 * A 4x4 has no fixed centre. A photo of a face says nothing about which face it
 * is — a scrambled face is just sixteen colours. So both halves of the problem
 * are open at once: which photo goes where, and which way up.
 *
 * What is left to go on is the cube's own structure. Whatever the arrangement,
 * the eight corners have to be the eight real corners of some colour scheme,
 * each appearing once, and the twenty-four edge wings have to make up the
 * twelve real edges, each appearing exactly twice. That is a demanding thing
 * for a wrong arrangement to satisfy by accident.
 *
 * The search is smaller than it first looks. Any arrangement can be turned so
 * that the first photo is on top the right way up, and that pins down all 24
 * ways of holding the cube — leaving 5! orders and 4^5 rotations, about 123,000
 * candidates, which is nothing.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cuben.js') : root.CubeN);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeAssemble4 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN) {
  'use strict';

  /** k quarter turns clockwise of one face's stickers. */
  function rotateFace(cells, N, k) {
    var out = cells.slice();
    for (var t = 0; t < ((k % 4) + 4) % 4; t++) {
      var prev = out.slice();
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) out[r * N + c] = prev[(N - 1 - c) * N + r];
      }
    }
    return out;
  }

  function permutations(list) {
    if (list.length <= 1) return [list];
    var out = [];
    list.forEach(function (item, i) {
      permutations(list.slice(0, i).concat(list.slice(i + 1))).forEach(function (rest) {
        out.push([item].concat(rest));
      });
    });
    return out;
  }

  /**
   * Could this arrangement be a real cube?
   * Returns the opposite-colour pairing it implies, or null.
   */
  function structureOf(state, layout) {
    var colorsOf = function (group) {
      return group.map(function (facelet) { return state[facelet]; });
    };

    // --- corners: eight distinct triples of three different colours ---
    var seenCorner = {};
    var together = [];
    for (var a = 0; a < 6; a++) { together[a] = []; for (var b = 0; b < 6; b++) together[a][b] = false; }

    for (var i = 0; i < layout.corners.length; i++) {
      var tri = colorsOf(layout.corners[i]);
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) return null;
      var key = tri.slice().sort().join('');
      if (seenCorner[key]) return null;                  // the same corner twice
      seenCorner[key] = true;
      together[tri[0]][tri[1]] = together[tri[1]][tri[0]] = true;
      together[tri[1]][tri[2]] = together[tri[2]][tri[1]] = true;
      together[tri[0]][tri[2]] = together[tri[2]][tri[0]] = true;
    }

    // Two colours are opposite exactly when no corner ever shows both.
    var opposite = [];
    for (var c = 0; c < 6; c++) {
      var missing = [];
      for (var d = 0; d < 6; d++) if (c !== d && !together[c][d]) missing.push(d);
      if (missing.length !== 1) return null;             // must be exactly one
      opposite[c] = missing[0];
    }
    for (var e = 0; e < 6; e++) if (opposite[opposite[e]] !== e) return null;

    // --- edges: each adjacent colour pair, exactly twice ---
    var pairCount = {};
    for (var k = 0; k < layout.edges.length; k++) {
      var pair = colorsOf(layout.edges[k]);
      if (pair[0] === pair[1]) return null;              // a wing cannot be one colour
      if (opposite[pair[0]] === pair[1]) return null;    // nor two opposite colours
      var pk = pair.slice().sort().join('');
      pairCount[pk] = (pairCount[pk] || 0) + 1;
    }
    var pairKeys = Object.keys(pairCount);
    if (pairKeys.length !== 12) return null;
    for (var p = 0; p < pairKeys.length; p++) {
      if (pairCount[pairKeys[p]] !== layout.edges.length / 12) return null;
    }

    // --- centres: the same number of each colour ---
    var centreCount = [0, 0, 0, 0, 0, 0];
    for (var m = 0; m < layout.centres.length; m++) centreCount[state[layout.centres[m][0]]]++;
    var per = layout.centres.length / 6;
    for (var n = 0; n < 6; n++) if (centreCount[n] !== per) return null;

    return { opposite: opposite };
  }

  /**
   * captures: six arrays of N*N palette indices, any order, any rotation.
   * Returns { ok, colors, alternatives } or { ok:false, message }.
   */
  function assemble(captures, N) {
    if (!captures || captures.length !== 6) {
      return { ok: false, message: 'Six faces are needed; got ' + (captures ? captures.length : 0) + '.' };
    }
    var per = N * N;
    var layout = CubeN.pieces(N);

    // every colour must appear exactly N*N times, or nothing will ever fit
    var tally = [0, 0, 0, 0, 0, 0];
    captures.forEach(function (face) { face.forEach(function (c) { tally[c]++; }); });
    for (var c = 0; c < 6; c++) {
      if (tally[c] !== per) {
        return {
          ok: false,
          message: 'The colours do not add up: one appears ' + tally[c] + ' times instead of ' + per +
            '. Retake the faces, or fix them on the map.'
        };
      }
    }

    // Every rotation of every face, worked out once rather than in the loop.
    var spun = captures.map(function (face) {
      return [0, 1, 2, 3].map(function (turns) { return rotateFace(face, N, turns); });
    });

    // Photo 0 goes on top the right way up. That is not a guess — it just picks
    // one of the 24 ways to hold the cube, and they all describe the same cube.
    var others = permutations([1, 2, 3, 4, 5]);
    var state = new Int8Array(6 * per);
    var solutions = [];
    var checked = 0;

    for (var o = 0; o < others.length; o++) {
      var order = [0].concat(others[o]);          // panel index -> photo index
      for (var combo = 0; combo < 1024; combo++) {
        for (var panel = 0; panel < 6; panel++) {
          var turns = panel === 0 ? 0 : (combo >> ((panel - 1) * 2)) & 3;
          var cells = spun[order[panel]][turns];
          for (var i = 0; i < per; i++) state[panel * per + i] = cells[i];
        }
        checked++;
        var structure = structureOf(state, layout);
        if (structure) {
          solutions.push({ colors: Int8Array.from(state), order: order.slice(), combo: combo });
          if (solutions.length > 4) break;        // enough to know it is ambiguous
        }
      }
      if (solutions.length > 4) break;
    }

    if (!solutions.length) {
      return {
        ok: false, checked: checked,
        message: 'Those six photos do not fit together into a real cube. Usually one sticker was ' +
          'read as the wrong colour — check the map and fix anything that looks off.'
      };
    }

    return {
      ok: true,
      colors: solutions[0].colors,
      checked: checked,
      ambiguous: solutions.length > 1,
      alternatives: solutions.length
    };
  }

  return {
    assemble: assemble,
    rotateFace: rotateFace,
    structureOf: structureOf
  };
});
