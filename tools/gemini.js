/*
 * gemini.js — everything about the Gemini scan except the network call.
 *
 * Kept free of I/O so the prompt, the parsing, the color mapping and the
 * validate-and-retry logic can be tested without a key (see test/gemini.test.js).
 */
var Cube = require('../js/cube.js');

// Display palette order used everywhere in the app.
var COLOR_NAMES = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];
var FACE_LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];
var FACE_WORDS = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };

// Tolerate the obvious synonyms a model might reach for.
var ALIASES = {
  white: 0, w: 0, cream: 0, silver: 0, grey: 0, gray: 0,
  yellow: 1, y: 1, gold: 1,
  green: 2, g: 2, lime: 2,
  blue: 3, b: 3, navy: 3, cyan: 3,
  red: 4, r: 4, crimson: 4, maroon: 4, pink: 4,
  orange: 5, o: 5, amber: 5, peach: 5
};

function colorToIndex(name) {
  if (typeof name !== 'string') return -1;
  var key = name.trim().toLowerCase().replace(/[^a-z]/g, '');
  return ALIASES[key] === undefined ? -1 : ALIASES[key];
}

var RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    faces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          face: { type: 'string', enum: FACE_LETTERS },
          stickers: { type: 'array', items: { type: 'string', enum: COLOR_NAMES } },
          uncertain: { type: 'array', items: { type: 'integer' } }
        },
        required: ['face', 'stickers']
      }
    }
  },
  required: ['faces']
};

function buildPrompt(faceOrder) {
  var lines = faceOrder.map(function (letter, i) {
    return '  Image ' + (i + 1) + ' = the ' + FACE_WORDS[letter].toUpperCase() +
      ' face (report it as "' + letter + '").';
  });
  return [
    'You are reading the sticker colors off a 3x3 Rubik\'s cube.',
    '',
    'There are six photos, each showing one face straight on, already the right way up:',
    lines.join('\n'),
    '',
    'For each photo, report the 9 sticker colors in reading order: top-left, top-middle,',
    'top-right, middle-left, center, middle-right, bottom-left, bottom-middle, bottom-right,',
    'exactly as the stickers appear in that photo. Do not rotate or mirror anything.',
    '',
    'Rules:',
    '- Use only these color names: ' + COLOR_NAMES.join(', ') + '.',
    '- A complete cube has exactly 9 stickers of each color, 54 in total.',
    '- The center sticker of each face never moves, so the six centers are six different colors.',
    '- Judge each color against the other stickers in the same photo, not against an absolute',
    '  idea of the color. Warm indoor light makes white look cream and can push red toward orange.',
    '- Red and orange are the pair people get wrong: orange is noticeably lighter and more yellow.',
    '  Compare them side by side across all six photos before deciding.',
    '- Ignore glare, shadows, the black plastic between stickers, and anything behind the cube.',
    '- List the 0-based positions you are genuinely unsure about in "uncertain".'
  ].join('\n');
}

/**
 * Turn the model's JSON into 54 palette indices.
 * Returns { colors, uncertain, problems } — problems is non-empty when the
 * answer was structurally wrong (missing faces, bad color words, wrong count).
 */
function parseFaces(payload) {
  var problems = [];
  var colors = new Int8Array(54).fill(-1);
  var uncertain = [];

  var faces = payload && payload.faces;
  if (!Array.isArray(faces)) return { colors: null, uncertain: [], problems: ['no "faces" array in the response'] };

  var seen = {};
  faces.forEach(function (entry) {
    var letter = entry && typeof entry.face === 'string' ? entry.face.trim().toUpperCase() : '';
    var face = FACE_LETTERS.indexOf(letter);
    if (face < 0) { problems.push('unknown face "' + (entry && entry.face) + '"'); return; }
    if (seen[letter]) { problems.push('face ' + letter + ' reported twice'); return; }
    seen[letter] = true;

    var stickers = entry.stickers;
    if (!Array.isArray(stickers) || stickers.length !== 9) {
      problems.push('face ' + letter + ' has ' + (Array.isArray(stickers) ? stickers.length : 0) + ' stickers instead of 9');
      return;
    }
    for (var i = 0; i < 9; i++) {
      var idx = colorToIndex(stickers[i]);
      if (idx < 0) { problems.push('face ' + letter + ' position ' + i + ' is not a cube color ("' + stickers[i] + '")'); continue; }
      colors[face * 9 + i] = idx;
    }
    if (Array.isArray(entry.uncertain)) {
      entry.uncertain.forEach(function (pos) {
        if (typeof pos === 'number' && pos >= 0 && pos < 9) uncertain.push(face * 9 + pos);
      });
    }
  });

  FACE_LETTERS.forEach(function (letter) {
    if (!seen[letter]) problems.push('face ' + letter + ' is missing');
  });
  for (var k = 0; k < 54; k++) if (colors[k] < 0 && !problems.length) problems.push('sticker ' + k + ' was never given a color');

  return { colors: problems.length ? null : colors, uncertain: uncertain, problems: problems };
}

/** Counts per color, for telling the model what it got wrong. */
function quotaReport(colors) {
  var counts = [0, 0, 0, 0, 0, 0];
  for (var i = 0; i < 54; i++) if (colors[i] >= 0) counts[colors[i]]++;
  return counts.map(function (n, i) { return COLOR_NAMES[i] + ': ' + n; }).join(', ');
}

/**
 * Is this a cube that could actually exist? Returns null when fine, or a
 * sentence to hand back to the model when not.
 */
function checkCube(colors) {
  var counts = [0, 0, 0, 0, 0, 0];
  for (var i = 0; i < 54; i++) counts[colors[i]]++;
  for (var c = 0; c < 6; c++) {
    if (counts[c] !== 9) {
      return 'The counts are wrong (' + quotaReport(colors) + '). Every color must appear exactly 9 times.';
    }
  }
  var solverState = Cube.toSolverSpace(colors);
  if (!solverState) return 'Two faces were given the same center color. The six centers must all differ.';
  var verdict = Cube.validate(solverState);
  return verdict.ok ? null : 'That is not a physically possible cube: ' + verdict.message;
}

/** Which stickers do the two readers disagree about? */
function crossCheck(a, b) {
  var out = [];
  if (!a || !b) return out;
  for (var i = 0; i < 54; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/**
 * Pick a model from the API's own list, so nothing here depends on a
 * hardcoded name that may have been retired. Prefers a current flash model.
 */
function chooseModel(models) {
  var usable = (models || []).filter(function (m) {
    var methods = m.supportedGenerationMethods || m.supported_generation_methods || [];
    if (methods.indexOf('generateContent') < 0) return false;
    var name = String(m.name || '').replace(/^models\//, '');
    return !/embedding|aqa|imagen|veo|tts|audio|image-generation|learnlm/i.test(name);
  }).map(function (m) { return String(m.name).replace(/^models\//, ''); });

  if (!usable.length) return null;

  function score(name) {
    var s = 0;
    if (/flash/i.test(name)) s += 100;
    else if (/pro/i.test(name)) s += 60;
    if (/-8b/i.test(name)) s -= 40;          // cheap but weaker at fine color work
    if (/preview|exp/i.test(name)) s -= 15;  // prefer stable when versions tie
    if (/lite/i.test(name)) s -= 20;
    if (/latest/i.test(name)) s += 5;
    var version = name.match(/(\d+)\.(\d+)/);
    if (version) s += parseInt(version[1], 10) * 10 + parseInt(version[2], 10);
    else {
      var major = name.match(/gemini-(\d+)/);
      if (major) s += parseInt(major[1], 10) * 10;
    }
    return s;
  }

  usable.sort(function (x, y) { return score(y) - score(x); });
  return usable[0];
}

module.exports = {
  COLOR_NAMES: COLOR_NAMES,
  FACE_LETTERS: FACE_LETTERS,
  RESPONSE_SCHEMA: RESPONSE_SCHEMA,
  buildPrompt: buildPrompt,
  parseFaces: parseFaces,
  checkCube: checkCube,
  crossCheck: crossCheck,
  quotaReport: quotaReport,
  chooseModel: chooseModel,
  colorToIndex: colorToIndex
};
