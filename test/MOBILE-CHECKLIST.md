# Mobile checklist — what a real iPhone has to settle

`npm run test:mobile` drives six emulated profiles and proves the layout holds:
nothing wider than the screen, every control at least 44px, the sticker map
usable at 2x2, 3x3 and 4x4, the scanner on screen with its buttons reachable,
portrait and landscape. That is all it proves.

It runs on Playwright's WebKit, which is the engine iOS Safari is built on but
is not iOS Safari, and it runs on a Windows machine, where Xcode and the iOS
Simulator do not exist. It has **no camera, no notch, no touch, and no Safari**.
So everything below is unverified until a person does it, on a real iPhone,
against the Tailscale address:

    node tools/serve.js
    # then, on the phone: https://elijahman.taileb0bc0.ts.net

https matters. Browsers only hand over a camera on https or localhost, and the
app says so in the scanner when it cannot get one.

Record what you find. If something here fails, it is a real bug that the
automated suite cannot see, which is the whole reason this file exists.

---

## 1. The camera

The single biggest hole in the automated suite. `getUserMedia` never resolves
under emulation, so every one of these paths has only ever run in a browser
that refused the camera.

- [ ] Tapping **Scan my cube** prompts for camera permission the first time,
      and only the first time.
- [ ] Allowing it shows a live picture, the right way up, not mirrored.
- [ ] It is the **back** camera (`facingMode: 'environment'`), not the selfie one.
- [ ] Denying permission shows a readable explanation, not a blank black box,
      and **Cancel** still works.
- [ ] Locking the phone and coming back, or switching apps and coming back,
      leaves a working preview rather than a frozen frame.
- [ ] An incoming call or a notification banner does not leave the video stopped.
- [ ] **Cancel** actually turns the camera off — the orange/green recording dot
      in the status bar goes away.

## 2. The six-snap flow

- [ ] The green outline appears when a face is in frame, and sits **on** the
      cube — corners on corners, dots on stickers — not offset or scaled wrong.
      This is the one the automated suite cannot even approximate: the overlay
      is drawn from `videoBox()` measuring the live element, and the landscape
      layout now changes that box's shape.
- [ ] The outline tracks as you move the phone, and does not lag so far behind
      that you snap the wrong moment.
- [ ] Six faces in any order, each held any way up, ends **on the first move of
      a solution** — the scanner closes, the cube is solved without being asked,
      and there is nothing to confirm on the way. If it lands on the map
      instead, read the message: that is the reading not adding up to a real
      cube, which is a scanning problem, not a flow one.

### 2b. The second cube — the whole reason this screen has two of them

- [ ] The cube under the camera preview **paints in the face you just took**,
      and it is the right colours. Hold your cube next to the phone and compare
      them square by square. This is the one thing that can catch a bad read
      before a solution gets written for it.
- [ ] Red and orange, again, but here: do they come out as red and orange on
      the little cube, or as two browns? The colours it shows are the ones
      actually photographed with the chroma pushed up, not the app's final
      opinion — a face that looks wrong here is a face that was read badly.
- [ ] It **holds the face for about two thirds of a second, then turns**. Is
      that long enough to look at? Too long to wait for?
- [ ] The turn matches the words. "Turn the cube LEFT" and the cube on screen
      turning the same way you would: do they agree, or does the picture say
      one thing and the sentence another? Try it without reading the words at
      all — the turn is meant to be the instruction.
- [ ] **Follow the route.** Three turns to the left, then tip toward you, then
      tip twice more. Does it end up reading your cube correctly? Then ignore
      the route entirely and show it faces in a random order and any way up —
      that must still work, because the assembler does not care and the route
      is guidance, not a requirement.
- [ ] **Redo last** takes the face back off the little cube and turns it back.
- [ ] The thumbnails along the bottom fill in one per snap.
- [ ] **Redo last** goes back exactly one face, and the outline goes green again
      rather than staying amber at the face you just threw away.
- [ ] Do it again for a 2x2 and a 4x4. The 4x4 is the size where the map is
      tightest and the detector has the most to find.
- [ ] Red and orange come out as red and orange in ordinary indoor light, and
      again near a window. Anything the reader was unsure of pulses blue — check
      that the pulse is visible on a phone screen, at arm's length.

## 2a. Auto-capture — the numbers behind it came from a renderer

`npm run test:camera` drives all of this on a fake camera and it passes, but a
fake camera has no lens blur, no rolling shutter, no auto-exposure hunting and
no JPEG. Every threshold in `js/autosnap.js` was measured against rendered
frames, which are sharper and steadier than anything a phone produces. **This
section is where those numbers meet reality, and it is the most likely place
for this feature to be wrong.**

The two failures pull opposite ways, so watch for both:

- [ ] **Does it fire at all?** Hold a face up steadily. It should take the photo
      after roughly two-thirds of a second. If it sits there green and never
      fires, a real camera is noisier than the renderer and the bars are too
      tight — most likely `angleTol` (0.06 rad) or `colorTol`.
- [ ] **Does it fire too soon?** Move the cube towards the camera, or turn it
      slowly past, and see whether it grabs a shot mid-movement. A photo taken
      of a face at a steep angle is the one that quietly poisons the read.
- [ ] The outline fills in green like a fuse as it makes up its mind, and you
      can see it filling — not just on and off.
- [ ] **The blink.** The picture flashes white when a photo is taken. On the
      sixth it does not, because the scanner closes in the same instant; check
      that still feels like an ending rather than a glitch.
- [ ] **It does not take two of one face.** Hold one face up and just leave it
      there for twenty seconds. Exactly one photo. The outline should go amber
      and it should say "Turn the cube to a face you have not done yet."
      Do this on a **2x2 and a 4x4** especially — a 3x3 is protected by its
      centre sticker regardless, so it proves nothing.
- [ ] Turn from one face to another **without letting either leave the frame**,
      which is the hard case: only the colours say the face changed. On a 2x2,
      about 1 pair of faces in 500 reads too alike to notice, and then you tap
      Snap — check that Snap still works while the outline is amber.
- [ ] Scan a **solved or near-solved cube**, where several faces are one flat
      colour. This is the worst case for telling faces apart and the renderer
      only ever made scrambled ones.
- [ ] Does it fire while you are still moving the cube into position, before you
      have settled? Does the two-thirds of a second feel like waiting?
- [ ] Six faces end to end with no taps at all. Time it. If it is slower than
      pressing the button six times, the feature is not earning its place.

## 3. Orientation — the thing this app is actually about

The cube on screen is turned to match the **last photo you took**, so the moves
suit how the cube is already in your hand and there is nothing to line up.
That is a claim about how it feels, and no test can check it.

- [ ] Take the sixth photo holding the cube in some deliberately awkward way —
      not white on top, not green facing you.
- [ ] Without turning the cube in your hand at all, look at the 3D view. It
      should show the cube from the same angle you are looking at it.
- [ ] Follow the first three or four moves without re-orienting the cube. They
      should land on the faces the screen says they should.
- [ ] The note above the cube should agree with what you are holding, rather
      than telling you to put white on top.

## 4. Stepping through a solution

- [ ] **Next**, **‹ Back** and **↻** all hit first time with a thumb,
      one-handed, without zooming. Next is the big one and should be reachable
      with the thumb of the hand holding the phone.
- [ ] The animation is smooth rather than juddering — this is a software 3D
      renderer on a 2D canvas, and a phone GPU does not help it.
- [ ] **A move is slow enough to follow.** One quarter turn takes 1.1 seconds
      by design. Watch a few without looking away: can you tell which way the
      layer went, first time, every time? If not, `MOVE_MS` in `js/app.js` is
      the number.
- [ ] **Half turns come as two moves.** A 180° turn is split into two quarter
      turns in the same direction, with a stop in between, and the card says so.
      Check that reads as deliberate rather than as the app repeating itself.
- [ ] **The cube is shown square on** — front face flat, top face as a band
      above it. Hold your cube the same way. Does the picture match what is in
      your hand well enough to copy the move without thinking about it? This is
      the one change here that is purely a judgement call.
- [ ] **The cube does not move, and cannot be moved.** Swipe it, flick it, drag
      across it while stepping: it stays square on. Dragging must also not
      scroll or bounce the page. (`touch-action: none` and
      `overscroll-behavior: none` should see to that.)
- [ ] **A move that turns a face you cannot see.** A `D` turns the bottom layer,
      of which only the front row is visible from square on. Is the arrow plus
      the sentence enough, or does that move need the back view putting back?
- [ ] **Say "next".** Press the microphone, allow the permission, and step a
      whole solve by voice with both hands on the cube — which is the point of
      it. Then: does it mishear anything as "next"? Does it keep listening
      after a pause, after locking the screen, after a notification? Does it
      stop when you press the button again, and does the recording indicator in
      the status bar actually go out?
- [ ] **"Not solved? Start over"** — press it mid-solve, and it goes straight
      back to the camera.
- [ ] **The finish.** Confetti, the cube turning once, the card jumping. Then
      Reduce Motion on and again: it should be a slow drift with no spin and no
      jump, but still obviously a celebration rather than nothing.
- [ ] **Nothing scrolls, and nothing is cut off.** This is the point of the
      layout: html and body are `overflow: hidden`, so anything that does not
      fit is clipped rather than scrolled. Check the bottom of all three
      screens carefully, in both orientations, at 2x2, 3x3 and 4x4 — and with
      Larger Text turned up (Settings → Display & Brightness → Text Size), which
      is the setting most likely to break it.

## 4a. Academy mode — the only part that can be wrong quietly

The moves are checked by `test/academy.test.js`; whether any of it *teaches*
is not checkable and is the whole point.

- [ ] Scramble a cube you cannot solve, pick **🎓 Teach me**, and follow it to
      the end without help. Could you? Where did you get stuck?
- [ ] **The lesson before each stage.** Read one on the phone at arm's length.
      Is "what to look for" enough to find the case on your own cube, or does
      it describe something you cannot locate?
- [ ] **The algorithm strip.** When it says Sune and highlights the third turn,
      is the cube on screen doing that turn? Follow one algorithm through with
      your eyes on the strip rather than the cube.
- [ ] **Jump between stages** with the numbered dots. Are they big enough to
      hit? Seven across a 375px screen is 44px each at best, and they are the
      one control the automated suite exempts.
- [ ] A stage your cube arrives with already done shows greyed out and cannot
      be tapped. Does that read as "already done" or as "broken"?
- [ ] **⚡ Just solve it** on the same cube, mid-way through a stage, then
      **🎓 Teach me this one** back again. Both should re-solve from your
      original scramble without another scan.
- [ ] Do it twice on two scrambles. Second time round, did you need the cards
      less? That is the only measure of this feature that matters.

## 4b. New and untestable here

- [ ] **The screen does not go out.** Follow a long solve without touching the
      phone for a minute at a time. iOS 16.4 and later should hold it awake;
      before that it will sleep and there is nothing to be done.
- [ ] **Add to Home Screen**, open from there, and do a whole scan. Standalone
      mode has different safe-area insets from a Safari tab and its own camera
      permission prompt.
- [ ] **Turn off wifi and data entirely, then open it from the home screen.**
      It should work completely — scan, solve, teach. A 4×4 is the exception
      worth testing separately: its solver is fetched on demand, so scan a 4×4
      *offline* and check it still solves (the service worker should have it).
- [ ] Publish a change, then open the app again. Do you get the new version?
      Network-first says yes on the second load at worst. If you ever see a
      stale one, `VERSION` in `sw.js` is the lever.

## 5. Safari itself

None of this exists under emulation.

- [ ] **The notch and the home indicator.** Portrait: the header does not sit
      under the notch, and the footer is not cut off by the home indicator.
      Landscape, notch on the left, then turn the phone the other way so it is
      on the right: nothing in the header, the map or the scanner disappears
      behind it. The automated suite fakes these insets and checks the CSS
      arithmetic; it cannot check that iOS reports them or that
      `viewport-fit=cover` behaves.
- [ ] **Safari's own chrome.** The page cannot be scrolled, so the address bar
      never collapses and the visible height is the small one. That is exactly
      what `100dvh` is for, and iOS Safari is the browser it was invented for —
      check that the bottom row of every screen is above the toolbar rather
      than behind it. Then check it again in Chrome for iOS, whose toolbar is a
      different height.
- [ ] **Rotating with the scanner open.** Turn the phone while the camera is
      running. The layout should swap to two columns and the video should keep
      going.
- [ ] **Rotating mid-solve.** Turn the phone while a move is animating.
- [ ] Double-tap does not zoom the page. Pinch-zoom still works if you want it.
- [ ] Add to Home Screen, open it from there, and check the header and footer
      again — standalone mode has different insets from a Safari tab.
- [ ] Reduce Motion on (Settings → Accessibility → Motion): the "unsure sticker"
      pulse stops, and the shutter blink drops to a dim slow pulse instead of a
      white flash. The blink must still be *visible* — it is the only feedback
      that a photo was taken — just not a strobe.
- [ ] Dark mode / light mode: this app is dark either way by design. Confirm it
      does not come out half-inverted.

## 6. Things worth trying that nobody plans for

- [ ] Leave it open for ten minutes, come back, and press Next.
- [ ] Fill in a cube, close Safari entirely, reopen — the cube should still be
      there (it is kept in `localStorage`).
- [ ] Private Browsing, where `localStorage` throws. The app should still work
      for the session.
- [ ] A deliberately impossible cube — swap two stickers by hand — should be
      refused with a reason, on the phone as on the desktop.
- [ ] Low Power Mode. Animations get throttled; check nothing breaks.

---

## What the automated suites cover, so you can skip it here

Do not spend phone time on these.

`npm run test:mobile` — iPhone SE (375), iPhone 15 (393) and Pixel 7 (412),
portrait and landscape:

- **vertical overflow: every screen, at every cube size, must fit the window
  without scrolling** — including after a move has been made and the wording
  has changed under it
- the map walking six faces one at a time, one face on screen at each step,
  ending on a button that solves rather than asking for a seventh
- both cubes on the scanner screen, neither of them squeezed off it
- the finish: confetti, the card marked solved, and the escape-hatch button
  turning into "scan another" (iPhone SE only — it is behaviour, not layout,
  and it costs a whole solve in real time)
- horizontal overflow at every cube size, on all three screens and with the
  scanner open
- every button, input, summary and label at 44px or more, on all three screens
- sticker size at 2x2, 3x3 and 4x4 (measured table in the spec's header)
- the home screen staying a cube, a size and a scan button, and nothing else
  growing back onto it
- the scanner card, camera preview and three buttons fully on screen, with no
  modal scrolling, and the tip not covered by the preview
- the header, the scanner, and the solve screen's own top row — which is what
  clears the notch there, since the header is hidden — against simulated notch
  and home-indicator insets

`npm run test:camera` — the scanner on a fake camera, in Chromium:

- six faces auto-captured on a 2x2, a 3x3 and a 4x4, with nothing touched
- one face held up for twenty-two seconds giving exactly one photo, on both
  sizes that have no centre sticker
- the map filled in and the cube assembling
- one blink per photo, and the live loop actually stopping when it closes

`npm test` (`test/autosnap.test.js`) — the firing decision itself, over hundreds
of rendered looks run through the real detector: fires when a face is held,
never at an empty frame, never at a cube being turned, never twice on one face,
and rearms when the cube is turned to a new one.
