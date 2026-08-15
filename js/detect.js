/*
 * detect.js — find a cube face in a photo and read its nine stickers.
 *
 * This is what replaces "assume the cube fills a fixed square". It runs in a
 * few milliseconds on a downscaled frame, so it can drive a live overlay as
 * well as the actual capture.
 *
 * The idea: stickers are flat, bright-ish patches separated by black plastic.
 * Split the frame into blobs, throw away anything that isn't a plausible
 * sticker, and then use the grid arrangement itself as the signature — nine
 * similarly sized square-ish blobs sitting in a 3x3 lattice is a cube face and
 * almost nothing else in a room is. Because the grid is the evidence, a bright
 * background or a colorful shirt gets rejected on shape alone.
 *
 * Returns cell centers in the ORIGINAL image's coordinates, so colors are
 * sampled at full resolution even though the search ran on a small copy.
 */
;(function (root) {
  'use strict';

  var WORK_SIZE = 260;   // long edge of the copy the search runs on

  // ---- basics -------------------------------------------------------------

  function downscale(img, maxDim) {
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));
    var out = new Uint8Array(w * h * 3);
    var sx = img.width / w, sy = img.height / h;
    for (var y = 0; y < h; y++) {
      var y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil((y + 1) * sy)));
      for (var x = 0; x < w; x++) {
        var x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil((x + 1) * sx)));
        var r = 0, g = 0, b = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) {
          var row = yy * img.width * 4;
          for (var xx = x0; xx < x1; xx++) {
            var o = row + xx * 4;
            r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
          }
        }
        var d = (y * w + x) * 3;
        out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n;
      }
    }
    return { data: out, width: w, height: h, scale: scale };
  }

  /** Otsu's method: the brightness split that best separates dark from light. */
  function otsu(values) {
    var hist = new Float64Array(256), total = values.length;
    for (var i = 0; i < total; i++) hist[values[i]]++;
    var sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (var k = 0; k < 256; k++) {
      wB += hist[k];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += k * hist[k];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = k; }
    }
    return best;
  }

  function brightness(small) {
    var n = small.width * small.height;
    var v = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 3;
      v[i] = Math.max(small.data[o], Math.max(small.data[o + 1], small.data[o + 2]));
    }
    return v;
  }

  /** Sobel magnitude, used to keep touching regions from merging into one blob. */
  function gradient(v, w, h) {
    var g = new Uint8Array(w * h);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var gx = -v[i - w - 1] - 2 * v[i - 1] - v[i + w - 1] + v[i - w + 1] + 2 * v[i + 1] + v[i + w + 1];
        var gy = -v[i - w - 1] - 2 * v[i - w] - v[i - w + 1] + v[i + w - 1] + 2 * v[i + w] + v[i + w + 1];
        var m = Math.sqrt(gx * gx + gy * gy) / 4;
        g[i] = m > 255 ? 255 : m;
      }
    }
    return g;
  }

  // ---- blobs --------------------------------------------------------------

  function findBlobs(mask, w, h) {
    var labels = new Int32Array(w * h).fill(-1);
    var blobs = [];
    var stack = new Int32Array(w * h);
    for (var start = 0; start < w * h; start++) {
      if (!mask[start] || labels[start] >= 0) continue;
      var id = blobs.length;
      var top = 0;
      stack[top++] = start;
      labels[start] = id;
      var area = 0, sumX = 0, sumY = 0;
      var minX = w, maxX = -1, minY = h, maxY = -1;
      while (top > 0) {
        var p = stack[--top];
        var px = p % w, py = (p / w) | 0;
        area++; sumX += px; sumY += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px > 0 && mask[p - 1] && labels[p - 1] < 0) { labels[p - 1] = id; stack[top++] = p - 1; }
        if (px < w - 1 && mask[p + 1] && labels[p + 1] < 0) { labels[p + 1] = id; stack[top++] = p + 1; }
        if (py > 0 && mask[p - w] && labels[p - w] < 0) { labels[p - w] = id; stack[top++] = p - w; }
        if (py < h - 1 && mask[p + w] && labels[p + w] < 0) { labels[p + w] = id; stack[top++] = p + w; }
      }
      blobs.push({
        area: area, cx: sumX / area, cy: sumY / area,
        w: maxX - minX + 1, h: maxY - minY + 1
      });
    }
    return blobs;
  }

  function plausibleStickers(blobs, w, h) {
    var frame = w * h;
    return blobs.filter(function (b) {
      if (b.area < 20 || b.area > frame * 0.14) return false;
      var aspect = b.w / b.h;
      // a sticker is square-ish; anything long is two merged cells or clutter
      if (aspect < 0.62 || aspect > 1.6) return false;
      if (b.area / (b.w * b.h) < 0.62) return false;   // roughly convex/rectangular
      return true;
    });
  }

  // ---- grid ---------------------------------------------------------------

  /**
   * Look for a 3x3 lattice among the candidate blobs.
   *
   * Rather than clustering everything and hoping the crowd is all stickers,
   * this guesses: take two blobs, assume they are side-by-side cells, and see
   * how many of the others land where that lattice says they should. One blob
   * from the background cannot invent a grid, so a single good hypothesis
   * outvotes any amount of clutter.
   *
   * The row direction is always the column direction turned a quarter turn the
   * same way, so the result can come out rotated but never mirrored — and a
   * rotation is something the assembly step already knows how to undo.
   */
  function hypothesiseLattice(cells) {
    var best = null;

    for (var i = 0; i < cells.length; i++) {
      var a = cells[i];
      var size = Math.sqrt(a.area);
      for (var j = 0; j < cells.length; j++) {
        if (i === j) continue;
        var b = cells[j];
        if (b.area < a.area * 0.45 || b.area > a.area * 2.2) continue;

        var vx = b.cx - a.cx, vy = b.cy - a.cy;
        var len = Math.hypot(vx, vy);
        if (len < size * 0.9 || len > size * 2.1) continue;   // must be the next cell along

        var wx = -vy, wy = vx;                                 // a quarter turn, fixed handedness

        for (var originCell = 0; originCell < 9; originCell++) {
          var r0 = (originCell / 3) | 0, c0 = originCell % 3;
          var ox = a.cx - c0 * vx - r0 * wx;
          var oy = a.cy - c0 * vy - r0 * wy;

          var matched = 0, error = 0, used = {};
          for (var r = 0; r < 3; r++) {
            for (var c = 0; c < 3; c++) {
              var px = ox + c * vx + r * wx;
              var py = oy + c * vy + r * wy;
              var bestK = -1, bestD = len * 0.38;
              for (var k = 0; k < cells.length; k++) {
                if (used[k]) continue;
                var d = Math.hypot(cells[k].cx - px, cells[k].cy - py);
                if (d < bestD) { bestD = d; bestK = k; }
              }
              if (bestK >= 0) { used[bestK] = true; matched++; error += bestD; }
            }
          }
          if (matched < 6) continue;

          // Prefer more matches, then a tighter fit, then the most upright
          // grid. Measured from "pointing right", NOT folded to the nearest
          // axis: a column vector pointing left is the same lattice read upside
          // down, and folding the angle would make the two score identically.
          var tilt = Math.abs(Math.atan2(vy, vx));
          var score = matched * 1000 - error - tilt * 60;
          if (!best || score > best.score) {
            best = { ox: ox, oy: oy, vx: vx, vy: vy, wx: wx, wy: wy, matched: matched, score: score, step: len };
          }
        }
      }
    }
    return best;
  }

  /**
   * A cube face has dark plastic between the stickers. Checking for it is what
   * stops a patterned rug or a bookshelf from passing as a cube.
   */
  function looksLikeACube(v, w, h, lattice) {
    function at(x, y) {
      var xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
      return v[yi * w + xi];
    }
    function point(row, col) {
      return { x: lattice.ox + col * lattice.vx + row * lattice.wx,
        y: lattice.oy + col * lattice.vy + row * lattice.wy };
    }

    var cellV = [], gapV = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var p = point(r, c);
        var value = at(p.x, p.y);
        if (value === null) return false;      // the grid runs off the frame
        cellV.push(value);
        if (c < 2) {
          var gh = at((p.x + point(r, c + 1).x) / 2, (p.y + point(r, c + 1).y) / 2);
          if (gh !== null) gapV.push(gh);
        }
        if (r < 2) {
          var gv = at((p.x + point(r + 1, c).x) / 2, (p.y + point(r + 1, c).y) / 2);
          if (gv !== null) gapV.push(gv);
        }
      }
    }
    if (gapV.length < 8) return false;
    cellV.sort(function (x, y) { return x - y; });
    gapV.sort(function (x, y) { return x - y; });
    var cellMid = cellV[cellV.length >> 1];
    var gapMid = gapV[gapV.length >> 1];
    return gapMid < cellMid * 0.72;            // the seams must actually be darker
  }

  /** Tilt of the lattice, from the direction to each blob's nearest neighbour. */
  function latticeAngle(cells) {
    var angles = [];
    for (var i = 0; i < cells.length; i++) {
      var best = -1, bestD = Infinity;
      for (var j = 0; j < cells.length; j++) {
        if (i === j) continue;
        var dx = cells[j].cx - cells[i].cx, dy = cells[j].cy - cells[i].cy;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) continue;
      var a = Math.atan2(cells[best].cy - cells[i].cy, cells[best].cx - cells[i].cx);
      // fold into [-45, 45): a lattice looks the same every 90 degrees
      var quarter = Math.PI / 2;
      a = a - Math.round(a / quarter) * quarter;
      angles.push(a);
    }
    if (!angles.length) return 0;
    angles.sort(function (x, y) { return x - y; });
    return angles[angles.length >> 1];   // median resists one bad neighbour
  }

  /** Split sorted values into three runs at the two widest gaps. */
  function splitIntoThree(values) {
    var order = values.map(function (v, i) { return { v: v, i: i }; })
      .sort(function (a, b) { return a.v - b.v; });
    if (order.length < 3) return null;
    var gaps = [];
    for (var k = 1; k < order.length; k++) gaps.push({ at: k, size: order[k].v - order[k - 1].v });
    gaps.sort(function (a, b) { return b.size - a.size; });
    if (gaps.length < 2) return null;
    var cuts = [gaps[0].at, gaps[1].at].sort(function (a, b) { return a - b; });
    var group = new Array(values.length);
    for (var n = 0; n < order.length; n++) {
      group[order[n].i] = n < cuts[0] ? 0 : n < cuts[1] ? 1 : 2;
    }
    // the gaps between groups must be real, not just the widest of a smooth run
    var spread = order[order.length - 1].v - order[0].v;
    if (spread <= 0 || gaps[1].size < spread * 0.12) return null;
    return group;
  }

  /** Least-squares affine fit of (row, col) -> (x, y). */
  function fitAffine(points) {
    // solve for [a0,a1,a2] in x = a0 + a1*col + a2*row (and same for y)
    var n = points.length;
    var S = [[n, 0, 0], [0, 0, 0], [0, 0, 0]];
    var bx = [0, 0, 0], by = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      var c = points[i].col, r = points[i].row, x = points[i].x, y = points[i].y;
      S[0][1] += c; S[0][2] += r;
      S[1][1] += c * c; S[1][2] += c * r;
      S[2][2] += r * r;
      bx[0] += x; bx[1] += c * x; bx[2] += r * x;
      by[0] += y; by[1] += c * y; by[2] += r * y;
    }
    S[1][0] = S[0][1]; S[2][0] = S[0][2]; S[2][1] = S[1][2];
    var solveX = solve3(S, bx), solveY = solve3(S, by);
    if (!solveX || !solveY) return null;
    return {
      at: function (row, col) {
        return {
          x: solveX[0] + solveX[1] * col + solveX[2] * row,
          y: solveY[0] + solveY[1] * col + solveY[2] * row
        };
      },
      colStep: Math.hypot(solveX[1], solveY[1]),
      rowStep: Math.hypot(solveX[2], solveY[2])
    };
  }

  function solve3(m, b) {
    var a = [m[0].slice(), m[1].slice(), m[2].slice()];
    var v = b.slice();
    for (var i = 0; i < 3; i++) {
      var pivot = i;
      for (var r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
      if (Math.abs(a[pivot][i]) < 1e-9) return null;
      var tmp = a[i]; a[i] = a[pivot]; a[pivot] = tmp;
      var tv = v[i]; v[i] = v[pivot]; v[pivot] = tv;
      for (var rr = 0; rr < 3; rr++) {
        if (rr === i) continue;
        var f = a[rr][i] / a[i][i];
        for (var cc = i; cc < 3; cc++) a[rr][cc] -= f * a[i][cc];
        v[rr] -= f * v[i];
      }
    }
    return [v[0] / a[0][0], v[1] / a[1][1], v[2] / a[2][2]];
  }

  /**
   * Assign candidate blobs to a 3x3 lattice. Returns the nine cell centers in
   * reading order, filling in any the segmentation missed from the fitted
   * geometry, or null if this does not look like a cube face.
   */
  function fitGrid(candidates) {
    if (candidates.length < 5) return null;

    // keep the ones whose size agrees with the crowd
    var areas = candidates.map(function (c) { return c.area; }).sort(function (a, b) { return a - b; });
    var med = areas[areas.length >> 1];
    var cells = candidates.filter(function (c) { return c.area > med * 0.35 && c.area < med * 2.8; });
    if (cells.length < 5) return null;
    if (cells.length > 24) {
      cells.sort(function (a, b) { return Math.abs(a.area - med) - Math.abs(b.area - med); });
      cells = cells.slice(0, 24);
    }

    var theta = latticeAngle(cells);
    var cos = Math.cos(-theta), sin = Math.sin(-theta);
    var rot = cells.map(function (c) {
      return { rx: c.cx * cos - c.cy * sin, ry: c.cx * sin + c.cy * cos, cell: c };
    });

    var rowGroup = splitIntoThree(rot.map(function (p) { return p.ry; }));
    var colGroup = splitIntoThree(rot.map(function (p) { return p.rx; }));
    if (!rowGroup || !colGroup) return null;

    // one blob per slot; if two land in the same slot this is not a clean face
    var slots = {};
    for (var i = 0; i < rot.length; i++) {
      var key = rowGroup[i] + ',' + colGroup[i];
      if (slots[key]) return null;
      slots[key] = { row: rowGroup[i], col: colGroup[i], x: rot[i].cell.cx, y: rot[i].cell.cy, area: rot[i].cell.area };
    }
    var known = Object.keys(slots).map(function (k) { return slots[k]; });
    if (known.length < 6) return null;

    var fit = fitAffine(known);
    if (!fit) return null;

    // a cube face is square: the two step vectors should be similar in length
    var ratio = fit.colStep / fit.rowStep;
    if (!isFinite(ratio) || ratio < 0.55 || ratio > 1.8) return null;
    if (fit.colStep < 6 || fit.rowStep < 6) return null;

    // every known blob should sit close to where the lattice says it should
    for (var k = 0; k < known.length; k++) {
      var want = fit.at(known[k].row, known[k].col);
      var off = Math.hypot(want.x - known[k].x, want.y - known[k].y);
      if (off > fit.colStep * 0.45) return null;
    }

    var out = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var here = slots[r + ',' + c];
        var pos = here ? { x: here.x, y: here.y } : fit.at(r, c);
        out.push({ x: pos.x, y: pos.y, filledIn: !here });
      }
    }
    return { cells: out, step: (fit.colStep + fit.rowStep) / 2, found: known.length, fit: fit };
  }

  // ---- sampling -----------------------------------------------------------

  function medianOf(list) {
    list.sort(function (a, b) { return a - b; });
    var mid = list.length >> 1;
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function sampleAt(img, x, y, radius) {
    var x0 = Math.max(0, Math.round(x - radius)), x1 = Math.min(img.width - 1, Math.round(x + radius));
    var y0 = Math.max(0, Math.round(y - radius)), y1 = Math.min(img.height - 1, Math.round(y + radius));
    var rs = [], gs = [], bs = [];
    for (var yy = y0; yy <= y1; yy++) {
      var row = yy * img.width * 4;
      for (var xx = x0; xx <= x1; xx++) {
        var o = row + xx * 4;
        rs.push(img.data[o]); gs.push(img.data[o + 1]); bs.push(img.data[o + 2]);
      }
    }
    if (!rs.length) return [0, 0, 0];
    return [medianOf(rs), medianOf(gs), medianOf(bs)];
  }

  // ---- the whole thing ----------------------------------------------------

  /**
   * img: { data: Uint8ClampedArray RGBA, width, height } — an ImageData works.
   * Returns { samples: [9 x [r,g,b]], points: [9 x {x,y}], quad: [4 x {x,y}],
   *           found: how many of the nine were actually segmented } or null.
   */
  function detectFace(img, opts) {
    opts = opts || {};
    var small = downscale(img, opts.workSize || WORK_SIZE);
    var v = brightness(small);
    // Otsu picks the dark/light split, but a bright background can drag it up
    // until dark stickers (blue especially) get mistaken for plastic, so cap it.
    var cut = Math.max(28, Math.min(otsu(v), 96));
    var grad = gradient(v, small.width, small.height);
    var gradCut = opts.edge || 34;

    var mask = new Uint8Array(small.width * small.height);
    for (var i = 0; i < mask.length; i++) {
      mask[i] = (v[i] > cut && grad[i] < gradCut) ? 1 : 0;
    }

    var blobs = findBlobs(mask, small.width, small.height);
    var candidates = plausibleStickers(blobs, small.width, small.height);
    if (candidates.length < 6) return null;

    // keep the search cheap: the cells all look about the same size
    if (candidates.length > 30) {
      var sorted = candidates.map(function (c) { return c.area; }).sort(function (a, b) { return a - b; });
      var med = sorted[sorted.length >> 1];
      candidates = candidates.slice().sort(function (a, b) {
        return Math.abs(a.area - med) - Math.abs(b.area - med);
      }).slice(0, 30);
    }

    var lattice = hypothesiseLattice(candidates);
    if (!lattice) return null;
    if (!looksLikeACube(v, small.width, small.height, lattice)) return null;

    var inv = 1 / small.scale;
    var points = [];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        points.push({
          x: (lattice.ox + c * lattice.vx + r * lattice.wx) * inv,
          y: (lattice.oy + c * lattice.vy + r * lattice.wy) * inv
        });
      }
    }
    var radius = Math.max(2, lattice.step * inv * 0.17);
    var samples = points.map(function (p) { return sampleAt(img, p.x, p.y, radius); });

    var corners = [[-0.62, -0.62], [-0.62, 2.62], [2.62, 2.62], [2.62, -0.62]].map(function (rc) {
      return {
        x: (lattice.ox + rc[1] * lattice.vx + rc[0] * lattice.wx) * inv,
        y: (lattice.oy + rc[1] * lattice.vy + rc[0] * lattice.wy) * inv
      };
    });

    return {
      samples: samples, points: points, quad: corners,
      found: lattice.matched, step: lattice.step * inv
    };
  }

  var api = {
    detectFace: detectFace,
    _internals: {
      downscale: downscale, otsu: otsu, findBlobs: findBlobs,
      fitGrid: fitGrid, splitIntoThree: splitIntoThree, latticeAngle: latticeAngle
    }
  };

  root.CubeDetect = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
