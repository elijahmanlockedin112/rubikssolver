/*
 * app.js — wiring: the three screens, the sticker editor, and the move player.
 *
 * The shape of the app is: scan, then follow the moves. Scanning is the front
 * door and everything else is a fallback, so the home screen is a cube, a size,
 * and one button. A finished scan does not stop to ask anything — it solves and
 * goes straight to the first move.
 */
(function () {
  'use strict';

  // Display palette. Index order is arbitrary; the centers decide which color
  // plays which role, so odd color schemes still work.
  var PALETTE = ['#f4f5f7', '#ffd23f', '#00a651', '#0a58c2', '#d8283c', '#ff8c1a'];
  var COLOR_NAMES = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];
  // Standard western scheme: white up, green front, red right.
  var DEFAULT_FACE_COLOR = [0, 4, 2, 1, 5, 3]; // U R F D L B

  var STORE_KEY = 'rubiks-cube-coach.state';

  /*
   * How long one quarter turn takes on screen.
   *
   * Slow on purpose. This is watched with a cube in one hand, and the thing
   * being read off it is which way a layer went — a turn fast enough to look
   * good is a turn you have to replay. Every half turn is split into two of
   * these (see expandHalfTurns), because a 180° spin has no direction to read
   * and both halves of it happen too fast to follow.
   */
  var MOVE_MS = 1100;

  /*
   * The cube's size has to be settled before anything asks how big a cube is.
   *
   * `solvedColorState()` sizes itself from `size`, so if `size` is still being
   * hoisted when it runs, `stickerCount()` is 6 * undefined * undefined = NaN,
   * and `new Int8Array(NaN)` is not an error — it is an array of length zero.
   * Everything downstream then failed silently, because writing to a typed
   * array past its end is simply ignored: the map stayed blank, painting a
   * sticker did nothing, a finished scan threw its colours away, and solving
   * said every sticker still needed a colour. Switching size and back fixed it,
   * because that rebuilds the array with `size` set by then.
   */
  var size = 3;                      // 2, 3 or 4
  function perFace() { return size * size; }
  function stickerCount() { return 6 * perFace(); }

  var colorState = solvedColorState();
  var selectedColor = 0;
  var painting = false;
  var unsure = {};   // facelets worth a second look before solving
  var note = null;   // what to say at the top of the solve screen, if anything
  // True when the cube on screen has been turned to match the last photo, so
  // the moves already suit how it is being held and there is nothing to line up.
  var orientedFromScan = false;

  var plan = null;        // { moves, states } after expanding half turns
  var index = 0;
  var busy = false;

  function solvedColorState() {
    var s = new Int8Array(stickerCount());
    for (var i = 0; i < s.length; i++) s[i] = DEFAULT_FACE_COLOR[(i / perFace()) | 0];
    return s;
  }

  function $(id) { return document.getElementById(id); }

  // ---- views -------------------------------------------------------------

  /*
   * Square on, not off a corner.
   *
   * The old camera sat off a corner so three faces showed at once, which is
   * more of the cube but a harder picture to match against the thing in your
   * hands: every face is a skewed parallelogram and the layer that is about to
   * turn runs diagonally away from you. Straight on, the front face is a
   * square, the top is a shallow band above it, and a turn reads as up, down,
   * left or right — the same words the instructions use.
   */
  var FRONT_VIEW = { yaw: 0, pitch: 30 };
  var BACK_VIEW = { yaw: 180, pitch: -30 };

  var previewFront = new CubeView($('preview-front'), {
    colors: PALETTE, state: colorState, yaw: FRONT_VIEW.yaw, pitch: FRONT_VIEW.pitch,
    onStickerPick: function (facelet) { paint(facelet); }
  });
  var previewBack = new CubeView($('preview-back'), {
    colors: PALETTE, state: colorState, yaw: BACK_VIEW.yaw, pitch: BACK_VIEW.pitch,
    onStickerPick: function (facelet) { paint(facelet); }
  });
  var solveFront = new CubeView($('solve-front-canvas'), {
    colors: PALETTE, state: colorState, yaw: FRONT_VIEW.yaw, pitch: FRONT_VIEW.pitch
  });
  var solveBack = new CubeView($('solve-back-canvas'), {
    colors: PALETTE, state: colorState, yaw: BACK_VIEW.yaw, pitch: BACK_VIEW.pitch
  });

  function refreshViews() {
    [previewFront, previewBack].forEach(function (v) { v.setState(colorState); });
  }

  // ---- palette + net -----------------------------------------------------

  function buildPalette() {
    var wrap = $('palette');
    PALETTE.forEach(function (hex, i) {
      var b = document.createElement('button');
      b.className = 'swatch' + (i === selectedColor ? ' is-active' : '');
      b.style.background = hex;
      b.title = COLOR_NAMES[i];
      b.setAttribute('aria-label', COLOR_NAMES[i]);
      b.addEventListener('click', function () {
        selectedColor = i;
        [].forEach.call(wrap.children, function (c, k) { c.classList.toggle('is-active', k === i); });
      });
      wrap.appendChild(b);
    });
    var eraser = document.createElement('button');
    eraser.className = 'swatch eraser';
    eraser.textContent = 'clear';
    eraser.title = 'Erase a sticker';
    eraser.addEventListener('click', function () {
      selectedColor = -1;
      [].forEach.call(wrap.children, function (c) { c.classList.remove('is-active'); });
      eraser.classList.add('is-active');
    });
    wrap.appendChild(eraser);
  }

  // face -> where it sits in the map, in reading order
  var NET_SLOTS = [
    { face: 0, label: 'Up' },
    { face: 4, label: 'Left' },
    { face: 2, label: 'Front' },
    { face: 1, label: 'Right' },
    { face: 5, label: 'Back' },
    { face: 3, label: 'Down' }
  ];

  function buildNet() {
    var net = $('net');
    net.innerHTML = '';
    // How wide a face is, for the stylesheet to lay out. Custom properties
    // inherit, so setting it once here reaches every .face below.
    net.style.setProperty('--cube-size', size);
    NET_SLOTS.forEach(function (slot) {
      var holder = document.createElement('div');
      holder.className = 'face-slot';

      var label = document.createElement('span');
      label.className = 'face-label';
      label.textContent = slot.label;
      holder.appendChild(label);

      var face = document.createElement('div');
      face.className = 'face';
      for (var i = 0; i < perFace(); i++) {
        var idx = slot.face * perFace() + i;
        var cell = document.createElement('button');
        // Only a 3x3 has a fixed centre; on a 4x4 every sticker is fair game.
        cell.className = 'sticker' + (isCenter(idx) ? ' is-center' : '');
        cell.dataset.index = idx;
        cell.type = 'button';
        cell.addEventListener('pointerdown', function (e) {
          painting = true;
          paint(+e.currentTarget.dataset.index);
        });
        cell.addEventListener('pointerenter', function (e) {
          if (painting) paint(+e.currentTarget.dataset.index);
        });
        face.appendChild(cell);
      }
      holder.appendChild(face);
      net.appendChild(holder);
    });
    fitNet();
  }

  /*
   * Size the map to the box it has, rather than hoping.
   *
   * Six faces at 4x4 is 96 stickers, and there is no fixed arrangement of them
   * that fits every phone in both orientations: a cross needs four faces of
   * width, two columns need three faces of height, and a landscape phone has
   * 343px of height in total. So both arrangements are measured against the
   * actual box and the one with the bigger sticker wins. This is what keeps the
   * whole map on screen without the page scrolling.
   */
  var lastFit = '';
  function fitNet() {
    var box = document.querySelector('.net-fit');
    var net = $('net');
    if (!box || !net) return;
    var w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    /*
     * Same box, same answer, and skipping it is not just a saving: the box is
     * watched by a ResizeObserver below, and refitting on every notification —
     * including the one the fit itself provokes — is how that turns into a
     * loop.
     */
    var key = w + 'x' + h + ':' + size;
    if (key === lastFit) return;
    lastFit = key;

    var COL_GAP = 10, ROW_GAP = 18, LABEL = 13;
    var best = null;
    [[2, 3], [3, 2]].forEach(function (opt) {
      var cols = opt[0], rows = opt[1];
      var byWidth = (w - (cols - 1) * COL_GAP) / cols;
      var byHeight = (h - (rows - 1) * ROW_GAP - rows * LABEL) / rows;
      var face = Math.min(byWidth, byHeight);
      if (!best || face > best.face) best = { cols: cols, face: face };
    });

    net.style.setProperty('--net-cols', best.cols);
    net.style.setProperty('--net-face', Math.max(48, Math.floor(best.face)) + 'px');
  }

  // A 3x3's centre sticker is bolted to the core and never moves, so the editor
  // protects it. A 4x4 has no such sticker — its four middle pieces are pieces
  // like any other — so nothing is locked.
  function isCenter(idx) { return size === 3 && idx % 9 === 4; }

  function paint(idx) {
    if (isCenter(idx) && !$('edit-centers').checked) return;
    colorState[idx] = selectedColor;
    orientedFromScan = false;   // edited by hand, so no longer "just as photographed"
    delete unsure[idx];   // the user has now had their say on this one
    refreshNet();
    refreshViews();
    save();
    if (isCenter(idx)) updateHoldLabels();
    setMessage('');
  }

  function refreshNet() {
    var cells = document.querySelectorAll('.sticker');
    [].forEach.call(cells, function (cell) {
      var idx = +cell.dataset.index;
      var v = colorState[idx];
      cell.style.background = v < 0 ? '' : PALETTE[v];
      cell.classList.toggle('is-unsure', !!unsure[idx]);
    });
  }

  /** Switch the whole app between cube sizes. */
  function setSize(next) {
    if (next === size) return;
    size = next;
    colorState = solvedColorState();
    unsure = {};
    orientedFromScan = false;
    note = null;
    plan = null;
    [previewFront, previewBack, solveFront, solveBack].forEach(function (v) { v.setSize(size); });
    buildNet();
    refreshNet();
    refreshViews();
    updateHoldLabels();
    document.querySelectorAll('.size-option').forEach(function (b) {
      b.classList.toggle('is-active', +b.dataset.size === size);
    });
    // Only a 3x3 has centre stickers that never move, so only a 3x3 has centres
    // to unlock. On the others the toggle governs nothing.
    $('centres-toggle').hidden = size !== 3;
    setMessage('');
    save();
  }

  /**
   * Say how to hold the cube, in whatever terms actually apply.
   *
   * Three different situations, and one wording only covers one:
   *
   *   - Just scanned. The cube has been turned to match the last photo, so it
   *     is already being held right and there is nothing to look for.
   *   - Typed in, 3x3. The centres name the faces, so name them.
   *   - Typed in, 2x2 or 4x4. Nothing names a face — the middle pieces move —
   *     so the map is the only reference there is, and it says so.
   */
  function updateHoldLabels() {
    var setup = $('hold-note'), solving = $('orientation-note-text');
    if (orientedFromScan) {
      var text = 'Hold the cube exactly as you did for your last photo — nothing to line up.';
      setup.textContent = text;
      solving.textContent = text;
      return;
    }
    if (size !== 3) {
      var mapText = 'A ' + size + '×' + size + ' has no fixed centre, so the map is the reference: ' +
        'hold the cube to match the Front panel, with Up on top.';
      setup.textContent = mapText;
      solving.textContent = mapText;
      return;
    }
    var top = colorState[Cube.CENTERS[0]], front = colorState[Cube.CENTERS[2]];
    var topName = top < 0 ? 'the top' : COLOR_NAMES[top];
    var frontName = front < 0 ? 'the front' : COLOR_NAMES[front];
    setup.textContent = 'Hold your cube with the ' + topName + ' centre on top and the ' +
      frontName + ' centre facing you, then fill in every sticker to match.';
    solving.textContent = 'Keep ' + topName + ' on top and ' + frontName + ' facing you.';
  }

  // ---- persistence -------------------------------------------------------

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(colorState))); } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      // a saved 4x4 must not be poured into a 3x3 and vice versa
      if (Array.isArray(arr) && arr.length === stickerCount()) {
        for (var i = 0; i < arr.length; i++) colorState[i] = arr[i];
      }
    } catch (e) { /* ignore */ }
  }

  // ---- messages ----------------------------------------------------------

  /*
   * The same sentence on whichever screen you are on. Scanning is started from
   * the home screen and solving from the map, and either can be the one with
   * something to say, so both carry the line.
   */
  function setMessage(text, kind) {
    ['setup-message', 'edit-message'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = text || '';
      el.className = 'message' + (kind ? ' ' + kind : '');
    });
  }

  // ---- plain-english move descriptions -----------------------------------

  var MOVE_TEXT = {
    'U': ['Top layer', 'Spin the top layer so the front row slides to your LEFT.'],
    "U'": ['Top layer', 'Spin the top layer so the front row slides to your RIGHT.'],
    'D': ['Bottom layer', 'Spin the bottom layer so the front row slides to your RIGHT.'],
    "D'": ['Bottom layer', 'Spin the bottom layer so the front row slides to your LEFT.'],
    'R': ['Right face', 'Turn the right face so its front edge lifts UP toward the top.'],
    "R'": ['Right face', 'Turn the right face so its front edge drops DOWN toward the bottom.'],
    'L': ['Left face', 'Turn the left face so its front edge drops DOWN toward the bottom.'],
    "L'": ['Left face', 'Turn the left face so its front edge lifts UP toward the top.'],
    'F': ['Front face', 'Turn the whole front face clockwise — its top row slides RIGHT.'],
    "F'": ['Front face', 'Turn the whole front face counter-clockwise — its top row slides LEFT.'],
    'B': ['Back face', 'Turn the back face so its top row slides to your LEFT.'],
    "B'": ['Back face', 'Turn the back face so its top row slides to your RIGHT.'],

    // A 4x4 also turns the layers just under each face. These never came up on
    // a 3x3, so they had no entry — and describe() read [0] off the missing one
    // and threw, inside the render loop's callback, which killed the loop for
    // good. One cube froze mid-solution while the other carried on moving.
    'u': ['Second layer from the top', 'Turn the slice just UNDER the top layer the way you would turn the top: its front slides to your LEFT. The top layer itself does not move.'],
    "u'": ['Second layer from the top', 'Turn the slice just under the top layer so its front slides to your RIGHT. The top layer itself does not move.'],
    'd': ['Second layer from the bottom', 'Turn the slice just ABOVE the bottom layer the way you would turn the bottom: its front slides to your RIGHT. The bottom layer itself does not move.'],
    "d'": ['Second layer from the bottom', 'Turn the slice just above the bottom layer so its front slides to your LEFT. The bottom layer itself does not move.'],
    'r': ['Second layer from the right', 'Turn the slice just INSIDE the right face the way you would turn that face: its front edge lifts UP. The right face itself does not move.'],
    "r'": ['Second layer from the right', 'Turn the slice just inside the right face so its front edge drops DOWN. The right face itself does not move.'],
    'l': ['Second layer from the left', 'Turn the slice just INSIDE the left face the way you would turn that face: its front edge drops DOWN. The left face itself does not move.'],
    "l'": ['Second layer from the left', 'Turn the slice just inside the left face so its front edge lifts UP. The left face itself does not move.'],
    'f': ['Second layer from the front', 'Turn the slice just BEHIND the front face the way you would turn that face: its top row slides RIGHT. The front face itself does not move.'],
    "f'": ['Second layer from the front', 'Turn the slice just behind the front face so its top row slides LEFT. The front face itself does not move.'],
    'b': ['Second layer from the back', 'Turn the slice just IN FRONT of the back face the way you would turn that face: its top row slides LEFT. The back face itself does not move.'],
    "b'": ['Second layer from the back', 'Turn the slice just in front of the back face so its top row slides RIGHT. The back face itself does not move.']
  };

  function faceColorName(letter) {
    var faceIndex = Cube.FACE_INDEX[letter];
    var c = plan ? plan.states[0][Cube.CENTERS[faceIndex]] : colorState[Cube.CENTERS[faceIndex]];
    return c < 0 ? '' : COLOR_NAMES[c];
  }

  /**
   * Describe a move in words.
   *
   * This runs from inside the 3D view's animation callback, so anything it
   * throws takes the render loop down with it and the cube stops mid-solution.
   * An unknown move now falls back to its notation rather than being an
   * exception — worse to read, but the player keeps going.
   */
  function describe(step) {
    var move = step.move;
    var text = MOVE_TEXT[move];
    if (!text) text = [move, 'Turn the layer this move names.'];
    // Only a 3x3 has a fixed centre to name a face by, and only an outer face
    // turn names one at all.
    var name = (size === 3 && move[0] === move[0].toUpperCase()) ? faceColorName(move[0]) : '';
    var detail = text[1];
    // A half turn is shown as two quarters, and being told which one you are on
    // is the difference between "again?" and "again."
    if (step.half === 1) detail += ' This is a half turn done in two: the same turn comes again next.';
    else if (step.half === 2) detail += ' Second half of the same turn — the layer ends up opposite where it started.';
    return { title: text[0] + (name ? ' (' + name + ')' : ''), detail: detail };
  }

  // ---- solving -----------------------------------------------------------

  /** The two-phase solver needs its lookup tables built once per page load. */
  function ensureFastSolver(next) {
    if (Kociemba.isReady()) { next(); return; }
    $('prep').hidden = false;
    $('prep-fill').style.width = '2%';
    Kociemba.prepare(function (p) {
      $('prep-label').textContent = 'Building ' + p.label + '…';
      $('prep-fill').style.width = Math.round(p.progress * 100) + '%';
    }, function () {
      $('prep').hidden = true;
      next();
    });
  }

  function doSolve() {
    if (size === 2) { solveWith(Solver2, 'Working out the shortest solution…'); return; }
    if (size === 4) { solveWith(Solver4, 'Working out a solution…'); return; }

    // A cube that is nearly right is usually one sticker away from being right,
    // and "is this a real cube?" is a tight enough test to say which sticker.
    var mend = typeof CubeRepair !== 'undefined' ? CubeRepair.repair(colorState) : null;
    if (mend && mend.unique) {
      colorState.set(mend.colors);
      unsure = {};
      mend.fixes[0].changes.forEach(function (c) { unsure[c.index] = true; });
      refreshNet(); refreshViews(); save();
      // Carried through to the solve screen: a setup message would be wiped by
      // the view change, and a silent correction is the one thing this must
      // never be.
      note = 'That was not quite a real cube, and there was exactly one way to fix it: ' +
        mend.summary + '. Corrected — go back and change it if that is wrong.';
    } else if (mend && !mend.unique) {
      unsure = {};
      mend.changed.forEach(function (group) { group.forEach(function (i) { unsure[i] = true; }); });
      refreshNet();
      showView('edit');
      setMessage('Almost — one sticker is wrong, but there are ' + mend.fixes.length +
        ' ways to fix it and I will not guess. The possibilities are outlined on the map; ' +
        'correct the one you know is wrong.', 'error');
      return;
    }

    var solverState = Cube.toSolverSpace(colorState);
    if (!solverState) {
      failTo('Every sticker needs a colour, and the six centres must all be different. Fill in the gaps and try again.');
      return;
    }
    var check = Cube.validate(solverState);
    if (!check.ok) { failTo(check.message); return; }

    var solved = true;
    for (var i = 0; i < solverState.length; i++) if (solverState[i] !== Cube.SOLVED[i]) { solved = false; break; }
    if (solved) { showView('setup'); setMessage('That cube is already solved. Nothing to do!', 'ok'); return; }

    setMessage('Searching for a short solution…');
    ensureFastSolver(function () {
      setTimeout(function () {
        try {
          finishSolve({ moves: Kociemba.solveMoves(solverState) });
        } catch (err) {
          failTo('Something went wrong solving that state: ' + err.message);
        }
      }, 20);
    });
  }

  /** Nothing to follow, so land on the map with the reason showing. */
  function failTo(message) {
    showView('edit');
    setMessage(message, 'error');
  }

  /**
   * Solve a cube with no fixed centres — a 2x2 or a 4x4.
   *
   * Both work out for themselves which colour belongs on which face, because
   * neither has a centre sticker to say, so the only thing to check here is
   * that no sticker has been left blank. Anything past that they explain
   * themselves, and both refuse rather than guess.
   */
  function solveWith(solver, working) {
    for (var i = 0; i < colorState.length; i++) {
      if (colorState[i] < 0) {
        failTo('Every sticker needs a colour before solving. Fill in the gaps and try again.');
        return;
      }
    }
    setMessage(working);

    /*
     * Both of these build lookup tables the first time they run — a fraction of
     * a second for a 2x2, most of a second for a 4x4 — and they do it on the
     * page's own thread, so the whole app stops dead with nothing on screen to
     * say why. The 3x3 fast solver already had a panel for exactly this; these
     * two now use it as well, and the timeout is what gives the browser a
     * chance to actually paint it before the work begins.
     */
    $('prep').hidden = false;
    $('prep-label').textContent = working;
    $('prep-fill').style.width = '35%';
    setTimeout(function () {
      var out;
      try {
        out = solver.solve(colorState);
      } catch (err) {
        $('prep').hidden = true;
        failTo('Something went wrong solving that cube: ' + err.message);
        return;
      }
      $('prep-fill').style.width = '100%';
      $('prep').hidden = true;
      if (!out.ok) { failTo(out.message); return; }
      setMessage('');
      finishSolve(out);
    }, 30);
  }

  /** out[i] = src[perm[i]], for a cube of any size. */
  function permuteInto(src, perm) {
    var out = new Int8Array(src.length);
    for (var i = 0; i < src.length; i++) out[i] = src[perm[i]];
    return out;
  }

  /**
   * Split every half turn into two quarter turns.
   *
   * A 180° turn animated in one go is the one move nobody can follow: it has no
   * direction to read — both ways land in the same place — and whichever way
   * the animation happens to go, the layer sweeps past the position you were
   * watching. As two quarter turns it is two ordinary moves in the same
   * direction, each with its own arrow, and the player stops between them.
   *
   * States that came with a solution are kept exactly as given at every
   * original move boundary; only the new midpoint is worked out here, so
   * nothing can drift from what the solver actually meant.
   */
  function expandHalfTurns(solution) {
    var perms = CubeN.of(size).MOVE_PERMS;
    var given = solution.states || null;
    var out = { moves: [], steps: [], states: [] };
    out.states.push(Int8Array.from(given ? given[0] : colorState));

    solution.moves.forEach(function (move, i) {
      var isHalf = move.indexOf('2') > 0;
      var parts = isHalf ? [move.replace('2', ''), move.replace('2', '')] : [move];
      parts.forEach(function (part, k) {
        var last = out.states[out.states.length - 1];
        var next = (given && k === parts.length - 1)
          ? Int8Array.from(given[i + 1])
          : permuteInto(last, perms[part]);
        out.moves.push(part);
        out.steps.push({ move: part, half: isHalf ? k + 1 : 0 });
        out.states.push(next);
      });
    });
    return out;
  }

  function finishSolve(solution) {
    plan = expandHalfTurns(solution);
    setMessage('');
    $('repair-note').textContent = note || '';
    $('repair-note').hidden = !note;
    index = 0;
    showView('solve');
    applyIndex();
  }

  function showView(which) {
    $('view-setup').hidden = which !== 'setup';
    $('view-edit').hidden = which !== 'edit';
    $('view-solve').hidden = which !== 'solve';
    document.body.classList.toggle('solving', which === 'solve');
    if (which === 'solve') { solveFront.dirty = true; solveBack.dirty = true; }
    else { previewFront.dirty = true; previewBack.dirty = true; }
    if (which === 'edit') fitNet();
  }

  // ---- player ------------------------------------------------------------

  function applyIndex() {
    if (!plan) return;
    var total = plan.steps.length;
    var atEnd = index >= total;
    solveFront.setState(plan.states[index]);
    solveBack.setState(plan.states[index]);

    var upcoming = atEnd ? null : plan.steps[index].move;
    solveFront.showArrowFor = upcoming;
    solveBack.showArrowFor = upcoming;
    solveFront.dirty = solveBack.dirty = true;

    if (atEnd) {
      $('move-title').textContent = 'Solved!';
      $('move-detail').textContent = 'Every face should now be a single colour. ' + total + ' moves. Nice work.';
    } else {
      var d = describe(plan.steps[index]);
      $('move-title').textContent = d.title;
      $('move-detail').textContent = d.detail;
    }

    $('move-counter').textContent = atEnd ? 'Done' : 'Move ' + (index + 1) + ' of ' + total;
    // a cube that was already solved has no moves at all, and 0/0 is not a width
    $('progress-fill').style.width = (total ? 100 * index / total : 100).toFixed(1) + '%';
    $('btn-prev').disabled = index === 0;
    $('btn-replay').disabled = index === 0;
    $('btn-next').disabled = atEnd;
    $('btn-next').textContent = atEnd ? 'Done' : 'Next ›';
  }

  function stepForward() {
    if (busy || !plan || index >= plan.steps.length) return;
    var move = plan.steps[index].move;
    busy = true;
    solveFront.showArrowFor = null;
    solveBack.showArrowFor = null;
    solveBack.playMove(move, MOVE_MS, null);
    solveFront.playMove(move, MOVE_MS, function () {
      index++;
      busy = false;
      applyIndex();
    });
  }

  function stepBack() {
    if (busy || !plan || index === 0) return;
    index--;
    applyIndex();
  }

  function replayCurrent() {
    if (busy || !plan || index === 0) return;
    index--;
    applyIndex();
    stepForward();
  }

  // ---- events ------------------------------------------------------------

  function wire() {
    $('btn-solve').addEventListener('click', function () { note = null; doSolve(); });
    $('btn-edit').addEventListener('click', function () { showView('edit'); });
    $('btn-home').addEventListener('click', function () { showView('setup'); });
    $('btn-back').addEventListener('click', function () { showView('setup'); });

    $('btn-example').addEventListener('click', function () {
      /*
       * Scramble with the cube that is actually on screen.
       *
       * This used the 3x3 module whatever the size, which on a 2x2 meant
       * pouring 54 stickers into a 24-sticker array, and on a 4x4 meant a
       * scramble of outer turns only — one that never moves a centre or an
       * inner slice, so the hardest part of the cube came out already solved.
       */
      var model = CubeN.of(size);
      var scramble = model.randomScramble(size === 2 ? 15 : 30);
      // Scramble the app's own solved cube, not the model's: they agree on
      // where the faces are but not on which palette colour sits on each.
      colorState.set(model.applySeq(solvedColorState(), scramble));
      orientedFromScan = false;
      unsure = {};
      refreshNet(); refreshViews(); updateHoldLabels(); save();
      setMessage('Scrambled. Solve it to see the way back.', 'ok');
    });
    $('btn-solved').addEventListener('click', function () {
      colorState.set(solvedColorState());
      refreshNet(); refreshViews(); updateHoldLabels(); save();
      setMessage('');
    });
    $('btn-clear').addEventListener('click', function () {
      for (var i = 0; i < stickerCount(); i++) if (!isCenter(i)) colorState[i] = -1;
      refreshNet(); refreshViews(); save();
      setMessage(size === 3
        ? 'Cleared — the centres stay put because they never move on a 3×3.'
        : 'Cleared. A ' + size + '×' + size + ' has no fixed centres, so everything went.');
    });
    $('edit-centers').addEventListener('change', function (e) {
      $('net').classList.toggle('centers-unlocked', e.target.checked);
    });
    document.querySelectorAll('.size-option').forEach(function (button) {
      button.addEventListener('click', function () { setSize(+button.dataset.size); });
    });

    $('btn-scan').addEventListener('click', function () {
      var scanner = new CubeScanner({
        palette: PALETTE,
        size: size,                 // scan the size that is selected, nothing else
        onDone: function (result) {
          if (result.colors) colorState.set(result.colors);
          unsure = {};
          (result.unsure || []).forEach(function (i) { unsure[i] = true; });
          // A reading that came out whole has been turned to match the last
          // photo, so the cube in the user's hands is already the right way up.
          orientedFromScan = result.source === 'device';
          refreshNet(); refreshViews(); updateHoldLabels(); save();

          if (result.source === 'failed') {
            showView('edit');
            setMessage(result.note || 'Those photos did not add up to a real cube. Fix the wrong ' +
              'stickers on the map, or scan again.', 'error');
            return;
          }

          /*
           * Straight on to the answer.
           *
           * There is nothing worth asking here: the reading either fits
           * together as a real cube or it does not, and if it does, the only
           * reason anyone scanned is to be told what to do next. Checking the
           * map first was a step that existed because the code had one.
           */
          setMessage('Scanned. Working out the moves…', 'ok');
          note = result.ambiguous
            ? 'Those photos fit together in more than one way — with no fixed centre to go by, that ' +
              'can happen. If the cube on screen is not your cube, go back and fix the map.'
            : null;
          doSolve();
        }
      });
      scanner.open();
    });

    $('btn-next').addEventListener('click', stepForward);
    $('btn-prev').addEventListener('click', stepBack);
    $('btn-replay').addEventListener('click', replayCurrent);

    document.addEventListener('keydown', function (e) {
      if ($('view-solve').hidden) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { stepForward(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stepBack(); e.preventDefault(); }
    });

    document.addEventListener('pointerup', function () { painting = false; });

    /*
     * The map is sized to its box, so anything that changes the box has to
     * refit it, and turning the phone is only the obvious one. A message
     * appearing underneath takes 20-40px out of the box; on the phone profiles
     * measured there is enough slack around the map to absorb that, but it is
     * slack, not a guarantee — the map is centred inside an overflow: hidden
     * parent, so a fit that is height-limited when the box shrinks loses a row
     * off the top and the bottom with nothing to show for it. Watching the box
     * itself covers every cause at once, including the ones nobody thought of.
     */
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(fitNet).observe(document.querySelector('.net-fit'));
    }
    window.addEventListener('resize', fitNet);
    window.addEventListener('orientationchange', function () { setTimeout(fitNet, 250); });
  }

  // ---- boot --------------------------------------------------------------

  load();
  buildPalette();
  buildNet();
  refreshNet();
  refreshViews();
  updateHoldLabels();
  wire();
})();
