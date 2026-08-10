/* ============================================================================
   PTL — procedural field renderer
   ----------------------------------------------------------------------------
   THE THESIS: a halftone, not a dither — a rigid grid of marks whose SIZE
   carries the image. The reference set is one coherent form on a regular grid
   falling off into black, and crushing a photograph to 1-bit gives noise, not
   that. Fixed-size on/off is a dot-matrix printer, and that crunch is most of
   what reads cheap. Area proportional to luminance means sqrt() on the side;
   every pixel is still pure black or pure white.

   Three treatments share that output stage: FORM, one abstract form in screen
   space, no world and no camera; ARCH, raymarched concrete flying past; TYPE,
   Cormorant rendered to a texture and halftoned on the same grid.

   Drawn rather than filmed, for exact art direction (a near mass is an unlit
   silhouette because RANGE says so) and zero scroll latency — a video scrub
   measured 90ms median, spiking past 600ms.

   USAGE
     const f = PTLField.mount(canvas, { mode: 'form' });
     f.draw(0.42, { section: 2, cell: 12 });
   ========================================================================== */
(function (root) {
  'use strict';

  /* WHERE THE MARK ENDS UP. ptl-page.js keeps the last line of type clear of
     the closing mark, and the shader is a string: it cannot read a JS constant,
     nor JS its literals. So the numbers live between their two readers —
     form()'s closing tracks below, and PTLField.CLOSE. They have come apart
     before: retune a track, retune the field here in the same edit. R and CY
     are END values, not any single track's argument. */
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

  /* A LUMINANCE IN A BYTE PAIR. RGBA8 is the only colour-renderable format
     WebGL2 guarantees, and one byte per cell is not enough: the ground raises
     lum to the 0.42, so a single 1/255 step at the bottom of the range opens to
     a tenth of the bloom and the dark banded. Two channels carry 16. */
  vec2  encLum(float l){ float q = clamp(l, 0.0, 1.0) * 255.0;
                         return vec2(floor(q) / 255.0, fract(q)); }
  float decLum(vec2 e){ return e.r + e.g / 255.0; }
  /* The breathe rides in the third channel because it is a property of a CELL.
     That keeps the shading pass free of anything positional — it only reads —
     and saves eighteen transcendentals a pixel. 0.88..1.135 spans the
     0.898..1.102 the breathe reaches. */
  float encBrt(float b){ return clamp((b - 0.88) / 0.255, 0.0, 1.0); }
  float decBrt(float e){ return 0.88 + e * 0.255; }

  float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

  /* ---- FORM ----------------------------------------------------------------
     ONE circle, for the whole page. Six section-selected branches meant five
     hard cuts; don't join two things, have one thing the whole way. The opening
     "arc" is this same circle at colossal radius, centre far below the frame,
     so only its top edge is in shot.

       0.00-0.28  DECIDE  centre rises, radius collapses: arc becomes ring
       0.28-0.50  WHEN    the ring holds and tightens
       0.33-0.50  EARN    a lattice grows OUT of the ring, its void the ring
       0.50-0.67  COMMIT  the lattice loses cells and goes out of register
       0.67-0.86  PRICE   every cell returns and snaps back into register
       0.84-0.965 END     the lattice falls away, the ring closes to one mark
       0.965-1.00         held: the film is over and the frame is still

     Every track runs on uG (global scroll), never on section index: continuous
     by construction rather than by tuning. */
  float track(float g, float a, float b, float v0, float v1){
    return mix(v0, v1, smoothstep(a, b, g));
  }

  /* THE NORMALISATION, AND THE ONLY COPY OF IT. Dividing by the height widens a
     letterboxed canvas instead of cropping it, so the subject does not shrink
     to a stamp. In portrait it scales to the HEIGHT and the ring runs off both
     edges — deliberately: capping to the width was tried and reverted, fixing a
     silhouette nobody was looking at at the cost of 42% of the closing mark's
     size. Mirrored in CLOSE, which ptl-page.js reads. */
  float baseOf(){
    return max(uRes.y, uRes.x / 1.78);
  }
  float halfHOf(){
    return 0.5 * uRes.y / baseOf();
  }

  float form(vec2 uv, float g){
    /* The mark leans toward the pointer — barely. 0.042 read as a thing being
       dragged around; 0.015 uv is under twenty pixels across the screen, felt
       rather than watched, leaving the light to carry the life. */
    vec2 lean = uMouse * 0.015 * uAct;
    uv -= lean;

    /* Centre and radius are one continuous path from "colossal and mostly
       off-frame" to "one mark at the middle"; solved for apex +0.32 with the
       legs crossing the frame edge at -0.12, an arch reading as an arch only
       when the legs fall steeply as well as the apex being high. These end
       values, and bw's, are mirrored in CLOSE — read the note there before
       retuning. The opening -0.80 puts the reader inside a colossal circle and
       is not negotiable. uLift scales only the END: 0.02 leaves room UNDER the
       mark for copy, which on a phone is not where the copy is — there the page
       passes 0 and the words sit inside the mark. */
    float cy = track(g, 0.00, 0.30, -0.80, 0.02 * uLift);   // CLOSE.CY
    float r  = track(g, 0.00, 0.30,  1.12, 0.34)
             - track(g, 0.30, 0.50,  0.00, 0.07)      // WHEN: tightens
             + track(g, 0.52, 0.66,  0.00, 0.05)      // COMMIT: breathes out
             - track(g, 0.70, 0.86,  0.00, 0.05)      // PRICE: back into register
             /* END: done closing at 0.965, not 1.00. Still moving at the last
                pixel of scroll, the final frame existed only at the very bottom
                and the closing statement had nothing steady to sit under.
                Landing early buys a held end card of ~3% of the page. */
             - track(g, 0.86, 0.965, 0.00, 0.24);   // CLOSE.FROM/TO/DR; the
                                                    // sum above it is CLOSE.R
    vec2  c  = vec2(0.0, cy);
    float len = length(uv - c);

    /* Band width follows the same path: thick and soft while colossal, tight
       once it is a ring. 0.13 is load-bearing — the apex comes from the centre
       and the radius, the WEIGHT from here, and raising it to 0.23 to chase a
       higher apex turned a drawn edge into a slab. */
    float bw = track(g, 0.00, 0.30, 0.13, 0.045);   // CLOSE.BW

    float ring = 1.0 - smoothstep(0.0, bw, abs(len - r));

    /* Only while the circle is colossal: dim the ends so the top edge reads as
       one lit arc in the dark rather than a band running off both sides. */
    float ends = 1.0 - smoothstep(0.30, 1.05, abs(uv.x));
    ring *= mix(0.45 + 0.75 * ends, 1.15, smoothstep(0.10, 0.30, g));

    /* At the end the ring is small enough that a hole reads as a defect, so it
       fills — the last mark on the page is solid. */
    float closed = smoothstep(0.885, 0.965, g);
    ring = max(ring, (1.0 - smoothstep(r * 0.6, r * 1.25, len)) * closed);

    /* THE MARK ANSWERS THE POINTER. Once closed it is the only thing left on
       the page, and a still disc is a full stop; lighting makes it an object.
       Nothing translates — the CELLS are fixed and only their coverage changes,
       the grammar of the rest of the film. Cheap, because the normal is
       analytic: inside a disc of radius r, z is sqrt(1 - |p|^2). Applied to the
       WHOLE body, not the fill alone — lighting only the fill left the ring
       (still peaking at len = r) at full strength beside a dimmed core, and the
       two disagreed as a pinch of small cells at the disc's centre. */
    float lightAmt = uAct * closed;
    if (lightAmt > 0.001){
      /* DISTANCE EASING — the mark is FULLER the closer you get; backwards, it
         recoiled from attention. Two terms because they are two ideas: how much
         of the mark is there, and how sculpted it is. */
      float d    = length(uMouse - vec2(0.0, cy));
      float near = 1.0 - smoothstep(0.10, 0.92, d);
      float lvl  = mix(0.56, 1.00, near);   // how present the mark is
      float dirA = mix(0.25, 1.00, near);   // how directional its light is

      vec2  np = (uv - c) / max(r * 1.18, 1e-4);
      float nz = sqrt(max(0.0, 1.0 - min(dot(np, np), 1.0)));
      vec3  n  = normalize(vec3(np, max(nz, 0.06)));
      vec3  L  = normalize(vec3(uMouse * 1.30, 0.74));
      float lam = max(dot(n, L), 0.0);
      /* The hot spot sells it as a surface rather than a gradient: it slides
         across the halftone a beat ahead of the terminator. */
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0) * 0.30;

      /* THE LIMB, READ DIRECTIONALLY. An undirected rim brightens the whole
         edge: a vignette, and it does not move. Split by which way the edge
         faces, one dot product buys a lit lip near side and an inner shadow
         travelling round the far edge — the only cue saying the surface curves
         AWAY, and most of what makes the mark read as solid. */
      float lm   = length(L.xy);
      vec2  ldir = lm > 1e-3 ? L.xy / lm : vec2(0.0);   // head-on: no side, no lip
      float side = dot(normalize(np + vec2(1e-5)), ldir);
      float limb = smoothstep(0.54, 1.00, length(np));
      float lip   = limb * max( side, 0.0) * 0.14;
      float shade = limb * max(-side, 0.0) * 0.40;

      /* THE LIGHTING PEAKS AT ONE. It may shade the mark, never brighten it:
         size is sqrt(luminance) and luminance clamps at 1, so a term peaking
         above 1 drives every lit cell to full size and flattens the gradient
         into a plateau — at 1.34, everything inside len = 0.04 saturated and
         the mark became a solid disc with a halftone fringe. */
      float shape = 0.38 + 0.62 * lam * lam + spec + lip - shade;
      float lit   = clamp(mix(1.0, shape, dirA) * lvl, 0.0, 1.0);
      ring *= mix(1.0, lit, lightAmt);
    }

    /* The lattice, anchored to the circle's centre so it grows out of the ring
       rather than arriving over the top of it: its inner edge IS the ring. */
    float latAmt = track(g, 0.33, 0.46, 0.0, 1.0) * track(g, 0.84, 0.945, 1.0, 0.0);
    float lat = 0.0;
    if (latAmt > 0.001){
      vec2 gc  = (uv - c) * 13.0;
      vec2 cid = floor(gc);
      /* Out of register, then back: peaks inside COMMIT, fully resolved by the
         end of PRICE, which is the argument those two sections make. */
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

    /* The form parts around the copy, in its COLUMN only — the arch's legs live
       at the frame edges where no type goes, and clearing the whole lower band
       amputated them. A backdrop blur was tried instead and reverted: it keeps
       more of the picture, but as a soft grey smear, and what makes this page
       work is that every mark is hard. uCopy is the box the words occupy,
       MEASURED BY THE PAGE, because three constants describing a landscape
       floor is not where the copy is on a phone. Its fourth number is the
       falloff, 0.21 on the floor, which with the 1.62 the sides take is the
       shipped 0.34: a wide frame draws what it drew before. */
    float column = 1.0 - smoothstep(uCopy.z, uCopy.z + uCopy.w * 1.62, abs(uv.x));
    /* uv is normalised on the LONG side, so in landscape uv.y stops meaning
       "share of the visible frame" and the keep-out drifts off a short
       viewport: on an 844x390 phone the band began at 238px with the copy at
       152px. sy converts back to a fraction of the actual height; at or taller
       than 16:9 it is exactly uv.y. */
    float base   = baseOf();
    float sy     = uv.y * base / uRes.y;
    float band   = 1.0 - smoothstep(uCopy.y, uCopy.y + uCopy.w, abs(sy - uCopy.x));
    float clear  = 1.0 - band * column;

    return max(ring, lat) * clear;
  }

  /* ---- ARCH ----------------------------------------------------------------
     The storyboard's world, raymarched. Kept whole so the three treatments are
     a fair comparison rather than one of them a sketch.                       */
  float sdBox(vec3 p, vec3 b){
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  float map(vec3 p){
    float d = 1e9;
    /* Floating, never standing — unbounded void, no ground. It pays
       compositionally: the masses have visible bottom edges converging toward
       the horizon, leaving a black wedge along the frame's floor for type. */
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

  /* Nothing is lit closer than NEAR, so a mass arriving at the lens goes to
     silhouette rather than to a lit grey slab. */
  float range(float t){
    return smoothstep(30.0, 74.0, t) * (1.0 - smoothstep(150.0, 260.0, t));
  }

  /* ONE MARK'S SHADOW, and the only place the metric is argued. p is relative
     to that mark's centre, in cell units.

     Not Chebyshev: the metric whose circles ARE squares gave every mark a
     square halo whose corners met across a cell in hard rectangular patches,
     worse the more blur. Distance to a BOX is Euclidean outside and therefore
     round at the corners, at the same cost. A wide blur loses a square anyway,
     so the metric follows the blur — hug the box while it is tight, go radial
     as it grows past.

     ZERO SPREAD, ALL BLUR, SCALED WITH THE MARK: sg is proportional with no
     constant term. Spread grows the shape before blurring, which is a plateau,
     and a floor would hand a one-pixel mark a fixed halo and haze over the
     falloff, which is nothing but small marks. */
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
     The word as the picture: Cormorant white on black, displaced by a warp that
     eases out as the section resolves, so it arrives out of distortion rather
     than fading in. Same grid, same marks, different subject.                 */
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

  /* THE MARK ANY GIVEN CELL CARRIES, in cell units. Out of main because a
     shadow is cast by a MARK, and the marks falling on a fragment are mostly
     not its own cell's. Everything a mark's size depends on is a function of
     its cell id alone: one id in, one size out, so a fragment asks about its
     neighbours on the terms it asks about itself. */
  vec2 cellUv(vec2 id){
    return ((id + 0.5) * uCell - 0.5 * uRes) / baseOf();
  }

  /* THE PICTURE, SAMPLED AT ONE CELL, and the only place the form is ever
     evaluated. A halftone has exactly one sample per cell by definition, and
     the whole frame — marks, shadows, ground — is built from this lattice. */
  float formAt(vec2 id){
    float halfH = halfHOf();
    vec2  uvc   = cellUv(id);
    float l = uMode == 0 ? form(uvc, uG)
            : uMode == 1 ? arch(uvc, halfH, uT)
                         : typeField(uvc, uT);
    /* Cut the tail. A near-constant 2% over a large area renders as a perfectly
       regular lattice of isolated marks — wallpaper across the frame and
       through the headline. This dim carries no form, so it is off, not dim. */
    return max(l * uGain - 0.06, 0.0) / 0.94;
  }

  /* ...AND EVERY READ AFTER THE FIRST IS A TEXTURE FETCH. A cell's sample is
     the same for every pixel in it, and a fragment shader cannot know that:
     asked nine times per pixel it evaluates the form nine times per pixel,
     measured at 5.4x the frame's cost on the software path. Once per CELL into
     a small texture, a 12px cell is one evaluation per 144 device pixels, which
     is why the correct nine-tap version is also the fastest this page has been.
     The one-cell border makes the frame's edge ordinary: the outermost cell
     asks about a neighbour at -1, and it is there. */
  vec3 cellAt(vec2 id){
    ivec2 t = clamp(ivec2(id) + 1, ivec2(0), textureSize(uLat, 0) - 1);
    return texelFetch(uLat, t, 0).rgb;
  }

  /* The breathe reaches the mark's SIZE, not the luminance behind it: the
     form's bright core is saturated, so modulating lum there is swallowed by
     the clamp and only the falloff would move. Two sines at unrelated rates, so
     it reads as breathing rather than as a loop, and it dies on the closing
     window — the last frame is meant to be still. */
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
       Snapped to the cell it painted flat tiles; sampled at the fragment's own
       position it killed them and bought the opposite defect — the ground could
       then resolve detail FINER than a cell, and the marks could not. A lattice
       rule is ~4px against a 24px cell at 2x, so a rule falling between two
       mark centres is invisible to every mark and fully visible in the ground:
       a smooth hairline in open black, repeating on the lattice period (105px).

       So the ground is interpolated between the SAME cell samples the marks are
       made of: continuous, so no tiles; band-limited to the cell grid, so no
       hairlines; two layers provably one picture. Smoothstepped before the mix,
       because raw bilinear kinks at every cell centre and a field of derivative
       creases is its own texture — C1 for two multiplies. The four samples come
       out of the 3x3 the shadow already needs, so the ground is free: nine
       reads is what a halftone with a shadow and a glow honestly costs. */
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
       what the mark needs; the SIGN tells a shadow which neighbour it is
       nearest to. */
    vec2 gs = (fract(q) - 0.5) * 2.0;
    vec2 f  = abs(gs);

    /* The mark stays a TRUE square. Easing the corners into a squircle was a
       misread: the squareness that needed fixing was the GLOW's, and rounding
       the mark ate its corners until every mark read as a circle. Only the
       light around a mark is not square. */
    float d = max(f.x, f.y);
    float e = markOf(C[4]);
    /* ONE CLOCK, AND THE PAGE OWNS IT. The shadow leaving, the feather
       tightening and the colour draining are one event — the film resolving —
       so they run off one number, computed in JS rather than from uG, because
       the TYPE resolves on it too and two languages agree on a curve only if
       one does the arithmetic. It also lets the about page, which plays this
       film backwards, carry its own window. */
    float resolveU = clamp(uResolve, 0.0, 1.0);

    /* THE FEATHER, and the only place it is argued. A hard step() is a razor
       border: correct, and inert. Feathered by a fraction of a cell the small
       marks in the falloff dissolve into the ground instead of switching off,
       and the field shimmers as the breathe moves the boundary through it. The
       one place the 1-bit contract is knowingly relaxed, and only at the EDGE.
       No fwidth(): d comes from a fract(), whose derivative is discontinuous at
       every cell wall, so the analytic footprint is garbage on exactly the
       pixels the edge runs through. Floored at half a device pixel (one gs unit
       is half a cell, so one device pixel is 2/uCell) so the last frame is one
       pixel of AA at any DPR rather than an edge that crawls.

       The reflection is NOT here, and it was: a depth term inside this feather
       softened the mark itself, the one trade this film refuses. It is a layer
       over the canvas instead — .deep in index.html; keep the two in step. */
    float w     = max(e * mix(0.20, 0.02, resolveU), 1.0 / uCell);
    /* GATED AT ZERO. In an EMPTY cell e is 0, so w is 0 and this would be
       smoothstep(0, 0, d) — spec-undefined for edge0 >= edge1, and on the usual
       lowering saturate(0/0) gives 0, i.e. mark = 1. It needs gs exactly (0,0),
       one pixel per cell and ONLY when uCell (12 * dpr) is an odd integer:
       Windows at 125% gives 15, at 175% gives 21. Measured on both, that pixel
       ran +36.8 above its cell's median against +1.2 at uCell 12 — a lit
       speckle in every empty cell, on two very common desktop scalings. */
    float mark  = (1.0 - smoothstep(e - w, e + w, d)) * smoothstep(0.0, 0.02, e);


    /* A SHADOW BELONGS TO ITS MARK, NOT TO ITS CELL — and it is OUTSIDE-ONLY.
       Three plausible-looking designs are rejected here:

         · Blur the MARK. d is Chebyshev, so a gradient in it is concentric
           squares: every mark a pyramid, the field studded leather.
         · Own cell only. gs wraps at the wall, so an empty cell beside a full
           one got nothing while the fragment one pixel across got the whole
           0.84 halo — an 84% coverage step along every wall, i.e. tiles.
         · The nine sharing ONE e. A no-op: at equal size the fragment is
           nearest its own mark by construction, so a neighbour's shadow is only
           ever about it being a DIFFERENT SIZE, which is markOf's job.

       max, NOT sum. Summing nine inverts the lattice at this radius: four marks
       are near a corner and one near a centre, so corners come out brighter
       than marks (0.757 against 0.750). A union of shadows is a max, which also
       keeps a shadow off a neighbouring mark.

       3x3 because 0.80e is a fade LENGTH, not a reach: at the largest mark
       (e = 0.88, 12px cell, one gs unit = 6px) that is 4.2px of fade and ~12px
       of glow, two cells. Continuous across a wall too — the 3x3 changes by two
       columns at distance three, where the exponential is at 5% and buried by
       the max anyway. */
    float shade = 0.0;
    for (int j = -1; j <= 1; j++){
      for (int i = -1; i <= 1; i++){
        vec2  off = vec2(float(i), float(j));
        /* One cell is TWO units of gs, so the neighbour's centre is at 2*off. */
        float en  = markOf(C[(j + 1) * 3 + (i + 1)]);
        /* sg tightens on the resolve clock — the blur is the atmosphere the
           argument is told through. Floored, not zeroed: castShadow divides by
           it, and the smoothstep is the same empty-cell gate as mark's. */
        float sgn = mix(0.80 * en, 0.06 * en, resolveU) + 1e-4;
        shade = max(shade, castShadow(gs - 2.0 * off, en, sgn)
                           * smoothstep(0.0, 0.02, en));
      }
    }
    /* HELD UNDER FULL, THEN GONE ENTIRELY. 0.90 not 1.0, because a step blurred
       by a symmetric kernel is at HALF strength on the edge itself: a shadow
       beginning at 1.0 is just a bigger square, and the mark has to keep a
       defined border with its light outside it. The (1 - resolveU) is the
       clock, not a switch — tightening sg alone leaves 0.06e, still ~90% opaque
       against the mark's edge, a dark seam around every square. Multiplied out,
       the end state is arithmetically shadowless and sharpens as it fades. */
    shade *= 0.90 * (1.0 - resolveU);

    /* The square OR its shadow, whichever is greater: inside, the square is 1
       and wins outright, which keeps the interior flat and the 1-bit contract
       intact; outside it is 0 and the shadow decays. */
    float cover = max(mark, shade);

    /* One bit per cell everywhere but the feathered edge; which two colours
       those are is the page's business. The ink travels, though — uInk is the
       cream --field, uInk2 the white --field-end — so the mix at the foot of
       this ramp is live machinery. It finishes a whole section before the mark
       closes, deliberately: the argument is toned, the conclusion is not, and
       uInk2 is WHITE because a resolve landing on a tone has not resolved.

       KEYED TO THE FRAME, NOT TO THE FORM: ramping on lum made the warmth
       radiate out of the arc's centre, travelling with the object. The
       reference is vertical — orange at the floor, through yellow, cream by the
       top: light from BELOW, staying put while the form moves through it. */
    float vy      = clamp((uv.y + halfH) / (2.0 * halfH), 0.0, 1.0);
    /* THE FILM IS TONED, NOT MONOCHROME. Sampled off photographs of it running,
       the marks are a warm cream (#F5E1BA at the crown, #E4C198 mid-limb) on a
       pitch black ground, so the warmth is carried entirely by the MARK and the
       hue ramps with brightness — a black-body ramp, dim and orange at uTint,
       pale as it heats, which reads as lit rather than coloured.

       THREE STOPS, not two: a straight line from orange to cream spends most of
       the frame in the muddy middle of it, a tan never actually orange at the
       floor nor yellow at the top. The reference has a distinct yellow BAND —
       up the limb, G/R climbs 0.813 -> 0.83 -> 0.91 -> 0.93 while B/R sits flat
       near 0.70 and lifts to 0.785 only at the crown. The middle stop is
       derived from the two ends, not carried as a third uniform: the page
       should not name a colour it cannot see.

       PEAK RED SITS AT A QUARTER HEIGHT, the 0.30 edge0 below. At vy = 0 the
       marks are smallest and partial coverage runs ink toward GROUND, so the
       red came out #4F413E, a neutral grey; held off the floor it lands while
       the marks are still full strength. */
    vec3  amber   = mix(uTint, uInk, 0.52);
    float lo      = smoothstep(0.30, 0.52, vy);
    float hi      = smoothstep(0.46, 0.72, vy);
    vec3  warm    = mix(mix(uTint, amber, lo), uInk, hi);
    vec3  ink     = mix(warm, uInk2, resolveU);

    float lowBias = mix(1.0, 0.35, smoothstep(-halfH, halfH, uv.y));
    /* The ground carries the same warm, weighted low — not decoration: a
       thinning mark blends toward the ground, so a cold ground turns the
       falloff grey however red the ink is. Keyed to lumG, the form's own light,
       so it reads as a lit OBJECT and not a tinted sheet. */
    float bloom   = pow(clamp(lumG, 0.0, 1.0), 0.42) * lowBias;
    float haze    = bloom * 0.55 * (1.0 - resolveU);
    vec3  gnd     = mix(uPaper, uTint, haze);

    /* SPILL BETWEEN CELLS, which the blur above cannot produce. Every mark is
       solved inside its own cell and d saturates at the wall, so its light
       stops dead at its neighbour's border — widen the kernel and the dots only
       get rounder while the gaps get DARKER, a mark spread thinner being a mark
       dimmer. The photographs do the opposite: the gaps inside the bright band
       carry light and the whole band glows. So the light comes from lum, the
       form itself, which knows nothing about the grid, and runs toward ink
       because it is the marks' own. A tight exponent keeps it welded to the
       form — at the 0.42 the haze uses, a nearly-empty cell picks up a few
       percent and the dark stops being dark. */
    float spill   = pow(clamp(lumG, 0.0, 1.0), 1.1) * (1.0 - resolveU);
    gnd           = mix(gnd, ink, spill * 0.42);


    fragColor = vec4(mix(gnd, ink, cover), 1.0);
  }`;

  /* THE LATTICE PASS. One texel per cell and nothing else, built by cutting the
     main shader at its main() so the two can never drift: same uniforms, same
     form, same tail cut, by construction rather than by care. If the cut
     misses, slice(0, -1) returns the WHOLE shader minus one character and the
     lattice program is built with two main()s, surfacing hundreds of lines away
     as a GLSL redefinition error. The sentinel is literal text including its
     indentation, so a formatter reaching inside this template is all it takes:
     say which thing broke, here. */
  const CUT = FRAG.indexOf('  void main(){');
  if (CUT < 0) throw new Error('PTLField: FRAG has no "  void main(){" to cut at');
  const COMMON   = FRAG.slice(0, CUT);
  /* DERIVED FROM THE DECLARATIONS, not kept by hand beside them. A uniform
     added to the shader and to feed() but not to this list gets an undefined
     location, which WebGL treats as null — the write vanishes with no error and
     the picture is quietly wrong. (A stray `uniform` inside a GLSL comment adds
     a name that resolves to null too: the benign direction of the same bug.) */
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

    /* Everything GL lives in build(), because a lost context invalidates every
       program, location and texture handle at once. Without preventDefault()
       the browser never offers to restore at all, and a page whose entire
       picture is one shader would stay blank for the session while the type
       kept choreographing over nothing. */
    let prog = null, u = {}, tex = null, drawn = null, lost = false;
    /* The lattice pass and its target: one texel per cell plus a cell of
       border. lw/lh cache its size the way w/h cache the canvas's. */
    let latProg = null, ul = {}, latTex = null, fbo = null, lw = 0, lh = 0;
    /* Last size handed to gl.viewport(). Up here so build() can clear it: after
       a restore the GL state is back at its defaults, and a populated cache
       would let size() decide there was nothing to re-apply. */
    let w = 0, h = 0;
    /* Set only if a REBUILD fails — the context came back and would not take
       the program. Nothing can be drawn after that, so the page stops asking
       rather than calling draw() on every scroll frame forever. */
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
      /* Linked or not, the program holds all it needs; left attached the shader
         objects stay resident for the life of the page. */
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
      /* After a restore these handles name objects the driver already
         destroyed, so deleting them is a formality — but build() makes them and
         should be the one place that lets them go. */
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
      /* NEAREST, and it matters: a texel is a byte PAIR, and the average of two
         encodings is not the encoding of the average. The ground interpolates
         in the shader, on decoded values. */
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
       restore path honours that; the FIRST build did not, so a driver that took
       the context and then refused the program threw out of mount(), past the
       null check, and took the rest of the calling script with it. */
    try {
      build();
    } catch (e) {
      console.error('PTLField: could not build the program', e);
      return null;
    }

    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => {
      /* An exception here escapes into an event handler where nothing is
         waiting for it, leaving `lost` true forever — the picture gone with no
         record of why. Say so once, and mark the field dead. */
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
         hard by the edges, which is what gives a thin serif weight at scale. */
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

    /* Both programs read the same picture, so both take the same uniforms —
       each handed its OWN location map, because a location belongs to a program
       and using one against the other silently writes nothing. */
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
      /* ONE READING OF EACH. This cell size sizes the lattice texture AND is
         what feed() writes into uCell; if the two disagreed the one-cell border
         invariant breaks and every fragment's 3x3 reads the wrong texels — a
         whole-frame corruption out of two lines that look independent. */
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const cell = (o.cell != null ? o.cell : 12) * dpr;
      size(dpr);
      const mode = MODES[o.mode || opt.mode] || 0;
      if (mode === 2 && o.word) setWord(o.word);

      /* One texel per cell, plus the cell of border cellAt() relies on. */
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

    /* isLost is the RECOVERABLE half of isDead: draw() returns immediately for
       both, but the page needs them apart — dead is terminal, lost is where it
       stops asking UNTIL the restore event, its cue to start again. */
    return { draw, setWord, gl, canvas, isDead: () => dead, isLost: () => lost };
  }

  root.PTLField = { mount, CLOSE };
})(window);
