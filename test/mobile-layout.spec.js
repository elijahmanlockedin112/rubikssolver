/*
 * npm run test:mobile
 *
 * Layout on a phone, on six emulated profiles: iPhone SE (375), iPhone 15
 * (393) and Pixel 7 (412), each in portrait and on its side. See
 * playwright.config.js for why the iPhones run on WebKit.
 *
 * WHAT THIS PROVES: the page never grows wider than the screen, every control
 * a finger has to hit is big enough to hit, the sticker map stays usable at
 * 2x2, 3x3 and 4x4, and the scanner's buttons are on screen and clear of the
 * notch and the home indicator.
 *
 * WHAT THIS DOES NOT PROVE: that the camera works, that a real six-face scan
 * assembles, that iOS Safari agrees, or how any of it feels in the hand.
 * Emulation has no camera and no cutout — the safe-area test below fakes the
 * insets, which checks this file's arithmetic and nothing about a real iPhone.
 * test/MOBILE-CHECKLIST.md is the list of what a human still has to do.
 *
 * Bars, measured rather than hoped for, on an iPhone SE under WebKit — 375px
 * is the tightest of the six profiles:
 *   - horizontal overflow: measured 0px after the fix, 1px before it (the
 *     panel's min-content width was 366px inside a 355px column). Bar: 0px.
 *   - controls: measured 44px+ after the fix. Before: 58x39 size buttons,
 *     40x44 swatches, a 110x16 speed slider, a 329x20 notation summary.
 *     Bar: 44px, which is Apple's own minimum.
 *   - stickers: measured 78.3 / 51.7 / 37.6px for 2x2 / 3x3 / 4x4 after the
 *     reflow, against 37.3 / 24.3 / 17.1px before it. The tightest of all six
 *     profiles is the same phone on its side, at 36.2px for a 4x4. Bar: 32px,
 *     under that with room to spare. Stickers get a bar of their own because
 *     96 of them at 44px would need a 700px-wide screen.
 */
var { test, expect } = require('@playwright/test');

var TAP_MIN = 44;       // px, Apple HIG; measured 44+ everywhere after the fix
var STICKER_MIN = 32;   // px; measured worst case 37.6 (4x4 at 375px)

var CONTROLS = 'button, input, summary, label.toggle, label.mode';

// ---------------------------------------------------------------- helpers

/** How far the document is wider than the window, and who is to blame. */
function overflow(page) {
  return page.evaluate(function () {
    var d = document.documentElement;
    var over = d.scrollWidth - d.clientWidth;
    var blame = [];
    if (over > 0) {
      document.querySelectorAll('body *').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > d.clientWidth + 0.5) {
          blame.push({
            tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
                 (el.className && el.className.baseVal === undefined && el.className
                   ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''),
            right: Math.round(r.right),
            width: Math.round(r.width)
          });
        }
      });
    }
    return { px: over, clientWidth: d.clientWidth, blame: blame.slice(0, 6) };
  });
}

/**
 * Every visible control that is too small for a finger.
 *
 * A checkbox or radio inside a <label> is let off on its own size: the label
 * is what you actually tap, so the label is what is measured. Stickers have
 * their own, smaller bar — 96 of them cannot each be 44px on a phone.
 */
function smallControls(page, scope, min) {
  return page.evaluate(function (arg) {
    var root = document.querySelector(arg.scope);
    if (!root) return [{ what: arg.scope + ' is not in the page', w: 0, h: 0 }];
    var bad = [];
    root.querySelectorAll(arg.sel).forEach(function (el) {
      if (el.classList.contains('sticker')) return;
      if (el.closest('[hidden]')) return;
      if (el.type === 'hidden') return;
      var target = el;
      if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
        target = el.closest('label');
      }
      var r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;           // display:none
      if (getComputedStyle(el).visibility === 'hidden') return;
      if (r.width + 0.5 < arg.min || r.height + 0.5 < arg.min) {
        bad.push({
          what: el.id || el.className || el.tagName,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10
        });
      }
    });
    return bad;
  }, { scope: scope, sel: CONTROLS, min: min });
}

/** The smallest sticker on the map right now. */
function smallestSticker(page) {
  return page.evaluate(function () {
    var min = Infinity;
    document.querySelectorAll('#net .sticker').forEach(function (el) {
      var r = el.getBoundingClientRect();
      min = Math.min(min, r.width, r.height);
    });
    return Math.round(min * 10) / 10;
  });
}

/** Every box in `sels` that is not wholly inside the window. */
function offScreen(page, sels) {
  return page.evaluate(function (list) {
    var bad = [];
    list.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) { bad.push({ sel: sel, why: 'missing' }); return; }
      var r = el.getBoundingClientRect();
      var out = [];
      if (r.top < -0.5) out.push('top ' + Math.round(r.top));
      if (r.left < -0.5) out.push('left ' + Math.round(r.left));
      if (r.bottom > innerHeight + 0.5) out.push('bottom ' + Math.round(r.bottom) + ' > ' + innerHeight);
      if (r.right > innerWidth + 0.5) out.push('right ' + Math.round(r.right) + ' > ' + innerWidth);
      if (out.length) bad.push({ sel: sel, why: out.join(', ') });
    });
    return bad;
  }, sels);
}

function pickSize(page, n) {
  return page.locator('.size-option[data-size="' + n + '"]').click();
}

/** Open the scanner. There is no camera here, so it opens and complains. */
async function openScanner(page) {
  await page.locator('#btn-scan').click();
  await expect(page.locator('#scanner')).toBeVisible();
  // let the getUserMedia rejection land and the error message reflow the card
  await page.waitForTimeout(400);
}

/** Scramble, solve, and land on the solve view. Kociemba builds tables first. */
async function goToSolve(page) {
  await page.locator('#btn-example').click();
  await page.locator('#btn-solve').click();
  await expect(page.locator('#view-solve')).toBeVisible({ timeout: 60000 });
}

test.beforeEach(async function ({ page }) {
  // localStorage carries the cube between visits; every test starts clean
  await page.addInitScript(function () {
    try { localStorage.clear(); } catch (e) { /* private mode */ }
  });
  await page.goto('/');
  // a page-load gate rather than an assertion about layout, so it gets its own
  // longer patience: six browsers on one laptop can take a while to get here
  await expect(page.locator('#net .sticker').first()).toBeVisible({ timeout: 30000 });
});

// ---------------------------------------------------------------- the tests

test('nothing overflows sideways, at any cube size', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    var o = await overflow(page);
    expect(o.px, n + 'x' + n + ' map overflows by ' + o.px + 'px in a ' +
      o.clientWidth + 'px window: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);
  }
});

test('the sticker map is big enough to hit, at any cube size', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    var got = await smallestSticker(page);
    expect(got, n + 'x' + n + ' stickers are ' + got + 'px').toBeGreaterThanOrEqual(STICKER_MIN);
  }
});

test('every control on the setup view is big enough to hit', async function ({ page }) {
  // 4x4 is the busiest the page ever gets
  await pickSize(page, 4);
  var bad = await smallControls(page, '#view-setup', TAP_MIN);
  expect(bad, 'under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);
});

test('the scanner fits on the screen with its buttons reachable', async function ({ page }) {
  await openScanner(page);

  // the camera preview is in the list because it was the thing that escaped:
  // a max-height taller than its grid row, centred, overflowed both ends and
  // left the card looking fine while the preview sat outside it
  var off = await offScreen(page,
    ['#scanner .modal-card', '.scan-stage', '#scan-capture', '#scan-undo', '#scan-close']);
  expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);

  // and inside the card it lives in, not lapping over the text above it
  var escaped = await page.evaluate(function () {
    var card = document.querySelector('#scanner .modal-card').getBoundingClientRect();
    var stage = document.querySelector('.scan-stage').getBoundingClientRect();
    var tip = document.getElementById('scan-tip').getBoundingClientRect();
    var why = [];
    if (stage.top < card.top - 0.5 || stage.bottom > card.bottom + 0.5) {
      why.push('the preview is outside its card (' + Math.round(stage.top) + '-' +
               Math.round(stage.bottom) + ' vs ' + Math.round(card.top) + '-' + Math.round(card.bottom) + ')');
    }
    if (stage.top < tip.bottom - 0.5 && stage.right > tip.left && stage.left < tip.right) {
      why.push('the preview covers the tip by ' + Math.round(tip.bottom - stage.top) + 'px');
    }
    return why;
  });
  expect(escaped, escaped.join('; ')).toEqual([]);

  // and the modal must not need scrolling to reach them
  var scrolls = await page.evaluate(function () {
    var m = document.getElementById('scanner');
    return m.scrollHeight - m.clientHeight;
  });
  expect(scrolls, 'the scanner modal scrolls by ' + scrolls + 'px').toBeLessThanOrEqual(0);

  var bad = await smallControls(page, '#scanner', TAP_MIN);
  expect(bad, 'under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);

  /*
   * The card is capped at the window height and its children are flex items,
   * which shrink by default — the heading and the tip were squeezed under the
   * camera stage and lost their last line. The tip is what tells you, on face
   * six, that however you are holding the cube is how the moves will be
   * written, so a clipped tip is a real loss and not a cosmetic one.
   */
  var clipped = await page.evaluate(function () {
    var out = [];
    ['#scan-title', '#scan-tip'].forEach(function (sel) {
      var el = document.querySelector(sel);
      var lost = el.scrollHeight - el.clientHeight;
      if (lost > 1) out.push({ sel: sel, lostPx: lost });
    });
    return out;
  });
  expect(clipped, 'text cut off: ' + JSON.stringify(clipped)).toEqual([]);

  var o = await overflow(page);
  expect(o.px, 'scanner overflows by ' + o.px + 'px: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);
});

test('the solve view fits and its controls are big enough to hit', async function ({ page }) {
  await goToSolve(page);

  var o = await overflow(page);
  expect(o.px, 'solve view overflows by ' + o.px + 'px: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);

  var bad = await smallControls(page, '#view-solve', TAP_MIN);
  expect(bad, 'under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);

  // stepping a move must not knock the layout out of shape
  await page.locator('#btn-next').click();
  await page.waitForTimeout(300);
  var after = await overflow(page);
  expect(after.px, 'overflows after one move: ' + JSON.stringify(after.blame)).toBeLessThanOrEqual(0);
});

/*
 * The notch and the home indicator.
 *
 * Emulation has neither, so env(safe-area-inset-*) is 0px here and the insets
 * in styles.css are all no-ops. Overriding the four --safe-* variables with an
 * iPhone 15's real numbers (59px top, 34px bottom in portrait; 59px on
 * whichever side the notch swung to in landscape) exercises the same
 * arithmetic against the same rules.
 *
 * This proves the CSS puts padding back where a cutout would be. It does NOT
 * prove iOS reports what is expected, or that viewport-fit=cover behaves — a
 * real iPhone is the only thing that settles that. See MOBILE-CHECKLIST.md.
 */
test('the scanner clears a simulated notch and home indicator', async function ({ page }, testInfo) {
  var landscape = testInfo.project.name.indexOf('landscape') >= 0;
  var inset = landscape
    ? { t: '0px', r: '59px', b: '21px', l: '59px' }
    : { t: '59px', r: '0px', b: '34px', l: '0px' };

  await page.addStyleTag({
    content: ':root{--safe-t:' + inset.t + ';--safe-r:' + inset.r +
             ';--safe-b:' + inset.b + ';--safe-l:' + inset.l + '}'
  });
  await openScanner(page);

  var bad = await page.evaluate(function (i) {
    var safe = {
      top: parseFloat(i.t), right: innerWidth - parseFloat(i.r),
      bottom: innerHeight - parseFloat(i.b), left: parseFloat(i.l)
    };
    var out = [];
    // the card as well as the buttons: it is small enough to sit centred and
    // clear of the insets by luck, which made a buttons-only check pass with
    // the modal's safe-area padding deliberately deleted
    ['#scanner .modal-card', '#scan-capture', '#scan-undo', '#scan-close'].forEach(function (sel) {
      var r = document.querySelector(sel).getBoundingClientRect();
      var why = [];
      if (r.top < safe.top - 0.5) why.push('under the notch (top ' + Math.round(r.top) + ' < ' + safe.top + ')');
      if (r.bottom > safe.bottom + 0.5) why.push('under the home indicator (bottom ' + Math.round(r.bottom) + ' > ' + safe.bottom + ')');
      if (r.left < safe.left - 0.5) why.push('past the left inset');
      if (r.right > safe.right + 0.5) why.push('past the right inset');
      if (why.length) out.push({ sel: sel, why: why.join('; ') });
    });
    return out;
  }, inset);

  expect(bad, 'inside the unsafe area: ' + JSON.stringify(bad)).toEqual([]);
});

test('the header clears a simulated notch', async function ({ page }) {
  await page.addStyleTag({ content: ':root{--safe-t:59px;--safe-r:0px;--safe-b:34px;--safe-l:0px}' });
  var top = await page.evaluate(function () {
    return Math.round(document.querySelector('.topbar .logo').getBoundingClientRect().top);
  });
  expect(top, 'the logo starts at y=' + top + ', inside a 59px notch').toBeGreaterThanOrEqual(59);
});
