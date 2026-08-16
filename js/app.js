/*
 * app.js — wiring: the three screens, the guided sticker editor, and the player.
 *
 * The shape of the app is: scan, then follow the moves. Scanning is the front
 * door and everything else is a fallback, so the home screen is a cube, a size,
 * and one button. A finished scan does not stop to ask anything — it solves and
 * goes straight to the first move.
 *
 * Both ways in are guided round the cube by a grey cube on screen that turns
 * the way your hands should, and they take different routes for a reason: the
 * scanner's phone is above the cube, so the face it reads is the top one and
 * the route is rolls, while the map screen has no phone and the face being
 * painted is the one toward you. Both routes and the bookkeeping under them
 * live in guide.js.
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
  var MODE_KEY = 'rubiks-cube-coach.mode';

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

  var plan = null;        // { moves, steps, states } after expanding half turns
  var index = 0;
  var busy = false;
  var celebrated = false;
  var stopConfetti = null;

  /*
   * Which of the two roads out of the scanner this is.
   *
   *   fast    — the shortest answer a search can find, none of whose moves
   *             mean anything on their own
   *   academy — the layer-by-layer method, eight named stages, on your cube
   *
   * They are different solvers rather than different presentations, which is
   * why this is a mode and not a checkbox: the shortest solution cannot be
   * taught, because the moves in it are not reasons, and the beginner method
   * cannot be raced, because it is four times longer.
   */
  var mode = 'fast';
  /*
   * What each road costs, for the cube that is actually selected.
   *
   * This said "about 20 turns" whatever size was picked, which is true of a
   * 3x3 and nonsense for the other two — a 2x2 is never more than eleven and a
   * 4x4 runs to fifty-odd. A number on screen that does not move when the
   * thing it describes changes is worse than no number at all.
   */
  var MODE_NOTE = {
    fast: {
      2: 'The shortest solution that exists — never more than 11 turns.',
      3: 'The shortest way home — about 20 turns, found by search.',
      4: 'About 55 turns, found by a three-phase search.'
    },
    academy: {
      2: 'Academy teaches the 3×3 method — a 2×2 gets the direct solution instead.',
      3: 'Eight stages, taught on your own scramble. Longer, and you keep it.',
      4: 'Academy teaches the 3×3 method — a 4×4 gets the direct solution instead.'
    }
  };
  var introDone = {};     // stages whose lesson card has been read
  /*
   * The lesson, reopened part way through a stage.
   *
   * The card appeared once on the way in and then there was no way back to it
   * short of jumping to the start of the stage, which loses your place. "What
   * am I doing again?" is the most ordinary thing to want half way through
   * twenty-five moves.
   */
  var lessonOpen = false;
  var wakeLock = null;

  function solvedColorState() {
    var s = new Int8Array(stickerCount());
    for (var i = 0; i < s.length; i++) s[i] = DEFAULT_FACE_COLOR[(i / perFace()) | 0];
    return s;
  }

  function $(id) { return document.getElementById(id); }

  // ---- views -------------------------------------------------------------

  /*
   * Square on, from a little above, and fixed.
   *
   * Off a corner shows three faces at once, which is more of the cube but a
   * harder picture to match against the thing in your hands: every face is a
   * skewed parallelogram and the layer about to turn runs diagonally away from
   * you. Square on, the front face is a square and a turn reads as up, down,
   * left or right — the same words the instructions use.
   *
   * The height is the part that had to change. A scan is taken with the phone
   * held over the cube, so the face someone has just been staring at is the
   * TOP one, and it is what the finished cube is now turned to match (see
   * orientToPhoto). Drawing that reference face as a shallow 30-degree band
   * above the front made the one face they could identify the hardest one to
   * see. At 42 degrees the top is a proper face and the front is still a
   * square-ish one, which is roughly the angle you are looking from anyway
   * with a phone in one hand and a cube on the table.
   *
   * And it does not move. Being able to drag the cube around sounds like a
   * feature and is not: one accidental swipe and the picture no longer matches
   * the cube in your hand, with nothing to say it has happened and no way back
   * to square except by feel.
   */
  var FRONT_VIEW = { yaw: 0, pitch: 42 };
  var BACK_VIEW = { yaw: 180, pitch: -42 };

  var previewFront = new CubeView($('preview-front'), {
    colors: PALETTE, state: colorState, draggable: false,
    yaw: FRONT_VIEW.yaw, pitch: FRONT_VIEW.pitch
  });
  var previewBack = new CubeView($('preview-back'), {
    colors: PALETTE, state: colorState, draggable: false,
    yaw: BACK_VIEW.yaw, pitch: BACK_VIEW.pitch
  });
  var solveFront = new CubeView($('solve-front-canvas'), {
    colors: PALETTE, state: colorState, draggable: false,
    yaw: FRONT_VIEW.yaw, pitch: FRONT_VIEW.pitch
  });

  // The grey cube on the map screen: the same route the scanner walks, so a
  // cube typed in by hand is turned the same way as one that is photographed.
  var editGuide = new CubeGuide($('edit-guide-canvas'), {
    // no phone here: the face you paint is the one toward you, so this is the
    // turn-it-in-your-hands route rather than the scanner's overhead one
    route: 'hand',
    size: size, colors: PALETTE, state: colorState, startText: ''
  });

  function refreshViews() {
    previewFront.setState(colorState);
    previewBack.setState(colorState);
    if (editGuide.view) editGuide.view.dirty = true;
  }

  // ---- palette + the one face being painted ------------------------------

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

  /*
   * One face at a time, and the face is the one the guide says you are looking
   * at — which after the last tip is not drawn the way a flat map would draw
   * it. `faceCells()` hands back the facelets in the order they appear to
   * someone holding the cube, so the grid is built straight from that and
   * there is no orientation to get wrong here.
   */
  function buildFace() {
    var net = $('net');
    net.innerHTML = '';
    net.style.setProperty('--cube-size', size);

    var face = document.createElement('div');
    face.className = 'face';
    editGuide.faceCells().forEach(function (world) {
      var cell = document.createElement('button');
      cell.className = 'sticker' + (isCenter(world) ? ' is-center' : '');
      cell.dataset.index = world;
      cell.type = 'button';
      cell.addEventListener('pointerdown', function (e) {
        painting = true;
        paint(+e.currentTarget.dataset.index);
      });
      cell.addEventListener('pointerenter', function (e) {
        if (painting) paint(+e.currentTarget.dataset.index);
      });
      face.appendChild(cell);
    });
    net.appendChild(face);
    fitNet();
    refreshNet();
  }

  /*
   * Size the face to the box it has, rather than hoping.
   *
   * A phone in landscape has 343px of height in total, and a 4x4 face has to
   * fit whatever is left after the palette and the buttons. Measuring is the
   * only way to be sure the whole thing is on screen without the page
   * scrolling, at every cube size in both orientations.
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
    net.style.setProperty('--net-face', Math.max(60, Math.floor(Math.min(w, h))) + 'px');
  }

  // A 3x3's centre sticker is bolted to the core and never moves, so the editor
  // protects it. A 4x4 has no such sticker — its four middle pieces are pieces
  // like any other — so nothing is locked.
  function isCenter(idx) { return size === 3 && idx % 9 === 4; }

  function paint(idx) {
    if (isCenter(idx)) return;
    colorState[idx] = selectedColor;
    orientedFromScan = false;   // edited by hand, so no longer "just as photographed"
    delete unsure[idx];   // the user has now had their say on this one
    refreshNet();
    refreshViews();
    save();
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
    [previewFront, previewBack, solveFront].forEach(function (v) { v.setSize(size); });
    editGuide.setSize(size);
    editGuide.setState(colorState);
    refreshViews();
    updateHoldText();
    document.querySelectorAll('.size-option').forEach(function (b) {
      b.classList.toggle('is-active', +b.dataset.size === size);
    });
    setMode(mode);            // what each road costs depends on the size
    setMessage('');
    save();
  }

  /**
   * How to hold the cube for the very first face, in whatever terms apply.
   *
   *   - Just scanned. The cube has been turned to match the last photo, so it
   *     is already being held right and there is nothing to look for.
   *   - A 3x3. The centres name the faces, so name them — and the centre
   *     sticker sitting there already is the confirmation you are on the right
   *     face before you paint a single square.
   *   - A 2x2 or 4x4. Nothing names a face, so any face will do to start.
   */
  function updateHoldText() {
    if (orientedFromScan) {
      editGuide.startText = 'Hold the cube exactly as you did for your last photo — that face is the ' +
        'one on top here, because that is where the camera was.';
    } else if (size !== 3) {
      editGuide.startText = 'Hold the cube upright with any face toward you — a ' + size + '×' + size +
        ' has no fixed centre, so it is the order that matters, not which face you start on.';
    } else {
      var top = colorState[Cube.CENTERS[0]], front = colorState[Cube.CENTERS[2]];
      var topName = top < 0 ? 'the top' : COLOR_NAMES[top];
      var frontName = front < 0 ? 'the front' : COLOR_NAMES[front];
      editGuide.startText = 'Hold your cube with the ' + topName + ' centre on top and the ' +
        frontName + ' centre facing you.';
    }
    if ($('view-edit').hidden === false) updateEditChrome();
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

  /**
   * Fetch a script that is not in the page yet.
   *
   * tpr.js and solver4.js are 98KB of 4x4 solver between them, and a 3x3 — the
   * overwhelming majority of what gets scanned — never touches a byte of it.
   * Parsing that on every visit is a cost paid by everyone for a case most
   * people do not have, so it is fetched the first time a 4x4 is solved
   * instead. Everything else about a 4x4, including scanning one, works
   * without it.
   */
  var loaded = {};
  function loadScript(src, next, fail) {
    if (loaded[src]) { next(); return; }
    var el = document.createElement('script');
    el.src = src;
    el.onload = function () { loaded[src] = true; next(); };
    el.onerror = function () { fail(); };
    document.head.appendChild(el);
  }

  function withBigSolver(next) {
    if (typeof Solver4 !== 'undefined') { next(); return; }
    setMessage('Fetching the 4×4 solver…');
    var fail = function () {
      failTo('The 4×4 solver could not be fetched. Check the connection and try again — ' +
        'everything else here works offline, but that part is only downloaded when it is needed.');
    };
    loadScript('js/tpr.js', function () { loadScript('js/solver4.js', next, fail); }, fail);
  }

  function doSolve() {
    /*
     * Academy is a 3x3 method. There is no beginner method for a 4x4 that is
     * not "reduce it to a 3x3 first", and nothing worth the name for a 2x2, so
     * rather than pretend, those get the direct answer and are told why on the
     * way past instead of finding out by being taught nothing.
     */
    if (mode === 'academy' && size !== 3) {
      note = 'Academy teaches the 3×3 method, so a ' + size + '×' + size + ' gets the direct ' +
        'solution instead. Switch to a 3×3 above to be taught it.';
    }
    if (size === 2) { solveWith(Solver2, 'Working out the shortest solution…'); return; }
    if (size === 4) { withBigSolver(function () { solveWith(Solver4, 'Working out a solution…'); }); return; }

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
      failTo('Almost — one sticker is wrong, but there are ' + mend.fixes.length +
        ' ways to fix it and I will not guess. The possibilities are outlined on the map; ' +
        'step through the faces and correct the one you know is wrong.');
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

    /*
     * The teaching solver runs in a couple of milliseconds — it is seven small
     * searches, not one big one — so there is nothing to wait for and no
     * table to build. It is the fast solver that needs the panel.
     */
    if (mode === 'academy') {
      /*
       * Turn it white-side-down first, then solve that.
       *
       * The moves come out relative to the cube as it will be held once the
       * user has made the turn, which is why the turn is the first thing they
       * are asked to do and why the cube on screen shows the result of it.
       */
      var held = orientWhiteDown(colorState);
      var taught = held ? held.state : colorState;
      try {
        var lesson = Solver.solve(Cube.toSolverSpace(taught));
        lesson.start = taught;
        lesson.orientation = held;
        finishSolve(lesson, true);
      } catch (err) {
        failTo('Something went wrong working out how to teach that cube: ' + err.message);
      }
      return;
    }

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
    showEditor(false);
    refreshNet();
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

  /*
   * The beginner method is taught with white on the bottom. Always.
   *
   * Every tutorial, every video and every stage name here — white cross, white
   * corners, yellow cross, yellow face — assumes it, and a scan does not care:
   * it reads the cube however it was held for the last photo, so white lands
   * wherever it lands. Solving from there produces a "bottom cross" in
   * whatever colour happened to be underneath, and then the lesson says white
   * while the cube says orange, which is the single most confusing thing this
   * mode could do.
   *
   * So Academy turns the cube first. The whole cube, not a layer — the centres
   * move with it and nothing is solved or unsolved by it — and the user is
   * shown the turn and asked to make it before anything else happens. What
   * comes back is the cube as it will be once they have.
   */
  var WHITE = 0;   // index into PALETTE / COLOR_NAMES

  var TURN_TO_WHITE_DOWN = {
    // face white is on now -> how to get it underneath, in words and in turns
    0: { axis: 'x', times: 2, text: 'Turn the whole cube upside down, so the white centre ends up on the bottom and the yellow centre is on top.' },
    2: { axis: 'x', times: 1, text: 'Tip the whole cube forwards — the face that is toward you goes underneath — so white ends up on the bottom and yellow on top.' },
    5: { axis: 'x', times: 3, text: 'Tip the whole cube backwards — the face away from you comes up over the top — so white ends up on the bottom and yellow on top.' },
    4: { axis: 'z', times: 1, text: 'Roll the whole cube to your left, so the left-hand face goes underneath: white ends up on the bottom and yellow on top.' },
    1: { axis: 'z', times: 3, text: 'Roll the whole cube to your right, so the right-hand face goes underneath: white ends up on the bottom and yellow on top.' }
  };

  /**
   * The cube turned so white is down, and the words for turning yours to match.
   * Returns null if it is already there — which still gets said, because
   * "and it stays that way" is part of the lesson.
   */
  function orientWhiteDown(state) {
    var on = -1;
    for (var f = 0; f < 6; f++) if (state[Cube.CENTERS[f]] === WHITE) { on = f; break; }
    if (on < 0) return null;                      // no white centre: an odd cube, leave it alone
    if (on === 3) {
      return { state: Int8Array.from(state), moved: false,
        text: 'Your cube already has white on the bottom and yellow on top. Keep it that way: ' +
          'every move from here is described as if you are holding it exactly like this.' };
    }
    var turn = TURN_TO_WHITE_DOWN[on];
    if (!turn) return null;
    var axis = turn.axis === 'x' ? CubeN.AXIS.x : CubeN.AXIS.z;
    var out = Int8Array.from(state);
    for (var t = 0; t < turn.times; t++) {
      out = permuteInto(out, CubeN.wholeRotation(3, axis, 1));
    }
    return { state: out, moved: true, text: turn.text };
  }

  function sameColours(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
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

    /*
     * A solver that brings its own states has to agree with the cube it was
     * handed, and one of them does not.
     *
     * The 2x2 and 4x4 solvers work on the colours directly, so their states
     * are the cube as it will look. The beginner solver works in solver space,
     * where a facelet holds a face number rather than a palette colour — hand
     * those to the renderer and every sticker comes out as whatever colour
     * that face number happens to index, which recolours the entire cube and
     * still looks like a plausible scramble. Academy mode shipped like that
     * for exactly as long as it took to read a piece described as "the blue
     * and green edge" on a cube whose bottom is yellow.
     *
     * So the states are checked against the cube rather than trusted, and
     * worked out from the moves if they disagree — which is what the fast
     * solver, which brings no states at all, has always done.
     */
    if (given && !sameColours(given[0], solution.start || colorState)) given = null;
    // the beginner solver hands back annotated steps; the fast one, bare moves
    var src = solution.steps || solution.moves.map(function (m) { return { move: m }; });
    var out = { moves: [], steps: [], states: [], groups: [] };
    var from = solution.start || colorState;
    out.states.push(Int8Array.from(given ? given[0] : from));

    var reindex = [];   // original step number -> where it starts once expanded
    src.forEach(function (step, i) {
      reindex[i] = out.steps.length;
      var move = step.move;
      var isHalf = move.indexOf('2') > 0;
      /*
       * Where this move sits in the algorithm it belongs to, worked out once
       * here rather than at draw time. Both halves of a split half turn point
       * at the same token — you are on the U2, doing the first half of it —
       * which is the honest answer and keeps the notation strip matching the
       * algorithm as it is written everywhere else.
       */
      var place = (typeof Academy !== 'undefined' && step.alg) ? Academy.placeInAlg(src, i) : null;
      var parts = isHalf ? [move.replace('2', ''), move.replace('2', '')] : [move];
      parts.forEach(function (part, k) {
        var last = out.states[out.states.length - 1];
        var next = (given && k === parts.length - 1)
          ? Int8Array.from(given[i + 1])
          : permuteInto(last, perms[part]);
        out.moves.push(part);
        out.steps.push({
          move: part,
          half: isHalf ? k + 1 : 0,
          stage: step.stage || null,
          // which piece this is for, carried through the split with everything
          // else — dropping it here looked exactly like the solver never
          // having tagged it, which is a hard thing to tell apart from a
          // stage that genuinely has no pieces
          target: step.target || null,
          place: place
        });
        out.states.push(next);
      });
    });
    reindex[src.length] = out.steps.length;

    // stage boundaries have to move with the moves they bracket
    (solution.groups || []).forEach(function (g) {
      out.groups.push({
        id: g.id, title: g.title, blurb: g.blurb,
        start: reindex[g.start],
        count: reindex[g.start + g.count] - reindex[g.start]
      });
    });
    return out;
  }

  function finishSolve(solution, teaching) {
    plan = expandHalfTurns(solution);
    plan.teaching = !!teaching;
    plan.orientation = solution.orientation || null;
    setMessage('');
    $('repair-note').textContent = note || '';
    $('repair-note').hidden = !note;
    index = 0;
    introDone = {};
    lessonOpen = false;
    endCelebration();
    buildStageStrip();
    showView('solve');
    applyIndex();
  }

  function showView(which) {
    $('view-setup').hidden = which !== 'setup';
    $('view-edit').hidden = which !== 'edit';
    $('view-solve').hidden = which !== 'solve';
    document.body.classList.toggle('solving', which === 'solve');
    if (which === 'solve') {
      solveFront.dirty = true;
      keepAwake(true);
    } else {
      previewFront.dirty = true;
      previewBack.dirty = true;
      voice.stop();
      endCelebration();
      keepAwake(false);
    }
    if (which === 'edit') fitNet();
  }

  /*
   * Don't let the screen go out mid-solve.
   *
   * A hundred and twelve moves at a second each, with both hands on a cube and
   * nothing to tap, is exactly the shape of activity a phone reads as "asleep".
   * Waking it up and finding your place again, twice a stage, is the sort of
   * thing that makes people put the cube down.
   *
   * The lock is dropped the moment the solve screen is left, and re-taken if
   * the tab comes back — a wake lock is released automatically when a page is
   * hidden and is not restored on its own. Anything without the API (which was
   * every iPhone before 16.4) simply does without.
   */
  function keepAwake(on) {
    if (!navigator.wakeLock) return;
    if (!on) {
      if (wakeLock) { wakeLock.release().catch(function () { /* already gone */ }); wakeLock = null; }
      return;
    }
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* refused: low battery, or not allowed here */ });
  }

  // ---- the guided map ----------------------------------------------------

  /**
   * Open the map at the first face.
   *
   * `fresh` when this is someone choosing to type a cube in rather than scan
   * one: that starts from a blank cube, because filling in a face that is
   * already full of the wrong colours is worse than filling in an empty one.
   * Every other way in here — a scan that would not assemble, a cube that is
   * one sticker short of real — keeps what is there, since the whole point is
   * to fix one square.
   */
  function showEditor(fresh) {
    if (fresh) {
      for (var i = 0; i < stickerCount(); i++) if (!isCenter(i)) colorState[i] = -1;
      unsure = {};
      save();
    }
    editGuide.setState(colorState);
    editGuide.setStep(0, false);
    buildFace();
    updateEditChrome();
    showView('edit');
  }

  function updateEditChrome() {
    var info = editGuide.instruction();
    $('edit-guide-arrow').textContent = info.arrow;
    $('edit-guide-text').textContent = 'Face ' + (info.step + 1) + ' of ' + CubeGuide.STEPS +
      ' — ' + info.text;
    $('btn-edit-next').textContent = editGuide.atEnd() ? 'Solve it →' : 'Next face ›';
  }

  function editStep(n) {
    if (n < 0) { showView('setup'); return; }
    if (n >= CubeGuide.STEPS) { note = null; doSolve(); return; }
    editGuide.setStep(n, true);
    buildFace();
    updateEditChrome();
  }

  // ---- academy -----------------------------------------------------------

  function teaching() { return !!(plan && plan.teaching && plan.groups && plan.groups.length); }

  /**
   * The method's eight stages, whether or not this cube needed all of them.
   *
   * A scramble can arrive with a stage already done — the top cross falls into
   * place surprisingly often — and the solver then emits no moves for it, so
   * the solution has six groups. Numbering from the solution would call that
   * "stage 5 of 6", which teaches a method that does not exist. The strip is
   * always the seven, and a stage with nothing to do is shown as done, which
   * is both true and the more useful thing to know.
   */
  function stagePlan() {
    var groups = {};
    (plan.groups || []).forEach(function (g) { groups[g.id] = g; });
    return Academy.STAGES.map(function (s, i) {
      return { id: s.id, number: i + 1, title: s.title, group: groups[s.id] || null };
    });
  }

  /** Which stage `index` falls in. */
  function currentStage() {
    if (!teaching()) return null;
    var stages = stagePlan(), found = null;
    stages.forEach(function (s) {
      if (s.group && index >= s.group.start) found = s;
    });
    return found || stages.filter(function (s) { return s.group; })[0] || null;
  }

  /*
   * The eight stages as a row of dots: done, here, still to come — and a way
   * back into any of them. Being able to see the shape of the method before
   * you are half way through it is most of what makes it feel learnable
   * rather than endless.
   */
  function buildStageStrip() {
    var strip = $('stage-strip');
    strip.innerHTML = '';
    strip.hidden = !teaching();
    if (!teaching()) return;
    stagePlan().forEach(function (s) {
      var dot = document.createElement('button');
      dot.className = 'stage-dot' + (s.group ? '' : ' is-free');
      dot.type = 'button';
      dot.dataset.stage = s.id;
      dot.textContent = String(s.number);
      var label = 'Stage ' + s.number + ': ' + s.title +
        (s.group ? '' : ' — already done on this cube');
      dot.setAttribute('aria-label', label);
      dot.title = label;
      dot.disabled = !s.group;
      if (s.group) dot.addEventListener('click', function () { jumpToStage(s.group); });
      strip.appendChild(dot);
    });
  }

  function updateStageStrip() {
    if (!teaching()) return;
    var here = currentStage();
    var stages = stagePlan();
    var dots = $('stage-strip').children;
    for (var i = 0; i < dots.length; i++) {
      var s = stages[i];
      // a stage with no moves was already done when the cube arrived
      var done = !s.group || index >= s.group.start + s.group.count;
      dots[i].classList.toggle('is-done', done);
      dots[i].classList.toggle('is-here', !!here && here.id === s.id && index < plan.steps.length);
    }
  }

  function jumpToStage(g) {
    if (busy || !plan) return;
    endCelebration();
    lessonOpen = false;
    index = g.start;
    delete introDone[g.id];   // arriving at a stage is arriving at its lesson
    applyIndex();
  }

  /**
   * True when the card should be showing the lesson rather than a move.
   *
   * You get one of these on the way into each stage: what it is for, what to
   * look for on your own cube, and only then the moves. It is the difference
   * between being taught and being led — the moves alone teach nothing, which
   * is exactly the complaint about every "solve it in 20 moves" answer.
   */
  /*
   * The very first card: how to hold the cube.
   *
   * Before any stage, before any move. The whole method is written for white
   * on the bottom, the cube on screen is already showing the result of that
   * turn, and the user has to make it in their hands or nothing after this
   * lines up. It gets its own beat for the same reason it gets its own
   * paragraph in every tutorial.
   */
  function atOrientation() {
    return teaching() && !!plan.orientation && index === 0 && !introDone.__hold && !lessonOpen;
  }

  function showOrientation() {
    $('stage-line').hidden = false;
    $('stage-line').textContent = 'Before you start';
    $('move-title').textContent = plan.orientation.moved ? 'Turn the whole cube' : 'How to hold it';
    $('move-detail').textContent = plan.orientation.text;
    $('academy-note').hidden = false;
    $('academy-note').textContent = 'The cube above is how yours should look once you have. ' +
      'Turning the whole cube solves nothing and breaks nothing — the centres go with it, and they ' +
      'are what every instruction from here is measured against.';
    $('alg-strip').hidden = true;
    $('btn-next').textContent = 'Done — what is first? ›';
    solveFront.showArrowFor = null;
  }

  function atStageIntro() {
    if (!teaching() || index >= plan.steps.length) return false;
    if (atOrientation()) return true;
    if (lessonOpen) return true;
    var here = currentStage();
    return !!here && !!here.group && index === here.group.start && !introDone[here.id];
  }

  function showStageIntro(here) {
    var lesson = Academy.stage(here.id) || {};
    var pieces = pieceRun(here.group);
    $('stage-line').hidden = false;
    $('stage-line').textContent = 'Stage ' + here.number + ' of ' + Academy.STAGES.length;
    $('move-title').textContent = lesson.title || here.group.title;
    $('move-detail').textContent = lesson.goal || here.group.blurb || '';
    $('academy-note').hidden = false;
    /*
     * How much of it there is, before it starts. Four pieces reads as a list
     * you can get to the end of; twenty-five moves reads as a wall — and they
     * are the same stage.
     */
    $('academy-note').textContent = (pieces.length > 1
      ? pieces.length + ' pieces, ' + here.group.count + ' moves. '
      : here.group.count + ' moves. ') + (lesson.look || '');
    $('alg-strip').hidden = true;
    $('btn-next').textContent = lessonOpen ? 'Back to the moves ›' : 'Start this stage ›';
    solveFront.showArrowFor = null;
  }

  /** The algorithm being run, its notation, and where in it you are. */
  function showAlgStrip(step) {
    var strip = $('alg-strip');
    var place = step.place;
    if (!place || !place.alg || !place.tokens.length) { strip.hidden = true; return; }
    strip.hidden = false;
    strip.innerHTML = '';

    var name = document.createElement('span');
    name.className = 'alg-name';
    name.textContent = place.rounds > 1
      ? place.alg.name + ' · ' + place.round + ' of ' + place.rounds
      : place.alg.name;
    strip.appendChild(name);

    place.tokens.forEach(function (token, i) {
      var el = document.createElement('span');
      el.className = 'alg-move' + (i === place.at ? ' is-now' : '');
      el.textContent = token;
      strip.appendChild(el);
    });

  }

  /**
   * The pieces a stage places, in the order it places them.
   *
   * The first three stages do four pieces each, one at a time, and the solver
   * says which — so a run of twenty-five moves becomes four things with a
   * name, a count and an end. Worked out from the steps rather than stored,
   * because the number of pieces a stage needs depends on what the scramble
   * left already done.
   */
  function pieceRun(group) {
    var order = [], seen = {};
    for (var i = group.start; i < group.start + group.count; i++) {
      var t = plan.steps[i].target;
      if (t && !seen[t]) { seen[t] = true; order.push(t); }
    }
    return order;
  }

  function pieceLine(here, step) {
    if (!step.target) return null;
    var order = pieceRun(here.group);
    var at = order.indexOf(step.target) + 1;
    var name = Academy.pieceLabel(step.target, faceColorName);
    if (!name) return null;
    return (order.length > 1 ? 'Piece ' + at + ' of ' + order.length + ' · ' : '') +
      name[0].toUpperCase() + name.slice(1);
  }

  // ---- player ------------------------------------------------------------

  function applyIndex() {
    if (!plan) return;
    var total = plan.steps.length;
    var atEnd = index >= total;
    solveFront.setState(plan.states[index]);

    var here = currentStage();
    var intro = atStageIntro();
    var upcoming = (atEnd || intro) ? null : plan.steps[index].move;
    solveFront.showArrowFor = upcoming;
    solveFront.dirty = true;

    $('stage-line').hidden = true;
    $('academy-note').hidden = true;
    $('alg-strip').hidden = true;
    $('btn-next').textContent = 'Next ›';
    $('stage-line').classList.toggle('is-open', lessonOpen);

    if (atEnd) {
      $('move-title').textContent = 'Solved!';
      $('move-detail').textContent = teaching()
        ? 'That is the whole method — every stage of it, on your own scramble. ' + total +
          ' moves. Do it again on a fresh scramble and you will need the cards less each time.'
        : 'Every face should now be a single colour. ' + total + ' moves. Nice work.';
      celebrate();
    } else if (atOrientation()) {
      showOrientation();
    } else if (intro) {
      showStageIntro(here);
    } else {
      var step = plan.steps[index];
      var d = describe(step);
      $('move-title').textContent = d.title;
      $('move-detail').textContent = d.detail;
      if (teaching() && here) {
        var lesson = Academy.stage(here.id);
        $('stage-line').hidden = false;
        // where you are inside the stage as well as inside the solve: the bar
        // at the top is over a hundred and ten moves, which is nobody's idea
        // of encouraging
        $('stage-line').textContent = 'Stage ' + here.number + ' of ' + Academy.STAGES.length + ' · ' +
          ((lesson && lesson.title) || here.title) +
          ' · ' + (index - here.group.start + 1) + '/' + here.group.count;
        /*
         * One line under the move, for whatever matters most right now.
         *
         * Three things want it and they are in priority order. As an algorithm
         * starts, what it is for — that reason was written down and shown at
         * the bottom of the card, where a 32vh cap quietly cut it off, which
         * is the same as not writing it. While pieces are going in, which
         * piece. Otherwise, what to look for. They never all apply at once,
         * and giving them a line each would cost the cube the height instead.
         */
        var place = step.place;
        var why = (place && place.alg && place.at === 0) ? place.alg.why : null;
        var piece = pieceLine(here, step);
        var line = why || piece || (lesson && !(place && place.alg) ? lesson.look : null);
        if (line) {
          $('academy-note').hidden = false;
          $('academy-note').textContent = line;
          $('academy-note').classList.toggle('is-why', !!why);
        }
        if (place && place.alg) showAlgStrip(step);
      }
    }

    $('move-counter').textContent = atEnd ? 'Done' : 'Move ' + (index + 1) + ' of ' + total;
    // a cube that was already solved has no moves at all, and 0/0 is not a width
    $('progress-fill').style.width = (total ? 100 * index / total : 100).toFixed(1) + '%';
    $('btn-prev').disabled = index === 0;
    $('btn-replay').disabled = index === 0 || intro;
    $('btn-next').disabled = atEnd;
    $('btn-restart').textContent = atEnd ? '↻ Scan another cube' : 'Not solved? Start over';
    // both classes set the background, and .btn-ghost is declared later, so it
    // wins whenever it is left on — the button stayed an outline at the end
    $('btn-restart').classList.toggle('btn-primary', atEnd);
    $('btn-restart').classList.toggle('btn-ghost', !atEnd);
    $('btn-mode').textContent = teaching() ? '⚡ Just solve it' : '🎓 Teach me this one';
    /*
     * A taught card carries more than a followed one — the stage, the piece or
     * the reason, and the notation — so it is allowed more of the screen, and
     * the cube gives it up. Without this the reason an algorithm works was
     * cut off at the bottom of the card, which is the same as never having
     * written it.
     */
    document.body.classList.toggle('teaching', teaching());
    updateStageStrip();
  }

  function stepForward() {
    if (busy || !plan || index >= plan.steps.length) return;
    // the lesson card is a step of its own: read it, then start the stage
    if (atOrientation()) { introDone.__hold = true; applyIndex(); return; }
    if (atStageIntro()) {
      introDone[currentStage().id] = true;
      lessonOpen = false;
      applyIndex();
      return;
    }
    var move = plan.steps[index].move;
    busy = true;
    solveFront.showArrowFor = null;
    solveFront.playMove(move, MOVE_MS, function () {
      index++;
      busy = false;
      buzz();
      applyIndex();
    });
  }

  function stepBack() {
    if (busy || !plan) return;
    endCelebration();
    // step back out of a lesson card into the last move of the stage before it
    if (atStageIntro() && index > 0) { introDone[currentStage().id] = true; lessonOpen = false; }
    if (index === 0) { applyIndex(); return; }
    index--;
    applyIndex();
  }

  function replayCurrent() {
    if (busy || !plan || index === 0 || atStageIntro()) return;
    endCelebration();
    index--;
    applyIndex();
    stepForward();
  }

  /**
   * A short buzz as a move lands, where the hardware has one.
   *
   * Your eyes are on the cube, not the phone, so the moment a turn finishes is
   * the one piece of feedback that is hard to get any other way. Android and
   * Chrome have it; iOS Safari has never supported the Vibration API and
   * ignores this entirely.
   */
  function buzz() {
    if (Celebrate.reducedMotion()) return;
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not allowed */ } }
  }

  // ---- the end of it -----------------------------------------------------

  /**
   * Confetti, a spin, and the card doing a little jump.
   *
   * Guarded by `celebrated` because applyIndex() runs on every step and the
   * last one is not special to it — stepping back and forward over the finish
   * would otherwise fire the whole thing again each time.
   */
  function celebrate() {
    if (celebrated) return;
    celebrated = true;
    var canvas = $('confetti');
    canvas.hidden = false;
    stopConfetti = Celebrate.fire(canvas, { colors: PALETTE });
    $('instruction-card').classList.add('is-solved');
    spinOnce();
    setTimeout(function () { if (celebrated) canvas.hidden = true; }, 3000);
  }

  function endCelebration() {
    celebrated = false;
    if (stopConfetti) { stopConfetti(); stopConfetti = null; }
    $('confetti').hidden = true;
    $('instruction-card').classList.remove('is-solved');
  }

  /** One turn of the finished cube, then back to square on. */
  function spinOnce() {
    if (Celebrate.reducedMotion()) return;
    var start = null, from = FRONT_VIEW.yaw;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / 1500);
      var e = 1 - Math.pow(1 - t, 3);
      solveFront.setView(from - 360 * e, FRONT_VIEW.pitch);
      if (t < 1 && celebrated) requestAnimationFrame(frame);
      else solveFront.setView(FRONT_VIEW.yaw, FRONT_VIEW.pitch);
    }
    requestAnimationFrame(frame);
  }

  // ---- scanning ----------------------------------------------------------

  function openScanner() {
    endCelebration();
    voice.stop();
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
        refreshNet(); refreshViews(); updateHoldText(); save();

        if (result.source === 'failed') {
          failTo(result.note || 'Those photos did not add up to a real cube. Fix the wrong ' +
            'stickers on the map, or scan again.');
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
  }

  // ---- voice -------------------------------------------------------------

  /*
   * "Next", out loud, because both hands are on the cube.
   *
   * Off until asked for, and it says why on the button: this is the one thing
   * in the app that leaves the device.
   */
  var voice = new CubeVoice({
    onCommand: function (name) {
      if ($('view-solve').hidden) return;
      if (name === 'next') stepForward();
      else if (name === 'back') stepBack();
      else if (name === 'again') replayCurrent();
    },
    onState: function (state, detail) {
      var btn = $('btn-voice');
      btn.classList.toggle('is-live', state === 'listening');
      btn.setAttribute('aria-pressed', state === 'listening' ? 'true' : 'false');
      if (state === 'listening') setSolveNote('Listening — say “next”, “back” or “again”.');
      else if (state === 'blocked') setSolveNote('Microphone access was refused, so voice is off.', true);
      else if (state === 'no-mic') setSolveNote('No microphone on this device, so voice is off.', true);
      else if (state === 'off') setSolveNote('');
      if (detail) console.info('voice:', state, detail);
    }
  });

  /** The one line above the cube, used by voice and by an automatic repair. */
  function setSolveNote(text, bad) {
    var el = $('repair-note');
    if (!text && note) { el.textContent = note; el.hidden = false; return; }
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-bad', !!bad);
  }

  // ---- events ------------------------------------------------------------

  function wire() {
    $('btn-edit').addEventListener('click', function () { showEditor(true); });
    $('btn-home').addEventListener('click', function () { showView('setup'); });
    $('btn-back').addEventListener('click', function () { showView('setup'); });
    $('btn-scan').addEventListener('click', openScanner);
    $('btn-restart').addEventListener('click', openScanner);

    $('btn-edit-next').addEventListener('click', function () { editStep(editGuide.step + 1); });
    $('btn-edit-prev').addEventListener('click', function () { editStep(editGuide.step - 1); });
    $('btn-solve').addEventListener('click', function () { note = null; doSolve(); });

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
      refreshNet(); refreshViews(); updateHoldText(); save();
      setMessage('Scrambled. Solve it to see the way back.', 'ok');
    });
    $('btn-clear').addEventListener('click', function () {
      for (var i = 0; i < stickerCount(); i++) if (!isCenter(i)) colorState[i] = -1;
      refreshNet(); refreshViews(); save();
      setMessage(size === 3
        ? 'Cleared — the centres stay put because they never move on a 3×3.'
        : 'Cleared. A ' + size + '×' + size + ' has no fixed centres, so everything went.');
    });
    document.querySelectorAll('.size-option').forEach(function (button) {
      button.addEventListener('click', function () { setSize(+button.dataset.size); });
    });

    $('btn-next').addEventListener('click', stepForward);
    $('btn-prev').addEventListener('click', stepBack);
    $('btn-replay').addEventListener('click', replayCurrent);

    // the stage line doubles as the way back into that stage's lesson
    $('stage-line').addEventListener('click', function () {
      if (!teaching() || busy) return;
      lessonOpen = !lessonOpen;
      applyIndex();
    });

    document.querySelectorAll('.mode-option').forEach(function (button) {
      button.addEventListener('click', function () { setMode(button.dataset.mode); });
    });
    // and the same switch from the solve screen, on the cube already in hand
    $('btn-mode').addEventListener('click', function () {
      setMode(teaching() ? 'fast' : 'academy');
      note = null;
      doSolve();
    });

    if (CubeVoice.supported()) {
      $('btn-voice').hidden = false;
      $('btn-voice').addEventListener('click', function () { voice.toggle(); });
    }

    document.addEventListener('keydown', function (e) {
      if ($('view-solve').hidden) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { stepForward(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stepBack(); e.preventDefault(); }
    });

    document.addEventListener('pointerup', function () { painting = false; });

    /*
     * The face is sized to its box, so anything that changes the box has to
     * refit it, and turning the phone is only the obvious one. A message
     * appearing underneath takes 20-40px out of the box, and the face is
     * centred inside an overflow: hidden parent, so a fit that is no longer
     * right loses a row off the top and the bottom with nothing to show for
     * it. Watching the box itself covers every cause at once, including the
     * ones nobody thought of.
     */
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(fitNet).observe(document.querySelector('.net-fit'));
    }
    window.addEventListener('resize', fitNet);
    window.addEventListener('orientationchange', function () { setTimeout(fitNet, 250); });
  }

  function setMode(next) {
    mode = next === 'academy' ? 'academy' : 'fast';
    document.querySelectorAll('.mode-option').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    });
    $('mode-note').textContent = MODE_NOTE[mode][size] || MODE_NOTE[mode][3];
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
  }

  /*
   * Build the fast solver's tables before anyone asks for them.
   *
   * Four megabytes of move and pruning tables take a couple of seconds on a
   * phone, and they were being built at the worst possible moment: the second
   * after a scan finishes, when the answer is the only thing anyone wants. The
   * page is idle long before that — reading the home screen, holding a cube up
   * to a camera — so this uses that time instead, and the panel that used to
   * appear now usually does not.
   *
   * requestIdleCallback keeps it out of the way of anything the user is doing;
   * Safari only got it in 16.4, so the fallback is a plain delay. Either way
   * the build itself yields between slices, and a second caller arriving mid
   * build now waits on the first rather than starting another.
   */
  function prewarm() {
    if (typeof Kociemba === 'undefined' || Kociemba.isReady()) return;
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1500); };
    idle(function () { Kociemba.prepare(null, function () { /* ready when it is */ }); });
  }

  /*
   * Keep a copy of the app, so it works with no signal.
   *
   * Everything here already runs on the device; the only thing needing a
   * network was fetching the files. sw.js is network-first, so what you get
   * online is always what was published and what you get offline is the last
   * thing that was. Registered late and quietly — a failure here costs
   * offline support and nothing else, which is not worth a message.
   */
  function keepACopy() {
    if (!navigator.serviceWorker || location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* no offline, then */ });
    });
  }

  // ---- boot --------------------------------------------------------------

  load();
  try {
    var savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode) mode = savedMode;
  } catch (e) { /* private mode */ }
  setMode(mode);
  buildPalette();
  updateHoldText();
  buildFace();
  refreshNet();
  refreshViews();
  wire();
  prewarm();
  keepACopy();
})();
