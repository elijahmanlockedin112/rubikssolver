/*
 * solver.js — layer-by-layer ("beginner method") solver.
 *
 * The output is deliberately human-shaped rather than move-optimal: it walks
 * the same seven stages a person learns, so every move in the list is a move
 * the user could have found themselves.
 *
 *   1. bottom cross          5. top face all one color
 *   2. bottom corners        6. place the top corners
 *   3. middle-layer edges    7. finish the last edges
 *   4. top cross
 *
 * Two search helpers do the heavy lifting:
 *   search()      — plain iterative-deepening over quarter/half turns, used
 *                   for the first layer where there are no useful algorithms.
 *   macroSearch() — explores (line the top layer up, run an algorithm) pairs,
 *                   which is exactly what a person does on the last layer.
 */
;(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./cube.js') : root.Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Solver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  var U = Cube.U, R = Cube.R, F = Cube.F, D = Cube.D, L = Cube.L, B = Cube.B;
  var LET = Cube.FACE_LETTERS;

  var RIGHT_OF = {}; RIGHT_OF[F] = R; RIGHT_OF[R] = B; RIGHT_OF[B] = L; RIGHT_OF[L] = F;
  var LEFT_OF = {}; LEFT_OF[F] = L; LEFT_OF[L] = B; LEFT_OF[B] = R; LEFT_OF[R] = F;

  var STAGES = [
    { id: 'cross', title: 'Bottom cross', blurb: 'Build a plus sign on the bottom face with the side colors matching the centers.' },
    { id: 'corners', title: 'Bottom corners', blurb: 'Drop the four bottom corners in. The whole first layer is finished after this.' },
    { id: 'middle', title: 'Middle layer', blurb: 'Send the four middle edges into their slots. Two layers down.' },
    { id: 'topcross', title: 'Top cross', blurb: 'Flip the top edges so the top face shows a plus sign.' },
    { id: 'topface', title: 'Top face', blurb: 'Twist the top corners until the whole top face is a single color.' },
    { id: 'topcorners', title: 'Place top corners', blurb: 'Shuffle the top corners into the right spots.' },
    { id: 'topedges', title: 'Last edges', blurb: 'Slide the last four edges home. Cube solved.' }
  ];

  // ---- small helpers -----------------------------------------------------

  function mapAlg(str, map) {
    return str.split(/\s+/).map(function (t) {
      var face = t[0], rest = t.slice(1);
      return (map[face] !== undefined ? map[face] : face) + rest;
    });
  }

  function edgeStickers(s, pos) {
    var fl = Cube.EDGE_FACELETS[pos];
    return [s[fl[0]], s[fl[1]]];
  }

  function findEdge(s, a, b) {
    for (var i = 0; i < 12; i++) {
      var st = edgeStickers(s, i);
      if ((st[0] === a && st[1] === b) || (st[0] === b && st[1] === a)) {
        return { pos: i, ori: st[0] === a ? 0 : 1 };
      }
    }
    return null;
  }

  function findCorner(s, a, b, c) {
    for (var i = 0; i < 8; i++) {
      var fl = Cube.CORNER_FACELETS[i];
      var st = [s[fl[0]], s[fl[1]], s[fl[2]]];
      if (st.indexOf(a) >= 0 && st.indexOf(b) >= 0 && st.indexOf(c) >= 0) return i;
    }
    return null;
  }

  function edgePlaced(s, pos) {
    var fl = Cube.EDGE_FACELETS[pos], fc = Cube.EDGE_FACES[pos];
    return s[fl[0]] === fc[0] && s[fl[1]] === fc[1];
  }

  function cornerPlaced(s, pos) {
    var fl = Cube.CORNER_FACELETS[pos], fc = Cube.CORNER_FACES[pos];
    return s[fl[0]] === fc[0] && s[fl[1]] === fc[1] && s[fl[2]] === fc[2];
  }

  // U-layer edge slots and the side face each one touches.
  var U_EDGE_SLOTS = [
    { pos: Cube.edgeIndex(U, F), side: F },
    { pos: Cube.edgeIndex(U, R), side: R },
    { pos: Cube.edgeIndex(U, B), side: B },
    { pos: Cube.edgeIndex(U, L), side: L }
  ];
  var U_CORNERS = [
    Cube.cornerIndex(U, R, F), Cube.cornerIndex(U, F, L),
    Cube.cornerIndex(U, L, B), Cube.cornerIndex(U, B, R)
  ];

  // ---- brute-force search (first layer) ----------------------------------

  var ALL_MOVES = [];
  LET.forEach(function (f) { ALL_MOVES.push(f, f + "'", f + '2'); });
  var FACE_RANK = { U: 0, D: 1, R: 2, L: 3, F: 4, B: 5 };

  function search(state, goal, maxDepth, moves) {
    moves = moves || ALL_MOVES;
    var scratch = [];
    for (var d = 0; d <= maxDepth; d++) scratch[d] = new Uint8Array(54);

    for (var depth = 0; depth <= maxDepth; depth++) {
      var path = new Array(depth);
      if (dfs(state, depth, '', path, 0)) return path.slice();
    }
    return null;

    function dfs(s, depth, lastFace, path, level) {
      if (depth === 0) return goal(s);
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i], face = m[0];
        if (face === lastFace) continue;
        // opposite faces commute — only allow one canonical order
        if (Cube.OPPOSITE_FACE[face] === lastFace && FACE_RANK[face] > FACE_RANK[lastFace]) continue;
        var next = scratch[level];
        Cube.permute(s, Cube.MOVE_PERMS[m], next);
        path[level] = m;
        if (dfs(next, depth - 1, face, path, level + 1)) return true;
      }
      return false;
    }
  }

  // ---- macro search (last layer) -----------------------------------------

  /**
   * Search over (line the top layer up, run an algorithm) pairs.
   *
   * `algs` are `{ id, moves }`, and every move that came out of one is handed
   * back tagged with that id — a plain setup turn is tagged null. Nothing in
   * the solving needs that; the teaching mode does. "Run this algorithm, and
   * here is where you are in it" is the whole of what a person learns on the
   * last layer, and it cannot be recovered from a flat list of moves after the
   * fact: the same seven turns appear for other reasons, and a cancellation
   * can shave a move off either end.
   */
  function macroSearch(state, algs, goal, maxRounds) {
    var UT = ['', 'U', "U'", 'U2'];
    for (var rounds = 0; rounds <= maxRounds; rounds++) {
      var res = rec(state, rounds, []);
      if (res) return res;
    }
    return null;

    function tagged(moves, id) {
      return moves.map(function (m) { return { move: m, alg: id }; });
    }

    function rec(s, rounds, path) {
      var i, s2;
      if (rounds === 0) {
        for (i = 0; i < 4; i++) {
          s2 = UT[i] ? Cube.apply(s, UT[i]) : s;
          if (goal(s2)) return UT[i] ? path.concat(tagged([UT[i]], null)) : path;
        }
        return null;
      }
      for (i = 0; i < 4; i++) {
        s2 = UT[i] ? Cube.apply(s, UT[i]) : s;
        for (var a = 0; a < algs.length; a++) {
          var s3 = Cube.applySeq(s2, algs[a].moves);
          var body = tagged(algs[a].moves, algs[a].id);
          var head = UT[i] ? path.concat(tagged([UT[i]], null), body) : path.concat(body);
          var r = rec(s3, rounds - 1, head);
          if (r) return r;
        }
      }
      return null;
    }
  }

  // ---- main solve --------------------------------------------------------

  function solve(startState) {
    var s = Uint8Array.from(startState);
    var steps = [];      // { move, stage, alg }
    var stage = 'cross';

    // Takes either plain move strings or the { move, alg } pairs macroSearch
    // hands back, so the first-layer searches need to know nothing about tags.
    function run(moves) {
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        var name = typeof m === 'string' ? m : m.move;
        s = Cube.apply(s, name);
        steps.push({ move: name, stage: stage, alg: typeof m === 'string' ? null : m.alg });
      }
    }

    // --- 1. bottom cross --------------------------------------------------
    var CROSS_ORDER = [F, R, B, L];
    for (var ci = 0; ci < CROSS_ORDER.length; ci++) {
      solveCrossEdge(CROSS_ORDER[ci], CROSS_ORDER.slice(0, ci));
    }

    function crossIntact(st, done) {
      for (var i = 0; i < done.length; i++) {
        if (!edgePlaced(st, Cube.edgeIndex(D, done[i]))) return false;
      }
      return true;
    }

    function solveCrossEdge(face, done) {
      var target = Cube.edgeIndex(D, face);
      if (edgePlaced(s, target)) return;

      // Shortest route straight into the slot, if there is a short one.
      var direct = search(s, function (st) {
        return edgePlaced(st, target) && crossIntact(st, done);
      }, 5);
      if (direct) { run(direct); return; }

      // Otherwise: park the piece on top with the bottom color facing up,
      // then spin it over its slot and drop it in.
      var path = search(s, function (st) {
        if (!crossIntact(st, done)) return false;
        var found = findEdge(st, D, face);
        for (var k = 0; k < U_EDGE_SLOTS.length; k++) {
          if (U_EDGE_SLOTS[k].pos === found.pos) return st[Cube.EDGE_FACELETS[found.pos][0]] === D;
        }
        return false;
      }, 6);
      if (!path) throw new Error('Could not build the bottom cross (edge ' + LET[face] + ').');
      run(path);

      for (var k = 0; k < 4; k++) {
        if (findEdge(s, D, face).pos === Cube.edgeIndex(U, face)) break;
        run(['U']);
      }
      run([LET[face] + '2']);
      if (!edgePlaced(s, target)) throw new Error('Bottom cross edge ' + LET[face] + ' did not seat.');
    }

    // --- 2. bottom corners ------------------------------------------------
    stage = 'corners';
    var SLOTS = [[F, R], [R, B], [B, L], [L, F]];
    for (var si = 0; si < SLOTS.length; si++) {
      solveBottomCorner(SLOTS[si][0], SLOTS[si][1], SLOTS.slice(0, si));
    }

    function slotOfCornerPos(pos) {
      var faces = Cube.CORNER_FACES[pos].filter(function (f) { return f !== D; });
      return RIGHT_OF[faces[0]] === faces[1] ? faces : [faces[1], faces[0]];
    }

    function firstLayerIntact(st, donePairs) {
      for (var i = 0; i < CROSS_ORDER.length; i++) {
        if (!edgePlaced(st, Cube.edgeIndex(D, CROSS_ORDER[i]))) return false;
      }
      for (var j = 0; j < donePairs.length; j++) {
        if (!cornerPlaced(st, Cube.cornerIndex(D, donePairs[j][0], donePairs[j][1]))) return false;
      }
      return true;
    }

    function solveBottomCorner(a, b, donePairs) {
      var home = Cube.cornerIndex(D, a, b);
      if (cornerPlaced(s, home)) return;

      // If it is stuck in the bottom layer, lift it to the top first.
      var at = findCorner(s, D, a, b);
      if (at >= 4) {
        var pair = slotOfCornerPos(at);
        var right = LET[pair[1]];
        run([right, 'U', right + "'"]);
      }

      // Then work it in using only the top face and the slot's own side face —
      // the pair of turns a person would use for that corner.
      var right2 = LET[b];
      var moveSet = [right2, right2 + "'", right2 + '2', 'U', "U'", 'U2'];
      var path = search(s, function (st) {
        return cornerPlaced(st, home) && firstLayerIntact(st, donePairs);
      }, 9, moveSet);
      if (!path) throw new Error('Bottom corner ' + LET[a] + LET[b] + ' did not seat.');
      run(path);
    }

    // --- 3. middle layer --------------------------------------------------
    stage = 'middle';
    var MIDDLE_SLOTS = [[F, R], [R, B], [B, L], [L, F]];

    function rightInsert(f, r) {
      var map = {}; map.F = LET[f]; map.R = LET[r];
      return mapAlg("U R U' R' U' F' U F", map);
    }
    function leftInsert(f, l) {
      var map = {}; map.F = LET[f]; map.L = LET[l];
      return mapAlg("U' L' U L U F U' F'", map);
    }
    function middleDone() {
      for (var i = 0; i < MIDDLE_SLOTS.length; i++) {
        if (!edgePlaced(s, Cube.edgeIndex(MIDDLE_SLOTS[i][0], MIDDLE_SLOTS[i][1]))) return false;
      }
      return true;
    }

    for (var guard = 0; guard < 16 && !middleDone(); guard++) {
      var inserted = false;
      var UTURNS = ['', 'U', "U'", 'U2'];
      for (var ui = 0; ui < UTURNS.length && !inserted; ui++) {
        var probe = UTURNS[ui] ? Cube.apply(s, UTURNS[ui]) : s;
        for (var k2 = 0; k2 < U_EDGE_SLOTS.length; k2++) {
          var slot = U_EDGE_SLOTS[k2];
          var st2 = edgeStickers(probe, slot.pos);
          var up = st2[0], side = st2[1];
          if (up === U || up === D || side === U || side === D) continue;
          if (side !== slot.side) continue;
          var pre = UTURNS[ui] ? [UTURNS[ui]] : [];
          if (up === RIGHT_OF[slot.side]) {
            run(pre.concat(rightInsert(slot.side, RIGHT_OF[slot.side])));
            inserted = true;
          } else if (up === LEFT_OF[slot.side]) {
            run(pre.concat(leftInsert(slot.side, LEFT_OF[slot.side])));
            inserted = true;
          }
          if (inserted) break;
        }
      }
      if (!inserted) {
        // every usable edge is trapped in a middle slot — kick one out
        for (var mi = 0; mi < MIDDLE_SLOTS.length; mi++) {
          var pr = MIDDLE_SLOTS[mi];
          if (!edgePlaced(s, Cube.edgeIndex(pr[0], pr[1]))) {
            run(rightInsert(pr[0], pr[1]));
            break;
          }
        }
      }
    }
    if (!middleDone()) throw new Error('Middle layer did not finish.');

    // --- 4. top cross -----------------------------------------------------
    stage = 'topcross';
    var FRUR = Cube.parse("F R U R' U' F'");
    function topCrossDone(st) {
      for (var i = 0; i < U_EDGE_SLOTS.length; i++) {
        if (st[Cube.EDGE_FACELETS[U_EDGE_SLOTS[i].pos][0]] !== U) return false;
      }
      return true;
    }
    if (!topCrossDone(s)) {
      var p4 = macroSearch(s, [{ id: 'fruruf', moves: FRUR }], topCrossDone, 4);
      if (!p4) throw new Error('Top cross search failed.');
      run(p4);
    }

    // --- 5. top face one color --------------------------------------------
    stage = 'topface';
    var SUNE = Cube.parse("R U R' U R U2 R'");
    var ANTISUNE = Cube.parse("R U2 R' U' R U' R'");
    function topFaceDone(st) {
      for (var i = 0; i < U_CORNERS.length; i++) {
        if (st[Cube.CORNER_FACELETS[U_CORNERS[i]][0]] !== U) return false;
      }
      return true;
    }
    if (!topFaceDone(s)) {
      var p5 = macroSearch(s, [{ id: 'sune', moves: SUNE }, { id: 'antisune', moves: ANTISUNE }], topFaceDone, 3);
      if (!p5) throw new Error('Top face search failed.');
      run(p5);
    }

    // --- 6. place top corners ---------------------------------------------
    stage = 'topcorners';
    var NIKLAS = Cube.parse("U R U' L' U R' U' L");                 // pure corner 3-cycle
    // Half the time the top corners need an odd permutation (two of them
    // swapped), which no 3-cycle can produce. The T-perm swaps two corners and
    // two edges; the edges it disturbs get cleaned up by the next stage.
    var TPERM = Cube.parse("R U R' U' R' F R2 U' R' U' R U R' F'");
    function topCornersPlaced(st) {
      for (var i = 0; i < U_CORNERS.length; i++) {
        if (!cornerPlaced(st, U_CORNERS[i])) return false;
      }
      return true;
    }
    if (!topCornersPlaced(s)) {
      var p6 = macroSearch(s, [{ id: 'niklas', moves: NIKLAS }, { id: 'tperm', moves: TPERM }], topCornersPlaced, 3);
      if (!p6) throw new Error('Top corner placement search failed.');
      run(p6);
    }

    // --- 7. last edges ----------------------------------------------------
    stage = 'topedges';
    var UPERM = Cube.parse("R U' R U R U R U' R' U' R2"); // pure edge 3-cycle
    if (!Cube.isSolved(s)) {
      var p7 = macroSearch(s, [{ id: 'uperm', moves: UPERM }], Cube.isSolved, 4);
      if (!p7) throw new Error('Last-edge search failed.');
      run(p7);
    }

    if (!Cube.isSolved(s)) throw new Error('Solver finished without a solved cube.');

    return buildResult(steps, startState);
  }

  // ---- tidy up + package -------------------------------------------------

  function amount(move) { return move.length === 1 ? 1 : (move[1] === '2' ? 2 : 3); }
  function moveName(face, amt) {
    amt = ((amt % 4) + 4) % 4;
    if (amt === 0) return null;
    return face + (amt === 1 ? '' : amt === 2 ? '2' : "'");
  }

  // Collapse "R R" into "R2", drop "R R'", etc. A merged pair keeps the stage
  // label of the earlier move so the stage grouping stays sane.
  function cancel(steps) {
    var out = steps.slice();
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < out.length - 1; i++) {
        /*
         * An algorithm is left exactly as it is written.
         *
         * Cancelling two adjacent turns of the same face shortens the answer,
         * and for a list of moves to copy that is free. For a list of moves to
         * *learn* it is not: the teaching mode names the algorithm and shows
         * its notation with your place in it, and an algorithm whose last turn
         * has been folded into the next setup no longer matches the one being
         * named. Costs a few moves; buys a solution that is the thing it says
         * it is.
         */
        if (out[i].alg || out[i + 1].alg) continue;
        if (out[i].move[0] === out[i + 1].move[0]) {
          var amt = amount(out[i].move) + amount(out[i + 1].move);
          var merged = moveName(out[i].move[0], amt);
          if (merged === null) out.splice(i, 2);
          else out.splice(i, 2, { move: merged, stage: out[i].stage, alg: null });
          changed = true;
          break;
        }
      }
    }
    return out;
  }

  function buildResult(rawSteps, startState) {
    var steps = cancel(rawSteps);
    var states = [Uint8Array.from(startState)];
    for (var i = 0; i < steps.length; i++) {
      states.push(Cube.apply(states[i], steps[i].move));
    }
    var groups = [];
    for (var j = 0; j < steps.length; j++) {
      var last = groups[groups.length - 1];
      if (!last || last.id !== steps[j].stage) {
        var info = STAGES.filter(function (st) { return st.id === steps[j].stage; })[0];
        groups.push({ id: info.id, title: info.title, blurb: info.blurb, start: j, count: 1 });
      } else {
        last.count++;
      }
    }
    return { steps: steps, states: states, groups: groups, moves: steps.map(function (s) { return s.move; }) };
  }

  return { solve: solve, STAGES: STAGES };
});
