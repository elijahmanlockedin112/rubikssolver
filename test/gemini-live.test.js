/*
 * node test/gemini-live.test.js
 *
 * End-to-end check against the real /api/scan endpoint: renders six synthetic
 * photos of a known scrambled cube, sends them, and compares what comes back
 * with the truth. This is the only test that proves the whole chain — prompt,
 * model, parsing, face order and sticker order — actually lines up.
 *
 * Skips itself (exit 0) when the server is not running or has no key, so it is
 * safe to leave in the suite. Costs one API call per run.
 */
var zlib = require('zlib');

var BASE_URL = process.env.SCAN_URL || 'http://localhost:8123';
var Cube = require('../js/cube.js');
var Assemble = require('../js/assemble.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// ---- minimal PNG writer (no dependencies) -------------------------------
var CRC_TABLE = (function () {
  var table = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgb) {
  var stride = width * 3;
  var raw = Buffer.alloc((stride + 1) * height);
  for (var y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- draw one cube face ---------------------------------------------------
var STICKER_RGB = [
  [242, 242, 240], [252, 213, 53], [0, 158, 84],
  [16, 76, 178], [200, 34, 51], [255, 128, 20]
];

function renderFace(colors, faceIndex, opts) {
  var S = 360, pad = 26, gap = 9;
  var body = [22, 22, 24];
  var buf = Buffer.alloc(S * S * 3);
  var bg = opts.bg || [46, 48, 54];
  for (var i = 0; i < S * S; i++) { buf[i * 3] = bg[0]; buf[i * 3 + 1] = bg[1]; buf[i * 3 + 2] = bg[2]; }

  function rect(x0, y0, w, h, rgb) {
    for (var y = Math.max(0, y0); y < Math.min(S, y0 + h); y++) {
      for (var x = Math.max(0, x0); x < Math.min(S, x0 + w); x++) {
        var o = (y * S + x) * 3;
        buf[o] = rgb[0]; buf[o + 1] = rgb[1]; buf[o + 2] = rgb[2];
      }
    }
  }

  var span = S - pad * 2;
  rect(pad - 8, pad - 8, span + 16, span + 16, body);
  var cell = (span - gap * 2) / 3;
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      var color = STICKER_RGB[colors[faceIndex * 9 + r * 3 + c]].slice();
      var shade = opts.shade || 1;
      color = color.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * shade))); });
      rect(Math.round(pad + c * (cell + gap)), Math.round(pad + r * (cell + gap)),
        Math.round(cell), Math.round(cell), color);
    }
  }
  return encodePng(S, S, buf);
}

// ---- a known cube ---------------------------------------------------------
function solvedColors() {
  var s = new Int8Array(54);
  var faceColor = [0, 4, 2, 1, 5, 3]; // U R F D L B -> white red green yellow orange blue
  for (var i = 0; i < 54; i++) s[i] = faceColor[(i / 9) | 0];
  return s;
}

var COLOR_NAMES = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];
var FACE_LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];
var CAPTURE_ORDER = [
  { face: 2, letter: 'F' }, { face: 1, letter: 'R' }, { face: 5, letter: 'B' },
  { face: 4, letter: 'L' }, { face: 0, letter: 'U' }, { face: 3, letter: 'D' }
];

function faceReport(truth, got, face) {
  var rows = [];
  for (var r = 0; r < 3; r++) {
    var line = [];
    for (var c = 0; c < 3; c++) {
      var i = face * 9 + r * 3 + c;
      line.push(got[i] === truth[i] ? COLOR_NAMES[truth[i]]
        : COLOR_NAMES[truth[i]] + '->' + COLOR_NAMES[got[i]] + '!');
    }
    rows.push('      ' + line.join(' '));
  }
  return FACE_LETTERS[face] + ':\n' + rows.join('\n');
}

(async function main() {
  console.log('\nlive scan (real API)');

  var status;
  try {
    status = await (await fetch(BASE_URL + '/api/status')).json();
  } catch (err) {
    console.log('  skipped: no server at ' + BASE_URL + ' (start it with `npm start`)\n');
    process.exitCode = 0; return;
  }
  if (!status.gemini) {
    console.log('  skipped: the server has no GEMINI_API_KEY set\n');
    process.exitCode = 0; return;
  }
  console.log('  model: ' + (status.model || '(chosen on first request)'));

  var truth = Cube.applySeq(solvedColors(), Cube.parse("R U R' U' F2 L D2 B' R F"));

  // Photograph the faces in a jumbled order, each turned a different way up —
  // exactly what the app now allows, and what the server has to undo.
  var order = [3, 5, 0, 4, 1, 2];
  var turns = [0, 1, 2, 3, 1, 0];
  var images = order.map(function (face, n) {
    var cells = [];
    for (var i = 0; i < 9; i++) cells.push(truth[face * 9 + i]);
    cells = Assemble.rotateFace(cells, turns[n]);
    var rotated = new Int8Array(54);
    for (var k = 0; k < 9; k++) rotated[face * 9 + k] = cells[k];
    // vary the lighting a little per photo, the way six real ones would
    var png = renderFace(rotated, face, { shade: 1 - n * 0.045, bg: [46 + n * 3, 48, 54] });
    return { photo: n + 1, mimeType: 'image/png', data: png.toString('base64') };
  });

  var started = Date.now();
  var res = await fetch(BASE_URL + '/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images: images })
  });
  var json = await res.json();
  var elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!res.ok) {
    check('the endpoint answered', false, JSON.stringify(json));
    console.log('\n1 FAILURE(S)\n');
    process.exitCode = 1; return;
  }

  console.log('  answered in ' + elapsed + 's after ' + json.rounds + ' round(s)' +
    (json.warning ? ' — warning: ' + json.warning : ''));

  check('returned an assembled cube', Array.isArray(json.cube) && json.cube.length === 54);
  if (!Array.isArray(json.cube) || json.cube.length !== 54) {
    console.log('\n1 FAILURE(S)\n');
    process.exitCode = 1; return;
  }

  var got = Int8Array.from(json.cube);
  var wrong = [];
  for (var i = 0; i < 54; i++) if (got[i] !== truth[i]) wrong.push(i);

  check('every sticker matches the cube that was drawn', wrong.length === 0,
    wrong.length + ' wrong at ' + wrong.join(','));

  var solverState = Cube.toSolverSpace(got);
  check('the reading is a solvable cube', !!solverState && Cube.validate(solverState).ok,
    solverState ? Cube.validate(solverState).message : 'centers clashed');

  if (wrong.length) {
    console.log('\n  what came back:');
    var faces = {};
    wrong.forEach(function (i) { faces[(i / 9) | 0] = true; });
    Object.keys(faces).forEach(function (f) { console.log('    ' + faceReport(truth, got, +f)); });
  }

  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
  process.exitCode = failures ? 1 : 0;
})();

