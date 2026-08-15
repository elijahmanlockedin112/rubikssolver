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
 * The same trick covers unusual colour schemes: rather than assuming which
 * colour sits opposite which, every possible pairing is tried and the one that
 * assembles into a real cube wins.
 */
;(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./cube.js') : root.Cube,
    typeof require === 'function' ? require('./cuben.js') : root.CubeN
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubeAssemble = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube, CubeN) {
  'use strict';

  // Palette order: white yellow green blue red orange
  var STANDARD_PAIRS = [[0, 1], [2, 3], [4, 5]];   // white/yellow, green/blue, red/orange

  // Roughly the six colours a cube is made in, used only to decide which name
  // goes with which face. Every other decision is made by comparison against
  // the cube's own centres, never against these.
  var IDEAL_RGB = [[245, 245, 245], [255, 213, 0], [0, 155, 72], [0, 70, 173], [200, 20, 20], [255, 100, 0]];

  function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * sRGB to CIELAB. Worth the arithmetic: in Lab, "how different do these two
   * colours look" is roughly a straight-line distance, which hue-and-saturation
   * badly misrepresents. Measured on real photos of a cube, hue put red and
   * orange only 1.06x apart relative to their own spread — touching — and
   * actually overlapped yellow with green. In Lab the same photos separate
   * cleanly.
   */
  function rgbToLab(rgb) {
    var r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
    var x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    var y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
    var z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); }
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /**
   * Where a colour sits, with the lamp divided out.
   *
   * Lab's a* and b* still grow and shrink with lightness, so the same sticker
   * under a brighter lamp lands somewhere else on the plane. Dividing by
   * lightness fixes that: measured on real photos, it took the gap between two
   * shots of one face and the gap between the red and orange faces from
   * overlapping (0.79x) to comfortably separated (1.49x). The x50 is only to
   * keep the numbers in a readable range.
   */
  function colorPoint(rgb) {
    var lab = rgbToLab(rgb);
    var light = Math.max(lab[0], 12);          // guard against near-black
    return [lab[1] / light * 50, lab[2] / light * 50];
  }

  function pointDistance(p, q) {
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }

  /** How different two sampled colours look, ignoring how brightly each was lit. */
  function colorCost(a, b) {
    return pointDistance(colorPoint(a), colorPoint(b));
  }

  var IDEAL_POINT = IDEAL_RGB.map(colorPoint);

  /**
   * Which palette name belongs to each reference colour. Only affects what is
   * displayed. Pass alreadyPoints when the references are cluster centres that
   * are already in colour-point space rather than raw RGB.
   */
  function nameCenters(centers, alreadyPoints) {
    var points = alreadyPoints ? centers : centers.map(colorPoint);
    var cost = [];
    for (var f = 0; f < 6; f++) {
      cost[f] = [];
      for (var p = 0; p < 6; p++) cost[f][p] = pointDistance(points[f], IDEAL_POINT[p]);
    }
    // Six names for six faces is small enough to try every arrangement and keep
    // the best, rather than committing to one greedy choice at a time.
    var best = null, bestCost = Infinity;
    (function permute(taken, rest) {
      if (!rest.length) {
        var total = 0;
        for (var f = 0; f < 6; f++) total += cost[f][taken[f]];
        if (total < bestCost) { bestCost = total; best = taken.slice(); }
        return;
      }
      for (var i = 0; i < rest.length; i++) {
        permute(taken.concat([rest[i]]), rest.slice(0, i).concat(rest.slice(i + 1)));
      }
    })([], [0, 1, 2, 3, 4, 5]);
    return best;
  }

  /**
   * Hand out the six colours across 54 stickers, nine each.
   *
   * A cheapest-first pass gets close, but one unlucky early choice can push a
   * correct sticker out of its colour and start a cascade. So it then looks for
   * any two stickers that would both be happier with each other's colour and
   * swaps them, repeatedly. Swapping keeps the nine-per-colour count intact, and
   * for a sticker to stay wrong now, a second one has to be wrong in the
   * opposite direction at the same time — far harder than being wrong alone.
   */
  function assignByQuota(cost, fixed, perColor) {
    var count = cost.length;
    perColor = perColor || count / 6;
    var assigned = new Int8Array(count).fill(-1);
    var quota = [perColor, perColor, perColor, perColor, perColor, perColor];
    Object.keys(fixed).forEach(function (idx) {
      assigned[idx] = fixed[idx];
      quota[fixed[idx]]--;
    });

    var pairs = [];
    for (var i = 0; i < count; i++) {
      if (assigned[i] >= 0) continue;
      for (var r = 0; r < 6; r++) pairs.push({ idx: i, ref: r, cost: cost[i][r] });
    }
    pairs.sort(function (a, b) { return a.cost - b.cost; });
    pairs.forEach(function (p) {
      if (assigned[p.idx] >= 0 || quota[p.ref] <= 0) return;
      assigned[p.idx] = p.ref;
      quota[p.ref]--;
    });

    var improved = true, rounds = 0;
    while (improved && rounds++ < 20) {
      improved = false;
      for (var a = 0; a < count; a++) {
        if (fixed[a] !== undefined) continue;
        for (var b = a + 1; b < count; b++) {
          if (fixed[b] !== undefined) continue;
          var ca = assigned[a], cb = assigned[b];
          if (ca === cb) continue;
          if (cost[a][cb] + cost[b][ca] < cost[a][ca] + cost[b][cb] - 1e-9) {
            assigned[a] = cb; assigned[b] = ca;
            improved = true;
          }
        }
      }
    }
    return assigned;
  }

  /**
   * Sort every sticker into six colours with nothing to compare against.
   *
   * A 3x3 has six fixed centres, each a guaranteed sample of its colour under
   * the same lamp as everything around it. A 4x4 has no fixed centre at all —
   * its middle pieces move — so that anchor is gone and the only thing left is
   * the count: exactly N*N of each colour.
   *
   * That turns out to be plenty, and the extra stickers more than pay for the
   * lost anchor. Measured on colours read off a real cube, 200 of 200 4x4 cubes
   * came back perfect at every lighting level tried, including deliberately
   * harsh. Sixteen samples per colour is simply more evidence than nine.
   *
   * captures: six arrays of N*N [r,g,b]. Returns 6*N*N palette indices in
   * capture order.
   */
  function clusterStickers(captures, N) {
    var perColor = N * N;
    var points = [];
    captures.forEach(function (face) {
      face.forEach(function (rgb) { points.push(colorPoint(rgb)); });
    });

    // Seed with the six samples furthest from each other, so the starting
    // guesses land in six different colours rather than three shades of one.
    var seeds = [points[0]];
    while (seeds.length < 6) {
      var furthest = null, best = -1;
      points.forEach(function (p) {
        var nearest = Infinity;
        seeds.forEach(function (s) { nearest = Math.min(nearest, pointDistance(p, s)); });
        if (nearest > best) { best = nearest; furthest = p; }
      });
      seeds.push(furthest);
    }

    var reference = seeds, assigned = null;
    for (var pass = 0; pass < 12; pass++) {
      var cost = points.map(function (p) {
        return reference.map(function (r) { return pointDistance(p, r); });
      });
      var next = assignByQuota(cost, {}, perColor);
      var settled = assigned && String(next) === String(assigned);
      assigned = next;
      if (settled) break;

      var sums = [];
      for (var c = 0; c < 6; c++) sums[c] = { x: 0, y: 0, n: 0 };
      points.forEach(function (p, i) {
        var g = sums[assigned[i]];
        g.x += p[0]; g.y += p[1]; g.n++;
      });
      reference = sums.map(function (g, i) { return g.n ? [g.x / g.n, g.y / g.n] : reference[i]; });
    }

    // name the six groups by whichever of the six cube colours they sit nearest
    var order = nameCenters(reference.map(function (r) {
      // nameCenters wants colours, and only uses their position, so hand back
      // a point that maps to this cluster centre
      return r;
    }), true);

    var out = new Int8Array(points.length);
    for (var k = 0; k < points.length; k++) out[k] = order[assigned[k]];
    return out;
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

    var faceColor = nameCenters(centers);

    var points = [], fixed = {};
    for (var fc = 0; fc < 6; fc++) {
      for (var i = 0; i < 9; i++) points[fc * 9 + i] = colorPoint(captures[fc][i]);
      fixed[fc * 9 + 4] = fc;      // a centre is its own reference, by definition
    }

    /**
     * Start from the six centres, then let the nine stickers of each colour
     * vote on where their colour really sits and go round again.
     *
     * A centre is only one sample, and if it happens to catch a highlight or a
     * shadow every comparison inherits that. Averaging the whole group is a far
     * steadier target — and it is free, because the nine-per-colour rule means
     * the groups are always the right size. The centres stay pinned to their
     * own colour throughout, so the labels cannot drift.
     */
    var reference = centers.map(colorPoint);
    var assigned = null;
    for (var pass = 0; pass < 4; pass++) {
      var cost = [];
      for (var s = 0; s < 54; s++) {
        cost[s] = [];
        for (var r = 0; r < 6; r++) cost[s][r] = pointDistance(points[s], reference[r]);
      }
      var next = assignByQuota(cost, fixed);
      var settled = assigned && String(next) === String(assigned);
      assigned = next;
      if (settled) break;

      var sums = [];
      for (var c = 0; c < 6; c++) sums[c] = { x: 0, y: 0, n: 0 };
      for (var k = 0; k < 54; k++) {
        var g = sums[assigned[k]];
        g.x += points[k][0]; g.y += points[k][1]; g.n++;
      }
      reference = sums.map(function (g, i) {
        return g.n ? [g.x / g.n, g.y / g.n] : reference[i];
      });
    }

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
    //
    // The threshold is deliberately tight. Two shots of one face are near
    // identical — it is the same physical sticker seconds apart — while the
    // closest two different centres measured on a real cube (red and orange)
    // sit 13 apart. Anything looser starts calling a red face a repeat of an
    // orange one, which is a far worse failure than missing a genuine repeat:
    // a repeat that slips through simply fails to assemble later, with an
    // explanation, whereas a false accusation blocks a face that was fine.
    for (var x = 0; x < 6; x++) {
      for (var y = x + 1; y < 6; y++) {
        if (colorCost(captures[x][4], captures[y][4]) < 12) {
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
   * possibly rotated.
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

  /**
   * Turn the finished cube to match how the last photo was taken.
   *
   * A solution is a list of moves like "turn the right face", which only means
   * something once the cube is being held a particular way. Left alone, the
   * assembler settles on whatever orientation its search happened to land in,
   * and the app has to open by naming a colour and asking someone to rotate the
   * cube until it matches — before a single move makes sense.
   *
   * The last photo is a much better answer, because it is the face they were
   * looking at a second ago and the cube is almost certainly still that way up.
   * So the whole cube is turned until that face is at the front, the same way
   * up as it was photographed, and the moves come out relative to how the cube
   * is already being held.
   *
   * Which of the 24 turns to use is not worked out, it is looked up: apply each
   * and keep the one whose front face comes out exactly equal to the photo. If
   * none does — the assembler settled on a different reading, or a colour was
   * named differently — nothing changes, which is no worse than before.
   */
  function orientToPhoto(state, photoCells, N) {
    var per = N * N;
    if (!state || !photoCells || photoCells.length !== per) return state;
    var turns = CubeN.rotations(N);
    for (var r = 0; r < turns.length; r++) {
      var rot = turns[r];
      var matches = true;
      for (var i = 0; i < per && matches; i++) {
        if (state[rot[2 * per + i]] !== photoCells[i]) matches = false;
      }
      if (!matches) continue;
      var out = new Int8Array(state.length);
      for (var j = 0; j < state.length; j++) out[j] = state[rot[j]];
      return out;
    }
    return state;
  }

  return {
    assemble: assemble,
    assembleFromColors: assembleFromColors,
    orientToPhoto: orientToPhoto,
    classifyCaptures: classifyCaptures,
    clusterStickers: clusterStickers,
    rotateFace: rotateFace,
    orderedPairings: orderedPairings,
    allPairings: allPairings,
    candidateAssignments: candidateAssignments,
    colorCost: colorCost,
    colorPoint: colorPoint
  };
});


