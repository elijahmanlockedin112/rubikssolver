/*
 * npm run test:camera
 *
 * The scanner, all of it, driven by a fake camera: getUserMedia, the live loop,
 * auto-capture, six faces, the assembler, and the map filling in.
 *
 * test/autosnap.test.js already asks whether the decision to fire is a good one,
 * over hundreds of rendered looks. This asks the different question of whether
 * any of it is plugged in — and it is the only automated thing that answers it,
 * because everything else in the repo stops at the edge of the DOM.
 *
 * It has caught two things a unit test could not:
 *
 *   - the live loop never stopped. The sixth photo closes the scanner from
 *     inside the loop, so cancelAnimationFrame was cancelling the frame it was
 *     already running, and the bottom of the same function scheduled another.
 *     The detector kept running several times a second, on a stopped video, for
 *     the life of the page. Silent until auto-capture made it talk.
 *   - the flash never plays on the sixth photo, because the modal is hidden
 *     within the same tick. Left alone — the scanner vanishing and the map
 *     filling in is louder feedback than a blink — but worth knowing.
 *
 * See playwright.camera.config.js for why this is Chromium-only, and
 * test/MOBILE-CHECKLIST.md for what a fake camera still cannot say.
 */
var { test, expect } = require('@playwright/test');

/** Open the scanner and watch it work, reporting what a person would see. */
async function scan(page, size, seconds) {
  await page.goto('/');
  await page.evaluate(function () { try { localStorage.clear(); } catch (e) { /* private mode */ } });
  await page.reload();
  await expect(page.locator('#net .sticker').first()).toBeVisible({ timeout: 30000 });
  await page.locator('.size-option[data-size="' + size + '"]').click();

  // count the shutter blinks and the live-loop ticks from the outside
  await page.evaluate(function () {
    window.__flashes = 0;
    window.__ticks = 0;
    var orig = window.CubeScanner.prototype.loop;
    window.CubeScanner.prototype.loop = function () { window.__ticks++; return orig.apply(this, arguments); };
    document.getElementById('scan-flash')
      .addEventListener('animationstart', function () { window.__flashes++; });
  });

  await page.locator('#btn-scan').click();
  await expect(page.locator('#scanner')).toBeVisible();

  var closedAfter = null;
  for (var i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000);
    var open = await page.evaluate(function () { return !document.getElementById('scanner').hidden; });
    if (!open) { closedAfter = i + 1; break; }
  }

  return Object.assign({ closedAfter: closedAfter }, await page.evaluate(function () {
    var stickers = document.querySelectorAll('#net .sticker');
    return {
      faces: document.querySelectorAll('.scan-chip.is-done').length,
      flashes: window.__flashes,
      ticks: window.__ticks,
      open: !document.getElementById('scanner').hidden,
      scanMessage: document.getElementById('scan-message').textContent.trim(),
      setupMessage: document.getElementById('setup-message').textContent.trim(),
      painted: [].filter.call(stickers, function (s) { return !!s.style.background; }).length,
      total: stickers.length
    };
  }));
}

test('the scanner reads a whole cube without being touched', async function ({ page }, testInfo) {
  var meta = testInfo.project.metadata;

  if (meta.expect === 'once') {
    /*
     * One face, held up and never turned away. This is the whole double-capture
     * question: without a rearm the loop photographs the same face again on the
     * next look, and again, and fills all six slots in about four seconds with
     * six pictures of one face — which then cannot assemble, for no reason the
     * scanner can explain.
     *
     * These scenarios are a 2x2 and a 4x4 because those have no centre sticker.
     * capture() already refuses a 3x3 face whose middle matches one it has, so
     * a 3x3 sat here at one photo with the rearm deliberately deleted and said
     * nothing about it.
     */
    var held = await scan(page, meta.size, 22);
    expect(held.faces, 'twenty-two seconds of one face gave ' + held.faces + ' photos').toBe(1);
    expect(held.flashes, 'one photo should be one blink').toBe(1);
    expect(held.open, 'the scanner should still be waiting, not finished').toBe(true);
    expect(held.scanMessage.toLowerCase(),
      'it should be asking for a different face, not sitting silent').toContain('turn the cube');
    return;
  }

  // six faces, each held up for about a second and a half, nothing touched
  var got = await scan(page, meta.size, 25);
  expect(got.closedAfter, 'the scanner never finished; it had ' + got.faces + ' of 6').not.toBeNull();
  expect(got.faces, 'faces captured').toBe(6);
  expect(got.painted, 'the map should be filled in').toBe(got.total);
  expect(got.total, 'a ' + meta.size + 'x' + meta.size + ' has ' + (6 * meta.size * meta.size) + ' stickers')
    .toBe(6 * meta.size * meta.size);

  /*
   * Five, not six. The sixth photo closes the scanner in the same tick it is
   * taken, so the animation never starts. Asserted as five rather than quietly
   * allowed, so that if the closing is ever delayed this says so.
   */
  expect(got.flashes, 'a blink per photo except the last, which closes the scanner').toBe(5);

  // and the whole thing said something true about the cube it read
  expect(got.setupMessage.toLowerCase()).toMatch(/scanned/);

  // the live loop must be stopped, not merely invisible
  var before = await page.evaluate(function () { return window.__ticks; });
  await page.waitForTimeout(1500);
  var after = await page.evaluate(function () { return window.__ticks; });
  expect(after - before, 'the live loop is still running with the scanner closed').toBe(0);
});
