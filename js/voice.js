/*
 * voice.js — "next", said out loud, because both hands are holding a cube.
 *
 * Web Speech API, opt-in, off until the microphone button is pressed. Nothing
 * else in this app leaves the device; this does — Safari and Chrome both send
 * the audio to their own servers to transcribe it — so it is never on by
 * accident and the button says as much.
 *
 * Two things make a naive version unusable:
 *
 *   - Interim results arrive as a growing transcript, so a single "next" is
 *     reported several times as it firms up, and each report would step the
 *     solution on. Every command therefore restarts recognition, which clears
 *     what has been heard so far, and a cooldown covers the gap.
 *   - Recognition stops on its own — after silence, after a phone call, after
 *     the screen locks — and `continuous` only reduces how often. So `onend`
 *     starts it again for as long as the button is lit, and the button is the
 *     only thing that actually stops it.
 */
;(function (root) {
  'use strict';

  var Impl = typeof root !== 'undefined'
    ? (root.SpeechRecognition || root.webkitSpeechRecognition)
    : null;

  // Said differently by different people, and misheard in predictable ways:
  // "next" comes back as "text" and "necks" often enough to be worth listing.
  var COMMANDS = [
    { name: 'next', words: ['next', 'nekst', 'necks', 'text', 'go', 'forward', 'done', 'okay next'] },
    { name: 'back', words: ['back', 'previous', 'undo', 'go back'] },
    { name: 'again', words: ['again', 'repeat', 'replay', 'show me again'] }
  ];

  var COOLDOWN = 900;   // ms; one move takes longer than this to animate

  function supported() { return !!Impl; }

  function heard(transcript) {
    var text = ' ' + String(transcript).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    // last match wins: the tail of the transcript is the most recent thing said
    var best = null, at = -1;
    COMMANDS.forEach(function (c) {
      c.words.forEach(function (w) {
        var i = text.lastIndexOf(' ' + w + ' ');
        if (i > at) { at = i; best = c.name; }
      });
    });
    return best;
  }

  function Voice(opts) {
    this.opts = opts || {};
    this.on = false;
    this.last = 0;
    this.rec = null;
  }

  Voice.prototype.report = function (state, detail) {
    if (this.opts.onState) this.opts.onState(state, detail);
  };

  Voice.prototype.start = function () {
    if (!Impl || this.on) return;
    this.on = true;
    this.report('starting');
    this.listen();
  };

  Voice.prototype.listen = function () {
    var self = this;
    if (!this.on) return;
    var rec = new Impl();
    this.rec = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = document.documentElement.lang || 'en-US';

    rec.onstart = function () { self.report('listening'); };
    rec.onresult = function (e) {
      var latest = e.results[e.results.length - 1];
      if (!latest || !latest[0]) return;
      var command = heard(latest[0].transcript);
      if (!command) return;
      var now = Date.now();
      if (now - self.last < COOLDOWN) return;
      self.last = now;
      // restart rather than carry on: the transcript so far still contains the
      // word, and every further interim result would fire on it again
      self.restart();
      if (self.opts.onCommand) self.opts.onCommand(command);
    };
    rec.onerror = function (e) {
      var name = e && e.error;
      if (name === 'not-allowed' || name === 'service-not-allowed') {
        self.stop();
        self.report('blocked', name);
      } else if (name === 'audio-capture') {
        self.stop();
        self.report('no-mic', name);
      }
      // 'no-speech' and 'aborted' are ordinary; onend puts it back
    };
    rec.onend = function () {
      if (!self.on) { self.report('off'); return; }
      setTimeout(function () { self.listen(); }, 250);
    };

    try {
      rec.start();
    } catch (err) {
      // start() throws if the previous one has not finished letting go
      setTimeout(function () { if (self.on) self.listen(); }, 300);
    }
  };

  Voice.prototype.restart = function () {
    if (!this.rec) return;
    try { this.rec.abort(); } catch (err) { /* onend restarts it */ }
  };

  Voice.prototype.stop = function () {
    this.on = false;
    if (this.rec) {
      try { this.rec.abort(); } catch (err) { /* already gone */ }
      this.rec = null;
    }
    this.report('off');
  };

  Voice.prototype.toggle = function () {
    if (this.on) this.stop(); else this.start();
    return this.on;
  };

  Voice.supported = supported;
  Voice.heard = heard;
  root.CubeVoice = Voice;
  if (typeof module === 'object' && module.exports) module.exports = Voice;
})(typeof globalThis !== 'undefined' ? globalThis : this);
