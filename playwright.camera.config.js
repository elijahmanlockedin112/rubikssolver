/*
 * The scanner, driven end to end by a fake camera. `npm run test:camera`.
 *
 * Chromium only, and deliberately: --use-file-for-fake-video-capture is a
 * Chromium flag, and WebKit has nothing like it. So this is the one part of the
 * suite that cannot pretend to be an iPhone, and it is not trying to — it is
 * checking that the pieces are wired together and that auto-capture fires once
 * per face. Whether the detector likes real frames is measured by
 * test/detect.test.js and test/realshots.test.js, and how any of it behaves on
 * an actual phone camera is test/MOBILE-CHECKLIST.md.
 *
 * A project per scenario, because the fake video is chosen by a command-line
 * flag at browser launch and so cannot change between tests in one project.
 * The videos are built into the OS temp directory by globalSetup — about 34MB
 * each, which is why they are not in the repo.
 */
var path = require('path');
var os = require('os');
var { defineConfig } = require('@playwright/test');

var BASE = 'http://127.0.0.1:8123';
var dir = path.join(os.tmpdir(), 'cube-coach-fake-camera');

function scenario(name, video, metadata) {
  return {
    name: name,
    metadata: metadata,
    use: {
      browserName: 'chromium',
      viewport: { width: 393, height: 800 },
      permissions: ['camera'],
      launchOptions: {
        args: [
          '--use-fake-device-for-media-stream',
          '--use-fake-ui-for-media-stream',
          '--use-file-for-fake-video-capture=' + path.join(dir, video)
        ]
      }
    }
  };
}

module.exports = defineConfig({
  testDir: './test',
  testMatch: /scanner-camera\.spec\.js/,
  globalSetup: require.resolve('./tools/fake-camera-setup.js'),
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  workers: 2,
  retries: 1,
  reporter: [['list']],
  use: { baseURL: BASE },
  webServer: {
    command: 'node tools/serve.js',
    url: BASE,
    reuseExistingServer: true,
    timeout: 20 * 1000
  },
  projects: [
    scenario('camera-3x3', 'cube3.y4m', { size: 3, expect: 'six' }),
    scenario('camera-2x2', 'cube2.y4m', { size: 2, expect: 'six' }),
    scenario('camera-4x4', 'cube4.y4m', { size: 4, expect: 'six' }),

    /*
     * One face, held up and never turned away — the case auto-capture has to
     * take exactly one photo of.
     *
     * Both of these are cubes with no centre sticker, and that is the whole
     * point. A 3x3 was tried first and proved nothing: capture() already
     * refuses a face whose middle sticker matches one it has, so the 3x3 stayed
     * at one photo with the rearm deliberately deleted. On a 2x2 and a 4x4
     * there is no such sticker and nothing else to fall back on, so these two
     * are the only things in the repo that actually hold the rearm to account.
     * The 2x2 is the tighter of them — four stickers is the least a face can
     * be told apart by.
     */
    scenario('camera-one-face-2x2', 'one2.y4m', { size: 2, expect: 'once' }),
    scenario('camera-one-face-4x4', 'one4.y4m', { size: 4, expect: 'once' })
  ]
});
