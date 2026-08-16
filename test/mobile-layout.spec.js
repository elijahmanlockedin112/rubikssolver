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
 *   - stickers: the editor shows one face at a time and app.js fits it to the
 *     box, so a sticker is whatever is left once the guidance cube, the
 *     palette and the buttons have had theirs. Six faces at once could not do
 *     better than 26px for a 4x4 on a 375px phone; one face is three times
 *     that. Bar: 44px, the same as every other control — with one face there
 *     is no reason for stickers to have a bar of their own any more.
 */
var { test, expect } = require('@playwright/test');

var TAP_MIN = 44;       // px, Apple HIG
var STICKER_MIN = 44;   // px; one face at a time, so a sticker is a control too

var CONTROLS = 'button, input, summary';

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
 * Stickers are measured separately, by smallestSticker, purely so a failure
 * says which of the two things went wrong — the bar is the same 44px now that
 * the editor shows one face at a time.
 */
function smallControls(page, scope, min) {
  return page.evaluate(function (arg) {
    var root = document.querySelector(arg.scope);
    if (!root) return [{ what: arg.scope + ' is not in the page', w: 0, h: 0 }];
    var bad = [];
    root.querySelectorAll(arg.sel).forEach(function (el) {
      if (el.classList.contains('sticker')) return;
      if (el.closest('[hidden]')) return;
      if (el.hidden || el.type === 'hidden') return;
      var r = el.getBoundingClientRect();
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

/** Back to the home screen from wherever we are — each screen has its own way. */
async function goHome(page) {
  await page.evaluate(function () {
    if (!document.getElementById('view-solve').hidden) document.getElementById('btn-back').click();
    else if (!document.getElementById('view-edit').hidden) document.getElementById('btn-home').click();
  });
  await expect(page.locator('#view-setup')).toBeVisible();
}

/** The size picker lives on the home screen, so this always starts there. */
async function pickSize(page, n) {
  await goHome(page);
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

test('the face being painted is big enough to hit, at any cube size', async function ({ page }) {
  for (var n of [2, 3, 4]) {
    await pickSize(page, n);
    await openMap(page);
    var got = await smallestSticker(page);
    expect(got, n + 'x' + n + ' stickers are ' + got + 'px').toBeGreaterThanOrEqual(STICKER_MIN);

    /*
     * And still whole once something is written under it. The face is fitted
     * to its box and centred inside an overflow: hidden parent, so a message
     * appearing below takes height out of the box — and a face that does not
     * refit loses a row off the top and the bottom with nothing to show for
     * it. The ResizeObserver in app.js is what this holds to account.
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
      expect(clipped[side], n + 'x' + n + ' face is cut off at the ' + side +
        ' by ' + clipped[side] + 'px').toBeLessThanOrEqual(0);
    });
  }
});

/*
 * The map is a guided walk now: one face, the grey cube beside it showing
 * which face and how to get to the next, six steps, then solve. The thing
 * being checked here is that the walk holds together — the same six-step route
 * the scanner uses, ending on a button that solves rather than one that asks
 * for a seventh face.
 */
test('the map walks six faces, one at a time', async function ({ page }) {
  await openMap(page);
  await expect(page.locator('#edit-guide-canvas')).toBeVisible();

  var seen = [];
  for (var i = 0; i < 6; i++) {
    // exactly one face on screen, never the whole cube
    var faces = await page.locator('#net .face').count();
    expect(faces, 'faces on screen at step ' + (i + 1)).toBe(1);
    seen.push(await page.locator('#edit-guide-text').textContent());
    if (i < 5) {
      await page.locator('#btn-edit-next').click();
      await page.waitForTimeout(1000);   // the cube turns between faces
    }
  }

  expect(seen[0], 'the first step should say how to hold it').toMatch(/Face 1 of 6/);
  expect(seen[5], 'the last step').toMatch(/Face 6 of 6/);
  expect(new Set(seen).size, 'each step should say something different').toBe(6);
  await expect(page.locator('#btn-edit-next')).toHaveText(/Solve/);
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

test('the home screen is a cube, a size, a choice and Scan', async function ({ page }) {
  /*
   * Counted by name rather than by number, so this says what the home screen
   * is rather than how much of it there is. Anything that grows back onto it
   * has to be added here deliberately — which is the point, since the density
   * of this screen is the thing that got rebuilt.
   */
  var ids = await page.evaluate(function () {
    return [].filter.call(document.querySelectorAll('#view-setup button'), function (b) {
      return b.offsetParent !== null;
    }).map(function (b) { return b.id || b.className; });
  });
  expect(ids.sort().join(','), 'buttons on the home screen').toBe(
    ['size-option', 'size-option is-active', 'size-option',
     'mode-option is-active', 'mode-option', 'btn-scan', 'btn-edit'].sort().join(','));

  var off = await offScreen(page,
    ['#btn-scan', '#btn-edit', '.size-picker', '.mode-picker', '.preview-wrap']);
  expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);
});

/*
 * Academy mode: the beginner method, on the cube that was actually scanned.
 *
 * What makes it teaching rather than a longer list of moves is the structure —
 * seven stages that are always seven, a lesson before each one, and the
 * algorithm named and written out with your place in it. Those are the things
 * checked here, because those are the things that would quietly stop
 * appearing.
 */
test('academy teaches the beginner method on your own scramble', async function ({ page }) {
  await page.locator('.mode-option[data-mode="academy"]').click();
  await goToSolve(page);

  /*
   * The first thing it says is how to hold the cube. The whole method is
   * written for white on the bottom, so the turn that puts it there comes
   * before any stage, before any move — and the cube on screen is already
   * showing the result, because matching a picture is the least ambiguous
   * instruction there is.
   */
  await expect(page.locator('#stage-line')).toContainText(/Before you start/i);
  await expect(page.locator('#move-detail')).toContainText(/white/i);
  await expect(page.locator('#btn-next')).toHaveText(/what is first/i);
  await page.locator('#btn-next').click();

  // eight stages, whatever this particular cube needed, starting at the daisy
  await expect(page.locator('.stage-dot')).toHaveCount(8);
  await expect(page.locator('#stage-line')).toContainText('of 8');
  await expect(page.locator('#move-title')).toContainText(/daisy/i);

  // and it opens each stage on the lesson, not on a move
  await expect(page.locator('#btn-next')).toHaveText(/Start this stage/);
  await expect(page.locator('#academy-note')).toBeVisible();
  var goal = await page.locator('#move-detail').textContent();
  expect(goal.length, 'the stage should say what it is for').toBeGreaterThan(30);

  await page.locator('#btn-next').click();
  await expect(page.locator('#move-counter')).toHaveText(/Move 1 of/);

  // the piece stages place four pieces each, and say which
  await expect(page.locator('#academy-note')).toContainText(/Piece \d of \d/);
  await expect(page.locator('#stage-line')).toContainText(/·\s*\d+\/\d+/);

  /*
   * And the cross being built is the WHITE one.
   *
   * This is the whole point of turning the cube first, and it is checkable
   * from the outside because the pieces are named by colour: every edge the
   * daisy fetches is a white one, whichever way up the cube was scanned. It
   * also catches the recolouring bug it replaced — the beginner solver works
   * in solver space, where a facelet holds a face number rather than a palette
   * colour, and handing those states to the renderer repaints the entire cube
   * while still looking like a plausible scramble. What gave that away was not
   * the picture: it was a piece described as "the blue and green edge" on a
   * cube whose bottom was yellow.
   */
  await expect(page.locator('#academy-note'),
    'the daisy fetches white edges, whatever way up the cube was scanned')
    .toContainText(/white/i);

  // and the lesson can be reopened without losing your place
  var before = await page.locator('#move-counter').textContent();
  await page.locator('#stage-line').click();
  await expect(page.locator('#btn-next')).toHaveText(/Back to the moves/);
  await page.locator('#btn-next').click();
  expect(await page.locator('#move-counter').textContent(), 'reopening the lesson lost your place')
    .toBe(before);

  var o = await tallOverflow(page);
  expect(o.px, 'academy is ' + o.px + 'px too tall: ' + JSON.stringify(o.blame)).toBeLessThanOrEqual(0);
  var bad = await smallControls(page, '#view-solve', TAP_MIN);
  // the stage dots are a strip of seven across a 375px screen; they get the
  // same exemption the stickers used to, and for the same arithmetic reason
  bad = bad.filter(function (b) { return String(b.what).indexOf('stage-dot') < 0; });
  expect(bad, 'academy, under ' + TAP_MIN + 'px: ' + JSON.stringify(bad)).toEqual([]);

  // and back to the direct answer on the same cube, without rescanning
  await page.locator('#btn-mode').click();
  await expect(page.locator('#stage-strip')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('#move-counter')).toHaveText(/Move 1 of/);
});

test('the scanner fits on the screen with its buttons reachable', async function ({ page }) {
  await openScanner(page);

  // the camera preview is in the list because it was the thing that escaped:
  // a max-height taller than its grid row, centred, overflowed both ends and
  // left the card looking fine while the preview sat outside it
  var off = await offScreen(page,
    ['#scanner .modal-card', '.scan-stage', '#scan-guide-canvas',
     '#scan-capture', '#scan-undo', '#scan-close']);
  expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);

  /*
   * Two cubes, both of them on screen. The second one is what lets someone
   * check the read before a solution is written for it, and a scanner that
   * quietly drops it below the fold on the smallest phone has lost the point
   * of this screen rather than a nicety.
   */
  var both = await page.evaluate(function () {
    var stage = document.querySelector('.scan-stage').getBoundingClientRect();
    var guide = document.getElementById('scan-guide-canvas').getBoundingClientRect();
    return { camera: Math.round(stage.height), guide: Math.round(guide.height) };
  });
  expect(both.camera, 'the camera preview is ' + both.camera + 'px tall').toBeGreaterThan(80);
  expect(both.guide, 'the cube being built is ' + both.guide + 'px tall').toBeGreaterThan(50);

  // and inside the card it lives in, not lapping over the heading above it
  var escaped = await page.evaluate(function () {
    var card = document.querySelector('#scanner .modal-card').getBoundingClientRect();
    var stage = document.querySelector('.scan-stage').getBoundingClientRect();
    var title = document.getElementById('scan-title').getBoundingClientRect();
    var why = [];
    if (stage.top < card.top - 0.5 || stage.bottom > card.bottom + 0.5) {
      why.push('the preview is outside its card (' + Math.round(stage.top) + '-' +
               Math.round(stage.bottom) + ' vs ' + Math.round(card.top) + '-' + Math.round(card.bottom) + ')');
    }
    if (stage.top < title.bottom - 0.5 && stage.right > title.left && stage.left < title.right) {
      why.push('the preview covers the heading by ' + Math.round(title.bottom - stage.top) + 'px');
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
    ['#scan-title', '#scan-guide-text'].forEach(function (sel) {
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

    var off = await offScreen(page,
      ['#btn-next', '#btn-prev', '#btn-replay', '#btn-restart', '.instruction-card']);
    expect(off, 'off screen: ' + JSON.stringify(off)).toEqual([]);

    // play is gone, and so is the speed slider that only existed to serve it
    await expect(page.locator('#btn-play')).toHaveCount(0);
    await expect(page.locator('#speed')).toHaveCount(0);
    // and so is the second cube: one fixed view, nothing to drag, nothing in
    // the corner showing three faces you are not being asked to look at
    await expect(page.locator('#solve-back-canvas')).toHaveCount(0);
    await expect(page.locator('#view-solve .cube-canvas')).toHaveCount(1);

    // the way out when the cube in your hand stopped matching the one on screen
    await expect(page.locator('#btn-restart')).toBeVisible();

    /*
     * The colours the cube is drawn in are checked in the Academy test rather
     * than here, and by name rather than by pixel. A pixel is the obvious way
     * and a bad one: the layer about to turn is drawn at full strength and
     * everything else at 42%, so what a sample returns depends on which move
     * happens to be next. Academy names the piece it is fetching, and with the
     * solver-space states that once got handed to the renderer that name comes
     * out as "the blue and green edge" on a cube whose bottom is white — which
     * is the same bug, caught by something that cannot be dimmed.
     */

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

/**
 * How far a canvas is being stretched: the shape of its box against the shape
 * of the pixels inside it. 1 is square; 2 means everything is drawn twice as
 * tall as it should be.
 */
function stretch(page, selector) {
  return page.evaluate(function (sel) {
    var c = document.querySelector(sel);
    if (!c) return { missing: sel };
    var box = c.getBoundingClientRect();
    if (!c.width || !c.height || !box.height) return { missing: sel + ' has no size' };
    return {
      ratio: (box.width / box.height) / (c.width / c.height),
      css: Math.round(box.width) + 'x' + Math.round(box.height),
      backing: c.width + 'x' + c.height
    };
  }, selector);
}

async function expectSquare(page, selector, where) {
  var s = await stretch(page, selector);
  expect(s.missing, 'missing canvas: ' + s.missing).toBeUndefined();
  expect(Math.abs(s.ratio - 1) < 0.02,
    where + ': ' + selector + ' is drawn ' + s.ratio.toFixed(2) + 'x out of shape — ' +
    'its box is ' + s.css + ' and its pixels are ' + s.backing).toBe(true);
}

/*
 * The cube is never drawn the wrong shape.
 *
 * A canvas has two sizes — the box CSS gives it, and the grid of pixels inside
 * it — and if they disagree the browser stretches one onto the other silently.
 * The measurement is cached (it used to be taken every frame, which laid the
 * page out sixty times a second per view), so the cache has to be told when the
 * box changes. Becoming visible tells it and a window resize tells it, and
 * between them they missed the ordinary case: a screen that is already up and
 * rearranges underneath. Switching a solve into Academy grows the instruction
 * card and adds the stage strip, and the cube was left 2.2x too tall.
 *
 * Every canvas, on every screen, including across a mode switch.
 */
test('the cube is never drawn out of shape', async function ({ page }) {
  await expectSquare(page, '#preview-front', 'home');
  await expectSquare(page, '#preview-back', 'home');

  // the scanner opens from the home screen, so it goes first
  await openScanner(page);
  await expectSquare(page, '#scan-guide-canvas', 'the scanner');
  await page.locator('#scan-close').click();

  await openMap(page);
  await expectSquare(page, '#edit-guide-canvas', 'the map');

  // already on the map, so solve from here rather than going round again
  await page.locator('#btn-example').click();
  await page.locator('#btn-solve').click();
  await expect(page.locator('#view-solve')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(300);
  await expectSquare(page, '#solve-front-canvas', 'solving');

  // the switch that broke it: same screen, rearranged underneath
  await page.locator('#btn-mode').click();
  await expect(page.locator('#stage-strip')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(300);
  await expectSquare(page, '#solve-front-canvas', 'switched to Academy');

  await page.locator('#btn-mode').click();
  await expect(page.locator('#stage-strip')).toBeHidden({ timeout: 60000 });
  await page.waitForTimeout(300);
  await expectSquare(page, '#solve-front-canvas', 'switched back');
});

/*
 * The same face photographed twice, caught at the time.
 *
 * A 3x3 is named by its centre sticker and a repeat was always refused here. A
 * 2x2 and a 4x4 have no such sticker and had no check at all: the duplicate
 * went in silently and six photos later the assembler said they did not add up
 * to a real cube, which is true, useless, and blames the wrong step. This is
 * the logic on its own — no camera needed, which is why it can run here.
 */
test('a face already photographed is recognised without a centre sticker', async function ({ page }, testInfo) {
  test.skip(testInfo.project.name !== 'iphone-se', 'logic, not layout — one profile is enough');

  var verdicts = await page.evaluate(function () {
    // four stickers, as the detector hands them over: [r,g,b] each
    var RED = [220, 30, 20], GREEN = [30, 170, 80], BLUE = [20, 90, 190], WHITE = [235, 235, 232];
    var face = [RED, GREEN, BLUE, WHITE];
    // the same face a quarter turn round, and a shade darker for good measure.
    // Row-major [a,b,c,d] turned 90 degrees is [c,a,d,b].
    var again = [BLUE, RED, WHITE, GREEN].map(function (c) {
      return c.map(function (v) { return Math.round(v * 0.93); });
    });
    var other = [GREEN, GREEN, RED, BLUE];

    var stub = Object.create(window.CubeScanner.prototype);
    stub.size = 2;
    stub.samples = [face];
    stub.centers = [];
    return {
      itself: stub.sameFaceAlreadyTaken(face, null),
      turnedAndDimmer: stub.sameFaceAlreadyTaken(again, null),
      different: stub.sameFaceAlreadyTaken(other, null)
    };
  });

  expect(verdicts.itself, 'the same face should be spotted as photo 1').toBe(0);
  expect(verdicts.turnedAndDimmer,
    'the same face turned a quarter round is still the same face').toBe(0);
  expect(verdicts.different, 'a different face has to get through').toBe(-1);
});

/*
 * The end of a solve, and the way out of a bad one.
 *
 * One profile, not six: what this checks is behaviour, not layout, and it
 * costs a whole solve in real time to get there — a 2x2, because eleven moves
 * at a second each is the shortest honest route to the finish.
 */
test('finishing throws confetti, and there is a way back when it did not', async function ({ page }, testInfo) {
  test.skip(testInfo.project.name !== 'iphone-se', 'behaviour, not layout — one profile is enough');
  test.setTimeout(120000);

  await pickSize(page, 2);
  await goToSolve(page);

  // mid-solve it is an escape hatch, and says so
  await expect(page.locator('#btn-restart')).toHaveText(/Not solved/);

  var total = parseInt((await page.locator('#move-counter').textContent()).match(/of (\d+)/)[1], 10);
  for (var i = 0; i < total; i++) {
    await page.locator('#btn-next').click();
    await page.waitForTimeout(1250);
  }

  await expect(page.locator('#move-title')).toHaveText(/Solved/);
  await expect(page.locator('#instruction-card')).toHaveClass(/is-solved/);
  await expect(page.locator('#confetti')).toBeVisible();
  var o = await tallOverflow(page);
  expect(o.px, 'the finished screen is ' + o.px + 'px too tall').toBeLessThanOrEqual(0);

  // and the button that was an escape hatch is now the obvious next thing —
  // same button, same handler, so pressing it here covers both
  await expect(page.locator('#btn-restart')).toHaveText(/Scan another/);
  await page.locator('#btn-restart').click();
  await expect(page.locator('#scanner')).toBeVisible();
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
