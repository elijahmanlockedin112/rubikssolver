/*
 * solver2.js — an optimal 2x2 solver.
 *
 * A 2x2 is eight corners and nothing else, and it is small enough to solve
 * exactly rather than cleverly: hold one corner still and the whole puzzle is
 * 7! arrangements times 3^6 twists, which is 3,674,160 positions. That is few
 * enough to walk the entire cube outward from solved once and write down how
 * far away every single position is. Solving is then not a search at all —
 * read the distance, step to any neighbour that is one closer, repeat.
 *
 * So every solution here is the shortest one that exists. No 2x2 needs more
 * than 11 moves, and this always finds that.
 *
 * Holding a corner still is what keeps it small. A cube has no fixed centres at
 * this size, so "solved" only means every face is one colour — the cube can
 * come out facing any way. Pinning the back-bottom-left corner and turning only
 * U, R and F reaches every position exactly once, instead of 24 times over.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cuben.js') : root.CubeN);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Solver2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN) {
  'use strict';

  var N = 2, PER = 4;
  var cube = CubeN.of(N);

  var STAGES = [
    { id: 'solve', title: 'Solve it', blurb: 'The shortest solution there is for this cube — no 2×2 ever needs more than eleven turns.' }
  ];

  // Only these three faces turn. The other three would just be the same
  // positions seen from somewhere else, because nothing pins a 2x2's
  // orientation but the corner being held still.
  var MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'"];

  /*
   * Each corner's three stickers, in an order that means the same thing on
   * every corner.
   *
   * Twist has to be counted the same way round the cube over, or adding two
   * twists together is meaningless — and adding twists is exactly what the move
   * tables do. Sorting each corner's stickers by face number does NOT give
   * that: it winds one way on some corners and the other way on their
   * neighbours, which quietly turns the move tables into something that is not
   * a cube at all. It shows up as a distance table with far too many positions
   * close to solved.
   *
   * So each corner is wound the same way as U,R,F, and then turned so its up-
   * or-down sticker comes first. Every corner of a solved cube is then twist
   * zero, and a twist is simply how far round from there.
   */
  function det3(a, b, c) {
    return a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  function normalOf(fl) {
    var face = Math.floor(fl / PER), o = fl % PER;
    return CubeN.stickerPoint(N, face, Math.floor(o / N), o % N).n;
  }
  var CORNERS = CubeN.pieces(N).corners.map(function (group) {
    // wind it the same way as U,R,F
    var g = group.slice();
    if (det3(normalOf(g[0]), normalOf(g[1]), normalOf(g[2])) > 0) g = [g[0], g[2], g[1]];
    // then start at the up-or-down sticker
    var start = 0;
    for (var i = 0; i < 3; i++) {
      var face = Math.floor(g[i] / PER);
      if (face === 0 || face === 3) { start = i; break; }
    }
    return [g[start], g[(start + 1) % 3], g[(start + 2) % 3]];
  });
  var CORNER_FACES = CORNERS.map(function (g) {
    return g.map(function (fl) { return Math.floor(fl / PER); });
  });

  /** The corner touching D, L and B — the one held still. */
  var FIXED = (function () {
    for (var i = 0; i < CORNERS.length; i++) {
      var f = CORNER_FACES[i];
      if (f.indexOf(3) >= 0 && f.indexOf(4) >= 0 && f.indexOf(5) >= 0) return i;
    }
    throw new Error('no D-L-B corner');
  })();
  var MOVING = [];
  for (var i = 0; i < 8; i++) if (i !== FIXED) MOVING.push(i);

  /** Which piece sits at each corner, and how it is twisted. */
  function readCorners(state) {
    var cp = new Int8Array(8), co = new Int8Array(8);
    for (var p = 0; p < 8; p++) {
      var colours = CORNERS[p].map(function (fl) { return state[fl]; });
      var key = colours.slice().sort().join(',');
      var piece = -1;
      for (var q = 0; q < 8; q++) {
        if (CORNER_FACES[q].slice().sort().join(',') === key) { piece = q; break; }
      }
      if (piece < 0) return null;                      // not a real corner
      // Twist is read off where the up-or-down colour sits.
      var twist = -1;
      for (var j = 0; j < 3; j++) if (colours[j] === 0 || colours[j] === 3) twist = j;
      if (twist < 0) return null;                      // a corner with no U or D colour
      cp[p] = piece;
      co[p] = twist;
    }
    return { cp: cp, co: co };
  }

  // ---- coordinates --------------------------------------------------------

  var FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
  var N_PERM = 5040, N_ORI = 729, N_STATES = N_PERM * N_ORI;

  function permIndex(order) {                          // Lehmer code of 7 values
    var idx = 0;
    for (var i = 0; i < 7; i++) {
      var smaller = 0;
      for (var j = i + 1; j < 7; j++) if (order[j] < order[i]) smaller++;
      idx += smaller * FACT[6 - i];
    }
    return idx;
  }
  function permFromIndex(idx) {
    var pool = [0, 1, 2, 3, 4, 5, 6], out = new Int8Array(7);
    for (var i = 0; i < 7; i++) {
      var f = FACT[6 - i];
      var k = (idx / f) | 0;
      idx -= k * f;
      out[i] = pool[k];
      pool.splice(k, 1);
    }
    return out;
  }
  function oriIndex(twists) {                          // six free, the seventh follows
    var idx = 0;
    for (var i = 0; i < 6; i++) idx = idx * 3 + twists[i];
    return idx;
  }
  function oriFromIndex(idx) {
    var out = new Int8Array(7), sum = 0;
    for (var i = 5; i >= 0; i--) { out[i] = idx % 3; idx = (idx / 3) | 0; sum += out[i]; }
    out[6] = (3 - (sum % 3)) % 3;
    return out;
  }

  // ---- move tables --------------------------------------------------------

  /*
   * A move moves pieces between positions, and twists them by an amount that
   * depends only on where they land — never on which piece happens to be there.
   * That is what lets the arrangement and the twists be tracked as two separate
   * numbers instead of one enormous one.
   *
   * Both fall straight out of applying the move to a solved cube: every piece
   * is then its own label, so where each one went IS the position mapping, and
   * how far each turned IS the twist.
   */
  var permMove = null, oriMove = null;

  function buildTables() {
    if (permMove) return;
    var from = [], twist = [];
    MOVES.forEach(function (m, mi) {
      var after = readCorners(cube.apply(cube.SOLVED, m));
      from[mi] = after.cp;
      twist[mi] = after.co;
    });

    permMove = [];
    oriMove = [];
    for (var mi = 0; mi < MOVES.length; mi++) {
      permMove.push(new Int32Array(N_PERM));
      oriMove.push(new Int32Array(N_ORI));
    }

    var order = new Int8Array(7), next = new Int8Array(7);
    for (var p = 0; p < N_PERM; p++) {
      var cur = permFromIndex(p);
      for (var mi2 = 0; mi2 < MOVES.length; mi2++) {
        for (var s = 0; s < 7; s++) {
          // the piece that lands at MOVING[s] came from where the move says
          next[s] = cur[MOVING.indexOf(from[mi2][MOVING[s]])];
        }
        permMove[mi2][p] = permIndex(next);
      }
    }
    var twists = new Int8Array(7), nextT = new Int8Array(7);
    for (var o = 0; o < N_ORI; o++) {
      var curT = oriFromIndex(o);
      for (var mi3 = 0; mi3 < MOVES.length; mi3++) {
        for (var s2 = 0; s2 < 7; s2++) {
          var src = MOVING.indexOf(from[mi3][MOVING[s2]]);
          nextT[s2] = (curT[src] + twist[mi3][MOVING[s2]]) % 3;
        }
        oriMove[mi3][o] = oriIndex(nextT);
      }
    }
  }

  // ---- the distance table -------------------------------------------------

  var dist = null;

  /**
   * How far every position is from solved.
   *
   * Grown outward from solved a layer at a time. Once it is built, solving is
   * just following the numbers downhill, so there is no search and no way to
   * come back with anything longer than the shortest answer.
   */
  function buildDistances() {
    if (dist) return;
    buildTables();
    dist = new Uint8Array(N_STATES).fill(255);
    dist[0] = 0;
    var frontier = new Int32Array(N_STATES);
    var head = 0, tail = 0;
    frontier[tail++] = 0;
    while (head < tail) {
      var idx = frontier[head++];
      var p = (idx / N_ORI) | 0, o = idx % N_ORI;
      var d = dist[idx] + 1;
      for (var m = 0; m < MOVES.length; m++) {
        var nx = permMove[m][p] * N_ORI + oriMove[m][o];
        if (dist[nx] !== 255) continue;
        dist[nx] = d;
        frontier[tail++] = nx;
      }
    }
  }

  // ---- the colour scheme --------------------------------------------------

  /**
   * Work out which colour belongs on which face, and relabel.
   *
   * A 2x2 has no centre anywhere, so nothing on the cube announces which face
   * is which — the corners have to say. Two colours are opposite exactly when
   * no corner ever shows both. The rest is read straight off the corner being
   * held still: whatever colour sits on its D sticker is the D colour, and so
   * on. Taking it from that corner is what leaves it already solved, which is
   * what the held-still corner has to be.
   */
  function schemeOf(state) {
    var adjacent = [];
    for (var i = 0; i < 6; i++) { adjacent.push([]); for (var j = 0; j < 6; j++) adjacent[i].push(false); }
    for (var c = 0; c < 8; c++) {
      var tri = CORNERS[c].map(function (fl) { return state[fl]; });
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) {
        return { ok: false, message: 'A corner shows the same colour twice, so this is not a cube that can exist.' };
      }
      adjacent[tri[0]][tri[1]] = adjacent[tri[1]][tri[0]] = true;
      adjacent[tri[1]][tri[2]] = adjacent[tri[2]][tri[1]] = true;
      adjacent[tri[0]][tri[2]] = adjacent[tri[2]][tri[0]] = true;
    }
    var opposite = [];
    for (var a = 0; a < 6; a++) {
      var found = [];
      for (var b = 0; b < 6; b++) if (a !== b && !adjacent[a][b]) found.push(b);
      if (found.length !== 1) {
        return { ok: false, message: 'The corners do not agree on which colours are opposite, so this ' +
          'cube cannot exist. Check the map for a sticker read as the wrong colour.' };
      }
      opposite[a] = found[0];
    }

    var toFace = [];
    for (var k = 0; k < 3; k++) {
      var colour = state[CORNERS[FIXED][k]];
      var face = CORNER_FACES[FIXED][k];
      toFace[colour] = face;
      toFace[opposite[colour]] = (face + 3) % 6;      // U/D, R/L, F/B are 3 apart
    }
    for (var v = 0; v < 6; v++) if (toFace[v] === undefined) {
      return { ok: false, message: 'This cube’s colours do not form a real scheme.' };
    }
    return { ok: true, toFace: toFace };
  }

  function normalise(state, scheme) {
    var out = new Uint8Array(state.length);
    for (var i = 0; i < state.length; i++) out[i] = scheme.toFace[state[i]];
    return out;
  }

  // ---- solving ------------------------------------------------------------

  function coordsOf(state) {
    var read = readCorners(state);
    if (!read) return null;
    var order = new Int8Array(7), twists = new Int8Array(7);
    for (var s = 0; s < 7; s++) {
      var piece = read.cp[MOVING[s]];
      var at = MOVING.indexOf(piece);
      if (at < 0) return null;                        // the held corner moved: not solvable this way
      order[s] = at;
      twists[s] = read.co[MOVING[s]];
    }
    return { perm: permIndex(order), ori: oriIndex(twists), twists: twists };
  }

  /**
   * Solve a 2x2.
   *
   * The move list is replayed on the cube as it was handed in and all six faces
   * checked before anything is returned, the same as every other solver here.
   */
  function solve(state) {
    var scheme = schemeOf(state);
    if (!scheme.ok) return { ok: false, message: scheme.message };
    buildDistances();

    var working = normalise(state, scheme);
    var co = coordsOf(working);
    if (!co) {
      return { ok: false, message: 'That is not a cube that can exist. Check the map for a sticker ' +
        'read as the wrong colour.' };
    }
    // The seventh twist has to follow from the other six, or the cube has a
    // corner twisted on its own — which cannot happen unless it came apart.
    var sum = 0;
    for (var t = 0; t < 7; t++) sum += co.twists[t];
    if (sum % 3 !== 0) {
      return { ok: false, message: 'One corner is twisted on its own, which is impossible on an intact ' +
        'cube. Re-check that corner’s three stickers.' };
    }

    var idx = co.perm * N_ORI + co.ori;
    if (dist[idx] === 255) {
      return { ok: false, message: 'That arrangement of corners cannot be reached on a real cube.' };
    }

    var moves = [];
    var p = co.perm, o = co.ori;
    var guard = 0;
    while (dist[p * N_ORI + o] > 0 && guard++ < 20) {
      var here = dist[p * N_ORI + o];
      for (var m = 0; m < MOVES.length; m++) {
        var np = permMove[m][p], no = oriMove[m][o];
        if (dist[np * N_ORI + no] !== here - 1) continue;
        moves.push(MOVES[m]);
        p = np; o = no;
        break;
      }
    }

    var steps = moves.map(function (m) { return { move: m, stage: 'solve' }; });
    var states = [Uint8Array.from(state)];
    for (var i = 0; i < steps.length; i++) states.push(cube.apply(states[i], steps[i].move));
    var end = states[states.length - 1];
    for (var f = 0; f < 6; f++) {
      for (var k = 0; k < PER; k++) {
        if (end[f * PER + k] !== end[f * PER]) {
          return { ok: false, message: 'The solver produced moves that do not finish this cube, so it ' +
            'has thrown them away rather than hand them over. This is a bug — please report it.' };
        }
      }
    }

    var groups = steps.length
      ? [{ id: 'solve', title: STAGES[0].title, blurb: STAGES[0].blurb, start: 0, count: steps.length }]
      : [];

    return { ok: true, steps: steps, states: states, groups: groups, moves: moves };
  }

  return {
    STAGES: STAGES,
    solve: solve,
    MOVES: MOVES,
    _internals: {
      cube: cube, CORNERS: CORNERS, FIXED: FIXED, MOVING: MOVING,
      readCorners: readCorners, schemeOf: schemeOf, normalise: normalise,
      coordsOf: coordsOf, buildDistances: buildDistances, buildTables: buildTables,
      permIndex: permIndex, permFromIndex: permFromIndex,
      oriIndex: oriIndex, oriFromIndex: oriFromIndex,
      N_PERM: N_PERM, N_ORI: N_ORI, N_STATES: N_STATES,
      distances: function () { return dist; }
    }
  };
});
