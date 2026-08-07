/* ============================================================================
   PTL — the page
   ----------------------------------------------------------------------------
   Six beats of an argument, choreographed against scroll over a field drawn by
   ptl-field.js. Scroll is the only clock: every position on this page is a pure
   function of scrollY, so there is nothing to seek, buffer or decode, and
   dragging the scrollbar backwards runs the film backwards exactly.

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
  document.body.style.height = (S.length * PER * 100) + 'vh';

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

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const copy   = document.getElementById('copy');
  const finEl  = document.getElementById('finale');
  const finA   = document.getElementById('finA');
  const finB   = document.getElementById('finB');
  const counter = document.getElementById('bn');

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
  };
  const easeIn = u => u * u;             // accelerates out of frame

  let ha = 0, gap = 0;
  const measure = () => {
    palette();
    ha  = finA.offsetHeight;
    gap = FIN.GAP * parseFloat(getComputedStyle(document.documentElement).fontSize);
  };

  /* The mark's lower edge in screen px — the same arithmetic as form()'s
     radius track, restricted to the last section, where every track but the
     closing one has already reached its end value. */
  function markBottom(g, H) {
    const base = Math.max(H, innerWidth / 1.78);
    const r = 0.27 - 0.24 * smooth(0.86, 0.965, g);
    return 0.5 * H - 0.02 * base + (r + 0.045) * base;
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
    const bY   = Math.min(
      Math.max(rise, H * FIN.PIN, markBottom(g, H) + H * FIN.CLEAR),
      H - finB.offsetHeight - H * 0.045
    );
    const go   = easeIn(clamp((t - FIN.GO) / FIN.GO_LEN)) * H * FIN.LIFT;
    finB.style.transform = `translate(-50%,${bY.toFixed(1)}px)`;
    finA.style.transform = `translate(-50%,${(bY - gap - ha - go).toFixed(1)}px)`;

    if (reduce) {
      /* Static, fully readable, clear of the closing mark. */
      finB.style.transform = `translate(-50%,${(H * 0.70).toFixed(1)}px)`;
      finA.style.transform = `translate(-50%,${(H * 0.70 - gap - ha).toFixed(1)}px)`;
      for (const el of [b.l1, b.l2, b.l3]) fadeLine(el, 1, 0, H);
      return;
    }
    const ins = FIN.IN, out = FIN.OUT;
    fadeLine(b.l1, outCubic(clamp((t - ins[0][0]) / ins[0][1])),
                   inQuad  (clamp((t - out[0][0]) / out[0][1])), H);
    fadeLine(b.l2, outCubic(clamp((t - ins[1][0]) / ins[1][1])),
                   inQuad  (clamp((t - out[1][0]) / out[1][1])), H);
    fadeLine(b.l3, outCubic(clamp((t - ins[2][0]) / ins[2][1])), 0, H);
  }

  /* One line's arrival and departure: mask, opacity and a small travel of its
     own, all on the same clock. The travel is per-line and additive to the
     group's — it is what stops three simultaneous fades reading as one block
     switching on. */
  function fadeLine(el, inU, outU, H) {
    if (!el) return;
    el.style.setProperty('--rv', inU.toFixed(3));
    el.style.setProperty('--ex', outU.toFixed(3));
    el.style.opacity = (inU * (1 - outU)).toFixed(3);
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
  const POINTER = !reduce && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const tgt = [0, 0], cur = [0, 0];
  const clampAxis = v => (v < -0.9 ? -0.9 : v > 0.9 ? 0.9 : v);
  let act = 0;

  if (POINTER) {
    addEventListener('pointermove', e => {
      const base = Math.max(innerHeight, innerWidth / 1.78);
      tgt[0] = clampAxis((e.clientX - innerWidth  * 0.5) / base);
      tgt[1] = clampAxis((innerHeight * 0.5 - e.clientY) / base);
      if (act > 0.001) tick();
    }, { passive: true });
  }

  /* A frame loop that exists only while the light is still moving. Scroll and
     resize drive everything else, so there is no reason to hold the compositor
     open the rest of the time. */
  let ticking = 0;
  function tick() {
    if (ticking) return;
    ticking = requestAnimationFrame(function step() {
      ticking = 0;
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
      if (act > 0.001 && (Math.abs(dx) > 0.0004 || Math.abs(dy) > 0.0004)) tick();
    });
  }

  /* ---- the frame --------------------------------------------------------- */
  const field = PTLField && PTLField.mount(document.getElementById('c'), { mode: 'form' });
  /* The no-JS document is not discarded until there is something to replace it
     with. It used to be dropped on the first line of this file, so a failed
     request for ptl-field.js — or a browser with no WebGL2 — shipped a page
     with no picture AND no words, which is strictly worse than the fallback it
     threw away. */
  document.body.classList.remove('no-js');
  let raf = 0, shown = -1;

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

    if (field) field.draw(t, {
      g: p, section: idx, word: S[idx].key,
      cell: 12, gap: 0.12, gain: 1.0, fov: 0.70,
      mouse: cur, act, ink: INK, ink2: INK2, paper: PAPER,
    });
  }

  function frame() { raf = 0; render(); if (act > 0.001) tick(); }

  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(frame); },
                   { passive: true });
  addEventListener('resize', () => { measure(); frame(); });
  /* Measured, not assumed: the lockup's joined spacing is whatever normal flow
     would have given it, which is only knowable once Cormorant has loaded. */
  document.fonts.ready.then(() => { measure(); frame(); });
  measure();
  frame();

  /* Deterministic seeking, for tests and for screenshots. */
  window.AT = (i, t) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, max * ((i + t) / S.length));
    render();
  };
})();
