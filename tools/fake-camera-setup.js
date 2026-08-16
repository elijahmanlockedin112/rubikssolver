/*
 * Builds the fake-camera videos before playwright.camera.config.js runs.
 *
 * They go in the OS temp directory rather than the repo: about 34MB each, four
 * of them, and regenerating takes a couple of seconds. Existing files are
 * reused, so a repeated run does not pay for them again — delete the directory
 * to get a different scramble.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var video = require('./make-cube-video.js');

var dir = path.join(os.tmpdir(), 'cube-coach-fake-camera');

var WANTED = [
  { file: 'cube3.y4m', size: 3 },
  { file: 'cube2.y4m', size: 2 },
  { file: 'cube4.y4m', size: 4 },
  // centre-less sizes only: see playwright.camera.config.js for why a 3x3
  // held in front of the camera proves nothing about the rearm
  { file: 'one2.y4m', size: 2, oneFace: true },
  { file: 'one4.y4m', size: 4, oneFace: true }
];

module.exports = function () {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  WANTED.forEach(function (want) {
    var full = path.join(dir, want.file);
    if (fs.existsSync(full) && fs.statSync(full).size > 1e6) return;
    var info = video.write(full, want);
    console.log('  fake camera: ' + want.file + ' — ' + info.frames + ' frames, ' +
      info.seconds.toFixed(1) + 's of a ' + want.size + 'x' + want.size);
  });
};
