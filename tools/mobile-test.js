/*
 * node tools/mobile-test.js   —   what `npm run test:mobile` runs.
 *
 * The mobile layout suite needs Playwright and about 300MB of browser, and the
 * fourteen-file Node suite needs neither. This exists so that the two never
 * become one thing: `npm test` must keep working on a machine that has never
 * heard of Playwright, and asking for the browser suite on such a machine
 * should say so in a sentence rather than throw a stack trace.
 *
 * Exit codes: 0 when the suite passes, 0 when Playwright is simply not
 * installed (that is not a failure, it is an absence), non-zero when a test
 * actually fails.
 */
var path = require('path');
var { spawnSync } = require('child_process');

var root = path.join(__dirname, '..');

function missing(what) {
  console.log('');
  console.log('  The mobile layout suite is not set up on this machine.');
  console.log('  ' + what);
  console.log('');
  console.log('  To set it up (a devDependency and one browser download —');
  console.log('  the app itself stays dependency-free):');
  console.log('');
  console.log('      npm install --save-dev @playwright/test');
  console.log('      npx playwright install webkit chromium');
  console.log('');
  console.log('  Skipping. `npm test` does not need any of this.');
  console.log('');
  process.exit(0);
}

try {
  require.resolve('@playwright/test', { paths: [root] });
} catch (err) {
  missing('@playwright/test is not installed.');
}

/*
 * Installed as a package is not the same as having a browser to drive. Ask
 * Playwright to resolve the executables before running, so a half-finished
 * setup reads as "run the install command" and not as six failing tests.
 */
var browsers = spawnSync(process.execPath,
  ['-e', 'var p=require("@playwright/test");' +
         'var w=p.webkit.executablePath();var c=p.chromium.executablePath();' +
         'require("fs").accessSync(w);require("fs").accessSync(c);'],
  { cwd: root, encoding: 'utf8' });

if (browsers.status !== 0) missing('The WebKit and Chromium builds are not downloaded.');

/*
 * The CLI module by path, run under this same node. Not `npx playwright`:
 * spawning a .cmd shim on Windows without a shell fails silently, with no
 * output and a bare exit 1, which is exactly the kind of thing this file
 * exists to avoid.
 */
var cli = require.resolve('@playwright/test/cli', { paths: [root] });
var run = spawnSync(process.execPath, [cli, 'test'].concat(process.argv.slice(2)), {
  cwd: root,
  stdio: 'inherit'
});

process.exit(run.status === null ? 1 : run.status);
