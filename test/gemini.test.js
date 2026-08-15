/*
 * node test/gemini.test.js
 * Exercises the Gemini fallback with fabricated model responses — prompt shape,
 * colour-word parsing, cube checking and model choice. No key, no network.
 */
var Cube = require('../js/cube.js');
var A = require('../js/assemble.js');
var G = require('../tools/gemini.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var NAMES = G.COLOR_NAMES;

/** A model-style response for a cube laid out photo-by-photo. */
function responseFrom(colors, tweak) {
  var photos = [];
  for (var f = 0; f < 6; f++) {
    var stickers = [];
    for (var i = 0; i < 9; i++) stickers.push(NAMES[colors[f * 9 + i]]);
    photos.push({ photo: f + 1, stickers: stickers, uncertain: [] });
  }
  var payload = { photos: photos };
  if (tweak) tweak(payload);
  return payload;
}

function solvedColors() {
  var s = new Int8Array(54);
  var faceColor = [0, 4, 2, 1, 5, 3]; // U R F D L B
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}
function scrambledColors() { return Cube.applySeq(solvedColors(), Cube.randomScramble(25)); }

console.log('\nprompt');
var prompt = G.buildPrompt(6);
check('says the photos are unordered and may be any way up',
  /no\s*\n?particular order/i.test(prompt) && /any way up/i.test(prompt));
check('tells it not to guess which face is which', /not try to work out which face/i.test(prompt));
check('states the reading order', /top-left/.test(prompt) && /bottom-right/.test(prompt));
check('warns about the red/orange trap', /orange/i.test(prompt) && /red/i.test(prompt));
check('lists only the six legal color words', NAMES.every(function (n) { return prompt.indexOf(n) >= 0; }));

console.log('\nparsing');
check('reads back a cube exactly', (function () {
  for (var t = 0; t < 40; t++) {
    var truth = scrambledColors();
    var parsed = G.parsePhotos(responseFrom(truth));
    if (parsed.problems.length) return false;
    for (var i = 0; i < 54; i++) if (parsed.colors[i] !== truth[i]) return false;
  }
  return true;
})());

check('uses the stated photo number, not the arrival order', (function () {
  var truth = scrambledColors();
  var payload = responseFrom(truth);
  payload.photos.reverse();                       // same data, shuffled on the wire
  var parsed = G.parsePhotos(payload);
  if (parsed.problems.length) return false;
  for (var i = 0; i < 54; i++) if (parsed.colors[i] !== truth[i]) return false;
  return true;
})());

check('accepts sloppy color words', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) {
    p.photos[0].stickers = p.photos[0].stickers.map(function () { return ' White '; });
  }));
  return !parsed.problems.length && parsed.colors[0] === 0;
})());

check('rejects an unknown color word', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) { p.photos[2].stickers[3] = 'turquoise'; }));
  return parsed.problems.length > 0 && parsed.colors === null;
})());

check('rejects a short face', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) { p.photos[1].stickers.pop(); }));
  return parsed.problems.some(function (m) { return /8 stickers/.test(m); });
})());

check('rejects a missing photo', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) { p.photos.splice(4, 1); }));
  return parsed.problems.some(function (m) { return /photo 5 is missing/.test(m); });
})());

check('rejects a duplicated photo number', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) { p.photos[3] = p.photos[0]; }));
  return parsed.problems.some(function (m) { return /twice/.test(m); });
})());

check('rejects junk instead of an object', G.parsePhotos(null).problems.length > 0);

check('carries uncertain positions through', (function () {
  var parsed = G.parsePhotos(responseFrom(solvedColors(), function (p) { p.photos[2].uncertain = [0, 8]; }));
  return parsed.uncertain.indexOf(18) >= 0 && parsed.uncertain.indexOf(26) >= 0;
})());

console.log('\nchecking the reading is a real cube');
check('a real scramble passes', (function () {
  for (var t = 0; t < 30; t++) if (G.checkCube(scrambledColors()) !== null) return false;
  return true;
})());

check('it still passes when the photos were taken out of order and rotated', (function () {
  for (var t = 0; t < 20; t++) {
    var truth = scrambledColors();
    var order = [3, 5, 0, 4, 1, 2];
    var jumbled = new Int8Array(54);
    order.forEach(function (face, n) {
      var cells = [];
      for (var i = 0; i < 9; i++) cells.push(truth[face * 9 + i]);
      cells = A.rotateFace(cells, n % 4);
      for (var k = 0; k < 9; k++) jumbled[n * 9 + k] = cells[k];
    });
    if (G.checkCube(jumbled) !== null) return false;
    var built = G.toCube(jumbled);
    if (!built.ok) return false;
    for (var j = 0; j < 54; j++) if (built.colors[j] !== truth[j]) return false;
  }
  return true;
})());

check('miscounted colors are caught and named', (function () {
  var c = scrambledColors();
  var i = 0;
  while (i % 9 === 4) i++;
  c[i] = (c[i] + 1) % 6;
  var msg = G.checkCube(c);
  return msg !== null && /counts are wrong/.test(msg);
})());

check('a nine-of-each-but-impossible cube is caught', (function () {
  var c = scrambledColors();
  var a = 7, b = 19;                 // the two halves of one edge
  var t = c[a]; c[a] = c[b]; c[b] = t;
  var msg = G.checkCube(c);
  return msg !== null && /do not fit together/.test(msg);
})());

check('duplicate centers are caught', (function () {
  var c = solvedColors();
  var white = c[4], red = c[13];
  var donor = -1;
  for (var i = 0; i < 54; i++) if (i !== 4 && c[i] === white) { donor = i; break; }
  c[donor] = red;
  c[13] = white;
  var msg = G.checkCube(c);
  return msg !== null && /same colour in the middle/.test(msg);
})());

check('quota report lists all six colors', (function () {
  var report = G.quotaReport(solvedColors());
  return NAMES.every(function (n) { return report.indexOf(n + ': 9') >= 0; });
})());

console.log('\nmodel choice');
function models(list) {
  return list.map(function (n) { return { name: 'models/' + n, supportedGenerationMethods: ['generateContent'] }; });
}
check('prefers flash over pro', G.chooseModel(models(['gemini-2.5-pro', 'gemini-2.5-flash'])) === 'gemini-2.5-flash');
check('prefers the newer version', G.chooseModel(models(['gemini-1.5-flash', 'gemini-2.5-flash'])) === 'gemini-2.5-flash');
check('avoids the 8b variant', G.chooseModel(models(['gemini-1.5-flash-8b', 'gemini-1.5-flash'])) === 'gemini-1.5-flash');
check('skips embedding and media models',
  G.chooseModel(models(['text-embedding-004', 'imagen-3.0-generate', 'gemini-2.0-flash'])) === 'gemini-2.0-flash');
check('skips models that cannot generate content', (function () {
  var list = [
    { name: 'models/gemini-9.9-flash', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }
  ];
  return G.chooseModel(list) === 'gemini-2.0-flash';
})());
check('handles an unknown future naming scheme',
  G.chooseModel(models(['gemini-4.0-flash', 'gemini-3.5-flash', 'gemini-4.0-pro'])) === 'gemini-4.0-flash');
check('returns null when nothing is usable',
  G.chooseModel([]) === null && G.chooseModel(models(['text-embedding-004'])) === null);

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
})());

check('rejects image, tts, video and robotics variants', (function () {
  var bad = ['gemini-3.1-flash-image', 'gemini-3.1-flash-tts-preview', 'gemini-3.7-flash-video-understanding-eap',
    'gemini-robotics-er-2-preview', 'gemini-2.5-computer-use-preview-10-2025', 'gemma-4-31b-it',
    'nano-banana-pro-preview', 'lyria-3-pro-preview', 'gemini-omni-flash-preview'];
  return G.chooseModel(models(bad)) === null;
})());

check('prefers a full model over its lite sibling',
  G.chooseModel(models(['gemini-3.5-flash-lite', 'gemini-3.5-flash'])) === 'gemini-3.5-flash' &&
  G.chooseModel(models(['gemini-3.7-flash-lite', 'gemini-3.5-flash'])) === 'gemini-3.5-flash');

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
