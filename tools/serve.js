/*
 * Local server: `npm start`.
 *
 * Serves the app, and — if a Gemini key is present — exposes POST /api/scan so
 * the phone can hand off cube photos for reading. The key stays in this
 * process; it is never sent to the browser.
 *
 * Set the key in a .env file next to this repo (gitignored):
 *   GEMINI_API_KEY=your-key-here
 *   GEMINI_MODEL=optional-override
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var Gemini = require('./gemini.js');

var root = path.join(__dirname, '..');
var port = process.env.PORT || 8123;

// ---- tiny .env reader (no dependencies) ---------------------------------
(function loadEnv() {
  var file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    var m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) return;
    var value = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  });
})();

var API_KEY = process.env.GEMINI_API_KEY || '';
var MODEL = process.env.GEMINI_MODEL || '';
var API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

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
  var text = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
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

// ---- Gemini ---------------------------------------------------------------

var modelPromise = null;
function resolveModels() {
  if (MODEL) return Promise.resolve([MODEL]);
  if (modelPromise) return modelPromise;
  modelPromise = fetch(API_ROOT + '/models?key=' + encodeURIComponent(API_KEY))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.error) throw new Error(data.error.message || 'model list failed');
      var ranked = Gemini.rankModels(data && data.models);
      if (!ranked.length) throw new Error('no vision-capable model available on this key');
      MODEL = ranked[0];
      console.log('  Gemini model: ' + ranked[0] +
        (ranked.length > 1 ? ' (falling back to ' + ranked[1] + ' if busy)' : ''));
      return ranked;
    })
    .catch(function (err) { modelPromise = null; throw err; });
  return modelPromise;
}

function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function callGemini(model, parts) {
  return fetch(API_ROOT + '/models/' + model + ':generateContent?key=' + encodeURIComponent(API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: Gemini.RESPONSE_SCHEMA
      }
    })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data && data.error) throw new Error(data.error.message || 'Gemini request failed');
    var cand = data && data.candidates && data.candidates[0];
    var text = cand && cand.content && cand.content.parts &&
      cand.content.parts.map(function (p) { return p.text || ''; }).join('');
    if (!text) throw new Error('Gemini returned nothing usable');
    try { return JSON.parse(text); } catch (e) { throw new Error('Gemini returned malformed JSON'); }
  });
}

/**
 * images: [{ face: 'F', mimeType: 'image/jpeg', data: '<base64>' }, ...]
 * Reads them, and if the answer is not a possible cube, tells the model what
 * was wrong and asks again (twice at most).
 */
function scanImages(images) {
  var baseParts = [{ text: Gemini.buildPrompt(images.length) }];
  images.forEach(function (im) {
    baseParts.push({ inlineData: { mimeType: im.mimeType || 'image/jpeg', data: im.data } });
  });

  /**
   * The newest model is also the busiest. Retry a couple of times on the
   * transient "high demand" style failures, then move down the ranking rather
   * than dropping the user into the rough local reader.
   */
  function withCapacity(models, parts, tries) {
    var model = models[0];
    return callGemini(model, parts).catch(function (err) {
      if (!Gemini.isTransientFailure(err.message)) throw err;
      if (tries > 0) {
        console.log('  ' + model + ' busy, retrying…');
        return delay(1200).then(function () { return withCapacity(models, parts, tries - 1); });
      }
      if (models.length > 1) {
        console.log('  ' + model + ' still busy, falling back to ' + models[1]);
        return withCapacity(models.slice(1), parts, 1);
      }
      throw err;
    }).then(function (payload) { return { payload: payload, model: models[0] }; });
  }

  return resolveModels().then(function (models) {
    var usedModel = models[0];

    function attempt(parts, round) {
      return withCapacity(models, parts, 2).then(function (out) {
        usedModel = out.model;
        var payload = out.payload;
        var parsed = Gemini.parsePhotos(payload, images.length);
        var complaint = parsed.problems.length
          ? parsed.problems.slice(0, 4).join('; ')
          : Gemini.checkCube(parsed.colors);

        if (!complaint) {
          // hand back the finished cube as well as the raw per-photo readings,
          // so the browser does not have to redo the assembly
          var built = Gemini.toCube(parsed.colors);
          return {
            colors: Array.from(parsed.colors),
            cube: built.ok ? Array.from(built.colors) : null,
            ambiguous: !!built.ambiguous,
            rounds: round + 1,
            model: usedModel
          };
        }
        if (round >= 2) {
          // Out of retries: hand back the best read we have and let the user fix it.
          return {
            colors: parsed.colors ? Array.from(parsed.colors) : null,
            uncertain: parsed.uncertain,
            rounds: round + 1,
            model: usedModel,
            warning: complaint
          };
        }
        var retryParts = baseParts.concat([{
          text: 'Your previous answer was: ' + JSON.stringify(payload) +
            '\n\nThat cannot be right. ' + complaint +
            '\n\nLook again, paying particular attention to red versus orange and to white versus yellow, ' +
            'and return a corrected reading of all six faces.'
        }]);
        return attempt(retryParts, round + 1);
      });
    }

    return attempt(baseParts, 0);
  });
}

// ---- routing --------------------------------------------------------------

var server = http.createServer(function (req, res) {
  var url = decodeURIComponent(req.url.split('?')[0]);

  if (url === '/api/scan') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
    if (!API_KEY) {
      sendJson(res, 501, { error: 'no-key', message: 'No GEMINI_API_KEY on the server; using the built-in reader instead.' });
      return;
    }
    readBody(req, 24 * 1024 * 1024).then(function (raw) {
      var body = JSON.parse(raw);
      if (!Array.isArray(body.images) || body.images.length !== 6) throw new Error('expected six images');
      return scanImages(body.images);
    }).then(function (result) {
      sendJson(res, 200, result);
    }).catch(function (err) {
      console.error('  /api/scan failed:', err.message);
      sendJson(res, 502, { error: 'scan-failed', message: err.message });
    });
    return;
  }

  if (url === '/api/status') {
    sendJson(res, 200, { gemini: !!API_KEY, model: MODEL || null });
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
  if (API_KEY) {
    console.log('  Gemini scanning: on');
    resolveModels().catch(function (err) { console.log('  Gemini model lookup failed: ' + err.message); });
  } else {
    console.log('  Gemini scanning: off (no GEMINI_API_KEY) — the built-in color reader will be used');
  }
});
