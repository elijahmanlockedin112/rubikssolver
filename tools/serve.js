/*
 * Local server: `npm start`.
 *
 * The app itself needs no server — it is static files and every path in it is
 * relative, so opening index.html works, and so does GitHub Pages. This exists
 * for two conveniences:
 *
 *   - Testing an unpushed change on a phone, over Tailscale, where the camera
 *     needs an https:// address.
 *   - Saving a frame the detector could not read, so it can be worked on
 *     offline with tools/diagnose.js.
 *
 * There is no API key here and nothing leaves the machine.
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var Png = require('./png.js');

var root = path.join(__dirname, '..');
var port = process.env.PORT || 8123;

var types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limitBytes) {
  return new Promise(function (resolve, reject) {
    var chunks = [], total = 0;
    req.on('data', function (c) {
      total += c.length;
      if (total > limitBytes) { reject(new Error('request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

var server = http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);

  // Save a frame the detector could not read, so it can be worked on offline.
  // Everything stays on this machine, in ./testdata (gitignored).
  if (url === '/api/debug-shot') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
    readBody(req, 32 * 1024 * 1024).then(function (raw) {
      var body = JSON.parse(raw);
      var w = body.width | 0, h = body.height | 0;
      var rgba = Buffer.from(body.data, 'base64');
      if (!w || !h || rgba.length < w * h * 4) throw new Error('bad frame');

      var dir = path.join(root, 'testdata');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      var stamp = new Date().toISOString().replace(/[:.]/g, '-');
      var name = 'shot-' + stamp + (body.label ? '-' + String(body.label).replace(/[^a-z0-9]/gi, '') : '');

      fs.writeFileSync(path.join(dir, name + '.png'),
        Png.encodePng(w, h, Png.rgbaToRgb(rgba, w, h)));
      fs.writeFileSync(path.join(dir, name + '.json'),
        JSON.stringify({ width: w, height: h, note: body.note || null, data: body.data }));
      console.log('  saved a diagnostic frame: testdata/' + name + '.png');
      sendJson(res, 200, { saved: name });
    }).catch(function (err) {
      sendJson(res, 400, { error: err.message });
    });
    return;
  }

  if (url === '/') url = '/index.html';
  var file = path.normalize(path.join(root, url));
  if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('nope'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, function () {
  console.log('Rubik\'s Cube Coach running at http://localhost:' + port);
  console.log('  (the app is static — this is only for phone testing and diagnostics)');
});
