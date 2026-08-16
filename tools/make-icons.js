/*
 * make-icons.js — turn icon.svg into the PNGs iOS insists on.
 *
 *     node tools/make-icons.js
 *
 * Safari will not use an SVG for the home-screen icon, and a manifest without
 * a raster icon is refused installability by Chrome, so two PNGs have to exist
 * on disk. Rather than hand-draw them twice and let them drift from the SVG,
 * this rasterises the SVG with the WebKit that is already installed for the
 * mobile tests, and writes the result next to it.
 *
 * Run it after changing icon.svg. It is not part of `npm test` — Playwright is
 * optional, the icons are committed, and a machine without a browser download
 * should still be able to run the suite.
 */
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var SIZES = [180, 512];

(async function () {
  var webkit;
  try {
    webkit = require('@playwright/test').webkit;
  } catch (err) {
    console.error('Playwright is not installed, so the icons cannot be rebuilt.');
    console.error('  npm install --save-dev @playwright/test && npx playwright install webkit');
    process.exit(1);
  }

  var svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');
  var browser = await webkit.launch();
  try {
    for (var i = 0; i < SIZES.length; i++) {
      var size = SIZES[i];
      var page = await browser.newPage({ viewport: { width: size, height: size } });
      // the SVG at exactly the target size, on nothing — the artwork paints its
      // own rounded background, so a transparent page is what is wanted
      await page.setContent(
        '<style>html,body{margin:0;padding:0;background:transparent}' +
        'svg{display:block;width:' + size + 'px;height:' + size + 'px}</style>' + svg,
        { waitUntil: 'load' }
      );
      var file = path.join(root, 'icon-' + size + '.png');
      await page.screenshot({ path: file, omitBackground: true });
      await page.close();
      console.log('wrote ' + path.relative(root, file) + '  (' + fs.statSync(file).size + ' bytes)');
    }
  } finally {
    await browser.close();
  }
})();
