/*
 * scan.js — read a cube's colors through the webcam.
 *
 * Six captures, one per face, in a fixed order with explicit "turn the cube
 * this way" instructions so each captured 3x3 grid lands on the right face of
 * the net without the user having to think about orientation.
 *
 * Color naming is deliberately relative: the six center stickers become the
 * reference swatches, and every other sticker is matched against those. That
 * survives warm lamps, dim rooms and off-brand cubes far better than fixed RGB
 * thresholds. A balanced assignment then forces exactly nine of each color.
 */
;(function (root) {
  'use strict';

  var SIZE = 360; // square working canvas

  // Capture order. Each step says how to hold the cube so the captured grid
  // maps straight onto that face's panel in the net.
  var STEPS = [
    { face: 2, name: 'Front', tip: 'Hold the cube with the top face up and point the FRONT face straight at the camera.' },
    { face: 1, name: 'Right', tip: 'Keep the top up. Turn the cube a quarter turn to your LEFT so the RIGHT face now faces the camera.' },
    { face: 5, name: 'Back', tip: 'Another quarter turn to your LEFT — now the BACK face faces the camera.' },
    { face: 4, name: 'Left', tip: 'One more quarter turn to your LEFT — now the LEFT face faces the camera.' },
    { face: 0, name: 'Top', tip: 'Go back to the starting position, then tip the cube forwards so the TOP face points at the camera (the front face ends up underneath).' },
    { face: 3, name: 'Bottom', tip: 'Starting position again, then tip the cube backwards so the BOTTOM face points at the camera (the front face ends up on top).' }
  ];

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  // Rough first guess, used for the live overlay and for naming the six
  // reference swatches. Palette order: white yellow green blue red orange.
  var IDEAL_HUE = [null, 52, 130, 215, 358, 28];

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function guessColor(rgb) {
    var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    if (hsv.s < 0.28) return 0; // washed out => white
    var best = 1, bestD = Infinity;
    for (var i = 1; i < 6; i++) {
      var d = hueDistance(hsv.h, IDEAL_HUE[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /**
   * Distance between two samples, tuned against synthetic bad lighting
   * (see test/scan.test.js). Brightness is deliberately ignored: each face is
   * photographed under its own light, so only hue and saturation carry
   * information that survives the trip between faces.
   */
  function colorCost(a, b) {
    var ha = rgbToHsv(a[0], a[1], a[2]), hb = rgbToHsv(b[0], b[1], b[2]);
    // when either sample is near-grey its hue is meaningless
    var greyness = Math.min(ha.s, hb.s);
    var hueTerm = hueDistance(ha.h, hb.h) * Math.min(1, greyness / 0.3);
    return hueTerm + Math.abs(ha.s - hb.s) * 55;
  }

  function Scanner(opts) {
    this.opts = opts || {};
    this.el = {
      modal: document.getElementById('scanner'),
      video: document.getElementById('scan-video'),
      canvas: document.getElementById('scan-canvas'),
      title: document.getElementById('scan-title'),
      tip: document.getElementById('scan-tip'),
      capture: document.getElementById('scan-capture'),
      undo: document.getElementById('scan-undo'),
      close: document.getElementById('scan-close'),
      message: document.getElementById('scan-message'),
      thumbs: document.getElementById('scan-thumbs')
    };
    this.ctx = this.el.canvas.getContext('2d', { willReadFrequently: true });
    this.el.canvas.width = SIZE;
    this.el.canvas.height = SIZE;
    this.samples = {};   // face -> array of 9 [r,g,b]
    this.step = 0;
    this.stream = null;

    var self = this;
    this.el.capture.onclick = function () { self.capture(); };
    this.el.undo.onclick = function () { self.undo(); };
    this.el.close.onclick = function () { self.close(true); };
  }

  Scanner.prototype.open = function () {
    var self = this;
    this.el.modal.hidden = false;
    this.step = 0;
    this.samples = {};
    this.renderStep();
    this.message('Starting the camera…');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.message('This browser will not give the page a camera. Fill the colors in by hand instead.', true);
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      self.stream = stream;
      self.el.video.srcObject = stream;
      self.el.video.play();
      self.message('');
      self.loop();
    }).catch(function (err) {
      self.message('No camera available (' + (err && err.name ? err.name : 'error') +
        '). If you opened this file directly, some browsers block the camera — fill the colors in by hand, or run it from a local server.', true);
    });
  };

  Scanner.prototype.close = function (cancelled) {
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
    cancelAnimationFrame(this.raf);
    this.el.modal.hidden = true;
    if (cancelled && this.opts.onCancel) this.opts.onCancel();
  };

  Scanner.prototype.message = function (text, isError) {
    this.el.message.textContent = text || '';
    this.el.message.className = 'message' + (isError ? ' error' : '');
  };

  Scanner.prototype.renderStep = function () {
    var step = STEPS[this.step];
    if (!step) return;
    this.el.title.textContent = 'Face ' + (this.step + 1) + ' of 6 — ' + step.name;
    this.el.tip.textContent = step.tip;
    this.el.capture.textContent = 'Capture the ' + step.name.toLowerCase() + ' face';
    this.el.undo.disabled = this.step === 0;

    var thumbs = this.el.thumbs;
    thumbs.innerHTML = '';
    for (var i = 0; i < STEPS.length; i++) {
      var dot = document.createElement('span');
      dot.className = 'scan-dot' + (i < this.step ? ' is-done' : i === this.step ? ' is-current' : '');
      dot.textContent = STEPS[i].name;
      thumbs.appendChild(dot);
    }
  };

  /** Continuously draw the center square of the video plus the guide grid. */
  Scanner.prototype.loop = function () {
    var self = this;
    var v = this.el.video, ctx = this.ctx;
    if (v.videoWidth) {
      var side = Math.min(v.videoWidth, v.videoHeight);
      var sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
      ctx.drawImage(v, sx, sy, side, side, 0, 0, SIZE, SIZE);

      var swatches = this.sample();
      var cell = SIZE / 3;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          ctx.strokeRect(c * cell + 6, r * cell + 6, cell - 12, cell - 12);
          var guess = guessColor(swatches[r * 3 + c]);
          ctx.fillStyle = (this.opts.palette || ['#fff', '#ff0', '#0a0', '#00f', '#f00', '#f80'])[guess];
          ctx.beginPath();
          ctx.arc(c * cell + cell / 2, r * cell + cell / 2, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        }
      }
    }
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };

  /** Average color of a small patch at the middle of each of the nine cells. */
  Scanner.prototype.sample = function () {
    var cell = SIZE / 3, patch = Math.round(cell * 0.3);
    var out = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var x = Math.round(c * cell + cell / 2 - patch / 2);
        var y = Math.round(r * cell + cell / 2 - patch / 2);
        var data = this.ctx.getImageData(x, y, patch, patch).data;
        var sr = 0, sg = 0, sb = 0, n = 0;
        for (var i = 0; i < data.length; i += 4) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++; }
        out.push([sr / n, sg / n, sb / n]);
      }
    }
    return out;
  };

  Scanner.prototype.capture = function () {
    if (!this.stream) { this.message('The camera is not running.', true); return; }
    var step = STEPS[this.step];
    this.samples[step.face] = this.sample();
    this.step++;
    if (this.step >= STEPS.length) { this.finish(); return; }
    this.renderStep();
    this.message('Got the ' + step.name.toLowerCase() + ' face.');
  };

  Scanner.prototype.undo = function () {
    if (this.step === 0) return;
    this.step--;
    delete this.samples[STEPS[this.step].face];
    this.renderStep();
    this.message('');
  };

  Scanner.prototype.finish = function () {
    var colors = classify(this.samples);
    this.close(false);
    if (this.opts.onDone) this.opts.onDone(colors);
  };

  /**
   * Turn 54 raw samples into 54 palette indices.
   * Step 1: name the six centers, forcing six different names.
   * Step 2: match every sticker to the center that looks most like it, with a
   *         nine-per-color quota so a bad guess cannot take over a color.
   */
  function classify(samples) {
    var centers = [];  // per face: rgb of its middle sticker
    for (var f = 0; f < 6; f++) centers[f] = samples[f][4];

    // face -> palette index, all six distinct, best matches assigned first
    var pairs = [];
    for (var face = 0; face < 6; face++) {
      for (var p = 0; p < 6; p++) {
        var hsv = rgbToHsv(centers[face][0], centers[face][1], centers[face][2]);
        var cost = p === 0
          ? hsv.s * 200                                   // white: the less saturated the better
          : hueDistance(hsv.h, IDEAL_HUE[p]) + (1 - hsv.s) * 120;
        pairs.push({ face: face, palette: p, cost: cost });
      }
    }
    pairs.sort(function (a, b) { return a.cost - b.cost; });
    var faceColor = {}, usedPalette = {};
    pairs.forEach(function (pair) {
      if (faceColor[pair.face] !== undefined || usedPalette[pair.palette]) return;
      faceColor[pair.face] = pair.palette;
      usedPalette[pair.palette] = true;
    });

    // every sticker against every reference, cheapest first, nine per color
    var all = [];
    for (var fc = 0; fc < 6; fc++) {
      for (var i = 0; i < 9; i++) {
        for (var ref = 0; ref < 6; ref++) {
          all.push({ idx: fc * 9 + i, ref: ref, cost: colorCost(samples[fc][i], centers[ref]) });
        }
      }
    }
    all.sort(function (a, b) { return a.cost - b.cost; });

    var assigned = new Int8Array(54).fill(-1);
    var quota = [9, 9, 9, 9, 9, 9];
    // centers are known by definition
    for (var cf = 0; cf < 6; cf++) { assigned[cf * 9 + 4] = cf; quota[cf]--; }
    all.forEach(function (item) {
      if (assigned[item.idx] >= 0 || quota[item.ref] <= 0) return;
      assigned[item.idx] = item.ref;
      quota[item.ref]--;
    });

    var out = new Int8Array(54);
    for (var k = 0; k < 54; k++) out[k] = faceColor[assigned[k]];
    return out;
  }

  Scanner.classify = classify;   // exposed for tests
  Scanner.guessColor = guessColor;

  root.CubeScanner = Scanner;
  if (typeof module === 'object' && module.exports) module.exports = Scanner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
