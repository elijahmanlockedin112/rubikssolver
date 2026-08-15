/*
 * assemble.js — turn six loose photos of faces into one cube.
 *
 * The user should not have to hold the cube a particular way, or photograph the
 * faces in a particular order. They don't have to, because the cube itself
 * carries enough information to work it out:
 *
 *   - Which face is which? The centre sticker never moves, so the centre colour
 *     names the face. Photograph them in any order.
 *   - Which way up was each photo? Try all four rotations of all six faces and
 *     keep the combination that assembles into a physically possible cube.
 *     4^6 is only 4096 combinations, and validity is an extremely tight filter
 *     — every one of the twelve edges and eight corners has to be a real piece,
 *     appearing exactly once, with the corner twists and edge flips adding up.
 *     In practice exactly one combination survives.
 *
 * The same trick covers unusual colour schemes: which colour sits opposite
 * which is derived from the photos (a face never shows its own opposite
 * colour), so a cube with a non-standard layout still assembles.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cube.js') : root.Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeAssemble = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  // Palette order: white yellow green blue red orange
  var IDEAL_HUE = [null, 52, 130, 215, 358, 28];
  var STANDARD_PAIRS = [[0, 1], [2, 3], [4, 5]];   // white/yellow, green/blue, red/orange

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /**
   * Distance between two samples, tuned against synthetic bad lighting.
   * Brightness is ignored on purpose: each face is photographed under its own
   * light, so only hue and saturation survive the trip between faces.
   */
  function colorCost(a, b) {
    var ha = rgbToHsv(a[0], a[1], a[2]), hb = rgbToHsv(b[0], b[1], b[2]);
    var greyness = Math.min(ha.s, hb.s);
    return hueDistance(ha.h, hb.h) * Math.min(1, greyness / 0.3) + Math.abs(ha.s - hb.s) * 55;
  }

  /**
   * captures: six arrays of nine [r,g,b], in whatever order they were taken.
   * Returns 54 palette indices laid out by capture (capture*9 + cell), using
   * the six centre stickers as the reference swatches and a nine-per-colour
   * quota so one bad reading cannot take over a colour.
   */
  function classifyCaptures(captures) {
    var centers = [];
    for (var f = 0; f < 6; f++) centers[f] = captures[f][4];

    // name the six centres, forcing six different names
    var pairs = [];
    for (var face = 0; face < 6; face++) {
      var hsv = rgbToHsv(centers[face][0], centers[face][1], centers[face][2]);
      for (var p = 0; p < 6; p++) {
        var cost = p === 0
          ? hsv.s * 200                                        // white: the flatter the better
          : hueDistance(hsv.h, IDEAL_HUE[p]) + (1 - hsv.s) * 120;
        pairs.push({ face: face, palette: p, cost: cost });
      }
    }
    pairs.sort(function (a, b) { return a.cost - b.cost; });
    var faceColor = {}, usedPalette = {};
    pairs.forEach(function (pair) {
      if (faceColor[pair.face] !== undefined || usedPalette[pair.palette]) return;
      faceColor[pair.face] = pair.palette;
      usedPalette[pair.palette] = true;
    });

    // every sticker against every centre, cheapest first, nine per colour
    var all = [];
    for (var fc = 0; fc < 6; fc++) {
      for (var i = 0; i < 9; i++) {
        for (var ref = 0; ref < 6; ref++) {
          all.push({ idx: fc * 9 + i, ref: ref, cost: colorCost(captures[fc][i], centers[ref]) });
        }
      }
    }
    all.sort(function (a, b) { return a.cost - b.cost; });

    var assigned = new Int8Array(54).fill(-1);
    var quota = [9, 9, 9, 9, 9, 9];
    for (var cf = 0; cf < 6; cf++) { assigned[cf * 9 + 4] = cf; quota[cf]--; }
    all.forEach(function (item) {
      if (assigned[item.idx] >= 0 || quota[item.ref] <= 0) return;
      assigned[item.idx] = item.ref;
      quota[item.ref]--;
    });

    var out = new Int8Array(54);
    for (var k = 0; k < 54; k++) out[k] = faceColor[assigned[k]];
    return out;
  }

  /** k quarter turns clockwise of one nine-sticker face. */
  function rotateFace(cells, k) {
    var out = cells.slice();
    for (var t = 0; t < (k % 4 + 4) % 4; t++) {
      var prev = out.slice();
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) out[r * 3 + c] = prev[(2 - c) * 3 + r];
      }
    }
    return out;
  }

  /** The fifteen ways to split six colours into three pairs. */
  function allPairings() {
    var out = [];
    var colors = [0, 1, 2, 3, 4, 5];
    for (var a = 1; a < 6; a++) {
      var restA = colors.filter(function (c) { return c !== 0 && c !== a; });
      for (var b = 1; b < 4; b++) {
        var second = [restA[0], restA[b]];
        var third = restA.filter(function (c) { return second.indexOf(c) < 0; });
        out.push([[0, a], second, third]);
      }
    }
    return out;
  }

  function signature(pairing) {
    return pairing.map(function (p) { return p.slice().sort().join('-'); }).sort().join(' ');
  }

  /**
   * Every pairing of the six colours into opposite faces, the ordinary
   * white/yellow, green/blue, red/orange scheme first.
   *
   * Note there is no shortcut here based on which colours appear on which face.
   * It is tempting to say "a face never shows its own opposite colour" — true
   * of a solved cube, false of a scrambled one, where a yellow piece can sit in
   * a slot on the white face and show yellow upwards. Guessing that way throws
   * the right answer out. The pairing is settled by which one assembles into a
   * real cube, not by counting colours.
   */
  function orderedPairings() {
    var standard = signature(STANDARD_PAIRS);
    return allPairings().sort(function (x, y) {
      return (signature(x) === standard ? 0 : 1) - (signature(y) === standard ? 0 : 1);
    });
  }

  /**
   * Two colour-to-panel layouts per pairing, and that is genuinely all that is
   * needed. There are 48 ways to lay three pairs onto three axes, but the 24
   * rotations of a cube shuffle them into just two families — the cube and its
   * mirror image. Every other layout is one of these two seen from a different
   * angle, and since the photo rotations are searched anyway, a rotated layout
   * would only rediscover the same cube.
   *
   * The pairs are ordered first so that an ordinary cube comes out the familiar
   * way up: white on top, green at the front, red on the right.
   */
  function candidateAssignments(pairing) {
    var pairs = pairing.map(function (p) { return p.slice(); });
    function preferFirst(pair, color) {
      if (pair[1] === color) { var t = pair[0]; pair[0] = pair[1]; pair[1] = t; }
      return pair;
    }
    // axis order: the white pair up, the green pair front, whatever is left right
    pairs.sort(function (a, b) {
      function rank(p) { return p.indexOf(0) >= 0 ? 0 : p.indexOf(2) >= 0 ? 1 : 2; }
      return rank(a) - rank(b);
    });
    preferFirst(pairs[0], 0);
    preferFirst(pairs[1], 2);
    preferFirst(pairs[2], 4);

    return [0, 1].map(function (mirror) {
      var map = {};
      map[pairs[0][0]] = 0; map[pairs[0][1]] = 3;                    // U / D
      map[pairs[1][0]] = 2; map[pairs[1][1]] = 5;                    // F / B
      map[pairs[2][mirror]] = 1; map[pairs[2][1 - mirror]] = 4;      // R / L
      return { map: map, mirror: mirror };
    });
  }

  /**
   * captures: six arrays of nine [r,g,b], any order, any rotation.
   * Returns { ok:true, colors } with the 54 stickers in net order, or
   * { ok:false, message } explaining what could not be worked out.
   */
  function assemble(captures) {
    if (!captures || captures.length !== 6) {
      return { ok: false, message: 'Six faces are needed; got ' + (captures ? captures.length : 0) + '.' };
    }

    // Look for a repeated face before naming any colours: the namer forces six
    // different names, so by the time it has run, two photos of the same face
    // look like two different colours.
    for (var x = 0; x < 6; x++) {
      for (var y = x + 1; y < 6; y++) {
        if (colorCost(captures[x][4], captures[y][4]) < 18) {
          return {
            ok: false,
            message: 'Photos ' + (x + 1) + ' and ' + (y + 1) + ' have the same colour in the middle, ' +
              'so one face got photographed twice and another got missed. Retake them.'
          };
        }
      }
    }

    return assembleFromColors(classifyCaptures(captures));
  }

  /**
   * The half of the job that works on named colours rather than raw pixels:
   * six faces of nine palette indices, in whatever order they were taken, each
   * possibly rotated. Shared by the on-device reader and the Gemini fallback.
   */
  function assembleFromColors(byCapture) {
    var centers = [];
    for (var f = 0; f < 6; f++) centers.push(byCapture[f * 9 + 4]);

    var seenCenter = {};
    for (var s = 0; s < 6; s++) {
      if (seenCenter[centers[s]]) {
        return {
          ok: false, colors: byCapture,
          message: 'Two photos were read as having the same colour in the middle, so one face ' +
            'is missing. Retake them and make sure all six faces get photographed.'
        };
      }
      seenCenter[centers[s]] = true;
    }

    var faces = [];
    for (var c = 0; c < 6; c++) faces.push(Array.prototype.slice.call(byCapture.subarray(c * 9, c * 9 + 9)));

    var assignments = [];
    orderedPairings().forEach(function (pairing) {
      assignments = assignments.concat(candidateAssignments(pairing));
    });
    var checked = 0;

    for (var a = 0; a < assignments.length; a++) {
      var map = assignments[a].map;
      // which capture belongs on which panel
      var panelOf = [];
      var ok = true;
      for (var k = 0; k < 6; k++) {
        var panel = map[centers[k]];
        if (panel === undefined) { ok = false; break; }
        panelOf[panel] = k;
      }
      if (!ok || panelOf.filter(function (v) { return v !== undefined; }).length !== 6) continue;

      // pre-rotate every face every way once, rather than inside the loop
      var spun = [];
      for (var p = 0; p < 6; p++) {
        spun[p] = [0, 1, 2, 3].map(function (turns) { return rotateFace(faces[panelOf[p]], turns); });
      }

      var state = new Int8Array(54);
      var solutions = [];
      for (var combo = 0; combo < 4096; combo++) {
        var cost = 0;
        for (var panelIdx = 0; panelIdx < 6; panelIdx++) {
          var turns = (combo >> (panelIdx * 2)) & 3;
          if (turns) cost += turns === 2 ? 3 : 2;   // 180 is rarer than a quarter turn
          var cells = spun[panelIdx][turns];
          for (var n = 0; n < 9; n++) state[panelIdx * 9 + n] = cells[n];
        }
        checked++;
        var solverState = Cube.toSolverSpace(state);
        if (!solverState) continue;
        if (Cube.validate(solverState).ok) solutions.push({ colors: Int8Array.from(state), cost: cost });
      }

      if (solutions.length) {
        // Occasionally the photos fit together in more than one way that is a
        // real cube. Nothing in the images can break that tie, so prefer the
        // reading that assumes the cube was held the same way up throughout —
        // that is what people actually do — and tell the caller it was close.
        solutions.sort(function (p, q) { return p.cost - q.cost; });
        return {
          ok: true,
          colors: solutions[0].colors,
          checked: checked,
          assignment: a,
          ambiguous: solutions.length > 1,
          alternatives: solutions.length
        };
      }
    }

    return {
      ok: false,
      colors: byCapture,
      checked: checked,
      message: 'Those six photos do not fit together into a real cube. Usually that means a ' +
        'sticker was read as the wrong colour — check the map and fix any that look wrong.'
    };
  }

  return {
    assemble: assemble,
    assembleFromColors: assembleFromColors,
    classifyCaptures: classifyCaptures,
    rotateFace: rotateFace,
    orderedPairings: orderedPairings,
    allPairings: allPairings,
    candidateAssignments: candidateAssignments,
    colorCost: colorCost
  };
});
