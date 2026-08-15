/*
 * scan.js — read a cube's colors through the camera.
 *
 * Six captures, one per face, in a fixed order with explicit "turn the cube
 * this way" instructions so each captured grid lands on the right face of the
 * net without the user having to think about orientation.
 *
 * Two readers look at those photos:
 *   1. Gemini, via the local server (POST /api/scan) — the key lives on the
 *      machine running the server, never in this file.
 *   2. A built-in classifier that uses the six center stickers as reference
 *      swatches, with a nine-per-color quota.
 *
 * Whichever answers, Cube.validate() has the last word, and any sticker the
 * two readers disagree about is handed back for the user to confirm.
 */
;(function (root) {
  'use strict';

  var SIZE = 640;          // working canvas: big enough to send, small enough to be quick
  var STEADY_MS = 650;     // hold still this long and it captures itself
  var MOTION_THRESHOLD = 7;

  // Capture order. Each step says how to hold the cube so the captured grid
  // maps straight onto that face's panel in the net.
  var STEPS = [
    { face: 2, letter: 'F', name: 'Front', tip: 'Hold the cube with the top face up and point the FRONT face straight at the camera.' },
    { face: 1, letter: 'R', name: 'Right', tip: 'Keep the top up. Turn the cube a quarter turn to your LEFT so the RIGHT face now faces the camera.' },
    { face: 5, letter: 'B', name: 'Back', tip: 'Another quarter turn to your LEFT — now the BACK face faces the camera.' },
    { face: 4, letter: 'L', name: 'Left', tip: 'One more quarter turn to your LEFT — now the LEFT face faces the camera.' },
    { face: 0, letter: 'U', name: 'Top', tip: 'Go back to the starting position, then tip the cube forwards so the TOP face points at the camera (the front face ends up underneath).' },
    { face: 3, letter: 'D', name: 'Bottom', tip: 'Starting position again, then tip the cube backwards so the BOTTOM face points at the camera (the front face ends up on top).' }
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

  // Palette order: white yellow green blue red orange
  var IDEAL_HUE = [null, 52, 130, 215, 358, 28];

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function guessColor(rgb) {
    var hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    if (hsv.s < 0.28) return 0;
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
      thumbs: document.getElementById('scan-thumbs'),
      auto: document.getElementById('scan-auto'),
      steady: document.getElementById('scan-steady')
    };
    this.ctx = this.el.canvas.getContext('2d');
    this.el.canvas.width = SIZE;
    this.el.canvas.height = SIZE;

    // Clean copy of the frame, with none of the guide overlay drawn on it.
    this.clean = document.createElement('canvas');
    this.clean.width = SIZE;
    this.clean.height = SIZE;
    this.cleanCtx = this.clean.getContext('2d', { willReadFrequently: true });

    this.samples = {};   // face -> nine [r,g,b]
    this.photos = {};    // face -> base64 jpeg
    this.step = 0;
    this.stream = null;
    this.busy = false;
    this.armed = false;
    this.steadyFor = 0;
    this.lastFrame = null;
    this.lastTick = 0;

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
    this.photos = {};
    this.busy = false;
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
      self.openedAt = performance.now();
      self.loop();
    }).catch(function (err) {
      self.message('No camera available (' + (err && err.name ? err.name : 'error') +
        '). On a phone the camera needs an https address — see the Tailscale notes in the README — ' +
        'or just fill the colors in by hand.', true);
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

  /** Draw the center square of the video, then the guide grid on top of it. */
  Scanner.prototype.loop = function () {
    var self = this;
    var v = this.el.video, ctx = this.ctx;
    var now = performance.now();
    var dt = this.lastTick ? now - this.lastTick : 16;
    this.lastTick = now;

    if (v.videoWidth && !this.busy) {
      var side = Math.min(v.videoWidth, v.videoHeight);
      var sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
      this.cleanCtx.drawImage(v, sx, sy, side, side, 0, 0, SIZE, SIZE);
      ctx.drawImage(this.clean, 0, 0);

      this.trackMotion(dt);

      // The nine-patch median is far too heavy to run every frame on a phone;
      // the live dots are only a hint, so refresh them a few times a second.
      if (!this.liveSwatches || now - (this.sampledAt || 0) > 160) {
        this.liveSwatches = this.sample();
        this.sampledAt = now;
      }
      var swatches = this.liveSwatches;
      var cell = SIZE / 3;
      ctx.lineWidth = 3;
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.strokeRect(c * cell + 10, r * cell + 10, cell - 20, cell - 20);
          var guess = guessColor(swatches[r * 3 + c]);
          ctx.fillStyle = (this.opts.palette || ['#fff', '#ff0', '#0a0', '#00f', '#f00', '#f80'])[guess];
          ctx.beginPath();
          ctx.arc(c * cell + cell / 2, r * cell + cell / 2, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
        }
      }
    }
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };

  /**
   * Cheap frame-difference so the app can tell when the cube is being held
   * still. The comparison runs on a 32x32 thumbnail — reading the full frame
   * every tick would cost more than everything else here put together.
   * Movement also has to reappear before auto-capture re-arms, so one steady
   * hand does not fire two captures on the same face.
   */
  Scanner.prototype.trackMotion = function (dt) {
    if (!this.tiny) {
      this.tiny = document.createElement('canvas');
      this.tiny.width = this.tiny.height = 32;
      this.tinyCtx = this.tiny.getContext('2d', { willReadFrequently: true });
    }
    this.tinyCtx.drawImage(this.clean, 0, 0, 32, 32);
    var px = this.tinyCtx.getImageData(0, 0, 32, 32).data;
    var cur = [];
    for (var i = 0; i < px.length; i += 4) {
      cur.push((px[i] + px[i + 1] + px[i + 2]) / 3);
    }
    if (this.lastFrame && this.lastFrame.length === cur.length) {
      var sum = 0;
      for (var k = 0; k < cur.length; k++) sum += Math.abs(cur[k] - this.lastFrame[k]);
      var motion = sum / cur.length;
      if (motion > MOTION_THRESHOLD) {
        this.armed = true;
        this.steadyFor = 0;
      } else {
        this.steadyFor += dt;
      }
      var settled = this.steadyFor > STEADY_MS;
      if (this.el.steady) {
        this.el.steady.textContent = settled ? 'steady' : 'hold still…';
        this.el.steady.className = 'scan-steady' + (settled ? ' is-steady' : '');
      }
      var canAuto = this.el.auto && this.el.auto.checked &&
        this.armed && performance.now() - this.openedAt > 1500;
      if (settled && canAuto && !this.busy) this.capture();
    }
    this.lastFrame = cur;
  };

  /** Median color of a patch at the middle of each of the nine cells. */
  Scanner.prototype.sample = function () {
    var cell = SIZE / 3, patch = Math.round(cell * 0.34);
    var out = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var x = Math.round(c * cell + cell / 2 - patch / 2);
        var y = Math.round(r * cell + cell / 2 - patch / 2);
        var data = this.cleanCtx.getImageData(x, y, patch, patch).data;
        // medians shrug off a single glare spot or a black grid line
        var rs = [], gs = [], bs = [];
        for (var i = 0; i < data.length; i += 4) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
        out.push([median(rs), median(gs), median(bs)]);
      }
    }
    return out;
  };

  function median(list) {
    list.sort(function (a, b) { return a - b; });
    var mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  Scanner.prototype.capture = function () {
    if (!this.stream || this.busy) { return; }
    var step = STEPS[this.step];
    this.samples[step.face] = this.sample();
    this.photos[step.face] = this.clean.toDataURL('image/jpeg', 0.86).split(',')[1];
    this.step++;
    this.armed = false;
    this.steadyFor = 0;
    if (this.step >= STEPS.length) { this.finish(); return; }
    this.renderStep();
    this.message('Got the ' + step.name.toLowerCase() + ' face.');
  };

  Scanner.prototype.undo = function () {
    if (this.step === 0 || this.busy) return;
    this.step--;
    delete this.samples[STEPS[this.step].face];
    delete this.photos[STEPS[this.step].face];
    this.armed = false;
    this.renderStep();
    this.message('');
  };

  Scanner.prototype.finish = function () {
    var self = this;
    var local = classify(this.samples);
    this.busy = true;
    this.el.capture.disabled = true;
    this.el.undo.disabled = true;
    this.message('Reading the colors…');

    var body = {
      images: STEPS.map(function (s) {
        return { face: s.letter, mimeType: 'image/jpeg', data: self.photos[s.face] };
      })
    };

    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timed out')); }, 30000);
    });

    Promise.race([
      fetch('api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (json) { return { ok: res.ok, json: json }; });
      }),
      timeout
    ]).then(function (out) {
      if (!out.ok || !out.json || !Array.isArray(out.json.colors)) {
        var why = out.json && out.json.message ? out.json.message : 'the scan service said no';
        return { colors: local, unsure: [], source: 'local', note: why };
      }
      var colors = Int8Array.from(out.json.colors);
      var unsure = {};
      (out.json.uncertain || []).forEach(function (i) { unsure[i] = true; });
      for (var i = 0; i < 54; i++) if (colors[i] !== local[i]) unsure[i] = true;
      return {
        colors: colors,
        unsure: Object.keys(unsure).map(Number),
        source: 'gemini',
        note: out.json.warning || null
      };
    }).catch(function () {
      return { colors: local, unsure: [], source: 'local', note: 'could not reach the scan service' };
    }).then(function (result) {
      self.el.capture.disabled = false;
      self.busy = false;
      self.close(false);
      if (self.opts.onDone) self.opts.onDone(result);
    });
  };

  /**
   * Fallback reader. Names the six centers, forcing six different names, then
   * matches every sticker to the center it looks most like, with a
   * nine-per-color quota so one bad guess cannot take over a color.
   */
  function classify(samples) {
    var centers = [];
    for (var f = 0; f < 6; f++) centers[f] = samples[f][4];

    var pairs = [];
    for (var face = 0; face < 6; face++) {
      for (var p = 0; p < 6; p++) {
        var hsv = rgbToHsv(centers[face][0], centers[face][1], centers[face][2]);
        var cost = p === 0
          ? hsv.s * 200
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
