/*
 * scan.js — read a cube's colors through the camera.
 *
 * Six photos, one per face, in a fixed order with explicit "turn the cube this
 * way" instructions so each photo lands on the right face of the net without
 * the user having to think about orientation. Point, press, done — framing is
 * deliberately loose, because the reader on the other end can find the cube.
 *
 * Reading is done by Gemini through the local server (POST /api/scan); the key
 * lives on the machine running the server and never reaches this file.
 *
 * If that is unavailable, a built-in classifier takes over. It is much rougher
 * — it samples nine fixed patches from the middle of the frame, so it only
 * works if the face happens to be square-on — which is exactly why it is a
 * fallback and not a second opinion. Cross-checking a reliable reader against
 * an unreliable one just produces noise.
 */
;(function (root) {
  'use strict';

  var MAX_EDGE = 800;   // longest side of the photo we send

  var STEPS = [
    { face: 2, letter: 'F', name: 'Front', tip: 'Hold the cube with the top face up and point the FRONT face at the camera.' },
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

  /**
   * Distance between two samples, tuned against synthetic bad lighting
   * (see test/scan.test.js). Brightness is deliberately ignored: each face is
   * photographed under its own light, so only hue and saturation carry
   * information that survives the trip between faces.
   */
  function colorCost(a, b) {
    var ha = rgbToHsv(a[0], a[1], a[2]), hb = rgbToHsv(b[0], b[1], b[2]);
    var greyness = Math.min(ha.s, hb.s);
    return hueDistance(ha.h, hb.h) * Math.min(1, greyness / 0.3) + Math.abs(ha.s - hb.s) * 55;
  }

  function median(list) {
    list.sort(function (a, b) { return a - b; });
    var mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  /** Say what actually went wrong, rather than one catch-all sentence. */
  function cameraProblem(err) {
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Camera access was blocked. Allow it for this site in your browser settings and try again — ' +
        'on a phone the permission prompt is easy to dismiss by accident.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
      return 'No camera on this device. Try it from your phone, or fill the colors in by hand.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The camera is busy — another app or tab probably has it. Close that and try again.';
    }
    return 'The camera would not start' + (name ? ' (' + name + ')' : '') + '. Fill the colors in by hand instead.';
  }

  function Scanner(opts) {
    this.opts = opts || {};
    this.el = {
      modal: document.getElementById('scanner'),
      video: document.getElementById('scan-video'),
      canvas: document.getElementById('scan-canvas'),
      shot: document.getElementById('scan-shot'),
      title: document.getElementById('scan-title'),
      tip: document.getElementById('scan-tip'),
      capture: document.getElementById('scan-capture'),
      undo: document.getElementById('scan-undo'),
      close: document.getElementById('scan-close'),
      message: document.getElementById('scan-message'),
      thumbs: document.getElementById('scan-thumbs')
    };
    this.ctx = this.el.canvas.getContext('2d', { willReadFrequently: true });

    this.samples = {};   // face -> nine [r,g,b], for the fallback reader
    this.photos = {};    // face -> base64 jpeg
    this.step = 0;
    this.stream = null;
    this.busy = false;

    var self = this;
    this.el.capture.onclick = function () { self.capture(); };
    this.el.undo.onclick = function () { self.undo(); };
    this.el.close.onclick = function () { self.close(true); };
  }

  Scanner.prototype.open = function () {
    var self = this;
    this.el.modal.hidden = false;
    this.el.shot.hidden = true;
    this.step = 0;
    this.samples = {};
    this.photos = {};
    this.busy = false;
    this.el.capture.disabled = true;
    this.renderStep();
    this.message('Starting the camera…');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.message('This page has no camera access at all — browsers only hand it over on an https:// ' +
        'address (or localhost). See the Tailscale notes in the README, or fill the colors in by hand.', true);
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then(function (stream) {
      self.stream = stream;
      self.el.video.srcObject = stream;
      return self.el.video.play();
    }).then(function () {
      self.el.capture.disabled = false;
      self.message('');
    }).catch(function (err) {
      self.message(cameraProblem(err), true);
    });
  };

  Scanner.prototype.close = function (cancelled) {
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
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
    this.el.capture.textContent = 'Snap the ' + step.name.toLowerCase() + ' face';
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

  /** Freeze the current video frame into the working canvas. */
  Scanner.prototype.grabFrame = function () {
    var v = this.el.video;
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return null;
    var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);
    this.el.canvas.width = cw;
    this.el.canvas.height = ch;
    this.ctx.drawImage(v, 0, 0, cw, ch);
    return { w: cw, h: ch };
  };

  /**
   * Nine median-filtered patches from a centred square. Only the fallback
   * reader uses this, and it assumes the face is roughly square-on.
   */
  Scanner.prototype.sampleFrame = function (size) {
    var side = Math.min(size.w, size.h) * 0.62;
    var x0 = (size.w - side) / 2, y0 = (size.h - side) / 2;
    var cell = side / 3, patch = Math.max(4, Math.round(cell * 0.34));
    var out = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var x = Math.round(x0 + c * cell + cell / 2 - patch / 2);
        var y = Math.round(y0 + r * cell + cell / 2 - patch / 2);
        var data = this.ctx.getImageData(x, y, patch, patch).data;
        var rs = [], gs = [], bs = [];
        for (var i = 0; i < data.length; i += 4) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
        out.push([median(rs), median(gs), median(bs)]);
      }
    }
    return out;
  };

  Scanner.prototype.capture = function () {
    if (!this.stream || this.busy) return;
    var size = this.grabFrame();
    if (!size) { this.message('The camera is not ready yet.', true); return; }

    var step = STEPS[this.step];
    this.samples[step.face] = this.sampleFrame(size);
    this.photos[step.face] = this.el.canvas.toDataURL('image/jpeg', 0.86).split(',')[1];

    this.el.shot.src = 'data:image/jpeg;base64,' + this.photos[step.face];
    this.el.shot.hidden = false;

    this.step++;
    if (this.step >= STEPS.length) { this.finish(); return; }
    this.renderStep();
    this.message('Got the ' + step.name.toLowerCase() + ' face. Blurry? Hit "Redo last".');
  };

  Scanner.prototype.undo = function () {
    if (this.step === 0 || this.busy) return;
    this.step--;
    delete this.samples[STEPS[this.step].face];
    delete this.photos[STEPS[this.step].face];
    var previous = this.step > 0 ? this.photos[STEPS[this.step - 1].face] : null;
    if (previous) this.el.shot.src = 'data:image/jpeg;base64,' + previous;
    this.el.shot.hidden = !previous;
    this.renderStep();
    this.message('');
  };

  Scanner.prototype.finish = function () {
    var self = this;
    this.busy = true;
    this.el.capture.disabled = true;
    this.el.undo.disabled = true;
    this.el.title.textContent = 'Reading the colors…';
    this.el.tip.textContent = 'Sending the six photos off to be read. This takes a few seconds.';
    this.message('');

    var body = {
      images: STEPS.map(function (s) {
        return { face: s.letter, mimeType: 'image/jpeg', data: self.photos[s.face] };
      })
    };

    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timed out')); }, 45000);
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
        var why = out.json && out.json.message ? out.json.message : 'the reader was unreachable';
        return { colors: classify(self.samples), unsure: [], source: 'local', note: why };
      }
      return {
        colors: Int8Array.from(out.json.colors),
        unsure: out.json.uncertain || [],
        source: 'gemini',
        note: out.json.warning || null
      };
    }).catch(function (err) {
      return {
        colors: classify(self.samples), unsure: [], source: 'local',
        note: err && err.message ? err.message : 'the reader was unreachable'
      };
    }).then(function (result) {
      self.busy = false;
      self.el.capture.disabled = false;
      self.close(false);
      if (self.opts.onDone) self.opts.onDone(result);
    });
  };

  /**
   * Fallback reader. Names the six centers, forcing six different names, then
   * matches every sticker to the center it looks most like, with a
   * nine-per-color quota so one bad guess cannot take over a color.
   * Only as good as the framing — see the note at the top of this file.
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
  Scanner.STEPS = STEPS;

  root.CubeScanner = Scanner;
  if (typeof module === 'object' && module.exports) module.exports = Scanner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
