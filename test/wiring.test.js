/*
 * node test/wiring.test.js
 *
 * The browser-only files have no test harness — they want a camera, a canvas
 * and a DOM — so nothing here ever ran them, and a method could go missing
 * without a single test noticing.
 *
 * One did. `Scanner.prototype.done` was deleted along with the Gemini scanner
 * in 602001d and nobody saw it for five commits, on `main` as well as here,
 * because it is only reached after the sixth and last photo. What it looked
 * like from the outside was three unrelated bugs: the outline froze on the
 * video, the scanner would not close, and the cube could not be solved. What it
 * was, was `this.done is not a function` — `finish()` sets `busy` and disables
 * the buttons before calling it, so the live loop stopped and the modal stayed.
 *
 * So: read the source, and check every method a file calls on itself is a
 * method that file actually defines. Cheap, and it catches the whole family.
 */
var fs = require('fs');
var path = require('path');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var jsDir = path.join(__dirname, '..', 'js');
var files = fs.readdirSync(jsDir).filter(function (f) { return f.endsWith('.js'); });

console.log('\nevery method a file calls on itself exists');

files.forEach(function (file) {
  var src = fs.readFileSync(path.join(jsDir, file), 'utf8');

  // strip comments and strings so an example in prose is not read as code
  var code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

  var defined = {};
  var m;
  // Thing.prototype.name = ...
  var protoRe = /\.prototype\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = protoRe.exec(code))) defined[m[1]] = true;
  // this.name = ...  (a method parked straight on the instance)
  var ownRe = /\bthis\.([A-Za-z_$][\w$]*)\s*=[^=]/g;
  while ((m = ownRe.exec(code))) defined[m[1]] = true;
  // name: function ...  — cuben.js returns a plain object whose methods call
  // each other through `this`, which is just as valid as a prototype
  var literalRe = /\b([A-Za-z_$][\w$]*)\s*:\s*function\b/g;
  while ((m = literalRe.exec(code))) defined[m[1]] = true;

  // this.name(...)
  var called = {};
  var callRe = /\bthis\.([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = callRe.exec(code))) called[m[1]] = true;

  var missing = Object.keys(called).filter(function (name) { return !defined[name]; });
  check(file + ' calls nothing it does not define', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : '');
});

console.log('\nnothing is sized before the size is known');

/*
 * app.js sizes its sticker array from `size`. If `size` is still hoisted and
 * undefined when that runs, stickerCount() is NaN, and `new Int8Array(NaN)` is
 * not an error — it is an array of length zero. Nothing then complains,
 * because writing past the end of a typed array is silently ignored: the map
 * stayed blank, painting did nothing, a finished scan threw its colours away,
 * and solving reported that every sticker still needed a colour.
 */
var app = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
var sizeDecl = app.search(/\bvar size\s*=\s*\d/);
var stateDecl = app.search(/\bvar colorState\s*=/);
check('app.js settles the cube size before it builds the sticker array',
  sizeDecl >= 0 && stateDecl >= 0 && sizeDecl < stateDecl,
  'size declared at ' + sizeDecl + ', colorState at ' + stateDecl);

check('an Int8Array built from an unknown size really is empty, not an error',
  new Int8Array(6 * (undefined * undefined)).length === 0);

console.log('\nthe scanner hands its result back');

// The specific shape of the bug above: finish() is the only route out of the
// scanner, and it must reach something that closes the modal and calls onDone.
var scan = fs.readFileSync(path.join(jsDir, 'scan.js'), 'utf8');
check('finish() hands off to done()', /this\.done\(/.test(scan));
check('done() is defined', /Scanner\.prototype\.done\s*=/.test(scan));
check('done() closes the scanner', /Scanner\.prototype\.done[\s\S]{0,400}?this\.close\(/.test(scan));
check('done() calls the page back', /Scanner\.prototype\.done[\s\S]{0,400}?opts\.onDone/.test(scan));
check('done() clears the busy flag finish() set', /Scanner\.prototype\.done[\s\S]{0,200}?this\.busy\s*=\s*false/.test(scan));

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
