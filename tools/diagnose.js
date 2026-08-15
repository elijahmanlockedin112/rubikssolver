/*
 * node tools/diagnose.js [testdata/shot-....json]
 *
 * Runs the detector over frames saved by the scanner when it failed, and says
 * where it gave up. With no argument it does every frame in ./testdata.
 *
 * Also writes shot-....marked.png for each one: the mask the detector built,
 * with the blobs it considered outlined, which usually makes the problem
 * obvious at a glance.
 */
var fs = require('fs');
var path = require('path');
var Detect = require('../js/detect.js');
var Png = require('./png.js');

var dir = path.join(__dirname, '..', 'testdata');
var args = process.argv.slice(2);

var files = args.length ? args : (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).map(function (f) { return path.join(dir, f); })
  : []);

if (!files.length) {
  console.log('\nNo saved frames in testdata/.');
  console.log('Open the scanner and press Snap at your cube — every shot it cannot read');
  console.log('gets written there automatically.\n');
  process.exit(0);
}

files.forEach(function (file) {
  var raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  var img = {
    width: raw.width,
    height: raw.height,
    data: Buffer.from(raw.data, 'base64')
  };
  console.log('\n' + path.basename(file) + '  (' + img.width + 'x' + img.height + ')');

  var out = Detect.detectFace(img, { debug: true });
  var debug = out && out.debug;
  if (out && !out.failed) {
    console.log('  DETECTED — grid found, step ' + Math.round(out.step) + 'px');
    console.log('  colours: ' + out.samples.map(function (s) {
      return '(' + s.map(Math.round).join(',') + ')';
    }).join(' '));
  } else {
    console.log('  gave up: ' + (debug ? debug.stage : 'unknown'));
  }
  if (debug) {
    console.log('  working size ' + debug.size +
      ' | brightness cut ' + debug.brightnessCut +
      ' | edge cut ' + debug.edgeCut);
    console.log('  blobs ' + debug.blobs + ' -> sticker-shaped ' + debug.candidates +
      (debug.candidateAreas ? ' | biggest areas ' + debug.candidateAreas.join(',') : ''));
    if (debug.lattice) console.log('  lattice matched ' + debug.lattice.matched + '/9, step ' + debug.lattice.step);
    if (debug.flatness !== undefined) {
      console.log('  cell flatness ' + debug.flatness + ' (lower is flatter) -> passes: ' + debug.flatCheck);
    }
  }

  // A picture of what the detector actually had to work with.
  var marked = Detect.debugMask(img);
  if (marked) {
    var target = file.replace(/\.json$/, '.marked.png');
    fs.writeFileSync(target, Png.encodePng(marked.width, marked.height, marked.rgb));
    console.log('  wrote ' + path.basename(target));
  }
});

console.log('');
