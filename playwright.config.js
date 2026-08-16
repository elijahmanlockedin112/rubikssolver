/*
 * Playwright config for the mobile layout suite. `npm run test:mobile`.
 *
 * This is the ONLY thing in the repo with a dependency, and it is a
 * devDependency: the app itself is still plain files with no build step. See
 * tools/mobile-test.js, which is what the npm script actually runs — it checks
 * whether Playwright is installed and says so plainly rather than exploding.
 *
 * The iPhone profiles run on WebKit because that is the engine iOS Safari is
 * built on, so it is the closest thing to the real target available on
 * Windows. It is still not iOS Safari: no camera, no real touch, no notch, no
 * Safari chrome collapsing as you scroll. What it does catch is layout, and
 * everything it cannot is written down in test/MOBILE-CHECKLIST.md.
 */
var { defineConfig, devices } = require('@playwright/test');

var BASE = 'http://127.0.0.1:8123';

module.exports = defineConfig({
  testDir: './test',
  testMatch: /mobile-layout\.spec\.js/,
  // The solve view waits on a real Kociemba table build, and six profiles all
  // want one at once.
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: true,
  /*
   * Two, not three. Six browsers over three workers on a laptop that is also
   * building Kociemba tables in one of them left pages taking longer to reach
   * `load` than the 10s an expect waits, and two tests failed on a machine
   * that was simply busy. Loading the page takes 120ms when nothing else is
   * happening, three at a time — the app is not the slow part.
   *
   * The retry is for the same reason and nothing else: a layout bug fails
   * identically twice, so a retry cannot hide one. Playwright reports anything
   * that only passes on the second go as "flaky" rather than as a pass.
   */
  workers: 2,
  retries: 1,
  reporter: [['list']],
  use: { baseURL: BASE },

  // tools/serve.js may well already be up for phone testing over Tailscale.
  webServer: {
    command: 'node tools/serve.js',
    url: BASE,
    reuseExistingServer: true,
    timeout: 20 * 1000
  },

  /*
   * 375 / 393 / 412 across, plus each on its side. iPhone 15 landscape is
   * 343px tall, which is the tightest thing here and the reason the landscape
   * rules are keyed on max-height rather than a width.
   */
  projects: [
    { name: 'iphone-se',            use: devices['iPhone SE (3rd gen)'] },            // 375x667, webkit
    { name: 'iphone-se-landscape',  use: devices['iPhone SE (3rd gen) landscape'] },  // 667x375
    { name: 'iphone-15',            use: devices['iPhone 15'] },                      // 393x659
    { name: 'iphone-15-landscape',  use: devices['iPhone 15 landscape'] },            // 734x343
    { name: 'pixel-7',              use: devices['Pixel 7'] },                        // 412x839, chromium
    { name: 'pixel-7-landscape',    use: devices['Pixel 7 landscape'] }               // 863x360
  ]
});
