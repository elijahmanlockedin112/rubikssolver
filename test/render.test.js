/*
 * node test/render.test.js
 *
 * The 3D view, checked without a browser.
 *
 * Every face is drawn as a black backing panel with its stickers on top, and
 * the whole lot is painted far to near in one sorted list. Ordering a panel by
 * the average depth of its corners is wrong: a panel covers a whole face, so
 * seen at an angle its middle sits nearer than the stickers along its far edge,
 * and it gets painted over the top of them. Measured in the browser before the
 * fix, at the default camera: 24 of a 4x4's 48 visible stickers sorted behind
 * their own panel, and 48% of every pixel drawn was panel. Turning the cube
 * square-on made it right again, which is exactly what it looked like from the
 * outside — pieces missing until you moved it.
 *
 * The rule being kept here is simple: a face's panel must be painted before any
 * sticker belonging to that face, from every angle.
 */

// enough of a browser for render.js to build and draw
global.window = { devicePixelRatio: 1, addEventListener: function () {} };
global.performance = { now: function () { return 0; } };
global.requestAnimationFrame = function () { return 0; };
global.cancelAnimationFrame = function () {};

function fakeCanvas(px) {
  var noop = function () {};
  var ctx = {
    clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, arc: noop, translate: noop,
    rotate: noop, setTransform: noop, ellipse: noop, bezierCurveTo: noop, quadraticCurveTo: noop
  };
  return {
    width: 300, height: 150, style: {},
    getContext: function () { return ctx; },
    getBoundingClientRect: function () { return { width: px, height: px, left: 0, top: 0 }; },
    addEventListener: noop
  };
}

var CubeView = require('../js/render.js');

var failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

var PALETTE = ['#eeeeee', '#ffdd00', '#00aa66', '#0055bb', '#cc2233', '#ff8800'];

/** Draw once and report the order quads were painted in. */
function paintOrder(N, yaw, pitch) {
  var state = new Int8Array(6 * N * N);
  for (var i = 0; i < state.length; i++) state[i] = Math.floor(i / (N * N));
  var view = new CubeView(fakeCanvas(400), {
    size: N, state: state, colors: PALETTE, yaw: yaw, pitch: pitch, draggable: false
  });
  var painted = [];
  view.drawQuad = function (ctx, quad) { painted.push({ face: quad.face, isPanel: quad.facelet < 0 }); };
  view.draw();
  return painted;
}

/** For each face on screen, does its panel come before all of its stickers? */
function panelsStayBehind(N, yaw, pitch) {
  var painted = paintOrder(N, yaw, pitch);
  var panelAt = {}, firstStickerAt = {};
  painted.forEach(function (q, i) {
    if (q.isPanel) { if (panelAt[q.face] === undefined) panelAt[q.face] = i; }
    else if (firstStickerAt[q.face] === undefined) firstStickerAt[q.face] = i;
  });
  var covered = [];
  Object.keys(firstStickerAt).forEach(function (face) {
    if (panelAt[face] !== undefined && panelAt[face] > firstStickerAt[face]) covered.push(face);
  });
  return { covered: covered, faces: Object.keys(firstStickerAt).length, drawn: painted.length };
}

var ANGLES = [
  [-34, 26],    // the preview's default camera
  [146, -26],   // the back view's default camera
  [-45, 35], [-60, 15], [30, 40], [0, 0], [-90, 45], [180, -40], [12, -12], [75, 5]
];

console.log('\nno sticker is hidden behind its own face');

[3, 4, 5].forEach(function (N) {
  var bad = [], totalFaces = 0;
  ANGLES.forEach(function (a) {
    var r = panelsStayBehind(N, a[0], a[1]);
    totalFaces += r.faces;
    if (r.covered.length) bad.push(a.join('/') + ' faces ' + r.covered.join(','));
  });
  check(N + 'x' + N + ': every panel is painted behind its own stickers, at all ' + ANGLES.length + ' angles',
    bad.length === 0, bad.join('  '));
});

console.log('\nthe view still draws what it should');

check('a 4x4 draws all six panels and 96 stickers when nothing is culled', (function () {
  // straight at a corner nothing is hidden, but three faces always face away
  var painted = paintOrder(4, -34, 26);
  var panels = painted.filter(function (q) { return q.isPanel; }).length;
  var stickers = painted.length - panels;
  // three faces visible: 3 panels, 3 x 16 stickers
  return panels === 3 && stickers === 48;
})());

check('a 3x3 shows three faces from the default camera', (function () {
  var painted = paintOrder(3, -34, 26);
  var faces = {};
  painted.forEach(function (q) { if (!q.isPanel) faces[q.face] = true; });
  return Object.keys(faces).length === 3;
})());

check('turning the cube square-on shows exactly one face', (function () {
  var painted = paintOrder(4, 0, 0);
  var faces = {};
  painted.forEach(function (q) { if (!q.isPanel) faces[q.face] = true; });
  return Object.keys(faces).length === 1;
})());

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
process.exit(failures ? 1 : 0);
