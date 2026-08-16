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

- [ ] Tapping **Scan with your camera** prompts for camera permission the first
      time, and only the first time.
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
- [ ] Six faces in any order, each held any way up, ends on the sticker map with
      the colours in the right places.
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

- [ ] **Play**, **‹**, **›** and **↻ Repeat** all hit first time with a thumb,
      one-handed, without zooming.
- [ ] The animation is smooth rather than juddering — this is a software 3D
      renderer on a 2D canvas, and a phone GPU does not help it.
- [ ] The speed slider can be dragged with a thumb. It is 44px tall now, but
      the track inside it is still 16px, so this is worth a real check.
- [ ] Dragging the big cube spins it, and dragging it does **not** scroll the
      page. (`touch-action: none` should see to that.)
- [ ] Dragging the small back-view cube spins that one.
- [ ] Tapping a stage in the list jumps to it.
- [ ] Scroll down, scroll back — nothing has shifted or reflowed.

## 5. Safari itself

None of this exists under emulation.

- [ ] **The notch and the home indicator.** Portrait: the header does not sit
      under the notch, and the footer is not cut off by the home indicator.
      Landscape, notch on the left, then turn the phone the other way so it is
      on the right: nothing in the header, the map or the scanner disappears
      behind it. The automated suite fakes these insets and checks the CSS
      arithmetic; it cannot check that iOS reports them or that
      `viewport-fit=cover` behaves.
- [ ] **Safari's own chrome.** The address bar collapses as you scroll and comes
      back when you scroll up, changing the visible height as it goes. Nothing
      should be permanently hidden behind it.
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

- [ ] Leave it open for ten minutes, come back, and press Play.
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

- horizontal overflow at every cube size, on both views and with the scanner open
- every button, input, summary and label at 44px or more
- sticker size at 2x2, 3x3 and 4x4
- the scanner card, camera preview and three buttons fully on screen, with no
  modal scrolling, and the tip not covered by the preview
- the header and the scanner clearing simulated notch and home-indicator insets

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
