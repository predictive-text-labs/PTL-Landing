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
  uniform vec3      uTint;      // the mark at its DIMMEST, and the ground's bloom
  uniform vec2      uMouse;     // pointer, in the same uv space as the field
  uniform float     uAct;       // 0..1 — how much the pointer is allowed to act
  uniform float     uTime;      // seconds — the ambient clock, which scroll speeds up
  uniform float     uAmb;       // 0..1 — how much ambient motion is allowed
  uniform sampler2D uLat;       // the picture, already sampled once per cell
  uniform float     uResolve;   // 0..1 — how far the film has resolved
  uniform vec4      uCopy;      // the copy's box: (centre, half-height, half-width, falloff)
  uniform float     uLift;      // 1 the mark rides above centre, 0 it sits on it

  /* A LUMINANCE IN A BYTE PAIR. The lattice pass writes to an RGBA8 target —
     the one colour-renderable format WebGL2 guarantees without an extension —
     and one byte per cell is not enough: the ground raises lum to the 0.42, so
     a single 1/255 step at the bottom of the range opens to a tenth of the
     bloom and the dark banded. Split across two channels this carries 16 bits,
     which is more than the picture has. */
  vec2  encLum(float l){ float q = clamp(l, 0.0, 1.0) * 255.0;
                         return vec2(floor(q) / 255.0, fract(q)); }
  float decLum(vec2 e){ return e.r + e.g / 255.0; }
  /* The breathe rides in the third channel: it is a property of a CELL, so it
     is evaluated where cells are evaluated. That is what makes the invariant
     true — the shading pass evaluates NOTHING positional, it only reads — and
     it spares eighteen transcendentals a pixel, a bill a phone pays even
     though it measured 36.0ms either way here. One byte is plenty: 0.88..1.135
     spans the 0.898..1.102 the breathe reaches, so a step is a thousandth of a
     mark. */
  float encBrt(float b){ return clamp((b - 0.88) / 0.255, 0.0, 1.0); }
  float decBrt(float e){ return 0.88 + e * 0.255; }

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

  /* THE NORMALISATION, AND THE ONLY COPY OF IT.
     Dividing by the height widens the horizontal field on a letterboxed canvas
     instead of cropping it, which stops the subject shrinking to a stamp in
     the middle of a very wide empty frame. On a portrait frame the same rule
     scales the form to the HEIGHT, so the ring is wider than the phone and its
     left and right run off the edges — deliberately. Capping it to the width
     was tried and reverted: it fixes a silhouette nobody was looking at and
     costs the whole film its scale, including the closing mark, which came out
     42% smaller than it is meant to be. The number lives in CLOSE at the top of
     this file, because ptl-page.js does this arithmetic too, to know where the
     mark's lower edge is. */
  float baseOf(){
    return max(uRes.y, uRes.x / 1.78);
  }
  /* Half the frame's height in that same normalised space. */
  float halfHOf(){
    return 0.5 * uRes.y / baseOf();
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
    /* uLift is the END of this track only — the opening's -0.80 is what puts
       the reader inside a colossal circle and is not negotiable. The 0.02 it
       settles at lifts the mark to leave room UNDER it for copy, which on a
       phone is not where the copy is; there the page passes 0 and the mark
       comes to rest on the frame's own centre, with the words in the middle
       of it. */
    float cy = track(g, 0.00, 0.30, -0.80, 0.02 * uLift);   // CLOSE.CY
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
    /* uCopy IS THE BOX THE WORDS OCCUPY, and the page measures it — this used
       to be three constants that described the bottom of a landscape frame,
       which is only where the copy is when the frame is landscape. On a phone
       the copy sits in the middle, and a keep-out aimed at the floor cleared
       the one part of the picture that had nothing in front of it while
       leaving the marks that were directly under the headline. The tapers are
       falloff is the box's own fourth number, 0.21 on the floor — which with
       the 1.62 the sides take is the shipped 0.34 — so a wide frame, where the
       page passes the floor box, draws exactly what it drew before. */
    float column = 1.0 - smoothstep(uCopy.z, uCopy.z + uCopy.w * 1.62, abs(uv.x));
    /* uv is normalised by 'base', which is the LONG side — in landscape that is
       the width, so uv.y stops meaning "share of the visible frame" and the
       keep-out drifts off the bottom of a short viewport. On an 844x390 phone
       the cleared band began at 238px while the copy started at 152px, and the
       headline was set straight over the brightest marks in the picture. sy
       converts back to a fraction of the actual height, so the band is always
       the same share of what the reader can see. On a viewport at or taller
       than 16:9 this is exactly uv.y and nothing changes. */
    float base   = baseOf();
    float sy     = uv.y * base / uRes.y;
    float band   = 1.0 - smoothstep(uCopy.y, uCopy.y + uCopy.w, abs(sy - uCopy.x));
    float clear  = 1.0 - band * column;

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

  /* ONE MARK'S SHADOW, and the only place the metric is argued. p is relative
     to that mark's centre, in cell units.

     Not Chebyshev. d — the metric whose circles ARE squares — gave every mark
     a square halo with four sharp corners, and where those corners met across
     a cell the field broke into hard rectangular patches, worse the more blur.
     The distance from a point to a BOX, length(max(|p| - e, 0)), is Euclidean
     outside and therefore round at the corners: a blurred shadow is round no
     matter what shape cast it. Same cost, artefact gone rather than hidden.

     But a wide blur does not PRESERVE a square either, it loses it, so the
     metric follows the blur — hug the box while it is tight, go radial as it
     grows past the mark.

     ZERO SPREAD, ALL BLUR, AND THE BLUR SCALES WITH THE MARK: sg is
     proportional with no constant term. Spread grows the shape before blurring
     it, which is a plateau — the shadow would leave the edge already at full
     strength. A floor would be spread wearing blur's name: it would hand a
     one-pixel mark a fixed halo and the falloff, which is nothing but small
     marks, would haze over. Scaled, a minuscule dot casts a minuscule shadow
     and the dark stays dark. */
  float castShadow(vec2 p, float e, float sg){
    float dBox = length(max(abs(p) - e, vec2(0.0)));
    float dRad = max(length(p) - e, 0.0);
    float rnd  = clamp(sg / max(e, 1e-4), 0.0, 0.55);
    return exp(-mix(dBox, dRad, rnd) / sg);
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

  /* THE MARK ANY GIVEN CELL CARRIES, in cell units.
     ---------------------------------------------------------------------------
     Factored out of main because a drop shadow is cast by a MARK, and the marks
     that fall on a fragment are mostly not its own cell's. Everything a mark's
     size depends on is a function of its cell id alone — the form sampled at
     that cell's centre, the tail cut, the gap, and the breathe, which is itself
     positional — so one id in, one size out, and a fragment can ask about its
     neighbours on the same terms it asks about itself. */
  vec2 cellUv(vec2 id){
    return ((id + 0.5) * uCell - 0.5 * uRes) / baseOf();
  }

  /* THE PICTURE, SAMPLED AT ONE CELL. This is the only place the form is ever
     evaluated. A halftone has exactly one sample per cell by definition, and
     the whole frame — marks, shadows, ground — is built from this lattice of
     samples and nothing else. */
  float formAt(vec2 id){
    float halfH = halfHOf();
    vec2  uvc   = cellUv(id);
    float l = uMode == 0 ? form(uvc, uG)
            : uMode == 1 ? arch(uvc, halfH, uT)
                         : typeField(uvc, uT);
    /* Cut the tail. A near-constant 2% across a large area is not invisible —
       it renders as a perfectly regular lattice of isolated marks, i.e.
       wallpaper across the whole frame and through the headline. Anything this
       dim carries no form, so it is not dim, it is off. */
    return max(l * uGain - 0.06, 0.0) / 0.94;
  }

  /* ...AND EVERY READ OF IT AFTER THE FIRST IS A TEXTURE FETCH.
     ---------------------------------------------------------------------------
     A cell's sample is the same for every pixel in that cell, and a fragment
     shader has no way to know that — asked nine times per pixel it evaluates
     the form nine times per pixel, which measured 5.4x the whole frame's cost
     on the software path. So the form is evaluated once per CELL into a small
     texture and read back here. At a 12px cell that is one evaluation per 144
     device pixels instead of nine per pixel, which is why the correct nine-tap
     version is also the fastest this page has ever been.

     The one-cell border is what makes the edge of the frame ordinary: a
     fragment in the outermost cell asks about a neighbour at -1, and it is
     there. */
  vec3 cellAt(vec2 id){
    ivec2 t = clamp(ivec2(id) + 1, ivec2(0), textureSize(uLat, 0) - 1);
    return texelFetch(uLat, t, 0).rgb;
  }

  /* The breathe at one cell. It reaches the mark's SIZE and not the luminance
     behind it: the form's bright core is saturated, so modulating lum there is
     swallowed by the clamp and only the falloff would move — size is the one
     channel a saturated cell still has room in. Two sines at unrelated rates,
     which is what makes it read as breathing rather than as a loop, and it
     dies on the closing track's window: the last frame is meant to be still. */
  float breatheAt(vec2 id){
    vec2  uvc  = cellUv(id);
    float wave = sin(uTime * 0.55 + uvc.x * 2.3 + uvc.y * 1.7)
               + sin(uTime * 0.37 - uvc.x * 1.6 + uvc.y * 2.9) * 0.7;
    float amb  = uAmb * (1.0 - smoothstep(0.86, 0.965, uG));
    return 1.0 + amb * 0.060 * wave;
  }

  /* ...and the mark a cell's texel gets drawn as, in cell units. */
  float markOf(vec3 t){
    return sqrt(clamp(decLum(t.rg), 0.0, 1.0)) * (1.0 - uGap) * decBrt(t.b);
  }

  void main(){
    /* One divide, three readers: the cell id, the bilinear phase and gs. */
    vec2 q = gl_FragCoord.xy / uCell;
    vec2 cellId = floor(q);
    vec2 uv = cellUv(cellId);
    float halfH = halfHOf();

    /* THE GROUND IS THE SAME PICTURE THE MARKS ARE, AT THE SAME RESOLUTION.
       ------------------------------------------------------------------------
       This is the second half of the blockiness, and it is the opposite
       mistake to the first. The ground was originally snapped to the cell,
       which painted it in flat cell-sized tiles. The fix was to sample the
       form at the fragment's own position — continuous, and it did kill the
       tiles, but it bought a subtler defect: the ground could now resolve
       detail FINER than a cell, and the marks could not.

       The form has such detail. The lattice's rules are a band about four
       hundredths of a lattice cell wide — 4px against a 24px halftone cell at
       2x — so a rule that happens to fall between two mark centres is invisible
       to every mark and fully visible in the ground. What you get is a smooth
       vertical hairline standing in open black with no marks anywhere on it,
       repeating on the lattice's period (base/13, measured at 105px). That is
       what was left after the shadow was fixed, and it is not a shadow artefact
       at all — it is the ground drawing something the halftone cannot say.

       So the ground is interpolated between the SAME cell samples the marks are
       made of. Continuous, so no tiles; band-limited to the cell grid, so no
       hairlines; and the two layers are now provably one picture rather than
       two renderings of it that agree in the smooth places.

       Smoothstepped before the mix, not raw bilinear: straight bilinear is
       continuous but kinks at every cell centre, and a field of derivative
       creases is its own texture. This is C1 and costs two multiplies.

       The four samples come out of the 3x3 the shadow already needs, so the
       ground is now free — the whole frame costs nine reads of the form where
       it used to cost two, and nine is simply what a halftone with a shadow
       and a glow honestly costs. */
    vec3 C[9];
    for (int j = -1; j <= 1; j++){
      for (int i = -1; i <= 1; i++){
        C[(j + 1) * 3 + (i + 1)] = cellAt(cellId + vec2(float(i), float(j)));
      }
    }

    vec2  qc   = q - 0.5;                        // cell CENTRES at the integers
    vec2  qlo  = floor(qc);                      // the four that surround us
    vec2  qf   = qc - qlo;
    ivec2 qi   = ivec2(qlo - cellId) + 1;        // 0 or 1 per axis, into L
    qf = qf * qf * (3.0 - 2.0 * qf);
    float lumG = mix(mix(decLum(C[ qi.y      * 3 + qi.x].rg),
                         decLum(C[ qi.y      * 3 + qi.x + 1].rg), qf.x),
                     mix(decLum(C[(qi.y + 1) * 3 + qi.x].rg),
                         decLum(C[(qi.y + 1) * 3 + qi.x + 1].rg), qf.x),
                     qf.y);

    /* Signed cell coordinate, -1 to 1, zero at the mark's centre. The abs is
       what the mark itself needs; the SIGN is what tells a shadow which of its
       neighbours it is nearest to. */
    vec2 gs = (fract(q) - 0.5) * 2.0;
    vec2 f  = abs(gs);

    /* The mark stays a TRUE square, sharp corners and all. Easing them into
       a squircle was a misread: the squareness that needed fixing was the
       GLOW's, and rounding the mark as well ate its corners until every mark
       read as a circle. The halftone's whole character is that its marks are
       square; only the light around them is not. */
    float d = max(f.x, f.y);
    float e = markOf(C[4]);
    /* ONE CLOCK, AND THE PAGE OWNS IT.
       ------------------------------------------------------------------------
       The shadow leaving, the feather tightening and the colour draining are
       not three effects that happen to coincide, they are the same event — the
       film resolving into its conclusion — so they run off a single number.

       That number is computed in JS and handed down rather than derived from
       uG here, because the TYPE resolves on it too. A headline still warm cream
       while the marks behind it have gone white is the same defect as a shadow
       that lags the colour, and the only way two languages agree on a curve is
       for one of them to do the arithmetic. It also lets the about page, which
       plays this film backwards, carry its own window without the shader
       knowing there is more than one. */
    float resolveU = clamp(uResolve, 0.0, 1.0);

    /* THE FEATHER, and the only place it is argued. A hard step() gives a
       razor border — correct, and inert. Feathered by a fraction of a cell the
       marks catch light the way an emulsion does: the small ones in the
       falloff dissolve into the ground instead of switching off, and the field
       shimmers as the breathe moves the boundary through the feather rather
       than snapping a whole pixel. This is the one place the 1-bit contract is
       knowingly relaxed, and it is relaxed at the EDGE only — the interior is
       still exactly ink, the ground still exactly paper. No fwidth(): d comes
       from a fract(), whose derivative is discontinuous at every cell wall, so
       the analytic footprint is garbage on exactly the pixels the edge runs
       through. It resolves with everything else, because once the shadow has
       gone this is the only softness left and 0.20e is still a 4.2px ramp on a
       24px cell. Floored at half a device pixel — one gs unit is half a cell,
       so one device pixel is 2/uCell — so the last frame is a hard edge with
       one pixel of AA at any DPR rather than one that crawls at 1x. */
    /* The reflection is NOT here, and it was: a depth term inside this feather
       softened the mark itself. It is a layer over the canvas instead — .deep
       in index.html — because softening the MARK is the one trade this film
       refuses. Mirror of the .deep note there; keep the two in step. */
    float w     = max(e * mix(0.20, 0.02, resolveU), 1.0 / uCell);
    /* GATED AT ZERO. In an EMPTY cell e is 0, so w is 0 and this would be
       smoothstep(0, 0, d) — spec-undefined for edge0 >= edge1, and on the usual
       lowering saturate(0/0) gives 0, i.e. mark = 1. It needs d == 0, which
       needs gs exactly (0,0), which happens at one pixel per cell and ONLY when
       uCell is an odd integer: uCell is 12 * dpr, so Windows at 125% gives 15
       and 175% gives 21. Measured on both: the pixel at the predicted phase ran
       +36.8 above its own cell's median against +1.2 at uCell 12 — a lit
       speckle in every empty cell, on two of the commonest desktop scalings in
       the world, invisible on this machine. */
    float mark  = (1.0 - smoothstep(e - w, e + w, d)) * smoothstep(0.0, 0.02, e);


    /* A SHADOW BELONGS TO ITS MARK, NOT TO ITS CELL — and it is an
       OUTSIDE-ONLY thing. Three rejected designs are why this loop is shaped
       as it is, and all three came back looking plausible:

         · Blur the MARK. d is Chebyshev, so a gradient in it is a gradient in
           concentric squares: every mark a little pyramid, the field studded
           leather. A shadow never touches the inside of what casts it.
         · Own cell only. gs wraps at the wall, so an empty cell beside a full
           one got nothing while the fragment one pixel across got the whole
           0.84 halo — an 84% coverage step along every wall, i.e. tiles.
         · The nine neighbours sharing ONE e. Recorded as a proven no-op, and
           it was: at equal mark size the fragment is nearest its own mark by
           construction, so the max is always itself. A neighbour's shadow is
           only ever about the neighbour being a DIFFERENT SIZE — markOf's job.

       max, NOT sum. Summing nine inverts the lattice at this radius: four
       marks are near a corner and one near a centre, so corners come out
       brighter than marks (0.757 against 0.750) — a bright cross at every
       corner, a dark ring around every mark. A union of shadows is a max,
       which is also what keeps a shadow off a neighbouring mark.

       3x3 because 0.80e is a fade LENGTH, not a reach: at the largest mark
       (e = 0.88, 12px cell, one gs unit = 6px) that is 4.2px of fade and about
       12px of visible glow, two cells. And it stays continuous across a wall —
       the 3x3 changes by two columns at distance three, where the exponential
       is at 5% for the largest mark on the page and buried by the max anyway. */
    float shade = 0.0;
    for (int j = -1; j <= 1; j++){
      for (int i = -1; i <= 1; i++){
        vec2  off = vec2(float(i), float(j));
        /* One cell is TWO units of gs, so the neighbour's centre sits at
           2*off and the point handed to castShadow is gs measured from it. */
        float en  = markOf(C[(j + 1) * 3 + (i + 1)]);
        /* sg tightens on the resolve clock — the blur is the atmosphere the
           argument is told through, and the last frame is the conclusion.
           Floored rather than zeroed because castShadow divides by it. */
        float sgn = mix(0.80 * en, 0.06 * en, resolveU) + 1e-4;
        /* The gate closes one hole: at en exactly 0 the exponent is 0/0 at the
           cell's centre pixel, lighting one pixel in every empty cell. */
        shade = max(shade, castShadow(gs - 2.0 * off, en, sgn)
                           * smoothstep(0.0, 0.02, en));
      }
    }
    /* HELD UNDER FULL, AND THEN IT LEAVES ENTIRELY. 0.90 and not 1.0 because a
       step blurred by a symmetric kernel is at HALF strength on the edge
       itself: a shadow beginning at 1.0 is just a bigger square, and the mark
       has to keep a defined border with its light outside it. (1.0 - resolveU)
       is the resolve clock, not a switch — tightening sg alone leaves 0.06e,
       still ~90% opaque against the mark's own edge, a dark seam a pixel or two
       wide around every square. Multiplied out, the end state is
       arithmetically shadowless, and it sharpens as it fades. */
    shade *= 0.90 * (1.0 - resolveU);

    /* The square OR its shadow, whichever is greater. Inside, the square is 1
       and wins outright, which is what keeps the interior flat and the 1-bit
       contract intact; outside, the square is 0 and the shadow decays. */
    float cover = max(mark, shade);

    /* One bit per cell everywhere except the feathered edge above. Which two
       colours those are is the page's business, not the
       renderer's.

       The ink may travel across the page, though. Where uInk2 differs from
       uInk the mark bleeds from one to the other as you scroll. They DO
       differ here — uInk is the cream --field, uInk2 the white --field-end —
       so this travel is live and the mix at the foot of the ramp is not
       removable machinery.

       This ran late for a long time — pinned to the CLOSING of the mark
       (0.86-0.965 above) so the colour and the form arrived together. It no
       longer does. The resolving now finishes at the top of the finale, one
       whole section before the form closes, which is a deliberate separation
       and not a drift: the argument is toned, the conclusion is not, and the
       last section is meant to be a still white frame rather than a frame
       still cooling. uInk2 is therefore WHITE, not the cream the ramp passes
       through — a resolve that lands on a tone has not resolved. */
    /* KEYED TO THE FRAME, NOT TO THE FORM.
       Ramping on lum made the warmth radiate out of the arc's own centre —
       it travelled with the object, so every part of the form at the same
       brightness was the same colour wherever it sat. What the reference
       actually does is vertical: the floor of the frame is orange, it passes
       through yellow, and it is neutral cream by the top. That is light
       coming from BELOW the picture, and it stays put while the form moves
       through it. vy is 0 at the floor and 1 at the ceiling. */
    float vy      = clamp((uv.y + halfH) / (2.0 * halfH), 0.0, 1.0);
    /* THREE STOPS, not two. A straight line from the orange to the cream
       spends most of the frame in the muddy middle of that line, which is the
       tan the first attempt produced -- warm, but never actually orange at
       the floor and never actually yellow at the top. The reference has a
       distinct yellow BAND: measured up the limb of the arch, G/R climbs
       0.813 -> 0.83 -> 0.91 -> 0.93 while B/R sits flat near 0.70 and only
       lifts to 0.785 at the crown. Red first, then yellow, then pale: the
       middle stop is what makes the yellow read as its own colour rather than
       as a stage the orange passes through.

       Derived from the two ends rather than carried as a third uniform -- the
       page should not have to name a colour it cannot see. */
    /* THE FILM IS TONED, NOT MONOCHROME. Sampled off photographs of the thing
       running, the marks are a warm cream (#F5E1BA at the arch's crown,
       #E4C198 through the mid limb) — the ground is pitch black, so the warmth
       is carried entirely by the MARK. The hue ramps with brightness, which is
       what makes it read as lit rather than coloured: a black-body ramp, dim
       and orange at uTint, pale as it heats, which a flat mark colour cannot
       fake. The ground below carries a little of the same warm, weighted low,
       so the light spills off the form instead of stopping at its edge. All of
       it drains on the resolve clock: the last frame is the palette's own two
       values with nothing added.

       PEAK RED SITS AT A QUARTER HEIGHT, which is smoothstep's own edge0 of
       0.30 below — at vy = 0 the arch's marks are smallest, and at partial
       coverage the mix runs ink toward GROUND, so the red came out #4F413E,
       B/R 0.785, a neutral grey. Held off the floor it lands while the marks
       are still full strength and stays red as they thin. */
    vec3  amber   = mix(uTint, uInk, 0.52);
    float lo      = smoothstep(0.30, 0.52, vy);
    float hi      = smoothstep(0.46, 0.72, vy);
    vec3  warm    = mix(mix(uTint, amber, lo), uInk, hi);
    vec3  ink     = mix(warm, uInk2, resolveU);

    float lowBias = mix(1.0, 0.35, smoothstep(-halfH, halfH, uv.y));
    /* And the ground under the form carries the same warm, weighted low. This
       is not decoration: a thinning mark blends toward the ground, so if the
       ground stays cold the falloff turns grey no matter how red the ink is.
       Warm ground is what lets the limbs stay orange as they fade out. */
    float bloom   = pow(clamp(lumG, 0.0, 1.0), 0.42) * lowBias;
    /* Keyed to lumG — the form's own light — which is what makes the ground
       read as a lit OBJECT rather than as a tinted sheet: brightest along the
       stroke's spine, falling away to either side. It drains on the resolve
       clock with everything else. */
    float haze    = bloom * 0.55 * (1.0 - resolveU);
    vec3  gnd     = mix(uPaper, uTint, haze);

    /* SPILL BETWEEN CELLS, which the blur above cannot produce on its own.
       Every mark is solved inside its own cell and d saturates at the cell
       wall, so a bright mark's light stops dead at its neighbour's border —
       widen the kernel and the dots only get rounder while the gaps between
       them get DARKER, because a mark spread thinner is a mark dimmer. The
       photographs do the opposite: the gaps inside the bright band carry
       light and the whole band glows, with the screen still legible in it.

       That light has to come from somewhere outside the cell, so it comes
       from lum, which is the form itself and knows nothing about the grid.
       Toward ink rather than toward the warm, because it is the marks'
       own light: cream where they are cream, orange low in the frame where
       they are orange. A tight exponent keeps it welded to the form — at
       the 0.42 the wide haze uses, a nearly-empty cell would still pick up
       a few percent and the dark would stop being dark. */
    float spill   = pow(clamp(lumG, 0.0, 1.0), 1.1) * (1.0 - resolveU);
    gnd           = mix(gnd, ink, spill * 0.42);


    fragColor = vec4(mix(gnd, ink, cover), 1.0);
  }`;

  /* THE LATTICE PASS. One texel per cell, and nothing else in it. Built by
     cutting the main shader at its main() so the two can never drift: same
     uniforms, same form, same tail cut, by construction rather than by care. */
  const CUT = FRAG.indexOf('  void main(){');
  /* If the cut ever misses, slice(0, -1) hands back the WHOLE shader minus its
     last character and the lattice program is built with two main()s in it —
     which surfaces, several hundred lines away, as a GLSL error about a
     redefinition. The sentinel is literal text including its indentation, so a
     formatter reaching inside this template is all it takes. Say which thing
     broke, here, rather than leaving the compiler to describe the symptom. */
  if (CUT < 0) throw new Error('PTLField: FRAG has no "  void main(){" to cut at');
  const COMMON   = FRAG.slice(0, CUT);
  /* DERIVED FROM THE DECLARATIONS, not kept by hand beside them. A uniform
     added to the shader and to feed() but not to this list gets an undefined
     location, which WebGL treats as null — the write vanishes with no error and
     the picture is quietly wrong. A stray `uniform` inside a GLSL comment would
     add a name that resolves to null too, which makes its setters no-ops: the
     benign direction of the same failure. */
  const UNIFORMS = [...COMMON.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1]);
  const FRAG_LAT = COMMON + `void main(){
    /* One cell of border all round, so texel (0,0) is cell (-1,-1). */
    vec2 id = floor(gl_FragCoord.xy) - 1.0;
    fragColor = vec4(encLum(formAt(id)), encBrt(breatheAt(id)), 1.0);
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
    /* The lattice pass and the target it draws into: one texel per cell, plus
       a cell of border. lw/lh cache its size the way w/h cache the canvas's. */
    let latProg = null, ul = {}, latTex = null, fbo = null, lw = 0, lh = 0;
    /* The drawing-buffer size last handed to gl.viewport(). Declared up here so
       build() can clear it: after a restore the GL state is back at its
       defaults, and leaving the cache populated would let size() decide there
       was nothing to re-apply. */
    let w = 0, h = 0;
    /* Set only if a REBUILD fails — the context came back and would not take
       the program. Nothing can be drawn again after that, so the page stops
       asking rather than calling draw() on every scroll frame forever. */
    let dead = false;

    function link(frag) {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      let fs;
      try {
        fs = compile(gl, gl.FRAGMENT_SHADER, frag);
      } catch (e) {
        gl.deleteShader(vs);
        throw e;
      }
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      /* Linked or not, the shader objects have served their purpose: the
         program holds everything it needs. Left attached they stay resident
         for the life of the page. */
      gl.detachShader(p, vs); gl.deleteShader(vs);
      gl.detachShader(p, fs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p) || 'link failed';
        gl.deleteProgram(p);
        throw new Error(log);
      }
      return p;
    }

    function locate(p) {
      const m = {};
      for (const n of UNIFORMS) m[n] = gl.getUniformLocation(p, n);
      return m;
    }

    function build() {
      /* On a restore these handles name objects the driver has already
         destroyed, so deleting them is a formality — but build() is the one
         place that makes them, and it should be the one place that lets them
         go. */
      if (!gl.isContextLost()) {          // else: two INVALID_OPERATIONs per restore
        if (prog) gl.deleteProgram(prog);
        if (latProg) gl.deleteProgram(latProg);
        if (tex) gl.deleteTexture(tex);
        if (latTex) gl.deleteTexture(latTex);
        if (fbo) gl.deleteFramebuffer(fbo);
      }

      prog = link(FRAG);
      latProg = link(FRAG_LAT);
      u = locate(prog); ul = locate(latProg);

      latTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, latTex);
      /* NEAREST, and it matters: the value in a texel is a PAIR OF BYTES that
         together are one number, and the average of two encodings is not the
         encoding of the average. The interpolation the ground wants happens in
         the shader, on decoded values. */
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                              gl.TEXTURE_2D, latTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      lw = lh = 0;                      // and the lattice needs re-sizing

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
    /* Every caller reads this as "a field, or null" and branches once. The
       restore path already honours that — it catches and marks the field dead
       — but the FIRST build did not, so a driver that takes the context and
       then refuses the program threw out of mount(), past the null check, and
       took the rest of the calling script with it. On the front page that
       aborts before the choreography is armed and leaves the reader the static
       no-js document; the two failures are the same failure, and the page
       already knows how to survive one of them. */
    try {
      build();
    } catch (e) {
      console.error('PTLField: could not build the program', e);
      return null;
    }

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

    function size(dpr) {
      const nw = Math.round(canvas.clientWidth * dpr);
      const nh = Math.round(canvas.clientHeight * dpr);
      if (nw === w && nh === h) return;
      w = canvas.width = nw; h = canvas.height = nh;
      gl.viewport(0, 0, w, h);
    }

    /* Both programs read the same picture, so both take the same uniforms.
       Handed the program's OWN location map, because a uniform location belongs
       to a program and using one against the other silently writes nothing. */
    function feed(p, uu, t, o, cell, mode) {
      gl.useProgram(p);
      gl.uniform1i(uu.uTex, 0);
      gl.uniform1i(uu.uLat, 1);
      gl.uniform2f(uu.uRes, w, h);
      gl.uniform1f(uu.uT, t);
      gl.uniform1f(uu.uG, o.g != null ? o.g : t);
      gl.uniform1f(uu.uCell, cell);
      gl.uniform1f(uu.uGap, o.gap != null ? o.gap : 0.12);
      gl.uniform1f(uu.uGain, o.gain != null ? o.gain : 1.0);
      gl.uniform1i(uu.uMode, mode);
      gl.uniform1i(uu.uSection, o.section || 0);
      gl.uniform1f(uu.uFov, o.fov != null ? o.fov : 0.70);
      const ink = o.ink || [1, 1, 1], paper = o.paper || [0, 0, 0];
      const ink2 = o.ink2 || ink;
      gl.uniform3f(uu.uInk, ink[0], ink[1], ink[2]);
      gl.uniform3f(uu.uInk2, ink2[0], ink2[1], ink2[2]);
      gl.uniform3f(uu.uPaper, paper[0], paper[1], paper[2]);
      const tint = o.tint || paper;
      gl.uniform3f(uu.uTint, tint[0], tint[1], tint[2]);
      const m = o.mouse || [0, 0];
      gl.uniform2f(uu.uMouse, m[0], m[1]);
      gl.uniform1f(uu.uAct, o.act != null ? o.act : 0);
      gl.uniform1f(uu.uTime, o.time != null ? o.time : 0);
      gl.uniform1f(uu.uAmb, o.amb != null ? o.amb : 0);
      gl.uniform1f(uu.uResolve, o.resolve != null ? o.resolve : 0);
      const box = o.copy || [-0.40, 0.10, 0.40, 0.21];   // the floor, the default
      gl.uniform4f(uu.uCopy, box[0], box[1], box[2], box[3]);
      gl.uniform1f(uu.uLift, o.lift != null ? o.lift : 1);
    }

    function draw(t, o) {
      if (lost || dead) return;
      o = o || {};
      /* ONE READING OF EACH. The cell size below sizes the lattice texture and
         is also what feed() writes into uCell — if the two ever disagreed the
         one-cell border invariant breaks and every fragment's 3x3 reads the
         wrong texels, a whole-frame corruption out of two lines that look
         independent. So it is computed here and handed to both. */
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const cell = (o.cell != null ? o.cell : 12) * dpr;
      size(dpr);
      const mode = MODES[o.mode || opt.mode] || 0;
      if (mode === 2 && o.word) setWord(o.word);

      /* One texel per cell, plus a cell of border either side, so a fragment
         in the outermost cell can still ask about a neighbour beyond the frame
         and get an answer rather than a clamp. */
      const nw = Math.ceil(w / cell) + 2, nh = Math.ceil(h / cell) + 2;
      if (nw !== lw || nh !== lh) {
        lw = nw; lh = nh;
        gl.bindTexture(gl.TEXTURE_2D, latTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lw, lh, 0,
                      gl.RGBA, gl.UNSIGNED_BYTE, null);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, latTex);

      /* PASS ONE: the picture, once per cell. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, lw, lh);
      feed(latProg, ul, t, o, cell, mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* PASS TWO: the frame, which now only has to read it. */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      feed(prog, u, t, o, cell, mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* isLost is the RECOVERABLE half of isDead: the context has gone but the
       browser may still offer it back, and draw() returns immediately for
       both. The page needs the two apart: dead is terminal, and is where it
       stops asking for good, whereas lost is where it stops asking UNTIL the
       restore event — which is its cue to start again. */
    return { draw, setWord, gl, canvas, isDead: () => dead, isLost: () => lost };
  }

  root.PTLField = { mount, CLOSE };
})(window);
