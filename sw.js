/*
 * sw.js — the app works with no network at all.
 *
 * Everything here is static and already runs entirely on the device: the
 * solvers, the scanner, the renderer. The only thing standing between this and
 * a cube solved on a train with no signal was the files themselves. So they
 * are kept.
 *
 * Network first, cache second — deliberately the slower way round.
 *
 * The usual advice is cache-first, and for an app that ships from GitHub Pages
 * several times a day it is a trap: a cached index.html and a cached app.js
 * are exactly what makes someone see yesterday's version and be told their own
 * change did not land. Network-first costs one round trip per file on a good
 * connection and gives back the thing that actually matters — what you get is
 * always what was published, and what you get with no signal is the last thing
 * that was.
 *
 * VERSION has to change for old caches to be cleared. It is the only piece of
 * bookkeeping here that a person has to remember.
 */
var VERSION = 'cube-coach-v1';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './css/styles.css',
  './js/cube.js',
  './js/cuben.js',
  './js/kociemba.js',
  './js/solver.js',
  './js/solver2.js',
  './js/render.js',
  './js/guide.js',
  './js/detect.js',
  './js/assemble.js',
  './js/assemble4.js',
  './js/repair.js',
  './js/autosnap.js',
  './js/celebrate.js',
  './js/voice.js',
  './js/academy.js',
  './js/scan.js',
  './js/app.js',
  // fetched on demand by app.js, and worth having if the demand comes while
  // offline — a 4x4 that cannot be solved on a train is a 4x4 in your hands
  './js/tpr.js',
  './js/solver4.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // addAll fails the whole install if any one file 404s; these are all
      // committed next to this file, so that is the behaviour wanted
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === VERSION ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  // same origin only: this app talks to nothing else, and a cache of someone
  // else's server is not this file's business
  if (new URL(request.url).origin !== self.location.origin) return;
  // the local server's diagnostic endpoint is a POST-shaped thing; never cache
  if (request.url.indexOf('/api/') >= 0) return;

  event.respondWith(
    fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(VERSION).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (hit) {
        // a navigation with nothing cached for it still gets the app shell,
        // which is what makes a bookmarked deep link work offline
        return hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined);
      });
    })
  );
});
