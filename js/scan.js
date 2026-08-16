/*
 * scan.js — read a cube's colors through the camera.
 *
 * Two cubes on screen: the one under the camera, and the one that has been
 * understood from it. The second is the point. A scanner that shows only what
 * the lens sees is asking to be trusted; one that shows what it has decided can
 * be checked at a glance, face by face, before a solution is written for it —
 * and when a face lands, that cube turns to show which way to turn yours.
 *
 * The route is front, three turns to the left, then tips for the top and the
 * bottom, and it lives in guide.js along with the bookkeeping that makes a
 * turned cube's faces land in the right places. Following it is not required:
 * the centre sticker says which face is which and the assembler works out the
 * rotations, so any order and any way up still comes out right. The route is
 * there because "any order" is not guidance.
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
      guideCanvas: document.getElementById('scan-guide-canvas'),
      guideText: document.getElementById('scan-guide-text'),
      guideArrow: document.getElementById('scan-arrow'),
      capture: document.getElementById('scan-capture'),
      undo: document.getElementById('scan-undo'),
      close: document.getElementById('scan-close'),
      message: document.getElementById('scan-message'),
      thumbs: document.getElementById('scan-thumbs'),
      flash: document.getElementById('scan-flash')
    };
    // When to take the photo without being asked. All the judgement lives in
    // autosnap.js, which needs no camera and is therefore the part with tests.
    this.auto = new CubeAutoSnap();
    this.lock = 0;   // 0..1, how much of the hold-still is done, for the outline
    this.ctx = this.el.canvas.getContext('2d', { willReadFrequently: true });
    this.overlayCtx = this.el.overlay.getContext('2d');
    this.work = document.createElement('canvas');
    this.workCtx = this.work.getContext('2d', { willReadFrequently: true });

    this.samples = [];   // per capture: nine [r,g,b]
    this.centers = [];   // per capture: the middle sticker's colour
    /*
     * The cube being built up on screen, and the colours it is painted with.
     *
     * Not palette indices: the six names are only settled once all six faces
     * are in, and this has to show something after the first one. So each
     * sticker keeps the colour actually photographed, pushed onto a table the
     * renderer indexes into — which makes the second cube a picture of the
     * photographs rather than of the app's opinion of them. If a face reads
     * badly, it looks wrong here, which is the whole reason it is on screen.
     */
    this.guideState = null;
    this.guideColors = [];
    this.guide = null;
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
    this.startGuide();
    this.size = null;
    this.sawInstead = 0;
    this.shownSize = '';
    this.auto.reset();
    this.lock = 0;
    this.autoState = 'searching';
    this.running = false;   // the live loop only starts once the camera is up
    this.holdUntil = 0;
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
      self.running = true;
      self.loop();
    }).catch(function (err) {
      self.message(cameraProblem(err), true);
    });
  };

  /*
   * `running` and not just cancelAnimationFrame, because of where close() gets
   * called from.
   *
   * The sixth photo closes the scanner from inside the live loop —
   * loop -> capture -> finish -> done -> close — and by then this.raf holds the
   * handle of the frame currently being run, which cancelling does nothing to.
   * Control then returns up the stack to the bottom of loop(), which schedules
   * the next one, and the loop carries on for the life of the page: grabbing
   * frames off a stopped video, running the detector on them several times a
   * second, on a phone, with the scanner shut. It was silent before
   * auto-capture — the leaked loop found nothing and said nothing — and turned
   * up as "Turn the cube to a face you have not done yet" appearing after the
   * modal had closed.
   */
  Scanner.prototype.close = function (cancelled) {
    this.running = false;
    // the second cube runs its own render loop; without this, a scanner opened
    // five times leaves five of them turning for the life of the page
    if (this.guide) { this.guide.destroy(); this.guide = null; }
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
    cancelAnimationFrame(this.raf);
    this.el.modal.hidden = true;
    if (cancelled && this.opts.onCancel) this.opts.onCancel();
  };

  /**
   * The second cube: grey to start with, filling in a face at a time.
   *
   * Built fresh on every open, and taken down on every close — it owns a
   * render loop, and a scanner opened five times would otherwise leave five of
   * them running on a phone for the life of the page.
   */
  Scanner.prototype.startGuide = function () {
    var N = this.opts.size || 3;
    if (this.guide) this.guide.destroy();
    this.guideColors = [];
    this.guideState = new Int8Array(6 * N * N).fill(-1);
    this.guide = new CubeGuide(this.el.guideCanvas, {
      size: N,
      colors: this.guideColors,
      state: this.guideState,
      startText: 'Stand the cube on a flat surface in even light, any face toward the camera.'
    });
    this.showGuide();
  };

  Scanner.prototype.showGuide = function () {
    if (!this.guide) return;
    var info = this.guide.instruction();
    this.el.guideArrow.textContent = info.arrow;
    this.el.guideText.textContent = info.text;
  };

  /**
   * Paint the face just photographed onto the second cube, then turn it.
   *
   * The turn is the instruction — it happens while the cube is still in the
   * user's hands and being moved, which is exactly when it is wanted. Nothing
   * waits on it: auto-capture stays armed throughout, so someone quicker than
   * the animation is not held up by it.
   */
  Scanner.prototype.recordGuide = function (samples) {
    if (!this.guide) return;
    var table = this.guideColors, base = table.length;
    for (var i = 0; i < samples.length; i++) table.push(punchy(samples[i]));
    var values = [];
    for (var k = 0; k < samples.length; k++) values.push(base + k);
    this.guide.fill(values);
    // a beat with the face you just took still facing you, then the turn
    if (!this.guide.atEnd()) this.guide.next(null, 700);
    this.showGuide();
  };

  /**
   * The photographed colour, with the chroma pushed up.
   *
   * A camera under indoor light returns something closer to grey than the
   * sticker looks, and six washed-out faces on a dark screen are hard to check
   * against a cube. Lightness is left alone — only the distance from grey is
   * stretched — so a misread sticker still looks wrong rather than being
   * flattered into looking right.
   */
  function punchy(rgb) {
    var mid = (rgb[0] + rgb[1] + rgb[2]) / 3;
    var out = '#';
    for (var c = 0; c < 3; c++) {
      var v = Math.round(Math.max(0, Math.min(255, mid + (rgb[c] - mid) * 1.45)));
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  Scanner.prototype.message = function (text, isError) {
    this.el.message.textContent = text || '';
    this.el.message.className = 'message' + (isError ? ' error' : '');
  };

  Scanner.prototype.render = function () {
    var done = this.samples.length;
    this.el.title.textContent = done >= 6 ? 'Reading the cube…' : 'Face ' + (done + 1) + ' of 6';
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

  /**
   * Live loop: look for a face a few times a second, outline it, and take the
   * photo once the same face has been held there long enough to be an offer
   * rather than a glimpse.
   *
   * The photo is not this frame. This one is 320px across, for speed; capture()
   * takes a fresh one at 900px and detects again, so what gets kept is exactly
   * what a pressed button would have kept. This loop only decides when.
   */
  Scanner.prototype.loop = function () {
    var self = this;
    if (!this.running) return;
    var now = performance.now();
    if (!this.busy && now - this.lastLive > LIVE_INTERVAL) {
      this.lastLive = now;
      var frame = this.grab(this.work, this.workCtx, PREVIEW_EDGE);
      this.locked = frame ? this.look(frame) : null;

      var verdict = this.auto.feed(this.locked, frame, now);
      this.lock = verdict.lock;
      this.autoState = verdict.state;

      this.drawOverlay(frame);
      this.showSize();
      if (verdict.fire) this.capture(true);
    }
    this.raf = requestAnimationFrame(function () { self.loop(); });
  };

  /**
   * The white blink that says a photo was taken.
   *
   * Without it an automatic capture is invisible: the thumbnail row gains a dot
   * somewhere below the picture and nothing else happens, so there is no moment
   * to associate with "that one is done". Restarting the animation needs the
   * class off, a forced reflow, and the class back on, or a second shot within
   * the same animation does nothing at all.
   */
  Scanner.prototype.flash = function () {
    var el = this.el.flash;
    if (!el) return;
    el.classList.remove('is-firing');
    void el.offsetWidth;
    el.classList.add('is-firing');
  };

  /**
   * Look for a face.
   *
   * When a size has been chosen, look for that size and nothing else. A 3x3
   * grid fits inside a 4x4 — any three-by-three block of it — so a 4x4 held up
   * to a scanner willing to accept a 3x3 will happily be read as one, quietly
   * throwing away half the cube. If the wanted size is not there, it has a look
   * for the other sizes purely so it can say what it can actually see.
   */
  Scanner.prototype.look = function (frame) {
    var wanted = this.size || this.opts.size;
    if (!wanted) return CubeDetect.detectAny(frame);

    var found = CubeDetect.detectFace(frame, { size: wanted });
    if (found && !found.failed) { this.sawInstead = 0; return found; }

    var other = CubeDetect.detectAny(frame, { sizes: [5, 4, 3].filter(function (n) { return n !== wanted; }) });
    this.sawInstead = other ? other.size : 0;
    return null;
  };

  /**
   * What to say when the wanted size was not found but another size was.
   *
   * Only a BIGGER grid is evidence of anything. A smaller one fits inside a
   * bigger one — any three-by-three block of a 4x4 is a valid 3x3 lattice — so
   * finding a 3x3 while looking for a 4x4 says nothing about which cube is
   * being held, and announcing "that is a 3x3" at someone holding a 4x4 is
   * simply a confident falsehood. In that direction the honest report is that
   * the 4x4 could not be read, and why.
   */
  Scanner.prototype.wrongSizeMessage = function (wanted) {
    if (!this.sawInstead || this.sawInstead < wanted) return null;
    return 'That is a ' + this.sawInstead + '×' + this.sawInstead + ' face, and you are scanning ' +
      'a ' + wanted + '×' + wanted + '. Change the size above, or show me the right cube.';
  };

  /**
   * Say what it can see and what it is about to do about it.
   *
   * Keyed and deduped because this runs several times a second and rewriting
   * the same sentence 5x a second makes screen readers unusable and the line
   * itself look broken. `holdUntil` is the other half: a successful shot leaves
   * "Got it — 5 to go." on screen, and without a hold the very next look would
   * replace it 180ms later with the prompt for the next face, so the one piece
   * of feedback that a photo was taken would never be read.
   */
  Scanner.prototype.showSize = function () {
    if (this.busy) return;
    if (this.holdUntil && performance.now() < this.holdUntil) return;

    var size = this.locked ? this.locked.size : 0;
    var key = size + ':' + (this.sawInstead || 0) + ':' + this.autoState;
    if (key === this.shownSize) return;
    this.shownSize = key;

    if (this.autoState === 'turn') {
      this.message('Turn the cube to a face you have not done yet.');
      return;
    }
    if (size) {
      this.message(size + '×' + size + ' face found — hold still and it will take itself.', false);
    } else {
      var wrong = this.wrongSizeMessage(this.size || this.opts.size);
      this.message(wrong || '', !!wrong);
    }
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

    /*
     * The outline says three different things now, so it has to look like
     * three different things: waiting for the cube to be turned on, found and
     * counting down, and — for the last fraction of a second — about to fire.
     * Amber while disarmed is the important one. Without it a face sitting
     * under a green outline that is never going to be photographed looks
     * exactly like a face about to be, and the natural response is to hold
     * even more still.
     */
    var turning = this.autoState === 'turn';
    var corners = this.locked.quad.map(map);
    var trace = function () {
      ctx.beginPath();
      corners.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
      ctx.closePath();
    };

    ctx.lineJoin = 'round';
    ctx.lineWidth = 3 * dpr;
    ctx.setLineDash([]);
    ctx.strokeStyle = turning ? 'rgba(255, 176, 32, 0.85)' : 'rgba(55, 211, 154, 0.35)';
    trace();
    ctx.stroke();

    // and the part of it already earned, drawn round the perimeter like a
    // fuse: full circuit means the shot goes now
    if (!turning && this.lock > 0) {
      var perim = 0;
      for (var c = 0; c < corners.length; c++) {
        var a = corners[c], b = corners[(c + 1) % corners.length];
        perim += Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(55, 211, 154, 0.98)';
      ctx.setLineDash([perim * this.lock, perim]);
      trace();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = turning ? 'rgba(255, 176, 32, 0.8)' : 'rgba(55, 211, 154, 0.9)';
    this.locked.points.forEach(function (p) {
      var q = map(p);
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  /**
   * Keep the frame in front of the camera. `fromAuto` when the live loop
   * decided rather than a thumb.
   *
   * Every path out of here that does not keep a photo still stands the
   * auto-capture down for its cooldown. Otherwise a shot that fails at full
   * size, or one refused as a face already taken, is retried on the very next
   * look and every look after that — a message flickering several times a
   * second at someone holding a cube perfectly still, wondering what they did.
   */
  Scanner.prototype.capture = function (fromAuto) {
    if (!this.stream || this.busy) return;
    var now = performance.now();
    var frame = this.grab(this.el.canvas, this.ctx, CAPTURE_EDGE);
    if (!frame) {
      this.auto.pause(now);
      this.message('The camera is not ready yet.', true);
      return;
    }

    var found = this.look(frame);
    if (!found || found.failed) {
      this.auto.pause(now);
      var wanted = this.size || this.opts.size || 3;
      var wrong = this.wrongSizeMessage(wanted);
      if (wrong) { this.message(wrong, true); return; }
      /*
       * A miss the live loop talked itself into is not worth a diagnostic
       * frame. reportMiss posts the picture to the local server, and the whole
       * point of that file is to collect shots a person took and expected to
       * work; filling the folder with frames nobody asked for buries them.
       */
      if (fromAuto) { this.message('Not quite — hold it a little steadier.'); return; }
      var why = CubeDetect.detectFace(frame, { size: wanted, debug: true });
      this.reportMiss(frame, why && why.debug);
      return;
    }

    // Every face has to be the same size as the first one.
    if (!this.size) this.size = found.size;

    // A 3x3 has a fixed centre sticker, so a repeated face can be spotted the
    // moment it is taken. A 4x4 has no such sticker, so there is nothing to
    // compare and the check simply does not apply.
    var center = this.size === 3 ? found.samples[4] : null;
    if (center) {
      for (var i = 0; i < this.centers.length; i++) {
        if (CubeAssemble.colorCost(center, this.centers[i]) < 12) {
          // disarmed against this face, so it waits for the cube to be turned
          this.auto.captured(found.samples, found.size, now);
          this.message('That is the same face as photo ' + (i + 1) + '. Turn the cube to a face you ' +
            'have not done yet.', true);
          return;
        }
      }
    }

    this.auto.captured(found.samples, found.size, now);
    this.flash();
    this.samples.push(found.samples);
    this.centers.push(center || averageColor(found.samples));

    if (this.samples.length >= 6) { this.finish(); return; }
    this.recordGuide(found.samples);
    this.render();
    this.message('Got it — ' + (6 - this.samples.length) + ' to go.');
    this.holdUntil = now + 1200;   // long enough to be read before the next prompt
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
    /*
     * Forget which face was last kept, or the face just thrown away is still
     * the one auto-capture is refusing to take, and "Redo last" would leave it
     * amber and inert at exactly the moment it is meant to be retaken. The
     * hold-still still has to be earned again from scratch, so this does not
     * put the same shot straight back.
     */
    this.auto.reset();
    this.lock = 0;
    this.autoState = 'searching';
    this.shownSize = '';
    this.holdUntil = 0;
    // put the second cube back a face as well, grey where that face was, and
    // turn it back so it is once more showing the one to retake
    if (this.guide) {
      this.guide.setStep(this.samples.length, true);
      this.guide.fill(this.guide.faceCells().map(function () { return -1; }));
      this.showGuide();
    }
    this.render();
    this.message('');
  };

  /** Just for the little captured-face chips, when there is no centre to show. */
  function averageColor(samples) {
    var r = 0, g = 0, b = 0;
    samples.forEach(function (s) { r += s[0]; g += s[1]; b += s[2]; });
    return [r / samples.length, g / samples.length, b / samples.length];
  }

  /**
   * Hand the finished reading back and shut the scanner down.
   *
   * This went missing with the Gemini scanner in 602001d and stayed missing for
   * five commits, on the published branch too, because nothing reaches it until
   * the sixth and last photo. It did not look like a missing function. It looked
   * like three separate bugs: the outline froze on the video, the scanner would
   * not close, and the cube could not be solved — because finish() sets `busy`
   * and disables the buttons before calling this, so the throw left the live
   * loop stopped and the modal open.
   *
   * Closing comes first, so the camera light goes out before the page's handler
   * runs; the handler sits in a `finally` so a failure to close still gets the
   * colours through.
   */
  Scanner.prototype.done = function (result) {
    this.busy = false;
    this.el.capture.disabled = false;      // finish() disabled it before reading
    try {
      this.close(false);
    } finally {
      if (this.opts.onDone) this.opts.onDone(result);
    }
  };

  Scanner.prototype.finish = function () {
    this.busy = true;
    this.el.capture.disabled = true;
    this.el.undo.disabled = true;
    this.render();

    var size = this.size || 3;
    var per = size * size;
    // The colours of every photo, in the order they were taken. Needed twice:
    // to assemble the cube, and to turn the finished cube to match the last
    // shot so the moves suit how it is already being held.
    var read = CubeAssemble.clusterStickers(this.samples, size);
    var lastPhoto = Array.prototype.slice.call(read.subarray(5 * per, 6 * per));
    var self = this;
    function handOver(built, fallback) {
      if (!built.ok) {
        self.done({ colors: fallback, unsure: [], source: 'failed', note: built.message, size: size });
        return;
      }
      self.done({
        colors: CubeAssemble.orientToPhoto(built.colors, lastPhoto, size),
        unsure: [], source: 'device', ambiguous: built.ambiguous, size: size
      });
    }

    if (size !== 3) {
      // No centre sticker names a face here, so the arrangement is worked out
      // from the cube's own structure instead.
      var faces = [];
      for (var f = 0; f < 6; f++) faces.push(Array.prototype.slice.call(read.subarray(f * per, f * per + per)));
      handOver(CubeAssemble4.assemble(faces, size), read);
      return;
    }

    var built3 = CubeAssemble.assemble(this.samples);
    handOver(built3, built3.colors || null);
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

