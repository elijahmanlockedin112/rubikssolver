/*
 * node test/gemini.test.js
 * Exercises the Gemini scan layer with fabricated model responses — prompt
 * shape, color-word parsing, cube validation, cross-checking and model choice.
 * No API key and no network needed.
 */
var Cube = require('../js/cube.js');
var G = require('../tools/gemini.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var NAMES = G.COLOR_NAMES;
var FACE_LETTERS = G.FACE_LETTERS;

// Build a model-style response from a real 54-sticker color state.
function responseFrom(colors, tweak) {
  var faces = FACE_LETTERS.map(function (letter, f) {
    var stickers = [];
    for (var i = 0; i < 9; i++) stickers.push(NAMES[colors[f * 9 + i]]);
    return { face: letter, stickers: stickers, uncertain: [] };
  });
  var payload = { faces: faces };
  if (tweak) tweak(payload);
  return payload;
}

function solvedColors() {
  var s = new Int8Array(54);
  var faceColor = [0, 4, 2, 1, 5, 3]; // U R F D L B
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}
function scrambledColors() {
  return Cube.applySeq(solvedColors(), Cube.randomScramble(25));
}

console.log('\nprompt');
var prompt = G.buildPrompt(['F', 'R', 'B', 'L', 'U', 'D']);
check('names every face in capture order',
  /Image 1 = the FRONT/.test(prompt) && /Image 5 = the TOP/.test(prompt) && /Image 6 = the BOTTOM/.test(prompt));
check('states the reading order', /top-left/.test(prompt) && /bottom-right/.test(prompt));
check('warns about the red\/orange trap', /orange/i.test(prompt) && /red/i.test(prompt));
check('lists only the six legal color words',
  NAMES.every(function (n) { return prompt.indexOf(n) >= 0; }));

console.log('\nparsing');
check('reads back a scrambled cube exactly', (function () {
  for (var t = 0; t < 40; t++) {
    var truth = scrambledColors();
    var parsed = G.parseFaces(responseFrom(truth));
    if (parsed.problems.length) return false;
    for (var i = 0; i < 54; i++) if (parsed.colors[i] !== truth[i]) return false;
  }
  return true;
})());

check('accepts sloppy color words', (function () {
  var truth = solvedColors();
  var parsed = G.parseFaces(responseFrom(truth, function (p) {
    p.faces[0].stickers = p.faces[0].stickers.map(function (c) { return ' White '; });
  }));
  return !parsed.problems.length && parsed.colors[0] === 0;
})());

check('rejects an unknown color word', (function () {
  var parsed = G.parseFaces(responseFrom(solvedColors(), function (p) { p.faces[2].stickers[3] = 'turquoise'; }));
  return parsed.problems.length > 0 && parsed.colors === null;
})());

check('rejects a short face', (function () {
  var parsed = G.parseFaces(responseFrom(solvedColors(), function (p) { p.faces[1].stickers.pop(); }));
  return parsed.problems.some(function (m) { return /8 stickers/.test(m); });
})());

check('rejects a missing face', (function () {
  var parsed = G.parseFaces(responseFrom(solvedColors(), function (p) { p.faces.splice(4, 1); }));
  return parsed.problems.some(function (m) { return /face L is missing/.test(m); });
})());

check('rejects a duplicated face', (function () {
  var parsed = G.parseFaces(responseFrom(solvedColors(), function (p) { p.faces[3] = p.faces[0]; }));
  return parsed.problems.some(function (m) { return /twice/.test(m); });
})());

check('rejects junk instead of an object', G.parseFaces(null).problems.length > 0);
check('carries uncertain positions through as facelet indices', (function () {
  var parsed = G.parseFaces(responseFrom(solvedColors(), function (p) { p.faces[2].uncertain = [0, 8]; }));
  return parsed.uncertain.indexOf(18) >= 0 && parsed.uncertain.indexOf(26) >= 0;
})());

console.log('\ncube validation of the reading');
check('a real scramble passes', (function () {
  for (var t = 0; t < 40; t++) if (G.checkCube(scrambledColors()) !== null) return false;
  return true;
})());

check('miscounted colors are caught and named', (function () {
  // Recolor one non-center sticker to something it definitely was not, so one
  // color ends up with ten and another with eight.
  var c = scrambledColors();
  var i = 0;
  while (i % 9 === 4) i++;
  c[i] = (c[i] + 1) % 6;
  var msg = G.checkCube(c);
  return msg !== null && /counts are wrong/.test(msg);
})());

check('a nine-of-each-but-impossible cube is caught', (function () {
  // swap one pair of stickers between two edges: counts stay right, cube does not
  var c = scrambledColors();
  var a = 7, b = 19;  // the two halves of one edge
  var t = c[a]; c[a] = c[b]; c[b] = t;
  var msg = G.checkCube(c);
  return msg !== null && /not a physically possible cube/.test(msg);
})());

check('duplicate centers are caught', (function () {
  // Keep nine of each color so the count check passes and the center check is
  // what actually fires: hand the right center's color to a stray white
  // sticker, and make that center white too.
  var c = solvedColors();
  var white = c[4], red = c[13];
  var donor = -1;
  for (var i = 0; i < 54; i++) if (i !== 4 && c[i] === white) { donor = i; break; }
  c[donor] = red;
  c[13] = white;
  var msg = G.checkCube(c);
  return msg !== null && /centers/.test(msg);
})());

check('quota report lists all six colors', (function () {
  var report = G.quotaReport(solvedColors());
  return NAMES.every(function (n) { return report.indexOf(n + ': 9') >= 0; });
})());

console.log('\ncross-check');
check('identical readings disagree nowhere', G.crossCheck(solvedColors(), solvedColors()).length === 0);
check('a single difference is reported once', (function () {
  var a = scrambledColors(), b = Int8Array.from(a);
  b[30] = (b[30] + 1) % 6;
  var diff = G.crossCheck(a, b);
  return diff.length === 1 && diff[0] === 30;
})());

console.log('\nmodel choice');
function models(list) {
  return list.map(function (n) { return { name: 'models/' + n, supportedGenerationMethods: ['generateContent'] }; });
}
check('prefers flash over pro', G.chooseModel(models(['gemini-2.5-pro', 'gemini-2.5-flash'])) === 'gemini-2.5-flash');
check('prefers the newer version', G.chooseModel(models(['gemini-1.5-flash', 'gemini-2.5-flash'])) === 'gemini-2.5-flash');
check('avoids the 8b variant', G.chooseModel(models(['gemini-1.5-flash-8b', 'gemini-1.5-flash'])) === 'gemini-1.5-flash');
check('skips embedding and media models', (function () {
  var picked = G.chooseModel(models(['text-embedding-004', 'imagen-3.0-generate', 'gemini-2.0-flash']));
  return picked === 'gemini-2.0-flash';
})());
check('skips models that cannot generate content', (function () {
  var list = [
    { name: 'models/gemini-9.9-flash', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
  ];
  return G.chooseModel(list) === 'gemini-2.0-flash';
})());
check('handles an unknown future naming scheme', (function () {
  var picked = G.chooseModel(models(['gemini-4.0-flash', 'gemini-3.5-flash', 'gemini-4.0-pro']));
  return picked === 'gemini-4.0-flash';
})());
check('returns null when nothing is usable', G.chooseModel([]) === null && G.chooseModel(models(['text-embedding-004'])) === null);

// A specialised variant advertises the same family and version as the plain
// model, so version alone must not win. This is the real list from a live key.
check('picks the plain flash model out of a real catalogue', (function () {
  var real = [
    'antigravity-preview-05-2026', 'deep-research-max-preview-04-2026', 'deep-research-pro-preview-12-2025',
    'gemini-2.5-computer-use-preview-10-2025', 'gemini-2.5-flash', 'gemini-2.5-flash-image',
    'gemini-2.5-flash-lite', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro', 'gemini-3-flash-preview',
    'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-tts-preview',
    'gemini-3.1-pro-preview', 'gemini-3.1-pro-preview-customtools', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
    'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.7-flash-video-understanding-eap', 'gemini-flash-latest',
    'gemini-flash-lite-latest', 'gemini-omni-flash-preview', 'gemini-pro-latest',
    'gemini-robotics-er-2-preview', 'gemma-4-31b-it', 'lyria-3-pro-preview', 'nano-banana-pro-preview'
  ];
  return G.chooseModel(models(real)) === 'gemini-3.7-flash';
})(), 'got ' + G.chooseModel(models([
  'gemini-3.7-flash', 'gemini-3.7-flash-video-understanding-eap', 'gemini-3.6-flash', 'gemini-flash-latest'
])));

check('rejects image, tts, video and robotics variants', (function () {
  var bad = ['gemini-3.1-flash-image', 'gemini-3.1-flash-tts-preview', 'gemini-3.7-flash-video-understanding-eap',
    'gemini-robotics-er-2-preview', 'gemini-2.5-computer-use-preview-10-2025', 'gemma-4-31b-it',
    'nano-banana-pro-preview', 'lyria-3-pro-preview', 'gemini-omni-flash-preview'];
  return G.chooseModel(models(bad)) === null;
})());

check('prefers a full model over its lite sibling', (function () {
  return G.chooseModel(models(['gemini-3.5-flash-lite', 'gemini-3.5-flash'])) === 'gemini-3.5-flash' &&
    G.chooseModel(models(['gemini-3.7-flash-lite', 'gemini-3.5-flash'])) === 'gemini-3.5-flash';
})());

check('ranks a usable fallback behind the first choice', (function () {
  var ranked = G.rankModels(models(['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']));
  return ranked[0] === 'gemini-3.7-flash' && ranked[1] === 'gemini-3.6-flash' && ranked.length === 3;
})());

console.log('\ntransient failures');
[
  'This model is currently experiencing high demand. Spikes in demand are usually temporary.',
  'The model is overloaded. Please try again later.',
  'Resource has been exhausted (e.g. check quota).',
  'got 503 from upstream',
  'request timed out'
].forEach(function (msg) {
  check('retryable: "' + msg.slice(0, 38) + '…"', G.isTransientFailure(msg));
});
[
  'API key not valid. Please pass a valid API key.',
  'Gemini returned malformed JSON',
  'permission denied'
].forEach(function (msg) {
  check('not retryable: "' + msg.slice(0, 38) + '"', !G.isTransientFailure(msg));
});

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
