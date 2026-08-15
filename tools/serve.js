/*
 * Tiny static server for local development: `npm start`.
 * Only needed if your browser refuses the camera on file:// URLs — the app
 * itself has no server requirement.
 */
var http = require('http');
var fs = require('fs');
var path = require('path');

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

http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  var file = path.normalize(path.join(root, url));
  if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('nope'); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, function () {
  console.log('Rubik\'s Cube Coach running at http://localhost:' + port);
});
