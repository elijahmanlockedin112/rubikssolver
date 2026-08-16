/*
 * node test/guide.test.js
 *
 * The scanning route, and the bookkeeping that makes it safe.
 *
 * The guidance walks a cube through six faces — three turns to the left, then
 * tips — and each face is read (photographed, or painted) exactly as it appears
 * to the person holding it. Once the cube has been turned, "the face toward
 * you" is not the face it was, and the top of what you see is not the top of
 * that face: after the last tip the bottom face arrives a quarter turn round
 * from the way the flat map draws it. Get that wrong and nothing complains —
 * the colours simply land in the wrong places, and what comes out is a
 * different cube from the one in your hands, solved confidently.
 *
 * So this turns a cube through the whole route and checks the six faces read
 * off it rebuild the original exactly, at 2x2, 3x3 and 4x4.
 *
 * The check is not circular. guide.js accumulates one permutation by composing
 * rotations; this applies the same rotations one at a time to a real state and
 * reads the front face off it. Two different routes to the same claim.
 *
 * Facelets are numbered rather than coloured, so every one of them is
 * distinguishable — a colour scheme would let a swap between two same-coloured
 * stickers pass unnoticed, which is exactly the bug being looked for.
 */
var CubeN = require('../js/cuben.js');
var CubeGuide = require('../js/guide.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function applyPerm(state, perm) {
  var out = new Int32Array(state.length);
  for (var i = 0; i < state.length; i++) out[i] = state[perm[i]];
  return out;
}

/*
 * Both routes, because there are two of them and they differ in the one thing
 * most likely to be wrong: which face the person is actually looking at.
 *
 * The phone is above the cube when scanning, so what it reads is the TOP face
 * and the route has to be rolls. The map screen has no phone, so it is the
 * face toward you and the route is turns. A route whose rotations do not
 * change the face being looked at shows the same face over and over and never
 * reaches all six — which is precisely what left-turns do to an overhead
 * camera, and is why this is checked per route rather than once.
 */
Object.keys(CubeGuide.ROUTES).forEach(function (route) {

console.log('\nthe ' + route + ' route reads a whole cube back exactly');

[2, 3, 4].forEach(function (N) {
  var per = N * N, total = 6 * per;

  // every facelet distinguishable from every other
  var original = new Int32Array(total);
  for (var i = 0; i < total; i++) original[i] = i;

  var rebuilt = new Int32Array(total).fill(-1);
  var guide = new CubeGuide(null, { size: N, route: route, state: rebuilt });

  var current = original;          // the cube as it is being held, right now
  var faces = [];

  for (var step = 0; step < CubeGuide.STEPS; step++) {
    if (step > 0) {
      // turn it in the hands, one quarter at a time, the long way round
      var moves = CubeGuide.ROUTES[route].steps[step].moves;
      for (var t = 0; t < moves.length; t++) {
        current = applyPerm(current, CubeN.wholeRotation(N, moves[t].axis, moves[t].dir));
      }
    }
    guide.setStep(step, false);

    // read the face now being looked at, in the order it appears
    var base = CubeGuide.ROUTES[route].face * per;
    var seen = [];
    for (var k = 0; k < per; k++) seen.push(current[base + k]);
    guide.fill(seen);
    faces.push(guide.faceIndex());
  }

  var same = true, wrong = -1;
  for (var j = 0; j < total; j++) if (rebuilt[j] !== original[j]) { same = false; wrong = j; break; }
  check(route + ' ' + N + 'x' + N + ': six faces read off a turning cube rebuild it exactly', same,
    same ? '' : 'facelet ' + wrong + ' came back as ' + rebuilt[wrong] + ', not ' + original[wrong]);

  var sorted = faces.slice().sort();
  check(route + ' ' + N + 'x' + N + ': the route visits all six faces, once each',
    sorted.join(',') === '0,1,2,3,4,5', 'visited ' + faces.join(','));

  // and nothing was left behind: -1 anywhere means a face was never written
  var blanks = 0;
  for (var b = 0; b < total; b++) if (rebuilt[b] < 0) blanks++;
  check(route + ' ' + N + 'x' + N + ': every sticker was covered', blanks === 0, blanks + ' left blank');
});

});

console.log('\nstepping back retraces the same route');

/*
 * The editor's "back" button is not an undo of the last turn — it replays the
 * route from the start. Cheap, and it cannot drift the way an inverse applied
 * to an accumulated permutation can.
 */
[3, 4].forEach(function (N) {
  var guide = new CubeGuide(null, { size: N, route: 'camera', state: new Int32Array(6 * N * N) });
  var forward = [];
  for (var i = 0; i < CubeGuide.STEPS; i++) { guide.setStep(i, false); forward.push(guide.faceCells().join(',')); }
  var backward = [];
  for (var j = CubeGuide.STEPS - 1; j >= 0; j--) { guide.setStep(j, false); backward.unshift(guide.faceCells().join(',')); }
  check(N + 'x' + N + ': the same step shows the same cells whichever way you got there',
    forward.join('|') === backward.join('|'));
});

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
