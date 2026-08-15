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

  /** The value below which `fraction` of the samples fall. */
  function percentile(values, fraction) {
    var hist = new Float64Array(256);
    for (var i = 0; i < values.length; i++) hist[values[i]]++;
    var target = values.length * fraction, running = 0;
    for (var v = 0; v < 256; v++) {
      running += hist[v];
      if (running >= target) return v;
    }
    return 255;
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
        x0: minX, y0: minY,
        w: maxX - minX + 1, h: maxY - minY + 1
      });
    }
    return blobs;
  }

  /**
   * Split blobs that are really a row of cells stuck together.
   *
   * Two neighbouring pieces of the SAME colour have almost nothing between them
   * on a stickerless cube — a hairline seam that survives neither the downscale
   * nor the gradient threshold — so they come out of findBlobs as one patch.
   * Measured on a real 4x4 (testdata, 17-05-42): five cells segmented cleanly
   * and the other eleven arrived as five merged runs — one of three cells and
   * four of two. That left eight candidates where sixteen were wanted, the 4x4
   * pass gave up, and the 3x3 that fits inside any 4x4 was found instead. This
   * is the whole reason a 4x4 kept being read as a 3x3, and raising the working
   * resolution does not help: at every size from 260 to 640 the same pieces
   * stayed merged.
   *
   * A merged run is recognisable. It is solidly filled, and its bounding box is
   * a whole number of cell pitches long. The pitch is taken from the SHORT side
   * of each solid patch, which merging along a row does not change — a 3-wide
   * run of 32px cells measures 96x32, and 32 is still the pitch.
   *
   * This only ever PROPOSES cells. The lattice fit and the flatness check are
   * still what decide whether a cube face is there, so a wrong split fails to
   * match rather than inventing a reading.
   */
  function splitMergedRuns(blobs, N) {
    // Slivers and ragged background blobs must not vote on the pitch: a 28x1
    // scanline is "100% filled" and would drag the median to nothing.
    var solid = blobs.filter(function (b) {
      return b.area >= 14 && Math.min(b.w, b.h) >= 4 && b.area / (b.w * b.h) >= 0.62;
    });
    if (solid.length < 3) return blobs;

    function medianShortSide(list) {
      var s = list.map(function (b) { return Math.min(b.w, b.h); })
        .sort(function (a, b) { return a - b; });
      return s[s.length >> 1];
    }

    var pitch = medianShortSide(solid);
    if (pitch < 5) return blobs;
    // Re-measure using only the patches that pitch says are a single cell, so a
    // frame where several cells merged in BOTH directions still lands on the
    // true pitch rather than one inflated by the 2x2 blocks.
    var singles = solid.filter(function (b) {
      return Math.max(b.w, b.h) < pitch * 1.5;
    });
    if (singles.length >= 3) pitch = medianShortSide(singles);
    if (pitch < 5) return blobs;

    var out = [];
    blobs.forEach(function (b) {
      var cols = Math.round(b.w / pitch), rows = Math.round(b.h / pitch);
      var fill = b.area / (b.w * b.h);
      var splittable = fill >= 0.72 &&
        cols >= 1 && rows >= 1 && cols <= N && rows <= N && (cols > 1 || rows > 1) &&
        // the box has to actually BE that many cells long, not merely round to it
        Math.abs(b.w - cols * pitch) <= pitch * 0.34 &&
        Math.abs(b.h - rows * pitch) <= pitch * 0.34;
      if (!splittable) { out.push(b); return; }

      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          out.push({
            area: b.area / (cols * rows),
            cx: b.x0 + b.w * (c + 0.5) / cols,
            cy: b.y0 + b.h * (r + 0.5) / rows,
            x0: b.x0 + b.w * c / cols, y0: b.y0 + b.h * r / rows,
            w: b.w / cols, h: b.h / rows,
            split: true
          });
        }
      }
    });
    return out;
  }

  function plausibleStickers(blobs, w, h) {
    var frame = w * h;
    return blobs.filter(function (b) {
      if (b.area < 14 || b.area > frame * 0.16) return false;
      var aspect = b.w / b.h;
      // A sticker is square-ish, though perspective squashes the far ones and
      // a highlight can eat a corner, so this is looser than it looks.
      if (aspect < 0.5 || aspect > 2) return false;
      if (b.area / (b.w * b.h) < 0.5) return false;   // roughly convex/rectangular
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
  /**
   * How much of the grid has to actually be there.
   *
   * 3x3 keeps its long-standing 6 of 9: a couple of stickers can be lost to
   * glare or merged into a neighbour and it should still lock on.
   *
   * Bigger sizes are held to a much higher share, and not for their own sake —
   * it is what keeps auto-detection honest. A 3x3 face only has nine blobs, so
   * demanding 13 of 16 means a 3x3 cannot be dressed up as a 4x4 by roping in
   * a few lucky background blobs. Relaxing this is what made a 3x3 occasionally
   * read as a 4x4.
   */
  function minimumMatch(N) {
    return N === 3 ? 6 : Math.ceil(N * N * 0.8);
  }

  /** For each blob, the handful of blobs nearest it. */
  function nearestNeighbours(cells, k) {
    return cells.map(function (a, i) {
      var order = [];
      for (var j = 0; j < cells.length; j++) {
        if (i === j) continue;
        order.push({ j: j, d: Math.hypot(cells[j].cx - a.cx, cells[j].cy - a.cy) });
      }
      order.sort(function (p, q) { return p.d - q.d; });
      return order.slice(0, k).map(function (o) { return o.j; });
    });
  }

  function hypothesiseLattice(cells, N) {
    var best = null;
    var cellCount = N * N;
    // Whichever blob sits next to another in the grid is one of its nearest
    // neighbours, so there is no point pairing every blob with every other —
    // which matters at 4x4, where that would be sixteen times the work.
    var neighbours = nearestNeighbours(cells, 8);

    for (var i = 0; i < cells.length; i++) {
      var a = cells[i];
      var size = Math.sqrt(a.area);
      for (var nb = 0; nb < neighbours[i].length; nb++) {
        var j = neighbours[i][nb];
        var b = cells[j];
        if (b.area < a.area * 0.45 || b.area > a.area * 2.2) continue;

        var vx = b.cx - a.cx, vy = b.cy - a.cy;
        var len = Math.hypot(vx, vy);
        if (len < size * 0.9 || len > size * 2.1) continue;   // must be the next cell along

        var wx = -vy, wy = vx;                                 // a quarter turn, fixed handedness

        // The cells of one face are all about the same size, so only blobs that
        // agree with the seed pair may fill a slot. Position alone is not
        // enough: on a high-resolution copy a noisy frame breaks into hundreds
        // of specks, and four of them landing near grid points was enough to
        // build a 16-slot lattice out of a 9-cell face — a 3x3 read as a 4x4,
        // which is precisely the confusion the size check exists to prevent.
        var seedArea = (a.area + b.area) / 2;
        var minArea = seedArea * 0.4, maxArea = seedArea * 2.5;

        for (var originCell = 0; originCell < cellCount; originCell++) {
          var r0 = (originCell / N) | 0, c0 = originCell % N;
          var ox = a.cx - c0 * vx - r0 * wx;
          var oy = a.cy - c0 * vy - r0 * wy;

          var matched = 0, error = 0, used = {};
          for (var r = 0; r < N; r++) {
            for (var c = 0; c < N; c++) {
              var px = ox + c * vx + r * wx;
              var py = oy + c * vy + r * wy;
              var bestK = -1, bestD = len * 0.38;
              for (var k = 0; k < cells.length; k++) {
                if (used[k]) continue;
                if (cells[k].area < minArea || cells[k].area > maxArea) continue;
                var d = Math.hypot(cells[k].cx - px, cells[k].cy - py);
                if (d < bestD) { bestD = d; bestK = k; }
              }
              if (bestK >= 0) { used[bestK] = true; matched++; error += bestD; }
            }
          }
          if (matched < minimumMatch(N)) continue;

          // Prefer more matches, then a tighter fit, then the most upright
          // grid. Measured from "pointing right", NOT folded to the nearest
          // axis: a column vector pointing left is the same lattice read upside
          // down, and folding the angle would make the two score identically.
          var tilt = Math.abs(Math.atan2(vy, vx));
          var score = matched * 1000 - error - tilt * 60;
          if (!best || score > best.score) {
            best = { ox: ox, oy: oy, vx: vx, vy: vy, wx: wx, wy: wy, matched: matched, score: score, step: len, N: N,
              minArea: minArea, maxArea: maxArea };
          }
        }
      }
    }
    return best;
  }

  /**
   * Re-fit the lattice to the blobs it matched, this time letting the two step
   * vectors move independently. A cube face photographed at an angle is a
   * trapezoid; insisting on a square one costs matches around its far edge.
   */
  function refine(lattice, cells, N) {
    var points = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var px = lattice.ox + c * lattice.vx + r * lattice.wx;
        var py = lattice.oy + c * lattice.vy + r * lattice.wy;
        var bestK = -1, bestD = lattice.step * 0.42;
        for (var k = 0; k < cells.length; k++) {
          // same size agreement as the hypothesis, so re-fitting cannot pull in
          // a speck the hypothesis was careful to leave out
          if (lattice.minArea !== undefined &&
              (cells[k].area < lattice.minArea || cells[k].area > lattice.maxArea)) continue;
          var d = Math.hypot(cells[k].cx - px, cells[k].cy - py);
          if (d < bestD) { bestD = d; bestK = k; }
        }
        if (bestK >= 0) points.push({ row: r, col: c, x: cells[bestK].cx, y: cells[bestK].cy });
      }
    }
    if (points.length < minimumMatch(N)) return null;
    var fit = fitAffine(points);
    if (!fit) return null;

    var origin = fit.at(0, 0), right = fit.at(0, 1), down = fit.at(1, 0);
    var vx = right.x - origin.x, vy = right.y - origin.y;
    var wx = down.x - origin.x, wy = down.y - origin.y;

    // Refuse a fit that has folded over on itself: the row direction must stay
    // on the same side of the column direction, or the face comes out mirrored.
    if (vx * wy - vy * wx <= 0) return null;
    var stepV = Math.hypot(vx, vy), stepW = Math.hypot(wx, wy);
    if (stepV < 4 || stepW < 4) return null;
    if (stepV / stepW < 0.5 || stepV / stepW > 2) return null;

    return {
      ox: origin.x, oy: origin.y, vx: vx, vy: vy, wx: wx, wy: wy,
      matched: points.length, step: (stepV + stepW) / 2, N: N
    };
  }

  /**
   * Is this really a cube face?
   *
   * NOT by looking for dark plastic between the stickers. That was the first
   * thing tried and it is wrong: plenty of cubes are stickerless, with the
   * colour moulded into the piece and barely a seam to find, and on those the
   * check rejected grids the detector had located perfectly.
   *
   * What every cube does have, sticker or not, is nine flat patches of colour.
   * So the test is flatness: sample the inside of each cell and require it to
   * be an even colour. Carpet, wood grain, book spines and faces are all
   * textured; a cube face is not.
   */
  function looksLikeACube(small, lattice, report, N) {
    var w = small.width, h = small.height;

    function point(row, col) {
      return { x: lattice.ox + col * lattice.vx + row * lattice.wx,
        y: lattice.oy + col * lattice.vy + row * lattice.wy };
    }

    var radius = Math.max(1, lattice.step * 0.2);
    var spreads = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var p = point(r, c);
        if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) return false;   // runs off the frame

        var x0 = Math.max(0, Math.round(p.x - radius)), x1 = Math.min(w - 1, Math.round(p.x + radius));
        var y0 = Math.max(0, Math.round(p.y - radius)), y1 = Math.min(h - 1, Math.round(p.y + radius));
        var vals = [];
        for (var y = y0; y <= y1; y++) {
          for (var x = x0; x <= x1; x++) {
            var o = (y * w + x) * 3;
            vals.push(Math.max(small.data[o], Math.max(small.data[o + 1], small.data[o + 2])));
          }
        }
        if (vals.length < 4) return false;
        vals.sort(function (a, b) { return a - b; });
        // 20th to 80th percentile, so one glare speck does not condemn a cell
        spreads.push(vals[Math.floor(vals.length * 0.8)] - vals[Math.floor(vals.length * 0.2)]);
      }
    }
    spreads.sort(function (a, b) { return a - b; });
    var typical = spreads[spreads.length >> 1];
    if (report) report.flatness = typical;
    return typical <= 46;
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

  /** One attempt, at one working resolution. detectFace tries several. */
  function detectAtScale(img, opts) {
    opts = opts || {};
    var N = opts.size || 3;
    var debug = opts.debug ? { stage: 'start', size: N } : null;
    var small = downscale(img, opts.workSize || WORK_SIZE);
    var v = brightness(small);
    var grad = gradient(v, small.width, small.height);

    // Both thresholds are relative to this photo rather than fixed numbers.
    // A fixed brightness cut throws away dark stickers in a dim room; a fixed
    // edge cut throws away sticker interiors in a noisy one.
    var cut = Math.min(otsu(v), percentile(v, opts.darkest === undefined ? 0.3 : opts.darkest));
    var gradCut = opts.edge || Math.max(10, Math.min(60, percentile(grad, 0.72)));

    var mask = new Uint8Array(small.width * small.height);
    for (var i = 0; i < mask.length; i++) {
      mask[i] = (v[i] > cut && grad[i] < gradCut) ? 1 : 0;
    }

    var blobs = findBlobs(mask, small.width, small.height);
    var pieces = splitMergedRuns(blobs, N);
    var candidates = plausibleStickers(pieces, small.width, small.height);
    if (debug) {
      debug.frame = small.width + 'x' + small.height;
      debug.merged = pieces.length - blobs.length;
      debug.brightnessCut = cut;
      debug.edgeCut = gradCut;
      debug.blobs = blobs.length;
      debug.candidates = candidates.length;
      debug.candidateAreas = candidates.map(function (c) { return Math.round(c.area); }).sort(function (a, b) { return b - a; }).slice(0, 12);
    }
    var needed = minimumMatch(N);
    if (candidates.length < needed) {
      if (debug) { debug.stage = 'too few sticker-shaped patches (needs ' + needed + ')'; return { failed: true, debug: debug }; }
      return null;
    }

    // keep the search cheap: the cells all look about the same size
    var keepAtMost = N * N * 2 + 8;
    if (candidates.length > keepAtMost) {
      var sorted = candidates.map(function (c) { return c.area; }).sort(function (a, b) { return a - b; });
      var med = sorted[sorted.length >> 1];
      candidates = candidates.slice().sort(function (a, b) {
        return Math.abs(a.area - med) - Math.abs(b.area - med);
      }).slice(0, keepAtMost);
    }

    var lattice = hypothesiseLattice(candidates, N);
    if (debug) debug.lattice = lattice ? { matched: lattice.matched, step: Math.round(lattice.step) } : null;
    if (!lattice) {
      if (debug) { debug.stage = 'no ' + N + 'x' + N + ' grid among those patches'; return { failed: true, debug: debug }; }
      return null;
    }

    // A face seen at an angle is a trapezoid, not a square. The hypothesis
    // above is deliberately rigid so it can be found at all; relax it to a
    // full affine fit of whatever it matched, which absorbs the perspective.
    lattice = refine(lattice, candidates, N) || lattice;

    var verified = looksLikeACube(small, lattice, debug, N);
    if (debug) debug.flatCheck = verified;
    if (!verified) {
      if (debug) { debug.stage = 'grid found but the patches are too textured to be cube faces'; return { failed: true, debug: debug }; }
      return null;
    }
    if (debug) debug.stage = 'ok';

    var inv = 1 / small.scale;
    var points = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        points.push({
          x: (lattice.ox + c * lattice.vx + r * lattice.wx) * inv,
          y: (lattice.oy + c * lattice.vy + r * lattice.wy) * inv
        });
      }
    }
    var radius = Math.max(2, lattice.step * inv * 0.17);
    var samples = points.map(function (p) { return sampleAt(img, p.x, p.y, radius); });

    var lo = -0.62, hi = N - 1 + 0.62;
    var corners = [[lo, lo], [lo, hi], [hi, hi], [hi, lo]].map(function (rc) {
      return {
        x: (lattice.ox + rc[1] * lattice.vx + rc[0] * lattice.wx) * inv,
        y: (lattice.oy + rc[1] * lattice.vy + rc[0] * lattice.wy) * inv
      };
    });

    return {
      samples: samples, points: points, quad: corners, size: N,
      found: lattice.matched, step: lattice.step * inv,
      debug: debug
    };
  }

  /**
   * A picture of what the detector had to work with: the mask it built, with
   * every blob it considered sticker-shaped tinted green. Far quicker to read
   * than a page of numbers when a real photo will not detect.
   */
  function debugMask(img, opts) {
    opts = opts || {};
    var small = downscale(img, opts.workSize || WORK_SIZE);
    var v = brightness(small);
    var grad = gradient(v, small.width, small.height);
    var cut = Math.min(otsu(v), percentile(v, opts.darkest === undefined ? 0.3 : opts.darkest));
    var gradCut = opts.edge || Math.max(10, Math.min(60, percentile(grad, 0.72)));

    var mask = new Uint8Array(small.width * small.height);
    for (var i = 0; i < mask.length; i++) mask[i] = (v[i] > cut && grad[i] < gradCut) ? 1 : 0;

    var kept = {};
    var N = opts.size || 4;
    plausibleStickers(splitMergedRuns(findBlobs(mask, small.width, small.height), N),
      small.width, small.height)
      .forEach(function (b) { kept[Math.round(b.cx) + ',' + Math.round(b.cy)] = b; });

    var rgb = Buffer.alloc(small.width * small.height * 3);
    for (var p = 0; p < mask.length; p++) {
      var shade = mask[p] ? 210 : 30;
      rgb[p * 3] = shade; rgb[p * 3 + 1] = shade; rgb[p * 3 + 2] = shade;
    }
    Object.keys(kept).forEach(function (key) {
      var b = kept[key];
      var x0 = Math.max(0, Math.round(b.cx - b.w / 2)), x1 = Math.min(small.width - 1, Math.round(b.cx + b.w / 2));
      var y0 = Math.max(0, Math.round(b.cy - b.h / 2)), y1 = Math.min(small.height - 1, Math.round(b.cy + b.h / 2));
      for (var x = x0; x <= x1; x++) {
        [y0, y1].forEach(function (y) { var o = (y * small.width + x) * 3; rgb[o] = 40; rgb[o + 1] = 230; rgb[o + 2] = 120; });
      }
      for (var y = y0; y <= y1; y++) {
        [x0, x1].forEach(function (x) { var o = (y * small.width + x) * 3; rgb[o] = 40; rgb[o + 1] = 230; rgb[o + 2] = 120; });
      }
    });
    return { width: small.width, height: small.height, rgb: rgb };
  }

  /**
   * The working resolutions to try, in order.
   *
   * A 4x4 packs sixteen cells into the same face a 3x3 fits nine into, so at a
   * fixed working size its seams are barely more than half as wide — and a seam
   * that lands under about two pixels is gone. Hence a bigger copy for the
   * bigger cubes.
   *
   * These are measured on the eight real frames in testdata/, not chosen. Every
   * resolution from 260 to 620 in steps of 20 was scored on whether each frame
   * read at its true size:
   *
   *   - 380-420 is the only band where all eight read correctly; 400 is its
   *     middle, so that is the first rung.
   *   - Results either side are not monotonic — one frame reads at 280, misses
   *     through the 300s, and reads again from 380 — so a single resolution sits
   *     too close to an edge. The lower rungs cost nothing when the first works,
   *     and rescue a frame that happens to fall in a bad spot.
   *   - From 600 up, background texture starts breaking into sticker-sized
   *     blobs and 3x3 frames get read as 4x4. That is the ceiling, and 400
   *     leaves 200px of headroom under it.
   *
   * Worst case (nothing found at any rung) measured 9.9ms per frame; a hit on
   * the first rung is 5.3ms, the same as a single pass.
   */
  function scaleLadder(N) {
    return N >= 4 ? [400, 320, 260] : [WORK_SIZE, 340];
  }

  /**
   * img: { data: Uint8ClampedArray RGBA, width, height } — an ImageData works.
   * Returns { samples: [N*N x [r,g,b]], points: [N*N x {x,y}], quad: [4 x {x,y}],
   *           found: how many were actually segmented } or null.
   */
  function detectFace(img, opts) {
    opts = opts || {};
    if (opts.workSize) return detectAtScale(img, opts);

    var ladder = scaleLadder(opts.size || 3);
    var lastFailure = null;
    for (var i = 0; i < ladder.length; i++) {
      var found = detectAtScale(img, {
        size: opts.size, debug: opts.debug, darkest: opts.darkest, edge: opts.edge,
        workSize: ladder[i]
      });
      if (found && !found.failed) return found;
      if (found) lastFailure = found;
    }
    // Report the closest attempt, so the diagnostics say how far it got rather
    // than only how far the last and largest copy got.
    if (lastFailure && lastFailure.debug) lastFailure.debug.triedScales = ladder;
    return lastFailure;
  }

  /**
   * Find a face without being told the cube's size.
   *
   * Bigger first, and the first hit wins. That order is not arbitrary: a 3x3
   * grid fits inside a 4x4 (any three-by-three block of it), so a 4x4 asked for
   * a 3x3 will happily say yes. The reverse cannot happen — there is no 4x4
   * lattice hiding in a 3x3 — and measurement agrees: 0 of 60 3x3 photos were
   * read as a 4x4, while all 60 4x4 photos were readable as a 3x3.
   */
  function detectAny(img, opts) {
    opts = opts || {};
    var sizes = opts.sizes || [4, 3];
    for (var i = 0; i < sizes.length; i++) {
      var found = detectFace(img, { size: sizes[i], workSize: opts.workSize, debug: opts.debug });
      if (found && !found.failed) return found;
    }
    return null;
  }

  var api = {
    detectFace: detectFace,
    detectAny: detectAny,
    debugMask: typeof Buffer === 'undefined' ? null : debugMask,
    _internals: {
      downscale: downscale, otsu: otsu, findBlobs: findBlobs,
      splitMergedRuns: splitMergedRuns,
      fitGrid: fitGrid, splitIntoThree: splitIntoThree, latticeAngle: latticeAngle
    }
  };

  root.CubeDetect = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
