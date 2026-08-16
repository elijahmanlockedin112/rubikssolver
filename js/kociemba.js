/*
 * kociemba.js — two-phase solver (Kociemba's algorithm).
 *
 * Phase 1 takes the cube into the subgroup G1 = <U, D, R2, L2, F2, B2>, where
 * every corner and edge is correctly oriented and the four middle-slice edges
 * are back in the middle slice. Phase 2 finishes inside that subgroup. Both
 * phases are IDA* searches over coordinate move tables with pruning tables.
 *
 * Typical output is 19-22 moves — far shorter than the layer-by-layer method,
 * though the moves no longer correspond to anything a human would "understand".
 *
 * The tables cost about 4 MB and a couple of seconds to build, so building is
 * chunked through `prepare()` and only happens once per page load.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cube.js') : root.Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Kociemba = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  var U = Cube.U, D = Cube.D;

  // ---- move naming -------------------------------------------------------
  var MOVE_NAMES = [];
  for (var f = 0; f < 6; f++) {
    var letter = Cube.FACE_LETTERS[f];
    MOVE_NAMES.push(letter, letter + '2', letter + "'");
  }
  function faceOf(m) { return (m / 3) | 0; }
  // U/D, R/L, F/B sit 3 apart in Cube.FACE_LETTERS
  function oppositeFace(f) { return (f + 3) % 6; }
  var PHASE2_MOVES = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16]; // U U2 U' R2 F2 D D2 D' L2 B2

  // ---- cubie level -------------------------------------------------------

  function identityCubie() {
    return {
      cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0],
      ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    };
  }

  function cloneCubie(c) {
    return { cp: c.cp.slice(), co: c.co.slice(), ep: c.ep.slice(), eo: c.eo.slice() };
  }

  /** Apply cubie move `b` to cubie state `a` (a first, then b). */
  function multiply(a, b) {
    var cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
    for (var i = 0; i < 8; i++) {
      cp[i] = a.cp[b.cp[i]];
      co[i] = (a.co[b.cp[i]] + b.co[i]) % 3;
    }
    for (var j = 0; j < 12; j++) {
      ep[j] = a.ep[b.ep[j]];
      eo[j] = (a.eo[b.ep[j]] + b.eo[j]) % 2;
    }
    return { cp: cp, co: co, ep: ep, eo: eo };
  }

  /** Facelet state (solver space) -> cubie state. */
  function toCubie(state) {
    var cc = identityCubie();
    for (var i = 0; i < 8; i++) {
      var fl = Cube.CORNER_FACELETS[i];
      var ori = 0;
      for (var k = 0; k < 3; k++) if (state[fl[k]] === U || state[fl[k]] === D) ori = k;
      var c0 = state[fl[ori]], c1 = state[fl[(ori + 1) % 3]], c2 = state[fl[(ori + 2) % 3]];
      for (var j = 0; j < 8; j++) {
        var cf = Cube.CORNER_FACES[j];
        if (cf[0] === c0 && cf[1] === c1 && cf[2] === c2) { cc.cp[i] = j; cc.co[i] = ori; break; }
      }
    }
    for (var e = 0; e < 12; e++) {
      var ef = Cube.EDGE_FACELETS[e];
      var s0 = state[ef[0]], s1 = state[ef[1]];
      for (var m = 0; m < 12; m++) {
        var mf = Cube.EDGE_FACES[m];
        if (mf[0] === s0 && mf[1] === s1) { cc.ep[e] = m; cc.eo[e] = 0; break; }
        if (mf[0] === s1 && mf[1] === s0) { cc.ep[e] = m; cc.eo[e] = 1; break; }
      }
    }
    return cc;
  }

  // Cubie form of each of the 18 moves, derived from the facelet engine so the
  // two representations can never drift apart.
  var MOVE_CUBIE = MOVE_NAMES.map(function (name) {
    return toCubie(Cube.apply(Cube.SOLVED, name));
  });

  // ---- coordinates -------------------------------------------------------

  var Cnk = [];
  (function () {
    for (var n = 0; n <= 12; n++) {
      Cnk[n] = [];
      for (var k = 0; k <= 12; k++) {
        Cnk[n][k] = k === 0 ? 1 : (n === 0 ? 0 : Cnk[n - 1][k - 1] + Cnk[n - 1][k]);
      }
    }
  })();

  var FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

  function permToIndex(perm) {
    var n = perm.length, idx = 0;
    for (var i = 0; i < n; i++) {
      var c = 0;
      for (var j = i + 1; j < n; j++) if (perm[j] < perm[i]) c++;
      idx = idx * (n - i) + c;
    }
    return idx;
  }

  function indexToPerm(idx, n) {
    var avail = [], perm = [];
    for (var i = 0; i < n; i++) avail.push(i);
    for (var k = 0; k < n; k++) {
      var f = FACT[n - 1 - k];
      var pick = Math.floor(idx / f);
      idx -= pick * f;
      perm.push(avail.splice(pick, 1)[0]);
    }
    return perm;
  }

  var N_TWIST = 2187, N_FLIP = 2048, N_SLICE = 495;
  var N_CPERM = 40320, N_EPERM8 = 40320, N_SLICE2 = 24;

  function getTwist(cc) {
    var t = 0;
    for (var i = 0; i < 7; i++) t = t * 3 + cc.co[i];
    return t;
  }
  function setTwist(cc, t) {
    var sum = 0;
    for (var i = 6; i >= 0; i--) { var v = t % 3; t = (t / 3) | 0; cc.co[i] = v; sum += v; }
    cc.co[7] = (3 - sum % 3) % 3;
  }

  function getFlip(cc) {
    var t = 0;
    for (var i = 0; i < 11; i++) t = t * 2 + cc.eo[i];
    return t;
  }
  function setFlip(cc, t) {
    var sum = 0;
    for (var i = 10; i >= 0; i--) { var v = t % 2; t = (t / 2) | 0; cc.eo[i] = v; sum += v; }
    cc.eo[11] = sum % 2;
  }

  // Which positions hold the four middle-slice edges (pieces 8..11), ranked so
  // that "all four home" is 0.
  function getSlice(cc) {
    var pos = [];
    for (var i = 0; i < 12; i++) if (cc.ep[i] >= 8) pos.push(i);
    var rank = 0;
    for (var k = 0; k < 4; k++) rank += Cnk[pos[k]][k + 1];
    return 494 - rank;
  }
  function setSlice(cc, idx) {
    var rank = 494 - idx;
    var pos = [];
    for (var k = 3; k >= 0; k--) {
      var p = k;
      while (Cnk[p + 1][k + 1] <= rank) p++;
      pos[k] = p;
      rank -= Cnk[p][k + 1];
    }
    var others = [0, 1, 2, 3, 4, 5, 6, 7];
    var slice = [8, 9, 10, 11];
    for (var i = 0; i < 12; i++) cc.ep[i] = -1;
    for (var s = 0; s < 4; s++) cc.ep[pos[s]] = slice[s];
    var o = 0;
    for (var j = 0; j < 12; j++) if (cc.ep[j] < 0) cc.ep[j] = others[o++];
  }

  function getCornPerm(cc) { return permToIndex(cc.cp); }
  function setCornPerm(cc, idx) { cc.cp = indexToPerm(idx, 8); }

  function getEdge8Perm(cc) { return permToIndex(cc.ep.slice(0, 8)); }
  function setEdge8Perm(cc, idx) {
    var p = indexToPerm(idx, 8);
    for (var i = 0; i < 8; i++) cc.ep[i] = p[i];
    for (var j = 8; j < 12; j++) cc.ep[j] = j;
  }

  function getSlice2(cc) {
    var p = [cc.ep[8] - 8, cc.ep[9] - 8, cc.ep[10] - 8, cc.ep[11] - 8];
    return permToIndex(p);
  }
  function setSlice2(cc, idx) {
    var p = indexToPerm(idx, 4);
    for (var i = 0; i < 4; i++) cc.ep[8 + i] = p[i] + 8;
  }

  // ---- tables ------------------------------------------------------------

  var T = { ready: false };

  function buildCoordMoveTable(size, setter, getter, moves, mult) {
    // Uint16 — permutation coordinates run to 40319, past Int16's range.
    var table = new Uint16Array(size * moves.length);
    var cc = identityCubie();
    for (var v = 0; v < size; v++) {
      setter(cc, v);
      for (var m = 0; m < moves.length; m++) {
        table[v * moves.length + m] = getter(mult(cc, MOVE_CUBIE[moves[m]]));
      }
    }
    return table;
  }

  var ALL_MOVE_IDS = [];
  for (var i = 0; i < 18; i++) ALL_MOVE_IDS.push(i);

  function cornerOnly(a, b) {
    var cp = new Array(8), co = new Array(8);
    for (var i = 0; i < 8; i++) { cp[i] = a.cp[b.cp[i]]; co[i] = (a.co[b.cp[i]] + b.co[i]) % 3; }
    return { cp: cp, co: co, ep: a.ep, eo: a.eo };
  }
  function edgeOnly(a, b) {
    var ep = new Array(12), eo = new Array(12);
    for (var i = 0; i < 12; i++) { ep[i] = a.ep[b.ep[i]]; eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2; }
    return { cp: a.cp, co: a.co, ep: ep, eo: eo };
  }

  /** Breadth-first fill of a pruning table over a pair of coordinates. */
  function fillPruning(sizeA, sizeB, moveA, moveB, nMoves, onProgress) {
    var total = sizeA * sizeB;
    var table = new Uint8Array(total);
    table.fill(255);
    table[0] = 0;
    var done = 1, depth = 0;
    while (done < total && depth < 40) {
      for (var i = 0; i < total; i++) {
        if (table[i] !== depth) continue;
        var a = (i / sizeB) | 0, b = i % sizeB;
        for (var m = 0; m < nMoves; m++) {
          var ni = moveA[a * nMoves + m] * sizeB + moveB[b * nMoves + m];
          if (table[ni] === 255) { table[ni] = depth + 1; done++; }
        }
      }
      depth++;
      if (onProgress) onProgress(done / total);
    }
    return table;
  }

  /**
   * Build every table. Returns a generator of progress objects so the caller
   * can drive it synchronously (Node) or in slices (browser).
   */
  function* buildTables() {
    yield { label: 'orientation tables', progress: 0.02 };
    T.twistMove = buildCoordMoveTable(N_TWIST, setTwist, getTwist, ALL_MOVE_IDS, cornerOnly);
    yield { label: 'orientation tables', progress: 0.06 };
    T.flipMove = buildCoordMoveTable(N_FLIP, setFlip, getFlip, ALL_MOVE_IDS, edgeOnly);
    T.sliceMove = buildCoordMoveTable(N_SLICE, setSlice, getSlice, ALL_MOVE_IDS, edgeOnly);
    yield { label: 'permutation tables', progress: 0.12 };
    T.cornPermMove = buildCoordMoveTable(N_CPERM, setCornPerm, getCornPerm, PHASE2_MOVES, cornerOnly);
    yield { label: 'permutation tables', progress: 0.26 };
    T.edge8Move = buildCoordMoveTable(N_EPERM8, setEdge8Perm, getEdge8Perm, PHASE2_MOVES, edgeOnly);
    yield { label: 'permutation tables', progress: 0.4 };
    T.slice2Move = buildCoordMoveTable(N_SLICE2, setSlice2, getSlice2, PHASE2_MOVES, edgeOnly);

    yield { label: 'distance tables 1 of 4', progress: 0.45 };
    T.pruneTwist = fillPruning(N_TWIST, N_SLICE, T.twistMove, T.sliceMove, 18);
    yield { label: 'distance tables 2 of 4', progress: 0.6 };
    T.pruneFlip = fillPruning(N_FLIP, N_SLICE, T.flipMove, T.sliceMove, 18);
    yield { label: 'distance tables 3 of 4', progress: 0.75 };
    T.pruneCorn = fillPruning(N_CPERM, N_SLICE2, T.cornPermMove, T.slice2Move, PHASE2_MOVES.length);
    yield { label: 'distance tables 4 of 4', progress: 0.9 };
    T.pruneEdge = fillPruning(N_EPERM8, N_SLICE2, T.edge8Move, T.slice2Move, PHASE2_MOVES.length);

    T.ready = true;
    yield { label: 'ready', progress: 1 };
  }

  function prepareSync() {
    if (T.ready) return;
    var it = buildTables();
    while (!it.next().done) { /* run it straight through */ }
  }

  /*
   * Browser-friendly: builds in slices so the page can paint in between.
   *
   * One build at a time, however many people ask for it. The app starts these
   * tables while the page is idle, so by the time a cube has been scanned they
   * are usually done — and the two callers then overlap: the idle warm-up is
   * half way through and the finished scan asks again. Two generators building
   * the same four megabytes into the same arrays is wasted work at best, and
   * the second one would report progress for a bar the first one is also
   * driving. So a build in flight collects the later callers instead.
   */
  var waiting = null;

  function prepare(onProgress, onDone) {
    if (T.ready) { if (onDone) onDone(); return; }
    if (waiting) {
      waiting.push({ onProgress: onProgress, onDone: onDone });
      return;
    }
    waiting = [{ onProgress: onProgress, onDone: onDone }];
    var it = buildTables();
    (function step() {
      var r = it.next();
      var listeners = waiting;
      if (r.done || T.ready) {
        waiting = null;
        listeners.forEach(function (w) {
          if (w.onProgress) w.onProgress({ label: 'ready', progress: 1 });
          if (w.onDone) w.onDone();
        });
        return;
      }
      listeners.forEach(function (w) { if (w.onProgress) w.onProgress(r.value); });
      setTimeout(step, 0);
    })();
  }

  // ---- search ------------------------------------------------------------

  function solve(state, opts) {
    opts = opts || {};
    prepareSync();
    // The search keeps finding better solutions the longer it runs, so it is
    // bounded by time rather than by the first answer it stumbles on.
    // An absolute "good enough" length is a bad stopping rule — an 8-move
    // answer is great for a scrambled cube and terrible for a one-turn one —
    // so by default we only stop on the clock or when no shorter answer can
    // exist (phase-1 depth has caught up with the best total so far).
    var target = opts.target || 0;
    var budget = opts.timeBudget || 250; // ms of improvement time
    var maxLength = opts.maxLength || 25;
    var started = Date.now();
    var deadline = started + budget;
    var nodes = 0;

    var start = toCubie(state);
    var best = null;
    var stop = false;

    var twist0 = getTwist(start), flip0 = getFlip(start), slice0 = getSlice(start);

    // Nothing to do?
    if (Cube.isSolved(state)) return [];

    var path = [];
    for (var depth = 0; depth <= 12 && !stop; depth++) {
      if (best && depth >= best.length) break;
      phase1(twist0, flip0, slice0, depth, -1, 0);
    }
    return best || [];

    function phase1(twist, flip, slice, depth, lastFace, level) {
      if (stop) return;
      if ((++nodes & 8191) === 0 && best && Date.now() > deadline) { stop = true; return; }
      if (depth === 0) {
        if (twist === 0 && flip === 0 && slice === 0) tryPhase2(level);
        return;
      }
      var h = T.pruneTwist[twist * N_SLICE + slice];
      var h2 = T.pruneFlip[flip * N_SLICE + slice];
      if (h2 > h) h = h2;
      if (h > depth) return;

      for (var m = 0; m < 18; m++) {
        var face = faceOf(m);
        if (face === lastFace) continue;
        if (lastFace >= 0 && face === oppositeFace(lastFace) && face > lastFace) continue;
        path[level] = m;
        phase1(
          T.twistMove[twist * 18 + m],
          T.flipMove[flip * 18 + m],
          T.sliceMove[slice * 18 + m],
          depth - 1, face, level + 1
        );
        if (stop) return;
      }
    }

    function tryPhase2(len) {
      // Once we have something usable, stop as soon as the budget is spent.
      // With nothing yet, keep going — a solution always exists by depth 12.
      if (best && Date.now() > deadline) { stop = true; return; }
      // rebuild the cube after the phase-1 moves
      var cc = start;
      for (var i = 0; i < len; i++) cc = multiply(cc, MOVE_CUBIE[path[i]]);

      var limit = (best ? best.length : maxLength + 1) - len - 1;
      if (limit < 0) return;

      var cornPerm = getCornPerm(cc), edge8 = getEdge8Perm(cc), slice2 = getSlice2(cc);
      var p2path = [];
      for (var d = 0; d <= limit; d++) {
        if (phase2(cornPerm, edge8, slice2, d, len ? faceOf(path[len - 1]) : -1, 0)) {
          var full = path.slice(0, len).concat(p2path.slice(0, d));
          if (!best || full.length < best.length) best = full;
          if (target && best.length <= target) stop = true;
          return;
        }
      }

      function phase2(cornPerm, edge8, slice2, depth, lastFace, level) {
        if (depth === 0) return cornPerm === 0 && edge8 === 0 && slice2 === 0;
        var h = T.pruneCorn[cornPerm * N_SLICE2 + slice2];
        var h2 = T.pruneEdge[edge8 * N_SLICE2 + slice2];
        if (h2 > h) h = h2;
        if (h > depth) return false;

        var n = PHASE2_MOVES.length;
        for (var k = 0; k < n; k++) {
          var m = PHASE2_MOVES[k];
          var face = faceOf(m);
          if (face === lastFace) continue;
          if (lastFace >= 0 && face === oppositeFace(lastFace) && face > lastFace) continue;
          p2path[level] = m;
          if (phase2(
            T.cornPermMove[cornPerm * n + k],
            T.edge8Move[edge8 * n + k],
            T.slice2Move[slice2 * n + k],
            depth - 1, face, level + 1
          )) return true;
        }
        return false;
      }
    }
  }

  /**
   * Collapse neighbouring turns of the same face ("R R2" -> "R'"). The seam
   * between phase 1 and phase 2 is the usual place these show up.
   */
  function merge(names) {
    var out = names.slice(), changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < out.length - 1; i++) {
        if (out[i][0] !== out[i + 1][0]) continue;
        function amount(mv) { return mv.length === 1 ? 1 : (mv[1] === '2' ? 2 : 3); }
        var amt = (amount(out[i]) + amount(out[i + 1])) % 4;
        var merged = amt === 0 ? null : out[i][0] + (amt === 1 ? '' : amt === 2 ? '2' : "'");
        if (merged === null) out.splice(i, 2); else out.splice(i, 2, merged);
        changed = true;
        break;
      }
    }
    return out;
  }

  /** Solve and return move names, with any trivial cancellations removed. */
  function solveMoves(state, opts) {
    return merge(solve(state, opts).map(function (m) { return MOVE_NAMES[m]; }));
  }

  return {
    prepare: prepare,
    prepareSync: prepareSync,
    isReady: function () { return T.ready; },
    solveMoves: solveMoves,
    toCubie: toCubie,
    multiply: multiply,
    identityCubie: identityCubie,
    MOVE_NAMES: MOVE_NAMES,
    _internals: {
      permToIndex: permToIndex, indexToPerm: indexToPerm,
      getTwist: getTwist, setTwist: setTwist,
      getFlip: getFlip, setFlip: setFlip,
      getSlice: getSlice, setSlice: setSlice,
      getCornPerm: getCornPerm, setCornPerm: setCornPerm,
      getEdge8Perm: getEdge8Perm, setEdge8Perm: setEdge8Perm,
      getSlice2: getSlice2, setSlice2: setSlice2,
      MOVE_CUBIE: MOVE_CUBIE, tables: T
    }
  };
});
