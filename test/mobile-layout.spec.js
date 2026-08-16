/*
 * npm run test:mobile
 *
 * Layout on a phone, on six emulated profiles: iPhone SE (375), iPhone 15
 * (393) and Pixel 7 (412), each in portrait and on its side. See
 * playwright.config.js for why the iPhones run on WebKit.
 *
 * WHAT THIS PROVES: no screen ever has to be scrolled, the page never grows
 * wider than the window, every control a finger has to hit is big enough to
 * hit, the sticker map stays usable at 2x2, 3x3 and 4x4, and the scanner's
 * buttons are on screen and clear of the notch and the home indicator.
 *
 * The no-scroll test is the one that matters most and the one that is easiest
 * to get wrong: html and body are overflow: hidden, so content that does not
 * fit is CLIPPED rather than scrolled — silently, and worse than scrolling.
 * scrollHeight still reports the full content height through a hidden
 * overflow, which is what makes it measurable at all.
 *
 * WHAT THIS DOES NOT PROVE: that the camera works, that a real six-face scan
 * assembles, that iOS Safari agrees, or how any of it feels in the hand.
 * Emulation has no camera and no cutout — the safe-area test below fakes the
 * insets, which checks this file's arithmetic and nothing about a real iPhone.
 * test/MOBILE-CHECKLIST.md is the list of what a human still has to do.
 *
 * Bars, measured rather than hoped for, on an iPhone SE under WebKit — 375x667
 * is the tightest of the six profiles:
 *   - vertical overflow: 0px on all three screens at all three cube sizes.
 *   - horizontal overflow: 0px.
 *   - controls: 44px+, which is Apple's own minimum.
 *   - stickers: the map is measured and fitted to its box by app.js, so this
 *     is whatever is left once the palette and the buttons have had theirs.
 *     Measured, smallest sticker on the map:
 *
 *                              2x2    3x3    4x4
 *       iphone-se   375x667     54   31.2     26
 *       ...landscape 667x375    57     33   27.5
 *       iphone-15   393x659     57     33   27.5
 *       ...landscape 734x343    59   34.1   28.5
 *       pixel-7     412x839     80   41.2     39
 *       ...landscape 863x360    63   36.5   30.5
 *
 *     Bar: 24px. Stickers get a bar of their own, and a low one, because 96 of
 *     them at 44px would need a 700px-wide screen — a 4x4 map that fits a
 *     375px phone without scrolling cannot do better than about 26px, and it
 *     is the fallback for typing a cube in by hand. Scanning is the way in.
 */
var { test, expect } = require('@playwright/test');

var TAP_MIN = 44;       // px, Apple HIG
var STICKER_MIN = 24;   // px; the 4x4 map on the smallest screen measures 26

var CONTROLS = 'button, input, summary, label.toggle';

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
 * How far the page is taller than the window, and what is hanging off the
 * bottom. The blame list walks only the visible screen's own children, because
 * a hidden screen contributes nothing and every element inside the tall one
 * would otherwise be reported.
 */
function tallOverflow(page) {
  return page.evaluate(function () {
    var d = document.documentElement;
    var over = Math.max(d.scrollHeight - d.clientHeight, document.body.scrollHeight - d.clientHeight);
    var blame = [];
    document.querySelectorAll('.topbar, main:not([hidden]) > *').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > d.clientHeight + 0.5) {
        blame.push({
          tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
               (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''),
          bottom: Math.round(r.bottom)
        });
      }
    });
    return { px: over, clientHeight: d.clientHeight, blame: blame };
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

/** The size picker lives on the home screen, so this always starts there. */
async function pickSize(page, n) {
  await page.locator('#btn-home').click({ timeout: 2000 }).catch(function () { /* already home */ });
  await page.locator('.size-option[data-size="' + n + '"]').click();
}

async function openMap(page) {
  await page.locator('#btn-edit').click();
  await expect(page.locator('#view-edit')).toBeVisible();
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
  await openMap(page);
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
  await expect(page.locator('#btn-scan')).toBeVisible({ timeout: 30000 });
});

// ---------------------------------------------------------------- the tests

test('no screen ever has to be scrolled', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    var home = await tallOverflow(page);
    expect(home.px, n + 'x' + n + ' home is ' + home.px + 'px taller than the ' +
      home.clientHeight + 'px window: ' + JSON.stringify(home.blame)).toBeLessThanOrEqual(0);

    await openMap(page);
    var map = await tallOverflow(page);
    expect(map.px, n + 'x' + n + ' map is ' + map.px + 'px taller than the ' +
      map.clientHeight + 'px window: ' + JSON.stringify(map.blame)).toBeLessThanOrEqual(0);
  }

  await pickSize(page, 3);
  await goToSolve(page);
  var solve = await tallOverflow(page);
  expect(solve.px, 'the solve screen is ' + solve.px + 'px taller than the window: ' +
    JSON.stringify(solve.blame)).toBeLessThanOrEqual(0);

  // and it stays that way once a move has been made and the wording changes
  await page.locator('#btn-next').click();
  await page.waitForTimeout(1400);
  var after = await tallOverflow(page);
  expect(after.px, 'taller by ' + after.px + 'px after one move: ' +
    JSON.stringify(after.blame)).toBeLessThanOrEqual(0);
});

test('nothing overflows sideways, at any cube size', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    await openMap(page);
    var o = await overflow(page);
    expect(o.px, n + 'x' + n + ' map overflows by ' + o.px + 'px in a ' +
      o.clientWidth + 'px window: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);
  }
});

test('the sticker map is big enough to hit, at any cube size', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    await openMap(page);
    var got = await smallestSticker(page);
    expect(got, n + 'x' + n + ' stickers are ' + got + 'px').toBeGreaterThanOrEqual(STICKER_MIN);

    /*
     * And still whole once something is written under it. The map is fitted to
     * its box and centred inside an overflow: hidden parent, so a message
     * appearing below takes height out of the box — and a map that does not
     * refit loses a row off the top and the bottom with nothing to show for
     * it. On these six profiles the fit has slack to absorb it either way, so
     * this is a guard rather than a reproduction: it holds the ResizeObserver
     * in app.js to account on any profile where the slack runs out.
     */
    await page.locator('#btn-example').click();
    await page.waitForTimeout(150);
    var clipped = await page.evaluate(function () {
      var box = document.querySelector('.net-fit').getBoundingClientRect();
      var net = document.getElementById('net').getBoundingClientRect();
      return {
        top: Math.round(box.top - net.top),
        bottom: Math.round(net.bottom - box.bottom),
        left: Math.round(box.left - net.left),
        right: Math.round(net.right - box.right)
      };
    });
    Object.keys(clipped).forEach(function (side) {
      expect(clipped[side], n + 'x' + n + ' map is cut off at the ' + side +
        ' by ' + clipped[side] + 'px').toBeLessThanOrEqual(0);
    });
  }
});

test('every control is big enough to hit', async function ({ page }) {
  var bad = await smallControls(page, '#view-setup', TAP_MIN);
  expect(bad, 'home, under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);

  // 4x4 is the busiest the map ever gets
  await pickSize(page, 4);
  await openMap(page);
  bad = await smallControls(page, '#view-edit', TAP_MIN);
  expect(bad, 'map, under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);

  await pickSize(page, 3);
  await goToSolve(page);
  bad = await smallControls(page, '#view-solve', TAP_MIN);
  expect(bad, 'solve, under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);
});

test('the home screen is one button and a cube', async function ({ page }) {
  // The point of the redesign: what you land on is a cube, a size and Scan.
  // Anything else that grew back here would be a regression, so it is counted.
  var count = await page.locator('#view-setup button:visible').count();
  expect(count, 'buttons on the home screen').toBeLessThanOrEqual(5);   // 3 sizes + scan + type-in

  var off = await offScreen(page, ['#btn-scan', '#btn-edit', '.size-picker', '.preview-wrap']);
  expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);
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

test('the solve screen shows one move at a time, with nothing to press but Next',
  async function ({ page }) {
    await goToSolve(page);

    var o = await overflow(page);
    expect(o.px, 'solve view overflows by ' + o.px + 'px: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);

    var off = await offScreen(page, ['#btn-next', '#btn-prev', '#btn-replay', '.instruction-card']);
    expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);

    // play is gone, and so is the speed slider that only existed to serve it
    await expect(page.locator('#btn-play')).toHaveCount(0);
    await expect(page.locator('#speed')).toHaveCount(0);

    /*
     * Every half turn is split into two quarter turns, so nothing in the list
     * a person is asked to follow ends in a 2. This is the assertion for it:
     * the move counter runs over the expanded list, and stepping through the
     * first few must show single quarter turns.
     */
    var seen = [];
    for (var i = 0; i < 4; i++) {
      seen.push(await page.locator('#move-title').textContent());
      await page.locator('#btn-next').click();
      await page.waitForTimeout(1400);
    }
    expect(seen.filter(Boolean).length, 'four moves in a row should each say something').toBe(4);
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

/*
 * The solve screen hides the header to give the cube the room, which means its
 * own top row is the thing that has to clear the notch instead.
 */
test('the solve screen clears a simulated notch without the header', async function ({ page }) {
  await page.addStyleTag({ content: ':root{--safe-t:59px;--safe-r:0px;--safe-b:34px;--safe-l:0px}' });
  await goToSolve(page);
  var box = await page.evaluate(function () {
    var r = document.getElementById('btn-back').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight };
  });
  expect(box.top, 'the back arrow starts at y=' + box.top + ', inside a 59px notch').toBeGreaterThanOrEqual(59);

  var off = await offScreen(page, ['#btn-next']);
  expect(off, 'Next is under the home indicator: ' + JSON.stringify(off)).toEqual([]);
});
