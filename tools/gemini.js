/*
 * gemini.js — everything about the Gemini scan except the network call.
 *
 * Kept free of I/O so the prompt, the parsing, the color mapping and the
 * validate-and-retry logic can be tested without a key (see test/gemini.test.js).
 */
var Cube = require('../js/cube.js');
var Assemble = require('../js/assemble.js');

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
    photos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          photo: { type: 'integer' },
          stickers: { type: 'array', items: { type: 'string', enum: COLOR_NAMES } },
          uncertain: { type: 'array', items: { type: 'integer' } }
        },
        required: ['photo', 'stickers']
      }
    }
  },
  required: ['photos']
};

/**
 * The photos are in no particular order and each may be turned any way up —
 * which face is which, and which way round, is worked out afterwards from the
 * centre colours and from what assembles into a real cube. So all this asks
 * for is nine colours per photo, exactly as they appear.
 */
function buildPrompt(count) {
  count = count || 6;
  return [
    'You are reading the sticker colors off a 3x3 Rubik\'s cube.',
    '',
    'There are ' + count + ' photos, each showing one face of the same cube. They are in no',
    'particular order, and each may be turned any way up — that is fine and expected, and is',
    'sorted out later. Do not try to work out which face is which, and do not reorder anything.',
    '',
    'The photos are handheld, so a face may be tilted, off-centre, lit unevenly, or small in',
    'the frame, and part of a neighbouring face may be visible down one side. Find the face',
    'that is pointing at the camera and read only that one.',
    '',
    'For each photo, report the 9 sticker colors in reading order: top-left, top-middle,',
    'top-right, middle-left, center, middle-right, bottom-left, bottom-middle, bottom-right,',
    'and give its 1-based position in the list as "photo". Rows and columns are the cube\'s own,',
    'so follow the tilt of the cube rather than the edges of the photo.',
    '',
    'Rules:',
    '- Use only these color names: ' + COLOR_NAMES.join(', ') + '.',
    '- A complete cube has exactly 9 stickers of each color, 54 in total.',
    '- The center sticker of each face never moves, so the six centers are six different colors.',
    '- Judge each color against the other stickers in the same photo, not against an absolute',
    '  idea of the color. Warm indoor light makes white look cream and can push red toward orange.',
    '- Red and orange are the pair people get wrong: orange is noticeably lighter and more yellow.',
    '  Compare them side by side across all the photos before deciding.',
    '- Ignore glare, shadows, the black plastic between stickers, and anything behind the cube.',
    '- List the 0-based positions you are genuinely unsure about in "uncertain".'
  ].join('\n');
}

/**
 * Turn the model's JSON into 54 palette indices, laid out in the order the
 * photos were taken (photo * 9 + cell) — not in cube order, which is decided
 * later by the assembler.
 * Returns { colors, uncertain, problems }.
 */
function parsePhotos(payload, count) {
  count = count || 6;
  var problems = [];
  var colors = new Int8Array(count * 9).fill(-1);
  var uncertain = [];

  var photos = payload && (payload.photos || payload.faces);
  if (!Array.isArray(photos)) {
    return { colors: null, uncertain: [], problems: ['no "photos" array in the response'] };
  }

  var seen = {};
  photos.forEach(function (entry, position) {
    // trust the stated number, fall back to the order it arrived in
    var index = entry && typeof entry.photo === 'number' ? Math.round(entry.photo) - 1 : position;
    if (!(index >= 0 && index < count)) { problems.push('photo number ' + (entry && entry.photo) + ' is out of range'); return; }
    if (seen[index]) { problems.push('photo ' + (index + 1) + ' reported twice'); return; }
    seen[index] = true;

    var stickers = entry.stickers;
    if (!Array.isArray(stickers) || stickers.length !== 9) {
      problems.push('photo ' + (index + 1) + ' has ' + (Array.isArray(stickers) ? stickers.length : 0) + ' stickers instead of 9');
      return;
    }
    for (var i = 0; i < 9; i++) {
      var idx = colorToIndex(stickers[i]);
      if (idx < 0) { problems.push('photo ' + (index + 1) + ' position ' + i + ' is not a cube color ("' + stickers[i] + '")'); continue; }
      colors[index * 9 + i] = idx;
    }
    if (Array.isArray(entry.uncertain)) {
      entry.uncertain.forEach(function (pos) {
        if (typeof pos === 'number' && pos >= 0 && pos < 9) uncertain.push(index * 9 + pos);
      });
    }
  });

  for (var p = 0; p < count; p++) if (!seen[p]) problems.push('photo ' + (p + 1) + ' is missing');
  for (var k = 0; k < colors.length; k++) {
    if (colors[k] < 0 && !problems.length) problems.push('sticker ' + k + ' was never given a color');
  }

  return { colors: problems.length ? null : colors, uncertain: uncertain, problems: problems };
}

/** Counts per color, for telling the model what it got wrong. */
function quotaReport(colors) {
  var counts = [0, 0, 0, 0, 0, 0];
  for (var i = 0; i < 54; i++) if (colors[i] >= 0) counts[colors[i]]++;
  return counts.map(function (n, i) { return COLOR_NAMES[i] + ': ' + n; }).join(', ');
}

/**
 * Could these readings be a real cube? The photos are unordered and unaligned,
 * so this hands them to the same assembler the on-device reader uses: it tries
 * every way the six faces could fit together and reports whether any of them
 * is a physically possible cube.
 * Returns null when fine, or a sentence to hand back to the model when not.
 */
function checkCube(colors) {
  var counts = [0, 0, 0, 0, 0, 0];
  for (var i = 0; i < colors.length; i++) counts[colors[i]]++;
  for (var c = 0; c < 6; c++) {
    if (counts[c] !== 9) {
      return 'The counts are wrong (' + quotaReport(colors) + '). Every color must appear exactly 9 times.';
    }
  }
  var built = Assemble.assembleFromColors(colors);
  return built.ok ? null : built.message;
}

/** Assemble a set of readings into cube order. */
function toCube(colors) {
  return Assemble.assembleFromColors(colors);
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
// Families that are not general-purpose text+vision models, and specialised
// variants of ones that are. A name like "gemini-3.7-flash-video-understanding-eap"
// advertises the same family and version as the plain model but is tuned for
// something else entirely — reading nine stickers is not it.
var NOT_GENERAL_PURPOSE = /(^|[-/])(gemma|lyria|imagen|veo|nano|antigravity|deep-research|learnlm|robotics)|embedding|aqa|(^|-)(tts|audio|live|omni)(-|$)|-image(-|$)|computer-use|video|customtools|-eap(-|$)|thinking/i;

/** The usable models, best first. */
function rankModels(models) {
  var usable = (models || []).filter(function (m) {
    var methods = m.supportedGenerationMethods || m.supported_generation_methods || [];
    if (methods.indexOf('generateContent') < 0) return false;
    return !NOT_GENERAL_PURPOSE.test(String(m.name || '').replace(/^models\//, ''));
  }).map(function (m) { return String(m.name).replace(/^models\//, ''); });

  function score(name) {
    var s = 0;
    if (/flash/i.test(name)) s += 100;       // fast and cheap is the right trade here
    else if (/pro/i.test(name)) s += 60;
    if (/lite/i.test(name)) s -= 50;         // noticeably weaker at fine color work
    if (/-8b/i.test(name)) s -= 40;
    if (/preview|exp/i.test(name)) s -= 15;  // prefer stable when versions tie
    if (/latest/i.test(name)) s += 5;
    var version = name.match(/(\d+)\.(\d+)/);
    if (version) s += parseInt(version[1], 10) * 10 + parseInt(version[2], 10);
    else {
      var major = name.match(/gemini-(\d+)(?!\d)/);
      if (major) s += parseInt(major[1], 10) * 10;
    }
    return s;
  }

  usable.sort(function (x, y) { return score(y) - score(x); });
  return usable;
}

function chooseModel(models) {
  var ranked = rankModels(models);
  return ranked.length ? ranked[0] : null;
}

/**
 * Upstream hiccups worth retrying or working around by switching model —
 * as opposed to "your key is invalid", where trying again is pointless.
 */
function isTransientFailure(message) {
  return /high demand|overload|try again|unavailable|temporarily|rate.?limit|exhausted|timeout|timed out|\b(429|500|502|503|504)\b/i
    .test(String(message || ''));
}

module.exports = {
  COLOR_NAMES: COLOR_NAMES,
  FACE_LETTERS: FACE_LETTERS,
  RESPONSE_SCHEMA: RESPONSE_SCHEMA,
  buildPrompt: buildPrompt,
  parsePhotos: parsePhotos,
  checkCube: checkCube,
  toCube: toCube,
  crossCheck: crossCheck,
  quotaReport: quotaReport,
  chooseModel: chooseModel,
  rankModels: rankModels,
  isTransientFailure: isTransientFailure,
  colorToIndex: colorToIndex
};
