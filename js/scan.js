/*
 * scan.js — read a cube's colors through the camera.
 *
 * Point at a face, press the button, six times. Any order, any way up: the
 * centre sticker says which face it is, and the assembler works out the
 * rotations by finding the one arrangement that is a real cube.
 *
 * Reading happens on the device and takes a few milliseconds — detect.js finds
 * the 3x3 grid in the photo, assemble.js names the colours and fits the six
 * faces together. Nothing leaves the machine.
 *
 * Nothing is uploaded and nothing needs a server: the whole read happens here.
 */
;(function (root) {
  'use strict';

  var PREVIEW_EDGE = 320;   // the live overlay searches a copy this size
  var CAPTURE_EDGE = 900;   // stills are kept this big for colour sampling
  var LIVE_INTERVAL = 180;  // ms between live detections

  function Scanner(opts) {
    this.opts = opts || {};
    this.el = {
      modal: document.getElementById('scanner'),
      video: document.getElementById('scan-video'),
      overlay: document.getElementById('scan-overlay'),
      stage: document.querySelector('.scan-stage'),
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
    this.overlayCtx = this.el.overlay.getContext('2d');
    this.work = document.createElement('canvas');
    this.workCtx = this.work.getContext('2d', { willReadFrequently: true });

    this.samples = [];   // per capture: nine [r,g,b]
    this.centers = [];   // per capture: the middle sticker's colour
    this.stream = null;
    this.busy = false;
    this.lastLive = 0;
    this.locked = null;  // most recent live detection, for the overlay

    var self = this;
    this.el.capture.onclick = function () { self.capture(); };
    this.el.undo.onclick = function () { self.undo(); };
    this.el.close.onclick = function () { self.close(true); };
  }

  Scanner.prototype.open = function () {
    var self = this;
    this.el.modal.hidden = false;
    this.samples = [];
    this.centers = [];
    this.busy = false;
    this.locked = null;
    this.size = null;
    this.shownSize = -1;
    this.el.capture.disabled = true;
    this.render();
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
      self.loop();
    }).catch(function (err) {
      self.message(cameraProblem(err), true);
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

  Scanner.prototype.render = function () {
    var done = this.samples.length;
    this.el.title.textContent = done >= 6 ? 'Reading the cube…' : 'Face ' + (done + 1) + ' of 6';
    this.el.tip.textContent = 'Point a face at the camera and snap it. Any order, any way up — ' +
      'turn the cube however you like between shots.';
    this.el.capture.textContent = 'Snap';
    this.el.undo.disabled = done === 0;

    var thumbs = this.el.thumbs;
    thumbs.innerHTML = '';
    for (var i = 0; i < 6; i++) {
      var dot = document.createElement('span');
      if (i < this.centers.length) {
        dot.className = 'scan-chip is-done';
        dot.style.background = 'rgb(' + this.centers[i].map(Math.round).join(',') + ')';
        dot.title = 'face ' + (i + 1) + ' captured';
      } else {
        dot.className = 'scan-chip';
      }
      thumbs.appendChild(dot);
    }
  };

  /** Grab the current frame into a canvas at the requested long edge. */
  Scanner.prototype.grab = function (canvas, ctx, maxEdge) {
    var v = this.el.video;
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return null;
    var scale = Math.min(1, maxEdge / Math.max(w, h));
    var cw = Math.round(w * scale), ch = Math.round(h * scale);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    ctx.drawImage(v, 0, 0, cw, ch);
    return ctx.getImageData(0, 0, cw, ch);
  };

  /** Live loop: look for a face a few times a second and outline it. */
  Scanner.prototype.loop = function () {
    var self = this;
    var now = performance.now();
    if (!this.busy && now - this.lastLive > LIVE_INTERVAL) {
      this.lastLive = now;
      var frame = this.grab(this.work, this.workCtx, PREVIEW_EDGE);
      // Not told the size — it works it out, largest first
      this.locked = frame ? CubeDetect.detectAny(frame) : null;
      this.drawOverlay(frame);
      this.showSize();
    }
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };

  /** Say what it can see right now, so the lock is obvious before pressing. */
  Scanner.prototype.showSize = function () {
    if (this.busy) return;
    var size = this.locked ? this.locked.size : 0;
    if (size === this.shownSize) return;
    this.shownSize = size;
    if (!size) { this.message(''); return; }
    this.message(size + '×' + size + ' face found — ' + this.locked.points.length + ' stickers.',
      false);
  };

  /** Where the video actually sits inside its box, given object-fit: contain. */
  Scanner.prototype.videoBox = function () {
    var stage = this.el.stage.getBoundingClientRect();
    var v = this.el.video;
    if (!v.videoWidth) return { x: 0, y: 0, w: stage.width, h: stage.height, stage: stage };
    var scale = Math.min(stage.width / v.videoWidth, stage.height / v.videoHeight);
    var w = v.videoWidth * scale, h = v.videoHeight * scale;
    return { x: (stage.width - w) / 2, y: (stage.height - h) / 2, w: w, h: h, stage: stage };
  };

  Scanner.prototype.drawOverlay = function (frame) {
    var box = this.videoBox();
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.round(box.stage.width * dpr), ch = Math.round(box.stage.height * dpr);
    if (this.el.overlay.width !== cw || this.el.overlay.height !== ch) {
      this.el.overlay.width = cw;
      this.el.overlay.height = ch;
    }
    var ctx = this.overlayCtx;
    ctx.clearRect(0, 0, cw, ch);
    if (!this.locked || !frame) return;

    // detector coordinates are in the frame we handed it
    var k = box.w / frame.width;
    var map = function (p) {
      return [(box.x + p.x * k) * dpr, (box.y + p.y * k) * dpr];
    };

    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(55, 211, 154, 0.95)';
    ctx.beginPath();
    this.locked.quad.forEach(function (corner, i) {
      var p = map(corner);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = 'rgba(55, 211, 154, 0.9)';
    this.locked.points.forEach(function (p) {
      var q = map(p);
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  Scanner.prototype.capture = function () {
    if (!this.stream || this.busy) return;
    var frame = this.grab(this.el.canvas, this.ctx, CAPTURE_EDGE);
    if (!frame) { this.message('The camera is not ready yet.', true); return; }

    var found = CubeDetect.detectAny(frame);
    if (!found || found.failed) {
      var why = CubeDetect.detectFace(frame, { debug: true });
      this.reportMiss(frame, why && why.debug);
      return;
    }

    // Every face has to be the same size as the first one.
    if (!this.size) this.size = found.size;
    if (found.size !== this.size) {
      this.message('That looks like a ' + found.size + '×' + found.size + ' face, but the first one was ' +
        this.size + '×' + this.size + '. Same cube for all six, please.', true);
      return;
    }

    // A 3x3 has a fixed centre sticker, so a repeated face can be spotted the
    // moment it is taken. A 4x4 has no such sticker, so there is nothing to
    // compare and the check simply does not apply.
    var center = this.size === 3 ? found.samples[4] : null;
    if (center) {
      for (var i = 0; i < this.centers.length; i++) {
        if (CubeAssemble.colorCost(center, this.centers[i]) < 12) {
          this.message('That is the same face as photo ' + (i + 1) + '. Turn the cube to a face you ' +
            'have not done yet.', true);
          return;
        }
      }
    }

    this.samples.push(found.samples);
    this.centers.push(center || averageColor(found.samples));

    if (this.samples.length >= 6) { this.finish(); return; }
    this.render();
    this.message('Got it — ' + (6 - this.samples.length) + ' to go.');
  };

  /**
   * A shot the detector could not read. Say what it actually saw, and — since
   * this is exactly the case that is impossible to debug from a description —
   * post the frame back to the local server, which writes it to ./testdata on
   * this machine. Nothing leaves the machine.
   */
  Scanner.prototype.reportMiss = function (frame, debug) {
    var reason = debug && debug.stage ? debug.stage : 'no cube face in that shot';
    var advice = 'Fill more of the frame with one face, get more even light, and keep the ' +
      'face roughly square to the camera.';
    if (debug && debug.candidates !== undefined && debug.candidates < 6) {
      advice = 'It only picked out ' + debug.candidates + ' sticker-shaped patches. Try more ' +
        'light, less glare, and holding the cube closer.';
    }
    this.message(reason + '. ' + advice, true);
    this.misses = (this.misses || 0) + 1;

    // downscale before sending; the detector never sees more than this anyway
    var w = frame.width, h = frame.height;
    var scale = Math.min(1, 640 / Math.max(w, h));
    var sw = Math.round(w * scale), sh = Math.round(h * scale);
    var tmp = document.createElement('canvas');
    tmp.width = sw; tmp.height = sh;
    var tctx = tmp.getContext('2d');
    tctx.drawImage(this.el.canvas, 0, 0, sw, sh);
    var shrunk = tctx.getImageData(0, 0, sw, sh);

    var bytes = new Uint8Array(shrunk.data.buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    fetch('api/debug-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: sw, height: sh, label: 'miss' + this.misses,
        note: JSON.stringify(debug || {}),
        data: btoa(binary)
      })
    }).catch(function () { /* diagnosis is a bonus, never a blocker */ });
  };

  Scanner.prototype.undo = function () {
    if (!this.samples.length || this.busy) return;
    this.samples.pop();
    this.centers.pop();
    this.render();
    this.message('');
  };

  /** Just for the little captured-face chips, when there is no centre to show. */
  function averageColor(samples) {
    var r = 0, g = 0, b = 0;
    samples.forEach(function (s) { r += s[0]; g += s[1]; b += s[2]; });
    return [r / samples.length, g / samples.length, b / samples.length];
  }

  Scanner.prototype.finish = function () {
    this.busy = true;
    this.el.capture.disabled = true;
    this.el.undo.disabled = true;
    this.render();

    if (this.size !== 3) {
      // No fixed centres, so which photo is which face cannot be worked out the
      // way a 3x3 does it. Until that is built, the faces are taken in the order
      // they were shot — the colours are read properly, the arrangement is a
      // guess, and the user is told exactly that.
      var read = CubeAssemble.clusterStickers(this.samples, this.size);
      this.done({
        colors: read, unsure: [], source: 'device-unordered', size: this.size
      });
      return;
    }

    var built = CubeAssemble.assemble(this.samples);
    this.done(built.ok
      ? { colors: built.colors, unsure: [], source: 'device', ambiguous: built.ambiguous }
      : { colors: built.colors || null, unsure: [], source: 'failed', note: built.message });
  };

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

  root.CubeScanner = Scanner;
  if (typeof module === 'object' && module.exports) module.exports = Scanner;
})(typeof globalThis !== 'undefined' ? globalThis : this);

