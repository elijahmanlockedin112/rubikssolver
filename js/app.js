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

  var colorState = solvedColorState();
  var selectedColor = 0;
  var painting = false;
  var unsure = {};   // facelets the two scan readers disagreed about

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
    var s = new Int8Array(54);
    for (var i = 0; i < 54; i++) s[i] = DEFAULT_FACE_COLOR[(i / 9) | 0];
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
      for (var i = 0; i < 9; i++) {
        var idx = slot.face * 9 + i;
        var cell = document.createElement('button');
        cell.className = 'sticker' + (i === 4 ? ' is-center' : '');
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

  function isCenter(idx) { return idx % 9 === 4; }

  function paint(idx) {
    if (isCenter(idx) && !$('edit-centers').checked) return;
    colorState[idx] = selectedColor;
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

  function updateHoldLabels() {
    var top = colorState[Cube.CENTERS[0]], front = colorState[Cube.CENTERS[2]];
    var topName = top < 0 ? 'the top' : COLOR_NAMES[top];
    var frontName = front < 0 ? 'the front' : COLOR_NAMES[front];
    $('hold-top').textContent = topName;
    $('hold-front').textContent = frontName;
    $('solve-top').textContent = topName;
    $('solve-front').textContent = frontName;
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
      if (Array.isArray(arr) && arr.length === 54) {
        for (var i = 0; i < 54; i++) colorState[i] = arr[i];
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
    'B2': ['Back face', 'Turn the back face half way around (either direction).']
  };

  function faceColorName(letter) {
    var faceIndex = Cube.FACE_INDEX[letter];
    var c = colorStates.length ? colorStates[0][Cube.CENTERS[faceIndex]] : colorState[Cube.CENTERS[faceIndex]];
    return c < 0 ? '' : COLOR_NAMES[c];
  }

  function describe(move) {
    var text = MOVE_TEXT[move];
    var name = faceColorName(move[0]);
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
    var solverState = Cube.toSolverSpace(colorState);
    if (!solverState) {
      setMessage('Every sticker needs a color, and the six centers must all be different. Fill in the gaps and try again.', 'error');
      return;
    }
    var check = Cube.validate(solverState);
    if (!check.ok) { setMessage(check.message, 'error'); return; }

    var solved = true;
    for (var i = 0; i < 54; i++) if (solverState[i] !== Cube.SOLVED[i]) { solved = false; break; }
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

  function finishSolve(solution) {
    result = solution;
    colorStates = [Int8Array.from(colorState)];
    for (var m = 0; m < result.moves.length; m++) {
      colorStates.push(Cube.permute(colorStates[m], Cube.MOVE_PERMS[result.moves[m]], new Int8Array(54)));
    }

    setMessage('');
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
      for (var i = 0; i < 54; i++) if (!isCenter(i)) colorState[i] = -1;
      refreshNet(); refreshViews(); save();
      setMessage('Cleared — the centers stay put because they never move on a real cube.');
    });
    $('edit-centers').addEventListener('change', function (e) {
      $('net').classList.toggle('centers-unlocked', e.target.checked);
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
        onDone: function (result) {
          colorState.set(result.colors);
          unsure = {};
          (result.unsure || []).forEach(function (i) { unsure[i] = true; });
          refreshNet(); refreshViews(); updateHoldLabels(); save();

          if (result.source === 'failed') {
            setMessage(result.note || 'Those photos did not add up to a real cube. Fix the wrong ' +
              'stickers on the map, or scan again.', 'error');
          } else if (result.ambiguous) {
            setMessage('Scanned. Those photos could be fitted together in more than one way, so ' +
              'give the map a proper look before solving.', 'error');
          } else if (result.source === 'gemini') {
            setMessage('The on-device reader could not make sense of the photos, so Gemini read ' +
              'them instead. Check the map, then solve.', 'ok');
          } else {
            setMessage('Scanned on this device. It fits together as a real cube — ' +
              'glance over the map, then solve.', 'ok');
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
