/* ============================================================================
   PTL — the page
   ----------------------------------------------------------------------------
   Six beats of an argument, choreographed against scroll over a field drawn by
   ptl-field.js. Scroll is the only clock the ARGUMENT runs on: every position
   on this page is a pure function of scrollY, so there is nothing to seek,
   buffer or decode, and dragging the scrollbar backwards runs the film
   backwards exactly.

   There is a second clock, and it drives texture only. The field breathes on a
   real-time clock so that a page nobody is touching is alive rather than a
   screenshot, and scrolling makes that clock run faster. It reaches exactly one
   thing — the size of the halftone marks — and nothing that decides where a
   word sits can read it, so the two clocks cannot disagree about anything that
   matters. See "the ambient clock" below.

   The copy is NOT held here. It lives in index.html as ordinary semantic HTML
   and is read out of the DOM below, so a crawler, a link preview and a screen
   reader all get the argument even though not one visible word on this page is
   in the source at that position.
   ========================================================================== */
(function () {
  'use strict';

  const pair = (v, dflt) => {
    if (!v) return dflt;
    const n = v.split(',').map(Number);
    return n.length === 2 && n.every(Number.isFinite) ? n : dflt;
  };

  /* ---- the argument, read from the document ------------------------------ */
  const S = [...document.querySelectorAll('#story section')].map(sec => {
    const p = sec.querySelector('p');
    return {
      head:   sec.querySelector('h1,h2').textContent.trim(),
      body:   p ? p.textContent.trim() : '',
      key:    sec.dataset.key || '',
      /* Per-beat timing, when a beat needs it. Everything else uses the
         defaults below. */
      win:    { in: pair(sec.dataset.in, [0.02, 0.21]),
                out: pair(sec.dataset.out, [0.76, 0.22]) },
      finale: sec.hasAttribute('data-finale'),
      lines:  [...sec.querySelectorAll('.ln')].map(e => e.textContent.trim()),
    };
  });

  const PER = 2.0;                       // viewport-heights of scroll per section
  /* Scroll the FILM does not use, appended after it. The last thing the page
     does is hold a still frame while the one action it offers surfaces, and
     that beat is made of scroll — there is no other clock the reader controls.
     Six sections' worth of scroll was nowhere near enough of it: the mark
     stops closing with only a fifth of the last section left, and that fifth
     has to carry a pause long enough to read as an ending, the button's
     arrival, and a little air after it.

     Note that this does not slow the film down. `film` below is the document
     height MINUS this tail, so every section still gets exactly PER
     viewport-heights and every cue lands where it always did; the tail is
     purely extra distance at the bottom, where nothing is moving anyway. */
  const TAIL = 0.71;                     // viewport-heights, after the film ends

  /* THE FILM'S LENGTH IS NOT A FUNCTION OF THE LIVE VIEWPORT.
     ------------------------------------------------------------------------
     The body's height is set once, in `vh`, which on a phone resolves to the
     LARGE viewport — the one with the browser chrome retracted — and never
     changes again. innerHeight does: the URL bar hides and returns as you
     scroll, by 56-81px. So `film = const - TAIL*innerHeight` moved under the
     reader, and with it `p = scrollY/film`, which is the clock EVERYTHING on
     this page is a pure function of.

     Sixteen separate defects were that one line. The toolbar returning at the
     bottom took the closing link from opacity 1.000 to 0.137 with no scroll
     at all, and put full opacity permanently out of reach (it needs the
     chrome under ~25 CSS px; iOS Safari's bar is 81). A resize near a section
     boundary flipped the section index with dy = 0. Rotation and folding
     rescaled the clock by up to 2.16x.

     So the film is measured against a latched large-viewport height instead.
     It is re-latched only when the WIDTH changes, which is what distinguishes
     a real orientation change from the toolbar sliding.

     NOT `dvh`: measured, that is six times worse, because the document's own
     height then tracks the chrome too. The film's length simply must not be a
     function of the live viewport. */
  let LVH = 0;
  function latchLVH() {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;top:0;left:0;width:0;height:100lvh;' +
                      'visibility:hidden;pointer-events:none';
    document.body.appendChild(p);
    LVH = p.offsetHeight || innerHeight;   // 100lvh is unsupported pre-2022
    p.remove();
  }
  latchLVH();
  const filmLen = () => Math.max((S.length * PER - 1) * LVH, 1);

  const clamp    = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const outCubic = v => 1 - Math.pow(1 - v, 3);
  /* Quadratic on the way out, cubic in. A cubic exit spends most of its time
     doing nothing visible, so the copy sat still and then lurched off in the
     last few percent of the section. */
  const inQuad = v => v * v;
  const lerp   = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

  /* The palette lives in CSS so the page and the field can never disagree
     about it; the renderer is handed whatever the stylesheet resolved. */
  const hex3 = h => {
    const v = h.trim().replace('#', '');
    const n = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
  };
  let INK = [1, 1, 1], INK2 = [1, 1, 1], PAPER = [0, 0, 0], TINT = [0, 0, 0];
  /* 1 where the ground is PAPER and 0 where it is a room, read off the paper's
     own luminance rather than off the variant name — a palette that inverts
     the ground should not also have to remember to say so. Smoothed rather
     than a threshold so a genuinely mid ground lands between the two models
     instead of snapping to whichever side of 0.5 it fell on. */
  let PRINT = 0;
  /* The writing's own two ends. TYPE_A is what the type is while the film is
     toned; TYPE_B is where it lands, which is the same place the MARKS land —
     --field-end. Tying it to that token rather than to a literal white is what
     makes this correct in all three variants without a branch: on the two pale
     grounds --ink already IS --field-end, so the travel is a no-op. */
  let TYPE_A = '#ffffff', TYPE_B = '#ffffff';
  /* The drop shadow is the indigo variant's alone — see uShadow in the
     renderer. Read once: the variant cannot change without a reload. */
  const SHADOW = document.documentElement.dataset.v ? 0 : 1;
  /* The toning is variation 4's alone to lose. uShadow already goes off for
     every variation but the first, because a dark halo on light paper is a
     smudge; the RAMP is a separate question, and the two pale grounds keep
     theirs. Read once: the variation cannot change without a reload. */
  const TONE   = /^[34]$/.test(document.documentElement.dataset.v || '') ? 0 : 1;
  const palette = () => {
    const cs = getComputedStyle(document.documentElement);
    /* --field, not --ink: the film's colour and the writing's colour are
       allowed to differ, and in variation 3 they do. */
    INK   = hex3(cs.getPropertyValue('--field') || '#ffffff');
    INK2  = hex3(cs.getPropertyValue('--field-end') || cs.getPropertyValue('--field') || '#ffffff');
    PAPER = hex3(cs.getPropertyValue('--paper') || '#000000');
    /* Falls back to the paper itself, which makes the tint a no-op rather
       than a guess if a variant does not define one. */
    TINT  = hex3(cs.getPropertyValue('--tint') || cs.getPropertyValue('--paper') || '#000000');
    /* Read from the ROOT rule, not from the element we are about to write
       --ink-live onto — reading back our own output would ratchet the type
       toward white a frame at a time and never come back. */
    TYPE_A = (cs.getPropertyValue('--ink') || '#ffffff').trim();
    TYPE_B = (cs.getPropertyValue('--field-end') || TYPE_A).trim();
    const pl = 0.2126 * PAPER[0] + 0.7152 * PAPER[1] + 0.0722 * PAPER[2];
    PRINT = clamp((pl - 0.25) / 0.30);
    PRINT = PRINT * PRINT * (3 - 2 * PRINT);
  };

  /* WHERE THE MARK ENDS UP, as the field publishes it. Three things in this
     file are pinned to the close — the resolve window's far edge, the line
     that has to stay clear of the mark, and the flag that shuts the ambient
     loop down once the frame is final — and all three used to carry 0.965 as
     their own literal. The field owns that geometry, and the note above CLOSE
     in ptl-field.js records what happened last time the two came apart.

     The fallback only matters if ptl-field.js failed to load, in which case
     there is no mark to clear, nothing to draw, and no value to be wrong. */
  const C = (typeof PTLField !== 'undefined' && PTLField.CLOSE) ||
            { FROM: 0.86, TO: 0.965, R: 0.27, DR: 0.24, CY: 0.02, BW: 0.045, ASPECT: 1.78 };

  /* THE RESOLVE CLOCK — the one the shader used to own.
     ------------------------------------------------------------------------
     It moved up here because the TYPE resolves on it too, and two languages
     agree on a curve only if one of them does the arithmetic. Both edges are
     named positions in the argument rather than durations: it opens at the top
     of PRICE — "Predictive Text Labs teaches machines to price uncertainty so
     they can commit to decisions that matter.", the line that names what the
     company actually does — and closes exactly where the mark finishes
     closing, so the picture and the writing arrive at the same instant.

     Four beats of toned film, then it resolves. The argument is told in the
     warm; only the answer is white. It is a short window for that reason —
     0.30 of the page against 0.47 when it opened a beat earlier — so the same
     K reads faster here than it did there.

     An ease-OUT: it leaves at speed and spends the rest of the window
     arriving. K is the whole of the aggression — 2 is the ordinary ease-out,
     4 was too abrupt to read as a settle. */
  /* EXCEPT ON THE BLUE, WHICH KEEPS THE OLD WINDOW.
     Everything above is why the window opens where it does on the dark
     variant: the argument is told in the warm and only the answer is white, so
     the drain has to start early enough to be a passage rather than a switch.
     The blue is not making that argument. Its colour is the state of the
     thing being described — "the whole argument is blue and the colour
     resolves at exactly the moment the form does" — so draining it from the
     fourth beat spends it before the section that most wants it. That variant
     therefore keeps what it had before the clock moved into JS: smoothstep
     over the CLOSING of the mark, 0.885 to 0.985, symmetric, and late.

     Read once — the variation cannot change without a reload. */
  const LATE  = document.documentElement.dataset.v === '3';
  const RES_A = LATE ? 0.885 : 4 / 6;
  const RES_B = LATE ? 0.985 : C.TO;
  const RES_K = 2.5;
  const resolveAt = (g) => {
    const u = clamp((g - RES_A) / (RES_B - RES_A));
    /* The old one was a smoothstep, which eases in AND out; the dark
       variant's leaves at speed and coasts. Keeping both rather than fitting
       one curve to two intentions. */
    return LATE ? u * u * (3 - 2 * u) : 1 - Math.pow(1 - u, RES_K);
  };

  const mixHex = (a, b, t) => {
    const A = hex3(a), B = hex3(b);
    const c = i => Math.round((A[i] + (B[i] - A[i]) * t) * 255);
    return 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
  };

  /* Both preferences are live, not read once at load. Reduced motion in
     particular is a system-wide switch people flip while a page is open —
     often BECAUSE a page is moving — and a preference that only takes effect
     on the next reload is not much of a preference. The query objects are kept
     so they can be listened to; see the listeners further down, which sit
     below frame(). */
  const mqReduce  = matchMedia('(prefers-reduced-motion: reduce)');
  const mqPointer = matchMedia('(hover: hover) and (pointer: fine)');
  let reduce = mqReduce.matches;
  const copy   = document.getElementById('copy');
  const finEl  = document.getElementById('finale');
  const finA   = document.getElementById('finA');
  const finB   = document.getElementById('finB');
  const finC   = document.getElementById('finC');
  const cta    = document.getElementById('cta');
  const counter = document.getElementById('bn');
  /* The denominator was the last number on the page still written by hand,
     which meant adding a beat to the argument left the chrome quietly
     miscounting it. Same source as everything else now: the sections. */
  const total = document.getElementById('bt');
  if (total) total.textContent = String(S.length).padStart(2, '0');

  const line = (cls, text) => {
    const d = document.createElement('div');
    d.className = cls + ' fade';
    d.textContent = text;
    return d;
  };

  const blocks = S.map(s => {
    /* The finale lives outside .copy, which is anchored to the bottom margin.
       It needs the whole viewport to travel through, so it gets its own. */
    if (s.finale) {
      const [name, verb, claim] = s.lines;
      const l1 = line('l1', name), l2 = line('l2', verb), l3 = line('l3', '');
      /* The claim is the one line with structure: the words, then the caret,
         which is out of the centring by construction (see .l3 in the page). */
      const tw = document.createElement('span'); tw.className = 't'; tw.textContent = claim;
      const cur = document.createElement('i'); cur.className = 'cur';
      l3.append(tw, cur);
      finA.append(l1, l2); finB.append(l3);
      return { el: finEl, fin: true, l1, l2, l3, cur };
    }
    const d = document.createElement('div');
    d.className = 'blk';
    const h = document.createElement('h1'); h.className = 'kin'; h.textContent = s.head;
    d.appendChild(h);
    let p = null;
    if (s.body) {
      p = document.createElement('p'); p.className = 'kin'; p.textContent = s.body;
      d.appendChild(p);
    }
    copy.appendChild(d);
    return { el: d, head: h, body: p };
  });

  /* ---- kinetic type ------------------------------------------------------
     Resolve, then disintegrate — never travel. --sw is the sweep, which gives
     the reveal a direction; --mk is the mark size, which is the reveal itself.
     The sweep runs slightly ahead of the marks so the letterforms condense in
     behind it rather than switching on with it. */
  const MK = 12;
  function paint(el, res, sw) {
    if (!el) return;
    el.style.setProperty('--mk', (MK * res).toFixed(2) + 'px');
    el.style.setProperty('--sw', (sw * 210).toFixed(1) + '%');
  }
  function drive(el, t, delay, resolved, win) {
    if (!el) return;
    const [inAt, inLen] = win.in, [outAt, outLen] = win.out;
    /* `resolved` skips the entrance. The first section is the page's opening
       frame — the reader has not scrolled, so there is no gesture to respond
       to, and a reveal there just means the page loads with no words on it.
       It still disintegrates on the way out like every other section. */
    const inA  = resolved ? 1 : outCubic(clamp((t - delay - inAt) / inLen));
    const sw   = resolved ? 1 : outCubic(clamp((t - delay) / (inLen + 0.04)));
    const outA = inQuad(clamp((t - outAt - delay * 0.5) / outLen));
    paint(el, inA * (1 - outA), sw);
  }

  /* ---- the finale's choreography ----------------------------------------
     PIN is where the claim comes to rest, as a fraction of viewport height:
     clear of the mark at the moment it lands, and it does not move again as
     the mark keeps closing above it. GO is when the name and the verb stop
     riding with it and leave. */
  const FIN = {
    PIN:   0.586,
    CLEAR: 0.034,         // gap held below the mark's lower edge
    GAP:   1.10,          // the lockup's own internal gap, in rem
    /* The pair does not travel to the top of the frame and dissolve there. It
       lifts a little and goes, low, while it is still under the mark — a long
       climb left a ghost of the name legible at the very top of the page for
       most of the section, which reads as a leftover rather than an exit.
       LIFT is small on purpose; the fade does the work, the movement inflects
       it. */
    GO: 0.28, GO_LEN: 0.14, LIFT: 0.05,
    /* in / out windows per line: [start, length]. The claim never leaves. */
    IN:  [[0.00, 0.17], [0.045, 0.17], [0.095, 0.19]],
    OUT: [[0.28, 0.12], [0.30, 0.12]],
    /* The button waits for the film to be over. The mark stops closing at
       g = 0.965, which is t = 0.79 of this section, and the claim stops being
       pushed at the same instant — so that is the first moment there is a
       still frame to arrive into.

       What was missing at first was the BEAT afterwards: the button used to
       start arriving at 0.79 exactly, so the claim's stop and the button's
       entrance were the same event and neither read. Measured, the claim goes
       still at t = 0.786; the wait after it is now 0.473 of a section — 780px
       at a 900px frame, near enough a whole screen of scroll — in which the
       film has hit its wall and nothing whatsoever happens. That is the beat:
       the reader keeps scrolling, the page does not move, and only once that
       has plainly registered as an ending does the one action surface.

       This is why TAIL exists. A wait that long puts the start well past
       t = 1: there was not enough scroll left in the film to hold the pause
       AND let the button surface, so the page carries most of a frame of
       scroll the film does not use, and the button arrives on it. In the same
       units as t the tail runs to 1.387, so the button is fully in at 1.354
       with about 55px of scroll to spare underneath it. */
    CTA: [1.259, 0.095],
    CTA_RISE: 0.042,      // how far it floats up, as a fraction of the frame
    CTA_GAP: 1.4,         // below the claim, in rem, capped against short frames
  };
  const easeIn = u => u * u;             // accelerates out of frame

  let ha = 0, gap = 0, ctaGap = 0;
  const measure = () => {
    palette();
    /* The CSS default is 1 and .cta carries a transition, so on first entering
       the finale the link rendered at FULL opacity and faded back out over
       ~120ms — giving away, 2.15 viewport-heights early, the exact thing TAIL
       exists to withhold. Its opacity is entirely JS-driven; start it where it
       belongs. */
    if (cta && !cta.style.opacity) cta.style.opacity = '0';
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    ha  = finA.offsetHeight;
    gap = FIN.GAP * rem;
    /* Capped against the viewport as well as set in rem: on a landscape phone
       a fixed 1.4rem below the claim is a large share of the whole frame, so
       it also cannot exceed 3.75% of the height — the button has to fit under
       the claim without the pair being crushed. */
    ctaGap = Math.min(FIN.CTA_GAP * rem, innerHeight * 0.0375);
  };

  /* The mark's lower edge in screen px — the same arithmetic as form()'s
     radius track, restricted to the last section, where every track but the
     closing one has already reached its end value.

     The constants are C's, above — the field's, not this file's. */
  function markBottom(g, H) {
    const base = Math.max(H, innerWidth / C.ASPECT);
    const r = C.R - C.DR * smooth(C.FROM, C.TO, g);
    return 0.5 * H - C.CY * base + (r + C.BW) * base;
  }

  function finale(b, t, H, ct) {
    /* The claim does not follow a timed curve into the pin — it is HELD DOWN
       by the mark and released as the mark closes. A timed curve put it
       straight through the middle of the ring on the way up, which is
       unreadable and also a lie about what is happening: the words rise
       because the form is getting out of their way. Once the mark has closed
       past the pin, the constraint stops binding and the claim is pinned. */
    const g    = (S.length - 1 + t) / S.length;
    const rise = lerp(H * 1.16, H * 0.50, clamp(t / 0.30));   // the entrance only
    /* …but never so low that the claim runs off the bottom. On a landscape
       phone with the URL bar showing, markBottom is driven by `base` (the
       WIDTH there) while the pin is a share of the height, and the two
       disagreed enough to slice the closing line in half. */
    /* What has to fit BELOW the claim. Reserved statically, not as the button
       fades in: growing the reservation on arrival would drag the claim upward
       at the exact moment the frame is supposed to be still. On any ordinary
       viewport this never binds — the pin sits far above the clamp — so it
       costs nothing except on the short frames it exists for. */
    const tail = finC.offsetHeight + ctaGap;
    const bY   = Math.min(
      Math.max(rise, H * FIN.PIN, markBottom(g, H) + H * FIN.CLEAR),
      H - finB.offsetHeight - tail - H * 0.045
    );
    const go   = easeIn(clamp((t - FIN.GO) / FIN.GO_LEN)) * H * FIN.LIFT;
    finB.style.transform = `translate(-50%,${bY.toFixed(1)}px)`;
    finA.style.transform = `translate(-50%,${(bY - gap - ha - go).toFixed(1)}px)`;
    finC.style.transform =
      `translate(-50%,${(bY + finB.offsetHeight + ctaGap).toFixed(1)}px)`;

    if (reduce) {
      /* Static, fully readable, clear of the closing mark — and the button is
         simply present rather than arriving, since its arrival is the motion. */
      /* The same floor the animated branch enforces. Without it this branch
         never read markBottom at all and set the name line 26px inside the
         closed ring (71px in landscape), printing serif type onto the mark's
         own dots. */
      const rY = Math.min(
        Math.max(H * 0.70 - tail * 0.5,
                 markBottom(1, H) + H * FIN.CLEAR + gap + ha),
        H - finB.offsetHeight - tail - H * 0.045);
      finB.style.transform = `translate(-50%,${rY.toFixed(1)}px)`;
      finA.style.transform = `translate(-50%,${(rY - gap - ha).toFixed(1)}px)`;
      finC.style.transform =
        `translate(-50%,${(rY + finB.offsetHeight + ctaGap).toFixed(1)}px)`;
      for (const el of [b.l1, b.l2, b.l3]) fadeLine(el, 1, 0, H);
      /* The button is simply present: its arrival IS the motion. */
      cta.style.opacity = '1';
      cta.style.transform = 'none';
      cta.style.pointerEvents = 'auto';
      /* AND IT HAS TO BE LIVE. inert is set in exactly one place — floatCta,
         which this branch returns before reaching — so a reader who scrolls
         into the finale with motion on (inert true, the link not yet faded up)
         and THEN turns reduce on was handed a button at full opacity, with
         pointer-events auto, that could not be clicked, tapped or focused:
         inert had nothing left to clear it. The page's only action, dead,
         under the one preference that most needs it to be simple.

         ctaU and ctaSettling go with it. Leaving ctaSettling true strands
         tick()'s `arriving` re-arm permanently high — an unbounded rAF running
         two full-screen GL passes a frame on the last screen, under the exact
         preference the still-frame exists to honour. */
      cta.inert = false;
      ctaU = 1;
      ctaSettling = false;
      return;
    }
    const ins = FIN.IN, out = FIN.OUT;
    fadeLine(b.l1, outCubic(clamp((t - ins[0][0]) / ins[0][1])),
                   inQuad  (clamp((t - out[0][0]) / out[0][1])), H);
    fadeLine(b.l2, outCubic(clamp((t - ins[1][0]) / ins[1][1])),
                   inQuad  (clamp((t - out[1][0]) / out[1][1])), H);
    fadeLine(b.l3, outCubic(clamp((t - ins[2][0]) / ins[2][1])), 0, H);
    floatCta(ct, H);
  }

  /* The button's own arrival, which is not fadeLine's. The lockup's lines come
     in through a mask wipe because they are type resolving out of the field;
     the button is an object that appears once the argument is over, and a wipe
     read as one more flourish on a frame that is supposed to have stopped
     moving. Opacity and a rise, on a smoothstep so it is gentle at both ends
     rather than launching and braking. */
  let ctaU = 0, ctaSettling = false, ctaTs = 0;
  function floatCta(t, H) {
    if (!cta) return;
    const target = smooth(FIN.CTA[0], FIN.CTA[0] + FIN.CTA[1], t);
    /* Rate-limited HERE rather than by a CSS transition. This function drives
       the opacity and the rise from one number, but only opacity was
       transitioned — so under a fling the transform snapped to its final value
       while CSS was still easing the fade, and 0.0px of the 39px rise survived
       to the frame where the link became half-visible. The arrival was not one
       at any realistic swipe speed, and it ran backwards too. This guarantees
       ~0.37s of rise-and-fade however hard the flick is, keeps both
       properties on one clock, and settles deterministically both ways. */
    /* Per second, not per frame — the same correction the ambient clock
       above needed. Both rates were tuned against 60Hz, so they stay written
       in 60ths and are scaled by the time actually elapsed; on a 120Hz screen
       the arrival was running at double speed, which is the flourish the rate
       limit exists to prevent. Clamped, because this is driven from the
       scroll path as well, and a flick after a pause would otherwise hand it
       the whole pause in one step. */
    const now = performance.now();
    const k = ctaTs ? Math.min((now - ctaTs) / 1000, 0.05) * 60 : 1;
    ctaTs = now;
    ctaU = target < ctaU ? Math.max(target, ctaU - 0.09 * k)
                         : Math.min(target, ctaU + 0.06 * k);
    /* One flag, set from the only place that knows. Deriving this at the call
       site got it wrong twice: `ctaU > 0` is false on the very first frame of
       an arrival, and the finale's `.on` class is not on the element this
       file holds — so the loop shut down before the link had finished coming
       in, and it stalled wherever the last frame left it (0.30, 0.72). */
    ctaSettling = ctaU !== target;
    /* The arrival has to be able to finish on its own. Past CLOSE.TO the
       ambient loop deliberately shuts down, so without this the link stalled
       wherever the last scroll frame left it — the rate limit turned into a
       permanent half-fade. */
    if (ctaU !== target) tick();
    const u = ctaU;
    cta.style.opacity = u.toFixed(3);
    cta.style.transform = `translateY(${((1 - u) * H * FIN.CTA_RISE).toFixed(1)}px)`;
    /* Gated at half, not at 0.05: below that the link is under 4.5:1 and was
       a live 105x40 target the reader could not see. */
    cta.style.pointerEvents = u > 0.5 ? 'auto' : 'none';
    cta.inert = u <= 0.5;
  }

  /* One line's arrival and departure: mask, opacity and a small travel of its
     own, all on the same clock. The travel is per-line and additive to the
     group's — it is what stops three simultaneous fades reading as one block
     switching on. */
  function fadeLine(el, inU, outU, H) {
    if (!el) return;
    el.style.setProperty('--rv', inU.toFixed(3));
    el.style.setProperty('--ex', outU.toFixed(3));
    const a = inU * (1 - outU);
    el.style.opacity = a.toFixed(3);
    /* A faded line is still a box. Left hit-testing it would put an I-beam
       over an empty band of the closing frame — the name and the verb leave
       but their boxes do not — so the pointer is handed back only while there
       is something legible to put a cursor in. */
    el.style.pointerEvents = a > 0.05 ? 'auto' : 'none';
    el.style.transform =
      `translateY(${((1 - inU) * H * 0.030 - outU * H * 0.026).toFixed(1)}px)`;
  }

  /* ---- the pointer -------------------------------------------------------
     Only the closing mark answers it, and only once it has closed. `tgt` is
     where the pointer is, `cur` is where the light actually is; the light
     chases at a fixed rate per frame so a flick of the wrist is a sweep rather
     than a jump. Coordinates are converted into the shader's own uv space,
     including its long-side normalisation, so the light direction means the
     same thing at any aspect ratio.

     Disabled outright under prefers-reduced-motion and on devices with no
     hovering pointer, where there is nothing to answer and the mark should
     simply be lit head-on. */
  let POINTER = !reduce && mqPointer.matches;
  const tgt = [0, 0], cur = [0, 0];
  const clampAxis = v => (v < -0.9 ? -0.9 : v > 0.9 ? 0.9 : v);
  let act = 0;

  /* Registered unconditionally and gated inside, because POINTER can turn on
     later — a tablet gains a mouse, or reduced motion is switched off — and a
     listener that was never attached cannot be attached retroactively from the
     media query's own handler without more bookkeeping than the check costs. */
  /* THE CARET SLEEPS, AND IT HAS TO BE ABLE TO WAKE.
     ------------------------------------------------------------------------
     The blink is capped at twelve iterations, which is deliberate: a 2x22px
     block toggling forever measured as 97% of the closing screen's remaining
     power draw, on the one screen the reader is meant to sit on. What was
     missing is the other half of that bargain. Twelve iterations is 12.7
     seconds, after which the animation FINISHES and holds its base opacity —
     which is 1 — so the caret ends as a solid lit block and stays that way
     for the rest of the visit. Measured: last toggle at 10.91s, no animations
     on the element at 17s. A reader who sits with the page for a quarter of a
     minute is looking at a cursor that has stopped, and a cursor that has
     stopped reads as broken rather than as finished.

     So it sleeps only while nothing is happening, and any sign of a reader
     starts it again. The getAnimations() check is what keeps this cheap: while
     the blink is still running this returns early and costs nothing, and the
     forced reflow — the only way to restart a CSS animation — happens at most
     once per idle period rather than once per event.

     Under reduced motion the stylesheet removes the animation outright, so
     there is nothing to wake and trying would force a reflow on every mouse
     move for no result. */
  function wakeCaret() {
    if (reduce) return;
    const cur = blocks[blocks.length - 1] && blocks[blocks.length - 1].cur;
    if (!cur || !cur.isConnected) return;
    if (cur.getAnimations().length) return;      // still blinking; leave it be
    cur.style.animation = 'none';
    void cur.offsetWidth;                        // reflow, or the restart is a no-op
    cur.style.animation = '';
  }

  addEventListener('pointermove', e => {
    wakeCaret();
    if (!POINTER) return;
    const base = Math.max(innerHeight, innerWidth / C.ASPECT);
    tgt[0] = clampAxis((e.clientX - innerWidth  * 0.5) / base);
    tgt[1] = clampAxis((innerHeight * 0.5 - e.clientY) / base);
    if (act > 0.001) tick();
  }, { passive: true });

  /* ---- the ambient clock -------------------------------------------------
     Scroll is no longer the ONLY clock. It is still the only thing that moves
     the argument — every position, every beat, the whole composition remains a
     pure function of scrollY, and that has not changed — but the field now
     breathes on its own underneath it, so a page nobody is touching is alive
     rather than a screenshot.

     The two clocks are deliberately different KINDS of thing. Scroll drives
     structure and is exact and reversible; this drives texture only (mark size,
     nothing else — see the shader) and is monotonic. Nothing that decides where
     a word sits reads it, which is why it cannot desynchronise anything: at
     worst the halftone is a few frames further through a sine.

     Scrolling makes it run faster. `vel` is scroll distance in viewport-heights
     accumulated since the last frame and decayed continuously, so the rate
     answers to how hard you are moving rather than to whether an event fired —
     it stays lifted through a flick and settles back on its own. */
  const AMB_IDLE = 1.0;    // clock seconds per real second, untouched
  const AMB_GAIN = 5.5;    // extra, at full scroll speed
  const AMB_DECAY = 0.86;  // how fast the boost bleeds off, per 60th of a second
  let clock = 0, lastTs = 0, vel = 0, lastY = 0;
  /* Ambient motion is motion, so prefers-reduced-motion turns it off outright
     and the page goes back to being driven by scroll alone.

     …and so does having nothing to move. The breathe reaches exactly one
     thing, the size of the halftone marks, so with no renderer mounted — no
     WebGL2, or ptl-field.js missing — the loop was holding the compositor
     open at 60fps to advance a clock nothing reads and redraw type that only
     scroll can move. That is the same waste `still` exists to stop, on the
     machines least able to afford it. Scroll, the pointer and the link's
     arrival all keep their own paths into the loop, so nothing that can still
     move stops moving.

     A field that died with its context is the same case: draw() returns
     immediately after that, so the loop would be spinning against a picture
     that can no longer change.

     `field` is declared below, after the mount: this is only ever CALLED from
     a frame, and the first frame is scheduled at the foot of the file. */
  const ambient = () => (reduce || !field || field.isDead() ? 0 : 1);

  /* One frame loop, for everything that is not scroll position: the ambient
     clock and the pointer light easing toward the cursor. It runs continuously
     while there is ambient motion to draw, and otherwise only while the light
     is still settling — a page with reduced motion and no pointer holds the
     compositor open exactly as little as it did before. */
  let ticking = 0;
  function tick() {
    if (ticking) return;
    ticking = requestAnimationFrame(function step(ts) {
      ticking = 0;
      /* Clamped, because a backgrounded tab hands back one enormous delta on
         return and the field would jump a second and a half of sine. */
      /* The clamp was written for the tab-return delta, but applied to every
         frame it DILATED TIME on exactly the devices already struggling: at
         15fps the ambient clock ran at 0.72 s/s. Only a genuinely absurd gap
         is a returning tab; everything else is a slow frame and should count
         for what it was. */
      const raw = lastTs ? (ts - lastTs) / 1000 : 0.016;
      const dt  = raw > 0.5 ? 0.016 : Math.min(raw, 0.25);
      lastTs = ts;
      if (ambient()) {
        vel *= Math.pow(AMB_DECAY, dt * 60);   // per second, not per frame
        clock += dt * (AMB_IDLE + AMB_GAIN * Math.min(vel, 1.4));
      }
      const dx = tgt[0] - cur[0], dy = tgt[1] - cur[1];
      /* The chase rate eases on distance too: near the mark the light is
         attentive, far from it the light is lazy. Same idea as the shader's
         amplitude falloff, on the time axis instead of the space one — moving
         about the far edges of the page should not whip the terminator. */
      const dist = Math.hypot(tgt[0], tgt[1] - 0.02);
      const rate = 0.036 + 0.048 * (1 - Math.min(dist / 0.9, 1));
      cur[0] += dx * rate;
      cur[1] += dy * rate;
      render();
      const settling = act > 0.001 && (Math.abs(dx) > 0.0004 || Math.abs(dy) > 0.0004);
      /* document.hidden: a hidden tab gets no frames anyway in every current
         browser, but asking for them is still a promise to burn a core if one
         ever obliges. */
      /* ctaU is rate-limited, so it can still be travelling after scroll has
         stopped: a flick ending mid-band would otherwise strand the link
         half-faded forever. */
      const arriving = ctaSettling;
      if ((ambient() && !still && !document.hidden) || settling || arriving) tick();
    });
  }
  /* Restart the loop when the tab comes back, and reset the timestamp so the
     first frame after does not carry the whole absence as one delta. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    lastTs = 0;
    tick();
  });

  /* ---- the frame ---------------------------------------------------------
     `typeof`, not a truthiness check: if the request for ptl-field.js failed,
     PTLField is not a global holding undefined, it is an undeclared name, and
     `PTLField && …` throws a ReferenceError rather than short-circuiting. It
     threw here, mid-file, which is survivable — the no-js document was still
     in place — except that the body had already been stretched to the film's
     full height on the way past, leaving the fallback as one screen of words
     at the top of a very long empty page. Nothing is committed to now until
     the mount has been attempted. */
  const field = typeof PTLField !== 'undefined'
    ? PTLField.mount(document.getElementById('c'), { mode: 'form' })
    : null;
  /* A null field is not a failure worth falling back over: it means WebGL2 is
     unavailable (or the script is missing), and the choreographed type carries
     the whole argument on its own against a plain ground. What the fallback
     document exists for is the case where none of THIS runs. */
  /* A restored context rebuilds the program but nothing asks it to draw, and
     under reduced motion the ambient loop has already self-terminated — so
     the film simply vanished until the reader happened to scroll. A LOST
     context is the mirror: the last frame freezes and reads as truth. Both
     directions want exactly one frame. */
  {
    const cv = document.getElementById('c');
    if (field && cv) for (const ev of ['webglcontextrestored', 'webglcontextlost']) {
      cv.addEventListener(ev, () => { remeasure = true; frame(); });
    }
  }
  document.body.classList.remove('no-js');
  document.body.style.height = ((S.length * PER + TAIL) * 100) + 'vh';
  let raf = 0, shown = -1, remeasure = false, lastW = innerWidth;
  /* True once the film has finished closing. Past PTLField.CLOSE.TO the
     fragment program is a pure function of constants — the ambient term is
     multiplied by (1 - smoothstep(0.86, 0.965, g)), exactly zero there, and
     the pointer light never runs on a phone. Verified by hashing the drawing
     buffer: 124 consecutive draws, ONE distinct buffer. So the last 1.1
     viewport-heights were 60 identical fullscreen shader passes a second,
     forever, on the screen the reader is meant to sit still on — 82% of that
     frame's power draw, provably wasted. Keyed to the shader's own constant
     so the two cannot drift. */
  let still = false;

  function render() {
    const max  = document.documentElement.scrollHeight - innerHeight;
    /* The film's own scroll, which is the document minus the tail. Everything
       the film does is a function of THIS, so the tail cannot stretch a single
       cue: past `film`, p is pinned at 1 and every track is already at its end
       value. */
    const film = filmLen();
    /* Clamped, because scrollY is not bounded by the document: Safari's elastic
       overscroll reports negative at the top and past `max` at the bottom, and
       an unclamped p drove the section index to -1, where blocks[-1] is
       undefined and this function threw on every frame of the bounce. */
    const p    = clamp(window.scrollY / film);
    const span = 1 / S.length;
    still = p >= C.TO;
    const idx  = Math.min(S.length - 1, Math.floor(p / span));
    const t    = (p - idx * span) / span;
    /* The button's clock: t while the film is running, and then t past 1,
       measured in the same units, through the tail. Nothing else reads it — the
       whole point is that the frame is held while this one number keeps
       moving. */
    const tailU = clamp((window.scrollY - film) / Math.max(max - film, 1));
    const ct    = t + tailU * (TAIL * S.length / (S.length * PER - 1));

    if (idx !== shown) {
      blocks.forEach((b, i) => b.el.classList.toggle('on', i === idx));
      counter.textContent = String(idx + 1).padStart(2, '0');
      shown = idx;
    }
    const b = blocks[idx];
    if (b.fin) {
      finale(b, t, innerHeight, ct);
    } else if (reduce) {
      /* Reduced motion: fully resolved, no sweep. The argument IS the page, so
         it has to be completely readable with every animation disabled. */
      for (const el of [b.head, b.body]) {
        if (!el) continue;
        el.style.setProperty('--mk', MK + 'px');
        el.style.setProperty('--sw', '210%');
      }
    } else {
      const open = idx === 0;               // opening frame: already resolved
      drive(b.head, t, 0, open, S[idx].win);
      drive(b.body, t, 0.06, open, S[idx].win);   // body resolves just behind its headline
    }

    /* The mark only answers the pointer once it has actually closed — before
       that it is still a ring with a lattice around it, and lighting that
       would be lighting a diagram. */
    act = POINTER ? smooth(0.88, 0.955, p) : 0;

    /* The writing resolves with the picture. Set on the root so every rule
       that reads --ink-live moves at once — the claim, the lockup, the caret
       and the CTA — rather than each being animated on its own timetable and
       drifting apart. Under reduce the film is held at its end, so the type is
       held at its end too. */
    const res = resolveAt(reduce ? 1 : p);
    document.documentElement.style.setProperty('--ink-live', mixHex(TYPE_A, TYPE_B, res));

    /* isDead() means the context came back and would not take the program —
       draw() would return immediately anyway, but there is no reason to build
       it an options object sixty times a second to be ignored. */
    if (field && !field.isDead()) field.draw(t, {
      /* Under reduce the mark is HELD CLOSED. It was still morphing with
         scroll — only the ambient clock was disabled — and the closing ring's
         bright arc swept up through a lockup that reduce pins in place, which
         put 86% of the verb's ink under 4.5:1. */
      g: reduce ? 1 : p, section: idx, word: S[idx].key,
      cell: 12, gap: 0.12, gain: 1.0, fov: 0.70, shadow: SHADOW, tone: TONE,
      print: PRINT,
      mouse: cur, act, ink: INK, ink2: INK2, paper: PAPER, tint: TINT,
      time: clock, amb: ambient(), resolve: res,
    });
  }

  function frame() {
    raf = 0;
    if (remeasure) {
      remeasure = false;
      measure();
      if (keepP != null) {
        const max1 = document.documentElement.scrollHeight - innerHeight;
        const f1 = filmLen();
        window.scrollTo(0, Math.min(max1, f1 * keepP + keepTail * Math.max(max1 - f1, 0)));
        keepP = null;
      }
    }
    render();
    if (act > 0.001) tick();
  }

  addEventListener('scroll', () => {
    /* Distance, not events: a trackpad fires far more scroll events per pixel
       than a wheel does, and rating the boost by event count would make the
       same gesture mean different things on different hardware. */
    vel += Math.abs(window.scrollY - lastY) / Math.max(innerHeight, 1);
    lastY = window.scrollY;
    wakeCaret();
    /* When the ambient loop is running it is already drawing every frame, so
       scheduling the scroll slot as well would render the same frame twice. */
    if (ambient() && !still) { tick(); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  /* Coalesced through the same rAF slot as scroll. Dragging a window edge
     fires resize continuously, and each one used to force a synchronous
     measure — two forced layouts — plus a full GL draw, while also clearing
     `raf` out from under a scroll frame that was already scheduled. The flag
     is what keeps the measurement from being lost when that slot is taken. */
  /* A resize preserves scrollY in both engines, so the reader's PIXEL
     survived a rotation and their place in the argument did not — up to 3.2
     sections in one gesture, and a fold-and-unfold destroyed the closing link
     outright. Capture the dimensionless position before the layout changes
     and restore it after; every layer that paints is position:fixed, so
     re-anchoring the scroll is visually invisible. */
  let keepP = null, keepTail = 0;
  addEventListener('resize', () => {
    if (innerWidth !== lastW) { lastW = innerWidth; latchLVH(); }
    const max0 = document.documentElement.scrollHeight - innerHeight;
    const f0 = filmLen();
    keepP = clamp(window.scrollY / f0);
    keepTail = Math.max(0, window.scrollY - f0) / Math.max(max0 - f0, 1);
    remeasure = true;
    if (!raf) raf = requestAnimationFrame(frame);
  });

  /* Live preferences. Recomputing POINTER from the query rather than caching
     its `.matches` keeps the two in step: reduced motion turns the pointer
     light off regardless of what hardware is attached. */
  const prefs = () => {
    const was = reduce;
    reduce  = mqReduce.matches;
    POINTER = !reduce && mqPointer.matches;
    if (!POINTER) { tgt[0] = tgt[1] = cur[0] = cur[1] = 0; }
    frame();
    /* Turning reduce back OFF left the loop dead for the rest of the visit:
       frame() only re-arms via `act > 0.001`, and act is identically 0 on a
       coarse pointer. tick()'s step self-terminates when ambient() is 0, so
       this is safe in the forward direction too — it costs one frame. */
    if (was && !reduce) tick();
  };
  mqReduce.addEventListener('change', prefs);
  mqPointer.addEventListener('change', prefs);
  /* Measured, not assumed: the lockup's joined spacing is whatever normal flow
     would have given it, which is only knowable once Cormorant has loaded. */
  document.fonts.ready.then(() => { measure(); frame(); });
  measure();
  lastY = window.scrollY;
  frame();
  tick();          // and the field starts breathing, with nobody having done anything

  /* Deterministic seeking, for tests and for screenshots. `t` is the film's,
     so AT(i, 1) is the last frame of section i however much dead scroll the
     page carries after it; on the last section t may run past 1, into the
     tail, up to 1 + TAIL * S.length * H / film. */
  window.AT = (i, t) => {
    const max  = document.documentElement.scrollHeight - innerHeight;
    const film = filmLen();
    window.scrollTo(0, Math.min(max, film * ((i + t) / S.length)));
    render();
  };
})();
