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
      head:   sec.querySelector('h1').textContent.trim(),
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
  let INK = [1, 1, 1], INK2 = [1, 1, 1], PAPER = [0, 0, 0];
  const palette = () => {
    const cs = getComputedStyle(document.documentElement);
    /* --field, not --ink: the film's colour and the writing's colour are
       allowed to differ, and in variation 3 they do. */
    INK   = hex3(cs.getPropertyValue('--field') || '#ffffff');
    INK2  = hex3(cs.getPropertyValue('--field-end') || cs.getPropertyValue('--field') || '#ffffff');
    PAPER = hex3(cs.getPropertyValue('--paper') || '#000000');
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
      return { el: finEl, fin: true, l1, l2, l3 };
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
       still frame to arrive into. It then takes almost all of the remaining
       scroll: this is the one thing on the page with nowhere to be, and a
       short window made it pop rather than surface. */
    /* The claim stops dead at t = 0.79 — that is the instant the mark finishes
       closing and stops pushing it, and the clamp that holds it is a hard max()
       with nothing easing it in. What was missing was the BEAT afterwards: the
       button used to start arriving at 0.79 exactly, so the claim's stop and
       the button's entrance were the same event and neither read. Now there is
       a stretch of scroll where the claim has hit its wall and nothing else
       happens — about 200px of it — and only then does the button begin. */
    CTA: [0.90, 0.095],
    CTA_RISE: 0.042,      // how far it floats up, as a fraction of the frame
    CTA_GAP: 1.7,         // below the claim, in rem, capped against short frames
  };
  const easeIn = u => u * u;             // accelerates out of frame

  let ha = 0, gap = 0, ctaGap = 0;
  const measure = () => {
    palette();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    ha  = finA.offsetHeight;
    gap = FIN.GAP * rem;
    /* Capped against the viewport as well as set in rem: on a landscape phone
       a fixed 3.4rem below the claim is a large share of the whole frame, and
       the button has to fit under it without the pair being crushed. */
    ctaGap = Math.min(FIN.CTA_GAP * rem, innerHeight * 0.0375);
  };

  /* The mark's lower edge in screen px — the same arithmetic as form()'s
     radius track, restricted to the last section, where every track but the
     closing one has already reached its end value.

     The constants are the field's, not this file's: it owns the geometry and
     publishes the end state as PTLField.CLOSE, so retuning the close there
     moves the line that has to stay clear of it. The fallback only matters if
     ptl-field.js failed to load, in which case there is no mark to clear and
     the value is unused. */
  const C = (typeof PTLField !== 'undefined' && PTLField.CLOSE) ||
            { FROM: 0.86, TO: 0.965, R: 0.27, DR: 0.24, CY: 0.02, BW: 0.045, ASPECT: 1.78 };
  function markBottom(g, H) {
    const base = Math.max(H, innerWidth / C.ASPECT);
    const r = C.R - C.DR * smooth(C.FROM, C.TO, g);
    return 0.5 * H - C.CY * base + (r + C.BW) * base;
  }

  function finale(b, t, H) {
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
      const rY = H * 0.70 - tail * 0.5;
      finB.style.transform = `translate(-50%,${rY.toFixed(1)}px)`;
      finA.style.transform = `translate(-50%,${(rY - gap - ha).toFixed(1)}px)`;
      finC.style.transform =
        `translate(-50%,${(rY + finB.offsetHeight + ctaGap).toFixed(1)}px)`;
      for (const el of [b.l1, b.l2, b.l3]) fadeLine(el, 1, 0, H);
      /* The button is simply present: its arrival IS the motion. */
      cta.style.opacity = '1';
      cta.style.transform = 'none';
      cta.style.pointerEvents = 'auto';
      return;
    }
    const ins = FIN.IN, out = FIN.OUT;
    fadeLine(b.l1, outCubic(clamp((t - ins[0][0]) / ins[0][1])),
                   inQuad  (clamp((t - out[0][0]) / out[0][1])), H);
    fadeLine(b.l2, outCubic(clamp((t - ins[1][0]) / ins[1][1])),
                   inQuad  (clamp((t - out[1][0]) / out[1][1])), H);
    fadeLine(b.l3, outCubic(clamp((t - ins[2][0]) / ins[2][1])), 0, H);
    floatCta(t, H);
  }

  /* The button's own arrival, which is not fadeLine's. The lockup's lines come
     in through a mask wipe because they are type resolving out of the field;
     the button is an object that appears once the argument is over, and a wipe
     read as one more flourish on a frame that is supposed to have stopped
     moving. Opacity and a rise, on a smoothstep so it is gentle at both ends
     rather than launching and braking. */
  function floatCta(t, H) {
    if (!cta) return;
    const u = smooth(FIN.CTA[0], FIN.CTA[0] + FIN.CTA[1], t);
    cta.style.opacity = u.toFixed(3);
    cta.style.transform = `translateY(${((1 - u) * H * FIN.CTA_RISE).toFixed(1)}px)`;
    cta.style.pointerEvents = u > 0.05 ? 'auto' : 'none';
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
  addEventListener('pointermove', e => {
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
  const AMB_DECAY = 0.86;  // how fast the boost bleeds off, per frame
  let clock = 0, lastTs = 0, vel = 0, lastY = 0;
  /* Ambient motion is motion, so prefers-reduced-motion turns it off outright
     and the page goes back to being driven by scroll alone. */
  const ambient = () => (reduce ? 0 : 1);

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
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
      lastTs = ts;
      if (ambient()) {
        vel *= AMB_DECAY;
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
      if ((ambient() && !document.hidden) || settling) tick();
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
     in place — except that the body had already been stretched to twelve
     viewport-heights on the way past, leaving the fallback as one screen of
     words at the top of a very long empty page. Nothing is committed to now
     until the mount has been attempted. */
  const field = typeof PTLField !== 'undefined'
    ? PTLField.mount(document.getElementById('c'), { mode: 'form' })
    : null;
  /* A null field is not a failure worth falling back over: it means WebGL2 is
     unavailable (or the script is missing), and the choreographed type carries
     the whole argument on its own against a plain ground. What the fallback
     document exists for is the case where none of THIS runs. */
  document.body.classList.remove('no-js');
  document.body.style.height = (S.length * PER * 100) + 'vh';
  let raf = 0, shown = -1, remeasure = false;

  function render() {
    const max  = document.documentElement.scrollHeight - innerHeight;
    /* Clamped, because scrollY is not bounded by the document: Safari's elastic
       overscroll reports negative at the top and past `max` at the bottom, and
       an unclamped p drove the section index to -1, where blocks[-1] is
       undefined and this function threw on every frame of the bounce. */
    const p    = max ? clamp(window.scrollY / max) : 0;
    const span = 1 / S.length;
    const idx  = Math.min(S.length - 1, Math.floor(p / span));
    const t    = (p - idx * span) / span;

    if (idx !== shown) {
      blocks.forEach((b, i) => b.el.classList.toggle('on', i === idx));
      counter.textContent = String(idx + 1).padStart(2, '0');
      shown = idx;
    }
    const b = blocks[idx];
    if (b.fin) {
      finale(b, t, innerHeight);
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

    /* isDead() means the context came back and would not take the program —
       draw() would return immediately anyway, but there is no reason to build
       it an options object sixty times a second to be ignored. */
    if (field && !field.isDead()) field.draw(t, {
      g: p, section: idx, word: S[idx].key,
      cell: 12, gap: 0.12, gain: 1.0, fov: 0.70,
      mouse: cur, act, ink: INK, ink2: INK2, paper: PAPER,
      time: clock, amb: ambient(),
    });
  }

  function frame() {
    raf = 0;
    if (remeasure) { remeasure = false; measure(); }
    render();
    if (act > 0.001) tick();
  }

  addEventListener('scroll', () => {
    /* Distance, not events: a trackpad fires far more scroll events per pixel
       than a wheel does, and rating the boost by event count would make the
       same gesture mean different things on different hardware. */
    vel += Math.abs(window.scrollY - lastY) / Math.max(innerHeight, 1);
    lastY = window.scrollY;
    /* When the ambient loop is running it is already drawing every frame, so
       scheduling the scroll slot as well would render the same frame twice. */
    if (ambient()) { tick(); return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
  /* Coalesced through the same rAF slot as scroll. Dragging a window edge
     fires resize continuously, and each one used to force a synchronous
     measure — two forced layouts — plus a full GL draw, while also clearing
     `raf` out from under a scroll frame that was already scheduled. The flag
     is what keeps the measurement from being lost when that slot is taken. */
  addEventListener('resize', () => {
    remeasure = true;
    if (!raf) raf = requestAnimationFrame(frame);
  });

  /* Live preferences. Recomputing POINTER from the query rather than caching
     its `.matches` keeps the two in step: reduced motion turns the pointer
     light off regardless of what hardware is attached. */
  const prefs = () => {
    reduce  = mqReduce.matches;
    POINTER = !reduce && mqPointer.matches;
    if (!POINTER) { tgt[0] = tgt[1] = cur[0] = cur[1] = 0; }
    frame();
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

  /* Deterministic seeking, for tests and for screenshots. */
  window.AT = (i, t) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, max * ((i + t) / S.length));
    render();
  };
})();
