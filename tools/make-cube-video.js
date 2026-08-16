/*
 * make-cube-video.js — a fake camera, for testing the scanner without a camera.
 *
 * Chromium will read its webcam from a raw Y4M file
 * (--use-file-for-fake-video-capture), which is the only way to drive the whole
 * scanner — getUserMedia, the live loop, auto-capture, the six faces, the
 * assembler — in an automated test on a machine with no cube in front of it.
 *
 * What comes out is six faces of an actually scrambled cube, each held up with
 * a little hand tremor, with a blank moment in between where the cube is being
 * turned over. Chromium loops the file, so a video that ends still works if the
 * scanner is slower than expected.
 *
 * It is not a camera. There is no lens blur, no rolling shutter, no exposure
 * hunting and no JPEG. What it does prove is that the parts are wired together
 * and that auto-capture fires once per face rather than never or six times.
 * How it behaves on real frames is test/MOBILE-CHECKLIST.md's problem.
 */
var fs = require('fs');
var CubeN = require('../js/cuben.js');

// the same six the palette in app.js uses
var BASE = [
  [238, 238, 236], [247, 209, 58], [22, 152, 82],
  [22, 82, 178], [198, 40, 54], [232, 126, 34]
];

var W = 480, H = 360, FPS = 10;

function renderFace(cells, o) {
  var n = o.N, buf = Buffer.alloc(W * H * 3);
  var cos = Math.cos(-o.angle), sin = Math.sin(-o.angle), gap = 0.1, plastic = [26, 26, 28];
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var rgb;
      if (o.blank) {
        rgb = [118, 116, 122];
      } else {
        var dx = (x - o.cx) / o.scale, dy = (y - o.cy) / o.scale;
        var u = dx * cos - dy * sin + n / 2, v = dx * sin + dy * cos + n / 2;
        if (u >= 0 && u < n && v >= 0 && v < n) {
          var col = Math.floor(u), row = Math.floor(v), fu = u - col, fv = v - row;
          rgb = (fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap) ? plastic : BASE[cells[row * n + col]];
        } else {
          rgb = [118, 116, 122];
        }
      }
      var light = 1 - 0.16 * (x / W * 0.6 + y / H * 0.4);
      var i = (y * W + x) * 3;
      for (var c = 0; c < 3; c++) {
        buf[i + c] = Math.max(0, Math.min(255, rgb[c] * light + (Math.random() - 0.5) * 8));
      }
    }
  }
  return buf;
}

/** Y4M carries planar YUV, so the frame has to be converted on the way out. */
function toI420(rgb) {
  var ySize = W * H, half = W >> 1, cSize = half * (H >> 1);
  var out = Buffer.alloc(ySize + cSize * 2);
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 3;
      out[y * W + x] = Math.max(16, Math.min(235,
        0.257 * rgb[i] + 0.504 * rgb[i + 1] + 0.098 * rgb[i + 2] + 16));
    }
  }
  for (var cy = 0; cy < (H >> 1); cy++) {
    for (var cx = 0; cx < half; cx++) {
      var r = 0, g = 0, b = 0;
      for (var dy = 0; dy < 2; dy++) {
        for (var dx = 0; dx < 2; dx++) {
          var j = ((cy * 2 + dy) * W + (cx * 2 + dx)) * 3;
          r += rgb[j]; g += rgb[j + 1]; b += rgb[j + 2];
        }
      }
      r /= 4; g /= 4; b /= 4;
      out[ySize + cy * half + cx] = Math.max(16, Math.min(240, -0.148 * r - 0.291 * g + 0.439 * b + 128));
      out[ySize + cSize + cy * half + cx] = Math.max(16, Math.min(240, 0.439 * r - 0.368 * g - 0.071 * b + 128));
    }
  }
  return out;
}

/**
 * Write a Y4M of a cube being shown to a camera.
 *
 * opts.size   2, 3 or 4
 * opts.oneFace  show face one and never turn it — the double-capture case
 */
function write(file, opts) {
  var N = opts.size, per = N * N;
  var cube = CubeN.of(N);
  var state = cube.applySeq(cube.SOLVED, cube.randomScramble(30));
  var faces = [];
  for (var f = 0; f < 6; f++) faces.push(Array.prototype.slice.call(state.slice(f * per, (f + 1) * per)));

  // one face, never turned: no blank moments either, so nothing but the colours
  // can tell the scanner it is still looking at what it already has
  if (opts.oneFace) faces = [faces[0], faces[0], faces[0], faces[0], faces[0], faces[0]];
  var hold = opts.oneFace ? 22 : 16;      // looks are 180ms; 16 frames at 10fps is 1.6s
  var blank = opts.oneFace ? 0 : 6;

  var chunks = [Buffer.from('YUV4MPEG2 W' + W + ' H' + H + ' F' + FPS + ':1 Ip A1:1 C420mpeg2\n', 'ascii')];
  var frames = 0;
  function push(buf) {
    chunks.push(Buffer.from('FRAME\n', 'ascii'));
    chunks.push(toI420(buf));
    frames++;
  }

  faces.forEach(function (cells) {
    for (var k = 0; k < hold; k++) {
      push(renderFace(cells, {
        N: N, angle: 0.06 + (Math.random() - 0.5) * 0.03,
        scale: 48 * (1 + (Math.random() - 0.5) * 0.02),
        cx: 240 + (Math.random() - 0.5) * 3, cy: 180 + (Math.random() - 0.5) * 3
      }));
    }
    for (k = 0; k < blank; k++) push(renderFace(cells, { N: N, angle: 0, scale: 48, cx: 240, cy: 180, blank: true }));
  });

  fs.writeFileSync(file, Buffer.concat(chunks));
  return { file: file, frames: frames, seconds: frames / FPS, faces: faces };
}

module.exports = { write: write, WIDTH: W, HEIGHT: H, FPS: FPS };

if (require.main === module) {
  var out = process.argv[2];
  var info = write(out, { size: +(process.argv[3] || 3), oneFace: process.argv[4] === 'one' });
  console.log('wrote ' + out + ' — ' + info.frames + ' frames, ' + info.seconds.toFixed(1) + 's');
}
