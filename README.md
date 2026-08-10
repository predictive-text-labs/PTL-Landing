# ptl.inc

The Predictive Text Labs landing page. Six beats of an argument, over a film
that is **drawn, not filmed**.

## What this is

No video, no image sequence, no animation library, no framework, no build step.
The whole film is one WebGL2 fragment shader — `src/ptl-field.js` — and scroll
is the clock the argument runs on. The composition is a pure function of
`scrollY` — every beat, every line, every track in the form — so there is
nothing to seek, buffer or decode; dragging the scrollbar backwards runs the
film backwards exactly. The one thing that is not is the interaction: the mark
leans toward the pointer by about twenty pixels, which rides on top of the
scroll-determined position rather than replacing it, and is off entirely under
`prefers-reduced-motion` and on a coarse pointer.

The film ends before the page does. The last stretch of scroll — `TAIL` in
`src/ptl-page.js` — is deliberately dead: the mark has closed, the claim has
hit its wall, the frame is held, and the reader goes on scrolling into a page
that has stopped moving. Only after that has plainly registered as an ending
does the one action the page offers surface. Nothing but that link reads the
tail, so it cannot stretch a single cue in the film.

The field also breathes on a real-time clock, so a page nobody is touching is
alive rather than a screenshot, and scrolling makes that clock run faster
(measured: 1× idle, ~2× under a steady scroll, up to ~8.7× on a hard flick,
decaying back on its own). It reaches exactly one thing — the size of the
halftone marks — so it cannot move the composition or desynchronise the copy,
and it fades out entirely as the closing mark lands, because the last frame is
meant to be still. `prefers-reduced-motion` turns it off.

The reason is in the shader's own header: the reference set this was art
directed against (Algolia, Pulse, 1-bit posters) is *graphic*, not
photographic. Every one of those images is a single coherent form built from a
regular grid of marks falling off into black. You cannot get that by crushing a
photograph to 1-bit — crushing a photograph gives you noise. You get it by
drawing the grid. The output stage is a **halftone**, not a dither: marks sit on
a rigid lattice and their SIZE carries the image (`s = sqrt(luminance)`, so area
is proportional to light). Fixed-size on/off marks read as a dot-matrix printer;
size modulation reads as print.

## Files

    index.html          the page: chrome, the copy, and all of its CSS
    about.html          the about page: the team, the backers, the principles
    src/ptl-field.js    the renderer — one shader, three treatments (FORM ships)
    src/ptl-page.js     the choreography: scroll -> section -> type and field
    fonts/              Cormorant (+italic), Geist Mono, Inter — all local

**The copy is in `index.html`, not in the JavaScript.** Every visible word is
drawn into scroll-choreographed containers, which would otherwise leave a
crawler, a link preview and a screen reader with a page containing no words at
all. So the argument lives in `#story` as ordinary semantic HTML and the script
reads it out of the DOM. One source of truth. Edit the copy there.

## Variations

Four colourways: variation 1 is the default and has no query at all, and 2, 3
and 4 are selected with a query parameter. `?v=` anything else is variation 1.

    /               1  a toned film on black: the mark's hue ramps with its
                       brightness, it casts a drop shadow, and the ground
                       carries a little of the same warmth — all three drain
                       away together, leaving white on hard black by the last
                       frame
    /?v=2           2  inverted onto stone-300, the old site's own warm paper
    /?v=3           3  variation 4's contract on paper: the same strictly
                       one-bit film, a redder step of stock — taupe-300 —
                       and the same black type, with the blue confined to
                       the FILM and resolving to black as the mark closes
    /?v=4           4  the control: white mark on black, strictly one bit.
                       No shadow, no hue ramp, no bloom, no feathered edge —
                       every pixel is either the ink or the paper

Variation 4 is not a colourway so much as the thing the others are arguing
against. Variation 1 claims the field reads as an emulsion catching light
rather than as a diagram; that claim is only worth something next to the
version with none of it, which is what 4 is. Two switches carry the whole
difference — `shadow` and `tone` in the draw options — so the two can be
compared without a second renderer. Variation 3 takes `tone` off as well: it
is 4's contract with a colour in it.

A third switch, `print`, is not a variation at all: it is what the toning
MEANS on a light ground. On black the ground is zero, so everything added to
it reads as light — a warm haze off the form, weighted toward the floor of the
frame like a lamp below the picture. On paper the ground is the brightest
thing in frame, so the same haze reads as dirt, and the same lamp puts its
heaviest smudge exactly where the arch's legs are thinnest. The pale variants
therefore get the print reading of those terms: the ground's haze becomes a
straight vertical wash instead of a halo keyed to the form, it drops from half
the tint to a few percent — dot gain instead of glow — and the tone response
gets a contrast curve, because a printed stroke has a boundary where a lit one
has a falloff. What is left is one gradient, running up the frame. It is
derived from the paper's own luminance rather than named per variation, so a
palette that inverts the ground gets it without having to remember to ask.

Variation 3 is the same 1-bit contract as variation 4, on paper instead of on
black, and keeping one thing: the mark's colour travels from `--field` to
`--field-end` across the closing window, so the film is blue for the whole
argument and neutral by the time the mark lands. The drain sits after the tone
switch in the shader, which is why turning the toning off does not take it with
it. Nothing else survives — no ramp, no haze, no bloom, no feathered edge, and
no `--tint`, because on this variation nothing can read one.

Every colour, including the two the shader resolves its 1-bit output to, comes
from the `:root` blocks at the top of `index.html`; the renderer is handed
`--field` and `--paper` at draw time, so the film and the type cannot disagree
about the ground they are on. Once one is chosen, the other three blocks and
the switch come out.

## Develop

    pnpm install        oxlint, knip, jscpd (lint only — nothing ships from here)
    pnpm dev            serve at http://localhost:8777
    pnpm verify         oxlint + knip + jscpd

## Deploy

Static, published from the repository root by Netlify. `netlify.toml` sets an
empty build command — there is nothing to compile, so there is nothing that
can fail at deploy time.

Caching follows from there. With no build step the filenames are not
content-hashed, so nothing is served `immutable`: fonts get thirty days, and
the scripts — which share no version with the HTML that loads them — are
revalidated on every visit.

## Accessibility

- The full argument is in the DOM and in reading order; the rendered copy is
  `aria-hidden`, so it is never announced twice.
- `prefers-reduced-motion` holds every section fully resolved, stops the caret
  blinking, and disables the pointer-lit mark.
- Without JavaScript the copy stops hiding and sets itself as a document.
