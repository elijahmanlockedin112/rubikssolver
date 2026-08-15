/*
 * repair.js — fix an obviously-wrong cube, and refuse to guess at anything else.
 *
 * Typing 54 stickers in by hand, one is going to be wrong. The good news is
 * that "is this a real cube?" is a brutally tight test — every edge and corner
 * has to be a genuine piece, appearing exactly once, with the twists and flips
 * adding up — so a single mistake usually has exactly one correction that
 * satisfies it. When that is the case the fix is safe to apply.
 *
 * Two shapes of mistake are worth trying:
 *
 *   - One colour appears ten times and another eight. Somewhere a sticker got
 *     the wrong colour, so try recolouring each of the ten.
 *   - The counts are all nine but the cube still is not real. Then two stickers
 *     are the wrong way round, so try every swap.
 *
 * Anything messier is left alone. The whole point is that a fix is only applied
 * when there is exactly one way to be right; where several corrections work, or
 * none does, it says so and lets the user decide. Silently "fixing" a cube into
 * the wrong one would hand back a solution for a cube nobody owns.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cube.js') : root.Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeRepair = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  var COLOR_NAMES = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];

  var FACE_LABEL = ['top', 'right', 'front', 'bottom', 'left', 'back'];
  var CELL_LABEL = [
    'top-left', 'top-middle', 'top-right',
    'middle-left', 'centre', 'middle-right',
    'bottom-left', 'bottom-middle', 'bottom-right'
  ];

  /** "the top-left sticker of the front face" */
  function describe(index) {
    return 'the ' + CELL_LABEL[index % 9] + ' sticker of the ' + FACE_LABEL[(index / 9) | 0] + ' face';
  }

  function isRealCube(colors) {
    var solverState = Cube.toSolverSpace(colors);
    if (!solverState) return false;
    return Cube.validate(solverState).ok;
  }

  function counts(colors) {
    var out = [0, 0, 0, 0, 0, 0];
    for (var i = 0; i < 54; i++) if (colors[i] >= 0 && colors[i] < 6) out[colors[i]]++;
    return out;
  }

  /**
   * colors: 54 palette indices.
   * Returns null when nothing needs doing or nothing simple helps, otherwise
   * { unique, fixes, colors, summary }. `unique` false means several different
   * single corrections would each produce a real cube — those are offered as
   * candidates rather than applied.
   */
  function repair(colors) {
    for (var i = 0; i < 54; i++) {
      if (!(colors[i] >= 0 && colors[i] < 6)) return null;      // still unfinished
    }
    if (isRealCube(colors)) return null;                        // nothing wrong

    var tally = counts(colors);
    var over = [], under = [];
    for (var c = 0; c < 6; c++) {
      if (tally[c] > 9) over.push({ color: c, by: tally[c] - 9 });
      if (tally[c] < 9) under.push({ color: c, by: 9 - tally[c] });
    }

    var working = Int8Array.from(colors);
    var candidates = [];

    if (!over.length && !under.length) {
      // Right number of each colour, wrong cube: two of them are transposed.
      for (var a = 0; a < 54; a++) {
        for (var b = a + 1; b < 54; b++) {
          if (working[a] === working[b]) continue;
          var wa = working[a], wb = working[b];
          working[a] = wb; working[b] = wa;
          if (isRealCube(working)) {
            candidates.push({
              colors: Int8Array.from(working),
              changes: [{ index: a, from: wa, to: wb }, { index: b, from: wb, to: wa }],
              summary: 'swapped ' + describe(a) + ' and ' + describe(b)
            });
          }
          working[a] = wa; working[b] = wb;
        }
      }
    } else if (over.length === 1 && under.length === 1 && over[0].by === 1 && under[0].by === 1) {
      // One colour used once too often, another once too few.
      var from = over[0].color, to = under[0].color;
      for (var k = 0; k < 54; k++) {
        if (working[k] !== from) continue;
        working[k] = to;
        if (isRealCube(working)) {
          candidates.push({
            colors: Int8Array.from(working),
            changes: [{ index: k, from: from, to: to }],
            summary: describe(k) + ' is ' + COLOR_NAMES[to] + ', not ' + COLOR_NAMES[from]
          });
        }
        working[k] = from;
      }
    } else {
      return null;      // more than one thing is wrong; not for a machine to guess
    }

    if (!candidates.length) return null;
    return {
      unique: candidates.length === 1,
      fixes: candidates,
      colors: candidates[0].colors,
      summary: candidates[0].summary,
      changed: candidates.map(function (c) { return c.changes.map(function (x) { return x.index; }); })
    };
  }

  return {
    repair: repair,
    describe: describe,
    isRealCube: isRealCube,
    counts: counts,
    COLOR_NAMES: COLOR_NAMES
  };
});
