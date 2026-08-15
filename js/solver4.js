/*
 * solver4.js — a 4x4 solver by reduction.
 *
 * A 4x4 is solved by turning it into a 3x3 and then solving that:
 *
 *   1. Centres  — each face's four centre pieces made one colour.
 *   2. Edges    — the 24 wings joined into 12 matched pairs.
 *   3. As a 3x3 — with solid centres and joined edges, outer turns alone
 *                 behave exactly like a 3x3, so kociemba.js solves it.
 *   4. Parity   — two positions a real 3x3 can never be in, because a 4x4
 *                 hides which of two identical-looking pieces is which.
 *
 * There is no practical optimal solver at this size, so this does not chase a
 * move count. It aims to be correct, quick enough to feel instant, and made of
 * stages a person could follow. Expect roughly 70-120 moves.
 *
 * How the searches work
 * ---------------------
 * Solving centres is not a job for a general search over the whole cube — that
 * space is far too big. But each centre stage only cares about *some* of the
 * stickers, and if the rest are ignored the space collapses to something a
 * search can cross in a fraction of a second. Every stage here is a
 * meet-in-the-middle breadth-first search over such a projection, which returns
 * the shortest sequence for that stage rather than merely some sequence.
 *
 * The projections and their measured sizes are recorded at each stage below.
 */
;(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./cuben.js') : root.CubeN,
    typeof require === 'function' ? require('./kociemba.js') : root.Kociemba,
    typeof require === 'function' ? require('./cube.js') : root.Cube
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Solver4 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN, Kociemba, Cube3) {
  'use strict';

  var N = 4;
  var cube = CubeN.of(N);
  var PER = N * N;                       // 16 stickers a face
  var LET = CubeN.FACE_LETTERS;          // U R F D L B

  var STAGES = [
    { id: 'centres', title: 'Centres', blurb: 'Gather each face’s four middle pieces into one solid colour. Until this is done the cube has no fixed faces at all.' },
    { id: 'edges', title: 'Edge pairs', blurb: 'Join the 24 edge pieces into 12 matching pairs, so each edge behaves like one piece.' },
    { id: 'reduced', title: 'Solve as a 3×3', blurb: 'With solid centres and joined edges, the outer layers turn exactly like a 3×3 — so it gets solved like one.' },
    { id: 'parity', title: 'Parity fix', blurb: 'A position only a 4×4 can reach, because it can hide which of two identical pieces is which. One algorithm clears it.' }
  ];

  // ---- move helpers -------------------------------------------------------

  var ALL_MOVES = cube.MOVE_NAMES.slice();
  var OUTER = [];                        // the six face turns: these keep solid centres solid
  ALL_MOVES.forEach(function (m) { if (m[0] === m[0].toUpperCase()) OUTER.push(m); });

  function inverseOf(move) {
    if (move.indexOf('2') >= 0) return move;
    return move.indexOf("'") >= 0 ? move.replace("'", '') : move + "'";
  }

  function invertSeq(seq) {
    return seq.slice().reverse().map(inverseOf);
  }

  /** The layer a move turns, so a search never turns the same layer twice running. */
  function layerKey(move) {
    var g = CubeN.moveGeometry(N, move);
    return g.axis + ':' + g.layer;
  }
  var AXIS_OF = {}, LAYER_OF = {};
  ALL_MOVES.forEach(function (m) {
    var g = CubeN.moveGeometry(N, m);
    AXIS_OF[m] = g.axis; LAYER_OF[m] = layerKey(m);
  });

  // ---- projected search ---------------------------------------------------

  /**
   * Meet-in-the-middle breadth-first search over a projection of the cube.
   *
   * `slots` lists the facelets the stage cares about; `label` turns a sticker
   * colour into the small alphabet the projection uses (everything the stage is
   * indifferent to collapses onto one symbol, which is what makes the space
   * small enough to cross).
   *
   * Searching from both ends is what makes this practical. The side-centre
   * stage, for instance, has about 63 million states and a diameter around 11:
   * hopeless in one direction, but each half only reaches depth 5 or 6, which is
   * a few hundred thousand states.
   */
  function makeProjection(slots, moves) {
    var index = {};
    slots.forEach(function (s, i) { index[s] = i; });
    var perms = moves.map(function (m) {
      var full = cube.MOVE_PERMS[m];
      return slots.map(function (s) { return index[full[s]]; });
    });
    return { slots: slots, moves: moves, perms: perms, size: slots.length };
  }

  function projectState(state, proj, label) {
    return proj.slots.map(function (s) { return label(state[s]); });
  }

  function applyProj(st, perm) {
    var out = new Array(st.length);
    for (var i = 0; i < st.length; i++) out[i] = st[perm[i]];
    return out;
  }

  function keyOf(st) { return st.join(','); }

  /**
   * Shortest move sequence taking `start` to `goal` within a projection.
   *
   * Both halves are grown a layer at a time, always expanding the smaller one,
   * and the search stops the moment the two frontiers touch. `cap` bounds the
   * total depth so a stage that has been handed something impossible says so
   * rather than running forever.
   */
  function searchProjection(proj, start, goal, cap) {
    if (keyOf(start) === keyOf(goal)) return [];

    var moves = proj.moves;
    var inverseIndex = moves.map(function (m) { return moves.indexOf(inverseOf(m)); });
    for (var q = 0; q < inverseIndex.length; q++) {
      if (inverseIndex[q] < 0) throw new Error('move set is not closed under inverses: ' + moves[q]);
    }

    // each side maps state-key -> the move list that reaches it from its own root
    var fromStart = new Map([[keyOf(start), []]]);
    var fromGoal = new Map([[keyOf(goal), []]]);
    var frontA = [{ st: start, path: [] }];
    var frontB = [{ st: goal, path: [] }];
    var depth = 0;

    while (depth < (cap || 14)) {
      // grow whichever side is cheaper to grow
      var growA = frontA.length <= frontB.length;
      var front = growA ? frontA : frontB;
      var seen = growA ? fromStart : fromGoal;
      var other = growA ? fromGoal : fromStart;
      var next = [];

      for (var i = 0; i < front.length; i++) {
        var node = front[i];
        var lastLayer = node.path.length ? LAYER_OF[node.path[node.path.length - 1]] : null;
        for (var m = 0; m < moves.length; m++) {
          if (LAYER_OF[moves[m]] === lastLayer) continue;    // never turn one layer twice running
          var st = applyProj(node.st, proj.perms[m]);
          var k = keyOf(st);
          if (seen.has(k)) continue;
          var path = node.path.concat(moves[m]);
          seen.set(k, path);
          if (other.has(k)) {
            var fromS = growA ? path : other.get(k);
            var fromG = growA ? other.get(k) : path;
            return fromS.concat(invertSeq(fromG));
          }
          next.push({ st: st, path: path });
        }
      }
      if (!next.length) return null;                          // nothing further to reach
      if (growA) frontA = next; else frontB = next;
      depth++;
    }
    return null;
  }

  // ---- the colour scheme --------------------------------------------------

  var PIECES = CubeN.pieces(N);

  /** Facelets of each corner, ordered so the three faces wind like U,R,F. */
  var CORNERS = PIECES.corners.map(function (group) {
    var normals = group.map(function (fl) {
      var face = Math.floor(fl / PER), o = fl % PER;
      return CubeN.stickerPoint(N, face, Math.floor(o / N), o % N).n;
    });
    var d = det3(normals[0], normals[1], normals[2]);
    // U,R,F winds one way; a corner listed the other way is fixed by swapping
    // two of its stickers, which flips the winding and nothing else.
    return d < 0 ? group.slice() : [group[0], group[2], group[1]];
  });

  /** The corner at the U-R-F position, its facelets ordered U, then R, then F. */
  var URF_CORNER = (function () {
    var faces = [0, 1, 2];
    for (var i = 0; i < PIECES.corners.length; i++) {
      var g = PIECES.corners[i];
      var on = g.map(function (fl) { return Math.floor(fl / PER); });
      if (faces.every(function (f) { return on.indexOf(f) >= 0; })) {
        return faces.map(function (f) { return g[on.indexOf(f)]; });
      }
    }
    throw new Error('no U-R-F corner');
  })();

  function det3(a, b, c) {
    return a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }

  /**
   * Work out which colour belongs on which face, and relabel so that face f
   * wants colour f.
   *
   * A scanned 4x4 arrives with its colours numbered in whatever order the
   * scanner happened to meet them, and — unlike a 3x3 — it has no fixed centre
   * to say which face is which. What the cube does carry is its own colour
   * scheme, written in the corners: two colours are opposite exactly when no
   * corner ever shows both, and any single corner read in the U,R,F winding
   * fixes which of the two mirror schemes this cube uses.
   *
   * Getting this wrong would not be caught until the 3x3 stage failed, so the
   * result is checked here: six colours, three opposite pairs, no colour left
   * unaccounted for.
   */
  function schemeOf(state) {
    var adjacent = [];
    for (var i = 0; i < 6; i++) { adjacent[i] = []; for (var j = 0; j < 6; j++) adjacent[i][j] = false; }

    for (var c = 0; c < CORNERS.length; c++) {
      var tri = CORNERS[c].map(function (fl) { return state[fl]; });
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) {
        return { ok: false, message: 'A corner shows the same colour twice, so these six faces are not one cube.' };
      }
      adjacent[tri[0]][tri[1]] = adjacent[tri[1]][tri[0]] = true;
      adjacent[tri[1]][tri[2]] = adjacent[tri[2]][tri[1]] = true;
      adjacent[tri[0]][tri[2]] = adjacent[tri[2]][tri[0]] = true;
    }

    var opposite = [];
    for (var a = 0; a < 6; a++) {
      var candidates = [];
      for (var b = 0; b < 6; b++) if (a !== b && !adjacent[a][b]) candidates.push(b);
      if (candidates.length !== 1) {
        return {
          ok: false,
          message: 'The corners do not agree on which colours are opposite, so this is not a cube ' +
            'that can exist. Check the map for a sticker read as the wrong colour.'
        };
      }
      opposite[a] = candidates[0];
    }

    // One corner pins the whole scheme down — but it has to be the corner
    // sitting at the U-R-F position, read U first, then R, then F. Seeding from
    // just any corner also yields a perfectly valid colour scheme, and the
    // centres will happily solve to it, because centre pieces can be moved
    // anywhere. It goes wrong later: the scheme would be the cube's own, turned
    // a quarter of the way round, and no sequence of moves can turn a cube's
    // faces into different faces. Nothing would complain until the 3x3 stage
    // found a cube it could not finish.
    var seed = URF_CORNER.map(function (fl) { return state[fl]; });
    var faceColour = [seed[0], seed[1], seed[2], opposite[seed[0]], opposite[seed[1]], opposite[seed[2]]];

    var used = {};
    for (var f = 0; f < 6; f++) {
      if (used[faceColour[f]]) return { ok: false, message: 'This cube’s colours do not form a real scheme.' };
      used[faceColour[f]] = true;
    }

    var toFace = [];                       // colour -> the face it belongs on
    for (var g = 0; g < 6; g++) toFace[faceColour[g]] = g;
    return { ok: true, toFace: toFace, faceColour: faceColour, opposite: opposite };
  }

  /** Relabel a state so that solving it means reaching cube.SOLVED. */
  function normalise(state, scheme) {
    var out = new Uint8Array(state.length);
    for (var i = 0; i < state.length; i++) out[i] = scheme.toFace[state[i]];
    return out;
  }

  // ---- stage 1: centres ---------------------------------------------------

  var CENTRE_SLOTS = [];                 // all 24, grouped by face
  for (var f = 0; f < 6; f++) {
    for (var r = 1; r <= 2; r++) for (var c = 1; c <= 2; c++) CENTRE_SLOTS.push(f * PER + r * N + c);
  }
  function centresOfFace(face) {
    return CENTRE_SLOTS.filter(function (s) { return Math.floor(s / PER) === face; });
  }

  /*
   * Why the centres come in two steps, U/D first and the sides after.
   *
   * A face turn only ever spins its own four centre pieces on the spot, so it
   * can never carry a centre piece from one face to another; the only moves
   * that can are the inner slices. And an inner slice on the x or z axis drags
   * two of U's centre slots away with it. So there is no set of moves that both
   * moves centre pieces between faces AND leaves a finished U and D alone —
   * which means the last two opposite faces can never be done one after the
   * other. U and D have to be solved together, in one search.
   *
   * Once they are, the picture changes: `u` and `d` shift the side faces' top
   * and bottom bands around between F, R, B and L without touching U or D at
   * all, so the four side centres really are a separate, smaller puzzle.
   */

  // U and D together. Every centre slot is labelled U-colour, D-colour, or
  // "something else": 24 slots choose 4 then 4, about 51 million states,
  // measured diameter 8, so each half of the search only reaches depth 4.
  var UD_PROJ = makeProjection(CENTRE_SLOTS, ALL_MOVES);

  // The four side centres, once U and D are solid. Only moves that leave U and
  // D alone are allowed, and of those only `u` and `d` move a piece between
  // faces. 16 slots, four colours, about 63 million states, diameter about 11.
  var SIDE_SLOTS = [];
  [1, 2, 4, 5].forEach(function (face) { SIDE_SLOTS = SIDE_SLOTS.concat(centresOfFace(face)); });
  var SIDE_MOVES = ALL_MOVES.filter(function (m) {
    var letter = m[0];
    return letter !== 'r' && letter !== 'l' && letter !== 'f' && letter !== 'b';
  });
  var SIDE_PROJ = makeProjection(SIDE_SLOTS, SIDE_MOVES);

  function solveCentres(state) {
    var moves = [];

    // --- U and D ---
    var udLabel = function (colour) { return colour === 0 ? 0 : colour === 3 ? 1 : 2; };
    var udStart = projectState(state, UD_PROJ, udLabel);
    var udGoal = projectState(cube.SOLVED, UD_PROJ, udLabel);
    var udPath = searchProjection(UD_PROJ, udStart, udGoal, 12);
    if (!udPath) return null;
    moves = moves.concat(udPath);
    state = cube.applySeq(state, udPath);

    // --- the four sides ---
    var sideLabel = function (colour) { return colour; };
    var sideStart = projectState(state, SIDE_PROJ, sideLabel);
    var sideGoal = projectState(cube.SOLVED, SIDE_PROJ, sideLabel);
    var sidePath = searchProjection(SIDE_PROJ, sideStart, sideGoal, 14);
    if (!sidePath) return null;
    moves = moves.concat(sidePath);
    state = cube.applySeq(state, sidePath);

    return { moves: moves, state: state };
  }

  function centresSolved(state) {
    for (var face = 0; face < 6; face++) {
      var slots = centresOfFace(face);
      for (var i = 0; i < slots.length; i++) if (state[slots[i]] !== face) return false;
    }
    return true;
  }

  // ---- stage 2: edge pairs ------------------------------------------------

  /*
   * The 24 wings sit in 12 pairs of slots — two slots to each edge of the cube.
   * An edge is "paired" when its two slots show the same colour on the same
   * face, because from then on the pair behaves as one 3x3 edge.
   */
  var EDGE_SLOTS = (function () {
    var byFaces = {};
    PIECES.edges.forEach(function (group) {
      var faces = group.map(function (fl) { return Math.floor(fl / PER); }).sort(function (a, b) { return a - b; });
      var key = faces.join(',');
      // order each wing's facelets by face, so the two wings of an edge line up
      var ordered = group.slice().sort(function (a, b) { return Math.floor(a / PER) - Math.floor(b / PER); });
      (byFaces[key] = byFaces[key] || []).push(ordered);
    });
    return Object.keys(byFaces).map(function (key) {
      return { faces: key.split(',').map(Number), wings: byFaces[key] };
    });
  })();

  function edgePaired(state, edge) {
    var a = edge.wings[0], b = edge.wings[1];
    return state[a[0]] === state[b[0]] && state[a[1]] === state[b[1]];
  }

  function allEdgesPaired(state) {
    return EDGE_SLOTS.every(function (e) { return edgePaired(state, e); });
  }

  var EDGE_FACELETS = EDGE_SLOTS.reduce(function (acc, e) {
    return acc.concat(e.wings[0], e.wings[1]);
  }, []);

  /*
   * Pairing is NOT finished, and deliberately has no half-working version here.
   *
   * What is settled, by measurement rather than argument:
   *
   *   - Outer face turns are free. They keep solid centres solid, and they map
   *     an edge’s pair of wing slots onto another edge’s pair, so they can
   *     never break a pair that is already made. Every setup move can be one.
   *   - Only a slice can create a new pair, and a slice on its own wrecks the
   *     centres. A slice sandwich "s A s'" puts them back exactly when A turns
   *     each side face a net whole turn: "R U R' F R' F' R" has R +1-1-1+1 and
   *     F +1-1, which is why the textbook "u' R U R' F R' F' R u" is safe and
   *     "u R2 u'" is not. Both were checked in the model, not assumed.
   *   - Searching for the pairs the way the centres were searched does not
   *     work, and the reason is worth writing down so it is not tried twice: a
   *     projection is only valid when its slots are closed under the moves. Any
   *     set of “the centres, the edges already paired, and the one being built”
   *     is not closed, because a move carries a tracked facelet to an untracked
   *     one. Closing it means taking all 48 edge facelets, and then the goal
   *     stops being a single state — which is exactly what meet-in-the-middle
   *     needs. Pairing has to be done by algorithm, not by search.
   *   - A usable algorithm exists: "U2 r l' U2 l r'" leaves the centres solid,
   *     moves no corner at all, and disturbs only six wings. Found by sweeping
   *     all 1116 x 1116 commutators [A,B] with A and B up to two moves; nothing
   *     touching fewer than six wings exists in that family.
   *
   * What is left is the bookkeeping the textbook method needs: keeping finished
   * pairs out of the slice being worked, and the last few edges, which need
   * their own case. Until that is written and tested, solve() refuses.
   */

  /**
   * Solve a 4x4.
   *
   * Refuses, for now, and says exactly how far it can get. Handing back a move
   * list that does not solve the cube in front of someone would be worse than
   * handing back nothing, so until edge pairing is written this returns the
   * centre solution and an honest account of what is missing.
   */
  function solve(state) {
    var scheme = schemeOf(state);
    if (!scheme.ok) return { ok: false, message: scheme.message };

    var normalised = normalise(state, scheme);
    var centres = solveCentres(normalised);
    if (!centres) {
      return { ok: false, message: 'The centres of this cube could not be worked out. That usually means a sticker was read as the wrong colour — check the map.' };
    }

    return {
      ok: false,
      partial: { stage: 'centres', moves: centres.moves },
      message: 'A 4×4 solution is not finished yet. The centres can be solved (' +
        centres.moves.length + ' moves from here), but joining the edge pairs is still ' +
        'being built, so there is no full solution to show. The map and the 3D view work.'
    };
  }

  return {
    STAGES: STAGES,
    solve: solve,
    // exposed so the tests can drive one stage at a time
    _internals: {
      EDGE_SLOTS: EDGE_SLOTS, edgePaired: edgePaired, allEdgesPaired: allEdgesPaired,
      EDGE_FACELETS: EDGE_FACELETS,
      cube: cube, ALL_MOVES: ALL_MOVES, OUTER: OUTER,
      inverseOf: inverseOf, invertSeq: invertSeq,
      makeProjection: makeProjection, projectState: projectState,
      searchProjection: searchProjection,
      schemeOf: schemeOf, normalise: normalise,
      CENTRE_SLOTS: CENTRE_SLOTS, centresOfFace: centresOfFace,
      solveCentres: solveCentres, centresSolved: centresSolved
    }
  };
});
