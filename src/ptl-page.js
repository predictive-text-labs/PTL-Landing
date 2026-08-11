/* ============================================================================
   PTL — the page
   ----------------------------------------------------------------------------
   Six beats of an argument choreographed against scroll over a field drawn by
   ptl-field.js. Every position is a pure function of scrollY: nothing to seek
   or decode, and scrubbing backwards runs the film backwards exactly.

   A second clock drives texture only, and cannot disagree with the first —
   see "the ambient clock" below.

   The copy is NOT held here. It lives in index.html as semantic HTML and is
   read out of the DOM, so crawlers, link previews and screen readers get the
   argument even though no visible word is in the source at that position.
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
      /* Per-beat timing; everything else takes the defaults. */
      win:    { in: pair(sec.dataset.in, [0.02, 0.21]),
                out: pair(sec.dataset.out, [0.76, 0.22]) },
      finale: sec.hasAttribute('data-finale'),
      lines:  [...sec.querySelectorAll('.ln')].map(e => e.textContent.trim()),
    };
  });

  const PER = 2.0;                       // viewport-heights of scroll per section
  /* Scroll the FILM does not use, appended after it: the page ends on a held
     still frame while the one action it offers surfaces, and that beat is made
     of scroll because the reader controls no other clock. It does not slow the
     film — `film` below is the document height MINUS this, so every cue lands
     where it always did and the tail is dead distance at the bottom. */
  const TAIL = 0.71;                     // viewport-heights, after the film ends

  /* THE FILM'S LENGTH IS NOT A FUNCTION OF THE LIVE VIEWPORT.
     ------------------------------------------------------------------------
     The body's height is set once in `vh` — on a phone the LARGE viewport — and
     never changes. innerHeight does: the URL bar hides and returns by 56-81px.
     A film measured against it moves under the reader, and with it
     `p = scrollY/film`, the clock EVERYTHING here is a pure function of.
     Sixteen defects were that one line: the closing link fell to opacity 0.137
     with no scroll at all and full opacity became unreachable; a resize flipped
     the section index with dy = 0; rotation rescaled the clock by up to 2.16x.

     So it is measured against a latched large-viewport height, re-latched only
     on a WIDTH change — which is what tells a real orientation change from the
     toolbar sliding. NOT `dvh`: six times worse measured, because the
     document's own height then tracks the chrome too. */
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

  /* THESE ARE PTLField'S TOO, AND THIS FILE KEEPS ITS OWN ON PURPOSE.
     about.html takes clamp/lerp/smooth/hex3/mixHex off PTLField, because nothing
     in that file runs without the field. This one does: with no renderer the
     choreographed type still carries the whole argument against a plain ground
     (see the mount below), and every line of that path goes through clamp and
     mixHex. Sourcing them from a script that may not have loaded would trade a
     designed-for degradation for a page that throws — which it has done before,
     after `no-js` was already off the body. Keep the bodies identical to the
     ones in ptl-field.js; that is the only coupling here. */
  const clamp    = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const outCubic = v => 1 - Math.pow(1 - v, 3);
  /* Quadratic out, cubic in. A cubic exit spends most of its time doing nothing
     visible, so the copy sat still then lurched off in the last few percent. */
  const inQuad = v => v * v;
  const lerp   = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

  /* The palette lives in CSS so the page and the field cannot disagree about
     it; the renderer is handed whatever the stylesheet resolved. */
  const hex3 = h => {
    const v = (h || '').trim().replace('#', '');
    const n = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
  };
  let INK = [1, 1, 1], INK2 = [1, 1, 1], PAPER = [0, 0, 0], TINT = [0, 0, 0];
  /* The writing's two ends: TYPE_A while the film is toned, TYPE_B where it
     lands — --field-end, the same token the MARKS land on, so type and marks
     can never arrive at different whites. They DIFFER (--ink #f4eada against
     #ffffff), so the travel is real and mixHex below is load-bearing. */
  let TYPE_A = '#ffffff', TYPE_B = '#ffffff';
  const palette = () => {
    const cs = getComputedStyle(document.documentElement);
    /* --field, not --ink: the film's colour and the writing's are allowed to
       differ, and do — the film runs cream. Do not "fix" this to --ink. */
    INK   = hex3(cs.getPropertyValue('--field') || '#ffffff');
    INK2  = hex3(cs.getPropertyValue('--field-end') || cs.getPropertyValue('--field') || '#ffffff');
    PAPER = hex3(cs.getPropertyValue('--paper') || '#000000');
    TINT  = hex3(cs.getPropertyValue('--tint') || '#000000');
    /* Read from the ROOT rule, not the element we write --ink-live onto —
       reading back our own output would ratchet the type toward white a frame
       at a time and never come back. */
    TYPE_A = (cs.getPropertyValue('--ink') || '#ffffff').trim();
    TYPE_B = (cs.getPropertyValue('--field-end') || TYPE_A).trim();
  };

  /* WHERE THE MARK ENDS UP, as the field publishes it. The resolve window's far
     edge, the line that must stay clear of the mark and the flag that shuts the
     ambient loop down all read this; they each carried 0.965 as a literal once,
     and drifted. The field owns the geometry — see CLOSE in ptl-field.js. The
     fallback matters only if that file failed to load, when there is no mark to
     clear and no value to be wrong. */
  const C = (typeof PTLField !== 'undefined' && PTLField.CLOSE) ||
            { FROM: 0.86, TO: 0.965, R: 0.27, DR: 0.24, CY: 0.02, BW: 0.045, ASPECT: 1.78 };

  /* THE RESOLVE CLOCK — the one the shader used to own.
     ------------------------------------------------------------------------
     It lives here because the TYPE resolves on it too, and two languages agree
     on a curve only if one of them does the arithmetic. Both edges are named
     positions, not durations: it opens at the top of PRICE — the line that
     names what the company does — and closes exactly where the mark finishes
     closing, so picture and writing arrive together. Four beats of toned film,
     then the answer in white. K is the whole of the aggression: 2 is the
     ordinary ease-out, 4 was too abrupt to read as a settle. */
  const RES_A = 4 / 6;
  const RES_B = C.TO;
  const RES_K = 2.5;
  /* AND IT LANDS EARLIER ON A PHONE: the same window slid back to CLOSE where
     it used to open. In a small frame the colour and the depth blur are the
     loudest things present, and carrying them to the final mark made the ending
     out-shout the film instead of following it. The phone spends the colour by
     PRICE and the last two beats are already white. */
  const RES_SPAN = C.TO - 4 / 6;
  const resolveAt = (g) => {
    const a = phone ? 4 / 6 - RES_SPAN : RES_A;
    const b = phone ? 4 / 6 : RES_B;
    const u = clamp((g - a) / (b - a));
    /* Opposite curves for opposite windows. Wide is an ease-OUT: it leaves at
       speed and coasts into the close. The phone's is ease IN, the same
       exponent mirrored — its window lands two beats early, and an ease-out
       spent the colour before the reader had scrolled the beat it belongs to. */
    return phone ? Math.pow(u, RES_K)
                 : 1 - Math.pow(1 - u, RES_K);
  };

  const mixHex = (a, b, t) => {
    const A = hex3(a), B = hex3(b);
    const c = i => Math.round((A[i] + (B[i] - A[i]) * t) * 255);
    return 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
  };

  /* Both preferences are live, not read once: reduced motion is a system-wide
     switch people flip while a page is open, often BECAUSE it is moving. The
     query objects are kept so the listeners below frame() can attach. */
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
  /* The denominator was the last hand-written number on the page, so adding a
     beat left the chrome miscounting. Same source as everything else now. */
  const total = document.getElementById('bt');
  if (total) total.textContent = String(S.length).padStart(2, '0');

  const line = (cls, text) => {
    const d = document.createElement('div');
    d.className = cls + ' fade';
    d.textContent = text;
    return d;
  };

  const blocks = S.map(s => {
    /* The finale lives outside .copy, which is anchored to the bottom margin:
       it needs the whole viewport to travel through. */
    if (s.finale) {
      const [name, verb, claim] = s.lines;
      const l1 = line('l1', name), l2 = line('l2', verb), l3 = line('l3', '');
      /* The claim is the one line with structure: words, then the caret, which
         is out of the centring by construction (see .l3 in the page). */
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
     Resolve, then disintegrate — never travel. --mk is the mark size, which is
     the reveal itself; --sw is a sweep giving it direction, run slightly ahead
     so the letterforms condense in behind it rather than switch on with it. */
  const MK = 12;
  function paint(el, res, sw) {
    if (!el) return;
    el.style.setProperty('--mk', (MK * res).toFixed(2) + 'px');
    el.style.setProperty('--sw', (sw * 210).toFixed(1) + '%');
  }
  function drive(el, t, delay, resolved, win) {
    if (!el) return;
    const [inAt, inLen] = win.in, [outAt, outLen] = win.out;
    /* `resolved` skips the entrance: section one is the opening frame, the
       reader has not scrolled, and a reveal there just means the page loads
       with no words on it. It still disintegrates on the way out. */
    const inA  = resolved ? 1 : outCubic(clamp((t - delay - inAt) / inLen));
    const sw   = resolved ? 1 : outCubic(clamp((t - delay) / (inLen + 0.04)));
    const outA = inQuad(clamp((t - outAt - delay * 0.5) / outLen));
    paint(el, inA * (1 - outA), sw);
  }

  /* ---- the finale's choreography ----------------------------------------
     PIN is where the claim comes to rest, as a fraction of viewport height:
     clear of the mark when it lands, and it does not move again as the mark
     keeps closing above it. GO is when the name and verb stop riding with it. */
  const FIN = {
    PIN:   0.586,
    CLEAR: 0.034,         // gap held below the mark's lower edge
    GAP:   1.10,          // the lockup's own internal gap, in rem
    /* The pair lifts a little and goes, low, still under the mark. Climbing to
       the top of the frame left a ghost of the name legible up there for most
       of the section, reading as a leftover. LIFT is small: the fade works. */
    GO: 0.28, GO_LEN: 0.14, LIFT: 0.05,
    /* in / out windows per line: [start, length]. The claim never leaves. */
    IN:  [[0.00, 0.17], [0.045, 0.17], [0.095, 0.19]],
    OUT: [[0.28, 0.12], [0.30, 0.12]],
    /* The button waits for the film to be over. The mark stops closing at
       g = 0.965 (t = 0.786 here, measured) and the claim stops being pushed at
       the same instant — the first moment there is a still frame to arrive
       into. Then a BEAT: starting at 0.79 exactly made the claim's stop and the
       button's entrance one event, and neither read. The wait is now 0.473 of a
       section, near a whole screen of scroll in which nothing happens, and only
       once that has registered as an ending does the one action surface.

       This is why TAIL exists: a wait that long starts well past t = 1. In t's
       own units the tail runs to 1.387, so the button is fully in at 1.354 with
       about 55px of scroll to spare underneath it. */
    CTA: [1.259, 0.095],
    CTA_RISE: 0.042,      // how far it floats up, as a fraction of the frame
    CTA_GAP: 1.4,         // below the claim, in rem, capped against short frames
    /* How long the defocus dome takes to arrive under the lockup, same units.
       Fully there before the claim is (its window opens at 0.095), so the words
       land on a ground. Only the phone reads it; see .veil in the page. */
    DOME: 0.14,
  };
  const easeIn = u => u * u;             // accelerates out of frame

  let ha = 0, gap = 0, ctaGap = 0;
  /* Copy inside the mark, or under it. The stylesheet owns the breakpoint, next
     to the rule that moves the copy, so this reads the answer not the query. */
  let phone = false;
  const measure = () => {
    palette();
    phone = getComputedStyle(document.documentElement)
              .getPropertyValue('--phone').trim() === '1';
    /* The link's opacity is entirely JS-driven, and the CSS default is 1: on
       first entering the finale it rendered fully lit, giving away 2.15
       viewport-heights early the exact thing TAIL exists to withhold. */
    if (cta && !cta.style.opacity) cta.style.opacity = '0';
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    ha  = finA.offsetHeight;
    gap = FIN.GAP * rem;
    /* Capped against the viewport as well as set in rem: on a landscape phone
       1.4rem is a large share of the whole frame. */
    ctaGap = Math.min(FIN.CTA_GAP * rem, innerHeight * 0.0375);
    seatCopy();
  };

  /* THE COPY SITS IN THE CLEARING, NOT ON ITS FLOOR.
     ------------------------------------------------------------------------
     Bottom-anchoring aligns blocks by the bottom of whatever each contains — an
     edge nobody can see. At 1600x960 that put two beats' words 107px apart down
     the frame, and the fullest beat read as placed while the rest slipped.

     The film already answers where they belong: the shader clears a band at the
     bottom of the frame FOR this copy (that is FLOOR), and the copy's place is
     the middle of it, not its floor. So the clearing is measured off the same
     four numbers the shader is given — its far edge is where the band's taper
     is half applied, `-(centre + half-height + falloff/2)` in the shader's own
     units, the line where the picture visibly gives way — and every block is
     centred in it, so they share a centre rather than an invisible baseline.

     Whole block, not just the headline: the beat with a sub-line reads as one
     object, and a shared headline centre puts more ink below the line than
     above on that beat alone.

     Phones are not in this — the stylesheet centres the copy in the frame
     there, against a band that is not FLOOR until the ending. */
  const seatCopy = () => {
    const heads = blocks.filter(b => b.head);
    for (const b of heads) { b.el.style.top = ''; b.el.style.bottom = ''; }
    if (phone) return;
    const H = innerHeight;
    /* .copy is inset from the top and .blk sits inside it, so the clearing has
       to come back out of viewport coordinates to be usable. */
    const inset = copy.getBoundingClientRect().top;
    /* H, not fieldBase(H): the shader divides back out to the real height
       (`sy = uv.y * base / uRes.y`) so the band is the same share of what the
       reader sees. Scaling by base agrees only at 16:9 or taller. */
    const from  = H * (0.5 + CLEARING) - inset;
    /* To the frame's own bottom edge, not .copy's bottom margin: the shader
       clears the band all the way down, and that margin is a layout inset with
       no claim on where the picture ends. Measuring to it pulled the centre up
       0.029H, which is what read as high. */
    const to    = H - inset;
    /* The margin is still a floor, applied ONCE to the tallest block so every
       beat rises with it. Clamping each block on its own leaves the short beats
       at the low centre while the tall ones stop above it — the spread this
       exists to remove (55px at 1600x960, 65px at 1280x800). */
    const tall  = Math.max(...heads.map(b => b.el.offsetHeight));
    /* DROP is by eye, and applied AFTER the floor rather than to the clearing's
       centre: below about 1150px tall the floor is what binds, and an offset
       above it would be swallowed. This lowers both seats. */
    const rem   = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const seat  = Math.min((from + to) / 2, copy.clientHeight - tall / 2) + DROP * rem;
    for (const b of heads) {
      b.el.style.top = `${(seat - b.el.offsetHeight / 2).toFixed(1)}px`;
      b.el.style.bottom = 'auto';
    }
  };
  /* The faces are font-display:block, so the first measure can land on fallback
     metrics and seat the blocks by a height about to change. Nothing else is
     that sensitive, so this re-seats alone rather than forcing a remeasure. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(seatCopy);

  /* The shader's own normalisation, in JS. baseOf() in ptl-field.js is the
     original; both are written from CLOSE, so a retune moves them together. */
  const fieldBase = H => Math.max(H, innerWidth / C.ASPECT);
  /* On a phone the mark sits on the frame's centre rather than above it, and
     this file must agree with the shader or the closing lockup is placed
     against a mark that is not where it thinks. */
  const lift = () => (phone ? 0 : 1);

  /* WHERE THE COPY IS, for the shader to keep clear of — (centre, half-height,
     half-width, falloff), the first two as a fraction of the frame's height and
     the third in the shader's own uv, normalised on `base`. FLOOR is the bottom
     of a landscape frame in those terms: a band centred below the bottom edge
     whose taper reaches zero 9% under the middle, which every wide viewport
     gets for the whole film.

     A phone gets a band of negative height — nothing cleared. The copy there is
     not under the mark but inside it, in the ring's own void; clearing a band
     as well took out the lower arc and the lattice beneath it and left the film
     190px short of the bottom edge. Parting the form around the words was tried
     and reverted: at that width the words are as big as the circle, so the hole
     ate the ring's shoulders and what was left read as an egg.

     The ending is the exception at both sizes: the lockup IS on the floor, so
     the phone's band grows out of the bottom edge to FLOOR's, on the same ramp
     that brings the dome up. */
  /* The field's, the same four numbers it defaults uCopy to. Fallback for the
     same reason C has one: this file still seats the copy with no renderer. */
  const FLOOR = (typeof PTLField !== 'undefined' && PTLField.FLOOR) ||
                [-0.40, 0.10, 0.40, 0.21];
  /* Where the band's taper is half applied: the line, in the shader's own
     units, at which the picture gives way to the copy's ground. */
  const CLEARING = -(FLOOR[0] + FLOOR[1] + FLOOR[3] / 2);
  /* And a rem below that — not derived, asked for against the rendered frame. */
  const DROP = 1;

  /* The mark's lower edge in screen px: form()'s radius track, restricted to
     the last section where every track but the closing one is at its end value.
     The constants are C's — the field's, not this file's. */
  function markBottom(g, H) {
    const base = fieldBase(H);
    const r = C.R - C.DR * smooth(C.FROM, C.TO, g);
    return 0.5 * H - C.CY * lift() * base + (r + C.BW) * base;
  }

  function finale(b, t, H, ct) {
    /* The claim is HELD DOWN by the mark and released as the mark closes, not
       driven by a timed curve — that put it straight through the middle of the
       ring, which is unreadable and also a lie: the words rise because the form
       is getting out of their way. Past the pin the constraint stops binding. */
    const g    = (S.length - 1 + t) / S.length;
    const rise = lerp(H * 1.16, H * 0.50, clamp(t / 0.30));   // the entrance only
    /* …but never so low that the claim runs off the bottom: on a landscape
       phone markBottom is driven by `base` (the WIDTH there) while the pin is a
       share of the height, and the two disagreed enough to slice the line.
       `tail` is what must fit BELOW the claim, reserved statically rather than
       as the button fades in — growing it on arrival would drag the claim
       upward at the moment the frame is meant to be still. */
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
      /* Static, fully readable, clear of the closing mark — the same floor the
         animated branch enforces. Without it this branch never read markBottom
         and set the name line 26px inside the closed ring (71px landscape),
         printing serif type onto the mark's own dots. */
      const rY = Math.min(
        Math.max(H * 0.70 - tail * 0.5,
                 markBottom(1, H) + H * FIN.CLEAR + gap + ha),
        H - finB.offsetHeight - tail - H * 0.045);
      finB.style.transform = `translate(-50%,${rY.toFixed(1)}px)`;
      finA.style.transform = `translate(-50%,${(rY - gap - ha).toFixed(1)}px)`;
      finC.style.transform =
        `translate(-50%,${(rY + finB.offsetHeight + ctaGap).toFixed(1)}px)`;
      for (const el of [b.l1, b.l2, b.l3]) fadeLine(el, 1, 0, H);
      /* The button is simply present: its arrival IS the motion. Guarded like
         measure() and floatCta() guard it — this branch was the one place in
         the file that assumed the element exists. */
      if (cta) {
        cta.style.opacity = '1';
        cta.style.transform = 'none';
        cta.style.pointerEvents = 'auto';
        /* AND IT HAS TO BE LIVE. inert is set only in floatCta, which this
           branch returns before reaching — so a reader who scrolled into the
           finale with motion on and THEN turned reduce on was handed a
           full-opacity button, pointer-events auto, that could not be clicked,
           tapped or focused. */
        cta.inert = false;
      }
      /* ctaU and ctaSettling go with it, element or not: leaving ctaSettling
         true strands tick()'s `arriving` re-arm permanently high — an unbounded
         rAF running two fullscreen GL passes a frame, under the exact
         preference the still frame exists to honour. */
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

  /* The button's own arrival, which is not fadeLine's: the lockup's lines wipe
     in because they are type resolving out of the field, while the button is an
     object appearing once the argument is over, and a wipe read as one more
     flourish on a frame supposed to have stopped. Opacity and a rise, on a
     smoothstep so it is gentle at both ends. */
  let ctaU = 0, ctaSettling = false, ctaTs = 0;
  function floatCta(t, H) {
    if (!cta) return;
    const target = smooth(FIN.CTA[0], FIN.CTA[0] + FIN.CTA[1], t);
    /* Rate-limited HERE rather than by a CSS transition. Opacity and rise come
       from one number, but only opacity was transitioned — so under a fling the
       transform snapped to its final value while CSS was still easing the fade,
       and 0.0px of the 39px rise survived to the frame where the link became
       half-visible. This keeps both on one clock and guarantees ~0.37s of
       rise-and-fade however hard the flick is.

       Per second, not per frame: the rates are tuned at 60Hz, so at 120Hz the
       arrival ran at double speed — the flourish the limit exists to prevent.
       Clamped, because this is driven from the scroll path too and a flick
       after a pause would otherwise arrive in one step. */
    const now = performance.now();
    const k = ctaTs ? Math.min((now - ctaTs) / 1000, 0.05) * 60 : 1;
    ctaTs = now;
    ctaU = target < ctaU ? Math.max(target, ctaU - 0.09 * k)
                         : Math.min(target, ctaU + 0.06 * k);
    /* One flag, set from the only place that knows. Derived at the call site it
       was wrong twice: `ctaU > 0` is false on an arrival's first frame, and the
       finale's `.on` class is not on the element this file holds — so the loop
       shut down mid-arrival and the link stalled at 0.30, 0.72. */
    ctaSettling = ctaU !== target;
    /* The arrival has to finish on its own: past CLOSE.TO the ambient loop
       deliberately shuts down, so without this the rate limit becomes a
       permanent half-fade wherever the last scroll frame left it. */
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
     own, on one clock. The travel is per-line and additive to the group's —
     it stops three simultaneous fades reading as one block switching on. */
  function fadeLine(el, inU, outU, H) {
    if (!el) return;
    el.style.setProperty('--rv', inU.toFixed(3));
    el.style.setProperty('--ex', outU.toFixed(3));
    const a = inU * (1 - outU);
    el.style.opacity = a.toFixed(3);
    /* A faded line is still a box: the name and verb leave but their boxes do
       not, so hit-testing them puts an I-beam over an empty band of the closing
       frame. The pointer comes back only while there is something legible. */
    el.style.pointerEvents = a > 0.05 ? 'auto' : 'none';
    el.style.transform =
      `translateY(${((1 - inU) * H * 0.030 - outU * H * 0.026).toFixed(1)}px)`;
  }

  /* ---- the pointer -------------------------------------------------------
     Only the closing mark answers it, and only once it has closed. `tgt` is
     where the pointer is, `cur` where the light actually is; the light chases
     at a fixed rate so a flick of the wrist is a sweep, not a jump. Coordinates
     go into the shader's own uv space, long-side normalisation included, so a
     direction means the same thing at any aspect ratio. Off outright under
     reduced motion and with no hovering pointer, where the mark is lit
     head-on. */
  let POINTER = !reduce && mqPointer.matches;
  const tgt = [0, 0], cur = [0, 0];
  const clampAxis = v => (v < -0.9 ? -0.9 : v > 0.9 ? 0.9 : v);
  let act = 0;

  /* The pointermove listener below is registered unconditionally and gated
     inside, because POINTER can turn on later — a tablet gains a mouse, or
     reduced motion goes off — and attaching retroactively costs more
     bookkeeping than the check does. */
  /* THE CARET SLEEPS, AND IT HAS TO BE ABLE TO WAKE.
     The blink is capped at twelve iterations because a 2x22px block toggling
     forever measured 97% of the closing screen's remaining power draw. But
     twelve iterations is 12.7s, after which the animation FINISHES on its base
     opacity of 1 — a solid lit block for the rest of the visit, which reads as
     broken rather than as finished. So it sleeps only while nothing is
     happening, and any sign of a reader starts it again.

     getAnimations() keeps this cheap: while the blink runs this returns early,
     so the forced reflow — the only way to restart a CSS animation — happens
     once per idle period, not once per event. Under reduced motion the
     stylesheet removes the animation, so there is nothing to wake. */
  function wakeCaret() {
    if (reduce) return;
    /* Not `cur`: that is the pointer's eased position, module-level. */
    const caret = blocks[blocks.length - 1] && blocks[blocks.length - 1].cur;
    if (!caret || !caret.isConnected) return;
    if (caret.getAnimations().length) return;    // still blinking; leave it be
    caret.style.animation = 'none';
    void caret.offsetWidth;                      // reflow, or the restart is a no-op
    caret.style.animation = '';
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
     Scroll still moves the whole ARGUMENT; the field breathes underneath it so
     a page nobody is touching is alive rather than a screenshot. The two are
     deliberately different KINDS of clock: scroll drives structure and is exact
     and reversible, this drives texture only — the size of the halftone marks,
     nothing else — and is monotonic. Nothing that decides where a word sits
     reads it, so at worst the halftone is a few frames further through a sine.

     The clock ITSELF is the field's — it reaches uTime and nothing else, so it
     lives with the thing it reaches, and about.html no longer keeps a second
     copy of the arithmetic. What stays here is the pump: when to ask for a
     frame, and when to stop. That is genuinely this page's business. */
  /* Ambient motion is motion, so reduced motion turns it off outright — and so
     does having nothing to move. The breathe reaches exactly one thing, mark
     size, so with no renderer mounted the loop held the compositor open at
     60fps to advance a clock nothing reads. A dead context is the same case,
     and so is a merely LOST one: draw() returns immediately for both, and a
     lost context is not always given back. Scroll, the pointer and the link's
     arrival keep their own paths in, so nothing that can still move stops
     moving; the restore listener below is what starts the clock again, and
     without it this optimisation would be a freeze.

     `field` is declared below, after the mount: this is only ever CALLED from a
     frame, and the first frame is scheduled at the foot of the file. */
  const ambient = () => (reduce || !field || field.isDead() || field.isLost() ? 0 : 1);

  /* One frame loop for everything that is not scroll position: the ambient
     clock, and the pointer light easing toward the cursor. Continuous while
     there is ambient motion to draw, otherwise only while the light settles. */
  let ticking = 0;
  function tick() {
    if (ticking) return;
    ticking = requestAnimationFrame(function step(ts) {
      ticking = 0;
      if (field) field.frame(ts, ambient() === 1);
      const dx = tgt[0] - cur[0], dy = tgt[1] - cur[1];
      /* The chase rate eases on distance too: near the mark the light is
         attentive, far from it lazy — the shader's amplitude falloff on the
         time axis. Roaming the far edges should not whip the terminator. */
      const dist = Math.hypot(tgt[0], tgt[1] - 0.02);
      const rate = 0.036 + 0.048 * (1 - Math.min(dist / 0.9, 1));
      cur[0] += dx * rate;
      cur[1] += dy * rate;
      render();
      const settling = act > 0.001 && (Math.abs(dx) > 0.0004 || Math.abs(dy) > 0.0004);
      /* document.hidden: a hidden tab gets no frames anyway, but asking for
         them is a promise to burn a core if one ever obliges. And ctaU is
         rate-limited, so it can still be travelling after scroll has stopped —
         a flick ending mid-band would otherwise strand the link half-faded. */
      const arriving = ctaSettling;
      if ((ambient() && !still && !document.hidden) || settling || arriving) tick();
    });
  }
  /* Restart the loop when the tab comes back, and reset the timestamp so the
     first frame after does not carry the whole absence as one delta. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (field) field.idle();
    tick();
  });

  /* ---- the frame ---------------------------------------------------------
     `typeof`, not truthiness: on a failed load PTLField is an undeclared name,
     so `PTLField && …` throws rather than short-circuiting. It threw here,
     after the body had been stretched to the film's full height — one screen of
     words atop a very long empty page. Nothing is committed until the mount. */
  const field = typeof PTLField !== 'undefined'
    ? PTLField.mount(document.getElementById('c'))
    : null;
  /* A null field is not a failure worth falling back over: WebGL2 is
     unavailable, and the choreographed type carries the whole argument against
     a plain ground. The fallback document is for when none of THIS runs. */
  /* A restored context rebuilds the program but nothing asks it to draw, so the
     film vanished until the reader happened to scroll; a LOST context is the
     mirror, freezing a last frame that reads as truth. Both want exactly one
     frame. The restore wants the CLOCK back too — ambient() is 0 for the whole
     of a loss, so the loop has long since self-terminated and one redraw would
     leave a correct, permanently still picture. tick() is safe either way: if
     the rebuild failed the field is dead, ambient() is still 0, and the step
     shuts down after the single frame it owes. */
  {
    const cv = document.getElementById('c');
    if (field && cv) {
      cv.addEventListener('webglcontextlost', () => { remeasure = true; frame(); });
      cv.addEventListener('webglcontextrestored', () => {
        remeasure = true; frame(); tick();
      });
    }
  }
  document.body.classList.remove('no-js');
  document.body.style.height = ((S.length * PER + TAIL) * 100) + 'vh';
  let raf = 0, shown = -1, remeasure = false, lastW = innerWidth;
  let endU = -1;                          // last published --ending
  let resU = '';                          // last published --resolved
  /* True once the film has finished closing. Past PTLField.CLOSE.TO the
     fragment program is a pure function of constants — hashing the drawing
     buffer, 124 consecutive draws gave ONE distinct buffer — so the last 1.1
     viewport-heights were 60 identical fullscreen passes a second, forever, on
     the screen the reader is meant to sit still on: 82% of that frame's power
     draw. Keyed to the shader's own constant so the two cannot drift. */
  let still = false;

  function render() {
    const max  = document.documentElement.scrollHeight - innerHeight;
    /* The film's own scroll: the document minus the tail. Everything the film
       does is a function of THIS, so the tail cannot stretch a cue — past
       `film`, p is pinned at 1 and every track is at its end value. */
    const film = filmLen();
    /* Clamped, because scrollY is not bounded by the document: Safari's elastic
       overscroll reports negative at the top, and an unclamped p drove the
       section index to -1, where blocks[-1] is undefined and this threw every
       frame of the bounce. */
    const p    = clamp(window.scrollY / film);
    const span = 1 / S.length;
    still = p >= C.TO;
    const idx  = Math.min(S.length - 1, Math.floor(p / span));
    const t    = (p - idx * span) / span;
    /* The button's clock: t while the film runs, then t past 1 in the same
       units, through the tail. Nothing else reads it — the whole point is that
       the frame is held while this one number keeps moving. */
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
         it must be completely readable with every animation disabled. */
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

    /* The mark answers the pointer only once it has closed: before that it is a
       ring with a lattice around it, and lighting that is lighting a diagram. */
    act = POINTER ? smooth(0.88, 0.955, p) : 0;

    /* The writing resolves with the picture. Set on the root so every rule that
       reads --ink-live moves at once — claim, lockup, caret, CTA — rather than
       each drifting on its own timetable. Under reduce the film is held at its
       end, so the type is held there too. */
    const res = resolveAt(reduce ? 1 : p);
    document.documentElement.style.setProperty('--ink-live', mixHex(TYPE_A, TYPE_B, res));
    /* The same number unmixed, for rules that need the CURVE rather than a
       colour off it — .deep, whose blur is part of the film and has to leave on
       the film's clock. Written only when it changes, like --ending: it is
       pinned at 0 for three beats and 1 for two, and every write invalidates
       style for a rule that blurs the whole frame. */
    const resS = res.toFixed(3);
    if (resS !== resU) {
      resU = resS;
      document.documentElement.style.setProperty('--resolved', resS);
    }

    /* How far into the ending we are, published rather than applied: the
       stylesheet decides who wants it. On a phone the dome is only for the
       finale, the one section whose copy is on the floor; on a wide frame it is
       unconditional and nothing reads this. A pure function of scroll, so
       scrubbing back up takes the dome away rather than leaving it on a timer.
       Written only when it changes — 0 for five sixths of the page. */
    const end = b.fin ? (reduce ? 1 : outCubic(clamp(t / FIN.DOME))) : 0;
    if (end !== endU) {
      endU = end;
      document.documentElement.style.setProperty('--ending', end.toFixed(3));
    }

    /* isDead() means the context came back and would not take the program —
       draw() would return immediately anyway, but there is no reason to build
       it an options object sixty times a second to be ignored. */
    if (field && !field.isDead()) field.draw(t, {
      /* Under reduce the mark is HELD CLOSED. It was still morphing with scroll
         — only the ambient clock was disabled — and the closing ring's bright
         arc swept up through a lockup reduce pins in place, putting 86% of the
         verb's ink under 4.5:1. */
      g: reduce ? 1 : p,
      /* The keep-out band is for copy on the floor. On a phone there is none
         until the ending, so it OPENS on the ending's own ramp and the film
         gets the whole frame back for the argument itself.

         Only the half-height moves. Lerping the whole box in from off-frame
         does not travel at all: the band is a hundredth of a frame tall against
         a centre nine frames down, so nothing is cleared until end = 0.955
         (measured) and then it snaps in. Growing the band out of the bottom
         edge instead is the same end state and an actual opening.

         It starts at MINUS the falloff so that at end 0 the taper cannot reach
         the frame either: smoothstep(-w, 0, |x|) is 1 for every |x|, so the
         band is exactly zero. Starting at 0 would leave 64% of it standing
         before the ending had begun. */
      copy: phone
        ? [FLOOR[0], -FLOOR[3] + (FLOOR[1] + FLOOR[3]) * end, FLOOR[2], FLOOR[3]]
        : FLOOR,
      lift: lift(),
      cell: 12, gap: 0.12, gain: 1.0,
      mouse: cur, act, ink: INK, ink2: INK2, paper: PAPER, tint: TINT,
      amb: ambient(), resolve: res,
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
    if (field) field.scrolled();
    wakeCaret();
    /* When the ambient loop is running it already draws every frame, so
       scheduling the scroll slot too would render the same frame twice. */
    if (ambient() && !still) { tick(); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  /* Coalesced through the same rAF slot as scroll: dragging a window edge fires
     resize continuously, and each one used to force two layouts and a full GL
     draw while clearing `raf` out from under a scroll frame already scheduled.
     The flag keeps the measurement from being lost when that slot is taken.

     And a resize preserves scrollY, so the reader's PIXEL survived a rotation
     and their place in the argument did not — up to 3.2 sections in one
     gesture. Capture the dimensionless position before the layout changes and
     restore it after; every painting layer is fixed, so this is invisible. */
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
     `.matches` keeps the two in step: reduced motion turns the pointer light
     off regardless of what hardware is attached. */
  const prefs = () => {
    const was = reduce;
    reduce  = mqReduce.matches;
    POINTER = !reduce && mqPointer.matches;
    if (!POINTER) { tgt[0] = tgt[1] = cur[0] = cur[1] = 0; }
    frame();
    /* Turning reduce back OFF left the loop dead for the rest of the visit:
       frame() only re-arms via `act > 0.001`, which is identically 0 on a
       coarse pointer. Safe forward too — the step self-terminates when
       ambient() is 0, at a cost of one frame. */
    if (was && !reduce) tick();
  };
  mqReduce.addEventListener('change', prefs);
  mqPointer.addEventListener('change', prefs);
  /* Measured, not assumed: the lockup's joined spacing is whatever normal flow
     would give it, which is only knowable once Cormorant has loaded. */
  document.fonts.ready.then(() => { measure(); frame(); });
  measure();
  frame();
  tick();          // and the field starts breathing, with nobody having done anything

  /* Deterministic seeking, for tests and screenshots. `t` is the film's, so
     AT(i, 1) is the last frame of section i however much dead scroll follows
     it; on the last section t may run past 1, into the tail. */
  window.AT = (i, t) => {
    const max  = document.documentElement.scrollHeight - innerHeight;
    const film = filmLen();
    window.scrollTo(0, Math.min(max, film * ((i + t) / S.length)));
    render();
  };
})();
