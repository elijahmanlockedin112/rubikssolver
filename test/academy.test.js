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

check('the seven stage ids match solver.js exactly',
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

console.log('\nwhat the notation strip says is what the cube does');

var seenStages = {}, seenAlgs = {}, mismatches = 0, blanks = 0, checked = 0;
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
    if (!step.alg) return;
    seenAlgs[step.alg] = true;

    var place = Academy.placeInAlg(result.steps, i);
    if (!place) { blanks++; return; }
    checked++;
    if (place.at < 0) { blanks++; return; }
    /*
     * The move the strip is pointing at has to be the move being made. This is
     * the assertion the whole file exists for: everything else is spelling.
     */
    var token = place.alg.notation.split(/\s+/)[place.at];
    if (token !== step.move) mismatches++;
  });
}

check('every stage that came up has teaching for it',
  Object.keys(seenStages).every(function (k) { return seenStages[k] === true; }),
  JSON.stringify(seenStages));
check('all seven stages came up over ' + trials + ' scrambles',
  Object.keys(seenStages).length === 7, Object.keys(seenStages).join(','));
check('every algorithm the solver used is one Academy can name',
  Object.keys(seenAlgs).every(function (k) { return !!Academy.alg(k); }),
  Object.keys(seenAlgs).join(','));
check('the highlighted move is the move being made, every time',
  mismatches === 0, mismatches + ' of ' + checked + ' pointed at the wrong turn');
check('no algorithm move was left without a place in its algorithm',
  blanks === 0, blanks + ' had no position');

console.log('  algorithms exercised: ' + Object.keys(seenAlgs).sort().join(', '));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
