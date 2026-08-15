/*
 * tpr.js — a three-phase-reduction 4x4 solver.
 *
 * A JavaScript port of Shuang Chen's TPR-4x4x4-Solver
 * (https://github.com/cs0x7f/TPR-4x4x4-Solver), used under its MIT option.
 * The original is dual-licensed GPLv3 / MIT; this port takes the MIT terms, so
 * it can sit alongside the rest of this app. csTimer's JavaScript solver is
 * GPLv3-only and is NOT the source of this file — porting from there would put
 * the whole app under the GPL.
 *
 * Where solver4.js reduces the cube the way a person does and lands around 90
 * moves, this searches all four stages properly and lands around 45.
 *
 *   Phase 1  separate the centres into their three opposite pairs
 *   Phase 2  finish the U/D and R/L centre split, tracking edge parity
 *   Phase 3  finish the centres and pair the edges
 *   Phase 4  the result is a 3x3, handed to kociemba.js
 *
 * Notes on the port
 * -----------------
 * The original leans on Java's 64-bit `long` in three places to pack twelve
 * 4-bit values into one register. JavaScript's bitwise operators are 32-bit, so
 * those use the author's own 32-bit fallbacks where he wrote them, and a
 * matching one written here for `Edge3.get`, which had none.
 *
 * Java's array types are load-bearing, not decoration: `byte` tables rely on
 * wrapping to -1 as "empty", and `char` tables on being unsigned 16-bit. The
 * typed arrays here mirror them exactly (Int8Array / Uint16Array / Int32Array)
 * rather than using plain arrays, because the pruning tables are searched by
 * comparing against -1.
 */
;(function (root, factory) {
  var api = factory(
    typeof require === 'function' ? require('./cuben.js') : root.CubeN,
    typeof require === 'function' ? require('./kociemba.js') : root.Kociemba
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TPR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CubeN, Kociemba) {
  'use strict';

  // ---- Util ---------------------------------------------------------------

  var Cnk = [];
  for (var i = 0; i < 25; i++) {
    Cnk.push(new Int32Array(25));
    Cnk[i][i] = 1; Cnk[i][0] = 1;
  }
  for (var i = 1; i < 25; i++) {
    for (var j = 1; j <= i; j++) Cnk[i][j] = Cnk[i - 1][j] + Cnk[i - 1][j - 1];
  }
  var fact = new Int32Array(13);
  fact[0] = 1;
  for (var i = 0; i < 12; i++) fact[i + 1] = fact[i] * (i + 1);

  /** The four-cycle the whole solver is built out of. key picks the amount. */
  function swap(arr, a, b, c, d, key) {
    var t;
    if (key === 0) { t = arr[d]; arr[d] = arr[c]; arr[c] = arr[b]; arr[b] = arr[a]; arr[a] = t; return; }
    if (key === 1) { t = arr[a]; arr[a] = arr[c]; arr[c] = t; t = arr[b]; arr[b] = arr[d]; arr[d] = t; return; }
    if (key === 2) { t = arr[a]; arr[a] = arr[b]; arr[b] = arr[c]; arr[c] = arr[d]; arr[d] = t; }
  }

  function set8Perm(arr, idx) {
    var val = 0x76543210;
    for (var i = 0; i < 7; i++) {
      var p = fact[7 - i];
      var v = (idx / p) | 0;
      idx -= v * p;
      v <<= 2;
      arr[i] = (val >> v) & 0xf;
      var m = (1 << v) - 1;
      val = (val & m) + ((val >> 4) & ~m);
    }
    arr[7] = val;
  }

  function parityOf(arr) {
    var p = 0;
    for (var i = 0, len = arr.length; i < len; i++) {
      for (var j = i; j < len; j++) if (arr[i] > arr[j]) p ^= 1;
    }
    return p;
  }

  // ---- Moves --------------------------------------------------------------

  var Ux1 = 0, Ux2 = 1, Ux3 = 2, Rx1 = 3, Rx2 = 4, Rx3 = 5, Fx1 = 6, Fx2 = 7, Fx3 = 8;
  var Dx1 = 9, Dx2 = 10, Dx3 = 11, Lx1 = 12, Lx2 = 13, Lx3 = 14, Bx1 = 15, Bx2 = 16, Bx3 = 17;
  var ux1 = 18, ux2 = 19, ux3 = 20, rx1 = 21, rx2 = 22, rx3 = 23, fx1 = 24, fx2 = 25, fx3 = 26;
  var dx1 = 27, dx2 = 28, dx3 = 29, lx1 = 30, lx2 = 31, lx3 = 32, bx1 = 33, bx2 = 34, bx3 = 35;
  var eom = 36;

  var move2str = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'",
    'D', 'D2', "D'", 'L', 'L2', "L'", 'B', 'B2', "B'",
    'Uw', 'Uw2', "Uw'", 'Rw', 'Rw2', "Rw'", 'Fw', 'Fw2', "Fw'",
    'Dw', 'Dw2', "Dw'", 'Lw', 'Lw2', "Lw'", 'Bw', 'Bw2', "Bw'"];

  var move2std = [Ux1, Ux2, Ux3, Rx1, Rx2, Rx3, Fx1, Fx2, Fx3,
    Dx1, Dx2, Dx3, Lx1, Lx2, Lx3, Bx1, Bx2, Bx3,
    ux2, rx1, rx2, rx3, fx2, dx2, lx1, lx2, lx3, bx2, eom];

  var move3std = [Ux1, Ux2, Ux3, Rx2, Fx1, Fx2, Fx3, Dx1, Dx2, Dx3, Lx2, Bx1, Bx2, Bx3,
    ux2, rx2, fx2, dx2, lx2, bx2, eom];

  var std2move = new Int32Array(37), std3move = new Int32Array(37);
  for (var i = 0; i < 29; i++) std2move[move2std[i]] = i;
  for (var i = 0; i < 21; i++) std3move[move3std[i]] = i;

  var ckmv = [], ckmv2 = [], ckmv3 = [];
  for (var i = 0; i < 37; i++) {
    ckmv.push(new Uint8Array(36));
    if (i < 36) for (var j = 0; j < 36; j++) ckmv[i][j] = (((i / 3) | 0) === ((j / 3) | 0) || ((((i / 3) | 0) % 3) === (((j / 3) | 0) % 3) && i > j)) ? 1 : 0;
  }
  for (var i = 0; i < 29; i++) {
    ckmv2.push(new Uint8Array(28));
    for (var j = 0; j < 28; j++) ckmv2[i][j] = ckmv[move2std[i]][move2std[j]];
  }
  for (var i = 0; i < 21; i++) {
    ckmv3.push(new Uint8Array(20));
    for (var j = 0; j < 20; j++) ckmv3[i][j] = ckmv[move3std[i]][move3std[j]];
  }
  var skipAxis = new Int32Array(36), skipAxis2 = new Int32Array(28), skipAxis3 = new Int32Array(20);
  for (var i = 0; i < 36; i++) {
    skipAxis[i] = 36;
    for (var j = i; j < 36; j++) if (!ckmv[i][j]) { skipAxis[i] = j - 1; break; }
  }
  for (var i = 0; i < 28; i++) {
    skipAxis2[i] = 28;
    for (var j = i; j < 28; j++) if (!ckmv2[i][j]) { skipAxis2[i] = j - 1; break; }
  }
  for (var i = 0; i < 20; i++) {
    skipAxis3[i] = 20;
    for (var j = i; j < 20; j++) if (!ckmv3[i][j]) { skipAxis3[i] = j - 1; break; }
  }

  // ---- facelet layout -----------------------------------------------------

  // The 96 stickers, face by face: U R F D L B, each read left to right, top to
  // bottom — the same order cuben.js uses, which is what lets a cube pass
  // between the two without translation.
  var u0 = 0x00, r0 = 0x10, f0 = 0x20, d0 = 0x30, l0 = 0x40, b0 = 0x50;
  function fl(base, n) { return base + n; }

  var centerFacelet = [
    u0 + 5, u0 + 6, u0 + 10, u0 + 9, d0 + 5, d0 + 6, d0 + 10, d0 + 9,
    f0 + 5, f0 + 6, f0 + 10, f0 + 9, b0 + 5, b0 + 6, b0 + 10, b0 + 9,
    r0 + 5, r0 + 6, r0 + 10, r0 + 9, l0 + 5, l0 + 6, l0 + 10, l0 + 9];

  var edgeFacelet = [
    [u0 + 13, f0 + 1], [u0 + 4, l0 + 1], [u0 + 2, b0 + 1], [u0 + 11, r0 + 1],
    [d0 + 13, b0 + 14], [d0 + 4, l0 + 14], [d0 + 2, f0 + 14], [d0 + 11, r0 + 14],
    [l0 + 11, f0 + 8], [l0 + 4, b0 + 7], [r0 + 11, b0 + 8], [r0 + 4, f0 + 7],
    [f0 + 2, u0 + 14], [l0 + 2, u0 + 8], [b0 + 2, u0 + 1], [r0 + 2, u0 + 7],
    [b0 + 13, d0 + 14], [l0 + 13, d0 + 8], [f0 + 13, d0 + 1], [r0 + 13, d0 + 7],
    [f0 + 4, l0 + 7], [b0 + 11, l0 + 8], [b0 + 4, r0 + 7], [f0 + 11, r0 + 8]];

  var cornerFacelet = [
    [u0 + 15, r0 + 0, f0 + 3], [u0 + 12, f0 + 0, l0 + 3], [u0 + 0, l0 + 0, b0 + 3], [u0 + 3, b0 + 0, r0 + 3],
    [d0 + 3, f0 + 15, r0 + 12], [d0 + 0, l0 + 15, f0 + 12], [d0 + 12, b0 + 15, l0 + 12], [d0 + 15, r0 + 15, b0 + 12]];

  // ---- CenterCube ---------------------------------------------------------

  function CenterCube() {
    this.ct = new Int8Array(24);
    for (var i = 0; i < 24; i++) this.ct[i] = centerFacelet[i] >> 4;
  }
  CenterCube.prototype.copy = function (c) { this.ct.set(c.ct); };
  CenterCube.prototype.move = function (m) {
    var key = m % 3;
    m = (m / 3) | 0;
    var ct = this.ct;
    switch (m) {
      case 0: swap(ct, 0, 1, 2, 3, key); break;
      case 1: swap(ct, 16, 17, 18, 19, key); break;
      case 2: swap(ct, 8, 9, 10, 11, key); break;
      case 3: swap(ct, 4, 5, 6, 7, key); break;
      case 4: swap(ct, 20, 21, 22, 23, key); break;
      case 5: swap(ct, 12, 13, 14, 15, key); break;
      case 6: swap(ct, 0, 1, 2, 3, key); swap(ct, 8, 20, 12, 16, key); swap(ct, 9, 21, 13, 17, key); break;
      case 7: swap(ct, 16, 17, 18, 19, key); swap(ct, 1, 15, 5, 9, key); swap(ct, 2, 12, 6, 10, key); break;
      case 8: swap(ct, 8, 9, 10, 11, key); swap(ct, 2, 19, 4, 21, key); swap(ct, 3, 16, 5, 22, key); break;
      case 9: swap(ct, 4, 5, 6, 7, key); swap(ct, 10, 18, 14, 22, key); swap(ct, 11, 19, 15, 23, key); break;
      case 10: swap(ct, 20, 21, 22, 23, key); swap(ct, 0, 8, 4, 14, key); swap(ct, 3, 11, 7, 13, key); break;
      case 11: swap(ct, 12, 13, 14, 15, key); swap(ct, 1, 20, 7, 18, key); swap(ct, 0, 23, 6, 17, key); break;
    }
  };
  var center333Map = [0, 4, 2, 1, 5, 3];
  CenterCube.prototype.fill333 = function (facelet) {
    for (var i = 0; i < 6; i++) {
      var idx = center333Map[i] << 2;
      if (this.ct[idx] !== this.ct[idx + 1] || this.ct[idx + 1] !== this.ct[idx + 2] || this.ct[idx + 2] !== this.ct[idx + 3]) {
        return false;
      }
      facelet[4 + i * 9] = this.ct[idx];
    }
    return true;
  };

  // ---- EdgeCube -----------------------------------------------------------

  var EdgeColor = [[2, 0], [4, 0], [5, 0], [1, 0], [5, 3], [4, 3], [2, 3], [1, 3], [2, 4], [5, 4], [5, 1], [2, 1]];
  // U=0 R=1 F=2 D=3 L=4 B=5; the 3x3 facelet each wing writes to
  var EdgeMap = [19, 37, 46, 10, 52, 43, 25, 16, 21, 50, 48, 23, 7, 3, 1, 5, 34, 30, 28, 32, 39, 41, 39 + 8, 41 - 8];
  // (rebuilt below from the same table the original uses, to avoid typos)
  EdgeMap = (function () {
    // F2 L2 B2 R2 B8 L8 F8 R8 F4 B6 B4 F6 U8 U4 U2 U6 D8 D4 D2 D6 L6 L4 R6 R4
    var F = 18, L = 36, B = 45, R = 9, U = 0, D = 27;
    return [F + 1, L + 1, B + 1, R + 1, B + 7, L + 7, F + 7, R + 7, F + 3, B + 5, B + 3, F + 5,
      U + 7, U + 3, U + 1, U + 5, D + 7, D + 3, D + 1, D + 5, L + 5, L + 3, R + 5, R + 3];
  })();

  function EdgeCube() {
    this.ep = new Int8Array(24);
    for (var i = 0; i < 24; i++) this.ep[i] = i;
  }
  EdgeCube.prototype.copy = function (c) { this.ep.set(c.ep); };
  EdgeCube.prototype.getParity = function () { return parityOf(this.ep); };
  EdgeCube.prototype.fill333 = function (facelet) {
    for (var i = 0; i < 24; i++) {
      facelet[EdgeMap[i]] = EdgeColor[this.ep[i] % 12][(this.ep[i] / 12) | 0];
    }
  };
  EdgeCube.prototype.checkEdge = function () {
    var ck = 0, parity = false;
    for (var i = 0; i < 12; i++) {
      ck |= 1 << this.ep[i];
      parity = parity !== (this.ep[i] >= 12);
    }
    ck &= ck >> 12;
    return ck === 0 && !parity;
  };
  EdgeCube.prototype.move = function (m) {
    var key = m % 3;
    m = (m / 3) | 0;
    var ep = this.ep;
    switch (m) {
      case 0: swap(ep, 0, 1, 2, 3, key); swap(ep, 12, 13, 14, 15, key); break;
      case 1: swap(ep, 11, 15, 10, 19, key); swap(ep, 23, 3, 22, 7, key); break;
      case 2: swap(ep, 0, 11, 6, 8, key); swap(ep, 12, 23, 18, 20, key); break;
      case 3: swap(ep, 4, 5, 6, 7, key); swap(ep, 16, 17, 18, 19, key); break;
      case 4: swap(ep, 1, 20, 5, 21, key); swap(ep, 13, 8, 17, 9, key); break;
      case 5: swap(ep, 2, 9, 4, 10, key); swap(ep, 14, 21, 16, 22, key); break;
      case 6: swap(ep, 0, 1, 2, 3, key); swap(ep, 12, 13, 14, 15, key); swap(ep, 9, 22, 11, 20, key); break;
      case 7: swap(ep, 11, 15, 10, 19, key); swap(ep, 23, 3, 22, 7, key); swap(ep, 2, 16, 6, 12, key); break;
      case 8: swap(ep, 0, 11, 6, 8, key); swap(ep, 12, 23, 18, 20, key); swap(ep, 3, 19, 5, 13, key); break;
      case 9: swap(ep, 4, 5, 6, 7, key); swap(ep, 16, 17, 18, 19, key); swap(ep, 8, 23, 10, 21, key); break;
      case 10: swap(ep, 1, 20, 5, 21, key); swap(ep, 13, 8, 17, 9, key); swap(ep, 14, 0, 18, 4, key); break;
      case 11: swap(ep, 2, 9, 4, 10, key); swap(ep, 14, 21, 16, 22, key); swap(ep, 7, 15, 1, 17, key); break;
    }
  };

  // ---- CornerCube ---------------------------------------------------------

  var cornerFacelet333 = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];

  function CornerCube(cperm, twist) {
    this.cp = new Int8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    this.co = new Int8Array(8);
    this.temps = null;
    if (cperm !== undefined) { this.setCPerm(cperm); this.setTwist(twist); }
  }
  CornerCube.prototype.copy = function (c) { this.cp.set(c.cp); this.co.set(c.co); };
  CornerCube.prototype.getParity = function () { return parityOf(this.cp); };
  CornerCube.prototype.setTwist = function (idx) {
    var twst = 0;
    for (var i = 6; i >= 0; i--) { twst += this.co[i] = idx % 3; idx = (idx / 3) | 0; }
    this.co[7] = (15 - twst) % 3;
  };
  CornerCube.prototype.setCPerm = function (idx) { set8Perm(this.cp, idx); };
  CornerCube.prototype.fill333 = function (facelet) {
    for (var corn = 0; corn < 8; corn++) {
      var j = this.cp[corn], ori = this.co[corn];
      for (var n = 0; n < 3; n++) {
        facelet[cornerFacelet333[corn][(n + ori) % 3]] = (cornerFacelet333[j][n] / 9) | 0;
      }
    }
  };
  function cornMult(a, b, prod) {
    for (var corn = 0; corn < 8; corn++) {
      prod.cp[corn] = a.cp[b.cp[corn]];
      var oriA = a.co[b.cp[corn]], oriB = b.co[corn];
      var ori = oriA;
      ori += (oriA < 3) ? oriB : 6 - oriB;
      ori %= 3;
      if ((oriA >= 3) !== (oriB >= 3)) ori += 3;
      prod.co[corn] = ori;
    }
  }
  var cornerMoveCube = new Array(18);
  (function () {
    cornerMoveCube[0] = new CornerCube(15120, 0);
    cornerMoveCube[3] = new CornerCube(21021, 1494);
    cornerMoveCube[6] = new CornerCube(8064, 1236);
    cornerMoveCube[9] = new CornerCube(9, 0);
    cornerMoveCube[12] = new CornerCube(1230, 412);
    cornerMoveCube[15] = new CornerCube(224, 137);
    for (var a = 0; a < 18; a += 3) {
      for (var p = 0; p < 2; p++) {
        cornerMoveCube[a + p + 1] = new CornerCube();
        cornMult(cornerMoveCube[a + p], cornerMoveCube[a], cornerMoveCube[a + p + 1]);
      }
    }
  })();
  CornerCube.prototype.move = function (idx) {
    if (!this.temps) this.temps = new CornerCube();
    cornMult(this, cornerMoveCube[idx], this.temps);
    this.copy(this.temps);
  };

  // ---- Center1: phase 1 ---------------------------------------------------

  /*
   * One colour pair against the rest: eight of the 24 centre slots marked, and
   * the position reduced by the cube's 48 symmetries so 735,471 raw positions
   * collapse to 15,582 classes.
   */
  var C1_N = 15582, C1_RAW = 735471;
  var c1_ctsmv = null, c1_sym2raw = new Int32Array(C1_N), c1_csprun = new Int8Array(C1_N);
  var c1_symmult = [], c1_symmove = [], c1_syminv = new Int32Array(48), c1_finish = new Int32Array(48);
  var c1_raw2sym = null;

  function Center1(arg, urf) {
    this.ct = new Int8Array(24);
    if (arg === undefined) {
      for (var i = 0; i < 8; i++) this.ct[i] = 1;
    } else if (urf !== undefined) {                 // from a CenterCube
      for (var i = 0; i < 24; i++) this.ct[i] = (arg.ct[i] % 3 === urf) ? 1 : 0;
    } else {
      this.ct.set(arg);
    }
  }
  Center1.prototype.setFrom = function (c) { this.ct.set(c.ct); };
  Center1.prototype.move = function (m) {
    var key = m % 3;
    m = (m / 3) | 0;
    var ct = this.ct;
    switch (m) {
      case 0: swap(ct, 0, 1, 2, 3, key); break;
      case 1: swap(ct, 16, 17, 18, 19, key); break;
      case 2: swap(ct, 8, 9, 10, 11, key); break;
      case 3: swap(ct, 4, 5, 6, 7, key); break;
      case 4: swap(ct, 20, 21, 22, 23, key); break;
      case 5: swap(ct, 12, 13, 14, 15, key); break;
      case 6: swap(ct, 0, 1, 2, 3, key); swap(ct, 8, 20, 12, 16, key); swap(ct, 9, 21, 13, 17, key); break;
      case 7: swap(ct, 16, 17, 18, 19, key); swap(ct, 1, 15, 5, 9, key); swap(ct, 2, 12, 6, 10, key); break;
      case 8: swap(ct, 8, 9, 10, 11, key); swap(ct, 2, 19, 4, 21, key); swap(ct, 3, 16, 5, 22, key); break;
      case 9: swap(ct, 4, 5, 6, 7, key); swap(ct, 10, 18, 14, 22, key); swap(ct, 11, 19, 15, 23, key); break;
      case 10: swap(ct, 20, 21, 22, 23, key); swap(ct, 0, 8, 4, 14, key); swap(ct, 3, 11, 7, 13, key); break;
      case 11: swap(ct, 12, 13, 14, 15, key); swap(ct, 1, 20, 7, 18, key); swap(ct, 0, 23, 6, 17, key); break;
    }
  };
  Center1.prototype.set = function (idx) {
    var r = 8;
    for (var i = 23; i >= 0; i--) {
      this.ct[i] = 0;
      if (idx >= Cnk[i][r]) { idx -= Cnk[i][r--]; this.ct[i] = 1; }
    }
  };
  Center1.prototype.get = function () {
    var idx = 0, r = 8;
    for (var i = 23; i >= 0; i--) if (this.ct[i] === 1) idx += Cnk[i][r--];
    return idx;
  };
  Center1.prototype.rot = function (r) {
    var ct = this.ct;
    switch (r) {
      case 0: this.move(ux2); this.move(dx2); break;
      case 1: this.move(rx1); this.move(lx3); break;
      case 2:
        swap(ct, 0, 3, 1, 2, 1); swap(ct, 8, 11, 9, 10, 1); swap(ct, 4, 7, 5, 6, 1);
        swap(ct, 12, 15, 13, 14, 1); swap(ct, 16, 19, 21, 22, 1); swap(ct, 17, 18, 20, 23, 1);
        break;
      case 3: this.move(ux1); this.move(dx3); this.move(fx1); this.move(bx3); break;
    }
  };
  /** Step to the next of the 48 symmetries, in the order the tables use. */
  Center1.prototype.rotStep = function (j) {
    this.rot(0);
    if (j % 2 === 1) this.rot(1);
    if (j % 8 === 7) this.rot(2);
    if (j % 16 === 15) this.rot(3);
  };
  Center1.prototype.rotate = function (r) {
    for (var j = 0; j < r; j++) this.rotStep(j);
  };
  Center1.prototype.equals = function (c) {
    for (var i = 0; i < 24; i++) if (this.ct[i] !== c.ct[i]) return false;
    return true;
  };
  function c1RawToSym(n) {                          // binary search once raw2sym is freed
    var lo = 0, hi = C1_N - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (c1_sym2raw[mid] === n) return mid;
      if (c1_sym2raw[mid] < n) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
  Center1.prototype.getsym = function () {
    if (c1_raw2sym) return c1_raw2sym[this.get()];
    for (var j = 0; j < 48; j++) {
      var cord = c1RawToSym(this.get());
      if (cord !== -1) return cord * 64 + j;
      this.rotStep(j);
    }
    return -1;
  };

  function c1InitSym() {
    var c = new Center1();
    for (var i = 0; i < 24; i++) c.ct[i] = i;
    var d = new Center1(c.ct), e = new Center1(c.ct), f = new Center1(c.ct);
    for (var i = 0; i < 48; i++) c1_symmult.push(new Int32Array(48));
    for (var i = 0; i < 48; i++) c1_symmove.push(new Int32Array(36));

    for (var i = 0; i < 48; i++) {
      for (var j = 0; j < 48; j++) {
        for (var k = 0; k < 48; k++) {
          if (c.equals(d)) {
            c1_symmult[i][j] = k;
            if (k === 0) c1_syminv[i] = j;
          }
          d.rotStep(k);
        }
        c.rotStep(j);
      }
      c.rotStep(i);
    }

    for (var i = 0; i < 48; i++) {
      c.setFrom(e);
      c.rotate(c1_syminv[i]);
      for (var j = 0; j < 36; j++) {
        d.setFrom(c);
        d.move(j);
        d.rotate(i);
        for (var k = 0; k < 36; k++) {
          f.setFrom(e);
          f.move(k);
          if (f.equals(d)) { c1_symmove[i][j] = k; break; }
        }
      }
    }

    c.set(0);
    for (var i = 0; i < 48; i++) {
      c1_finish[c1_syminv[i]] = c.get();
      c.rotStep(i);
    }
  }

  function c1InitSym2Raw() {
    var c = new Center1();
    var occ = new Int32Array((C1_RAW >> 5) + 1);
    var count = 0;
    for (var i = 0; i < C1_RAW; i++) {
      if ((occ[i >>> 5] & (1 << (i & 0x1f))) !== 0) continue;
      c.set(i);
      for (var j = 0; j < 48; j++) {
        var idx = c.get();
        occ[idx >>> 5] |= (1 << (idx & 0x1f));
        if (c1_raw2sym) c1_raw2sym[idx] = count << 6 | c1_syminv[j];
        c.rotStep(j);
      }
      c1_sym2raw[count++] = i;
    }
    return count;
  }

  function c1CreateMoveTable() {
    c1_ctsmv = new Int32Array(C1_N * 36);
    var c = new Center1(), d = new Center1();
    for (var i = 0; i < C1_N; i++) {
      d.set(c1_sym2raw[i]);
      for (var m = 0; m < 36; m++) {
        c.setFrom(d);
        c.move(m);
        c1_ctsmv[i * 36 + m] = c.getsym();
      }
    }
  }

  function c1CreatePrun() {
    c1_csprun.fill(-1);
    c1_csprun[0] = 0;
    var depth = 0, done = 1;
    while (done !== C1_N) {
      var inv = depth > 4;
      var select = inv ? -1 : depth;
      var check = inv ? depth : -1;
      depth++;
      for (var i = 0; i < C1_N; i++) {
        if (c1_csprun[i] !== select) continue;
        for (var m = 0; m < 27; m++) {
          var idx = c1_ctsmv[i * 36 + m] >>> 6;
          if (c1_csprun[idx] !== check) continue;
          ++done;
          if (inv) { c1_csprun[i] = depth; break; }
          c1_csprun[idx] = depth;
        }
      }
    }
  }

  function c1GetSolvedSym(cube) {
    var c = new Center1(cube.ct);
    for (var j = 0; j < 48; j++) {
      var check = true;
      for (var i = 0; i < 24; i++) {
        if (c.ct[i] !== (centerFacelet[i] >> 4)) { check = false; break; }
      }
      if (check) return j;
      c.rotStep(j);
    }
    return -1;
  }

  // ---- Center2: phase 2 ---------------------------------------------------

  var c2_rlmv = new Int32Array(70 * 28), c2_ctmv = new Uint16Array(6435 * 28);
  var c2_rlrot = new Int32Array(70 * 16), c2_ctrot = new Uint16Array(6435 * 16);
  var c2_ctprun = new Int8Array(6435 * 35 * 2);
  var c2_pmv = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1,
    0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0];

  function Center2() {
    this.rl = new Int32Array(8);
    this.ct = new Int32Array(16);
    this.parity = 0;
  }
  Center2.prototype.set = function (c, edgeParity) {
    for (var i = 0; i < 16; i++) this.ct[i] = c.ct[i] % 3;
    for (var i = 0; i < 8; i++) this.rl[i] = c.ct[i + 16];
    this.parity = edgeParity;
  };
  Center2.prototype.getrl = function () {
    var idx = 0, r = 4;
    for (var i = 6; i >= 0; i--) if (this.rl[i] !== this.rl[7]) idx += Cnk[i][r--];
    return idx * 2 + this.parity;
  };
  Center2.prototype.setrl = function (idx) {
    this.parity = idx & 1;
    idx >>>= 1;
    var r = 4;
    this.rl[7] = 0;
    for (var i = 6; i >= 0; i--) {
      if (idx >= Cnk[i][r]) { idx -= Cnk[i][r--]; this.rl[i] = 1; } else this.rl[i] = 0;
    }
  };
  Center2.prototype.getct = function () {
    var idx = 0, r = 8;
    for (var i = 14; i >= 0; i--) if (this.ct[i] !== this.ct[15]) idx += Cnk[i][r--];
    return idx;
  };
  Center2.prototype.setct = function (idx) {
    var r = 8;
    this.ct[15] = 0;
    for (var i = 14; i >= 0; i--) {
      if (idx >= Cnk[i][r]) { idx -= Cnk[i][r--]; this.ct[i] = 1; } else this.ct[i] = 0;
    }
  };
  Center2.prototype.rot = function (r) {
    var ct = this.ct, rl = this.rl;
    switch (r) {
      case 0: this.move(ux2); this.move(dx2); break;
      case 1: this.move(rx1); this.move(lx3); break;
      case 2:
        swap(ct, 0, 3, 1, 2, 1); swap(ct, 8, 11, 9, 10, 1); swap(ct, 4, 7, 5, 6, 1);
        swap(ct, 12, 15, 13, 14, 1); swap(rl, 0, 3, 5, 6, 1); swap(rl, 1, 2, 4, 7, 1);
        break;
    }
  };
  Center2.prototype.move = function (m) {
    this.parity ^= c2_pmv[m];
    var key = m % 3;
    m = (m / 3) | 0;
    var ct = this.ct, rl = this.rl;
    switch (m) {
      case 0: swap(ct, 0, 1, 2, 3, key); break;
      case 1: swap(rl, 0, 1, 2, 3, key); break;
      case 2: swap(ct, 8, 9, 10, 11, key); break;
      case 3: swap(ct, 4, 5, 6, 7, key); break;
      case 4: swap(rl, 4, 5, 6, 7, key); break;
      case 5: swap(ct, 12, 13, 14, 15, key); break;
      case 6: swap(ct, 0, 1, 2, 3, key); swap(rl, 0, 5, 4, 1, key); swap(ct, 8, 9, 12, 13, key); break;
      case 7: swap(rl, 0, 1, 2, 3, key); swap(ct, 1, 15, 5, 9, key); swap(ct, 2, 12, 6, 10, key); break;
      case 8: swap(ct, 8, 9, 10, 11, key); swap(rl, 0, 3, 6, 5, key); swap(ct, 3, 2, 5, 4, key); break;
      case 9: swap(ct, 4, 5, 6, 7, key); swap(rl, 3, 2, 7, 6, key); swap(ct, 11, 10, 15, 14, key); break;
      case 10: swap(rl, 4, 5, 6, 7, key); swap(ct, 0, 8, 4, 14, key); swap(ct, 3, 11, 7, 13, key); break;
      case 11: swap(ct, 12, 13, 14, 15, key); swap(rl, 1, 4, 7, 2, key); swap(ct, 1, 0, 7, 6, key); break;
    }
  };

  function c2Init() {
    var c = new Center2();
    for (var i = 0; i < 70; i++) {
      for (var m = 0; m < 28; m++) {
        c.setrl(i);
        c.move(move2std[m]);
        c2_rlmv[i * 28 + m] = c.getrl();
      }
    }
    for (var i = 0; i < 70; i++) {
      c.setrl(i);
      for (var j = 0; j < 16; j++) {
        c2_rlrot[i * 16 + j] = c.getrl();
        c.rot(0);
        if (j % 2 === 1) c.rot(1);
        if (j % 8 === 7) c.rot(2);
      }
    }
    for (var i = 0; i < 6435; i++) {
      c.setct(i);
      for (var j = 0; j < 16; j++) {
        c2_ctrot[i * 16 + j] = c.getct();
        c.rot(0);
        if (j % 2 === 1) c.rot(1);
        if (j % 8 === 7) c.rot(2);
      }
    }
    for (var i = 0; i < 6435; i++) {
      for (var m = 0; m < 28; m++) {
        c.setct(i);
        c.move(move2std[m]);
        c2_ctmv[i * 28 + m] = c.getct();
      }
    }
    c2_ctprun.fill(-1);
    c2_ctprun[0] = c2_ctprun[18] = c2_ctprun[28] = c2_ctprun[46] = c2_ctprun[54] = c2_ctprun[56] = 0;
    var depth = 0, done = 6, total = 6435 * 35 * 2;
    while (done !== total) {
      for (var i = 0; i < total; i++) {
        if (c2_ctprun[i] !== depth) continue;
        var ct = (i / 70) | 0, rl = i % 70;
        for (var m = 0; m < 23; m++) {
          var idx = c2_ctmv[ct * 28 + m] * 70 + c2_rlmv[rl * 28 + m];
          if (c2_ctprun[idx] === -1) { c2_ctprun[idx] = depth + 1; done++; }
        }
      }
      depth++;
    }
  }

  // ---- Center3: phase 3 centres -------------------------------------------

  var C3_N = 35 * 35 * 12 * 2;
  var c3_ctmove = new Uint16Array(C3_N * 20), c3_prun = new Int8Array(C3_N);
  var c3_pmove = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  var c3_rl2std = [0, 9, 14, 23, 27, 28, 41, 42, 46, 55, 60, 69];
  var c3_std2rl = new Int32Array(70);

  function Center3() {
    this.ud = new Int32Array(8);
    this.rl = new Int32Array(8);
    this.fb = new Int32Array(8);
    this.parity = 0;
  }
  Center3.prototype.set = function (c, eXcParity) {
    var a = c.ct[0] % 3, b = c.ct[8] % 3, d = c.ct[16] % 3;
    var parity = (((a > b) !== (b > d)) !== (a > d)) ? 0 : 1;
    for (var i = 0; i < 8; i++) {
      this.ud[i] = ((c.ct[i] / 3) | 0) ^ 1;
      this.fb[i] = ((c.ct[i + 8] / 3) | 0) ^ 1;
      this.rl[i] = ((c.ct[i + 16] / 3) | 0) ^ 1 ^ parity;
    }
    this.parity = parity ^ eXcParity;
  };
  Center3.prototype.getct = function () {
    var idx = 0, r = 4;
    for (var i = 6; i >= 0; i--) if (this.ud[i] !== this.ud[7]) idx += Cnk[i][r--];
    idx *= 35;
    r = 4;
    for (var i = 6; i >= 0; i--) if (this.fb[i] !== this.fb[7]) idx += Cnk[i][r--];
    idx *= 12;
    var check = this.fb[7] ^ this.ud[7];
    var idxrl = 0;
    r = 4;
    for (var i = 7; i >= 0; i--) if (this.rl[i] !== check) idxrl += Cnk[i][r--];
    return this.parity + 2 * (idx + c3_std2rl[idxrl]);
  };
  Center3.prototype.setct = function (idx) {
    this.parity = idx & 1;
    idx >>>= 1;
    var idxrl = c3_rl2std[idx % 12];
    idx = (idx / 12) | 0;
    var r = 4;
    for (var i = 7; i >= 0; i--) {
      this.rl[i] = 0;
      if (idxrl >= Cnk[i][r]) { idxrl -= Cnk[i][r--]; this.rl[i] = 1; }
    }
    var idxfb = idx % 35;
    idx = (idx / 35) | 0;
    r = 4;
    this.fb[7] = 0;
    for (var i = 6; i >= 0; i--) {
      if (idxfb >= Cnk[i][r]) { idxfb -= Cnk[i][r--]; this.fb[i] = 1; } else this.fb[i] = 0;
    }
    r = 4;
    this.ud[7] = 0;
    for (var i = 6; i >= 0; i--) {
      if (idx >= Cnk[i][r]) { idx -= Cnk[i][r--]; this.ud[i] = 1; } else this.ud[i] = 0;
    }
  };
  Center3.prototype.move = function (i) {
    this.parity ^= c3_pmove[i];
    var ud = this.ud, rl = this.rl, fb = this.fb;
    switch (i) {
      case 0: case 1: case 2: swap(ud, 0, 1, 2, 3, i % 3); break;
      case 3: swap(rl, 0, 1, 2, 3, 1); break;
      case 4: case 5: case 6: swap(fb, 0, 1, 2, 3, (i - 1) % 3); break;
      case 7: case 8: case 9: swap(ud, 4, 5, 6, 7, (i - 1) % 3); break;
      case 10: swap(rl, 4, 5, 6, 7, 1); break;
      case 11: case 12: case 13: swap(fb, 4, 5, 6, 7, (i + 1) % 3); break;
      case 14: swap(ud, 0, 1, 2, 3, 1); swap(rl, 0, 5, 4, 1, 1); swap(fb, 0, 5, 4, 1, 1); break;
      case 15: swap(rl, 0, 1, 2, 3, 1); swap(fb, 1, 4, 7, 2, 1); swap(ud, 1, 6, 5, 2, 1); break;
      case 16: swap(fb, 0, 1, 2, 3, 1); swap(ud, 3, 2, 5, 4, 1); swap(rl, 0, 3, 6, 5, 1); break;
      case 17: swap(ud, 4, 5, 6, 7, 1); swap(rl, 3, 2, 7, 6, 1); swap(fb, 3, 2, 7, 6, 1); break;
      case 18: swap(rl, 4, 5, 6, 7, 1); swap(fb, 0, 3, 6, 5, 1); swap(ud, 0, 3, 4, 7, 1); break;
      case 19: swap(fb, 4, 5, 6, 7, 1); swap(ud, 0, 7, 6, 1, 1); swap(rl, 1, 4, 7, 2, 1); break;
    }
  };

  function c3Init() {
    for (var i = 0; i < 12; i++) c3_std2rl[c3_rl2std[i]] = i;
    var c = new Center3();
    for (var i = 0; i < C3_N; i++) {
      for (var m = 0; m < 20; m++) {
        c.setct(i);
        c.move(m);
        c3_ctmove[i * 20 + m] = c.getct();
      }
    }
    c3_prun.fill(-1);
    c3_prun[0] = 0;
    var depth = 0, done = 1;
    while (done !== 29400) {
      for (var i = 0; i < 29400; i++) {
        if (c3_prun[i] !== depth) continue;
        for (var m = 0; m < 17; m++) {
          var t = c3_ctmove[i * 20 + m];
          if (c3_prun[t] === -1) { c3_prun[t] = depth + 1; done++; }
        }
      }
      depth++;
    }
  }

  // ---- Edge3: phase 3 edges -----------------------------------------------

  var E3_SYM = 1538, E3_RAW = 20160, E3_EPRUN = E3_SYM * E3_RAW, E3_MAXDEPTH = 10;
  var e3_eprun = null;
  var e3_sym2raw = new Int32Array(E3_SYM), e3_symstate = new Uint16Array(E3_SYM);
  var e3_raw2sym = new Int32Array(11880);
  var e3_syminv = [0, 1, 6, 3, 4, 5, 2, 7];
  var e3_mvrot = new Int32Array(20 * 8 * 12), e3_mvroto = new Int32Array(20 * 8 * 12);
  var factX = [1, 1, 1, 3, 12, 60, 360, 2520, 20160, 181440, 1814400, 19958400, 239500800];

  function Edge3() {
    this.edge = new Int32Array(12);
    this.edgeo = new Int32Array(12);
    this.temp = new Int32Array(12);
    this.isStd = true;
  }
  Edge3.prototype.setFrom = function (e) {
    this.edge.set(e.edge); this.edgeo.set(e.edgeo); this.isStd = e.isStd;
  };
  Edge3.prototype.setFromCube = function (c) {
    var temp = this.temp, edge = this.edge;
    for (var i = 0; i < 12; i++) { temp[i] = i; edge[i] = c.ep[FullEdgeMap[i] + 12] % 12; }
    var parity = 1;                                 // because of FullEdgeMap
    for (var i = 0; i < 12; i++) {
      while (edge[i] !== i) {
        var t = edge[i];
        edge[i] = edge[t]; edge[t] = t;
        var s = temp[i]; temp[i] = temp[t]; temp[t] = s;
        parity ^= 1;
      }
    }
    for (var i = 0; i < 12; i++) edge[i] = temp[c.ep[FullEdgeMap[i]] % 12];
    this.isStd = true;
    for (var i = 0; i < 12; i++) this.edgeo[i] = i;
    return parity;
  };
  var FullEdgeMap = [0, 2, 4, 6, 1, 3, 7, 5, 8, 9, 10, 11];

  Edge3.prototype.std = function () {
    var temp = this.temp, edge = this.edge, edgeo = this.edgeo;
    for (var i = 0; i < 12; i++) temp[edgeo[i]] = i;
    for (var i = 0; i < 12; i++) { edge[i] = temp[edge[i]]; edgeo[i] = i; }
    this.isStd = true;
  };

  /*
   * Twelve 4-bit values in one register. Java uses a 64-bit long; JavaScript's
   * bitwise operators are 32-bit, so this keeps the pack in two halves — the
   * author's own fallback for the machines where long was slow. Every step is
   * forced back through |0 because Java's int arithmetic wraps and JavaScript's
   * numbers do not.
   */
  Edge3.prototype.get = function (end) {
    if (!this.isStd) this.std();
    var idx = 0, vall = 0x76543210, valh = 0xba98;
    for (var i = 0; i < end; i++) {
      var v = this.edge[i] << 2;
      idx *= 12 - i;
      if (v >= 32) {
        idx += (valh >> (v - 32)) & 0xf;
        valh = (valh - ((0x1110 << (v - 32)) | 0)) | 0;
      } else {
        idx += (vall >> v) & 0xf;
        valh = (valh - 0x1111) | 0;
        vall = (vall - ((0x11111110 << v) | 0)) | 0;
      }
    }
    return idx;
  };

  Edge3.prototype.set = function (idx) {
    var vall = 0x76543210, valh = 0xba98, parity = 0;
    for (var i = 0; i < 11; i++) {
      var p = factX[11 - i];
      var v = (idx / p) | 0;
      idx = idx % p;
      parity ^= v;
      v <<= 2;
      if (v >= 32) {
        v = v - 32;
        this.edge[i] = (valh >> v) & 0xf;
        var m = (1 << v) - 1;
        valh = ((valh & m) + ((valh >> 4) & ~m)) | 0;
      } else {
        this.edge[i] = (vall >> v) & 0xf;
        var m2 = (1 << v) - 1;
        vall = ((vall & m2) + ((vall >>> 4) & ~m2) + ((valh << 28) | 0)) | 0;
        valh = valh >> 4;
      }
    }
    if ((parity & 1) === 0) {
      this.edge[11] = vall & 0xf;
    } else {
      this.edge[11] = this.edge[10];
      this.edge[10] = vall & 0xf;
    }
    for (var i = 0; i < 12; i++) this.edgeo[i] = i;
    this.isStd = true;
  };

  function e3Getmvrot(ep, mrIdx, end) {
    var base = mrIdx * 12;
    var idx = 0, vall = 0x76543210, valh = 0xba98;
    for (var i = 0; i < end; i++) {
      var v = e3_mvroto[base + ep[e3_mvrot[base + i]]] << 2;
      idx *= 12 - i;
      if (v >= 32) {
        idx += (valh >> (v - 32)) & 0xf;
        valh = (valh - ((0x1110 << (v - 32)) | 0)) | 0;
      } else {
        idx += (vall >> v) & 0xf;
        valh = (valh - 0x1111) | 0;
        vall = (vall - ((0x11111110 << v) | 0)) | 0;
      }
    }
    return idx;
  }

  function circle(arr, a, b, c, d) {
    var t = arr[d]; arr[d] = arr[c]; arr[c] = arr[b]; arr[b] = arr[a]; arr[a] = t;
  }
  function swap4(arr, a, b, c, d) {
    var t = arr[a]; arr[a] = arr[c]; arr[c] = t;
    t = arr[b]; arr[b] = arr[d]; arr[d] = t;
  }
  function swap2(arr, x, y) { var t = arr[x]; arr[x] = arr[y]; arr[y] = t; }

  Edge3.prototype.move = function (i) {
    this.isStd = false;
    var e = this.edge, o = this.edgeo;
    switch (i) {
      case 0: circle(e, 0, 4, 1, 5); circle(o, 0, 4, 1, 5); break;
      case 1: swap4(e, 0, 4, 1, 5); swap4(o, 0, 4, 1, 5); break;
      case 2: circle(e, 0, 5, 1, 4); circle(o, 0, 5, 1, 4); break;
      case 3: swap4(e, 5, 10, 6, 11); swap4(o, 5, 10, 6, 11); break;
      case 4: circle(e, 0, 11, 3, 8); circle(o, 0, 11, 3, 8); break;
      case 5: swap4(e, 0, 11, 3, 8); swap4(o, 0, 11, 3, 8); break;
      case 6: circle(e, 0, 8, 3, 11); circle(o, 0, 8, 3, 11); break;
      case 7: circle(e, 2, 7, 3, 6); circle(o, 2, 7, 3, 6); break;
      case 8: swap4(e, 2, 7, 3, 6); swap4(o, 2, 7, 3, 6); break;
      case 9: circle(e, 2, 6, 3, 7); circle(o, 2, 6, 3, 7); break;
      case 10: swap4(e, 4, 8, 7, 9); swap4(o, 4, 8, 7, 9); break;
      case 11: circle(e, 1, 9, 2, 10); circle(o, 1, 9, 2, 10); break;
      case 12: swap4(e, 1, 9, 2, 10); swap4(o, 1, 9, 2, 10); break;
      case 13: circle(e, 1, 10, 2, 9); circle(o, 1, 10, 2, 9); break;
      case 14: swap4(e, 0, 4, 1, 5); swap4(o, 0, 4, 1, 5); swap2(e, 9, 11); swap2(o, 8, 10); break;
      case 15: swap4(e, 5, 10, 6, 11); swap4(o, 5, 10, 6, 11); swap2(e, 1, 3); swap2(o, 0, 2); break;
      case 16: swap4(e, 0, 11, 3, 8); swap4(o, 0, 11, 3, 8); swap2(e, 5, 7); swap2(o, 4, 6); break;
      case 17: swap4(e, 2, 7, 3, 6); swap4(o, 2, 7, 3, 6); swap2(e, 8, 10); swap2(o, 9, 11); break;
      case 18: swap4(e, 4, 8, 7, 9); swap4(o, 4, 8, 7, 9); swap2(e, 0, 2); swap2(o, 1, 3); break;
      case 19: swap4(e, 1, 9, 2, 10); swap4(o, 1, 9, 2, 10); swap2(e, 4, 6); swap2(o, 5, 7); break;
    }
  };
  Edge3.prototype.swapx = function (x, y) {
    var t = this.edge[x]; this.edge[x] = this.edgeo[y]; this.edgeo[y] = t;
  };
  Edge3.prototype.circlex = function (a, b, c, d) {
    var t = this.edgeo[d];
    this.edgeo[d] = this.edge[c]; this.edge[c] = this.edgeo[b];
    this.edgeo[b] = this.edge[a]; this.edge[a] = t;
  };
  Edge3.prototype.rot = function (r) {
    this.isStd = false;
    switch (r) {
      case 0: this.move(14); this.move(17); break;
      case 1:
        this.circlex(11, 5, 10, 6); this.circlex(5, 10, 6, 11); this.circlex(1, 2, 3, 0);
        this.circlex(4, 9, 7, 8); this.circlex(8, 4, 9, 7); this.circlex(0, 1, 2, 3);
        break;
      case 2:
        this.swapx(4, 5); this.swapx(5, 4); this.swapx(11, 8); this.swapx(8, 11);
        this.swapx(7, 6); this.swapx(6, 7); this.swapx(9, 10); this.swapx(10, 9);
        this.swapx(1, 1); this.swapx(0, 0); this.swapx(3, 3); this.swapx(2, 2);
        break;
    }
  };
  Edge3.prototype.rotate = function (r) {
    while (r >= 2) { r -= 2; this.rot(1); this.rot(2); }
    if (r !== 0) this.rot(0);
  };
  Edge3.prototype.getsym = function () {
    var cord1x = this.get(4);
    var symcord1x = e3_raw2sym[cord1x];
    var symx = symcord1x & 0x7;
    symcord1x >>= 3;
    this.rotate(symx);
    var cord2x = this.get(10) % E3_RAW;
    return symcord1x * E3_RAW + cord2x;
  };

  function e3SetPruning(index, value) {
    e3_eprun[index >> 4] ^= (0x3 ^ value) << ((index & 0xf) << 1);
  }
  function e3GetPruning(index) {
    return (e3_eprun[index >> 4] >> ((index & 0xf) << 1)) & 0x3;
  }
  function e3GetprunFrom(edge, prun) {
    var depm3 = e3GetPruning(edge);
    if (depm3 === 0x3) return E3_MAXDEPTH;
    return (depm3 - prun + 16) % 3 + prun - 1;
  }
  function e3Getprun(edge) {
    var e = new Edge3();
    var depth = 0;
    var depm3 = e3GetPruning(edge);
    if (depm3 === 0x3) return E3_MAXDEPTH;
    while (edge !== 0) {
      depm3 = (depm3 === 0) ? 2 : depm3 - 1;
      var symcord1 = (edge / E3_RAW) | 0;
      var cord1 = e3_sym2raw[symcord1];
      var cord2 = edge % E3_RAW;
      e.set(cord1 * E3_RAW + cord2);
      for (var m = 0; m < 17; m++) {
        var cord1x = e3Getmvrot(e.edge, m << 3, 4);
        var symcord1x = e3_raw2sym[cord1x];
        var symx = symcord1x & 0x7;
        symcord1x >>= 3;
        var cord2x = e3Getmvrot(e.edge, m << 3 | symx, 10) % E3_RAW;
        var idx = symcord1x * E3_RAW + cord2x;
        if (e3GetPruning(idx) === depm3) { depth++; edge = idx; break; }
      }
    }
    return depth;
  }

  function e3InitMvrot() {
    var e = new Edge3();
    for (var m = 0; m < 20; m++) {
      for (var r = 0; r < 8; r++) {
        e.set(0);
        e.move(m);
        e.rotate(r);
        var base = (m << 3 | r) * 12;
        for (var i = 0; i < 12; i++) e3_mvrot[base + i] = e.edge[i];
        e.std();
        for (var i = 0; i < 12; i++) e3_mvroto[base + i] = e.temp[i];
      }
    }
  }

  function e3InitRaw2Sym() {
    var e = new Edge3();
    var occ = new Uint8Array(11880 / 8);
    var count = 0;
    for (var i = 0; i < 11880; i++) {
      if ((occ[i >>> 3] & (1 << (i & 7))) !== 0) continue;
      e.set(i * factX[8]);
      for (var j = 0; j < 8; j++) {
        var idx = e.get(4);
        if (idx === i) e3_symstate[count] |= 1 << j;
        occ[idx >> 3] |= (1 << (idx & 7));
        e3_raw2sym[idx] = count << 3 | e3_syminv[j];
        e.rot(0);
        if (j % 2 === 1) { e.rot(1); e.rot(2); }
      }
      e3_sym2raw[count++] = i;
    }
    return count;
  }

  function e3CreatePrun() {
    e3_eprun = new Int32Array(E3_EPRUN / 16);
    e3_eprun.fill(-1);
    var e = new Edge3(), f = new Edge3(), g = new Edge3();
    var depth = 0, done = 1;
    e3SetPruning(0, 0);

    while (done !== E3_EPRUN) {
      var inv = depth > 9;
      var depm3 = depth % 3;
      var dep1m3 = (depth + 1) % 3;
      var find = inv ? 0x3 : depm3;
      var chk = inv ? depm3 : 0x3;
      if (depth >= E3_MAXDEPTH - 1) break;

      for (var i_ = 0; i_ < E3_EPRUN; i_ += 16) {
        var val = e3_eprun[i_ >> 4];
        if (!inv && val === -1) continue;
        for (var i = i_, end = i_ + 16; i < end; i++, val >>= 2) {
          if ((val & 0x3) !== find) continue;
          var symcord1 = (i / E3_RAW) | 0;
          var cord1 = e3_sym2raw[symcord1];
          var cord2 = i % E3_RAW;
          e.set(cord1 * E3_RAW + cord2);

          for (var m = 0; m < 17; m++) {
            var cord1x = e3Getmvrot(e.edge, m << 3, 4);
            var symcord1x = e3_raw2sym[cord1x];
            var symx = symcord1x & 0x7;
            symcord1x >>= 3;
            var cord2x = e3Getmvrot(e.edge, m << 3 | symx, 10) % E3_RAW;
            var idx = symcord1x * E3_RAW + cord2x;
            if (e3GetPruning(idx) !== chk) continue;
            e3SetPruning(inv ? i : idx, dep1m3);
            done++;
            if (inv) break;
            var symState = e3_symstate[symcord1x];
            if (symState === 1) continue;
            f.setFrom(e);
            f.move(m);
            f.rotate(symx);
            for (var j = 1; (symState >>= 1) !== 0; j++) {
              if ((symState & 1) !== 1) continue;
              g.setFrom(f);
              g.rotate(j);
              var idxx = symcord1x * E3_RAW + g.get(10) % E3_RAW;
              if (e3GetPruning(idxx) === chk) { e3SetPruning(idxx, dep1m3); done++; }
            }
          }
        }
      }
      depth++;
    }
  }

  // ---- FullCube -----------------------------------------------------------

  function FullCube(src) {
    this.edge = new EdgeCube();
    this.center = new CenterCube();
    this.corner = new CornerCube();
    this.value = 0;
    this.add1 = false;
    this.length1 = 0; this.length2 = 0; this.length3 = 0;
    this.sym = 0;
    this.moveBuffer = new Int8Array(60);
    this.moveLength = 0;
    this.edgeAvail = 0; this.centerAvail = 0; this.cornerAvail = 0;
    if (src) this.copy(src);
  }
  FullCube.fromFacelet = function (f) {
    var c = new FullCube();
    for (var i = 0; i < 24; i++) c.center.ct[i] = f[centerFacelet[i]];
    for (var i = 0; i < 24; i++) {
      for (var j = 0; j < 24; j++) {
        if (f[edgeFacelet[i][0]] === (edgeFacelet[j][0] >> 4) &&
            f[edgeFacelet[i][1]] === (edgeFacelet[j][1] >> 4)) {
          c.edge.ep[i] = j;
        }
      }
    }
    for (var i = 0; i < 8; i++) {
      var ori;
      for (ori = 0; ori < 3; ori++) {
        var v = f[cornerFacelet[i][ori]];
        if (v === (u0 >> 4) || v === (d0 >> 4)) break;
      }
      var col1 = f[cornerFacelet[i][(ori + 1) % 3]];
      var col2 = f[cornerFacelet[i][(ori + 2) % 3]];
      for (var j = 0; j < 8; j++) {
        if (col1 === (cornerFacelet[j][1] >> 4) && col2 === (cornerFacelet[j][2] >> 4)) {
          c.corner.cp[i] = j;
          c.corner.co[i] = ori % 3;
          break;
        }
      }
    }
    return c;
  };
  FullCube.prototype.copy = function (c) {
    this.edge.copy(c.edge); this.center.copy(c.center); this.corner.copy(c.corner);
    this.value = c.value; this.add1 = c.add1;
    this.length1 = c.length1; this.length2 = c.length2; this.length3 = c.length3;
    this.sym = c.sym;
    this.moveBuffer.set(c.moveBuffer);
    this.moveLength = c.moveLength;
    this.edgeAvail = c.edgeAvail; this.centerAvail = c.centerAvail; this.cornerAvail = c.cornerAvail;
  };
  FullCube.prototype.move = function (m) { this.moveBuffer[this.moveLength++] = m; };
  FullCube.prototype.doMove = function (m) {
    this.getEdge().move(m); this.getCenter().move(m); this.getCorner().move(m % 18);
  };
  FullCube.prototype.getEdge = function () {
    while (this.edgeAvail < this.moveLength) this.edge.move(this.moveBuffer[this.edgeAvail++]);
    return this.edge;
  };
  FullCube.prototype.getCenter = function () {
    while (this.centerAvail < this.moveLength) this.center.move(this.moveBuffer[this.centerAvail++]);
    return this.center;
  };
  FullCube.prototype.getCorner = function () {
    while (this.cornerAvail < this.moveLength) this.corner.move(this.moveBuffer[this.cornerAvail++] % 18);
    return this.corner;
  };
  FullCube.prototype.checkEdge = function () { return this.getEdge().checkEdge(); };
  /**
   * The reduced cube, as a 3x3 in solver space.
   *
   * kociemba.js wants the centre of face f to BE f — that is what tells it
   * which colour is which face. The reduction does not leave the cube that way:
   * phases 1 to 3 work in a symmetry frame, so the centres come out solid but
   * carrying whichever colours that frame landed on (5,0,4,2,3,1 rather than
   * 0,1,2,3,4,5). Handing that over unrelabelled produced move lists that
   * reduced the cube perfectly and then finished it wrongly — six solid
   * centres, twelve joined pairs, and not one uniform face.
   *
   * Relabelling colours moves nothing, so the moves that come back still mean
   * what they say about U, R, F and the rest.
   */
  FullCube.prototype.to333Facelet = function () {
    var ret = new Int8Array(54);
    this.getEdge().fill333(ret);
    if (!this.getCenter().fill333(ret)) return null;
    this.getCorner().fill333(ret);

    var toFace = new Int8Array(6).fill(-1);
    for (var f = 0; f < 6; f++) {
      var colour = ret[f * 9 + 4];
      if (colour < 0 || colour > 5 || toFace[colour] !== -1) return null;   // not six distinct centres
      toFace[colour] = f;
    }
    for (var i = 0; i < 54; i++) ret[i] = toFace[ret[i]];
    return ret;
  };

  var move2rot = [35, 1, 34, 2, 4, 6, 22, 5, 19];

  /**
   * The moves, mapped back out of the symmetry frame the search worked in.
   *
   * Phase 1 runs on the cube as given; everything after it runs on a rotated
   * copy, so those moves have to be carried back through the symmetry before
   * they mean anything to a real cube. A move that comes out as a slice deeper
   * than the outer layers is a cube rotation in disguise, and folds into the
   * running symmetry instead of being emitted.
   */
  FullCube.prototype.getMoveList = function () {
    var fixed = [];
    for (var i = 0; i < this.length1; i++) fixed.push(this.moveBuffer[i]);
    var sym = this.sym;
    for (var i = this.length1 + (this.add1 ? 2 : 0); i < this.moveLength; i++) {
      var mv = c1_symmove[sym][this.moveBuffer[i]];
      if (mv >= dx1) {
        fixed.push(mv - 9);
        sym = c1_symmult[sym][move2rot[mv - dx1]];
      } else {
        fixed.push(mv);
      }
    }
    return fixed;
  };

  // ---- the search ---------------------------------------------------------

  var PHASE1_SOLUTIONS = 10000, PHASE2_ATTEMPTS = 500, PHASE2_SOLUTIONS = 100, PHASE3_ATTEMPTS = 100;

  /** Keeps the best PHASE2_ATTEMPTS phase-1 solutions; the worst falls out. */
  function MaxHeap() { this.a = []; }
  MaxHeap.prototype.size = function () { return this.a.length; };
  MaxHeap.prototype.clear = function () { this.a.length = 0; };
  MaxHeap.prototype.push = function (x) {
    var a = this.a; a.push(x);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].value >= a[i].value) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  MaxHeap.prototype.poll = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l].value > a[m].value) m = l;
        if (r < a.length && a[r].value > a[m].value) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  var inited = false;
  function init(onProgress) {
    if (inited) return;
    function say(s) { if (onProgress) onProgress(s); }
    say('centres, stage 1');
    c1InitSym();
    c1_raw2sym = new Int32Array(C1_RAW);
    c1InitSym2Raw();
    c1CreateMoveTable();
    c1_raw2sym = null;                 // 2.9MB that is only needed while building
    c1CreatePrun();
    say('centres, stage 2');
    c2Init();
    say('centres, stage 3');
    c3Init();
    say('edges');
    e3InitMvrot();
    e3InitRaw2Sym();
    e3CreatePrun();
    inited = true;
  }

  function Search() {
    this.move1 = new Int32Array(15);
    this.move2 = new Int32Array(20);
    this.move3 = new Int32Array(20);
    this.p1sols = new MaxHeap();
    this.c1 = new FullCube();
    this.c2 = new FullCube();
    this.ct2 = new Center2();
    this.ct3 = new Center3();
    this.e12 = new Edge3();
    this.tempe = [];
    for (var i = 0; i < 20; i++) this.tempe.push(new Edge3());
    this.arr2 = new Array(PHASE2_SOLUTIONS);
    this.arr2idx = 0;
  }

  Search.prototype.search1 = function (ct, sym, maxl, lm, depth) {
    if (ct === 0 && maxl < 5) return maxl === 0 && this.init2(sym, lm);
    for (var axis = 0; axis < 27; axis += 3) {
      if (axis === lm || axis === lm - 9 || axis === lm - 18) continue;
      for (var power = 0; power < 3; power++) {
        var m = axis + power;
        var ctx = c1_ctsmv[ct * 36 + c1_symmove[sym][m]];
        var prun = c1_csprun[ctx >>> 6];
        if (prun >= maxl) {
          if (prun > maxl) break;
          continue;
        }
        var symx = c1_symmult[sym][ctx & 0x3f];
        this.move1[depth] = m;
        if (this.search1(ctx >>> 6, symx, maxl - 1, axis, depth + 1)) return true;
      }
    }
    return false;
  };

  Search.prototype.init2 = function (sym, lm) {
    var c1 = this.c1;
    c1.copy(this.c);
    for (var i = 0; i < this.length1; i++) c1.move(this.move1[i]);

    var add1 = false;
    switch (c1_finish[sym]) {
      case 0:
        c1.move(fx1); c1.move(bx3);
        this.move1[this.length1] = fx1; this.move1[this.length1 + 1] = bx3;
        add1 = true; sym = 19;
        break;
      case 12869:
        c1.move(ux1); c1.move(dx3);
        this.move1[this.length1] = ux1; this.move1[this.length1 + 1] = dx3;
        add1 = true; sym = 34;
        break;
      case 735470:
        add1 = false; sym = 0;
        break;
    }
    this.ct2.set(c1.getCenter(), c1.getEdge().getParity());
    var s2ct = this.ct2.getct(), s2rl = this.ct2.getrl();
    var ctp = c2_ctprun[s2ct * 70 + s2rl];

    c1.value = ctp + this.length1;
    c1.length1 = this.length1;
    c1.add1 = add1;
    c1.sym = sym;
    this.p1SolsCnt++;

    var next;
    if (this.p1sols.size() < PHASE2_ATTEMPTS) {
      next = new FullCube(c1);
    } else {
      next = this.p1sols.poll();
      if (next.value > c1.value) next.copy(c1);
    }
    this.p1sols.push(next);
    return this.p1SolsCnt === PHASE1_SOLUTIONS;
  };

  Search.prototype.search2 = function (ct, rl, maxl, lm, depth) {
    if (ct === 0 && c2_ctprun[rl] === 0 && maxl === 0) return this.init3();
    for (var m = 0; m < 23; m++) {
      if (ckmv2[lm][m]) { m = skipAxis2[m]; continue; }
      var ctx = c2_ctmv[ct * 28 + m];
      var rlx = c2_rlmv[rl * 28 + m];
      var prun = c2_ctprun[ctx * 70 + rlx];
      if (prun >= maxl) {
        if (prun > maxl) m = skipAxis2[m];
        continue;
      }
      this.move2[depth] = move2std[m];
      if (this.search2(ctx, rlx, maxl - 1, m, depth + 1)) return true;
    }
    return false;
  };

  Search.prototype.init3 = function () {
    var c2 = this.c2;
    c2.copy(this.c1);
    for (var i = 0; i < this.length2; i++) c2.move(this.move2[i]);
    if (!c2.checkEdge()) return false;
    var eparity = this.e12.setFromCube(c2.getEdge());
    this.ct3.set(c2.getCenter(), eparity ^ c2.getCorner().getParity());
    var ct = this.ct3.getct();
    var prun = e3Getprun(this.e12.getsym());

    if (!this.arr2[this.arr2idx]) this.arr2[this.arr2idx] = new FullCube(c2);
    else this.arr2[this.arr2idx].copy(c2);
    this.arr2[this.arr2idx].value = this.length1 + this.length2 + Math.max(prun, c3_prun[ct]);
    this.arr2[this.arr2idx].length2 = this.length2;
    this.arr2idx++;
    return this.arr2idx === this.arr2.length;
  };

  Search.prototype.search3 = function (edge, ct, prun, maxl, lm, depth) {
    if (maxl === 0) return edge === 0 && ct === 0;
    this.tempe[depth].set(edge);
    for (var m = 0; m < 17; m++) {
      if (ckmv3[lm][m]) { m = skipAxis3[m]; continue; }
      var ctx = c3_ctmove[ct * 20 + m];
      var prun1 = c3_prun[ctx];
      if (prun1 >= maxl) {
        if (prun1 > maxl && m < 14) m = skipAxis3[m];
        continue;
      }
      var edgex = e3Getmvrot(this.tempe[depth].edge, m << 3, 10);
      var cord1x = (edgex / E3_RAW) | 0;
      var symcord1x = e3_raw2sym[cord1x];
      var symx = symcord1x & 0x7;
      symcord1x >>= 3;
      var cord2x = e3Getmvrot(this.tempe[depth].edge, m << 3 | symx, 10) % E3_RAW;
      var prunx = e3GetprunFrom(symcord1x * E3_RAW + cord2x, prun);
      if (prunx >= maxl) {
        if (prunx > maxl && m < 14) m = skipAxis3[m];
        continue;
      }
      if (this.search3(edgex, ctx, prunx, maxl - 1, m, depth + 1)) {
        this.move3[depth] = m;
        return true;
      }
    }
    return false;
  };

  /**
   * Solve, given the 96 stickers as face indices (0-5 for U R F D L B) in the
   * same order cuben.js uses. Returns a list of move indices into move2str, or
   * null if the cube cannot be read as a real one.
   */
  Search.prototype.solveFacelet = function (facelet) {
    this.c = FullCube.fromFacelet(facelet);
    return this.doSearch();
  };

  Search.prototype.doSearch = function () {
    var c = this.c;
    var ud = new Center1(c.getCenter(), 0).getsym();
    var fb = new Center1(c.getCenter(), 1).getsym();
    var rl = new Center1(c.getCenter(), 2).getsym();
    if (ud < 0 || fb < 0 || rl < 0) return null;
    var udprun = c1_csprun[ud >>> 6], fbprun = c1_csprun[fb >>> 6], rlprun = c1_csprun[rl >>> 6];

    this.p1SolsCnt = 0;
    this.arr2idx = 0;
    this.p1sols.clear();

    for (this.length1 = Math.min(udprun, fbprun, rlprun); this.length1 < 100; this.length1++) {
      if ((rlprun <= this.length1 && this.search1(rl >>> 6, rl & 0x3f, this.length1, -1, 0)) ||
          (udprun <= this.length1 && this.search1(ud >>> 6, ud & 0x3f, this.length1, -1, 0)) ||
          (fbprun <= this.length1 && this.search1(fb >>> 6, fb & 0x3f, this.length1, -1, 0))) {
        break;
      }
    }

    var p1SolsArr = this.p1sols.a.slice();
    p1SolsArr.sort(function (a, b) { return a.value - b.value; });
    if (!p1SolsArr.length) return null;

    var MAX_LENGTH2 = 9, length12, solved2 = false;
    for (var round = 0; round < 8 && !solved2; round++) {
      OUT2:
      for (length12 = p1SolsArr[0].value; length12 < 100; length12++) {
        for (var i = 0; i < p1SolsArr.length; i++) {
          if (p1SolsArr[i].value > length12) break;
          if (length12 - p1SolsArr[i].length1 > MAX_LENGTH2) continue;
          this.c1.copy(p1SolsArr[i]);
          this.ct2.set(this.c1.getCenter(), this.c1.getEdge().getParity());
          var s2ct = this.ct2.getct(), s2rl = this.ct2.getrl();
          this.length1 = p1SolsArr[i].length1;
          this.length2 = length12 - p1SolsArr[i].length1;
          if (this.search2(s2ct, s2rl, this.length2, 28, 0)) { solved2 = true; break OUT2; }
        }
      }
      MAX_LENGTH2++;
    }
    if (!solved2) return null;

    var arr2 = this.arr2.slice(0, this.arr2idx);
    arr2.sort(function (a, b) { return a.value - b.value; });
    if (!arr2.length) return null;

    /*
     * The loop bound matters here, not just the loop body.
     *
     * The original breaks out of both loops at once with a label, which leaves
     * length123 sitting on the value that worked. Rewriting that as a flag on
     * the `for` condition looks equivalent and is not: the increment still runs
     * on the way out, so length123 ends one too high and the wrong number of
     * moves gets taken out of move3 — a solution that does not solve. And when
     * a pass genuinely fails, length123 reaches 100 and the retry starts again
     * with a deeper limit, which at these depths does not finish this century.
     */
    var length123, index = 0, solved3 = false;
    var MAX_LENGTH3 = 13;
    for (var round = 0; round < 8 && !solved3; round++) {
      OUT3:
      for (length123 = arr2[0].value; length123 < 100; length123++) {
        for (var i = 0; i < Math.min(arr2.length, PHASE3_ATTEMPTS); i++) {
          if (arr2[i].value > length123) break;
          if (length123 - arr2[i].length1 - arr2[i].length2 > MAX_LENGTH3) continue;
          var eparity = this.e12.setFromCube(arr2[i].getEdge());
          this.ct3.set(arr2[i].getCenter(), eparity ^ arr2[i].getCorner().getParity());
          var ct = this.ct3.getct();
          var edge = this.e12.get(10);
          var prun = e3Getprun(this.e12.getsym());
          var left = length123 - arr2[i].length1 - arr2[i].length2;
          if (prun <= left && this.search3(edge, ct, prun, left, 20, 0)) {
            index = i; solved3 = true; break OUT3;
          }
        }
      }
      MAX_LENGTH3++;
    }
    if (!solved3) return null;

    var solcube = new FullCube(arr2[index]);
    var len3 = length123 - solcube.length1 - solcube.length2;
    for (var i = 0; i < len3; i++) solcube.move(move3std[this.move3[i]]);

    var facelet333 = solcube.to333Facelet();
    if (!facelet333) return null;
    var sol333 = Kociemba.solveMoves(facelet333);
    if (!sol333) return null;
    for (var i = 0; i < sol333.length; i++) {
      solcube.move(kociembaMoveToIndex(sol333[i]));
    }
    var list = solcube.getMoveList();
    // What each run of moves was for. The moves come out in the order the
    // phases produced them, so the boundaries are just the phase lengths.
    list.stages = [
      { id: 'centres', count: solcube.length1 + solcube.length2 },
      { id: 'edges', count: len3 },
      { id: 'reduced', count: sol333.length }
    ];
    return list;
  };

  /**
   * The move indices this solver speaks, as moves cuben.js understands.
   *
   * The two agree on everything except width: a `w` move here turns the outer
   * face and the layer under it together, which is that face's turn followed by
   * the matching inner slice.
   */
  var CUBEN_FACES = 'URFDLB';
  function toCubenMoves(indices) {
    var out = [];
    for (var i = 0; i < indices.length; i++) {
      var idx = indices[i];
      var amt = idx % 3;
      var suffix = amt === 0 ? '' : (amt === 1 ? '2' : "'");
      if (idx < 18) {
        out.push(CUBEN_FACES[(idx / 3) | 0] + suffix);
      } else {
        var f = CUBEN_FACES[((idx - 18) / 3) | 0];
        out.push(f + suffix, f.toLowerCase() + suffix);
      }
    }
    return out;
  }

  /** kociemba.js speaks "R2"; the tables here speak move indices. */
  var K_FACE = 'URFDLB';
  function kociembaMoveToIndex(name) {
    var face = K_FACE.indexOf(name[0]);
    var amt = name.length === 1 ? 0 : (name[1] === '2' ? 1 : 2);
    return face * 3 + amt;
  }

  var shared = null;
  /**
   * Solve a 4x4 given its 96 stickers as face indices, in cuben.js's order.
   * Returns { moves: [cuben move names], stages: [...] } or null.
   */
  function solve(facelet) {
    init();
    if (!shared) shared = new Search();
    var found = shared.solveFacelet(facelet);
    if (!found) return null;
    // stage counts are in this solver's moves; a wide one becomes two
    var stages = [], at = 0;
    (found.stages || []).forEach(function (s) {
      var slice = found.slice(at, at + s.count);
      at += s.count;
      stages.push({ id: s.id, count: toCubenMoves(slice).length });
    });
    return { moves: toCubenMoves(found), stages: stages };
  }

  return {
    init: init,
    solve: solve,
    Search: Search,
    move2str: move2str,
    toCubenMoves: toCubenMoves,
    _parts: {
      Cnk: Cnk, fact: fact, swap: swap, set8Perm: set8Perm, parityOf: parityOf,
      centerFacelet: centerFacelet, edgeFacelet: edgeFacelet, cornerFacelet: cornerFacelet,
      CenterCube: CenterCube, EdgeCube: EdgeCube, CornerCube: CornerCube, cornMult: cornMult,
      Center1: Center1, Center2: Center2, Center3: Center3, Edge3: Edge3, FullCube: FullCube,
      c1InitSym: c1InitSym, c1InitSym2Raw: c1InitSym2Raw, c1CreateMoveTable: c1CreateMoveTable,
      c1CreatePrun: c1CreatePrun, c1GetSolvedSym: c1GetSolvedSym,
      c2Init: c2Init, c3Init: c3Init,
      e3InitMvrot: e3InitMvrot, e3InitRaw2Sym: e3InitRaw2Sym, e3CreatePrun: e3CreatePrun,
      e3Getprun: e3Getprun, e3GetPruning: e3GetPruning,
      setRaw2Sym: function (v) { c1_raw2sym = v; },
      counts: function () { return { c1sym: c1_sym2raw.length, e3sym: e3_sym2raw.length }; }
    }
  };
});
