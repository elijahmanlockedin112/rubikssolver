/*
 * node test/academy.test.js
 *
 * Academy mode is the beginner solution with teaching attached to it, and the
 * join between the two is by name: stage ids from solver.js, algorithm ids
 * from the tags macroSearch attaches. Neither side would complain if the other
 * renamed something — the panel would simply come up blank, on whichever
 * scramble happened to need that stage, which is not a thing anyone would
 * notice until a user did.
 *
 * So: solve real scrambles and check every stage and every algorithm that
 * comes out has teaching to go with it, and that the notation shown matches
 * the moves actually being made. That last one is the important one. A strip
 * that says "R U R' U R U2 R'" while the cube does something else is worse
 * than no strip at all — it teaches the wrong thing, confidently.
 */
var Cube = require('../js/cube.js');
var Solver = require('../js/solver.js');
var Academy = require('../js/academy.js');

var trials = parseInt(process.argv[2], 10) || 60;
var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

function randomScramble(n) {
  var faces = Cube.FACE_LETTERS, suffix = ['', "'", '2'], out = [], last = '';
  while (out.length < n) {
    var f = faces[(Math.random() * 6) | 0];
    if (f === last) continue;
    last = f;
    out.push(f + suffix[(Math.random() * 3) | 0]);
  }
  return out;
}

console.log('\nevery stage and algorithm has teaching attached');

check('the stage ids match solver.js exactly, in order',
  Solver.STAGES.map(function (s) { return s.id; }).join(',') ===
  Academy.STAGES.map(function (s) { return s.id; }).join(','),
  'solver: ' + Solver.STAGES.map(function (s) { return s.id; }).join(',') +
  ' / academy: ' + Academy.STAGES.map(function (s) { return s.id; }).join(','));

var missingText = Academy.STAGES.filter(function (s) {
  return !s.title || !s.goal || !s.look || !s.why;
});
check('every stage says what it is for, what to look for, and why',
  missingText.length === 0, missingText.map(function (s) { return s.id; }).join(', '));

var badAlg = Object.keys(Academy.ALGS).filter(function (id) {
  var a = Academy.ALGS[id];
  if (!a.name || !a.notation || !a.why) return true;
  // and the notation has to be moves this cube engine actually knows
  return a.notation.split(/\s+/).some(function (m) { return !Cube.MOVE_PERMS[m]; });
});
check('every algorithm has a name, real notation and a reason', badAlg.length === 0, badAlg.join(', '));

console.log('\npieces are named the way a person would name them');

/*
 * The first three stages place four pieces each, one at a time, and the solver
 * says which piece each run of moves is for. Without that, a learner sees
 * twenty-five moves with no way to tell where one piece ends and the next
 * begins — which is the difference between four things and a wall.
 */
var colourOf = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
function nameFace(letter) { return colourOf[letter]; }

check('an edge is named by its two colours',
  Academy.pieceLabel('DF', nameFace) === 'the yellow and green edge',
  Academy.pieceLabel('DF', nameFace));
check('a corner is named by its three',
  Academy.pieceLabel('DFR', nameFace) === 'the yellow, green and red corner',
  Academy.pieceLabel('DFR', nameFace));
check('a piece with no name at all is refused rather than half-named',
  Academy.pieceLabel('D', nameFace) === null && Academy.pieceLabel(null, nameFace) === null);

console.log('\nwhat the notation strip says is what the cube does');

var seenStages = {}, seenAlgs = {}, mismatches = 0, blanks = 0, checked = 0;
var untagged = {}, badPiece = 0;
// the stages that place pieces one at a time, and therefore name them
var PIECE_STAGES = { daisy: 1, cross: 1, corners: 1, middle: 1 };
for (var t = 0; t < trials; t++) {
  var state = Cube.applySeq(Cube.SOLVED, randomScramble(25));
  var result;
  try {
    result = Solver.solve(state);
  } catch (err) {
    check('scramble ' + t + ' solved', false, err.message);
    continue;
  }

  result.steps.forEach(function (step, i) {
    if (!Academy.stage(step.stage)) { seenStages[step.stage] = 'MISSING'; return; }
    seenStages[step.stage] = true;

    /*
     * Every move of the piece stages belongs to a piece. A step that
     * lost its tag shows up as a stage with no structure at all, which looks
     * exactly like the old behaviour and is the thing being prevented.
     */
    if (PIECE_STAGES[step.stage]) {
      if (!step.target) untagged[step.stage] = (untagged[step.stage] || 0) + 1;
      else if (!Academy.pieceLabel(step.target, nameFace)) badPiece++;
    }

    if (!step.alg) return;
    seenAlgs[step.alg] = true;

    var place = Academy.placeInAlg(result.steps, i);
    if (!place) { blanks++; return; }
    checked++;
    if (place.at < 0) { blanks++; return; }
    /*
     * The move the strip is pointing at has to be the move being made. This is
     * the assertion the whole file exists for: everything else is spelling.
     *
     * It matters most for the two middle-layer inserts, which are turned to
     * face whichever slot is being filled — so what is printed comes from the
     * moves rather than from the string in academy.js, and "U R U' R' U' F' U F"
     * over a cube doing U L U' L' U' B' U B would be teaching the wrong turns
     * while naming the right idea.
     */
    if (place.tokens[place.at] !== step.move) mismatches++;
  });
}

check('every stage that came up has teaching for it',
  Object.keys(seenStages).every(function (k) { return seenStages[k] === true; }),
  JSON.stringify(seenStages));
check('every stage of the method came up over ' + trials + ' scrambles',
  Object.keys(seenStages).length === Academy.STAGES.length,
  Object.keys(seenStages).join(','));
check('every algorithm the solver used is one Academy can name',
  Object.keys(seenAlgs).every(function (k) { return !!Academy.alg(k); }),
  Object.keys(seenAlgs).join(','));
check('the highlighted move is the move being made, every time',
  mismatches === 0, mismatches + ' of ' + checked + ' pointed at the wrong turn');
check('no algorithm move was left without a place in its algorithm',
  blanks === 0, blanks + ' had no position');
check('every move of a piece stage says which piece it is for',
  Object.keys(untagged).length === 0, JSON.stringify(untagged));
check('every piece the solver names can be named back',
  badPiece === 0, badPiece + ' pieces had no readable name');
check('the middle layer is taught as the two inserts, not as loose moves',
  !!seenAlgs.rightinsert || !!seenAlgs.leftinsert,
  'neither insert was tagged over ' + trials + ' scrambles');

console.log('  algorithms exercised: ' + Object.keys(seenAlgs).sort().join(', '));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
