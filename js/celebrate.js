/*
 * celebrate.js — confetti, for the one moment in this app that deserves it.
 *
 * Canvas, no library, no images: a few dozen rectangles with gravity, drag and
 * a bit of spin, drawn thinner as they turn edge-on so they read as paper
 * rather than as blocks. It runs for a couple of seconds and puts itself away.
 *
 * Reduced motion is not ignored and not obeyed by doing nothing: a solve that
 * ends with no acknowledgement at all is worse than a quiet one. It drops to a
 * dozen slow pieces that drift and fade, with no spin and no burst.
 */
;(function (root) {
  'use strict';

  var DEFAULT_COLORS = ['#f4f5f7', '#ffd23f', '#00a651', '#0a58c2', '#d8283c', '#ff8c1a'];

  function reducedMotion() {
    return typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function fire(canvas, opts) {
    if (!canvas || !canvas.getContext) return function () {};
    opts = opts || {};
    var colors = opts.colors || DEFAULT_COLORS;
    var gentle = reducedMotion();
    var count = gentle ? 14 : (opts.count || 90);
    var life = gentle ? 2600 : (opts.duration || 2600);

    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = w;
    canvas.height = h;

    var bits = [];
    for (var i = 0; i < count; i++) {
      // fired from two low corners, the way a party popper actually goes
      var left = i % 2 === 0;
      var speed = (gentle ? 2.5 : 9 + Math.random() * 7) * dpr;
      var angle = gentle
        ? -Math.PI / 2 + (Math.random() - 0.5) * 1.2
        : (left ? -Math.PI / 3 : -Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.7;
      bits.push({
        x: gentle ? Math.random() * w : (left ? 0.08 : 0.92) * w,
        y: gentle ? h * (0.3 + Math.random() * 0.5) : h * 0.98,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: gentle ? 0 : (Math.random() - 0.5) * 0.4,
        turn: Math.random() * Math.PI,
        size: (gentle ? 6 : 5 + Math.random() * 6) * dpr,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }

    var start = null, raf = 0, stopped = false;
    function frame(now) {
      if (stopped) return;
      if (start === null) start = now;
      var t = (now - start) / life;
      if (t >= 1) { ctx.clearRect(0, 0, w, h); return; }

      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = t < 0.75 ? 1 : (1 - t) / 0.25;
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        b.vy += (gentle ? 0.04 : 0.35) * dpr;   // gravity
        b.vx *= 0.985;                          // drag
        b.vy *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.turn += b.spin;
        // |cos| of the tumble angle, so a piece edge-on is a thin line
        var squash = Math.abs(Math.cos(b.turn));
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - b.size / 2, b.y - b.size * squash, b.size, Math.max(1, b.size * 1.6 * squash));
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return function cancel() {
      stopped = true;
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }

  var api = { fire: fire, reducedMotion: reducedMotion };
  root.Celebrate = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
