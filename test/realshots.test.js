/*
 * node test/realshots.test.js
 *
 * Replays the actual camera frames in testdata/ through the detector.
 *
 * The synthetic tests all passed while the scanner did not work on a real cube
 * even once, so these frames — a stickerless cube, handheld, indoor light,
 * a keyboard and a hand in shot — are the ones that count. They are gitignored
 * (they are photos of someone's desk), so this skips itself when they are
 * absent rather than failing.
 */
var fs = require('fs');
var path = require('path');
var D = require('../js/detect.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var dir = path.join(__dirname, '..', 'testdata');
var frames = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); })
  : [];

console.log('\nreal camera frames');
if (!frames.length) {
  console.log('  skipped: no frames in testdata/\n');
  process.exit(0);
}

var detected = 0;
frames.forEach(function (name) {
  var raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  var img = { width: raw.width, height: raw.height, data: Buffer.from(raw.data, 'base64') };
  var out = D.detectFace(img);
  var ok = !!out && !out.failed;
  if (ok) detected++;
  console.log('  ' + (ok ? 'found ' : 'missed') + '  ' + name.replace(/^shot-|\.json$/g, ''));
});

// Handheld shots include the odd blurred one; most must read.
check('most real frames are read', detected >= Math.ceil(frames.length * 0.75),
  detected + '/' + frames.length);

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
