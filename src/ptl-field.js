/* ============================================================================
   PTL — procedural field renderer
   ----------------------------------------------------------------------------
   Replaces the video chain. The reference set (Algolia, Pulse, the checkerboard
   posters, the dot spheres) is not photographic: every one is a single coherent
   form built from a regular grid of marks, falling off into black. You cannot
   get that by crushing a photograph to 1-bit — crushing a photograph gives you
   noise, which is what the video build shipped. You get it by drawing the grid.

   Whatever the subject, the output stage is the same and is the thing that
   matters: a rigid grid of marks whose SIZE carries the image. An on/off dither
   at one fixed size is a 1980s dot-matrix printer, and that crunch was most of
   what read as cheap. Area proportional to luminance means sqrt() on the side.
   Every pixel is still pure black or pure white.

   Three treatments share that stage:

     FORM  a single abstract form per section, in screen space. No world, no
           camera. This is what the references literally are.
     ARCH  the storyboard's monumental concrete, raymarched, camera flying
           forward. The machine sublime, at the cost of reading as stripes when
           the grid is only ~130 marks across.
     TYPE  the words themselves as the picture — Cormorant rendered to a
           texture, warped, and halftoned on the same grid.

   Drawing rather than filming also buys: exact art direction (a near mass is an
   unlit silhouette because RANGE says so, not because a model agreed to it),
   and zero scroll latency (a field is a pure function of scroll position, where
   a video scrub measured 90ms median and spiked past 600ms).

   USAGE
     const f = PTLField.mount(canvas, { mode: 'form' });
     f.draw(0.42, { section: 2, cell: 12 });
   ========================================================================== */
(function (root) {
  'use strict';

  /* WHERE THE MARK ENDS UP.
     ------------------------------------------------------------------------
     The page needs to know the closing mark's geometry in order to keep the
     final line of type clear of it, and the shader is a string — it cannot
     read a JS constant, and JS cannot read its literals. So the numbers are
     named here and the two readers are kept adjacent: form()'s closing tracks
     below, and PTLField.CLOSE, which ptl-page.js resolves into screen pixels.

     They already came apart once. Retiming the close from 0.88→1.00 to
     0.86→0.965 to buy a held end frame moved the mark out from under the
     claim, and the claim's own arithmetic had to be chased separately. If you
     retune a track below, retune the matching field here in the same edit.

     R and CY are END values — the sums the radius and centre tracks arrive at
     once every earlier track has run out — not any single track's argument. */
  const CLOSE = {
    FROM: 0.86, TO: 0.965,   // the closing track's window in global scroll
    R:    0.27,              // radius at 0.86, before the close
    DR:   0.24,              // how much of it the close takes away
    CY:   0.02,              // centre height at rest, in uv
    BW:   0.045,             // half the band's width at rest
    ASPECT: 1.78,            // the long-side normalisation, uRes.x / 1.78
  };

  const VERT = `#version 300 es
  void main(){
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;

  const FRAG = `#version 300 es
  precision highp float;
  out vec4 fragColor;

  uniform vec2      uRes;
  uniform float     uT;         // 0..1 progress through this section
  uniform float     uCell;      // grid cell size in device px
  uniform float     uGap;       // black gutter between cells
  uniform float     uGain;
  uniform int       uMode;      // 0 FORM  1 ARCH  2 TYPE
  uniform int       uSection;   // 0..5
  uniform float     uG;         // 0..1 across the WHOLE page — FORM runs on this
  uniform sampler2D uTex;       // TYPE only
  uniform float     uFov;
  uniform vec3      uInk;       // the mark, at the top of the page
  uniform vec3      uInk2;     // the mark, at the bottom of it
  uniform vec3      uPaper;     // the ground
  uniform vec2      uMouse;     // pointer, in the same uv space as the field
  uniform float     uAct;       // 0..1 — how much the pointer is allowed to act
  uniform float     uTime;      // seconds — the ambient clock, which scroll speeds up
  uniform float     uAmb;       // 0..1 — how much ambient motion is allowed

  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

  /* ---- FORM ----------------------------------------------------------------
     ONE circle, for the whole page.

     The first version was six independent branches selected by section, which
     meant five hard cuts — the arc simply vanished and a ring appeared. That is
     the same defect as a bad seam in the video chain, and the fix is the same:
     don't join two things, have one thing the whole way.

     So there is a single circle, and every beat of the argument is a continuous
     transformation of it. The opening arc is not an arc at all — it is this
     circle at colossal radius with its centre far below the frame, so only its
     top edge is in shot. Raising the centre and shrinking the radius turns that
     arc into the ring without anything appearing or disappearing.

       0.00-0.28  DECIDE  centre rises from below, radius collapses: the arc
                          becomes a ring
       0.28-0.50  WHEN    the ring holds and tightens
       0.33-0.50  EARN    a lattice grows OUT of the ring, its void being the
                          ring's own interior
       0.50-0.67  COMMIT  the lattice loses cells and goes out of register
       0.67-0.86  PRICE   every cell returns and snaps back into exact register
       0.84-0.965 END     the lattice falls away, the ring closes to one mark
       0.965-1.00         held: the film is over and the frame is still

     Everything below is a track on uG (global scroll), never on section index,
     which is what makes it continuous by construction rather than by tuning.  */
  float track(float g, float a, float b, float v0, float v1){
    return mix(v0, v1, smoothstep(a, b, g));
  }

  float form(vec2 uv, float g){
    /* The circle. Centre and radius are one continuous path from "colossal and
       mostly off-frame" to "a single mark at the middle". */
    /* The high arch. A colossal radius with the centre pushed far down flattens
       the curve into a shallow lens; the arch reads as an arch when the apex is
       high AND the legs fall away steeply to the side edges, which needs a
       SMALLER radius and a centre nearer the frame. Solved for apex at +0.32
       and the legs crossing the frame edge at -0.12. */
    /* The mark leans toward the pointer — barely. At 0.042 it read as a thing
       being dragged around; the movement was the effect instead of inflecting
       it. A hundredth and a half of a uv unit is under twenty pixels across
       the whole screen, which is felt rather than watched, and it leaves the
       travelling light to carry the life. */
    vec2 lean = uMouse * 0.015 * uAct;
    uv -= lean;

    /* The end values of these two tracks, and of bw below, are mirrored in
       CLOSE at the top of this file — see the note there before retuning. */
    float cy = track(g, 0.00, 0.30, -0.80, 0.02);   // CLOSE.CY
    float r  = track(g, 0.00, 0.30,  1.12, 0.34)
             - track(g, 0.30, 0.50,  0.00, 0.07)      // WHEN: tightens
             + track(g, 0.52, 0.66,  0.00, 0.05)      // COMMIT: breathes out
             - track(g, 0.70, 0.86,  0.00, 0.05)      // PRICE: back into register
             /* END: closes to a mark, and is DONE closing at 0.965 rather than
                at 1.00. The film used to still be moving at the last pixel of
                scroll, so its final frame existed only at the very bottom and
                the closing statement had nothing steady to sit under. Landing
                early buys a held end card — the last ~3% of the page is one
                still frame: the mark, and the claim beneath it. */
             - track(g, 0.86, 0.965, 0.00, 0.24);   // CLOSE.FROM/TO/DR; the
                                                    // sum above it is CLOSE.R
    vec2  c  = vec2(0.0, cy);
    float len = length(uv - c);

    /* Band width follows the same path: thick and soft while the circle is
       colossal, tight once it is a ring. */
    /* 0.13 is the original's value and it is load-bearing. Raising it to 0.23
       to chase a higher apex was the wrong lever: the apex comes from the
       centre and radius, the WEIGHT comes from here, and fattening the band
       turned a drawn edge into a slab. Height and thickness are independent —
       change the one you actually mean. */
    float bw = track(g, 0.00, 0.30, 0.13, 0.045);   // CLOSE.BW

    float ring = 1.0 - smoothstep(0.0, bw, abs(len - r));

    /* Only while the circle is colossal: dim the ends so the top edge reads as
       one lit arc in the dark rather than as a band running off both sides. */
    float ends = 1.0 - smoothstep(0.30, 1.05, abs(uv.x));
    ring *= mix(0.45 + 0.75 * ends, 1.15, smoothstep(0.10, 0.30, g));

    /* At the very end the ring is small enough that a hole in it reads as a
       defect, so it fills — the last mark on the page is solid. */
    float closed = smoothstep(0.885, 0.965, g);
    ring = max(ring, (1.0 - smoothstep(r * 0.6, r * 1.25, len)) * closed);

    /* THE MARK ANSWERS THE POINTER.
       --------------------------------------------------------------------
       Once it has closed, the mark is the only thing left on the page, and a
       still disc is a full stop. Lighting it makes it an object instead: the
       flat radial falloff is replaced by a hemisphere shaded from a direction
       the reader controls, so the terminator sweeps across the halftone and
       the marks on the dark side shrink while the lit side swells. Nothing
       translates — the CELLS are fixed and only their coverage changes, which
       is the same grammar as the rest of the film.

       Cheap, because the normal is analytic: inside a disc of radius r, the
       unit sphere's z is sqrt(1 - |p|^2). No raymarch, no geometry.

       Applied to the WHOLE body and not to the fill alone. Lighting only the
       fill left the ring — which still peaks at len = r, a couple of cells out
       from the middle — at full strength beside a dimmed core, and the two
       disagreed as a pinch of small cells at the centre of the disc. One
       object, one light. */
    float lightAmt = uAct * closed;
    if (lightAmt > 0.001){
      /* DISTANCE EASING — the mark is FULLER the closer you get.
         The first version had this backwards. It ramped the shading up with
         proximity, so approaching the mark made it darker and sparser and
         backing away made it whole: the thing recoiled from attention. It
         should do the opposite. Near, it comes up to full strength and takes
         a clear light; far, it sinks toward a dim, flat, half-present state.
         Two separate terms, because they are two different ideas — how much
         of the mark is there (lvl), and how sculpted it is (dirA). */
      float d    = length(uMouse - vec2(0.0, cy));
      float near = 1.0 - smoothstep(0.10, 0.92, d);
      float lvl  = mix(0.56, 1.00, near);   // how present the mark is
      float dirA = mix(0.25, 1.00, near);   // how directional its light is

      vec2  np = (uv - c) / max(r * 1.18, 1e-4);
      float nz = sqrt(max(0.0, 1.0 - min(dot(np, np), 1.0)));
      vec3  n  = normalize(vec3(np, max(nz, 0.06)));
      vec3  L  = normalize(vec3(uMouse * 1.30, 0.74));
      float lam = max(dot(n, L), 0.0);
      /* The hot spot is what sells it as a surface rather than a gradient: it
         slides across the halftone a beat ahead of the terminator. */
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0) * 0.30;

      /* THE LIMB, READ DIRECTIONALLY.
         An undirected rim brightens the whole edge, which reads as a vignette
         and does not move. Splitting it by which way the edge faces gives two
         things for one dot product: a lit lip on the near side, and an inner
         shadow — a shaded band just inside the far edge — that travels around
         the disc as the pointer moves. That travelling shadow is most of what
         makes the mark read as a solid rather than a disc with a gradient on
         it, because it is the only cue that says the surface curves AWAY. */
      float lm   = length(L.xy);
      vec2  ldir = lm > 1e-3 ? L.xy / lm : vec2(0.0);   // head-on: no side, no lip
      float side = dot(normalize(np + vec2(1e-5)), ldir);
      float limb = smoothstep(0.54, 1.00, length(np));
      float lip   = limb * max( side, 0.0) * 0.14;
      float shade = limb * max(-side, 0.0) * 0.40;

      /* The lighting PEAKS AT ONE. It may shade the mark; it may never
         brighten it. This is the whole difference between a halftone and a
         circle: the image is carried by mark SIZE, size is sqrt(luminance),
         and luminance clamps at 1 — so a lighting term that peaks above 1
         drives every cell in the lit region to full size and flattens the
         size gradient into a plateau. An earlier version peaked at 1.34,
         which saturated everything inside len = 0.04 and turned the mark
         into a solid disc with a halftone fringe. Capped here, the field's
         own radial falloff stays the structure and the light only tilts it. */
      float shape = 0.38 + 0.62 * lam * lam + spec + lip - shade;
      float lit   = clamp(mix(1.0, shape, dirA) * lvl, 0.0, 1.0);
      ring *= mix(1.0, lit, lightAmt);
    }

    /* The lattice. Its grid is anchored to the circle's centre, so it grows out
       of the ring rather than arriving over the top of it, and its inner edge
       IS the ring — the void at the middle of section 3 is the circle. */
    float latAmt = track(g, 0.33, 0.46, 0.0, 1.0) * track(g, 0.84, 0.945, 1.0, 0.0);
    float lat = 0.0;
    if (latAmt > 0.001){
      vec2 gc  = (uv - c) * 13.0;
      vec2 cid = floor(gc);
      /* Out of register, then back. Peaks inside COMMIT and is fully resolved
         by the end of PRICE, which is the argument those two sections make. */
      float jt = track(g, 0.50, 0.62, 0.0, 1.0) * track(g, 0.68, 0.85, 1.0, 0.0);
      float rm = track(g, 0.50, 0.64, 0.0, 0.55) * track(g, 0.70, 0.86, 1.0, 0.0);
      vec2 jitter = (vec2(hash(cid), hash(cid + 7.1)) - 0.5) * 1.5 * jt;
      vec2 lc = abs(fract(gc) - 0.5 - jitter);
      float rule = smoothstep(0.34, 0.48, max(lc.x, lc.y));
      float keep = step(hash(cid + 3.7), 1.0 - rm);
      float ann  = smoothstep(r * 1.00, r * 1.30, len)
                 * (1.0 - smoothstep(r * 1.75, r * 2.45, len));
      lat = rule * keep * ann * latAmt;
    }

    /* The form parts around the copy, in the COLUMN the copy occupies only —
       the arch's legs live out at the frame edges where no type ever goes, and
       clearing the whole lower band amputated them.

       A backdrop blur was tried in place of this and reverted: defocusing the
       field behind the type keeps more of the picture, but the picture it keeps
       is a soft grey smear, and the thing that makes this page work is that
       every mark is hard. Parting around the copy is better because the field
       stays sharp everywhere it is visible. */
    float column = 1.0 - smoothstep(0.40, 0.74, abs(uv.x));
    /* uv is normalised by 'base', which is the LONG side — in landscape that is
       the width, so uv.y stops meaning "share of the visible frame" and the
       keep-out drifts off the bottom of a short viewport. On an 844x390 phone
       the cleared band began at 238px while the copy started at 152px, and the
       headline was set straight over the brightest marks in the picture. sy
       converts back to a fraction of the actual height, so the band is always
       the same share of what the reader can see. On a viewport at or taller
       than 16:9 this is exactly uv.y and nothing changes. */
    float base   = max(uRes.y, uRes.x / 1.78);
    float sy     = uv.y * base / uRes.y;
    float clear  = 1.0 - smoothstep(-0.09, -0.30, sy) * column;

    return max(ring, lat) * clear;
  }

  /* ---- ARCH ----------------------------------------------------------------
     The storyboard's world, raymarched. Kept whole so the three treatments are
     a fair comparison rather than one of them being a sketch.                 */
  float sdBox(vec3 p, vec3 b){
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  float map(vec3 p){
    float d = 1e9;
    /* Floating, never standing. The brief says unbounded void with no ground,
       and honouring it pays compositionally: the masses have visible bottom
       edges which converge toward the horizon, leaving a black wedge along the
       bottom of the frame for type. */
    vec3 q = p;
    q.z = mod(q.z + 13.0, 26.0) - 13.0;
    float sway = float(uSection) * 1.7;
    d = min(d, sdBox(q - vec3(-21.0 - sway, 11.0, 0.0), vec3(2.6, 15.0, 2.6)));
    d = min(d, sdBox(q - vec3( 21.0 + sway, 11.0, 0.0), vec3(2.6, 15.0, 2.6)));

    vec3 g = p - vec3(0.0, 6.0, 168.0);
    d = min(d, sdBox(g - vec3(-8.0,  0.0, 0.0), vec3(1.6, 12.0, 1.6)));
    d = min(d, sdBox(g - vec3( 8.0,  0.0, 0.0), vec3(1.6, 12.0, 1.6)));
    d = min(d, sdBox(g - vec3( 0.0, 13.4, 0.0), vec3(9.9, 1.5, 1.6)));
    return d;
  }

  /* The clause the video model would not obey, written as arithmetic: nothing
     is lit closer than NEAR, so a mass arriving at the lens goes to silhouette
     rather than to the lit grey slab the model insisted on. */
  float range(float t){
    return smoothstep(30.0, 74.0, t) * (1.0 - smoothstep(150.0, 260.0, t));
  }

  float arch(vec2 uv, float halfH, float t){
    vec3 ro = vec3(0.0, 0.0, t * 125.0);
    /* A shifted lens — the architectural photographer's rising front. Parks the
       vanishing point above centre so the lower frame stays black. */
    vec3 rd = normalize(vec3((uv - vec2(0.0, halfH * 0.50)) * uFov, 1.0));

    float d, k = 0.0;
    bool hit = false;
    for (int i = 0; i < 96; i++){
      d = map(ro + rd * k);
      if (d < 0.012 * k){ hit = true; break; }
      k += d * 0.85;
      if (k > 260.0) break;
    }
    if (!hit) return 0.0;

    vec3 p = ro + rd * k;
    vec2 e = vec2(0.02, 0.0);
    vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                            map(p + e.yxy) - map(p - e.yxy),
                            map(p + e.yyx) - map(p - e.yyx)));
    vec3 L = normalize(vec3(0.62, 0.16, 0.77));
    float lam = pow(max(dot(n, L), 0.0), 1.5);
    float rim = pow(1.0 - abs(dot(n, rd)), 5.0);
    return (lam * 0.95 + rim * 0.30) * range(k);
  }

  /* ---- TYPE ----------------------------------------------------------------
     The word as the picture. The texture is Cormorant drawn white on black at
     high resolution; the warp is a displacement that eases out as the section
     resolves, so the word arrives out of distortion rather than fading in.
     Halftoning it on the same grid is what ties this treatment to the other
     two — same marks, different subject.                                      */
  float typeField(vec2 uv, float t){
    float ease = pow(1.0 - clamp(t, 0.0, 1.0), 1.7);
    vec2 p = uv;
    p /= mix(1.55, 1.22, smoothstep(0.0, 0.85, t));  // settles out of a push-in
    p.y -= 0.34;   // sits high, so the headline below it stays on clean black
    p.x += sin(p.y * 5.2 + ease * 7.0) * 0.10 * ease;
    p.y += sin(p.x * 3.1) * 0.03 * ease;
    vec2 tc = p * vec2(0.5, -0.5) + 0.5;
    if (tc.x < 0.0 || tc.x > 1.0 || tc.y < 0.0 || tc.y > 1.0) return 0.0;
    return texture(uTex, tc).r;
  }

  void main(){
    vec2 cellId = floor(gl_FragCoord.xy / uCell);
    vec2 centre = (cellId + 0.5) * uCell;
    /* Normalise on the long side. Dividing by height widens the horizontal
       field on a letterboxed canvas instead of cropping it, which shrank the
       subject to a stamp in the middle of a very wide empty frame. */
    float base = max(uRes.y, uRes.x / 1.78);
    vec2 uv = (centre - 0.5 * uRes) / base;
    float halfH = 0.5 * uRes.y / base;

    float lum = uMode == 0 ? form(uv, uG)
              : uMode == 1 ? arch(uv, halfH, uT)
                           : typeField(uv, uT);
    lum *= uGain;

    /* Cut the tail. A near-constant 2% across a large area is not invisible —
       it renders as a perfectly regular lattice of isolated marks, i.e.
       wallpaper across the whole frame and through the headline. Anything this
       dim carries no form, so it is not dim, it is off. This one line stands
       between a field and screen dirt, which is the failure the video shipped. */
    lum = max(lum - 0.06, 0.0) / 0.94;

    float s = sqrt(clamp(lum, 0.0, 1.0));
    vec2 f = abs(fract(gl_FragCoord.xy / uCell) - 0.5) * 2.0;

    /* THE FIELD BREATHES.
       --------------------------------------------------------------------
       Applied to the mark's SIZE and not to the luminance behind it, which
       matters: the bright core of the form is saturated, so modulating lum
       there is swallowed by the clamp and only the falloff would move. Size
       is the one channel every cell still has room in — a saturated cell can
       always get smaller — so the whole field moves, core included, which is
       what makes it read as a printed screen with a pulse rather than as a
       soft edge wobbling.

       Two sines at unrelated rates and unrelated directions. One alone is a
       metronome sweeping the screen; summed, they never repeat inside any
       time a reader will spend here, and the beat between them is what makes
       it read as breathing rather than as a loop.

       It dies as the form closes, on exactly the closing track's window: the
       last frame of the page is meant to be still, and a mark that is still
       pulsing under the closing claim is a film that has not ended. */
    float wave = sin(uTime * 0.55 + uv.x * 2.3 + uv.y * 1.7)
               + sin(uTime * 0.37 - uv.x * 1.6 + uv.y * 2.9) * 0.7;
    float amb  = uAmb * (1.0 - smoothstep(0.86, 0.965, uG));
    float breathe = 1.0 + amb * 0.060 * wave;

    float mark = step(max(f.x, f.y), s * (1.0 - uGap) * breathe);
    /* Still one bit per cell — every pixel is either ink or paper, never a
       blend. Which two colours those are is the page's business, not the
       renderer's.

       The ink may travel across the page, though. Where uInk2 differs from
       uInk the mark bleeds from one to the other as you scroll, which is
       how the blue variation resolves to black by the last frame.

       The window is deliberately late: it tracks the CLOSING of the mark
       (0.86-0.965 above) rather than the length of the page. Draining from
       the top meant the colour was already spent by the time the final
       lockup assembled — so the one section that most wants the blue never
       had any. Now the whole argument is blue and the colour resolves at
       exactly the moment the form does. */
    vec3 ink = mix(uInk, uInk2, smoothstep(0.885, 0.985, uG));
    fragColor = vec4(mix(uPaper, ink, mark), 1.0);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'shader compile failed';
      gl.deleteShader(s);               // the failure path leaked it too
      throw new Error(log);
    }
    return s;
  }

  const MODES = { form: 0, arch: 1, type: 2 };

  function mount(canvas, opt) {
    opt = opt || {};
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return null;

    /* Without preventDefault() the context can never come back, and a page
       whose entire picture is one shader would stay blank for the rest of the
       session while the type kept choreographing over nothing. */
    /* Everything GL lives in build(), because a lost context invalidates every
       program, uniform location and texture handle at once — restoring means
       making all of it again. Without preventDefault() the browser never offers
       to restore at all, and a page whose entire picture is one shader would
       stay blank for the rest of the session while the type kept choreographing
       over nothing. */
    let prog = null, u = {}, tex = null, drawn = null, lost = false;
    /* The drawing-buffer size last handed to gl.viewport(). Declared up here so
       build() can clear it: after a restore the GL state is back at its
       defaults, and leaving the cache populated would let size() decide there
       was nothing to re-apply. */
    let w = 0, h = 0;
    /* Set only if a REBUILD fails — the context came back and would not take
       the program. Nothing can be drawn again after that, so the page stops
       asking rather than calling draw() on every scroll frame forever. */
    let dead = false;

    function build() {
      /* On a restore these handles name objects the driver has already
         destroyed, so deleting them is a formality — but build() is the one
         place that makes them, and it should be the one place that lets them
         go. */
      if (prog) gl.deleteProgram(prog);
      if (tex) gl.deleteTexture(tex);

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      let fs;
      try {
        fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      } catch (e) {
        gl.deleteShader(vs);
        throw e;
      }
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      /* Linked or not, the shader objects have served their purpose: the
         program holds everything it needs. Left attached they stay resident
         for the life of the page. */
      gl.detachShader(prog, vs); gl.deleteShader(vs);
      gl.detachShader(prog, fs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog) || 'link failed';
        gl.deleteProgram(prog); prog = null;
        throw new Error(log);
      }
      gl.useProgram(prog);

      u = {};
      for (const n of ['uRes', 'uT', 'uG', 'uCell', 'uGap', 'uGain', 'uMode',
                       'uSection', 'uTex', 'uFov', 'uMouse', 'uAct', 'uTime', 'uAmb',
                       'uInk', 'uInk2', 'uPaper']) {
        u[n] = gl.getUniformLocation(prog, n);
      }

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    new Uint8Array([0, 0, 0, 255]));
      drawn = null;                     // the TYPE texture went with the context
      w = h = 0;                        // and so did the viewport
    }
    build();

    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => {
      /* An exception thrown here would escape into an event handler, where
         nothing is waiting for it, and leave `lost` true forever — the picture
         gone with no record of why. Catch it, say so once, and mark the field
         dead so the page can stop driving it. */
      try {
        build();
        lost = false;
      } catch (e) {
        dead = true;
        console.error('PTLField: could not rebuild after context restore', e);
      }
    });

    /* The TYPE texture. Drawn on a 2D canvas rather than shaped in the shader
       because it has to be Cormorant — the mandated face — and an SDF cannot be
       a typeface. Redrawn only when the word changes. */
    const pad = document.createElement('canvas');
    function setWord(word) {
      if (word === drawn) return;
      drawn = word;
      const W = 2048, H = 1152;
      pad.width = W; pad.height = H;
      const c = pad.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#fff';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      /* Overflow the frame on purpose — the reference letterforms are cropped
         hard by the edges, and that is what gives a thin serif weight at scale. */
      let size = 520;
      c.font = `300 ${size}px Cormorant, serif`;
      const w0 = c.measureText(word).width;
      if (w0 > 0) size = Math.min(820, size * (W * 1.06 / w0));
      c.font = `300 ${size}px Cormorant, serif`;
      c.fillText(word, W / 2, H / 2);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pad);
    }

    function size() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const nw = Math.round(canvas.clientWidth * dpr);
      const nh = Math.round(canvas.clientHeight * dpr);
      if (nw === w && nh === h) return;
      w = canvas.width = nw; h = canvas.height = nh;
      gl.viewport(0, 0, w, h);
    }

    function draw(t, o) {
      if (lost || dead) return;
      o = o || {};
      size();
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const mode = MODES[o.mode || opt.mode] || 0;
      if (mode === 2 && o.word) setWord(o.word);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uRes, w, h);
      gl.uniform1f(u.uT, t);
      gl.uniform1f(u.uG, o.g != null ? o.g : t);
      gl.uniform1f(u.uCell, (o.cell != null ? o.cell : 12) * dpr);
      gl.uniform1f(u.uGap, o.gap != null ? o.gap : 0.12);
      gl.uniform1f(u.uGain, o.gain != null ? o.gain : 1.0);
      gl.uniform1i(u.uMode, mode);
      gl.uniform1i(u.uSection, o.section || 0);
      gl.uniform1f(u.uFov, o.fov != null ? o.fov : 0.70);
      const ink = o.ink || [1, 1, 1], paper = o.paper || [0, 0, 0];
      const ink2 = o.ink2 || ink;
      gl.uniform3f(u.uInk, ink[0], ink[1], ink[2]);
      gl.uniform3f(u.uInk2, ink2[0], ink2[1], ink2[2]);
      gl.uniform3f(u.uPaper, paper[0], paper[1], paper[2]);
      const m = o.mouse || [0, 0];
      gl.uniform2f(u.uMouse, m[0], m[1]);
      gl.uniform1f(u.uAct, o.act != null ? o.act : 0);
      gl.uniform1f(u.uTime, o.time != null ? o.time : 0);
      gl.uniform1f(u.uAmb, o.amb != null ? o.amb : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return { draw, setWord, gl, canvas, isDead: () => dead };
  }

  root.PTLField = { mount, CLOSE };
})(window);
