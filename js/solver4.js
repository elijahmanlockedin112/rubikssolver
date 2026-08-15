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
   * Pairing the edges.
   *
   * The centres cannot help here and the search that solved them cannot be
   * reused: a projection is only valid when its slots are closed under the
   * moves, and "the centres, the edges already paired, and the one being
   * built" is not — a move carries a tracked facelet to an untracked one and
   * the search quietly returns nonsense. Closing it means taking all 48 edge
   * facelets, and then the goal stops being a single state, which is exactly
   * what a meet-in-the-middle search needs. So pairing is done by algorithm.
   *
   * Two facts make it simple. Outer face turns are free: they keep solid
   * centres solid, and they carry an edge's pair of wing slots onto another
   * edge's pair, so they can never break a pair already made. And a slice
   * sandwich — slice out, a few outer turns, slice back — puts the centres
   * back exactly when the inner block turns each side face a net whole turn.
   *
   * So: climb. Try every outer-turn setup against every sandwich, and keep
   * whichever pairs the most edges. Setups do the aiming, the sandwich does
   * the work, and the centres are safe throughout by construction.
   */

  var SLICE_LETTERS = ['u', 'd', 'r', 'l', 'f', 'b'];

  /** Outer-turn setups: nothing, one turn, or two on different faces. */
  var SETUPS = (function () {
    var out = [[]];
    OUTER.forEach(function (a) {
      out.push([a]);
      OUTER.forEach(function (b) { if (b[0] !== a[0]) out.push([a, b]); });
    });
    return out;
  })();

  /**
   * The sandwiches, checked in the model rather than argued from the notation.
   *
   * Only the ones that leave every centre solid are kept — which is the whole
   * safety property this stage rests on, so it is verified here at load rather
   * than assumed from the net-whole-turn rule that predicts it.
   */
  var SANDWICHES = (function () {
    var inner = ["R U R'", "R U' R'", "F U F'", "F U' F'"];
    var out = [];
    SLICE_LETTERS.forEach(function (letter) {
      [letter, letter + "'"].forEach(function (slice) {
        inner.forEach(function (block) {
          var seq = [slice].concat(block.split(' '), [inverseOf(slice)]);
          var after = cube.applySeq(cube.SOLVED, seq);
          if (!centresSolved(after)) return;          // must not disturb the centres
          if (allEdgesPaired(after)) return;          // and must actually move wings
          out.push(seq);
        });
      });
    });
    return out;
  })();

  function pairedCount(state) {
    var n = 0;
    for (var i = 0; i < EDGE_SLOTS.length; i++) if (edgePaired(state, EDGE_SLOTS[i])) n++;
    return n;
  }

  /** Every setup-and-sandwich available from here, with the result of each. */
  function pairingMoves(state) {
    var out = [];
    for (var s = 0; s < SETUPS.length; s++) {
      var aimed = SETUPS[s].length ? cube.applySeq(state, SETUPS[s]) : state;
      for (var m = 0; m < SANDWICHES.length; m++) {
        var after = cube.applySeq(aimed, SANDWICHES[m]);
        out.push({ seq: SETUPS[s].concat(SANDWICHES[m]), state: after, paired: pairedCount(after) });
      }
    }
    return out;
  }

  function bestImprovement(state, from) {
    var list = pairingMoves(state), best = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.paired <= from) continue;
      if (!best || c.paired > best.paired || (c.paired === best.paired && c.seq.length < best.seq.length)) best = c;
    }
    return best;
  }

  /**
   * Two moves where the first is allowed to lose ground.
   *
   * Climbing alone always stops at ten of twelve. That is the textbook last two
   * edges: the pair left over are crossed, and no single sandwich improves on
   * it from any setup — measured, not assumed. Getting out of it needs the same
   * thing a person does, which is to deliberately break a finished pair so the
   * last two can be rebuilt through it. That first move makes the count worse,
   * so a greedy step can never see it.
   */
  function bestPairOfMoves(state, from) {
    var first = pairingMoves(state);
    first.sort(function (a, b) { return (b.paired - a.paired) || (a.seq.length - b.seq.length); });
    // Trying every first move against every second is about 21 million cube
    // turns, and when it finds nothing it has spent all of them: that was the
    // whole of a 17-second worst case. The list is in order of most promising,
    // and anything that works is found early, so it stops after this many and
    // lets the shakes below deal with the rest.
    var TRIES = 700;
    var tried = 0;
    for (var i = 0; i < first.length && tried < TRIES; i++) {
      if (first[i].paired < from - 2) continue;      // no need to wreck it to escape
      tried++;
      var second = bestImprovement(first[i].state, from);
      if (second) return { seq: first[i].seq.concat(second.seq), state: second.state, paired: second.paired };
    }
    return null;
  }

  /*
   * A last resort for when even the two-step escape finds nothing.
   *
   * The climb plus the two-step escape finishes most cubes; the rest sit in a
   * last-two-edges position this sandwich set cannot take apart. Widening the
   * set is not the answer — every sandwich from every setup was tried against
   * a stalled cube and none of them reaches eleven — and a set large enough to
   * make a difference costs the ordinary case several times its runtime.
   *
   * So the cube is shaken and climbed again. The shakes are a fixed list, not
   * random ones, so a cube that defeats all of them fails the same way twice
   * and can be tracked down instead of being a ghost.
   */
  var SHAKES = (function () {
    var out = [];
    for (var i = 0; i < 12; i++) {
      out.push(SETUPS[(i * 37 + 1) % SETUPS.length].concat(SANDWICHES[i % SANDWICHES.length]));
    }
    return out;
  })();

  function solveEdges(state) {
    var moves = [];
    var have = pairedCount(state);
    var guard = 0, shaken = 0;
    while (have < 12 && guard++ < 80) {
      var step = bestImprovement(state, have) || bestPairOfMoves(state, have);
      if (step) {
        moves = moves.concat(step.seq);
        state = step.state;
        have = step.paired;
        continue;
      }
      if (shaken >= SHAKES.length) return null;
      var shake = SHAKES[shaken++];
      moves = moves.concat(shake);
      state = cube.applySeq(state, shake);
      have = pairedCount(state);
    }
    return have === 12 ? { moves: moves, state: state } : null;
  }

  // ---- stage 3: solve it as a 3x3 -----------------------------------------

  /*
   * With solid centres and joined edge pairs, the outer layers of a 4x4 turn
   * exactly like a 3x3: a face turn moves whole pieces and never splits a pair.
   * So one sticker is read from each of the 3x3's 54 slots and the existing
   * two-phase solver is handed the result. Its moves are outer turns, which
   * mean the same thing on both cubes, so they need no translation.
   */
  var REDUCE_PICK = [0, 1, 3];      // a 3x3 row or column -> which 4x4 one to read

  function reduceTo3x3(state) {
    var out = new Int8Array(54);
    for (var f = 0; f < 6; f++) {
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          out[f * 9 + r * 3 + c] = state[f * PER + REDUCE_PICK[r] * N + REDUCE_PICK[c]];
        }
      }
    }
    return out;
  }

  // ---- stage 4: parity ----------------------------------------------------

  /*
   * Two positions a 3x3 can never be in, which a 4x4 reaches because its two
   * wings of an edge look alike and can be swapped without it showing.
   *
   *   OLL parity — one edge pair flipped. The reduced cube reads as a 3x3 with
   *                a single flipped edge, which no intact 3x3 can be.
   *   PLL parity — two edge pairs swapped, so the reduced cube reads as a 3x3
   *                with two pieces exchanged.
   *
   * cube.js's validator already names both of these exactly, so the parity is
   * not guessed from the move count — it is read off the reduced cube, and the
   * matching algorithm is applied.
   *
   * Both algorithms leave every centre solid and every pair joined. That is a
   * property of the permutation rather than of any one cube, so checking it
   * once on a solved cube settles it for every cube — and it is checked, at
   * load, rather than taken on trust.
   *
   * The PLL one was not taken from a table: the published algorithms are
   * written with wide turns, and `u` here is a single inner slice, so they do
   * not carry across (the usual r2 U2 r2 u2 r2 u2 wrecks the centres in this
   * notation). It came from a sweep of every half-turn sequence up to seven
   * moves, keeping those that leave the centres solid, the pairs joined, and a
   * reduced cube the validator calls two-pieces-swapped. Twelve exist at seven
   * moves; this is one of them.
   */
  var OLL_PARITY = "r2 B2 U2 l U2 r' U2 r U2 F2 r F2 l' B2 r2".split(' ');
  var PLL_PARITY = 'u2 R2 F2 u2 F2 R2 u2'.split(' ');

  function preservesReduction(seq) {
    var after = cube.applySeq(cube.SOLVED, seq);
    return centresSolved(after) && allEdgesPaired(after);
  }

  if (!preservesReduction(OLL_PARITY) || !preservesReduction(PLL_PARITY)) {
    throw new Error('a parity algorithm does not preserve the reduction');
  }

  /** Which parity, if any, the reduced cube is showing. */
  function parityOf(state) {
    var verdict = Cube3.validate(reduceTo3x3(state));
    if (verdict.ok) return null;
    if (/flipped in place/i.test(verdict.message)) return 'oll';
    if (/look swapped/i.test(verdict.message)) return 'pll';
    return 'unknown';
  }

  // ---- the whole solve ----------------------------------------------------

  function tagged(moves, stage) {
    return moves.map(function (m) { return { move: m, stage: stage }; });
  }

  /**
   * Solve a 4x4.
   *
   * Every stage is checked against the cube itself rather than trusted, and the
   * whole thing is replayed at the end: if the move list does not actually
   * finish the cube, it is thrown away and the solve refuses. Handing someone
   * moves for a cube they do not own is the worst failure this app has.
   */
  function solve(state) {
    var scheme = schemeOf(state);
    if (!scheme.ok) return { ok: false, message: scheme.message };

    var working = normalise(state, scheme);
    var steps = [];

    var centres = solveCentres(working);
    if (!centres) {
      return { ok: false, message: 'The centres of this cube could not be worked out. That usually ' +
        'means a sticker was read as the wrong colour — check the map.' };
    }
    steps = steps.concat(tagged(centres.moves, 'centres'));
    working = centres.state;

    var edges = solveEdges(working);
    if (!edges) {
      return { ok: false, message: 'The edge pairs of this cube could not be joined up. Check the map ' +
        'for a sticker read as the wrong colour.' };
    }
    steps = steps.concat(tagged(edges.moves, 'edges'));
    working = edges.state;

    // Parity can show up as one case, then the other once the first is cleared,
    // so this loops rather than testing once.
    for (var pass = 0; pass < 3; pass++) {
      var parity = parityOf(working);
      if (!parity) break;
      if (parity === 'unknown') {
        return { ok: false, message: 'Once the pairs were joined this did not come out as a cube that ' +
          'can exist. Check the map — a sticker has almost certainly been read as the wrong colour.' };
      }
      var alg = parity === 'oll' ? OLL_PARITY : PLL_PARITY;
      steps = steps.concat(tagged(alg, 'parity'));
      working = cube.applySeq(working, alg);
    }

    var reduced = reduceTo3x3(working);
    var verdict = Cube3.validate(reduced);
    if (!verdict.ok) return { ok: false, message: verdict.message };

    var finish = Kociemba.solveMoves(reduced);
    if (!finish) return { ok: false, message: 'The last stage could not be solved.' };
    steps = steps.concat(tagged(finish, 'reduced'));

    // Replay everything on the cube as it was actually given, in the user's own
    // colours, and refuse unless it really does come out solved.
    var states = [Uint8Array.from(state)];
    for (var i = 0; i < steps.length; i++) {
      states.push(cube.apply(states[i], steps[i].move));
    }
    var end = states[states.length - 1];
    for (var f = 0; f < 6; f++) {
      for (var k = 0; k < PER; k++) {
        if (end[f * PER + k] !== end[f * PER]) {
          return { ok: false, message: 'The solver produced moves that do not finish this cube, so it ' +
            'has thrown them away rather than hand them over. This is a bug — please report it.' };
        }
      }
    }

    var groups = [];
    for (var g = 0; g < steps.length; g++) {
      var last = groups[groups.length - 1];
      if (!last || last.id !== steps[g].stage) {
        var info = STAGES.filter(function (s) { return s.id === steps[g].stage; })[0];
        groups.push({ id: info.id, title: info.title, blurb: info.blurb, start: g, count: 1 });
      } else last.count++;
    }

    return {
      ok: true,
      steps: steps,
      states: states,
      groups: groups,
      moves: steps.map(function (s) { return s.move; })
    };
  }

  return {
    STAGES: STAGES,
    solve: solve,
    // exposed so the tests can drive one stage at a time
    _internals: {
      EDGE_SLOTS: EDGE_SLOTS, edgePaired: edgePaired, allEdgesPaired: allEdgesPaired,
      EDGE_FACELETS: EDGE_FACELETS, pairedCount: pairedCount, solveEdges: solveEdges,
      SANDWICHES: SANDWICHES, SETUPS: SETUPS,
      reduceTo3x3: reduceTo3x3, parityOf: parityOf,
      OLL_PARITY: OLL_PARITY, PLL_PARITY: PLL_PARITY, preservesReduction: preservesReduction,
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
