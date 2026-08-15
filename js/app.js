/*
 * app.js — wiring: the sticker editor, validation, and the guided player.
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
  var size = 3;                      // 3 for a 3x3, 4 for a 4x4
  function perFace() { return size * size; }
  function stickerCount() { return 6 * perFace(); }

  var colorState = solvedColorState();
  var selectedColor = 0;
  var painting = false;
  var unsure = {};   // facelets worth a second look before solving
  var repairNote = null;   // what an automatic correction changed, if anything
  // True when the cube on screen has been turned to match the last photo, so
  // the moves already suit how it is being held and there is nothing to line up.
  var orientedFromScan = false;

  var result = null;      // solver output
  var colorStates = [];   // display state after each move
  var index = 0;
  var playing = false;
  var busy = false;
  var playTimer = null;

  var SPEEDS = [
    { move: 900, gap: 450 },
    { move: 640, gap: 300 },
    { move: 440, gap: 180 },
    { move: 300, gap: 110 },
    { move: 190, gap: 60 }
  ];

  function solvedColorState() {
    var s = new Int8Array(stickerCount());
    for (var i = 0; i < s.length; i++) s[i] = DEFAULT_FACE_COLOR[(i / perFace()) | 0];
    return s;
  }

  function $(id) { return document.getElementById(id); }

  // ---- views -------------------------------------------------------------

  var previewFront = new CubeView($('preview-front'), {
    colors: PALETTE, state: colorState,
    onStickerPick: function (facelet) { paint(facelet); }
  });
  var previewBack = new CubeView($('preview-back'), {
    colors: PALETTE, state: colorState, yaw: 146, pitch: -26,
    onStickerPick: function (facelet) { paint(facelet); }
  });
  var solveFront = new CubeView($('solve-front-canvas'), { colors: PALETTE, state: colorState });
  var solveBack = new CubeView($('solve-back-canvas'), { colors: PALETTE, state: colorState, yaw: 146, pitch: -26 });

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

  // face -> position in the 4x3 net grid
  var NET_SLOTS = [
    { face: 0, col: 2, row: 1, label: 'Up' },
    { face: 4, col: 1, row: 2, label: 'Left' },
    { face: 2, col: 2, row: 2, label: 'Front' },
    { face: 1, col: 3, row: 2, label: 'Right' },
    { face: 5, col: 4, row: 2, label: 'Back' },
    { face: 3, col: 2, row: 3, label: 'Down' }
  ];

  function buildNet() {
    var net = $('net');
    net.innerHTML = '';
    NET_SLOTS.forEach(function (slot) {
      var holder = document.createElement('div');
      holder.className = 'face-slot';
      holder.style.gridColumn = slot.col;
      holder.style.gridRow = slot.row;

      var label = document.createElement('span');
      label.className = 'face-label';
      label.textContent = slot.label;
      holder.appendChild(label);

      var face = document.createElement('div');
      face.className = 'face';
      face.style.gridTemplateColumns = 'repeat(' + size + ', 1fr)';
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
    document.addEventListener('pointerup', function () { painting = false; });
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
    repairNote = null;
    result = null;
    [previewFront, previewBack, solveFront, solveBack].forEach(function (v) { v.setSize(size); });
    buildNet();
    refreshNet();
    refreshViews();
    updateHoldLabels();
    document.querySelectorAll('.size-option').forEach(function (b) {
      b.classList.toggle('is-active', +b.dataset.size === size);
    });
    /*
     * The two solution styles are a 3x3 thing. A 2x2 is small enough that the
     * shortest answer is the only sensible one, and a 4x4 is big enough that
     * reduction is the only practical method — so on those the choice is not a
     * choice, and leaving it up said "About 20 moves" on a cube that takes 55.
     */
    $('modes').hidden = size !== 3;
    $('size-note').textContent = size === 3
      ? 'Scan or type it in. Two solution styles: short, or one you could learn.'
      : size === 2
        ? 'Always the shortest solution that exists — never more than 11 moves.'
        : 'About 45 turns, found by search. Scanning, the map and solving all work.';
    showView('setup');
    setMessage('');
    save();
  }

  /**
   * Say how to hold the cube, in whatever terms actually apply.
   *
   * Three different situations, and the old wording only covered one:
   *
   *   - Just scanned. The cube has been turned to match the last photo, so it
   *     is already being held right and there is nothing to look for. Say that,
   *     because hunting for a colour to line up was the most tedious part of
   *     using this.
   *   - Typed in, 3x3. The centres name the faces, so name them.
   *   - Typed in, 2x2 or 4x4. Nothing names a face — the middle pieces move —
   *     so the map is the only reference there is, and it says so.
   */
  function updateHoldLabels() {
    var setup = $('hold-note'), solving = $('orientation-note-text');
    if (orientedFromScan) {
      var text = 'Hold the cube exactly as you did for your last photo — that face is the ' +
        'one facing you here. Nothing to line up.';
      setup.textContent = text;
      solving.textContent = text;
      return;
    }
    if (size !== 3) {
      var mapText = 'A ' + size + '×' + size + ' has no fixed centre to go by, so the map is the ' +
        'reference: hold the cube so it matches the Front panel, with Up on top.';
      setup.textContent = mapText;
      solving.textContent = mapText;
      return;
    }
    var top = colorState[Cube.CENTERS[0]], front = colorState[Cube.CENTERS[2]];
    var topName = top < 0 ? 'the top' : COLOR_NAMES[top];
    var frontName = front < 0 ? 'the front' : COLOR_NAMES[front];
    setup.textContent = 'Hold your cube with the ' + topName + ' centre on top and the ' +
      frontName + ' centre facing you, then fill in every sticker to match.';
    solving.textContent = 'Keep ' + topName + ' on top and ' + frontName + ' facing you for every move.';
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

  function setMessage(text, kind) {
    var el = $('setup-message');
    el.textContent = text || '';
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  // ---- plain-english move descriptions -----------------------------------

  var MOVE_TEXT = {
    'U': ['Top layer', 'Spin the top layer so the front row slides to your LEFT.'],
    "U'": ['Top layer', 'Spin the top layer so the front row slides to your RIGHT.'],
    'U2': ['Top layer', 'Spin the top layer half way around (either direction).'],
    'D': ['Bottom layer', 'Spin the bottom layer so the front row slides to your RIGHT.'],
    "D'": ['Bottom layer', 'Spin the bottom layer so the front row slides to your LEFT.'],
    'D2': ['Bottom layer', 'Spin the bottom layer half way around (either direction).'],
    'R': ['Right face', 'Turn the right face so its front edge lifts UP toward the top.'],
    "R'": ['Right face', 'Turn the right face so its front edge drops DOWN toward the bottom.'],
    'R2': ['Right face', 'Turn the right face half way around (either direction).'],
    'L': ['Left face', 'Turn the left face so its front edge drops DOWN toward the bottom.'],
    "L'": ['Left face', 'Turn the left face so its front edge lifts UP toward the top.'],
    'L2': ['Left face', 'Turn the left face half way around (either direction).'],
    'F': ['Front face', 'Turn the whole front face clockwise — its top row slides RIGHT.'],
    "F'": ['Front face', 'Turn the whole front face counter-clockwise — its top row slides LEFT.'],
    'F2': ['Front face', 'Turn the front face half way around (either direction).'],
    'B': ['Back face', 'Turn the back face so its top row slides to your LEFT.'],
    "B'": ['Back face', 'Turn the back face so its top row slides to your RIGHT.'],
    'B2': ['Back face', 'Turn the back face half way around (either direction).'],

    // A 4x4 also turns the layers just under each face. These never came up on
    // a 3x3, so they had no entry — and describe() read [0] off the missing one
    // and threw, inside the render loop's callback, which killed the loop for
    // good. One cube froze mid-solution while the other carried on moving.
    'u': ['Second layer from the top', 'Turn the slice just UNDER the top layer the same way you would turn the top: the front of it slides to your LEFT. The top layer itself does not move.'],
    "u'": ['Second layer from the top', 'Turn the slice just under the top layer so its front slides to your RIGHT. The top layer itself does not move.'],
    'u2': ['Second layer from the top', 'Turn the slice just under the top layer half way around. The top layer itself does not move.'],
    'd': ['Second layer from the bottom', 'Turn the slice just ABOVE the bottom layer the way you would turn the bottom: its front slides to your RIGHT. The bottom layer itself does not move.'],
    "d'": ['Second layer from the bottom', 'Turn the slice just above the bottom layer so its front slides to your LEFT. The bottom layer itself does not move.'],
    'd2': ['Second layer from the bottom', 'Turn the slice just above the bottom layer half way around. The bottom layer itself does not move.'],
    'r': ['Second layer from the right', 'Turn the slice just INSIDE the right face the same way you would turn that face: its front edge lifts UP. The right face itself does not move.'],
    "r'": ['Second layer from the right', 'Turn the slice just inside the right face so its front edge drops DOWN. The right face itself does not move.'],
    'r2': ['Second layer from the right', 'Turn the slice just inside the right face half way around. The right face itself does not move.'],
    'l': ['Second layer from the left', 'Turn the slice just INSIDE the left face the same way you would turn that face: its front edge drops DOWN. The left face itself does not move.'],
    "l'": ['Second layer from the left', 'Turn the slice just inside the left face so its front edge lifts UP. The left face itself does not move.'],
    'l2': ['Second layer from the left', 'Turn the slice just inside the left face half way around. The left face itself does not move.'],
    'f': ['Second layer from the front', 'Turn the slice just BEHIND the front face the same way you would turn that face: its top row slides RIGHT. The front face itself does not move.'],
    "f'": ['Second layer from the front', 'Turn the slice just behind the front face so its top row slides LEFT. The front face itself does not move.'],
    'f2': ['Second layer from the front', 'Turn the slice just behind the front face half way around. The front face itself does not move.'],
    'b': ['Second layer from the back', 'Turn the slice just IN FRONT of the back face the way you would turn that face: its top row slides LEFT. The back face itself does not move.'],
    "b'": ['Second layer from the back', 'Turn the slice just in front of the back face so its top row slides RIGHT. The back face itself does not move.'],
    'b2': ['Second layer from the back', 'Turn the slice just in front of the back face half way around. The back face itself does not move.']
  };

  function faceColorName(letter) {
    var faceIndex = Cube.FACE_INDEX[letter];
    var c = colorStates.length ? colorStates[0][Cube.CENTERS[faceIndex]] : colorState[Cube.CENTERS[faceIndex]];
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
  function describe(move) {
    var text = MOVE_TEXT[move];
    if (!text) text = [move, 'Turn the layer this move names.'];
    // Only a 3x3 has a fixed centre to name a face by, and only an outer face
    // turn names one at all.
    var name = (size === 3 && move[0] === move[0].toUpperCase()) ? faceColorName(move[0]) : '';
    return {
      title: text[0] + (name ? ' (' + name + ')' : ''),
      detail: text[1],
      turn: move.length > 1 && move[1] === '2' ? 'half turn · 180°' : 'quarter turn · 90°'
    };
  }

  // ---- solving -----------------------------------------------------------

  function currentMode() {
    var picked = document.querySelector('input[name="mode"]:checked');
    return picked ? picked.value : 'fast';
  }

  /** Chop a flat move list into bite-sized groups so the player still has structure. */
  function chunkGroups(moves) {
    var groups = [], per = 5;
    for (var i = 0; i < moves.length; i += per) {
      var count = Math.min(per, moves.length - i);
      groups.push({
        id: 'chunk' + i,
        title: 'Moves ' + (i + 1) + '–' + (i + count),
        blurb: 'Shortest-route solution: the cube stays a mess until the last few turns. Just follow the arrow.',
        start: i, count: count
      });
    }
    return groups;
  }

  function fastResult(moves) {
    return {
      moves: moves,
      steps: moves.map(function (m) { return { move: m, stage: 'fast' }; }),
      groups: chunkGroups(moves)
    };
  }

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
    if (size !== 3) {
      setMessage('Solving a ' + size + '×' + size + ' is still being built. The map and the 3D view ' +
        'work — scan one and have a look — but there is no solution to follow yet.', 'error');
      return;
    }
    // A cube that is nearly right is usually one sticker away from being right,
    // and "is this a real cube?" is a tight enough test to say which sticker.
    repairNote = null;
    var mend = typeof CubeRepair !== 'undefined' ? CubeRepair.repair(colorState) : null;
    if (mend && mend.unique) {
      colorState.set(mend.colors);
      unsure = {};
      mend.fixes[0].changes.forEach(function (c) { unsure[c.index] = true; });
      refreshNet(); refreshViews(); save();
      // Carried through to the solve screen: the setup message would be wiped
      // by the view change, and a silent correction is the one thing this must
      // never be.
      repairNote = 'That was not quite a real cube, and there was exactly one way to fix it: ' +
        mend.summary + '. Corrected — go back and change it if that is wrong.';
    } else if (mend && !mend.unique) {
      unsure = {};
      mend.changed.forEach(function (group) { group.forEach(function (i) { unsure[i] = true; }); });
      refreshNet();
      setMessage('Almost — one sticker is wrong, but there are ' + mend.fixes.length +
        ' ways to fix it and I will not guess. The possibilities are outlined below; ' +
        'correct the one you know is wrong.', 'error');
      return;
    }

    var solverState = Cube.toSolverSpace(colorState);
    if (!solverState) {
      setMessage('Every sticker needs a color, and the six centers must all be different. Fill in the gaps and try again.', 'error');
      return;
    }
    var check = Cube.validate(solverState);
    if (!check.ok) { setMessage(check.message, 'error'); return; }

    var solved = true;
    for (var i = 0; i < solverState.length; i++) if (solverState[i] !== Cube.SOLVED[i]) { solved = false; break; }
    if (solved) { setMessage('That cube is already solved. Nothing to do!', 'ok'); return; }

    if (currentMode() === 'fast') {
      setMessage('Searching for a short solution…');
      ensureFastSolver(function () {
        setTimeout(function () {
          try {
            finishSolve(fastResult(Kociemba.solveMoves(solverState)));
          } catch (err) {
            setMessage('Something went wrong solving that state: ' + err.message, 'error');
          }
        }, 20);
      });
      return;
    }

    try {
      finishSolve(Solver.solve(solverState));
    } catch (err) {
      setMessage('Something went wrong solving that state: ' + err.message, 'error');
    }
  }

  /**
   * Solve a cube with no fixed centres — a 2x2 or a 4x4.
   *
   * Both work out for themselves which colour belongs on which face, because
   * neither has a centre sticker to say, so the only thing to check here is
   * that no sticker has been left blank. Anything past that they explain
   * themselves, and both refuse rather than guess.
   *
   * Neither offers a "fewest moves" choice, but for opposite reasons: a 2x2 is
   * small enough that the answer is always the shortest one there is, and a 4x4
   * is big enough that reduction is the only practical method.
   */
  function solveWith(solver, working) {
    for (var i = 0; i < colorState.length; i++) {
      if (colorState[i] < 0) {
        setMessage('Every sticker needs a colour before solving. Fill in the gaps and try again.', 'error');
        return;
      }
    }
    repairNote = null;
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
        setMessage('Something went wrong solving that cube: ' + err.message, 'error');
        return;
      }
      $('prep-fill').style.width = '100%';
      $('prep').hidden = true;
      if (!out.ok) { setMessage(out.message, 'error'); return; }
      setMessage('');
      finishSolve(out);
    }, 30);
  }

  function finishSolve(solution) {
    result = solution;
    // A 4x4 solution brings its own states with it, worked out on the same
    // model that produced the moves — so the two can never drift apart.
    if (solution.states) {
      colorStates = solution.states.map(function (s) { return Int8Array.from(s); });
    } else {
      colorStates = [Int8Array.from(colorState)];
      for (var m = 0; m < result.moves.length; m++) {
        colorStates.push(Cube.permute(colorStates[m], Cube.MOVE_PERMS[result.moves[m]], new Int8Array(stickerCount())));
      }
    }

    setMessage('');
    $('repair-note').textContent = repairNote || '';
    $('repair-note').hidden = !repairNote;
    index = 0;
    buildStageList();
    buildNotationList();
    showView('solve');
    applyIndex();
  }

  function showView(which) {
    $('view-setup').hidden = which !== 'setup';
    $('view-solve').hidden = which !== 'solve';
    document.querySelectorAll('.crumb').forEach(function (c) {
      c.classList.toggle('is-active', c.dataset.crumb === which);
    });
    if (which === 'solve') { solveFront.dirty = true; solveBack.dirty = true; }
    else { previewFront.dirty = true; previewBack.dirty = true; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- player ------------------------------------------------------------

  function currentGroup() {
    if (!result) return null;
    var g = result.groups[0];
    for (var i = 0; i < result.groups.length; i++) {
      if (index >= result.groups[i].start) g = result.groups[i];
    }
    return g;
  }

  function applyIndex() {
    var total = result.steps.length;
    var atEnd = index >= total;
    solveFront.setState(colorStates[index]);
    solveBack.setState(colorStates[index]);

    var upcoming = atEnd ? null : result.steps[index].move;
    solveFront.showArrowFor = upcoming;
    solveBack.showArrowFor = upcoming;
    solveFront.dirty = solveBack.dirty = true;

    var group = currentGroup();
    $('stage-name').textContent = atEnd ? 'Finished' : group.title;
    $('stage-blurb').textContent = atEnd ? '' : group.blurb;

    if (atEnd) {
      $('move-title').textContent = 'Solved!';
      $('move-detail').textContent = 'Every face should now be a single color. Nice work.';
      $('move-notation').textContent = '—';
      $('move-turn').textContent = String(total) + ' moves total';
    } else {
      var d = describe(upcoming);
      $('move-title').textContent = d.title;
      $('move-detail').textContent = d.detail;
      $('move-notation').textContent = upcoming;
      $('move-turn').textContent = d.turn;
    }

    $('move-counter').textContent = 'Move ' + Math.min(index + 1, total) + ' of ' + total;
    var groupIdx = result.groups.indexOf(group) + 1;
    $('stage-counter').textContent = atEnd ? 'all stages complete' : 'stage ' + groupIdx + ' of ' + result.groups.length;
    $('progress-fill').style.width = (100 * index / total).toFixed(1) + '%';

    updateStageList();
    updateNotationList();
    $('btn-play').textContent = playing ? '❚❚ Pause' : (atEnd ? '▶ Play' : '▶ Play');
  }

  function speed() { return SPEEDS[+$('speed').value] || SPEEDS[2]; }

  function stepForward(animate) {
    if (busy || !result || index >= result.steps.length) return;
    var move = result.steps[index].move;
    if (!animate) { index++; applyIndex(); return; }
    busy = true;
    solveFront.showArrowFor = null;
    solveBack.showArrowFor = null;
    solveBack.playMove(move, speed().move, null);
    solveFront.playMove(move, speed().move, function () {
      index++;
      busy = false;
      applyIndex();
      if (playing) {
        if (index >= result.steps.length) { setPlaying(false); }
        else playTimer = setTimeout(function () { stepForward(true); }, speed().gap);
      }
    });
  }

  function stepBack() {
    if (busy || !result || index === 0) return;
    setPlaying(false);
    index--;
    applyIndex();
  }

  function setPlaying(on) {
    playing = on;
    clearTimeout(playTimer);
    $('btn-play').textContent = on ? '❚❚ Pause' : '▶ Play';
    if (on) stepForward(true);
  }

  function replayCurrent() {
    if (busy || !result || index === 0) return;
    setPlaying(false);
    index--;
    applyIndex();
    stepForward(true);
  }

  function jumpTo(target) {
    if (!result) return;
    setPlaying(false);
    if (busy) { solveFront.stopAnimation(); solveBack.stopAnimation(); busy = false; }
    index = Math.max(0, Math.min(result.steps.length, target));
    applyIndex();
  }

  // ---- stage list + notation --------------------------------------------

  function buildStageList() {
    var wrap = $('stage-list');
    wrap.innerHTML = '';
    result.groups.forEach(function (g, i) {
      var row = document.createElement('div');
      row.className = 'stage-row';
      row.dataset.start = g.start;
      row.innerHTML = '<span class="stage-dot">✓</span>' +
        '<span class="stage-title"></span>' +
        '<span class="stage-count">' + g.count + ' move' + (g.count === 1 ? '' : 's') + '</span>';
      row.querySelector('.stage-title').textContent = (i + 1) + '. ' + g.title;
      row.addEventListener('click', function () { jumpTo(g.start); });
      wrap.appendChild(row);
    });
  }

  function updateStageList() {
    var rows = $('stage-list').children;
    var group = currentGroup();
    var currentIdx = result.groups.indexOf(group);
    var atEnd = index >= result.steps.length;
    for (var i = 0; i < rows.length; i++) {
      var g = result.groups[i];
      rows[i].classList.toggle('is-current', !atEnd && i === currentIdx);
      rows[i].classList.toggle('is-done', index >= g.start + g.count);
    }
  }

  function buildNotationList() {
    var wrap = $('notation-list');
    wrap.innerHTML = '';
    result.steps.forEach(function (s, i) {
      var span = document.createElement('span');
      span.textContent = s.move;
      span.dataset.i = i;
      span.style.cursor = 'pointer';
      span.addEventListener('click', function () { jumpTo(i); });
      wrap.appendChild(span);
      wrap.appendChild(document.createTextNode(' '));
    });
  }

  function updateNotationList() {
    var spans = $('notation-list').children;
    for (var i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('now', +spans[i].dataset.i === index);
    }
  }

  // ---- events ------------------------------------------------------------

  function wire() {
    $('btn-solve').addEventListener('click', doSolve);
    $('btn-example').addEventListener('click', function () {
      colorState.set(solvedColorState());
      var scramble = Cube.randomScramble(25);
      var next = Cube.applySeq(colorState, scramble);
      colorState.set(next);
      refreshNet(); refreshViews(); save();
      setMessage('Scrambled with: ' + scramble.join(' '), 'ok');
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
        ? 'Cleared — the centers stay put because they never move on a 3x3.'
        : 'Cleared. A 4x4 has no fixed centers, so everything went.');
    });
    $('edit-centers').addEventListener('change', function (e) {
      $('net').classList.toggle('centers-unlocked', e.target.checked);
    });
    document.querySelectorAll('.size-option').forEach(function (button) {
      button.addEventListener('click', function () { setSize(+button.dataset.size); });
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        document.querySelectorAll('.mode').forEach(function (label) {
          label.classList.toggle('is-active', label.contains(radio) && radio.checked);
        });
      });
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
            setMessage(result.note || 'Those photos did not add up to a real cube. Fix the wrong ' +
              'stickers on the map, or scan again.', 'error');
          } else if (result.ambiguous) {
            setMessage('Scanned, but those photos fit together in more than one way — with no fixed ' +
              'centre to go by, that can happen. Check the map against your cube before solving.', 'error');
          } else {
            setMessage('Scanned, and it fits together as a real cube. Keep holding it exactly as you ' +
              'did for the last photo — the moves are written for that.', 'ok');
          }
          if (result.note) console.info('scan note:', result.note);
        }
      });
      scanner.open();
    });

    $('btn-next').addEventListener('click', function () { setPlaying(false); stepForward(true); });
    $('btn-prev').addEventListener('click', stepBack);
    $('btn-play').addEventListener('click', function () {
      if (index >= result.steps.length) { jumpTo(0); }
      setPlaying(!playing);
    });
    $('btn-replay').addEventListener('click', replayCurrent);
    $('btn-restart').addEventListener('click', function () { jumpTo(0); });
    $('btn-back').addEventListener('click', function () { setPlaying(false); showView('setup'); });
    document.querySelectorAll('.crumb').forEach(function (c) {
      c.addEventListener('click', function () {
        if (c.dataset.crumb === 'setup') { setPlaying(false); showView('setup'); }
        else if (result) showView('solve');
      });
    });

    document.addEventListener('keydown', function (e) {
      if ($('view-solve').hidden) return;
      if (e.key === 'ArrowRight') { setPlaying(false); stepForward(true); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stepBack(); e.preventDefault(); }
      else if (e.key === ' ') { setPlaying(!playing); e.preventDefault(); }
    });
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
